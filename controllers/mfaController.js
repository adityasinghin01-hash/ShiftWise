// controllers/mfaController.js
// TOTP MFA — setup, verify-setup, disable, backup-codes, mfa-login.
// AUTH_PATTERNS.md §7.1

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const User = require('../models/User');
const config = require('../config/config');
const { generateAccessToken, generateRefreshToken } = require('../services/tokenService');
const hashToken = require('../utils/hashToken');
const logger = require('../config/logger');

// ── AES-256-GCM helpers ───────────────────────────────────
const getKey = () => {
  const hex = config.MFA_SECRET;
  if (!hex || hex.length < 64) throw new Error('MFA_SECRET not configured');
  return Buffer.from(hex.slice(0, 64), 'hex');
};

const encryptMfaSecret = (rawSecret) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = cipher.update(rawSecret, 'utf8', 'hex') + cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
};

const decryptMfaSecret = (encryptedSecret) => {
  const [ivHex, authTagHex, ciphertext] = encryptedSecret.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
};

const BACKUP_CODE_COUNT = 8;

// ── POST /api/v1/mfa/setup ────────────────────────────────
// Generates a TOTP secret, returns QR code. Does NOT enable MFA yet.
const setup = async (req, res, next) => {
  try {
    if (req.user.mfaEnabled) {
      return res.status(400).json({ message: 'MFA is already enabled' });
    }

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.user.email, 'ShiftWise', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    // Store encrypted secret (pending — not yet active)
    const user = await User.findById(req.user._id);
    user.mfaSecret = encryptMfaSecret(secret);
    await user.save();

    return res.status(200).json({
      success: true,
      qrCode: qrCodeDataUrl,
      secret, // also return raw secret for manual entry
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/mfa/verify-setup ────────────────────────
// Verifies TOTP code, activates MFA, returns single-use backup codes.
const verifySetup = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'TOTP code required' });

    const user = await User.findById(req.user._id).select('+mfaSecret');
    if (!user.mfaSecret) return res.status(400).json({ message: 'MFA setup not initiated' });

    const rawSecret = decryptMfaSecret(user.mfaSecret);
    if (!authenticator.verify({ token, secret: rawSecret })) {
      return res.status(400).json({ message: 'Invalid TOTP code' });
    }

    // Generate backup codes
    const rawCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      crypto.randomBytes(4).toString('hex')
    );
    user.backupCodes = rawCodes.map((c) => ({ codeHash: hashToken(c) }));
    user.mfaEnabled = true;
    await user.save();

    logger.info('MFA enabled', { userId: user._id });

    return res.status(200).json({
      success: true,
      message: 'MFA enabled successfully',
      backupCodes: rawCodes, // shown ONCE
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/mfa/disable ──────────────────────────────
// Disables MFA. Requires current TOTP or backup code.
const disable = async (req, res, next) => {
  try {
    const { token, backupCode } = req.body;
    const user = await User.findById(req.user._id).select('+mfaSecret');

    if (!user.mfaEnabled) return res.status(400).json({ message: 'MFA is not enabled' });

    let verified = false;
    if (token) {
      const rawSecret = decryptMfaSecret(user.mfaSecret);
      verified = authenticator.verify({ token, secret: rawSecret });
    } else if (backupCode) {
      const hash = hashToken(backupCode);
      const match = user.backupCodes.find((c) => !c.usedAt && c.codeHash === hash);
      if (match) {
        match.usedAt = new Date();
        verified = true;
      }
    }

    if (!verified) return res.status(400).json({ message: 'Invalid TOTP code or backup code' });

    user.mfaEnabled = false;
    user.mfaSecret = undefined;
    user.backupCodes = [];
    await user.save();

    logger.info('MFA disabled', { userId: user._id });
    return res.status(200).json({ success: true, message: 'MFA disabled' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/mfa/backup-codes ────────────────────────
// Regenerates backup codes (requires step-up auth via requireRecentAuth).
const regenerateBackupCodes = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.mfaEnabled) return res.status(400).json({ message: 'MFA is not enabled' });

    const rawCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      crypto.randomBytes(4).toString('hex')
    );
    user.backupCodes = rawCodes.map((c) => ({ codeHash: hashToken(c) }));
    await user.save();

    return res.status(200).json({ success: true, backupCodes: rawCodes });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/mfa/login ───────────────────────────────
// Second step of login when MFA is required.
// Accepts a short-lived mfaToken (JWT with purpose:'mfa') + TOTP or backup code.
const mfaLogin = async (req, res, next) => {
  try {
    const { mfaToken, totpCode, backupCode } = req.body;
    if (!mfaToken) return res.status(400).json({ message: 'MFA token required' });

    let decoded;
    try {
      decoded = jwt.verify(mfaToken, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ message: 'Invalid or expired MFA token' });
    }

    if (decoded.purpose !== 'mfa') {
      return res.status(401).json({ message: 'Invalid MFA token' });
    }

    const user = await User.findById(decoded.id).select('+mfaSecret');
    if (!user || !user.mfaEnabled) {
      return res.status(401).json({ message: 'Invalid MFA token' });
    }

    let verified = false;
    if (totpCode) {
      const rawSecret = decryptMfaSecret(user.mfaSecret);
      verified = authenticator.verify({ token: totpCode, secret: rawSecret });
    } else if (backupCode) {
      const hash = hashToken(backupCode);
      const match = user.backupCodes.find((c) => !c.usedAt && c.codeHash === hash);
      if (match) {
        match.usedAt = new Date();
        verified = true;
      }
    }

    if (!verified) return res.status(401).json({ message: 'Invalid TOTP code or backup code' });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, decoded.rememberMe || false);

    user.lastAuthAt = new Date();
    user.refreshTokens.push({
      tokenHash: hashToken(refreshToken),
      createdAt: new Date(),
      deviceInfo: req.headers['user-agent'] || 'unknown',
      rememberMe: !!decoded.rememberMe,
    });
    await user.save();

    const isWebClient = decoded.clientType === 'web';
    if (isWebClient) {
      const maxAge = decoded.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      res.cookie('shiftwise_refresh', refreshToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge,
        path: '/',
      });
    }

    return res.status(200).json({
      success: true,
      accessToken,
      ...(isWebClient ? {} : { refreshToken }),
      user: { id: user._id, email: user.email, role: user.role, isVerified: user.isVerified },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  setup,
  verifySetup,
  disable,
  regenerateBackupCodes,
  mfaLogin,
  decryptMfaSecret,
  encryptMfaSecret,
};
