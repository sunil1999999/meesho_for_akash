import { describe, it, expect } from 'vitest';
import {
  parseRawFileContent,
  extractConsecutiveJsonObjects,
  analyzeBatchRecords,
} from '../lib/jsonParser';

describe('JSON and TXT Parser', () => {
  it('parses a single JSON object in a file', () => {
    const raw = JSON.stringify({
      mobile: '9033807401',
      user_id: 'usr_meesho_100',
      xo: 'token_xo',
    });
    const result = parseRawFileContent('single.json', raw, raw.length);
    expect(result.valid_records).toBe(1);
    expect(result.records[0].normalized_phone).toBe('+919033807401');
    expect(result.records[0].extracted_user_id).toBe('usr_meesho_100');
  });

  it('parses a JSON array of accounts', () => {
    const raw = JSON.stringify([
      { mobile: '9033807401', user_id: 'u1' },
      { mobile: '9820192831', user_id: 'u2' },
    ]);
    const result = parseRawFileContent('accounts.json', raw, raw.length);
    expect(result.total_records).toBe(2);
    expect(result.valid_records).toBe(2);
    expect(result.records[0].normalized_phone).toBe('+919033807401');
    expect(result.records[1].normalized_phone).toBe('+919820192831');
  });

  it('parses multiple consecutive pretty-printed JSON objects in a TXT file', () => {
    const rawTxt = `
    {
      "mobile": "9033807401",
      "user_id": "usr_01",
      "identity": {
        "model": "Samsung A52"
      }
    }

    {
      "mobile": "9820192831",
      "user_id": "usr_02",
      "identity": {
        "model": "OnePlus 9"
      }
    }
    `;

    const { jsonStrings, errors } = extractConsecutiveJsonObjects(rawTxt);
    expect(errors.length).toBe(0);
    expect(jsonStrings.length).toBe(2);

    const result = parseRawFileContent('consecutive.txt', rawTxt, rawTxt.length);
    expect(result.total_records).toBe(2);
    expect(result.valid_records).toBe(2);
    expect(result.records[0].normalized_phone).toBe('+919033807401');
    expect(result.records[1].normalized_phone).toBe('+919820192831');
    expect(result.records[0].raw_json.identity.model).toBe('Samsung A52');
  });

  it('parses JSON Lines (NDJSON)', () => {
    const jsonl = `{"mobile":"9033807401","user_id":"u1"}
{"mobile":"9820192831","user_id":"u2"}`;

    const result = parseRawFileContent('lines.jsonl', jsonl, jsonl.length);
    expect(result.total_records).toBe(2);
    expect(result.valid_records).toBe(2);
  });

  it('detects duplicate mobile numbers within a single file', () => {
    const raw = JSON.stringify([
      { mobile: '9033807401', user_id: 'u1' },
      { mobile: '9033807401', user_id: 'u1_dup' },
    ]);
    const result = parseRawFileContent('dups.json', raw, raw.length);
    expect(result.total_records).toBe(2);
    expect(result.duplicates_in_file).toBe(1);
    expect(result.records[1].is_duplicate_in_batch).toBe(true);
  });

  it('detects conflicting identities in multi-file batch and against database', () => {
    const file1 = parseRawFileContent(
      'file1.json',
      JSON.stringify([{ mobile: '9033807401', user_id: 'usr_orig' }])
    );
    const file2 = parseRawFileContent(
      'file2.json',
      JSON.stringify([{ mobile: '9033807401', user_id: 'usr_different_identity' }])
    );

    const dbExisting = [
      { phone_normalized: '+919820192831', account_json: { user_id: 'usr_db_existing' } },
    ];

    const stats = analyzeBatchRecords([file1, file2], dbExisting);
    expect(stats.batchDuplicates).toBe(1);
    expect(stats.conflicts).toBe(1);
    expect(file2.records[0].has_conflict).toBe(true);
  });
});
