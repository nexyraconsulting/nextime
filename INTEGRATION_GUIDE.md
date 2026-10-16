# Integration guide

How to move the front end from demo mode (data in the browser) to the server and database. Read DEVELOPER_HANDOVER.md first.

## 1. How the front end is built
Each `.html` page is self-rendering. `support.js` reads the page's markup (between `<x-dc>` tags) and its `class Component extends DCLogic` logic, then renders with React. The logic behaves like a React class component (`state`, `setState`, `componentDidMount`), with `renderVals()` feeding the markup.

The pages:
- `index.html`, `pricing.html`: marketing. The only dynamic parts are the currency switch and the calculator.
- `signup.html`, `login.html`: every account action goes through `assets/js/platform.js`.
- `app.html`: the HR app.
  - `boot(pf)` reads the session and workspace.
  - `seed()` builds the sample HR data.
  - The methods under "SaaS workspace layer" drive the workspace switcher, banners, Users & access, Plan & billing and the security policy.

## 2. Replace platform.js with API calls
`platform.js` is the seam. Keep its exported function names and replace each body with a `fetch` to the matching endpoint (all `credentials: 'include'`):

| platform.js | Endpoint |
| --- | --- |
| `slugProblem(slug)` | `GET /api/public/workspaces/check?slug=` (debounce 300 ms) |
| `createTenant` + `createUser` | `POST /api/signup`, then `location.href = next` |
| `issueCode('verify')` / `checkCode('verify')` | `POST /api/signup/resend` / `POST /api/signup/verify` |
| `newSecret`, `qrSvg`, `otpauthUri` | `POST /api/auth/totp/enrol/start` (the server returns the secret and QR SVG) |
| `enableTotp`, `recoveryCodes` | `POST /api/auth/totp/enrol/finish` |
| `signIn(slug, email, password)` | `POST /api/auth/login` |
| `checkSecondFactor(u, code)` | `POST /api/auth/totp` |
| `startSession`, `getSession`, `endSession` | the cookie is set by the server; `GET /api/auth/me`; `POST /api/auth/logout` |
| `issueCode('reset')` / `setPassword` | `POST /api/auth/password/forgot` / `POST /api/auth/password/reset` |
| `readInvite` / `acceptInvite` | `GET /api/invitations/:token` / `POST /api/invitations/:token/accept` |
| `workspacesFor(email)` | `POST /api/workspaces/find` (login page) and `GET /api/workspaces/mine` (app switcher) |
| `getTenant` / `updateTenant` | `GET /api/org` / `PATCH /api/org` |
| `usersIn`, `invite`, `inviteLink`, `updateUser`, `removeUser`, `resetTotp` | `GET /api/org/users`, `POST /api/org/invitations`, `POST /api/org/users/:id/resend`, `PATCH` / `DELETE /api/org/users/:id`, `POST /api/org/users/:id/reset-2fa` |
| `startCheckout` (in app.html) | `POST /api/billing/checkout`, then `location.href = url` |
| "Manage billing in Stripe" | `POST /api/billing/portal`, then `location.href = url` |
| Billing period switch | `PATCH /api/billing` |

Remove what only demo mode needs:
- the demo code banners in `signup.html` and `login.html`
- `ensureDemo()`, `DEMO` and `demoSession()` (or point "Explore the demo" at a hosted, read-only demo workspace)
- the "Demo mode" copy on invitation links

**Sign-up across hosts:** step 1 runs on `www.nexhr.com`. After `POST /api/signup`, send the browser to the returned `next` URL (`https://<slug>.nexhr.com/signup.html?step=verify&u=…`). In `componentDidMount`, read `step` and `u` from the query string and continue at the verify step, so that steps 2–5 run on the workspace's own host and its session cookie.

## 3. app.html: session and data
Replace `boot(pf)` with:
```js
async boot() {
  const r = await fetch('/api/auth/me', { credentials: 'include' });
  if (!r.ok) return location.replace('login.html');
  const me = await r.json();               // { userId, name, email, role, personId, org }
  const persona = { employee: 'employee', manager: 'manager', hr: 'hr', admin: 'hr' }[me.role];
  this.setState({ authOk: true, ses: { ...me, demo: false, tenant: me.org.slug }, tenant: this.mapOrg(me.org), persona, ...(await this.load(me)) });
}
```
Any `401` from the API means signed out. `402` means show the "trial ended" screen.

Add a `load(me)` method that fetches in parallel and returns state in the shapes `seed()` produces:
```js
async load(me) {
  const get = u => fetch(u, { credentials: 'include' }).then(r => r.ok ? r.json() : Promise.reject(r));
  const [people, weeks, teamTs, leave, plan, requests, docs, notifs, sessions, wsUsers] = await Promise.all([
    get('/api/people'), get('/api/timesheets?mine=1'), get('/api/timesheets/team?status=Submitted'),
    get('/api/leave'), get('/api/rota?from=' + this.RW[0]), get('/api/document-requests'),
    get('/api/documents'), get('/api/notifications'), get('/api/auth/sessions'),
    ['hr', 'admin'].includes(me.role) ? get('/api/org/users') : []]);
  return { people, weeks, teamTs, leave, plan, requests, docs, notifs, sessions, wsUsers };
}
```
- `pidOf(role)` becomes `me.personId`.
- Remove the sample-data banner (`bn.sample`).
- `TODAY` is fixed to 7 Oct 2026 for the demo. Replace it with today's date.

## 4. Wire actions to endpoints
Keep the optimistic `setState` in each method, add the call below, and roll back and `toast()` an error if it fails.

- `clockIn` / `breakStart` / `breakEnd` / `clockOut`: `POST /api/clock` with `{ action }`
- `setTs`, `tsEdit`: `PATCH /api/timesheets/:weekId/days/:date` (times are `HH:MM`, 24-hour)
- `submitWeek`: `POST /api/timesheets/:weekId/submit`
- Manager approve / send back (timesheets): `POST /api/timesheets/:weekId/decision` with `{ decision, comment }`
- `submitLeave`: `POST /api/leave`
- `cancelLeave`: `POST /api/leave/:id/cancel`
- `decideLeave`: `POST /api/leave/:id/decision`
- `saveShift` / `delShift`: `PUT` / `DELETE /api/rota/shifts/:id`
- `copyWeek`: `POST /api/rota/copy`
- `publish`: `POST /api/rota/publish`
- `drNext` (final step): `POST /api/document-requests`
- `advanceReq` / `rejectReq`: `POST /api/document-requests/:id/status`
- `downloadReq` / `openPayslip` / `openDoc`: `GET /api/files/:id/url`
- `ackDoc`: `POST /api/documents/:id/acknowledge`
- `saveEdit`: `PATCH /api/people/:id`
- `doReveal`: `POST /api/people/:id/bank/reveal` with `{ reason }`
- `changePw`: `POST /api/auth/password`
- `aeNext` (final step): `POST /api/people`, then the server calls `syncSeats()`
- `doUpload`: `POST /api/files` (multipart)
- `postNews`: `POST /api/news`
- Notifications: `POST /api/notifications/:id/read`
- Sessions: `DELETE /api/auth/sessions/:id` or `?others=1`

`notify()` and `log()` become server responsibilities. Every write endpoint should insert into `notifications` and `audit_log` in the same transaction.

## 5. Demo-only features
- **"View as" persona switcher:** it already shows only in the demo workspace (`ses.demo`). Real users get the view for their role.
- **`dataState` / `viewport` Tweaks props:** keep them for QA builds only.

## 6. Run the API locally
See README.md › Local development. In short:
```
cp .env.example server/.env            # BASE_DOMAIN=localhost and NODE_ENV=development for local testing
OWNER_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres APP_DB_PASSWORD=devpassword bash database/setup_database.sh --with-demo
cd server && npm install
node createAdmin.js larkspur you@example.com "Your Name"
npm start                              # http://localhost:8080/?w=larkspur
```
Without `SMTP_URL`, emails (codes, invitations) are printed to the console. Without `STRIPE_SECRET_KEY`, the billing endpoints return `503 billing_not_configured`.

## 7. Switch the front end to API mode
1. Replace the function bodies in `assets/js/platform.js` (section 2) and `boot()` / `load()` in `app.html` (section 3).
2. Set `mode: 'api'` in `assets/js/appConfig.js` and remove the demo-only UI listed in section 2.
3. Test every row of the checklist in DEPLOYMENT.md › 13. Testing.
