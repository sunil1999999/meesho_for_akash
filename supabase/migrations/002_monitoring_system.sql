-- 002_monitoring_system.sql
-- Migration for Continuous Meesho Account & Order Monitoring System

-- 1. ENHANCE ACCOUNTS TABLE
ALTER TABLE public.accounts 
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS monitoring_status VARCHAR(50) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS requires_attention BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS attention_reason TEXT,
    ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_orders_discovered INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_accounts_monitoring_status ON public.accounts (monitoring_status);
CREATE INDEX IF NOT EXISTS idx_accounts_next_check_at ON public.accounts (next_check_at);

-- 2. ENHANCE ORDERS TABLE
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS is_terminal BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS terminal_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS monitoring_status VARCHAR(50) DEFAULT 'monitoring',
    ADD COLUMN IF NOT EXISTS check_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ;

-- Retroactively mark existing Delivered and Cancelled orders as terminal
UPDATE public.orders 
SET is_terminal = TRUE, 
    terminal_confirmed_at = COALESCE(terminal_confirmed_at, updated_at, NOW()),
    monitoring_status = CASE 
        WHEN delivery_status = 'delivered' THEN 'terminal_delivered'
        WHEN delivery_status = 'cancelled' OR cancellation_status = 'cancelled' THEN 'terminal_cancelled'
        ELSE 'terminal_other'
    END
WHERE (delivery_status IN ('delivered', 'cancelled') OR cancellation_status = 'cancelled')
  AND is_terminal = FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_is_terminal ON public.orders (is_terminal);
CREATE INDEX IF NOT EXISTS idx_orders_next_check_at ON public.orders (next_check_at) WHERE is_terminal = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_monitoring_status ON public.orders (monitoring_status);

-- Unique index to prevent duplicate orders per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_account_ext_id 
ON public.orders (account_id, external_order_id)
WHERE external_order_id IS NOT NULL;

-- 3. WORKER HEARTBEATS & LEASES TABLE
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
    id VARCHAR(100) PRIMARY KEY,
    status VARCHAR(50) DEFAULT 'running',
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    current_cycle INT DEFAULT 0,
    accounts_processed INT DEFAULT 0,
    orders_discovered INT DEFAULT 0,
    terminal_orders_excluded INT DEFAULT 0,
    active_orders_polled INT DEFAULT 0,
    empty_orders_count INT DEFAULT 0,
    last_cycle_duration_sec NUMERIC(10, 2) DEFAULT 0.0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ENABLE RLS
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'worker_heartbeats' AND policyname = 'Allow manage worker_heartbeats'
    ) THEN
        CREATE POLICY "Allow manage worker_heartbeats" ON public.worker_heartbeats
            FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
    END IF;
END $$;
