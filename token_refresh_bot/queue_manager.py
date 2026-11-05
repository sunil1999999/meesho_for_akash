"""
Asynchronous Processing Queue for Account Token Refresh Bot.
Supports:
- Configurable concurrency (asyncio.Semaphore)
- Rate limiting between provider calls
- Exponential backoff retry for transient network and rate limit errors
- Per-account mutex lock to prevent concurrent double-refresh
- Robust pause, resume, and cancel controls
- State preservation across bot restarts
- Failure isolation (single account failure never stops batch)
"""

import asyncio
import logging
from typing import Any, Callable, Dict, Optional, Set
from config import BotConfig
from storage import BotStorage
from provider import BaseRefreshEngine, OutcomeStatus, RefreshResult
from security import SecurityManager

logger = logging.getLogger("QueueManager")


class QueueManager:
    """Manages worker pool and queue execution for account batches."""

    def __init__(self, engine: BaseRefreshEngine):
        self.engine = engine
        self.concurrency = BotConfig.MAX_CONCURRENCY
        self.rate_limit_delay = BotConfig.RATE_LIMIT_DELAY
        self.max_retries = BotConfig.MAX_RETRIES
        self.backoff_factor = BotConfig.BACKOFF_FACTOR

        # Concurrency & Locks
        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._account_locks: Dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

        # Batch control state
        self._batch_pause_events: Dict[str, asyncio.Event] = {}
        self._cancelled_batches: Set[str] = set()
        self._running_tasks: Dict[str, asyncio.Task] = {}

        # Progress and completion callbacks
        self._progress_callbacks: Dict[str, Callable[[str, Dict[str, Any]], Any]] = {}
        self._completion_hook: Optional[Callable[[str, Dict[str, Any]], Any]] = None

    def _get_pause_event(self, batch_id: str) -> asyncio.Event:
        if batch_id not in self._batch_pause_events:
            ev = asyncio.Event()
            ev.set()  # Default is unpaused (running)
            self._batch_pause_events[batch_id] = ev
        return self._batch_pause_events[batch_id]

    async def _get_account_lock(self, identifier: str) -> asyncio.Lock:
        async with self._global_lock:
            if identifier not in self._account_locks:
                self._account_locks[identifier] = asyncio.Lock()
            return self._account_locks[identifier]

    def set_progress_callback(self, batch_id: str, callback: Callable[[str, Dict[str, Any]], Any]):
        """Registers a callback for progress updates (e.g. updating Telegram status message)."""
        self._progress_callbacks[batch_id] = callback

    def set_completion_hook(self, hook: Callable[[str, Dict[str, Any]], Any]):
        """Registers a global callback fired when a batch completes, enabling automatic file delivery."""
        self._completion_hook = hook

    def pause_batch(self, batch_id: str):
        """Pauses worker dispatch for a batch."""
        ev = self._get_pause_event(batch_id)
        ev.clear()
        asyncio.create_task(BotStorage.update_batch_status(batch_id, "PAUSED"))

    def resume_batch(self, batch_id: str):
        """Resumes worker dispatch for a paused batch."""
        ev = self._get_pause_event(batch_id)
        ev.set()
        asyncio.create_task(BotStorage.update_batch_status(batch_id, "PROCESSING"))

    def cancel_batch(self, batch_id: str):
        """Cancels all pending work for a batch safely."""
        self._cancelled_batches.add(batch_id)
        # Ensure event is set so workers unblock to process the cancellation
        ev = self._get_pause_event(batch_id)
        ev.set()
        asyncio.create_task(BotStorage.update_batch_status(batch_id, "CANCELLED"))

    def is_batch_paused(self, batch_id: str) -> bool:
        ev = self._get_pause_event(batch_id)
        return not ev.is_set()

    def is_batch_cancelled(self, batch_id: str) -> bool:
        return batch_id in self._cancelled_batches

    async def enqueue_batch(self, batch_id: str):
        """Spawns processing of a batch in the background."""
        task = asyncio.create_task(self._process_batch_loop(batch_id))
        self._running_tasks[batch_id] = task
        return task

    async def _process_batch_loop(self, batch_id: str):
        """Main orchestrator loop for processing a batch's accounts."""
        await BotStorage.update_batch_status(batch_id, "PROCESSING")
        accounts = await BotStorage.get_batch_accounts(batch_id)

        # Filter accounts that still need work (status PENDING or eligible for retry)
        pending_accounts = [a for a in accounts if a["status"] in ("PENDING", "RETRYING")]

        worker_tasks = []
        for acc in pending_accounts:
            t = asyncio.create_task(self._process_single_account(batch_id, acc))
            worker_tasks.append(t)

        if worker_tasks:
            await asyncio.gather(*worker_tasks, return_exceptions=True)

        # Final batch status check
        if self.is_batch_cancelled(batch_id):
            await BotStorage.update_batch_status(batch_id, "CANCELLED")
        else:
            await BotStorage.update_batch_status(batch_id, "COMPLETED")

        # Final progress notification callback
        await self._notify_progress(batch_id)

        # Trigger completion hook for automatic file delivery if not cancelled
        if self._completion_hook and not self.is_batch_cancelled(batch_id):
            batch_data = await BotStorage.get_batch(batch_id)
            if batch_data:
                try:
                    res = self._completion_hook(batch_id, batch_data)
                    if asyncio.iscoroutine(res):
                        await res
                except Exception as e:
                    logger.error(f"Error executing batch completion hook for {batch_id}: {e}", exc_info=True)

    async def _process_single_account(self, batch_id: str, acc_row: Dict[str, Any]):
        """Processes a single account under concurrency semaphore and mutex."""
        account_id = acc_row["id"]
        identifier = acc_row["account_identifier"]

        # Check cancellation before starting
        if self.is_batch_cancelled(batch_id):
            await BotStorage.update_account_result(
                account_id=account_id,
                status="CANCELLED",
                error_message="Batch processing was cancelled by user"
            )
            return

        # Check pause
        pause_ev = self._get_pause_event(batch_id)
        await pause_ev.wait()

        # Check cancellation again after unpause
        if self.is_batch_cancelled(batch_id):
            await BotStorage.update_account_result(
                account_id=account_id,
                status="CANCELLED",
                error_message="Batch processing was cancelled by user"
            )
            return

        # Acquire concurrency semaphore
        async with self._semaphore:
            # Acquire per-account lock to avoid parallel duplicates
            lock = await self._get_account_lock(identifier)
            async with lock:
                # Decrypt raw input
                orig_json = SecurityManager.decrypt_json(acc_row["encrypted_original_json"])
                if not orig_json:
                    await BotStorage.update_account_result(
                        account_id=account_id,
                        status="INVALID_FORMAT",
                        error_message="Corrupted original account payload"
                    )
                    return

                # Execute with retries & exponential backoff
                attempt = 0
                final_result: Optional[RefreshResult] = None

                while attempt <= self.max_retries:
                    # Respect rate limiting
                    if self.rate_limit_delay > 0:
                        await asyncio.sleep(self.rate_limit_delay)

                    # Execute refresh through provider engine
                    result = await self.engine.refresh_account(orig_json)
                    final_result = result

                    # If success or permanent error (expired, reauth, invalid), do not retry
                    if result.status in (
                        OutcomeStatus.SUCCESS,
                        OutcomeStatus.EXPIRED_SESSION,
                        OutcomeStatus.REQUIRES_REAUTH,
                        OutcomeStatus.INVALID_TOKEN,
                        OutcomeStatus.UNSUPPORTED_FORMAT
                    ):
                        break

                    # If temporary network error or rate limit, retry with backoff
                    if result.can_retry and attempt < self.max_retries:
                        attempt += 1
                        delay = result.retry_after if result.retry_after else (self.backoff_factor ** attempt)
                        logger.info(f"Retrying account {identifier} (attempt {attempt}/{self.max_retries}) after {delay:.1f}s: {result.error_message}")
                        await asyncio.sleep(delay)
                    else:
                        break

                # Record outcome in storage
                if final_result:
                    status_str = final_result.status.value
                    refreshed_data = final_result.refreshed_data if final_result.status == OutcomeStatus.SUCCESS else None
                    err_msg = final_result.error_message

                    await BotStorage.update_account_result(
                        account_id=account_id,
                        status=status_str,
                        refreshed_data=refreshed_data,
                        error_message=err_msg
                    )

                # Fire live progress callback
                await self._notify_progress(batch_id)

    async def _notify_progress(self, batch_id: str):
        """Fires registered progress callback."""
        cb = self._progress_callbacks.get(batch_id)
        if cb:
            batch_data = await BotStorage.get_batch(batch_id)
            if batch_data:
                try:
                    res = cb(batch_id, batch_data)
                    if asyncio.iscoroutine(res):
                        await res
                except Exception as e:
                    logger.warning(f"Error in progress callback for batch {batch_id}: {e}")

    async def recover_interrupted_batches(self):
        """Scans database for unfinished batches after bot restart and resumes them."""
        interrupted = await BotStorage.get_interrupted_batches()
        for batch in interrupted:
            b_id = batch["id"]
            logger.info(f"Recovering interrupted batch: {b_id} (status: {batch['status']})")
            await self.enqueue_batch(b_id)
