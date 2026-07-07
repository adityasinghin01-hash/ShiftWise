// controllers/shiftController.js
// Manual shift edits in the Schedule Builder. Every add/edit runs the SAME
// constraint engine (scheduler.verifyAssignment → checkAssignment) the auto-
// generator uses: HARD violations block (422), SOFT warnings are returned so
// the manager can proceed knowingly.
// §9 Phase 4 · §7 API Contracts (Shifts)
// TENANCY: every query scoped to req.business._id.

'use strict';

const Schedule = require('../models/Schedule');
const Shift = require('../models/Shift');
const scheduler = require('../services/schedulerService');
const logger = require('../config/logger');

const toShiftEnum = (t) =>
  ['morning', 'afternoon', 'evening'].includes(String(t).toLowerCase())
    ? String(t).toLowerCase()
    : 'custom';

/**
 * @route   POST /api/v1/schedules/:id/shifts
 * @desc    Add one shift to a draft schedule (returns the rule verdict).
 * @access  Private (owner)
 */
exports.createShift = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, message: 'Schedule not found.', request_id: req.id });
    }
    const { staffId, date, startTime, endTime, shiftType } = req.body;

    const verdict = await scheduler.verifyAssignment({
      scheduleId: schedule._id,
      staffId,
      date,
      startTime,
      endTime,
      shiftType: toShiftEnum(shiftType),
    });
    if (verdict.hard.length) {
      return res.status(422).json({
        success: false,
        message: 'This assignment breaks a hard rule.',
        verdict,
        request_id: req.id,
      });
    }

    const shift = await Shift.create({
      scheduleId: schedule._id,
      businessId: schedule.businessId,
      locationId: schedule.locationId,
      staffId,
      date: new Date(date),
      startTime,
      endTime,
      shiftType: toShiftEnum(shiftType),
      isWeekend: !!req.body.isWeekend,
      isNight: !!req.body.isNight,
    });
    res.status(201).json({ success: true, data: shift, verdict });
  } catch (err) {
    if (err.message === 'STAFF_NOT_FOUND') {
      return res
        .status(404)
        .json({ success: false, message: 'Staff member not found.', request_id: req.id });
    }
    logger.error('Error in createShift:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/shifts/:id
 * @desc    Reassign / retime / lock a shift (re-checks rules unless only locking).
 * @access  Private (owner)
 */
exports.updateShift = async (req, res, next) => {
  try {
    const shift = await Shift.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found.', request_id: req.id });
    }

    const next_ = {
      staffId: req.body.staffId ?? shift.staffId,
      date: req.body.date ? new Date(req.body.date) : shift.date,
      startTime: req.body.startTime ?? shift.startTime,
      endTime: req.body.endTime ?? shift.endTime,
      shiftType: req.body.shiftType ? toShiftEnum(req.body.shiftType) : shift.shiftType,
    };

    // Re-validate the (possibly) changed assignment, excluding this shift itself.
    let verdict = { hard: [], soft: [] };
    const assignmentChanged =
      req.body.staffId !== undefined ||
      req.body.date !== undefined ||
      req.body.startTime !== undefined ||
      req.body.endTime !== undefined;
    if (assignmentChanged) {
      verdict = await scheduler.verifyAssignment({
        scheduleId: shift.scheduleId,
        excludeShiftId: shift._id,
        ...next_,
      });
      if (verdict.hard.length) {
        return res.status(422).json({
          success: false,
          message: 'This change breaks a hard rule.',
          verdict,
          request_id: req.id,
        });
      }
    }

    Object.assign(shift, next_);
    if (req.body.locked !== undefined) shift.locked = !!req.body.locked;
    await shift.save();
    res.status(200).json({ success: true, data: shift, verdict });
  } catch (err) {
    logger.error('Error in updateShift:', err);
    next(err);
  }
};

/**
 * @route   DELETE /api/v1/shifts/:id
 * @access  Private (owner)
 */
exports.deleteShift = async (req, res, next) => {
  try {
    const shift = await Shift.findOneAndDelete({
      _id: req.params.id,
      businessId: req.business._id,
    });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found.', request_id: req.id });
    }
    res.status(200).json({ success: true, data: { id: shift._id } });
  } catch (err) {
    logger.error('Error in deleteShift:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/shifts/:id/attendance
 * @desc    Manager marks attendance (present/late/no_show) — feeds analytics later.
 * @access  Private (owner)
 */
exports.markAttendance = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['present', 'late', 'no_show'].includes(status)) {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: 'status must be present, late, or no_show.',
        request_id: req.id,
      });
    }
    const shift = await Shift.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found.', request_id: req.id });
    }
    shift.attendance = status;
    await shift.save();
    res.status(200).json({ success: true, data: shift });
  } catch (err) {
    logger.error('Error in markAttendance:', err);
    next(err);
  }
};
