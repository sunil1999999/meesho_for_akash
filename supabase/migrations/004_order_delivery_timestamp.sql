-- 003_order_delivery_timestamp.sql
-- Add explicit delivered_at and delivery_status_changed_at columns to orders table

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivery_status_changed_at TIMESTAMPTZ;

-- Backfill delivered_at for orders already in delivered status using terminal_confirmed_at or updated_at
UPDATE public.orders
SET delivered_at = COALESCE(delivered_at, terminal_confirmed_at, updated_at),
    delivery_status_changed_at = COALESCE(delivery_status_changed_at, delivered_at, terminal_confirmed_at, updated_at)
WHERE delivery_status = 'delivered' AND delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON public.orders (delivered_at);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status_changed_at ON public.orders (delivery_status_changed_at);
