// tests/phase4-template-integration.test.js
// Phase 4 follow-up #2 — save a week's roster as a template, load it into
// another week (date-shifted). HTTP end-to-end.

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();

let app, User, Business, Location, StaffMember, Schedule, Shift, ScheduleTemplate;
let owner, token, business, location, staff, weekA, weekB;

const signToken = (id) =>
  jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });

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
  ScheduleTemplate = require('../models/ScheduleTemplate');

  owner = await User.create({
    email: `tpl-owner+${RUN_ID}@shiftwise.dev`,
    password: 'Owner@ShiftWise1',
    name: 'Tpl Owner',
    isVerified: true,
    role: 'user',
  });
  token = signToken(owner._id);
  business = await Business.create({
    name: 'Tpl Cafe',
    ownerId: owner._id,
    onboarding: { completed: true },
  });
  location = await Location.create({
    businessId: business._id,
    name: 'Tpl Main',
    settings: {
      shiftTypes: [{ name: 'morning', startTime: '09:00', endTime: '17:00' }],
      minStaffPerShift: 1,
    },
  });
  staff = await StaffMember.create({
    businessId: business._id,
    locationIds: [location._id],
    name: 'Tpl Tina',
    email: `tpl-tina+${RUN_ID}@shiftwise.dev`,
    accountStatus: 'active',
    isActive: true,
  });

  const mkSchedule = (mondayISO) => {
    const monday = new Date(`${mondayISO}T00:00:00Z`);
    return Schedule.create({
      businessId: business._id,
      locationId: location._id,
      periodStart: monday,
      periodEnd: new Date(monday.getTime() + 7 * 86400000 - 1),
      status: 'draft',
    });
  };
  weekA = await mkSchedule('2026-10-05'); // Monday
  weekB = await mkSchedule('2026-10-12'); // next Monday

  // Week A has one Wednesday shift for Tina.
  await Shift.create({
    scheduleId: weekA._id,
    businessId: business._id,
    locationId: location._id,
    staffId: staff._id,
    date: new Date('2026-10-07T00:00:00Z'), // Wednesday
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
      ScheduleTemplate.deleteMany({ businessId: bizId }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
    ]);
  }
  if (owner?._id) await User.deleteOne({ _id: owner._id });
  await mongoose.connection.close();
});

describe('Phase 4 — schedule templates', () => {
  let templateId;

  it('saves a week as a named template', async () => {
    const res = await request(app)
      .post(`/api/v1/schedules/${weekA._id}/save-template`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Standard week' });
    expect(res.status).toBe(201);
    expect(res.body.data.shifts).toHaveLength(1);
    expect(res.body.data.shifts[0].dayOfWeek).toBe(2); // Wednesday (0=Mon)
    templateId = res.body.data._id;
  });

  it('lists templates for the location', async () => {
    const res = await request(app)
      .get(`/api/v1/locations/${location._id}/templates`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.name)).toContain('Standard week');
  });

  it('loads the template into another week, date-shifted', async () => {
    const res = await request(app)
      .post(`/api/v1/schedules/${weekB._id}/load-template`)
      .set('Authorization', `Bearer ${token}`)
      .send({ templateId });
    expect(res.status).toBe(200);
    expect(res.body.data.shifts).toHaveLength(1);
    // The Wednesday shift should land on week B's Wednesday (2026-10-14).
    expect(new Date(res.body.data.shifts[0].date).toISOString().slice(0, 10)).toBe('2026-10-14');
  });
});
