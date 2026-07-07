/* ── SHIFTWISE AVAILABILITY OVERVIEW (manager) ──
 * Grid of all staff availability for a selected week.
 * §8.4 S5 (UI Spec) · §9 Phase 3
 */

import { availabilityApi, locationApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // 0..6

let locations = [];
let activeLocationId = null;
let weekOf = mondayOf(new Date()); // ISO date string of current week's Monday

function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7; // 0=Mon
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function esc(s = '') { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export async function renderAvailability() {
  const contentHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Availability</h1>
          <p class="page-subtitle">See when your team can work each week</p>
        </div>
        <div class="page-actions" id="avail-controls"></div>
      </div>
    </div>
    <div id="avail-overview"><div class="card skeleton" style="height:240px"></div></div>
  `;
  mountLayout(contentHTML, 'availability');

  try {
    locations = (await locationApi.list()).data.filter((l) => l.isActive);
  } catch (err) {
    document.getElementById('avail-overview').innerHTML = errState(err.message);
    return;
  }
  if (!locations.length) {
    document.getElementById('avail-overview').innerHTML = `<div class="card"><div class="empty-state">
      <div class="empty-state-icon">📍</div><div class="empty-state-title">No locations</div>
      <div class="empty-state-desc">Add a location in Settings first</div></div></div>`;
    return;
  }
  activeLocationId = activeLocationId || locations[0]._id;
  renderControls();
  loadOverview();
}

function renderControls() {
  const el = document.getElementById('avail-controls');
  el.innerHTML = `
    <select id="loc-select" class="ctrl-select">
      ${locations.map((l) => `<option value="${l._id}" ${l._id === activeLocationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
    </select>
    <button class="btn btn-ghost btn-sm" id="week-prev">◀</button>
    <span id="week-label" class="text-sm" style="min-width:130px;text-align:center;display:inline-block">${weekLabel()}</span>
    <button class="btn btn-ghost btn-sm" id="week-next">▶</button>
  `;
  document.getElementById('loc-select').addEventListener('change', (e) => { activeLocationId = e.target.value; loadOverview(); });
  document.getElementById('week-prev').addEventListener('click', () => shiftWeek(-7));
  document.getElementById('week-next').addEventListener('click', () => shiftWeek(7));
}

function weekLabel() {
  const d = new Date(weekOf + 'T00:00:00Z');
  return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function shiftWeek(days) {
  const d = new Date(weekOf + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  weekOf = d.toISOString().slice(0, 10);
  document.getElementById('week-label').textContent = weekLabel();
  loadOverview();
}

async function loadOverview() {
  const el = document.getElementById('avail-overview');
  el.innerHTML = `<div class="card skeleton" style="height:240px"></div>`;
  let data;
  try {
    data = (await availabilityApi.locationOverview(activeLocationId, weekOf)).data;
  } catch (err) {
    el.innerHTML = errState(err.message);
    return;
  }

  if (!data.length) {
    el.innerHTML = `<div class="card"><div class="empty-state">
      <div class="empty-state-icon">👥</div><div class="empty-state-title">No staff at this location</div>
      <div class="empty-state-desc">Add team members to see their availability</div></div></div>`;
    return;
  }

  // Build a grid: rows = staff, cols = days
  el.innerHTML = `<div class="card"><div class="table-wrap"><table class="avail-table">
    <thead><tr><th>Staff</th>${DAY_ABBR.map((d) => `<th>${d}</th>`).join('')}<th>Status</th></tr></thead>
    <tbody>
      ${data.map((row) => {
        const byDay = {};
        (row.resolvedSlots || []).forEach((s) => { if (s.available) byDay[s.dayOfWeek] = s; });
        return `<tr>
          <td><strong>${esc(row.name)}</strong></td>
          ${DAY_ABBR.map((_, d) => {
            const s = byDay[d];
            return `<td class="avail-cell ${s ? 'on' : 'off'}" title="${s ? `${s.preferredStart || ''}–${s.preferredEnd || ''}` : 'Unavailable'}">${s ? '✓' : '·'}</td>`;
          }).join('')}
          <td>${row.submitted ? '<span class="badge badge-green">Submitted</span>' : '<span class="badge badge-amber">Not set</span>'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div></div>`;
}

function errState(msg) {
  return `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
    <div class="empty-state-title">Couldn't load availability</div>
    <div class="empty-state-desc">${esc(msg || '')}</div></div>`;
}
