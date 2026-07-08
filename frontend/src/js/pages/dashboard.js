/* ── SHIFTWISE DASHBOARD ──
 * Owner → manager cockpit (S2, §9 Phase 7): KPI tiles, location switcher, today
 * strip, needs-attention queue with inline approve/deny, and a setup checklist.
 * Staff → a light home that points at their own screens.
 */

import { dashboardApi, healthApi } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

function esc(s = '') {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

let currentScope = 'all';

export async function renderDashboard() {
  // Staff get a simple home; managers get the cockpit.
  if (store.membership === 'staff') return renderStaffHome();
  return renderManagerCockpit();
}

/* ─────────────────────────── STAFF ─────────────────────────── */
function renderStaffHome() {
  const html = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Welcome, ${esc(store.name || '')} 👋</h1>
          <p class="page-subtitle">Here's where you manage your work</p>
        </div>
      </div>
    </div>
    <div class="stats-grid">
      <a class="stat-card" href="#my-shifts" style="text-decoration:none">
        <div class="stat-label">My Shifts</div>
        <div class="stat-value">View →</div>
      </a>
      <a class="stat-card" href="#my-availability" style="text-decoration:none">
        <div class="stat-label">My Availability</div>
        <div class="stat-value">Edit →</div>
      </a>
    </div>`;
  mountLayout(html, 'dashboard');
}

/* ────────────────────────── MANAGER ────────────────────────── */
function renderManagerCockpit() {
  const html = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Good to see you, ${esc(store.name || '')} 👋</p>
        </div>
        <div class="page-actions" style="display:flex;gap:12px;align-items:center">
          <select id="loc-switch" class="input" style="min-width:150px"></select>
          <span class="status-dot online" id="health-dot"></span>
          <span id="health-label" class="text-sm text-muted">Checking…</span>
        </div>
      </div>
    </div>
    <div id="dash-content"><div class="stats-grid">${Array(4).fill('<div class="stat-card skeleton-card skeleton"></div>').join('')}</div></div>
  `;
  mountLayout(html, 'dashboard');

  healthApi.check()
    .then(() => { const d=document.getElementById('health-dot'), l=document.getElementById('health-label'); if(d)d.className='status-dot online'; if(l)l.textContent='API Online'; })
    .catch(() => { const d=document.getElementById('health-dot'), l=document.getElementById('health-label'); if(d)d.className='status-dot offline'; if(l)l.textContent='API Offline'; });

  load();
}

async function load() {
  const el = document.getElementById('dash-content');
  try {
    const res = await dashboardApi.get(currentScope);
    renderCockpit(res.data);
  } catch (err) {
    if (el) el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">Couldn't load the dashboard</div>
      <div class="empty-state-desc">${esc(err.message || '')}</div></div>`;
  }
}

function tile({ label, value, tone = 'var(--primary)' }) {
  return `<div class="stat-card">
    <div class="stat-label">${label}</div>
    <div class="stat-value" style="color:${tone}">${value}</div>
  </div>`;
}

function renderCockpit(d) {
  const el = document.getElementById('dash-content');
  if (!el) return;
  const k = d.kpis || {};
  const na = d.needsAttention || { timeOff: [], swaps: [], disputes: [] };
  const cl = d.checklist || {};

  // Populate the location switcher once
  const sw = document.getElementById('loc-switch');
  if (sw && !sw.dataset.filled) {
    sw.innerHTML =
      `<option value="all">All locations</option>` +
      (d.locations || []).map((l) => `<option value="${l._id}">${esc(l.name)}</option>`).join('');
    sw.value = currentScope;
    sw.dataset.filled = '1';
    sw.addEventListener('change', () => { currentScope = sw.value; load(); });
  }

  const relTone = k.avgReliability >= 70 ? 'var(--success)' : k.avgReliability >= 40 ? 'var(--warning)' : 'var(--danger)';
  const attnCount = na.timeOff.length + na.swaps.length + na.disputes.length;

  el.innerHTML = `
  <div class="stats-grid">
    ${tile({ label: 'Active staff', value: k.activeStaff ?? '—' })}
    ${tile({ label: 'Pending requests', value: k.pendingRequests ?? 0, tone: (k.pendingRequests ? 'var(--warning)' : 'var(--primary)') })}
    ${tile({ label: 'Open disputes', value: k.openDisputes ?? 0, tone: (k.openDisputes ? 'var(--danger)' : 'var(--primary)') })}
    ${tile({ label: 'Avg reliability', value: k.avgReliability ?? '—', tone: relTone })}
  </div>

  <div class="bento-grid" style="margin-top:16px">
    <!-- Needs attention -->
    <div class="card bento-half">
      <div class="card-header"><span class="card-title">Needs attention ${attnCount ? `<span class="badge badge-danger">${attnCount}</span>` : ''}</span></div>
      <div id="attn-list">
        ${attnCount === 0 ? `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">All clear</div><div class="empty-state-desc">No pending requests or disputes.</div></div>` : `
          ${na.timeOff.map(timeOffRow).join('')}
          ${na.swaps.map(swapRow).join('')}
          ${na.disputes.map(disputeRow).join('')}
        `}
      </div>
    </div>

    <!-- Today + checklist -->
    <div class="bento-half" style="display:flex;flex-direction:column;gap:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Today · ${k.todayShifts ?? 0} shift(s)</span></div>
        ${(d.today || []).length ? (d.today.map(todayRow).join('')) : `<div class="page-subtitle">Nobody scheduled today.</div>`}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Setup checklist</span></div>
        ${checkItem('Create a location', cl.hasLocation)}
        ${checkItem('Add staff', cl.hasStaff)}
        ${checkItem('Collect availability', cl.hasAvailability)}
        ${checkItem('Publish a schedule', cl.hasPublishedSchedule)}
      </div>
    </div>
  </div>`;

  // Wire inline approve/deny
  el.querySelectorAll('[data-to-approve]').forEach((b) => b.addEventListener('click', () => reviewTO(b.dataset.toApprove, 'approved')));
  el.querySelectorAll('[data-to-deny]').forEach((b) => b.addEventListener('click', () => reviewTO(b.dataset.toDeny, 'denied')));
  el.querySelectorAll('[data-sw-approve]').forEach((b) => b.addEventListener('click', () => reviewSwap(b.dataset.swApprove, 'approved')));
  el.querySelectorAll('[data-sw-deny]').forEach((b) => b.addEventListener('click', () => reviewSwap(b.dataset.swDeny, 'denied')));
}

function timeOffRow(r) {
  return `<div class="attn-row" style="padding:12px 0;border-bottom:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div>
        <strong>🌴 ${esc(r.staffName)}</strong> · time off
        <div class="page-subtitle" style="margin:2px 0 0">${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}${r.reason ? ` · ${esc(r.reason)}` : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" data-to-approve="${r._id}">Approve</button>
        <button class="btn btn-ghost btn-sm" data-to-deny="${r._id}">Deny</button>
      </div>
    </div></div>`;
}
function swapRow(r) {
  const s = r.shift;
  return `<div class="attn-row" style="padding:12px 0;border-bottom:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div>
        <strong>🔁 ${esc(r.requester)}</strong> → ${esc(r.target || 'open board')} · swap
        <div class="page-subtitle" style="margin:2px 0 0">${s ? `${fmtDate(s.date)} ${esc(s.startTime)}–${esc(s.endTime)}` : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" data-sw-approve="${r._id}">Approve</button>
        <button class="btn btn-ghost btn-sm" data-sw-deny="${r._id}">Deny</button>
      </div>
    </div></div>`;
}
function disputeRow(r) {
  return `<div class="attn-row" style="padding:12px 0;border-bottom:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div>
        <strong style="color:var(--danger)">⚠️ ${esc(r.staffName)}</strong> · disputed shift
        <div class="page-subtitle" style="margin:2px 0 0">${fmtDate(r.date)} ${esc(r.startTime)}–${esc(r.endTime)}${r.reason ? ` · "${esc(r.reason)}"` : ''}</div>
      </div>
      <a href="#schedule" class="btn btn-ghost btn-sm">Open schedule →</a>
    </div></div>`;
}
function todayRow(s) {
  return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
    <span>${esc(s.staffName)} · ${esc(s.shiftType)}</span>
    <span class="page-subtitle">${esc(s.startTime)}–${esc(s.endTime)} · ${esc(s.status)}</span>
  </div>`;
}
function checkItem(label, done) {
  return `<div style="display:flex;gap:10px;align-items:center;padding:6px 0">
    <span style="font-size:16px;color:${done ? 'var(--success)' : 'var(--muted)'}">${done ? '✓' : '○'}</span>
    <span style="${done ? 'color:var(--muted);text-decoration:line-through' : ''}">${label}</span>
  </div>`;
}

async function reviewTO(id, decision) {
  try {
    const res = await dashboardApi.reviewTimeOff(id, decision);
    const warn = res.data?.coverageWarning?.shifts?.length;
    toast(decision === 'approved' ? (warn ? `Approved — ${warn} shift(s) need cover` : 'Time-off approved') : 'Time-off denied', 'success');
    load();
  } catch (err) { toast(err.message || 'Failed', 'error'); }
}
async function reviewSwap(id, decision) {
  try {
    await dashboardApi.reviewSwap(id, decision);
    toast(decision === 'approved' ? 'Swap approved' : 'Swap denied', 'success');
    load();
  } catch (err) { toast(err.message || 'Failed', 'error'); }
}
