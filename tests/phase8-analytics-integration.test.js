// tests/phase8-analytics-integration.test.js
// Phase 8 — Analytics (S7). GATE 8: metric math (hours, cost=hours×rate, coverage%,
// fairness, late/no-show), metrics recompute on publish + attendance, empty state
// when no published week, and badge award notifies the staff member.

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();
const signToken = (id) =>
  jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let app, User, Business, Location, StaffMember, Schedule, Shift, StaffMetrics, Notification;
let owner, ownerTok, business, location;
let alex, alexUser, alexTok, bella, schedule, alexWed;

beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST required');
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI);
  app = require('../app');
  User = require('../models/User');
  Business = require('../models/Business');
  Location = require('../models/Location');
  StaffMember = require('../models/StaffMember');
  Schedule = require('../models/Schedule');
  Shift = require('../models/Shift');
  StaffMetrics = require('../models/StaffMetrics');
  Notification = require('../models/Notification');

  owner = await User.create({
    email: `p8-owner+${RUN_ID}@shiftwise.dev`,
    password: 'Owner@ShiftWise1',
    name: 'Ana Owner',
    isVerified: true,
  });
  ownerTok = signToken(owner._id);
  business = await Business.create({
    name: 'Analytics Cafe',
    ownerId: owner._id,
    settings: { timezone: 'UTC', weekStartsOn: 0 },
    onboarding: { completed: true },
  });
  location = await Location.create({ businessId: business._id, name: 'Main', timezone: 'UTC' });

  alexUser = await User.create({
    email: `p8-alex+${RUN_ID}@shiftwise.dev`,
    password: 'Alex@ShiftWise1',
    name: 'Alex',
    isVerified: true,
  });
  alexTok = signToken(alexUser._id);
  alex = await StaffMember.create({
    businessId: business._id,
    name: 'Alex',
    email: alexUser.email,
    userId: alexUser._id,
    hourlyRate: 200,
    accountStatus: 'active',
    isActive: true,
    locationIds: [location._id],
  });
  bella = await StaffMember.create({
    businessId: business._id,
    name: 'Bella',
    email: `p8-bella+${RUN_ID}@shiftwise.dev`,
    hourlyRate: 300,
    accountStatus: 'active',
    isActive: true,
    locationIds: [location._id],
  });

  // A DRAFT schedule this month with shifts: Alex 2×6h, Bella 1×6h
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2));
  const second = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 3));
  schedule = await Schedule.create({
    businessId: business._id,
    locationId: location._id,
    periodStart: first,
    periodEnd: new Date(first.getTime() + 7 * 86400000 - 1),
    status: 'draft',
  });
  const mk = (staffId, date) => ({
    scheduleId: schedule._id,
    businessId: business._id,
    locationId: location._id,
    staffId,
    date,
    startTime: '09:00',
    endTime: '15:00', // 6h
    shiftType: 'morning',
  });
  await Shift.create(mk(alex._id, first));
  alexWed = await Shift.create(mk(alex._id, second));
  await Shift.create(mk(bella._id, first));
});

afterAll(async () => {
  if (mongoose.connection.readyState === 0) return;
  const bizId = business?._id;
  if (bizId) {
    await Promise.all([
      Shift.deleteMany({ businessId: bizId }),
      Schedule.deleteMany({ businessId: bizId }),
      StaffMetrics.deleteMany({ locationId: location?._id }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
      Notification.deleteMany({ businessId: bizId }),
    ]);
  }
  await User.deleteMany({ _id: { $in: [owner?._id, alexUser?._id] } });
  await mongoose.connection.close();
});

describe('Phase 8 — empty state', () => {
  it('hasData=false with zero totals before any schedule is published', async () => {
    const res = await request(app).get('/api/v1/analytics').set(auth(ownerTok));
    expect(res.status).toBe(200);
    expect(res.body.data.hasData).toBe(false);
    expect(res.body.data.totals.totalHours).toBe(0);
    expect(res.body.data.perStaff).toHaveLength(0);
  });
});

describe('Phase 8 — metric math after publish', () => {
  it('publishing recomputes metrics; analytics returns correct hours, cost, coverage, fairness', async () => {
    const pub = await request(app)
      .post(`/api/v1/schedules/${schedule._id}/publish`)
      .set(auth(ownerTok));
    expect(pub.status).toBe(200);

    const res = await request(app).get('/api/v1/analytics').set(auth(ownerTok));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.hasData).toBe(true);
    // Alex 12h, Bella 6h → 18h total
    expect(d.totals.totalHours).toBe(18);
    // cost = 12×200 + 6×300 = 2400 + 1800 = 4200
    expect(d.totals.laborCost).toBe(4200);
    // 3 shifts, 0 no-shows → 100% coverage
    expect(d.totals.coveragePercent).toBe(100);
    expect(d.totals.shifts).toBe(3);
    // fairness: max 12, min 6, spread 6
    expect(d.fairness).toEqual({ maxHours: 12, minHours: 6, spread: 6 });
    // per-staff sorted by hours desc
    expect(d.perStaff[0].name).toBe('Alex');
    expect(d.perStaff[0].hours).toBe(12);
    expect(d.perStaff[0].cost).toBe(2400);
  });
});

describe('Phase 8 — recompute on attendance change', () => {
  it('a no-show drops the hours and coverage', async () => {
    const att = await request(app)
      .post(`/api/v1/shifts/${alexWed._id}/attendance`)
      .set(auth(ownerTok))
      .send({ status: 'no_show' });
    expect(att.status).toBe(200);

    const res = await request(app).get('/api/v1/analytics').set(auth(ownerTok));
    const d = res.body.data;
    expect(d.totals.noShows).toBe(1);
    // Alex loses the Wed 6h → 6h; total 12h now
    expect(d.totals.totalHours).toBe(12);
    // coverage = (3 - 1) / 3 = 67%
    expect(d.totals.coveragePercent).toBe(67);
  });
});

describe('Phase 8 — badge award', () => {
  it('awards a badge and notifies the staff member', async () => {
    const res = await request(app)
      .post('/api/v1/analytics/badges')
      .set(auth(ownerTok))
      .send({ staffId: String(alex._id), badge: 'Cover Hero' });
    expect(res.status).toBe(201);

    const note = await Notification.findOne({
      userId: alexUser._id,
      type: 'badge_awarded',
    });
    expect(note).toBeTruthy();
    expect(note.data.badge).toBe('Cover Hero');
  });

  it('422 when badge/staffId missing', async () => {
    const res = await request(app)
      .post('/api/v1/analytics/badges')
      .set(auth(ownerTok))
      .send({ staffId: String(alex._id) });
    expect(res.status).toBe(422);
  });
});

describe('Phase 8 — access control', () => {
  it('staff cannot read analytics → 403', async () => {
    const res = await request(app).get('/api/v1/analytics').set(auth(alexTok));
    expect(res.status).toBe(403);
  });

  it('rejects a malformed location id → 422', async () => {
    const res = await request(app).get('/api/v1/analytics?location=nope').set(auth(ownerTok));
    expect(res.status).toBe(422);
  });
});
