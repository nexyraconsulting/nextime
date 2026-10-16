# NexHR

NexHR is a multi-tenant HR software-as-a-service product by Nexyra. Companies start a 14-day free trial, get their own workspace address (`acme.nexhr.com`) and invite their staff. They then pay per employee per month in GBP, EUR or USD through Stripe.

## Main features
- **Marketing site and pricing:** currency switch and cost calculator.
- **Self-serve sign-up:**
  - email verification
  - two-step login (authenticator app) with recovery codes
  - company setup (locations, departments, leave year)
  - staff invitations
- **Sign-in:** email + password + authenticator code. Includes forgot password, "find my workspace" and accepting invitations.
- **HR app:**
  - dashboards for each role
  - clock-in and breaks; weekly timesheets with approval (24-hour time throughout)
  - rota planner with publish and leave-clash warnings
  - leave requests, balances and approvals
  - employee records, with logged bank-detail reveals
  - document requests, documents with acknowledgements, and payslips
  - announcements and notifications
  - attendance, CSV reports and the audit log
- **Company admin (Settings):**
  - organisation profile; structure; leave policies; working patterns
  - roles & permissions
  - users & access: invite, change role, reset 2FA, remove
  - security policy
  - plan & billing
- **Roles:** Employee, Manager, HR, Admin.

## Visual style
All pages (marketing, pricing, sign-up, sign-in and the app) follow the current Nexyra Consulting website:
- **Type and colour:** Hanken Grotesk, Ink #0A0A0F on white, Violet #7C3AED for actions.
- **Layout:** square corners, and numbered section heads with 2px rules.
- **Navigation and hero:** the website's floating glass navigation and the dark animated hero.
- **Gradient:** the signature gradient (#A78BFA → #7C3AED → #3B82F6) appears on brand moments only.

## Technology stack
| Layer | Technology |
| --- | --- |
| Front end | Static HTML pages rendered by `support.js` (a small runtime on React 18.3.1). No build step. Hanken Grotesk is self-hosted. |
| Front-end platform layer | `assets/js/platform.js` (ES module), configured by `assets/js/appConfig.js` |
| API and web server | Node.js 18+ with Express 4 (`server/`) |
| Database | PostgreSQL 14+ with row-level security |
| Authentication | Argon2id passwords, TOTP (otplib), httpOnly session cookies |
| Payments | Stripe Checkout, Billing portal and webhooks |
| Email | Any SMTP provider (nodemailer) |
| File storage | Private folder on the server (`STORAGE_DIR`) with signed download links |
| Reverse proxy | Nginx (config supplied). Apache works for static demo hosting (`.htaccess`). |

## Project structure
```text
NexHR/
├── index.html                 Marketing home page
├── pricing.html               Pricing and calculator
├── signup.html                Free-trial sign-up and onboarding
├── login.html                 Workspace sign-in, 2FA, password reset, invitations
├── app.html                   The HR application
├── support.js                 Page runtime (loads React)
├── favicon.ico  manifest.webmanifest  robots.txt  .htaccess
├── .env.example               Server environment template → copy to server/.env
├── README.md  DEPLOYMENT.md  DEVELOPER_HANDOVER.md  DATABASE_SETUP.md
├── API_DOCUMENTATION.md  CONFIGURATION_CHECKLIST.md  INTEGRATION_GUIDE.md  SECURITY.md
├── assets/
│   ├── js/        platform.js (platform layer), appConfig.js (front-end settings)
│   ├── nav/       Shared Nexyra navigation + search (same files as the main site's /assets/nav/), menu images
│   ├── fonts/     Hanken Grotesk (woff2)
│   ├── icons/     favicon.svg, PNG app icons, Apple touch icon
│   ├── logos/     Nexyra monogram and NexHR lock-ups (SVG)
│   └── brand/     visualLanguage.html (brand reference page)
├── server/
│   ├── server.js     Platform, auth, 2FA, invitations, admin, billing, leave, static files
│   ├── hrRoutes.js   People, time, rota, documents, payslips, files, news, audit, reports
│   ├── jobs.js       Scheduled jobs (seat sync, clean-up, trial reminders)
│   ├── createAdmin.js  Set a password or create an Admin from the command line
│   └── package.json
├── database/
│   ├── schema.sql  indexes.sql  rls_and_roles.sql  seed.sql  setup_database.sh
│   └── migrations/   001_saas_upgrade.sql, 001_saas_upgrade_functions.sql
├── config/
│   ├── nginx.conf          Reverse proxy, TLS, security headers
│   ├── nexhr-api.service   systemd unit
│   └── crontab.txt         Scheduled jobs
└── scripts/
    └── vendor_frontend_libs.sh   Self-host React and the QR library (removes the CDN dependency)
```

## Shared Nexyra navigation
The top navigation and search on `index.html`, `pricing.html`, `signup.html` and `login.html` come from `assets/nav/`. It's the same module and folder structure as the main Nexyra website (`/assets/nav/`). Each page loads it with one line in `<head>`:
```html
<script src="assets/nav/nexyra-nav.js" data-active="products" data-product="nexhr"
        data-site="https://nexyraconsulting.co.uk/" data-local="nexhr" defer></script>
```
| File | Purpose |
| --- | --- |
| `nexyra-nav.js` | Behaviour: menu overlay, search, light/dark tone, `--nx-clear` page offset. Loads the other files itself. |
| `nexyra-nav.css` | Styles |
| `nexyra-menu.js` | Menu content. The only file to edit when the menu changes. |
| `nexyra-search-index.js`, `nexyra-search-engine.js` | Site search content and ranking |
| `*.jpg` | Menu preview images |

- `data-site` sends Nexyra pages and the logo to the main website. `data-local="nexhr"` keeps NEXHR menu and search links inside this app.
- `app.html` (the signed-in workspace) keeps its own header and doesn't load the nav.
- **Keeping in sync:** when the main site's menu or search changes, copy `nexyra-menu.js` and `nexyra-search-index.js` from the main site into `assets/nav/`. Leave `nexyra-nav.js` alone: this copy adds `data-site` / `data-local` support.
- **Caching:** `/assets` is cached for 7 days. After a nav update, add a version to the script URL (`nexyra-nav.js?v=2`). The nav passes it on to the files it loads.

## System requirements
- **Server:** Linux (Ubuntu 22.04/24.04 LTS or similar), at least 1 vCPU and 1 GB RAM, Node.js 18 or 20 LTS, Nginx
- **Database:** PostgreSQL 14+
- **Domain:** DNS for `nexhr.com`, `www.nexhr.com` and `*.nexhr.com`, with a wildcard TLS certificate
- **Services:** an SMTP provider and a Stripe account
- **Users' browsers:** current Chrome, Edge, Safari or Firefox. HTTPS is required (Web Crypto).

## Installation (production)
The full procedure is in DEPLOYMENT.md. Summary:
```bash
# 1. Upload the package to /var/www/nexhr
# 2. Database
OWNER_DATABASE_URL='postgres://OWNER:PASSWORD@DB_HOST:5432/postgres' APP_DB_PASSWORD='…' bash database/setup_database.sh
# 3. Server
cp .env.example server/.env && chmod 600 server/.env   # fill in every Required value
cd server && npm ci --omit=dev
# 4. Service, proxy and jobs
sudo cp ../config/nexhr-api.service /etc/systemd/system/ && sudo systemctl enable --now nexhr-api
sudo cp ../config/nginx.conf /etc/nginx/sites-available/nexhr && sudo ln -s /etc/nginx/sites-available/nexhr /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
crontab -u nexhr ../config/crontab.txt
```

## Local development
```bash
# PostgreSQL running locally (e.g. docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16)
OWNER_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres APP_DB_PASSWORD=devpassword bash database/setup_database.sh --with-demo
cp .env.example server/.env
#   NODE_ENV=development, BASE_DOMAIN=localhost
#   DATABASE_URL=postgres://nexyra_app:devpassword@localhost:5432/nexhr
#   DATA_ENCRYPTION_KEY and FILE_URL_SECRET: any random strings, STORAGE_DIR=./storage_dev
#   leave SMTP_URL empty (emails print to the console) and the Stripe values empty
cd server && npm install
node createAdmin.js larkspur you@example.com "Your Name"
npm start
```
Then open http://localhost:8080 for the marketing site, or http://localhost:8080/login.html?w=larkspur for the workspace. Outside production, `?w=<workspace>` stands in for the subdomain.

**Front-end only:** you can try the pages without the server, using demo mode with data stored in the browser. Run `npx serve .` in the package root, open http://localhost:3000 and select *Explore the demo*.

## Environment variables
All server settings are in `server/.env`, copied from `.env.example`. Front-end settings are in `assets/js/appConfig.js`. CONFIGURATION_CHECKLIST.md lists every value and marks each one Required or Optional.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV`, `PORT` | Yes | `production`; the port the proxy forwards to (8080) |
| `BASE_DOMAIN` | Yes | Root domain; workspaces are `<slug>.BASE_DOMAIN` |
| `DATABASE_URL` | Yes | PostgreSQL connection as `nexyra_app` |
| `DATA_ENCRYPTION_KEY` | Yes | Encrypts TOTP secrets and bank details |
| `FILE_URL_SECRET` | Yes | Signs file download links |
| `STORAGE_DIR` | Yes | Private folder for uploads |
| `SMTP_URL`, `MAIL_FROM` | Yes | Outgoing email |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | Yes, for billing | Stripe |
| `STRIPE_TAX`, `SESSION_HOURS`, `SESSION_IDLE_MINUTES`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES`, `VIRUS_SCAN`, `CORS_ORIGINS` | No | Tuning and options |

## Database setup
See DATABASE_SETUP.md. It covers requirements, the run order (`schema.sql`, then `indexes.sql`, then `rls_and_roles.sql`, then the optional `seed.sql`), every table and field, relationships, indexes and migrations.

## Server setup
- **Process:** one Node process (`server/server.js`) serves both the API (`/api/*`) and the public pages, and runs under systemd (`config/nexhr-api.service`).
- **Proxy:** Nginx terminates TLS and passes the `Host` header through. The API uses `Host` to work out the workspace.
- **Scheduled jobs:** cron runs `server/jobs.js` (`config/crontab.txt`).
- **Stripe** sends webhooks to `https://www.<BASE_DOMAIN>/api/stripe/webhook`.

## Build and deployment process
There is no build step: the HTML, JS and CSS are deployed as they are. The server only needs `npm ci`. Optionally, run `bash scripts/vendor_frontend_libs.sh` once to serve React and the QR library from your own server instead of unpkg.com.

## Starting the application
```bash
sudo systemctl start nexhr-api      # or: cd server && npm start
curl https://www.nexhr.com/api/health   # → {"ok":true,"version":"1.0.0"}
```

## Updating the application
1. Back up the database and `STORAGE_DIR`.
2. Upload the new package to a new folder, for example `/var/www/nexhr_new`. Copy in `server/.env`, plus `assets/js/appConfig.js` if you changed it.
3. Run `cd server && npm ci --omit=dev`.
4. Apply any new `database/migrations/*.sql` files in order, then re-run `indexes.sql` and `rls_and_roles.sql`.
5. Swap the folders (`mv`) and run `sudo systemctl restart nexhr-api`. Check `/api/health`.
6. To roll back, swap the folders back and restore the database backup if a migration ran.

## Troubleshooting
| Symptom | Cause / fix |
| --- | --- |
| Server exits with `Missing required environment variable` | Fill in `server/.env` from `.env.example` |
| Every workspace shows "We can't find a workspace" | `BASE_DOMAIN` doesn't match the domain, or Nginx doesn't pass `Host` (`proxy_set_header Host $host`) |
| `permission denied for table …` | `rls_and_roles.sql` wasn't run, or a new table was added without a grant. Re-run it as the owner. |
| Queries return no rows | The API is connecting as a role without `app.org_id`, or a new table is missing from the RLS list |
| Sign-in fails with "A secure connection (HTTPS) is required" | The site is on plain HTTP. Use HTTPS (or `localhost` for development). |
| Authenticator codes are always wrong | The server or phone clock is off. Enable NTP (`timedatectl set-ntp true`). |
| No emails | `SMTP_URL` is wrong, or the provider blocks the sender. Check the logs (`journalctl -u nexhr-api`) and SPF/DKIM. |
| Plan & billing returns 503 | The Stripe variables are missing |
| Stripe payments succeed but the plan doesn't update | Webhook URL or secret is wrong. Check the Stripe dashboard › Webhooks. |
| Pages are blank | The browser can't reach unpkg.com (React), or the CSP blocks it. Run `scripts/vendor_frontend_libs.sh`, or allow unpkg in the CSP. |
| Uploads fail with 413 | Nginx `client_max_body_size` is below 11m |

## Important: demo mode vs production
The front end ships in **demo mode** (`appConfig.mode: 'demo'`): workspaces, accounts and sample HR data are kept in the visitor's browser so the product can be shown without a server. The server and database in this package are complete. Connecting the pages to them is the main remaining development task, described step by step in INTEGRATION_GUIDE.md. Start with DEVELOPER_HANDOVER.md.
