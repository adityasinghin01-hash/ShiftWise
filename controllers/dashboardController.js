// controllers/dashboardController.js
// Manager Dashboard (§9 Phase 7 · S2 cockpit). One scoped aggregation that powers
// the owner's overview: KPI tiles, today's shifts, the "needs attention" queue
// (pending time-off + swaps + disputes), team reliability, and a setup checklist.
//
// TENANCY: owner-only (route guard). Everything is scoped to req.business._id, and
// an optional ?location=:id further narrows to one location (verified to belong to
// the business). ?location=all (default) spans every location.

'use strict';

const mongoose = require('mongoose');
const StaffMember = require('../models/StaffMember');
const Location = require('../models/Location');
const Schedule = require('../models/Schedule');
const Shift = require('../models/Shift');
const TimeOffRequest = require('../models/TimeOffRequest');
const ShiftSwapRequest = require('../models/ShiftSwapRequest');
const StaffMetrics = require('../models/StaffMetrics');
const Availability = require('../models/Availability');
const { reliabilityScore } = require('../services/schedulerService');
const logger = require('../config/logger');

function utcToday() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/**
 * @route   GET /api/v1/dashboard?location=all|:id
 * @desc    Owner: aggregated cockpit for one or all locations.
 * @access  Private (owner)
 */
exports.getDashboard = async (req, res, next) => {
  try {
    const businessId = req.business._id;

    // ── Resolve the location scope ────────────────────────
    const locParam = req.query.location;
    const single = locParam && locParam !== 'all';
    let locFilter = {};
    let scopedId = null;
    if (single) {
      if (!mongoose.isValidObjectId(locParam)) {
        return res
          .status(422)
          .json({ success: false, message: 'Invalid location id.', request_id: req.id });
      }
      const loc = await Location.findOne({ _id: locParam, businessId });
      if (!loc) {
        return res
          .status(404)
          .json({ success: false, message: 'Location not found.', request_id: req.id });
      }
      scopedId = loc._id;
      locFilter = { locationId: loc._id };
    }

    const locations = await Location.find({ businessId, isActive: { $ne: false } })
      .select('name')
      .lean();
    const activeStaff = await StaffMember.find({
      businessId,
      isActive: { $ne: false },
      ...(scopedId ? { locationIds: { $in: [scopedId] } } : {}),
    })
      .select('name role locationIds')
      .lean();

    // ── Needs-attention queues + today's shifts (parallel) ─
    const [pendingTO, pendingSwapsRaw, disputedShifts, todayShifts] = await Promise.all([
      TimeOffRequest.find({ businessId, status: 'pending', ...locFilter })
        .populate('staffId', 'name')
        .sort({ createdAt: 1 })
        .lean(),
      ShiftSwapRequest.find({ businessId, status: { $in: ['pending', 'claimed'] } })
        .populate('requesterStaffId', 'name')
        .populate('targetStaffId', 'name')
        .populate('shiftId', 'date startTime endTime shiftType locationId')
        .sort({ createdAt: 1 })
        .lean(),
      Shift.find({ businessId, status: 'disputed', ...locFilter })
        .populate('staffId', 'name')
        .sort({ date: 1 })
        .lean(),
      Shift.find({ businessId, date: utcToday(), ...locFilter })
        .populate('staffId', 'name')
        .sort({ startTime: 1 })
        .lean(),
    ]);
    // Swaps have no locationId of their own — scope them via their shift.
    const pendingSwaps = scopedId
      ? pendingSwapsRaw.filter(
          (s) => s.shiftId && String(s.shiftId.locationId) === String(scopedId)
        )
      : pendingSwapsRaw;

    // ── Team reliability (this month) ─────────────────────
    const now = new Date();
    const metrics = await StaffMetrics.find({
      locationId: scopedId ? scopedId : { $in: locations.map((l) => l._id) },
      'period.year': now.getFullYear(),
      'period.month': now.getMonth() + 1,
    }).lean();
    const metricByStaff = new Map(metrics.map((m) => [String(m.staffId), m]));
    const scores = activeStaff.map((s) => reliabilityScore(metricByStaff.get(String(s._id))));
    const avgReliability = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 100;

    // ── Setup checklist (reflects real state) ─────────────
    const [availCount, publishedCount] = await Promise.all([
      Availability.countDocuments({ staffId: { $in: activeStaff.map((s) => s._id) } }),
      Schedule.countDocuments({ businessId, status: 'published', ...locFilter }),
    ]);

    // ── Serialize (owner-safe, ids kept for inline actions) ─
    const timeOff = pendingTO.map((r) => ({
      _id: r._id,
      staffName: r.staffId?.name || '—',
      startDate: r.startDate,
      endDate: r.endDate,
      reason: r.reason || '',
    }));
    const swaps = pendingSwaps.map((r) => ({
      _id: r._id,
      requester: r.requesterStaffId?.name || '—',
      target: r.targetStaffId?.name || null,
      mode: r.mode,
      status: r.status,
      shift: r.shiftId
        ? {
            date: r.shiftId.date,
            startTime: r.shiftId.startTime,
            endTime: r.shiftId.endTime,
            shiftType: r.shiftId.shiftType,
          }
        : null,
    }));
    const disputes = disputedShifts.map((s) => ({
      _id: s._id,
      staffName: s.staffId?.name || '—',
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      reason: s.disputeReason || '',
    }));
    const today = todayShifts.map((s) => ({
      _id: s._id,
      staffName: s.staffId?.name || '—',
      startTime: s.startTime,
      endTime: s.endTime,
      shiftType: s.shiftType,
      status: s.status,
    }));

    res.status(200).json({
      success: true,
      data: {
        scope: single ? String(scopedId) : 'all',
        locations: locations.map((l) => ({ _id: l._id, name: l.name })),
        kpis: {
          activeStaff: activeStaff.length,
          pendingRequests: timeOff.length + swaps.length,
          openDisputes: disputes.length,
          avgReliability,
          todayShifts: today.length,
        },
        today,
        needsAttention: { timeOff, swaps, disputes },
        checklist: {
          hasLocation: locations.length > 0,
          hasStaff: activeStaff.length > 0,
          hasAvailability: availCount > 0,
          hasPublishedSchedule: publishedCount > 0,
        },
      },
    });
  } catch (err) {
    logger.error('Error in getDashboard:', err);
    next(err);
  }
};
