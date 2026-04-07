/**
 * admin-company-settings.js — Company profile & branding settings
 *
 * Lets admins upload their logo, set brand color, contact info, and footer text.
 * Settings are stored server-side (companyStore) so they persist across devices
 * and appear on every quote PDF automatically.
 */

import { api } from '../api.js';
import { generateQuoteHTML } from '../quote-pdf.js';

const DEFAULT_BRANDING = {
  companyName:    '',
  logoDataUrl:    null,
  primaryColor:   '#f97316',
  contactPhone:   '',
  contactEmail:   '',
  contactWebsite: '',
  address:        '',
  footerText:     'Thank you for your business. Prices are valid for 30 days.',
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderCompanySettings(container) {
  container.innerHTML = `
    <div style="max-width:860px;margin:0 auto;padding:32px 24px 80px">
      <div style="margin-bottom:28px">
        <h1 style="font-size:1.5rem;font-weight:900;margin:0 0 6px">Company Settings</h1>
        <p style="font-size:.9rem;color:var(--text-muted);margin:0">
          Your logo and branding appear on every quote PDF sent to customers.
        </p>
      </div>
      <div id="settings-body">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  try {
    const res = await api.getBranding();
    const branding = { ...DEFAULT_BRANDING, ...(res.data ?? {}) };
    renderBody(document.getElementById('settings-body'), branding);
  } catch (err) {
    document.getElementById('settings-body').innerHTML = `
      <div style="color:var(--danger);padding:24px;text-align:center">
        Failed to load settings: ${err.message}
      </div>`;
  }
}

// ─── Main body ────────────────────────────────────────────────────────────────

function renderBody(el, branding) {
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 340px;gap:24px;align-items:start">

      <!-- Left: form -->
      <div style="display:flex;flex-direction:column;gap:20px">

        <!-- Logo card -->
        <div class="card" style="padding:24px">
          <div class="section-title" style="margin-bottom:16px">Company Logo</div>
          <div id="logo-preview-wrap" style="margin-bottom:16px">
            ${logoPreview(branding.logoDataUrl, branding.companyName)}
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <label style="cursor:pointer">
              <div class="btn btn-ghost btn-sm" style="gap:6px">
                ⬆ ${branding.logoDataUrl ? 'Replace Logo' : 'Upload Logo'}
              </div>
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                style="display:none" id="logo-file-input" onchange="window._csHandleLogoUpload(this)">
            </label>
            ${branding.logoDataUrl ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="window._csRemoveLogo()">✕ Remove</button>` : ''}
          </div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-top:10px">
            PNG, JPG, SVG or WebP · Max 2 MB · Recommended: 400×120px or wider
          </div>
        </div>

        <!-- Company info card -->
        <div class="card" style="padding:24px">
          <div class="section-title" style="margin-bottom:16px">Company Info</div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Company Name</label>
              <input class="form-input" id="cs-name" placeholder="Acme Fire Protection"
                value="${esc(branding.companyName)}" oninput="window._csRefreshPreview()">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Business Address</label>
              <input class="form-input" id="cs-address" placeholder="123 Main St, City, ST 00000"
                value="${esc(branding.address ?? '')}" oninput="window._csRefreshPreview()">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group" style="margin:0">
                <label class="form-label">Phone</label>
                <input class="form-input" id="cs-phone" placeholder="(555) 000-0000"
                  value="${esc(branding.contactPhone)}" oninput="window._csRefreshPreview()">
              </div>
              <div class="form-group" style="margin:0">
                <label class="form-label">Email</label>
                <input class="form-input" id="cs-email" placeholder="info@company.com"
                  value="${esc(branding.contactEmail)}" oninput="window._csRefreshPreview()">
              </div>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Website</label>
              <input class="form-input" id="cs-website" placeholder="www.yourcompany.com"
                value="${esc(branding.contactWebsite)}" oninput="window._csRefreshPreview()">
            </div>
          </div>
        </div>

        <!-- Brand appearance card -->
        <div class="card" style="padding:24px">
          <div class="section-title" style="margin-bottom:16px">Quote Appearance</div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Brand Color</label>
              <div style="display:flex;gap:10px;align-items:center">
                <input type="color" id="cs-color" value="${esc(branding.primaryColor)}"
                  style="width:44px;height:38px;border:none;border-radius:8px;cursor:pointer;padding:2px;background:none"
                  oninput="document.getElementById('cs-color-hex').value=this.value;window._csRefreshPreview()">
                <input class="form-input" id="cs-color-hex" style="font-family:monospace;width:110px"
                  value="${esc(branding.primaryColor)}" placeholder="#f97316"
                  oninput="document.getElementById('cs-color').value=this.value;window._csRefreshPreview()">
                <span style="font-size:.8rem;color:var(--text-muted)">Used for headings, accents, and table headers</span>
              </div>
              <!-- Color swatches -->
              <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                ${['#f97316','#3b82f6','#22c55e','#ef4444','#8b5cf6','#ec4899','#0ea5e9','#1e293b'].map(c => `
                  <button onclick="document.getElementById('cs-color').value='${c}';document.getElementById('cs-color-hex').value='${c}';window._csRefreshPreview()"
                    style="width:28px;height:28px;border-radius:6px;background:${c};border:2px solid transparent;cursor:pointer;transition:transform .1s"
                    title="${c}"></button>`).join('')}
              </div>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Quote Footer Text</label>
              <input class="form-input" id="cs-footer"
                value="${esc(branding.footerText)}"
                placeholder="Thank you for your business. Prices are valid for 30 days."
                oninput="window._csRefreshPreview()">
            </div>
          </div>
        </div>

        <!-- Save button -->
        <button class="btn btn-primary" id="cs-save-btn" style="align-self:flex-start;padding:12px 28px;font-size:.95rem"
          onclick="window._csSave()">
          Save Settings
        </button>

      </div>

      <!-- Right: live preview -->
      <div style="position:sticky;top:80px">
        <div class="card" style="padding:16px">
          <div class="section-title" style="margin-bottom:12px">Live Preview</div>
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:12px">
            This is what the top of your quote PDF will look like.
          </div>
          <div id="cs-preview-wrap" style="
            border:1px solid var(--border);
            border-radius:var(--r-md);
            overflow:hidden;
            background:#fff;
            transform-origin:top left;
          ">
            <iframe id="cs-preview-iframe" style="width:820px;height:320px;border:none;display:block;pointer-events:none"
              title="Branding preview"></iframe>
          </div>
          <div style="font-size:.72rem;color:var(--text-muted);margin-top:8px;text-align:center">
            Preview is scaled — actual PDF is full page width
          </div>
        </div>
      </div>

    </div>
  `;

  // Scale the preview iframe to fit the card
  scalePreview();
  window.addEventListener('resize', scalePreview);

  // Wire up globals
  window._csHandleLogoUpload = handleLogoUpload;
  window._csRemoveLogo       = removeLogo;
  window._csRefreshPreview   = refreshPreview;
  window._csSave             = save;

  // Initial preview render
  refreshPreview();
}

// ─── Logo upload ──────────────────────────────────────────────────────────────

function handleLogoUpload(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    window._notify?.error('Logo must be under 2 MB');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    window._csPendingLogo = e.target.result;
    document.getElementById('logo-preview-wrap').innerHTML =
      logoPreview(e.target.result, document.getElementById('cs-name')?.value ?? '');
    // Show remove button dynamically
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm';
    btn.style.color = 'var(--danger)';
    btn.textContent = '✕ Remove';
    btn.onclick = () => window._csRemoveLogo();
    document.querySelector('[onclick="window._csRemoveLogo()"]')?.remove();
    document.querySelector('label[style*="cursor:pointer"]')?.after(btn);
    refreshPreview();
    window._notify?.success('Logo ready — click Save to apply');
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  window._csPendingLogo = null;
  window._csLogoRemoved = true;
  document.getElementById('logo-preview-wrap').innerHTML = logoPreview(null, document.getElementById('cs-name')?.value ?? '');
  refreshPreview();
  window._notify?.info('Logo removed — click Save to apply');
}

function logoPreview(dataUrl, name) {
  if (dataUrl) {
    return `
      <div style="
        background:var(--bg-raised);
        border:1px solid var(--border);
        border-radius:var(--r-md);
        padding:16px;
        display:flex;
        align-items:center;
        justify-content:center;
        min-height:80px;
      ">
        <img src="${dataUrl}" alt="Logo preview"
          style="max-height:64px;max-width:240px;object-fit:contain;display:block">
      </div>`;
  }
  return `
    <div style="
      background:var(--bg-raised);
      border:2px dashed var(--border);
      border-radius:var(--r-md);
      padding:24px;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:8px;
      min-height:80px;
      color:var(--text-muted);
    ">
      <div style="font-size:1.6rem">🖼</div>
      <div style="font-size:.82rem">${name ? `<strong style="color:var(--text-subtle)">${esc(name)}</strong> will appear here` : 'No logo uploaded yet'}</div>
    </div>`;
}

// ─── Live preview ─────────────────────────────────────────────────────────────

function scalePreview() {
  const wrap = document.getElementById('cs-preview-wrap');
  if (!wrap) return;
  const available = wrap.parentElement?.clientWidth ?? 300;
  const scale = Math.min(1, available / 820);
  wrap.style.transform = `scale(${scale})`;
  wrap.style.height = `${Math.round(320 * scale)}px`;
  wrap.style.width = `${Math.round(820 * scale)}px`;
}

function refreshPreview() {
  const iframe = document.getElementById('cs-preview-iframe');
  if (!iframe) return;

  const branding = collectForm();
  // Render just the header portion of the quote for the preview
  const previewHtml = generateQuoteHTML(
    { quoteNumber: '0001', validUntil: '', address: 'Sample Customer\n123 Building St', contact: 'Contact Name', lineItems: [], subtotal: 0, tax: 0, total: 0, taxRate: 0 },
    branding
  );
  iframe.srcdoc = previewHtml;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function save() {
  const btn = document.getElementById('cs-save-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const data = collectForm();
    await api.saveBranding(data);
    window._csPendingLogo = undefined;
    window._csLogoRemoved = undefined;
    window._notify?.success('Company settings saved — all future quotes will use this branding');
  } catch (err) {
    window._notify?.error(err.message ?? 'Failed to save settings');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save Settings';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectForm() {
  const savedLogo = window._csPendingLogo !== undefined
    ? (window._csLogoRemoved ? null : window._csPendingLogo)
    : undefined; // undefined = don't change

  return {
    companyName:    document.getElementById('cs-name')?.value?.trim()     ?? '',
    address:        document.getElementById('cs-address')?.value?.trim()  ?? '',
    contactPhone:   document.getElementById('cs-phone')?.value?.trim()    ?? '',
    contactEmail:   document.getElementById('cs-email')?.value?.trim()    ?? '',
    contactWebsite: document.getElementById('cs-website')?.value?.trim()  ?? '',
    primaryColor:   document.getElementById('cs-color')?.value            ?? '#f97316',
    footerText:     document.getElementById('cs-footer')?.value?.trim()   ?? '',
    ...(savedLogo !== undefined ? { logoDataUrl: savedLogo } : {}),
  };
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
