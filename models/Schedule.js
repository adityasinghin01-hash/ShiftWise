// models/Schedule.js
// One week's roster for a Location. Contains metadata; the actual
// shift assignments live in the Shift model (ref scheduleId).
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: all queries must filter by businessId.

'use strict';

const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    // ── Tenancy ───────────────────────────────────────────
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
      index: true,
    },

    // ── Period ────────────────────────────────────────────
    // V1: weekly only (Mon–Sun). periodEnd computed from periodStart on create.
    periodStart: { type: Date, required: true }, // Monday 00:00 UTC
    periodEnd: { type: Date, required: true }, // Sunday 23:59 UTC

    // ── Lifecycle ─────────────────────────────────────────
    // draft     = being built / just generated (not visible to staff)
    // published = live, staff notified and can see their shifts
    // archived  = past period, read-only history
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },

    // How the initial schedule was created
    generatedBy: {
      type: String,
      enum: ['auto', 'manual', 'copy', 'template'],
      default: 'manual',
    },

    // The template this was based on, if any (for copy/template workflows)
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ScheduleTemplate',
      default: null,
    },

    // ── Quality metrics ───────────────────────────────────
    // Overall fairness score 0–100 computed by the algorithm on generate/publish.
    // Higher = more evenly distributed weekend/night shifts.
    fairnessScore: { type: Number, default: null, min: 0, max: 100 },

    // ── Publish audit ─────────────────────────────────────
    publishedAt: { type: Date, default: null },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    notes: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

// Compound index: fast "find schedules for this location, sorted by week"
scheduleSchema.index({ locationId: 1, periodStart: -1 });
scheduleSchema.index({ businessId: 1, status: 1 });

const Schedule = mongoose.model('Schedule', scheduleSchema);
module.exports = Schedule;
