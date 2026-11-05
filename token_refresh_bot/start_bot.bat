@echo off
title Account Token Refresh Bot
cd /d "%~dp0"
echo ========================================================
echo Starting Independent Account Token Refresh Bot
echo ========================================================
if not exist .env (
    echo [.env] not found. Copying .env.example to .env...
    copy .env.example .env
    echo Please configure your TELEGRAM_BOT_TOKEN and ALLOWED_TELEGRAM_USER_IDS in .env before running.
    pause
    exit /b 1
)
python bot.py
pause
