// controllers/staffPortalController.js
// Staff Portal (§9 Phase 6 · S8 My Shifts). A staff member reads ONLY their own
// data: their published shifts (with same-shift coworkers stripped to name+role),
// their reliability metrics, and may acknowledge or dispute a shift they're on.
//
// TENANCY: every query is scoped to req.staffMember._id. Staff never receive the
// full team schedule, other members' ids/emails, or draft schedules.

'use strict';

const Shift = require('../models/Shift');
const Schedule = require('../models/Schedule');
const StaffMember = require('../models/StaffMember');
const StaffMetrics = require('../models/StaffMetrics');
const Notification = require('../models/Notification');
const Business = require('../models/Business');
const { reliabilityScore } = require('../services/schedulerService');
const { startOfWeek } = require('../utils/weekUtils');
const logger = require('../config/logger');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guard: the caller must be a staff member (owners have no personal shifts). */
function requireStaff(req, res) {
  if (req.membership !== 'staff' || !req.staffMember) {
    res
      .status(403)
      .json({ success: false, message: 'This endpoint is for staff members.', request_id: req.id });
    return false;
  }
  return true;
}

/** Serialize a shift for staff eyes — only self-relevant fields, coworkers stripped. */
function serializeMyShift(shift, coworkers) {
  return {
    _id: shift._id,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftType: shift.shiftType,
    isWeekend: shift.isWeekend,
    isNight: shift.isNight,
    status: shift.status,
    attendance: shift.attendance,
    acknowledgedAt: shift.acknowledgedAt,
    disputeReason: shift.disputeReason,
    // Only who else is on THIS shift, and only their display name + role.
    coworkers: coworkers.map((c) => ({ name: c.name, role: c.role })),
  };
}

/**
 * @route   GET /api/v1/my/shifts?weekOf=YYYY-MM-DD
 * @desc    Staff: my published shifts for the week + same-shift coworkers.
 * @access  Private (staff)
 */
exports.getMyShifts = async (req, res, next) => {
  try {
    if (!requireStaff(req, res)) return;
    const me = req.staffMember._id;

    const weekStartsOn = req.business?.settings?.weekStartsOn ?? 0;
    const anchor = req.query.weekOf ? new Date(req.query.weekOf) : new Date();
    if (Number.isNaN(anchor.getTime())) {
      return res
        .status(422)
        .json({ success: false, message: 'weekOf must be a valid date.', request_id: req.id });
    }
    const weekStart = startOfWeek(anchor, weekStartsOn);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

    // My shifts this week…
    const mine = await Shift.find({ staffId: me, date: { $gte: weekStart, $lt: weekEnd } })
      .sort({ date: 1, startTime: 1 })
      .lean();

    // …but only those from a PUBLISHED schedule (drafts are manager-only).
    const scheduleIds = [...new Set(mine.map((s) => String(s.scheduleId)))];
    const publishedIds = new Set(
      (
        await Schedule.find({ _id: { $in: scheduleIds }, status: 'published' })
          .select('_id')
          .lean()
      ).map((s) => String(s._id))
    );
    const visible = mine.filter((s) => publishedIds.has(String(s.scheduleId)));

    // Same-shift coworkers (same schedule + day + shiftType), name/role only.
    const coShifts = await Shift.find({
      scheduleId: { $in: [...publishedIds].map(String) },
      date: { $gte: weekStart, $lt: weekEnd },
      staffId: { $ne: me },
    })
      .select('staffId scheduleId date shiftType')
      .lean();
    const coStaffIds = [...new Set(coShifts.map((s) => String(s.staffId)))];
    const staffById = new Map(
      (
        await StaffMember.find({ _id: { $in: coStaffIds } })
          .select('name role')
          .lean()
      ).map((s) => [String(s._id), s])
    );
    const key = (s) => `${s.scheduleId}|${new Date(s.date).getTime()}|${s.shiftType}`;
    const coworkersByKey = new Map();
    for (const cs of coShifts) {
      const staff = staffById.get(String(cs.staffId));
      if (!staff) continue;
      const k = key(cs);
      if (!coworkersByKey.has(k)) coworkersByKey.set(k, []);
      coworkersByKey.get(k).push(staff);
    }

    const data = visible.map((s) => serializeMyShift(s, coworkersByKey.get(key(s)) || []));
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Error in getMyShifts:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/my/shifts/:id/acknowledge
 * @desc    Staff: acknowledge (confirm) one of my own shifts.
 * @access  Private (staff)
 */
exports.acknowledgeShift = async (req, res, next) => {
  try {
    if (!requireStaff(req, res)) return;
    // Self-scope: can only touch a shift assigned to me.
    const shift = await Shift.findOne({ _id: req.params.id, staffId: req.staffMember._id });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found.', request_id: req.id });
    }
    if (['absent', 'covered'].includes(shift.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot acknowledge a shift that is ${shift.status}.`,
        request_id: req.id,
      });
    }
    shift.status = 'confirmed';
    shift.acknowledgedAt = new Date();
    shift.disputeReason = null;
    await shift.save();
    res.status(200).json({ success: true, data: serializeMyShift(shift, []) });
  } catch (err) {
    logger.error('Error in acknowledgeShift:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/my/shifts/:id/dispute
 * @desc    Staff: dispute one of my own shifts → notify the manager.
 * @access  Private (staff)
 */
exports.disputeShift = async (req, res, next) => {
  try {
    if (!requireStaff(req, res)) return;
    const reason = (req.body.reason || '').trim();
    if (!reason) {
      return res
        .status(422)
        .json({ success: false, message: 'A dispute reason is required.', request_id: req.id });
    }
    const shift = await Shift.findOne({ _id: req.params.id, staffId: req.staffMember._id });
    if (!shift) {
      return res
        .status(404)
        .json({ success: false, message: 'Shift not found.', request_id: req.id });
    }
    if (['absent', 'covered'].includes(shift.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot dispute a shift that is ${shift.status}.`,
        request_id: req.id,
      });
    }
    shift.status = 'disputed';
    shift.disputeReason = reason.slice(0, 500);
    shift.acknowledgedAt = null;
    await shift.save();

    // Manager request: notify the business owner so they can resolve it.
    const business = req.business || (await Business.findById(shift.businessId));
    if (business?.ownerId) {
      await Notification.create({
        userId: business.ownerId,
        businessId: shift.businessId,
        type: 'shift_disputed',
        title: 'Shift disputed',
        body: `${req.staffMember.name} disputed a shift on ${new Date(shift.date)
          .toISOString()
          .slice(0, 10)}: ${reason.slice(0, 200)}`,
        data: { shiftId: String(shift._id), staffId: String(req.staffMember._id) },
      });
    }
    res.status(200).json({ success: true, data: serializeMyShift(shift, []) });
  } catch (err) {
    logger.error('Error in disputeShift:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/my/metrics
 * @desc    Staff: my reliability score + this month's activity counters.
 * @access  Private (staff)
 */
exports.getMyMetrics = async (req, res, next) => {
  try {
    if (!requireStaff(req, res)) return;
    const now = new Date();
    const locationId = req.staffMember.locationIds?.[0] || null;
    const metrics = await StaffMetrics.findOne({
      staffId: req.staffMember._id,
      locationId,
      'period.year': now.getFullYear(),
      'period.month': now.getMonth() + 1,
    }).lean();

    res.status(200).json({
      success: true,
      data: {
        reliabilityScore: reliabilityScore(metrics),
        period: { year: now.getFullYear(), month: now.getMonth() + 1 },
        totalHours: metrics?.totalHours || 0,
        weekendHours: metrics?.weekendHours || 0,
        nightHours: metrics?.nightHours || 0,
        noShows: metrics?.noShows || 0,
        lateArrivals: metrics?.lateArrivals || 0,
        coversCompleted: metrics?.coversCompleted || 0,
        timeOffDaysTaken: metrics?.timeOffDaysTaken || 0,
      },
    });
  } catch (err) {
    logger.error('Error in getMyMetrics:', err);
    next(err);
  }
};
