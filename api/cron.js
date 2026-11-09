// Daily job (vercel.json → "crons"): emails the owner's summary of the business day that just ended.
// Vercel calls it with "Authorization: Bearer <CRON_SECRET>", so set CRON_SECRET in Vercel → Environment Variables.
import { ensureSchema } from '../lib/db.js';
import { nightly } from '../lib/summary.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await ensureSchema();
    res.status(200).json(await nightly());
  } catch (e) {
    console.error('nightly summary failed', e);
    res.status(e.status || 500).json({ error: e.message });
  }
}
