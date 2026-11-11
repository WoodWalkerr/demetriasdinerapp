// PayMongo integration: GCash, Maya and cards through one Checkout API.
// Docs: https://developers.paymongo.com/docs/checkout-implementation
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { sql } from './db.js';
import { returnStock } from './pricing.js';

const API = process.env.PAYMONGO_API_BASE || 'https://api.paymongo.com/v1';
const KEY = process.env.PAYMONGO_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || '';

export const paymongoConfigured = () => KEY.startsWith('sk_');
export const paymongoMode = () => (KEY.startsWith('sk_live_') ? 'live' : KEY.startsWith('sk_test_') ? 'test' : 'off');
export const webhookConfigured = () => !!WEBHOOK_SECRET;

async function pm(path, { method = 'GET', body } = {}) {
  if (!paymongoConfigured()) throw new HttpError(503, 'Online payment is not set up yet.');
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(KEY + ':').toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data?.errors?.map((e) => e.detail).join('; ') || r.statusText;
    console.error('PayMongo error', r.status, detail);
    throw new HttpError(502, `Payment provider error: ${detail}`);
  }
  return data.data;
}

/** Creates a hosted checkout page for one order. Returns { id, url }. */
export async function createCheckout({ order, items, method, baseUrl }) {
  const back = `${baseUrl}/?order=${encodeURIComponent(order.id)}&t=${encodeURIComponent(order.token)}`;
  const session = await pm('/checkout_sessions', {
    method: 'POST',
    body: {
      data: {
        attributes: {
          line_items: items.map((i) => ({
            name: (i.name + (i.opts ? ` (${i.opts})` : '')).slice(0, 255),
            quantity: i.qty,
            amount: i.unitCents,
            currency: 'PHP',
          })),
          payment_method_types: [method], // 'gcash' | 'paymaya'
          description: `Demetria's Diner order #${order.code}`,
          reference_number: order.code,
          success_url: back + '&paid=1',
          cancel_url: back + '&cancelled=1',
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          metadata: { order_id: order.id, order_code: order.code },
        },
      },
    },
  });
  return { id: session.id, url: session.attributes.checkout_url };
}

/** Records a successful payment on an order (idempotent). */
export async function markPaid(orderId, payment) {
  const via = payment?.attributes?.source?.type || null;
  const [o] = await sql`UPDATE orders
      SET payment_status = 'paid', payment_id = ${payment?.id || null}, paid_via = ${via},
          payments = jsonb_build_array(jsonb_build_object('method', payment_method, 'cents', total_cents)),
          paid_at = COALESCE(paid_at, now()), updated_at = now(),
          status = CASE WHEN status = 'cancelled' AND payment_status = 'expired' THEN 'new' ELSE status END
      WHERE id = ${orderId} AND payment_status IN ('pending', 'expired', 'failed')
      RETURNING *`;
  return o;
}

/** Asks PayMongo whether a pending order has been paid (fallback for missed webhooks). */
export async function syncPayment(order) {
  if (!order?.checkout_id || !['pending', 'expired', 'failed'].includes(order.payment_status)) return order;
  const s = await pm(`/checkout_sessions/${encodeURIComponent(order.checkout_id)}`);
  const paid = (s.attributes.payments || []).find((p) => p.attributes?.status === 'paid');
  if (paid) return (await markPaid(order.id, paid)) || order;
  return order;
}

/** Full refund of a paid online order. */
export async function refund(order, reason = 'requested_by_customer') {
  if (!order.payment_id) throw new HttpError(409, 'No payment on record to refund.');
  const r = await pm('/refunds', {
    method: 'POST',
    body: { data: { attributes: { amount: order.total_cents, payment_id: order.payment_id, reason, notes: `Order #${order.code}` } } },
  });
  return r.id;
}

/**
 * Verifies the Paymongo-Signature header: "t=<ts>,te=<test sig>,li=<live sig>".
 * Signature = HMAC-SHA256(webhook secret, `${t}.${rawBody}`), hex.
 */
export function verifyWebhook(rawBody, header) {
  if (!WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.trim().split('=')));
  if (!parts.t) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 60 * 10) return false; // 10 min replay window
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${parts.t}.${rawBody}`).digest('hex');
  const given = paymongoMode() === 'live' ? parts.li : parts.te;
  if (!given || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Public base URL of this deployment, for PayMongo redirects. */
export function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host?.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Online orders left unpaid for 45 min are expired so they never reach the
 * board. Checks PayMongo first so a paid order with a missed webhook is kept.
 */
export async function expireStalePending() {
  // Online orders nobody paid for within 45 minutes are cancelled and their stock returned.
  const stale = await sql`SELECT * FROM orders
    WHERE status <> 'cancelled' AND payment_status IN ('pending', 'awaiting_proof')
      AND created_at < now() - interval '45 minutes' LIMIT 10`;
  for (const o of stale) {
    if (o.payment_status === 'pending') {
      try {
        const after = await syncPayment(o);
        if (after.payment_status === 'paid') continue;
      } catch (e) { console.error('sync before expiry failed', o.id, e.message); continue; }
    }
    const [x] = await sql`UPDATE orders SET payment_status = 'expired', status = 'cancelled', updated_at = now()
              WHERE id = ${o.id} AND payment_status IN ('pending', 'awaiting_proof') RETURNING *`;
    if (x) await returnStock(x, `Expired #${x.code}`);
  }
}