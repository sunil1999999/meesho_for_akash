import sys
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import pytest
from provider import LiveHttpRefreshEngine, OutcomeStatus

@pytest.mark.asyncio
async def test_live_engine_fallback_and_validation():
    engine = LiveHttpRefreshEngine()

    # 1. Missing tokens test
    invalid_acct = {"mobile": "9999999999"}
    res = await engine.refresh_account(invalid_acct)
    assert res.status == OutcomeStatus.UNSUPPORTED_FORMAT

    # 2. Valid test account in mock/offline mode
    valid_acct = {
        "mobile": "9760665728",
        "user_id": 602519885,
        "xo": "old_sample_xo",
        "ox": "old_sample_ox",
        "custom_note": "unit_test_preserved"
    }
    # In test environment (or without live creds), it handles the refresh cleanly
    res_valid = await engine.refresh_account(valid_acct)
    assert res_valid.status == OutcomeStatus.SUCCESS
    assert res_valid.refreshed_data is not None
    assert res_valid.refreshed_data["custom_note"] == "unit_test_preserved"
    assert res_valid.refreshed_data["refresh_status"] == "ACTIVE"
