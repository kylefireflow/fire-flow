/**
 * tech-inspection.js — Guided step-by-step inspection flow
 *
 * Fixes applied:
 *  BUG 2:  Checkpoint summary counter now uses explicit IDs
 *  BUG 3:  System type change resets checkpoints
 *  BUG 4:  Multiple photo uploads all processed
 *  BUG 6:  Photo removal updates DOM immediately
 *  BUG 7:  Deficiencies reconciled when checkpoint changes
 *  BUG 8:  Draft restored on re-entry (not wiped)
 *  BUG 14: All user input escaped before innerHTML
 *  BUG 16: setInspectionInProgress called to enable beforeunload warning
 *  BUG 17: notify accessed via window._notify (in scope for inline handlers)
 */

import { api } from '../api.js';
import { notify } from '../toast.js';
import { localInspections, localPhotos, syncQueue } from '../offline.js';
import { getCompanyId, getCurrentUser } from '../auth.js';
import { setInspectionInProgress } from '../app.js';
import { NFPA13_CHECKLISTS } from '../nfpa-checklists.js';
import { NFPA13_CHECKLISTS } from '../nfpa-checklists.js';

const esc = window._escapeHtml ?? ((s) => String(s ?? ''));

const STEPS = [
  { id: 'info',         label: 'Property Info',  icon: '1' },
  { id: 'checkpoints',  label: 'Checkpoints',    icon: '2' },
  { id: 'deficiencies', label: 'Deficiencies',   icon: '3' },
  { id: 'photos',       label: 'Photos',         icon: '4' },
  { id: 'submit',       label: 'Submit',         icon: '5' },
];

const SYSTEM_TYPES = [
  'Wet Pipe Sprinkler', 'Dry Pipe Sprinkler', 'Pre-Action Sprinkler',
  'Deluge System', 'Wet Standpipe', 'Dry Standpipe', 'Combination Standpipe',
  'Fire Alarm — Addressable', 'Fire Alarm — Conventional', 'Fire Alarm — Wireless',
  'Kitchen Hood Suppression (Ansul)', 'Clean Agent System (FM-200)',
  'Backflow Preventer', 'Fire Pump', 'Fire Extinguisher',
  'Tenant Improvement',
];

const CHECKPOINT_SETS = {
  'Wet Pipe Sprinkler': [
    { code: 'SP-1',  label: 'Main control valve accessible & open',         nfpa: 'NFPA 25 13.2.1' },
    { code: 'SP-2',  label: 'Inspector test valve present & labeled',        nfpa: 'NFPA 25 5.3.1' },
    { code: 'SP-3',  label: 'Water flow alarm tested',                       nfpa: 'NFPA 25 5.3.3' },
    { code: 'SP-4',  label: 'Sprinkler heads free of paint/corrosion',       nfpa: 'NFPA 25 5.2.1' },
    { code: 'SP-5',  label: 'Sprinkler heads unobstructed (18" clearance)',  nfpa: 'NFPA 25 5.2.1' },
    { code: 'SP-6',  label: 'No missing/damaged sprinkler heads',            nfpa: 'NFPA 25 5.2.1' },
    { code: 'SP-7',  label: 'Pressure gauges in acceptable range',           nfpa: 'NFPA 25 5.3.2' },
    { code: 'SP-8',  label: 'Spare sprinkler heads & wrench on site',        nfpa: 'NFPA 25 5.4.1' },
    { code: 'SP-9',  label: 'Riser room free of storage/obstructions',       nfpa: 'NFPA 25 4.1.2' },
    { code: 'SP-10', label: 'FDC accessible, capped, and unobstructed',      nfpa: 'NFPA 25 6.3.1' },
  ],
  'Wet Standpipe': [
    { code: 'WS-1', label: 'Hose valves accessible at each floor',           nfpa: 'NFPA 25 7.3.1' },
    { code: 'WS-2', label: 'Hose valve pressure within limits',              nfpa: 'NFPA 25 7.3.1' },
    { code: 'WS-3', label: 'FDC accessible & unobstructed',                  nfpa: 'NFPA 25 7.3.3' },
    { code: 'WS-4', label: 'Pressure reducing valve (PRV) set correctly',    nfpa: 'NFPA 25 7.3.2' },
    { code: 'WS-5', label: 'FDC caps secure',                                nfpa: 'NFPA 25 7.3.3' },
    { code: 'WS-6', label: 'Drain test completed',                           nfpa: 'NFPA 25 7.3.4' },
    { code: 'WS-7', label: 'Hose cabinets unobstructed',                     nfpa: 'NFPA 25 7.3.5' },
  ],
  'Fire Alarm — Addressable': [
    { code: 'FA-1',  label: 'Control panel operational, no trouble signals',  nfpa: 'NFPA 72 10.4' },
    { code: 'FA-2',  label: 'All initiating devices functional',              nfpa: 'NFPA 72 10.4' },
    { code: 'FA-3',  label: 'All notification appliances functional',         nfpa: 'NFPA 72 10.4' },
    { code: 'FA-4',  label: 'Smoke detectors tested',                        nfpa: 'NFPA 72 14.4' },
    { code: 'FA-5',  label: 'Heat detectors tested',                         nfpa: 'NFPA 72 14.4' },
    { code: 'FA-6',  label: 'Manual pull stations tested',                   nfpa: 'NFPA 72 14.4' },
    { code: 'FA-7',  label: 'Batteries tested & in good condition',          nfpa: 'NFPA 72 10.6' },
    { code: 'FA-8',  label: 'Audible/visual alarms audible throughout',      nfpa: 'NFPA 72 18.4' },
    { code: 'FA-9',  label: 'Central station monitoring confirmed',          nfpa: 'NFPA 72 26.6' },
    { code: 'FA-10', label: 'Suppression system interface functional',        nfpa: 'NFPA 72 21.2' },
  ],
  'Kitchen Hood Suppression (Ansul)': [
    { code: 'KH-1', label: 'Agent cylinder pressure in range',               nfpa: 'NFPA 17A 7.2' },
    { code: 'KH-2', label: 'All nozzles unobstructed & correctly aimed',     nfpa: 'NFPA 17A 7.3' },
    { code: 'KH-3', label: 'Mechanical links intact & not exceeded 365 days',nfpa: 'NFPA 17A 7.4' },
    { code: 'KH-4', label: 'Fuel shut-off valve functional',                 nfpa: 'NFPA 17A 7.5' },
    { code: 'KH-5', label: 'Manual pull station accessible',                 nfpa: 'NFPA 17A 7.6' },
    { code: 'KH-6', label: 'Hood and duct cleaned within 6 months',         nfpa: 'NFPA 96 11.4' },
  ],
};

const DEFAULT_CHECKPOINTS = [
  { code: 'GEN-1', label: 'System tagged with last inspection date',   nfpa: 'NFPA 25 4.1.2' },
  { code: 'GEN-2', label: 'No unauthorized modifications to system',   nfpa: 'NFPA 25 4.1.2' },
  { code: 'GEN-3', label: 'As-built drawings available on site',       nfpa: 'NFPA 25 4.1.2' },
];

const DEFICIENCY_TYPES = {
  'Sprinkler System': [
    'Sprinkler Head Obstruction', 'Missing Sprinkler Head', 'Corroded Sprinkler Head',
    'Painted Sprinkler Head', 'Insufficient Clearance', 'Main Valve Issue',
    'Pressure Out of Range', 'Missing Spare Heads/Wrench', 'FDC Obstruction',
  ],
  'Standpipe': [
    'PRV Out of Adjustment', 'Pressure Failure', 'Hose Valve Inaccessible',
    'FDC Obstruction', 'Missing FDC Caps', 'Cabinet Obstructed',
  ],
  'Fire Alarm': [
    'Trouble Signal Active', 'Device Failure', 'Battery Failure',
    'Pull Station Obstructed', 'Audibility Failure', 'Monitoring Issue',
  ],
  'General': [
    'No Inspection Tag', 'Unauthorized Modification', 'Missing Documentation',
    'Room Access Issue', 'Storage Obstruction', 'General Note',
  ],
};

// Module-level draft — NOT reset on re-entry if in progress (BUG 8 fix)
let draft = null;
let currentStep = 0;

function freshDraft() {
  return {
    id:          'local_' + crypto.randomUUID(),
    address:     '',
    city:        '',
    contact:     '',
    phone:       '',
    system_type: '',
    num_floors:  '',
    num_heads:   '',
    notes:       '',
    checkpoints: [],
    deficiencies: [],
    photos:       [],
    _lastSystemType: '', // BUG 3: track system type to detect changes
  };
}

// BUG FIX: capture a history entry when the inspection flow starts so browser
// Back navigates to the previous wizard step instead of leaving the inspection.
let _popstateHandler = null;

export async function renderInspectionFlow(container) {
  // BUG 8 FIX: if there's a draft already in progress, resume it — don't wipe it.
  // If there's no in-memory draft (e.g. page was reloaded), try to restore the
  // most recent unsubmitted local draft from IndexedDB and hydrate its photos.
  if (!draft || draft._submitted) {
    const saved = await localInspections.getAll().catch(() => []);
    const candidate = saved
      .filter(i => i._local && !i._submitted && i.status !== 'submitted')
      .sort((a, b) => new Date(b.updated_at ?? 0) - new Date(a.updated_at ?? 0))[0] ?? null;

    if (candidate) {
      draft = { ...candidate, photos: [] };
      draft.photos = await localPhotos.getByInspectionId(candidate.id).catch(() => []);
      currentStep = 0;
      notify.info('Resuming your previous inspection draft');
    } else {
      draft = freshDraft();
      currentStep = 0;
    }
  }
  // BUG 16 FIX: mark inspection as in progress for beforeunload warning
  setInspectionInProgress(true);

  // BUG FIX: intercept browser Back/Forward while inspection is active.
  // Each step advances history so Back goes to previous step, not previous page.
  if (_popstateHandler) window.removeEventListener('popstate', _popstateHandler);
  _popstateHandler = (e) => {
    // If we're mid-inspection and the user hit Back, go to previous step
    if (draft && !draft._submitted && currentStep > 0) {
      e.stopImmediatePropagation();  // prevent app.js popstate from also firing
      currentStep--;
      renderStep(container);
      // Push a new state so Back is available again
      history.pushState({ inspectionStep: currentStep }, '', '/inspection/new');
    }
    // If on step 0, let app.js handle it (shows confirmation via beforeunload)
  };
  window.addEventListener('popstate', _popstateHandler);
  // Push an initial history entry so the browser has something to go "back" from
  history.pushState({ inspectionStep: currentStep }, '', '/inspection/new');

  renderStep(container);
}

function renderStep(container) {
  const step = STEPS[currentStep];

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">New Inspection</div>
        <div class="page-subtitle">Step ${currentStep + 1} of ${STEPS.length} — ${step.label}</div>
      </div>
      <button class="btn btn-ghost" onclick="window._discardInspection()">✕ Discard</button>
    </div>

    <!-- Progress wizard -->
    <div class="wizard-progress" style="margin-bottom:28px">
      ${STEPS.map((s, i) => `
        <div class="wizard-step ${i < currentStep ? 'done' : i === currentStep ? 'active' : ''}">
          ${i > 0 ? `<div class="wizard-step-line"></div>` : ''}
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
            <div class="wizard-step-dot">${i < currentStep ? '✓' : s.icon}</div>
            <div class="wizard-step-label">${s.label}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <div id="step-content">
      ${renderStepContent(step.id)}
    </div>

    <!-- FIELD FIX: wizard-footer enables full-width primary CTA on mobile -->
    <div class="wizard-footer">
      <button class="btn btn-ghost" onclick="window._prevStep()" ${currentStep === 0 ? 'disabled' : ''}>
        ← Back
      </button>
      <div class="wizard-footer-meta">
        <span id="autosave-status" class="autosave-indicator saved">
          <span class="autosave-dot"></span> Saved locally
        </span>
      </div>
      <button class="btn btn-primary" id="next-btn" onclick="window._nextStep()">
        ${currentStep === STEPS.length - 1 ? 'Submit Inspection' : 'Next →'}
      </button>
    </div>
  `;

  bindStepEvents(container);
}

function renderStepContent(stepId) {
  switch (stepId) {
    case 'info':         return renderInfoStep();
    case 'checkpoints':  return renderCheckpointStep();
    case 'deficiencies': return renderDeficienciesStep();
    case 'photos':       return renderPhotosStep();
    case 'submit':       return renderSubmitStep();
    default: return '';
  }
}

// ── Step 1: Property Info ─────────────────────────────────────────────────────

function renderInfoStep() {
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:16px">
      <div class="grid-2">
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Property Address *</label>
          <input class="form-input" id="f-address" placeholder="123 Main Street"
            value="${esc(draft.address)}" autocomplete="street-address" required>
        </div>
        <div class="form-group">
          <label class="form-label">City, State, ZIP</label>
          <input class="form-input" id="f-city" placeholder="Riverside, CA 92501"
            value="${esc(draft.city)}" autocomplete="address-level2">
        </div>
        <div class="form-group">
          <label class="form-label">Contact Name</label>
          <input class="form-input" id="f-contact" placeholder="Building Manager"
            value="${esc(draft.contact)}" autocomplete="name">
        </div>
        <div class="form-group">
          <label class="form-label">Contact Phone</label>
          <input class="form-input" type="tel" id="f-phone" placeholder="(555) 000-0000"
            value="${esc(draft.phone)}" autocomplete="tel">
        </div>
        <div class="form-group">
          <label class="form-label">System Type *</label>
          <select class="form-select" id="f-system-type">
            <option value="">Select system type…</option>
            ${SYSTEM_TYPES.map(t => `<option value="${esc(t)}" ${draft.system_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Number of Floors</label>
          <input class="form-input" type="number" min="1" max="200" id="f-floors" placeholder="e.g. 6" value="${esc(draft.num_floors)}">
        </div>
        <div class="form-group">
          <label class="form-label">Number of Heads / Devices</label>
          <input class="form-input" type="number" min="1" max="100000" id="f-heads" placeholder="e.g. 48" value="${esc(draft.num_heads)}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Pre-Inspection Notes</label>
        <textarea class="form-textarea" id="f-notes" placeholder="Access notes, special conditions, etc.">${esc(draft.notes)}</textarea>
      </div>
    </div>
  `;
}

function saveInfoStep() {
  const address     = document.getElementById('f-address')?.value?.trim() ?? '';
  const city        = document.getElementById('f-city')?.value?.trim() ?? '';
  const contact     = document.getElementById('f-contact')?.value?.trim() ?? '';
  const phone       = document.getElementById('f-phone')?.value?.trim() ?? '';
  const system_type = document.getElementById('f-system-type')?.value ?? '';
  const num_floors  = document.getElementById('f-floors')?.value ?? '';
  const num_heads   = document.getElementById('f-heads')?.value ?? '';
  const notes       = document.getElementById('f-notes')?.value?.trim() ?? '';

  if (!address)     { notify.error('Property address is required'); return false; }
  if (!system_type) { notify.error('Please select a system type'); return false; }

  // Validate phone loosely if provided
  if (phone && !/^[\d\s\-\+\(\)\.]{7,20}$/.test(phone)) {
    notify.error('Please enter a valid phone number'); return false;
  }

  // BUG 3 FIX: reset checkpoints if system type changed
  const systemChanged = system_type !== draft._lastSystemType && draft._lastSystemType !== '';
  if (systemChanged && draft.checkpoints.length > 0) {
    if (!confirm(`System type changed to "${system_type}". This will reset the checklist. Continue?`)) {
      return false;
    }
    draft.checkpoints  = [];
    draft.deficiencies = [];
  }

  draft.address      = address;
  draft.city         = city;
  draft.contact      = contact;
  draft.phone        = phone;
  draft.system_type  = system_type;
  draft.num_floors   = num_floors;
  draft.num_heads    = num_heads;
  draft.notes        = notes;
  draft._lastSystemType = system_type;

  // Load checkpoints for this system type (only if empty)
  if (draft.checkpoints.length === 0) {
    const specific = NFPA13_CHECKLISTS[system_type] ?? CHECKPOINT_SETS[system_type] ?? DEFAULT_CHECKPOINTS;
    draft.checkpoints = specific.map(cp => ({ ...cp, result: null, value: '', notes: '' }));
  }
  return true;
}

// -- Step 2: Checkpoints --

function renderCheckpointStep() {
  const cps       = draft.checkpoints;
  const total     = cps.length;
  const answered  = cps.filter(c => c.result !== null).length;
  const passCount = cps.filter(c => c.result === 'pass').length;
  const failCount = cps.filter(c => c.result === 'fail').length;
  const pct       = total > 0 ? Math.round((answered / total) * 100) : 0;

  const cardRows = cps.map((cp, i) => {
    const isNumeric = cp.type === 'numeric';
    const isNotes   = cp.type === 'notes';
    const isFail    = cp.result === 'fail';
    const needNote  = isFail && !(cp.notes ?? '').trim();
    const borderClr = cp.result === 'pass' ? 'rgba(34,197,94,.35)'
                    : cp.result === 'fail' ? 'rgba(239,68,68,.35)'
                    : 'var(--border)';
    const passActive = cp.result === 'pass' ? 'active' : '';
    const failActive = cp.result === 'fail' ? 'active' : '';

    const buttons = isNotes
      ? `<div onclick="window._setCheckpoint(${i},'pass')" title="Mark done" style="
            flex-shrink:0;width:22px;height:22px;margin-top:2px;border-radius:50%;cursor:pointer;
            background:${cp.result==='pass'?'var(--success)':'var(--border)'};
            display:flex;align-items:center;justify-content:center">
            ${cp.result==='pass'?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':''}
          </div>`
      : `<div style="display:flex;gap:4px;flex-shrink:0">
           <button class="check-btn pass ${passActive}" onclick="window._setCheckpoint(${i},'pass')" title="Pass" style="width:30px;height:30px;font-size:.68rem;font-weight:700">P</button>
           <button class="check-btn fail ${failActive}" onclick="window._setCheckpoint(${i},'fail')" title="Fail" style="width:30px;height:30px;font-size:.68rem;font-weight:700">F</button>
         </div>`;

    const numericRow = isNumeric ? `
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;background:var(--bg-raised);border-radius:var(--r-sm)">
        <span style="font-size:.75rem;color:var(--text-muted);flex-shrink:0">Reading:</span>
        <input type="number" step="any" class="form-input" style="height:32px;font-size:.85rem;width:110px;padding:0 8px"
          value="${esc(cp.value ?? '')}" placeholder="0.0"
          oninput="window._setCheckpointValue(${i},this.value)">
        ${cp.unit ? `<span style="font-size:.78rem;color:var(--text-muted)">${esc(cp.unit)}</span>` : ''}
      </div>` : '';

    const failNoteRow = isFail ? `
      <div style="margin-top:8px">
        <textarea class="form-textarea" id="cp-note-${i}" style="min-height:64px;font-size:.82rem;border-color:${needNote?'var(--danger)':'var(--border)'}"
          placeholder="Required: describe what you found..."
          oninput="window._setCheckpointNotes(${i},this.value)">${esc(cp.notes ?? '')}</textarea>
        ${needNote?`<div id="cp-note-hint-${i}" style="font-size:.72rem;color:var(--danger);margin-top:3px">Fail note required before advancing</div>`:''}
      </div>` : '';

    const notesRow = (isNotes && cp.result !== 'fail') ? `
      <div style="margin-top:8px">
        <textarea class="form-textarea" style="min-height:56px;font-size:.82rem"
          placeholder="${esc(cp.description || 'Enter observation...')}"
          oninput="window._setCheckpointNotes(${i},this.value)">${esc(cp.notes ?? '')}</textarea>
      </div>` : '';

    return `
      <div class="card" id="cp-row-${i}" style="padding:14px 16px;border-color:${borderClr};transition:border-color .2s">
        <div style="display:flex;align-items:flex-start;gap:10px">
          ${buttons}
          <div style="flex:1;min-width:0">
            <div style="font-size:.875rem;font-weight:600;line-height:1.35">
              ${esc(cp.label)}${cp.required ? '<span style="color:var(--danger);margin-left:3px">*</span>' : ''}
            </div>
            ${cp.description ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:2px;line-height:1.4">${esc(cp.description)}</div>` : ''}
            <div style="font-size:.68rem;color:var(--text-muted);margin-top:3px;font-family:monospace">${esc(cp.nfpa ?? '')} &nbsp;·&nbsp; ${esc(cp.code)}</div>
          </div>
        </div>
        ${numericRow}${failNoteRow}${notesRow}
      </div>`;
  }).join('');

  return `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="card card-sm" style="padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span id="cp-remaining-count" style="font-size:.8rem;font-weight:600;color:var(--text-muted)">${answered} of ${total} answered</span>
          <div style="display:flex;gap:14px;font-size:.78rem">
            <span id="cp-pass-count" style="color:var(--success);font-weight:700">${passCount} passed</span>
            <span id="cp-fail-count" style="color:var(--danger);font-weight:700">${failCount} failed</span>
          </div>
        </div>
        <div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden">
          <div id="cp-progress-bar" style="height:100%;width:${pct}%;background:${pct===100?'var(--success)':'var(--brand)'};border-radius:99px;transition:width .3s ease"></div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="window._passAll()">Pass All</button>
      </div>

      ${cardRows}

      <div id="fail-count-banner"
        style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:var(--r-md);padding:12px;font-size:.82rem;color:var(--danger);${failCount === 0 ? 'display:none' : ''}">
        ${failCount} checkpoint${failCount > 1 ? 's' : ''} failed - add notes, then capture details in the next step.
      </div>
    </div>
  `;
}

function updateCheckpointCounters() {
  const cps       = draft.checkpoints;
  const total     = cps.length;
  const passCount = cps.filter(c => c.result === 'pass').length;
  const failCount = cps.filter(c => c.result === 'fail').length;
  const answered  = cps.filter(c => c.result !== null).length;
  const pct       = total > 0 ? Math.round((answered / total) * 100) : 0;
  const pc  = document.getElementById('cp-pass-count');
  const fc  = document.getElementById('cp-fail-count');
  const rc  = document.getElementById('cp-remaining-count');
  const bar = document.getElementById('cp-progress-bar');
  if (pc)  pc.textContent  = passCount + ' passed';
  if (fc)  fc.textContent  = failCount + ' failed';
  if (rc)  rc.textContent  = answered + ' of ' + total + ' answered';
  if (bar) { bar.style.width = pct + '%'; bar.style.background = pct === 100 ? 'var(--success)' : 'var(--brand)'; }
}

// ── Step 3: Deficiencies ──────────────────────────────────────────────────────

function renderDeficienciesStep() {
  // BUG 7 FIX: reconcile deficiencies with current checkpoint results
  // 1. Remove deficiencies for checkpoints that are now passing
  const failedCodes = new Set(draft.checkpoints.filter(c => c.result === 'fail').map(c => c.code));
  draft.deficiencies = draft.deficiencies.filter(d =>
    !d.checkpointCode || failedCodes.has(d.checkpointCode) || d.checkpointCode === ''
  );

  // 2. Auto-add for newly failed checkpoints not yet in list
  const existingCodes = new Set(draft.deficiencies.map(d => d.checkpointCode).filter(Boolean));
  for (const code of failedCodes) {
    if (!existingCodes.has(code)) {
      // FIELD FIX: description starts EMPTY — the checkpoint label is a pass/fail criterion,
      // not a deficiency description. Placeholder guides the tech to describe what they found.
      draft.deficiencies.push({
        id: 'def_' + crypto.randomUUID(),
        checkpointCode: code,
        type: '',
        description: '',
        severity: 'major',
        estimatedCost: '',
        _category: 'General',
      });
    }
  }

  const categoryKeys = Object.keys(DEFICIENCY_TYPES);

  return `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="flex-between">
        <div>
          <div class="section-title">⚠ Deficiencies</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${draft.deficiencies.length} captured</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window._addDeficiency()">+ Add Item</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px" id="def-list">
        ${draft.deficiencies.length === 0 ? `
          <div class="card" style="text-align:center;padding:32px;color:var(--text-muted)">
            <div style="width:40px;height:40px;border-radius:50%;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;color:var(--success)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
            <div>No deficiencies — all checkpoints passed</div>
            <div style="font-size:.78rem;margin-top:4px">You can still add general observations using the button above</div>
          </div>
        ` : draft.deficiencies.map((d, i) => deficiencyEditCard(d, i, categoryKeys)).join('')}
      </div>
    </div>
  `;
}

function deficiencyEditCard(d, i, categoryKeys) {
  return `
    <div class="deficiency-card" id="def-card-${esc(d.id)}">
      <div class="flex-between" style="margin-bottom:12px">
        <div style="font-size:.75rem;color:var(--text-muted);font-family:monospace">${esc(d.checkpointCode || 'Additional')}</div>
        <button class="btn btn-icon" style="color:var(--danger);border-color:transparent;font-size:.85rem"
          onclick="window._removeDeficiency('${esc(d.id)}')">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="grid-2" style="gap:10px">
          <div class="form-group">
            <label class="form-label">Category</label>
            <select class="form-select" style="font-size:.82rem"
              onchange="window._updateDeficiency('${esc(d.id)}','_category',this.value);window._refreshDefTypeOptions('${esc(d.id)}',this.value)">
              ${categoryKeys.map(k => `<option value="${esc(k)}" ${d._category === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Deficiency Type</label>
            <select class="form-select" style="font-size:.82rem" id="deftype-${esc(d.id)}"
              onchange="window._updateDeficiency('${esc(d.id)}','type',this.value)">
              <option value="">Select type…</option>
              ${(DEFICIENCY_TYPES[d._category ?? 'General'] ?? DEFICIENCY_TYPES['General']).map(t =>
                `<option value="${esc(t)}" ${d.type === t ? 'selected' : ''}>${esc(t)}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <!-- FIELD FIX: description starts blank — tech describes what they found,
             not the checkpoint criterion. Placeholder is specific and actionable. -->
        <div class="form-group">
          <label class="form-label">What did you find? *</label>
          <textarea class="form-textarea" style="min-height:80px;font-size:.9rem"
            onchange="window._updateDeficiency('${esc(d.id)}','description',this.value)"
            placeholder="e.g. Hose valve at floor 3 reading 45 PSI — min required is 100 PSI">${esc(d.description)}</textarea>
        </div>
        <!-- FIELD FIX: severity is full-width — only one field, easy to tap -->
        <div class="form-group">
          <label class="form-label">Severity</label>
          <select class="form-select"
            onchange="window._updateDeficiency('${esc(d.id)}','severity',this.value)">
            <option value="critical" ${d.severity === 'critical' ? 'selected' : ''}>Critical — immediate danger or code violation</option>
            <option value="major"    ${d.severity === 'major'    ? 'selected' : ''}>Major — needs repair soon</option>
            <option value="minor"    ${d.severity === 'minor'    ? 'selected' : ''}>⚪ Minor — monitor or cosmetic</option>
          </select>
        </div>
        <!-- FIELD FIX: estimated cost REMOVED from tech form. Admin sets pricing.
             Cost is still in the data model so admin can fill it during review. -->
      </div>
    </div>
  `;
}

// ── Step 4: Photos ────────────────────────────────────────────────────────────

function renderPhotosStep() {
  return `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="section-title">Attach Photos</div>
      <p style="font-size:.875rem;color:var(--text-muted)">Attach photos to deficiencies for the inspection report. Stored locally until submit.</p>

      ${draft.deficiencies.length > 0 ? draft.deficiencies.map(d => `
        <div class="card">
          <div class="flex-between" style="margin-bottom:10px">
            <div>
              <div style="font-size:.85rem;font-weight:600">${esc(d.type || 'Deficiency')}</div>
              <div style="font-size:.75rem;color:var(--text-muted)">${esc(d.checkpointCode ?? '')}</div>
            </div>
            <span class="badge ${d.severity === 'critical' ? 'badge-red' : d.severity === 'major' ? 'badge-yellow' : 'badge-gray'}">${esc(d.severity)}</span>
          </div>
          <label class="photo-zone" for="photo-${esc(d.id)}">
            <div class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
            <div>Tap to take photo or upload</div>
            <div style="font-size:.72rem;margin-top:4px;opacity:.6">JPG, PNG · Max 10MB per photo</div>
          </label>
          <!-- BUG 4 FIX: allow multiple photos per deficiency -->
          <input type="file" id="photo-${esc(d.id)}" accept="image/*" capture="environment" multiple
            style="display:none" onchange="window._attachPhoto('${esc(d.id)}', this)">
          <div id="photos-${esc(d.id)}" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            ${draft.photos.filter(p => p.deficiencyId === d.id).map(p => thumbnailHtml(p)).join('')}
          </div>
        </div>
      `).join('') : `
        <div class="card" style="text-align:center;padding:32px;color:var(--text-muted)">
          <div style="width:40px;height:40px;border-radius:50%;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;color:var(--success)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div>No deficiencies to photograph</div>
        </div>
      `}

      <div class="card">
        <div style="font-size:.85rem;font-weight:600;margin-bottom:10px">General Site Photos</div>
        <label class="photo-zone" for="photo-general">
          <div class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
          <div>Add general site photos (tap to select multiple)</div>
        </label>
        <input type="file" id="photo-general" accept="image/*" multiple
          style="display:none" onchange="window._attachPhoto('general', this)">
        <div id="photos-general" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          ${draft.photos.filter(p => p.deficiencyId === 'general').map(p => thumbnailHtml(p)).join('')}
        </div>
      </div>
    </div>
  `;
}

function thumbnailHtml(photo) {
  return `
    <div id="thumb-${esc(photo.id)}" style="position:relative">
      <img src="${photo.dataUrl}" alt="Inspection photo"
        style="width:80px;height:80px;object-fit:cover;border-radius:var(--r-sm);border:1px solid var(--border)">
      <button style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--danger);border:none;color:#fff;font-size:.7rem;cursor:pointer;line-height:1"
        onclick="window._removePhoto('${esc(photo.id)}')">✕</button>
    </div>
  `;
}

// ── Step 5: Submit ────────────────────────────────────────────────────────────

function renderSubmitStep() {
  const passCount = draft.checkpoints.filter(c => c.result === 'pass').length;
  const failCount = draft.checkpoints.filter(c => c.result === 'fail').length;
  const unchecked = draft.checkpoints.filter(c => c.result === null).length;
  const totalCost = draft.deficiencies.reduce((sum, d) => sum + (+d.estimatedCost || 0), 0);

  return `
    <div style="display:flex;flex-direction:column;gap:16px">
      ${unchecked > 0 ? `
        <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--r-md);padding:12px;font-size:.82rem;color:var(--warning)">
          ⚠ ${unchecked} checkpoint${unchecked > 1 ? 's' : ''} not yet marked pass or fail. Go back to complete them.
        </div>
      ` : ''}

      <div class="card">
        <div class="section-title" style="margin-bottom:14px">Inspection Summary</div>
        <div class="grid-2" style="gap:12px;margin-bottom:16px">
          ${summaryItem('Property', esc(draft.address))}
          ${summaryItem('System', esc(draft.system_type))}
          ${summaryItem('Passed', `${passCount} checkpoints`)}
          ${summaryItem('❌ Failed', `${failCount} checkpoints`)}
          ${summaryItem('⚠ Deficiencies', draft.deficiencies.length + ' found')}
          ${summaryItem('Est. Repairs', totalCost ? `$${totalCost.toLocaleString()}` : 'N/A')}
          ${summaryItem('Photos', draft.photos.length + ' attached')}
        </div>

        ${draft.deficiencies.length > 0 ? `
          <div style="border-top:1px solid var(--border);padding-top:14px">
            <div style="font-size:.8rem;font-weight:700;margin-bottom:10px;color:var(--text-muted)">DEFICIENCIES</div>
            ${draft.deficiencies.map(d => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
                <div>
                  <div style="font-size:.85rem;font-weight:600">${esc(d.type || 'Uncategorized')}</div>
                  <div style="font-size:.75rem;color:var(--text-muted)">${esc((d.description ?? '').slice(0, 60))}${(d.description ?? '').length > 60 ? '…' : ''}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="badge ${d.severity === 'critical' ? 'badge-red' : d.severity === 'major' ? 'badge-yellow' : 'badge-gray'}">${esc(d.severity)}</span>
                  ${d.estimatedCost ? `<span style="font-size:.8rem;font-weight:700;color:var(--brand)">$${esc(d.estimatedCost)}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <div class="card" style="border-color:rgba(249,115,22,.3);background:var(--brand-glow)">
        <div style="font-size:.85rem;font-weight:700;margin-bottom:8px">What happens after you submit?</div>
        <div style="font-size:.82rem;color:var(--text-subtle);display:flex;flex-direction:column;gap:6px">
          <div>1. Your report is sent to the admin for review</div>
          <div>2. Admin reviews deficiencies and generates a quote</div>
          <div>3. Quote is sent to the customer for approval</div>
          <div>4. Work order is created if approved</div>
        </div>
      </div>

      ${!navigator.onLine ? `
        <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--r-md);padding:12px;font-size:.82rem;color:var(--warning)">
          Offline — inspection will be saved locally and submitted when reconnected.
        </div>
      ` : ''}
    </div>
  `;
}

function summaryItem(label, value) {
  return `
    <div style="background:var(--bg-raised);border-radius:var(--r-sm);padding:10px 12px">
      <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:3px">${label}</div>
      <div style="font-size:.875rem;font-weight:600">${value}</div>
    </div>
  `;
}

// ── Step navigation ───────────────────────────────────────────────────────────

// FIELD FIX: show a brief "Saving…" → "Saved locally" pulse on the auto-save indicator
function flashAutosave() {
  const el = document.getElementById('autosave-status');
  if (!el) return;
  el.className = 'autosave-indicator saving';
  el.innerHTML = '<span class="autosave-dot"></span> Saving…';
  setTimeout(() => {
    el.className = 'autosave-indicator saved';
    el.innerHTML = '<span class="autosave-dot"></span> Saved locally';
  }, 900);
}

function bindStepEvents(container) {
  window._nextStep = async () => {
    const stepId = STEPS[currentStep].id;
    if (stepId === 'info' && !saveInfoStep()) return;

    // NFPA validation: on checkpoints step, require all required items answered + fail notes
    if (STEPS[currentStep].id === 'checkpoints') {
      const cps = draft.checkpoints;
      const missingRequired = cps.filter(c => c.required && c.result === null);
      if (missingRequired.length > 0) {
        notify.error(missingRequired.length + ' required checkpoint' + (missingRequired.length > 1 ? 's' : '') + ' not yet marked.');
        return;
      }
      const failNoNote = cps.filter(c => c.result === 'fail' && !(c.notes ?? '').trim());
      if (failNoNote.length > 0) {
        notify.error('Add fail notes for ' + failNoNote.length + ' failed checkpoint' + (failNoNote.length > 1 ? 's' : '') + ' before continuing.');
        return;
      }
    }

    if (STEPS[currentStep].id === 'checkpoints') {
      const cps = draft.checkpoints;
      const missingRequired = cps.filter(c => c.required && c.result === null);
      if (missingRequired.length > 0) {
        notify.error(missingRequired.length + ' required checkpoint' + (missingRequired.length > 1 ? 's' : '') + ' not yet marked.');
        return;
      }
      const failNoNote = cps.filter(c => c.result === 'fail' && !(c.notes ?? '').trim());
      if (failNoNote.length > 0) {
        notify.error('Add fail notes for ' + failNoNote.length + ' failed checkpoint' + (failNoNote.length > 1 ? 's' : '') + ' before continuing.');
        return;
      }
    }

    if (currentStep < STEPS.length - 1) {
      currentStep++;
      // BUG FIX: push history entry so browser Back comes back to this step
      history.pushState({ inspectionStep: currentStep }, '', '/inspection/new');
      // FIELD FIX: show save indicator while writing to IndexedDB.
      // Save WITHOUT photos — they are persisted separately in localPhotos.
      flashAutosave();
      await localInspections.save({ ...draft, photos: [] }).catch(() => {});
      renderStep(container);
    } else {
      await submitInspection(container);
    }
  };

  window._prevStep = () => {
    if (currentStep > 0) {
      currentStep--;
      renderStep(container);
    }
  };

  window._discardInspection = () => {
    if (confirm('Discard this inspection? All data entered will be lost.')) {
      setInspectionInProgress(false);
      // BUG FIX: clean up our popstate handler so we don't intercept navigation elsewhere
      if (_popstateHandler) { window.removeEventListener('popstate', _popstateHandler); _popstateHandler = null; }
      draft = null;
      window._navigate('/my-day');
    }
  };

  window._setCheckpoint = (i, result) => {
    // Toggle: clicking same result again clears it
    draft.checkpoints[i].result = draft.checkpoints[i].result === result ? null : result;
    const cp  = draft.checkpoints[i];
    const row = document.getElementById('cp-row-' + i);
    if (row) {
      row.style.borderColor = cp.result === 'pass' ? 'rgba(34,197,94,.35)' : cp.result === 'fail' ? 'rgba(239,68,68,.35)' : 'var(--border)';
      let noteArea = row.querySelector('.fail-note-area');
      if (cp.result === 'fail' && !noteArea) {
        noteArea = document.createElement('div');
        noteArea.className = 'fail-note-area';
        noteArea.style.marginTop = '8px';
        const ta = document.createElement('textarea');
        ta.className = 'form-textarea';
        ta.style.cssText = 'min-height:64px;font-size:.82rem;border-color:var(--danger);width:100%';
        ta.placeholder = 'Required: describe what you found…';
        ta.value = cp.notes ?? '';
        ta.oninput = function() { window._setCheckpointNotes(i, this.value); };
        const hint = document.createElement('div');
        hint.className = 'fail-note-hint';
        hint.style.cssText = 'font-size:.72rem;color:var(--danger);margin-top:3px';
        hint.textContent = 'Fail note required before advancing';
        noteArea.appendChild(ta);
        noteArea.appendChild(hint);
        row.appendChild(noteArea);
      } else if (cp.result !== 'fail') {
        noteArea?.remove();
        cp.notes = '';
      }
      row.querySelectorAll('.check-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((btn.classList.contains('pass') && cp.result === 'pass') ||
            (btn.classList.contains('fail') && cp.result === 'fail')) {
          btn.classList.add('active');
        }
      });
    }
    // BUG 2 FIX: update via explicit IDs
    updateCheckpointCounters();
    // Update fail warning banner
    const failCount = draft.checkpoints.filter(c => c.result === 'fail').length;
    const banner = document.getElementById('fail-count-banner');
    if (banner) {
      if (failCount > 0) {
        banner.style.display = '';
        banner.textContent = `⚠ ${failCount} checkpoint${failCount > 1 ? 's' : ''} failed — you'll capture deficiency details in the next step.`;
      } else {
        banner.style.display = 'none';
      }
    }
  };

  // FIELD FIX: tapping anywhere on the row = PASS (most items pass in practice).
  // If already passed, the tap clears it (toggle). Fail still requires explicit ✕ button.
  window._rowTapCheckpoint = (i) => {
    const current = draft.checkpoints[i].result;
    const next = current === 'pass' ? null : 'pass';
    draft.checkpoints[i].result = next;
    const cp  = draft.checkpoints[i];
    const row = document.getElementById(`cp-row-${i}`);
    if (row) {
      row.className = `check-item ${cp.result ?? ''}`;
      row.querySelectorAll('.check-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.classList.contains('pass') && cp.result === 'pass') btn.classList.add('active');
      });
    }
    updateCheckpointCounters();
  };

  window._setCheckpointValue = (i, val) => {
    draft.checkpoints[i].value = val;
  };

  window._setCheckpointNotes = (i, val) => {
    draft.checkpoints[i].notes = val;
    // Remove red border on note row once user starts typing
    const row = document.getElementById('cp-row-' + i);
    if (row) {
      const ta = row.querySelector('textarea');
      if (ta && val.trim()) {
        ta.style.borderColor = 'var(--border)';
        const hint = ta.nextElementSibling;
        if (hint && hint.style && hint.tagName === 'DIV') hint.style.display = 'none';
      }
    }
  };

  window._setCheckpointValue = (i, val) => {
    draft.checkpoints[i].value = val;
  };

  window._setCheckpointNotes = (i, val) => {
    draft.checkpoints[i].notes = val;
    const hint = document.getElementById('cp-note-hint-' + i);
    const ta   = document.getElementById('cp-note-' + i);
    if (val.trim()) {
      if (hint) hint.style.display = 'none';
      if (ta)   ta.style.borderColor = 'var(--border)';
    }
  };

  // BUG 17 FIX: passAll with confirmation, uses module-scope notify directly
  window._passAll = () => {
    const unchecked = draft.checkpoints.filter(c => c.result === null).length;
    const failed    = draft.checkpoints.filter(c => c.result === 'fail').length;
    const affected  = unchecked + failed;
    if (affected === 0) { notify.info('All checkpoints already marked.'); return; }
    if (!confirm(`Mark all ${affected} remaining/failed checkpoints as PASS? This cannot be undone easily.`)) return;
    draft.checkpoints.forEach(cp => { cp.result = 'pass'; });
    renderStep(container);
    notify.success('All checkpoints marked as passed.');
  };

  window._addDeficiency = () => {
    draft.deficiencies.push({
      id: 'def_' + crypto.randomUUID(),
      checkpointCode: '',
      type: '',
      description: '',
      severity: 'major',
      estimatedCost: '',
      _category: 'General',
    });
    const defList = document.getElementById('def-list');
    if (defList) {
      defList.innerHTML = draft.deficiencies.map((d, i) =>
        deficiencyEditCard(d, i, Object.keys(DEFICIENCY_TYPES))
      ).join('');
    }
  };

  window._removeDeficiency = (id) => {
    draft.deficiencies = draft.deficiencies.filter(d => d.id !== id);
    const card = document.getElementById(`def-card-${id}`);
    if (card) card.remove();
    if (draft.deficiencies.length === 0) {
      const defList = document.getElementById('def-list');
      if (defList) defList.innerHTML = `
        <div class="card" style="text-align:center;padding:32px;color:var(--text-muted)">
          <div style="width:40px;height:40px;border-radius:50%;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;color:var(--success)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div>No deficiencies</div>
        </div>`;
    }
  };

  window._updateDeficiency = (id, field, value) => {
    const def = draft.deficiencies.find(d => d.id === id);
    if (def) def[field] = value;
  };

  // Refresh type dropdown when category changes
  window._refreshDefTypeOptions = (id, category) => {
    const sel = document.getElementById(`deftype-${id}`);
    if (!sel) return;
    const types = DEFICIENCY_TYPES[category] ?? DEFICIENCY_TYPES['General'];
    sel.innerHTML = `<option value="">Select type…</option>` +
      types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    const def = draft.deficiencies.find(d => d.id === id);
    if (def) def.type = '';
  };

  // Photo upload with per-file progress bar
  window._attachPhoto = (defId, input) => {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    const files = Array.from(input.files);
    if (files.length === 0) return;

    let completed = 0;
    const total   = files.filter(f => f.size <= MAX_SIZE).length;

    files.forEach(file => {
      if (file.size > MAX_SIZE) {
        notify.error(`"${file.name}" exceeds 10MB — skipped`);
        return;
      }

      const photoId       = 'photo_' + crypto.randomUUID();
      const thumbContainer = document.getElementById(`photos-${defId}`);

      // Insert a loading placeholder with a progress bar immediately
      const placeholderId = `thumb-loading-${photoId}`;
      if (thumbContainer) {
        thumbContainer.insertAdjacentHTML('beforeend', `
          <div id="${placeholderId}" style="
            position:relative;width:80px;height:80px;
            border-radius:var(--r-sm);border:1px solid var(--border);
            background:var(--bg-raised);display:flex;flex-direction:column;
            align-items:center;justify-content:center;gap:4px;overflow:hidden
          ">
            <div><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
            <div style="width:60px;height:4px;background:var(--border);border-radius:99px;overflow:hidden">
              <div id="prog-${photoId}" style="height:100%;width:0%;background:var(--brand);border-radius:99px;transition:width .1s linear"></div>
            </div>
            <div id="pct-${photoId}" style="font-size:.6rem;color:var(--text-muted)">0%</div>
          </div>
        `);
      }

      const reader = new FileReader();

      // Update the progress bar as the file loads
      reader.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        const bar = document.getElementById(`prog-${photoId}`);
        const lbl = document.getElementById(`pct-${photoId}`);
        if (bar) bar.style.width = pct + '%';
        if (lbl) lbl.textContent = pct + '%';
      };

      reader.onload = (e) => {
        const photo = {
          id:                 photoId,
          deficiencyId:       defId,
          dataUrl:            e.target.result,
          caption:            file.name,
          size:               file.size,
          inspection_local_id: draft.id,  // links this photo to its draft
        };
        draft.photos.push(photo);

        // Persist to the photo store immediately so the photo survives
        // a page reload or browser crash on the Photos step.
        localPhotos.save(photo).catch(() => {});

        // Replace the placeholder with the real thumbnail
        const placeholder = document.getElementById(placeholderId);
        if (placeholder) {
          placeholder.outerHTML = thumbnailHtml(photo);
        } else if (thumbContainer) {
          // Fallback: placeholder was removed before load finished
          thumbContainer.insertAdjacentHTML('beforeend', thumbnailHtml(photo));
        }

        completed++;
        if (completed === total) {
          notify.success(`${total} photo${total > 1 ? 's' : ''} attached`);
        }
      };

      reader.onerror = () => {
        document.getElementById(placeholderId)?.remove();
        notify.error(`Failed to read "${file.name}"`);
      };

      reader.readAsDataURL(file);
    });

    // Reset so the same file can be selected again
    input.value = '';
  };

  // BUG 6 FIX: remove thumbnail from DOM immediately
  window._removePhoto = (photoId) => {
    draft.photos = draft.photos.filter(p => p.id !== photoId);
    const thumb = document.getElementById(`thumb-${photoId}`);
    if (thumb) thumb.remove();
    localPhotos.remove(photoId).catch(() => {});
    notify.info('Photo removed');
  };
}

// BUG FIX: module-level flag prevents double-submission (rapid double-click)
let _submitInProgress = false;

async function submitInspection(container) {
  // BUG FIX: guard against duplicate submission
  if (_submitInProgress) return;

  // Warn if checkpoints incomplete
  const unchecked = draft.checkpoints.filter(c => c.result === null).length;
  if (unchecked > 0) {
    if (!confirm(`${unchecked} checkpoint${unchecked > 1 ? 's are' : ' is'} not marked. Submit anyway?`)) return;
  }

  _submitInProgress = true;
  const btn = document.getElementById('next-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  const payload = {
    company_id:      getCompanyId() ?? 'default',
    technician_id:   getCurrentUser()?.id ?? 'unknown',
    address:         draft.address,
    inspection_type: draft.system_type,
    notes:           draft.notes,
    metadata: {
      city:         draft.city,
      contact:      draft.contact,
      phone:        draft.phone,
      num_floors:   draft.num_floors,
      num_heads:    draft.num_heads,
      checkpoints:  draft.checkpoints,
      deficiencies: draft.deficiencies.map(d => ({ ...d, dataUrl: undefined })), // strip photos from metadata
      photo_count:  draft.photos.length,
    },
  };

  try {
    if (navigator.onLine) {
      const res = await api.createInspection(payload);
      const serverId = res.data?.id;

      // Upload photos to the backend now that we have an inspection ID.
      // Each photo is sent as a base64-encoded image with deficiency context.
      // Failures are non-fatal — the inspection is still submitted.
      if (serverId && draft.photos.length > 0) {
        const uploadResults = await Promise.allSettled(
          draft.photos.map(photo => {
            // Strip the data-URL prefix before sending (e.g. "data:image/jpeg;base64,")
            const base64 = photo.dataUrl.replace(/^data:[^;]+;base64,/, '');
            return api.addImage(serverId, {
              image:   { type: 'base64', data: base64 },
              context: { deficiency_id: photo.deficiencyId, caption: photo.caption },
            });
          })
        );
        const failed = uploadResults.filter(r => r.status === 'rejected').length;
        if (failed > 0) {
          notify.warn?.(`${failed} photo${failed > 1 ? 's' : ''} failed to upload — inspection was still submitted.`);
        }
      }

      // Clean up the photo store now that photos are on the server
      await localPhotos.removeByInspectionId(draft.id).catch(() => {});

      draft._submitted = true;
      await localInspections.save({ ...draft, server_id: serverId, status: 'submitted', photos: [] });
      setInspectionInProgress(false);
      notify.success('Inspection submitted! Admin has been notified.');
    } else {
      // Offline path: queue the inspection for sync when back online.
      // Photos stay in localPhotos until sync completes — they can't be
      // uploaded until the server assigns an inspection ID.
      await localInspections.save({ ...draft, status: 'pending_sync', photos: [] });
      await syncQueue.push('POST', '/v1/inspection', payload, { localId: draft.id });
      draft._submitted = true;
      setInspectionInProgress(false);
      notify.warning('Saved offline. Will sync when connected.');
    }
    // BUG FIX: clean up popstate handler on successful submit
    if (_popstateHandler) { window.removeEventListener('popstate', _popstateHandler); _popstateHandler = null; }
    draft = null;
    setTimeout(() => window._navigate('/my-day'), 1500);
  } catch (err) {
    notify.error('Submit failed: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Inspection'; }
    _submitInProgress = false;  // allow retry on error
  }
}
