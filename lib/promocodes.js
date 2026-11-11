// Promo codes: e.g. BDAY20 = 20% off, SAVE50 = ₱50 off. Created in /staff → Settings → Promo codes.
// Used by customers online (cart → "Promo code") and by cashiers at the POS.
// Discounts apply to the items (after any happy-hour price), never to the delivery fee, and are rounded to whole pesos.
import { HttpError } from './http.js';
import { sql } from './db.js';
import { businessDate } from './time.js';

export const normCode = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
export const CODE_RE = /^[A-Z0-9-]{3,20}$/;

/** "20% off (up to ₱100)" / "₱50 off" / "Buy Iced Latte, get Cookie free" */
export function codeLabel(c) {
  const peso = (x) => '₱' + (x / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  if (c.kind === 'bogo') {
    const b = c.bogo || {};
    return `Buy ${b.buyQty > 1 ? b.buyQty + ' × ' : ''}${b.buyLabel || 'an item'}, get ${b.getLabel || 'an item'} ${b.getPct >= 100 ? 'free' : `${b.getPct}% off`}`;
  }
  return c.kind === 'pct' ? `${c.value}% off${c.max_off_cents ? ` (up to ${peso(c.max_off_cents)})` : ''}` : `${peso(c.value)} off`;
}

/**
 * "Buy this, get that" (kind 'bogo'): for every `buyQty` of the buy items, one of the get items is free
 * (or getPct % off), up to `max` per order. The cheapest get items are the rewards; an item can't be both
 * the one you buy and the one you get, and items already used by a Buy 1 Take 1 deal don't count.
 * Same rules run in the browser (public/js/site.js, staff.js).
 *   lines: priced cart lines { id, qty, unitCents, addons:[{cents}] }; used: Map(line index → units used by deals)
 * → { offCents, rewards, need: '' | 'buy' | 'get' }
 */
export function bogoReward(b, lines, used) {
  const units = [];
  lines.forEach((l, i) => {
    const base = l.unitCents - (l.addons || []).reduce((a, x) => a + (x.cents || 0), 0);
    for (let k = used?.get(i) || 0; k < l.qty; k++) units.push({ id: l.id, base });
  });
  const getU = units.filter((u) => b.getIds.includes(u.id)).sort((x, y) => x.base - y.base);
  const buyU = units.filter((u) => b.buyIds.includes(u.id));
  const per = Math.max(1, b.buyQty || 1);
  let best = 0;
  for (let r = 1; r <= getU.length && (!b.max || r <= b.max); r++) {
    const chosen = new Set(getU.slice(0, r));
    if (buyU.filter((u) => !chosen.has(u)).length >= r * per) best = r; else break;
  }
  const off = getU.slice(0, best).reduce((a, u) => a + Math.round((u.base * Math.min(100, b.getPct)) / 10000) * 100, 0);
  return { offCents: off, rewards: best, need: best ? '' : buyU.length < per ? 'buy' : 'get' };
}

/** Discount for a subtotal (centavos), whole pesos. "Buy this, get that" codes also need the cart lines. */
export function codeDiscount(c, subtotal, lines = [], used = null) {
  if (c.kind === 'bogo') return Math.max(0, Math.min(bogoReward(c.bogo || {}, lines, used).offCents, subtotal));
  const raw = c.kind === 'pct' ? (subtotal * c.value) / 100 : c.value;
  let off = Math.round(raw / 100) * 100;
  if (c.kind === 'pct' && c.max_off_cents) off = Math.min(off, c.max_off_cents);
  return Math.max(0, Math.min(off, subtotal));
}

/**
 * Looks up a code and checks it can be used now on this channel ('online' | 'pos').
 * subtotal (optional) also checks the minimum order. Throws a friendly HttpError when it can't be used.
 */
export async function checkCode(input, { channel, subtotal = null } = {}) {
  const code = normCode(input);
  if (!CODE_RE.test(code)) throw new HttpError(404, "That promo code doesn't exist. Check the spelling.");
  const [c] = await sql`SELECT p.*, (SELECT COUNT(*)::int FROM orders o WHERE o.promo_code = p.code AND o.status <> 'cancelled') AS uses
                        FROM promo_codes p WHERE p.code = ${code} AND NOT p.deleted`;
  if (!c) throw new HttpError(404, "That promo code doesn't exist. Check the spelling.");
  const today = businessDate();
  if (!c.active) throw new HttpError(409, `${code} isn't active right now.`);
  if (c.starts_on && today < c.starts_on) throw new HttpError(409, `${code} starts on ${c.starts_on}.`);
  if (c.ends_on && today > c.ends_on) throw new HttpError(409, `${code} has expired.`);
  if (c.channel !== 'both' && c.channel !== channel) throw new HttpError(409, channel === 'online' ? `${code} can only be used in the store.` : `${code} is for online orders only.`);
  if (c.max_uses != null && c.uses >= c.max_uses) throw new HttpError(409, `${code} has been used up.`);
  if (subtotal != null && subtotal < c.min_cents) throw new HttpError(409, `${code} needs a minimum order of ₱${(c.min_cents / 100).toLocaleString('en-PH')}.`);
  return c;
}

/**
 * Codes advertised in the website pop-up: switched on for the pop-up, active, usable online,
 * started, not expired and not used up. `rows` come with a `uses` count.
 */
export function popupCodes(rows) {
  const today = businessDate();
  return rows.filter((c) => c.popup && c.active && !c.deleted && c.channel !== 'pos'
      && !(c.starts_on && today < c.starts_on) && !(c.ends_on && today > c.ends_on) && !(c.max_uses != null && c.uses >= c.max_uses))
    .map((c) => ({ code: c.code, label: codeLabel(c), minCents: c.min_cents, endsOn: c.ends_on, channel: c.channel,
      title: c.popup_title || '', text: c.popup_text || '', kind: c.kind }));
}
export const popupQuery = () => sql`SELECT p.*, (SELECT COUNT(*)::int FROM orders o WHERE o.promo_code = p.code AND o.status <> 'cancelled') AS uses
  FROM promo_codes p WHERE p.popup AND p.active AND NOT p.deleted ORDER BY p.created_at DESC LIMIT 5`;

/** What the customer's browser needs to show the discount before ordering (no usage numbers). */
export const publicCode = (c) => ({ code: c.code, kind: c.kind, value: c.value, minCents: c.min_cents, maxOffCents: c.max_off_cents, label: codeLabel(c),
  ...(c.kind === 'bogo' ? { bogo: c.bogo } : {}) });
/** Why a "buy this, get that" code gives nothing yet, as a friendly message. */
export const bogoNeed = (c, need) => need === 'buy'
  ? `To use ${c.code}, buy ${c.bogo.buyQty > 1 ? c.bogo.buyQty + ' × ' : ''}${c.bogo.buyLabel}.`
  : `To use ${c.code}, add ${c.bogo.getLabel} to your order. It's ${c.bogo.getPct >= 100 ? 'free' : `${c.bogo.getPct}% off`}.`;