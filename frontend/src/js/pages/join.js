/* ── SHIFTWISE JOIN PAGE ──
 * Public invite-acceptance screen. Reached via /#join?token=RAW from the
 * invite email. Validates the token, lets the user set a password, creates
 * their account, logs them in, and routes to the dashboard.
 * §8.4 S3 (UI Spec) · §9 Phase 2
 */

import { joinApi, auth } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { navigate } from '../router.js';

const getApp = () => document.getElementById('app');

const logoSVG = `
  <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
    <rect width="48" height="48" rx="24" fill="rgba(45,110,31,0.2)" stroke="rgba(78,168,100,0.5)" stroke-width="1.5"/>
    <circle cx="24" cy="24" r="10" stroke="#4ea864" stroke-width="1.5" fill="none"/>
    <line x1="24" y1="24" x2="24" y2="16" stroke="#4ea864" stroke-width="2" stroke-linecap="round"/>
    <line x1="24" y1="24" x2="30" y2="27" stroke="#4ea864" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;

/** Get the invite token — from the stashed ?invite= param (preferred) or hash query (fallback) */
function getToken() {
  // Preferred: token captured from the ?invite= query param on bootstrap
  const stashed = sessionStorage.getItem('shiftwise_invite_token');
  if (stashed) return stashed;
  // Fallback: hash query form #join?token=abc
  const hash = location.hash.slice(1);
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  return new URLSearchParams(hash.slice(qIndex + 1)).get('token');
}

function shell(inner) {
  getApp().innerHTML = `<div class="ob-wrap"><div class="ob-card" style="max-width:440px">
    <div class="ob-logo">${logoSVG}<span>ShiftWise</span></div>${inner}</div></div>`;
}

export async function renderJoin() {
  const token = getToken();
  if (!token) return shell(invalidState('No invite token found in this link.'));

  shell(`<div class="ob-body"><p class="ob-sub">Checking your invite…</p></div>`);

  let info;
  try {
    info = (await joinApi.validate(token)).data;
  } catch (err) {
    return shell(invalidState(err.message || 'This invite is invalid or has expired.'));
  }

  // Valid invite → show the accept form
  shell(`
    <h2 class="ob-title">Join ${escape(info.businessName)}</h2>
    <p class="ob-sub">You've been invited as <strong>${escape(info.email)}</strong>. Set a password to create your account.</p>
    <label class="ob-field"><span>Your name</span><input id="j-name" type="text" placeholder="Full name" /></label>
    <label class="ob-field"><span>Password</span><input id="j-pass" type="password" placeholder="At least 12 characters" /></label>
    <label class="ob-field"><span>Confirm password</span><input id="j-pass2" type="password" /></label>
    <button class="btn btn-primary" id="j-go" style="width:100%;margin-top:8px">Accept invite &amp; continue</button>
    <p class="text-muted" style="font-size:0.75rem;text-align:center;margin-top:12px">Already have an account with this email? Just set any password — we'll link it.</p>
  `);

  document.getElementById('j-go').addEventListener('click', () => accept(token, info));
}

async function accept(token, info) {
  const name = document.getElementById('j-name').value.trim();
  const pass = document.getElementById('j-pass').value;
  const pass2 = document.getElementById('j-pass2').value;

  if (pass.length < 12) return toast('Password must be at least 12 characters', 'error');
  if (pass !== pass2) return toast('Passwords do not match', 'error');

  const btn = document.getElementById('j-go');
  btn.disabled = true; btn.textContent = 'Creating your account…';

  try {
    const res = await joinApi.accept({ token, password: pass, name, source: 'web' });
    // Clear the stashed invite token — it's now used
    sessionStorage.removeItem('shiftwise_invite_token');
    // Log the new staff member in (mirror the auth flow)
    if (res.accessToken) auth.setToken(res.accessToken);
    if (res.user) store.save(res.user);
    store.onboarding = 'ok';
    store.membership = 'staff'; // staff join — never an owner
    toast('Welcome to the team! 🎉', 'success');
    navigate('dashboard');
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Accept invite & continue';
    toast(err.message || 'Could not accept invite', 'error');
  }
}

function invalidState(msg) {
  return `<div class="ob-body">
    <h2 class="ob-title">Invite unavailable</h2>
    <p class="ob-sub">${escape(msg)}</p>
    <a href="#login" class="btn btn-secondary" style="width:100%">Go to login</a>
    <p class="text-muted" style="font-size:0.75rem;text-align:center;margin-top:12px">Ask your manager to send a fresh invite.</p>
  </div>`;
}

function escape(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
