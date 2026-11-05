import { describe, it, expect } from 'vitest';
import {
  sanitizeAccountJsonForSafeCopy,
  triggerFileDownload,
  exportDirectCheckoutAccountsJson,
  exportOrdersCsv,
  exportDeliverySheetCsv,
  exportTodaysOrdersDeliverySheet,
  exportTodaysOrdersPlacedSheet,
  exportTodaysDeliveredOrdersSheet,
  isSameDayAsToday,
  getOrderDeliveryDate,
  getAppTimezone,
  setAppTimezone,
  getTodayBoundariesInTimezone,
} from '../lib/exportUtils';

describe('Export and Copy Utilities & Strict No-Archive Enforcement', () => {
  it('masks sensitive authentication and hardware tokens in safe copy mode', () => {
    const raw = {
      mobile: '9033807401',
      user_id: 'usr_meesho_100',
      xo: 'super_secret_auth_token_99',
      ox: 'refresh_token_88',
      instance_id: 'android_hardware_device_1',
      gaid: '38400000-8cf0-11bd-b23e-10b96e40000d',
      profile: {
        name: 'Rajesh',
      },
    };

    const sanitized = sanitizeAccountJsonForSafeCopy(raw);

    // Business identifiers preserved
    expect(sanitized.mobile).toBe('9033807401');
    expect(sanitized.user_id).toBe('usr_meesho_100');
    expect(sanitized.profile.name).toBe('Rajesh');

    // Sensitive keys masked
    expect(sanitized.xo).toBe('[REDACTED_SENSITIVE_VALUE]');
    expect(sanitized.ox).toBe('[REDACTED_SENSITIVE_VALUE]');
    expect(sanitized.instance_id).toBe('[REDACTED_SENSITIVE_VALUE]');
    expect(sanitized.gaid).toBe('[REDACTED_SENSITIVE_VALUE]');
  });

  it('strictly throws an exception if any archive (ZIP, RAR, TAR) is requested', () => {
    expect(() => {
      triggerFileDownload('data', 'accounts.zip');
    }).toThrow('Security policy violation: Archive files (ZIP/TAR/RAR) are strictly prohibited.');

    expect(() => {
      triggerFileDownload('data', 'accounts.tar.gz');
    }).toThrow();

    expect(() => {
      triggerFileDownload('data', 'accounts.rar');
    }).toThrow();
  });

  it('exports direct checkout accounts json with pure raw payload or metadata', () => {
    let capturedFilename = '';

    const origDoc = (globalThis as any).document;
    const origBlob = (globalThis as any).Blob;
    const origURL = (globalThis as any).URL;

    const mockAnchor = {
      href: '',
      download: '',
      click: function () {
        capturedFilename = this.download;
      },
    };

    (globalThis as any).document = {
      createElement: (tag: string) => (tag === 'a' ? mockAnchor : {}),
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
    };
    (globalThis as any).Blob = class MockBlob {
      constructor(public content: any[], public options: any) {}
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {},
    };

    try {
      const accounts = [
        {
          id: 101,
          mobile: '9876543210',
          account_json: { mobile: '9876543210', xo: 'token_123', user_id: 555 },
        },
      ];

      exportDirectCheckoutAccountsJson(accounts);
      expect(capturedFilename).toContain('direct_checkout_accounts_');
      expect(capturedFilename).toMatch(/\.json$/);
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).Blob = origBlob;
      (globalThis as any).URL = origURL;
    }
  });

  it('exports todays ordered accounts delivery sheet without creating archives', () => {
    let capturedFilename = '';
    let capturedContent = '';

    const origDoc = (globalThis as any).document;
    const origBlob = (globalThis as any).Blob;
    const origURL = (globalThis as any).URL;

    const mockAnchor = {
      href: '',
      download: '',
      click: function () {
        capturedFilename = this.download;
      },
    };

    (globalThis as any).document = {
      createElement: (tag: string) => (tag === 'a' ? mockAnchor : {}),
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    (globalThis as any).Blob = class MockBlob {
      constructor(public content: any[]) {
        capturedContent = content.join('');
      }
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {},
    };

    try {
      const orders = [
        {
          id: 'ord_123',
          external_order_id: '7102948192',
          product_name: 'Bajaj Almond Drops Hair Oil, 190ml',
          quantity: 1,
          order_amount: 79,
          payment_status: 'paid',
          delivery_status: 'placed',
          order_date: new Date().toISOString(),
          account_id: 'acc_101',
          account_phone: '+91 72309 86965',
          notes: 'Near Chamunda bridge, Ahmedabad',
        },
      ];

      const count = exportTodaysOrdersDeliverySheet(orders as any);
      expect(count).toBe(1);
      expect(capturedFilename).toContain('todays_ordered_accounts_delivery_sheet_');
      expect(capturedFilename).toMatch(/\.csv$/);
      expect(capturedContent).toContain('7102948192');
      expect(capturedContent).toContain('Bajaj Almond Drops');
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).Blob = origBlob;
      (globalThis as any).URL = origURL;
    }
  });

  it("Option A: exports all orders placed today regardless of delivery status", () => {
    let capturedFilename = '';
    let capturedContent = '';

    const origDoc = (globalThis as any).document;
    const origBlob = (globalThis as any).Blob;
    const origURL = (globalThis as any).URL;

    const mockAnchor = {
      href: '',
      download: '',
      click: function () {
        capturedFilename = this.download;
      },
    };

    (globalThis as any).document = {
      createElement: (tag: string) => (tag === 'a' ? mockAnchor : {}),
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    (globalThis as any).Blob = class MockBlob {
      constructor(public content: any[]) {
        capturedContent = content.join('');
      }
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {},
    };

    try {
      const now = new Date().toISOString();
      const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();

      const orders = [
        // 1. Placed today, status 'placed' -> should be included
        {
          id: 'ord_placed_today',
          external_order_id: 'EXT-101',
          product_name: 'Product Placed Today',
          delivery_status: 'placed',
          order_date: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 2. Placed today, status 'cancelled' -> should be included
        {
          id: 'ord_cancelled_today',
          external_order_id: 'EXT-102',
          product_name: 'Product Cancelled Today',
          delivery_status: 'cancelled',
          order_date: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 3. Placed today, status 'delivered' -> should be included
        {
          id: 'ord_delivered_today',
          external_order_id: 'EXT-103',
          product_name: 'Product Delivered Today',
          delivery_status: 'delivered',
          order_date: now,
          terminal_confirmed_at: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 4. Placed yesterday, status 'delivered' today -> should be EXCLUDED from Option A (since placed yesterday)
        {
          id: 'ord_placed_yesterday',
          external_order_id: 'EXT-104',
          product_name: 'Product Placed Yesterday',
          delivery_status: 'delivered',
          order_date: yesterday,
          terminal_confirmed_at: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
      ];

      const count = exportTodaysOrdersPlacedSheet(orders as any);
      expect(count).toBe(3);
      expect(capturedFilename).toContain('todays_orders_placed_sheet_');
      expect(capturedFilename).toMatch(/\.csv$/);
      expect(capturedContent).toContain('EXT-101');
      expect(capturedContent).toContain('EXT-102');
      expect(capturedContent).toContain('EXT-103');
      expect(capturedContent).not.toContain('EXT-104');
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).Blob = origBlob;
      (globalThis as any).URL = origURL;
    }
  });

  it("Option B: exports only orders whose delivery status changed to Delivered today (Requirement 1 & 5)", () => {
    let capturedFilename = '';
    let capturedContent = '';

    const origDoc = (globalThis as any).document;
    const origBlob = (globalThis as any).Blob;
    const origURL = (globalThis as any).URL;

    const mockAnchor = {
      href: '',
      download: '',
      click: function () {
        capturedFilename = this.download;
      },
    };

    (globalThis as any).document = {
      createElement: (tag: string) => (tag === 'a' ? mockAnchor : {}),
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    (globalThis as any).Blob = class MockBlob {
      constructor(public content: any[]) {
        capturedContent = content.join('');
      }
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {},
    };

    try {
      const now = new Date().toISOString();
      const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();

      const orders = [
        // 1. Placed yesterday and delivered TODAY -> MUST BE INCLUDED (Req 5.1)
        {
          id: 'ord_placed_yesterday_deliv_today',
          external_order_id: 'TEST-YEST-DELIV-TODAY',
          product_name: 'Placed Yesterday Delivered Today',
          delivery_status: 'delivered',
          order_date: yesterday,
          delivered_at: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 2. Placed several days ago (5 days ago) but delivered TODAY -> MUST BE INCLUDED (Req 5.4)
        {
          id: 'ord_placed_5d_deliv_today',
          external_order_id: 'TEST-5D-DELIV-TODAY',
          product_name: 'Placed 5 Days Ago Delivered Today',
          delivery_status: 'delivered',
          order_date: fiveDaysAgo,
          delivered_at: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 3. Placed today but still pending/placed -> MUST BE EXCLUDED (Req 5.2)
        {
          id: 'ord_placed_today_pending',
          external_order_id: 'TEST-PLACED-TODAY-PENDING',
          product_name: 'Placed Today Still Pending',
          delivery_status: 'placed',
          order_date: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 4. Delivered yesterday (even if placed today/yesterday) -> MUST BE EXCLUDED (Req 5.3)
        {
          id: 'ord_delivered_yesterday',
          external_order_id: 'TEST-DELIV-YESTERDAY',
          product_name: 'Delivered Yesterday',
          delivery_status: 'delivered',
          order_date: yesterday,
          delivered_at: yesterday,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 5. Placed today, but delivered yesterday -> MUST BE EXCLUDED
        {
          id: 'ord_placed_today_deliv_yesterday',
          external_order_id: 'TEST-PLACED-TODAY-DELIV-YEST',
          product_name: 'Order Placed Today But Delivered Yesterday',
          delivery_status: 'delivered',
          order_date: now,
          delivered_at: yesterday,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 6. Cancelled or returned orders -> MUST BE EXCLUDED
        {
          id: 'ord_cancelled_order',
          external_order_id: 'TEST-CANCELLED',
          product_name: 'Cancelled Order',
          delivery_status: 'cancelled',
          order_date: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
        // 7. Delivered order lacking dedicated delivery timestamp (only order_date: today) -> MUST BE EXCLUDED (Req 2)
        {
          id: 'ord_delivered_no_timestamp',
          external_order_id: 'TEST-DELIV-NO-TIMESTAMP',
          product_name: 'Delivered Without Timestamp',
          delivery_status: 'delivered',
          order_date: now,
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
        },
      ];

      // First export
      const count1 = exportTodaysDeliveredOrdersSheet(orders as any);
      expect(count1).toBe(2);
      expect(capturedFilename).toContain('todays_delivered_orders_sheet_');
      expect(capturedFilename).toMatch(/\.csv$/);

      // Verify inclusions
      expect(capturedContent).toContain('TEST-YEST-DELIV-TODAY');
      expect(capturedContent).toContain('TEST-5D-DELIV-TODAY');

      // Verify exclusions
      expect(capturedContent).not.toContain('TEST-PLACED-TODAY-PENDING');
      expect(capturedContent).not.toContain('TEST-DELIV-YESTERDAY');
      expect(capturedContent).not.toContain('TEST-PLACED-TODAY-DELIV-YEST');
      expect(capturedContent).not.toContain('TEST-CANCELLED');
      expect(capturedContent).not.toContain('TEST-DELIV-NO-TIMESTAMP');

      // Req 5.5: Re-exporting today's sheet must produce consistent results without duplicating orders
      const duplicateList = [...orders, orders[0], orders[1]];
      const count2 = exportTodaysDeliveredOrdersSheet(duplicateList as any);
      expect(count2).toBe(2); // Deduplication prevents duplicates
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).Blob = origBlob;
      (globalThis as any).URL = origURL;
    }
  });

  it('Requirement 2: getOrderDeliveryDate strictly uses dedicated timestamp and never substitutes order_date/created_at', () => {
    // 1. Non-delivered status returns undefined
    expect(getOrderDeliveryDate({
      delivery_status: 'placed',
      delivered_at: '2026-10-16T10:00:00Z',
    } as any)).toBeUndefined();

    // 2. Uses delivered_at when present
    expect(getOrderDeliveryDate({
      delivery_status: 'delivered',
      delivered_at: '2026-10-16T12:00:00Z',
      created_at: '2026-10-10T10:00:00Z',
      order_date: '2026-10-10T10:00:00Z',
    } as any)).toBe('2026-10-16T12:00:00Z');

    // 3. Uses delivery_status_changed_at when delivered_at is not present
    expect(getOrderDeliveryDate({
      delivery_status: 'delivered',
      delivery_status_changed_at: '2026-10-16T11:00:00Z',
      created_at: '2026-10-10T10:00:00Z',
      order_date: '2026-10-10T10:00:00Z',
    } as any)).toBe('2026-10-16T11:00:00Z');

    // 4. Uses terminal_confirmed_at as fallback for delivered status
    expect(getOrderDeliveryDate({
      delivery_status: 'delivered',
      terminal_confirmed_at: '2026-10-16T09:00:00Z',
      created_at: '2026-10-10T10:00:00Z',
      order_date: '2026-10-10T10:00:00Z',
    } as any)).toBe('2026-10-16T09:00:00Z');

    // 5. Strictly returns undefined when no delivery timestamp exists, even if order_date or created_at exists
    expect(getOrderDeliveryDate({
      delivery_status: 'delivered',
      order_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)).toBeUndefined();
  });

  it('Requirement 3: correctly handles configured timezone and midnight boundaries without leaking previous-day deliveries', () => {
    const tz = 'Asia/Kolkata'; // UTC+05:30
    const fixedNow = new Date('2026-10-16T12:00:00.000Z'); // 17:30 IST on Oct 16
    const boundaries = getTodayBoundariesInTimezone(tz, fixedNow);

    expect(boundaries.todayDateStr).toBe('2026-10-16');
    // Start of day in Kolkata (00:00:00 IST) is 18:30:00 UTC on Oct 15
    expect(boundaries.startOfDay.toISOString()).toBe('2026-10-15T18:30:00.000Z');
    // End of day in Kolkata (23:59:59.999 IST) is 18:29:59.999 UTC on Oct 16
    expect(boundaries.endOfDay.toISOString()).toBe('2026-10-16T18:29:59.999Z');

    // Edge 1: 1 second before midnight yesterday (23:59:59 on Oct 15 IST) -> EXCLUDED
    const justBeforeMidnightYesterday = new Date('2026-10-15T18:29:59.000Z').toISOString();
    expect(isSameDayAsToday(justBeforeMidnightYesterday, tz, fixedNow)).toBe(false);

    // Edge 2: Exact start of day (00:00:00 on Oct 16 IST) -> INCLUDED
    const exactMidnightToday = new Date('2026-10-15T18:30:00.000Z').toISOString();
    expect(isSameDayAsToday(exactMidnightToday, tz, fixedNow)).toBe(true);

    // Edge 3: 1 second after midnight today (00:00:01 on Oct 16 IST) -> INCLUDED
    const justAfterMidnightToday = new Date('2026-10-15T18:30:01.000Z').toISOString();
    expect(isSameDayAsToday(justAfterMidnightToday, tz, fixedNow)).toBe(true);

    // Edge 4: 1 second before midnight end of today (23:59:59 on Oct 16 IST) -> INCLUDED
    const justBeforeEndOfToday = new Date('2026-10-16T18:29:59.000Z').toISOString();
    expect(isSameDayAsToday(justBeforeEndOfToday, tz, fixedNow)).toBe(true);

    // Edge 5: Exact start of tomorrow (00:00:00 on Oct 17 IST) -> EXCLUDED
    const midnightTomorrow = new Date('2026-10-16T18:30:00.000Z').toISOString();
    expect(isSameDayAsToday(midnightTomorrow, tz, fixedNow)).toBe(false);

    // Date strings
    expect(isSameDayAsToday('2026-10-16', tz, fixedNow)).toBe(true);
    expect(isSameDayAsToday('2026-10-15', tz, fixedNow)).toBe(false);
  });

  it('correctly configures application timezone', () => {
    expect(getAppTimezone()).toBe('Asia/Kolkata');
    setAppTimezone('UTC');
    expect(getAppTimezone()).toBe('UTC');
    setAppTimezone('Asia/Kolkata');
    expect(getAppTimezone()).toBe('Asia/Kolkata');
    expect(() => setAppTimezone('Invalid/Timezone_Name')).toThrow();
  });

  it('correctly validates isSameDayAsToday for today vs older timestamps', () => {
    expect(isSameDayAsToday(new Date().toISOString())).toBe(true);
    expect(isSameDayAsToday(new Date())).toBe(true);
    expect(isSameDayAsToday(new Date(Date.now() - 3 * 86400000).toISOString())).toBe(false);
    expect(isSameDayAsToday(null)).toBe(false);
    expect(isSameDayAsToday(undefined)).toBe(false);
    expect(isSameDayAsToday('invalid-date')).toBe(false);
  });

  it('includes Tracking ID and Tracking Status columns in exportOrdersCsv', () => {
    let capturedCsv = '';
    const origTrigger = (globalThis as any).document;

    const mockAnchor = {
      href: '',
      download: '',
      click: function () {},
    };
    (globalThis as any).document = {
      createElement: () => mockAnchor,
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    (globalThis as any).Blob = class MockBlob {
      constructor(public content: any[]) {
        capturedCsv = content.join('');
      }
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: () => {},
    };

    try {
      const orders = [
        {
          id: 'ord_1',
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
          external_order_id: 'EXT-001',
          tracking_id: 'FMPC002910823',
          product_name: 'Cotton Kurti',
          sku: 'KRT-01',
          order_amount: 599,
          quantity: 1,
          payment_status: 'paid' as const,
          delivery_status: 'shipped' as const,
          cancellation_status: 'none' as const,
          return_status: 'none' as const,
          refund_status: 'none' as const,
          order_date: '2026-10-16T10:00:00Z',
          data_source: 'manual' as const,
          created_at: '2026-10-16T10:00:00Z',
          updated_at: '2026-10-16T10:00:00Z',
        },
        {
          id: 'ord_2',
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
          external_order_id: 'EXT-002',
          // No tracking ID
          product_name: 'Bedsheet',
          order_amount: 399,
          quantity: 1,
          payment_status: 'paid' as const,
          delivery_status: 'placed' as const,
          cancellation_status: 'none' as const,
          return_status: 'none' as const,
          refund_status: 'none' as const,
          order_date: '2026-10-16T10:00:00Z',
          data_source: 'manual' as const,
          created_at: '2026-10-16T10:00:00Z',
          updated_at: '2026-10-16T10:00:00Z',
        },
      ];

      exportOrdersCsv(orders);

      const lines = capturedCsv.split('\n');
      const headerLine = lines[0];
      expect(headerLine).toContain('Tracking ID');
      expect(headerLine).toContain('Tracking Status');

      // Order with tracking ID
      expect(lines[1]).toContain('"FMPC002910823"');
      expect(lines[1]).toContain('"Tracking ID Assigned"');

      // Order without tracking ID: leaves field blank
      expect(lines[2]).toContain('""');
      expect(lines[2]).toContain('"Not Assigned"');
    } finally {
      (globalThis as any).document = origTrigger;
    }
  });

  it('includes Tracking ID and Tracking Status columns in exportDeliverySheetCsv and today sheets', () => {
    let capturedCsv = '';
    const origTrigger = (globalThis as any).document;

    const mockAnchor = {
      href: '',
      download: '',
      click: function () {},
    };
    (globalThis as any).document = {
      createElement: () => mockAnchor,
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    (globalThis as any).Blob = class MockBlob {
      constructor(public content: any[]) {
        capturedCsv = content.join('');
      }
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: () => {},
    };

    try {
      const orders = [
        {
          id: 'ord_deliv_1',
          account_id: 'acc_1',
          account_phone: '+91 90338 07401',
          external_order_id: 'DELIV-001',
          tracking_id: 'SF10928192',
          product_name: 'Saree',
          order_amount: 899,
          quantity: 1,
          payment_status: 'paid' as const,
          delivery_status: 'delivered' as const,
          delivered_at: '2026-10-16T08:00:00Z',
          delivery_status_changed_at: '2026-10-16T08:00:00Z',
          cancellation_status: 'none' as const,
          return_status: 'none' as const,
          refund_status: 'none' as const,
          order_date: '2026-10-10T10:00:00Z', // placed days ago, delivered today
          data_source: 'verified_api' as const,
          created_at: '2026-10-10T10:00:00Z',
          updated_at: '2026-10-16T08:00:00Z',
        },
      ];

      exportTodaysDeliveredOrdersSheet(orders, [], 'Asia/Kolkata', new Date('2026-10-16T12:00:00+05:30'));

      const lines = capturedCsv.split('\n');
      const headerLine = lines[0];
      expect(headerLine).toContain('Tracking ID');
      expect(headerLine).toContain('Tracking Status');
      expect(lines[1]).toContain('"SF10928192"');
      expect(lines[1]).toContain('"Tracking ID Assigned"');
    } finally {
      (globalThis as any).document = origTrigger;
    }
  });
});

