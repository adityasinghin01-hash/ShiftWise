// models/Availability.js
// When a staff member can work: a recurring weekly default pattern
// plus per-week overrides for exceptions ("normally free Mon, but not next Mon").
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: queries must scope to businessId via staffId or locationId join.

'use strict';

const mongoose = require('mongoose');

// A single day's availability window
const daySlotSchema = new mongoose.Schema(
  {
    dayOfWeek:      { type: Number, required: true, min: 0, max: 6 }, // 0=Mon … 6=Sun
    available:      { type: Boolean, default: true },
    preferredStart: { type: String, default: null }, // 'HH:MM' or null = no preference
    preferredEnd:   { type: String, default: null },
    note:           { type: String, maxlength: 200 },
  },
  { _id: false }
);

// A per-week override (replaces recurring for that specific week)
const overrideSchema = new mongoose.Schema(
  {
    weekOf: { type: Date, required: true }, // Monday of the week (UTC midnight)
    slots:  { type: [daySlotSchema], default: [] },
  },
  { _id: true }
);

// A manager-proposed override awaiting staff confirmation (Screen 5 Q2 → C).
// Only takes effect (moves into `overrides`) once the staff member confirms.
const pendingOverrideSchema = new mongoose.Schema(
  {
    weekOf:      { type: Date, required: true },
    slots:       { type: [daySlotSchema], default: [] },
    note:        { type: String, maxlength: 300 },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // the manager
    status:      { type: String, enum: ['pending', 'confirmed', 'declined'], default: 'pending' },
    createdAt:   { type: Date, default: Date.now },
  },
  { _id: true }
);

const availabilitySchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffMember',
      required: true,
      index: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },

    // The standing weekly pattern — auto-applies every week unless overridden
    recurring: {
      slots: { type: [daySlotSchema], default: [] },
    },

    // Per-week exceptions — override takes precedence over recurring for that week
    overrides: { type: [overrideSchema], default: [] },

    // Manager-proposed overrides awaiting this staff member's confirm/decline
    pendingOverrides: { type: [pendingOverrideSchema], default: [] },
  },
  { timestamps: true }
);

// One availability record per staff+location combination
availabilitySchema.index({ staffId: 1, locationId: 1 }, { unique: true });

const Availability = mongoose.model('Availability', availabilitySchema);
module.exports = Availability;
