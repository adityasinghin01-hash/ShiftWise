// tests/phase6-staff-portal-integration.test.js
// Phase 6 — Staff Portal (S8 My Shifts). GATE 6: staff read ONLY their own data;
// no full schedule, no other members' ids; acknowledge/dispute works;
// dispute → manager notification.

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
let sara, saraTok, saraStaff, cody, codyStaff;
let monShift, tueShift, codyMonShift, draftShift;

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
    email: `p6-owner+${RUN_ID}@shiftwise.dev`,
    password: 'Owner@ShiftWise1',
    name: 'Portal Owner',
    isVerified: true,
  });
  ownerTok = signToken(owner._id);
  business = await Business.create({
    name: 'Portal Cafe',
    ownerId: owner._id,
    settings: { timezone: 'UTC', weekStartsOn: 0 },
    onboarding: { completed: true },
  });
  location = await Location.create({
    businessId: business._id,
    name: 'Portal Main',
    timezone: 'UTC',
  });

  // Sara — the caller (linked user + staff record)
  sara = await User.create({
    email: `p6-sara+${RUN_ID}@shiftwise.dev`,
    password: 'Sara@ShiftWise1',
    name: 'Sara',
    isVerified: true,
  });
  saraTok = signToken(sara._id);
  saraStaff = await StaffMember.create({
    businessId: business._id,
    name: 'Sara',
    email: sara.email,
    userId: sara._id,
    role: 'barista',
    accountStatus: 'active',
    locationIds: [location._id],
  });
  // Cody — a coworker on the same Monday shift
  cody = await User.create({
    email: `p6-cody+${RUN_ID}@shiftwise.dev`,
    password: 'Cody@ShiftWise1',
    name: 'Cody',
    isVerified: true,
  });
  codyStaff = await StaffMember.create({
    businessId: business._id,
    name: 'Cody',
    email: cody.email,
    userId: cody._id,
    role: 'barista',
    accountStatus: 'active',
    locationIds: [location._id],
  });

  const monday = new Date('2026-09-07T00:00:00Z');
  const tuesday = new Date('2026-09-08T00:00:00Z');
  const published = await Schedule.create({
    businessId: business._id,
    locationId: location._id,
    periodStart: monday,
    periodEnd: new Date(monday.getTime() + 7 * 86400000 - 1),
    status: 'published',
  });
  const draft = await Schedule.create({
    businessId: business._id,
    locationId: location._id,
    periodStart: monday,
    periodEnd: new Date(monday.getTime() + 7 * 86400000 - 1),
    status: 'draft',
  });
  const base = (staffId, date, scheduleId) => ({
    scheduleId,
    businessId: business._id,
    locationId: location._id,
    staffId,
    date,
    startTime: '09:00',
    endTime: '17:00',
    shiftType: 'morning',
  });
  monShift = await Shift.create(base(saraStaff._id, monday, published._id));
  tueShift = await Shift.create(base(saraStaff._id, tuesday, published._id));
  codyMonShift = await Shift.create(base(codyStaff._id, monday, published._id));
  draftShift = await Shift.create(base(saraStaff._id, tuesday, draft._id)); // must stay hidden

  await StaffMetrics.create({
    staffId: saraStaff._id,
    locationId: location._id,
    period: { year: new Date().getFullYear(), month: new Date().getMonth() + 1 },
    noShows: 1,
    lateArrivals: 2,
    coversCompleted: 1,
    totalHours: 32,
  });
});

afterAll(async () => {
  if (mongoose.connection.readyState === 0) return;
  const bizId = business?._id;
  if (bizId) {
    await Promise.all([
      Shift.deleteMany({ businessId: bizId }),
      Schedule.deleteMany({ businessId: bizId }),
      StaffMetrics.deleteMany({ locationId: location._id }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
      Notification.deleteMany({ businessId: bizId }),
    ]);
  }
  await User.deleteMany({ _id: { $in: [owner?._id, sara?._id, cody?._id] } });
  await mongoose.connection.close();
});

describe('Phase 6 — GET /my/shifts', () => {
  it('returns my published shifts for the week, with coworkers stripped to name+role', async () => {
    const res = await request(app).get('/api/v1/my/shifts?weekOf=2026-09-07').set(auth(saraTok));
    expect(res.status).toBe(200);
    // Monday + Tuesday (both published) — NOT the draft-schedule shift.
    expect(res.body.data).toHaveLength(2);

    const mon = res.body.data.find(
      (s) => new Date(s.date).toISOString().slice(0, 10) === '2026-09-07'
    );
    expect(mon.coworkers).toEqual([{ name: 'Cody', role: 'barista' }]);
    // The coworker entry must NOT leak ids/emails or any other field.
    expect(Object.keys(mon.coworkers[0]).sort()).toEqual(['name', 'role']);
  });

  it('never includes shifts from a draft schedule', async () => {
    const res = await request(app).get('/api/v1/my/shifts?weekOf=2026-09-07').set(auth(saraTok));
    const ids = res.body.data.map((s) => String(s._id));
    expect(ids).toContain(String(monShift._id));
    expect(ids).toContain(String(tueShift._id));
    expect(ids).not.toContain(String(draftShift._id)); // draft stays hidden
  });

  it('rejects a malformed weekOf (422)', async () => {
    const res = await request(app).get('/api/v1/my/shifts?weekOf=nope').set(auth(saraTok));
    expect(res.status).toBe(422);
  });

  it('owners have no personal shifts → 403', async () => {
    const res = await request(app).get('/api/v1/my/shifts').set(auth(ownerTok));
    expect(res.status).toBe(403);
  });

  it('requires auth → 401', async () => {
    const res = await request(app).get('/api/v1/my/shifts');
    expect(res.status).toBe(401);
  });
});

describe('Phase 6 — acknowledge / dispute (self-scope)', () => {
  it('acknowledges my own shift → confirmed', async () => {
    const res = await request(app)
      .post(`/api/v1/my/shifts/${tueShift._id}/acknowledge`)
      .set(auth(saraTok));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.acknowledgedAt).toBeTruthy();
  });

  it("cannot acknowledge a coworker's shift → 404 (self-scope)", async () => {
    const res = await request(app)
      .post(`/api/v1/my/shifts/${codyMonShift._id}/acknowledge`)
      .set(auth(saraTok));
    expect(res.status).toBe(404);
    // And Cody's shift is untouched.
    const fresh = await Shift.findById(codyMonShift._id);
    expect(fresh.status).toBe('scheduled');
  });

  it('disputing without a reason → 422', async () => {
    const res = await request(app)
      .post(`/api/v1/my/shifts/${monShift._id}/dispute`)
      .set(auth(saraTok))
      .send({});
    expect(res.status).toBe(422);
  });

  it('disputes my own shift → disputed + notifies the manager', async () => {
    const res = await request(app)
      .post(`/api/v1/my/shifts/${monShift._id}/dispute`)
      .set(auth(saraTok))
      .send({ reason: 'I already have a doctor appointment that morning.' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('disputed');
    expect(res.body.data.disputeReason).toMatch(/doctor/i);

    const note = await Notification.findOne({
      userId: owner._id,
      businessId: business._id,
      type: 'shift_disputed',
    });
    expect(note).toBeTruthy();
    expect(String(note.data.shiftId)).toBe(String(monShift._id));
  });
});

describe('Phase 6 — GET /my/metrics', () => {
  it('returns my reliability score + counters', async () => {
    const res = await request(app).get('/api/v1/my/metrics').set(auth(saraTok));
    expect(res.status).toBe(200);
    // 100 - 20*1 - 5*2 + 3*1 = 73
    expect(res.body.data.reliabilityScore).toBe(73);
    expect(res.body.data.noShows).toBe(1);
    expect(res.body.data.coversCompleted).toBe(1);
  });

  it('owner → 403', async () => {
    const res = await request(app).get('/api/v1/my/metrics').set(auth(ownerTok));
    expect(res.status).toBe(403);
  });
});
