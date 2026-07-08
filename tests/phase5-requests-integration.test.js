// tests/phase5-requests-integration.test.js
// Phase 5 GATE — time-off (submit → approve → coverage warning) and swaps
// (submit → approve → shift reassigned, engine-validated). HTTP end-to-end with
// both staff and owner auth.

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();

let app,
  User,
  Business,
  Location,
  StaffMember,
  Availability,
  Schedule,
  Shift,
  TimeOffRequest,
  ShiftSwapRequest;
let owner, ownerTok, business, location, s1, s2, s1Tok, schedule, shift;

const sign = (id) =>
  jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const allDays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, available: true }));
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST required');
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI);
  app = require('../app');
  [
    User,
    Business,
    Location,
    StaffMember,
    Availability,
    Schedule,
    Shift,
    TimeOffRequest,
    ShiftSwapRequest,
  ] = [
    require('../models/User'),
    require('../models/Business'),
    require('../models/Location'),
    require('../models/StaffMember'),
    require('../models/Availability'),
    require('../models/Schedule'),
    require('../models/Shift'),
    require('../models/TimeOffRequest'),
    require('../models/ShiftSwapRequest'),
  ];

  owner = await User.create({
    email: `p5-owner+${RUN_ID}@sw.dev`,
    password: 'Owner@ShiftWise1',
    name: 'P5 Owner',
    isVerified: true,
    role: 'user',
  });
  ownerTok = sign(owner._id);
  business = await Business.create({
    name: 'P5 Cafe',
    ownerId: owner._id,
    onboarding: { completed: true },
  });
  location = await Location.create({
    businessId: business._id,
    name: 'P5 Main',
    settings: {
      shiftTypes: [{ name: 'morning', startTime: '09:00', endTime: '17:00' }],
      minStaffPerShift: 1,
    },
  });

  // Two staff, each with a linked User so they can authenticate as staff.
  const mkStaff = async (name, email) => {
    const u = await User.create({
      email,
      password: 'Staff@ShiftWise1',
      name,
      isVerified: true,
      role: 'user',
    });
    const sm = await StaffMember.create({
      businessId: business._id,
      locationIds: [location._id],
      userId: u._id,
      name,
      email,
      accountStatus: 'active',
      isActive: true,
    });
    await Availability.create({
      staffId: sm._id,
      locationId: location._id,
      recurring: { slots: allDays },
    });
    return { u, sm, tok: sign(u._id) };
  };
  const a = await mkStaff('Sara One', `p5-s1+${RUN_ID}@sw.dev`);
  const b = await mkStaff('Sam Two', `p5-s2+${RUN_ID}@sw.dev`);
  s1 = a.sm;
  s1Tok = a.tok;
  s2 = b.sm;

  // Published schedule with a Wednesday shift for Sara.
  const monday = new Date('2026-11-02T00:00:00Z');
  schedule = await Schedule.create({
    businessId: business._id,
    locationId: location._id,
    periodStart: monday,
    periodEnd: new Date(monday.getTime() + 7 * 86400000 - 1),
    status: 'published',
  });
  shift = await Shift.create({
    scheduleId: schedule._id,
    businessId: business._id,
    locationId: location._id,
    staffId: s1._id,
    date: new Date('2026-11-04T00:00:00Z'), // Wednesday
    startTime: '09:00',
    endTime: '17:00',
    shiftType: 'morning',
  });
});

afterAll(async () => {
  if (mongoose.connection.readyState === 0) return;
  const bizId = business?._id;
  if (bizId) {
    await Promise.all([
      TimeOffRequest.deleteMany({ businessId: bizId }),
      ShiftSwapRequest.deleteMany({ businessId: bizId }),
      Shift.deleteMany({ businessId: bizId }),
      Schedule.deleteMany({ businessId: bizId }),
      Availability.deleteMany({ locationId: location._id }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
    ]);
    await User.deleteMany({ email: new RegExp(`\\+${RUN_ID}@sw\\.dev$`) });
  }
  await mongoose.connection.close();
});

describe('Phase 5 — time-off', () => {
  let requestId;
  it('staff submits a time-off request', async () => {
    const res = await request(app)
      .post('/api/v1/timeoff')
      .set(bearer(s1Tok))
      .send({ startDate: '2026-11-04', endDate: '2026-11-05', reason: 'Trip' });
    expect(res.status).toBe(201);
    requestId = res.body.data._id;
  });

  it('owner sees it in the location list', async () => {
    const res = await request(app)
      .get(`/api/v1/locations/${location._id}/timeoff`)
      .set(bearer(ownerTok));
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r._id)).toContain(requestId);
  });

  it('approving flags a coverage warning for the clashing published shift', async () => {
    const res = await request(app)
      .put(`/api/v1/timeoff/${requestId}/review`)
      .set(bearer(ownerTok))
      .send({ decision: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('approved');
    expect(res.body.data.coverageWarning.shiftIds.map(String)).toContain(String(shift._id));
  });

  it('rejects an inverted date range', async () => {
    const res = await request(app)
      .post('/api/v1/timeoff')
      .set(bearer(s1Tok))
      .send({ startDate: '2026-11-10', endDate: '2026-11-08' });
    expect(res.status).toBe(422);
  });
});

describe('Phase 5 — swaps', () => {
  let swapId;
  it('staff requests a targeted swap of their own shift', async () => {
    const res = await request(app)
      .post('/api/v1/swaps')
      .set(bearer(s1Tok))
      .send({ shiftId: String(shift._id), mode: 'targeted', targetStaffId: String(s2._id) });
    expect(res.status).toBe(201);
    swapId = res.body.data._id;
  });

  it('owner approves → the shift is reassigned to the target', async () => {
    const res = await request(app)
      .put(`/api/v1/swaps/${swapId}/review`)
      .set(bearer(ownerTok))
      .send({ decision: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('approved');
    const updated = await Shift.findById(shift._id);
    expect(String(updated.staffId)).toBe(String(s2._id));
  });
});
