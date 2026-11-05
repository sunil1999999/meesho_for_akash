"""
Export All Accounts JSON Available in 'Direct Checkout & Pay'
==============================================================
Extracts the exact set of eligible zero-order accounts available in the Direct Checkout & Pay module,
merging bridge shop sessions with Supabase database records, and outputs clean, usable JSON export files.
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
from meesho_checkout_bridge import get_accounts

def get_last10(val: any) -> str:
    """Extracts last 10 digits for accurate phone number matching across formats."""
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

    print("[1/4] Connecting to Supabase...")
    client = create_client(url, key)
    db_accs_res = client.table('accounts').select('*').execute()
    db_accs = db_accs_res.data or []
    print(f"       Fetched {len(db_accs)} account records from Supabase.")

    db_orders_res = client.table('orders').select('*').execute()
    db_orders = db_orders_res.data or []
    print(f"       Fetched {len(db_orders)} order records from Supabase.")

    print("[2/4] Fetching active shop accounts from Meesho Checkout Bridge...")
    shop_res = await get_accounts()
    shop_accs = shop_res.get('data', {}).get('accounts', [])
    print(f"       Fetched {len(shop_accs)} shop session accounts.")

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

    # Scan confirmed orders to identify excluded accounts
    excluded_account_ids = set()
    for o in db_orders:
        if is_confirmed_order(o) and o.get('account_id'):
            excluded_account_ids.add(str(o['account_id']).strip())
    print(f"       Identified {len(excluded_account_ids)} accounts with confirmed/placed orders.")

    # Enrich and filter shop accounts according to Direct Checkout rules
    eligible_raw_json_list = []
    eligible_full_records = []

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

        # Check Sold
        if is_sold_account(acc_check):
            continue

        # Check Order History Exclusions
        shop_id_str = str(sa.get('id', '')).strip()
        supabase_id_str = str(dba.get('id', '')).strip() if dba else None
        if shop_id_str in excluded_account_ids or (supabase_id_str and supabase_id_str in excluded_account_ids):
            continue
        if sa.get('order_placed') is not None:
            continue
        if (total_orders is not None and total_orders > 0) or monitoring_status == 'has_orders':
            continue

        # Account is ELIGIBLE in Direct Checkout & Pay!
        raw_account_json = dba.get('account_json') if dba else {
            'mobile': sa.get('mobile'),
            'user_id': sa.get('user_id'),
            'id': sa.get('id'),
        }

        eligible_raw_json_list.append(raw_account_json)
        eligible_full_records.append({
            'direct_checkout_id': sa.get('id'),
            'mobile': sa.get('mobile'),
            'user_id': sa.get('user_id'),
            'supabase_id': dba.get('id') if dba else None,
            'record_status': record_status or 'active',
            'monitoring_status': monitoring_status or 'no_orders_found',
            'xo_exp': sa.get('xo_exp'),
            'account_json': raw_account_json
        })

    print(f"\n[3/4] Successfully identified {len(eligible_raw_json_list)} eligible accounts in 'Direct Checkout & Pay'.")

    # Export to files
    os.makedirs('exports', exist_ok=True)

    # 1. Main JSON file: Array of raw account JSON objects (compatible with Meesho bots / import)
    main_file = 'direct_checkout_accounts.json'
    with open(main_file, 'w', encoding='utf-8') as f:
        json.dump(eligible_raw_json_list, f, indent=2, ensure_ascii=False)
    print(f"       Saved primary raw JSON array: {os.path.abspath(main_file)}")

    # 2. Exports directory copy
    exports_raw = os.path.join('exports', 'direct_checkout_accounts.json')
    with open(exports_raw, 'w', encoding='utf-8') as f:
        json.dump(eligible_raw_json_list, f, indent=2, ensure_ascii=False)
    print(f"       Saved copy to: {os.path.abspath(exports_raw)}")

    # 3. Full enriched metadata JSON file
    exports_full = os.path.join('exports', 'direct_checkout_accounts_full.json')
    with open(exports_full, 'w', encoding='utf-8') as f:
        json.dump({
            'exported_at': datetime.now(timezone.utc).isoformat(),
            'total_eligible_accounts': len(eligible_full_records),
            'filter_criteria': '0 confirmed/placed orders on Meesho, status != sold',
            'accounts': eligible_full_records
        }, f, indent=2, ensure_ascii=False)
    print(f"       Saved full enriched JSON to: {os.path.abspath(exports_full)}")

    # 4. JSONL format
    exports_jsonl = os.path.join('exports', 'direct_checkout_accounts.jsonl')
    with open(exports_jsonl, 'w', encoding='utf-8') as f:
        for acc in eligible_raw_json_list:
            f.write(json.dumps(acc, ensure_ascii=False) + '\n')
    print(f"       Saved JSON Lines (NDJSON) to: {os.path.abspath(exports_jsonl)}")

    print(f"\n[4/4] Export Completed Successfully! Total: {len(eligible_raw_json_list)} accounts.\n")

if __name__ == '__main__':
    asyncio.run(main())
