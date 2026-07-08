// routes/v1/notifications.routes.js
// Notification bell endpoints (§9 Phase 9). Any authenticated user; scoped to self.
// Mounted at /api/v1/notifications by the v1 router.

'use strict';

const express = require('express');
const router = express.Router();

const notificationController = require('../../controllers/notificationController');
const { protect } = require('../../middleware/authMiddleware');

router.use(protect());

router.get('/', notificationController.list);
router.put('/read-all', notificationController.markAllRead);
router.put('/:id/read', notificationController.markRead);
router.post('/push-subscribe', notificationController.subscribePush);

module.exports = router;
