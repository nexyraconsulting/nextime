# Configuration checklist

Every value you must set before going live:
- **Server values** go in `server/.env`, copied from `.env.example`.
- **Front-end values** go in `assets/js/appConfig.js`.

This package contains no real secrets.

## Required

### Domain and application URL
| Setting | Where | Value / how to get it | Done |
| --- | --- | --- | --- |
| `BASE_DOMAIN` | `server/.env` | e.g. `nexhr.com`. Workspaces become `<slug>.nexhr.com`, and the marketing site is `www.nexhr.com`. | [ ] |
| `baseDomain` | `assets/js/appConfig.js` | Same value as `BASE_DOMAIN` | [ ] |
| `server_name`, certificate paths | `config/nginx.conf` | Replace `nexhr.com` and the `/etc/letsencrypt/live/nexhr.com/` paths | [ ] |
| DNS records | DNS provider | A/AAAA records for `@`, `www` and `*`, all pointing at the server | [ ] |
| Wildcard TLS certificate | Server | One certificate covering `nexhr.com` and `*.nexhr.com` (DEPLOYMENT.md › 10) | [ ] |
| `NODE_ENV` | `server/.env` | `production` | [ ] |
| `PORT` | `server/.env` | `8080`. Must match `proxy_pass` in `nginx.conf`. | [ ] |

### Database
| Setting | Where | Notes | Done |
| --- | --- | --- | --- |
| Database host and port | `DATABASE_URL` | e.g. `db.example.com:5432` | [ ] |
| Database name | `DATABASE_URL` | `nexhr` | [ ] |
| Database username | `DATABASE_URL` | `nexyra_app`, created by `rls_and_roles.sql`. Never use the owner role. | [ ] |
| Database password | `DATABASE_URL`, and `APP_DB_PASSWORD` during setup | Strong and unique | [ ] |
| TLS to the database | `DATABASE_URL` | Append `?sslmode=require` on managed databases | [ ] |
| Owner credentials | `OWNER_DATABASE_URL`, setup only | Used once to run the SQL files. Don't store them in `.env`. | [ ] |

Format: `DATABASE_URL=postgres://nexyra_app:PASSWORD@HOST:5432/nexhr`

### Secrets
| Setting | Where | How | Done |
| --- | --- | --- | --- |
| `DATA_ENCRYPTION_KEY` | `server/.env` | Generate with `openssl rand -base64 48`. It encrypts TOTP secrets and bank details. **Back it up separately: if it's lost, that data can't be recovered.** | [ ] |
| `FILE_URL_SECRET` | `server/.env` | Generate a different value with `openssl rand -base64 48`. It signs file download links. | [ ] |

### Storage
| Setting | Where | Notes | Done |
| --- | --- | --- | --- |
| `STORAGE_DIR` | `server/.env` | e.g. `/var/lib/nexhr_storage`. Must be outside the web root, writable by the `nexhr` user and included in backups. Must match `ReadWritePaths` in `config/nexhr-api.service`. | [ ] |

### Email (SMTP)
| Setting | Where | Example | Done |
| --- | --- | --- | --- |
| `SMTP_URL` | `server/.env` | `smtps://USER:PASSWORD@smtp.provider.com:465`, from your email provider | [ ] |
| `MAIL_FROM` | `server/.env` | `NexHR <no-reply@nexhr.com>`. Set up SPF, DKIM and DMARC for this domain. | [ ] |

### Stripe (required for billing)
| Setting | Where | How | Done |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | `server/.env` | Stripe Dashboard › Developers › API keys. Use `sk_test_…` until launch, then `sk_live_…`. | [ ] |
| `STRIPE_PRICE_MONTHLY` | `server/.env` | Price ID of the monthly per-unit price: £4, with currency options €4.50 and $5 | [ ] |
| `STRIPE_PRICE_YEARLY` | `server/.env` | Price ID of the yearly price: £40, €45 and $50 | [ ] |
| `STRIPE_WEBHOOK_SECRET` | `server/.env` | Create the endpoint `https://www.<BASE_DOMAIN>/api/stripe/webhook` with the events listed in DEPLOYMENT.md › 8, then copy its `whsec_…` value | [ ] |
| Customer portal | Stripe Dashboard | Turn on payment method updates, invoice history and cancel at period end | [ ] |

### Front end
| Setting | Where | Notes | Done |
| --- | --- | --- | --- |
| `mode` | `assets/js/appConfig.js` | Keep `'demo'` until INTEGRATION_GUIDE.md is done, then set it to `'api'` | [ ] |
| `supportEmail` | `assets/js/appConfig.js`; the menus and footers of `index.html` and `pricing.html` | Your support address | [ ] |
| Legal links | Footers of `index.html` and `pricing.html` (Privacy Policy, Terms of Use); the terms checkbox in `signup.html` | Check that the links work, and add the NexHR terms of service and data processing agreement | [ ] |

### Server
| Setting | Where | Notes | Done |
| --- | --- | --- | --- |
| Service user and paths | `config/nexhr-api.service` | `User=nexhr`, `WorkingDirectory=/var/www/nexhr/server`, `ReadWritePaths` set to `STORAGE_DIR` | [ ] |
| Cron jobs | `config/crontab.txt` | Check the paths, then install with `crontab -u nexhr` | [ ] |
| Time sync | Server | `timedatectl set-ntp true`. Authenticator codes depend on an accurate clock. | [ ] |

## Optional
| Setting | Where | Default | Purpose |
| --- | --- | --- | --- |
| `STRIPE_TAX` | `server/.env` | `off` | `on` adds VAT or sales tax at checkout. Stripe Tax must be turned on in your Stripe account. |
| `SESSION_HOURS` | `server/.env` | `8` | Maximum session length |
| `SESSION_IDLE_MINUTES` | `server/.env` | `30` | Sign-out after inactivity |
| `LOGIN_MAX_ATTEMPTS` | `server/.env` | `5` | Failed sign-ins before lock-out |
| `LOGIN_WINDOW_MINUTES` | `server/.env` | `15` | Lock-out window |
| `VIRUS_SCAN` | `server/.env` | `off` | `on` holds uploads until a virus scanner sets `files.scanned_ok` |
| `CORS_ORIGINS` | `server/.env` | empty | Only needed if the pages are served from a different origin than the API |
| `qrScriptUrl` | `assets/js/appConfig.js` | unpkg URL | `scripts/vendor_frontend_libs.sh` changes it to `assets/vendor/qrcode.js` |
| Self-hosted React | `support.js` | unpkg | Run `scripts/vendor_frontend_libs.sh`, then remove `https://unpkg.com` from the CSP |
| Demo workspace | `database/seed.sql` | not loaded | Use `setup_database.sh --with-demo` for a public demo |
| Prices | `server/server.js` (`PER_EMPLOYEE`), `assets/js/platform.js` (`CURRENCIES`), `index.html`, `pricing.html`, `signup.html` | £4 / €4.50 / $5 | Change these together with the Stripe prices |
| Trial length | `server/server.js` and `assets/js/platform.js` (`TRIAL_DAYS`), plus the marketing copy | 14 days | |
| Reserved workspace names | `reserved_slugs` table, and `RESERVED` in `platform.js` | 18 names | Add your brand and system names |

## Never commit
- `server/.env`
- Database dumps
- The contents of `STORAGE_DIR`
- Stripe or SMTP credentials
