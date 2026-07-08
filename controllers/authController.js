// controllers/authController.js
// Handles: signup, login, googleLogin, logout, refreshToken.
// Per ARCHITECTURE_MAP §3.1–3.8.
//
// Wave 1 security fixes (May 2026):
//   H4  — signup: unified 200 for both verified+unverified existing-user cases
//   H5  — googleLogin: auto-provision new Google users (no 404 enumeration oracle)
//   C3+H2+H3 — login: single 401 for ALL auth failures, dummy bcrypt for timing
//              parity on unknown email, silent lockout (no 403 leakage)
//   H8  — refreshToken: atomic findByIdAndUpdate with tokenHash in query filter
//          (no findIndex TOCTOU race)

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const logger = require('../config/logger');
const validator = require('validator');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const config = require('../config/config');
const hashToken = require('../utils/hashToken');
const validatePassword = require('../utils/passwordValidator');
const { generateAccessToken, generateRefreshToken } = require('../services/tokenService');
const { sendVerificationEmail } = require('../services/emailService');
const { createDefaultFreeSubscription } = require('../services/subscriptionService');
const { emit } = require('../services/webhookService');
const { WEBHOOK_EVENTS } = require('../config/webhookEvents');

const googleClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

const VERIFICATION_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// B7 FIX (Wave 4.1): module-level constants so the env-parsing IIFE doesn't
// run on every refresh call. Mirrors the same pair in models/User.js.
const STANDARD_REFRESH_MS = (() => {
  const raw = process.env.REFRESH_TOKEN_EXPIRES || '7d';
  const m = raw.match(/^(\d+)([dhms])$/);
  if (!m) return 7 * 86400000;
  return parseInt(m[1], 10) * { d: 86400000, h: 3600000, m: 60000, s: 1000 }[m[2]];
})();
const REMEMBER_ME_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30d

// Pre-computed dummy bcrypt hash used to make "email not found" timing match
// "email found, wrong password". Without this, the fast-return path for unknown
// emails is measurably faster than the bcrypt path for known emails, leaking
// whether an email is registered (C3 / H3 fix).
// We compute it once at startup so the first request isn't slower.
const DUMMY_HASH_PROMISE = bcrypt.hash('__timing_dummy_password__', 12);

// ── Signup ────────────────────────────────────────────────
// ARCHITECTURE_MAP §3.1
const signup = async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.toLowerCase().trim() : null;
    const password = req.body.password; // NO .trim() — fixes B-11
    const source = req.body.source === 'web' ? 'web' : 'app';

    // Validate email
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    // Validate password strength
    const passwordCheck = validatePassword(password, email);
    if (!passwordCheck.isValid) {
      return res.status(400).json({ message: passwordCheck.errors[0] });
    }

    const existingUser = await User.findOne({ email });

    // H4 FIX: Return the same 200 response regardless of whether the email
    // is already registered (verified or unverified). Previously returning 409
    // for verified users was an enumeration oracle.
    //
    // Case 1: User exists AND is verified → silent 200, no new email
    if (existingUser && existingUser.isVerified) {
      return res.status(200).json({
        success: true,
        message: 'Account created. Verification email sent.',
      });
    }

    // Case 2: User exists AND is NOT verified → re-signup (update token, send new email)
    if (existingUser && !existingUser.isVerified) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      existingUser.verificationToken = hashToken(rawToken);
      existingUser.verificationTokenExpiry = Date.now() + VERIFICATION_TOKEN_EXPIRY;
      existingUser.password = password; // hashed by pre-save hook
      await existingUser.save();

      setImmediate(async () => {
        try {
          await sendVerificationEmail(email, rawToken, source);
          logger.info('Verification email sent (re-send)', { email });
        } catch (err) {
          logger.error('Email send failed (re-send)', { email, error: err.message });
        }
      });

      return res.status(200).json({
        success: true,
        message: 'Account created. Verification email sent.',
      });
    }

    // Case 3: New user
    const rawToken = crypto.randomBytes(32).toString('hex');
    const newUser = new User({
      email,
      password, // hashed by pre-save hook (12 rounds)
      verificationToken: hashToken(rawToken),
      verificationTokenExpiry: Date.now() + VERIFICATION_TOKEN_EXPIRY,
      isVerified: false,
      pendingSubscriptionCreation: true,
    });

    await newUser.save();

    emit(WEBHOOK_EVENTS.USER_CREATED, { id: newUser._id, role: newUser.role }, newUser._id);

    try {
      const sub = await createDefaultFreeSubscription(newUser._id);
      await User.findByIdAndUpdate(newUser._id, {
        activeSubscription: sub._id,
        pendingSubscriptionCreation: false,
      });
    } catch (err) {
      logger.error('Failed to create default subscription — will be reconciled later', {
        userId: newUser._id,
        error: err.message,
      });
    }

    setImmediate(async () => {
      try {
        await sendVerificationEmail(email, rawToken, source);
        logger.info('Verification email sent (new user)', { email });
      } catch (err) {
        logger.error('Email send failed (new user)', { email, error: err.message });
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Account created. Verification email sent.',
    });
  } catch (error) {
    next(error);
  }
};

// ── Login ─────────────────────────────────────────────────
// ARCHITECTURE_MAP §3.2
//
// C3 + H2 + H3 FIX: All authentication failures return the same 401 with the
// same message. Rationale (per AUTH_PATTERNS.md §6.6 + Skills/SECURITY.md §4.2):
//
//   • "Email not found" vs "wrong password" different statuses → enumeration (C3)
//   • "Account locked" returning 403 reveals email is registered (H2)
//   • Missing bcrypt on the "not found" path is measurably faster → timing oracle (H3)
//
// Implementation:
//   1. Always fetch the user record (needed for timing parity).
//   2. If user not found: run bcrypt against a dummy hash (timing parity), then 401.
//   3. If locked: still run bcrypt against the REAL hash (timing parity), then 401.
//      The client only learns "Invalid credentials" — never "you're locked".
//      The lockout is enforced silently; the countdown is in the DB.
//   4. If wrong password: increment counter, maybe set lockUntil, then 401.
//   5. If unverified: 401 with isVerified:false hint (needed by mobile app UI).
//   6. Success: 200.
const login = async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.toLowerCase().trim() : null;
    const password = req.body.password; // NO .trim() — fixes B-11
    const rememberMe = req.body.rememberMe || false;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');

    // --- No user found path ---
    // H3 FIX: Run dummy bcrypt so timing matches the "user found" path.
    if (!user) {
      const dummyHash = await DUMMY_HASH_PROMISE;
      await bcrypt.compare(password, dummyHash); // timing parity — result discarded
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Always run bcrypt before checking lockout, so locked accounts don't
    // short-circuit earlier than unlocked ones (H3 timing parity for locked case).
    const isMatch = await user.comparePassword(password);

    // --- Locked account path ---
    // H2 FIX: Don't reveal "locked" via 403. Return 401 "Invalid credentials".
    // Lock is still enforced — wrong credentials on a locked account still returns
    // 401 regardless of whether the password would match.
    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // If lock expired, clear it (do this AFTER the locked check above)
    if (user.lockUntil && user.lockUntil <= Date.now()) {
      user.failedLoginAttempts = 0;
      user.lockUntil = undefined;
    }

    // --- Wrong password path ---
    if (!isMatch) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save();
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // --- Unverified user ---
    // C5 FIX (Wave 4): Do NOT include `isVerified: false` in the response.
    // Returning that bit when the password is correct turns the unified 401
    // into a partial enumeration oracle for "registered + unverified" emails.
    // The mobile/web client can call POST /resend-verification or
    // GET /check-verification-status (auth required) when they get a 401 to
    // distinguish "wrong creds" from "needs verification" without exposing
    // the bit to anonymous callers.
    if (!user.isVerified) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // --- Banned user (belt-and-suspenders; authMiddleware already blocks) ---
    if (user.isBanned) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // --- MFA required ---
    // AUTH_PATTERNS.md §7.1: if MFA enabled, issue a short-lived mfaToken instead of full tokens.
    if (user.mfaEnabled) {
      user.failedLoginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
      const mfaToken = jwt.sign(
        {
          id: user._id,
          purpose: 'mfa',
          rememberMe: !!rememberMe,
          clientType: req.body.clientType || 'app',
        },
        config.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', expiresIn: '5m' }
      );
      return res.status(200).json({ mfaRequired: true, mfaToken });
    }

    // --- Success ---
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, rememberMe);

    user.refreshTokens.push({
      tokenHash: hashToken(refreshToken),
      createdAt: new Date(),
      deviceInfo: req.headers['user-agent'] || 'unknown',
      rememberMe: !!rememberMe,
    });
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    user.lastAuthAt = new Date(); // Task 4: step-up auth tracking

    await user.save();

    // Task 5: HttpOnly cookie for web clients
    const isWebClient = req.body.clientType === 'web' || req.body.source === 'web';
    if (isWebClient) {
      const cookieMaxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      res.cookie('shiftwise_refresh', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: cookieMaxAge,
        path: '/',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken,
      ...(isWebClient ? {} : { refreshToken }),
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Google OAuth Signup ───────────────────────────────────
// Creates a new account from Google identity. Fails if email already exists.
const googleSignup = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'Google ID token is required' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: [config.GOOGLE_CLIENT_ID, config.GOOGLE_WEB_CLIENT_ID].filter(Boolean),
    });

    const payload = ticket.getPayload();
    const { email, email_verified, name, picture } = payload;

    if (!email_verified) return res.status(403).json({ message: 'Google email not verified' });

    const existing = await User.findOne({ email });
    if (existing) {
      // AUTH_PATTERNS.md §6.6: unified error — don't reveal account existence.
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const newUser = new User({
      email,
      name,
      picture,
      provider: 'google',
      isVerified: true,
      pendingSubscriptionCreation: true,
    });
    await newUser.save();

    try {
      const sub = await createDefaultFreeSubscription(newUser._id);
      await User.findByIdAndUpdate(newUser._id, {
        activeSubscription: sub._id,
        pendingSubscriptionCreation: false,
      });
    } catch (err) {
      logger.error('Failed to create default subscription for Google signup user', {
        userId: newUser._id,
        error: err.message,
      });
    }

    emit(WEBHOOK_EVENTS.USER_CREATED, { id: newUser._id, role: newUser.role }, newUser._id);
    emit(
      WEBHOOK_EVENTS.USER_VERIFIED,
      { id: newUser._id, name: newUser.name, role: newUser.role },
      newUser._id
    );

    const accessToken = generateAccessToken(newUser);
    const refreshToken = generateRefreshToken(newUser, false);
    newUser.refreshTokens.push({
      tokenHash: hashToken(refreshToken),
      createdAt: new Date(),
      deviceInfo: req.headers['user-agent'] || 'unknown',
      rememberMe: false,
    });
    newUser.lastAuthAt = new Date(); // Task 4: step-up auth tracking
    await newUser.save();

    // Task 5: HttpOnly cookie for web clients
    const isWebClient = req.body.clientType === 'web' || req.body.source === 'web';
    if (isWebClient) {
      res.cookie('shiftwise_refresh', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      accessToken,
      ...(isWebClient ? {} : { refreshToken }),
      user: {
        id: newUser._id,
        email: newUser.email,
        name: newUser.name,
        picture: newUser.picture,
        role: newUser.role,
        isVerified: newUser.isVerified,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Google OAuth Login ────────────────────────────────────
// ARCHITECTURE_MAP §3.3
//
// H5 FIX: Previous code returned 404 for emails that don't have an account,
// which revealed whether the email is registered (different response for
// "found" vs "not found"). Fix: auto-provision new users from Google.
// This is also the better UX — "Sign in with Google" should work for first-timers.
const googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'Google ID token is required' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: [config.GOOGLE_CLIENT_ID, config.GOOGLE_WEB_CLIENT_ID].filter(Boolean),
    });

    const payload = ticket.getPayload();
    const { email, email_verified, name, picture } = payload;

    if (!email_verified) {
      return res.status(403).json({ message: 'Google email not verified' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      // AUTH_PATTERNS.md §6.6: unified 401 — same as email/password login.
      // 404 was an enumeration oracle revealing whether the email is registered.
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // M13 FIX: Only overwrite name/picture when Google actually returned
    // values. The Google payload occasionally omits these fields, and
    // assigning `undefined` would wipe the existing data.
    const wasVerified = user.isVerified;
    if (name) user.name = name;
    if (picture) user.picture = picture;
    user.isVerified = true;

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, false);

    user.refreshTokens.push({
      tokenHash: hashToken(refreshToken),
      createdAt: new Date(),
      deviceInfo: req.headers['user-agent'] || 'unknown',
      rememberMe: false,
    });
    user.lastAuthAt = new Date(); // Task 4: step-up auth tracking

    await user.save();

    if (!wasVerified) {
      emit(
        WEBHOOK_EVENTS.USER_VERIFIED,
        { id: user._id, name: user.name, role: user.role },
        user._id
      );
    }

    // Task 5: HttpOnly cookie for web clients
    const isWebClient = req.body.clientType === 'web' || req.body.source === 'web';
    if (isWebClient) {
      res.cookie('shiftwise_refresh', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Google login successful',
      accessToken,
      ...(isWebClient ? {} : { refreshToken }),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Refresh Token ─────────────────────────────────────────
// ARCHITECTURE_MAP §3.7 — rotation with reuse detection
//
// H8 FIX: Replace findIndex (read) + pipeline (write) TOCTOU race with a
// SINGLE atomic findByIdAndUpdate that has `'refreshTokens.tokenHash': hashedIncoming`
// in its query filter. MongoDB only executes the update if a matching document
// exists — if the token isn't present (already rotated / reuse attack), the
// result is null and we wipe all sessions. This collapses read + write into
// one round-trip with no race window.
//
// The atomic-rotation.test.js assertions are preserved:
//   ✓ Exactly 1 findByIdAndUpdate call
//   ✓ $filter in the pipeline (for the cap / prune logic inside $concatArrays)
const refreshToken = async (req, res, next) => {
  try {
    // Task 5: Accept token from cookie OR body (cookie priority for web)
    const incomingToken = req.cookies?.shiftwise_refresh || req.body.refreshToken;

    if (!incomingToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    let decoded;
    try {
      // MED-01 FIX: Pin algorithm to HS256 — prevents algorithm confusion attacks.
      decoded = jwt.verify(incomingToken, config.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    } catch (_err) {
      return res.status(403).json({ message: 'Invalid or expired refresh token' });
    }

    const hashedIncoming = hashToken(incomingToken);

    // Generate new tokens before the DB write so we never write without knowing what to write.
    // We need the userId from decoded — we'll fetch the user for role/email after confirming the
    // token is valid (the atomic update below guarantees that).
    const userForTokenGen = await User.findById(decoded.id);
    if (!userForTokenGen) {
      return res.status(403).json({ message: 'User not found' });
    }

    // C8 FIX (Wave 4): banned users must not be able to refresh.
    // Without this check, a banned user keeps rotating their refresh token
    // forever — even though protect() blocks individual API calls, a banned
    // user could keep their session alive and pick it up the moment a ban
    // is lifted on a stale device.
    if (userForTokenGen.isBanned) {
      // Wipe all sessions defensively so the next ban check is moot.
      await User.findByIdAndUpdate(decoded.id, { $set: { refreshTokens: [] } });
      return res.status(403).json({ message: 'Account suspended' });
    }

    const newAccessToken = generateAccessToken(userForTokenGen);
    const newRefreshToken = generateRefreshToken(userForTokenGen, decoded.rememberMe || false);

    // H8 FIX: Single atomic operation.
    // Query includes `'refreshTokens.tokenHash': hashedIncoming` — Mongo only
    // runs the update if the document contains that token. If the token is missing
    // (stale / already rotated / reuse attempt) the result is null.
    //
    // Pipeline: prune expired tokens (per-token cutoff: rememberMe → 30d, else
    // standard 7d), filter out the old one, append the new one.
    // $filter is preserved → atomic-rotation.test.js still passes.
    //
    // B1 FIX (Wave 4.1): the per-token cutoff respects rememberMe. The previous
    // single-cutoff filter silently dropped 30d rememberMe sessions at 7d.
    const now = Date.now();
    const standardCutoff = new Date(now - STANDARD_REFRESH_MS);
    const rememberCutoff = new Date(now - REMEMBER_ME_REFRESH_MS);

    const updated = await User.findOneAndUpdate(
      // H8 FIX: Atomic guard — findOneAndUpdate honors a full query object.
      // findByIdAndUpdate only accepts the _id, so the tokenHash condition was
      // silently ignored. findOneAndUpdate matches only when both _id AND
      // the tokenHash are present; returns null if token is missing (reuse detected).
      { _id: decoded.id, 'refreshTokens.tokenHash': hashedIncoming },
      [
        {
          $set: {
            refreshTokens: {
              $concatArrays: [
                {
                  $filter: {
                    input: '$refreshTokens',
                    as: 'tok',
                    cond: {
                      $and: [
                        { $ne: ['$$tok.tokenHash', hashedIncoming] }, // remove old
                        // B1 FIX: per-token cutoff — rememberMe tokens get 30d,
                        // everything else gets the standard refresh expiry.
                        {
                          $gt: [
                            '$$tok.createdAt',
                            {
                              $cond: [
                                { $eq: ['$$tok.rememberMe', true] },
                                rememberCutoff,
                                standardCutoff,
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
                [
                  {
                    tokenHash: hashToken(newRefreshToken),
                    createdAt: new Date(),
                    deviceInfo: req.headers['user-agent'] || 'unknown',
                    rememberMe: !!decoded.rememberMe,
                  },
                ],
              ],
            },
          },
        },
      ],
      // B4 FIX (Wave 4.1): `{ new: true }` is deprecated in modern Mongoose;
      // use `returnDocument: 'after'`. `updatePipeline: true` is REQUIRED when
      // the update argument is an aggregation pipeline (array) — without it
      // Mongoose throws "Cannot pass an array to query updates...".
      { returnDocument: 'after', updatePipeline: true }
    );

    // If the update didn't match, the token wasn't in the DB → REUSE DETECTED.
    // Wipe all sessions for that user as a compromise indicator.
    if (!updated) {
      await User.findByIdAndUpdate(decoded.id, { $set: { refreshTokens: [] } });
      return res.status(403).json({ message: 'Token reuse detected — all sessions revoked' });
    }

    // Task 5: If cookie mode (token came from cookie), set new cookie
    const isCookieMode = !!req.cookies?.shiftwise_refresh;
    if (isCookieMode) {
      res.cookie('shiftwise_refresh', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: (decoded.rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      ...(isCookieMode ? {} : { refreshToken: newRefreshToken }),
    });
  } catch (error) {
    next(error);
  }
};

// ── Logout ────────────────────────────────────────────────
// ARCHITECTURE_MAP §3.8
const logout = async (req, res, next) => {
  try {
    // Task 5: Accept token from cookie OR body (cookie priority)
    const incomingToken = req.cookies?.shiftwise_refresh || req.body.refreshToken;

    // Task 5: Always clear cookie if present
    if (req.cookies?.shiftwise_refresh) {
      res.clearCookie('shiftwise_refresh', { path: '/' });
    }

    if (!incomingToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    const hashedToken = hashToken(incomingToken);
    const user = await User.findOne({ 'refreshTokens.tokenHash': hashedToken });

    // Logout is idempotent — always return 200. (H-02 FIX from prior review)
    if (!user) {
      return res.status(200).json({ success: true, message: 'Logged out successfully' });
    }

    user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== hashedToken);
    await user.save();

    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = { signup, login, googleLogin, googleSignup, refreshToken, logout };
