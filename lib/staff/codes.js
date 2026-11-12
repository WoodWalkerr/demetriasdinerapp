import { body, HttpError, clean } from '../http.js';
import { sql, audit, bumpVersion } from '../db.js';
import { requireStaff } from '../auth.js';
import { normCode, CODE_RE, codeLabel, checkCode, publicCode, timeOk, timeLabel } from '../promocodes.js';
import { businessDate } from '../time.js';

const shape = (c, stats = {}) => ({
  code: c.code, kind: c.kind, value: c.value, minCents: c.min_cents, maxOffCents: c.max_off_cents,
  startsOn: c.starts_on, endsOn: c.ends_on, startTime: c.start_time || '', endTime: c.end_time || '', maxUses: c.max_uses, channel: c.channel, note: c.note, active: c.active,
  bogo: c.bogo || null, label: codeLabel(c), popup: !!c.popup, popupTitle: c.popup_title || '', popupText: c.popup_text || '', uses: stats.uses || 0, givenCents: stats.given || 0, createdAt: c.created_at,
});
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// /api/staff/codes
//   GET ?check=CODE                     check a code at the POS                          (pos)
//   GET ?available=1                    every saved code, and whether it works in store now (pos)
//   GET                                 all codes with how often they were used         (settings)
//   POST {code, kind: pct|fixed, value (% or ₱), minOrder (₱), maxOff (₱), startsOn, endsOn, maxUses, channel, note}
//   PUT  {code, active?, ...same fields}
//   DELETE {code}
export async function codes(req, res) {
  if (req.method === 'GET' && req.query.check) {
    await requireStaff(req, 'pos');
    return res.status(200).json(publicCode(await checkCode(req.query.check, { channel: 'pos' })));
  }
  if (req.method === 'GET' && req.query.available) {
    await requireStaff(req, 'pos');
    const today = businessDate();
    const list = await sql`SELECT p.*, (SELECT COUNT(*)::int FROM orders o WHERE o.promo_code = p.code AND o.status <> 'cancelled') AS uses
                           FROM promo_codes p WHERE NOT p.deleted AND p.active ORDER BY p.created_at DESC`;
    return res.status(200).json({
      codes: list.map((c) => {
        const why = c.channel === 'online' ? 'Online orders only'
          : c.starts_on && today < c.starts_on ? `Starts ${c.starts_on}`
          : c.ends_on && today > c.ends_on ? 'Expired'
          : !timeOk(c) ? `Works ${timeLabel(c)}`
          : c.max_uses != null && c.uses >= c.max_uses ? 'Used up' : '';
        return { ...publicCode(c), channel: c.channel, note: c.note || '', endsOn: c.ends_on, hours: timeLabel(c), usesLeft: c.max_uses == null ? null : Math.max(0, c.max_uses - c.uses), usable: !why, why };
      }).sort((a, b) => b.usable - a.usable),
    });
  }
  const me = await requireStaff(req, 'settings');
  if (req.method === 'GET') {
    const [list, stats] = [await sql`SELECT * FROM promo_codes WHERE NOT deleted ORDER BY active DESC, created_at DESC`,
      await sql`SELECT promo_code, COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS uses,
                  COALESCE(SUM(discount_cents - COALESCE(deal_cents, 0)) FILTER (WHERE status <> 'cancelled' AND payment_status = 'paid'), 0)::int AS given
                FROM orders WHERE promo_code IS NOT NULL GROUP BY promo_code`];
    const by = Object.fromEntries(stats.map((s) => [s.promo_code, s]));
    return res.status(200).json({ codes: list.map((c) => shape(c, by[c.code])) });
  }
  const b = body(req);
  const code = normCode(b.code);
  if (req.method === 'DELETE') {
    const [c] = await sql`UPDATE promo_codes SET deleted = TRUE, active = FALSE WHERE code = ${code} AND NOT deleted RETURNING *`;
    if (!c) throw new HttpError(404, 'Code not found.');
    await audit(me, 'code.delete', code, { label: codeLabel(c) });
    await bumpVersion(); // websites drop it from the pop-up
    return res.status(200).json({ ok: true });
  }

  const [cur] = await sql`SELECT * FROM promo_codes WHERE code = ${code}`;
  if (req.method === 'POST') {
    if (!CODE_RE.test(code)) throw new HttpError(400, 'Codes are 3–20 letters, numbers or dashes, like BDAY20.');
    if (cur && !cur.deleted) throw new HttpError(409, `${code} already exists.`);
  } else if (!cur || cur.deleted) throw new HttpError(404, 'Code not found.');

  const val = (k, d) => (b[k] !== undefined ? b[k] : d);
  const kind = val('kind', cur?.kind || 'pct');
  if (!['pct', 'fixed', 'bogo'].includes(kind)) throw new HttpError(400, 'Choose % off, ₱ off, or Buy this, get that.');
  const pesos = (v) => (v === '' || v == null ? null : Math.round(Number(v) * 100));
  let value, bogo = cur?.bogo || null;
  if (kind === 'bogo' && (b.bogo !== undefined || !bogo)) bogo = await checkBogo(b.bogo || {});
  if (kind === 'bogo') value = bogo.getPct; // stored as the code's value too
  else if (b.value !== undefined) {
    value = kind === 'pct' ? Number(b.value) : pesos(b.value);
    if (kind === 'pct' && !(Number.isInteger(value) && value >= 1 && value <= 100)) throw new HttpError(400, 'Percent off must be a whole number from 1 to 100.');
    if (kind === 'fixed' && !(value >= 100 && value <= 10_000_00)) throw new HttpError(400, 'Peso off must be at least ₱1.');
  } else value = cur?.value;
  if (!value) throw new HttpError(400, 'Enter how much the discount is.');
  if (kind !== 'bogo') bogo = null;
  const minCents = b.minOrder !== undefined ? pesos(b.minOrder) || 0 : cur?.min_cents || 0;
  const maxOff = kind === 'pct' ? (b.maxOff !== undefined ? pesos(b.maxOff) : cur?.max_off_cents ?? null) : null;
  if (minCents < 0 || (maxOff != null && maxOff < 100)) throw new HttpError(400, 'Check the minimum order and maximum discount.');
  const startsOn = val('startsOn', cur?.starts_on || '') || null, endsOn = val('endsOn', cur?.ends_on || '') || null;
  if ((startsOn && !DATE.test(startsOn)) || (endsOn && !DATE.test(endsOn))) throw new HttpError(400, 'Check the dates.');
  if (startsOn && endsOn && endsOn < startsOn) throw new HttpError(400, 'The end date is before the start date.');
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const startTime = String(val('startTime', cur?.start_time || '') || '').slice(0, 5) || null, endTime = String(val('endTime', cur?.end_time || '') || '').slice(0, 5) || null;
  if ((startTime && !TIME.test(startTime)) || (endTime && !TIME.test(endTime))) throw new HttpError(400, 'Check the times.');
  if (!!startTime !== !!endTime) throw new HttpError(400, 'Set both a start time and an end time (or leave both empty for all day).');
  if (startTime && startTime === endTime) throw new HttpError(400, 'The start and end time are the same.');
  const mu = val('maxUses', cur?.max_uses ?? '');
  const maxUses = mu === '' || mu == null ? null : parseInt(mu, 10);
  if (maxUses != null && !(maxUses >= 1 && maxUses <= 100000)) throw new HttpError(400, 'Max uses must be 1 or more (or empty for no limit).');
  const channel = val('channel', cur?.channel || 'both');
  if (!['both', 'online', 'pos'].includes(channel)) throw new HttpError(400, 'Choose where the code works.');
  const note = clean(val('note', cur?.note || ''), 120);
  const active = typeof b.active === 'boolean' ? b.active : cur?.deleted ? true : cur?.active ?? true;
  // Website pop-up: on/off, plus an optional headline and message.
  const popup = typeof b.popup === 'boolean' ? b.popup : cur?.deleted ? false : !!cur?.popup;
  const popupTitle = clean(val('popupTitle', cur?.popup_title || ''), 60);
  const popupText = clean(val('popupText', cur?.popup_text || ''), 160);
  if (popup && channel === 'pos') throw new HttpError(400, 'In-store-only codes can\'t be shown in the website pop-up. Change "Works" to Online or both.');

  const [c] = await sql`INSERT INTO promo_codes (code, kind, value, min_cents, max_off_cents, starts_on, ends_on, start_time, end_time, max_uses, channel, note, active, deleted, created_by, popup, popup_title, popup_text, bogo)
      VALUES (${code}, ${kind}, ${value}, ${minCents}, ${maxOff}, ${startsOn}, ${endsOn}, ${startTime}, ${endTime}, ${maxUses}, ${channel}, ${note}, ${active}, FALSE, ${me.id}, ${popup}, ${popupTitle}, ${popupText}, ${bogo ? JSON.stringify(bogo) : null}::jsonb)
      ON CONFLICT (code) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, min_cents = EXCLUDED.min_cents, max_off_cents = EXCLUDED.max_off_cents,
        starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, max_uses = EXCLUDED.max_uses, channel = EXCLUDED.channel,
        note = EXCLUDED.note, active = EXCLUDED.active, deleted = FALSE,
        popup = EXCLUDED.popup, popup_title = EXCLUDED.popup_title, popup_text = EXCLUDED.popup_text, bogo = EXCLUDED.bogo
      RETURNING *`;
  if (popup || cur?.popup) await bumpVersion(); // open websites refresh their pop-up
  if (req.method === 'POST') await audit(me, 'code.add', code, { label: codeLabel(c), channel, maxUses, startsOn, endsOn, hours: startTime ? `${startTime}–${endTime}` : undefined, popup: popup || undefined });
  else {
    const was = { label: codeLabel(cur), active: cur.active, maxUses: cur.max_uses, startsOn: cur.starts_on, endsOn: cur.ends_on, hours: cur.start_time ? `${cur.start_time}–${cur.end_time}` : '', channel: cur.channel, popup: !!cur.popup, popupTitle: cur.popup_title, popupText: cur.popup_text };
    const now = { label: codeLabel(c), active: c.active, maxUses: c.max_uses, startsOn: c.starts_on, endsOn: c.ends_on, hours: c.start_time ? `${c.start_time}–${c.end_time}` : '', channel: c.channel, popup: !!c.popup, popupTitle: c.popup_title, popupText: c.popup_text };
    const changes = Object.fromEntries(Object.keys(was).filter((k) => was[k] !== now[k]).map((k) => [k, [was[k], now[k]]]));
    if (Object.keys(changes).length) await audit(me, 'code.edit', code, changes);
  }
  res.status(req.method === 'POST' ? 201 : 200).json(shape(c));
}

// "Buy this, get that": { buyIds[], buyQty, getIds[], getPct (100 = free), max (rewards per order) }
// The labels shown to customers ("Iced Latte or Iced Americano", "any of 8 iced coffees") are made here from the menu.
async function checkBogo(x) {
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(String))].slice(0, 80);
  const buyIds = ids(x.buyIds), getIds = ids(x.getIds);
  if (!buyIds.length) throw new HttpError(400, 'Pick what customers need to buy.');
  if (!getIds.length) throw new HttpError(400, 'Pick what customers get.');
  const rows = await sql`SELECT id, name, cat FROM products WHERE id = ANY(${[...buyIds, ...getIds]}::text[]) AND NOT deleted`;
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const keep = (list) => list.filter((id) => by[id]);
  const buy = keep(buyIds), get = keep(getIds);
  if (!buy.length || !get.length) throw new HttpError(400, 'Those items are no longer on the menu.');
  const buyQty = parseInt(x.buyQty ?? 1, 10);
  if (!(buyQty >= 1 && buyQty <= 10)) throw new HttpError(400, 'Buy quantity must be 1 to 10.');
  const getPct = parseInt(x.getPct ?? 100, 10);
  if (!(getPct >= 1 && getPct <= 100)) throw new HttpError(400, 'The reward must be 1–100% off (100% = free).');
  const max = x.max === '' || x.max == null ? null : parseInt(x.max, 10);
  if (max != null && !(max >= 1 && max <= 20)) throw new HttpError(400, 'Max per order must be 1 to 20 (or empty for no limit).');
  const label = (list, custom) => {
    if (clean(custom, 60)) return clean(custom, 60);
    const names = list.map((id) => by[id].name);
    if (names.length <= 2) return names.join(' or ');
    return `any of ${names.length} items (${names.slice(0, 2).join(', ')}…)`;
  };
  return { buyIds: buy, buyQty, getIds: get, getPct, max, buyLabel: label(buy, x.buyLabel), getLabel: label(get, x.getLabel) };
}