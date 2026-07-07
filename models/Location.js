// models/Location.js
// A physical café/restaurant branch belonging to a Business.
// Holds all scheduling rules the algorithm enforces.
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: all queries must filter by businessId.

'use strict';

const mongoose = require('mongoose');

// ── Shift type sub-schema ─────────────────────────────────
// A named time slot (e.g. Morning 08:00–14:00) with a colour for the UI grid.
const shiftTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    startTime: { type: String, required: true }, // 'HH:MM' 24h in location tz
    endTime: { type: String, required: true }, // 'HH:MM' 24h in location tz
    color: { type: String, default: '#4ea864' }, // hex for UI chip color
  },
  { _id: true }
);

// ── Location settings sub-schema ─────────────────────────
// These are the constraints the scheduling algorithm (§6) reads.
// Any rule left as 0 / null / [] is treated as "not enforced" — small cafés
// can leave advanced rules blank and the engine will skip them cleanly.
const settingsSchema = new mongoose.Schema(
  {
    // Core scheduling rules (always used)
    shiftTypes: { type: [shiftTypeSchema], default: [] },
    minStaffPerShift: { type: Number, default: 1, min: 0 },
    maxStaffPerShift: { type: Number, default: 5, min: 0 },
    maxHoursPerWeek: { type: Number, default: 0 }, // 0 = no cap

    // Advanced rules (optional — default to 0/[] = not enforced)
    minRestHours: { type: Number, default: 0 }, // min rest between shifts
    maxDaysConsecutive: { type: Number, default: 0 }, // max consecutive work days

    // Incompatible pairs: staff who must not share the same shift slot.
    // Stored as flat array of [staffIdA, staffIdB] pairs.
    incompatiblePairs: {
      type: [[{ type: mongoose.Schema.Types.ObjectId, ref: 'StaffMember' }]],
      default: [],
    },

    // Per-role minimum coverage: e.g. every shift needs ≥1 barista.
    roleCoverage: {
      type: [{ role: String, min: { type: Number, min: 1 } }],
      default: [],
    },
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    // ── Tenancy ───────────────────────────────────────────
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },

    // ── Identity ──────────────────────────────────────────
    name: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 255 },

    // Override the business-level timezone for this specific location (optional)
    timezone: { type: String, default: null },

    isActive: { type: Boolean, default: true },

    // ── Scheduling rules ──────────────────────────────────
    settings: { type: settingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Compound index: fast lookup of all active locations for a business
locationSchema.index({ businessId: 1, isActive: 1 });

const Location = mongoose.model('Location', locationSchema);
module.exports = Location;
