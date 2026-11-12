// Newsletter sign-up and unsubscribe (lib/newsletter.js).
//   POST /api/news {email, name?, phone?, source}       sign up
//   GET  /api/news?unsub=TOKEN                           "Unsubscribe?" page (a button, so email link scanners can't unsubscribe people by accident)
//   POST /api/news {unsub: TOKEN}                        unsubscribe
import { route, body, HttpError } from '../lib/http.js';
import { ensureSchema, getSettings } from '../lib/db.js';
import { subscribe, unsubscribe } from '../lib/newsletter.js';

const page = (title, html) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FFF9E8;color:#111;font:16px/1.5 system-ui,sans-serif;padding:20px;box-sizing:border-box}
main{max-width:420px;background:#fff;border-radius:20px;padding:28px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{font-size:24px;margin:8px 0}
button,a.b{display:inline-block;margin-top:14px;padding:12px 22px;border-radius:999px;border:0;background:#111;color:#fff;font:600 16px system-ui;text-decoration:none;cursor:pointer}a{color:#066B23}</style></head>
<body><main><div style="font-size:42px">🐱</div>${html}</main></body></html>`;

export default route(['GET', 'POST'], async (req, res) => {
  await ensureSchema();
  if (req.method === 'GET') {
    const t = String(req.query.unsub || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!t) throw new HttpError(404, 'Not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(page("Unsubscribe · Demetria's Diner", `<h1>Stop getting our emails?</h1><p>You won't get promo emails from Demetria's Diner anymore. Your stamp card isn't affected.</p>
<form method="post" action="/api/news"><input type="hidden" name="unsub" value="${t}"><button type="submit">Unsubscribe</button></form><p><a href="/">Back to the menu</a></p>`));
  }
  const b = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : body(req);
  if (b.unsub) {
    const email = await unsubscribe(b.unsub);
    if ((req.headers['content-type'] || '').includes('json')) return res.status(200).json({ ok: !!email });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(page("Unsubscribed · Demetria's Diner", email ? `<h1>You're unsubscribed</h1><p>We won't email you promos anymore. Changed your mind? Sign up again anytime on our website.</p><a class="b" href="/">Back to the menu</a>` : `<h1>Link expired</h1><p>This unsubscribe link isn't valid. If you still get our emails, message us on Facebook and we'll remove you.</p>`));
  }
  if (b.website) return res.status(200).json({ ok: true, code: null }); // bots fill the hidden field
  const cfg = (await getSettings()).newsletter;
  if (!cfg.enabled) throw new HttpError(409, 'Sign-ups are closed right now.');
  const r = await subscribe(cfg, { email: b.email, name: b.name, phone: b.phone, source: b.source });
  res.status(200).json({ ok: true, ...r });
});