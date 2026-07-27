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
  --version 0.1.0 \
  -n <namespace> \
  --set image.tag=<sha> \
  -f <운영 values 오버라이드>
```

`SEED_*`·`OIDC_*`·DB 접속 등 운영 시크릿 주입은 `helm/kmx-edc-ui/values.yaml` 주석과
`docs/KEYCLOAK.md`를 따른다.
