# ShiftWise — Staff Scheduling SaaS

## What this is
A workforce/staff scheduling product: businesses manage locations, staff, shifts, schedules,
availability, swaps, and time-off. Built on the **Adv_Backend** auth boilerplate.
Read `docs/` first — `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `FRONTEND_SCREENS.md`.

## Stack
- **Backend:** Node.js (>=20) + Express 4 (CommonJS), Mongoose 9
- **Frontend:** `frontend/` — Vite + React (the app). `landing/` — separate marketing site (3D scroll).
- **Deploy:** Render (`render.yaml`)

## Layout
- Route → controller → service, same as Adv_Backend. `routes/v1/*.routes.js`
- Domain models beyond auth: `Business`, `Location`, `Shift`, `Schedule`, `ScheduleTemplate`,
  `Availability`, `ShiftSwapRequest`, `TimeOffRequest`, `StaffMember`, `StaffInvite`,
  `StaffMetrics`, `Notification`
- Key service: `schedulerService.js` (scheduling logic). Dates via `dayjs`.
- Staff onboarding flow: `joinController.js` / `join.routes.js` + `StaffInvite`
- Auth/MFA/security/subscriptions inherited from the Adv_Backend base

## Commands
- Backend: `npm run dev` · `npm test` · `npm run lint`
- Frontend app: `cd frontend && npm run dev` · Landing: `cd landing && npm run dev`
- Env: copy `.env.example` → `.env`

## Conventions
- Keep the route → controller → service separation from the base.
- Scheduling/time logic is the heart of the product — keep it in `schedulerService.js`, well-tested.
- Two front-ends: `frontend/` = the product app, `landing/` = marketing. Don't mix them up.

## My skills
Relevant `~/.claude/skills`: `saas-patterns`, `auth-patterns`, `backend-patterns`,
`database-design`, `api-design`, `frontend-patterns`, `ui-ux-pro-max`, `design-systems`, `testing`.
