/* ── SHIFTWISE PROFILE PAGE ── */

import { profileApi, mfaApi } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

export async function renderProfile() {
  mountLayout(
    `
    <div class="page-header">
      <h1 class="page-title">Profile</h1>
      <p class="page-subtitle">Manage your account details and security settings</p>
    </div>
    <div id="profile-content">
      <div class="card skeleton" style="height:300px"></div>
    </div>
  `,
    'profile'
  );

  try {
    const [profileRes, sessionsRes] = await Promise.all([
      profileApi.getProfile(),
      profileApi.listSessions().catch(() => ({ sessions: [] })),
    ]);
    renderProfileContent(profileRes.data || profileRes.user || {}, sessionsRes.sessions || []);
  } catch {
    renderProfileContent({ email: store.email, name: store.name, role: store.role }, []);
  }
}

function renderProfileContent(user, sessions) {
  const el = document.getElementById('profile-content');
  if (!el) return;

  el.innerHTML = `
  <div class="bento-grid">
    <div class="card bento-half">
      <div class="card-header"><span class="card-title">Account Info</span></div>
      <form id="profile-form">
        <div class="form-group">
          <label class="form-label" for="p-name">Display Name</label>
          <input class="form-input" id="p-name" type="text" value="${user.name || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="p-email">Email</label>
          <input class="form-input" id="p-email" type="email" value="${user.email || ''}" disabled />
          <span class="form-hint">Email cannot be changed here</span>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <div style="display:flex;align-items:center;gap:8px;padding:10px 0">
            <span class="badge ${user.role === 'admin' ? 'badge-purple' : 'badge-cyan'}">${user.role || 'user'}</span>
          </div>
        </div>
        <button class="btn btn-primary" id="save-profile-btn" type="submit">Save Changes</button>
      </form>
    </div>

    <div class="card bento-half">
      <div class="card-header"><span class="card-title">Change Password</span></div>
      <form id="pw-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="pw-current">Current Password</label>
          <input class="form-input" id="pw-current" type="password" placeholder="••••••••" autocomplete="current-password" />
        </div>
        <div class="form-group">
          <label class="form-label" for="pw-new">New Password</label>
          <input class="form-input" id="pw-new" type="password" placeholder="••••••••" autocomplete="new-password" />
          <span class="form-hint">Min 12 chars · uppercase · number · special</span>
        </div>
        <div id="pw-error" class="form-error" style="display:none"></div>
        <button class="btn btn-secondary" id="save-pw-btn" type="submit">Update Password</button>
      </form>
    </div>

    <div class="card bento-full" id="mfa-section">
      <div class="card-header">
        <span class="card-title">Two-Factor Authentication (TOTP)</span>
        <span class="badge ${user.mfaEnabled ? 'badge-green' : 'badge-gray'}" id="mfa-badge">
          ${user.mfaEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div id="mfa-content">
        ${
          user.mfaEnabled
            ? `<p style="color:var(--text-muted);margin-bottom:16px">Your account is protected with an authenticator app.</p>
             <div style="display:flex;gap:12px;flex-wrap:wrap">
               <button class="btn btn-secondary" id="regen-backup-btn">Regenerate Backup Codes</button>
               <button class="btn btn-danger" id="disable-mfa-btn">Disable MFA</button>
             </div>
             <div id="mfa-action-form" style="margin-top:16px;display:none">
               <div class="form-group">
                 <label class="form-label" id="mfa-action-label">TOTP Code</label>
                 <input class="form-input" id="mfa-action-input" type="text" placeholder="6-digit code" maxlength="8" inputmode="numeric" />
               </div>
               <div id="mfa-action-error" class="form-error" style="display:none"></div>
               <button class="btn btn-primary" id="mfa-action-submit">Confirm</button>
               <button class="btn btn-secondary" id="mfa-action-cancel" style="margin-left:8px">Cancel</button>
             </div>
             <div id="backup-codes-display" style="display:none;margin-top:16px"></div>`
            : `<p style="color:var(--text-muted);margin-bottom:16px">Add an extra layer of security using an authenticator app like Google Authenticator or Authy.</p>
             <button class="btn btn-primary" id="setup-mfa-btn">Set Up MFA</button>
             <div id="mfa-setup-flow" style="display:none;margin-top:16px"></div>`
        }
      </div>
    </div>

    <div class="card bento-full">
      <div class="card-header"><span class="card-title">Active Sessions</span></div>
      <div id="sessions-list">
        ${
          sessions.length === 0
            ? '<p style="color:var(--text-muted)">No active sessions found.</p>'
            : sessions
                .map(
                  (s) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
              <div>
                <div style="font-weight:500">${s.deviceInfo || 'Unknown device'}</div>
                <div style="font-size:0.8rem;color:var(--text-muted)">${new Date(s.createdAt).toLocaleString()}</div>
              </div>
              <button class="btn btn-danger btn-sm revoke-session-btn" data-id="${s.id}">Revoke</button>
            </div>
          `
                )
                .join('')
        }
        ${sessions.length > 0 ? '<button class="btn btn-secondary" id="revoke-all-btn" style="margin-top:12px">Revoke All Other Sessions</button>' : ''}
      </div>
    </div>
  </div>
  `;

  // ── Profile form ──────────────────────────────────────
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-profile-btn');
    btn.classList.add('btn-loading');
    btn.disabled = true;
    try {
      const res = await profileApi.updateProfile({ name: document.getElementById('p-name').value });
      store.save({ ...store.user, name: res.data?.name });
      toast('Profile updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });

  // ── Password form ─────────────────────────────────────
  document.getElementById('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-pw-btn');
    const errEl = document.getElementById('pw-error');
    errEl.style.display = 'none';
    btn.classList.add('btn-loading');
    btn.disabled = true;
    try {
      await profileApi.changePassword({
        currentPassword: document.getElementById('pw-current').value,
        newPassword: document.getElementById('pw-new').value,
      });
      toast('Password changed successfully', 'success');
      document.getElementById('pw-form').reset();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'flex';
    } finally {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });

  // ── MFA flows ─────────────────────────────────────────
  if (!user.mfaEnabled) {
    document.getElementById('setup-mfa-btn')?.addEventListener('click', async () => {
      const flow = document.getElementById('mfa-setup-flow');
      document.getElementById('setup-mfa-btn').style.display = 'none';
      flow.style.display = 'block';
      flow.innerHTML = '<div class="skeleton" style="height:80px"></div>';
      try {
        const res = await mfaApi.setup();
        flow.innerHTML = `
          <p style="color:var(--text-muted);margin-bottom:12px">Scan this QR code with your authenticator app, then enter the 6-digit code below.</p>
          <img src="${res.qrCode}" alt="QR Code" style="width:180px;height:180px;border-radius:8px;margin-bottom:12px" />
          <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">Or enter manually: <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px">${res.secret}</code></p>
          <div class="form-group">
            <label class="form-label">Verification Code</label>
            <input class="form-input" id="mfa-verify-input" type="text" placeholder="000000" maxlength="6" inputmode="numeric" style="max-width:180px" />
          </div>
          <div id="mfa-verify-error" class="form-error" style="display:none"></div>
          <button class="btn btn-primary" id="mfa-verify-btn">Activate MFA</button>
        `;
        document.getElementById('mfa-verify-btn').addEventListener('click', async () => {
          const token = document.getElementById('mfa-verify-input').value.trim();
          const errEl = document.getElementById('mfa-verify-error');
          errEl.style.display = 'none';
          try {
            const r = await mfaApi.verifySetup({ token });
            flow.innerHTML = `
              <p style="color:var(--success,#22c55e);font-weight:600;margin-bottom:12px">✅ MFA enabled! Save these backup codes — they won't be shown again:</p>
              <div style="background:var(--surface-2);border-radius:8px;padding:16px;font-family:monospace;font-size:0.9rem;line-height:2">
                ${r.backupCodes.map((c) => `<div>${c}</div>`).join('')}
              </div>
              <button class="btn btn-secondary" style="margin-top:12px" onclick="location.reload()">Done</button>
            `;
          } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = 'flex';
          }
        });
      } catch (err) {
        flow.innerHTML = `<p style="color:var(--error)">${err.message}</p>`;
      }
    });
  } else {
    // ── Disable MFA ──────────────────────────────────────
    document.getElementById('disable-mfa-btn')?.addEventListener('click', () => {
      const form = document.getElementById('mfa-action-form');
      document.getElementById('mfa-action-label').textContent = 'TOTP Code or Backup Code';
      form.style.display = 'block';
      document.getElementById('disable-mfa-btn').dataset.action = 'disable';
    });

    // ── Regenerate backup codes ──────────────────────────
    document.getElementById('regen-backup-btn')?.addEventListener('click', () => {
      const form = document.getElementById('mfa-action-form');
      document.getElementById('mfa-action-label').textContent = 'TOTP Code to confirm';
      form.style.display = 'block';
      document.getElementById('regen-backup-btn').dataset.active = '1';
    });

    document.getElementById('mfa-action-cancel')?.addEventListener('click', () => {
      document.getElementById('mfa-action-form').style.display = 'none';
      document.getElementById('mfa-action-input').value = '';
    });

    document.getElementById('mfa-action-submit')?.addEventListener('click', async () => {
      const code = document.getElementById('mfa-action-input').value.trim();
      const errEl = document.getElementById('mfa-action-error');
      errEl.style.display = 'none';
      try {
        if (document.getElementById('disable-mfa-btn')?.dataset.action === 'disable') {
          const body = code.length <= 6 ? { token: code } : { backupCode: code };
          await mfaApi.disable(body);
          toast('MFA disabled', 'success');
          location.reload();
        } else {
          const r = await mfaApi.regenerateBackupCodes();
          document.getElementById('mfa-action-form').style.display = 'none';
          const display = document.getElementById('backup-codes-display');
          display.style.display = 'block';
          display.innerHTML = `
            <p style="font-weight:600;margin-bottom:8px">New backup codes (save these):</p>
            <div style="background:var(--surface-2);border-radius:8px;padding:16px;font-family:monospace;line-height:2">
              ${r.backupCodes.map((c) => `<div>${c}</div>`).join('')}
            </div>
          `;
          toast('Backup codes regenerated', 'success');
        }
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'flex';
      }
    });
  }

  // ── Session revocation ────────────────────────────────
  document.querySelectorAll('.revoke-session-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await profileApi.revokeSession(id);
        btn.closest('div[style]').remove();
        toast('Session revoked', 'success');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  document.getElementById('revoke-all-btn')?.addEventListener('click', async () => {
    try {
      await profileApi.revokeAllOtherSessions({});
      toast('All other sessions revoked', 'success');
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
