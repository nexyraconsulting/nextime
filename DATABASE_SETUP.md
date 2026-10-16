# Database setup

## 1. Requirements
- **PostgreSQL 14 or later**, either managed (Azure Database for PostgreSQL, AWS RDS, Google Cloud SQL, Supabase, Neon) or self-hosted.
- **Extensions:** `pgcrypto` (UUIDs and encryption) and `citext` (case-insensitive email). Both ship with PostgreSQL. `schema.sql` enables them, which needs the owner or superuser role.
- **Two database roles:**
  - **owner** runs the SQL files. Use the provider's admin user, or a role that owns the database.
  - **`nexyra_app`** is the API's login. It is created by `rls_and_roles.sql`, doesn't own the tables and is always subject to row-level security.
- **Client tools:** `psql` on the machine that runs the setup.
- **Sizing:** about 1 GB of storage per 1,000 employees per year of activity is a safe starting point. Files are stored on disk in `STORAGE_DIR`, not in the database.

## 2. Files
| File | Purpose | When to run |
| --- | --- | --- |
| `database/schema.sql` | Extensions, all tables, the `billable_counts` view, the `find_workspaces()` function | New install, step 1 |
| `database/indexes.sql` | All secondary indexes (`IF NOT EXISTS`, safe to re-run) | New install step 2; after every upgrade |
| `database/rls_and_roles.sql` | Creates `nexyra_app`, grants, row-level security policies; audit log made append-only | New install step 3; after every upgrade |
| `database/seed.sql` | Optional demo workspace `larkspur` (organisation, locations, departments, leave types, one Admin without a password) | Optional, step 4 |
| `database/migrations/001_saas_upgrade.sql` | Upgrades a NexHR v1 single-organisation database to multi-tenant | Only when upgrading v1 |
| `database/migrations/001_saas_upgrade_functions.sql` | Part 2 of the v1 upgrade (functions) | Only when upgrading v1 |
| `database/setup_database.sh` | Runs the new-install steps in order | Convenience |

## 3. Create the database (new install)
Option A, one command, from the package root:
```bash
OWNER_DATABASE_URL='postgres://OWNER_USER:OWNER_PASSWORD@DB_HOST:5432/postgres' \
APP_DB_PASSWORD='CHOOSE_A_STRONG_PASSWORD' \
bash database/setup_database.sh            # add --with-demo to load the demo workspace
```

Option B, step by step:
```bash
psql "$OWNER_URL_TO_POSTGRES_DB" -c "CREATE DATABASE nexhr"
psql "$OWNER_URL_TO_NEXHR_DB" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$OWNER_URL_TO_NEXHR_DB" -v ON_ERROR_STOP=1 -f database/indexes.sql
psql "$OWNER_URL_TO_NEXHR_DB" -v ON_ERROR_STOP=1 -v app_password='CHOOSE_A_STRONG_PASSWORD' -f database/rls_and_roles.sql
psql "$OWNER_URL_TO_NEXHR_DB" -v ON_ERROR_STOP=1 -f database/seed.sql      # optional
```
Then set this in `server/.env`:
```
DATABASE_URL=postgres://nexyra_app:CHOOSE_A_STRONG_PASSWORD@DB_HOST:5432/nexhr
```
On managed PostgreSQL that requires TLS, append `?sslmode=require`.

## 4. Seed data
`seed.sql` creates the demo workspace `larkspur` (Larkspur Care Group) with 4 locations, 7 departments and 5 leave types. It also creates one Admin, `admin@larkspurcare.co.uk`, with **no password**. To set one:
```bash
cd server && node createAdmin.js larkspur admin@larkspurcare.co.uk "Priya Nair"
```
Skip the seed in production unless you want a public demo workspace. Real customers create their workspaces through `signup.html`. The front-end sample HR data (people, rotas, timesheets) lives in `app.html` `seed()` and isn't in the database.

## 5. How tenants are isolated
- **One database for all customers.** Every tenant table has an `org_id` column.
- **Row-level security.** `rls_and_roles.sql` enables RLS on every tenant table with the policy `org_id = current_setting('app.org_id')::uuid`.
- **The API sets the organisation per request.** It runs each request in a transaction that first calls `set_config('app.org_id', <organisation>, true)`, so a query that forgets its `WHERE org_id` still returns only that organisation's rows.
- **Shared tables.** `organisations`, `subscriptions`, `stripe_events`, `reserved_slugs` and `auth_attempts` have no RLS. The API reads them by explicit key.
- **Cross-tenant lookup.** `find_workspaces(email)` is a `SECURITY DEFINER` function. It's the only cross-tenant lookup, and it returns workspace names and addresses only.
- **Billing count.** The `billable_counts` view runs with its owner's rights, so the billing job can count employees across organisations.

## 6. Relationships
```text
organisations 1─1 subscriptions
organisations 1─* locations, departments, people, users, leave_types, files, documents, news_posts, audit_log …
people        *─1 departments, locations;  people.manager_id → people (line manager)
users         *─1 people (optional: an Admin may have no employee record);  users.invited_by → users
sessions, auth_tokens  *─1 users
timesheets    *─1 people;  timesheet_days *─1 timesheets
leave_requests *─1 people, leave_types;  leave_entitlements *─1 people
shifts        *─1 people, locations;  unavailability *─1 people;  rota_publications *─1 locations
document_requests *─1 people, files;  document_request_events *─1 document_requests
documents     *─1 people (null = company-wide), files;  document_acknowledgements *─1 documents, people
payslips      *─1 people, files;  bank_details 1─1 people
notifications, notification_prefs *─1 people
```
Deleting an organisation cascades to all of its rows. Never hard-delete people: archive them (`archived_at`, status `Left`).

## 7. Tables and fields
### organisations
One row per customer workspace (tenant).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `slug` | citext | required; unique; check: slug ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$' |
| `name` | text | required |
| `legal_name` | text |  |
| `country` | char(2) | required; default 'GB' |
| `currency` | char(3) | required; default 'GBP'; check: currency IN ('GBP','EUR','USD') |
| `timezone` | text | required; default 'Europe/London' |
| `leave_year_start` | text | required; default '1 |
| `data_region` | text | required; default 'United |
| `size_band` | text |  |
| `require_2fa` | boolean | required; default false |
| `status` | text | required; default 'trialing'; check: status IN ('trialing','active','past_due','paused','canceled') |
| `trial_ends_at` | timestamptz | required; default now() + interval '14 days' |
| `created_at` | timestamptz | required; default now() |

### reserved_slugs
Workspace addresses nobody can register.

| Field | Type | Notes |
| --- | --- | --- |
| `slug` | citext | PK |

### subscriptions
Stripe subscription state, one per organisation.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | PK; → organisations (cascade) |
| `stripe_customer_id` | text | unique |
| `stripe_subscription_id` | text | unique |
| `status` | text | required; default 'none' |
| `incomplete` | billing_interval | required; default 'month'; check: billing_interval IN ('month','year') |
| `quantity` | int | required; default 1 |
| `card_label` | text |  |
| `from` | the |  |
| `never` | the |  |
| `cancel_at_period_end` | boolean | required; default false |
| `updated_at` | timestamptz | required; default now() |

### stripe_events
Processed Stripe webhook event IDs (idempotency).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | text | PK |
| `type` | text | required |
| `received_at` | timestamptz | required; default now() |

### locations
Sites / offices.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `name` | text | required |

Constraints: `UNIQUE (org_id, name)`

### departments
Departments.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `name` | text | required |

Constraints: `UNIQUE (org_id, name)`

### people
Employee records.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `emp_no` | text | required |
| `first_name` | text | required |
| `last_name` | text | required |
| `preferred_name` | text |  |
| `email` | citext | required |
| `phone` | text |  |
| `job_title` | text | required |
| `department_id` | uuid | → departments |
| `team` | text |  |
| `location_id` | uuid | → locations |
| `manager_id` | uuid | → people |
| `contract_type` | text | required; check: contract_type IN ('Full-time','Part-time','Contractor','Bank') |
| `status` | text | required; default 'Active'; check: status IN ('Active','Onboarding','On leave','Notice period','Left') |
| `start_date` | date | required |
| `end_date` | date |  |
| `weekly_minutes` | int | required; default 2250 |
| `address` | jsonb |  |
| `emergency_contact` | jsonb |  |
| `archived_at` | timestamptz |  |
| `created_at` | timestamptz | required; default now() |
| `updated_at` | timestamptz | required; default now() |

Constraints: `UNIQUE (org_id, emp_no)`, `UNIQUE (org_id, email)`

### users
Sign-in accounts (one per person per workspace).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | → people |
| `email` | citext | required |
| `name` | text | required |
| `role` | text | required; check: role IN ('employee','manager','hr','admin') |
| `status` | text | required; default 'invited'; check: status IN ('invited','active','disabled') |
| `password_hash` | text |  |
| `email_verified_at` | timestamptz |  |
| `totp_secret_enc` | bytea |  |
| `totp_enabled_at` | timestamptz |  |
| `recovery_codes` | text[] |  |
| `removed` | when | → users |
| `last_login_at` | timestamptz |  |
| `created_at` | timestamptz | required; default now() |

Constraints: `UNIQUE (org_id, email)`

### sessions
Signed-in sessions (token hashes only).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `user_id` | uuid | required; → users (cascade) |
| `token_hash` | text | required; unique |
| `user_agent` | text |  |
| `ip` | inet |  |
| `location_label` | text |  |
| `created_at` | timestamptz | required; default now() |
| `last_seen_at` | timestamptz | required; default now() |
| `expires_at` | timestamptz | required |
| `revoked_at` | timestamptz |  |

### auth_tokens
Email codes, reset codes, invitations, sign-in tickets (hashes only).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `user_id` | uuid | required; → users (cascade) |
| `kind` | text | required; check: kind IN ('verify','reset','invite','mfa_ticket','enrol') |
| `token_hash` | text | required |
| `tries` | int | required; default 0 |
| `meta` | jsonb |  |
| `expires_at` | timestamptz | required |
| `used_at` | timestamptz |  |
| `created_at` | timestamptz | required; default now() |

### auth_attempts
Sign-in attempts for rate limiting and lock-out.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `org_id` | uuid |  |
| `ip` | inet |  |
| `email` | citext |  |
| `ok` | boolean | required |
| `at` | timestamptz | required; default now() |

### clock_events
Raw clock-in / break / clock-out punches.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `action` | text | required; check: action IN ('in','break_start','break_end','out') |
| `at` | timestamptz | required; default now() |
| `source` | text |  |

### timesheets
One timesheet per person per week.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `week_commencing` | date | required |
| `status` | text | required; default 'Draft'; check: status IN ('Draft','Submitted','Requires changes','Approved') |
| `submitted_at` | timestamptz |  |
| `decided_by` | uuid | → people |
| `decided_at` | timestamptz |  |
| `comment` | text |  |

Constraints: `UNIQUE (person_id, week_commencing)`

### timesheet_days
Seven rows per timesheet, 24-hour start/end times.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | required; → organisations (cascade) |
| `timesheet_id` | uuid | required; → timesheets (cascade) |
| `date` | date | required |
| `start_time` | time |  |
| `end_time` | time |  |
| `break_minutes` | int | required; default 0 |
| `note` | text |  |

Constraints: `PRIMARY KEY (timesheet_id, date)`

### leave_types
Leave types per organisation.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `name` | text | required |
| `deducts` | boolean | required; default true |
| `needs_approval` | boolean | required; default true |

Constraints: `UNIQUE (org_id, name)`

### leave_entitlements
Days per person per leave year.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `leave_year` | int | required |
| `days` | numeric(5,1) | required |
| `carried` | numeric(5,1) | required; default 0 |

Constraints: `PRIMARY KEY (person_id, leave_year)`

### leave_requests
Leave requests and decisions.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `ref` | text |  |
| `person_id` | uuid | required; → people |
| `leave_type_id` | uuid | required; → leave_types |
| `date_from` | date | required |
| `date_to` | date | required |
| `half_day` | text | check: half_day IN ('am','pm') |
| `days` | numeric(4,1) | required |
| `note` | text |  |
| `status` | text | required; default 'Pending'; check: status IN ('Pending','Approved','Declined','Cancelled') |
| `decided_by` | uuid | → people |
| `decided_at` | timestamptz |  |
| `decision_comment` | text |  |
| `created_at` | timestamptz | required; default now() |

Constraints: `CHECK (date_to >= date_from)`, `UNIQUE (org_id, ref)`

### shifts
Rota shifts.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `location_id` | uuid | required; → locations |
| `date` | date | required |
| `code` | text | required; check: code IN ('E','D','L','H','S') |
| `start_time` | time | required |
| `end_time` | time | required |

Constraints: `UNIQUE (person_id, date)`

### unavailability
Days a person cannot work.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `date` | date | required |
| `reason` | text |  |

Constraints: `PRIMARY KEY (person_id, date)`

### rota_publications
Published rota weeks per location.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | required; → organisations (cascade) |
| `location_id` | uuid | required; → locations |
| `week_commencing` | date | required |
| `published_by` | uuid | → people |
| `published_at` | timestamptz | required; default now() |

Constraints: `PRIMARY KEY (location_id, week_commencing)`

### files
Uploaded file metadata (content is in STORAGE_DIR).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `storage_key` | text | required |
| `filename` | text | required |
| `mime` | text | required |
| `bytes` | int | required |
| `uploaded_by` | uuid | → people |
| `scanned_ok` | boolean |  |
| `created_at` | timestamptz | required; default now() |

### document_requests
Employee requests for letters and documents.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `ref` | text | required |
| `person_id` | uuid | required; → people |
| `type` | text | required |
| `purpose` | text |  |
| `addressee` | text |  |
| `details` | text |  |
| `delivery` | text | required; check: delivery IN ('Download in NexHR','Email to work address','Posted to home address') |
| `status` | text | required; default 'Submitted'; check: status IN ('Submitted','In review','Processing','Ready','Completed','Rejected') |
| `file_id` | uuid | → files |
| `created_at` | timestamptz | required; default now() |

Constraints: `UNIQUE (org_id, ref)`

### document_request_events
Status history of document requests.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `org_id` | uuid | required; → organisations (cascade) |
| `request_id` | uuid | required; → document_requests (cascade) |
| `status` | text | required |
| `note` | text |  |
| `by_person` | uuid | → people |
| `at` | timestamptz | required; default now() |

### documents
Policies, contracts and personal documents.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | → people |
| `title` | text | required |
| `category` | text | required |
| `file_id` | uuid | → files |
| `requires_ack` | boolean | required; default false |
| `created_at` | timestamptz | required; default now() |

### document_acknowledgements
Who has acknowledged which document.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | required; → organisations (cascade) |
| `document_id` | uuid | required; → documents |
| `person_id` | uuid | required; → people |
| `at` | timestamptz | required; default now() |

Constraints: `PRIMARY KEY (document_id, person_id)`

### payslips
Payslip records.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `period` | text | required |
| `paid_on` | date | required |
| `gross` | numeric(10,2) | required |
| `overtime` | numeric(10,2) | required; default 0 |
| `net` | numeric(10,2) |  |
| `currency` | char(3) | required; default 'GBP' |
| `file_id` | uuid | → files |

Constraints: `UNIQUE (person_id, period)`

### bank_details
Encrypted bank details.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | PK; → people |
| `holder_enc` | bytea | required |
| `bank_name` | text | required |
| `sort_code_enc` | bytea | required |
| `account_enc` | bytea | required |
| `account_last4` | text | required |
| `method` | text |  |
| `updated_at` | timestamptz | required; default now() |

### notifications
In-app notifications.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `kind` | text | required |
| `title` | text | required |
| `body` | text |  |
| `link` | text |  |
| `read_at` | timestamptz |  |
| `created_at` | timestamptz | required; default now() |

### notification_prefs
Notification preferences.

| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | required; → organisations (cascade) |
| `person_id` | uuid | required; → people |
| `topic` | text | required |
| `email` | boolean | required; default true |
| `in_app` | boolean | required; default true |

Constraints: `PRIMARY KEY (person_id, topic)`

### news_posts
Company announcements.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK; default gen_random_uuid() |
| `org_id` | uuid | required; → organisations (cascade) |
| `title` | text | required |
| `body` | text | required |
| `audience` | text | required; default 'All' |
| `author_id` | uuid | → people |
| `published_at` | timestamptz | required; default now() |

### audit_log
Append-only record of sensitive actions.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `org_id` | uuid | required |
| `actor_user_id` | uuid |  |
| `actor_label` | text |  |
| `action` | text | required |
| `entity` | text | required |
| `entity_id` | text |  |
| `reason` | text |  |
| `ip` | inet |  |
| `meta` | jsonb |  |
| `at` | timestamptz | required; default now() |

### View: billable_counts
| Field | Type | Notes |
| --- | --- | --- |
| `org_id` | uuid | Organisation |
| `employees` | int | People with `archived_at IS NULL` and status other than `Left` |

### Function: find_workspaces(p_email citext)
Returns `(slug, name)` for every active account with that email. Used by "Find my workspace" and the workspace switcher.

## 8. Indexes
Primary keys and `UNIQUE` constraints create their own indexes. `indexes.sql` adds:

| Index | Table | Columns |
| --- | --- | --- |
| `ix_people_org_id_manager_id` | people | org_id, manager_id |
| `ix_users_email` | users | email |
| `ix_auth_tokens_user_id_kind` | auth_tokens | user_id, kind |
| `ix_auth_attempts_ip_at` | auth_attempts | ip, at |
| `ix_auth_attempts_org_id_email_at` | auth_attempts | org_id, email, at |
| `ix_leave_requests_person_id_date_from` | leave_requests | person_id, date_from |
| `ix_notifications_person_id_created_at` | notifications | person_id, created_at DESC |
| `ix_audit_log_org_id_at` | audit_log | org_id, at DESC |
| `ix_people_org_id_status` | people | org_id, status |
| `ix_people_org_id_location_id` | people | org_id, location_id |
| `ix_users_org_id_role` | users | org_id, role |
| `ix_sessions_user_id` | sessions | user_id |
| `ix_sessions_expires_at` | sessions | expires_at |
| `ix_auth_tokens_expires_at` | auth_tokens | expires_at |
| `ix_clock_events_person_id_at` | clock_events | person_id, at DESC |
| `ix_timesheets_org_id_status_week_commencing` | timesheets | org_id, status, week_commencing |
| `ix_leave_requests_org_id_status` | leave_requests | org_id, status |
| `ix_shifts_org_id_location_id_date` | shifts | org_id, location_id, date |
| `ix_document_requests_org_id_status` | document_requests | org_id, status |
| `ix_documents_org_id_person_id` | documents | org_id, person_id |
| `ix_payslips_person_id_paid_on` | payslips | person_id, paid_on DESC |
| `ix_news_posts_org_id_published_at` | news_posts | org_id, published_at DESC |
| `ix_files_org_id` | files | org_id |

## 9. Upgrading from NexHR v1 (single organisation)
1. Back up: `pg_dump -Fc nexhr > nexhr_before_saas.dump`.
2. Check the address the migration gives your organisation (`UPDATE organisations SET slug = 'larkspur' …` in `001_saas_upgrade.sql`) and edit it if needed.
3. Run the upgrade as the owner:
   ```bash
   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_saas_upgrade.sql
   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_saas_upgrade_functions.sql
   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f database/indexes.sql
   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v app_password='…' -f database/rls_and_roles.sql
   ```
4. The old admin PIN is removed. Set Admin passwords with `node server/createAdmin.js <workspace> <email>`, or send password-reset emails.

## 10. Future migrations
- Add new files as `database/migrations/002_short_description.sql`, `003_…`, and so on. Make each one a single `BEGIN … COMMIT` transaction and safe to run once.
- Apply them in number order, then re-run `indexes.sql` and `rls_and_roles.sql`. Both are idempotent, and they pick up new tables and grants.
- Any new tenant table must have `org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE`, and must be added to the table list in `rls_and_roles.sql`.
- Record which migrations have run, for example in a `schema_migrations` table, or by using a tool such as node-pg-migrate or Flyway.

## 11. Backups and maintenance
- Take daily automated backups with point-in-time recovery, and keep at least 30 days.
- Back up `STORAGE_DIR` (uploaded files) on the same schedule.
- Store `DATA_ENCRYPTION_KEY` separately from database backups, for example in a password manager or secrets vault. Without it, bank details and authenticator secrets can't be decrypted.
- `node server/jobs.js cleanup` (daily, see DEPLOYMENT.md) removes expired tokens, old sessions, old sign-in attempts and old Stripe event IDs.
