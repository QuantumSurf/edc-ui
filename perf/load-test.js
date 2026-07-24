// KMX EDC Console BFF — k6 부하 테스트 (NF-12 처리량/신뢰성, NF-13 지연)
//
// 실행:
//   k6 run perf/load-test.js                                  # 기본 램프 부하
//   k6 run -e SMOKE=1 perf/load-test.js                       # 스모크(1 VU, 짧게)
//   k6 run -e BASE_URL=http://localhost:3006 perf/load-test.js
//   k6 run -e AUTH_TOKEN=demo-token-loadtest perf/load-test.js  # dev 인증 read 포함
//
// 대상: BFF(express) 기본 3001 포트. dev compose 는 3006 로 게시.
// 인증: setup() 에서 1회 로그인해 httpOnly 세션 쿠키를 받아 전 VU 가 공유한다.
//       계정은 PERF_BPN / PERF_PASSWORD 로 지정(기본값은 dev 시드 — server/lib/db.ts).
//       bearer 방식이 필요하면 AUTH_TOKEN 을 대신 줄 수 있다.
//       둘 다 실패하면 인증 read 를 건너뛰되 요약에 경고를 남긴다 — 인프라 프로브만
//       통과한 결과를 '부하 통과'로 오독하지 않기 위함이다.
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
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";
const SMOKE = __ENV.SMOKE === "1";
// setup() 로그인 계정. BPN 은 식별자(비밀 아님). fresh 시드의 admin 테넌트 BPN 은
// admin@kmx.io → BPNLDEMOADMIN(server/lib/db.ts). 커넥터를 등록해 그 BPN 이 테넌트가
// 된 스택(예: 오래 쓴 로컬 dev)은 -e PERF_BPN 으로 그 BPN(예: BPNL000000000PRD) 지정.
// dev 밖을 때릴 때는 반드시 PERF_PASSWORD 로 덮어쓸 것.
const PERF_BPN = __ENV.PERF_BPN || "BPNLDEMOADMIN";
const PERF_PASSWORD = __ENV.PERF_PASSWORD || "0000";

// 2xx~3xx 와 429(의도적 스로틀)를 '예상 응답'으로 등록 → http_req_failed 가 429 를
// 실패로 세지 않게 한다(신뢰성 지표를 5xx/네트워크 실패로 한정).
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

// 커스텀 메트릭
const serverErrors = new Rate("app_errors"); // 5xx/네트워크 실패만 — NF-12 신뢰성
const rateLimited = new Rate("rate_limited"); // 429 비율 — 정보성(스로틀 관찰)
const apiLatency = new Trend("api_read_latency", true);
// 인증 read 를 실제로 몇 번 쟀는지. 0 이면 앱 경로를 전혀 부하하지 않은 것이므로
// 임계값으로 걸어 "인프라 프로브만 통과"가 성공으로 보이는 사고를 막는다.
const apiReadSamples = new Counter("api_read_samples");

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
    // 인증 read 가 한 번도 안 돌았으면 실패 — 커버리지 없는 통과를 금지한다.
    api_read_samples: ["count>0"],
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

// 1회만 실행 — 전 VU 가 공유할 세션 쿠키를 확보한다. VU 마다 로그인하면 bcrypt 검증이
// 부하의 대부분을 차지해 정작 read 경로를 못 재고, 로그인 레이트리밋에도 걸린다.
export function setup() {
  if (AUTH_TOKEN) return { cookies: null };
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ tenantId: PERF_BPN, password: PERF_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  if (res.status !== 200) {
    console.warn(
      `[perf] 로그인 실패(status=${res.status}) — 인증 read 를 건너뛴다. ` +
        `PERF_BPN/PERF_PASSWORD 를 확인할 것.`
    );
    return { cookies: null };
  }
  const cookies = {};
  for (const name in res.cookies) cookies[name] = res.cookies[name][0].value;
  return { cookies };
}

export default function (data) {
  const authed = !!AUTH_TOKEN || !!(data && data.cookies);
  // k6 의 VU 쿠키 자는 iteration 시작마다 비워진다. 따라서 VU 당 1회가 아니라
  // iteration 마다 다시 채워야 2번째 iteration 부터 401 로 떨어지지 않는다.
  if (data && data.cookies) {
    const jar = http.cookieJar();
    for (const name in data.cookies)
      jar.set(BASE_URL, name, data.cookies[name]);
  }

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

  // ── 인증 read 엔드포인트(세션/토큰 확보 시, /api → 레이트리밋 대상) ──────────
  if (authed) {
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
        apiReadSamples.add(1);
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
