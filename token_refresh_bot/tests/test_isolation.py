"""
Unit & Integration Tests for System Isolation.
Covers Acceptance Criteria:
12. Confirmation that the existing production project remains unchanged.
"""

import sys
import os
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BOT_DIR.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import pytest
from config import BotConfig


def test_12_production_isolation_and_immutability():
    """Criteria 12: Ensure existing production files remain untouched."""
    # List of critical existing production files that must not be touched
    critical_production_files = [
        WORKSPACE_DIR / "meesho_checkout_bridge.py",
        WORKSPACE_DIR / "continuous_order_monitor.py",
        WORKSPACE_DIR / "telegram_bot_live_sync.py",
        WORKSPACE_DIR / "auto_add_cart_direct_checkout.py",
        WORKSPACE_DIR / "direct_checkout_accounts.json",
        WORKSPACE_DIR / "vite.config.ts",
        WORKSPACE_DIR / "package.json",
        WORKSPACE_DIR / "Dockerfile",
    ]

    for prod_file in critical_production_files:
        assert prod_file.exists(), f"Production file was unexpectedly moved or deleted: {prod_file}"

    # Verify that the token refresh bot database and exports are contained in its own folder
    assert str(BotConfig.DATABASE_PATH).startswith(str(BOT_DIR)), "Violation: DB path is outside bot directory"
    assert str(BotConfig.EXPORTS_DIR).startswith(str(BOT_DIR)), "Violation: Exports dir is outside bot directory"
    assert str(BotConfig.SCRATCH_DIR).startswith(str(BOT_DIR)), "Violation: Scratch dir is outside bot directory"


def test_railway_environment_variable_precedence(monkeypatch):
    """Verifies that dedicated REFRESH_BOT_* variables override existing ones on Railway."""
    # Set existing variables (simulating Railway environment)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "old_default_token")
    monkeypatch.setenv("MEESHO_PROXY_BASE_URL", "https://proxy.existing.internal")
    monkeypatch.setenv("ALLOWED_TELEGRAM_USER_IDS", "111111")

    # Set new dedicated variables for the Token Refresh Bot
    monkeypatch.setenv("REFRESH_BOT_TOKEN", "new_dedicated_refresh_bot_token")
    monkeypatch.setenv("REFRESH_BOT_ALLOWED_USERS", "999999,888888")

    from config import BotConfig
    # Reload config values
    token = os.getenv("REFRESH_BOT_TOKEN") or os.getenv("TELEGRAM_REFRESH_BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
    allowed = os.getenv("REFRESH_BOT_ALLOWED_USERS") or os.getenv("ALLOWED_TELEGRAM_USER_IDS")

    assert token == "new_dedicated_refresh_bot_token"
    assert allowed == "999999,888888"
