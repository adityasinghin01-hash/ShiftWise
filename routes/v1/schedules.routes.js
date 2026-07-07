// routes/v1/schedules.routes.js
// Schedule routes — create draft, fetch, generate preview. Owner-only, scoped.
// §9 Phase 4 · Mounted at /api/v1/schedules by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const scheduleController = require('../../controllers/scheduleController');
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

router.post('/', createSchema, scheduleController.createSchedule);
router.get('/:id', scheduleController.getSchedule);
router.post('/:id/generate', scheduleController.generateSchedule);

module.exports = router;
