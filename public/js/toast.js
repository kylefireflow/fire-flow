/**
 * toast.js — Lightweight notification system
 */

export function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const colors = { success: '#22c55e', error: '#ef4444', info: '#38bdf8', warning: '#f59e0b' };

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span style="font-size:1.1rem;color:${colors[type] ?? colors.info}">${icons[type] ?? icons.info}</span>
    <span style="flex:1">${message}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);font-size:1rem;cursor:pointer;padding:0 0 0 8px">✕</button>
  `;
  container.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all .2s ease';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

export const notify = {
  success: (msg) => toast(msg, 'success'),
  error:   (msg) => toast(msg, 'error', 6000),
  info:    (msg) => toast(msg, 'info'),
  warning: (msg) => toast(msg, 'warning'),
};
