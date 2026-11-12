// Email newsletter: customers sign up (website pop-up, footer, "My stamps"); you export the list
// (Staff → Settings → Newsletter → Export CSV) and send with Brevo / Mailchimp, which handle unsubscribes too.
// Only people who signed up themselves are on the list. Every row has its own unsubscribe link.
import crypto from 'node:crypto';
import { sql } from './db.js';
import { HttpError, clean } from './http.js';

export const NEWS_DEFAULTS = {
  enabled: false,
  title: 'Get our promos first 💌',
  text: 'New drinks, promo codes and Buy 1 Take 1 deals in your inbox, about once a week.',
  button: 'Sign me up',
  welcomeCode: '',   // optional promo code shown right after signing up ("Here's 10% off: WELCOME10")
  delay: 25,         // seconds on the site before the pop-up shows (it shows once; again 14 days after "No thanks")
};

export const normEmail = (e) => {
  const v = String(e || '').trim().toLowerCase();
  return /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[a-z]{2,}$/.test(v) && v.length <= 120 ? v : null;
};

export async function checkNews(x, cur = NEWS_DEFAULTS) {
  const n = { ...NEWS_DEFAULTS, ...cur };
  if (typeof x.enabled === 'boolean') n.enabled = x.enabled;
  if (x.title !== undefined) n.title = clean(x.title, 60) || NEWS_DEFAULTS.title;
  if (x.text !== undefined) n.text = clean(x.text, 200) || NEWS_DEFAULTS.text;
  if (x.button !== undefined) n.button = clean(x.button, 24) || NEWS_DEFAULTS.button;
  if (x.delay !== undefined) { const v = parseInt(x.delay, 10); if (!(v >= 3 && v <= 600)) throw new HttpError(400, 'Show the pop-up after 3 to 600 seconds.'); n.delay = v; }
  if (x.welcomeCode !== undefined) {
    const code = clean(x.welcomeCode, 20).toUpperCase();
    if (code) {
      const [c] = await sql`SELECT code FROM promo_codes WHERE upper(code) = ${code} AND NOT deleted`;
      if (!c) throw new HttpError(400, `There's no promo code "${code}". Make it first in Settings → Promo codes.`);
      n.welcomeCode = c.code;
    } else n.welcomeCode = '';
  }
  return n;
}
/** What the website needs (the welcome code itself is only shown after signing up). */
export const publicNews = (c) => (c.enabled ? { enabled: true, title: c.title, text: c.text, button: c.button, delay: c.delay, gift: !!c.welcomeCode } : { enabled: false });

/** Sign up (or sign up again after unsubscribing). → { code } the welcome code, if any. */
export async function subscribe(cfg, { email, name, phone, source }) {
  const e = normEmail(email);
  if (!e) throw new HttpError(400, 'Please enter a valid email address, like name@gmail.com.');
  const p = String(phone || '').replace(/\D/g, '').replace(/^63/, '0').replace(/^9(\d{9})$/, '09$1');
  const src = ['popup', 'footer', 'stamps', 'cart'].includes(source) ? source : 'popup';
  const token = crypto.randomBytes(18).toString('base64url');
  await sql`INSERT INTO subscribers (email, name, phone, source, token) VALUES (${e}, ${clean(name, 60)}, ${/^09\d{9}$/.test(p) ? p : null}, ${src}, ${token})
    ON CONFLICT (email) DO UPDATE SET unsub_at = NULL, subscribed_at = CASE WHEN subscribers.unsub_at IS NULL THEN subscribers.subscribed_at ELSE now() END,
      name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE subscribers.name END, phone = COALESCE(EXCLUDED.phone, subscribers.phone)`;
  return { code: cfg.welcomeCode || null };
}
export async function unsubscribe(token) {
  const [r] = await sql`UPDATE subscribers SET unsub_at = COALESCE(unsub_at, now()) WHERE token = ${String(token || '')} RETURNING email`;
  return r?.email || null;
}