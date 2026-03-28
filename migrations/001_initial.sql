-- ============================================================================
-- Fire Flow Workflow Engine — Initial Schema
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================================

-- ─── Inspections ─────────────────────────────────────────────────────────────
-- Represents a single fire-suppression inspection performed by a technician.
-- voice_recordings, images, deficiencies, and state_history are JSONB arrays.

CREATE TABLE IF NOT EXISTS inspections (
  id                UUID PRIMARY KEY,
  state             TEXT NOT NULL DEFAULT 'draft',
  previous_state    TEXT,
  company_id        TEXT NOT NULL,
  technician_id     TEXT,
  technician_email  TEXT,
  admin_email       TEXT,
  customer_id       TEXT,
  customer_email    TEXT,
  address           TEXT,
  inspection_type   TEXT DEFAULT 'routine',
  notes             TEXT DEFAULT '',
  voice_recordings  JSONB DEFAULT '[]'::jsonb,
  images            JSONB DEFAULT '[]'::jsonb,
  deficiencies      JSONB DEFAULT '[]'::jsonb,
  report            JSONB,
  report_id         TEXT,
  quote_id          TEXT,
  last_error        TEXT,
  state_history     JSONB DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspections_company    ON inspections(company_id);
CREATE INDEX IF NOT EXISTS idx_inspections_state      ON inspections(state);
CREATE INDEX IF NOT EXISTS idx_inspections_technician ON inspections(technician_id);

-- ─── Quotes ──────────────────────────────────────────────────────────────────
-- Workflow-engine quote entity (separate from quote-engine's internal records).
-- line_items and summary are JSONB; engine_quote_id links to the quote-engine.

CREATE TABLE IF NOT EXISTS quotes (
  id               UUID PRIMARY KEY,
  state            TEXT NOT NULL DEFAULT 'draft',
  previous_state   TEXT,
  company_id       TEXT,
  customer_id      TEXT,
  customer_email   TEXT,
  inspection_id    UUID REFERENCES inspections(id) ON DELETE SET NULL,
  line_items       JSONB DEFAULT '[]'::jsonb,
  summary          JSONB,
  engine_quote_id  TEXT,
  rejection_reason TEXT,
  last_error       TEXT,
  state_history    JSONB DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_company       ON quotes(company_id);
CREATE INDEX IF NOT EXISTS idx_quotes_state         ON quotes(state);
CREATE INDEX IF NOT EXISTS idx_quotes_inspection    ON quotes(inspection_id);

-- ─── Jobs ────────────────────────────────────────────────────────────────────
-- A scheduled repair job created after a customer approves a quote.

CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY,
  state           TEXT NOT NULL DEFAULT 'pending',
  previous_state  TEXT,
  company_id      TEXT,
  customer_id     TEXT,
  inspection_id   UUID REFERENCES inspections(id) ON DELETE SET NULL,
  quote_id        UUID REFERENCES quotes(id)      ON DELETE SET NULL,
  scheduled_date  TEXT,
  technician_id   TEXT,
  last_error      TEXT,
  state_history   JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_company     ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_state       ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_technician  ON jobs(technician_id);

-- ─── Helpful views ────────────────────────────────────────────────────────────

-- Active inspections (not complete or cancelled)
CREATE OR REPLACE VIEW active_inspections AS
  SELECT * FROM inspections
  WHERE state NOT IN ('complete', 'cancelled')
  ORDER BY updated_at DESC;

-- Quotes awaiting admin review
CREATE OR REPLACE VIEW pending_reviews AS
  SELECT q.*, i.address, i.technician_id AS inspection_technician_id
  FROM quotes q
  LEFT JOIN inspections i ON i.id = q.inspection_id
  WHERE q.state = 'review'
  ORDER BY q.updated_at ASC;

-- Open jobs (scheduled or in progress)
CREATE OR REPLACE VIEW open_jobs AS
  SELECT j.*, i.address
  FROM jobs j
  LEFT JOIN inspections i ON i.id = j.inspection_id
  WHERE j.state IN ('pending', 'scheduled', 'in_progress')
  ORDER BY j.scheduled_date ASC NULLS LAST;

-- ─── Updated_at trigger ───────────────────────────────────────────────────────
-- Automatically keep updated_at current on any row update.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inspections_updated_at ON inspections;
CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_quotes_updated_at ON quotes;
CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Done ─────────────────────────────────────────────────────────────────────
-- You should see:
--   tables: inspections, quotes, jobs
--   views:  active_inspections, pending_reviews, open_jobs
--   trigger function: set_updated_at
