@echo off
title LinkDrop Launcher (V2+V3)
setlocal
chcp 65001 >nul

echo ======================================================
echo    LinkDrop: Starting All Servers
echo    V2 Frontend  : http://localhost:3000
echo    V3 Frontend  : http://localhost:3100
echo    V3 Backend   : http://localhost:8001
echo ======================================================

:: ──────────────────────────────────────────────────────
:: 0. V2 Git Sync — pull / status / log
::    오늘 작업 전 리모트와 동기화 확인 (사고 방지)
:: ──────────────────────────────────────────────────────
echo.
echo ======================================================
echo  [V2 Git Sync ONLY]  C:\LinkDropV2
echo  ※ V3 (C:\LinkDropV3) git 조작 없음
echo ======================================================
cd /d "C:\LinkDropV2"

echo.
echo --- 원격 리포 확인 (V2 전용) --------------------------
git remote get-url origin
echo --- (위 URL 이 https://github.com/bbtanmanai/main 인지 확인) ---
echo.
echo --- git pull ------------------------------------------
git pull
echo.
echo --- git status ----------------------------------------
git status
echo.
echo --- git log (최근 5커밋) ------------------------------
git log --oneline -5
echo.
echo ======================================================
echo  위 내용을 확인하세요.  [V2 전용 — V3 무관]
echo  문제가 있으면 이 창을 닫고 직접 해결하세요.
echo  10초 후 서버 기동을 시작합니다. (아무 키 = 즉시 진행)
echo ======================================================
timeout /t 10

cd /d "%~dp0"

:: ──────────────────────────────────────────────────────
:: 1. 좀비 프로세스 정리
:: ──────────────────────────────────────────────────────
echo.
echo [1/5] Cleaning zombie processes...

:: 1-A. 창 타이틀 기반 kill (각 서버 전용 타이틀)
taskkill /F /FI "WINDOWTITLE eq LinkDrop2-Frontend" /T >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq LinkDrop3-Frontend" /T >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq LinkDrop3-Backend"  /T >nul 2>&1

:: 1-B. 포트 점유 PID kill — V2:3000 / V3-Web:3100 / V3-API:8001
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3100 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8001 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)

:: 1-C. CommandLine 패턴 기반 kill — V3 백엔드 좀비 프로세스 (포트 미점유 상태도 제거)
powershell -Command "Get-WmiObject Win32_Process | Where-Object { ($_.CommandLine -like '*LinkDropV3*main.py*') -or ($_.CommandLine -like '*uvicorn*main:app*') -or ($_.CommandLine -like '*multiprocessing-fork*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 1-D. 1초 후 포트 8001 잔여 PID 재확인 (uvicorn worker 지연 종료 대비)
timeout /t 1 /nobreak >nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8001 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)

echo    - Cleanup complete.

:: ──────────────────────────────────────────────────────
:: 2. V3 백엔드 기동 (FastAPI — Port 8001)
::    먼저 올려야 V3 프론트가 API를 사용할 수 있음
:: ──────────────────────────────────────────────────────
echo.
echo [2/5] Launching V3 Backend (Port 8001)...
start "LinkDrop3-Backend" /D "%~dp0apps\api" cmd /k ".venv\Scripts\python.exe -X utf8 main.py"
timeout /t 3 /nobreak >nul

:: ──────────────────────────────────────────────────────
:: 3. V3 프론트엔드 기동 (Next.js — Port 3100)
:: ──────────────────────────────────────────────────────
echo [3/5] Launching V3 Frontend (Port 3100)...
start "LinkDrop3-Frontend" /D "%~dp0apps\web" cmd /k "npm run dev"

:: ──────────────────────────────────────────────────────
:: 4. V2 프론트엔드 기동 (Next.js — Port 3000)
::    V3와 완전히 분리된 독립 프로세스
:: ──────────────────────────────────────────────────────
echo [4/5] Launching V2 Frontend (Port 3000)...
start "LinkDrop2-Frontend" /D "C:\LinkDropV2\apps\web" cmd /k "npm run dev"

:: ──────────────────────────────────────────────────────
:: 5. 서버 준비 대기 — V2(3000) + V3(3100) 순차 확인
:: ──────────────────────────────────────────────────────
echo.
echo [5/5] Waiting for servers to start...

:wait_v2
timeout /t 2 /nobreak >nul
curl -s --max-time 2 http://localhost:3000 -o nul -w "%%{http_code}" 2>nul | findstr "200" >nul
if errorlevel 1 goto wait_v2
echo    - V2 Frontend ready  (http://localhost:3000)

:wait_v3
timeout /t 2 /nobreak >nul
curl -s --max-time 2 http://localhost:3100 -o nul -w "%%{http_code}" 2>nul | findstr "200" >nul
if errorlevel 1 goto wait_v3
echo    - V3 Frontend ready  (http://localhost:3100)

:: ──────────────────────────────────────────────────────
:: 완료
:: ──────────────────────────────────────────────────────
echo.
echo ======================================================
echo  ALL SERVERS STARTED!
echo    - V2 Frontend:  http://localhost:3000  (LinkDropV2)
echo    - V3 Frontend:  http://localhost:3100  (LinkDropV3)
echo    - V3 Backend:   http://localhost:8001  (FastAPI)
echo ======================================================
echo.

start http://localhost:3000
timeout /t 1 /nobreak >nul
start http://localhost:3100

timeout /t 3
exit
