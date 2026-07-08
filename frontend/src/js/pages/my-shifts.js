/* ── SHIFTWISE MY SHIFTS (staff) ──
 * S8 (UI Spec) · §9 Phase 6 — Staff Portal.
 * Staff see ONLY their own published shifts (with same-shift coworkers),
 * acknowledge or dispute them, and view their reliability score.
 */

import { staffPortalApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s = '') {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// The Sunday/Monday anchor the user is currently viewing (as YYYY-MM-DD).
let weekAnchor = ymd(new Date());

function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function shiftAnchor(days) {
  const d = new Date(weekAnchor + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  weekAnchor = ymd(d);
}
function fmtDay(dateStr) {
  const d = new Date(dateStr);
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const STATUS_LABEL = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  disputed: 'Disputed',
  absent: 'Absent',
  covered: 'Covered',
};

export async function renderMyShifts() {
  const contentHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">My Shifts</h1>
          <p class="page-subtitle">Your upcoming shifts — confirm them or flag a problem</p>
        </div>
      </div>
    </div>
    <div id="metrics-strip"></div>
    <div class="page-header-row" style="margin:16px 0;align-items:center;gap:12px">
      <button class="btn btn-ghost btn-sm" id="wk-prev">← Prev</button>
      <button class="btn btn-ghost btn-sm" id="wk-today">This week</button>
      <button class="btn btn-ghost btn-sm" id="wk-next">Next →</button>
      <span id="wk-label" class="page-subtitle" style="margin-left:8px"></span>
    </div>
    <div id="shifts-body"><div class="card skeleton" style="height:200px"></div></div>
  `;
  mountLayout(contentHTML, 'my-shifts');

  document.getElementById('wk-prev').addEventListener('click', () => { shiftAnchor(-7); load(); });
  document.getElementById('wk-next').addEventListener('click', () => { shiftAnchor(7); load(); });
  document.getElementById('wk-today').addEventListener('click', () => { weekAnchor = ymd(new Date()); load(); });

  loadMetrics();
  load();
}

async function loadMetrics() {
  try {
    const res = await staffPortalApi.myMetrics();
    const m = res.data || {};
    const score = m.reliabilityScore ?? 100;
    const tone = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
    document.getElementById('metrics-strip').innerHTML = `
      <div class="card" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
        <div style="text-align:center;min-width:96px">
          <div style="font-size:34px;font-weight:700;color:${tone}">${score}</div>
          <div class="page-subtitle" style="margin:0">Reliability</div>
        </div>
        <div class="mini-stats" style="display:flex;gap:20px;flex-wrap:wrap">
          <div><strong>${m.totalHours || 0}h</strong><div class="page-subtitle" style="margin:0">This month</div></div>
          <div><strong>${m.coversCompleted || 0}</strong><div class="page-subtitle" style="margin:0">Covers</div></div>
          <div><strong>${m.lateArrivals || 0}</strong><div class="page-subtitle" style="margin:0">Late</div></div>
          <div><strong>${m.noShows || 0}</strong><div class="page-subtitle" style="margin:0">No-shows</div></div>
        </div>
      </div>`;
  } catch {
    document.getElementById('metrics-strip').innerHTML = '';
  }
}

async function load() {
  const body = document.getElementById('shifts-body');
  body.innerHTML = '<div class="card skeleton" style="height:200px"></div>';
  try {
    const res = await staffPortalApi.myShifts(weekAnchor);
    const shifts = res.data || [];
    document.getElementById('wk-label').textContent = `week of ${fmtDay(weekAnchor)}`;
    if (!shifts.length) {
      body.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <div class="empty-state-title">No shifts this week</div>
        <div class="empty-state-desc">Nothing published for you yet.</div></div>`;
      return;
    }
    body.innerHTML = shifts.map(cardHTML).join('');
    shifts.forEach((s) => {
      document.getElementById(`ack-${s._id}`)?.addEventListener('click', () => acknowledge(s._id));
      document.getElementById(`dis-${s._id}`)?.addEventListener('click', () => dispute(s._id));
    });
  } catch (err) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">Couldn't load shifts</div>
      <div class="empty-state-desc">${esc(err.message || '')}</div></div>`;
  }
}

function statusBadge(status) {
  const tone = { confirmed: 'success', disputed: 'danger', absent: 'danger', covered: 'muted' }[status] || 'info';
  return `<span class="badge badge-${tone}">${STATUS_LABEL[status] || status}</span>`;
}

function cardHTML(s) {
  const coworkers = (s.coworkers || []).map((c) => esc(c.name)).join(', ');
  const actionable = !['absent', 'covered'].includes(s.status);
  return `
  <div class="card" style="margin-bottom:12px">
    <div class="card-header" style="align-items:center">
      <span class="card-title">${fmtDay(s.date)}</span>
      ${statusBadge(s.status)}
    </div>
    <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center">
      <div>
        <div style="font-size:18px;font-weight:600">${esc(s.startTime)}–${esc(s.endTime)}</div>
        <div class="page-subtitle" style="margin:4px 0 0">
          ${esc(s.shiftType)}${s.isNight ? ' · night' : ''}${s.isWeekend ? ' · weekend' : ''}
        </div>
        ${coworkers ? `<div class="page-subtitle" style="margin:6px 0 0">With: ${coworkers}</div>` : ''}
        ${s.status === 'disputed' && s.disputeReason ? `<div class="page-subtitle" style="margin:6px 0 0;color:var(--danger)">Disputed: ${esc(s.disputeReason)}</div>` : ''}
      </div>
      ${actionable ? `
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="ack-${s._id}" ${s.status === 'confirmed' ? 'disabled' : ''}>
          ${s.status === 'confirmed' ? '✓ Confirmed' : 'Confirm'}
        </button>
        <button class="btn btn-ghost btn-sm" id="dis-${s._id}">Dispute</button>
      </div>` : ''}
    </div>
  </div>`;
}

async function acknowledge(id) {
  try {
    await staffPortalApi.acknowledge(id);
    toast('Shift confirmed', 'success');
    load();
  } catch (err) {
    toast(err.message || 'Failed to confirm', 'error');
  }
}

async function dispute(id) {
  const reason = window.prompt('What\'s the problem with this shift?');
  if (reason === null) return; // cancelled
  if (!reason.trim()) {
    toast('A reason is required to dispute', 'error');
    return;
  }
  try {
    await staffPortalApi.dispute(id, reason.trim());
    toast('Dispute sent to your manager', 'success');
    load();
  } catch (err) {
    toast(err.message || 'Failed to dispute', 'error');
  }
}
