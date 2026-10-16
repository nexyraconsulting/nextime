-- NexHR database schema: tables, view and functions (PostgreSQL 14+).
-- Run order for a new install (see DATABASE_SETUP.md):
--   1. schema.sql   2. indexes.sql   3. rls_and_roles.sql   4. seed.sql (optional demo workspace)
-- Every tenant table carries org_id. rls_and_roles.sql adds row-level security so the API can only
-- ever see the organisation it has set in app.org_id.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Platform ---------------------------------------------------------------
CREATE TABLE organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$'),
  name text NOT NULL, legal_name text,
  country char(2) NOT NULL DEFAULT 'GB',
  currency char(3) NOT NULL DEFAULT 'GBP' CHECK (currency IN ('GBP','EUR','USD')),
  timezone text NOT NULL DEFAULT 'Europe/London',
  leave_year_start text NOT NULL DEFAULT '1 January',
  data_region text NOT NULL DEFAULT 'United Kingdom (London)',
  size_band text, require_2fa boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','paused','canceled')),
  trial_ends_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reserved_slugs (slug citext PRIMARY KEY);
INSERT INTO reserved_slugs VALUES ('www'),('app'),('api'),('admin'),('mail'),('help'),('support'),('status'),('billing'),('login'),('signup'),('docs'),('blog'),('static'),('assets'),('cdn'),('nexhr'),('nexyra');

CREATE TABLE subscriptions (
  org_id uuid PRIMARY KEY REFERENCES organisations ON DELETE CASCADE,
  stripe_customer_id text UNIQUE, stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'none',            -- mirrors Stripe: trialing, active, past_due, canceled, incomplete
  billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year')),
  quantity int NOT NULL DEFAULT 1,
  card_label text,                                -- e.g. "Visa ending 4242", from the webhook, never the card number
  current_period_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stripe_events (id text PRIMARY KEY, type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now());

-- Organisation structure ------------------------------------------------
CREATE TABLE locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, name text NOT NULL, UNIQUE (org_id, name));
CREATE TABLE departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, name text NOT NULL, UNIQUE (org_id, name));

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  emp_no text NOT NULL,
  first_name text NOT NULL, last_name text NOT NULL, preferred_name text,
  email citext NOT NULL, phone text,
  job_title text NOT NULL,
  department_id uuid REFERENCES departments, team text, location_id uuid REFERENCES locations,
  manager_id uuid REFERENCES people,
  contract_type text NOT NULL CHECK (contract_type IN ('Full-time','Part-time','Contractor','Bank')),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Onboarding','On leave','Notice period','Left')),
  start_date date NOT NULL, end_date date,
  weekly_minutes int NOT NULL DEFAULT 2250,
  address jsonb, emergency_contact jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, emp_no), UNIQUE (org_id, email)
);
-- Accounts -----------------------------------------------------------------
-- The same email can belong to several workspaces; each is a separate account.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  person_id uuid REFERENCES people,
  email citext NOT NULL, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('employee','manager','hr','admin')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  password_hash text,                 -- argon2id
  email_verified_at timestamptz,
  totp_secret_enc bytea,              -- pgp_sym_encrypt with DATA_ENCRYPTION_KEY
  totp_enabled_at timestamptz,
  recovery_codes text[],              -- sha256 hashes, removed when used
  invited_by uuid REFERENCES users, last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text, ip inet, location_label text,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
-- Short-lived tokens: email verification, password reset, invitation, and the sign-in ticket between password and 2FA.
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify','reset','invite','mfa_ticket','enrol')),
  token_hash text NOT NULL, tries int NOT NULL DEFAULT 0, meta jsonb,
  expires_at timestamptz NOT NULL, used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_attempts (id bigserial PRIMARY KEY, org_id uuid, ip inet, email citext, ok boolean NOT NULL, at timestamptz NOT NULL DEFAULT now());
-- Time ------------------------------------------------------------------------
CREATE TABLE clock_events (id bigserial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid NOT NULL REFERENCES people, action text NOT NULL CHECK (action IN ('in','break_start','break_end','out')), at timestamptz NOT NULL DEFAULT now(), source text);
CREATE TABLE timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people, week_commencing date NOT NULL,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Requires changes','Approved')),
  submitted_at timestamptz, decided_by uuid REFERENCES people, decided_at timestamptz, comment text,
  UNIQUE (person_id, week_commencing)
);
-- Times are stored as time (24-hour); the UI accepts and shows HH:MM.
CREATE TABLE timesheet_days (org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, timesheet_id uuid NOT NULL REFERENCES timesheets ON DELETE CASCADE, date date NOT NULL, start_time time, end_time time, break_minutes int NOT NULL DEFAULT 0, note text, PRIMARY KEY (timesheet_id, date));

-- Leave -----------------------------------------------------------------------
CREATE TABLE leave_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, name text NOT NULL, deducts boolean NOT NULL DEFAULT true, needs_approval boolean NOT NULL DEFAULT true, UNIQUE (org_id, name));
CREATE TABLE leave_entitlements (org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid NOT NULL REFERENCES people, leave_year int NOT NULL, days numeric(5,1) NOT NULL, carried numeric(5,1) NOT NULL DEFAULT 0, PRIMARY KEY (person_id, leave_year));
CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  ref text, person_id uuid NOT NULL REFERENCES people, leave_type_id uuid NOT NULL REFERENCES leave_types,
  date_from date NOT NULL, date_to date NOT NULL, half_day text CHECK (half_day IN ('am','pm')),
  days numeric(4,1) NOT NULL, note text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Declined','Cancelled')),
  decided_by uuid REFERENCES people, decided_at timestamptz, decision_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from), UNIQUE (org_id, ref)
);
-- Rota ------------------------------------------------------------------------
CREATE TABLE shifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid NOT NULL REFERENCES people, location_id uuid NOT NULL REFERENCES locations, date date NOT NULL, code text NOT NULL CHECK (code IN ('E','D','L','H','S')), start_time time NOT NULL, end_time time NOT NULL, UNIQUE (person_id, date));
CREATE TABLE unavailability (org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid NOT NULL REFERENCES people, date date NOT NULL, reason text, PRIMARY KEY (person_id, date));
CREATE TABLE rota_publications (org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, location_id uuid NOT NULL REFERENCES locations, week_commencing date NOT NULL, published_by uuid REFERENCES people, published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (location_id, week_commencing));

-- Documents, pay, comms ----------------------------------------------------
CREATE TABLE files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, storage_key text NOT NULL, filename text NOT NULL, mime text NOT NULL, bytes int NOT NULL, uploaded_by uuid REFERENCES people, scanned_ok boolean, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, ref text NOT NULL,
  person_id uuid NOT NULL REFERENCES people, type text NOT NULL, purpose text, addressee text, details text,
  delivery text NOT NULL CHECK (delivery IN ('Download in NexHR','Email to work address','Posted to home address')),
  status text NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted','In review','Processing','Ready','Completed','Rejected')),
  file_id uuid REFERENCES files, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, ref)
);
CREATE TABLE document_request_events (id bigserial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, request_id uuid NOT NULL REFERENCES document_requests ON DELETE CASCADE, status text NOT NULL, note text, by_person uuid REFERENCES people, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid REFERENCES people, title text NOT NULL, category text NOT NULL, file_id uuid REFERENCES files, requires_ack boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE document_acknowledgements (org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, document_id uuid NOT NULL REFERENCES documents, person_id uuid NOT NULL REFERENCES people, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (document_id, person_id));
CREATE TABLE payslips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid NOT NULL REFERENCES people, period text NOT NULL, paid_on date NOT NULL, gross numeric(10,2) NOT NULL, overtime numeric(10,2) NOT NULL DEFAULT 0, net numeric(10,2), currency char(3) NOT NULL DEFAULT 'GBP', file_id uuid REFERENCES files, UNIQUE (person_id, period));
CREATE TABLE bank_details (org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid PRIMARY KEY REFERENCES people, holder_enc bytea NOT NULL, bank_name text NOT NULL, sort_code_enc bytea NOT NULL, account_enc bytea NOT NULL, account_last4 text NOT NULL, method text, updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid NOT NULL REFERENCES people, kind text NOT NULL, title text NOT NULL, body text, link text, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notification_prefs (org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, person_id uuid NOT NULL REFERENCES people, topic text NOT NULL, email boolean NOT NULL DEFAULT true, in_app boolean NOT NULL DEFAULT true, PRIMARY KEY (person_id, topic));
CREATE TABLE news_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, title text NOT NULL, body text NOT NULL, audience text NOT NULL DEFAULT 'All', author_id uuid REFERENCES people, published_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, org_id uuid NOT NULL, actor_user_id uuid, actor_label text,
  action text NOT NULL, entity text NOT NULL, entity_id text, reason text, ip inet, meta jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
-- Billable employees: active, non-archived people. Stripe quantity is synced from this.
CREATE VIEW billable_counts AS
  SELECT org_id, count(*)::int AS employees FROM people WHERE archived_at IS NULL AND status <> 'Left' GROUP BY org_id;

-- The only cross-tenant read: "find my workspace" by email. Returns names and slugs, nothing else.
CREATE FUNCTION find_workspaces(p_email citext) RETURNS TABLE (slug citext, name text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ SELECT o.slug, o.name FROM users u JOIN organisations o ON o.id = u.org_id WHERE u.email = p_email AND u.status = 'active' $$;

