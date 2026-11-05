#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "========================================================"
echo "Starting Independent Account Token Refresh Bot"
echo "========================================================"

if [ ! -f .env ]; then
    echo "[.env] not found. Copying .env.example to .env..."
    cp .env.example .env
    echo "Please configure your TELEGRAM_BOT_TOKEN and ALLOWED_TELEGRAM_USER_IDS in .env before running."
    exit 1
fi

python3 bot.py
