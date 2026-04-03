/**
 * admin-dashboard.js — Action-based admin dashboard
 * All stat cards, inspection list, quote list, and today's jobs load from the live API.
 */

import { api } from '../api.js';

export async function renderAdminDashboard(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>
      <div class="flex-row">
        <button class="btn btn-primary" onclick="window._navigate('/inspection/new')">${_ico.plus} New Inspection</button>
      </div>
    </div>

    <!-- Stat cards -->
    <div class="stats-grid" id="stats-grid">
      ${statCard(_ico.zap,       'orange', 'stat-orange', '—', 'Jobs Active',        '')}
      ${statCard(_ico.search,    'red',    'stat-red',    '—', 'Needs Review',       'Inspections awaiting admin')}
      ${statCard(_ico.dollar,    'yellow', 'stat-yellow', '—', 'Quotes Pending',     'Need your approval')}
      ${statCard(_ico.checkCirc, 'blue',   'stat-blue',   '—', 'Completed',          'All time')}
      ${statCard(_ico.clipboard, 'green',  'stat-green',  '—', 'Inspections Total',  '')}
    </div>

    <!-- Action sections -->
    <div class="grid-2" style="gap:20px">
      <!-- Quotes needing approval -->
      <div>
        <div class="section-header">
          <div>
            <div class="section-title">Quotes Awaiting Approval</div>
            <div class="section-subtitle">Ready for your review</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="window._navigate('/quotes')">View all</button>
        </div>
        <div id="quotes-list" class="card" style="padding:0;overflow:hidden">
          <div class="loading-overlay"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Recent inspections -->
      <div>
        <div class="section-header">
          <div>
            <div class="section-title">Recent Inspections</div>
            <div class="section-subtitle">Submitted by your technicians</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="window._navigate('/inspections')">View all</button>
        </div>
        <div id="inspections-list" class="card" style="padding:0;overflow:hidden">
          <div class="loading-overlay"><div class="spinner"></div></div>
        </div>
      </div>
    </div>

    <!-- Today's jobs -->
    <div class="mt-3">
      <div class="section-header">
        <div>
          <div class="section-title">Active Jobs</div>
          <div class="section-subtitle">In progress and scheduled</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window._navigate('/pipeline')">Full pipeline →</button>
      </div>
      <div id="today-jobs" class="card" style="padding:0;overflow:hidden">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  // Load everything in parallel
  await Promise.all([
    loadStats(),
    loadQuotes(),
    loadInspections(),
    loadActiveJobs(),
  ]);
}

// ── SVG icon set ──────────────────────────────────────────────────────────────

const _s = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const _ico = {
  zap:       _s('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  search:    _s('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  dollar:    _s('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  checkCirc: _s('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  clipboard: _s('<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1"/>'),
  cal:       _s('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  plus:      _s('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  emptyJobs: _s('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="15" x2="15" y2="15"/>'),
  emptyDoc:  _s('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
};

// ── Stat card layout ──────────────────────────────────────────────────────────

function statCard(icon, color, accentClass, value, label, trend) {
  return `
    <div class="stat-card ${accentClass}">
      <div class="stat-icon ${color}">${icon}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
      ${trend ? `<div class="stat-trend">${trend}</div>` : ''}
    </div>
  `;
}

// ── Data loaders ──────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const [inspsRes, jobsRes, quotesRes] = await Promise.all([
      api.listInspections({ exclude: 'draft,cancelled' }),
      api.listJobs(),
      api.listQuotes(),
    ]);

    const inspections = inspsRes.data  ?? [];
    const allJobs     = jobsRes.data   ?? [];
    const allQuotes   = quotesRes.data ?? [];

    // BUG FIX: stat card "Jobs Active" was excluding 'pending' jobs, but the Active Jobs
    // section below showed all non-completed/cancelled jobs (including pending).
    // Align both to use the same definition: pending + scheduled + in_progress = "active".
    const activeJobs      = allJobs.filter(j => ['pending', 'scheduled', 'in_progress'].includes(j.state)).length;
    const needsReview     = inspections.filter(i => i.state === 'submitted' || i.state === 'processing').length;
    const pendingQuotes   = allQuotes.filter(q => q.state === 'review').length;
    const completedJobs   = allJobs.filter(j => j.state === 'completed').length;
    const totalInspections = inspections.length;

    const cards = document.querySelectorAll('.stat-value');
    if (cards.length >= 5) {
      cards[0].textContent = activeJobs;
      cards[1].textContent = needsReview;
      cards[2].textContent = pendingQuotes;
      cards[3].textContent = completedJobs;
      cards[4].textContent = totalInspections;
    }
  } catch (_) {
    // Stat failures are silent — dashboard is still useful without them
  }
}

async function loadQuotes() {
  const el = document.getElementById('quotes-list');
  if (!el) return;

  try {
    const res    = await api.listQuotes({ status: 'review' });
    const quotes = res.data ?? [];

    if (quotes.length === 0) {
      el.innerHTML = `
        <div class="empty-state" style="padding:32px">
          <div class="empty-icon">${_ico.dollar}</div>
          <p>No quotes pending approval</p>
          <button class="btn btn-ghost btn-sm mt-1" onclick="window._navigate('/quotes')">Go to Quote Builder</button>
        </div>
      `;
      return;
    }

    el.innerHTML = `<table>
      <thead><tr>
        <th>Inspection</th>
        <th>Created</th>
        <th>Items</th>
        <th>Total</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${quotes.slice(0, 5).map(q => {
          const total = (q.line_items ?? []).reduce((s, i) => s + (i.qty ?? 1) * (i.unitPrice ?? 0), 0);
          return `<tr>
            <td style="font-size:.82rem">${q.inspection_id?.slice(0, 12) ?? '—'}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${relativeTime(q.created_at)}</td>
            <td style="font-size:.82rem">${(q.line_items ?? []).length} items</td>
            <td style="font-weight:600;color:var(--brand)">${total > 0 ? '$' + total.toLocaleString() : '—'}</td>
            <td><button class="btn btn-primary btn-sm" onclick="window._navigate('/quotes')">Review</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="padding:24px"><p style="color:var(--danger);font-size:.82rem">${err.message}</p></div>`;
  }
}

async function loadInspections() {
  const el = document.getElementById('inspections-list');
  if (!el) return;

  try {
    const res          = await api.listInspections({ exclude: 'draft,cancelled' });
    const inspections  = (res.data ?? []).slice(0, 5);

    if (inspections.length === 0) {
      el.innerHTML = `
        <div class="empty-state" style="padding:32px">
          <div class="empty-icon">${_ico.emptyDoc}</div>
          <p>No inspections submitted yet</p>
          <button class="btn btn-primary btn-sm mt-1" onclick="window._navigate('/inspection/new')">+ Start Inspection</button>
        </div>
      `;
      return;
    }

    const stateBadge = {
      submitted:  '<span class="badge badge-yellow">Needs Review</span>',
      processing: '<span class="badge badge-orange">Processing</span>',
      complete:   '<span class="badge badge-green">Complete</span>',
      failed:     '<span class="badge badge-red">Failed</span>',
    };

    el.innerHTML = `<table>
      <thead><tr>
        <th>Address</th>
        <th>Type</th>
        <th>Submitted</th>
        <th>Status</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${inspections.map(i => {
          const defCount = (i.deficiencies ?? []).length;
          return `<tr>
            <td style="font-weight:600;font-size:.85rem">${i.address ?? '—'}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${i.inspection_type ?? '—'}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${relativeTime(i.created_at)}</td>
            <td>
              ${stateBadge[i.state] ?? `<span class="badge badge-gray">${i.state}</span>`}
              ${defCount > 0 ? `<span class="badge badge-red" style="margin-left:4px">${defCount} def.</span>` : ''}
            </td>
            <td><button class="btn btn-ghost btn-sm" onclick="window._navigate('/inspections')">Review</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="padding:24px"><p style="color:var(--danger);font-size:.82rem">${err.message}</p></div>`;
  }
}

async function loadActiveJobs() {
  const el = document.getElementById('today-jobs');
  if (!el) return;

  try {
    const res  = await api.listJobs();
    const jobs = (res.data ?? []).filter(j => j.state !== 'cancelled' && j.state !== 'completed').slice(0, 8);

    if (jobs.length === 0) {
      el.innerHTML = `
        <div class="empty-state" style="padding:32px">
          <div class="empty-icon">${_ico.emptyJobs}</div>
          <p>No active jobs</p>
          <p style="font-size:.8rem;color:var(--text-muted);margin-top:4px">Jobs are created when a customer accepts a quote</p>
        </div>
      `;
      return;
    }

    const statusBadge = {
      pending:     '<span class="badge badge-gray">Pending</span>',
      scheduled:   '<span class="badge badge-blue">Scheduled</span>',
      in_progress: '<span class="badge badge-orange">In Progress</span>',
      failed:      '<span class="badge badge-red">Failed</span>',
    };

    el.innerHTML = `<table>
      <thead><tr>
        <th>Job ID</th>
        <th>Inspection</th>
        <th>Technician</th>
        <th>Scheduled</th>
        <th>Status</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${jobs.map(j => `<tr>
          <td style="font-size:.78rem;font-family:monospace;color:var(--text-muted)">${j.id.slice(0, 8)}</td>
          <td style="font-size:.82rem">${j.inspection_id?.slice(0, 12) ?? '—'}</td>
          <td style="font-size:.82rem">${j.technician_id?.slice(0, 10) ?? 'Unassigned'}</td>
          <td style="font-size:.78rem;color:var(--text-muted)">${j.scheduled_date ?? '—'}</td>
          <td>${statusBadge[j.state] ?? `<span class="badge badge-gray">${j.state}</span>`}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="window._navigate('/pipeline')">View</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="padding:24px"><p style="color:var(--danger);font-size:.82rem">${err.message}</p></div>`;
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return '—';
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins  < 1)  return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  const hrs   = Math.floor(mins / 60);
  if (hrs   < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
