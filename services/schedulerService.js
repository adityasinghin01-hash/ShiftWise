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
 * Phase 4 will flesh out all rule checks. Stub returns empty for now
 * so Phase 0 tests can import and call the function without crashing.
 */
const checkAssignment = (_staffState, _slot, _ctx) => {
  // §6.2 — TODO (Phase 4): implement all HARD and SOFT rule checks.
  // Stub returns clean (no violations) so model/middleware tests pass.
  return { hard: [], soft: [] };
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
const generateSchedule = async (_scheduleId) => {
  // §6.3 — TODO (Phase 4): implement full 5-phase generator.
  // Stub so route can be wired without crashing.
  return { preview: [], conflicts: [], fairnessScore: 100 };
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
const fairnessScore = (_staffState, _slot, _ctx) => {
  // §6.4 — TODO (Phase 4): implement full fairness formula.
  return 0;
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
