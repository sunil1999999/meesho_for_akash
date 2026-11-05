"""
Probe checking both new messages and edited messages after button click
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

    print(f"Connected to Telegram. Probing @{bot_username}...")
    bot = await client.get_input_entity(bot_username)

    # Send /start
    msg = await client.send_message(bot, "/start")
    await asyncio.sleep(2)

    # Get latest message
    msgs = await client.get_messages(bot, limit=2)
    start_reply = msgs[0]

    print("\n--- LATEST MESSAGE ---")
    print(start_reply.raw_text)

    # Find [➕ Add Account]
    add_btn = None
    if start_reply.buttons:
        for row in start_reply.buttons:
            for btn in row:
                if "add account" in btn.text.lower() or getattr(btn, "data", b"") == b"add_account":
                    add_btn = btn
                    break
            if add_btn:
                break

    if add_btn:
        print(f"\nClicking [{add_btn.text}] (data: {getattr(add_btn, 'data', None)})...")
        # Click the button
        await add_btn.click()
        await asyncio.sleep(3)

        # Check latest messages again (may be edited or new)
        new_msgs = await client.get_messages(bot, limit=3)
        print("\n" + "=" * 60)
        print("AFTER CLICK - RECENT MESSAGES:")
        print("=" * 60)
        for idx, m in enumerate(new_msgs):
            print(f"\nMessage {idx + 1} (ID: {m.id}, From: {'Bot' if m.out is False else 'Me'}):")
            print(m.raw_text)
            if m.buttons:
                print("Buttons:")
                for r in m.buttons:
                    print(" | ".join([f"[{b.text}] (data: {getattr(b, 'data', None)})" for b in r]))

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
