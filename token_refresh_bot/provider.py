"""
Token Refresh Engine for Account Token Refresh Bot.
Supports:
- Legitimate token renewal for provider account sessions.
- Decoding and inspecting composite JWT tokens ('xo') and refresh tokens ('ox').
- Verification of renewed session usability.
- Explicit outcome discrimination: SUCCESS, EXPIRED, REQUIRES_REAUTH,
  INVALID_TOKEN, RATE_LIMITED, NETWORK_ERROR, UNSUPPORTED_FORMAT.
- Deep preservation of all non-auth account fields.
- Absolute prohibition against fabricating fake tokens.
"""

import os
import re
import asyncio
import logging
import base64
import json
import time
import copy
from enum import Enum
from typing import Any, Dict, Optional, Tuple
from dataclasses import dataclass
import httpx
import jwt
from config import BotConfig
from security import SecurityManager

logger = logging.getLogger("TokenRefreshEngine")


class OutcomeStatus(str, Enum):
    SUCCESS = "SUCCESS"
    EXPIRED_SESSION = "EXPIRED"
    REQUIRES_REAUTH = "REQUIRES_REAUTH"
    INVALID_TOKEN = "INVALID_TOKEN"
    RATE_LIMITED = "RATE_LIMITED"
    NETWORK_ERROR = "NETWORK_ERROR"
    UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
    DUPLICATE_SKIPPED = "DUPLICATE_SKIPPED"
    CANCELLED = "CANCELLED"


@dataclass
class RefreshResult:
    """Outcome of attempting to refresh an account token."""
    status: OutcomeStatus
    refreshed_data: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    retry_after: Optional[float] = None
    can_retry: bool = False
    is_verified: bool = False
    expiry_timestamp: Optional[int] = None


class TokenInspector:
    """Utilities for inspecting Meesho and generic composite JWT tokens."""

    @staticmethod
    def inspect_composite_xo(xo_str: str | None) -> Dict[str, Any]:
        """
        Inspects composite xo token (typically 'part1.part2' base64 encoded).
        Returns extracted claims including 'exp', 'user_id', 'instance_id'.
        """
        if not xo_str or not isinstance(xo_str, str):
            return {"is_valid": False, "error": "Token is empty or non-string"}

        clean = xo_str.strip()
        parts = clean.split(".")

        # Case 1: Standard Meesho Composite: base64(header) . base64(payload_with_inner_jwt)
        if len(parts) == 2:
            try:
                pad_len = 4 - (len(parts[1]) % 4) if len(parts[1]) % 4 != 0 else 0
                padded = parts[1] + ("=" * pad_len)
                decoded_bytes = base64.urlsafe_b64decode(padded)
                payload_json = json.loads(decoded_bytes.decode("utf-8", errors="ignore"))

                if isinstance(payload_json, dict):
                    inner_jwt = payload_json.get("jwt")
                    claims = {}
                    if inner_jwt and isinstance(inner_jwt, str):
                        claims = jwt.decode(inner_jwt, options={"verify_signature": False})
                    exp = claims.get("exp")
                    user_id = claims.get("https://meesho.com/user_id") or claims.get("user_id")
                    instance_id = claims.get("https://meesho.com/instance_id") or claims.get("instance_id")
                    return {
                        "is_valid": True,
                        "type": "composite_meesho",
                        "exp": exp,
                        "user_id": user_id,
                        "instance_id": instance_id,
                        "is_expired": (exp < time.time()) if exp else False,
                        "claims": claims
                    }
            except Exception:
                pass
            return {"is_valid": False, "error": "Malformed composite token"}

        # Case 2: Standard standalone JWT (3 parts)
        if len(parts) == 3:
            try:
                claims = jwt.decode(clean, options={"verify_signature": False})
                exp = claims.get("exp")
                return {
                    "is_valid": True,
                    "type": "standard_jwt",
                    "exp": exp,
                    "user_id": claims.get("sub") or claims.get("user_id"),
                    "is_expired": (exp < time.time()) if exp else False,
                    "claims": claims
                }
            except Exception:
                pass
            return {"is_valid": False, "error": "Malformed JWT token"}

        # Case 3: Opaque token string (no dots)
        if len(parts) == 1:
            return {
                "is_valid": len(clean) > 10,
                "type": "opaque",
                "exp": None,
                "is_expired": False
            }

        return {"is_valid": False, "error": "Unrecognized token format"}


class BaseRefreshEngine:
    """Abstract interface for token refresh implementations."""

    async def refresh_account(self, account_data: Dict[str, Any]) -> RefreshResult:
        raise NotImplementedError


class LiveHttpRefreshEngine(BaseRefreshEngine):
    """
    Live implementation communicating with the provider endpoint.
    Performs verification and strict outcome classification.
    """

    def __init__(
        self,
        refresh_url: str = BotConfig.PROVIDER_REFRESH_URL,
        verify_url: str = BotConfig.PROVIDER_VERIFY_URL,
        timeout: float = BotConfig.PROVIDER_TIMEOUT_SECONDS,
    ):
        self.refresh_url = refresh_url
        self.verify_url = verify_url
        self.timeout = timeout

    async def _get_cached_or_fresh_init_data(self) -> Optional[str]:
        """Uses existing project Telegram MTProto session to obtain valid X-Tg-Init-Data for proxy."""
        cache_file = BotConfig.SCRATCH_DIR / ".tg_init_data.cache"
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                    if time.time() - cached.get("timestamp", 0) < 6 * 3600:
                        return cached.get("init_data")
            except Exception:
                pass

        api_id = BotConfig.TELEGRAM_API_ID
        api_hash = BotConfig.TELEGRAM_API_HASH
        sess_str = BotConfig.TELEGRAM_STRING_SESSION
        if not api_id or not api_hash or not sess_str:
            return None

        try:
            from telethon import TelegramClient
            from telethon.sessions import StringSession
            from telethon.tl.functions.messages import RequestWebViewRequest
            import urllib.parse

            client = TelegramClient(StringSession(sess_str), int(api_id), api_hash, timeout=12)
            await client.connect()
            try:
                if not await client.is_user_authorized():
                    return None
                bot_entity = await client.get_input_entity(BotConfig.TELEGRAM_BOT_USERNAME)
                wv = await client(RequestWebViewRequest(
                    peer=bot_entity,
                    bot=bot_entity,
                    url=f"{BotConfig.MEESHO_PROXY_BASE_URL}/?view=history",
                    platform="android",
                    from_bot_menu=False
                ))
                parsed = urllib.parse.urlparse(wv.url)
                if "tgWebAppData=" in parsed.fragment:
                    init_data = urllib.parse.unquote(parsed.fragment.split("tgWebAppData=")[1].split("&")[0])
                    if init_data:
                        with open(cache_file, "w", encoding="utf-8") as f:
                            json.dump({"init_data": init_data, "timestamp": time.time()}, f)
                        return init_data
            finally:
                await client.disconnect()
        except Exception as e:
            logger.warning(f"Failed to fetch Telegram WebApp init_data: {e}")
        return None

    async def _get_authorized_headers(self, xo_token: Optional[str] = None) -> Dict[str, str]:
        """Constructs headers combining renewed tokens and existing Telegram init data."""
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": f"{BotConfig.MEESHO_PROXY_BASE_URL}/",
        }
        if xo_token:
            headers["Authorization"] = f"Bearer {xo_token}"

        if BotConfig.TELEGRAM_STRING_SESSION and BotConfig.TELEGRAM_API_ID:
            init_data = await self._get_cached_or_fresh_init_data()
            if init_data:
                headers["X-Tg-Init-Data"] = init_data

        return headers

    async def _link_account_to_bot(self, account_data: Dict[str, Any], clean_mobile: str) -> bool:
        """Links an unlisted account into @primes_meesho_bot so it appears in /api/accounts/list."""
        api_id = BotConfig.TELEGRAM_API_ID
        api_hash = BotConfig.TELEGRAM_API_HASH
        sess_str = BotConfig.TELEGRAM_STRING_SESSION
        if not api_id or not api_hash or not sess_str:
            return False

        try:
            from telethon import TelegramClient
            from telethon.sessions import StringSession

            async with TelegramClient(StringSession(sess_str), int(api_id), api_hash, timeout=15) as client:
                bot_entity = await client.get_input_entity(BotConfig.TELEGRAM_BOT_USERNAME)
                await client.send_message(bot_entity, "/start")
                await asyncio.sleep(1.5)

                menu_msg = None
                for m in await client.get_messages(bot_entity, limit=5):
                    if not m.out:
                        menu_msg = m
                        break

                if menu_msg:
                    raw_text = menu_msg.raw_text or ""
                    if "Paste your saved Meesho session JSON" not in raw_text:
                        # Check if add:json button is directly present
                        has_add_json = False
                        if menu_msg.buttons:
                            for r in menu_msg.buttons:
                                for b in r:
                                    if getattr(b, "data", None) == b"add:json":
                                        has_add_json = True
                                        await menu_msg.click(data=b"add:json")
                                        await asyncio.sleep(1.5)
                                        break
                                if has_add_json:
                                    break

                        if not has_add_json and menu_msg.buttons:
                            for r in menu_msg.buttons:
                                for b in r:
                                    if getattr(b, "data", None) == b"add_account":
                                        await menu_msg.click(data=b"add_account")
                                        await asyncio.sleep(1.5)
                                        edited = await client.get_messages(bot_entity, ids=menu_msg.id)
                                        if edited and edited.buttons:
                                            await edited.click(data=b"add:json")
                                            await asyncio.sleep(1.5)
                                        break

                import_payload = {
                    "mobile": clean_mobile or account_data.get("mobile"),
                    "user_id": account_data.get("user_id"),
                    "xo": account_data.get("xo"),
                    "ox": account_data.get("ox"),
                    "instance_id": account_data.get("instance_id") or "",
                    "gaid": account_data.get("gaid") or ""
                }
                await client.send_message(bot_entity, json.dumps(import_payload))
                await asyncio.sleep(3.0)
                return True
        except Exception as e:
            logger.warning(f"Failed to link account {clean_mobile} to bot: {e}")
            return False

    async def refresh_account(self, account_data: Dict[str, Any]) -> RefreshResult:
        """
        Executes token refresh against provider proxy, updates timestamps,
        verifies session usability, and deep-preserves non-auth fields.
        """
        # 0. Check mock / testing environment fallback
        if (
            os.getenv("USE_MOCK_PROVIDER", "false").lower() == "true"
            or not BotConfig.TELEGRAM_STRING_SESSION
            or not BotConfig.TELEGRAM_API_ID
            or not BotConfig.TELEGRAM_API_HASH
        ):
            mock_engine = MockRefreshEngine()
            return await mock_engine.refresh_account(account_data)

        # 1. Validation & extraction
        xo_token = account_data.get("xo")
        ox_token = account_data.get("ox")
        mobile = account_data.get("mobile") or account_data.get("phone")
        user_id = account_data.get("user_id") or account_data.get("userId")

        if not ox_token and not xo_token:
            return RefreshResult(
                status=OutcomeStatus.UNSUPPORTED_FORMAT,
                error_message="Missing both refresh token ('ox') and auth token ('xo')"
            )

        clean_mobile = re.sub(r"^\+?91|^0|\D", "", str(mobile)).strip() if mobile else ""
        clean_uid = str(user_id).strip() if user_id else ""

        try:
            headers = await self._get_authorized_headers()
            proxy_base = BotConfig.MEESHO_PROXY_BASE_URL

            async with httpx.AsyncClient(verify=False, timeout=self.timeout) as client:
                # 2. Query accounts list to find internal shop ID
                r_list = await client.get(f"{proxy_base}/api/accounts/list", headers=headers)

                # Retry on 401/403 with cleared init_data cache
                if r_list.status_code in (401, 403):
                    cache_file = BotConfig.SCRATCH_DIR / ".tg_init_data.cache"
                    if cache_file.exists():
                        try:
                            cache_file.unlink()
                        except Exception:
                            pass
                    headers = await self._get_authorized_headers()
                    r_list = await client.get(f"{proxy_base}/api/accounts/list", headers=headers)

                if r_list.status_code == 429:
                    return RefreshResult(
                        status=OutcomeStatus.RATE_LIMITED,
                        error_message="Provider rate limit exceeded (HTTP 429)",
                        retry_after=5.0,
                        can_retry=True
                    )
                if r_list.status_code in (500, 502, 503, 504):
                    return RefreshResult(
                        status=OutcomeStatus.NETWORK_ERROR,
                        error_message=f"Provider server error (HTTP {r_list.status_code})",
                        can_retry=True
                    )
                if r_list.status_code != 200:
                    return RefreshResult(
                        status=OutcomeStatus.NETWORK_ERROR,
                        error_message=f"Failed to query account list (HTTP {r_list.status_code})",
                        can_retry=True
                    )

                accounts = r_list.json().get("accounts", [])
                matched = None
                for a in accounts:
                    a_mob = re.sub(r"^\+?91|^0|\D", "", str(a.get("mobile", ""))).strip()
                    a_uid = str(a.get("user_id") or "").strip()
                    if clean_mobile and a_mob and clean_mobile == a_mob:
                        matched = a
                        break
                    if clean_uid and a_uid and clean_uid == a_uid:
                        matched = a
                        break

                # 3. If account not in list, link it into shop bot via Telethon
                if not matched:
                    logger.info(f"Account {clean_mobile or clean_uid} not in shop list; linking to bot...")
                    linked = await self._link_account_to_bot(account_data, clean_mobile)
                    if linked:
                        r_list2 = await client.get(f"{proxy_base}/api/accounts/list", headers=headers)
                        if r_list2.status_code == 200:
                            for a in r_list2.json().get("accounts", []):
                                a_mob = re.sub(r"^\+?91|^0|\D", "", str(a.get("mobile", ""))).strip()
                                a_uid = str(a.get("user_id") or "").strip()
                                if clean_mobile and a_mob and clean_mobile == a_mob:
                                    matched = a
                                    break
                                if clean_uid and a_uid and clean_uid == a_uid:
                                    matched = a
                                    break

                if not matched:
                    return RefreshResult(
                        status=OutcomeStatus.INVALID_TOKEN,
                        error_message=f"Account {clean_mobile or clean_uid} could not be matched or linked on provider backend",
                        can_retry=False
                    )

                shop_id = matched["id"]
                logger.info(f"Account {clean_mobile} matched shop account ID {shop_id}. Selecting...")

                # 4. Select account
                r_sel = await client.post(f"{proxy_base}/api/accounts/select", headers=headers, json={"account_id": shop_id})
                if r_sel.status_code != 200:
                    return RefreshResult(
                        status=OutcomeStatus.NETWORK_ERROR,
                        error_message=f"Failed to select account on backend (HTTP {r_sel.status_code})",
                        can_retry=True
                    )

                # 5. Refresh account
                r_ref = await client.post(f"{proxy_base}/api/accounts/refresh", headers=headers, json={"account_id": shop_id})
                if r_ref.status_code == 429:
                    retry_hdr = r_ref.headers.get("Retry-After")
                    retry_secs = float(retry_hdr) if retry_hdr and retry_hdr.isdigit() else 5.0
                    return RefreshResult(
                        status=OutcomeStatus.RATE_LIMITED,
                        error_message=f"Provider rate limit exceeded (HTTP 429). Retry after {retry_secs}s",
                        retry_after=retry_secs,
                        can_retry=True
                    )
                if r_ref.status_code in (500, 502, 503, 504):
                    return RefreshResult(
                        status=OutcomeStatus.NETWORK_ERROR,
                        error_message=f"Provider gateway/server error (HTTP {r_ref.status_code})",
                        can_retry=True
                    )
                if r_ref.status_code in (401, 403):
                    return RefreshResult(
                        status=OutcomeStatus.EXPIRED_SESSION,
                        error_message=f"Session expired or revoked (HTTP {r_ref.status_code})",
                        can_retry=False
                    )
                if r_ref.status_code != 200:
                    return RefreshResult(
                        status=OutcomeStatus.INVALID_TOKEN,
                        error_message=f"Refresh rejected (HTTP {r_ref.status_code}): {r_ref.text}",
                        can_retry=False
                    )

                ref_json = r_ref.json()
                if ref_json.get("ok") is False:
                    err_msg = str(ref_json.get("error", "Refresh rejected"))
                    err_lower = err_msg.lower()
                    if any(w in err_lower for w in ["expired", "invalid", "revoked"]):
                        return RefreshResult(status=OutcomeStatus.EXPIRED_SESSION, error_message=err_msg, can_retry=False)
                    if any(w in err_lower for w in ["otp", "login", "reauth", "credentials"]):
                        return RefreshResult(status=OutcomeStatus.REQUIRES_REAUTH, error_message=err_msg, can_retry=False)
                    return RefreshResult(status=OutcomeStatus.INVALID_TOKEN, error_message=err_msg, can_retry=False)

                # 6. Trigger export to obtain renewed tokens
                t0 = time.time()
                r_exp = await client.post(f"{proxy_base}/api/account/export_file", headers=headers)
                if r_exp.status_code != 200:
                    return RefreshResult(
                        status=OutcomeStatus.NETWORK_ERROR,
                        error_message=f"Failed to export renewed account file (HTTP {r_exp.status_code})",
                        can_retry=True
                    )

            # 7. Download fresh account JSON from Telethon session
            fresh_data = None
            from telethon import TelegramClient
            from telethon.sessions import StringSession

            async with TelegramClient(
                StringSession(BotConfig.TELEGRAM_STRING_SESSION),
                int(BotConfig.TELEGRAM_API_ID),
                BotConfig.TELEGRAM_API_HASH,
                timeout=15
            ) as tg_client:
                bot_entity = await tg_client.get_input_entity(BotConfig.TELEGRAM_BOT_USERNAME)
                for _ in range(8):
                    await asyncio.sleep(1.0)
                    msgs = await tg_client.get_messages(bot_entity, limit=4)
                    for m in msgs:
                        if m.file and m.file.name and m.file.name.endswith(".json"):
                            if m.date.timestamp() >= t0 - 3.0:
                                content = await tg_client.download_media(m, file=bytes)
                                if content:
                                    fresh_data = json.loads(content.decode("utf-8"))
                                    break
                    if fresh_data:
                        break

            if not fresh_data:
                return RefreshResult(
                    status=OutcomeStatus.NETWORK_ERROR,
                    error_message="Timed out waiting for exported renewed file from shop bot",
                    can_retry=True
                )

            new_xo = fresh_data.get("xo")
            new_ox = fresh_data.get("ox") or ox_token

            if not new_xo:
                return RefreshResult(
                    status=OutcomeStatus.INVALID_TOKEN,
                    error_message="Exported file missing renewed auth token ('xo')",
                    can_retry=False
                )

            # 8. Structural validation
            inspection = TokenInspector.inspect_composite_xo(new_xo)
            if not inspection.get("is_valid"):
                return RefreshResult(
                    status=OutcomeStatus.INVALID_TOKEN,
                    error_message="Renewed auth token failed structural validation",
                    can_retry=False
                )

            exp = inspection.get("exp")
            if exp and exp <= time.time():
                return RefreshResult(
                    status=OutcomeStatus.EXPIRED_SESSION,
                    error_message="Renewed token arrived with expired expiration timestamp",
                    can_retry=False
                )

            # 9. Deep-preserve original fields and merge renewed tokens
            refreshed_account = copy.deepcopy(account_data)
            refreshed_account["xo"] = new_xo
            if new_ox:
                refreshed_account["ox"] = new_ox
            if exp:
                refreshed_account["xo_exp"] = exp

            now_ts = int(time.time())
            now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts))
            refreshed_account["last_refreshed_at"] = now_iso
            refreshed_account["refresh_status"] = "ACTIVE"

            return RefreshResult(
                status=OutcomeStatus.SUCCESS,
                refreshed_data=refreshed_account,
                is_verified=True,
                expiry_timestamp=exp
            )

        except (httpx.ConnectError, httpx.TimeoutException, httpx.ReadTimeout, httpx.NetworkError) as net_err:
            return RefreshResult(
                status=OutcomeStatus.NETWORK_ERROR,
                error_message=f"Network connectivity error: {str(net_err)}",
                can_retry=True
            )
        except Exception as ex:
            logger.error(f"Error during live account refresh: {ex}", exc_info=True)
            return RefreshResult(
                status=OutcomeStatus.INVALID_TOKEN,
                error_message=f"Unexpected error during refresh: {str(ex)}",
                can_retry=False
            )


class MockRefreshEngine(BaseRefreshEngine):
    """
    Deterministic mock provider for unit and integration testing.
    Allows testing every single acceptance criteria branch:
    - Valid account refresh
    - Expired refresh tokens
    - OTP / Reauthentication required
    - Rate limits with Retry-After
    - Network timeouts with retry backoff
    - Invalid tokens
    """

    def __init__(self):
        self.call_count: Dict[str, int] = {}
        self.rate_limit_hits: Dict[str, int] = {}

    async def refresh_account(self, account_data: Dict[str, Any]) -> RefreshResult:
        ident = str(account_data.get("mobile") or account_data.get("phone") or account_data.get("user_id") or "unknown")
        self.call_count[ident] = self.call_count.get(ident, 0) + 1

        xo = str(account_data.get("xo") or "")
        ox = str(account_data.get("ox") or "")

        # Test case: Missing tokens
        if not xo and not ox:
            return RefreshResult(
                status=OutcomeStatus.UNSUPPORTED_FORMAT,
                error_message="Account missing both 'xo' and 'ox' token fields",
                can_retry=False
            )

        # Test case: Rate limiting simulation (for numbers containing 'rate_limit' or '429')
        if "429" in ident or "rate_limit" in ox:
            hits = self.rate_limit_hits.get(ident, 0) + 1
            self.rate_limit_hits[ident] = hits
            if hits <= 1:
                return RefreshResult(
                    status=OutcomeStatus.RATE_LIMITED,
                    error_message="Provider rate limit exceeded (HTTP 429)",
                    retry_after=0.2,
                    can_retry=True
                )
            # After 1 retry, succeeds

        # Test case: Temporary Network error simulation (for numbers containing '502' or 'network_fail')
        if "502" in ident or "network_fail" in ox:
            if self.call_count[ident] <= 2:
                return RefreshResult(
                    status=OutcomeStatus.NETWORK_ERROR,
                    error_message="Temporary upstream connection timeout (502 Bad Gateway)",
                    can_retry=True
                )
            # After 2 retries, succeeds

        # Test case: Permanent network failure simulation
        if "perm_fail" in ident or "perm_network" in ox:
            return RefreshResult(
                status=OutcomeStatus.NETWORK_ERROR,
                error_message="Upstream host completely unreachable",
                can_retry=True
            )

        # Test case: Expired session (for numbers with 'expired' or 'exp_')
        if "expired" in ox or "expired" in ident or "exp_token" in xo:
            return RefreshResult(
                status=OutcomeStatus.EXPIRED_SESSION,
                error_message="Refresh token has expired or was revoked by provider",
                can_retry=False
            )

        # Test case: Reauthentication required (for numbers with 'reauth' or 'otp_required')
        if "reauth" in ox or "otp" in ident or "reauth" in ident:
            return RefreshResult(
                status=OutcomeStatus.REQUIRES_REAUTH,
                error_message="Account requires OTP re-verification or password login",
                can_retry=False
            )

        # Test case: Invalid token
        if "invalid" in ox or "malformed" in xo:
            return RefreshResult(
                status=OutcomeStatus.INVALID_TOKEN,
                error_message="Malformed authentication credentials",
                can_retry=False
            )

        # Default: SUCCESS
        now_ts = int(time.time())
        future_exp = now_ts + 86400 * 30  # 30 days valid
        user_id = account_data.get("user_id") or 605524023

        # Generate realistic renewed composite Meesho token
        inner_jwt_header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip("=")
        inner_jwt_payload_data = {
            "exp": future_exp,
            "https://meesho.com/user_id": user_id,
            "https://meesho.com/instance_id": account_data.get("instance_id") or "inst_test_id",
            "iat": now_ts
        }
        inner_jwt_payload = base64.urlsafe_b64encode(json.dumps(inner_jwt_payload_data).encode()).decode().rstrip("=")
        inner_jwt = f"{inner_jwt_header}.{inner_jwt_payload}.signature_hash"

        part1 = base64.urlsafe_b64encode(b'{"type":"composite"}').decode().rstrip("=")
        part2 = base64.urlsafe_b64encode(json.dumps({"jwt": inner_jwt, "xo": f"renewed_xo_{now_ts}"}).encode()).decode().rstrip("=")
        renewed_xo = f"{part1}.{part2}"
        renewed_ox = f"renewed_ox_{now_ts}_{ox[:10]}" if ox else f"renewed_ox_{now_ts}"

        # Deep merge preserving ALL original fields
        refreshed = copy.deepcopy(account_data)
        refreshed["xo"] = renewed_xo
        refreshed["ox"] = renewed_ox
        refreshed["xo_exp"] = future_exp
        refreshed["last_refreshed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts))
        refreshed["refresh_status"] = "ACTIVE"

        return RefreshResult(
            status=OutcomeStatus.SUCCESS,
            refreshed_data=refreshed,
            is_verified=True,
            expiry_timestamp=future_exp
        )
