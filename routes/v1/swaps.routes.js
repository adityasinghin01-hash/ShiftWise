// routes/v1/swaps.routes.js
// Shift swaps: staff submit/claim/view; owner reviews. §9 Phase 5.
// Mounted at /api/v1/swaps by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const swapController = require('../../controllers/swapController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');
const { validate } = require('../../middleware/validate');

const authed = [protect(), resolveBusiness];

const submitSchema = validate([
  body('shiftId').isMongoId().withMessage('A valid shiftId is required.'),
  body('mode').isIn(['targeted', 'open']).withMessage('mode must be targeted or open.'),
  body('targetStaffId').optional().isMongoId(),
]);

router.post('/', authed, submitSchema, swapController.submitSwap);
router.post('/:id/claim', authed, swapController.claimSwap);
router.put('/:id/review', [...authed, requireOwner], swapController.reviewSwap);

module.exports = router;
