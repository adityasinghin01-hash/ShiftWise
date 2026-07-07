// controllers/staffController.js
// Staff CRUD + invite + emergency-notify for the Team screen.
// §9 Phase 2 — Team + Invites · §7 API Contracts (Staff)
//
// TENANCY: every query scoped to req.business._id (resolveBusiness middleware).
// Owner-only (requireOwner on the routes).

'use strict';

const crypto = require('crypto');
const StaffMember = require('../models/StaffMember');
const StaffInvite = require('../models/StaffInvite');
const Shift       = require('../models/Shift');
const hashToken   = require('../utils/hashToken');
const emailService = require('../services/emailService');
const logger      = require('../config/logger');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Create + persist a StaffInvite and email the join link.
 * Replaces any prior pending invite for the same staff (single valid token).
 * @param {object} staff   — StaffMember document
 * @param {object} business — Business document (for email branding)
 * @param {string} inviterName
 */
async function issueInvite(staff, business, inviterName) {
  // High-entropy token; only its hash is stored (never the raw value).
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  // Invalidate older invites for this staff so only the newest link works.
  await StaffInvite.deleteMany({ staffId: staff._id });

  await StaffInvite.create({
    businessId: business._id,
    staffId: staff._id,
    email: staff.email,
    tokenHash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  staff.accountStatus = 'invited';
  await staff.save();

  // Send the branded invite email (never block on failure beyond logging).
  await emailService.sendStaffInviteEmail(staff.email, rawToken, {
    businessName: business.name,
    inviterName,
    staffName: staff.name,
  });
}

/**
 * @route   GET /api/v1/staff
 * @desc    List active staff for the business.
 * @access  Private (owner)
 */
exports.listStaff = async (req, res, next) => {
  try {
    const staff = await StaffMember.find({ businessId: req.business._id, isActive: true }).sort({ createdAt: 1 });
    res.status(200).json({ success: true, count: staff.length, data: staff });
  } catch (err) {
    logger.error('Error in listStaff:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/staff
 * @desc    Create one staff member; optionally send an invite.
 * @access  Private (owner)
 */
exports.createStaff = async (req, res, next) => {
  try {
    const { name, email, role, hourlyRate, maxHoursPerWeek, employmentType, manuallyManaged, locationIds, sendInvite } = req.body;

    const staff = await StaffMember.create({
      businessId: req.business._id, // TENANCY: never from client
      name,
      email,
      role: role || 'staff',
      hourlyRate: hourlyRate || 0,
      maxHoursPerWeek: maxHoursPerWeek || 0,
      employmentType: employmentType || 'casual',
      manuallyManaged: !!manuallyManaged,
      locationIds: locationIds || [],
      accountStatus: 'none',
    });

    if (sendInvite) {
      try {
        await issueInvite(staff, req.business, req.user.name);
      } catch (mailErr) {
        // Staff created, but invite email failed — surface a soft warning, not a hard fail.
        logger.error('Invite email failed for new staff:', mailErr.message);
        return res.status(201).json({ success: true, data: staff, warning: 'Staff created but invite email failed to send.' });
      }
    }

    res.status(201).json({ success: true, data: staff });
  } catch (err) {
    // Duplicate email within the same business (unique index {businessId,email})
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A staff member with this email already exists.', request_id: req.id });
    }
    logger.error('Error in createStaff:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/staff/bulk
 * @desc    Create many staff at once (CSV/paste). Returns created + per-row errors.
 * @access  Private (owner)
 */
exports.bulkCreateStaff = async (req, res, next) => {
  try {
    const { rows, sendInvite, locationIds } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: 'rows must be a non-empty array.', request_id: req.id });
    }
    if (rows.length > 200) {
      return res.status(422).json({ success: false, code: 'validation_failed', message: 'Cannot import more than 200 staff at once.', request_id: req.id });
    }

    const created = [];
    const errors = [];

    // Process sequentially so per-row errors (e.g. duplicate email) are isolated.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      try {
        if (!row.name || !row.email) {
          errors.push({ row: i, reason: 'name and email are required' });
          continue;
        }
        const staff = await StaffMember.create({
          businessId: req.business._id,
          name: String(row.name).trim(),
          email: String(row.email).trim().toLowerCase(),
          role: row.role || 'staff',
          // Assign to a location so staff can set availability / be scheduled.
          // Per-row locationIds win; otherwise fall back to the shared body value.
          locationIds: Array.isArray(row.locationIds) ? row.locationIds
                     : (Array.isArray(locationIds) ? locationIds : []),
          accountStatus: 'none',
        });
        if (sendInvite) {
          try { await issueInvite(staff, req.business, req.user.name); }
          catch (mailErr) { logger.error('Bulk invite email failed:', mailErr.message); }
        }
        created.push(staff);
      } catch (rowErr) {
        const reason = rowErr.code === 11000 ? 'duplicate email' : (rowErr.message || 'failed');
        errors.push({ row: i, reason });
      }
    }

    res.status(201).json({ success: true, data: { created, errors } });
  } catch (err) {
    logger.error('Error in bulkCreateStaff:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/staff/:id
 * @desc    Update a staff member's editable fields.
 * @access  Private (owner)
 */
exports.updateStaff = async (req, res, next) => {
  try {
    const staff = await StaffMember.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found', request_id: req.id });

    const editable = ['name', 'role', 'hourlyRate', 'maxHoursPerWeek', 'employmentType', 'manuallyManaged', 'forceTrustCover', 'locationIds', 'phone'];
    for (const field of editable) {
      if (req.body[field] !== undefined) staff[field] = req.body[field];
    }
    await staff.save();
    res.status(200).json({ success: true, data: staff });
  } catch (err) {
    logger.error('Error in updateStaff:', err);
    next(err);
  }
};

/**
 * @route   DELETE /api/v1/staff/:id
 * @desc    Soft-delete (deactivate) a staff member.
 * @access  Private (owner)
 */
exports.deleteStaff = async (req, res, next) => {
  try {
    const staff = await StaffMember.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found', request_id: req.id });

    staff.isActive = false;
    await staff.save();
    res.status(200).json({ success: true, data: { id: staff._id, isActive: false } });
  } catch (err) {
    logger.error('Error in deleteStaff:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/staff/:id/invite
 * @desc    (Re)send an invite to a staff member.
 * @access  Private (owner)
 */
exports.inviteStaff = async (req, res, next) => {
  try {
    const staff = await StaffMember.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found', request_id: req.id });
    if (staff.accountStatus === 'active') {
      return res.status(409).json({ success: false, message: 'This staff member has already joined.', request_id: req.id });
    }

    await issueInvite(staff, req.business, req.user.name);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    res.status(200).json({ success: true, data: { invited: true, expiresAt } });
  } catch (err) {
    logger.error('Error in inviteStaff:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/staff/:id/notify
 * @desc    Emergency-notify a staff member by email with their upcoming shifts.
 * @access  Private (owner)
 */
exports.notifyStaff = async (req, res, next) => {
  try {
    const staff = await StaffMember.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found', request_id: req.id });

    // Pull this staff's upcoming shifts (next 14 days) to include in the email.
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const shifts = await Shift.find({
      businessId: req.business._id,
      staffId: staff._id,
      date: { $gte: now, $lte: in14 },
    }).sort({ date: 1 }).limit(10);

    const shiftsHtml = shifts.length
      ? `<table style="width:100%;border-collapse:collapse;margin:16px 0">${shifts.map((s) =>
          `<tr><td style="padding:8px;border-bottom:1px solid rgba(78,168,100,0.15);color:#b8a98a;font-size:14px">${new Date(s.date).toDateString()} · ${s.startTime}–${s.endTime}</td></tr>`).join('')}</table>`
      : '';

    await emailService.sendEmergencyShiftEmail(staff.email, {
      staffName: staff.name,
      businessName: req.business.name,
      message: req.body.message,
      shiftsHtml,
    });

    logger.info(`Emergency notify sent to staff ${staff._id}`);
    res.status(200).json({ success: true, data: { sent: true } });
  } catch (err) {
    logger.error('Error in notifyStaff:', err);
    next(err);
  }
};
