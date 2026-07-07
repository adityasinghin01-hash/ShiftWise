// routes/v1/availability.routes.js
// Staff availability (recurring + override) + manager override-request flow.
// §9 Phase 3 — Availability. Mounted at /api/v1 by the v1 router.
//
// /my/* routes → staff (caller's own availability)
// /availability/:staffId/override-request → owner proposes
// /availability/override-request/:id → staff confirms/declines

'use strict';

const express = require('express');
const router = express.Router();

const availabilityController = require('../../controllers/availabilityController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');

// Shared middleware chains — applied PER-ROUTE (not via router.use) so that
// unmatched paths fall through to the global 404 handler instead of hitting
// protect() and returning 401.
const authed = [protect(), resolveBusiness];

// ── Staff: my availability ──
router.get('/my/availability', authed, availabilityController.getMyAvailability);
router.put('/my/availability', authed, availabilityController.updateMyAvailability);
router.put('/my/availability/override', authed, availabilityController.setMyOverride);

// ── Owner: propose an override for a staff member ──
router.post('/availability/:staffId/override-request', authed, requireOwner, availabilityController.requestOverride);

// ── Staff: confirm/decline a proposed override ──
router.put('/availability/override-request/:id', authed, availabilityController.reviewOverride);

module.exports = router;
