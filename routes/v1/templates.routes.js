// routes/v1/templates.routes.js
// Delete a saved schedule template. Owner-only, scoped.
// §9 Phase 4 · Mounted at /api/v1/templates by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();

const templateController = require('../../controllers/templateController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');

router.use(protect(), resolveBusiness, requireOwner);

router.delete('/:id', templateController.deleteTemplate);

module.exports = router;
