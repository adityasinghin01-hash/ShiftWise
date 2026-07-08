// routes/v1/index.js
// Central v1 API router — mounts all versioned route modules.
// Mounted at /api/v1 in app.js.
// Health check stays unversioned at /api/health (for Render probe).

const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const verificationRoutes = require('./verification.routes');
const passwordRoutes = require('./password.routes');
const userRoutes = require('./user.routes');
const adminRoutes = require('./admin.routes');
const subscriptionRoutes = require('./subscription.routes');
const apiKeyRoutes = require('./apikeys.routes');
const webhookRoutes = require('./webhooks.routes');
const mfaRoutes = require('./mfa.routes');

// ── ShiftWise domain routes (Phase 1+) ───────────────────
const businessRoutes = require('./business.routes');
const locationRoutes = require('./locations.routes');
const staffRoutes = require('./staff.routes');
const joinRoutes = require('./join.routes');
const availabilityRoutes = require('./availability.routes');
const scheduleRoutes = require('./schedules.routes');
const shiftRoutes = require('./shifts.routes');
const templateRoutes = require('./templates.routes');
const timeoffRoutes = require('./timeoff.routes');
const swapRoutes = require('./swaps.routes');
const staffPortalRoutes = require('./staffPortal.routes');

// ── Auth ─────────────────────────────────────────────────
router.use('/', authRoutes);

// ── Verification ─────────────────────────────────────────
router.use('/', verificationRoutes);

// ── Password ─────────────────────────────────────────────
router.use('/password', passwordRoutes);

// ── User (protected) ────────────────────────────────────
router.use('/', userRoutes);

// ── Admin ────────────────────────────────────────────────
router.use('/admin', adminRoutes);

// ── Subscriptions ────────────────────────────────────────
router.use('/subscriptions', subscriptionRoutes);

// ── API Keys ─────────────────────────────────────────────
router.use('/apikeys', apiKeyRoutes);

// ── Webhooks ─────────────────────────────────────────────
router.use('/webhooks', webhookRoutes);

// ── MFA ──────────────────────────────────────────────────
router.use('/mfa', mfaRoutes);

// ── ShiftWise: Business ──────────────────────────────────
router.use('/business', businessRoutes);

// ── ShiftWise: Locations ─────────────────────────────────
router.use('/locations', locationRoutes);

// ── ShiftWise: Staff ─────────────────────────────────────
router.use('/staff', staffRoutes);

// ── ShiftWise: Join (invite acceptance) ──────────────────
router.use('/join', joinRoutes);

// ── ShiftWise: Availability ──────────────────────────────
router.use('/', availabilityRoutes);

// ── ShiftWise: Schedules (Phase 4) ───────────────────────
router.use('/schedules', scheduleRoutes);

// ── ShiftWise: Shifts (Phase 4) ──────────────────────────
router.use('/shifts', shiftRoutes);

// ── ShiftWise: Templates (Phase 4) ───────────────────────
router.use('/templates', templateRoutes);

// ── ShiftWise: Time-off + Swaps (Phase 5) ────────────────
router.use('/', timeoffRoutes);
router.use('/swaps', swapRoutes);

// ── ShiftWise: Staff Portal (Phase 6) ────────────────────
router.use('/', staffPortalRoutes);

module.exports = router;
