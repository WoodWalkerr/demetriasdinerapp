export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Wraps a handler: method check, JSON errors, no caching by default, no stack traces to clients. */
export function route(methods, handler) {
  return async (req, res) => {
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }
    res.setHeader('Cache-Control', 'no-store');
    try {
      await handler(req, res);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
    }
  };
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { throw new HttpError(400, 'Request body must be JSON.'); }
}

/** Whole pesos/centavos helpers. Inputs from staff screens are in centavos (integers). */
export function centsOf(v, { min = 0, max = 10_000_000, label = 'Amount' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} is not valid.`);
  return n;
}

export const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** Identifies the deployed version, so open pages can reload themselves after an update. */
export const BUILD = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'local';
