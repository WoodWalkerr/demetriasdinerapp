import { route, BUILD } from '../lib/http.js';
import { CURRENCY, CATEGORIES } from '../lib/menu.js';
import { ensureSchema, sql, batch, settingsQuery, versionQuery, shapeSettings, qrReady, deliveryReady } from '../lib/db.js';
import { productsQuery, addonsQuery, publicProduct, publicAddon, publicPromo } from '../lib/pricing.js';
import { openState, upcomingWindows, TZ } from '../lib/time.js';
import { paymongoConfigured } from '../lib/paymongo.js';
import { popupCodes, popupQuery } from '../lib/promocodes.js';
import { dealsQuery, dealsFor, publicDeal } from '../lib/deals.js';
import { publicLoyalty } from '../lib/loyalty.js';
import { publicNews } from '../lib/newsletter.js';
import { upsellFeed } from '../lib/upsell.js';

// GET /api/menu         → products, add-ons, payment and delivery options (one database round trip)
// GET /api/menu?sync=1  → just { v, build }: tiny check pages make every few seconds to stay up to date
// GET /api/menu?img=<product id>&v=<n> → that product's photo (cached for a year; a new upload changes v)
// Both are cached at Vercel's edge (not in browsers) for a few seconds, so busy hours stay fast.
export default route(['GET'], async (req, res) => {
  // Browsers always ask for the latest copy; only Vercel's edge keeps a copy for a few seconds,
  // so busy hours stay fast while updates still show up within seconds.
  res.setHeader('Cache-Control', 'no-cache');
  await ensureSchema();

  if (req.query.img) {
    const [img] = await sql`SELECT mime, data, ver FROM product_images WHERE product_id = ${String(req.query.img)}`;
    if (!img) { res.setHeader('Cache-Control', 'public, max-age=60'); return res.status(404).json({ error: 'No photo.' }); }
    const immutable = String(req.query.v) === String(img.ver);
    res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
    res.setHeader('Content-Type', img.mime);
    return res.status(200).send(Buffer.from(img.data, 'base64'));
  }

  if (req.query.sync) {
    res.setHeader('Vercel-CDN-Cache-Control', 'max-age=2');
    const [[v]] = await batch([versionQuery()]);
    return res.status(200).json({ v: v?.value || '1', build: BUILD });
  }

  res.setHeader('Vercel-CDN-Cache-Control', 'max-age=3, stale-while-revalidate=20');
  const [[row], products, addons, [v], featured, dealRows] = await batch([settingsQuery(), productsQuery(), addonsQuery(), versionQuery(), popupQuery(), dealsQuery()]);
  const s = shapeSettings(row);
  const upsell = await upsellFeed(s.upsell);
  const online = s.payOnline && paymongoConfigured();
  const qr = qrReady(s);
  const d = s.delivery;
  const now = new Date();
  const st = openState(s.hours, now);
  res.status(200).json({
    v: v?.value || '1', build: BUILD, currency: CURRENCY, categories: CATEGORIES,
    accepting: s.accepting && ((online && !qr) || s.payCounter || qr),
    // With your own QR switched on, GCash/Maya go to your QR instead of PayMongo. (No card payments.)
    qrWallets: qr ? [s.qr.image && 'gcash', s.qr.maya?.image && 'maya'].filter(Boolean) : [], // which of your QRs are uploaded
    payments: { qrph: qr, gcash: online && !qr, paymaya: online && !qr, counter: s.payCounter },
    delivery: deliveryReady(s)
      ? { enabled: true, lat: d.lat, lng: d.lng, maxKm: d.maxKm, tiers: d.tiers, minOrder: d.minOrder || 0, eta: d.eta }
      : { enabled: false },
    // Opening hours: is it open now, and the opening times for the next week (for "order ahead").
    hours: {
      tz: TZ, enabled: s.hours.enabled !== false, open: st.open, until: st.until || null, next: st.next || null, note: st.note || '',
      days: s.hours.days,
      windows: upcomingWindows(s.hours, now, 8).map((w) => ({ date: w.date, start: w.start, end: w.end, note: w.note })),
      closedDays: (s.hours.special || []).filter((x) => x.closed).map((x) => ({ date: x.date, note: x.note })),
    },
    promos: s.promos.filter((p) => p.active).map(publicPromo),
    // Promo codes the shop advertises in the website pop-up (Staff → Settings → Promo codes → Pop-up).
    featured: popupCodes(featured),
    // Buy 1 Take 1 deals for online orders (Staff → Settings → Buy 1 Take 1). The browser checks days/dates for the order time.
    deals: dealsFor(dealRows, 'online').map(publicDeal),
    loyalty: publicLoyalty(s.loyalty), // stamp card rules (no customer data)
    newsletter: publicNews(s.newsletter), // sign-up pop-up text (the welcome code is only given after signing up)
    upsell,                             // "Add something?" cart suggestions
    items: products.map(publicProduct),
    addons: addons.filter((a) => a.active).map(publicAddon),
  });
});