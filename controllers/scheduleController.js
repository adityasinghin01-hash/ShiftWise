// controllers/scheduleController.js
// Draft-schedule lifecycle for the Schedule Builder: create a weekly draft,
// fetch it with its shifts, and generate an algorithm PREVIEW (never persisted
// by generate — the manager accepts/discards via a later apply step).
// §9 Phase 4 · §7 API Contracts (Schedules)
//
// TENANCY: every query scoped to req.business._id (resolveBusiness). Owner-only.

'use strict';

const Schedule = require('../models/Schedule');
const Location = require('../models/Location');
const Shift = require('../models/Shift');
const scheduler = require('../services/schedulerService');
const { startOfWeek } = require('../utils/weekUtils');
const { toShiftEnum } = require('../utils/shiftType');
const { recomputeForSchedule } = require('../services/metricsService');
const logger = require('../config/logger');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @route   POST /api/v1/schedules
 * @desc    Create a weekly draft schedule for a location.
 * @access  Private (owner)
 */
exports.createSchedule = async (req, res, next) => {
  try {
    const { locationId, periodStart } = req.body;

    // Location must belong to the caller's business (tenancy).
    const location = await Location.findOne({ _id: locationId, businessId: req.business._id });
    if (!location) {
      return res
        .status(404)
        .json({ success: false, message: 'Location not found.', request_id: req.id });
    }

    // Normalize to the week's Monday; periodEnd = Sunday 23:59:59.999 UTC.
    const start = startOfWeek(periodStart || new Date(), 0);
    const end = new Date(start.getTime() + WEEK_MS - 1);

    // One draft per location per week — reuse if it already exists.
    const existing = await Schedule.findOne({
      businessId: req.business._id,
      locationId,
      periodStart: start,
    });
    if (existing) {
      return res.status(200).json({ success: true, data: existing, reused: true });
    }

    const schedule = await Schedule.create({
      businessId: req.business._id,
      locationId,
      periodStart: start,
      periodEnd: end,
      status: 'draft',
      generatedBy: 'manual',
    });

    res.status(201).json({ success: true, data: schedule });
  } catch (err) {
    logger.error('Error in createSchedule:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/schedules/:id
 * @desc    Get a schedule plus its shifts.
 * @access  Private (owner)
 */
exports.getSchedule = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, message: 'Schedule not found.', request_id: req.id });
    }
    const shifts = await Shift.find({ scheduleId: schedule._id }).sort({ date: 1, startTime: 1 });
    res.status(200).json({ success: true, data: { schedule, shifts } });
  } catch (err) {
    logger.error('Error in getSchedule:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/schedules/:id/generate
 * @desc    Run the algorithm and return a PREVIEW (not persisted).
 * @access  Private (owner)
 */
exports.generateSchedule = async (req, res, next) => {
  try {
    // Confirm ownership before running the (potentially heavy) generator.
    const schedule = await Schedule.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, message: 'Schedule not found.', request_id: req.id });
    }

    const result = await scheduler.generateSchedule(schedule._id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('Error in generateSchedule:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/schedules/:id/apply
 * @desc    Persist an accepted preview as Shift docs (replaces non-locked shifts).
 * @access  Private (owner)
 */
exports.applySchedule = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, message: 'Schedule not found.', request_id: req.id });
    }
    if (schedule.status !== 'draft') {
      return res.status(409).json({
        success: false,
        message: 'Only draft schedules can be edited.',
        request_id: req.id,
      });
    }

    const rows = Array.isArray(req.body.shifts) ? req.body.shifts : [];
    // Locked shifts are immovable — only replace the non-locked ones.
    await Shift.deleteMany({ scheduleId: schedule._id, locked: { $ne: true } });

    const docs = rows.map((s) => ({
      scheduleId: schedule._id,
      businessId: schedule.businessId,
      locationId: schedule.locationId,
      staffId: s.staffId,
      date: new Date(s.date),
      startTime: s.startTime,
      endTime: s.endTime,
      shiftType: toShiftEnum(s.shiftType),
      isWeekend: !!s.isWeekend,
      isNight: !!s.isNight,
      locked: false,
    }));
    if (docs.length) await Shift.insertMany(docs);

    schedule.generatedBy = 'auto';
    if (typeof req.body.fairnessScore === 'number') schedule.fairnessScore = req.body.fairnessScore;
    await schedule.save();

    const shifts = await Shift.find({ scheduleId: schedule._id }).sort({ date: 1, startTime: 1 });
    res.status(200).json({ success: true, data: { schedule, shifts } });
  } catch (err) {
    logger.error('Error in applySchedule:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/schedules/:id/publish
 * @desc    Publish a schedule (staff can then see their shifts).
 * @access  Private (owner)
 */
exports.publishSchedule = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, message: 'Schedule not found.', request_id: req.id });
    }
    schedule.status = 'published';
    schedule.publishedAt = new Date();
    schedule.publishedBy = req.user.id;
    await schedule.save();

    // Refresh denormalized metrics from the now-final roster (Phase 8).
    try {
      await recomputeForSchedule(schedule);
    } catch (e) {
      logger.error('Metric recompute after publish failed (non-fatal):', e);
    }

    // Notifying affected staff (in-app/email/push) lands in Phase 9.
    res.status(200).json({ success: true, data: { schedule, notified: [] } });
  } catch (err) {
    logger.error('Error in publishSchedule:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/schedules/:id/copy
 * @desc    Copy another week's shifts into this draft (date-shifted).
 * @access  Private (owner)
 */
exports.copySchedule = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, message: 'Schedule not found.', request_id: req.id });
    }
    const from = await Schedule.findOne({
      _id: req.body.fromScheduleId,
      businessId: req.business._id,
    });
    if (!from) {
      return res
        .status(404)
        .json({ success: false, message: 'Source schedule not found.', request_id: req.id });
    }

    const offsetMs =
      new Date(schedule.periodStart).getTime() - new Date(from.periodStart).getTime();
    const src = await Shift.find({ scheduleId: from._id });
    await Shift.deleteMany({ scheduleId: schedule._id, locked: { $ne: true } });

    const docs = src.map((s) => ({
      scheduleId: schedule._id,
      businessId: schedule.businessId,
      locationId: schedule.locationId,
      staffId: s.staffId,
      date: new Date(new Date(s.date).getTime() + offsetMs),
      startTime: s.startTime,
      endTime: s.endTime,
      shiftType: s.shiftType,
      isWeekend: s.isWeekend,
      isNight: s.isNight,
      locked: false,
    }));
    if (docs.length) await Shift.insertMany(docs);

    schedule.generatedBy = 'copy';
    await schedule.save();
    const shifts = await Shift.find({ scheduleId: schedule._id }).sort({ date: 1, startTime: 1 });
    res.status(200).json({ success: true, data: { schedule, shifts } });
  } catch (err) {
    logger.error('Error in copySchedule:', err);
    next(err);
  }
};
