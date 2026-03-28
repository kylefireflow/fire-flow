/**
 * persistence.js — Write-through persistence layer
 *
 * Every write to an EntityStore automatically calls persistEntity().
 * This is fire-and-forget: the in-memory write is synchronous and immediate;
 * the DB write happens asynchronously in the background.
 *
 * On server startup, loadStore() bootstraps each EntityStore from the DB
 * so state survives process restarts.
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  EntityStore.set(id, entity)                         │
 * │       │                                              │
 * │       ├── Map.set() ──► sync, immediate              │
 * │       │                                              │
 * │       └── persistEntity() ──► async, best-effort     │
 * │               │                                      │
 * │               └── POST /rest/v1/{table} (upsert)     │
 * └──────────────────────────────────────────────────────┘
 */

import { upsert, getAll, isConfigured } from './db.js';

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Persist an entity to its DB table.
 * Called by EntityStore.set() — never throws, logs errors instead.
 */
export function persistEntity(table, entity) {
  if (!isConfigured()) return;   // Skip if DB not configured (dev/test mode)
  upsert(table, entity).catch(err => {
    console.error(`[DB] persist ${table}/${entity?.id} failed:`, err.message);
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Load all rows from a DB table into an EntityStore's in-memory Map.
 * Called once at server startup. Safe to call if DB is not configured.
 *
 * @param {string}       table      Table name in Supabase
 * @param {Map}          store      The Map to populate
 * @returns {number}                Number of rows loaded
 */
export async function loadStore(table, store) {
  if (!isConfigured()) return 0;
  try {
    const rows = await getAll(table);
    for (const row of rows) {
      store.set(row.id, row);
    }
    console.log(`[DB] Loaded ${rows.length} ${table}`);
    return rows.length;
  } catch (err) {
    console.error(`[DB] Bootstrap ${table} failed:`, err.message);
    return 0;
  }
}
