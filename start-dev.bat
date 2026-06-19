@echo off
REM KMX EDC UI — Dev 기동 (더블클릭)
REM 소스 마운트 + HMR. 최초 실행 후엔 PC 부팅 시 자동 기동됨.
cd /d "%~dp0"
docker compose -f docker-compose.dev.yml up -d
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] 기동 실패. Docker Desktop이 실행 중인지 확인하세요.
  pause
  exit /b %errorlevel%
)
echo.
echo EDC UI dev 기동 완료. 브라우저: http://localhost:3005  (admin@kmx.io / 0000)
echo 첫 실행은 의존성 설치로 1~2분 걸릴 수 있습니다. 로그: docker compose -f docker-compose.dev.yml logs -f app
timeout /t 3 >nul
start "" http://localhost:3005
