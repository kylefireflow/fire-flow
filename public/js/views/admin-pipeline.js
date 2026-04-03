/**
 * admin-pipeline.js — Job pipeline kanban board
 * Data loaded live from GET /v1/jobs and GET /v1/inspections.
 *
 * Stage mapping:
 *  Backend job state  pending / scheduled  → booked
 *  Backend job state  in_progress          → in_progress
 *  Backend job state  completed            → completed
 *  Inspection state   submitted / failed   → needs_review   (no job created yet)
 *  Quote state        review / sent        → quoted
 *  Quote state        accepted             → approved
 */

import { api } from '../api.js';
import { notify } from '../toast.js';

const STAGES = [
  { id: 'booked',       label: 'Booked',        color: 'badge-blue',   icon: '' },
  { id: 'in_progress',  label: 'In Progress',   color: 'badge-orange', icon: '⚙️' },
  { id: 'needs_review', label: 'Needs Review',  color: 'badge-yellow', icon: '' },
  { id: 'quoted',       label: 'Quoted',        color: 'badge-blue',   icon: '' },
  { id: 'approved',     label: 'Approved',      color: 'badge-green',  icon: '✅' },
  { id: 'completed',    label: 'Completed',     color: 'badge-gray',   icon: '' },
];

// Module-level jobs store keyed by stage — populated from API
let jobs = { booked: [], in_progress: [], needs_review: [], quoted: [], approved: [], completed: [] };

let draggingJob  = null;
let draggingFrom = null;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderPipeline(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">⚙️ Job Pipeline</div>
        <div class="page-subtitle" id="pipeline-subtitle">Loading…</div>
      </div>
      <div class="flex-row">
        <input class="form-input" style="width:200px" placeholder="Filter jobs…" id="pipeline-filter" oninput="window._filterPipeline(this.value)">
        <button class="btn btn-primary" onclick="window._navigate('/inspection/new')">+ New Inspection</button>
      </div>
    </div>

    <div class="pipeline-board" id="pipeline-board">
      ${STAGES.map(s => `
        <div class="pipeline-col" data-stage="${s.id}">
          <div class="pipeline-col-header">
            <div class="pipeline-col-title">${s.icon} ${s.label}</div>
            <div class="pipeline-col-count">—</div>
          </div>
          <div class="pipeline-cards" id="col-${s.id}">
            <div style="padding:20px;text-align:center">
              <div class="spinner" style="margin:0 auto"></div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div id="job-detail-modal"></div>
  `;

  bindDragDrop();
  window._filterPipeline = filterPipeline;

  await loadPipelineData();
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadPipelineData() {
  try {
    const [inspsRes, jobsRes, quotesRes] = await Promise.all([
      api.listInspections({ exclude: 'draft,cancelled' }),
      api.listJobs(),
      api.listQuotes(),
    ]);

    const inspections = inspsRes.data  ?? [];
    const allJobs     = jobsRes.data   ?? [];
    const allQuotes   = quotesRes.data ?? [];

    // Build lookup maps
    const inspById        = {};
    const quoteByInspId   = {};
    for (const i of inspections) inspById[i.id] = i;
    for (const q of allQuotes)   { if (q.inspection_id) quoteByInspId[q.inspection_id] = q; }

    // Reset
    jobs = { booked: [], in_progress: [], needs_review: [], quoted: [], approved: [], completed: [] };

    // ── Map backend jobs to pipeline ──────────────────────────────────────────
    for (const job of allJobs) {
      const insp  = inspById[job.inspection_id] ?? {};
      const quote = quoteByInspId[job.inspection_id] ?? null;

      const card = {
        id:      job.id,
        address: insp.address ?? `Job ${job.id.slice(0, 8)}`,
        type:    insp.inspection_type ?? 'Inspection',
        tech:    job.technician_id ? job.technician_id.slice(0, 8) : 'Unassigned',
        _raw:    job,
      };

      if (job.state === 'pending' || job.state === 'scheduled') {
        jobs.booked.push({ ...card, scheduled: job.scheduled_date ?? 'TBD' });
      } else if (job.state === 'in_progress') {
        jobs.in_progress.push({ ...card, started: relativeTime(job.updated_at) });
      } else if (job.state === 'completed') {
        jobs.completed.push({ ...card, completedDate: relativeTime(job.updated_at) });
      }
      // failed jobs stay out of the board for now
    }

    // ── Map inspections without jobs to pipeline stages ───────────────────────
    // Inspections that don't have an associated job flow through the pipeline
    // based on their own state and linked quote state.
    const inspIdsWithJob = new Set(allJobs.map(j => j.inspection_id).filter(Boolean));

    for (const insp of inspections) {
      if (insp.state === 'draft' || insp.state === 'cancelled') continue;
      if (inspIdsWithJob.has(insp.id)) continue;  // already mapped via job above

      const quote = quoteByInspId[insp.id] ?? null;
      const deficiencyCount = (insp.deficiencies ?? []).length;

      const card = {
        id:      insp.id,
        address: insp.address ?? 'Unknown Address',
        type:    insp.inspection_type ?? 'Inspection',
        tech:    insp.technician_id ? insp.technician_id.slice(0, 8) : 'Unknown',
        _raw:    insp,
      };

      if (!quote || quote.state === 'draft' || quote.state === 'failed') {
        // Submitted inspection with no usable quote → needs admin review
        jobs.needs_review.push({ ...card, deficiencies: deficiencyCount });
      } else if (quote.state === 'generating' || quote.state === 'review' || quote.state === 'sent') {
        const lineTotal = (quote.line_items ?? []).reduce((s, i) => s + (i.qty ?? 1) * (i.unitPrice ?? 0), 0);
        jobs.quoted.push({ ...card, quoteAmt: lineTotal > 0 ? '$' + lineTotal.toLocaleString() : 'TBD', _quoteId: quote.id });
      } else if (quote.state === 'accepted') {
        jobs.approved.push({ ...card, quoteAmt: '✓ Accepted', _quoteId: quote.id });
      }
    }

    reRenderBoard();

    // Update subtitle
    const total    = Object.values(jobs).reduce((s, a) => s + a.length, 0);
    const subtitle = document.getElementById('pipeline-subtitle');
    if (subtitle) subtitle.textContent = `${total} active jobs across ${STAGES.length} stages`;

  } catch (err) {
    // On error, show empty columns but surface the error
    reRenderBoard();
    notify.error('Failed to load pipeline: ' + err.message);
  }
}

function relativeTime(iso) {
  if (!iso) return 'Unknown';
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins  < 60) return `${mins}m ago`;
  const hrs   = Math.floor(mins / 60);
  if (hrs   < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Board rendering ───────────────────────────────────────────────────────────

function totalJobs() {
  return Object.values(jobs).reduce((sum, arr) => sum + arr.length, 0);
}

function renderColumn(stage) {
  const stageJobs = jobs[stage.id] ?? [];
  return `
    <div class="pipeline-col" data-stage="${stage.id}"
      ondragover="event.preventDefault()"
      ondrop="window._dropToStage('${stage.id}', event)">
      <div class="pipeline-col-header">
        <div class="pipeline-col-title">${stage.icon} ${stage.label}</div>
        <div class="pipeline-col-count">${stageJobs.length}</div>
      </div>
      <div class="pipeline-cards" id="col-${stage.id}">
        ${stageJobs.map(job => renderJobCard(job, stage)).join('')}
        ${stageJobs.length === 0 ? `
          <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:.78rem;opacity:.6">
            Drop here
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderJobCard(job, stage) {
  const actions = getCardActions(job, stage.id);
  return `
    <div class="pipeline-card" draggable="true" data-job-id="${job.id}" data-stage="${stage.id}"
      onclick="window._openJobDetail('${job.id}', '${stage.id}')">
      <div class="pipeline-card-id">${job.id.slice(0, 12)}</div>
      <div class="pipeline-card-title">${job.address}</div>
      <div class="pipeline-card-meta">
        <span>${job.type}</span>
        <span>${job.tech}</span>
        ${job.scheduled     ? `<span>${job.scheduled}</span>` : ''}
        ${job.started       ? `<span style="color:var(--brand)">▶ ${job.started}</span>` : ''}
        ${job.deficiencies  ? `<span style="color:var(--danger)">⚠ ${job.deficiencies} deficiencies</span>` : ''}
        ${job.quoteAmt      ? `<span style="color:var(--success)">${job.quoteAmt}</span>` : ''}
        ${job.completedDate ? `<span>✓ ${job.completedDate}</span>` : ''}
      </div>
      ${actions ? `<div class="flex-row mt-1" style="gap:6px">${actions}</div>` : ''}
    </div>
  `;
}

function getCardActions(job, stageId) {
  switch (stageId) {
    case 'needs_review':
      return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();window._navigate('/inspections')">Review Report</button>`;
    case 'quoted':
      return `
        <button class="btn btn-success btn-sm" onclick="event.stopPropagation();window._approveJobQuote('${job.id}')">Approve</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();window._rejectJobQuote('${job.id}')">Reject</button>
      `;
    case 'approved':
      return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation()">Assign & Schedule</button>`;
    default:
      return '';
  }
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

// BUG 11 FIX: extract board-level drag listener binding so it survives reRenderBoard() replacing innerHTML.
function bindBoardListeners() {
  const board = document.getElementById('pipeline-board');
  if (!board) return;

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.pipeline-card');
    if (!card) return;
    draggingFrom = card.dataset.stage;
    draggingJob  = findJob(card.dataset.jobId);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  board.addEventListener('dragend', (e) => {
    e.target.closest('.pipeline-card')?.classList.remove('dragging');
  });
}

function bindDragDrop() {
  window._dropToStage = (stageId, e) => {
    e.preventDefault();
    if (!draggingJob || !draggingFrom) return;
    if (draggingFrom === stageId) return;

    const idx = jobs[draggingFrom]?.findIndex(j => j.id === draggingJob.id) ?? -1;
    if (idx !== -1) jobs[draggingFrom].splice(idx, 1);
    jobs[stageId] = jobs[stageId] ?? [];
    jobs[stageId].push(draggingJob);

    draggingJob  = null;
    draggingFrom = null;

    reRenderBoard();
    notify.success('Job moved');
  };

  window._approveJobQuote = async (jobId) => {
    const job = findJob(jobId);
    if (!job) return;
    if (!job._quoteId) { notify.error('No quote ID found for this job'); return; }

    // Optimistic move
    _moveCard(jobId, 'approved');
    notify.success('Quote approved!');

    try {
      await api.approveQuote(job._quoteId);
    } catch (err) {
      // Roll back on failure
      _moveCard(jobId, 'quoted');
      notify.error('Failed to approve quote: ' + err.message);
    }
  };

  window._rejectJobQuote = async (jobId) => {
    const job = findJob(jobId);
    if (!job) return;
    if (!job._quoteId) { notify.error('No quote ID found for this job'); return; }

    const reason = window.prompt('Reason for rejection (optional):') ?? '';
    if (reason === null) return; // user cancelled the prompt

    // Optimistic move back to needs_review so admin can re-generate
    _moveCard(jobId, 'needs_review');
    notify.success('Quote rejected — moved back to Needs Review');

    try {
      await api.rejectQuote(job._quoteId, { reason: reason.trim() || 'Rejected by admin' });
    } catch (err) {
      // Roll back on failure
      _moveCard(jobId, 'quoted');
      notify.error('Failed to reject quote: ' + err.message);
    }
  };

  window._openJobDetail = (jobId, stageId) => {
    const job = findJob(jobId);
    if (!job) return;
    showJobDetail(job, stageId);
  };

  bindBoardListeners();
}

function findJob(jobId) {
  for (const arr of Object.values(jobs)) {
    const j = arr.find(j => j.id === jobId);
    if (j) return j;
  }
  return null;
}

function findJobStage(jobId) {
  for (const [stage, arr] of Object.entries(jobs)) {
    if (arr.find(j => j.id === jobId)) return stage;
  }
  return null;
}

// Move a card between pipeline stages and re-render
function _moveCard(jobId, toStage) {
  const from = findJobStage(jobId);
  const job  = findJob(jobId);
  if (!job) return;
  if (from) {
    const idx = jobs[from].findIndex(j => j.id === jobId);
    if (idx !== -1) jobs[from].splice(idx, 1);
  }
  jobs[toStage] = jobs[toStage] ?? [];
  jobs[toStage].push(job);
  reRenderBoard();
}

function reRenderBoard() {
  const board = document.getElementById('pipeline-board');
  if (!board) return;
  board.innerHTML = STAGES.map(s => renderColumn(s)).join('');
  // BUG 11 FIX: re-attach delegated drag listeners after innerHTML replacement
  bindBoardListeners();
}

function filterPipeline(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.pipeline-card').forEach(card => {
    card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ── Job detail modal ──────────────────────────────────────────────────────────

function showJobDetail(job, stageId) {
  const stage = STAGES.find(s => s.id === stageId);
  document.getElementById('job-detail-modal').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal" style="max-width:600px">
        <div class="modal-header">
          <div>
            <div class="modal-title">${job.address}</div>
            <div style="font-size:.8rem;color:var(--text-muted);margin-top:3px">
              ${job.id.slice(0, 16)} · <span class="badge ${stage?.color ?? 'badge-gray'}">${stage?.label ?? stageId}</span>
            </div>
          </div>
          <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">✕</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="grid-2" style="gap:12px">
            ${detailRow('Type',        job.type)}
            ${detailRow('Technician',  job.tech)}
            ${job.scheduled     ? detailRow('Scheduled',   job.scheduled)    : ''}
            ${job.started       ? detailRow('▶ Started',      job.started)      : ''}
            ${job.deficiencies != null ? detailRow('⚠ Deficiencies', `${job.deficiencies} found`) : ''}
            ${job.quoteAmt      ? detailRow('Quote',        job.quoteAmt)     : ''}
            ${job.completedDate ? detailRow('✓ Completed',    job.completedDate) : ''}
          </div>

          ${stageId === 'needs_review' ? `
            <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:var(--r-md);padding:14px">
              <div style="font-size:.82rem;font-weight:700;color:var(--danger);margin-bottom:8px">⚠ Deficiencies Require Review</div>
              <p style="font-size:.82rem;color:var(--text-muted)">This inspection has ${job.deficiencies ?? 0} deficiencies that need to be reviewed before a quote can be generated.</p>
            </div>
          ` : ''}
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="this.closest('.modal-backdrop').remove()">Close</button>
          ${stageId === 'needs_review' ? `<button class="btn btn-primary" onclick="this.closest('.modal-backdrop').remove();window._navigate('/inspections')">Review Inspection</button>` : ''}
          ${stageId === 'quoted' ? `
            <button class="btn btn-danger" onclick="this.closest('.modal-backdrop').remove();window._rejectJobQuote('${job.id}')">Reject</button>
            <button class="btn btn-success" onclick="this.closest('.modal-backdrop').remove();window._approveJobQuote('${job.id}')">Approve Quote</button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function detailRow(label, value) {
  return `
    <div style="background:var(--bg-raised);border-radius:var(--r-sm);padding:10px 12px">
      <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:3px">${label}</div>
      <div style="font-size:.88rem;font-weight:600">${value}</div>
    </div>
  `;
}
