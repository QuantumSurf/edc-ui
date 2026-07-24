# Keycloak SSO 통합 가이드

Connector Hub 로그인에 회사 Keycloak 을 붙이는 절차. **코드 수정은 필요 없다** —
Keycloak 쪽 설정과 env 값만 채우면 된다. 연동 코드는 이미 들어 있다:

- 서버: `server/lib/oidc.ts`(discovery/JWKS/PKCE/클레임 매핑), `server/routes/authOidc.ts`(status/login/callback)
- 클라: 로그인 화면이 `GET /api/auth/oidc/status` 로 활성 여부를 물어 SSO 버튼을 노출
- 부팅: `OIDC_ENABLED=true` 인데 필수 env 가 비면 **부팅이 실패**한다(반쪽 배포 방지)

## 아키텍처 (무엇이 바뀌고 무엇이 안 바뀌나)

```
[브라우저] → GET /api/auth/oidc/login → 302 Keycloak authorize (state+nonce+PKCE)
[Keycloak] 로그인/동의 → 302 /api/auth/oidc/callback?code=...&state=...
[BFF] code 교환(confidential+PKCE) → ID 토큰 JWKS 검증(iss/aud/exp/nonce)
      → 클레임 매핑(email·bpn·role) → 테넌트/사용자 매핑
      → 기존과 동일한 세션 발급(kmx_token httpOnly + kmx_csrf) → 302 /
```

**로그인 단계만** Keycloak 으로 위임한다. 세션(JWT 쿠키)·CSRF·RBAC·테넌트 격리·
감사 로그·token_version 무효화(로그아웃)는 전부 기존 그대로다. 즉 SSO 로그인 후의
모든 API 동작은 비밀번호 로그인과 완전히 동일하다.

## 1. Keycloak 클라이언트 생성

대상 realm 에서 Clients → Create client:

| 항목                  | 값                                                                             |
| --------------------- | ------------------------------------------------------------------------------ |
| Client type           | OpenID Connect                                                                 |
| Client ID             | `kmx-console` (자유 — env 와 일치만 하면 됨)                                   |
| Client authentication | **On** (confidential)                                                          |
| Standard flow         | **On** (Authorization Code)                                                    |
| Direct access grants  | Off (권장)                                                                     |
| Valid redirect URIs   | `https://<콘솔 호스트>/api/auth/oidc/callback` (정확히 한 개, 와일드카드 금지) |
| Web origins           | `https://<콘솔 호스트>`                                                        |

생성 후 Credentials 탭의 **Client secret** 을 확보한다.

> PKCE(S256)는 콘솔이 항상 보낸다. Keycloak 클라이언트의
> Advanced → _Proof Key for Code Exchange Code Challenge Method_ 를 `S256` 으로
> 고정하면 더 좋다(강제).

## 2. BPN 클레임 매퍼 (테넌트 매핑 — 필수)

콘솔은 ID 토큰의 **`bpn` 클레임으로 테넌트를 찾는다**(콘솔의 테넌트 = 조직 BPN).
사용자(또는 그룹/조직)에 BPN 을 실어 보내야 한다.

가장 단순한 방법 — 사용자 attribute 기반:

1. 사용자(또는 그룹)에 attribute 추가: `bpn` = `BPNL...` (콘솔 테넌트의 BPN 과 일치)
2. Client scopes → (클라이언트 전용 dedicated scope) → Add mapper → **User Attribute**
   - User Attribute: `bpn`
   - Token Claim Name: `bpn`
   - Add to ID token: **On**

클레임 이름을 다르게 쓰고 싶으면 env `OIDC_BPN_CLAIM` 으로 바꾼다
(점 경로 지원 — 예: `org.bpn`).

## 3. 역할 매핑 (필수)

콘솔 역할은 admin / operator / viewer 3종. 기본 매핑은 **realm 역할**:

1. Realm roles 에 `kmx-admin` · `kmx-operator` · `kmx-viewer` 생성
2. 사용자/그룹에 배정

콘솔은 ID 토큰의 `realm_access.roles` 배열에서 위 이름을 찾는다
(admin > operator > viewer 우선). 매핑되는 역할이 하나도 없으면 로그인 거부
(`no-role`) — 최소권한 기본.

다른 역할 체계를 쓰면 env 로 재지정:

- `OIDC_ROLE_CLAIM` — 점 경로(예: 클라이언트 역할이면
  `resource_access.kmx-console.roles`)
- `OIDC_ROLE_ADMIN` / `OIDC_ROLE_OPERATOR` / `OIDC_ROLE_VIEWER` — 역할 이름

> 역할은 **IdP 가 정본**이다: SSO 로그인 때마다 콘솔 로컬 role 을 Keycloak 값으로
> 동기화한다.

## 4. env 설정

| env                               | 필수 | 설명                                                                  |
| --------------------------------- | ---- | --------------------------------------------------------------------- |
| `OIDC_ENABLED`                    | ✔   | `true` 로 활성. 비면 SSO 완전 비활성(버튼 미노출)                     |
| `OIDC_ISSUER_URL`                 | ✔   | `https://<keycloak>/realms/<realm>` (뒤 슬래시 없이)                  |
| `OIDC_CLIENT_ID`                  | ✔   | 1단계 클라이언트 ID                                                   |
| `OIDC_CLIENT_SECRET`              | ✔   | 1단계 client secret (**시크릿 — 커밋 금지**)                          |
| `OIDC_REDIRECT_URL`               | ✔   | `https://<콘솔>/api/auth/oidc/callback` — Keycloak 등록값과 완전 일치 |
| `OIDC_SCOPES`                     |      | 기본 `openid profile email`                                           |
| `OIDC_BPN_CLAIM`                  |      | 기본 `bpn`                                                            |
| `OIDC_ROLE_CLAIM`                 |      | 기본 `realm_access.roles`                                             |
| `OIDC_ROLE_ADMIN/OPERATOR/VIEWER` |      | 기본 `kmx-admin`/`kmx-operator`/`kmx-viewer`                          |
| `OIDC_AUTO_PROVISION`             |      | 기본 `false`. `true` 면 테넌트 매핑에 성공한 신규 사용자를 자동 생성  |

- **Helm**: `values.yaml` 의 `oidc:` 블록 + `secrets.oidcClientSecret`
  (`oidc.enabled=true` 인데 시크릿이 비면 `helm install` 이 즉시 실패한다).
- **dev compose**: `docker-compose.dev.yml` 의 주석 처리된 OIDC\_\* 블록 참고.

## 5. 사용자 프로비저닝 정책

- 기본(`OIDC_AUTO_PROVISION=false`): 콘솔 DB 에 **이메일이 같은 사용자가 미리
  존재해야** 로그인된다(없으면 `user-not-provisioned` 거부). 역할/이름은 로그인
  시 IdP 값으로 동기화.
- `true`: BPN→테넌트 매핑에 성공하면 사용자를 자동 생성한다. 생성되는 사용자의
  비밀번호는 로그인 불가능한 랜덤 해시라 **SSO 로만** 들어올 수 있다.
- 같은 이메일이 **다른 테넌트**에 이미 속해 있으면 항상 거부(`tenant-mismatch`)
  — 테넌트 격리 불변식 보호.

## 6. 로컬 검증 (회사 IdP 없이)

```powershell
# 1) 로컬 Keycloak
docker run -d --name kc-local -p 8085:8080 `
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin `
  quay.io/keycloak/keycloak:26.0 start-dev

# 2) http://localhost:8085 접속 → realm `kmx` 생성 → 위 1~3단계 수행
#    (redirect URI 는 http://localhost:3005/api/auth/oidc/callback)
#    테스트 사용자: attribute bpn=BPNL000000000PRD, 역할 kmx-admin, 이메일 설정

# 3) docker-compose.dev.yml 의 OIDC_* 주석 해제·값 입력 후
docker compose -f docker-compose.dev.yml up -d app

# 4) http://localhost:3005 → "Keycloak SSO 로그인" 버튼 → Keycloak 로그인 → 콘솔 진입
```

## 7. 트러블슈팅

로그인 실패 시 로그인 화면 상단에 `sso_error` 코드가 표기된다:

| 코드                   | 원인                                      | 조치                                                                                          |
| ---------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `idp-error`            | IdP 가 에러 반환(사용자 취소 포함)        | Keycloak 로그 확인                                                                            |
| `state-mismatch`       | 흐름 만료(10분)/재사용/쿠키 차단          | 재시도. 프록시가 쿠키를 지우는지 확인                                                         |
| `no-id-token`          | 토큰 응답에 id_token 없음                 | 클라이언트 Standard flow·scope `openid` 확인                                                  |
| `verify-failed`        | 서명/iss/aud/nonce 검증 실패              | `OIDC_ISSUER_URL` 이 토큰 iss 와 정확히 같은지(내부/외부 URL 불일치가 단골), 서버 시각 동기화 |
| `no-email`             | 이메일 클레임 없음                        | 사용자 이메일 설정, scope `email`                                                             |
| `no-bpn`               | BPN 클레임 없음                           | 2단계 매퍼 확인(ID token 에 포함되는지)                                                       |
| `no-role`              | 매핑 역할 없음                            | 3단계 역할 배정/이름 확인                                                                     |
| `unknown-tenant`       | BPN 에 해당하는 콘솔 테넌트 없음/아카이브 | 콘솔 테넌트 BPN 과 attribute 값 대조                                                          |
| `tenant-mismatch`      | 이메일이 다른 테넌트 소속                 | 5단계 참조                                                                                    |
| `user-not-provisioned` | 사전 등록 사용자 없음(자동 생성 off)      | 사용자 생성 또는 `OIDC_AUTO_PROVISION=true`                                                   |

자주 걸리는 것:

- **iss 불일치**: 쿠버네티스 내부에서 Keycloak 을 내부 서비스 URL 로 부르면
  discovery/토큰의 `iss` 는 외부 URL 이라 검증이 깨진다. `OIDC_ISSUER_URL` 은
  **브라우저가 보는 것과 같은 외부 URL** 로 두고, Keycloak 의 frontendUrl 을 고정하라.
- **리버스 프록시**: `/api/auth/oidc/*` 경로가 BFF 로 그대로 프록시되는지,
  `Set-Cookie` 가 제거되지 않는지 확인.
- 만료 이슈: state 쿠키 TTL 은 10분 — IdP 화면에서 10분 이상 머물면 `state-mismatch`.
