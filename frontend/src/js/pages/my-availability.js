/* ── SHIFTWISE MY AVAILABILITY (staff) ──
 * Staff set their recurring weekly availability + per-week overrides.
 * §8.4 S5 (UI Spec) · §9 Phase 3
 */

import { availabilityApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; // 0..6

let recurring = []; // working copy of recurring slots, indexed by dayOfWeek

/** Build a slots array keyed by day from the stored recurring slots */
function hydrate(slots) {
  return DAYS.map((_, d) => {
    const found = (slots || []).find((s) => s.dayOfWeek === d);
    return found
      ? { dayOfWeek: d, available: found.available !== false, preferredStart: found.preferredStart || '09:00', preferredEnd: found.preferredEnd || '17:00' }
      : { dayOfWeek: d, available: false, preferredStart: '09:00', preferredEnd: '17:00' };
  });
}

export async function renderMyAvailability() {
  const contentHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">My Availability</h1>
          <p class="page-subtitle">Set the days and times you can normally work</p>
        </div>
      </div>
    </div>
    <div id="avail-body"><div class="card skeleton" style="height:280px"></div></div>
  `;
  mountLayout(contentHTML, 'my-availability');

  try {
    const res = await availabilityApi.getMine();
    recurring = hydrate(res.data?.recurring?.slots);
    renderEditor(res.data);
  } catch (err) {
    document.getElementById('avail-body').innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">Couldn't load availability</div>
      <div class="empty-state-desc">${(err.message || '').replace(/</g, '&lt;')}</div></div>`;
  }
}

function renderEditor(data) {
  const el = document.getElementById('avail-body');
  const pending = (data?.pendingOverrides || []).filter((p) => p.status === 'pending');

  el.innerHTML = `
  ${pending.length ? `
  <div class="card" style="margin-bottom:16px;border-color:var(--warning)">
    <div class="card-header"><span class="card-title">Override requests from your manager</span></div>
    ${pending.map((p) => `
      <div class="avail-pending" data-id="${p._id}">
        <span>Week of ${new Date(p.weekOf).toDateString()}${p.note ? ` — "${p.note.replace(/</g, '&lt;')}"` : ''}</span>
        <span>
          <button class="btn btn-primary btn-sm" data-confirm="${p._id}">Confirm</button>
          <button class="btn btn-ghost btn-sm" data-decline="${p._id}">Decline</button>
        </span>
      </div>`).join('')}
  </div>` : ''}

  <div class="card" style="max-width:640px">
    <div class="card-header"><span class="card-title">Weekly availability</span></div>
    <div class="avail-grid">
      ${recurring.map(rowHTML).join('')}
    </div>
    <button class="btn btn-primary" id="save-avail" style="margin-top:16px">Save availability</button>
  </div>`;

  // Wire day toggles + time inputs
  recurring.forEach((slot, d) => {
    const toggle = document.getElementById(`av-${d}`);
    toggle?.addEventListener('change', (e) => {
      recurring[d].available = e.target.checked;
      el.querySelector(`#times-${d}`).style.opacity = e.target.checked ? '1' : '0.35';
      el.querySelector(`#times-${d}`).style.pointerEvents = e.target.checked ? 'auto' : 'none';
    });
    document.getElementById(`start-${d}`)?.addEventListener('change', (e) => { recurring[d].preferredStart = e.target.value; });
    document.getElementById(`end-${d}`)?.addEventListener('change', (e) => { recurring[d].preferredEnd = e.target.value; });
  });

  document.getElementById('save-avail').addEventListener('click', save);

  // Pending override actions
  el.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => review(b.dataset.confirm, 'confirm')));
  el.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => review(b.dataset.decline, 'decline')));
}

function rowHTML(slot, d) {
  return `
  <div class="avail-row">
    <label class="avail-day">
      <input type="checkbox" id="av-${d}" ${slot.available ? 'checked' : ''} />
      <span>${DAYS[d]}</span>
    </label>
    <div class="avail-times" id="times-${d}" style="opacity:${slot.available ? '1' : '0.35'};pointer-events:${slot.available ? 'auto' : 'none'}">
      <input type="time" id="start-${d}" value="${slot.preferredStart}" />
      <span>to</span>
      <input type="time" id="end-${d}" value="${slot.preferredEnd}" />
    </div>
  </div>`;
}

async function save() {
  const btn = document.getElementById('save-avail');
  btn.disabled = true;
  try {
    // Only send days marked available (plus their times)
    const slots = recurring.filter((s) => s.available).map((s) => ({
      dayOfWeek: s.dayOfWeek, available: true, preferredStart: s.preferredStart, preferredEnd: s.preferredEnd,
    }));
    await availabilityApi.setRecurring({ slots });
    toast('Availability saved', 'success');
  } catch (err) {
    toast(err.message || 'Save failed', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function review(id, decision) {
  try {
    await availabilityApi.reviewOverride(id, decision);
    toast(decision === 'confirm' ? 'Override confirmed' : 'Override declined', 'success');
    renderMyAvailability();
  } catch (err) {
    toast(err.message || 'Failed', 'error');
  }
}
