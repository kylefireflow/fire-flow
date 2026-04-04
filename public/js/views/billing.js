/**
 * billing.js — Subscription management page (admin only)
 *
 * States handled:
 *   unconfigured  Stripe env vars not set — shows setup guide
 *   inactive      No active subscription — shows plan picker + Checkout CTA
 *   active         Paid-up subscription — shows plan info + portal link
 *   past_due       Payment failed — shows warning + portal link
 *   cancelled      Subscription was cancelled — shows resubscribe option
 *
 * URL params:
 *   ?success=true        Stripe redirected here after successful checkout
 *   ?cancelled=true      Stripe redirected here after user cancelled checkout
 *   ?session_id=cs_xxx   Stripe session ID (informational only)
 */

import { api }        from '../api.js';
import { getCurrentUser } from '../auth.js';

// ─── Plan constants (mirrors server/pricing page) ─────────────────────────────

const PLANS = {
  starter: {
    name: 'Starter', badge: 'Starter', price: '$149', color: 'var(--success)',
    invoices: 50, overage: 2.00,
    desc: '50 invoices/month included · $2.00 per extra',
  },
  growth: {
    name: 'Growth', badge: 'Growth', price: '$249', color: 'var(--brand)',
    invoices: 120, overage: 1.50,
    desc: '120 invoices/month included · $1.50 per extra',
  },
  pro: {
    name: 'Pro', badge: 'Pro', price: '$399', color: '#a855f7',
    invoices: 300, overage: 1.00,
    desc: '300 invoices/month included · $1.00 per extra',
  },
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderBilling(container) {
  const params     = new URLSearchParams(location.search);
  const wasSuccess  = params.get('success') === 'true';
  const wasCancelled = params.get('cancelled') === 'true';

  // Clear query params from URL without reloading
  if (wasSuccess || wasCancelled) {
    history.replaceState({}, '', '/billing');
  }

  container.innerHTML = `
    <div style="max-width:760px;margin:0 auto;padding:32px 24px 64px">
      <div style="margin-bottom:28px">
        <h1 style="font-size:1.5rem;font-weight:900;margin:0 0 6px">Billing & Subscription</h1>
        <p style="font-size:.9rem;color:var(--text-muted);margin:0">
          Manage your Fire Flow plan and payment details.
        </p>
      </div>

      ${wasSuccess ? successBanner() : ''}
      ${wasCancelled ? cancelledBanner() : ''}

      <div id="billing-body">
        <div class="loading-overlay"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  try {
    const res = await api.getSubscription();
    const sub = res.data ?? {};
    renderBillingBody(document.getElementById('billing-body'), sub);
  } catch (err) {
    document.getElementById('billing-body').innerHTML = errorState(err.message);
  }
}

// ─── Render billing body based on subscription state ─────────────────────────

function renderBillingBody(el, sub) {
  if (sub.dev_mode || sub.status === 'unconfigured') {
    el.innerHTML = renderUnconfigured(sub);
    return;
  }

  const status = sub.subscription_status ?? sub.status ?? 'inactive';

  switch (status) {
    case 'active':
    case 'trialing':
      el.innerHTML = renderActive(sub);
      break;
    case 'past_due':
      el.innerHTML = renderPastDue(sub);
      bindPortalButton(el);
      return;
    case 'cancelled':
      el.innerHTML = renderCancelled(sub);
      break;
    case 'inactive':
    default:
      el.innerHTML = renderInactive(sub);
      break;
  }

  bindPlanButtons(el);
  bindPortalButton(el);
}

// ─── State renders ────────────────────────────────────────────────────────────

function renderActive(sub) {
  const plan   = PLANS[sub.plan] ?? PLANS.starter;
  const period = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const cancelling = sub.cancel_at_period_end;

  return `
    <!-- Current plan card -->
    <div style="
      background:var(--bg-surface);
      border:1px solid var(--border);
      border-radius:var(--r-xl);
      padding:28px 28px;
      margin-bottom:20px;
    ">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="font-size:1.1rem;font-weight:800">${plan.name}</span>
            <span class="badge ${sub.plan === 'company' ? 'badge-orange' : 'badge-blue'}">${plan.badge}</span>
            <span class="badge" style="background:rgba(34,197,94,.12);color:var(--success);border-color:transparent">
              ✓ Active
            </span>
          </div>
          <div style="font-size:.88rem;color:var(--text-muted)">${plan.desc} · ${plan.price}/month</div>
          ${period ? `
            <div style="font-size:.8rem;color:var(--text-muted);margin-top:6px">
              ${cancelling
                ? `<span style="color:var(--warning)">⚠ Cancels on ${period}</span>`
                : `Next billing date: ${period}`}
            </div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" id="portal-btn">
          Manage billing →
        </button>
      </div>
    </div>

    ${cancelling ? `
      <div style="
        background:rgba(245,158,11,.08);
        border:1px solid rgba(245,158,11,.25);
        border-radius:var(--r-lg);
        padding:16px 20px;
        font-size:.88rem;
        color:var(--warning);
        margin-bottom:20px;
        line-height:1.5;
      ">
        ⚠ Your subscription is set to cancel on ${period}.
        You'll retain access until then. To reactivate, click "Manage billing" above.
      </div>` : ''}

    <!-- Upgrade / switch plan section -->
    ${sub.plan !== 'pro' ? upgradeCta(sub.plan) : ''}

    <!-- What's included -->
    ${includedFeatures(sub.plan)}

    <!-- Billing portal info -->
    ${billingPortalInfo()}
  `;
}

function renderPastDue(sub) {
  const plan = PLANS[sub.plan] ?? PLANS.starter;
  return `
    <div style="
      background:rgba(239,68,68,.07);
      border:1px solid rgba(239,68,68,.3);
      border-radius:var(--r-xl);
      padding:28px;
      margin-bottom:20px;
    ">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="width:36px;height:36px;background:var(--danger-dim);border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;color:var(--danger);flex-shrink:0"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <div>
          <h3 style="font-size:1rem;font-weight:800;color:var(--error);margin:0 0 6px">Payment failed</h3>
          <p style="font-size:.88rem;color:var(--text-subtle);line-height:1.5;margin:0 0 16px">
            We couldn't process your last payment for the <strong>${plan.name}</strong> plan.
            Please update your payment method to keep your account active.
          </p>
          <button class="btn btn-primary" id="portal-btn">
            Update payment method →
          </button>
        </div>
      </div>
    </div>
    ${billingPortalInfo()}
  `;
}

function renderCancelled(sub) {
  const oldPlan = PLANS[sub.plan] ?? PLANS.starter;
  return `
    <div style="
      background:var(--bg-surface);
      border:1px solid var(--border);
      border-radius:var(--r-xl);
      padding:28px;
      margin-bottom:20px;
      text-align:center;
    ">
      
      <h3 style="font-size:1.1rem;font-weight:800;margin:0 0 8px">Your subscription has ended</h3>
      <p style="font-size:.88rem;color:var(--text-muted);line-height:1.5;margin:0 0 24px">
        Your <strong>${oldPlan.name}</strong> plan has been cancelled.
        Reactivate at any time — your data is still here.
      </p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary plan-btn" data-plan="starter">
          Restart with Small Team ($200/mo) →
        </button>
        <button class="btn btn-ghost plan-btn" data-plan="company">
          Or go Full Plan ($550/mo)
        </button>
      </div>
    </div>
  `;
}

function renderInactive(sub) {
  return `
    <div style="
      background:var(--bg-surface);
      border:1px solid var(--border);
      border-radius:var(--r-xl);
      padding:36px 32px;
      margin-bottom:24px;
    ">
      <h2 style="font-size:1.15rem;font-weight:800;margin:0 0 8px">Activate your subscription</h2>
      <p style="font-size:.88rem;color:var(--text-muted);line-height:1.5;margin:0 0 28px">
        Choose a plan to unlock the full Fire Flow platform.
        Billed monthly — cancel any time.
      </p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
        ${planPickerCard('starter')}
        ${planPickerCard('growth')}
        ${planPickerCard('pro')}
      </div>
    </div>

    ${billingPortalInfo()}
  `;
}

function renderUnconfigured(sub) {
  const envVars = sub.env_vars ?? ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_STARTER_PRICE_ID', 'STRIPE_COMPANY_PRICE_ID'];
  return `
    <div style="
      background:var(--bg-surface);
      border:1px solid var(--border);
      border-radius:var(--r-xl);
      padding:32px;
    ">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:24px">
        
        <div>
          <h2 style="font-size:1.1rem;font-weight:800;margin:0 0 6px">Stripe billing not configured</h2>
          <p style="font-size:.88rem;color:var(--text-muted);line-height:1.5;margin:0">
            Add the following environment variables to your <code style="
              background:var(--bg-raised);padding:1px 5px;border-radius:4px;font-size:.82rem
            ">.env</code> file to enable billing.
          </p>
        </div>
      </div>

      <div style="
        background:var(--bg-raised);
        border:1px solid var(--border);
        border-radius:var(--r-md);
        padding:18px 20px;
        font-family:monospace;
        font-size:.82rem;
        line-height:2;
        margin-bottom:24px;
        overflow-x:auto;
      ">${envVars.map(v => `<div><span style="color:var(--brand)">${_esc(v)}</span>=<span style="color:var(--text-muted)">your_value_here</span></div>`).join('')}</div>

      <div style="font-size:.85rem;color:var(--text-subtle);line-height:1.7">
        <strong>To get these values:</strong>
        <ol style="margin:8px 0 0 20px;padding:0">
          <li>Go to <a href="https://dashboard.stripe.com" target="_blank" style="color:var(--brand)">dashboard.stripe.com</a> and create an account</li>
          <li>Copy your secret key from <em>Developers → API keys</em></li>
          <li>Create two products: Small Team ($200/mo) and Full Plan ($550/mo) — copy the Price IDs</li>
          <li>Add a webhook endpoint pointing to <code style="background:var(--bg-raised);padding:1px 5px;border-radius:4px">/v1/billing/webhook</code></li>
          <li>Copy the webhook signing secret</li>
          <li>Restart the server</li>
        </ol>
      </div>
    </div>
  `;
}

// ─── Shared components ────────────────────────────────────────────────────────

function planPickerCard(planId) {
  const p = PLANS[planId];
  const isPopular = planId === 'growth';
  return `
    <div style="
      border:1px solid ${isPopular ? p.color : 'var(--border)'};
      border-radius:var(--r-lg);
      padding:20px;
      display:flex;
      flex-direction:column;
      gap:12px;
      position:relative;
      ${isPopular ? 'box-shadow:0 0 0 1px ' + p.color + '33' : ''}
    ">
      ${isPopular ? `<div style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:${p.color};color:#fff;font-size:.68rem;font-weight:700;padding:3px 10px;border-radius:99px;white-space:nowrap">MOST POPULAR</div>` : ''}
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:1rem;font-weight:700">${p.name}</span>
        </div>
        <div style="font-size:1.8rem;font-weight:900;color:${p.color};line-height:1;margin-bottom:4px">
          ${p.price}<span style="font-size:.8rem;font-weight:400;color:var(--text-muted)">/mo</span>
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);line-height:1.5">
          <div>✓ ${p.invoices} invoices/month included</div>
          <div>+ $${p.overage.toFixed(2)} per extra invoice</div>
          <div style="margin-top:4px">✓ All features included</div>
        </div>
      </div>
      <button class="btn ${isPopular ? 'btn-primary' : 'btn-ghost'} plan-btn"
        data-plan="${planId}"
        style="justify-content:center;margin-top:auto">
        Start with ${p.name} →
      </button>
    </div>
  `;
}

function upgradeCta(currentPlan) {
  const nextPlan = currentPlan === 'starter' ? 'growth' : 'pro';
  const p = PLANS[nextPlan];
  return `
    <div style="
      background:rgba(249,115,22,.05);
      border:1px solid rgba(249,115,22,.2);
      border-radius:var(--r-lg);
      padding:20px 24px;
      margin-bottom:20px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:16px;
      flex-wrap:wrap;
    ">
      <div>
        <div style="font-size:.88rem;font-weight:700;margin-bottom:4px">
          Upgrade to ${p.name}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted)">
          ${p.invoices} invoices/month included · $${p.overage.toFixed(2)} per extra · all features included.
        </div>
      </div>
      <button class="btn btn-primary btn-sm plan-btn" data-plan="${nextPlan}" style="flex-shrink:0">
        Upgrade to ${p.price}/mo →
      </button>
    </div>
  `;
}

function includedFeatures(planId) {
  const features = ['Unlimited technicians', 'Guided inspection wizard', 'Deficiency capture', 'Quote builder + PDF', 'Customer approval workflow', 'Kanban job pipeline', 'Pricing framework', 'Offline mode'];

  return `
    <div style="
      background:var(--bg-surface);
      border:1px solid var(--border);
      border-radius:var(--r-xl);
      padding:24px 28px;
      margin-bottom:20px;
    ">
      <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px">
        What's included in your plan
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        ${features.map(f => `
          <div style="display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--text-subtle)">
            <span style="color:var(--success);font-weight:700;font-size:.9rem">✓</span> ${_esc(f)}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function billingPortalInfo() {
  return `
    <div style="font-size:.78rem;color:var(--text-muted);line-height:1.6;text-align:center;margin-top:8px">
      Payment processed securely by <strong>Stripe</strong>.
      View invoices, update your payment method, or cancel via the billing portal.
    </div>
  `;
}

function successBanner() {
  return `
    <div style="
      background:rgba(34,197,94,.08);
      border:1px solid rgba(34,197,94,.25);
      border-radius:var(--r-lg);
      padding:16px 20px;
      margin-bottom:24px;
      display:flex;
      align-items:center;
      gap:12px;
      font-size:.9rem;
    ">
      
      <div>
        <strong>Subscription activated!</strong>
        <span style="color:var(--text-muted);margin-left:8px">Welcome to Fire Flow. Your account is ready.</span>
      </div>
    </div>
  `;
}

function cancelledBanner() {
  return `
    <div style="
      background:rgba(245,158,11,.08);
      border:1px solid rgba(245,158,11,.25);
      border-radius:var(--r-lg);
      padding:16px 20px;
      margin-bottom:24px;
      display:flex;
      align-items:center;
      gap:12px;
      font-size:.88rem;
      color:var(--text-subtle);
    ">
      <span style="font-size:1.2rem">↩️</span>
      No problem — you can activate your subscription below whenever you're ready.
    </div>
  `;
}

function errorState(msg) {
  return `
    <div style="
      background:var(--bg-surface);
      border:1px solid var(--border);
      border-radius:var(--r-xl);
      padding:32px;
      text-align:center;
    ">
      <div class="empty-icon" style="margin:0 auto 12px;color:var(--danger);border-color:rgba(239,68,68,.2);background:var(--danger-dim)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">Couldn't load billing info</h3>
      <p style="font-size:.85rem;color:var(--text-muted);margin:0">${_esc(msg ?? 'Unknown error')}</p>
    </div>
  `;
}

// ─── Interactivity ────────────────────────────────────────────────────────────

function bindPlanButtons(el) {
  el.querySelectorAll('.plan-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const plan = btn.dataset.plan ?? 'starter';
      btn.disabled    = true;
      btn.textContent = 'Redirecting to Stripe…';

      try {
        const user        = getCurrentUser();
        const companyName = user?.app_metadata?.company_name ?? user?.user_metadata?.company_name ?? '';
        const res = await api.createCheckout({ plan, company_name: companyName });
        const { url } = res.data ?? {};
        if (url) {
          window.location.href = url;
        } else {
          throw new Error('No checkout URL returned.');
        }
      } catch (err) {
        window._notify?.error(err.message ?? 'Failed to start checkout. Please try again.');
        btn.disabled    = false;
        btn.textContent = `Activate plan →`;
      }
    });
  });
}

function bindPortalButton(el) {
  const portalBtn = el.querySelector('#portal-btn');
  if (!portalBtn) return;

  portalBtn.addEventListener('click', async () => {
    portalBtn.disabled    = true;
    portalBtn.textContent = 'Opening portal…';

    try {
      const res = await api.createPortal();
      const { url } = res.data ?? {};
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No portal URL returned.');
      }
    } catch (err) {
      window._notify?.error(err.message ?? 'Failed to open billing portal.');
      portalBtn.disabled    = false;
      portalBtn.textContent = 'Manage billing →';
    }
  });
}

// ─── Tiny escape helper ───────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
