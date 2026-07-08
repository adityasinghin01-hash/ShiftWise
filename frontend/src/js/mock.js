/* ── SHIFTWISE MOCK DATA LAYER ── */
/* Activated when: sessionStorage.getItem('shiftwise_mock') === 'true'
   OR import.meta.env.VITE_MOCK_API === 'true'
   Intercepts all api.js calls and returns plausible fake data.       */

const ENABLED =
  sessionStorage.getItem('shiftwise_mock') === 'true' || import.meta.env.VITE_MOCK_API === 'true';

export const isMockMode = () => ENABLED;

/* ── tiny delay to simulate network ── */
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const ok = (data) => ({ success: true, data });

/* ──────────────────────────────────────────────
   MOCK DATA FIXTURES
   ────────────────────────────────────────────── */

const MOCK_USERS = [
  {
    _id: 'u1',
    email: 'admin@shiftwise.dev',
    name: 'Aditya Singh',
    role: 'admin',
    isVerified: true,
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    _id: 'u2',
    email: 'priya.sharma@example.com',
    name: 'Priya Sharma',
    role: 'user',
    isVerified: true,
    createdAt: '2026-02-03T08:20:00Z',
  },
  {
    _id: 'u3',
    email: 'rahul.dev@example.com',
    name: 'Rahul Dev',
    role: 'moderator',
    isVerified: true,
    createdAt: '2026-02-18T14:30:00Z',
  },
  {
    _id: 'u4',
    email: 'sneha.gupta@example.com',
    name: 'Sneha Gupta',
    role: 'user',
    isVerified: false,
    createdAt: '2026-03-05T09:10:00Z',
  },
  {
    _id: 'u5',
    email: 'vikram.anand@example.com',
    name: 'Vikram Anand',
    role: 'user',
    isVerified: true,
    createdAt: '2026-03-22T11:45:00Z',
  },
  {
    _id: 'u6',
    email: 'nisha.patel@example.com',
    name: 'Nisha Patel',
    role: 'user',
    isVerified: true,
    createdAt: '2026-04-10T07:25:00Z',
  },
];

const MOCK_API_KEYS = [
  {
    _id: 'k1',
    name: 'Production Server',
    prefix: 'sk_live_aX9',
    permissions: ['read', 'write'],
    createdAt: '2026-03-01T00:00:00Z',
    lastUsed: '2026-05-08T18:22:00Z',
  },
  {
    _id: 'k2',
    name: 'CI Pipeline',
    prefix: 'sk_live_bZ4',
    permissions: ['read'],
    createdAt: '2026-04-10T00:00:00Z',
    lastUsed: '2026-05-07T12:00:00Z',
  },
  {
    _id: 'k3',
    name: 'Analytics Dashboard',
    prefix: 'sk_live_cM7',
    permissions: ['read', 'admin'],
    createdAt: '2026-04-28T00:00:00Z',
    lastUsed: null,
  },
];

const MOCK_WEBHOOKS = [
  {
    _id: 'w1',
    url: 'https://hooks.zapier.com/catch/12345/abcde',
    events: ['user.signup', 'user.login'],
    description: 'Zapier Integration',
    isActive: true,
    createdAt: '2026-03-15T00:00:00Z',
    lastTriggered: '2026-05-08T17:00:00Z',
    failureCount: 0,
  },
  {
    _id: 'w2',
    url: 'https://api.slack.com/hooks/T01234/B56789/abcdefgh',
    events: ['user.signup'],
    description: 'Slack Notifications',
    isActive: true,
    createdAt: '2026-04-01T00:00:00Z',
    lastTriggered: '2026-05-07T09:30:00Z',
    failureCount: 1,
  },
  {
    _id: 'w3',
    url: 'https://webhook.site/abcd-1234',
    events: ['user.login', 'user.logout', 'user.deleted'],
    description: 'Testing Endpoint',
    isActive: false,
    createdAt: '2026-04-20T00:00:00Z',
    lastTriggered: null,
    failureCount: 0,
  },
];

/* ──────────────────────────────────────────────
   MOCK IMPLEMENTATIONS (mirror api.js shape)
   ────────────────────────────────────────────── */

export const mockAuthApi = {
  login: async ({ email, password }) => {
    await delay();
    if (email && password) {
      return {
        accessToken: 'mock_access_token_' + Date.now(),
        refreshToken: 'mock_refresh_token_' + Date.now(),
        user: { _id: 'mock001', email, name: email.split('@')[0], role: 'admin', isVerified: true },
      };
    }
    throw { status: 401, message: 'Invalid credentials' };
  },
  signup: async () => {
    await delay();
    return ok({ message: 'Verification email sent.' });
  },
  logout: async () => {
    await delay();
    return ok({ message: 'Logged out.' });
  },
  refreshToken: async () => {
    await delay();
    return { accessToken: 'mock_token_' + Date.now(), refreshToken: 'mock_refresh_' + Date.now() };
  },
  verifyEmail: async () => {
    await delay();
    return ok({ message: 'Email verified.' });
  },
  resendVerification: async () => {
    await delay();
    return ok({ message: 'Email sent.' });
  },
  checkVerificationStatus: async () => {
    await delay();
    return ok({ isVerified: true });
  },
  forgotPassword: async () => {
    await delay();
    return ok({ message: 'If that email exists, a reset link was sent.' });
  },
  sendOtp: async () => {
    await delay();
    return ok({ message: 'OTP sent.' });
  },
  verifyOtp: async () => {
    await delay();
    return ok({ resetToken: 'mock_reset_token_abc123' });
  },
  resetPassword: async () => {
    await delay();
    return ok({ message: 'Password reset successfully.' });
  },
  googleLogin: async () => {
    await delay();
    return {
      accessToken: 'mock_access_token_' + Date.now(),
      user: {
        _id: 'mock001',
        email: 'mock@google.com',
        name: 'Mock User',
        role: 'user',
        isVerified: true,
      },
    };
  },
  googleSignup: async () => {
    await delay();
    return {
      accessToken: 'mock_access_token_' + Date.now(),
      user: {
        _id: 'mock002',
        email: 'new@google.com',
        name: 'New User',
        role: 'user',
        isVerified: true,
      },
    };
  },
};

export const mockProfileApi = {
  getProfile: async () => {
    await delay();
    return ok({
      _id: 'mock001',
      email: 'admin@shiftwise.dev',
      name: 'Aditya Singh',
      role: 'admin',
      isVerified: true,
      provider: 'local',
      picture: null,
      createdAt: '2026-01-15T10:00:00Z',
    });
  },
  updateProfile: async (body) => {
    await delay();
    return ok({ ...body, _id: 'mock001' });
  },
  changePassword: async () => {
    await delay();
    return ok({ message: 'Password changed.' });
  },
  listSessions: async () => {
    await delay();
    return ok({
      count: 1,
      sessions: [
        { id: 'mock_session_1', deviceInfo: 'Mock Browser', createdAt: new Date().toISOString() },
      ],
    });
  },
  revokeSession: async () => {
    await delay();
    return ok({ message: 'Session revoked.' });
  },
  revokeAllOtherSessions: async () => {
    await delay();
    return ok({ message: 'All other sessions revoked.' });
  },
  getDashboard: async () => {
    await delay();
    return ok({
      totalLogins: 1_284,
      apiCalls: 47_392,
      activeApiKeys: 3,
      webhooks: 3,
      loginChange: '+12%',
      apiChange: '+34%',
      plan: 'pro',
      recentActivity: [
        {
          icon: '🔐',
          label: 'Login from Chrome / macOS',
          type: 'login',
          badgeClass: 'badge-purple',
          time: '2 min ago',
        },
        {
          icon: '⚡',
          label: 'API key used — Production Server',
          type: 'api',
          badgeClass: 'badge-cyan',
          time: '18 min ago',
        },
        {
          icon: '🔔',
          label: 'Webhook fired — user.signup',
          type: 'webhook',
          badgeClass: 'badge-green',
          time: '1 hr ago',
        },
        {
          icon: '🔑',
          label: 'New API key generated — CI Pipeline',
          type: 'key',
          badgeClass: 'badge-yellow',
          time: '3 hr ago',
        },
      ],
    });
  },
};

export const mockApiKeyApi = {
  list: async () => {
    await delay();
    return ok(MOCK_API_KEYS);
  },
  create: async ({ name, permissions }) => {
    await delay(600);
    const key = `sk_live_${Math.random().toString(36).slice(2, 14)}`;
    const newKey = {
      _id: 'k_new_' + Date.now(),
      name,
      permissions,
      prefix: key.slice(0, 12),
      createdAt: new Date().toISOString(),
      lastUsed: null,
    };
    MOCK_API_KEYS.push(newKey);
    return ok({
      key,
      keyId: newKey._id,
      message: 'Store this key securely — it will not be shown again.',
    });
  },
  revoke: async (id) => {
    await delay();
    const idx = MOCK_API_KEYS.findIndex((k) => k._id === id);
    if (idx > -1) MOCK_API_KEYS.splice(idx, 1);
    return ok({ message: 'Key revoked.' });
  },
  rotate: async (id) => {
    await delay(600);
    const newKey = `sk_live_${Math.random().toString(36).slice(2, 14)}`;
    const k = MOCK_API_KEYS.find((k) => k._id === id);
    if (k) k.prefix = newKey.slice(0, 12);
    return ok({ key: newKey, keyId: id, message: 'Key rotated.' });
  },
};

export const mockWebhookApi = {
  list: async () => {
    await delay();
    return ok(MOCK_WEBHOOKS);
  },
  create: async (body) => {
    await delay(500);
    const w = {
      _id: 'w_' + Date.now(),
      ...body,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastTriggered: null,
      failureCount: 0,
    };
    MOCK_WEBHOOKS.push(w);
    return ok(w);
  },
  update: async (id, body) => {
    await delay();
    const w = MOCK_WEBHOOKS.find((w) => w._id === id);
    if (w) Object.assign(w, body);
    return ok(w);
  },
  delete: async (id) => {
    await delay();
    const idx = MOCK_WEBHOOKS.findIndex((w) => w._id === id);
    if (idx > -1) MOCK_WEBHOOKS.splice(idx, 1);
    return ok({ message: 'Deleted.' });
  },
  test: async (id) => {
    await delay(800);
    return ok({ message: 'Test payload sent successfully.', status: 200 });
  },
};

export const mockAdminApi = {
  getStats: async () => {
    await delay();
    return ok({
      totalUsers: MOCK_USERS.length,
      verifiedUsers: MOCK_USERS.filter((u) => u.isVerified).length,
      activeSubscriptions: 4,
      apiKeys: MOCK_API_KEYS.length,
      webhooks: MOCK_WEBHOOKS.filter((w) => w.isActive).length,
    });
  },
  listUsers: async (page = 1, query = '') => {
    await delay();
    const filtered = query
      ? MOCK_USERS.filter(
          (u) => u.email.includes(query) || u.name?.toLowerCase().includes(query.toLowerCase())
        )
      : MOCK_USERS;
    return ok({ users: filtered, pagination: { total: filtered.length, page, totalPages: 1 } });
  },
  getUser: async (id) => {
    await delay();
    return ok(MOCK_USERS.find((u) => u._id === id));
  },
  updateRole: async (id, role) => {
    await delay();
    const u = MOCK_USERS.find((u) => u._id === id);
    if (u) u.role = role;
    return ok({ message: 'Role updated.' });
  },
  banUser: async (id, isBanned) => {
    await delay();
    const u = MOCK_USERS.find((u) => u._id === id);
    if (u) u.isBanned = isBanned;
    return ok({ message: isBanned ? 'User banned.' : 'User unbanned.' });
  },
  deleteUser: async (id) => {
    await delay();
    const idx = MOCK_USERS.findIndex((u) => u._id === id);
    if (idx > -1) MOCK_USERS.splice(idx, 1);
    return ok({ message: 'User deleted.' });
  },
};

export const mockSubscriptionApi = {
  getPlans: async () => {
    await delay();
    return ok([
      {
        name: 'free',
        displayName: 'Free',
        price: 0,
        currency: 'USD',
        billingPeriod: 'monthly',
        features: ['1,000 API calls/mo', '1 API key', '1 webhook', '1 GB storage'],
        limits: { apiCallsPerMonth: 1000, maxApiKeys: 1, webhooksAllowed: 1, storageGB: 1 },
      },
      {
        name: 'pro',
        displayName: 'Pro',
        price: 29,
        currency: 'USD',
        billingPeriod: 'monthly',
        features: [
          '100,000 API calls/mo',
          '10 API keys',
          '10 webhooks',
          '50 GB storage',
          'Priority support',
        ],
        limits: { apiCallsPerMonth: 100000, maxApiKeys: 10, webhooksAllowed: 10, storageGB: 50 },
      },
      {
        name: 'enterprise',
        displayName: 'Enterprise',
        price: 199,
        currency: 'USD',
        billingPeriod: 'monthly',
        features: [
          'Unlimited API calls',
          'Unlimited API keys',
          'Unlimited webhooks',
          '500 GB storage',
          'Dedicated support',
          'SLA',
        ],
        limits: { apiCallsPerMonth: -1, maxApiKeys: -1, webhooksAllowed: -1, storageGB: 500 },
      },
    ]);
  },
  getCurrent: async () => {
    await delay();
    return ok({
      plan: 'pro',
      displayName: 'Pro',
      price: 29,
      renewsAt: '2026-06-15T00:00:00Z',
      status: 'active',
    });
  },
  changePlan: async (planName) => {
    await delay(800);
    return ok({ message: `Plan changed to ${planName}.` });
  },
  getUsage: async () => {
    await delay();
    return ok({
      apiCallsUsed: 47392,
      apiCallsLimit: 100000,
      apiKeysCount: 3,
      webhooksCount: 3,
      storageUsedGB: 2.4,
      storageGB: 50,
    });
  },
};

export const mockHealthApi = {
  check: async () => {
    await delay(100);
    return { status: 'ok', uptime: 99.9 };
  },
  deep: async () => {
    await delay(200);
    return { status: 'ok', db: 'connected', cache: 'connected', uptime: 99.9 };
  },
};
