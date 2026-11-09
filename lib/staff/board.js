import { body, HttpError, clean, BUILD } from '../http.js';
import { sql, batch, staffOrder, versionQuery, audit } from '../db.js';
import { requireStaff, requireShift } from '../auth.js';
import { refund, expireStalePending, syncPayment } from '../paymongo.js';
import { returnStock, checkTender } from '../pricing.js';

import { BTZ as TZ } from '../time.js'; // business day (4 AM → 4 AM)
const NEXT = {
  new: ['making', 'cancelled'],
  making: ['ready', 'cancelled'],
  ready: ['done', 'delivering', 'cancelled'],
  delivering: ['done', 'cancelled'],
  done: [], cancelled: [],
};
const viaPayMongo = (o) => o.source !== 'pos' && ['gcash', 'paymaya', 'card'].includes(o.payment_method) && o.payment_status === 'paid' && o.payment_id;

// GET   /api/staff/orders → board: open orders, recently finished, today's numbers, message threads
// PATCH /api/staff/orders {id, status, payments?, tenderedCents?}
export async function orders(req, res) {
  const u = await requireStaff(req, 'pos');
  if (req.method === 'PATCH') return res.status(200).json(await changeStatus(u, body(req)));

  await expireStalePending().catch((e) => console.error('expire failed', e.message));
  const [open, finished, [awaiting], [today], threads, [v]] = await batch([
    sql`SELECT o.*, u.name AS user_name,
          (SELECT COUNT(*) FROM messages m WHERE m.order_id = o.id AND m.sender = 'customer'
             AND m.created_at > COALESCE(o.staff_read_at, 'epoch'::timestamptz))::int AS unread,
          (SELECT body FROM messages m WHERE m.order_id = o.id ORDER BY m.id DESC LIMIT 1) AS last_msg
        FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.status IN ('new','making','ready','delivering')
          AND (o.payment_method = 'counter' OR o.payment_status IN ('paid','refunded','voided') OR (o.payment_method = 'qrph' AND o.payment_status = 'submitted'))
        ORDER BY o.pickup_at ASC LIMIT 200`,
    sql`SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.status IN ('done','cancelled')
          AND (o.payment_method = 'counter' OR o.payment_status IN ('paid','refunded','voided','rejected') OR o.source = 'pos')
        ORDER BY o.updated_at DESC LIMIT 12`,
    sql`SELECT COUNT(*)::int AS n FROM orders WHERE status <> 'cancelled' AND payment_status IN ('pending','awaiting_proof')`,
    sql`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total_cents),0)::int AS sales_cents,
          COALESCE(SUM((SELECT SUM((i->>'qty')::int) FROM jsonb_array_elements(items) i)),0)::int AS items
        FROM orders WHERE status <> 'cancelled' AND payment_status = 'paid'
          AND created_at >= (date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})`,
    sql`SELECT o.id, o.code, o.name, o.status, o.order_type,
          (SELECT COUNT(*) FROM messages m WHERE m.order_id = o.id AND m.sender = 'customer'
             AND m.created_at > COALESCE(o.staff_read_at, 'epoch'::timestamptz))::int AS unread,
          (SELECT body FROM messages m WHERE m.order_id = o.id ORDER BY m.id DESC LIMIT 1) AS last_msg,
          (SELECT MAX(created_at) FROM messages m WHERE m.order_id = o.id) AS last_at
        FROM orders o WHERE EXISTS (SELECT 1 FROM messages m WHERE m.order_id = o.id AND m.created_at > now() - interval '12 hours')
        ORDER BY last_at DESC LIMIT 30`,
    versionQuery(),
  ]);
  res.status(200).json({
    open: open.map(staffOrder), finished: finished.map(staffOrder), today, awaitingPayment: awaiting.n,
    threads: threads.map((t) => ({ id: t.id, code: t.code, name: t.name, status: t.status, orderType: t.order_type, unread: t.unread, lastMessage: t.last_msg, lastAt: t.last_at })),
    shiftOpen: !!u.shift_id, v: v?.value, build: BUILD, serverTime: new Date().toISOString(),
  });
}

async function changeStatus(u, b) {
  const [cur] = await sql`SELECT * FROM orders WHERE id = ${String(b.id)}`;
  if (!cur) throw new HttpError(404, 'Order not found.');
  const status = b.status;
  if (!NEXT[cur.status]?.includes(status)) throw new HttpError(409, `Can't move this order from ${cur.status} to ${status}.`);
  if (status === 'delivering' && cur.order_type !== 'delivery') throw new HttpError(400, 'Only delivery orders go out for delivery.');
  if (cur.payment_method === 'qrph' && cur.payment_status !== 'paid' && status !== 'cancelled')
    throw new HttpError(409, 'Confirm the GCash/Maya payment first (Payment received).');

  // Cancelling: paid orders need the "void" permission; PayMongo payments are refunded automatically.
  if (status === 'cancelled') {
    const paid = cur.payment_status === 'paid';
    if (paid && !u.can('void')) throw new HttpError(403, 'Only staff allowed to void orders can cancel a paid order.');
    let refundId = null;
    if (viaPayMongo(cur)) refundId = await refund(cur);
    const payStatus = refundId ? 'refunded' : paid ? 'voided' : cur.payment_method === 'qrph' ? 'rejected' : cur.payment_status;
    const [o] = await sql`UPDATE orders SET status = 'cancelled', payment_status = ${payStatus},
        refund_id = COALESCE(${refundId}, refund_id), updated_at = now()
      WHERE id = ${cur.id} AND status = ${cur.status} RETURNING *`;
    if (!o) throw new HttpError(409, 'Someone else just updated this order. Refreshing.');
    await returnStock(o, `Cancelled #${o.code}`, u.id);
    await audit(u, paid ? (refundId ? 'order.refund' : 'order.void') : 'order.cancel', `#${o.code}`, { totalCents: o.total_cents, customer: o.name, reason: clean(b.reason, 120) || undefined });
    return staffOrder(o);
  }

  // Handing over a pay-at-counter order = taking the money (can be split).
  if (status === 'done' && cur.payment_method === 'counter' && cur.payment_status !== 'paid') {
    const shiftId = requireShift(u);
    const t = checkTender(b.payments, cur.total_cents, b.tenderedCents);
    const [o] = await sql`UPDATE orders SET status = 'done', payment_status = 'paid', payments = ${JSON.stringify(t.payments)}::jsonb,
        paid_via = ${t.method}, paid_at = now(), tendered_cents = ${t.tendered}, change_cents = ${t.change},
        reference = COALESCE(${t.reference}, reference), user_id = ${u.id}, shift_id = ${shiftId}, updated_at = now()
      WHERE id = ${cur.id} AND status = ${cur.status} RETURNING *`;
    if (!o) throw new HttpError(409, 'Someone else just updated this order. Refreshing.');
    return staffOrder(o);
  }

  const [o] = await sql`UPDATE orders SET status = ${status}, updated_at = now()
    WHERE id = ${cur.id} AND status = ${cur.status} RETURNING *`;
  if (!o) throw new HttpError(409, 'Someone else just updated this order. Refreshing.');
  return staffOrder(o);
}

// POST /api/staff/payment {id, action: 'verify' | 'reject' | 'check'}
//   verify → the GCash/Maya QR money with this reference arrived (counts in your shift)
//   reject → no matching payment; the customer is asked to send the right reference
//   check  → ask PayMongo whether an online order was paid
export async function payment(req, res) {
  const u = await requireStaff(req, 'pos');
  const { id, action } = body(req);
  let [o] = await sql`SELECT * FROM orders WHERE id = ${String(id)}`;
  if (!o) throw new HttpError(404, 'Order not found.');
  if (action === 'check') {
    if (!['gcash', 'paymaya', 'card'].includes(o.payment_method)) throw new HttpError(400, 'Only PayMongo payments can be checked.');
    o = await syncPayment(o);
  } else if (action === 'verify') {
    const shiftId = requireShift(u);
    if (o.payment_method !== 'qrph') throw new HttpError(400, 'Only QR payments are confirmed by staff.');
    if (o.payment_status !== 'paid') {
      [o] = await sql`UPDATE orders SET payment_status = 'paid', paid_via = 'qrph', paid_at = now(),
          payments = jsonb_build_array(jsonb_build_object('method', 'qrph', 'cents', total_cents, 'ref', reference)),
          user_id = ${u.id}, shift_id = ${shiftId},
          status = CASE WHEN status = 'cancelled' THEN 'new' ELSE status END, updated_at = now()
        WHERE id = ${o.id} RETURNING *`;
      await audit(u, 'payment.confirm', `#${o.code}`, { totalCents: o.total_cents, reference: o.reference });
    }
  } else if (action === 'reject') {
    if (o.payment_method !== 'qrph' || o.payment_status === 'paid') throw new HttpError(400, 'Only unconfirmed QR payments can be rejected.');
    [o] = await sql`UPDATE orders SET payment_status = 'rejected', status = 'cancelled', updated_at = now() WHERE id = ${o.id} RETURNING *`;
    await returnStock(o, `Payment not received #${o.code}`, u.id);
    await audit(u, 'payment.reject', `#${o.code}`, { totalCents: o.total_cents, reference: o.reference });
  } else throw new HttpError(400, 'Unknown action.');
  res.status(200).json(staffOrder(o));
}

// GET  /api/staff/messages?order=<id>  → the conversation (marks it read)
// POST /api/staff/messages {orderId, body}
export async function messages(req, res) {
  const u = await requireStaff(req, 'pos');
  const orderId = String(req.method === 'GET' ? req.query.order : body(req).orderId || '');
  const [o] = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
  if (!o) throw new HttpError(404, 'Order not found.');
  if (req.method === 'POST') {
    const text = clean(body(req).body, 300);
    if (!text) throw new HttpError(400, 'Type a reply first.');
    await sql`INSERT INTO messages (order_id, sender, user_id, body) VALUES (${o.id}, 'staff', ${u.id}, ${text})`;
  }
  const [msgs] = await batch([
    sql`SELECT m.sender, m.body, m.created_at, us.name AS staff_name FROM messages m LEFT JOIN users us ON us.id = m.user_id
        WHERE m.order_id = ${o.id} ORDER BY m.id ASC LIMIT 100`,
    sql`UPDATE orders SET staff_read_at = now() WHERE id = ${o.id}`,
  ]);
  res.status(200).json({
    order: staffOrder(o),
    messages: msgs.map((m) => ({ from: m.sender, body: m.body, at: m.created_at, staffName: m.staff_name })),
  });
}
