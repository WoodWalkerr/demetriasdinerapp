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
    if ($('#gdDlg')) {
      $('#gdOpen').hidden = !(d.enabled && s?.track);
      if (d.enabled && s?.track && !d.mustChangePassword && !seen(guideKey()) && !$('#ntDlg').open) openGuide();
    }
    renderSchedule();
    gpsWatch();
    clearInterval(tick); tick = setInterval(() => { renderClock(); if (data?.todayRow?.status === 'working') renderHours(); }, 1000); renderClock();
  }
  // ---------------------------------------------------------------- my schedule + notifications
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let sView = 'week', ntShownFor = '';
  function renderSchedule() {
    const m = data.mySchedule; if (!m) { $('#sSched').hidden = true; return; }
    $('#sSched').hidden = false;
    const c = m.current;
    $('#sCurrent').innerHTML = `<div class="pt-shift-name"><b>${esc(c.name || 'Shop schedule')}</b>${c.location ? `<span>📍 ${esc(c.location)}</span>` : ''}</div>
      <div class="pt-times">
        <div><span>Time in</span><b>${c.start ? t12(c.start) : '—'}</b><small>late after ${c.start ? t12(addM(c.start, c.graceMin)) : '—'}</small></div>
        <div><span>Time out</span><b>${c.end ? t12(c.end) : '—'}</b><small>${c.requiredHours}h required${c.breakMin ? ` + ${c.breakMin} min break` : ''}</small></div>
        <div><span>Day off</span><b>${c.daysOffNames.length ? esc(c.daysOffNames.map(d => d.slice(0, 3)).join(', ')) : 'None'}</b><small>time in by ${t12(c.deadline)}</small></div>
      </div>`;
    $('#sUpcoming').hidden = !m.upcoming;
    if (m.upcoming) $('#sUpcoming').innerHTML = `🔔 From <b>${esc(fmtDate(m.upcoming.from))}</b>: <b>${esc(m.upcoming.name)}</b>, ${t12(m.upcoming.start)} – ${t12(m.upcoming.end)}${m.upcoming.daysOff.length ? ` · day off ${esc(m.upcoming.daysOff.join(', '))}` : ''}${m.upcoming.location ? ` · ${esc(m.upcoming.location)}` : ''}`;
    $('#sWeek').hidden = sView !== 'week'; $('#sMonth').hidden = sView !== 'month';
    $('#sWeek').innerHTML = m.week.map(d => `<div class="pt-wd ${d.off ? 'off' : ''} ${d.date === data.today ? 'today' : ''}" style="--sc:${esc(d.color || '#066B23')}"><b>${DAYN[d.dow]}<small>${fmtDate(d.date).replace(/^\w+,\s*/, '')}</small></b><span>${d.off ? 'Day off' : `${t12(d.start)} – ${t12(d.end || '')}`}</span><small>${d.changed ? '<em class="pt-chg">Changed</em> ' : ''}${d.off ? '' : esc(d.name || '')}</small></div>`).join('');
    const first = m.month[0]?.dow || 0;
    $('#sMonth').innerHTML = DAYN.map(d => `<i class="pt-cal-h">${d[0]}</i>`).join('') + Array.from({ length: first }, () => '<i></i>').join('')
      + m.month.map(d => `<div class="pt-cd ${d.off ? 'off' : ''} ${d.date === data.today ? 'today' : ''}" style="--sc:${esc(d.color || '#066B23')}" title="${d.off ? 'Day off' : esc(`${d.name}: ${t12(d.start)} – ${t12(d.end || '')}`)}"><b>${+d.date.slice(8)}</b><small>${d.off ? 'Off' : t12(d.start).replace(':00', '')}</small></div>`).join('');
    // notifications
    $('#ptBellN').hidden = !m.unread; $('#ptBellN').textContent = m.unread;
    const unread = m.notifications.filter(n => !n.read), key = unread.map(n => n.id).join(',');
    if (unread.length && key !== ntShownFor && !$('#ntDlg').open && !$('#gdDlg')?.open) { ntShownFor = key; openNotes(unread); }
  }
  // ---------------------------------------------------------------- "How attendance works" (shown the first time, and again when the rules change)
  const guideKey = () => { const d = data, s = d.schedule, r = d.rules; const raw = JSON.stringify([s.start, s.end, s.deadline, s.graceMin, s.requiredHours, s.breakMin, r.afterDeadline, r.requireLocation, r.blockOutside, r.radiusM, r.guideNotes]);
    let h = 0; for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0; return `dd_guide_${d.me.username}_${h}`; };
  const seen = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
  function openGuide() {
    const d = data, s = d.schedule, r = d.rules, cs = d.mySchedule?.current || {};
    const days = cs.daysOffNames?.length ? cs.daysOffNames.join(', ') : '';
    $('#gdSub').innerHTML = `Your schedule: <b>${esc(s.name || 'Shop schedule')}</b>, ${t12(s.start)} – ${s.end ? t12(s.end) : '…'}${s.location ? ` · 📍 ${esc(s.location)}` : ''}`;
    const items = [
      ['⏰', 'Time in when you arrive', `Open this page and tap <b>Time in</b> as soon as you get to work${s.start ? ` (your shift starts at <b>${t12(s.start)}</b>)` : ''}. The time comes from the server, not your phone.`],
      ['✅', 'Be on time', `You're on time until <b>${t12(addM(s.start, s.graceMin))}</b>${s.graceMin ? ` (${s.graceMin}-minute grace)` : ''}. After that you're marked <b>Late</b> and the late minutes are recorded on your DTR.`],
      ['❌', `Time in by ${t12(s.deadline)}`, r.afterDeadline === 'late' ? `A time-in after <b>${t12(s.deadline)}</b> still counts, but as <b>Late</b>. No time-in at all = <b>Absent</b>.` : `If you haven't timed in by <b>${t12(s.deadline)}</b>, the day counts as <b>Absent</b>, even if you come in later.`],
      ['🕖', `Work ${s.requiredHours} hours`, `Your day is <b>${s.requiredHours} hours</b>${s.breakMin ? ` plus a ${s.breakMin}-minute unpaid break` : ''}. Leaving earlier is recorded as <b>undertime</b>. Staying longer is recorded as <b>overtime</b> for your admin to check.`],
      ['🚪', 'Always time out', `Tap <b>Time out</b> before you leave. If you forget, that day's hours <b>aren't counted</b>. Tell your admin right away so they can correct it.`],
      r.requireLocation ? ['📍', 'Be at the shop', `Time in and out only while you're at the shop${r.radiusM ? ` (within ${r.radiusM} m)` : ''}. Allow <b>Location</b> for this site and turn on GPS. ${r.blockOutside ? 'It <b>won\'t work</b> outside the shop.' : 'Outside the shop it still works, but it\'s <b>flagged</b> for your admin.'}`] : null,
      ['🗓️', 'Check your schedule', `${days ? `Your day off: <b>${esc(days)}</b>. ` : ''}Schedule changes pop up here and show under <b>My schedule</b>. A day marked <b>Changed</b> is different just for that day.`],
      ['🔒', 'Your account is yours', `Don't share your password, and never time in or out for someone else. Every time in/out is saved with the time and location.`],
    ].filter(Boolean);
    $('#gdList').innerHTML = items.map(([i, t, b]) => `<li><span class="gd-ico" aria-hidden="true">${i}</span><div><b>${t}</b><p>${b}</p></div></li>`).join('');
    const notes = (r.guideNotes || '').split('\n').filter(Boolean);
    $('#gdNotes').hidden = !notes.length;
    $('#gdNotes').innerHTML = notes.length ? `<b>📌 Important from your admin</b><ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    if (!$('#gdDlg').open) $('#gdDlg').showModal();
  }
  const closeGuide = () => { if (data) { try { localStorage.setItem(guideKey(), '1'); } catch {} } $('#gdDlg').close(); if (data) renderSchedule(); };
  if ($('#gdDlg')) { // (an old portal.html without the guide still works)
    $('#gdOk').onclick = closeGuide; $('#gdClose').onclick = closeGuide;
    $('#gdDlg').addEventListener('cancel', (e) => { e.preventDefault(); closeGuide(); });
    $('#gdOpen').onclick = () => { if (data) openGuide(); };
  }
  const addM = (t, mm) => { const x = (+t.slice(0, 2) * 60 + +t.slice(3) + (mm || 0)) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  function openNotes(list) {
    $('#ntTitle').textContent = list.some(n => !n.read) ? '🗓️ Schedule update' : '🔔 Notifications';
    $('#ntList').innerHTML = list.length ? list.map(n => `<div class="nt-item ${n.read ? '' : 'new'}"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${new Date(n.at).toLocaleString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div>`).join('') : '<p class="hint">No notifications yet.</p>';
    $('#ntDlg').showModal();
  }
  const markRead = async () => { $('#ntDlg').close(); if (!data?.mySchedule?.unread) return; try { await api('/api/staff/attendance', { method: 'POST', body: { action: 'read' } }); data.mySchedule.unread = 0; data.mySchedule.notifications.forEach(n => { n.read = true; }); $('#ptBellN').hidden = true; } catch {} };
  $('#ntOk').onclick = markRead; $('#ntClose').onclick = markRead;
  $('#ptBell').onclick = () => { if (data?.mySchedule) openNotes(data.mySchedule.notifications); };
  document.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => { sView = b.dataset.sv; document.querySelectorAll('[data-sv]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderSchedule(); });
  const shopAwake = () => { const W = data?.shop; if (!W) return true; const t = Date.now(); return W.some(w => t >= w.s - 30 * 60e3 && t < w.e + 30 * 60e3); }; // (30 min before opening / after closing)
  setInterval(() => { if (me && !document.hidden && !$('#vHome').hidden && !busy && shopAwake()) load(data?.month === data?.today?.slice(0, 7) ? undefined : data?.month); }, 180000); // new schedules show up without reloading

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
  // While this page is open (and location is already allowed), keep a fresh GPS fix ready, so tapping
  // Time in / out doesn't have to wait several seconds for the GPS to start.
  let fix = null, watchId = null;
  async function gpsWatch() {
    const want = navigator.geolocation && data && data.enabled && data.schedule?.track && !data.todayRow?.timeOut && !document.hidden && !$('#vHome').hidden;
    if (!want) { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } return; }
    if (watchId != null) return;
    try { const p = await navigator.permissions?.query({ name: 'geolocation' }); if (p && p.state !== 'granted') return; if (!p) return; } catch { return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition((p) => { fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }; }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }
  const getLocation = () => new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error("This browser can't share your location. Use Chrome or Safari."));
    if (fix && Date.now() - fix.at < 60000 && fix.accuracy <= 150) return ok({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }); // ready already
    navigator.geolocation.getCurrentPosition((p) => { fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }; ok({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }); },
      (e) => no(new Error(e.code === 1 ? 'Location is blocked. Allow location for this site (browser settings → Location → Allow), then try again.'
        : e.code === 3 ? "Couldn't get your location in time. Go near a window or turn on Wi-Fi/GPS, then try again." : "Couldn't get your location. Turn on Location/GPS and try again.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 });
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
      data.todayRow = r.row; render(); // show the new time right away; the full refresh follows in the background
      load(data.month === data.today.slice(0, 7) ? undefined : data.month);
    } catch (err) {
      note.textContent = err.message; note.classList.add('err');
      if (err.status === 409) load();
    }
    busy = false; b.disabled = false;
  };
  // back to the app after a while → refresh (times and statuses change)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me && !$('#vHome').hidden) load(); else gpsWatch(); });
  boot();
})();