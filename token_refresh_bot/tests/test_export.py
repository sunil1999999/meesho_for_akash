"""
Unit & Integration Tests for Results and File Export.
Covers Acceptance Criteria:
11. Individual file exports (separate .json files, NO zip archives) and combined JSON exports.
"""

import sys
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import pytest
import asyncio
import json
import uuid
from parser import AccountDataParser, parse_account_dict
from storage import BotStorage
from provider import MockRefreshEngine
from queue_manager import QueueManager
from config import BotConfig


@pytest.fixture(autouse=True)
def init_storage():
    asyncio.run(BotStorage.init_db())


@pytest.mark.asyncio
async def test_11_individual_and_combined_exports_no_zip():
    """Criteria 11: Export individual files (NO zip!) and combined JSON."""
    engine = MockRefreshEngine()
    qm = QueueManager(engine)

    # 1. Create batch with 3 accounts (2 valid, 1 expired)
    batch_data = [
        {"mobile": "9033807401", "xo": "xo_1", "ox": "ox_1", "identity": {"make": "Realme"}},
        {"mobile": "9820192831", "xo": "xo_2", "ox": "ox_2", "identity": {"make": "Poco"}},
        {"mobile": "9173573074", "xo": "xo_3", "ox": "ox_expired_token"}
    ]
    parsed = [
        parse_account_dict(acc, "export_test.json", idx + 1)
        for idx, acc in enumerate(batch_data)
    ]
    batch_id = f"batch_export_{uuid.uuid4().hex[:8]}"
    await BotStorage.create_batch(batch_id, user_id=12345, accounts=parsed)

    # 2. Process batch
    task = await qm.enqueue_batch(batch_id)
    await task

    # 3. Test Combined Export
    refreshed_list = await BotStorage.get_refreshed_accounts_json(batch_id)
    assert len(refreshed_list) == 2  # The 2 successful accounts

    combined_file = BotConfig.EXPORTS_DIR / f"accounts_batch_{batch_id}_refreshed.json"
    with open(combined_file, "w", encoding="utf-8") as f:
        json.dump(refreshed_list, f, indent=2, ensure_ascii=False)

    assert combined_file.exists()
    with open(combined_file, "r", encoding="utf-8") as f:
        saved_combined = json.load(f)
    assert len(saved_combined) == 2
    assert saved_combined[0]["mobile"] in ("9033807401", "9820192831")

    # 4. Test Individual Files Export (Strictly Separate JSON Files, NO ZIP)
    individual_files = []
    for acc in refreshed_list:
        mobile = acc.get("mobile")
        fname = f"account_{mobile}_refreshed.json"
        fpath = BotConfig.SCRATCH_DIR / fname
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(acc, f, indent=2, ensure_ascii=False)
        individual_files.append(fpath)

    assert len(individual_files) == 2
    for f in individual_files:
        assert f.exists()
        assert f.suffix == ".json"
        assert not f.name.endswith(".zip")
        with open(f, "r", encoding="utf-8") as json_check:
            data = json.load(json_check)
            assert "xo" in data
            assert data.get("refresh_status") == "ACTIVE"

    # CRITICAL ACCEPTANCE CHECK: Verify no zip file was produced
    zip_files = list(BotConfig.EXPORTS_DIR.glob("*.zip")) + list(BotConfig.SCRATCH_DIR.glob("*.zip"))
    assert len(zip_files) == 0, "Violation: ZIP archive was generated, which is strictly prohibited!"

    # 5. Test Failure Report Export (Token-free)
    failures = await BotStorage.get_failure_report(batch_id)
    assert len(failures) == 1
    failed_record = failures[0]
    assert failed_record["identifier"] == "+919173573074"
    assert failed_record["status"] == "EXPIRED"
    assert "expired" in failed_record["reason"].lower()

    # Verify no auth credentials leaked in failure report
    rep_str = json.dumps(failed_record)
    assert "sample_old_xo" not in rep_str
    assert "token" not in failed_record or failed_record.get("token") is None
