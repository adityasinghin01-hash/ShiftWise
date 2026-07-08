// controllers/timeoffController.js
// Time-off requests (§9 Phase 5 · §7 Time Off). Staff submit; managers approve/deny.
// Approving flags a coverage warning if the staff member is already on a PUBLISHED
// shift within the requested dates. Approved time-off becomes a HARD scheduler
// block (checkAssignment TIME_OFF) via generateSchedule's time-off loading.
// TENANCY: staff scope to req.staffMember; owner scope to req.business.

'use strict';

const TimeOffRequest = require('../models/TimeOffRequest');
const Shift = require('../models/Shift');
const Schedule = require('../models/Schedule');
const StaffMember = require('../models/StaffMember');
const { notify } = require('../services/notificationService');
const logger = require('../config/logger');

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

const primaryLocation = (staff) => staff?.locationIds?.[0] || null;

/**
 * @route   POST /api/v1/timeoff
 * @desc    Staff submit a time-off request.
 * @access  Private (staff)
 */
exports.submitTimeOff = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res
        .status(403)
        .json({ success: false, message: 'Only staff can request time off.', request_id: req.id });
    }
    const locationId = primaryLocation(req.staffMember);
    if (!locationId) {
      return res.status(400).json({
        success: false,
        message: 'You are not assigned to a location yet.',
        request_id: req.id,
      });
    }
    const { startDate, endDate, reason } = req.body;
    if (!startDate || !endDate) {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: 'startDate and endDate are required.',
        request_id: req.id,
      });
    }

    const request = await TimeOffRequest.create({
      businessId: req.staffMember.businessId,
      staffId: req.staffMember._id,
      locationId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      reason,
    });
    res.status(201).json({ success: true, data: request });
  } catch (err) {
    // Model pre-validate rejects endDate < startDate.
    if (err.name === 'ValidationError') {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: err.message,
        request_id: req.id,
      });
    }
    logger.error('Error in submitTimeOff:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/my/timeoff
 * @desc    Staff: my time-off requests.
 * @access  Private (staff)
 */
exports.myTimeOff = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res.status(403).json({
        success: false,
        message: 'Only staff have time-off requests.',
        request_id: req.id,
      });
    }
    const items = await TimeOffRequest.find({ staffId: req.staffMember._id }).sort({
      createdAt: -1,
    });
    res.status(200).json({ success: true, data: items });
  } catch (err) {
    logger.error('Error in myTimeOff:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/locations/:id/timeoff
 * @desc    Owner: time-off requests for a location (default: pending first).
 * @access  Private (owner)
 */
exports.locationTimeOff = async (req, res, next) => {
  try {
    const filter = { businessId: req.business._id, locationId: req.params.id };
    if (req.query.status) filter.status = req.query.status;
    const items = await TimeOffRequest.find(filter).sort({ status: 1, startDate: 1 });
    res.status(200).json({ success: true, data: items });
  } catch (err) {
    logger.error('Error in locationTimeOff:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/timeoff/:id/review
 * @desc    Owner approve/deny. Approving returns a coverage warning listing any
 *          PUBLISHED shifts the staff member is already on within these dates.
 * @access  Private (owner)
 */
exports.reviewTimeOff = async (req, res, next) => {
  try {
    const { decision, note } = req.body;
    if (!['approved', 'denied'].includes(decision)) {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: 'decision must be approved or denied.',
        request_id: req.id,
      });
    }
    const request = await TimeOffRequest.findOne({
      _id: req.params.id,
      businessId: req.business._id,
    });
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: 'Request not found.', request_id: req.id });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: 'This request was already reviewed.',
        request_id: req.id,
      });
    }

    request.status = decision;
    request.reviewedBy = req.user.id;
    request.reviewedAt = new Date();
    if (note) request.reviewNote = note;
    await request.save();

    // Coverage warning: on approval, surface any PUBLISHED shifts this staff
    // member is already assigned within the approved window — the manager may
    // need to arrange cover (approved time-off will hard-block future generation).
    let coverageWarning;
    if (decision === 'approved') {
      const publishedIds = await Schedule.find({
        businessId: req.business._id,
        status: 'published',
      }).distinct('_id');
      const clashing = await Shift.find({
        scheduleId: { $in: publishedIds },
        staffId: request.staffId,
        date: { $gte: request.startDate, $lte: request.endDate },
      }).select('_id date shiftType');
      if (clashing.length) {
        coverageWarning = { shiftIds: clashing.map((s) => s._id), shifts: clashing };
      }
    }

    // Notify the requester of the decision (Phase 9).
    try {
      const staff = await StaffMember.findById(request.staffId).select('userId').lean();
      if (staff?.userId) {
        await notify({
          userId: staff.userId,
          businessId: req.business._id,
          type: decision === 'approved' ? 'time_off_approved' : 'time_off_denied',
          title: `Time off ${decision}`,
          body: `Your time-off request for ${ymd(request.startDate)}–${ymd(request.endDate)} was ${decision}.`,
          data: { requestId: String(request._id) },
        });
      }
    } catch (e) {
      logger.error('Notify (time-off review) failed:', e);
    }

    res.status(200).json({ success: true, data: { request, coverageWarning } });
  } catch (err) {
    logger.error('Error in reviewTimeOff:', err);
    next(err);
  }
};
