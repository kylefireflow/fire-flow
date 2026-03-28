/**
 * db.js — Supabase PostgREST client (zero dependencies, native fetch)
 *
 * Uses Supabase's auto-generated REST API so we need no npm packages.
 * All table operations map directly to HTTP calls.
 *
 * Required env vars:
 *   SUPABASE_URL         https://your-project.supabase.co
 *   SUPABASE_SERVICE_KEY your-service-role-key (Settings → API → service_role)
 *
 * PostgREST operations used:
 *   GET  /rest/v1/{table}?id=eq.{id}          → fetch one row
 *   GET  /rest/v1/{table}                     → fetch all rows
 *   POST /rest/v1/{table} + Prefer: merge     → upsert (insert or update)
 *
 * Supabase service_role key bypasses row-level security — keep it server-side only.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

// ─── Connection check ─────────────────────────────────────────────────────────

export function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY &&
    SUPABASE_URL !== '' && SUPABASE_KEY !== 'your-service-role-key-here');
}

// ─── Headers ──────────────────────────────────────────────────────────────────

function baseHeaders(extra = {}) {
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
    ...extra,
  };
}

// ─── Error helper ─────────────────────────────────────────────────────────────

async function handleError(res, context) {
  const body = await res.text().catch(() => '(no body)');
  throw new Error(`[DB] ${context} — HTTP ${res.status}: ${body}`);
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Upsert a single row. Uses ON CONFLICT (id) DO UPDATE.
 * The entity must have an `id` field that matches the table's primary key.
 */
export async function upsert(table, entity) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: baseHeaders({
      'Prefer': 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(entity),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) await handleError(res, `upsert ${table}/${entity?.id}`);
  const rows = await res.json();
  return rows[0] ?? entity;
}

/**
 * Fetch a single row by its UUID id. Returns null if not found.
 */
export async function getById(table, id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: baseHeaders(), signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) await handleError(res, `getById ${table}/${id}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

/**
 * Fetch all rows from a table. Returns an array (may be empty).
 * In production you'd add filters / pagination; fine for bootstrap.
 */
export async function getAll(table) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?order=created_at.asc`,
    { headers: baseHeaders(), signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) await handleError(res, `getAll ${table}`);
  return res.json();
}

/**
 * Delete a row by id. Returns true if deleted, false if not found.
 */
export async function deleteById(table, id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    {
      method:  'DELETE',
      headers: baseHeaders({ 'Prefer': 'return=minimal' }),
      signal:  AbortSignal.timeout(10_000),
    }
  );
  if (res.status === 404) return false;
  if (!res.ok) await handleError(res, `deleteById ${table}/${id}`);
  return true;
}

/**
 * Ping Supabase to verify the connection.
 * Returns { ok: true, latencyMs } or { ok: false, error }.
 */
export async function ping() {
  if (!isConfigured()) return { ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not set' };
  const start = Date.now();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inspections?limit=1`,
      { headers: baseHeaders(), signal: AbortSignal.timeout(5_000) }
    );
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
