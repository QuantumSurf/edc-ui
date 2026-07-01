// KMX EDC — BFF Server 부트스트랩 (Express)
// DB 초기화 → 앱 조립(buildApp) → 리슨 → 백그라운드 폴러/보존정리/graceful shutdown.
// 앱 구성(미들웨어·라우트)은 ./app.ts 의 buildApp 이 담당한다(통합테스트와 공유).

import { createServer } from "http";
import { buildApp } from "./app.js";
import { initDb, closeDb } from "./lib/db.js";
import {
  startNotificationGenerator,
  stopNotificationGenerator,
  pruneNotifications,
} from "./lib/notificationGenerator.js";
import { pruneAuditLogs } from "./lib/audit.js";
import { pruneFieldHistory } from "./lib/fieldHistory.js";

// 프로세스 전역 안전망 — 단일 요청의 처리되지 않은 비동기 거부(예: 인증 미들웨어의 DB
// 타임아웃)가 BFF 프로세스 전체를 종료시키지 않도록(전 사용자 다운 방지) 로깅만 하고 계속
// 실행한다. Node ≥15 는 기본적으로 unhandledRejection 시 프로세스를 죽이므로 명시 무력화.
// (개별 결함은 위 로그로 추적 가능 — 가시성을 유지하면서 가용성을 보존.)
process.on("unhandledRejection", reason => {
  console.error("[BFF] unhandledRejection (continuing):", reason);
});

async function startServer() {
  // ── Database Initialization ────────────────────────────────────
  await initDb();

  const app = buildApp();
  const server = createServer(app);

  const port = process.env.PORT || 3001;

  server.listen(port, () => {
    console.log(
      `[BFF] KMX EDC API server running on http://localhost:${port}/`
    );
  });

  // Background watcher for system-event notifications (negotiation TERMINATED,
  // transfer COMPLETED/TERMINATED, EDR expiring, VC expiring, connector unreachable).
  startNotificationGenerator().catch(err =>
    console.error("[NotifyGen] failed to start:", err)
  );

  // 데이터 보존기간 정리 — 부팅 시 1회 + 6시간 주기(무한 증가 방지). best-effort.
  // 감사로그(90d)·field_history(180d)·읽은 알림(90d)을 각 보존기간 초과분 삭제.
  const runRetention = () => {
    void pruneAuditLogs();
    void pruneFieldHistory();
    void pruneNotifications();
  };
  runRetention();
  const pruneInterval = setInterval(runRetention, 6 * 60 * 60 * 1000);

  // Graceful shutdown — k8s 롤아웃/스케일다운/노드 드레인 시 SIGTERM 을 받으면 새 연결을 끊고
  // in-flight 요청을 마무리한 뒤 폴러·인터벌·DB 풀을 정리하고 종료한다. 미처리 시 in-flight
  // 요청이 강제 종료되고(→ 인그레스 502) DB 풀이 누수돼 배포마다 커넥션 churn 이 생긴다.
  // 10s 안에 정상 종료가 끝나지 않으면 강제 종료.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[BFF] ${signal} received — graceful shutdown`);
    const force = setTimeout(() => {
      console.error("[BFF] graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000);
    force.unref();
    stopNotificationGenerator();
    clearInterval(pruneInterval);
    server.close(() => {
      void closeDb()
        .catch(err =>
          console.error("[BFF] closeDb error:", (err as Error).message)
        )
        .finally(() => {
          clearTimeout(force);
          process.exit(0);
        });
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch(console.error);
