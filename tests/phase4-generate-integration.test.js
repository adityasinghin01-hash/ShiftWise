// tests/phase4-generate-integration.test.js
// Phase 4 integration — create a draft schedule then generate a PREVIEW via HTTP,
// exercising routes → controller → generateSchedule DB wrapper → engine end-to-end.
// Uses real MONGO_URI_TEST + Express app via supertest, signing JWTs directly.

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();

let app, User, Business, Location, StaffMember, Availability, Schedule;
let owner, token, business, location;

const signToken = (userId) =>
  jwt.sign({ id: userId }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });

const allDaysAvailable = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, available: true }));

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

  owner = await User.create({
    email: `p4-owner+${RUN_ID}@shiftwise.dev`,
    password: 'Owner@ShiftWise1',
    name: 'P4 Owner',
    isVerified: true,
    role: 'user',
  });
  token = signToken(owner._id);

  business = await Business.create({
    name: 'P4 Cafe',
    ownerId: owner._id,
    settings: { timezone: 'UTC', currency: 'USD', weekStartsOn: 0 },
    onboarding: { completed: true },
  });

  location = await Location.create({
    businessId: business._id,
    name: 'P4 Main',
    timezone: 'UTC',
    settings: {
      shiftTypes: [{ name: 'morning', startTime: '09:00', endTime: '17:00' }],
      minStaffPerShift: 1,
    },
  });

  // Two active staff, both available every day → all 7 seats fillable.
  const staffA = await StaffMember.create({
    businessId: business._id,
    locationIds: [location._id],
    name: 'Aisha',
    email: `p4-a+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
  });
  const staffB = await StaffMember.create({
    businessId: business._id,
    locationIds: [location._id],
    name: 'Bilal',
    email: `p4-b+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
  });
  await Availability.create({
    staffId: staffA._id,
    locationId: location._id,
    recurring: { slots: allDaysAvailable },
  });
  await Availability.create({
    staffId: staffB._id,
    locationId: location._id,
    recurring: { slots: allDaysAvailable },
  });
});

afterAll(async () => {
  if (mongoose.connection.readyState === 0) return;
  const bizId = business?._id;
  if (bizId) {
    await Promise.all([
      Schedule.deleteMany({ businessId: bizId }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
    ]);
    const staffEmails = [`p4-a+${RUN_ID}@shiftwise.dev`, `p4-b+${RUN_ID}@shiftwise.dev`];
    await Availability.deleteMany({}).where('locationId').equals(location._id);
    void staffEmails;
  }
  if (owner?._id) await User.deleteOne({ _id: owner._id });
  await mongoose.connection.close();
});

describe('Phase 4 — create + generate schedule (HTTP)', () => {
  let scheduleId;

  it('creates a weekly draft schedule', async () => {
    const res = await request(app)
      .post('/api/v1/schedules')
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId: location._id.toString(), periodStart: '2026-08-05' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('draft');
    scheduleId = res.body.data._id;
  });

  it('rejects a schedule for a location outside the business (tenancy)', async () => {
    const res = await request(app)
      .post('/api/v1/schedules')
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId: new mongoose.Types.ObjectId().toString(), periodStart: '2026-08-05' });
    expect(res.status).toBe(404);
  });

  it('generates a preview that fills every seat with no hard violations', async () => {
    const res = await request(app)
      .post(`/api/v1/schedules/${scheduleId}/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    const { preview, conflicts, fairnessScore } = res.body.data;

    // 1 shiftType × 1 seat × 7 days, 2 available staff → all 7 seats filled.
    expect(preview).toHaveLength(7);
    expect(preview.every((s) => s.staffId)).toBe(true);
    expect(conflicts.filter((c) => c.type === 'UNDERSTAFFED')).toHaveLength(0);
    expect(typeof fairnessScore).toBe('number');

    // No staff is assigned two overlapping shifts on the same day.
    const byDay = {};
    for (const s of preview) {
      const day = new Date(s.date).toISOString().slice(0, 10);
      byDay[day] = byDay[day] || new Set();
      expect(byDay[day].has(String(s.staffId))).toBe(false);
      byDay[day].add(String(s.staffId));
    }
  });

  it('does not persist the preview (generate is read-only)', async () => {
    const Shift = require('../models/Shift');
    const count = await Shift.countDocuments({ scheduleId });
    expect(count).toBe(0);
  });
});
