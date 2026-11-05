"""
Probe /api/accounts/orders
"""

import os
import sys
import asyncio
from urllib.parse import urlparse, parse_qs
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv()

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import RequestWebViewRequest
import httpx

api_id = os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("TELEGRAM_API_HASH")
session_str = os.getenv("TELEGRAM_STRING_SESSION")
bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "primes_meesho_bot").lstrip("@")

async def main():
    client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
    await client.connect()

    bot = await client.get_input_entity(bot_username)

    wv = await client(RequestWebViewRequest(
        peer=bot,
        bot=bot,
        url="https://meeshoshop.94.136.188.137.nip.io/?view=history",
        platform="android",
        from_bot_menu=False
    ))

    init_data = parse_qs(urlparse(wv.url).fragment).get("tgWebAppData", [""])[0]

    headers = {
        "Content-Type": "application/json",
        "X-Tg-Init-Data": init_data,
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36"
    }

    async with httpx.AsyncClient(verify=False, timeout=15.0) as http:
        for path in [
            "/api/accounts/orders?account_id=140946",
            "/api/orders?account_id=140946",
            "/api/wallet/history",
            "/api/bootstrap"
        ]:
            r = await http.get(f"https://meeshoshop.94.136.188.137.nip.io{path}", headers=headers)
            print(f"{path} -> Status: {r.status_code}, Body: {r.text[:200]}")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
