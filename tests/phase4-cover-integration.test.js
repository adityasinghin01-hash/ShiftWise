// tests/phase4-cover-integration.test.js
// Phase 4 follow-up #1 — absence → cover (§6.7): mark absent, rank candidates,
// enforce the reliability gate + anti-favoritism override + audit log.

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
  StaffMetrics,
  Schedule,
  Shift,
  AuditLog;
let owner, token, business, location, absentStaff, coverStaff, shift;
let topStaff, midStaff, shift2; // for the anti-favoritism branch

const signToken = (id) =>
  jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const allDays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, available: true }));

beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST required');
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI);
  app = require('../app');
  User = require('../models/User');
  Business = require('../models/Business');
  Location = require('../models/Location');
  StaffMember = require('../models/StaffMember');
  Availability = require('../models/Availability');
  StaffMetrics = require('../models/StaffMetrics');
  Schedule = require('../models/Schedule');
  Shift = require('../models/Shift');
  AuditLog = require('../models/AuditLog');

  owner = await User.create({
    email: `cov-owner+${RUN_ID}@shiftwise.dev`,
    password: 'Owner@ShiftWise1',
    name: 'Cover Owner',
    isVerified: true,
    role: 'user',
  });
  token = signToken(owner._id);
  business = await Business.create({
    name: 'Cover Cafe',
    ownerId: owner._id,
    settings: { timezone: 'UTC', weekStartsOn: 0 },
    onboarding: { completed: true },
  });
  location = await Location.create({
    businessId: business._id,
    name: 'Cover Main',
    timezone: 'UTC',
    settings: {
      shiftTypes: [{ name: 'morning', startTime: '09:00', endTime: '17:00' }],
      minStaffPerShift: 1,
    },
  });

  absentStaff = await StaffMember.create({
    businessId: business._id,
    locationIds: [location._id],
    name: 'Absent Amy',
    email: `cov-absent+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
  });
  coverStaff = await StaffMember.create({
    businessId: business._id,
    locationIds: [location._id],
    name: 'Cover Carl',
    email: `cov-carl+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
  });
  await Availability.create({
    staffId: absentStaff._id,
    locationId: location._id,
    recurring: { slots: allDays },
  });
  await Availability.create({
    staffId: coverStaff._id,
    locationId: location._id,
    recurring: { slots: allDays },
  });

  // Carl has 2 no-shows this period → reliability 60 (below the 70 auto-claim gate).
  const now = new Date();
  await StaffMetrics.create({
    staffId: coverStaff._id,
    locationId: location._id,
    period: { year: now.getFullYear(), month: now.getMonth() + 1 },
    noShows: 2,
  });

  // Two more coverers for the anti-favoritism branch:
  //   Rita = 100 (no metrics, top volunteer)
  //   Mo   = 70 (1 no-show + 2 late → AT the gate, so canAutoClaim is true,
  //             but 30 pts below Rita → the favoritism rule should still fire).
  topStaff = await StaffMember.create({
    businessId: business._id,
    locationIds: [location._id],
    name: 'Reliable Rita',
    email: `cov-rita+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
  });
  midStaff = await StaffMember.create({
    businessId: business._id,
    locationIds: [location._id],
    name: 'Midgrade Mo',
    email: `cov-mo+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
  });
  await Availability.create({
    staffId: topStaff._id,
    locationId: location._id,
    recurring: { slots: allDays },
  });
  await Availability.create({
    staffId: midStaff._id,
    locationId: location._id,
    recurring: { slots: allDays },
  });
  await StaffMetrics.create({
    staffId: midStaff._id,
    locationId: location._id,
    period: { year: now.getFullYear(), month: now.getMonth() + 1 },
    noShows: 1,
    lateArrivals: 2,
  });

  const monday = new Date('2026-09-07T00:00:00Z'); // a Monday
  const sched = await Schedule.create({
    businessId: business._id,
    locationId: location._id,
    periodStart: monday,
    periodEnd: new Date(monday.getTime() + 7 * 86400000 - 1),
    status: 'published',
  });
  shift = await Shift.create({
    scheduleId: sched._id,
    businessId: business._id,
    locationId: location._id,
    staffId: absentStaff._id,
    date: monday,
    startTime: '09:00',
    endTime: '17:00',
    shiftType: 'morning',
  });
  // A second absent shift (Tuesday) for the anti-favoritism test, independent of
  // the first one that the below-gate tests mutate.
  shift2 = await Shift.create({
    scheduleId: sched._id,
    businessId: business._id,
    locationId: location._id,
    staffId: absentStaff._id,
    date: new Date('2026-09-08T00:00:00Z'),
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
      Shift.deleteMany({ businessId: bizId }),
      Schedule.deleteMany({ businessId: bizId }),
      StaffMetrics.deleteMany({ locationId: location._id }),
      Availability.deleteMany({ locationId: location._id }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
    ]);
    await AuditLog.deleteMany({ actorId: owner._id }).catch(() => {}); // append-only guard may block; ignore
  }
  if (owner?._id) await User.deleteOne({ _id: owner._id });
  await mongoose.connection.close();
});

describe('Phase 4 — absence → cover (§6.7)', () => {
  it('marks a shift absent and returns eligible cover candidates', async () => {
    const res = await request(app)
      .post(`/api/v1/shifts/${shift._id}/absent`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.shift.status).toBe('absent');
    const names = res.body.data.candidates.map((c) => c.name);
    expect(names).toContain('Cover Carl'); // eligible (available, no clash)
    expect(names).not.toContain('Absent Amy'); // can't cover self
    const carl = res.body.data.candidates.find((c) => c.name === 'Cover Carl');
    expect(carl.reliabilityScore).toBe(60);
    expect(carl.canAutoClaim).toBe(false); // below the 70 gate
  });

  it('requires an override reason when the cover pick is below the reliability gate', async () => {
    const res = await request(app)
      .post(`/api/v1/shifts/${shift._id}/cover/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ staffId: String(coverStaff._id) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('override_required');
  });

  it('assigns the cover with a reason and writes an audit-log entry', async () => {
    const res = await request(app)
      .post(`/api/v1/shifts/${shift._id}/cover/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        staffId: String(coverStaff._id),
        overrideReason: 'Short notice — Carl is the only one free.',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.shift.status).toBe('covered');
    expect(String(res.body.data.shift.coveredBy)).toBe(String(coverStaff._id));
    expect(res.body.data.overridden).toBe(true);

    const log = await AuditLog.findOne({ actorId: owner._id, action: 'cover_override' });
    expect(log).toBeTruthy();
    expect(log.meta.reason).toMatch(/short notice/i);
  });

  it('anti-favoritism: override required for an above-gate pick far below the top volunteer', async () => {
    // Candidates for shift2: Rita 100, Mo 70, Carl 60. Mo is AT the gate
    // (canAutoClaim true), but 30 pts below Rita → the favoritism rule must fire.
    const list = await request(app)
      .post(`/api/v1/shifts/${shift2._id}/absent`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const mo = list.body.data.candidates.find((c) => c.name === 'Midgrade Mo');
    expect(mo.reliabilityScore).toBe(70);
    expect(mo.canAutoClaim).toBe(true); // NOT below the gate — isolates the favoritism branch

    const noReason = await request(app)
      .post(`/api/v1/shifts/${shift2._id}/cover/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ staffId: String(midStaff._id) });
    expect(noReason.status).toBe(422);
    expect(noReason.body.code).toBe('override_required');

    // The top volunteer (Rita) assigns cleanly — no override needed.
    const rita = await request(app)
      .post(`/api/v1/shifts/${shift2._id}/cover/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ staffId: String(topStaff._id) });
    expect(rita.status).toBe(200);
    expect(rita.body.data.overridden).toBe(false);
  });
});
