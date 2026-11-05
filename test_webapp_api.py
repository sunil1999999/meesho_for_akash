"""
Test calling the WebApp REST APIs (/api/accounts/list and /api/orders) using live Telegram auth
"""

import os
import sys
import asyncio
from urllib.parse import urlparse, parse_qs, unquote
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

    # 1. Obtain signed WebView URL
    wv = await client(RequestWebViewRequest(
        peer=bot,
        bot=bot,
        url="https://meeshoshop.94.136.188.137.nip.io/?view=history",
        platform="android",
        from_bot_menu=False
    ))

    # Extract tgWebAppData from hash
    full_url = wv.url
    parsed = urlparse(full_url)
    fragment = parsed.fragment
    qs = parse_qs(fragment)
    init_data = qs.get("tgWebAppData", [""])[0]

    print("Obtained X-Tg-Init-Data length:", len(init_data))
    print("InitData snippet:", init_data[:60])

    headers = {
        "Content-Type": "application/json",
        "X-Tg-Init-Data": init_data,
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    }

    async with httpx.AsyncClient(verify=False, timeout=15.0) as http:
        # Call /api/accounts/list
        r1 = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/accounts/list", headers=headers)
        print("\n" + "=" * 60)
        print(f"/api/accounts/list Status: {r1.status_code}")
        print("Accounts Response:", r1.text[:400])

        # Call /api/orders
        r2 = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/orders", headers=headers)
        print("\n" + "=" * 60)
        print(f"/api/orders Status: {r2.status_code}")
        print("Orders Response:", r2.text[:600])

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
