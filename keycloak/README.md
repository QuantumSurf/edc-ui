# Keycloak import 파일

Connector Hub(edc-ui) SSO 용 Keycloak 설정을 JSON import 로 재현한다.
수동 절차·배경은 [docs/KEYCLOAK.md](../docs/KEYCLOAK.md) 참조 — 이 디렉토리는 그 절차의 자동화다.

| 파일                          | 용도                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `realm-import/kmx-realm.json` | **로컬 검증용 전체 realm**(`kmx`). 서버 기동 시 `--import-realm` 으로 자동 등록              |
| `kmx-console-client.json`     | **기존(운영) realm 에 클라이언트만 반입**. Admin Console → Clients → Import client 에 업로드 |

> qx-portal 공유 realm(`qx-central`)에 붙일 때는 규약이 미리 반영된
> [docs/keycloak/kmx-console-qx-central.json](../docs/keycloak/kmx-console-qx-central.json)
> 을 쓰라 — 절차는 docs/KEYCLOAK.md 부록.

두 파일 모두 클라이언트에 다음이 미리 들어 있다:

- Authorization Code + confidential + **PKCE S256 강제**, Direct access grants Off
- `bpn` 매퍼 — 사용자 attribute `bpn` → ID 토큰 클레임 `bpn` (테넌트 매핑, KEYCLOAK.md 2단계)
- **realm 역할 → ID 토큰 매퍼** — Keycloak 기본은 realm 역할을 access token 에만 싣기 때문에,
  이 매퍼가 없으면 콘솔(BFF 는 ID 토큰만 검증)이 `no-role` 로 로그인을 거부한다

## 1) 로컬 검증 — realm 자동 import

레포 루트에서:

```powershell
docker run -d --name kc-local -p 8085:8080 `
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin `
  -v "${PWD}\keycloak\realm-import:/opt/keycloak/data/import:ro" `
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm
```

realm `kmx` 가 다음 상태로 만들어진다 (docs/KEYCLOAK.md 1~3단계 + 테스트 사용자 완료 상태):

- 클라이언트 `kmx-console` — secret 기본값 `kmx-console-dev-secret`(dev 전용),
  redirect `http://localhost:3005/api/auth/oidc/callback`
- realm 역할 `kmx-admin` · `kmx-operator` · `kmx-viewer`
- 사용자 `admin@kmx.io`(kmx-admin) · `operator@kmx.io`(kmx-operator) — 비번 `0000`,
  attribute `bpn=BPNL000000000PRD` (dev 시드 계정·테넌트와 일치 → 콘솔 로그인 즉시 성공)

이후 `docker-compose.dev.yml` 의 OIDC\_\* 블록을 해제하고 `OIDC_CLIENT_SECRET=kmx-console-dev-secret`
을 넣으면 끝(전체 절차는 docs/KEYCLOAK.md 6장).

포트·주소·시크릿은 env 플레이스홀더로 바꿀 수 있다(파일 수정 불필요, `docker run -e` 로 주입):

| env                         | 기본값                   | 쓰임                                    |
| --------------------------- | ------------------------ | --------------------------------------- |
| `KMX_CONSOLE_URL`           | `http://localhost:3005`  | redirect URI / web origins / 로그아웃   |
| `KMX_CONSOLE_CLIENT_SECRET` | `kmx-console-dev-secret` | 클라이언트 secret (**dev 전용 기본값**) |
| `KMX_SSL_REQUIRED`          | `external`               | 로컬 http 허용(loopback), 그 외 https   |

> 기본 secret·비번(0000)은 로컬 데모 전용이다. 외부에 노출되는 환경이면 반드시 override 하라.

## 2) 운영 반입 — 클라이언트만 import

회사 Keycloak 의 대상 realm 에서:

1. Clients → **Import client** → `kmx-console-client.json` 업로드
2. `redirectUris` / `webOrigins` / `post.logout.redirect.uris` 의
   `https://kmx-console.example.com` 을 실제 콘솔 호스트로 교체(입력 화면에서 수정 가능)
3. Credentials 탭에서 생성된 **Client secret** 확보 → 콘솔 env `OIDC_CLIENT_SECRET`
   (파일에 secret 을 넣지 않았으므로 Keycloak 이 새로 생성한다)
4. realm 역할 `kmx-admin` · `kmx-operator` · `kmx-viewer` 생성 후 사용자/그룹에 배정
   — 역할·사용자는 client import 에 포함되지 않는다(KEYCLOAK.md 3단계)
5. 사용자(또는 그룹)에 attribute `bpn=<콘솔 테넌트 BPN>` 설정(KEYCLOAK.md 2단계)

콘솔 env 설정(4단계)은 docs/KEYCLOAK.md 4장 표를 그대로 따른다.
