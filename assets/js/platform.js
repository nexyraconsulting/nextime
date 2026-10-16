// NexHR platform layer (front-end demo implementation).
// Every function here maps to a server endpoint in server/server.js. To go live,
// replace the bodies with fetch() calls to /api/... and keep the same signatures.
// Storage: localStorage 'nexhr.platform.v1' (tenants, users), sessionStorage 'nxhrSession'.

import CONFIG from './appConfig.js';
export { CONFIG };
export const BASE_DOMAIN = CONFIG.baseDomain;
export const MODE = CONFIG.mode;
export const TRIAL_DAYS = 14;
export const SESSION_MS = 8 * 3600e3;
export const RESERVED = ['www','app','api','admin','mail','help','support','status','billing','login','signup','docs','blog','static','assets','cdn','demo-admin','nexhr','nexyra'];

// Price per billable employee. Annual = 10 x monthly (two months free).
export const CURRENCIES = {
  GBP: { code: 'GBP', sym: '£', month: 4, locale: 'en-GB', label: 'GBP £' },
  EUR: { code: 'EUR', sym: '€', month: 4.5, locale: 'de-DE', label: 'EUR €' },
  USD: { code: 'USD', sym: '$', month: 5, locale: 'en-US', label: 'USD $' }
};
export function price(cur, interval) { const c = CURRENCIES[cur] || CURRENCIES.GBP; return interval === 'year' ? c.month * 10 : c.month; }
export function money(cur, n) { const c = CURRENCIES[cur] || CURRENCIES.GBP; return c.sym + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
export function detectCurrency() {
  try { const saved = localStorage.getItem('nexhr.currency'); if (CURRENCIES[saved]) return saved; } catch (e) {}
  const l = (navigator.language || 'en-GB').toLowerCase();
  if (/^en-(us|ca)|-us$/.test(l)) return 'USD';
  if (/^(de|fr|es|it|nl|pt|fi|el|sk|sl|et|lv|lt|ga|mt)|-(ie|at|be)$/.test(l)) return 'EUR';
  return 'GBP';
}
export function saveCurrency(c) { try { localStorage.setItem('nexhr.currency', c); } catch (e) {} }

export const ROLES = {
  employee: { label: 'Employee', persona: 'employee' },
  manager: { label: 'Manager', persona: 'manager' },
  hr: { label: 'HR', persona: 'hr' },
  admin: { label: 'Admin', persona: 'hr' }
};

/* ---------- storage ---------- */
const KEY = 'nexhr.platform.v1';
function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { tenants: {}, users: [], tokens: [] }; } catch (e) { return { tenants: {}, users: [], tokens: [] }; } }
function write(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
function uid(p) { return p + '_' + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const now = () => Date.now();
const lc = s => String(s || '').trim().toLowerCase();

const DEMO_SLUG = 'larkspur';
function ensureDemo(db) {
  if (db.tenants[DEMO_SLUG]) return db;
  db.tenants[DEMO_SLUG] = {
    id: 'org_lark_7f2c', slug: DEMO_SLUG, name: 'Larkspur Care Group', legal: 'Larkspur Care Group Ltd', country: 'GB', currency: 'GBP',
    tz: 'Europe/London', leaveYear: '1 January', region: 'United Kingdom (London)', locSummary: '3 clinics · Head office', require2fa: false,
    plan: { status: 'active', interval: 'month', trialEnds: null, card: 'Visa ending 4242', renews: '2026-11-01' }, demo: true, createdAt: '2026-01-05'
  };
  [['Priya Nair', 'priya.nair@larkspurcare.co.uk', 'admin'], ['Daniel Price', 'daniel.price@larkspurcare.co.uk', 'manager'], ['Amara Okafor', 'amara.okafor@larkspurcare.co.uk', 'employee']]
    .forEach(([name, email, role]) => db.users.push({ id: uid('usr'), tenant: DEMO_SLUG, name, email, role, status: 'active', verified: true, totp: null, createdAt: '2026-01-05', demo: true }));
  return db;
}
function db() { const d = ensureDemo(read()); write(d); return d; }

/* ---------- workspace addresses ---------- */
export function slugify(s) { return lc(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); }
export function slugProblem(s) {
  if (!s) return 'Choose a workspace address';
  if (s.length < 3) return 'Use at least 3 characters';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s)) return 'Use lowercase letters, numbers and hyphens only';
  if (RESERVED.indexOf(s) >= 0) return 'This address is reserved';
  if (db().tenants[s]) return s + '.' + BASE_DOMAIN + ' is already taken';
  return '';
}
export function onPlatformHost() { const h = location.hostname; return h === BASE_DOMAIN || h.endsWith('.' + BASE_DOMAIN); }
export function workspaceFromHost() {
  const h = location.hostname;
  if (h.endsWith('.' + BASE_DOMAIN)) { const sub = h.slice(0, -(BASE_DOMAIN.length + 1)); if (sub && sub.indexOf('.') < 0 && ['www', 'app'].indexOf(sub) < 0) return sub; }
  return '';
}
export function currentWorkspace() {
  const q = new URLSearchParams(location.search).get('w');
  return lc(workspaceFromHost() || q || lastWorkspace());
}
export function lastWorkspace() { try { return localStorage.getItem('nexhr.lastWorkspace') || ''; } catch (e) { return ''; } }
function rememberWorkspace(s) { try { localStorage.setItem('nexhr.lastWorkspace', s); } catch (e) {} }
// Builds a link to a page inside a workspace. On nexhr.com this is acme.nexhr.com/page; elsewhere page?w=acme.
export function workspaceUrl(slug, page) {
  page = page || 'login.html';
  if (onPlatformHost()) return location.protocol + '//' + slug + '.' + BASE_DOMAIN + '/' + page;
  return page + (page.indexOf('?') >= 0 ? '&' : '?') + 'w=' + encodeURIComponent(slug);
}
export function marketingUrl(page) { return onPlatformHost() ? location.protocol + '//www.' + BASE_DOMAIN + '/' + (page || '') : (page || 'index.html'); }

/* ---------- tenants ---------- */
export function getTenant(slug) { return db().tenants[lc(slug)] || null; }
export function updateTenant(slug, patch) { const d = db(); const t = d.tenants[slug]; if (!t) return null; Object.assign(t, patch); write(d); return t; }
export function createTenant(o) {
  const d = db(); const slug = lc(o.slug);
  if (slugProblem(slug)) throw new Error(slugProblem(slug));
  const trialEnds = new Date(now() + TRIAL_DAYS * 864e5).toISOString().slice(0, 10);
  const t = {
    id: uid('org'), slug, name: o.name.trim(), legal: (o.legal || o.name).trim(), country: o.country || 'GB', currency: o.currency || 'GBP',
    tz: o.tz || 'Europe/London', leaveYear: o.leaveYear || '1 January', region: o.region || 'United Kingdom (London)', locSummary: '',
    size: o.size || '', industry: o.industry || '', locations: [], departments: [], require2fa: false,
    plan: { status: 'trialing', interval: 'month', trialEnds, card: null, renews: null }, demo: false, createdAt: new Date().toISOString().slice(0, 10)
  };
  d.tenants[slug] = t; write(d); return t;
}
export function workspacesFor(email) {
  const d = db(), e = lc(email);
  return d.users.filter(u => lc(u.email) === e && u.status !== 'disabled').map(u => d.tenants[u.tenant]).filter(Boolean);
}
export function billableCount(slug) { const t = getTenant(slug); return t && t.demo ? 186 : Math.max(1, usersIn(slug).filter(u => u.status !== 'disabled').length); }

/* ---------- users ---------- */
export function usersIn(slug) { return db().users.filter(u => u.tenant === slug); }
export function findUser(slug, email) { const e = lc(email); return db().users.find(u => u.tenant === slug && lc(u.email) === e) || null; }
export function getUser(id) { return db().users.find(u => u.id === id) || null; }
export function updateUser(id, patch) { const d = db(); const u = d.users.find(x => x.id === id); if (!u) return null; Object.assign(u, patch); write(d); return u; }
export function removeUser(id) { const d = db(); d.users = d.users.filter(u => u.id !== id); write(d); }
export function emailProblem(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()) ? '' : 'Enter a valid email address'; }
export function passwordProblem(p) {
  if (!p || p.length < 10) return 'Use at least 10 characters';
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return 'Include at least one letter and one number';
  return '';
}
export async function createUser(o) {
  const d = db();
  if (d.users.some(u => u.tenant === o.tenant && lc(u.email) === lc(o.email))) throw new Error('This email already has an account in this workspace');
  const u = { id: uid('usr'), tenant: o.tenant, name: o.name.trim(), email: lc(o.email), role: o.role || 'employee', status: o.password ? 'active' : 'invited',
    verified: !!o.verified, pwd: o.password ? await hashPassword(o.password) : null, totp: null, createdAt: new Date().toISOString().slice(0, 10), invitedBy: o.invitedBy || null };
  d.users.push(u); write(d); return u;
}
export function invite(o) {
  const d = db();
  if (d.users.some(u => u.tenant === o.tenant && lc(u.email) === lc(o.email))) throw new Error('This person already has an account');
  const u = { id: uid('usr'), tenant: o.tenant, name: (o.name || o.email.split('@')[0]).trim(), email: lc(o.email), role: o.role || 'employee', status: 'invited',
    verified: false, pwd: null, totp: null, createdAt: new Date().toISOString().slice(0, 10), invitedBy: o.invitedBy || null };
  d.users.push(u);
  const token = uid('inv').slice(4); d.tokens.push({ kind: 'invite', token, user: u.id, exp: now() + 7 * 864e5 }); write(d);
  return { user: u, token, link: workspaceUrl(o.tenant, 'login.html?invite=' + token) };
}
export function inviteLink(userId) {
  const d = db(); let t = d.tokens.find(x => x.kind === 'invite' && x.user === userId && x.exp > now());
  if (!t) { t = { kind: 'invite', token: uid('inv').slice(4), user: userId, exp: now() + 7 * 864e5 }; d.tokens.push(t); write(d); }
  const u = getUser(userId); return workspaceUrl(u.tenant, 'login.html?invite=' + t.token);
}
export function readInvite(token) {
  const d = db(); const t = d.tokens.find(x => x.kind === 'invite' && x.token === token);
  if (!t || t.exp < now()) return null; const u = d.users.find(x => x.id === t.user); if (!u || u.status !== 'invited') return null;
  return { user: u, tenant: d.tenants[u.tenant] };
}
export async function acceptInvite(token, name, password) {
  const inv = readInvite(token); if (!inv) throw new Error('This invitation has expired. Ask your administrator to send a new one.');
  const d = db(); const u = d.users.find(x => x.id === inv.user.id);
  u.name = name.trim() || u.name; u.pwd = await hashPassword(password); u.status = 'active'; u.verified = true;
  d.tokens = d.tokens.filter(x => x.token !== token); write(d); return u;
}

/* ---------- email codes (verification and reset) ---------- */
// The demo shows the code on screen. The server emails it instead and never returns it.
export function issueCode(kind, userId) {
  const d = db(); const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  d.tokens = d.tokens.filter(x => !(x.kind === kind && x.user === userId));
  d.tokens.push({ kind, user: userId, code, exp: now() + 15 * 60e3, tries: 0 }); write(d); return code;
}
export function checkCode(kind, userId, code) {
  const d = db(); const t = d.tokens.find(x => x.kind === kind && x.user === userId);
  if (!t || t.exp < now()) return 'This code has expired. Send a new one.';
  if (t.tries >= 5) return 'Too many attempts. Send a new code.';
  if (String(code).trim() !== t.code) { t.tries++; write(d); return 'That code isn\u2019t right. Check the email and try again.'; }
  d.tokens = d.tokens.filter(x => x !== t); write(d); return '';
}

/* ---------- passwords ---------- */
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function pbkdf2(pw, salt, iter) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations: iter, hash: 'SHA-256' }, k, 256));
}
export async function hashPassword(pw) { const salt = hex(crypto.getRandomValues(new Uint8Array(16))); return { salt, iter: 210000, hash: await pbkdf2(pw, salt, 210000) }; }
async function checkPassword(pw, rec) { if (!rec) return false; const h = await pbkdf2(pw, rec.salt, rec.iter); let d = h.length ^ rec.hash.length; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ rec.hash.charCodeAt(i); return d === 0; }
export async function setPassword(userId, pw) { updateUser(userId, { pwd: await hashPassword(pw) }); }

/* ---------- lockout ---------- */
const LOCK = 'nexhr.lock'; const MAX_TRIES = 5; const LOCK_MS = 15 * 60e3;
function locks() { try { return JSON.parse(localStorage.getItem(LOCK) || '{}'); } catch (e) { return {}; } }
export function lockedFor(slug, email) { const l = locks()[slug + '|' + lc(email)]; return l && l.until > now() ? Math.ceil((l.until - now()) / 1000) : 0; }
function failed(slug, email) { const all = locks(), k = slug + '|' + lc(email), l = all[k] || { n: 0, until: 0 }; l.n++; if (l.n >= MAX_TRIES) { l.until = now() + LOCK_MS; l.n = 0; } all[k] = l; try { localStorage.setItem(LOCK, JSON.stringify(all)); } catch (e) {} return l.until > now() ? 0 : MAX_TRIES - l.n; }
function cleared(slug, email) { const all = locks(); delete all[slug + '|' + lc(email)]; try { localStorage.setItem(LOCK, JSON.stringify(all)); } catch (e) {} }

// Step 1 of sign-in. Returns { user, needs: 'totp' | 'enrol' | null } or { error }.
export async function signIn(slug, email, password) {
  const t = getTenant(slug); if (!t) return { error: 'We can\u2019t find that workspace.' };
  const wait = lockedFor(slug, email); if (wait) return { error: 'Too many attempts. Try again in ' + Math.ceil(wait / 60) + ' minutes.', locked: wait };
  const u = findUser(slug, email);
  const ok = u && u.status === 'active' && await checkPassword(password, u.pwd);
  if (!ok) { const left = failed(slug, email); return { error: left ? 'Email or password is incorrect. ' + left + (left === 1 ? ' attempt' : ' attempts') + ' left.' : 'Too many attempts. Try again in 15 minutes.' }; }
  cleared(slug, email);
  if (u.totp && u.totp.enabled) return { user: u, needs: 'totp' };
  if (needs2fa(t, u)) return { user: u, needs: 'enrol' };
  return { user: u, needs: null };
}
export function needs2fa(t, u) { return u.role === 'admin' || u.role === 'hr' || !!t.require2fa; }

/* ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() { const b = crypto.getRandomValues(new Uint8Array(20)); let bits = '', out = ''; b.forEach(x => bits += x.toString(2).padStart(8, '0')); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; }
function b32bytes(s) { let bits = ''; s.replace(/=+$/, '').toUpperCase().split('').forEach(c => { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return new Uint8Array(out); }
async function hotp(secret, counter) {
  const key = await crypto.subtle.importKey('raw', b32bytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8); const v = new DataView(msg); v.setUint32(0, Math.floor(counter / 4294967296)); v.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
export async function verifyTotp(secret, code) { code = String(code || '').replace(/\D/g, ''); if (code.length !== 6) return false; const c = Math.floor(now() / 30000); for (const w of [0, -1, 1]) if (await hotp(secret, c + w) === code) return true; return false; }
export function otpauthUri(secret, email, workspace) { return 'otpauth://totp/' + encodeURIComponent('NexHR (' + workspace + '):' + email) + '?secret=' + secret + '&issuer=NexHR&algorithm=SHA1&digits=6&period=30'; }
export function formatSecret(s) { return s.replace(/(.{4})/g, '$1 ').trim(); }
export function recoveryCodes() { return Array.from({ length: 8 }, () => { const b = crypto.getRandomValues(new Uint8Array(5)); return hex(b).slice(0, 5) + '-' + hex(b).slice(5, 10); }); }
export async function enableTotp(userId, secret, codes) { updateUser(userId, { totp: { enabled: true, secret, recovery: codes, at: new Date().toISOString().slice(0, 10) } }); }
export function resetTotp(userId) { updateUser(userId, { totp: null }); }
export async function checkSecondFactor(u, code) {
  if (!u.totp) return false;
  if (await verifyTotp(u.totp.secret, code)) return true;
  const rc = String(code || '').trim().toLowerCase(); const i = (u.totp.recovery || []).indexOf(rc);
  if (i >= 0) { const rec = u.totp.recovery.slice(); rec.splice(i, 1); updateUser(u.id, { totp: { ...u.totp, recovery: rec } }); return true; }
  return false;
}
// Loads the QR renderer set in appConfig.qrScriptUrl. Returns an SVG string, or '' if unavailable.
export function qrSvg(text) {
  return new Promise(res => {
    const draw = () => { try { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); res(q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })); } catch (e) { res(''); } };
    if (window.qrcode) return draw();
    const s = document.createElement('script'); s.src = CONFIG.qrScriptUrl; s.onload = draw; s.onerror = () => res(''); document.head.appendChild(s);
  });
}

/* ---------- sessions ---------- */
export function startSession(u, extra) {
  const t = getTenant(u.tenant);
  const s = { tenant: u.tenant, userId: u.id, name: u.name, email: u.email, role: u.role, persona: (ROLES[u.role] || ROLES.employee).persona, demo: !!t.demo,
    tok: hex(crypto.getRandomValues(new Uint8Array(16))), at: now(), exp: now() + SESSION_MS, ...(extra || {}) };
  try { sessionStorage.setItem('nxhrSession', JSON.stringify(s)); } catch (e) {}
  rememberWorkspace(u.tenant); updateUser(u.id, { lastLogin: new Date().toISOString() }); return s;
}
export function demoSession() { const u = db().users.find(x => x.tenant === DEMO_SLUG && x.role === 'admin'); return startSession(u, { demo: true }); }
export function getSession() { try { const s = JSON.parse(sessionStorage.getItem('nxhrSession') || 'null'); return s && s.exp > now() && s.userId ? s : null; } catch (e) { return null; } }
export function endSession() { try { sessionStorage.removeItem('nxhrSession'); } catch (e) {} }
export const DEMO = DEMO_SLUG;
