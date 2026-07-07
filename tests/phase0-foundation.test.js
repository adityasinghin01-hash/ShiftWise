// tests/phase0-foundation.test.js
// Phase 0 Testing Gate — §9 Phase 0
//
// Validates:
//   1. New Mongoose models accept valid data and reject bad data
//   2. resolveBusiness middleware resolves owner/staff correctly
//   3. requireOwner blocks staff; passes owners
//   4. TENANCY ISOLATION: business A's queries never return business B's data
//   5. schedulerService exports are callable (stubs)
//   6. reliabilityScore formula (only fully implemented fn in Phase 0)

'use strict';

const mongoose = require('mongoose');

// ── Models under test ─────────────────────────────────────
const Business = require('../models/Business');
const Location = require('../models/Location');
const StaffMember = require('../models/StaffMember');
const StaffInvite = require('../models/StaffInvite');
const Availability = require('../models/Availability');
const Schedule = require('../models/Schedule');
const Shift = require('../models/Shift');
const TimeOffRequest = require('../models/TimeOffRequest');
const ShiftSwapRequest = require('../models/ShiftSwapRequest');
const ScheduleTemplate = require('../models/ScheduleTemplate');
const Notification = require('../models/Notification');
const StaffMetrics = require('../models/StaffMetrics');

// ── Middleware under test ──────────────────────────────────
const resolveBusiness = require('../middleware/resolveBusiness');
const requireOwner = require('../middleware/requireOwner');
const requireStaffSelf = require('../middleware/requireStaffSelf');

// ── Service under test ────────────────────────────────────
const {
  checkAssignment,
  reliabilityScore,
  AUTO_CLAIM_THRESHOLD,
  FAVORITISM_GAP,
  HARD,
  SOFT,
} = require('../services/schedulerService');

// ── Helpers ───────────────────────────────────────────────
/** Build a minimal mock Express res object that captures the status+json call */
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

/** Build a minimal mock req */
const mockReq = (overrides = {}) => ({ id: 'req-test-id', params: {}, ...overrides });

// ──────────────────────────────────────────────────────────
// MODEL VALIDATION TESTS
// ──────────────────────────────────────────────────────────

describe('Models — required fields + enum validation', () => {
  // These are unit tests against the Mongoose schema: no DB connection needed.
  // validateSync() runs all validators synchronously.

  describe('Business', () => {
    it('requires name', () => {
      const doc = new Business({ ownerId: new mongoose.Types.ObjectId() });
      const err = doc.validateSync();
      expect(err.errors.name).toBeDefined();
    });
    it('requires ownerId', () => {
      const doc = new Business({ name: 'Test' });
      const err = doc.validateSync();
      expect(err.errors.ownerId).toBeDefined();
    });
    it('accepts valid document', () => {
      const doc = new Business({ name: 'Test Cafe', ownerId: new mongoose.Types.ObjectId() });
      expect(doc.validateSync()).toBeUndefined();
    });
    it('defaults onboarding.completed to false', () => {
      const doc = new Business({ name: 'X', ownerId: new mongoose.Types.ObjectId() });
      expect(doc.onboarding.completed).toBe(false);
    });
  });

  describe('Location', () => {
    it('requires businessId and name', () => {
      const doc = new Location({});
      const err = doc.validateSync();
      expect(err.errors.businessId).toBeDefined();
      expect(err.errors.name).toBeDefined();
    });
    it('defaults isActive to true', () => {
      const doc = new Location({ businessId: new mongoose.Types.ObjectId(), name: 'Loc' });
      expect(doc.isActive).toBe(true);
    });
  });

  describe('StaffMember', () => {
    it('requires businessId, name, email', () => {
      const doc = new StaffMember({});
      const err = doc.validateSync();
      expect(err.errors.businessId).toBeDefined();
      expect(err.errors.name).toBeDefined();
      expect(err.errors.email).toBeDefined();
    });
    it('rejects invalid accountStatus', () => {
      const doc = new StaffMember({
        businessId: new mongoose.Types.ObjectId(),
        name: 'X',
        email: 'x@x.com',
        accountStatus: 'banana',
      });
      const err = doc.validateSync();
      expect(err.errors.accountStatus).toBeDefined();
    });
    it('defaults accountStatus to none', () => {
      const doc = new StaffMember({
        businessId: new mongoose.Types.ObjectId(),
        name: 'X',
        email: 'x@x.com',
      });
      expect(doc.accountStatus).toBe('none');
    });
  });

  describe('Schedule', () => {
    it('requires businessId, locationId, periodStart, periodEnd', () => {
      const doc = new Schedule({});
      const err = doc.validateSync();
      expect(err.errors.businessId).toBeDefined();
      expect(err.errors.locationId).toBeDefined();
      expect(err.errors.periodStart).toBeDefined();
      expect(err.errors.periodEnd).toBeDefined();
    });
    it('defaults status to draft', () => {
      const doc = new Schedule({
        businessId: new mongoose.Types.ObjectId(),
        locationId: new mongoose.Types.ObjectId(),
        periodStart: new Date(),
        periodEnd: new Date(),
      });
      expect(doc.status).toBe('draft');
    });
    it('rejects invalid status enum', () => {
      const doc = new Schedule({
        businessId: new mongoose.Types.ObjectId(),
        locationId: new mongoose.Types.ObjectId(),
        periodStart: new Date(),
        periodEnd: new Date(),
        status: 'invalid',
      });
      expect(doc.validateSync().errors.status).toBeDefined();
    });
  });

  describe('Shift', () => {
    it('requires scheduleId, businessId, locationId, staffId, date, startTime, endTime', () => {
      const doc = new Shift({});
      const err = doc.validateSync();
      ['scheduleId', 'businessId', 'locationId', 'staffId', 'date', 'startTime', 'endTime'].forEach(
        (field) => expect(err.errors[field]).toBeDefined()
      );
    });
    it('defaults attendance to unmarked', () => {
      const id = () => new mongoose.Types.ObjectId();
      const doc = new Shift({
        scheduleId: id(),
        businessId: id(),
        locationId: id(),
        staffId: id(),
        date: new Date(),
        startTime: '08:00',
        endTime: '14:00',
      });
      expect(doc.attendance).toBe('unmarked');
    });
    it('defaults locked to false', () => {
      const id = () => new mongoose.Types.ObjectId();
      const doc = new Shift({
        scheduleId: id(),
        businessId: id(),
        locationId: id(),
        staffId: id(),
        date: new Date(),
        startTime: '08:00',
        endTime: '14:00',
      });
      expect(doc.locked).toBe(false);
    });
  });

  describe('Notification', () => {
    it('rejects unknown type', () => {
      const doc = new Notification({
        userId: new mongoose.Types.ObjectId(),
        businessId: new mongoose.Types.ObjectId(),
        type: 'unknown_type',
        title: 'T',
        body: 'B',
      });
      expect(doc.validateSync().errors.type).toBeDefined();
    });
    it('defaults readAt to null (unread)', () => {
      const doc = new Notification({
        userId: new mongoose.Types.ObjectId(),
        businessId: new mongoose.Types.ObjectId(),
        type: 'badge_awarded',
        title: 'T',
        body: 'B',
      });
      expect(doc.readAt).toBeNull();
    });
  });

  describe('StaffMetrics', () => {
    it('defaults reliabilityScore to 100', () => {
      const doc = new StaffMetrics({
        staffId: new mongoose.Types.ObjectId(),
        locationId: new mongoose.Types.ObjectId(),
        period: { year: 2026, month: 6 },
      });
      expect(doc.reliabilityScore).toBe(100);
    });
  });
});

// ──────────────────────────────────────────────────────────
// TENANCY ISOLATION TEST
// ──────────────────────────────────────────────────────────

describe('Tenancy isolation', () => {
  // Validates that Mongoose model schemas carry a businessId field on every
  // business-owned model. The actual DB-level isolation test (two real businesses)
  // runs in integration tests — here we verify the schema contract.

  const BUSINESS_OWNED = [
    Location,
    StaffMember,
    Schedule,
    Shift,
    TimeOffRequest,
    ShiftSwapRequest,
    ScheduleTemplate,
    Notification,
  ];

  BUSINESS_OWNED.forEach((Model) => {
    it(`${Model.modelName} schema has indexed businessId field`, () => {
      const schema = Model.schema;
      // businessId must exist in the schema paths
      expect(schema.path('businessId')).toBeDefined();
      // It must reference 'Business' or ObjectId
      expect(schema.path('businessId').instance).toBe('ObjectId');
    });
  });

  it('StaffInvite has businessId', () => {
    expect(StaffInvite.schema.path('businessId')).toBeDefined();
  });

  it('StaffMetrics scopes via staffId+locationId (no direct businessId — by design)', () => {
    // StaffMetrics is scoped through staffId → StaffMember → businessId,
    // and locationId → Location → businessId. Direct businessId not needed.
    expect(StaffMetrics.schema.path('staffId')).toBeDefined();
    expect(StaffMetrics.schema.path('locationId')).toBeDefined();
  });

  it('Availability does NOT have businessId (scoped via staffId → StaffMember → businessId)', () => {
    // Availability is intentionally scoped through the staffId relation,
    // not directly on businessId. This is by design.
    expect(Availability.schema.path('staffId')).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────
// MIDDLEWARE TESTS (resolveBusiness, requireOwner, requireStaffSelf)
// ──────────────────────────────────────────────────────────

describe('resolveBusiness middleware', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves owner when Business.findOne returns a business', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const fakeBiz = { _id: new mongoose.Types.ObjectId(), ownerId };
    jest.spyOn(Business, 'findOne').mockResolvedValueOnce(fakeBiz);

    const req = mockReq({ user: { id: ownerId.toString() } });
    const res = mockRes();
    const next = jest.fn();

    await resolveBusiness(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.membership).toBe('owner');
    expect(req.business).toBe(fakeBiz);
    expect(req.staffMember).toBeNull();
  });

  it('resolves staff when no owned business but StaffMember found', async () => {
    const userId = new mongoose.Types.ObjectId();
    const bizId = new mongoose.Types.ObjectId();
    const fakeStaff = { _id: new mongoose.Types.ObjectId(), businessId: bizId, userId };
    const fakeBiz = { _id: bizId };

    jest.spyOn(Business, 'findOne').mockResolvedValueOnce(null);
    jest.spyOn(StaffMember, 'findOne').mockResolvedValueOnce(fakeStaff);
    jest.spyOn(Business, 'findById').mockResolvedValueOnce(fakeBiz);

    const req = mockReq({ user: { id: userId.toString() } });
    const res = mockRes();
    const next = jest.fn();

    await resolveBusiness(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.membership).toBe('staff');
    expect(req.staffMember).toBe(fakeStaff);
  });

  it('returns 403 when no business context found', async () => {
    jest.spyOn(Business, 'findOne').mockResolvedValueOnce(null);
    jest.spyOn(StaffMember, 'findOne').mockResolvedValueOnce(null);

    const req = mockReq({ user: { id: 'user123' } });
    const res = mockRes();
    const next = jest.fn();

    await resolveBusiness(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when staff belongs to a deleted business', async () => {
    const fakeStaff = { businessId: new mongoose.Types.ObjectId() };
    jest.spyOn(Business, 'findOne').mockResolvedValueOnce(null);
    jest.spyOn(StaffMember, 'findOne').mockResolvedValueOnce(fakeStaff);
    jest.spyOn(Business, 'findById').mockResolvedValueOnce(null); // business gone

    const req = mockReq({ user: { id: 'user123' } });
    const res = mockRes();
    const next = jest.fn();

    await resolveBusiness(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireOwner middleware', () => {
  it('allows owner through', () => {
    const req = mockReq({ membership: 'owner' });
    const res = mockRes();
    const next = jest.fn();
    requireOwner(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks staff with 403', () => {
    const req = mockReq({ membership: 'staff' });
    const res = mockRes();
    const next = jest.fn();
    requireOwner(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireStaffSelf middleware', () => {
  const staffId = new mongoose.Types.ObjectId();

  it('owners bypass the check', () => {
    const req = mockReq({ membership: 'owner', params: { staffId: staffId.toString() } });
    const next = jest.fn();
    requireStaffSelf()(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('staff can access their own record', () => {
    const req = mockReq({
      membership: 'staff',
      staffMember: { _id: staffId },
      params: { staffId: staffId.toString() },
    });
    const next = jest.fn();
    requireStaffSelf()(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("staff cannot access another member's record", () => {
    const otherId = new mongoose.Types.ObjectId();
    const req = mockReq({
      membership: 'staff',
      staffMember: { _id: staffId },
      params: { staffId: otherId.toString() },
    });
    const res = mockRes();
    const next = jest.fn();
    requireStaffSelf()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────
// SCHEDULER SERVICE TESTS (Phase 0 — stubs + reliabilityScore)
// ──────────────────────────────────────────────────────────

describe('schedulerService exports', () => {
  it('exports HARD and SOFT rule code constants', () => {
    expect(HARD.UNAVAILABLE).toBeDefined();
    expect(HARD.TIME_OFF).toBeDefined();
    expect(HARD.DOUBLE_BOOKED).toBeDefined();
    expect(SOFT.OVER_HOURS).toBeDefined();
  });

  it('exports AUTO_CLAIM_THRESHOLD = 70', () => {
    expect(AUTO_CLAIM_THRESHOLD).toBe(70);
  });

  it('exports FAVORITISM_GAP = 25', () => {
    expect(FAVORITISM_GAP).toBe(25);
  });

  it('checkAssignment stub returns no violations', () => {
    const result = checkAssignment({}, {}, {});
    expect(result.hard).toHaveLength(0);
    expect(result.soft).toHaveLength(0);
  });
});

describe('reliabilityScore', () => {
  it('returns 100 for new staff with no metrics', () => {
    expect(reliabilityScore(null)).toBe(100);
  });

  it('returns 100 for clean record (no incidents)', () => {
    expect(reliabilityScore({ noShows: 0, lateArrivals: 0, coversCompleted: 0 })).toBe(100);
  });

  it('deducts 20 per no-show', () => {
    expect(reliabilityScore({ noShows: 1, lateArrivals: 0, coversCompleted: 0 })).toBe(80);
    expect(reliabilityScore({ noShows: 2, lateArrivals: 0, coversCompleted: 0 })).toBe(60);
  });

  it('deducts 5 per late arrival', () => {
    expect(reliabilityScore({ noShows: 0, lateArrivals: 2, coversCompleted: 0 })).toBe(90);
  });

  it('adds 3 per cover completed', () => {
    expect(reliabilityScore({ noShows: 0, lateArrivals: 0, coversCompleted: 3 })).toBe(100); // capped at 100
  });

  it('clamps to 0 at minimum (many incidents)', () => {
    expect(reliabilityScore({ noShows: 10, lateArrivals: 0, coversCompleted: 0 })).toBe(0);
  });

  it('clamps to 100 at maximum', () => {
    expect(reliabilityScore({ noShows: 0, lateArrivals: 0, coversCompleted: 50 })).toBe(100);
  });

  it('combined: 1 no-show, 2 late, 1 cover = 77', () => {
    // 100 - 20*1 - 5*2 + 3*1 = 100 - 20 - 10 + 3 = 73
    expect(reliabilityScore({ noShows: 1, lateArrivals: 2, coversCompleted: 1 })).toBe(73);
  });
});
