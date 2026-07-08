// utils/passwordValidator.js
// Password strength validation per AUTH_PATTERNS.md §6.2 (NIST 2026):
//   - Min 12 chars (raised from 8)
//   - Max 72 bytes (bcrypt truncation guard)
//   - Uppercase, lowercase, number, special char
//   - Block top common passwords
//   - Block context-specific guesses (app name, email local-part)

const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 12;

// Top-50 most common passwords (covers >90% of leaked credential reuse)
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '12345',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'abc123',
  'iloveyou',
  'admin',
  'admin123',
  'letmein',
  'welcome',
  'welcome1',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  'princess',
  'shadow',
  'superman',
  'michael',
  'jessica',
  'charlie',
  'football',
  'baseball',
  'soccer',
  'hockey',
  'batman',
  'trustno1',
  'starwars',
  'hello',
  'hello123',
  'test',
  'test123',
  'pass',
  'pass123',
  'login',
  'default',
  'changeme',
  'secret',
  'root',
  'toor',
  'pass@1234',
]);

// Context words that are too guessable
const CONTEXT_WORDS = ['shiftwise', 'aditya', 'backend', 'auth', 'admin'];

/**
 * Validates password strength.
 * @param {string} password
 * @param {string} [email] - optional, to block email local-part as password
 * @returns {{ isValid: boolean, errors: string[] }}
 */
const validatePassword = (password, email = '') => {
  const errors = [];

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  } else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    errors.push(`Password is too long (max ${MAX_PASSWORD_BYTES} bytes when UTF-8 encoded)`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Only skip blocklist checks when there are length-related errors (password too short/long)
  // Run them even when other checks (uppercase, etc.) fail
  if (!errors.some((e) => /length|short|long|characters long|bytes/i.test(e))) {
    const lower = password.toLowerCase();

    // Common password blocklist
    if (COMMON_PASSWORDS.has(lower)) {
      errors.push('This password is too common. Please choose a more unique password.');
    }

    // Context guesses — app name and known context words
    for (const word of CONTEXT_WORDS) {
      if (lower.includes(word)) {
        errors.push('Password must not contain the app name or other obvious words.');
        break;
      }
    }

    // Email local-part check
    if (email) {
      const localPart = email.split('@')[0].toLowerCase();
      if (localPart.length >= 4 && lower.includes(localPart)) {
        errors.push('Password must not contain your email address.');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

module.exports = validatePassword;
