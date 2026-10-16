-- NexHR indexes. Run after schema.sql. Safe to re-run (IF NOT EXISTS).
-- Primary keys and UNIQUE constraints already create their own indexes; these cover the API's lookups.
CREATE INDEX IF NOT EXISTS ix_people_org_id_manager_id ON people (org_id, manager_id);
CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_auth_tokens_user_id_kind ON auth_tokens (user_id, kind);
CREATE INDEX IF NOT EXISTS ix_auth_attempts_ip_at ON auth_attempts (ip, at);
CREATE INDEX IF NOT EXISTS ix_auth_attempts_org_id_email_at ON auth_attempts (org_id, email, at);
CREATE INDEX IF NOT EXISTS ix_leave_requests_person_id_date_from ON leave_requests (person_id, date_from);
CREATE INDEX IF NOT EXISTS ix_notifications_person_id_created_at ON notifications (person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_org_id_at ON audit_log (org_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_people_org_id_status ON people (org_id, status);
CREATE INDEX IF NOT EXISTS ix_people_org_id_location_id ON people (org_id, location_id);
CREATE INDEX IF NOT EXISTS ix_users_org_id_role ON users (org_id, role);
CREATE INDEX IF NOT EXISTS ix_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS ix_auth_tokens_expires_at ON auth_tokens (expires_at);
CREATE INDEX IF NOT EXISTS ix_clock_events_person_id_at ON clock_events (person_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_timesheets_org_id_status_week_commencing ON timesheets (org_id, status, week_commencing);
CREATE INDEX IF NOT EXISTS ix_leave_requests_org_id_status ON leave_requests (org_id, status);
CREATE INDEX IF NOT EXISTS ix_shifts_org_id_location_id_date ON shifts (org_id, location_id, date);
CREATE INDEX IF NOT EXISTS ix_document_requests_org_id_status ON document_requests (org_id, status);
CREATE INDEX IF NOT EXISTS ix_documents_org_id_person_id ON documents (org_id, person_id);
CREATE INDEX IF NOT EXISTS ix_payslips_person_id_paid_on ON payslips (person_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS ix_news_posts_org_id_published_at ON news_posts (org_id, published_at DESC);
CREATE INDEX IF NOT EXISTS ix_files_org_id ON files (org_id);
