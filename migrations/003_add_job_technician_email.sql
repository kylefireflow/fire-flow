-- ============================================================================
-- 003 — Add technician_email to jobs table
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS technician_email TEXT;
