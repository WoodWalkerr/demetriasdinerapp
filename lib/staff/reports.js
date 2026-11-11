import { HttpError } from '../http.js';
import { sql, batch, staffOrder, paymentsOf } from '../db.js';
import { requireStaff } from '../auth.js';
import { salesTotals } from '../shifts.js';
import { liquidation as liquidationData } from '../finance.js';

import { BTZ, TZ as CAFE_TZ, businessDate } from '../time.js';
const TZ = BTZ; // business days (4 AM → 4 AM café time) for every date range and daily total
const PAGE = 50;
const METHOD = { cash: 'Cash', gcash: 'GCash', paymaya: 'Maya', card: 'Card', qrph: 'GCash/Maya QR', counter: 'Pay at counter', split: 'Split' };
const isSale = (o) => o.status !== 'cancelled' && o.payment_status === 'paid';

// GET /api/staff/history?q=&status=&payment=&source=&type=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1
export async function history(req, res) {
  await requireStaff(req, 'pos');
  const q = String(req.query.q || '').trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%` : null;
  const statusList = { open: ['new', 'making', 'ready', 'delivering'], done: ['done'], cancelled: ['cancelled'] }[req.query.status] || null;
  const payment = String(req.query.payment || 'any');
  const payStatusList = ['paid', 'pending', 'unpaid', 'refunded', 'expired', 'failed', 'voided', 'awaiting_proof', 'submitted', 'rejected'].includes(payment) ? [payment] : null;
  const methodFilter = ['gcash', 'paymaya', 'card', 'counter', 'cash', 'qrph', 'split'].includes(payment) ? payment : null;
  const source = ['online', 'pos'].includes(req.query.source) ? req.query.source : null;
  const otype = ['pickup', 'delivery', 'dine-in', 'takeout'].includes(req.query.type) ? req.query.type : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
  const page = Math.max(1, Math.min(1000, parseInt(req.query.page, 10) || 1));

  const rows = await sql`
    SELECT o.*, u.name AS user_name, COUNT(*) OVER()::int AS total_rows FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE (${like}::text IS NULL OR o.code ILIKE ${like} OR o.name ILIKE ${like} OR o.reference ILIKE ${like})
      AND (${statusList}::text[] IS NULL OR o.status = ANY(${statusList}::text[]))
      AND (${payStatusList}::text[] IS NULL OR o.payment_status = ANY(${payStatusList}::text[]))
      AND (${methodFilter}::text IS NULL OR o.payment_method = ${methodFilter} OR o.payments @> jsonb_build_array(jsonb_build_object('method', ${methodFilter}::text)))
      AND (${source}::text IS NULL OR o.source = ${source})
      AND (${otype}::text IS NULL OR o.order_type = ${otype})
      AND (${from}::date IS NULL OR o.created_at >= (${from}::date::timestamp AT TIME ZONE ${TZ}))
      AND (${to}::date IS NULL OR o.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ}))
    ORDER BY o.created_at DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`;
  const total = rows[0]?.total_rows ?? 0;
  res.status(200).json({ orders: rows.map(staffOrder), total, page, pages: Math.max(1, Math.ceil(total / PAGE)) });
}

// GET /api/staff/report?range=today|7d|30d   (permission: sales)
export async function report(req, res) {
  await requireStaff(req, 'sales');
  const range = ['today', '7d', '30d'].includes(req.query.range) ? req.query.range : '7d';
  const days = { today: 1, '7d': 7, '30d': 30 }[range];
  const bucket = range === 'today' ? 'hour' : 'day';
  const [base, [nowLocal], cash] = await batch([
    sql`SELECT o.*, (o.created_at AT TIME ZONE ${TZ}) AS local_at, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.created_at >= ((date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${days - 1})) AT TIME ZONE ${TZ})`,
    sql`SELECT (now() AT TIME ZONE ${TZ}) AS t`,
    sql`SELECT kind, COALESCE(SUM(cents),0)::int AS cents FROM cash_moves
        WHERE created_at >= ((date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${days - 1})) AT TIME ZONE ${TZ}) GROUP BY kind`,
  ]);

  const fmtKey = (d) => (bucket === 'hour' ? String(new Date(d).getUTCHours()) : new Date(d).toISOString().slice(0, 10));
  const series = new Map();
  const end = new Date(nowLocal.t);
  if (bucket === 'hour') for (let h = 6; h <= 22; h++) series.set(String(h), { key: String(h), orders: 0, salesCents: 0 });
  else for (let i = days - 1; i >= 0; i--) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - i); const k = d.toISOString().slice(0, 10); series.set(k, { key: k, orders: 0, salesCents: 0 }); }

  const items = {}, staff = {}, sources = { online: { source: 'online', orders: 0, salesCents: 0 }, pos: { source: 'pos', orders: 0, salesCents: 0 } };
  for (const o of base.filter(isSale)) {
    const k = fmtKey(o.local_at);
    if (!series.has(k)) series.set(k, { key: k, orders: 0, salesCents: 0 });
    const s = series.get(k); s.orders++; s.salesCents += o.total_cents;
    const src = sources[o.source === 'pos' ? 'pos' : 'online']; src.orders++; src.salesCents += o.total_cents;
    const who = o.user_name || (o.source === 'pos' ? 'Former staff' : 'Online (auto)');
    const st = (staff[who] ||= { name: who, orders: 0, salesCents: 0 }); st.orders++; st.salesCents += o.total_cents;
    for (const i of o.items) {
      const it = (items[i.id] ||= { id: i.id, name: i.name, qty: 0, salesCents: 0 });
      it.qty += i.qty; it.salesCents += i.qty * i.unitCents;
      for (const a of i.addons || []) {
        const ak = 'addon:' + a.id;
        const ad = (items[ak] ||= { id: ak, name: `+ ${a.name}`, qty: 0, salesCents: 0, addon: true });
        ad.qty += i.qty; ad.salesCents += i.qty * a.cents;
      }
    }
  }
  const t = salesTotals(base);
  res.status(200).json({
    range, bucket,
    totals: { grossCents: t.grossCents, discountCents: t.discountCents, deliveryCents: t.deliveryCents, salesCents: t.netCents,
      orders: t.orders, items: t.items, avgCents: t.orders ? Math.round(t.netCents / t.orders) : 0 },
    voids: t.voids,
    cashIn: cash.find((c) => c.kind === 'in')?.cents || 0, cashOut: cash.find((c) => c.kind === 'out')?.cents || 0,
    series: [...series.values()].sort((a, b) => (bucket === 'hour' ? a.key - b.key : a.key.localeCompare(b.key))),
    bySource: Object.values(sources),
    byMethod: Object.entries(t.byMethod).filter(([, c]) => c > 0).map(([method, cents]) => ({ method, salesCents: cents })).sort((a, b) => b.salesCents - a.salesCents),
    byStaff: Object.values(staff).sort((a, b) => b.salesCents - a.salesCents),
    topItems: Object.values(items).filter((i) => !i.addon).sort((a, b) => b.qty - a.qty).slice(0, 10),
    topAddons: Object.values(items).filter((i) => i.addon).sort((a, b) => b.qty - a.qty).slice(0, 8),
  });
}

// ---------------------------------------------------------------------------
// GET /api/staff/export?month=YYYY-MM&type=daily|orders|items|shifts|cash|stock   (permission: sales)
// ---------------------------------------------------------------------------
const peso = (c) => (c == null ? '' : (c / 100).toFixed(2));
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // stop spreadsheet formula injection (plain numbers like -2.60 are fine)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; // BOM: Excel shows ₱ and accents
// Dates in exports are business dates; times are the real café clock time.
const local = (d, fmt) => (fmt === 'date' ? businessDate(d) : new Intl.DateTimeFormat('en-CA', { timeZone: CAFE_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)));
const itemText = (i) => `${i.qty}x ${i.name}${i.opts ? ` (${i.opts})` : ''}${(i.addons || []).map((a) => ` + ${a.name}`).join('')}`;

export async function exportCsv(req, res) {
  const me = await requireStaff(req, 'sales');
  const month = String(req.query.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Choose a month (YYYY-MM).');
  const type = ['daily', 'orders', 'items', 'shifts', 'cash', 'stock', 'liquidation', 'expenses', 'profit'].includes(req.query.type) ? req.query.type : 'daily';
  if (['liquidation', 'expenses', 'profit'].includes(type)) {
    if (!me.can('finance')) throw new HttpError(403, 'Finance exports need the finance permission.');
    const L = await liquidationData(month);
    let rows;
    if (type === 'liquidation') {
      const s = L.summary;
      rows = [['Monthly liquidation', month], [],
        ['SALES', ''], ['Gross sales (items + delivery fees)', peso(s.grossSalesCents)], ['Discounts', peso(-s.discountCents)], ['Net sales', peso(s.netSalesCents)], ['Orders', s.orders], [],
        ['COST OF GOODS SOLD', ''], ['From product costs', peso(L.cogs.autoCents)], ['Adjustments (spoilage, waste)', peso(L.cogs.adjustmentCents)], ['Total COGS', peso(s.cogsCents)],
        ['Cost data coverage', `${s.costCoveragePct}% of item sales have a cost`], [], ['GROSS PROFIT', peso(s.grossProfitCents)], ['Gross margin', s.grossMarginPct == null ? '' : s.grossMarginPct + '%'], [],
        ['OPERATING EXPENSES', 'Recorded', 'From drawer (cash out)', 'Total'],
        ...L.breakdown.filter((c) => c.group === 'operating').map((c) => [c.label, peso(c.recordedCents), peso(c.drawerCents), peso(c.totalCents)]),
        ['Total operating expenses', '', '', peso(s.operatingCents)], [], ['NET PROFIT', peso(s.netProfitCents)], [],
        ['PURCHASES (money spent on stock, not deducted again)', 'Recorded', 'From drawer (cash out)', 'Total'],
        ...L.breakdown.filter((c) => c.group === 'purchase').map((c) => [c.label, peso(c.recordedCents), peso(c.drawerCents), peso(c.totalCents)]),
        ['Total purchases', '', '', peso(s.purchasesCents)], [], ['CASH VIEW: net sales − all money spent', peso(s.cashProfitCents)], [],
        ['Previous month', L.previous.month], ['Net sales', peso(L.previous.netSalesCents)], ['Net profit', peso(L.previous.netProfitCents)]];
    } else if (type === 'expenses') {
      rows = [['Date', 'Category', 'Description', 'Reference', 'Amount (PHP)', 'Source', 'Staff']];
      for (const e of L.expenses) rows.push([e.date, e.label, e.description, e.reference, peso(e.cents), e.source === 'drawer' ? 'Shift cash out' : 'Recorded', e.staffName || '']);
    } else {
      rows = [['Product', 'Category', 'Qty sold', 'Revenue (PHP)', 'Cost of goods (PHP)', 'Profit (PHP)', 'Margin %', 'Note']];
      for (const p of L.products) rows.push([p.name, p.cat, p.qty, peso(p.revenueCents), p.cogsCents == null ? '' : peso(p.cogsCents), p.profitCents == null ? '' : peso(p.profitCents), p.marginPct ?? '', p.missingCost ? 'Cost not set for some sales' : '']);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="demetrias-${type}-${month}.csv"`);
    return res.status(200).end(csv(rows));
  }
  const start = `${month}-01`;
  const [orders, shifts, moves, stockLog] = await batch([
    sql`SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.created_at >= (${start}::date::timestamp AT TIME ZONE ${TZ})
          AND o.created_at < ((${start}::date + interval '1 month')::timestamp AT TIME ZONE ${TZ}) ORDER BY o.created_at`,
    sql`SELECT s.*, u.name AS user_name, c.name AS closed_by_name FROM shifts s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users c ON c.id = s.closed_by
        WHERE s.opened_at >= (${start}::date::timestamp AT TIME ZONE ${TZ})
          AND s.opened_at < ((${start}::date + interval '1 month')::timestamp AT TIME ZONE ${TZ}) ORDER BY s.opened_at`,
    sql`SELECT m.*, u.name AS user_name FROM cash_moves m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.created_at >= (${start}::date::timestamp AT TIME ZONE ${TZ})
          AND m.created_at < ((${start}::date + interval '1 month')::timestamp AT TIME ZONE ${TZ}) ORDER BY m.created_at`,
    sql`SELECT l.*, p.name AS product_name, u.name AS user_name FROM stock_log l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN users u ON u.id = l.user_id
        WHERE l.created_at >= (${start}::date::timestamp AT TIME ZONE ${TZ})
          AND l.created_at < ((${start}::date + interval '1 month')::timestamp AT TIME ZONE ${TZ}) ORDER BY l.created_at`,
  ]);

  let out;
  if (type === 'orders') {
    out = [['Date', 'Time', 'Order', 'Source', 'Type', 'Customer', 'Staff', 'Items', 'Subtotal (PHP)', 'Discount', 'Discount (PHP)', 'Delivery fee (PHP)', 'Total (PHP)',
      'Payment', 'Payment parts', 'Payment status', 'Order status', 'Counted as sale', 'Cash received (PHP)', 'Change (PHP)', 'Reference no.', 'Delivery address', 'Delivery km', 'PayMongo payment ID', 'Refund ID', 'Note']];
    for (const o of orders) out.push([
      local(o.created_at, 'date'), local(o.created_at), o.code, o.source === 'pos' ? 'POS' : 'Online', o.order_type, o.name, o.user_name || '',
      o.items.map(itemText).join('; '), peso(o.subtotal_cents ?? o.total_cents), o.discount_type || '', peso(o.discount_cents || 0),
      peso(o.delivery_fee_cents || 0), peso(o.total_cents), METHOD[o.payment_method] || o.payment_method,
      paymentsOf(o).map((p) => `${METHOD[p.method] || p.method} ${peso(p.cents)}`).join(' + '), o.payment_status, o.status, isSale(o) ? 'Yes' : 'No',
      peso(o.tendered_cents), peso(o.change_cents), o.reference || '', o.delivery?.address || '', o.delivery?.km ?? '', o.payment_id || '', o.refund_id || '', o.note || '',
    ]);
  } else if (type === 'items') {
    out = [['Date', 'Time', 'Order', 'Source', 'Staff', 'Item', 'Options', 'Add-ons', 'Qty', 'Unit price incl. add-ons (PHP)', 'Line total (PHP)']];
    for (const o of orders.filter(isSale)) for (const i of o.items) out.push([
      local(o.created_at, 'date'), local(o.created_at), o.code, o.source === 'pos' ? 'POS' : 'Online', o.user_name || '', i.name, i.opts || '',
      (i.addons || []).map((a) => `${a.name} (+${peso(a.cents)})`).join('; '), i.qty, peso(i.unitCents), peso(i.unitCents * i.qty),
    ]);
  } else if (type === 'shifts') {
    out = [['Staff', 'Opened', 'Closed', 'Closed by', 'Opening cash', 'Orders', 'Gross', 'Discounts', 'Delivery fees', 'Net sales', 'Cash', 'GCash', 'Maya', 'Card', 'GCash/Maya QR',
      'Cash in', 'Cash out', 'Expected cash', 'Counted cash', 'Over / short', 'Voided (PHP)', 'Note']];
    for (const s of shifts) {
      const sm = s.summary;
      const st = sm?.sales;
      out.push([
        s.user_name || 'Former staff', `${local(s.opened_at, 'date')} ${local(s.opened_at)}`, s.closed_at ? `${local(s.closed_at, 'date')} ${local(s.closed_at)}` : 'OPEN',
        s.closed_by_name || '', peso(s.opening_cents), st?.orders ?? '', peso(st?.grossCents), peso(st?.discountCents), peso(st?.deliveryCents), peso(st?.netCents),
        peso(st?.byMethod?.cash), peso(st?.byMethod?.gcash), peso(st?.byMethod?.paymaya), peso(st?.byMethod?.card), peso(st?.byMethod?.qrph),
        peso(sm?.cashInCents), peso(sm?.cashOutCents), peso(s.expected_cents), peso(s.counted_cents),
        s.counted_cents == null ? '' : peso(s.counted_cents - s.expected_cents), peso(st?.voids?.cents), s.note || '',
      ]);
    }
  } else if (type === 'cash') {
    out = [['Date', 'Time', 'Staff', 'Type', 'Category', 'Amount (PHP)', 'Note']];
    for (const m of moves) out.push([local(m.created_at, 'date'), local(m.created_at), m.user_name || '', m.kind === 'in' ? 'Cash in' : 'Cash out', m.category, peso(m.cents), m.note]);
  } else if (type === 'stock') {
    out = [['Date', 'Time', 'Product', 'Change', 'Stock after', 'Reason', 'Staff']];
    for (const l of stockLog) out.push([local(l.created_at, 'date'), local(l.created_at), l.product_name || l.product_id, l.delta, l.stock_after ?? 'not tracked', l.reason, l.user_name || '']);
  } else {
    const methods = ['cash', 'gcash', 'paymaya', 'card', 'qrph'];
    const [y, m] = month.split('-').map(Number);
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const blank = () => ({ orders: 0, gross: 0, disc: 0, fees: 0, net: 0, online: 0, pos: 0, voids: 0, cin: 0, cout: 0, ...Object.fromEntries(methods.map((k) => [k, 0])) });
    const days = new Map();
    for (let d = 1; d <= nDays; d++) days.set(`${month}-${String(d).padStart(2, '0')}`, blank());
    for (const o of orders) {
      const r = days.get(local(o.created_at, 'date')); if (!r) continue;
      if (o.status === 'cancelled' && ['voided', 'refunded'].includes(o.payment_status)) r.voids += o.total_cents;
      if (!isSale(o)) continue;
      r.orders++; r.gross += (o.subtotal_cents ?? o.total_cents) + (o.delivery_fee_cents || 0); r.disc += o.discount_cents || 0;
      r.fees += o.delivery_fee_cents || 0; r.net += o.total_cents; r[o.source === 'pos' ? 'pos' : 'online'] += o.total_cents;
      for (const p of paymentsOf(o)) r[p.method] = (r[p.method] || 0) + p.cents;
    }
    for (const mv of moves) { const r = days.get(local(mv.created_at, 'date')); if (r) r[mv.kind === 'in' ? 'cin' : 'cout'] += mv.cents; }
    out = [['Date', 'Orders', 'Gross (PHP)', 'Discounts (PHP)', 'Delivery fees (PHP)', 'Net sales (PHP)', 'Cash', 'GCash', 'Maya', 'Card', 'GCash/Maya QR', 'Online orders', 'POS', 'Voided/refunded (PHP)', 'Cash in', 'Cash out']];
    const tot = blank();
    for (const [d, r] of days) {
      out.push([d, r.orders, peso(r.gross), peso(r.disc), peso(r.fees), peso(r.net), ...methods.map((k) => peso(r[k])), peso(r.online), peso(r.pos), peso(r.voids), peso(r.cin), peso(r.cout)]);
      for (const k of Object.keys(tot)) tot[k] += r[k];
    }
    out.push(['TOTAL', tot.orders, peso(tot.gross), peso(tot.disc), peso(tot.fees), peso(tot.net), ...methods.map((k) => peso(tot[k])), peso(tot.online), peso(tot.pos), peso(tot.voids), peso(tot.cin), peso(tot.cout)]);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="demetrias-${type}-${month}.csv"`);
  res.status(200).end(csv(out));
}
