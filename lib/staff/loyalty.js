import { body, HttpError, clean } from '../http.js';
import { sql, getSettings, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { cardOf, normPhone, attachStamp } from '../loyalty.js';
import { staffOrder } from '../db.js';
import { BTZ } from '../time.js';

// /api/staff/loyalty   stamp card
//   GET ?phone=09…            one card (POS: before charging)                         (pos)
//   GET                       top regulars: most stamps earned, last visit, rewards  (sales)
//   POST {phone, delta, reason}  add or remove stamps by hand (shown in the Activity log)  (settings)
//   POST {orderId, phone}        "Add stamp": put one of TODAY's orders on a stamp card            (pos)
export async function loyalty(req, res) {
  const cfg = (await getSettings()).loyalty;
  if (req.method === 'GET' && req.query.phone) {
    await requireStaff(req, 'pos');
    if (!cfg.enabled) throw new HttpError(409, 'The stamp card is switched off (Settings → Stamp card).');
    const phone = normPhone(req.query.phone);
    if (!phone) throw new HttpError(400, 'Enter a mobile number, like 0917 123 4567.');
    return res.status(200).json(await cardOf(phone, cfg));
  }
  if (req.method === 'GET') {
    await requireStaff(req, 'sales');
    const rows = await sql`
      WITH dd AS (
        SELECT loyalty_phone AS phone, to_char(created_at AT TIME ZONE ${BTZ}, 'YYYY-MM-DD') AS day,
          COALESCE(SUM(loyalty_earn) FILTER (WHERE payment_status = 'paid'), 0) AS paid
        FROM orders WHERE loyalty_phone IS NOT NULL AND status <> 'cancelled' AND loyalty_earn > 0 GROUP BY 1, 2),
      e AS (SELECT phone, SUM(LEAST(paid, ${cfg.perDay || 1000000}::int))::int AS earned FROM dd GROUP BY 1),
      o AS (
        SELECT loyalty_phone AS phone,
          SUM(loyalty_used) FILTER (WHERE status <> 'cancelled')::int AS used,
          COUNT(*) FILTER (WHERE status <> 'cancelled' AND payment_status = 'paid')::int AS visits,
          COUNT(*) FILTER (WHERE status <> 'cancelled' AND loyalty_used > 0)::int AS rewards,
          SUM(total_cents) FILTER (WHERE status <> 'cancelled' AND payment_status = 'paid')::int AS spent,
          MAX(created_at) FILTER (WHERE status <> 'cancelled') AS last_at,
          (ARRAY_AGG(name ORDER BY (name = 'Walk-in'), created_at DESC))[1] AS name
        FROM orders WHERE loyalty_phone IS NOT NULL GROUP BY loyalty_phone),
      a AS (SELECT phone, SUM(delta)::int AS adj FROM loyalty_adjust GROUP BY phone)
      SELECT COALESCE(o.phone, a.phone) AS phone, o.name, COALESCE(e.earned, 0) AS earned, COALESCE(o.used, 0) AS used, COALESCE(a.adj, 0) AS adj,
             COALESCE(o.visits, 0) AS visits, COALESCE(o.rewards, 0) AS rewards, COALESCE(o.spent, 0) AS spent, o.last_at
      FROM o FULL JOIN a ON a.phone = o.phone LEFT JOIN e ON e.phone = o.phone
      ORDER BY COALESCE(e.earned, 0) DESC, o.last_at DESC NULLS LAST LIMIT 100`;
    return res.status(200).json({
      config: cfg,
      regulars: rows.map((r) => ({ phone: r.phone, name: r.name || '', stamps: Math.max(0, r.earned - r.used + r.adj), earned: r.earned, visits: r.visits, rewards: r.rewards, spentCents: r.spent, lastAt: r.last_at })),
    });
  }
  const b = body(req);
  if (b.orderId) {
    const u = await requireStaff(req, 'pos');
    const [o] = await sql`SELECT * FROM orders WHERE id = ${String(b.orderId)}`;
    if (!o) throw new HttpError(404, 'Order not found.');
    const r = await attachStamp(cfg, o, b.phone);
    await audit(u, 'loyalty.attach', `#${o.code}`, { phone: r.card.phone, stamps: r.earned });
    return res.status(200).json({ card: r.card, earned: r.earned, paid: r.paid, order: staffOrder(r.order) });
  }
  const me = await requireStaff(req, 'settings');
  const phone = normPhone(b.phone);
  if (!phone) throw new HttpError(400, 'Enter a mobile number, like 0917 123 4567.');
  const delta = parseInt(b.delta, 10);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 50) throw new HttpError(400, 'Add or remove 1 to 50 stamps.');
  const reason = clean(b.reason, 120);
  if (reason.length < 3) throw new HttpError(400, 'Write why (e.g. "forgot to add the number", "paper card transferred").');
  const before = await cardOf(phone, cfg);
  if (before.stamps + delta < 0) throw new HttpError(400, `This card only has ${before.stamps} stamps.`);
  await sql`INSERT INTO loyalty_adjust (phone, delta, reason, user_id) VALUES (${phone}, ${delta}, ${reason}, ${me.id})`;
  await audit(me, 'loyalty.adjust', phone, { delta, reason, from: before.stamps, to: before.stamps + delta });
  res.status(200).json(await cardOf(phone, cfg));
}