import crypto from 'node:crypto';
import { route, body, HttpError, clean, BUILD } from '../lib/http.js';
import { PICKUP_MINUTES, PAYMENT_METHODS } from '../lib/menu.js';
import { sql, batch, ensureSchema, getSettings, qrReady, qrPublic, deliveryReady, versionQuery } from '../lib/db.js';
import { loadCatalog, priceLine, makeCode, takeStock, returnStock, deliveryQuote } from '../lib/pricing.js';
import { openState, TZ } from '../lib/time.js';
import { checkCode, codeDiscount, codeLabel, publicCode, bogoReward, bogoNeed } from '../lib/promocodes.js';
import { activeDeals, applyDeals, dealsDiscountLabel } from '../lib/deals.js';
import { createCheckout, paymongoConfigured, baseUrl, syncPayment } from '../lib/paymongo.js';

// Public order endpoints (vercel.json rewrites /api/orders/:id → /api/orders?id=:id)
//   POST /api/orders                    place an order
//   GET  /api/orders?promo=CODE         check a promo code before ordering
//   GET  /api/orders/:id?token=…        live status + messages for the customer who placed it
//   POST /api/orders/:id {token, action: 'reference', reference}   paid by GCash/Maya QR
//   POST /api/orders/:id {token, action: 'message', body}          message the cashier
export default route(['GET', 'POST'], async (req, res) => {
  await ensureSchema();
  const id = req.query.id;
  if (!id) {
    if (req.method === 'GET' && req.query.promo) return res.status(200).json(publicCode(await checkCode(req.query.promo, { channel: 'online' })));
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return createOrder(req, res);
  }
  const b = req.method === 'POST' ? body(req) : {};
  const token = req.method === 'POST' ? b.token : req.query.token;
  if (typeof id !== 'string' || typeof token !== 'string' || !token) throw new HttpError(404, 'Order not found.');
  let [o] = await sql`SELECT * FROM orders WHERE id = ${id} AND token = ${token}`;
  if (!o) throw new HttpError(404, 'Order not found.');

  if (req.method === 'POST') {
    const action = b.action || (b.reference ? 'reference' : '');
    if (action === 'reference') o = await sendReference(o, b.reference);
    else if (action === 'message') await sendMessage(o, b.body);
    else throw new HttpError(400, 'Unknown action.');
  } else if (o.payment_status === 'pending') {
    try { o = await syncPayment(o); } catch (e) { console.error('payment sync failed', e.message); }
  }
  res.status(200).json(await customerView(o));
});

async function customerView(o) {
  const needQr = o.payment_method === 'qrph' && ['awaiting_proof', 'rejected'].includes(o.payment_status);
  const [msgs, [v]] = await batch([
    sql`SELECT sender, body, created_at FROM messages WHERE order_id = ${o.id} ORDER BY id DESC LIMIT 40`,
    versionQuery(),
  ]);
  return {
    id: o.id, code: o.code, status: o.status, totalCents: o.total_cents, deliveryFeeCents: o.delivery_fee_cents || 0,
    orderType: o.order_type, delivery: o.delivery ? { address: o.delivery.address, km: o.delivery.km } : null,
    pickupLabel: o.pickup_label, pickupAt: o.pickup_at, scheduledFor: o.scheduled_for || null, createdAt: o.created_at, items: o.items,
    discountCents: o.discount_cents || 0, promoCode: o.promo_code || null, dealCents: o.deal_cents || 0, deals: o.deals || [],
    paymentMethod: o.payment_method, paymentStatus: o.payment_status, reference: o.reference,
    checkoutUrl: o.payment_status === 'pending' ? o.checkout_url : null,
    qr: needQr ? qrPublic(await getSettings()) : null,
    messages: msgs.reverse().map((m) => ({ from: m.sender, body: m.body, at: m.created_at })),
    v: v?.value || '1', build: BUILD,
  };
}

async function createOrder(req, res) {
  const b = body(req);
  const settings = await getSettings();
  if (!settings.accepting) throw new HttpError(409, "We're not taking online orders right now. Please order at the counter.");

  const method = String(b.paymentMethod || 'counter');
  const pm = PAYMENT_METHODS[method];
  if (!pm) throw new HttpError(400, 'Choose how you want to pay.');
  if (pm.online && !(settings.payOnline && paymongoConfigured())) throw new HttpError(409, 'That payment option is unavailable right now. Please choose another.');
  if (method === 'counter' && !settings.payCounter) throw new HttpError(409, 'Please pay online with GCash or Maya.');
  if (method === 'qrph' && !qrReady(settings)) throw new HttpError(409, 'GCash / Maya QR payment is unavailable right now.');

  const name = clean(b.name, 40);
  if (!name) throw new HttpError(400, 'Add a name so we can call out your order.');
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Your cart is empty.');
  if (b.items.length > 30) throw new HttpError(400, 'That is a big order! Please call us for more than 30 lines.');

  // Opening hours: order now only while open; otherwise (or by choice) order ahead for a time we're open.
  const now = new Date();
  let scheduled = null;
  if (b.scheduleAt) {
    const t = new Date(b.scheduleAt);
    if (Number.isNaN(t.getTime())) throw new HttpError(400, 'Choose a time for your order.');
    if (t - now < 20 * 60_000) throw new HttpError(400, 'Order-ahead times start 20 minutes from now. Please choose a later time.');
    if (t - now > 7 * 86400_000) throw new HttpError(400, 'You can order up to 7 days ahead.');
    if (!openState(settings.hours, t).open) throw new HttpError(409, "We're closed at that time. Please choose another time.");
    scheduled = t;
  } else {
    const st = openState(settings.hours, now);
    if (!st.open) throw new HttpError(409, `We're closed right now${st.next ? `. We open ${whenLabel(st.next)}` : ''}. You can order ahead for later.`);
    if (st.until && st.until - now < 10 * 60_000) throw new HttpError(409, "We're about to close. Please order ahead for our next opening.");
  }

  const catalog = await loadCatalog();
  const items = b.items.map((l) => priceLine(l, catalog, { at: scheduled || now }));
  const subtotal = items.reduce((a, i) => a + i.unitCents * i.qty, 0);

  // Pickup or delivery
  const isDelivery = b.orderType === 'delivery';
  let delivery = null, fee = 0, pickupLabel, pickupAt;
  if (isDelivery) {
    if (!deliveryReady(settings)) throw new HttpError(409, "Delivery isn't available right now. Please choose pickup.");
    const d = b.delivery || {};
    const q = deliveryQuote(settings.delivery, Number(d.lat), Number(d.lng));
    const phone = clean(d.phone, 20).replace(/[^\d+]/g, '');
    if (!/^(\+?63|0)9\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a mobile number for the rider, like 0917 123 4567.');
    const address = clean(d.address, 200);
    if (address.length < 5) throw new HttpError(400, 'Type your full address (house no., street, barangay).');
    if (subtotal < (settings.delivery.minOrder || 0)) throw new HttpError(400, `Delivery needs a minimum order of ₱${(settings.delivery.minOrder / 100).toFixed(0)}.`);
    delivery = { lat: Number(d.lat), lng: Number(d.lng), km: q.km, address, landmark: clean(d.landmark, 120), phone };
    fee = q.feeCents;
    pickupLabel = `Delivery · ${q.km} km${scheduled ? ` · for ${whenLabel(scheduled)}` : ''}`;
    pickupAt = (scheduled || new Date(Date.now() + 40 * 60_000)).toISOString();
  } else if (scheduled) {
    pickupLabel = `Pickup ${whenLabel(scheduled)}`;
    pickupAt = scheduled.toISOString();
  } else {
    const minutes = Number(b.pickupMinutes);
    if (!(minutes in PICKUP_MINUTES)) throw new HttpError(400, 'Choose a pickup time.');
    pickupLabel = PICKUP_MINUTES[minutes];
    pickupAt = new Date(Date.now() + minutes * 60_000).toISOString();
  }

  // Buy 1 Take 1 deals (automatic, priced at the order time), then the promo code on what's left.
  // Both are on the items only (not the delivery fee), and checked again here.
  const deal = applyDeals(items, await activeDeals('online', scheduled || now));
  const afterDeal = subtotal - deal.offCents;
  let codeOff = 0, promo = null;
  if (b.promoCode) {
    promo = await checkCode(b.promoCode, { channel: 'online', subtotal: afterDeal });
    codeOff = codeDiscount(promo, afterDeal, items, deal.used);
    if (promo.kind === 'bogo' && !codeOff) throw new HttpError(409, bogoNeed(promo, bogoReward(promo.bogo, items, deal.used).need));
  }
  const discount = deal.offCents + codeOff;
  const discountType = [dealsDiscountLabel(deal.applied), promo ? `Promo ${promo.code} · ${codeLabel(promo)}` : ''].filter(Boolean).join(' + ') || null;
  const total = subtotal - discount + fee;
  const order = { id: crypto.randomUUID(), token: crypto.randomBytes(18).toString('base64url'), code: makeCode('D') };
  const payStatus = pm.online ? 'pending' : pm.manual ? 'awaiting_proof' : 'unpaid';

  const took = await takeStock(items, `Order #${order.code}`);
  try {
    await sql`INSERT INTO orders (id, code, token, name, pickup_label, pickup_at, note, items, total_cents, subtotal_cents,
                payment_method, payment_status, order_type, delivery, delivery_fee_cents, stock_applied, scheduled_for,
                discount_type, discount_cents, promo_code, deal_cents, deals)
              VALUES (${order.id}, ${order.code}, ${order.token}, ${name}, ${pickupLabel}, ${pickupAt}, ${clean(b.note, 200)},
                ${JSON.stringify(items)}::jsonb, ${total}, ${subtotal}, ${method}, ${payStatus},
                ${isDelivery ? 'delivery' : 'pickup'}, ${delivery ? JSON.stringify(delivery) : null}::jsonb, ${fee}, ${took}, ${scheduled ? scheduled.toISOString() : null},
                ${discountType}, ${discount}, ${promo?.code || null}, ${deal.offCents}, ${deal.applied.length ? JSON.stringify(deal.applied) : null}::jsonb)`;
  } catch (e) {
    if (took) await returnStock({ id: order.id, items, stock_applied: true }, `Failed order #${order.code}`);
    throw e;
  }

  let checkoutUrl = null;
  if (pm.online) {
    try {
      // PayMongo adds up the lines itself and can't take a negative "discount" line, so a discounted order is sent as one line.
      const lines = discount
        ? [{ name: `Order #${order.code} (${items.reduce((a, i) => a + i.qty, 0)} items, ${[deal.applied.length ? 'Buy 1 Take 1' : '', promo?.code].filter(Boolean).join(' + ')} −₱${(discount / 100).toLocaleString('en-PH')}${fee ? ', incl. delivery' : ''})`, qty: 1, unitCents: total, opts: '' }]
        : fee ? [...items, { name: 'Delivery fee', qty: 1, unitCents: fee, opts: '' }] : items;
      const c = await createCheckout({ order: { ...order }, items: lines, method, baseUrl: baseUrl(req) });
      checkoutUrl = c.url;
      await sql`UPDATE orders SET checkout_id = ${c.id}, checkout_url = ${c.url} WHERE id = ${order.id}`;
    } catch (e) {
      const [x] = await sql`UPDATE orders SET payment_status = 'failed', status = 'cancelled', updated_at = now() WHERE id = ${order.id} RETURNING *`;
      if (x) await returnStock(x, `Failed payment #${order.code}`);
      throw new HttpError(502, `${pm.label} payment couldn't start. Please try again${settings.payCounter ? ' or choose another way to pay' : ''}.`);
    }
  }

  res.status(201).json({
    id: order.id, token: order.token, code: order.code, status: 'new',
    paymentMethod: method, paymentStatus: payStatus, checkoutUrl,
    qr: method === 'qrph' ? qrPublic(settings) : null,
    totalCents: total, deliveryFeeCents: fee, discountCents: discount, promoCode: promo?.code || null, dealCents: deal.offCents, deals: deal.applied, orderType: isDelivery ? 'delivery' : 'pickup',
    pickupLabel, pickupAt, scheduledFor: scheduled ? scheduled.toISOString() : null, createdAt: new Date().toISOString(), items, messages: [],
  });
}

/** "Tue 7:30 PM" in café time (or "today 7:30 PM" / "tomorrow 9:00 AM"). */
function whenLabel(d) {
  const f = (o) => new Intl.DateTimeFormat('en-PH', { timeZone: TZ, ...o }).format(d);
  const day = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(x);
  const today = day(new Date()), tomorrow = day(new Date(Date.now() + 86400_000));
  const dd = day(d) === today ? 'today' : day(d) === tomorrow ? 'tomorrow' : f({ weekday: 'short', month: 'short', day: 'numeric' });
  return `${dd} ${f({ hour: 'numeric', minute: '2-digit' })}`;
}

async function sendReference(o, reference) {
  if (o.payment_method !== 'qrph') throw new HttpError(400, 'This order is not paid by QR.');
  if (!['awaiting_proof', 'submitted', 'rejected'].includes(o.payment_status) || o.status === 'done') throw new HttpError(409, 'This payment is already confirmed.');
  const ref = clean(reference, 40).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9-]{6,30}$/.test(ref)) throw new HttpError(400, 'Enter the reference number from your GCash or Maya receipt (letters and numbers only).');
  if (o.status === 'cancelled' && !o.stock_applied) {
    const items = o.items;
    const took = await takeStock(items, `Re-opened #${o.code}`);
    await sql`UPDATE orders SET stock_applied = ${took} WHERE id = ${o.id}`;
  }
  const [x] = await sql`UPDATE orders SET reference = ${ref}, payment_status = 'submitted',
                    status = CASE WHEN status = 'cancelled' THEN 'new' ELSE status END, updated_at = now()
                  WHERE id = ${o.id} RETURNING *`;
  return x;
}

async function sendMessage(o, text) {
  const msg = clean(text, 300);
  if (!msg) throw new HttpError(400, 'Type a message first.');
  const recentlyDone = o.status === 'done' && Date.now() - new Date(o.updated_at) < 3 * 3600e3;
  if (o.status === 'cancelled' || (o.status === 'done' && !recentlyDone)) throw new HttpError(409, 'This order is closed. Please call or message us on Facebook.');
  const [[c], [last]] = await batch([
    sql`SELECT COUNT(*)::int AS n FROM messages WHERE order_id = ${o.id} AND sender = 'customer'`,
    sql`SELECT created_at FROM messages WHERE order_id = ${o.id} AND sender = 'customer' ORDER BY id DESC LIMIT 1`,
  ]);
  if (c.n >= 30) throw new HttpError(429, 'Message limit reached for this order. Please call us.');
  if (last && Date.now() - new Date(last.created_at) < 2000) throw new HttpError(429, 'Please wait a moment before sending again.');
  await sql`INSERT INTO messages (order_id, sender, body) VALUES (${o.id}, 'customer', ${msg})`;
}