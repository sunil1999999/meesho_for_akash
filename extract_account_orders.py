"""
Extract full orders for active account in Shop WebApp and sync to Supabase
"""

import os
import sys
import json
import urllib.parse
import asyncio
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv()

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import RequestWebViewRequest
from supabase import create_client
import httpx

api_id = os.getenv("TELEGRAM_API_ID")
api_hash = os.getenv("TELEGRAM_API_HASH")
session_str = os.getenv("TELEGRAM_STRING_SESSION")
bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "primes_meesho_bot").lstrip("@")
supa_url = os.getenv("VITE_SUPABASE_URL")
supa_key = os.getenv("VITE_SUPABASE_ANON_KEY")

async def main():
    client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
    await client.connect()

    bot = await client.get_input_entity(bot_username)
    shop_wv = await client(RequestWebViewRequest(
        peer=bot,
        bot=bot,
        url="https://meeshoshop.94.136.188.137.nip.io/?view=history",
        platform="android",
        from_bot_menu=False
    ))

    raw_url = shop_wv.url
    parsed = urllib.parse.urlparse(raw_url)
    init_data = urllib.parse.unquote(parsed.fragment.split("tgWebAppData=")[1].split("&")[0])

    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
        "X-Tg-Init-Data": init_data,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://meeshoshop.94.136.188.137.nip.io/",
    }

    async with httpx.AsyncClient(verify=False, timeout=15.0) as http:
        # Check active account
        r_boot = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/bootstrap", headers=headers)
        boot = r_boot.json()
        active_id = boot.get("active_id")
        active_acc = next((a for a in boot.get("accounts", []) if a["id"] == active_id), None)
        phone = active_acc["mobile"] if active_acc else "7603084875"

        print(f"Active Account in Shop: {phone} (ID: {active_id})")

        # Fetch orders
        r_ord = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/orders", headers=headers)
        orders_resp = r_ord.json()
        orders = orders_resp.get("orders", [])

        print(f"\nTotal Orders Returned: {len(orders)}")
        print("=" * 60)
        print(json.dumps(orders, indent=2))
        print("=" * 60)

        # Sync to Supabase
        supa = create_client(supa_url, supa_key)
        # Find account id in Supabase
        acc_db = supa.table("accounts").select("id").eq("phone_normalized", f"+91{phone}").single().execute()
        account_id = acc_db.data["id"] if acc_db.data else None

        for o in orders:
            order_num = o.get("order_num") or o.get("sub_order_num")
            status_text = o.get("status_text", "").lower()
            product_name = o.get("product_name") or o.get("title") or f"Meesho Order {order_num}"
            amount = float(o.get("price") or o.get("amount") or 0.0)

            # Map status
            delivery_status = "delivered" if "delivered" in status_text else ("cancelled" if "cancel" in status_text else "placed")

            payload = {
                "account_id": account_id,
                "external_order_id": order_num,
                "product_name": product_name,
                "quantity": 1,
                "order_amount": amount,
                "payment_status": "paid",
                "delivery_status": delivery_status,
                "data_source": "telegram_bot",
                "notes": f"Sync from @primes_meesho_bot. Status: {o.get('status_text')}. Delivery date: {o.get('delivery_date')}",
            }

            # Check existing
            existing = supa.table("orders").select("id").eq("external_order_id", order_num).execute()
            if existing.data:
                supa.table("orders").update(payload).eq("external_order_id", order_num).execute()
                print(f"Updated order {order_num} in Supabase")
            else:
                supa.table("orders").insert(payload).execute()
                print(f"Inserted order {order_num} into Supabase")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
