/* ── SPINX LAYOUT HELPER ── */
/* Provides mountLayout without circular imports from app.js */

import { store } from './store.js';
import { auth, authApi } from './api.js';
import { toast } from './toast.js';

const getApp = () => document.getElementById('app');

const logoSVG = `
  <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
    <rect width="48" height="48" rx="12" fill="url(#lg)"/>
    <path d="M16 24L22 30L32 18" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <defs><linearGradient id="lg" x1="0" y1="0" x2="48" y2="48">
      <stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient></defs>
  </svg>`;

function sidebarHTML(activeRoute) {
  const isAdmin = store.isAdmin();
  const isOwner = store.onboarding !== null
    ? store.membership === 'owner'
    : true; // default to showing manager nav until resolved

  // Items visible to the business owner/manager
  const managerItems = [
    { route: 'dashboard', label: 'Dashboard', icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { route: 'team', label: 'Team', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { route: 'availability', label: 'Availability', icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>' },
    { route: 'profile', label: 'Profile', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>' },
    { route: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  ];

  // Items visible to staff members only
  const staffItems = [
    { route: 'dashboard', label: 'My Dashboard', icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { route: 'my-availability', label: 'My Availability', icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>' },
    { route: 'profile', label: 'Profile', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>' },
  ];

  // Determine nav set: if user has a 'user' role they're a staff member (not an owner)
  // Owner accounts have role='user' too, but store.membership distinguishes them.
  // Use membership if available; fall back to checking if they're a platform admin.
  const useStaffNav = store.membership === 'staff';
  const navItems = useStaffNav ? staffItems : managerItems;

  function navLink({ route, label, icon }) {
    return `<a class="nav-link${activeRoute === route ? ' active' : ''}" href="#${route}" data-route="${route}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
      ${label}
    </a>`;
  }

  return `
  <aside class="sidebar">
    <div class="sidebar-logo">${logoSVG}<span>ShiftWise</span></div>
    <nav class="sidebar-nav">
      <span class="nav-section-title">${useStaffNav ? 'My Work' : 'Manage'}</span>
      ${navItems.map(navLink).join('')}
      ${isAdmin ? `
        <span class="nav-section-title">Admin</span>
        ${navLink({ route: 'admin', label: 'Admin Panel', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' })}
      ` : ''}
    </nav>
    <div class="sidebar-footer">
      <div class="user-pill" id="logout-btn">
        <div class="user-avatar">${store.initials}</div>
        <div class="user-info">
          <div class="user-name truncate">${store.name}</div>
          <div class="user-role">${useStaffNav ? 'Staff' : store.role}</div>
        </div>
      </div>
    </div>
  </aside>`;
}

export function mountLayout(contentHTML, activeRoute = null) {
  const route = activeRoute || location.hash.slice(1) || 'dashboard';
  getApp().innerHTML = `
    <div class="app-layout">
      ${sidebarHTML(route)}
      <main class="main-content" id="page-content">${contentHTML}</main>
    </div>`;

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    try {
      const storedRefresh = sessionStorage.getItem('spinx_refresh');
      await authApi.logout(storedRefresh ? { refreshToken: storedRefresh } : {});
    } catch {}
    auth.clear();
    store.clear();
    sessionStorage.removeItem('spinx_refresh');
    toast('Signed out', 'success');
    location.hash = 'login';
  });
}
