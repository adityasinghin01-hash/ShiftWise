// routes/v1/locations.routes.js
// Location routes — CRUD, owner-only, business-scoped.
// §9 Phase 1 — Onboarding + Settings
// Mounted at /api/v1/locations by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const locationController = require('../../controllers/locationController');
const availabilityController = require('../../controllers/availabilityController');
const templateController = require('../../controllers/templateController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');
const { validate } = require('../../middleware/validate');

// ── Validation schema (shape only; numeric rule cross-checks live in controller) ──
const locationBodySchema = validate([
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Location name is required.')
    .isLength({ max: 100 })
    .withMessage('Location name is too long.'),
  body('address').optional().isString().isLength({ max: 255 }),
  body('timezone').optional({ nullable: true }).isString().isLength({ max: 64 }),
  body('settings').optional().isObject(),
  body('settings.minStaffPerShift').optional().isInt({ min: 0 }),
  body('settings.maxStaffPerShift').optional().isInt({ min: 0 }),
  body('settings.maxHoursPerWeek').optional().isInt({ min: 0, max: 168 }),
]);

// Update variant: same constraints, but name is optional (partial updates allowed).
// Applied to PUT so updates can't slip invalid scheduling rules past the checks
// that create enforces (the scheduling engine later reads these values).
const locationUpdateSchema = validate([
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('address').optional().isString().isLength({ max: 255 }),
  body('timezone').optional({ nullable: true }).isString().isLength({ max: 64 }),
  body('settings').optional().isObject(),
  body('settings.minStaffPerShift').optional().isInt({ min: 0 }),
  body('settings.maxStaffPerShift').optional().isInt({ min: 0 }),
  body('settings.maxHoursPerWeek').optional().isInt({ min: 0, max: 168 }),
]);

// All location routes require auth + a resolved business + owner role
router.use(protect(), resolveBusiness, requireOwner);

// ── GET /api/v1/locations — list ──
router.get('/', locationController.listLocations);

// ── POST /api/v1/locations — create ──
router.post('/', locationBodySchema, locationController.createLocation);

// ── GET /api/v1/locations/:id — get one ──
router.get('/:id', locationController.getLocation);

// ── GET /api/v1/locations/:id/availability — staff availability overview (owner) ──
router.get('/:id/availability', availabilityController.getLocationAvailability);

// ── GET /api/v1/locations/:id/templates — saved schedule templates (owner) ──
router.get('/:id/templates', templateController.listTemplates);

// ── PUT /api/v1/locations/:id — update ──
router.put('/:id', locationUpdateSchema, locationController.updateLocation);

// ── DELETE /api/v1/locations/:id — soft delete ──
router.delete('/:id', locationController.deleteLocation);

module.exports = router;
