# Deploying NexTime on GoDaddy (cPanel Node.js / Phusion Passenger)

This guide deploys the NexTime app + API (`app.js` → `server/server.js`, an Express app) on
**GoDaddy cPanel hosting with the "Setup Node.js App" tool**, which runs Node behind Phusion
Passenger. For a VPS/dedicated server the project also ships an Nginx + systemd path — see
`config/nginx.conf`, `config/nexhr-api.service` and `DEPLOYMENT.md`.

> Requires a GoDaddy plan whose cPanel shows **Setup Node.js App** (Business / cPanel Linux
> Hosting). The cheapest "Web Hosting" tiers and Managed WordPress do **not** run Node.

---

## 1. What runs where

| Piece | File | Notes |
|-------|------|-------|
| Passenger entry point | `app.js` | Just `require('./server/server.js')`. |
| API + static server | `server/server.js` | Serves `app.html` at `/`, `/assets/*`, and `/api/*`. Listens on `process.env.PORT` (Passenger passes a Unix-socket path). |
| Dependencies | `package.json` (app root) | cPanel's **Run NPM Install** installs `node_modules/` here; Node resolves `server/`'s `require`s from it. |
| Secrets | `server/.env` | Copy from `.env.example`. Or set the same keys in the cPanel Node.js UI. |

## 2. Prerequisites

- A **PostgreSQL** database (GoDaddy cPanel does not offer Postgres — use an external managed
  Postgres such as Supabase, Neon, RDS, or a GoDaddy VPS). You need its `DATABASE_URL`.
- An **SMTP** account for outgoing mail (verification codes, invites, resets).
- *(Optional)* **Stripe** keys for billing. Without them the app runs; billing returns `503`.
- A folder for uploaded files **outside the web root** (`STORAGE_DIR`), writable by the app user.

## 3. Upload the files

Upload the **entire contents of this folder** to your chosen application root, e.g.
`/home/<cpanel-user>/nextime` (keep it **outside** `public_html` if you don't want the source
files web-served; Passenger serves the app regardless of location).

- cPanel **File Manager** → upload a zip of this folder → Extract, **or**
- `git clone https://github.com/nexyraconsulting/nextime.git` over SSH if SSH is enabled.

Do **not** upload `node_modules/` or `server/.env` — cPanel installs the first, and you create
the second on the server.

## 4. Create the Node.js app in cPanel

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|-------|-------|
| Node.js version | **18 or newer** (matches `engines` in `package.json`) |
| Application mode | **Production** |
| Application root | the folder you uploaded to, e.g. `nextime` |
| Application URL | the domain/subdomain to serve from (e.g. `app.nexyra.com`) |
| **Application startup file** | **`app.js`** |

Click **Create**. cPanel writes the Passenger directives into `.htaccess` automatically (a block
marked `CLOUDLINUX PASSENGER CONFIGURATION BEGIN/END`) — leave that block in place.

## 5. Set environment variables

In the Node.js app screen, add each key under **Environment variables** (recommended on shared
hosting), **or** create `server/.env` from the template:

```bash
cp .env.example server/.env && chmod 600 server/.env
```

Required (see `.env.example` and `CONFIGURATION_CHECKLIST.md` for the full description of each):

- `NODE_ENV=production`
- `BASE_DOMAIN` — must match `baseDomain` in `assets/js/appConfig.js`
- `DATABASE_URL` — your Postgres connection string
- `DATA_ENCRYPTION_KEY`, `FILE_URL_SECRET` — 32+ random bytes each (`openssl rand -base64 48`)
- `STORAGE_DIR` — absolute path outside the web root
- `SMTP_URL`, `MAIL_FROM`

> **Do not set `PORT`.** Passenger injects it. The code reads `process.env.PORT` as-is (a socket
> path), so leave it unset in production. (`.env.example` lists `PORT=8080` only for local runs.)

Billing (optional): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_YEARLY`.

## 6. Install dependencies

In the Node.js app screen click **Run NPM Install** (it uses the root `package.json`). If SSH is
available you can instead enter the app's virtualenv (cPanel prints the exact
`source .../bin/activate` command) and run `npm install --omit=dev`.

## 7. Set up the database

Apply the schema to your Postgres instance (full detail in `DATABASE_SETUP.md`):

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/rls_and_roles.sql
psql "$DATABASE_URL" -f database/indexes.sql
# optional sample data:
psql "$DATABASE_URL" -f database/seed.sql
```

Create the first admin once the app is installed: `npm run create-admin`.

## 8. Start / restart

Click **Restart** in the Node.js app screen after any env-var, dependency, or code change.
Passenger (re)spawns the app using `app.js`.

## 9. Verify

- Visit the Application URL → you should get the NexTime app (`app.html`).
- `GET /api/health` (if present) or any `/api/*` route should respond from Node, not Apache.
- Check the app's log (path shown in the Node.js app screen) for `NexHR on <socket> for *.<domain>`.

## 10. Known caveat — subdomain-per-workspace

The app is multi-tenant: each workspace is served at `<workspace>.BASE_DOMAIN`. That needs a
**wildcard subdomain** (`*.BASE_DOMAIN`) pointing at this app, plus a wildcard TLS cert. GoDaddy
shared cPanel hosting has limited wildcard-subdomain and wildcard-cert support; if you can't add
`*.domain`, run on a single host/subdomain or move to a VPS using the Nginx path in
`config/nginx.conf`. Confirm your plan supports this before going live.

## 11. Updating later

```bash
git pull            # or re-upload changed files
# Run NPM Install again only if package.json changed
# then click Restart in the Node.js app screen
```
