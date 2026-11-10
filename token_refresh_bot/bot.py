"""
Telegram Account Token Refresh Bot.
Independent Telegram Bot using python-telegram-bot v22.
Implements:
- All required commands: /start, /refresh, /status, /results, /retry, /pause, /resume, /cancel, /help, /admin
- Interactive inline keyboards and progress dashboards
- Single file, multi-file, pasted JSON, bulk JSON, and mixed-mode imports
- Individual file delivery (NO ZIP archives)
- Combined JSON and credential-safe failure report downloads
- Strict access control and credential redaction
"""

import os
import sys
import json
import time
import uuid
import html
import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, Optional

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InputFile
)
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters
)

from config import BotConfig
from security import SecurityManager
from parser import AccountDataParser, ParsedAccount
from storage import BotStorage
from provider import LiveHttpRefreshEngine, MockRefreshEngine, BaseRefreshEngine
from queue_manager import QueueManager
from cleanup import clean_expired_temporary_files
from direct_refresher import DirectDatabaseRefresher

# Setup logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger("TokenRefreshBot")

# Staged batches in memory before enqueueing (user_id -> {"batch_id": str, "accounts": list, "identifiers": set})
_user_staged_batches: Dict[int, Dict[str, Any]] = {}

# Active QueueManager singleton
_queue_manager: Optional[QueueManager] = None

# Active in-place DirectDatabaseRefresher instance
_active_direct_refresher: Optional[DirectDatabaseRefresher] = None

# Reference to Telegram Bot instance for automatic file delivery
_bot_instance: Optional[Any] = None


async def deliver_refreshed_batch_results(batch_id: str, batch_data: Optional[Dict[str, Any]] = None):
    """
    Delivers refresh completion summary directly to the user upon batch completion.
    All refreshed accounts are updated directly in the bot database.
    Zero file spam: does NOT automatically export JSON files to chat.
    """
    global _bot_instance
    if not _bot_instance:
        logger.warning(f"Cannot deliver results for batch {batch_id}: bot instance not initialized")
        return

    if not batch_data:
        batch_data = await BotStorage.get_batch(batch_id)
    if not batch_data:
        return

    user_id = batch_data["user_id"]
    success_count = batch_data.get("success_count", 0)
    failed_count = batch_data.get("failed_count", 0)
    expired_count = batch_data.get("expired_count", 0)
    reauth_count = batch_data.get("reauth_count", 0)
    duplicate_count = batch_data.get("duplicate_count", 0)
    total_count = batch_data.get("total_count", 0)

    # Build summary message text
    status_icon = "🎉" if success_count > 0 else "⚠️"
    summary_text = (
        f"{status_icon} <b>Token Refresh Completed!</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>Batch ID:</b> <code>{batch_id}</code>\n"
        f"<b>Total Accounts:</b> {total_count}\n"
        f"• Refreshed & Verified: <b>{success_count}</b> ✅\n"
    )
    if failed_count > 0:
        summary_text += f"• Failed Refreshes: <b>{failed_count}</b> ❌\n"
    if expired_count > 0:
        summary_text += f"• Expired Sessions: <b>{expired_count}</b> ⚠️\n"
    if reauth_count > 0:
        summary_text += f"• Requires Reauth: <b>{reauth_count}</b> 🔑\n"
    if duplicate_count > 0:
        summary_text += f"• Duplicates Skipped: <b>{duplicate_count}</b> ⏭️\n"

    summary_text += (
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💾 <b>All refreshed sessions saved directly inside bot database.</b>\n"
        f"🔒 <i>Zero chat spam • No files sent to chat.</i>"
    )

    keyboard = [
        [InlineKeyboardButton("📊 View Stored Accounts", callback_data="cmd:status")],
        [InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")]
    ]

    try:
        await _bot_instance.send_message(
            chat_id=user_id,
            text=summary_text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"Failed to send completion summary message to user {user_id}: {e}")


def get_queue_manager() -> QueueManager:
    global _queue_manager
    if _queue_manager is None:
        # Check if live provider or mock provider (if no live URL provided or testing)
        engine: BaseRefreshEngine
        if os.getenv("USE_MOCK_PROVIDER", "false").lower() == "true":
            engine = MockRefreshEngine()
        else:
            engine = LiveHttpRefreshEngine()
        _queue_manager = QueueManager(engine)
        _queue_manager.set_completion_hook(deliver_refreshed_batch_results)
    return _queue_manager


# Authorization Decorator / Middleware Helper
def check_auth(func):
    """Ensures caller is authorized before processing."""
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        global _bot_instance
        if context and context.bot:
            _bot_instance = context.bot
        user = update.effective_user
        if not user:
            return
        if not BotConfig.is_user_allowed(user.id):
            msg = (
                f"⛔ <b>Access Denied</b>\n\n"
                f"Your Telegram User ID (<code>{user.id}</code>) is not authorized to access this bot.\n"
                f"Contact the system administrator to grant access."
            )
            if update.callback_query:
                await update.callback_query.answer("Access Denied", show_alert=True)
                await update.callback_query.edit_message_text(msg, parse_mode="HTML")
            elif update.message:
                await update.message.reply_text(msg, parse_mode="HTML")
            return
        return await func(update, context, *args, **kwargs)
    return wrapper


def check_admin(func):
    """Ensures caller has admin privileges."""
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        user = update.effective_user
        if not user or not BotConfig.is_user_admin(user.id):
            msg = "⛔ <b>Admin Access Denied</b>\nThis command requires administrative authorization."
            if update.callback_query:
                await update.callback_query.answer("Admin only", show_alert=True)
            elif update.message:
                await update.message.reply_text(msg, parse_mode="HTML")
            return
        return await func(update, context, *args, **kwargs)
    return wrapper


def render_progress_bar(completed: int, total: int, width: int = 10) -> str:
    """Renders a text progress bar like [██████░░░░] 60%."""
    if total <= 0:
        return "[░░░░░░░░░░] 0%"
    pct = min(1.0, max(0.0, completed / total))
    filled = int(round(width * pct))
    bar = "█" * filled + "░" * (width - filled)
    return f"[{bar}] {int(pct * 100)}%"


# ==============================================================================
# COMMAND HANDLERS
# ==============================================================================

@check_auth
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /start command: displays the main menu with inline actions."""
    user = update.effective_user
    text = (
        f"🤖 <b>Account Token Refresh Bot</b>\n\n"
        f"Welcome, <b>{user.first_name or 'User'}</b>! This independent service refreshes and verifies "
        f"account session tokens and exports updated account JSON records.\n\n"
        f"<b>Supported Input Methods:</b>\n"
        f"• 📄 Single JSON or TXT file\n"
        f"• 📁 Multiple individual account files (batch)\n"
        f"• 📝 Direct pasted account JSON text\n"
        f"• ↗️ Forwarded JSON messages, captions, or files from any chat\n"
        f"• 📦 Bulk accounts in one file (array, <code>accounts</code> wrapper, or legacy dict)\n"
        f"• 🔀 Mixed imports (combine uploads, forwards, and text in one session)\n\n"
        f"Select an option below to begin:"
    )

    keyboard = [
        [InlineKeyboardButton("🔄 Refresh All JSON", callback_data="action:refresh_all_db")],
        [InlineKeyboardButton("📁 Upload / Refresh Files", callback_data="cmd:refresh")],
        [
            InlineKeyboardButton("📊 Batch Status", callback_data="cmd:status"),
            InlineKeyboardButton("📁 View Results", callback_data="cmd:results")
        ],
        [
            InlineKeyboardButton("❓ Help & Documentation", callback_data="cmd:help")
        ]
    ]

    # Show Admin Controls button strictly to administrators
    if BotConfig.is_user_admin(user.id):
        keyboard.append([InlineKeyboardButton("⚙️ Admin Settings & Controls", callback_data="cmd:admin")])

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    elif update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")


@check_auth
async def refresh_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /refresh command: guides user to upload files or paste/forward JSON."""
    user_id = update.effective_user.id
    staged = _user_staged_batches.get(user_id)
    account_count = len(staged["accounts"]) if staged else 0

    text = (
        f"🔄 <b>Token Refresh Session</b>\n\n"
        f"Currently staged accounts: <b>{account_count}</b>\n\n"
        f"<b>How to add accounts:</b>\n"
        f"1. <b>Upload or Forward file(s):</b> Send or forward any <code>.json</code> or <code>.txt</code> file directly.\n"
        f"2. <b>Paste or Forward JSON:</b> Paste account JSON text or forward messages/captions containing JSON.\n"
        f"3. <b>Mixed Batch:</b> Keep uploading or forwarding more. Accounts are automatically deduplicated.\n\n"
        f"When ready, click <b>🚀 Start Refreshing</b> below to commence background queue processing."
    )

    buttons = [
        [InlineKeyboardButton("🔄 Refresh All JSON (Database)", callback_data="action:refresh_all_db")]
    ]
    if account_count > 0:
        buttons.append([InlineKeyboardButton("🚀 Start Refreshing Queue", callback_data="action:process_queue")])
        buttons.append([InlineKeyboardButton("🗑️ Clear Staged Accounts", callback_data="action:clear_staged")])

    buttons.append([InlineKeyboardButton("📊 View Active Status", callback_data="cmd:status")])
    buttons.append([InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")])

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(buttons), parse_mode="HTML")
    elif update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(buttons), parse_mode="HTML")


@check_auth
async def refresh_all_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /refresh_all: 1-click in-place refresh of all stored JSON sessions in database."""
    await start_direct_refresh_flow(update, context)


async def start_direct_refresh_flow(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Core handler for 1-Click Refresh All JSON:
    1. Retrieves all eligible unique accounts from SQLite database.
    2. Runs parallel worker execution with bounded concurrency.
    3. Throttles live progress updates on the exact same message.
    4. Updates updated JSON sessions directly in database records in-place.
    5. Displays final completion report with zero chat spam (no files sent to chat).
    """
    global _active_direct_refresher

    # Prevent concurrent duplicate runs
    if _active_direct_refresher and _active_direct_refresher.is_running:
        text, kb = _active_direct_refresher.format_progress_text()
        warning = "⚠️ <b>A Refresh All JSON task is already actively running!</b>\n\n" + text
        if update.callback_query:
            await update.callback_query.answer("Refresh All is already in progress!")
            try:
                await update.callback_query.edit_message_text(warning, reply_markup=kb, parse_mode="HTML")
            except Exception:
                pass
        elif update.message:
            await update.message.reply_text(warning, reply_markup=kb, parse_mode="HTML")
        return

    # Fetch stored database accounts
    accounts = await BotStorage.get_all_stored_accounts_for_refresh()
    if not accounts:
        no_acct_text = (
            "ℹ️ <b>No Stored JSON Sessions Found</b>\n\n"
            "There are currently no saved account sessions in the bot database.\n"
            "Please upload or paste your account JSON files first via /refresh or by sending a file to this chat."
        )
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("📁 Upload Accounts", callback_data="cmd:refresh")],
            [InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")]
        ])
        if update.callback_query:
            await update.callback_query.answer()
            await update.callback_query.edit_message_text(no_acct_text, reply_markup=kb, parse_mode="HTML")
        elif update.message:
            await update.message.reply_text(no_acct_text, reply_markup=kb, parse_mode="HTML")
        return

    # Initialize DirectDatabaseRefresher with current engine
    qm = get_queue_manager()
    engine = qm.engine
    refresher = DirectDatabaseRefresher(engine)
    _active_direct_refresher = refresher

    init_text, init_kb = refresher.format_progress_text()
    status_msg = None
    if update.callback_query:
        await update.callback_query.answer("Starting One-Click Refresh All...")
        try:
            status_msg = await update.callback_query.edit_message_text(init_text, reply_markup=init_kb, parse_mode="HTML")
        except Exception:
            status_msg = update.callback_query.message
    elif update.message:
        status_msg = await update.message.reply_text(init_text, reply_markup=init_kb, parse_mode="HTML")

    async def on_progress(ref: DirectDatabaseRefresher):
        nonlocal status_msg
        if not status_msg:
            return
        t, k = ref.format_progress_text() if ref.is_running else ref.format_completion_text()
        try:
            await status_msg.edit_text(t, reply_markup=k, parse_mode="HTML")
        except telegram.error.BadRequest as b_err:
            if "Message is not modified" in str(b_err):
                pass
            else:
                logger.debug(f"Progress edit error: {b_err}")
        except Exception as ex:
            logger.debug(f"Progress edit transient error: {ex}")

    refresher.set_progress_callback(on_progress)

    async def _run_task():
        try:
            await refresher.run_refresh_all(accounts)
        except Exception as err:
            logger.error(f"Error during DirectDatabaseRefresher run: {err}", exc_info=True)
        finally:
            if status_msg:
                final_text, final_kb = refresher.format_completion_text()
                try:
                    await status_msg.edit_text(final_text, reply_markup=final_kb, parse_mode="HTML")
                except Exception:
                    pass

    asyncio.create_task(_run_task())


@check_auth
async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /status command: displays live progress dashboard."""
    user_id = update.effective_user.id
    batch = await BotStorage.get_latest_batch_for_user(user_id)

    if not batch:
        text = (
            "📊 <b>Queue Status</b>\n\n"
            "No active or previous batch found for your user.\n"
            "Use /refresh or upload account JSON files to start a session."
        )
        keyboard = [[InlineKeyboardButton("🔄 Start Refresh Session", callback_data="cmd:refresh")]]
        if update.callback_query:
            await update.callback_query.answer()
            await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
        elif update.message:
            await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
        return

    batch_id = batch["id"]
    status = batch["status"]
    total = batch["total_count"]
    success = batch["success_count"]
    failed = batch["failed_count"]
    expired = batch["expired_count"]
    reauth = batch["reauth_count"]
    duplicates = batch["duplicate_count"]

    completed = success + failed + expired + reauth
    progress_bar = render_progress_bar(completed, total)

    qm = get_queue_manager()
    is_paused = qm.is_batch_paused(batch_id)

    status_icon = "⏳"
    if status == "COMPLETED":
        status_icon = "✅"
    elif status == "PAUSED" or is_paused:
        status_icon = "⏸️"
    elif status == "CANCELLED":
        status_icon = "🛑"
    elif status == "PROCESSING":
        status_icon = "⚙️"

    text = (
        f"📊 <b>Batch Status Dashboard</b>\n\n"
        f"<b>Batch ID:</b> <code>{batch_id}</code>\n"
        f"<b>Status:</b> {status_icon} <b>{status}</b>\n\n"
        f"<b>Progress:</b> {progress_bar}\n"
        f"• Total Accounts: <b>{total}</b>\n"
        f"• Successfully Refreshed: <b>{success}</b> ✅\n"
        f"• Failed Refreshes: <b>{failed}</b> ❌\n"
        f"• Expired Sessions: <b>{expired}</b> ⚠️\n"
        f"• Requires Reauth/OTP: <b>{reauth}</b> 🔑\n"
        f"• Skipped Duplicates: <b>{duplicates}</b> ⏭️\n\n"
        f"<i>Updated: {batch['updated_at']}</i>"
    )

    control_buttons = []
    if status in ("PROCESSING", "QUEUED"):
        if is_paused:
            control_buttons.append(InlineKeyboardButton("▶️ Resume", callback_data=f"action:resume:{batch_id}"))
        else:
            control_buttons.append(InlineKeyboardButton("⏸️ Pause", callback_data=f"action:pause:{batch_id}"))
        control_buttons.append(InlineKeyboardButton("🛑 Cancel", callback_data=f"action:cancel:{batch_id}"))

    keyboard = []
    if control_buttons:
        keyboard.append(control_buttons)

    keyboard.append([
        InlineKeyboardButton("🔄 Refresh Status", callback_data=f"action:refresh_status:{batch_id}"),
        InlineKeyboardButton("📁 Results & Exports", callback_data=f"action:view_results:{batch_id}")
    ])
    keyboard.append([InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")])

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    elif update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")


@check_auth
async def results_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /results command: displays outcome summary and export download buttons."""
    user_id = update.effective_user.id
    batch = await BotStorage.get_latest_batch_for_user(user_id)

    if not batch:
        text = "📁 <b>Results</b>\n\nNo batch results available. Start by using /refresh."
        if update.callback_query:
            await update.callback_query.answer()
            await update.callback_query.edit_message_text(text, parse_mode="HTML")
        elif update.message:
            await update.message.reply_text(text, parse_mode="HTML")
        return

    batch_id = batch["id"]
    success = batch["success_count"]
    failed = batch["failed_count"]
    expired = batch["expired_count"]
    reauth = batch["reauth_count"]
    total = batch["total_count"]
    dups = batch["duplicate_count"]

    text = (
        f"📁 <b>Batch Processing Results</b>\n\n"
        f"<b>Batch ID:</b> <code>{batch_id}</code>\n"
        f"<b>Overall Status:</b> <b>{batch['status']}</b>\n\n"
        f"<b>Summary:</b>\n"
        f"• Total Accounts: <b>{total}</b>\n"
        f"• Refreshed & Verified: <b>{success}</b> ✅\n"
        f"• Failed Refreshes: <b>{failed}</b> ❌\n"
        f"• Expired Sessions: <b>{expired}</b> ⚠️\n"
        f"• Requires Reauth: <b>{reauth}</b> 🔑\n"
        f"• Skipped Duplicates: <b>{dups}</b> ⏭️\n\n"
        f"<b>Export Options:</b>\n"
        f"Select an export option below to receive your files."
    )

    keyboard = []
    if success > 0:
        keyboard.append([
            InlineKeyboardButton("📄 Individual JSON Files (Separate)", callback_data=f"export:individual:{batch_id}")
        ])
        keyboard.append([
            InlineKeyboardButton("📦 Combined JSON (All Refreshed)", callback_data=f"export:combined:{batch_id}")
        ])

    if failed > 0 or expired > 0 or reauth > 0:
        keyboard.append([
            InlineKeyboardButton("⚠️ Download Failure Report", callback_data=f"export:failure:{batch_id}")
        ])
        keyboard.append([
            InlineKeyboardButton("🔁 Retry Eligible Failed", callback_data=f"action:retry:{batch_id}")
        ])

    keyboard.append([
        InlineKeyboardButton("🆕 Start New Batch", callback_data="cmd:refresh"),
        InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")
    ])

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    elif update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")


@check_auth
async def retry_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /retry command: re-queues eligible failed accounts in the latest batch."""
    user_id = update.effective_user.id
    batch = await BotStorage.get_latest_batch_for_user(user_id)

    if not batch:
        await update.message.reply_text("No active batch to retry.")
        return

    batch_id = batch["id"]
    accounts = await BotStorage.get_batch_accounts(batch_id)
    retryable = [a for a in accounts if a["status"] in ("FAILED", "NETWORK_ERROR", "RATE_LIMITED")]

    if not retryable:
        await update.message.reply_text("No retryable failed accounts found in the latest batch.")
        return

    # Reset retryable accounts to PENDING
    for acc in retryable:
        await BotStorage.update_account_result(acc["id"], "PENDING", error_message="Enqueued for retry")

    qm = get_queue_manager()
    await qm.enqueue_batch(batch_id)

    await update.message.reply_text(
        f"🔁 Re-enqueued <b>{len(retryable)}</b> failed accounts for retry.\nCheck /status for live progress.",
        parse_mode="HTML"
    )


@check_auth
async def pause_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /pause command."""
    user_id = update.effective_user.id
    batch = await BotStorage.get_latest_batch_for_user(user_id)
    if batch and batch["status"] == "PROCESSING":
        qm = get_queue_manager()
        qm.pause_batch(batch["id"])
        await update.message.reply_text(f"⏸️ Paused processing for batch <code>{batch['id']}</code>.", parse_mode="HTML")
    else:
        await update.message.reply_text("No running batch to pause.")


@check_auth
async def resume_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /resume command."""
    user_id = update.effective_user.id
    batch = await BotStorage.get_latest_batch_for_user(user_id)
    if batch:
        qm = get_queue_manager()
        qm.resume_batch(batch["id"])
        await update.message.reply_text(f"▶️ Resumed processing for batch <code>{batch['id']}</code>.", parse_mode="HTML")
    else:
        await update.message.reply_text("No batch to resume.")


@check_auth
async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /cancel command."""
    user_id = update.effective_user.id
    batch = await BotStorage.get_latest_batch_for_user(user_id)
    if batch and batch["status"] in ("PROCESSING", "QUEUED", "PAUSED"):
        qm = get_queue_manager()
        qm.cancel_batch(batch["id"])
        await update.message.reply_text(f"🛑 Cancelled pending work for batch <code>{batch['id']}</code>.", parse_mode="HTML")
    else:
        await update.message.reply_text("No active batch to cancel.")


@check_auth
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /help command."""
    text = (
        "📖 <b>Account Token Refresh Bot — Guide & Reference</b>\n\n"
        "<b>Supported Commands:</b>\n"
        "• /start — Open main menu\n"
        "• /refresh — Start/view current refresh staging\n"
        "• /status — View live progress and batch dashboard\n"
        "• /results — View summary and export refreshed accounts\n"
        "• /retry — Retry eligible failed accounts\n"
        "• /pause — Pause active batch queue\n"
        "• /resume — Resume paused queue\n"
        "• /cancel — Cancel pending queue work safely\n"
        "• /help — Show this help message\n"
        "• /admin — Administration and system health\n\n"
        "<b>Supported Account Formats & Input Methods:</b>\n"
        "1. <b>Single Account:</b> JSON object with <code>mobile</code>, <code>xo</code>, and/or <code>ox</code>.\n"
        "2. <b>JSON Array:</b> <code>[{...}, {...}]</code> array of account objects.\n"
        "3. <b>Wrapped JSON:</b> Object containing <code>accounts</code>, <code>records</code>, or <code>data</code> array.\n"
        "4. <b>Keyed Dictionary:</b> Object with phones/IDs as keys.\n"
        "5. <b>NDJSON / JSON Lines:</b> One JSON object per line.\n"
        "6. <b>Consecutive JSON TXT:</b> Multiple formatted JSON objects separated by whitespace.\n"
        "7. <b>Forwarded Messages:</b> Forward any account JSON message, caption, or file directly from another chat or bot.\n\n"
        "<b>Data Integrity Guarantee:</b>\n"
        "• Source fields are strictly preserved.\n"
        "• Tokens are never fabricated.\n"
        "• Individual files are exported as separate JSON documents without ZIP compression."
    )

    keyboard = [[InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")]]

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    elif update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")


@check_auth
@check_admin
async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /admin command: displays authorized system controls and allows changing bot settings."""
    cleaned = clean_expired_temporary_files(BotConfig.TEMP_FILE_RETENTION_HOURS)
    qm = get_queue_manager()

    text = (
        "⚙️ <b>Administrator Control Panel</b>\n\n"
        f"<b>Active Bot Settings:</b>\n"
        f"• Worker Concurrency: <b>{qm.concurrency}</b> workers\n"
        f"• Rate Limit Delay: <b>{qm.rate_limit_delay}s</b> per request\n"
        f"• Max Error Retries: <b>{qm.max_retries}</b> attempts\n"
        f"• Backoff Multiplier: <b>{qm.backoff_factor}x</b>\n"
        f"• Public Access Mode: <b>{'Enabled (Open to Public)' if BotConfig.PUBLIC_BOT else 'Restricted'}</b>\n"
        f"• Provider Refresh URL: <code>{BotConfig.PROVIDER_REFRESH_URL}</code>\n"
        f"• Database Path: <code>{BotConfig.DATABASE_PATH}</code>\n\n"
        f"<i>Authorized Admin ID: <code>{update.effective_user.id}</code></i>\n"
        f"Tap an option below to update live bot settings:"
    )

    keyboard = [
        [
            InlineKeyboardButton(f"{'✅ ' if qm.concurrency == 1 else ''}Conc: 1", callback_data="admin:set_conc:1"),
            InlineKeyboardButton(f"{'✅ ' if qm.concurrency == 3 else ''}Conc: 3", callback_data="admin:set_conc:3"),
            InlineKeyboardButton(f"{'✅ ' if qm.concurrency == 5 else ''}Conc: 5", callback_data="admin:set_conc:5"),
            InlineKeyboardButton(f"{'✅ ' if qm.concurrency == 10 else ''}Conc: 10", callback_data="admin:set_conc:10"),
        ],
        [
            InlineKeyboardButton(f"{'✅ ' if qm.rate_limit_delay == 0.2 else ''}Delay: 0.2s", callback_data="admin:set_delay:0.2"),
            InlineKeyboardButton(f"{'✅ ' if qm.rate_limit_delay == 0.5 else ''}Delay: 0.5s", callback_data="admin:set_delay:0.5"),
            InlineKeyboardButton(f"{'✅ ' if qm.rate_limit_delay == 1.0 else ''}Delay: 1.0s", callback_data="admin:set_delay:1.0"),
        ],
        [
            InlineKeyboardButton("🧹 Run Temp File Cleanup", callback_data="action:admin_cleanup"),
            InlineKeyboardButton("📊 System Health & Stats", callback_data="admin:stats")
        ],
        [InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")]
    ]

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    elif update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")


def get_forward_source_info(message: Any) -> Optional[str]:
    """
    Detects if a Telegram message was forwarded and returns a human-friendly
    representation of its origin (e.g. '@channel_name', 'User Name', 'Chat Title').
    Supports Telegram Bot API 7.0+ MessageOrigin objects as well as legacy fields.
    """
    if not message:
        return None

    # Check Bot API 7.0+ forward_origin
    origin = getattr(message, "forward_origin", None)
    if origin:
        # MessageOriginUser
        user = getattr(origin, "sender_user", None)
        if user:
            username = getattr(user, "username", None)
            first_name = getattr(user, "first_name", None) or getattr(user, "full_name", None)
            return f"@{username}" if username else (first_name or f"User {user.id}")

        # MessageOriginChannel
        chat = getattr(origin, "chat", None)
        if chat:
            username = getattr(chat, "username", None)
            title = getattr(chat, "title", None)
            return f"@{username}" if username else (title or f"Chat {chat.id}")

        # MessageOriginChat
        sender_chat = getattr(origin, "sender_chat", None)
        if sender_chat:
            username = getattr(sender_chat, "username", None)
            title = getattr(sender_chat, "title", None)
            return f"@{username}" if username else (title or f"Chat {sender_chat.id}")

        # MessageOriginHiddenUser
        sender_name = getattr(origin, "sender_user_name", None)
        if sender_name:
            return str(sender_name)

        return "Forwarded message"

    # Check legacy fields
    forward_from = getattr(message, "forward_from", None)
    if forward_from:
        username = getattr(forward_from, "username", None)
        first_name = getattr(forward_from, "first_name", None) or getattr(forward_from, "full_name", None)
        return f"@{username}" if username else (first_name or f"User {forward_from.id}")

    forward_chat = getattr(message, "forward_from_chat", None)
    if forward_chat:
        username = getattr(forward_chat, "username", None)
        title = getattr(forward_chat, "title", None)
        return f"@{username}" if username else (title or f"Chat {forward_chat.id}")

    forward_name = getattr(message, "forward_sender_name", None)
    if forward_name:
        return str(forward_name)

    if getattr(message, "forward_date", None):
        return "Forwarded message"

    return None


# ==============================================================================
# DOCUMENT & TEXT IMPORT HANDLERS (INCLUDING FORWARDED MESSAGES)
# ==============================================================================

@check_auth
async def handle_document_upload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles document uploads (.json, .txt, .jsonl, or forwarded files)."""
    user_id = update.effective_user.id
    doc = update.message.document
    if not doc:
        return

    filename = doc.file_name or "uploaded_account_file.json"
    lower_name = filename.lower()
    mime = (doc.mime_type or "").lower()
    source_info = get_forward_source_info(update.message)
    is_forwarded = bool(source_info)

    # Reject obviously non-text files if known binary media extensions
    binary_exts = (".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".pdf", ".mp4", ".mp3", ".avi", ".mkv")
    if any(lower_name.endswith(ext) for ext in binary_exts):
        await update.message.reply_text(
            f"⚠️ Unsupported binary file: <code>{html.escape(filename)}</code>.\nPlease send or forward a <code>.json</code> or <code>.txt</code> file.",
            parse_mode="HTML"
        )
        return

    # Download document content into memory
    bot_file = await doc.get_file()
    download_bytes = await bot_file.download_as_bytearray()
    content_str = download_bytes.decode("utf-8", errors="replace")

    source_label = f"forwarded_{filename}" if is_forwarded else filename
    parsed_records = AccountDataParser.parse_raw_content(content_str, source_name=source_label)

    # If document content didn't yield accounts, check if message has a caption containing JSON
    caption_text = (update.message.caption or "").strip()
    if (not parsed_records or not any(a.is_valid for a in parsed_records)) and caption_text:
        caption_records = AccountDataParser.parse_raw_content(caption_text, source_name=f"{source_label}_caption")
        if any(a.is_valid for a in caption_records):
            parsed_records = caption_records

    valid_records = [a for a in parsed_records if a.is_valid]
    if not valid_records:
        await update.message.reply_text(
            f"⚠️ Could not detect valid account JSON in <code>{html.escape(filename)}</code>.\n"
            f"Please ensure the file contains valid JSON with <code>mobile</code> and <code>xo</code>/<code>ox</code> tokens.",
            parse_mode="HTML"
        )
        return

    # Add to user's staged batch
    staged = _user_staged_batches.get(user_id)
    if not staged:
        batch_id = f"batch_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        staged = {"batch_id": batch_id, "accounts": [], "identifiers": set()}
        _user_staged_batches[user_id] = staged

    eligible, duplicates = AccountDataParser.deduplicate_batch(parsed_records, staged["identifiers"])
    for a in eligible:
        staged["accounts"].append(a)
        staged["identifiers"].add(a.stable_identifier)
    for d in duplicates:
        staged["accounts"].append(d)

    total_valid = sum(1 for a in eligible if a.is_valid)
    total_staged = len(staged["accounts"])

    keyboard = [
        [InlineKeyboardButton("🚀 Start Refreshing Queue", callback_data="action:process_queue")],
        [
            InlineKeyboardButton("➕ Add More Files", callback_data="cmd:refresh"),
            InlineKeyboardButton("🗑️ Clear", callback_data="action:clear_staged")
        ]
    ]

    if is_forwarded:
        header_text = f"📥 <b>Forwarded File Received:</b> <code>{html.escape(filename)}</code>\n<i>Forwarded from: {html.escape(source_info)}</i>"
    else:
        header_text = f"📥 <b>File Received:</b> <code>{html.escape(filename)}</code>"

    await update.message.reply_text(
        f"{header_text}\n\n"
        f"• Extracted: <b>{len(parsed_records)}</b> accounts\n"
        f"• Eligible & Valid: <b>{total_valid}</b>\n"
        f"• Duplicates Skipped: <b>{len(duplicates)}</b>\n\n"
        f"<b>Total in Current Staged Batch: {total_staged}</b> accounts.\n"
        f"You can forward more accounts or click <b>🚀 Start Refreshing Queue</b> below.",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )


@check_auth
async def handle_pasted_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles text messages or captions containing pasted or forwarded JSON."""
    user_id = update.effective_user.id
    raw_text = (update.message.text or update.message.caption or "").strip()
    if not raw_text:
        return

    source_info = get_forward_source_info(update.message)
    is_forwarded = bool(source_info)

    # Check if text looks like JSON or contains account keywords
    has_brackets = ("{" in raw_text and "}" in raw_text) or ("[" in raw_text and "]" in raw_text)
    lower = raw_text.lower()
    has_account_terms = any(kw in lower for kw in ("mobile", "phone", "xo", "ox", "accounts", "session", "user_id", "records"))

    # Ignore ordinary conversation messages that aren't accounts or forwards
    if not (has_brackets or has_account_terms or is_forwarded):
        return

    source_name = f"forwarded_{source_info}" if is_forwarded else "pasted_text"
    parsed_records = AccountDataParser.parse_raw_content(raw_text, source_name=source_name)

    valid_records = [a for a in parsed_records if a.is_valid]
    if not valid_records:
        # Only notify if user explicitly intended to send/forward account JSON
        if is_forwarded or (has_brackets and has_account_terms):
            await update.message.reply_text(
                "⚠️ Could not parse valid account JSON from the message.\n"
                "Please verify that the JSON contains mobile numbers and authentication (<code>xo</code>) or refresh (<code>ox</code>) tokens.",
                parse_mode="HTML"
            )
        return

    # Add to user's staged batch
    staged = _user_staged_batches.get(user_id)
    if not staged:
        batch_id = f"batch_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        staged = {"batch_id": batch_id, "accounts": [], "identifiers": set()}
        _user_staged_batches[user_id] = staged

    eligible, duplicates = AccountDataParser.deduplicate_batch(parsed_records, staged["identifiers"])
    for a in eligible:
        staged["accounts"].append(a)
        staged["identifiers"].add(a.stable_identifier)
    for d in duplicates:
        staged["accounts"].append(d)

    total_valid = sum(1 for a in eligible if a.is_valid)
    total_staged = len(staged["accounts"])

    keyboard = [
        [InlineKeyboardButton("🚀 Start Refreshing Queue", callback_data="action:process_queue")],
        [
            InlineKeyboardButton("➕ Add More", callback_data="cmd:refresh"),
            InlineKeyboardButton("🗑️ Clear", callback_data="action:clear_staged")
        ]
    ]

    if is_forwarded:
        header_text = f"📥 <b>Forwarded Account JSON Received</b>\n<i>Forwarded from: {html.escape(source_info)}</i>"
    else:
        header_text = "📥 <b>Pasted JSON Received</b>"

    await update.message.reply_text(
        f"{header_text}\n\n"
        f"• Extracted: <b>{len(parsed_records)}</b> accounts\n"
        f"• Eligible & Valid: <b>{total_valid}</b>\n"
        f"• Duplicates Skipped: <b>{len(duplicates)}</b>\n\n"
        f"<b>Total in Current Staged Batch: {total_staged}</b> accounts.\n"
        f"Ready to refresh? Click <b>🚀 Start Refreshing Queue</b> below.",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )


# ==============================================================================
# INLINE CALLBACK QUERY HANDLER
# ==============================================================================

@check_auth
async def handle_callback_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Processes interactive inline button actions."""
    query = update.callback_query
    await query.answer()
    data = query.data or ""
    user_id = update.effective_user.id

    # Route: Navigation Commands
    if data == "cmd:start":
        await start_command(update, context)
        return
    elif data == "cmd:refresh":
        await refresh_command(update, context)
        return
    elif data == "cmd:status":
        await status_command(update, context)
        return
    elif data == "cmd:results":
        await results_command(update, context)
        return
    elif data == "cmd:help":
        await help_command(update, context)
        return
    elif data == "cmd:admin":
        await admin_command(update, context)
        return

    # Route: 1-Click Refresh All JSON Directly in Database
    if data == "action:refresh_all_db":
        await start_direct_refresh_flow(update, context)
        return
    elif data == "action:refresh_all_pause":
        if _active_direct_refresher and _active_direct_refresher.is_running:
            _active_direct_refresher.pause()
            await query.answer("⏸️ Paused refresh workers.")
            text, kb = _active_direct_refresher.format_progress_text()
            try:
                await query.edit_message_text(text, reply_markup=kb, parse_mode="HTML")
            except Exception:
                pass
        else:
            await query.answer("No active refresh to pause.")
        return
    elif data == "action:refresh_all_resume":
        if _active_direct_refresher and _active_direct_refresher.is_running:
            _active_direct_refresher.resume()
            await query.answer("▶️ Resumed refresh workers.")
            text, kb = _active_direct_refresher.format_progress_text()
            try:
                await query.edit_message_text(text, reply_markup=kb, parse_mode="HTML")
            except Exception:
                pass
        else:
            await query.answer("No active refresh to resume.")
        return
    elif data == "action:refresh_all_cancel":
        if _active_direct_refresher and _active_direct_refresher.is_running:
            _active_direct_refresher.cancel()
            await query.answer("🛑 Cancelling refresh...")
            text, kb = _active_direct_refresher.format_progress_text()
            try:
                await query.edit_message_text(text, reply_markup=kb, parse_mode="HTML")
            except Exception:
                pass
        else:
            await query.answer("No active refresh to cancel.")
        return

    # Route: Process Staged Batch
    if data == "action:process_queue":
        staged = _user_staged_batches.get(user_id)
        if not staged or not staged["accounts"]:
            await query.edit_message_text(
                "⚠️ No staged accounts to process. Please upload files or paste JSON first.",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔄 Refresh Session", callback_data="cmd:refresh")]])
            )
            return

        batch_id = staged["batch_id"]
        accounts = staged["accounts"]
        # Save to database
        await BotStorage.create_batch(batch_id, user_id, accounts)
        # Clear staged
        _user_staged_batches.pop(user_id, None)

        # Enqueue processing
        qm = get_queue_manager()
        await qm.enqueue_batch(batch_id)

        await query.edit_message_text(
            f"🚀 <b>Token Refresh in Progress...</b>\n\n"
            f"<b>Batch ID:</b> <code>{batch_id}</code>\n"
            f"<b>Accounts:</b> {len(accounts)}\n\n"
            f"⚡ Processing and verifying account tokens...\n"
            f"💾 <i>All refreshed sessions will be updated directly in the bot database. No files sent to chat.</i>",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📊 View Live Status", callback_data="cmd:status")],
                [InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")]
            ]),
            parse_mode="HTML"
        )
        return

    # Route: Clear Staged Accounts
    if data == "action:clear_staged":
        _user_staged_batches.pop(user_id, None)
        await query.edit_message_text(
            "🗑️ Staged accounts have been cleared.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔄 New Session", callback_data="cmd:refresh")]])
        )
        return

    # Route: Pause Batch
    if data.startswith("action:pause:"):
        b_id = data.split("action:pause:")[1]
        qm = get_queue_manager()
        qm.pause_batch(b_id)
        await status_command(update, context)
        return

    # Route: Resume Batch
    if data.startswith("action:resume:"):
        b_id = data.split("action:resume:")[1]
        qm = get_queue_manager()
        qm.resume_batch(b_id)
        await status_command(update, context)
        return

    # Route: Cancel Batch
    if data.startswith("action:cancel:"):
        b_id = data.split("action:cancel:")[1]
        qm = get_queue_manager()
        qm.cancel_batch(b_id)
        await status_command(update, context)
        return

    # Route: Refresh Status UI
    if data.startswith("action:refresh_status:"):
        await status_command(update, context)
        return

    # Route: View Results for Batch
    if data.startswith("action:view_results:"):
        await results_command(update, context)
        return

    # Route: Retry Failed
    if data.startswith("action:retry:"):
        b_id = data.split("action:retry:")[1]
        accounts = await BotStorage.get_batch_accounts(b_id)
        retryable = [a for a in accounts if a["status"] in ("FAILED", "NETWORK_ERROR", "RATE_LIMITED")]
        for acc in retryable:
            await BotStorage.update_account_result(acc["id"], "PENDING", error_message="Enqueued for retry")
        qm = get_queue_manager()
        await qm.enqueue_batch(b_id)
        await query.edit_message_text(
            f"🔁 Enqueued {len(retryable)} accounts for retry in batch <code>{b_id}</code>.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("📊 View Status", callback_data="cmd:status")]]),
            parse_mode="HTML"
        )
        return

    # Route: Admin Controls & Settings (Strictly Admin only)
    if data.startswith("admin:") or data == "action:admin_cleanup":
        if not BotConfig.is_user_admin(user_id):
            await query.answer("Access Denied: Admin privileges required.", show_alert=True)
            return

        if data == "action:admin_cleanup":
            cleaned = clean_expired_temporary_files(0)
            await query.answer(f"Cleaned {cleaned} temporary files.", show_alert=True)
            await admin_command(update, context)
            return

        if data.startswith("admin:set_conc:"):
            val = int(data.split(":")[2])
            qm = get_queue_manager()
            qm.concurrency = val
            qm._semaphore = asyncio.Semaphore(val)
            await query.answer(f"Worker concurrency updated to {val}!", show_alert=True)
            await admin_command(update, context)
            return

        if data.startswith("admin:set_delay:"):
            val = float(data.split(":")[2])
            qm = get_queue_manager()
            qm.rate_limit_delay = val
            await query.answer(f"Rate limit delay updated to {val}s!", show_alert=True)
            await admin_command(update, context)
            return

        if data == "admin:stats":
            import aiosqlite
            async with aiosqlite.connect(str(BotConfig.DATABASE_PATH)) as db:
                async with db.execute("SELECT COUNT(*), COALESCE(SUM(total_count), 0), COALESCE(SUM(success_count), 0), COALESCE(SUM(failed_count), 0) FROM batches") as cursor:
                    row = await cursor.fetchone()
                    t_batches = row[0] or 0
                    t_accs = row[1] or 0
                    t_succ = row[2] or 0
                    t_fail = row[3] or 0

            await query.answer()
            await query.edit_message_text(
                f"📊 <b>Global Database Metrics</b>\n\n"
                f"• Total Batches Registered: <b>{t_batches}</b>\n"
                f"• Total Accounts Staged: <b>{t_accs}</b>\n"
                f"• Successfully Refreshed: <b>{t_succ}</b> ✅\n"
                f"• Total Failed/Expired: <b>{t_fail}</b> ❌\n"
                f"• Concurrency Setting: <b>{qm.concurrency}</b>\n"
                f"• Rate Limit Delay: <b>{qm.rate_limit_delay}s</b>",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Back to Admin", callback_data="cmd:admin")]]),
                parse_mode="HTML"
            )
            return

    # Route: Export Combined JSON
    if data.startswith("export:combined:"):
        b_id = data.split("export:combined:")[1]
        refreshed_list = await BotStorage.get_refreshed_accounts_json(b_id)
        if not refreshed_list:
            await query.answer("No refreshed accounts available for export.", show_alert=True)
            return

        export_path = BotConfig.EXPORTS_DIR / f"accounts_batch_{b_id}_refreshed.json"
        with open(export_path, "w", encoding="utf-8") as f:
            json.dump(refreshed_list, f, indent=2, ensure_ascii=False)

        with open(export_path, "rb") as f:
            await context.bot.send_document(
                chat_id=update.effective_chat.id,
                document=InputFile(f, filename=export_path.name),
                caption=f"📦 <b>Combined Refreshed Accounts JSON</b>\nTotal Accounts: {len(refreshed_list)}",
                parse_mode="HTML"
            )
        return

    # Route: Export Individual JSON Files (Separately, NO ZIP!)
    if data.startswith("export:individual:"):
        b_id = data.split("export:individual:")[1]
        refreshed_list = await BotStorage.get_refreshed_accounts_json(b_id)
        if not refreshed_list:
            await query.answer("No refreshed accounts available for export.", show_alert=True)
            return

        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=f"📤 Sending <b>{len(refreshed_list)}</b> refreshed accounts as individual JSON files...",
            parse_mode="HTML"
        )

        for idx, acc in enumerate(refreshed_list):
            mobile = acc.get("mobile") or acc.get("phone") or acc.get("user_id") or f"acc_{idx + 1}"
            clean_mobile = str(mobile).replace("+", "").strip()
            fname = f"account_{clean_mobile}_refreshed.json"
            fpath = BotConfig.SCRATCH_DIR / fname

            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(acc, f, indent=2, ensure_ascii=False)

            with open(fpath, "rb") as f:
                await context.bot.send_document(
                    chat_id=update.effective_chat.id,
                    document=InputFile(f, filename=fname),
                    caption=f"📄 Account: <code>{mobile}</code> (Refreshed & Verified)",
                    parse_mode="HTML"
                )
            # Brief delay between document sends to avoid flooding
            time.sleep(0.15)
        return

    # Route: Export Failure Report (Token-free safe report)
    if data.startswith("export:failure:"):
        b_id = data.split("export:failure:")[1]
        failures = await BotStorage.get_failure_report(b_id)
        if not failures:
            await query.answer("No failed accounts to report.", show_alert=True)
            return

        rep_path = BotConfig.EXPORTS_DIR / f"failure_report_{b_id}.json"
        with open(rep_path, "w", encoding="utf-8") as f:
            json.dump({
                "batch_id": b_id,
                "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "total_failures": len(failures),
                "failures": failures
            }, f, indent=2, ensure_ascii=False)

        with open(rep_path, "rb") as f:
            await context.bot.send_document(
                chat_id=update.effective_chat.id,
                document=InputFile(f, filename=rep_path.name),
                caption=f"⚠️ <b>Failure & Attention Report</b>\nTotal Non-Refreshed: {len(failures)}",
                parse_mode="HTML"
            )
        return


# ==============================================================================
# APPLICATION FACTORY & MAIN RUNNER
# ==============================================================================

def create_bot_application() -> Application:
    """Builds and configures the python-telegram-bot Application instance."""
    token = BotConfig.TELEGRAM_BOT_TOKEN
    if not token or token.startswith("123456789:ABC"):
        logger.warning("TELEGRAM_BOT_TOKEN is not configured or using default placeholder.")

    # Initialize storage tables
    import asyncio
    asyncio.run(BotStorage.init_db())

    app = Application.builder().token(token or "DUMMY_TOKEN_FOR_TESTS").build()
    global _bot_instance
    _bot_instance = app.bot

    # Commands
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("refresh_all", refresh_all_command))
    app.add_handler(CommandHandler("refresh", refresh_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("results", results_command))
    app.add_handler(CommandHandler("retry", retry_command))
    app.add_handler(CommandHandler("pause", pause_command))
    app.add_handler(CommandHandler("resume", resume_command))
    app.add_handler(CommandHandler("cancel", cancel_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("admin", admin_command))

    # Documents and Text/Captions (including forwarded messages)
    app.add_handler(MessageHandler(filters.Document.ALL, handle_document_upload))
    app.add_handler(MessageHandler((filters.TEXT | filters.CAPTION) & ~filters.COMMAND, handle_pasted_text))

    # Inline Keyboard Callbacks
    app.add_handler(CallbackQueryHandler(handle_callback_query))

    import telegram.error

    async def bot_error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handles exceptions and logs conflicts cleanly without crashing."""
        if isinstance(context.error, telegram.error.Conflict):
            logger.warning(
                "Telegram polling conflict: Another bot instance is polling with this token. "
                "Backing off for 15s to avoid duplicate request collisions..."
            )
            await asyncio.sleep(15)
        elif isinstance(context.error, (telegram.error.NetworkError, telegram.error.TimedOut)):
            logger.warning(f"Telegram network issue: {context.error}. Reconnecting...")
        else:
            logger.error(f"Telegram bot exception encountered: {context.error}", exc_info=context.error)

    app.add_error_handler(bot_error_handler)

    return app


def main():
    """Main entrypoint for running the bot."""
    print("=" * 60)
    print("Starting Independent Telegram Account Token Refresh Bot...")
    print(f"Allowed User IDs: {BotConfig.ALLOWED_USER_IDS or 'All (Development mode)'}")
    print(f"Provider URL: {BotConfig.PROVIDER_REFRESH_URL}")
    print(f"Concurrency: {BotConfig.MAX_CONCURRENCY}")
    print("=" * 60)

    while True:
        try:
            app = create_bot_application()
            app.run_polling(drop_pending_updates=True)
            break
        except KeyboardInterrupt:
            break
        except Exception as e:
            err_msg = str(e)
            if "Conflict" in err_msg or "terminated by other getUpdates" in err_msg:
                logger.warning("Telegram polling conflict detected (previous instance shutting down). Retrying in 4s...")
                time.sleep(4)
            else:
                logger.error(f"Telegram bot exception encountered: {e}. Retrying in 5s...", exc_info=True)
                time.sleep(5)


if __name__ == "__main__":
    main()
