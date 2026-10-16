// NexHR scheduled jobs. Run from cron (see DEPLOYMENT.md section 12):
//   node jobs.js seats            Sync each subscription's quantity with its billable employees (hourly)
//   node jobs.js cleanup          Remove expired tokens, old sessions and old sign-in attempts (daily)
//   node jobs.js trial-reminders  Email Admins 3 days and 1 day before a trial ends without payment details (daily)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');

const env = process.env;
const db = new Pool({ connectionString: env.DATABASE_URL });
const stripe = env.STRIPE_SECRET_KEY ? Stripe(env.STRIPE_SECRET_KEY) : null;
const mailer = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
const BASE = env.BASE_DOMAIN || 'nexhr.com';

// Runs fn once per organisation with app.org_id set, so row-level security applies as it does in the API.
async function eachOrg(sql, fn) {
  const { rows } = await db.query(sql);
  for (const o of rows) {
    const c = await db.connect();
    try { await c.query('BEGIN'); await c.query("SELECT set_config('app.org_id', $1, true)", [o.id]); await fn(c, o); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); console.error(o.slug || o.id, e.message); } finally { c.release(); }
  }
  return rows.length;
}

const jobs = {
  async seats() {
    if (!stripe) return console.log('STRIPE_SECRET_KEY not set; skipping');
    const { rows } = await db.query("SELECT s.org_id, s.stripe_subscription_id, s.quantity, COALESCE(b.employees, 0) AS n FROM subscriptions s LEFT JOIN billable_counts b ON b.org_id = s.org_id WHERE s.stripe_subscription_id IS NOT NULL AND s.status IN ('trialing','active','past_due')");
    let changed = 0;
    for (const s of rows) {
      const qty = Math.max(1, s.n); if (qty === s.quantity) continue;
      try {
        const sub = await stripe.subscriptions.retrieve(s.stripe_subscription_id);
        await stripe.subscriptions.update(sub.id, { items: [{ id: sub.items.data[0].id, quantity: qty }], proration_behavior: 'create_prorations' });
        await db.query('UPDATE subscriptions SET quantity = $2, updated_at = now() WHERE org_id = $1', [s.org_id, qty]); changed++;
      } catch (e) { console.error(s.org_id, e.message); }
    }
    console.log('seats: ' + changed + ' of ' + rows.length + ' subscriptions updated');
  },
  async cleanup() {
    const n = await eachOrg('SELECT id, slug FROM organisations', async c => {
      await c.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days' OR used_at < now() - interval '7 days'");
      await c.query("DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'");
    });
    await db.query("DELETE FROM auth_attempts WHERE at < now() - interval '90 days'");
    await db.query("DELETE FROM stripe_events WHERE received_at < now() - interval '90 days'");
    console.log('cleanup: ' + n + ' organisations');
  },
  async ['trial-reminders']() {
    let sent = 0;
    await eachOrg(`SELECT o.id, o.slug, o.name, o.trial_ends_at FROM organisations o JOIN subscriptions s ON s.org_id = o.id
      WHERE o.status = 'trialing' AND s.stripe_subscription_id IS NULL AND (o.trial_ends_at::date - current_date) IN (1, 3)`, async (c, o) => {
      const { rows } = await c.query("SELECT email, name FROM users WHERE role = 'admin' AND status = 'active'");
      const days = Math.round((new Date(o.trial_ends_at) - Date.now()) / 864e5);
      for (const u of rows) {
        const text = 'Hello ' + u.name + ',\n\nThe NexHR free trial for ' + o.name + ' ends in ' + days + (days === 1 ? ' day' : ' days') + '. Add payment details to keep your workspace open:\nhttps://' + o.slug + '.' + BASE + '/app.html\n\nIf you do nothing, the workspace pauses. Nothing is deleted.';
        if (mailer) await mailer.sendMail({ from: env.MAIL_FROM, to: u.email, subject: 'Your NexHR trial ends in ' + days + (days === 1 ? ' day' : ' days'), text }); else console.log('[mail]', u.email, text);
        sent++;
      }
    });
    console.log('trial-reminders: ' + sent + ' emails');
  }
};

const name = process.argv[2];
if (!jobs[name]) { console.error('Usage: node jobs.js <' + Object.keys(jobs).join('|') + '>'); process.exit(1); }
jobs[name]().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.end());
