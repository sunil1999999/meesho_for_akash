export interface AccountRecord {
  id: string;
  phone_normalized: string; // E.164 e.g. +919033807401
  phone_display: string;    // Clean display e.g. +91 90338 07401
  account_json: Record<string, any>; // Complete preserved raw JSON
  record_status: 'active' | 'review_required' | 'conflict' | 'invalid' | 'archived' | 'sold';
  tags: string[];
  notes?: string;
  source_file?: string;
  import_job_id?: string;
  is_archived: boolean;
  archived_at?: string;
  archived_by?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  // Continuous Monitoring Fields
  last_checked_at?: string;
  next_check_at?: string;
  monitoring_status?: 'pending' | 'active' | 'no_orders_found' | 'has_orders' | 'attention_required' | 'error' | 'sold_excluded' | 'added_to_cart';
  requires_attention?: boolean;
  attention_reason?: string;
  consecutive_failures?: number;
  total_orders_discovered?: number;
}

export type OrderDeliveryStatus =
  | 'placed'
  | 'confirmed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'rto';

export type OrderPaymentStatus =
  | 'paid'
  | 'pending'
  | 'cod'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type OrderCancellationStatus =
  | 'none'
  | 'requested'
  | 'cancelled'
  | 'rejected';

export type OrderReturnStatus =
  | 'none'
  | 'requested'
  | 'in_progress'
  | 'returned'
  | 'rejected';

export type OrderRefundStatus =
  | 'none'
  | 'pending'
  | 'processing'
  | 'refunded'
  | 'failed'
  | 'disputed';

export interface OrderRecord {
  id: string;
  account_id: string;
  account_phone?: string;
  external_order_id?: string;
  product_name: string;
  sku?: string;
  order_date: string;
  quantity: number;
  order_amount: number;
  payment_status: OrderPaymentStatus;
  tracking_id?: string;
  shipment_status?: string;
  delivery_status: OrderDeliveryStatus;
  cancellation_status: OrderCancellationStatus;
  return_status: OrderReturnStatus;
  refund_status: OrderRefundStatus;
  refund_amount?: number;
  refund_reference?: string;
  return_reason?: string;
  last_verified_at?: string;
  next_follow_up_date?: string;
  data_source: 'import' | 'manual' | 'verified_api' | 'telegram_bot';
  notes?: string;
  created_at: string;
  updated_at: string;
  // Delivery status transition timestamps
  delivered_at?: string;
  delivery_status_changed_at?: string;
  // Terminal State & Continuous Monitoring
  is_terminal?: boolean;
  terminal_confirmed_at?: string;
  last_checked_at?: string;
  next_check_at?: string;
  monitoring_status?: 'monitoring' | 'terminal_delivered' | 'terminal_cancelled' | 'terminal_sold' | 'failed';
  check_count?: number;
  last_status_change_at?: string;
}

export interface WorkerHeartbeatRecord {
  id: string;
  status: 'running' | 'paused' | 'stopped' | 'starting' | 'error';
  last_heartbeat: string;
  current_cycle: number;
  accounts_processed: number;
  orders_discovered: number;
  terminal_orders_excluded: number;
  active_orders_polled: number;
  empty_orders_count: number;
  last_cycle_duration_sec: number;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  previous_status?: string;
  new_status: string;
  event_note?: string;
  event_source?: string;
  actor_id?: string;
  created_at: string;
}

export interface ParsedRecord {
  id: string;
  source_file: string;
  record_index: number;
  line_number?: number;
  raw_json: Record<string, any>;
  normalized_phone: string | null;
  display_phone: string;
  is_valid: boolean;
  error?: string;
  extracted_user_id?: string;
  is_duplicate_in_batch?: boolean;
  is_duplicate_in_db?: boolean;
  has_conflict?: boolean;
  conflict_details?: string;
}

export interface ImportFileResult {
  file_name: string;
  file_size: number;
  file_type: string;
  records: ParsedRecord[];
  total_records: number;
  valid_records: number;
  invalid_records: number;
  duplicates_in_file: number;
  duplicates_in_db: number;
  conflicts: number;
  parse_errors: string[];
}

export type DuplicateResolutionStrategy =
  | 'skip'
  | 'update_approved'
  | 'review'
  | 'manual';

export interface ImportJobRecord {
  id: string;
  user_id?: string;
  source_file_name: string;
  file_type?: string;
  total_records: number;
  inserted_records: number;
  updated_records: number;
  skipped_records: number;
  failed_records: number;
  duplicate_records: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  error_summary?: any[];
  created_at: string;
  completed_at?: string;
}

export interface AuditLogRecord {
  id: string;
  actor_id?: string;
  actor_email?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  change_summary?: any;
  previous_state?: any;
  new_state?: any;
  created_at: string;
}

export interface SavedFilterRecord {
  id: string;
  user_id?: string;
  name: string;
  entity_type: 'accounts' | 'orders' | 'returns' | 'data_quality';
  filter_conditions: Record<string, any>;
  sort_field?: string;
  sort_direction?: 'ASC' | 'DESC';
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReconciliationDiffItem {
  id: string;
  matching_key: string;
  status: 'new' | 'matching' | 'missing' | 'changed' | 'conflict';
  source_row: Record<string, any>;
  existing_record?: any;
  field_changes: Array<{
    field: string;
    old_value: any;
    new_value: any;
  }>;
  selected_to_apply: boolean;
  notes?: string;
}

export interface DataQualityIssue {
  id: string;
  entity_type: 'account' | 'order';
  entity_id: string;
  phone_display?: string;
  severity: 'critical' | 'warning' | 'info';
  field_name?: string;
  rule_code: string;
  description: string;
  suggested_correction?: string;
  resolution_status: 'open' | 'resolved' | 'ignored';
  detected_at: string;
  resolved_at?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'operations_manager' | 'viewer';
  created_at: string;
}

// ----------------------------------------------------
// DIRECT CHECKOUT & PAYMENT TYPES
// ----------------------------------------------------
export interface ProductVariation {
  name: string;
  variation_id: number;
  in_stock: boolean;
  price?: number;
  price_type_id?: number;
}

export interface ProductDetail {
  product_id: number;
  catalog_id: number;
  name: string;
  brand?: string | null;
  in_stock: boolean;
  mrp: number;
  price: number;
  images: string[];
  highlights?: Array<{ name: string; value: string }>;
  description?: string;
  full_details?: string;
  supplier_id: number;
  supplier_name?: string;
  supplier_rating?: number;
  mall_verified?: boolean;
  sizes: ProductVariation[];
  designs?: any[];
  share_url?: string;
}

export interface ProductSearchResultItem {
  product_id: number;
  catalog_id?: number;
  name: string;
  price: number;
  original_price?: number;
  discount_text?: string;
  image?: string | null;
  images?: string[];
  rating?: number | null;
  supplier_id?: number;
  supplier_name?: string;
  in_stock?: boolean;
  sizes?: Array<{ name: string; variation_id: number; in_stock?: boolean }>;
  full_details?: string;
  description?: string;
  special_offer?: string;
}

export interface ProductSearchResponse {
  catalogs: ProductSearchResultItem[];
  total_count?: number;
  cursor?: string | null;
  is_exact?: boolean;
}

export interface IsolatedCartResponse {
  is_isolated: boolean;
  product_id: number;
  variation_id: number;
  quantity: number;
  cart: any;
}

export interface DeliveryAddress {
  id: number;
  name: string;
  mobile: string;
  address_line_1: string;
  address_line_2?: string;
  landmark?: string;
  city: string;
  state: string;
  pin: string;
  address_type?: string;
  valid?: boolean;
  pin_serviceable?: boolean;
  local_id?: string;
  account_id?: string | number;
  is_upstream_registered?: boolean;
  is_default?: boolean;
  created_at?: string;
}

export interface CheckoutQuote {
  is_verified: boolean;
  address_id: number | null;
  cart_session: string | null;
  product_subtotal: number;
  cod_payable: number;
  online_payable: number;
  prepaid_discount?: number;
  first_order_discount?: number;
  fod_offer?: {
    title?: string;
    text?: string;
    subtitle?: string;
    max_value?: number | null;
    bucket?: string;
  } | null;
  delivery_charge?: number;
  currency?: string;
  quoted_at?: string;
  cart_items_count?: number;
  notice?: string;
}

export interface UpiPaymentSession {
  order_num: string;
  juspay_order_id: string;
  cart_session: string;
  amount: number;
  redirect_url?: string;
  upi_uri?: string;
  ts?: number;
  resume?: boolean;
  checkout_reference?: string;
  is_free_mode?: boolean;
}

export interface PaymentStatusResult {
  state: 'success' | 'failed' | 'pending';
  status: string;
  order_num: string;
  juspay_order_id?: string;
  raw?: any;
  checkout_reference?: string;
}

export interface OrderConfirmationResult {
  ok: boolean;
  order_num: string;
  amount?: number;
  message?: string;
  error?: string;
  checkout_reference?: string;
  internal_status?: InternalCheckoutStatus;
}

// ----------------------------------------------------
// INTERNAL CHECKOUT & PAYMENT SYNCHRONIZATION STATUSES
// ----------------------------------------------------
export type InternalCheckoutStatus =
  | 'ORDER_CREATED'
  | 'FREE_MODE_PENDING'
  | 'FREE_MODE_COMPLETED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'RECONCILIATION_REQUIRED';

export interface CheckoutAttempt {
  checkout_reference: string;
  account_id: number | string;
  account_phone?: string;
  product_id: number;
  product_name: string;
  variant_id: number;
  variant_name: string;
  quantity: number;
  amount: number;
  address_id: number;
  address_text: string;
  is_free_mode: boolean;
  internal_status: InternalCheckoutStatus;
  merchant_payment_status: OrderPaymentStatus;
  merchant_order_id?: string;
  cart_session?: string;
  upi_uri?: string;
  created_at: string;
  updated_at: string;
  error_message?: string;
  reconciliation_reason?: string;
}

export interface FreeCheckoutResult {
  ok: boolean;
  order_num: string;
  amount: number;
  checkout_reference: string;
  internal_status: 'FREE_MODE_COMPLETED' | 'PAYMENT_FAILED';
  merchant_payment_status: 'pending';
  message: string;
  error?: string;
}

export type PaymentMachineState =
  | 'idle'
  | 'creating_payment'
  | 'awaiting_payment'
  | 'verifying_payment'
  | 'confirming_order'
  | 'confirmed'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'payment_expired'
  | 'confirmation_failed'
  | 'status_unknown';

export interface AutoAddCartDetail {
  shop_id: number | string;
  mobile?: string;
  status: 'added' | 'already_in_cart' | 'skipped_has_orders' | 'skipped_unverified' | 'failed';
  message?: string;
}

export interface AutoAddCartResult {
  processed: number;
  added: number;
  already_in_cart: number;
  skipped_has_orders: number;
  skipped_unverified: number;
  failed: number;
  total_eligible: number;
  details?: AutoAddCartDetail[];
}



