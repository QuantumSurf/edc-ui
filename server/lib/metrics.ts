// KMX EDC — Prometheus 메트릭 (prom-client)
// 프로세스 기본 메트릭 + HTTP 요청 지연/카운트 + 알림 폴러/감사 쓰기 실패 카운터.
// /metrics 로 노출(무인증, /api 밖) — k8s prometheus 스크레이프용(helm podAnnotations).
// 라벨은 method/route(정규화)/status 만 사용한다. tenant 라벨은 카디널리티 폭발 + 정보 노출
// 우려로 배제한다(테넌트별 추적은 구조화 요청 로그의 reqId/tenantId 로 한다).

import {
  Registry,
  collectDefaultMetrics,
  Histogram,
  Counter,
} from "prom-client";

export const register = new Registry();
collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP 요청 처리 시간(초)",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const notificationPollTotal = new Counter({
  name: "notification_poll_total",
  help: "알림 폴러의 커넥터 폴링 결과",
  labelNames: ["result"] as const, // "success" | "failure"
  registers: [register],
});

export const auditWriteFailures = new Counter({
  name: "audit_write_failures_total",
  help: "감사 로그 쓰기 실패 누적 건수",
  registers: [register],
});

/** 경로를 저카디널리티 라우트 라벨로 정규화 — id/uuid 세그먼트를 :id 로 치환. */
export function routeLabel(path: string): string {
  return path
    .replace(/\/api\/connectors\/[^/]+/, "/api/connectors/:id")
    .replace(
      /\/(assets|policies|offerings|negotiations|transfers|edrs|shells|submodels|models)\/[^/]+/g,
      "/$1/:id"
    )
    .replace(/\/meta\/[^/]+/g, "/meta/:alias");
}
