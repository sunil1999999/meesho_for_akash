"""
Unit & Integration Tests for Parser and Input Methods.
Covers Acceptance Criteria:
1. One valid account JSON.
2. Multiple individual JSON files.
3. Pasted single-account JSON.
4. Bulk JSON containing many accounts (array, wrapper object, legacy dict).
5. Mixed input formats.
6. Duplicate account detection.
7. Invalid JSON and missing required fields.
"""

import sys
from pathlib import Path

# Add token_refresh_bot to sys.path
BOT_DIR = Path(__file__).resolve().parent.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import pytest
import json
from parser import (
    AccountDataParser,
    normalize_indian_phone,
    extract_consecutive_json_objects,
    ParsedAccount
)


def test_1_one_valid_account_json():
    """Criteria 1: Parse one valid account JSON."""
    raw = json.dumps({
        "mobile": "9033807401",
        "user_id": 605524023,
        "phone": "+919033807401",
        "xo": "eyJ0eXBlIjoiY29tcG9zaXRlIn0=.eyJqd3QiOiJ0ZXN0X2p3dCIsInhvIjoidGVzdF94byJ9",
        "ox": "ox_refresh_token_valid_sample_12345",
        "identity": {"make": "Realme", "model": "Narzo 70"}
    })

    records = AccountDataParser.parse_raw_content(raw, source_name="single_account.json")
    assert len(records) == 1
    rec = records[0]
    assert rec.is_valid is True
    assert rec.normalized_phone == "+919033807401"
    assert rec.stable_identifier == "+919033807401"
    assert rec.has_auth_token is True
    assert rec.has_refresh_token is True
    assert rec.raw_data["identity"]["make"] == "Realme"


def test_2_multiple_individual_files():
    """Criteria 2: Parse multiple individual files in a batch."""
    file1_content = json.dumps({
        "mobile": "9033807401",
        "xo": "sample_xo_1",
        "ox": "sample_ox_1"
    })
    file2_content = json.dumps({
        "mobile": "9820192831",
        "xo": "sample_xo_2",
        "ox": "sample_ox_2"
    })
    file3_content = json.dumps({
        "phone": "+919173573074",
        "xo": "sample_xo_3",
        "ox": "sample_ox_3"
    })

    rec1 = AccountDataParser.parse_raw_content(file1_content, "file1.json")
    rec2 = AccountDataParser.parse_raw_content(file2_content, "file2.json")
    rec3 = AccountDataParser.parse_raw_content(file3_content, "file3.json")

    all_accounts = rec1 + rec2 + rec3
    assert len(all_accounts) == 3
    assert all(a.is_valid for a in all_accounts)
    assert {a.normalized_phone for a in all_accounts} == {
        "+919033807401", "+919820192831", "+919173573074"
    }


def test_3_pasted_single_account_json():
    """Criteria 3: Pasted single-account JSON directly."""
    pasted_text = """
    {
        "mobile": "8094980081",
        "user_id": 143321,
        "xo": "pasted_xo_composite_token",
        "ox": "pasted_ox_refresh_token",
        "identity": {"device": "Poco X6 Pro"}
    }
    """
    records = AccountDataParser.parse_raw_content(pasted_text, source_name="pasted_text")
    assert len(records) == 1
    assert records[0].is_valid is True
    assert records[0].normalized_phone == "+918094980081"
    assert records[0].source_file == "pasted_text"


def test_4_bulk_accounts_in_one_json():
    """Criteria 4: Bulk accounts in JSON array, wrapper object, and legacy formats."""
    # 4A. JSON Array
    arr_json = json.dumps([
        {"mobile": "9033807401", "xo": "xo_1", "ox": "ox_1"},
        {"mobile": "9820192831", "xo": "xo_2", "ox": "ox_2"},
        {"mobile": "9173573074", "xo": "xo_3", "ox": "ox_3"}
    ])
    records_arr = AccountDataParser.parse_raw_content(arr_json, "bulk_array.json")
    assert len(records_arr) == 3
    assert all(r.is_valid for r in records_arr)

    # 4B. Object wrapper with 'accounts' array
    obj_json = json.dumps({
        "exported_at": "2026-10-17T12:00:00Z",
        "accounts": [
            {"mobile": "9033807401", "xo": "xo_1", "ox": "ox_1"},
            {"mobile": "9820192831", "xo": "xo_2", "ox": "ox_2"}
        ]
    })
    records_obj = AccountDataParser.parse_raw_content(obj_json, "bulk_wrapper.json")
    assert len(records_obj) == 2
    assert records_obj[0].normalized_phone == "+919033807401"

    # 4C. Legacy format (dictionary keyed by phone)
    legacy_json = json.dumps({
        "9033807401": {"user_id": "1", "xo": "xo_1", "ox": "ox_1", "mobile": "9033807401"},
        "9820192831": {"user_id": "2", "xo": "xo_2", "ox": "ox_2", "mobile": "9820192831"}
    })
    records_legacy = AccountDataParser.parse_raw_content(legacy_json, "bulk_legacy.json")
    assert len(records_legacy) == 2

    # 4D. Consecutive JSONs in TXT (brace matching)
    consecutive_txt = """
    {"mobile": "9033807401", "xo": "xo_1", "ox": "ox_1"}

    {"mobile": "9820192831", "xo": "xo_2", "ox": "ox_2"}
    """
    records_txt = AccountDataParser.parse_raw_content(consecutive_txt, "consecutive.txt")
    assert len(records_txt) == 2


def test_5_mixed_input_formats():
    """Criteria 5: Mixed input formats in one refresh session."""
    # Source 1: Individual file
    f1 = AccountDataParser.parse_raw_content('{"mobile": "9033807401", "xo": "x1", "ox": "o1"}', "file1.json")
    # Source 2: Pasted text
    f2 = AccountDataParser.parse_raw_content('{"mobile": "9820192831", "xo": "x2", "ox": "o2"}', "pasted_text")
    # Source 3: Bulk JSON file
    f3 = AccountDataParser.parse_raw_content(json.dumps([
        {"mobile": "9173573074", "xo": "x3", "ox": "o3"},
        {"mobile": "9344453255", "xo": "x4", "ox": "o4"}
    ]), "bulk.json")

    combined = f1 + f2 + f3
    eligible, duplicates = AccountDataParser.deduplicate_batch(combined)
    assert len(eligible) == 4
    assert len(duplicates) == 0


def test_6_duplicate_account_detection():
    """Criteria 6: Duplicate account detection and handling."""
    batch_with_duplicates = [
        {"mobile": "9033807401", "xo": "xo_first", "ox": "ox_first"},
        {"mobile": "9033807401", "xo": "xo_dup", "ox": "ox_dup"},  # Exact same mobile
        {"mobile": "09033807401", "xo": "xo_dup2", "ox": "ox_dup2"}, # 0-prefixed same mobile
        {"mobile": "9820192831", "xo": "xo_unique", "ox": "ox_unique"}
    ]
    records = AccountDataParser.parse_raw_content(json.dumps(batch_with_duplicates), "batch.json")
    eligible, duplicates = AccountDataParser.deduplicate_batch(records)

    assert len(eligible) == 2
    assert len(duplicates) == 2
    assert eligible[0].normalized_phone == "+919033807401"
    assert eligible[1].normalized_phone == "+919820192831"
    assert all(d.is_duplicate is True for d in duplicates)


def test_7_invalid_json_and_missing_required_fields():
    """Criteria 7: Invalid JSON and missing required fields."""
    # 7A. Missing both auth and refresh tokens
    no_tokens = json.dumps({"mobile": "9033807401", "name": "No Tokens Here"})
    rec_no_tokens = AccountDataParser.parse_raw_content(no_tokens, "no_tokens.json")[0]
    assert rec_no_tokens.is_valid is False
    assert "missing both" in rec_no_tokens.validation_error.lower()

    # 7B. Missing identifier
    no_id = json.dumps({"xo": "sample_xo_token_only", "ox": "sample_ox_refresh"})
    rec_no_id = AccountDataParser.parse_raw_content(no_id, "no_id.json")[0]
    assert rec_no_id.is_valid is False
    assert "lacks recognizable identifier" in rec_no_id.validation_error.lower()

    # 7C. Corrupted unparseable text
    corrupt = "NOT_A_JSON_OBJECT{{{[[[bad data"
    rec_corrupt = AccountDataParser.parse_raw_content(corrupt, "corrupt.txt")[0]
    assert rec_corrupt.is_valid is False
    assert "could not detect or parse" in rec_corrupt.validation_error.lower()
