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
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail({ gmail_remove_dots: false }),
  body('hourlyRate').optional().isFloat({ min: 0 }),
  body('maxHoursPerWeek').optional().isInt({ min: 0, max: 168 }),
]);

// All staff routes require auth + resolved business + owner role
router.use(protect(), resolveBusiness, requireOwner);

router.get('/', staffController.listStaff);
router.post('/', createStaffSchema, staffController.createStaff);
router.post('/bulk', staffController.bulkCreateStaff);
router.put('/:id', staffController.updateStaff);
router.delete('/:id', staffController.deleteStaff);

// Invite + emergency notify are rate-limited (they send email)
router.post('/:id/invite', authLimiter, staffController.inviteStaff);
router.post('/:id/notify', authLimiter, staffController.notifyStaff);

module.exports = router;
