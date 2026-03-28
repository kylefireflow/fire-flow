/**
 * report.js — HTML inspection report generator
 *
 * Returns a fully self-contained HTML string (no external dependencies)
 * that can be opened in a browser tab and printed to PDF via Ctrl+P / Cmd+P.
 *
 * Usage:
 *   import { generateInspectionReport } from './report.js';
 *   const html = generateInspectionReport(inspectionEntity);
 *   res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
 *   res.end(html);
 */

// ─── Entry point ──────────────────────────────────────────────────────────────

export function generateInspectionReport(insp) {
  const checkpoints  = Array.isArray(insp.checkpoints)  ? insp.checkpoints  : [];
  const deficiencies = Array.isArray(insp.deficiencies) ? insp.deficiencies : [];

  const passCount   = checkpoints.filter(c => c.result === 'pass').length;
  const failCount   = checkpoints.filter(c => c.result === 'fail').length;
  const totalCost   = deficiencies.reduce((s, d) => s + (+(d.estimatedCost ?? 0)), 0);
  const reportDate  = fmtDate(insp.created_at ?? new Date().toISOString());
  const reportId    = (insp.id ?? '').slice(0, 8).toUpperCase();
  const overallPass = deficiencies.length === 0 && failCount === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inspection Report — ${esc(insp.address ?? 'Unknown Address')}</title>
<style>
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Base ── */
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    color: #1a1a1a;
    background: #fff;
    line-height: 1.45;
  }

  /* ── Page layout ── */
  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 32px 40px 48px;
  }

  /* ── Header ── */
  .report-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 3px solid #ea580c;
    padding-bottom: 16px;
    margin-bottom: 24px;
    gap: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-flame {
    font-size: 28pt;
    line-height: 1;
  }
  .brand-name {
    font-size: 17pt;
    font-weight: 900;
    color: #ea580c;
    letter-spacing: -0.5px;
  }
  .brand-sub {
    font-size: 8pt;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 1px;
  }
  .report-meta {
    text-align: right;
    font-size: 9pt;
    color: #6b7280;
    line-height: 1.7;
  }
  .report-meta strong {
    color: #1a1a1a;
    font-size: 12pt;
    display: block;
    margin-bottom: 4px;
  }

  /* ── Section titles ── */
  .section {
    margin-bottom: 24px;
  }
  .section-title {
    font-size: 9pt;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 5px;
    margin-bottom: 12px;
  }

  /* ── Info grid ── */
  .info-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px 24px;
  }
  .info-cell label {
    font-size: 8pt;
    font-weight: 700;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    display: block;
    margin-bottom: 2px;
  }
  .info-cell span {
    font-size: 10.5pt;
    color: #111827;
  }

  /* ── Summary badges ── */
  .summary-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .summary-badge {
    flex: 1;
    min-width: 110px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 16px;
    text-align: center;
  }
  .summary-badge .val {
    font-size: 20pt;
    font-weight: 900;
    line-height: 1.1;
  }
  .summary-badge .lbl {
    font-size: 8pt;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 2px;
  }
  .val-pass    { color: #16a34a; }
  .val-fail    { color: #dc2626; }
  .val-def     { color: #d97706; }
  .val-cost    { color: #ea580c; }
  .val-neutral { color: #374151; }

  /* ── Overall result banner ── */
  .result-banner {
    border-radius: 8px;
    padding: 12px 18px;
    margin-bottom: 20px;
    font-size: 11pt;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .result-pass {
    background: #f0fdf4;
    border: 1.5px solid #86efac;
    color: #15803d;
  }
  .result-fail {
    background: #fff7ed;
    border: 1.5px solid #fed7aa;
    color: #c2410c;
  }

  /* ── Checkpoint table ── */
  .cp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  .cp-table th {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    padding: 7px 10px;
    text-align: left;
    font-size: 8pt;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .cp-table td {
    border: 1px solid #e5e7eb;
    padding: 7px 10px;
    vertical-align: top;
  }
  .cp-table tr:nth-child(even) td {
    background: #fafafa;
  }
  .cp-table tr.row-fail td {
    background: #fff5f5;
  }
  .result-pill {
    display: inline-block;
    border-radius: 99px;
    padding: 2px 9px;
    font-size: 8pt;
    font-weight: 700;
    white-space: nowrap;
  }
  .pill-pass { background: #dcfce7; color: #15803d; }
  .pill-fail { background: #fee2e2; color: #b91c1c; }
  .pill-na   { background: #f3f4f6; color: #6b7280; }

  /* ── Deficiency cards ── */
  .def-card {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 12px;
    page-break-inside: avoid;
  }
  .def-card.sev-critical { border-left: 4px solid #dc2626; }
  .def-card.sev-major    { border-left: 4px solid #d97706; }
  .def-card.sev-minor    { border-left: 4px solid #9ca3af; }
  .def-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .def-type {
    font-size: 10.5pt;
    font-weight: 700;
    color: #111827;
  }
  .def-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 3px;
  }
  .sev-badge {
    font-size: 7.5pt;
    font-weight: 700;
    border-radius: 4px;
    padding: 2px 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .sev-critical { background: #fee2e2; color: #b91c1c; }
  .sev-major    { background: #fef3c7; color: #92400e; }
  .sev-minor    { background: #f3f4f6; color: #374151; }
  .code-badge {
    font-size: 7.5pt;
    font-family: monospace;
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    color: #6b7280;
  }
  .def-cost {
    font-size: 12pt;
    font-weight: 900;
    color: #ea580c;
    white-space: nowrap;
  }
  .def-desc {
    font-size: 9.5pt;
    color: #374151;
    line-height: 1.5;
    margin-bottom: 6px;
  }
  .def-fix {
    font-size: 9pt;
    color: #6b7280;
    background: #f9fafb;
    border-radius: 5px;
    padding: 7px 10px;
    line-height: 1.5;
  }
  .def-fix strong { color: #374151; }

  /* ── Photo placeholder ── */
  .photo-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .photo-box {
    width: 120px;
    height: 90px;
    border: 1.5px dashed #d1d5db;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 8pt;
    color: #9ca3af;
    text-align: center;
    line-height: 1.4;
  }

  /* ── Notes ── */
  .notes-box {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 9.5pt;
    color: #374151;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  /* ── Signature block ── */
  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    margin-top: 8px;
  }
  .sig-box {
    border-top: 1.5px solid #374151;
    padding-top: 6px;
    font-size: 8.5pt;
    color: #6b7280;
    line-height: 1.7;
  }
  .sig-box strong {
    color: #111827;
    font-size: 9pt;
  }

  /* ── Footer ── */
  .report-footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
    font-size: 8pt;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* ── Print overrides ── */
  @media print {
    body { font-size: 10pt; }
    .page { padding: 0; max-width: 100%; }
    .no-print { display: none !important; }
    .def-card { page-break-inside: avoid; }
    .section  { page-break-inside: avoid; }
    .sig-section { page-break-before: auto; }

    @page {
      margin: 18mm 16mm 18mm 16mm;
      size: letter portrait;
    }

    /* Page numbers */
    @page { @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #9ca3af; } }
  }

  /* ── Print button (screen only) ── */
  .print-bar {
    background: #1f2937;
    color: #fff;
    padding: 12px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .print-bar span { font-size: 9pt; color: #9ca3af; }
  .print-btn {
    background: #ea580c;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 8px 20px;
    font-size: 10pt;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .print-btn:hover { background: #c2410c; }
  @media print { .print-bar { display: none; } }
</style>
</head>
<body>

<!-- Print bar (screen only) -->
<div class="print-bar no-print">
  <span>🔥 Fire Flow — Inspection Report · ${esc(insp.address ?? '')}</span>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
</div>

<div class="page">

  <!-- ── Header ── -->
  <div class="report-header">
    <div class="brand">
      <div class="brand-flame">🔥</div>
      <div>
        <div class="brand-name">Fire Flow</div>
        <div class="brand-sub">Inspection Management Platform</div>
      </div>
    </div>
    <div class="report-meta">
      <strong>INSPECTION REPORT</strong>
      Report #: ${esc(reportId)}<br>
      Date: ${esc(reportDate)}<br>
      ${insp.technician_id ? `Inspector: ${esc(insp.technician_id.slice(0,8))}` : ''}
    </div>
  </div>

  <!-- ── Property & System Info ── -->
  <div class="section">
    <div class="section-title">Property Information</div>
    <div class="info-grid">
      <div class="info-cell">
        <label>Address</label>
        <span>${esc(insp.address ?? '—')}</span>
      </div>
      <div class="info-cell">
        <label>City</label>
        <span>${esc(insp.city ?? '—')}</span>
      </div>
      <div class="info-cell">
        <label>Inspection Type</label>
        <span>${esc(toTitleCase(insp.inspection_type ?? 'Routine'))}</span>
      </div>
      <div class="info-cell">
        <label>Site Contact</label>
        <span>${esc(insp.contact ?? '—')}</span>
      </div>
      <div class="info-cell">
        <label>Contact Phone</label>
        <span>${esc(insp.phone ?? '—')}</span>
      </div>
      <div class="info-cell">
        <label>Inspection Date</label>
        <span>${esc(reportDate)}</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">System Information</div>
    <div class="info-grid">
      <div class="info-cell">
        <label>System Type</label>
        <span>${esc(insp.system_type ?? insp.inspection_type ?? '—')}</span>
      </div>
      <div class="info-cell">
        <label>Number of Floors</label>
        <span>${insp.num_floors ?? '—'}</span>
      </div>
      <div class="info-cell">
        <label>Sprinkler Heads</label>
        <span>${insp.num_heads ?? '—'}</span>
      </div>
    </div>
  </div>

  <!-- ── Overall result ── -->
  <div class="result-banner ${overallPass ? 'result-pass' : 'result-fail'}">
    ${overallPass
      ? '✅ PASSED — No deficiencies or failed checkpoints found.'
      : `⚠ DEFICIENCIES FOUND — ${deficiencies.length} issue${deficiencies.length !== 1 ? 's' : ''} require${deficiencies.length === 1 ? 's' : ''} attention.`}
  </div>

  <!-- ── Summary stats ── -->
  <div class="summary-row">
    <div class="summary-badge">
      <div class="val val-neutral">${checkpoints.length || '—'}</div>
      <div class="lbl">Checkpoints</div>
    </div>
    <div class="summary-badge">
      <div class="val val-pass">${passCount}</div>
      <div class="lbl">Passed</div>
    </div>
    <div class="summary-badge">
      <div class="val val-fail">${failCount}</div>
      <div class="lbl">Failed</div>
    </div>
    <div class="summary-badge">
      <div class="val val-def">${deficiencies.length}</div>
      <div class="lbl">Deficiencies</div>
    </div>
    <div class="summary-badge">
      <div class="val val-cost">${totalCost > 0 ? '$' + totalCost.toLocaleString() : '—'}</div>
      <div class="lbl">Est. Repair Cost</div>
    </div>
  </div>

  <!-- ── Checkpoints ── -->
  ${checkpoints.length > 0 ? `
  <div class="section">
    <div class="section-title">Inspection Checkpoints (${checkpoints.length})</div>
    <table class="cp-table">
      <thead>
        <tr>
          <th style="width:90px">Code</th>
          <th>Description</th>
          <th style="width:80px;text-align:center">Result</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${checkpoints.map(cp => {
          const result = cp.result ?? 'n/a';
          const rowCls = result === 'fail' ? 'row-fail' : '';
          const pillCls = result === 'pass' ? 'pill-pass' : result === 'fail' ? 'pill-fail' : 'pill-na';
          const pillText = result === 'pass' ? '✓ Pass' : result === 'fail' ? '✕ Fail' : 'N/A';
          return `
          <tr class="${rowCls}">
            <td style="font-family:monospace;font-size:8.5pt;color:#6b7280">${esc(cp.code ?? '—')}</td>
            <td>${esc(cp.label ?? cp.description ?? cp.code ?? 'Checkpoint')}</td>
            <td style="text-align:center"><span class="result-pill ${pillCls}">${pillText}</span></td>
            <td style="color:#6b7280;font-size:9pt">${esc(cp.notes ?? cp.comment ?? '')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  ` : `
  <div class="section">
    <div class="section-title">Inspection Checkpoints</div>
    <p style="font-size:9pt;color:#9ca3af;font-style:italic">No checkpoint data recorded for this inspection.</p>
  </div>
  `}

  <!-- ── Deficiencies ── -->
  ${deficiencies.length > 0 ? `
  <div class="section">
    <div class="section-title">Deficiencies Found (${deficiencies.length})</div>
    ${deficiencies.map((d, i) => {
      const sev  = (d.severity ?? 'minor').toLowerCase();
      const code = d.checkpointCode ?? d.code ?? null;
      const cost = d.estimatedCost ? +d.estimatedCost : null;
      return `
      <div class="def-card sev-${sev}">
        <div class="def-header">
          <div>
            <div class="def-type">${i + 1}. ${esc(d.type ?? d._category ?? 'Deficiency')}</div>
            <div class="def-badges">
              <span class="sev-badge sev-${sev}">${sev}</span>
              ${code ? `<span class="code-badge">${esc(code)}</span>` : ''}
            </div>
          </div>
          ${cost ? `<div class="def-cost">$${cost.toLocaleString()}</div>` : ''}
        </div>
        <div class="def-desc">${esc(d.description ?? '(No description provided)')}</div>
        ${d.suggestedFix ? `
        <div class="def-fix"><strong>Suggested fix:</strong> ${esc(d.suggestedFix)}</div>
        ` : ''}
        <div class="photo-row">
          <div class="photo-box">📷<br>Photo 1</div>
          <div class="photo-box">📷<br>Photo 2</div>
        </div>
      </div>`;
    }).join('')}
  </div>
  ` : ''}

  <!-- ── Tech notes ── -->
  ${insp.notes ? `
  <div class="section">
    <div class="section-title">Technician Notes</div>
    <div class="notes-box">${esc(insp.notes)}</div>
  </div>
  ` : ''}

  <!-- ── Signature block ── -->
  <div class="section sig-section" style="margin-top: 40px">
    <div class="section-title">Certification &amp; Signatures</div>
    <p style="font-size:8.5pt;color:#6b7280;margin-bottom:20px;line-height:1.5">
      I hereby certify that the above fire suppression system inspection was conducted
      in accordance with applicable NFPA standards and local codes. The findings are
      accurate to the best of my knowledge.
    </p>
    <div class="sig-grid">
      <div class="sig-box">
        <br><br>
        <strong>Inspector Signature</strong><br>
        Name: ___________________________<br>
        License #: ______________________<br>
        Date: ${esc(reportDate)}
      </div>
      <div class="sig-box">
        <br><br>
        <strong>Customer / Owner Signature</strong><br>
        Name: ___________________________<br>
        Title: ___________________________<br>
        Date: ___________________________
      </div>
    </div>
  </div>

  <!-- ── Footer ── -->
  <div class="report-footer">
    <span>🔥 Fire Flow · fireflow.app</span>
    <span>Report #${esc(reportId)} · Generated ${esc(new Date().toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }))}</span>
    <span>CONFIDENTIAL — For authorized use only</span>
  </div>

</div><!-- /page -->
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function fmtDate(iso) {
  if (!iso) return 'Unknown';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch (_) { return iso; }
}

function toTitleCase(str) {
  return String(str ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
