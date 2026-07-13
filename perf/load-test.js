// KMX EDC Console BFF — k6 부하 테스트 (NF-12 처리량/신뢰성, NF-13 지연)
//
// 실행:
//   k6 run perf/load-test.js                                  # 기본 램프 부하
//   k6 run -e SMOKE=1 perf/load-test.js                       # 스모크(1 VU, 짧게)
//   k6 run -e BASE_URL=http://localhost:3006 perf/load-test.js
//   k6 run -e AUTH_TOKEN=demo-token-loadtest perf/load-test.js  # dev 인증 read 포함
//
// 대상: BFF(express) 기본 3001 포트. dev compose 는 3006 로 게시.
// 인증: AUTH_TOKEN 미지정 시 무인증 인프라 프로브만 부하. dev 에서 `demo-token-*`
//       bearer 를 주면 viewer 권한 read 엔드포인트까지 포함한다(server/middleware/auth.ts).
//
// 429 처리: BFF 는 /api 에 per-IP 레이트리밋(60초/300요청, middleware/rateLimit.ts)을 건다.
//   단일 IP 고부하에서는 초과분이 429 로 스로틀되는 게 '정상 방어'다. 따라서 429 를 실패가
//   아닌 '예상 응답'으로 분류하고, 신뢰성 오류(app_errors)는 5xx/네트워크 실패만 집계한다.
//   운영 유사 처리량을 재려면 분산 IP(load zone) 또는 레이트리밋 상향이 필요하다.
//
// ⚠️ 임계값(thresholds)은 실 인프라 SLO 로 보정 대상이다. 아래 값은 단일 노드 BFF +
//    로컬 Postgres 기준의 합리적 초기치이며, 정식 NF-12/13 SLO 확정 시 갱신할 것.

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";
const SMOKE = __ENV.SMOKE === "1";

// 2xx~3xx 와 429(의도적 스로틀)를 '예상 응답'으로 등록 → http_req_failed 가 429 를
// 실패로 세지 않게 한다(신뢰성 지표를 5xx/네트워크 실패로 한정).
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

// 커스텀 메트릭
const serverErrors = new Rate("app_errors"); // 5xx/네트워크 실패만 — NF-12 신뢰성
const rateLimited = new Rate("rate_limited"); // 429 비율 — 정보성(스로틀 관찰)
const apiLatency = new Trend("api_read_latency", true);

export const options = {
  scenarios: SMOKE
    ? {
        smoke: {
          executor: "constant-vus",
          vus: 1,
          duration: "30s",
        },
      }
    : {
        // NF-12: 점증 부하로 처리량·안정성 관찰. 실 SLO 목표 동시성에 맞춰 stages 조정.
        ramp_load: {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: "30s", target: 20 }, // 워밍업
            { duration: "1m", target: 50 }, // 목표 부하
            { duration: "2m", target: 50 }, // 정상상태(steady state) 유지
            { duration: "30s", target: 0 }, // 램프다운
          ],
          gracefulRampDown: "10s",
        },
      },
  thresholds: {
    // NF-13(지연): 전체 요청 응답시간
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    // NF-12(신뢰성): 예상외 응답(5xx/네트워크/기타 4xx) 비율. 429 는 예상 응답이라 제외됨.
    http_req_failed: ["rate<0.01"],
    // 5xx/네트워크 실패만 — 진짜 서버 실패율
    app_errors: ["rate<0.01"],
    // 읽기 엔드포인트 지연은 별도로 더 엄격히 관찰
    api_read_latency: ["p(95)<400"],
  },
  // 결과 요약에 p99 포함
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

const authHeaders = AUTH_TOKEN
  ? { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
  : {};

// 응답을 3분류: ok(2xx) / throttled(429) / error(5xx·네트워크·기타)
function classify(res) {
  const s = res.status;
  serverErrors.add(s === 0 || s >= 500);
  rateLimited.add(s === 429);
  return {
    ok: s >= 200 && s < 300,
    throttled: s === 429,
    serverError: s === 0 || s >= 500,
  };
}

export default function () {
  // ── 무인증 인프라 프로브(항상 실행, /api 밖이라 레이트리밋 없음) ─────────────
  group("infra", () => {
    const health = http.get(`${BASE_URL}/healthz`);
    check(health, {
      "healthz 200": r => r.status === 200,
      "healthz status=ok": r => (r.json("status") || "") === "ok",
    });
    serverErrors.add(health.status === 0 || health.status >= 500);

    const ready = http.get(`${BASE_URL}/readyz`);
    // 마이그레이션 중(503 migrating)은 오류로 세지 않음 — 200/503 모두 정상 신호
    check(ready, {
      "readyz 응답": r => r.status === 200 || r.status === 503,
    });

    const metrics = http.get(`${BASE_URL}/metrics`);
    check(metrics, {
      "metrics 200": r => r.status === 200,
      "metrics prometheus 형식": r => (r.body || "").indexOf("# HELP") >= 0,
    });
    serverErrors.add(metrics.status === 0 || metrics.status >= 500);
  });

  // ── 인증 read 엔드포인트(AUTH_TOKEN 있을 때만, /api → 레이트리밋 대상) ────────
  if (AUTH_TOKEN) {
    group("api-read", () => {
      const endpoints = [
        "/api/auth/me",
        "/api/connectors",
        "/api/fleet/kpi",
        "/api/notifications",
      ];
      for (const path of endpoints) {
        const res = http.get(`${BASE_URL}${path}`, authHeaders);
        apiLatency.add(res.timings.duration);
        const c = classify(res);
        // 2xx(정상) 또는 429(예상된 스로틀)면 통과. 5xx/기타는 실패.
        check(c, {
          [`${path} 정상 또는 스로틀`]: x => x.ok || x.throttled,
          [`${path} 서버오류 아님`]: x => !x.serverError,
        });
      }
    });
  }

  sleep(1);
}
