# Deployment

Step-by-step production deployment of NexHR on a Linux server with Nginx, Node.js and PostgreSQL. The examples use `nexhr.com`; replace it with your domain everywhere (`BASE_DOMAIN`, `assets/js/appConfig.js`, `config/nginx.conf`).

## 1. Server requirements
- Ubuntu 22.04/24.04 LTS (or any modern Linux), at least 1 vCPU, 1 GB RAM and 10 GB disk. Size up with users and uploads.
- A public IPv4 (and optionally IPv6) address, with ports 80 and 443 open. Port 8080 must **not** be open to the internet.
- The system clock synced by NTP. Authenticator codes depend on it.

## 2. Required software
```bash
sudo apt update && sudo apt install -y nginx postgresql-client curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs   # Node 20 LTS
sudo apt install -y certbot python3-certbot-nginx   # TLS
```
PostgreSQL 14+ can be managed (recommended) or local: `sudo apt install postgresql`.

## 3. Uploading the files
```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin nexhr
sudo mkdir -p /var/www/nexhr /var/lib/nexhr_storage /var/log/nexhr
# Upload the unzipped package contents to /var/www/nexhr (scp, rsync or SFTP), for example:
rsync -av --delete NexHR/ user@server:/var/www/nexhr/
sudo chown -R nexhr:nexhr /var/www/nexhr /var/lib/nexhr_storage /var/log/nexhr
sudo chmod 750 /var/lib/nexhr_storage
```

## 4. Folder structure on the server
```text
/var/www/nexhr/            package root (read-only for the service except server/node_modules)
  *.html, support.js, assets/   served by Node (whitelisted files only)
  server/                  API code, server/.env (chmod 600)
  database/, config/, scripts/, *.md   never served
/var/lib/nexhr_storage/    uploaded files (STORAGE_DIR), private, backed up
/var/log/nexhr/            job logs
```
The Node server serves only `index.html`, `pricing.html`, `signup.html`, `login.html`, `app.html`, `support.js`, `favicon.ico`, `manifest.webmanifest`, `robots.txt` and `/assets/`. Nginx also denies `server/`, `database/`, `config/`, `scripts/`, dotfiles, `.md`, `.sql` and `.sh`.

## 5. Environment configuration
```bash
cd /var/www/nexhr
sudo -u nexhr cp .env.example server/.env
sudo -u nexhr chmod 600 server/.env
sudo -u nexhr nano server/.env      # fill in every value in the Required section
```
Generate the secrets with `openssl rand -base64 48`, a different one for `DATA_ENCRYPTION_KEY` and `FILE_URL_SECRET`. Then edit `assets/js/appConfig.js` and set `baseDomain` to the same value as `BASE_DOMAIN`. Every value is explained in CONFIGURATION_CHECKLIST.md.

## 6. Database connection
- `DATABASE_URL` uses the `nexyra_app` role: `postgres://nexyra_app:PASSWORD@HOST:5432/nexhr`.
- For managed databases that require TLS, add `?sslmode=require`.
- Allow the server's IP in the database firewall.
- Test with `psql "$DATABASE_URL" -c "select 1"`.

## 7. Database import and setup
```bash
cd /var/www/nexhr
OWNER_DATABASE_URL='postgres://OWNER:PASSWORD@HOST:5432/postgres' APP_DB_PASSWORD='the nexyra_app password' \
  bash database/setup_database.sh             # --with-demo adds the larkspur demo workspace
```
For details, manual steps and upgrading a v1 database, see DATABASE_SETUP.md.

## 8. API configuration
```bash
cd /var/www/nexhr/server && sudo -u nexhr npm ci --omit=dev
sudo cp /var/www/nexhr/config/nexhr-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now nexhr-api
sudo systemctl status nexhr-api            # should be active (running)
curl -s http://127.0.0.1:8080/api/health   # {"ok":true,...}
```
**Stripe:**
1. Create the product "NexHR" with two recurring per-unit Prices:
   - monthly: £4, with currency options €4.50 and $5
   - yearly: £40, with currency options €45 and $50
2. Put the Price IDs in `.env`.
3. Enable the Customer portal: payment method updates, invoice history, and cancellation at the period end.
4. Add the webhook `https://www.nexhr.com/api/stripe/webhook` for the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
5. Optional: enable Stripe Tax and set `STRIPE_TAX=on`.

**Email:** set `SMTP_URL` and `MAIL_FROM` from your provider (Postmark, SendGrid, Amazon SES or Microsoft 365), and publish SPF, DKIM and DMARC records for the sending domain.

## 9. Domain configuration
At your DNS provider:
| Record | Name | Value |
| --- | --- | --- |
| A (and AAAA) | `nexhr.com` | server IP |
| A (and AAAA) | `www` | server IP |
| A (and AAAA) | `*` | server IP (wildcard: every workspace) |

## 10. SSL/HTTPS configuration
A wildcard certificate needs the DNS-01 challenge:
```bash
sudo certbot certonly --manual --preferred-challenges dns -d nexhr.com -d '*.nexhr.com'
# or, better, your DNS provider's plugin for automatic renewal, e.g. python3-certbot-dns-cloudflare
```
Then install the proxy:
```bash
sudo cp /var/www/nexhr/config/nginx.conf /etc/nginx/sites-available/nexhr
sudo ln -s /etc/nginx/sites-available/nexhr /etc/nginx/sites-enabled/nexhr
sudo nginx -t && sudo systemctl reload nginx
```
`nginx.conf` redirects HTTP to HTTPS and sets HSTS, the CSP and the other security headers. Check certificate renewal with `sudo certbot renew --dry-run`.

## 11. Permissions
| Path | Owner | Mode |
| --- | --- | --- |
| `/var/www/nexhr` | nexhr:nexhr | 755 folders / 644 files |
| `/var/www/nexhr/server/.env` | nexhr | 600 |
| `/var/lib/nexhr_storage` | nexhr | 750 (files 640) |
| `/var/log/nexhr` | nexhr | 750 |

The service runs as the unprivileged user `nexhr`, with `NoNewPrivileges` and `ProtectSystem=full`. Never run it as root.

## 12. Build process and scheduled jobs
- **No build step.** Optionally serve React and the QR library yourself:
  ```bash
  cd /var/www/nexhr && sudo -u nexhr bash scripts/vendor_frontend_libs.sh
  # then remove https://unpkg.com from the CSP in /etc/nginx/sites-available/nexhr and reload Nginx
  ```
- **Scheduled jobs** (`config/crontab.txt`): `sudo crontab -u nexhr /var/www/nexhr/config/crontab.txt`

| Job | When | What |
| --- | --- | --- |
| `node jobs.js seats` | Hourly at :15 | Updates each Stripe subscription's quantity to the number of billable employees |
| `node jobs.js cleanup` | Daily 03:30 | Deletes expired tokens, sessions over 30 days old, sign-in attempts over 90 days old and Stripe event IDs over 90 days old |
| `node jobs.js trial-reminders` | Daily 09:00 | Emails Admins 3 days and 1 day before their trial ends, if no payment details have been added |

There are no other background processes. The API server is the only long-running process.

## 13. Testing
After deploying, check each item:
- [ ] `https://www.nexhr.com` shows the marketing site; `/pricing.html` loads and the currency switch updates prices
- [ ] `https://unknown.nexhr.com` shows "We can't find a workspace at this address"
- [ ] `https://www.nexhr.com/api/health` returns `{"ok":true}`
- [ ] Navigation: the menu opens, Nexyra links go to nexyraconsulting.co.uk, NEXHR links stay on nexhr.com, search returns results, and the browser console shows no 404s for `/assets/nav/`
- [ ] Sign-up: verification email arrives → authenticator QR works → recovery codes shown → company and invitations saved → lands in the app on `<workspace>.nexhr.com`
- [ ] Invitation email link → set password → signed in with the right role
- [ ] Sign out, sign in with password + code; a recovery code works once only
- [ ] Five wrong passwords lock the account for 15 minutes
- [ ] Forgot password: code email → new password → old sessions signed out
- [ ] Plan & billing → Stripe Checkout in the workspace's currency (test card 4242 4242 4242 4242) → webhook updates the plan
- [ ] A session cookie from one workspace doesn't work on another (open `other.nexhr.com/app.html` and expect the sign-in page)
- [ ] `https://www.nexhr.com/server/server.js`, `/.env`, `/database/schema.sql` and `/README.md` all return 403 or 404
- [ ] Upload a PDF, open it through its link, and confirm the link expires after 5 minutes

## 14. Troubleshooting
| Problem | Check |
| --- | --- |
| 502 Bad Gateway | `systemctl status nexhr-api` and `journalctl -u nexhr-api -n 100`; is the API on port 8080? |
| Service won't start | A required variable is missing (the log names it), or `npm ci` wasn't run |
| Workspace not found on every subdomain | `BASE_DOMAIN` is wrong; Nginx must have `proxy_set_header Host $host` |
| Database errors `permission denied` | Run `rls_and_roles.sql` again as the owner |
| Certificate errors on subdomains | The certificate doesn't include `*.nexhr.com` |
| Webhook 400 "bad signature" | `STRIPE_WEBHOOK_SECRET` belongs to a different endpoint or mode (test or live) |
| Emails go to spam | SPF, DKIM and DMARC are missing for the `MAIL_FROM` domain |
| More issues | See README.md › Troubleshooting |

## 15. Updating and redeploying
```bash
pg_dump -Fc "$OWNER_DATABASE_URL_NEXHR" > /var/backups/nexhr_$(date +%F).dump   # back up first
rsync -av new_package/ /var/www/nexhr_new/
cp /var/www/nexhr/server/.env /var/www/nexhr_new/server/.env
cp /var/www/nexhr/assets/js/appConfig.js /var/www/nexhr_new/assets/js/appConfig.js   # if customised
cd /var/www/nexhr_new/server && npm ci --omit=dev
# apply new database/migrations/*.sql in order, then indexes.sql and rls_and_roles.sql (DATABASE_SETUP.md › 10)
sudo mv /var/www/nexhr /var/www/nexhr_previous && sudo mv /var/www/nexhr_new /var/www/nexhr
sudo chown -R nexhr:nexhr /var/www/nexhr && sudo systemctl restart nexhr-api
curl -s https://www.nexhr.com/api/health
```
To roll back, swap `nexhr_previous` back, restart the service, and restore the database dump if a migration ran.

## Static demo hosting (no server)
For a demo only: upload the package to any static host (Apache, Netlify, S3, Azure Static Web Apps). The included `.htaccess` blocks the non-public folders on Apache. In demo mode, everything is stored in the visitor's browser, and the server, database and Stripe aren't used.
