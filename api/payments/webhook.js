import { sql, ensureSchema } from '../../lib/db.js';
import { verifyWebhook, markPaid } from '../../lib/paymongo.js';

// POST /api/payments/webhook  ← PayMongo calls this when a checkout is paid.
// Register it in the PayMongo dashboard (Developers → Webhooks) for the event
// "checkout_session.payment.paid", then put its secret in PAYMONGO_WEBHOOK_SECRET.

async function rawBody(req) {
  // Read the untouched bytes; the signature is computed over them exactly.
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let raw;
  try { raw = await rawBody(req); } catch { return res.status(400).json({ error: 'Unreadable body' }); }
  if (!verifyWebhook(raw, req.headers['paymongo-signature'])) return res.status(401).json({ error: 'Bad signature' });

  try {
    const event = JSON.parse(raw).data?.attributes;
    if (event?.type === 'checkout_session.payment.paid') {
      await ensureSchema();
      const session = event.data;
      const orderId = session?.attributes?.metadata?.order_id;
      const payment = (session?.attributes?.payments || []).find((p) => p.attributes?.status === 'paid')
        || session?.attributes?.payments?.[0];
      const [o] = orderId
        ? await sql`SELECT id FROM orders WHERE id = ${orderId}`
        : await sql`SELECT id FROM orders WHERE checkout_id = ${session?.id || ''}`;
      if (o) await markPaid(o.id, payment);
      else console.warn('webhook: order not found for session', session?.id);
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('webhook error', e);
    return res.status(500).json({ error: 'Webhook processing failed' }); // PayMongo retries
  }
}
