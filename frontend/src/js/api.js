/* ── SPINX API CLIENT ── */

import {
  isMockMode,
  mockAuthApi,
  mockProfileApi,
  mockApiKeyApi,
  mockWebhookApi,
  mockAdminApi,
  mockSubscriptionApi,
  mockHealthApi,
} from './mock.js';

const BASE = import.meta.env.VITE_API_URL || '/api/v1';
const HEALTH_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace('/api/v1', '/api')
  : '/api';

let _accessToken = null;

export const auth = {
  setToken: (t) => {
    _accessToken = t;
  },
  getToken: () => _accessToken,
  clear: () => {
    _accessToken = null;
  },
};

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function request(path, opts = {}) {
  const { body, method = 'GET', apiKey, base = BASE } = opts;

  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Id': uuidv4(),
  };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;
  if (apiKey) headers['X-API-Key'] = apiKey;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    credentials: 'include', // send httpOnly cookie for refresh token
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || 60;
    throw new ApiError(429, `Rate limited. Try again in ${retryAfter}s.`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new ApiError(res.status, data.message || 'Request failed', data);
  }

  return data;
}

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/* ── AUTH ── */
export const authApi = isMockMode()
  ? mockAuthApi
  : {
      signup: (body) => request('/signup', { method: 'POST', body }),
      login: (body) => request('/login', { method: 'POST', body }),
      googleLogin: (body) => request('/google-login', { method: 'POST', body }),
      googleSignup: (body) => request('/google-signup', { method: 'POST', body }),
      logout: (body) => request('/logout', { method: 'POST', body }),
      refreshToken: (body) => request('/refresh-token', { method: 'POST', body }),
      verifyEmail: (token) => request(`/verify-email?token=${encodeURIComponent(token)}`),
      resendVerification: (body) => request('/resend-verification', { method: 'POST', body }),
      checkVerificationStatus: (email) =>
        request(`/check-verification-status?email=${encodeURIComponent(email)}`),
      // Password reset — OTP flow
      forgotPassword: (body) => request('/password/forgot', { method: 'POST', body }),
      sendOtp: (body) => request('/password/send-otp', { method: 'POST', body }),
      verifyOtp: (body) => request('/password/verify-otp', { method: 'POST', body }),
      resetPassword: (body) => request('/password/reset', { method: 'POST', body }),
    };

/* ── PROFILE / DASHBOARD ── */
export const profileApi = isMockMode()
  ? mockProfileApi
  : {
      getProfile: () => request('/profile', { method: 'GET' }),
      updateProfile: (body) => request('/profile', { method: 'PUT', body }),
      changePassword: (body) => request('/change-password', { method: 'POST', body }),
      getDashboard: () => request('/dashboard', { method: 'GET' }),
      listSessions: () => request('/sessions', { method: 'GET' }),
      revokeSession: (id) => request(`/sessions/${id}`, { method: 'DELETE' }),
      revokeAllOtherSessions: (body) => request('/sessions', { method: 'DELETE', body }),
    };

/* ── MFA ── */
export const mfaApi = {
  setup: () => request('/mfa/setup', { method: 'POST' }),
  verifySetup: (body) => request('/mfa/verify-setup', { method: 'POST', body }),
  disable: (body) => request('/mfa/disable', { method: 'POST', body }),
  regenerateBackupCodes: () => request('/mfa/backup-codes', { method: 'POST' }),
  mfaLogin: (body) => request('/mfa/login', { method: 'POST', body }),
};

/* ── ADMIN ── */
export const adminApi = isMockMode()
  ? mockAdminApi
  : {
      getStats: () => request('/admin/stats'),
      listUsers: (page = 1, query = '') => request(`/admin/users?page=${page}&search=${query}`),
      getUser: (id) => request(`/admin/users/${id}`),
      updateRole: (id, role) =>
        request(`/admin/users/${id}/role`, { method: 'PUT', body: { role } }),
      banUser: (id, isBanned) =>
        request(`/admin/users/${id}/ban`, { method: 'PUT', body: { isBanned } }),
      deleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
    };

/* ── SUBSCRIPTIONS ── */
export const subscriptionApi = isMockMode()
  ? mockSubscriptionApi
  : {
      getPlans: () => request('/subscriptions/plans'),
      getCurrent: () => request('/subscriptions/current'),
      changePlan: (planName) =>
        request('/subscriptions/change', { method: 'PUT', body: { planName } }),
      getUsage: () => request('/subscriptions/usage'),
    };

/* ── API KEYS ── */
export const apiKeyApi = isMockMode()
  ? mockApiKeyApi
  : {
      list: () => request('/apikeys'),
      create: (body) => request('/apikeys', { method: 'POST', body }),
      revoke: (id) => request(`/apikeys/${id}`, { method: 'DELETE' }),
      rotate: (id) => request(`/apikeys/${id}/rotate`, { method: 'POST' }),
    };

/* ── WEBHOOKS ── */
export const webhookApi = isMockMode()
  ? mockWebhookApi
  : {
      list: () => request('/webhooks'),
      create: (body) => request('/webhooks', { method: 'POST', body }),
      update: (id, body) => request(`/webhooks/${id}`, { method: 'PUT', body }),
      delete: (id) => request(`/webhooks/${id}`, { method: 'DELETE' }),
      test: (id) => request(`/webhooks/${id}/test`, { method: 'POST' }),
    };

/* ── HEALTH ── */
export const healthApi = isMockMode()
  ? mockHealthApi
  : {
      check: () => request('/health', { base: HEALTH_BASE }),
      deep: () => request('/health/deep', { base: HEALTH_BASE }),
    };

/* ── SHIFTWISE: BUSINESS (Phase 1) ── */
export const businessApi = {
  create: (body) => request('/business', { method: 'POST', body }),
  get: () => request('/business', { method: 'GET' }),
  update: (body) => request('/business', { method: 'PUT', body }),
};

/* ── SHIFTWISE: LOCATIONS (Phase 1) ── */
export const locationApi = {
  list: () => request('/locations', { method: 'GET' }),
  create: (body) => request('/locations', { method: 'POST', body }),
  get: (id) => request(`/locations/${id}`, { method: 'GET' }),
  update: (id, body) => request(`/locations/${id}`, { method: 'PUT', body }),
  remove: (id) => request(`/locations/${id}`, { method: 'DELETE' }),
};

/* ── SHIFTWISE: STAFF (Phase 2) ── */
export const staffApi = {
  list: () => request('/staff', { method: 'GET' }),
  create: (body) => request('/staff', { method: 'POST', body }),
  bulk: (body) => request('/staff/bulk', { method: 'POST', body }),
  update: (id, body) => request(`/staff/${id}`, { method: 'PUT', body }),
  remove: (id) => request(`/staff/${id}`, { method: 'DELETE' }),
  invite: (id) => request(`/staff/${id}/invite`, { method: 'POST' }),
  notify: (id, body) => request(`/staff/${id}/notify`, { method: 'POST', body }),
};

/* ── SHIFTWISE: JOIN (Phase 2, public) ── */
export const joinApi = {
  validate: (token) => request(`/join/validate?token=${encodeURIComponent(token)}`, { method: 'GET' }),
  accept: (body) => request('/join/accept', { method: 'POST', body }),
  completeProfile: (body) => request('/join/complete-profile', { method: 'POST', body }),
};

/* ── SHIFTWISE: AVAILABILITY (Phase 3) ── */
export const availabilityApi = {
  getMine: () => request('/my/availability', { method: 'GET' }),
  setRecurring: (recurring) => request('/my/availability', { method: 'PUT', body: { recurring } }),
  setOverride: (body) => request('/my/availability/override', { method: 'PUT', body }),
  locationOverview: (locationId, weekOf) =>
    request(`/locations/${locationId}/availability${weekOf ? `?weekOf=${encodeURIComponent(weekOf)}` : ''}`, { method: 'GET' }),
  requestOverride: (staffId, body) => request(`/availability/${staffId}/override-request`, { method: 'POST', body }),
  reviewOverride: (id, decision) => request(`/availability/override-request/${id}`, { method: 'PUT', body: { decision } }),
};

/* ── SHIFTWISE: SCHEDULES + SHIFTS (Phase 4) ── */
export const scheduleApi = {
  create: (body) => request('/schedules', { method: 'POST', body }),
  get: (id) => request(`/schedules/${id}`, { method: 'GET' }),
  generate: (id) => request(`/schedules/${id}/generate`, { method: 'POST', body: {} }),
  apply: (id, body) => request(`/schedules/${id}/apply`, { method: 'POST', body }),
  publish: (id) => request(`/schedules/${id}/publish`, { method: 'POST', body: {} }),
  copy: (id, fromScheduleId) => request(`/schedules/${id}/copy`, { method: 'POST', body: { fromScheduleId } }),
  addShift: (id, body) => request(`/schedules/${id}/shifts`, { method: 'POST', body }),
  listTemplates: (locationId) => request(`/locations/${locationId}/templates`, { method: 'GET' }),
  saveTemplate: (id, name) => request(`/schedules/${id}/save-template`, { method: 'POST', body: { name } }),
  loadTemplate: (id, templateId) => request(`/schedules/${id}/load-template`, { method: 'POST', body: { templateId } }),
};

export const shiftApi = {
  update: (id, body) => request(`/shifts/${id}`, { method: 'PUT', body }),
  remove: (id) => request(`/shifts/${id}`, { method: 'DELETE' }),
  attendance: (id, status) => request(`/shifts/${id}/attendance`, { method: 'POST', body: { status } }),
  markAbsent: (id) => request(`/shifts/${id}/absent`, { method: 'POST', body: {} }),
  assignCover: (id, body) => request(`/shifts/${id}/cover/assign`, { method: 'POST', body }),
};

/* ── SHIFTWISE: STAFF PORTAL (Phase 6) ── */
export const staffPortalApi = {
  myShifts: (weekOf) =>
    request(`/my/shifts${weekOf ? `?weekOf=${encodeURIComponent(weekOf)}` : ''}`, { method: 'GET' }),
  acknowledge: (id) => request(`/my/shifts/${id}/acknowledge`, { method: 'POST', body: {} }),
  dispute: (id, reason) => request(`/my/shifts/${id}/dispute`, { method: 'POST', body: { reason } }),
  myMetrics: () => request('/my/metrics', { method: 'GET' }),
};

/* ── SHIFTWISE: MANAGER DASHBOARD (Phase 7) ── */
export const dashboardApi = {
  // location: 'all' | locationId
  get: (location = 'all') =>
    request(`/manager/dashboard?location=${encodeURIComponent(location)}`, { method: 'GET' }),
  // Inline approve/deny reuse the Phase 5 review endpoints:
  reviewTimeOff: (id, decision) =>
    request(`/timeoff/${id}/review`, { method: 'PUT', body: { decision } }),
  reviewSwap: (id, decision) => request(`/swaps/${id}/review`, { method: 'PUT', body: { decision } }),
};

/* ── SHIFTWISE: ANALYTICS (Phase 8) ── */
export const analyticsApi = {
  get: (location = 'all', month) =>
    request(`/analytics?location=${encodeURIComponent(location)}${month ? `&month=${month}` : ''}`, { method: 'GET' }),
  awardBadge: (staffId, badge, message) =>
    request('/analytics/badges', { method: 'POST', body: { staffId, badge, message } }),
};
