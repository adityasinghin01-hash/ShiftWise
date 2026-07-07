// controllers/joinController.js
// Public invite-acceptance flow + profile completion for staff.
// §9 Phase 2 — Team + Invites · §7 API Contracts (Join)
//
// Flow: manager invites staff → staff gets email with /#join?token=RAW →
//   GET  /join/validate  — checks the token, shows business name
//   POST /join/accept     — creates/links a User, marks staff active, logs them in
//   POST /join/complete-profile — staff fills phone etc. after joining

'use strict';

const User        = require('../models/User');
const Business    = require('../models/Business');
const StaffMember = require('../models/StaffMember');
const StaffInvite = require('../models/StaffInvite');
const hashToken   = require('../utils/hashToken');
const { generateAccessToken, generateRefreshToken } = require('../services/tokenService');
const logger      = require('../config/logger');

/**
 * Look up a valid (unexpired, unaccepted) invite by raw token.
 * @param {string} rawToken
 * @returns {Promise<object|null>} StaffInvite doc or null
 */
async function findValidInvite(rawToken) {
  if (!rawToken) return null;
  const invite = await StaffInvite.findOne({ tokenHash: hashToken(rawToken) });
  if (!invite) return null;
  if (invite.acceptedAt) return null;          // already used
  if (invite.expiresAt < new Date()) return null; // expired
  return invite;
}

/**
 * @route   GET /api/v1/join/validate?token=RAW
 * @desc    Validate an invite token and return the business name + email.
 * @access  Public
 */
exports.validateInvite = async (req, res, next) => {
  try {
    const invite = await findValidInvite(req.query.token);
    if (!invite) {
      return res.status(400).json({ success: false, message: 'This invite is invalid or has expired.', request_id: req.id });
    }
    const business = await Business.findById(invite.businessId).select('name');
    res.status(200).json({
      success: true,
      data: { valid: true, businessName: business?.name || 'a team', email: invite.email },
    });
  } catch (err) {
    logger.error('Error in validateInvite:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/join/accept
 * @desc    Accept an invite — create/link a User, mark staff active, issue a session.
 * @access  Public
 */
exports.acceptInvite = async (req, res, next) => {
  try {
    const { token, password, name } = req.body;

    const invite = await findValidInvite(token);
    if (!invite) {
      return res.status(400).json({ success: false, message: 'This invite is invalid or has expired.', request_id: req.id });
    }

    const staff = await StaffMember.findOne({ _id: invite.staffId, businessId: invite.businessId });
    if (!staff || !staff.isActive) {
      return res.status(400).json({ success: false, message: 'This staff record is no longer available.', request_id: req.id });
    }
    if (staff.accountStatus === 'active' && staff.userId) {
      return res.status(409).json({ success: false, message: 'You have already joined. Please log in.', request_id: req.id });
    }

    // Find or create the User. Email-match fallback: if a user already exists
    // with the invite email, link it instead of creating a duplicate.
    let user = await User.findOne({ email: invite.email });
    if (!user) {
      if (!password) {
        return res.status(422).json({ success: false, code: 'validation_failed', message: 'Password is required to create your account.', request_id: req.id });
      }
      user = await User.create({
        email: invite.email,
        password,                 // hashed by the User pre-save hook
        name: name || staff.name,
        isVerified: true,         // accepting an emailed invite proves email ownership
        provider: 'local',
      });
    }

    // Link the staff record to the user account
    staff.userId = user._id;
    staff.accountStatus = 'active';
    staff.joinedAt = new Date();
    await staff.save();

    // Burn the invite
    invite.acceptedAt = new Date();
    await invite.save();

    // Issue a session (mirrors login)
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, false);
    user.refreshTokens.push({
      tokenHash: hashToken(refreshToken),
      createdAt: new Date(),
      deviceInfo: req.headers['user-agent'] || 'unknown',
      rememberMe: false,
    });
    user.lastAuthAt = new Date();
    await user.save();

    const isWebClient = req.body.clientType === 'web' || req.body.source === 'web';
    if (isWebClient) {
      res.cookie('spinx_refresh', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }

    logger.info(`Staff ${staff._id} joined business ${invite.businessId}`);

    res.status(200).json({
      success: true,
      accessToken,
      ...(isWebClient ? {} : { refreshToken }),
      user: { id: user._id, email: user.email, role: user.role, isVerified: user.isVerified },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Account already exists. Please log in.', request_id: req.id });
    }
    logger.error('Error in acceptInvite:', err);
    next(err);
  }
};

/**
 * @route   POST /api/v1/join/complete-profile
 * @desc    Staff fills in their own profile details after joining.
 * @access  Private (staff — uses req.staffMember from resolveBusiness)
 */
exports.completeProfile = async (req, res, next) => {
  try {
    if (req.membership !== 'staff' || !req.staffMember) {
      return res.status(403).json({ success: false, message: 'Only staff can complete a staff profile.', request_id: req.id });
    }
    const staff = req.staffMember;
    const { phone } = req.body;
    if (phone !== undefined) staff.phone = phone;
    await staff.save();
    res.status(200).json({ success: true, data: staff });
  } catch (err) {
    logger.error('Error in completeProfile:', err);
    next(err);
  }
};
