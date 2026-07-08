# ShiftWise — User Guide

Two roles use ShiftWise: the **Owner/Manager** (runs the business) and **Staff** (works shifts).

---

## For Owners / Managers

### 1. Get set up
1. **Sign up** and verify your email, then complete the **onboarding wizard** — this creates
   your business and first location.
2. Open **Settings** to set your week start, timezone, shift types, and per-location rules
   (min/max staff per shift, min rest hours, max consecutive days, max weekly hours).

### 2. Build your team
- Go to **Team → Add staff**. For each person set their role, employment type, hourly rate,
  and location(s).
- Click **Invite** to email a join link. When they accept, their account links automatically.
- Ask staff to set their **availability** (or propose it for them from the availability screen).

### 3. Create a schedule
1. Go to **Schedule**, pick a location and week.
2. Click **Auto-generate** — the engine fills every seat legally (respecting availability,
   time-off, rest, role, and incompatible-pair rules) and scores for fairness.
3. Review the preview → **Accept** (or discard and tweak). Drag chips to reassign; the engine
   re-checks each move. Add/remove shifts manually — illegal moves are blocked.
4. **Save as template** to reuse a week later.
5. **Publish** — staff are notified and can now see their shifts.

### 4. Run the week
- On a published schedule, mark a shift **absent** → pick a **cover** from ranked candidates
  (reliability-gated; overriding a low-reliability pick requires a reason, which is logged).
- Mark **attendance** (present / late / no-show) — this updates reliability + analytics.

### 5. Handle requests (Dashboard)
The **Dashboard** cockpit shows a "Needs attention" queue:
- **Time-off** requests → Approve/Deny inline (approval warns you about clashing published shifts).
- **Swap** requests → Approve/Deny (the engine validates the new assignment first).
- **Disputed** shifts → open the schedule to resolve.

### 6. Analytics
**Analytics** shows hours, labour cost, coverage %, fairness spread, and late/no-show counts
per month and per location — plus a chart of hours by staff. Award **badges** to recognise staff.

---

## For Staff

1. **Accept your invite** email → set a password → you're in.
2. **My Availability** — mark the days/times you can normally work (and per-week overrides).
3. **My Shifts** — see your published shifts for the week and who you're working with.
   - **Confirm** a shift to acknowledge it.
   - **Dispute** a shift if there's a problem — your manager is notified.
   - Your **reliability score** (top of the page) reflects attendance + covers.
4. **Requests** — ask for time off, or request a shift swap (targeted or open to the team).
5. The **🔔 bell** shows notifications: schedule published, request results, badges, and more.

---

## Notifications
Events notify the right person in-app (the bell) and by email: schedule published (staff),
time-off / swap decisions (the requester), disputes (the manager), and badge awards (staff).
Web Push is delivered too when configured.
