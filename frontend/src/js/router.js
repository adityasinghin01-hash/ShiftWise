/* ── SHIFTWISE ROUTER HELPERS ── */
/* Extracted to break circular import: app.js ↔ auth.js */

export const appEl = () => document.getElementById('app');

export function navigate(route, replaceState = false) {
  if (replaceState) {
    history.replaceState(null, '', `#${route}`);
  } else {
    location.hash = route;
  }
}
