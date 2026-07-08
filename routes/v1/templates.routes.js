// routes/v1/templates.routes.js
// Delete a saved schedule template. Owner-only, scoped.
// §9 Phase 4 · Mounted at /api/v1/templates by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();
const { param } = require('express-validator');

const templateController = require('../../controllers/templateController');
const { protect } = require('../../middleware/authMiddleware');
const resolveBusiness = require('../../middleware/resolveBusiness');
const requireOwner = require('../../middleware/requireOwner');
const { validate } = require('../../middleware/validate');

router.use(protect(), resolveBusiness, requireOwner);

// Validate the id so a malformed value returns 422, not a Mongo CastError 500.
const idParam = validate([param('id').isMongoId().withMessage('Invalid template id.')]);

router.delete('/:id', idParam, templateController.deleteTemplate);

module.exports = router;
