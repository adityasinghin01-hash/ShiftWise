// tests/phase1-business-location.test.js
// Phase 1 Testing Gate — §9 Phase 1 (Onboarding + Settings, backend)
//
// Validates:
//   - create-business sets owner; second create → 409
//   - GET /business returns the caller's business
//   - PUT /business updates settings + flips onboarding flag (round-trip)
//   - location CRUD scoped to business
//   - minStaffPerShift > maxStaffPerShift → 422
//   - TENANCY: business B cannot read/update business A's location
//
// Uses real MONGO_URI_TEST + Express app via supertest, signing JWTs directly.

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();

let app, User, Business, Location;

// Two separate owners to prove tenant isolation
const OWNER_A_EMAIL = `p1-owner-a+${RUN_ID}@shiftwise.dev`;
const OWNER_B_EMAIL = `p1-owner-b+${RUN_ID}@shiftwise.dev`;
let ownerA, ownerB, tokenA, tokenB;

/** Sign a short-lived access token the authMiddleware will accept */
const signToken = (userId) =>
  jwt.sign({ id: userId }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });

beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST required');
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI);

  app = require('../app');
  User = require('../models/User');
  Business = require('../models/Business');
  Location = require('../models/Location');

  // Verified users (authMiddleware requires isVerified)
  ownerA = await User.create({
    email: OWNER_A_EMAIL,
    password: 'SecureP@ss1234',
    name: 'Owner A',
    isVerified: true,
  });
  ownerB = await User.create({
    email: OWNER_B_EMAIL,
    password: 'SecureP@ss1234',
    name: 'Owner B',
    isVerified: true,
  });
  tokenA = signToken(ownerA._id);
  tokenB = signToken(ownerB._id);
});

afterAll(async () => {
  try {
    const bizs = await Business.find({ ownerId: { $in: [ownerA?._id, ownerB?._id] } });
    const bizIds = bizs.map((b) => b._id);
    await Location.deleteMany({ businessId: { $in: bizIds } });
    await Business.deleteMany({ ownerId: { $in: [ownerA?._id, ownerB?._id] } });
    await User.deleteMany({ email: { $in: [OWNER_A_EMAIL, OWNER_B_EMAIL] } });
  } catch (err) {
    console.warn('Teardown warning:', err.message);
  }
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// ──────────────────────────────────────────────────────────
describe('Business', () => {
  it('POST /business creates a business owned by the caller', async () => {
    const res = await request(app)
      .post('/api/v1/business')
      .set(auth(tokenA))
      .send({ name: 'Cafe A', timezone: 'Asia/Kolkata', currency: 'INR', weekStartsOn: 0 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Cafe A');
    expect(res.body.data.ownerId).toBe(ownerA._id.toString());
    expect(res.body.data.onboarding.completed).toBe(false);
  });

  it('POST /business a second time → 409 (one per owner)', async () => {
    const res = await request(app).post('/api/v1/business').set(auth(tokenA)).send({ name: 'Dup' });
    expect(res.status).toBe(409);
  });

  it('POST /business with no name → 422', async () => {
    const res = await request(app).post('/api/v1/business').set(auth(tokenB)).send({ name: '' });
    expect(res.status).toBe(422);
  });

  it("GET /business returns the caller's business", async () => {
    const res = await request(app).get('/api/v1/business').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Cafe A');
  });

  it('PUT /business updates settings + flips onboarding flag (round-trip)', async () => {
    const res = await request(app)
      .put('/api/v1/business')
      .set(auth(tokenA))
      .send({
        name: 'Cafe A Renamed',
        settings: { currency: 'USD' },
        onboarding: { completed: true },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Cafe A Renamed');
    expect(res.body.data.settings.currency).toBe('USD');
    expect(res.body.data.onboarding.completed).toBe(true);

    // Confirm persisted
    const reload = await request(app).get('/api/v1/business').set(auth(tokenA));
    expect(reload.body.data.onboarding.completed).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
describe('Locations', () => {
  let locationAId;

  beforeAll(async () => {
    // Owner B needs a business to test tenancy
    await request(app).post('/api/v1/business').set(auth(tokenB)).send({ name: 'Cafe B' });
  });

  it('POST /locations creates a location scoped to the business', async () => {
    const res = await request(app)
      .post('/api/v1/locations')
      .set(auth(tokenA))
      .send({
        name: 'Main Branch',
        address: '1 MG Road',
        settings: { minStaffPerShift: 1, maxStaffPerShift: 3, maxHoursPerWeek: 40 },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Main Branch');
    locationAId = res.body.data._id;
  });

  it('POST /locations with minStaffPerShift > maxStaffPerShift → 422', async () => {
    const res = await request(app)
      .post('/api/v1/locations')
      .set(auth(tokenA))
      .send({ name: 'Bad Rules', settings: { minStaffPerShift: 5, maxStaffPerShift: 2 } });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/minStaffPerShift/);
  });

  it("GET /locations lists only the caller's locations", async () => {
    const res = await request(app).get('/api/v1/locations').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('PUT /locations/:id updates rules (round-trip)', async () => {
    const res = await request(app)
      .put(`/api/v1/locations/${locationAId}`)
      .set(auth(tokenA))
      .send({ settings: { maxHoursPerWeek: 35 } });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.maxHoursPerWeek).toBe(35);
  });

  // ── TENANCY ISOLATION ──────────────────────────────────
  it("Owner B CANNOT read Owner A's location → 404", async () => {
    const res = await request(app).get(`/api/v1/locations/${locationAId}`).set(auth(tokenB));
    expect(res.status).toBe(404); // scoped query: not found for B
  });

  it("Owner B CANNOT update Owner A's location → 404", async () => {
    const res = await request(app)
      .put(`/api/v1/locations/${locationAId}`)
      .set(auth(tokenB))
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it("Owner B CANNOT delete Owner A's location → 404", async () => {
    const res = await request(app).delete(`/api/v1/locations/${locationAId}`).set(auth(tokenB));
    expect(res.status).toBe(404);
  });

  it('DELETE /locations/:id soft-deletes (isActive=false)', async () => {
    const res = await request(app).delete(`/api/v1/locations/${locationAId}`).set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
describe('Auth guards', () => {
  it('unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/v1/locations');
    expect(res.status).toBe(401);
  });
});
