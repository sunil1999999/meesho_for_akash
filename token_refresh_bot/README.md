# Independent Telegram Account Token Refresh Bot

A dedicated, isolated Telegram Bot engineered exclusively for refreshing account authentication tokens (`xo`), validating session usability, and exporting updated account JSON files.

---

## 1. Key Guarantees & Isolation

- **Completely Independent Project:** Resides entirely in `token_refresh_bot/` with its own configuration, storage, queue, dependencies, and lifecycle.
- **Zero Production Interference:** Does not modify, overwrite, touch, or restart existing Telegram automation, Supabase databases, payment systems, or order monitoring workflows.
- **Strict Data Integrity:**
  - Preserves 100% of non-auth account fields, custom tags, device identities, and metadata.
  - Never fabricates or generates dummy tokens.
  - Never replaces valid tokens with null or empty strings.
  - Every account receives a verified outcome (SUCCESS, EXPIRED, REQUIRES_REAUTH, INVALID_TOKEN, RATE_LIMITED, NETWORK_ERROR).
- **No ZIP Archives:** Exporting individual files delivers each account as a separate, distinct `.json` document message in Telegram.
- **Security & Encryption at Rest:** Accounts persisted in SQLite are encrypted with AES/Fernet. Secrets and tokens are never printed in plain text in ordinary Telegram messages or logs.

---

## 2. Supported Import Formats

The bot automatically detects and parses any of the following formats without discarding fields:

1. **Single Account File (`.json` or `.txt`):**
   ```json
   {
     "mobile": "9033807401",
     "user_id": 605524023,
     "phone": "+919033807401",
     "xo": "eyJ0eXBlIjoiY29tcG9zaXRlIn0=...",
     "ox": "8o2V1BDO1soGRSkVM7a117Us...",
     "identity": { "make": "Realme", "model": "Narzo 70 Pro" }
   }
   ```
2. **Multiple Individual Files in One Batch:** Send several `.json` or `.txt` files sequentially.
3. **Pasted JSON Text:** Paste an account JSON directly as a chat message.
4. **Bulk Accounts Array:** `[ { ... }, { ... } ]`
5. **Wrapped Object:** `{ "accounts": [ ... ] }` or `{ "records": [ ... ] }` or `{ "data": [ ... ] }`
6. **Keyed Dictionary:** `{ "9033807401": { ... }, "9820192831": { ... } }`
7. **JSON Lines (NDJSON):** One valid JSON per line.
8. **Consecutive JSONs in TXT:** Multiple pretty-printed JSON blocks separated by whitespace.
9. **Mixed Batch Import:** Combine individual files, pasted text, and bulk files in a single session. Accounts are automatically deduplicated by normalized mobile number (`+91XXXXXXXXXX`).

---

## 3. Telegram Commands & Interactive Controls

| Command | Description |
|---|---|
| `/start` | Open main menu with interactive button shortcuts |
| `/refresh` | View current staged accounts & start a new batch |
| `/status` | Live progress bar dashboard (`[████████░░] 80%`) with counts |
| `/results` | Completed batch summary and export options |
| `/retry` | Re-queue eligible failed accounts (network errors / rate limits) |
| `/pause` | Pause active processing queue |
| `/resume` | Resume paused queue |
| `/cancel` | Cancel pending work safely while preserving finished records |
| `/help` | Detailed guide on commands and JSON structures |
| `/admin` | Administration dashboard, worker metrics, and file cleanup |

### Interactive Buttons:
- `[🔄 Start Refresh Session]` — Upload or paste accounts
- `[🚀 Start Refreshing Queue]` — Begin worker execution
- `[⏸ Pause]` / `[▶️ Resume]` / `[🛑 Cancel]` — Queue flow control
- `[📄 Download Refreshed JSONs (Individual)]` — Delivers each refreshed JSON file individually
- `[📦 Download Combined JSON]` — Single combined array JSON file
- `[⚠️ Download Failure Report]` — Redacted, credential-free failure report
- `[🔁 Retry Eligible Failed]` — Re-attempts transient failures

---

## 4. Railway Same-Project Deployment Guide

You can deploy the Account Token Refresh Bot directly on **Railway within the same project**, reusing your existing project variables while providing dedicated variables for this bot.

### Variable Mapping Overview

| Purpose | Variable Name on Railway | Notes |
|---|---|---|
| **Bot Token (NEW)** | `REFRESH_BOT_TOKEN` | Generated via [@BotFather](https://t.me/BotFather) for this bot |
| **Allowed Users (NEW)** | `REFRESH_BOT_ALLOWED_USERS` | Comma-separated Telegram User IDs allowed to use the bot |
| **Admin Users (NEW)** | `REFRESH_BOT_ADMIN_USERS` | Comma-separated Telegram User IDs with `/admin` access |
| **Telegram API ID (EXISTED)** | `TELEGRAM_API_ID` | Automatically reused from your existing Railway project |
| **Telegram API Hash (EXISTED)** | `TELEGRAM_API_HASH` | Automatically reused from your existing Railway project |
| **String Session (EXISTED)** | `TELEGRAM_STRING_SESSION` | Automatically reused to sign proxy requests |
| **Proxy Base URL (EXISTED)** | `MEESHO_PROXY_BASE_URL` | Defaults to `https://meeshoshop.94.136.188.137.nip.io` |
| **Session Secret (EXISTED)** | `SESSION_SECRET` | Reused as fallback data-at-rest encryption key |

---

### Deployment Option 1: Dedicated Service in Same Railway Project (Recommended)

1. Open your existing project on [Railway.app](https://railway.app).
2. Click **+ New** ➔ **Service** ➔ **GitHub Repo** ➔ Select your repository.
3. In the new service's **Settings**:
   - **Root Directory:** `/token_refresh_bot` (or set Custom Start Command: `python bot.py`)
4. In the **Variables** tab of the new service:
   - Add `REFRESH_BOT_TOKEN` = `your_botfather_token_here`
   - Add `REFRESH_BOT_ALLOWED_USERS` = `your_telegram_user_id`
   - In Railway, click **Reference a variable** to reference your existing `TELEGRAM_STRING_SESSION`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `MEESHO_PROXY_BASE_URL` from your existing service.
5. Railway will automatically build and start the bot independently!

---

### Deployment Option 2: Single Service Running Dashboard & Bot Together

If you want both the web dashboard and the token refresh bot to run inside the **same Railway container**:

1. In your existing Railway service **Settings** ➔ **Deploy** ➔ **Custom Start Command**, enter:
   ```bash
   python scripts/start_railway.py
   ```
2. In the **Variables** tab, add your dedicated bot variables:
   - `REFRESH_BOT_TOKEN` = `your_botfather_token_here`
   - `REFRESH_BOT_ALLOWED_USERS` = `your_telegram_user_id`
3. [`scripts/start_railway.py`](file:///d:/meesho_management/scripts/start_railway.py) will automatically spawn the Token Refresh Bot as a background process and start the web dashboard on port `8080`.

---

## 5. Local Setup & Testing

### Option A: Direct Python (Windows / Linux)
```bash
cd token_refresh_bot
python -m pip install -r requirements.txt
python bot.py
```
Or double-click `start_bot.bat` on Windows.

### Option B: Docker Compose
```bash
cd token_refresh_bot
docker-compose up -d --build
```
View logs:
```bash
docker-compose logs -f
```

### Option C: Systemd Service (Linux Production)
Create `/etc/systemd/system/token-refresh-bot.service`:
```ini
[Unit]
Description=Telegram Account Token Refresh Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/token_refresh_bot
ExecStart=/usr/bin/python3 bot.py
Restart=always
RestartSec=5
EnvironmentFile=/path/to/token_refresh_bot/.env

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable token-refresh-bot
sudo systemctl start token-refresh-bot
```

### Option D: PM2 Process Manager
```bash
pm2 start bot.py --name "token-refresh-bot" --interpreter python3
pm2 save
```

---

## 6. Running the Acceptance Tests

Run the complete test suite covering all 12 criteria:
```bash
python -m pytest token_refresh_bot/tests -v
```

All 14 unit and integration tests validate:
- ✅ Single account JSON parsing
- ✅ Multiple individual files batch
- ✅ Pasted single account JSON
- ✅ Bulk accounts in JSON (array, wrapper, dictionary, consecutive)
- ✅ Mixed input formats
- ✅ Duplicate account detection
- ✅ Invalid JSON & missing fields
- ✅ Expired sessions & reauthentication-required accounts
- ✅ Rate limits & network failures with exponential backoff
- ✅ Deep preservation of non-auth fields
- ✅ Pause, resume, cancel, and restart recovery
- ✅ Individual file exports (separate .json documents, NO zip!)
- ✅ Combined JSON exports & token-free failure reports
- ✅ Production immutability and complete project isolation
