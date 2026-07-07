// controllers/availabilityController.js
// Staff availability (recurring + per-week overrides) + manager override-request flow.
// §9 Phase 3 — Availability · §7 API Contracts (Availability)
//
// TENANCY: staff routes scope to req.staffMember; owner routes scope to req.business.

'use strict';

const Availability = require('../models/Availability');
const StaffMember  = require('../models/StaffMember');
const { startOfWeek, resolveAvailability } = require('../utils/weekUtils');
const logger = require('../config/logger');

/** Resolve the staff member's primary location, or null. */
function primaryLocation(staff) {
  return staff?.locationIds?.[0] || null;
}

/**
 * @route   GET /api/v1/my/availability
 * @desc    Staff: get my availability (recurring + overrides + pending).
 * @access  Private (staff)
 */
exports.getMyAvailability = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res.status(403).json({ success: false, message: 'Only staff have availability.', request_id: req.id });
    }
    const locationId = primaryLocation(req.staffMember);
    if (!locationId) {
      return res.status(400).json({ success: false, message: 'You are not assigned to a location yet.', request_id: req.id });
    }

    // Find or lazily create the availability doc for this staff+location
    let availability = await Availability.findOne({ staffId: req.staffMember._id, locationId });
    if (!availability) {
      availability = await Availability.create({ staffId: req.staffMember._id, locationId, recurring: { slots: [] } });
    }
    res.status(200).json({ success: true, data: availability });
  } catch (err) {
    logger.error('Error in getMyAvailability:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/my/availability
 * @desc    Staff: set the recurring weekly pattern.
 * @access  Private (staff)
 */
exports.updateMyAvailability = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res.status(403).json({ success: false, message: 'Only staff can set availability.', request_id: req.id });
    }
    const locationId = primaryLocation(req.staffMember);
    if (!locationId) {
      return res.status(400).json({ success: false, message: 'You are not assigned to a location yet.', request_id: req.id });
    }
    const { slots } = req.body.recurring || {};
    if (!Array.isArray(slots)) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: 'recurring.slots must be an array.', request_id: req.id });
    }

    const availability = await Availability.findOneAndUpdate(
      { staffId: req.staffMember._id, locationId },
      { $set: { 'recurring.slots': slots } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(200).json({ success: true, data: availability });
  } catch (err) {
    logger.error('Error in updateMyAvailability:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/my/availability/override
 * @desc    Staff: set a per-week override (replaces recurring for that week).
 * @access  Private (staff)
 */
exports.setMyOverride = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res.status(403).json({ success: false, message: 'Only staff can set availability.', request_id: req.id });
    }
    const locationId = primaryLocation(req.staffMember);
    const { weekOf, slots } = req.body;
    if (!weekOf || !Array.isArray(slots)) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: 'weekOf and slots are required.', request_id: req.id });
    }
    const normalizedWeek = startOfWeek(weekOf);

    const availability = await Availability.findOne({ staffId: req.staffMember._id, locationId });
    if (!availability) {
      return res.status(404).json({ success: false, message: 'Set your recurring availability first.', request_id: req.id });
    }

    // Upsert the override for this week (replace if it already exists)
    const idx = availability.overrides.findIndex(
      (o) => startOfWeek(o.weekOf).getTime() === normalizedWeek.getTime()
    );
    if (idx >= 0) availability.overrides[idx].slots = slots;
    else availability.overrides.push({ weekOf: normalizedWeek, slots });

    await availability.save();
    res.status(200).json({ success: true, data: availability });
  } catch (err) {
    logger.error('Error in setMyOverride:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/locations/:id/availability?weekOf=ISO
 * @desc    Owner: overview of all staff resolved availability for a week.
 * @access  Private (owner)
 */
exports.getLocationAvailability = async (req, res, next) => {
  try {
    const locationId = req.params.id;
    const weekOf = req.query.weekOf ? startOfWeek(req.query.weekOf) : startOfWeek(new Date());
    const weekStartsOn = req.business.settings?.weekStartsOn ?? 0;

    // All active staff at this location (scoped to business)
    const staff = await StaffMember.find({ businessId: req.business._id, locationIds: locationId, isActive: true });
    const availabilities = await Availability.find({ locationId, staffId: { $in: staff.map((s) => s._id) } });
    const byStaff = new Map(availabilities.map((a) => [a.staffId.toString(), a]));

    const data = staff.map((s) => {
      const av = byStaff.get(s._id.toString());
      const resolved = resolveAvailability(av, weekOf, weekStartsOn);
      // "submitted" = has any recurring slots OR an override for this week
      const submitted = !!av && ((av.recurring?.slots?.length > 0) || resolved.length > 0);
      return { staffId: s._id, name: s.name, resolvedSlots: resolved, submitted };
    });

    res.status(200).json({ success: true, data, weekOf });
  } catch (err) {
    logger.error('Error in getLocationAvailability:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/availability/:staffId/override-request
 * @desc    Owner: propose an availability override for a staff member (needs their confirm).
 * @access  Private (owner)
 */
exports.requestOverride = async (req, res, next) => {
  try {
    const { staffId } = req.params;
    const { weekOf, slots, note } = req.body;
    if (!weekOf || !Array.isArray(slots)) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: 'weekOf and slots are required.', request_id: req.id });
    }

    // Verify staff belongs to this business (tenancy)
    const staff = await StaffMember.findOne({ _id: staffId, businessId: req.business._id });
    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found', request_id: req.id });

    const locationId = primaryLocation(staff);
    let availability = await Availability.findOne({ staffId, locationId });
    if (!availability) {
      availability = await Availability.create({ staffId, locationId, recurring: { slots: [] } });
    }

    availability.pendingOverrides.push({
      weekOf: startOfWeek(weekOf),
      slots,
      note,
      requestedBy: req.user.id,
      status: 'pending',
    });
    await availability.save();

    const created = availability.pendingOverrides[availability.pendingOverrides.length - 1];
    // TODO (Phase 9): notify the staff member of the override request
    res.status(201).json({ success: true, data: { requestId: created._id, status: 'pending' } });
  } catch (err) {
    logger.error('Error in requestOverride:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/availability/override-request/:id
 * @desc    Staff: confirm or decline a manager's override request.
 * @access  Private (staff)
 */
exports.reviewOverride = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res.status(403).json({ success: false, message: 'Only the staff member can review this.', request_id: req.id });
    }
    const { decision } = req.body; // 'confirm' | 'decline'
    if (!['confirm', 'decline'].includes(decision)) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: 'decision must be confirm or decline.', request_id: req.id });
    }

    // Find the availability doc owning this pending override (must belong to the caller)
    const availability = await Availability.findOne({
      staffId: req.staffMember._id,
      'pendingOverrides._id': req.params.id,
    });
    if (!availability) {
      return res.status(404).json({ success: false, message: 'Override request not found', request_id: req.id });
    }

    const pending = availability.pendingOverrides.id(req.params.id);
    if (pending.status !== 'pending') {
      return res.status(409).json({ success: false, message: 'This request was already reviewed.', request_id: req.id });
    }

    if (decision === 'confirm') {
      pending.status = 'confirmed';
      // Apply: replace/insert the override for that week
      const wk = startOfWeek(pending.weekOf).getTime();
      const idx = availability.overrides.findIndex((o) => startOfWeek(o.weekOf).getTime() === wk);
      if (idx >= 0) availability.overrides[idx].slots = pending.slots;
      else availability.overrides.push({ weekOf: pending.weekOf, slots: pending.slots });
    } else {
      pending.status = 'declined';
    }

    await availability.save();
    res.status(200).json({ success: true, data: { status: pending.status } });
  } catch (err) {
    logger.error('Error in reviewOverride:', err);
    next(err);
  }
};
