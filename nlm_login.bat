@echo off
title LinkDropV2 - NotebookLM Login
cd /d "%~dp0"
setlocal

echo ============================================================
echo  [LinkDrop] NotebookLM Login
echo ============================================================
echo.

:: uv 경로 설정
set "UV_PATH=%USERPROFILE%\.local\bin"
set "PATH=%UV_PATH%;%PATH%"

:: [1/4] Chrome CDP 체크 및 조건부 실행
echo [1/4] Checking Chrome CDP status...

curl -s http://localhost:9222/json/version >nul 2>&1
if errorlevel 1 (
    echo Chrome is not running. Launching Chrome...
    echo.

    set NLM_URL=https://notebooklm.google.com
    set CHROME_PROFILE=%USERPROFILE%\.notebooklm-mcp-cli\chrome-profile

    if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
        set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
    ) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
        set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    ) else (
        set CHROME="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    )

    start "" %CHROME% --remote-debugging-port=9222 --remote-allow-origins=* "--user-data-dir=%CHROME_PROFILE%" %NLM_URL%

    echo Chrome is opening. Log in with your Google account.
    echo When the NotebookLM page appears, come back here.
    echo.
    pause
) else (
    echo Chrome with CDP detected. Skipping launch.
    echo.
)

:: [2/4] 로그인 (자동 → 수동 fallback)
echo [2/4] Extracting session (auto mode)...
cd /d "%~dp0packages\tools\notebooklm-cli"
uv run nlm login
if errorlevel 1 (
    echo.
    echo Auto login failed. Switching to manual mode...
    echo.
    uv run nlm login --manual
    if errorlevel 1 (
        echo ERROR: Login failed.
        pause
        exit /b 1
    )
)
echo.

:: [3/4] 세션 검증
echo [3/4] Validating session...
uv run nlm login --check
if errorlevel 1 (
    echo ERROR: Session validation failed.
    pause
    exit /b 1
)
echo.

:: [4/4] 기존 백엔드 정리 후 재시작
echo [4/4] Restarting Backend Server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a /T >nul 2>&1
)
taskkill /F /IM python.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul

cd /d "%~dp0apps\api"
start "LinkDrop-Backend" /min cmd /c ".venv\Scripts\python.exe main.py"
echo    - Backend restarted in background.

timeout /t 5 /nobreak >nul
start "" "http://localhost:3000/admin/notebook-login"

echo.
echo ============================================================
echo  NotebookLM is ready.
echo ============================================================
pause
