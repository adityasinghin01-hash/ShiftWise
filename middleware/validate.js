// middleware/validate.js

const { body, query, validationResult } = require('express-validator');

const validate = (schemas) => [
  ...schemas,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // M1+M11 FIX: 422 Unprocessable Entity for semantic validation errors.
      // Include request_id for log correlation and machine-readable code.
      return res.status(422).json({
        success: false,
        code: 'validation_failed',
        message: errors.array()[0].msg,
        request_id: req.id,
      });
    }
    next();
  },
];

const emailField = (field = 'email') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please enter a valid email address.')
    // Keep +subaddresses (aliases) distinct — do NOT collapse user+tag@gmail.com to
    // user@gmail.com. Only lowercase/trim. Stripping the tag silently merged alias
    // signups into one account (no email sent) and broke alias logins.
    .normalizeEmail({
      gmail_remove_dots: false,
      gmail_remove_subaddress: false,
      outlook_remove_subaddress: false,
      yahoo_remove_subaddress: false,
      icloud_remove_subaddress: false,
    })
    .isLength({ max: 254 })
    .withMessage('Email is too long.');

const passwordField = (field = 'password') =>
  body(field)
    .notEmpty()
    .withMessage('Password is required.')
    .isLength({ min: 12, max: 128 })
    .withMessage('Password must be between 12 and 128 characters.');

const nameField = (field = 'name') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('Name is required.')
    .isLength({ min: 2, max: 64 })
    .withMessage('Name must be between 2 and 64 characters.')
    // H8 FIX: accept Unicode letters / marks (José, Müller, 中山, محمد, etc.)
    // plus whitespace, apostrophes, and hyphens. Old regex was ASCII-only and
    // rejected every non-English name.
    .matches(/^[\p{L}\p{M}\s'-]+$/u)
    .withMessage('Name contains invalid characters.');

const otpField = (field = 'otp') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('OTP is required.')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 digits.')
    .isNumeric()
    .withMessage('OTP must contain only digits.');

const schemas = {
  // B3 FIX (Wave 4.1): the recaptcha field is owned by the `verifyRecaptcha`
  // middleware, not by validate.js. Having both checks resulted in two
  // different status codes (422 vs 400) for the same missing-field case.
  signup: validate([nameField().optional(), emailField(), passwordField()]),
  login: validate([emailField(), passwordField()]),
  forgotPassword: validate([emailField()]),
  verifyOtp: validate([emailField(), otpField()]),
  resetPassword: validate([
    body('token').trim().notEmpty().withMessage('Reset token is required.'),
    passwordField('newPassword'),
    body('confirmPassword').notEmpty().withMessage('Please confirm your password.'),
    body('newPassword').custom((value, { req }) => {
      if (value !== req.body.confirmPassword) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),
  ]),
  refreshToken: validate([
    body('refreshToken').trim().notEmpty().withMessage('Refresh token is required.'),
  ]),
  googleLogin: validate([
    // HIGH-01 FIX: Controller reads req.body.idToken — field name unified here.
    // Previously validated 'credential' but authController destructured 'idToken',
    // causing Google login to always fail validation or always fail the controller check.
    body('idToken')
      .trim()
      .notEmpty()
      .withMessage('Google ID token is required.')
      .isLength({ min: 10, max: 2048 })
      .withMessage('Invalid Google ID token format.'),
  ]),
  verifyEmailQuery: validate([
    query('token').trim().notEmpty().withMessage('Verification token is missing.'),
  ]),
};

module.exports = { validate, schemas };
