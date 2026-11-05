"""
Probe [🧾 History]
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

    # Send /start
    await client.send_message(bot, "/start")
    await asyncio.sleep(2)

    msgs = await client.get_messages(bot, limit=1)
    msg = msgs[0]

    hist_btn = None
    if msg.buttons:
        for row in msg.buttons:
            for btn in row:
                if "history" in btn.text.lower():
                    hist_btn = btn
                    break
            if hist_btn:
                break

    if hist_btn:
        print(f"History button: [{hist_btn.text}] (data: {getattr(hist_btn, 'data', None)}) (url: {getattr(getattr(hist_btn, 'button', None), 'url', None)})")
        print(f"Button type: {type(hist_btn.button)}")
        if getattr(hist_btn, 'data', None):
            await hist_btn.click()
            await asyncio.sleep(2)
            m2 = await client.get_messages(bot, limit=1)
            print("History reply:", m2[0].raw_text)

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
