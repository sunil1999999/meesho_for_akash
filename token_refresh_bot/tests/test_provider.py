"""
Unit & Integration Tests for Token Refresh Engine.
Covers Acceptance Criteria:
8. Expired sessions and reauthentication-required accounts.
9. Rate limits, network failures, and partial batch failures.
Data Integrity: Verification that non-auth fields are preserved and tokens are not fabricated.
"""

import sys
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import pytest
import asyncio
from provider import (
    MockRefreshEngine,
    OutcomeStatus,
    TokenInspector
)


@pytest.mark.asyncio
async def test_8_expired_sessions_and_reauthentication_required():
    """Criteria 8: Expired sessions and reauthentication-required accounts."""
    engine = MockRefreshEngine()

    # 8A: Account with expired refresh token
    expired_account = {
        "mobile": "9033807401",
        "user_id": 101,
        "xo": "sample_old_xo",
        "ox": "ox_expired_token_test",
        "identity": {"device": "Poco"}
    }
    res_expired = await engine.refresh_account(expired_account)
    assert res_expired.status == OutcomeStatus.EXPIRED_SESSION
    assert "expired" in res_expired.error_message.lower()
    assert res_expired.can_retry is False
    assert res_expired.refreshed_data is None  # Never fabricate token on expired!

    # 8B: Account requiring OTP or password re-login
    reauth_account = {
        "mobile": "9820192831",
        "user_id": 102,
        "xo": "sample_xo",
        "ox": "ox_reauth_otp_required",
        "identity": {"device": "Realme"}
    }
    res_reauth = await engine.refresh_account(reauth_account)
    assert res_reauth.status == OutcomeStatus.REQUIRES_REAUTH
    assert "re-verification" in res_reauth.error_message.lower() or "otp" in res_reauth.error_message.lower()
    assert res_reauth.can_retry is False


@pytest.mark.asyncio
async def test_9_rate_limits_and_network_failures_with_retries():
    """Criteria 9: Rate limits, network failures, and retry handling."""
    engine = MockRefreshEngine()

    # 9A: Rate limiting (HTTP 429) simulation
    rate_limited_account = {
        "mobile": "9173573074_429",
        "user_id": 103,
        "xo": "sample_xo",
        "ox": "ox_rate_limit_token"
    }
    res1 = await engine.refresh_account(rate_limited_account)
    assert res1.status == OutcomeStatus.RATE_LIMITED
    assert res1.can_retry is True
    assert res1.retry_after is not None

    # After backoff/retry, mock succeeds
    res2 = await engine.refresh_account(rate_limited_account)
    assert res2.status == OutcomeStatus.SUCCESS
    assert res2.refreshed_data is not None

    # 9B: Transient network failure (502 Bad Gateway) simulation
    network_fail_account = {
        "mobile": "9344453255_502",
        "user_id": 104,
        "xo": "sample_xo",
        "ox": "ox_network_fail_token"
    }
    res_net1 = await engine.refresh_account(network_fail_account)
    assert res_net1.status == OutcomeStatus.NETWORK_ERROR
    assert res_net1.can_retry is True


@pytest.mark.asyncio
async def test_token_preservation_and_non_fabrication():
    """Verifies that non-auth fields are deeply preserved and valid tokens are never replaced with null."""
    engine = MockRefreshEngine()
    account_with_rich_metadata = {
        "mobile": "9033807401",
        "user_id": 605524023,
        "phone": "+919033807401",
        "xo": "original_xo_token_value",
        "ox": "original_ox_refresh_token_value",
        "instance_id": "836f7d89832c63beeca13c1c21cc4280",
        "gaid": "bca882b7-5adb-4fd3-90af-c850b5f1ca35",
        "identity": {
            "make": "Poco",
            "model": "X6 Pro",
            "android": "14",
            "custom_metadata_tag": "KEEP_ME_SAFE_DO_NOT_DELETE",
            "nested_config": {"dpi": 526, "carrier": "Airtel"}
        },
        "custom_user_tag": "VIP_CUSTOMER"
    }

    result = await engine.refresh_account(account_with_rich_metadata)
    assert result.status == OutcomeStatus.SUCCESS
    refreshed = result.refreshed_data
    assert refreshed is not None

    # Token renewed
    assert refreshed["xo"] != "original_xo_token_value"
    inspection = TokenInspector.inspect_composite_xo(refreshed["xo"])
    assert inspection["is_valid"] is True
    assert refreshed["xo_exp"] > 0
    assert "last_refreshed_at" in refreshed

    # ALL non-auth fields are preserved!
    assert refreshed["custom_user_tag"] == "VIP_CUSTOMER"
    assert refreshed["instance_id"] == "836f7d89832c63beeca13c1c21cc4280"
    assert refreshed["gaid"] == "bca882b7-5adb-4fd3-90af-c850b5f1ca35"
    assert refreshed["identity"]["make"] == "Poco"
    assert refreshed["identity"]["custom_metadata_tag"] == "KEEP_ME_SAFE_DO_NOT_DELETE"
    assert refreshed["identity"]["nested_config"]["carrier"] == "Airtel"


def test_token_inspector_claims():
    """Verifies token claims inspection and expiration detection."""
    # Test inspecting composite token
    inspection = TokenInspector.inspect_composite_xo("dummy.non_composite")
    assert inspection["is_valid"] is False

    # Test opaque token
    opaque = TokenInspector.inspect_composite_xo("ox_opaque_refresh_token_string_123456789")
    assert opaque["type"] == "opaque"
    assert opaque["is_valid"] is True
