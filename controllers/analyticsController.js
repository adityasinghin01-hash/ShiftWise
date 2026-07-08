// controllers/analyticsController.js
// Analytics (§9 Phase 8 · S7). Owner-only, business-scoped aggregation over the
// recomputed StaffMetrics + live shift data: hours, labour cost (hours × rate),
// coverage %, fairness spread, late/no-show counts — plus badge awards that
// notify the staff member. Empty/hasData=false when no published week exists.

'use strict';

const mongoose = require('mongoose');
const StaffMember = require('../models/StaffMember');
const Location = require('../models/Location');
const Schedule = require('../models/Schedule');
const Shift = require('../models/Shift');
const StaffMetrics = require('../models/StaffMetrics');
const { monthRange } = require('../services/metricsService');
const { notify } = require('../services/notificationService');
const logger = require('../config/logger');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @route   GET /api/v1/analytics?location=all|:id&month=YYYY-MM
 * @desc    Owner: labour + coverage + fairness analytics for a month.
 * @access  Private (owner)
 */
exports.getAnalytics = async (req, res, next) => {
  try {
    const businessId = req.business._id;

    // Location scope
    let locIds = null;
    if (req.query.location && req.query.location !== 'all') {
      if (!mongoose.isValidObjectId(req.query.location)) {
        return res
          .status(422)
          .json({ success: false, message: 'Invalid location id.', request_id: req.id });
      }
      const loc = await Location.findOne({ _id: req.query.location, businessId });
      if (!loc) {
        return res
          .status(404)
          .json({ success: false, message: 'Location not found.', request_id: req.id });
      }
      locIds = [loc._id];
    } else {
      locIds = (await Location.find({ businessId }).select('_id').lean()).map((l) => l._id);
    }

    // Month scope (default: current)
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (req.query.month) {
      const m = /^(\d{4})-(\d{2})$/.exec(req.query.month);
      if (!m) {
        return res
          .status(422)
          .json({ success: false, message: 'month must be YYYY-MM.', request_id: req.id });
      }
      year = Number(m[1]);
      month = Number(m[2]);
    }
    const { start, end } = monthRange(year, month);

    // Empty state: no published schedule overlaps this month for the scope
    const publishedCount = await Schedule.countDocuments({
      businessId,
      locationId: { $in: locIds },
      status: 'published',
      periodStart: { $lt: end },
      periodEnd: { $gte: start },
    });
    if (publishedCount === 0) {
      return res.status(200).json({
        success: true,
        data: {
          hasData: false,
          period: { year, month },
          totals: {
            totalHours: 0,
            laborCost: 0,
            coveragePercent: 0,
            lateArrivals: 0,
            noShows: 0,
            shifts: 0,
          },
          perStaff: [],
          fairness: { maxHours: 0, minHours: 0, spread: 0 },
        },
      });
    }

    const staff = await StaffMember.find({
      businessId,
      isActive: { $ne: false },
      locationIds: { $in: locIds },
    })
      .select('name role hourlyRate')
      .lean();
    const metrics = await StaffMetrics.find({
      locationId: { $in: locIds },
      'period.year': year,
      'period.month': month,
    }).lean();
    const metricByStaff = new Map(metrics.map((m) => [String(m.staffId), m]));

    // Per-staff hours + cost
    const perStaff = staff.map((s) => {
      const m = metricByStaff.get(String(s._id));
      const hours = m?.totalHours || 0;
      return {
        staffId: s._id,
        name: s.name,
        role: s.role,
        hours,
        cost: round2(hours * (s.hourlyRate || 0)),
        reliabilityScore: m?.reliabilityScore ?? 100,
        lateArrivals: m?.lateArrivals || 0,
        noShows: m?.noShows || 0,
      };
    });

    const totalHours = round2(perStaff.reduce((a, s) => a + s.hours, 0));
    const laborCost = round2(perStaff.reduce((a, s) => a + s.cost, 0));
    const lateArrivals = perStaff.reduce((a, s) => a + s.lateArrivals, 0);
    const noShows = perStaff.reduce((a, s) => a + s.noShows, 0);

    // Coverage: of the month's shifts, how many were actually covered (not no-showed)
    const totalShifts = await Shift.countDocuments({
      businessId,
      locationId: { $in: locIds },
      date: { $gte: start, $lt: end },
    });
    const coveragePercent = totalShifts
      ? Math.round((100 * (totalShifts - noShows)) / totalShifts)
      : 0;

    // Fairness: spread of hours across staff who worked
    const workedHours = perStaff.map((s) => s.hours).filter((h) => h > 0);
    const maxHours = workedHours.length ? Math.max(...workedHours) : 0;
    const minHours = workedHours.length ? Math.min(...workedHours) : 0;

    res.status(200).json({
      success: true,
      data: {
        hasData: true,
        period: { year, month },
        totals: {
          totalHours,
          laborCost,
          coveragePercent,
          lateArrivals,
          noShows,
          shifts: totalShifts,
        },
        perStaff: perStaff.sort((a, b) => b.hours - a.hours),
        fairness: { maxHours, minHours, spread: round2(maxHours - minHours) },
      },
    });
  } catch (err) {
    logger.error('Error in getAnalytics:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/analytics/badges
 * @desc    Owner: award a badge to a staff member → in-app notification.
 * @access  Private (owner)
 */
exports.awardBadge = async (req, res, next) => {
  try {
    const { staffId, badge, message } = req.body;
    if (!mongoose.isValidObjectId(staffId) || !badge) {
      return res.status(422).json({
        success: false,
        message: 'staffId and badge are required.',
        request_id: req.id,
      });
    }
    const staff = await StaffMember.findOne({ _id: staffId, businessId: req.business._id });
    if (!staff) {
      return res
        .status(404)
        .json({ success: false, message: 'Staff member not found.', request_id: req.id });
    }
    if (!staff.userId) {
      return res.status(409).json({
        success: false,
        message: 'This staff member has no linked account to notify yet.',
        request_id: req.id,
      });
    }
    const note = await notify({
      userId: staff.userId,
      businessId: req.business._id,
      type: 'badge_awarded',
      title: `🏅 You earned: ${String(badge).slice(0, 100)}`,
      body:
        (message && String(message).slice(0, 500)) || `You've been awarded the "${badge}" badge!`,
      data: { badge: String(badge), staffId: String(staff._id) },
    });
    res
      .status(201)
      .json({ success: true, data: { notificationId: note._id, badge, staffId: staff._id } });
  } catch (err) {
    logger.error('Error in awardBadge:', err);
    next(err);
  }
};
