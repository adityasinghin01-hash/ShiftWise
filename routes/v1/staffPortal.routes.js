// routes/v1/staffPortal.routes.js
// Staff Portal (§9 Phase 6 — S8 My Shifts). Staff-only, self-scoped.
// Mounted at /api/v1 by the v1 router.
//
// /my/shifts                  → my published shifts (+ same-shift coworkers)
// /my/shifts/:id/acknowledge  → confirm my shift
// /my/shifts/:id/dispute      → dispute my shift → manager notification
// /my/metrics                 → my reliability score + activity counters

'use strict';

const express = require('express');
const router = express.Router();
const { param } = require('express-validator');

const staffPortalController = require('../../controllers/staffPortalController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const { validate } = require('../../middleware/validate');

// Per-route (not router.use) so unmatched paths fall through to the 404 handler.
const authed = [protect(), resolveBusiness];
const idParam = validate([param('id').isMongoId().withMessage('Invalid shift id.')]);

router.get('/my/shifts', authed, staffPortalController.getMyShifts);
router.post('/my/shifts/:id/acknowledge', authed, idParam, staffPortalController.acknowledgeShift);
router.post('/my/shifts/:id/dispute', authed, idParam, staffPortalController.disputeShift);
router.get('/my/metrics', authed, staffPortalController.getMyMetrics);

module.exports = router;
