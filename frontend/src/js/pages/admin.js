/* ── SHIFTWISE ADMIN PANEL ── */

import { adminApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

let currentPage = 1;
let activeTab = 'users';

export async function renderAdmin() {
  mountLayout(
    `
    <div class="page-header">
      <h1 class="page-title">Admin Panel</h1>
      <p class="page-subtitle">Platform management and user administration</p>
    </div>
    <div class="tabs" id="admin-tabs">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="users">Users</button>
      <button class="tab" data-tab="audit">Audit Logs</button>
    </div>
    <div id="admin-content">
      <div class="card skeleton" style="height:300px"></div>
    </div>
  `,
    'admin'
  );

  document.querySelectorAll('#admin-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#admin-tabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      loadTab(activeTab);
    });
  });

  await loadTab('overview');
}

async function loadTab(tab) {
  const el = document.getElementById('admin-content');
  if (!el) return;
  el.innerHTML = '<div class="card skeleton" style="height:300px"></div>';

  if (tab === 'overview') await loadOverview();
  else if (tab === 'users') await loadUsers();
  else if (tab === 'audit') await loadAuditLogs();
}

/* ── OVERVIEW ── */
async function loadOverview() {
  try {
    const res = await adminApi.getStats();
    const s = res.data || {};
    document.getElementById('admin-content').innerHTML = `
      <div class="stats-grid">
        ${statCard('Total Users', s.totalUsers ?? '—', 'var(--primary)')}
        ${statCard('Verified Users', s.verifiedUsers ?? '—', 'var(--success)')}
        ${statCard('Active Subscriptions', s.activeSubscriptions ?? '—', 'var(--accent)')}
        ${statCard('API Keys Issued', s.apiKeys ?? '—', '#34d399')}
        ${statCard('Webhooks Active', s.webhooks ?? '—', '#fb923c')}
      </div>`;
  } catch (err) {
    document.getElementById('admin-content').innerHTML = errorState(err.message);
  }
}

/* ── USERS ── */
async function loadUsers(page = 1, query = '') {
  currentPage = page;
  try {
    const res = await adminApi.listUsers(page, query);
    const users = res.data?.users || res.data || [];
    const pagination = res.data?.pagination || {};
    renderUsers(users, pagination, query);
  } catch (err) {
    document.getElementById('admin-content').innerHTML = errorState(err.message);
  }
}

function renderUsers(users, pagination, query = '') {
  const el = document.getElementById('admin-content');
  if (!el) return;
  const totalPages = pagination.totalPages || 1;

  el.innerHTML = `
    <div class="card mb-4" style="margin-bottom:12px">
      <div style="display:flex;gap:10px">
        <input class="form-input" id="user-search" type="search" placeholder="Search by email…" value="${query}" style="max-width:360px" />
        <button class="btn btn-secondary" id="do-search">Search</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Verified</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            ${
              users.length
                ? users
                    .map(
                      (u) => `
            <tr>
              <td>${u.email}</td>
              <td>${u.name || '—'}</td>
              <td><span class="badge ${u.role === 'admin' ? 'badge-purple' : 'badge-cyan'}">${u.role || 'user'}</span></td>
              <td><span class="status-dot ${u.isVerified ? 'online' : 'offline'}"></span> ${u.isVerified ? 'Yes' : 'No'}</td>
              <td class="text-muted text-sm">${fmtDate(u.createdAt)}</td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-ghost btn-sm" data-promote="${u._id}" data-role="${u.role}">
                    ${u.role === 'admin' ? 'Demote' : 'Promote'}
                  </button>
                  <button class="btn btn-danger btn-sm" data-del-user="${u._id}">Delete</button>
                </div>
              </td>
            </tr>`
                    )
                    .join('')
                : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">No users found</td></tr>'
            }
          </tbody>
        </table>
      </div>
      ${
        totalPages > 1
          ? `
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
        <button class="btn btn-secondary btn-sm" id="u-prev" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="text-sm text-muted" style="line-height:32px">Page ${currentPage} / ${totalPages}</span>
        <button class="btn btn-secondary btn-sm" id="u-next" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
      </div>`
          : ''
      }
    </div>`;

  document.getElementById('do-search').addEventListener('click', () => {
    loadUsers(1, document.getElementById('user-search').value.trim());
  });
  document.getElementById('user-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUsers(1, e.target.value.trim());
  });
  document
    .getElementById('u-prev')
    ?.addEventListener('click', () => loadUsers(currentPage - 1, query));
  document
    .getElementById('u-next')
    ?.addEventListener('click', () => loadUsers(currentPage + 1, query));

  el.querySelectorAll('[data-promote]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newRole = btn.dataset.role === 'admin' ? 'user' : 'admin';
      if (!confirm(`Change this user's role to ${newRole}?`)) return;
      try {
        await adminApi.updateRole(btn.dataset.promote, newRole);
        toast(`User role changed to ${newRole}`, 'success');
        loadUsers(currentPage, query);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  el.querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Permanently delete this user? This cannot be undone.')) return;
      try {
        await adminApi.deleteUser(btn.dataset.delUser);
        toast('User deleted', 'success');
        loadUsers(currentPage, query);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ── AUDIT LOGS ── */
async function loadAuditLogs() {
  // Audit log endpoint not yet implemented in backend — show placeholder
  document.getElementById('admin-content').innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">Audit Logs Coming Soon</div>
      <div class="empty-state-desc">Server-side audit log endpoint is not yet available in this build.</div>
    </div>`;
}

/* ── HELPERS ── */
function statCard(label, value, color) {
  return `
  <div class="stat-card">
    <div class="stat-label">${label}</div>
    <div class="stat-value" style="background:linear-gradient(135deg,${color},var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${value}</div>
  </div>`;
}

function errorState(msg) {
  return `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Error loading data</div><div class="empty-state-desc">${msg}</div></div>`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
