// tests/phase7-dashboard-integration.test.js
// Phase 7 — Manager Dashboard (S2). GATE 7: aggregation correct for all/single
// location, owner-only, and the needs-attention queue + checklist reflect real state.

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();
const signToken = (id) =>
  jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let app,
  User,
  Business,
  Location,
  StaffMember,
  Availability,
  Schedule,
  Shift,
  StaffMetrics,
  TimeOffRequest,
  ShiftSwapRequest;
let owner, ownerTok, business, locA, locB;
let alexStaff, staffUser, staffTok, bella;

beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST required');
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI);
  app = require('../app');
  User = require('../models/User');
  Business = require('../models/Business');
  Location = require('../models/Location');
  StaffMember = require('../models/StaffMember');
  Availability = require('../models/Availability');
  Schedule = require('../models/Schedule');
  Shift = require('../models/Shift');
  StaffMetrics = require('../models/StaffMetrics');
  TimeOffRequest = require('../models/TimeOffRequest');
  ShiftSwapRequest = require('../models/ShiftSwapRequest');

  owner = await User.create({
    email: `p7-owner+${RUN_ID}@shiftwise.dev`,
    password: 'Owner@ShiftWise1',
    name: 'Dash Owner',
    isVerified: true,
  });
  ownerTok = signToken(owner._id);
  business = await Business.create({
    name: 'Dash Cafe',
    ownerId: owner._id,
    settings: { timezone: 'UTC', weekStartsOn: 0 },
    onboarding: { completed: true },
  });
  [locA, locB] = await Location.insertMany([
    { businessId: business._id, name: 'Loc A', timezone: 'UTC' },
    { businessId: business._id, name: 'Loc B', timezone: 'UTC' },
  ]);

  // Alex has a linked user (to test the owner-only guard as a staff caller)
  staffUser = await User.create({
    email: `p7-alex+${RUN_ID}@shiftwise.dev`,
    password: 'Alex@ShiftWise1',
    name: 'Alex',
    isVerified: true,
  });
  staffTok = signToken(staffUser._id);
  alexStaff = await StaffMember.create({
    businessId: business._id,
    name: 'Alex',
    email: staffUser.email,
    userId: staffUser._id,
    accountStatus: 'active',
    isActive: true,
    locationIds: [locA._id],
  });
  bella = await StaffMember.create({
    businessId: business._id,
    name: 'Bella',
    email: `p7-bella+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
    locationIds: [locA._id],
  });
  await Availability.create({
    staffId: alexStaff._id,
    locationId: locA._id,
    recurring: { slots: [{ dayOfWeek: 1, available: true }] },
  });

  const today = new Date();
  const utcToday = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const schedule = await Schedule.create({
    businessId: business._id,
    locationId: locA._id,
    periodStart: utcToday,
    periodEnd: new Date(utcToday.getTime() + 7 * 86400000 - 1),
    status: 'published',
  });
  // A shift today (feeds the "today strip") + a disputed shift (needs attention)
  const todayShift = await Shift.create({
    scheduleId: schedule._id,
    businessId: business._id,
    locationId: locA._id,
    staffId: alexStaff._id,
    date: utcToday,
    startTime: '09:00',
    endTime: '17:00',
    shiftType: 'morning',
  });
  await Shift.create({
    scheduleId: schedule._id,
    businessId: business._id,
    locationId: locA._id,
    staffId: alexStaff._id,
    date: new Date(utcToday.getTime() + 86400000),
    startTime: '09:00',
    endTime: '17:00',
    shiftType: 'morning',
    status: 'disputed',
    disputeReason: 'Double booked',
  });

  // A pending time-off + a pending swap, both at Loc A
  await TimeOffRequest.create({
    businessId: business._id,
    staffId: alexStaff._id,
    locationId: locA._id,
    startDate: new Date(utcToday.getTime() + 5 * 86400000),
    endDate: new Date(utcToday.getTime() + 6 * 86400000),
    reason: 'Trip',
    status: 'pending',
  });
  await ShiftSwapRequest.create({
    businessId: business._id,
    requesterStaffId: alexStaff._id,
    targetStaffId: bella._id,
    shiftId: todayShift._id,
    mode: 'targeted',
    status: 'pending',
  });

  await StaffMetrics.create({
    staffId: alexStaff._id,
    locationId: locA._id,
    period: { year: today.getFullYear(), month: today.getMonth() + 1 },
    noShows: 1, // reliability 80
  });
});

afterAll(async () => {
  if (mongoose.connection.readyState === 0) return;
  const bizId = business?._id;
  if (bizId) {
    await Promise.all([
      Shift.deleteMany({ businessId: bizId }),
      Schedule.deleteMany({ businessId: bizId }),
      TimeOffRequest.deleteMany({ businessId: bizId }),
      ShiftSwapRequest.deleteMany({ businessId: bizId }),
      StaffMetrics.deleteMany({ locationId: { $in: [locA?._id, locB?._id] } }),
      Availability.deleteMany({ staffId: alexStaff?._id }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
    ]);
  }
  await User.deleteMany({ _id: { $in: [owner?._id, staffUser?._id] } });
  await mongoose.connection.close();
});

describe('Phase 7 — GET /dashboard (all locations)', () => {
  it('aggregates KPIs + needs-attention + checklist correctly', async () => {
    const res = await request(app).get('/api/v1/manager/dashboard').set(auth(ownerTok));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.scope).toBe('all');
    expect(d.kpis.activeStaff).toBe(2); // Alex + Bella
    expect(d.kpis.pendingRequests).toBe(2); // 1 time-off + 1 swap
    expect(d.kpis.openDisputes).toBe(1);
    expect(d.kpis.todayShifts).toBe(1);
    expect(d.kpis.avgReliability).toBe(90); // (Alex 80 + Bella 100) / 2

    expect(d.needsAttention.timeOff).toHaveLength(1);
    expect(d.needsAttention.swaps).toHaveLength(1);
    expect(d.needsAttention.disputes).toHaveLength(1);
    expect(d.needsAttention.disputes[0].reason).toMatch(/double booked/i);

    expect(d.checklist).toEqual({
      hasLocation: true,
      hasStaff: true,
      hasAvailability: true,
      hasPublishedSchedule: true,
    });
  });
});

describe('Phase 7 — location scoping', () => {
  it('scopes to a single location', async () => {
    const res = await request(app)
      .get(`/api/v1/manager/dashboard?location=${locA._id}`)
      .set(auth(ownerTok));
    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe(String(locA._id));
    expect(res.body.data.needsAttention.timeOff).toHaveLength(1);
    expect(res.body.data.needsAttention.swaps).toHaveLength(1);
  });

  it('a location with nothing shows empty queues', async () => {
    const res = await request(app)
      .get(`/api/v1/manager/dashboard?location=${locB._id}`)
      .set(auth(ownerTok));
    expect(res.status).toBe(200);
    expect(res.body.data.needsAttention.timeOff).toHaveLength(0);
    expect(res.body.data.needsAttention.swaps).toHaveLength(0); // swap's shift is at Loc A
    expect(res.body.data.needsAttention.disputes).toHaveLength(0);
    expect(res.body.data.kpis.pendingRequests).toBe(0);
  });

  it('rejects a malformed location id (422)', async () => {
    const res = await request(app)
      .get('/api/v1/manager/dashboard?location=nope')
      .set(auth(ownerTok));
    expect(res.status).toBe(422);
  });

  it('404s a location from another business', async () => {
    const other = await Location.create({ businessId: new mongoose.Types.ObjectId(), name: 'X' });
    const res = await request(app)
      .get(`/api/v1/manager/dashboard?location=${other._id}`)
      .set(auth(ownerTok));
    expect(res.status).toBe(404);
    await Location.deleteOne({ _id: other._id });
  });
});

describe('Phase 7 — access control', () => {
  it('staff cannot open the manager dashboard → 403', async () => {
    const res = await request(app).get('/api/v1/manager/dashboard').set(auth(staffTok));
    expect(res.status).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const res = await request(app).get('/api/v1/manager/dashboard');
    expect(res.status).toBe(401);
  });
});
