/* ── SPINX AUTH STATE STORE ── */

const KEY = 'spinx_user';

export const store = {
  user: null,
  onboarding: null,
  membership: null, // 'owner' | 'staff' | null — set after resolveBusiness or join

  load() {
    try {
      const raw = sessionStorage.getItem(KEY);
      this.user = raw ? JSON.parse(raw) : null;
    } catch {
      this.user = null;
    }
  },

  save(userData) {
    this.user = userData;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(userData));
    } catch {}
  },

  clear() {
    this.user = null;
    this.onboarding = null;
    this.membership = null;
    sessionStorage.removeItem(KEY);
  },

  /* Always reads fresh from sessionStorage so injected test data is picked up */
  isLoggedIn() {
    if (this.user) return true;
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        this.user = JSON.parse(raw);
        return true;
      }
    } catch {}
    return false;
  },

  isAdmin() {
    return this.user?.role === 'admin' || this.user?.role === 'superadmin';
  },
  get name() {
    return this.user?.name || this.user?.email?.split('@')[0] || 'User';
  },
  get email() {
    return this.user?.email || '';
  },
  get role() {
    return this.user?.role || 'user';
  },
  get initials() {
    const n = this.name;
    return n.length >= 2 ? n.slice(0, 2).toUpperCase() : n[0]?.toUpperCase() || '?';
  },
};
