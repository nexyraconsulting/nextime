-- Upgrade the single-organisation NexHR database to the multi-tenant SaaS schema.
-- Back up first: pg_dump nexhr > nexhrBeforeSaas.sql
-- Run as the table owner, in one transaction. Then run, in order:
--   database/migrations/001_saas_upgrade_functions.sql, database/indexes.sql, database/rls_and_roles.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE organisations
  ADD COLUMN slug citext, ADD COLUMN legal_name text, ADD COLUMN country char(2) NOT NULL DEFAULT 'GB',
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'GBP', ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/London',
  ADD COLUMN leave_year_start text NOT NULL DEFAULT '1 January', ADD COLUMN data_region text NOT NULL DEFAULT 'United Kingdom (London)',
  ADD COLUMN size_band text, ADD COLUMN require_2fa boolean NOT NULL DEFAULT false,
  ADD COLUMN status text NOT NULL DEFAULT 'active', ADD COLUMN trial_ends_at timestamptz NOT NULL DEFAULT now();
-- Give each existing organisation an address. Edit before running if you want a different one.
UPDATE organisations SET slug = 'larkspur' WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE organisations SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;
ALTER TABLE organisations ALTER COLUMN slug SET NOT NULL, ADD CONSTRAINT organisations_slug_key UNIQUE (slug);

CREATE TABLE reserved_slugs (slug citext PRIMARY KEY);
INSERT INTO reserved_slugs VALUES ('www'),('app'),('api'),('admin'),('mail'),('help'),('support'),('status'),('billing'),('login'),('signup'),('docs'),('blog'),('static'),('assets'),('cdn'),('nexhr'),('nexyra');
CREATE TABLE subscriptions (
  org_id uuid PRIMARY KEY REFERENCES organisations ON DELETE CASCADE, stripe_customer_id text UNIQUE, stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'none', billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year')),
  quantity int NOT NULL DEFAULT 1, card_label text, current_period_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stripe_events (id text PRIMARY KEY, type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now());

-- Users: per-workspace accounts, new roles, password + TOTP. The admin PIN is retired.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'admin' WHERE role = 'hr_admin';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('employee','manager','hr','admin'));
ALTER TABLE users ALTER COLUMN email TYPE citext,
  ADD COLUMN name text, ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  ADD COLUMN email_verified_at timestamptz, ADD COLUMN totp_enabled_at timestamptz, ADD COLUMN recovery_codes text[],
  ADD COLUMN invited_by uuid REFERENCES users, ADD COLUMN last_login_at timestamptz;
UPDATE users SET name = split_part(email, '@', 1) WHERE name IS NULL;
UPDATE users SET status = 'disabled' WHERE disabled_at IS NOT NULL;
ALTER TABLE users ALTER COLUMN name SET NOT NULL, DROP COLUMN pin_hash, DROP COLUMN disabled_at, DROP COLUMN sso_subject,
  ADD CONSTRAINT users_org_email_key UNIQUE (org_id, email);
-- Existing accounts have no password yet. Send each one a reset email after deploying (POST /api/auth/password/forgot).

ALTER TABLE sessions ADD COLUMN org_id uuid REFERENCES organisations ON DELETE CASCADE;
UPDATE sessions s SET org_id = u.org_id FROM users u WHERE u.id = s.user_id;
DELETE FROM sessions WHERE org_id IS NULL; ALTER TABLE sessions ALTER COLUMN org_id SET NOT NULL;
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify','reset','invite','mfa_ticket','enrol')), token_hash text NOT NULL, tries int NOT NULL DEFAULT 0, meta jsonb,
  expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE auth_attempts ADD COLUMN org_id uuid, ALTER COLUMN email TYPE citext;

-- org_id on every tenant table that only had a person_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clock_events','timesheets','leave_entitlements','leave_requests','shifts','unavailability','document_requests',
    'payslips','bank_details','notifications','notification_prefs']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN org_id uuid REFERENCES organisations ON DELETE CASCADE', t);
    EXECUTE format('UPDATE %I x SET org_id = p.org_id FROM people p WHERE p.id = x.person_id', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
  END LOOP;
END $$;
ALTER TABLE timesheet_days ADD COLUMN org_id uuid REFERENCES organisations ON DELETE CASCADE;
UPDATE timesheet_days d SET org_id = t.org_id FROM timesheets t WHERE t.id = d.timesheet_id; ALTER TABLE timesheet_days ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE rota_publications ADD COLUMN org_id uuid REFERENCES organisations ON DELETE CASCADE;
UPDATE rota_publications r SET org_id = l.org_id FROM locations l WHERE l.id = r.location_id; ALTER TABLE rota_publications ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE document_request_events ADD COLUMN org_id uuid REFERENCES organisations ON DELETE CASCADE;
UPDATE document_request_events e SET org_id = r.org_id FROM document_requests r WHERE r.id = e.request_id; ALTER TABLE document_request_events ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE document_acknowledgements ADD COLUMN org_id uuid REFERENCES organisations ON DELETE CASCADE;
UPDATE document_acknowledgements a SET org_id = d.org_id FROM documents d WHERE d.id = a.document_id; ALTER TABLE document_acknowledgements ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE payslips ADD COLUMN currency char(3) NOT NULL DEFAULT 'GBP';

-- Refs were globally unique; make them unique per organisation.
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_ref_key, ADD CONSTRAINT leave_requests_org_ref_key UNIQUE (org_id, ref);
ALTER TABLE document_requests DROP CONSTRAINT IF EXISTS document_requests_ref_key, ADD CONSTRAINT document_requests_org_ref_key UNIQUE (org_id, ref);

CREATE VIEW billable_counts AS SELECT org_id, count(*)::int AS employees FROM people WHERE archived_at IS NULL AND status <> 'Left' GROUP BY org_id;
INSERT INTO subscriptions (org_id, status) SELECT id, 'none' FROM organisations ON CONFLICT DO NOTHING;
COMMIT;
