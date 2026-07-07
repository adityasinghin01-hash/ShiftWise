// services/schedulerService.js
// The ShiftWise scheduling algorithm — constraint solver + fairness scoring.
// §6 Scheduling Algorithm — Phase 0 (skeleton), fully implemented in Phase 4.
//
// ARCHITECTURE:
//   checkAssignment()   — §6.2 — single source of truth for rule validation.
//                         Called by: scheduler, swap validation, time-off coverage
//                         check, absence cover. ONE place to add/change a rule.
//   generateSchedule()  — §6.3 — 5-phase generator, returns preview (never persists).
//   fairnessScore()     — §6.4 — assignment priority scoring.
//   reliabilityScore()  — §6.6 — auto-cover gate scoring.
//
// DETERMINISM: same inputs always return identical outputs (no randomness in prod).
// That determinism is the product promise: "every rule is satisfied, every time."

'use strict';

// ── Rule codes ────────────────────────────────────────────
// Hard violations (block assignment); soft warnings (allow but flag).
// Centralised here so controllers and tests import from one place.
const HARD = {
  UNAVAILABLE: 'UNAVAILABLE', // staff not available on that day/time
  TIME_OFF: 'TIME_OFF', // approved time-off covers this date
  DOUBLE_BOOKED: 'DOUBLE_BOOKED', // overlaps an existing shift
  INCOMPATIBLE_PAIR: 'INCOMPATIBLE_PAIR', // co-worker conflict in the same slot
  REST_VIOLATION: 'REST_VIOLATION', // insufficient rest between shifts
  MAX_CONSECUTIVE: 'MAX_CONSECUTIVE', // would exceed max consecutive days
  ROLE_MISMATCH: 'ROLE_MISMATCH', // required role not satisfied
};

const SOFT = {
  OVER_HOURS: 'OVER_HOURS', // would exceed max weekly hours (soft — manager can override)
  THIN_COVERAGE: 'THIN_COVERAGE', // slot close to minimum staffing
};

// ── Exported constants ────────────────────────────────────
module.exports.HARD = HARD;
module.exports.SOFT = SOFT;

// ── Time helpers ──────────────────────────────────────────
// Shifts store 'HH:MM' strings + a UTC-midnight date. To compare/overlap them
// we project onto an absolute millisecond timeline. Night shifts that cross
// midnight (end <= start, e.g. 22:00–02:00) roll the end into the next day.
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** 'HH:MM' → minutes since 00:00. */
function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Absolute [start, end) ms interval for a shift, handling midnight crossover. */
function shiftInterval(dateMs, startTime, endTime) {
  const startMin = timeToMinutes(startTime);
  let endMin = timeToMinutes(endTime);
  if (endMin <= startMin) endMin += 1440; // crosses midnight → next day
  return { startAbs: dateMs + startMin * MINUTE_MS, endAbs: dateMs + endMin * MINUTE_MS };
}

/** Integer day index (UTC) — for consecutive-day runs and same-day checks. */
function dayIndex(dateMs) {
  return Math.floor(dateMs / DAY_MS);
}

// ─────────────────────────────────────────────────────────
// checkAssignment
// ─────────────────────────────────────────────────────────
/**
 * Validates whether assigning a staff member to a slot is legal.
 * Returns hard violations (block) and soft warnings (allow but flag).
 * MUST be called before every assignment — by the scheduler AND by
 * swap/time-off/cover flows so rule logic is never duplicated.
 *
 * @param {object} staffState   — StaffState in-memory object (§6.1)
 * @param {object} slot         — Slot in-memory object (§6.1)
 * @param {object} ctx          — GenerationContext (§6.1)
 * @returns {{ hard: Array<{code,message}>, soft: Array<{code,message}> }}
 *
 * Implements all 7 HARD rules (§6.2) + the OVER_HOURS SOFT warning. Any rule
 * whose config value is 0/null/[] is treated as "not enforced" and skipped.
 */
const checkAssignment = (staffState, slot, ctx) => {
  const hard = [];
  const soft = [];
  const rules = (ctx && ctx.rules) || {};
  const ss = staffState || {};
  const dateMs = new Date(slot.date).getTime();
  // A real slot always carries a valid date; this guard just keeps degenerate
  // input from crashing (toISOString) or looping (the consecutive-day scan).
  const hasDate = !Number.isNaN(dateMs);
  const cand = shiftInterval(dateMs, slot.startTime, slot.endTime);

  // ── HARD 1: UNAVAILABLE ──────────────────────────────────
  // Not available that weekday, or the shift falls outside their stated window.
  const avail = ss.availabilityIndex && ss.availabilityIndex.get(slot.dayOfWeek);
  if (!avail || avail.available === false) {
    hard.push({
      code: HARD.UNAVAILABLE,
      message: `${ss.name || 'Staff'} is not available on this day.`,
    });
  } else if (avail.start && avail.end) {
    // Optional preferred window — enforce only when both bounds are set.
    const slotStart = timeToMinutes(slot.startTime);
    let slotEnd = timeToMinutes(slot.endTime);
    if (slotEnd <= slotStart) slotEnd += 1440;
    const winStart = timeToMinutes(avail.start);
    let winEnd = timeToMinutes(avail.end);
    if (winEnd <= winStart) winEnd += 1440;
    if (slotStart < winStart || slotEnd > winEnd) {
      hard.push({
        code: HARD.UNAVAILABLE,
        message: `Shift time is outside ${ss.name || 'staff'}'s available window.`,
      });
    }
  }

  // ── HARD 2: TIME_OFF ─────────────────────────────────────
  const dateISO = hasDate ? new Date(dateMs).toISOString().slice(0, 10) : null;
  if (dateISO && ss.timeOffDays && ss.timeOffDays.has(dateISO)) {
    hard.push({
      code: HARD.TIME_OFF,
      message: `${ss.name || 'Staff'} has approved time off on this date.`,
    });
  }

  // ── HARD 3 (DOUBLE_BOOKED) + HARD 5 (REST_VIOLATION) ─────
  // One pass over already-assigned shifts. Overlap implies no rest, so we don't
  // double-report the same pair. Each code is reported at most once.
  const minRestMin = (rules.minRestHours || 0) * 60;
  let doubleBooked = false;
  let restViolation = false;
  for (const a of ss.assignedShifts || []) {
    const aMs = new Date(a.date).getTime();
    const ai = shiftInterval(aMs, a.startTime, a.endTime);
    const overlaps = cand.startAbs < ai.endAbs && ai.startAbs < cand.endAbs;
    if (overlaps) {
      doubleBooked = true;
      continue;
    }
    if (minRestMin > 0) {
      const gapMin =
        cand.startAbs >= ai.endAbs
          ? (cand.startAbs - ai.endAbs) / MINUTE_MS
          : (ai.startAbs - cand.endAbs) / MINUTE_MS;
      if (gapMin < minRestMin) restViolation = true;
    }
  }
  if (doubleBooked) {
    hard.push({ code: HARD.DOUBLE_BOOKED, message: 'Overlaps a shift already assigned that day.' });
  }
  if (restViolation) {
    hard.push({
      code: HARD.REST_VIOLATION,
      message: `Less than ${rules.minRestHours}h rest from another shift.`,
    });
  }

  // ── HARD 4: INCOMPATIBLE_PAIR ────────────────────────────
  // A peer working the same day + shiftType who is on this staff's incompatible list.
  if (
    hasDate &&
    ss.incompatibleWith &&
    ss.incompatibleWith.size &&
    Array.isArray(ctx && ctx.slots)
  ) {
    const candDay = dayIndex(dateMs);
    const clash = ctx.slots.some(
      (other) =>
        other !== slot &&
        other.assignedStaffId &&
        other.shiftType === slot.shiftType &&
        dayIndex(new Date(other.date).getTime()) === candDay &&
        ss.incompatibleWith.has(String(other.assignedStaffId))
    );
    if (clash) {
      hard.push({
        code: HARD.INCOMPATIBLE_PAIR,
        message: 'Assigned alongside an incompatible teammate.',
      });
    }
  }

  // ── HARD 6: MAX_CONSECUTIVE ──────────────────────────────
  if (hasDate && (rules.maxDaysConsecutive || 0) > 0) {
    const days = new Set(
      (ss.assignedShifts || []).map((a) => dayIndex(new Date(a.date).getTime()))
    );
    const candDay = dayIndex(dateMs);
    days.add(candDay);
    let run = 1;
    for (let d = candDay - 1; days.has(d); d--) run++;
    for (let d = candDay + 1; days.has(d); d++) run++;
    if (run > rules.maxDaysConsecutive) {
      hard.push({
        code: HARD.MAX_CONSECUTIVE,
        message: `Would exceed ${rules.maxDaysConsecutive} consecutive working days.`,
      });
    }
  }

  // ── HARD 7: ROLE_MISMATCH ────────────────────────────────
  if (slot.requiredRole && ss.role !== slot.requiredRole) {
    hard.push({
      code: HARD.ROLE_MISMATCH,
      message: `This slot needs role "${slot.requiredRole}".`,
    });
  }

  // ── SOFT: OVER_HOURS ─────────────────────────────────────
  // Cap = the tighter of staff.maxHoursPerWeek and rules.maxHoursPerWeek.
  // A 0/null value means "no cap" (rule not enforced), per §6.1 optionality.
  const staffCap = ss.maxHoursPerWeek || Infinity;
  const ruleCap = rules.maxHoursPerWeek || Infinity;
  const cap = Math.min(staffCap, ruleCap);
  if (cap !== Infinity) {
    const shiftHours = (cand.endAbs - cand.startAbs) / (60 * MINUTE_MS);
    if ((ss.hoursAssigned || 0) + shiftHours > cap) {
      soft.push({ code: SOFT.OVER_HOURS, message: `Would exceed ${cap}h this week.` });
    }
  }

  return { hard, soft };
};
module.exports.checkAssignment = checkAssignment;

// ─────────────────────────────────────────────────────────
// generateSchedule
// ─────────────────────────────────────────────────────────
/**
 * Runs the 5-phase constraint-satisfaction algorithm and returns a PREVIEW.
 * NEVER persists to the database — caller decides to accept or discard.
 * Respects shift.locked=true (pre-applied in Phase 2, never moved).
 *
 * @param {string|ObjectId} scheduleId  — The draft Schedule to generate for
 * @returns {Promise<{ preview: Shift[], conflicts: Conflict[], fairnessScore: number }>}
 *
 * Phase 4 will implement:
 *   Phase 1 — slot generation
 *   Phase 2 — pre-apply locked shifts
 *   Phase 3 — eligibility + fairness scoring
 *   Phase 4 — greedy assignment
 *   Phase 5 — validate + backtrack (max 3 attempts)
 */
const generateSchedule = async (scheduleId) => {
  // Lazy requires (keep the pure core importable without pulling in models).
  const Schedule = require('../models/Schedule');
  const Location = require('../models/Location');
  const StaffMember = require('../models/StaffMember');
  const Availability = require('../models/Availability');
  const StaffMetrics = require('../models/StaffMetrics');
  const TimeOffRequest = require('../models/TimeOffRequest');
  const Shift = require('../models/Shift');
  const { startOfWeek, resolveAvailability } = require('../utils/weekUtils');

  const schedule = await Schedule.findById(scheduleId);
  if (!schedule) throw new Error('SCHEDULE_NOT_FOUND');
  const location = await Location.findById(schedule.locationId);
  if (!location) throw new Error('LOCATION_NOT_FOUND');

  const weekStartsOn = 0; // app convention: 0 = Monday
  const baseMs = startOfWeek(schedule.periodStart, weekStartsOn).getTime();
  const weekDates = Array.from({ length: 7 }, (_, d) => new Date(baseMs + d * DAY_MS));
  const weekEndMs = baseMs + 7 * DAY_MS;

  // Active staff at this location (tenant-scoped).
  const staff = await StaffMember.find({
    businessId: schedule.businessId,
    locationIds: schedule.locationId,
    isActive: true,
  });
  const staffIds = staff.map((s) => s._id);
  const idStr = (v) => String(v);

  const [avails, timeOffs, metrics] = await Promise.all([
    Availability.find({ staffId: { $in: staffIds }, locationId: schedule.locationId }),
    TimeOffRequest.find({
      businessId: schedule.businessId,
      staffId: { $in: staffIds },
      status: 'approved',
      startDate: { $lt: new Date(weekEndMs) },
      endDate: { $gte: new Date(baseMs) },
    }),
    StaffMetrics.find({
      staffId: { $in: staffIds },
      'period.year': new Date().getFullYear(),
      'period.month': new Date().getMonth() + 1,
    }),
  ]);

  const availByStaff = new Map(avails.map((a) => [idStr(a.staffId), a]));
  const metricsByStaff = new Map(metrics.map((m) => [idStr(m.staffId), m]));

  // Expand approved time-off ranges into a per-staff Set of 'YYYY-MM-DD' days.
  const timeOffByStaff = new Map();
  for (const t of timeOffs) {
    const set = timeOffByStaff.get(idStr(t.staffId)) || new Set();
    for (
      let ms = new Date(t.startDate).getTime();
      ms <= new Date(t.endDate).getTime();
      ms += DAY_MS
    ) {
      set.add(new Date(ms).toISOString().slice(0, 10));
    }
    timeOffByStaff.set(idStr(t.staffId), set);
  }

  // Incompatible pairs (location setting) → symmetric adjacency map.
  const incompatible = new Map();
  for (const pair of location.settings?.incompatiblePairs || []) {
    const [a, b] = pair.map(idStr);
    if (!incompatible.has(a)) incompatible.set(a, new Set());
    if (!incompatible.has(b)) incompatible.set(b, new Set());
    incompatible.get(a).add(b);
    incompatible.get(b).add(a);
  }

  // Build StaffStates.
  const staffStates = new Map();
  for (const s of staff) {
    const av = availByStaff.get(idStr(s._id));
    const resolved = resolveAvailability(av, schedule.periodStart, weekStartsOn);
    const availabilityIndex = new Map();
    for (const ds of resolved) {
      availabilityIndex.set(ds.dayOfWeek, {
        available: ds.available !== false,
        start: ds.preferredStart,
        end: ds.preferredEnd,
      });
    }
    const m = metricsByStaff.get(idStr(s._id));
    staffStates.set(idStr(s._id), {
      staffId: idStr(s._id),
      name: s.name,
      role: s.role,
      maxHoursPerWeek: s.maxHoursPerWeek || 0,
      manuallyManaged: s.manuallyManaged,
      availabilityIndex,
      timeOffDays: timeOffByStaff.get(idStr(s._id)) || new Set(),
      incompatibleWith: incompatible.get(idStr(s._id)) || new Set(),
      assignedShifts: [],
      hoursAssigned: 0,
      weekendHoursAssigned: 0,
      nightHoursAssigned: 0,
      histWeekendHours: m?.weekendHours || 0,
      histNightHours: m?.nightHours || 0,
      histTotalHours: m?.totalHours || 0,
      timeOffRequestedCount: m?.timeOffDaysTaken || 0,
    });
  }

  // Slots + pre-applied locked shifts (immovable).
  const slots = generateSlots(location, weekDates);
  const lockedShifts = await Shift.find({ scheduleId, locked: true });
  for (const ls of lockedShifts) {
    const lsDay = dayIndex(new Date(ls.date).getTime());
    const match = slots.find(
      (sl) =>
        !sl.assignedStaffId &&
        sl.shiftType === ls.shiftType &&
        dayIndex(new Date(sl.date).getTime()) === lsDay
    );
    if (match) match.assignedStaffId = idStr(ls.staffId);
  }

  // Team averages from history drive the "owed" fairness comparison.
  const arr = [...staffStates.values()];
  const avg = (key) => (arr.length ? arr.reduce((a, ss) => a + (ss[key] || 0), 0) / arr.length : 0);
  const ctx = {
    rules: location.settings || {},
    slots,
    staffStates,
    avgWeekendHours: avg('histWeekendHours'),
    avgNightHours: avg('histNightHours'),
    avgTotalHours: avg('histTotalHours'),
  };

  const { conflicts, fairnessScore } = assignSlots(ctx);

  // Map assigned seats → preview Shift shapes (NOT persisted — caller decides).
  const preview = slots
    .filter((sl) => sl.assignedStaffId)
    .map((sl) => ({
      scheduleId: schedule._id,
      businessId: schedule.businessId,
      locationId: schedule.locationId,
      staffId: sl.assignedStaffId,
      date: sl.date,
      startTime: sl.startTime,
      endTime: sl.endTime,
      shiftType: sl.shiftType,
      isWeekend: sl.isWeekend,
      isNight: sl.isNight,
      locked: false,
    }));

  return { preview, conflicts, fairnessScore };
};
module.exports.generateSchedule = generateSchedule;

// ─────────────────────────────────────────────────────────
// fairnessScore
// ─────────────────────────────────────────────────────────
/**
 * Computes assignment priority for one staff member on one slot.
 * Higher score = more "owed" an unpopular shift = assigned first.
 * Formula (§6.4):
 *   base = (avgWeekend - myWeekend)*2 + (avgNight - myNight)*1.5
 *        + (avgHours - myHours)*1 + (timeOffRequestedCount * -0.5)
 *   if slot.isWeekend: base += (avgWeekend - myWeekend)*1
 *   if slot.isNight:   base += (avgNight - myNight)*0.75
 *
 * @param {object} staffState — StaffState in-memory object
 * @param {object} slot       — Slot in-memory object
 * @param {object} ctx        — GenerationContext with avg* values
 * @returns {number}
 *
 * Phase 4 will implement the full formula. Stub returns 0.
 */
const fairnessScore = (staffState, slot, ctx) => {
  const ss = staffState || {};
  const c = ctx || {};
  // "Owed" = how far below the team average this person is on each dimension.
  // Higher score → assigned first. Weekend/night carry extra weight so the
  // least-burdened staff pick up the unpopular shifts first.
  const owedWeekend = (c.avgWeekendHours || 0) - (ss.totalWeekendHours || 0);
  const owedNight = (c.avgNightHours || 0) - (ss.totalNightHours || 0);
  const owedTotal = (c.avgTotalHours || 0) - (ss.totalHoursAll || 0);

  let base =
    owedWeekend * 2.0 + owedNight * 1.5 + owedTotal * 1.0 + (ss.timeOffRequestedCount || 0) * -0.5;

  if (slot && slot.isWeekend) base += owedWeekend * 1.0;
  if (slot && slot.isNight) base += owedNight * 0.75;

  return base;
};
module.exports.fairnessScore = fairnessScore;

// ─────────────────────────────────────────────────────────
// reliabilityScore
// ─────────────────────────────────────────────────────────
/**
 * Computes a 0–100 reliability score from a StaffMetrics record.
 * Gates who can auto-claim cover shifts (threshold: score >= 70).
 * Formula (§6.6, trailing 90 days):
 *   score = clamp(0, 100, 100 - 20*noShows - 5*lateArrivals + 3*coversCompleted)
 * New staff with no history default to 100 (benefit of the doubt).
 *
 * @param {object} metrics — StaffMetrics document (or null for new staff)
 * @returns {number} 0–100
 */
const reliabilityScore = (metrics) => {
  // New staff with no history → benefit of the doubt
  if (!metrics) return 100;

  const score =
    100 -
    20 * (metrics.noShows || 0) -
    5 * (metrics.lateArrivals || 0) +
    3 * (metrics.coversCompleted || 0);

  return Math.min(100, Math.max(0, Math.round(score)));
};
module.exports.reliabilityScore = reliabilityScore;

// ── Auto-cover threshold (tunable) ───────────────────────
// Staff with reliabilityScore >= this value can auto-claim cover shifts.
// Staff below this need manager approval before the claim takes effect.
const AUTO_CLAIM_THRESHOLD = 70;
module.exports.AUTO_CLAIM_THRESHOLD = AUTO_CLAIM_THRESHOLD;

// ── Anti-favoritism gap (tunable) ─────────────────────────
// If the top volunteer's reliability exceeds the manager's pick by more than
// this many points, the system auto-selects the top volunteer instead.
// Manager may still override — but it requires a reason + is audit-logged (§6.7).
const FAVORITISM_GAP = 25;
module.exports.FAVORITISM_GAP = FAVORITISM_GAP;

// ─────────────────────────────────────────────────────────
// Generator core (§6.3) — pure, deterministic, DB-free.
// generateSchedule() (the async DB wrapper, Phase 4.3) loads a Schedule,
// builds these in-memory structures, calls the core, and maps back to Shifts.
// ─────────────────────────────────────────────────────────

/** True if a shift is "night": starts ≤ 06:00, ends ≥ 22:00, or crosses midnight. */
function isNightShift(startTime, endTime) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  return s <= 360 || e >= 1320 || e <= s;
}

/** Hours in a slot, honoring midnight crossover. */
function slotHours(slot) {
  const { startAbs, endAbs } = shiftInterval(
    new Date(slot.date).getTime(),
    slot.startTime,
    slot.endTime
  );
  return (endAbs - startAbs) / (60 * MINUTE_MS);
}

/**
 * PHASE 1 — Slot generation.
 * For each day × shiftType, create minStaffPerShift seats. roleCoverage seats
 * (requiredRole set) are created first; the remainder are generic (role = null).
 * @param {object} location - has settings.{shiftTypes, minStaffPerShift, roleCoverage}
 * @param {Date[]} weekDates - 7 dates, index = dayOfWeek (0=Mon … 6=Sun)
 * @returns {Array} slot objects with assignedStaffId = null
 */
function generateSlots(location, weekDates) {
  const settings = (location && location.settings) || {};
  const shiftTypes = settings.shiftTypes || [];
  const minStaff = settings.minStaffPerShift || 1;
  const roleCoverage = settings.roleCoverage || [];
  const slots = [];

  weekDates.forEach((date, dayOfWeek) => {
    const dateISO = new Date(date).toISOString().slice(0, 10);
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Sat, Sun (0 = Mon)

    shiftTypes.forEach((st, shiftOrder) => {
      const isNight = isNightShift(st.startTime, st.endTime);
      let seat = 0;
      const make = (requiredRole) => {
        slots.push({
          id: `${dateISO}_${st.name}_${seat}`,
          date,
          dayOfWeek,
          shiftType: st.name,
          startTime: st.startTime,
          endTime: st.endTime,
          isWeekend,
          isNight,
          requiredRole: requiredRole || null,
          assignedStaffId: null,
          shiftOrder,
          seat: seat++,
        });
      };

      // Role-typed seats first…
      const typedCount = roleCoverage.reduce((n, rc) => n + (rc.min || 0), 0);
      roleCoverage.forEach((rc) => {
        for (let k = 0; k < (rc.min || 0); k++) make(rc.role);
      });
      // …then generic seats up to minStaffPerShift.
      for (let k = 0; k < Math.max(minStaff - typedCount, 0); k++) make(null);
    });
  });

  return slots;
}
module.exports.generateSlots = generateSlots;

/** Record an assignment on a StaffState and stamp the slot. Updates fairness totals. */
function applyAssignment(ss, slot) {
  const hrs = slotHours(slot);
  ss.assignedShifts.push({ date: slot.date, startTime: slot.startTime, endTime: slot.endTime });
  ss.hoursAssigned += hrs;
  if (slot.isWeekend) ss.weekendHoursAssigned += hrs;
  if (slot.isNight) ss.nightHoursAssigned += hrs;
  // Totals (history + this run) drive fairnessScore.
  ss.totalHoursAll = (ss.histTotalHours || 0) + ss.hoursAssigned;
  ss.totalWeekendHours = (ss.histWeekendHours || 0) + ss.weekendHoursAssigned;
  ss.totalNightHours = (ss.histNightHours || 0) + ss.nightHoursAssigned;
  slot.assignedStaffId = ss.staffId;
}

/** Deterministic slot order: date → configured shiftType order → seat index. */
function slotOrder(a, b) {
  return (
    new Date(a.date) - new Date(b.date) ||
    (a.shiftOrder || 0) - (b.shiftOrder || 0) ||
    (a.seat || 0) - (b.seat || 0)
  );
}

/** Schedule fairness % (§6.5): 100 = unpopular (weekend+night) hours evenly spread. */
function computeFairnessPercent(staffStates) {
  const shares = [...staffStates.values()].map(
    (ss) => (ss.weekendHoursAssigned || 0) + (ss.nightHoursAssigned || 0)
  );
  if (shares.length <= 1) return 100;
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const variance = shares.reduce((a, b) => a + (b - mean) ** 2, 0) / shares.length;
  const stddev = Math.sqrt(variance);
  const SCALE = 10; // tunable — larger penalizes uneven distribution harder
  return Math.round(Math.max(0, 100 - Math.min(100, stddev * SCALE)));
}

/**
 * PHASES 2–5 — assign staff to slots on a prepared context. Mutates ctx.slots
 * (sets assignedStaffId) and the StaffStates. Deterministic: identical ctx in →
 * identical assignment out (fixed tiebreak, no randomness).
 *
 * Legal-by-construction: every placement passes checkAssignment first, so the
 * result never contains a HARD violation — unfilled seats surface as UNDERSTAFFED
 * conflicts instead of illegal assignments (satisfies "never return an illegal
 * schedule silently"). Full backtracking (§6.3 phase 5) is unnecessary here
 * because the greedy pass never commits a hard-violating assignment.
 *
 * @param {object} ctx - { rules, slots, staffStates:Map, avg*Hours }
 * @returns {{ conflicts: Array, fairnessScore: number }}
 */
function assignSlots(ctx) {
  const staffStates = ctx.staffStates;
  const conflicts = [];

  // Init run counters + fairness totals for every staff state.
  for (const ss of staffStates.values()) {
    ss.assignedShifts = ss.assignedShifts || [];
    ss.hoursAssigned = ss.hoursAssigned || 0;
    ss.weekendHoursAssigned = ss.weekendHoursAssigned || 0;
    ss.nightHoursAssigned = ss.nightHoursAssigned || 0;
    ss.totalHoursAll = (ss.histTotalHours || 0) + ss.hoursAssigned;
    ss.totalWeekendHours = (ss.histWeekendHours || 0) + ss.weekendHoursAssigned;
    ss.totalNightHours = (ss.histNightHours || 0) + ss.nightHoursAssigned;
  }

  // PHASE 2 — pre-apply locked / already-assigned seats (immovable).
  for (const slot of ctx.slots) {
    if (slot.assignedStaffId) {
      const ss = staffStates.get(String(slot.assignedStaffId));
      if (ss) applyAssignment(ss, slot);
    }
  }

  // PHASES 3–4 — eligibility + fairness scoring, then greedy assignment.
  const emptySlots = ctx.slots.filter((s) => !s.assignedStaffId).sort(slotOrder);
  for (const slot of emptySlots) {
    const candidates = [];
    for (const ss of staffStates.values()) {
      const verdict = checkAssignment(ss, slot, ctx);
      if (verdict.hard.length === 0) {
        candidates.push({ ss, score: fairnessScore(ss, slot, ctx), soft: verdict.soft.length });
      }
    }
    if (candidates.length === 0) {
      conflicts.push({
        type: 'UNDERSTAFFED',
        slot: { date: slot.date, shiftType: slot.shiftType, requiredRole: slot.requiredRole },
        reason: 'No eligible staff for this slot.',
      });
      continue;
    }
    // Deterministic pick: highest fairness, then fewest soft warnings, then staffId.
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        a.soft - b.soft ||
        String(a.ss.staffId).localeCompare(String(b.ss.staffId))
    );
    const pick = candidates[0];
    applyAssignment(pick.ss, slot);
    if (pick.soft > 0) {
      conflicts.push({
        type: 'WARNING',
        slot: { date: slot.date, shiftType: slot.shiftType },
        staffId: pick.ss.staffId,
        reason: 'Assigned with a soft-rule warning (e.g. over weekly hours).',
      });
    }
  }

  return { conflicts, fairnessScore: computeFairnessPercent(staffStates) };
}
module.exports.assignSlots = assignSlots;
