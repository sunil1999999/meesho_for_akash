"""
Inspect API endpoints in the Meesho Shop Telegram WebApp
"""

import re
import httpx
import asyncio

async def main():
    async with httpx.AsyncClient(verify=False) as http:
        res = await http.get("https://meeshoshop.94.136.188.137.nip.io/?view=history")
        text = res.text

        # Find script tags or API endpoints
        endpoints = set(re.findall(r'["\'](/api/[^"\']+|https?://[^"\']+)["\']', text))
        print("Found API / URL endpoints in WebApp HTML:")
        for ep in endpoints:
            if not ep.endswith(('.css', '.png', '.jpg', '.svg', '.js')):
                print(" -", ep)

        # Look for fetch or ajax calls
        fetch_calls = re.findall(r'fetch\([^\)]+\)', text)
        print(f"\nTotal fetch() calls in HTML: {len(fetch_calls)}")
        for f in fetch_calls[:10]:
            print(" -", f[:100])

if __name__ == "__main__":
    asyncio.run(main())
