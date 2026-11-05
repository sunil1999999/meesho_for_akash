"""
Probe clicking [🛍 Open Shop]
"""

import os
import sys
import asyncio
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv()

from telethon import TelegramClient
from telethon.sessions import StringSession

api_id = os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("TELEGRAM_API_HASH")
session_str = os.getenv("TELEGRAM_STRING_SESSION")
bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "primes_meesho_bot").lstrip("@")

async def main():
    client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
    await client.connect()

    bot = await client.get_input_entity(bot_username)

    # Cancel previous prompt or send /start
    await client.send_message(bot, "/start")
    await asyncio.sleep(2)

    msgs = await client.get_messages(bot, limit=2)
    start_msg = msgs[0]

    open_shop_btn = None
    if start_msg.buttons:
        for row in start_msg.buttons:
            for btn in row:
                if "open shop" in btn.text.lower():
                    open_shop_btn = btn
                    break
            if open_shop_btn:
                break

    if open_shop_btn:
        print(f"Found button: [{open_shop_btn.text}] (data: {getattr(open_shop_btn, 'data', None)})")
        print(f"Button type: {type(open_shop_btn.button)}")
        # If it's a web app or url or callback or keyboard
        print(f"Details: {open_shop_btn.button}")
        if hasattr(open_shop_btn.button, 'url'):
            print(f"URL / WebApp: {getattr(open_shop_btn.button, 'url', None)}")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
