import { body, HttpError, clean } from '../http.js';
import { sql, batch, bumpVersion, audit, getSettings } from '../db.js';
import { requireStaff } from '../auth.js';
import { CATEGORY_KINDS, slug } from '../menu.js';

// /api/staff/categories   your menu categories: name, type and the order they show in (website, "All", POS)
//   GET                          the list, with how many products each has                      (pos)
//   POST {label, kind}           add a category (goes first in the list; move it with ↑ ↓)      (edit_prices)
//   PUT  {list:[{key,label,kind}]}  save names / types / order                                   (edit_prices)
//   DELETE {key}                 remove an empty category                                        (edit_prices)
const save = (list) => sql`UPDATE settings SET categories = ${JSON.stringify(list)}::jsonb, updated_at = now() WHERE id = 1`;
const withCounts = async (list) => {
  const rows = await sql`SELECT cat, COUNT(*)::int AS n FROM products WHERE NOT deleted GROUP BY cat`;
  const n = Object.fromEntries(rows.map((r) => [r.cat, r.n]));
  return list.map((c) => ({ ...c, products: n[c.key] || 0 }));
};
const checkKind = (k) => { if (!CATEGORY_KINDS[k]) throw new HttpError(400, 'Choose the type: Drink, Food or Other.'); return k; };

export async function categories(req, res) {
  const cur = (await getSettings()).categories;
  if (req.method === 'GET') { await requireStaff(req, 'pos'); return res.status(200).json({ list: await withCounts(cur), kinds: CATEGORY_KINDS }); }
  const me = await requireStaff(req, 'edit_prices');
  const b = body(req);
  let next, log;
  if (req.method === 'POST') {
    const label = clean(b.label, 40);
    if (!label) throw new HttpError(400, 'Type the category name, e.g. Biscoff Series.');
    if (cur.some((c) => c.label.toLowerCase() === label.toLowerCase())) throw new HttpError(409, `There's already a category called "${label}".`);
    if (cur.length >= 40) throw new HttpError(400, 'Up to 40 categories.');
    let key = slug(label).slice(0, 30) || 'category';
    if (/^\d/.test(key)) key = 'c-' + key; // number-like keys would lose their order
    for (let i = 2; cur.some((c) => c.key === key); i++) key = `${key.replace(/-\d+$/, '')}-${i}`;
    const cat = { key, label, kind: checkKind(b.kind || 'drink') };
    next = b.position === 'last' ? [...cur, cat] : [cat, ...cur];
    log = audit(me, 'category.add', label, { kind: cat.kind });
  } else if (req.method === 'PUT') {
    if (!Array.isArray(b.list) || b.list.length !== cur.length) throw new HttpError(409, 'The categories changed on another screen. Reload and try again.');
    const byKey = Object.fromEntries(cur.map((c) => [c.key, c]));
    const seen = new Set();
    next = b.list.map((x) => {
      const c = byKey[x?.key];
      if (!c || seen.has(c.key)) throw new HttpError(409, 'The categories changed on another screen. Reload and try again.');
      seen.add(c.key);
      const label = clean(x.label ?? c.label, 40);
      if (!label) throw new HttpError(400, 'A category name can\'t be empty.');
      return { key: c.key, label, kind: x.kind !== undefined ? checkKind(x.kind) : c.kind };
    });
    const labels = next.map((c) => c.label.toLowerCase());
    if (new Set(labels).size !== labels.length) throw new HttpError(400, 'Two categories have the same name.');
    const renamed = next.filter((c) => byKey[c.key].label !== c.label || byKey[c.key].kind !== c.kind).map((c) => `${byKey[c.key].label} → ${c.label}${byKey[c.key].kind !== c.kind ? ` (${c.kind})` : ''}`);
    const moved = next.some((c, i) => cur[i].key !== c.key);
    log = audit(me, 'category.edit', renamed.join(', ') || (moved ? 'New order' : ''), { order: moved ? next.map((c) => c.label) : undefined });
  } else {
    const c = cur.find((x) => x.key === String(b.key || ''));
    if (!c) throw new HttpError(404, 'Category not found.');
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM products WHERE cat = ${c.key} AND NOT deleted`;
    if (n) throw new HttpError(409, `"${c.label}" still has ${n} product${n === 1 ? '' : 's'}. Move or delete ${n === 1 ? 'it' : 'them'} first.`);
    if (cur.length <= 1) throw new HttpError(400, 'Keep at least one category.');
    next = cur.filter((x) => x.key !== c.key);
    log = audit(me, 'category.delete', c.label);
  }
  await batch([save(next), bumpVersion(), log]);
  res.status(200).json({ list: await withCounts(next), kinds: CATEGORY_KINDS });
}