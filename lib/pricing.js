// Catalog, prices, add-ons, stock, delivery fees and split payments.
// Everything a customer or cashier is charged is calculated here, on the server.
import crypto from 'node:crypto';
import { HttpError, clean } from './http.js';
import { sql, batch, bumpVersion } from './db.js';
import { SWEETNESS, ICE, kindOf, addonGroupsFor, TENDER_METHODS } from './menu.js';
import { bestPromo } from './time.js';

const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY3469';
/** Short order code: D… for online orders, P… for POS sales. */
export const makeCode = (prefix = 'D') => prefix + Array.from(crypto.randomBytes(3), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
export { clean };

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export const productsQuery = () => sql`SELECT * FROM products WHERE NOT deleted ORDER BY sort, name`;
export const addonsQuery = () => sql`SELECT * FROM addons WHERE NOT deleted ORDER BY grp, sort, name`;

export function makeCatalog(products, addons, promos = []) {
  return {
    products, addons, promos,
    byId: Object.fromEntries(products.map((p) => [p.id, p])),
    addonById: Object.fromEntries(addons.map((a) => [a.id, a])),
  };
}
export async function loadCatalog() {
  const [products, addons, [s]] = await batch([productsQuery(), addonsQuery(), sql`SELECT promos FROM settings WHERE id = 1`]);
  return makeCatalog(products, addons, s?.promos || []);
}

export const isSoldOut = (p) => !p.available || (p.stock != null && p.stock <= 0);

/** What customers see. Stock numbers are shown only when running low. */
export const publicProduct = (p) => ({
  id: p.id, cat: p.cat, name: p.name, price: p.price, hot: p.hot, sort: p.sort,
  img: p.photo_ver ? photoUrl(p) : null,
  soldOut: isSoldOut(p), left: p.stock != null && p.stock > 0 && p.stock <= p.low_stock ? p.stock : null,
});
/** Photos are served by /api/menu?img=… and cached for a year; the version changes when a new photo is uploaded. */
export const photoUrl = (p) => `/api/menu?img=${encodeURIComponent(p.id)}&v=${p.photo_ver}`;
/** Promos customers can see (the browser shows the happy-hour price; the server re-checks it). */
export const publicPromo = (p) => ({ id: p.id, name: p.name, pct: p.pct, cats: p.cats, icedOnly: p.icedOnly, days: p.days, from: p.from, to: p.to });
export const publicAddon = (a) => ({ id: a.id, grp: a.grp, name: a.name, price: a.price });

// ---------------------------------------------------------------------------
// One cart line → price. Never trusts prices from the browser.
// ---------------------------------------------------------------------------
// `at` = when the order is for (now, or the scheduled pickup time): happy-hour prices follow that time.
export function priceLine(line, cat, { staff = false, at = new Date() } = {}) {
  const item = cat.byId[line?.id];
  if (!item) throw new HttpError(400, 'One of the items is no longer on the menu. Please refresh.');
  if (item.price == null) throw new HttpError(400, `${item.name} has no price yet. Set it in Products.`);
  if (!staff && !item.available) throw new HttpError(409, `Sorry, ${item.name} is sold out.`);
  const qty = Number(line.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new HttpError(400, 'Quantities must be between 1 and 50.');

  const promo = bestPromo(cat.promos, item, kindOf(item.cat), at);
  let unit = item.price - (promo?.offCents || 0);
  let unitCost = item.cost; // null when the product's cost isn't set yet
  const labels = [];
  if (kindOf(item.cat) === 'drink') {
    const o = line.opts || {};
    const sweet = Number(o.sweet ?? 75);
    if (!SWEETNESS.includes(sweet)) throw new HttpError(400, 'Invalid sweetness.');
    labels.push(`${sweet}% sweet`);
    if (!item.hot) {
      const ice = o.ice ?? 'Regular ice';
      if (!ICE.includes(ice)) throw new HttpError(400, 'Invalid ice level.');
      labels.push(ice);
    }
  }
  const allowed = addonGroupsFor(item.cat);
  const addons = [];
  for (const id of [...new Set(Array.isArray(line.addons) ? line.addons : [])].slice(0, 15)) {
    const a = cat.addonById[id];
    if (!a || !a.active) throw new HttpError(409, 'An add-on you picked is no longer available. Please check your order.');
    if (!allowed.includes(a.grp)) throw new HttpError(400, `${a.name} can't be added to ${item.name}.`);
    unit += a.price;
    if (unitCost != null) unitCost += a.cost || 0;
    addons.push({ id: a.id, name: a.name, cents: a.price });
  }
  return {
    id: item.id, name: item.name, cat: item.cat, qty, unitCents: unit, unitCostCents: unitCost, opts: labels.join(' · '), addons,
    ...(promo ? { promo: { id: promo.promo.id, name: promo.promo.name, pct: promo.promo.pct, offCents: promo.offCents } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Stock: taken when an order is placed / a sale is rung up, returned on cancel.
// Items with stock = NULL aren't tracked.
// ---------------------------------------------------------------------------
const aggregate = (items) => {
  const m = {};
  for (const i of items) m[i.id] = (m[i.id] || 0) + i.qty;
  return JSON.stringify(Object.entries(m).map(([id, q]) => ({ id, q })));
};

export async function takeStock(items, reason, userId = null) {
  const want = aggregate(items);
  const [r] = await sql`
    WITH want AS (SELECT * FROM jsonb_to_recordset(${want}::jsonb) AS x(id text, q int)),
    short AS (SELECT p.name, p.stock FROM want w JOIN products p ON p.id = w.id
              WHERE p.stock IS NOT NULL AND p.stock < w.q),
    upd AS (UPDATE products p SET stock = p.stock - w.q, updated_at = now() FROM want w
            WHERE p.id = w.id AND p.stock IS NOT NULL AND p.stock >= w.q AND NOT EXISTS (SELECT 1 FROM short)
            RETURNING p.id, p.stock, w.q),
    log AS (INSERT INTO stock_log (product_id, user_id, delta, stock_after, reason)
            SELECT id, ${userId}::text, -q, stock, ${reason}::text FROM upd RETURNING 1)
    SELECT (SELECT json_agg(json_build_object('name', name, 'stock', stock)) FROM short) AS short,
           (SELECT COUNT(*) FROM upd)::int AS n`;
  if (r.short) {
    const s = r.short[0];
    throw new HttpError(409, s.stock > 0 ? `Only ${s.stock} ${s.name} left. Please lower the quantity.` : `Sorry, ${s.name} just sold out.`);
  }
  if (r.n > 0) await bumpVersion();
  return r.n > 0;
}

export async function returnStock(order, reason, userId = null) {
  if (!order.stock_applied) return;
  const want = aggregate(order.items);
  const [r] = await sql`
    WITH want AS (SELECT * FROM jsonb_to_recordset(${want}::jsonb) AS x(id text, q int)),
    upd AS (UPDATE products p SET stock = p.stock + w.q, updated_at = now() FROM want w
            WHERE p.id = w.id AND p.stock IS NOT NULL RETURNING p.id, p.stock, w.q),
    log AS (INSERT INTO stock_log (product_id, user_id, delta, stock_after, reason)
            SELECT id, ${userId}::text, q, stock, ${reason}::text FROM upd RETURNING 1),
    flag AS (UPDATE orders SET stock_applied = FALSE WHERE id = ${order.id} RETURNING 1)
    SELECT (SELECT COUNT(*) FROM upd)::int AS n`;
  if (r.n > 0) await bumpVersion();
}

// ---------------------------------------------------------------------------
// Delivery fee from straight-line distance to the store.
// ---------------------------------------------------------------------------
export function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function deliveryQuote(cfg, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Drop a pin on the map for your delivery address.');
  const km = Math.round(distanceKm({ lat: cfg.lat, lng: cfg.lng }, { lat, lng }) * 10) / 10;
  const tiers = [...(cfg.tiers || [])].sort((a, b) => a.upToKm - b.upToKm);
  const tier = tiers.find((t) => km <= t.upToKm);
  if (km > cfg.maxKm || !tier) throw new HttpError(409, `Sorry, that's ${km} km away. We deliver up to ${cfg.maxKm} km.`);
  return { km, feeCents: tier.fee };
}

// ---------------------------------------------------------------------------
// Split payments taken by the cashier: [{method, cents, ref?}] must add up to the total.
// Cash lines can be paid with a bigger bill: tenderedCents → change.
// ---------------------------------------------------------------------------
export function checkTender(lines, totalCents, tenderedCents) {
  if (!Array.isArray(lines) || !lines.length) throw new HttpError(400, 'Add how the customer paid.');
  if (lines.length > 6) throw new HttpError(400, 'Up to 6 payment parts per bill.');
  const payments = lines.map((l) => {
    if (!TENDER_METHODS[l?.method]) throw new HttpError(400, 'Choose Cash, GCash or Maya for each part.');
    const cents = Number(l.cents);
    if (!Number.isInteger(cents) || cents <= 0) throw new HttpError(400, 'Each payment part needs an amount.');
    const ref = l.method === 'cash' ? undefined : clean(l.ref, 60) || undefined;
    return { method: l.method, cents, ...(ref ? { ref } : {}) };
  });
  const sum = payments.reduce((a, p) => a + p.cents, 0);
  if (sum !== totalCents) {
    const diff = (Math.abs(totalCents - sum) / 100).toFixed(2);
    throw new HttpError(400, sum < totalCents ? `The payments are ₱${diff} short of the total.` : `The payments are ₱${diff} more than the total.`);
  }
  const cash = payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.cents, 0);
  let tendered = null, change = null;
  if (cash > 0) {
    tendered = tenderedCents == null || tenderedCents === '' ? cash : Number(tenderedCents);
    if (!Number.isInteger(tendered) || tendered < cash) throw new HttpError(400, 'Cash received is less than the cash part of the bill.');
    if (tendered > cash + 1_000_000) throw new HttpError(400, 'Check the cash received amount.');
    change = tendered - cash;
  }
  const methods = [...new Set(payments.map((p) => p.method))];
  return {
    payments, tendered, change,
    method: methods.length === 1 ? methods[0] : 'split',
    reference: payments.map((p) => p.ref).filter(Boolean).join(', ') || null,
  };
}