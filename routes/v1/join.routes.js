// routes/v1/join.routes.js
// Public invite-acceptance routes + authenticated profile completion.
// §9 Phase 2 — Team + Invites
// Mounted at /api/v1/join by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');

const joinController = require('../../controllers/joinController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const { validate } = require('../../middleware/validate');
const { authLimiter } = require('../../middleware/rateLimiter');

// ── GET /api/v1/join/validate?token=RAW — Public ──
router.get(
  '/validate',
  validate([query('token').trim().notEmpty().withMessage('Invite token is required.')]),
  joinController.validateInvite
);

// ── POST /api/v1/join/accept — Public (rate-limited) ──
router.post(
  '/accept',
  authLimiter,
  validate([
    body('token').trim().notEmpty().withMessage('Invite token is required.'),
    // Password only required when no existing account is linked; controller
    // enforces presence when creating a fresh user. Validate length if given.
    body('password').optional().isLength({ min: 12, max: 128 }).withMessage('Password must be 12–128 characters.'),
  ]),
  joinController.acceptInvite
);

// ── POST /api/v1/join/complete-profile — Private (staff) ──
router.post('/complete-profile', protect(), resolveBusiness, joinController.completeProfile);

module.exports = router;
