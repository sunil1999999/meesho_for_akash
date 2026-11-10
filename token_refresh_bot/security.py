"""
Security & Data Protection Module for Account Token Refresh Bot.
Provides:
- AES/Fernet encryption for sensitive credentials at rest.
- Token and phone number masking to prevent credential leaks in logs/messages.
- Safe data sanitization.
"""

import json
import re
import copy
import hashlib
import base64
import logging
from typing import Any, Dict
from cryptography.fernet import Fernet
from config import BotConfig

logger = logging.getLogger("SecurityManager")


class SecurityManager:
    """Manages encryption at rest and credential sanitization."""

    _cipher: Fernet | None = None

    @classmethod
    def _get_cipher(cls) -> Fernet:
        if cls._cipher is None:
            raw_key = BotConfig.ENCRYPTION_KEY
            if raw_key:
                try:
                    cls._cipher = Fernet(raw_key.encode("utf-8"))
                except Exception:
                    # In case of non-Fernet key string (e.g. SESSION_SECRET hex), derive a deterministic 32-byte key via SHA-256
                    derived = base64.urlsafe_b64encode(hashlib.sha256(raw_key.encode("utf-8")).digest())
                    cls._cipher = Fernet(derived)
            else:
                # Check for persisted key file in database directory for consistency across restarts
                key_file = BotConfig.DATABASE_PATH.parent / ".bot_encryption.key"
                if key_file.exists():
                    try:
                        k_str = key_file.read_text("utf-8").strip()
                        cls._cipher = Fernet(k_str.encode("utf-8"))
                    except Exception:
                        pass
                if cls._cipher is None:
                    new_key = Fernet.generate_key().decode("utf-8")
                    try:
                        key_file.write_text(new_key, "utf-8")
                    except Exception:
                        pass
                    cls._cipher = Fernet(new_key.encode("utf-8"))
        return cls._cipher

    @classmethod
    def encrypt_json(cls, data: Any) -> str:
        """Serializes and encrypts Python data structure into a secure string."""
        serialized = json.dumps(data, ensure_ascii=False)
        cipher = cls._get_cipher()
        encrypted_bytes = cipher.encrypt(serialized.encode("utf-8"))
        return encrypted_bytes.decode("utf-8")

    @classmethod
    def decrypt_json(cls, encrypted_str: str) -> Any:
        """Decrypts and parses an encrypted string back into original Python structure."""
        if not encrypted_str:
            return None
        # First check if unencrypted JSON string was passed
        if isinstance(encrypted_str, str) and (encrypted_str.startswith("{") or encrypted_str.startswith("[")):
            try:
                return json.loads(encrypted_str)
            except Exception:
                pass

        cipher = cls._get_cipher()
        try:
            decrypted_bytes = cipher.decrypt(encrypted_str.encode("utf-8"))
            return json.loads(decrypted_bytes.decode("utf-8"))
        except Exception:
            # Fallback check if it can be decoded as plain json
            try:
                return json.loads(encrypted_str)
            except Exception:
                return None

    @staticmethod
    def mask_token(token: str | None) -> str:
        """Safely masks a token string so it can be logged or referenced without credential leak."""
        if not token:
            return "<none>"
        clean = str(token).strip()
        length = len(clean)
        if length <= 8:
            return "***"
        if length <= 20:
            return f"{clean[:3]}...{clean[-3:]}"
        return f"{clean[:4]}...{clean[-4:]} ({length} chars)"

    @staticmethod
    def mask_phone(phone: str | None) -> str:
        """Formats phone number for safe display (e.g. +91 90338 ***01)."""
        if not phone:
            return "<no-phone>"
        digits = re.sub(r"\D", "", str(phone))
        if len(digits) >= 10:
            last10 = digits[-10:]
            return f"+91 {last10[:5]} ***{last10[-2:]}"
        return f"{digits[:2]}***{digits[-2:]}" if len(digits) > 4 else "***"

    @classmethod
    def sanitize_for_log(cls, data: Any) -> Any:
        """Deep copy and replace sensitive tokens with masked placeholders."""
        if not isinstance(data, (dict, list)):
            return data

        sensitive_keys = {
            "xo", "ox", "jwt", "anon_xo", "fcm_token", "token", "password",
            "session", "auth_token", "refresh_token", "access_token"
        }

        def _clean_obj(item: Any) -> Any:
            if isinstance(item, dict):
                cleaned = {}
                for k, v in item.items():
                    k_lower = str(k).lower()
                    if any(s in k_lower for s in sensitive_keys):
                        cleaned[k] = cls.mask_token(str(v)) if v else None
                    else:
                        cleaned[k] = _clean_obj(v)
                return cleaned
            elif isinstance(item, list):
                return [_clean_obj(x) for x in item]
            return item

        return _clean_obj(copy.deepcopy(data))
