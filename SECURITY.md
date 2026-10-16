# Security

## Accounts and sign-in
- **Accounts are per workspace.** One email address can hold accounts in several workspaces, each with its own password and role.
- **Passwords:** at least 10 characters with a letter and a number. The server hashes them with Argon2id. In front-end demo mode, PBKDF2-SHA256 with 210,000 iterations is used instead.
- **Lock-out:** 5 failed attempts per IP or email in 15 minutes returns `429`. Every attempt is written to `auth_attempts`, and failures also go to `audit_log`.
- **Two-step login:** TOTP (RFC 6238). Secrets are encrypted at rest with `pgp_sym_encrypt` using `DATA_ENCRYPTION_KEY`.
  - Required for Admin and HR, and optional for everyone else unless an Admin requires it.
  - 8 single-use recovery codes, stored as SHA-256 hashes.
  - An Admin can reset another user's 2FA. That action is logged.
- **Sign-in ticket:** a correct password doesn't create a session when 2FA applies. The server issues a 10-minute single-use ticket that's only valid for the TOTP or enrolment step.
- **Email codes and links:** verification and reset codes are 6 digits, valid 15 minutes, 5 tries. Invitations last 7 days. Only hashes are stored. "Find my workspace" returns the same response whether or not the email exists.
- **Sessions:** httpOnly, Secure, SameSite=Strict, host-only cookie with an opaque token. Only the SHA-256 hash is stored.
  - 8-hour absolute and 30-minute idle timeout.
  - A password reset or role change revokes that user's sessions.

## Tenant isolation
1. The workspace comes from the request's host, never from the request body.
2. Every tenant table has `org_id` and a row-level security policy. The API runs each request inside a transaction with `app.org_id` set, so even a query that forgets its `WHERE org_id` can't read another company's rows.
3. The app connects as `nexyra_app`, which doesn't own the tables, so RLS can't be bypassed.
4. The only cross-tenant read is `find_workspaces(email)`, a `SECURITY DEFINER` function that returns names and addresses only.
5. Cookies are host-only, so a session can't be replayed against another workspace.

## Billing data
Card details go straight to Stripe Checkout and never reach NexHR. The database stores only Stripe IDs and a label such as "Visa ending 4242". Webhooks are verified with the signing secret and processed once (`stripe_events`).

## Front-end demo mode
`platform.js` keeps workspaces, password hashes and TOTP secrets in the browser's `localStorage`. Anyone with access to that browser profile can read or change them. This is for demos only. Production must use the server (see INTEGRATION_GUIDE.md).

## Data protection
- Bank details and NI numbers are encrypted at rest. They're masked by default and revealed only through `POST /api/people/:id/bank/reveal` with a reason, and each reveal is logged.
- Files (payslips, letters, uploads) go to private object storage, served through short-lived signed URLs.
  - Uploads are virus-scanned.
  - Allowed types are PDF, DOCX, PNG and JPG, up to 10 MB.
- `audit_log` is append-only: revoke UPDATE and DELETE from `nexyra_app`.
- **Roles:**
  - Nexyra is the processor and each customer is the controller.
  - Publish a data processing agreement and list your sub-processors (hosting, email provider, Stripe).
  - Support each customer's retention rules and right-of-access requests.
- **Data region:** the region shown in Settings is where that workspace's data is hosted. To offer more than one region, run one database per region and route by organisation.
- Rotate `DATA_ENCRYPTION_KEY` with a re-encryption job, never by editing `.env` alone.
