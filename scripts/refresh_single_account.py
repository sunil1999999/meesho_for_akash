# Standalone Single-Account Token Refresh CLI and Service
import os
import sys
import json
import asyncio
import argparse
import copy
from typing import Any, Dict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOT_DIR = os.path.join(BASE_DIR, 'token_refresh_bot')
if BOT_DIR not in sys.path:
    sys.path.insert(0, BOT_DIR)

from provider import (
    LiveHttpRefreshEngine,
    MockRefreshEngine,
    OutcomeStatus,
    TokenInspector,
    RefreshResult,
)
from config import BotConfig


def sanitize_message(msg: str) -> str:
    if not msg:
        return ''
    import re
    return re.sub(r'[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{25,}', '[REDACTED_TOKEN]', str(msg))


async def refresh_single_account(account_id: str, mobile: str, account_json: Dict[str, Any]) -> Dict[str, Any]:
    original_data = copy.deepcopy(account_json or {})
    engine = LiveHttpRefreshEngine()

    try:
        result: RefreshResult = await engine.refresh_account(original_data)
    except Exception as exc:
        return {
            'success': False,
            'status': 'FAILED',
            'display_status': 'Failed',
            'message': f'Refresh error: {sanitize_message(str(exc))}',
            'account_id': account_id,
            'mobile': mobile,
        }

    status_str = result.status.value if hasattr(result.status, 'value') else str(result.status)

    if result.status == OutcomeStatus.SUCCESS and result.refreshed_data:
        refreshed = result.refreshed_data
        new_xo = refreshed.get('xo')
        if not new_xo:
            return {
                'success': False,
                'status': 'FAILED',
                'display_status': 'Failed',
                'message': 'Provider returned success but no renewed auth token was present.',
                'account_id': account_id,
                'mobile': mobile,
            }

        inspection = TokenInspector.inspect_composite_xo(new_xo)
        if not inspection.get('is_valid', False):
            return {
                'success': False,
                'status': 'FAILED',
                'display_status': 'Failed',
                'message': 'Renewed token failed validation check.',
                'account_id': account_id,
                'mobile': mobile,
            }

        for k, v in original_data.items():
            if k not in refreshed:
                refreshed[k] = v

        return {
            'success': True,
            'status': 'SUCCESS',
            'display_status': 'Success',
            'message': 'Session refreshed and verified successfully.',
            'refreshed_json': refreshed,
            'account_id': account_id,
            'mobile': mobile,
            'expiry_timestamp': result.expiry_timestamp,
        }

    elif result.status in (OutcomeStatus.REQUIRES_REAUTH,):
        return {
            'success': False,
            'status': 'REQUIRES_REAUTH',
            'display_status': 'Re-login Required',
            'message': sanitize_message(result.error_message or 'Account requires OTP or re-login.'),
            'account_id': account_id,
            'mobile': mobile,
        }

    elif result.status in (OutcomeStatus.EXPIRED_SESSION,):
        return {
            'success': False,
            'status': 'EXPIRED',
            'display_status': 'Re-login Required',
            'message': sanitize_message(result.error_message or 'Session expired or revoked. Re-login is required.'),
            'account_id': account_id,
            'mobile': mobile,
        }

    elif result.status == OutcomeStatus.RATE_LIMITED:
        return {
            'success': False,
            'status': 'RATE_LIMITED',
            'display_status': 'Failed',
            'message': sanitize_message(result.error_message or 'Provider rate limit exceeded. Please try again later.'),
            'account_id': account_id,
            'mobile': mobile,
        }

    else:
        return {
            'success': False,
            'status': 'FAILED',
            'display_status': 'Failed',
            'message': sanitize_message(result.error_message or f'Token refresh rejected ({status_str}).'),
            'account_id': account_id,
            'mobile': mobile,
        }


def main():
    parser = argparse.ArgumentParser(description='Refresh token for a single account.')
    parser.add_argument('--account-id', default='', help='Account ID')
    parser.add_argument('--mobile', default='', help='Normalized or display mobile number')
    parser.add_argument('--payload', default='', help='JSON string payload')
    parser.add_argument('--payload-file', default='', help='File containing JSON payload')
    args = parser.parse_args()

    account_id = args.account_id
    mobile = args.mobile
    account_json = {}

    if args.payload_file and os.path.exists(args.payload_file):
        with open(args.payload_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            account_id = data.get('account_id') or account_id
            mobile = data.get('mobile') or mobile
            account_json = data.get('account_json') or data.get('session_json') or {}
    elif args.payload:
        data = json.loads(args.payload)
        account_id = data.get('account_id') or account_id
        mobile = data.get('mobile') or mobile
        account_json = data.get('account_json') or data.get('session_json') or {}

    res = asyncio.run(refresh_single_account(account_id, mobile, account_json))
    print(json.dumps(res))


if __name__ == '__main__':
    main()
