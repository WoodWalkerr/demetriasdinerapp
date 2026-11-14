// Work schedules (shift templates) and who works which schedule from which date.
//
//   • A schedule = name, time in, time out, required hours, grace, time-in deadline, unpaid break, days off, location.
//   • "Regular" (9:00 AM → 7:00 PM, 10 hours) is the default for anyone without an assignment.
//   • Assigning is always "from <date>": it replaces what the person had from that date on. So every person has
//     exactly ONE schedule on any day (no double-booking), and past days keep the schedule they really had
//     (attendance and payroll stay correct).
//   • Days inside a finalized payroll period can't be changed.
//   • Each assignment or change sends the employee a notification (portal pop-up).
import { sql, batch } from './db.js';
import { HttpError, clean } from './http.js';
import { businessDate, addDays, isHHMM, DAY_START_HOUR, DAY_NAMES } from './time.js';

const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
/** Minutes from `a` to `b` on a clock (overnight wraps), 1..1440. */
const span = (a, b) => { const d = (mins(b) - mins(a) + 1440) % 1440; return d || 1440; };
export const t12 = (t) => { if (!t) return ''; const h = +t.slice(0, 2), m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : ':' + m} ${h < 12 ? 'AM' : 'PM'}`; };

export const shapeSchedule = (r) => ({
  id: r.id, name: r.name, start: r.start_time, end: r.end_time, requiredHours: r.required_min / 60, breakMin: r.break_min, graceMin: r.grace_min,
  deadline: r.deadline, daysOff: r.days_off || [], location: r.location || '', lat: r.lat, lng: r.lng, color: r.color || '#066B23',
  isDefault: !!r.is_default, deleted: !!r.deleted,
});
export const scheduleLine = (s) => `${t12(s.start)} – ${t12(s.end)} · ${s.requiredHours}h${s.breakMin ? ` + ${s.breakMin} min break` : ''}${s.daysOff.length ? ` · Day off: ${s.daysOff.map((d) => DAY_NAMES[d]).join(', ')}` : ''}${s.location ? ` · ${s.location}` : ''}`;

/** Check a schedule from the form. Returns database values. */
export function checkSchedule(x, cur = {}) {
  const err = (m) => { throw new HttpError(400, m); };
  const v = { ...cur, ...x };
  const name = clean(v.name, 40); if (!name) err('Give the schedule a name, e.g. "Opening shift".');
  for (const k of ['start', 'end', 'deadline']) if (!isHHMM(v[k])) err(`Check the ${k === 'end' ? 'time out' : k === 'start' ? 'time in' : 'time-in deadline'} (HH:MM).`);
  if (v.start === v.end) err('Time in and time out can\'t be the same.');
  const req = Number(v.requiredHours), brk = Number(v.breakMin || 0), grace = Number(v.graceMin || 0);
  if (!(req >= 1 && req <= 16)) err('Required hours must be 1 to 16.');
  if (!(brk >= 0 && brk <= 240)) err('Unpaid break must be 0 to 240 minutes.');
  if (!(grace >= 0 && grace <= 120)) err('Grace must be 0 to 120 minutes.');
  const len = span(v.start, v.end);
  if (Math.round(req * 60) + brk > len) err(`${req} hours${brk ? ` + ${brk} min break` : ''} don't fit between ${t12(v.start)} and ${t12(v.end)} (${Math.floor(len / 60)}h ${len % 60}m). Change the time out or the hours.`);
  if (span(v.start, v.deadline) >= len) err('The time-in deadline must be after the time in and before the time out.');
  if (grace >= len) err('Grace is longer than the shift.');
  const daysOff = [...new Set((Array.isArray(v.daysOff) ? v.daysOff : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  if (daysOff.length === 7) err('A schedule needs at least one working day.');
  const lat = v.lat === '' || v.lat == null ? null : Number(v.lat), lng = v.lng === '' || v.lng == null ? null : Number(v.lng);
  if ((lat == null) !== (lng == null) || (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180))) err('That work location pin is not valid.');
  const color = /^#[0-9a-fA-F]{6}$/.test(v.color || '') ? v.color : '#066B23';
  return { name, start: v.start, end: v.end, requiredMin: Math.round(req * 60), breakMin: Math.round(brk), graceMin: Math.round(grace), deadline: v.deadline, daysOff, location: clean(v.location, 60), lat, lng, color };
}

/** The first time: make "Regular" from the old attendance rules, and turn old per-person times into schedules. */
export async function ensureSchedules(cfg) {
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM work_schedules`;
  if (n) return;
  const [claimed] = await sql`INSERT INTO meta (key, value) VALUES ('schedules_seeded', '1') ON CONFLICT (key) DO NOTHING RETURNING key`;
  if (!claimed) return; // another request is doing it
  const start = isHHMM(cfg.start) ? cfg.start : '09:00', req = Math.round((cfg.requiredHours || 10) * 60), brk = cfg.breakMin || 0;
  const endM = (mins(start) + req + brk) % 1440, end = `${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
  let deadline = isHHMM(cfg.deadline) ? cfg.deadline : '11:00';
  if (span(start, deadline) >= span(start, end)) deadline = start;
  await sql`INSERT INTO work_schedules (id, name, start_time, end_time, required_min, break_min, grace_min, deadline, days_off, location, is_default)
    VALUES ('regular', 'Regular', ${start}, ${end}, ${req}, ${brk}, ${cfg.graceMin ?? 15}, ${deadline}, ${JSON.stringify(cfg.restDays || [])}::jsonb, 'Main shop', TRUE)`;
  // people who had their own times in the old Attendance → Employee schedules table
  const users = await sql`SELECT * FROM users WHERE NOT deleted AND dtr IS NOT NULL`;
  for (const u of users) {
    const o = u.dtr || {};
    if (!(o.start || o.deadline || o.requiredHours || Array.isArray(o.restDays))) continue;
    const s0 = o.start || start, r0 = Math.round((o.requiredHours || cfg.requiredHours || 10) * 60), e0m = (mins(s0) + r0 + brk) % 1440;
    const e0 = `${String(Math.floor(e0m / 60)).padStart(2, '0')}:${String(e0m % 60).padStart(2, '0')}`;
    let dl = o.deadline || deadline; if (span(s0, dl) >= span(s0, e0)) dl = s0;
    const id = 'sch-' + u.id.slice(0, 8);
    await batch([
      sql`INSERT INTO work_schedules (id, name, start_time, end_time, required_min, break_min, grace_min, deadline, days_off, location)
        VALUES (${id}, ${`${u.name.split(' ')[0]}'s shift`.slice(0, 40)}, ${s0}, ${e0}, ${r0}, ${brk}, ${cfg.graceMin ?? 15}, ${dl}, ${JSON.stringify(o.restDays || cfg.restDays || [])}::jsonb, 'Main shop')
        ON CONFLICT (id) DO NOTHING`,
      sql`INSERT INTO schedule_assignments (user_id, schedule_id, start_date) VALUES (${u.id}, ${id}, ${businessDate(u.created_at)})`,
      sql`UPDATE users SET dtr = ${JSON.stringify(typeof o.track === 'boolean' ? { track: o.track } : {})}::jsonb WHERE id = ${u.id}`,
    ]);
  }
}

export const schedulesQuery = () => sql`SELECT * FROM work_schedules ORDER BY is_default DESC, deleted, name`;
export const assignmentsQuery = (ids) => sql`SELECT * FROM schedule_assignments WHERE user_id = ANY(${ids}) ORDER BY user_id, start_date`;

/**
 * resolver(user, date) → the schedule that person works on that business date, in the shape the attendance rules use.
 * Built once per request from all schedules + the people's assignments.
 */
export function makeResolver(cfg, scheduleRows, assignmentRows) {
  const byId = Object.fromEntries(scheduleRows.map((r) => [r.id, shapeSchedule(r)]));
  const def = scheduleRows.map(shapeSchedule).find((s) => s.isDefault && !s.deleted);
  const byUser = {};
  for (const a of assignmentRows) (byUser[a.user_id] ||= []).push(a);
  const shape = (s) => ({ scheduleId: s.id, scheduleName: s.name, start: s.start, end: s.end, deadline: s.deadline, requiredHours: s.requiredHours,
    restDays: s.daysOff, graceMin: s.graceMin, breakMin: s.breakMin, afterDeadline: cfg.afterDeadline, location: s.location, lat: s.lat, lng: s.lng, color: s.color });
  const fallback = { scheduleId: null, scheduleName: 'Shop rules', start: cfg.start, end: null, deadline: cfg.deadline, requiredHours: cfg.requiredHours, restDays: cfg.restDays,
    graceMin: cfg.graceMin, breakMin: cfg.breakMin, afterDeadline: cfg.afterDeadline, location: '', lat: null, lng: null, color: '#066B23' };
  const assignmentOn = (uid, date) => (byUser[uid] || []).find((a) => a.start_date <= date && (!a.end_date || date <= a.end_date));
  return Object.assign((u, date) => {
    const a = assignmentOn(u.id, date), s = a ? byId[a.schedule_id] : def;
    return s ? shape(s) : fallback;
  }, {
    assignmentOn,
    next: (uid, date) => (byUser[uid] || []).find((a) => a.start_date > date),
    schedule: (id) => byId[id], def,
  });
}

/** Notifications (portal pop-ups). */
export const notify = (userIds, kind, title, body, data = null) => (userIds.length
  ? sql`INSERT INTO notifications (user_id, kind, title, body, data) SELECT u, ${kind}, ${title}, ${body}, ${data ? JSON.stringify(data) : null}::jsonb FROM unnest(${userIds}::text[]) AS u`
  : null);

/** People whose schedule (from today on) is this one: assigned now or later, or on the default with no assignment today. */
export async function peopleOn(scheduleId, isDefault) {
  const today = businessDate();
  const rows = await sql`SELECT DISTINCT user_id FROM schedule_assignments WHERE schedule_id = ${scheduleId} AND (end_date IS NULL OR end_date >= ${today})`;
  const ids = rows.map((r) => r.user_id);
  if (isDefault) {
    const free = await sql`SELECT u.id FROM users u WHERE NOT u.deleted AND u.active AND NOT EXISTS (
      SELECT 1 FROM schedule_assignments a WHERE a.user_id = u.id AND a.start_date <= ${today} AND (a.end_date IS NULL OR a.end_date >= ${today}))`;
    ids.push(...free.map((r) => r.id));
  }
  return [...new Set(ids)];
}

/** Finalized payroll periods block changes to their days. */
export async function lockedUntil() {
  const [r] = await sql`SELECT MAX(period_to) AS d FROM payroll_runs WHERE status = 'final'`;
  return r?.d || null;
}
export const DAY_START = DAY_START_HOUR;
export { addDays };