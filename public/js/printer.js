/* Bluetooth receipt printer (ESC/POS thermal printers, 58 mm or 80 mm).
 *
 * Works in Chrome / Edge on Android, Windows, Mac and ChromeOS (Web Bluetooth). Not on iPhone / iPad.
 * The printer is chosen once per device; it's remembered, and reconnected when you print.
 * Settings are kept per device (each tablet / laptop can have its own printer).
 *
 *   DDPrinter.connect()                 choose a printer (must come from a tap / click)
 *   DDPrinter.print(bytes)              send ESC/POS bytes (reconnects if needed)
 *   DDPrinter.receipt(order) / .ticket(order) / .test()   build the bytes
 */
(() => {
  'use strict';
  // Services used by common Bluetooth thermal printers (the "Printer" service of most 58/80 mm models)
  const SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb', '0000ae3a-0000-1000-8000-00805f9b34fb', '0000af30-0000-1000-8000-00805f9b34fb',
    '0000ff12-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb',
  ];
  const KEY = 'dd-printer';
  const DEFAULTS = { width: 58, logo: true, autoNew: 'off', autoPos: 'off', copies: 1, footer: '', safe: false, deviceId: '', name: '' };
  const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
  let cfg = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };

  let device = null, ch = null, busy = Promise.resolve();
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(); } catch {} });
  const supported = !!(navigator.bluetooth && window.isSecureContext);

  // ------------------------------------------------------------------ connection
  async function attach(dev) {
    device = dev;
    if (!dev._ddWatched) { dev._ddWatched = true; dev.addEventListener('gattserverdisconnected', () => { ch = null; emit(); }); }
    const server = dev.gatt.connected ? dev.gatt : await dev.gatt.connect();
    let found = null;
    const services = await server.getPrimaryServices().catch(() => []);
    for (const s of services) {
      const chars = await s.getCharacteristics().catch(() => []);
      found = chars.find((c) => c.properties.write) || chars.find((c) => c.properties.writeWithoutResponse);
      if (found) break;
    }
    if (!found) { try { dev.gatt.disconnect(); } catch {} throw new Error("Connected, but this device doesn't accept printing. Is it a receipt printer?"); }
    ch = found;
    cfg.deviceId = dev.id; cfg.name = dev.name || 'Printer'; save(); emit();
    return true;
  }
  async function connect() {
    if (!supported) throw new Error('Bluetooth printing needs Chrome or Edge on Android, Windows or Mac (not iPhone / iPad).');
    const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
    return attach(dev);
  }
  /** Reconnect to the remembered printer without asking (works when the browser remembers the permission). */
  async function reconnect() {
    if (ch && device?.gatt.connected) return true;
    if (device) { try { return await attach(device); } catch {} }
    if (!cfg.deviceId || !navigator.bluetooth?.getDevices) return false;
    const list = await navigator.bluetooth.getDevices().catch(() => []);
    const dev = list.find((d) => d.id === cfg.deviceId);
    if (!dev) return false;
    try { return await attach(dev); } catch { return false; }
  }
  function forget() { try { device?.gatt.disconnect(); } catch {} try { device?.forget?.(); } catch {} device = null; ch = null; cfg.deviceId = ''; cfg.name = ''; save(); emit(); }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function send(bytes) {
    if (!(await reconnect())) throw Object.assign(new Error('The printer is not connected. Tap 🖨️ at the top, then "Connect printer".'), { code: 'NOT_CONNECTED' });
    // small pieces: Bluetooth printers only take a little at a time ("safe mode" = even smaller and slower)
    const withResp = !!ch.properties.write && !cfg.safe, size = cfg.safe ? 20 : withResp ? 180 : 100;
    for (let i = 0; i < bytes.length; i += size) {
      const part = bytes.slice(i, i + size);
      if (withResp) await ch.writeValueWithResponse(part);
      else { await (ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(part) : ch.writeValue(part)); await sleep(cfg.safe ? 25 : 8); }
    }
  }
  /** One print job at a time (two orders arriving together print one after the other). */
  function print(bytes, copies = 1) {
    const job = busy.then(async () => { for (let c = 0; c < Math.max(1, Math.min(5, copies)); c++) await send(bytes); });
    busy = job.catch(() => {});
    return job;
  }

  // ------------------------------------------------------------------ ESC/POS
  // Plain printable characters only (₱ → P, accents removed, emoji dropped): cheap printers can't show the rest.
  const ascii = (s) => String(s ?? '').replace(/₱/g, 'P').replace(/[×✕]/g, 'x').replace(/[–—−]/g, '-').replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'")
    .replace(/•/g, '*').replace(/…/g, '...').replace(/ñ/g, 'n').replace(/Ñ/g, 'N').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n]/g, '');
  const peso = (c) => `${c < 0 ? '-' : ''}P${(Math.abs(c || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const wrap = (text, width) => {
    const out = []; let line = '';
    for (const word of ascii(text).split(' ').filter(Boolean)) {
      let w = word;
      while (w.length > width) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, width)); w = w.slice(width); }
      if (!line) line = w; else if (line.length + 1 + w.length <= width) line += ' ' + w; else { out.push(line); line = w; }
    }
    if (line || !out.length) out.push(line);
    return out;
  };
  class Doc {
    constructor(width) { this.cols = width === 80 ? 48 : 32; this.dots = width === 80 ? 576 : 384; this.b = [0x1b, 0x40, 0x1b, 0x74, 0x00]; this.mul = 1; }
    raw(...x) { this.b.push(...x); return this; }
    txt(s) { for (const c of ascii(s)) this.b.push(c.charCodeAt(0)); return this; }
    nl(n = 1) { for (let i = 0; i < n; i++) this.b.push(0x0a); return this; }
    align(a) { return this.raw(0x1b, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0); }
    bold(on) { return this.raw(0x1b, 0x45, on ? 1 : 0); }
    size(w, h = w) { this.mul = w; return this.raw(0x1d, 0x21, ((w - 1) << 4) | (h - 1)); }
    get w() { return Math.floor(this.cols / this.mul); }
    line(s = '') { wrap(s, this.w).forEach((l) => this.txt(l).nl()); return this; }
    rule(c = '-') { return this.txt(c.repeat(this.w)).nl(); }
    /** "left ......... right" (the left side wraps; the amount stays on the last line) */
    lr(left, right, indent = 0) {
      right = ascii(right); const pad = ' '.repeat(indent), room = this.w - right.length - 1 - indent;
      const lines = wrap(left, Math.max(8, room));
      lines.forEach((l, i) => { if (i < lines.length - 1) this.txt(pad + l).nl(); else this.txt((pad + l).padEnd(this.w - right.length) + right).nl(); });
      return this;
    }
    /** a 1-bit picture (GS v 0), centered */
    image(bits, w, h) {
      const bw = Math.ceil(w / 8);
      this.align('center').raw(0x1d, 0x76, 0x30, 0x00, bw & 0xff, bw >> 8, h & 0xff, h >> 8);
      for (let y = 0; y < h; y++) for (let x = 0; x < bw; x++) {
        let v = 0; for (let k = 0; k < 8; k++) { const px = x * 8 + k; if (px < w && bits[y * w + px]) v |= 0x80 >> k; }
        this.b.push(v);
      }
      return this.nl();
    }
    end() { return this.raw(0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00); } // feed + cut (printers without a cutter ignore it)
    bytes() { return new Uint8Array(this.b); }
  }

  // the cat logo, as black dots: only the dark parts of the app icon (the cat) print; the green and the eyes stay white
  let logoBits = null;
  async function logo(dots) {
    if (logoBits && logoBits.dots === dots) return logoBits;
    const img = new Image(); img.src = '/icons/icon-192.png';
    await img.decode();
    const W = Math.round(dots * 0.32), crop = { x: 38, y: 34, w: 116, h: 120 }, H = Math.round(W * crop.h / crop.w);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, bits = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2]; bits[i] = 0.299 * r + 0.587 * gr + 0.114 * b < 60 ? 1 : 0; }
    return (logoBits = { bits, w: W, h: H, dots });
  }

  const PAY = { cash: 'Cash', gcash: 'GCash', paymaya: 'Maya', card: 'Card', counter: 'Pay at counter', qrph: 'GCash/Maya QR', split: 'Split' };
  const when = (v) => (v ? new Date(v).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const time = (v) => (v ? new Date(v).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) : '');
  const kind = (o) => (o.source === 'pos' ? (o.pickupLabel || 'Walk-in') : o.orderType === 'delivery' ? 'DELIVERY' : 'PICKUP');

  async function header(doc) {
    if (cfg.logo) { try { const L = await logo(doc.dots); doc.image(L.bits, L.w, L.h); } catch {} }
    doc.align('center').bold(true).size(2).line("DEMETRIA'S DINER").size(1).bold(false).line('Come for the drinks, stay for the comfort');
  }

  /** Customer receipt: items with prices, totals, payment, thank-you. */
  async function receipt(o) {
    const doc = new Doc(cfg.width);
    await header(doc);
    doc.nl().size(2).bold(true).line(`#${o.code}`).size(1).bold(false)
      .line(when(o.paidAt || o.createdAt)).line(kind(o) + (o.name && o.name !== 'Walk-in' ? ` - ${o.name}` : ''));
    if (o.staffName) doc.line(`Cashier: ${o.staffName}`);
    doc.align('left').rule('=');
    for (const i of o.items || []) {
      doc.bold(true).lr(`${i.qty} x ${i.name}`, peso(i.unitCents * i.qty)).bold(false);
      if (i.opts) doc.lr(i.opts, '', 2);
      for (const a of i.addons || []) doc.lr(`+ ${a.name}`, a.cents ? peso(a.cents * i.qty) : '', 2);
      if (i.note) doc.lr(`Note: ${i.note}`, '', 2);
      if (i.promo) doc.lr(`${i.promo.name}`, `-${peso(i.promo.offCents * (i.qty || 1)).replace('-', '')}`, 2);
    }
    doc.rule();
    doc.lr('Subtotal', peso(o.subtotalCents ?? o.totalCents));
    if (o.discountCents) doc.lr(o.discountType || 'Discount', '-' + peso(o.discountCents));
    if (o.deliveryFeeCents) doc.lr('Delivery fee', peso(o.deliveryFeeCents));
    doc.bold(true).size(1, 2).lr('TOTAL', peso(o.totalCents)).size(1).bold(false).rule();
    for (const p of o.payments || []) doc.lr(`${PAY[p.method] || p.method}${p.ref ? ` (ref ${p.ref})` : ''}`, peso(p.cents));
    if (!(o.payments || []).length) doc.lr(o.paymentStatus === 'paid' ? (PAY[o.paymentMethod] || 'Paid') : 'NOT PAID YET', o.paymentStatus === 'paid' ? peso(o.totalCents) : '');
    if (o.tenderedCents != null) doc.lr('Cash received', peso(o.tenderedCents)).lr('Change', peso(o.changeCents));
    if (o.loyaltyPhone) doc.nl().align('center').line(`Stamp card ${o.loyaltyPhone.slice(0, 4)}***${o.loyaltyPhone.slice(-4)}${o.loyaltyEarn ? ` +${o.loyaltyEarn} stamp${o.loyaltyEarn === 1 ? '' : 's'}` : ''}`);
    doc.nl().align('center').bold(true).line('Thank you! See you again.').bold(false);
    if (cfg.footer) cfg.footer.split('\n').forEach((l) => doc.line(l));
    const site = location.hostname.replace(/^www\./, '');
    if (site.includes('.') && !/vercel\.app$|localhost|^\d/.test(site)) doc.line(site);
    doc.line('This is not an official receipt.').end();
    return doc.bytes();
  }

  /** Kitchen / order ticket: big number, name, items, add-ons, notes. No prices. */
  async function ticket(o) {
    const doc = new Doc(cfg.width);
    doc.align('center').bold(true).line(o.source === 'pos' ? '*** ORDER ***' : `*** ${kind(o)} ***`)
      .size(3).line(`#${o.code}`).size(2).line(o.name || 'Walk-in').size(1).bold(false);
    doc.line(o.scheduledFor ? `ORDER AHEAD: ${when(o.scheduledFor)}` : o.source === 'pos' ? when(o.createdAt) : `${o.pickupLabel || ''}${o.pickupAt ? ` (${time(o.pickupAt)})` : ''}`);
    doc.line(o.paymentStatus === 'paid' ? 'PAID' : `NOT PAID - ${PAY[o.paymentMethod] || ''}`).align('left').rule('=');
    for (const i of o.items || []) {
      doc.bold(true).size(1, 2).line(`${i.qty} x ${i.name}`).size(1).bold(false);
      if (i.opts) doc.line(`   ${i.opts}`);
      for (const a of i.addons || []) doc.line(`   + ${a.name}`);
      if (i.note) doc.bold(true).line(`   >> ${i.note}`).bold(false);
    }
    if (o.note) doc.rule().bold(true).line('NOTE:').bold(false).line(o.note);
    if (o.delivery) { doc.rule().bold(true).line('DELIVER TO:').bold(false).line(o.delivery.address || ''); if (o.delivery.landmark) doc.line(o.delivery.landmark); if (o.delivery.phone) doc.line(o.delivery.phone); }
    doc.rule('=').align('center').line(`Printed ${when(new Date())}`).end();
    return doc.bytes();
  }

  async function test() {
    const doc = new Doc(cfg.width);
    await header(doc);
    doc.nl().line('Printer test').line(`${cfg.width} mm paper - ${doc.cols} characters per line`).align('left').rule()
      .lr('1 x Matcha Latte', 'P150.00').lr('+ Oat milk', 'P30.00', 2).bold(true).size(1, 2).lr('TOTAL', 'P180.00').size(1).bold(false).rule()
      .align('center').line('If this looks right, you are all set!').end();
    return doc.bytes();
  }

  window.DDPrinter = {
    supported, connect, reconnect, forget, print,
    receipt, ticket, test,
    get connected() { return !!(ch && device?.gatt.connected); },
    get name() { return cfg.name; },
    get remembered() { return !!cfg.deviceId; },
    get settings() { return { ...cfg }; },
    set(patch) { cfg = { ...cfg, ...patch }; save(); emit(); },
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    _ascii: ascii, _Doc: Doc,
  };
})();