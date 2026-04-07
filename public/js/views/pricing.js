/**
 * pricing.js — Public pricing page
 * Accessible without login — linked from the login screen
 */

// ─── Plan data ────────────────────────────────────────────────────────────────

const PLANS = [
  {
    id:        'starter',
    name:      'Starter',
    price:     149,
    color:     'var(--success)',
    colorHex:  '#22c55e',
    badge:     'badge-blue',
    invoices:  50,
    overage:   2.00,
    tagline:   'For small teams getting started',
    popular:   false,
  },
  {
    id:        'growth',
    name:      'Growth',
    price:     249,
    color:     'var(--brand)',
    colorHex:  '#f97316',
    badge:     'badge-orange',
    invoices:  120,
    overage:   1.50,
    tagline:   'For growing fire protection companies',
    popular:   true,
  },
  {
    id:        'pro',
    name:      'Pro',
    price:     399,
    color:     '#a855f7',
    colorHex:  '#a855f7',
    badge:     'badge-purple',
    invoices:  300,
    overage:   1.00,
    tagline:   'For high-volume operations',
    popular:   false,
  },
];

const ALL_FEATURES = [
  'Unlimited technician accounts',
  'Guided 5-step inspection wizard',
  'Deficiency capture with photo attachments',
  'Offline mode — works without signal',
  'Admin scheduling & dispatch board',
  'PDF inspection reports',
  'Quote builder + customer approval workflow',
  'Kanban job pipeline',
  'Pricing & service framework',
  'Real-time team dashboard',
  'Email support',
];

// ─── Entry point ──────────────────────────────────────────────────────────────

export function renderPricing(container) {
  container.innerHTML = `
    <div style="min-height:100vh;background:var(--bg-base);padding:0 0 80px">

      <!-- Hero -->
      <div style="text-align:center;padding:64px 24px 48px">
        <div style="width:48px;height:48px;background:var(--brand);border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:0 0 28px rgba(249,115,22,.4)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-1 .23-1.94.75-2.72 1.32-2.23 1.74-3.28 4.7-2.72 7.45.06.27.06.55 0 .82-.07.27-.2.53-.4.74-.55.52-.78 1.28-.65 1.99.13.7.62 1.3 1.28 1.56.76.3 1.58.14 2.22-.38.42-.35.7-.86.74-1.4.04-.48-.13-.95-.38-1.35-.54-.79-.66-1.49-.46-2.19.06.46.28.9.6 1.24.63.67 1.35 1.28 1.9 2.01.7.96 1.04 2.12.98 3.28-.04.72-.25 1.44-.61 2.05 1.32.97 2.73 1.2 3.97.7 2.48-1.01 3.94-3.72 3.15-6.32-.28-.93-.78-1.75-1.54-2.44-.48-.43-1.04-.8-1.3-1.54z"/></svg>
        </div>
        <h1 style="font-size:2.2rem;font-weight:900;letter-spacing:-.5px;margin:0 0 14px">
          Simple, transparent pricing
        </h1>
        <p style="font-size:1.05rem;color:var(--text-muted);max-width:520px;margin:0 auto;line-height:1.6">
          Every plan includes all features. Pay based on how many quotes you send per month —
          with low per-quote overage rates if you go over.
        </p>
      </div>

      <!-- Plan cards -->
      <div style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
        gap:20px;
        max-width:1020px;
        margin:0 auto;
        padding:0 24px;
      ">
        ${PLANS.map(planCard).join('')}
      </div>

      <!-- Overage note -->
      <div style="max-width:1020px;margin:24px auto 0;padding:0 24px">
        <div style="
          background:var(--bg-surface);
          border:1px solid var(--border);
          border-radius:var(--r-lg);
          padding:16px 24px;
          font-size:.83rem;
          color:var(--text-muted);
          line-height:1.6;
          text-align:center;
        ">
          ⓘ <strong>How overages work:</strong> Your included quotes reset each billing period.
          If you go over, extra quotes are charged at your plan's per-quote rate and added to your next invoice automatically.
          Your account briefly pauses new quotes until that invoice clears.
        </div>
      </div>

      <!-- Feature comparison table -->
      <div style="max-width:1020px;margin:56px auto 0;padding:0 24px">
        <h2 style="font-size:1.3rem;font-weight:800;text-align:center;margin-bottom:28px">
          Full feature comparison
        </h2>
        <div style="
          background:var(--bg-surface);
          border:1px solid var(--border);
          border-radius:var(--r-xl);
          overflow:hidden;
          overflow-x:auto;
        ">
          ${comparisonTable()}
        </div>
      </div>

      <!-- FAQ / CTA -->
      <div style="max-width:560px;margin:56px auto 0;padding:0 24px;text-align:center">
        <h2 style="font-size:1.2rem;font-weight:800;margin-bottom:12px">Questions?</h2>
        <p style="font-size:.9rem;color:var(--text-muted);line-height:1.6;margin-bottom:24px">
          Ready to get started? Sign up and your account is active immediately.
          Need a custom quote for a large fleet? We can work something out.
        </p>
        <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
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

// ─── Plan card ────────────────────────────────────────────────────────────────

function planCard(p) {
  const borderStyle = p.popular
    ? `border:2px solid ${p.color}`
    : `border:1px solid var(--border)`;

  return `
    <div style="
      background:var(--bg-surface);
      ${borderStyle};
      border-radius:var(--r-xl);
      padding:32px 28px;
      display:flex;
      flex-direction:column;
      position:relative;
      overflow:hidden;
      ${p.popular ? `box-shadow:0 0 32px ${p.colorHex}22` : ''}
    ">
      ${p.popular ? popularRibbon(p.color) : ''}

      <!-- Badge + name -->
      <div style="margin-bottom:6px">
        <span class="badge" style="
          background:${p.colorHex}22;
          color:${p.color};
          border-color:${p.colorHex}44;
          font-size:.72rem;font-weight:700
        ">${p.name}</span>
      </div>
      <div style="font-size:.92rem;color:var(--text-muted);margin-bottom:24px">${p.tagline}</div>

      <!-- Price -->
      <div style="display:flex;align-items:flex-end;gap:4px;margin-bottom:4px">
        <span style="font-size:3rem;font-weight:900;line-height:1;letter-spacing:-2px;color:${p.color}">$${p.price}</span>
        <span style="font-size:.95rem;color:var(--text-muted);padding-bottom:8px">/month</span>
      </div>
      <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:20px">
        Billed monthly · Cancel any time
      </div>

      <!-- Quote quota -->
      <div style="
        background:${p.colorHex}11;
        border:1px solid ${p.colorHex}33;
        border-radius:var(--r-md);
        padding:14px 16px;
        margin-bottom:24px;
      ">
        <div style="font-size:.95rem;font-weight:800;color:${p.color};margin-bottom:2px">
          ${p.invoices} quotes / month
        </div>
        <div style="font-size:.78rem;color:var(--text-muted)">
          then $${p.overage.toFixed(2)} per extra quote
        </div>
      </div>

      <!-- Features -->
      <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">
        Everything included
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:32px">
        ${ALL_FEATURES.map(f => featureRow(f, p.color)).join('')}
      </div>

      <!-- CTA -->
      <div style="margin-top:auto">
        <button class="btn ${p.popular ? 'btn-primary' : 'btn-ghost'}"
          style="width:100%;justify-content:center;padding:14px;font-size:.95rem;${p.popular ? '' : `border-color:${p.colorHex}66;color:${p.color}`}"
          onclick="window._navigate('/signup?plan=${p.id}')">
          Start with ${p.name} →
        </button>
      </div>
    </div>
  `;
}

function popularRibbon(color) {
  return `
    <div style="
      position:absolute;
      top:18px;right:-30px;
      background:${color};
      color:#fff;
      font-size:.65rem;
      font-weight:800;
      letter-spacing:.6px;
      text-transform:uppercase;
      padding:5px 40px;
      transform:rotate(45deg);
      transform-origin:center;
    ">Most popular</div>
  `;
}

function featureRow(text, color) {
  return `
    <div style="display:flex;align-items:flex-start;gap:9px">
      <span style="
        width:18px;height:18px;border-radius:50%;
        background:${color}22;
        color:${color};
        display:flex;align-items:center;justify-content:center;
        font-size:.7rem;flex-shrink:0;margin-top:1px;font-weight:800;
      ">✓</span>
      <span style="font-size:.85rem;color:var(--text-subtle)">${text}</span>
    </div>
  `;
}

// ─── Comparison table ─────────────────────────────────────────────────────────

function comparisonTable() {
  const rows = [
    { label: 'Monthly price',              starter: '$149/mo',  growth: '$249/mo',  pro: '$399/mo',  highlight: true },
    { label: 'Quotes included / month',    starter: '50',       growth: '120',      pro: '300',      highlight: true },
    { label: 'Per-quote overage rate',     starter: '$2.00',    growth: '$1.50',    pro: '$1.00',    highlight: true },
    { label: 'Technician accounts',        starter: true,       growth: true,       pro: true },
    { label: 'Guided inspection wizard',   starter: true,       growth: true,       pro: true },
    { label: 'Deficiency capture + photos',starter: true,       growth: true,       pro: true },
    { label: 'Offline mode',               starter: true,       growth: true,       pro: true },
    { label: 'Admin scheduling board',     starter: true,       growth: true,       pro: true },
    { label: 'PDF inspection reports',     starter: true,       growth: true,       pro: true },
    { label: 'Quote builder + PDF',        starter: true,       growth: true,       pro: true },
    { label: 'Customer approval workflow', starter: true,       growth: true,       pro: true },
    { label: 'Kanban job pipeline',        starter: true,       growth: true,       pro: true },
    { label: 'Pricing framework',          starter: true,       growth: true,       pro: true },
    { label: 'Email support',              starter: true,       growth: true,       pro: true },
  ];

  const hStyle = `padding:14px 16px;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;background:var(--bg-raised);border-bottom:1px solid var(--border);`;

  const header = `
    <div style="display:grid;grid-template-columns:1fr 110px 110px 110px;min-width:500px">
      <div style="${hStyle}color:var(--text-muted)">Feature</div>
      <div style="${hStyle}text-align:center;color:var(--success)">Starter</div>
      <div style="${hStyle}text-align:center;color:var(--brand)">Growth</div>
      <div style="${hStyle}text-align:center;color:#a855f7">Pro</div>
    </div>
  `;

  const tableRows = rows.map((row, i) => {
    const isLast = i === rows.length - 1;
    return `
      <div style="display:grid;grid-template-columns:1fr 110px 110px 110px;min-width:500px;${!isLast ? 'border-bottom:1px solid var(--border)' : ''};${row.highlight ? 'background:var(--bg-raised)' : ''}">
        <div style="padding:12px 16px;font-size:.86rem;color:var(--text-subtle);${row.highlight ? 'font-weight:600' : ''}">${row.label}</div>
        <div style="padding:12px 16px;text-align:center">${cell(row.starter, 'var(--success)')}</div>
        <div style="padding:12px 16px;text-align:center">${cell(row.growth, 'var(--brand)')}</div>
        <div style="padding:12px 16px;text-align:center">${cell(row.pro, '#a855f7')}</div>
      </div>
    `;
  }).join('');

  return header + tableRows;
}

function cell(val, color) {
  if (val === true)  return `<span style="color:${color};font-weight:700;font-size:1rem">✓</span>`;
  if (val === false) return `<span style="color:var(--border);font-size:1rem">—</span>`;
  return `<span style="font-size:.82rem;font-weight:700;color:${color}">${val}</span>`;
}
