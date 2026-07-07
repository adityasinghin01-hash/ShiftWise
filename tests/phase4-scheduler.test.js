// tests/phase4-scheduler.test.js
// Unit tests for the scheduling engine — §6.2 checkAssignment, §6.4 fairnessScore,
// §6.6 reliabilityScore. Pure functions, no DB. GATE 4 (constraint-engine bullet).

'use strict';

const {
  checkAssignment,
  fairnessScore,
  reliabilityScore,
  generateSlots,
  assignSlots,
  HARD,
  SOFT,
  AUTO_CLAIM_THRESHOLD,
} = require('../services/schedulerService');

// ── Builders ──────────────────────────────────────────────
// A fully-available staff member with no history and no assignments yet.
function makeStaff(over = {}) {
  const availabilityIndex = new Map();
  for (let d = 0; d <= 6; d++) availabilityIndex.set(d, { available: true });
  return {
    staffId: 's1',
    name: 'Alex',
    role: 'barista',
    maxHoursPerWeek: 0, // 0 = no personal cap
    manuallyManaged: false,
    availabilityIndex,
    timeOffDays: new Set(),
    incompatibleWith: new Set(),
    assignedShifts: [],
    hoursAssigned: 0,
    ...over,
  };
}

// A weekday morning slot (Mon = dayOfWeek 0). 2026-07-06 is a Monday (UTC).
function makeSlot(over = {}) {
  return {
    id: 'slot1',
    date: new Date('2026-07-06T00:00:00Z'),
    dayOfWeek: 0,
    shiftType: 'morning',
    startTime: '09:00',
    endTime: '17:00',
    isWeekend: false,
    isNight: false,
    requiredRole: null,
    assignedStaffId: null,
    ...over,
  };
}

function makeCtx(over = {}) {
  return {
    rules: {},
    slots: [],
    avgWeekendHours: 0,
    avgNightHours: 0,
    avgTotalHours: 0,
    ...over,
  };
}

const codes = (arr) => arr.map((v) => v.code);

describe('checkAssignment — HARD rules', () => {
  test('clean assignment with no rules → no violations', () => {
    const { hard, soft } = checkAssignment(makeStaff(), makeSlot(), makeCtx());
    expect(hard).toHaveLength(0);
    expect(soft).toHaveLength(0);
  });

  test('all-blank rules never fabricate violations', () => {
    const rules = {
      minStaffPerShift: 0,
      maxStaffPerShift: 0,
      minRestHours: 0,
      maxHoursPerWeek: 0,
      maxDaysConsecutive: 0,
    };
    const { hard, soft } = checkAssignment(makeStaff(), makeSlot(), makeCtx({ rules }));
    expect(hard).toHaveLength(0);
    expect(soft).toHaveLength(0);
  });

  test('UNAVAILABLE — staff not available that weekday', () => {
    const staff = makeStaff();
    staff.availabilityIndex.set(0, { available: false });
    const { hard } = checkAssignment(staff, makeSlot({ dayOfWeek: 0 }), makeCtx());
    expect(codes(hard)).toContain(HARD.UNAVAILABLE);
  });

  test('UNAVAILABLE — shift falls outside the available window', () => {
    const staff = makeStaff();
    staff.availabilityIndex.set(0, { available: true, start: '09:00', end: '12:00' });
    const { hard } = checkAssignment(
      staff,
      makeSlot({ startTime: '09:00', endTime: '17:00' }),
      makeCtx()
    );
    expect(codes(hard)).toContain(HARD.UNAVAILABLE);
  });

  test('TIME_OFF — approved time off on the shift date', () => {
    const staff = makeStaff({ timeOffDays: new Set(['2026-07-06']) });
    const { hard } = checkAssignment(staff, makeSlot(), makeCtx());
    expect(codes(hard)).toContain(HARD.TIME_OFF);
  });

  test('DOUBLE_BOOKED — overlaps an existing shift the same day', () => {
    const staff = makeStaff({
      assignedShifts: [
        { date: new Date('2026-07-06T00:00:00Z'), startTime: '12:00', endTime: '20:00' },
      ],
    });
    const { hard } = checkAssignment(
      staff,
      makeSlot({ startTime: '09:00', endTime: '17:00' }),
      makeCtx()
    );
    expect(codes(hard)).toContain(HARD.DOUBLE_BOOKED);
  });

  test('REST_VIOLATION — under minRestHours from an adjacent shift', () => {
    // Prior shift 22:00–02:00 (ends 2026-07-06 02:00). Candidate starts 09:00 → 7h gap < 8h.
    const staff = makeStaff({
      assignedShifts: [
        { date: new Date('2026-07-05T00:00:00Z'), startTime: '22:00', endTime: '02:00' },
      ],
    });
    const { hard } = checkAssignment(
      staff,
      makeSlot({ startTime: '09:00', endTime: '17:00' }),
      makeCtx({ rules: { minRestHours: 8 } })
    );
    expect(codes(hard)).toContain(HARD.REST_VIOLATION);
    expect(codes(hard)).not.toContain(HARD.DOUBLE_BOOKED);
  });

  test('REST_VIOLATION — not raised when the gap is sufficient', () => {
    const staff = makeStaff({
      assignedShifts: [
        { date: new Date('2026-07-05T00:00:00Z'), startTime: '09:00', endTime: '17:00' },
      ],
    });
    const { hard } = checkAssignment(staff, makeSlot(), makeCtx({ rules: { minRestHours: 8 } }));
    expect(codes(hard)).not.toContain(HARD.REST_VIOLATION);
  });

  test('INCOMPATIBLE_PAIR — teammate on the incompatible list works the same day/shiftType', () => {
    const staff = makeStaff({ incompatibleWith: new Set(['s2']) });
    const slot = makeSlot();
    const peer = makeSlot({ id: 'slot2', assignedStaffId: 's2' });
    const { hard } = checkAssignment(staff, slot, makeCtx({ slots: [slot, peer] }));
    expect(codes(hard)).toContain(HARD.INCOMPATIBLE_PAIR);
  });

  test('MAX_CONSECUTIVE — exceeding the consecutive-day cap', () => {
    const staff = makeStaff({
      assignedShifts: [
        { date: new Date('2026-07-03T00:00:00Z'), startTime: '09:00', endTime: '17:00' },
        { date: new Date('2026-07-04T00:00:00Z'), startTime: '09:00', endTime: '17:00' },
        { date: new Date('2026-07-05T00:00:00Z'), startTime: '09:00', endTime: '17:00' },
      ],
    });
    const { hard } = checkAssignment(
      staff,
      makeSlot(),
      makeCtx({ rules: { maxDaysConsecutive: 3 } })
    );
    expect(codes(hard)).toContain(HARD.MAX_CONSECUTIVE);
  });

  test('ROLE_MISMATCH — slot requires a role the staff does not have', () => {
    const { hard } = checkAssignment(
      makeStaff({ role: 'barista' }),
      makeSlot({ requiredRole: 'supervisor' }),
      makeCtx()
    );
    expect(codes(hard)).toContain(HARD.ROLE_MISMATCH);
  });
});

describe('checkAssignment — SOFT rules', () => {
  test('OVER_HOURS is SOFT (warns) — never a hard block', () => {
    const staff = makeStaff({ maxHoursPerWeek: 8, hoursAssigned: 6 });
    const { hard, soft } = checkAssignment(
      staff,
      makeSlot({ startTime: '09:00', endTime: '17:00' }),
      makeCtx()
    );
    expect(codes(soft)).toContain(SOFT.OVER_HOURS); // 6 + 8 = 14 > 8
    expect(hard).toHaveLength(0);
  });

  test('no OVER_HOURS when under the cap', () => {
    const staff = makeStaff({ maxHoursPerWeek: 40, hoursAssigned: 6 });
    const { soft } = checkAssignment(staff, makeSlot(), makeCtx());
    expect(codes(soft)).not.toContain(SOFT.OVER_HOURS);
  });
});

describe('fairnessScore — §6.4', () => {
  test('a more-owed (below-average) staff scores higher than an over-worked one', () => {
    const ctx = makeCtx({ avgTotalHours: 30, avgWeekendHours: 8, avgNightHours: 4 });
    const owed = {
      totalHoursAll: 10,
      totalWeekendHours: 0,
      totalNightHours: 0,
      timeOffRequestedCount: 0,
    };
    const overworked = {
      totalHoursAll: 50,
      totalWeekendHours: 16,
      totalNightHours: 10,
      timeOffRequestedCount: 0,
    };
    expect(fairnessScore(owed, makeSlot(), ctx)).toBeGreaterThan(
      fairnessScore(overworked, makeSlot(), ctx)
    );
  });

  test('a weekend slot further boosts a weekend-underloaded staff', () => {
    const ctx = makeCtx({ avgWeekendHours: 10 });
    const ss = { totalWeekendHours: 0, totalNightHours: 0, totalHoursAll: 0 };
    const weekday = fairnessScore(ss, makeSlot({ isWeekend: false }), ctx);
    const weekend = fairnessScore(ss, makeSlot({ isWeekend: true }), ctx);
    expect(weekend).toBeGreaterThan(weekday);
  });
});

describe('reliabilityScore — §6.6', () => {
  test('new staff with no history default to 100', () => {
    expect(reliabilityScore(null)).toBe(100);
    expect(reliabilityScore(undefined)).toBe(100);
  });

  test('no-shows drop the score sharply', () => {
    expect(reliabilityScore({ noShows: 1 })).toBe(80);
    expect(reliabilityScore({ noShows: 2 })).toBe(60);
  });

  test('late arrivals reduce, covers completed increase', () => {
    expect(reliabilityScore({ lateArrivals: 2 })).toBe(90);
    expect(reliabilityScore({ coversCompleted: 2 })).toBe(100); // clamped at 100
  });

  test('score is clamped to the 0–100 range', () => {
    expect(reliabilityScore({ noShows: 10 })).toBe(0);
    expect(reliabilityScore({ coversCompleted: 100 })).toBe(100);
  });

  test('one no-show drops a fresh staffer below the auto-claim threshold', () => {
    // 100 → 80 stays above 70; two no-shows → 60 is below the gate.
    expect(reliabilityScore({ noShows: 1 })).toBeGreaterThanOrEqual(AUTO_CLAIM_THRESHOLD);
    expect(reliabilityScore({ noShows: 2 })).toBeLessThan(AUTO_CLAIM_THRESHOLD);
  });
});

// ── Generator (§6.3) helpers ──────────────────────────────
function availAllDays() {
  const m = new Map();
  for (let d = 0; d <= 6; d++) m.set(d, { available: true });
  return m;
}
function makeSS(id, over = {}) {
  return {
    staffId: id,
    name: id,
    role: 'staff',
    maxHoursPerWeek: 0,
    manuallyManaged: false,
    availabilityIndex: availAllDays(),
    timeOffDays: new Set(),
    incompatibleWith: new Set(),
    assignedShifts: [],
    hoursAssigned: 0,
    weekendHoursAssigned: 0,
    nightHoursAssigned: 0,
    histWeekendHours: 0,
    histNightHours: 0,
    histTotalHours: 0,
    timeOffRequestedCount: 0,
    ...over,
  };
}
// 7 dates starting at a Monday (UTC). 2026-07-06 is a Monday.
function weekDates(mondayISO = '2026-07-06') {
  const base = new Date(`${mondayISO}T00:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, d) => new Date(base + d * 24 * 3600 * 1000));
}
function makeLocation(over = {}) {
  return {
    settings: {
      shiftTypes: [{ name: 'morning', startTime: '09:00', endTime: '17:00' }],
      minStaffPerShift: 1,
      roleCoverage: [],
      ...over,
    },
  };
}
function ctxFor(slots, staffList, over = {}) {
  return {
    rules: {},
    slots,
    staffStates: new Map(staffList.map((s) => [s.staffId, s])),
    avgWeekendHours: 0,
    avgNightHours: 0,
    avgTotalHours: 0,
    ...over,
  };
}
const understaffed = (conflicts) => conflicts.filter((c) => c.type === 'UNDERSTAFFED');

describe('generateSlots — §6.3 Phase 1', () => {
  test('creates minStaffPerShift seats per day × shiftType', () => {
    const loc = makeLocation({
      shiftTypes: [
        { name: 'morning', startTime: '09:00', endTime: '17:00' },
        { name: 'evening', startTime: '17:00', endTime: '23:00' },
      ],
      minStaffPerShift: 2,
    });
    const slots = generateSlots(loc, weekDates());
    expect(slots).toHaveLength(7 * 2 * 2); // 7 days × 2 shiftTypes × 2 seats
    expect(slots.filter((s) => s.isWeekend)).toHaveLength(2 * 2 * 2); // Sat+Sun
  });

  test('role-coverage seats are created and tagged with requiredRole', () => {
    const loc = makeLocation({
      minStaffPerShift: 2,
      roleCoverage: [{ role: 'supervisor', min: 1 }],
    });
    const daySlots = generateSlots(loc, weekDates()).filter((s) => s.dayOfWeek === 0);
    expect(daySlots.filter((s) => s.requiredRole === 'supervisor')).toHaveLength(1);
    expect(daySlots.filter((s) => s.requiredRole === null)).toHaveLength(1);
  });
});

describe('assignSlots — §6.3 Phases 2–5', () => {
  test('fills every seat when staff are plentiful (no understaffing)', () => {
    const slots = generateSlots(makeLocation(), weekDates()); // 7 seats
    const ctx = ctxFor(slots, [makeSS('a'), makeSS('b'), makeSS('c')]);
    const { conflicts } = assignSlots(ctx);
    expect(slots.every((s) => s.assignedStaffId)).toBe(true);
    expect(understaffed(conflicts)).toHaveLength(0);
  });

  test('reports UNDERSTAFFED (never a hard violation) when nobody is eligible', () => {
    const slots = generateSlots(makeLocation(), weekDates());
    const noAvail = makeSS('a', { availabilityIndex: new Map() }); // available no day
    const { conflicts } = assignSlots(ctxFor(slots, [noAvail]));
    expect(slots.some((s) => s.assignedStaffId)).toBe(false);
    expect(understaffed(conflicts)).toHaveLength(slots.length);
  });

  test('never double-books: a lone staffer cannot fill two seats of the same shift', () => {
    const slots = generateSlots(makeLocation({ minStaffPerShift: 2 }), weekDates()); // 14 seats, 2/day
    const { conflicts } = assignSlots(ctxFor(slots, [makeSS('solo')]));
    // Each day: seat 1 filled, seat 2 understaffed (same person would overlap).
    expect(slots.filter((s) => s.assignedStaffId === 'solo')).toHaveLength(7);
    expect(understaffed(conflicts)).toHaveLength(7);
  });

  test('locked / pre-assigned seats are preserved', () => {
    const slots = generateSlots(makeLocation(), weekDates());
    slots[0].assignedStaffId = 'locked-guy';
    const ctx = ctxFor(slots, [makeSS('locked-guy'), makeSS('other')]);
    assignSlots(ctx);
    expect(slots[0].assignedStaffId).toBe('locked-guy');
  });

  test('approved time-off is never scheduled', () => {
    const slots = generateSlots(makeLocation(), weekDates());
    const monday = slots.find((s) => s.dayOfWeek === 0);
    const offStaff = makeSS('off', { timeOffDays: new Set(['2026-07-06']) }); // Monday
    const ctx = ctxFor(slots, [offStaff, makeSS('free')]);
    assignSlots(ctx);
    expect(monday.assignedStaffId).not.toBe('off');
  });

  test('incompatible pair is never co-assigned to the same shift', () => {
    const slots = generateSlots(makeLocation({ minStaffPerShift: 2 }), weekDates());
    const x = makeSS('x', { incompatibleWith: new Set(['y']) });
    const y = makeSS('y', { incompatibleWith: new Set(['x']) });
    const z = makeSS('z'); // compatible filler
    assignSlots(ctxFor(slots, [x, y, z]));
    // For each day, the two seats must not be x+y together.
    for (let d = 0; d <= 6; d++) {
      const seatIds = slots.filter((s) => s.dayOfWeek === d).map((s) => s.assignedStaffId);
      expect(seatIds.includes('x') && seatIds.includes('y')).toBe(false);
    }
  });

  test('a weekend/night slot goes to the most-owed (below-average) staff', () => {
    const sat = new Date('2026-07-11T00:00:00Z'); // Saturday
    const slot = {
      id: 'w1',
      date: sat,
      dayOfWeek: 5,
      shiftType: 'evening',
      startTime: '18:00',
      endTime: '23:00',
      isWeekend: true,
      isNight: true,
      requiredRole: null,
      assignedStaffId: null,
      shiftOrder: 0,
      seat: 0,
    };
    const overworked = makeSS('over', {
      histWeekendHours: 20,
      histNightHours: 20,
      histTotalHours: 40,
    });
    const owed = makeSS('owed', { histWeekendHours: 0, histNightHours: 0, histTotalHours: 0 });
    const ctx = ctxFor([slot], [overworked, owed], {
      avgWeekendHours: 10,
      avgNightHours: 10,
      avgTotalHours: 20,
    });
    assignSlots(ctx);
    expect(slot.assignedStaffId).toBe('owed');
  });

  test('is deterministic — identical input yields identical assignment', () => {
    const run = () => {
      const slots = generateSlots(makeLocation({ minStaffPerShift: 2 }), weekDates());
      assignSlots(ctxFor(slots, [makeSS('a'), makeSS('b'), makeSS('c')]));
      return slots.map((s) => `${s.id}:${s.assignedStaffId}`).join('|');
    };
    expect(run()).toBe(run());
  });
});
