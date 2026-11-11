// Demetria's Diner staff admin: board, POS, orders, shift, products, sales, settings, users.
(() => {
  // ===================================================================== helpers
  const $ = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => [...el.querySelectorAll(q)];
  const money = (c) => (c < 0 ? '−' : '') + '₱' + (Math.abs(c || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: Math.abs(c || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const toCents = (v) => { const n = Math.round(parseFloat(String(v).replace(/,/g, '')) * 100); return Number.isFinite(n) ? n : null; };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDT = (v) => (v ? new Date(v).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
  const rel = (v) => { const m = Math.round((new Date(v) - Date.now()) / 60000); return m > 0 ? `in ${m} min` : m === 0 ? 'now' : `${-m} min late`; };
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const PAY = { cash: 'Cash', gcash: 'GCash', paymaya: 'Maya', card: 'Card', counter: 'Counter', qrph: 'GCash/Maya QR', split: 'Split' };
  const PAYST = { paid: 'Paid', pending: 'Waiting', unpaid: 'Unpaid', refunded: 'Refunded', expired: 'Expired', failed: 'Failed', voided: 'Voided', awaiting_proof: 'Not paid yet', submitted: 'Check ref', rejected: 'Not received' };
  const STATUS = { new: 'New', making: 'Making', ready: 'Ready', delivering: 'Out for delivery', done: 'Done', cancelled: 'Cancelled' };
  let CAT = {}; // category names come from the server (lib/menu.js)
  const FOOD_CATS = ['silog', 'snacks', 'food', 'pastries'];
  const kindOf = (cat) => (FOOD_CATS.includes(cat) ? 'food' : cat === 'others' ? 'plain' : 'drink');
  const groupsFor = (cat) => ({ food: ['food', 'packaging'], drink: ['drink', 'packaging'], plain: [] })[kindOf(cat)];
  const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
  // Happy hour: same rules as the server (lib/time.js). The server always re-checks the price.
  const cafeClock = (d, tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Manila', hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value])); return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: +p.hour * 60 + +p.minute }; };
  const hm = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const promoOn = (p, t, tz) => { const { dow, min } = cafeClock(t, tz), f = hm(p.from), to = hm(p.to); return f < to ? p.days.includes(dow) && min >= f && min < to : (p.days.includes(dow) && min >= f) || (p.days.includes((dow + 6) % 7) && min < to); };
  const promoFor = (item, promos, t = new Date(), tz) => {
    if (!item || item.price == null) return null;
    let best = null;
    for (const p of promos || []) {
      if (p.cats?.length && !p.cats.includes(item.cat)) continue;
      if (p.icedOnly && !(kindOf(item.cat) === 'drink' && !item.hot)) continue;
      if (!promoOn(p, t, tz)) continue;
      const off = Math.min(item.price, Math.round((item.price * p.pct) / 10000) * 100);
      if (off > 0 && (!best || off > best.off)) best = { promo: p, off };
    }
    return best;
  };
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmtWhen = (v) => { const d = new Date(v), t = new Date(); const same = d.toDateString() === t.toDateString(); const tm = new Date(t); tm.setDate(t.getDate() + 1);
    return `${same ? 'Today' : d.toDateString() === tm.toDateString() ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(v)}`; };

  const api = async (path, opts = {}) => {
    const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.endsWith('/login')) { showLogin(); throw Object.assign(new Error(data.error || 'Signed out'), { status: 401 }); }
    if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: r.status });
    return data;
  };
  let toastT;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3800); };
  const fail = (e) => { if (e.status !== 401) toast(e.message); };
  let ac;
  const chime = (high) => {
    if (!$('#soundToggle').checked) return;
    try {
      ac ||= new (window.AudioContext || window.webkitAudioContext)();
      (high ? [1320, 1760] : [880, 1320]).forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.18;
        o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.4);
      });
    } catch {}
  };
  const payBadge = (o) => {
    const parts = (o.payments || []).length > 1 ? o.payments.map(p => PAY[p.method] || p.method).join(' + ') : PAY[o.paymentMethod] || o.paymentMethod;
    return `<span class="pay-badge">${o.source === 'pos' ? 'POS · ' : ''}${esc(parts)} <span class="pill ${o.paymentStatus}">${PAYST[o.paymentStatus] || o.paymentStatus}</span></span>`;
  };
  const promoTag = (i) => (i.promo ? `<small class="promo-t">${esc(i.promo.name)} −${money(i.promo.offCents)}${i.qty > 1 ? ' each' : ''}</small>` : '');
  const itemLine = (i) => `${i.qty} × ${esc(i.name)}${i.opts ? `<small>${esc(i.opts)}</small>` : ''}${promoTag(i)}${(i.addons || []).length ? `<small class="adds">+ ${i.addons.map(a => esc(a.name)).join(', ')}</small>` : ''}`;
  const itemsText = (o) => o.items.map(i => `${i.qty}× ${esc(i.name)}${(i.addons || []).length ? ' +' + i.addons.length : ''}`).join(', ');

  // ===================================================================== state
  let me = null, perms = new Set(), settings = null, catalog = { products: [], addons: [] };
  let board = null, seen = null, seenMsgs = null, timer = null;
  const busy = new Set();
  const cache = new Map();
  const remember = (list) => list.forEach(o => cache.set(o.id, o));
  const can = (p) => perms.has(p);

  // ===================================================================== auth
  function showLogin() {
    clearInterval(timer); timer = null; me = null;
    $('#app').hidden = true; $('#loginView').hidden = false; setTimeout(() => $('#uname').focus(), 50);
  }
  function setMe(d) {
    me = d; perms = new Set(d.user.perms);
    applyTheme(d.user.theme || 'auto');
    $('#userName').textContent = d.user.name;
    $('#userRole').textContent = `${d.roles[d.user.role]?.label || d.user.role} · @${d.user.username}`;
    $$('.tabs a').forEach(a => { a.hidden = !!a.dataset.perm && !can(a.dataset.perm); });
    $$('[data-perm-box]').forEach(el => { el.hidden = !can(el.dataset.permBox); });
    $$('[data-perm-opt]').forEach(o => { o.hidden = o.disabled = !can(o.dataset.permOpt); });
    updateShiftUi();
  }
  function updateShiftUi() {
    const s = me?.shift;
    $('#shiftPill').classList.toggle('on', !!s);
    $('#shiftPillT').textContent = s ? `Shift since ${fmtTime(s.openedAt)}` : 'No shift open';
    $('#shiftBanner').hidden = !!s;
    $('#posShiftBanner').hidden = !!s;
    renderTicket();
  }
  async function showApp(d) {
    setMe(d);
    $('#loginView').hidden = true; $('#app').hidden = false;
    try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    firstBuild = d.build; dataV = d.v;
    await Promise.all([loadCatalog(), loadSettings()]);
    route();
    await refreshBoard();
    clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refreshBoard(); }, 4000);
    checkMilestones();
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'), note = $('#loginNote');
    btn.disabled = true; note.textContent = ''; note.classList.remove('err');
    try {
      const d = await api('/api/staff/login', { method: 'POST', body: { username: $('#uname').value, password: $('#pw').value } });
      $('#pw').value = ''; seen = null; seenMsgs = null; await showApp(d);
    } catch (err) { note.textContent = err.message; note.classList.add('err'); }
    btn.disabled = false;
  });
  $('#userBtn').onclick = (e) => { e.stopPropagation(); const p = $('#userPop'); p.hidden = !p.hidden; $('#userBtn').setAttribute('aria-expanded', String(!p.hidden)); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.user-menu')) $('#userPop').hidden = true; });
  $('#logoutBtn').onclick = async () => { await fetch('/api/staff/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {}); showLogin(); };
  $('#pwBtn').onclick = () => { $('#userPop').hidden = true; $('#pwForm').reset(); $('#pwNote').textContent = ''; $('#pwDlg').showModal(); };
  $('#pwClose').onclick = () => $('#pwDlg').close();
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/staff/me', { method: 'PUT', body: { currentPassword: $('#pwOld').value, newPassword: $('#pwNew').value } }); $('#pwDlg').close(); toast('Password changed'); }
    catch (err) { $('#pwNote').textContent = err.message; $('#pwNote').classList.add('err'); }
  });

  // ===================================================================== theme (light / dark), saved on the account
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    try { localStorage.setItem('dd-theme', t); } catch {}
    const dark = t === 'dark' || (t !== 'light' && prefersDark());
    $('#themeBtn').textContent = dark ? '☀' : '🌙';
    $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
    if (dash && !$('#view-sales').hidden) drawChart();
  }
  async function setTheme(t) {
    applyTheme(t);
    if (me) { me.user.theme = t; try { await api('/api/staff/me', { method: 'PUT', body: { theme: t } }); } catch {} }
  }
  $('#themeBtn').onclick = () => { const cur = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); setTheme(cur === 'dark' ? 'light' : 'dark'); };
  $$('[data-theme-set]').forEach(b => b.onclick = () => setTheme(b.dataset.themeSet));

  // ===================================================================== tabs
  const TABS = ['board', 'pos', 'orders', 'shift', 'products', 'sales', 'finance', 'settings', 'users', 'activity'];
  function route() {
    let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'board';
    const link = $(`.tabs a[data-tab="${tab}"]`);
    if (link?.hidden) tab = 'board';
    TABS.forEach(t => { $('#view-' + t).hidden = t !== tab; });
    $$('.tabs a').forEach(a => a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    ({ orders: loadHistory, shift: loadShift, sales: () => { loadDashboard(); loadReport(); }, finance: loadFinance, products: renderProducts, users: loadUsers, settings: () => { renderSettings(); loadCodes(); }, pos: renderPosMenu, activity: loadActivity }[tab] || (() => {}))();
  }
  window.addEventListener('hashchange', route);

  // ===================================================================== catalog + settings
  async function loadCatalog() {
    try { catalog = await api('/api/staff/products'); CAT = catalog.categories || CAT; document.body.classList.toggle('sees-cost', !!catalog.seesCost); renderPosMenu(); if (!$('#view-products').hidden) renderProducts(); } catch (e) { fail(e); }
  }
  async function loadSettings() {
    try { settings = await api('/api/staff/settings'); if (!$('#view-settings').hidden) renderSettings(); } catch (e) { fail(e); }
  }

  // ===================================================================== BOARD
  async function refreshBoard() {
    try {
      board = await api('/api/staff/orders');
      remember(board.open); remember(board.finished);
      const fresh = seen ? board.open.filter(o => !seen.has(o.id) && o.status === 'new') : [];
      if (fresh.length) { toast(`New order #${fresh[0].code} from ${fresh[0].name}`); chime(); }
      seen = new Set([...(seen || []), ...board.open.map(o => o.id)]);
      const unread = board.threads.reduce((a, t) => a + t.unread, 0);
      const msgKey = board.threads.map(t => t.id + ':' + t.lastAt).join('|');
      if (seenMsgs !== null && unread > 0 && msgKey !== seenMsgs) { const t = board.threads.find(x => x.unread); if (t) { toast(`💬 #${t.code} ${t.name}: ${t.lastMessage}`); chime(true); } }
      seenMsgs = msgKey;
      if (!!me.shift !== board.shiftOpen) { await refreshMe(); }
      $('#syncNote').textContent = `Updated ${fmtTime(Date.now())} · live`;
      $('#syncNote').classList.remove('err');
      renderBoard(); renderThreads();
      if (detailId) renderDetail();
      checkUpdates(board);
    } catch (e) {
      if (e.status !== 401) { $('#syncNote').textContent = `Can't reach the server. Retrying… (${e.message})`; $('#syncNote').classList.add('err'); }
    }
  }
  async function refreshMe() { try { const d = await api('/api/staff/login'); if (d.signedIn) setMe(d); } catch {} }

  const NEXT = (o) => {
    if (o.status === 'new') return ['making', 'Start making'];
    if (o.status === 'making') return ['ready', 'Mark ready'];
    if (o.status === 'ready') return o.orderType === 'delivery' ? ['delivering', 'Out for delivery'] : ['done', 'Picked up'];
    if (o.status === 'delivering') return ['done', 'Delivered'];
    return null;
  };
  const needsCheck = (o) => o.paymentMethod === 'qrph' && o.paymentStatus === 'submitted';
  const needsPay = (o, next) => next === 'done' && o.paymentMethod === 'counter' && o.paymentStatus !== 'paid';
  function renderBoard() {
    if (!board) return;
    const n = board.open.length, t = board.today;
    $('#badge').hidden = !n; $('#badge').textContent = n;
    document.title = (n ? `(${n}) ` : '') + "Demetria's · Staff";
    const aw = board.awaitingPayment;
    $('#awaitBanner').hidden = !aw;
    $('#awaitBanner').textContent = `${aw} online order${aw === 1 ? ' is' : 's are'} waiting for the customer to pay. They'll appear here once paid (or once a GCash reference is sent).`;
    $('#stats').innerHTML = [[n, 'Open orders'], [t.orders, 'Paid orders today'], [money(t.sales_cents), 'Sales today'], [t.items, 'Items today']]
      .map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    const cols = [['new', 'New'], ['making', 'Making'], ['ready', 'Ready'], ['delivering', 'Out for delivery']];
    $('#cols').innerHTML = cols.map(([k, title]) => {
      const list = board.open.filter(o => o.status === k);
      return `<div class="col"><h3>${title}<span>${list.length}</span></h3>${list.length ? list.map(ticket).join('') : '<div class="empty">No orders</div>'}</div>`;
    }).join('');
    $('#doneList').innerHTML = board.finished.length
      ? board.finished.map(o => `<div data-open="${esc(o.id)}" class="clickable"><b>#${esc(o.code)} · ${esc(o.name)}</b><span>${o.status === 'done' ? money(o.totalCents) : PAYST[o.paymentStatus] || 'Cancelled'}${o.staffName ? ' · ' + esc(o.staffName) : ''}</span></div>`).join('')
      : '<p class="hint">Finished orders show up here.</p>';
  }
  const ticket = (o) => {
    const nx = NEXT(o), late = o.source !== 'pos' && o.status !== 'ready' && o.status !== 'delivering' && new Date(o.pickupAt) < Date.now();
    const d = o.delivery;
    const ahead = o.scheduledFor ? (new Date(o.scheduledFor) - Date.now()) / 60000 : null; // minutes until an order-ahead is due
    const later = ahead != null && ahead > 45 && o.status === 'new';
    return `
    <div class="ticket ${o.status} ${late ? 'late' : ''} ${later ? 'later' : ''}">
      <div class="t-top"><b>#${esc(o.code)}</b><span>${esc(o.name)}<br>${o.source === 'pos' ? esc(o.pickupLabel) : `${o.scheduledFor ? fmtWhen(o.pickupAt) : fmtTime(o.pickupAt)} · ${rel(o.pickupAt)}`}</span></div>
      ${o.scheduledFor ? `<div class="sched-tag ${ahead != null && ahead <= 30 && ahead > -60 ? 'due' : ''}">⏰ Order ahead · ${o.orderType === 'delivery' ? 'deliver' : 'pickup'} ${fmtWhen(o.scheduledFor)}${later ? '<br><small>Start about 15 minutes before</small>' : ahead != null && ahead <= 30 && ahead > 0 ? '<br><small>Start making it now</small>' : ''}</div>` : ''}
      ${o.orderType === 'delivery' ? `<div class="deliv-tag">🛵 Delivery · ${d?.km ?? '?'} km<br><small>${esc(d?.address || '')}${d?.landmark ? ' · ' + esc(d.landmark) : ''}</small><br><a href="https://www.google.com/maps?q=${d?.lat},${d?.lng}" target="_blank" rel="noopener">Map</a> · <span class="mono">${esc(d?.phone || '')}</span></div>` : ''}
      <ul>${o.items.map(i => `<li>${itemLine(i)}</li>`).join('')}</ul>
      ${o.note ? `<div class="nt">“${esc(o.note)}”</div>` : ''}
      ${o.unread || o.lastMessage ? `<button type="button" class="msg-chip ${o.unread ? 'new' : ''}" data-chat="${esc(o.id)}">💬 ${o.unread ? `${o.unread} new · ` : ''}${esc(o.lastMessage || '')}</button>` : ''}
      <div class="t-top"><span>${payBadge(o)}</span><span>${money(o.totalCents)}</span></div>
      ${needsCheck(o) ? `<div class="ref-box">Check your GCash for <b>${money(o.totalCents)}</b>, ref <b>${esc(o.reference)}</b></div>` : ''}
      <div class="t-actions">
        ${needsCheck(o)
          ? `<button class="add" type="button" data-pay="verify" data-id="${esc(o.id)}" ${busy.has(o.id) ? 'disabled' : ''}>Payment received</button>
             <button class="add ghost" type="button" data-pay="reject" data-id="${esc(o.id)}" ${busy.has(o.id) ? 'disabled' : ''}>Not received</button>`
          : nx ? `<button class="add" type="button" data-st="${nx[0]}" data-id="${esc(o.id)}" ${busy.has(o.id) ? 'disabled' : ''}>${needsPay(o, nx[0]) ? `${nx[1]} · collect ${money(o.totalCents)}` : nx[1]}</button>` : ''}
        <button class="add ghost" type="button" data-open="${esc(o.id)}">Details</button>
      </div>
    </div>`;
  };
  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pay]'); if (p && p.dataset.id) return payAction(p.dataset.id, p.dataset.pay);
    const s = e.target.closest('[data-st]'); if (s) return setStatus(s.dataset.id, s.dataset.st);
    const c = e.target.closest('[data-chat]'); if (c) return openChat(c.dataset.chat);
    const d = e.target.closest('[data-open]'); if (d) return openDetail(d.dataset.open);
  });

  async function setStatus(id, status) {
    const o = cache.get(id);
    if (o && needsPay(o, status)) return openPay(o);
    busy.add(id); renderBoard(); renderDetail();
    try {
      const x = await api('/api/staff/orders', { method: 'PATCH', body: { id, status } });
      cache.set(x.id, x);
      if (status === 'cancelled') toast(x.paymentStatus === 'refunded' ? `#${x.code} cancelled and ${money(x.totalCents)} refunded` : x.paymentStatus === 'voided' ? `#${x.code} cancelled. Give back ${money(x.totalCents)}${x.paymentMethod === 'qrph' ? ' by GCash' : ''}.` : `#${x.code} cancelled`);
    } catch (err) { fail(err); }
    busy.delete(id); await refreshBoard(); renderDetail();
    if (!$('#view-orders').hidden) loadHistory(true);
  }
  async function payAction(id, action) {
    busy.add(id); renderBoard(); renderDetail();
    try {
      const o = await api('/api/staff/payment', { method: 'POST', body: { id, action } });
      cache.set(o.id, o);
      toast({ check: o.paymentStatus === 'paid' ? 'Payment confirmed' : 'Not paid yet', verify: `#${o.code} paid. Start making it!`, reject: `#${o.code}: payment not received` }[action]);
    } catch (err) { fail(err); }
    busy.delete(id); renderDetail(); refreshBoard();
  }

  // ---------- split payment panel (POS + collecting a counter order) ----------
  function payPanel(root, getTotal, onChange) {
    let lines = [{ method: 'cash', cents: null }];
    let tendered = '';
    const total = () => getTotal();
    const filled = () => lines.reduce((a, l) => a + (l.cents ?? 0), 0);
    function draw() {
      const t = total();
      if (lines.length === 1) lines[0].cents = t;
      const cashSum = lines.filter(l => l.method === 'cash').reduce((a, l) => a + (l.cents || 0), 0);
      const tc = tendered === '' ? null : toCents(tendered);
      const rem = t - filled();
      root.innerHTML = `
        <fieldset class="pay-lines"><legend>Payment${lines.length > 1 ? ' · split' : ''}</legend>
          ${lines.map((l, i) => `<div class="pay-line">
            <select data-pl-m="${i}" aria-label="Method">${['cash', 'gcash', 'paymaya'].map(m => `<option value="${m}" ${l.method === m ? 'selected' : ''}>${PAY[m]}</option>`).join('')}</select>
            <input data-pl-c="${i}" type="number" inputmode="decimal" step="0.01" min="0" value="${l.cents == null ? '' : (l.cents / 100).toFixed(2).replace(/\.00$/, '')}" ${lines.length === 1 ? 'readonly' : ''} aria-label="Amount">
            ${l.method !== 'cash' ? `<input data-pl-r="${i}" maxlength="60" value="${esc(l.ref || '')}" placeholder="Ref no." aria-label="Reference number">` : '<span></span>'}
            ${lines.length > 1 ? `<button type="button" class="x sm" data-pl-x="${i}" aria-label="Remove">×</button>` : ''}
          </div>`).join('')}
          <div class="pay-tools">
            <button type="button" class="linkbtn" data-pl-add>+ Split payment</button>
            ${lines.length > 1 ? `<button type="button" class="linkbtn" data-pl-fill>Fill remaining (${money(Math.max(0, rem))})</button><span class="${rem === 0 ? 'ok' : 'bad'}">${rem === 0 ? 'Adds up ✓' : rem > 0 ? `${money(rem)} left` : `${money(-rem)} too much`}</span>` : ''}
          </div>
        </fieldset>
        ${cashSum > 0 ? `<div class="field"><label>Cash received (cash part ${money(cashSum)})</label><input data-pl-t type="number" inputmode="decimal" min="0" step="1" value="${esc(tendered)}" placeholder="Exact amount"></div>
          <div class="quick">${[...new Set([cashSum, Math.ceil(cashSum / 10000) * 10000, 20000, 50000, 100000].filter(v => v >= cashSum && cashSum > 0))].sort((a, b) => a - b).slice(0, 5).map(v => `<button type="button" data-pl-q="${v}">${v === cashSum ? 'Exact' : money(v)}</button>`).join('')}</div>
          <p class="change ${tc != null && tc < cashSum ? 'short' : ''}">${tc == null ? `Change: <b>${money(0)}</b> (exact)` : tc < cashSum ? `Short by <b>${money(cashSum - tc)}</b>` : `Change: <b>${money(tc - cashSum)}</b>`}</p>` : ''}
        ${lines.some(l => ['gcash', 'paymaya'].includes(l.method)) && settings?.qr?.image ? '<button class="btn ghost" type="button" data-pl-qr>Show our QR to the customer</button>' : ''}`;
      onChange && onChange();
    }
    root.addEventListener('change', (e) => {
      const m = e.target.dataset.plM; if (m != null) { lines[+m].method = e.target.value; draw(); }
    });
    root.addEventListener('input', (e) => {
      const c = e.target.dataset.plC; if (c != null) { lines[+c].cents = toCents(e.target.value); onChange && onChange(); const span = root.querySelector('.pay-tools span'); if (span) { const rem = total() - filled(); span.className = rem === 0 ? 'ok' : 'bad'; span.textContent = rem === 0 ? 'Adds up ✓' : rem > 0 ? `${money(rem)} left` : `${money(-rem)} too much`; } return; }
      const r = e.target.dataset.plR; if (r != null) { lines[+r].ref = e.target.value; return; }
      if (e.target.dataset.plT != null) { tendered = e.target.value; onChange && onChange(); const cashSum = lines.filter(l => l.method === 'cash').reduce((a, l) => a + (l.cents || 0), 0); const tc = tendered === '' ? null : toCents(tendered); const p = root.querySelector('.change'); if (p) { p.className = 'change' + (tc != null && tc < cashSum ? ' short' : ''); p.innerHTML = tc == null ? `Change: <b>${money(0)}</b> (exact)` : tc < cashSum ? `Short by <b>${money(cashSum - tc)}</b>` : `Change: <b>${money(tc - cashSum)}</b>`; } }
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-pl-add]')) { const rem = total() - filled(); if (lines.length === 1) lines[0].cents = total(); lines.push({ method: lines.some(l => l.method === 'gcash') ? 'paymaya' : 'gcash', cents: lines.length === 1 ? 0 : Math.max(0, rem) }); if (lines.length === 2) { lines[0].cents = null; lines[1].cents = null; } draw(); return; }
      const x = e.target.closest('[data-pl-x]'); if (x) { lines.splice(+x.dataset.plX, 1); draw(); return; }
      if (e.target.closest('[data-pl-fill]')) { const rem = total() - filled(); const empty = lines.find(l => !l.cents) || lines[lines.length - 1]; empty.cents = (empty.cents || 0) + rem; draw(); return; }
      const q = e.target.closest('[data-pl-q]'); if (q) { tendered = String(+q.dataset.plQ / 100); draw(); return; }
      if (e.target.closest('[data-pl-qr]')) { $('#posQrAmt').textContent = money(lines.filter(l => ['gcash', 'paymaya'].includes(l.method)).reduce((a, l) => a + (l.cents || 0), 0)); $('#posQrImg').src = settings.qr.image; $('#posQrName').textContent = settings.qr.name || ''; $('#posQrDlg').showModal(); }
    });
    draw();
    return {
      reset() { lines = [{ method: 'cash', cents: null }]; tendered = ''; draw(); },
      redraw: draw,
      value() {
        const t = total();
        if (lines.length === 1) lines[0].cents = t;
        const sum = filled(), cashSum = lines.filter(l => l.method === 'cash').reduce((a, l) => a + (l.cents || 0), 0);
        const tc = tendered === '' ? null : toCents(tendered);
        let error = '';
        if (lines.some(l => !l.cents || l.cents <= 0)) error = 'Enter an amount for each payment part.';
        else if (sum !== t) error = sum < t ? `Payments are ${money(t - sum)} short.` : `Payments are ${money(sum - t)} too much.`;
        else if (cashSum > 0 && tc != null && tc < cashSum) error = 'Cash received is less than the cash part.';
        return { error, payments: lines.map(l => ({ method: l.method, cents: l.cents, ref: l.ref })), tenderedCents: cashSum > 0 ? (tc ?? cashSum) : undefined, method: lines.length > 1 ? 'split' : lines[0].method };
      },
    };
  }
  $('#posQrClose').onclick = () => $('#posQrDlg').close();

  // ---------- collect payment for a pay-at-counter / cash-on-delivery order ----------
  let payOrder = null;
  const payBox = payPanel($('#payPanel'), () => payOrder?.totalCents || 0, () => {});
  function openPay(o) {
    if (!me.shift) { toast('Open your shift first (Shift tab).'); location.hash = '#shift'; return; }
    payOrder = o; payBox.reset();
    $('#payCode').textContent = `#${o.code} · ${o.name}`; $('#payTotal').textContent = money(o.totalCents);
    $('#paySubmit').textContent = o.orderType === 'delivery' ? 'Paid · mark as delivered' : 'Paid · mark as picked up';
    $('#payNote').textContent = ''; $('#payDlg').showModal();
  }
  $('#payClose').onclick = () => $('#payDlg').close();
  $('#payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = payBox.value();
    if (v.error) { $('#payNote').textContent = v.error; $('#payNote').classList.add('err'); return; }
    $('#paySubmit').disabled = true;
    try {
      const x = await api('/api/staff/orders', { method: 'PATCH', body: { id: payOrder.id, status: 'done', payments: v.payments, tenderedCents: v.tenderedCents } });
      cache.set(x.id, x); $('#payDlg').close();
      toast(`#${x.code} paid${x.changeCents ? ` · change ${money(x.changeCents)}` : ''}`);
      refreshBoard(); renderDetail();
    } catch (err) { $('#payNote').textContent = err.message; $('#payNote').classList.add('err'); }
    $('#paySubmit').disabled = false;
  });

  // ===================================================================== DETAIL PANEL
  let detailId = null, armed = null;
  const drawer = $('#detail'), scrim = $('#scrim');
  function openDetail(id) { closeChat(); detailId = id; armed = null; renderDetail(); drawer.classList.add('open'); drawer.inert = false; scrim.classList.add('on'); setTimeout(() => $('#dClose').focus(), 50); }
  function closeDetail() { detailId = null; drawer.classList.remove('open'); drawer.inert = true; if (!chatId) scrim.classList.remove('on'); }
  $('#dClose').onclick = closeDetail;
  scrim.onclick = () => { closeDetail(); closeChat(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { closeDetail(); closeChat(); } });
  function renderDetail() {
    const o = cache.get(detailId); if (!o) return;
    const qr = o.paymentMethod === 'qrph', online = o.source !== 'pos' && ['gcash', 'paymaya', 'card'].includes(o.paymentMethod), b = busy.has(o.id);
    const d = o.delivery;
    $('#dTitle').innerHTML = `#${esc(o.code)} <span class="pill ${o.status}" style="vertical-align:middle">${STATUS[o.status]}</span>`;
    $('#dBody').innerHTML = `
      <dl class="dl">
        <dt>Customer</dt><dd>${esc(o.name)}</dd>
        <dt>Ordered</dt><dd>${fmtDT(o.createdAt)}</dd>
        ${o.scheduledFor ? `<dt>Order ahead</dt><dd><b>${fmtWhen(o.scheduledFor)}</b></dd>` : ''}
        <dt>${o.source === 'pos' ? 'Type' : o.orderType === 'delivery' ? 'Delivery' : 'Pickup'}</dt><dd>${o.source === 'pos' ? `POS · ${esc(o.pickupLabel)}` : esc(o.pickupLabel)}${o.source !== 'pos' ? ` (${fmtTime(o.pickupAt)})` : ''}</dd>
        ${d ? `<dt>Address</dt><dd>${esc(d.address)}${d.landmark ? `<br><small>${esc(d.landmark)}</small>` : ''}<br><a href="https://www.google.com/maps?q=${d.lat},${d.lng}" target="_blank" rel="noopener">Open in Google Maps</a></dd><dt>Phone</dt><dd class="mono">${esc(d.phone)}</dd>` : ''}
        <dt>Payment</dt><dd>${payBadge(o)}</dd>
        ${(o.payments || []).length > 1 ? `<dt>Paid with</dt><dd>${o.payments.map(p => `${PAY[p.method]} ${money(p.cents)}${p.ref ? ` <small>(${esc(p.ref)})</small>` : ''}`).join('<br>')}</dd>` : ''}
        ${o.staffName ? `<dt>Staff</dt><dd>${esc(o.staffName)}</dd>` : ''}
        ${o.paidAt ? `<dt>Paid at</dt><dd>${fmtDT(o.paidAt)}</dd>` : ''}
        ${o.discountCents ? `<dt>Discount</dt><dd>${esc(o.discountType)} · −${money(o.discountCents)}</dd>` : ''}
        ${o.tenderedCents != null ? `<dt>Cash</dt><dd>${money(o.tenderedCents)} received · ${money(o.changeCents)} change</dd>` : ''}
        ${o.reference ? `<dt>${qr ? 'Customer ref' : 'Reference'}</dt><dd class="mono">${esc(o.reference)}</dd>` : ''}
        ${o.paymentId ? `<dt>PayMongo ID</dt><dd class="mono">${esc(o.paymentId)}</dd>` : ''}
        ${o.refundId ? `<dt>Refund ID</dt><dd class="mono">${esc(o.refundId)}</dd>` : ''}
      </dl>
      <div class="d-items">${o.items.map(i => `<div><b>${i.qty} × ${esc(i.name)}</b><span>${money(i.unitCents * i.qty)}</span>${i.opts ? `<small>${esc(i.opts)}</small>` : ''}${promoTag(i)}${(i.addons || []).map(a => `<small>+ ${esc(a.name)} (${money(a.cents)} each)</small>`).join('')}</div>`).join('')}</div>
      ${o.note ? `<div class="nt" style="background:var(--surface);padding:10px 12px;border-radius:10px">“${esc(o.note)}”</div>` : ''}
      ${o.deliveryFeeCents ? `<div class="r2"><span>Delivery fee</span><span>${money(o.deliveryFeeCents)}</span></div>` : ''}
      <div class="total">Total <span>${money(o.totalCents)}</span></div>
      <div class="row-btns"><button class="btn ghost" type="button" data-chat="${esc(o.id)}">💬 Messages${o.unread ? ` (${o.unread})` : ''}</button>${o.paymentStatus === 'paid' ? `<button class="btn ghost" type="button" id="dReceipt">Receipt</button>` : ''}</div>`;
    const rb = $('#dReceipt'); if (rb) rb.onclick = () => showReceipt(o);
    const acts = [], nx = NEXT(o);
    const onBoard = qr ? o.paymentStatus === 'paid' : !online || ['paid', 'refunded'].includes(o.paymentStatus);
    if (qr && o.paymentStatus === 'submitted' && o.status !== 'cancelled') {
      acts.push(`<button class="btn" type="button" data-act="pay:verify" ${b ? 'disabled' : ''}>Payment received</button>`);
      acts.push(`<button class="btn danger" type="button" data-act="pay:reject" ${b ? 'disabled' : ''}>Not received</button>`);
    }
    if (nx && onBoard) acts.push(`<button class="btn" type="button" data-act="st:${nx[0]}" ${b ? 'disabled' : ''}>${needsPay(o, nx[0]) ? `${nx[1]} · collect payment` : nx[1]}</button>`);
    if (online && ['pending', 'expired', 'failed'].includes(o.paymentStatus)) acts.push(`<button class="btn ghost" type="button" data-act="pay:check" ${b ? 'disabled' : ''}>Check payment with PayMongo</button>`);
    if (['new', 'making', 'ready', 'delivering'].includes(o.status) && (o.paymentStatus !== 'paid' || can('void'))) {
      const refundable = online && o.paymentStatus === 'paid';
      const back = o.paymentStatus === 'paid' && !refundable;
      const label = armed === o.id ? (refundable ? `Confirm: cancel & refund ${money(o.totalCents)}` : back ? `Confirm: cancel, return ${money(o.totalCents)}` : 'Confirm cancel')
        : (refundable ? 'Cancel & refund' : o.source === 'pos' ? 'Void sale' : back ? 'Cancel (return money)' : 'Cancel order');
      acts.push(`<button class="btn danger ${armed === o.id ? 'armed' : ''}" type="button" data-act="cancel" ${b ? 'disabled' : ''}>${label}</button>`);
    }
    $('#dFoot').innerHTML = acts.length ? `<div class="row">${acts.join('')}</div>` : '<p class="note">No actions for this order.</p>';
  }
  $('#dFoot').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !detailId) return;
    const [kind, arg] = b.dataset.act.split(':');
    if (kind === 'st') setStatus(detailId, arg);
    else if (kind === 'pay') payAction(detailId, arg);
    else if (kind === 'cancel') {
      if (armed !== detailId) { armed = detailId; renderDetail(); setTimeout(() => { if (armed === detailId) { armed = null; renderDetail(); } }, 5000); }
      else { armed = null; setStatus(detailId, 'cancelled'); }
    }
  });

  // ===================================================================== MESSAGES
  let chatId = null, chatTimer = null;
  const msgPanel = $('#msgPanel');
  const QUICK = ['Being prepared now!', 'Ready for pickup!', 'Rider is on the way!', 'Sorry for the wait, almost done.', 'Thank you!'];
  function renderThreads() {
    const unread = (board?.threads || []).reduce((a, t) => a + t.unread, 0);
    $('#msgBadge').hidden = !unread; $('#msgBadge').textContent = unread;
    if (msgPanel.classList.contains('open') && !chatId) drawThreads();
  }
  function drawThreads() {
    $('#mpTitle').textContent = 'Messages'; $('#mpForm').hidden = true;
    const th = board?.threads || [];
    $('#mpBody').innerHTML = th.length ? th.map(t => `<button type="button" class="thread ${t.unread ? 'new' : ''}" data-thread="${esc(t.id)}">
      <b>#${esc(t.code)} · ${esc(t.name)}</b>${t.unread ? `<span class="badge">${t.unread}</span>` : ''}<small>${esc(t.lastMessage || '')}</small><small>${fmtTime(t.lastAt)} · ${STATUS[t.status] || ''}${t.orderType === 'delivery' ? ' · delivery' : ''}</small></button>`).join('')
      : '<p class="hint">No customer messages in the last 12 hours.</p>';
  }
  $('#msgBtn').onclick = () => { closeDetail(); chatId = null; drawThreads(); msgPanel.classList.add('open'); msgPanel.inert = false; scrim.classList.add('on'); };
  $('#mpBody').addEventListener('click', e => { const t = e.target.closest('[data-thread]'); if (t) openChat(t.dataset.thread); });
  function closeChat() { chatId = null; clearInterval(chatTimer); msgPanel.classList.remove('open'); msgPanel.inert = true; if (!detailId) scrim.classList.remove('on'); }
  $('#mpClose').onclick = () => { if (chatId) { chatId = null; clearInterval(chatTimer); drawThreads(); } else closeChat(); };
  async function openChat(id) {
    closeDetail(); chatId = id;
    msgPanel.classList.add('open'); msgPanel.inert = false; scrim.classList.add('on');
    $('#mpForm').hidden = false;
    $('#mpQuick').innerHTML = QUICK.map(q => `<button type="button" data-q>${esc(q)}</button>`).join('');
    await loadChat();
    clearInterval(chatTimer); chatTimer = setInterval(() => { if (!document.hidden && chatId) loadChat(); }, 4000);
    setTimeout(() => $('#mpInput').focus(), 60);
  }
  async function loadChat(post) {
    try {
      const d = post ? await api('/api/staff/messages', { method: 'POST', body: { orderId: chatId, body: post } }) : await api(`/api/staff/messages?order=${encodeURIComponent(chatId)}`);
      const o = d.order; cache.set(o.id, { ...cache.get(o.id), ...o, unread: 0 });
      $('#mpTitle').innerHTML = `#${esc(o.code)} · ${esc(o.name)} <button type="button" class="linkbtn" data-open="${esc(o.id)}">order</button>`;
      const log = d.messages.map(m => `<div class="bubble-msg ${m.from === 'staff' ? 'me' : 'them'}">${esc(m.body)}<small>${m.from === 'staff' ? esc(m.staffName || 'Staff') : esc(o.name)} · ${fmtTime(m.at)}</small></div>`).join('');
      $('#mpBody').innerHTML = `<p class="hint">${STATUS[o.status]}${o.orderType === 'delivery' ? ` · delivery to ${esc(o.delivery?.address || '')}` : ''}</p><div class="chat-log big">${log || '<p class="hint">No messages yet.</p>'}</div>`;
      const l = $('.chat-log', msgPanel); if (l) l.scrollTop = l.scrollHeight;
    } catch (e) { fail(e); }
  }
  $('#mpForm').addEventListener('submit', async e => { e.preventDefault(); const v = $('#mpInput').value.trim(); if (!v) return; $('#mpInput').value = ''; await loadChat(v); refreshBoard(); });
  $('#mpQuick').addEventListener('click', async e => { const b = e.target.closest('[data-q]'); if (b) { await loadChat(b.textContent); refreshBoard(); } });

  // ===================================================================== POS
  let posCat = 'all', ticketLines = ls.get('dd-pos-ticket', []), pdItem = null, pdQty = 1, posBusy = false;
  const prodById = () => Object.fromEntries(catalog.products.map(p => [p.id, p]));
  const addonById = () => Object.fromEntries(catalog.addons.map(a => [a.id, a]));
  const posPromo = (p) => promoFor(p, catalog.promos, new Date(), catalog.tz);
  const posUnit = (l) => { const p = prodById()[l.id]; const A = addonById(); return (p?.price || 0) - (posPromo(p)?.off || 0) + (l.addons || []).reduce((a, id) => a + (A[id]?.price || 0), 0); };
  const DISC = { senior: 20, pwd: 20, staff: 10 }, DISC_LABEL = { senior: 'Senior citizen 20%', pwd: 'PWD 20%', staff: 'Staff 10%' };
  let posCode = null; // promo code checked at the POS
  // Same rules as the server (lib/promocodes.js, lib/staff/pos.js).
  const codeOff = (c, sub) => { if (!c || sub < (c.minCents || 0)) return 0; let off = Math.round((c.kind === 'pct' ? (sub * c.value) / 100 : c.value) / 100) * 100; if (c.kind === 'pct' && c.maxOffCents) off = Math.min(off, c.maxOffCents); return Math.max(0, Math.min(off, sub)); };
  const posTotals = () => {
    const sub = ticketLines.reduce((a, l) => a + posUnit(l) * l.qty, 0);
    const d = $('#posDisc').value;
    let disc = 0, label = DISC_LABEL[d] || '';
    if (DISC[d]) disc = Math.round(sub * DISC[d] / 100);
    else if (d === 'code') { disc = codeOff(posCode, sub); label = posCode ? `Promo ${posCode.code}` : 'Promo code'; }
    else if (d === 'custom') {
      const v = parseFloat($('#posCustVal').value) || 0, pctK = $('#posCustKind').value === 'pct';
      disc = pctK ? (Number.isInteger(v) && v >= 1 && v <= 100 ? Math.round((sub * v) / 100) : 0) : Math.min(Math.round(v * 100), sub);
      label = `Discount ${pctK ? v + '%' : money(Math.round(v * 100))}`;
    }
    return { sub, disc, total: sub - disc, label };
  };
  function renderPosMenu() {
    const cats = ['all', ...Object.keys(CAT)];
    $('#posCats').innerHTML = cats.map(c => `<button type="button" data-c="${c}" aria-pressed="${posCat === c}">${c === 'all' ? 'All' : CAT[c]}</button>`).join('');
    const q = $('#posSearch').value.trim().toLowerCase();
    $('#posGrid').innerHTML = catalog.products.filter(p => (posCat === 'all' || p.cat === posCat) && (!q || p.name.toLowerCase().includes(q))).map(p => {
      const off = p.soldOut || p.price == null, pr = posPromo(p);
      return `<button class="pos-item ${p.soldOut ? 'sold' : ''} ${pr ? 'promo' : ''}" type="button" data-pos="${p.id}" ${off ? 'disabled' : ''}>
        <small>${p.soldOut ? 'Sold out' : p.price == null ? 'No price yet' : pr ? `${esc(pr.promo.name)} −${pr.promo.pct}%` : CAT[p.cat]}${p.stock != null && !p.soldOut ? ` · ${p.stock} left` : ''}</small>
        <b>${esc(p.name)}</b><span>${p.price == null ? '—' : pr ? `<s>${money(p.price)}</s> ${money(p.price - pr.off)}` : money(p.price)}</span></button>`;
    }).join('');
  }
  $('#posCats').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; posCat = b.dataset.c; renderPosMenu(); });
  $('#posSearch').addEventListener('input', renderPosMenu);
  $('#posGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-pos]'); if (!b) return;
    const p = prodById()[b.dataset.pos];
    pdItem = p; pdQty = 1; $('#pdForm').reset();
    const pr = posPromo(p);
    $('#pdTitle').textContent = p.name; $('#pdCat').textContent = `${CAT[p.cat]} · ${pr ? `${pr.promo.name}: ${money(p.price - pr.off)} (was ${money(p.price)})` : money(p.price)}`;
    const drink = kindOf(p.cat) === 'drink';
    $('#pd-sweet').hidden = !drink; $('#pd-ice').hidden = !drink || p.hot;
    const groups = groupsFor(p.cat).map(g => [g, catalog.addons.filter(a => a.grp === g && a.active)]).filter(([, l]) => l.length);
    $('#pdAddons').innerHTML = groups.map(([g, l]) => `<div class="grp grp-addons"><h4>${g === 'packaging' ? 'Packaging' : 'Add-ons'}</h4><div class="seg">${l.map(a => `<input type="checkbox" name="addon" id="pa-${a.id}" value="${a.id}"><label for="pa-${a.id}">${esc(a.name)} <small>+${money(a.price)}</small></label>`).join('')}</div></div>`).join('');
    pdRefresh(); $('#posDlg').showModal();
  });
  const pdRead = () => { const f = $('#pdForm'); const drink = kindOf(pdItem.cat) === 'drink'; return { opts: drink ? { sweet: +f.sweet.value, ice: pdItem.hot ? null : f.ice.value } : null, addons: $$('input[name=addon]:checked', f).map(x => x.value) }; };
  const pdRefresh = () => { const v = pdRead(); $('#pdQty').textContent = pdQty; $('#pdAdd').textContent = 'Add ' + money(posUnit({ id: pdItem.id, addons: v.addons }) * pdQty); };
  $('#pdForm').addEventListener('change', pdRefresh);
  $('#pdMinus').onclick = () => { pdQty = Math.max(1, pdQty - 1); pdRefresh(); };
  $('#pdPlus').onclick = () => { pdQty = Math.min(50, pdQty + 1); pdRefresh(); };
  $('#pdAdd').onclick = () => {
    const v = pdRead(); const key = pdItem.id + '|' + JSON.stringify(v.opts) + '|' + [...v.addons].sort().join(',');
    const ex = ticketLines.find(l => l.key === key);
    if (ex) ex.qty = Math.min(50, ex.qty + pdQty); else ticketLines.push({ key, id: pdItem.id, qty: pdQty, opts: v.opts, addons: v.addons });
    $('#posDlg').close(); renderTicket();
  };
  const posPay = payPanel($('#posPay'), () => posTotals().total, () => updateCharge());
  function renderTicket() {
    if (!me) return;
    ls.set('dd-pos-ticket', ticketLines);
    const P = prodById(), A = addonById();
    $('#posLines').innerHTML = ticketLines.length ? ticketLines.map((l, i) => `
      <div class="line"><b>${esc(P[l.id]?.name || l.id)}</b><span class="lp">${money(posUnit(l) * l.qty)}</span>
        <small>${esc(l.opts ? [l.opts.sweet + '% sweet', l.opts.ice].filter(Boolean).join(' · ') : '') || '—'}</small>
        <div class="stepper"><button type="button" data-tq="${i}" data-d="-1" aria-label="Fewer">−</button><span>${l.qty}</span><button type="button" data-tq="${i}" data-d="1" aria-label="More">+</button></div>
        ${(l.addons || []).length ? `<span class="addons">+ ${l.addons.map(id => `${esc(A[id]?.name || id)} ${money(A[id]?.price || 0)}`).join(', ')}</span>` : ''}</div>`).join('')
      : '<div class="empty">Tap items on the left to start a sale.</div>';
    const t = posTotals(), d = $('#posDisc').value;
    $('#posDiscIdF').hidden = !(d === 'senior' || d === 'pwd');
    $('#posCodeF').hidden = d !== 'code'; $('#posCustomF').hidden = d !== 'custom';
    $('#posSum').innerHTML = `<dt>Subtotal</dt><dd>${money(t.sub)}</dd>${t.disc ? `<dt>${esc(t.label)}</dt><dd>−${money(t.disc)}</dd>` : ''}<dt style="align-self:end">Total</dt><dd class="big">${money(t.total)}</dd>`;
    posPay.redraw();
  }
  function updateCharge() {
    if (!me) return;
    const t = posTotals(), v = posPay.value(), d = $('#posDisc').value;
    const needId = (d === 'senior' || d === 'pwd') && !$('#posDiscId').value.trim();
    const discWhy = d === 'code' ? (!posCode ? 'Type the promo code and tap Check.' : t.sub < posCode.minCents ? `${posCode.code} needs a minimum order of ${money(posCode.minCents)}.` : '')
      : d === 'custom' ? (!t.disc ? 'Enter the discount amount.' : $('#posCustWhy').value.trim().length < 3 ? 'Write the reason for the discount.' : '') : '';
    const btn = $('#posCharge');
    btn.disabled = !ticketLines.length || posBusy || !me.shift || needId || !!discWhy || !!v.error;
    btn.textContent = posBusy ? 'Saving…' : ticketLines.length ? `Charge ${money(t.total)} · ${PAY[v.method]}` : 'Charge';
    $('#posNote').textContent = !me.shift ? 'Open your shift to take payments.' : needId ? 'Enter the ID number for this discount.' : ticketLines.length && discWhy ? discWhy : ticketLines.length && v.error ? v.error : '';
  }
  $('#posLines').addEventListener('click', e => { const b = e.target.closest('[data-tq]'); if (!b) return; const l = ticketLines[+b.dataset.tq]; l.qty += +b.dataset.d; if (l.qty <= 0) ticketLines.splice(+b.dataset.tq, 1); renderTicket(); });
  $('#posDisc').addEventListener('change', renderTicket);
  ['#posCustKind', '#posCustVal'].forEach(id => $(id).addEventListener('input', renderTicket));
  $('#posCustWhy').addEventListener('input', updateCharge);
  $('#posCode').addEventListener('input', () => { if (posCode) { posCode = null; renderTicket(); } });
  const checkPosCode = async () => {
    const c = $('#posCode').value.trim(); if (!c) return $('#posCode').focus();
    try { posCode = await api('/api/staff/codes?check=' + encodeURIComponent(c)); $('#posCode').value = posCode.code; toast(`${posCode.code}: ${posCode.label}`); }
    catch (err) { posCode = null; fail(err); }
    renderTicket();
  };
  $('#posCodeCheck').onclick = checkPosCode;
  $('#posCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkPosCode(); } });
  $('#posDiscId').addEventListener('input', updateCharge);
  const resetTicket = () => { ticketLines = []; posCode = null; $('#posForm').reset(); $('#posBoard').checked = true; posPay.reset(); renderTicket(); };
  $('#posClear').onclick = resetTicket;
  $('#posForm').addEventListener('submit', async e => {
    e.preventDefault(); if (posBusy || !ticketLines.length) return;
    const v = posPay.value(); if (v.error) return;
    posBusy = true; updateCharge();
    try {
      const o = await api('/api/staff/pos', { method: 'POST', body: {
        items: ticketLines.map(l => ({ id: l.id, qty: l.qty, opts: l.opts, addons: l.addons })),
        name: $('#posName').value, orderType: $('#posType').value, payments: v.payments, tenderedCents: v.tenderedCents,
        discount: $('#posDisc').value || undefined, discountId: $('#posDiscId').value, sendToBoard: $('#posBoard').checked,
        promoCode: posCode?.code, customKind: $('#posCustKind').value, customValue: $('#posCustVal').value, discountReason: $('#posCustWhy').value,
      } });
      cache.set(o.id, o); posBusy = false; resetTicket(); showReceipt(o); refreshBoard(); loadCatalog();
    } catch (err) { posBusy = false; updateCharge(); fail(err); $('#posNote').textContent = err.message; if (err.status === 409) { refreshMe(); loadCatalog(); } }
  });
  function showReceipt(o) {
    $('#receipt').innerHTML = `
      <h3 id="rcptTitle">Demetria's Diner</h3>
      <p class="c">Come for the drinks, stay for the comfort<br>${fmtDT(o.paidAt || o.createdAt)} · #${esc(o.code)}<br>${esc(o.source === 'pos' ? o.pickupLabel : o.orderType)}${o.name && o.name !== 'Walk-in' ? ' · ' + esc(o.name) : ''}${o.staffName ? '<br>Cashier: ' + esc(o.staffName) : ''}</p><hr>
      ${o.items.map(i => `<div class="r"><span>${i.qty} × ${esc(i.name)}${i.opts ? `<small>${esc(i.opts)}</small>` : ''}${promoTag(i)}${(i.addons || []).map(a => `<small>+ ${esc(a.name)} ${money(a.cents)}</small>`).join('')}</span><span>${money(i.unitCents * i.qty)}</span></div>`).join('')}<hr>
      <div class="r"><span>Subtotal</span><span>${money(o.subtotalCents)}</span></div>
      ${o.discountCents ? `<div class="r"><span>${esc(o.discountType)}</span><span>−${money(o.discountCents)}</span></div>` : ''}
      ${o.deliveryFeeCents ? `<div class="r"><span>Delivery fee</span><span>${money(o.deliveryFeeCents)}</span></div>` : ''}
      <div class="r tot"><span>TOTAL</span><span>${money(o.totalCents)}</span></div>
      ${(o.payments || []).map(p => `<div class="r"><span>${PAY[p.method] || p.method}${p.ref ? ' · ref ' + esc(p.ref) : ''}</span><span>${money(p.cents)}</span></div>`).join('')}
      ${o.tenderedCents != null ? `<div class="r"><span>Cash received</span><span>${money(o.tenderedCents)}</span></div><div class="r"><span>Change</span><span>${money(o.changeCents)}</span></div>` : ''}<hr>
      <p class="c">Thank you! See you again.<br>This is not an official receipt.</p>`;
    if (!$('#rcptDlg').open) $('#rcptDlg').showModal();
  }
  const printDialog = (dlg) => { document.body.classList.add('printing'); dlg.classList.add('print-me'); window.print(); setTimeout(() => { document.body.classList.remove('printing'); dlg.classList.remove('print-me'); }, 500); };
  $('#rcptPrint').onclick = () => printDialog($('#rcptDlg'));
  $('#rcptNew').onclick = () => $('#rcptDlg').close();

  // ===================================================================== ORDERS (history)
  let page = 1, pages = 1, histT;
  const hq = () => new URLSearchParams({ q: $('#hq').value, source: $('#hsource').value, type: $('#htype').value, status: $('#hstatus').value, payment: $('#hpay').value, from: $('#hfrom').value, to: $('#hto').value, page });
  async function loadHistory() {
    try {
      const d = await api('/api/staff/history?' + hq());
      remember(d.orders); pages = d.pages;
      $('#histCount').textContent = `${d.total} order${d.total === 1 ? '' : 's'}`;
      $('#histBody').innerHTML = d.orders.length ? d.orders.map(o => `
        <tr data-open="${esc(o.id)}" tabindex="0">
          <td class="when">${fmtDT(o.createdAt)}</td><td class="code">#${esc(o.code)}${o.orderType === 'delivery' ? ' 🛵' : ''}</td><td>${esc(o.name)}</td>
          <td class="items">${itemsText(o)}</td><td class="num">${money(o.totalCents)}</td><td>${payBadge(o)}</td>
          <td><span class="pill ${o.status}">${STATUS[o.status]}</span></td><td>${esc(o.staffName || '')}</td>
        </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:28px">No orders match these filters.</td></tr>';
      $('#pgInfo').textContent = `Page ${d.page} of ${d.pages}`;
      $('#prevPg').disabled = page <= 1; $('#nextPg').disabled = page >= pages;
    } catch (e) { fail(e); }
  }
  $('#histForm').addEventListener('input', () => { clearTimeout(histT); histT = setTimeout(() => { page = 1; loadHistory(); }, 300); });
  $('#histForm').addEventListener('submit', e => e.preventDefault());
  $('#hclear').onclick = () => { $('#histForm').reset(); page = 1; loadHistory(); };
  $('#prevPg').onclick = () => { if (page > 1) { page--; loadHistory(); } };
  $('#nextPg').onclick = () => { if (page < pages) { page++; loadHistory(); } };
  $('#histBody').addEventListener('keydown', e => { const r = e.target.closest('[data-open]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(r.dataset.open); } });

  // ===================================================================== SHIFT
  let shiftData = null;
  async function loadShift() {
    try { shiftData = await api('/api/staff/shift'); renderShift(); } catch (e) { fail(e); }
  }
  function renderShift() {
    const cur = shiftData.current;
    $('#shiftOpenBox').hidden = !!cur; $('#shiftLive').hidden = !cur;
    $('#recentTitle').textContent = can('sales') ? 'Recent shifts (everyone)' : 'My recent shifts';
    $('#shiftRows').innerHTML = shiftData.recent.map(s => `<tr><td>${esc(s.staffName)}</td><td class="when">${fmtDT(s.openedAt)}</td><td class="when">${s.closedAt ? fmtDT(s.closedAt) : '<span class="pill making">open</span>'}</td>
      <td class="num">${money(s.openingCents)}</td><td class="num">${s.expectedCents == null ? '—' : money(s.expectedCents)}</td><td class="num">${s.countedCents == null ? '—' : money(s.countedCents)}</td>
      <td class="num ${s.overShortCents < 0 ? 'bad' : s.overShortCents > 0 ? 'ok' : ''}">${s.overShortCents == null ? '—' : (s.overShortCents > 0 ? '+' : '') + money(s.overShortCents)}</td>
      <td><button class="linkbtn" type="button" data-shift="${esc(s.id)}">Report</button>${!s.closedAt && !s.mine && can('sales') ? ` <button class="linkbtn" type="button" data-force="${esc(s.id)}">Close</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="hint">No shifts yet.</td></tr>';
    if (!cur) return;
    const s = cur.sales;
    $('#shiftTiles').innerHTML = [[money(s.grossCents), 'Gross'], [money(s.discountCents), 'Discounts'], [money(s.netCents), 'Net sales'], [s.orders, 'Orders'], [money(cur.cashInCents), 'Cash in (pay in)'], [money(cur.cashOutCents), 'Cash out (pay out)'], [money(cur.expectedCashCents), 'Expected cash in drawer']]
      .map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    $('#shiftMethods').innerHTML = [['Opening cash', cur.openingCents], ['Cash sales', s.byMethod.cash], ['GCash', s.byMethod.gcash], ['Maya', s.byMethod.paymaya], ...(s.byMethod.card ? [['Card', s.byMethod.card]] : []), ['GCash/Maya QR (online)', s.byMethod.qrph], ['Delivery fees', s.deliveryCents], ['Voided / refunded', s.voids.cents]]
      .map(([k, v]) => `<dt>${k}</dt><dd>${money(v)}</dd>`).join('') + `<dt>Opened</dt><dd>${fmtDT(cur.openedAt)}</dd>`;
    $('#cCat').innerHTML = (shiftData.cashCategories[$('input[name=ckind]:checked').value] || []).map(c => `<option>${esc(c)}</option>`).join('');
    $('#moves').innerHTML = cur.moves.length ? cur.moves.slice().reverse().map(m => `<div class="move ${m.kind}"><b>${m.kind === 'in' ? '+' : '−'}${money(m.cents)}</b><span>${esc(m.category)}${m.note ? ' · ' + esc(m.note) : ''}</span><small>${fmtTime(m.at)} · ${esc(m.staffName || '')}</small></div>`).join('') : '<p class="hint">No cash in or out yet.</p>';
    $('#expCash').textContent = money(cur.expectedCashCents);
    showOverShort();
  }
  const showOverShort = () => {
    const c = toCents($('#countCash').value), exp = shiftData?.current?.expectedCashCents;
    const el = $('#overShort');
    if (c == null || exp == null) { el.textContent = ''; return; }
    const d = c - exp; el.className = 'note left ' + (d < 0 ? 'bad' : d > 0 ? 'ok' : '');
    el.textContent = d === 0 ? 'Drawer matches exactly ✓' : d < 0 ? `Short by ${money(-d)}` : `Over by ${money(d)}`;
  };
  $('#countCash').addEventListener('input', showOverShort);
  $$('input[name=ckind]').forEach(i => i.addEventListener('change', () => { $('#cCat').innerHTML = (shiftData?.cashCategories?.[i.value] || []).map(c => `<option>${esc(c)}</option>`).join(''); }));
  $('#openForm').addEventListener('submit', async e => {
    e.preventDefault(); const c = toCents($('#openCash').value); if (c == null || c < 0) return toast('Enter the opening cash.');
    try { await api('/api/staff/shift', { method: 'POST', body: { action: 'open', openingCents: c } }); $('#openForm').reset(); toast('Shift opened. Have a good one!'); await refreshMe(); loadShift(); } catch (err) { fail(err); }
  });
  $('#cashForm').addEventListener('submit', async e => {
    e.preventDefault(); const c = toCents($('#cAmt').value); if (!c || c <= 0) return toast('Enter an amount.');
    const kind = $('input[name=ckind]:checked').value;
    try { await api('/api/staff/cash', { method: 'POST', body: { kind, cents: c, category: $('#cCat').value, note: $('#cNote').value } }); $('#cAmt').value = ''; $('#cNote').value = ''; toast(kind === 'in' ? `Cash in ${money(c)} recorded` : `Cash out ${money(c)} recorded`); loadShift(); } catch (err) { fail(err); }
  });
  let closeArmed = false;
  $('#closeForm').addEventListener('submit', async e => {
    e.preventDefault(); const c = toCents($('#countCash').value); if (c == null || c < 0) return toast('Count the cash and enter the amount.');
    if (!closeArmed) { closeArmed = true; $('#closeBtn').textContent = 'Tap again to close'; $('#closeBtn').classList.add('armed'); setTimeout(() => { closeArmed = false; $('#closeBtn').textContent = 'Close shift'; $('#closeBtn').classList.remove('armed'); }, 5000); return; }
    closeArmed = false; $('#closeBtn').textContent = 'Close shift'; $('#closeBtn').classList.remove('armed');
    try { const s = await api('/api/staff/shift', { method: 'POST', body: { action: 'close', countedCents: c, note: $('#closeNote').value } }); $('#closeForm').reset(); await refreshMe(); loadShift(); showShiftReport(s); } catch (err) { fail(err); }
  });
  $('#shiftRows').addEventListener('click', async e => {
    const r = e.target.closest('[data-shift]'); if (r) { try { showShiftReport(await api(`/api/staff/shift?id=${encodeURIComponent(r.dataset.shift)}`)); } catch (err) { fail(err); } return; }
    const f = e.target.closest('[data-force]');
    if (f) {
      const counted = toCents($('#countCash').value);
      if (counted == null) { toast("Type the counted cash in 'Close shift' first, then tap Close on their row."); return; }
      try { const s = await api('/api/staff/shift', { method: 'POST', body: { action: 'close', shiftId: f.dataset.force, countedCents: counted, note: 'Closed by manager' } }); loadShift(); showShiftReport(s); } catch (err) { fail(err); }
    }
  });
  function showShiftReport(s) {
    const st = s.sales;
    const row = (k, v, cls = '') => `<div class="r ${cls}"><span>${k}</span><span>${v}</span></div>`;
    $('#shiftReport').innerHTML = `<h3>Shift report</h3>
      <p class="c">Demetria's Diner<br>${esc(s.staffName)}<br>${fmtDT(s.openedAt)} → ${s.closedAt ? fmtDT(s.closedAt) : 'still open'}${s.closedBy && s.closedBy !== s.staffName ? `<br>Closed by ${esc(s.closedBy)}` : ''}</p><hr>
      ${row('Orders', st.orders)}${row('Items sold', st.items)}${row('Gross sales', money(st.grossCents))}${row('Discounts', '−' + money(st.discountCents))}${row('Net sales', money(st.netCents), 'tot')}
      <hr>${row('Cash', money(st.byMethod.cash))}${row('GCash', money(st.byMethod.gcash))}${row('Maya', money(st.byMethod.paymaya))}${st.byMethod.card ? row('Card', money(st.byMethod.card)) : ''}${row('GCash/Maya QR', money(st.byMethod.qrph))}
      ${row('Voided / refunded', `${st.voids.n} · ${money(st.voids.cents)}`)}
      <hr>${row('Opening cash', money(s.openingCents))}${row('+ Cash sales', money(st.byMethod.cash))}${row('+ Cash in (pay in)', money(s.cashInCents))}${row('− Cash out (pay out)', money(s.cashOutCents))}${row('Expected cash', money(s.expectedCashCents), 'tot')}
      ${s.countedCents != null ? row('Counted cash', money(s.countedCents)) + row(s.overShortCents < 0 ? 'SHORT' : s.overShortCents > 0 ? 'OVER' : 'Balanced', money(Math.abs(s.overShortCents)), 'tot') : ''}
      ${s.moves?.length ? '<hr>' + s.moves.map(m => row(`${m.kind === 'in' ? 'In' : 'Out'} · ${esc(m.category)}${m.note ? ' · ' + esc(m.note) : ''}`, (m.kind === 'in' ? '+' : '−') + money(m.cents))).join('') : ''}
      ${s.note ? `<hr><p>Note: ${esc(s.note)}</p>` : ''}`;
    $('#shiftDlg').showModal();
  }
  $('#sdClose').onclick = () => $('#shiftDlg').close();
  $('#sdPrint').onclick = () => printDialog($('#shiftDlg'));

  // ===================================================================== PRODUCTS
  let ptab = 'items';
  $$('[data-ptab]').forEach(b => b.onclick = () => { ptab = b.dataset.ptab; $$('[data-ptab]').forEach(x => x.setAttribute('aria-pressed', x === b)); ['items', 'addons', 'log'].forEach(t => { $('#pt-' + t).hidden = t !== ptab; }); });
  function renderProducts() {
    const cats = catalog.categories || {};
    if (!$('#pcat').options.length) { $('#pcat').innerHTML = '<option value="">All</option>' + Object.entries(cats).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''); $('#npCat').innerHTML = Object.entries(cats).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''); }
    const q = $('#pq').value.trim().toLowerCase(), c = $('#pcat').value, low = $('#plow').checked, nocost = $('#pnocost').checked;
    const ep = can('edit_prices'), inv = can('inventory'), sc = !!catalog.seesCost;
    $('#prodRows').innerHTML = catalog.products.filter(p => (!c || p.cat === c) && (!q || p.name.toLowerCase().includes(q)) && (!low || p.soldOut || (p.stock != null && p.stock <= p.lowStock)) && (!nocost || p.cost == null)).map(p => `
      <tr data-pid="${esc(p.id)}" class="${p.soldOut ? 'is-out' : p.stock != null && p.stock <= p.lowStock ? 'is-low' : ''}">
        <td class="ph-cell">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" width="56" height="42">` : '<span class="ph-none" aria-hidden="true">📷</span>'}${ep ? `<label class="linkbtn ph-up">${p.img ? 'Change' : 'Add photo'}<input type="file" accept="image/*" data-photo hidden></label>${p.img ? '<button type="button" class="linkbtn bad" data-photo-rm>Remove</button>' : ''}` : ''}</td>
        <td>${ep ? `<input class="cell" data-f="name" value="${esc(p.name)}" maxlength="60" aria-label="Name">` : esc(p.name)}</td>
        <td>${ep ? `<select class="cell" data-f="cat" aria-label="Category">${Object.entries(cats).map(([k, v]) => `<option value="${k}" ${k === p.cat ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : esc(cats[p.cat] || p.cat)}</td>
        <td class="num">${ep ? `<input class="cell num" data-f="price" type="number" min="0" step="0.01" value="${p.price == null ? '' : p.price / 100}" placeholder="—" aria-label="Price">` : p.price == null ? '—' : money(p.price)}</td>
        ${sc ? `<td class="num">${ep ? `<input class="cell num" data-f="cost" type="number" min="0" step="0.01" value="${p.cost == null ? '' : p.cost / 100}" placeholder="set cost" aria-label="Cost">` : p.cost == null ? '—' : money(p.cost)}</td>
        <td class="num">${p.margin ? `<b class="${p.margin.pct < 50 ? 'warn-t' : 'ok'}">${money(p.margin.profit)}</b> <small class="hint">${p.margin.pct}%</small>` : `<small class="hint">${p.price == null ? 'no price' : 'no cost'}</small>`}</td>` : ''}
        <td>${inv ? `<label class="switchrow sm"><input type="checkbox" class="toggle" data-f="available" ${p.available ? 'checked' : ''}> ${p.available ? 'On' : 'Sold out'}</label>` : p.available ? 'On' : 'Sold out'}</td>
        <td>${p.stock == null ? `<span class="hint">Not tracked</span>${inv ? ' <button type="button" class="linkbtn" data-stock="track">Track</button>' : ''}`
          : `<b class="${p.stock <= 0 ? 'bad' : p.stock <= p.lowStock ? 'warn-t' : ''}">${p.stock}</b>${inv ? ` <span class="stock-btns"><button type="button" data-stock="add">+ Add</button><button type="button" data-stock="remove">− Remove</button><button type="button" data-stock="set">Count</button><button type="button" class="linkbtn" data-stock="untrack">Stop tracking</button></span>` : ''}`}</td>
        <td class="num">${inv && p.stock != null ? `<input class="cell num sm" data-f="lowStock" type="number" min="0" value="${p.lowStock}" aria-label="Low stock alert">` : p.stock != null ? p.lowStock : ''}</td>
        <td>${ep ? '<button type="button" class="linkbtn bad" data-del-p>Delete</button>' : ''}</td>
      </tr>`).join('') || '<tr><td colspan="10" class="hint">No products match.</td></tr>';
    $('#addonRows').innerHTML = catalog.addons.map(a => `<tr data-aid="${esc(a.id)}">
      <td>${ep ? `<input class="cell" data-af="name" value="${esc(a.name)}" maxlength="40">` : esc(a.name)}</td>
      <td>${ep ? `<select class="cell" data-af="grp">${[['drink', 'Drinks'], ['food', 'Food'], ['packaging', 'Everything']].map(([k, v]) => `<option value="${k}" ${k === a.grp ? 'selected' : ''}>${v}</option>`).join('')}</select>` : a.grp}</td>
      <td class="num">${ep ? `<input class="cell num" data-af="price" type="number" min="0" step="0.01" value="${a.price / 100}">` : money(a.price)}</td>
      ${sc ? `<td class="num">${ep ? `<input class="cell num" data-af="cost" type="number" min="0" step="0.01" value="${a.cost == null ? '' : a.cost / 100}" placeholder="—">` : a.cost == null ? '—' : money(a.cost)}</td>` : ''}
      <td>${ep ? `<label class="switchrow sm"><input type="checkbox" class="toggle" data-af="active" ${a.active ? 'checked' : ''}> ${a.active ? 'On' : 'Off'}</label>` : a.active ? 'On' : 'Off'}</td>
      <td>${ep ? '<button type="button" class="linkbtn bad" data-del-a>Delete</button>' : ''}</td></tr>`).join('');
    $('#logRows').innerHTML = (catalog.stockLog || []).map(l => `<tr><td class="when">${fmtDT(l.at)}</td><td>${esc(l.product || '')}</td><td class="num ${l.delta < 0 ? 'bad' : 'ok'}">${l.delta > 0 ? '+' : ''}${l.delta}</td><td class="num">${l.after ?? '—'}</td><td>${esc(l.reason)}</td><td>${esc(l.staffName || 'Online order')}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">No stock changes yet.</td></tr>';
  }
  ['#pq', '#pcat', '#plow', '#pnocost'].forEach(s => $(s).addEventListener('input', renderProducts));
  // Product photos: resized in the browser (800×600, cropped to fit) so uploads are small and fast.
  async function photoData(file) {
    const bmp = await createImageBitmap(file);
    const W = 800, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
    const s = Math.max(W / bmp.width, H / bmp.height), w = bmp.width * s, h = bmp.height * s;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
    let url = c.toDataURL('image/webp', 0.8);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.82);
    for (let q = 0.7; url.length > 650000 && q > 0.3; q -= 0.15) url = c.toDataURL('image/jpeg', q);
    return url;
  }
  $('#prodRows').addEventListener('change', async e => {
    if (e.target.matches('[data-photo]')) {
      const tr = e.target.closest('[data-pid]'), f = e.target.files[0]; if (!tr || !f) return;
      toast('Uploading photo…');
      try { await api('/api/staff/products', { method: 'PUT', body: { id: tr.dataset.pid, photo: await photoData(f) } }); toast('Photo saved. Customers see it right away.'); loadCatalog(); }
      catch (err) { fail(err.status ? err : Object.assign(err, { message: "Couldn't read that photo. Try a JPG or PNG." })); }
      return;
    }
    const tr = e.target.closest('[data-pid]'), f = e.target.dataset.f; if (!tr || !f) return;
    const val = f === 'available' ? e.target.checked : e.target.value;
    try { await api('/api/staff/products', { method: 'PUT', body: { id: tr.dataset.pid, [f]: (f === 'price' || f === 'cost') && val === '' ? null : val } }); toast('Saved'); await loadCatalog(); } catch (err) { fail(err); loadCatalog(); }
  });
  let stockReq = null;
  $('#prodRows').addEventListener('click', async e => {
    const tr = e.target.closest('[data-pid]'); if (!tr) return;
    if (e.target.closest('[data-photo-rm]')) {
      if (!confirm('Remove this photo? The drawing is shown instead.')) return;
      try { await api('/api/staff/products', { method: 'PUT', body: { id: tr.dataset.pid, photo: '' } }); toast('Photo removed'); loadCatalog(); } catch (err) { fail(err); }
      return;
    }
    const s = e.target.closest('[data-stock]');
    if (s) {
      const mode = s.dataset.stock === 'track' ? 'set' : s.dataset.stock;
      if (mode === 'untrack') { try { await api('/api/staff/stock', { method: 'POST', body: { id: tr.dataset.pid, mode } }); toast('Stock no longer tracked'); loadCatalog(); } catch (err) { fail(err); } return; }
      stockReq = { id: tr.dataset.pid, mode };
      const p = catalog.products.find(x => x.id === tr.dataset.pid);
      const td = s.closest('td');
      td.innerHTML = `<form class="stock-form"><input type="number" min="0" step="1" required placeholder="${mode === 'set' ? 'count' : 'qty'}" aria-label="Quantity" autofocus><input maxlength="80" placeholder="${mode === 'add' ? 'e.g. delivery from supplier' : mode === 'remove' ? 'e.g. spoiled' : 'reason (optional)'}" aria-label="Reason"><button class="add" type="submit">${mode === 'add' ? 'Add' : mode === 'remove' ? 'Remove' : 'Set'}</button><button class="linkbtn" type="button" data-cancel>Cancel</button></form><small class="hint">${esc(p.name)} now: ${p.stock ?? 'not tracked'}</small>`;
      $('input', td).focus(); return;
    }
    if (e.target.closest('[data-cancel]')) { renderProducts(); return; }
    if (e.target.closest('[data-del-p]')) {
      const b = e.target.closest('[data-del-p]');
      if (b.dataset.armed) { try { await api('/api/staff/products', { method: 'DELETE', body: { id: tr.dataset.pid } }); toast('Product deleted'); loadCatalog(); } catch (err) { fail(err); } }
      else { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 4000); }
    }
  });
  $('#prodRows').addEventListener('submit', async e => {
    e.preventDefault(); const [qty, reason] = $$('input', e.target).map(i => i.value);
    try { const p = await api('/api/staff/stock', { method: 'POST', body: { ...stockReq, qty: +qty, reason } }); toast(`${p.name}: ${p.stock} in stock`); loadCatalog(); } catch (err) { fail(err); }
  });
  $('#addProdForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { const p = await api('/api/staff/products', { method: 'POST', body: { name: $('#npName').value, cat: $('#npCat').value, price: $('#npPrice').value === '' ? null : $('#npPrice').value, ...(catalog.seesCost ? { cost: $('#npCost').value === '' ? null : $('#npCost').value } : {}) } }); e.target.reset(); toast(`${p.name} added`); loadCatalog(); } catch (err) { fail(err); }
  });
  $('#addonRows').addEventListener('change', async e => {
    const tr = e.target.closest('[data-aid]'), f = e.target.dataset.af; if (!tr || !f) return;
    try { await api('/api/staff/addons', { method: 'PUT', body: { id: tr.dataset.aid, [f]: f === 'active' ? e.target.checked : f === 'cost' && e.target.value === '' ? null : e.target.value } }); toast('Saved'); loadCatalog(); } catch (err) { fail(err); loadCatalog(); }
  });
  $('#addonRows').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-a]'); if (!b) return;
    const id = b.closest('[data-aid]').dataset.aid;
    if (b.dataset.armed) { try { await api('/api/staff/addons', { method: 'DELETE', body: { id } }); toast('Add-on deleted'); loadCatalog(); } catch (err) { fail(err); } }
    else { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 4000); }
  });
  $('#addAddonForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { const a = await api('/api/staff/addons', { method: 'POST', body: { name: $('#naName').value, grp: $('#naGrp').value, price: $('#naPrice').value } }); e.target.reset(); toast(`${a.name} added`); loadCatalog(); } catch (err) { fail(err); }
  });

  // ===================================================================== DASHBOARD (sales performance)
  let dash = null, gran = 'daily';
  const fmtKey = (k, g, long) => {
    if (g === 'monthly') return new Date(k + '-01T00:00:00').toLocaleDateString([], { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' });
    const d = new Date(k + 'T00:00:00');
    if (g === 'weekly') return (long ? 'Week of ' : '') + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
  };
  async function loadDashboard() { try { dash = await api('/api/staff/dashboard'); renderDashboard(); seeAchievements(dash.achievements, true); } catch (e) { fail(e); } }
  function renderDashboard() {
    const d = dash, P = d.periods, hp = !!d.hideProfit;
    $('#dashNote').textContent = `Updated ${fmtTime(Date.now())}${hp ? '' : ' · profit = net sales − cost of goods − expenses'}`;
    $('#achList').innerHTML = d.achievements.map(a => `<div class="ach ${a.kind}"><span class="ach-ico">${a.kind === 'record' ? '🏆' : a.kind === 'growth' ? '📈' : '🎉'}</span><div><b>${esc(a.title)}</b><p>${esc(a.text)}</p></div></div>`).join('');
    const card = (title, cur, prev, prevLabel) => {
      const ch = prev && prev.netSalesCents > 0 ? Math.round(((cur.netSalesCents - prev.netSalesCents) / prev.netSalesCents) * 1000) / 10 : null;
      return `<div class="pcard"><span class="pc-t">${title}</span><b class="pc-v">${money(cur.netSalesCents)}</b>
        <span class="pc-ch ${ch == null ? '' : ch >= 0 ? 'up' : 'down'}">${ch == null ? 'no comparison yet' : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}% vs ${prevLabel}`}</span>
        <dl><dt>Orders</dt><dd>${cur.orders}</dd>${hp ? '' : `<dt>Gross profit</dt><dd>${money(cur.grossProfitCents)}</dd><dt>Net profit</dt><dd class="${cur.netProfitCents < 0 ? 'bad' : ''}">${money(cur.netProfitCents)}</dd>`}</dl></div>`;
    };
    $('#periodCards').innerHTML = card('Today', P.today, P.yesterday, 'yesterday') + card('This week', P.week, P.lastWeekSamePoint, 'same point last week') + card('This month', P.month, P.lastMonthSamePoint, 'same point last month') + card('Last month', P.lastMonth, null, '');
    const R = d.records;
    const rec = (title, r, g) => {
      const best = r.best, cur = r.current.cents, share = best && best.cents ? Math.min(100, Math.round((cur / best.cents) * 100)) : 100;
      const beat = best && cur > best.cents;
      return `<div class="rcard ${beat ? 'beat' : ''}"><span class="pc-t">${title}</span><b>${best ? money(Math.max(best.cents, cur)) : money(cur)}</b>
        <small>${beat ? 'New record this ' + (g === 'daily' ? 'day' : g === 'weekly' ? 'week' : 'month') + '!' : best ? `${fmtKey(best.key, g, true)}` : 'First records'}</small>
        <div class="hbar-track"><div class="hbar-fill" style="width:${share}%"></div></div><small>${beat ? `Previous best ${money(best.cents)}` : `Now: ${money(cur)} · ${share}% of the record`}</small></div>`;
    };
    $('#records').innerHTML = rec('Best day', R.day, 'daily') + rec('Best week', R.week, 'weekly') + rec('Best month', R.month, 'monthly');
    $('#topHead').innerHTML = `<tr><th>#</th><th>Product</th><th class="num">Sold</th><th class="num">Revenue</th>${hp ? '' : '<th class="num">Profit</th><th class="num">Margin</th>'}</tr>`;
    $('#topRows').innerHTML = d.topProducts.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td class="num">${money(p.revenueCents)}</td>${hp ? '' : `<td class="num">${p.profitCents == null ? '<small class="hint">cost missing</small>' : money(p.profitCents)}</td><td class="num">${p.marginPct == null ? '—' : p.marginPct + '%'}</td>`}</tr>`).join('') || '<tr><td colspan="6" class="hint">No sales this month yet.</td></tr>';
    drawChart();
  }
  $$('[data-gran]').forEach(b => b.onclick = () => { gran = b.dataset.gran; $$('[data-gran]').forEach(x => x.setAttribute('aria-pressed', x === b)); drawChart(); });
  function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function drawChart() {
    if (!dash) return;
    const s = dash.series[gran], el = $('#chart');
    $('#chartTitle').textContent = { daily: 'Net sales per day · last 30 days', weekly: 'Net sales per week · last 12 weeks', monthly: 'Net sales per month · last 12 months' }[gran];
    const W = Math.max(280, el.clientWidth), H = el.clientHeight || 260, pad = { l: 64, r: 8, t: 18, b: 28 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxV = Math.max(...s.map(x => x.salesCents), 0), max = niceMax(maxV), recIdx = maxV > 0 ? s.findIndex(x => x.salesCents === maxV) : -1;
    const step = iw / s.length, bw = Math.max(2, Math.min(40, step - 2)), y = v => pad.t + ih - (v / max) * ih;
    const ticks = [0, .25, .5, .75, 1].map(f => f * max), every = Math.ceil(s.length / Math.max(1, Math.floor(iw / 58)));
    let g = `<g class="grid">${ticks.map(v => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g><g class="axis">${ticks.map(v => `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${money(v).replace('.00', '')}</text>`).join('')}`;
    g += s.map((d, i) => i % every && i !== s.length - 1 ? '' : `<text x="${pad.l + step * i + step / 2}" y="${H - 8}" text-anchor="middle">${fmtKey(d.key, gran)}</text>`).join('') + '</g>';
    g += s.map((d, i) => {
      const x = pad.l + step * i + (step - bw) / 2, top = y(d.salesCents), hh = pad.t + ih - top, r = Math.min(4, bw / 2, hh);
      const cls = i === recIdx ? 'bar rec' : i === s.length - 1 ? 'bar cur' : 'bar';
      const bar = hh <= 0 ? '' : `<path class="${cls}" d="M${x} ${pad.t + ih} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + bw - r} Q${x + bw} ${top} ${x + bw} ${top + r} V${pad.t + ih} Z"/>`;
      const star = i === recIdx ? `<text class="rec-star" x="${x + bw / 2}" y="${top - 4}" text-anchor="middle">★</text>` : '';
      return `<rect class="hit" x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${ih}" data-i="${i}"/>${bar}${star}`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc($('#chartTitle').textContent)}">${g}</svg>`;
    $('#seriesTable').innerHTML = `<thead><tr><th>${gran === 'daily' ? 'Day' : gran === 'weekly' ? 'Week' : 'Month'}</th><th class="num">Orders</th><th class="num">Net sales</th>${dash.hideProfit ? '' : '<th class="num">Gross profit</th><th class="num">Net profit</th>'}</tr></thead><tbody>` +
      s.map(d => `<tr><td>${fmtKey(d.key, gran, true)}</td><td class="num">${d.orders}</td><td class="num">${money(d.salesCents)}</td>${dash.hideProfit ? '' : `<td class="num">${money(d.grossProfitCents)}</td><td class="num">${money(d.netProfitCents)}</td>`}</tr>`).join('') + '</tbody>';
  }
  const tip = $('#tip');
  $('#chart').addEventListener('pointermove', e => {
    const hh = e.target.closest('.hit'); if (!hh || !dash) { tip.hidden = true; return; }
    const s = dash.series[gran], i = +hh.dataset.i, d = s[i], prev = s[i - 1];
    const ch = prev && prev.salesCents > 0 ? Math.round(((d.salesCents - prev.salesCents) / prev.salesCents) * 100) : null;
    tip.innerHTML = `${fmtKey(d.key, gran, true)}<br><b>${money(d.salesCents)}</b> · ${d.orders} order${d.orders === 1 ? '' : 's'}${dash.hideProfit ? '' : `<br>Gross profit ${money(d.grossProfitCents)}`}${ch == null ? '' : `<br>${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}% vs previous`}`;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.hidden = false;
  });
  $('#chart').addEventListener('pointerleave', () => { tip.hidden = true; });
  let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (dash && !$('#view-sales').hidden) drawChart(); }, 150); });

  // Achievements: shown on the Dashboard; new ones pop up anywhere for staff who can see sales.
  const seenAch = () => ls.get('dd-ach-' + (me?.user.id || ''), []);
  function seeAchievements(list, onDashboard) {
    const seen = new Set(seenAch()), fresh = list.filter(a => !seen.has(a.id));
    $('#achBadge').hidden = !fresh.length || onDashboard;
    if (fresh.length && !onDashboard) { toast(`🏆 ${fresh[0].title}`); chime(true); }
    if (onDashboard) ls.set('dd-ach-' + me.user.id, [...seen, ...list.map(a => a.id)].slice(-200));
  }
  async function checkMilestones() {
    if (!can('sales') || document.hidden) return;
    try { const d = await api('/api/staff/dashboard?lite=1'); seeAchievements(d.achievements, !$('#view-sales').hidden); } catch {}
  }
  setInterval(checkMilestones, 60000);

  // ---------- breakdown for a date range ----------
  let range = '7d', report = null;
  $$('[data-range]').forEach(b => b.onclick = () => { range = b.dataset.range; $$('[data-range]').forEach(x => x.setAttribute('aria-pressed', x === b)); loadReport(); });
  async function loadReport() { try { report = await api('/api/staff/report?range=' + range); renderReport(); } catch (e) { fail(e); } }
  function renderReport() {
    const t = report.totals;
    $('#kpis').innerHTML = [[money(t.grossCents), 'Gross'], [money(t.discountCents), 'Discounts'], [money(t.salesCents), 'Net sales'], [t.orders, 'Orders'], [money(t.avgCents), 'Average order'], [t.items, 'Items sold'],
      [money(report.cashIn), 'Cash in'], [money(report.cashOut), 'Cash out'], [report.voids.n ? `${report.voids.n} · ${money(report.voids.cents)}` : '0', 'Voids / refunds']]
      .map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    const hbars = (rows, label, value, sub) => {
      if (!rows.length) return '<p class="hint">Nothing in this period yet.</p>';
      const max = Math.max(...rows.map(value)) || 1;
      return rows.map(r => `<div class="hbar"><div class="hbar-top"><b>${esc(label(r))}</b><span>${sub(r)}</span></div><div class="hbar-track"><div class="hbar-fill" style="width:${(value(r) / max) * 100}%"></div></div></div>`).join('');
    };
    $('#byMethod').innerHTML = hbars(report.byMethod, r => PAY[r.method] || r.method, r => r.salesCents, r => money(r.salesCents));
    $('#bySource').innerHTML = hbars(report.bySource.filter(r => r.orders), r => r.source === 'pos' ? 'POS (in store)' : 'Online orders', r => r.salesCents, r => `${money(r.salesCents)} · ${r.orders} order${r.orders === 1 ? '' : 's'}`);
    $('#byStaff').innerHTML = hbars(report.byStaff, r => r.name, r => r.salesCents, r => `${money(r.salesCents)} · ${r.orders}`);
    $('#topAddons').innerHTML = hbars(report.topAddons, r => r.name.replace(/^\+ /, ''), r => r.qty, r => `${r.qty} · ${money(r.salesCents)}`);
    $('#topItems').innerHTML = hbars(report.topItems, r => r.name, r => r.qty, r => `${r.qty} sold · ${money(r.salesCents)}`);
  }
  const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const exportLinks = () => $$('[data-ex]').forEach(a => { a.href = `/api/staff/export?month=${$('#exMonth').value}&type=${a.dataset.ex}`; });
  $('#exMonth').value = thisMonth(); exportLinks();
  $('#exMonth').addEventListener('change', exportLinks);

  // ===================================================================== FINANCE (costing & liquidation)
  let fin = null;
  $('#finMonth').value = thisMonth();
  const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  $('#finPrev').onclick = () => { $('#finMonth').value = shiftMonth($('#finMonth').value, -1); loadFinance(); };
  $('#finNext').onclick = () => { $('#finMonth').value = shiftMonth($('#finMonth').value, 1); loadFinance(); };
  $('#finMonth').addEventListener('change', loadFinance);
  async function loadFinance() {
    const m = $('#finMonth').value || thisMonth();
    $$('[data-fx]').forEach(a => { a.href = `/api/staff/export?month=${m}&type=${a.dataset.fx}`; });
    try { fin = await api('/api/staff/liquidation?month=' + m); renderFinance(); } catch (e) { fail(e); }
  }
  function statementHtml(L, print) {
    const S = L.summary, line = (k, v, cls = '') => `<div class="st-row ${cls}"><span>${k}</span><span>${v}</span></div>`;
    const ops = L.breakdown.filter(c => c.group === 'operating'), pur = L.breakdown.filter(c => c.group === 'purchase');
    const monthName = new Date(L.month + '-01T00:00:00').toLocaleDateString([], { month: 'long', year: 'numeric' });
    return `<h3>${print ? "Demetria's Diner · " : ''}Liquidation · ${monthName}</h3>
      <h4>Sales</h4>${line('Gross sales (items + delivery fees)', money(S.grossSalesCents))}${line('Less discounts', '−' + money(S.discountCents))}${line('Net sales', money(S.netSalesCents), 'tot')}${line('Orders', S.orders, 'mut')}
      <h4>Cost of goods sold</h4>${line('From product costs', money(L.cogs.autoCents))}${line('Adjustments (spoilage, waste)', money(L.cogs.adjustmentCents))}${line('Total cost of goods', '−' + money(S.cogsCents), 'tot')}
      ${line('Gross profit', money(S.grossProfitCents), 'big')}${line('Gross margin', S.grossMarginPct == null ? '—' : S.grossMarginPct + '%', 'mut')}
      <h4>Operating expenses</h4>${ops.map(c => line(c.label + (c.drawerCents ? ` <small>(incl. ${money(c.drawerCents)} from drawer)</small>` : ''), money(c.totalCents), c.totalCents ? '' : 'mut')).join('')}${line('Total operating expenses', '−' + money(S.operatingCents), 'tot')}
      ${line('Net profit', money(S.netProfitCents), 'big ' + (S.netProfitCents < 0 ? 'neg' : 'pos'))}
      <h4>Purchases <small>(money spent on stock, already counted through cost of goods)</small></h4>${pur.map(c => line(c.label + (c.drawerCents ? ` <small>(incl. ${money(c.drawerCents)} from drawer)</small>` : ''), money(c.totalCents), c.totalCents ? '' : 'mut')).join('')}${line('Total purchases', money(S.purchasesCents), 'tot')}
      <h4>Cash view</h4>${line('Net sales − all money spent (purchases + operating)', money(S.cashProfitCents), 'tot ' + (S.cashProfitCents < 0 ? 'neg' : ''))}
      ${line(`vs ${new Date(L.previous.month + '-01T00:00:00').toLocaleDateString([], { month: 'long' })}`, `Net sales ${pct(L.changes.netSales)} · Net profit ${pct(L.changes.netProfit)}`, 'mut')}`;
  }
  function renderFinance() {
    const L = fin, S = L.summary;
    $('#finCoverage').innerHTML = S.costCoveragePct < 100 ? `⚠ Only <b>${S.costCoveragePct}%</b> of item sales this month have a cost set, so cost of goods and profit are <b>lower than real</b>. Set the missing costs in <a href="#products">Products</a> (use “Missing cost only”).` : 'All sold items this month have a cost set ✓';
    const c = (t, v, sub, cls = '') => `<div class="pcard ${cls}"><span class="pc-t">${t}</span><b class="pc-v">${v}</b><span class="pc-ch">${sub}</span></div>`;
    $('#finCards').innerHTML = c('Net sales', money(S.netSalesCents), `${pct(L.changes.netSales)} vs last month`) + c('Cost of goods', money(S.cogsCents), S.netSalesCents ? `${Math.round((S.cogsCents / S.netSalesCents) * 100)}% of sales` : '—')
      + c('Gross profit', money(S.grossProfitCents), S.grossMarginPct == null ? '—' : `${S.grossMarginPct}% margin`) + c('Expenses', money(S.operatingCents), `+ ${money(S.purchasesCents)} purchases`)
      + c('Net profit', money(S.netProfitCents), `${pct(L.changes.netProfit)} vs last month`, S.netProfitCents < 0 ? 'neg' : 'pos');
    $('#finStatement').innerHTML = statementHtml(L);
    if (!$('#exCat').options.length) $('#exCat').innerHTML = Object.entries(L.categories).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
    if (!$('#exDate').value) $('#exDate').value = cafeDate(new Date(), 4); // business date (4 AM → 4 AM)
    $('#expCount').textContent = `${L.expenses.length} entr${L.expenses.length === 1 ? 'y' : 'ies'} · ${money(L.expenses.reduce((a, e) => a + e.cents, 0))}`;
    $('#expRows').innerHTML = L.expenses.map(e => `<tr><td class="when">${e.date}</td><td>${esc(e.label)}</td><td>${esc(e.description)}${e.reference ? ` <small class="hint">#${esc(e.reference)}</small>` : ''}</td><td class="num">${money(e.cents)}</td>
      <td>${e.source === 'drawer' ? '<span class="pill making">Shift cash out</span>' : 'Recorded'}</td><td>${esc(e.staffName || '')}</td>
      <td>${e.source === 'recorded' ? `<button type="button" class="linkbtn bad" data-del-exp="${esc(e.id)}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">No expenses recorded this month.</td></tr>';
    $('#profRows').innerHTML = L.products.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td class="num">${money(p.revenueCents)}</td><td class="num">${p.cogsCents == null ? '<small class="hint">cost missing</small>' : money(p.cogsCents)}</td>
      <td class="num">${p.profitCents == null ? '—' : money(p.profitCents)}</td><td class="num ${p.marginPct != null && p.marginPct < 50 ? 'warn-t' : ''}">${p.marginPct == null ? '—' : p.marginPct + '%'}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">No sales this month.</td></tr>';
  }
  $('#expForm').addEventListener('submit', async e => {
    e.preventDefault(); const c = toCents($('#exAmt').value); if (!c || c <= 0) return toast('Enter the amount.');
    try {
      await api('/api/staff/expenses', { method: 'POST', body: { date: $('#exDate').value, category: $('#exCat').value, description: $('#exDesc').value, reference: $('#exRef').value, cents: c } });
      toast(`Expense ${money(c)} recorded`); $('#exAmt').value = ''; $('#exDesc').value = ''; $('#exRef').value = '';
      const m = $('#exDate').value.slice(0, 7); if (m !== $('#finMonth').value) $('#finMonth').value = m; loadFinance();
    } catch (err) { fail(err); }
  });
  $('#expRows').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-exp]'); if (!b) return;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 4000); return; }
    try { await api('/api/staff/expenses', { method: 'DELETE', body: { id: b.dataset.delExp } }); toast('Expense deleted'); loadFinance(); } catch (err) { fail(err); }
  });
  $('#finPrint').onclick = () => { if (!fin) return; $('#finReport').innerHTML = statementHtml(fin, true); $('#finDlg').showModal(); };
  $('#finDlgClose').onclick = () => $('#finDlg').close();
  $('#finDlgPrint').onclick = () => printDialog($('#finDlg'));

  // ===================================================================== SETTINGS
  let qrDraft = null, setMapObj = null, storeMk = null, storePin = null, tiersDraft = null;
  function renderSettings() {
    if (!settings || $('#view-settings').hidden) return;
    $('#acceptToggle').checked = settings.accepting;
    $('#payOnlineToggle').checked = settings.payOnline;
    $('#payCounterToggle').checked = settings.payCounter;
    const q = settings.qr || {};
    $('#qrToggle').checked = !!q.enabled;
    if (!qrDraft) { $('#qrNameIn').value = q.name || ''; $('#qrNumIn').value = q.number || ''; }
    const img = qrDraft || q.image;
    $('#qrPreview').hidden = !img; $('#qrEmpty').hidden = !!img; if (img) $('#qrPreview').src = img;
    const i = settings.integration || {};
    $('#pmStatus').innerHTML = `<dt>API key</dt><dd class="${i.paymongo ? 'ok' : ''}">${i.paymongo ? `Connected · ${i.mode === 'live' ? 'LIVE' : 'Test mode'}` : 'Not used'}</dd><dt>Webhook</dt><dd>${i.webhook ? 'Configured' : 'Not set'}</dd>`;
    $('#whUrl').textContent = location.origin + '/api/payments/webhook';
    const d = settings.delivery;
    $('#delToggle').checked = !!d.enabled;
    $('#delMax').value = d.maxKm; $('#delMin').value = (d.minOrder || 0) / 100; $('#delEta').value = d.eta || '';
    if (!tiersDraft) tiersDraft = d.tiers.map(t => ({ upToKm: t.upToKm, fee: t.fee / 100 }));
    drawTiers();
    storePin = storePin || (Number.isFinite(d.lat) ? { lat: d.lat, lng: d.lng } : null);
    $('#storePinInfo').textContent = storePin ? `Store pin: ${storePin.lat.toFixed(5)}, ${storePin.lng.toFixed(5)}` : 'No store location yet: tap the map, type the coordinates, or use this device’s location.';
    if (document.activeElement !== $('#storeLat') && document.activeElement !== $('#storeLng')) { $('#storeLat').value = storePin ? storePin.lat.toFixed(6) : ''; $('#storeLng').value = storePin ? storePin.lng.toFixed(6) : ''; }
    const ready = !!storePin;
    $('#delToggle').disabled = !ready && !$('#delToggle').checked;
    renderHours(); renderPromos(); renderSummaryBox();
    initSetMap();
  }
  function drawTiers() {
    $('#tiers').innerHTML = tiersDraft.map((t, i) => `<div class="tier"><span>Up to</span><input type="number" min="0.1" step="0.1" value="${t.upToKm}" data-tk="${i}" aria-label="Kilometers"><span>km →</span><span>₱</span><input type="number" min="0" step="1" value="${t.fee}" data-tf="${i}" aria-label="Fee"><button type="button" class="x sm" data-tx="${i}" aria-label="Remove tier">×</button></div>`).join('');
  }
  $('#tiers').addEventListener('input', e => { const k = e.target.dataset.tk, f = e.target.dataset.tf; if (k != null) tiersDraft[+k].upToKm = +e.target.value; if (f != null) tiersDraft[+f].fee = +e.target.value; });
  $('#tiers').addEventListener('click', e => { const x = e.target.closest('[data-tx]'); if (x && tiersDraft.length > 1) { tiersDraft.splice(+x.dataset.tx, 1); drawTiers(); } });
  $('#addTier').onclick = () => { const last = tiersDraft[tiersDraft.length - 1]; tiersDraft.push({ upToKm: (last?.upToKm || 0) + 2, fee: (last?.fee || 20) + 10 }); drawTiers(); };
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.onload = () => resolve(window.L); js.onerror = reject; document.head.appendChild(js);
    });
  }
  async function initSetMap() {
    try {
      const L = await loadLeaflet();
      const center = storePin || { lat: 8.4822, lng: 124.6472 };
      if (!setMapObj) {
        $('#setMap').innerHTML = '';
        setMapObj = L.map('setMap').setView([center.lat, center.lng], storePin ? 15 : 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(setMapObj);
        setMapObj.on('click', ev => { storePin = { lat: ev.latlng.lat, lng: ev.latlng.lng }; placeStore(); });
      }
      placeStore(); setTimeout(() => setMapObj.invalidateSize(), 80);
    } catch { $('#setMap').innerHTML = '<p class="map-loading">Map could not load. Check the internet connection.</p>'; }
  }
  function setStorePin(lat, lng, note) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast('Those coordinates look wrong. Example: 8.48220, 124.64720'); return; }
    storePin = { lat, lng };
    $('#storePinInfo').textContent = `Store pin: ${lat.toFixed(5)}, ${lng.toFixed(5)}${note ? ' · ' + note : ''} (tap “Save delivery settings”)`;
    $('#delToggle').disabled = false;
    if (setMapObj) { placeStore(); setMapObj.setView([lat, lng], 15); }
  }
  const readCoords = () => {
    const raw = $('#storeLat').value.trim();
    if (raw.includes(',')) { const [a, b] = raw.split(',').map(x => parseFloat(x)); $('#storeLat').value = a; $('#storeLng').value = b; }
    const lat = parseFloat($('#storeLat').value), lng = parseFloat($('#storeLng').value);
    if ($('#storeLat').value && $('#storeLng').value) setStorePin(lat, lng);
  };
  $('#storeLat').addEventListener('change', readCoords);
  $('#storeLng').addEventListener('change', readCoords);
  $('#storeHere').onclick = () => {
    if (!navigator.geolocation) return toast('Location is not available on this device.');
    $('#storeHere').disabled = true;
    navigator.geolocation.getCurrentPosition(p => { $('#storeHere').disabled = false; setStorePin(p.coords.latitude, p.coords.longitude, 'from this device'); },
      () => { $('#storeHere').disabled = false; toast('Allow location access in the browser, or type the coordinates.'); }, { enableHighAccuracy: true, timeout: 15000 });
  };
  function placeStore() {
    if (!storePin || !setMapObj) return;
    if (!storeMk) storeMk = window.L.marker([storePin.lat, storePin.lng], { draggable: true }).addTo(setMapObj).on('dragend', () => { const p = storeMk.getLatLng(); storePin = { lat: p.lat, lng: p.lng }; $('#storePinInfo').textContent = `Store pin: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} (not saved yet)`; });
    else storeMk.setLatLng([storePin.lat, storePin.lng]);
    $('#storePinInfo').textContent = `Store pin: ${storePin.lat.toFixed(5)}, ${storePin.lng.toFixed(5)}`;
  }
  async function saveSettings(patch, msg = 'Saved') {
    let ok = false;
    try { settings = await api('/api/staff/settings', { method: 'PUT', body: patch }); toast(msg); ok = true; } catch (err) { fail(err); }
    renderSettings();
    return ok;
  }
  $('#acceptToggle').onchange = e => saveSettings({ accepting: e.target.checked });
  $('#payOnlineToggle').onchange = e => saveSettings({ payOnline: e.target.checked });
  $('#payCounterToggle').onchange = e => saveSettings({ payCounter: e.target.checked });
  $('#qrToggle').onchange = e => saveSettings({ qrEnabled: e.target.checked });
  $('#qrFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      qrDraft = c.toDataURL('image/png'); if (qrDraft.length > 520000) qrDraft = c.toDataURL('image/jpeg', 0.9);
      renderSettings(); toast('QR loaded. Tap "Save QR details".');
    } catch { toast("Couldn't read that image. Try a PNG or JPG."); }
  });
  $('#qrSave').onclick = async () => { const patch = { qrName: $('#qrNameIn').value, qrNumber: $('#qrNumIn').value }; if (qrDraft) patch.qrImage = qrDraft; await saveSettings(patch, 'QR saved'); if (settings.qr?.image) qrDraft = null; renderSettings(); };
  $('#copyWh').onclick = async () => { try { await navigator.clipboard.writeText($('#whUrl').textContent); toast('Copied'); } catch { toast('Select the text to copy it'); } };
  $('#saveDelivery').onclick = () => (readCoords(), $('#delToggle').checked && !storePin ? toast('Set the store location first.') : saveSettings({ delivery: { enabled: $('#delToggle').checked, ...(storePin || {}), maxKm: +$('#delMax').value, minOrder: +$('#delMin').value || 0, eta: $('#delEta').value, tiers: tiersDraft } }, 'Delivery settings saved').then(() => { tiersDraft = null; renderSettings(); }));
  $('#delToggle').onchange = () => $('#saveDelivery').click();

  // ===================================================================== OPENING HOURS
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const t12 = (hhmm) => { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const cafeDate = (d = new Date(), backHours = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: catalog.tz || 'Asia/Manila' }).format(new Date(d - backHours * 3600e3));
  let hoursDraft = null;
  function renderHours() {
    if (!settings?.hours) return;
    hoursDraft ||= JSON.parse(JSON.stringify(settings.hours));
    const H = hoursDraft;
    $('#hoursToggle').checked = H.enabled !== false;
    const overnight = (d) => !d.closed && d.open && d.close && d.close <= d.open;
    $('#hoursDays').innerHTML = DAY_ORDER.map(i => { const d = H.days[i]; return `
      <div class="hrow ${d.closed ? 'off' : ''}"><b>${DAY_NAME[i]}</b>
        <label class="switchrow sm"><input type="checkbox" class="toggle" data-hopen="${i}" ${d.closed ? '' : 'checked'}> ${d.closed ? 'Closed' : 'Open'}</label>
        <input type="time" data-ho="${i}" value="${d.open || ''}" ${d.closed ? 'disabled' : ''} aria-label="${DAY_NAME[i]} opens"><span>→</span>
        <input type="time" data-hc="${i}" value="${d.close || ''}" ${d.closed ? 'disabled' : ''} aria-label="${DAY_NAME[i]} closes">
        <small class="hint">${d.closed ? '' : `${t12(d.open)} – ${t12(d.close)}${overnight(d) ? ' (next day)' : ''}`}</small></div>`; }).join('');
    const today = cafeDate();
    $('#specialDays').innerHTML = (H.special || []).map((x, i) => `
      <div class="hrow special ${x.date < today ? 'past' : ''}">
        <input type="date" data-sd="${i}" value="${x.date}" aria-label="Date">
        <label class="switchrow sm"><input type="checkbox" class="toggle" data-sopen="${i}" ${x.closed ? '' : 'checked'}> ${x.closed ? 'Closed' : 'Open'}</label>
        <input type="time" data-so="${i}" value="${x.open || ''}" ${x.closed ? 'disabled' : ''} aria-label="Opens"><span>→</span>
        <input type="time" data-sc="${i}" value="${x.close || ''}" ${x.closed ? 'disabled' : ''} aria-label="Closes">
        <input class="grow" data-sn="${i}" value="${esc(x.note || '')}" maxlength="120" placeholder="Note for customers, e.g. Pop-up at SM Uptown, 2nd floor" aria-label="Note">
        <button type="button" class="linkbtn bad" data-srm="${i}">Remove</button></div>`).join('') || '<p class="hint">No special days.</p>';
  }
  $('#hoursDays').addEventListener('input', e => {
    const t = e.target, H = hoursDraft;
    if (t.dataset.hopen) { H.days[t.dataset.hopen].closed = !t.checked; renderHours(); }
    if (t.dataset.ho) H.days[t.dataset.ho].open = t.value;
    if (t.dataset.hc) H.days[t.dataset.hc].close = t.value;
  });
  $('#hoursDays').addEventListener('change', e => { if (e.target.type === 'time') renderHours(); });
  $('#specialDays').addEventListener('input', e => {
    const t = e.target, S = hoursDraft.special;
    if (t.dataset.sd) S[t.dataset.sd].date = t.value;
    if (t.dataset.sopen) { S[t.dataset.sopen].closed = !t.checked; renderHours(); }
    if (t.dataset.so) S[t.dataset.so].open = t.value;
    if (t.dataset.sc) S[t.dataset.sc].close = t.value;
    if (t.dataset.sn) S[t.dataset.sn].note = t.value;
  });
  $('#specialDays').addEventListener('click', e => { const b = e.target.closest('[data-srm]'); if (!b) return; hoursDraft.special.splice(+b.dataset.srm, 1); renderHours(); });
  $('#addSpecial').onclick = () => {
    const date = cafeDate(Date.now() + 86400e3);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay(), d = hoursDraft.days[dow];
    hoursDraft.special = [...(hoursDraft.special || []), { date, closed: false, open: d.open || '16:00', close: d.close || '22:00', note: '' }];
    renderHours(); $(`[data-sn="${hoursDraft.special.length - 1}"]`)?.focus();
  };
  $('#closeToday').onclick = async () => {
    // A business day runs 4 AM → 4 AM, so at 1 AM "today" means last night's opening.
    const date = cafeDate(new Date(), 4);
    if (!confirm('Stop online orders for the rest of today? Customers can still order ahead for later days. (To pause just for a while, switch off "Taking online orders" instead.)')) return;
    const H = JSON.parse(JSON.stringify(settings.hours));
    H.special = (H.special || []).filter(x => x.date !== date).concat([{ date, closed: true, open: '', close: '', note: 'Closed today' }]);
    if (await saveSettings({ hours: H }, 'Closed for the rest of today')) { hoursDraft = null; renderHours(); }
  };
  $('#hoursToggle').onchange = () => { hoursDraft.enabled = $('#hoursToggle').checked; };
  $('#saveHours').onclick = async () => { if (await saveSettings({ hours: hoursDraft }, 'Opening hours saved')) { hoursDraft = null; renderHours(); } };

  // ===================================================================== HAPPY HOUR & PROMOS
  let promoDraft = null;
  const promoText = (p) => {
    const days = p.days.length === 7 ? 'every day' : p.days.length === 5 && [1, 2, 3, 4, 5].every(d => p.days.includes(d)) ? 'Mon–Fri' : p.days.length === 2 && p.days.includes(0) && p.days.includes(6) ? 'weekends' : p.days.map(d => DAY_SHORT[d]).join(', ');
    const what = (p.cats?.length ? p.cats.map(c => CAT[c] || c).join(', ') : 'everything') + (p.icedOnly ? ' (iced drinks only)' : '');
    return `${p.pct}% off ${what} · ${days} ${t12(p.from)}–${t12(p.to)}`;
  };
  function renderPromos() {
    if (!settings) return;
    promoDraft ||= JSON.parse(JSON.stringify(settings.promos || []));
    $('#promoList').innerHTML = promoDraft.map((p, i) => `
      <div class="promo-card ${p.active ? '' : 'off'}" data-pi="${i}">
        <div class="promo-top">
          <input class="grow" data-pf="name" value="${esc(p.name)}" maxlength="40" aria-label="Promo name">
          <label class="pct"><input type="number" data-pf="pct" min="1" max="90" value="${p.pct}" aria-label="Percent off"> % off</label>
          <label class="switchrow sm"><input type="checkbox" class="toggle" data-pf="active" ${p.active ? 'checked' : ''}> ${p.active ? 'On' : 'Off'}</label>
          <button type="button" class="linkbtn bad" data-prm>Remove</button>
        </div>
        <div class="promo-row"><span class="lbl">Days</span><div class="chips">${DAY_ORDER.map(d => `<button type="button" data-pday="${d}" aria-pressed="${p.days.includes(d)}">${DAY_SHORT[d]}</button>`).join('')}</div></div>
        <div class="promo-row"><span class="lbl">Time</span><input type="time" data-pf="from" value="${p.from}" aria-label="Starts"> <span>→</span> <input type="time" data-pf="to" value="${p.to}" aria-label="Ends"></div>
        <div class="promo-row"><span class="lbl">Applies to</span><div class="chips">
          <button type="button" data-pcat="" aria-pressed="${!p.cats.length}">All items</button>
          ${Object.entries(CAT).map(([k, v]) => `<button type="button" data-pcat="${k}" aria-pressed="${p.cats.includes(k)}">${esc(v)}</button>`).join('')}</div></div>
        <label class="switchrow sm"><input type="checkbox" class="toggle" data-pf="icedOnly" ${p.icedOnly ? 'checked' : ''}> Iced / cold drinks only (skips hot drinks and food)</label>
        <p class="hint promo-sum">${esc(promoText(p))}${p.active && p.days.length && p.from && p.to && promoOn(p, new Date(), catalog.tz) ? ' · <b class="ok">On now</b>' : ''}</p>
      </div>`).join('') || '<p class="hint">No promos yet. Tap "+ Add a promo" for a ready-made happy hour.</p>';
  }
  $('#promoList').addEventListener('input', e => {
    const card = e.target.closest('[data-pi]'), f = e.target.dataset.pf; if (!card || !f) return;
    const p = promoDraft[+card.dataset.pi];
    p[f] = e.target.type === 'checkbox' ? e.target.checked : f === 'pct' ? parseInt(e.target.value, 10) || 0 : e.target.value;
    if (e.target.type === 'checkbox' || e.target.type === 'time') renderPromos();
    else card.querySelector('.promo-sum').textContent = promoText(p);
  });
  $('#promoList').addEventListener('click', e => {
    const card = e.target.closest('[data-pi]'); if (!card) return;
    const p = promoDraft[+card.dataset.pi];
    const d = e.target.closest('[data-pday]'), c = e.target.closest('[data-pcat]');
    if (d) { const n = +d.dataset.pday; p.days = p.days.includes(n) ? p.days.filter(x => x !== n) : [...p.days, n].sort(); renderPromos(); }
    else if (c) { const k = c.dataset.pcat; p.cats = !k ? [] : p.cats.includes(k) ? p.cats.filter(x => x !== k) : [...p.cats, k]; renderPromos(); }
    else if (e.target.closest('[data-prm]')) { promoDraft.splice(+card.dataset.pi, 1); renderPromos(); }
  });
  $('#addPromo').onclick = () => { promoDraft.push({ name: 'Happy hour', pct: 10, cats: [], icedOnly: true, days: [0, 1, 2, 3, 4, 5, 6], from: '14:00', to: '16:00', active: true }); renderPromos(); };
  $('#savePromos').onclick = async () => { if (await saveSettings({ promos: promoDraft }, 'Promos saved. Prices update on the website and POS.')) { promoDraft = null; renderPromos(); loadCatalog(); } };

  // ===================================================================== PROMO CODES
  let codesData = null;
  const CHANNEL = { both: 'Online & in store', online: 'Online only', pos: 'In store only' };
  async function loadCodes() { if (!can('settings')) return; try { codesData = await api('/api/staff/codes'); renderCodes(); } catch (e) { fail(e); } }
  function renderCodes() {
    const today = cafeDate(new Date(), 4);
    $('#codeRows').innerHTML = (codesData?.codes || []).map(c => {
      const ended = c.endsOn && c.endsOn < today, used = c.maxUses != null && c.uses >= c.maxUses;
      const rules = [c.minCents ? `Min ${money(c.minCents)}` : '', c.startsOn || c.endsOn ? `${c.startsOn || '…'} → ${c.endsOn || '…'}` : '', CHANNEL[c.channel]].filter(Boolean).join(' · ');
      return `<tr data-code="${esc(c.code)}" class="${!c.active || ended || used ? 'muted-row' : ''}">
        <td><b class="mono">${esc(c.code)}</b>${c.note ? `<br><small class="hint">${esc(c.note)}</small>` : ''}</td>
        <td>${esc(c.label)}</td><td><small>${esc(rules)}</small>${ended ? '<br><small class="bad">Ended</small>' : used ? '<br><small class="bad">Used up</small>' : ''}</td>
        <td class="num">${c.uses}${c.maxUses != null ? ` / ${c.maxUses}` : ''}</td><td class="num">${money(c.givenCents)}</td>
        <td><label class="switchrow sm"><input type="checkbox" class="toggle" data-code-active ${c.active ? 'checked' : ''}> ${c.active ? 'On' : 'Off'}</label></td>
        <td><button type="button" class="linkbtn bad" data-code-del>Delete</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="hint">No promo codes yet. Create one above.</td></tr>';
  }
  $('#cfKind').onchange = () => { $('#cfMaxF').hidden = $('#cfKind').value !== 'pct'; $('#cfValue').placeholder = $('#cfKind').value === 'pct' ? '20' : '50'; };
  $('#cfGen').onclick = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; $('#cfCode').value = 'DD' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => A[b % A.length]).join(''); };
  $('#codeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { code: $('#cfCode').value, kind: $('#cfKind').value, value: $('#cfValue').value, maxOff: $('#cfKind').value === 'pct' ? $('#cfMax').value : '',
      minOrder: $('#cfMin').value, startsOn: $('#cfStart').value, endsOn: $('#cfEnd').value, maxUses: $('#cfUses').value, channel: $('#cfChannel').value, note: $('#cfNote').value };
    try { const c = await api('/api/staff/codes', { method: 'POST', body }); toast(`Code ${c.code} created: ${c.label}`); $('#codeForm').reset(); $('#cfKind').onchange(); loadCodes(); } catch (err) { fail(err); }
  });
  $('#codeRows').addEventListener('change', async e => {
    const tr = e.target.closest('[data-code]'); if (!tr || !e.target.matches('[data-code-active]')) return;
    try { await api('/api/staff/codes', { method: 'PUT', body: { code: tr.dataset.code, active: e.target.checked } }); toast(e.target.checked ? 'Code switched on' : 'Code switched off'); } catch (err) { fail(err); }
    loadCodes();
  });
  $('#codeRows').addEventListener('click', async e => {
    const tr = e.target.closest('[data-code]'); if (!tr || !e.target.closest('[data-code-del]')) return;
    if (!confirm(`Delete code ${tr.dataset.code}? Customers won't be able to use it. Past orders keep their discount.`)) return;
    try { await api('/api/staff/codes', { method: 'DELETE', body: { code: tr.dataset.code } }); toast('Code deleted'); loadCodes(); } catch (err) { fail(err); }
  });

  // ===================================================================== NIGHTLY SUMMARY
  function renderSummaryBox() {
    const S = settings.summary || {}, I = settings.integration || {};
    $('#sumToggle').checked = !!S.enabled;
    if (document.activeElement !== $('#sumEmails')) $('#sumEmails').value = (S.emails || []).join(', ');
    $('#sumStatus').innerHTML = !I.email ? '⚠️ Email isn\'t connected yet: add <code>RESEND_API_KEY</code> in Vercel (see SETUP.md, "Nightly summary email").'
      : !I.cron ? '⚠️ Add <code>CRON_SECRET</code> in Vercel so the nightly email runs by itself. "Send now" already works.'
      : S.enabled ? '✅ On. The next summary arrives tomorrow around 4–5 AM.' : 'Email is connected. Switch it on to get a summary every night.';
    $('#sumSend').disabled = !I.email;
  }
  const saveSummary = () => saveSettings({ summary: { enabled: $('#sumToggle').checked, emails: $('#sumEmails').value } }, 'Summary settings saved');
  $('#sumToggle').onchange = saveSummary;
  $('#saveSummary').onclick = saveSummary;
  $('#sumSend').onclick = async () => {
    $('#sumSend').disabled = true;
    try { const r = await api('/api/staff/summary', { method: 'POST', body: {} }); toast(`Summary for ${r.date} sent to ${r.to.join(', ')}`); } catch (err) { fail(err); }
    $('#sumSend').disabled = false;
  };

  // ===================================================================== ACTIVITY LOG
  let acPage = 1, acData = null, acTimer;
  const ACT = {
    'product.price': 'Changed price / cost', 'product.edit': 'Edited product', 'product.add': 'Added product', 'product.delete': 'Deleted product', 'product.photo': 'Product photo',
    'addon.price': 'Changed add-on price', 'addon.edit': 'Edited add-on', 'addon.add': 'Added add-on', 'addon.delete': 'Deleted add-on',
    'order.cancel': 'Cancelled order', 'order.void': 'Voided paid order', 'order.refund': 'Refunded order', 'payment.confirm': 'Confirmed GCash/Maya payment', 'payment.reject': 'Rejected payment',
    'pos.discount': 'Gave a discount', 'cash.in': 'Cash in', 'cash.out': 'Cash out', 'shift.open': 'Opened shift', 'shift.close': 'Closed shift',
    'expense.add': 'Added expense', 'expense.delete': 'Deleted expense', stock: 'Changed stock',
    'settings.ordering': 'Online ordering / payments', 'settings.qr': 'GCash QR', 'settings.delivery': 'Delivery settings', 'settings.hours': 'Opening hours', 'settings.promos': 'Happy hour & promos', 'settings.summary': 'Summary email',
    'code.add': 'Created promo code', 'code.edit': 'Changed promo code', 'code.delete': 'Deleted promo code',
    'user.add': 'Added staff', 'user.edit': 'Edited staff', 'user.delete': 'Deleted staff', 'user.password': 'Changed own password', login: 'Signed in', 'login.failed': 'Failed sign-in',
  };
  const WARN = new Set(['order.void', 'order.refund', 'expense.delete', 'product.delete', 'login.failed', 'payment.reject', 'user.delete', 'code.delete']);
  const MONEY_KEYS = new Set(['price', 'cost', 'cents', 'totalCents', 'openingCents', 'countedCents', 'expectedCents', 'overShortCents']);
  const LABEL = { label: 'Discount', channel: 'Works', maxUses: 'Max uses', startsOn: 'Starts', endsOn: 'Ends', price: 'Price', cost: 'Cost', name: 'Name', cat: 'Category', hot: 'Hot', available: 'Available', low: 'Low-stock alert', grp: 'Applies to', active: 'Active', role: 'Role', username: 'Username', perms: 'Permissions', password: 'Password' };
  const val = (k, v) => (v == null || v === '' ? '—' : MONEY_KEYS.has(k) ? money(v) : k === 'cat' ? CAT[v] || v : k === 'channel' ? CHANNEL[v] || v : typeof v === 'boolean' ? (v ? 'yes' : 'no') : Array.isArray(v) ? v.join(', ') : esc(String(v)));
  function acDetail(e) {
    const d = e.detail || {};
    if (e.action.startsWith('settings.')) {
      const t = d.to || {};
      if (e.action === 'settings.promos') return (t.promos || []).map(p => `${esc(p.name)} ${p.pct}% ${p.active ? '' : '(off)'}`).join(', ') || 'All promos removed';
      if (e.action === 'settings.hours') return `Hours ${t.hours?.enabled === false ? 'switched off' : 'updated'}${(t.hours?.special || []).length ? ' · special days: ' + t.hours.special.map(x => `${x.date}${x.closed ? ' closed' : ` ${t12(x.open)}–${t12(x.close)}`}`).join(', ') : ''}`;
      if (e.action === 'settings.ordering') return Object.keys(t).filter(k => JSON.stringify(t[k]) !== JSON.stringify(d.from?.[k])).map(k => `${{ accepting: 'Online orders', payOnline: 'PayMongo', payCounter: 'Pay at counter' }[k]}: ${t[k] ? 'on' : 'off'}`).join(', ');
      if (e.action === 'settings.summary') return `${t.summary?.enabled ? 'On' : 'Off'} · ${esc((t.summary?.emails || []).join(', '))}`;
      return 'Updated';
    }
    return Object.entries(d).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => Array.isArray(v) && v.length === 2 && k !== 'perms'
      ? `${LABEL[k] || k}: ${val(k, v[0])} → <b>${val(k, v[1])}</b>`
      : k === 'perms' ? 'Permissions changed' : `${LABEL[k] || ({ totalCents: 'Order total', reason: 'Reason', reference: 'Ref', description: 'For', date: 'Dated', type: 'Type', note: 'Note', customer: 'Customer', openingCents: 'Opening', countedCents: 'Counted', expectedCents: 'Expected', overShortCents: 'Over/short', from: 'From', to: 'To', kb: 'Size (KB)', removed: 'Removed', closedFor: 'For' }[k] || k)}: ${val(k, v)}`).join(' · ');
  }
  async function loadActivity() {
    if (!can('audit')) return;
    const q = new URLSearchParams({ page: acPage });
    for (const [k, id] of [['type', '#acType'], ['user', '#acUser'], ['from', '#acFrom'], ['to', '#acTo'], ['q', '#acQ']]) if ($(id).value) q.set(k, $(id).value);
    try { acData = await api('/api/staff/activity?' + q); } catch (e) { return fail(e); }
    const cur = $('#acUser').value;
    $('#acUser').innerHTML = '<option value="">Everyone</option>' + acData.people.map(p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    $('#acRows').innerHTML = acData.entries.map(e => `<tr class="${WARN.has(e.action) ? 'warn-row' : ''}">
      <td class="when">${fmtDT(e.at)}</td><td>${esc(e.userName || '—')}</td>
      <td><b>${esc(ACT[e.action] || e.action)}</b>${e.target ? `<br><small>${esc(e.target)}</small>` : ''}</td>
      <td class="ac-detail">${acDetail(e)}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">Nothing recorded for these filters yet.</td></tr>';
    $('#acInfo').textContent = `Page ${acData.page} of ${acData.pages} · ${acData.total} entries`;
    $('#acPrev').disabled = acData.page <= 1; $('#acNext').disabled = acData.page >= acData.pages;
  }
  ['#acType', '#acUser', '#acFrom', '#acTo'].forEach(id => $(id).addEventListener('change', () => { acPage = 1; loadActivity(); }));
  $('#acQ').addEventListener('input', () => { clearTimeout(acTimer); acTimer = setTimeout(() => { acPage = 1; loadActivity(); }, 300); });
  $('#acPrev').onclick = () => { acPage = Math.max(1, acPage - 1); loadActivity(); };
  $('#acNext').onclick = () => { acPage++; loadActivity(); };

  // ===================================================================== USERS
  let usersData = null, editUser = null;
  async function loadUsers() { try { usersData = await api('/api/staff/users'); renderUsers(); } catch (e) { fail(e); } }
  function renderUsers() {
    $('#userRows').innerHTML = usersData.users.map(u => `<tr><td><b>${esc(u.name)}</b>${u.id === me.user.id ? ' <small class="hint">(you)</small>' : ''}</td><td class="mono">${esc(u.username)}</td>
      <td>${esc(usersData.roles[u.role]?.label || u.role)}</td><td class="perm-chips">${u.perms.map(p => `<span>${esc(p.replace('_', ' '))}</span>`).join('')}</td>
      <td>${u.active ? '<span class="pill paid">Active</span>' : '<span class="pill cancelled">Off</span>'}</td><td class="when">${u.lastLogin ? fmtDT(u.lastLogin) : 'never'}</td>
      <td><button class="linkbtn" type="button" data-edit-user="${esc(u.id)}">Edit</button></td></tr>`).join('');
  }
  function drawPerms(role, list) {
    const all = role === 'admin';
    $('#udPerms').innerHTML = '<legend>Can do</legend>' + Object.entries(usersData.permLabels).map(([k, v]) => `<label><input type="checkbox" value="${k}" ${all || list.includes(k) ? 'checked' : ''} ${all ? 'disabled' : ''}> ${esc(v)}</label>`).join('');
  }
  function openUser(u) {
    editUser = u || null;
    $('#udTitle').textContent = u ? `Edit ${u.name}` : 'Add staff';
    $('#udName').value = u?.name || ''; $('#udUser').value = u?.username || ''; $('#udPass').value = '';
    $('#udPassL').textContent = u ? 'New password (leave empty to keep)' : 'Password';
    $('#udRole').value = u?.role || 'cashier'; $('#udActive').checked = u ? u.active : true;
    drawPerms($('#udRole').value, u ? u.perms : usersData.roles.cashier.perms);
    $('#udDelete').hidden = !u || u.id === me.user.id; $('#udDelete').textContent = 'Delete account'; delete $('#udDelete').dataset.armed;
    $('#udNote').textContent = ''; $('#userDlg').showModal();
  }
  $('#udRole').onchange = () => drawPerms($('#udRole').value, usersData.roles[$('#udRole').value].perms);
  $('#newUserBtn').onclick = () => openUser(null);
  $('#userRows').addEventListener('click', e => { const b = e.target.closest('[data-edit-user]'); if (b) openUser(usersData.users.find(u => u.id === b.dataset.editUser)); });
  $('#udClose').onclick = () => $('#userDlg').close();
  $('#userForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { name: $('#udName').value, username: $('#udUser').value, role: $('#udRole').value, active: $('#udActive').checked, perms: $$('#udPerms input:checked').map(i => i.value) };
    if ($('#udPass').value) body.password = $('#udPass').value;
    try {
      if (editUser) await api('/api/staff/users', { method: 'PUT', body: { id: editUser.id, ...body } });
      else { if (!body.password) throw new Error('Set a password for the new account.'); await api('/api/staff/users', { method: 'POST', body }); }
      $('#userDlg').close(); toast(editUser ? 'Saved' : `${body.name} can now sign in as ${body.username.toLowerCase()}`); loadUsers();
    } catch (err) { $('#udNote').textContent = err.message; $('#udNote').classList.add('err'); }
  });
  $('#udDelete').onclick = async () => {
    const b = $('#udDelete');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
    try { await api('/api/staff/users', { method: 'DELETE', body: { id: editUser.id } }); $('#userDlg').close(); toast('Account deleted. Their past sales keep their name.'); loadUsers(); } catch (err) { $('#udNote').textContent = err.message; }
  };

  // ===================================================================== live updates
  // New data (menu, prices, stock, settings) → refresh quietly. New deployment → reload when idle.
  let firstBuild = null, dataV = null, reloadWanted = false;
  function checkUpdates(d) {
    if (d.v && dataV && d.v !== dataV) { dataV = d.v; loadCatalog(); loadSettings(); }
    else if (d.v) dataV = d.v;
    if (d.build && firstBuild && d.build !== firstBuild) reloadWanted = true;
    maybeReload();
  }
  function maybeReload() {
    if (!reloadWanted) return;
    const busyNow = document.querySelector('dialog[open]') || posBusy || drawer.classList.contains('open') || msgPanel.classList.contains('open')
      || (document.activeElement && document.activeElement.matches('input,textarea,select'));
    if (busyNow && !document.hidden) return;
    location.reload(); // POS ticket is saved and comes back after the reload
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me) refreshBoard(); });

  setInterval(renderBoard, 30000); // keep "in X min" fresh
  api('/api/staff/login').then(d => d.signedIn ? showApp(d) : showLogin()).catch(showLogin);
})();