// controllers/businessController.js
// Business CRUD for the onboarding wizard + settings screen.
// §9 Phase 1 — Onboarding + Settings · §7 API Contracts (Business)
//
// A Business is the top-level tenant. The signed-in user becomes its owner.
// One business per owner in v1 (multi-business = v2).

'use strict';

const Business = require('../models/Business');
const logger   = require('../config/logger');

/**
 * @route   POST /api/v1/business
 * @desc    Create the caller's business (onboarding step 1). One per owner.
 * @access  Private (any authenticated user without an existing business)
 */
exports.createBusiness = async (req, res, next) => {
  try {
    // Guard: a user can only own ONE business in v1.
    const existing = await Business.findOne({ ownerId: req.user.id });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'You already own a business.',
        request_id: req.id,
      });
    }

    const { name, timezone, currency, weekStartsOn } = req.body;

    const business = await Business.create({
      name,
      ownerId: req.user.id,
      settings: {
        timezone: timezone || 'UTC',
        currency: currency || 'USD',
        weekStartsOn: weekStartsOn ?? 0,
      },
    });

    logger.info(`Business created: ${business._id} by user ${req.user.id}`);

    res.status(201).json({ success: true, data: business });
  } catch (err) {
    logger.error('Error in createBusiness:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/business
 * @desc    Get the caller's business (resolved by resolveBusiness middleware).
 * @access  Private (owner or staff)
 */
exports.getBusiness = async (req, res, next) => {
  try {
    // req.business + req.membership are attached by resolveBusiness middleware.
    // membership lets the frontend pick the right nav shell (owner vs staff).
    res.status(200).json({ success: true, data: req.business, membership: req.membership });
  } catch (err) {
    logger.error('Error in getBusiness:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/business
 * @desc    Update business name / settings. Owner only.
 * @access  Private (owner)
 */
exports.updateBusiness = async (req, res, next) => {
  try {
    const { name, settings, onboarding } = req.body;
    const business = req.business; // tenant-scoped from middleware

    // Only mutate explicitly provided fields (partial update)
    if (name !== undefined) business.name = name;
    if (settings) {
      if (settings.timezone !== undefined)     business.settings.timezone = settings.timezone;
      if (settings.currency !== undefined)     business.settings.currency = settings.currency;
      if (settings.weekStartsOn !== undefined) business.settings.weekStartsOn = settings.weekStartsOn;
    }
    // Allow the wizard / checklist to flip onboarding flags
    if (onboarding) {
      if (onboarding.completed !== undefined) business.onboarding.completed = onboarding.completed;
      if (onboarding.checklist) {
        Object.assign(business.onboarding.checklist, onboarding.checklist);
      }
    }

    await business.save();

    res.status(200).json({ success: true, data: business });
  } catch (err) {
    logger.error('Error in updateBusiness:', err);
    next(err);
  }
};
