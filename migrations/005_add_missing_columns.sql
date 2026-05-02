-- ============================================================================
-- 005 — Add columns the code writes but earlier migrations forgot
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- Run AFTER 004_companies.sql
-- ============================================================================
-- Each column was identified by auditing every store.set() / upsert call
-- across src/server.js, src/coordinator.js, src/state.js. Without these,
-- PostgREST returns 400 "Could not find the X column of Y in the schema cache".

-- ─── quotes ──────────────────────────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS address              TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact              TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS notes                TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until          TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_token_hash  TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_link_id     TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_url         TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ;

-- ─── inspections ─────────────────────────────────────────────────────────────
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS checkpoints     JSONB DEFAULT '[]'::jsonb;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS city            TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS contact         TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS phone           TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS system_type     TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS num_floors      INTEGER;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS num_heads       INTEGER;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS photo_count     INTEGER;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;

-- ─── jobs ────────────────────────────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_slot              TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at             TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at           TIMESTAMPTZ;

-- ─── companies ───────────────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_name           TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cancel_at_period_end   BOOLEAN DEFAULT FALSE;
