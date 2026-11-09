// Café time: time zone, the "business day", opening hours and happy-hour windows.
//
// Business day: you're open until 2 AM, so a sale at 1 AM belongs to the night before.
// Every report, the dashboard and the nightly summary treat a day as DAY_START_HOUR → DAY_START_HOUR
// (4 AM → 4 AM by default).

export const TZ = process.env.CAFE_TIMEZONE || 'Asia/Manila';
export const DAY_START_HOUR = Math.min(8, Math.max(0, parseInt(process.env.DAY_START_HOUR ?? '4', 10) || 0));

/** Minutes the café's time zone is ahead of UTC at instant d. */
export function tzOffsetMin(d = new Date(), tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/**
 * A fixed-offset time zone for Postgres, shifted so that midnight falls at DAY_START_HOUR café time.
 * (POSIX zone strings count west as positive, so UTC+4 is written "BIZ-4".)
 * Used in SQL as  created_at AT TIME ZONE ${BTZ}  to get the business date.
 */
export const BTZ = (() => {
  const m = tzOffsetMin() - DAY_START_HOUR * 60;
  const a = Math.abs(m);
  return `BIZ${m >= 0 ? '-' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
})();

/** Café-local parts of an instant: { date 'YYYY-MM-DD', dow 0=Sun, min (minutes after midnight) }. */
export function localParts(d) {
  const t = new Date(new Date(d).getTime() + tzOffsetMin(new Date(d)) * 60000);
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
/** Business date ('YYYY-MM-DD') of an instant. */
export const businessDate = (d = new Date()) => localParts(new Date(new Date(d).getTime() - DAY_START_HOUR * 3600e3)).date;
export const addDays = (date, n) => { const t = new Date(date + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
/** Café-local date + "HH:MM" → Date. */
export function atLocal(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m);
  return new Date(guess - tzOffsetMin(new Date(guess)) * 60000);
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const isHHMM = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// ---------------------------------------------------------------------------
// Opening hours
//   hours = { days: { 0..6: { closed, open 'HH:MM', close 'HH:MM' } },   0 = Sunday
//             special: [{ date, closed, open, close, note }] }       one-off days (pop-up stall, holidays)
//   A close time at or before the open time means "after midnight" (9:00 → 2:00 = until 2 AM next day).
// ---------------------------------------------------------------------------
const WEEKDAY = { closed: false, open: '09:00', close: '02:00' };
const WEEKEND = { closed: false, open: '12:00', close: '21:00' };
export const HOURS_DEFAULTS = {
  enabled: true,
  days: { 0: WEEKEND, 1: WEEKDAY, 2: WEEKDAY, 3: WEEKDAY, 4: WEEKDAY, 5: WEEKDAY, 6: WEEKEND },
  special: [],
};
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The opening window that STARTS on café-local date `date`, or null if closed that day. */
export function windowOn(hours, date) {
  const sp = (hours.special || []).find((s) => s.date === date);
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const d = sp || hours.days?.[dow] || hours.days?.[String(dow)];
  if (!d || d.closed) return sp ? { date, closed: true, note: sp.note || '' } : null;
  const start = atLocal(date, d.open);
  let end = atLocal(date, d.close);
  if (end <= start) end = atLocal(addDays(date, 1), d.close);
  return { date, start, end, note: sp?.note || '', special: !!sp };
}

/** Is the café open at instant t? → { open, until, note } or { open:false, next, note } */
export function openState(hours, t = new Date()) {
  if (hours.enabled === false) return { open: true, always: true };
  const today = localParts(t).date;
  for (const date of [addDays(today, -1), today]) {
    const w = windowOn(hours, date);
    if (w && !w.closed && t >= w.start && t < w.end) return { open: true, until: w.end, note: w.note };
  }
  const nx = upcomingWindows(hours, t, 8).find((w) => w.start > t);
  const todayW = windowOn(hours, today);
  return { open: false, next: nx?.start || null, note: todayW?.note || '' };
}

/** Opening windows that haven't ended yet, starting from yesterday's (it may run past midnight). */
export function upcomingWindows(hours, t = new Date(), days = 8) {
  const today = localParts(t).date, out = [];
  for (let i = -1; i < days; i++) {
    const w = windowOn(hours, addDays(today, i));
    if (w && !w.closed && w.end > t) out.push(w);
  }
  return out;
}

export function checkHours(input) {
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const days = {};
  for (let i = 0; i < 7; i++) {
    const d = input?.days?.[i] ?? input?.days?.[String(i)] ?? HOURS_DEFAULTS.days[i];
    if (!d.closed && (!isHHMM(d.open) || !isHHMM(d.close))) err(`Set the opening and closing time for ${DAY_NAMES[i]}.`);
    if (!d.closed && d.open === d.close) err(`${DAY_NAMES[i]}: opening and closing time can't be the same.`);
    days[i] = { closed: !!d.closed, open: d.open || '09:00', close: d.close || '21:00' };
  }
  const special = (Array.isArray(input?.special) ? input.special : []).slice(0, 60).map((s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s?.date || '')) err('Each special day needs a date.');
    if (!s.closed && (!isHHMM(s.open) || !isHHMM(s.close) || s.open === s.close)) err(`Set the hours for ${s.date}.`);
    return { date: s.date, closed: !!s.closed, open: s.open || '', close: s.close || '', note: String(s.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) };
  });
  // Drop special days that are over (keep a week of history).
  const cutoff = addDays(localParts(new Date()).date, -7);
  return { enabled: input?.enabled !== false, days, special: special.filter((s) => s.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date)) };
}

// ---------------------------------------------------------------------------
// Happy hour / promos
//   { id, name, pct 1–90, cats: ['icedcoffee',…] (empty = all items), icedOnly, days: [0..6], from, to, active }
// ---------------------------------------------------------------------------
export function promoActiveAt(p, t = new Date()) {
  if (!p?.active) return false;
  const { dow, min } = localParts(t);
  const from = toMin(p.from), to = toMin(p.to);
  const days = p.days || [];
  if (from < to) return days.includes(dow) && min >= from && min < to;
  return (days.includes(dow) && min >= from) || (days.includes((dow + 6) % 7) && min < to); // runs past midnight
}
export const promoApplies = (p, item, kind) =>
  (!p.cats?.length || p.cats.includes(item.cat)) && (!p.icedOnly || (kind === 'drink' && !item.hot));
/** Best promo for an item at time t → { promo, offCents } or null. Discount is rounded to whole pesos. */
export function bestPromo(promos, item, kind, t) {
  let best = null;
  for (const p of promos || []) {
    if (!promoApplies(p, item, kind) || !promoActiveAt(p, t)) continue;
    const off = Math.round((item.price * p.pct) / 10000) * 100;
    if (off > 0 && (!best || off > best.offCents)) best = { promo: p, offCents: Math.min(off, item.price) };
  }
  return best;
}
export function checkPromos(list) {
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!Array.isArray(list)) return [];
  if (list.length > 12) err('Up to 12 promos.');
  return list.map((p) => {
    const name = String(p?.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40);
    if (!name) err('Give each promo a name, like "Happy hour".');
    const pct = Number(p.pct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 90) err(`${name}: the discount must be 1–90%.`);
    if (!isHHMM(p.from) || !isHHMM(p.to) || p.from === p.to) err(`${name}: set a start and end time.`);
    const days = [...new Set((p.days || []).map(Number))].filter((d) => d >= 0 && d <= 6).sort();
    if (!days.length) err(`${name}: pick at least one day.`);
    const id = /^[a-z0-9-]{4,40}$/.test(p.id || '') ? p.id : 'promo-' + Math.random().toString(36).slice(2, 10);
    return { id, name, pct, cats: (Array.isArray(p.cats) ? p.cats : []).filter((c) => typeof c === 'string').slice(0, 20), icedOnly: !!p.icedOnly, days, from: p.from, to: p.to, active: p.active !== false };
  });
}
