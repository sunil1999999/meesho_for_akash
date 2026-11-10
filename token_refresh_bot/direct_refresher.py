"""
Direct In-Bot Database Session Refresher.
Processes all stored account sessions directly inside the bot's database:
- Concurrently refreshes accounts in parallel using configurable semaphore workers.
- Avoids duplicate processing of the same account via mutex locks.
- Updates database records in-place immediately upon success.
- Preserves original JSON if refreshing fails; never overwrites with empty tokens.
- Provides live updating progress display in a single Telegram message.
- Delivers a comprehensive completion report with zero chat spam (NO files sent to chat).
- Fully supports Pause, Resume, and Cancel without data corruption.
"""

import asyncio
import logging
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from config import BotConfig
from storage import BotStorage
from provider import BaseRefreshEngine, OutcomeStatus, RefreshResult
from security import SecurityManager

logger = logging.getLogger("DirectRefresher")


class DirectDatabaseRefresher:
    """Orchestrates in-place token refreshes for all stored database accounts."""

    def __init__(self, engine: BaseRefreshEngine, concurrency: Optional[int] = None):
        self.engine = engine
        self.concurrency = concurrency or BotConfig.MAX_CONCURRENCY
        self.max_retries = BotConfig.MAX_RETRIES
        self.rate_limit_delay = BotConfig.RATE_LIMIT_DELAY
        self.backoff_factor = BotConfig.BACKOFF_FACTOR

        # Concurrency & Locks
        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._account_locks: Dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

        # Operational state
        self.is_running: bool = False
        self.is_paused: bool = False
        self.is_cancelled: bool = False
        self._pause_event: asyncio.Event = asyncio.Event()
        self._pause_event.set()

        # Metrics
        self.total_count: int = 0
        self.success_count: int = 0
        self.failed_count: int = 0
        self.expired_count: int = 0
        self.skipped_count: int = 0
        self.processing_count: int = 0

        self.current_identifier: str = ""
        self.current_status_desc: str = "Initializing..."
        self.start_time: float = 0.0
        self.end_time: float = 0.0

        # Throttling
        self._last_edit_time: float = 0.0
        self._min_edit_interval: float = 1.2
        self._progress_callback: Optional[Callable[["DirectDatabaseRefresher"], Any]] = None

    async def _get_account_lock(self, identifier: str) -> asyncio.Lock:
        async with self._global_lock:
            if identifier not in self._account_locks:
                self._account_locks[identifier] = asyncio.Lock()
            return self._account_locks[identifier]

    def set_progress_callback(self, callback: Callable[["DirectDatabaseRefresher"], Any]):
        """Sets the callback invoked when progress updates occur."""
        self._progress_callback = callback

    def pause(self):
        """Pauses worker dispatch."""
        self.is_paused = True
        self._pause_event.clear()
        self.current_status_desc = "Paused by user"
        logger.info("Direct database refresh PAUSED by user.")

    def resume(self):
        """Resumes worker dispatch."""
        self.is_paused = False
        self._pause_event.set()
        self.current_status_desc = "Resuming processing..."
        logger.info("Direct database refresh RESUMED by user.")

    def cancel(self):
        """Cancels remaining accounts safely without corrupting completed records."""
        self.is_cancelled = True
        self._pause_event.set()  # Unblock any waiting workers so they exit cleanly
        self.current_status_desc = "Cancellation requested"
        logger.warning("Direct database refresh CANCELLED by user.")

    async def _notify_progress(self, force: bool = False):
        """Fires throttled progress callback to avoid Telegram FloodWait."""
        now = time.time()
        if not force and (now - self._last_edit_time < self._min_edit_interval):
            return
        self._last_edit_time = now

        if self._progress_callback:
            try:
                res = self._progress_callback(self)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                logger.debug(f"Progress notification error: {e}")

    async def run_refresh_all(self, accounts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Executes parallel refresh across all stored database accounts.
        Returns final execution summary.
        """
        self.is_running = True
        self.is_paused = False
        self.is_cancelled = False
        self._pause_event.set()

        self.total_count = len(accounts)
        self.success_count = 0
        self.failed_count = 0
        self.expired_count = 0
        self.skipped_count = 0
        self.processing_count = 0

        self.start_time = time.time()
        self.current_status_desc = f"Starting {self.concurrency} parallel workers..."
        await self._notify_progress(force=True)

        worker_tasks = []
        for acc in accounts:
            t = asyncio.create_task(self._process_single_account(acc))
            worker_tasks.append(t)

        if worker_tasks:
            await asyncio.gather(*worker_tasks, return_exceptions=True)

        self.end_time = time.time()
        self.is_running = False
        self.processing_count = 0
        self.current_status_desc = "Completed" if not self.is_cancelled else "Cancelled"

        # Final notification
        await self._notify_progress(force=True)

        return {
            "total_accounts": self.total_count,
            "success_count": self.success_count,
            "failed_count": self.failed_count,
            "expired_count": self.expired_count,
            "skipped_count": self.skipped_count,
            "execution_time_seconds": round(self.end_time - self.start_time, 2),
            "is_cancelled": self.is_cancelled
        }

    async def _process_single_account(self, acc_info: Dict[str, Any]):
        """Processes one account under semaphore and mutex, with retry backoff."""
        identifier = acc_info["account_identifier"]
        record_id = acc_info["record_id"]
        raw_session = acc_info.get("raw_session")

        if self.is_cancelled:
            self.skipped_count += 1
            return

        # Check pause
        await self._pause_event.wait()

        if self.is_cancelled:
            self.skipped_count += 1
            return

        async with self._semaphore:
            lock = await self._get_account_lock(identifier)
            async with lock:
                if self.is_cancelled:
                    self.skipped_count += 1
                    return

                self.processing_count += 1
                self.current_identifier = identifier
                self.current_status_desc = f"Refreshing {SecurityManager.mask_phone(identifier)}..."
                await self._notify_progress()

                if not raw_session or not isinstance(raw_session, dict):
                    self.failed_count += 1
                    self.processing_count = max(0, self.processing_count - 1)
                    await BotStorage.update_account_session_in_place(
                        account_identifier=identifier,
                        record_id=record_id,
                        status="INVALID_FORMAT",
                        error_message="Corrupted raw session payload"
                    )
                    await self._notify_progress()
                    return

                # Attempt refresh with retries for temporary network errors
                attempt = 0
                final_result: Optional[RefreshResult] = None

                while attempt <= self.max_retries:
                    if self.is_cancelled:
                        break

                    # Rate limit delay
                    if self.rate_limit_delay > 0:
                        await asyncio.sleep(self.rate_limit_delay)

                    try:
                        result = await self.engine.refresh_account(raw_session)
                        final_result = result
                    except Exception as exc:
                        logger.warning(f"Exception during refresh of {identifier}: {exc}")
                        final_result = RefreshResult(
                            status=OutcomeStatus.NETWORK_ERROR,
                            error_message=str(exc),
                            can_retry=True
                        )

                    # Check permanent outcomes (no retry)
                    if final_result.status in (
                        OutcomeStatus.SUCCESS,
                        OutcomeStatus.EXPIRED_SESSION,
                        OutcomeStatus.REQUIRES_REAUTH,
                        OutcomeStatus.INVALID_TOKEN,
                        OutcomeStatus.UNSUPPORTED_FORMAT
                    ):
                        break

                    # Retry temporary error
                    if final_result.can_retry and attempt < self.max_retries and not self.is_cancelled:
                        attempt += 1
                        delay = final_result.retry_after if final_result.retry_after else (self.backoff_factor ** attempt)
                        self.current_status_desc = f"Retrying {SecurityManager.mask_phone(identifier)} ({attempt}/{self.max_retries})..."
                        await self._notify_progress()
                        await asyncio.sleep(delay)
                    else:
                        break

                self.processing_count = max(0, self.processing_count - 1)

                # Persist outcome directly in the database
                if final_result:
                    if final_result.status == OutcomeStatus.SUCCESS:
                        self.success_count += 1
                        await BotStorage.update_account_session_in_place(
                            account_identifier=identifier,
                            record_id=record_id,
                            status="SUCCESS",
                            refreshed_data=final_result.refreshed_data,
                            error_message=None
                        )
                    elif final_result.status in (OutcomeStatus.EXPIRED_SESSION, OutcomeStatus.REQUIRES_REAUTH):
                        self.expired_count += 1
                        await BotStorage.update_account_session_in_place(
                            account_identifier=identifier,
                            record_id=record_id,
                            status="EXPIRED",
                            error_message=final_result.error_message
                        )
                    else:
                        self.failed_count += 1
                        await BotStorage.update_account_session_in_place(
                            account_identifier=identifier,
                            record_id=record_id,
                            status=final_result.status.value,
                            error_message=final_result.error_message
                        )
                else:
                    self.skipped_count += 1

                await self._notify_progress()

    def format_progress_text(self) -> Tuple[str, InlineKeyboardMarkup]:
        """Renders live updating status message with progress bar and metrics."""
        completed = self.success_count + self.failed_count + self.expired_count + self.skipped_count
        remaining = max(0, self.total_count - completed)
        percent = (completed / self.total_count * 100.0) if self.total_count > 0 else 0.0

        # Build progress bar (16 blocks)
        filled = int(percent / 100.0 * 16)
        bar = "█" * filled + "░" * (16 - filled)

        masked_phone = SecurityManager.mask_phone(self.current_identifier) if self.current_identifier else "None"
        state_icon = "⏸️ [PAUSED]" if self.is_paused else ("⚡ [RUNNING]" if self.is_running else "✅ [DONE]")

        text = (
            f"🔄 <b>Refresh All JSON Sessions</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"📊 <b>Progress:</b> <code>[{bar}]</code> <b>{percent:.1f}%</b> {state_icon}\n\n"
            f"• <b>Total JSON Sessions:</b> <b>{self.total_count}</b>\n"
            f"• <b>Successfully Refreshed:</b> <b>{self.success_count}</b> ✅\n"
            f"• <b>Failed Sessions:</b> <b>{self.failed_count}</b> ❌\n"
            f"• <b>Expired / Invalid:</b> <b>{self.expired_count}</b> ⚠️\n"
            f"• <b>Currently Processing:</b> <b>{self.processing_count}</b> ⚡\n"
            f"• <b>Remaining Sessions:</b> <b>{remaining}</b> ⏳\n\n"
            f"📱 <b>Current:</b> <code>{masked_phone}</code>\n"
            f"⚙️ <b>Status:</b> {self.current_status_desc}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"<i>Updating directly in database • No chat files sent</i>"
        )

        buttons = []
        if self.is_running:
            if self.is_paused:
                buttons.append([
                    InlineKeyboardButton("▶️ Resume", callback_data="action:refresh_all_resume"),
                    InlineKeyboardButton("🛑 Cancel", callback_data="action:refresh_all_cancel")
                ])
            else:
                buttons.append([
                    InlineKeyboardButton("⏸️ Pause", callback_data="action:refresh_all_pause"),
                    InlineKeyboardButton("🛑 Cancel", callback_data="action:refresh_all_cancel")
                ])
        buttons.append([InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")])

        return text, InlineKeyboardMarkup(buttons)

    def format_completion_text(self) -> Tuple[str, InlineKeyboardMarkup]:
        """Renders the comprehensive final report."""
        elapsed = max(0.1, (self.end_time or time.time()) - self.start_time)
        status_icon = "🎉" if self.success_count > 0 else "⚠️"
        title = "One-Click Refresh All JSON Completed!" if not self.is_cancelled else "Refresh All JSON Stopped (Cancelled)"

        text = (
            f"{status_icon} <b>{title}</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"• <b>Total Accounts Processed:</b> <b>{self.total_count}</b>\n"
            f"• <b>Successfully Refreshed:</b> <b>{self.success_count}</b> ✅\n"
            f"• <b>Failed:</b> <b>{self.failed_count}</b> ❌\n"
            f"• <b>Expired / Invalid:</b> <b>{self.expired_count}</b> ⚠️\n"
            f"• <b>Skipped:</b> <b>{self.skipped_count}</b> ⏭️\n"
            f"• <b>Total Execution Time:</b> <b>{elapsed:.1f}s</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💾 <b>All refreshed sessions saved directly in bot database.</b>\n"
            f"🔒 <i>Zero chat spam • No files or JSON sent to chat.</i>"
        )

        keyboard = [
            [InlineKeyboardButton("🔄 Refresh All JSON Again", callback_data="action:refresh_all_db")],
            [InlineKeyboardButton("📊 View Stored Accounts", callback_data="cmd:status")],
            [InlineKeyboardButton("🔙 Main Menu", callback_data="cmd:start")]
        ]
        return text, InlineKeyboardMarkup(keyboard)

