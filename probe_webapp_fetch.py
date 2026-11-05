"""
Inspect the fetch wrapper and headers in the WebApp
"""

import re
import httpx
import asyncio

async def main():
    async with httpx.AsyncClient(verify=False) as http:
        res = await http.get("https://meeshoshop.94.136.188.137.nip.io/?view=history")
        text = res.text

        # Find the fetch function definition
        m = re.search(r'function\s+api\w*\s*\([^)]*\)\s*\{[^}]+fetch\([^)]+\)[^}]*\}', text)
        if m:
            print("Found API function:\n", m.group(0))
        else:
            # Look around "fetch("
            idx = text.find("fetch(u")
            if idx != -1:
                print("Context around fetch(u:\n")
                print(text[max(0, idx - 400): min(len(text), idx + 400)])

if __name__ == "__main__":
    asyncio.run(main())
