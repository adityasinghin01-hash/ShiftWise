// middleware/csrfMiddleware.js
// CSRF protection for cookie-based auth flow using stateless double-submit pattern.
// SECURITY.md §5

const crypto = require('crypto');
const config = require('../config/config');
const logger = require('../config/logger');

// SECURITY.md §7: cryptographic key separation — CSRF_SECRET must be independent of JWT secrets.
// If JWT_ACCESS_SECRET is shared here, a JWT compromise also breaks CSRF protection.
const CSRF_SECRET = config.CSRF_SECRET;
if (!CSRF_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: CSRF_SECRET must be set in production');
  } else {
    // Development only — warn loudly, use a random value per startup (not reused)
    logger.warn('CSRF_SECRET not set — using random ephemeral secret (dev only)');
  }
}
const _CSRF_SECRET = CSRF_SECRET || require('crypto').randomBytes(32).toString('hex');

/**
 * Generate CSRF token: HMAC-SHA256(userId, CSRF_SECRET, timestamp truncated to hour)
 */
function generateCsrfToken(userId) {
  const hourTimestamp = Math.floor(Date.now() / 3600000); // truncate to hour
  const data = `${userId}:${hourTimestamp}`;
  return crypto.createHmac('sha256', _CSRF_SECRET).update(data).digest('hex');
}

/**
 * Verify CSRF token — accepts current hour or previous hour (grace window)
 */
function verifyCsrfToken(token, userId) {
  const currentHour = Math.floor(Date.now() / 3600000);
  const currentToken = crypto
    .createHmac('sha256', _CSRF_SECRET)
    .update(`${userId}:${currentHour}`)
    .digest('hex');
  const prevToken = crypto
    .createHmac('sha256', _CSRF_SECRET)
    .update(`${userId}:${currentHour - 1}`)
    .digest('hex');
  const buf = Buffer.from(token);
  const bufCurrent = Buffer.from(currentToken);
  const bufPrev = Buffer.from(prevToken);
  // timingSafeEqual throws if buffers differ in length — guard first
  return (
    (buf.length === bufCurrent.length && crypto.timingSafeEqual(buf, bufCurrent)) ||
    (buf.length === bufPrev.length && crypto.timingSafeEqual(buf, bufPrev))
  );
}

/**
 * CSRF middleware — only enforces for cookie-based auth on state-changing requests
 */
const csrfMiddleware = (req, res, next) => {
  // Skip non-mutating methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip if no cookie (bearer-only request)
  if (!req.cookies?.shiftwise_refresh) {
    return next();
  }

  // Skip bootstrap routes
  const skipPaths = ['/api/v1/refresh-token', '/api/health', '/api/v1/csrf-token'];
  if (skipPaths.some((p) => req.path === p || req.originalUrl === p)) {
    return next();
  }

  // Require CSRF token for cookie-based mutating requests
  const csrfToken = req.headers['x-csrf-token'];
  if (!csrfToken) {
    return res.status(403).json({ code: 'csrf_required', message: 'CSRF token required' });
  }

  // We need userId from JWT — it's set by protect() middleware
  // If user isn't authenticated yet, skip CSRF (auth will fail anyway)
  if (!req.user?._id) {
    return next();
  }

  if (!verifyCsrfToken(csrfToken, req.user._id.toString())) {
    return res.status(403).json({ code: 'csrf_invalid', message: 'Invalid CSRF token' });
  }

  next();
};

/**
 * GET /api/v1/csrf-token — returns CSRF token for web clients
 */
const getCsrfToken = (req, res) => {
  if (!req.user?._id) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  const csrfToken = generateCsrfToken(req.user._id.toString());
  return res.status(200).json({ success: true, csrfToken });
};

module.exports = { csrfMiddleware, getCsrfToken, generateCsrfToken };
