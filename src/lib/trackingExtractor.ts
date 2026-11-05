/**
 * Tracking ID Extraction & Utility System for Meesho Order Management
 * 
 * Supports automatic extraction of Tracking IDs, AWB numbers, and Waybills
 * from API responses, shipment objects, delivery details, and message text.
 */

// Placeholders that indicate tracking is not yet assigned
const INVALID_TRACKING_PLACEHOLDERS = new Set([
  '',
  'null',
  'undefined',
  'none',
  'n/a',
  'na',
  'not assigned',
  'not_assigned',
  'pending',
  'awaiting',
  'unassigned',
  '-',
  '--',
  'nil',
]);

/**
 * Validates whether a candidate string is a plausible tracking ID.
 */
function isValidTrackingCandidate(val: string): boolean {
  if (!val) return false;
  const clean = val.trim();
  if (clean.length < 5 || clean.length > 50) return false;
  if (INVALID_TRACKING_PLACEHOLDERS.has(clean.toLowerCase())) return false;
  // Must contain alphanumeric characters (at least some digits or letters)
  return /[A-Za-z0-9]/.test(clean);
}

/**
 * Patterns for extracting tracking IDs from free text / message snippets / notes.
 */
const TRACKING_TEXT_PATTERNS: RegExp[] = [
  // 1. Explicit labels: "Tracking ID: XYZ", "Shipment Tracking ID: XYZ", "Tracking No: XYZ", "AWB: XYZ", "Waybill: XYZ"
  /(?:shipment\s+tracking\s*(?:id|number|no|#)?|tracking\s*(?:id|number|no|code|ref|#)?|awb(?:\s*(?:no|number|code|#))?|waybill(?:\s*(?:no|number|code|#))?|docket(?:\s*(?:no|number|#))?|courier\s*(?:tracking|ref|id|no)?)\s*[:\-#=]\s*([A-Za-z0-9_-]{5,40})/i,

  // 2. Courier-specific known formats (Ekart, India Post SpeedPost, Shadowfax, etc.)
  /\b(FMPC[0-9A-Za-z]{6,16})\b/i,                  // Ekart FMPC
  /\b([A-Z]{2}\d{9}IN)\b/i,                        // India Post Speed Post (e.g. EM123456789IN)
  /\b(SF\d{9,14})\b/i,                             // Shadowfax SF...
  /\b(SHDF[0-9A-Za-z]{6,14})\b/i,                  // Shadowfax SHDF...
  /\b(DELHIVERY[0-9A-Za-z_-]{6,20})\b/i,          // Delhivery explicit
  /\b(XBEES[0-9A-Za-z]{6,16})\b/i,                 // Xpressbees explicit
];

/**
 * Common object keys that may contain tracking ID or AWB in API responses.
 */
const TRACKING_KEYS = [
  'tracking_id',
  'tracking_number',
  'trackingId',
  'trackingNumber',
  'awb',
  'awb_number',
  'awb_no',
  'awbNumber',
  'awbNo',
  'waybill',
  'waybill_number',
  'waybill_no',
  'waybillNumber',
  'docket_number',
  'docket_no',
  'docketNumber',
  'courier_tracking_id',
  'courier_tracking_number',
  'courier_ref',
  'shipment_tracking_id',
];

/**
 * Extracts a tracking ID from a string, object, API payload, or shipment detail.
 * Returns the normalized tracking ID or undefined if not found.
 */
export function extractTrackingId(input: any): string | undefined {
  if (input === null || input === undefined) return undefined;

  // 1. If input is a direct primitive (string or number)
  if (typeof input === 'string' || typeof input === 'number') {
    const str = String(input).trim();
    if (!str) return undefined;

    // Check if the string itself is a clean tracking ID (alphanumeric without spaces, reasonable length)
    if (/^[A-Za-z0-9_-]{5,40}$/.test(str)) {
      if (isValidTrackingCandidate(str)) {
        return str;
      }
    }

    // Try text regex patterns
    for (const pattern of TRACKING_TEXT_PATTERNS) {
      const match = str.match(pattern);
      if (match && match[1] && isValidTrackingCandidate(match[1])) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  // 2. If input is an object
  if (typeof input === 'object') {
    // Check direct known keys first
    for (const key of TRACKING_KEYS) {
      const val = input[key];
      if (val !== undefined && val !== null) {
        const extracted = extractTrackingId(val);
        if (extracted) return extracted;
      }
    }

    // Check nested common objects: shipment, delivery, delivery_details, tracking, courier, data, details
    const nestedContainers = ['shipment', 'delivery', 'delivery_details', 'tracking', 'courier', 'carrier', 'order_detail', 'details', 'data'];
    for (const container of nestedContainers) {
      if (input[container] && typeof input[container] === 'object') {
        const nestedResult = extractTrackingId(input[container]);
        if (nestedResult) return nestedResult;
      }
    }

    // Check free-text fields in the object (e.g. notes, status_text, raw_message_snippet, description)
    const textFields = ['notes', 'status_text', 'raw_message_snippet', 'description', 'message', 'comment'];
    for (const tf of textFields) {
      if (typeof input[tf] === 'string') {
        const extracted = extractTrackingId(input[tf]);
        if (extracted) return extracted;
      }
    }
  }

  return undefined;
}

/**
 * Returns human-readable tracking assignment status:
 * 'Tracking ID Assigned' if present, otherwise 'Not Assigned'.
 */
export function getTrackingStatus(trackingId?: string | null): 'Tracking ID Assigned' | 'Not Assigned' {
  if (trackingId && typeof trackingId === 'string' && isValidTrackingCandidate(trackingId)) {
    return 'Tracking ID Assigned';
  }
  return 'Not Assigned';
}

/**
 * Returns true if tracking ID is assigned and valid.
 */
export function isTrackingAssigned(trackingId?: string | null): boolean {
  return getTrackingStatus(trackingId) === 'Tracking ID Assigned';
}
