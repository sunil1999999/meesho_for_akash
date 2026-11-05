-- Meesho Management Dashboard Database Schema
-- Supabase PostgreSQL with RLS, Constraints, and Indexes

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ACCOUNTS TABLE
-- Mandatory requirement: Store entire account JSON inside account_json JSONB
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_normalized VARCHAR(20) NOT NULL, -- e.g. +919033807401
    phone_display VARCHAR(30) NOT NULL,    -- Display format e.g. +91 90338 07401
    account_json JSONB NOT NULL,          -- Complete, uncorrupted account JSON object
    record_status VARCHAR(50) DEFAULT 'active' CHECK (record_status IN ('active', 'review_required', 'conflict', 'invalid', 'archived')),
    tags TEXT[] DEFAULT '{}',
    notes TEXT,
    source_file VARCHAR(255),
    import_job_id UUID,
    is_archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Unique index on normalized phone number for active accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_unique_active_phone 
ON public.accounts (phone_normalized) 
WHERE (is_archived = FALSE);

CREATE INDEX IF NOT EXISTS idx_accounts_phone_normalized ON public.accounts (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_accounts_record_status ON public.accounts (record_status);
CREATE INDEX IF NOT EXISTS idx_accounts_is_archived ON public.accounts (is_archived);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON public.accounts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_account_json ON public.accounts USING GIN (account_json);

-- 2. RESTRICTED ACCOUNT SECRETS TABLE
CREATE TABLE IF NOT EXISTS public.account_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    secret_payload JSONB NOT NULL,
    restricted_access_level VARCHAR(50) DEFAULT 'admin_only',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_secrets_account_id ON public.account_secrets (account_id);

-- 3. ORDERS TABLE
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
    external_order_id VARCHAR(100),
    product_name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    order_date TIMESTAMPTZ DEFAULT NOW(),
    quantity INT DEFAULT 1 CHECK (quantity > 0),
    order_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(50) DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending', 'cod', 'failed', 'refunded', 'partially_refunded')),
    shipment_status VARCHAR(50) DEFAULT 'manifested',
    delivery_status VARCHAR(50) DEFAULT 'delivered' CHECK (delivery_status IN ('placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'rto')),
    cancellation_status VARCHAR(50) DEFAULT 'none' CHECK (cancellation_status IN ('none', 'requested', 'cancelled', 'rejected')),
    return_status VARCHAR(50) DEFAULT 'none' CHECK (return_status IN ('none', 'requested', 'in_progress', 'returned', 'rejected')),
    refund_status VARCHAR(50) DEFAULT 'none' CHECK (refund_status IN ('none', 'pending', 'processing', 'refunded', 'failed', 'disputed')),
    refund_amount NUMERIC(12, 2) DEFAULT 0.00,
    refund_reference VARCHAR(100),
    return_reason TEXT,
    last_verified_at TIMESTAMPTZ DEFAULT NOW(),
    next_follow_up_date TIMESTAMPTZ,
    data_source VARCHAR(100) DEFAULT 'manual',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_account_id ON public.orders (account_id);
CREATE INDEX IF NOT EXISTS idx_orders_external_order_id ON public.orders (external_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON public.orders (delivery_status);
CREATE INDEX IF NOT EXISTS idx_orders_refund_status ON public.orders (refund_status);

-- 4. ORDER STATUS HISTORY / EVENTS
CREATE TABLE IF NOT EXISTS public.order_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    event_note TEXT,
    event_source VARCHAR(100) DEFAULT 'user_action',
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON public.order_events (order_id);

-- 5. IMPORT JOBS
CREATE TABLE IF NOT EXISTS public.import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    source_file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    total_records INT DEFAULT 0,
    inserted_records INT DEFAULT 0,
    updated_records INT DEFAULT 0,
    skipped_records INT DEFAULT 0,
    failed_records INT DEFAULT 0,
    duplicate_records INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
    error_summary JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 6. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100),
    change_summary JSONB,
    previous_state JSONB,
    new_state JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);

-- 7. SAVED FILTERS
CREATE TABLE IF NOT EXISTS public.saved_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('accounts', 'orders', 'returns', 'data_quality')),
    filter_conditions JSONB NOT NULL DEFAULT '{}',
    sort_field VARCHAR(100),
    sort_direction VARCHAR(10) DEFAULT 'DESC',
    is_shared BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CSV RECONCILIATION JOBS
CREATE TABLE IF NOT EXISTS public.reconciliation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    matching_key VARCHAR(100) NOT NULL,
    total_csv_rows INT DEFAULT 0,
    new_records_count INT DEFAULT 0,
    matching_records_count INT DEFAULT 0,
    missing_records_count INT DEFAULT 0,
    changed_records_count INT DEFAULT 0,
    conflict_records_count INT DEFAULT 0,
    applied_changes_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'previewed',
    report_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. DATA QUALITY ISSUES
CREATE TABLE IF NOT EXISTS public.data_quality_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('account', 'order')),
    entity_id VARCHAR(100) NOT NULL,
    phone_display VARCHAR(30),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    field_name VARCHAR(100),
    rule_code VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    suggested_correction TEXT,
    resolution_status VARCHAR(50) DEFAULT 'open' CHECK (resolution_status IN ('open', 'resolved', 'ignored')),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ENABLE ROW LEVEL SECURITY (RLS) ON ALL TABLES
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_quality_issues ENABLE ROW LEVEL SECURITY;

-- 10. RLS POLICIES FOR ACCOUNTS
CREATE POLICY "Allow read accounts" ON public.accounts
    FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "Allow insert accounts" ON public.accounts
    FOR INSERT TO authenticated, anon WITH CHECK (true);

CREATE POLICY "Allow update accounts" ON public.accounts
    FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow delete accounts" ON public.accounts
    FOR DELETE TO authenticated, anon USING (true);

-- 11. RLS POLICIES FOR ORDERS & EVENTS
CREATE POLICY "Allow manage orders" ON public.orders
    FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow manage order_events" ON public.order_events
    FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

-- 12. RLS POLICIES FOR IMPORT & AUDIT
CREATE POLICY "Allow manage import_jobs" ON public.import_jobs
    FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow manage audit_logs" ON public.audit_logs
    FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

-- 13. RLS POLICIES FOR FILTERS & RECONCILIATION
CREATE POLICY "Allow manage saved_filters" ON public.saved_filters
    FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow manage reconciliation_jobs" ON public.reconciliation_jobs
    FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow manage data_quality_issues" ON public.data_quality_issues
    FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

-- 14. RESTRICTED ACCESS FOR ACCOUNT SECRETS
CREATE POLICY "Allow authenticated read account_secrets" ON public.account_secrets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
