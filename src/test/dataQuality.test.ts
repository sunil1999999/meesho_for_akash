import { describe, it, expect } from 'vitest';
import { runDataQualityAudit } from '../lib/dataQualityEngine';
import { AccountRecord, OrderRecord } from '../types';

describe('Data Quality Audit Engine', () => {
  it('detects invalid mobile numbers and duplicates in accounts', () => {
    const accounts: AccountRecord[] = [
      {
        id: 'acc_1',
        phone_normalized: '+919033807401',
        phone_display: '+91 90338 07401',
        account_json: { mobile: '9033807401', user_id: 'u1' },
        record_status: 'active',
        tags: [],
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'acc_2',
        phone_normalized: '+919033807401', // duplicate
        phone_display: '+91 90338 07401',
        account_json: { mobile: '9033807401', user_id: 'u2' },
        record_status: 'active',
        tags: [],
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'acc_3',
        phone_normalized: 'invalid_number',
        phone_display: 'invalid_number',
        account_json: { user_id: 'u3' },
        record_status: 'invalid',
        tags: [],
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const issues = runDataQualityAudit(accounts, []);
    const dupIssues = issues.filter(i => i.rule_code === 'ACC_DUPLICATE_PHONE');
    const invalidPhoneIssues = issues.filter(i => i.rule_code === 'ACC_INVALID_PHONE');

    expect(dupIssues.length).toBeGreaterThan(0);
    expect(invalidPhoneIssues.length).toBeGreaterThan(0);
  });

  it('detects orphaned orders and refund amount inconsistencies', () => {
    const accounts: AccountRecord[] = [
      {
        id: 'acc_valid',
        phone_normalized: '+919033807401',
        phone_display: '+91 90338 07401',
        account_json: { user_id: 'u1', mobile: '9033807401' },
        record_status: 'active',
        tags: [],
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const orders: OrderRecord[] = [
      {
        id: 'ord_orphan',
        account_id: 'acc_non_existent',
        product_name: 'Kurti',
        order_amount: 500,
        quantity: 1,
        payment_status: 'paid',
        delivery_status: 'delivered',
        cancellation_status: 'none',
        return_status: 'none',
        refund_status: 'none',
        order_date: new Date().toISOString(),
        data_source: 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'ord_refund_inconsistent',
        account_id: 'acc_valid',
        product_name: 'Saree',
        order_amount: 1000,
        quantity: 1,
        payment_status: 'paid',
        delivery_status: 'returned',
        cancellation_status: 'none',
        return_status: 'returned',
        refund_status: 'refunded',
        refund_amount: 0, // inconsistency: marked refunded with 0 amount
        order_date: new Date().toISOString(),
        data_source: 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const issues = runDataQualityAudit(accounts, orders);
    const orphanIssues = issues.filter(i => i.rule_code === 'ORD_ORPHANED');
    const refundIssues = issues.filter(i => i.rule_code === 'ORD_REFUND_INCONSISTENCY');

    expect(orphanIssues.length).toBe(1);
    expect(refundIssues.length).toBe(1);
  });
});
