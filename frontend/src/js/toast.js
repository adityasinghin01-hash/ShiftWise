/* ── SHIFTWISE TOAST UTILITY ── */

const getContainer = () => document.getElementById('toast-container');

const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
const COLORS = {
  success: 'rgba(16,185,129,0.12)',
  error: 'rgba(239,68,68,0.12)',
  warning: 'rgba(245,158,11,0.12)',
  info: 'rgba(6,182,212,0.12)',
};

export function toast(message, type = 'info', duration = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.style.background = COLORS[type] || COLORS.info;
  el.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <span>${message}</span>
  `;
  getContainer().appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = '0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}
