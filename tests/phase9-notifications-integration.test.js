// tests/phase9-notifications-integration.test.js
// Phase 9 — Notifications. GATE 9: a notification per event, accurate unread count,
// mark-read decrements, email fires (mocked), push subscribe stored, self-scoped.

// Mock the mailer so we can assert email fan-out without hitting Brevo.
jest.mock('../services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendStaffInviteEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { sendEmail } = require('../services/emailService');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();
const signToken = (id) =>
  jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const flush = () => new Promise((r) => setTimeout(r, 80)); // let fire-and-forget email settle

let app,
  User,
  Business,
  Location,
  StaffMember,
  Availability,
  Schedule,
  Shift,
  Notification,
  PushSubscription,
  TimeOffRequest;
let owner, ownerTok, business, location, alex, alexUser, alexTok, schedule;

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
  Notification = require('../models/Notification');
  PushSubscription = require('../models/PushSubscription');
  TimeOffRequest = require('../models/TimeOffRequest');

  owner = await User.create({
    email: `p9-owner+${RUN_ID}@shiftwise.dev`,
    password: 'Owner@ShiftWise1',
    name: 'Noti Owner',
    isVerified: true,
  });
  ownerTok = signToken(owner._id);
  business = await Business.create({
    name: 'Noti Cafe',
    ownerId: owner._id,
    settings: { timezone: 'UTC', weekStartsOn: 0 },
    onboarding: { completed: true },
  });
  location = await Location.create({ businessId: business._id, name: 'Main', timezone: 'UTC' });

  alexUser = await User.create({
    email: `p9-alex+${RUN_ID}@shiftwise.dev`,
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
    accountStatus: 'active',
    isActive: true,
    locationIds: [location._id],
  });
  await Availability.create({
    staffId: alex._id,
    locationId: location._id,
    recurring: { slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, available: true })) },
  });

  const mon = new Date('2026-09-07T00:00:00Z');
  schedule = await Schedule.create({
    businessId: business._id,
    locationId: location._id,
    periodStart: mon,
    periodEnd: new Date(mon.getTime() + 7 * 86400000 - 1),
    status: 'draft',
  });
  await Shift.create({
    scheduleId: schedule._id,
    businessId: business._id,
    locationId: location._id,
    staffId: alex._id,
    date: mon,
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
      TimeOffRequest.deleteMany({ businessId: bizId }),
      Availability.deleteMany({ staffId: alex?._id }),
      StaffMember.deleteMany({ businessId: bizId }),
      Location.deleteMany({ businessId: bizId }),
      Business.deleteOne({ _id: bizId }),
      Notification.deleteMany({ businessId: bizId }),
      PushSubscription.deleteMany({ userId: { $in: [owner?._id, alexUser?._id] } }),
    ]);
  }
  await User.deleteMany({ _id: { $in: [owner?._id, alexUser?._id] } });
  await mongoose.connection.close();
});

describe('Phase 9 — event → notification (+ email fan-out)', () => {
  it('publishing a schedule notifies each staff member on it, and emails them', async () => {
    sendEmail.mockClear();
    const pub = await request(app)
      .post(`/api/v1/schedules/${schedule._id}/publish`)
      .set(auth(ownerTok));
    expect(pub.status).toBe(200);
    expect(pub.body.data.notified).toContain(String(alexUser._id));
    await flush();

    const res = await request(app).get('/api/v1/notifications').set(auth(alexTok));
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((n) => n.type === 'schedule_published')).toBe(true);
    expect(res.body.data.unreadCount).toBeGreaterThanOrEqual(1);
    // Email fired (mocked) to Alex.
    expect(sendEmail).toHaveBeenCalled();
    expect(sendEmail.mock.calls.some((c) => c[0].to === alexUser.email)).toBe(true);
  });

  it('approving time-off notifies the requester', async () => {
    const sub = await request(app)
      .post('/api/v1/timeoff')
      .set(auth(alexTok))
      .send({ startDate: '2026-11-10', endDate: '2026-11-11', reason: 'Trip' });
    expect(sub.status).toBe(201);
    const review = await request(app)
      .put(`/api/v1/timeoff/${sub.body.data._id}/review`)
      .set(auth(ownerTok))
      .send({ decision: 'approved' });
    expect(review.status).toBe(200);
    await flush();

    const res = await request(app).get('/api/v1/notifications?unread=true').set(auth(alexTok));
    expect(res.body.data.items.some((n) => n.type === 'time_off_approved')).toBe(true);
  });
});

describe('Phase 9 — unread count + mark read', () => {
  it('mark-read decrements the unread count', async () => {
    const before = await request(app).get('/api/v1/notifications').set(auth(alexTok));
    const unreadBefore = before.body.data.unreadCount;
    expect(unreadBefore).toBeGreaterThan(0);
    const target = before.body.data.items.find((n) => !n.readAt);

    const read = await request(app)
      .put(`/api/v1/notifications/${target._id}/read`)
      .set(auth(alexTok));
    expect(read.status).toBe(200);
    expect(read.body.data.unreadCount).toBe(unreadBefore - 1);
  });

  it("cannot mark another user's notification read → 404", async () => {
    // Guarantee a concrete target so this can't pass vacuously.
    const note = await Notification.create({
      userId: alexUser._id,
      businessId: business._id,
      type: 'schedule_published',
      title: 'Alex only',
      body: 'x',
    });
    const res = await request(app)
      .put(`/api/v1/notifications/${note._id}/read`)
      .set(auth(ownerTok)); // owner ≠ owner of Alex's notification
    expect(res.status).toBe(404);
    const fresh = await Notification.findById(note._id);
    expect(fresh.readAt).toBeNull(); // untouched
  });

  it('mark-all-read zeroes the unread count', async () => {
    await request(app).put('/api/v1/notifications/read-all').set(auth(alexTok));
    const res = await request(app).get('/api/v1/notifications').set(auth(alexTok));
    expect(res.body.data.unreadCount).toBe(0);
  });
});

describe('Phase 9 — push subscribe', () => {
  it('stores a valid push subscription', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/push-subscribe')
      .set(auth(alexTok))
      .send({ endpoint: `https://push.example/${RUN_ID}`, keys: { p256dh: 'abc', auth: 'def' } });
    expect(res.status).toBe(201);
    const stored = await PushSubscription.findOne({ userId: alexUser._id });
    expect(stored).toBeTruthy();
  });

  it('rejects an incomplete subscription → 422', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/push-subscribe')
      .set(auth(alexTok))
      .send({ endpoint: 'https://push.example/x' });
    expect(res.status).toBe(422);
  });
});
