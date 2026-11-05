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
from typing import Any, Dict
from cryptography.fernet import Fernet
from config import BotConfig


class SecurityManager:
    """Manages encryption at rest and credential sanitization."""

    _cipher: Fernet | None = None

    @classmethod
    def _get_cipher(cls) -> Fernet:
        if cls._cipher is None:
            key = BotConfig.ENCRYPTION_KEY
            if key:
                try:
                    cls._cipher = Fernet(key.encode("utf-8"))
                except Exception:
                    # In case of invalid key format, generate a fallback key
                    key = Fernet.generate_key().decode("utf-8")
                    cls._cipher = Fernet(key.encode("utf-8"))
            else:
                # Ephemeral key generated in memory
                key = Fernet.generate_key().decode("utf-8")
                cls._cipher = Fernet(key.encode("utf-8"))
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
        try:
            cipher = cls._get_cipher()
            decrypted_bytes = cipher.decrypt(encrypted_str.encode("utf-8"))
            return json.loads(decrypted_bytes.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Failed to decrypt stored data: {str(e)}")

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
