import crypto from 'node:crypto';
import { body, HttpError, clean } from '../http.js';
import { sql, staffOrder, audit } from '../db.js';
import { requireStaff, requireShift } from '../auth.js';
import { DISCOUNTS } from '../menu.js';
import { loadCatalog, priceLine, makeCode, takeStock, returnStock, checkTender } from '../pricing.js';
import { checkCode, codeDiscount, codeLabel, bogoReward, bogoNeed } from '../promocodes.js';
import { activeDeals, applyDeals, dealsDiscountLabel } from '../deals.js';
import { applyLoyalty } from '../loyalty.js';
import { getSettings } from '../db.js';

// POST /api/staff/pos — record an in-store sale.
// { items:[{id, qty, opts, addons}], name?, orderType: 'dine-in'|'takeout',
//   payments:[{method: cash|gcash|paymaya, cents, ref?}], tenderedCents?,
//   discount?: senior|pwd|staff|code|custom, discountId?, promoCode? (code),
//   customKind?: pct|fixed, customValue? (% or ₱), discountReason? (custom: needs the "discounts" permission),
//   note?, sendToBoard }
export async function pos(req, res) {
  const u = await requireStaff(req, 'pos');
  const shiftId = requireShift(u);
  const b = body(req);

  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Add at least one item.');
  if (b.items.length > 60) throw new HttpError(400, 'Too many lines on one ticket.');
  const catalog = await loadCatalog();
  const items = b.items.map((l) => priceLine(l, catalog, { staff: true }));
  const orderType = b.orderType === 'takeout' ? 'takeout' : 'dine-in';

  const subtotal = items.reduce((a, i) => a + i.unitCents * i.qty, 0);
  // Buy 1 Take 1 first (automatic); any other discount is on what's left.
  const deal = applyDeals(items, await activeDeals('pos'));
  // Stamp card (the cashier types the customer's number; "Use free drink" when the card is full).
  const loy = await applyLoyalty((await getSettings()).loyalty, { phone: b.loyaltyPhone, redeem: !!b.loyaltyRedeem, items, used: deal.used, channel: 'pos' });
  const base = subtotal - deal.offCents - loy.off;
  let discount = 0, discountType = null, promoCode = null;
  if (b.discount === 'code') {
    const c = await checkCode(b.promoCode, { channel: 'pos', subtotal: base });
    discount = codeDiscount(c, base, items, deal.used); promoCode = c.code;
    if (c.kind === 'bogo' && !discount) throw new HttpError(409, bogoNeed(c, bogoReward(c.bogo, items, deal.used).need));
    discountType = `Promo ${c.code} · ${codeLabel(c)}`;
  } else if (b.discount === 'custom') {
    if (!u.can('discounts')) throw new HttpError(403, 'Only staff allowed to give custom discounts can do this. Ask a manager.');
    const reason = clean(b.discountReason, 80);
    if (reason.length < 3) throw new HttpError(400, 'Write the reason for the discount (e.g. "regular customer", "late order").');
    const v = Number(b.customValue);
    if (b.customKind === 'pct') {
      if (!(Number.isInteger(v) && v >= 1 && v <= 100)) throw new HttpError(400, 'Percent off must be a whole number from 1 to 100.');
      discount = Math.round((base * v) / 100);
      discountType = `Discount ${v}% · ${reason}`;
    } else {
      const c = Math.round(v * 100);
      if (!(c >= 100)) throw new HttpError(400, 'Enter the peso amount off (at least ₱1).');
      discount = Math.min(c, base);
      discountType = `Discount ₱${(discount / 100).toLocaleString('en-PH')} · ${reason}`;
    }
  } else if (b.discount) {
    const d = DISCOUNTS[b.discount];
    if (!d) throw new HttpError(400, 'Unknown discount.');
    const idNo = clean(b.discountId, 40);
    if (d.needsId && !idNo) throw new HttpError(400, `Enter the ${b.discount === 'senior' ? 'Senior Citizen' : 'PWD'} ID number.`);
    discount = Math.round((base * d.pct) / 100);
    discountType = d.label + (idNo ? ` · ID ${idNo}` : '');
  }
  const extra = discount; // promo code / custom / senior / PWD / staff, on the price after the deal
  discount += deal.offCents + loy.off;
  discountType = [dealsDiscountLabel(deal.applied), loy.label, discountType || ''].filter(Boolean).join(' + ') || null;
  const total = subtotal - discount;
  const t = checkTender(b.payments, total, b.tenderedCents);

  const id = crypto.randomUUID(), code = makeCode('P');
  const took = await takeStock(items, `Sale #${code}`, u.id);
  try {
    const [o] = await sql`
      INSERT INTO orders (id, code, token, name, pickup_label, pickup_at, note, items, total_cents, subtotal_cents,
                          payment_method, payment_status, payments, paid_via, paid_at, status, source, order_type,
                          discount_type, discount_cents, tendered_cents, change_cents, reference, user_id, shift_id, stock_applied, promo_code, deal_cents, deals, loyalty_phone, loyalty_earn, loyalty_used, loyalty_cents)
      VALUES (${id}, ${code}, ${crypto.randomBytes(18).toString('base64url')}, ${clean(b.name, 40) || 'Walk-in'},
              ${orderType === 'takeout' ? 'Takeout' : 'Dine-in'}, now(), ${clean(b.note, 200)}, ${JSON.stringify(items)}::jsonb,
              ${total}, ${subtotal}, ${t.method}, 'paid', ${JSON.stringify(t.payments)}::jsonb, ${t.method}, now(),
              ${b.sendToBoard === false ? 'done' : 'new'}, 'pos', ${orderType},
              ${discountType}, ${discount}, ${t.tendered}, ${t.change}, ${t.reference}, ${u.id}, ${shiftId}, ${took}, ${promoCode}, ${deal.offCents}, ${deal.applied.length ? JSON.stringify(deal.applied) : null}::jsonb,
              ${loy.phone}, ${loy.earn}, ${loy.used}, ${loy.off})
      RETURNING *`;
    if (extra) await audit(u, 'pos.discount', `#${code}`, { type: discountType, cents: extra, totalCents: total });
    res.status(201).json(staffOrder({ ...o, user_name: u.name }));
  } catch (e) {
    if (took) await returnStock({ id, items, stock_applied: true }, `Failed sale #${code}`, u.id);
    throw e;
  }
}