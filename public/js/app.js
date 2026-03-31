/**
 * app.js — Fire Flow SPA router + shell
 */

import { initAuth, isLoggedIn, getRole, getCurrentUser, logout, getToken, scheduleTokenRefresh } from './auth.js';
import { initOfflineDetection, syncQueue } from './offline.js';
import { notify } from './toast.js';

// ── View imports ──────────────────────────────────────────────────────────────
import { renderLogin }              from './views/login.js';
import { renderPricing }            from './views/pricing.js';
import { renderAdminDashboard }     from './views/admin-dashboard.js';
import { renderSchedule }           from './views/admin-schedule.js';
import { renderPipeline }           from './views/admin-pipeline.js';
import { renderInspectionReview }   from './views/admin-inspection-review.js';
import { renderQuoteBuilder }       from './views/admin-quote-builder.js';
import { renderMyDay }              from './views/tech-my-day.js';
import { renderInspectionFlow }     from './views/tech-inspection.js';
import { renderCustomerQuote }      from './views/customer-quote.js';
import { renderSignup }            from './views/signup.js';
import { renderBilling }           from './views/billing.js';

// ── Router ────────────────────────────────────────────────────────────────────

// Public routes are rendered without authentication checks.
// The view receives the #app container directly (no shell chrome).
const publicRoutes = {
  '/pricing':        renderPricing,
  '/signup':         renderSignup,
  '/customer-quote': renderCustomerQuote,
  '/login':          null, // handled explicitly below
};

const routes = {
  '/':                  { view: renderAdminDashboard,   roles: ['admin'] },
  '/dashboard':         { view: renderAdminDashboard,   roles: ['admin'] },
  '/schedule':          { view: renderSchedule,         roles: ['admin'] },
  '/pipeline':          { view: renderPipeline,         roles: ['admin'] },
  '/inspections':       { view: renderInspectionReview, roles: ['admin'] },
  '/quotes':            { view: renderQuoteBuilder,     roles: ['admin'] },
  '/billing':           { view: renderBilling,          roles: ['admin'] },
  '/my-day':            { view: renderMyDay,            roles: ['technician', 'admin'] },
  '/inspection/new':    { view: renderInspectionFlow,   roles: ['technician', 'admin'] },
};

let currentPath = null;

// ── BUG 1 FIX: track offline listeners so we don't stack them ─────────────────
let _offlineCleanup = null;

// ── BUG 16 FIX: warn before closing mid-inspection ───────────────────────────
let _inspectionInProgress = false;
export function setInspectionInProgress(v) { _inspectionInProgress = v; }

window.addEventListener('beforeunload', (e) => {
  if (_inspectionInProgress) {
    e.preventDefault();
    e.returnValue = 'You have an inspection in progress. Changes may be lost.';
  }
});

export function navigate(path) {
  // BUG 8 FIX: warn if navigating away mid-inspection
  if (_inspectionInProgress && path !== '/inspection/new') {
    if (!confirm('You have an unsaved inspection in progress. Leave anyway?')) return;
    _inspectionInProgress = false;
  }
  history.pushState({}, '', path);
  render(path);
}

// Expose globally for inline onclick and views (avoids circular imports)
window._navigate = navigate;

window.addEventListener('popstate', () => { if (!_inspectionInProgress) render(location.pathname); });

function render(path) {
  // Public routes — rendered without auth, no shell chrome
  if (path === '/pricing') {
    currentPath = path;
    const app = document.getElementById('app');
    app.innerHTML = '';
    renderPricing(app);
    return;
  }
  if (path === '/customer-quote') {
    currentPath = path;
    const app = document.getElementById('app');
    app.innerHTML = '';
    renderCustomerQuote(app);
    return;
  }
  if (path === '/signup') {
    currentPath = path;
    const app = document.getElementById('app');
    app.innerHTML = '';
    renderSignup(app);
    return;
  }
  if (path === '/login') {
    renderLoginPage();
    return;
  }

  if (!isLoggedIn()) { renderLoginPage(); return; }

  const route = routes[path] ?? null;
  // BUG 5 FIX: default role to technician, never null — prevents infinite redirect
  const role  = getRole() ?? 'technician';

  // Unknown route → send to role-appropriate home
  if (!route) {
    navigate(role === 'admin' ? '/dashboard' : '/my-day');
    return;
  }

  // Role guard
  if (route.roles && !route.roles.includes(role)) {
    navigate(role === 'technician' ? '/my-day' : '/dashboard');
    return;
  }

  currentPath = path;
  renderShell(role);
  const content = document.getElementById('view-content');
  if (content) {
    content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    route.view(content);
  }
}

function renderLoginPage() {
  document.getElementById('app').innerHTML = '';
  renderLogin(document.getElementById('app'), onLoginSuccess);
}

function _onSessionExpired() {
  notify.error('Your session has expired. Please log in again.');
  setTimeout(() => navigate('/login'), 1500);
}

function onLoginSuccess(user) {
  const role = user?.app_metadata?.role ?? user?.user_metadata?.role ?? 'technician';
  navigate(role === 'admin' ? '/dashboard' : '/my-day');
  notify.success('Welcome back!');
  // Start proactive refresh — silently renew the token 60s before it expires
  scheduleTokenRefresh(_onSessionExpired);
}

// ── Offline sync helpers ───────────────────────────────────────────────────────

/**
 * Turn a method + path pair into a short, human-readable action label.
 * Examples:
 *   POST /v1/inspection/abc123/submit  → "submit inspection"
 *   POST /v1/inspection/abc123/image   → "upload photo"
 *   POST /v1/job/xyz/assign            → "assign job"
 *   POST /v1/quote/xyz/send            → "send quote"
 */
function _labelForPath(method, path) {
  if (/\/inspection\/[^/]+\/submit/.test(path))  return 'submit inspection';
  if (/\/inspection\/[^/]+\/image/.test(path))   return 'upload photo';
  if (/\/inspection\/[^/]+/.test(path))           return 'save inspection';
  if (/\/job\/[^/]+\/assign/.test(path))          return 'assign job';
  if (/\/quote\/[^/]+\/send/.test(path))          return 'send quote';
  if (/\/quote\/[^/]+\/approve/.test(path))       return 'approve quote';
  if (/\/quote\/[^/]+\/reject/.test(path))        return 'reject quote';
  if (/\/quote\/[^/]+/.test(path))                return 'save quote';
  // Fallback: "<METHOD> <last path segment>"
  const segment = path.split('/').filter(Boolean).pop() ?? path;
  return `${method.toLowerCase()} ${segment}`;
}

// ── Inline SVG icons for sidebar nav ──────────────────────────────────────────

// Flame icon: clean filled path used for the brand logo mark
const _flameSvg = (size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-1 .23-1.94.75-2.72 1.32-2.23 1.74-3.28 4.7-2.72 7.45.06.27.06.55 0 .82-.07.27-.2.53-.4.74-.55.52-.78 1.28-.65 1.99.13.7.62 1.3 1.28 1.56.76.3 1.58.14 2.22-.38.42-.35.7-.86.74-1.4.04-.48-.13-.95-.38-1.35-.54-.79-.66-1.49-.46-2.19.06.46.28.9.6 1.24.63.67 1.35 1.28 1.9 2.01.7.96 1.04 2.12.98 3.28-.04.72-.25 1.44-.61 2.05 1.32.97 2.73 1.2 3.97.7 2.48-1.01 3.94-3.72 3.15-6.32-.28-.93-.78-1.75-1.54-2.44-.48-.43-1.04-.8-1.3-1.54z"/>
  </svg>`;

const _ico = {
  dashboard:   `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
  schedule:    `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  pipeline:    `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="4" height="18" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="5" width="4" height="16" rx="1"/></svg>`,
  inspections: `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>`,
  quotes:      `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
  billing:     `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
  myday:       `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  newInspect:  `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  techview:    `<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  logout:      `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>`,
  menu:        `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
};

function renderShell(role) {
  const user     = getCurrentUser();
  const initials = (user?.email ?? '??').slice(0, 2).toUpperCase();
  const username = escapeHtml(user?.email?.split('@')[0] ?? 'User');

  const adminNav = [
    { path: '/dashboard',   label: 'Dashboard',   icon: _ico.dashboard   },
    { path: '/schedule',    label: 'Schedule',    icon: _ico.schedule    },
    { path: '/pipeline',    label: 'Pipeline',    icon: _ico.pipeline    },
    { path: '/inspections', label: 'Inspections', icon: _ico.inspections },
    { path: '/quotes',      label: 'Quotes',      icon: _ico.quotes      },
    { path: '/billing',     label: 'Billing',     icon: _ico.billing     },
    { path: '/my-day',      label: 'Tech View',   icon: _ico.techview    },
  ];

  const techNav = [
    { path: '/my-day',         label: 'My Day',       icon: _ico.myday      },
    { path: '/inspection/new', label: 'New Inspection',icon: _ico.newInspect },
  ];

  const nav = role === 'admin' ? adminNav : techNav;

  const isActive = (path) =>
    currentPath === path || (currentPath === '/' && path === '/dashboard');

  const sidebarLinks = nav.map(n => `
    <button class="sidebar-link ${isActive(n.path) ? 'active' : ''}"
      onclick="window._navigate('${n.path}')">
      <span class="sidebar-link-icon">${n.icon}</span>
      <span>${n.label}</span>
    </button>
  `).join('');

  // Mobile bottom nav — only most important items
  const mobileNavItems = role === 'admin'
    ? [
        { path: '/dashboard',   label: 'Home',    icon: _ico.dashboard   },
        { path: '/schedule',    label: 'Schedule',icon: _ico.schedule    },
        { path: '/pipeline',    label: 'Pipeline',icon: _ico.pipeline    },
        { path: '/inspections', label: 'Reports', icon: _ico.inspections },
      ]
    : [
        { path: '/my-day',         label: 'My Day',   icon: _ico.myday      },
        { path: '/inspection/new', label: 'Inspect',  icon: _ico.newInspect },
      ];

  const mobileNav = mobileNavItems.map(n => `
    <button class="mobile-nav-item ${isActive(n.path) ? 'active' : ''}"
      onclick="window._navigate('${n.path}')">
      <span class="nav-icon">${n.icon}</span>
      <span>${n.label}</span>
    </button>
  `).join('');

  document.getElementById('app').innerHTML = `
    <div id="sidebar-overlay" class="sidebar-overlay"></div>
    <div class="app-layout">

      <!-- ── Sidebar ── -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-logo">
          <div class="logo-mark">${_flameSvg(18)}</div>
          <div>
            <div class="logo-text">Fire Flow</div>
            <div class="logo-sub">Field Ops</div>
          </div>
        </div>

        <nav class="sidebar-nav">
          <div class="sidebar-nav-label">Navigation</div>
          ${sidebarLinks}
        </nav>

        <div class="sidebar-footer">
          <!-- System status -->
          <div style="display:flex;align-items:center;gap:7px;padding:6px 8px 10px;font-size:.72rem;color:var(--text-muted)">
            <div id="connection-dot" class="badge-dot"></div>
            <span id="connection-label">Connected</span>
          </div>

          <!-- User info -->
          <div class="sidebar-user">
            <div class="avatar">${initials}</div>
            <div class="sidebar-user-info">
              <span class="sidebar-user-name">${username}</span>
              <span class="sidebar-user-role">${escapeHtml(role)}</span>
            </div>
          </div>

          <button class="sidebar-logout" onclick="window._logout()">
            ${_ico.logout}
            Sign out
          </button>
        </div>
      </aside>

      <!-- ── Main area ── -->
      <div class="main-area">

        <!-- System banners -->
        <div id="offline-banner">
          Offline — changes saved locally, will sync on reconnect
        </div>
        <div id="sync-failed-banner" style="display:none">
          <span id="sync-failed-msg">⚠ Some offline changes could not be synced.</span>
          <button id="sync-retry-btn" class="btn btn-sm btn-danger" style="padding:3px 10px;font-size:.75rem">Retry now</button>
        </div>

        <!-- Mobile top bar -->
        <header class="mobile-header">
          <div class="mobile-header-logo">
            <div class="logo-mark" style="width:28px;height:28px">${_flameSvg(15)}</div>
            <span>Fire Flow</span>
          </div>
          <div class="mobile-header-right">
            <div id="connection-dot-mobile" class="badge-dot"></div>
            <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Open menu">
              ${_ico.menu}
            </button>
          </div>
        </header>

        <!-- View content -->
        <main class="main-content" id="view-content"></main>

        <!-- Mobile bottom nav -->
        <nav class="mobile-bottom-nav">
          ${mobileNav}
        </nav>
      </div>
    </div>
  `;

  // ── Mobile sidebar toggle ──────────────────────────────────────────────────
  const menuBtn  = document.getElementById('mobile-menu-btn');
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');

  const openSidebar  = () => { sidebar.classList.add('mobile-open'); overlay.classList.add('open'); };
  const closeSidebar = () => { sidebar.classList.remove('mobile-open'); overlay.classList.remove('open'); };

  menuBtn?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);

  // Close sidebar on nav (mobile)
  sidebar?.querySelectorAll('.sidebar-link').forEach(btn => {
    btn.addEventListener('click', closeSidebar);
  });

  // BUG 1 FIX: clean up previous offline listener before registering a new one
  if (_offlineCleanup) { _offlineCleanup(); _offlineCleanup = null; }

  let syncInFlight = false;
  const onStatus = (online) => {
    const banner = document.getElementById('offline-banner');
    const dot    = document.getElementById('connection-dot');
    const dotM   = document.getElementById('connection-dot-mobile');
    const label  = document.getElementById('connection-label');
    if (banner) banner.style.display = online ? 'none' : 'block';
    const color = online ? 'var(--success)' : 'var(--warning)';
    if (dot)   dot.style.background = color;
    if (dotM)  dotM.style.background = color;
    if (label) label.textContent = online ? 'Connected' : 'Offline';

    if (online && !syncInFlight) {
      syncInFlight = true;
      syncQueue.flush(async (method, path, body) => {
        const token = getToken();
        const res = await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }).then(async ({ succeeded, failed }) => {
        syncInFlight = false;

        // ── Success toast ─────────────────────────────────────────────────────
        if (succeeded.length > 0) {
          const s = succeeded.length;
          notify.success(`Synced ${s} offline action${s > 1 ? 's' : ''}`);
        }

        // ── Partial / total failure toast ─────────────────────────────────────
        if (failed.length > 0) {
          const f = failed.length;
          const total = succeeded.length + f;
          const labels = failed.map(item => _labelForPath(item.method, item.path)).join(', ');
          const msg = succeeded.length > 0
            ? `${f} of ${total} offline action${total > 1 ? 's' : ''} failed to sync (${labels}). Will retry automatically.`
            : `${f} offline action${f > 1 ? 's' : ''} failed to sync (${labels}). Will retry when reconnected.`;
          notify.error(msg);
          failed.forEach(item =>
            console.error('[sync] Unsynced:', item.method, item.path,
              '—', item.error ?? 'unknown error',
              `(attempt ${item.attempts ?? 1})`)
          );
        }

        // ── Update permanently-failed banner ──────────────────────────────────
        await _updateSyncFailedBanner();
      }).catch(async () => {
        syncInFlight = false;
        await _updateSyncFailedBanner();
      });
    }
  };

  _offlineCleanup = initOfflineDetection(onStatus);

  // ── Sync-failed banner ─────────────────────────────────────────────────────
  // Show on mount in case items were permanently failed in a previous session.
  _updateSyncFailedBanner();

  const retryBtn = document.getElementById('sync-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying…';
      await syncQueue.resetFailed();
      // Trigger a fresh flush as if we just came online
      if (navigator.onLine && !syncInFlight) {
        syncInFlight = true;
        syncQueue.flush(async (method, path, body) => {
          const token = getToken();
          const res = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }).then(async ({ succeeded, failed }) => {
          syncInFlight = false;
          if (succeeded.length > 0) {
            const s = succeeded.length;
            notify.success(`Synced ${s} offline action${s > 1 ? 's' : ''}`);
          }
          if (failed.length > 0) {
            const f = failed.length;
            notify.error(`${f} action${f > 1 ? 's' : ''} still failing. They'll stay queued.`);
          }
          await _updateSyncFailedBanner();
        }).catch(async () => {
          syncInFlight = false;
          await _updateSyncFailedBanner();
        });
      } else {
        await _updateSyncFailedBanner();
      }
    });
  }
}

async function _updateSyncFailedBanner() {
  const banner  = document.getElementById('sync-failed-banner');
  const msg     = document.getElementById('sync-failed-msg');
  const retryBtn = document.getElementById('sync-retry-btn');
  if (!banner) return;

  const stuck = await syncQueue.getPermanentlyFailed();
  if (stuck.length === 0) {
    banner.style.display = 'none';
  } else {
    banner.style.display = 'flex';
    if (msg) msg.textContent = `⚠ ${stuck.length} offline action${stuck.length > 1 ? 's' : ''} failed to sync after 3 attempts.`;
    if (retryBtn) { retryBtn.disabled = false; retryBtn.textContent = 'Retry now'; }
  }
}

// ── BUG 14 FIX: HTML escape utility (used by shell + views via window) ─────────
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window._escapeHtml = escapeHtml;

window._logout = () => { logout(); _inspectionInProgress = false; location.reload(); };
window._notify = notify;

// ── Boot ──────────────────────────────────────────────────────────────────────
initAuth();
// If the user was already logged in (page reload mid-session), arm the
// proactive refresh timer so the existing token is renewed before it expires.
if (isLoggedIn()) scheduleTokenRefresh(_onSessionExpired);
render(location.pathname);
