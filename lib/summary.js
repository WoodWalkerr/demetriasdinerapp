// Owner's nightly summary: the business day's sales, profit, best sellers, low stock and
// anything worth checking (voids, cash over/short), sent by email through Resend (resend.com).
//
// Env: RESEND_API_KEY (required to send), SUMMARY_FROM (optional sender, e.g. "Demetria's Diner <reports@yourdomain.com>").
// Without your own domain, Resend's test sender can only email the address you signed up to Resend with.
import { sql, batch, getSettings } from './db.js';
import { dailySalesQuery, dailyExpensesQuery, productsQuery, sumPeriod } from './finance.js';
import { BTZ, businessDate, addDays, windowOn, TZ } from './time.js';

const RESEND_URL = process.env.RESEND_URL || 'https://api.resend.com/emails';
export const emailConfigured = () => !!process.env.RESEND_API_KEY;

const peso = (c) => (c < 0 ? '−' : '') + '₱' + (Math.abs(c || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: Math.abs(c || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nice = (date) => new Date(date + 'T00:00:00Z').toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const change = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

/** The numbers for one business day (default: the day that just ended). */
export async function summaryData(date = addDays(businessDate(), -1)) {
  const lastWeek = addDays(date, -7);
  const [days, expenses, products, low, voids, shifts, scheduled, best] = await batch([
    dailySalesQuery(lastWeek, date),
    dailyExpensesQuery(lastWeek, date),
    productsQuery(date, date),
    sql`SELECT name, stock, low_stock FROM products WHERE NOT deleted AND stock IS NOT NULL AND stock <= low_stock ORDER BY stock, name LIMIT 20`,
    sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_cents),0)::int AS cents FROM orders
        WHERE status = 'cancelled' AND payment_status IN ('voided','refunded')
          AND to_char(updated_at AT TIME ZONE ${BTZ}, 'YYYY-MM-DD') = ${date}`,
    sql`SELECT s.counted_cents, s.expected_cents, u.name FROM shifts s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.closed_at IS NOT NULL AND to_char(s.closed_at AT TIME ZONE ${BTZ}, 'YYYY-MM-DD') = ${date}`,
    sql`SELECT COUNT(*)::int AS n FROM orders WHERE scheduled_for IS NOT NULL AND status NOT IN ('cancelled','done')
          AND to_char(scheduled_for AT TIME ZONE ${BTZ}, 'YYYY-MM-DD') = ${addDays(date, 1)}`,
    sql`SELECT d, s FROM (SELECT to_char(created_at AT TIME ZONE ${BTZ}, 'YYYY-MM-DD') AS d, SUM(total_cents)::float8 AS s
          FROM orders WHERE status <> 'cancelled' AND payment_status = 'paid' GROUP BY 1) x WHERE d < ${date} ORDER BY s DESC LIMIT 1`,
  ]);
  const day = sumPeriod(days, expenses, date, date);
  const sameDayLastWeek = sumPeriod(days, expenses, lastWeek, lastWeek);
  const settings = await getSettings();
  const w = windowOn(settings.hours, date);
  return {
    date, label: nice(date), day, lastWeek: sameDayLastWeek, vsLastWeekPct: change(day.netSalesCents, sameDayLastWeek.netSalesCents),
    record: best[0] && day.netSalesCents > best[0].s ? { previousCents: best[0].s, previousDate: best[0].d } : null,
    top: products.slice().sort((a, b) => b.qty - a.qty).slice(0, 5).map((p) => ({ name: p.name, qty: p.qty, revenueCents: p.revenue, profitCents: p.missing_cost ? null : p.revenue - p.cogs })),
    lowStock: low.map((p) => ({ name: p.name, stock: p.stock })),
    voids: voids[0],
    shifts: shifts.map((s) => ({ name: s.name || 'Former staff', overShortCents: s.counted_cents - s.expected_cents })),
    scheduledTomorrow: scheduled[0].n,
    closed: !w || w.closed,
  };
}

export function summaryHtml(d, cafe = "Demetria's Diner") {
  const k = d.day;
  const row = (a, b, strong) => `<tr><td style="padding:6px 0;color:#555">${a}</td><td style="padding:6px 0;text-align:right;${strong ? 'font-weight:700' : ''}">${b}</td></tr>`;
  const vs = d.vsLastWeekPct == null ? '' : `<span style="color:${d.vsLastWeekPct >= 0 ? '#1d7a3a' : '#b3261e'}">${d.vsLastWeekPct >= 0 ? '▲' : '▼'} ${Math.abs(d.vsLastWeekPct)}% vs last ${new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-PH', { weekday: 'long', timeZone: 'UTC' })}</span>`;
  const os = d.shifts.filter((s) => s.overShortCents !== 0);
  return `<!doctype html><html><body style="margin:0;background:#f6f1e4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <p style="margin:0 0 4px;color:#666;font-size:13px">${esc(cafe)} · daily summary</p>
    <h1 style="margin:0 0 16px;font-size:22px">${esc(d.label)}</h1>
    ${d.record ? `<div style="background:#1d7a3a;color:#fff;border-radius:12px;padding:12px 14px;margin-bottom:12px">🏆 New highest daily sales record! (previous best ${peso(d.record.previousCents)})</div>` : ''}
    <div style="background:#fff;border-radius:14px;padding:16px 18px;margin-bottom:12px">
      <div style="font-size:13px;color:#666">Net sales</div>
      <div style="font-size:32px;font-weight:800">${peso(k.netSalesCents)}</div>
      <div style="font-size:13px">${k.orders} order${k.orders === 1 ? '' : 's'} ${vs ? '· ' + vs : ''}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px">
        ${row('Cost of goods', '−' + peso(k.cogsCents))}
        ${row('Gross profit', peso(k.grossProfitCents) + (k.grossMarginPct != null ? ` (${k.grossMarginPct}%)` : ''), true)}
        ${row('Expenses recorded for the day', '−' + peso(k.operatingCents))}
        ${row('Net profit', peso(k.netProfitCents), true)}
      </table>
      ${k.costCoveragePct < 100 ? `<p style="font-size:12px;color:#8a5a00;margin:8px 0 0">Only ${k.costCoveragePct}% of item sales have a cost set, so profit looks higher than it really is.</p>` : ''}
    </div>
    <div style="background:#fff;border-radius:14px;padding:16px 18px;margin-bottom:12px">
      <div style="font-weight:700;margin-bottom:6px">Best sellers</div>
      ${d.top.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${d.top.map((t, i) => row(`${i + 1}. ${esc(t.name)} × ${t.qty}`, peso(t.revenueCents))).join('')}</table>` : '<p style="margin:0;color:#666;font-size:14px">No sales.</p>'}
    </div>
    <div style="background:#fff;border-radius:14px;padding:16px 18px;margin-bottom:12px;font-size:14px">
      <div style="font-weight:700;margin-bottom:6px">To check</div>
      <p style="margin:4px 0">📦 Low stock: ${d.lowStock.length ? d.lowStock.map((p) => `${esc(p.name)} (${p.stock})`).join(', ') : 'nothing low'}</p>
      <p style="margin:4px 0">↩️ Voids / refunds: ${d.voids.n ? `${d.voids.n} · ${peso(d.voids.cents)}` : 'none'}</p>
      <p style="margin:4px 0">💵 Cash drawer: ${d.shifts.length ? (os.length ? os.map((s) => `${esc(s.name)} ${s.overShortCents > 0 ? 'over' : 'short'} ${peso(Math.abs(s.overShortCents))}`).join(', ') : 'all shifts balanced') : 'no shifts closed'}</p>
      <p style="margin:4px 0">⏰ Order-ahead orders for the next day: ${d.scheduledTomorrow}</p>
    </div>
    <p style="font-size:12px;color:#777">A business day runs from 4 AM to 4 AM. Full details: your staff page → Dashboard and Finance.</p>
  </div></body></html>`;
}

export async function sendSummary({ date, to } = {}) {
  if (!emailConfigured()) throw Object.assign(new Error('Email isn\'t set up yet. Add RESEND_API_KEY in Vercel (see SETUP.md).'), { status: 409 });
  const settings = await getSettings();
  const recipients = to || settings.summary.emails;
  if (!recipients?.length) throw Object.assign(new Error('Add the email address the summary goes to.'), { status: 400 });
  const d = await summaryData(date);
  const r = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.SUMMARY_FROM || "Demetria's Diner <onboarding@resend.dev>",
      to: recipients,
      subject: `${d.record ? "🏆 " : ""}${peso(d.day.netSalesCents)} · ${d.day.orders} order${d.day.orders === 1 ? "" : "s"} · ${d.label}`,
      html: summaryHtml(d),
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`The email service said: ${out.message || r.status}`), { status: 502 });
  await sql`INSERT INTO meta (key, value) VALUES ('summary_sent', ${d.date}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  return { date: d.date, to: recipients, id: out.id };
}

/** Called by the daily cron: sends yesterday's (business day) summary once. */
export async function nightly() {
  const settings = await getSettings();
  if (!settings.summary.enabled || !settings.summary.emails.length) return { skipped: 'off' };
  const date = addDays(businessDate(), -1);
  const [sent] = await sql`SELECT value FROM meta WHERE key = 'summary_sent'`;
  if (sent?.value === date) return { skipped: 'already sent', date };
  return sendSummary({ date });
}
export { TZ };
