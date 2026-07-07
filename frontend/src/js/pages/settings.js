/* ── SHIFTWISE SETTINGS ──
 * Tabs: Business · Locations · Notifications · Account.
 * §8.4 S9 (UI Spec) · §9 Phase 1
 * Business + Locations are functional (Phase 1 backend). Notifications is a
 * placeholder (wired in Phase 9). Account links to the existing profile screen.
 */

import { businessApi, locationApi } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

const TIMEZONES = ['UTC', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Dubai', 'Australia/Sydney'];
const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AUD', 'AED'];

let activeTab = 'business';
let cache = { business: null, locations: [] };

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function renderSettings() {
  const contentHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Manage your business, locations and account</p>
        </div>
      </div>
    </div>
    <div class="settings-tabs">
      ${['business', 'locations', 'notifications', 'account'].map((t) => `
        <button class="settings-tab ${activeTab === t ? 'active' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>
      `).join('')}
    </div>
    <div id="settings-body"><div class="card skeleton" style="height:200px"></div></div>
  `;
  mountLayout(contentHTML, 'settings');

  document.querySelectorAll('.settings-tab').forEach((btn) =>
    btn.addEventListener('click', () => { activeTab = btn.dataset.tab; renderSettings(); })
  );

  try {
    if (!cache.business) cache.business = (await businessApi.get()).data;
    renderTab();
  } catch (err) {
    document.getElementById('settings-body').innerHTML = errorState(err.message);
  }
}

function errorState(msg) {
  return `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
    <div class="empty-state-title">Couldn't load settings</div>
    <div class="empty-state-desc">${esc(msg || 'Try again')}</div>
    <button class="btn btn-secondary" onclick="location.reload()">Retry</button></div>`;
}

async function renderTab() {
  const el = document.getElementById('settings-body');
  if (!el) return;
  if (activeTab === 'business')      return renderBusinessTab(el);
  if (activeTab === 'locations')     return renderLocationsTab(el);
  if (activeTab === 'notifications') return el.innerHTML = placeholderTab('Notification preferences arrive in a later phase.');
  if (activeTab === 'account')       return el.innerHTML = accountTab();
}

function placeholderTab(msg) {
  return `<div class="card"><div class="empty-state"><div class="empty-state-icon">🔔</div>
    <div class="empty-state-title">Coming soon</div><div class="empty-state-desc">${esc(msg)}</div></div></div>`;
}

function accountTab() {
  return `<div class="card">
    <div class="card-header"><span class="card-title">Account</span></div>
    <p class="text-muted" style="margin-bottom:16px">Manage your login, password and two-factor authentication.</p>
    <a href="#profile" class="btn btn-secondary">Open profile &amp; security →</a>
  </div>`;
}

/* ── Business tab ── */
function renderBusinessTab(el) {
  const b = cache.business;
  el.innerHTML = `
  <div class="card" style="max-width:560px">
    <div class="card-header"><span class="card-title">Business details</span></div>
    <label class="ob-field"><span>Business name</span>
      <input id="s-name" type="text" value="${esc(b.name)}" maxlength="100" /></label>
    <div class="ob-row">
      <label class="ob-field"><span>Timezone</span>
        <select id="s-tz">${TIMEZONES.map((t) => `<option ${b.settings.timezone === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="ob-field"><span>Currency</span>
        <select id="s-cur">${CURRENCIES.map((c) => `<option ${b.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    </div>
    <label class="ob-field"><span>Week starts on</span>
      <select id="s-week">
        <option value="0" ${b.settings.weekStartsOn === 0 ? 'selected' : ''}>Monday</option>
        <option value="1" ${b.settings.weekStartsOn === 1 ? 'selected' : ''}>Sunday</option>
      </select></label>
    <button class="btn btn-primary" id="s-save">Save changes</button>
  </div>`;

  document.getElementById('s-save').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await businessApi.update({
        name: document.getElementById('s-name').value.trim(),
        settings: {
          timezone: document.getElementById('s-tz').value,
          currency: document.getElementById('s-cur').value,
          weekStartsOn: +document.getElementById('s-week').value,
        },
      });
      cache.business = res.data;
      toast('Business updated', 'success');
    } catch (err) {
      toast(err.message || 'Save failed', 'error');
    } finally {
      e.target.disabled = false;
    }
  });
}

/* ── Locations tab ── */
async function renderLocationsTab(el) {
  el.innerHTML = `<div class="card skeleton" style="height:160px"></div>`;
  try {
    cache.locations = (await locationApi.list()).data;
  } catch (err) {
    return el.innerHTML = errorState(err.message);
  }

  const rows = cache.locations.filter((l) => l.isActive).map((l) => `
    <tr>
      <td><strong>${esc(l.name)}</strong></td>
      <td class="text-muted">${esc(l.address || '—')}</td>
      <td>${l.settings.minStaffPerShift}–${l.settings.maxStaffPerShift} / shift</td>
      <td>${(l.settings.shiftTypes || []).length} shift types</td>
      <td><button class="btn btn-ghost btn-sm st-del-loc" data-id="${l._id}">Deactivate</button></td>
    </tr>`).join('');

  el.innerHTML = `
  <div class="card">
    <div class="card-header">
      <span class="card-title">Locations</span>
      <button class="btn btn-primary btn-sm" id="add-loc">+ Add location</button>
    </div>
    ${cache.locations.filter((l) => l.isActive).length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Address</th><th>Coverage</th><th>Shifts</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `
      <div class="empty-state"><div class="empty-state-icon">📍</div>
        <div class="empty-state-title">No locations yet</div>
        <div class="empty-state-desc">Add your first branch to start scheduling</div></div>`}
  </div>`;

  document.getElementById('add-loc').addEventListener('click', addLocationPrompt);
  document.querySelectorAll('.st-del-loc').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Deactivate this location?')) return;
      try {
        await locationApi.remove(btn.dataset.id);
        toast('Location deactivated', 'success');
        renderLocationsTab(el);
      } catch (err) { toast(err.message, 'error'); }
    })
  );
}

/* Minimal add-location flow (full rules editor is part of S9; kept compact here) */
async function addLocationPrompt() {
  const name = prompt('Location name:');
  if (!name) return;
  try {
    await locationApi.create({ name: name.trim(), settings: { minStaffPerShift: 1, maxStaffPerShift: 3 } });
    toast('Location added', 'success');
    renderLocationsTab(document.getElementById('settings-body'));
  } catch (err) { toast(err.message, 'error'); }
}
