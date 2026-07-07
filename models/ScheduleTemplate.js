// models/ScheduleTemplate.js
// A saved reusable weekly shift pattern for a Location.
// Manager can "Load template" in the Schedule Builder to pre-fill a week.
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: all queries must filter by businessId.

'use strict';

const mongoose = require('mongoose');

// One slot in the template: a recurring shift blueprint (no specific date)
const templateShiftSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 }, // 0=Mon … 6=Sun
    shiftType: { type: String, default: 'custom' },
    // Enforce 'HH:MM' (00:00–23:59) so malformed times can't reach the scheduler's parser.
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    requiredCount: { type: Number, default: 1, min: 1 }, // how many staff needed for this slot
  },
  { _id: false }
);

const scheduleTemplateSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 100 },
    shifts: { type: [templateShiftSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

scheduleTemplateSchema.index({ businessId: 1, locationId: 1 });

const ScheduleTemplate = mongoose.model('ScheduleTemplate', scheduleTemplateSchema);
module.exports = ScheduleTemplate;
