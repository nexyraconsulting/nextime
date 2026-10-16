// Sets a password for an existing user, or creates an Admin, from the command line.
// Usage: node createAdmin.js <workspace> <email> "<Full name>"
// You'll be asked for the password. Run on the server, with server/.env in place.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const readline = require('readline');
const argon2 = require('argon2');
const { Pool } = require('pg');

const [slug, email, name] = process.argv.slice(2);
if (!slug || !email) { console.error('Usage: node createAdmin.js <workspace> <email> "<Full name>"'); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.stdoutMuted = true;
rl._writeToOutput = s => { if (!rl.stdoutMuted || /Password/.test(s)) rl.output.write(s); };
rl.question('Password (10+ characters, a letter and a number): ', async pw => {
  rl.close(); process.stdout.write('\n');
  if (!pw || pw.length < 10 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) { console.error('Password too weak.'); process.exit(1); }
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const { rows: [o] } = await c.query('SELECT id FROM organisations WHERE slug = $1', [slug]);
    if (!o) throw new Error('No workspace called ' + slug);
    await c.query("SELECT set_config('app.org_id', $1, true)", [o.id]);
    const hash = await argon2.hash(pw, { type: argon2.argon2id });
    const r = await c.query("UPDATE users SET password_hash = $2, status = 'active', email_verified_at = COALESCE(email_verified_at, now()) WHERE email = $1 RETURNING id", [email, hash]);
    if (!r.rowCount) await c.query("INSERT INTO users (org_id, email, name, role, status, password_hash, email_verified_at) VALUES ($1,$2,$3,'admin','active',$4, now())", [o.id, email, name || email.split('@')[0], hash]);
    await c.query('COMMIT');
    console.log((r.rowCount ? 'Password set for ' : 'Admin created: ') + email + ' in ' + slug + '. Two-step login is set up at first sign-in.');
  } catch (e) { await c.query('ROLLBACK'); console.error(e.message); process.exitCode = 1; } finally { c.release(); await db.end(); }
});
