// tests/phase2-staff-invite.test.js
// Phase 2 Testing Gate — §9 Phase 2 (Team + Invites)
//
// Validates: staff CRUD, bulk import, invite issue→accept→active,
// expired/invalid token rejection, manuallyManaged persists, emergency notify
// calls the mailer, email-match fallback, and tenancy isolation.
//
// Email service is fully mocked — no real emails are sent; we assert it was
// "called with" the right args and capture the raw invite token from the mock.

// ── Mock the mailer BEFORE app/controllers are required ──
jest.mock('../services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendStaffInviteEmail: jest.fn().mockResolvedValue({}),
  sendEmergencyShiftEmail: jest.fn().mockResolvedValue({}),
}));

const request  = require('supertest');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const config   = require('../config/config');
const emailService = require('../services/emailService');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();

let app, User, Business, Location, StaffMember, StaffInvite;
let ownerA, ownerB, tokenA, tokenB, bizA, bizB;

const EMAIL_A = `p2-owner-a+${RUN_ID}@shiftwise.dev`;
const EMAIL_B = `p2-owner-b+${RUN_ID}@shiftwise.dev`;

const signToken = (id) => jwt.sign({ id }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST required');
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGO_URI);

  app = require('../app');
  User = require('../models/User');
  Business = require('../models/Business');
  Location = require('../models/Location');
  StaffMember = require('../models/StaffMember');
  StaffInvite = require('../models/StaffInvite');

  ownerA = await User.create({ email: EMAIL_A, password: 'SecureP@ss1234', name: 'Owner A', isVerified: true });
  ownerB = await User.create({ email: EMAIL_B, password: 'SecureP@ss1234', name: 'Owner B', isVerified: true });
  tokenA = signToken(ownerA._id);
  tokenB = signToken(ownerB._id);
  bizA = await Business.create({ name: 'Biz A', ownerId: ownerA._id });
  bizB = await Business.create({ name: 'Biz B', ownerId: ownerB._id });
});

afterAll(async () => {
  try {
    const bizIds = [bizA?._id, bizB?._id];
    await StaffInvite.deleteMany({ businessId: { $in: bizIds } });
    const staffEmails = await StaffMember.find({ businessId: { $in: bizIds } }).distinct('email');
    await StaffMember.deleteMany({ businessId: { $in: bizIds } });
    await Location.deleteMany({ businessId: { $in: bizIds } });
    await Business.deleteMany({ _id: { $in: bizIds } });
    // remove users created by join flow + owners
    await User.deleteMany({ email: { $in: [EMAIL_A, EMAIL_B, ...staffEmails] } });
  } catch (err) { console.warn('Teardown warning:', err.message); }
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
});

beforeEach(() => jest.clearAllMocks());

// ──────────────────────────────────────────────────────────
describe('Staff CRUD', () => {
  let staffId;

  it('POST /staff creates a record (status none, no invite)', async () => {
    const res = await request(app).post('/api/v1/staff').set(auth(tokenA))
      .send({ name: 'Alex', email: `alex+${RUN_ID}@shiftwise.dev`, role: 'barista', hourlyRate: 250 });
    expect(res.status).toBe(201);
    expect(res.body.data.accountStatus).toBe('none');
    expect(emailService.sendStaffInviteEmail).not.toHaveBeenCalled();
    staffId = res.body.data._id;
  });

  it('POST /staff duplicate email in same business → 409', async () => {
    const res = await request(app).post('/api/v1/staff').set(auth(tokenA))
      .send({ name: 'Alex Dup', email: `alex+${RUN_ID}@shiftwise.dev` });
    expect(res.status).toBe(409);
  });

  it('POST /staff with no email → 422', async () => {
    const res = await request(app).post('/api/v1/staff').set(auth(tokenA)).send({ name: 'NoEmail' });
    expect(res.status).toBe(422);
  });

  it('PUT /staff/:id persists manuallyManaged toggle', async () => {
    const res = await request(app).put(`/api/v1/staff/${staffId}`).set(auth(tokenA))
      .send({ manuallyManaged: true, hourlyRate: 300 });
    expect(res.status).toBe(200);
    expect(res.body.data.manuallyManaged).toBe(true);
    expect(res.body.data.hourlyRate).toBe(300);
  });

  it('GET /staff lists active staff', async () => {
    const res = await request(app).get('/api/v1/staff').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /staff/:id soft-deletes', async () => {
    const res = await request(app).delete(`/api/v1/staff/${staffId}`).set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
describe('Bulk import', () => {
  it('POST /staff/bulk creates valid rows and reports errors', async () => {
    const res = await request(app).post('/api/v1/staff/bulk').set(auth(tokenA)).send({
      rows: [
        { name: 'Bulk One', email: `bulk1+${RUN_ID}@shiftwise.dev` },
        { name: 'Bulk Two', email: `bulk2+${RUN_ID}@shiftwise.dev` },
        { name: 'No Email' }, // invalid
      ],
      sendInvite: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.created.length).toBe(2);
    expect(res.body.data.errors.length).toBe(1);
    expect(res.body.data.errors[0].row).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────
describe('Invite → Accept flow', () => {
  let inviteStaffId, rawToken;
  const inviteeEmail = `invitee+${RUN_ID}@shiftwise.dev`;

  it('POST /staff with sendInvite=true issues an invite + emails it', async () => {
    const res = await request(app).post('/api/v1/staff').set(auth(tokenA))
      .send({ name: 'Invitee', email: inviteeEmail, sendInvite: true });
    expect(res.status).toBe(201);
    expect(res.body.data.accountStatus).toBe('invited');
    expect(emailService.sendStaffInviteEmail).toHaveBeenCalledTimes(1);

    // Capture the raw token passed to the mailer (arg 1)
    rawToken = emailService.sendStaffInviteEmail.mock.calls[0][1];
    expect(typeof rawToken).toBe('string');
    inviteStaffId = res.body.data._id;

    // An invite row exists (storing the HASH, not the raw token)
    const invite = await StaffInvite.findOne({ staffId: inviteStaffId });
    expect(invite).toBeTruthy();
    expect(invite.tokenHash).not.toBe(rawToken);
  });

  it('GET /join/validate returns business name for a valid token', async () => {
    const res = await request(app).get(`/api/v1/join/validate?token=${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.businessName).toBe('Biz A');
    expect(res.body.data.email).toBe(inviteeEmail);
  });

  it('GET /join/validate with bad token → 400', async () => {
    const res = await request(app).get('/api/v1/join/validate?token=garbage');
    expect(res.status).toBe(400);
  });

  it('POST /join/accept creates a user, marks staff active, returns a token', async () => {
    const res = await request(app).post('/api/v1/join/accept')
      .send({ token: rawToken, password: 'JoinP@ssword12', name: 'Invitee Joined' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe(inviteeEmail);

    const staff = await StaffMember.findById(inviteStaffId);
    expect(staff.accountStatus).toBe('active');
    expect(staff.userId).toBeTruthy();
  });

  it('POST /join/accept with the same (now used) token → 400', async () => {
    const res = await request(app).post('/api/v1/join/accept')
      .send({ token: rawToken, password: 'JoinP@ssword12' });
    expect(res.status).toBe(400);
  });

  it('expired invite is rejected', async () => {
    // Create staff + invite, then force-expire it
    const s = await request(app).post('/api/v1/staff').set(auth(tokenA))
      .send({ name: 'Expired', email: `expired+${RUN_ID}@shiftwise.dev`, sendInvite: true });
    const raw = emailService.sendStaffInviteEmail.mock.calls.at(-1)[1];
    await StaffInvite.updateOne({ staffId: s.body.data._id }, { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).post('/api/v1/join/accept').send({ token: raw, password: 'JoinP@ssword12' });
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────
describe('Email-match fallback', () => {
  it('links a pre-existing user instead of creating a duplicate', async () => {
    const existingEmail = `existing+${RUN_ID}@shiftwise.dev`;
    const existingUser = await User.create({ email: existingEmail, password: 'SecureP@ss1234', name: 'Existing', isVerified: true });

    const s = await request(app).post('/api/v1/staff').set(auth(tokenA))
      .send({ name: 'Existing', email: existingEmail, sendInvite: true });
    const raw = emailService.sendStaffInviteEmail.mock.calls.at(-1)[1];

    // Accept WITHOUT a password — user already exists, so it should link
    const res = await request(app).post('/api/v1/join/accept').send({ token: raw });
    expect(res.status).toBe(200);

    const staff = await StaffMember.findById(s.body.data._id);
    expect(staff.userId.toString()).toBe(existingUser._id.toString());

    // No duplicate user created
    const count = await User.countDocuments({ email: existingEmail });
    expect(count).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────
describe('Emergency notify', () => {
  it('POST /staff/:id/notify calls the mailer', async () => {
    const s = await request(app).post('/api/v1/staff').set(auth(tokenA))
      .send({ name: 'Notify Me', email: `notify+${RUN_ID}@shiftwise.dev` });
    const res = await request(app).post(`/api/v1/staff/${s.body.data._id}/notify`).set(auth(tokenA))
      .send({ message: 'Please cover the morning shift.' });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(emailService.sendEmergencyShiftEmail).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────
describe('Tenancy isolation', () => {
  let aStaffId;
  beforeAll(async () => {
    const s = await request(app).post('/api/v1/staff').set(auth(tokenA))
      .send({ name: 'A Staff', email: `astaff+${RUN_ID}@shiftwise.dev` });
    aStaffId = s.body.data._id;
  });

  it('Owner B CANNOT update Owner A\'s staff → 404', async () => {
    const res = await request(app).put(`/api/v1/staff/${aStaffId}`).set(auth(tokenB)).send({ name: 'Hijack' });
    expect(res.status).toBe(404);
  });

  it('Owner B CANNOT invite Owner A\'s staff → 404', async () => {
    const res = await request(app).post(`/api/v1/staff/${aStaffId}/invite`).set(auth(tokenB));
    expect(res.status).toBe(404);
  });

  it('Owner B CANNOT notify Owner A\'s staff → 404', async () => {
    const res = await request(app).post(`/api/v1/staff/${aStaffId}/notify`).set(auth(tokenB)).send({});
    expect(res.status).toBe(404);
  });

  it('Owner B\'s staff list does not include Owner A\'s staff', async () => {
    const res = await request(app).get('/api/v1/staff').set(auth(tokenB));
    expect(res.status).toBe(200);
    expect(res.body.data.find((s) => s._id === aStaffId)).toBeUndefined();
  });
});
