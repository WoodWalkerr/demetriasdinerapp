import crypto from 'node:crypto';
import { body, HttpError } from '../http.js';
import { sql, batch, getSettings, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { businessDate, addDays, DAY_NAMES } from '../time.js';
import { scheduleFor } from '../attendance.js';
import { checkSchedule, shapeSchedule, scheduleLine, ensureSchedules, schedulesQuery, assignmentsQuery, overridesQuery, makeResolver, notify, peopleOn, lockedUntil, t12 } from '../schedules.js';

// /api/staff/schedules   (permission: attendance)
//   GET  ?week=YYYY-MM-DD                  schedules, employees (current / upcoming), a 7-day grid from that date
//   POST {schedule: {...}}                 create a schedule
//   PUT  {id, schedule: {...}}             edit (everyone on it is notified)
//   PUT  {id, makeDefault: true}           make it the default (for people without an assignment)
//   DELETE {id}                            delete (only if nobody is on it now or later)
//   POST {assign: {scheduleId, userIds: [...], from: 'YYYY-MM-DD'}}   assign one or many people, starting that day
//   POST {day: {userId, date, scheduleId | 'off' | null}}             change ONE day only (null = back to the usual); today or later
const niceDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const D = /^\d{4}-\d{2}-\d{2}$/;

export async function schedules(req, res) {
  const me = await requireStaff(req, 'attendance');
  const cfg = (await getSettings()).attendance, today = businessDate();
  await ensureSchedules(cfg);
  if (req.method === 'GET') return res.status(200).json(await view(cfg, today, String(req.query.week || ''), String(req.query.mode || '')));
  const b = body(req);

  if (req.method === 'POST' && b.assign) {
    const a = b.assign, from = D.test(a.from || '') ? a.from : today;
    const [s] = await sql`SELECT * FROM work_schedules WHERE id = ${String(a.scheduleId || '')} AND NOT deleted`;
    if (!s) throw new HttpError(404, 'Choose a schedule.');
    const ids = [...new Set((Array.isArray(a.userIds) ? a.userIds : []).map(String))];
    if (!ids.length) throw new HttpError(400, 'Choose at least one employee.');
    if (ids.length > 200) throw new HttpError(400, 'Up to 200 people at a time.');
    const users = await sql`SELECT * FROM users WHERE id = ANY(${ids}) AND NOT deleted`;
    if (users.length !== ids.length) throw new HttpError(404, 'One of those employees was not found.');
    const locked = await lockedUntil();
    if (locked && from <= locked) throw new HttpError(409, `Payroll up to ${niceDate(locked)} is finalized, so schedules before ${niceDate(addDays(locked, 1))} can't change. Choose a later start date (or reopen that payroll).`);
    if (from < addDays(today, -62)) throw new HttpError(400, 'The start date is too far back (max 2 months).');
    const S = shapeSchedule(s);
    // From that day on, this replaces what each person had: later assignments are removed and the current one ends the day before.
    // So nobody ever has two schedules on the same day.
    await batch(users.flatMap((u) => [
      sql`DELETE FROM schedule_assignments WHERE user_id = ${u.id} AND start_date >= ${from}`,
      sql`UPDATE schedule_assignments SET end_date = ${addDays(from, -1)} WHERE user_id = ${u.id} AND start_date < ${from} AND (end_date IS NULL OR end_date >= ${from})`,
      sql`INSERT INTO schedule_assignments (user_id, schedule_id, start_date, created_by) VALUES (${u.id}, ${s.id}, ${from}, ${me.id})`,
    ]).concat([
      notify(users.map((u) => u.id), 'schedule', `Your schedule${from > today ? ` from ${niceDate(from)}` : ''}: ${S.name}`, `${scheduleLine(S)}. ${from > today ? `Starts ${niceDate(from)}.` : 'Starts today.'}`, { scheduleId: s.id, from }),
      audit(me, 'schedule.assign', `${S.name} → ${users.map((u) => u.name).join(', ')}`.slice(0, 120), { from, people: users.length }),
    ]));
    return res.status(200).json({ ok: true, assigned: users.length, ...(await view(cfg, today, String(b.week || ''))) });
  }

  if (req.method === 'POST' && b.day) {
    const x = b.day, date = String(x.date || '');
    if (!D.test(date)) throw new HttpError(400, 'Choose the day.');
    if (date < today) throw new HttpError(409, "Past days can't be changed.");
    if (date > addDays(today, 180)) throw new HttpError(400, 'Choose a day within the next 6 months.');
    const locked = await lockedUntil();
    if (locked && date <= locked) throw new HttpError(409, `Payroll up to ${niceDate(locked)} is finalized, so that day can't change.`);
    const [u] = await sql`SELECT * FROM users WHERE id = ${String(x.userId || '')} AND NOT deleted`;
    if (!u) throw new HttpError(404, 'Employee not found.');
    const choice = x.scheduleId === 'off' ? 'off' : x.scheduleId ? String(x.scheduleId) : null;
    let S = null;
    if (choice && choice !== 'off') { const [s] = await sql`SELECT * FROM work_schedules WHERE id = ${choice} AND NOT deleted`; if (!s) throw new HttpError(404, 'Choose a schedule.'); S = shapeSchedule(s); }
    const when = niceDate(date);
    await batch([
      choice ? sql`INSERT INTO schedule_overrides (user_id, work_date, schedule_id, day_off, created_by) VALUES (${u.id}, ${date}, ${S ? S.id : null}, ${choice === 'off'}, ${me.id})
          ON CONFLICT (user_id, work_date) DO UPDATE SET schedule_id = EXCLUDED.schedule_id, day_off = EXCLUDED.day_off, created_by = EXCLUDED.created_by, created_at = now()`
        : sql`DELETE FROM schedule_overrides WHERE user_id = ${u.id} AND work_date = ${date}`,
      notify([u.id], 'schedule', choice === 'off' ? `Day off on ${when}` : S ? `Your schedule on ${when}: ${S.name}` : `${when}: back to your usual schedule`,
        choice === 'off' ? `You have a day off on ${when}.` : S ? `${t12(S.start)} – ${t12(S.end)} · ${S.requiredHours}h${S.location ? ' · ' + S.location : ''}. Only this day changes.` : 'This day follows your usual schedule again.', { date }),
      audit(me, 'schedule.day', `${u.name} · ${date}`, { to: choice === 'off' ? 'Day off' : S ? S.name : 'usual' }),
    ]);
    return res.status(200).json({ ok: true, ...(await view(cfg, today, String(b.week || ''), String(b.mode || ''))) });
  }

  if (req.method === 'POST' && b.schedule) {
    const v = checkSchedule(b.schedule);
    await nameFree(v.name);
    const id = 'sch-' + crypto.randomBytes(5).toString('hex');
    await sql`INSERT INTO work_schedules (id, name, start_time, end_time, required_min, break_min, grace_min, deadline, days_off, location, lat, lng, color)
      VALUES (${id}, ${v.name}, ${v.start}, ${v.end}, ${v.requiredMin}, ${v.breakMin}, ${v.graceMin}, ${v.deadline}, ${JSON.stringify(v.daysOff)}::jsonb, ${v.location}, ${v.lat}, ${v.lng}, ${v.color})`;
    await audit(me, 'schedule.add', v.name);
    return res.status(201).json({ ok: true, id, ...(await view(cfg, today, String(b.week || ''))) });
  }

  const [cur] = await sql`SELECT * FROM work_schedules WHERE id = ${String(b.id || '')} AND NOT deleted`;
  if (!cur) throw new HttpError(404, 'Schedule not found.');
  const C = shapeSchedule(cur);

  if (req.method === 'PUT' && b.makeDefault) {
    await batch([sql`UPDATE work_schedules SET is_default = (id = ${cur.id}), updated_at = now() WHERE NOT deleted OR id = ${cur.id}`,
      audit(me, 'schedule.default', C.name)]);
    const ids = await peopleOn(cur.id, true);
    await notify(ids.filter((x) => x), 'schedule', `Your schedule: ${C.name}`, `${scheduleLine(C)}.`, { scheduleId: cur.id });
    return res.status(200).json({ ok: true, ...(await view(cfg, today, String(b.week || ''))) });
  }
  if (req.method === 'PUT') {
    const v = checkSchedule(b.schedule || {}, C);
    if (v.name.toLowerCase() !== C.name.toLowerCase()) await nameFree(v.name);
    const [u] = await sql`UPDATE work_schedules SET name = ${v.name}, start_time = ${v.start}, end_time = ${v.end}, required_min = ${v.requiredMin}, break_min = ${v.breakMin},
      grace_min = ${v.graceMin}, deadline = ${v.deadline}, days_off = ${JSON.stringify(v.daysOff)}::jsonb, location = ${v.location}, lat = ${v.lat}, lng = ${v.lng}, color = ${v.color}, updated_at = now()
      WHERE id = ${cur.id} RETURNING *`;
    const N = shapeSchedule(u), changed = scheduleLine(N) !== scheduleLine(C) || N.deadline !== C.deadline || N.graceMin !== C.graceMin || N.name !== C.name;
    if (changed) {
      const ids = await peopleOn(cur.id, !!cur.is_default);
      await notify(ids, 'schedule', `Schedule updated: ${N.name}`, `${scheduleLine(N)}. Time in by ${t12(N.deadline)}.`, { scheduleId: cur.id });
    }
    await audit(me, 'schedule.edit', N.name, { from: scheduleLine(C), to: scheduleLine(N) });
    return res.status(200).json({ ok: true, ...(await view(cfg, today, String(b.week || ''))) });
  }
  // DELETE
  if (cur.is_default) throw new HttpError(409, 'This is the default schedule. Make another one the default first.');
  const [{ n }] = await sql`SELECT COUNT(DISTINCT user_id)::int AS n FROM schedule_assignments WHERE schedule_id = ${cur.id} AND (end_date IS NULL OR end_date >= ${today})`;
  if (n) throw new HttpError(409, `${n} employee${n === 1 ? ' is' : 's are'} on "${C.name}" now or later. Move ${n === 1 ? 'them' : 'them'} to another schedule first.`);
  await batch([sql`UPDATE work_schedules SET deleted = TRUE, updated_at = now() WHERE id = ${cur.id}`, audit(me, 'schedule.delete', C.name)]);
  res.status(200).json({ ok: true, ...(await view(cfg, today, String(b.week || ''))) });
}

async function nameFree(name) {
  const [x] = await sql`SELECT id FROM work_schedules WHERE lower(name) = ${name.toLowerCase()} AND NOT deleted`;
  if (x) throw new HttpError(409, `There's already a schedule called "${name}".`);
}

async function view(cfg, today, weekStart, mode = 'week') {
  const users = (await sql`SELECT * FROM users WHERE NOT deleted AND active ORDER BY name`).filter((u) => scheduleFor(cfg, u).track);
  const ids = users.map((u) => u.id);
  const [rows, asg, ovr] = await Promise.all([schedulesQuery(), assignmentsQuery(ids), overridesQuery(ids)]);
  const R = makeResolver(cfg, rows, asg, ovr);
  const start = D.test(weekStart) ? weekStart : today;
  const days = Array.from({ length: mode === 'day' ? 1 : 7 }, (_, i) => addDays(start, i));
  const live = rows.filter((r) => !r.deleted).map(shapeSchedule), locked = await lockedUntil();
  const count = Object.fromEntries(live.map((s) => [s.id, 0]));
  const employees = users.map((u) => {
    const a = R.assignmentOn(u.id, today), cur = R(u, today), nx = R.next(u.id, today);
    if (cur.scheduleId in count) count[cur.scheduleId]++;
    return {
      user: { id: u.id, name: u.name, username: u.username, role: u.role },
      current: { id: cur.scheduleId, name: cur.scheduleName, since: a?.start_date || null, isDefault: !a },
      upcoming: nx ? { id: nx.schedule_id, name: R.schedule(nx.schedule_id)?.name || '?', from: nx.start_date } : null,
      week: days.map((d) => { const s = R(u, d), dow = new Date(d + 'T00:00:00Z').getUTCDay(); return { date: d, off: s.restDays.includes(dow), id: s.scheduleId, name: s.scheduleName, start: s.start, end: s.end, color: s.color, hours: s.requiredHours, location: s.location, override: s.override, usualName: s.usualName || s.scheduleName, editable: d >= today && !(locked && d <= locked) }; }),
    };
  });
  return { today, mode: mode === 'day' ? 'day' : 'week', weekStart: start, days: days.map((d) => ({ date: d, dow: new Date(d + 'T00:00:00Z').getUTCDay(), day: DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()].slice(0, 3) })),
    schedules: live.map((s) => ({ ...s, people: count[s.id] || 0, line: scheduleLine(s) })), employees, lockedUntil: await lockedUntil() };
}