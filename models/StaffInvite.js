// models/StaffInvite.js
// One-time invite token linking an email to a StaffMember record.
// Raw token is NEVER stored — only its SHA-256 hash (via hashToken util).
// §5 Data Models — Phase 0 (Foundation)

'use strict';

const mongoose = require('mongoose');

const staffInviteSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffMember',
      required: true,
    },
    email:      { type: String, required: true, lowercase: true, trim: true },
    tokenHash:  { type: String, required: true, index: true }, // SHA-256 of raw token
    expiresAt:  { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const StaffInvite = mongoose.model('StaffInvite', staffInviteSchema);
module.exports = StaffInvite;
