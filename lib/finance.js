// Money overview: daily sales and cost of goods, expenses, monthly liquidation,
// sales records and achievements. Everything is aggregated in the database so it
// stays fast as the order history grows.
//
// Definitions (shown on screen too):
//   Net sales     = what customers paid (after discounts, incl. delivery fees), paid and not cancelled orders
//   COGS          = cost of goods sold: each item's cost × quantity (cost saved at the time of sale;
//                   older items use today's product cost), + "cost of goods adjustment" expenses
//   Gross profit  = net sales − COGS
//   Net profit    = gross profit − operating expenses (employee, utilities, rent, other, misc)
//   Purchases     = money spent buying ingredients / packaging / stock. Shown as money out, but not
//                   subtracted again from profit, because COGS already counts what was sold.
//   Cash profit   = net sales − everything spent (purchases + operating), a simple cash view.
import { sql, batch } from './db.js';
import { EXPENSE_CATEGORIES, CASH_OUT_TO_EXPENSE } from './menu.js';

// Days are business days (4 AM → 4 AM café time), so after-midnight sales count for the night before.
import { BTZ as TZ } from './time.js';
const range = (from, to) => [from, to]; // 'YYYY-MM-DD' strings, inclusive

/** Per-day sales, COGS and "sales without a known cost" (to show how complete the costing is). */
export const dailySalesQuery = (from, to) => sql`
  WITH s AS (
    SELECT o.id, o.total_cents, o.discount_cents, o.delivery_fee_cents, COALESCE(o.subtotal_cents, o.total_cents) AS sub,
           to_char(o.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS d
    FROM orders o
    WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
      AND (${from}::date IS NULL OR o.created_at >= (${from}::date::timestamp AT TIME ZONE ${TZ}))
      AND (${to}::date IS NULL OR o.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ}))),
  c AS (
    SELECT s.id,
      SUM((i->>'qty')::int * COALESCE((i->>'unitCostCents')::int, p.cost)) AS cogs,
      SUM(CASE WHEN COALESCE((i->>'unitCostCents')::int, p.cost) IS NULL THEN (i->>'qty')::int * (i->>'unitCents')::int ELSE 0 END) AS missing
    FROM s JOIN orders o ON o.id = s.id CROSS JOIN LATERAL jsonb_array_elements(o.items) i
    LEFT JOIN products p ON p.id = i->>'id'
    GROUP BY s.id)
  SELECT s.d, COUNT(*)::int AS orders, SUM(s.total_cents)::float8 AS sales, SUM(s.sub)::float8 AS items_sales,
         SUM(s.discount_cents)::float8 AS discounts, SUM(s.delivery_fee_cents)::float8 AS fees,
         COALESCE(SUM(c.cogs), 0)::float8 AS cogs, COALESCE(SUM(c.missing), 0)::float8 AS missing
  FROM s LEFT JOIN c ON c.id = s.id GROUP BY s.d ORDER BY s.d`;

/** Expenses per day and category: recorded expenses + shift cash-outs (paid from the drawer). */
export const dailyExpensesQuery = (from, to) => sql`
  SELECT to_char(spent_on, 'YYYY-MM-DD') AS d, category, 'recorded' AS src, SUM(cents)::float8 AS cents
  FROM expenses WHERE NOT deleted AND (${from}::date IS NULL OR spent_on >= ${from}::date) AND (${to}::date IS NULL OR spent_on <= ${to}::date)
  GROUP BY 1, 2
  UNION ALL
  SELECT to_char(created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS d, category, 'drawer' AS src, SUM(cents)::float8 AS cents
  FROM cash_moves WHERE kind = 'out'
    AND (${from}::date IS NULL OR created_at >= (${from}::date::timestamp AT TIME ZONE ${TZ}))
    AND (${to}::date IS NULL OR created_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ}))
  GROUP BY 1, 2`;

/** Per-product units, revenue and cost for a date range. */
export const productsQuery = (from, to) => sql`
  SELECT i->>'id' AS id, MAX(i->>'name') AS name, MAX(COALESCE(p.cat, i->>'cat')) AS cat,
         SUM((i->>'qty')::int)::int AS qty, SUM((i->>'qty')::int * (i->>'unitCents')::int)::float8 AS revenue,
         SUM((i->>'qty')::int * COALESCE((i->>'unitCostCents')::int, p.cost))::float8 AS cogs,
         BOOL_OR(COALESCE((i->>'unitCostCents')::int, p.cost) IS NULL) AS missing_cost,
         MAX(p.price) AS price_now, MAX(p.cost) AS cost_now
  FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.items) i LEFT JOIN products p ON p.id = i->>'id'
  WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
    AND o.created_at >= (${from}::date::timestamp AT TIME ZONE ${TZ})
    AND o.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ})
  GROUP BY i->>'id' ORDER BY revenue DESC`;

const todayQuery = () => sql`SELECT to_char(now() AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS today`;

// ---------------------------------------------------------------------------- date helpers ('YYYY-MM-DD')
const D = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const weekStart = (s) => { const d = D(s); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return fmt(d); }; // Monday
const monthKey = (s) => s.slice(0, 7);
const monthStart = (m) => `${m}-01`;
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return fmt(new Date(Date.UTC(y, mo, 0))); };
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return fmt(d).slice(0, 7); };

const groupOf = (cat) => EXPENSE_CATEGORIES[cat]?.group || 'operating';
const expenseCat = (row) => (row.src === 'drawer' ? CASH_OUT_TO_EXPENSE[row.category] || 'misc' : row.category);

/** Sums for one period from day rows. */
export function sumPeriod(days, expenses, from, to) {
  const t = { orders: 0, sales: 0, itemsSales: 0, discounts: 0, fees: 0, cogs: 0, missing: 0, opex: 0, purchases: 0, cogsAdj: 0 };
  for (const r of days) if (r.d >= from && r.d <= to) {
    t.orders += r.orders; t.sales += r.sales; t.itemsSales += r.items_sales; t.discounts += r.discounts; t.fees += r.fees; t.cogs += r.cogs; t.missing += r.missing;
  }
  for (const e of expenses) if (e.d >= from && e.d <= to) {
    const g = groupOf(expenseCat(e));
    if (g === 'operating') t.opex += e.cents; else if (g === 'purchase') t.purchases += e.cents; else t.cogsAdj += e.cents;
  }
  const cogs = t.cogs + t.cogsAdj;
  const gross = t.sales - cogs;
  return {
    from, to, orders: t.orders, netSalesCents: t.sales, grossSalesCents: t.itemsSales + t.fees, discountCents: t.discounts,
    cogsCents: cogs, grossProfitCents: gross, operatingCents: t.opex, purchasesCents: t.purchases,
    netProfitCents: gross - t.opex, cashProfitCents: t.sales - t.opex - t.purchases,
    grossMarginPct: t.sales ? Math.round((gross / t.sales) * 1000) / 10 : null,
    costCoveragePct: t.itemsSales ? Math.round(((t.itemsSales - t.missing) / t.itemsSales) * 1000) / 10 : 100,
  };
}
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

// ---------------------------------------------------------------------------- dashboard
/** Daily / weekly / monthly performance, comparisons, records and achievements. */
export async function dashboard({ lite = false } = {}) {
  const [[t], days, expenses] = await batch([todayQuery(), dailySalesQuery(null, null), dailyExpensesQuery(null, null)]);
  const today = t.today, yesterday = addDays(today, -1);
  const wk = weekStart(today), lastWk = addDays(wk, -7);
  const mo = monthKey(today), lastMo = addMonths(mo, -1);
  const dayOfMonth = Number(today.slice(8)), dow = (D(today).getUTCDay() + 6) % 7;
  const lastMoSamePoint = addDays(monthStart(lastMo), Math.min(dayOfMonth, Number(monthEnd(lastMo).slice(8))) - 1);

  // Records: totals per day / week / month (net sales).
  const byDay = new Map(days.map((r) => [r.d, r.sales]));
  const byWeek = new Map(), byMonth = new Map();
  for (const r of days) {
    byWeek.set(weekStart(r.d), (byWeek.get(weekStart(r.d)) || 0) + r.sales);
    byMonth.set(monthKey(r.d), (byMonth.get(monthKey(r.d)) || 0) + r.sales);
  }
  const best = (map, exclude) => { let k = null, v = 0; for (const [kk, vv] of map) if (kk !== exclude && vv > v) { k = kk; v = vv; } return k ? { key: k, cents: v } : null; };
  const records = {
    day: { best: best(byDay, today), current: { key: today, cents: byDay.get(today) || 0 } },
    week: { best: best(byWeek, wk), current: { key: wk, cents: byWeek.get(wk) || 0 } },
    month: { best: best(byMonth, mo), current: { key: mo, cents: byMonth.get(mo) || 0 } },
  };

  const periods = {
    today: sumPeriod(days, expenses, today, today),
    yesterday: sumPeriod(days, expenses, yesterday, yesterday),
    week: sumPeriod(days, expenses, wk, today),
    lastWeekSamePoint: sumPeriod(days, expenses, lastWk, addDays(lastWk, dow)),
    lastWeek: sumPeriod(days, expenses, lastWk, addDays(lastWk, 6)),
    month: sumPeriod(days, expenses, monthStart(mo), today),
    lastMonthSamePoint: sumPeriod(days, expenses, monthStart(lastMo), lastMoSamePoint),
    lastMonth: sumPeriod(days, expenses, monthStart(lastMo), monthEnd(lastMo)),
  };

  // Achievements (each has a stable id so the screen shows each one once).
  const ach = [];
  const r = records;
  if (r.day.current.cents > 0 && r.day.best && r.day.current.cents > r.day.best.cents)
    ach.push({ id: `day:${today}`, kind: 'record', title: 'New daily sales record!', text: `Congratulations! Today's sales of ₱${(r.day.current.cents / 100).toLocaleString('en-PH')} beat your best day (₱${(r.day.best.cents / 100).toLocaleString('en-PH')} on ${r.day.best.key}).` });
  if (r.week.current.cents > 0 && r.week.best && r.week.current.cents > r.week.best.cents)
    ach.push({ id: `week:${wk}`, kind: 'record', title: 'New weekly sales record!', text: `This week has already passed your best week (₱${(r.week.best.cents / 100).toLocaleString('en-PH')}).` });
  if (r.month.current.cents > 0 && r.month.best && r.month.current.cents > r.month.best.cents)
    ach.push({ id: `month:${mo}`, kind: 'record', title: 'New monthly sales record achieved!', text: `${mo} is now your best month ever, beating ₱${(r.month.best.cents / 100).toLocaleString('en-PH')}.` });
  const mGrowth = pct(periods.month.netSalesCents, periods.lastMonthSamePoint.netSalesCents);
  if (mGrowth != null && mGrowth >= 10)
    ach.push({ id: `growth-m:${mo}:${Math.floor(mGrowth / 10) * 10}`, kind: 'growth', title: `Sales up ${mGrowth}% vs last month`, text: `Your sales increased by ${mGrowth}% compared to the same point last month.` });
  const wGrowth = pct(periods.week.netSalesCents, periods.lastWeekSamePoint.netSalesCents);
  if (wGrowth != null && wGrowth >= 20)
    ach.push({ id: `growth-w:${wk}:${Math.floor(wGrowth / 10) * 10}`, kind: 'growth', title: `Sales up ${wGrowth}% vs last week`, text: `This week is ${wGrowth}% ahead of last week at the same point.` });
  const milestones = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];
  const mPesos = periods.month.netSalesCents / 100;
  const hit = milestones.filter((m) => mPesos >= m).pop();
  if (hit) ach.push({ id: `milestone:${mo}:${hit}`, kind: 'milestone', title: `₱${hit.toLocaleString('en-PH')} in sales this month`, text: `You've passed ₱${hit.toLocaleString('en-PH')} in sales for ${mo}. Keep it up!` });

  if (lite) return { today, achievements: ach, todaySalesCents: periods.today.netSalesCents };

  // Series for the charts.
  const dailySeries = [];
  for (let i = 29; i >= 0; i--) { const d = addDays(today, -i); dailySeries.push({ key: d, ...pick(sumPeriod(days, expenses, d, d)) }); }
  const weeklySeries = [];
  for (let i = 11; i >= 0; i--) { const s = addDays(wk, -7 * i); weeklySeries.push({ key: s, ...pick(sumPeriod(days, expenses, s, addDays(s, 6))) }); }
  const monthlySeries = [];
  for (let i = 11; i >= 0; i--) { const m = addMonths(mo, -i); monthlySeries.push({ key: m, ...pick(sumPeriod(days, expenses, monthStart(m), monthEnd(m))) }); }

  const [top] = await batch([productsQuery(monthStart(mo), today)]);
  return {
    today, periods, records, achievements: ach,
    comparisons: {
      dayVsYesterday: pct(periods.today.netSalesCents, periods.yesterday.netSalesCents),
      weekVsLastWeek: wGrowth, monthVsLastMonth: mGrowth,
    },
    series: { daily: dailySeries, weekly: weeklySeries, monthly: monthlySeries },
    topProducts: top.slice(0, 10).map(shapeProductRow),
  };
}
const pick = (p) => ({ orders: p.orders, salesCents: p.netSalesCents, grossProfitCents: p.grossProfitCents, netProfitCents: p.netProfitCents });

const shapeProductRow = (r) => ({
  id: r.id, name: r.name, cat: r.cat, qty: r.qty, revenueCents: r.revenue, cogsCents: r.missing_cost ? null : r.cogs,
  profitCents: r.missing_cost ? null : r.revenue - r.cogs, marginPct: r.missing_cost || !r.revenue ? null : Math.round(((r.revenue - r.cogs) / r.revenue) * 1000) / 10,
  missingCost: r.missing_cost,
});

// ---------------------------------------------------------------------------- liquidation
/** Monthly costing & liquidation report for 'YYYY-MM'. */
export async function liquidation(month) {
  const from = monthStart(month), to = monthEnd(month);
  const prev = addMonths(month, -1);
  const [days, expenses, prods, list, drawer, prevDays, prevExp] = await batch([
    dailySalesQuery(from, to), dailyExpensesQuery(from, to), productsQuery(from, to),
    sql`SELECT e.*, to_char(e.spent_on, 'YYYY-MM-DD') AS d, u.name AS user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id
        WHERE NOT e.deleted AND e.spent_on BETWEEN ${from}::date AND ${to}::date ORDER BY e.spent_on DESC, e.created_at DESC`,
    sql`SELECT m.*, to_char(m.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS d, u.name AS user_name FROM cash_moves m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.kind = 'out' AND m.created_at >= (${from}::date::timestamp AT TIME ZONE ${TZ}) AND m.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ})
        ORDER BY m.created_at DESC`,
    dailySalesQuery(monthStart(prev), monthEnd(prev)), dailyExpensesQuery(monthStart(prev), monthEnd(prev)),
  ]);
  const summary = sumPeriod(days, expenses, from, to);
  const prevSummary = sumPeriod(prevDays, prevExp, monthStart(prev), monthEnd(prev));

  const cats = Object.fromEntries(Object.entries(EXPENSE_CATEGORIES).map(([k, c]) => [k, { key: k, label: c.label, group: c.group, recordedCents: 0, drawerCents: 0 }]));
  for (const e of expenses) {
    const k = expenseCat(e);
    const c = cats[k] || cats.misc;
    if (e.src === 'drawer') c.drawerCents += e.cents; else c.recordedCents += e.cents;
  }
  const breakdown = Object.values(cats).map((c) => ({ ...c, totalCents: c.recordedCents + c.drawerCents }));
  const autoCogs = days.reduce((a, r) => a + r.cogs, 0);

  return {
    month, from, to, summary, previous: { month: prev, ...prevSummary },
    changes: { netSales: pct(summary.netSalesCents, prevSummary.netSalesCents), netProfit: pct(summary.netProfitCents, prevSummary.netProfitCents) },
    cogs: { autoCents: autoCogs, adjustmentCents: cats.cogs_adj.recordedCents + cats.cogs_adj.drawerCents },
    breakdown,
    daily: days.map((r) => ({ date: r.d, orders: r.orders, salesCents: r.sales, cogsCents: r.cogs })),
    products: prods.map(shapeProductRow),
    expenses: [
      ...list.map((e) => ({ id: e.id, date: e.d, category: e.category, label: EXPENSE_CATEGORIES[e.category]?.label || e.category, description: e.description, reference: e.reference, cents: e.cents, staffName: e.user_name, source: 'recorded' })),
      ...drawer.map((m) => ({ id: m.id, date: m.d, category: CASH_OUT_TO_EXPENSE[m.category] || 'misc', label: `Cash out · ${m.category}`, description: m.note, reference: '', cents: m.cents, staffName: m.user_name, source: 'drawer' })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}
export { range, monthEnd, monthStart };
