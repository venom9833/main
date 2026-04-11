@echo off
title LinkDropV3 - Launcher
setlocal
chcp 65001 >nul

echo ======================================================
echo    LinkDropV3: Starting Servers
echo ======================================================

:: 1. 좀비 프로세스 정리
echo [1/4] Cleaning zombie processes (3100, 8000)...
taskkill /F /FI "WINDOWTITLE eq LinkDrop3-Backend" /T >/dev/null 2>&1
taskkill /F /FI "WINDOWTITLE eq LinkDrop3-Frontend" /T >/dev/null 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3100 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >/dev/null 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >/dev/null 2>&1
)
powershell -Command "Get-WmiObject Win32_Process | Where-Object { `$_.CommandLine -like '*multiprocessing-fork*' } | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
echo    - Cleanup complete.

:: 2. 백엔드 기동 (FastAPI - Port 8000)
echo [2/4] Launching Backend (Port 8000)...
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
curl -s --max-time 2 http://localhost:3100 -o nul -w "%%{http_code}" 2>/dev/null | findstr "200" >nul
if errorlevel 1 goto wait_loop

echo.
echo ======================================================
echo  SERVERS STARTED!
echo    - Frontend:  http://localhost:3100
echo    - Backend:   http://localhost:8000
echo ======================================================

start http://localhost:3100
timeout /t 3
exit