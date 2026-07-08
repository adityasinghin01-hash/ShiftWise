// services/notificationService.js
// Central notification pipeline (§9 Phase 9). notify() always writes the in-app
// Notification (what the bell polls), then fans out to email + Web Push WITHOUT
// blocking the caller — email/push are fire-and-forget with their own error handling.

'use strict';

const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const { sendEmail } = require('./emailService');
const logger = require('../config/logger');

// Web Push is optional — only active when VAPID keys are configured.
let webpush = null;
try {
  webpush = require('web-push');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:notify@shiftwise.dev',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }
} catch {
  webpush = null;
}
const pushConfigured = () =>
  !!(webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/** Send the notification as an email (best-effort). */
async function emailNotification(userId, subject, body) {
  const user = await User.findById(userId).select('email name').lean();
  if (!user?.email) return;
  await sendEmail({
    to: user.email,
    toName: user.name,
    subject,
    html: `<p>${body}</p>`,
    text: body,
  });
}

/** Push the notification to all of the user's registered browsers (best-effort). */
async function pushNotification(userId, title, body, data) {
  if (!pushConfigured()) {
    logger.info(`[push mocked] → user ${userId}: ${title}`); // no VAPID keys in this env
    return;
  }
  const subs = await PushSubscription.find({ userId }).lean();
  await Promise.all(
    subs.map((s) =>
      webpush
        .sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          JSON.stringify({ title, body, data })
        )
        .catch(async (err) => {
          // 404/410 → subscription is dead; prune it.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
          }
        })
    )
  );
}

/**
 * Create a notification and fan out to the requested channels.
 * @returns the persisted in-app Notification (awaited); email/push run in background.
 */
async function notify({
  userId,
  businessId,
  type,
  title,
  body,
  data = {},
  channels = ['in-app', 'email'],
}) {
  if (!userId || !businessId || !type) {
    throw new Error('notify requires userId, businessId, and type');
  }
  // 1) In-app is the source of truth for the bell — always create + await it.
  const note = await Notification.create({
    userId,
    businessId,
    type,
    title,
    body,
    data,
    channels,
  });

  // 2) Email + push are fire-and-forget — never block the request path.
  if (channels.includes('email')) {
    emailNotification(userId, title, body).catch((err) =>
      logger.error('Notification email failed (non-fatal):', err)
    );
  }
  if (channels.includes('push')) {
    pushNotification(userId, title, body, data).catch((err) =>
      logger.error('Notification push failed (non-fatal):', err)
    );
  }
  return note;
}

module.exports = { notify, emailNotification, pushNotification, pushConfigured };
