"""
Unit & Integration Tests for Forwarded Messages, Forwarded Files, and Captions.
Tests:
- Forwarded single-account JSON with chat header/forward preamble
- Forwarded bulk wrapped JSON ({accounts: [...]})
- Forwarded JSON array
- Forwarded document captions
- Forward source origin resolution (Bot API 7.0+ MessageOrigin and legacy fields)
- Batch accumulation and deduplication across forwarded messages
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock

BOT_DIR = Path(__file__).resolve().parent.parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import json
import pytest
from parser import AccountDataParser
from bot import get_forward_source_info, _user_staged_batches


def test_forwarded_single_account_json_with_preamble():
    """Validates that a forwarded message containing surrounding chat text extracts the account."""
    forwarded_text = (
        "Forwarded from @MeeshoSellerDeals\n"
        "Here is the account login session:\n"
        "{\n"
        '  "mobile": "9033807401",\n'
        '  "xo": "composite_auth_token_xyz_123",\n'
        '  "ox": "ox_refresh_token_valid_456"\n'
        "}\n"
        "Do not share this token!"
    )

    records = AccountDataParser.parse_raw_content(forwarded_text, source_name="forwarded_@MeeshoSellerDeals")
    assert len(records) == 1
    rec = records[0]
    assert rec.is_valid is True
    assert rec.normalized_phone == "+919033807401"
    assert rec.has_auth_token is True
    assert rec.has_refresh_token is True


def test_forwarded_wrapped_accounts_in_chat():
    """Validates that a forwarded message containing a wrapped {accounts: [...]} object extracts all records."""
    forwarded_text = (
        "Forwarded message:\n"
        "{\n"
        '  "accounts": [\n'
        '    {"mobile": "9033807401", "xo": "token_a", "ox": "refresh_a"},\n'
        '    {"mobile": "9820192831", "xo": "token_b", "ox": "refresh_b"}\n'
        "  ]\n"
        "}"
    )

    records = AccountDataParser.parse_raw_content(forwarded_text, source_name="forwarded_batch")
    assert len(records) == 2
    assert records[0].normalized_phone == "+919033807401"
    assert records[0].is_valid is True
    assert records[1].normalized_phone == "+919820192831"
    assert records[1].is_valid is True


def test_forwarded_json_array_in_chat():
    """Validates that a forwarded message with an array of accounts inside text is unpacked."""
    forwarded_text = (
        "Check these two accounts:\n"
        "[\n"
        '  {"phone": "+91 90338 07401", "xo": "token_1", "ox": "ref_1"},\n'
        '  {"phone": "+91 91234 56789", "xo": "token_2", "ox": "ref_2"}\n'
        "]\n"
        "Sent from my iPhone"
    )

    records = AccountDataParser.parse_raw_content(forwarded_text, source_name="forwarded_array")
    assert len(records) == 2
    assert records[0].normalized_phone == "+919033807401"
    assert records[1].normalized_phone == "+919123456789"


def test_forwarded_caption_parsing():
    """Validates parsing account JSON passed as a message caption."""
    caption = (
        "Forwarded from Channel:\n"
        '{"mobile": "09033807401", "xo": "caption_xo", "ox": "caption_ox"}'
    )
    records = AccountDataParser.parse_raw_content(caption, source_name="forwarded_caption")
    assert len(records) == 1
    assert records[0].is_valid is True
    assert records[0].normalized_phone == "+919033807401"


def test_get_forward_source_info_modern_message_origin():
    """Tests get_forward_source_info with Bot API 7.0+ MessageOrigin types."""
    # 1. MessageOriginUser with username
    msg_user = MagicMock()
    user_obj = MagicMock()
    user_obj.username = "seller_bot"
    user_obj.first_name = "Seller"
    msg_user.forward_origin = MagicMock()
    msg_user.forward_origin.sender_user = user_obj
    msg_user.forward_origin.chat = None
    msg_user.forward_origin.sender_chat = None
    msg_user.forward_origin.sender_user_name = None
    assert get_forward_source_info(msg_user) == "@seller_bot"

    # 2. MessageOriginChannel
    msg_channel = MagicMock()
    channel_obj = MagicMock()
    channel_obj.username = "daily_accounts"
    channel_obj.title = "Daily Accounts Channel"
    msg_channel.forward_origin = MagicMock()
    msg_channel.forward_origin.sender_user = None
    msg_channel.forward_origin.chat = channel_obj
    msg_channel.forward_origin.sender_chat = None
    msg_channel.forward_origin.sender_user_name = None
    assert get_forward_source_info(msg_channel) == "@daily_accounts"

    # 3. MessageOriginHiddenUser
    msg_hidden = MagicMock()
    msg_hidden.forward_origin = MagicMock()
    msg_hidden.forward_origin.sender_user = None
    msg_hidden.forward_origin.chat = None
    msg_hidden.forward_origin.sender_chat = None
    msg_hidden.forward_origin.sender_user_name = "Anonymous Trader"
    assert get_forward_source_info(msg_hidden) == "Anonymous Trader"


def test_get_forward_source_info_legacy_fields():
    """Tests get_forward_source_info fallback on legacy Telegram message fields."""
    msg = MagicMock()
    msg.forward_origin = None

    # Legacy forward_from
    ff = MagicMock()
    ff.username = "trader_99"
    ff.full_name = "Trader 99"
    msg.forward_from = ff
    msg.forward_from_chat = None
    msg.forward_sender_name = None
    msg.forward_date = None
    assert get_forward_source_info(msg) == "@trader_99"

    # Legacy forward_from_chat
    msg.forward_from = None
    fc = MagicMock()
    fc.username = None
    fc.title = "Deals Group"
    msg.forward_from_chat = fc
    assert get_forward_source_info(msg) == "Deals Group"

    # Legacy forward_date only
    msg.forward_from_chat = None
    msg.forward_date = 1600000000
    assert get_forward_source_info(msg) == "Forwarded message"


def test_staged_batch_forwarded_deduplication():
    """Tests staging multiple forwarded messages in sequence with duplicate avoidance."""
    msg1 = '{"mobile": "9033807401", "xo": "xo_1", "ox": "ox_1"}'
    msg2 = '{"mobile": "9820192831", "xo": "xo_2", "ox": "ox_2"}'
    # Duplicate of msg1
    msg3 = '{"mobile": "9033807401", "xo": "xo_1_dup", "ox": "ox_1_dup"}'

    test_user_id = 999888777
    _user_staged_batches[test_user_id] = {
        "batch_id": "test_forward_batch",
        "accounts": [],
        "identifiers": set()
    }
    staged = _user_staged_batches[test_user_id]

    # Process forward 1
    r1 = AccountDataParser.parse_raw_content(msg1, source_name="fwd_1")
    e1, d1 = AccountDataParser.deduplicate_batch(r1, staged["identifiers"])
    for a in e1:
        staged["accounts"].append(a)
        staged["identifiers"].add(a.stable_identifier)

    assert len(staged["accounts"]) == 1
    assert len(staged["identifiers"]) == 1

    # Process forward 2
    r2 = AccountDataParser.parse_raw_content(msg2, source_name="fwd_2")
    e2, d2 = AccountDataParser.deduplicate_batch(r2, staged["identifiers"])
    for a in e2:
        staged["accounts"].append(a)
        staged["identifiers"].add(a.stable_identifier)

    assert len(staged["accounts"]) == 2
    assert len(staged["identifiers"]) == 2

    # Process forward 3 (duplicate of forward 1)
    r3 = AccountDataParser.parse_raw_content(msg3, source_name="fwd_3")
    e3, d3 = AccountDataParser.deduplicate_batch(r3, staged["identifiers"])
    assert len(e3) == 0
    assert len(d3) == 1
    assert d3[0].is_duplicate is True

    # Cleanup
    del _user_staged_batches[test_user_id]
