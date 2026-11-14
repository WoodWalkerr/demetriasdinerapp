// Payroll (admins only): daily-rate pay computed from the DTR.
//
// Periods: "1" = 1st–15th (paid on the 15th) · "2" = 16th–end of month (paid on the 30th; the 28th/29th in February).
// Per employee, per period (all money in centavos, rounded to the centavo per line):
//   Days worked   = days with a time-in that don't count as absent (rest-day work counts too)
//   Basic         = days worked × daily rate
//   Per minute    = daily rate ÷ that day's required minutes (10 hours = 600 min)   (for late / undertime)
//   Overtime      = overtime hours × the employee's overtime rate in pesos per hour (set by you; not a % of the daily rate)
//                   [or your own hours / rate / amount for that period]
//   Late          = late minutes × per-minute rate      (if "deduct late" is on)       [or your own amount]
//   Undertime     = undertime minutes × per-minute rate (if "deduct undertime" is on)  [or your own amount]
//   Net           = basic + overtime + additions − late − undertime − deductions (SSS, PhilHealth, Pag-IBIG, cash advance…)
//                   − damages (broken / damaged items: each with its reason)
// "Finalize" freezes the numbers (a snapshot), so later changes to rates, schedules or the DTR don't change a paid payroll.
import { HttpError, clean } from './http.js';
import { addDays } from './time.js';

export const PAY_DEFAULTS = { dailyCents: 0, otRateCents: 0, deductLate: true, deductUndertime: true };
/** Pay settings; a rate saved before "₱ per overtime hour" existed starts from its old % (you can change it). */
export function payOf(u) {
  const p = { ...PAY_DEFAULTS, ...(u.pay || {}) };
  if (u.pay && u.pay.otRateCents == null && u.pay.dailyCents) p.otRateCents = Math.round((u.pay.dailyCents / 10) * (u.pay.otPct || 125) / 100);
  delete p.otPct;
  return p;
}

export function checkPay(x, cur = PAY_DEFAULTS) {
  const n = { ...PAY_DEFAULTS, ...cur };
  if (x.dailyRate !== undefined) {
    const v = Math.round(Number(x.dailyRate) * 100);
    if (!Number.isFinite(v) || v < 0 || v > 10_000_000) throw new HttpError(400, 'Enter the daily rate in pesos (e.g. 610).');
    n.dailyCents = v;
  }
  if (x.otRate !== undefined) {
    const v = x.otRate === '' || x.otRate == null ? 0 : Math.round(Number(x.otRate) * 100);
    if (!Number.isFinite(v) || v < 0 || v > 1_000_000) throw new HttpError(400, 'Enter the overtime rate in pesos per hour (e.g. 75).');
    n.otRateCents = v;
  }
  delete n.otPct;
  if (typeof x.deductLate === 'boolean') n.deductLate = x.deductLate;
  if (typeof x.deductUndertime === 'boolean') n.deductUndertime = x.deductUndertime;
  return n;
}

/** '2026-11-1' → 1st–15th · '2026-11-2' → 16th–end. */
export function periodOf(id) {
  const m = /^(\d{4})-(\d{2})-([12])$/.exec(String(id || ''));
  if (!m) throw new HttpError(400, 'Choose the payroll period.');
  const [y, mo, half] = [+m[1], +m[2], m[3]];
  if (mo < 1 || mo > 12) throw new HttpError(400, 'Choose the payroll period.');
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(), pad = (n) => String(n).padStart(2, '0');
  const from = `${y}-${pad(mo)}-${half === '1' ? '01' : '16'}`, to = `${y}-${pad(mo)}-${half === '1' ? '15' : pad(last)}`;
  const payDay = half === '1' ? 15 : Math.min(30, last);
  const monthName = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-PH', { month: 'long', timeZone: 'UTC' });
  return { id: `${y}-${pad(mo)}-${half}`, from, to, half: +half, payDate: `${y}-${pad(mo)}-${pad(payDay)}`,
    label: `${monthName} ${half === '1' ? 1 : 16}–${half === '1' ? 15 : last}, ${y}`, short: `${half === '1' ? '15th' : '30th'} · ${monthName} ${y}` };
}
/** The period a date belongs to. */
export const periodForDate = (d) => `${d.slice(0, 7)}-${+d.slice(8, 10) <= 15 ? 1 : 2}`;
export const prevPeriod = (id) => { const p = periodOf(id); return periodForDate(addDays(p.from, -1)); };
export const nextPeriod = (id) => { const p = periodOf(id); return periodForDate(addDays(p.to, 1)); };

/** Manual changes for one employee in one period (from the payroll screen). */
export function checkItem(x) {
  const out = {};
  const money = (v, label) => { if (v === '' || v == null) return undefined; const c = Math.round(Number(v) * 100); if (!Number.isFinite(c) || c < 0 || c > 100_000_000) throw new HttpError(400, `Check the ${label}.`); return c; };
  if (x.daysWorked !== undefined && x.daysWorked !== '' && x.daysWorked !== null) { const v = Number(x.daysWorked); if (!(v >= 0 && v <= 31) || Math.round(v * 2) !== v * 2) throw new HttpError(400, 'Days worked must be 0 to 31 (halves allowed).'); out.daysWorked = v; }
  if (x.otHours !== undefined && x.otHours !== '' && x.otHours !== null) { const v = Number(x.otHours); if (!(v >= 0 && v <= 300)) throw new HttpError(400, 'Check the overtime hours.'); out.otMin = Math.round(v * 60); }
  const ot = money(x.otAmount, 'overtime amount'); if (ot !== undefined) out.otCents = ot;
  const otr = money(x.otRate, 'overtime rate'); if (otr !== undefined) out.otRateCents = otr;
  if (x.lateNote !== undefined) out.lateNote = clean(x.lateNote, 80);
  if (x.utNote !== undefined) out.utNote = clean(x.utNote, 80);
  const la = money(x.lateDeduct, 'late deduction'); if (la !== undefined) out.lateCents = la;
  const ut = money(x.undertimeDeduct, 'undertime deduction'); if (ut !== undefined) out.utCents = ut;
  if (x.lines !== undefined) {
    if (!Array.isArray(x.lines) || x.lines.length > 40) throw new HttpError(400, 'Up to 40 lines.');
    out.lines = x.lines.map((l) => {
      const kind = ['add', 'deduct', 'damage'].includes(l?.kind) ? l.kind : 'deduct';
      const label = clean(l?.label, 80);
      if (!label) throw new HttpError(400, kind === 'damage' ? 'Write what was damaged and why (e.g. "Broke 2 glass mugs").' : 'Each item needs a description (e.g. SSS, Cash advance, Allowance).');
      const cents = money(l?.amount, `amount for "${label}"`); if (!cents) throw new HttpError(400, `Enter the amount for "${label}".`);
      return { kind, label, cents };
    });
  }
  if (x.note !== undefined) out.note = clean(x.note, 200);
  return out;
}

const r2 = (n) => Math.round(n); // centavos
/** One employee's pay for the period from their DTR rows (see lib/attendance.js dayRow) + manual changes. */
export function computePay(pay, rows, item = {}) {
  const days = rows.filter((r) => r.status !== 'future');
  const worked = days.filter((r) => r.timeIn && r.status !== 'absent');
  const per = (r) => (pay.dailyCents && r.requiredMin ? pay.dailyCents / r.requiredMin : 0); // centavos per minute that day
  const auto = {
    daysWorked: worked.length,
    otMin: worked.reduce((a, r) => a + (r.overtimeMin || 0), 0),
    lateMin: worked.reduce((a, r) => a + (r.lateMin || 0), 0),
    utMin: worked.reduce((a, r) => a + (r.undertimeMin || 0), 0),
  };
  auto.otCents = r2((auto.otMin / 60) * pay.otRateCents);
  auto.lateCents = pay.deductLate ? r2(worked.reduce((a, r) => a + (r.lateMin || 0) * per(r), 0)) : 0;
  auto.utCents = pay.deductUndertime ? r2(worked.reduce((a, r) => a + (r.undertimeMin || 0) * per(r), 0)) : 0;
  const daysWorked = item.daysWorked ?? auto.daysWorked;
  const otMin = item.otMin ?? auto.otMin, otRateCents = item.otRateCents ?? pay.otRateCents;
  const otCents = item.otCents ?? r2((otMin / 60) * otRateCents);
  const lateCents = item.lateCents ?? auto.lateCents, utCents = item.utCents ?? auto.utCents;
  const basicCents = r2(daysWorked * pay.dailyCents);
  const lines = item.lines || [];
  const addCents = lines.filter((l) => l.kind === 'add').reduce((a, l) => a + l.cents, 0);
  const dedCents = lines.filter((l) => l.kind === 'deduct').reduce((a, l) => a + l.cents, 0);
  const damageCents = lines.filter((l) => l.kind === 'damage').reduce((a, l) => a + l.cents, 0);
  const grossCents = basicCents + otCents + addCents;
  const totalDeductCents = lateCents + utCents + dedCents + damageCents;
  const lateNote = item.lateNote || (lateCents ? (item.lateCents != null ? 'Set by admin' : `${auto.lateMin} min late`) : '');
  const utNote = item.utNote || (utCents ? (item.utCents != null ? 'Set by admin' : `${auto.utMin} min short`) : '');
  const flags = [];
  if (!pay.dailyCents) flags.push('No daily rate set');
  if (otMin > 0 && !otRateCents && item.otCents == null) flags.push('Overtime worked but no overtime rate (₱/hour) set');
  const nto = days.filter((r) => r.status === 'no_timeout').length; if (nto) flags.push(`${nto} day(s) with no time-out (hours not counted)`);
  const outside = days.filter((r) => r.inOutside || r.outOutside).length; if (outside) flags.push(`${outside} time-in/out outside the shop area`);
  return {
    dailyCents: pay.dailyCents, otRateCents, deductLate: pay.deductLate, deductUndertime: pay.deductUndertime, damageCents, lateNote, utNote,
    daysWorked, absentDays: days.filter((r) => r.status === 'absent').length, restDays: days.filter((r) => r.status === 'rest').length,
    lateDays: worked.filter((r) => r.lateMin > 0).length, lateMin: auto.lateMin, utMin: auto.utMin, otMin, workedMin: worked.reduce((a, r) => a + (r.workedMin || 0), 0),
    basicCents, otCents, lateCents, utCents, addCents, dedCents, grossCents, totalDeductCents, netCents: grossCents - totalDeductCents,
    lines, note: item.note || '', auto: { ...auto, otRateCents: pay.otRateCents }, edited: Object.keys(item).filter((k) => !['lines', 'note', 'lateNote', 'utNote'].includes(k)), flags,
  };
}