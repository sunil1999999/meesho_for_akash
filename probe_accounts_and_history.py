"""
Probe [👤 My Accounts] and [🧾 History]
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

    # Find My Accounts or History
    my_acc_btn = None
    hist_btn = None
    if msg.buttons:
        for row in msg.buttons:
            for btn in row:
                if "my accounts" in btn.text.lower() or getattr(btn, 'data', b'') == b'accounts':
                    my_acc_btn = btn
                if "history" in btn.text.lower():
                    hist_btn = btn

    if my_acc_btn:
        print(f"\nClicking [{my_acc_btn.text}]...")
        await my_acc_btn.click()
        await asyncio.sleep(2)
        m2 = await client.get_messages(bot, limit=1)
        print("\n" + "=" * 60)
        print("MY ACCOUNTS REPLY:")
        print("=" * 60)
        print(m2[0].raw_text)
        if m2[0].buttons:
            for r in m2[0].buttons:
                print(" | ".join([f"[{b.text}] (data: {getattr(b, 'data', None)})" for b in r]))

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
