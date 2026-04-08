/**
 * api.js — HTTP client for the Fire Flow backend
 * All calls go to the same origin on port 3003.
 */

const BASE = '';  // same-origin

// Import the safe token getter so Safari private-mode sessionStorage errors
// are handled gracefully (the wrapper falls back to an in-memory store).
import { getToken, refreshSession, scheduleTokenRefresh } from './auth.js';

// One-shot guard: once a session expires we show ONE toast and redirect once.
// Without this, every in-flight API call fires its own error toast.
let _sessionExpiredHandled = false;

function _handleSessionExpired() {
  if (_sessionExpiredHandled) return;
  _sessionExpiredHandled = true;
  window._notify?.error('Your session has expired. Please log in again.');
  setTimeout(() => { window._navigate?.('/login'); }, 1500);
}

// Build and fire a single fetch; returns the parsed JSON or throws.
async function _doFetch(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
  const res  = await fetch(BASE + path, opts);
  const json = await res.json().catch(() => ({ success: false, error: { message: 'Invalid response' } }));
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? `HTTP ${res.status}`), { status: res.status, code: json?.error?.code });
  return json;
}

async function request(method, path, body, overrideToken) {
  const token = overrideToken ?? getToken();

  try {
    return await _doFetch(method, path, body, token);
  } catch (err) {
    // ── 401 refresh-and-retry ──────────────────────────────────────────────
    // Only attempt a refresh when we were using the session token (not a
    // customer-supplied override token, which we can't refresh).
    if (err.status === 401 && !overrideToken) {
      let newToken;
      try {
        newToken = await refreshSession();
        // Re-arm the proactive timer with the new token
        scheduleTokenRefresh(() => _handleSessionExpired());
      } catch (_) {
        // Refresh failed — session is truly dead
        _handleSessionExpired();
        throw Object.assign(new Error('Session expired'), { status: 401 });
      }
      // One retry with the fresh token
      return await _doFetch(method, path, body, newToken);
    }
    throw err;
  }
}

// Call this after a successful login to re-arm session expiry handling.
export function resetSessionExpiredFlag() {
  _sessionExpiredHandled = false;
}

export const api = {
  // Auth (public — no token required)
  signup: (body) => request('POST', '/v1/auth/signup', body),

  // Health
  health: () => request('GET', '/health'),

  // Inspections
  createInspection:  (body)        => request('POST', '/v1/inspection', body),
  getInspection:     (id)          => request('GET', `/v1/inspection/${id}`),
  addImage:          (id, body)    => request('POST', `/v1/inspection/${id}/image`, body),
  submitInspection:  (id)          => request('POST', `/v1/inspection/${id}/submit`, {}),
  listInspections:   (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/v1/inspections${qs ? '?' + qs : ''}`);
  },

  // Quotes (admin)
  createQuote:       (body)        => request('POST', '/v1/quote', body),
  getQuote:          (id)          => request('GET', `/v1/quote/${id}`),
  sendQuote:         (id, body)    => request('POST', `/v1/quote/${id}/send`, body ?? {}),
  approveQuote:      (id, body)    => request('POST', `/v1/quote/${id}/approve`, body ?? {}),
  rejectQuote:       (id, body)    => request('POST', `/v1/quote/${id}/reject`, body ?? {}),
  listQuotes:        (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/v1/quotes${qs ? '?' + qs : ''}`);
  },

  // Quotes (customer — uses customer's own bearer token from the emailed link)
  getQuoteForCustomer:    (id, token)        => request('GET',  `/v1/quote/${id}`,               null,     token),
  acceptQuoteAsCustomer:  (id, token)        => request('POST', `/v1/quote/${id}/accept`,         {},       token),
  rejectQuoteAsCustomer:  (id, token, reason)=> request('POST', `/v1/quote/${id}/customer-reject`,{ reason }, token),

  // Company branding
  getBranding:       ()            => request('GET',  '/v1/company/branding'),
  saveBranding:      (body)        => request('POST', '/v1/company/branding', body),

  // Billing
  getSubscription:   ()            => request('GET', '/v1/billing/subscription'),
  getUsage:          ()            => request('GET', '/v1/billing/usage'),
  createCheckout:    (body)        => request('POST', '/v1/billing/checkout', body),
  createPortal:      ()            => request('POST', '/v1/billing/portal', {}),

  // Jobs
  getJob:            (id)          => request('GET', `/v1/job/${id}`),
  listJobs:          (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/v1/jobs${qs ? '?' + qs : ''}`);
  },
  // Persist a schedule assignment: { technician_id, time_slot, scheduled_date? }
  assignJob:         (id, body)    => request('POST', `/v1/job/${id}/assign`, body),
  // Tech actions: dispatch (scheduled→in_progress) and complete (in_progress→completed)
  startJob:          (id)          => request('POST', `/v1/job/${id}/start`),
  completeJob:       (id)          => request('POST', `/v1/job/${id}/complete`),
  queueStats:        ()            => request('GET', '/v1/queue/stats'),
};
