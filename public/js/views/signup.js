/**
 * signup.js — Company onboarding / account creation
 *
 * Public page — no auth required.
 * URL params:
 *   ?plan=starter   (pre-selects Small Team plan)
 *   ?plan=company   (pre-selects Full Plan)
 *
 * Flow:
 *   Step 1 → Choose plan (pre-filled if ?plan= is set)
 *   Step 2 → Company details (name)
 *   Step 3 → Account credentials (email + password)
 *   → POST /v1/auth/signup
 *   → Auto sign-in via Supabase Auth
 *   → Redirect to /dashboard
 */

import { api }   from '../api.js';
import { login } from '../auth.js';

// ─── Plans ────────────────────────────────────────────────────────────────────
// Keep in sync with billing.js and pricing.js

const PLANS = {
  starter: {
    id:    'starter',
    name:  'Starter',
    badge: 'Starter',
    price: '$149',
    desc:  '50 quotes/month included · $2.00 per extra',
    color: 'var(--success)',
    brand: false,
  },
  growth: {
    id:    'growth',
    name:  'Growth',
    badge: 'Growth',
    price: '$249',
    desc:  '120 quotes/month included · $1.50 per extra',
    color: 'var(--brand)',
    brand: true,
  },
  pro: {
    id:    'pro',
    name:  'Pro',
    badge: 'Pro',
    price: '$399',
    desc:  '300 quotes/month included · $1.00 per extra',
    color: '#a855f7',
    brand: false,
  },
};

// ─── State ────────────────────────────────────────────────────────────────────

let currentStep  = 1;
let selectedPlan = 'starter';
let companyName  = '';
let email        = '';
let password     = '';
let container    = null;

// ─── Entry point ──────────────────────────────────────────────────────────────

export function renderSignup(c) {
  container = c;

  // Read ?plan= from URL
  const params = new URLSearchParams(location.search);
  const planParam = params.get('plan');
  if (planParam && PLANS[planParam]) selectedPlan = planParam;
  // If plan was provided, skip step 1
  currentStep = planParam ? 2 : 1;
  companyName = '';
  email       = '';
  password    = '';

  renderFrame();
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function renderFrame() {
  container.innerHTML = `
    <div style="min-height:100vh;background:var(--bg-base);display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%;max-width:520px">

        <!-- Logo -->
        <div style="text-align:center;margin-bottom:32px">
          <div style="width:44px;height:44px;background:var(--brand);border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;box-shadow:0 0 24px rgba(249,115,22,.35)"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-1 .23-1.94.75-2.72 1.32-2.23 1.74-3.28 4.7-2.72 7.45.06.27.06.55 0 .82-.07.27-.2.53-.4.74-.55.52-.78 1.28-.65 1.99.13.7.62 1.3 1.28 1.56.76.3 1.58.14 2.22-.38.42-.35.7-.86.74-1.4.04-.48-.13-.95-.38-1.35-.54-.79-.66-1.49-.46-2.19.06.46.28.9.6 1.24.63.67 1.35 1.28 1.9 2.01.7.96 1.04 2.12.98 3.28-.04.72-.25 1.44-.61 2.05 1.32.97 2.73 1.2 3.97.7 2.48-1.01 3.94-3.72 3.15-6.32-.28-.93-.78-1.75-1.54-2.44-.48-.43-1.04-.8-1.3-1.54z"/></svg></div>
          <h1 style="font-size:1.5rem;font-weight:900;letter-spacing:-.3px;margin:0 0 4px">Fire Flow</h1>
          <p style="font-size:.85rem;color:var(--text-muted);margin:0">Create your account</p>
        </div>

        <!-- Progress -->
        <div style="display:flex;align-items:center;gap:0;margin-bottom:32px">
          ${[1,2,3].map(n => stepDot(n)).join('<div style="flex:1;height:2px;background:' + (currentStep > 1 ? 'var(--brand)' : 'var(--border)') + '"></div>')}
        </div>

        <!-- Card -->
        <div style="
          background:var(--bg-surface);
          border:1px solid var(--border);
          border-radius:var(--r-xl);
          padding:36px 32px;
        " id="signup-card">
          ${renderStep()}
        </div>

        <!-- Back to login -->
        <p style="text-align:center;margin-top:20px;font-size:.8rem;color:var(--text-muted)">
          Already have an account?
          <button class="btn btn-ghost btn-sm" onclick="window._navigate('/login')"
            style="font-size:.8rem;color:var(--brand);padding:2px 4px">Sign in →</button>
        </p>

      </div>
    </div>
  `;

  bindStep();
}

function stepDot(n) {
  const done    = n < currentStep;
  const active  = n === currentStep;
  const bg      = done ? 'var(--brand)' : active ? 'var(--brand)' : 'var(--bg-raised)';
  const color   = (done || active) ? '#fff' : 'var(--text-muted)';
  const border  = active ? '2px solid var(--brand)' : done ? 'none' : '2px solid var(--border)';
  const label   = ['Plan', 'Company', 'Account'][n - 1];
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="
        width:28px;height:28px;border-radius:50%;
        background:${bg};border:${border};
        color:${color};font-size:.75rem;font-weight:700;
        display:flex;align-items:center;justify-content:center;
        position:relative;z-index:1;
      ">${done ? '✓' : n}</div>
      <span style="font-size:.65rem;color:${active ? 'var(--brand)' : 'var(--text-muted)'};font-weight:${active ? 700 : 400}">${label}</span>
    </div>
  `;
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function renderStep() {
  if (currentStep === 1) return renderStep1();
  if (currentStep === 2) return renderStep2();
  if (currentStep === 3) return renderStep3();
  return '';
}

// Step 1: Choose plan
function renderStep1() {
  return `
    <h2 style="font-size:1.15rem;font-weight:800;margin:0 0 6px">Choose your plan</h2>
    <p style="font-size:.85rem;color:var(--text-muted);margin:0 0 24px">You can change this at any time.</p>

    <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:28px" id="plan-options">
      ${planCard('starter')}
      ${planCard('growth')}
      ${planCard('pro')}
    </div>

    <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:.95rem"
      id="step1-next">
      Continue →
    </button>
    <div style="text-align:center;margin-top:14px">
      <button class="btn btn-ghost btn-sm" onclick="window._navigate('/pricing')"
        style="font-size:.78rem;color:var(--text-muted)">← View full comparison</button>
    </div>
  `;
}

function planCard(planId) {
  const p      = PLANS[planId];
  const sel    = selectedPlan === planId;
  const border = sel ? '2px solid var(--brand)' : '1px solid var(--border)';
  const bg     = sel ? 'rgba(249,115,22,.05)' : 'transparent';
  return `
    <div class="plan-card" data-plan="${planId}" style="
      border:${border};background:${bg};
      border-radius:var(--r-lg);padding:18px 20px;
      cursor:pointer;transition:border-color .15s,background .15s;
      display:flex;align-items:center;gap:16px;
    ">
      <div style="
        width:20px;height:20px;border-radius:50%;
        border:2px solid ${sel ? 'var(--brand)' : 'var(--border)'};
        background:${sel ? 'var(--brand)' : 'transparent'};
        flex-shrink:0;display:flex;align-items:center;justify-content:center;
        transition:all .15s;
      ">${sel ? '<span style="color:#fff;font-size:.65rem;font-weight:900">✓</span>' : ''}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
          <span style="font-size:.95rem;font-weight:700">${p.name}</span>
          <span class="badge badge-orange" style="font-size:.68rem;background:${p.color}20;color:${p.color};border-color:${p.color}40">${p.badge}</span>
        </div>
        <div style="font-size:.8rem;color:var(--text-muted)">${p.desc}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:1.2rem;font-weight:900;color:${p.color}">${p.price}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">/month</div>
      </div>
    </div>
  `;
}

// Step 2: Company info
function renderStep2() {
  const p = PLANS[selectedPlan];
  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
      <div>
        <h2 style="font-size:1.15rem;font-weight:800;margin:0 0 2px">Your company</h2>
        <p style="font-size:.82rem;color:var(--text-muted);margin:0">
          ${p.name} · ${p.price}/month
          <button class="btn btn-ghost btn-sm" id="change-plan-btn"
            style="font-size:.75rem;color:var(--brand);padding:1px 4px;margin-left:4px">change</button>
        </p>
      </div>
    </div>

    <div class="form-group" style="margin-bottom:20px">
      <label class="form-label">Company name <span style="color:var(--error)">*</span></label>
      <input id="company-name-input" type="text" class="form-input"
        placeholder="Acme Fire Protection, Inc."
        value="${_esc(companyName)}"
        autocomplete="organization" maxlength="120">
      <p style="font-size:.73rem;color:var(--text-muted);margin:6px 0 0">
        This appears on quotes and inspection reports.
      </p>
    </div>

    <div id="step2-error" class="login-error" style="display:none;margin-bottom:16px"></div>

    <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px"
      id="step2-next">Continue →</button>
    <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:10px"
      id="step2-back">← Back</button>
  `;
}

// Step 3: Account credentials
function renderStep3() {
  const p = PLANS[selectedPlan];
  return `
    <h2 style="font-size:1.15rem;font-weight:800;margin:0 0 4px">Create your account</h2>
    <p style="font-size:.82rem;color:var(--text-muted);margin:0 0 24px">
      ${_esc(companyName)} · ${p.name} · ${p.price}/month
    </p>

    <div id="step3-error" class="login-error" style="display:none;margin-bottom:16px"></div>

    <form id="signup-form" style="display:flex;flex-direction:column;gap:18px">
      <div class="form-group">
        <label class="form-label">Work email <span style="color:var(--error)">*</span></label>
        <input id="signup-email" type="email" class="form-input"
          placeholder="you@company.com"
          value="${_esc(email)}"
          autocomplete="email" required>
      </div>

      <div class="form-group">
        <label class="form-label">Password <span style="color:var(--error)">*</span></label>
        <div style="position:relative">
          <input id="signup-password" type="password" class="form-input"
            placeholder="Min 8 characters"
            style="padding-right:52px"
            autocomplete="new-password" required minlength="8">
          <button type="button" id="pw-toggle"
            style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
              background:none;border:none;color:var(--text-muted);
              cursor:pointer;padding:6px;border-radius:var(--r-sm);
              display:flex;align-items:center;justify-content:center"
            aria-label="Show password"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
        <p id="pw-strength" style="font-size:.72rem;color:var(--text-muted);margin:6px 0 0"></p>
      </div>

      <button type="submit" class="btn btn-primary" id="submit-btn"
        style="padding:14px;font-size:.95rem;justify-content:center">
        Create account →
      </button>
    </form>

    <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:10px"
      id="step3-back">← Back</button>

    <p style="font-size:.72rem;color:var(--text-muted);text-align:center;margin-top:18px;line-height:1.6">
      By creating an account you agree to our
      <a href="mailto:sales@fireflow.app" style="color:var(--brand)">Terms of Service</a>.
      No credit card required to start.
    </p>
  `;
}

// ─── Bind event listeners ─────────────────────────────────────────────────────

function bindStep() {
  if (currentStep === 1) bindStep1();
  if (currentStep === 2) bindStep2();
  if (currentStep === 3) bindStep3();
}

function bindStep1() {
  // Plan selection
  document.querySelectorAll('.plan-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedPlan = card.dataset.plan;
      // Re-render just the plan cards section
      document.getElementById('plan-options').innerHTML =
        planCard('starter') + planCard('growth') + planCard('pro');
      document.querySelectorAll('.plan-card').forEach(c => {
        c.addEventListener('click', () => {
          selectedPlan = c.dataset.plan;
          document.getElementById('plan-options').innerHTML =
            planCard('starter') + planCard('growth') + planCard('pro');
          bindStep1Cards();
        });
      });
    });
  });

  document.getElementById('step1-next').addEventListener('click', () => {
    currentStep = 2;
    renderFrame();
  });
}

function bindStep1Cards() {
  document.querySelectorAll('.plan-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedPlan = card.dataset.plan;
      document.getElementById('plan-options').innerHTML =
        planCard('starter') + planCard('growth') + planCard('pro');
      bindStep1Cards();
    });
  });
}

function bindStep2() {
  const input = document.getElementById('company-name-input');
  const err   = document.getElementById('step2-error');

  input.focus();
  input.addEventListener('input', () => { companyName = input.value; });

  document.getElementById('change-plan-btn')?.addEventListener('click', () => {
    currentStep = 1; renderFrame();
  });

  document.getElementById('step2-back').addEventListener('click', () => {
    currentStep = 1; renderFrame();
  });

  document.getElementById('step2-next').addEventListener('click', () => {
    companyName = input.value.trim();
    if (!companyName) {
      err.textContent = 'Company name is required.';
      err.style.display = 'block';
      input.focus();
      return;
    }
    err.style.display = 'none';
    currentStep = 3;
    renderFrame();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('step2-next').click();
  });
}

function bindStep3() {
  const pwInput  = document.getElementById('signup-password');
  const pwToggle = document.getElementById('pw-toggle');
  const pwStrength = document.getElementById('pw-strength');
  const emailInput = document.getElementById('signup-email');
  const errEl    = document.getElementById('step3-error');
  const form     = document.getElementById('signup-form');
  const submitBtn= document.getElementById('submit-btn');

  // Restore state
  if (email)    emailInput.value  = email;
  if (password) pwInput.value     = password;

  // Password show/hide — SVG eye / eye-off
  const _eyeOn  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const _eyeOff = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  pwToggle.addEventListener('click', () => {
    const showing = pwInput.type === 'text';
    pwInput.type     = showing ? 'password' : 'text';
    pwToggle.innerHTML = showing ? _eyeOn : _eyeOff;
  });

  // Password strength hint
  pwInput.addEventListener('input', () => {
    password = pwInput.value;
    const len = password.length;
    if (!len) { pwStrength.textContent = ''; return; }
    if (len < 8)  { pwStrength.textContent = '⚠ Too short (min 8 characters)'; pwStrength.style.color = 'var(--error)'; return; }
    if (len < 12) { pwStrength.textContent = 'Good';   pwStrength.style.color = 'var(--success)'; return; }
    pwStrength.textContent = 'Strong';
    pwStrength.style.color = 'var(--success)';
  });

  emailInput.addEventListener('input', () => { email = emailInput.value; });

  document.getElementById('step3-back').addEventListener('click', () => {
    currentStep = 2; renderFrame();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    email    = emailInput.value.trim();
    password = pwInput.value;

    errEl.style.display = 'none';
    submitBtn.disabled  = true;
    submitBtn.textContent = 'Creating account…';

    try {
      // 1. Create the account on our server
      await api.signup({ email, password, company_name: companyName, plan: selectedPlan });

      submitBtn.textContent = 'Signing in…';

      // 2. Sign in to get a session token
      try {
        await login(email, password);
        window._notify?.success(`Welcome to Fire Flow, ${companyName}!`);
        // Route to /billing so they can activate their subscription immediately
        window._navigate?.('/billing');
      } catch (loginErr) {
        // Signup succeeded but auto-login failed (e.g. Supabase not configured,
        // or email confirmation required in live mode). Show success state.
        showSuccessState();
      }

    } catch (err) {
      const msg = err.code === 'EMAIL_TAKEN'
        ? 'An account with that email already exists. <button class="btn btn-ghost btn-sm" onclick="window._navigate(\'/login\')" style="font-size:.8rem;color:var(--brand)">Sign in instead →</button>'
        : (err.message ?? 'Something went wrong. Please try again.');

      errEl.innerHTML     = msg;
      errEl.style.display = 'block';
      submitBtn.disabled  = false;
      submitBtn.textContent = 'Create account →';
    }
  });
}

// ─── Success state (shown when auto-login is not possible) ────────────────────

function showSuccessState() {
  const card = document.getElementById('signup-card');
  if (!card) return;
  card.innerHTML = `
    <div style="text-align:center;padding:16px 0">
      
      <h2 style="font-size:1.3rem;font-weight:800;margin:0 0 10px">Account created!</h2>
      <p style="font-size:.9rem;color:var(--text-muted);line-height:1.6;margin:0 0 28px">
        Welcome to Fire Flow, <strong>${_esc(companyName)}</strong>.<br>
        Your account is ready — sign in to get started.
      </p>
      <button class="btn btn-primary" style="padding:13px 32px;font-size:.95rem"
        onclick="window._navigate('/login')">
        Sign in →
      </button>
    </div>
  `;
}

// ─── Tiny escape helper (no circular import from app.js) ─────────────────────

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
