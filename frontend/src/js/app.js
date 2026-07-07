/* ── SPINX SPA ROUTER ── */

import { store } from './store.js';
import { auth, authApi } from './api.js';
import { toast } from './toast.js';
import { navigate } from './router.js';

import { renderAuth } from './pages/auth.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderAdmin } from './pages/admin.js';
import { renderProfile } from './pages/profile.js';
import { renderApiKeys } from './pages/apikeys.js';
import { renderWebhooks } from './pages/webhooks.js';
import { renderOnboarding } from './pages/onboarding.js';
import { renderSettings } from './pages/settings.js';
import { renderTeam } from './pages/team.js';
import { renderJoin } from './pages/join.js';
import { renderAvailability } from './pages/availability.js';
import { renderMyAvailability } from './pages/my-availability.js';
import { businessApi } from './api.js';

export { navigate };

/* ── ROUTES ── */
const ROUTES = {
  login: () => renderAuth('login'),
  signup: () => renderAuth('signup'),
  'forgot-password': () => renderAuth('forgot'),
  'verify-email': () => renderAuth('verify'),
  'reset-password': () => renderAuth('reset-password'),
  dashboard: () => renderDashboard(),
  profile: () => renderProfile(),
  admin: () => renderAdmin(),
  apikeys: () => renderApiKeys(),
  webhooks: () => renderWebhooks(),
  onboarding: () => renderOnboarding(),
  settings: () => renderSettings(),
  team: () => renderTeam(),
  join: () => renderJoin(),
  availability: () => renderAvailability(),
  'my-availability': () => renderMyAvailability(),
};

const PUBLIC_ROUTES = new Set([
  'login',
  'signup',
  'forgot-password',
  'verify-email',
  'reset-password',
  'join',
]);
const ADMIN_ROUTES = new Set(['admin']);

/**
 * Check whether the logged-in user still needs onboarding.
 * Caches the result in store.onboarding so we only hit the API once per session.
 * Fail-safe: on unexpected errors, returns 'ok' so the user is never trapped.
 * @returns {Promise<'ok'|'needed'>}
 */
async function checkOnboarding() {
  if (store.onboarding) return store.onboarding;
  try {
    const res = await businessApi.get();
    // Backend tells us the real membership ('owner' or 'staff').
    store.membership = res?.membership || 'owner';
    store.onboarding = res?.data?.onboarding?.completed ? 'ok' : 'needed';
  } catch (err) {
    if (err?.status === 403) {
      // 403 = no business context. In our flows that means a signed-up user
      // who hasn't created a business yet → an OWNER who must onboard.
      // (Staff always resolve to 200 with their business.)
      store.membership = 'owner';
      store.onboarding = 'needed';
    } else {
      store.onboarding = 'ok'; // unexpected error — don't trap user
    }
  }
  return store.onboarding;
}

async function handleRoute() {
  // Hash may contain query params: #reset-password?token=abc → route='reset-password'
  const hashFull = location.hash.slice(1) || 'dashboard';
  const [rawRoute] = hashFull.split('?');
  const raw = rawRoute || 'dashboard';
  let route = Object.keys(ROUTES).includes(raw) ? raw : 'dashboard';

  // Auth guards — redirect but don't return; fall through to render the new route
  if (!PUBLIC_ROUTES.has(route) && !store.isLoggedIn()) {
    route = 'login';
    history.replaceState(null, '', '#login');
  } else if (PUBLIC_ROUTES.has(route) && store.isLoggedIn() && route !== 'join') {
    route = 'dashboard';
    history.replaceState(null, '', '#dashboard');
  } else if (ADMIN_ROUTES.has(route) && !store.isAdmin()) {
    toast('Admin access required', 'error');
    route = 'dashboard';
    history.replaceState(null, '', '#dashboard');
  }

  // Onboarding gate — a logged-in user with no completed business is forced
  // through the wizard before any app screen; once done, the wizard is skipped.
  if (store.isLoggedIn() && !PUBLIC_ROUTES.has(route)) {
    const ob = await checkOnboarding();
    if (ob === 'needed' && route !== 'onboarding') {
      route = 'onboarding';
      history.replaceState(null, '', '#onboarding');
    } else if (ob === 'ok' && route === 'onboarding') {
      route = 'dashboard';
      history.replaceState(null, '', '#dashboard');
    }
  }

  await ROUTES[route]?.();
}

/* ── BOOTSTRAP ── */
async function init() {
  store.load();

  // Invite links arrive as ?invite=TOKEN (query param survives email redirects,
  // unlike a #fragment). Capture it, stash it, and route to the public join page.
  const inviteToken = new URLSearchParams(location.search).get('invite');
  if (inviteToken) {
    sessionStorage.setItem('shiftwise_invite_token', inviteToken);
    // Clean the URL to the hash route (removes ?invite= from the address bar)
    history.replaceState(null, '', `${location.pathname}#join`);
  }

  // Silent token refresh if session data exists but in-memory token is gone
  if (store.isLoggedIn() && !auth.getToken()) {
    try {
      const storedRefresh = sessionStorage.getItem('spinx_refresh');
      const res = await authApi.refreshToken(
        storedRefresh ? { refreshToken: storedRefresh } : undefined
      );
      if (res.accessToken) auth.setToken(res.accessToken);
      if (res.refreshToken) sessionStorage.setItem('spinx_refresh', res.refreshToken);
    } catch {
      store.clear();
    }
  }

  window.addEventListener('hashchange', handleRoute);
  await handleRoute();
}

init();
