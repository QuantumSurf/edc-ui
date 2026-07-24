// KMX EDC — 테넌트 오프보딩 CLI (플랫폼 운영 전용)
//
// super-admin 역할이나 HTTP 엔드포인트를 신설하지 않고, 서버 컨테이너 안에서 ops 가 직접
// 실행한다. DB 는 DATABASE_URL 로 연결한다(getPool). 파괴적 명령은 명시 인자/플래그를 요구한다.
//
// 사용법:
//   list                          테넌트 목록 + 아카이브 상태/커넥터·사용자 수
//   archive <bpn>                 테넌트 아카이브(소프트삭제) — 로그인/세션 즉시 차단, 복구 가능
//   restore <bpn>                 아카이브 해제(보존기간 내 복구) — 사용자는 재로그인 필요
//   purge [--days N] [--force]    아카이브 후 N일(기본 OFFBOARD_RETENTION_DAYS=30) 초과 테넌트
//                                 하드삭제. --force 없으면 dry-run(대상만 출력).
//
// 예 (dev):  docker exec kmx-edc-ui-dev-app npx tsx server/scripts/offboardTenant.ts list
// 예 (prod): node dist/scripts/offboardTenant.js archive BPNL000000000XYZ
//            node dist/scripts/offboardTenant.js purge --days 30 --force

import { closeDb } from "../lib/db.js";
import {
  archiveTenant,
  restoreTenant,
  listTenants,
  purgeArchivedTenants,
} from "../lib/tenants.js";
// 아카이브 시각은 DTO에선 머신리더블 ISO로 두고, 운영자에게 보이는 콘솔 출력만
// 공용 포맷터로 KST "YYYY-MM-DD HH:mm:ss" 표기(다른 시각 표기와 통일).
import { fmtDateTimeShort } from "../lib/edcClient.js";

const DEFAULT_RETENTION_DAYS = Number(
  process.env.OFFBOARD_RETENTION_DAYS ?? 30
);

function parseArgs(args: string[]): {
  flags: { force: boolean; days?: number };
  positional: string[];
} {
  const flags: { force: boolean; days?: number } = { force: false };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--force" || a === "--yes") flags.force = true;
    else if (a === "--days") flags.days = Number(args[++i]);
    else positional.push(a);
  }
  return { flags, positional };
}

const USAGE =
  "usage: offboardTenant <list | archive <bpn> | restore <bpn> | purge [--days N] [--force]>";

async function run(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);

  switch (cmd) {
    case "list": {
      const tenants = await listTenants();
      if (tenants.length === 0) {
        console.log("[offboard] 테넌트 없음.");
        break;
      }
      console.log(
        `[offboard] 테넌트 ${tenants.length}건 (archived / bpn / name — connectors, users):`
      );
      for (const t of tenants) {
        const state = t.archivedAt
          ? `ARCHIVED@${fmtDateTimeShort(new Date(t.archivedAt))}`
          : "active";
        console.log(
          `  [${state}] ${t.bpn}  ${t.name}  — connectors:${t.connectorCount} users:${t.userCount}`
        );
      }
      break;
    }

    case "archive": {
      const bpn = positional[0];
      if (!bpn) throw new Error("usage: archive <bpn>");
      const r = await archiveTenant(bpn);
      if (!r.archived) {
        console.log(
          `[offboard] 대상 없음 — 미존재이거나 이미 아카이브됨: ${bpn}`
        );
        process.exitCode = 1;
      } else {
        console.log(
          `[offboard] 아카이브 완료: ${r.name} (${bpn}) — 무효화된 세션 ${r.usersInvalidated}건. ` +
            `${DEFAULT_RETENTION_DAYS}일 후 'purge --force' 로 하드삭제 가능(그 전엔 'restore' 로 복구).`
        );
      }
      break;
    }

    case "restore": {
      const bpn = positional[0];
      if (!bpn) throw new Error("usage: restore <bpn>");
      const r = await restoreTenant(bpn);
      if (!r.restored) {
        console.log(
          `[offboard] 대상 없음 — 미존재이거나 아카이브 상태가 아님: ${bpn}`
        );
        process.exitCode = 1;
      } else {
        console.log(
          `[offboard] 복구 완료: ${r.name} (${bpn}) — 사용자는 재로그인해야 합니다.`
        );
      }
      break;
    }

    case "purge": {
      const days = Number.isFinite(flags.days)
        ? (flags.days as number)
        : DEFAULT_RETENTION_DAYS;
      // 음수/0/비정수 --days 는 보존창을 무력화(임계값이 미래/현재로 이동)해 방금 아카이브한
      // 테넌트까지 하드삭제할 수 있으므로 조기 거부한다. lib 계층도 클램프하지만 여기서 명확히 실패.
      if (!Number.isInteger(days) || days < 1) {
        throw new Error(
          `--days 는 1 이상의 정수여야 합니다(받은 값: ${String(flags.days)}). 보존기간 우회 하드삭제 방지.`
        );
      }
      const dryRun = !flags.force;
      const results = await purgeArchivedTenants(days, dryRun);
      if (results.length === 0) {
        console.log(
          `[offboard] purge 대상 없음 — 아카이브 후 ${days}일 초과 테넌트가 없습니다.`
        );
        break;
      }
      if (dryRun) {
        console.log(
          `[offboard] DRY-RUN — purge 대상 ${results.length}건 (실제 삭제하려면 --force 추가):`
        );
        for (const r of results) {
          console.log(
            `  - ${r.name} (${r.bpn})  archived_at=${fmtDateTimeShort(new Date(r.archivedAt))}`
          );
        }
      } else {
        console.log(`[offboard] purge 완료 ${results.length}건 (하드삭제):`);
        for (const r of results) {
          const detail = Object.entries(r.deleted)
            .map(([k, v]) => `${k}:${v}`)
            .join(", ");
          console.log(`  - ${r.name} (${r.bpn}) — ${detail}`);
        }
      }
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

run()
  .catch(err => {
    console.error("[offboard] 실패:", (err as Error).message ?? err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDb().catch(() => {});
  });
