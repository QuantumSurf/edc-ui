# Connector Hub (KMX EDC UI)

**EDC(Eclipse Dataspace Connector) 멀티테넌트 플릿 관리 콘솔** — 단일 UI로 커넥터 등록부터
자산 제공, 데이터 교환, 디지털 트윈, 시스템 운영까지 묶는 데이터스페이스(Catena-X 계열) 운영 도구.

React 19 SPA + Express BFF(Backend-for-Frontend) 구조로, BFF가 EDC Management API·DTR·IdentityHub·Vault를
프록시하고 인증·멀티테넌트 격리·감사·알림을 담당한다.

---

## 주요 기능

- **커넥터 플릿** — 커넥터 등록/수정/삭제, 라이브 상태(up/warn/down)·리소스 카운트 집계
- **자산 제공** — 자산(Asset) → 정책(ODRL Policy) → 계약(Offering/Contract Definition)
- **데이터 교환** — 카탈로그 조회(Catalog) → 계약 협상(Negotiation) → 데이터 전송(Transfer) → EDR(접근 토큰) 관리
- **디지털 트윈** — Tractus-X DTR 쉘 디스크립터·서브모델, SAMM 시맨틱 모델(로컬 CRUD)
- **시스템** — Platform Vault·IdentityHub(분산신원/DID) 상태, 플랫폼 인프라(PostgreSQL) 진단, 감사 로그
- **알림** — 협상 종료·전송 완료/실패·EDR/VC 만료·커넥터 헬스 이벤트를 백그라운드 폴러가 감지, 슬라이드 패널로 표시
- **멀티테넌트 SaaS** — 단일 서버에서 조직(BPN)별 데이터 격리, RBAC(admin/operator/viewer)
- **i18n** — 한국어/영어 전 화면, 반응형(좁은 화면에서 중요 컬럼만 표시), 라이트/다크 테마

## 기술 스택

| 영역 | 스택 |
|---|---|
| 프런트엔드 | React 19 · Vite 7 · Tailwind CSS v4(@theme, oklch 토큰) · TanStack Query · Zustand · wouter · Recharts |
| BFF | Express 4 · TypeScript(ESM) · pg(PostgreSQL) · jsonwebtoken · bcryptjs · prom-client |
| 인증 | JWT httpOnly 쿠키 + 이중제출 CSRF · bcrypt · token_version 세션 무효화 |
| 빌드/런타임 | esbuild(서버 번들) · Node.js · Docker · Helm |
| 테스트 | Vitest(client jsdom / server node) · Testcontainers(통합) |

## 빠른 실행

### 요구사항

- Node.js ≥ 20, [pnpm](https://pnpm.io) 10.x, Docker (dev·통합테스트)

### 로컬 개발 (Docker 권장 — bind-mount + HMR)

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d app
```

- **UI**: http://localhost:3005 (Vite dev, HMR)
- **BFF**: http://localhost:3006 (디버깅용 직접 접근 — `/api`, `/healthz`, `/readyz`, `/metrics`)
- **Postgres**: localhost:5434 (`kmx` / 기본 `kmx_dev_123`, DB `kmx_edc`)
- 업스트림 EDC는 `dev-mock/edc-mock.cjs`(캔드 응답)로 대체된다.
- 초기 시드 계정: BPN `BPNL000000000PRD`(admin) / `BPNL000000000CON`(operator), 비밀번호 `0000`
  (env `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` 로 재정의 가능. 프로덕션은 약한 기본값 거부).

서버 코드 변경 시:

```powershell
docker compose -f docker-compose.dev.yml restart app
```

### 프로덕션 (Docker Compose)

```bash
docker compose up -d          # app → http://localhost:3003, PostgreSQL 포함
```

### 빌드 / 직접 실행

```bash
pnpm build      # vite build(client) + esbuild(server → dist/index.js, dist/scripts/offboardTenant.js)
pnpm start      # NODE_ENV=production node dist/index.js  (기본 PORT 3001)
```

Kubernetes 배포는 [`helm/`](helm/) 차트를 참고한다.

## 폴더 구조

```
client/            React SPA (Vite root)
  src/components/    ui-kmx.tsx(공용 프리미티브)·AppSidebar·Topbar·NotificationPanel 등
  src/pages/         Fleet·Assets·Policy·Offering·Catalog·Negotiation·Transfer·EDR·
                     Shells·Submodels·Vault·Infra·IdentityHub·Audit·Settings·Dashboard
  src/services/      BFF API 클라이언트(axios, withCredentials + CSRF)
  src/i18n/          ko.ts / en.ts (파리티는 tsc + 테스트로 강제)
  src/contexts/      AuthContext(쿠키 세션) · ThemeContext
  src/stores/        Zustand (connectorStore · notificationStore)
server/            Express BFF
  app.ts             buildApp() — 미들웨어·라우트 조립(통합테스트와 공유)
  index.ts           부트스트랩(initDb → listen → 폴러 → graceful shutdown)
  routes/            /api/* 라우트(connectors·assets·… ·auth·audit·notifications)
  middleware/        auth(쿠키/Bearer) · csrf · tenant(소유권 격리) · rateLimit · requestLog
  lib/               db(스키마·마이그레이션·시드) · auth · cookies · edcClient · tenants · audit 등
  scripts/           offboardTenant.ts (테넌트 오프보딩 CLI)
  test/integration/  testcontainers 기반 멀티테넌트 격리 통합테스트
dev-mock/          개발용 EDC Management API 목(edc-mock.cjs)
helm/              Kubernetes Helm 차트
docker-compose.dev.yml / docker-compose.yml / Dockerfile
```

## 인증 · 멀티테넌트

- **세션**: 로그인 시 JWT를 `httpOnly` 쿠키(`kmx_token`, SameSite=Strict, prod Secure)로 발급 —
  XSS 토큰 탈취를 차단한다. 응답 본문에 토큰을 노출하지 않는다.
- **CSRF**: 이중제출(double-submit) — 쿠키 세션의 변이 요청은 `X-CSRF-Token` 헤더가 `kmx_csrf` 쿠키와
  일치해야 한다(로그인은 예외).
- **RBAC**: `admin` / `operator` / `viewer`. 커넥터 하위 라우트는 `requireConnectorOwnership`로
  테넌트 소유권을 강제(교차테넌트는 404).
- **테넌트 오프보딩**: 소프트삭제(아카이브)로 로그인·세션을 즉시 차단하고, 보존기간(기본 30일) 경과 후
  CLI로 하드삭제한다.

```bash
node dist/scripts/offboardTenant.js list                  # 테넌트 목록/상태
node dist/scripts/offboardTenant.js archive <BPN>         # 아카이브(복구 가능)
node dist/scripts/offboardTenant.js restore <BPN>         # 아카이브 해제
node dist/scripts/offboardTenant.js purge --days 30 --force  # 보존기간 초과분 하드삭제(기본 dry-run)
```

## 테스트

```bash
pnpm check              # 타입체크 (tsc --noEmit)
pnpm lint               # ESLint 9 (flat config)
pnpm test               # 단위 테스트 (client jsdom + server node)
pnpm test:integration   # 통합 테스트 (Testcontainers Postgres — Docker 필요)
pnpm test:coverage      # 커버리지
pnpm format             # Prettier
```

## API 문서

BFF API 계약은 OpenAPI 3.1 스펙 [`docs/openapi.yaml`](docs/openapi.yaml) 에 기술돼 있다
(인증 쿠키/CSRF, 에러 봉투, RBAC, 커넥터·자산·정책·협상·전송·DTR 등 전 엔드포인트).

```bash
# 유효성 검사 / 로컬 뷰어
npx @redocly/cli lint docs/openapi.yaml       # 검증
npx @redocly/cli preview-docs docs/openapi.yaml
```

> 소스 오브 트루스는 `server/routes/*.ts` 코드다. 스펙과 코드가 어긋나면 코드를 따르고
> 이 문서를 갱신한다. EDC/DTR 프록시 응답은 상류 JSON 을 그대로 전달하므로 스펙에서
> 일반 object 로 모델링한다.

## 환경변수 (주요)

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 접속 문자열 (필수) |
| `JWT_SECRET` | JWT 서명 비밀 — 프로덕션 필수, 최소 32자(약한 공개 기본값 거부) |
| `JWT_EXPIRES_IN` | 토큰 만료(기본 `12h`) |
| `SEED_ADMIN_PASSWORD` / `SEED_OPERATOR_PASSWORD` | 초기 시드 계정 비밀번호(프로덕션은 강한 값 필수) |
| `TRUST_PROXY` | 리버스 프록시 홉 수(rate limit이 클라 IP 기준으로 동작하도록) |
| `HUB_APIKEY_SECRET` | 커넥터 API 키 저장(AES-256-GCM) 암호화 키 |
| `DB_POOL_MAX` | DB 커넥션 풀 상한(기본 20) |
| `OFFBOARD_RETENTION_DAYS` | 테넌트 아카이브→퍼지 보존기간(기본 30) |
| `DISPLAY_TZ` | 날짜 표시 타임존(기본 `Asia/Seoul`) |
| `IDENTITY_HUB_URL` / `DTR_BASE_URL` | 공유 IdentityHub·DTR 엔드포인트 |

관측성: `/metrics`(Prometheus, 무인증·`/api` 밖), `/healthz`(liveness), `/readyz`(readiness + 스키마 게이팅).

## 라이선스

[Apache License 2.0](LICENSE) — Copyright 2026 QuantumSurf. [`NOTICE`](NOTICE) 참고.

## 기여

- 커밋 메시지: `#{이슈} {type} : {설명}` (한국어). type: feat/fix/refactor/style/docs/test/chore/perf.
- 변경 전 `pnpm check`·`pnpm test` 통과, 구조 변경과 기능 변경은 별도 커밋으로 분리.
