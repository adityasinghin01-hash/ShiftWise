// routes/v1/timeoff.routes.js
// Time-off: staff submit + view own; owner reviews. §9 Phase 5.
// Mounted at /api/v1 by the v1 router (paths carry their own prefix).

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const timeoffController = require('../../controllers/timeoffController');
const swapController = require('../../controllers/swapController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');
const { validate } = require('../../middleware/validate');

const authed = [protect(), resolveBusiness];

const submitSchema = validate([
  body('startDate').isISO8601().withMessage('startDate must be a date.'),
  body('endDate').isISO8601().withMessage('endDate must be a date.'),
  body('reason').optional().isString().isLength({ max: 500 }),
]);

router.post('/timeoff', authed, submitSchema, timeoffController.submitTimeOff);
router.get('/my/timeoff', authed, timeoffController.myTimeOff);
router.put('/timeoff/:id/review', [...authed, requireOwner], timeoffController.reviewTimeOff);

// Staff's own swaps live here too (both "my requests" views in one place).
router.get('/my/swaps', authed, swapController.mySwaps);

module.exports = router;
