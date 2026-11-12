import { HttpError, body } from '../http.js';
import { sql, audit } from '../db.js';
import { requireStaff } from '../auth.js';
import { normEmail } from '../newsletter.js';
import { baseUrl } from '../paymongo.js';

// /api/staff/subscribers   newsletter list  (permission: settings: it's customers' personal data)
//   GET               counts { active, week, unsubscribed }
//   GET ?format=csv   download the active list (for Brevo / Mailchimp), with each person's unsubscribe link
//   DELETE {email}    remove someone completely (they asked to be forgotten)
export async function subscribers(req, res) {
  const u = await requireStaff(req, 'settings');
  if (req.method === 'DELETE') {
    const e = normEmail(body(req).email);
    if (!e) throw new HttpError(400, 'Enter the email address to remove.');
    const r = await sql`DELETE FROM subscribers WHERE email = ${e} RETURNING id`;
    if (!r.length) throw new HttpError(404, `${e} isn't on the list.`);
    await audit(u, 'news.remove', e);
    return res.status(200).json({ ok: true });
  }
  if (req.query.format === 'csv') {
    const rows = await sql`SELECT email, name, phone, source, subscribed_at, token FROM subscribers WHERE unsub_at IS NULL ORDER BY subscribed_at`;
    const base = baseUrl(req), q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const lines = [['EMAIL', 'FIRSTNAME', 'SMS', 'SIGNED_UP', 'SOURCE', 'UNSUBSCRIBE_URL'].join(',')]
      .concat(rows.map((r) => [r.email, r.name, r.phone ? '+63' + r.phone.slice(1) : '', new Date(r.subscribed_at).toISOString().slice(0, 10), r.source, `${base}/api/news?unsub=${r.token}`].map(q).join(',')));
    await audit(u, 'news.export', `${rows.length} subscribers`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="demetrias-newsletter-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send('﻿' + lines.join('\r\n'));
  }
  const [c] = await sql`SELECT COUNT(*) FILTER (WHERE unsub_at IS NULL)::int AS active,
    COUNT(*) FILTER (WHERE unsub_at IS NULL AND subscribed_at > now() - interval '7 days')::int AS week,
    COUNT(*) FILTER (WHERE unsub_at IS NOT NULL)::int AS unsubscribed FROM subscribers`;
  res.status(200).json(c);
}