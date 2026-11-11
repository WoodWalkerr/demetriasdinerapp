import { body, HttpError, clean } from '../http.js';
import { sql, batch, bumpVersion, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { CATEGORIES, ADDON_GROUPS, slug } from '../menu.js';
import { productsQuery, addonsQuery, isSoldOut, photoUrl } from '../pricing.js';
import { TZ } from '../time.js';
import { dealsQuery, dealsFor, publicDeal } from '../deals.js';
import { getSettings } from '../db.js';
import { publicLoyalty } from '../loyalty.js';
import { upsellFeed } from '../upsell.js';

const pesoToCents = (v, label, { allowNull = false } = {}) => {
  if (allowNull && (v == null || v === '')) return null;
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_00) throw new HttpError(400, `${label}: enter an amount in pesos, like 119.`);
  return n;
};
// Costs are shown only to staff who can edit prices or see finances (not to cashiers).
const seesCost = (u) => u && (u.can('edit_prices') || u.can('finance'));
const margin = (price, cost) => (price != null && cost != null ? { profit: price - cost, pct: price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null } : null);
const shapeProduct = (p, u) => ({
  id: p.id, cat: p.cat, name: p.name, price: p.price, available: p.available, stock: p.stock,
  lowStock: p.low_stock, hot: p.hot, sort: p.sort, soldOut: isSoldOut(p), updatedAt: p.updated_at, img: p.photo_ver ? photoUrl(p) : null,
  ...(seesCost(u) ? { cost: p.cost, margin: margin(p.price, p.cost) } : {}),
});
const shapeAddon = (a, u) => ({ id: a.id, grp: a.grp, name: a.name, price: a.price, active: a.active, sort: a.sort, ...(seesCost(u) ? { cost: a.cost } : {}) });

// /api/staff/products
//   GET                                   products + add-ons + recent stock changes   (any staff)
//   POST   {cat, name, price, hot?}                                                    (edit_prices)
//   PUT    {id, name?, cat?, price?, hot?, sort?}                                      (edit_prices)
//          {id, available?, lowStock?}                                                 (inventory)
//          {id, photo: 'data:image/webp;base64,…' | ''}  photo upload / remove              (edit_prices)
//   DELETE {id}                                                                        (edit_prices)
export async function products(req, res) {
  if (req.method === 'GET') {
    const me = await requireStaff(req, 'pos');
    const [ps, as, log, [st], dealRows] = await batch([
      productsQuery(), addonsQuery(),
      sql`SELECT l.*, p.name AS product_name, u.name AS user_name FROM stock_log l
          LEFT JOIN products p ON p.id = l.product_id LEFT JOIN users u ON u.id = l.user_id
          ORDER BY l.id DESC LIMIT 60`,
      sql`SELECT promos FROM settings WHERE id = 1`,
      dealsQuery(),
    ]);
    return res.status(200).json({
      products: ps.map((p) => shapeProduct(p, me)), addons: as.map((a) => shapeAddon(a, me)), categories: CATEGORIES, addonGroups: ADDON_GROUPS, seesCost: !!seesCost(me),
      promos: (st?.promos || []).filter((x) => x.active), tz: TZ,
      deals: dealsFor(dealRows, 'pos').map(publicDeal),
      ...(await (async () => { const s = await getSettings(); return { loyalty: publicLoyalty(s.loyalty), upsell: await upsellFeed(s.upsell) }; })()),
      stockLog: log.map((l) => ({ at: l.created_at, product: l.product_name, delta: l.delta, after: l.stock_after, reason: l.reason, staffName: l.user_name })),
    });
  }
  const b = body(req);
  if (req.method === 'POST') {
    const me = await requireStaff(req, 'edit_prices');
    const name = clean(b.name, 60);
    if (!name) throw new HttpError(400, 'Enter the product name.');
    if (!CATEGORIES[b.cat]) throw new HttpError(400, 'Choose a category.');
    let id = slug(name) || 'item';
    const [dupe] = await sql`SELECT id FROM products WHERE id = ${id}`;
    if (dupe) id = `${id}-${Date.now().toString(36).slice(-4)}`;
    const [{ m }] = await sql`SELECT COALESCE(MAX(sort), 0) + 10 AS m FROM products`;
    const [p] = await sql`INSERT INTO products (id, cat, name, price, cost, hot, sort)
      VALUES (${id}, ${b.cat}, ${name}, ${pesoToCents(b.price, 'Price', { allowNull: true })}, ${pesoToCents(b.cost, 'Cost', { allowNull: true })}, ${!!b.hot}, ${m}) RETURNING *`;
    await batch([bumpVersion(), audit(me, 'product.add', p.name, { price: p.price, cost: p.cost, cat: p.cat })]);
    return res.status(201).json(shapeProduct(p, me));
  }
  const [cur] = await sql`SELECT * FROM products WHERE id = ${String(b.id)} AND NOT deleted`;
  if (!cur) throw new HttpError(404, 'Product not found.');

  if (req.method === 'DELETE') {
    const me = await requireStaff(req, 'edit_prices');
    await batch([sql`UPDATE products SET deleted = TRUE, updated_at = now() WHERE id = ${cur.id}`, bumpVersion(), audit(me, 'product.delete', cur.name, { price: cur.price })]);
    return res.status(200).json({ ok: true });
  }

  if (b.photo !== undefined) {
    const me = await requireStaff(req, 'edit_prices');
    if (b.photo === '') {
      const [[p]] = await batch([
        sql`UPDATE products SET photo_ver = NULL, updated_at = now() WHERE id = ${cur.id} RETURNING *`,
        sql`DELETE FROM product_images WHERE product_id = ${cur.id}`, bumpVersion(), audit(me, 'product.photo', cur.name, { removed: true })]);
      return res.status(200).json(shapeProduct(p, me));
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
    if (!m) throw new HttpError(400, 'Upload a JPG, PNG or WebP photo.');
    if (m[2].length > 700_000) throw new HttpError(400, 'That photo is too large. Please try another one.');
    const ver = (cur.photo_ver || 0) + 1;
    const [, [p]] = await batch([
      sql`INSERT INTO product_images (product_id, mime, data, ver) VALUES (${cur.id}, ${m[1]}, ${m[2]}, ${ver})
          ON CONFLICT (product_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, ver = EXCLUDED.ver, updated_at = now()`,
      sql`UPDATE products SET photo_ver = ${ver}, updated_at = now() WHERE id = ${cur.id} RETURNING *`,
      bumpVersion(), audit(me, 'product.photo', cur.name, { kb: Math.round((m[2].length * 3) / 4 / 1024) }),
    ]);
    return res.status(200).json(shapeProduct(p, me));
  }

  // PUT: each field needs its own permission.
  const touchesMenu = ['name', 'cat', 'price', 'cost', 'hot', 'sort'].some((k) => b[k] !== undefined);
  const touchesStock = ['available', 'lowStock'].some((k) => b[k] !== undefined);
  const u = await requireStaff(req, touchesMenu ? 'edit_prices' : 'inventory');
  if (touchesStock && !u.can('inventory')) throw new HttpError(403, "You don't have permission to change availability.");
  const next = {
    name: b.name !== undefined ? clean(b.name, 60) || cur.name : cur.name,
    cat: b.cat !== undefined ? (CATEGORIES[b.cat] ? b.cat : (() => { throw new HttpError(400, 'Choose a category.'); })()) : cur.cat,
    price: b.price !== undefined ? pesoToCents(b.price, 'Price', { allowNull: true }) : cur.price,
    cost: b.cost !== undefined ? pesoToCents(b.cost, 'Cost', { allowNull: true }) : cur.cost,
    hot: b.hot !== undefined ? !!b.hot : cur.hot,
    sort: b.sort !== undefined ? Number(b.sort) || 0 : cur.sort,
    available: typeof b.available === 'boolean' ? b.available : cur.available,
    low: b.lowStock !== undefined ? Math.max(0, Math.min(999, parseInt(b.lowStock, 10) || 0)) : cur.low_stock,
  };
  // Activity log: what changed, from → to (sort order isn't worth logging).
  const was = { name: cur.name, cat: cur.cat, price: cur.price, cost: cur.cost, hot: cur.hot, available: cur.available, low: cur.low_stock };
  const changes = Object.fromEntries(Object.keys(was).filter((k) => next[k] !== was[k]).map((k) => [k, [was[k], next[k]]]));
  const [[p]] = await batch([
    sql`UPDATE products SET name = ${next.name}, cat = ${next.cat}, price = ${next.price}, cost = ${next.cost}, hot = ${next.hot},
      sort = ${next.sort}, available = ${next.available}, low_stock = ${next.low}, updated_at = now()
    WHERE id = ${cur.id} RETURNING *`,
    bumpVersion(),
    ...(Object.keys(changes).length ? [audit(u, changes.price || changes.cost ? 'product.price' : 'product.edit', cur.name, changes)] : []),
  ]);
  res.status(200).json(shapeProduct(p, u));
}

// POST /api/staff/stock {id, mode: 'add'|'remove'|'set'|'untrack', qty, reason}   (inventory)
export async function stock(req, res) {
  const u = await requireStaff(req, 'inventory');
  const b = body(req);
  const [cur] = await sql`SELECT * FROM products WHERE id = ${String(b.id)} AND NOT deleted`;
  if (!cur) throw new HttpError(404, 'Product not found.');
  const reason = clean(b.reason, 80) || { add: 'Restock', remove: 'Removed', set: 'Stock count', untrack: 'Stopped tracking' }[b.mode] || '';
  let next;
  if (b.mode === 'untrack') next = null;
  else {
    const qty = parseInt(b.qty, 10);
    if (!Number.isInteger(qty) || qty < 0 || qty > 100000) throw new HttpError(400, 'Enter a whole number.');
    if (b.mode === 'set') next = qty;
    else if (b.mode === 'add') next = (cur.stock ?? 0) + qty;
    else if (b.mode === 'remove') next = Math.max(0, (cur.stock ?? 0) - qty);
    else throw new HttpError(400, 'Unknown stock action.');
  }
  const delta = (next ?? 0) - (cur.stock ?? 0);
  const [[p]] = await batch([
    sql`UPDATE products SET stock = ${next}, updated_at = now() WHERE id = ${cur.id} RETURNING *`,
    sql`INSERT INTO stock_log (product_id, user_id, delta, stock_after, reason) VALUES (${cur.id}, ${u.id}, ${delta}, ${next}, ${reason})`,
    bumpVersion(), audit(u, 'stock', cur.name, { from: cur.stock, to: next, reason }),
  ]);
  res.status(200).json(shapeProduct(p, u));
}

// /api/staff/addons  (edit_prices; GET is in /products)
//   POST {grp, name, price} · PUT {id, name?, price?, grp?, active?} · DELETE {id}
export async function addons(req, res) {
  const me = await requireStaff(req, 'edit_prices');
  const b = body(req);
  if (req.method === 'POST') {
    const name = clean(b.name, 40);
    if (!name) throw new HttpError(400, 'Enter the add-on name.');
    if (!ADDON_GROUPS[b.grp]) throw new HttpError(400, 'Choose where it applies (drinks, food or packaging).');
    let id = slug(name) || 'addon';
    const [dupe] = await sql`SELECT id FROM addons WHERE id = ${id}`;
    if (dupe) id = `${id}-${Date.now().toString(36).slice(-4)}`;
    const [{ m }] = await sql`SELECT COALESCE(MAX(sort), 0) + 10 AS m FROM addons`;
    const [a] = await sql`INSERT INTO addons (id, grp, name, price, cost, sort) VALUES (${id}, ${b.grp}, ${name}, ${pesoToCents(b.price, 'Price')}, ${pesoToCents(b.cost, 'Cost', { allowNull: true })}, ${m}) RETURNING *`;
    await batch([bumpVersion(), audit(me, 'addon.add', a.name, { price: a.price })]);
    return res.status(201).json(shapeAddon(a, me));
  }
  const [cur] = await sql`SELECT * FROM addons WHERE id = ${String(b.id)} AND NOT deleted`;
  if (!cur) throw new HttpError(404, 'Add-on not found.');
  if (req.method === 'DELETE') {
    await batch([sql`UPDATE addons SET deleted = TRUE, active = FALSE WHERE id = ${cur.id}`, bumpVersion(), audit(me, 'addon.delete', cur.name)]);
    return res.status(200).json({ ok: true });
  }
  const grp = b.grp !== undefined ? (ADDON_GROUPS[b.grp] ? b.grp : (() => { throw new HttpError(400, 'Choose where it applies.'); })()) : cur.grp;
  const [a] = await sql`UPDATE addons SET name = ${b.name !== undefined ? clean(b.name, 40) || cur.name : cur.name},
      price = ${b.price !== undefined ? pesoToCents(b.price, 'Price') : cur.price}, grp = ${grp},
      cost = ${b.cost !== undefined ? pesoToCents(b.cost, 'Cost', { allowNull: true }) : cur.cost},
      active = ${typeof b.active === 'boolean' ? b.active : cur.active}
    WHERE id = ${cur.id} RETURNING *`;
  const changes = Object.fromEntries(['name', 'price', 'cost', 'grp', 'active'].filter((k) => a[k] !== cur[k]).map((k) => [k, [cur[k], a[k]]]));
  await batch([bumpVersion(), ...(Object.keys(changes).length ? [audit(me, changes.price || changes.cost ? 'addon.price' : 'addon.edit', cur.name, changes)] : [])]);
  res.status(200).json(shapeAddon(a, me));
}