// models/StaffMetrics.js
// Denormalized metrics per staff per month for analytics + fairness + reliability scoring.
// Recomputed (upserted) on every schedule publish and on every attendance change.
// Kept denormalized so analytics queries are fast reads, not expensive aggregations.
// §5 Data Models — Phase 0 (Foundation)

'use strict';

const mongoose = require('mongoose');

const staffMetricsSchema = new mongoose.Schema(
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

    // The calendar month this record covers
    period: {
      year:  { type: Number, required: true },
      month: { type: Number, required: true, min: 1, max: 12 },
    },

    // ── Hour buckets ──────────────────────────────────────
    totalHours:        { type: Number, default: 0, min: 0 },
    weekendHours:      { type: Number, default: 0, min: 0 }, // Sat + Sun shifts
    nightHours:        { type: Number, default: 0, min: 0 }, // shifts ending ≥22:00
    earlyMorningHours: { type: Number, default: 0, min: 0 }, // shifts starting ≤06:00

    // ── Attendance counters ───────────────────────────────
    absences:     { type: Number, default: 0, min: 0 }, // scheduled but absent
    lateArrivals: { type: Number, default: 0, min: 0 },
    noShows:      { type: Number, default: 0, min: 0 }, // no-show (counts toward reliability drop)

    // ── Swap / cover activity ─────────────────────────────
    swapsRequested:  { type: Number, default: 0, min: 0 },
    coversCompleted: { type: Number, default: 0, min: 0 }, // times stepped in to cover

    // ── Time off ──────────────────────────────────────────
    timeOffDaysTaken: { type: Number, default: 0, min: 0 },

    // ── Computed scores (re-derived on each upsert) ───────
    // dedicationScore: composite score used for badges / recognition
    dedicationScore: { type: Number, default: 0 },

    // reliabilityScore 0–100: gates auto-cover claim (§6.6)
    // 100 - 20*noShows - 5*lateArrivals + 3*coversCompleted, clamped 0–100
    reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },

    // fairnessDebt: how many "owed" bad shifts vs team average.
    // Used as the fairness score input in the algorithm (§6.4).
    fairnessDebt: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One record per staff+location+month (upserted, never duplicated)
staffMetricsSchema.index(
  { staffId: 1, locationId: 1, 'period.year': 1, 'period.month': 1 },
  { unique: true }
);

const StaffMetrics = mongoose.model('StaffMetrics', staffMetricsSchema);
module.exports = StaffMetrics;
