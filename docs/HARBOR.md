# Harbor(kmx) 이미지·차트 발행 런북

connector-hub(kmx-edc-ui)의 컨테이너 이미지와 Helm 차트를 사내 Harbor
(`harbor.quantum-x.co.kr`)의 **kmx** 프로젝트로 올리는 절차. 실제 클러스터 배포
(`helm upgrade`)는 이 문서 범위 밖이며 운영 담당이 수행한다.

| 산출물    | 위치                                                 |
| --------- | ---------------------------------------------------- |
| 이미지    | `harbor.quantum-x.co.kr/kmx/edc-ui:<tag>`            |
| Helm 차트 | `oci://harbor.quantum-x.co.kr/kmx/charts/kmx-edc-ui` |

## 1. 이미지 발행

### CI 자동(권장)

`main` 푸시마다 `.github/workflows/ci.yml`의 `docker` 잡이 Harbor로 발행한다. 단,
아래 GitHub Actions 시크릿이 있어야 켜진다(없으면 잡은 **건너뛰고 green** 유지):

| 시크릿            | 설명                            |
| ----------------- | ------------------------------- |
| `HARBOR_USERNAME` | Harbor 로봇계정 이름(`robot$…`) |
| `HARBOR_PASSWORD` | 로봇계정 토큰                   |

로봇계정은 Harbor → kmx 프로젝트 → Robot Accounts 에서 `push`/`pull` 권한으로 발급한다.
태그는 커밋 sha(불변)와 `latest`(가변) 두 가지가 붙는다.

### 로컬 수동

```powershell
# git short sha 태그로 이미지 + 차트를 함께 발행
pwsh ./scripts/publish-harbor.ps1

# 특정 태그 지정
pwsh ./scripts/publish-harbor.ps1 -Tag v1.0.0
```

수동으로 이미지만 올릴 때:

```powershell
docker login harbor.quantum-x.co.kr
docker build -t harbor.quantum-x.co.kr/kmx/edc-ui:$(git rev-parse --short HEAD) .
docker push harbor.quantum-x.co.kr/kmx/edc-ui:$(git rev-parse --short HEAD)
```

## 2. Helm 차트 발행(OCI)

```powershell
helm registry login harbor.quantum-x.co.kr
helm dependency update ./helm/kmx-edc-ui   # postgresql 서브차트 fetch
helm package ./helm/kmx-edc-ui -d ./dist
helm push ./dist/kmx-edc-ui-0.1.0.tgz oci://harbor.quantum-x.co.kr/kmx/charts
```

차트를 새로 발행할 때는 `helm/kmx-edc-ui/Chart.yaml`의 `version`을 먼저 올린다(같은
버전 재푸시는 이미 존재하는 아티팩트라 혼란을 준다).

## 3. 배포 측 전제 — imagePullSecret

Harbor(kmx)는 사설 레지스트리라 노드가 이미지를 pull 하려면 배포 네임스페이스에
dockerconfigjson 시크릿이 있어야 한다. `values.yaml`의 `imagePullSecrets` 기본값은
`harbor-quantum-x` 이며, 아래처럼 미리 생성한다(자격값은 리포에 커밋 금지):

```bash
kubectl create secret docker-registry harbor-quantum-x \
  --docker-server=harbor.quantum-x.co.kr \
  --docker-username='robot$kmx+deploy' \
  --docker-password='<robot-token>' \
  -n <namespace>
```

## 4. 발행 후 배포(운영 담당)

```bash
helm upgrade --install kmx-edc-ui oci://harbor.quantum-x.co.kr/kmx/charts/kmx-edc-ui \
  --version 0.2.1 \
  -n <namespace> \
  --set image.tag=<sha> \
  --atomic --timeout 10m \
  -f <운영 values 오버라이드>
```

`--atomic` 권장 — 새 파드가 Ready 에 도달하지 못하면 helm 이 자동으로 이전 리비전으로
되돌린다. 없으면 실패한 롤아웃이 그대로 방치돼 수동 `helm rollback` 전까지 열화 상태가
유지된다. `--timeout` 은 readinessProbe 예산(initialDelay 5s + period 10s × failureThreshold 3)
보다 넉넉하게 준다.

### 스키마 마이그레이션과 무중단

마이그레이션은 파드 부팅 시 `initDb()` 가 pg advisory lock 으로 직렬화해 실행한다(별도
마이그레이션 Job 불필요). `/readyz` 는 **DB 스키마 버전 ≥ 파드가 요구하는 버전**일 때 Ready 다
(동등 비교가 아니다 — `server/lib/db.ts` 의 `isSchemaVersionSatisfied`). 덕분에 롤링 중
새 파드가 DB 를 먼저 올려도 구 파드가 계속 서빙한다.

이게 성립하려면 **모든 마이그레이션이 N-1 하위호환**이어야 한다(expand/contract). 컬럼·테이블
추가는 그대로 배포하면 되고, 삭제·이름변경·NOT NULL 승격은 반드시 두 릴리스로 나눈다:
① 새 컬럼 추가 + 양쪽 쓰기 → 전체 배포 완료, ② 다음 릴리스에서 구 컬럼 제거.
규약 전문은 `SCHEMA_VERSION` 상수 주석에 있다.

`SEED_*`·`OIDC_*`·DB 접속 등 운영 시크릿 주입은 `helm/kmx-edc-ui/values.yaml` 주석과
`docs/KEYCLOAK.md`를 따른다.
