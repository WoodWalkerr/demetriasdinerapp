import crypto from 'node:crypto';
import { body, HttpError, clean } from '../http.js';
import { sql, staffOrder, audit } from '../db.js';
import { requireStaff, requireShift } from '../auth.js';
import { DISCOUNTS } from '../menu.js';
import { loadCatalog, priceLine, makeCode, takeStock, returnStock, checkTender } from '../pricing.js';

// POST /api/staff/pos — record an in-store sale.
// { items:[{id, qty, opts, addons}], name?, orderType: 'dine-in'|'takeout',
//   payments:[{method: cash|gcash|paymaya|card, cents, ref?}], tenderedCents?,
//   discount?: senior|pwd|staff, discountId?, note?, sendToBoard }
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
  let discount = 0, discountType = null;
  if (b.discount) {
    const d = DISCOUNTS[b.discount];
    if (!d) throw new HttpError(400, 'Unknown discount.');
    const idNo = clean(b.discountId, 40);
    if (d.needsId && !idNo) throw new HttpError(400, `Enter the ${b.discount === 'senior' ? 'Senior Citizen' : 'PWD'} ID number.`);
    discount = Math.round((subtotal * d.pct) / 100);
    discountType = d.label + (idNo ? ` · ID ${idNo}` : '');
  }
  const total = subtotal - discount;
  const t = checkTender(b.payments, total, b.tenderedCents);

  const id = crypto.randomUUID(), code = makeCode('P');
  const took = await takeStock(items, `Sale #${code}`, u.id);
  try {
    const [o] = await sql`
      INSERT INTO orders (id, code, token, name, pickup_label, pickup_at, note, items, total_cents, subtotal_cents,
                          payment_method, payment_status, payments, paid_via, paid_at, status, source, order_type,
                          discount_type, discount_cents, tendered_cents, change_cents, reference, user_id, shift_id, stock_applied)
      VALUES (${id}, ${code}, ${crypto.randomBytes(18).toString('base64url')}, ${clean(b.name, 40) || 'Walk-in'},
              ${orderType === 'takeout' ? 'Takeout' : 'Dine-in'}, now(), ${clean(b.note, 200)}, ${JSON.stringify(items)}::jsonb,
              ${total}, ${subtotal}, ${t.method}, 'paid', ${JSON.stringify(t.payments)}::jsonb, ${t.method}, now(),
              ${b.sendToBoard === false ? 'done' : 'new'}, 'pos', ${orderType},
              ${discountType}, ${discount}, ${t.tendered}, ${t.change}, ${t.reference}, ${u.id}, ${shiftId}, ${took})
      RETURNING *`;
    if (discount) await audit(u, 'pos.discount', `#${code}`, { type: discountType, cents: discount, totalCents: total });
    res.status(201).json(staffOrder({ ...o, user_name: u.name }));
  } catch (e) {
    if (took) await returnStock({ id, items, stock_applied: true }, `Failed sale #${code}`, u.id);
    throw e;
  }
}
