# connector-hub (KMX, EDC 0.16.0) 제품화 적대적 정밀검사 (2026-07-01)

14개 차원 병렬 finder → 발견별 2렌즈(mitigation-check / impact) 적대적 refute 검증.
멀티테넌트 격리는 별도 감사·수정 완료(하단 "이미 수정됨" 참조)라 여기서는 제외.

## 수정 진행 현황 (2026-07-01, 순차 진행 중)

**완료·검증(12)**: B1(배포 시크릿 fail-closed, compose+helm) · B2(EDC limit) · H1(잠금 리셋) · H2(비밀번호 변경 엔드포인트) · H3(SSRF redirect 차단) · H5(EDR OOM 상한) · H6(BPN 변경 트랜잭션→커넥터.bpn 전파) · H7(migrateTenants 1회성 마커) · H9(로그인 실패 원인 구분) · HA-1(폴러 advisory-lock 리더선출) · HA-2(SIGTERM 그레이스풀 셧다운) · HA-3(initDb advisory lock). — 각 tsc 통과 + dev 재기동 부팅/엔드포인트 검증.
**남은 High(7)**: H4(DNS 리바인딩 — IP 핀) · H8(테넌트 오프보딩/GDPR) · H10(SlidePanel a11y) · H11(서버 테스트 스위트) · H12(vitest 설정 분리) · AC1(API 버저닝/OpenAPI) · AC2(에러 봉투 통일). 이후 Medium(22)·Low(13).

## 요약

- **원발견 53 → 확정 ~50** (오탐 9 기각): **🔴 Blocker 2 · 🟠 High ~16 · 🟡 Medium ~22 · ⚪ Low ~13**.
- 강한 영역: RBAC(서버측 가드 일관·GA 준비됨) · SQL 주입 방어 · 인증 코어(HS256 pin·약한시크릿 거부·token_version) · 감사 로그 · i18n 사전 패리티.
- 약한 영역: **배포 설정 시크릿 · EDC 페이지네이션 · 데이터 수명주기(오프보딩/GDPR) · 관측성 · 테스트 부재 · HA(멀티레플리카)**.

---

## 🔴 BLOCKER (2)

| #   | 발견                                                                                                                                                | 위치                                                                 | 수정                                                   | 상태                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| B1  | 배포 `docker-compose.yml`/`helm`이 `ALLOW_INSECURE_DEFAULTS=true`+Vault root·dev DB비번·약한 JWT 기본값 내장 → 한 명령으로 안전하지 않은 "프로덕션" | docker-compose.yml:47 · helm/values.yaml:48,74                       | escape hatch·`:-` 기본값 제거, `.env` 필수(`${VAR:?}`) | ✅ 완료(compose+helm 검증)                    |
| B2  | EDC에 QuerySpec `limit` 미전송 → 목록·카운트·KPI·알림폴러가 기본 50개로 조용히 절단(데이터 유실)                                                    | connectors.ts:56 · fleet.ts:19 · edcClient withJsonLd · api.ts(list) | limit 명시 QuerySpec 빌더 통일 + 페이지네이션          | ✅ 완료(limit=1000, 커서 페이지네이션은 후속) |

## 🟠 HIGH (16)

| #   | 차원         | 발견                                                                         | 위치                                         | 수정                                                         | 상태 |
| --- | ------------ | ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ | ---- |
| H1  | authn        | 계정 잠금 카운터가 잠금 만료 후 리셋 안 됨 → 재잠금 루프 + 표적 DoS          | auth.ts:132                                  | 만료된 lock 관측 시 카운터 0 리셋                            | ☐    |
| H2  | authn        | 비밀번호 변경·사용자 관리 화면 전무                                          | auth.ts                                      | `/change-password` + admin 유저 CRUD                         | ☐    |
| H3  | ssrf         | SSRF 가드가 HTTP redirect로 우회 → EDR Bearer 토큰 유출                      | transfers.ts:284,417 · identityHub.ts:85,250 | `maxRedirects:0` + 리다이렉트마다 재검증/Authorization strip | ☐    |
| H4  | ssrf         | 호스트 문자열 검사만 → DNS 리바인딩 미차단                                   | validation.ts:9                              | IP 해석·사설대역 거부·IP 핀                                  | ☐    |
| H5  | resilience   | EDR pull이 응답크기 상한 없는 bare axios → 공유 BFF OOM                      | transfers.ts:284,417                         | `maxContentLength/maxBodyLength` 상한                        | ☐    |
| H6  | data         | 조직 BPN 변경 시 커넥터.bpn 미갱신 → 다음 부팅 고아 테넌트                   | settings.ts:103                              | BPN 변경을 트랜잭션으로 커넥터.bpn까지 전파                  | ☐    |
| H7  | data         | migrateTenants가 매 부팅 커넥터 bpn으로 테넌트 자동생성(고아 공장)           | db.ts:410                                    | 1회성 마이그레이션 마커로 게이트                             | ☐    |
| H8  | data/privacy | 테넌트/사용자 오프보딩·삭제·시크릿 정리 경로 전무(GDPR Art.17)               | settings.ts:66 · db.ts                       | 트랜잭션 오프보딩 루틴 + FK CASCADE + Vault 시크릿 삭제      | ☐    |
| H9  | frontend     | 로그인이 모든 실패(네트워크/500)를 "비밀번호 틀림"으로 표시                  | AuthContext.tsx:118                          | 에러 유형 판별(401/429/5xx/네트워크) 메시지 분기             | ☐    |
| H10 | a11y         | 주 편집 UI SlidePanel(8페이지)이 dialog 시맨틱·포커스트랩·복원·스크롤락 없음 | DetailDeleteDialogs.tsx:627                  | Radix Dialog 경유 또는 role/aria/focus-trap/scroll-lock 추가 | ☐    |
| H11 | testing      | 서버/통합/E2E 테스트 0 — 격리·crypto·인증·마이그레이션 무방비                | server/lib                                   | supertest + testcontainers 2-테넌트 격리·인증·crypto 스위트  | ☐    |
| H12 | testing      | Vitest `root`가 client/ 고정 → 서버 테스트 탐지 불가                         | vite.config.ts:21                            | vitest.config 분리(server=node, client=jsdom)                | ☐    |
| HA1 | deploy       | 알림 폴러가 모든 레플리카에서 실행 → N배 EDC 폴링                            | index.ts:205                                 | 단일 레플리카 격리(별도 Deploy/advisory lock/env flag)       | ☐    |
| HA2 | deploy       | SIGTERM 그레이스풀 셧다운 없음 → 롤아웃마다 502                              | index.ts:197                                 | SIGTERM→server.close/stopPoller/closeDb + preStop            | ☐    |
| AC1 | api          | API 버저닝·OpenAPI 전무 → breaking-change 무한 표면                          | index.ts:152                                 | `/api/v1` + OpenAPI 스펙 + CI 계약 diff                      | ☐    |
| AC2 | api          | 에러 응답 봉투 5종 이상 비일관 → 클라 파싱 불가                              | errorHandler.ts                              | `{error:{code,message,details?}}` 단일 봉투로 통일           | ☐    |

## 🟡 MEDIUM (22)

| 차원          | 발견                                                                                                               | 위치                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| authn         | JWT sessionStorage 12h·리프레시 없음(XSS 시 12h 탈취)                                                              | api.ts:28                        |
| secrets       | CSP object-src/form-action/frame-src 누락                                                                          | index.ts:104                     |
| secrets       | trust-proxy 기본값에서 레이트리미터가 전역 단일 버킷                                                               | rateLimit.ts                     |
| resilience    | DtrApiError가 503→500로 격하 + detail 소실                                                                         | errorHandler.ts:28               |
| resilience    | decryptSecret 실패가 전 커넥터 목록 500(키 회전/복원 시)                                                           | crypto.ts:56                     |
| data          | transfer/negotiation_metadata FK 없음 → 커넥터 삭제 시 고아                                                        | db.ts:100,133                    |
| data          | 서버 전체 트랜잭션 0 → 부분쓰기                                                                                    | (전역)                           |
| deploy        | initDb 마이그레이션 동시실행 advisory lock 없음 → ⚠️멀티레플리카 콜드스타트 시 dup-BPN 가드가 두 레플리카 부팅거부 | index.ts:56                      |
| deploy        | readiness가 마이그레이션 완료와 무관                                                                               | index.ts:116                     |
| observability | HTTP 액세스 로그·상관 ID 없음                                                                                      | index.ts:127                     |
| observability | 비정형 console 로깅(JSON/레벨/상관ID 없음)                                                                         | audit.ts:361                     |
| observability | 메트릭/에러트래킹 없음                                                                                             | index.ts:205                     |
| performance   | transfer/negotiation_metadata connector_id 인덱스 없음 → seq-scan                                                  | db.ts:114                        |
| performance   | 커넥션풀 max:10 고정                                                                                               | db.ts:27                         |
| i18n          | 타임스탬프 ko-KR 하드코딩(전 로케일)                                                                               | edcClient.ts:606                 |
| i18n          | `<html lang>` 항상 ko(WCAG 3.1.1)                                                                                  | App.tsx:331                      |
| i18n          | 정책빌더 라벨/오퍼레이터 한국어 하드코딩                                                                           | PagePolicy.tsx:1671              |
| quality       | ESLint 없음(disable 주석만 존재)                                                                                   | package.json                     |
| quality       | 부팅 DDL 마이그레이션 버전테이블/롤백/테스트 없음                                                                  | db.ts:64                         |
| quality       | 커버리지 측정 없음                                                                                                 | package.json:8                   |
| privacy       | field_history 시간기반 보존 없음(무한 증가)                                                                        | fieldHistory.ts:61               |
| privacy       | notifications 보존 prune 없음                                                                                      | db.ts:175                        |
| privacy       | 감사 PII 대상별 삭제 불가(시간기반만)                                                                              | audit.ts:431                     |
| api           | 목록이 POST + 3가지 형(array/`{items,total}`/`{items,cursor}`) 페이지네이션 계약 없음                              | api.ts(list)                     |
| api           | 업스트림 다운 상태코드 502 vs 503 불일치                                                                           | connectors.ts:305 vs vault.ts:97 |

## ⚪ LOW (13)

| 차원          | 발견                                                                        | 위치                   |
| ------------- | --------------------------------------------------------------------------- | ---------------------- |
| authz         | 알림 mark-read가 viewer UI에 노출되나 서버 403(사일런트 실패)               | notificationsUi.ts:134 |
| observability | 감사 쓰기 실패 무알림(swallow)                                              | audit.ts:360           |
| performance   | 협상/전송 업서트 루프 per-row 왕복(N쿼리)                                   | negotiations.ts:77     |
| performance   | 대시보드/EDR/플릿 폴링이 탭당 EDC 팬아웃                                    | PageDashboard.tsx:71   |
| frontend      | 401 만료 토스트 중복 폭주(dedup 없음)                                       | api.ts:81              |
| frontend      | catch-all이 잘못된 URL 유지(404 상태 없음)                                  | App.tsx:199            |
| frontend      | 딥링크 콜드로드 실패 시 빈 화면 stuck(ConnectorSync isError 미처리)         | queryClient.ts:9       |
| a11y          | 로그인 라벨 htmlFor 누락                                                    | PageLogin.tsx:63       |
| a11y          | skip-to-content 링크 없음                                                   | App.tsx:282            |
| privacy       | in-product 시크릿 회전 없음                                                 | vault.ts:17            |
| deploy        | 레이트리미터 레플리카별 → 실효 한도 ×레플리카(계정잠금은 DB기반이라 커버됨) | rateLimit.ts:19        |
| api           | "테넌트 없음"이 3가지 결과(403/403/200빈)                                   | semantics.ts:112       |
| api           | 요청ID/상관ID 에코 없음                                                     | index.ts:85            |

---

## 이미 수정됨 (별도 격리 감사, 2026-07-01)

- ✅ IdentityHub API키 Vault 별칭 BPN→불변 tenantId (identityHubConfig.ts·settings.ts)
- ✅ vault.ts /list·/meta 본인 테넌트 스코프
- ✅ 중복 BPN fail-closed 부팅 (db.ts) — _단, HA-3(멀티레플리카 동시 init)와 상호작용 주의_
- ✅ 카탈로그 최근기록 localStorage 로그아웃 정리 (recentCatalog.ts·AuthContext)
- ✅ IdentityHub·Vault 설정 카드 읽기전용 (PageSettings)
- ✅ 조직 BPN 카드 읽기전용

## 권장 착수 순서

B1 → B2 → H1 → H3/H5 → H6/H7/HA-3 → HA-2 → H8/H11-H12 → 나머지 Medium/Low.
