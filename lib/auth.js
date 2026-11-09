// Staff accounts and sign-in.
//   • Each person has their own username + password (stored as a scrypt hash).
//   • The very first sign-in: username "admin" + the STAFF_PASSWORD from your
//     environment variables creates the owner (admin) account.
//   • Sessions are a signed cookie; changing a password or role signs that person out everywhere.
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { sql, ensureSchema } from './db.js';
import { PERMS, ROLES } from './menu.js';

const COOKIE = 'dd_staff';
const MAX_AGE = 60 * 60 * 14; // 14 hours: one long shift

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new HttpError(500, 'SESSION_SECRET is not configured (32+ characters).');
  return s;
}
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return ['scrypt', salt.toString('base64url'), hash.toString('base64url')].join('$');
}
function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), 32);
  const want = Buffer.from(hash, 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
export function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 6) throw new HttpError(400, 'Passwords need at least 6 characters.');
  if (pw.length > 100) throw new HttpError(400, 'That password is too long.');
}

/** Admins always hold every permission; others hold what was ticked for them. */
export function permsOf(u) {
  if (u.role === 'admin') return Object.keys(PERMS);
  const list = Array.isArray(u.perms) ? u.perms : ROLES[u.role]?.perms || [];
  return list.filter((p) => p in PERMS);
}

export function setSession(res, user) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${user.id}.${user.session_ver}.${exp}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}
function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const parts = raw.slice(COOKIE.length + 1).split('.');
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!same(sig, sign(`${id}.${ver}.${exp}`))) return null;
  return { id, ver: Number(ver) };
}

/** The signed-in staff member (with their open shift, if any), or null. One database query. */
export async function getStaff(req) {
  const s = readSession(req);
  if (!s) return null;
  await ensureSchema();
  const [u] = await sql`
    SELECT u.*, sh.id AS shift_id, sh.opened_at AS shift_opened_at, sh.opening_cents AS shift_opening_cents
    FROM users u LEFT JOIN shifts sh ON sh.user_id = u.id AND sh.closed_at IS NULL
    WHERE u.id = ${s.id} AND u.active AND NOT u.deleted`;
  if (!u || u.session_ver !== s.ver) return null;
  u.permList = permsOf(u);
  u.can = (p) => u.permList.includes(p);
  return u;
}

/** Throws 401 when signed out, 403 when the permission is missing. */
export async function requireStaff(req, perm) {
  const u = await getStaff(req);
  if (!u) throw new HttpError(401, 'Please sign in.');
  if (perm && !u.can(perm)) throw new HttpError(403, `You don't have permission for this (${PERMS[perm] || perm}). Ask an admin.`);
  return u;
}

/** Money actions (POS, cash in/out, collecting payment) need an open shift. */
export function requireShift(u) {
  if (!u.shift_id) throw new HttpError(409, 'Open your shift first (Shift tab).');
  return u.shift_id;
}

export const publicUser = (u) => ({
  id: u.id, name: u.name, username: u.username, role: u.role, perms: permsOf(u),
  active: u.active, lastLogin: u.last_login, createdAt: u.created_at,
});

/** Sign in. On a fresh install, "admin" + STAFF_PASSWORD creates the owner account. */
export async function signIn(username, password) {
  await ensureSchema();
  const uname = String(username || '').trim().toLowerCase();
  if (!uname || typeof password !== 'string') throw new HttpError(400, 'Enter your username and password.');

  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM users WHERE NOT deleted`;
  if (n === 0) {
    const boot = process.env.STAFF_PASSWORD;
    if (!boot) throw new HttpError(500, 'No staff accounts yet and STAFF_PASSWORD is not set.');
    if (uname !== 'admin' || !same(password, boot)) {
      await new Promise((r) => setTimeout(r, 600));
      throw new HttpError(401, 'First sign-in: use username "admin" and the STAFF_PASSWORD from your settings.');
    }
    const [u] = await sql`INSERT INTO users (id, name, username, pass_hash, role, perms)
      VALUES (${crypto.randomUUID()}, 'Owner', 'admin', ${hashPassword(password)}, 'admin', ${JSON.stringify(ROLES.admin.perms)}::jsonb)
      RETURNING *`;
    return u;
  }

  const [u] = await sql`SELECT * FROM users WHERE lower(username) = ${uname} AND NOT deleted`;
  if (!u || !u.active || !verifyPassword(password, u.pass_hash)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    throw new HttpError(401, u && !u.active ? 'This account is switched off. Ask an admin.' : 'Wrong username or password.');
  }
  await sql`UPDATE users SET last_login = now() WHERE id = ${u.id}`;
  return u;
}
