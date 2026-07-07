// models/Shift.js
// A single shift assignment: one staff member on one day/time within a Schedule.
// This is the atomic unit the algorithm produces and the manager drag-drops.
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: all queries must filter by businessId (or via scheduleId join).

'use strict';

const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    // ── Tenancy + parent ──────────────────────────────────
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
      required: true,
      index: true,
    },
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

    // ── Assignment ────────────────────────────────────────
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffMember',
      required: true,
    },

    // ── Time ──────────────────────────────────────────────
    date: { type: Date, required: true }, // UTC midnight of the shift day
    startTime: { type: String, required: true }, // 'HH:MM' in location tz
    endTime: { type: String, required: true }, // 'HH:MM' in location tz

    shiftType: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'custom'],
      default: 'custom',
    },

    // Pre-computed flags for fast fairness scoring (set on create/update)
    isWeekend: { type: Boolean, default: false }, // Sat or Sun
    isNight: { type: Boolean, default: false }, // endTime >= 22:00 or startTime <= 06:00

    // ── Builder state ─────────────────────────────────────
    // locked = true means auto-generate will NOT move this shift.
    // Manager placed it intentionally; the algorithm fills around it.
    locked: { type: Boolean, default: false },

    // ── Lifecycle ─────────────────────────────────────────
    status: {
      type: String,
      enum: ['scheduled', 'confirmed', 'disputed', 'absent', 'covered'],
      default: 'scheduled',
    },

    // ── Attendance (manager-marked) ───────────────────────
    attendance: {
      type: String,
      enum: ['unmarked', 'present', 'late', 'no_show'],
      default: 'unmarked',
    },

    // Who covered this shift if the original was marked absent
    coveredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffMember',
      default: null,
    },

    // Actual clock-in/out (v2 feature, schema ready)
    actualStart: { type: Date, default: null },
    actualEnd: { type: Date, default: null },

    notes: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

// Hot query paths
shiftSchema.index({ staffId: 1, date: 1 }); // "what is this person doing on this day?"
shiftSchema.index({ businessId: 1, date: 1 }); // "all shifts for this business on this date"
// Note: scheduleId already has `index: true` on the field definition above.

const Shift = mongoose.model('Shift', shiftSchema);
module.exports = Shift;
