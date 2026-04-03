/**
 * login.js — Login screen
 */

import { login, DEV_MODE } from '../auth.js';

// ── SVG assets ────────────────────────────────────────────────────────────────

const _flameSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.66 11.2c-.23-.3-.51-.56-.77-.82-.67-.6-1.43-1.03-2.07-1.66C13.33 7.26 13 4.85 13.95 3c-1 .23-1.94.75-2.72 1.32-2.23 1.74-3.28 4.7-2.72 7.45.06.27.06.55 0 .82-.07.27-.2.53-.4.74-.55.52-.78 1.28-.65 1.99.13.7.62 1.3 1.28 1.56.76.3 1.58.14 2.22-.38.42-.35.7-.86.74-1.4.04-.48-.13-.95-.38-1.35-.54-.79-.66-1.49-.46-2.19.06.46.28.9.6 1.24.63.67 1.35 1.28 1.9 2.01.7.96 1.04 2.12.98 3.28-.04.72-.25 1.44-.61 2.05 1.32.97 2.73 1.2 3.97.7 2.48-1.01 3.94-3.72 3.15-6.32-.28-.93-.78-1.75-1.54-2.44-.48-.43-1.04-.8-1.3-1.54z"/>
</svg>`;

const _eyeShow = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _eyeHide = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <div class="flame-lg">${_flameSvg}</div>
          <div>
            <h1>Fire Flow</h1>
            <p>Inspection Management Platform</p>
          </div>
        </div>

        <div id="login-dev-notice" class="login-dev-notice" style="display:none">
          Dev mode — enter any email and password to log in
        </div>
        <div id="login-error" class="login-error" style="display:none"></div>

        <form id="login-form" style="display:flex;flex-direction:column;gap:16px">
          <div class="form-group">
            <label class="form-label">Email address</label>
            <input id="login-email" type="email" class="form-input" placeholder="you@company.com" autocomplete="email" required>
          </div>
          <!-- FIELD FIX: show/hide password — gloved hands in dark mechanical rooms -->
          <div class="form-group">
            <label class="form-label">Password</label>
            <div style="position:relative">
              <input id="login-password" type="password" class="form-input"
                placeholder="••••••••" autocomplete="current-password" required
                style="padding-right:52px">
              <button type="button" id="pw-toggle"
                style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
                  background:none;border:none;color:var(--text-muted);
                  cursor:pointer;padding:6px;border-radius:var(--r-sm);
                  display:flex;align-items:center;justify-content:center;
                  transition:color var(--t-fast)"
                aria-label="Show password">
                ${_eyeShow}
              </button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="login-btn" style="margin-top:4px;width:100%;justify-content:center">
            Sign in
          </button>
        </form>

        <div style="margin-top:28px;display:flex;flex-direction:column;gap:8px;align-items:center">
          <div style="display:flex;align-items:center;gap:10px;width:100%;margin-bottom:4px">
            <div style="height:1px;flex:1;background:var(--border-faint)"></div>
            <span style="font-size:.70rem;color:var(--text-muted);white-space:nowrap">New to Fire Flow?</span>
            <div style="height:1px;flex:1;background:var(--border-faint)"></div>
          </div>
          <button type="button" class="btn btn-secondary" style="width:100%;justify-content:center"
            onclick="window._navigate('/signup')">
            Create an account
          </button>
          <button type="button" class="btn btn-ghost btn-sm" style="color:var(--text-muted);font-size:.75rem"
            onclick="window._navigate('/pricing')">
            View plans &amp; pricing
          </button>
          <p style="font-size:.68rem;color:var(--text-muted);margin-top:4px;letter-spacing:.2px">
            Fire suppression inspection platform · v1.0
          </p>
        </div>
      </div>
    </div>
  `;

  // Show dev mode notice if no Supabase key is configured
  const devNotice = document.getElementById('login-dev-notice');
  if (devNotice && DEV_MODE) devNotice.style.display = 'block';

  const form   = document.getElementById('login-form');
  const btn    = document.getElementById('login-btn');
  const err    = document.getElementById('login-error');
  const pwInput  = document.getElementById('login-password');
  const pwToggle = document.getElementById('pw-toggle');

  // Password visibility toggle — SVG eye / eye-off
  pwToggle.addEventListener('click', () => {
    const showing = pwInput.type === 'text';
    pwInput.type     = showing ? 'password' : 'text';
    pwToggle.innerHTML = showing ? _eyeShow : _eyeHide;
    pwToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    err.style.display = 'none';
    btn.disabled      = true;
    btn.textContent   = 'Signing in…';

    try {
      const user = await login(email, password);
      onSuccess(user);
    } catch (ex) {
      err.textContent   = ex.message;
      err.style.display = 'block';
      btn.disabled      = false;
      btn.textContent   = 'Sign in';
    }
  });
}
