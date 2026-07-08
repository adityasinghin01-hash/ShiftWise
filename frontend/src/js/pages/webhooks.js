/* ── SHIFTWISE WEBHOOKS PAGE ── */

import { webhookApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

const EVENTS = [
  'user.created',
  'user.login',
  'user.updated',
  'subscription.upgraded',
  'subscription.cancelled',
  'api_key.created',
  'api_key.revoked',
];

export async function renderWebhooks() {
  mountLayout(
    `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Webhooks</h1>
          <p class="page-subtitle">Configure HTTP callbacks for real-time event notifications</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="new-wh-btn">+ Add Webhook</button>
        </div>
      </div>
    </div>
    <div id="wh-content">
      <div class="card skeleton" style="height:200px"></div>
    </div>
  `,
    'webhooks'
  );

  document.getElementById('new-wh-btn').addEventListener('click', () => showWebhookModal());
  await loadWebhooks();
}

async function loadWebhooks() {
  try {
    const res = await webhookApi.list();
    renderWebhookList(res.data || []);
  } catch (err) {
    document.getElementById('wh-content').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔗</div>
        <div class="empty-state-title">Could not load webhooks</div>
        <div class="empty-state-desc">${err.message}</div>
      </div>`;
  }
}

function renderWebhookList(hooks) {
  const el = document.getElementById('wh-content');
  if (!el) return;

  if (!hooks.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔗</div>
        <div class="empty-state-title">No webhooks configured</div>
        <div class="empty-state-desc">Add a webhook endpoint to receive real-time event notifications</div>
        <button class="btn btn-primary" id="empty-wh-btn">+ Add Webhook</button>
      </div>`;
    document.getElementById('empty-wh-btn')?.addEventListener('click', () => showWebhookModal());
    return;
  }

  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>URL</th><th>Events</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${hooks
              .map(
                (wh) => `
            <tr>
              <td>
                <span class="pill-code" style="font-size:0.75rem;max-width:240px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${wh.url}</span>
              </td>
              <td>
                ${(wh.events || [])
                  .slice(0, 3)
                  .map(
                    (e) =>
                      `<span class="badge badge-purple" style="margin-right:4px;margin-bottom:2px">${e}</span>`
                  )
                  .join('')}
                ${(wh.events || []).length > 3 ? `<span class="badge badge-gray">+${(wh.events || []).length - 3}</span>` : ''}
              </td>
              <td>
                <span class="badge ${wh.active ? 'badge-green' : 'badge-gray'}">${wh.active ? 'Active' : 'Disabled'}</span>
              </td>
              <td class="text-muted text-sm">${fmtDate(wh.createdAt)}</td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-ghost btn-sm" data-test="${wh._id}">Test</button>
                  <button class="btn btn-secondary btn-sm" data-edit="${wh._id}">Edit</button>
                  <button class="btn btn-danger btn-sm" data-del="${wh._id}">Delete</button>
                </div>
              </td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelectorAll('[data-test]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await webhookApi.test(btn.dataset.test);
        toast('Test event sent to webhook', 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('[data-edit]').forEach((btn) => {
    const wh = hooks.find((h) => h._id === btn.dataset.edit);
    btn.addEventListener('click', () => showWebhookModal(wh));
  });

  el.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this webhook?')) return;
      try {
        await webhookApi.delete(btn.dataset.del);
        toast('Webhook deleted', 'success');
        loadWebhooks();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function showWebhookModal(wh = null) {
  const isEdit = !!wh;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-header">
        <span class="modal-title">${isEdit ? 'Edit Webhook' : 'Add Webhook'}</span>
        <button class="modal-close" id="close-wh">✕</button>
      </div>
      <form id="wh-form">
        <div class="form-group">
          <label class="form-label" for="wh-url">Endpoint URL</label>
          <input class="form-input" id="wh-url" type="url" placeholder="https://your-server.com/webhook" value="${wh?.url || ''}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Events to Subscribe</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
            ${EVENTS.map(
              (ev) => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.8rem;padding:6px 10px;border:1px solid var(--border-light);border-radius:6px">
              <input type="checkbox" value="${ev}" ${(wh?.events || []).includes(ev) ? 'checked' : ''} style="accent-color:var(--primary)" />
              ${ev}
            </label>`
            ).join('')}
          </div>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.875rem">
            <input type="checkbox" id="wh-active" ${!isEdit || wh?.active ? 'checked' : ''} style="accent-color:var(--primary)" />
            Active (enabled)
          </label>
        </div>
        <div id="wh-error" class="form-error" style="display:none"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn btn-secondary" id="cancel-wh">Cancel</button>
          <button type="submit" class="btn btn-primary" id="save-wh-btn">${isEdit ? 'Save Changes' : 'Create Webhook'}</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#close-wh').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cancel-wh').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#wh-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector('#save-wh-btn');
    const errEl = overlay.querySelector('#wh-error');
    errEl.style.display = 'none';
    btn.classList.add('btn-loading');
    btn.disabled = true;

    const events = [...overlay.querySelectorAll('input[type=checkbox][value]:checked')].map(
      (c) => c.value
    );
    const body = {
      url: overlay.querySelector('#wh-url').value.trim(),
      events,
      active: overlay.querySelector('#wh-active').checked,
    };

    try {
      if (isEdit) {
        await webhookApi.update(wh._id, body);
        toast('Webhook updated', 'success');
      } else {
        await webhookApi.create(body);
        toast('Webhook created', 'success');
      }
      overlay.remove();
      loadWebhooks();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'flex';
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
