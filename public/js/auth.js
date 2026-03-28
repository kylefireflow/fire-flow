/**
 * auth.js — Session management for the Fire Flow frontend
 * Authenticates via Supabase Auth REST API, stores token in sessionStorage.
 */

const KEY_TOKEN    = 'ff_token';
const KEY_REFRESH  = 'ff_refresh';   // Supabase refresh_token (longer-lived)
const KEY_USER     = 'ff_user';
const KEY_SUPA_URL = 'ff_supabase_url';
const KEY_ANON_KEY = 'ff_anon_key';

// Supabase project details — set once, stored in sessionStorage
const SUPABASE_URL     = 'https://mklldyjjqldzbcbhwdsu.supabase.co';
// Your publishable key from Supabase → Project Settings → API Keys
// This is safe to include in frontend code — it has no elevated permissions
const SUPABASE_ANON_KEY = 'PASTE_YOUR_PUBLISHABLE_KEY_HERE';

// BUG FIX: sessionStorage throws in Safari private browsing mode.
// Wrap every access in a try-catch and fall back to an in-memory map.
const _memStore = new Map();
function _ssGet(key)        { try { return sessionStorage.getItem(key);    } catch { return _memStore.get(key) ?? null; } }
function _ssSet(key, value) { try { sessionStorage.setItem(key, value);   } catch { _memStore.set(key, value); } }
function _ssDel(key)        { try { sessionStorage.removeItem(key);       } catch { _memStore.delete(key); } }

export function initAuth() {
  _ssSet(KEY_SUPA_URL, SUPABASE_URL);
  _ssSet(KEY_ANON_KEY, SUPABASE_ANON_KEY);
}

export function getToken() {
  return _ssGet(KEY_TOKEN) ?? '';
}

export function getCurrentUser() {
  const raw = _ssGet(KEY_USER);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isLoggedIn() {
  const token = getToken();
  if (!token) return false;
  // Check JWT expiry — decode the payload without verifying signature.
  // Dev tokens end in ".dev" instead of a real signature — still parseable.
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      // Token expired — clear session silently
      _ssDel(KEY_TOKEN);
      _ssDel(KEY_USER);
      return false;
    }
  } catch (_) {
    // Malformed token — treat as expired
    _ssDel(KEY_TOKEN);
    _ssDel(KEY_USER);
    return false;
  }
  return true;
}

export function getRole() {
  return getCurrentUser()?.app_metadata?.role ?? getCurrentUser()?.user_metadata?.role ?? null;
}

export function getCompanyId() {
  return getCurrentUser()?.app_metadata?.company_id ?? null;
}

// ── Dev mode detection ────────────────────────────────────────────────────────
// When SUPABASE_ANON_KEY is the placeholder, the app runs in local dev mode.
// Auth is skipped on the server (no JWT_SECRET), so the frontend creates a
// synthetic session token that passes the isLoggedIn() exp check.
export const DEV_MODE = !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'PASTE_YOUR_PUBLISHABLE_KEY_HERE';

function _makeDevToken(email) {
  // Build a minimal JWT-shaped string so isLoggedIn()'s exp check passes.
  // NOT a real JWT — only used client-side in dev mode.
  const header  = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    sub:   'dev-user',
    email,
    exp:   Math.floor(Date.now() / 1000) + 60 * 60 * 8, // 8 hours
    app_metadata:  { role: 'admin', company_id: 'dev-company' },
    user_metadata: { role: 'admin' },
  }));
  return `${header}.${payload}.dev`;
}

export async function login(email, password) {
  // ── Dev mode: skip Supabase, create synthetic session ──────────────────────
  if (DEV_MODE) {
    const devUser = {
      id:    'dev-user',
      email,
      app_metadata:  { role: 'admin', company_id: 'dev-company' },
      user_metadata: { role: 'admin' },
    };
    _ssSet(KEY_TOKEN, _makeDevToken(email));
    _ssSet(KEY_USER,  JSON.stringify(devUser));
    return devUser;
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description ?? data?.msg ?? 'Login failed. Check your email and password.');
  }

  _ssSet(KEY_TOKEN,   data.access_token);
  _ssSet(KEY_USER,    JSON.stringify(data.user));
  if (data.refresh_token) _ssSet(KEY_REFRESH, data.refresh_token);
  return data.user;
}

export function logout() {
  _ssDel(KEY_TOKEN);
  _ssDel(KEY_REFRESH);
  _ssDel(KEY_USER);
  _clearRefreshTimer();
}

// ── Token refresh ─────────────────────────────────────────────────────────────

/**
 * Exchange the stored refresh_token for a fresh access_token.
 * Updates sessionStorage in place and returns the new access_token string.
 * Throws (and clears session) if the refresh_token is missing or rejected.
 */
export async function refreshSession() {
  const refreshToken = _ssGet(KEY_REFRESH);
  if (!refreshToken) throw new Error('No refresh token stored');

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Refresh rejected — session is truly dead, clear everything
    _ssDel(KEY_TOKEN);
    _ssDel(KEY_REFRESH);
    _ssDel(KEY_USER);
    throw new Error(data?.error_description ?? 'Session expired. Please log in again.');
  }

  _ssSet(KEY_TOKEN, data.access_token);
  // Supabase rotates the refresh token on each use — store the new one
  if (data.refresh_token) _ssSet(KEY_REFRESH, data.refresh_token);
  if (data.user)          _ssSet(KEY_USER,    JSON.stringify(data.user));

  return data.access_token;
}

// ── Proactive refresh timer ───────────────────────────────────────────────────

let _refreshTimer = null;

function _clearRefreshTimer() {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
}

/**
 * Schedule a silent token refresh 60 seconds before the current access_token
 * expires.  Pass `onExpiry` to be called if the refresh ultimately fails
 * (e.g. navigate to login).  Call again after each successful refresh to
 * schedule the next one.
 */
export function scheduleTokenRefresh(onExpiry) {
  _clearRefreshTimer();

  const token = _ssGet(KEY_TOKEN);
  if (!token || !_ssGet(KEY_REFRESH)) return; // nothing to refresh

  let exp;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    exp = payload.exp;
  } catch (_) {
    return; // malformed token — skip
  }

  if (!exp) return;

  const msUntilRefresh = (exp * 1000) - Date.now() - 60_000; // 60 s buffer

  if (msUntilRefresh <= 0) {
    // Already expired or within the buffer — refresh immediately
    refreshSession()
      .then(() => scheduleTokenRefresh(onExpiry))
      .catch(() => onExpiry?.());
    return;
  }

  _refreshTimer = setTimeout(async () => {
    try {
      await refreshSession();
      scheduleTokenRefresh(onExpiry); // chain next refresh
    } catch (_) {
      onExpiry?.();
    }
  }, msUntilRefresh);
}
