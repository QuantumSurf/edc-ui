@echo off
REM KMX EDC UI — Dev 정지 (더블클릭)
REM 컨테이너만 정지/제거. DB 데이터(devpgdata)와 node_modules 볼륨은 보존.
cd /d "%~dp0"
docker compose -f docker-compose.dev.yml down
echo.
echo EDC UI dev 정지 완료.
timeout /t 3 >nul
