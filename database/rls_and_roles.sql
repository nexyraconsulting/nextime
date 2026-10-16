-- NexHR row-level security and database roles. Run after schema.sql and indexes.sql, as the database owner.
-- Usage:
--   psql "$OWNER_DATABASE_URL" -v app_password='CHOOSE_A_STRONG_PASSWORD' -f database/rls_and_roles.sql
-- The API must connect as nexyra_app, which does not own the tables, so these policies always apply.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexyra_app') THEN CREATE ROLE nexyra_app LOGIN; END IF;
END $$;
ALTER ROLE nexyra_app PASSWORD :'app_password';
GRANT USAGE ON SCHEMA public TO nexyra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexyra_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexyra_app;
GRANT EXECUTE ON FUNCTION find_workspaces(citext) TO nexyra_app;
-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE ON audit_log FROM nexyra_app;

-- Row-level security ------------------------------------------------------
-- Each tenant table only shows rows for current_setting('app.org_id'), which the API sets per transaction.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['locations','departments','people','users','sessions','auth_tokens','clock_events','timesheets','timesheet_days',
    'leave_types','leave_entitlements','leave_requests','shifts','unavailability','rota_publications','files','document_requests',
    'document_request_events','documents','document_acknowledgements','payslips','bank_details','notifications','notification_prefs','news_posts','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = current_setting(''app.org_id'', true)::uuid) WITH CHECK (org_id = current_setting(''app.org_id'', true)::uuid)', t);
  END LOOP;
END $$;

