// models/Notification.js
// One in-app notification record per user.
// Powers the Gmail-style bell + unread count in the UI (§8.5).
// readAt=null means unread; set on read → count decrements.
// §5 Data Models — Phase 0 (Foundation)

'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    // The user who receives this notification (manager or staff)
    // No single-field index here: the compound indexes below both lead with
    // userId, so they already serve any userId-only query as a prefix.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },

    // Notification type (used for routing in UI and email templates)
    type: {
      type: String,
      required: true,
      enum: [
        'schedule_published',
        'shift_assigned',
        'time_off_approved',
        'time_off_denied',
        'swap_approved',
        'swap_denied',
        'cover_needed',
        'badge_awarded',
        'cover_override',
        'override_request', // availability override request from manager
        'shift_disputed',
      ],
    },

    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 500 },

    // Contextual payload (e.g. { scheduleId, shiftId } for deep-link navigation)
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Which delivery channels this notification used
    channels: {
      type: [{ type: String, enum: ['in-app', 'email', 'push'] }],
      default: ['in-app'],
    },

    // null = unread; set to Date when the user reads/dismisses it
    readAt: { type: Date, default: null },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Hot path: "get all unread notifications for this user" — used by bell poll
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
