'use strict';
/**
 * SEAGYM data layer – SQLite (node:sqlite), auth, members, sessions.
 * Passwords hashed with crypto.scrypt. Sessions stored in DB.
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const DB_PATH = process.env.DB_FILE || 'seagym.db';
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT UNIQUE,
  full_name TEXT NOT NULL,
  national_id TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  email TEXT DEFAULT '',
  dob TEXT NOT NULL,
  gender TEXT NOT NULL,
  type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  frozen INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  ec_name TEXT DEFAULT '',
  ec_phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  member_row_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_members_member_id ON members(member_id);
`);

const MONTHS = { 'Monthly': 1, '3 Months': 3, '6 Months': 6, 'Yearly': 12 };
const PLAN_PRICES = { 'Monthly': 450, '3 Months': 1200, '6 Months': 2100, 'Yearly': 3600 }; // EGP example, realistic for local gym

const iso = d => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const nowISO = () => new Date().toISOString();
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

function addMonths(start, n) {
  const d = new Date(start + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

function decorate(r) {
  if (!r) return null;
  const days = dayDiff(r.end_date, today());
  let status;
  if (!r.active) status = 'Inactive';
  else if (r.frozen) status = 'Frozen';
  else if (days < 0) status = 'Expired';
  else if (days <= 7) status = 'Expiring Soon';
  else status = 'Active';
  return { ...r, status, remaining_days: days, price: PLAN_PRICES[r.type] || 0 };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return { hash: derived.toString('hex'), salt };
}

async function verifyPassword(password, hash, salt) {
  const derived = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
}

function validateMember(b, isEdit) {
  const e = {}, t = v => (v ?? '').toString().trim();
  if (!t(b.full_name) || t(b.full_name).length < 2) e.full_name = 'Enter the member’s full name.';
  if (!t(b.national_id)) e.national_id = 'Enter a National ID or passport number.';
  else if (!/^[A-Za-z0-9-]{5,20}$/.test(t(b.national_id))) e.national_id = 'Use 5–20 letters, numbers or hyphens.';
  if (!/^\+?[0-9 ()-]{7,16}$/.test(t(b.phone))) e.phone = 'Enter a valid phone number.';
  if (t(b.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t(b.email))) e.email = 'Enter a valid email or leave blank.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t(b.dob)) || t(b.dob) >= today()) e.dob = 'Enter a valid past date of birth.';
  if (!['Female', 'Male', 'Other'].includes(b.gender)) e.gender = 'Select a gender.';
  if (!MONTHS[b.type]) e.type = 'Select a membership type.';
  if (!isEdit && !/^\d{4}-\d{2}-\d{2}$/.test(t(b.start_date))) e.start_date = 'Enter a valid start date.';
  if (t(b.ec_phone) && !/^\+?[0-9 ()-]{7,16}$/.test(t(b.ec_phone))) e.ec_phone = 'Enter a valid emergency contact phone.';
  if (t(b.ec_name) && !t(b.ec_phone)) e.ec_phone = 'Enter the emergency contact’s phone number.';
  if (t(b.ec_phone) && !t(b.ec_name)) e.ec_name = 'Enter the emergency contact’s name.';
  return e;
}

const FIELDS = ['full_name', 'national_id', 'phone', 'email', 'dob', 'gender', 'type', 'ec_name', 'ec_phone', 'notes'];
const clean = b => Object.fromEntries(FIELDS.map(k => [k, (b[k] ?? '').toString().trim()]));
const dupeNational = (nid, id = 0) => db.prepare('SELECT 1 FROM members WHERE national_id=? AND id<>?').get(nid, id);

function createMember(b) {
  const e = validateMember(b, false);
  const c = clean(b);
  if (!e.national_id && dupeNational(c.national_id)) e.national_id = 'A member with this ID number already exists.';
  if (Object.keys(e).length) return { errors: e };
  const end = addMonths(b.start_date, MONTHS[c.type]);
  const r = db.prepare(`INSERT INTO members
    (full_name,national_id,phone,email,dob,gender,type,ec_name,ec_phone,notes,start_date,end_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.full_name, c.national_id, c.phone, c.email, c.dob, c.gender, c.type, c.ec_name, c.ec_phone, c.notes, b.start_date, end);
  const mid = 'SEA-' + String(r.lastInsertRowid).padStart(5, '0');
  db.prepare('UPDATE members SET member_id=? WHERE id=?').run(mid, r.lastInsertRowid);
  return { member: getMember(r.lastInsertRowid) };
}

function getMember(id) {
  const r = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  return decorate(r);
}

function getMemberByMemberId(mid) {
  const r = db.prepare('SELECT * FROM members WHERE member_id=?').get(mid);
  return decorate(r);
}

function updateMember(id, b) {
  const old = getMember(id);
  if (!old) return { notFound: true };
  const e = validateMember(b, true);
  const c = clean(b);
  if (!e.national_id && dupeNational(c.national_id, id)) e.national_id = 'A member with this ID number already exists.';
  if (Object.keys(e).length) return { errors: e };
  const end = c.type !== old.type ? addMonths(old.start_date, MONTHS[c.type]) : old.end_date;
  db.prepare(`UPDATE members SET full_name=?,national_id=?,phone=?,email=?,dob=?,gender=?,type=?,ec_name=?,ec_phone=?,notes=?,end_date=? WHERE id=?`)
    .run(c.full_name, c.national_id, c.phone, c.email, c.dob, c.gender, c.type, c.ec_name, c.ec_phone, c.notes, end, id);
  return { member: getMember(id) };
}

function removeMember(id) {
  // Also clear linked user
  db.prepare('UPDATE users SET member_row_id=NULL WHERE member_row_id=?').run(id);
  return db.prepare('DELETE FROM members WHERE id=?').run(id).changes > 0;
}

function setActive(id, active) {
  db.prepare('UPDATE members SET active=? WHERE id=?').run(active ? 1 : 0, id);
  return getMember(id);
}

function renew(id, type) {
  const m = getMember(id);
  if (!m) return null;
  const plan = MONTHS[type] ? type : m.type;
  const from = m.end_date > today() ? m.end_date : today();
  db.prepare('UPDATE members SET type=?, start_date=CASE WHEN end_date<? THEN ? ELSE start_date END, end_date=?, frozen=0, active=1 WHERE id=?')
    .run(plan, today(), today(), addMonths(from, MONTHS[plan]), id);
  return getMember(id);
}

function setFrozen(id, f) {
  db.prepare('UPDATE members SET frozen=? WHERE id=?').run(f ? 1 : 0, id);
  return getMember(id);
}

function listMembers({ q = '', status = '', sort = 'member_id', dir = 'asc', page = 1, size = 10 } = {}) {
  const like = '%' + q.trim().replace(/[%_]/g, '') + '%';
  let rows = db.prepare(`SELECT * FROM members WHERE
    full_name LIKE ? OR member_id LIKE ? OR email LIKE ? OR phone LIKE ? OR national_id LIKE ?`)
    .all(like, like, like, like, like).map(decorate);
  if (status) rows = rows.filter(r => r.status === status);
  const key = ['member_id', 'full_name', 'phone', 'type', 'start_date', 'end_date', 'status'].includes(sort) ? sort : 'member_id';
  rows.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { numeric: true }) * (dir === 'desc' ? -1 : 1));
  const total = rows.length, pages = Math.max(1, Math.ceil(total / size)), p = Math.min(Math.max(1, +page || 1), pages);
  return { total, page: p, pages, members: rows.slice((p - 1) * size, p * size) };
}

function stats() {
  const rows = db.prepare('SELECT * FROM members').all().map(decorate);
  const n = s => rows.filter(r => r.status === s).length;
  const month = today().slice(0, 7);
  return {
    total: rows.length,
    active: n('Active'),
    expired: n('Expired'),
    expiring: n('Expiring Soon'),
    frozen: n('Frozen'),
    inactive: n('Inactive'),
    newThisMonth: rows.filter(r => (r.created_at || '').startsWith(month)).length,
    byType: Object.keys(MONTHS).map(t => ({ type: t, count: rows.filter(r => r.type === t).length, price: PLAN_PRICES[t] })),
    recent: rows.sort((a, b) => b.id - a.id).slice(0, 5),
    alerts: rows.filter(r => r.status === 'Expiring Soon').sort((a, b) => a.remaining_days - b.remaining_days).slice(0, 5)
  };
}

/* ---------- Auth ---------- */

async function createUser({ username, password, role, member_row_id = null }) {
  const u = (username || '').trim();
  if (!u || u.length < 3) return { error: 'Username must be at least 3 characters.' };
  if (!password || password.length < 6) return { error: 'Password must be at least 6 characters.' };
  if (!['admin', 'member'].includes(role)) return { error: 'Invalid role.' };
  const exists = db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(u);
  if (exists) return { error: 'Username already taken.' };
  const { hash, salt } = await hashPassword(password);
  const r = db.prepare('INSERT INTO users (username, password_hash, salt, role, member_row_id) VALUES (?,?,?,?,?)')
    .run(u, hash, salt, role, member_row_id);
  return { user: { id: r.lastInsertRowid, username: u, role, member_row_id } };
}

async function authenticate(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get((username || '').trim());
  if (!u) return null;
  const ok = await verifyPassword(password || '', u.password_hash, u.salt);
  if (!ok) return null;
  return { id: u.id, username: u.username, role: u.role, member_row_id: u.member_row_id };
}

function createSession(userId, hours = 24 * 7) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return { token, expires_at: expires };
}

function getSession(token) {
  if (!token) return null;
  const s = db.prepare('SELECT s.*, u.username, u.role, u.member_row_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=?').get(token);
  if (!s) return null;
  if (s.expires_at < nowISO()) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  return { token: s.token, user_id: s.user_id, username: s.username, role: s.role, member_row_id: s.member_row_id, expires_at: s.expires_at };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
}

function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

function getUserById(id) {
  return db.prepare('SELECT id, username, role, member_row_id, created_at FROM users WHERE id=?').get(id);
}

function getMemberForUser(user) {
  if (!user || !user.member_row_id) return null;
  return getMember(user.member_row_id);
}

/* Seed admin + demo accounts (idempotent) */
async function seed() {
  const adminExists = db.prepare("SELECT 1 FROM users WHERE username='Admin01' COLLATE NOCASE").get();
  if (!adminExists) {
    await createUser({ username: 'Admin01', password: 'Admin001', role: 'admin' });
    console.log('Seeded admin: Admin01');
  }

  // Demo member 1
  let demo1 = db.prepare("SELECT id FROM members WHERE national_id='DEMO-00001'").get();
  if (!demo1) {
    const r = createMember({
      full_name: 'Alex Rivera',
      national_id: 'DEMO-00001',
      phone: '01000000001',
      email: 'alex.demo@seagym.local',
      dob: '1992-05-14',
      gender: 'Male',
      type: 'Yearly',
      start_date: today(),
      ec_name: 'Jordan Rivera',
      ec_phone: '01000000011'
    });
    demo1 = { id: r.member.id };
  }
  const u1 = db.prepare("SELECT 1 FROM users WHERE username='demo1' COLLATE NOCASE").get();
  if (!u1) {
    await createUser({ username: 'demo1', password: 'Demo@12345', role: 'member', member_row_id: demo1.id });
    console.log('Seeded demo1');
  }

  // Demo member 2
  let demo2 = db.prepare("SELECT id FROM members WHERE national_id='DEMO-00002'").get();
  if (!demo2) {
    const r = createMember({
      full_name: 'Sam Patel',
      national_id: 'DEMO-00002',
      phone: '01000000002',
      email: 'sam.demo@seagym.local',
      dob: '1995-11-03',
      gender: 'Female',
      type: '6 Months',
      start_date: today(),
      ec_name: 'Priya Patel',
      ec_phone: '01000000022'
    });
    demo2 = { id: r.member.id };
  }
  const u2 = db.prepare("SELECT 1 FROM users WHERE username='demo2' COLLATE NOCASE").get();
  if (!u2) {
    await createUser({ username: 'demo2', password: 'Demo@12345', role: 'member', member_row_id: demo2.id });
    console.log('Seeded demo2');
  }
}

module.exports = {
  createMember, getMember, getMemberByMemberId, updateMember, removeMember,
  setActive, renew, setFrozen, listMembers, stats,
  createUser, authenticate, createSession, getSession, destroySession, destroyUserSessions,
  getUserById, getMemberForUser, seed, addMonths, MONTHS, PLAN_PRICES, hashPassword
};
