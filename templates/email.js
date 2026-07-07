'use strict';

// ── Shared design tokens ──────────────────────────────
const BRAND = {
  primary:   '#2d6e1f',
  green:     '#4ea864',
  greenLight:'#7ec8a0',
  bg:        '#08080f',
  surface:   '#0d0d18',
  card:      '#111120',
  text:      '#f0e4c8',
  textMuted: '#8a7e68',
  border:    'rgba(78,168,100,0.18)',
  name:      'ShiftWise',
  tagline:   'Smart Team Scheduling',
};

// ── Clock logo SVG ────────────────────────────────────
const logo = `
<table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
  <tr>
    <td style="vertical-align:middle;padding-right:12px">
      <div style="width:42px;height:42px;border-radius:50%;border:1.5px solid ${BRAND.green};background:rgba(45,110,31,0.12);display:flex;align-items:center;justify-content:center;text-align:center;line-height:42px;font-size:20px">🕐</div>
    </td>
    <td style="vertical-align:middle">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:${BRAND.text};letter-spacing:0.04em">${BRAND.name}</span>
    </td>
  </tr>
</table>`;

// ── Base wrapper ──────────────────────────────────────
const base = ({ title, preview, body, footer }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:'Inter',Arial,sans-serif;-webkit-font-smoothing:antialiased">

  <!-- Preview text (hidden, shows in inbox) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preview}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;</div>

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};min-height:100vh">
    <tr>
      <td align="center" style="padding:48px 16px">

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${BRAND.card};border-radius:16px;border:1px solid ${BRAND.border};overflow:hidden">

          <!-- Top accent bar -->
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,${BRAND.primary},${BRAND.green},${BRAND.greenLight})"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:48px 48px 40px">
              ${logo}
              ${body}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 48px"><div style="height:1px;background:${BRAND.border}"></div></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 48px 32px;text-align:center">
              <p style="margin:0 0 8px;font-size:12px;color:${BRAND.textMuted};line-height:1.6">${footer || 'You received this email because you have an account with ' + BRAND.name + '.'}</p>
              <p style="margin:0;font-size:12px;color:${BRAND.textMuted}">
                <span style="color:${BRAND.greenLight}">${BRAND.name}</span> &nbsp;·&nbsp; ${BRAND.tagline}
              </p>
            </td>
          </tr>

        </table>
        <!-- End card -->

      </td>
    </tr>
  </table>

</body>
</html>`;

// ── Shared CTA button ─────────────────────────────────
const ctaBtn = (text, url) =>
  `<table cellpadding="0" cellspacing="0" style="margin:32px auto">
    <tr>
      <td style="border-radius:8px;background:linear-gradient(135deg,${BRAND.primary},${BRAND.green});box-shadow:0 4px 20px rgba(45,110,31,0.35)">
        <a href="${url}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:'Inter',Arial,sans-serif;font-size:15px;font-weight:600;color:#f0e4c8;text-decoration:none;letter-spacing:0.04em;white-space:nowrap">${text}</a>
      </td>
    </tr>
  </table>`;

// ── Shared heading ────────────────────────────────────
const heading = (text) =>
  `<h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${BRAND.text};line-height:1.2;letter-spacing:-0.01em">${text}</h1>`;

// ── Shared paragraph ──────────────────────────────────
const para = (text) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#b8a98a">${text}</p>`;

// ── OTP code display ──────────────────────────────────
const otpBox = (code) =>
  `<table cellpadding="0" cellspacing="0" style="margin:28px auto">
    <tr>
      <td style="background:rgba(45,110,31,0.1);border:1px solid rgba(78,168,100,0.3);border-radius:12px;padding:20px 48px;text-align:center">
        <span style="font-family:'Courier New',monospace;font-size:38px;font-weight:700;color:${BRAND.greenLight};letter-spacing:10px">${code}</span>
        <p style="margin:8px 0 0;font-size:12px;color:${BRAND.textMuted}">Expires in 15 minutes</p>
      </td>
    </tr>
  </table>`;

// ── Small info note ───────────────────────────────────
const note = (text) =>
  `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:${BRAND.textMuted};padding:14px 18px;background:rgba(255,255,255,0.03);border-left:2px solid rgba(78,168,100,0.3);border-radius:0 6px 6px 0">${text}</p>`;

// ── Templates ─────────────────────────────────────────
const templates = {

  verificationEmail: ({ verificationUrl }) =>
    base({
      title: 'Verify your email — ShiftWise',
      preview: 'You\'re one step away. Verify your email to activate your ShiftWise account.',
      body: `
        ${heading('Confirm your email address')}
        ${para('Welcome to ShiftWise. To activate your account and start building smarter schedules, please verify your email address.')}
        ${para('This link is valid for <strong style="color:${BRAND.text}">24 hours</strong>.')}
        ${ctaBtn('Verify Email Address', verificationUrl)}
        ${note('If you did not create a ShiftWise account, you can safely ignore this email. No action is required.')}
      `,
      footer: 'This verification email was sent to confirm your ShiftWise account.',
    }),

  passwordResetEmail: ({ resetUrl }) =>
    base({
      title: 'Reset your password — ShiftWise',
      preview: 'We received a request to reset your ShiftWise password.',
      body: `
        ${heading('Reset your password')}
        ${para('We received a request to reset the password for your ShiftWise account. Click the button below to choose a new password.')}
        ${para('This link expires in <strong style="color:${BRAND.text}">15 minutes</strong> for your security.')}
        ${ctaBtn('Reset Password', resetUrl)}
        ${note('If you did not request a password reset, please ignore this email. Your password will remain unchanged and your account is secure.')}
      `,
      footer: 'You received this because a password reset was requested for your ShiftWise account.',
    }),

  otpEmail: ({ otp }) =>
    base({
      title: 'Your reset code — ShiftWise',
      preview: `Your ShiftWise verification code is ${otp}`,
      body: `
        ${heading('Your verification code')}
        ${para('Use the code below to reset your ShiftWise password. Enter it in the app within the next 15 minutes.')}
        ${otpBox(otp)}
        ${note('If you did not request this code, please ignore this email. Your account has not been changed.')}
      `,
      footer: 'This code was requested for your ShiftWise account.',
    }),

  // ── Staff invite (Phase 2) ──────────────────────────
  inviteEmail: ({ inviteUrl, businessName, inviterName }) =>
    base({
      title: `You're invited to ${businessName} — ShiftWise`,
      preview: `${inviterName || 'Your manager'} invited you to join ${businessName} on ShiftWise.`,
      body: `
        ${heading('You\'ve been invited')}
        ${para(`${inviterName ? '<strong style="color:' + BRAND.text + '">' + inviterName + '</strong>' : 'Your manager'} has invited you to join <strong style="color:${BRAND.text}">${businessName}</strong> on ShiftWise.`)}
        ${para('Accept the invite to set up your account, share your availability, and see your shifts — all in one place.')}
        ${para('This invite is valid for <strong style="color:' + BRAND.text + '">7 days</strong>.')}
        ${ctaBtn('Accept Invite', inviteUrl)}
        ${note('If you weren\'t expecting this invitation, you can safely ignore this email.')}
      `,
      footer: `You received this because ${businessName} invited you to ShiftWise.`,
    }),

  // ── Emergency shift notification (Phase 2/3) ────────
  emergencyShiftEmail: ({ staffName, businessName, message, shiftsHtml }) =>
    base({
      title: `Shift update — ${businessName}`,
      preview: message ? message.slice(0, 90) : `An important shift update from ${businessName}.`,
      body: `
        ${heading('Shift update')}
        ${para(`Hi ${staffName || 'there'}, you have an important update from <strong style="color:${BRAND.text}">${businessName}</strong>.`)}
        ${message ? para(message) : ''}
        ${shiftsHtml || ''}
        ${note('Please contact your manager directly if you have any questions about this shift.')}
      `,
      footer: `Sent by ${businessName} via ShiftWise.`,
    }),

  emailVerifiedWeb: () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Email Verified — ShiftWise</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#08080f; color:#f0e4c8; font-family:'Inter',Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#111120; border:1px solid rgba(78,168,100,0.2); border-radius:20px; padding:56px 40px; text-align:center; max-width:440px; width:90%; }
    .icon { font-size:56px; margin-bottom:20px; }
    h1 { font-family:Georgia,serif; font-size:26px; font-weight:700; margin-bottom:10px; }
    p { font-size:15px; line-height:1.7; color:#8a7e68; margin-bottom:0; }
    .badge { display:inline-block; margin-bottom:28px; padding:6px 18px; background:rgba(45,110,31,0.15); border:1px solid rgba(78,168,100,0.3); border-radius:999px; font-size:12px; color:#7ec8a0; letter-spacing:0.08em; text-transform:uppercase; }
    #msg { margin-top:16px; font-size:13px; color:#4ea864; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <div class="badge">ShiftWise</div>
    <h1>Email Verified</h1>
    <p>Your account is now active. You can close this tab and sign in to ShiftWise.</p>
    <p id="msg">Closing this tab automatically...</p>
  </div>
  <script>setTimeout(function(){window.close();setTimeout(function(){document.getElementById('msg').textContent='You can close this tab.'},500)},1400)</script>
</body>
</html>`,

  emailVerifiedApp: () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Email Verified — ShiftWise</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#08080f; color:#f0e4c8; font-family:'Inter',Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#111120; border:1px solid rgba(78,168,100,0.2); border-radius:20px; padding:56px 40px; text-align:center; max-width:440px; width:90%; }
    .icon { font-size:56px; margin-bottom:20px; }
    h1 { font-family:Georgia,serif; font-size:26px; font-weight:700; margin-bottom:10px; }
    p { font-size:15px; line-height:1.7; color:#8a7e68; margin-bottom:28px; }
    .btn { display:inline-block; padding:15px 36px; border-radius:8px; background:linear-gradient(135deg,#2d6e1f,#4ea864); color:#f0e4c8; font-weight:600; font-size:15px; text-decoration:none; letter-spacing:0.03em; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Email Verified</h1>
    <p>Your ShiftWise account is ready. Return to the app to sign in and start scheduling.</p>
    <a href="shiftwise://dashboard" class="btn">Open ShiftWise</a>
  </div>
</body>
</html>`,

  verificationExpired: () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Link Expired — ShiftWise</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#08080f; color:#f0e4c8; font-family:'Inter',Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#111120; border:1px solid rgba(239,68,68,0.2); border-radius:20px; padding:56px 40px; text-align:center; max-width:440px; width:90%; }
    .icon { font-size:56px; margin-bottom:20px; }
    h1 { font-family:Georgia,serif; font-size:26px; font-weight:700; margin-bottom:10px; }
    p { font-size:15px; line-height:1.7; color:#8a7e68; margin-bottom:28px; }
    .btn { display:inline-block; padding:15px 36px; border-radius:8px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; font-weight:600; font-size:15px; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⏰</div>
    <h1>Link Expired</h1>
    <p>This link has expired or is no longer valid. Please return to ShiftWise and request a new one.</p>
    <a href="shiftwise://resend-verification" class="btn">Request New Link</a>
  </div>
</body>
</html>`,
};

module.exports = templates;
