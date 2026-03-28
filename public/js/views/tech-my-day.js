/**
 * tech-my-day.js — Technician "My Day" screen
 * Loads today's jobs from the real API (/v1/jobs?technician_id=&date=today),
 * enriches each with its linked inspection record for address/type/notes,
 * and provides one-tap Start / Complete actions that call the backend.
 */

import { api } from '../api.js';
import { notify } from '../toast.js';
import { getCurrentUser } from '../auth.js';

// Module-level job list so event handlers can mutate it without a full re-render
let todayJobs = [];
let activeJobId = null;

// ── Entry point ──────────────────────────────────────────────────────────────

export async function renderMyDay(container) {
  const user     = getCurrentUser();
  const name     = user?.email?.split('@')[0] ?? 'Technician';
  const techId   = user?.id ?? user?.sub ?? null;
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Skeleton while loading
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${greeting}, ${name}</div>
        <div class="page-subtitle">Loading your schedule…</div>
      </div>
      <div class="flex-row">
        <button class="btn btn-ghost btn-sm" onclick="window._navigate('/inspection/new')">+ New Inspection</button>
      </div>
    </div>
    <div class="loading-overlay"><div class="spinner"></div></div>
  `;

  try {
    todayJobs = await _loadTodayJobs(techId);
  } catch (err) {
    container.innerHTML += `
      <div class="card" style="margin-top:24px">
        <div class="empty-state">
          <div class="empty-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <p style="color:var(--danger)">${err.message}</p>
        </div>
      </div>
    `;
    return;
  }

  // Default active job: first in_progress, or first upcoming, or first overall
  activeJobId = (
    todayJobs.find(j => j._state === 'in_progress') ??
    todayJobs.find(j => j._state === 'scheduled')   ??
    todayJobs[0]
  )?.id ?? null;

  _renderFull(container, name, greeting);
  _bindEvents(container);
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function _loadTodayJobs(techId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const params = { date: today };
  if (techId) params.technician_id = techId;

  const res = await api.listJobs(params);
  const jobs = (res.data ?? []).filter(j => j.state !== 'cancelled');

  if (jobs.length === 0) return [];

  // Enrich each job with inspection data (in parallel, non-fatal)
  const enriched = await Promise.all(jobs.map(async (job) => {
    let insp = null;
    if (job.inspection_id) {
      try {
        const inspRes = await api.getInspection(job.inspection_id);
        insp = inspRes.data ?? null;
      } catch (_) { /* inspection fetch is best-effort */ }
    }
    return _mapJob(job, insp);
  }));

  return enriched;
}

/**
 * Map a raw job + optional inspection to the display shape expected by the
 * card and panel renderers.
 */
function _mapJob(job, insp) {
  // Derive a display status from job state
  const statusMap = {
    pending:     'upcoming',
    scheduled:   'upcoming',
    in_progress: 'in_progress',
    completed:   'completed',
    failed:      'completed',   // show as done so it doesn't block the list
  };

  return {
    id:       job.id,
    _state:   job.state,   // raw state for API calls

    time:     job.time_slot ?? '—',
    duration: '—',          // not stored in current data model

    address:  insp?.address ?? '—',
    city:     '',           // address includes city in this model
    contact:  '',           // not stored; future field
    phone:    '',

    type:     insp?.inspection_type ?? 'Inspection',
    system:   '',           // not stored; future field
    notes:    insp?.notes  ?? '',

    status:   statusMap[job.state] ?? 'upcoming',
    priority: 'normal',     // not stored in current model

    _inspectionSubmitted: (insp?.state === 'submitted' || insp?.state === 'processing' ||
                           insp?.state === 'complete'),
  };
}

// ── Full render ──────────────────────────────────────────────────────────────

function _renderFull(container, name, greeting) {
  const completed = todayJobs.filter(j => j.status === 'completed').length;
  const remaining = todayJobs.filter(j => j.status !== 'completed').length;
  const total     = todayJobs.length;
  const pct       = total > 0 ? Math.round(completed / total * 100) : 0;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${greeting}, ${name}</div>
        <div class="page-subtitle" id="day-subtitle">${completed} completed · ${remaining} remaining today</div>
      </div>
      <div class="flex-row">
        <button class="btn btn-ghost btn-sm" onclick="window._navigate('/inspection/new')">+ New Inspection</button>
      </div>
    </div>

    <!-- Progress bar -->
    <div style="margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.78rem;color:var(--text-muted)">
        <span>Daily Progress</span>
        <span id="progress-label">${completed}/${total} jobs</span>
      </div>
      <div style="height:6px;background:var(--bg-raised);border-radius:99px;overflow:hidden">
        <div id="progress-bar" style="height:100%;width:${pct}%;background:var(--brand);border-radius:99px;transition:width .4s ease"></div>
      </div>
    </div>

    ${total === 0 ? `
      <div class="card">
        <div class="empty-state" style="padding:48px">
          <div class="empty-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg></div>
          <p style="font-size:1rem;font-weight:600">No jobs scheduled for today</p>
          <p style="font-size:.82rem;color:var(--text-muted);margin-top:4px">Check back later or ask your admin to assign work</p>
        </div>
      </div>
    ` : `
      <!-- FIELD FIX: tech-day-layout stacks to single column on mobile via CSS -->
      <div class="tech-day-layout" style="display:grid;grid-template-columns:1fr 380px;gap:20px;align-items:start">

        <!-- Left: job list -->
        <div>
          <div class="section-title" style="margin-bottom:12px">Today's Jobs</div>
          <div style="display:flex;flex-direction:column;gap:10px" id="jobs-list">
            ${todayJobs.map(job => _jobCard(job)).join('')}
          </div>
        </div>

        <!-- Right: active job detail -->
        <div class="tech-day-panel" style="position:sticky;top:80px" id="active-job-panel">
          ${_activeJobPanel(todayJobs.find(j => j.id === activeJobId))}
        </div>
      </div>
    `}
  `;
}

// ── Card + panel renderers ───────────────────────────────────────────────────

function _jobCard(job) {
  const isActive    = job.id === activeJobId;
  const priorityDot = job.priority === 'high'
    ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--danger);display:inline-block;margin-right:6px"></span>'
    : '';

  const statusBadge = {
    'in_progress': '<span class="badge badge-orange">In Progress</span>',
    'upcoming':    '<span class="badge badge-blue">Upcoming</span>',
    'completed':   '<span class="badge badge-green">✓ Done</span>',
  };

  const timeParts = job.time.split(' ');

  return `
    <div class="job-card-tech ${isActive ? 'active' : ''}" id="jobcard-${job.id}"
      onclick="window._selectJob('${job.id}')">
      <div class="job-time-block">
        <div class="job-time">${timeParts[0]}</div>
        <div class="job-duration" style="font-size:.62rem">${timeParts[1] ?? ''}</div>
        <div class="job-duration">${job.duration}</div>
      </div>
      <div class="job-divider"></div>
      <div class="job-card-body">
        <div class="flex-between">
          <div class="job-address">${priorityDot}${_esc(job.address)}</div>
          ${statusBadge[job.status] ?? ''}
        </div>
        <div class="job-meta-row">
          <span>🔧 ${_esc(job.type)}</span>
          ${job.city ? `<span>${_esc(job.city)}</span>` : ''}
          ${job.phone ? `<a href="tel:${_esc(job.phone)}" onclick="event.stopPropagation()"
            style="color:var(--brand);font-weight:600">📞 Call</a>` : ''}
        </div>
        ${isActive && job.status === 'in_progress' ? `
          <div class="job-actions">
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();window._navigate('/inspection/new')">
              Open Inspection Form
            </button>
          </div>
        ` : ''}
        ${isActive && job.status === 'upcoming' ? `
          <div class="job-actions">
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();window._startJob('${job.id}')">
              ▶ Start Job
            </button>
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();window._getDirections('${job.address}')">
              🗺 Directions
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function _activeJobPanel(job) {
  if (!job) return `<div class="card"><div class="empty-state"><div class="empty-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1"/></svg></div><p>Select a job to see details</p></div></div>`;

  const priorityBadge = job.priority === 'high'
    ? '<span class="badge badge-red">High Priority</span>'
    : '<span class="badge badge-gray">Normal</span>';

  return `
    <div class="card">
      <div class="flex-between" style="margin-bottom:16px">
        <div class="section-title">Active Job</div>
        ${priorityBadge}
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        <!-- Address -->
        <div style="background:var(--bg-raised);border-radius:var(--r-md);padding:14px">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:4px">Location</div>
          <div style="font-weight:700;font-size:.95rem">${_esc(job.address)}</div>
          ${job.city ? `<div style="font-size:.82rem;color:var(--text-muted)">${_esc(job.city)}</div>` : ''}
          <button class="btn btn-ghost btn-sm mt-1" onclick="window._getDirections('${_esc(job.address)}')">
            🗺 Get Directions
          </button>
        </div>

        ${job.contact || job.phone ? `
          <!-- Contact -->
          <div style="background:var(--bg-raised);border-radius:var(--r-md);padding:14px">
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:4px">👤 Contact</div>
            ${job.contact ? `<div style="font-size:.875rem;font-weight:600">${_esc(job.contact)}</div>` : ''}
            ${job.phone   ? `<a href="tel:${_esc(job.phone)}" style="font-size:.82rem;color:var(--brand);margin-top:4px;display:block">${_esc(job.phone)}</a>` : ''}
          </div>
        ` : ''}

        <!-- System / type info -->
        <div style="background:var(--bg-raised);border-radius:var(--r-md);padding:14px">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:4px">🔧 Inspection Type</div>
          <div style="font-size:.875rem;font-weight:600">${_esc(job.type)}</div>
          ${job.system ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">${_esc(job.system)}</div>` : ''}
        </div>

        <!-- Notes -->
        ${job.notes ? `
          <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:var(--r-md);padding:12px">
            <div style="font-size:.72rem;color:var(--warning);font-weight:700;margin-bottom:4px">📝 Notes</div>
            <div style="font-size:.82rem;color:var(--text-subtle)">${_esc(job.notes)}</div>
          </div>
        ` : ''}

        <!-- CTA buttons -->
        ${job.status === 'upcoming' ? `
          <button class="btn btn-primary btn-lg" id="start-btn-${job.id}"
            style="width:100%;justify-content:center;margin-top:4px"
            onclick="window._startJob('${job.id}')">
            ▶ Start This Job
          </button>
        ` : ''}
        ${job.status === 'in_progress' ? `
          <button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:4px"
            onclick="window._navigate('/inspection/new')">
            Open Inspection Form
          </button>
          <button class="btn btn-success btn-sm" id="complete-btn-${job.id}"
            style="width:100%;justify-content:center"
            onclick="window._completeJob('${job.id}')">
            ✓ Mark Complete
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Event handlers (wired to window for inline onclick compat) ────────────────

function _bindEvents(container) {
  window._selectJob = (id) => {
    activeJobId = id;
    document.querySelectorAll('.job-card-tech').forEach(el => el.classList.remove('active'));
    document.getElementById(`jobcard-${id}`)?.classList.add('active');
    const panel = document.getElementById('active-job-panel');
    if (panel) {
      panel.innerHTML = _activeJobPanel(todayJobs.find(j => j.id === id));
      // FIELD FIX: on mobile the panel is below the list — scroll it into view
      if (window.innerWidth <= 768) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  window._startJob = async (id) => {
    const job = todayJobs.find(j => j.id === id);
    if (!job) return;

    // Optimistic UI update
    job.status = 'in_progress';
    job._state = 'in_progress';
    activeJobId = id;
    _refreshList();
    _refreshPanel(job);

    try {
      await api.startJob(id);
      notify.success('Job started! Fill in the inspection form when ready.');
    } catch (err) {
      // Roll back
      job.status = 'upcoming';
      job._state = 'scheduled';
      _refreshList();
      _refreshPanel(job);
      notify.error(`Could not start job: ${err.message}`);
    }
  };

  window._completeJob = async (id) => {
    const job = todayJobs.find(j => j.id === id);
    if (!job) return;

    // FIELD FIX: guard against closing a job with no inspection submitted
    if (!job._inspectionSubmitted) {
      if (!confirm(
        'No inspection report has been submitted for this job.\n\n' +
        'Mark complete anyway? (An inspection report should normally be filed.)'
      )) return;
    }

    // Optimistic UI update
    job.status = 'completed';
    job._state = 'completed';
    _refreshList();
    _refreshPanel(job);
    _refreshProgress();

    try {
      await api.completeJob(id);
      notify.success('Job marked complete!');
    } catch (err) {
      // Roll back
      job.status = 'in_progress';
      job._state = 'in_progress';
      _refreshList();
      _refreshPanel(job);
      _refreshProgress();
      notify.error(`Could not complete job: ${err.message}`);
    }
  };

  window._getDirections = (address) => {
    const encoded = encodeURIComponent(address);
    window.open(`https://maps.google.com/?q=${encoded}`, '_blank');
  };
}

// ── Targeted re-render helpers ────────────────────────────────────────────────

function _refreshList() {
  const list = document.getElementById('jobs-list');
  if (list) list.innerHTML = todayJobs.map(j => _jobCard(j)).join('');
}

function _refreshPanel(job) {
  const panel = document.getElementById('active-job-panel');
  if (panel) panel.innerHTML = _activeJobPanel(job);
}

function _refreshProgress() {
  const completed = todayJobs.filter(j => j.status === 'completed').length;
  const total     = todayJobs.length;
  const pct       = total > 0 ? Math.round(completed / total * 100) : 0;
  const remaining = total - completed;

  const bar     = document.getElementById('progress-bar');
  const label   = document.getElementById('progress-label');
  const sub     = document.getElementById('day-subtitle');
  if (bar)   bar.style.width = `${pct}%`;
  if (label) label.textContent = `${completed}/${total} jobs`;
  if (sub)   sub.textContent   = `${completed} completed · ${remaining} remaining today`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
