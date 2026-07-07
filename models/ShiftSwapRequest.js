// models/ShiftSwapRequest.js
// A staff member's request to swap a shift — either targeting a specific
// teammate (targeted) or posting to the open board for anyone to claim.
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: all queries must filter by businessId.

'use strict';

const mongoose = require('mongoose');

// A claim on an open-board swap (any eligible staff can claim)
const claimSchema = new mongoose.Schema(
  {
    staffId:   { type: mongoose.Schema.Types.ObjectId, ref: 'StaffMember', required: true },
    claimedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const shiftSwapRequestSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    requesterStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffMember',
      required: true,
    },

    // The shift the requester wants to give away
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shift',
      required: true,
    },

    // targeted = aimed at one specific colleague; open = posted to the board
    mode: {
      type: String,
      enum: ['targeted', 'open'],
      required: true,
    },

    // Only set for targeted swaps
    targetStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffMember',
      default: null,
    },

    // Open-board claims (multiple staff can claim; manager picks one to approve)
    claims: { type: [claimSchema], default: [] },

    status: {
      type: String,
      enum: ['pending', 'claimed', 'approved', 'denied', 'cancelled'],
      default: 'pending',
    },

    reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

shiftSwapRequestSchema.index({ businessId: 1, status: 1 });
shiftSwapRequestSchema.index({ requesterStaffId: 1 });

const ShiftSwapRequest = mongoose.model('ShiftSwapRequest', shiftSwapRequestSchema);
module.exports = ShiftSwapRequest;
