# Demetria's Diner: website, ordering, POS & back office

*Come for the drinks, stay for the comfort.*

**Step-by-step setup (Mac): see `SETUP.md`.** This file explains what the system does and how it's built.

## What's inside

**Customer website** (`/`)
- Menu with live prices, add-ons, "Only 3 left" and sold-out labels. It updates by itself when staff change something.
- Cart with drink options (sweetness, ice) and **add-ons**, plus a **takeout bag** for any item.
- **Pickup or delivery.** For delivery the customer drops a pin on a map, and the fee is calculated from the distance.
- Payment: **GCash / Maya by scanning your own QR** (the customer sends the reference number), cash at the counter or on delivery, and optionally cards/GCash through PayMongo.
- Live order status and a **chat with the cashier**, with quick buttons like "Where's my order?".

**Staff admin** (`/staff`): each person signs in with **their own account**
| Tab | What it's for | Who sees it |
|---|---|---|
| Board | Live orders (New → Making → Ready → Out for delivery → Done), chime on new orders and messages, confirm GCash payments, collect cash on delivery | everyone with *POS* |
| POS | Walk-in sales with add-ons, discounts (Senior/PWD/Staff), **split payment** (cash + GCash + Maya + card), change, receipt | *POS* |
| Orders | Search all orders; details, receipt, cancel/void/refund | *POS* (cancelling paid orders needs *Void*) |
| Shift | **Open shift** with opening cash, live totals, **Cash in / Cash out**, **Close shift** with counted cash → over/short, printable shift report | everyone |
| Products | Edit **prices** and **costs** (profit and margin per item are calculated for you), add/remove products and **add-ons**, **stock** (add, remove, count), sold-out switch, stock log | view: everyone · prices/costs: *Edit prices* · costs are hidden from cashiers |
| Dashboard | **Achievements** (new daily/weekly/monthly sales records, growth vs last month), today/week/month vs previous, **daily / weekly / monthly graphs** of sales and net profit, best-ever records, best sellers with profit, breakdown by payment method/staff/add-ons, **monthly exports** | *Sales* (profit figures need *Finance*) |
| Finance | **Monthly costing & liquidation**: record expenses, automatic cost of goods, gross and net profit, product profitability, printable liquidation report, CSV downloads | *Finance* |
| Settings | Online ordering on/off, payment methods, your GCash QR, **opening hours and special days (pop-up stall)**, **happy hour & promos**, **nightly summary email**, delivery map, distance tiers and fees | *Settings* |
| Users | Add, edit, switch off, delete staff accounts; roles and permissions | *Users* (admins) |
| Activity | **Activity log**: who changed prices and costs, voided/refunded/cancelled orders, gave discounts, deleted expenses, changed stock, settings or staff accounts, and every sign-in (including failed ones). Can't be edited or deleted | *Activity log* (admins, managers) |

Roles: **Admin** (everything), **Manager** (everything except managing users), **Cashier** (POS + cash in/out).
Admins can tick or untick each permission per person.

**Light / dark mode:** the ☀/🌙 button at the top (or your name → Theme). Your choice is saved to your account, so it
follows you to any device you sign in on.

## Opening hours, order ahead and pop-up days

- Default hours: **Monday–Friday 9:00 AM – 2:00 AM**, **Saturday–Sunday 12:00 PM – 9:00 PM** (Settings → Opening hours).
  A closing time earlier than the opening time means after midnight.
- While closed, customers can't order "as soon as possible". They can **order ahead** for any 15-minute slot while
  you're open, up to 7 days ahead (at least 30 minutes from now). The POS works at any time.
- **Special days** replace the normal hours for one date: pop-up stall, event, holiday, or closed. A note (like where your
  stall is) shows on the website. **Close online orders for the rest of today** does this in one tap.
- Order-ahead orders appear on the Board right away with **⏰ Order ahead · pickup 7:30 PM**. They're dimmed until about
  45 minutes before, then turn amber ("Start making it now"). Stock is reserved when the order is placed.
- **Order again**: the customer's phone remembers their last orders (60 days). Next visit they see "Welcome back! Your
  last order…" with an **Order again** button, which skips anything sold out or no longer on the menu.

## Happy hour & promos

- Settings → Happy hour & promos: name, % off, days, start/end time, which categories, and *iced drinks only*.
- The discount applies to the item price (not add-ons) and is rounded to whole pesos (₱119 − 10% = ₱107).
  The best promo wins if two match. It applies on the website **and** the POS. Each line saves which promo it got.
- For order-ahead, the price follows the **pickup time**, so ordering at 3 PM for 7 PM pays the normal price.

## Product photos

Products → **Add photo** on any row. The photo is cropped to 4:3 and shrunk in the browser (about 30–80 KB), stored in
your database, and cached by Vercel for a year, so the menu stays fast. Items without a photo keep their drawing.
Use clear, well-lit photos of the actual drink or plate, with the same background for every photo if you can.

## Nightly summary email

Every morning around 4–5 AM (after you close), the owner gets an email for the business day that just ended:
net sales and orders vs the same day last week, cost of goods, gross and net profit, the top 5 best sellers, low stock,
voids/refunds, cash drawer over/short per shift, and tomorrow's order-ahead orders, plus a 🏆 when it's a new record.
Set it up once (SETUP.md, *Nightly summary email*). **Preview** and **Send now** are in Settings.

Facebook Messenger isn't used: Facebook only lets a Page message you within 24 hours of *you* messaging the Page, so a
nightly message would stop working. Email has no such limit.

**Business day:** reports, the Dashboard, Finance and the email count a day from **4 AM to 4 AM**, so a sale at 1 AM
counts for the night before.

## Costing, profit and liquidation (Finance tab)

- Every product has a **selling price** and a separate **cost** (what one serving costs you to make). Products shows
  the profit and margin for each one. Items with no price are hidden from customers and the POS can't sell them;
  items with no cost show *no cost* (tick **Missing cost only** to find them).
- When something is sold, its cost **at that moment** is saved with the order, so changing a cost later doesn't
  rewrite past months.
- **Net sales** = paid orders (after discounts, including delivery fees).
- **Cost of goods** = cost of every item and add-on sold, plus any *Cost of goods adjustment* expense (spoilage, waste).
- **Gross profit** = net sales − cost of goods. **Net profit** = gross profit − operating expenses
  (employee, utilities, rent, other operating, miscellaneous). Shift **cash outs** are counted automatically.
- **Purchases** (raw materials, packaging, inventory) are listed separately. They are *not* subtracted again from net
  profit, because what you sell is already counted through cost of goods. The **cash view** line shows net sales minus
  all money spent, for comparison.
- If some items sold have no cost, the page warns you, because profit will look higher than it really is.
- **Print report** gives a one-page liquidation statement. Exports: liquidation, expenses, product profit (CSV).

## How the money adds up (shift report)

- A sale belongs to the shift of the staff member who **took the money**: POS sales, pay-at-counter or cash-on-delivery
  orders collected at handover, and GCash/Maya QR payments they confirmed. Automatic PayMongo payments don't belong to a
  shift, but they're in the daily totals.
- **Gross** = items + add-ons + delivery fees. **Net** = gross − discounts.
- **Expected cash** = opening cash + cash sales + cash in − cash out. The cashier counts the drawer at closing and
  the report shows **over / short**.
- Cash in/out entries can't be edited or deleted. To fix a mistake, record the opposite entry with a note.

## Monthly exports (Dashboard → Monthly export, Finance → Download)

CSV files that open in Excel or Google Sheets:
**Daily summary** (per day: gross, discounts, delivery fees, net, cash, GCash, Maya, card, QR, online vs POS, voids, cash in/out, TOTAL row),
**Shifts** (one row per shift with expected/counted/over-short), **All orders**, **Item sales** (with add-ons), **Cash in/out**, **Stock log**.

## How it's built

- **Vercel**: static files in `public/`, serverless functions in `api/`. It uses only **4 functions**, under the free plan's limit of 12.
  `vercel.json` routes `/api/staff/<action>` to `api/staff.js` and `/api/orders/<id>` to `api/orders.js`.
- **Neon Postgres**: tables are created and upgraded automatically on the first request after a deploy.
  A warm server checks this with a single query, so it adds almost no time.
- **Speed**: each screen loads its data in **one database round trip**. The public menu is cached for 3 seconds at
  Vercel's edge (not in browsers). Server code runs in Singapore (`sin1`).
- **Live updates without refreshing**: every change to prices, stock, add-ons or settings bumps a version number.
  Open pages check it every 15 seconds (the staff board every 4 seconds) and refresh their data. When you deploy a new
  version, open pages reload themselves at a safe moment. The customer's cart and the POS ticket are kept.
- **Messages** update every 4 seconds while an order is active, so they're near real time, not instant.

```
api/
  menu.js            GET /api/menu (+ ?sync=1 version check, ?img=<id> product photos)
  cron.js            daily job: nightly summary email (vercel.json "crons")
  orders.js          POST /api/orders · GET/POST /api/orders/:id (status, GCash reference, messages)
  staff.js           all staff actions → lib/staff/*.js
  payments/webhook.js  PayMongo (optional)
lib/
  db.js              database, schema, settings
  auth.js            accounts, passwords (scrypt), sessions, permissions
  pricing.js         catalog, prices, add-ons, stock, delivery fee, split payments
  shifts.js          shift totals
  paymongo.js        optional PayMongo
  menu.js            starting menu + add-ons, roles, discounts, cash categories, delivery defaults
  time.js            time zone, business day, opening hours, happy-hour rules
  finance.js         dashboard, records, liquidation
  summary.js         nightly summary email (Resend)
  staff/             account, board, pos, catalog, shift, reports, settings, finance, activity
public/
  index.html, js/site.js     customer website
  staff.html, js/staff.js    staff admin
  css/site.css
```

## Environment variables

| Name | Needed | What |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `STAFF_PASSWORD` | yes (first time) | First sign-in: username **admin** + this password creates the owner account. After that, accounts are managed in **Users** |
| `SESSION_SECRET` | yes | 64 random characters (signs staff logins) |
| `CAFE_TIMEZONE` | yes | `Asia/Manila` |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` | optional | only if you use PayMongo for cards / automatic GCash |

## Limits to know

- **GCash/Maya QR payments are confirmed by staff.** GCash has no API for personal accounts. Always check that the money
  and the reference number are in your GCash app before tapping **Payment received**.
- **Delivery distance is a straight line**, not the road route. Set your tiers with that in mind.
- The map uses free OpenStreetMap tiles. For heavy use, consider a map provider with a key (e.g. MapTiler) later.
- Receipts say *"This is not an official receipt."* Keep using your BIR-registered receipts or invoices. Ask your accountant about
  Senior/PWD VAT exemption; the system only calculates the 20% discount.
- Opening hours and address on the website are placeholders: edit `public/index.html` and `public/js/site.js`.
