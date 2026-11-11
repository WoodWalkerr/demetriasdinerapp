import { neon } from '@neondatabase/serverless';
import { HttpError } from './http.js';
import { HOURS_DEFAULTS } from './time.js';
import { DEFAULT_PRODUCTS, DEFAULT_ADDONS, DELIVERY_DEFAULTS, RETIRED_PRODUCTS, CATALOG_VERSION } from './menu.js';

// ---------------------------------------------------------------------------
// Connection. Created on first use, so a missing DATABASE_URL gives a clear
// error instead of crashing the server.
// ---------------------------------------------------------------------------
let client;
/**
 * Finds the database address. Accepts DATABASE_URL, or the names Neon's Vercel integration may use
 * (POSTGRES_URL, or a custom prefix like STORAGE_DATABASE_URL), and forgives common paste mistakes:
 * quotes, a leading "DATABASE_URL=", or the "psql '…'" command copied from Neon.
 */
export function databaseUrl(env = process.env) {
  const names = ['DATABASE_URL', 'POSTGRES_URL', ...Object.keys(env).filter((k) => /(_DATABASE_URL|_POSTGRES_URL)$/.test(k)).sort()];
  for (const k of names) {
    let v = String(env[k] || '').trim();
    if (!v) continue;
    v = v.replace(/^[A-Z_]*DATABASE_URL\s*=\s*/, '').replace(/^psql\s+/, '').trim().replace(/^['"]|['"]$/g, '').trim();
    if (/^postgres(ql)?:\/\/\S+$/.test(v)) return { url: v, name: k };
  }
  const found = names.filter((k) => env[k]);
  return { url: null, problem: found.length ? `${found.join(', ')} is set but doesn't start with postgresql:// (copy the connection string from Neon → Connect)` : 'DATABASE_URL is not set for this deployment' };
}
function db() {
  if (!client) {
    const { url, problem } = databaseUrl();
    if (!url) {
      console.error(`Database not connected: ${problem}. Add your Neon connection string in Vercel → Settings → Environment Variables (Production), then Redeploy. Locally: .env`);
      throw new HttpError(503, `The database is not connected yet: ${problem}.`);
    }
    client = neon(url);
  }
  return client;
}
export const sql = (strings, ...values) => db()(strings, ...values);
/** Runs several queries in ONE round trip (and one transaction). Pass queries built with sql`…`. */
export const batch = (queries) => db().transaction(queries);

// ---------------------------------------------------------------------------
// Schema. A warm server checks it with ONE query; the full setup runs only
// when the version below changes.
// ---------------------------------------------------------------------------
const SCHEMA_VERSION = '8';
let ready;
export function ensureSchema() {
  ready ??= (async () => {
    const cur = await sql`SELECT value FROM meta WHERE key = 'schema'`.catch(() => []);
    if (cur[0]?.value === SCHEMA_VERSION) return;
    await migrate();
  })().catch((e) => { ready = undefined; throw e; });
  return ready;
}

async function migrate() {
  const products = JSON.stringify(DEFAULT_PRODUCTS);
  const addons = JSON.stringify(DEFAULT_ADDONS);
  const delivery = JSON.stringify(DELIVERY_DEFAULTS);
  await batch([
    sql`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

    sql`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, token TEXT NOT NULL, name TEXT NOT NULL,
      pickup_label TEXT NOT NULL, pickup_at TIMESTAMPTZ NOT NULL, note TEXT NOT NULL DEFAULT '',
      items JSONB NOT NULL, total_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'counter'`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payments JSONB`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_id TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_url TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_via TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online'`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'pickup'`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_cents INTEGER`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 0`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery JSONB`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tendered_cents INTEGER`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_cents INTEGER`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS reference TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shift_id TEXT`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_applied BOOLEAN NOT NULL DEFAULT FALSE`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS staff_read_at TIMESTAMPTZ`,
    sql`CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status)`,
    sql`CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS orders_checkout_idx ON orders (checkout_id)`,
    sql`CREATE INDEX IF NOT EXISTS orders_shift_idx ON orders (shift_id)`,

    sql`CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), accepting BOOLEAN NOT NULL DEFAULT TRUE,
      sold_out JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS pay_online BOOLEAN NOT NULL DEFAULT TRUE`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS pay_counter BOOLEAN NOT NULL DEFAULT TRUE`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS qr_name TEXT NOT NULL DEFAULT ''`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS qr_number TEXT NOT NULL DEFAULT ''`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS qr_image TEXT NOT NULL DEFAULT ''`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS delivery JSONB`,
    sql`INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    sql`UPDATE settings SET delivery = ${delivery}::jsonb WHERE id = 1 AND delivery IS NULL`,

    sql`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL, pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier', perms JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE, deleted BOOLEAN NOT NULL DEFAULT FALSE,
      session_ver INTEGER NOT NULL DEFAULT 1, last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (lower(username)) WHERE NOT deleted`,

    sql`CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ, opening_cents INTEGER NOT NULL DEFAULT 0, counted_cents INTEGER,
      expected_cents INTEGER, note TEXT NOT NULL DEFAULT '', summary JSONB, closed_by TEXT)`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_idx ON shifts (user_id) WHERE closed_at IS NULL`,
    sql`CREATE INDEX IF NOT EXISTS shifts_opened_idx ON shifts (opened_at DESC)`,

    sql`CREATE TABLE IF NOT EXISTS cash_moves (
      id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('in','out')),
      cents INTEGER NOT NULL CHECK (cents > 0), category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`CREATE INDEX IF NOT EXISTS cash_moves_shift_idx ON cash_moves (shift_id)`,
    sql`CREATE INDEX IF NOT EXISTS cash_moves_created_idx ON cash_moves (created_at DESC)`,

    sql`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, cat TEXT NOT NULL, name TEXT NOT NULL, price INTEGER,
      available BOOLEAN NOT NULL DEFAULT TRUE, stock INTEGER, low_stock INTEGER NOT NULL DEFAULT 5,
      hot BOOLEAN NOT NULL DEFAULT FALSE, sort INTEGER NOT NULL DEFAULT 0, deleted BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`INSERT INTO products (id, cat, name, price, hot, sort)
        SELECT id, cat, name, price, hot, sort FROM jsonb_to_recordset(${products}::jsonb)
          AS x(id text, cat text, name text, price int, hot bool, sort int)
        ON CONFLICT (id) DO NOTHING`,
    // Items marked sold out in older versions keep that state.
    sql`UPDATE products SET available = FALSE
        WHERE id IN (SELECT jsonb_array_elements_text(sold_out) FROM settings WHERE id = 1)`,
    sql`UPDATE settings SET sold_out = '[]'::jsonb WHERE id = 1`,

    sql`CREATE TABLE IF NOT EXISTS addons (
      id TEXT PRIMARY KEY, grp TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE, sort INTEGER NOT NULL DEFAULT 0, deleted BOOLEAN NOT NULL DEFAULT FALSE)`,
    sql`INSERT INTO addons (id, grp, name, price, sort)
        SELECT id, grp, name, price, sort FROM jsonb_to_recordset(${addons}::jsonb)
          AS x(id text, grp text, name text, price int, sort int)
        ON CONFLICT (id) DO NOTHING`,

    sql`CREATE TABLE IF NOT EXISTS stock_log (
      id BIGSERIAL PRIMARY KEY, product_id TEXT NOT NULL, user_id TEXT, delta INTEGER NOT NULL,
      stock_after INTEGER, reason TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`CREATE INDEX IF NOT EXISTS stock_log_created_idx ON stock_log (created_at DESC)`,

    sql`CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY, order_id TEXT NOT NULL, sender TEXT NOT NULL CHECK (sender IN ('customer','staff')),
      user_id TEXT, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`CREATE INDEX IF NOT EXISTS messages_order_idx ON messages (order_id, id)`,
    sql`CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at DESC)`,

    // v7: product costing, saved theme per user, expenses (monthly costing & liquidation)
    sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost INTEGER`,
    sql`ALTER TABLE addons ADD COLUMN IF NOT EXISTS cost INTEGER`,
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'auto'`,
    sql`CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY, spent_on DATE NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      cents INTEGER NOT NULL CHECK (cents > 0), reference TEXT NOT NULL DEFAULT '', user_id TEXT,
      deleted BOOLEAN NOT NULL DEFAULT FALSE, deleted_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`CREATE INDEX IF NOT EXISTS expenses_month_idx ON expenses (spent_on)`,

    // v8: opening hours, happy hour promos, nightly summary, product photos, scheduled orders, activity log
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS hours JSONB`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS promos JSONB NOT NULL DEFAULT '[]'::jsonb`,
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS summary JSONB`,
    sql`UPDATE settings SET hours = ${JSON.stringify(HOURS_DEFAULTS)}::jsonb WHERE id = 1 AND hours IS NULL`,
    sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_ver INTEGER`,
    sql`CREATE TABLE IF NOT EXISTS product_images (
      product_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`,
    sql`CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), user_id TEXT, user_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail JSONB)`,
    sql`CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log (at DESC)`,

    sql`INSERT INTO meta (key, value) VALUES ('data_version', '1') ON CONFLICT (key) DO NOTHING`,
    sql`INSERT INTO meta (key, value) VALUES ('schema', ${SCHEMA_VERSION}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  ]);
  await applyCatalog();
}

/**
 * Applies the price list in lib/menu.js ONCE per CATALOG_VERSION: updates names, categories,
 * selling prices and costs; adds new items; hides retired ones. Later edits made in
 * /staff → Products are kept (this doesn't run again until the version changes).
 */
async function applyCatalog() {
  const [cur] = await sql`SELECT value FROM meta WHERE key = 'catalog'`;
  if (cur?.value === CATALOG_VERSION) return;
  const products = JSON.stringify(DEFAULT_PRODUCTS);
  const addons = JSON.stringify(DEFAULT_ADDONS);
  await batch([
    sql`INSERT INTO products (id, cat, name, price, cost, hot, sort)
        SELECT id, cat, name, price, cost, hot, sort FROM jsonb_to_recordset(${products}::jsonb)
          AS x(id text, cat text, name text, price int, cost int, hot bool, sort int)
        ON CONFLICT (id) DO UPDATE SET cat = EXCLUDED.cat, name = EXCLUDED.name, hot = EXCLUDED.hot, sort = EXCLUDED.sort,
          price = COALESCE(EXCLUDED.price, products.price), cost = COALESCE(EXCLUDED.cost, products.cost),
          deleted = FALSE, updated_at = now()`,
    sql`UPDATE products SET deleted = TRUE, updated_at = now() WHERE id = ANY(${RETIRED_PRODUCTS}::text[])`,
    sql`UPDATE addons a SET cost = x.cost FROM jsonb_to_recordset(${addons}::jsonb) AS x(id text, cost int)
        WHERE a.id = x.id AND x.cost IS NOT NULL AND a.cost IS NULL`,
    sql`INSERT INTO meta (key, value) VALUES ('catalog', ${CATALOG_VERSION}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    bumpVersion(),
  ]);
}

// ---------------------------------------------------------------------------
// "Data version": bumped whenever the menu, prices, stock or settings change,
// so open pages know to refresh without a reload.
// ---------------------------------------------------------------------------
export const bumpVersion = () => sql`UPDATE meta SET value = (value::bigint + 1)::text WHERE key = 'data_version'`;
export const versionQuery = () => sql`SELECT value FROM meta WHERE key = 'data_version'`;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const settingsQuery = () => sql`SELECT * FROM settings WHERE id = 1`;
export function shapeSettings(row) {
  return {
    accepting: row?.accepting ?? true,
    payOnline: row?.pay_online ?? true,
    payCounter: row?.pay_counter ?? true,
    qr: { enabled: row?.qr_enabled ?? false, name: row?.qr_name || '', number: row?.qr_number || '', image: row?.qr_image || '' },
    delivery: { ...DELIVERY_DEFAULTS, ...(row?.delivery || {}) },
    hours: row?.hours || HOURS_DEFAULTS,
    promos: row?.promos || [],
    summary: { enabled: false, emails: [], ...(row?.summary || {}) },
  };
}
export async function getSettings() {
  await ensureSchema();
  const [row] = await settingsQuery();
  return shapeSettings(row);
}

/** The QR is usable only when switched on and an image has been uploaded. */
export const qrReady = (s) => !!(s.qr?.enabled && s.qr?.image);
/** What a paying customer needs to see: your QR, account name and number. */
export const qrPublic = (s) => (qrReady(s) ? { name: s.qr.name, number: s.qr.number, image: s.qr.image } : null);
/** Delivery is offered only when switched on and the store's location is set. */
export const deliveryReady = (s) => !!(s.delivery?.enabled && Number.isFinite(s.delivery.lat) && Number.isFinite(s.delivery.lng));

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
/** Money received for an order, as a list of {method, cents}. Older orders get one entry. */
export function paymentsOf(o) {
  if (Array.isArray(o.payments) && o.payments.length) return o.payments;
  if (o.payment_status !== 'paid') return [];
  return [{ method: o.payment_method === 'counter' ? 'cash' : o.payment_method, cents: o.total_cents }];
}

/** Shape an order row for the staff screens. */
export const staffOrder = (o) => ({
  id: o.id, code: o.code, name: o.name, note: o.note, items: o.items, status: o.status,
  totalCents: o.total_cents, subtotalCents: o.subtotal_cents ?? o.total_cents,
  pickupLabel: o.pickup_label, pickupAt: o.pickup_at, createdAt: o.created_at, updatedAt: o.updated_at,
  paymentMethod: o.payment_method, paymentStatus: o.payment_status, payments: paymentsOf(o),
  paidVia: o.paid_via, paidAt: o.paid_at, paymentId: o.payment_id, refundId: o.refund_id,
  source: o.source || 'online', orderType: o.order_type || 'pickup',
  discountType: o.discount_type, discountCents: o.discount_cents || 0,
  deliveryFeeCents: o.delivery_fee_cents || 0, delivery: o.delivery || null,
  tenderedCents: o.tendered_cents, changeCents: o.change_cents, reference: o.reference,
  staffName: o.user_name || null, shiftId: o.shift_id || null,
  unread: o.unread ?? 0, lastMessage: o.last_msg ?? null, scheduledFor: o.scheduled_for || null,
});

// ---------------------------------------------------------------------------
// Activity log: who changed what. audit(user, 'price', 'Okinawa', {from, to}) returns a query,
// so it can go in the same batch() as the change itself.
// ---------------------------------------------------------------------------
export const audit = (u, action, target = '', detail = null) =>
  sql`INSERT INTO audit_log (user_id, user_name, action, target, detail)
      VALUES (${u?.id || null}, ${u?.name || ''}, ${action}, ${String(target).slice(0, 120)}, ${detail == null ? null : JSON.stringify(detail)}::jsonb)`;