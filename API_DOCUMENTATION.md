# NexHR API documentation

Server: `server/server.js` (platform, auth, admin, billing, leave) and `server/hrRoutes.js` (all other HR resources). Node.js 18+, Express 4, PostgreSQL 14+.

## 1. Conventions

| Item | Value |
| --- | --- |
| Base URL | `https://<workspace>.<BASE_DOMAIN>/api`, for example `https://acme.nexhr.com/api` |
| Marketing-host endpoints | `https://www.<BASE_DOMAIN>/api` (sign-up, workspace finder, Stripe webhook) |
| Format | JSON in and out (`Content-Type: application/json`). Uploads are `multipart/form-data`; reports are `text/csv`. |
| Dates / times | Dates `YYYY-MM-DD`. Times `HH:MM`, 24-hour. Timestamps ISO 8601 UTC. |
| Authentication | `nxhr_sid` cookie: httpOnly, Secure, SameSite=Strict, host-only. Set by the sign-in endpoints. Send with `credentials: 'include'`. |
| Workspace | Taken from the `Host` header. Outside production (`NODE_ENV` not `production`), `?w=<workspace>` or the header `X-NexHR-Workspace: <workspace>` also works. |
| Tenant isolation | Every query runs with PostgreSQL row-level security set to the workspace's organisation. |
| CORS | Not needed: the API and pages share one origin. If you host the pages elsewhere, set `CORS_ORIGINS`. |

### Roles
| Role | Scope | Notes |
| --- | --- | --- |
| `employee` | Own records | |
| `manager` | Own records + direct reports (`people.manager_id`) | |
| `hr` | Whole organisation | Can invite and manage users up to HR |
| `admin` | Whole organisation | As HR, plus: assign Admin, security policy, billing |

In the tables below, **Auth** is one of:
- **Public**: no session needed
- **Ticket**: needs a sign-in ticket from an earlier step
- **Session**: any signed-in user
- a list of roles: only those roles

### Errors
Every error response looks like `{ "error": "code", ...details }`. Validation errors add `"fields": { "fieldName": "Readable message" }`.

| Status | Meaning |
| --- | --- |
| 400 | `validation`, `invalid_json`, `workspace_required`, `invalid_code`, `expired` |
| 401 | `unauthenticated` (no or expired session), `invalid` (wrong email or password) |
| 402 | `payment_required`: the trial ended or the subscription lapsed. Only `/auth/*` endpoints, and `/billing*` for Admins, still work. |
| 403 | `forbidden`: the role isn't allowed, or the record is outside the caller's scope |
| 404 | `not_found`, `workspace_not_found` |
| 409 | Conflict: `already_exists`, `last_admin`, `not_pending_or_not_allowed`, `invalid_sequence`, `not_editable`, `no_employee_record` |
| 413 / 415 | File too large (over 10 MB) / unsupported file type |
| 429 | `locked`: too many sign-in attempts. Includes `retryAfter` in seconds. |
| 500 | `server_error` (details are logged on the server, never returned) |
| 503 | `billing_not_configured` (Stripe keys are missing) |

---

## 2. Public and marketing host

| Method | Path | Auth | Body / query | Success response |
| --- | --- | --- | --- | --- |
| GET | `/health` | Public | – | `200 { ok: true, version }` |
| GET | `/public/workspaces/check` | Public | `?slug=acme` | `200 { available: true, reason: null }`, or `reason: "invalid" or "taken"` |
| POST | `/signup` | Public | `{ name, email, password, company, slug, country, currency: "GBP" or "EUR" or "USD", timezone, region, terms: true }` | `201 { userId, slug, next }`. Send the browser to `next`, which is on the new workspace host. |
| POST | `/workspaces/find` | Public | `{ email }` | `202 { ok: true }`, always the same response. The list of workspaces is emailed. |
| POST | `/stripe/webhook` | Stripe signature | Raw Stripe event | `200 { received: true }` |

**Sign-up validation (400 `fields`):**
- `name`, `company`: required
- `email`: must be a valid address
- `password`: 10+ characters with a letter and a number
- `slug`: 3–30 characters (a–z, 0–9, hyphen), not reserved, not taken
- `currency`: GBP, EUR or USD
- `terms`: must be true

Example:
```http
POST https://www.nexhr.com/api/signup
{ "name":"Jo Byrne", "email":"jo@acme.ie", "password":"correct-horse-42", "company":"Acme Logistics",
  "slug":"acme", "country":"IE", "currency":"EUR", "timezone":"Europe/Dublin", "region":"European Union (Dublin)", "terms":true }

201 { "userId":"6d1f…", "slug":"acme", "next":"https://acme.nexhr.com/signup.html?step=verify&u=6d1f…" }
```

## 3. Sign-up completion, sign-in and two-step login (workspace host)

| Method | Path | Auth | Body | Success response |
| --- | --- | --- | --- | --- |
| POST | `/signup/verify` | Public | `{ userId, code }` (6 digits from the email) | `200 { next: "enrol", ticket }` |
| POST | `/signup/resend` | Public | `{ userId }` | `202 { ok: true }` |
| POST | `/auth/login` | Public | `{ email, password }` | Either `200 { role }` with the cookie set, or `200 { next: "totp" or "enrol", ticket }` |
| POST | `/auth/totp` | Ticket | `{ ticket, code }`: 6 digits, or a recovery code `xxxxx-xxxxx` | `200 { role }`, cookie set |
| POST | `/auth/totp/enrol/start` | Ticket | `{ ticket }` | `200 { secret, otpauth, qrSvg }` |
| POST | `/auth/totp/enrol/finish` | Ticket | `{ ticket, code }` | `200 { recoveryCodes: [8], role }`, cookie set |
| POST | `/auth/password/forgot` | Public | `{ email }` | `202 { ok: true }`, always. A code is emailed if the account exists. |
| POST | `/auth/password/reset` | Public | `{ email, code, password }` | `200 { ok: true }`. All of that user's sessions are revoked. |
| GET | `/invitations/:token` | Public | – | `200 { company, email, name, role }`. Returns 404 `expired` after 7 days. |
| POST | `/invitations/:token/accept` | Public | `{ name, password }` | `200 { role }` with the cookie set, or `200 { next: "enrol", ticket }` |
| GET | `/auth/me` | Session | – | `200 { userId, name, email, role, personId, org: { id, slug, name, legalName, currency, status, trialEndsAt } }` |
| POST | `/auth/logout` | Session | – | `204` |
| GET | `/workspaces/mine` | Session | – | `200 [{ slug, name }]` |
| GET | `/auth/sessions` | Session | – | `200 [{ id, dev, where, when, cur }]` |
| DELETE | `/auth/sessions/:id` | Session | – | `204` |
| DELETE | `/auth/sessions?others=1` | Session | – | `204` |
| POST | `/auth/password` | Session | `{ current, next }` | `200 { ok: true }`. The user's other sessions are revoked. |

**Rules:**
- **Lock-out:** after `LOGIN_MAX_ATTEMPTS` (default 5) failures per IP or email in `LOGIN_WINDOW_MINUTES` (15), sign-in returns `429 { error: "locked", retryAfter }`. A wrong password returns `401 { error: "invalid", attemptsLeft }`.
- **Two-step login** is required for `admin` and `hr`, and for everyone when the organisation's `require_2fa` is on.
- **Tickets** are single-use and last 10 minutes (30 minutes after sign-up or invitation).
- **Email codes** are 6 digits, valid 15 minutes, 5 attempts.

Example:
```http
POST https://acme.nexhr.com/api/auth/login
{ "email":"jo@acme.ie", "password":"correct-horse-42" }
200 { "next":"totp", "ticket":"q2V…" }

POST https://acme.nexhr.com/api/auth/totp
{ "ticket":"q2V…", "code":"492039" }
200 { "role":"admin" }        Set-Cookie: nxhr_sid=…; HttpOnly; Secure; SameSite=Strict
```

## 4. Company administration

| Method | Path | Auth | Body | Success response / notes |
| --- | --- | --- | --- | --- |
| GET | `/org` | Session | – | `{ id, slug, name, legalName, country, currency, timezone, leaveYearStart, dataRegion, require2fa }` |
| PATCH | `/org` | hr, admin | Any of `{ name, legalName, timezone, leaveYearStart, sizeBand, require2fa }`. `require2fa` is Admin only. | `{ ok: true }` |
| POST | `/org/locations` | hr, admin | `{ names: ["Dublin depot"] }` | `201`. Existing names are ignored. |
| POST | `/org/departments` | hr, admin | `{ names: ["Operations"] }` | `201` |
| GET | `/org/users` | hr, admin | – | `[{ id, name, email, role, status, totp, last_login_at, created_at }]` |
| POST | `/org/invitations` | hr, admin | `{ email, name, role }` | `201 { id }` and the invitation is emailed. Returns 409 `already_exists`. HR can't invite `admin`. |
| POST | `/org/users/:id/resend` | hr, admin | – | `{ ok: true }`: a new 7-day link is emailed |
| PATCH | `/org/users/:id` | hr, admin | `{ role }` | `{ ok: true }` and the user is signed out. Returns 409 `last_admin` or `cannot_change_own_role`; 403 if HR targets an Admin. |
| DELETE | `/org/users/:id` | hr, admin | – | `204`: access is disabled and the employee record is kept |
| POST | `/org/users/:id/reset-2fa` | admin | – | `{ ok: true }` |

## 5. Billing (Stripe)

| Method | Path | Auth | Body | Success response |
| --- | --- | --- | --- | --- |
| GET | `/billing` | admin | – | `{ status, trialEndsAt, currency, interval, billableEmployees, pricePerEmployee, card, periodEnd, cancelAtPeriodEnd }` |
| POST | `/billing/checkout` | admin | – | `{ url }`. Redirect to Stripe Checkout. Any remaining trial days are kept. |
| POST | `/billing/portal` | admin | – | `{ url }` for the Stripe billing portal (invoices, card, cancellation). Returns 409 `no_customer` before the first checkout. |
| PATCH | `/billing` | admin | `{ interval: "month" or "year" }` | `{ ok: true }`, pro-rated |

**How billing works:**
- **Prices:** £4, €4.50 or $5 per employee per month. Yearly is 10 × monthly.
- **Quantity:** the number of active, non-archived people (`billable_counts` view). It's synced on people changes and by `jobs.js seats`.
- **Webhook events handled:** `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Each event is processed once (`stripe_events`).

## 6. People and bank details

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/people` | Session (scoped) | – | `[{ id, name, first, ini, title, dept, team, loc, mgr, type, status, start, empNo, email, phone, weeklyMinutes, address, emergencyContact }]` |
| GET | `/people/:id` | Session (scoped) | – | One person, or 404 |
| POST | `/people` | hr, admin | `{ firstName, lastName, email, jobTitle, contractType, startDate, department?, location?, team?, managerId?, empNo?, preferredName?, phone?, status?, weeklyMinutes? }` | `201 { id }`. Billing seats are synced. Returns 409 `already_exists` (email or employee number). |
| PATCH | `/people/:id` | Self: `preferredName, phone, address, emergencyContact`. hr/admin: also `firstName, lastName, email, jobTitle, department, location, team, managerId, contractType, status, startDate, endDate, weeklyMinutes`. | Partial object | `{ ok: true }` |
| POST | `/people/:id/archive` | hr, admin | – | `{ ok: true }`: status becomes Left and seats are synced |
| GET | `/people/:id/bank` | Self, hr, admin | – | `{ bank, last4, method, updatedAt }`, masked |
| POST | `/people/:id/bank/reveal` | Self, hr, admin | `{ reason }`, required unless self (5+ characters) | `{ holder, bank, sort, acct }`. Every reveal is written to `audit_log` with the reason. |
| PUT | `/people/:id/bank` | Self, hr, admin | `{ holder, bank, sortCode, account, method? }` | `{ ok: true }`, encrypted at rest |

`contractType` is one of `Full-time`, `Part-time`, `Contractor`, `Bank`. `status` is one of `Active`, `Onboarding`, `On leave`, `Notice period`, `Left`.

## 7. Time: clock-in, attendance and timesheets

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/clock/today` | Session | – | `[{ action, at }]` |
| POST | `/clock` | Session | `{ action: "in", "break_start", "break_end" or "out", source? }` | Today's events. Returns 409 `invalid_sequence`, for example a break before clocking in. |
| GET | `/attendance/today` | manager, hr, admin | – | `[{ pid, state, firstIn, rostered }]`. `state` is `in`, `break_start`, `break_end`, `out` or `not_in`. |
| POST | `/timesheets` | Session | `{ weekCommencing: "2026-10-05" }` | `201` timesheet. Creates the week with 7 days, or returns the existing one. |
| GET | `/timesheets` | Session | – | Own last 12: `[{ id, pid, wc, status, by, at, comment, days: [{ date, start, end, breakMins, note }] }]` |
| GET | `/timesheets/team` | manager, hr, admin | `?status=Submitted` | `[{ id, pid, wc, mins, sched, status, flag }]` |
| PATCH | `/timesheets/:id/days/:date` | Owner | `{ start: "09:00", end: "17:30", breakMins: 60, note }` | `{ ok: true }`. Returns 400 if a time isn't valid 24-hour time or end isn't after start; 409 `not_editable` unless the status is Draft or Requires changes. |
| POST | `/timesheets/:id/submit` | Owner | – | `{ status: "Submitted" }`. The manager is notified. |
| POST | `/timesheets/:id/decision` | manager (own reports), hr, admin | `{ decision: "approve" or "changes", comment }`. A comment is required for `changes`. | `{ status }`. Nobody can approve their own timesheet. |

## 8. Leave

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/leave` | Session (scoped) | – | `[{ id, pid, type, from, to, days, status, note, sub }]` |
| GET | `/leave/types` | Session | – | `[{ id, name, deducts, needs_approval }]` |
| GET | `/leave/balance` | Session (scoped) | `?pid=` (defaults to self) | `{ entitlement, taken, booked, pending, remaining }` for the current year |
| POST | `/leave` | Session | `{ type, from, to, days, note? }` | `201 { id, status: "Pending" }`. The manager is notified. |
| POST | `/leave/:id/cancel` | Owner | – | `{ status: "Cancelled" }`, future leave only |
| POST | `/leave/:id/decision` | manager (own reports), hr, admin | `{ decision: "approve" or "decline", comment? }` | `{ status }` |
| PUT | `/leave/entitlements/:pid` | hr, admin | `{ year, days, carried? }` | `{ ok: true }` |

## 9. Rota

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/rota` | Session | `?from=YYYY-MM-DD&location=Name` | `{ shifts: [{ id, pid, date, code, start, end, location }], unavailable: { pid: [dates] }, published }`. Employees only see published weeks. |
| POST | `/rota/shifts` | manager, hr, admin | `{ pid, date, code, location, start?, end? }` | `{ id, warning }`. `warning` is `"on_leave"` if the person has approved leave that day. |
| PUT | `/rota/shifts/:id` | manager, hr, admin | Same as POST | `{ id, warning }` |
| DELETE | `/rota/shifts/:id` | manager, hr, admin | – | `204` |
| POST | `/rota/copy` | manager, hr, admin | `{ fromWeek, toWeek, location }` | `{ copied }` |
| POST | `/rota/publish` | manager, hr, admin | `{ week, location }` | `{ published: true, notified }` |
| PUT | `/rota/unavailability` | Session | `{ date, reason?, available? }` | `{ ok: true }` |

Shift codes and default times (24-hour):

| Code | Shift | Times |
| --- | --- | --- |
| `E` | Early | 07:30–15:30 |
| `D` | Day | 09:00–17:30 |
| `L` | Late | 12:00–20:00 |
| `S` | Saturday clinic | 08:30–16:00 |
| `H` | Half day | 09:00–13:00 |

## 10. Document requests, documents and payslips

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/document-requests` | Session (scoped) | – | `[{ id, ref, pid, type, purpose, addressee, details, delivery, status, fileId, sub, hist: [[status, at, by, note]] }]` |
| POST | `/document-requests` | Session | `{ type, purpose?, addressee?, details?, delivery }` | `201 { id, ref: "REQ-1001", status: "Submitted" }` |
| POST | `/document-requests/:id/status` | hr, admin | `{ status, note?, fileId? }` | `{ status }`. Moves forward only. `Rejected` needs a note. The employee is notified when the request is Ready or Rejected. |
| GET | `/documents` | Session | – | `[{ id, pid, title, category, fileId, requiresAck, acked, at }]`. Company-wide documents plus the caller's own; HR sees all. |
| POST | `/documents` | hr, admin | `{ title, category, fileId, personId?, requiresAck? }` | `201 { id }`. The recipients are notified. |
| POST | `/documents/:id/acknowledge` | Session | – | `{ ok: true }` |
| GET | `/payslips` | Self, hr, admin | `?pid=` | `[{ id, period, paid, gross, ot, net, currency, fileId }]` |
| POST | `/payslips` | hr, admin | `{ personId, period, paidOn, gross, overtime?, net?, fileId? }` | `201 { id }`. The employee is notified. |

Request `delivery` is one of `Download in NexHR`, `Email to work address`, `Posted to home address`. Statuses run in this order: `Submitted`, `In review`, `Processing`, `Ready`, `Completed`. `Rejected` is also possible.

## 11. Files

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/files` | Session | `multipart/form-data` with field `file`. PDF, DOCX, PNG or JPG, 10 MB maximum. | `201 { id, filename, bytes }`. Returns 413 or 415 if the file is too large or the wrong type. |
| GET | `/files/:id/url` | Session (must be allowed to read the file) | – | `{ url, expiresAt }`: a signed link valid for 5 minutes |
| GET | `/files/:id/download?exp=&sig=` | Signed link | – | The file as an attachment. Returns 403 `link_expired`, or 409 `scan_pending` / `file_quarantined`. |

Files are stored in `STORAGE_DIR/<org_id>/<file_id>.<ext>`, outside the web root. A user may read a file if they are HR or Admin, uploaded it, or are its recipient through a payslip, document or completed request.

## 12. News, notifications, audit and reports

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/news` | Session | – | `[{ id, title, body, audience, published_at, author }]` |
| POST | `/news` | hr, admin | `{ title, body, audience? }`, where `audience` is `All` or a location name | `201 { id }`. The audience is notified. |
| GET | `/notifications` | Session | – | `[{ id, kind, title, body, link, at, unread }]` (latest 100) |
| POST | `/notifications/:id/read` | Session | – | `{ ok: true }` |
| POST | `/notifications/read-all` | Session | – | `{ ok: true }` |
| GET | `/audit` | hr, admin | `?entity=&from=&to=&limit=` (maximum 1000) | `[{ at, who, action, entity, entity_id, reason, meta }]` |
| GET | `/reports/:name.csv` | manager (team only), hr, admin | `?from=&to=`, which defaults to the last 90 days | CSV. `name` is `hours`, `absence` or `headcount` (headcount is HR and Admin only). Each export is logged. |

## 13. Front-end mapping

The front end currently calls `assets/js/platform.js` (demo mode) instead of these endpoints. INTEGRATION_GUIDE.md maps every platform.js function and every `app.html` action to the endpoint above that replaces it.
