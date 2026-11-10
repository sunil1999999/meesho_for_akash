"""
Isolated SQLite Storage Adapter for Account Token Refresh Bot.
Strictly decoupled from existing project databases.
Uses aiosqlite with WAL mode and encrypted data-at-rest.
"""

import aiosqlite
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from config import BotConfig
from security import SecurityManager
from parser import ParsedAccount


class BotStorage:
    """Async database operations for managing batches and account refresh outcomes."""

    _db_path = str(BotConfig.DATABASE_PATH)

    @classmethod
    async def init_db(cls):
        """Initializes tables and indices."""
        BotConfig.ensure_directories()
        async with aiosqlite.connect(cls._db_path) as db:
            await db.execute("PRAGMA journal_mode=WAL;")
            await db.execute("PRAGMA synchronous=NORMAL;")

            # Batches table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS batches (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    total_count INTEGER DEFAULT 0,
                    success_count INTEGER DEFAULT 0,
                    failed_count INTEGER DEFAULT 0,
                    expired_count INTEGER DEFAULT 0,
                    reauth_count INTEGER DEFAULT 0,
                    duplicate_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)

            # Accounts table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY,
                    batch_id TEXT NOT NULL,
                    account_identifier TEXT NOT NULL,
                    display_phone TEXT NOT NULL,
                    source_file TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error_message TEXT,
                    is_duplicate INTEGER DEFAULT 0,
                    encrypted_original_json TEXT NOT NULL,
                    encrypted_refreshed_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(batch_id) REFERENCES batches(id)
                );
            """)

            # Indices
            await db.execute("CREATE INDEX IF NOT EXISTS idx_accounts_batch ON accounts(batch_id);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_accounts_identifier ON accounts(account_identifier);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_batches_user ON batches(user_id);")

            await db.commit()

    @classmethod
    async def create_batch(cls, batch_id: str, user_id: int, accounts: List[ParsedAccount]) -> str:
        """Persists a new batch and its initial accounts."""
        now = datetime.now(timezone.utc).isoformat()
        total = len(accounts)
        dups = sum(1 for a in accounts if a.is_duplicate)

        async with aiosqlite.connect(cls._db_path) as db:
            await db.execute("""
                INSERT INTO batches (
                    id, user_id, status, total_count, success_count, failed_count,
                    expired_count, reauth_count, duplicate_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (batch_id, user_id, "CREATED", total, 0, 0, 0, 0, dups, now, now))

            for idx, acc in enumerate(accounts):
                acc_id = f"{batch_id}_{idx + 1}"
                enc_orig = SecurityManager.encrypt_json(acc.raw_data)
                initial_status = "DUPLICATE_SKIPPED" if acc.is_duplicate else ("INVALID_FORMAT" if not acc.is_valid else "PENDING")
                err = acc.duplicate_reason if acc.is_duplicate else acc.validation_error

                await db.execute("""
                    INSERT INTO accounts (
                        id, batch_id, account_identifier, display_phone, source_file,
                        status, error_message, is_duplicate, encrypted_original_json,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    acc_id, batch_id, acc.stable_identifier, acc.display_phone,
                    acc.source_file, initial_status, err,
                    1 if acc.is_duplicate else 0, enc_orig, now, now
                ))

            await db.commit()
        return batch_id

    @classmethod
    async def append_accounts_to_batch(cls, batch_id: str, new_accounts: List[ParsedAccount]):
        """Adds more accounts to an existing staged batch (e.g. mixed batch imports)."""
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(cls._db_path) as db:
            # Get current count
            async with db.execute("SELECT COUNT(*) FROM accounts WHERE batch_id = ?", (batch_id,)) as cursor:
                row = await cursor.fetchone()
                existing_count = row[0] if row else 0

            dups_to_add = 0
            for idx, acc in enumerate(new_accounts):
                acc_id = f"{batch_id}_{existing_count + idx + 1}"
                enc_orig = SecurityManager.encrypt_json(acc.raw_data)
                initial_status = "DUPLICATE_SKIPPED" if acc.is_duplicate else ("INVALID_FORMAT" if not acc.is_valid else "PENDING")
                err = acc.duplicate_reason if acc.is_duplicate else acc.validation_error
                if acc.is_duplicate:
                    dups_to_add += 1

                await db.execute("""
                    INSERT INTO accounts (
                        id, batch_id, account_identifier, display_phone, source_file,
                        status, error_message, is_duplicate, encrypted_original_json,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    acc_id, batch_id, acc.stable_identifier, acc.display_phone,
                    acc.source_file, initial_status, err,
                    1 if acc.is_duplicate else 0, enc_orig, now, now
                ))

            # Update batch stats
            await db.execute("""
                UPDATE batches
                SET total_count = total_count + ?,
                    duplicate_count = duplicate_count + ?,
                    updated_at = ?
                WHERE id = ?
            """, (len(new_accounts), dups_to_add, now, batch_id))

            await db.commit()

    @classmethod
    async def get_batch(cls, batch_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves summary dict for a specific batch."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None

    @classmethod
    async def get_latest_batch_for_user(cls, user_id: int) -> Optional[Dict[str, Any]]:
        """Retrieves the most recent batch created by a specific user."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM batches WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
                (user_id,)
            ) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None

    @classmethod
    async def get_batch_accounts(cls, batch_id: str) -> List[Dict[str, Any]]:
        """Retrieves all account rows for a batch."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM accounts WHERE batch_id = ? ORDER BY rowid ASC",
                (batch_id,)
            ) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    @classmethod
    async def update_batch_status(cls, batch_id: str, status: str):
        """Updates the status of a batch."""
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(cls._db_path) as db:
            await db.execute("UPDATE batches SET status = ?, updated_at = ? WHERE id = ?", (status, now, batch_id))
            await db.commit()

    @classmethod
    async def update_account_result(
        cls,
        account_id: str,
        status: str,
        refreshed_data: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None
    ):
        """Records the outcome of refreshing an account and increments batch metrics."""
        now = datetime.now(timezone.utc).isoformat()
        enc_refreshed = SecurityManager.encrypt_json(refreshed_data) if refreshed_data else None

        async with aiosqlite.connect(cls._db_path) as db:
            # 1. Update account record
            await db.execute("""
                UPDATE accounts
                SET status = ?,
                    error_message = ?,
                    encrypted_refreshed_json = ?,
                    updated_at = ?
                WHERE id = ?
            """, (status, error_message, enc_refreshed, now, account_id))

            # 2. Update parent batch counters
            success_inc = 1 if status == "SUCCESS" else 0
            failed_inc = 1 if status in ("FAILED", "INVALID_TOKEN", "NETWORK_ERROR", "UNSUPPORTED_FORMAT", "INVALID_FORMAT") else 0
            expired_inc = 1 if status == "EXPIRED" else 0
            reauth_inc = 1 if status == "REQUIRES_REAUTH" else 0

            await db.execute("""
                UPDATE batches
                SET success_count = success_count + ?,
                    failed_count = failed_count + ?,
                    expired_count = expired_count + ?,
                    reauth_count = reauth_count + ?,
                    updated_at = ?
                WHERE id = (SELECT batch_id FROM accounts WHERE id = ?)
            """, (success_inc, failed_inc, expired_inc, reauth_inc, now, account_id))

            await db.commit()

    @classmethod
    async def get_refreshed_accounts_json(cls, batch_id: str) -> List[Dict[str, Any]]:
        """Decrypts and returns all successfully refreshed accounts for export."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT encrypted_refreshed_json
                FROM accounts
                WHERE batch_id = ? AND status = 'SUCCESS' AND encrypted_refreshed_json IS NOT NULL
                ORDER BY rowid ASC
            """, (batch_id,)) as cursor:
                rows = await cursor.fetchall()
                results = []
                for r in rows:
                    enc = r["encrypted_refreshed_json"]
                    dec = SecurityManager.decrypt_json(enc)
                    if dec:
                        results.append(dec)
                return results

    @classmethod
    async def get_single_refreshed_account(cls, account_id: str) -> Optional[Dict[str, Any]]:
        """Decrypts and returns a single successfully refreshed account."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT encrypted_refreshed_json FROM accounts WHERE id = ? AND status = 'SUCCESS'",
                (account_id,)
            ) as cursor:
                row = await cursor.fetchone()
                if row and row["encrypted_refreshed_json"]:
                    return SecurityManager.decrypt_json(row["encrypted_refreshed_json"])
                return None

    @classmethod
    async def get_failure_report(cls, batch_id: str) -> List[Dict[str, Any]]:
        """Generates a credential-safe failure report (no tokens included)."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT id, account_identifier, display_phone, source_file, status, error_message, updated_at
                FROM accounts
                WHERE batch_id = ? AND status NOT IN ('SUCCESS')
                ORDER BY rowid ASC
            """, (batch_id,)) as cursor:
                rows = await cursor.fetchall()
                return [
                    {
                        "account_id": r["id"],
                        "identifier": r["account_identifier"],
                        "display_phone": SecurityManager.mask_phone(r["display_phone"]),
                        "source_file": r["source_file"],
                        "status": r["status"],
                        "reason": r["error_message"] or "Unknown error",
                        "recorded_at": r["updated_at"]
                    }
                    for r in rows
                ]

    @classmethod
    async def get_interrupted_batches(cls) -> List[Dict[str, Any]]:
        """Finds batches that were in progress when bot terminated, for restart recovery."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT * FROM batches
                WHERE status IN ('QUEUED', 'PROCESSING', 'PAUSED')
                ORDER BY updated_at ASC
            """) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]

    @classmethod
    async def get_all_stored_accounts_for_refresh(cls) -> List[Dict[str, Any]]:
        """
        Retrieves all unique stored accounts in the bot database eligible for token refresh.
        Deduplicates by account_identifier and selects the latest session record.
        Never leaks raw tokens.
        """
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            query = """
                SELECT a.*
                FROM accounts a
                INNER JOIN (
                    SELECT account_identifier, MAX(rowid) as max_rowid
                    FROM accounts
                    GROUP BY account_identifier
                ) latest ON a.rowid = latest.max_rowid
                ORDER BY a.rowid ASC;
            """
            async with db.execute(query) as cursor:
                rows = await cursor.fetchall()
                candidates = []
                for r in rows:
                    identifier = r["account_identifier"]
                    decrypted_json = None
                    if r["encrypted_refreshed_json"]:
                        decrypted_json = SecurityManager.decrypt_json(r["encrypted_refreshed_json"])
                    if not decrypted_json and r["encrypted_original_json"]:
                        decrypted_json = SecurityManager.decrypt_json(r["encrypted_original_json"])

                    # Fallback check if export file exists for this mobile number
                    if not decrypted_json:
                        clean_id = re.sub(r"^\+?91|^0|\D", "", str(identifier))
                        export_candidates = [
                            BotConfig.SCRATCH_DIR / f"account_{clean_id}_refreshed.json",
                            BotConfig.EXPORTS_DIR / f"account_{clean_id}.json",
                        ]
                        for exp_file in export_candidates:
                            if exp_file.exists():
                                try:
                                    with open(exp_file, "r", encoding="utf-8") as f:
                                        data = json.load(f)
                                        if isinstance(data, dict) and (data.get("xo") or data.get("ox")):
                                            decrypted_json = data
                                            break
                                except Exception:
                                    pass

                    if decrypted_json and isinstance(decrypted_json, dict):
                        candidates.append({
                            "record_id": r["id"],
                            "batch_id": r["batch_id"],
                            "account_identifier": identifier,
                            "display_phone": r["display_phone"],
                            "source_file": r["source_file"],
                            "status": r["status"],
                            "raw_session": decrypted_json,
                            "updated_at": r["updated_at"]
                        })
                return candidates

    @classmethod
    async def update_account_session_in_place(
        cls,
        account_identifier: str,
        record_id: str,
        status: str,
        refreshed_data: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None
    ) -> bool:
        """
        Directly updates the stored account session in place inside the database.
        - If SUCCESS, safely encrypts refreshed JSON and updates the record.
        - If NOT SUCCESS, preserves original session data without clearing it.
        - Never overwrites valid data with empty/invalid responses.
        - Immediately commits the transaction.
        """
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(cls._db_path) as db:
            if status == "SUCCESS" and refreshed_data and isinstance(refreshed_data, dict):
                xo = refreshed_data.get("xo")
                ox = refreshed_data.get("ox")
                if not (xo and str(xo).strip()) and not (ox and str(ox).strip()):
                    await db.execute("""
                        UPDATE accounts
                        SET status = 'FAILED',
                            error_message = 'Refreshed payload contained empty tokens',
                            updated_at = ?
                        WHERE id = ? OR account_identifier = ?
                    """, (now, record_id, account_identifier))
                    await db.commit()
                    return False

                enc_refreshed = SecurityManager.encrypt_json(refreshed_data)
                await db.execute("""
                    UPDATE accounts
                    SET encrypted_refreshed_json = ?,
                        status = 'SUCCESS',
                        error_message = NULL,
                        updated_at = ?
                    WHERE id = ? OR account_identifier = ?
                """, (enc_refreshed, now, record_id, account_identifier))
                await db.commit()
                return True
            else:
                await db.execute("""
                    UPDATE accounts
                    SET status = ?,
                        error_message = ?,
                        updated_at = ?
                    WHERE id = ? OR account_identifier = ?
                """, (status, error_message, now, record_id, account_identifier))
                await db.commit()
                return False

    @classmethod
    async def get_database_account_stats(cls) -> Dict[str, Any]:
        """Returns lifetime distinct account statistics in bot database."""
        async with aiosqlite.connect(cls._db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT 
                    COUNT(DISTINCT account_identifier) as distinct_accounts,
                    COUNT(*) as total_records,
                    SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expired_count,
                    SUM(CASE WHEN status NOT IN ('SUCCESS', 'EXPIRED') THEN 1 ELSE 0 END) as other_count
                FROM accounts;
            """) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else {
                    "distinct_accounts": 0, "total_records": 0,
                    "success_count": 0, "expired_count": 0, "other_count": 0
                }
