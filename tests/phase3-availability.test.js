// tests/phase3-availability.test.js
// Phase 3 Testing Gate — §9 Phase 3 (Availability)
//
// Unit: startOfWeek + resolveAvailability (override beats recurring).
// Integration: my-availability get/set/override, manager overview, override-request
// confirm flow, and tenancy isolation.

const request  = require('supertest');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const config   = require('../config/config');
const { startOfWeek, resolveAvailability } = require('../utils/weekUtils');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();

let app, User, Business, Location, StaffMember, Availability;
let owner, ownerToken, biz, location;
let staffUser, staffToken, staffMember;

const signToken = (id) => jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

// ──────────────────────────────────────────────────────────
// UNIT TESTS — weekUtils
// ──────────────────────────────────────────────────────────
describe('weekUtils', () => {
  it('startOfWeek (Monday) normalizes any day to that Monday', () => {
    // 2026-06-17 is a Wednesday → week start Monday 2026-06-15
    const mon = startOfWeek('2026-06-17T10:00:00Z', 0);
    expect(mon.toISOString().slice(0, 10)).toBe('2026-06-15');
  });

  it('startOfWeek is idempotent', () => {
    const a = startOfWeek('2026-06-17', 0);
    const b = startOfWeek(a, 0);
    expect(a.getTime()).toBe(b.getTime());
  });

  it('resolveAvailability returns recurring when no override', () => {
    const av = { recurring: { slots: [{ dayOfWeek: 0, available: true }] }, overrides: [] };
    const r = resolveAvailability(av, '2026-06-17', 0);
    expect(r).toHaveLength(1);
    expect(r[0].dayOfWeek).toBe(0);
  });

  it('resolveAvailability: override for the week beats recurring', () => {
    const av = {
      recurring: { slots: [{ dayOfWeek: 0, available: true }] },
      overrides: [{ weekOf: new Date('2026-06-15T00:00:00Z'), slots: [{ dayOfWeek: 5, available: true }] }],
    };
    const r = resolveAvailability(av, '2026-06-17', 0);
    expect(r).toHaveLength(1);
    expect(r[0].dayOfWeek).toBe(5); // override slot, not recurring
  });

  it('resolveAvailability returns [] for null', () => {
    expect(resolveAvailability(null, '2026-06-17')).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────
// INTEGRATION
// ──────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST required');
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI);
  app = require('../app');
  User = require('../models/User');
  Business = require('../models/Business');
  Location = require('../models/Location');
  StaffMember = require('../models/StaffMember');
  Availability = require('../models/Availability');

  owner = await User.create({ email: `p3-owner+${RUN_ID}@shiftwise.dev`, password: 'SecureP@ss1234', name: 'Owner', isVerified: true });
  ownerToken = signToken(owner._id);
  biz = await Business.create({ name: 'P3 Biz', ownerId: owner._id });
  location = await Location.create({ businessId: biz._id, name: 'Loc' });

  // A joined staff member (linked user)
  staffUser = await User.create({ email: `p3-staff+${RUN_ID}@shiftwise.dev`, password: 'SecureP@ss1234', name: 'Staff', isVerified: true });
  staffToken = signToken(staffUser._id);
  staffMember = await StaffMember.create({
    businessId: biz._id, name: 'Staff', email: staffUser.email,
    userId: staffUser._id, accountStatus: 'active', locationIds: [location._id],
  });
});

afterAll(async () => {
  try {
    await Availability.deleteMany({ staffId: staffMember?._id });
    await StaffMember.deleteMany({ businessId: biz?._id });
    await Location.deleteMany({ businessId: biz?._id });
    await Business.deleteMany({ _id: biz?._id });
    await User.deleteMany({ _id: { $in: [owner?._id, staffUser?._id] } });
  } catch (err) { console.warn('Teardown warning:', err.message); }
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
});

describe('Staff availability', () => {
  it('GET /my/availability lazily creates + returns', async () => {
    const res = await request(app).get('/api/v1/my/availability').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(staffMember._id.toString());
  });

  it('PUT /my/availability sets the recurring pattern', async () => {
    const res = await request(app).put('/api/v1/my/availability').set(auth(staffToken))
      .send({ recurring: { slots: [{ dayOfWeek: 0, available: true, preferredStart: '09:00', preferredEnd: '17:00' }] } });
    expect(res.status).toBe(200);
    expect(res.body.data.recurring.slots).toHaveLength(1);
  });

  it('owner cannot use /my/availability (403)', async () => {
    const res = await request(app).get('/api/v1/my/availability').set(auth(ownerToken));
    expect(res.status).toBe(403);
  });

  it('PUT /my/availability/override sets a week override', async () => {
    const res = await request(app).put('/api/v1/my/availability/override').set(auth(staffToken))
      .send({ weekOf: '2026-06-17', slots: [{ dayOfWeek: 5, available: true }] });
    expect(res.status).toBe(200);
    expect(res.body.data.overrides.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Manager overview', () => {
  it('GET /locations/:id/availability shows staff + resolved (override beats recurring for that week)', async () => {
    const res = await request(app).get(`/api/v1/locations/${location._id}/availability?weekOf=2026-06-17`).set(auth(ownerToken));
    expect(res.status).toBe(200);
    const entry = res.body.data.find((d) => d.staffId === staffMember._id.toString());
    expect(entry).toBeTruthy();
    expect(entry.submitted).toBe(true);
    // For the week of 2026-06-17, the override (day 5) should be returned, not recurring (day 0)
    expect(entry.resolvedSlots.some((s) => s.dayOfWeek === 5)).toBe(true);
  });
});

describe('Override request flow', () => {
  let requestId;

  it('owner proposes an override → pending', async () => {
    const res = await request(app).post(`/api/v1/availability/${staffMember._id}/override-request`).set(auth(ownerToken))
      .send({ weekOf: '2026-06-22', slots: [{ dayOfWeek: 1, available: true }], note: 'Cover needed' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    requestId = res.body.data.requestId;
  });

  it('staff confirms → override applied', async () => {
    const res = await request(app).put(`/api/v1/availability/override-request/${requestId}`).set(auth(staffToken))
      .send({ decision: 'confirm' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');

    // Verify the override now exists for that week (week of 2026-06-22)
    const av = await Availability.findOne({ staffId: staffMember._id });
    const wk = startOfWeek('2026-06-22').getTime();
    const applied = av.overrides.find((o) => startOfWeek(o.weekOf).getTime() === wk);
    expect(applied).toBeTruthy();
    expect(applied.slots.some((s) => s.dayOfWeek === 1)).toBe(true);
  });

  it('confirming an already-reviewed request → 409', async () => {
    const res = await request(app).put(`/api/v1/availability/override-request/${requestId}`).set(auth(staffToken))
      .send({ decision: 'confirm' });
    expect(res.status).toBe(409);
  });
});

describe('Tenancy', () => {
  it('owner B cannot request override for owner A\'s staff → 404', async () => {
    const ownerB = await User.create({ email: `p3-ownerB+${RUN_ID}@shiftwise.dev`, password: 'SecureP@ss1234', name: 'B', isVerified: true });
    await Business.create({ name: 'P3 BizB', ownerId: ownerB._id });
    const tokenB = signToken(ownerB._id);
    const res = await request(app).post(`/api/v1/availability/${staffMember._id}/override-request`).set(auth(tokenB))
      .send({ weekOf: '2026-06-29', slots: [] });
    expect(res.status).toBe(404);
    // cleanup
    await Business.deleteMany({ ownerId: ownerB._id });
    await User.deleteOne({ _id: ownerB._id });
  });
});
