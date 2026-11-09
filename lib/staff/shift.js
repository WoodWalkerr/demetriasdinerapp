import crypto from 'node:crypto';
import { body, HttpError, clean, centsOf } from '../http.js';
import { sql, audit } from '../db.js';
import { requireStaff, requireShift } from '../auth.js';
import { CASH_CATEGORIES } from '../menu.js';
import { shiftSummary } from '../shifts.js';

// /api/staff/shift
//   GET                                       your open shift (live totals) + recent shifts
//   POST {action:'open', openingCents}        start your shift with the cash in the drawer
//   POST {action:'close', countedCents, note, shiftId?}   count the drawer and close
//        (staff with "sales" permission can close someone else's forgotten shift via shiftId)
//   GET ?id=<shiftId>                         one shift's full summary (yours, or any with "sales")
export async function shift(req, res) {
  const u = await requireStaff(req);
  if (req.method === 'GET') {
    if (req.query.id) {
      const s = await shiftSummary(String(req.query.id));
      if (!s || (s.userId !== u.id && !u.can('sales'))) throw new HttpError(404, 'Shift not found.');
      return res.status(200).json(s);
    }
    const mine = u.shift_id ? await shiftSummary(u.shift_id) : null;
    const recent = u.can('sales')
      ? await sql`SELECT s.id, s.opened_at, s.closed_at, s.opening_cents, s.counted_cents, s.expected_cents, u.name AS user_name, s.user_id
                  FROM shifts s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.opened_at DESC LIMIT 30`
      : await sql`SELECT s.id, s.opened_at, s.closed_at, s.opening_cents, s.counted_cents, s.expected_cents, u.name AS user_name, s.user_id
                  FROM shifts s LEFT JOIN users u ON u.id = s.user_id WHERE s.user_id = ${u.id} ORDER BY s.opened_at DESC LIMIT 15`;
    return res.status(200).json({
      current: mine, cashCategories: CASH_CATEGORIES,
      recent: recent.map((s) => ({
        id: s.id, staffName: s.user_name || 'Former staff', openedAt: s.opened_at, closedAt: s.closed_at,
        openingCents: s.opening_cents, countedCents: s.counted_cents, expectedCents: s.expected_cents,
        overShortCents: s.counted_cents == null || s.expected_cents == null ? null : s.counted_cents - s.expected_cents,
        mine: s.user_id === u.id,
      })),
    });
  }

  const b = body(req);
  if (b.action === 'open') {
    if (u.shift_id) throw new HttpError(409, 'Your shift is already open.');
    const opening = centsOf(b.openingCents, { label: 'Opening cash' });
    try {
      await sql`INSERT INTO shifts (id, user_id, opening_cents) VALUES (${crypto.randomUUID()}, ${u.id}, ${opening})`;
    } catch { throw new HttpError(409, 'Your shift is already open.'); }
    const [s] = await sql`SELECT id FROM shifts WHERE user_id = ${u.id} AND closed_at IS NULL`;
    await audit(u, 'shift.open', u.name, { openingCents: opening });
    return res.status(201).json(await shiftSummary(s.id));
  }
  if (b.action === 'close') {
    let shiftId = u.shift_id;
    if (b.shiftId && b.shiftId !== u.shift_id) {
      if (!u.can('sales')) throw new HttpError(403, "Only managers can close someone else's shift.");
      shiftId = String(b.shiftId);
    }
    if (!shiftId) throw new HttpError(409, "You don't have an open shift.");
    const counted = centsOf(b.countedCents, { label: 'Counted cash' });
    const before = await shiftSummary(shiftId);
    if (!before || before.closedAt) throw new HttpError(409, 'That shift is already closed.');
    const summary = { ...before, countedCents: counted, overShortCents: counted - before.expectedCashCents, moves: undefined };
    await sql`UPDATE shifts SET closed_at = now(), counted_cents = ${counted}, expected_cents = ${before.expectedCashCents},
        note = ${clean(b.note, 300)}, summary = ${JSON.stringify(summary)}::jsonb, closed_by = ${u.id}
      WHERE id = ${shiftId} AND closed_at IS NULL`;
    await audit(u, 'shift.close', before.staffName || '', { countedCents: counted, expectedCents: before.expectedCashCents, overShortCents: counted - before.expectedCashCents, closedFor: shiftId !== u.shift_id ? before.staffName : undefined });
    return res.status(200).json(await shiftSummary(shiftId));
  }
  throw new HttpError(400, 'Unknown action.');
}

// /api/staff/cash  (permission: cash; needs an open shift)
//   POST {kind:'in'|'out', cents, category, note}
//   Entries can't be edited or deleted; correct a mistake with an opposite entry.
export async function cash(req, res) {
  const u = await requireStaff(req, 'cash');
  const shiftId = requireShift(u);
  const b = body(req);
  if (!['in', 'out'].includes(b.kind)) throw new HttpError(400, 'Choose Cash in or Cash out.');
  const cents = centsOf(b.cents, { min: 1, label: 'Amount' });
  const category = CASH_CATEGORIES[b.kind].includes(b.category) ? b.category : null;
  if (!category) throw new HttpError(400, 'Choose a category.');
  const note = clean(b.note, 200);
  if (b.kind === 'out' && note.length < 3) throw new HttpError(400, 'Add a short note for cash out (what was bought).');
  await sql`INSERT INTO cash_moves (id, shift_id, user_id, kind, cents, category, note)
    VALUES (${crypto.randomUUID()}, ${shiftId}, ${u.id}, ${b.kind}, ${cents}, ${category}, ${note})`;
  await audit(u, b.kind === 'in' ? 'cash.in' : 'cash.out', category, { cents, note });
  res.status(201).json(await shiftSummary(shiftId));
}
