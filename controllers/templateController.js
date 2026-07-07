// controllers/templateController.js
// Saved schedule templates (Phase 4 follow-up #2). Save a week's staffed roster
// as a named, reusable pattern; load it into another week (date-shifted).
// §5 (ScheduleTemplate) · §8.4 S4 (Load-template)
// TENANCY: every query scoped to req.business._id. Owner-only.

'use strict';

const ScheduleTemplate = require('../models/ScheduleTemplate');
const Schedule = require('../models/Schedule');
const Shift = require('../models/Shift');
const { startOfWeek } = require('../utils/weekUtils');
const logger = require('../config/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const dowOf = (date) => (new Date(date).getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
const isNight = (s, e) => {
  const [sh] = s.split(':').map(Number);
  const [eh] = e.split(':').map(Number);
  return sh <= 6 || eh >= 22 || e <= s;
};

/**
 * @route   GET /api/v1/locations/:id/templates
 * @desc    List saved templates for a location.
 * @access  Private (owner)
 */
exports.listTemplates = async (req, res, next) => {
  try {
    const templates = await ScheduleTemplate.find({
      businessId: req.business._id,
      locationId: req.params.id,
    }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: templates });
  } catch (err) {
    logger.error('Error in listTemplates:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/schedules/:id/save-template
 * @desc    Save a schedule's current shifts as a named, reusable template.
 * @access  Private (owner)
 */
exports.saveTemplate = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: 'A template name is required.',
        request_id: req.id,
      });
    }
    const schedule = await Schedule.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!schedule) {
      return res
        .status(404)
        .json({ success: false, message: 'Schedule not found.', request_id: req.id });
    }

    const shifts = await Shift.find({ scheduleId: schedule._id });
    const templateShifts = shifts.map((s) => ({
      dayOfWeek: dowOf(s.date),
      shiftType: s.shiftType,
      startTime: s.startTime,
      endTime: s.endTime,
      staffId: s.staffId,
      requiredCount: 1,
    }));

    const template = await ScheduleTemplate.create({
      businessId: req.business._id,
      locationId: schedule.locationId,
      name: String(name).trim(),
      shifts: templateShifts,
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    logger.error('Error in saveTemplate:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/schedules/:id/load-template
 * @desc    Recreate a template's staffed shifts into a draft schedule's week.
 * @access  Private (owner)
 */
exports.loadTemplate = async (req, res, next) => {
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
        message: 'Only draft schedules can load a template.',
        request_id: req.id,
      });
    }
    const template = await ScheduleTemplate.findOne({
      _id: req.body.templateId,
      businessId: req.business._id,
    });
    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: 'Template not found.', request_id: req.id });
    }

    const weekStart = startOfWeek(schedule.periodStart, 0).getTime();
    // Only staffed template rows become real shifts (a Shift requires a staffId).
    const docs = template.shifts
      .filter((ts) => ts.staffId)
      .map((ts) => ({
        scheduleId: schedule._id,
        businessId: schedule.businessId,
        locationId: schedule.locationId,
        staffId: ts.staffId,
        date: new Date(weekStart + ts.dayOfWeek * DAY_MS),
        startTime: ts.startTime,
        endTime: ts.endTime,
        shiftType: ts.shiftType,
        isWeekend: ts.dayOfWeek >= 5,
        isNight: isNight(ts.startTime, ts.endTime),
        locked: false,
      }));

    await Shift.deleteMany({ scheduleId: schedule._id, locked: { $ne: true } });
    if (docs.length) await Shift.insertMany(docs);

    schedule.generatedBy = 'template';
    schedule.templateId = template._id;
    await schedule.save();

    const shifts = await Shift.find({ scheduleId: schedule._id }).sort({ date: 1, startTime: 1 });
    res.status(200).json({ success: true, data: { schedule, shifts } });
  } catch (err) {
    logger.error('Error in loadTemplate:', err);
    next(err);
  }
};

/**
 * @route   DELETE /api/v1/templates/:id
 * @access  Private (owner)
 */
exports.deleteTemplate = async (req, res, next) => {
  try {
    const t = await ScheduleTemplate.findOneAndDelete({
      _id: req.params.id,
      businessId: req.business._id,
    });
    if (!t) {
      return res
        .status(404)
        .json({ success: false, message: 'Template not found.', request_id: req.id });
    }
    res.status(200).json({ success: true, data: { id: t._id } });
  } catch (err) {
    logger.error('Error in deleteTemplate:', err);
    next(err);
  }
};
