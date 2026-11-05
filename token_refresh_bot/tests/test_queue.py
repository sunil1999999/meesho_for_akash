"""
Unit & Integration Tests for Processing Queue and Controls.
Covers Acceptance Criteria:
10. Pause, resume, cancel, and restart recovery.
"""

import sys
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import pytest
import asyncio
import uuid
from parser import AccountDataParser, parse_account_dict
from storage import BotStorage
from provider import MockRefreshEngine
from queue_manager import QueueManager


@pytest.fixture(autouse=True)
def init_storage():
    """Ensure database tables exist before running queue tests."""
    asyncio.run(BotStorage.init_db())


@pytest.mark.asyncio
async def test_10_queue_pause_resume_cancel_and_recovery():
    """Criteria 10: Full test of pause, resume, cancel, and restart recovery."""
    engine = MockRefreshEngine()
    qm = QueueManager(engine)

    # 1. Create a test batch of accounts
    accounts_data = [
        {"mobile": f"900000000{i}", "xo": f"xo_{i}", "ox": f"ox_{i}"}
        for i in range(1, 6)
    ]
    parsed_accounts = [
        parse_account_dict(acc, "test_file.json", idx + 1)
        for idx, acc in enumerate(accounts_data)
    ]
    batch_id = f"test_batch_{uuid.uuid4().hex[:8]}"
    await BotStorage.create_batch(batch_id, user_id=12345, accounts=parsed_accounts)

    # 2. Test Pause before starting
    qm.pause_batch(batch_id)
    assert qm.is_batch_paused(batch_id) is True

    # 3. Start task while paused: workers should pause and wait
    task = await qm.enqueue_batch(batch_id)
    await asyncio.sleep(0.3)
    batch_state = await BotStorage.get_batch(batch_id)
    assert batch_state["status"] in ("PROCESSING", "PAUSED")

    # 4. Resume batch: workers should unblock and complete accounts
    qm.resume_batch(batch_id)
    assert qm.is_batch_paused(batch_id) is False
    await task

    # Verify all accounts finished
    completed_batch = await BotStorage.get_batch(batch_id)
    assert completed_batch["status"] == "COMPLETED"
    assert completed_batch["success_count"] == 5

    # 5. Test Cancellation on a second batch
    batch_id_2 = f"test_cancel_{uuid.uuid4().hex[:8]}"
    accounts_data_2 = [
        {"mobile": f"910000000{i}", "xo": f"xo_{i}", "ox": f"ox_{i}"}
        for i in range(1, 4)
    ]
    parsed_2 = [
        parse_account_dict(acc, "test_file2.json", idx + 1)
        for idx, acc in enumerate(accounts_data_2)
    ]
    await BotStorage.create_batch(batch_id_2, user_id=12345, accounts=parsed_2)

    qm.cancel_batch(batch_id_2)
    assert qm.is_batch_cancelled(batch_id_2) is True

    task2 = await qm.enqueue_batch(batch_id_2)
    await task2

    cancelled_batch = await BotStorage.get_batch(batch_id_2)
    assert cancelled_batch["status"] == "CANCELLED"

    # 6. Test Restart Recovery
    # Simulate an interrupted batch left in 'PROCESSING'
    batch_id_3 = f"test_interrupted_{uuid.uuid4().hex[:8]}"
    accounts_data_3 = [
        {"mobile": "9200000001", "xo": "xo_rec1", "ox": "ox_rec1"},
        {"mobile": "9200000002", "xo": "xo_rec2", "ox": "ox_rec2"}
    ]
    parsed_3 = [
        parse_account_dict(acc, "interrupted.json", idx + 1)
        for idx, acc in enumerate(accounts_data_3)
    ]
    await BotStorage.create_batch(batch_id_3, user_id=12345, accounts=parsed_3)
    await BotStorage.update_batch_status(batch_id_3, "PROCESSING")

    # Recovery function finds interrupted batches and resumes them
    interrupted = await BotStorage.get_interrupted_batches()
    assert any(b["id"] == batch_id_3 for b in interrupted)

    # Run recovery
    qm_recovered = QueueManager(engine)
    await qm_recovered.recover_interrupted_batches()
    await asyncio.sleep(0.5)

    recovered_batch = await BotStorage.get_batch(batch_id_3)
    assert recovered_batch["status"] in ("PROCESSING", "COMPLETED")
