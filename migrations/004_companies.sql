-- ============================================================================
-- 004 — Companies table (was missing; code references it but no migration existed)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- Run AFTER 003_add_job_technician_email.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
  id                     TEXT PRIMARY KEY,
  name                   TEXT,
  admin_email            TEXT,
  branding               JSONB,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT,
  plan                   TEXT,
  checkout_session_id    TEXT,
  invoices_this_period   INTEGER DEFAULT 0,
  usage_period           TEXT,
  overage_locked         BOOLEAN DEFAULT FALSE,
  overage_balance_cents  INTEGER DEFAULT 0,
  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_stripe_customer ON companies(stripe_customer_id);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Backend uses service_role which bypasses RLS, so no policies required.
-- If you ever expose companies to the anon client, add SELECT/UPDATE policies here.

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
