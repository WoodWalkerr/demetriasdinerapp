import { body, HttpError } from '../http.js';
import { sql, getSettings, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { businessDate } from '../time.js';
import { scheduleFor, summarize, hm } from '../attendance.js';
import { payOf, checkPay, periodOf, periodForDate, checkItem, computePay } from '../payroll.js';
import { resolverFor, rowsFor } from './dtr.js';
import { xlsx, pdf } from '../reportfiles.js';

// /api/staff/payroll   (permission: payroll: confidential, admins only by default)
//   GET  ?rates=1                                 everyone's pay settings
//   PUT  {rates: {userId, dailyRate, otPct, deductLate, deductUndertime}}
//   GET  ?list=1                                  payroll periods made so far
//   GET  ?period=YYYY-MM-1|2                      that period: every employee's breakdown (live from the DTR unless finalized)
//   GET  ?period=…&format=xlsx|pdf[&user=ID][&inline=1]   summary, or one employee's payslip (inline = open to print)
//   PUT  {period, userId, item: {daysWorked?, otHours?, otAmount?, lateDeduct?, undertimeDeduct?, lines?: [{kind, label, amount}], note?}}
//   POST {period, action: 'finalize' | 'reopen'}
const peso = (c) => '₱' + (c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const people = async (cfg) => (await sql`SELECT * FROM users WHERE NOT deleted ORDER BY name`).filter((u) => (u.active && scheduleFor(cfg, u).track) || payOf(u).dailyCents > 0);
const who = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active });

async function build(cfg, periodId) {
  const p = periodOf(periodId), today = businessDate();
  const [run] = await sql`SELECT * FROM payroll_runs WHERE period = ${p.id}`;
  if (run?.status === 'final' && run.snapshot) return { ...run.snapshot, period: p, status: 'final', finalizedAt: run.finalized_at };
  const ps = await people(cfg);
  const R = await resolverFor(cfg, ps);
  const to = p.to < today ? p.to : today;
  const recs = p.from <= today ? await sql`SELECT * FROM attendance WHERE user_id = ANY(${ps.map((u) => u.id)}) AND work_date >= ${p.from} AND work_date <= ${to}` : [];
  const items = run?.items || {};
  const employees = ps.map((u) => {
    const rows = p.from <= today ? rowsFor(u, R, recs, p.from, to, new Date()) : [];
    return { user: who(u), dtr: summarize(rows), calc: computePay(payOf(u), rows, items[u.id] || {}) };
  }).filter((e) => e.user.active || e.calc.daysWorked > 0);
  const totals = employees.reduce((t, e) => {
    for (const k of ['basicCents', 'otCents', 'addCents', 'lateCents', 'utCents', 'dedCents', 'grossCents', 'totalDeductCents', 'netCents']) t[k] = (t[k] || 0) + e.calc[k];
    t.daysWorked = (t.daysWorked || 0) + e.calc.daysWorked; return t;
  }, {});
  return { period: p, status: run?.status || 'new', complete: p.to <= today, today, employees, totals };
}

export async function payroll(req, res) {
  const me = await requireStaff(req, 'payroll');
  const cfg = (await getSettings()).attendance;
  if (req.method === 'GET') {
    if (req.query.rates) {
      const ps = await people(cfg);
      return res.status(200).json({ employees: ps.map((u) => ({ user: who(u), pay: payOf(u) })) });
    }
    if (req.query.list) {
      const runs = await sql`SELECT period, status, finalized_at, updated_at FROM payroll_runs ORDER BY period DESC LIMIT 48`;
      return res.status(200).json({ current: periodForDate(businessDate()), runs: runs.map((r) => ({ ...periodOf(r.period), status: r.status, finalizedAt: r.finalized_at, updatedAt: r.updated_at })) });
    }
    const data = await build(cfg, String(req.query.period || ''));
    if (req.query.format) {
      const one = req.query.user ? data.employees.find((e) => e.user.id === String(req.query.user)) : null;
      if (req.query.user && !one) throw new HttpError(404, 'That employee is not in this payroll.');
      await audit(me, 'payroll.export', `${data.period.id}${one ? ' · payslip ' + one.user.name : ' · summary'}`, { format: req.query.format });
      return sendFile(res, String(req.query.format), data, one, req.query.inline === '1');
    }
    return res.status(200).json(data);
  }
  const b = body(req);
  if (req.method === 'PUT' && b.rates) {
    const [u] = await sql`SELECT * FROM users WHERE id = ${String(b.rates.userId || '')} AND NOT deleted`;
    if (!u) throw new HttpError(404, 'Employee not found.');
    const next = checkPay(b.rates, payOf(u));
    await sql`UPDATE users SET pay = ${JSON.stringify(next)}::jsonb WHERE id = ${u.id}`;
    await audit(me, 'payroll.rate', u.name); // amounts stay out of the Activity log (it's confidential)
    return res.status(200).json({ ok: true, pay: next });
  }
  const p = periodOf(b.period);
  const [run] = await sql`SELECT * FROM payroll_runs WHERE period = ${p.id}`;
  if (req.method === 'PUT') {
    if (run?.status === 'final') throw new HttpError(409, 'This payroll is finalized. Reopen it to make changes.');
    const [u] = await sql`SELECT id, name FROM users WHERE id = ${String(b.userId || '')}`;
    if (!u) throw new HttpError(404, 'Employee not found.');
    const item = b.clear ? null : checkItem(b.item || {});
    await sql`INSERT INTO payroll_runs (period, period_from, period_to, items, created_by) VALUES (${p.id}, ${p.from}, ${p.to}, ${JSON.stringify(item ? { [u.id]: item } : {})}::jsonb, ${me.id})
      ON CONFLICT (period) DO UPDATE SET items = CASE WHEN ${!item}::boolean THEN payroll_runs.items - ${u.id}::text ELSE payroll_runs.items || ${JSON.stringify(item ? { [u.id]: item } : {})}::jsonb END, updated_at = now()`;
    await audit(me, 'payroll.edit', `${p.id} · ${u.name}`);
    return res.status(200).json(await build(cfg, p.id));
  }
  if (b.action === 'finalize') {
    if (run?.status === 'final') throw new HttpError(409, 'Already finalized.');
    const data = await build(cfg, p.id);
    if (!data.complete) throw new HttpError(409, `This period isn't over yet (it ends ${p.to}). Finalize on or after the ${p.half === 1 ? '15th' : 'last day'}.`);
    if (!data.employees.length) throw new HttpError(409, 'There is nobody in this payroll.');
    const snap = { employees: data.employees, totals: data.totals, complete: true };
    await sql`INSERT INTO payroll_runs (period, period_from, period_to, status, snapshot, created_by, finalized_by, finalized_at) VALUES (${p.id}, ${p.from}, ${p.to}, 'final', ${JSON.stringify(snap)}::jsonb, ${me.id}, ${me.id}, now())
      ON CONFLICT (period) DO UPDATE SET status = 'final', snapshot = EXCLUDED.snapshot, finalized_by = ${me.id}, finalized_at = now(), updated_at = now()`;
    await audit(me, 'payroll.finalize', p.id, { people: data.employees.length });
    return res.status(200).json(await build(cfg, p.id));
  }
  if (b.action === 'reopen') {
    if (run?.status !== 'final') throw new HttpError(409, 'This payroll is not finalized.');
    await sql`UPDATE payroll_runs SET status = 'draft', snapshot = NULL, finalized_by = NULL, finalized_at = NULL, updated_at = now() WHERE period = ${p.id}`;
    await audit(me, 'payroll.reopen', p.id);
    return res.status(200).json(await build(cfg, p.id));
  }
  throw new HttpError(400, 'Unknown payroll action.');
}

// ---------------------------------------------------------------- files
function sendFile(res, format, data, one, inline) {
  const P = data.period, num = (c) => Math.round(c) / 100, hrs = (m) => Math.round((m / 60) * 100) / 100;
  const status = data.status === 'final' ? 'FINALIZED' : 'DRAFT (not finalized)';
  const name = one ? `Payslip_${one.user.username}_${P.id}` : `Payroll_${P.id}`;
  const disp = (ext) => `${inline ? 'inline' : 'attachment'}; filename="${name}.${ext}"`;
  if (format === 'xlsx') {
    const sheets = one ? [payslipSheet(P, one, status)] : [
      { name: 'Payroll summary', freeze: 4, bold: [0, 3, 4 + data.employees.length],
        widths: [24, 12, 12, 14, 10, 12, 12, 12, 12, 14, 14, 14, 14],
        rows: [[`Payroll · ${P.label} · pay date ${P.payDate}`], [status], [],
          ['Employee', 'Days worked', 'Daily rate', 'Basic pay', 'OT hours', 'OT pay', 'Additions', 'Late', 'Undertime', 'Other deductions', 'Total deductions', 'Gross pay', 'NET PAY'],
          ...data.employees.map(({ user, calc: c }) => [user.name, c.daysWorked, num(c.dailyCents), num(c.basicCents), hrs(c.otMin), num(c.otCents), num(c.addCents), num(c.lateCents), num(c.utCents), num(c.dedCents), num(c.totalDeductCents), num(c.grossCents), num(c.netCents)]),
          ['TOTAL', data.totals.daysWorked || 0, null, num(data.totals.basicCents || 0), null, num(data.totals.otCents || 0), num(data.totals.addCents || 0), num(data.totals.lateCents || 0), num(data.totals.utCents || 0), num(data.totals.dedCents || 0), num(data.totals.totalDeductCents || 0), num(data.totals.grossCents || 0), num(data.totals.netCents || 0)]] },
      ...data.employees.map((e) => payslipSheet(P, e, status)),
    ];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', disp('xlsx'));
    return res.status(200).send(xlsx(sheets));
  }
  if (format === 'pdf') {
    const sections = one ? payslipSections(one) : [{
      heading: `Summary (${data.employees.length} employee${data.employees.length === 1 ? '' : 's'})`,
      columns: [{ label: 'Employee', w: 140 }, { label: 'Days', w: 36, align: 'right' }, { label: 'Daily rate', w: 62, align: 'right' }, { label: 'Basic', w: 70, align: 'right' }, { label: 'OT hrs', w: 42, align: 'right' },
        { label: 'OT pay', w: 62, align: 'right' }, { label: 'Additions', w: 62, align: 'right' }, { label: 'Late', w: 52, align: 'right' }, { label: 'Undertime', w: 58, align: 'right' }, { label: 'Other ded.', w: 62, align: 'right' }, { label: 'NET PAY', w: 80, align: 'right' }],
      rows: data.employees.map(({ user, calc: c }) => [user.name, c.daysWorked, peso(c.dailyCents), peso(c.basicCents), hrs(c.otMin), peso(c.otCents), peso(c.addCents), peso(c.lateCents), peso(c.utCents), peso(c.dedCents), peso(c.netCents)]),
      totals: [['TOTAL', data.totals.daysWorked || 0, '', peso(data.totals.basicCents || 0), '', peso(data.totals.otCents || 0), peso(data.totals.addCents || 0), peso(data.totals.lateCents || 0), peso(data.totals.utCents || 0), peso(data.totals.dedCents || 0), peso(data.totals.netCents || 0)]],
    }];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', disp('pdf'));
    return res.status(200).send(pdf({ title: `Demetria's Diner · ${one ? `Payslip: ${one.user.name}` : 'Payroll summary'}`, subtitle: `${P.label} · pay date ${P.payDate} · ${status}`, sections }));
  }
  throw new HttpError(400, 'Choose Excel or PDF.');
}
function payslipSheet(P, { user, dtr, calc: c }, status) {
  const n = (x) => Math.round(x) / 100;
  return { name: user.name.slice(0, 31), freeze: 0, bold: [0, 4, 13, 20], widths: [34, 18, 40],
    rows: [[`Payslip · ${user.name} (${user.username})`], [`${P.label} · pay date ${P.payDate}`], [status], [],
      ['ATTENDANCE', '', ''], ['Days worked', c.daysWorked, ''], ['Absent', c.absentDays, ''], ['Rest days', c.restDays, ''], ['Late', `${c.lateDays} day(s)`, `${c.lateMin} min`], ['Undertime', hm(c.utMin), ''], ['Overtime', hm(c.otMin), ''], ['Hours worked', hm(c.workedMin), ''], [],
      ['EARNINGS', 'Amount', 'Details'], ['Basic pay', n(c.basicCents), `${c.daysWorked} day(s) × ₱${n(c.dailyCents)}`], ['Overtime pay', n(c.otCents), `${hm(c.otMin)} at ${c.otPct}%`],
      ...c.lines.filter((l) => l.kind === 'add').map((l) => [l.label, n(l.cents), 'Adjustment']), ['Gross pay', n(c.grossCents), ''], [], [],
      ['DEDUCTIONS', 'Amount', 'Details'], ['Late', n(c.lateCents), c.deductLate ? `${c.lateMin} min` : 'not deducted'], ['Undertime', n(c.utCents), c.deductUndertime ? hm(c.utMin) : 'not deducted'],
      ...c.lines.filter((l) => l.kind === 'deduct').map((l) => [l.label, n(l.cents), '']), ['Total deductions', n(c.totalDeductCents), ''], [],
      ['NET PAY', n(c.netCents), c.note || ''], ...(c.flags.length ? [[], ['Notes', c.flags.join('; '), '']] : [])] };
}
function payslipSections({ user, calc: c }) {
  const cols = [{ label: 'Item', w: 260 }, { label: 'Details', w: 260 }, { label: 'Amount', w: 140, align: 'right' }];
  return [
    { heading: `${user.name} (@${user.username})`, columns: [{ label: 'Days worked', w: 110, align: 'right' }, { label: 'Absent', w: 90, align: 'right' }, { label: 'Late', w: 120, align: 'right' }, { label: 'Undertime', w: 110, align: 'right' }, { label: 'Overtime', w: 110, align: 'right' }, { label: 'Hours worked', w: 120, align: 'right' }],
      rows: [[c.daysWorked, c.absentDays, `${c.lateDays} day(s) · ${c.lateMin} min`, hm(c.utMin), hm(c.otMin), hm(c.workedMin)]] },
    { heading: 'Earnings', columns: cols, rows: [['Basic pay', `${c.daysWorked} day(s) × ${peso(c.dailyCents)}`, peso(c.basicCents)], ['Overtime pay', `${hm(c.otMin)} at ${c.otPct}%`, peso(c.otCents)],
      ...c.lines.filter((l) => l.kind === 'add').map((l) => [l.label, 'Adjustment', peso(l.cents)])], totals: [['Gross pay', '', peso(c.grossCents)]] },
    { heading: 'Deductions', columns: cols, rows: [['Late', c.deductLate ? `${c.lateMin} min` : 'not deducted', peso(c.lateCents)], ['Undertime', c.deductUndertime ? hm(c.utMin) : 'not deducted', peso(c.utCents)],
      ...c.lines.filter((l) => l.kind === 'deduct').map((l) => [l.label, '', peso(l.cents)])], totals: [['Total deductions', '', peso(c.totalDeductCents)]] },
    { heading: '', columns: cols.map((x) => ({ ...x, label: '' })), rows: [], totals: [['NET PAY', c.note || '', peso(c.netCents)]] },
    ...(c.flags.length ? [{ heading: 'Notes', columns: [{ label: '', w: 660 }], rows: c.flags.map((f) => [f]) }] : []),
    { heading: '', columns: [{ label: 'Received by: ______________________________', w: 330 }, { label: 'Date: ________________', w: 330 }], rows: [] },
  ];
}