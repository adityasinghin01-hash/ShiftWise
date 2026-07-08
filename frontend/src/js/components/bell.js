/* ── SHIFTWISE NOTIFICATION BELL ──
 * S8.5 · §9 Phase 9. Unread badge, dropdown, mark-read/all, ~30s poll, and
 * (when VAPID is configured) Web Push registration. Mounted by layout.js.
 */

import { notificationApi } from '../api.js';
import { toast } from '../toast.js';

let pollTimer = null;

function esc(s = '') {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
function ago(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function bellHTML() {
  return `
    <button id="notif-bell" title="Notifications" aria-label="Notifications"
      style="position:relative;margin-left:auto;background:none;border:none;color:inherit;cursor:pointer;padding:6px">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span id="notif-badge" style="display:none;position:absolute;top:0;right:0;min-width:16px;height:16px;
        padding:0 4px;border-radius:8px;background:var(--danger,#e5484d);color:#fff;font-size:10px;line-height:16px;text-align:center">0</span>
    </button>
    <div id="notif-dropdown" style="display:none;position:absolute;top:52px;left:12px;right:12px;z-index:50;
      max-height:60vh;overflow:auto;background:var(--surface,#fff);border:1px solid var(--border,#e5e7eb);
      border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18)"></div>`;
}

export function initBell() {
  const bell = document.getElementById('notif-bell');
  const dropdown = document.getElementById('notif-dropdown');
  if (!bell || !dropdown) return;

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.style.display === 'block';
    dropdown.style.display = open ? 'none' : 'block';
    if (!open) refresh();
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== bell) dropdown.style.display = 'none';
  });

  refresh();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 30000); // ~30s poll

  registerPush();
}

async function refresh() {
  try {
    const res = await notificationApi.list();
    const { items = [], unreadCount = 0 } = res.data || {};
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
      badge.style.display = unreadCount > 0 ? 'block' : 'none';
    }
    renderDropdown(items, unreadCount);
  } catch {
    /* silent — bell is best-effort */
  }
}

function renderDropdown(items, unreadCount) {
  const dd = document.getElementById('notif-dropdown');
  if (!dd || dd.style.display === 'none') {
    // still refresh contents so it's ready when opened
    if (dd) dd.dataset.pending = JSON.stringify({ items, unreadCount });
  }
  const target = dd;
  if (!target) return;
  target.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border,#e5e7eb)">
      <strong>Notifications</strong>
      ${unreadCount ? `<button id="notif-readall" style="background:none;border:none;color:var(--primary,#4ea864);cursor:pointer;font-size:12px">Mark all read</button>` : ''}
    </div>
    ${
      items.length
        ? items
            .map(
              (n) => `
      <div class="notif-item" data-id="${n._id}" style="padding:10px 12px;border-bottom:1px solid var(--border,#eee);cursor:${n.readAt ? 'default' : 'pointer'};background:${n.readAt ? 'transparent' : 'rgba(78,168,100,.06)'}">
        <div style="font-weight:${n.readAt ? '400' : '600'};font-size:13px">${esc(n.title)}</div>
        <div style="font-size:12px;color:var(--muted,#6b7280);margin-top:2px">${esc(n.body || '')}</div>
        <div style="font-size:11px;color:var(--muted,#9ca3af);margin-top:4px">${ago(n.createdAt)}</div>
      </div>`
            )
            .join('')
        : `<div style="padding:24px;text-align:center;color:var(--muted,#9ca3af);font-size:13px">No notifications</div>`
    }`;

  target.querySelector('#notif-readall')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await notificationApi.markAllRead();
      refresh();
    } catch {
      toast('Failed to mark all read', 'error');
    }
  });
  target.querySelectorAll('.notif-item').forEach((el) =>
    el.addEventListener('click', async () => {
      const item = items.find((n) => String(n._id) === el.dataset.id);
      if (!item || item.readAt) return;
      try {
        await notificationApi.markRead(el.dataset.id);
        refresh();
      } catch {
        /* ignore */
      }
    })
  );
}

/* Web Push — only activates when a VAPID public key is configured (Phase 10/prod). */
function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function registerPush() {
  const key = import.meta.env?.VITE_VAPID_PUBLIC_KEY;
  if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if ((await Notification.requestPermission()) !== 'granted') return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key),
    });
    await notificationApi.subscribePush(sub.toJSON());
  } catch {
    /* best-effort — never break the app over push */
  }
}
