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
