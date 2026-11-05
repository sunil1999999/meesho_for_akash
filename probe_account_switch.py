"""
Probe account switching in WebApp
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

async def main():
    client = TelegramClient(StringSession(os.getenv("TELEGRAM_STRING_SESSION")), int(os.getenv("TELEGRAM_API_ID")), os.getenv("TELEGRAM_API_HASH"))
    await client.connect()
    bot = await client.get_input_entity("primes_meesho_bot")

    wv = await client(RequestWebViewRequest(peer=bot, bot=bot, url="https://meeshoshop.94.136.188.137.nip.io/?view=history", platform="android", from_bot_menu=False))
    init_data = urllib.parse.unquote(urllib.parse.urlparse(wv.url).fragment.split("tgWebAppData=")[1].split("&")[0])

    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A525F)",
        "X-Tg-Init-Data": init_data,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Referer": "https://meeshoshop.94.136.188.137.nip.io/",
    }

    async with httpx.AsyncClient(verify=False) as http:
        # Check bootstrap
        boot = (await http.get("https://meeshoshop.94.136.188.137.nip.io/api/bootstrap", headers=headers)).json()
        print("Active ID in bootstrap:", boot.get("active_id"))
        print("All accounts in bootstrap:")
        for a in boot.get("accounts", []):
            print(f" - ID: {a['id']}, Mobile: {a['mobile']}")

        # Test POST /api/accounts/switch with different payload keys
        target_id = boot.get("accounts", [])[0]["id"]
        for payload in [{"account_id": target_id}, {"id": target_id}, {"account_id": str(target_id)}]:
            r = await http.post("https://meeshoshop.94.136.188.137.nip.io/api/accounts/switch", headers=headers, json=payload)
            print(f"Switch test with {payload}: Status={r.status_code}, Body={r.text}")

        # Check if GET /api/orders takes account_id query parameter directly!
        for target_acc in boot.get("accounts", []):
            r_ord = await http.get(f"https://meeshoshop.94.136.188.137.nip.io/api/orders?account_id={target_acc['id']}", headers=headers)
            print(f"Orders for account {target_acc['id']} ({target_acc['mobile']}): Status={r_ord.status_code}, Body={r_ord.text[:120]}")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
