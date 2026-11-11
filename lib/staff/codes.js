import { body, HttpError, clean } from '../http.js';
import { sql, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { normCode, CODE_RE, codeLabel, checkCode, publicCode } from '../promocodes.js';
import { businessDate } from '../time.js';

const shape = (c, stats = {}) => ({
  code: c.code, kind: c.kind, value: c.value, minCents: c.min_cents, maxOffCents: c.max_off_cents,
  startsOn: c.starts_on, endsOn: c.ends_on, maxUses: c.max_uses, channel: c.channel, note: c.note, active: c.active,
  label: codeLabel(c), uses: stats.uses || 0, givenCents: stats.given || 0, createdAt: c.created_at,
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
          : c.max_uses != null && c.uses >= c.max_uses ? 'Used up' : '';
        return { ...publicCode(c), channel: c.channel, note: c.note || '', endsOn: c.ends_on, usesLeft: c.max_uses == null ? null : Math.max(0, c.max_uses - c.uses), usable: !why, why };
      }).sort((a, b) => b.usable - a.usable),
    });
  }
  const me = await requireStaff(req, 'settings');
  if (req.method === 'GET') {
    const [list, stats] = [await sql`SELECT * FROM promo_codes WHERE NOT deleted ORDER BY active DESC, created_at DESC`,
      await sql`SELECT promo_code, COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS uses,
                  COALESCE(SUM(discount_cents) FILTER (WHERE status <> 'cancelled' AND payment_status = 'paid'), 0)::int AS given
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
    return res.status(200).json({ ok: true });
  }

  const [cur] = await sql`SELECT * FROM promo_codes WHERE code = ${code}`;
  if (req.method === 'POST') {
    if (!CODE_RE.test(code)) throw new HttpError(400, 'Codes are 3–20 letters, numbers or dashes, like BDAY20.');
    if (cur && !cur.deleted) throw new HttpError(409, `${code} already exists.`);
  } else if (!cur || cur.deleted) throw new HttpError(404, 'Code not found.');

  const val = (k, d) => (b[k] !== undefined ? b[k] : d);
  const kind = val('kind', cur?.kind || 'pct');
  if (!['pct', 'fixed'].includes(kind)) throw new HttpError(400, 'Choose % off or ₱ off.');
  const pesos = (v) => (v === '' || v == null ? null : Math.round(Number(v) * 100));
  let value;
  if (b.value !== undefined) {
    value = kind === 'pct' ? Number(b.value) : pesos(b.value);
    if (kind === 'pct' && !(Number.isInteger(value) && value >= 1 && value <= 100)) throw new HttpError(400, 'Percent off must be a whole number from 1 to 100.');
    if (kind === 'fixed' && !(value >= 100 && value <= 10_000_00)) throw new HttpError(400, 'Peso off must be at least ₱1.');
  } else value = cur?.value;
  if (!value) throw new HttpError(400, 'Enter how much the discount is.');
  const minCents = b.minOrder !== undefined ? pesos(b.minOrder) || 0 : cur?.min_cents || 0;
  const maxOff = kind === 'pct' ? (b.maxOff !== undefined ? pesos(b.maxOff) : cur?.max_off_cents ?? null) : null;
  if (minCents < 0 || (maxOff != null && maxOff < 100)) throw new HttpError(400, 'Check the minimum order and maximum discount.');
  const startsOn = val('startsOn', cur?.starts_on || '') || null, endsOn = val('endsOn', cur?.ends_on || '') || null;
  if ((startsOn && !DATE.test(startsOn)) || (endsOn && !DATE.test(endsOn))) throw new HttpError(400, 'Check the dates.');
  if (startsOn && endsOn && endsOn < startsOn) throw new HttpError(400, 'The end date is before the start date.');
  const mu = val('maxUses', cur?.max_uses ?? '');
  const maxUses = mu === '' || mu == null ? null : parseInt(mu, 10);
  if (maxUses != null && !(maxUses >= 1 && maxUses <= 100000)) throw new HttpError(400, 'Max uses must be 1 or more (or empty for no limit).');
  const channel = val('channel', cur?.channel || 'both');
  if (!['both', 'online', 'pos'].includes(channel)) throw new HttpError(400, 'Choose where the code works.');
  const note = clean(val('note', cur?.note || ''), 120);
  const active = typeof b.active === 'boolean' ? b.active : cur?.deleted ? true : cur?.active ?? true;

  const [c] = await sql`INSERT INTO promo_codes (code, kind, value, min_cents, max_off_cents, starts_on, ends_on, max_uses, channel, note, active, deleted, created_by)
      VALUES (${code}, ${kind}, ${value}, ${minCents}, ${maxOff}, ${startsOn}, ${endsOn}, ${maxUses}, ${channel}, ${note}, ${active}, FALSE, ${me.id})
      ON CONFLICT (code) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, min_cents = EXCLUDED.min_cents, max_off_cents = EXCLUDED.max_off_cents,
        starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on, max_uses = EXCLUDED.max_uses, channel = EXCLUDED.channel,
        note = EXCLUDED.note, active = EXCLUDED.active, deleted = FALSE
      RETURNING *`;
  if (req.method === 'POST') await audit(me, 'code.add', code, { label: codeLabel(c), channel, maxUses, startsOn, endsOn });
  else {
    const was = { label: codeLabel(cur), active: cur.active, maxUses: cur.max_uses, startsOn: cur.starts_on, endsOn: cur.ends_on, channel: cur.channel };
    const now = { label: codeLabel(c), active: c.active, maxUses: c.max_uses, startsOn: c.starts_on, endsOn: c.ends_on, channel: c.channel };
    const changes = Object.fromEntries(Object.keys(was).filter((k) => was[k] !== now[k]).map((k) => [k, [was[k], now[k]]]));
    if (Object.keys(changes).length) await audit(me, 'code.edit', code, changes);
  }
  res.status(req.method === 'POST' ? 201 : 200).json(shape(c));
}