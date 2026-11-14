// Employee attendance (DTR): time in / time out with location, and the rules that turn them into a daily status.
//
// How a day is judged (all times are café time; a "day" is the business day, 4 AM → 4 AM, like sales):
//   • Rest day (no record)                → Rest day
//   • No time-in, before the deadline     → Not in yet        (today only)
//   • No time-in, after the deadline      → Absent            (worked out when you look; nothing is stored)
//   • Time-in after start + grace         → Late (minutes late are counted)
//   • Time-in after the deadline          → Absent (or Late, if you choose that in the rules)
//   • Timed in today, not out yet         → Working (hours so far)
//   • Timed in on an earlier day, no out  → No time-out (hours can't be counted until an admin fixes it)
//   • Hours = time-out − time-in − unpaid break. Less than required = Undertime; more = Overtime.
//   • A time-out earlier than start + required hours + break is flagged "Left early".
// Records come from the server clock, never the phone, and each person has at most one record per day.
import { atLocal, addDays, businessDate, localParts, DAY_START_HOUR, isHHMM, DAY_NAMES } from './time.js';
import { HttpError } from './http.js';

export const ATT_DEFAULTS = {
  enabled: false,
  start: '07:00',         // scheduled start
  graceMin: 15,           // minutes after start before it counts as late
  deadline: '10:00',      // latest time-in; no time-in by then = absent
  afterDeadline: 'absent', // a time-in after the deadline counts as: 'absent' | 'late'
  requiredHours: 10,      // working hours per day
  breakMin: 0,            // unpaid break taken off each day's hours
  restDays: [],           // 0 = Sunday … 6 = Saturday
  requireLocation: true,  // must share location to time in / out
  radiusM: 100,           // allowed distance from the shop
  blockOutside: false,    // refuse time in / out outside the area (off: allow, but flag it)
  lat: null, lng: null,   // shop location (empty = use the store pin from Delivery settings)
};

export function checkAttendance(x, cur = ATT_DEFAULTS) {
  const n = { ...ATT_DEFAULTS, ...cur };
  const err = (m) => { throw new HttpError(400, m); };
  if (typeof x.enabled === 'boolean') n.enabled = x.enabled;
  for (const k of ['start', 'deadline']) if (x[k] !== undefined) { if (!isHHMM(x[k])) err('Check the times (HH:MM).'); n[k] = x[k]; }
  const int = (k, lo, hi, label) => { if (x[k] === undefined) return; const v = Number(x[k]); if (!Number.isFinite(v) || v < lo || v > hi) err(`${label} must be ${lo} to ${hi}.`); n[k] = Math.round(v * 100) / 100; };
  int('graceMin', 0, 240, 'Grace period (minutes)');
  int('requiredHours', 1, 16, 'Required hours');
  int('breakMin', 0, 240, 'Unpaid break (minutes)');
  int('radiusM', 20, 5000, 'Allowed distance (meters)');
  if (x.afterDeadline !== undefined) { if (!['absent', 'late'].includes(x.afterDeadline)) err('Choose how a time-in after the deadline counts.'); n.afterDeadline = x.afterDeadline; }
  if (x.restDays !== undefined) n.restDays = [...new Set((Array.isArray(x.restDays) ? x.restDays : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  if (typeof x.requireLocation === 'boolean') n.requireLocation = x.requireLocation;
  if (typeof x.blockOutside === 'boolean') n.blockOutside = x.blockOutside;
  if (x.lat !== undefined || x.lng !== undefined) {
    if (x.lat === null || x.lat === '') { n.lat = null; n.lng = null; } else {
      const lat = Number(x.lat), lng = Number(x.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) err('That shop location is not valid.');
      n.lat = lat; n.lng = lng;
    }
  }
  if (mins(n.deadline) < mins(n.start) && mins(n.deadline) >= DAY_START_HOUR * 60) err('The time-in deadline is before the start time.');
  return n;
}

/** One employee's own schedule (per-employee changes on top of the shop rules). */
export const TRACK_DEFAULT = (u) => u.role !== 'admin';
export function scheduleFor(cfg, u) {
  const o = u?.dtr || {};
  return {
    track: typeof o.track === 'boolean' ? o.track : TRACK_DEFAULT(u),
    start: o.start || cfg.start, deadline: o.deadline || cfg.deadline,
    requiredHours: o.requiredHours || cfg.requiredHours,
    restDays: Array.isArray(o.restDays) ? o.restDays : cfg.restDays,
    graceMin: cfg.graceMin, breakMin: cfg.breakMin, afterDeadline: cfg.afterDeadline, custom: !!(o.start || o.deadline || o.requiredHours || Array.isArray(o.restDays)),
  };
}
export function checkSchedule(x) {
  const out = {};
  if (typeof x.track === 'boolean') out.track = x.track;
  for (const k of ['start', 'deadline']) if (x[k]) { if (!isHHMM(x[k])) throw new HttpError(400, 'Check the times (HH:MM).'); out[k] = x[k]; }
  if (x.requiredHours !== undefined && x.requiredHours !== '' && x.requiredHours !== null) {
    const v = Number(x.requiredHours); if (!(v >= 1 && v <= 16)) throw new HttpError(400, 'Required hours must be 1 to 16.'); out.requiredHours = v;
  }
  if (Array.isArray(x.restDays)) out.restDays = [...new Set(x.restDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  return out;
}

const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
/** A schedule time on a business date (times before 4 AM belong to the next calendar morning). */
export const schedAt = (date, hhmm) => (mins(hhmm) < DAY_START_HOUR * 60 ? atLocal(addDays(date, 1), hhmm) : atLocal(date, hhmm));
const minutesBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 60000);

/** Distance in meters between two points (haversine). */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
export const shopPoint = (cfg, delivery) => (cfg.lat != null ? { lat: cfg.lat, lng: cfg.lng, from: 'attendance' }
  : delivery?.lat != null ? { lat: delivery.lat, lng: delivery.lng, from: 'delivery' } : null);

export const STATUS = {
  rest: 'Rest day', pending: 'Not in yet', absent: 'Absent', present: 'On time', late: 'Late', working: 'Working', no_timeout: 'No time-out', future: '',
};

/**
 * One day for one employee → everything the screens and reports show.
 * rec: attendance row or undefined · sched: scheduleFor() · date: business date · now: Date
 */
export function dayRow(rec, sched, date, now = new Date()) {
  const today = businessDate(now);
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const rest = sched.restDays.includes(dow);
  const startAt = schedAt(date, sched.start), deadlineAt = schedAt(date, sched.deadline);
  const requiredMin = Math.round(sched.requiredHours * 60);
  const base = { date, dow, day: DAY_NAMES[dow].slice(0, 3), rest, requiredMin, start: sched.start, end: sched.end || null, deadline: sched.deadline, scheduleName: sched.scheduleName || null,
    timeIn: rec?.time_in || null, timeOut: rec?.time_out || null, workedMin: null, lateMin: 0, undertimeMin: 0, overtimeMin: 0,
    earlyOut: false, completion: null, flags: [], inDistM: rec?.in_dist_m ?? null, outDistM: rec?.out_dist_m ?? null,
    inOutside: !!rec?.in_outside, outOutside: !!rec?.out_outside, edited: !!rec?.edited_at, editReason: rec?.edit_reason || '', recId: rec?.id || null };
  if (!rec?.time_in) {
    if (date > today) return { ...base, status: 'future' };
    if (rest) return { ...base, status: 'rest' };
    if (date === today && now < deadlineAt) return { ...base, status: 'pending' };
    return { ...base, status: 'absent', flags: ['No time-in'] };
  }
  const tin = new Date(rec.time_in);
  let status = 'present';
  const lateBy = minutesBetween(startAt, tin);
  if (!rest && lateBy > sched.graceMin) { status = 'late'; base.lateMin = lateBy; }
  if (!rest && tin > deadlineAt) {
    base.flags.push('Timed in after the deadline');
    if (sched.afterDeadline === 'absent') { status = 'absent'; base.lateMin = 0; } // absent days don't also count late minutes
  }
  if (rest) base.flags.push('Worked on a rest day');
  if (base.inOutside) base.flags.push('Time-in outside the shop area');
  if (base.outOutside) base.flags.push('Time-out outside the shop area');
  if (base.edited) base.flags.push('Corrected by admin');
  const worked = (out) => Math.max(0, minutesBetween(tin, out) - (minutesBetween(tin, out) > sched.breakMin ? sched.breakMin : 0));
  if (!rec.time_out) {
    if (date === today) {
      const w = worked(now);
      return { ...base, status: status === 'absent' ? 'absent' : 'working', presence: status, workedMin: w, completion: 'in_progress',
        expectedOut: new Date(tin.getTime() + (requiredMin + sched.breakMin) * 60000).toISOString() };
    }
    base.flags.push('No time-out');
    return { ...base, status: status === 'absent' ? 'absent' : 'no_timeout', presence: status, completion: 'incomplete' };
  }
  const w = worked(rec.time_out);
  const required = rest ? 0 : requiredMin;
  const endAt = sched.end ? (() => { const e = schedAt(date, sched.end); return e > startAt ? e : new Date(e.getTime() + 86400000); })() : new Date(startAt.getTime() + (requiredMin + sched.breakMin) * 60000);
  const earlyOut = !rest && new Date(rec.time_out) < endAt && w < required;
  if (earlyOut) base.flags.push('Left early');
  return { ...base, status, presence: status, workedMin: w, undertimeMin: Math.max(0, required - w), overtimeMin: Math.max(0, w - required), earlyOut,
    completion: w >= required ? 'complete' : 'undertime' };
}

/** Totals for a list of days. */
export function summarize(rows) {
  const s = { days: 0, present: 0, late: 0, absent: 0, rest: 0, pending: 0, working: 0, incomplete: 0, undertimeDays: 0, outside: 0,
    workedMin: 0, lateMin: 0, undertimeMin: 0, overtimeMin: 0 };
  for (const r of rows) {
    if (r.status === 'future') continue;
    s.days++;
    if (r.status === 'rest') s.rest++;
    else if (r.status === 'pending') s.pending++;
    else if (r.status === 'absent') s.absent++;
    else s.present++;
    if (r.status === 'late' || r.presence === 'late') s.late++;
    if (r.status === 'working') s.working++;
    if (r.status === 'no_timeout') s.incomplete++;
    if (r.completion === 'undertime') s.undertimeDays++;
    if (r.inOutside || r.outOutside) s.outside++;
    s.workedMin += r.workedMin || 0; s.lateMin += r.lateMin || 0; s.undertimeMin += r.undertimeMin || 0; s.overtimeMin += r.overtimeMin || 0;
  }
  return s;
}

/** Business dates from..to (inclusive), at most `max` days. */
export function datesBetween(from, to, max = 93) {
  const D = /^\d{4}-\d{2}-\d{2}$/;
  if (!D.test(from) || !D.test(to)) throw new HttpError(400, 'Choose the dates.');
  if (to < from) throw new HttpError(400, 'The end date is before the start date.');
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { out.push(d); if (out.length > max) throw new HttpError(400, `Choose up to ${max} days at a time.`); }
  return out;
}

export const hm = (m) => (m == null ? '' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
export const clockOf = (t) => {
  if (!t) return '';
  const p = localParts(t), h = Math.floor(p.min / 60), m = p.min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const statusText = (r) => [r.status === 'present' ? 'On time' : STATUS[r.status], r.completion === 'undertime' ? 'Undertime' : r.completion === 'complete' && r.overtimeMin ? 'Overtime' : ''].filter(Boolean).join(' · ');