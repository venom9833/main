@echo off
cd /d "%~dp0packages\tools\skill-2-video-longform1\opal-access"

echo ============================================================
echo  [LinkDrop] Opal Login
echo ============================================================
echo.

echo [1/3] Installing dependencies...
pip install -r requirements.txt -q
echo Done.
echo.

echo [2/3] Connecting to Opal...

python -c "import httpx; httpx.get('http://localhost:9222/json/version', timeout=2)" >nul 2>&1
if errorlevel 1 (
    echo Chrome is not running. Launching Chrome...
    echo.

    set OPAL_URL=https://opal.google/edit/1YQTJjGO0VnQN5U38CE6hHNIhbcindUXt
    set CHROME_PROFILE=%USERPROFILE%\.linkdrop-opal\chrome-profile

    if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
        set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
    ) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
        set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    ) else (
        set CHROME="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    )

    start "" %CHROME% --remote-debugging-port=9222 --remote-allow-origins=* "--user-data-dir=%CHROME_PROFILE%" %OPAL_URL%

    echo Chrome is opening. Log in with your Google account.
    echo When the Opal editor appears, come back here.
    echo.
    pause
) else (
    echo Chrome with CDP detected. Skipping launch.
    echo.
)

echo Extracting session (cookies + Bearer Token)...
python scripts/login.py --extract-only
if errorlevel 1 (
    echo.
    echo Auto extraction failed. Switching to manual mode...
    echo.
    python scripts/login.py --manual
    if errorlevel 1 (
        echo ERROR: Login failed.
        pause
        exit /b 1
    )
)
echo.

echo [3/3] Validating via Drive API...
python scripts/check_session.py --validate
if errorlevel 1 (
    echo ERROR: Validation failed.
    pause
    exit /b 1
)
echo.

echo ============================================================
echo  Opal is ready.
echo ============================================================
pause
