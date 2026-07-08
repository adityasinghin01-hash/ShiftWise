// controllers/notificationController.js
// The user-facing side of notifications (§9 Phase 9): list + unread count, mark
// read, and register a Web Push subscription. Every query is scoped to the caller
// (req.user.id) — owners and staff each see only their own notifications.

'use strict';

const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const logger = require('../config/logger');

/**
 * @route GET /api/v1/notifications?unread=true&limit=30
 * @desc  The caller's notifications (newest first) + unread count.
 */
exports.list = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const filter = { userId };
    if (req.query.unread === 'true') filter.readAt = null;

    const [items, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({ userId, readAt: null }),
    ]);
    res.status(200).json({ success: true, data: { items, unreadCount } });
  } catch (err) {
    logger.error('Error in list notifications:', err);
    next(err);
  }
};

/**
 * @route PUT /api/v1/notifications/:id/read
 * @desc  Mark one of the caller's notifications read.
 */
exports.markRead = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res
        .status(422)
        .json({ success: false, message: 'Invalid notification id.', request_id: req.id });
    }
    const note = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!note) {
      return res
        .status(404)
        .json({ success: false, message: 'Notification not found.', request_id: req.id });
    }
    const unreadCount = await Notification.countDocuments({ userId: req.user.id, readAt: null });
    res.status(200).json({ success: true, data: { notification: note, unreadCount } });
  } catch (err) {
    logger.error('Error in markRead:', err);
    next(err);
  }
};

/**
 * @route PUT /api/v1/notifications/read-all
 * @desc  Mark all of the caller's unread notifications read.
 */
exports.markAllRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res
      .status(200)
      .json({ success: true, data: { updated: result.modifiedCount, unreadCount: 0 } });
  } catch (err) {
    logger.error('Error in markAllRead:', err);
    next(err);
  }
};

/**
 * @route POST /api/v1/notifications/push-subscribe
 * @desc  Register (or refresh) a Web Push subscription for the caller.
 */
exports.subscribePush = async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(422).json({
        success: false,
        message: 'A valid push subscription (endpoint + keys) is required.',
        request_id: req.id,
      });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { userId: req.user.id, endpoint, keys },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error('Error in subscribePush:', err);
    next(err);
  }
};
