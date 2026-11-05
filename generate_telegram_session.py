"""
Interactive helper to generate a Telegram StringSession for Telethon.
Run:
    python generate_telegram_session.py
"""

import os
import re
import sys
import getpass
import asyncio
from dotenv import load_dotenv

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv()

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    PhoneNumberInvalidError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    SessionPasswordNeededError,
    PasswordHashInvalidError,
    ApiIdInvalidError,
    FloodWaitError
)

def update_env_file(api_id: str, api_hash: str, session_str: str, phone: str = ""):
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return False
    
    with open(env_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    def replace_or_append(text, key, val):
        pattern = rf'^{key}=.*$'
        if re.search(pattern, text, flags=re.MULTILINE):
            return re.sub(pattern, f'{key}={val}', text, flags=re.MULTILINE)
        else:
            return text + f"\n{key}={val}"

    content = replace_or_append(content, "TELEGRAM_API_ID", api_id)
    content = replace_or_append(content, "TELEGRAM_API_HASH", api_hash)
    content = replace_or_append(content, "TELEGRAM_STRING_SESSION", session_str)
    if phone:
        content = replace_or_append(content, "TELEGRAM_PHONE", phone)
        
    with open(env_path, "w", encoding="utf-8") as f:
        f.write(content)
    return True

async def main():
    print("=" * 60)
    print("       TELEGRAM STRING SESSION GENERATOR")
    print("=" * 60)

    api_id = os.getenv("TELEGRAM_API_ID", "").strip().strip("'\"")
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip().strip("'\"")

    if not api_id or not api_hash:
        print("You can get your API ID and API HASH from https://my.telegram.org")
        print("-" * 60)
        api_id = input("Enter your Telegram API ID: ").strip()
        api_hash = input("Enter your Telegram API HASH: ").strip()

    try:
        api_id_int = int(api_id)
    except ValueError:
        print("❌ Error: TELEGRAM_API_ID must be a numeric integer.")
        return

    client = TelegramClient(StringSession(), api_id_int, api_hash)
    await client.connect()

    try:
        sent_code = None
        normalized_phone = ""

        # Step 1: Input and validate phone number
        while True:
            raw_phone = input("\nEnter your Telegram phone number (with country code, e.g. +919876543210): ").strip()
            if not raw_phone:
                continue

            # Remove spaces, hyphens, parentheses
            cleaned = re.sub(r'[\s\-\(\)]', '', raw_phone)

            # Auto-format: If 10 digits and starts with Indian mobile digits (6, 7, 8, 9)
            if re.match(r'^[6-9]\d{9}$', cleaned):
                normalized_phone = f"+91{cleaned}"
                print(f"ℹ️ Auto-formatted 10-digit number to Indian standard: {normalized_phone}")
            elif not cleaned.startswith('+'):
                normalized_phone = f"+{cleaned}"
            else:
                normalized_phone = cleaned

            try:
                print(f"Requesting login code for {normalized_phone}...")
                sent_code = await client.send_code_request(normalized_phone)
                print("✅ Code sent! Check your Telegram app (or SMS).")
                break
            except PhoneNumberInvalidError:
                print("❌ The phone number is invalid.")
                print("   Make sure to include your country code: e.g. +91 9876543210")
            except ApiIdInvalidError:
                print("❌ Invalid API ID or API Hash. Please verify them on https://my.telegram.org")
                return
            except FloodWaitError as e:
                print(f"❌ Telegram rate limit (FloodWait): Please wait {e.seconds} seconds before trying again.")
                return
            except Exception as e:
                print(f"❌ Error requesting code: {e}")

        # Step 2: Input verification code
        while True:
            code = input("\nEnter the verification code you received: ").strip()
            code = code.replace(" ", "").replace("-", "")

            try:
                await client.sign_in(phone=normalized_phone, code=code, phone_code_hash=sent_code.phone_code_hash)
                break
            except PhoneCodeInvalidError:
                print("❌ Invalid verification code. Please check and try again.")
            except PhoneCodeExpiredError:
                print("❌ Verification code expired. Please re-run the script to request a new code.")
                return
            except SessionPasswordNeededError:
                # 2FA password step
                print("\nTwo-Step Verification (2FA) is enabled on this account.")
                while True:
                    password = getpass.getpass("Enter your 2FA Cloud Password: ")
                    try:
                        await client.sign_in(password=password)
                        break
                    except PasswordHashInvalidError:
                        print("❌ Incorrect 2FA password. Try again.")
                break
            except Exception as e:
                print(f"❌ Error signing in: {e}")
                return

        # Step 3: Extract session string and user details
        session_str = client.session.save()
        me = await client.get_me()

        print("\n" + "=" * 60)
        display_name = me.first_name or ""
        if me.last_name:
            display_name += f" {me.last_name}"
        username_str = f"@{me.username}" if me.username else "(No username)"
        phone_str = f"+{me.phone}" if me.phone else normalized_phone
        print(f"SUCCESSFULLY LOGGED IN AS: {display_name} | {username_str} ({phone_str})")
        print("=" * 60)

        # Step 4: Update .env file
        updated = update_env_file(str(api_id_int), api_hash, session_str, phone_str)
        if updated:
            print("✅ Successfully updated TELEGRAM_STRING_SESSION in your .env file!")
        else:
            print("\nHere is your TELEGRAM_STRING_SESSION:")
            print(session_str)

        print("\nYou can now run your Telegram scripts (continuous_order_monitor.py, etc.)!")
        print("=" * 60)

    finally:
        if client.is_connected():
            await client.disconnect()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user.")
