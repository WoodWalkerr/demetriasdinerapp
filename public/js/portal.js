// Employee portal: sign in, choose your password, time in / time out (with location), your DTR and downloads.
// Everything shown is the signed-in employee's own records; the server decides times (not the phone's clock).
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let toastT;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3800); };
  async function api(path, opts = {}) {
    const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j?.error || (r.status === 0 ? 'No connection.' : 'Something went wrong. Try again.')); e.status = r.status; throw e; }
    return j;
  }
  const show = (id) => ['#vLogin', '#vPw', '#vHome'].forEach((v) => { $(v).hidden = v !== id; });
  const TZ = 'Asia/Manila';
  const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '—');
  const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
  const t12 = (hhmm) => { const h = +hhmm.slice(0, 2), m = hhmm.slice(3); return `${h % 12 || 12}${m === '00' ? '' : ':' + m} ${h < 12 ? 'AM' : 'PM'}`; };
  const dist = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km away` : `${m} m from the shop`);
  const CHIP = { rest: ['Rest day', 'rest'], pending: ['Not in yet', 'pending'], absent: ['Absent', 'bad'], present: ['On time', 'ok'], late: ['Late', 'warn'], working: ['Working', 'ok'], no_timeout: ['No time-out', 'warn'], future: ['', ''] };
  const chip = (r) => {
    const [label, cls] = r.status === 'working' && r.presence === 'late' ? ['Working · late', 'warn'] : CHIP[r.status] || [r.status, ''];
    const extra = r.completion === 'undertime' ? ' · Undertime' : r.completion === 'complete' && r.overtimeMin ? ' · Overtime' : '';
    return `<span class="att-chip ${cls}">${esc(label + extra)}</span>`;
  };

  let me = null, data = null, clockOffset = 0, tick;

  // ---------------------------------------------------------------- sign in
  async function boot() {
    try {
      const w = await api('/api/staff/login');
      if (!w.signedIn) return showLogin();
      me = w.user; afterSignIn();
    } catch { showLogin(); }
  }
  function showLogin() { $('#ptUserBar').hidden = true; show('#vLogin'); setTimeout(() => $('#lUser').focus(), 50); }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = $('#lNote'); n.textContent = ''; n.classList.remove('err');
    if (!$('#lUser').value.trim() || !$('#lPw').value) { n.textContent = 'Enter your username and password.'; n.classList.add('err'); return; }
    $('#lGo').disabled = true;
    try { const w = await api('/api/staff/login', { method: 'POST', body: { username: $('#lUser').value, password: $('#lPw').value } }); me = w.user; $('#lPw').value = ''; afterSignIn(); }
    catch (err) { n.textContent = err.message; n.classList.add('err'); }
    $('#lGo').disabled = false;
  });
  function afterSignIn() {
    $('#ptUserBar').hidden = false; $('#ptStaffLink').hidden = !(me.perms || []).length;
    if (me.mustChangePassword) return showPw(true);
    show('#vHome'); load();
  }
  $('#ptLogout').onclick = async () => { try { await api('/api/staff/logout', { method: 'POST' }); } catch {} me = null; data = null; clearInterval(tick); showLogin(); };

  // ---------------------------------------------------------------- passwords
  function showPw(forced) {
    show('#vPw'); $('#pwCancel').hidden = forced;
    $('#pwTitle').textContent = forced ? 'Choose your password' : 'Change password';
    $('#pwHint').hidden = !forced; setTimeout(() => $('#pwCur').focus(), 50);
  }
  async function changePw(cur, a, b, note, btn) {
    note.textContent = ''; note.classList.remove('err');
    const fail = (m) => { note.textContent = m; note.classList.add('err'); return false; };
    if (!cur) return fail('Enter your current password.');
    if ((a || '').length < 6) return fail('Your new password needs at least 6 characters.');
    if (a !== b) return fail("The two new passwords don't match.");
    if (a === cur) return fail('Choose a new password that is different from the current one.');
    btn.disabled = true;
    try { await api('/api/staff/me', { method: 'PUT', body: { currentPassword: cur, newPassword: a } }); btn.disabled = false; return true; }
    catch (err) { btn.disabled = false; return fail(err.status === 401 ? 'Your current password is wrong.' : err.message); }
  }
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await changePw($('#pwCur').value, $('#pwNew').value, $('#pwNew2').value, $('#pwNote'), $('#pwGo'))) {
      $('#pwForm').reset(); me.mustChangePassword = false; toast('Password saved. Welcome!'); show('#vHome'); load();
    }
  });
  $('#pwCancel').onclick = () => { show('#vHome'); };
  $('#pw2Form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await changePw($('#p2Cur').value, $('#p2New').value, $('#p2New2').value, $('#p2Note'), $('#p2Go'))) { $('#pw2Form').reset(); $('#p2Note').textContent = '✓ Password changed.'; }
  });

  // ---------------------------------------------------------------- dashboard
  async function load(month) {
    try {
      data = await api('/api/staff/attendance' + (month ? `?month=${month}` : ''));
      clockOffset = new Date(data.serverTime) - Date.now();
      render();
    } catch (err) {
      if (err.status === 401) return showLogin();
      if (err.status === 403 && /temporary password/.test(err.message)) return showPw(true);
      toast(err.message);
    }
  }
  const serverNow = () => new Date(Date.now() + clockOffset);
  function render() {
    const d = data, r = d.todayRow, s = d.schedule;
    $('#hName').textContent = `Hi, ${d.me.name.split(' ')[0]}!`;
    // the business day (until 4 AM, a late shift still belongs to the day it started)
    $('#hDate').textContent = new Date(d.today + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) + (serverNow().toLocaleDateString('en-CA', { timeZone: TZ }) !== d.today ? ' (until 4 AM)' : '');
    $('#hOff').hidden = d.enabled && s.track;
    if (d.enabled && !s.track) $('#hOff').textContent = "Your account doesn't record attendance. Ask your admin if this is wrong.";
    $('#hYesterday').hidden = !d.openYesterday;
    if (d.openYesterday) $('#hYesterday').textContent = `⚠️ You timed in on ${fmtDate(d.openYesterday.date)} at ${fmtTime(d.openYesterday.timeIn)} but didn't time out. Tell your admin what time you left so they can fix it.`;
    $('#hToday').hidden = !(d.enabled && s.track);
    // today
    $('#tChip').outerHTML = chip(r).replace('class="att-chip', 'id="tChip" class="att-chip');
    $('#tSched').textContent = r.rest ? 'Rest day today. If you work, time in and out as usual.' : `Start ${t12(s.start)} (${s.graceMin} min grace) · time in by ${t12(s.deadline)} · ${s.requiredHours} hours${s.breakMin ? ` + ${s.breakMin} min break` : ''}`;
    $('#tIn').textContent = fmtTime(r.timeIn); $('#tOut').textContent = fmtTime(r.timeOut);
    $('#tInLoc').textContent = r.timeIn ? (r.inOutside ? `⚠️ ${dist(r.inDistM)}` : r.inDistM != null ? `📍 ${dist(r.inDistM)}` : '') : '';
    $('#tOutLoc').textContent = r.timeOut ? (r.outOutside ? `⚠️ ${dist(r.outDistM)}` : r.outDistM != null ? `📍 ${dist(r.outDistM)}` : '') : '';
    $('#tInLoc').classList.toggle('warn-t', r.inOutside); $('#tOutLoc').classList.toggle('warn-t', r.outOutside);
    renderHours();
    const msgs = [];
    if (r.lateMin) msgs.push(`Late by ${hm(r.lateMin)}.`);
    if (r.flags?.includes('Timed in after the deadline')) msgs.push(`Timed in after the ${t12(s.deadline)} deadline, so today counts as absent. Talk to your admin if there was a reason.`);
    if (r.status === 'working' && r.expectedOut) msgs.push(`Your ${s.requiredHours} hours are done at about ${fmtTime(r.expectedOut)}.`);
    if (r.timeOut && r.completion === 'undertime') msgs.push(`${hm(r.undertimeMin)} short of ${s.requiredHours} hours.`);
    if (r.timeOut && r.overtimeMin) msgs.push(`${hm(r.overtimeMin)} overtime.`);
    if (r.status === 'pending') msgs.push(`Time in by ${t12(s.deadline)} or today counts as absent.`);
    if (r.status === 'absent' && !r.timeIn && !r.rest) msgs.push(`No time-in by ${t12(s.deadline)}, so today is marked absent. You can still time in; your admin will see it.`);
    $('#tMsg').textContent = msgs.join(' ');
    // the button
    const b = $('#punchBtn'), can = d.enabled && s.track;
    b.hidden = !can || !!r.timeOut;
    b.textContent = r.timeIn ? '⏹ Time out' : '▶ Time in';
    b.classList.toggle('out', !!r.timeIn);
    $('#locHint').textContent = !can || r.timeOut ? (r.timeOut ? '✓ Done for today. See you next shift!' : '') : d.rules.requireLocation ? `Your location is checked when you tap (must be within ${d.rules.radiusM} m of the shop${d.rules.blockOutside ? '' : '; outside is allowed but flagged'}).` : '';
    // month
    $('#mPick').value = d.month; $('#mPick').max = d.today.slice(0, 7);
    const t = d.summary;
    $('#mStats').innerHTML = [['Present', t.present], ['Late', t.late], ['Absent', t.absent], ['Hours', hm(t.workedMin)], ['Undertime', hm(t.undertimeMin)], ['Overtime', hm(t.overtimeMin)]]
      .map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('');
    const from = `${d.month}-01`, to = d.rows[0]?.date || from;
    $('#dlX').href = `/api/staff/attendance?format=xlsx&from=${from}&to=${to}`; $('#dlP').href = `/api/staff/attendance?format=pdf&from=${from}&to=${to}`;
    $('#mList').innerHTML = d.rows.filter((x) => x.status !== 'future').map((x) => `<div class="pt-day ${x.status}">
        <div class="pt-day-d"><b>${esc(fmtDate(x.date))}</b>${chip(x)}</div>
        <div class="pt-day-t"><span>${fmtTime(x.timeIn)} → ${fmtTime(x.timeOut)}</span><b>${x.workedMin != null ? hm(x.workedMin) : x.timeIn && !x.timeOut ? 'no time-out' : ''}</b></div>
        ${x.flags?.length ? `<small>${esc(x.flags.filter((f) => f !== 'No time-in').join(' · '))}</small>` : ''}</div>`).join('') || '<p class="hint">No days yet this month.</p>';
    clearInterval(tick); tick = setInterval(() => { renderClock(); if (data?.todayRow?.status === 'working') renderHours(); }, 1000); renderClock();
  }
  function renderClock() { $('#hClock').textContent = serverNow().toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
  function renderHours() {
    const r = data.todayRow, s = data.schedule;
    let w = r.workedMin;
    if (r.status === 'working' || (r.timeIn && !r.timeOut && r.status === 'absent')) { // live while working
      const raw = Math.floor((serverNow() - new Date(r.timeIn)) / 60000); w = Math.max(0, raw - (raw > s.breakMin ? s.breakMin : 0));
    }
    const req = r.rest ? 0 : Math.round(s.requiredHours * 60);
    $('#tHours').textContent = hm(w || 0); $('#tReq').textContent = req ? `of ${s.requiredHours}h` : 'rest day';
    $('#tBar').style.width = `${req ? Math.min(100, ((w || 0) / req) * 100) : 0}%`;
    $('#tBar').classList.toggle('done', !!req && (w || 0) >= req);
  }
  $('#mPick').addEventListener('change', () => { if ($('#mPick').value) load($('#mPick').value); });

  // ---------------------------------------------------------------- time in / out
  const getLocation = () => new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error("This browser can't share your location. Use Chrome or Safari."));
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => no(new Error(e.code === 1 ? 'Location is blocked. Allow location for this site (browser settings → Location → Allow), then try again.'
        : e.code === 3 ? "Couldn't get your location in time. Go near a window or turn on Wi-Fi/GPS, then try again." : "Couldn't get your location. Turn on Location/GPS and try again.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  let busy = false;
  $('#punchBtn').onclick = async () => {
    if (busy || !data) return;
    const action = data.todayRow.timeIn ? 'out' : 'in', note = $('#punchNote'), b = $('#punchBtn');
    if (action === 'out' && data.todayRow.completion === 'in_progress') {
      const r = data.todayRow, raw = Math.floor((serverNow() - new Date(r.timeIn)) / 60000), req = Math.round(data.schedule.requiredHours * 60);
      if (!r.rest && raw < req && !confirm(`You've worked ${hm(raw)} of ${data.schedule.requiredHours}h. Time out now anyway? It will show as undertime.`)) return;
    }
    busy = true; b.disabled = true; note.classList.remove('err'); note.textContent = '📍 Checking your location…';
    let loc = {};
    try { loc = await getLocation(); }
    catch (err) { if (data.rules.requireLocation) { note.textContent = err.message; note.classList.add('err'); busy = false; b.disabled = false; return; } }
    note.textContent = action === 'in' ? 'Timing in…' : 'Timing out…';
    try {
      const r = await api('/api/staff/attendance', { method: 'POST', body: { action, ...loc } });
      note.textContent = `${action === 'in' ? '✅ Timed in' : '✅ Timed out'} at ${fmtTime(action === 'in' ? r.row.timeIn : r.row.timeOut)}${r.distM != null ? ` · ${dist(r.distM)}` : ''}${r.outside ? '. ⚠️ Outside the shop area, so this was flagged for your admin.' : ''}`;
      navigator.vibrate?.(60);
      data.todayRow = r.row; render(); // show the new time right away; the full refresh follows
      await load(data.month === data.today.slice(0, 7) ? undefined : data.month);
    } catch (err) {
      note.textContent = err.message; note.classList.add('err');
      if (err.status === 409) load();
    }
    busy = false; b.disabled = false;
  };
  // back to the app after a while → refresh (times and statuses change)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me && !$('#vHome').hidden) load(); });
  boot();
})();