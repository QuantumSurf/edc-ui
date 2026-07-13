# 부하 테스트 (k6)

BFF 성능·안정성 요구사항 검증용 k6 스크립트. NF-12(처리량/신뢰성)·NF-13(지연)에 대응한다.

## 전제

- [k6](https://k6.io/docs/get-started/installation/) 설치
  - Windows: `winget install k6` 또는 `choco install k6`
  - macOS: `brew install k6`
  - Linux: [공식 저장소](https://k6.io/docs/get-started/installation/) 참고
- 부하 대상 BFF 가 실행 중이어야 한다(로컬 기본 `http://localhost:3001`,
  dev compose 는 `http://localhost:3006`).

## 실행

```bash
# 스모크(1 VU, 30초) — 배포 파이프라인/사전점검용
k6 run -e SMOKE=1 perf/load-test.js

# 기본 램프 부하(0→50 VU, 총 4분) — NF-12/13 관찰
k6 run perf/load-test.js

# dev compose 대상 + 인증 read 엔드포인트 포함
k6 run -e BASE_URL=http://localhost:3006 -e AUTH_TOKEN=demo-token-loadtest perf/load-test.js
```

`package.json` 스크립트로도 실행 가능:

```bash
pnpm perf         # 기본 램프 부하
pnpm perf:smoke   # 스모크
```

## 환경변수

| 변수         | 기본값                  | 설명                                                            |
| ------------ | ----------------------- | --------------------------------------------------------------- |
| `BASE_URL`   | `http://localhost:3001` | 부하 대상 BFF 주소                                              |
| `AUTH_TOKEN` | (없음)                  | Bearer 토큰. dev 는 `demo-token-*`(viewer). 미지정 시 인프라만. |
| `SMOKE`      | (없음)                  | `1` 이면 스모크 시나리오(1 VU, 30초)                            |

## 임계값(thresholds) ↔ 요구사항 매핑

| 요구사항        | k6 threshold        | 초기치                | 비고                     |
| --------------- | ------------------- | --------------------- | ------------------------ |
| NF-13 지연      | `http_req_duration` | p95<500ms, p99<1000ms | 전체 요청                |
| NF-13 read 지연 | `api_read_latency`  | p95<400ms             | 인증 read 엔드포인트     |
| NF-12 신뢰성    | `http_req_failed`   | 실패율<1%             | 429는 예상 응답이라 제외 |
| NF-12 서버실패  | `app_errors`        | 실패율<1%             | 5xx·네트워크 실패만 집계 |
| (정보성)        | `rate_limited`      | 임계값 없음           | 429 비율 — 스로틀 관찰용 |

> ⚠️ **임계값은 실 인프라 SLO 로 보정 대상이다.** 위 값은 단일 노드 BFF + 로컬
> Postgres 기준 초기치다. 정식 NF-12/13 SLO(목표 동시 사용자 수·응답시간 SLA)가
> 확정되면 `perf/load-test.js` 의 `stages` 와 `thresholds` 를 그에 맞춰 갱신한다.

## 측정 결과 (baseline, 2026-07-13)

dev 스택(`kmx-edc-ui-dev-app`, `BASE_URL=http://localhost:3006`, `demo-token` 인증)에서
램프 부하(0→50 VU, 4분)를 실측한 결과 — **전 임계값 통과(k6 exit 0)**:

| 지표                | 결과                              | 판정                 |
| ------------------- | --------------------------------- | -------------------- |
| `checks`            | 100.00% (117,351/117,351)         | ✅                   |
| `http_req_failed`   | 0.00% (0/63,189)                  | ✅                   |
| `app_errors` (5xx)  | **0.00% (0/54,162)**              | ✅ 서버 실패 0건     |
| `http_req_duration` | p95=3.74ms, p99=6.41ms, max=77ms  | ✅ NF-13             |
| `api_read_latency`  | p95=2.71ms, p99=5.04ms            | ✅                   |
| `rate_limited`      | 96.67% (34,908/36,108)            | ℹ️ 설계된 방어(정상) |
| 처리량              | 262 req/s 지속 · 9,027 iterations | —                    |

**해석**

- **NF-13(지연) 충족**: 50 VU·262 req/s 부하에서도 p99 6.41ms. BFF 응답은 매우 빠르다.
- **NF-12(신뢰성) 충족**: 63,189 요청 중 서버 오류(5xx/네트워크) **0건**.
- **레이트리밋 동작 확인**: `/api` 요청의 97%가 429로 스로틀됐다. 50 VU가 모두 동일
  IP(localhost)라 per-IP 버킷(60초/300요청)을 공유하므로 초과분이 429로 거부된 것 —
  **DoS/남용 방어가 설계대로 작동**한 결과이지 결함이 아니다. 무인증 인프라 프로브
  (`/healthz`·`/readyz`·`/metrics`, 레이트리밋 비대상)는 전 부하에서 100% 서빙됐다.
- **한계**: 위 수치는 per-IP 리미터에 의해 상한이 눌린 값이라 백엔드의 진짜 처리량
  천장은 아니다. 실 처리량 측정은 분산 IP(k6 클라우드/여러 load zone) 또는 부하용
  레이트리밋 상향이 필요하다.

## 주의

- 인증 read 부하는 dev 의 `demo-token-*` 폴백에 의존한다(운영 `NODE_ENV=production`
  에서는 동작하지 않음). 운영 유사 부하는 실 로그인으로 발급한 JWT 를 `AUTH_TOKEN` 에
  넣어야 한다.
- `/metrics`·`/healthz`·`/readyz` 는 무인증 인프라 프로브라 인증 없이도 부하 가능하다.
- 부하 테스트는 CI 게이트가 아니다(별도 인프라 필요) — 성능 회귀 점검 시 수동 실행한다.
