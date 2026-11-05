"""
Interactive Step Helper for Telegram Automation with @primes_meesho_bot
Allows inspecting state, clicking buttons, and sending text step-by-step.
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
try:
    from telethon.tl.types import (
        KeyboardButtonCallback,
        KeyboardButtonUrl,
        KeyboardButtonWebView,
        KeyboardButtonSimpleWebView,
    )
except ImportError:
    from telethon import types
    KeyboardButtonCallback = getattr(types, 'KeyboardButtonCallback', None)
    KeyboardButtonUrl = getattr(types, 'KeyboardButtonUrl', None)
    KeyboardButtonWebView = getattr(types, 'KeyboardButtonWebView', None)
    KeyboardButtonSimpleWebView = getattr(types, 'KeyboardButtonSimpleWebView', None)

api_id = os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("TELEGRAM_API_HASH")
session_str = os.getenv("TELEGRAM_STRING_SESSION")
bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "primes_meesho_bot").lstrip("@")


async def get_client():
    client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram client is not authorized!")
    return client


def format_button(btn, r_idx, c_idx):
    b_type = "callback"
    data_str = None
    url = None

    if hasattr(btn, "data") and btn.data:
        try:
            data_str = btn.data.decode("utf-8")
        except:
            data_str = str(btn.data)
    elif isinstance(btn, (KeyboardButtonWebView, KeyboardButtonSimpleWebView)):
        b_type = "webview"
        url = getattr(btn, "url", None)
    elif isinstance(btn, KeyboardButtonUrl):
        b_type = "url"
        url = getattr(btn, "url", None)

    return {
        "row": r_idx,
        "col": c_idx,
        "text": btn.text,
        "type": b_type,
        "data": data_str,
        "url": url,
    }


async def action_status():
    client = await get_client()
    try:
        bot = await client.get_input_entity(bot_username)
        msgs = await client.get_messages(bot, limit=5)
        
        # Find latest bot message
        latest_bot_msg = None
        for m in msgs:
            if not m.out:
                latest_bot_msg = m
                break

        if not latest_bot_msg:
            print(json.dumps({"error": "No bot message found"}))
            return

        buttons_list = []
        if latest_bot_msg.buttons:
            for r_idx, row in enumerate(latest_bot_msg.buttons):
                for c_idx, btn in enumerate(row):
                    buttons_list.append(format_button(btn, r_idx, c_idx))

        out = {
            "msg_id": latest_bot_msg.id,
            "date": latest_bot_msg.date.isoformat(),
            "text": latest_bot_msg.raw_text,
            "buttons": buttons_list,
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
    finally:
        await client.disconnect()


async def action_send(text: str):
    client = await get_client()
    try:
        bot = await client.get_input_entity(bot_username)
        await client.send_message(bot, text)
        await asyncio.sleep(2.5)

        # Retrieve new state
        msgs = await client.get_messages(bot, limit=5)
        latest_bot_msg = None
        for m in msgs:
            if not m.out:
                latest_bot_msg = m
                break

        buttons_list = []
        if latest_bot_msg and latest_bot_msg.buttons:
            for r_idx, row in enumerate(latest_bot_msg.buttons):
                for c_idx, btn in enumerate(row):
                    buttons_list.append(format_button(btn, r_idx, c_idx))

        out = {
            "action": "sent_message",
            "sent_text": text[:100] + ("..." if len(text) > 100 else ""),
            "latest_bot_msg": latest_bot_msg.raw_text if latest_bot_msg else None,
            "msg_id": latest_bot_msg.id if latest_bot_msg else None,
            "buttons": buttons_list,
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
    finally:
        await client.disconnect()


async def action_click(btn_identifier: str):
    client = await get_client()
    try:
        bot = await client.get_input_entity(bot_username)
        msgs = await client.get_messages(bot, limit=5)

        latest_bot_msg = None
        for m in msgs:
            if not m.out:
                latest_bot_msg = m
                break

        if not latest_bot_msg or not latest_bot_msg.buttons:
            print(json.dumps({"error": "No buttons available on latest bot message"}))
            return

        target_btn = None
        # Try matching by data, text, or row:col
        ident_lower = btn_identifier.lower().strip()

        for r_idx, row in enumerate(latest_bot_msg.buttons):
            for c_idx, btn in enumerate(row):
                coord = f"{r_idx}:{c_idx}"
                data_val = getattr(btn, "data", b"")
                if isinstance(data_val, bytes):
                    try:
                        data_val_str = data_val.decode("utf-8")
                    except:
                        data_val_str = ""
                else:
                    data_val_str = str(data_val or "")

                if (
                    coord == ident_lower
                    or ident_lower in btn.text.lower()
                    or ident_lower == data_val_str.lower()
                ):
                    target_btn = btn
                    break
            if target_btn:
                break

        if not target_btn:
            print(json.dumps({"error": f"Button matching '{btn_identifier}' not found"}))
            return

        btn_label = target_btn.text
        # If it's a webview button, we can't standard .click() callback, we report its webview
        if isinstance(target_btn, (KeyboardButtonWebView, KeyboardButtonSimpleWebView)):
            out = {
                "action": "webview_detected",
                "clicked_button": btn_label,
                "url": getattr(target_btn, "url", None),
                "notice": "This is a Telegram WebApp button (Mini App)",
            }
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return

        # Regular inline callback button
        await target_btn.click()
        await asyncio.sleep(2.5)

        # Refresh latest messages
        new_msgs = await client.get_messages(bot, limit=5)
        new_latest = None
        for m in new_msgs:
            if not m.out:
                new_latest = m
                break

        buttons_list = []
        if new_latest and new_latest.buttons:
            for r_idx, row in enumerate(new_latest.buttons):
                for c_idx, btn in enumerate(row):
                    buttons_list.append(format_button(btn, r_idx, c_idx))

        out = {
            "action": "clicked_button",
            "clicked_button": btn_label,
            "latest_bot_msg": new_latest.raw_text if new_latest else None,
            "msg_id": new_latest.id if new_latest else None,
            "buttons": buttons_list,
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
    finally:
        await client.disconnect()


async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python telegram_interactive_step.py [status|send <text>|click <id>]"}))
        return

    cmd = sys.argv[1].lower()
    if cmd == "status":
        await action_status()
    elif cmd == "send":
        text = sys.argv[2] if len(sys.argv) > 2 else "/start"
        await action_send(text)
    elif cmd == "click":
        btn_id = sys.argv[2] if len(sys.argv) > 2 else "0:0"
        await action_click(btn_id)
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))


if __name__ == "__main__":
    asyncio.run(main())
