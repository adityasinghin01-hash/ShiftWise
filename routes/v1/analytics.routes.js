// routes/v1/analytics.routes.js
// Analytics + badges (§9 Phase 8 — S7). Owner-only, business-scoped.
// Mounted at /api/v1/analytics by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();

const analyticsController = require('../../controllers/analyticsController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');

router.use(protect(), resolveBusiness, requireOwner);

router.get('/', analyticsController.getAnalytics);
router.post('/badges', analyticsController.awardBadge);

module.exports = router;
