// NexHR HR endpoints: people, bank details, clock-in, timesheets, leave, rota, document requests,
// documents, payslips, files, news, notifications, sessions, audit and reports.
// Mounted by server.js. Every query runs inside tx(orgId), so row-level security limits it to one organisation.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

module.exports = function hrRoutes(app, d) {
  const { tx, audit, auth, role, h, bad, syncSeats, env, argon2, passwordProblem } = d;
  const ENC = env.DATA_ENCRYPTION_KEY;
  const STORAGE = path.resolve(env.STORAGE_DIR || path.join(__dirname, '..', '..', 'nexhr_storage'));
  const FILE_SECRET = env.FILE_URL_SECRET || ENC;
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const HR = ['hr', 'admin'];
  const isHr = a => HR.includes(a.role);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  const MIME = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
  const needPerson = (req, res) => { if (!req.auth.person_id) { bad(res, 409, 'no_employee_record'); return false; } return true; };

  // Employee: self. Manager: self + direct reports. HR/Admin: everyone.
  async function canSee(c, a, pid) {
    if (isHr(a) || pid === a.person_id) return true;
    if (a.role !== 'manager') return false;
    const { rows } = await c.query('SELECT 1 FROM people WHERE id = $1 AND manager_id = $2', [pid, a.person_id]); return rows.length > 0;
  }
  function scopeSql(a, col, args) {
    if (isHr(a)) return 'true';
    args.push(a.person_id); const i = args.length;
    return a.role === 'manager' ? `(${col} = $${i} OR ${col} IN (SELECT id FROM people WHERE manager_id = $${i}))` : `${col} = $${i}`;
  }
  async function notify(c, orgId, personId, kind, title, body, link) {
    if (personId) await c.query('INSERT INTO notifications (org_id, person_id, kind, title, body, link) VALUES ($1,$2,$3,$4,$5,$6)', [orgId, personId, kind, title, body || null, link || null]);
  }
  async function nextRef(c, table, prefix) {
    const { rows: [r] } = await c.query(`SELECT count(*)::int + 1 AS n FROM ${table}`);
    return prefix + '-' + String(1000 + r.n);
  }
  const personOut = p => ({ id: p.id, name: (p.preferred_name || p.first_name) + ' ' + p.last_name, first: p.preferred_name || p.first_name, ini: (p.first_name[0] + p.last_name[0]).toUpperCase(),
    title: p.job_title, dept: p.dept, team: p.team, loc: p.loc, mgr: p.manager_id, type: p.contract_type, status: p.status, start: p.start_date, empNo: p.emp_no, email: p.email, phone: p.phone,
    weeklyMinutes: p.weekly_minutes, address: p.address, emergencyContact: p.emergency_contact });
  const PEOPLE_SQL = 'SELECT p.*, d.name AS dept, l.name AS loc FROM people p LEFT JOIN departments d ON d.id = p.department_id LEFT JOIN locations l ON l.id = p.location_id WHERE p.archived_at IS NULL';

  /* ---------- people ---------- */
  app.get('/api/people', auth, h(async (req, res) => {
    const args = []; const where = scopeSql(req.auth, 'p.id', args);
    const { rows } = await tx(req.org.id, c => c.query(PEOPLE_SQL + ' AND ' + where + ' ORDER BY p.last_name, p.first_name', args));
    res.json(rows.map(personOut));
  }));
  app.get('/api/people/:id', auth, h(async (req, res) => {
    const p = await tx(req.org.id, async c => (await canSee(c, req.auth, req.params.id)) ? (await c.query(PEOPLE_SQL + ' AND p.id = $1', [req.params.id])).rows[0] : null);
    p ? res.json(personOut(p)) : bad(res, 404, 'not_found');
  }));
  async function refIds(c, b) {
    const dep = b.department ? (await c.query('INSERT INTO departments (org_id, name) VALUES (current_setting(\'app.org_id\')::uuid, $1) ON CONFLICT (org_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [b.department])).rows[0].id : null;
    const loc = b.location ? (await c.query('INSERT INTO locations (org_id, name) VALUES (current_setting(\'app.org_id\')::uuid, $1) ON CONFLICT (org_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [b.location])).rows[0].id : null;
    return { dep, loc };
  }
  app.post('/api/people', auth, role(...HR), h(async (req, res) => {
    const b = req.body || {}; const fields = {};
    ['firstName', 'lastName', 'email', 'jobTitle', 'contractType', 'startDate'].forEach(k => { if (!String(b[k] || '').trim()) fields[k] = 'Required'; });
    if (b.startDate && !ISO.test(b.startDate)) fields.startDate = 'Use YYYY-MM-DD';
    if (Object.keys(fields).length) return bad(res, 400, 'validation', { fields });
    try {
      const row = await tx(req.org.id, async c => {
        const { dep, loc } = await refIds(c, b);
        const empNo = b.empNo || 'EMP-' + String((await c.query('SELECT count(*)::int + 1 AS n FROM people')).rows[0].n).padStart(4, '0');
        const { rows: [p] } = await c.query(`INSERT INTO people (org_id, emp_no, first_name, last_name, preferred_name, email, phone, job_title, department_id, team, location_id, manager_id, contract_type, status, start_date, weekly_minutes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [req.org.id, empNo, b.firstName.trim(), b.lastName.trim(), b.preferredName || null, b.email.trim(), b.phone || null, b.jobTitle.trim(), dep, b.team || null, loc, b.managerId || null, b.contractType, b.status || 'Onboarding', b.startDate, b.weeklyMinutes || 2250]);
        await audit(c, req.org.id, req.auth.user_id, 'create', 'person', p.id, req); return p;
      });
      syncSeats(req.org.id).catch(e => console.error('syncSeats', e.message));
      res.status(201).json({ id: row.id });
    } catch (e) { if (e.code === '23505') return bad(res, 409, 'already_exists'); if (e.code === '23514') return bad(res, 400, 'validation'); throw e; }
  }));
  app.patch('/api/people/:id', auth, h(async (req, res) => {
    const a = req.auth, b = req.body || {}, self = req.params.id === a.person_id;
    if (!self && !isHr(a)) return bad(res, 403, 'forbidden');
    const own = { preferredName: 'preferred_name', phone: 'phone', address: 'address', emergencyContact: 'emergency_contact' };
    const hrOnly = { firstName: 'first_name', lastName: 'last_name', email: 'email', jobTitle: 'job_title', team: 'team', managerId: 'manager_id', contractType: 'contract_type', status: 'status', startDate: 'start_date', endDate: 'end_date', weeklyMinutes: 'weekly_minutes' };
    const map = isHr(a) ? { ...own, ...hrOnly } : own;
    const out = await tx(req.org.id, async c => {
      const sets = [], vals = [req.params.id];
      if (isHr(a) && (b.department || b.location)) { const { dep, loc } = await refIds(c, b); if (dep) { vals.push(dep); sets.push('department_id = $' + vals.length); } if (loc) { vals.push(loc); sets.push('location_id = $' + vals.length); } }
      Object.keys(map).forEach(k => { if (b[k] !== undefined) { vals.push(['address', 'emergencyContact'].includes(k) ? JSON.stringify(b[k]) : b[k]); sets.push(map[k] + ' = $' + vals.length); } });
      if (!sets.length) return 400;
      const r = await c.query('UPDATE people SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $1 AND archived_at IS NULL', vals);
      if (!r.rowCount) return 404;
      await audit(c, req.org.id, a.user_id, 'update', 'person', req.params.id, req, { fields: Object.keys(b) }); return 200;
    });
    out === 200 ? res.json({ ok: true }) : bad(res, out, out === 400 ? 'validation' : 'not_found');
  }));
  app.post('/api/people/:id/archive', auth, role(...HR), h(async (req, res) => {
    const n = await tx(req.org.id, async c => { const r = await c.query("UPDATE people SET archived_at = now(), status = 'Left', end_date = COALESCE(end_date, current_date) WHERE id = $1 AND archived_at IS NULL", [req.params.id]); if (r.rowCount) await audit(c, req.org.id, req.auth.user_id, 'archive', 'person', req.params.id, req); return r.rowCount; });
    if (n) syncSeats(req.org.id).catch(e => console.error('syncSeats', e.message));
    n ? res.json({ ok: true }) : bad(res, 404, 'not_found');
  }));

  /* ---------- bank details ---------- */
  app.get('/api/people/:id/bank', auth, h(async (req, res) => {
    const row = await tx(req.org.id, async c => (await canSee(c, req.auth, req.params.id) && (isHr(req.auth) || req.params.id === req.auth.person_id)) ? (await c.query('SELECT bank_name, account_last4, method, updated_at FROM bank_details WHERE person_id = $1', [req.params.id])).rows[0] || {} : null);
    row ? res.json({ bank: row.bank_name || null, last4: row.account_last4 || null, method: row.method || null, updatedAt: row.updated_at || null }) : bad(res, 403, 'forbidden');
  }));
  app.post('/api/people/:id/bank/reveal', auth, h(async (req, res) => {
    const a = req.auth, self = req.params.id === a.person_id, reason = String((req.body || {}).reason || '').trim();
    if (!self && !isHr(a)) return bad(res, 403, 'forbidden');
    if (!self && reason.length < 5) return bad(res, 400, 'validation', { fields: { reason: 'Give a reason' } });
    const row = await tx(req.org.id, async c => {
      const { rows: [r] } = await c.query('SELECT pgp_sym_decrypt(holder_enc, $2) AS holder, bank_name, pgp_sym_decrypt(sort_code_enc, $2) AS sort, pgp_sym_decrypt(account_enc, $2) AS acct FROM bank_details WHERE person_id = $1', [req.params.id, ENC]);
      if (r) await c.query('INSERT INTO audit_log (org_id, actor_user_id, action, entity, entity_id, reason, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.org.id, a.user_id, 'reveal', 'bank_details', req.params.id, reason || 'Own record', req.ip]);
      return r;
    });
    row ? res.json({ holder: row.holder, bank: row.bank_name, sort: row.sort, acct: row.acct }) : bad(res, 404, 'not_found');
  }));
  app.put('/api/people/:id/bank', auth, h(async (req, res) => {
    const a = req.auth, b = req.body || {};
    if (req.params.id !== a.person_id && !isHr(a)) return bad(res, 403, 'forbidden');
    const acct = String(b.account || '').replace(/\s/g, ''), sort = String(b.sortCode || '').replace(/\D/g, '');
    if (!b.holder || !b.bank || acct.length < 6) return bad(res, 400, 'validation');
    await tx(req.org.id, async c => {
      await c.query(`INSERT INTO bank_details (org_id, person_id, holder_enc, bank_name, sort_code_enc, account_enc, account_last4, method) VALUES ($1,$2,pgp_sym_encrypt($3,$8),$4,pgp_sym_encrypt($5,$8),pgp_sym_encrypt($6,$8),$7,$9)
        ON CONFLICT (person_id) DO UPDATE SET holder_enc = EXCLUDED.holder_enc, bank_name = EXCLUDED.bank_name, sort_code_enc = EXCLUDED.sort_code_enc, account_enc = EXCLUDED.account_enc, account_last4 = EXCLUDED.account_last4, method = EXCLUDED.method, updated_at = now()`,
        [req.org.id, req.params.id, b.holder, b.bank, sort, acct, acct.slice(-4), ENC, b.method || 'BACS']);
      await audit(c, req.org.id, a.user_id, 'update', 'bank_details', req.params.id, req);
    });
    res.json({ ok: true });
  }));

  /* ---------- clock-in and attendance ---------- */
  const NEXT = { null: ['in'], in: ['break_start', 'out'], break_start: ['break_end'], break_end: ['break_start', 'out'], out: ['in'] };
  async function today(c, pid) { return (await c.query("SELECT action, at FROM clock_events WHERE person_id = $1 AND at >= date_trunc('day', now()) ORDER BY at", [pid])).rows; }
  app.get('/api/clock/today', auth, h(async (req, res) => { if (!needPerson(req, res)) return; res.json(await tx(req.org.id, c => today(c, req.auth.person_id))); }));
  app.post('/api/clock', auth, h(async (req, res) => {
    if (!needPerson(req, res)) return; const action = (req.body || {}).action;
    const out = await tx(req.org.id, async c => {
      const ev = await today(c, req.auth.person_id); const last = ev.length ? ev[ev.length - 1].action : null;
      if (!(NEXT[last] || []).includes(action)) return null;
      await c.query('INSERT INTO clock_events (org_id, person_id, action, source) VALUES ($1,$2,$3,$4)', [req.org.id, req.auth.person_id, action, (req.body || {}).source || 'web']);
      return today(c, req.auth.person_id);
    });
    out ? res.json(out) : bad(res, 409, 'invalid_sequence');
  }));
  app.get('/api/attendance/today', auth, role('manager', ...HR), h(async (req, res) => {
    const args = []; const where = scopeSql(req.auth, 'p.id', args);
    const { rows } = await tx(req.org.id, c => c.query(`SELECT p.id AS pid, (SELECT action FROM clock_events e WHERE e.person_id = p.id AND e.at >= date_trunc('day', now()) ORDER BY at DESC LIMIT 1) AS last,
      (SELECT min(at) FROM clock_events e WHERE e.person_id = p.id AND e.action = 'in' AND e.at >= date_trunc('day', now())) AS first_in,
      (SELECT s.start_time FROM shifts s WHERE s.person_id = p.id AND s.date = current_date) AS rostered
      FROM people p WHERE p.archived_at IS NULL AND ${where}`, args));
    res.json(rows.map(r => ({ pid: r.pid, state: r.last || 'not_in', firstIn: r.first_in, rostered: r.rostered ? String(r.rostered).slice(0, 5) : null })));
  }));

  /* ---------- timesheets ---------- */
  const minsOf = d => { if (!d.start_time || !d.end_time) return 0; const [a, b] = [d.start_time, d.end_time].map(t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }); return Math.max(0, b - a - (d.break_minutes || 0)); };
  async function sheet(c, id) {
    const { rows: [t] } = await c.query('SELECT t.*, (SELECT first_name || \' \' || last_name FROM people WHERE id = t.decided_by) AS by_name FROM timesheets t WHERE t.id = $1', [id]); if (!t) return null;
    const { rows: days } = await c.query('SELECT date, start_time, end_time, break_minutes, note FROM timesheet_days WHERE timesheet_id = $1 ORDER BY date', [id]);
    return { id: t.id, pid: t.person_id, wc: t.week_commencing, status: t.status, by: t.by_name, at: t.decided_at, comment: t.comment,
      days: days.map(x => ({ date: x.date, start: x.start_time ? String(x.start_time).slice(0, 5) : '', end: x.end_time ? String(x.end_time).slice(0, 5) : '', breakMins: x.break_minutes, note: x.note || '' })) };
  }
  app.post('/api/timesheets', auth, h(async (req, res) => {
    if (!needPerson(req, res)) return; const wc = (req.body || {}).weekCommencing; if (!ISO.test(wc || '')) return bad(res, 400, 'validation');
    const out = await tx(req.org.id, async c => {
      const { rows: [t] } = await c.query('INSERT INTO timesheets (org_id, person_id, week_commencing) VALUES ($1,$2,$3) ON CONFLICT (person_id, week_commencing) DO UPDATE SET week_commencing = EXCLUDED.week_commencing RETURNING id', [req.org.id, req.auth.person_id, wc]);
      await c.query("INSERT INTO timesheet_days (org_id, timesheet_id, date) SELECT $1, $2, d::date FROM generate_series($3::date, $3::date + 6, interval '1 day') d ON CONFLICT DO NOTHING", [req.org.id, t.id, wc]);
      return sheet(c, t.id);
    });
    res.status(201).json(out);
  }));
  app.get('/api/timesheets', auth, h(async (req, res) => {
    if (!needPerson(req, res)) return;
    res.json(await tx(req.org.id, async c => { const { rows } = await c.query('SELECT id FROM timesheets WHERE person_id = $1 ORDER BY week_commencing DESC LIMIT 12', [req.auth.person_id]); const out = []; for (const r of rows) out.push(await sheet(c, r.id)); return out; }));
  }));
  app.get('/api/timesheets/team', auth, role('manager', ...HR), h(async (req, res) => {
    const args = []; const where = scopeSql(req.auth, 't.person_id', args); let sql = 'SELECT t.id FROM timesheets t WHERE t.person_id <> $' + (args.length + 1) + ' AND ' + where;
    args.push(req.auth.person_id || '00000000-0000-0000-0000-000000000000');
    if (req.query.status) { args.push(req.query.status); sql += ' AND t.status = $' + args.length; }
    const out = await tx(req.org.id, async c => { const { rows } = await c.query(sql + ' ORDER BY t.week_commencing DESC LIMIT 200', args); const list = [];
      for (const r of rows) { const s = await sheet(c, r.id); const { rows: sh } = await c.query('SELECT start_time, end_time FROM shifts WHERE person_id = $1 AND date BETWEEN $2 AND $2::date + 6', [s.pid, s.wc]);
        const mins = s.days.reduce((n, x) => n + minsOf({ start_time: x.start, end_time: x.end, break_minutes: x.breakMins }), 0); const sched = sh.reduce((n, x) => n + minsOf({ start_time: x.start_time, end_time: x.end_time }), 0);
        list.push({ id: s.id, pid: s.pid, wc: s.wc, mins, sched, status: s.status, flag: mins - sched > 120 ? 'over' : null }); }
      return list; });
    res.json(out);
  }));
  app.patch('/api/timesheets/:id/days/:date', auth, h(async (req, res) => {
    const b = req.body || {};
    for (const k of ['start', 'end']) if (b[k] && !HHMM.test(b[k])) return bad(res, 400, 'validation', { fields: { [k]: 'Use 24-hour time, e.g. 09:00' } });
    if (b.start && b.end && b.end <= b.start) return bad(res, 400, 'validation', { fields: { end: 'End must be after start' } });
    const out = await tx(req.org.id, async c => {
      const { rows: [t] } = await c.query('SELECT person_id, status FROM timesheets WHERE id = $1', [req.params.id]);
      if (!t || t.person_id !== req.auth.person_id) return 404; if (!['Draft', 'Requires changes'].includes(t.status)) return 409;
      const r = await c.query('UPDATE timesheet_days SET start_time = $3, end_time = $4, break_minutes = $5, note = $6 WHERE timesheet_id = $1 AND date = $2', [req.params.id, req.params.date, b.start || null, b.end || null, Math.max(0, +b.breakMins || 0), b.note || null]);
      return r.rowCount ? 200 : 404;
    });
    out === 200 ? res.json({ ok: true }) : bad(res, out, out === 409 ? 'not_editable' : 'not_found');
  }));
  app.post('/api/timesheets/:id/submit', auth, h(async (req, res) => {
    const out = await tx(req.org.id, async c => {
      const { rows: [t] } = await c.query("UPDATE timesheets SET status = 'Submitted', submitted_at = now() WHERE id = $1 AND person_id = $2 AND status IN ('Draft','Requires changes') RETURNING person_id, week_commencing", [req.params.id, req.auth.person_id]);
      if (!t) return null;
      const { rows: [p] } = await c.query('SELECT manager_id, first_name, last_name FROM people WHERE id = $1', [t.person_id]);
      await notify(c, req.org.id, p.manager_id, 'ts', 'Timesheet to review', p.first_name + ' ' + p.last_name + ' · w/c ' + t.week_commencing.toISOString().slice(0, 10), '/timesheet');
      await audit(c, req.org.id, req.auth.user_id, 'submit', 'timesheet', req.params.id, req); return true;
    });
    out ? res.json({ status: 'Submitted' }) : bad(res, 409, 'not_submittable');
  }));
  app.post('/api/timesheets/:id/decision', auth, role('manager', ...HR), h(async (req, res) => {
    const { decision, comment } = req.body || {}; const status = decision === 'approve' ? 'Approved' : decision === 'changes' ? 'Requires changes' : null;
    if (!status) return bad(res, 400, 'validation'); if (status === 'Requires changes' && !String(comment || '').trim()) return bad(res, 400, 'validation', { fields: { comment: 'Say what needs changing' } });
    const out = await tx(req.org.id, async c => {
      const { rows: [t] } = await c.query('SELECT person_id FROM timesheets WHERE id = $1 AND status = \'Submitted\'', [req.params.id]);
      if (!t || t.person_id === req.auth.person_id || !(await canSee(c, req.auth, t.person_id))) return null;
      await c.query('UPDATE timesheets SET status = $2, decided_by = $3, decided_at = now(), comment = $4 WHERE id = $1', [req.params.id, status, req.auth.person_id, comment || null]);
      await notify(c, req.org.id, t.person_id, 'ts', 'Timesheet ' + status.toLowerCase(), comment || null, '/timesheet');
      await audit(c, req.org.id, req.auth.user_id, status === 'Approved' ? 'approve' : 'return', 'timesheet', req.params.id, req); return true;
    });
    out ? res.json({ status }) : bad(res, 409, 'not_pending_or_not_allowed');
  }));

  /* ---------- leave (extras; list, create and decision are in server.js) ---------- */
  app.get('/api/leave/types', auth, h(async (req, res) => res.json((await tx(req.org.id, c => c.query('SELECT id, name, deducts, needs_approval FROM leave_types ORDER BY name'))).rows)));
  app.get('/api/leave/balance', auth, h(async (req, res) => {
    const pid = req.query.pid || req.auth.person_id; if (!pid) return bad(res, 409, 'no_employee_record');
    const out = await tx(req.org.id, async c => {
      if (!(await canSee(c, req.auth, pid))) return null; const yr = new Date().getFullYear();
      const { rows: [e] } = await c.query('SELECT days, carried FROM leave_entitlements WHERE person_id = $1 AND leave_year = $2', [pid, yr]);
      const { rows: [s] } = await c.query(`SELECT COALESCE(sum(days) FILTER (WHERE status = 'Approved' AND date_from <= current_date), 0) AS taken,
        COALESCE(sum(days) FILTER (WHERE status = 'Approved' AND date_from > current_date), 0) AS booked, COALESCE(sum(days) FILTER (WHERE status = 'Pending'), 0) AS pending
        FROM leave_requests l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.person_id = $1 AND t.deducts AND extract(year FROM l.date_from) = $2`, [pid, yr]);
      const ent = e ? +e.days + +e.carried : 0; return { entitlement: ent, taken: +s.taken, booked: +s.booked, pending: +s.pending, remaining: ent - s.taken - s.booked - s.pending };
    });
    out ? res.json(out) : bad(res, 403, 'forbidden');
  }));
  app.post('/api/leave/:id/cancel', auth, h(async (req, res) => {
    const n = await tx(req.org.id, async c => { const r = await c.query("UPDATE leave_requests SET status = 'Cancelled' WHERE id = $1 AND person_id = $2 AND status IN ('Pending','Approved') AND date_from > current_date", [req.params.id, req.auth.person_id]); if (r.rowCount) await audit(c, req.org.id, req.auth.user_id, 'cancel', 'leave_request', req.params.id, req); return r.rowCount; });
    n ? res.json({ status: 'Cancelled' }) : bad(res, 409, 'not_cancellable');
  }));
  app.put('/api/leave/entitlements/:pid', auth, role(...HR), h(async (req, res) => {
    const { year, days, carried } = req.body || {}; if (!(+year > 2000) || !(+days >= 0)) return bad(res, 400, 'validation');
    await tx(req.org.id, async c => { await c.query('INSERT INTO leave_entitlements (org_id, person_id, leave_year, days, carried) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (person_id, leave_year) DO UPDATE SET days = EXCLUDED.days, carried = EXCLUDED.carried', [req.org.id, req.params.pid, +year, +days, +carried || 0]); await audit(c, req.org.id, req.auth.user_id, 'update', 'leave_entitlement', req.params.pid, req, { year, days, carried }); });
    res.json({ ok: true });
  }));

  /* ---------- rota ---------- */
  const SHIFT = { E: ['07:30', '15:30'], D: ['09:00', '17:30'], L: ['12:00', '20:00'], S: ['08:30', '16:00'], H: ['09:00', '13:00'] };
  app.get('/api/rota', auth, h(async (req, res) => {
    const from = req.query.from; if (!ISO.test(from || '')) return bad(res, 400, 'validation');
    const out = await tx(req.org.id, async c => {
      const args = [from]; let sql = "SELECT s.id, s.person_id AS pid, s.date, s.code, s.start_time, s.end_time, l.name AS location FROM shifts s JOIN locations l ON l.id = s.location_id WHERE s.date BETWEEN $1 AND $1::date + 6";
      if (req.query.location) { args.push(req.query.location); sql += ' AND l.name = $' + args.length; }
      // Employees only see published weeks.
      if (!isHr(req.auth) && req.auth.role !== 'manager') { sql += ' AND EXISTS (SELECT 1 FROM rota_publications r WHERE r.location_id = s.location_id AND r.week_commencing = $1)'; }
      const { rows } = await c.query(sql, args);
      const { rows: un } = await c.query('SELECT person_id, date FROM unavailability WHERE date BETWEEN $1 AND $1::date + 6', [from]);
      const { rows: pub } = await c.query('SELECT 1 FROM rota_publications r JOIN locations l ON l.id = r.location_id WHERE r.week_commencing = $1' + (req.query.location ? ' AND l.name = $2' : ''), req.query.location ? [from, req.query.location] : [from]);
      const unavailable = {}; un.forEach(u => (unavailable[u.person_id] = unavailable[u.person_id] || []).push(u.date));
      return { shifts: rows.map(r => ({ id: r.id, pid: r.pid, date: r.date, code: r.code, start: String(r.start_time).slice(0, 5), end: String(r.end_time).slice(0, 5), location: r.location })), unavailable, published: pub.length > 0 };
    });
    res.json(out);
  }));
  async function saveShift(req, res, id) {
    const b = req.body || {}; const def = SHIFT[b.code]; if (!def || !ISO.test(b.date || '') || !b.pid || !b.location) return bad(res, 400, 'validation');
    const start = b.start || def[0], end = b.end || def[1]; if (!HHMM.test(start) || !HHMM.test(end) || end <= start) return bad(res, 400, 'validation', { fields: { time: 'Use 24-hour time, end after start' } });
    const out = await tx(req.org.id, async c => {
      if (!(await canSee(c, req.auth, b.pid))) return { s: 403 };
      const { rows: [l] } = await c.query('SELECT id FROM locations WHERE name = $1', [b.location]); if (!l) return { s: 400 };
      const { rows: [lv] } = await c.query("SELECT 1 FROM leave_requests WHERE person_id = $1 AND status = 'Approved' AND $2::date BETWEEN date_from AND date_to", [b.pid, b.date]);
      const r = id
        ? await c.query('UPDATE shifts SET person_id = $2, location_id = $3, date = $4, code = $5, start_time = $6, end_time = $7 WHERE id = $1 RETURNING id', [id, b.pid, l.id, b.date, b.code, start, end])
        : await c.query('INSERT INTO shifts (org_id, person_id, location_id, date, code, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (person_id, date) DO UPDATE SET location_id = EXCLUDED.location_id, code = EXCLUDED.code, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time RETURNING id', [req.org.id, b.pid, l.id, b.date, b.code, start, end]);
      return r.rows[0] ? { s: 200, id: r.rows[0].id, warn: lv ? 'on_leave' : null } : { s: 404 };
    });
    out.s === 200 ? res.json({ id: out.id, warning: out.warn }) : bad(res, out.s, out.s === 403 ? 'forbidden' : out.s === 400 ? 'validation' : 'not_found');
  }
  app.post('/api/rota/shifts', auth, role('manager', ...HR), h((req, res) => saveShift(req, res, null)));
  app.put('/api/rota/shifts/:id', auth, role('manager', ...HR), h((req, res) => saveShift(req, res, req.params.id)));
  app.delete('/api/rota/shifts/:id', auth, role('manager', ...HR), h(async (req, res) => {
    const n = await tx(req.org.id, async c => { const { rows: [s] } = await c.query('SELECT person_id FROM shifts WHERE id = $1', [req.params.id]); if (!s || !(await canSee(c, req.auth, s.person_id))) return 0; return (await c.query('DELETE FROM shifts WHERE id = $1', [req.params.id])).rowCount; });
    n ? res.status(204).end() : bad(res, 404, 'not_found');
  }));
  app.post('/api/rota/copy', auth, role('manager', ...HR), h(async (req, res) => {
    const { fromWeek, toWeek, location } = req.body || {}; if (!ISO.test(fromWeek || '') || !ISO.test(toWeek || '') || !location) return bad(res, 400, 'validation');
    const n = await tx(req.org.id, async c => {
      const args = [req.org.id, fromWeek, toWeek, location]; const scope = scopeSql(req.auth, 's.person_id', args);
      return (await c.query(`INSERT INTO shifts (org_id, person_id, location_id, date, code, start_time, end_time)
        SELECT $1, s.person_id, s.location_id, s.date + ($3::date - $2::date), s.code, s.start_time, s.end_time FROM shifts s JOIN locations l ON l.id = s.location_id
        WHERE s.date BETWEEN $2 AND $2::date + 6 AND l.name = $4 AND ${scope} ON CONFLICT (person_id, date) DO NOTHING`, args)).rowCount;
    });
    res.json({ copied: n });
  }));
  app.post('/api/rota/publish', auth, role('manager', ...HR), h(async (req, res) => {
    const { week, location } = req.body || {}; if (!ISO.test(week || '') || !location) return bad(res, 400, 'validation');
    const out = await tx(req.org.id, async c => {
      const { rows: [l] } = await c.query('SELECT id FROM locations WHERE name = $1', [location]); if (!l) return null;
      await c.query('INSERT INTO rota_publications (org_id, location_id, week_commencing, published_by) VALUES ($1,$2,$3,$4) ON CONFLICT (location_id, week_commencing) DO UPDATE SET published_at = now(), published_by = EXCLUDED.published_by', [req.org.id, l.id, week, req.auth.person_id]);
      const { rows } = await c.query('SELECT DISTINCT person_id FROM shifts WHERE location_id = $1 AND date BETWEEN $2 AND $2::date + 6', [l.id, week]);
      for (const r of rows) await notify(c, req.org.id, r.person_id, 'rota', 'Rota published', location + ' · w/c ' + week, '/rota');
      await audit(c, req.org.id, req.auth.user_id, 'publish', 'rota', location + ' ' + week, req); return rows.length;
    });
    out === null ? bad(res, 400, 'validation') : res.json({ published: true, notified: out });
  }));
  app.put('/api/rota/unavailability', auth, h(async (req, res) => {
    if (!needPerson(req, res)) return; const { date, reason, available } = req.body || {}; if (!ISO.test(date || '')) return bad(res, 400, 'validation');
    await tx(req.org.id, c => available ? c.query('DELETE FROM unavailability WHERE person_id = $1 AND date = $2', [req.auth.person_id, date])
      : c.query('INSERT INTO unavailability (org_id, person_id, date, reason) VALUES ($1,$2,$3,$4) ON CONFLICT (person_id, date) DO UPDATE SET reason = EXCLUDED.reason', [req.org.id, req.auth.person_id, date, reason || null]));
    res.json({ ok: true });
  }));

  /* ---------- document requests ---------- */
  const DELIVERY = ['Download in NexHR', 'Email to work address', 'Posted to home address'];
  const REQ_FLOW = ['Submitted', 'In review', 'Processing', 'Ready', 'Completed'];
  app.get('/api/document-requests', auth, h(async (req, res) => {
    const args = []; const where = scopeSql(req.auth, 'r.person_id', args);
    const out = await tx(req.org.id, async c => {
      const { rows } = await c.query('SELECT r.* FROM document_requests r WHERE ' + where + ' ORDER BY r.created_at DESC LIMIT 500', args);
      const { rows: ev } = rows.length ? await c.query('SELECT e.request_id, e.status, e.at, e.note, p.first_name || \' \' || p.last_name AS by FROM document_request_events e LEFT JOIN people p ON p.id = e.by_person WHERE e.request_id = ANY($1) ORDER BY e.at', [rows.map(r => r.id)]) : { rows: [] };
      return rows.map(r => ({ id: r.id, ref: r.ref, pid: r.person_id, type: r.type, purpose: r.purpose, addressee: r.addressee, details: r.details, delivery: r.delivery, status: r.status, fileId: r.file_id, sub: r.created_at,
        hist: ev.filter(e => e.request_id === r.id).map(e => [e.status, e.at, e.by, e.note]) }));
    });
    res.json(out);
  }));
  app.post('/api/document-requests', auth, h(async (req, res) => {
    if (!needPerson(req, res)) return; const b = req.body || {};
    if (!b.type || !DELIVERY.includes(b.delivery)) return bad(res, 400, 'validation');
    const out = await tx(req.org.id, async c => {
      const ref = await nextRef(c, 'document_requests', 'REQ');
      const { rows: [r] } = await c.query('INSERT INTO document_requests (org_id, ref, person_id, type, purpose, addressee, details, delivery) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [req.org.id, ref, req.auth.person_id, b.type, b.purpose || null, b.addressee || null, b.details || null, b.delivery]);
      await c.query("INSERT INTO document_request_events (org_id, request_id, status, by_person) VALUES ($1,$2,'Submitted',$3)", [req.org.id, r.id, req.auth.person_id]);
      await audit(c, req.org.id, req.auth.user_id, 'create', 'document_request', r.id, req); return { id: r.id, ref };
    });
    res.status(201).json({ ...out, status: 'Submitted' });
  }));
  app.post('/api/document-requests/:id/status', auth, role(...HR), h(async (req, res) => {
    const { status, note, fileId } = req.body || {}; if (![...REQ_FLOW, 'Rejected'].includes(status)) return bad(res, 400, 'validation');
    if (status === 'Rejected' && !String(note || '').trim()) return bad(res, 400, 'validation', { fields: { note: 'Give a reason' } });
    const out = await tx(req.org.id, async c => {
      const { rows: [r] } = await c.query('SELECT person_id, status, type, ref FROM document_requests WHERE id = $1', [req.params.id]); if (!r) return 404;
      if (['Completed', 'Rejected'].includes(r.status)) return 409;
      if (status !== 'Rejected' && REQ_FLOW.indexOf(status) <= REQ_FLOW.indexOf(r.status)) return 409;
      await c.query('UPDATE document_requests SET status = $2, file_id = COALESCE($3, file_id) WHERE id = $1', [req.params.id, status, fileId || null]);
      await c.query('INSERT INTO document_request_events (org_id, request_id, status, note, by_person) VALUES ($1,$2,$3,$4,$5)', [req.org.id, req.params.id, status, note || null, req.auth.person_id]);
      if (['Ready', 'Rejected'].includes(status)) await notify(c, req.org.id, r.person_id, 'doc', r.type + (status === 'Ready' ? ' is ready' : ' request declined'), note || r.ref, '/requests');
      await audit(c, req.org.id, req.auth.user_id, 'status_' + status.toLowerCase().replace(/\s/g, '_'), 'document_request', req.params.id, req); return 200;
    });
    out === 200 ? res.json({ status }) : bad(res, out, out === 409 ? 'invalid_transition' : 'not_found');
  }));

  /* ---------- documents and payslips ---------- */
  app.get('/api/documents', auth, h(async (req, res) => {
    const args = [req.auth.person_id]; const where = isHr(req.auth) ? 'true' : '(d.person_id IS NULL OR d.person_id = $1)';
    const { rows } = await tx(req.org.id, c => c.query(`SELECT d.id, d.person_id AS pid, d.title, d.category, d.file_id, d.requires_ack, d.created_at,
      EXISTS (SELECT 1 FROM document_acknowledgements a WHERE a.document_id = d.id AND a.person_id = $1) AS acked FROM documents d WHERE ${where} ORDER BY d.created_at DESC`, args));
    res.json(rows.map(r => ({ id: r.id, pid: r.pid, title: r.title, category: r.category, fileId: r.file_id, requiresAck: r.requires_ack, acked: r.acked, at: r.created_at })));
  }));
  app.post('/api/documents', auth, role(...HR), h(async (req, res) => {
    const b = req.body || {}; if (!b.title || !b.category || !b.fileId) return bad(res, 400, 'validation');
    const id = await tx(req.org.id, async c => {
      const { rows: [d] } = await c.query('INSERT INTO documents (org_id, person_id, title, category, file_id, requires_ack) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.org.id, b.personId || null, b.title, b.category, b.fileId, !!b.requiresAck]);
      if (b.personId) await notify(c, req.org.id, b.personId, 'doc', 'New document: ' + b.title, b.requiresAck ? 'Please read and acknowledge' : null, '/docs');
      else if (b.requiresAck) { const { rows } = await c.query('SELECT id FROM people WHERE archived_at IS NULL'); for (const p of rows) await notify(c, req.org.id, p.id, 'doc', 'Please acknowledge: ' + b.title, null, '/docs'); }
      await audit(c, req.org.id, req.auth.user_id, 'create', 'document', d.id, req); return d.id;
    });
    res.status(201).json({ id });
  }));
  app.post('/api/documents/:id/acknowledge', auth, h(async (req, res) => {
    if (!needPerson(req, res)) return;
    await tx(req.org.id, c => c.query('INSERT INTO document_acknowledgements (org_id, document_id, person_id) SELECT $1, id, $3 FROM documents WHERE id = $2 AND (person_id IS NULL OR person_id = $3) ON CONFLICT DO NOTHING', [req.org.id, req.params.id, req.auth.person_id]));
    res.json({ ok: true });
  }));
  app.get('/api/payslips', auth, h(async (req, res) => {
    const pid = req.query.pid || req.auth.person_id; if (!pid) return bad(res, 409, 'no_employee_record');
    if (pid !== req.auth.person_id && !isHr(req.auth)) return bad(res, 403, 'forbidden');
    const { rows } = await tx(req.org.id, c => c.query('SELECT id, period, paid_on, gross, overtime, net, currency, file_id FROM payslips WHERE person_id = $1 ORDER BY paid_on DESC', [pid]));
    res.json(rows.map(r => ({ id: r.id, period: r.period, paid: r.paid_on, gross: +r.gross, ot: +r.overtime, net: r.net == null ? null : +r.net, currency: r.currency, fileId: r.file_id })));
  }));
  app.post('/api/payslips', auth, role(...HR), h(async (req, res) => {
    const b = req.body || {}; if (!b.personId || !b.period || !ISO.test(b.paidOn || '') || !(+b.gross >= 0)) return bad(res, 400, 'validation');
    const id = await tx(req.org.id, async c => {
      const { rows: [p] } = await c.query(`INSERT INTO payslips (org_id, person_id, period, paid_on, gross, overtime, net, currency, file_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (person_id, period) DO UPDATE SET paid_on = EXCLUDED.paid_on, gross = EXCLUDED.gross, overtime = EXCLUDED.overtime, net = EXCLUDED.net, file_id = EXCLUDED.file_id RETURNING id`,
        [req.org.id, b.personId, b.period, b.paidOn, +b.gross, +b.overtime || 0, b.net == null ? null : +b.net, req.org.currency, b.fileId || null]);
      await notify(c, req.org.id, b.personId, 'pay', 'Payslip available', b.period, '/payslips');
      await audit(c, req.org.id, req.auth.user_id, 'issue', 'payslip', p.id, req); return p.id;
    });
    res.status(201).json({ id });
  }));

  /* ---------- files (private storage, signed download links) ---------- */
  const sign = (id, exp) => crypto.createHmac('sha256', FILE_SECRET).update(id + '.' + exp).digest('base64url');
  app.post('/api/files', auth, upload.single('file'), h(async (req, res) => {
    const f = req.file; if (!f) return bad(res, 400, 'validation', { fields: { file: 'Choose a file' } });
    const ext = MIME[f.mimetype]; if (!ext) return bad(res, 415, 'unsupported_type', { allowed: ['PDF', 'DOCX', 'PNG', 'JPG'] });
    const id = crypto.randomUUID(); const key = path.join(req.org.id, id + ext);
    await fs.promises.mkdir(path.join(STORAGE, req.org.id), { recursive: true, mode: 0o750 });
    await fs.promises.writeFile(path.join(STORAGE, key), f.buffer, { mode: 0o640 });
    // Hook for a virus scanner (e.g. ClamAV via clamscan): set scanned_ok after scanning. Downloads are refused while scanned_ok is false.
    await tx(req.org.id, async c => { await c.query('INSERT INTO files (id, org_id, storage_key, filename, mime, bytes, uploaded_by, scanned_ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, req.org.id, key, path.basename(f.originalname).slice(0, 200), f.mimetype, f.size, req.auth.person_id, env.VIRUS_SCAN === 'on' ? null : true]); await audit(c, req.org.id, req.auth.user_id, 'upload', 'file', id, req); });
    res.status(201).json({ id, filename: f.originalname, bytes: f.size });
  }));
  async function mayRead(c, a, fileId) {
    if (isHr(a)) return true;
    const { rows } = await c.query(`SELECT 1 FROM files f WHERE f.id = $1 AND (f.uploaded_by = $2
      OR EXISTS (SELECT 1 FROM payslips p WHERE p.file_id = f.id AND p.person_id = $2)
      OR EXISTS (SELECT 1 FROM documents d WHERE d.file_id = f.id AND (d.person_id IS NULL OR d.person_id = $2))
      OR EXISTS (SELECT 1 FROM document_requests r WHERE r.file_id = f.id AND r.person_id = $2 AND r.status IN ('Ready','Completed')))`, [fileId, a.person_id]);
    return rows.length > 0;
  }
  app.get('/api/files/:id/url', auth, h(async (req, res) => {
    const ok = await tx(req.org.id, c => mayRead(c, req.auth, req.params.id)); if (!ok) return bad(res, 404, 'not_found');
    const exp = Math.floor(Date.now() / 1000) + 300; res.json({ url: '/api/files/' + req.params.id + '/download?exp=' + exp + '&sig=' + sign(req.params.id, exp), expiresAt: new Date(exp * 1000).toISOString() });
  }));
  app.get('/api/files/:id/download', h(async (req, res) => {
    if (!req.org) return bad(res, 400, 'workspace_required');
    const exp = +req.query.exp, sig = String(req.query.sig || ''); const want = sign(req.params.id, exp);
    if (!(exp > Date.now() / 1000) || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return bad(res, 403, 'link_expired');
    const f = await tx(req.org.id, c => c.query('SELECT storage_key, filename, mime, scanned_ok FROM files WHERE id = $1', [req.params.id]).then(r => r.rows[0]));
    if (!f) return bad(res, 404, 'not_found'); if (f.scanned_ok === false) return bad(res, 409, 'file_quarantined'); if (f.scanned_ok === null) return bad(res, 409, 'scan_pending');
    res.set('Content-Type', f.mime); res.set('Content-Disposition', 'attachment; filename="' + f.filename.replace(/[^\w.\- ]/g, '_') + '"'); res.set('Cache-Control', 'private, no-store');
    fs.createReadStream(path.join(STORAGE, f.storage_key)).on('error', () => res.status(404).end()).pipe(res);
  }));

  /* ---------- news and notifications ---------- */
  app.get('/api/news', auth, h(async (req, res) => {
    const { rows } = await tx(req.org.id, c => c.query("SELECT n.id, n.title, n.body, n.audience, n.published_at, p.first_name || ' ' || p.last_name AS author FROM news_posts n LEFT JOIN people p ON p.id = n.author_id ORDER BY n.published_at DESC LIMIT 100"));
    res.json(rows);
  }));
  app.post('/api/news', auth, role(...HR), h(async (req, res) => {
    const { title, body, audience } = req.body || {}; if (!String(title || '').trim() || !String(body || '').trim()) return bad(res, 400, 'validation');
    const id = await tx(req.org.id, async c => {
      const { rows: [n] } = await c.query('INSERT INTO news_posts (org_id, title, body, audience, author_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.org.id, title.trim(), body.trim(), audience || 'All', req.auth.person_id]);
      const args = []; let sql = 'SELECT p.id FROM people p WHERE p.archived_at IS NULL';
      if (audience && audience !== 'All') { args.push(audience); sql += ' AND p.location_id = (SELECT id FROM locations WHERE name = $1)'; }
      for (const p of (await c.query(sql, args)).rows) await notify(c, req.org.id, p.id, 'news', title.trim(), null, '/news');
      await audit(c, req.org.id, req.auth.user_id, 'publish', 'news_post', n.id, req); return n.id;
    });
    res.status(201).json({ id });
  }));
  app.get('/api/notifications', auth, h(async (req, res) => {
    if (!req.auth.person_id) return res.json([]);
    const { rows } = await tx(req.org.id, c => c.query('SELECT id, kind, title, body, link, created_at AS at, read_at IS NULL AS unread FROM notifications WHERE person_id = $1 ORDER BY created_at DESC LIMIT 100', [req.auth.person_id]));
    res.json(rows);
  }));
  app.post('/api/notifications/read-all', auth, h(async (req, res) => { await tx(req.org.id, c => c.query('UPDATE notifications SET read_at = now() WHERE person_id = $1 AND read_at IS NULL', [req.auth.person_id])); res.json({ ok: true }); }));
  app.post('/api/notifications/:id/read', auth, h(async (req, res) => { await tx(req.org.id, c => c.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND person_id = $2', [req.params.id, req.auth.person_id])); res.json({ ok: true }); }));

  /* ---------- account: sessions and password ---------- */
  app.get('/api/auth/sessions', auth, h(async (req, res) => {
    const { rows } = await tx(req.org.id, c => c.query('SELECT id, user_agent, ip, location_label, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC', [req.auth.user_id]));
    res.json(rows.map(s => ({ id: s.id, dev: s.user_agent, where: s.location_label || s.ip, when: s.last_seen_at, cur: s.id === req.auth.id })));
  }));
  app.delete('/api/auth/sessions/:id', auth, h(async (req, res) => { await tx(req.org.id, c => c.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2', [req.params.id, req.auth.user_id])); res.status(204).end(); }));
  app.delete('/api/auth/sessions', auth, h(async (req, res) => {
    if (req.query.others !== '1') return bad(res, 400, 'validation');
    await tx(req.org.id, c => c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [req.auth.user_id, req.auth.id])); res.status(204).end();
  }));
  app.post('/api/auth/password', auth, h(async (req, res) => {
    const { current, next } = req.body || {}; if (passwordProblem(next)) return bad(res, 400, 'validation', { fields: { next: passwordProblem(next) } });
    const out = await tx(req.org.id, async c => {
      const { rows: [u] } = await c.query('SELECT password_hash FROM users WHERE id = $1', [req.auth.user_id]);
      if (!u || !u.password_hash || !(await argon2.verify(u.password_hash, String(current || '')))) return false;
      await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.auth.user_id, await argon2.hash(next, { type: argon2.argon2id })]);
      await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [req.auth.user_id, req.auth.id]);
      await audit(c, req.org.id, req.auth.user_id, 'password_change', 'auth', null, req); return true;
    });
    out ? res.json({ ok: true }) : bad(res, 400, 'validation', { fields: { current: 'Current password is incorrect' } });
  }));

  /* ---------- audit and reports ---------- */
  app.get('/api/audit', auth, role(...HR), h(async (req, res) => {
    const args = []; const w = ['true'];
    if (req.query.entity) { args.push(req.query.entity); w.push('a.entity = $' + args.length); }
    if (ISO.test(req.query.from || '')) { args.push(req.query.from); w.push('a.at >= $' + args.length); }
    if (ISO.test(req.query.to || '')) { args.push(req.query.to); w.push("a.at < $" + args.length + "::date + 1"); }
    const { rows } = await tx(req.org.id, c => c.query('SELECT a.at, COALESCE(u.name, a.actor_label, \'System\') AS who, a.action, a.entity, a.entity_id, a.reason, a.meta FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id WHERE ' + w.join(' AND ') + ' ORDER BY a.at DESC LIMIT ' + Math.min(1000, +req.query.limit || 200), args));
    res.json(rows);
  }));
  const csv = rows => { if (!rows.length) return ''; const k = Object.keys(rows[0]); const q = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); return k.join(',') + '\n' + rows.map(r => k.map(x => q(r[x])).join(',')).join('\n') + '\n'; };
  const REPORTS = {
    headcount: `SELECT p.emp_no, p.first_name, p.last_name, p.job_title, d.name AS department, l.name AS location, p.contract_type, p.status, p.start_date FROM people p LEFT JOIN departments d ON d.id = p.department_id LEFT JOIN locations l ON l.id = p.location_id WHERE p.archived_at IS NULL ORDER BY p.last_name`,
    hours: `SELECT p.emp_no, p.first_name, p.last_name, t.week_commencing, t.status, round(sum(EXTRACT(epoch FROM (td.end_time - td.start_time)) / 60 - td.break_minutes) / 60.0, 2) AS hours FROM timesheets t JOIN people p ON p.id = t.person_id JOIN timesheet_days td ON td.timesheet_id = t.id WHERE td.start_time IS NOT NULL AND td.end_time IS NOT NULL AND t.week_commencing BETWEEN $1 AND $2 GROUP BY p.emp_no, p.first_name, p.last_name, t.week_commencing, t.status ORDER BY t.week_commencing, p.last_name`,
    absence: `SELECT p.emp_no, p.first_name, p.last_name, lt.name AS type, l.date_from, l.date_to, l.days, l.status FROM leave_requests l JOIN people p ON p.id = l.person_id JOIN leave_types lt ON lt.id = l.leave_type_id WHERE l.date_from BETWEEN $1 AND $2 ORDER BY l.date_from`
  };
  app.get('/api/reports/:name.csv', auth, role('manager', ...HR), h(async (req, res) => {
    const sql = REPORTS[req.params.name]; if (!sql) return bad(res, 404, 'not_found');
    if (req.auth.role === 'manager' && req.params.name === 'headcount') return bad(res, 403, 'forbidden');
    const from = ISO.test(req.query.from || '') ? req.query.from : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), to = ISO.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10);
    // Managers only get their own team's rows.
    const team = req.auth.role === 'manager';
    const q = team ? sql.replace(/ ORDER BY /, ' AND (p.id = $3 OR p.manager_id = $3) ORDER BY ') : sql;
    const { rows } = await tx(req.org.id, async c => { await audit(c, req.org.id, req.auth.user_id, 'export', 'report', req.params.name, req, { from, to }); return c.query(q, req.params.name === 'headcount' ? [] : team ? [from, to, req.auth.person_id] : [from, to]); });
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="nexhr_' + req.params.name + '_' + from + '_' + to + '.csv"');
    res.send(csv(rows));
  }));
};
