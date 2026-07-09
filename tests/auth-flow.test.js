// tests/auth-flow.test.js
// T-01: Full auth lifecycle integration test.
// Covers: signup → verify → login → token refresh → logout.
// Uses real MongoDB (MONGO_URI_TEST) and the Express app via supertest.
// reCAPTCHA is bypassed using the 'dev-bypass' magic token (NODE_ENV=test).

const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');

const MONGO_URI = process.env.MONGO_URI_TEST;
const RUN_ID = Date.now();

const TEST_EMAIL = `authflow+${RUN_ID}@spinx.dev`;
const TEST_PASSWORD = 'SecureP@ss1234'; // Meets passwordValidator requirements

let app;
let User;
let Subscription;

beforeAll(async () => {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI_TEST env var is required for tests');
  }
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  app = require('../app');
  User = require('../models/User');
  Subscription = require('../models/Subscription');
});

afterAll(async () => {
  try {
    // Clean up test data
    const user = await User.findOne({ email: TEST_EMAIL });
    if (user) {
      await Subscription.deleteMany({ userId: user._id });
      await User.findByIdAndDelete(user._id);
    }
  } catch (err) {
    console.warn('Teardown warning:', err.message);
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});

// ── SIGNUP ─────────────────────────────────────────────────

describe('Auth Flow: Signup', () => {
  // Tokens from signup — captured to validate they are returned;
  // not consumed by later describe blocks (login flow issues its own tokens).
  let _signupAccessToken;
  let _signupRefreshToken;

  it('should create a new account and NOT return tokens (email verification required)', async () => {
    const res = await request(app).post('/api/v1/signup').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
      source: 'app',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // C-03 FIX: Signup no longer returns tokens — users must verify email first.
    // Tokens are only issued after successful login (which requires isVerified=true).
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('should have stored a hashed verification token (not raw)', async () => {
    const user = await User.findOne({ email: TEST_EMAIL });
    expect(user).toBeTruthy();
    expect(user.isVerified).toBe(false);
    expect(user.verificationToken).toBeDefined();
    // Hashed tokens are 64 hex chars (SHA-256)
    expect(user.verificationToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should reject duplicate signup for verified user', async () => {
    // First, manually verify the user
    const user = await User.findOne({ email: TEST_EMAIL });
    user.isVerified = true;
    await user.save();

    const res = await request(app).post('/api/v1/signup').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    // Rule 1: a verified duplicate is rejected explicitly (clearer UX over
    // anti-enumeration — product decision).
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already registered/i);

    // Revert verification for later tests
    user.isVerified = false;
    await user.save();
  });

  it('should allow re-signup for unverified user (refreshes token)', async () => {
    const oldUser = await User.findOne({ email: TEST_EMAIL });
    const oldToken = oldUser.verificationToken;

    const res = await request(app).post('/api/v1/signup').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Verification email sent');

    // R-01: Re-signup should NOT return tokens
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();

    // Verification token should have been rotated
    const updatedUser = await User.findOne({ email: TEST_EMAIL });
    expect(updatedUser.verificationToken).not.toBe(oldToken);
  });

  it('should reject signup without reCAPTCHA token', async () => {
    const res = await request(app)
      .post('/api/v1/signup')
      .send({
        email: `noreca+${RUN_ID}@spinx.dev`,
        password: TEST_PASSWORD,
      });

    // Wave 4.1 / B3: recaptcha presence is now enforced by the
    // verifyRecaptcha middleware (returns 400), not the validate.js schema
    // (which would return 422). One owner, one status code.
    expect(res.status).toBe(400);
  });

  it('should reject signup with weak password', async () => {
    const res = await request(app)
      .post('/api/v1/signup')
      .send({
        email: `weakpw+${RUN_ID}@spinx.dev`,
        password: '123',
        recaptchaToken: 'dev-bypass',
      });

    // M11 FIX: validation errors return 422
    expect(res.status).toBe(422);
  });
});

// ── VERIFY EMAIL ──────────────────────────────────────────

describe('Auth Flow: Email Verification', () => {
  it('should verify email with a valid token', async () => {
    // Generate a fresh raw token, hash it, save to user
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashToken = require('../utils/hashToken');
    const hashed = hashToken(rawToken);

    const user = await User.findOne({ email: TEST_EMAIL });
    user.verificationToken = hashed;
    user.verificationTokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
    user.isVerified = false;
    await user.save();

    const res = await request(app).get(`/api/v1/verify-email?token=${rawToken}`);

    expect(res.status).toBe(200);
    // Verification returns HTML, not JSON
    expect(res.text).toContain('Email Verified');

    // Confirm the DB state was updated
    const verifiedUser = await User.findOne({ email: TEST_EMAIL });
    expect(verifiedUser.isVerified).toBe(true);
    expect(verifiedUser.verificationToken).toBeUndefined();
    expect(verifiedUser.verificationTokenExpiry).toBeUndefined();
  });

  it('should reject expired verification tokens', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashToken = require('../utils/hashToken');
    const hashed = hashToken(rawToken);

    const user = await User.findOne({ email: TEST_EMAIL });
    user.verificationToken = hashed;
    user.verificationTokenExpiry = Date.now() - 1000; // Already expired
    user.isVerified = false;
    await user.save();

    const res = await request(app).get(`/api/v1/verify-email?token=${rawToken}`);

    expect(res.status).toBe(400);
    expect(res.text).toContain('Link Expired');

    // Re-verify for subsequent tests
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpiry = undefined;
    await user.save();
  });

  it('should reject verification with no token', async () => {
    const res = await request(app).get('/api/v1/verify-email');
    expect(res.status).toBe(400);
  });
});

// ── LOGIN ─────────────────────────────────────────────────

describe('Auth Flow: Login', () => {
  let accessToken;
  let refreshToken;

  it('should login a verified user and return tokens', async () => {
    // Ensure user is verified
    const user = await User.findOne({ email: TEST_EMAIL });
    expect(user.isVerified).toBe(true);

    const res = await request(app).post('/api/v1/login').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.isVerified).toBe(true);

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('should reject login with wrong password', async () => {
    const res = await request(app).post('/api/v1/login').send({
      email: TEST_EMAIL,
      password: 'WrongPassword!123',
      recaptchaToken: 'dev-bypass',
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('should reject login for unverified user', async () => {
    const user = await User.findOne({ email: TEST_EMAIL });
    user.isVerified = false;
    await user.save();

    const res = await request(app).post('/api/v1/login').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    // Wave 4 / C5 FIX: unverified login now returns the same plain 401 as
    // every other auth failure. The previous `isVerified: false` hint in the
    // body was a partial enumeration oracle (correct password + 401 with
    // hint = "this email exists and isn't verified yet"). The mobile/web
    // client now uses GET /check-verification-status to distinguish.
    expect(res.status).toBe(401);
    expect(res.body.isVerified).toBeUndefined();

    // Restore verified state
    user.isVerified = true;
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
  });

  it('should reject login with non-existent email', async () => {
    const res = await request(app).post('/api/v1/login').send({
      email: 'nonexistent@spinx.dev',
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    expect(res.status).toBe(401);
    // C3 FIX: Same 401 as wrong-password — no status-code enumeration oracle.
  });

  // Use the tokens from the successful login for the next tests
  it('should store refresh token for later use', () => {
    // Share tokens with Token Refresh tests via module-level vars
    _globalAccessToken = accessToken;
    globalRefreshToken = refreshToken;
  });
});

// Module-level vars to pass tokens between describe blocks
// globalAccessToken is updated alongside globalRefreshToken for completeness;
// only globalRefreshToken is consumed by the Token Refresh describe block.
let _globalAccessToken;
let globalRefreshToken;

// ── TOKEN REFRESH ─────────────────────────────────────────

describe('Auth Flow: Token Refresh', () => {
  it('should refresh tokens and return new pair', async () => {
    expect(globalRefreshToken).toBeDefined();

    const res = await request(app).post('/api/v1/refresh-token').send({
      refreshToken: globalRefreshToken,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();

    // New tokens should differ from old ones (rotation)
    expect(res.body.refreshToken).not.toBe(globalRefreshToken);

    // Save the new refresh token for logout test
    globalRefreshToken = res.body.refreshToken;
    _globalAccessToken = res.body.accessToken;
  });

  it('should detect token reuse and revoke all sessions', async () => {
    // Get a fresh login token pair
    const loginRes = await request(app).post('/api/v1/login').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    expect(loginRes.status).toBe(200);
    const firstRefresh = loginRes.body.refreshToken;

    // Use the refresh token once (valid rotation)
    const rotateRes = await request(app).post('/api/v1/refresh-token').send({
      refreshToken: firstRefresh,
    });

    expect(rotateRes.status).toBe(200);
    // secondRefresh is the rotated token — not re-used here (testing reuse of firstRefresh instead)
    const _secondRefresh = rotateRes.body.refreshToken;

    // Now REUSE the old (already-rotated) token → reuse detection
    const reuseRes = await request(app).post('/api/v1/refresh-token').send({
      refreshToken: firstRefresh,
    });

    expect(reuseRes.status).toBe(403);
    expect(reuseRes.body.message).toContain('reuse detected');

    // All sessions should be wiped
    const user = await User.findOne({ email: TEST_EMAIL });
    expect(user.refreshTokens.length).toBe(0);

    // Re-login to get a fresh token for the logout test
    const reLoginRes = await request(app).post('/api/v1/login').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    globalRefreshToken = reLoginRes.body.refreshToken;
  });

  it('should reject refresh with missing token', async () => {
    const res = await request(app).post('/api/v1/refresh-token').send({});
    // M11 FIX: validation errors return 422
    expect(res.status).toBe(422);
  });

  it('should reject refresh with garbage token', async () => {
    const res = await request(app).post('/api/v1/refresh-token').send({
      refreshToken: 'completely.invalid.jwt',
    });

    expect(res.status).toBe(403);
  });
});

// ── LOGOUT ────────────────────────────────────────────────

describe('Auth Flow: Logout', () => {
  it('should logout successfully and remove refresh token', async () => {
    expect(globalRefreshToken).toBeDefined();

    const res = await request(app).post('/api/v1/logout').send({
      refreshToken: globalRefreshToken,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Logged out');

    // Verify the token was actually removed from the DB
    const hashToken = require('../utils/hashToken');
    const hashed = hashToken(globalRefreshToken);
    const user = await User.findOne({ email: TEST_EMAIL });
    const found = user.refreshTokens.some((t) => t.tokenHash === hashed);
    expect(found).toBe(false);
  });

  it('should return 200 for invalid/already-used token (logout is idempotent)', async () => {
    const res = await request(app).post('/api/v1/logout').send({
      refreshToken: globalRefreshToken, // Already removed
    });

    // H-02 FIX: Logout always returns 200 regardless of token validity.
    // Returning 400 for unknown tokens is a session oracle.
    expect(res.status).toBe(200);
  });

  it('should reject logout with missing token', async () => {
    const res = await request(app).post('/api/v1/logout').send({});

    expect(res.status).toBe(400);
  });
});

// ── ACCOUNT LOCKOUT ───────────────────────────────────────

describe('Auth Flow: Account Lockout', () => {
  it('should lock account after 5 failed login attempts', async () => {
    // Reset any existing lockout
    const user = await User.findOne({ email: TEST_EMAIL });
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    // Attempt 5 bad logins
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/login').send({
        email: TEST_EMAIL,
        password: 'WrongPassword!123',
        recaptchaToken: 'dev-bypass',
      });
    }

    // 6th attempt should be blocked by lockout
    const res = await request(app).post('/api/v1/login').send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      recaptchaToken: 'dev-bypass',
    });

    // H2 FIX: Lockout now returns 401 "Invalid credentials" silently —
    // no 403 "locked" message that would reveal the account exists.
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');

    // Verify DB state
    const lockedUser = await User.findOne({ email: TEST_EMAIL });
    expect(lockedUser.failedLoginAttempts).toBeGreaterThanOrEqual(5);
    expect(lockedUser.lockUntil).toBeDefined();

    // Clean up: remove lockout for any subsequent runs
    lockedUser.failedLoginAttempts = 0;
    lockedUser.lockUntil = undefined;
    await lockedUser.save();
  });
});
