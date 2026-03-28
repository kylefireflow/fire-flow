/**
 * customer-quote.js — Public quote approval page for customers
 *
 * Accessed via a signed link: /customer-quote?token=<jwt>
 * No login required — the JWT in the URL is the customer's credential.
 *
 * Flow:
 *   1. Decode token → extract quote_id
 *   2. GET /v1/quote/:id (with token as Bearer) → load quote data
 *   3. Show line items, total, notes, expiry
 *   4. "Accept" → POST /v1/quote/:id/accept  → creates job, shows success state
 *   5. "Decline" → ask for reason → POST /v1/quote/:id/customer-reject → shows declined state
 */

import { api } from '../api.js';

const TAX_RATE = 0.08;

export async function renderCustomerQuote(container) {
  container.innerHTML = `
    <div style="min-height:100vh;background:var(--bg-base);display:flex;flex-direction:column">

      <!-- Minimal header — no nav, just branding -->
      <header style="background:var(--bg-surface);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:10px">
        <div style="width:30px;height:30px;background:var(--brand);border-radius:6px;display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-1 .23-1.94.75-2.72 1.32-2.23 1.74-3.28 4.7-2.72 7.45.06.27.06.55 0 .82-.07.27-.2.53-.4.74-.55.52-.78 1.28-.65 1.99.13.7.62 1.3 1.28 1.56.76.3 1.58.14 2.22-.38.42-.35.7-.86.74-1.4.04-.48-.13-.95-.38-1.35-.54-.79-.66-1.49-.46-2.19.06.46.28.9.6 1.24.63.67 1.35 1.28 1.9 2.01.7.96 1.04 2.12.98 3.28-.04.72-.25 1.44-.61 2.05 1.32.97 2.73 1.2 3.97.7 2.48-1.01 3.94-3.72 3.15-6.32-.28-.93-.78-1.75-1.54-2.44-.48-.43-1.04-.8-1.3-1.54z"/></svg></div>
        <span style="font-size:1rem;font-weight:800;letter-spacing:-.3px">Fire Flow</span>
        <span style="margin-left:auto;font-size:.78rem;color:var(--text-muted)">Fire Suppression Inspection Services</span>
      </header>

      <!-- Content -->
      <div style="flex:1;display:flex;align-items:flex-start;justify-content:center;padding:40px 24px 80px">
        <div style="width:100%;max-width:680px" id="quote-content">
          <div style="text-align:center;padding:60px 24px">
            <div class="spinner" style="margin:0 auto 16px"></div>
            <div style="color:var(--text-muted)">Loading your quote…</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Extract token from URL
  const token = new URLSearchParams(location.search).get('token');
  if (!token) {
    showError('No quote token found in the URL. Please use the link from your email.');
    return;
  }

  // Decode token payload (client-side, no verification — server verifies on API call)
  const payload = decodeTokenPayload(token);
  if (!payload?.quote_id) {
    showError('This link appears to be invalid or expired. Please contact your service provider.');
    return;
  }

  try {
    const res   = await api.getQuoteForCustomer(payload.quote_id, token);
    const quote = res.data;
    renderQuote(quote, token);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      showError('This link has expired or is no longer valid. Please contact your service provider for a new quote.');
    } else {
      showError('Failed to load your quote: ' + (err.message ?? 'Unknown error'));
    }
  }
}

// ── Token decoding ────────────────────────────────────────────────────────────

function decodeTokenPayload(token) {
  try {
    const b64 = token.split('.')[1];
    if (!b64) return null;
    // base64url → base64
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '===='.slice(b64.length % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// ── Quote display ─────────────────────────────────────────────────────────────

function renderQuote(quote, token) {
  const el = document.getElementById('quote-content');
  if (!el) return;

  const lineItems = quote.line_items ?? [];
  const subtotal  = lineItems.reduce((s, i) => s + (i.qty ?? 1) * (i.unitPrice ?? 0), 0);
  const tax       = subtotal * TAX_RATE;
  const total     = subtotal + tax;

  const isExpired  = quote.valid_until && new Date(quote.valid_until) < new Date();
  const isTerminal = ['accepted', 'rejected', 'expired', 'cancelled'].includes(quote.state);

  el.innerHTML = `

    <!-- Page title -->
    <div style="margin-bottom:28px">
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase;font-weight:700">
        Repair Quote
      </div>
      <h1 style="font-size:1.6rem;font-weight:900;letter-spacing:-.4px;margin:0 0 6px">
        ${quote.address ?? 'Your Property'}
      </h1>
      ${quote.contact ? `<div style="font-size:.9rem;color:var(--text-muted)">Prepared for: ${quote.contact}</div>` : ''}
      ${quote.valid_until ? `
        <div style="font-size:.82rem;color:${isExpired ? 'var(--danger)' : 'var(--text-muted)'};margin-top:4px">
          ${isExpired ? '⚠ This quote expired on' : 'Valid until'} ${new Date(quote.valid_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      ` : ''}
    </div>

    <!-- Status banner for terminal states -->
    ${isTerminal ? terminalBanner(quote.state) : ''}

    <!-- Line items -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:.88rem">
        Services & Parts
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--bg-raised)">
            <th style="padding:10px 20px;text-align:left;font-size:.75rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">Description</th>
            <th style="padding:10px 20px;text-align:right;font-size:.75rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);width:60px">Qty</th>
            <th style="padding:10px 20px;text-align:right;font-size:.75rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);width:100px">Unit</th>
            <th style="padding:10px 20px;text-align:right;font-size:.75rem;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);width:100px">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItems.map((item, i) => `
            <tr style="${i < lineItems.length - 1 ? 'border-bottom:1px solid var(--border)' : ''}">
              <td style="padding:14px 20px">
                <div style="font-size:.88rem;font-weight:${item.category === 'labor' ? '500' : '400'}">${item.description}</div>
                <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px">${item.category ?? ''}</div>
              </td>
              <td style="padding:14px 20px;text-align:right;font-size:.85rem;color:var(--text-subtle)">${item.qty ?? 1}</td>
              <td style="padding:14px 20px;text-align:right;font-size:.85rem;color:var(--text-subtle)">
                $${(item.unitPrice ?? 0).toLocaleString('en-US', {minimumFractionDigits:2})}
              </td>
              <td style="padding:14px 20px;text-align:right;font-size:.88rem;font-weight:600">
                $${((item.qty ?? 1) * (item.unitPrice ?? 0)).toLocaleString('en-US', {minimumFractionDigits:2})}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="border-top:2px solid var(--border);padding:16px 20px;background:var(--bg-raised)">
        <div style="display:flex;flex-direction:column;gap:8px;max-width:280px;margin-left:auto">
          ${summaryRow('Subtotal', subtotal)}
          ${summaryRow(`Tax (${(TAX_RATE * 100).toFixed(0)}%)`, tax)}
          <div style="height:1px;background:var(--border);margin:4px 0"></div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:700;font-size:1rem">Total</span>
            <span style="font-weight:900;font-size:1.4rem;color:var(--brand)">$${total.toLocaleString('en-US', {minimumFractionDigits:2})}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Notes -->
    ${quote.notes ? `
      <div class="card" style="padding:16px 20px;margin-bottom:20px">
        <div style="font-size:.75rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Notes & Terms</div>
        <p style="font-size:.875rem;color:var(--text-subtle);line-height:1.7;margin:0">${quote.notes}</p>
      </div>
    ` : ''}

    <!-- Action buttons — only shown for quotes in 'sent' state -->
    ${!isTerminal && !isExpired && quote.state === 'sent' ? `
      <div class="card" style="padding:24px 20px;background:rgba(249,115,22,.04);border-color:rgba(249,115,22,.2)">
        <h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">Ready to proceed?</h3>
        <p style="font-size:.875rem;color:var(--text-muted);line-height:1.6;margin:0 0 20px">
          By accepting this quote you authorize Fire Flow to perform the listed repairs and agree to the total above.
          A technician will contact you to schedule the work.
        </p>
        <div class="flex-row" style="gap:12px;flex-wrap:wrap">
          <button id="accept-btn" class="btn btn-primary" style="flex:1;justify-content:center;min-width:160px;padding:14px"
            onclick="window._acceptQuote()">
            ✓ Accept Quote
          </button>
          <button id="decline-btn" class="btn btn-ghost" style="justify-content:center;padding:14px"
            onclick="window._showDeclineForm()">
            Decline
          </button>
        </div>
        <div id="decline-form" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
          <label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:8px">Reason for declining (optional)</label>
          <textarea id="decline-reason" class="form-textarea" style="min-height:80px;margin-bottom:12px"
            placeholder="e.g. Going with another provider, price too high, already resolved…"></textarea>
          <div class="flex-row" style="gap:8px">
            <button class="btn btn-danger" onclick="window._submitDecline()">Confirm Decline</button>
            <button class="btn btn-ghost btn-sm" onclick="window._hideDeclineForm()">Cancel</button>
          </div>
        </div>
      </div>
    ` : ''}

    <!-- Contact footer -->
    <div style="margin-top:32px;text-align:center;font-size:.78rem;color:var(--text-muted)">
      Questions about this quote?
      <a href="mailto:support@fireflow.app" style="color:var(--brand)">Contact us</a>
    </div>
  `;

  // Bind action handlers
  const quoteId = quote.id;
  // BUG FIX: guard against double-click creating duplicate accept requests
  let _acceptInProgress = false;
  window._acceptQuote = () => {
    if (_acceptInProgress) return;
    _acceptInProgress = true;
    handleAccept(quoteId, token).finally(() => { _acceptInProgress = false; });
  };
  window._showDeclineForm  = () => { document.getElementById('decline-form').style.display = 'block'; };
  window._hideDeclineForm  = () => { document.getElementById('decline-form').style.display = 'none'; };
  window._submitDecline    = () => handleDecline(quoteId, token);
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function handleAccept(quoteId, token) {
  const btn = document.getElementById('accept-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

  try {
    await api.acceptQuoteAsCustomer(quoteId, token);
    showSuccessState();
  } catch (err) {
    // BUG FIX: if already accepted (409), show success state rather than an error
    if (err.status === 409) {
      showSuccessState();
      return;
    }
    if (btn) { btn.disabled = false; btn.textContent = '✓ Accept Quote'; }
    showError('Could not accept the quote: ' + (err.message ?? 'Unknown error'));
  }
}

async function handleDecline(quoteId, token) {
  const reason  = document.getElementById('decline-reason')?.value?.trim() ?? '';
  const decBtn  = document.querySelector('#decline-form .btn-danger');
  if (decBtn) { decBtn.disabled = true; decBtn.textContent = 'Submitting…'; }

  try {
    await api.rejectQuoteAsCustomer(quoteId, token, reason);
    showDeclinedState();
  } catch (err) {
    if (decBtn) { decBtn.disabled = false; decBtn.textContent = 'Confirm Decline'; }
    showError('Could not submit decline: ' + (err.message ?? 'Unknown error'));
  }
}

// ── Result states ─────────────────────────────────────────────────────────────

function showSuccessState() {
  const el = document.getElementById('quote-content');
  if (!el) return;
  el.innerHTML = `
    <div style="text-align:center;padding:60px 24px">
      <div style="width:64px;height:64px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;color:var(--success)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <h2 style="font-size:1.5rem;font-weight:800;margin:0 0 12px;letter-spacing:-.3px">Quote Accepted!</h2>
      <p style="font-size:.95rem;color:var(--text-muted);line-height:1.7;max-width:420px;margin:0 auto 24px">
        Thank you! A technician will contact you shortly to schedule your repair appointment.
        You'll receive a confirmation once the job is booked.
      </p>
      <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:var(--r-xl);padding:20px 28px;display:inline-block">
        <div style="font-size:.82rem;color:var(--success);font-weight:700">What happens next</div>
        <ol style="text-align:left;font-size:.875rem;color:var(--text-subtle);line-height:1.8;margin:10px 0 0;padding-left:20px">
          <li>We schedule a technician visit</li>
          <li>Repairs are completed on site</li>
          <li>You receive a final inspection report</li>
        </ol>
      </div>
    </div>
  `;
}

function showDeclinedState() {
  const el = document.getElementById('quote-content');
  if (!el) return;
  el.innerHTML = `
    <div style="text-align:center;padding:60px 24px">
      <div style="font-size:3rem;margin-bottom:20px">👍</div>
      <h2 style="font-size:1.4rem;font-weight:800;margin:0 0 12px">Got it — quote declined</h2>
      <p style="font-size:.9rem;color:var(--text-muted);line-height:1.7;max-width:380px;margin:0 auto">
        We've recorded your decision. If you change your mind or have questions, contact us at
        <a href="mailto:support@fireflow.app" style="color:var(--brand)">support@fireflow.app</a>.
      </p>
    </div>
  `;
}

function showError(message) {
  const el = document.getElementById('quote-content');
  if (!el) return;
  el.innerHTML = `
    <div style="text-align:center;padding:60px 24px">
      <div style="width:56px;height:56px;background:var(--danger-dim);border:1px solid rgba(239,68,68,.25);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--danger)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <h2 style="font-size:1.2rem;font-weight:700;margin:0 0 12px;color:var(--danger)">${message}</h2>
      <p style="font-size:.85rem;color:var(--text-muted)">
        If you believe this is an error, please contact your service provider.
      </p>
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function terminalBanner(state) {
  const configs = {
    accepted: { bg: 'rgba(34,197,94,.08)',  border: 'rgba(34,197,94,.2)',  color: 'var(--success)', icon: '✅', text: 'This quote has been accepted. A technician will be in touch to schedule your repair.' },
    rejected: { bg: 'rgba(239,68,68,.08)',  border: 'rgba(239,68,68,.2)',  color: 'var(--danger)',  icon: '✕',  text: 'This quote was declined.' },
    expired:  { bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.2)', color: 'var(--warning)', icon: '⏰', text: 'This quote has expired. Please contact your service provider for a new one.' },
    cancelled:{ bg: 'rgba(100,116,139,.08)',border: 'rgba(100,116,139,.2)',color: 'var(--text-muted)','icon': '✕', text: 'This quote has been cancelled.' },
  };
  const c = configs[state] ?? configs.expired;
  return `
    <div style="background:${c.bg};border:1px solid ${c.border};border-radius:var(--r-md);padding:14px 18px;margin-bottom:20px;display:flex;gap:12px;align-items:flex-start">
      <span style="font-size:1.1rem;flex-shrink:0">${c.icon}</span>
      <p style="margin:0;font-size:.875rem;color:${c.color};line-height:1.6">${c.text}</p>
    </div>
  `;
}

function summaryRow(label, amount) {
  return `
    <div style="display:flex;justify-content:space-between;font-size:.875rem">
      <span style="color:var(--text-muted)">${label}</span>
      <span>$${amount.toLocaleString('en-US', {minimumFractionDigits:2})}</span>
    </div>
  `;
}
