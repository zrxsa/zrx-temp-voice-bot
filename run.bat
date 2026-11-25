@echo off
chcp 65001 >nul
title Temporary Voice Channels Bot 
color 0b
cls

echo ==========================================
echo       Temporary Voice Channels Bot
echo ==========================================
echo.

:: Check if node_modules exists, if not run npm install
if not exist node_modules (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
)

set /a crash_count=0

:start
echo.
echo ==========================================
echo [INFO] Starting the bot...
echo ==========================================
echo.

call node index.js

set /a crash_count+=1
echo.
echo ==========================================
echo [WARNING] Bot crashed or stopped!
echo [INFO] Total Restarts: %crash_count%
echo [INFO] Restarting bot in 5 seconds... (Press Ctrl+C to stop)
echo ==========================================
timeout /t 5 /nobreak >nul
goto start
