import { body, HttpError, clean } from '../http.js';
import { sql, getSettings, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { businessDate, addDays, DAY_NAMES } from '../time.js';
import { checkAttendance, checkSchedule, scheduleFor, shopPoint, distanceM, dayRow, summarize, datesBetween, schedAt, hm, clockOf, statusText, STATUS } from '../attendance.js';
import { xlsx, pdf } from '../reportfiles.js';
import { ensureSchedules, schedulesQuery, assignmentsQuery, makeResolver, shapeSchedule, t12 } from '../schedules.js';

/** The schedule each person works on each day (see lib/schedules.js). */
export async function resolverFor(cfg, users) {
  await ensureSchedules(cfg);
  const [scheds, asg] = await Promise.all([schedulesQuery(), assignmentsQuery(users.map((u) => u.id))]);
  return makeResolver(cfg, scheds, asg);
}

// ============================================================================ Employee: my attendance
// /api/staff/attendance   (any signed-in staff member; only ever their OWN records)
//   GET  ?month=YYYY-MM                 today + that month's days + totals
//   GET  ?format=xlsx|pdf&from&to       download my DTR
//   POST {action: 'in'|'out', lat, lng, accuracy}   time in / time out (server time; location checked)
const monthRange = (m, today) => {
  const mm = /^\d{4}-\d{2}$/.test(m || '') ? m : today.slice(0, 7);
  const from = `${mm}-01`, last = addDays(`${addDays(`${mm}-28`, 4).slice(0, 7)}-01`, -1);
  return { month: mm, from, to: last < today ? last : today };
};
const firstDay = (u) => businessDate(u.created_at); // no "absent" days before the account existed
const recordsFor = (ids, from, to) => sql`SELECT * FROM attendance WHERE user_id = ANY(${ids}) AND work_date >= ${from} AND work_date <= ${to}`;
export const rowsFor = (u, R, recs, from, to, now) => {
  const by = Object.fromEntries(recs.filter((r) => r.user_id === u.id).map((r) => [r.work_date, r]));
  const start = firstDay(u) > from ? firstDay(u) : from;
  return start > to ? [] : datesBetween(start, to, 400).map((d) => dayRow(by[d], R(u, d), d, now));
};
const publicSched = (s, track) => ({ track, scheduleId: s.scheduleId, name: s.scheduleName, start: s.start, end: s.end, deadline: s.deadline, requiredHours: s.requiredHours, restDays: s.restDays, graceMin: s.graceMin, breakMin: s.breakMin, afterDeadline: s.afterDeadline, location: s.location });

export async function attendance(req, res) {
  const u = await requireStaff(req);
  const s = await getSettings(), cfg = s.attendance, track = scheduleFor(cfg, u).track;
  const now = new Date(), today = businessDate(now);
  const R = await resolverFor(cfg, [u]), sched = R(u, today);
  const shop = sched.lat != null ? { lat: sched.lat, lng: sched.lng, from: 'schedule' } : shopPoint(cfg, s.delivery); // the schedule's work location, else the shop
  if (req.method === 'GET') {
    if (req.query.format) {
      const from = String(req.query.from || ''), to = String(req.query.to || '');
      datesBetween(from, to); // checks the range
      const recs = await recordsFor([u.id], from, to);
      return sendFile(res, String(req.query.format), [{ u, rows: rowsFor(u, R, recs, from, to > today ? today : to, now) }], { from, to, title: `Daily Time Record: ${u.name}` });
    }
    const { month, from, to } = monthRange(String(req.query.month || ''), today);
    const recs = await recordsFor([u.id], from < addDays(today, -1) ? from : addDays(today, -1), today);
    const rows = rowsFor(u, R, recs, from, to, now);
    const todayRec = recs.find((r) => r.work_date === today);
    const openYesterday = recs.find((r) => r.work_date === addDays(today, -1) && r.time_in && !r.time_out);
    return res.status(200).json({
      serverTime: now.toISOString(), today, enabled: cfg.enabled, mustChangePassword: !!u.must_change_pw,
      me: { name: u.name, username: u.username, staffAccess: u.permList.length > 0 },
      schedule: publicSched(sched, track), mySchedule: await mySchedule(u, R, today),
      rules: { requireLocation: cfg.requireLocation, radiusM: cfg.radiusM, blockOutside: cfg.blockOutside, shopSet: !!shop },
      todayRow: dayRow(todayRec, sched, today, now), openYesterday: openYesterday ? { date: openYesterday.work_date, timeIn: openYesterday.time_in } : null,
      month, rows: rows.reverse(), summary: summarize(rows),
    });
  }
  const b = body(req), action = b.action;
  if (action === 'read') { // "Got it" on the notifications
    await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${u.id} AND read_at IS NULL`;
    return res.status(200).json({ ok: true });
  }
  // ---- time in / time out
  if (!cfg.enabled) throw new HttpError(409, "Attendance isn't switched on yet. Ask an admin.");
  if (!track) throw new HttpError(409, "Your account doesn't record attendance. Ask an admin if this is wrong.");
  if (u.must_change_pw) throw new HttpError(403, 'Change your temporary password first.');
  if (!['in', 'out'].includes(action)) throw new HttpError(400, 'Choose time in or time out.');
  const lat = b.lat == null ? null : Number(b.lat), lng = b.lng == null ? null : Number(b.lng), acc = b.accuracy == null ? null : Math.round(Number(b.accuracy));
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (cfg.requireLocation && !hasLoc) throw new HttpError(400, 'Share your location to time ' + action + '. Allow location for this site in your browser, then try again.');
  const dist = hasLoc && shop ? distanceM(lat, lng, shop.lat, shop.lng) : null;
  const slack = Number.isFinite(acc) ? Math.min(Math.max(acc, 0), 50) : 0; // GPS isn't exact: allow up to 50 m of its own error
  const outside = dist != null && dist > cfg.radiusM + slack;
  if (outside && cfg.blockOutside) throw new HttpError(403, `You're about ${fmtDist(dist)} from the shop. Time ${action} only works at the shop (within ${cfg.radiusM} m).`);
  const L = hasLoc ? { lat, lng, acc: Number.isFinite(acc) ? acc : null } : { lat: null, lng: null, acc: null };

  if (action === 'in') {
    const [r] = await sql`INSERT INTO attendance (user_id, work_date, time_in, in_lat, in_lng, in_acc, in_dist_m, in_outside)
      VALUES (${u.id}, ${today}, now(), ${L.lat}, ${L.lng}, ${L.acc}, ${dist}, ${outside})
      ON CONFLICT (user_id, work_date) DO NOTHING RETURNING *`;
    if (!r) {
      const [x] = await sql`SELECT * FROM attendance WHERE user_id = ${u.id} AND work_date = ${today}`;
      throw new HttpError(409, x?.time_out ? `You already timed in (${clockOf(x.time_in)}) and out (${clockOf(x.time_out)}) today.` : `You already timed in today at ${clockOf(x?.time_in)}.`);
    }
    return res.status(200).json({ ok: true, row: dayRow(r, sched, today, new Date()), distM: dist, outside });
  }
  const [r] = await sql`UPDATE attendance SET time_out = now(), out_lat = ${L.lat}, out_lng = ${L.lng}, out_acc = ${L.acc}, out_dist_m = ${dist}, out_outside = ${outside}, updated_at = now()
    WHERE user_id = ${u.id} AND work_date = ${today} AND time_in IS NOT NULL AND time_out IS NULL AND time_in < now() - interval '1 minute' RETURNING *`;
  if (!r) {
    const [x] = await sql`SELECT * FROM attendance WHERE user_id = ${u.id} AND work_date = ${today}`;
    if (!x) throw new HttpError(409, "You haven't timed in today. Time in first.");
    if (x.time_out) throw new HttpError(409, `You already timed out today at ${clockOf(x.time_out)}.`);
    throw new HttpError(409, 'You just timed in. Wait a minute before timing out.');
  }
  res.status(200).json({ ok: true, row: dayRow(r, sched, today, new Date()), distM: dist, outside });
}
async function mySchedule(u, R, today) {
  const cur = R(u, today), nx = R.next(u.id, today), nextSched = nx ? R.schedule(nx.schedule_id) : null;
  const days = (from, n) => Array.from({ length: n }, (_, i) => { const d = addDays(from, i), sc = R(u, d), dow = new Date(d + 'T00:00:00Z').getUTCDay();
    return { date: d, dow, off: sc.restDays.includes(dow), name: sc.scheduleName, start: sc.start, end: sc.end, color: sc.color }; });
  const m0 = today.slice(0, 8) + '01', mDays = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  const notes = await sql`SELECT id, kind, title, body, created_at, read_at FROM notifications WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 20`;
  return {
    current: { ...publicSched(cur, true), daysOffNames: cur.restDays.map((d) => DAY_NAMES[d]) },
    upcoming: nextSched ? { from: nx.start_date, name: nextSched.name, start: nextSched.start, end: nextSched.end, requiredHours: nextSched.requiredHours, daysOff: nextSched.daysOff.map((d) => DAY_NAMES[d]), location: nextSched.location } : null,
    week: days(today, 7), month: days(m0, mDays),
    notifications: notes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.created_at, read: !!n.read_at })),
    unread: notes.filter((n) => !n.read_at).length,
  };
}
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

// ============================================================================ Admin: everyone's attendance
// /api/staff/dtr   (permission: attendance)
//   GET  ?view=today                         today's overview for everyone
//   GET  ?from&to&user?                      records + totals per employee
//   GET  ?format=xlsx|pdf&from&to&user?      download
//   PUT  {settings: {...}}                   rules (start, grace, deadline, hours, break, rest days, location)
//   PUT  {schedule: {userId, track, start, deadline, requiredHours, restDays}}   one employee's schedule ({} = shop rules)
//   PUT  {userId, date, timeIn, timeOut, reason}   add / correct a day (HH:MM, café time; reason required)
//   DELETE {userId, date, reason}            remove a day's record
const employees = async (cfg) => (await sql`SELECT * FROM users WHERE NOT deleted AND active ORDER BY name`).filter((u) => scheduleFor(cfg, u).track);

export async function dtr(req, res) {
  const me = await requireStaff(req, 'attendance');
  const s = await getSettings(), cfg = s.attendance, now = new Date(), today = businessDate(now);
  if (req.method === 'GET') {
    const people = await employees(cfg);
    const R = await resolverFor(cfg, people);
    if (req.query.view === 'today') {
      const recs = await recordsFor(people.map((p) => p.id), addDays(today, -1), today);
      const list = people.map((p) => {
        const row = dayRow(recs.find((r) => r.user_id === p.id && r.work_date === today), R(p, today), today, now);
        const y = recs.find((r) => r.user_id === p.id && r.work_date === addDays(today, -1) && r.time_in && !r.time_out);
        return { user: { id: p.id, name: p.name, username: p.username, role: p.role }, row, openYesterday: !!y };
      });
      const count = (f) => list.filter((x) => f(x.row)).length;
      const overview = {
        employees: list.length, present: count((r) => r.timeIn && r.status !== 'absent'), // timed in after the deadline counts as absent, not present
        onTime: count((r) => r.presence === 'present' && !r.rest), late: count((r) => r.presence === 'late' || r.status === 'late'),
        absent: count((r) => r.status === 'absent'), pending: count((r) => r.status === 'pending'), working: count((r) => r.status === 'working'),
        done: count((r) => r.timeOut), undertime: count((r) => r.completion === 'undertime'), rest: count((r) => r.status === 'rest'),
        outside: count((r) => r.inOutside || r.outOutside), missedTimeOut: list.filter((x) => x.openYesterday).length,
      };
      return res.status(200).json({ today, serverTime: now.toISOString(), overview, list, ...(await settingsView(cfg, s)) });
    }
    const from = String(req.query.from || ''), to = String(req.query.to || '');
    datesBetween(from, to);
    const who = req.query.user ? people.filter((p) => p.id === String(req.query.user)) : people;
    if (req.query.user && !who.length) throw new HttpError(404, 'Employee not found (or attendance is off for them).');
    const recs = await recordsFor(who.map((p) => p.id), from, to);
    const data = who.map((p) => ({ u: p, rows: rowsFor(p, R, recs, from, to > today ? today : to, now) }));
    if (req.query.format) {
      await audit(me, 'dtr.export', `${from} → ${to}${req.query.user ? ' · ' + who[0].name : ' · everyone'}`, { format: req.query.format });
      return sendFile(res, String(req.query.format), data, { from, to, title: who.length === 1 ? `Daily Time Record: ${who[0].name}` : 'Daily Time Record: all employees' });
    }
    return res.status(200).json({ from, to, today, employees: data.map(({ u, rows }) => ({ user: { id: u.id, name: u.name, username: u.username, role: u.role }, summary: summarize(rows), rows })) });
  }

  const b = body(req);
  if (req.method === 'PUT' && b.settings) {
    const next = checkAttendance(b.settings, cfg);
    await sql`UPDATE settings SET attendance = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = 1`;
    await audit(me, 'attendance.settings', '', { from: cfg, to: next });
    return res.status(200).json(await settingsView(next, s));
  }
  if (req.method === 'PUT' && b.schedule) {
    const [u] = await sql`SELECT * FROM users WHERE id = ${String(b.schedule.userId || '')} AND NOT deleted`;
    if (!u) throw new HttpError(404, 'Employee not found.');
    const next = checkSchedule(b.schedule);
    await sql`UPDATE users SET dtr = ${JSON.stringify(next)}::jsonb WHERE id = ${u.id}`;
    await audit(me, 'attendance.schedule', u.name, { from: u.dtr, to: next });
    return res.status(200).json(await settingsView(cfg, s));
  }
  // ---- corrections
  const [u] = await sql`SELECT * FROM users WHERE id = ${String(b.userId || '')} AND NOT deleted`;
  if (!u) throw new HttpError(404, 'Employee not found.');
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose the date.');
  if (date > today) throw new HttpError(400, "You can't enter attendance for a future day.");
  const reason = clean(b.reason, 160);
  if (reason.length < 3) throw new HttpError(400, 'Write the reason for the change (e.g. "forgot to time out, left at 6 PM").');
  const [cur] = await sql`SELECT * FROM attendance WHERE user_id = ${u.id} AND work_date = ${date}`;
  if (req.method === 'DELETE') {
    if (!cur) throw new HttpError(404, 'There is no record on that day.');
    await sql`DELETE FROM attendance WHERE id = ${cur.id}`;
    await audit(me, 'attendance.delete', `${u.name} · ${date}`, { reason, was: { in: cur.time_in, out: cur.time_out } });
    return res.status(200).json({ ok: true });
  }
  const T = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!T.test(b.timeIn || '')) throw new HttpError(400, 'Enter the time in (HH:MM).');
  if (b.timeOut && !T.test(b.timeOut)) throw new HttpError(400, 'Check the time out (HH:MM).');
  const tin = schedAt(date, b.timeIn), tout = b.timeOut ? schedAt(date, b.timeOut) : null;
  if (tin > now || (tout && tout > now)) throw new HttpError(400, "That time hasn't happened yet.");
  if (tout && tout <= tin) throw new HttpError(400, 'The time out must be after the time in.');
  const [r] = await sql`INSERT INTO attendance (user_id, work_date, time_in, time_out, edited_by, edited_at, edit_reason)
    VALUES (${u.id}, ${date}, ${tin.toISOString()}, ${tout ? tout.toISOString() : null}, ${me.id}, now(), ${reason})
    ON CONFLICT (user_id, work_date) DO UPDATE SET time_in = EXCLUDED.time_in, time_out = EXCLUDED.time_out,
      edited_by = EXCLUDED.edited_by, edited_at = now(), edit_reason = EXCLUDED.edit_reason, updated_at = now() RETURNING *`;
  await audit(me, 'attendance.edit', `${u.name} · ${date}`, { reason, from: cur ? { in: clockOf(cur.time_in), out: clockOf(cur.time_out) } : null, to: { in: b.timeIn, out: b.timeOut || '' } });
  const R1 = await resolverFor(cfg, [u]);
  res.status(200).json({ ok: true, row: dayRow(r, R1(u, date), date, now) });
}

const settingsView = async (cfg, s) => {
  const all = await sql`SELECT * FROM users WHERE NOT deleted AND active ORDER BY name`;
  return { settings: cfg, shop: shopPoint(cfg, s.delivery),
    schedules: all.map((p) => ({ user: { id: p.id, name: p.name, username: p.username, role: p.role }, track: scheduleFor(cfg, p).track })) };
};

// ============================================================================ Downloads (Excel / PDF)
const hours = (m) => (m == null ? null : Math.round((m / 60) * 100) / 100);
const notes = (r) => [...r.flags, r.editReason ? `Reason: ${r.editReason}` : ''].filter(Boolean).join('; ');
function sendFile(res, format, data, { from, to, title }) {
  const stamp = `${from}_to_${to}`, sub = `${from} to ${to} · generated ${new Date().toLocaleString('en-PH', { timeZone: process.env.CAFE_TIMEZONE || 'Asia/Manila' })}`;
  const asc = (rows) => [...rows].filter((r) => r.status !== 'future').sort((a, b) => a.date.localeCompare(b.date));
  if (format === 'xlsx') {
    const summary = [['Employee', 'Username', 'Days', 'Present', 'Late', 'Absent', 'Rest days', 'No time-out', 'Undertime days', 'Hours worked', 'Late (min)', 'Undertime (h)', 'Overtime (h)', 'Outside shop area'],
      ...data.map(({ u, rows }) => { const t = summarize(asc(rows)); return [u.name, u.username, t.days, t.present, t.late, t.absent, t.rest, t.incomplete, t.undertimeDays, hours(t.workedMin), t.lateMin, hours(t.undertimeMin), hours(t.overtimeMin), t.outside]; })];
    const detail = [['Employee', 'Date', 'Day', 'Status', 'Time in', 'Time out', 'Hours worked', 'Required (h)', 'Late (min)', 'Undertime (min)', 'Overtime (min)', 'Time-in distance (m)', 'Time-out distance (m)', 'Notes'],
      ...data.flatMap(({ u, rows }) => asc(rows).map((r) => [u.name, r.date, r.day, statusText(r), clockOf(r.timeIn), clockOf(r.timeOut), hours(r.workedMin), r.rest ? 0 : hours(r.requiredMin), r.lateMin || 0, r.undertimeMin || 0, r.overtimeMin || 0, r.inDistM, r.outDistM, notes(r)]))];
    const file = xlsx([
      { name: 'Summary', rows: [[title], [sub], [], ...summary], bold: [0, 3], freeze: 4, widths: [24, 14, 7, 9, 7, 8, 9, 11, 14, 12, 10, 13, 12, 16] },
      { name: 'Daily records', rows: detail, widths: [24, 12, 6, 22, 10, 10, 12, 12, 10, 14, 13, 18, 18, 50] },
    ]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DTR_${stamp}.xlsx"`);
    return res.status(200).send(file);
  }
  if (format === 'pdf') {
    const cols = [{ label: 'Date', w: 64 }, { label: 'Day', w: 30 }, { label: 'Status', w: 120 }, { label: 'Time in', w: 56 }, { label: 'Time out', w: 56 },
      { label: 'Worked', w: 54, align: 'right' }, { label: 'Late', w: 40, align: 'right' }, { label: 'Under', w: 50, align: 'right' }, { label: 'Over', w: 50, align: 'right' }, { label: 'Notes', w: 258 }];
    const sumCols = [{ label: 'Employee', w: 150 }, { label: 'Present', w: 50, align: 'right' }, { label: 'Late', w: 40, align: 'right' }, { label: 'Absent', w: 50, align: 'right' }, { label: 'Rest', w: 40, align: 'right' },
      { label: 'No time-out', w: 66, align: 'right' }, { label: 'Hours worked', w: 76, align: 'right' }, { label: 'Late (min)', w: 60, align: 'right' }, { label: 'Undertime', w: 70, align: 'right' }, { label: 'Overtime', w: 70, align: 'right' }, { label: 'Outside area', w: 106, align: 'right' }];
    const sections = [];
    if (data.length > 1) sections.push({ heading: 'Summary', columns: sumCols, rows: data.map(({ u, rows }) => { const t = summarize(asc(rows)); return [u.name, t.present, t.late, t.absent, t.rest, t.incomplete, hm(t.workedMin), t.lateMin, hm(t.undertimeMin), hm(t.overtimeMin), t.outside]; }) });
    for (const { u, rows } of data) {
      const list = asc(rows), t = summarize(list);
      sections.push({ heading: `${u.name} (${u.username})`, columns: cols,
        rows: list.map((r) => [r.date, r.day, statusText(r), clockOf(r.timeIn), clockOf(r.timeOut), hm(r.workedMin), r.lateMin ? `${r.lateMin}m` : '', r.undertimeMin ? hm(r.undertimeMin) : '', r.overtimeMin ? hm(r.overtimeMin) : '', notes(r)]),
        totals: [[`Totals`, '', `${t.present} present · ${t.late} late · ${t.absent} absent`, '', '', hm(t.workedMin), t.lateMin ? `${t.lateMin}m` : '', hm(t.undertimeMin), hm(t.overtimeMin), t.incomplete ? `${t.incomplete} day(s) with no time-out` : '']] });
    }
    if (!data.length) sections.push({ heading: 'No employees to show', columns: cols, rows: [] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DTR_${stamp}.pdf"`);
    return res.status(200).send(pdf({ title: `Demetria's Diner · ${title}`, subtitle: sub, sections }));
  }
  throw new HttpError(400, 'Choose Excel or PDF.');
}
export { STATUS, DAY_NAMES };