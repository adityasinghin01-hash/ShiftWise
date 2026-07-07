// models/Business.js
// Top-level tenant model. One Business per manager/owner account.
// §5 Data Models — Phase 0 (Foundation)
// Every other ShiftWise model scopes its data to businessId (ref this).

'use strict';

const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    // The user who owns/created this business (the "owner" role)
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ── Business-wide settings ────────────────────────────
    settings: {
      timezone: { type: String, default: 'UTC' },        // IANA tz string e.g. 'Asia/Kolkata'
      currency: { type: String, default: 'USD' },        // ISO 4217
      weekStartsOn: { type: Number, default: 0, min: 0, max: 1 }, // 0=Monday, 1=Sunday
    },

    // ── Onboarding state ──────────────────────────────────
    // Used to show/hide the first-timer wizard and getting-started checklist.
    // Once completed=true, the wizard never appears again for this business.
    onboarding: {
      completed: { type: Boolean, default: false },
      checklist: {
        addedStaff:    { type: Boolean, default: false },
        availabilitySet: { type: Boolean, default: false },
        rulesSet:      { type: Boolean, default: false },
        generated:     { type: Boolean, default: false },
        published:     { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true }
);

const Business = mongoose.model('Business', businessSchema);
module.exports = Business;
