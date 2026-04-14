@echo off
title LinkDropV3 - Launcher
setlocal
chcp 65001 >nul

echo ======================================================
echo    LinkDropV3: Starting Servers
echo ======================================================

:: 1. 좀비 프로세스 정리
echo [1/4] Cleaning zombie processes (3100, 8001)...

:: 1-A. 창 타이틀 기반 kill
taskkill /F /FI "WINDOWTITLE eq LinkDrop3-Backend" /T >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq LinkDrop3-Frontend" /T >nul 2>&1

:: 1-B. 포트 점유 PID kill (포트 → PID 역추적)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3100 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8001 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)

:: 1-C. CommandLine 패턴 기반 kill — 포트 미점유 좀비까지 제거
powershell -Command "Get-WmiObject Win32_Process | Where-Object { ($_.CommandLine -like '*LinkDropV3*main.py*') -or ($_.CommandLine -like '*uvicorn*main:app*') -or ($_.CommandLine -like '*multiprocessing-fork*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 1-D. 잔여 PID 확인 후 강제 제거 (포트 8001 재확인)
timeout /t 1 /nobreak >nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8001 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)

echo    - Cleanup complete.

:: 2. 백엔드 기동 (FastAPI - Port 8001)
echo [2/4] Launching Backend (Port 8001)...
start "LinkDrop3-Backend" /D "%~dp0apps\api" cmd /k ".venv\Scripts\python.exe -X utf8 main.py"
timeout /t 3 /nobreak >nul

:: 3. 프론트엔드 기동 (Next.js - Port 3100)
echo [3/4] Launching Frontend (Port 3100)...
start "LinkDrop3-Frontend" /D "%~dp0apps\web" cmd /k "npm run dev"

:: 4. 서버 대기
echo.
echo    Waiting for servers...
:wait_loop
timeout /t 2 /nobreak >nul
curl -s --max-time 2 http://localhost:3100 -o nul -w "%%{http_code}" 2>nul | findstr "200" >nul
if errorlevel 1 goto wait_loop

echo.
echo ======================================================
echo  SERVERS STARTED!
echo    - Frontend:  http://localhost:3100
echo    - Backend:   http://localhost:8001
echo ======================================================

start http://localhost:3100
timeout /t 3
exit