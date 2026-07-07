// middleware/requireOwner.js
// Thin guard: blocks non-owners from owner-only routes.
// MUST run after resolveBusiness(). Returns 403 for staff.
// §9 Phase 0 — Foundation (§4.5 Auth/RBAC)

'use strict';

const logger = require('../config/logger');

/**
 * requireOwner — middleware that restricts a route to business owners only.
 * Usage: router.get('/staff', protect(), resolveBusiness, requireOwner, handler)
 */
const requireOwner = (req, res, next) => {
  if (req.membership !== 'owner') {
    logger.warn(`Non-owner (${req.membership}) attempted owner-only route: ${req.originalUrl}`);
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Owner access required',
      request_id: req.id,
    });
  }
  next();
};

module.exports = requireOwner;
