/**
 * quote-pdf.js - Single source of truth for quote document rendering.
 * Used by BOTH the live preview (iframe) and the print/export flow.
 */

export const DEFAULT_BRANDING = {
  companyName:    '',
  logoDataUrl:    null,
  primaryColor:   '#f97316',
  contactPhone:   '',
  contactEmail:   '',
  contactWebsite: '',
  footerText:     'Thank you for your business. Prices are valid for 30 days.',
};

export function loadBranding() {
  try {
    const raw = localStorage.getItem('ff_branding');
    return raw ? { ...DEFAULT_BRANDING, ...JSON.parse(raw) } : { ...DEFAULT_BRANDING };
  } catch { return { ...DEFAULT_BRANDING }; }
}

export function saveBranding(updates) {
  try {
    const current = loadBranding();
    localStorage.setItem('ff_branding', JSON.stringify({ ...current, ...updates }));
  } catch {}
}

export function generateQuoteHTML(data, brand) {
  const b = { ...DEFAULT_BRANDING, ...brand };
  const {
    quoteNumber = '', validUntil = '', address = '', contact = '',
    email = '', notes = '', lineItems = [],
    subtotal = 0, tax = 0, total = 0, taxRate = 0,
  } = data;

  const primary = b.primaryColor || '#f97316';
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const logoHtml = b.logoDataUrl
    ? `<img src="${b.logoDataUrl}" alt="${esc(b.companyName)}" style="height:52px;max-width:200px;object-fit:contain;display:block">`
    : `<div style="font-size:24px;font-weight:800;color:${primary};letter-spacing:-.5px">${esc(b.companyName || 'Your Company')}</div>`;

  const contactParts = [
    b.contactPhone   ? esc(b.contactPhone)   : null,
    b.contactEmail   ? esc(b.contactEmail)   : null,
    b.contactWebsite ? esc(b.contactWebsite) : null,
  ].filter(Boolean);

  const itemRows = lineItems.length
    ? lineItems.map((item, idx) => `
      <tr style="background:${idx % 2 === 0 ? '#fff' : '#f8fafc'}">
        <td style="padding:10px 14px;font-size:13px;color:#1e293b">${esc(item.description)}</td>
        <td style="padding:10px 14px;font-size:12px;text-align:center">
          <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;
            background:${item.category==='emergency'?'rgba(239,68,68,.1)':item.category==='labor'?'rgba(56,189,248,.1)':'rgba(249,115,22,.1)'};
            color:${item.category==='emergency'?'#dc2626':item.category==='labor'?'#0ea5e9':'#ea580c'}">
            ${esc(item.category)}</span>
        </td>
        <td style="padding:10px 14px;font-size:13px;text-align:right;color:#475569">${item.qty}</td>
        <td style="padding:10px 14px;font-size:13px;text-align:right;color:#475569">$${Number(item.unitPrice).toFixed(2)}</td>
        <td style="padding:10px 14px;font-size:13px;text-align:right;font-weight:700;color:#1e293b">$${(item.qty*item.unitPrice).toFixed(2)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="padding:28px;text-align:center;color:#94a3b8;font-size:13px">No line items</td></tr>';

  const taxRow = taxRate > 0
    ? `<tr><td colspan="2" style="text-align:right;padding:5px 14px;font-size:13px;color:#64748b">Tax (${(taxRate*100).toFixed(0)}%)</td>
       <td style="text-align:right;padding:5px 14px;font-size:13px;color:#64748b">$${Number(tax).toFixed(2)}</td></tr>` : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Quote${quoteNumber ? ' #'+esc(quoteNumber) : ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#1e293b;background:#fff;padding:52px 60px}
@media print{body{padding:0}@page{margin:.65in;size:letter portrait}}
.doc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px}
.doc-title{font-size:32px;font-weight:900;color:${primary};letter-spacing:-1px;line-height:1}
.doc-meta{font-size:12.5px;color:#64748b;text-align:right;line-height:1.7}
.accent-bar{height:4px;border-radius:99px;background:linear-gradient(90deg,${primary} 0%,${primary}30 100%);margin-bottom:28px}
.billing-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px}
.billing-block h3{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#94a3b8;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #f1f5f9}
.billing-block p{font-size:13px;color:#334155;margin-bottom:2px}
table{width:100%;border-collapse:collapse}
thead tr{background:${primary}}
thead th{padding:10px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#fff;text-align:left}
tbody tr{border-bottom:1px solid #f1f5f9}
.totals-wrap{display:flex;justify-content:flex-end;margin-top:20px}
.totals-table{width:280px;border-collapse:collapse}
.totals-table td{padding:6px 14px;font-size:13px;color:#475569}
.totals-table td:last-child{text-align:right;font-weight:600;color:#1e293b}
.totals-table .grand-total td{font-size:16px;font-weight:800;color:${primary};border-top:2px solid ${primary};padding-top:12px}
.notes-box{margin-top:28px;padding:14px 18px;background:#f8fafc;border-left:3px solid ${primary};border-radius:0 6px 6px 0;font-size:12.5px;color:#475569}
.doc-footer{margin-top:44px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#94a3b8}
</style></head><body>
<div class="doc-header"><div>${logoHtml}</div>
<div class="doc-meta"><div class="doc-title">QUOTE</div>
${quoteNumber?`<div style="margin-top:6px"><strong>#${esc(quoteNumber)}</strong></div>`:''}
<div>Date: <strong>${date}</strong></div>
${validUntil?`<div>Valid until: <strong>${esc(validUntil)}</strong></div>`:''}
</div></div>
<div class="accent-bar"></div>
<div class="billing-grid">
<div class="billing-block"><h3>From</h3>
<p><strong>${esc(b.companyName||'Your Company')}</strong></p>
${b.contactPhone?`<p>${esc(b.contactPhone)}</p>`:''}
${b.contactEmail?`<p>${esc(b.contactEmail)}</p>`:''}
${b.contactWebsite?`<p>${esc(b.contactWebsite)}</p>`:''}
</div>
<div class="billing-block"><h3>Prepared For</h3>
${address?`<p><strong>${esc(address)}</strong></p>`:'<p style="color:#94a3b8">No address provided</p>'}
${contact?`<p>${esc(contact)}</p>`:''}
${email?`<p>${esc(email)}</p>`:''}
</div></div>
<table><thead><tr>
<th style="width:42%">Description</th>
<th style="width:14%;text-align:center">Category</th>
<th style="width:8%;text-align:right">Qty</th>
<th style="width:16%;text-align:right">Unit Price</th>
<th style="width:20%;text-align:right">Total</th>
</tr></thead><tbody>${itemRows}</tbody></table>
<div class="totals-wrap"><table class="totals-table"><tbody>
<tr><td>Subtotal</td><td>$${Number(subtotal).toFixed(2)}</td></tr>
${taxRow}
<tr class="grand-total"><td>Total</td><td>$${Number(total).toFixed(2)}</td></tr>
</tbody></table></div>
${notes?`<div class="notes-box"><strong>Notes &amp; Terms:</strong> ${esc(notes)}</div>`:''}
<div class="doc-footer">
<div>${esc(b.footerText||'')}</div>
<div style="display:flex;gap:18px">${contactParts.join(' &nbsp;&middot;&nbsp; ')}</div>
</div></body></html>`;
}

function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
