-- Demo workspace: larkspur.nexhr.com. Optional; skip it in production if you don't want a public demo.
-- Run as the table owner (RLS is bypassed for the owner).
INSERT INTO organisations (id, slug, name, legal_name, country, currency, timezone, status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'larkspur', 'Larkspur Care Group', 'Larkspur Care Group Ltd', 'GB', 'GBP', 'Europe/London', 'active', now());
INSERT INTO subscriptions (org_id, status) VALUES ('00000000-0000-0000-0000-000000000001', 'none');
INSERT INTO locations (org_id, name) VALUES
 ('00000000-0000-0000-0000-000000000001','Bristol Clinic'),
 ('00000000-0000-0000-0000-000000000001','Bath Clinic'),
 ('00000000-0000-0000-0000-000000000001','Cardiff Clinic'),
 ('00000000-0000-0000-0000-000000000001','Head Office, Bath');
INSERT INTO departments (org_id, name) VALUES
 ('00000000-0000-0000-0000-000000000001','Clinical'),('00000000-0000-0000-0000-000000000001','Front of House'),
 ('00000000-0000-0000-0000-000000000001','Operations'),('00000000-0000-0000-0000-000000000001','People'),
 ('00000000-0000-0000-0000-000000000001','Finance'),('00000000-0000-0000-0000-000000000001','Technology'),
 ('00000000-0000-0000-0000-000000000001','Leadership');
INSERT INTO leave_types (org_id, name, deducts) VALUES
 ('00000000-0000-0000-0000-000000000001','Annual leave',true),('00000000-0000-0000-0000-000000000001','Sick leave',false),
 ('00000000-0000-0000-0000-000000000001','Medical appointment',false),('00000000-0000-0000-0000-000000000001','Compassionate leave',false),
 ('00000000-0000-0000-0000-000000000001','Unpaid leave',false);
-- Admin account. It has no password: run POST /api/auth/password/forgot for this email after deploying,
-- or set one with: node server/createAdmin.js larkspur admin@larkspurcare.co.uk "Priya Nair"
INSERT INTO users (org_id, email, name, role, status, email_verified_at) VALUES
 ('00000000-0000-0000-0000-000000000001','admin@larkspurcare.co.uk','Priya Nair','admin','active', now());
