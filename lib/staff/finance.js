import crypto from 'node:crypto';
import { body, HttpError, clean, centsOf } from '../http.js';
import { sql, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { EXPENSE_CATEGORIES } from '../menu.js';
import { dashboard as dashboardData, liquidation as liquidationData } from '../finance.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/staff/dashboard            sales performance, comparisons, records, achievements  (sales)
// GET /api/staff/dashboard?lite=1     just achievements (checked every minute for notifications)
export async function dashboard(req, res) {
  const u = await requireStaff(req, 'sales');
  const d = await dashboardData({ lite: !!req.query.lite });
  if (!u.can('finance') && !req.query.lite) {
    // Profit figures are for staff with the finance permission.
    for (const p of Object.values(d.periods)) { delete p.cogsCents; delete p.grossProfitCents; delete p.netProfitCents; delete p.cashProfitCents; delete p.operatingCents; delete p.purchasesCents; delete p.grossMarginPct; }
    for (const s of Object.values(d.series)) for (const x of s) { delete x.grossProfitCents; delete x.netProfitCents; }
    d.topProducts = d.topProducts.map(({ cogsCents, profitCents, marginPct, ...r }) => r);
    d.hideProfit = true;
  }
  res.status(200).json(d);
}

// GET /api/staff/liquidation?month=YYYY-MM     monthly costing & liquidation report   (finance)
export async function liquidation(req, res) {
  await requireStaff(req, 'finance');
  const month = String(req.query.month || '');
  if (!MONTH.test(month)) throw new HttpError(400, 'Choose a month.');
  res.status(200).json({ ...(await liquidationData(month)), categories: EXPENSE_CATEGORIES });
}

// /api/staff/expenses   (finance)
//   POST   {date: YYYY-MM-DD, category, description, cents, reference?}
//   DELETE {id}   (kept in the database as deleted, with who deleted it)
export async function expenses(req, res) {
  const u = await requireStaff(req, 'finance');
  const b = body(req);
  if (req.method === 'POST') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) throw new HttpError(400, 'Choose the date of the expense.');
    if (!EXPENSE_CATEGORIES[b.category]) throw new HttpError(400, 'Choose a category.');
    const cents = centsOf(b.cents, { min: 1, label: 'Amount' });
    const description = clean(b.description, 200);
    if (description.length < 2) throw new HttpError(400, 'Describe the expense (e.g. "Meralco bill October").');
    const [e] = await sql`INSERT INTO expenses (id, spent_on, category, description, cents, reference, user_id)
      VALUES (${crypto.randomUUID()}, ${b.date}::date, ${b.category}, ${description}, ${cents}, ${clean(b.reference, 60)}, ${u.id}) RETURNING id`;
    await audit(u, 'expense.add', EXPENSE_CATEGORIES[b.category].label, { cents, description, date: b.date });
    return res.status(201).json({ id: e.id });
  }
  if (req.method === 'DELETE') {
    const [e] = await sql`UPDATE expenses SET deleted = TRUE, deleted_by = ${u.id} WHERE id = ${String(b.id)} AND NOT deleted RETURNING *`;
    if (!e) throw new HttpError(404, 'Expense not found.');
    await audit(u, 'expense.delete', EXPENSE_CATEGORIES[e.category]?.label || e.category, { cents: e.cents, description: e.description, date: String(e.spent_on).slice(0, 10) });
    return res.status(200).json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}
