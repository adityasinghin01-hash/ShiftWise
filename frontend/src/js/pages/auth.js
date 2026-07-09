/* ── SHIFTWISE AUTH PAGES (Login / Signup / Forgot / Verify) ── */
/* reCAPTCHA v2 on Signup · Google Identity Services on Login + Signup    */

import { auth, authApi, mfaApi } from '../api.js';
import { store } from '../store.js';
import { toast } from '../toast.js';
import { navigate } from '../router.js';

/* ── Config: populated from Vite env vars set in .env or Render dashboard ── */
const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_RECAPTCHA_SITE_KEY || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'; // Google public test key (always passes)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

/* appEl is lazy so it resolves after the DOM is ready */
const getApp = () => document.getElementById('app');

/* ── LOGO SVG snippet ── */
const logoSVG = `
  <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
    <rect width="48" height="48" rx="24" fill="rgba(45,110,31,0.2)" stroke="rgba(78,168,100,0.5)" stroke-width="1.5"/>
    <circle cx="24" cy="24" r="10" stroke="#4ea864" stroke-width="1.5" fill="none"/>
    <line x1="24" y1="24" x2="24" y2="16" stroke="#4ea864" stroke-width="2" stroke-linecap="round"/>
    <line x1="24" y1="24" x2="30" y2="27" stroke="#4ea864" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="24" cy="24" r="1.5" fill="#4ea864"/>
  </svg>
`;

/* ── Google SVG logo ── */
const googleSVG = `
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    <path fill="none" d="M0 0h48v48H0z"/>
  </svg>
`;

/* ── Shared: handle Google credential response — LOGIN ── */
async function handleGoogleCredential(credentialResponse) {
  try {
    const res = await authApi.googleLogin({ idToken: credentialResponse.credential });
    const { accessToken, user } = res;
    auth.setToken(accessToken);
    store.save(user);
    toast(`Welcome, ${store.name}!`, 'success');
    navigate('dashboard');
  } catch (err) {
    if (err.status === 401) {
      toast('No account found. Please sign up first.', 'error');
      navigate('signup');
    } else {
      toast(err.message || 'Google sign-in failed', 'error');
    }
  }
}

/* ── Shared: handle Google credential response — SIGNUP ── */
async function handleGoogleSignup(credentialResponse) {
  try {
    const res = await authApi.googleSignup({ idToken: credentialResponse.credential });
    const { accessToken, user } = res;
    auth.setToken(accessToken);
    store.save(user);
    toast(`Welcome, ${store.name}!`, 'success');
    navigate('dashboard');
  } catch (err) {
    if (err.status === 401) {
      toast('Account already exists. Please log in.', 'error');
      navigate('login');
    } else {
      toast(err.message || 'Google sign-up failed', 'error');
    }
  }
}

/* ── GIS initialiser — retries until library loads ── */
// ux_mode: 'redirect' — no popup needed. Google redirects the full page to
// accounts.google.com, user picks account, then redirects back with the
// credential. Works in Safari/Firefox where popups are blocked.
function mountGISButton(containerId, callback) {
  if (!GOOGLE_CLIENT_ID) return;
  const tryMount = () => {
    if (window.google?.accounts?.id) {
      // Re-initialize on every mount so the callback always points to the
      // current handler and the button renders into the current DOM node.
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: callback || handleGoogleCredential,
        ux_mode: 'popup', // popup avoids losing hash-route on redirect
      });
      const el = document.getElementById(containerId);
      if (el) {
        window.google.accounts.id.renderButton(el, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          width: Math.min(el.offsetWidth || 340, 400),
          logo_alignment: 'left',
        });
      }
    } else {
      setTimeout(tryMount, 150);
    }
  };
  tryMount();
}

/* ── Render reCAPTCHA v2 widget (dark theme) — returns Promise<widgetId> ── */
function renderRecaptcha(containerId) {
  return new Promise((resolve) => {
    let attempts = 0;
    const tryRender = () => {
      if (window.grecaptcha?.render) {
        try {
          const id = window.grecaptcha.render(containerId, {
            sitekey: RECAPTCHA_SITE_KEY,
            theme: 'dark',
            size: 'normal',
          });
          resolve(id);
        } catch (e) {
          /* Already rendered — just get the existing response container */
          resolve(0);
        }
      } else if (attempts++ < 20) {
        setTimeout(tryRender, 200);
      } else {
        // grecaptcha never loaded (script blocked/offline). Resolve anyway so the
        // submit handler STILL attaches — otherwise the button would be dead.
        resolve(null);
      }
    };
    tryRender();
  });
}

/* ── MFA Challenge screen ── */
function showMfaChallenge(mfaToken) {
  getApp().innerHTML = `
  <div class="auth-wrap">
    <div class="auth-blob b1"></div>
    <div class="auth-blob b2"></div>
    <div class="auth-card">
      <div class="auth-logo">${logoSVG}<span>ShiftWise</span></div>
      <h1 class="auth-title">Two-Factor Authentication</h1>
      <p class="auth-subtitle">Enter the 6-digit code from your authenticator app</p>
      <form id="mfa-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="mfa-code">Authentication Code</label>
          <input class="form-input" type="text" id="mfa-code" placeholder="000000" maxlength="8" inputmode="numeric" autocomplete="one-time-code" />
          <span class="form-hint">Or enter a backup code</span>
        </div>
        <div id="mfa-error" class="form-error" style="display:none"></div>
        <button class="btn btn-primary w-full btn-lg" id="mfa-btn" type="submit">Verify</button>
      </form>
      <div class="auth-footer"><a class="auth-link" href="#login">← Back to Login</a></div>
    </div>
  </div>`;

  document.getElementById('mfa-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('mfa-code').value.trim();
    const errEl = document.getElementById('mfa-error');
    const btn = document.getElementById('mfa-btn');
    errEl.style.display = 'none';
    btn.classList.add('btn-loading');
    btn.disabled = true;
    try {
      const body = code.length <= 6 ? { mfaToken, totpCode: code } : { mfaToken, backupCode: code };
      const res = await mfaApi.mfaLogin(body);
      auth.setToken(res.accessToken);
      if (res.refreshToken) sessionStorage.setItem('shiftwise_refresh', res.refreshToken);
      store.save(res.user);
      toast(`Welcome back, ${store.name}!`, 'success');
      navigate('dashboard');
    } catch (err) {
      errEl.textContent = err.message || 'Invalid code';
      errEl.style.display = 'flex';
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });
}

/* ─────────────── LOGIN ─────────────── */
let _loginRecaptchaWidgetId = null;

function renderLogin() {
  getApp().innerHTML = `
  <div class="auth-wrap">
    <div class="auth-blob b1"></div>
    <div class="auth-blob b2"></div>
    <div class="auth-card">
      <div class="auth-logo">${logoSVG}<span>ShiftWise</span></div>
      <h1 class="auth-title">Welcome back</h1>
      <p class="auth-subtitle">Sign in to your account to continue</p>

      <div id="gis-login-btn" style="display:flex;justify-content:center;margin-bottom:16px"></div>
      <div class="auth-divider"><span>or continue with email</span></div>

      <form id="login-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="login-email">Email</label>
          <input class="form-input" type="email" id="login-email" placeholder="you@example.com" autocomplete="email" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="login-password">
            Password
            <a class="auth-link" href="#forgot-password" style="float:right;font-weight:500">Forgot?</a>
          </label>
          <input class="form-input" type="password" id="login-password" placeholder="••••••••" autocomplete="current-password" required />
        </div>

        <!-- F1 FIX: reCAPTCHA v2 widget — backend requires recaptchaToken on /login since Wave 1 H1 -->
        <div class="recaptcha-wrapper">
          <div id="login-recaptcha-container"></div>
          <div id="login-recaptcha-error" class="recaptcha-error" style="display:none">
            ⚠ Please complete the reCAPTCHA
          </div>
        </div>

        <div id="login-error" class="form-error" style="display:none"></div>

        <!-- F2 FIX: resend-verification recovery link, hidden until a 401 surfaces. -->
        <div id="login-resend-block" style="display:none;margin-top:-8px;margin-bottom:12px;font-size:0.85rem;color:var(--text-muted)">
          Need to verify your email?
          <a href="#" id="login-resend-link" class="auth-link" style="font-weight:500">Resend verification</a>
        </div>

        <button class="btn btn-primary w-full btn-lg" id="login-btn" type="submit">Sign In</button>
      </form>

      <div class="auth-footer">
        Don't have an account? <a class="auth-link" href="#signup">Sign up free</a>
      </div>
    </div>
  </div>`;

  /* F1 FIX: render reCAPTCHA on login */
  _loginRecaptchaWidgetId = null;
  renderRecaptcha('login-recaptcha-container').then((id) => {
    _loginRecaptchaWidgetId = id;
  });

  mountGISButton('gis-login-btn', handleGoogleCredential);

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const capErrEl = document.getElementById('login-recaptcha-error');
    const resendBlock = document.getElementById('login-resend-block');
    const btn = document.getElementById('login-btn');

    errEl.style.display = 'none';
    capErrEl.style.display = 'none';
    resendBlock.style.display = 'none';

    /* F1 FIX: collect reCAPTCHA token (backend requires it since Wave 1 H1). */
    let recaptchaToken = '';
    if (window.grecaptcha) {
      recaptchaToken =
        _loginRecaptchaWidgetId !== null
          ? window.grecaptcha.getResponse(_loginRecaptchaWidgetId)
          : window.grecaptcha.getResponse();
    }
    // Dev-only fallback: if the widget didn't render/produce a token (blocked or
    // flaky on localhost), use the backend dev-bypass so local testing isn't
    // blocked. Production (import.meta.env.DEV === false) still requires a real token.
    if (!recaptchaToken && import.meta.env.DEV) recaptchaToken = 'dev-bypass';
    if (!recaptchaToken) {
      capErrEl.style.display = 'flex';
      return;
    }

    btn.classList.add('btn-loading');
    btn.disabled = true;

    try {
      const res = await authApi.login({ email, password, recaptchaToken, source: 'web' });

      // MFA challenge — show TOTP input instead of navigating
      if (res.mfaRequired) {
        btn.classList.remove('btn-loading');
        btn.disabled = false;
        showMfaChallenge(res.mfaToken);
        return;
      }

      const { accessToken, refreshToken, user } = res;
      auth.setToken(accessToken);
      if (refreshToken) sessionStorage.setItem('shiftwise_refresh', refreshToken);
      store.save(user);
      toast(`Welcome back, ${store.name}!`, 'success');
      navigate('dashboard');
    } catch (err) {
      errEl.textContent = err.message || 'Login failed';
      errEl.style.display = 'flex';

      /* F2 FIX: 401 may mean either wrong credentials OR unverified email.
         The backend deliberately doesn't tell us which (Wave 4 C5 fix —
         removing the enumeration oracle), so we surface the resend link
         on every 401 and let the user use it if they need to. */
      if (err.status === 401) {
        resendBlock.style.display = 'block';
      }

      /* F1 FIX: every reCAPTCHA v2 token is single-use; reset the widget
         after any submission so the user gets a fresh challenge. */
      if (window.grecaptcha && _loginRecaptchaWidgetId !== null) {
        try {
          window.grecaptcha.reset(_loginRecaptchaWidgetId);
        } catch {
          /* widget may not be ready — ignore */
        }
      }
    } finally {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });

  /* F2 FIX: resend-verification flow */
  document.getElementById('login-resend-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    if (!email) {
      toast('Enter your email above first, then click Resend.', 'error');
      return;
    }
    try {
      await authApi.resendVerification({ email });
      toast(
        'If an unverified account exists for that email, a verification link has been sent.',
        'success'
      );
    } catch (err) {
      toast(err.message || 'Could not send verification email', 'error');
    }
  });
}

/* ─────────────── SIGNUP ─────────────── */
let _signupRecaptchaWidgetId = null;

function renderSignup() {
  getApp().innerHTML = `
  <div class="auth-wrap">
    <div class="auth-blob b1"></div>
    <div class="auth-blob b2"></div>
    <div class="auth-card">
      <div class="auth-logo">${logoSVG}<span>ShiftWise</span></div>
      <h1 class="auth-title">Create account</h1>
      <p class="auth-subtitle">Start with a free plan. No credit card needed.</p>

      <div id="gis-signup-btn" style="display:flex;justify-content:center;margin-bottom:16px"></div>
      <div class="auth-divider"><span>or sign up with email</span></div>

      <form id="signup-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="su-email">Email</label>
          <input class="form-input" type="email" id="su-email" placeholder="you@example.com" autocomplete="email" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="su-name">Display Name</label>
          <input class="form-input" type="text" id="su-name" placeholder="Jane Doe" autocomplete="name" />
        </div>
        <div class="form-group">
          <label class="form-label" for="su-password">Password</label>
          <input class="form-input" type="password" id="su-password" placeholder="Min 12 chars, uppercase, number, special" autocomplete="new-password" required />
          <span class="form-hint">Min 12 chars · uppercase · number · special character</span>
        </div>

        <!-- reCAPTCHA v2 widget — rendered by JS after mount -->
        <div class="recaptcha-wrapper">
          <div id="recaptcha-container"></div>
          <div id="recaptcha-error" class="recaptcha-error" style="display:none">
            ⚠ Please complete the reCAPTCHA
          </div>
        </div>

        <div id="su-error" class="form-error" style="display:none"></div>
        <button class="btn btn-primary w-full btn-lg" id="su-btn" type="submit">Create Account</button>
      </form>

      <div class="auth-footer">
        Already have an account? <a class="auth-link" href="#login">Sign in</a>
      </div>
    </div>
  </div>`;

  /* Google Sign-Up */
  mountGISButton('gis-signup-btn', handleGoogleSignup);

  /* reCAPTCHA widget */
  _signupRecaptchaWidgetId = null;
  renderRecaptcha('recaptcha-container').then((id) => {
    _signupRecaptchaWidgetId = id;
  });

  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('su-email').value.trim();
    const name = document.getElementById('su-name').value.trim();
    const password = document.getElementById('su-password').value;
    const errEl = document.getElementById('su-error');
    const capErrEl = document.getElementById('recaptcha-error');
    const btn = document.getElementById('su-btn');

    errEl.style.display = 'none';
    capErrEl.style.display = 'none';

    /* Client-side password strength check */
    const pwRe = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{12,}$/;
    if (!pwRe.test(password)) {
      errEl.textContent = 'Password must be 12+ chars with uppercase, number and special char';
      errEl.style.display = 'flex';
      return;
    }

    /* reCAPTCHA token */
    let recaptchaToken = '';
    if (window.grecaptcha) {
      recaptchaToken =
        _signupRecaptchaWidgetId !== null
          ? window.grecaptcha.getResponse(_signupRecaptchaWidgetId)
          : window.grecaptcha.getResponse();
    }
    // Dev-only fallback (see login handler) — keeps local signup working when the
    // widget is flaky; production still requires a real token.
    if (!recaptchaToken && import.meta.env.DEV) recaptchaToken = 'dev-bypass';
    if (!recaptchaToken) {
      capErrEl.style.display = 'flex';
      return;
    }

    btn.classList.add('btn-loading');
    btn.disabled = true;

    try {
      await authApi.signup({ email, name, password, recaptchaToken, source: 'web' });
      getApp().innerHTML = `
        <div class="auth-wrap">
          <div class="auth-card" style="text-align:center">
            <div style="font-size:3rem;margin-bottom:16px">📬</div>
            <h2 class="auth-title">Check your inbox</h2>
            <p class="auth-subtitle" style="margin-bottom:24px">
              We sent a verification link to <strong>${email}</strong>
            </p>
            <p class="auth-subtitle" style="margin-bottom:24px;font-size:0.85rem;opacity:0.7">
              Didn't receive it? Check your spam folder or
              <a class="auth-link" href="#signup">try again</a>.
            </p>
            <a class="btn btn-secondary w-full" href="#login">Back to Login</a>
          </div>
        </div>`;
    } catch (err) {
      errEl.textContent = err.message || 'Signup failed';
      errEl.style.display = 'flex';
      if (window.grecaptcha && _signupRecaptchaWidgetId !== null) {
        window.grecaptcha.reset(_signupRecaptchaWidgetId);
      }
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });
}

/* ─────────────── FORGOT PASSWORD ─────────────── */
function renderForgot() {
  let savedEmail = '';

  function showEmail() {
    getApp().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-blob b1"></div>
      <div class="auth-blob b2"></div>
      <div class="auth-card">
        <div class="auth-logo">${logoSVG}<span>ShiftWise</span></div>
        <h1 class="auth-title">Reset password</h1>
        <p class="auth-subtitle">Enter your email and we'll send an OTP</p>
        <form id="forgot-form">
          <div class="form-group">
            <label class="form-label" for="fp-email">Email</label>
            <input class="form-input" type="email" id="fp-email" placeholder="you@example.com" required />
          </div>
          <div id="fp-error" class="form-error" style="display:none"></div>
          <button class="btn btn-primary w-full btn-lg" id="fp-btn">Send OTP</button>
        </form>
        <div class="auth-footer"><a class="auth-link" href="#login">← Back to Login</a></div>
      </div>
    </div>`;

    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('fp-email').value.trim();
      const errEl = document.getElementById('fp-error');
      const btn = document.getElementById('fp-btn');
      errEl.style.display = 'none';
      btn.classList.add('btn-loading');
      btn.disabled = true;
      try {
        await authApi.sendOtp({ email });
        savedEmail = email;
        showOtp();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'flex';
        btn.classList.remove('btn-loading');
        btn.disabled = false;
      }
    });
  }

  function showOtp() {
    getApp().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-blob b1"></div>
      <div class="auth-card">
        <div class="auth-logo">${logoSVG}<span>ShiftWise</span></div>
        <h1 class="auth-title">Enter OTP</h1>
        <p class="auth-subtitle">We sent a 6-digit code to <strong>${savedEmail}</strong></p>
        <form id="otp-form">
          <div class="form-group">
            <label class="form-label" for="otp-code">OTP Code</label>
            <input class="form-input" type="text" id="otp-code" placeholder="123456" maxlength="6" inputmode="numeric" required />
          </div>
          <div id="otp-error" class="form-error" style="display:none"></div>
          <button class="btn btn-primary w-full btn-lg" id="otp-btn">Verify OTP</button>
        </form>
        <div class="auth-footer">
          <a class="auth-link" href="#forgot-password">← Change email</a>
        </div>
      </div>
    </div>`;

    document.getElementById('otp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = document.getElementById('otp-code').value.trim();
      const errEl = document.getElementById('otp-error');
      const btn = document.getElementById('otp-btn');
      errEl.style.display = 'none';
      btn.classList.add('btn-loading');
      btn.disabled = true;
      try {
        const res = await authApi.verifyOtp({ email: savedEmail, otp });
        showReset(res.resetToken);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'flex';
        btn.classList.remove('btn-loading');
        btn.disabled = false;
      }
    });
  }

  function showReset(resetToken) {
    getApp().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-blob b1"></div>
      <div class="auth-card">
        <div class="auth-logo">${logoSVG}<span>ShiftWise</span></div>
        <h1 class="auth-title">New password</h1>
        <p class="auth-subtitle">Choose a strong new password for <strong id="reset-email-display"></strong></p>
        <form id="reset-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="new-pw">New Password</label>
            <div style="position:relative">
              <input class="form-input" type="password" id="reset-pw-input" placeholder="••••••••" style="padding-right:48px" />
              <button type="button" id="toggle-pw" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.85rem">Show</button>
            </div>
            <span class="form-hint">Min 12 chars · uppercase · number · special character</span>
          </div>
          <div id="reset-error" class="form-error" style="display:none"></div>
          <button class="btn btn-primary w-full btn-lg" id="reset-btn">Reset Password</button>
        </form>
      </div>
    </div>`;

    // Set email safely via textContent — never interpolated into innerHTML (XSS prevention)
    document.getElementById('reset-email-display').textContent = savedEmail;

    document.getElementById('toggle-pw').addEventListener('click', () => {
      // Set email safely via textContent (never innerHTML) to prevent XSS
      const emailEl = document.getElementById('reset-email-display');
      if (emailEl) emailEl.textContent = savedEmail;

      const input = document.getElementById('reset-pw-input');
      const btn = document.getElementById('toggle-pw');
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    });

    document.getElementById('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPassword = document.getElementById('reset-pw-input').value;
      const errEl = document.getElementById('reset-error');
      const btn = document.getElementById('reset-btn');
      errEl.style.display = 'none';
      if (!newPassword) {
        errEl.textContent = 'Please enter a new password';
        errEl.style.display = 'flex';
        return;
      }
      btn.classList.add('btn-loading');
      btn.disabled = true;
      try {
        await authApi.resetPassword({
          token: resetToken,
          newPassword,
          confirmPassword: newPassword,
        });
        toast('Password reset! Please log in.', 'success');
        navigate('login');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'flex';
        btn.classList.remove('btn-loading');
        btn.disabled = false;
      }
    });
  }

  showEmail();
}

/* ─────────────── EMAIL VERIFY ─────────────── */
function renderVerify() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || location.hash.split('token=')[1];

  getApp().innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card" style="text-align:center">
      <div style="font-size:3rem;margin-bottom:16px">⏳</div>
      <h2 class="auth-title">Verifying email…</h2>
    </div>
  </div>`;

  if (!token) {
    getApp().innerHTML = `<div class="auth-wrap"><div class="auth-card" style="text-align:center">
      <div style="font-size:3rem">❌</div><h2 class="auth-title">Invalid link</h2>
      <a class="btn btn-secondary" href="#login" style="margin-top:16px">Back to Login</a>
    </div></div>`;
    return;
  }

  authApi
    .verifyEmail(token)
    .then(() => {
      getApp().innerHTML = `<div class="auth-wrap"><div class="auth-card" style="text-align:center">
        <div style="font-size:3rem">✅</div><h2 class="auth-title">Email verified!</h2>
        <p class="auth-subtitle" style="margin-bottom:24px">You can now sign in.</p>
        <a class="btn btn-primary w-full" href="#login">Go to Login</a>
      </div></div>`;
    })
    .catch((err) => {
      getApp().innerHTML = `<div class="auth-wrap"><div class="auth-card" style="text-align:center">
        <div style="font-size:3rem">❌</div><h2 class="auth-title">Verification failed</h2>
        <p class="auth-subtitle">${err.message}</p>
        <a class="btn btn-secondary" href="#login" style="margin-top:16px">Back to Login</a>
      </div></div>`;
    });
}

/* ─────────────── RESET PASSWORD (email link / token-based) ─────────────── */
function renderResetFromLink() {
  // Token lives in the hash query string: /#reset-password?token=abc123
  // location.hash = '#reset-password?token=abc123'
  const hashQuery = location.hash.split('?')[1] || '';
  const params = new URLSearchParams(hashQuery);
  const token = params.get('token');

  if (!token) {
    getApp().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card" style="text-align:center">
        <div style="font-size:3rem;margin-bottom:16px">❌</div>
        <h2 class="auth-title">Invalid reset link</h2>
        <p class="auth-subtitle">This link is missing a reset token. Please request a new one.</p>
        <a class="btn btn-secondary w-full" href="#forgot-password" style="margin-top:16px">Request New Link</a>
      </div>
    </div>`;
    return;
  }

  getApp().innerHTML = `
  <div class="auth-wrap">
    <div class="auth-blob b1"></div>
    <div class="auth-blob b2"></div>
    <div class="auth-card">
      <div class="auth-logo">${logoSVG}<span>ShiftWise</span></div>
      <h1 class="auth-title">Set new password</h1>
      <p class="auth-subtitle">Choose a strong new password for your account</p>
      <form id="reset-link-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="rl-new-pw">New Password</label>
          <input class="form-input" type="password" id="rl-new-pw" placeholder="••••••••" autocomplete="new-password" required />
          <span class="form-hint">Min 12 chars · uppercase · number · special character</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="rl-confirm-pw">Confirm Password</label>
          <input class="form-input" type="password" id="rl-confirm-pw" placeholder="••••••••" autocomplete="new-password" required />
        </div>
        <div id="rl-error" class="form-error" style="display:none"></div>
        <button class="btn btn-primary w-full btn-lg" id="rl-btn" type="submit">Reset Password</button>
      </form>
      <div class="auth-footer"><a class="auth-link" href="#login">← Back to Login</a></div>
    </div>
  </div>`;

  document.getElementById('reset-link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('rl-new-pw').value;
    const confirmPw = document.getElementById('rl-confirm-pw').value;
    const errEl = document.getElementById('rl-error');
    const btn = document.getElementById('rl-btn');

    errEl.style.display = 'none';

    // Client-side validation
    if (newPassword !== confirmPw) {
      errEl.textContent = 'Passwords do not match';
      errEl.style.display = 'flex';
      return;
    }

    const pwRe = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{12,}$/;
    if (!pwRe.test(newPassword)) {
      errEl.textContent = 'Password must be 12+ chars with uppercase, number and special char';
      errEl.style.display = 'flex';
      return;
    }

    btn.classList.add('btn-loading');
    btn.disabled = true;

    try {
      // Backend expects { token, newPassword } — uses the raw token from the email link
      await authApi.resetPassword({ token, newPassword });
      getApp().innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card" style="text-align:center">
          <div style="font-size:3rem;margin-bottom:16px">✅</div>
          <h2 class="auth-title">Password reset!</h2>
          <p class="auth-subtitle" style="margin-bottom:24px">Your password has been updated successfully.</p>
          <a class="btn btn-primary w-full" href="#login">Sign In</a>
        </div>
      </div>`;
    } catch (err) {
      errEl.textContent = err.message || 'Reset failed. The link may have expired.';
      errEl.style.display = 'flex';
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });
}

/* ── EXPORT ── */
export function renderAuth(view) {
  const map = {
    login: renderLogin,
    signup: renderSignup,
    forgot: renderForgot,
    verify: renderVerify,
    'reset-password': renderResetFromLink,
  };
  (map[view] || renderLogin)();
}
