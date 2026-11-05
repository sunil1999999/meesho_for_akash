"""
File Retention and Secure Cleanup Module for Account Token Refresh Bot.
Deletes temporary export and staging files older than configured retention period.
"""

import os
import time
from pathlib import Path
from config import BotConfig


def secure_delete_file(file_path: Path):
    """Securely unlinks a file, attempting overwrite if sensitive."""
    try:
        if file_path.exists() and file_path.is_file():
            # Quick single-pass zero-overwrite
            size = file_path.stat().st_size
            if size > 0 and size < 50 * 1024 * 1024:  # under 50MB
                with open(file_path, "wb") as f:
                    f.write(b"\x00" * size)
            file_path.unlink(missing_ok=True)
    except Exception:
        # Fallback normal unlink
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass


def clean_expired_temporary_files(max_age_hours: int = BotConfig.TEMP_FILE_RETENTION_HOURS) -> int:
    """
    Scans exports/ and scratch/ directories and removes files older than max_age_hours.
    Returns number of files deleted.
    """
    target_dirs = [BotConfig.EXPORTS_DIR, BotConfig.SCRATCH_DIR]
    now = time.time()
    max_age_seconds = max_age_hours * 3600
    deleted_count = 0

    for d in target_dirs:
        if not d.exists():
            continue
        for p in d.glob("*"):
            if p.is_file():
                try:
                    mtime = p.stat().st_mtime
                    if now - mtime > max_age_seconds:
                        secure_delete_file(p)
                        deleted_count += 1
                except Exception:
                    pass

    return deleted_count
