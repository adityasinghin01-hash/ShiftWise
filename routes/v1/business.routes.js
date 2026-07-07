// routes/v1/business.routes.js
// Business routes — create (onboarding), get, update.
// §9 Phase 1 — Onboarding + Settings
// Mounted at /api/v1/business by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const businessController = require('../../controllers/businessController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');
const { validate } = require('../../middleware/validate');

// ── Validation schema ─────────────────────────────────────
const createBusinessSchema = validate([
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Business name is required.')
    .isLength({ max: 100 })
    .withMessage('Business name is too long.'),
  body('timezone').optional().isString().isLength({ max: 64 }),
  body('currency').optional().isString().isLength({ max: 8 }),
  body('weekStartsOn')
    .optional()
    .isInt({ min: 0, max: 1 })
    .withMessage('weekStartsOn must be 0 (Mon) or 1 (Sun).'),
]);

// ── POST /api/v1/business — create (no resolveBusiness: user has none yet) ──
router.post('/', protect(), createBusinessSchema, businessController.createBusiness);

// ── GET /api/v1/business — owner or staff ──
router.get('/', protect(), resolveBusiness, businessController.getBusiness);

// ── PUT /api/v1/business — owner only ──
router.put('/', protect(), resolveBusiness, requireOwner, businessController.updateBusiness);

module.exports = router;
