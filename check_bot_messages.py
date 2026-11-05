"""
Check messages from @primes_meesho_bot and print or download exported session
"""

import os
import sys
import json
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
    msgs = await client.get_messages(bot, limit=5)

    print("=" * 60)
    print("RECENT MESSAGES FROM BOT:")
    print("=" * 60)
    for m in msgs:
        sender = "Me" if m.out else "Bot"
        print(f"\n--- {sender} (ID: {m.id}, Date: {m.date}) ---")
        print(m.raw_text)
        if m.media:
            print("Media type:", type(m.media))
            # If it's a document/file, download and print its content
            if hasattr(m, 'file') and m.file:
                print("File name:", getattr(m.file, 'name', 'unnamed'))
                dl_path = await client.download_media(m, file="scratch/")
                print("Downloaded file to:", dl_path)
                try:
                    with open(dl_path, "r", encoding="utf-8") as f:
                        print("FILE CONTENT:\n", f.read())
                except Exception as e:
                    print("Error reading file:", e)

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
