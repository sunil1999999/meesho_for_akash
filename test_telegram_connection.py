"""
Test script to verify live Telegram MTProto connection and communication with @primes_meesho_bot
"""

import os
import asyncio
from dotenv import load_dotenv

load_dotenv()

from telethon import TelegramClient
from telethon.sessions import StringSession

api_id = os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("TELEGRAM_API_HASH")
session_str = os.getenv("TELEGRAM_STRING_SESSION")
bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "primes_meesho_bot").lstrip("@")

print(f"Testing Telegram connection with API_ID: {api_id}")

async def main():
    if not api_id or not api_hash or not session_str:
        print("ERROR: Missing credentials in .env")
        return

    client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        print("ERROR: Client is not authorized. Session string may be invalid or expired.")
        await client.disconnect()
        return

    me = await client.get_me()
    print("=" * 60)
    print(f"CONNECTED SUCCESSFULLY AS: @{me.username or me.first_name} ({me.phone})")
    print(f"User ID: {me.id}")
    print("=" * 60)

    try:
        print(f"\nLocating bot entity @{bot_username}...")
        bot = await client.get_entity(bot_username)
        print(f"FOUND BOT: {bot.first_name} (@{bot.username}) [ID: {bot.id}]")
    except Exception as e:
        print(f"Error locating bot: {e}")

    await client.disconnect()
    print("\nConnection test passed successfully!")

if __name__ == "__main__":
    asyncio.run(main())
