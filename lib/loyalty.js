// Stamp card ("Buy 9, the 10th is free"), by mobile number. Set up in /staff → Settings → Stamp card.
//
// Stamps aren't stored as a running number; they're worked out from the orders, so they're always right:
//   stamps = stamps earned on PAID orders that weren't cancelled
//          − stamps spent on rewards (orders not cancelled)
//          ± manual adjustments (Settings → Stamp card, with a reason; in the Activity log)
// So a cancelled or voided order takes its stamps back by itself, and an unpaid online order only
// counts once staff collect the money.
//
// Reward: when a card has `needed` stamps, one qualifying item on the order is free (the most expensive one,
// up to `maxCents` if set). It's applied after Buy 1 Take 1 deals and before promo codes.
import { sql } from './db.js';
import { HttpError } from './http.js';
import { BTZ, businessDate } from './time.js';
import { kindOf } from './menu.js';

export const LOYALTY_DEFAULTS = {
  enabled: false,
  name: "Demetria's Stamp Card",
  needed: 9,          // stamps for a reward ("buy 9, the 10th is free")
  cats: [], ids: [],  // what earns a stamp; both empty = every drink
  maxCents: null,     // most the free item can be worth (null = any qualifying item)
  online: false,      // allow claiming the reward on online orders (off: claim at the counter, where staff can check)
  perDay: 1,          // most stamps one card can get per business day (4 AM → 4 AM); null = no limit
};
const NO_CAP = 1000000;
const capOf = (cfg) => (cfg.perDay ? cfg.perDay : NO_CAP);

/** 0917 123 4567 / +63 917 123 4567 / 639171234567 → "09171234567", or null if it isn't a PH mobile number. */
export function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('63')) d = '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  return /^09\d{9}$/.test(d) ? d : null;
}
/** "0917•••4567" for screens that don't need the full number. */
export const maskPhone = (p) => (p ? `${p.slice(0, 4)}•••${p.slice(-4)}` : '');

export const qualifies = (cfg, line) =>
  cfg.ids?.length || cfg.cats?.length ? cfg.ids.includes(line.id) || cfg.cats.includes(line.cat) : kindOf(line.cat) === 'drink';

/** Stamps this order earns: one per qualifying item (the free reward item doesn't earn one). */
export const stampsEarned = (cfg, lines, rewardUnits = 0) =>
  Math.max(0, lines.filter((l) => qualifies(cfg, l)).reduce((a, l) => a + l.qty, 0) - rewardUnits);

/** The free item: the most expensive qualifying item not already used by a Buy 1 Take 1 deal (add-ons not included). */
export function loyaltyReward(cfg, lines, used) {
  let best = null;
  lines.forEach((l, i) => {
    if (!qualifies(cfg, l) || l.qty - (used?.get(i) || 0) <= 0) return;
    const base = l.unitCents - (l.addons || []).reduce((a, x) => a + (x.cents || 0), 0);
    if (!best || base > best.base) best = { i, base };
  });
  if (!best) return { offCents: 0, line: -1 };
  return { offCents: cfg.maxCents ? Math.min(best.base, cfg.maxCents) : best.base, line: best.i };
}

// Stamps are counted per business day and capped at "max stamps per day" (orders keep their full count, so if one
// order that day is cancelled, another order the same day still earns the stamp).
const cardQuery = (phone, cap) => sql`
  WITH d AS (
    SELECT to_char(created_at AT TIME ZONE ${BTZ}, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(loyalty_earn) FILTER (WHERE payment_status = 'paid'), 0) AS paid, SUM(loyalty_earn) AS total
    FROM orders WHERE loyalty_phone = ${phone} AND status <> 'cancelled' AND loyalty_earn > 0 GROUP BY 1)
  SELECT
    COALESCE((SELECT SUM(LEAST(paid, ${cap}::int)) FROM d), 0)::int AS earned,
    COALESCE((SELECT SUM(LEAST(total, ${cap}::int) - LEAST(paid, ${cap}::int)) FROM d), 0)::int AS pending,
    COALESCE((SELECT LEAST(total, ${cap}::int) FROM d WHERE day = ${businessDate()}), 0)::int AS today,
    COALESCE((SELECT SUM(loyalty_used) FROM orders WHERE loyalty_phone = ${phone} AND status <> 'cancelled'), 0)::int AS used,
    COALESCE((SELECT SUM(loyalty_used) FROM orders WHERE loyalty_phone = ${phone} AND status <> 'cancelled' AND loyalty_used > 0), 0)::int AS spent,
    COALESCE((SELECT COUNT(*) FROM orders WHERE loyalty_phone = ${phone} AND status <> 'cancelled' AND loyalty_used > 0), 0)::int AS rewards,
    COALESCE((SELECT SUM(delta) FROM loyalty_adjust WHERE phone = ${phone}), 0)::int AS adjust,
    (SELECT name FROM orders WHERE loyalty_phone = ${phone} ORDER BY (name = 'Walk-in'), created_at DESC LIMIT 1) AS name,
    (SELECT MAX(created_at) FROM orders WHERE loyalty_phone = ${phone} AND status <> 'cancelled') AS last_at`;

/** A card's current stamps (and how many more are waiting for unpaid orders). */
export async function cardOf(phone, cfg) {
  const [r] = await cardQuery(phone, capOf(cfg));
  const stamps = Math.max(0, r.earned - r.used + r.adjust);
  return { phone, name: r.name || '', stamps, pending: r.pending, needed: cfg.needed, ready: stamps >= cfg.needed, rewards: r.rewards, lifetime: r.earned + Math.max(0, r.adjust), lastAt: r.last_at,
    today: r.today, perDay: cfg.perDay || null, todayLeft: cfg.perDay ? Math.max(0, cfg.perDay - r.today) : null };
}

/**
 * The stamp-card part of an order (online or POS). `used` = units already taken by Buy 1 Take 1 deals; the reward
 * unit is added to it so a promo code can't use the same item again.
 * → { phone, earn, used, off, label }  (all zero / null when no number was given)
 */
export async function applyLoyalty(cfg, { phone: raw, redeem, items, used, channel }) {
  const none = { phone: null, earn: 0, used: 0, off: 0, label: '' };
  if (!cfg.enabled || !raw) { if (redeem) throw new HttpError(400, 'Enter the mobile number on the stamp card.'); return none; }
  const phone = normPhone(raw);
  if (!phone) throw new HttpError(400, 'Enter a mobile number for the stamp card, like 0917 123 4567.');
  // Stamps this order adds (after today's limit). The order keeps the full count; the card total applies the limit.
  const effective = async (n) => (cfg.perDay ? Math.min(n, (await cardOf(phone, cfg)).todayLeft) : n);
  if (!redeem) { const n = stampsEarned(cfg, items); return { ...none, phone, earn: n, adds: await effective(n) }; }
  if (channel === 'online' && !cfg.online) throw new HttpError(409, 'Free-drink rewards are claimed at the counter. Show your number to the cashier.');
  const card = await cardOf(phone, cfg);
  if (card.stamps < cfg.needed) throw new HttpError(409, `This card has ${card.stamps} of ${cfg.needed} stamps. The reward needs ${cfg.needed}.`);
  const r = loyaltyReward(cfg, items, used);
  if (!r.offCents) throw new HttpError(409, 'Add a drink (or another item on the stamp card) to use the free reward.');
  used?.set(r.line, (used.get(r.line) || 0) + 1);
  const n = stampsEarned(cfg, items, 1);
  return { phone, earn: n, adds: cfg.perDay ? Math.min(n, card.todayLeft) : n, used: cfg.needed, off: r.offCents, label: `${cfg.name}: free ${items[r.line].name}` };
}

/**
 * Put one of TODAY's orders on a stamp card, after the fact: the customer's "Claim stamp" (they forgot to type
 * their number) or staff "Add stamp". Only orders from today (business day, 4 AM → 4 AM) that weren't cancelled.
 * → { card, earned (stamps it adds), paid }
 */
export async function attachStamp(cfg, order, raw) {
  if (!cfg.enabled) throw new HttpError(409, 'The stamp card is switched off right now.');
  const phone = normPhone(raw);
  if (!phone) throw new HttpError(400, 'Enter a mobile number, like 0917 123 4567.');
  if (order.status === 'cancelled') throw new HttpError(409, "This order was cancelled, so it can't get a stamp.");
  if (businessDate(order.created_at) !== businessDate()) {
    const d = new Date(businessDate(order.created_at) + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'long', day: 'numeric', timeZone: 'UTC' });
    throw new HttpError(409, `Stamps can only be claimed on the day of the order. This order was on ${d}.`);
  }
  if (order.loyalty_phone) throw new HttpError(409, order.loyalty_phone === phone ? 'This order is already on this stamp card.' : `This order is already on another stamp card (${maskPhone(order.loyalty_phone)}).`);
  const n = stampsEarned(cfg, order.items);
  if (!n) throw new HttpError(409, cfg.ids?.length || cfg.cats?.length ? "This order doesn't have any items that earn stamps." : "This order doesn't have a drink, so it doesn't earn a stamp.");
  const before = await cardOf(phone, cfg);
  if (cfg.perDay && before.todayLeft === 0) throw new HttpError(409, `This number already got today's stamp (${cfg.perDay === 1 ? '1 per day' : cfg.perDay + ' per day'}). Come back tomorrow!`);
  const [o] = await sql`UPDATE orders SET loyalty_phone = ${phone}, loyalty_earn = ${n}, updated_at = now() WHERE id = ${order.id} AND loyalty_phone IS NULL RETURNING *`;
  if (!o) throw new HttpError(409, 'This order was just added to a stamp card.');
  const card = await cardOf(phone, cfg);
  return { card, earned: cfg.perDay ? Math.min(n, before.todayLeft) : n, paid: o.payment_status === 'paid', order: o };
}
/** Can this order still get a stamp today? (for showing the "Claim stamp" / "Add stamp" button) */
export const stampable = (cfg, o) => !!(cfg.enabled && !o.loyalty_phone && o.status !== 'cancelled'
  && businessDate(o.created_at) === businessDate() && stampsEarned(cfg, o.items) > 0);

export function checkLoyalty(x, cur = LOYALTY_DEFAULTS) {
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const n = { ...LOYALTY_DEFAULTS, ...cur };
  if (typeof x.enabled === 'boolean') n.enabled = x.enabled;
  if (x.name !== undefined) n.name = String(x.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) || LOYALTY_DEFAULTS.name;
  if (x.needed !== undefined) { const v = parseInt(x.needed, 10); if (!(v >= 2 && v <= 50)) err('Stamps for a reward must be 2 to 50.'); n.needed = v; }
  if (x.cats !== undefined) n.cats = (Array.isArray(x.cats) ? x.cats : []).map(String).slice(0, 20);
  if (x.ids !== undefined) n.ids = (Array.isArray(x.ids) ? x.ids : []).map(String).slice(0, 120);
  if (x.maxPesos !== undefined) { const v = x.maxPesos === '' || x.maxPesos == null ? null : Math.round(Number(x.maxPesos) * 100); if (v != null && !(v >= 100)) err('The reward limit must be at least ₱1 (or empty for no limit).'); n.maxCents = v; }
  if (typeof x.online === 'boolean') n.online = x.online;
  if (x.perDay !== undefined) { const v = x.perDay === '' || x.perDay == null ? null : parseInt(x.perDay, 10); if (v != null && !(v >= 1 && v <= 50)) err('Max stamps per day must be 1 to 50 (or empty for no limit).'); n.perDay = v; }
  return n;
}
/** What the website needs (no customer data). */
export const publicLoyalty = (c) => (c.enabled ? { enabled: true, name: c.name, needed: c.needed, cats: c.cats, ids: c.ids, maxCents: c.maxCents, online: c.online, perDay: c.perDay || null } : { enabled: false });