# Harbor(kmx) 수동 발행 — 컨테이너 이미지 + Helm 차트(OCI)
#
# 전제: docker/helm 설치, harbor.quantum-x.co.kr 접근권한(로봇계정 또는 개인계정).
#       실제 클러스터 배포(helm upgrade)는 이 스크립트 범위 밖(운영 담당).
#
# 사용:
#   pwsh ./scripts/publish-harbor.ps1              # git short sha 태그
#   pwsh ./scripts/publish-harbor.ps1 -Tag v1.0.0  # 태그 지정
#   pwsh ./scripts/publish-harbor.ps1 -SkipChart   # 이미지만

param(
  [string]$Registry = "harbor.quantum-x.co.kr",
  [string]$Project  = "kmx",
  [string]$Image    = "edc-ui",
  [string]$Tag      = "",
  [switch]$SkipChart
)

$ErrorActionPreference = "Stop"
if (-not $Tag) { $Tag = (git rev-parse --short HEAD).Trim() }
$ref = "$Registry/$Project/$Image"

Write-Host "== Harbor 로그인 ($Registry) ==" -ForegroundColor Cyan
docker login $Registry

Write-Host "== 이미지 빌드/푸시: ${ref}:$Tag (+latest) ==" -ForegroundColor Cyan
docker build -t "${ref}:$Tag" -t "${ref}:latest" .
docker push "${ref}:$Tag"
docker push "${ref}:latest"

if (-not $SkipChart) {
  Write-Host "== Helm 차트 의존성 + 패키지 + OCI 푸시 ==" -ForegroundColor Cyan
  helm registry login $Registry
  helm dependency update ./helm/kmx-edc-ui
  helm package ./helm/kmx-edc-ui -d ./dist
  $tgz = Get-ChildItem ./dist/kmx-edc-ui-*.tgz | Sort-Object LastWriteTime | Select-Object -Last 1
  helm push $tgz.FullName "oci://$Registry/$Project/charts"
  Write-Host "차트 발행: oci://$Registry/$Project/charts/kmx-edc-ui" -ForegroundColor Green
}

Write-Host "완료 — image ${ref}:$Tag" -ForegroundColor Green
