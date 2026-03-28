/**
 * offline.js — IndexedDB storage + sync queue for offline-first operation
 *
 * Stores:
 *   - inspections  (all local inspection drafts + submitted)
 *   - sync_queue   (pending API calls to retry when online)
 */

const DB_NAME    = 'fireflow';
const DB_VERSION = 2;   // v2: added 'photos' store

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('inspections')) {
        const store = db.createObjectStore('inspections', { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('company_id', 'company_id');
        store.createIndex('technician_id', 'technician_id');
        store.createIndex('updated_at', 'updated_at');
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        const sq = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        sq.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('quotes')) {
        db.createObjectStore('quotes', { keyPath: 'id' });
      }
      // v2: photo store — keeps photo blobs separate from the main inspection
      // record so the inspection record stays small and IDB writes stay fast.
      // Keyed by photo.id; indexed by inspection_local_id for bulk operations.
      if (!db.objectStoreNames.contains('photos')) {
        const ps = db.createObjectStore('photos', { keyPath: 'id' });
        ps.createIndex('inspection_local_id', 'inspection_local_id');
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Generic store operations ──────────────────────────────────────────────────

async function getAll(storeName) {
  const store = await tx(storeName);
  return promisify(store.getAll());
}

async function getById(storeName, id) {
  const store = await tx(storeName);
  return promisify(store.get(id));
}

async function upsert(storeName, record) {
  const store = await tx(storeName, 'readwrite');
  return promisify(store.put(record));
}

async function remove(storeName, id) {
  const store = await tx(storeName, 'readwrite');
  return promisify(store.delete(id));
}

// ── Inspections ───────────────────────────────────────────────────────────────

export const localInspections = {
  getAll:    () => getAll('inspections'),
  getById:   (id) => getById('inspections', id),
  save:      (insp) => upsert('inspections', { ...insp, _local: true, updated_at: new Date().toISOString() }),
  remove:    (id) => remove('inspections', id),

  // Create a new local draft
  createDraft(data) {
    const id = 'local_' + crypto.randomUUID();
    return this.save({ id, status: 'draft', created_at: new Date().toISOString(), ...data });
  },
};

// ── Jobs ──────────────────────────────────────────────────────────────────────

export const localJobs = {
  getAll:  () => getAll('jobs'),
  getById: (id) => getById('jobs', id),
  save:    (job) => upsert('jobs', job),
};

// ── Quotes ────────────────────────────────────────────────────────────────────

export const localQuotes = {
  getAll:  () => getAll('quotes'),
  getById: (id) => getById('quotes', id),
  save:    (q) => upsert('quotes', q),
};

// ── Photos ────────────────────────────────────────────────────────────────────
// Stores per-photo blobs (including dataUrl) keyed by photo.id.
// The parent inspection record stores photos:[] to stay small.

export const localPhotos = {
  /** Save or update a single photo (must include inspection_local_id). */
  save(photo) {
    return upsert('photos', { ...photo, saved_at: new Date().toISOString() });
  },

  /** Load all photos for a given local inspection ID. */
  async getByInspectionId(inspectionLocalId) {
    const store = await tx('photos');
    const index = store.index('inspection_local_id');
    return promisify(index.getAll(inspectionLocalId));
  },

  /** Delete a single photo. */
  remove(photoId) {
    return remove('photos', photoId);
  },

  /** Delete all photos for a given local inspection ID (call after submit). */
  async removeByInspectionId(inspectionLocalId) {
    const photos = await this.getByInspectionId(inspectionLocalId);
    await Promise.all(photos.map(p => this.remove(p.id)));
    return photos.length;
  },
};

// ── Sync queue ────────────────────────────────────────────────────────────────

export const syncQueue = {
  async push(method, path, body, metadata = {}) {
    const store = await tx('sync_queue', 'readwrite');
    return promisify(store.add({
      method, path, body, metadata,
      status: 'pending',
      created_at: new Date().toISOString(),
      attempts: 0,
    }));
  },

  async getAll() { return getAll('sync_queue'); },

  async markDone(id) {
    const store = await tx('sync_queue', 'readwrite');
    return promisify(store.delete(id));
  },

  // Items that have exhausted all 3 auto-retry attempts
  async getPermanentlyFailed() {
    const all = await this.getAll();
    return all.filter(i => i.status === 'failed' && i.attempts >= 3);
  },

  // Reset permanently-failed items so they can be retried again
  async resetFailed() {
    const store = await tx('sync_queue', 'readwrite');
    const all   = await promisify(store.getAll());
    const stuck = all.filter(i => i.status === 'failed' && i.attempts >= 3);
    for (const item of stuck) {
      item.status   = 'pending';
      item.attempts = 0;
      item.error    = null;
      await promisify(store.put(item));
    }
    return stuck.length;
  },

  async markFailed(id, error) {
    const store = await tx('sync_queue', 'readwrite');
    const item  = await promisify(store.get(id));
    if (item) {
      item.status   = 'failed';
      item.error    = error;
      item.attempts = (item.attempts ?? 0) + 1;
      await promisify(store.put(item));
    }
  },

  // Attempt to flush pending items.
  // Returns { succeeded: Item[], failed: FailedItem[] } so callers can
  // distinguish partial failures from full success.
  async flush(apiFn) {
    const all = await this.getAll();
    const pending = all.filter(i => i.status === 'pending' || (i.status === 'failed' && i.attempts < 3));
    const succeeded = [];
    const failed    = [];

    for (const item of pending) {
      try {
        await apiFn(item.method, item.path, item.body);
        await this.markDone(item.id);
        succeeded.push(item);
        console.log('[sync] Flushed:', item.method, item.path);
      } catch (err) {
        await this.markFailed(item.id, err.message);
        failed.push({ ...item, error: err.message });
        console.warn('[sync] Failed:', item.method, item.path, err.message);
      }
    }

    return { succeeded, failed };
  },
};

// ── Online/offline detection ──────────────────────────────────────────────────

// Returns a cleanup function — call it before re-registering to prevent stacked listeners
export function initOfflineDetection(onStatusChange) {
  const update = () => {
    const online = navigator.onLine;
    document.body.classList.toggle('offline', !online);
    onStatusChange?.(online);
  };
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update(); // fire immediately to set initial state
  return () => {
    window.removeEventListener('online',  update);
    window.removeEventListener('offline', update);
  };
}
