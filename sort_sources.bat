@echo off
chcp 65001 >nul
setlocal

:: ================================================================
:: LinkDrop V3 - Source PDF Auto Sorter
:: Double-click to run. Sorts files in _inbox/ automatically.
:: ================================================================

set "ROOT=%~dp0"
set "INBOX=%ROOT%source-pdf\_inbox"
set "PYTHON=%ROOT%apps\api\.venv\Scripts\python.exe"
set "SCRIPT=%ROOT%apps\api\scripts\sort_sources.py"

echo.
echo ================================================================
echo  LinkDrop V3 - Source PDF Auto Sorter
echo ================================================================
echo.

:: Create _inbox folder if it does not exist
if not exist "%INBOX%" (
    mkdir "%INBOX%"
    echo [INFO] _inbox folder created.
)

:: Count files in _inbox (excluding subfolders)
set FILE_COUNT=0
for %%f in ("%INBOX%\*.*") do set /a FILE_COUNT+=1

echo  Files in _inbox: %FILE_COUNT%
echo.

if %FILE_COUNT%==0 (
    echo  No files to process.
    echo  Place files in source-pdf\_inbox\ and run again.
    echo  Supported: txt  md  pdf  srt  vtt
    echo.
    pause
    exit /b 0
)

:: Check Python venv exists
if not exist "%PYTHON%" (
    echo [ERROR] Python venv not found.
    echo  Path: %PYTHON%
    echo  Please create apps\api\.venv first.
    echo.
    pause
    exit /b 1
)

:: Run sort script
echo  Starting classification...
echo ================================================================
echo.

"%PYTHON%" -X utf8 "%SCRIPT%"

echo.
echo ================================================================
echo  Done. Check results:
echo   - Sorted files : source-pdf\landing1~9\  or  common\
echo   - Review queue : source-pdf\_inbox\_review\
echo   - History log  : source-pdf\_sorted\sort_log.json
echo ================================================================
echo.

pause
endlocal
