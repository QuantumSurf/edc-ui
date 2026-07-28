// 대량 전송 소크 부하 — k6(읽기 램프)가 못 잡는 "스트리밍 경로" 회귀를 잡는다.
//
// 목 EDR 소스를 대용량으로 바꿔(app+mock 재기동) N개 동시 대량전송을 R라운드 돌리며,
// 처리량 + app 메모리(docker stats)를 관측한다. 스트리밍(pipe/백프레셔) 회귀 시 메모리 급증·
// 이벤트루프 지연·OOM 으로 드러난다. 끝나면 목/앱을 기본값으로 복구한다.
//
// 전제: dev 스택(app+db+minio+mock-edc) 가동. 실행:  node perf/bulk-soak.mjs
// 튜닝(env): MB(파일 크기, 기본 32) · CONC(동시 상한, 기본 4) · ROUNDS(라운드, 기본 3)
//           CID(커넥터, 기본 prod-prd-01) · BPN/PW(로그인)

import { execSync, spawn } from "node:child_process";

const BASE = process.env.SOAK_BASE || "http://localhost:3006";
const MB = Number(process.env.MB) || 32;
const CONC = Number(process.env.CONC) || 4;
const ROUNDS = Number(process.env.ROUNDS) || 3;
const CID = process.env.CID || "prod-prd-01";
const BPN = process.env.BPN || "BPNL000000000PRD";
const PW = process.env.PW || "0000";
const COMPOSE = "docker-compose.dev.yml";
const APP = "kmx-edc-ui-dev-app";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function compose(extraEnv) {
  execSync(`docker compose -f ${COMPOSE} up -d mock-edc app`, {
    stdio: "ignore",
    env: { ...process.env, ...extraEnv },
  });
}

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* 대기 */
    }
    await sleep(1000);
  }
  throw new Error("app 헬스 실패");
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: BPN, password: PW }),
  });
  if (!res.ok) throw new Error(`로그인 실패 http=${res.status}`);
  const raw = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  const jar = {};
  for (const c of raw) {
    const [k, v] = c.split(";")[0].split("=");
    jar[k.trim()] = v;
  }
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (!jar.kmx_csrf) throw new Error("csrf 쿠키 없음");
  return { cookie, csrf: jar.kmx_csrf };
}

async function startBulk(tp, auth) {
  const res = await fetch(
    `${BASE}/api/connectors/${CID}/transfers/${tp}/bulk-transfer`,
    {
      method: "POST",
      headers: {
        cookie: auth.cookie,
        "x-csrf-token": auth.csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ objectName: `soak/${tp}` }),
    }
  );
  return res.status;
}

async function waitTerminal(tp, auth) {
  for (let i = 0; i < 200; i++) {
    const r = await fetch(
      `${BASE}/api/connectors/${CID}/transfers/${tp}/progress`,
      { headers: { cookie: auth.cookie } }
    );
    if (r.ok) {
      const s = await r.json();
      if (["COMPLETED", "FAILED", "CANCELED"].includes(s.state)) {
        if (s.state !== "COMPLETED")
          console.log(`  [soak] ${tp} → ${s.state} ${s.error || ""}`);
        return s.state;
      }
    }
    await sleep(400);
  }
  return "TIMEOUT";
}

function toMB(v, unit) {
  return unit.startsWith("K") ? v / 1024 : unit.startsWith("G") ? v * 1024 : v;
}

async function main() {
  console.log(
    `[soak] 목 EDR→대용량(${MB}MB), 동시상한 ${CONC}, ${ROUNDS}라운드 — 재기동`
  );
  compose({
    MOCK_EDR_ENDPOINT: `http://mock-edc:8090/data/large?mb=${MB}`,
    BULK_TRANSFER_MAX_JOBS: String(CONC),
  });
  await waitHealth();
  const auth = await login();

  // app 메모리 샘플링(docker stats 스트림).
  const mem = [];
  const stats = spawn("docker", ["stats", "--format", "{{.MemUsage}}", APP]);
  stats.stdout.on("data", d => {
    const m = String(d).match(/([\d.]+)\s*([KMG])i?B/);
    if (m) mem.push(toMB(Number(m[1]), m[2]));
  });

  const t0 = Date.now();
  let n = 0;
  let failed = 0;
  for (let r = 1; r <= ROUNDS; r++) {
    const tps = [];
    for (let c = 1; c <= CONC; c++) {
      const tp = `soak-r${r}-c${c}-${Date.now()}${c}`;
      const st = await startBulk(tp, auth);
      if (st === 202) {
        tps.push(tp);
        n++;
      } else {
        failed++;
        console.log(`  [soak] start ${tp} → http ${st}`);
      }
    }
    const states = await Promise.all(tps.map(tp => waitTerminal(tp, auth)));
    failed += states.filter(s => s !== "COMPLETED").length;
    console.log(`[soak] 라운드 ${r}/${ROUNDS} 완료 (${tps.length}개)`);
  }
  const dur = Math.max(1, (Date.now() - t0) / 1000);
  stats.kill();

  const totalMB = n * MB;
  const peak = mem.length ? Math.max(...mem) : 0;
  const idle = mem.length ? Math.min(...mem) : 0;
  console.log("\n=== 소크 결과 ===");
  console.log(
    `전송 ${n}개 × ${MB}MB = ${totalMB}MB · 소요 ${dur.toFixed(1)}s · 처리량 ≈ ${(totalMB / dur).toFixed(1)} MB/s · 실패 ${failed}`
  );
  console.log(
    `app 메모리 ≈ ${idle.toFixed(0)}→${peak.toFixed(0)} MB (피크, 샘플 ${mem.length})`
  );
  try {
    const metrics = await (await fetch(`${BASE}/metrics`)).text();
    console.log(
      metrics
        .split("\n")
        .filter(l => /^bulk_transfer_(bytes_total|total|active)/.test(l))
        .join("\n")
    );
  } catch {
    /* 무시 */
  }

  console.log("\n[soak] 기본값 복구 — 재기동");
  compose({ MOCK_EDR_ENDPOINT: "", BULK_TRANSFER_MAX_JOBS: "" });
  console.log("[soak] done");
}

main().catch(e => {
  console.error("[soak] 실패:", e.message);
  console.error("[soak] 기본값 복구 시도");
  try {
    compose({ MOCK_EDR_ENDPOINT: "", BULK_TRANSFER_MAX_JOBS: "" });
  } catch {
    /* 무시 */
  }
  process.exit(1);
});
