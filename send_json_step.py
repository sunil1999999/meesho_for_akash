"""
Send JSON session for +91 74162 61990 as text message to @primes_meesho_bot
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
from supabase import create_client

api_id = os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("TELEGRAM_API_HASH")
session_str = os.getenv("TELEGRAM_STRING_SESSION")
bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "primes_meesho_bot").lstrip("@")
supa_url = os.getenv("VITE_SUPABASE_URL")
supa_key = os.getenv("VITE_SUPABASE_ANON_KEY")

async def main():
    target_phone = sys.argv[1] if len(sys.argv) > 1 else '+919033807401'
    # 1. Fetch account JSON from Supabase
    c = create_client(supa_url, supa_key)
    res = c.table('accounts').select('account_json, phone_display').eq('phone_normalized', target_phone).execute()
    if not res.data:
        print(f"ERROR: Account {target_phone} not found in Supabase")
        return

    acct_json = res.data[0]['account_json']
    payload_str = json.dumps(acct_json, indent=2)

    print(f"Loaded JSON for {res.data[0]['phone_display']} ({len(payload_str)} chars)")
    print(f"Connecting to Telegram...")

    client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
    await client.connect()

    bot = await client.get_input_entity(bot_username)
    print("Sending JSON as text message...")
    sent = await client.send_message(bot, payload_str)
    print(f"Sent message ID: {sent.id}")

    # Wait for bot response
    print("Waiting for bot response...")
    await asyncio.sleep(4)

    msgs = await client.get_messages(bot, limit=4)
    print("\n" + "=" * 60)
    print("RECENT MESSAGES AFTER SENDING JSON:")
    print("=" * 60)
    for m in msgs:
        sender = "Me" if m.out else "Bot"
        print(f"\n--- {sender} (Message ID: {m.id}) ---")
        print(m.raw_text)
        if m.buttons:
            print("Buttons:")
            for r_idx, r in enumerate(m.buttons):
                btn_strs = [f"[{b.text}] (data: {getattr(b, 'data', None)})" for b in r]
                print(f"  Row {r_idx}: {' | '.join(btn_strs)}")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
