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
const AuditLog = require('../models/AuditLog');
const scheduler = require('../services/schedulerService');
const { toShiftEnum } = require('../utils/shiftType');
const logger = require('../config/logger');

/** Normalize any date to UTC midnight so peer-shift/day matching is exact. */
const utcMidnight = (d) => {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
};

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
      date: utcMidnight(date),
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
      date: req.body.date ? utcMidnight(req.body.date) : shift.date,
      startTime: req.body.startTime ?? shift.startTime,
      endTime: req.body.endTime ?? shift.endTime,
      shiftType: req.body.shiftType ? toShiftEnum(req.body.shiftType) : shift.shiftType,
    };

    // Re-validate the (possibly) changed assignment, excluding this shift itself.
    // shiftType matters: INCOMPATIBLE_PAIR matches peers by day + shiftType, so a
    // type change alone can create a new pairing and must be re-checked.
    let verdict = { hard: [], soft: [] };
    const assignmentChanged =
      req.body.staffId !== undefined ||
      req.body.date !== undefined ||
      req.body.startTime !== undefined ||
      req.body.endTime !== undefined ||
      req.body.shiftType !== undefined;
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
    // Keep the weekend flag consistent if the shift moved to a different day.
    if (req.body.date !== undefined) {
      shift.isWeekend = (new Date(next_.date).getUTCDay() + 6) % 7 >= 5;
    }
    if (req.body.locked !== undefined) shift.locked = !!req.body.locked;
    await shift.save();
    res.status(200).json({ success: true, data: shift, verdict });
  } catch (err) {
    if (err.message === 'STAFF_NOT_FOUND') {
      return res
        .status(404)
        .json({ success: false, message: 'Staff member not found.', request_id: req.id });
    }
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

/**
 * @route   POST /api/v1/shifts/:id/absent
 * @desc    Mark a shift absent and return ranked cover candidates (§6.7).
 * @access  Private (owner)
 */
exports.markAbsent = async (req, res, next) => {
  try {
    const shift = await Shift.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found.', request_id: req.id });
    }
    shift.status = 'absent';
    await shift.save();
    const candidates = await scheduler.coverCandidates(shift);
    res.status(200).json({ success: true, data: { shift, candidates } });
  } catch (err) {
    logger.error('Error in markAbsent:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/shifts/:id/cover/assign
 * @desc    Assign a cover for an absent shift. Enforces the reliability gate +
 *          25-pt anti-favoritism rule (§6.7): if the manager's pick is far below
 *          the top eligible volunteer, OR below the auto-claim threshold, an
 *          overrideReason is required and the override is audit-logged.
 * @access  Private (owner)
 */
exports.assignCover = async (req, res, next) => {
  try {
    const { staffId, overrideReason } = req.body;
    const shift = await Shift.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found.', request_id: req.id });
    }

    const candidates = await scheduler.coverCandidates(shift);
    const chosen = candidates.find((c) => String(c.staffId) === String(staffId));
    if (!chosen) {
      return res.status(422).json({
        success: false,
        message: 'That staff member cannot cover this shift (fails a hard rule or not eligible).',
        request_id: req.id,
      });
    }

    const top = candidates[0];
    const favoritism =
      top && top.reliabilityScore - chosen.reliabilityScore > scheduler.FAVORITISM_GAP;
    const belowGate = !chosen.canAutoClaim;
    const needsOverride = favoritism || belowGate;

    if (needsOverride && !overrideReason) {
      return res.status(422).json({
        success: false,
        code: 'override_required',
        message: favoritism
          ? 'A more reliable volunteer is available — a reason is required to override.'
          : 'This staff member is below the auto-cover reliability threshold — a reason is required.',
        data: { recommended: top, chosen },
        request_id: req.id,
      });
    }

    if (needsOverride) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role || 'user',
        action: 'cover_override',
        meta: {
          shiftId: String(shift._id),
          from: top ? top.staffId : null,
          to: chosen.staffId,
          reason: overrideReason,
        },
      });
    }

    shift.coveredBy = staffId;
    shift.status = 'covered';
    await shift.save();
    res.status(200).json({ success: true, data: { shift, overridden: needsOverride } });
  } catch (err) {
    logger.error('Error in assignCover:', err);
    next(err);
  }
};
