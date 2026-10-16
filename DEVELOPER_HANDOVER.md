# Developer handover

Read this first. It covers what NexHR is, how it fits together, what's finished and what's left.

## 1. What you're taking over
NexHR is an HR SaaS product by Nexyra Consulting, with a marketing site, self-serve trials, per-company workspaces on subdomains, four roles, Stripe billing per employee (GBP, EUR or USD) and a full HR app.

| Part | State |
| --- | --- |
| Marketing site, pricing, sign-up, sign-in, HR app (all pages) | **Complete.** All screens and flows work. |
| Front-end data | **Demo mode.** Data is held in the visitor's browser (`assets/js/platform.js`, plus `seed()` in `app.html`). |
| API (`server/`) | **Complete:** every endpoint in API_DOCUMENTATION.md is implemented. Needs a test run against your database, Stripe test mode and SMTP. |
| Database (`database/`) | **Complete:** schema, indexes, row-level security, seed and the v1 migration. |
| Connecting front end to API | **To do.** This is the main remaining task (INTEGRATION_GUIDE.md). |

## 2. Architecture
```text
Browser ──HTTPS──► Nginx (TLS, headers) ──► Node/Express :8080 ──► PostgreSQL (RLS)
                                     │                  ├──► SMTP provider
                                     │                  ├──► Stripe API  ◄── Stripe webhooks
                                     │                  └──► STORAGE_DIR (uploaded files)
www.nexhr.com           → index.html, pricing.html, signup.html (step 1), /api/signup, /api/stripe/webhook
<workspace>.nexhr.com   → login.html (at /), app.html, signup steps 2–5, all other /api/*
```
- **Workspace resolution:** `slugFromHost()` in server.js takes the subdomain from `Host`. Outside production, `?w=` or the `X-NexHR-Workspace` header can stand in for it.
- **Tenant isolation:** every request runs in `tx(orgId, fn)`, which sets `app.org_id`. PostgreSQL RLS policies then hide every other organisation's rows. The API connects as `nexyra_app`, which isn't the table owner, so RLS can't be bypassed.
- **Sessions:** an opaque token in the host-only cookie `nxhr_sid`; only its SHA-256 hash is stored in `sessions`.
- **Pages:**
  - Each `.html` page is markup plus a `class Component extends DCLogic` logic block, rendered in the browser by `support.js`.
  - There's no build step, and no bundler or framework install for the front end.
  - Each page's logic works like a React class component, with `renderVals()` feeding the template.
  - **Styles are inline.** That's intentional for this runtime, so don't extract them into stylesheets.

## 3. Key files
| File | What to know |
| --- | --- |
| `assets/js/appConfig.js` | `baseDomain`, `mode` (`demo` / `api`), `supportEmail`, `qrScriptUrl` |
| `assets/js/platform.js` | The front-end seam. Every function corresponds to an API endpoint (INTEGRATION_GUIDE.md › 2). |
| `app.html` | The HR app. `boot()` reads the session. `seed()` builds the sample data. The "SaaS workspace layer" methods drive Users & access, Plan & billing, banners and the workspace switcher. |
| `server/server.js` | Middleware, workspace resolution, sign-up, sign-in, TOTP, invitations, company admin, billing, Stripe webhook, leave, static files |
| `server/hrRoutes.js` | All other HR endpoints |
| `server/jobs.js` | Cron jobs: `seats`, `cleanup`, `trial-reminders` |
| `database/rls_and_roles.sql` | Add every new tenant table to its list |

## 4. Roles and permissions
| Capability | Employee | Manager | HR | Admin |
| --- | --- | --- | --- | --- |
| Own profile, payslips, documents, clock-in, timesheet, leave, document requests | ✓ | ✓ | ✓ | ✓ |
| See direct reports' records | – | ✓ | All | All |
| Approve timesheets and leave | – | Team | All | All |
| Plan and publish the rota | – | Team | All | All |
| Add, edit and archive employees; issue documents and payslips; announcements | – | – | ✓ | ✓ |
| Reveal bank details (logged, reason required) | Own | – | ✓ | ✓ |
| Reports and CSV exports | – | Team (hours, absence) | ✓ | ✓ |
| Audit log, organisation settings | – | – | ✓ | ✓ |
| Invite users and change roles | – | – | Up to HR | ✓ |
| Security policy (2FA for everyone), plan and billing, assign Admin | – | – | – | ✓ |

**Enforcement rules:**
- **Server:** permissions are enforced by `role(...)` and the `canSee` / `scopeSql` helpers in `hrRoutes.js`.
- **App:** HR and Admin both use the app's `hr` view; Admins get the extra Settings tabs.
- **At least one Admin:** a workspace always keeps one, and the API refuses to demote or remove the last Admin.
- **2FA:** two-step login is mandatory for HR and Admin.

## 5. Business rules
- **Pricing:** £4, €4.50 or $5 per employee per month. Yearly is 10 × monthly. One plan with every feature.
- **Trial:** 14 days with no card.
  - If the trial ends without payment details, the API returns `402` for everything except sign-in and Admin billing, and the app shows "Your free trial has ended". Data is kept.
  - Admins get trial reminder emails 3 days and 1 day before the end.
- **Billable employees:** active, non-archived people. Seat counts sync on people changes and hourly by cron, and Stripe pro-rates the change.
- **Currency:** chosen at sign-up and fixed per subscription.
- **Workspace address:** 3–30 characters (a–z, 0–9, hyphen), from a reserved-name list, and not changeable in the app.
- **Time format:** 24-hour (`HH:MM`) everywhere, in both the UI and the API.

## 6. What's left to do (in order)
1. **Integrate the front end with the API** (INTEGRATION_GUIDE.md):
   - Replace the `platform.js` function bodies with `fetch` calls.
   - Replace `boot()` / `seed()` in `app.html` with `/api/auth/me` and `load()`.
   - Wire each action method to its endpoint.
   - Set `appConfig.mode = 'api'`.
2. **Sign-up across hosts:** step 1 runs on `www`. After `POST /api/signup`, the browser goes to the returned `next` URL on the new subdomain, and `signup.html` must resume at the verify step from `?step=verify&u=`.
3. **Test the API end to end** against PostgreSQL, Stripe test mode and a real SMTP sandbox, using the checklist in DEPLOYMENT.md › 13. Add automated tests (Jest and Supertest) for auth, RLS isolation and billing webhooks.
4. **Self-host React and the QR library:** run `scripts/vendor_frontend_libs.sh` and tighten the CSP.
5. **Virus scanning** for uploads: ClamAV or a cloud scanner. Set `files.scanned_ok`, then `VIRUS_SCAN=on`.
6. **Legal and compliance:** publish the terms of service, privacy notice, DPA and sub-processor list, and link them from `signup.html`. The "I agree" text currently has no links.
7. **Before the first real customer:** an independent security review and penetration test.

## 7. Known limitations
- **Demo mode** stores accounts, password hashes and TOTP secrets in browser `localStorage`. It's for demos only.
- **Sample data:** every demo-mode workspace shows the same Larkspur sample HR data, with a banner saying so.
- **External scripts:** `support.js` loads React 18.3.1 from unpkg.com (with SRI), and demo mode loads the QR library from unpkg.com, until you run the vendor script.
- **CSP:** `support.js` compiles page logic in the browser, so the CSP must allow `'unsafe-inline'` and `'unsafe-eval'` for scripts.
- **Fixed demo date:** the sample data is pinned to 7 Oct 2026 (`TODAY` in `app.html`). Use the real date once data comes from the API.
- **Not built yet:** single sign-on (Microsoft or Google) appears in Settings as "Not connected". Custom roles aren't implemented either; the button only shows a hint.
- **File storage** is local disk. For more than one server, switch `hrRoutes.js` to S3 or Azure Blob, keeping the same signed-link pattern.
- **One data region per deployment.** The region shown in Settings is informational.

## 8. Accounts and access you'll need
- Server SSH or sudo, plus DNS for the domain
- A PostgreSQL owner account
- Stripe: test and live keys, and dashboard access
- SMTP provider credentials
- Nothing secret is stored in this package. Every value goes in `server/.env` (see CONFIGURATION_CHECKLIST.md).

## 9. Brand
- **All pages** (marketing, pricing, sign-up, sign-in and the app) follow the current Nexyra Consulting website: Hanken Grotesk, Ink #0A0A0F on white, square corners, numbered section heads with 2px rules, Violet #7C3AED for actions, and the signature gradient (#A78BFA → #7C3AED → #3B82F6) on brand moments only. The marketing pages use the website's floating glass navigation and the dark animated hero.
- **Wordmark:** the Nexyra monogram followed by NEXHR, with HR in violet. In running text, write NexHR.
- **Reference:** `assets/brand/visualLanguage.html`.


## Update — Nexyra main navigation (October 2026)

- `assets/nav/` — the shared Nexyra main-site navigation, same files and structure as the main website's `/assets/nav/`:
  - `nexyra-nav.js` — behaviour (menu overlay, search, light/dark tone, `--nx-clear` spacing). One line per page in `<head>`:
    `<script src="assets/nav/nexyra-nav.js" data-active="products" data-product="nexhr" data-site="https://nexyraconsulting.co.uk/" data-local="nexhr" defer></script>`
  - `nexyra-nav.css` — styles. `nexyra-menu.js` — menu content (the only file to edit when the menu changes). `nexyra-search-index.js` / `nexyra-search-engine.js` — site search.
  - `data-site` sends Nexyra links to the main site; `data-local="nexhr"` keeps NEXHR links inside this app. Menu preview images (`*.jpg`) sit in the same folder.
  - To stay in sync, copy `nexyra-menu.js` and `nexyra-search-index.js` from the main site when they change.
- `assets/logos/nexhrLockupOnLight.svg` / `nexhrLockupOnDark.svg` — product lockups (NEXDrive-style monogram), used under the breadcrumb.
- `app.html` (signed-in workspace) intentionally keeps its own header.
- The DC runtime (`support.js`) loads React from unpkg by default; run `scripts/vendor_frontend_libs.sh` to self-host it before go-live.
