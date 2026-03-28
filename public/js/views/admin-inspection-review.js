/**
 * admin-inspection-review.js — Review submitted inspection reports
 * Data is loaded live from GET /v1/inspections (excludes draft & cancelled).
 */

import { api } from '../api.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allInspections = [];  // raw API data
let displayList    = [];  // transformed for display
let selectedId     = null;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderInspectionReview(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Inspection Review</div>
        <div class="page-subtitle">Review submitted reports, flag deficiencies, and generate quotes</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:320px 1fr;gap:20px;align-items:start">
      <!-- Left: inspection list -->
      <div>
        <div class="section-header">
          <div class="section-title">Submitted Inspections</div>
          <span class="badge badge-yellow" id="insp-count">…</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px" id="inspection-list">
          <div class="card" style="text-align:center;padding:24px;color:var(--text-muted)">
            <div class="spinner" style="margin:0 auto 8px"></div>
            <div style="font-size:.82rem">Loading inspections…</div>
          </div>
        </div>
      </div>

      <!-- Right: detail view -->
      <div id="inspection-detail">
        <div class="card" style="text-align:center;padding:48px">
          <div class="empty-icon" style="margin:0 auto 12px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
          <div style="color:var(--text-muted)">Select an inspection to review</div>
        </div>
      </div>
    </div>
  `;

  window._selectInspection = (id) => {
    const insp = displayList.find(i => i.id === id);
    if (insp) selectInspection(insp);
  };

  await loadInspections();
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadInspections() {
  const listEl  = document.getElementById('inspection-list');
  const countEl = document.getElementById('insp-count');

  try {
    // Load all inspections except draft and cancelled — those are not ready for review
    const res = await api.listInspections({ exclude: 'draft,cancelled' });
    allInspections = res.data ?? [];
    displayList    = allInspections.map(toDisplayFormat);

    if (countEl) countEl.textContent = `${displayList.length} pending`;

    if (displayList.length === 0) {
      if (listEl) listEl.innerHTML = `
        <div class="card" style="text-align:center;padding:32px">
          <div class="empty-icon" style="margin:0 auto 8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
          <p style="color:var(--text-muted);font-size:.85rem">No inspections submitted yet.</p>
          <p style="color:var(--text-muted);font-size:.78rem;margin-top:4px">Technicians submit reports from the mobile inspection form.</p>
          <button class="btn btn-primary btn-sm mt-2" onclick="window._navigate('/inspection/new')">+ New Inspection (Test)</button>
        </div>
      `;
      return;
    }

    if (listEl) {
      listEl.innerHTML = displayList.map(insp => inspectionListItem(insp)).join('') + `
        <div class="card card-sm" style="color:var(--text-muted);font-size:.8rem;text-align:center;border-style:dashed">
          New inspections appear here as technicians submit
        </div>
      `;
    }

    // Auto-select first
    setTimeout(() => selectInspection(displayList[0]), 100);

  } catch (err) {
    if (countEl) countEl.textContent = 'Error';
    if (listEl) listEl.innerHTML = `
      <div class="card" style="text-align:center;padding:24px">
        <div class="empty-icon" style="margin:0 auto 8px;color:var(--danger);border-color:rgba(239,68,68,.2);background:var(--danger-dim)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <p style="color:var(--danger);font-size:.82rem">${err.message ?? 'Failed to load inspections'}</p>
        <button class="btn btn-ghost btn-sm mt-2" onclick="window._navigate('/inspections')">Retry</button>
      </div>
    `;
  }
}

// ── Data transform ────────────────────────────────────────────────────────────

function toDisplayFormat(insp) {
  // Normalize deficiencies — handle both tech-app format (checkpointCode) and legacy format (code)
  const deficiencies = (insp.deficiencies ?? []).map(d => ({
    ...d,
    code:          d.checkpointCode ?? d.code ?? '—',
    type:          d.type           || d._category || 'Issue',
    estimatedCost: d.estimatedCost  ? +d.estimatedCost : null,
    suggestedFix:  d.suggestedFix   ?? null,
  }));

  return {
    id:          insp.id,
    address:     insp.address      ?? 'Unknown Address',
    type:        insp.inspection_type ?? 'Inspection',
    tech:        insp.technician_id
                   ? insp.technician_id.slice(0, 8)
                   : 'Technician',
    submitted:   relativeTime(insp.created_at),
    status:      insp.state,
    system_type: insp.system_type  ?? insp.inspection_type ?? 'Unknown System',
    checkpoints: Array.isArray(insp.checkpoints)  ? insp.checkpoints  : [],
    deficiencies,
    notes:       insp.notes        ?? '',
    city:        insp.city         ?? '',
    contact:     insp.contact      ?? '',
    phone:       insp.phone        ?? '',
  };
}

function relativeTime(iso) {
  if (!iso) return 'Unknown';
  const diff    = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1)  return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours   < 24) return `${hours}h ago`;
  const days  = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── List item ─────────────────────────────────────────────────────────────────

function inspectionListItem(insp) {
  const critCount = insp.deficiencies.filter(d => d.severity === 'critical').length;
  const totalCps  = insp.checkpoints.length;
  const passCps   = insp.checkpoints.filter(c => c.result === 'pass').length;

  const stateBadge = {
    submitted:  '<span class="badge badge-yellow">Needs Review</span>',
    processing: '<span class="badge badge-orange">Processing</span>',
    complete:   '<span class="badge badge-green">Complete</span>',
    failed:     '<span class="badge badge-red">Failed</span>',
  };

  return `
    <div class="card card-sm" style="cursor:pointer;transition:all .15s ease" id="list-${insp.id}"
      onclick="window._selectInspection('${insp.id}')"
      onmouseover="this.style.borderColor='var(--border-active)'"
      onmouseout="this.style.borderColor=''">
      <div class="flex-between" style="margin-bottom:6px">
        <div style="font-weight:600;font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${insp.address}</div>
        ${critCount > 0
          ? `<span class="badge badge-red">${critCount} critical</span>`
          : (stateBadge[insp.status] ?? '<span class="badge badge-gray">Review</span>')}
      </div>
      <div style="font-size:.78rem;color:var(--text-muted)">
        ${insp.type} · ${insp.tech} · ${insp.submitted}
      </div>
      ${totalCps > 0 ? `
        <div style="margin-top:6px;font-size:.73rem;color:var(--text-muted)">
          ${insp.deficiencies.length} deficiencies · ${passCps}/${totalCps} checkpoints passed
        </div>
      ` : `
        <div style="margin-top:6px;font-size:.73rem;color:var(--text-muted)">
          ${insp.deficiencies.length} deficiencies · No checkpoint data
        </div>
      `}
    </div>
  `;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function selectInspection(insp) {
  selectedId = insp.id;

  // Highlight selected in list
  document.querySelectorAll('#inspection-list .card').forEach(el => {
    el.style.borderColor = '';
    el.style.background  = '';
  });
  const listEl = document.getElementById(`list-${insp.id}`);
  if (listEl) {
    listEl.style.borderColor = 'var(--brand)';
    listEl.style.background  = 'var(--brand-glow)';
  }

  const passCount = insp.checkpoints.filter(c => c.result === 'pass').length;
  const failCount = insp.checkpoints.filter(c => c.result === 'fail').length;
  const totalCost = insp.deficiencies.reduce((sum, d) => sum + (d.estimatedCost ?? 0), 0);

  const detail = document.getElementById('inspection-detail');
  detail.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">

      <!-- Header -->
      <div class="card">
        <div class="flex-between" style="margin-bottom:12px">
          <div>
            <div style="font-size:1.1rem;font-weight:700">${insp.address}</div>
            <div style="font-size:.82rem;color:var(--text-muted);margin-top:3px">
              ${insp.type} · Tech: ${insp.tech} · ${insp.submitted}
              ${insp.city ? ` · ${insp.city}` : ''}
            </div>
          </div>
          <div class="flex-row">
            <span class="badge badge-yellow">Pending Review</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          ${miniStat('Passed',           passCount,                      'var(--success)')}
          ${miniStat('❌ Failed',        failCount,                      'var(--danger)')}
          ${miniStat('⚠ Deficiencies',  insp.deficiencies.length,      'var(--warning)')}
          ${miniStat('💵 Est. Repair',  totalCost > 0 ? '$' + totalCost.toLocaleString() : '—', 'var(--brand)')}
        </div>
      </div>

      <!-- Contact info (if available) -->
      ${insp.contact || insp.phone ? `
        <div class="card" style="padding:12px 16px">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:6px">📞 Site Contact</div>
          <div style="font-size:.875rem;font-weight:600">${insp.contact || '—'}</div>
          ${insp.phone ? `<a href="tel:${insp.phone}" style="font-size:.82rem;color:var(--brand);margin-top:2px;display:block">${insp.phone}</a>` : ''}
        </div>
      ` : ''}

      <!-- Checkpoints -->
      ${insp.checkpoints.length > 0 ? `
        <div class="card">
          <div class="section-header" style="margin-bottom:12px">
            <div class="section-title">Inspection Checkpoints</div>
            <div style="font-size:.78rem;color:var(--text-muted)">${insp.system_type}</div>
          </div>
          <div class="checklist">
            ${insp.checkpoints.map(cp => `
              <div class="check-item ${cp.result ?? ''}">
                <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0;
                  ${cp.result === 'pass' ? 'background:rgba(34,197,94,.15);color:var(--success)' :
                    cp.result === 'fail' ? 'background:rgba(239,68,68,.15);color:var(--danger)' :
                    'background:var(--bg-raised);color:var(--text-muted)'}">
                  ${cp.result === 'pass' ? '✓' : cp.result === 'fail' ? '✕' : '—'}
                </div>
                <div class="check-label">${cp.label ?? cp.code ?? 'Checkpoint'}</div>
                <div class="check-code">${cp.code ?? ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="card" style="padding:16px;text-align:center;color:var(--text-muted);font-size:.82rem">
          No checkpoint data — technician may have submitted without completing checkpoints.
        </div>
      `}

      <!-- Deficiencies -->
      ${insp.deficiencies.length > 0 ? `
        <div class="card">
          <div class="section-header" style="margin-bottom:12px">
            <div class="section-title">⚠ Deficiencies Found</div>
            <div style="font-size:.78rem;color:var(--text-muted)">Review and confirm before generating quote</div>
          </div>
          <div class="deficiency-list">
            ${insp.deficiencies.map(d => deficiencyCard(d)).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Tech notes -->
      ${insp.notes ? `
        <div class="card">
          <div class="section-title" style="margin-bottom:8px">📝 Technician Notes</div>
          <p style="font-size:.875rem;color:var(--text-subtle);line-height:1.6">${insp.notes}</p>
        </div>
      ` : ''}

      <!-- Actions -->
      <div class="flex-row" style="justify-content:flex-end;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="window._printReport('${insp.id}')">🖨 Print Report</button>
        <button class="btn btn-ghost" onclick="window._requestChanges()">Request Changes</button>
        <button class="btn btn-danger btn-sm" onclick="window._flagInspection()">Flag Issue</button>
        <button class="btn btn-primary" onclick="window._generateQuote('${insp.id}')">
          Generate Quote${totalCost > 0 ? ' ($' + totalCost.toLocaleString() + ')' : ''}
        </button>
      </div>
    </div>
  `;

  window._requestChanges = () => window._notify?.info('Change request sent to technician');
  window._flagInspection = () => window._notify?.warning('Inspection flagged for follow-up');
  window._generateQuote  = (inspectionId) => {
    // Pass the inspection ID to the quote builder via a global so it can pre-populate
    window._quoteSourceInspectionId = inspectionId;
    window._notify?.success('Opening Quote Builder…');
    setTimeout(() => window._navigate('/quotes'), 800);
  };
  window._printReport = async (inspectionId) => {
    // BUG FIX: window.open() does NOT send the Authorization header, causing 401
    // when auth is enabled.  Instead, fetch the HTML with the bearer token, create
    // a Blob URL, and open that — the browser opens it without needing auth.
    try {
      const token = sessionStorage.getItem('ff_token') ?? '';
      const res = await fetch(`/v1/inspection/${inspectionId}/report`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        window._notify?.error(`Could not load report (HTTP ${res.status})`);
        return;
      }
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      const tab  = window.open(url, '_blank');
      // Revoke the object URL after the tab has loaded (5s is plenty)
      if (tab) setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      window._notify?.error('Failed to open report: ' + err.message);
    }
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function miniStat(label, value, color) {
  return `
    <div style="background:var(--bg-raised);border-radius:var(--r-sm);padding:10px 12px;text-align:center">
      <div style="font-size:1.1rem;font-weight:800;color:${color}">${value}</div>
      <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">${label}</div>
    </div>
  `;
}

function deficiencyCard(d) {
  const severityColors = { critical: 'badge-red', major: 'badge-yellow', minor: 'badge-gray' };
  return `
    <div class="deficiency-card">
      <div class="deficiency-header">
        <div class="flex-row" style="gap:8px">
          <span class="deficiency-type">${d.type || 'Issue'}</span>
          <span class="badge ${severityColors[d.severity] ?? 'badge-gray'}">${d.severity ?? 'unknown'}</span>
          ${d.code && d.code !== '—' ? `<span style="font-size:.72rem;color:var(--text-muted);font-family:monospace">${d.code}</span>` : ''}
        </div>
        ${d.estimatedCost ? `<span style="font-weight:700;color:var(--brand)">$${d.estimatedCost.toLocaleString()}</span>` : ''}
      </div>
      <div class="deficiency-desc">${d.description || '(No description)'}</div>
      ${d.suggestedFix ? `
        <div style="margin-top:8px;padding:8px 10px;background:var(--bg-overlay);border-radius:var(--r-sm);font-size:.78rem;color:var(--text-muted)">
          <strong style="color:var(--text-subtle)">Suggested fix:</strong> ${d.suggestedFix}
        </div>
      ` : ''}
      <div class="deficiency-photo" onclick="window._notify?.info('Photo upload coming soon')">
        Tap to attach photo
      </div>
    </div>
  `;
}
