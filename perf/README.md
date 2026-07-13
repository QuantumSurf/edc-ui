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

| 요구사항        | k6 threshold                    | 초기치                |
| --------------- | ------------------------------- | --------------------- |
| NF-13 지연      | `http_req_duration`             | p95<500ms, p99<1000ms |
| NF-13 read 지연 | `api_read_latency`              | p95<400ms             |
| NF-12 신뢰성    | `http_req_failed`, `app_errors` | 실패율<1%             |
| 검증 통과율     | `checks`                        | >99%                  |

> ⚠️ **임계값은 실 인프라 SLO 로 보정 대상이다.** 위 값은 단일 노드 BFF + 로컬
> Postgres 기준 초기치다. 정식 NF-12/13 SLO(목표 동시 사용자 수·응답시간 SLA)가
> 확정되면 `perf/load-test.js` 의 `stages` 와 `thresholds` 를 그에 맞춰 갱신한다.

## 주의

- 인증 read 부하는 dev 의 `demo-token-*` 폴백에 의존한다(운영 `NODE_ENV=production`
  에서는 동작하지 않음). 운영 유사 부하는 실 로그인으로 발급한 JWT 를 `AUTH_TOKEN` 에
  넣어야 한다.
- `/metrics`·`/healthz`·`/readyz` 는 무인증 인프라 프로브라 인증 없이도 부하 가능하다.
- 부하 테스트는 CI 게이트가 아니다(별도 인프라 필요) — 성능 회귀 점검 시 수동 실행한다.
