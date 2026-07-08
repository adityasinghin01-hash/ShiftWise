// routes/v1/dashboard.routes.js
// Manager Dashboard aggregation (§9 Phase 7 — S2). Owner-only, business-scoped.
// Mounted at /api/v1 by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();

const dashboardController = require('../../controllers/dashboardController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');

// NOTE: path is /manager/dashboard, not /dashboard — the inherited auth template
// already owns GET /dashboard (user session info). Keep the template untouched.
router.get(
  '/manager/dashboard',
  protect(),
  resolveBusiness,
  requireOwner,
  dashboardController.getDashboard
);

module.exports = router;
