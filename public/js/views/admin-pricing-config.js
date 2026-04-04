/**
 * admin-pricing-config.js — Base Pricing Framework configuration UI
 *
 * Lets admins configure labor rates, markup, fees, and the emergency
 * multiplier that are automatically applied to all generated quotes.
 */

import { loadPricing, savePricing, validatePricing, loadPricingAudit, DEFAULT_PRICING, DEFICIENCY_LABOR_MAP, calculateLineItemPrice } from '../pricing-config.js';

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function renderPricingConfig(container) {
  const p     = loadPricing();
  const audit = loadPricingAudit();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Pricing Settings</div>
        <div class="page-subtitle">Configure rates applied automatically to every generated quote</div>
      </div>
      <button class="btn btn-primary" onclick="window._savePricingConfig()">Save Settings</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:20px;max-width:100%;overflow:hidden">

      <!-- Left: config form -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Labor & Materials -->
        <div class="card">
          <div class="section-title" style="margin-bottom:16px">Labor & Materials</div>
          <div style="display:flex;flex-direction:column;gap:16px">

            <div class="form-group">
              <label class="form-label">Labor Rate (${esc(p.currency)}/hour) *</label>
              <div style="position:relative">
                <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:.85rem">$</span>
                <input class="form-input" type="number" id="pc-labor" min="1" step="0.01"
                  style="padding-left:22px" value="${esc(p.laborRate)}" placeholder="95">
              </div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Industry avg: $80–120/hr for fire suppression techs</div>
            </div>

            <div class="form-group">
              <label class="form-label">Material Markup (%) *</label>
              <div style="position:relative">
                <input class="form-input" type="number" id="pc-markup" min="0" max="200" step="0.1"
                  style="padding-right:28px" value="${esc(p.materialMarkupPercent)}" placeholder="20">
                <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:.85rem">%</span>
              </div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Industry avg: 15–25% overhead on parts</div>
            </div>

          </div>
        </div>

        <!-- Fees -->
        <div class="card">
          <div class="section-title" style="margin-bottom:16px">Service Fees</div>
          <div style="display:flex;flex-direction:column;gap:16px">

            <div class="form-group">
              <label class="form-label">Minimum Service Fee (${esc(p.currency)}) *</label>
              <div style="position:relative">
                <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:.85rem">$</span>
                <input class="form-input" type="number" id="pc-minsvc" min="0" step="0.01"
                  style="padding-left:22px" value="${esc(p.minServiceFee)}" placeholder="50">
              </div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Floor price per line item — no item bills below this</div>
            </div>

            <div class="form-group">
              <label class="form-label">Call-Out / Site Visit Fee (${esc(p.currency)})</label>
              <div style="position:relative">
                <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:.85rem">$</span>
                <input class="form-input" type="number" id="pc-callout" min="0" step="0.01"
                  style="padding-left:22px" value="${esc(p.callOutFee)}" placeholder="100">
              </div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Flat fee added to every quote for the site visit</div>
            </div>

          </div>
        </div>

        <!-- Emergency -->
        <div class="card">
          <div class="section-title" style="margin-bottom:4px">Emergency / After-Hours Multiplier</div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:16px">Applied when the Emergency Service line item is added to a quote</div>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div class="form-group" style="margin:0;flex:1;min-width:160px">
              <label class="form-label">Multiplier *</label>
              <div style="position:relative">
                <input class="form-input" type="number" id="pc-emerg" min="1" max="10" step="0.1"
                  style="padding-right:28px" value="${esc(p.emergencyMultiplier)}" placeholder="1.5">
                <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:.85rem">x</span>
              </div>
              <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Industry standard: 1.5x (time-and-a-half)</div>
            </div>
            <div style="flex:2;min-width:220px;background:var(--bg-raised);border-radius:var(--r-md);padding:14px;font-size:.82rem;color:var(--text-muted)">
              <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">Example calculation</div>
              <div id="pc-example" style="line-height:1.8"></div>
            </div>
          </div>
        </div>

        <!-- Currency -->
        <div class="card">
          <div class="section-title" style="margin-bottom:12px">Currency</div>
          <div class="form-group" style="max-width:200px">
            <label class="form-label">Currency Code</label>
            <select class="form-select" id="pc-currency">
              <option value="CAD" ${p.currency==='CAD'?'selected':''}>CAD — Canadian Dollar</option>
              <option value="USD" ${p.currency==='USD'?'selected':''}>USD — US Dollar</option>
              <option value="GBP" ${p.currency==='GBP'?'selected':''}>GBP — British Pound</option>
              <option value="AUD" ${p.currency==='AUD'?'selected':''}>AUD — Australian Dollar</option>
            </select>
          </div>
        </div>

      </div>

      <!-- Right: live preview + audit -->
      <div style="display:flex;flex-direction:column;gap:12px">

        <!-- Live sample prices -->
        <div class="card" style="padding:16px">
          <div class="section-title" style="margin-bottom:12px">Live Price Preview</div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px">Sample quotes using your current settings:</div>
          <div id="pc-live-preview" style="display:flex;flex-direction:column;gap:8px">
            ${buildLivePreview(p)}
          </div>
          <div style="margin-top:12px;font-size:.72rem;color:var(--text-muted)">
            Updates as you type — save to apply to all new quotes
          </div>
        </div>

        <!-- Reset to defaults -->
        <div class="card" style="padding:14px">
          <div style="font-size:.82rem;font-weight:600;margin-bottom:8px">Reset to Defaults</div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px">Restore industry-average values for Canadian fire suppression companies.</div>
          <button class="btn btn-ghost btn-sm" style="width:100%" onclick="window._resetPricingDefaults()">Reset to Defaults</button>
        </div>

        <!-- Audit trail -->
        ${audit.length > 0 ? `
          <div class="card" style="padding:14px">
            <div style="font-size:.82rem;font-weight:600;margin-bottom:10px">Recent Changes</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${audit.slice(0, 5).map(a => `
                <div style="font-size:.72rem;color:var(--text-muted);padding-bottom:8px;border-bottom:1px solid var(--border)">
                  <div style="color:var(--text-primary);font-weight:600">${esc(a.changedBy)}</div>
                  <div>${new Date(a.changedAt).toLocaleString()}</div>
                  <div style="margin-top:3px;font-family:monospace;font-size:.68rem">${Object.keys(a.diff ?? {}).join(', ')}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

      </div>
    </div>
  `;

  // Live preview: recalculate as user types
  ['pc-labor','pc-markup','pc-minsvc','pc-callout','pc-emerg'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateLivePreview);
  });

  updateLivePreview();

  window._savePricingConfig   = savePricingConfig;
  window._resetPricingDefaults = () => {
    if (!confirm('Reset all pricing to industry defaults?')) return;
    Object.entries(DEFAULT_PRICING).forEach(([k, v]) => {
      const map = { laborRate:'pc-labor', materialMarkupPercent:'pc-markup', minServiceFee:'pc-minsvc', callOutFee:'pc-callout', emergencyMultiplier:'pc-emerg', currency:'pc-currency' };
      const el = document.getElementById(map[k]);
      if (el) el.value = v;
    });
    updateLivePreview();
    window._notify?.info('Defaults loaded — click Save to apply');
  };
}

function readFormValues() {
  return {
    laborRate:             parseFloat(document.getElementById('pc-labor')?.value)   || 0,
    materialMarkupPercent: parseFloat(document.getElementById('pc-markup')?.value)  || 0,
    minServiceFee:         parseFloat(document.getElementById('pc-minsvc')?.value)  || 0,
    callOutFee:            parseFloat(document.getElementById('pc-callout')?.value) || 0,
    emergencyMultiplier:   parseFloat(document.getElementById('pc-emerg')?.value)   || 1,
    currency:              document.getElementById('pc-currency')?.value            || 'CAD',
  };
}

function updateLivePreview() {
  const p = readFormValues();
  const preview = document.getElementById('pc-live-preview');
  if (preview) preview.innerHTML = buildLivePreview(p);

  // Example calc
  const baseEx   = Math.max(p.minServiceFee, 1.5 * p.laborRate + 45 * (1 + p.materialMarkupPercent / 100));
  const emergEx  = (baseEx * p.emergencyMultiplier).toFixed(2);
  const ex = document.getElementById('pc-example');
  if (ex) ex.innerHTML = `
    1.5 hrs labor + $45 parts → <strong>$${baseEx.toFixed(2)}</strong><br>
    Emergency rate: <strong style="color:var(--danger)">$${emergEx}</strong>
  `;
}

function buildLivePreview(p) {
  const samples = [
    { type: 'Missing Sprinkler Head',  emerg: false },
    { type: 'PRV Out of Adjustment',   emerg: false },
    { type: 'Battery Failure',         emerg: false },
    { type: 'Missing Sprinkler Head',  emerg: true  },
  ];
  return samples.map(s => {
    const price = calculateLineItemPrice(s.type, p, s.emerg);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;padding:6px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:500;color:var(--text-primary)">${esc(s.type)}</div>
          ${s.emerg ? '<div style="font-size:.68rem;color:var(--danger)">Emergency rate</div>' : ''}
        </div>
        <div style="font-weight:700;color:${s.emerg ? 'var(--danger)' : 'var(--brand)'}">$${price.toFixed(2)}</div>
      </div>`;
  }).join('');
}

function savePricingConfig() {
  const values = readFormValues();
  const errors = validatePricing(values);
  if (errors.length > 0) {
    window._notify?.error(errors[0]);
    return;
  }
  savePricing(values);
  window._notify?.success('Pricing settings saved — applied to all new quotes');
}
