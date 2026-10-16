// NexHR SaaS API: workspaces on subdomains, email + password + TOTP sign-in, roles, invitations,
// Stripe subscriptions billed per employee in GBP, EUR or USD, and the leave endpoints as the pattern
// for the remaining resources (see docs/API.md).
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const argon2 = require('argon2');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');
const cors = require('cors');
const hrRoutes = require('./hrRoutes');

const env = process.env;
const BASE = (env.BASE_DOMAIN || 'nexhr.com').toLowerCase();
const PROD = env.NODE_ENV === 'production';
const ENC_KEY = env.DATA_ENCRYPTION_KEY;
const SESSION_MS = (+env.SESSION_HOURS || 8) * 3600e3;
const IDLE_MS = (+env.SESSION_IDLE_MINUTES || 30) * 60e3;
const MAX_TRIES = +env.LOGIN_MAX_ATTEMPTS || 5;
const WINDOW_MIN = +env.LOGIN_WINDOW_MINUTES || 15;
const TRIAL_DAYS = 14;
const CURRENCIES = ['GBP', 'EUR', 'USD'];
// One Stripe Price per interval, each with currency_options for GBP, EUR and USD (see docs/SAAS.md).
const PRICE = { month: env.STRIPE_PRICE_MONTHLY, year: env.STRIPE_PRICE_YEARLY };
const PER_EMPLOYEE = { GBP: 4, EUR: 4.5, USD: 5 };
const ROLES = ['employee', 'manager', 'hr', 'admin'];

const db = new Pool({ connectionString: env.DATABASE_URL });
const stripe = env.STRIPE_SECRET_KEY ? Stripe(env.STRIPE_SECRET_KEY) : null;
const mailer = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
authenticator.options = { step: 30, window: 1, digits: 6 };

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
// CORS is only needed if the front end is served from a different origin than the API (see API_DOCUMENTATION.md).
if (env.CORS_ORIGINS) app.use('/api', cors({ origin: env.CORS_ORIGINS.split(',').map(s => s.trim()), credentials: true }));

for (const k of ['DATABASE_URL', 'DATA_ENCRYPTION_KEY', 'BASE_DOMAIN']) if (!env[k]) { console.error('Missing required environment variable ' + k + ' (see .env.example)'); process.exit(1); }

/* ---------- helpers ---------- */
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const code6 = () => String(crypto.randomInt(100000, 1000000));
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, status, error, extra) => res.status(status).json({ error, ...(extra || {}) });
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
const passwordProblem = p => (!p || p.length < 10) ? 'Use at least 10 characters' : (!/[a-z]/i.test(p) || !/\d/.test(p)) ? 'Include a letter and a number' : '';
const wsUrl = (slug, page) => (PROD ? 'https://' : 'http://') + slug + '.' + BASE + '/' + (page || '');

// Runs fn inside a transaction with app.org_id set, so row-level security limits every query to one organisation.
async function tx(orgId, fn) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    if (orgId) await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const r = await fn(c); await c.query('COMMIT'); return r;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function audit(c, orgId, userId, action, entity, entityId, req, meta) {
  await c.query('INSERT INTO audit_log (org_id, actor_user_id, action, entity, entity_id, ip, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [orgId, userId, action, entity, entityId == null ? null : String(entityId), req.ip, meta || null]);
}
async function send(to, subject, text) {
  if (!mailer) { if (!PROD) console.log('[mail]', to, subject, '\n' + text); return; }
  await mailer.sendMail({ from: env.MAIL_FROM || 'NexHR <no-reply@' + BASE + '>', to, subject, text });
}
async function issueToken(c, orgId, userId, kind, minutes, value, meta) {
  await c.query('UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL', [userId, kind]);
  await c.query('INSERT INTO auth_tokens (org_id, user_id, kind, token_hash, meta, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(mins => $6))',
    [orgId, userId, kind, sha(value), meta || null, minutes]);
  return value;
}
// Codes are matched per user (6 digits, 5 tries). Links and tickets are matched by hash.
async function useToken(c, kind, value, userId, keep) {
  const { rows: [t] } = userId
    ? await c.query('SELECT * FROM auth_tokens WHERE kind = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1', [kind, userId])
    : await c.query('SELECT * FROM auth_tokens WHERE kind = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > now()', [kind, sha(value)]);
  if (!t) return { error: 'expired' };
  if (t.tries >= 5) return { error: 'too_many_attempts' };
  if (t.token_hash !== sha(value)) { await c.query('UPDATE auth_tokens SET tries = tries + 1 WHERE id = $1', [t.id]); return { error: 'invalid_code' }; }
  if (!keep) await c.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [t.id]);
  return { token: t };
}
const needs2fa = (org, u) => u.role === 'admin' || u.role === 'hr' || org.require_2fa;

/* ---------- workspace from Host ---------- */
// acme.nexhr.com → organisation "acme". www.nexhr.com and nexhr.com are the marketing site.
// Outside production, ?w=acme or the X-NexHR-Workspace header also works, for localhost testing.
function slugFromHost(req) {
  const host = (req.hostname || '').toLowerCase();
  if (host.endsWith('.' + BASE)) { const sub = host.slice(0, -(BASE.length + 1)); if (sub && !sub.includes('.') && sub !== 'www' && sub !== 'app') return sub; }
  if (!PROD) return req.get('x-nexhr-workspace') || req.query.w || null;
  return null;
}
app.use(h(async (req, res, next) => {
  const slug = slugFromHost(req);
  if (slug) {
    const { rows: [o] } = await db.query('SELECT * FROM organisations WHERE slug = $1', [slug]);
    if (!o && req.path.startsWith('/api/')) return bad(res, 404, 'workspace_not_found');
    req.org = o || null;
  }
  next();
}));
const needOrg = (req, res, next) => req.org ? next() : bad(res, 400, 'workspace_required');

/* ---------- Stripe webhook (raw body, before the JSON parser) ---------- */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), h(async (req, res) => {
  if (!stripe) return res.status(503).end();
  let ev;
  try { ev = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return res.status(400).send('bad signature'); }
  const fresh = await db.query('INSERT INTO stripe_events (id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, ev.type]);
  if (!fresh.rowCount) return res.json({ duplicate: true });
  const o = ev.data.object;
  if (ev.type === 'checkout.session.completed' && o.metadata && o.metadata.org_id) {
    await db.query('UPDATE subscriptions SET stripe_customer_id = $2, stripe_subscription_id = $3, updated_at = now() WHERE org_id = $1', [o.metadata.org_id, o.customer, o.subscription]);
  }
  if (/^customer\.subscription\./.test(ev.type)) {
    const orgId = (o.metadata || {}).org_id; if (orgId) await applySubscription(orgId, o, ev.type === 'customer.subscription.deleted');
  }
  if (ev.type === 'invoice.payment_failed' && o.subscription) {
    await db.query("UPDATE organisations SET status = 'past_due' WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_subscription_id = $1)", [o.subscription]);
  }
  res.json({ received: true });
}));
async function applySubscription(orgId, sub, deleted) {
  const item = sub.items.data[0]; let card = null;
  if (sub.default_payment_method) {
    try { const pm = typeof sub.default_payment_method === 'string' ? await stripe.paymentMethods.retrieve(sub.default_payment_method) : sub.default_payment_method; if (pm.card) card = pm.card.brand.replace(/^\w/, x => x.toUpperCase()) + ' ending ' + pm.card.last4; } catch (e) {}
  }
  const status = deleted ? 'canceled' : sub.status;
  const orgStatus = { trialing: 'trialing', active: 'active', past_due: 'past_due', unpaid: 'paused', canceled: 'canceled', incomplete_expired: 'paused' }[status] || 'active';
  await db.query(`UPDATE subscriptions SET stripe_subscription_id = $2, status = $3, billing_interval = $4, quantity = $5, card_label = COALESCE($6, card_label),
    current_period_end = to_timestamp($7), cancel_at_period_end = $8, updated_at = now() WHERE org_id = $1`,
    [orgId, sub.id, status, item.price.recurring.interval, item.quantity, card, sub.current_period_end, !!sub.cancel_at_period_end]);
  await db.query('UPDATE organisations SET status = $2 WHERE id = $1', [orgId, orgStatus]);
}
// Call after adding, archiving or removing people. Stripe pro-rates the change.
async function syncSeats(orgId) {
  if (!stripe) return;
  const { rows: [s] } = await db.query('SELECT s.stripe_subscription_id, s.quantity, COALESCE(b.employees, 0) AS n FROM subscriptions s LEFT JOIN billable_counts b ON b.org_id = s.org_id WHERE s.org_id = $1', [orgId]);
  if (!s || !s.stripe_subscription_id) return;
  const qty = Math.max(1, s.n); if (qty === s.quantity) return;
  const sub = await stripe.subscriptions.retrieve(s.stripe_subscription_id);
  await stripe.subscriptions.update(sub.id, { items: [{ id: sub.items.data[0].id, quantity: qty }], proration_behavior: 'create_prorations' });
  await db.query('UPDATE subscriptions SET quantity = $2, updated_at = now() WHERE org_id = $1', [orgId, qty]);
}

app.use(express.json({ limit: '100kb' }));

/* ---------- public: sign-up (marketing host) ---------- */
async function slugProblem(slug) {
  if (!/^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/.test(slug || '')) return 'invalid';
  const { rows } = await db.query('SELECT 1 FROM reserved_slugs WHERE slug = $1 UNION ALL SELECT 1 FROM organisations WHERE slug = $1', [slug]);
  return rows.length ? 'taken' : '';
}
app.get('/api/public/workspaces/check', h(async (req, res) => { const p = await slugProblem(String(req.query.slug || '').toLowerCase()); res.json({ available: !p, reason: p || null }); }));

app.post('/api/signup', h(async (req, res) => {
  const b = req.body || {}; const slug = String(b.slug || '').toLowerCase(); const fields = {};
  if (!String(b.name || '').trim()) fields.name = 'Enter your name';
  if (!emailOk(b.email)) fields.email = 'Enter a valid email address';
  if (passwordProblem(b.password)) fields.password = passwordProblem(b.password);
  if (!String(b.company || '').trim()) fields.company = 'Enter your company name';
  const sp = await slugProblem(slug); if (sp) fields.slug = sp === 'taken' ? 'This address is taken' : 'Use 3–30 lowercase letters, numbers or hyphens';
  if (!CURRENCIES.includes(b.currency)) fields.currency = 'Choose GBP, EUR or USD';
  if (!b.terms) fields.terms = 'You need to agree to continue';
  if (Object.keys(fields).length) return bad(res, 400, 'validation', { fields });
  const hash = await argon2.hash(b.password, { type: argon2.argon2id });
  const out = await tx(null, async c => {
    const { rows: [o] } = await c.query(`INSERT INTO organisations (slug, name, legal_name, country, currency, timezone, data_region, trial_ends_at)
      VALUES ($1,$2,$2,$3,$4,$5,$6, now() + make_interval(days => $7)) RETURNING *`, [slug, b.company.trim(), b.country || 'GB', b.currency, b.timezone || 'Europe/London', b.region || 'United Kingdom (London)', TRIAL_DAYS]);
    await c.query("SELECT set_config('app.org_id', $1, true)", [o.id]);
    await c.query('INSERT INTO subscriptions (org_id) VALUES ($1)', [o.id]);
    const { rows: [u] } = await c.query("INSERT INTO users (org_id, email, name, role, status, password_hash) VALUES ($1,$2,$3,'admin','active',$4) RETURNING id, email",
      [o.id, b.email.trim(), b.name.trim(), hash]);
    const code = await issueToken(c, o.id, u.id, 'verify', 15, code6());
    await audit(c, o.id, u.id, 'signup', 'organisation', o.id, req);
    return { o, u, code };
  });
  await send(out.u.email, 'Your NexHR verification code', 'Your code is ' + out.code + '. It expires in 15 minutes.');
  // The rest of onboarding runs on the new workspace's own address, so its cookies stay on that host.
  res.status(201).json({ userId: out.u.id, slug, next: wsUrl(slug, 'signup.html?step=verify&u=' + out.u.id) });
}));

app.post('/api/workspaces/find', h(async (req, res) => {
  const email = String((req.body || {}).email || '').trim();
  if (emailOk(email)) {
    const { rows } = await db.query('SELECT * FROM find_workspaces($1)', [email]);
    await send(email, 'Your NexHR workspaces', rows.length ? rows.map(r => r.name + ': ' + wsUrl(r.slug, 'login.html')).join('\n') : 'There are no NexHR workspaces for this email address.');
  }
  res.status(202).json({ ok: true }); // same answer either way, so addresses can't be probed
}));

/* ---------- sessions ---------- */
async function startSession(c, req, res, org, user) {
  const token = rand();
  await c.query("INSERT INTO sessions (org_id, user_id, token_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4,$5, now() + $6 * interval '1 millisecond')",
    [org.id, user.id, sha(token), req.get('user-agent'), req.ip, SESSION_MS]);
  await c.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await audit(c, org.id, user.id, 'login', 'auth', null, req);
  // Host-only cookie: valid on acme.nexhr.com and nowhere else.
  res.cookie('nxhr_sid', token, { httpOnly: true, secure: PROD, sameSite: 'strict', maxAge: SESSION_MS, path: '/' });
}
async function locked(c, org, req, email) {
  const { rows: [r] } = await c.query("SELECT count(*)::int AS n FROM auth_attempts WHERE org_id = $1 AND (ip = $2 OR email = $3) AND ok = false AND at > now() - make_interval(mins => $4)", [org.id, req.ip, email, WINDOW_MIN]);
  return r.n;
}
async function requireAuth(req, res, next) {
  if (!req.org) return bad(res, 400, 'workspace_required');
  const t = req.cookies.nxhr_sid; if (!t) return bad(res, 401, 'unauthenticated');
  const s = await tx(req.org.id, async c => (await c.query(`SELECT s.id, s.last_seen_at, u.id AS user_id, u.org_id, u.role, u.person_id, u.name, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.org_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [sha(t), req.org.id])).rows[0]);
  if (!s || Date.now() - new Date(s.last_seen_at).getTime() > IDLE_MS) return bad(res, 401, 'unauthenticated');
  db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.id]).catch(() => {});
  req.auth = s;
  // Trial over and no subscription: only sign-in and billing stay open, and billing only for Admins.
  const o = req.org, ended = o.status === 'trialing' && new Date(o.trial_ends_at) < new Date();
  const blocked = ended || ['paused', 'canceled'].includes(o.status);
  if (blocked && !req.path.startsWith('/api/auth/') && !(req.path.startsWith('/api/billing') && s.role === 'admin')) return bad(res, 402, 'payment_required');
  next();
}
const auth = h(requireAuth);
const role = (...r) => (req, res, next) => r.includes(req.auth.role) ? next() : bad(res, 403, 'forbidden');

/* ---------- sign-in ---------- */
app.post('/api/auth/login', needOrg, h(async (req, res) => {
  const email = String((req.body || {}).email || '').trim(), password = String((req.body || {}).password || ''); const org = req.org;
  const out = await tx(org.id, async c => {
    const n = await locked(c, org, req, email);
    if (n >= MAX_TRIES) return { status: 429, body: { error: 'locked', retryAfter: WINDOW_MIN * 60 } };
    const { rows: [u] } = await c.query("SELECT * FROM users WHERE email = $1 AND status = 'active'", [email]);
    const ok = !!u && !!u.password_hash && await argon2.verify(u.password_hash, password);
    await c.query('INSERT INTO auth_attempts (org_id, ip, email, ok) VALUES ($1,$2,$3,$4)', [org.id, req.ip, email, ok]);
    if (!ok) { await audit(c, org.id, null, 'login_failed', 'auth', null, req, { email }); return { status: 401, body: { error: 'invalid', attemptsLeft: Math.max(0, MAX_TRIES - n - 1) } }; }
    if (u.totp_enabled_at || needs2fa(org, u)) {
      const ticket = await issueToken(c, org.id, u.id, 'mfa_ticket', 10, rand());
      return { status: 200, body: { next: u.totp_enabled_at ? 'totp' : 'enrol', ticket } };
    }
    await startSession(c, req, res, org, u); return { status: 200, body: { role: u.role } };
  });
  res.status(out.status).json(out.body);
}));
async function ticketUser(c, ticket, keep) { const r = await useToken(c, 'mfa_ticket', ticket, null, keep); if (r.error) return null; return (await c.query('SELECT * FROM users WHERE id = $1', [r.token.user_id])).rows[0]; }
app.post('/api/auth/totp', needOrg, h(async (req, res) => {
  const { ticket, code } = req.body || {}; const org = req.org;
  const out = await tx(org.id, async c => {
    const u = await ticketUser(c, ticket, true); if (!u || !u.totp_enabled_at) return { status: 401, body: { error: 'expired' } };
    const { rows: [k] } = await c.query('SELECT pgp_sym_decrypt(totp_secret_enc, $2) AS secret FROM users WHERE id = $1', [u.id, ENC_KEY]);
    let ok = authenticator.check(String(code || '').replace(/\s/g, ''), k.secret);
    if (!ok && u.recovery_codes) { const i = u.recovery_codes.indexOf(sha(String(code || '').trim().toLowerCase())); if (i >= 0) { ok = true; await c.query('UPDATE users SET recovery_codes = array_remove(recovery_codes, $2) WHERE id = $1', [u.id, u.recovery_codes[i]]); await audit(c, org.id, u.id, 'recovery_code_used', 'auth', null, req); } }
    await c.query('INSERT INTO auth_attempts (org_id, ip, email, ok) VALUES ($1,$2,$3,$4)', [org.id, req.ip, u.email, ok]);
    if (!ok) return { status: 401, body: { error: 'invalid_code' } };
    await useToken(c, 'mfa_ticket', ticket); await startSession(c, req, res, org, u); return { status: 200, body: { role: u.role } };
  });
  res.status(out.status).json(out.body);
}));
app.post('/api/auth/totp/enrol/start', needOrg, h(async (req, res) => {
  const org = req.org;
  const out = await tx(org.id, async c => {
    const u = await ticketUser(c, (req.body || {}).ticket, true); if (!u) return null;
    const secret = authenticator.generateSecret(20);
    await c.query('UPDATE users SET totp_secret_enc = pgp_sym_encrypt($2, $3), totp_enabled_at = NULL WHERE id = $1', [u.id, secret, ENC_KEY]);
    const uri = authenticator.keyuri(u.email, 'NexHR (' + org.slug + '.' + BASE + ')', secret);
    return { secret, otpauth: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 0 }) };
  });
  out ? res.json(out) : bad(res, 401, 'expired');
}));
app.post('/api/auth/totp/enrol/finish', needOrg, h(async (req, res) => {
  const { ticket, code } = req.body || {}; const org = req.org;
  const out = await tx(org.id, async c => {
    const u = await ticketUser(c, ticket, true); if (!u) return { status: 401, body: { error: 'expired' } };
    const { rows: [k] } = await c.query('SELECT pgp_sym_decrypt(totp_secret_enc, $2) AS secret FROM users WHERE id = $1', [u.id, ENC_KEY]);
    if (!k.secret || !authenticator.check(String(code || ''), k.secret)) return { status: 400, body: { error: 'invalid_code' } };
    const codes = Array.from({ length: 8 }, () => { const x = crypto.randomBytes(5).toString('hex'); return x.slice(0, 5) + '-' + x.slice(5); });
    await c.query('UPDATE users SET totp_enabled_at = now(), recovery_codes = $2 WHERE id = $1', [u.id, codes.map(sha)]);
    await audit(c, org.id, u.id, 'totp_enabled', 'auth', null, req);
    await useToken(c, 'mfa_ticket', ticket); await startSession(c, req, res, org, u);
    return { status: 200, body: { recoveryCodes: codes, role: u.role } };
  });
  res.status(out.status).json(out.body);
}));
app.post('/api/signup/verify', needOrg, h(async (req, res) => {
  const { userId, code } = req.body || {}; const org = req.org;
  const out = await tx(org.id, async c => {
    const r = await useToken(c, 'verify', String(code || ''), userId); if (r.error) return { status: 400, body: { error: r.error } };
    await c.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [userId]);
    return { status: 200, body: { next: 'enrol', ticket: await issueToken(c, org.id, userId, 'mfa_ticket', 30, rand()) } };
  });
  res.status(out.status).json(out.body);
}));
app.post('/api/signup/resend', needOrg, h(async (req, res) => {
  const org = req.org; const userId = (req.body || {}).userId;
  const u = await tx(org.id, async c => { const { rows: [u] } = await c.query('SELECT id, email FROM users WHERE id = $1 AND email_verified_at IS NULL', [userId]); if (u) u.code = await issueToken(c, org.id, u.id, 'verify', 15, code6()); return u; });
  if (u) await send(u.email, 'Your NexHR verification code', 'Your code is ' + u.code + '. It expires in 15 minutes.');
  res.status(202).json({ ok: true });
}));
app.post('/api/auth/password/forgot', needOrg, h(async (req, res) => {
  const org = req.org, email = String((req.body || {}).email || '').trim();
  const u = await tx(org.id, async c => { const { rows: [u] } = await c.query("SELECT id, email FROM users WHERE email = $1 AND status = 'active'", [email]); if (u) u.code = await issueToken(c, org.id, u.id, 'reset', 15, code6()); return u; });
  if (u) await send(u.email, 'Reset your NexHR password', 'Your code is ' + u.code + '. It expires in 15 minutes. If you didn\u2019t ask for this, ignore this email.');
  res.status(202).json({ ok: true });
}));
app.post('/api/auth/password/reset', needOrg, h(async (req, res) => {
  const { email, code, password } = req.body || {}; const org = req.org;
  if (passwordProblem(password)) return bad(res, 400, 'validation', { fields: { password: passwordProblem(password) } });
  const out = await tx(org.id, async c => {
    const { rows: [u] } = await c.query("SELECT id FROM users WHERE email = $1 AND status = 'active'", [email]); if (!u) return { status: 400, body: { error: 'invalid_code' } };
    const r = await useToken(c, 'reset', String(code || ''), u.id); if (r.error) return { status: 400, body: { error: r.error } };
    await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, await argon2.hash(password, { type: argon2.argon2id })]);
    await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    await audit(c, org.id, u.id, 'password_reset', 'auth', null, req); return { status: 200, body: { ok: true } };
  });
  res.status(out.status).json(out.body);
}));
app.get('/api/invitations/:token', needOrg, h(async (req, res) => {
  const inv = await tx(req.org.id, async c => (await c.query("SELECT u.email, u.name, u.role FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.kind = 'invite' AND t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.status = 'invited'", [sha(req.params.token)])).rows[0]);
  inv ? res.json({ company: req.org.name, ...inv }) : bad(res, 404, 'expired');
}));
app.post('/api/invitations/:token/accept', needOrg, h(async (req, res) => {
  const { name, password } = req.body || {}; const org = req.org;
  if (passwordProblem(password)) return bad(res, 400, 'validation', { fields: { password: passwordProblem(password) } });
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const out = await tx(org.id, async c => {
    const r = await useToken(c, 'invite', req.params.token); if (r.error) return { status: 404, body: { error: 'expired' } };
    const { rows: [u] } = await c.query("UPDATE users SET name = COALESCE(NULLIF($2, ''), name), password_hash = $3, status = 'active', email_verified_at = now() WHERE id = $1 RETURNING *", [r.token.user_id, String(name || '').trim(), hash]);
    await audit(c, org.id, u.id, 'invitation_accepted', 'user', u.id, req);
    if (needs2fa(org, u)) return { status: 200, body: { next: 'enrol', ticket: await issueToken(c, org.id, u.id, 'mfa_ticket', 30, rand()) } };
    await startSession(c, req, res, org, u); return { status: 200, body: { role: u.role } };
  });
  res.status(out.status).json(out.body);
}));
app.get('/api/auth/me', auth, (req, res) => res.json({ userId: req.auth.user_id, name: req.auth.name, email: req.auth.email, role: req.auth.role, personId: req.auth.person_id,
  org: { id: req.org.id, slug: req.org.slug, name: req.org.name, legalName: req.org.legal_name, currency: req.org.currency, status: req.org.status, trialEndsAt: req.org.trial_ends_at } }));
app.post('/api/auth/logout', auth, h(async (req, res) => {
  await tx(req.org.id, c => c.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.auth.id]));
  res.clearCookie('nxhr_sid', { path: '/' }); res.status(204).end();
}));
app.get('/api/workspaces/mine', auth, h(async (req, res) => res.json((await db.query('SELECT * FROM find_workspaces($1)', [req.auth.email])).rows)));

/* ---------- company admin ---------- */
app.get('/api/org', auth, (req, res) => { const o = req.org; res.json({ id: o.id, slug: o.slug, name: o.name, legalName: o.legal_name, country: o.country, currency: o.currency, timezone: o.timezone, leaveYearStart: o.leave_year_start, dataRegion: o.data_region, require2fa: o.require_2fa }); });
app.patch('/api/org', auth, role('admin', 'hr'), h(async (req, res) => {
  const b = req.body || {}; const map = { name: 'name', legalName: 'legal_name', timezone: 'timezone', leaveYearStart: 'leave_year_start', sizeBand: 'size_band' };
  if (req.auth.role === 'admin') map.require2fa = 'require_2fa';
  const sets = [], vals = [req.org.id];
  Object.keys(map).forEach(k => { if (b[k] !== undefined) { vals.push(b[k]); sets.push(map[k] + ' = $' + vals.length); } });
  if (!sets.length) return bad(res, 400, 'validation');
  await tx(req.org.id, async c => { await c.query('UPDATE organisations SET ' + sets.join(', ') + ' WHERE id = $1', vals); await audit(c, req.org.id, req.auth.user_id, 'update', 'organisation', req.org.id, req, b); });
  res.json({ ok: true });
}));
app.post('/api/org/locations', auth, role('admin', 'hr'), h(async (req, res) => {
  const names = [].concat((req.body || {}).names || []).map(s => String(s).trim()).filter(Boolean).slice(0, 100);
  await tx(req.org.id, async c => { for (const n of names) await c.query('INSERT INTO locations (org_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.org.id, n]); });
  res.status(201).json({ ok: true });
}));
app.post('/api/org/departments', auth, role('admin', 'hr'), h(async (req, res) => {
  const names = [].concat((req.body || {}).names || []).map(s => String(s).trim()).filter(Boolean).slice(0, 100);
  await tx(req.org.id, async c => { for (const n of names) await c.query('INSERT INTO departments (org_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.org.id, n]); });
  res.status(201).json({ ok: true });
}));
app.get('/api/org/users', auth, role('admin', 'hr'), h(async (req, res) => {
  res.json((await tx(req.org.id, c => c.query('SELECT id, name, email, role, status, (totp_enabled_at IS NOT NULL) AS totp, last_login_at, created_at FROM users WHERE status <> \'disabled\' ORDER BY created_at'))).rows);
}));
app.post('/api/org/invitations', auth, role('admin', 'hr'), h(async (req, res) => {
  const { email, name, role: r } = req.body || {};
  if (!emailOk(email) || !ROLES.includes(r)) return bad(res, 400, 'validation');
  if (r === 'admin' && req.auth.role !== 'admin') return bad(res, 403, 'forbidden');
  const out = await tx(req.org.id, async c => {
    const { rows: [u] } = await c.query("INSERT INTO users (org_id, email, name, role, status, invited_by) VALUES ($1,$2,$3,$4,'invited',$5) ON CONFLICT (org_id, email) DO NOTHING RETURNING id, email",
      [req.org.id, email.trim(), String(name || '').trim() || email.split('@')[0], r, req.auth.user_id]);
    if (!u) return null;
    const token = await issueToken(c, req.org.id, u.id, 'invite', 7 * 24 * 60, rand());
    await audit(c, req.org.id, req.auth.user_id, 'invite', 'user', u.id, req, { role: r }); return { u, token };
  });
  if (!out) return bad(res, 409, 'already_exists');
  await send(out.u.email, req.auth.name + ' invited you to ' + req.org.name + ' on NexHR', 'Accept your invitation (valid for 7 days):\n' + wsUrl(req.org.slug, 'login.html?invite=' + out.token));
  res.status(201).json({ id: out.u.id });
}));
app.post('/api/org/users/:id/resend', auth, role('admin', 'hr'), h(async (req, res) => {
  const out = await tx(req.org.id, async c => { const { rows: [u] } = await c.query("SELECT id, email FROM users WHERE id = $1 AND status = 'invited'", [req.params.id]); if (u) u.token = await issueToken(c, req.org.id, u.id, 'invite', 7 * 24 * 60, rand()); return u; });
  if (!out) return bad(res, 404, 'not_found');
  await send(out.email, 'Your invitation to ' + req.org.name + ' on NexHR', wsUrl(req.org.slug, 'login.html?invite=' + out.token)); res.json({ ok: true });
}));
async function adminCount(c) { return (await c.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'")).rows[0].n; }
app.patch('/api/org/users/:id', auth, role('admin', 'hr'), h(async (req, res) => {
  const r = (req.body || {}).role; if (!ROLES.includes(r)) return bad(res, 400, 'validation');
  if (req.params.id === req.auth.user_id) return bad(res, 409, 'cannot_change_own_role');
  const out = await tx(req.org.id, async c => {
    const { rows: [u] } = await c.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]); if (!u) return 404;
    if (req.auth.role !== 'admin' && (u.role === 'admin' || r === 'admin')) return 403;
    if (u.role === 'admin' && r !== 'admin' && await adminCount(c) <= 1) return 409;
    await c.query('UPDATE users SET role = $2 WHERE id = $1', [u.id, r]);
    await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]); // new role applies at next sign-in
    await audit(c, req.org.id, req.auth.user_id, 'role_change', 'user', u.id, req, { from: u.role, to: r }); return 200;
  });
  out === 200 ? res.json({ ok: true }) : bad(res, out, out === 409 ? 'last_admin' : out === 403 ? 'forbidden' : 'not_found');
}));
app.delete('/api/org/users/:id', auth, role('admin', 'hr'), h(async (req, res) => {
  if (req.params.id === req.auth.user_id) return bad(res, 409, 'cannot_remove_self');
  const out = await tx(req.org.id, async c => {
    const { rows: [u] } = await c.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]); if (!u) return 404;
    if (u.role === 'admin' && (req.auth.role !== 'admin' || await adminCount(c) <= 1)) return 409;
    await c.query("UPDATE users SET status = 'disabled' WHERE id = $1", [u.id]);
    await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    await audit(c, req.org.id, req.auth.user_id, 'remove_access', 'user', u.id, req); return 200;
  });
  out === 200 ? res.status(204).end() : bad(res, out, out === 409 ? 'not_allowed' : 'not_found');
}));
app.post('/api/org/users/:id/reset-2fa', auth, role('admin'), h(async (req, res) => {
  await tx(req.org.id, async c => { await c.query('UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, recovery_codes = NULL WHERE id = $1', [req.params.id]); await audit(c, req.org.id, req.auth.user_id, 'totp_reset', 'user', req.params.id, req); });
  res.json({ ok: true });
}));

/* ---------- billing (Admin only) ---------- */
app.get('/api/billing', auth, role('admin'), h(async (req, res) => {
  const { rows: [s] } = await db.query('SELECT s.*, COALESCE(b.employees, 0) AS employees FROM subscriptions s LEFT JOIN billable_counts b ON b.org_id = s.org_id WHERE s.org_id = $1', [req.org.id]);
  res.json({ status: req.org.status, trialEndsAt: req.org.trial_ends_at, currency: req.org.currency, interval: s.billing_interval, billableEmployees: Math.max(1, s.employees),
    pricePerEmployee: PER_EMPLOYEE[req.org.currency] * (s.billing_interval === 'year' ? 10 : 1), card: s.card_label, periodEnd: s.current_period_end, cancelAtPeriodEnd: s.cancel_at_period_end });
}));
app.post('/api/billing/checkout', auth, role('admin'), h(async (req, res) => {
  if (!stripe) return bad(res, 503, 'billing_not_configured');
  const o = req.org; const { rows: [s] } = await db.query('SELECT s.*, COALESCE(b.employees, 0) AS employees FROM subscriptions s LEFT JOIN billable_counts b ON b.org_id = s.org_id WHERE s.org_id = $1', [o.id]);
  let customer = s.stripe_customer_id;
  if (!customer) { customer = (await stripe.customers.create({ email: req.auth.email, name: o.legal_name || o.name, metadata: { org_id: o.id, slug: o.slug } })).id; await db.query('UPDATE subscriptions SET stripe_customer_id = $2 WHERE org_id = $1', [o.id, customer]); }
  const trialEnd = Math.floor(new Date(o.trial_ends_at).getTime() / 1000);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer, currency: o.currency.toLowerCase(),
    line_items: [{ price: PRICE[s.billing_interval], quantity: Math.max(1, s.employees) }],
    subscription_data: { metadata: { org_id: o.id }, ...(trialEnd > Date.now() / 1000 + 172800 ? { trial_end: trialEnd } : {}) },
    payment_method_collection: 'always', automatic_tax: { enabled: env.STRIPE_TAX === 'on' }, tax_id_collection: { enabled: true }, customer_update: { address: 'auto', name: 'auto' },
    metadata: { org_id: o.id }, success_url: wsUrl(o.slug, 'app.html?billing=done'), cancel_url: wsUrl(o.slug, 'app.html?billing=cancelled')
  });
  await tx(o.id, c => audit(c, o.id, req.auth.user_id, 'checkout_started', 'billing', null, req));
  res.json({ url: session.url });
}));
app.post('/api/billing/portal', auth, role('admin'), h(async (req, res) => {
  if (!stripe) return bad(res, 503, 'billing_not_configured');
  const { rows: [s] } = await db.query('SELECT stripe_customer_id FROM subscriptions WHERE org_id = $1', [req.org.id]);
  if (!s || !s.stripe_customer_id) return bad(res, 409, 'no_customer');
  res.json({ url: (await stripe.billingPortal.sessions.create({ customer: s.stripe_customer_id, return_url: wsUrl(req.org.slug, 'app.html') })).url });
}));
app.patch('/api/billing', auth, role('admin'), h(async (req, res) => {
  const iv = (req.body || {}).interval; if (!PRICE[iv]) return bad(res, 400, 'validation');
  const { rows: [s] } = await db.query('SELECT stripe_subscription_id FROM subscriptions WHERE org_id = $1', [req.org.id]);
  if (stripe && s.stripe_subscription_id) { const sub = await stripe.subscriptions.retrieve(s.stripe_subscription_id); await stripe.subscriptions.update(sub.id, { items: [{ id: sub.items.data[0].id, price: PRICE[iv] }], proration_behavior: 'create_prorations' }); }
  await db.query('UPDATE subscriptions SET billing_interval = $2, updated_at = now() WHERE org_id = $1', [req.org.id, iv]);
  await tx(req.org.id, c => audit(c, req.org.id, req.auth.user_id, 'billing_interval', 'billing', null, req, { interval: iv }));
  res.json({ ok: true });
}));

/* ---------- leave (pattern for the other resources) ---------- */
const LEAVE_SQL = `SELECT l.id, l.person_id AS pid, t.name AS type, l.date_from AS "from", l.date_to AS "to", l.days, l.status, l.note, l.created_at::date AS sub
  FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id JOIN people p ON p.id = l.person_id WHERE true`;
app.get('/api/leave', auth, h(async (req, res) => {
  const a = req.auth; let sql = LEAVE_SQL, args = [];
  if (a.role === 'employee') { sql += ' AND l.person_id = $1'; args.push(a.person_id); }
  if (a.role === 'manager') { sql += ' AND (l.person_id = $1 OR p.manager_id = $1)'; args.push(a.person_id); }
  res.json((await tx(req.org.id, c => c.query(sql + ' ORDER BY l.date_from DESC', args))).rows);
}));
app.post('/api/leave', auth, h(async (req, res) => {
  const { type, from, to, days, note } = req.body || {}; const a = req.auth;
  if (!type || !from || !to || !(days > 0) || to < from) return bad(res, 400, 'validation', { fields: { dates: 'Check the dates' } });
  const row = await tx(req.org.id, async c => {
    const { rows: [lt] } = await c.query('SELECT id FROM leave_types WHERE name = $1', [type]); if (!lt) return null;
    const { rows: [row] } = await c.query('INSERT INTO leave_requests (org_id, person_id, leave_type_id, date_from, date_to, days, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.org.id, a.person_id, lt.id, from, to, days, note || null]);
    await c.query("INSERT INTO notifications (org_id, person_id, kind, title, body, link) SELECT $1, manager_id, 'leave', 'Leave request to review', $3, '/leave' FROM people WHERE id = $2 AND manager_id IS NOT NULL", [req.org.id, a.person_id, type + ' ' + from + ' to ' + to]);
    await audit(c, req.org.id, a.user_id, 'create', 'leave_request', row.id, req); return row;
  });
  row ? res.status(201).json({ id: row.id, status: 'Pending' }) : bad(res, 400, 'validation', { fields: { type: 'Unknown leave type' } });
}));
app.post('/api/leave/:id/decision', auth, role('manager', 'hr', 'admin'), h(async (req, res) => {
  const { decision, comment } = req.body || {}; const a = req.auth;
  const status = decision === 'approve' ? 'Approved' : decision === 'decline' ? 'Declined' : null;
  if (!status) return bad(res, 400, 'validation');
  const n = await tx(req.org.id, async c => {
    const { rowCount } = await c.query(`UPDATE leave_requests l SET status = $1, decided_by = $2, decided_at = now(), decision_comment = $3
      FROM people p WHERE l.id = $4 AND p.id = l.person_id AND l.status = 'Pending' AND ($5 IN ('hr','admin') OR p.manager_id = $2)`, [status, a.person_id, comment || null, req.params.id, a.role]);
    if (rowCount) await audit(c, req.org.id, a.user_id, status.toLowerCase(), 'leave_request', req.params.id, req); return rowCount;
  });
  n ? res.json({ status }) : bad(res, 409, 'not_pending_or_not_allowed');
}));

/* ---------- HR resources ---------- */
hrRoutes(app, { tx, audit, auth, role, h, bad, syncSeats, env, argon2, passwordProblem });

app.get('/api/health', h(async (req, res) => { await db.query('SELECT 1'); res.json({ ok: true, version: require('./package.json').version }); }));
app.use('/api', (req, res) => bad(res, 404, 'not_found'));

/* ---------- front end ---------- */
// App-only package: the marketing (index.html, pricing.html) and auth (login.html,
// signup.html) pages were intentionally left out of this extraction, so they are not served.
// Only public files are served; server/, database/, config/ and docs/ never are.
const WEB = path.join(__dirname, '..');
const PUBLIC = ['app.html', 'support.js', 'favicon.ico', 'manifest.webmanifest', 'robots.txt'];
app.use('/assets', express.static(path.join(WEB, 'assets'), { dotfiles: 'deny', maxAge: '7d' }));
PUBLIC.forEach(f => app.get('/' + f, (req, res) => res.sendFile(path.join(WEB, f))));
app.get('/', (req, res) => res.sendFile(path.join(WEB, 'app.html')));

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return bad(res, 413, 'file_too_large', { maxBytes: 10485760 });
  if (err && err.type === 'entity.parse.failed') return bad(res, 400, 'invalid_json');
  console.error(err); bad(res, 500, 'server_error');
});
// PORT is passed as-is (not coerced with +): a numeric port for Node/Nginx/systemd,
// or the Unix-socket path that Phusion Passenger provides on GoDaddy cPanel Node.js hosting.
const PORT = env.PORT || 8080;
app.listen(PORT, () => console.log('NexHR on ' + PORT + ' for *.' + BASE));

module.exports = { syncSeats };
