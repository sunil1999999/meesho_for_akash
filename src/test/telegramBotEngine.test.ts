import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateSessionPayload,
  parseBotOrderMessage,
  TelegramBotWorkflowRunner,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from '../lib/telegramBotEngine';
import { TelegramBotConfig } from '../types/telegram';
import { StorageService } from '../lib/storageAdapter';

describe('Telegram Bot Engine — validateSessionPayload', () => {
  it('accepts valid session payload within 4096 character limit', () => {
    const validSession = {
      phone: '+919033807401',
      session_id: 'sess_abc123',
      token: 'tok_live_89021',
      meesho_uid: '1092812',
    };

    const res = validateSessionPayload(validSession);
    expect(res.isValid).toBe(true);
    expect(res.charCount).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
    expect(res.serializedText).toBe(JSON.stringify(validSession));
    expect(res.error).toBeUndefined();
  });

  it('rejects null or non-object payloads', () => {
    // @ts-ignore
    const resNull = validateSessionPayload(null);
    expect(resNull.isValid).toBe(false);
    expect(resNull.error).toContain('non-null JSON object');

    // @ts-ignore
    const resString = validateSessionPayload('not-an-object');
    expect(resString.isValid).toBe(false);
  });

  it('strictly rejects payloads exceeding 4096 characters without truncating', () => {
    // Generate a payload that exceeds 4096 chars
    const largePayload: Record<string, any> = {
      phone: '+919033807401',
      auth_token: 'A'.repeat(4500),
      session_data: { meta: 'test' },
    };

    const res = validateSessionPayload(largePayload);
    expect(res.isValid).toBe(false);
    expect(res.charCount).toBeGreaterThan(TELEGRAM_MAX_MESSAGE_LENGTH);
    expect(res.error).toContain('exceeds Telegram maximum supported message length of 4096');
    // Ensure raw string is not silently truncated
    expect(res.serializedText.length).toBe(res.charCount);
  });
});

describe('Telegram Bot Engine — parseBotOrderMessage', () => {
  it('parses realistic text order stream from @primes_meesho_bot', () => {
    const rawBotMessage = `
Order ID: MSHO-ORD-88192
Item: Cotton Embroidered Kurti Set
Price: ₹899.00
Status: Delivered
Qty: 1
SKU: KRT-COT-BLU-L

Order ID: MSHO-ORD-99120
Item: Printed Georgette Saree
Price: ₹1,450.00
Status: Returned
Refund: Refunded
Ref: REF-UPI-992144
Qty: 2
    `;

    const orders = parseBotOrderMessage(rawBotMessage);
    expect(orders.length).toBe(2);

    // First order
    expect(orders[0].external_order_id).toBe('MSHO-ORD-88192');
    expect(orders[0].product_name).toContain('Cotton Embroidered Kurti');
    expect(orders[0].order_amount).toBe(899.00);
    expect(orders[0].delivery_status).toBe('delivered');
    expect(orders[0].quantity).toBe(1);
    expect(orders[0].sku).toBe('KRT-COT-BLU-L');
    expect(orders[0].refund_status).toBe('none');

    // Second order
    expect(orders[1].external_order_id).toBe('MSHO-ORD-99120');
    expect(orders[1].product_name).toContain('Printed Georgette Saree');
    expect(orders[1].order_amount).toBe(1450.00);
    expect(orders[1].delivery_status).toBe('returned');
    expect(orders[1].return_status).toBe('returned');
    expect(orders[1].refund_status).toBe('refunded');
    expect(orders[1].refund_reference).toBe('REF-UPI-992144');
    expect(orders[1].quantity).toBe(2);
  });

  it('handles empty or unrecognized messages safely', () => {
    expect(parseBotOrderMessage('')).toEqual([]);
    expect(parseBotOrderMessage('No active orders found in this account.')).toEqual([]);
  });
});

describe('Telegram Bot Engine — TelegramBotWorkflowRunner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageService, 'getOrders').mockResolvedValue([]);
    vi.spyOn(StorageService, 'createOrder').mockImplementation(async (ord: any) => ({
      ...ord,
      id: 'mock-order-id',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    vi.spyOn(StorageService, 'updateOrderStatus').mockResolvedValue({} as any);
  });

  it('fails if operator authorization is not granted', async () => {
    const config: TelegramBotConfig = {
      bot_username: '@primes_meesho_bot',
      account_id: 'acc-1',
      mobile_number: '+919033807401',
      session_json: { token: 'valid_tok' },
      authorized: false, // NOT authorized
    };

    const runner = new TelegramBotWorkflowRunner(config);
    const report = await runner.run();

    expect(report.session_submission_status).toBe('FAILED');
    expect(report.saved_confirmation_detected).toBe(false);
    expect(report.error_summary).toContain('authorization required');
  });

  it('fails if payload exceeds maximum length limit', async () => {
    const config: TelegramBotConfig = {
      bot_username: '@primes_meesho_bot',
      account_id: 'acc-1',
      mobile_number: '+919033807401',
      session_json: { massive_key: 'X'.repeat(5000) },
      authorized: true,
    };

    const runner = new TelegramBotWorkflowRunner(config);
    const report = await runner.run();

    expect(report.session_submission_status).toBe('EXCEEDED_MAX_LENGTH');
    expect(report.saved_confirmation_detected).toBe(false);
    expect(report.error_summary).toContain('exceeds Telegram maximum supported message length');
  });

  it('executes full sequence and reports truthful metrics', async () => {
    const config: TelegramBotConfig = {
      bot_username: '@primes_meesho_bot',
      account_id: 'acc-test-runner',
      mobile_number: '+919033807401',
      session_json: {
        token: 'sess_token_valid',
        uid: 'user_123',
      },
      authorized: true,
      stepDelayMs: 0,
    };

    const statesRecorded: string[] = [];
    const runner = new TelegramBotWorkflowRunner(config, (state) => {
      statesRecorded.push(state);
    });

    const report = await runner.run();

    // Verify state progression
    expect(statesRecorded).toContain('BOT_OPENED');
    expect(statesRecorded).toContain('SESSION_INPUT_REQUESTED');
    expect(statesRecorded).toContain('JSON_SENT');
    expect(statesRecorded).toContain('SAVE_CONFIRMED');
    expect(statesRecorded).toContain('BOT_RESTARTED');
    expect(statesRecorded).toContain('SHOP_OPENED');
    expect(statesRecorded).toContain('ORDERS_OPENED');
    expect(statesRecorded).toContain('DATA_EXTRACTED');
    expect(statesRecorded).toContain('DATA_SAVED');

    // Verify report structure
    expect(report.mobile_number).toBe('+919033807401');
    expect(report.session_submission_status).toBe('SUCCESS');
    expect(report.saved_confirmation_detected).toBe(true);
    expect(report.open_shop_result).toBe('SUCCESS');
    expect(report.orders_page_result).toBe('SUCCESS');
    expect(report.total_orders_extracted).toBeGreaterThan(0);
    expect(report.extracted_orders.length).toBe(report.total_orders_extracted);
    expect(report.completed_at).toBeDefined();
  });
});
