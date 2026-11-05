"""
Auto Add Delivery Address to All Eligible Accounts in Direct Checkout & Pay
=============================================================================
Iterates through all 0-order eligible accounts available in Direct Checkout & Pay,
switches to each account session, and registers the user's delivery address on Meesho.

Address Details:
  - Name: seenu
  - Mobile: 7230986965
  - PIN: 380016
  - House / Flat / Building / Street: drm office opposite GCS hospital
  - Area / Colony / Road: near chamunda bridge
  - Landmark: near chamunda bridge
  - City: ahemdabad
  - State: Gujarat
  - Address Type: Home
"""

import sys
import os
import json
import re
import asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv

# Reconfigure stdout for UTF-8
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv()

from supabase import create_client
from meesho_checkout_bridge import (
    get_accounts,
    select_account,
    get_addresses,
    create_address
)

TARGET_ADDRESS = {
    "name": "seenu",
    "mobile": "7230986965",
    "pin": "380016",
    "address_line_1": "drm office opposite GCS hospital",
    "address_line_2": "near chamunda bridge",
    "landmark": "near chamunda bridge",
    "city": "ahemdabad",
    "state": "Gujarat",
    "address_type": "Home",
    "coordinates": {"latitude": "0", "longitude": "0", "accuracy": "0"}
}

def get_last10(val: any) -> str:
    """Extracts last 10 digits for accurate phone number matching."""
    d = re.sub(r'\D', '', str(val or ''))
    return d[-10:] if len(d) >= 10 else d

def is_sold_account(acc: dict) -> bool:
    """Checks if account is sold in records or monitoring status."""
    st = str(acc.get('status') or '').lower().strip()
    rst = str(acc.get('record_status') or '').lower().strip()
    mst = str(acc.get('monitoring_status') or '').lower().strip()
    if st == 'sold' or rst == 'sold' or mst in ('sold_excluded', 'terminal_sold'):
        return True
    tags = acc.get('tags') or []
    if any(str(t).lower().strip() == 'sold' for t in tags):
        return True
    return False

def is_confirmed_order(o: dict) -> bool:
    """Checks whether an order record represents a genuine confirmed/placed order."""
    ds = str(o.get('delivery_status') or '').lower().strip()
    ps = str(o.get('payment_status') or '').lower().strip()
    cs = str(o.get('cancellation_status') or '').lower().strip()
    if ps == 'failed' or ds == 'failed':
        return False
    if ps == 'pending' and (not ds or ds == 'pending'):
        return False
    if ds == 'cancelled' or cs == 'cancelled':
        return True
    confirmed_delivery_statuses = {
        'placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'rto'
    }
    if ds in confirmed_delivery_statuses:
        return True
    if ps in ('paid', 'cod'):
        return True
    return False

async def main():
    url = os.getenv('SUPABASE_URL')
    key = os.getenv('SUPABASE_KEY')
    if not url or not key:
        print("[Error] Missing SUPABASE_URL or SUPABASE_KEY in environment.")
        sys.exit(1)

    print("=================================================================")
    print(" AUTO-ADDING ADDRESS TO ALL 'DIRECT CHECKOUT & PAY' ACCOUNTS")
    print("=================================================================")
    print(f"Target Address: {TARGET_ADDRESS['name']}, {TARGET_ADDRESS['mobile']}, PIN: {TARGET_ADDRESS['pin']}")
    print(f"Address Lines: {TARGET_ADDRESS['address_line_1']}, {TARGET_ADDRESS['address_line_2']}")
    print(f"City/State: {TARGET_ADDRESS['city']}, {TARGET_ADDRESS['state']}\n")

    print("[1/3] Loading database records and orders from Supabase...")
    client = create_client(url, key)
    db_accs = client.table('accounts').select('*').execute().data or []
    db_orders = client.table('orders').select('*').execute().data or []
    print(f"      Loaded {len(db_accs)} accounts, {len(db_orders)} orders from database.")

    print("[2/3] Fetching active shop accounts from Meesho Checkout Bridge...")
    shop_res = await get_accounts()
    shop_accs = shop_res.get('data', {}).get('accounts', [])
    print(f"      Fetched {len(shop_accs)} shop session accounts.")

    # Build DB account lookup map using last 10 digits & ID
    db_account_map = {}
    for dba in db_accs:
        k1 = get_last10(dba.get('phone_normalized'))
        k2 = get_last10(dba.get('phone_display'))
        k3 = get_last10((dba.get('account_json') or {}).get('mobile')) if isinstance(dba.get('account_json'), dict) else ''
        if k1: db_account_map[k1] = dba
        if k2: db_account_map[k2] = dba
        if k3: db_account_map[k3] = dba
        if dba.get('id'): db_account_map[str(dba['id']).strip()] = dba

    # Exclude accounts with confirmed/placed orders
    excluded_account_ids = set()
    for o in db_orders:
        if is_confirmed_order(o) and o.get('account_id'):
            excluded_account_ids.add(str(o['account_id']).strip())

    # Filter for eligible accounts
    eligible_accounts = []
    for sa in shop_accs:
        k = get_last10(sa.get('mobile'))
        dba = db_account_map.get(k)
        
        status = (dba.get('record_status') or sa.get('status') or sa.get('record_status')) if dba else (sa.get('status') or sa.get('record_status'))
        record_status = (dba.get('record_status') or sa.get('record_status')) if dba else sa.get('record_status')
        monitoring_status = (dba.get('monitoring_status') or sa.get('monitoring_status')) if dba else sa.get('monitoring_status')
        tags = (dba.get('tags') or sa.get('tags')) if dba else sa.get('tags')
        total_orders = dba.get('total_orders_discovered') if dba else None
        
        acc_check = {
            'id': sa.get('id'),
            'status': status,
            'record_status': record_status,
            'monitoring_status': monitoring_status,
            'tags': tags,
            'supabase_id': dba.get('id') if dba else None,
            'order_placed': sa.get('order_placed'),
            'total_orders_discovered': total_orders,
        }

        if is_sold_account(acc_check):
            continue

        shop_id_str = str(sa.get('id', '')).strip()
        supabase_id_str = str(dba.get('id', '')).strip() if dba else None
        if shop_id_str in excluded_account_ids or (supabase_id_str and supabase_id_str in excluded_account_ids):
            continue
        if sa.get('order_placed') is not None:
            continue
        if (total_orders is not None and total_orders > 0) or monitoring_status == 'has_orders':
            continue

        eligible_accounts.append({
            'shop_id': sa.get('id'),
            'mobile': sa.get('mobile'),
            'user_id': sa.get('user_id'),
            'supabase_id': dba.get('id') if dba else None,
        })

    total_eligible = len(eligible_accounts)
    print(f"\n[3/3] Found {total_eligible} eligible 0-order accounts in Direct Checkout & Pay.")
    print("      Beginning automatic address registration...\n")

    results = []
    added_count = 0
    already_present_count = 0
    failed_count = 0

    for idx, acc in enumerate(eligible_accounts, start=1):
        shop_id = acc['shop_id']
        mobile = acc['mobile']
        print(f"[{idx}/{total_eligible}] Processing account +91 {mobile} (Shop ID: {shop_id})...", end=" ", flush=True)

        try:
            # 1. Select account
            sel_res = await select_account(shop_id)
            if not sel_res.get('success'):
                print(f"FAILED (Select account error: {sel_res.get('error')})")
                failed_count += 1
                results.append({
                    'shop_id': shop_id,
                    'mobile': mobile,
                    'status': 'error',
                    'error': f"Select account failed: {sel_res.get('error')}"
                })
                continue

            # 2. Check existing addresses
            addr_res = await get_addresses()
            existing_addrs = addr_res.get('data', {}).get('addresses', []) if addr_res.get('success') else []
            
            # Check if matching address is already present
            existing_match = next((
                a for a in existing_addrs
                if str(a.get('pin', '')).strip() == TARGET_ADDRESS['pin'] and
                   TARGET_ADDRESS['address_line_1'].lower() in str(a.get('address_line_1', '')).lower()
            ), None)

            if existing_match:
                addr_id = existing_match.get('id')
                print(f"ALREADY PRESENT (Address ID: {addr_id})")
                already_present_count += 1
                results.append({
                    'shop_id': shop_id,
                    'mobile': mobile,
                    'status': 'already_present',
                    'address_id': addr_id
                })
                continue

            # 3. Create address on Meesho
            create_res = await create_address(TARGET_ADDRESS)
            if create_res.get('success'):
                created_addr = create_res.get('data', {}).get('address', {})
                if 'address' in created_addr:
                    created_addr = created_addr['address']
                addr_id = created_addr.get('id')
                print(f"SUCCESS (Registered Meesho Address ID: {addr_id})")
                added_count += 1
                results.append({
                    'shop_id': shop_id,
                    'mobile': mobile,
                    'status': 'added',
                    'address_id': addr_id
                })
            else:
                err = create_res.get('error') or create_res.get('message') or 'Unknown error'
                print(f"FAILED ({err})")
                failed_count += 1
                results.append({
                    'shop_id': shop_id,
                    'mobile': mobile,
                    'status': 'failed',
                    'error': err
                })

        except Exception as e:
            print(f"EXCEPTION ({e})")
            failed_count += 1
            results.append({
                'shop_id': shop_id,
                'mobile': mobile,
                'status': 'exception',
                'error': str(e)
            })

        # Polite delay to prevent rate limits
        await asyncio.sleep(0.3)

    # Save summary log
    os.makedirs('exports', exist_ok=True)
    summary_path = os.path.join('exports', 'direct_checkout_addresses_added.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'target_address': TARGET_ADDRESS,
            'total_accounts_processed': total_eligible,
            'added': added_count,
            'already_present': already_present_count,
            'failed': failed_count,
            'details': results
        }, f, indent=2, ensure_ascii=False)

    print("\n=================================================================")
    print(" SUMMARY")
    print("=================================================================")
    print(f" Total Eligible Accounts Processed : {total_eligible}")
    print(f" Addresses Newly Added             : {added_count}")
    print(f" Addresses Already Present         : {already_present_count}")
    print(f" Failed / Errors                   : {failed_count}")
    print(f" Detailed Log Saved                : {os.path.abspath(summary_path)}")
    print("=================================================================\n")

if __name__ == '__main__':
    asyncio.run(main())
