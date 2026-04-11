@echo off
echo ======================================================
echo Naver nShop Analyzer - Windows EXE Build Script
echo ======================================================

echo [1/3] Installing dependencies...
python -m pip install --upgrade pip
pip install customtkinter selenium webdriver-manager beautifulsoup4 requests pyinstaller

echo.
echo [2/3] Building EXE file...
python -m PyInstaller --onefile --noconsole --collect-all customtkinter main.py

echo.
echo [3/3] Cleaning up...
echo Build complete! Check the 'dist' folder for main.exe
pause
