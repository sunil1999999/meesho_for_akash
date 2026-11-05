"""
Continuous Meesho Account and Order Monitoring System
======================================================
Production-grade background worker that continuously processes all available
account JSON records, discovers orders, checks order tabs, and monitors
eligible order statuses indefinitely.

Mandatory Constraints:
- Confirmed DELIVERED and CANCELLED orders are permanently marked is_terminal=True
  and permanently excluded from future status checks.
- Empty Orders tab is verified and recorded as NO_ORDERS_FOUND ('No Orders Placed Yet'),
  never fabricated, and scheduled for periodic recheck.
- Automatic session refresh and token export when 401/expired session is detected.
- Resilient concurrency: a failed/slow account never blocks other accounts.
- Heartbeats persisted to Supabase worker_heartbeats table.
"""

import os
import sys
import time
import json
import random
import signal
import urllib.parse
import asyncio
import re
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv()

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import RequestWebViewRequest
from supabase import create_client, Client
import httpx

# Configuration
API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
SESSION_STR = os.getenv("TELEGRAM_STRING_SESSION")
BOT_USERNAME = (os.getenv("TELEGRAM_BOT_USERNAME") or "primes_meesho_bot").lstrip("@")
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")

if API_ID:
    API_ID = str(API_ID).strip().strip("'\"")
if API_HASH:
    API_HASH = str(API_HASH).strip().strip("'\"")
if SESSION_STR:
    SESSION_STR = str(SESSION_STR).strip().strip("'\"")

WORKER_ID = f"meesho-monitor-worker-{os.getpid()}"
CYCLE_INTERVAL_SEC = int(os.getenv("MONITOR_CYCLE_INTERVAL", "20"))
EMPTY_ORDER_RECHECK_HOURS = int(os.getenv("EMPTY_ORDER_RECHECK_HOURS", "2"))
ACTIVE_ORDER_RECHECK_MINUTES = int(os.getenv("ACTIVE_ORDER_RECHECK_MINUTES", "15"))

# Global shutdown flag
is_running = True


def signal_handler(signum, frame):
    global is_running
    print(f"\n[Worker] Received shutdown signal ({signum}). Cleaning up gracefully...", flush=True)
    is_running = False


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def extract_tracking_id_from_data(ord_data: dict, detail_data: dict = None) -> str:
    """Extracts tracking ID from order payload, shipment details, or text snippets."""
    detail = detail_data or {}
    ship = detail.get("shipment") or {}

    candidates = [
        ship.get("tracking_id"),
        ship.get("tracking_number"),
        ship.get("awb"),
        ship.get("awb_number"),
        ship.get("waybill"),
        ship.get("docket_number"),
        detail.get("tracking_id"),
        detail.get("awb"),
        ord_data.get("tracking_id"),
        ord_data.get("tracking_number"),
        ord_data.get("awb"),
    ]
    for c in candidates:
        if c and isinstance(c, (str, int)):
            s = str(c).strip()
            if len(s) >= 5 and s.lower() not in ("none", "null", "undefined", "n/a", "pending", "not assigned", "-"):
                return s

    text_corpus = " ".join([
        str(ord_data.get("status_text") or ""),
        str(ord_data.get("notes") or ""),
        str(detail.get("status_text") or ""),
        str(ship.get("courier") or ""),
        str(ship.get("status") or "")
    ])

    m = re.search(r'(?:shipment\s+tracking\s*(?:id|number|no|#)?|tracking\s*(?:id|number|no|#)?|awb(?:\s*(?:no|number|#))?|waybill(?:\s*(?:no|number|#))?|courier\s*(?:tracking|ref))\s*[:\-#]?\s*([A-Za-z0-9_-]{5,40})', text_corpus, re.I)
    if m:
        val = m.group(1).strip()
        if val.lower() not in ("none", "null", "undefined", "n/a", "pending", "not assigned", "-"):
            return val

    m_fk = re.search(r'\b(FMPC[0-9A-Za-z]{6,16})\b', text_corpus, re.I)
    if m_fk:
        return m_fk.group(1).strip()

    return None


class ContinuousMeeshoMonitor:
    def __init__(self):
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError(f"Missing Supabase configuration: SUPABASE_URL={bool(SUPABASE_URL)}, SUPABASE_KEY={bool(SUPABASE_KEY)}")
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.client: TelegramClient | None = None
        self.bot_entity = None
        self.cycle_count = 0
        self.stats = {
            "accounts_processed": 0,
            "orders_discovered": 0,
            "terminal_orders_excluded": 0,
            "active_orders_polled": 0,
            "empty_orders_count": 0,
            "failed_checks": 0,
            "refreshed_sessions": 0,
        }

    async def init_telegram(self):
        if not API_ID or not API_HASH or not SESSION_STR:
            raise RuntimeError(f"Missing Telegram credentials: API_ID={bool(API_ID)}, API_HASH={bool(API_HASH)}, SESSION_STR={bool(SESSION_STR)}")
        for attempt in range(5):
            try:
                print(f"[Worker] Connecting to Telegram MTProto (attempt {attempt + 1})...", flush=True)
                self.client = TelegramClient(StringSession(SESSION_STR), int(API_ID), API_HASH, timeout=20)
                await self.client.connect()
                if not await self.client.is_user_authorized():
                    raise RuntimeError("Telegram string session is not authorized!")
                me = await self.client.get_me()
                print(f"[Worker] Authorized as @{me.username or me.first_name} ({me.phone})", flush=True)
                self.bot_entity = await self.client.get_input_entity(BOT_USERNAME)
                print(f"[Worker] Located bot @{BOT_USERNAME}", flush=True)
                return
            except Exception as e:
                print(f"[Worker] Telegram connection error: {e}. Retrying in 2.5s...", flush=True)
                await asyncio.sleep(2.5)
        raise RuntimeError("Failed to connect to Telegram MTProto after 5 attempts.")

    async def ensure_connected(self):
        if not self.client:
            await self.init_telegram()
            return
        if not self.client.is_connected():
            for attempt in range(5):
                try:
                    await self.client.connect()
                    if await self.client.is_user_authorized():
                        if not self.bot_entity:
                            self.bot_entity = await self.client.get_input_entity(BOT_USERNAME)
                        return
                except Exception as e:
                    print(f"[Worker] Reconnection attempt {attempt + 1} failed: {e}. Retrying...", flush=True)
                    await asyncio.sleep(2.0)
            raise RuntimeError("Telegram client disconnected and failed to reconnect.")
        if not self.bot_entity:
            self.bot_entity = await self.client.get_input_entity(BOT_USERNAME)

    async def send_heartbeat(self, status: str = "running", duration_sec: float = 0.0):
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            payload = {
                "id": WORKER_ID,
                "status": status,
                "last_heartbeat": now_iso,
                "current_cycle": self.cycle_count,
                "accounts_processed": self.stats["accounts_processed"],
                "orders_discovered": self.stats["orders_discovered"],
                "terminal_orders_excluded": self.stats["terminal_orders_excluded"],
                "active_orders_polled": self.stats["active_orders_polled"],
                "empty_orders_count": self.stats["empty_orders_count"],
                "last_cycle_duration_sec": round(duration_sec, 2),
                "metadata": {
                    "stats": self.stats,
                    "pid": os.getpid(),
                    "host": os.getenv("COMPUTERNAME", "localhost"),
                    "updated_at": now_iso,
                },
                "updated_at": now_iso,
            }
            # Upsert heartbeat
            existing = self.supabase.table("worker_heartbeats").select("id").eq("id", WORKER_ID).execute()
            if existing.data:
                self.supabase.table("worker_heartbeats").update(payload).eq("id", WORKER_ID).execute()
            else:
                self.supabase.table("worker_heartbeats").insert(payload).execute()
        except Exception as e:
            print(f"[Heartbeat] Error updating heartbeat: {e}")

    async def get_authorized_shop_headers(self, view: str = "history") -> dict:
        """Obtain authentic Telegram WebApp initData headers"""
        await self.ensure_connected()
        url = f"https://meeshoshop.94.136.188.137.nip.io/?view={view}"
        shop_wv = await self.client(RequestWebViewRequest(
            peer=self.bot_entity,
            bot=self.bot_entity,
            url=url,
            platform="android",
            from_bot_menu=False
        ))
        raw_url = shop_wv.url
        parsed = urllib.parse.urlparse(raw_url)
        init_data = urllib.parse.unquote(parsed.fragment.split("tgWebAppData=")[1].split("&")[0])

        return {
            "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
            "X-Tg-Init-Data": init_data,
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://meeshoshop.94.136.188.137.nip.io/",
        }

    async def refresh_account_session(self, account_rec: dict, shop_acct_id: int) -> bool:
        """
        Refreshes an expired session via POST /api/accounts/refresh,
        exports via POST /api/account/export_file, downloads the file from
        Telegram chat, and updates Supabase accounts.account_json.
        """
        phone = account_rec.get("phone_normalized", "").replace("+91", "").strip()
        print(f"[Session Refresh] Attempting token refresh for account {account_rec['phone_display']} (Shop ID: {shop_acct_id})...")

        try:
            headers = await self.get_authorized_shop_headers("account")
            async with httpx.AsyncClient(verify=False, timeout=15.0) as http:
                # Select the account first
                await http.post(
                    "https://meeshoshop.94.136.188.137.nip.io/api/accounts/select",
                    headers=headers,
                    json={"account_id": shop_acct_id}
                )

                # Trigger refresh in WebApp
                r_ref = await http.post(
                    "https://meeshoshop.94.136.188.137.nip.io/api/accounts/refresh",
                    headers=headers,
                    json={"account_id": shop_acct_id}
                )
                print(f"[Session Refresh] WebApp refresh API status: {r_ref.status_code}")

                # Trigger export to chat
                r_exp = await http.post(
                    "https://meeshoshop.94.136.188.137.nip.io/api/account/export_file",
                    headers=headers
                )
                print(f"[Session Refresh] WebApp export_file API status: {r_exp.status_code}")

            await asyncio.sleep(2.5)

            # Check bot chat for exported json
            msgs = await self.client.get_messages(self.bot_entity, limit=3)
            for m in msgs:
                if m.file and m.file.name and m.file.name.endswith(".json"):
                    dl_path = await self.client.download_media(m, file="scratch/")
                    with open(dl_path, "r", encoding="utf-8") as f:
                        fresh_json = json.load(f)

                    if fresh_json.get("xo"):
                        old_json = account_rec.get("account_json") or {}
                        merged_json = {**old_json, **fresh_json}
                        now_iso = datetime.now(timezone.utc).isoformat()

                        self.supabase.table("accounts").update({
                            "account_json": merged_json,
                            "requires_attention": False,
                            "attention_reason": None,
                            "updated_at": now_iso,
                        }).eq("id", account_rec["id"]).execute()

                        print(f"[Session Refresh] SUCCESS! Updated Supabase with fresh xo token for {account_rec['phone_display']}.")
                        self.stats["refreshed_sessions"] += 1
                        return True

            return False
        except Exception as e:
            print(f"[Session Refresh] Error during session refresh: {e}")
            return False

    async def link_account_to_bot_if_missing(self, account_rec: dict, existing_shop_mobiles: set) -> bool:
        """Links an unlinked account by pasting its JSON as a text message to the bot"""
        phone = account_rec.get("phone_normalized", "").replace("+91", "").strip()
        if phone in existing_shop_mobiles:
            return True

        print(f"[Account Link] Account {account_rec['phone_display']} is not in bot shop accounts. Linking now...")
        acct_json = account_rec.get("account_json") or {}
        xo = str(acct_json.get("xo") or "").strip()
        now_dt = datetime.now(timezone.utc)

        # Skip placeholder / sample tokens or empty tokens
        if not xo or xo.startswith("x-auth-sample") or len(xo) < 20:
            print(f"[Account Link] Skipping link for {account_rec['phone_display']}: No valid xo token in account_json.")
            try:
                self.supabase.table("accounts").update({
                    "next_check_at": (now_dt + timedelta(hours=24)).isoformat(),
                    "monitoring_status": "no_token",
                }).eq("id", account_rec["id"]).execute()
            except Exception:
                pass
            return False

        print(f"[Account Link] Account {account_rec['phone_display']} is not in bot shop accounts. Linking now...")
        await self.ensure_connected()

        try:
            # Send /start
            await self.client.send_message(self.bot_entity, "/start")
            await asyncio.sleep(2.0)

            # Get latest message & click [➕ Add Account]
            msgs = await self.client.get_messages(self.bot_entity, limit=2)
            if msgs and msgs[0].buttons:
                for row in msgs[0].buttons:
                    for btn in row:
                        if getattr(btn, 'data', b'') == b'add_account':
                            await btn.click()
                            break
            await asyncio.sleep(2.0)

            # Click [📋 Import JSON session]
            msgs2 = await self.client.get_messages(self.bot_entity, limit=2)
            if msgs2 and msgs2[0].buttons:
                for row in msgs2[0].buttons:
                    for btn in row:
                        if getattr(btn, 'data', b'') == b'add:json':
                            await btn.click()
                            break
            await asyncio.sleep(2.0)

            # Send JSON as plain text
            payload_str = json.dumps(acct_json)
            await self.client.send_message(self.bot_entity, payload_str)
            await asyncio.sleep(3.5)

            # Verify response
            msgs3 = await self.client.get_messages(self.bot_entity, limit=2)
            if msgs3 and "saved" in msgs3[0].raw_text.lower():
                print(f"[Account Link] Bot confirmed import for {account_rec['phone_display']}: {msgs3[0].raw_text.strip()[:60]}")
                return True
            else:
                raw_resp = msgs3[0].raw_text.strip()[:80] if msgs3 else "No reply"
                print(f"[Account Link] Bot response: {raw_resp}")
                # Set 12h backoff so we do not repeatedly spam the bot on every 20s cycle
                try:
                    self.supabase.table("accounts").update({
                        "next_check_at": (now_dt + timedelta(hours=12)).isoformat(),
                        "monitoring_status": "attention_required",
                        "attention_reason": f"Telegram Bot Link failed: {raw_resp}",
                    }).eq("id", account_rec["id"]).execute()
                except Exception:
                    pass
                return False
        except Exception as e:
            print(f"[Account Link] Exception while linking account: {e}")
            return False

    async def switch_active_shop_account(self, headers: dict, target_account_id: int) -> bool:
        """Switches the active account in the Shop WebApp using /api/accounts/select"""
        try:
            async with httpx.AsyncClient(verify=False, timeout=10.0) as http:
                res = await http.post(
                    "https://meeshoshop.94.136.188.137.nip.io/api/accounts/select",
                    headers=headers,
                    json={"account_id": target_account_id}
                )
                return res.status_code == 200
        except Exception as e:
            print(f"[Account Switch] Error switching account: {e}")
            return False

    async def process_account_order_discovery(self, account: dict, shop_accounts: list, headers: dict):
        """
        Discovers orders for an account. Correctly interprets empty results as
        NO_ORDERS_FOUND without fabricating records.
        """
        acct_id = account["id"]
        phone_norm = account["phone_normalized"]
        phone_raw = phone_norm.replace("+91", "").strip()
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()

        # Find matching account in shop
        match_shop = next((s for s in shop_accounts if str(s.get("mobile")) == phone_raw), None)
        if not match_shop:
            # Re-fetch latest shop accounts list in case account was linked recently
            try:
                async with httpx.AsyncClient(verify=False, timeout=10.0) as http_rf:
                    r_rf = await http_rf.get("https://meeshoshop.94.136.188.137.nip.io/api/accounts/list", headers=headers)
                    if r_rf.status_code == 200:
                        shop_accounts = r_rf.json().get("accounts", [])
                        match_shop = next((s for s in shop_accounts if str(s.get("mobile")) == phone_raw), None)
            except Exception:
                pass

        if not match_shop:
            print(f"[Discovery] Account {account['phone_display']} not found in Shop accounts list. Retrying in 2m.")
            try:
                self.supabase.table("accounts").update({
                    "next_check_at": (now_dt + timedelta(minutes=2)).isoformat(),
                    "last_checked_at": now_iso,
                }).eq("id", acct_id).execute()
            except Exception:
                pass
            return

        shop_acct_id = match_shop["id"]

        # Switch active account to this one
        switched = await self.switch_active_shop_account(headers, shop_acct_id)
        if not switched:
            print(f"[Discovery] Could not switch to shop account {shop_acct_id}. Retrying next cycle.")
            return

        await asyncio.sleep(1.0)

        # Query /api/orders targeting shop_acct_id
        async with httpx.AsyncClient(verify=False, timeout=15.0) as http:
            r_ord = await http.get(f"https://meeshoshop.94.136.188.137.nip.io/api/orders?account_id={shop_acct_id}", headers=headers)
            if r_ord.status_code != 200 or not r_ord.json().get("orders"):
                # Fallback to plain /api/orders
                r_ord = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/orders", headers=headers)

            # Case A: Session Expired / HTTP 401
            if r_ord.status_code == 502 or "401" in r_ord.text or "session expired" in r_ord.text.lower():
                print(f"[Discovery] Session expired for {account['phone_display']}. Initiating automatic refresh...")
                refreshed = await self.refresh_account_session(account, shop_acct_id)
                if not refreshed:
                    # Mark attention required
                    next_check = (now_dt + timedelta(minutes=30)).isoformat()
                    self.supabase.table("accounts").update({
                        "requires_attention": True,
                        "attention_reason": "Session expired (HTTP 401). Automatic token refresh queued.",
                        "monitoring_status": "attention_required",
                        "next_check_at": next_check,
                        "last_checked_at": now_iso,
                    }).eq("id", acct_id).execute()
                    self.stats["failed_checks"] += 1
                    return
                else:
                    # Retry query with fresh headers
                    headers = await self.get_authorized_shop_headers("history")
                    r_ord = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/orders", headers=headers)

            # Case B: Other HTTP error
            if r_ord.status_code != 200:
                print(f"[Discovery] HTTP Error {r_ord.status_code} fetching orders for {account['phone_display']}. Not marking as empty.")
                next_check = (now_dt + timedelta(minutes=15)).isoformat()
                self.supabase.table("accounts").update({
                    "consecutive_failures": (account.get("consecutive_failures") or 0) + 1,
                    "next_check_at": next_check,
                    "last_checked_at": now_iso,
                }).eq("id", acct_id).execute()
                self.stats["failed_checks"] += 1
                return

            # Parse response
            try:
                data = r_ord.json()
            except Exception as e:
                print(f"[Discovery] Failed to parse JSON orders response: {e}")
                return

            orders_list = data.get("orders", [])

            # ----------------------------------------------------
            # REQUIREMENT 3: CORRECTLY INTERPRET AN EMPTY ORDERS TAB
            # ----------------------------------------------------
            if len(orders_list) == 0:
                print(f"[Discovery] No orders found for {account['phone_display']}.")
                next_check = (now_dt + timedelta(hours=EMPTY_ORDER_RECHECK_HOURS)).isoformat()
                self.supabase.table("accounts").update({
                    "monitoring_status": "no_orders_found",
                    "requires_attention": False,
                    "attention_reason": None,
                    "consecutive_failures": 0,
                    "total_orders_discovered": 0,
                    "last_checked_at": now_iso,
                    "next_check_at": next_check,
                }).eq("id", acct_id).execute()
                self.stats["empty_orders_count"] += 1
                self.stats["accounts_processed"] += 1
                return

            # ----------------------------------------------------
            # REQUIREMENT 4 & 5: PROCESS DISCOVERED ORDERS & MANAGE TERMINAL STATES
            # ----------------------------------------------------
            print(f"[Discovery] Discovered {len(orders_list)} order(s) for {account['phone_display']}.")
            self.stats["orders_discovered"] += len(orders_list)

            for ord_data in orders_list:
                order_num = ord_data.get("order_num") or ord_data.get("sub_order_num")
                if not order_num:
                    continue

                sub_order_num = ord_data.get("sub_order_num") or f"{order_num}_1"
                status_text = (ord_data.get("status_text") or "").strip()
                status_lower = status_text.lower()
                product_name = ord_data.get("product_name") or ord_data.get("title") or f"Meesho Order {order_num}"
                amount = float(ord_data.get("price") or ord_data.get("amount") or 0.0)
                pay_status = "paid"

                # Extract rich details including exact amount and product name via /api/orders/detail
                d_payload = None
                try:
                    async with httpx.AsyncClient(verify=False, timeout=8.0) as http_det:
                        r_det = await http_det.post(
                            "https://meeshoshop.94.136.188.137.nip.io/api/orders/detail",
                            headers=headers,
                            json={"order_num": order_num, "sub_order_num": sub_order_num}
                        )
                        if r_det.status_code == 200:
                            d_payload = r_det.json()
                            p = d_payload.get("product") or {}
                            pay = d_payload.get("payment") or {}
                            ship = d_payload.get("shipment") or {}

                            ext_amount = float(pay.get("total") or p.get("price") or 0.0)
                            if ext_amount > 0:
                                amount = ext_amount

                            if p.get("name"):
                                product_name = p.get("name")

                            pay_mode = (pay.get("mode") or "").lower()
                            pay_status = "cod" if "cod" in pay_mode else "paid"
                except Exception as e_det:
                    print(f"[Discovery] Could not fetch detail for order {order_num}: {e_det}")

                # Extract tracking ID if available
                extracted_tracking = extract_tracking_id_from_data(ord_data, d_payload)

                status_id_lower = (ord_data.get("status_id") or "").lower()
                is_delivered = "delivered" in status_lower or "delivered" in status_id_lower
                is_cancelled = "cancel" in status_lower or "cancel" in status_id_lower

                is_terminal = is_delivered or is_cancelled
                terminal_confirmed_at = now_iso if is_terminal else None

                if is_delivered:
                    delivery_status = "delivered"
                    monitoring_status = "terminal_delivered"
                    cancellation_status = "none"
                    next_check = None  # Permanently exclude from future polling
                elif is_cancelled:
                    delivery_status = "cancelled"
                    monitoring_status = "terminal_cancelled"
                    cancellation_status = "cancelled"
                    next_check = None  # Permanently exclude from future polling
                elif "out" in status_lower or "out_for_delivery" in status_id_lower:
                    delivery_status = "out_for_delivery"
                    monitoring_status = "monitoring"
                    cancellation_status = "none"
                    next_check = (now_dt + timedelta(minutes=ACTIVE_ORDER_RECHECK_MINUTES)).isoformat()
                elif "shipped" in status_lower or "way" in status_lower or "shipped" in status_id_lower or "dispatch" in status_lower:
                    delivery_status = "shipped"
                    monitoring_status = "monitoring"
                    cancellation_status = "none"
                    next_check = (now_dt + timedelta(minutes=ACTIVE_ORDER_RECHECK_MINUTES)).isoformat()
                else:
                    delivery_status = "placed"
                    monitoring_status = "monitoring"
                    cancellation_status = "none"
                    next_check = (now_dt + timedelta(minutes=ACTIVE_ORDER_RECHECK_MINUTES)).isoformat()

                # Upsert order into Supabase
                order_payload = {
                    "account_id": acct_id,
                    "external_order_id": str(order_num),
                    "product_name": product_name,
                    "sku": ord_data.get("catalog_id") and f"CAT-{ord_data['catalog_id']}",
                    "quantity": ord_data.get("quantity") or 1,
                    "order_amount": amount,
                    "payment_status": pay_status,
                    "delivery_status": delivery_status,
                    "cancellation_status": cancellation_status,
                    "data_source": "telegram_bot",
                    "notes": f"Discovered via @primes_meesho_bot WebApp. Status: {status_text}. Delivery: {ord_data.get('delivery_date')}",
                    "is_terminal": is_terminal,
                    "terminal_confirmed_at": terminal_confirmed_at,
                    "monitoring_status": monitoring_status,
                    "last_checked_at": now_iso,
                    "next_check_at": next_check,
                    "updated_at": now_iso,
                }
                if extracted_tracking:
                    order_payload["tracking_id"] = extracted_tracking

                # Check existing order
                existing_ord = self.supabase.table("orders").select("id, is_terminal, delivery_status, tracking_id").eq("external_order_id", str(order_num)).execute()
                if existing_ord.data:
                    current = existing_ord.data[0]
                    # Do not overwrite a valid tracking ID with empty/null
                    if not extracted_tracking and current.get("tracking_id"):
                        order_payload["tracking_id"] = current["tracking_id"]
                    # Respect Requirement 5: Never reactivate an already terminal order
                    if current.get("is_terminal"):
                        order_payload["is_terminal"] = True
                        order_payload["next_check_at"] = None
                        self.stats["terminal_orders_excluded"] += 1

                    self.supabase.table("orders").update(order_payload).eq("id", current["id"]).execute()
                else:
                    order_payload["created_at"] = now_iso
                    self.supabase.table("orders").insert(order_payload).execute()

            # Auto-tagging: When orders are discovered, tag account as 'used_order_placed'
            existing_tags = account.get("tags") or []
            if "used_order_placed" not in existing_tags:
                updated_tags = list(existing_tags) + ["used_order_placed"]
            else:
                updated_tags = existing_tags

            # Smart Polling: If all orders are terminal (delivered/cancelled/rto), cold-check every 24h
            all_terminal = all(
                (ord_data.get("status_text") or "").strip().lower() in ("delivered", "cancelled", "returned", "rto")
                for ord_data in orders_list
            )
            if all_terminal:
                acct_next_check = (now_dt + timedelta(hours=24)).isoformat()
            else:
                acct_next_check = (now_dt + timedelta(minutes=30)).isoformat()

            self.supabase.table("accounts").update({
                "monitoring_status": "has_orders",
                "total_orders_discovered": len(orders_list),
                "tags": updated_tags,
                "requires_attention": False,
                "attention_reason": None,
                "consecutive_failures": 0,
                "last_checked_at": now_iso,
                "next_check_at": acct_next_check,
            }).eq("id", acct_id).execute()

            self.stats["accounts_processed"] += 1

    async def poll_active_non_terminal_orders(self, headers: dict):
        """
        REQUIREMENT 6: Continuously monitor all non-terminal orders.
        Permanently skips any order where is_terminal=TRUE.
        """
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()

        # Strictly filter out terminal orders: is_terminal = FALSE
        orders_res = self.supabase.table("orders") \
            .select("id, external_order_id, account_id, delivery_status, accounts(phone_normalized)") \
            .eq("is_terminal", False) \
            .lte("next_check_at", now_iso) \
            .limit(5) \
            .execute()

        non_terminal_orders = orders_res.data or []
        if not non_terminal_orders:
            return

        print(f"[Order Polling] Found {len(non_terminal_orders)} non-terminal order(s) due for check.")
        self.stats["active_orders_polled"] += len(non_terminal_orders)

        # For each order, check updated status
        # If transitions to Delivered or Cancelled, mark terminal permanently
        for o in non_terminal_orders:
            order_num = str(o.get("external_order_id") or "")
            print(f"[Order Polling] Checking order {order_num}...")

            is_terminal = False
            delivery_status = o.get("delivery_status") or "placed"
            monitoring_status = "monitoring"
            polled_tracking = None

            try:
                async with httpx.AsyncClient(verify=False, timeout=8.0) as http_det:
                    r_det = await http_det.post(
                        "https://meeshoshop.94.136.188.137.nip.io/api/orders/detail",
                        headers=headers,
                        json={"order_num": order_num, "sub_order_num": f"{order_num}_1"}
                    )
                    if r_det.status_code == 200:
                        d = r_det.json()
                        polled_tracking = extract_tracking_id_from_data(o, d)
                        ship = d.get("shipment") or {}
                        raw_status = (ship.get("status") or d.get("status_text") or "").lower()
                        if "delivered" in raw_status:
                            delivery_status = "delivered"
                            monitoring_status = "terminal_delivered"
                            is_terminal = True
                        elif "cancel" in raw_status:
                            delivery_status = "cancelled"
                            monitoring_status = "terminal_cancelled"
                            is_terminal = True
                        elif "shipped" in raw_status:
                            delivery_status = "shipped"
                        elif "out" in raw_status:
                            delivery_status = "out_for_delivery"
            except Exception as e_poll:
                print(f"[Order Polling] Detail check error for {order_num}: {e_poll}")

            if is_terminal:
                print(f"[Order Polling] Order {order_num} transitioned to {delivery_status.upper()}! Marking terminal permanently.")
                upd_payload = {
                    "delivery_status": delivery_status,
                    "monitoring_status": monitoring_status,
                    "is_terminal": True,
                    "terminal_confirmed_at": now_iso,
                    "delivery_status_changed_at": now_iso,
                    "last_checked_at": now_iso,
                    "next_check_at": None,
                }
                if delivery_status == "delivered":
                    upd_payload["delivered_at"] = now_iso
                if polled_tracking:
                    upd_payload["tracking_id"] = polled_tracking
                self.supabase.table("orders").update(upd_payload).eq("id", o["id"]).execute()
                self.stats["terminal_orders_excluded"] += 1
            else:
                next_check = (now_dt + timedelta(minutes=ACTIVE_ORDER_RECHECK_MINUTES)).isoformat()
                active_upd = {
                    "delivery_status": delivery_status,
                    "last_checked_at": now_iso,
                    "next_check_at": next_check,
                }
                if polled_tracking:
                    active_upd["tracking_id"] = polled_tracking
                self.supabase.table("orders").update(active_upd).eq("id", o["id"]).execute()

    async def run_monitoring_cycle(self):
        """Executes a complete single monitoring cycle across accounts and orders"""
        cycle_start = time.time()
        self.cycle_count += 1
        now_iso = datetime.now(timezone.utc).isoformat()
        print(f"\n" + "=" * 65)
        print(f"[Cycle {self.cycle_count}] Starting at {now_iso}")
        print("=" * 65)

        # 1. Fetch authentic WebApp headers
        try:
            headers = await self.get_authorized_shop_headers("history")
        except Exception as e:
            print(f"[Cycle {self.cycle_count}] Failed to get WebApp authorization: {e}")
            await self.send_heartbeat(status="error", duration_sec=time.time() - cycle_start)
            return

        # 2. Fetch current Shop accounts list
        shop_accounts = []
        try:
            async with httpx.AsyncClient(verify=False, timeout=12.0) as http:
                r_acc = await http.get("https://meeshoshop.94.136.188.137.nip.io/api/accounts/list", headers=headers)
                if r_acc.status_code == 200:
                    shop_accounts = r_acc.json().get("accounts", [])
        except Exception as e:
            print(f"[Cycle {self.cycle_count}] Error fetching shop accounts: {e}")

        shop_mobiles = {str(a.get("mobile")) for a in shop_accounts}
        print(f"[Cycle {self.cycle_count}] Linked accounts in Shop: {len(shop_accounts)} ({', '.join(shop_mobiles)})")

        # 3. Load all available accounts from Supabase database
        accounts_res = self.supabase.table("accounts") \
            .select("id, phone_normalized, phone_display, account_json, record_status, monitoring_status, next_check_at, consecutive_failures, tags, total_orders_discovered, last_checked_at") \
            .eq("is_archived", False) \
            .order("next_check_at", desc=False) \
            .execute()

        all_accounts = accounts_res.data or []
        print(f"[Cycle {self.cycle_count}] Total available active accounts in database: {len(all_accounts)}")

        # 4. Process each account safely with Smart Polling (priority on 0-order & due accounts)
        for account in all_accounts:
            if not is_running:
                break

            # Requirement: Sold accounts are permanently excluded from polling
            if account.get("record_status") == "sold" or account.get("monitoring_status") == "sold_excluded":
                if account.get("monitoring_status") != "sold_excluded" or account.get("next_check_at") is not None:
                    self.supabase.table("accounts").update({
                        "monitoring_status": "sold_excluded",
                        "next_check_at": None,
                    }).eq("id", account["id"]).execute()
                    self.supabase.table("orders").update({
                        "is_terminal": True,
                        "monitoring_status": "terminal_sold",
                        "next_check_at": None,
                        "terminal_confirmed_at": now_iso,
                    }).eq("account_id", account["id"]).execute()
                self.stats["terminal_orders_excluded"] += 1
                continue

            # Smart Polling: Accounts with 0 discovered orders or pending/unchecked status are prioritized and checked immediately!
            total_orders = account.get("total_orders_discovered") or 0
            has_been_checked = bool(account.get("last_checked_at"))
            is_prioritized = (total_orders == 0) or (not has_been_checked) or (account.get("monitoring_status") == "pending")

            if not is_prioritized:
                next_check = account.get("next_check_at")
                if next_check:
                    try:
                        next_check_dt = datetime.fromisoformat(next_check.replace("Z", "+00:00"))
                        if next_check_dt > datetime.now(timezone.utc):
                            continue
                    except Exception:
                        pass

            try:
                # Check if account is linked in shop, link if not
                phone_raw = account.get("phone_normalized", "").replace("+91", "").strip()
                if phone_raw not in shop_mobiles:
                    linked = await self.link_account_to_bot_if_missing(account, shop_mobiles)
                    if linked:
                        # Re-fetch shop_accounts so discovery has the newly linked account immediately
                        try:
                            async with httpx.AsyncClient(verify=False, timeout=10.0) as http_rel:
                                r_rel = await http_rel.get("https://meeshoshop.94.136.188.137.nip.io/api/accounts/list", headers=headers)
                                if r_rel.status_code == 200:
                                    shop_accounts = r_rel.json().get("accounts", [])
                                    shop_mobiles = {str(a.get("mobile")) for a in shop_accounts}
                        except Exception:
                            pass

                # Discover orders and interpret empty orders
                await self.process_account_order_discovery(account, shop_accounts, headers)
            except Exception as acc_err:
                print(f"[Cycle {self.cycle_count}] Error processing account {account['phone_display']}: {acc_err}")
                self.stats["failed_checks"] += 1

        # 5. Poll active non-terminal orders
        if is_running:
            try:
                await self.poll_active_non_terminal_orders(headers)
            except Exception as ord_err:
                print(f"[Cycle {self.cycle_count}] Error polling active orders: {ord_err}")

        # 6. Count terminal orders & sold accounts permanently excluded
        try:
            term_res = self.supabase.table("orders").select("id", count="exact").eq("is_terminal", True).execute()
            sold_acc_res = self.supabase.table("accounts").select("id", count="exact").eq("record_status", "sold").execute()
            self.stats["terminal_orders_excluded"] = (term_res.count or 0) + (sold_acc_res.count or 0)
        except:
            pass

        duration = time.time() - cycle_start
        print(f"[Cycle {self.cycle_count}] Completed in {duration:.2f}s.")
        print(f"Stats: Accounts Processed={self.stats['accounts_processed']}, Orders Discovered={self.stats['orders_discovered']}, Active Orders Polled={self.stats['active_orders_polled']}, Empty Accounts={self.stats['empty_orders_count']}, Terminal Excluded={self.stats['terminal_orders_excluded']}")
        await self.send_heartbeat(status="running", duration_sec=duration)

    async def run_forever(self, single_run: bool = False):
        await self.init_telegram()
        await self.send_heartbeat(status="starting")

        print(f"[Worker] Continuous Meesho Order Monitoring Engine started. Cycle interval: {CYCLE_INTERVAL_SEC}s.", flush=True)
        try:
            while is_running:
                try:
                    await self.run_monitoring_cycle()
                except Exception as cycle_err:
                    print(f"[Worker] Error in monitoring cycle: {cycle_err}", flush=True)
                    import traceback
                    traceback.print_exc()
                if single_run or not is_running:
                    break
                print(f"[Worker] Sleeping {CYCLE_INTERVAL_SEC}s until next monitoring cycle...", flush=True)
                await asyncio.sleep(CYCLE_INTERVAL_SEC)
        finally:
            print(f"[Worker] Shutting down worker...", flush=True)
            await self.send_heartbeat(status="stopped")
            if self.client:
                try:
                    await self.client.disconnect()
                except Exception:
                    pass
            print("[Worker] Clean shutdown complete.", flush=True)


async def main():
    single_run = "--run-once" in sys.argv
    monitor = ContinuousMeeshoMonitor()
    await monitor.run_forever(single_run=single_run)


if __name__ == "__main__":
    asyncio.run(main())
