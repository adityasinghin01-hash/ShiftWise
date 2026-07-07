# ShiftWise — Master Implementation Plan (V1)

> **Single source of truth.** Everything needed to build ShiftWise v1 is in THIS file: principles, decisions, data models, the scheduling algorithm, API contracts, UI spec, and a phase-by-phase build order with testing gates.
> **Scope:** v1 = full product, pure constraint-based algorithm, **NO AI**. No pricing/tiers (v2). Desktop web only.
> Background docs (context, not required to execute): `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `FRONTEND_SCREENS.md`.

---

## TABLE OF CONTENTS
0. How to use this document (READ FIRST)
1. Principles
2. Locked decisions
3. Tech stack
4. Engineering standards (from Skills folder)
5. Data models
6. Scheduling algorithm (deep)
7. API contracts
8. UI specification
9. Build phases + testing gates
10. Definition of Done
11. Risks

---

# 0. HOW TO USE THIS DOCUMENT — READ FIRST

**You are an AI agent (e.g. Sonnet) executing this plan. Follow these rules exactly.**

### Working rules
1. **Work one phase at a time, in order** (§9, Phase 0 → 10). Do not start a phase until the previous phase's **Testing Gate is green**.
2. Within a phase, **backend first** (it defines the contract), then **frontend** against that contract. The contract is in §7.
3. Before building anything, **re-read the relevant sections**: the data model (§5), algorithm (§6), contract (§7), and UI (§8) for what you're building.
4. **Never break existing code.** The auth/RBAC/email/webhooks platform already works (230 passing tests). Extend it; re-run the full test suite after changes.
5. **Multi-tenancy is sacred** (§4.1). Every query you write must be scoped to the caller's `businessId`. A single missed scope is a security bug.

### Code comments (REQUIRED)
- **Every new file** starts with a header comment: what it does + which plan section/phase it implements.
- **Every function** gets a short comment: purpose, params, return shape. Use JSDoc style to match the existing codebase (see `utils/hashToken.js`).
- **Every non-obvious block** (the algorithm phases, tenancy checks, rule logic) gets an inline comment explaining the WHY, not just the what.
- Match the existing comment style in the repo (look at `middleware/authMiddleware.js`, `services/emailService.js`). Reference the fix/section like `// §6 Phase 3 — eligibility filter`.

### Bug-fixing protocol (when a test fails or something breaks)
1. **Reproduce** — run the exact failing test/command and read the full error.
2. **Diagnose root cause** — read the actual code path; don't guess. State the cause in a comment or commit message.
3. **Fix the cause, not the symptom.** Do not patch over a failing assertion by weakening the test.
4. **Re-run the phase's Testing Gate** + the full suite. Both must be green.
5. **If the same approach fails twice, STOP and step back** — diagnose differently, or flag the blocker. Do not loop on incremental patches.
6. Add a regression test for any bug you fix.

### Conventions
- Backend: CommonJS (`require`), matches existing repo. Frontend: ES modules.
- Reuse existing middleware: `protect()`, `authorize()`, `validate()`, `errorHandler`, rate limiter, `logger`. Don't reinvent.
- Validation: **express-validator** (the repo standard — see `middleware/validate.js`). Do NOT introduce Zod.
- Error envelope: `{ success:false, message, code?, request_id }` (matches existing). Success: `{ success:true, data }`.
- IDs in URLs: Mongo ObjectId strings (repo standard for v1).
- All user-facing strings go through a central `frontend/src/js/i18n/en.js` map — no hardcoded text (enables v2 translations).

---

# 1. PRINCIPLES

1. **Contract-first vertical slices** — per screen: lock contract (§7) → frontend against mock of that contract → backend fulfils it → wire + test. Zero rework on swap.
2. **Dependency order, not screen-number order** — foundation first; Dashboard & Analytics last (they only aggregate).
3. **Reuse the platform** — auth, RBAC, Brevo email, rate limiting, validation, logging, Jest already exist.
4. **One shared constraint engine** — scheduler, swaps, time-off, cover all call the same validator (§6.2). Add a rule once → everything respects it.
5. **Multi-tenant isolation is non-negotiable** — every record scoped to `businessId` (§4.1).
6. **No AI, no pricing in v1** — deterministic algorithm only; subscription code stays dormant.

---

# 2. LOCKED DECISIONS

### Cross-cutting
- No AI (deterministic solver) · No pricing/tiers/trial (v2) · English-only (strings centralized for v2 i18n) · **Desktop web only** (no mobile responsive) · separate manager/staff dashboards on one auth system · multi-tenant isolation · **attendance manager-marked** (present/late/no-show → feeds analytics + reliability) · notifications = in-app (Gmail-style bell + unread badge, ~30s poll) + email (Brevo) + push (Web Push/VAPID).

### Per-screen
| # | Screen | Decisions |
|---|--------|-----------|
| 1 | Onboarding | 3-step wizard (Business→Location→Staff); first-timer checklist spine; guided tour scoped to Schedule Builder only; gated by `business.onboarding.completed` |
| 2 | Manager Dashboard | Mixed cockpit (today strip + needs-attention + KPI tiles); default "All locations" aggregated + per-location drill-down; hybrid actions (inline approve/deny requests, link-out for schedule issues) |
| 3 | Team | Staff lifecycle `none→invited→active`; single-add + bulk import; manager fills minimal+business fields, staff completes own profile+availability; per-person "manuallyManaged" toggle; Emergency-Notify email (individual/per-shift/cover); **owner-only** (multi-manager = v2) |
| 4 | Schedule Builder | Dual view (Staff×Days / Shifts×Days); lockable manual shifts + preview-accept auto-generate; conflicts inline markers + side panel; publish confirm-summary, notify-only-affected on edits; **weekly only**; copy-last-week + saved templates; reliability-gated auto-cover with 25-pt anti-favoritism override (logged+reason) |
| 5 | Availability | Recurring weekly default + per-week overrides; manager override requires staff confirm/decline; soft per-week deadline + reminders |
| 6 | Requests | Time-off: manager approves, warned if uncovers a published shift; Swaps: targeted teammate OR open board, manager approves; all validated via shared engine (hard-block/soft-warn) |
| 7 | Analytics | Full suite: hours, labor cost, coverage %, fairness, weekend/night distribution, attendance/absence, late tracking, trends, badges; all unlocked; real data only |
| 8 | Staff Portal | Full hub: my shifts (next highlighted), my stats/fairness/badges, who's on my shift, announcements, notifications; acknowledge or dispute shifts |
| 9 | Settings | Full location rule set (advanced rules optional/blank-by-default); business settings; locations CRUD; account (existing auth); notification prefs; billing = v2 |

---

# 3. TECH STACK (free tier)

**Existing:** Node/Express, MongoDB Atlas, Mongoose, JWT (HS256), RBAC, express-validator, Brevo email, Upstash Redis, Jest, Vite, vanilla-JS SPA + hash router.

**New libs for v1:**
| Need | Choice | Notes |
|------|--------|-------|
| Charts | **Chart.js** | vanilla-JS friendly |
| Dates/timezones | **day.js** + utc/timezone plugins | shift math; store UTC, render in location tz |
| Push notifications | **web-push (VAPID)** | self-hosted, free |
| Icons | **Lucide** | SVG set |

**Deferred to v2:** maps, product analytics, i18n translations, mobile responsiveness, native app, pricing, real-time WebSockets (v1 uses polling).

---

# 4. ENGINEERING STANDARDS (mined from the Skills folder)

> Apply these throughout. Citations show the source skill. Where a skill conflicts with the existing codebase, the codebase wins and the divergence is noted.

### 4.1 Multi-tenancy & data isolation *(SAAS_PATTERNS, SECURITY, DATABASE_DESIGN)*
- Every business-owned document has an **indexed `businessId`**. Every query filters by it — no exceptions.
- `businessId` comes from `req.business` (resolved server-side), **never from client input**.
- Add isolation tests: seed two businesses, assert A can never read/write B's data.
- The `resolveBusiness` middleware sets `req.business` + `req.membership` + `req.staffMember` and propagates to all controllers (§9 Phase 0).

### 4.2 MongoDB schema & indexing *(DATABASE_DESIGN)*
- **Compound indexes** for hot paths: `{businessId, locationId}`, `{scheduleId}`, `{staffId, date}`, `{userId, readAt}` (notifications).
- **Manually index every reference field** (Mongoose doesn't auto-index refs).
- **Embed** small fixed data (shift types in Location, badges in StaffMember); **reference** large independent collections (Shifts, Notifications).
- Keep nesting ≤ 3 levels. Verify hot queries with `.explain()`.

### 4.3 REST conventions *(API_DESIGN)*
- Plural noun resources, no verbs in URLs (`/schedules`, `/shifts`). Actions as sub-resources (`/schedules/:id/publish`).
- Status codes: 200 ok · 201 created · 400 bad request · 401 unauth · 403 forbidden · 404 not found · 422 validation · 429 rate-limited.
- Error envelope with `request_id` for log correlation (existing pattern).
- **Bulk endpoints** where useful (`POST /staff/bulk`).
- Divergence: skip cursor pagination + idempotency keys + public UUIDs in v1 (offset pagination + ObjectId; revisit v2) to match existing simplicity.

### 4.4 Validation & error handling *(BACKEND_PATTERNS, API_DESIGN)*
- Validate body/query/params at the boundary with express-validator schemas (extend `middleware/validate.js`).
- Typed errors via the existing `ApiError`/`errorHandler`. Generic message to client, full detail to `logger` server-side. Never leak internals.
- Return field-level errors for forms.

### 4.5 Auth/RBAC *(AUTH_PATTERNS, SAAS_PATTERNS)*
- Check **both** role AND resource ownership (a staff can only touch their own data; owner only their business).
- Tokens: keep existing httpOnly refresh cookie + in-memory access token. Never localStorage.
- Reuse `protect()` then `resolveBusiness` then `requireOwner`/`requireStaffSelf`.

### 4.6 Security *(SECURITY)*
- Sanitize/validate all inputs; Mongoose parameterized queries only (no string-built queries).
- Rate-limit auth + invite + email-send + cover endpoints (reuse `rateLimiter`).
- Secrets only via env (already done). Keep CSP/security headers middleware.
- Top risk = cross-tenant leak; review every query.

### 4.7 Testing *(TESTING)*
- Pyramid: heavy unit (algorithm!), solid integration (API + real test DB/tenant), minimal E2E.
- **Mock external services**: Brevo email, Web Push, Redis — assert "called with", don't send.
- Test-data factories that build tenant-scoped data; clean up between tests.
- Multi-tenant isolation tests are mandatory per phase.
- Frontend: light smoke checks only (vanilla JS, no React Testing Library).

### 4.8 Frontend (vanilla-JS SPA) *(FRONTEND_PATTERNS, UI_UX_PRO_MAX_SKILL)*
- Centralized API client (`api.js`) — never `fetch` inline in a page.
- Each page = `renderX()` mounting into `#page-content` via `mountLayout`.
- **Mandatory 4 states** on every data screen: loading (skeleton), empty (CTA), error (retry), populated. Never a blank screen.
- Global handler for unhandled promise rejections → toast.

### 4.9 Design system *(DESIGN_SYSTEMS, UI_UX_PRO_MAX_SKILL)*
- CSS custom properties only (already in `main.css`); never raw hex in components.
- 8px spacing grid (4px fine-tune). Semantic tokens.
- Accessibility: ≥4.5:1 contrast, visible focus states, labelled inputs, aria-live on toasts/bell, keyboard-closable modals.

### 4.10 Scheduling-domain system design *(SYSTEM_DESIGN)*
- Store times UTC, render in location timezone (day.js).
- **Conflict detection at write time**, not just UI (the constraint engine, §6).
- Notifications via async-ish service; don't block the request on email/push.
- (Optional v2) cache schedule views in Redis, invalidate on shift change.

---

# 5. DATA MODELS (Mongoose, in `models/`)

> Every business-owned model: indexed `businessId`. Add JSDoc header to each file citing this section.

1. **Business** — `name, ownerId(ref User), settings{timezone,currency,weekStartsOn}, onboarding{completed:Boolean, checklist:{addedStaff,availabilitySet,rulesSet,generated,published}}, createdAt`
2. **Location** — `businessId, name, address, timezone, isActive, settings{ shiftTypes:[{name,startTime,endTime,color}], minStaffPerShift, maxStaffPerShift, minRestHours, maxHoursPerWeek, maxDaysConsecutive, incompatiblePairs:[[staffId,staffId]], roleCoverage:[{role,min}] }` — advanced rules default empty/0 = not enforced
3. **StaffMember** — `businessId, locationIds:[], userId(null until joined), name, email, role, hourlyRate, employmentType('full-time'|'part-time'|'casual'), maxHoursPerWeek, manuallyManaged:Boolean, accountStatus('none'|'invited'|'active'), forceTrustCover:Boolean, badges:[{type,awardedAt,awardedBy}], isActive, joinedAt`
4. **StaffInvite** — `businessId, staffId, email, tokenHash, expiresAt, acceptedAt` (store `hashToken(raw)`)
5. **Availability** — `staffId, locationId, recurring{slots:[{dayOfWeek,available,preferredStart,preferredEnd}]}, overrides:[{weekOf,slots:[...]}], updatedAt`
6. **Schedule** — `businessId, locationId, periodStart, periodEnd, status('draft'|'published'|'archived'), generatedBy('auto'|'manual'), fairnessScore, publishedAt, publishedBy, notes`
7. **Shift** — `scheduleId, businessId, locationId, staffId, date, startTime, endTime, shiftType, isWeekend, isNight, locked:Boolean, status('scheduled'|'confirmed'|'disputed'|'absent'|'covered'), attendance('unmarked'|'present'|'late'|'no_show'), coveredBy, actualStart, actualEnd, notes` — index `{scheduleId}`, `{staffId,date}`
8. **TimeOffRequest** — `businessId, staffId, locationId, startDate, endDate, reason, status('pending'|'approved'|'denied'), reviewedBy, reviewedAt, reviewNote`
9. **ShiftSwapRequest** — `businessId, requesterStaffId, shiftId, mode('targeted'|'open'), targetStaffId(null), claims:[{staffId,claimedAt}], status('pending'|'claimed'|'approved'|'denied'|'cancelled'), reviewedBy, reviewedAt`
10. **ScheduleTemplate** — `businessId, locationId, name, shifts:[{dayOfWeek,shiftType,startTime,endTime,requiredCount}], createdBy`
11. **Notification** — `userId, businessId, type, title, body, data{}, channels:[], readAt(null), sentAt, createdAt` — index `{userId, readAt}`
12. **StaffMetrics** (denormalized; recompute on publish + attendance change) — `staffId, locationId, period{year,month}, totalHours, weekendHours, nightHours, earlyMorningHours, absences, lateArrivals, noShows, swapsRequested, coversCompleted, timeOffDaysTaken, dedicationScore, reliabilityScore, fairnessDebt`

---

# 6. SCHEDULING ALGORITHM (deep) — `services/schedulerService.js`

> Deterministic constraint solver + greedy assignment with fairness scoring. **No randomness in prod** (fixed tiebreak). Same input → identical output. This determinism IS the product promise. Heavily comment this file.

## 6.1 In-memory structures (built per generate() call)
```js
Slot = { id:`${dateISO}_${shiftType}_${i}`, date, dayOfWeek/*0=Mon..6=Sun*/, shiftType,
         startTime, endTime, isWeekend, isNight, requiredRole|null, assignedStaffId|null }
StaffState = { staffId, name, role, maxHoursPerWeek, manuallyManaged,
  availabilityIndex/*Map<dayOfWeek,{available,start,end}> resolved for THIS week*/,
  timeOffDays/*Set<dateISO>*/, incompatibleWith/*Set<staffId>*/,
  /*mutated during run:*/ assignedShifts:[], hoursAssigned:0, consecutiveDays:0, lastShiftEnd:null,
  weekendCount:0, nightCount:0,
  /*history from StaffMetrics, read-only:*/ histWeekendHours, histNightHours, histTotalHours, timeOffRequestedCount }
GenerationContext = { location, weekStart, weekEnd, rules, staffStates:Map, slots:[], lockedShifts:[], conflicts:[],
                      avgWeekendHours, avgNightHours, avgTotalHours }
```
Rules from `location.settings`: `minStaffPerShift, maxStaffPerShift, minRestHours, maxHoursPerWeek, maxDaysConsecutive, incompatiblePairs, roleCoverage`. **Optionality:** any rule `0`/`null`/`[]` = not enforced; skip cleanly.

## 6.2 Constraint engine — `checkAssignment(staffState, slot, ctx) → { hard:[], soft:[] }`
THE single source of truth. Called by scheduler, swaps, time-off, cover. **HARD = illegal (block); SOFT = legal but warn.**

HARD rules (collect all that fail):
1. `UNAVAILABLE` — not available that day, or slot time outside their window (resolved availability = recurring ⊕ override).
2. `TIME_OFF` — `slot.date ∈ timeOffDays`.
3. `DOUBLE_BOOKED` — overlaps an existing shift that day.
4. `INCOMPATIBLE_PAIR` — a peer already in this slot is in `incompatibleWith`.
5. `REST_VIOLATION` — if `minRestHours>0`: gap to previous/next shift `< minRestHours`.
6. `MAX_CONSECUTIVE` — if `maxDaysConsecutive>0`: would exceed consecutive-day run.
7. `ROLE_MISMATCH` — `slot.requiredRole` set and `staffState.role` differs.

SOFT rules: `OVER_HOURS` (would exceed `min(staff.maxHoursPerWeek, rules.maxHoursPerWeek)`), `THIN_COVERAGE` (flagged from validation).

## 6.3 generateSchedule(scheduleId) → { preview, conflicts, fairnessScore } — does NOT persist
- **Phase 1 Slot Generation:** for each day×shiftType create `minStaffPerShift` slots; expand `roleCoverage` into typed slots first, remainder generic.
- **Phase 2 Pre-apply locked shifts:** mark their slots assigned; update those StaffStates. Locked shifts are immovable.
- **Phase 3 Eligibility + Fairness scoring:** for each empty slot (stable order: date asc, shiftType order, index), build `candidates` = staff with no hard violations, each scored by `fairnessScore`; sort `score DESC, soft.length ASC, staffId ASC` (deterministic).
- **Phase 4 Greedy assignment:** for each empty slot in stable order, pick `candidates[0]`; if none → push `UNDERSTAFFED` conflict, leave empty. Update StaffState; push `WARNING` if soft. Lazily re-score affected staff after each assignment.
- **Phase 5 Validate + backtrack:** re-run hard checks across final assignment; if violations and attempts<3, unassign lowest-priority conflicting staff and retry affected slots. Never return an illegal schedule silently — surface conflicts. Compute `fairnessScore` (§6.5).

## 6.4 fairnessScore(staffState, slot, ctx) — assignment priority (higher = assigned first)
```
base = (ctx.avgWeekendHours - ss.totalWeekendHours)*2.0
     + (ctx.avgNightHours   - ss.totalNightHours)*1.5
     + (ctx.avgTotalHours   - ss.totalHoursAll)*1.0
     + (ss.timeOffRequestedCount * -0.5)
if slot.isWeekend: base += (ctx.avgWeekendHours - ss.totalWeekendHours)*1.0
if slot.isNight:   base += (ctx.avgNightHours   - ss.totalNightHours)*0.75
return base
```
Higher = more "owed" an unpopular shift. (Tunable weights.)

## 6.5 Schedule fairness % (0–100, shown to manager)
`100 - min(100, stddev(unpopularShare across staff) * SCALE)` (SCALE ~200). 100 = perfectly even.

## 6.6 reliabilityScore(metrics) — auto-cover gate (0–100, tunable)
```
score = 100 - 20*noShows - 5*lateArrivals + 3*coversCompleted   // trailing 90 days
reliabilityScore = clamp(0,100, score)
```
New staff (no history) default 100. **Auto-claim allowed** if `>=70` OR `forceTrustCover`.

## 6.7 Anti-favoritism cover override
```
top = highest-reliability volunteer
if managerPick && (top.reliability - managerPick.reliability) > 25:
    systemChoice = top
    if manager overrides back → require non-empty reason → write AuditLog{action:'cover_override', from:top, to:managerPick, reason}
else: systemChoice = managerPick ?? top
```

## 6.8 Edge cases (must handle)
No eligible staff → UNDERSTAFFED, slot empty, schedule still returns · all manuallyManaged & unjoined → use manager-set availability · week spans month → split metric attribution · night crossing midnight (22:00–02:00) → isNight true, rest/consecutive use real datetimes · DST/timezone → day.js in location tz, store UTC · incompatible pair both top → first assigned wins, second excluded for that slot only · rule blank → no cap · locked shift that violates a rule → keep but emit WARNING.

## 6.9 Unit tests (Jest) — minimum
checkAssignment: each hard rule fires correctly; OVER_HOURS is soft not hard; all-blank rules → no violations.
generateSchedule: all slots filled when enough staff; correct UNDERSTAFFED count + no hard violations when short; locked shift preserved + filled around; weekend/night go to highest-debt staff; **deterministic (identical output across runs)**; approved time-off never scheduled; incompatible pair never co-assigned.
reliability/cover: new staff=100; no-shows drop score; auto-claim blocked <70 unless force-trusted; 25-pt gap triggers override + requires reason + writes AuditLog; sub-25 gap → manager pick wins.

---

# 7. API CONTRACTS

> Base `/api/v1`. Auth: `Authorization: Bearer <token>` unless Public. Success `{success:true,data}`, error `{success:false,message,code?,request_id}`. All non-public routes run `protect → resolveBusiness`. Owner-only → 403 for staff; staff-self → 403 on others' data. Lists auto-scoped to business.

### Business
```
POST /business {name,timezone,currency,weekStartsOn} → 201 {data:Business}
GET  /business → {data:Business}
PUT  /business {name?,settings?} → {data:Business}
Business={id,name,ownerId,settings:{timezone,currency,weekStartsOn},onboarding:{completed,checklist},createdAt}
```
### Locations
```
GET    /locations → {data:[Location]}
POST   /locations {name,address?,timezone?,settings} → 201 {data:Location}
GET    /locations/:id → {data:Location}
PUT    /locations/:id {name?,settings?} → {data:Location}
DELETE /locations/:id → {data:{id,isActive:false}}  // soft delete
Location={id,businessId,name,address,timezone,isActive,settings:{shiftTypes:[{name,startTime,endTime,color}],minStaffPerShift,maxStaffPerShift,minRestHours,maxHoursPerWeek,maxDaysConsecutive,incompatiblePairs,roleCoverage}}
// validate minStaffPerShift<=maxStaffPerShift; hours 0–168; HH:MM valid
```
### Staff
```
GET    /staff → {data:[StaffMember]}
POST   /staff {name,email,role?,hourlyRate?,maxHoursPerWeek?,manuallyManaged?,sendInvite?} → 201 {data:StaffMember}
POST   /staff/bulk {rows:[{name,email,role?}],sendInvite} → {data:{created:[],errors:[{row,reason}]}}
PUT    /staff/:id {...editable} → {data:StaffMember}
DELETE /staff/:id → {data:{id,isActive:false}}
POST   /staff/:id/invite → {data:{invited:true,expiresAt}}
POST   /staff/:id/notify {message?} → {data:{sent:true}}   // emergency email + upcoming shifts
StaffMember={id,businessId,locationIds,userId|null,name,email,role,hourlyRate,employmentType,maxHoursPerWeek,manuallyManaged,accountStatus,forceTrustCover,badges,reliabilityScore,isActive,joinedAt}
```
### Join (Public)
```
GET  /join/validate?token=RAW (Public) → {data:{valid,businessName,email}} | 400
POST /join/accept (Public) {token,password?,googleIdToken?} → {data:{accessToken,user}}
POST /join/complete-profile {phone?,...} → {data:StaffMember}
// email-match fallback: normal signup with a pending-invite email → link to that StaffMember
```
### Availability
```
GET /my/availability → {data:Availability}
PUT /my/availability {recurring:{slots}} → {data:Availability}
PUT /my/availability/override {weekOf,slots} → {data:Availability}
GET /locations/:id/availability?weekOf= (owner) → {data:[{staffId,name,resolvedSlots,submitted}]}
POST /availability/:staffId/override-request (owner) {weekOf,slots,note?} → {data:{requestId,status:'pending'}}
PUT  /availability/override-request/:id (staff) {decision:'confirm'|'decline'} → {data:{status}}
Availability={id,staffId,locationId,recurring:{slots},overrides:[{weekOf,slots}],updatedAt}
```
### Schedules & Shifts (algorithm internals §6)
```
POST /schedules {locationId,periodStart} → 201 {data:Schedule}   // weekly; periodEnd computed
GET  /schedules/:id → {data:{schedule,shifts:[Shift]}}
POST /schedules/:id/generate {} → {data:{preview:[Shift],conflicts:[Conflict],fairnessScore}}  // NOT persisted
POST /schedules/:id/apply {shifts:[Shift]} → {data:{schedule,shifts}}   // commit accepted preview
PUT  /schedules/:id {notes?,status?} → {data:Schedule}
POST /schedules/:id/publish {} → {data:{schedule,notified:[userId]}}
POST /schedules/:id/copy {fromScheduleId} → {data:{schedule,shifts}}
DELETE /schedules/:id → {data:{id}}  // draft only
GET    /schedules/:id/shifts → {data:[Shift]}
POST   /schedules/:id/shifts {staffId,date,startTime,endTime,shiftType} → 201 {data:Shift,verdict:{hard,soft}}
PUT    /shifts/:id {staffId?,date?,startTime?,endTime?,locked?} → {data:Shift,verdict:{hard,soft}}
DELETE /shifts/:id → {data:{id}}
POST   /shifts/:id/absent {} → {data:{shift,coverMode?}}
POST   /shifts/:id/cover/open {} → {data:{shift,openToVolunteers:true}}
POST   /shifts/:id/cover/volunteer (staff) → {data:{claimed:true}}
POST   /shifts/:id/cover/assign {staffId,overrideReason?} → {data:{shift,overridden}}
POST   /shifts/:id/attendance {status:'present'|'late'|'no_show'} → {data:Shift}  // manager
Schedule={id,businessId,locationId,periodStart,periodEnd,status,generatedBy,fairnessScore,publishedAt,notes}
Shift={id,scheduleId,businessId,locationId,staffId,date,startTime,endTime,shiftType,isWeekend,isNight,locked,status,attendance,coveredBy,notes}
Conflict={type:'UNDERSTAFFED'|'WARNING',slot:{date,shiftType},reason|soft}
Templates: GET/POST /locations/:id/templates · PUT/DELETE /templates/:id
```
### Time Off
```
POST /timeoff (staff) {startDate,endDate,reason} → 201 {data:TimeOffRequest}
GET  /my/timeoff (staff) → {data:[TimeOffRequest]}
GET  /locations/:id/timeoff (owner) → {data:[TimeOffRequest]}
PUT  /timeoff/:id/review (owner) {decision:'approved'|'denied',note?} → {data:{request,coverageWarning?:{shiftIds}}}
```
### Swaps
```
POST /swaps (staff) {shiftId,mode:'targeted'|'open',targetStaffId?} → 201 {data:SwapRequest}
GET  /my/swaps (staff) → {data:[SwapRequest]}
GET  /locations/:id/swaps (owner) → {data:[SwapRequest]}
POST /swaps/:id/claim (staff, open) → {data:{claimed:true}}
PUT  /swaps/:id/review (owner) {decision,overrideReason?} → {data:{request,verdict:{hard,soft}}}
```
### Dashboard (owner)
```
GET /dashboard?location=all|:id → {data:{kpis:{hoursThisWeek,laborCost,coveragePct,fairnessScore,trends},
  today:[{shiftId,staffName,startTime,endTime,status,locationName}],
  attention:{timeOff:[],swaps:[],understaffed:[{scheduleId,slot}],drafts:[]}}}
```
### Analytics (owner)
```
GET /locations/:id/analytics?from=&to= → {data:{hoursPerStaff,laborCostTrend,weekendNight,attendance,lateTrend,fairness}}
GET /staff/:id/metrics → {data:StaffMetrics}
GET /locations/:id/fairness → {data:{score,perStaff}}
POST /staff/:id/badges {type} → {data:StaffMember}
```
### Staff Portal (staff)
```
GET  /my/shifts?from=&to= → {data:[Shift + {coworkers:[{name,role}]}]}   // own shifts only, NO full team schedule
POST /shifts/:id/acknowledge → {data:{shift}}
POST /shifts/:id/dispute {reason} → {data:{requestId}}
GET  /my/metrics → {data:StaffMetrics}
```
### Notifications
```
GET /notifications?unreadOnly= → {data:{items:[Notification],unreadCount}}
PUT /notifications/:id/read → {data:{id,readAt}}
PUT /notifications/read-all → {data:{unreadCount:0}}
POST /notifications/push-subscribe {subscription} → {data:{ok:true}}
Notification={id,userId,type,title,body,data,channels,readAt|null,createdAt}
```
**Every override write (cover override, soft-warn swap approve) → AuditLog entry.**

---

# 8. UI SPECIFICATION (desktop, vanilla-JS SPA)

## 8.1 Design system — USE TOKENS from `frontend/src/css/main.css`
```
Green: --primary #2d6e1f · --primary-light #4ea864 · --accent #7ec8a0
Status: --danger #ef4444 · --success #10b981 · --warning #f59e0b
Surfaces: --bg #080810 · --bg-surface #0d0d18 · --bg-elevated #12121f
Glass: --glass-bg rgba(255,255,255,.04) · --glass-border rgba(255,255,255,.08) · --blur blur(16px)
Text: --text #f0e4c8 · --text-secondary 55% · --text-muted 30%
Radius 8/12/16/24 · Font: Playfair (head) + Inter (body) · --transition 0.2s
```
Language: dark galaxy bg, cream text, forest-green accents, glassmorphism cards, subtle green hover glow. **Never hardcode hex** — use tokens. 8px spacing grid.

## 8.2 Shared components (build in `frontend/src/js/components/`)
`Sidebar`(role-aware, extend layout.js) · `TopBar`(location switcher + bell + user menu) · `NotificationBell`(§8.5) · `Modal` · `Toast`(existing) · `DataTable`(header/rows/empty/loading/row-actions) · `Badge`(status pills, semantic colors) · `Button`(`.btn-primary` green gradient / `.btn-ghost` / `.btn-danger` / disabled / loading) · `FormField`(label+input+inline error, mirror auth.js) · `EmptyState`(icon+msg+CTA) · `Skeleton` · `ConfirmDialog`(replace native confirm).
**Every data screen implements all 4 states: loading / empty / error / populated.** Icons: Lucide.

## 8.3 Two role-based shells
After login, `store.user.role` picks shell. **Manager**: sidebar Dashboard·Schedule·Team·Availability·Requests·Analytics·Settings + location switcher. **Staff**: My Dashboard·My Shifts·My Availability·My Requests, no switcher, bell present. Router guards cross-redirect.

## 8.4 Per-screen (layout · components · interactions · states)
**S1 Onboarding** (`pages/onboarding.js`): centered card, step indicator 1·2·3, Back/Next. Step1 Business(name*,tz,currency,weekStart). Step2 Location(name*,address,shift-types editor w/ presets,min/max staff; collapsible advanced rules). Step3 Staff(inline rows name+email+role, bulk-import link, send-invites checkbox, Finish). Next validates; Finish→POST all→set onboarding.completed→dashboard+checklist.
**S1b Checklist+Tour**: dismissible dashboard card (☐ add staff ☐ availability ☐ rules ☐ generate ☐ publish, each links out, auto-hides when done). Builder tour: 4–5 spotlight tooltips first time Schedule opens.
**S2 Manager Dashboard** (`pages/dashboard.js` rebuild): TopBar location switcher (All default + each). KPI tile row (hours/cost/coverage/fairness, big number+trend). Today strip (today's shifts, status dots, absent red). Needs-attention panel (pending time-off/swaps w/ inline ✓/✗; understaffed+drafts link-out). Location switch refetches; inline actions optimistic.
**S3 Team** (`pages/team.js`): header Add-staff(primary)+Bulk-import(ghost)+search. DataTable: Name·Role·Status badge·Rate·Hrs/wk·⋯(edit/invite/notify/manuallyManaged toggle/deactivate). Add modal(fields + Save-as-record / Save-&-invite). Bulk modal(paste/CSV→preview→invite or records). Emergency-Notify modal(message+auto shift info). Join page(`pages/join.js`,`#join?token=`): validate→set password/Google→complete profile→availability→staff dashboard; status→active. Invalid token→error page.
**S4 Schedule Builder** (`pages/schedule.js`, HERO): Toolbar(week prev/next, view toggle, Copy-last-week, Load-template, Auto-generate primary, Publish primary, fairness badge). Grid(7 day cols; Staff view rows=staff / Shift view rows=shift types w/ X/Y filled; chip=colored by type, time+name, lock icon, drag handle). Conflict side panel(collapsible; UNDERSTAFFED red / WARNING amber, click→scroll to cell). Interactions: drag=reassign(calls checkAssignment; hard blocks w/ toast, soft warns); click empty=add-shift picker(eligible sorted by fairness, ineligible greyed+reason); lock toggle; Auto-generate→`/generate`→preview banner(Accept/Discard), locked untouched; Publish→confirm-summary modal(counts+unfilled)→notify assigned; edit published→"notify affected?"; absence→⋯Mark absent→pick replacement OR open volunteers→reliability gate+25pt override reason modal. Builder tour first time.
**S5 Availability**: Manager overview(`pages/availability.js`): grid staff×days(available green/unavailable muted/time-off hatched); cell→Request override→staff confirm/decline; soft-deadline banner. Staff editor(`pages/my-availability.js`): recurring grid(toggle day+time range) + This-week-override tab. Save→toast.
**S6 Requests** (`pages/requests.js`): tabs Time-Off/Swaps w/ pending count badges. Time-off card(name,dates,reason,status,✓/✗; approve→if uncovers published shift→warning modal→cover flow). Swap card(requester,shift,mode,claims,approve/deny; shows verdict green/amber/red; hard-blocked can't approve). Staff submit forms in portal.
**S7 Analytics** (`pages/analytics.js`): location switcher + date range. Chart.js: KPI row, hours-per-staff(bar), labor-cost(line), weekend/night(stacked), attendance(stacked), late(line), fairness(per-staff). Badges: staff list + award buttons(predefined set). No-data→"Metrics appear after first published week" (NEVER dummy numbers).
**S8 Staff Portal** (`pages/staff-dashboard.js` + my-shifts): Next-shift hero card(date,time,location,coworkers). This-week list. My stats card(hours,fairness standing,badges). Announcements. My Shifts: list/calendar, each→Acknowledge or "Can't make this"(dispute→manager request); shows only coworkers on own shifts (never full team schedule).
**S9 Settings** (`pages/settings.js`): tabs Business/Locations/Notifications/Account. Business(name,tz,currency,weekStart). Locations(list+add/edit/deactivate; editor=full rules form, advanced collapsible: rest hours, max consecutive, incompatible pairs multi-select, role coverage). Notifications(per-event in-app/email/push toggles). Account(reuse existing profile/password/MFA). Validate rule numbers.

## 8.5 Notification bell (Gmail-style)
Bell in TopBar + red count badge (hidden at 0). Click→dropdown glass panel, newest first. Unread=full opacity+left green accent+bold; read=~50% opacity, no accent. Open marks visible seen after ~1s OR click marks read→count decrements+dulls. "Mark all read". Empty→"You're all caught up." Poll `GET /notifications` ~30s, merge new, bump badge. Push(VAPID) for background.

---

# 9. BUILD PHASES + TESTING GATES

> Order matters. **Do not advance until the gate is green.** Each phase: backend (defines §7 contract) → frontend (against mock then real) → run gate.

### Phase 0 — Foundation (no UI)
1. All 12 models (§5) + indexes (§4.2), JSDoc headers.
2. `middleware/resolveBusiness.js` — owner via `Business.ownerId`, staff via `StaffMember.userId`; set `req.business/membership/staffMember`; 403 if neither.
3. `middleware/requireOwner.js`, `requireStaffSelf.js`.
4. `services/schedulerService.js` skeleton: export `checkAssignment/generateSchedule/fairnessScore/reliabilityScore` + rule registry (stubs; full in Phase 4).
5. `scripts/seed-shiftwise.js` — dev-only (throw if NODE_ENV==='production'): 1 business, 2 locations, ~8 staff, varied availability+history.
6. Add libs: `dayjs chart.js lucide` (frontend), `web-push` (backend).

**GATE 0:** models validate required/enums; `resolveBusiness` correct membership; **tenancy test** (business A query never returns B); seed runs in dev; existing 230 tests green.

### Phase 1 — Onboarding + Settings
Backend: `businessController`+routes (POST/GET/PUT /business); `locationController`+routes (CRUD, owner-only, scoped, rule validation); set onboarding.completed on finish.
Frontend: `pages/onboarding.js` (S1 wizard) + `pages/settings.js` (S9). Add endpoints to `api.js`.
**GATE 1:** create-business sets owner; location CRUD scoped; min>max rejected; wizard flips flag; settings round-trip; manual browser run of full wizard.

### Phase 2 — Team + Invites
Backend: `staffController`+routes (CRUD, bulk, owner-only); `POST /staff/:id/invite`→StaffInvite(hashToken,7d)+`inviteEmail` template via `sendEmail`(`${CLIENT_URL}/#join?token=`); `POST /join/accept`(public, validate token→create/link User→active); email-match fallback; `POST /staff/:id/notify` emergency email (rate-limited).
Frontend: `pages/team.js` (S3 table+modals) + `pages/join.js`.
**GATE 2:** invite issue→accept→active; expired/invalid rejected; bulk parse+create; manuallyManaged persists; emergency calls sendEmail; email-match fallback; tenancy. **Requires CLIENT_URL set** to test invite links.

### Phase 3 — Availability
Backend: `availabilityController`+routes (my GET/PUT recurring, override, manager overview, override-request+confirm/decline). **Resolution helper (recurring ⊕ override for a week) — reused by the algorithm.**
Frontend: `pages/my-availability.js` + manager overview in `pages/availability.js` (S5); soft-deadline reminders.
**GATE 3:** recurring resolves; override beats recurring; override-request needs confirm; "not submitted" state; reminder fires.

### Phase 4 — Schedule Builder + full engine (HERO)
Backend: implement §6 fully (`checkAssignment` all rules, `generateSchedule` phases 1–5, fairness, reliability); routes (create/get/generate(preview)/apply/shift CRUD w/ verdict/publish/copy/templates/absent+cover w/ reliability gate+override AuditLog); publish-edit diff→notify affected.
Frontend: `pages/schedule.js` (S4 full): dual view, drag-drop, lock, generate→preview→accept/discard, conflicts inline+panel, publish confirm, copy/template, cover UI+override modal; builder tour.
**GATE 4 (heaviest):** all §6.9 unit tests pass; 0 hard violations in output; locked preserved; fairness distributes weekend/night to high-debt; deterministic; publish notifies assigned only; edit notifies affected only; cover gate+override logs; manual browser build+generate+publish.

### Phase 5 — Requests
Backend: time-off routes (approval calls checkAssignment for coverage warning); swap routes (validate via checkAssignment, hard-block illegal, targeted+open claim).
Frontend: `pages/requests.js` (S6) + staff submit forms.
**GATE 5:** approved time-off→hard block in scheduler; coverage warning fires; targeted+open swaps; hard-blocked swap unapprovable; soft-warn approvable w/ logged override; both parties notified.

### Phase 6 — Staff Portal
Backend: `GET /my/shifts` (+coworkers), acknowledge, dispute, `GET /my/metrics`. **Staff serializer strips full team schedule.**
Frontend: `pages/staff-dashboard.js` + my-shifts (S8); staff shell + role guard.
**GATE 6:** staff reads own data only (tenancy+self-scope); cannot fetch full schedule/others; acknowledge/dispute works; dispute→manager request.

### Phase 7 — Manager Dashboard
Backend: `GET /dashboard?location=all|:id` aggregation (scoped).
Frontend: rebuild `pages/dashboard.js` mixed cockpit (S2): KPI tiles, today strip, needs-attention inline+link-out, switcher, checklist widget.
**GATE 7:** aggregation correct all/single; inline approve/deny mutates+refreshes; checklist reflects real state.

### Phase 8 — Analytics
Backend: analytics/metrics/fairness/badges routes; recompute StaffMetrics on publish + attendance change; no dummy data in prod path.
Frontend: `pages/analytics.js` Chart.js (S7) + badge award.
**GATE 8:** metric math (hours, cost=hours×rate, coverage%, fairness, late/no-show); empty state when no published weeks; award badge notifies staff.

### Phase 9 — Notifications (cross-cutting; wired as events land in 4–8, finalized here)
Backend: `notificationService.js` `notify(userId,type,payload,channels)`→create Notification+Brevo email+Web Push; event hooks (publish, time-off result, swap result, cover-needed, badge, cover-override); GET/PUT routes + push-subscribe. Don't block request on email/push.
Frontend: `components/bell.js` (S8.5): badge, dropdown, read/unread, ~30s poll, push registration.
**GATE 9:** notification per event; unread count accurate; mark-read decrements; email+push fire (mocked); poll merges new.

### Phase 10 — Polish & Production
1. Rename `spinx`/`Spinx`→`shiftwise` (storage keys `spinx_user`/`spinx_refresh`, layout labels, package.json) — re-test auth after.
2. Render env: `CLIENT_URL`→real frontend URL; `ALLOWED_ORIGINS` add prod+correct localhost; `BREVO_SENDER_NAME`→"ShiftWise".
3. Deploy frontend (`index.html`+`landing.html`) to Render static; point landing CTAs at prod app.
4. README + short user/admin guide.
5. (Optional) full-app guided tour.
**GATE 10:** prod smoke: signup→onboard→add staff→invite→staff joins→availability→generate→publish→staff sees shift→notification delivered. All tests green.

---

# 10. DEFINITION OF DONE (per slice)
1. API contract (§7) implemented and stable.
2. Frontend works against mock, then real endpoint, no contract change.
3. Tenancy + RBAC enforced; inputs validated (express-validator).
4. Code commented per §0 (file headers, JSDoc, why-comments).
5. Jest tests pass (logic + tenancy isolation); existing 230 stay green; regression test added for any bug fixed.
6. No secrets logged; errors via `errorHandler`; overrides audit-logged.

---

# 11. RISKS / WATCH-LIST
- **Cross-tenant data leak** = top security risk. Review every query for `businessId` scoping. Test per phase.
- **Constraint engine correctness** = the moat. Heaviest tests here. Determinism is mandatory.
- **`CLIENT_URL` placeholder** currently breaks invite/reset email links — fix before/at Phase 2 testing.
- **Timezone math** across business/location overrides — centralize via day.js helpers; test midnight/DST boundaries.
- **Render free-tier cold starts** — first request after sleep is slow; acceptable for v1.
- **Don't loop on failing fixes** — after 2 failed attempts, step back and diagnose differently (see §0 bug protocol).
