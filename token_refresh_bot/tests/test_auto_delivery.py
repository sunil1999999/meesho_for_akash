"""
Unit & Integration Tests for In-Bot Refresh Completion Reporting.
Tests:
- Refresh completion summary is sent to user chat upon batch completion
- All refreshed sessions are updated in database without auto-exporting files to chat
- Verification that QueueManager completion hook triggers upon batch completion
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

BOT_DIR = Path(__file__).resolve().parent.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import json
import pytest
import aiosqlite
from config import BotConfig
from storage import BotStorage
from parser import ParsedAccount
from queue_manager import QueueManager
from provider import MockRefreshEngine
import bot


@pytest.mark.asyncio
async def test_completion_summary_single_account_no_chat_export():
    """Validates that a single refreshed account updates in DB and sends summary message without sending files."""
    await BotStorage.init_db()

    batch_id = f"test_auto_delivery_single_{uuid.uuid4().hex[:8]}"
    user_id = 123456789

    account = ParsedAccount(
        stable_identifier="+919033807401",
        normalized_phone="+919033807401",
        display_phone="+91 90338 07401",
        user_id="605524023",
        raw_data={"mobile": "9033807401", "xo": "old_token", "ox": "old_refresh"},
        source_file="test.json",
        record_index=1,
        has_auth_token=True,
        has_refresh_token=True,
        is_valid=True
    )

    await BotStorage.create_batch(batch_id, user_id, [account])

    # Mark account refreshed
    refreshed_data = {"mobile": "9033807401", "xo": "NEW_TOKEN_XYZ", "ox": "NEW_REFRESH_ABC"}
    await BotStorage.update_account_result(
        account_id=f"{batch_id}_1",
        status="SUCCESS",
        refreshed_data=refreshed_data
    )
    await BotStorage.update_batch_status(batch_id, "COMPLETED")

    mock_bot = MagicMock()
    mock_bot.send_message = AsyncMock()
    mock_bot.send_document = AsyncMock()
    bot._bot_instance = mock_bot

    await bot.deliver_refreshed_batch_results(batch_id)

    # Verify summary message sent
    assert mock_bot.send_message.called
    msg_args = mock_bot.send_message.call_args[1]
    assert msg_args["chat_id"] == user_id
    assert "Token Refresh Completed" in msg_args["text"]
    assert "saved directly inside bot database" in msg_args["text"]

    # Verify NO documents are sent to chat (strictly in-bot refresh, no file spam)
    assert not mock_bot.send_document.called


@pytest.mark.asyncio
async def test_completion_summary_multiple_accounts_no_chat_export():
    """Validates that multiple refreshed accounts update in DB with zero file exports to chat."""
    await BotStorage.init_db()

    batch_id = f"test_auto_delivery_multi_{uuid.uuid4().hex[:8]}"
    user_id = 987654321

    accounts = [
        ParsedAccount(
            stable_identifier="+919033807401",
            normalized_phone="+919033807401",
            display_phone="+91 90338 07401",
            user_id="1",
            raw_data={"mobile": "9033807401", "xo": "t1", "ox": "r1"},
            source_file="f1.json",
            record_index=1,
            has_auth_token=True,
            has_refresh_token=True,
            is_valid=True
        ),
        ParsedAccount(
            stable_identifier="+919820192831",
            normalized_phone="+919820192831",
            display_phone="+91 98201 92831",
            user_id="2",
            raw_data={"mobile": "9820192831", "xo": "t2", "ox": "r2"},
            source_file="f2.json",
            record_index=2,
            has_auth_token=True,
            has_refresh_token=True,
            is_valid=True
        )
    ]

    await BotStorage.create_batch(batch_id, user_id, accounts)

    # Mark both as success
    await BotStorage.update_account_result(
        account_id=f"{batch_id}_1",
        status="SUCCESS",
        refreshed_data={"mobile": "9033807401", "xo": "NEW_1", "ox": "REF_1"}
    )
    await BotStorage.update_account_result(
        account_id=f"{batch_id}_2",
        status="SUCCESS",
        refreshed_data={"mobile": "9820192831", "xo": "NEW_2", "ox": "REF_2"}
    )
    await BotStorage.update_batch_status(batch_id, "COMPLETED")

    mock_bot = MagicMock()
    mock_bot.send_message = AsyncMock()
    mock_bot.send_document = AsyncMock()
    bot._bot_instance = mock_bot

    await bot.deliver_refreshed_batch_results(batch_id)

    # Summary message delivered
    assert mock_bot.send_message.called
    msg_args = mock_bot.send_message.call_args[1]
    assert msg_args["chat_id"] == user_id
    assert "Token Refresh Completed" in msg_args["text"]
    assert "saved directly inside bot database" in msg_args["text"]

    # Strict: zero document exports to chat
    assert mock_bot.send_document.call_count == 0


@pytest.mark.asyncio
async def test_queue_manager_completion_hook_trigger():
    """Validates that QueueManager triggers the registered completion hook when a batch finishes."""
    await BotStorage.init_db()

    batch_id = f"test_qm_hook_trigger_{uuid.uuid4().hex[:8]}"
    user_id = 555666777

    account = ParsedAccount(
        stable_identifier="+919033807401",
        normalized_phone="+919033807401",
        display_phone="+91 90338 07401",
        user_id="1",
        raw_data={"mobile": "9033807401", "xo": "old_xo", "ox": "old_ox"},
        source_file="test.json",
        record_index=1,
        has_auth_token=True,
        has_refresh_token=True,
        is_valid=True
    )

    await BotStorage.create_batch(batch_id, user_id, [account])

    hook_called = False
    hook_batch_id = None

    async def mock_completion_hook(b_id, b_data):
        nonlocal hook_called, hook_batch_id
        hook_called = True
        hook_batch_id = b_id

    qm = QueueManager(engine=MockRefreshEngine())
    qm.set_completion_hook(mock_completion_hook)

    task = await qm.enqueue_batch(batch_id)
    await task

    assert hook_called is True
    assert hook_batch_id == batch_id
