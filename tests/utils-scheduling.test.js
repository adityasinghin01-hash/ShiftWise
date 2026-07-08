// tests/utils-scheduling.test.js
// Unit coverage for the pure scheduling utils: weekUtils (week math + availability
// resolution) and shiftType (label → enum). Keeps utils/ above its coverage gate.

'use strict';

const { startOfWeek, resolveAvailability, slotForDay } = require('../utils/weekUtils');
const { toShiftEnum } = require('../utils/shiftType');

describe('weekUtils.startOfWeek', () => {
  it('snaps to Monday when weekStartsOn = 0 (default)', () => {
    // 2026-07-08 is a Wednesday → Monday of that week is 2026-07-06.
    const d = startOfWeek('2026-07-08T12:00:00Z', 0);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-06');
  });

  it('snaps to Sunday when weekStartsOn = 1', () => {
    // Same Wednesday → the preceding Sunday is 2026-07-05.
    const d = startOfWeek('2026-07-08T12:00:00Z', 1);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-05');
  });
});

describe('weekUtils.resolveAvailability', () => {
  const weekOf = '2026-07-06'; // a Monday
  const recurring = { slots: [{ dayOfWeek: 0, available: true }] };

  it('returns [] for no availability doc', () => {
    expect(resolveAvailability(null, weekOf, 0)).toEqual([]);
  });

  it('falls back to the recurring pattern when no override matches', () => {
    const av = { recurring, overrides: [] };
    expect(resolveAvailability(av, weekOf, 0)).toEqual(recurring.slots);
  });

  it('a matching per-week override replaces the recurring pattern', () => {
    const overrideSlots = [{ dayOfWeek: 2, available: true }];
    const av = { recurring, overrides: [{ weekOf, slots: overrideSlots }] };
    expect(resolveAvailability(av, weekOf, 0)).toEqual(overrideSlots);
  });
});

describe('weekUtils.slotForDay', () => {
  const weekOf = '2026-07-06';
  const av = {
    recurring: { slots: [{ dayOfWeek: 1, available: true, preferredStart: '09:00' }] },
    overrides: [],
  };

  it('returns the slot when the staff member is available that day', () => {
    const slot = slotForDay(av, weekOf, 1, 0);
    expect(slot).toMatchObject({ dayOfWeek: 1, available: true });
  });

  it('returns null when there is no slot for that day', () => {
    expect(slotForDay(av, weekOf, 3, 0)).toBeNull();
  });

  it('returns null when the day is explicitly unavailable', () => {
    const off = { recurring: { slots: [{ dayOfWeek: 1, available: false }] }, overrides: [] };
    expect(slotForDay(off, weekOf, 1, 0)).toBeNull();
  });
});

describe('shiftType.toShiftEnum', () => {
  it('passes through the known enum values (case-insensitive)', () => {
    expect(toShiftEnum('morning')).toBe('morning');
    expect(toShiftEnum('Afternoon')).toBe('afternoon');
    expect(toShiftEnum('EVENING')).toBe('evening');
  });

  it('maps anything unknown or empty to "custom"', () => {
    expect(toShiftEnum('brunch')).toBe('custom');
    expect(toShiftEnum('')).toBe('custom');
    expect(toShiftEnum(undefined)).toBe('custom');
    expect(toShiftEnum(null)).toBe('custom');
  });
});
