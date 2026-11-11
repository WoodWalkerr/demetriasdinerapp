import { HttpError, body } from '../http.js';
import { sql } from '../db.js';
import { requireStaff } from '../auth.js';
import { BTZ } from '../time.js';
import { summaryData, summaryHtml, sendSummary } from '../summary.js';

const PAGE = 50;

// GET /api/staff/activity?from&to&user&type&q&page    the activity log   (permission: audit)
//   type: price | order | cash | expense | stock | settings | users | login
export async function activity(req, res) {
  await requireStaff(req, 'audit');
  const q = req.query;
  const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);
  const from = date(q.from), to = date(q.to);
  const TYPES = {
    price: ['product.price', 'addon.price'], product: ['product.add', 'product.edit', 'product.delete', 'product.photo', 'addon.add', 'addon.edit', 'addon.delete'],
    order: ['order.cancel', 'order.void', 'order.refund', 'payment.confirm', 'payment.reject', 'pos.discount'],
    cash: ['cash.in', 'cash.out', 'shift.open', 'shift.close'], expense: ['expense.add', 'expense.delete'], stock: ['stock'],
    settings: ['settings.ordering', 'settings.qr', 'settings.delivery', 'settings.hours', 'settings.promos', 'settings.summary'],
    users: ['user.add', 'user.edit', 'user.delete', 'user.password'], login: ['login', 'login.failed'],
  };
  const actions = TYPES[q.type] || null;
  const user = q.user ? String(q.user) : null;
  const like = q.q ? `%${String(q.q).slice(0, 60)}%` : null;
  const page = Math.max(1, Math.min(500, parseInt(q.page, 10) || 1));
  const rows = await sql`
    SELECT a.*, COUNT(*) OVER()::int AS total_rows FROM audit_log a
    WHERE (${from}::date IS NULL OR a.at >= (${from}::date::timestamp AT TIME ZONE ${BTZ}))
      AND (${to}::date IS NULL OR a.at < ((${to}::date + 1)::timestamp AT TIME ZONE ${BTZ}))
      AND (${actions}::text[] IS NULL OR a.action = ANY(${actions}::text[]))
      AND (${user}::text IS NULL OR a.user_id = ${user})
      AND (${like}::text IS NULL OR a.target ILIKE ${like} OR a.user_name ILIKE ${like})
    ORDER BY a.id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`;
  const people = await sql`SELECT DISTINCT user_id, user_name FROM audit_log WHERE user_id IS NOT NULL ORDER BY user_name`;
  const total = rows[0]?.total_rows ?? 0;
  res.status(200).json({
    entries: rows.map((r) => ({ id: Number(r.id), at: r.at, userId: r.user_id, userName: r.user_name, action: r.action, target: r.target, detail: r.detail })),
    people: people.map((p) => ({ id: p.user_id, name: p.user_name })),
    types: Object.keys(TYPES), total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
  });
}

// GET  /api/staff/summary?date=YYYY-MM-DD   preview of the nightly email (finance)
// POST /api/staff/summary {date?}           send it now to the saved addresses (settings)
export async function summary(req, res) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : undefined;
  if (req.method === 'GET') {
    await requireStaff(req, 'finance');
    const data = await summaryData(d);
    if (req.query.format === 'html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).send(summaryHtml(data)); }
    return res.status(200).json(data);
  }
  await requireStaff(req, 'settings');
  const b = body(req);
  try {
    res.status(200).json(await sendSummary({ date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : d }));
  } catch (e) {
    throw new HttpError(e.status || 500, e.message);
  }
}
