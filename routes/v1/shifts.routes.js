// routes/v1/shifts.routes.js
// Individual shift edits (update/delete/attendance). Owner-only, scoped.
// §9 Phase 4 · Mounted at /api/v1/shifts by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();

const shiftController = require('../../controllers/shiftController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');

router.use(protect(), resolveBusiness, requireOwner);

router.put('/:id', shiftController.updateShift);
router.delete('/:id', shiftController.deleteShift);
router.post('/:id/attendance', shiftController.markAttendance);

// Absence → cover (§6.7)
router.post('/:id/absent', shiftController.markAbsent);
router.post('/:id/cover/assign', shiftController.assignCover);

module.exports = router;
