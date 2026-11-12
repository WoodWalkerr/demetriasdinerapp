import { body, HttpError, clean } from '../http.js';
import { sql, batch, getSettings, bumpVersion, audit } from '../db.js';
import { checkHours, checkPromos } from '../time.js';
import { checkLoyalty } from '../loyalty.js';
import { checkUpsell } from '../upsell.js';
import { checkNews } from '../newsletter.js';
import { emailConfigured } from '../summary.js';
import { requireStaff } from '../auth.js';
import { paymongoConfigured, paymongoMode, webhookConfigured } from '../paymongo.js';

// GET /api/staff/settings                (any staff: the POS needs the QR)
// PUT /api/staff/settings                (permission: settings)
//   { accepting?, payOnline?, payCounter?,
//     qrEnabled?, qrName?, qrNumber?, qrImage? (data:image/...;base64, max ~400 KB),
//     delivery?: { enabled, lat, lng, maxKm, tiers:[{upToKm, fee (pesos)}], minOrder (pesos), eta },
//     hours?: { enabled, days:{0..6:{closed, open, close}}, special:[{date, closed, open, close, note}] },
//     promos?: [{ id?, name, pct, cats[], icedOnly, days[], from, to, active }],
//     summary?: { enabled, emails[] } }
export async function settings(req, res) {
  const u = await requireStaff(req, req.method === 'GET' ? 'pos' : 'settings');
  const cur = await getSettings();
  const integration = { paymongo: paymongoConfigured(), mode: paymongoMode(), webhook: webhookConfigured(), email: emailConfigured(), cron: !!process.env.CRON_SECRET };
  if (req.method === 'GET') return res.status(200).json({ ...cur, integration });

  const b = body(req);
  const bool = (k) => (typeof b[k] === 'boolean' ? b[k] : cur[k]);
  const next = { accepting: bool('accepting'), payOnline: bool('payOnline'), payCounter: bool('payCounter'), qr: { ...cur.qr, maya: { ...cur.qr.maya } }, delivery: { ...cur.delivery },
    hours: cur.hours, promos: cur.promos, summary: { ...cur.summary }, loyalty: cur.loyalty, upsell: cur.upsell, newsletter: cur.newsletter };
  const asHttp = (fn) => { try { return fn(); } catch (e) { throw new HttpError(e.status || 400, e.message); } };
  if (b.hours !== undefined) next.hours = asHttp(() => checkHours(b.hours));
  if (b.promos !== undefined) next.promos = asHttp(() => checkPromos(b.promos));
  if (b.loyalty !== undefined) next.loyalty = asHttp(() => checkLoyalty(b.loyalty, cur.loyalty));
  if (b.upsell !== undefined) next.upsell = asHttp(() => checkUpsell(b.upsell, cur.upsell));
  if (b.newsletter !== undefined) next.newsletter = await checkNews(b.newsletter, cur.newsletter);
  if (b.summary !== undefined) {
    const emails = (Array.isArray(b.summary.emails) ? b.summary.emails : String(b.summary.emails || '').split(/[\s,;]+/))
      .map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    if (emails.length > 5) throw new HttpError(400, 'Up to 5 email addresses.');
    for (const e of emails) if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) throw new HttpError(400, `"${e}" doesn't look like an email address.`);
    next.summary = { ...next.summary, enabled: !!b.summary.enabled, emails };
    if (next.summary.enabled && !emails.length) throw new HttpError(400, 'Add the email address the summary goes to.');
  }
  if (typeof b.qrEnabled === 'boolean') next.qr.enabled = b.qrEnabled;
  if (typeof b.qrName === 'string') next.qr.name = b.qrName.trim().slice(0, 60);
  if (typeof b.qrNumber === 'string') next.qr.number = b.qrNumber.replace(/[^0-9+ ]/g, '').trim().slice(0, 20);
  if (typeof b.qrImage === 'string') {
    if (b.qrImage && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.qrImage)) throw new HttpError(400, 'Upload the QR as a PNG or JPG image.');
    if (b.qrImage.length > 550_000) throw new HttpError(400, 'That image is too large. Use a screenshot of just the QR.');
    next.qr.image = b.qrImage;
  }
  if (typeof b.qrMayaName === 'string') next.qr.maya.name = b.qrMayaName.trim().slice(0, 60);
  if (typeof b.qrMayaNumber === 'string') next.qr.maya.number = b.qrMayaNumber.replace(/[^0-9+ ]/g, '').trim().slice(0, 20);
  if (typeof b.qrMayaImage === 'string') {
    if (b.qrMayaImage && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.qrMayaImage)) throw new HttpError(400, 'Upload the Maya QR as a PNG or JPG image.');
    if (b.qrMayaImage.length > 550_000) throw new HttpError(400, 'That image is too large. Use a screenshot of just the QR.');
    next.qr.maya.image = b.qrMayaImage;
  }
  if (next.qr.enabled && !next.qr.image && !next.qr.maya.image) throw new HttpError(400, 'Upload your GCash or Maya QR before switching it on.');
  if (!next.payOnline && !next.payCounter && !next.qr.enabled) throw new HttpError(400, 'Keep at least one way to pay switched on.');

  if (b.delivery) {
    const d = b.delivery, n = { ...next.delivery };
    if (typeof d.enabled === 'boolean') n.enabled = d.enabled;
    if (d.lat !== undefined || d.lng !== undefined) {
      const lat = Number(d.lat), lng = Number(d.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Drop the store pin on the map.');
      n.lat = lat; n.lng = lng;
    }
    if (d.maxKm !== undefined) {
      const m = Number(d.maxKm);
      if (!(m >= 0.5 && m <= 50)) throw new HttpError(400, 'Maximum distance must be between 0.5 and 50 km.');
      n.maxKm = Math.round(m * 10) / 10;
    }
    if (d.tiers !== undefined) {
      if (!Array.isArray(d.tiers) || !d.tiers.length || d.tiers.length > 10) throw new HttpError(400, 'Add 1 to 10 distance tiers.');
      n.tiers = d.tiers.map((t) => {
        const km = Number(t.upToKm), fee = Math.round(Number(t.fee) * 100);
        if (!(km > 0 && km <= 50) || !(fee >= 0 && fee <= 100000)) throw new HttpError(400, 'Each tier needs a distance (km) and a fee in pesos.');
        return { upToKm: Math.round(km * 10) / 10, fee };
      }).sort((a, b2) => a.upToKm - b2.upToKm);
    }
    if (d.minOrder !== undefined) n.minOrder = Math.max(0, Math.round(Number(d.minOrder) * 100) || 0);
    if (d.eta !== undefined) n.eta = clean(d.eta, 30);
    if (n.enabled && !(Number.isFinite(n.lat) && Number.isFinite(n.lng))) throw new HttpError(400, 'Set the store location on the map before switching delivery on.');
    if (n.tiers[n.tiers.length - 1].upToKm < n.maxKm) throw new HttpError(400, `Your last tier stops at ${n.tiers[n.tiers.length - 1].upToKm} km but the maximum is ${n.maxKm} km. Add a tier or lower the maximum.`);
    next.delivery = n;
  }

  await batch([
    sql`UPDATE settings SET accepting = ${next.accepting}, pay_online = ${next.payOnline}, pay_counter = ${next.payCounter},
          qr_enabled = ${next.qr.enabled}, qr_name = ${next.qr.name}, qr_number = ${next.qr.number}, qr_image = ${next.qr.image}, qr_maya = ${JSON.stringify(next.qr.maya)}::jsonb,
          delivery = ${JSON.stringify(next.delivery)}::jsonb, hours = ${JSON.stringify(next.hours)}::jsonb,
          promos = ${JSON.stringify(next.promos)}::jsonb, summary = ${JSON.stringify(next.summary)}::jsonb,
          loyalty = ${JSON.stringify(next.loyalty)}::jsonb, upsell = ${JSON.stringify(next.upsell)}::jsonb, newsletter = ${JSON.stringify(next.newsletter)}::jsonb, updated_at = now() WHERE id = 1`,
    bumpVersion(),
    ...changedAudit(u, cur, next),
  ]);
  res.status(200).json({ ...next, integration });
}

// One activity-log entry per settings area that changed (the QR image itself isn't copied into the log).
function changedAudit(u, cur, next) {
  const areas = {
    'settings.ordering': ['accepting', 'payOnline', 'payCounter'],
    'settings.qr': ['qr'], 'settings.delivery': ['delivery'], 'settings.hours': ['hours'],
    'settings.promos': ['promos'], 'settings.summary': ['summary'], 'settings.loyalty': ['loyalty'], 'settings.upsell': ['upsell'], 'settings.newsletter': ['newsletter'],
  };
  const out = [];
  for (const [action, keys] of Object.entries(areas)) {
    const before = keys.map((k) => JSON.stringify(cur[k])).join(), after = keys.map((k) => JSON.stringify(next[k])).join();
    if (before === after) continue;
    const pick = (o) => Object.fromEntries(keys.map((k) => [k, k === 'qr' ? { ...o.qr, image: o.qr.image ? '(image)' : '', maya: { ...o.qr.maya, image: o.qr.maya?.image ? '(image)' : '' } } : o[k]]));
    out.push(audit(u, action, '', { from: pick(cur), to: pick(next) }));
  }
  return out;
}