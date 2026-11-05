"""
Probe clicking [➕ Add Account] to discover Import JSON Session prompt
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

    async with client.conversation(bot, timeout=30) as conv:
        await conv.send_message("/start")
        reply = await conv.get_response()

        add_acc_btn = None
        if reply.buttons:
            for row in reply.buttons:
                for btn in row:
                    if "add account" in btn.text.lower() or getattr(btn, 'data', b'') == b'add_account':
                        add_acc_btn = btn
                        break
                if add_acc_btn:
                    break

        if add_acc_btn:
            print(f"\nClicking button: [{add_acc_btn.text}]...")
            await add_acc_btn.click()
            step2_reply = await conv.get_response()
            print("\n" + "=" * 60)
            print("STEP 2 REPLY TEXT:")
            print("=" * 60)
            print(step2_reply.raw_text)
            print("=" * 60)

            print("\nSTEP 2 BUTTONS:")
            if step2_reply.buttons:
                for row_idx, row in enumerate(step2_reply.buttons):
                    row_texts = [f"[{btn.text}] (data: {getattr(btn, 'data', None)})" for btn in row]
                    print(f"Row {row_idx + 1}: {' | '.join(row_texts)}")
            else:
                print("No buttons on step 2.")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
