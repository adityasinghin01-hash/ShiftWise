/* ── SHIFTWISE SCHEDULE BUILDER (manager) ──
 * The heart of ShiftWise (§8.4 S4 · §9 Phase 4). Pick a location + week, then:
 *   • Auto-generate a fair, conflict-free preview → Accept (persist) or Discard
 *   • Add/remove shifts manually (each add is rule-checked by the backend)
 *   • Publish the week (staff can then see their shifts)
 * Grid: rows = active staff, columns = the 7 days of the week.
 */

import { locationApi, staffApi, scheduleApi, shiftApi } from '../api.js';
import { toast } from '../toast.js';
import { mountLayout } from '../layout.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Module state ──
let locations = [];
let staff = [];
let currentLocationId = null;
let weekOffset = 0; // 0 = current week, -1 = last week, +1 = next
let schedule = null;
let shifts = [];
let preview = null; // { shifts, conflicts, fairnessScore } when a generation is pending

function esc(s = '') {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** Monday (UTC) of the current week + weekOffset weeks. */
function weekMonday(offset) {
  const now = new Date();
  const utcMid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(utcMid).getUTCDay() + 6) % 7; // 0=Mon
  return new Date(utcMid - dow * 86400000 + offset * 7 * 86400000);
}
function weekDates(offset) {
  const base = weekMonday(offset).getTime();
  return Array.from({ length: 7 }, (_, d) => new Date(base + d * 86400000));
}
const fmtRange = (dates) => {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${dates[0].toLocaleDateString('en', opts)} – ${dates[6].toLocaleDateString('en', opts)}`;
};

export async function renderSchedule() {
  mountLayout('<div id="sched-body"><div class="card skeleton" style="height:320px"></div></div>', 'schedule');
  try {
    locations = (await locationApi.list()).data || [];
  } catch (err) {
    return fail(err.message || 'Could not load locations');
  }
  if (!locations.length) {
    document.getElementById('sched-body').innerHTML = `<div class="card"><div class="empty-state">
      <div class="empty-state-icon">📍</div>
      <div class="empty-state-title">No locations yet</div>
      <div class="empty-state-desc">Add a location in Settings before building a schedule.</div>
      <a class="btn btn-primary" href="#settings">Go to Settings</a></div></div>`;
    return;
  }
  currentLocationId = currentLocationId || (locations[0].id || locations[0]._id);
  await loadWeek();
}

function fail(msg) {
  const el = document.getElementById('sched-body');
  if (el)
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
    <div class="empty-state-title">Couldn't load the schedule</div>
    <div class="empty-state-desc">${esc(msg)}</div>
    <button class="btn btn-secondary" id="sched-retry">Retry</button></div>`;
  document.getElementById('sched-retry')?.addEventListener('click', renderSchedule);
}

/** Create/load the schedule for the chosen location+week, then its shifts + staff. */
async function loadWeek() {
  preview = null;
  const dates = weekDates(weekOffset);
  try {
    const created = await scheduleApi.create({
      locationId: currentLocationId,
      periodStart: dates[0].toISOString(),
    });
    schedule = created.data;
    const [full, staffRes] = await Promise.all([scheduleApi.get(schedule._id), staffApi.list()]);
    schedule = full.data.schedule;
    shifts = full.data.shifts || [];
    staff = (staffRes.data || []).filter((s) => s.isActive !== false);
  } catch (err) {
    return fail(err.message || 'Could not open this week');
  }
  render();
}

function render() {
  const dates = weekDates(weekOffset);
  const published = schedule?.status === 'published';
  const el = document.getElementById('sched-body');
  if (!el) return;

  const locationOpts = locations
    .map((l) => {
      const id = l.id || l._id;
      return `<option value="${id}"${id === currentLocationId ? ' selected' : ''}>${esc(l.name)}</option>`;
    })
    .join('');

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1 class="page-title">Schedule</h1>
          <p class="page-subtitle">${esc(fmtRange(dates))} · ${
            published
              ? '<span class="badge badge-green">Published</span>'
              : '<span class="badge badge-amber">Draft</span>'
          }${schedule?.fairnessScore != null ? ` · Fairness ${schedule.fairnessScore}%` : ''}</p>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="loc-select" class="input" style="max-width:180px">${locationOpts}</select>
          <button class="btn btn-ghost btn-sm" id="wk-prev">‹ Prev</button>
          <button class="btn btn-ghost btn-sm" id="wk-next">Next ›</button>
          <button class="btn btn-secondary btn-sm" id="gen-btn"${published ? ' disabled' : ''}>✨ Auto-generate</button>
          <button class="btn btn-primary btn-sm" id="pub-btn"${published ? ' disabled' : ''}>Publish</button>
        </div>
      </div>
    </div>
    ${preview ? previewBanner() : ''}
    <div id="conflicts"></div>
    <div class="card" style="overflow-x:auto">
      ${gridHTML(dates)}
    </div>`;

  // Wire toolbar
  document.getElementById('loc-select').addEventListener('change', (e) => {
    currentLocationId = e.target.value;
    loadWeek();
  });
  document.getElementById('wk-prev').addEventListener('click', () => {
    weekOffset--;
    loadWeek();
  });
  document.getElementById('wk-next').addEventListener('click', () => {
    weekOffset++;
    loadWeek();
  });
  document.getElementById('gen-btn').addEventListener('click', doGenerate);
  document.getElementById('pub-btn').addEventListener('click', doPublish);

  if (preview) {
    document.getElementById('accept-btn').addEventListener('click', acceptPreview);
    document.getElementById('discard-btn').addEventListener('click', () => {
      preview = null;
      render();
    });
  }
  renderConflicts();
  wireCells(dates);
}

function previewBanner() {
  const n = preview.shifts.length;
  const c = preview.conflicts.filter((x) => x.type === 'UNDERSTAFFED').length;
  return `<div class="card" style="border-color:var(--warning);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><strong>Preview ready</strong> — ${n} shift${n === 1 ? '' : 's'}, fairness ${preview.fairnessScore}%${
      c ? `, <span style="color:var(--warning)">${c} unfilled</span>` : ''
    }. Accept to save, or discard.</div>
    <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="accept-btn">Accept</button>
    <button class="btn btn-ghost btn-sm" id="discard-btn">Discard</button></div>
  </div>`;
}

function renderConflicts() {
  const box = document.getElementById('conflicts');
  if (!box) return;
  const list = (preview?.conflicts || []).filter((c) => c.type === 'UNDERSTAFFED');
  if (!list.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="card" style="border-color:var(--danger);margin-bottom:12px">
    <div class="card-header"><span class="card-title">Unfilled slots (${list.length})</span></div>
    <ul style="margin:8px 0 0 18px;color:var(--text-secondary);font-size:0.85rem">
      ${list
        .slice(0, 12)
        .map(
          (c) =>
            `<li>${esc(new Date(c.slot.date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }))} · ${esc(c.slot.shiftType)}</li>`
        )
        .join('')}
    </ul></div>`;
}

/** Shift chips to show in a cell = either the pending preview or persisted shifts. */
function cellShifts(staffId, date) {
  const source = preview ? preview.shifts : shifts;
  const k = dayKey(date);
  return source.filter((s) => String(s.staffId) === String(staffId) && dayKey(s.date) === k);
}

function gridHTML(dates) {
  if (!staff.length) {
    return `<div class="empty-state"><div class="empty-state-icon">👥</div>
      <div class="empty-state-title">No staff yet</div>
      <div class="empty-state-desc">Add team members before building a schedule.</div>
      <a class="btn btn-primary" href="#team">Go to Team</a></div>`;
  }
  const head = `<tr><th style="text-align:left;min-width:140px">Staff</th>${dates
    .map((d, i) => `<th style="min-width:110px">${DAYS[i]}<br><span class="text-muted" style="font-weight:400;font-size:0.72rem">${d.getUTCDate()}</span></th>`)
    .join('')}</tr>`;

  // Draft (no preview) = editable (add/remove). Published (no preview) = the
  // day-of view where chips trigger mark-absent → cover. A preview is read-only.
  const published = schedule?.status === 'published';
  const editable = !published && !preview;
  const clickable = !preview;

  const rows = staff
    .map((s) => {
      const cells = dates
        .map((d) => {
          const chips = cellShifts(s._id, d)
            .map((sh) => {
              const cls =
                sh.status === 'absent' ? 'badge-amber' : sh.status === 'covered' ? 'badge-muted' : 'badge-green';
              const suffix = sh.status === 'absent' ? ' ⚠' : sh.status === 'covered' ? ' ✓' : '';
              const title = !clickable ? '' : published ? 'Click: mark absent / cover' : 'Click to remove';
              return `<span class="badge ${cls}" data-shift="${sh._id || ''}" style="display:block;margin:2px 0;cursor:${clickable ? 'pointer' : 'default'}" title="${title}">${esc(sh.startTime)}–${esc(sh.endTime)}${suffix}</span>`;
            })
            .join('');
          const addBtn = !editable
            ? ''
            : `<button class="cell-add" data-staff="${s._id}" data-date="${d.toISOString()}" style="width:100%;background:none;border:1px dashed var(--glass-border);color:var(--text-muted);border-radius:6px;cursor:pointer;font-size:0.75rem;padding:2px">+</button>`;
          return `<td style="vertical-align:top;padding:4px">${chips}${addBtn}</td>`;
        })
        .join('');
      return `<tr><td style="text-align:left"><strong>${esc(s.name)}</strong><br><span class="text-muted" style="font-size:0.72rem">${esc(s.role || '')}</span></td>${cells}</tr>`;
    })
    .join('');

  return `<table class="sched-grid" style="width:100%;border-collapse:collapse;text-align:center;font-size:0.82rem">
    <thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function wireCells(dates) {
  if (preview) return; // preview is read-only until accepted/discarded
  const published = schedule?.status === 'published';

  // Chip click: draft → remove the shift; published → mark absent + find cover.
  document.querySelectorAll('[data-shift]').forEach((chip) => {
    const id = chip.getAttribute('data-shift');
    if (!id) return;
    chip.addEventListener('click', () => (published ? markAbsentFlow(id) : removeShift(id)));
  });

  // "+" to add a shift (draft only).
  if (!published) {
    document.querySelectorAll('.cell-add').forEach((btn) => {
      btn.addEventListener('click', () =>
        openAddShift(btn.getAttribute('data-staff'), btn.getAttribute('data-date'), dates)
      );
    });
  }
}

async function removeShift(id) {
  if (!confirm('Remove this shift?')) return;
  try {
    await shiftApi.remove(id);
    shifts = shifts.filter((s) => String(s._id) !== String(id));
    render();
  } catch (err) {
    toast(err.message || 'Could not remove shift', 'error');
  }
}

/** Published-schedule day-of flow: mark a shift absent, then pick a cover. */
async function markAbsentFlow(shiftId) {
  if (!confirm('Mark this shift absent and find cover?')) return;
  let candidates;
  try {
    const res = await shiftApi.markAbsent(shiftId);
    candidates = res.data.candidates || [];
    const s = shifts.find((x) => String(x._id) === String(shiftId));
    if (s) s.status = 'absent';
  } catch (err) {
    return toast(err.message || 'Could not mark absent', 'error');
  }
  if (!candidates.length) {
    render();
    return toast('Marked absent — no eligible staff can cover this shift.', 'warning');
  }
  const opts = candidates
    .map((c, i) => `${i + 1}) ${c.name} — reliability ${c.reliabilityScore}${c.canAutoClaim ? '' : ' ⚠ below gate'}`)
    .join('\n');
  const pick = prompt(`Marked absent. Pick a cover:\n${opts}\n\nEnter 1–${candidates.length}:`, '1');
  render();
  if (!pick) return;
  const chosen = candidates[Number(pick) - 1];
  if (chosen) assignCoverFlow(shiftId, chosen.staffId);
}

async function assignCoverFlow(shiftId, staffId, overrideReason) {
  try {
    await shiftApi.assignCover(shiftId, { staffId, overrideReason });
    const s = shifts.find((x) => String(x._id) === String(shiftId));
    if (s) {
      s.status = 'covered';
      s.coveredBy = staffId;
    }
    toast('Cover assigned ✓', 'success');
    render();
  } catch (err) {
    // Reliability gate / anti-favoritism → backend asks for a reason.
    if (err.data?.code === 'override_required') {
      const reason = prompt(`${err.message}\n\nEnter a reason to override:`);
      if (reason) return assignCoverFlow(shiftId, staffId, reason);
      return;
    }
    toast(err.message || 'Could not assign cover', 'error');
  }
}

function locationShiftTypes() {
  const loc = locations.find((l) => (l.id || l._id) === currentLocationId);
  return loc?.settings?.shiftTypes || [{ name: 'custom', startTime: '09:00', endTime: '17:00' }];
}

function openAddShift(staffId, dateISO, dates) {
  const types = locationShiftTypes();
  const options = types.map((t, i) => `${i + 1}) ${t.name} ${t.startTime}–${t.endTime}`).join('\n');
  const choice = prompt(`Add shift — pick a type:\n${options}\n\nEnter a number 1–${types.length}:`, '1');
  if (!choice) return;
  const t = types[Number(choice) - 1];
  if (!t) return;
  const d = new Date(dateISO);
  const dow = (d.getUTCDay() + 6) % 7;
  addShift(staffId, dateISO, t, dow >= 5);
}

async function addShift(staffId, dateISO, type, isWeekend) {
  try {
    const res = await scheduleApi.addShift(schedule._id, {
      staffId,
      date: dateISO,
      startTime: type.startTime,
      endTime: type.endTime,
      shiftType: type.name,
      isWeekend,
    });
    shifts.push(res.data);
    if (res.verdict?.soft?.length) toast(res.verdict.soft[0].message, 'warning');
    else toast('Shift added', 'success');
    render();
  } catch (err) {
    // 422 hard-rule block surfaces the reason from the verdict.
    const reason = err.data?.verdict?.hard?.[0]?.message || err.message || 'Could not add shift';
    toast(reason, 'error');
  }
}

async function doGenerate() {
  const btn = document.getElementById('gen-btn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    // Backend shape is { preview: [...shifts], conflicts, fairnessScore } —
    // normalize to { shifts, conflicts, fairnessScore } used throughout this page.
    const d = (await scheduleApi.generate(schedule._id)).data;
    preview = { shifts: d.preview || [], conflicts: d.conflicts || [], fairnessScore: d.fairnessScore };
    render();
    toast(`Preview: ${preview.shifts.length} shifts, fairness ${preview.fairnessScore}%`, 'success');
  } catch (err) {
    toast(err.message || 'Generation failed', 'error');
    btn.disabled = false;
    btn.textContent = '✨ Auto-generate';
  }
}

async function acceptPreview() {
  try {
    const res = await scheduleApi.apply(schedule._id, {
      shifts: preview.shifts,
      fairnessScore: preview.fairnessScore,
    });
    schedule = res.data.schedule;
    shifts = res.data.shifts || [];
    preview = null;
    toast('Schedule saved', 'success');
    render();
  } catch (err) {
    toast(err.message || 'Could not save', 'error');
  }
}

async function doPublish() {
  if (!confirm('Publish this schedule? Staff will be able to see their shifts.')) return;
  try {
    const res = await scheduleApi.publish(schedule._id);
    schedule = res.data.schedule;
    toast('Schedule published 🎉', 'success');
    render();
  } catch (err) {
    toast(err.message || 'Publish failed', 'error');
  }
}
