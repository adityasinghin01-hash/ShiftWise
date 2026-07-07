// controllers/locationController.js
// Location CRUD — branches under a Business, holding scheduling rules.
// §9 Phase 1 — Onboarding + Settings · §7 API Contracts (Locations)
//
// TENANCY: every query is scoped to req.business._id (set by resolveBusiness).
// Owner-only (enforced by requireOwner on the routes).

'use strict';

const Location = require('../models/Location');
const logger   = require('../config/logger');

/**
 * Validate location settings rule numbers beyond what express-validator covers.
 * Returns an error string if invalid, or null if OK.
 * @param {object} settings
 * @returns {string|null}
 */
function validateRules(settings) {
  if (!settings) return null;
  const { minStaffPerShift, maxStaffPerShift, maxHoursPerWeek, minRestHours, maxDaysConsecutive } = settings;

  // min must not exceed max
  if (
    minStaffPerShift !== undefined && maxStaffPerShift !== undefined &&
    minStaffPerShift > maxStaffPerShift
  ) {
    return 'minStaffPerShift cannot be greater than maxStaffPerShift';
  }
  // hours bounded 0–168 (a week)
  for (const [key, val] of Object.entries({ maxHoursPerWeek, minRestHours })) {
    if (val !== undefined && (val < 0 || val > 168)) {
      return `${key} must be between 0 and 168`;
    }
  }
  if (maxDaysConsecutive !== undefined && (maxDaysConsecutive < 0 || maxDaysConsecutive > 7)) {
    return 'maxDaysConsecutive must be between 0 and 7';
  }
  return null;
}

/**
 * @route   GET /api/v1/locations
 * @desc    List all locations for the caller's business.
 * @access  Private (owner)
 */
exports.listLocations = async (req, res, next) => {
  try {
    // TENANCY: scoped to the resolved business
    const locations = await Location.find({ businessId: req.business._id }).sort({ createdAt: 1 });
    res.status(200).json({ success: true, count: locations.length, data: locations });
  } catch (err) {
    logger.error('Error in listLocations:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/locations
 * @desc    Create a location under the caller's business.
 * @access  Private (owner)
 */
exports.createLocation = async (req, res, next) => {
  try {
    const { name, address, timezone, settings } = req.body;

    const ruleError = validateRules(settings);
    if (ruleError) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: ruleError, request_id: req.id });
    }

    const location = await Location.create({
      businessId: req.business._id, // TENANCY: never from client input
      name,
      address,
      timezone: timezone || null,
      settings: settings || {},
    });

    logger.info(`Location created: ${location._id} for business ${req.business._id}`);
    res.status(201).json({ success: true, data: location });
  } catch (err) {
    logger.error('Error in createLocation:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/locations/:id
 * @desc    Get one location (scoped to the business).
 * @access  Private (owner)
 */
exports.getLocation = async (req, res, next) => {
  try {
    // TENANCY: filter by BOTH id AND businessId so one business can't read another's
    const location = await Location.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found', request_id: req.id });
    }
    res.status(200).json({ success: true, data: location });
  } catch (err) {
    logger.error('Error in getLocation:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/locations/:id
 * @desc    Update a location's name / address / timezone / rules.
 * @access  Private (owner)
 */
exports.updateLocation = async (req, res, next) => {
  try {
    const { name, address, timezone, settings, isActive } = req.body;

    const ruleError = validateRules(settings);
    if (ruleError) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: ruleError, request_id: req.id });
    }

    // TENANCY: scoped find
    const location = await Location.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found', request_id: req.id });
    }

    if (name !== undefined)     location.name = name;
    if (address !== undefined)  location.address = address;
    if (timezone !== undefined) location.timezone = timezone;
    if (isActive !== undefined) location.isActive = isActive;
    if (settings) {
      // Merge provided rule fields onto existing settings
      Object.assign(location.settings, settings);
    }

    await location.save();
    res.status(200).json({ success: true, data: location });
  } catch (err) {
    logger.error('Error in updateLocation:', err);
    next(err);
  }
};

/**
 * @route   DELETE /api/v1/locations/:id
 * @desc    Soft-delete a location (isActive=false). Preserves historical schedules.
 * @access  Private (owner)
 */
exports.deleteLocation = async (req, res, next) => {
  try {
    // TENANCY: scoped find
    const location = await Location.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found', request_id: req.id });
    }

    location.isActive = false; // soft delete — keep history intact
    await location.save();

    res.status(200).json({ success: true, data: { id: location._id, isActive: false } });
  } catch (err) {
    logger.error('Error in deleteLocation:', err);
    next(err);
  }
};
