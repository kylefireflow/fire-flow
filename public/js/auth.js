/**
 * auth.js — Session management for the Fire Flow frontend
 * Authenticates via Supabase Auth REST API, stores token in sessionStorage.
 *
 * Supabase connection details (URL + anon key) are fetched from the server at
 * /v1/config so they never have to be hardcoded in client-side source code.
 */

const KEY_TOKEN    = 'ff_token';
const KEY_REFRESH  = 'ff_refresh';   // Supabase refresh_token (longer-lived)
const KEY_USER     = 'ff_user';

// BUG FIX: sessionStorage throws in Safari private browsing mode.
// Wrap every access in a try-catch and fall back to an in-memory map.
const _memStore = new Map();
function _ssGet(key)        { try { return sessionStorage.getItem(key);    } catch { return _memStore.get(key) ?? null; } }
function _ssSet(key, value) { try { sessionStorage.setItem(key, value);   } catch { _memStore.set(key, value); } }
function _ssDel(key)        { try { sessionStorage.removeItem(key);       } catch { _memStore.delete(key); } }

// Runtime config — populated by initAuth() from /v1/config
let _supabaseUrl     = '';
let _supabaseAnonKey = '';

// DEV_MODE: true when the server hasn't configured a Supabase project yet.
// In dev mode, login creates a synthetic local token and the server skips auth.
export let DEV_MODE = true;  // starts true, flipped to false after config loads

// Dev mode technician registry — tracks emails that were invited as technicians
// so they log in with role 'technician' instead of the default 'admin'.
let _devTechnicians = new Set();

/** Register an email as a dev-mode technician (called after invite) */
export function registerDevTechnician(email) {
  _devTechnicians.add(email?.toLowerCase());
  // Persist so it survives page reload
  try { sessionStorage.setItem('ff_dev_techs', JSON.stringify([..._devTechnicians])); } catch {}
}

function _loadDevTechnicians() {
  try {
    const raw = sessionStorage.getItem('ff_dev_techs');
    if (raw) _devTechnicians = new Set(JSON.parse(raw));
  } catch {}
}

export async function initAuth() {
  _loadDevTechnicians();
  try {
    const res  = await fetch('/v1/config');
    const data = await res.json();
    _supabaseUrl     = data.supabaseUrl     ?? '';
    _supabaseAnonKey = data.supabaseAnonKey ?? '';
    DEV_MODE = !_supabaseUrl || !_supabaseAnonKey;
  } catch (_) {
    // Network error — stay in dev mode, server-side auth will also be off
    DEV_MODE = true;
  }
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

function _makeDevToken(email, role = 'admin', userId = 'dev-user') {
  // Build a minimal JWT-shaped string so isLoggedIn()'s exp check passes.
  // NOT a real JWT — only used client-side in dev mode.
  const header  = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    sub:   userId,
    email,
    exp:   Math.floor(Date.now() / 1000) + 60 * 60 * 8, // 8 hours
    app_metadata:  { role, company_id: 'dev-company' },
    user_metadata: { role },
  }));
  return `${header}.${payload}.dev`;
}

export async function login(email, password) {
  // ── Dev mode: ask the server for the role, then create synthetic session ────
  if (DEV_MODE) {
    // Query the server's dev user store for this email's role.
    // This survives browser resets because the server holds the registry in memory.
    let role = _devTechnicians.has(email?.toLowerCase()) ? 'technician' : 'admin';
    let userId = role === 'technician' ? 'dev-tech-' + email : 'dev-user';
    try {
      const devRes = await fetch('/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (devRes.ok) {
        const devData = await devRes.json();
        role   = devData.data?.role ?? role;
        userId = devData.data?.user_id ?? userId;
      }
    } catch {} // If server is unreachable, fall back to local registry

    const devUser = {
      id:    userId,
      email,
      app_metadata:  { role, company_id: 'dev-company' },
      user_metadata: { role },
    };
    _ssSet(KEY_TOKEN, _makeDevToken(email, role, userId));
    _ssSet(KEY_USER,  JSON.stringify(devUser));
    return devUser;
  }

  const res = await fetch(`${_supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': _supabaseAnonKey,
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

  const res = await fetch(`${_supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': _supabaseAnonKey },
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
