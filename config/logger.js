// config/logger.js
// Central Winston logger — single source of truth for all logging.
// Console transport (dev: colorized, prod: JSON).
// File transports with daily rotation and 14-day retention.

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// ── Sensitive field redaction ────────────────────────────
// BACKEND_PATTERNS.md §10.4: never log raw secrets, tokens, or passwords.
const REDACTED = '[REDACTED]';
const redactFormat = winston.format((info) => {
  const sensitiveKeys = [
    'password',
    'token',
    'refreshToken',
    'accessToken',
    'authorization',
    'x-api-key',
    'apiKey',
    'secret',
    'otp',
    'resetToken',
    'verificationToken',
  ];
  const redact = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key of Object.keys(obj)) {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
        obj[key] = REDACTED;
      } else if (typeof obj[key] === 'object') {
        redact(obj[key]);
      }
    }
    return obj;
  };
  redact(info);
  return info;
});
const devFormat = winston.format.combine(
  redactFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const rid = requestId ? ` [${requestId}]` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]${rid}: ${message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  redactFormat(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ── Transports ───────────────────────────────────────────
const transports = [
  // Console — always active
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  }),
];

// File transports — production only (no log files cluttering dev)
if (process.env.NODE_ENV === 'production') {
  // Combined log — all levels info and above
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
      format: prodFormat,
    })
  );

  // Error log — errors only
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      level: 'error',
      format: prodFormat,
    })
  );
}

// ── Logger Instance ──────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  // M10 FIX: Match package.json "name" so log aggregators filter consistently.
  defaultMeta: { service: 'shiftwise-backend' },
  transports,
  // Don't crash the app if logging fails
  exitOnError: false,
});

module.exports = logger;
