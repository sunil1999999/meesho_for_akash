"""
Configuration loader for Independent Account Token Refresh Bot.
Supports:
- Dedicated bot variables for Railway deployment (REFRESH_BOT_TOKEN, REFRESH_BOT_ALLOWED_USERS, etc.)
- Automatic fallback to existing project variables (TELEGRAM_API_ID, TELEGRAM_STRING_SESSION, MEESHO_PROXY_BASE_URL, etc.)
- Multi-tier .env loading (local bot .env -> root project .env -> environment)
"""

import os
from pathlib import Path
from typing import List, Set
from dotenv import load_dotenv

# Base directory for the bot
BOT_DIR = Path(__file__).resolve().parent
ROOT_DIR = BOT_DIR.parent

# Tier 1: Load from local bot .env if exists
local_env = BOT_DIR / ".env"
if local_env.exists():
    load_dotenv(dotenv_path=local_env, override=False)

# Tier 2: Load from root project .env if exists (for Railway shared variables)
root_env = ROOT_DIR / ".env"
if root_env.exists():
    load_dotenv(dotenv_path=root_env, override=False)

# Tier 3: Fallback to example if neither exists
if not local_env.exists() and not root_env.exists():
    load_dotenv(dotenv_path=BOT_DIR / ".env.example", override=False)


def _parse_id_list(val: str | None) -> Set[int]:
    """Parses comma-separated string into a set of integer Telegram user IDs."""
    if not val:
        return set()
    ids = set()
    for item in val.split(","):
        cleaned = item.strip()
        if cleaned.isdigit():
            ids.add(int(cleaned))
    return ids


class BotConfig:
    """Strongly typed application configuration."""
    
    # 1. Dedicated Bot Credentials
    TELEGRAM_BOT_TOKEN: str = (
        os.getenv("REFRESH_BOT_TOKEN")
        or os.getenv("TELEGRAM_REFRESH_BOT_TOKEN")
        or os.getenv("TELEGRAM_BOT_TOKEN")
        or "8406988809:AAHARIqcPx3VMlY-ZRFYcOnffKA-5nJ8XVM"
    ).strip()

    # Public bot mode: any user can refresh accounts; admin controls reserved for ADMIN_USER_IDS
    PUBLIC_BOT: bool = os.getenv("PUBLIC_BOT", "true").lower() in ("true", "1", "yes")

    ALLOWED_USER_IDS: Set[int] = _parse_id_list(
        os.getenv("REFRESH_BOT_ALLOWED_USERS")
        or os.getenv("ALLOWED_TELEGRAM_USER_IDS")
    )

    ADMIN_USER_IDS: Set[int] = _parse_id_list(
        os.getenv("ADMIN_USER_IDS")
        or os.getenv("REFRESH_BOT_ADMIN_USERS")
        or "769770980"
    )
    
    # 2. Data Encryption (Dedicated key first, fallback to existing SESSION_SECRET)
    ENCRYPTION_KEY: str = (
        os.getenv("REFRESH_BOT_ENCRYPTION_KEY")
        or os.getenv("ENCRYPTION_KEY")
        or os.getenv("SESSION_SECRET", "")
    ).strip()
    
    # 3. Provider Settings & Existing Project Shared Variables
    MEESHO_PROXY_BASE_URL: str = (
        os.getenv("REFRESH_BOT_PROXY_BASE")
        or os.getenv("MEESHO_PROXY_BASE_URL")
        or "https://meeshoshop.94.136.188.137.nip.io"
    ).rstrip("/")

    PROVIDER_REFRESH_URL: str = (
        os.getenv("REFRESH_BOT_PROVIDER_URL")
        or os.getenv("PROVIDER_REFRESH_URL")
        or f"{MEESHO_PROXY_BASE_URL}/api/accounts/refresh"
    ).strip()

    PROVIDER_VERIFY_URL: str = (
        os.getenv("REFRESH_BOT_VERIFY_URL")
        or os.getenv("PROVIDER_VERIFY_URL")
        or f"{MEESHO_PROXY_BASE_URL}/api/cart"
    ).strip()

    PROVIDER_TIMEOUT_SECONDS: float = float(os.getenv("PROVIDER_TIMEOUT_SECONDS", "20.0"))
    
    # 4. Existed Project Telegram MTProto Credentials (Shared for WebApp InitData)
    TELEGRAM_API_ID: str = (os.getenv("TELEGRAM_API_ID") or "").strip()
    TELEGRAM_API_HASH: str = (os.getenv("TELEGRAM_API_HASH") or "").strip()
    TELEGRAM_STRING_SESSION: str = (os.getenv("TELEGRAM_STRING_SESSION") or "").strip()
    TELEGRAM_BOT_USERNAME: str = (os.getenv("TELEGRAM_BOT_USERNAME") or "primes_meesho_bot").lstrip("@")

    # 5. Processing Queue Controls (Dedicated variable first, fallback to generic)
    MAX_CONCURRENCY: int = max(
        1, min(10, int(os.getenv("REFRESH_BOT_CONCURRENCY") or os.getenv("MAX_CONCURRENCY", "3")))
    )
    RATE_LIMIT_DELAY: float = max(
        0.0, float(os.getenv("REFRESH_BOT_RATE_LIMIT") or os.getenv("RATE_LIMIT_DELAY", "0.5"))
    )
    MAX_RETRIES: int = max(
        0, int(os.getenv("REFRESH_BOT_MAX_RETRIES") or os.getenv("MAX_RETRIES", "3"))
    )
    BACKOFF_FACTOR: float = max(
        1.0, float(os.getenv("BACKOFF_FACTOR", "1.5"))
    )
    
    # 6. Storage Paths
    DATABASE_PATH: Path = BOT_DIR / os.getenv("DATABASE_PATH", "data/bot_storage.db")
    EXPORTS_DIR: Path = BOT_DIR / os.getenv("EXPORTS_DIR", "exports")
    SCRATCH_DIR: Path = BOT_DIR / os.getenv("SCRATCH_DIR", "scratch")
    TEMP_FILE_RETENTION_HOURS: int = int(os.getenv("TEMP_FILE_RETENTION_HOURS", "24"))

    @classmethod
    def ensure_directories(cls):
        """Ensures all necessary local storage directories exist."""
        cls.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
        cls.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        cls.SCRATCH_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def is_user_allowed(cls, user_id: int) -> bool:
        """Checks if a Telegram user is authorized. In public bot mode, all users can refresh accounts."""
        if cls.PUBLIC_BOT:
            return True
        if not cls.ALLOWED_USER_IDS:
            return True
        return user_id in cls.ALLOWED_USER_IDS

    @classmethod
    def is_user_admin(cls, user_id: int) -> bool:
        """Checks if user has admin privileges. Strictly restricted to configured ADMIN_USER_IDS."""
        return user_id in cls.ADMIN_USER_IDS


# Ensure storage paths exist upon config initialization
BotConfig.ensure_directories()
