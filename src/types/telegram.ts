/**
 * Telegram Bot Integration Types for @primes_meesho_bot
 * 
 * Strict workflow state machine:
 * READY → BOT_OPENED → SESSION_INPUT_REQUESTED → JSON_SENT → SAVE_CONFIRMED
 * → BOT_RESTARTED → SHOP_OPENED → ORDERS_OPENED → DATA_EXTRACTED → DATA_SAVED
 */

export type TelegramWorkflowState =
  | 'READY'
  | 'BOT_OPENED'
  | 'SESSION_INPUT_REQUESTED'
  | 'JSON_SENT'
  | 'SAVE_CONFIRMED'
  | 'BOT_RESTARTED'
  | 'SHOP_OPENED'
  | 'ORDERS_OPENED'
  | 'DATA_EXTRACTED'
  | 'DATA_SAVED'
  | 'FAILED'
  | 'CANCELLED';

export interface TelegramStepLog {
  state: TelegramWorkflowState;
  timestamp: string;
  message: string;
  details?: string;
  isError?: boolean;
}

export interface ExtractedOrderData {
  external_order_id: string;
  product_name: string;
  sku?: string;
  order_date: string;
  quantity: number;
  order_amount: number;
  payment_status: 'paid' | 'pending' | 'cod' | 'failed' | 'refunded' | 'partially_refunded';
  shipment_status?: string;
  delivery_status: 'placed' | 'confirmed' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'returned' | 'rto';
  cancellation_status: 'none' | 'requested' | 'cancelled' | 'rejected';
  return_status: 'none' | 'requested' | 'in_progress' | 'returned' | 'rejected';
  refund_status: 'none' | 'pending' | 'processing' | 'refunded' | 'failed' | 'disputed';
  refund_amount?: number;
  refund_reference?: string;
  tracking_id?: string;
  raw_message_snippet?: string;
}

export interface TelegramWorkflowReport {
  account_id: string;
  mobile_number: string;
  session_submission_status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'EXCEEDED_MAX_LENGTH';
  saved_confirmation_detected: boolean;
  open_shop_result: 'SUCCESS' | 'FAILED' | 'NOT_REACHED';
  orders_page_result: 'SUCCESS' | 'FAILED' | 'NOT_REACHED';
  total_orders_extracted: number;
  new_orders_count: number;
  updated_orders_count: number;
  duplicate_orders_skipped: number;
  records_requiring_review: number;
  extracted_orders: ExtractedOrderData[];
  error_summary?: string;
  completed_at: string;
  state_history: TelegramStepLog[];
}

export interface TelegramBotConfig {
  bot_username: string; // e.g. '@primes_meesho_bot'
  account_id: string;
  mobile_number: string;
  session_json: Record<string, any>;
  authorized: boolean;
  operator_id?: string;
  stepDelayMs?: number;
}
