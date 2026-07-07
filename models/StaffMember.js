// models/StaffMember.js
// A team member record owned by a Business.
// May or may not have a linked User account (accountStatus tracks this).
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: all queries must filter by businessId.

'use strict';

const mongoose = require('mongoose');

// Predefined badge types the owner can award (v1 set — extensible in v2)
const BADGE_TYPES = ['team_player', 'always_on_time', 'cover_hero', 'top_performer', 'reliable'];

const badgeSchema = new mongoose.Schema(
  {
    type: { type: String, enum: BADGE_TYPES, required: true },
    awardedAt: { type: Date, default: Date.now },
    awardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const staffMemberSchema = new mongoose.Schema(
  {
    // ── Tenancy ───────────────────────────────────────────
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },

    // Locations this staff member works at (can work multiple)
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],

    // ── Auth link ─────────────────────────────────────────
    // null until the staff member accepts an invite and creates their login
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true, // needed for resolveBusiness middleware lookup
    },

    // ── Identity ──────────────────────────────────────────
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 30 },

    role: {
      type: String,
      default: 'staff',
      trim: true,
      maxlength: 50, // freeform role label, e.g. 'barista', 'supervisor'
    },

    // ── Employment ────────────────────────────────────────
    hourlyRate: { type: Number, default: 0, min: 0 }, // for cost estimate in analytics
    employmentType: { type: String, enum: ['full-time', 'part-time', 'casual'], default: 'casual' },
    maxHoursPerWeek: { type: Number, default: 0, min: 0 }, // 0 = use location rule as cap

    // ── Scheduling flags ──────────────────────────────────
    // manuallyManaged: manager controls this person's availability directly
    // (ideal for staff who won't use the app). They can still be scheduled
    // even before they accept an invite.
    manuallyManaged: { type: Boolean, default: false },

    // forceTrustCover: bypass the reliabilityScore ≥70 gate for auto-cover.
    // Manager explicitly trusts this person to self-assign cover shifts.
    forceTrustCover: { type: Boolean, default: false },

    // ── Account lifecycle ─────────────────────────────────
    // none    = record only, no invite sent
    // invited = invite email sent, not yet joined
    // active  = joined, has a linked User account
    accountStatus: {
      type: String,
      enum: ['none', 'invited', 'active'],
      default: 'none',
    },

    // ── Rewards ───────────────────────────────────────────
    badges: { type: [badgeSchema], default: [] },

    // ── Soft delete ───────────────────────────────────────
    isActive: { type: Boolean, default: true },
    joinedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Compound indexes for hot query paths
staffMemberSchema.index({ businessId: 1, isActive: 1 });
staffMemberSchema.index({ businessId: 1, email: 1 }, { unique: true }); // one email per business

// Export badge types so other modules (controllers, seeds) can reference them
staffMemberSchema.statics.BADGE_TYPES = BADGE_TYPES;

const StaffMember = mongoose.model('StaffMember', staffMemberSchema);
module.exports = StaffMember;
