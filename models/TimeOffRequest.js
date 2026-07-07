// models/TimeOffRequest.js
// A staff member's request for time off (dates + reason).
// On approval, the affected dates become hard blocks in the scheduler.
// §5 Data Models — Phase 0 (Foundation)
// TENANCY: all queries must filter by businessId.

'use strict';

const mongoose = require('mongoose');

const timeOffRequestSchema = new mongoose.Schema(
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
      index: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, trim: true, maxlength: 500 },

    status: {
      type: String,
      enum: ['pending', 'approved', 'denied'],
      default: 'pending',
    },

    // Review metadata
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

timeOffRequestSchema.index({ businessId: 1, status: 1 });

const TimeOffRequest = mongoose.model('TimeOffRequest', timeOffRequestSchema);
module.exports = TimeOffRequest;
