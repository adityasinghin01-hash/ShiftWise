/* ── SHIFTWISE ONBOARDING WIZARD ──
 * 3-step first-run wizard: Business → First Location → Staff (optional).
 * §8.4 S1 (UI Spec) · §9 Phase 1
 * Shown only when the user has no business / onboarding.completed === false.
 * On finish: creates business + location (+ optional staff), flips
 * onboarding.completed, routes to the dashboard.
 */

import { businessApi, locationApi } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { navigate } from '../router.js';

const getApp = () => document.getElementById('app');

// Common timezone + currency options (kept short; full list is a v2 nicety)
const TIMEZONES = ['UTC', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Dubai', 'Australia/Sydney'];
const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AUD', 'AED'];

// Wizard state held in a closure object across steps
const state = {
  step: 1,
  business: { name: '', timezone: 'UTC', currency: 'USD', weekStartsOn: 0 },
  location: { name: '', address: '', shiftTypes: presetShiftTypes(), minStaffPerShift: 1, maxStaffPerShift: 3 },
  staff: [], // { name, email, role }
  sendInvites: true,
};

/** Default Morning/Afternoon/Evening preset */
function presetShiftTypes() {
  return [
    { name: 'Morning', startTime: '07:00', endTime: '13:00', color: '#f59e0b' },
    { name: 'Afternoon', startTime: '13:00', endTime: '19:00', color: '#4ea864' },
    { name: 'Evening', startTime: '19:00', endTime: '23:00', color: '#7c3aed' },
  ];
}

const logoSVG = `
  <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
    <rect width="48" height="48" rx="24" fill="rgba(45,110,31,0.2)" stroke="rgba(78,168,100,0.5)" stroke-width="1.5"/>
    <circle cx="24" cy="24" r="10" stroke="#4ea864" stroke-width="1.5" fill="none"/>
    <line x1="24" y1="24" x2="24" y2="16" stroke="#4ea864" stroke-width="2" stroke-linecap="round"/>
    <line x1="24" y1="24" x2="30" y2="27" stroke="#4ea864" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;

function stepIndicator() {
  return `
  <div class="ob-steps">
    ${[1, 2, 3].map((n) => `
      <div class="ob-step ${state.step === n ? 'active' : ''} ${state.step > n ? 'done' : ''}">
        <span class="ob-step-num">${state.step > n ? '✓' : n}</span>
        <span class="ob-step-label">${['Business', 'Location', 'Team'][n - 1]}</span>
      </div>`).join('<div class="ob-step-line"></div>')}
  </div>`;
}

/* ── Step 1: Business ── */
function step1() {
  const b = state.business;
  return `
  <h2 class="ob-title">Set up your business</h2>
  <p class="ob-sub">Tell us about your company. You can change all of this later in Settings.</p>
  <label class="ob-field"><span>Business name *</span>
    <input id="b-name" type="text" value="${esc(b.name)}" placeholder="e.g. The Green Cup" maxlength="100" />
  </label>
  <div class="ob-row">
    <label class="ob-field"><span>Timezone</span>
      <select id="b-tz">${TIMEZONES.map((t) => `<option ${b.timezone === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </label>
    <label class="ob-field"><span>Currency</span>
      <select id="b-cur">${CURRENCIES.map((c) => `<option ${b.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </label>
  </div>
  <label class="ob-field"><span>Week starts on</span>
    <select id="b-week">
      <option value="0" ${b.weekStartsOn === 0 ? 'selected' : ''}>Monday</option>
      <option value="1" ${b.weekStartsOn === 1 ? 'selected' : ''}>Sunday</option>
    </select>
  </label>`;
}

/* ── Step 2: First location ── */
function step2() {
  const l = state.location;
  return `
  <h2 class="ob-title">Add your first location</h2>
  <p class="ob-sub">A location is a branch with its own schedule and rules.</p>
  <label class="ob-field"><span>Location name *</span>
    <input id="l-name" type="text" value="${esc(l.name)}" placeholder="e.g. Main Branch" maxlength="100" />
  </label>
  <label class="ob-field"><span>Address</span>
    <input id="l-addr" type="text" value="${esc(l.address)}" placeholder="optional" maxlength="255" />
  </label>
  <div class="ob-field"><span>Shift types</span>
    <div id="shift-types">${l.shiftTypes.map(shiftTypeRow).join('')}</div>
    <button type="button" class="btn btn-ghost btn-sm" id="add-shift-type">+ Add shift type</button>
  </div>
  <div class="ob-row">
    <label class="ob-field"><span>Min staff / shift</span>
      <input id="l-min" type="number" min="0" value="${l.minStaffPerShift}" />
    </label>
    <label class="ob-field"><span>Max staff / shift</span>
      <input id="l-max" type="number" min="0" value="${l.maxStaffPerShift}" />
    </label>
  </div>`;
}

function shiftTypeRow(st, i) {
  return `
  <div class="shift-type-row" data-i="${i}">
    <input class="st-name" type="text" value="${esc(st.name)}" placeholder="Name" />
    <input class="st-start" type="time" value="${st.startTime}" />
    <input class="st-end" type="time" value="${st.endTime}" />
    <input class="st-color" type="color" value="${st.color}" />
    <button type="button" class="st-del" title="Remove">✕</button>
  </div>`;
}

/* ── Step 3: Staff (optional) ── */
function step3() {
  return `
  <h2 class="ob-title">Add your team</h2>
  <p class="ob-sub">Add a few people now, or skip and do it later. Invited staff get an email to set their own availability.</p>
  <div id="staff-rows">${state.staff.map(staffRow).join('') || ''}</div>
  <button type="button" class="btn btn-ghost btn-sm" id="add-staff">+ Add team member</button>
  <label class="ob-check"><input type="checkbox" id="send-invites" ${state.sendInvites ? 'checked' : ''}/> Send email invites now</label>`;
}

function staffRow(s, i) {
  return `
  <div class="staff-row" data-i="${i}">
    <input class="sr-name" type="text" value="${esc(s.name)}" placeholder="Name" />
    <input class="sr-email" type="email" value="${esc(s.email)}" placeholder="Email" />
    <input class="sr-role" type="text" value="${esc(s.role || '')}" placeholder="Role (e.g. barista)" />
    <button type="button" class="sr-del" title="Remove">✕</button>
  </div>`;
}

/* ── Escape helper (prevents HTML injection in inputs) ── */
function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Render the whole wizard shell ── */
export function renderOnboarding() {
  const app = getApp();
  const body = state.step === 1 ? step1() : state.step === 2 ? step2() : step3();
  const isLast = state.step === 3;

  app.innerHTML = `
  <div class="ob-wrap">
    <div class="ob-card">
      <div class="ob-logo">${logoSVG}<span>ShiftWise</span></div>
      ${stepIndicator()}
      <div class="ob-body">${body}</div>
      <div class="ob-footer">
        ${state.step > 1 ? `<button class="btn btn-ghost" id="ob-back">Back</button>` : '<span></span>'}
        <button class="btn btn-primary" id="ob-next">${isLast ? 'Finish setup' : 'Continue'}</button>
      </div>
    </div>
  </div>`;

  wireStep();
}

/* ── Wire up the current step's interactions ── */
function wireStep() {
  document.getElementById('ob-back')?.addEventListener('click', () => {
    captureStep();
    state.step--;
    renderOnboarding();
  });
  document.getElementById('ob-next')?.addEventListener('click', onNext);

  if (state.step === 2) {
    document.getElementById('add-shift-type')?.addEventListener('click', () => {
      captureStep();
      state.location.shiftTypes.push({ name: '', startTime: '09:00', endTime: '17:00', color: '#4ea864' });
      renderOnboarding();
    });
    document.querySelectorAll('.st-del').forEach((btn) => btn.addEventListener('click', (e) => {
      captureStep();
      const i = +e.target.closest('.shift-type-row').dataset.i;
      state.location.shiftTypes.splice(i, 1);
      renderOnboarding();
    }));
  }

  if (state.step === 3) {
    document.getElementById('add-staff')?.addEventListener('click', () => {
      captureStep();
      state.staff.push({ name: '', email: '', role: '' });
      renderOnboarding();
    });
    document.querySelectorAll('.sr-del').forEach((btn) => btn.addEventListener('click', (e) => {
      captureStep();
      const i = +e.target.closest('.staff-row').dataset.i;
      state.staff.splice(i, 1);
      renderOnboarding();
    }));
  }
}

/* ── Read DOM values into state before navigating ── */
function captureStep() {
  if (state.step === 1) {
    state.business.name = val('b-name');
    state.business.timezone = val('b-tz');
    state.business.currency = val('b-cur');
    state.business.weekStartsOn = +val('b-week');
  } else if (state.step === 2) {
    state.location.name = val('l-name');
    state.location.address = val('l-addr');
    state.location.minStaffPerShift = +val('l-min');
    state.location.maxStaffPerShift = +val('l-max');
    state.location.shiftTypes = [...document.querySelectorAll('.shift-type-row')].map((row) => ({
      name: row.querySelector('.st-name').value.trim(),
      startTime: row.querySelector('.st-start').value,
      endTime: row.querySelector('.st-end').value,
      color: row.querySelector('.st-color').value,
    }));
  } else if (state.step === 3) {
    state.staff = [...document.querySelectorAll('.staff-row')].map((row) => ({
      name: row.querySelector('.sr-name').value.trim(),
      email: row.querySelector('.sr-email').value.trim(),
      role: row.querySelector('.sr-role').value.trim(),
    }));
    state.sendInvites = document.getElementById('send-invites')?.checked ?? true;
  }
}

const val = (id) => document.getElementById(id)?.value?.trim() ?? '';

/* ── Next/Finish handler with per-step validation ── */
async function onNext() {
  captureStep();

  if (state.step === 1) {
    if (!state.business.name) return toast('Business name is required', 'error');
    state.step = 2;
    return renderOnboarding();
  }

  if (state.step === 2) {
    if (!state.location.name) return toast('Location name is required', 'error');
    if (state.location.minStaffPerShift > state.location.maxStaffPerShift) {
      return toast('Min staff cannot exceed max staff', 'error');
    }
    state.step = 3;
    return renderOnboarding();
  }

  // Step 3 → Finish: create everything
  await finish();
}

/* ── Persist business + location (+ optional staff) ── */
async function finish() {
  const btn = document.getElementById('ob-next');
  if (btn) { btn.disabled = true; btn.textContent = 'Setting up…'; }

  try {
    // 1. Business
    await businessApi.create(state.business);

    // 2. First location
    const locRes = await locationApi.create({
      name: state.location.name,
      address: state.location.address,
      settings: {
        shiftTypes: state.location.shiftTypes.filter((s) => s.name),
        minStaffPerShift: state.location.minStaffPerShift,
        maxStaffPerShift: state.location.maxStaffPerShift,
      },
    });
    const locationId = locRes?.data?.id || locRes?.data?._id || null;

    // 3. Staff — create them now via the real staff API (Phase 2). Any staff
    //    entered in the wizard are created immediately; invites are sent if the
    //    "send invites" box was checked. Assign them to the location just created
    //    so they can set availability / be scheduled (otherwise "My Availability" 400s).
    const validStaff = state.staff.filter((s) => s.name && s.email);
    if (validStaff.length) {
      try {
        const { staffApi } = await import('../api.js');
        await staffApi.bulk({ rows: validStaff, sendInvite: state.sendInvites, locationIds: locationId ? [locationId] : [] });
      } catch (staffErr) {
        // Non-fatal: business + location are created; staff can be added later in Team.
        console.warn('Wizard staff creation failed:', staffErr.message);
      }
    }

    // 4. Flip onboarding flag + mark rules/checklist progress
    await businessApi.update({ onboarding: { completed: true, checklist: { rulesSet: true } } });

    // Update the in-memory gate so the router doesn't bounce us back here.
    store.onboarding = 'ok';
    store.membership = 'owner'; // completing the wizard makes this user an owner

    toast('Welcome to ShiftWise! 🎉', 'success');
    navigate('dashboard');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Finish setup'; }
    toast(err.message || 'Setup failed — please try again', 'error');
  }
}
