-- Part 2 of the v1 to SaaS upgrade: functions that only exist in the SaaS schema.
-- The only cross-tenant read: "find my workspace" by email. Returns names and slugs, nothing else.
CREATE OR REPLACE FUNCTION find_workspaces(p_email citext) RETURNS TABLE (slug citext, name text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ SELECT o.slug, o.name FROM users u JOIN organisations o ON o.id = u.org_id WHERE u.email = p_email AND u.status = 'active' $$;

