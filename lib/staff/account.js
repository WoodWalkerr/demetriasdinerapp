import crypto from 'node:crypto';
import { body, HttpError, clean, BUILD } from '../http.js';
import { sql, batch, versionQuery, audit } from '../db.js';
import { PERMS, ROLES } from '../menu.js';
import { signIn, setSession, clearSession, getStaff, requireStaff, publicUser, hashPassword, checkNewPassword, permsOf } from '../auth.js';

export const meView = (u, v) => ({
  signedIn: true, v, build: BUILD,
  user: { ...publicUser(u), perms: u.permList, theme: u.theme || 'auto' },
  shift: u.shift_id ? { id: u.shift_id, openedAt: u.shift_opened_at, openingCents: u.shift_opening_cents } : null,
  roles: Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, { label: r.label, perms: r.perms }])),
  permLabels: PERMS,
});

// POST /api/staff/login {username, password} · GET → who is signed in
export async function login(req, res) {
  if (req.method === 'GET') {
    const u = await getStaff(req);
    if (!u) return res.status(200).json({ signedIn: false, build: BUILD });
    const [v] = await versionQuery();
    return res.status(200).json(meView(u, v?.value));
  }
  const { username, password } = body(req);
  let u;
  try { u = await signIn(username, password); } catch (e) {
    await audit(null, 'login.failed', clean(username, 40)).catch(() => {});
    throw e;
  }
  setSession(res, u);
  await audit(u, 'login', u.username);
  res.status(200).json(await viewFor(u.id));
}
async function viewFor(id) {
  const [u] = await sql`SELECT u.*, sh.id AS shift_id, sh.opened_at AS shift_opened_at, sh.opening_cents AS shift_opening_cents
    FROM users u LEFT JOIN shifts sh ON sh.user_id = u.id AND sh.closed_at IS NULL WHERE u.id = ${id}`;
  u.permList = permsOf(u);
  const [v] = await versionQuery();
  return meView(u, v?.value);
}

// POST /api/staff/logout
export async function logout(_req, res) {
  clearSession(res);
  res.status(200).json({ signedIn: false });
}

// PUT /api/staff/me {theme: 'light'|'dark'|'auto'}: your saved theme
// PUT /api/staff/me {currentPassword, newPassword}: change your own password
export async function me(req, res) {
  const u = await requireStaff(req);
  const b = body(req);
  if (b.theme !== undefined) {
    if (!['light', 'dark', 'auto'].includes(b.theme)) throw new HttpError(400, 'Unknown theme.');
    await sql`UPDATE users SET theme = ${b.theme} WHERE id = ${u.id}`;
    return res.status(200).json({ ok: true, theme: b.theme });
  }
  const { currentPassword, newPassword } = b;
  await signIn(u.username, currentPassword); // throws if the current password is wrong
  checkNewPassword(newPassword);
  const [x] = await sql`UPDATE users SET pass_hash = ${hashPassword(newPassword)}, session_ver = session_ver + 1 WHERE id = ${u.id} RETURNING *`;
  await audit(u, 'user.password', u.username);
  setSession(res, x);
  res.status(200).json({ ok: true });
}

// /api/staff/users  (permission: users)
//   GET                                     list
//   POST {name, username, password, role, perms[]}
//   PUT  {id, name?, username?, role?, perms?, active?, password?}
//   DELETE {id}
export async function users(req, res) {
  const me = await requireStaff(req, 'users');
  const cleanPerms = (role, perms) => (role === 'admin' ? ROLES.admin.perms : (Array.isArray(perms) ? perms : ROLES[role]?.perms || []).filter((p) => p in PERMS));
  const checkRole = (r) => { if (!ROLES[r]) throw new HttpError(400, 'Choose a role.'); return r; };
  const checkUsername = (s) => {
    const n = String(s || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(n)) throw new HttpError(400, 'Usernames are 3–30 letters, numbers, dots or dashes (no spaces).');
    return n;
  };
  const taken = async (uname, exceptId = '') => {
    const [x] = await sql`SELECT id FROM users WHERE lower(username) = ${uname} AND NOT deleted AND id <> ${exceptId}`;
    if (x) throw new HttpError(409, 'That username is already used.');
  };
  const activeAdmins = async (exceptId) => {
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active AND NOT deleted AND id <> ${exceptId}`;
    return n;
  };

  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM users WHERE NOT deleted ORDER BY role = 'admin' DESC, name`;
    return res.status(200).json({ users: rows.map(publicUser), roles: ROLES, permLabels: PERMS });
  }
  const b = body(req);
  if (req.method === 'POST') {
    const name = clean(b.name, 60);
    if (!name) throw new HttpError(400, "Enter the staff member's name.");
    const uname = checkUsername(b.username);
    await taken(uname);
    checkNewPassword(b.password);
    const role = checkRole(b.role || 'cashier');
    const [u] = await sql`INSERT INTO users (id, name, username, pass_hash, role, perms)
      VALUES (${crypto.randomUUID()}, ${name}, ${uname}, ${hashPassword(b.password)}, ${role}, ${JSON.stringify(cleanPerms(role, b.perms))}::jsonb)
      RETURNING *`;
    await audit(me, 'user.add', `${u.name} (${u.username})`, { role });
    return res.status(201).json(publicUser(u));
  }
  const [cur] = await sql`SELECT * FROM users WHERE id = ${String(b.id)} AND NOT deleted`;
  if (!cur) throw new HttpError(404, 'Staff account not found.');

  if (req.method === 'DELETE') {
    if (cur.id === me.id) throw new HttpError(400, "You can't delete your own account.");
    if (cur.role === 'admin' && (await activeAdmins(cur.id)) === 0) throw new HttpError(400, 'Keep at least one admin.');
    await batch([
      sql`UPDATE users SET deleted = TRUE, active = FALSE, session_ver = session_ver + 1, username = username || '#deleted-' || substr(id, 1, 8) WHERE id = ${cur.id}`,
      audit(me, 'user.delete', `${cur.name} (${cur.username})`),
    ]);
    return res.status(200).json({ ok: true });
  }

  // PUT
  const name = b.name !== undefined ? clean(b.name, 60) || cur.name : cur.name;
  const uname = b.username !== undefined ? checkUsername(b.username) : cur.username;
  if (uname !== cur.username) await taken(uname, cur.id);
  const role = b.role !== undefined ? checkRole(b.role) : cur.role;
  const perms = b.perms !== undefined || b.role !== undefined ? cleanPerms(role, b.perms ?? cur.perms) : cur.perms;
  const active = typeof b.active === 'boolean' ? b.active : cur.active;
  if (cur.id === me.id && (role !== 'admin' || !active)) throw new HttpError(400, "You can't remove your own admin access or switch yourself off.");
  if (cur.role === 'admin' && (role !== 'admin' || !active) && (await activeAdmins(cur.id)) === 0) throw new HttpError(400, 'Keep at least one admin.');
  let passHash = cur.pass_hash;
  if (b.password) { checkNewPassword(b.password); passHash = hashPassword(b.password); }
  const signOut = passHash !== cur.pass_hash || role !== cur.role || !active || JSON.stringify(perms) !== JSON.stringify(cur.perms);
  const [u] = await sql`UPDATE users SET name = ${name}, username = ${uname}, role = ${role}, perms = ${JSON.stringify(perms)}::jsonb,
      active = ${active}, pass_hash = ${passHash}, session_ver = session_ver + ${signOut && cur.id !== me.id ? 1 : 0}
    WHERE id = ${cur.id} RETURNING *`;
  const changes = {};
  if (name !== cur.name) changes.name = [cur.name, name];
  if (uname !== cur.username) changes.username = [cur.username, uname];
  if (role !== cur.role) changes.role = [cur.role, role];
  if (active !== cur.active) changes.active = [cur.active, active];
  if (JSON.stringify(perms) !== JSON.stringify(cur.perms)) changes.perms = [cur.perms, perms];
  if (passHash !== cur.pass_hash) changes.password = 'reset';
  if (Object.keys(changes).length) await audit(me, 'user.edit', `${cur.name} (${cur.username})`, changes);
  res.status(200).json(publicUser(u));
}
