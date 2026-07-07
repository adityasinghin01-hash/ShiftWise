// middleware/resolveBusiness.js
// Resolves the caller's business context after protect() has set req.user.
//
// Attaches to req:
//   req.business    — the Business document
//   req.membership  — 'owner' | 'staff'
//   req.staffMember — StaffMember document (only if membership === 'staff')
//
// §9 Phase 0 — Foundation (§4.1 Multi-tenancy)
// MUST run after protect(). All ShiftWise routes use this middleware.
// Returns 403 if the user has no business context (e.g. a platform admin
// hitting a ShiftWise route that requires a business).

'use strict';

const Business    = require('../models/Business');
const StaffMember = require('../models/StaffMember');
const logger      = require('../config/logger');

/**
 * resolveBusiness — middleware that determines whether the authenticated user
 * is a business owner or a staff member, and attaches the resolved context.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const resolveBusiness = async (req, res, next) => {
  try {
    // ── 1. Check if user is an owner ────────────────────────────
    const ownedBusiness = await Business.findOne({ ownerId: req.user.id });

    if (ownedBusiness) {
      req.business   = ownedBusiness;
      req.membership = 'owner';
      req.staffMember = null;
      return next();
    }

    // ── 2. Check if user is an active staff member ──────────────
    const staffMember = await StaffMember.findOne({
      userId: req.user.id,
      isActive: true,
    });

    if (staffMember) {
      // Fetch the business the staff belongs to
      const business = await Business.findById(staffMember.businessId);

      if (!business) {
        // Staff record exists but business was deleted — deny access
        logger.warn(`Staff ${req.user.id} belongs to missing business ${staffMember.businessId}`);
        return res.status(403).json({
          success: false,
          message: 'Business not found',
          request_id: req.id,
        });
      }

      req.business    = business;
      req.membership  = 'staff';
      req.staffMember = staffMember;
      return next();
    }

    // ── 3. No business context ───────────────────────────────────
    // This can happen for platform admins or users who haven't completed onboarding.
    logger.warn(`User ${req.user.id} has no business context on ${req.originalUrl}`);
    return res.status(403).json({
      success: false,
      message: 'No business context found. Please complete onboarding.',
      request_id: req.id,
    });

  } catch (err) {
    logger.error('resolveBusiness middleware error:', err);
    next(err);
  }
};

module.exports = resolveBusiness;
