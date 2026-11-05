"""
Probe clicking account detail button
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

    msgs = await client.get_messages(bot, limit=1)
    msg = msgs[0]

    acct_btn = None
    if msg.buttons:
        for row in msg.buttons:
            for btn in row:
                if getattr(btn, 'data', b'').startswith(b'acct:'):
                    acct_btn = btn
                    break

    if acct_btn:
        print(f"Clicking [{acct_btn.text}] (data: {getattr(acct_btn, 'data', None)})...")
        await acct_btn.click()
        await asyncio.sleep(2)
        m2 = await client.get_messages(bot, limit=1)
        print("\n" + "=" * 60)
        print("ACCOUNT DETAILS REPLY:")
        print("=" * 60)
        print(m2[0].raw_text)
        print("=" * 60)
        if m2[0].buttons:
            print("Buttons:")
            for r in m2[0].buttons:
                print(" | ".join([f"[{b.text}] (data: {getattr(b, 'data', None)})" for b in r]))

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
