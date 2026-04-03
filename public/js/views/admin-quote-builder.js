/**
 * admin-quote-builder.js — Auto-generate and edit quotes from deficiencies
 *
 * When navigated here from Inspection Review (via _generateQuote), the source
 * inspection ID is in window._quoteSourceInspectionId.  The builder loads that
 * inspection's deficiencies and pre-populates line items automatically.  If no
 * source is set, the most recent inspection with deficiencies is used instead.
 */

import { api } from '../api.js';
import { generateQuoteHTML, loadBranding, saveBranding } from '../quote-pdf.js';

// Inline pricing helpers
function loadPricing() {
  try {
    const d = { laborRate:95, materialMarkupPercent:20, minServiceFee:50, callOutFee:100, emergencyMultiplier:1.5 };
    const raw = localStorage.getItem('ff_pricing');
    return raw ? { ...d, ...JSON.parse(raw) } : d;
  } catch { return { laborRate:95, materialMarkupPercent:20, minServiceFee:50, callOutFee:100, emergencyMultiplier:1.5 }; }
}
const _LABOR_MAP = {
  'Missing Sprinkler Head':{ hours:1.5, materials:45 },'Corroded Sprinkler Head':{ hours:1.0, materials:35 },
  'Painted Sprinkler Head':{ hours:1.0, materials:35 },'Main Valve Issue':{ hours:2.5, materials:120 },
  'Pressure Out of Range':{ hours:1.5, materials:30 },'Missing Spare Heads/Wrench':{ hours:0.5, materials:75 },
  'FDC Obstruction':{ hours:0.75, materials:0 },'PRV Out of Adjustment':{ hours:2.0, materials:50 },
  'Pressure Failure':{ hours:2.5, materials:70 },'Device Failure':{ hours:2.0, materials:180 },
  'Battery Failure':{ hours:1.0, materials:90 },'Trouble Signal Active':{ hours:1.5, materials:25 },
  'Audibility Failure':{ hours:2.0, materials:60 },'No Inspection Tag':{ hours:0.25, materials:8 },
  'Unauthorized Modification':{ hours:3.0, materials:120 },'_default':{ hours:1.0, materials:0 },
};
function calcItemPrice(type, p) {
  const l = _LABOR_MAP[type] ?? _LABOR_MAP['_default'];
  return Math.round(Math.max(p.minServiceFee,(l.hours*p.laborRate)+(l.materials*(1+p.materialMarkupPercent/100)))*100)/100;
}
function calculateLineItemPrice(type, p, isEmergency) {
  const base = calcItemPrice(type, p);
  return isEmergency ? Math.round(base * (p.emergencyMultiplier ?? 1.5) * 100) / 100 : base;
}
function buildCallOutLineItem(pricing) {
  return { id: 'li_callout', description: 'Service Call / Call-Out Fee', category: 'callout', qty: 1, unitPrice: pricing.callOutFee ?? 100, locked: true };
}

// HTML-escape helper — keeps this module self-contained so it's safe even
// before window._escapeHtml is set by app.js.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TAX_RATE    = 0.08;

let quoteItems     = [];
let quoteNotes     = 'Prices are estimates and may vary based on field conditions. Final invoice will reflect actual materials used.';
let sourceInspection = null;
// BUG FIX: guard against double-send (race condition if user clicks twice)
let sendInProgress = false;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderQuoteBuilder(container) {
  // Consume the source inspection ID set by the Inspection Review page
  const sourceId = window._quoteSourceInspectionId ?? null;
  window._quoteSourceInspectionId = null;

  // Reset state
  quoteItems       = [];
  sourceInspection = null;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Quote Builder</div>
        <div class="page-subtitle" id="quote-subtitle">Loading inspection data…</div>
      </div>
      <div class="flex-row">
        <button class="btn btn-ghost" onclick="window._previewQuote()">Preview PDF</button>
        <button class="btn btn-primary" onclick="window._sendQuote()">Send to Customer</button>
      </div>
    </div>

    <div id="quote-builder-body" style="overflow-x:hidden;max-width:100%">
      <div class="spinner"></div>
      <div style="color:var(--text-muted);font-size:.85rem">Loading…</div>
    </div>
  `;

  try {
    await loadAndBuildQuote(sourceId);
  } catch (err) {
    document.getElementById('quote-builder-body').innerHTML = `
      <div class="card" style="text-align:center;padding:40px;max-width:500px">
        <div class="empty-icon" style="margin:0 auto 12px;color:var(--danger);border-color:rgba(239,68,68,.25);background:var(--danger-dim)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <p style="color:var(--danger)">${err.message}</p>
        <button class="btn btn-ghost btn-sm mt-2" onclick="window._navigate('/inspections')">← Back to Inspections</button>
      </div>
    `;
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadAndBuildQuote(sourceId) {
  let inspection = null;

  if (sourceId) {
    // Load the specific inspection requested by the Review page
    const res = await api.getInspection(sourceId);
    inspection = res.data ?? null;
  }

  if (!inspection) {
    // Fallback: pick the most recent inspection with deficiencies
    const res     = await api.listInspections({ exclude: 'draft,cancelled' });
    const list    = (res.data ?? []).filter(i => (i.deficiencies ?? []).length > 0);
    inspection    = list[0] ?? null;
  }

  if (!inspection) {
    // No data at all — show the editor with default items
    sourceInspection = null;
    quoteItems = defaultLineItems();
    renderBody(null);
    return;
  }

  sourceInspection = inspection;
  quoteItems = buildLineItems(inspection);
  renderBody(inspection);
}

function defaultLineItems() {
  const p = loadPricing();
  return [
    buildCallOutLineItem(p),
    { id: 'li_1', description: 'Inspection Labor', qty: 1, unitPrice: p.laborRate, category: 'labor', locked: false },
  ];
}

function buildLineItems(insp) {
  const p     = loadPricing();
  const items = [ buildCallOutLineItem(p) ];
  const defs  = insp.deficiencies ?? [];

  defs.forEach((d, i) => {
    // Auto-price from deficiency type using company pricing framework
    const autoPrice = calculateLineItemPrice(d.type ?? '', p, false);
    // If technician already entered a cost, prefer that; otherwise use auto-price
    const manualCost = d.estimatedCost ? +d.estimatedCost : 0;
    const unitPrice  = manualCost > 0 ? manualCost : autoPrice;

    const desc = d.description
      ? d.description.slice(0, 80) + (d.description.length > 80 ? '…' : '')
      : (d.type || 'Deficiency repair');

    items.push({
      id:          `li_def_${i}`,
      description: desc,
      qty:         1,
      unitPrice,
      category:    d.severity === 'critical' ? 'labor' : 'labor',
      locked:      false,
      _defCode:    d.code ?? d.checkpointCode ?? '',
      _autoPriced: manualCost === 0,  // flag: price came from pricing framework
    });
  });

  if (items.length === 1) {
    items.push({ id: 'li_labor', description: 'Inspection labor', qty: 1, unitPrice: p.laborRate, category: 'labor', locked: false });
  }

  return items;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderBody(insp) {
  const defCount = (insp?.deficiencies ?? []).length;
  const subtitle = document.getElementById('quote-subtitle');
  if (subtitle) {
    subtitle.textContent = insp
      ? `Auto-generated from: ${insp.address ?? 'inspection'} · ${defCount} deficiencies → ${quoteItems.length} line items`
      : 'No inspection selected — add line items manually';
  }

  document.getElementById('quote-builder-body').innerHTML = `
    <div style="class="quote-layout" style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:start">

      <!-- Left: line item editor -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Job info -->
        <div class="card">
          <div class="section-title" style="margin-bottom:12px">Job Details</div>
          <div class="grid-2" style="gap:12px">
            <div class="form-group">
              <label class="form-label">Property Address</label>
              <input class="form-input" value="${esc(insp?.address ?? '')}" id="q-address" placeholder="123 Main St">
            </div>
            <div class="form-group">
              <label class="form-label">Contact Name</label>
              <input class="form-input" placeholder="Property Manager" id="q-contact" value="${esc(insp?.contact ?? '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Contact Email</label>
              <input class="form-input" type="email" placeholder="manager@property.com" id="q-email">
            </div>
            <div class="form-group">
              <label class="form-label">Quote Valid Until</label>
              <input class="form-input" type="date" id="q-valid-until" value="${validUntilDate()}">
            </div>
          </div>
        </div>

        <!-- Line items -->
        <div class="card">
          <div class="flex-between" style="margin-bottom:14px">
            <div class="section-title">Line Items</div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,.3)" onclick="window._addEmergencyItem()">Emergency Service</button>
              <button class="btn btn-ghost btn-sm" onclick="window._addLineItem()">+ Add Item</button>
            </div>
          </div>
          <div id="line-items-table">
            ${renderLineItemsTable()}
          </div>
        </div>

        <!-- Notes -->
        <div class="card">
          <div class="section-title" style="margin-bottom:10px">Notes & Terms</div>
          <textarea class="form-textarea" id="q-notes" style="min-height:100px">${quoteNotes}</textarea>
        </div>
      </div>

      <!-- Right: summary -->
      <div style="position:sticky;top:80px">
        <div class="card" id="quote-summary">
          ${renderQuoteSummary()}
        </div>

        ${insp ? `
          <div class="card mt-2" style="padding:16px">
            <div class="section-title" style="margin-bottom:10px">Category Breakdown</div>
            ${renderCategoryBreakdown()}
          </div>

          <div class="card mt-2" style="padding:16px;border-color:rgba(249,115,22,.3)">
            <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px">Auto-generated from inspection:</div>
            <div style="font-size:.88rem;font-weight:600">${esc(insp.address ?? '—')}</div>
            <div style="font-size:.78rem;color:var(--text-muted)">${esc(insp.inspection_type ?? '—')} · ${esc(insp.technician_id?.slice(0, 10) ?? 'Tech')}</div>
            <div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">${defCount} deficiencies → ${quoteItems.length} line items</div>
            <button class="btn btn-ghost btn-sm mt-2" style="width:100%;justify-content:center" onclick="window._navigate('/inspections')">
              ← Back to Inspection
            </button>
          </div>
        ` : `
          <div class="card mt-2" style="padding:16px">
            <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px">No inspection selected.</div>
            <p style="font-size:.78rem;color:var(--text-muted)">Go to Inspection Review and click "Generate Quote" to auto-populate from deficiencies.</p>
            <button class="btn btn-ghost btn-sm mt-2" style="width:100%;justify-content:center" onclick="window._navigate('/inspections')">
              Go to Inspections →
            </button>
          </div>
        `}
      </div>
    </div>
  `;

  window._addLineItem      = addLineItem;
  window._addEmergencyItem = addEmergencyItem;
  window._removeItem   = removeItem;
  window._updateItem   = updateItem;
  window._previewQuote = previewQuote;
  window._exportPDF        = exportPDF;
  window._sendQuote    = sendQuote;
  window._recalc       = recalc;
}

// ── Line items table ──────────────────────────────────────────────────────────

function renderLineItemsTable() {
  const rows = quoteItems.map(item => `
    <tr data-id="${item.id}">
      <td>
        <span class="badge ${item.category === 'labor' ? 'badge-blue' : item.category === 'emergency' ? 'badge-red' : 'badge-orange'}" style="font-size:.68rem">${item.category}</span>
      </td>
      <td>
        <input class="form-input" style="font-size:.82rem;padding:6px 10px"
          value="${esc(item.description)}"
          onchange="window._updateItem('${item.id}', 'description', this.value)"
          ${item.locked ? 'readonly style="font-size:.82rem;padding:6px 10px;opacity:.6"' : ''}>
      </td>
      <td style="width:70px">
        <input class="form-input" type="number" min="1" style="font-size:.82rem;padding:6px 10px;text-align:right"
          value="${item.qty}"
          onchange="window._updateItem('${item.id}', 'qty', +this.value);window._recalc()">
      </td>
      <td style="width:110px">
        <div style="position:relative">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:.82rem">$</span>
          <input class="form-input" type="number" min="0" step="0.01" style="font-size:.82rem;padding:6px 10px 6px 20px;text-align:right"
            value="${item.unitPrice}"
            onchange="window._updateItem('${item.id}', 'unitPrice', +this.value);window._recalc()">
        </div>
      </td>
      <td style="width:90px;text-align:right;font-weight:600;font-size:.85rem;padding-right:8px">
        $${(item.qty * item.unitPrice).toLocaleString('en-US', {minimumFractionDigits:2})}
      </td>
      <td style="width:36px">
        ${!item.locked ? `
          <button class="btn btn-icon" style="color:var(--danger);border-color:transparent;font-size:.9rem"
            onclick="window._removeItem('${item.id}')">✕</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  return `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="padding:8px;text-align:left;font-size:.72rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">Category</th>
          <th style="padding:8px;text-align:left;font-size:.72rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">Description</th>
          <th style="padding:8px;text-align:right;font-size:.72rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">Qty</th>
          <th style="padding:8px;text-align:right;font-size:.72rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">Unit Price</th>
          <th style="padding:8px;text-align:right;font-size:.72rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">Total</th>
          <th style="border-bottom:1px solid var(--border)"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Summary ───────────────────────────────────────────────────────────────────

function renderQuoteSummary() {
  const subtotal = quoteItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  const tax      = subtotal * TAX_RATE;
  const total    = subtotal + tax;

  return `
    <div class="section-title" style="margin-bottom:14px">Quote Summary</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${summaryRow('Subtotal', '$' + subtotal.toLocaleString('en-US', {minimumFractionDigits:2}))}
      ${summaryRow(`Tax (${(TAX_RATE * 100).toFixed(0)}%)`, '$' + tax.toLocaleString('en-US', {minimumFractionDigits:2}))}
      <div style="height:1px;background:var(--border);margin:4px 0"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:1rem">Total</span>
        <span style="font-weight:800;font-size:1.3rem;color:var(--brand)">$${total.toLocaleString('en-US', {minimumFractionDigits:2})}</span>
      </div>
      <div style="font-size:.73rem;color:var(--text-muted);text-align:right;margin-top:2px">Valid 30 days · Subject to change</div>
    </div>
    <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:16px" onclick="window._sendQuote()">
      Send Quote to Customer
    </button>
  `;
}

function summaryRow(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:.875rem">
      <span style="color:var(--text-muted)">${label}</span>
      <span>${value}</span>
    </div>
  `;
}

function renderCategoryBreakdown() {
  const cats = {};
  for (const item of quoteItems) {
    cats[item.category] = (cats[item.category] ?? 0) + item.qty * item.unitPrice;
  }
  return Object.entries(cats).map(([cat, amt]) => `
    <div style="display:flex;justify-content:space-between;font-size:.82rem;padding:5px 0;border-bottom:1px solid var(--border)">
      <span class="badge ${cat === 'labor' ? 'badge-blue' : cat === 'emergency' ? 'badge-red' : 'badge-orange'}">${cat}</span>
      <span style="font-weight:600">$${amt.toLocaleString('en-US', {minimumFractionDigits:2})}</span>
    </div>
  `).join('');
}

// ── Line item actions ─────────────────────────────────────────────────────────

function addLineItem() {
  quoteItems.push({
    id:          'li_' + Date.now(),
    description: 'New line item',
    qty:         1,
    unitPrice:   0,
    category:    'labor',
    locked:      false,
  });
  recalc();
}

function addEmergencyItem() {
  quoteItems.push({
    id:          'li_emg_' + Date.now(),
    description: 'Emergency Service Fee',
    qty:         1,
    unitPrice:   0,
    category:    'emergency',
    locked:      false,
  });
  recalc();
}

function removeItem(id) {
  quoteItems = quoteItems.filter(i => i.id !== id);
  recalc();
}

function updateItem(id, field, value) {
  const item = quoteItems.find(i => i.id === id);
  if (item) item[field] = value;
}

function recalc() {
  const tableEl   = document.getElementById('line-items-table');
  const summaryEl = document.getElementById('quote-summary');
  if (tableEl)   tableEl.innerHTML   = renderLineItemsTable();
  if (summaryEl) summaryEl.innerHTML = renderQuoteSummary();
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendQuote() {
  // BUG FIX: prevent double-send if user clicks the button more than once
  if (sendInProgress) { window._notify?.info('Already sending, please wait…'); return; }

  const email   = document.getElementById('q-email')?.value?.trim();
  const address = document.getElementById('q-address')?.value?.trim();
  const contact = document.getElementById('q-contact')?.value?.trim();
  const validUntil = document.getElementById('q-valid-until')?.value?.trim();
  const notes   = document.getElementById('q-notes')?.value?.trim();

  if (!email) { window._notify?.error('Enter a customer email address first'); return; }

  sendInProgress = true;
  const sendBtns = document.querySelectorAll('button[onclick="window._sendQuote()"]');
  sendBtns.forEach(b => { b.disabled = true; b.textContent = 'Sending…'; });

  let quoteId = null;  // BUG FIX: track quoteId for cleanup if sendQuote() fails

  try {
    const companyId = window._getCompanyId?.() ?? 'default';

    // Step 1: create the quote on the backend
    const subtotal = quoteItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const total    = +(subtotal * (1 + TAX_RATE)).toFixed(2);

    const createRes = await api.createQuote({
      company_id:     companyId,
      inspection_id:  sourceInspection?.id ?? null,
      customer_email: email,
      address:        address  || sourceInspection?.address || null,
      contact:        contact  || sourceInspection?.contact || null,
      line_items:     quoteItems.map(({ id: _id, locked: _locked, _defCode: _dc, ...rest }) => rest),
      notes:          notes    || null,
      valid_until:    validUntil || null,
      summary:        { subtotal, total, tax: +(subtotal * TAX_RATE).toFixed(2) },
    });

    quoteId = createRes.data?.id;
    if (!quoteId) throw new Error('Quote creation failed — no ID returned');

    // Step 2: send to customer (transitions to SENT, returns signed link)
    // BUG FIX: if this fails the quote is stranded in 'review' state.
    // We catch and re-throw but quoteId is available in the error handler for retry.
    const sendRes = await api.sendQuote(quoteId, { customer_email: email });
    const customerUrl = sendRes.data?.customer_url;

    // Show success modal with the shareable link
    showSentModal(email, customerUrl, total);

  } catch (err) {
    // BUG FIX: if we created the quote but sending failed, inform the admin
    // so they can retry from the Pipeline view rather than creating a duplicate.
    if (quoteId) {
      window._notify?.error(`Quote created (ID: ${quoteId.slice(0,8)}…) but send failed: ${err.message}. Find it in Pipeline to retry.`);
    } else {
      window._notify?.error('Failed to send quote: ' + err.message);
    }
  } finally {
    sendInProgress = false;
    sendBtns.forEach(b => { b.disabled = false; b.textContent = 'Send to Customer'; });
  }
}

function showSentModal(email, customerUrl, total) {
  // Remove any existing modal
  document.getElementById('quote-sent-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'quote-sent-modal';
  modal.className = 'modal-backdrop';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  const display = customerUrl ?? 'Link unavailable — check server logs';
  const totalFmt = typeof total === 'number'
    ? '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2 })
    : '—';

  // SECURITY: email, customerUrl, and totalFmt are all untrusted (user input /
  // server data).  Only static structure goes into innerHTML.  Dynamic values
  // are set via textContent or addEventListener — never via string interpolation
  // into onclick attributes.
  modal.innerHTML = `
    <div class="modal" style="max-width:540px">
      <div class="modal-header">
        <div>
          <div class="modal-title">Quote Sent</div>
          <div id="qsm-subtitle" style="font-size:.8rem;color:var(--text-muted);margin-top:3px"></div>
        </div>
        <button class="modal-close" onclick="document.getElementById('quote-sent-modal').remove()">✕</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:var(--r-md);padding:16px">
          <div style="font-size:.78rem;font-weight:700;color:var(--success);margin-bottom:8px">CUSTOMER APPROVAL LINK</div>
          <div id="qsm-url" style="font-size:.78rem;color:var(--text-subtle);word-break:break-all;margin-bottom:10px"></div>
          <button id="qsm-copy-btn" class="btn btn-ghost btn-sm">Copy Link</button>
        </div>

        <p style="font-size:.85rem;color:var(--text-muted);line-height:1.6">
          The customer can click the link to view their quote and accept or decline it — no account required.
          The link is valid for 30 days.
        </p>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('quote-sent-modal').remove()">Done</button>
        <button class="btn btn-primary" onclick="window._navigate('/pipeline');document.getElementById('quote-sent-modal')?.remove()">
          View Pipeline →
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Set dynamic values via textContent — XSS-safe regardless of content
  modal.querySelector('#qsm-subtitle').textContent = `${totalFmt} · to ${email}`;
  modal.querySelector('#qsm-url').textContent = display;

  // Wire clipboard via addEventListener — URL never touches an onclick="" string
  modal.querySelector('#qsm-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(display)
      .then(() => window._notify?.success('Link copied!'))
      .catch(() => window._notify?.error('Could not copy to clipboard'));
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validUntilDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

// ── Quote data collector ──────────────────────────────────────────────────────

function collectQuoteData() {
  const subtotal = quoteItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const tax      = subtotal * TAX_RATE;
  const total    = subtotal + tax;
  return {
    address:     document.getElementById('q-address')?.value?.trim()    ?? '',
    contact:     document.getElementById('q-contact')?.value?.trim()    ?? '',
    email:       document.getElementById('q-email')?.value?.trim()      ?? '',
    validUntil:  document.getElementById('q-valid-until')?.value        ?? '',
    notes:       document.getElementById('q-notes')?.value?.trim()      ?? '',
    lineItems:   quoteItems,
    subtotal,
    tax,
    total,
    taxRate:     TAX_RATE,
    quoteNumber: sourceInspection?.id?.slice(-6)?.toUpperCase() ?? '',
  };
}

// ── Branding collector (reads live form values, falls back to saved) ──────────

function collectCurrentBranding() {
  const saved = loadBranding();
  return {
    ...saved,
    companyName:    document.getElementById('b-name')?.value?.trim()    ?? saved.companyName,
    primaryColor:   document.getElementById('b-color')?.value           ?? saved.primaryColor,
    contactPhone:   document.getElementById('b-phone')?.value?.trim()   ?? saved.contactPhone,
    contactEmail:   document.getElementById('b-email')?.value?.trim()   ?? saved.contactEmail,
    contactWebsite: document.getElementById('b-website')?.value?.trim() ?? saved.contactWebsite,
    footerText:     document.getElementById('b-footer')?.value?.trim()  ?? saved.footerText,
  };
}

// ── PDF Preview (full-screen iframe modal) ────────────────────────────────────

function previewQuote() {
  const html = generateQuoteHTML(collectQuoteData(), collectCurrentBranding());
  document.getElementById('pdf-preview-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'pdf-preview-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;background:#1a1a2e';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:#0f172a;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0">
      <div style="flex:1">
        <span style="color:#fff;font-weight:700;font-size:.95rem">PDF Preview</span>
        <span style="color:#64748b;font-size:.78rem;margin-left:8px">Exactly what will be sent</span>
      </div>
      <button onclick="window._exportPDF()" style="background:#f97316;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:.82rem;font-weight:700;cursor:pointer">&#11015; Download PDF</button>
      <button onclick="window._sendQuote()" style="background:#22c55e;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:.82rem;font-weight:700;cursor:pointer">&#9993; Send to Customer</button>
      <button onclick="document.getElementById('pdf-preview-modal').remove()" style="background:rgba(255,255,255,.08);color:#94a3b8;border:none;border-radius:8px;padding:7px 12px;font-size:.82rem;cursor:pointer">&#10005; Close</button>
    </div>
    <div style="flex:1;overflow:auto;display:flex;justify-content:center;padding:28px 20px;background:#334155">
      <div style="width:100%;max-width:820px;background:#fff;border-radius:4px;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden;min-height:1060px">
        <iframe id="pdf-preview-iframe" style="width:100%;height:100%;min-height:1060px;border:none;display:block" title="Quote PDF Preview"></iframe>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('pdf-preview-iframe').srcdoc = html;

  const onKey = (e) => {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}

// ── PDF Export (opens print dialog in new tab) ────────────────────────────────

function exportPDF() {
  const html = generateQuoteHTML(collectQuoteData(), collectCurrentBranding());
  const win  = window.open('', '_blank', 'width=900,height=700');
  if (!win) { window._notify?.error('Pop-up blocked — allow pop-ups to export PDF'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}
