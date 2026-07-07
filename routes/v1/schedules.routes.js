// routes/v1/schedules.routes.js
// Schedule routes — create draft, fetch, generate preview. Owner-only, scoped.
// §9 Phase 4 · Mounted at /api/v1/schedules by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const scheduleController = require('../../controllers/scheduleController');
const shiftController = require('../../controllers/shiftController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');
const { validate } = require('../../middleware/validate');

const createSchema = validate([
  body('locationId').isMongoId().withMessage('A valid locationId is required.'),
  body('periodStart').optional().isISO8601().withMessage('periodStart must be an ISO date.'),
]);

// All schedule routes require auth + resolved business + owner role.
router.use(protect(), resolveBusiness, requireOwner);

const shiftSchema = validate([
  body('staffId').isMongoId().withMessage('A valid staffId is required.'),
  body('date').isISO8601().withMessage('date must be an ISO date.'),
  body('startTime')
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('startTime must be HH:MM.'),
  body('endTime')
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('endTime must be HH:MM.'),
  // Required downstream: peer-shift / INCOMPATIBLE_PAIR matching keys on shiftType.
  body('shiftType').trim().notEmpty().withMessage('shiftType is required.').isLength({ max: 50 }),
]);

router.post('/', createSchema, scheduleController.createSchedule);
router.get('/:id', scheduleController.getSchedule);
router.post('/:id/generate', scheduleController.generateSchedule);
router.post('/:id/apply', scheduleController.applySchedule);
router.post('/:id/publish', scheduleController.publishSchedule);
router.post('/:id/copy', scheduleController.copySchedule);
router.post('/:id/shifts', shiftSchema, shiftController.createShift);

module.exports = router;
