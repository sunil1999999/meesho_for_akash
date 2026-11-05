"""
Open Shop step: Requests authorized Telegram WebApp URL and probes Shop interface & API
"""

import os
import sys
import json
import urllib.parse
import asyncio
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

    print("Requesting authorized Telegram WebApp token for [🛍 Open Shop]...")
    shop_wv = await client(RequestWebViewRequest(
        peer=bot,
        bot=bot,
        url="https://meeshoshop.94.136.188.137.nip.io/",
        platform="android",
        from_bot_menu=False
    ))

    raw_url = shop_wv.url
    print(f"\nObtained WebApp URL:\n{raw_url[:100]}...")

    # Extract initData from tgWebAppData
    init_data = ""
    parsed = urllib.parse.urlparse(raw_url)
    fragment = parsed.fragment
    if "tgWebAppData=" in fragment:
        init_data = urllib.parse.unquote(fragment.split("tgWebAppData=")[1].split("&")[0])

    print(f"Extracted X-Tg-Init-Data: {init_data[:60]}...")

    # Query WebApp endpoints using the authentic Telegram initData header
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
        "X-Tg-Init-Data": init_data,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://meeshoshop.94.136.188.137.nip.io/",
    }

    async with httpx.AsyncClient(verify=False, timeout=15.0) as http:
        print("\nQuerying Shop Bootstrap API (/api/bootstrap)...")
        try:
            r_boot = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/bootstrap", headers=headers)
            print(f"Bootstrap Status: {r_boot.status_code}")
            print("Bootstrap Data:", r_boot.text[:300])
        except Exception as e:
            print("Bootstrap Error:", e)

        print("\nQuerying Accounts in Shop (/api/accounts/list)...")
        try:
            r_accs = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/accounts/list", headers=headers)
            print(f"Accounts Status: {r_accs.status_code}")
            print("Accounts Data:", r_accs.text[:300])
        except Exception as e:
            print("Accounts Error:", e)

        print("\nQuerying Orders in Shop (/api/orders)...")
        try:
            r_ord = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/orders", headers=headers)
            print(f"Orders Status: {r_ord.status_code}")
            print("Orders Data:", r_ord.text[:400])
        except Exception as e:
            print("Orders Error:", e)

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
