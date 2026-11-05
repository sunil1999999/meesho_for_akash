/**
 * Data Quality Engine for Meesho Management Dashboard
 * 
 * Performs automated and on-demand validation checks across:
 * - Accounts (phone format, uniqueness, JSON integrity, nested identity)
 * - Orders (amounts, dates, references, account links, status consistency)
 */

import { AccountRecord, OrderRecord, DataQualityIssue } from '../types';
import { normalizePhoneNumber } from './phoneUtils';

export function runDataQualityAudit(
  accounts: AccountRecord[],
  orders: OrderRecord[]
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const seenPhones = new Map<string, string[]>(); // phone -> account IDs
  const accountIdSet = new Set<string>();

  // 1. Audit Accounts
  accounts.forEach(acc => {
    accountIdSet.add(acc.id);

    // Check phone validity
    const phoneRes = normalizePhoneNumber(acc.phone_normalized || acc.phone_display);
    if (!phoneRes.isValid) {
      issues.push({
        id: `dq_acc_phone_${acc.id}`,
        entity_type: 'account',
        entity_id: acc.id,
        phone_display: acc.phone_display,
        severity: 'critical',
        field_name: 'phone_normalized',
        rule_code: 'ACC_INVALID_PHONE',
        description: `Account has invalid phone number format: '${acc.phone_normalized}'`,
        suggested_correction: 'Normalize to valid 10-digit Indian mobile number (+91XXXXXXXXXX)',
        resolution_status: 'open',
        detected_at: new Date().toISOString(),
      });
    } else {
      // Track duplicates
      const list = seenPhones.get(phoneRes.normalized) || [];
      list.push(acc.id);
      seenPhones.set(phoneRes.normalized, list);
    }

    // Check JSON integrity
    if (!acc.account_json || typeof acc.account_json !== 'object' || Array.isArray(acc.account_json)) {
      issues.push({
        id: `dq_acc_json_${acc.id}`,
        entity_type: 'account',
        entity_id: acc.id,
        phone_display: acc.phone_display,
        severity: 'critical',
        field_name: 'account_json',
        rule_code: 'ACC_CORRUPT_JSON',
        description: 'Account JSON is not a valid non-null object',
        suggested_correction: 'Re-import record from source file or verify JSON structure',
        resolution_status: 'open',
        detected_at: new Date().toISOString(),
      });
    } else {
      // Check required identity properties
      const hasId = acc.account_json.user_id || acc.account_json.userId || acc.account_json.id || acc.account_json.identity;
      if (!hasId) {
        issues.push({
          id: `dq_acc_noid_${acc.id}`,
          entity_type: 'account',
          entity_id: acc.id,
          phone_display: acc.phone_display,
          severity: 'warning',
          field_name: 'user_id',
          rule_code: 'ACC_MISSING_USER_ID',
          description: 'Account JSON is missing a user_id or identity identifier property',
          suggested_correction: 'Review account details or reconcile with external user directory',
          resolution_status: 'open',
          detected_at: new Date().toISOString(),
        });
      }

      // Check empty values
      Object.entries(acc.account_json).forEach(([k, v]) => {
        if (v === '' || (Array.isArray(v) && v.length === 0)) {
          // Warning for empty vital fields
          if (['instance_id', 'identity', 'xo'].includes(k)) {
            issues.push({
              id: `dq_acc_empty_${acc.id}_${k}`,
              entity_type: 'account',
              entity_id: acc.id,
              phone_display: acc.phone_display,
              severity: 'info',
              field_name: k,
              rule_code: 'ACC_EMPTY_KEY',
              description: `Vital account property '${k}' is present but empty`,
              suggested_correction: 'Ensure device instance and tokens were fully populated during capture',
              resolution_status: 'open',
              detected_at: new Date().toISOString(),
            });
          }
        }
      });
    }
  });

  // Check duplicate phones
  seenPhones.forEach((ids, phone) => {
    if (ids.length > 1) {
      ids.forEach(id => {
        issues.push({
          id: `dq_acc_dup_${id}`,
          entity_type: 'account',
          entity_id: id,
          phone_display: phone,
          severity: 'critical',
          field_name: 'phone_normalized',
          rule_code: 'ACC_DUPLICATE_PHONE',
          description: `Duplicate normalized phone number found across ${ids.length} account records`,
          suggested_correction: 'Archive redundant record or merge via Duplicate Resolution workflow',
          resolution_status: 'open',
          detected_at: new Date().toISOString(),
        });
      });
    }
  });

  // 2. Audit Orders
  const seenOrderIds = new Set<string>();

  orders.forEach(ord => {
    // Check order link
    if (!accountIdSet.has(ord.account_id)) {
      issues.push({
        id: `dq_ord_orphan_${ord.id}`,
        entity_type: 'order',
        entity_id: ord.id,
        phone_display: ord.account_phone || 'Unlinked',
        severity: 'critical',
        field_name: 'account_id',
        rule_code: 'ORD_ORPHANED',
        description: `Order references non-existent account ID: ${ord.account_id}`,
        suggested_correction: 'Reassign order to a valid account or restore archived account',
        resolution_status: 'open',
        detected_at: new Date().toISOString(),
      });
    }

    // Check external order ID uniqueness
    if (ord.external_order_id) {
      if (seenOrderIds.has(ord.external_order_id)) {
        issues.push({
          id: `dq_ord_dup_ext_${ord.id}`,
          entity_type: 'order',
          entity_id: ord.id,
          phone_display: ord.account_phone,
          severity: 'warning',
          field_name: 'external_order_id',
          rule_code: 'ORD_DUPLICATE_EXT_ID',
          description: `Duplicate external order ID: '${ord.external_order_id}'`,
          suggested_correction: 'Verify if this is a split shipment or re-order',
          resolution_status: 'open',
          detected_at: new Date().toISOString(),
        });
      } else {
        seenOrderIds.add(ord.external_order_id);
      }
    }

    // Check amounts
    if (ord.order_amount <= 0) {
      issues.push({
        id: `dq_ord_amt_${ord.id}`,
        entity_type: 'order',
        entity_id: ord.id,
        phone_display: ord.account_phone,
        severity: 'warning',
        field_name: 'order_amount',
        rule_code: 'ORD_INVALID_AMOUNT',
        description: `Order amount is zero or negative: ₹${ord.order_amount}`,
        suggested_correction: 'Correct order monetary value to positive amount',
        resolution_status: 'open',
        detected_at: new Date().toISOString(),
      });
    }

    // Check refund consistency
    if (ord.refund_status === 'refunded' && (!ord.refund_amount || ord.refund_amount <= 0)) {
      issues.push({
        id: `dq_ord_refund_inconsistent_${ord.id}`,
        entity_type: 'order',
        entity_id: ord.id,
        phone_display: ord.account_phone,
        severity: 'critical',
        field_name: 'refund_amount',
        rule_code: 'ORD_REFUND_INCONSISTENCY',
        description: 'Order status is marked as refunded but refund amount is zero or missing',
        suggested_correction: 'Record verified refund amount and transaction reference',
        resolution_status: 'open',
        detected_at: new Date().toISOString(),
      });
    }
  });

  return issues;
}
