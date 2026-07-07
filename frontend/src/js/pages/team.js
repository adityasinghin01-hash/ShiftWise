/* ── SHIFTWISE TEAM ──
 * Staff list + add/bulk/invite/notify/deactivate.
 * §8.4 S3 (UI Spec) · §9 Phase 2
 * Picks up any staff stashed by the onboarding wizard (shiftwise_pending_staff).
 */

import { staffApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

let cache = [];

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS_BADGE = {
  none:    '<span class="badge badge-muted">Record</span>',
  invited: '<span class="badge badge-amber">Invited</span>',
  active:  '<span class="badge badge-green">Active</span>',
};

export async function renderTeam() {
  const contentHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Team</h1>
          <p class="page-subtitle">Manage your staff and invitations</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost btn-sm" id="bulk-btn">Bulk import</button>
          <button class="btn btn-primary btn-sm" id="add-btn">+ Add staff</button>
        </div>
      </div>
    </div>
    <div id="team-body"><div class="card skeleton" style="height:200px"></div></div>
  `;
  mountLayout(contentHTML, 'team');

  document.getElementById('add-btn').addEventListener('click', () => openAddModal());
  document.getElementById('bulk-btn').addEventListener('click', () => openBulkModal());

  await loadStaff();
}

async function loadStaff() {
  const el = document.getElementById('team-body');
  if (!el) return;
  try {
    cache = (await staffApi.list()).data;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">Couldn't load team</div>
      <div class="empty-state-desc">${esc(err.message || '')}</div></div>`;
    return;
  }

  if (!cache.length) {
    el.innerHTML = `<div class="card"><div class="empty-state">
      <div class="empty-state-icon">👥</div>
      <div class="empty-state-title">No team members yet</div>
      <div class="empty-state-desc">Add your first staff member to start scheduling</div>
      <button class="btn btn-primary" id="empty-add">+ Add staff</button>
    </div></div>`;
    document.getElementById('empty-add').addEventListener('click', () => openAddModal());
    return;
  }

  el.innerHTML = `<div class="card"><div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Rate</th><th>Hrs/wk</th><th></th></tr></thead>
    <tbody>${cache.map(rowHTML).join('')}</tbody>
  </table></div></div>`;

  // Wire row actions
  cache.forEach((s) => {
    document.getElementById(`invite-${s._id}`)?.addEventListener('click', () => doInvite(s._id));
    document.getElementById(`notify-${s._id}`)?.addEventListener('click', () => openNotifyModal(s));
    document.getElementById(`del-${s._id}`)?.addEventListener('click', () => doDelete(s._id, s.name));
  });
}

function rowHTML(s) {
  const canInvite = s.accountStatus !== 'active';
  return `<tr>
    <td><strong>${esc(s.name)}</strong><br><span class="text-muted" style="font-size:0.75rem">${esc(s.email)}</span></td>
    <td>${esc(s.role || '—')}</td>
    <td>${STATUS_BADGE[s.accountStatus] || ''}</td>
    <td>${s.hourlyRate ? esc(String(s.hourlyRate)) : '—'}</td>
    <td>${s.maxHoursPerWeek || '—'}</td>
    <td style="white-space:nowrap">
      ${canInvite ? `<button class="btn btn-ghost btn-sm" id="invite-${s._id}">${s.accountStatus === 'invited' ? 'Resend' : 'Invite'}</button>` : ''}
      <button class="btn btn-ghost btn-sm" id="notify-${s._id}">Notify</button>
      <button class="btn btn-ghost btn-sm" id="del-${s._id}" style="color:var(--danger)">Remove</button>
    </td>
  </tr>`;
}

/* ── Add staff modal ── */
function openAddModal() {
  showModal(`
    <h3 class="modal-title">Add staff member</h3>
    <label class="ob-field"><span>Name *</span><input id="m-name" type="text" /></label>
    <label class="ob-field"><span>Email *</span><input id="m-email" type="email" /></label>
    <div class="ob-row">
      <label class="ob-field"><span>Role</span><input id="m-role" type="text" placeholder="barista" /></label>
      <label class="ob-field"><span>Hourly rate</span><input id="m-rate" type="number" min="0" value="0" /></label>
    </div>
    <label class="ob-field"><span>Max hours / week</span><input id="m-hours" type="number" min="0" value="0" /></label>
    <label class="ob-check"><input type="checkbox" id="m-manual" /> Manually managed (schedule without app login)</label>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-secondary" id="m-save">Save as record</button>
      <button class="btn btn-primary" id="m-invite">Save &amp; invite</button>
    </div>
  `);

  const collect = () => ({
    name: document.getElementById('m-name').value.trim(),
    email: document.getElementById('m-email').value.trim(),
    role: document.getElementById('m-role').value.trim(),
    hourlyRate: +document.getElementById('m-rate').value || 0,
    maxHoursPerWeek: +document.getElementById('m-hours').value || 0,
    manuallyManaged: document.getElementById('m-manual').checked,
  });

  const save = async (sendInvite) => {
    const body = collect();
    if (!body.name || !body.email) return toast('Name and email are required', 'error');
    try {
      await staffApi.create({ ...body, sendInvite });
      toast(sendInvite ? 'Staff added & invited' : 'Staff added', 'success');
      closeModal();
      loadStaff();
    } catch (err) {
      toast(err.message || 'Failed to add staff', 'error');
    }
  };

  document.getElementById('m-save').addEventListener('click', () => save(false));
  document.getElementById('m-invite').addEventListener('click', () => save(true));
}

/* ── Bulk import modal ── */
function openBulkModal() {
  showModal(`
    <h3 class="modal-title">Bulk import</h3>
    <p class="text-muted" style="font-size:0.82rem;margin-bottom:10px">One per line: <code>Name, email@example.com</code></p>
    <textarea id="bulk-text" rows="8" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;font-family:monospace;font-size:0.85rem"></textarea>
    <label class="ob-check"><input type="checkbox" id="bulk-invite" /> Send invites to all</label>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="bulk-go">Import</button>
    </div>
  `);

  document.getElementById('bulk-go').addEventListener('click', async () => {
    const lines = document.getElementById('bulk-text').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((l) => {
      const [name, email] = l.split(',').map((p) => (p || '').trim());
      return { name, email };
    });
    if (!rows.length) return toast('Paste at least one row', 'error');
    try {
      const res = await staffApi.bulk({ rows, sendInvite: document.getElementById('bulk-invite').checked });
      const { created, errors } = res.data;
      toast(`Imported ${created.length}${errors.length ? `, ${errors.length} skipped` : ''}`, errors.length ? 'warning' : 'success');
      closeModal();
      loadStaff();
    } catch (err) {
      toast(err.message || 'Import failed', 'error');
    }
  });
}

/* ── Emergency notify modal ── */
function openNotifyModal(s) {
  showModal(`
    <h3 class="modal-title">Notify ${esc(s.name)}</h3>
    <p class="text-muted" style="font-size:0.82rem;margin-bottom:10px">Emails ${esc(s.email)} with their upcoming shifts and your message.</p>
    <label class="ob-field"><span>Message (optional)</span>
      <textarea id="notify-msg" rows="3" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px"></textarea></label>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="notify-go">Send email</button>
    </div>
  `);
  document.getElementById('notify-go').addEventListener('click', async () => {
    try {
      await staffApi.notify(s._id, { message: document.getElementById('notify-msg').value.trim() });
      toast('Notification sent', 'success');
      closeModal();
    } catch (err) {
      toast(err.message || 'Failed to send', 'error');
    }
  });
}

async function doInvite(id) {
  try {
    await staffApi.invite(id);
    toast('Invite sent', 'success');
    loadStaff();
  } catch (err) {
    toast(err.message || 'Invite failed', 'error');
  }
}

async function doDelete(id, name) {
  if (!confirm(`Remove ${name}?`)) return;
  try {
    await staffApi.remove(id);
    toast('Staff removed', 'success');
    loadStaff();
  } catch (err) {
    toast(err.message || 'Failed', 'error');
  }
}

/* ── Minimal modal helpers ── */
function showModal(innerHTML) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'sw-modal';
  overlay.innerHTML = `<div class="modal-card">${innerHTML}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.hasAttribute('data-close')) closeModal(); });
  document.addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  document.getElementById('sw-modal')?.remove();
  document.removeEventListener('keydown', escClose);
}
