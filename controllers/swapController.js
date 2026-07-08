// controllers/swapController.js
// Shift swaps (§9 Phase 5 · §7 Swaps). Staff request a swap (targeted at one
// teammate, or open to the board); teammates claim open swaps; managers review.
// Approval reassigns the shift ONLY if the new staff passes the constraint engine
// (checkAssignment via verifyAssignment): HARD blocks approval; SOFT is allowed
// with an override reason (audit-logged).
// TENANCY: staff scope to req.staffMember; owner scope to req.business.

'use strict';

const ShiftSwapRequest = require('../models/ShiftSwapRequest');
const Shift = require('../models/Shift');
const AuditLog = require('../models/AuditLog');
const scheduler = require('../services/schedulerService');
const logger = require('../config/logger');

/**
 * @route   POST /api/v1/swaps
 * @desc    Staff request a swap for one of their own shifts.
 * @access  Private (staff)
 */
exports.submitSwap = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res
        .status(403)
        .json({ success: false, message: 'Only staff can request swaps.', request_id: req.id });
    }
    const { shiftId, mode, targetStaffId } = req.body;
    if (!['targeted', 'open'].includes(mode)) {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: 'mode must be targeted or open.',
        request_id: req.id,
      });
    }
    // The shift must belong to the requester.
    const shift = await Shift.findOne({
      _id: shiftId,
      businessId: req.staffMember.businessId,
      staffId: req.staffMember._id,
    });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found or not yours.', request_id: req.id });
    }

    const request = await ShiftSwapRequest.create({
      businessId: req.staffMember.businessId,
      requesterStaffId: req.staffMember._id,
      shiftId,
      mode,
      targetStaffId: mode === 'targeted' ? targetStaffId : null,
    });
    res.status(201).json({ success: true, data: request });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: err.message,
        request_id: req.id,
      });
    }
    logger.error('Error in submitSwap:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/my/swaps
 * @access  Private (staff)
 */
exports.mySwaps = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res
        .status(403)
        .json({ success: false, message: 'Only staff have swaps.', request_id: req.id });
    }
    const items = await ShiftSwapRequest.find({
      businessId: req.staffMember.businessId,
      $or: [
        { requesterStaffId: req.staffMember._id },
        { targetStaffId: req.staffMember._id },
        { mode: 'open' },
      ],
    }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: items });
  } catch (err) {
    logger.error('Error in mySwaps:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/locations/:id/swaps
 * @access  Private (owner)
 */
exports.locationSwaps = async (req, res, next) => {
  try {
    // Swaps are scoped by business; filter to this location via their shifts.
    const shiftIds = await Shift.find({
      businessId: req.business._id,
      locationId: req.params.id,
    }).distinct('_id');
    const filter = { businessId: req.business._id, shiftId: { $in: shiftIds } };
    if (req.query.status) filter.status = req.query.status;
    const items = await ShiftSwapRequest.find(filter).sort({ status: 1, createdAt: -1 });
    res.status(200).json({ success: true, data: items });
  } catch (err) {
    logger.error('Error in locationSwaps:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/swaps/:id/claim
 * @desc    A teammate claims an OPEN swap (manager still approves).
 * @access  Private (staff)
 */
exports.claimSwap = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res
        .status(403)
        .json({ success: false, message: 'Only staff can claim swaps.', request_id: req.id });
    }
    const swap = await ShiftSwapRequest.findOne({
      _id: req.params.id,
      businessId: req.staffMember.businessId,
    });
    if (!swap) {
      return res
        .status(404)
        .json({ success: false, message: 'Swap not found.', request_id: req.id });
    }
    if (swap.mode !== 'open') {
      return res
        .status(409)
        .json({ success: false, message: 'This swap is not open to claims.', request_id: req.id });
    }
    if (String(swap.requesterStaffId) === String(req.staffMember._id)) {
      return res
        .status(409)
        .json({ success: false, message: 'You cannot claim your own swap.', request_id: req.id });
    }
    if (swap.claims.some((c) => String(c.staffId) === String(req.staffMember._id))) {
      return res
        .status(409)
        .json({ success: false, message: 'You already claimed this swap.', request_id: req.id });
    }
    swap.claims.push({ staffId: req.staffMember._id });
    if (swap.status === 'pending') swap.status = 'claimed';
    await swap.save();
    res.status(200).json({ success: true, data: swap });
  } catch (err) {
    logger.error('Error in claimSwap:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/swaps/:id/review
 * @desc    Owner approve/deny. Approving reassigns the shift to the new staff
 *          only if they pass the engine — HARD blocks; SOFT needs overrideReason.
 * @access  Private (owner)
 */
exports.reviewSwap = async (req, res, next) => {
  try {
    const { decision, overrideReason, claimerStaffId } = req.body;
    if (!['approved', 'denied'].includes(decision)) {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: 'decision must be approved or denied.',
        request_id: req.id,
      });
    }
    const swap = await ShiftSwapRequest.findOne({
      _id: req.params.id,
      businessId: req.business._id,
    });
    if (!swap) {
      return res
        .status(404)
        .json({ success: false, message: 'Swap not found.', request_id: req.id });
    }
    if (['approved', 'denied', 'cancelled'].includes(swap.status)) {
      return res
        .status(409)
        .json({ success: false, message: 'This swap was already reviewed.', request_id: req.id });
    }

    if (decision === 'denied') {
      swap.status = 'denied';
      swap.reviewedBy = req.user.id;
      swap.reviewedAt = new Date();
      await swap.save();
      return res
        .status(200)
        .json({ success: true, data: { request: swap, verdict: { hard: [], soft: [] } } });
    }

    // Who takes the shift: targeted → target; open → chosen claimer (or first claim).
    const newStaffId =
      swap.mode === 'targeted'
        ? swap.targetStaffId
        : claimerStaffId || (swap.claims[0] && swap.claims[0].staffId);
    if (!newStaffId) {
      return res.status(422).json({
        success: false,
        message: 'No one to swap the shift to (no target/claim).',
        request_id: req.id,
      });
    }

    const shift = await Shift.findOne({ _id: swap.shiftId, businessId: req.business._id });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'The shift no longer exists.', request_id: req.id });
    }

    // Validate the new assignment through the SAME engine the scheduler uses.
    const verdict = await scheduler.verifyAssignment({
      scheduleId: shift.scheduleId,
      staffId: newStaffId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      shiftType: shift.shiftType,
      excludeShiftId: shift._id,
    });
    if (verdict.hard.length) {
      return res.status(422).json({
        success: false,
        message: 'The swap breaks a hard rule and cannot be approved.',
        verdict,
        request_id: req.id,
      });
    }
    if (verdict.soft.length && !overrideReason) {
      return res.status(422).json({
        success: false,
        code: 'override_required',
        message: 'This swap raises a soft warning — a reason is required to approve.',
        verdict,
        request_id: req.id,
      });
    }

    // Reassign the shift + close the swap.
    shift.staffId = newStaffId;
    await shift.save();
    swap.status = 'approved';
    swap.reviewedBy = req.user.id;
    swap.reviewedAt = new Date();
    await swap.save();

    if (verdict.soft.length) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role || 'user',
        action: 'swap_override',
        meta: {
          swapId: String(swap._id),
          shiftId: String(shift._id),
          to: String(newStaffId),
          reason: overrideReason,
        },
      });
    }

    res.status(200).json({ success: true, data: { request: swap, verdict } });
  } catch (err) {
    if (err.message === 'STAFF_NOT_FOUND') {
      return res
        .status(404)
        .json({ success: false, message: 'Target staff not found.', request_id: req.id });
    }
    logger.error('Error in reviewSwap:', err);
    next(err);
  }
};
