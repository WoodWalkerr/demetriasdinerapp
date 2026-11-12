// "Add something?" suggestions in the cart (website) and on the POS ticket.
// Set up in /staff → Settings → Cart suggestions.
//   rules: "when the cart has these items or categories, suggest these items" (you choose)
//   auto:  also suggest what people actually bought together in the last 60 days
//   Fallback: a drink in the cart and no food → a popular pastry; food and no drink → a popular drink.
// Items added from a suggestion are marked on the order, so the Dashboard can show what they added.
import { sql } from './db.js';

// onlyCats: suggest only items from these categories (default: Pastries). Empty = any category.
export const UPSELL_DEFAULTS = { enabled: true, auto: true, rules: [], onlyCats: ['pastries'] };

export function checkUpsell(x, cur = UPSELL_DEFAULTS) {
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const n = { ...UPSELL_DEFAULTS, ...cur };
  if (typeof x.enabled === 'boolean') n.enabled = x.enabled;
  if (typeof x.auto === 'boolean') n.auto = x.auto;
  if (x.onlyCats !== undefined) n.onlyCats = (Array.isArray(x.onlyCats) ? x.onlyCats : []).map(String).slice(0, 20);
  if (x.rules !== undefined) {
    if (!Array.isArray(x.rules) || x.rules.length > 30) err('Up to 30 suggestion rules.');
    n.rules = x.rules.map((r) => {
      const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(String))].slice(0, 60);
      const rule = {
        id: /^[a-z0-9-]{4,40}$/.test(r?.id || '') ? r.id : 'up-' + Math.random().toString(36).slice(2, 10),
        whenCats: ids(r?.whenCats), whenIds: ids(r?.whenIds), suggestIds: ids(r?.suggestIds).slice(0, 6),
        text: String(r?.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60), active: r?.active !== false,
      };
      if (!rule.whenCats.length && !rule.whenIds.length) err('Each suggestion needs "when the cart has…".');
      if (!rule.suggestIds.length) err('Each suggestion needs at least one item to suggest.');
      return rule;
    });
  }
  return n;
}

/** Items bought together in the last 60 days: { productId: [up to 3 other productIds] } (pairs seen at least twice). */
export const pairsQuery = () => sql`
  WITH o AS (SELECT id, items FROM orders WHERE status <> 'cancelled' AND created_at > now() - interval '60 days' ORDER BY created_at DESC LIMIT 3000),
  li AS (SELECT DISTINCT o.id AS oid, i->>'id' AS pid FROM o CROSS JOIN LATERAL jsonb_array_elements(o.items) i),
  pr AS (SELECT a.pid AS a, b.pid AS b, COUNT(*) AS n FROM li a JOIN li b ON a.oid = b.oid AND a.pid <> b.pid GROUP BY 1, 2),
  rk AS (SELECT a, b, n, ROW_NUMBER() OVER (PARTITION BY a ORDER BY n DESC, b) AS r FROM pr WHERE n >= 2)
  SELECT a, json_agg(b ORDER BY r) AS top FROM rk WHERE r <= 3 GROUP BY a`;
/** Best sellers of the last 60 days (for the fallback suggestions). */
export const popularQuery = () => sql`
  SELECT i->>'id' AS id, SUM((i->>'qty')::int)::int AS qty
  FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.items) i
  WHERE o.status <> 'cancelled' AND o.created_at > now() - interval '60 days'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 40`;

/** What the browser needs to suggest items. */
export async function upsellFeed(cfg) {
  if (!cfg.enabled) return { enabled: false };
  const [pairs, popular] = await Promise.all([cfg.auto ? pairsQuery() : [], popularQuery()]);
  return {
    enabled: true, auto: cfg.auto, rules: cfg.rules.filter((r) => r.active), onlyCats: cfg.onlyCats || [],
    pairs: Object.fromEntries(pairs.map((p) => [p.a, p.top])),
    popular: popular.map((p) => p.id),
  };
}