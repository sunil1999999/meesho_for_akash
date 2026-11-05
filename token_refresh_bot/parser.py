"""
Multi-Format Account Parser for Account Token Refresh Bot.
Supports:
- Single account JSON or TXT file
- Multiple consecutive pretty-printed or compact JSON objects in TXT
- Bulk accounts in JSON array, wrapper objects ({accounts: []}, {records: []}, etc.), or dictionary
- JSON Lines (NDJSON)
- Directly pasted JSON text
- Accurate phone number normalization (+91 Indian mobile)
- Deduplication using stable account identifiers
"""

import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, field


@dataclass
class ParsedAccount:
    """Represents a validated account record extracted from input files or text."""
    stable_identifier: str
    normalized_phone: Optional[str]
    display_phone: str
    user_id: Optional[str]
    raw_data: Dict[str, Any]
    source_file: str
    record_index: int
    has_auth_token: bool
    has_refresh_token: bool
    is_valid: bool
    validation_error: Optional[str] = None
    is_duplicate: bool = False
    duplicate_reason: Optional[str] = None


def normalize_indian_phone(raw_val: Any) -> Tuple[bool, Optional[str], str, Optional[str]]:
    """
    Normalizes input to standard Indian E.164 format (+91XXXXXXXXXX).
    Returns (is_valid, normalized, display, error_message).
    """
    if raw_val is None:
        return False, None, "Missing Phone", "Phone number is null or missing"

    raw_str = str(raw_val).strip()
    if not raw_str:
        return False, None, "Empty Phone", "Phone number string is empty"

    # Remove formatting characters
    cleaned = re.sub(r"[\s\-\(\)\.]", "", raw_str)
    if cleaned.startswith("+"):
        cleaned = cleaned[1:]

    # 1. 10 digits starting with 6-9
    if re.match(r"^[6-9]\d{9}$", cleaned):
        norm = f"+91{cleaned}"
        disp = f"+91 {cleaned[:5]} {cleaned[5:]}"
        return True, norm, disp, None

    # 2. 11 digits starting with 0 (e.g. 09033807401)
    if re.match(r"^0[6-9]\d{9}$", cleaned):
        ten = cleaned[1:]
        norm = f"+91{ten}"
        disp = f"+91 {ten[:5]} {ten[5:]}"
        return True, norm, disp, None

    # 3. 12 digits starting with 91 (e.g. 919033807401 or +919033807401)
    if re.match(r"^91[6-9]\d{9}$", cleaned):
        ten = cleaned[2:]
        norm = f"+91{ten}"
        disp = f"+91 {ten[:5]} {ten[5:]}"
        return True, norm, disp, None

    # 4. Standard international E.164 (7 to 15 digits)
    if re.match(r"^\d{7,15}$", cleaned) and raw_str.startswith("+"):
        norm = f"+{cleaned}"
        return True, norm, norm, None

    return False, None, raw_str, f"Invalid mobile number format: '{raw_str}'"


def extract_phone(account_data: Dict[str, Any]) -> Tuple[bool, Optional[str], str, Optional[str]]:
    """Extracts and normalizes phone number from arbitrary account dictionary."""
    candidates = [
        account_data.get("mobile"),
        account_data.get("phone"),
        account_data.get("mobile_number"),
        account_data.get("mobileNumber"),
        account_data.get("phone_number"),
        account_data.get("phoneNumber"),
        account_data.get("contact"),
    ]

    # Nested lookups
    user_obj = account_data.get("user")
    if isinstance(user_obj, dict):
        candidates.extend([
            user_obj.get("mobile"),
            user_obj.get("phone"),
            user_obj.get("phoneNumber")
        ])

    for c in candidates:
        if c is not None and str(c).strip():
            return normalize_indian_phone(c)

    return False, None, "No Phone Found", "No phone or mobile field found in account JSON"


def extract_user_id(account_data: Dict[str, Any]) -> Optional[str]:
    """Extracts user ID from account dictionary."""
    candidates = [
        account_data.get("user_id"),
        account_data.get("userId"),
        account_data.get("id"),
        account_data.get("identifier"),
    ]
    identity = account_data.get("identity")
    if isinstance(identity, dict):
        candidates.extend([identity.get("user_id"), identity.get("id")])

    for c in candidates:
        if c is not None and str(c).strip():
            return str(c).strip()
    return None


def extract_consecutive_json_objects(text: str) -> Tuple[List[str], List[str]]:
    """
    State machine that extracts multiple consecutive or pretty-printed JSON
    objects from text without naive regex splits. Respects strings and escapes.
    """
    json_strings: List[str] = []
    errors: List[str] = []

    depth = 0
    start_index = -1
    in_string = False
    escape_next = False
    length = len(text)

    for i in range(length):
        char = text[i]

        if in_string:
            if escape_next:
                escape_next = False
            elif char == "\\":
                escape_next = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue

        if char == "{":
            if depth == 0:
                start_index = i
            depth += 1
        elif char == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start_index != -1:
                    json_sub = text[start_index: i + 1].strip()
                    if json_sub:
                        json_strings.append(json_sub)
                    start_index = -1
            else:
                errors.append(f"Unexpected closing brace '}}' at character index {i}")

    if depth > 0 and start_index != -1:
        errors.append(f"Unclosed JSON object starting at position {start_index} (unmatched {depth} braces)")

    return json_strings, errors


def parse_account_dict(
    account_data: Any,
    source_file: str,
    record_index: int
) -> ParsedAccount:
    """Validates and constructs a ParsedAccount from a dictionary."""
    if not isinstance(account_data, dict):
        return ParsedAccount(
            stable_identifier=f"invalid_{source_file}_{record_index}",
            normalized_phone=None,
            display_phone="Invalid Record",
            user_id=None,
            raw_data={},
            source_file=source_file,
            record_index=record_index,
            has_auth_token=False,
            has_refresh_token=False,
            is_valid=False,
            validation_error="Record is not a JSON object",
        )

    phone_valid, norm_phone, disp_phone, phone_err = extract_phone(account_data)
    user_id = extract_user_id(account_data)

    # Determine stable identifier: normalized phone is prioritized, then user_id, then instance_id
    if norm_phone:
        stable_id = norm_phone
    elif user_id:
        stable_id = f"uid_{user_id}"
    elif account_data.get("instance_id"):
        stable_id = f"inst_{account_data.get('instance_id')}"
    elif account_data.get("gaid"):
        stable_id = f"gaid_{account_data.get('gaid')}"
    else:
        stable_id = f"rec_{source_file}_{record_index}"

    xo_token = str(account_data.get("xo") or "").strip()
    ox_token = str(account_data.get("ox") or "").strip()
    session_token = str(account_data.get("session") or account_data.get("token") or "").strip()

    has_auth = bool(xo_token or session_token)
    has_refresh = bool(ox_token)

    # Validation criteria: must have either auth token or refresh token, plus an identifier
    is_valid = True
    error_msg = None

    if not has_auth and not has_refresh:
        is_valid = False
        error_msg = "Account record missing both authentication ('xo') and refresh ('ox') tokens"
    elif not phone_valid and not user_id and not account_data.get("instance_id"):
        is_valid = False
        error_msg = f"Account lacks recognizable identifier ({phone_err})"

    return ParsedAccount(
        stable_identifier=stable_id,
        normalized_phone=norm_phone,
        display_phone=disp_phone if norm_phone else (disp_phone or f"ID: {user_id or stable_id}"),
        user_id=user_id,
        raw_data=account_data,
        source_file=source_file,
        record_index=record_index,
        has_auth_token=has_auth,
        has_refresh_token=has_refresh,
        is_valid=is_valid,
        validation_error=error_msg,
    )


def unpack_account_container(
    obj: Any,
    source_name: str,
    base_index: int = 1
) -> List[ParsedAccount]:
    """
    Unpacks arbitrary JSON container (single dict, list, wrapped dict, or keyed dict)
    into a list of ParsedAccount records.
    """
    if isinstance(obj, list):
        return [
            parse_account_dict(item, source_name, base_index + idx)
            for idx, item in enumerate(obj)
        ]
    if isinstance(obj, dict):
        # Check for known bulk wrappers
        wrapper_keys = ["accounts", "records", "data", "users", "items", "list"]
        for k in wrapper_keys:
            if k in obj and isinstance(obj[k], list):
                return [
                    parse_account_dict(item, source_name, base_index + idx)
                    for idx, item in enumerate(obj[k])
                ]

        # Check for dictionary of accounts keyed by ID or phone
        # (e.g. {"9033807401": {...}, "9820192831": {...}})
        val_items = list(obj.values())
        if val_items and all(isinstance(v, dict) for v in val_items) and not any(k in obj for k in ["mobile", "phone", "xo", "ox"]):
            return [
                parse_account_dict(v, source_name, base_index + idx)
                for idx, v in enumerate(val_items)
            ]

        # Otherwise, it's a single account JSON object
        return [parse_account_dict(obj, source_name, base_index)]

    return [parse_account_dict(obj, source_name, base_index)]


class AccountDataParser:
    """Multi-format parser engine."""

    @classmethod
    def parse_raw_content(cls, content: str, source_name: str = "upload") -> List[ParsedAccount]:
        """
        Parses raw text content from a file or pasted string into a list of ParsedAccount objects.
        Automatically detects format.
        """
        trimmed = content.strip()
        if not trimmed:
            return []

        # Strategy 1: Standard JSON Array `[ { ... }, { ... } ]`
        if trimmed.startswith("[") and trimmed.endswith("]"):
            try:
                arr = json.loads(trimmed)
                if isinstance(arr, list):
                    return unpack_account_container(arr, source_name, 1)
            except Exception:
                pass  # Fall through to brace matching

        # Strategy 2: Single JSON Object or Object Wrapper
        if trimmed.startswith("{") and trimmed.endswith("}"):
            try:
                obj = json.loads(trimmed)
                if isinstance(obj, dict):
                    return unpack_account_container(obj, source_name, 1)
            except Exception:
                pass  # Fall through to brace matching

        # Strategy 3: JSON Lines (NDJSON)
        lines = [line.strip() for line in trimmed.splitlines() if line.strip()]
        if len(lines) > 1:
            all_lines_json = True
            ndjson_records: List[ParsedAccount] = []
            for idx, line in enumerate(lines):
                try:
                    parsed = json.loads(line)
                    if isinstance(parsed, dict):
                        ndjson_records.append(parse_account_dict(parsed, source_name, idx + 1))
                    else:
                        all_lines_json = False
                        break
                except Exception:
                    all_lines_json = False
                    break

            if all_lines_json and ndjson_records:
                return ndjson_records

        # Strategy 4: Consecutive JSON Objects in TXT (brace-matching state machine)
        json_strings, errors = extract_consecutive_json_objects(trimmed)
        if json_strings:
            records = []
            current_idx = 1
            for s in json_strings:
                try:
                    obj = json.loads(s)
                    extracted = unpack_account_container(obj, source_name, current_idx)
                    records.extend(extracted)
                    current_idx += len(extracted)
                except Exception as e:
                    records.append(ParsedAccount(
                        stable_identifier=f"corrupt_{source_name}_{current_idx}",
                        normalized_phone=None,
                        display_phone="Corrupt JSON",
                        user_id=None,
                        raw_data={},
                        source_file=source_name,
                        record_index=current_idx,
                        has_auth_token=False,
                        has_refresh_token=False,
                        is_valid=False,
                        validation_error=f"JSON decode error: {str(e)}",
                    ))
                    current_idx += 1
            return records

        # Fallback: invalid unparseable content
        return [ParsedAccount(
            stable_identifier=f"unparseable_{source_name}_1",
            normalized_phone=None,
            display_phone="Unparseable File",
            user_id=None,
            raw_data={},
            source_file=source_name,
            record_index=1,
            has_auth_token=False,
            has_refresh_token=False,
            is_valid=False,
            validation_error="Could not detect or parse any valid JSON objects in content",
        )]

    @classmethod
    def deduplicate_batch(
        cls,
        new_accounts: List[ParsedAccount],
        existing_identifiers: Optional[Set[str]] = None
    ) -> Tuple[List[ParsedAccount], List[ParsedAccount]]:
        """
        Deduplicates accounts against an existing set of identifiers and within the new accounts.
        Returns (eligible_accounts, duplicate_accounts).
        """
        seen: Set[str] = set(existing_identifiers or set())
        eligible: List[ParsedAccount] = []
        duplicates: List[ParsedAccount] = []

        for acc in new_accounts:
            # If account is already invalid, do not deduplicate, keep as invalid
            if not acc.is_valid:
                eligible.append(acc)
                continue

            ident = acc.stable_identifier
            if ident in seen:
                acc.is_duplicate = True
                acc.duplicate_reason = f"Duplicate account identifier in batch: {ident}"
                duplicates.append(acc)
            else:
                seen.add(ident)
                eligible.append(acc)

        return eligible, duplicates
