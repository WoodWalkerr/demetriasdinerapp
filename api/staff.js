// One serverless function for every staff screen (Vercel's free plan allows 12 functions;
// one shared function also stays "warm", so the admin is faster).
// vercel.json rewrites /api/staff/<action> → /api/staff?action=<action>.
import { route, HttpError } from '../lib/http.js';
import { ensureSchema } from '../lib/db.js';
import { login, logout, me, users } from '../lib/staff/account.js';
import { orders, payment, messages } from '../lib/staff/board.js';
import { pos } from '../lib/staff/pos.js';
import { products, stock, addons } from '../lib/staff/catalog.js';
import { shift, cash } from '../lib/staff/shift.js';
import { history, report, exportCsv } from '../lib/staff/reports.js';
import { settings } from '../lib/staff/settings.js';
import { dashboard, liquidation, expenses } from '../lib/staff/finance.js';
import { activity, summary } from '../lib/staff/activity.js';
import { codes } from '../lib/staff/codes.js';
import { deals } from '../lib/staff/deals.js';
import { loyalty } from '../lib/staff/loyalty.js';
import { subscribers } from '../lib/staff/subscribers.js';
import { categories } from '../lib/staff/categories.js';

const ROUTES = {
  login:    [['GET', 'POST'], login],
  logout:   [['POST'], logout],
  me:       [['PUT'], me],
  users:    [['GET', 'POST', 'PUT', 'DELETE'], users],
  orders:   [['GET', 'PATCH'], orders],
  payment:  [['POST'], payment],
  messages: [['GET', 'POST'], messages],
  pos:      [['POST'], pos],
  products: [['GET', 'POST', 'PUT', 'DELETE'], products],
  stock:    [['POST'], stock],
  addons:   [['POST', 'PUT', 'DELETE'], addons],
  shift:    [['GET', 'POST'], shift],
  cash:     [['POST'], cash],
  history:  [['GET'], history],
  report:   [['GET'], report],
  export:   [['GET'], exportCsv],
  settings: [['GET', 'PUT'], settings],
  dashboard:   [['GET'], dashboard],
  liquidation: [['GET'], liquidation],
  expenses:    [['POST', 'DELETE'], expenses],
  activity:    [['GET'], activity],
  summary:     [['GET', 'POST'], summary],
  codes:       [['GET', 'POST', 'PUT', 'DELETE'], codes],
  deals:       [['GET', 'POST', 'PUT', 'DELETE'], deals],
  loyalty:     [['GET', 'POST'], loyalty],
  subscribers: [['GET', 'DELETE'], subscribers],
  categories:  [['GET', 'POST', 'PUT', 'DELETE'], categories],
};
const wrapped = Object.fromEntries(Object.entries(ROUTES).map(([k, [methods, fn]]) => [k, route(methods, async (req, res) => { await ensureSchema(); return fn(req, res); })]));

export default async function handler(req, res) {
  const action = String(req.query.action || '');
  const h = wrapped[action];
  if (!h) return route(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], () => { throw new HttpError(404, 'Unknown staff action.'); })(req, res);
  return h(req, res);
}