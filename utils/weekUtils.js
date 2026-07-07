// utils/weekUtils.js
// Week math + availability resolution. Used by Phase 3 (availability) AND
// Phase 4 (scheduler) — single source of truth for "what is this staff member's
// effective availability for a given week".
// §6 Algorithm · §9 Phase 3

'use strict';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

/**
 * Normalize any date to the start of its week (UTC midnight).
 * @param {Date|string} date
 * @param {number} weekStartsOn - 0 = Monday (default), 1 = Sunday
 * @returns {Date} UTC midnight of the week's first day
 */
function startOfWeek(date, weekStartsOn = 0) {
  const d = dayjs.utc(date);
  // dayjs: 0=Sunday … 6=Saturday. We use 0=Monday in the app.
  const jsDow = d.day(); // 0=Sun..6=Sat
  // Convert to "days since the configured week start"
  let diff;
  if (weekStartsOn === 1) {
    // Week starts Sunday
    diff = jsDow;
  } else {
    // Week starts Monday: Monday=0 … Sunday=6
    diff = (jsDow + 6) % 7;
  }
  return d.subtract(diff, 'day').startOf('day').toDate();
}

/**
 * Resolve a staff member's effective availability slots for a specific week.
 * A confirmed per-week override fully replaces the recurring pattern for that week.
 * @param {object} availability - Availability document (or null)
 * @param {Date|string} weekOf - any date within the target week
 * @param {number} weekStartsOn
 * @returns {Array} resolved daySlot objects (may be empty)
 */
function resolveAvailability(availability, weekOf, weekStartsOn = 0) {
  if (!availability) return [];
  const weekStart = startOfWeek(weekOf, weekStartsOn).getTime();

  // Look for a confirmed override matching this exact week
  const override = (availability.overrides || []).find(
    (o) => startOfWeek(o.weekOf, weekStartsOn).getTime() === weekStart
  );
  if (override) return override.slots || [];

  // Otherwise fall back to the recurring pattern
  return availability.recurring?.slots || [];
}

/**
 * Quick check: is a staff member available on a given dayOfWeek for a week?
 * @returns {object|null} the matching slot, or null if unavailable
 */
function slotForDay(availability, weekOf, dayOfWeek, weekStartsOn = 0) {
  const slots = resolveAvailability(availability, weekOf, weekStartsOn);
  const slot = slots.find((s) => s.dayOfWeek === dayOfWeek);
  return slot && slot.available ? slot : null;
}

module.exports = { startOfWeek, resolveAvailability, slotForDay };
