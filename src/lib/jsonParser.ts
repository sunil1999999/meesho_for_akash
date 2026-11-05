/**
 * Multi-Format JSON and TXT Parser for Meesho Management Dashboard
 * 
 * Supports:
 * - Single JSON object
 * - JSON Array of account objects
 * - Multiple consecutive pretty-printed or compact JSON objects in a TXT file
 * - JSONL / NDJSON (newline-delimited JSON)
 * 
 * Uses a robust character-level brace-matching state machine to cleanly
 * extract consecutive JSON objects without naive regex or splits.
 */

import { ParsedRecord, ImportFileResult } from '../types';
import { extractPhoneFromAccountJson, extractUserIdFromAccountJson } from './phoneUtils';

/**
 * Extracts multiple JSON objects from raw text by matching matching curly braces,
 * properly respecting string literals and escape sequences.
 */
export function extractConsecutiveJsonObjects(text: string): { jsonStrings: string[]; errors: string[] } {
  const jsonStrings: string[] = [];
  const errors: string[] = [];
  
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escapeNext = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const char = text[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        startIndex = i;
      }
      depth++;
    } else if (char === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && startIndex !== -1) {
          const jsonSub = text.substring(startIndex, i + 1).trim();
          if (jsonSub) {
            jsonStrings.push(jsonSub);
          }
          startIndex = -1;
        }
      } else {
        // Unexpected closing brace without opening
        errors.push(`Unexpected closing brace '}' at position ${i}`);
      }
    }
  }

  if (depth > 0 && startIndex !== -1) {
    errors.push(`Unclosed JSON object starting at position ${startIndex} (missing ${depth} closing brace(s))`);
  }

  return { jsonStrings, errors };
}

/**
 * Parses raw text from a file into a list of account records.
 */
export function parseRawFileContent(
  fileName: string,
  content: string,
  fileSize: number = 0
): ImportFileResult {
  const trimmed = content.trim();
  const records: ParsedRecord[] = [];
  const parseErrors: string[] = [];

  let fileType = 'unknown';
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.json')) {
    fileType = 'json';
  } else if (lowerName.endsWith('.jsonl') || lowerName.endsWith('.ndjson')) {
    fileType = 'jsonl';
  } else if (lowerName.endsWith('.txt')) {
    fileType = 'txt';
  }

  // Strategy 1: If file starts with '[', try standard JSON Array parse
  if (trimmed.startsWith('[')) {
    try {
      const parsedArray = JSON.parse(trimmed);
      if (Array.isArray(parsedArray)) {
        parsedArray.forEach((item, index) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const phoneRes = extractPhoneFromAccountJson(item);
            records.push({
              id: `rec_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`,
              source_file: fileName,
              record_index: index + 1,
              line_number: undefined,
              raw_json: item,
              normalized_phone: phoneRes.isValid ? phoneRes.normalized : null,
              display_phone: phoneRes.display,
              is_valid: phoneRes.isValid,
              error: phoneRes.error,
              extracted_user_id: extractUserIdFromAccountJson(item),
            });
          } else {
            records.push({
              id: `rec_${Date.now()}_${index}`,
              source_file: fileName,
              record_index: index + 1,
              raw_json: {},
              normalized_phone: null,
              display_phone: 'Invalid Entry',
              is_valid: false,
              error: 'Array entry is not a valid JSON object',
            });
          }
        });
        return buildFileResult(fileName, fileSize, fileType, records, parseErrors);
      }
    } catch {
      // If array parse failed, fall through to token extraction
    }
  }

  // Strategy 2: If single JSON object parse works directly
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const singleParsed = JSON.parse(trimmed);
      if (singleParsed && typeof singleParsed === 'object' && !Array.isArray(singleParsed)) {
        const phoneRes = extractPhoneFromAccountJson(singleParsed);
        records.push({
          id: `rec_${Date.now()}_0_${Math.random().toString(36).substring(2, 7)}`,
          source_file: fileName,
          record_index: 1,
          line_number: 1,
          raw_json: singleParsed,
          normalized_phone: phoneRes.isValid ? phoneRes.normalized : null,
          display_phone: phoneRes.display,
          is_valid: phoneRes.isValid,
          error: phoneRes.error,
          extracted_user_id: extractUserIdFromAccountJson(singleParsed),
        });
        return buildFileResult(fileName, fileSize, fileType, records, parseErrors);
      }
    } catch {
      // If single JSON object failed (e.g. multiple consecutive objects), fall through
    }
  }

  // Strategy 3: Check for JSON Lines (one JSON per line)
  if (fileType === 'jsonl' || trimmed.includes('\n')) {
    const lines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0);
    let allLinesAreJson = true;
    const lineRecords: ParsedRecord[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const phoneRes = extractPhoneFromAccountJson(parsed);
          lineRecords.push({
            id: `rec_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
            source_file: fileName,
            record_index: i + 1,
            line_number: i + 1,
            raw_json: parsed,
            normalized_phone: phoneRes.isValid ? phoneRes.normalized : null,
            display_phone: phoneRes.display,
            is_valid: phoneRes.isValid,
            error: phoneRes.error,
            extracted_user_id: extractUserIdFromAccountJson(parsed),
          });
        } else {
          allLinesAreJson = false;
          break;
        }
      } catch {
        allLinesAreJson = false;
        break;
      }
    }

    if (allLinesAreJson && lineRecords.length > 0) {
      return buildFileResult(fileName, fileSize, fileType, lineRecords, parseErrors);
    }
  }

  // Strategy 4: Robust streaming brace-matcher (handles multiple consecutive pretty-printed or compact JSONs in TXT/JSON)
  const { jsonStrings, errors } = extractConsecutiveJsonObjects(content);
  if (errors.length > 0) {
    parseErrors.push(...errors);
  }

  if (jsonStrings.length > 0) {
    jsonStrings.forEach((jsonStr, idx) => {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const phoneRes = extractPhoneFromAccountJson(parsed);
          records.push({
            id: `rec_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
            source_file: fileName,
            record_index: idx + 1,
            line_number: undefined,
            raw_json: parsed,
            normalized_phone: phoneRes.isValid ? phoneRes.normalized : null,
            display_phone: phoneRes.display,
            is_valid: phoneRes.isValid,
            error: phoneRes.error,
            extracted_user_id: extractUserIdFromAccountJson(parsed),
          });
        } else {
          records.push({
            id: `rec_${Date.now()}_${idx}`,
            source_file: fileName,
            record_index: idx + 1,
            raw_json: {},
            normalized_phone: null,
            display_phone: 'Invalid Object',
            is_valid: false,
            error: 'Extracted block is not a valid JSON object',
          });
        }
      } catch (err: any) {
        parseErrors.push(`Failed to parse extracted JSON block #${idx + 1}: ${err?.message || 'Syntax error'}`);
      }
    });
  } else {
    parseErrors.push(`No valid JSON objects detected in file '${fileName}'`);
  }

  return buildFileResult(fileName, fileSize, fileType, records, parseErrors);
}

/**
 * Helper to compute stats and flag duplicates within a single file
 */
function buildFileResult(
  fileName: string,
  fileSize: number,
  fileType: string,
  records: ParsedRecord[],
  parseErrors: string[]
): ImportFileResult {
  const seenPhones = new Set<string>();
  let duplicatesInFile = 0;
  let validCount = 0;
  let invalidCount = 0;

  records.forEach(rec => {
    if (rec.is_valid && rec.normalized_phone) {
      if (seenPhones.has(rec.normalized_phone)) {
        rec.is_duplicate_in_batch = true;
        duplicatesInFile++;
      } else {
        seenPhones.add(rec.normalized_phone);
      }
      validCount++;
    } else {
      invalidCount++;
    }
  });

  return {
    file_name: fileName,
    file_size: fileSize,
    file_type: fileType,
    records,
    total_records: records.length,
    valid_records: validCount,
    invalid_records: invalidCount,
    duplicates_in_file: duplicatesInFile,
    duplicates_in_db: 0,
    conflicts: 0,
    parse_errors: parseErrors,
  };
}

/**
 * Cross-file duplicate and conflict analysis across a multi-file batch,
 * also checking against existing records in the database.
 */
export function analyzeBatchRecords(
  fileResults: ImportFileResult[],
  existingRecords: Array<{ phone_normalized: string; account_json: any }>
): {
  batchDuplicates: number;
  dbDuplicates: number;
  conflicts: number;
  totalValid: number;
  totalInvalid: number;
} {
  const seenInBatch = new Map<string, { file: string; userId?: string }>();
  const existingMap = new Map<string, { userId?: string; json: any }>();

  existingRecords.forEach(rec => {
    existingMap.set(rec.phone_normalized, {
      userId: extractUserIdFromAccountJson(rec.account_json),
      json: rec.account_json,
    });
  });

  let batchDuplicates = 0;
  let dbDuplicates = 0;
  let conflicts = 0;
  let totalValid = 0;
  let totalInvalid = 0;

  fileResults.forEach(file => {
    file.records.forEach(rec => {
      if (!rec.is_valid || !rec.normalized_phone) {
        totalInvalid++;
        return;
      }

      totalValid++;
      const phone = rec.normalized_phone;

      // 1. Check if already seen in current batch
      if (seenInBatch.has(phone)) {
        rec.is_duplicate_in_batch = true;
        batchDuplicates++;
        const prev = seenInBatch.get(phone)!;
        if (rec.extracted_user_id && prev.userId && rec.extracted_user_id !== prev.userId) {
          rec.has_conflict = true;
          rec.conflict_details = `Different user ID in batch: '${rec.extracted_user_id}' vs '${prev.userId}' in ${prev.file}`;
          conflicts++;
        }
      } else {
        seenInBatch.set(phone, { file: file.file_name, userId: rec.extracted_user_id });
      }

      // 2. Check if exists in DB
      if (existingMap.has(phone)) {
        rec.is_duplicate_in_db = true;
        dbDuplicates++;
        const dbRec = existingMap.get(phone)!;
        if (rec.extracted_user_id && dbRec.userId && rec.extracted_user_id !== dbRec.userId) {
          rec.has_conflict = true;
          rec.conflict_details = `Conflicting identity with database: incoming user ID '${rec.extracted_user_id}' vs existing '${dbRec.userId}'`;
          conflicts++;
        }
      }
    });

    // Update file stats
    file.duplicates_in_db = file.records.filter(r => r.is_duplicate_in_db).length;
    file.conflicts = file.records.filter(r => r.has_conflict).length;
  });

  return {
    batchDuplicates,
    dbDuplicates,
    conflicts,
    totalValid,
    totalInvalid,
  };
}
