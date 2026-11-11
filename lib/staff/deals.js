import crypto from 'node:crypto';
import { body, HttpError, clean } from '../http.js';
import { sql, audit, bumpVersion } from '../db.js';
import { requireStaff } from '../auth.js';
import { shapeDeal } from '../deals.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// /api/staff/deals   Buy 1 Take 1 deals   (permission: settings: admins and managers)
//   GET                       all deals, with how many orders used them and how much they gave
//   POST {title, description, productIds[], pairPrice (₱ for the pair, empty = 2nd one free), days[0–6],
//         startsOn, endsOn, channel: both|online|pos, maxPairs, popup, active}
//   PUT  {id, …same fields}     DELETE {id}
export async function deals(req, res) {
  const me = await requireStaff(req, 'settings');
  if (req.method === 'GET') {
    const [rows, stats] = [await sql`SELECT * FROM deals WHERE NOT deleted ORDER BY active DESC, created_at DESC`,
      await sql`SELECT d->>'id' AS id, COUNT(DISTINCT o.id)::int AS orders, COALESCE(SUM((d->>'pairs')::int), 0)::int AS pairs,
                  COALESCE(SUM((d->>'offCents')::int), 0)::int AS given
                FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.deals) d
                WHERE o.deals IS NOT NULL AND o.status <> 'cancelled' GROUP BY 1`];
    const by = Object.fromEntries(stats.map((s) => [s.id, s]));
    return res.status(200).json({ deals: rows.map((r) => ({ ...shapeDeal(r), orders: by[r.id]?.orders || 0, pairs: by[r.id]?.pairs || 0, givenCents: by[r.id]?.given || 0 })) });
  }
  const b = body(req);
  if (req.method === 'DELETE') {
    const [d] = await sql`UPDATE deals SET deleted = TRUE, active = FALSE WHERE id = ${String(b.id)} AND NOT deleted RETURNING *`;
    if (!d) throw new HttpError(404, 'Deal not found.');
    await Promise.all([audit(me, 'deal.delete', d.title), bumpVersion()]);
    return res.status(200).json({ ok: true });
  }
  let cur = null;
  if (req.method === 'PUT') {
    [cur] = await sql`SELECT * FROM deals WHERE id = ${String(b.id)} AND NOT deleted`;
    if (!cur) throw new HttpError(404, 'Deal not found.');
  }
  const has = (k) => b[k] !== undefined;
  const title = has('title') ? clean(b.title, 60) : cur?.title || '';
  if (title.length < 3) throw new HttpError(400, 'Give the deal a name, like "Buy 1 Take 1 Iced Coffee".');
  const description = has('description') ? clean(b.description, 200) : cur?.description || '';

  let productIds = cur?.product_ids || [];
  if (has('productIds')) {
    const want = [...new Set((Array.isArray(b.productIds) ? b.productIds : []).map(String))].slice(0, 80);
    if (!want.length) throw new HttpError(400, 'Pick the drinks or food in this deal.');
    const found = await sql`SELECT id FROM products WHERE id = ANY(${want}::text[]) AND NOT deleted`;
    productIds = want.filter((id) => found.some((f) => f.id === id));
    if (!productIds.length) throw new HttpError(400, 'Those items are no longer on the menu.');
  }
  if (!productIds.length) throw new HttpError(400, 'Pick the drinks or food in this deal.');

  let pairCents = cur?.pair_cents ?? null;
  if (has('pairPrice')) {
    pairCents = b.pairPrice === '' || b.pairPrice == null ? null : Math.round(Number(b.pairPrice) * 100);
    if (pairCents != null && !(pairCents >= 100 && pairCents <= 10_000_00)) throw new HttpError(400, 'The price for 2 must be at least ₱1 (or leave it empty for "second one free").');
  }
  const days = has('days') ? [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].filter((d) => d >= 0 && d <= 6).sort() : cur?.days || [];
  const startsOn = has('startsOn') ? b.startsOn || null : cur?.starts_on || null;
  const endsOn = has('endsOn') ? b.endsOn || null : cur?.ends_on || null;
  if ((startsOn && !DATE.test(startsOn)) || (endsOn && !DATE.test(endsOn))) throw new HttpError(400, 'Check the dates.');
  if (startsOn && endsOn && endsOn < startsOn) throw new HttpError(400, 'The end date is before the start date.');
  const channel = has('channel') ? b.channel : cur?.channel || 'both';
  if (!['both', 'online', 'pos'].includes(channel)) throw new HttpError(400, 'Choose where the deal works.');
  let maxPairs = cur?.max_pairs ?? null;
  if (has('maxPairs')) {
    maxPairs = b.maxPairs === '' || b.maxPairs == null ? null : parseInt(b.maxPairs, 10);
    if (maxPairs != null && !(maxPairs >= 1 && maxPairs <= 50)) throw new HttpError(400, 'Max per order must be 1 or more (or empty for no limit).');
  }
  const popup = typeof b.popup === 'boolean' ? b.popup : !!cur?.popup;
  if (popup && channel === 'pos') throw new HttpError(400, 'In-store-only deals can\'t be shown in the website pop-up. Change "Works" to Online or both.');
  const active = typeof b.active === 'boolean' ? b.active : cur ? cur.active : true;

  const id = cur?.id || 'deal-' + crypto.randomBytes(5).toString('hex');
  const [d] = await sql`INSERT INTO deals (id, title, description, product_ids, pair_cents, days, starts_on, ends_on, channel, max_pairs, popup, active, created_by)
      VALUES (${id}, ${title}, ${description}, ${JSON.stringify(productIds)}::jsonb, ${pairCents}, ${JSON.stringify(days)}::jsonb, ${startsOn}, ${endsOn},
              ${channel}, ${maxPairs}, ${popup}, ${active}, ${me.id})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, product_ids = EXCLUDED.product_ids,
        pair_cents = EXCLUDED.pair_cents, days = EXCLUDED.days, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on,
        channel = EXCLUDED.channel, max_pairs = EXCLUDED.max_pairs, popup = EXCLUDED.popup, active = EXCLUDED.active
      RETURNING *`;
  const summary = (r) => ({ items: (r.product_ids || []).length, price: r.pair_cents, days: (r.days || []).join(','), startsOn: r.starts_on, endsOn: r.ends_on, channel: r.channel, maxPairs: r.max_pairs, popup: !!r.popup, active: r.active });
  if (!cur) await audit(me, 'deal.add', d.title, summary(d));
  else {
    const was = summary(cur), now = summary(d);
    const changes = Object.fromEntries(Object.keys(was).filter((k) => was[k] !== now[k]).map((k) => [k, [was[k], now[k]]]));
    if (cur.title !== d.title) changes.title = [cur.title, d.title];
    if (Object.keys(changes).length) await audit(me, 'deal.edit', d.title, changes);
  }
  await bumpVersion(); // websites and POS screens pick up the change within seconds
  res.status(cur ? 200 : 201).json(shapeDeal(d));
}