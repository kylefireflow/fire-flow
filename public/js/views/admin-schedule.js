/**
 * admin-schedule.js — Drag-and-drop schedule board with persistent assignments
 *
 * On load:
 *   - Fetches all pending + scheduled jobs from GET /v1/jobs
 *   - Scheduled jobs (those with time_slot + technician_id) are pre-populated
 *     into the grid so the board survives page reloads.
 *   - Pending jobs (not yet assigned) land in the unscheduled pool.
 *
 * On drop:
 *   - Calls POST /v1/job/:id/assign to persist { technician_id, time_slot }.
 *   - The job transitions pending → scheduled on the server.
 *   - Drag back to pool shows the job as pending again (server keeps state).
 */

import { api }    from '../api.js';
import { notify } from '../toast.js';

const TECHS = [
  { id: 'tech_1', name: 'Marcus J.', avatar: 'MJ' },
  { id: 'tech_2', name: 'Sarah K.',  avatar: 'SK' },
  { id: 'tech_3', name: 'Devon R.',  avatar: 'DR' },
];

const TIME_SLOTS = [
  '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
  '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
];

// In-memory grid: { [techId_timeSlot]: jobBlock }
// Pre-populated from the server on load; updated on every drop.
let schedule    = {};

let draggedJob  = null;
let draggedFrom = null;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderSchedule(container) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Schedule Board</div>
        <div class="page-subtitle">${today}</div>
      </div>
      <div class="flex-row">
        <button class="btn btn-ghost btn-sm" id="prev-day">← Yesterday</button>
        <button class="btn btn-ghost btn-sm" id="next-day">Tomorrow →</button>
        <button class="btn btn-primary" id="add-job-btn">+ Add Job</button>
      </div>
    </div>

    <!-- Tech legend -->
    <div class="flex-row" style="margin-bottom:16px;flex-wrap:wrap;gap:10px" id="tech-legend">
      ${TECHS.map(t => `
        <div class="flex-row" style="gap:8px;padding:6px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:99px">
          <div class="avatar" style="width:22px;height:22px;font-size:.65rem">${t.avatar}</div>
          <span style="font-size:.82rem;font-weight:500">${t.name}</span>
          <span class="badge badge-blue" style="font-size:.65rem" id="legend-count-${t.id}">0 jobs</span>
        </div>
      `).join('')}
      <div style="margin-left:auto;font-size:.78rem;color:var(--text-muted)">Drag jobs between time slots to reschedule</div>
    </div>

    <!-- Unscheduled pool -->
    <div style="margin-bottom:16px">
      <div class="section-header">
        <div class="section-title">Unscheduled Jobs</div>
        <span class="badge badge-yellow" id="unscheduled-count">…</span>
      </div>
      <div id="unscheduled-pool" style="
        display:flex;gap:10px;flex-wrap:wrap;
        min-height:64px;padding:12px;
        background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg)
      " ondragover="event.preventDefault();this.classList.add('drag-over')"
         ondragleave="this.classList.remove('drag-over')"
         ondrop="window._dropToUnscheduled(event,this)">
        <div style="color:var(--text-muted);font-size:.8rem;display:flex;align-items:center;gap:8px" id="pool-placeholder">
          <div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Loading jobs…
        </div>
      </div>
    </div>

    <!-- Grid -->
    <div style="overflow-x:auto">
      <div id="schedule-grid"></div>
    </div>

    <!-- Add job modal placeholder -->
    <div id="add-job-modal"></div>
  `;

  bindEvents(container);

  // ── Load all pending + scheduled jobs from the server ────────────────────────
  try {
    // Fetch both states in parallel
    const [pendingRes, scheduledRes] = await Promise.all([
      api.listJobs({ status: 'pending' }),
      api.listJobs({ status: 'scheduled' }),
    ]);

    const pendingJobs   = pendingRes.data   ?? [];
    const scheduledJobs = scheduledRes.data ?? [];

    // Pre-populate the grid from scheduled jobs that have slot metadata
    schedule = {};
    for (const job of scheduledJobs) {
      if (job.technician_id && job.time_slot) {
        const key = `${job.technician_id}_${job.time_slot}`;
        schedule[key] = toJobBlock(job);
      }
    }

    // Render grid with the pre-loaded assignments
    renderGrid();
    updateLegendCounts();

    // Populate the unscheduled pool
    const pool        = document.getElementById('unscheduled-pool');
    const placeholder = document.getElementById('pool-placeholder');
    const countEl     = document.getElementById('unscheduled-count');

    // Scheduled jobs that are missing slot data also go into the pool
    const unassignedScheduled = scheduledJobs.filter(j => !j.technician_id || !j.time_slot);
    const unscheduledAll = [...pendingJobs, ...unassignedScheduled];

    if (countEl) countEl.textContent = unscheduledAll.length + ' unscheduled';

    if (unscheduledAll.length === 0) {
      if (placeholder) placeholder.innerHTML = 'No unscheduled jobs — drag from below or jobs appear here when customers accept quotes.';
    } else {
      if (placeholder) placeholder.remove();
      for (const job of unscheduledAll) {
        if (pool) pool.insertAdjacentHTML('beforeend', unscheduledCard(toJobBlock(job)));
      }
    }
  } catch (_) {
    const placeholder = document.getElementById('pool-placeholder');
    if (placeholder) placeholder.innerHTML = '<span style="color:var(--text-muted)">Could not load jobs — check server connection.</span>';
    renderGrid(); // still show the empty grid
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toJobBlock(job) {
  return {
    id:           job.id,
    address:      job.address ?? job.inspection_id?.slice(0, 12) ?? job.id.slice(0, 8),
    type:         job.inspection_type ?? 'Inspection',
    duration:     job.duration ?? '2h',
    technician_id: job.technician_id ?? null,
    time_slot:    job.time_slot ?? null,
  };
}

function countJobs(techId) {
  return Object.keys(schedule).filter(k => k.startsWith(techId + '_')).length;
}

function updateLegendCounts() {
  for (const t of TECHS) {
    const el = document.getElementById(`legend-count-${t.id}`);
    if (el) el.textContent = countJobs(t.id) + ' jobs';
  }
}

function unscheduledCard(job) {
  return `
    <div class="schedule-job-block" draggable="true"
      data-job-id="${job.id}"
      data-job-address="${job.address}"
      data-job-type="${job.type}"
      data-job-duration="${job.duration}"
      ondragstart="window._dragStart(event,'unscheduled',null)"
      style="cursor:grab;min-width:140px">
      <div style="font-weight:600;font-size:.78rem;margin-bottom:2px">${job.address}</div>
      <div style="font-size:.72rem;color:var(--text-muted)">${job.type} · ${job.duration}</div>
    </div>
  `;
}

// ── Grid render ───────────────────────────────────────────────────────────────

function renderGrid() {
  const grid = document.getElementById('schedule-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const techCount = TECHS.length;
  grid.style.cssText = `
    display:grid;
    grid-template-columns: 90px repeat(${techCount}, 1fr);
    border:1px solid var(--border);
    border-radius:var(--r-lg);
    overflow:hidden;
    min-width:${90 + techCount * 220}px;
  `;

  // Header row
  const timeHeader = document.createElement('div');
  timeHeader.style.cssText = 'padding:12px;background:var(--bg-raised);border-right:1px solid var(--border);border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px';
  timeHeader.textContent = 'Time';
  grid.appendChild(timeHeader);

  for (const t of TECHS) {
    const th = document.createElement('div');
    th.style.cssText = 'padding:12px 14px;background:var(--bg-raised);border-right:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px';
    th.innerHTML = `
      <div class="avatar" style="width:24px;height:24px;font-size:.68rem">${t.avatar}</div>
      <div>
        <div style="font-size:.82rem;font-weight:700">${t.name}</div>
        <div style="font-size:.7rem;color:var(--text-muted)" id="grid-count-${t.id}">${countJobs(t.id)} jobs today</div>
      </div>
    `;
    grid.appendChild(th);
  }

  // Time slot rows
  TIME_SLOTS.forEach((slot, i) => {
    const isLast = i === TIME_SLOTS.length - 1;

    const timeCell = document.createElement('div');
    timeCell.style.cssText = `
      padding:14px 10px;background:var(--bg-raised);
      border-right:1px solid var(--border);
      ${!isLast ? 'border-bottom:1px solid var(--border);' : ''}
      font-size:.73rem;color:var(--text-muted);font-weight:600;
      display:flex;align-items:flex-start;
    `;
    timeCell.textContent = slot;
    grid.appendChild(timeCell);

    TECHS.forEach((tech, ti) => {
      const key        = `${tech.id}_${slot}`;
      const job        = schedule[key];
      const isLastTech = ti === TECHS.length - 1;

      const cell = document.createElement('div');
      cell.dataset.key   = key;
      cell.dataset.tech  = tech.id;
      cell.dataset.slot  = slot;
      cell.style.cssText = `
        padding:8px;min-height:68px;
        ${!isLastTech ? 'border-right:1px solid var(--border);' : ''}
        ${!isLast ? 'border-bottom:1px solid var(--border);' : ''}
        position:relative;transition:background .15s ease;
      `;

      if (job) {
        cell.innerHTML = `
          <div class="schedule-job-block" draggable="true"
            data-job-id="${job.id}"
            data-job-address="${job.address}"
            data-job-type="${job.type}"
            data-job-duration="${job.duration || ''}"
            ondragstart="window._dragStart(event,'${key}',null)"
            style="height:100%;cursor:grab">
            <div style="font-weight:600;font-size:.78rem;margin-bottom:2px;color:var(--brand)">${job.address}</div>
            <div style="font-size:.7rem;color:var(--text-muted)">${job.type}</div>
            ${job.duration ? `<div style="font-size:.68rem;color:var(--text-muted);margin-top:2px">⏱ ${job.duration}</div>` : ''}
          </div>
        `;
      }

      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        cell.style.background = 'rgba(249,115,22,.08)';
      });
      cell.addEventListener('dragleave', () => { cell.style.background = ''; });
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.style.background = '';
        dropJob(tech.id, slot, key, e);
      });

      grid.appendChild(cell);
    });
  });
}

// ── Drop handlers ─────────────────────────────────────────────────────────────

async function dropJob(techId, slot, targetKey, _e) {
  if (!draggedJob) return;

  // Optimistic update — show immediately, persist in background
  if (draggedFrom && draggedFrom !== 'unscheduled') delete schedule[draggedFrom];
  schedule[targetKey] = { ...draggedJob, technician_id: techId, time_slot: slot };

  const jobId = draggedJob.id;
  draggedJob  = null;
  draggedFrom = null;

  renderGrid();
  updateLegendCounts();

  // Persist to server
  try {
    await api.assignJob(jobId, {
      technician_id:  techId,
      time_slot:      slot,
      scheduled_date: new Date().toISOString().split('T')[0],
    });
    notify.success('Job scheduled and saved');
  } catch (err) {
    // Roll back optimistic update if the server rejected it
    delete schedule[targetKey];
    renderGrid();
    updateLegendCounts();
    notify.error('Could not save schedule: ' + err.message);
  }
}

function bindEvents(container) {
  window._dragStart = (e, from) => {
    const el    = e.currentTarget ?? e.target;
    draggedFrom = from;
    draggedJob  = {
      id:       el.dataset.jobId,
      address:  el.dataset.jobAddress,
      type:     el.dataset.jobType,
      duration: el.dataset.jobDuration,
    };
    e.dataTransfer.effectAllowed = 'move';
  };

  window._dropToUnscheduled = (e, poolEl) => {
    e.preventDefault();
    poolEl.classList.remove('drag-over');
    if (!draggedJob) return;

    // Remove from grid
    if (draggedFrom && draggedFrom !== 'unscheduled') {
      delete schedule[draggedFrom];
    }

    // Add back to the pool visually
    poolEl.insertAdjacentHTML('beforeend', unscheduledCard(draggedJob));

    const jobId = draggedJob.id;
    draggedJob  = null;
    draggedFrom = null;

    renderGrid();
    updateLegendCounts();
    notify.info('Job returned to unscheduled pool');

    // The job state stays 'scheduled' on the server — it will be re-assigned
    // when the admin drops it onto a new slot.  No explicit server call needed.
    void jobId;
  };

  document.getElementById('add-job-btn')?.addEventListener('click', showAddJobModal);
}

// ── Add job modal ─────────────────────────────────────────────────────────────

function showAddJobModal() {
  const modal = document.getElementById('add-job-modal');
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Add Job to Schedule</div>
          <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="form-group">
            <label class="form-label">Property Address</label>
            <input class="form-input" id="new-job-address" placeholder="123 Main St">
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Inspection Type</label>
              <select class="form-select" id="new-job-type">
                <option>Annual Sprinkler</option>
                <option>Quarterly Sprinkler</option>
                <option>Standpipe</option>
                <option>Fire Alarm</option>
                <option>Kitchen Hood</option>
                <option>Backflow</option>
                <option>Fire Extinguisher</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Assign Technician</label>
              <select class="form-select" id="new-job-tech">
                ${TECHS.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Time Slot</label>
              <select class="form-select" id="new-job-time">
                ${TIME_SLOTS.map(t => `<option>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Duration</label>
              <select class="form-select" id="new-job-duration">
                <option>1h</option><option>1.5h</option><option selected>2h</option>
                <option>2.5h</option><option>3h</option><option>4h</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button class="btn btn-primary" id="save-job-btn">Add to Schedule</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('save-job-btn').addEventListener('click', () => {
    const address  = document.getElementById('new-job-address').value.trim();
    const type     = document.getElementById('new-job-type').value;
    const techId   = document.getElementById('new-job-tech').value;
    const timeSlot = document.getElementById('new-job-time').value;
    const duration = document.getElementById('new-job-duration').value;

    if (!address) { notify.error('Address is required'); return; }

    const key = `${techId}_${timeSlot}`;
    if (schedule[key]) { notify.error('That time slot is already booked'); return; }

    schedule[key] = {
      id:       'local_' + Date.now(),
      address, type, duration,
      technician_id: techId,
      time_slot:     timeSlot,
    };

    modal.querySelector('.modal-backdrop').remove();
    renderGrid();
    updateLegendCounts();
    notify.success('Job added to schedule');
  });
}
