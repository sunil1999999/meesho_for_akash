-- 004_order_tracking_id.sql
-- Add explicit tracking_id column to orders table for courier / shipment tracking
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_orders_tracking_id ON public.orders (tracking_id);
