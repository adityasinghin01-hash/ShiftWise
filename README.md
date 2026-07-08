# ShiftWise

A workforce **staff-scheduling SaaS** — businesses manage locations, staff, availability,
schedules, time-off, swaps, and analytics. Built on a hardened auth/RBAC backend.

- **Backend:** Node.js (≥20) + Express 4 (CommonJS) + Mongoose 9 (MongoDB Atlas)
- **Frontend:** `frontend/` — Vite SPA (hash router, Chart.js). `landing/` — marketing site.
- **Auth:** JWT (HS256) access + rotating refresh, RBAC, MFA, reCAPTCHA, Brevo email.
- **Deploy:** Render (`render.yaml`).

The scheduling **constraint engine** (`services/schedulerService.js`) is the core: a
deterministic solver enforcing 7 hard rules (availability, time-off, double-booking,
rest, max-consecutive, incompatible pairs, role match) with fairness + reliability scoring.

---

## Quick start

```bash
# 1. Install
npm install
cd frontend && npm install && cd ..

# 2. Configure — copy the example env and fill in the values (see below)
cp .env.example .env

# 3. Seed reference + demo data
node scripts/seed-plans.js          # subscription plans (required once)
node scripts/seed-shiftwise.js      # a demo business, locations, staff, availability

# 4. Run (three processes)
npm run dev                         # backend  → http://localhost:5001
cd frontend && npm run dev          # app       → http://localhost:5173
cd landing  && npm run dev          # landing   → http://localhost:5174
```

### Required environment variables (`.env`)
| Var | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string (app) |
| `MONGO_URI_TEST` | Separate DB for the test suite |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | JWT signing |
| `CSRF_SECRET` | CSRF protection |
| `CLIENT_URL` | Frontend origin (email links, CORS) |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Transactional email |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v2 (use `dev-bypass` token in dev) |
| `UPSTASH_REDIS_REST_URL`, `..._TOKEN` | Rate limiting |
| `WEBHOOK_SECRET_KEY` | Webhook payload encryption (64 hex chars) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | *(optional)* Web Push; without them push is skipped |

See `.env.example` for the full list.

---

## Testing

```bash
npm test                     # full Jest suite (integration + unit)
npm test -- --runInBand      # serial — avoids Atlas connection contention
npm run lint                 # ESLint + Prettier
```

Tests are organised by phase (`tests/phaseN-*.test.js`) plus inherited auth/security
suites. Coverage thresholds are enforced on `utils/`, `models/`, `routes/`, `middleware/`.

---

## Project structure

```
controllers/      route handlers (business logic)
services/         schedulerService (engine), metricsService, notificationService, emailService
models/           Mongoose schemas (Business, Location, Staff, Schedule, Shift, …)
routes/v1/        Express routers, mounted under /api/v1
middleware/       auth, resolveBusiness (tenancy), requireOwner/StaffSelf, validate, rate-limit
utils/            weekUtils, shiftType, validators, helpers
scripts/          seeds + one-off admin/ops scripts
frontend/src/     Vite SPA — js/pages, js/components, js/api.js, js/store.js
docs/             PRODUCT_REQUIREMENTS · SYSTEM_ARCHITECTURE · IMPLEMENTATION_PLAN · FRONTEND_SCREENS
```

**Multi-tenancy:** every query is scoped by `businessId`; `resolveBusiness` sets
`req.business` / `req.membership` (`owner`|`staff`) / `req.staffMember`.

---

## Admin / ops scripts

| Script | What it does |
|---|---|
| `node scripts/seed-plans.js` | Seed subscription plans (run once per DB) |
| `node scripts/seed-shiftwise.js` | Seed a demo business + staff + availability |
| `node scripts/seed-browsertest.js` | Ready-to-login staff + a published week (manual testing) |
| `node scripts/reconcile-subscriptions.js` | Backfill/repair user subscriptions |
| `node scripts/security-audit.js` | Static security checks |

Seeds refuse to run when `NODE_ENV=production`.

## Deployment

See `render.yaml`. CI (`.github/workflows/ci.yml`) runs lint + tests and gates the deploy
hook. Before production: set the real `CLIENT_URL` / `ALLOWED_ORIGINS`, provision a
dedicated database, and configure Brevo + (optionally) VAPID keys.

## Docs
Read `docs/` first — product requirements, architecture, the phase-by-phase implementation
plan, and the frontend screen spec. User-facing walkthrough: **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.
