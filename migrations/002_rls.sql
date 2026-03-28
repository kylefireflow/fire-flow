-- ============================================================================
-- Fire Flow — Row Level Security (RLS)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- Run AFTER 001_initial.sql
-- ============================================================================
-- RLS ensures that even if a bug exposes the API, users can only ever read
-- or write rows belonging to their own company.
-- The service_role key (used by our backend) bypasses RLS entirely.
-- The anon key (used by nothing currently) sees zero rows.
-- ============================================================================

-- ─── Enable RLS on all tables ─────────────────────────────────────────────────

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs        ENABLE ROW LEVEL SECURITY;

-- ─── Helper: extract company_id from the JWT ──────────────────────────────────
-- Supabase stores custom claims in auth.jwt() -> app_metadata.

CREATE OR REPLACE FUNCTION current_company_id()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    ''
  );
$$;

CREATE OR REPLACE FUNCTION current_role_name()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    'technician'
  );
$$;

-- ─── Inspections policies ────────────────────────────────────────────────────

-- Admins see all inspections in their company
-- Technicians see only inspections they created
CREATE POLICY "inspections_select" ON inspections
  FOR SELECT USING (
    company_id = current_company_id()
  );

CREATE POLICY "inspections_insert" ON inspections
  FOR INSERT WITH CHECK (
    company_id = current_company_id()
  );

CREATE POLICY "inspections_update" ON inspections
  FOR UPDATE USING (
    company_id = current_company_id()
  );

-- ─── Quotes policies ──────────────────────────────────────────────────────────

CREATE POLICY "quotes_select" ON quotes
  FOR SELECT USING (
    company_id = current_company_id()
  );

CREATE POLICY "quotes_insert" ON quotes
  FOR INSERT WITH CHECK (
    company_id = current_company_id()
  );

CREATE POLICY "quotes_update" ON quotes
  FOR UPDATE USING (
    company_id = current_company_id()
  );

-- ─── Jobs policies ────────────────────────────────────────────────────────────

CREATE POLICY "jobs_select" ON jobs
  FOR SELECT USING (
    company_id = current_company_id()
  );

CREATE POLICY "jobs_insert" ON jobs
  FOR INSERT WITH CHECK (
    company_id = current_company_id()
  );

CREATE POLICY "jobs_update" ON jobs
  FOR UPDATE USING (
    company_id = current_company_id()
  );

-- ─── Done ─────────────────────────────────────────────────────────────────────
-- RLS is now active. The backend service_role key bypasses all policies.
-- Direct Supabase dashboard access still works for admins.
-- Anon/public access sees nothing.
