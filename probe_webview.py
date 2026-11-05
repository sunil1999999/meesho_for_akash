"""
Probe requesting Telegram WebView authentication URL for Open Shop & History
"""

import os
import sys
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

    # 1. Request WebView for Open Shop
    print("Requesting authorized WebView for Open Shop...")
    shop_wv = await client(RequestWebViewRequest(
        peer=bot,
        bot=bot,
        url="https://meeshoshop.94.136.188.137.nip.io/",
        platform="android",
        from_bot_menu=False
    ))
    print(f"Authorized Shop URL: {shop_wv.url[:120]}...")

    # 2. Request WebView for History
    print("\nRequesting authorized WebView for History / Orders...")
    hist_wv = await client(RequestWebViewRequest(
        peer=bot,
        bot=bot,
        url="https://meeshoshop.94.136.188.137.nip.io/?view=history",
        platform="android",
        from_bot_menu=False
    ))
    print(f"Authorized History URL: {hist_wv.url[:120]}...")

    # 3. Test HTTP fetching the history page
    async with httpx.AsyncClient(verify=False, timeout=10.0) as http:
        res = await http.get(hist_wv.url)
        print(f"\nHTTP Response Status: {res.status_code}")
        print(f"HTML Content length: {len(res.text)}")
        print("First 300 chars:")
        print(res.text[:300])

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
