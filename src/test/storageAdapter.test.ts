import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {},
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-key',
  reconfigureSupabase: vi.fn(),
}));

import { StorageService } from '../lib/storageAdapter';

describe('Storage Adapter & State Management', () => {
  beforeEach(() => {
    // Reset caches
    (StorageService as any).ensureInitialized();
  });

  it('inserts an account with proper phone normalization and audit log', async () => {
    const acc = await StorageService.insertAccount({
      phone_normalized: '9033807401',
      phone_display: '',
      account_json: { mobile: '9033807401', user_id: 'test_usr' },
      record_status: 'active',
      tags: ['test'],
      is_archived: false,
    });

    expect(acc.phone_normalized).toBe('+919033807401');
    expect(acc.phone_display).toBe('+91 90338 07401');
    expect(acc.account_json.user_id).toBe('test_usr');

    const logs = await StorageService.getAuditLogs(5);
    expect(logs[0].action).toBe('CREATE_ACCOUNT');
  });

  it('archives accounts and can restore them via undo stack', async () => {
    const acc = await StorageService.insertAccount({
      phone_normalized: '9820192831',
      phone_display: '',
      account_json: { mobile: '9820192831' },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    const archiveCount = await StorageService.archiveAccounts([acc.id]);
    expect(archiveCount).toBe(1);

    const checkArchived = await StorageService.getAccountById(acc.id);
    expect(checkArchived?.is_archived).toBe(true);

    // Pop undo to revert archive
    const undoRes = await StorageService.popUndo();
    expect(undoRes.success).toBe(true);

    const checkRestored = await StorageService.getAccountById(acc.id);
    expect(checkRestored?.is_archived).toBe(false);
  });

  it('filters and searches accounts by mobile number only', async () => {
    const res = await StorageService.getAccounts({ search: '9033807401' });
    expect(res.accounts.length).toBeGreaterThan(0);
    expect(res.accounts[0].phone_normalized).toBe('+919033807401');
  });

  it('updates account to Sold (Permanently Excluded from Polling) and marks monitoring as sold_excluded', async () => {
    const acc = await StorageService.insertAccount({
      phone_normalized: '9712345678',
      phone_display: '',
      account_json: { mobile: '9712345678' },
      record_status: 'active',
      tags: ['batch_1'],
      is_archived: false,
    });

    const updated = await StorageService.updateAccount(acc.id, {
      record_status: 'sold',
      tags: ['batch_1', 'sold_account'],
      notes: 'Customer transferred ownership',
    });

    expect(updated).not.toBeNull();
    expect(updated?.record_status).toBe('sold');
    expect(updated?.monitoring_status).toBe('sold_excluded');
    expect(updated?.next_check_at).toBeUndefined();
    expect(updated?.tags).toEqual(['batch_1', 'sold_account']);
    expect(updated?.notes).toBe('Customer transferred ownership');
  });

  it('supports updating across all permitted record statuses', async () => {
    const acc = await StorageService.insertAccount({
      phone_normalized: '9723456789',
      phone_display: '',
      account_json: { mobile: '9723456789' },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    const statuses = ['review_required', 'conflict', 'invalid', 'archived', 'sold', 'active'] as const;
    for (const st of statuses) {
      const res = await StorageService.updateAccount(acc.id, { record_status: st });
      expect(res?.record_status).toBe(st);
      if (st === 'sold') {
        expect(res?.monitoring_status).toBe('sold_excluded');
      }
    }
  });

  it('creates order and allows searching by customer mobile number across statuses', async () => {
    // 1. Insert account
    const acc = await StorageService.insertAccount({
      phone_normalized: '9033807401',
      phone_display: '+91 90338 07401',
      account_json: { mobile: '9033807401' },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    // 2. Create orders across different statuses
    const ordPlaced = await StorageService.createOrder({
      account_id: acc.id,
      account_phone: acc.phone_display,
      external_order_id: 'ORD-TEST-01',
      product_name: 'Anarkali Kurti Red',
      quantity: 1,
      order_amount: 599,
      payment_status: 'paid',
      delivery_status: 'placed',
      cancellation_status: 'none',
      return_status: 'none',
      refund_status: 'none',
      order_date: new Date().toISOString(),
      data_source: 'manual',
    });

    const ordCancelled = await StorageService.createOrder({
      account_id: acc.id,
      account_phone: acc.phone_display,
      external_order_id: 'ORD-TEST-02',
      product_name: 'Saree Silk Blue',
      quantity: 1,
      order_amount: 1299,
      payment_status: 'paid',
      delivery_status: 'cancelled',
      cancellation_status: 'cancelled',
      return_status: 'none',
      refund_status: 'none',
      order_date: new Date().toISOString(),
      data_source: 'manual',
    });

    const ordDelivered = await StorageService.createOrder({
      account_id: acc.id,
      account_phone: acc.phone_display,
      external_order_id: 'ORD-TEST-03',
      product_name: 'Handbag Leather',
      quantity: 1,
      order_amount: 899,
      payment_status: 'paid',
      delivery_status: 'delivered',
      cancellation_status: 'none',
      return_status: 'none',
      refund_status: 'none',
      order_date: new Date().toISOString(),
      data_source: 'manual',
    });

    // Delivered order should have is_terminal and terminal_confirmed_at populated
    expect(ordDelivered.is_terminal).toBe(true);
    expect(ordDelivered.terminal_confirmed_at).toBeDefined();

    // 3. Search by complete 10-digit mobile number
    const resComplete = await StorageService.getOrders({ mobileSearch: '9033807401' });
    const idsComplete = resComplete.map(o => o.id);
    expect(idsComplete).toContain(ordPlaced.id);
    expect(idsComplete).toContain(ordCancelled.id);
    expect(idsComplete).toContain(ordDelivered.id);

    // 4. Search by partial mobile number (e.g. '90338')
    const resPartial = await StorageService.getOrders({ mobileSearch: '90338' });
    const idsPartial = resPartial.map(o => o.id);
    expect(idsPartial).toContain(ordPlaced.id);
    expect(idsPartial).toContain(ordCancelled.id);
    expect(idsPartial).toContain(ordDelivered.id);

    // 5. Search with +91 country code and spaces
    const resFormatted = await StorageService.getOrders({ mobileSearch: '+91 90338 07401' });
    const idsFormatted = resFormatted.map(o => o.id);
    expect(idsFormatted).toContain(ordPlaced.id);

    // 6. Search combined with deliveryStatus filter
    const resDeliveredOnly = await StorageService.getOrders({
      mobileSearch: '9033807401',
      deliveryStatus: 'delivered',
    });
    expect(resDeliveredOnly.some(o => o.id === ordDelivered.id)).toBe(true);
    expect(resDeliveredOnly.some(o => o.id === ordPlaced.id)).toBe(false);
    expect(resDeliveredOnly.some(o => o.id === ordCancelled.id)).toBe(false);

    // 7. Non-matching mobile number returns empty array
    const resNone = await StorageService.getOrders({ mobileSearch: '9999999999' });
    expect(resNone.length).toBe(0);

    // 8. Updating order status to 'delivered' sets delivered_at, delivery_status_changed_at, and terminal_confirmed_at
    const updated = await StorageService.updateOrderStatus(ordPlaced.id, 'delivered');
    expect(updated?.delivery_status).toBe('delivered');
    expect(updated?.is_terminal).toBe(true);
    expect(updated?.terminal_confirmed_at).toBeDefined();
    expect(updated?.delivered_at).toBeDefined();
    expect(updated?.delivery_status_changed_at).toBeDefined();

    const originalDeliveredAt = updated?.delivered_at;

    // 9. Subsequent updates (e.g. refund notes) must NEVER overwrite delivered_at
    const updatedAgain = await StorageService.updateOrderStatus(ordPlaced.id, 'delivered', 'pending', 'Customer requested return');
    expect(updatedAgain?.delivered_at).toBe(originalDeliveredAt);
  });

  it('manages Tracking ID extraction, persistence, safe preservation, and search', async () => {
    const acc = await StorageService.insertAccount({
      phone_normalized: '9654321098',
      phone_display: '',
      account_json: { mobile: '9654321098' },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    // 1. Create order with explicit tracking ID
    const ordWithTracking = await StorageService.createOrder({
      account_id: acc.id,
      account_phone: acc.phone_display,
      external_order_id: 'ORD-TRK-01',
      product_name: 'Cotton Bedsheet',
      quantity: 1,
      order_amount: 549,
      payment_status: 'paid',
      delivery_status: 'placed',
      cancellation_status: 'none',
      return_status: 'none',
      refund_status: 'none',
      tracking_id: 'FMPC002910823',
      order_date: new Date().toISOString(),
      data_source: 'manual',
    });

    expect(ordWithTracking.tracking_id).toBe('FMPC002910823');
    // Assigning tracking ID must NEVER mark order as shipped or delivered
    expect(ordWithTracking.delivery_status).toBe('placed');
    expect(ordWithTracking.is_terminal).toBeFalsy();

    // 2. Create order without tracking ID, then assign tracking ID later
    const ordNoTracking = await StorageService.createOrder({
      account_id: acc.id,
      account_phone: acc.phone_display,
      external_order_id: 'ORD-TRK-02',
      product_name: 'Silk Saree',
      quantity: 1,
      order_amount: 1499,
      payment_status: 'paid',
      delivery_status: 'placed',
      cancellation_status: 'none',
      return_status: 'none',
      refund_status: 'none',
      order_date: new Date().toISOString(),
      data_source: 'manual',
    });

    expect(ordNoTracking.tracking_id).toBeUndefined();

    // Assign tracking ID later via updateOrderTracking
    const assigned = await StorageService.updateOrderTracking(ordNoTracking.id, 'SF10928192');
    expect(assigned?.tracking_id).toBe('SF10928192');
    expect(assigned?.delivery_status).toBe('placed');

    // 3. Do not overwrite a valid tracking ID with an empty or null value during subsequent synchronization
    const syncUpdateNoTracking = await StorageService.updateOrderStatus(
      ordNoTracking.id,
      'shipped',
      undefined,
      'Dispatch confirmed',
      undefined // No tracking provided
    );
    expect(syncUpdateNoTracking?.tracking_id).toBe('SF10928192');
    expect(syncUpdateNoTracking?.delivery_status).toBe('shipped');

    // Also test invalid placeholder like "none" or ""
    const syncUpdatePlaceholder = await StorageService.updateOrderStatus(
      ordNoTracking.id,
      'shipped',
      undefined,
      'Another sync',
      'none'
    );
    expect(syncUpdatePlaceholder?.tracking_id).toBe('SF10928192');

    // 4. If tracking ID changes, update it using the latest verified value
    const updatedNewTracking = await StorageService.updateOrderStatus(
      ordNoTracking.id,
      'shipped',
      undefined,
      'Re-dispatched with new courier',
      'AWB991204812'
    );
    expect(updatedNewTracking?.tracking_id).toBe('AWB991204812');

    // 5. Search orders by tracking ID
    const searchResult1 = await StorageService.getOrders({ search: 'FMPC002910823' });
    expect(searchResult1.some(o => o.id === ordWithTracking.id)).toBe(true);

    const searchResult2 = await StorageService.getOrders({ search: 'AWB991204812' });
    expect(searchResult2.some(o => o.id === ordNoTracking.id)).toBe(true);
  });
});
