// Buy 1 Take 1 deals, created in /staff → Settings → Buy 1 Take 1.
//
// How a deal is priced (the same rules run in the browser, so the cart shows the saving before ordering):
//   • Only the deal's items count. Each one's price is the item price (after happy hour), without add-ons:
//     add-ons are always paid in full.
//   • Those items are sorted from most to least expensive and paired up: 1st + 2nd, 3rd + 4th, …
//   • Each pair costs the deal price ("₱149 for 2"), or, if no deal price is set, the dearer item: the other is free.
//     A pair never costs more than the two items at their normal price.
//   • "Max per order" limits how many pairs one order gets. An item counts for one deal only.
//   • Promo codes and POS discounts (senior, PWD, staff…) apply to what's left after the deal.
import { sql } from './db.js';
import { businessDate, localParts } from './time.js';

/** Is the deal on at time t (dates, and days of the week if set)? */
export function dealOn(d, t = new Date()) {
  if (!d.active) return false;
  const day = businessDate(t);
  if (d.startsOn && day < d.startsOn) return false;
  if (d.endsOn && day > d.endsOn) return false;
  if (d.days?.length && !d.days.includes(localParts(t).dow)) return false;
  return true;
}

/**
 * lines: priced cart lines ({ id, qty, unitCents, addons:[{cents}] }); deals: shaped deals that are on.
 * → { offCents, applied: [{ id, title, pairs, offCents }], waiting: [{ id, title }] }
 *   waiting = deals with one item short of another pair ("add 1 more to get it free").
 */
export function applyDeals(lines, deals) {
  const used = new Map();
  const applied = [], waiting = [];
  let total = 0;
  for (const d of deals) {
    const units = [];
    lines.forEach((l, i) => {
      if (!d.productIds.includes(l.id)) return;
      const base = l.unitCents - (l.addons || []).reduce((a, x) => a + (x.cents || 0), 0);
      for (let k = used.get(i) || 0; k < l.qty; k++) units.push({ i, base });
    });
    units.sort((a, b) => b.base - a.base);
    let pairs = Math.floor(units.length / 2);
    if (d.maxPairs) pairs = Math.min(pairs, d.maxPairs);
    let off = 0;
    for (let p = 0; p < pairs; p++) {
      const a = units[2 * p], b = units[2 * p + 1];
      const pairCost = d.pairCents != null ? Math.min(d.pairCents, a.base + b.base) : a.base;
      off += a.base + b.base - pairCost;
      used.set(a.i, (used.get(a.i) || 0) + 1); used.set(b.i, (used.get(b.i) || 0) + 1);
    }
    if (pairs && off > 0) { applied.push({ id: d.id, title: d.title, pairs, offCents: off }); total += off; }
    if (units.length % 2 === 1 && (!d.maxPairs || pairs < d.maxPairs)) waiting.push({ id: d.id, title: d.title });
  }
  return { offCents: total, applied, waiting, used };
}

export const shapeDeal = (r) => ({
  id: r.id, title: r.title, description: r.description || '', productIds: r.product_ids || [], pairCents: r.pair_cents,
  days: r.days || [], startsOn: r.starts_on, endsOn: r.ends_on, channel: r.channel, maxPairs: r.max_pairs,
  popup: !!r.popup, active: !!r.active,
});
/** What the browser gets (website or POS): only deals that are on, or will be later today/this week. */
export const publicDeal = ({ id, title, description, productIds, pairCents, days, startsOn, endsOn, channel, maxPairs, popup }) =>
  ({ id, title, description, productIds, pairCents, days, startsOn, endsOn, channel, maxPairs, popup, active: true });

export const dealsQuery = () => sql`SELECT * FROM deals WHERE active AND NOT deleted ORDER BY created_at`;
/** Deals that work on this channel ('online' | 'pos') and haven't ended. */
export function dealsFor(rows, channel) {
  const today = businessDate();
  return rows.map(shapeDeal).filter((d) => (d.channel === 'both' || d.channel === channel) && !(d.endsOn && today > d.endsOn));
}
/** Deals to price an order at time t. */
export async function activeDeals(channel, t = new Date()) {
  return dealsFor(await dealsQuery(), channel).filter((d) => dealOn(d, t));
}
/** "Buy 1 Take 1 Iced Coffee ×2" for receipts and reports. */
export const dealsLabel = (applied) => applied.map((a) => `${a.title}${a.pairs > 1 ? ` ×${a.pairs}` : ''}`).join(', ');
/** Receipt line: adds "Buy 1 Take 1:" in front unless the deal's name already says it. */
export const dealsDiscountLabel = (applied) => {
  const names = dealsLabel(applied);
  return applied.length ? (/take\s*1|b1t1/i.test(names) ? names : `Buy 1 Take 1: ${names}`) : '';
};