// models/PushSubscription.js
// A browser Web Push subscription for a user (§9 Phase 9 — Notifications).
// Kept separate from the inherited User model so the auth template stays pristine.

'use strict';

const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.PushSubscription || mongoose.model('PushSubscription', pushSubscriptionSchema);
