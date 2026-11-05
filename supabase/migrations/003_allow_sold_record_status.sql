-- Migration: Allow 'sold' status in accounts_record_status_check
-- Enables permanent exclusion of sold accounts from polling and checkout

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_record_status_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_record_status_check 
  CHECK (record_status IN ('active', 'review_required', 'conflict', 'invalid', 'archived', 'sold'));
