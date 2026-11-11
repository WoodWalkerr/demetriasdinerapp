// Promo codes: e.g. BDAY20 = 20% off, SAVE50 = ₱50 off. Created in /staff → Settings → Promo codes.
// Used by customers online (cart → "Promo code") and by cashiers at the POS.
// Discounts apply to the items (after any happy-hour price), never to the delivery fee, and are rounded to whole pesos.
import { HttpError } from './http.js';
import { sql } from './db.js';
import { businessDate } from './time.js';

export const normCode = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
export const CODE_RE = /^[A-Z0-9-]{3,20}$/;

/** "20% off (up to ₱100)" / "₱50 off" */
export function codeLabel(c) {
  const peso = (x) => '₱' + (x / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  return c.kind === 'pct' ? `${c.value}% off${c.max_off_cents ? ` (up to ${peso(c.max_off_cents)})` : ''}` : `${peso(c.value)} off`;
}

/** Discount for a subtotal (centavos), whole pesos. */
export function codeDiscount(c, subtotal) {
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

/** What the customer's browser needs to show the discount before ordering (no usage numbers). */
export const publicCode = (c) => ({ code: c.code, kind: c.kind, value: c.value, minCents: c.min_cents, maxOffCents: c.max_off_cents, label: codeLabel(c) });