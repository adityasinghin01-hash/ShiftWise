/* ── SHIFTWISE API KEYS PAGE ── */

import { apiKeyApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

export async function renderApiKeys() {
  mountLayout(
    `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">API Keys</h1>
          <p class="page-subtitle">Manage programmatic access to the ShiftWise API</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="new-key-btn">+ Generate Key</button>
        </div>
      </div>
    </div>
    <div class="card mb-4" style="margin-bottom:16px">
      <p class="text-sm text-muted">Include your key as <span class="pill-code">X-API-Key: &lt;key&gt;</span> in request headers. Never expose keys in client-side code.</p>
    </div>
    <div id="keys-content">
      <div class="card skeleton" style="height:180px"></div>
    </div>
  `,
    'apikeys'
  );

  document.getElementById('new-key-btn').addEventListener('click', showCreateModal);
  await loadKeys();
}

async function loadKeys() {
  try {
    const res = await apiKeyApi.list();
    renderKeys(res.data || []);
  } catch (err) {
    document.getElementById('keys-content').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔑</div>
        <div class="empty-state-title">Could not load keys</div>
        <div class="empty-state-desc">${err.message}</div>
      </div>`;
  }
}

function renderKeys(keys) {
  const el = document.getElementById('keys-content');
  if (!el) return;

  if (!keys.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔑</div>
        <div class="empty-state-title">No API keys yet</div>
        <div class="empty-state-desc">Generate a key to start using the ShiftWise API programmatically</div>
        <button class="btn btn-primary" id="empty-key-btn">+ Generate Key</button>
      </div>`;
    document.getElementById('empty-key-btn')?.addEventListener('click', showCreateModal);
    return;
  }

  el.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Prefix</th><th>Permissions</th><th>Created</th><th>Last Used</th><th></th></tr></thead>
          <tbody>
            ${keys
              .map(
                (k) => `
            <tr>
              <td><strong>${k.name || 'Unnamed'}</strong></td>
              <td><span class="pill-code">${k.prefix || k.key?.slice(0, 12) || '••••••••'}…</span></td>
              <td>
                ${(k.permissions || ['read']).map((p) => `<span class="badge badge-cyan" style="margin-right:4px">${p}</span>`).join('')}
              </td>
              <td class="text-muted text-sm">${fmtDate(k.createdAt)}</td>
              <td class="text-muted text-sm">${k.lastUsed ? fmtDate(k.lastUsed) : 'Never'}</td>
              <td>
                <button class="btn btn-danger btn-sm" data-revoke="${k._id}">Revoke</button>
              </td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Revoke this API key? This cannot be undone.')) return;
      try {
        await apiKeyApi.revoke(btn.dataset.revoke);
        toast('API key revoked', 'success');
        loadKeys();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function showCreateModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Generate API Key</span>
        <button class="modal-close" id="close-key-modal">✕</button>
      </div>
      <div id="key-result" style="display:none;margin-bottom:16px">
        <p class="text-sm text-muted mb-2">Copy your key — it will only be shown once:</p>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="form-input" id="key-display" readonly style="font-family:monospace;font-size:0.8rem" />
          <button class="btn btn-secondary" id="copy-key-btn">Copy</button>
        </div>
        <p class="form-hint" style="margin-top:8px">⚠ Store this key securely. You won't see it again.</p>
      </div>
      <form id="key-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="key-name">Key Name</label>
          <input class="form-input" id="key-name" type="text" placeholder="e.g. Production Server" required />
        </div>
        <div class="form-group">
          <label class="form-label">Permissions</label>
          <div style="display:flex;gap:12px;margin-top:6px">
            ${['read', 'write', 'admin']
              .map(
                (p) => `
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.875rem">
              <input type="checkbox" value="${p}" ${p === 'read' ? 'checked' : ''} style="accent-color:var(--primary)" />
              ${p}
            </label>`
              )
              .join('')}
          </div>
        </div>
        <div id="key-error" class="form-error" style="display:none"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn btn-secondary" id="cancel-key">Cancel</button>
          <button type="submit" class="btn btn-primary" id="gen-key-btn">Generate</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#close-key-modal').addEventListener('click', () => {
    overlay.remove();
    loadKeys();
  });
  overlay.querySelector('#cancel-key').addEventListener('click', () => {
    overlay.remove();
    loadKeys();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      loadKeys();
    }
  });

  overlay.querySelector('#key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector('#gen-key-btn');
    const errEl = overlay.querySelector('#key-error');
    errEl.style.display = 'none';
    btn.classList.add('btn-loading');
    btn.disabled = true;

    const perms = [...overlay.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    const name = overlay.querySelector('#key-name').value.trim();
    try {
      const res = await apiKeyApi.create({ name, permissions: perms });
      const key = res.data?.key || res.data?.apiKey || '(key hidden)';
      overlay.querySelector('#key-display').value = key;
      overlay.querySelector('#key-result').style.display = 'block';
      overlay.querySelector('#key-form').style.display = 'none';
      overlay.querySelector('#copy-key-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(key);
        toast('Key copied to clipboard', 'success');
      });
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
