/**
 * pricing.js — Public pricing page
 * Accessible without login — linked from the login screen
 */

export function renderPricing(container) {
  container.innerHTML = `
    <div style="min-height:100vh;background:var(--bg-base);padding:0 0 80px">

      <!-- Hero -->
      <div style="text-align:center;padding:64px 24px 48px">
        <div style="width:48px;height:48px;background:var(--brand);border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:0 0 28px rgba(249,115,22,.4)"><svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-1 .23-1.94.75-2.72 1.32-2.23 1.74-3.28 4.7-2.72 7.45.06.27.06.55 0 .82-.07.27-.2.53-.4.74-.55.52-.78 1.28-.65 1.99.13.7.62 1.3 1.28 1.56.76.3 1.58.14 2.22-.38.42-.35.7-.86.74-1.4.04-.48-.13-.95-.38-1.35-.54-.79-.66-1.49-.46-2.19.06.46.28.9.6 1.24.63.67 1.35 1.28 1.9 2.01.7.96 1.04 2.12.98 3.28-.04.72-.25 1.44-.61 2.05 1.32.97 2.73 1.2 3.97.7 2.48-1.01 3.94-3.72 3.15-6.32-.28-.93-.78-1.75-1.54-2.44-.48-.43-1.04-.8-1.3-1.54z"/></svg></div>
        <h1 style="font-size:2.2rem;font-weight:900;letter-spacing:-.5px;margin:0 0 14px">
          Simple, transparent pricing
        </h1>
        <p style="font-size:1.05rem;color:var(--text-muted);max-width:480px;margin:0 auto;line-height:1.6">
          Cut inspection time in half. No per-report fees. No surprise charges.
          Two plans — pick the one that fits your team.
        </p>
      </div>

      <!-- Cards -->
      <div style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(300px,1fr));
        gap:24px;
        max-width:860px;
        margin:0 auto;
        padding:0 24px;
      ">

        <!-- ── Starter ── -->
        <div style="
          background:var(--bg-surface);
          border:1px solid var(--border);
          border-radius:var(--r-xl);
          padding:36px 32px;
          display:flex;
          flex-direction:column;
          gap:0;
        ">
          <div style="margin-bottom:6px">
            <span class="badge badge-blue" style="font-size:.75rem">Starter</span>
          </div>
          <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px">Small Team</div>
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:28px">
            Perfect for 1–3 technicians
          </div>

          <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:8px">
            <span style="font-size:3rem;font-weight:900;line-height:1;letter-spacing:-2px">$200</span>
            <span style="font-size:.95rem;color:var(--text-muted);padding-bottom:8px">/month</span>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:32px">
            Billed monthly · No contracts
          </div>

          <div style="font-size:.8rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px">
            What's included
          </div>

          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:36px">
            ${starterFeatures().map(f => featureRow(f)).join('')}
          </div>

          <div style="margin-top:auto">
            <div style="
              background:rgba(249,115,22,.08);
              border:1px solid rgba(249,115,22,.2);
              border-radius:var(--r-md);
              padding:14px 16px;
              font-size:.82rem;
              color:var(--text-subtle);
              line-height:1.5;
              margin-bottom:20px;
            ">
              "Perfect for small teams — start using Fire Flow today and cut inspection time in half."
            </div>
            <button class="btn btn-ghost" style="width:100%;justify-content:center;padding:14px"
              onclick="window._navigate('/signup?plan=starter')">
              Get started →
            </button>
          </div>
        </div>

        <!-- ── Company ── -->
        <div style="
          background:var(--bg-surface);
          border:2px solid var(--brand);
          border-radius:var(--r-xl);
          padding:36px 32px;
          display:flex;
          flex-direction:column;
          gap:0;
          position:relative;
          overflow:hidden;
        ">
          <!-- Most popular ribbon -->
          <div style="
            position:absolute;
            top:20px;right:-28px;
            background:var(--brand);
            color:#fff;
            font-size:.7rem;
            font-weight:800;
            letter-spacing:.5px;
            text-transform:uppercase;
            padding:5px 36px;
            transform:rotate(45deg);
            transform-origin:center;
          ">Most popular</div>

          <div style="margin-bottom:6px">
            <span class="badge badge-orange" style="font-size:.75rem">Company</span>
          </div>
          <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px">Full Plan</div>
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:28px">
            For 4+ technicians, the whole company
          </div>

          <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:8px">
            <span style="font-size:3rem;font-weight:900;line-height:1;letter-spacing:-2px;color:var(--brand)">$550</span>
            <span style="font-size:.95rem;color:var(--text-muted);padding-bottom:8px">/month</span>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:32px">
            Billed monthly · No contracts
          </div>

          <div style="font-size:.8rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px">
            Everything in Starter, plus
          </div>

          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:36px">
            ${companyFeatures().map(f => featureRow(f, true)).join('')}
          </div>

          <div style="margin-top:auto">
            <div style="
              background:rgba(249,115,22,.08);
              border:1px solid rgba(249,115,22,.2);
              border-radius:var(--r-md);
              padding:14px 16px;
              font-size:.82rem;
              color:var(--text-subtle);
              line-height:1.5;
              margin-bottom:20px;
            ">
              "All-in-one premium plan for busy companies — streamline inspections, approvals, and reporting across your whole organization."
            </div>
            <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:1rem"
              onclick="window._navigate('/signup?plan=company')">
              Start with Company →
            </button>
          </div>
        </div>

      </div>

      <!-- Feature comparison table -->
      <div style="max-width:860px;margin:56px auto 0;padding:0 24px">
        <h2 style="font-size:1.3rem;font-weight:800;text-align:center;margin-bottom:28px">
          Full feature comparison
        </h2>
        <div style="
          background:var(--bg-surface);
          border:1px solid var(--border);
          border-radius:var(--r-xl);
          overflow:hidden;
        ">
          ${comparisonTable()}
        </div>
      </div>

      <!-- FAQ / CTA -->
      <div style="max-width:560px;margin:56px auto 0;padding:0 24px;text-align:center">
        <h2 style="font-size:1.2rem;font-weight:800;margin-bottom:12px">Questions?</h2>
        <p style="font-size:.9rem;color:var(--text-muted);line-height:1.6;margin-bottom:24px">
          Ready to get started? Sign in and your account will be active immediately.
          Need a custom quote for a large fleet? We can work something out.
        </p>
        <div class="flex-row" style="justify-content:center;gap:12px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="window._navigate('/signup')">
            Get started →
          </button>
          <a href="mailto:sales@fireflow.app" class="btn btn-ghost">
            Talk to sales
          </a>
        </div>
        <p style="margin-top:32px;font-size:.75rem;color:var(--text-muted)">
          <button class="btn btn-ghost btn-sm" onclick="window._navigate('/login')"
            style="font-size:.78rem;color:var(--text-muted)">
            ← Back to sign in
          </button>
        </p>
      </div>

    </div>
  `;
}

// ── Feature lists ─────────────────────────────────────────────────────────────

function starterFeatures() {
  return [
    { text: 'Up to 3 technician accounts' },
    { text: 'Guided 5-step inspection wizard' },
    { text: 'Deficiency capture with photo attachments' },
    { text: 'Offline mode — works without signal' },
    { text: 'Admin dashboard for scheduling & review' },
    { text: 'PDF inspection reports' },
    { text: 'Basic email support' },
  ];
}

function companyFeatures() {
  return [
    { text: 'Unlimited technician accounts', highlight: true },
    { text: 'Everything in Starter' },
    { text: 'Quote generation & customer approval workflow', highlight: true },
    { text: 'Advanced kanban job pipeline' },
    { text: 'Multi-tech schedule board' },
    { text: 'Priority support + onboarding call', highlight: true },
    { text: 'Optional custom integrations' },
  ];
}

function featureRow(f, brand = false) {
  return `
    <div style="display:flex;align-items:flex-start;gap:10px">
      <span style="
        width:20px;height:20px;border-radius:50%;
        background:${brand && f.highlight ? 'rgba(249,115,22,.2)' : 'rgba(34,197,94,.15)'};
        color:${brand && f.highlight ? 'var(--brand)' : 'var(--success)'};
        display:flex;align-items:center;justify-content:center;
        font-size:.75rem;flex-shrink:0;margin-top:1px;font-weight:800;
      ">✓</span>
      <span style="font-size:.88rem;${f.highlight ? 'font-weight:600' : 'color:var(--text-subtle)'}">
        ${f.text}
      </span>
    </div>
  `;
}

// ── Comparison table ──────────────────────────────────────────────────────────

function comparisonTable() {
  const rows = [
    { label: 'Technician accounts',            starter: '1–3',    company: 'Unlimited' },
    { label: 'Guided inspection wizard',        starter: true,     company: true },
    { label: 'Deficiency capture',              starter: true,     company: true },
    { label: 'Photo attachments per deficiency',starter: true,     company: true },
    { label: 'Offline mode',                    starter: true,     company: true },
    { label: 'Admin scheduling board',          starter: true,     company: true },
    { label: 'PDF inspection reports',          starter: true,     company: true },
    { label: 'Quote builder',                   starter: false,    company: true },
    { label: 'Customer quote approval workflow',starter: false,    company: true },
    { label: 'Job pipeline (kanban)',           starter: false,    company: true },
    { label: 'Priority support + onboarding',  starter: false,    company: true },
    { label: 'Custom integrations',             starter: false,    company: 'Add-on' },
  ];

  const headerStyle = `
    padding:14px 20px;
    font-size:.8rem;
    font-weight:700;
    color:var(--text-muted);
    text-transform:uppercase;
    letter-spacing:.5px;
    background:var(--bg-raised);
    border-bottom:1px solid var(--border);
  `;

  const header = `
    <div style="display:grid;grid-template-columns:1fr 120px 140px">
      <div style="${headerStyle}">Feature</div>
      <div style="${headerStyle}text-align:center">Starter</div>
      <div style="${headerStyle}text-align:center;color:var(--brand)">Company</div>
    </div>
  `;

  const tableRows = rows.map((row, i) => {
    const isLast = i === rows.length - 1;
    const rowStyle = `
      display:grid;
      grid-template-columns:1fr 120px 140px;
      ${!isLast ? 'border-bottom:1px solid var(--border)' : ''}
    `;
    return `
      <div style="${rowStyle}">
        <div style="padding:13px 20px;font-size:.87rem;color:var(--text-subtle)">${row.label}</div>
        <div style="padding:13px 20px;text-align:center">${cellVal(row.starter, false)}</div>
        <div style="padding:13px 20px;text-align:center">${cellVal(row.company, true)}</div>
      </div>
    `;
  }).join('');

  return header + tableRows;
}

function cellVal(val, brand) {
  if (val === true)  return `<span style="color:${brand ? 'var(--brand)' : 'var(--success)'};font-weight:700;font-size:1rem">✓</span>`;
  if (val === false) return `<span style="color:var(--border);font-size:1rem">—</span>`;
  return `<span style="font-size:.82rem;font-weight:600;color:${brand ? 'var(--brand)' : 'var(--text-subtle)'}">${val}</span>`;
}
