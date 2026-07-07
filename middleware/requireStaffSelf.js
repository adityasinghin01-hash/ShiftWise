// middleware/requireStaffSelf.js
// Ensures a staff member can only access/modify their own data.
// Compares req.params.staffId (or req.params.id) against req.staffMember._id.
// Owners bypass this check (they can access any staff record in their business).
// §9 Phase 0 — Foundation (§4.5 Auth/RBAC)

'use strict';

const logger = require('../config/logger');

/**
 * requireStaffSelf — middleware factory.
 * @param {string} [paramName='staffId'] - The URL param holding the target staffId.
 *
 * Usage: router.get('/my/shifts', protect(), resolveBusiness, requireStaffSelf(), handler)
 */
const requireStaffSelf = (paramName = 'staffId') => (req, res, next) => {
  // Owners can always access any staff record in their business — skip check
  if (req.membership === 'owner') return next();

  const targetId = req.params[paramName] || req.params.id;

  // No specific target param: allow (it's a "my own data" route)
  if (!targetId) return next();

  // Staff can only access their own record
  if (!req.staffMember || req.staffMember._id.toString() !== targetId) {
    logger.warn(
      `Staff ${req.staffMember?._id} attempted to access another member's data: ${targetId}`
    );
    return res.status(403).json({
      success: false,
      message: 'Forbidden: You can only access your own data',
      request_id: req.id,
    });
  }

  next();
};

module.exports = requireStaffSelf;
