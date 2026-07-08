/* ── SHIFTWISE ANALYTICS (owner) ──
 * S7 (UI Spec) · §9 Phase 8. Labour + coverage + fairness for a month, a per-staff
 * hours chart (Chart.js), and badge awards. Empty state when no week is published.
 */

import Chart from 'chart.js/auto';
import { analyticsApi } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

function esc(s = '') {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
const money = (n) => (store.currency === 'INR' ? '₹' : '$') + Number(n || 0).toLocaleString();

let chart = null;
let currentMonth = ''; // YYYY-MM ('' = current)

export async function renderAnalytics() {
  const html = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Analytics</h1>
          <p class="page-subtitle">Hours, labour cost, coverage & fairness</p>
        </div>
        <div class="page-actions">
          <input type="month" id="an-month" class="input" />
        </div>
      </div>
    </div>
    <div id="an-body"><div class="stats-grid">${Array(4).fill('<div class="stat-card skeleton-card skeleton"></div>').join('')}</div></div>
  `;
  mountLayout(html, 'analytics');
  const mi = document.getElementById('an-month');
  if (mi) mi.addEventListener('change', () => { currentMonth = mi.value; load(); });
  load();
}

async function load() {
  const body = document.getElementById('an-body');
  try {
    const res = await analyticsApi.get('all', currentMonth || undefined);
    render(res.data);
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">Couldn't load analytics</div>
      <div class="empty-state-desc">${esc(err.message || '')}</div></div>`;
  }
}

function tile(label, value, tone = 'var(--primary)') {
  return `<div class="stat-card"><div class="stat-label">${label}</div>
    <div class="stat-value" style="color:${tone}">${value}</div></div>`;
}

function render(d) {
  const body = document.getElementById('an-body');
  if (!body) return;

  if (!d.hasData) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-title">No data yet</div>
      <div class="empty-state-desc">Publish a schedule for this month to see analytics.</div></div>`;
    return;
  }

  const t = d.totals;
  const covTone = t.coveragePercent >= 90 ? 'var(--success)' : t.coveragePercent >= 70 ? 'var(--warning)' : 'var(--danger)';
  body.innerHTML = `
  <div class="stats-grid">
    ${tile('Total hours', t.totalHours)}
    ${tile('Labour cost', money(t.laborCost), 'var(--accent)')}
    ${tile('Coverage', t.coveragePercent + '%', covTone)}
    ${tile('Late / No-show', `${t.lateArrivals} / ${t.noShows}`, (t.noShows ? 'var(--danger)' : 'var(--primary)'))}
  </div>

  <div class="bento-grid" style="margin-top:16px">
    <div class="card bento-half">
      <div class="card-header"><span class="card-title">Hours by staff</span></div>
      <div style="position:relative;height:260px"><canvas id="hours-chart"></canvas></div>
      <div class="page-subtitle" style="margin-top:8px">Fairness spread: ${d.fairness.spread}h (max ${d.fairness.maxHours} · min ${d.fairness.minHours})</div>
    </div>

    <div class="card bento-half">
      <div class="card-header"><span class="card-title">Per staff</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Hours</th><th>Cost</th><th>Rel.</th><th></th></tr></thead>
        <tbody>
          ${d.perStaff.map((s) => `<tr>
            <td>${esc(s.name)}</td>
            <td>${s.hours}</td>
            <td>${money(s.cost)}</td>
            <td>${s.reliabilityScore}</td>
            <td><button class="btn btn-ghost btn-sm" data-badge="${s.staffId}" data-name="${esc(s.name)}">🏅 Badge</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
  </div>`;

  // Chart
  const ctx = document.getElementById('hours-chart');
  if (chart) { chart.destroy(); chart = null; }
  if (ctx) {
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.perStaff.map((s) => s.name),
        datasets: [{ label: 'Hours', data: d.perStaff.map((s) => s.hours), backgroundColor: '#4ea864' }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  }

  // Badge awards
  body.querySelectorAll('[data-badge]').forEach((b) =>
    b.addEventListener('click', () => award(b.dataset.badge, b.dataset.name))
  );
}

async function award(staffId, name) {
  const badge = window.prompt(`Award a badge to ${name}:`, 'Cover Hero');
  if (!badge || !badge.trim()) return;
  try {
    await analyticsApi.awardBadge(staffId, badge.trim());
    toast(`🏅 Awarded "${badge.trim()}" to ${name}`, 'success');
  } catch (err) {
    toast(err.message || 'Failed to award badge', 'error');
  }
}
