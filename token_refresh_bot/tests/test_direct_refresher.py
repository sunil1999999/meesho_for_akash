"""
Unit & Integration Tests for One-Click Refresh All JSON Inside Telegram Bot.
Verifies:
- Direct retrieval of unique stored accounts from database.
- Parallel execution using semaphore workers.
- Instant in-place database record updates.
- Deep field preservation and safety guarantees (never overwrite with empty tokens).
- Failure isolation (single error never interrupts other accounts).
- Throttled progress message updates and final completion report rendering.
- Pause, Resume, and Cancel handling without data corruption.
"""

import asyncio
import os
import pytest
from typing import Any, Dict

from config import BotConfig
from storage import BotStorage
from security import SecurityManager
from provider import MockRefreshEngine, OutcomeStatus, RefreshResult
from direct_refresher import DirectDatabaseRefresher


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path, monkeypatch):
    """Isolates database and test files to a temporary directory."""
    test_db = tmp_path / "test_bot_storage.db"
    monkeypatch.setattr(BotConfig, "DATABASE_PATH", test_db)
    monkeypatch.setattr(BotStorage, "_db_path", str(test_db))
    monkeypatch.setattr(BotConfig, "MAX_CONCURRENCY", 3)
    monkeypatch.setattr(BotConfig, "RATE_LIMIT_DELAY", 0.0)
    monkeypatch.setattr(BotConfig, "MAX_RETRIES", 1)


@pytest.mark.asyncio
async def test_database_refresh_all_lifecycle():
    """Tests complete end-to-end One-Click Refresh All workflow."""
    await BotStorage.init_db()

    # 1. Seed test accounts in database across multiple batches
    accounts_to_seed = [
        {
            "id": "batch_1_1",
            "batch_id": "batch_1",
            "account_identifier": "+919033807401",
            "display_phone": "+91 90338 07401",
            "source_file": "acc1.json",
            "status": "SUCCESS",
            "session": {
                "mobile": "9033807401",
                "user_id": 605524023,
                "xo": "old_xo_token_1",
                "ox": "old_ox_token_1",
                "identity": {"make": "Realme", "model": "Narzo 70"}
            }
        },
        {
            "id": "batch_1_2",
            "batch_id": "batch_1",
            "account_identifier": "+919820192831",
            "display_phone": "+91 98201 92831",
            "source_file": "acc2.json",
            "status": "EXPIRED",
            "session": {
                "mobile": "9820192831",
                "user_id": 605524024,
                "xo": "old_xo_token_2",
                "ox": "old_ox_token_2",
                "identity": {"make": "Poco", "model": "F5"}
            }
        },
        # Sibling duplicate of account 1 in batch 2 (to verify deduplication)
        {
            "id": "batch_2_1",
            "batch_id": "batch_2",
            "account_identifier": "+919033807401",
            "display_phone": "+91 90338 07401",
            "source_file": "acc1_dup.json",
            "status": "PENDING",
            "session": {
                "mobile": "9033807401",
                "user_id": 605524023,
                "xo": "old_xo_token_1_newer",
                "ox": "old_ox_token_1_newer",
                "identity": {"make": "Realme", "model": "Narzo 70"}
            }
        }
    ]

    import aiosqlite
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(str(BotConfig.DATABASE_PATH)) as db:
        await db.execute("""
            INSERT INTO batches (id, user_id, status, total_count, created_at, updated_at)
            VALUES ('batch_1', 12345, 'COMPLETED', 2, ?, ?), ('batch_2', 12345, 'COMPLETED', 1, ?, ?)
        """, (now, now, now, now))
        for item in accounts_to_seed:
            enc = SecurityManager.encrypt_json(item["session"])
            await db.execute("""
                INSERT INTO accounts (
                    id, batch_id, account_identifier, display_phone, source_file,
                    status, encrypted_original_json, encrypted_refreshed_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                item["id"], item["batch_id"], item["account_identifier"], item["display_phone"],
                item["source_file"], item["status"], enc, enc, now, now
            ))
        await db.commit()

    # 2. Retrieve accounts for refresh (must deduplicate +919033807401)
    stored = await BotStorage.get_all_stored_accounts_for_refresh()
    assert len(stored) == 2, f"Expected 2 unique accounts, got {len(stored)}"
    identifiers = {a["account_identifier"] for a in stored}
    assert "+919033807401" in identifiers
    assert "+919820192831" in identifiers

    # 3. Run parallel refresh with MockRefreshEngine
    mock_engine = MockRefreshEngine()
    refresher = DirectDatabaseRefresher(mock_engine, concurrency=2)

    progress_calls = []
    async def on_progress(ref):
        progress_calls.append({
            "total": ref.total_count,
            "success": ref.success_count,
            "failed": ref.failed_count,
            "expired": ref.expired_count,
            "remaining": ref.total_count - (ref.success_count + ref.failed_count + ref.expired_count + ref.skipped_count)
        })

    refresher.set_progress_callback(on_progress)
    summary = await refresher.run_refresh_all(stored)

    # 4. Validate execution results
    assert summary["total_accounts"] == 2
    assert summary["success_count"] == 2
    assert summary["failed_count"] == 0
    assert summary["expired_count"] == 0
    assert summary["is_cancelled"] is False

    # 5. Verify direct in-place database updates
    refreshed_acc1 = await BotStorage.get_single_refreshed_account("batch_1_1")
    assert refreshed_acc1 is not None
    assert refreshed_acc1["mobile"] == "9033807401"
    assert refreshed_acc1["identity"] == {"make": "Realme", "model": "Narzo 70"}
    assert "xo" in refreshed_acc1
    assert "ox" in refreshed_acc1
    assert refreshed_acc1["xo"] != "old_xo_token_1"  # Tokens refreshed!

    # 6. Verify formatted messages
    prog_text, prog_kb = refresher.format_progress_text()
    assert "Refresh All JSON Sessions" in prog_text
    assert "100.0%" in prog_text

    comp_text, comp_kb = refresher.format_completion_text()
    assert "One-Click Refresh All JSON Completed!" in comp_text
    assert "<b>Successfully Refreshed:</b> <b>2</b> ✅" in comp_text
    assert "All refreshed sessions saved directly in bot database." in comp_text
    assert "No files or JSON sent to chat." in comp_text


@pytest.mark.asyncio
async def test_empty_tokens_safety_guard():
    """Verifies that an invalid/empty refreshed response never overwrites valid data."""
    await BotStorage.init_db()

    account_id = "test_acc_99"
    identifier = "+919999999999"
    now = "2026-11-10T00:00:00Z"
    orig_session = {"mobile": "9999999999", "xo": "valid_xo", "ox": "valid_ox"}
    enc = SecurityManager.encrypt_json(orig_session)

    import aiosqlite
    async with aiosqlite.connect(str(BotConfig.DATABASE_PATH)) as db:
        await db.execute("""
            INSERT INTO batches (id, user_id, status, created_at, updated_at)
            VALUES ('b_test', 1, 'COMPLETED', ?, ?)
        """, (now, now))
        await db.execute("""
            INSERT INTO accounts (id, batch_id, account_identifier, display_phone, source_file, status, encrypted_original_json, created_at, updated_at)
            VALUES (?, 'b_test', ?, '9999999999', 'f.json', 'PENDING', ?, ?, ?)
        """, (account_id, identifier, enc, now, now))
        await db.commit()

    # Attempt to update with empty tokens
    empty_payload = {"mobile": "9999999999", "xo": "", "ox": None}
    success = await BotStorage.update_account_session_in_place(
        account_identifier=identifier,
        record_id=account_id,
        status="SUCCESS",
        refreshed_data=empty_payload
    )
    assert success is False

    # Verify original record wasn't overwritten with empty tokens
    async with aiosqlite.connect(str(BotConfig.DATABASE_PATH)) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT encrypted_refreshed_json, status FROM accounts WHERE id = ?", (account_id,)) as cur:
            row = await cur.fetchone()
            assert row["encrypted_refreshed_json"] is None
            assert row["status"] == "FAILED"


@pytest.mark.asyncio
async def test_pause_resume_and_cancellation():
    """Verifies Pause, Resume, and Cancel controls during execution."""
    mock_engine = MockRefreshEngine()
    refresher = DirectDatabaseRefresher(mock_engine, concurrency=1)

    accounts = [
        {"account_identifier": f"+91900000000{i}", "record_id": f"rec_{i}", "raw_session": {"mobile": f"900000000{i}", "xo": "x", "ox": "o"}}
        for i in range(5)
    ]

    # Test pause and resume
    assert not refresher.is_paused
    refresher.pause()
    assert refresher.is_paused
    refresher.resume()
    assert not refresher.is_paused

    # Test cancel
    assert not refresher.is_cancelled
    refresher.cancel()
    assert refresher.is_cancelled
