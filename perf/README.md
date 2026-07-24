# 부하 테스트 (k6)

BFF 성능·안정성 요구사항 검증용 k6 스크립트. NF-12(처리량/신뢰성)·NF-13(지연)에 대응한다.

## 전제

- [k6](https://k6.io/docs/get-started/installation/) 설치
  - Windows: `winget install k6` 또는 `choco install k6`
  - macOS: `brew install k6`
  - Linux: [공식 저장소](https://k6.io/docs/get-started/installation/) 참고
  - 설치가 여의치 않으면 도커로 실행한다(아래 "도커로 실행" 참고)
- 부하 대상 BFF 가 실행 중이어야 한다(로컬 기본 `http://localhost:3001`,
  dev compose 는 `http://localhost:3006`).

## 실행

```bash
# 스모크(1 VU, 30초) — 배포 파이프라인/사전점검용
k6 run -e SMOKE=1 perf/load-test.js

# 기본 램프 부하(0→50 VU, 총 4분) — NF-12/13 관찰
k6 run perf/load-test.js

# dev compose 대상 (인증 read 는 setup() 로그인으로 자동 포함)
k6 run -e BASE_URL=http://localhost:3006 perf/load-test.js
```

### 도커로 실행 (k6 미설치 시)

```powershell
docker run --rm -i --add-host=host.docker.internal:host-gateway `
  -e BASE_URL=http://host.docker.internal:3006 `
  grafana/k6:latest run - < perf/load-test.js
```

### 레이트리밋 해제 — 앱 경로를 실제로 재려면 필수

k6 는 50 VU 가 전부 같은 IP 라, 기본 한도(300/분)로는 `/api` 요청의 **95% 이상이
429 로 잘린다**. 그 상태의 지연 수치는 앱이 아니라 레이트리밋을 잰 값이므로 성능
회귀를 잡지 못한다. 부하 실행 동안만 한도를 올리고, 끝나면 반드시 되돌린다:

```powershell
# 1) 한도 상향 후 재기동
$env:API_RATE_LIMIT_MAX="200000"; docker compose -f docker-compose.dev.yml up -d app

# 2) 부하 실행 (위 도커 명령)

# 3) 기본값(300)으로 복구 — 빼먹으면 dev 가 무방비로 남는다
Remove-Item Env:API_RATE_LIMIT_MAX; docker compose -f docker-compose.dev.yml up -d app
```

`package.json` 스크립트로도 실행 가능:

```bash
pnpm perf         # 기본 램프 부하
pnpm perf:smoke   # 스모크
```

## 환경변수

| 변수            | 기본값                  | 설명                                                                                     |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `BASE_URL`      | `http://localhost:3001` | 부하 대상 BFF 주소                                                                       |
| `PERF_BPN`      | `BPNLDEMOADMIN`         | `setup()` 로그인 계정. fresh 시드 admin(admin@kmx.io). 커넥터 등록된 스택은 그 BPN 지정. |
| `PERF_PASSWORD` | `0000`                  | 위 계정 비밀번호. dev 시드 기본값 — dev 밖이면 반드시 지정.                              |
| `AUTH_TOKEN`    | (없음)                  | Bearer 토큰. 주면 `setup()` 로그인 대신 이 토큰을 쓴다.                                  |
| `SMOKE`         | (없음)                  | `1` 이면 스모크 시나리오(1 VU, 30초)                                                     |

BFF 측 환경변수(부하 대상 컨테이너에 준다):

| 변수                       | 기본값  | 설명                                            |
| -------------------------- | ------- | ----------------------------------------------- |
| `API_RATE_LIMIT_MAX`       | `300`   | `/api` per-IP 분당 한도. 부하 실행 시에만 상향. |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | 위 한도의 윈도우(ms)                            |

## 임계값(thresholds) ↔ 요구사항 매핑

| 요구사항        | k6 threshold        | 초기치                | 비고                     |
| --------------- | ------------------- | --------------------- | ------------------------ |
| NF-13 지연      | `http_req_duration` | p95<500ms, p99<1000ms | 전체 요청                |
| NF-13 read 지연 | `api_read_latency`  | p95<400ms             | 인증 read 엔드포인트     |
| NF-12 신뢰성    | `http_req_failed`   | 실패율<1%             | 429는 예상 응답이라 제외 |
| NF-12 서버실패  | `app_errors`        | 실패율<1%             | 5xx·네트워크 실패만 집계 |
| (커버리지)      | `api_read_samples`  | count>0               | 인증 read 0회면 실패     |
| (정보성)        | `rate_limited`      | 임계값 없음           | 429 비율 — 스로틀 관찰용 |

> ⚠️ **임계값은 실 인프라 SLO 로 보정 대상이다.** 위 값은 단일 노드 BFF + 로컬
> Postgres 기준 초기치다. 정식 NF-12/13 SLO(목표 동시 사용자 수·응답시간 SLA)가
> 확정되면 `perf/load-test.js` 의 `stages` 와 `thresholds` 를 그에 맞춰 갱신한다.

## 측정 결과

### baseline (2026-07-22) — 레이트리밋 해제, 앱 경로 실측

dev 스택(`BASE_URL=http://localhost:3006`, `API_RATE_LIMIT_MAX=200000`, `setup()` 세션
로그인)에서 램프 부하(0→50 VU, 4분) 실측 — **전 임계값 통과(k6 exit 0)**:

| 지표                | 결과                                | 판정                    |
| ------------------- | ----------------------------------- | ----------------------- |
| `checks`            | 100.00% (110,799/110,799)           | ✅                      |
| `http_req_failed`   | 0.00% (0/59,662)                    | ✅                      |
| `app_errors` (5xx)  | **0.00% (0/51,138)**                | ✅ 서버 실패 0건        |
| `http_req_duration` | p95=32.82ms, p99=64.56ms, max=353ms | ✅ NF-13                |
| `api_read_latency`  | **p95=40.5ms, p99=76.42ms**         | ✅ 실제 앱 read 경로    |
| `api_read_samples`  | 34,092                              | ✅ 커버리지 확보        |
| `rate_limited`      | **0.00% (0/34,092)**                | ✅ 스로틀에 눌리지 않음 |
| 처리량              | 248 req/s 지속 · 8,523 iterations   | —                       |

**해석**

- **NF-13(지연) 충족**: 50 VU·248 req/s 에서 인증 read p95 40.5ms / p99 76.4ms.
  DB 왕복(`/api/connectors`·`/api/fleet/kpi`)을 포함한 값이다.
- **NF-12(신뢰성) 충족**: 59,662 요청 중 서버 오류(5xx/네트워크) **0건**.
- 아래 2026-07-13 측정 대비 지연이 커진 것은 회귀가 아니다. 이전에는 요청의 97%가
  429 로 잘려 리미터 응답(≈3ms)을 재고 있었고, 이번에는 실제 핸들러·DB 경로를
  전부 통과시킨 값이다. **비교 기준선은 이번 값이다.**

### 이전 측정 (2026-07-13) — 레이트리밋에 눌린 값, 참고용

| 지표                | 결과                   |
| ------------------- | ---------------------- |
| `http_req_duration` | p95=3.74ms, p99=6.41ms |
| `api_read_latency`  | p95=2.71ms, p99=5.04ms |
| `rate_limited`      | 96.67% (34,908/36,108) |
| `app_errors`        | 0.00% (0/54,162)       |

`/api` 요청의 97%가 429 로 스로틀됐다. 50 VU 가 모두 동일 IP(localhost)라 per-IP
버킷(60초/300요청)을 공유하므로 초과분이 거부된 것 — **DoS 방어가 설계대로 작동**한
결과이지 결함이 아니다. 다만 그 상태의 지연 수치는 **앱이 아니라 리미터를 잰 값**이라
성능 회귀 탐지에는 쓸 수 없다. 이 한계 때문에 `API_RATE_LIMIT_MAX` 오버라이드와
`api_read_samples` 커버리지 임계값을 도입했다.

### 남은 한계

- 단일 노드·단일 IP 측정이다. 운영 유사 처리량 천장은 분산 IP(k6 클라우드/여러
  load zone)로 per-IP 리미터를 우회해야 나온다.
- 레이트리밋을 끈 상태의 수치이므로, **운영에서 단일 IP 클라이언트가 실제로 낼 수
  있는 처리량은 여전히 300/분으로 제한**된다. 위 248 req/s 는 백엔드 용량이지
  단일 클라이언트가 받을 수 있는 속도가 아니다.

## 주의

- 인증 read 부하는 `setup()` 이 1회 로그인해 받은 httpOnly 세션 쿠키를 전 VU 가
  공유하는 방식이다. VU 마다 로그인하면 bcrypt 검증이 부하의 대부분을 차지하고
  로그인 레이트리밋에도 걸린다.
- k6 의 VU 쿠키 자는 **iteration 시작마다 비워진다**. 그래서 스크립트는 iteration
  마다 쿠키를 다시 주입한다 — VU 당 1회만 넣으면 2번째 iteration 부터 401 이 된다.
- 로그인이 실패하면 인증 read 를 건너뛰는데, 이때 `api_read_samples` 임계값
  (`count>0`)이 실행을 실패시킨다. 인프라 프로브만 통과한 결과가 '부하 통과'로
  오독되지 않게 하기 위함이다.
- `/metrics`·`/healthz`·`/readyz` 는 무인증 인프라 프로브라 인증 없이도 부하 가능하다.
- 부하 테스트는 CI 게이트가 아니다(별도 인프라 필요) — 성능 회귀 점검 시 수동 실행한다.
