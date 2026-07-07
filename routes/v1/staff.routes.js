// routes/v1/staff.routes.js
// Staff routes — CRUD, bulk import, invite, emergency-notify.
// All owner-only + business-scoped. §9 Phase 2 — Team + Invites
// Mounted at /api/v1/staff by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const staffController = require('../../controllers/staffController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');
const { validate } = require('../../middleware/validate');
const { authLimiter } = require('../../middleware/rateLimiter');

const createStaffSchema = validate([
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 100 }),
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email is required.')
    .normalizeEmail({ gmail_remove_dots: false }),
  body('hourlyRate').optional().isFloat({ min: 0 }),
  body('maxHoursPerWeek').optional().isInt({ min: 0, max: 168 }),
]);

// Bulk import: validate the request shape here; per-row name/email validation
// happens in the controller so one bad row yields a per-row error instead of
// rejecting the whole batch (partial-success import).
const bulkStaffSchema = validate([
  body('rows').isArray({ min: 1 }).withMessage('rows must be a non-empty array.'),
  body('rows').isArray({ max: 200 }).withMessage('Cannot import more than 200 staff at once.'),
  body('sendInvite').optional().isBoolean(),
]);

// All staff routes require auth + resolved business + owner role
router.use(protect(), resolveBusiness, requireOwner);

router.get('/', staffController.listStaff);
router.post('/', createStaffSchema, staffController.createStaff);
router.post('/bulk', bulkStaffSchema, staffController.bulkCreateStaff);
router.put('/:id', staffController.updateStaff);
router.delete('/:id', staffController.deleteStaff);

// Invite + emergency notify are rate-limited (they send email)
router.post('/:id/invite', authLimiter, staffController.inviteStaff);
router.post('/:id/notify', authLimiter, staffController.notifyStaff);

module.exports = router;
