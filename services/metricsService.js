// services/metricsService.js
// Recomputes denormalized StaffMetrics from real shift data (§9 Phase 8 — Analytics).
// Called when a schedule is published and when attendance changes, so analytics,
// fairness, and reliability scoring always reflect the actual roster — never dummy data.

'use strict';

const Shift = require('../models/Shift');
const StaffMetrics = require('../models/StaffMetrics');
const { reliabilityScore } = require('./schedulerService');

/** Duration of a shift in hours (handles overnight where end < start). */
function shiftHours(startTime, endTime) {
  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** [start, end) UTC bounds for a calendar month (month is 1–12). */
function monthRange(year, month) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/**
 * Recompute one staff member's metrics for a month, from their shifts (assigned +
 * covered), and persist to StaffMetrics (upsert). Returns the updated doc.
 */
async function recomputeStaffMetrics(staffId, locationId, { year, month }) {
  const { start, end } = monthRange(year, month);
  const shifts = await Shift.find({
    locationId,
    date: { $gte: start, $lt: end },
    $or: [{ staffId }, { coveredBy: staffId }],
  }).lean();

  let totalHours = 0;
  let weekendHours = 0;
  let nightHours = 0;
  let lateArrivals = 0;
  let noShows = 0;
  let absences = 0;
  let coversCompleted = 0;

  for (const s of shifts) {
    const hrs = shiftHours(s.startTime, s.endTime);
    const isMine = String(s.staffId) === String(staffId);
    const iCovered = s.coveredBy && String(s.coveredBy) === String(staffId);

    if (isMine) {
      // Hours count only for shifts actually worked (not absent, not a no-show).
      if (s.status !== 'absent' && s.attendance !== 'no_show') {
        totalHours += hrs;
        if (s.isWeekend) weekendHours += hrs;
        if (s.isNight) nightHours += hrs;
      }
      if (s.attendance === 'late') lateArrivals += 1;
      if (s.attendance === 'no_show') noShows += 1;
      if (s.status === 'absent') absences += 1;
    }
    if (iCovered) {
      coversCompleted += 1;
      totalHours += hrs; // hours worked while covering
    }
  }

  const reliability = reliabilityScore({ noShows, lateArrivals, coversCompleted });

  return StaffMetrics.findOneAndUpdate(
    { staffId, locationId, 'period.year': year, 'period.month': month },
    {
      $set: {
        totalHours: round2(totalHours),
        weekendHours: round2(weekendHours),
        nightHours: round2(nightHours),
        lateArrivals,
        noShows,
        absences,
        coversCompleted,
        reliabilityScore: reliability,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/** Recompute metrics for every staff member touched by a schedule's shifts. */
async function recomputeForSchedule(schedule) {
  const shifts = await Shift.find({ scheduleId: schedule._id }).select('staffId coveredBy').lean();
  const staffIds = new Set();
  for (const s of shifts) {
    if (s.staffId) staffIds.add(String(s.staffId));
    if (s.coveredBy) staffIds.add(String(s.coveredBy));
  }
  const d = new Date(schedule.periodStart);
  const period = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  await Promise.all(
    [...staffIds].map((id) => recomputeStaffMetrics(id, schedule.locationId, period))
  );
}

module.exports = { recomputeStaffMetrics, recomputeForSchedule, shiftHours, monthRange };
