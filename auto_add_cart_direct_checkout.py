"""
Auto-Add Product to Cart Only for Accounts That Have Not Placed Their First Order
==================================================================================
Automation script that safely adds an explicitly selected product, variant, and
quantity to the cart of 0-order accounts only.

Strict Rules:
1. Check order history first using reliable order-history data.
2. If no successful order exists: add only the selected product, variant, and quantity.
3. If an order has already been successfully placed: skip the account.
4. Never auto-checkout: do not open/execute checkout, place orders, or initiate payments.
5. Stop after adding to cart: record result and halt account processing.
6. Handle uncertain order history safely: skip if verification fails, never assume zero orders.
7. Prevent duplicate cart additions: check existing cart before adding.
8. Preserve account eligibility rules: exclude Sold accounts under existing rules.
9. Provide clear results: show counts for added, skipped_has_orders, skipped_unverified, failed.
10. Preserve existing functionality: Direct Checkout & Pay remains manual.
"""

import sys
import os
import json
import re
import argparse
import asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv

# Reconfigure stdout for UTF-8
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv()

from meesho_checkout_bridge import (
    bulk_add_to_cart,
    resolve_product,
    get_accounts,
    select_account,
    get_cart,
    isolate_cart,
    make_proxy_request
)

DEFAULT_PRODUCT = {
    "product_id": 1053270803,
    "supplier_id": 2249146,
    "variation_id": 1,
    "variation": "XXS",
    "quantity": 1,
    "name": "Feminine Women's Casual Printed Kurti Pack of 4"
}

async def main():
    parser = argparse.ArgumentParser(description="Auto-Add Product to Cart for 0-Order Accounts Only")
    parser.add_argument("--product-id", type=int, default=DEFAULT_PRODUCT["product_id"], help="Meesho Product ID")
    parser.add_argument("--supplier-id", type=int, default=DEFAULT_PRODUCT["supplier_id"], help="Meesho Supplier ID")
    parser.add_argument("--variation-id", type=int, default=DEFAULT_PRODUCT["variation_id"], help="Variant ID")
    parser.add_argument("--variation", type=str, default=DEFAULT_PRODUCT["variation"], help="Variant name (e.g. Free Size, S, M)")
    parser.add_argument("--quantity", type=int, default=DEFAULT_PRODUCT["quantity"], help="Item quantity (default 1)")
    parser.add_argument("--product-link", type=str, default=None, help="Optional Meesho product link to resolve target")

    args = parser.parse_args()

    target_product_id = args.product_id
    target_supplier_id = args.supplier_id
    target_variation_id = args.variation_id
    target_variation = args.variation
    target_quantity = max(1, args.quantity)
    target_name = DEFAULT_PRODUCT["name"]

    if args.product_link:
        print(f"Resolving target product from link: {args.product_link}...")
        resolved = await resolve_product(args.product_link)
        if resolved.get("success") and resolved.get("data"):
            pdata = resolved["data"]
            target_product_id = pdata.get("product_id") or target_product_id
            target_supplier_id = pdata.get("supplier_id") or target_supplier_id
            target_name = pdata.get("name") or target_name
            sizes = pdata.get("sizes") or []
            if sizes:
                first_size = next((s for s in sizes if s.get("in_stock")), sizes[0])
                target_variation_id = first_size.get("variation_id") or target_variation_id
                target_variation = first_size.get("name") or target_variation

    print("=================================================================")
    print(" AUTO-ADD PRODUCT TO CART (0-ORDER ACCOUNTS ONLY)")
    print("=================================================================")
    print(f" Target Product : {target_name}")
    print(f" Product ID     : {target_product_id}")
    print(f" Supplier ID    : {target_supplier_id}")
    print(f" Variant        : {target_variation} (ID: {target_variation_id})")
    print(f" Quantity       : {target_quantity}")
    print(" Policy         : STRICT - NO CHECKOUT, NO PAYMENTS UNDER ANY CIRCUMSTANCES")
    print("=================================================================\n")

    payload = {
        "product_id": target_product_id,
        "supplier_id": target_supplier_id,
        "variation_id": target_variation_id,
        "variation": target_variation,
        "quantity": target_quantity,
    }

    print("[1/2] Processing accounts and verifying order history...")
    res = await bulk_add_to_cart(payload)

    if not res.get("success"):
        print(f"\n[Error] Auto-add failed: {res.get('error')}")
        sys.exit(1)

    data = res.get("data", {})
    processed = data.get("processed", 0)
    added = data.get("added", 0)
    already_in_cart = data.get("already_in_cart", 0)
    skipped_has_orders = data.get("skipped_has_orders", 0)
    skipped_unverified = data.get("skipped_unverified", 0)
    failed = data.get("failed", 0)
    details = data.get("details", [])

    # Save summary report to exports
    os.makedirs("exports", exist_ok=True)
    summary_path = os.path.join("exports", "direct_checkout_cart_auto_added.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "target_product": {
                "product_id": target_product_id,
                "supplier_id": target_supplier_id,
                "variation_id": target_variation_id,
                "variation": target_variation,
                "quantity": target_quantity,
                "name": target_name,
            },
            "summary": {
                "total_accounts_processed": processed,
                "successfully_added": added,
                "already_in_cart": already_in_cart,
                "skipped_has_orders": skipped_has_orders,
                "skipped_unverified": skipped_unverified,
                "failed": failed,
            },
            "details": details
        }, f, indent=2, ensure_ascii=False)

    print("\n[2/2] Auto-Add to Cart Completed.")
    print("=================================================================")
    print(" RESULTS BREAKDOWN")
    print("=================================================================")
    print(f" Total Accounts Evaluated           : {processed}")
    print(f" Successfully Added to Cart         : {added}")
    print(f" Already in Cart (Duplicate Saved)  : {already_in_cart}")
    print(f" Skipped (Order Already Placed)     : {skipped_has_orders}")
    print(f" Skipped (Order History Unverified) : {skipped_unverified}")
    print(f" Failed Additions                   : {failed}")
    print(f" Detailed Log Saved                 : {os.path.abspath(summary_path)}")
    print("=================================================================")
    print(" Safety Guarantee: No orders were placed and checkout was not opened.")
    print(" Direct Checkout & Pay remains available for explicit manual use only.\n")

if __name__ == "__main__":
    asyncio.run(main())
