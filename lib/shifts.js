// Shift totals. A sale belongs to the shift of the staff member who took the
// money: POS sales, pay-at-counter orders collected at pickup, and GCash/Maya QR
// payments they confirmed. PayMongo payments (automatic) have no shift; they
// still count in the daily totals.
import { sql, batch, paymentsOf } from './db.js';

const zero = () => ({ cash: 0, gcash: 0, paymaya: 0, card: 0, qrph: 0 });

/** Totals for a list of orders (any statuses). */
export function salesTotals(orders) {
  const t = { orders: 0, items: 0, grossCents: 0, discountCents: 0, deliveryCents: 0, netCents: 0, byMethod: zero(), voids: { n: 0, cents: 0 } };
  for (const o of orders) {
    if (o.status === 'cancelled') {
      if (['voided', 'refunded'].includes(o.payment_status)) { t.voids.n++; t.voids.cents += o.total_cents; }
      continue;
    }
    if (o.payment_status !== 'paid') continue;
    t.orders++;
    t.items += o.items.reduce((a, i) => a + i.qty, 0);
    const sub = o.subtotal_cents ?? (o.total_cents - (o.delivery_fee_cents || 0) + (o.discount_cents || 0));
    t.grossCents += sub + (o.delivery_fee_cents || 0);
    t.discountCents += o.discount_cents || 0;
    t.deliveryCents += o.delivery_fee_cents || 0;
    t.netCents += o.total_cents;
    for (const p of paymentsOf(o)) t.byMethod[p.method] = (t.byMethod[p.method] || 0) + p.cents;
  }
  return t;
}

/** Everything for one shift: sales, cash in/out, expected cash in the drawer. */
export async function shiftSummary(shiftId) {
  const [[shift], orders, moves] = await batch([
    sql`SELECT s.*, u.name AS user_name, c.name AS closed_by_name FROM shifts s
        LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users c ON c.id = s.closed_by WHERE s.id = ${shiftId}`,
    sql`SELECT * FROM orders WHERE shift_id = ${shiftId}`,
    sql`SELECT m.*, u.name AS user_name FROM cash_moves m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.shift_id = ${shiftId} ORDER BY m.created_at`,
  ]);
  if (!shift) return null;
  const sales = salesTotals(orders);
  const cashIn = moves.filter((m) => m.kind === 'in').reduce((a, m) => a + m.cents, 0);
  const cashOut = moves.filter((m) => m.kind === 'out').reduce((a, m) => a + m.cents, 0);
  const expected = shift.opening_cents + sales.byMethod.cash + cashIn - cashOut;
  return {
    id: shift.id, userId: shift.user_id, staffName: shift.user_name || 'Former staff',
    openedAt: shift.opened_at, closedAt: shift.closed_at, closedBy: shift.closed_by_name || null,
    openingCents: shift.opening_cents, countedCents: shift.counted_cents, note: shift.note,
    sales, cashInCents: cashIn, cashOutCents: cashOut, expectedCashCents: expected,
    overShortCents: shift.counted_cents == null ? null : shift.counted_cents - expected,
    moves: moves.map((m) => ({ id: m.id, kind: m.kind, cents: m.cents, category: m.category, note: m.note, at: m.created_at, staffName: m.user_name })),
  };
}
