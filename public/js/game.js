// "Pearl Catch": a little game to play while an order is being made.
// Move the cat's cup (drag, or ← → keys) to catch falling boba pearls. Golden pearls = +5.
// Dodge the chili peppers: 3 peppers and the round is over. It speeds up as you go.
// The top bar shows the live order status; when the order is ready, the game pauses and says so.
// Loaded only when someone taps "Play while you wait" (window.DDGame.open).
(() => {
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- window
  const dlg = document.createElement('dialog');
  dlg.className = 'game-dlg'; dlg.setAttribute('aria-label', 'Pearl Catch game');
  dlg.innerHTML = `
    <div class="g-top">
      <div class="g-status" id="gStatus">☕ Your order</div>
      <button class="g-ico" type="button" id="gSound" aria-label="Sound on/off">🔊</button>
      <button class="x" type="button" id="gClose" aria-label="Close game">×</button>
    </div>
    <div class="g-hud"><span>🧋 <b id="gScore">0</b></span><span id="gLives">❤️❤️❤️</span><span>Best <b id="gBest">0</b></span></div>
    <div class="g-stage"><canvas id="gCanvas"></canvas>
      <div class="g-card" id="gCard"></div>
    </div>
    <p class="g-help">Drag to move the cup · catch 🟤 pearls · ⭐ golden = +5 · dodge 🌶️</p>`;
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  const cv = $('#gCanvas'), ctx = cv.getContext('2d'), stage = $('.g-stage'), card = $('#gCard');

  // ---------- sound (tiny beeps, no files)
  let sound = ls.get('dd-game-sound', true), ac = null;
  const beep = (f, d = 0.08, type = 'sine', vol = 0.06) => {
    if (!sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
      o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
    } catch {}
  };
  const setSoundIcon = () => { $('#gSound').textContent = sound ? '🔊' : '🔇'; };
  $('#gSound').onclick = () => { sound = !sound; ls.set('dd-game-sound', sound); setSoundIcon(); };

  // ---------- sizing
  let W = 0, H = 0, dpr = 1;
  function size() {
    const r = stage.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(200, r.width); H = Math.max(260, r.height);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cup.y = H - 18; cup.x = Math.min(Math.max(cup.x || W / 2, cup.w / 2), W - cup.w / 2);
  }

  // ---------- game state
  const cup = { x: 0, y: 0, w: 70, tx: null, fill: 0 };
  let items = [], pops = [], score = 0, lives = 3, t = 0, spawnIn = 0, state = 'menu', last = 0, raf = 0, shake = 0;
  let best = ls.get('dd-game-best', 0);
  const hud = () => { $('#gScore').textContent = score; $('#gBest').textContent = best; $('#gLives').textContent = '❤️'.repeat(lives) + '🤍'.repeat(3 - lives); };
  const speed = () => 140 + Math.min(260, t * 5.5); // px/s, faster over time

  function spawn() {
    const r = Math.random(), kind = r < 0.06 ? 'gold' : r < 0.06 + Math.min(0.32, 0.14 + t * 0.004) ? 'chili' : 'pearl';
    items.push({ kind, x: 18 + Math.random() * (W - 36), y: -20, r: kind === 'chili' ? 13 : kind === 'gold' ? 11 : 10,
      vy: speed() * (0.85 + Math.random() * 0.35), rot: Math.random() * 6, spin: (Math.random() - 0.5) * 4, sway: Math.random() * 6 });
    spawnIn = Math.max(0.28, 0.85 - t * 0.012) * (0.7 + Math.random() * 0.6);
  }
  function start() {
    items = []; pops = []; score = 0; lives = 3; t = 0; spawnIn = 0.4; cup.fill = 0; state = 'play'; card.hidden = true; hud(); beep(660, 0.1);
  }
  function over() {
    state = 'over'; if (score > best) { best = score; ls.set('dd-game-best', best); }
    hud(); beep(220, 0.3, 'triangle', 0.08);
    showCard(`<b class="g-big">${score}</b><p>${score >= best && score > 0 ? '🏆 New best score!' : `Best: ${best}`}</p><p class="g-small">${score > 30 ? 'Barista-level reflexes! 🐾' : 'The cat believes in you. 🐱'}</p><button class="btn" type="button" data-g="play">Play again</button>`);
  }
  function showCard(html) { card.innerHTML = html; card.hidden = false; }
  card.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; if (b.dataset.g === 'play') start(); if (b.dataset.g === 'resume') { state = 'play'; card.hidden = true; } if (b.dataset.g === 'close') close(); });

  // ---------- controls
  const toX = (e) => { const r = cv.getBoundingClientRect(); return (e.clientX - r.left); };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture?.(e.pointerId); cup.tx = toX(e); });
  cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) cup.tx = toX(e); });
  const keys = new Set();
  dlg.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) { keys.add(e.key); e.preventDefault(); }
    if ((e.key === ' ' || e.key === 'Enter') && state !== 'play' && !card.hidden && card.querySelector('[data-g]')) { e.preventDefault(); card.querySelector('[data-g]').click(); }
  });
  dlg.addEventListener('keyup', (e) => keys.delete(e.key));

  // ---------- drawing
  function drawPearl(x, y, r, gold) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, gold ? '#fff3b0' : '#7a5236'); g.addColorStop(1, gold ? '#e0a400' : '#2d1a10');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    if (gold) { ctx.fillStyle = '#fff'; ctx.font = `${r}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★', x, y + 1); }
  }
  function drawChili(x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#e0352b'; ctx.beginPath(); ctx.moveTo(-r, -r * 0.3);
    ctx.quadraticCurveTo(0, -r * 0.9, r * 1.1, r * 0.6); ctx.quadraticCurveTo(0, r * 0.3, -r, r * 0.35); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-r * 0.2, -r * 0.25, r * 0.45, r * 0.12, -0.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#2f8f2f'; ctx.fillRect(-r * 1.25, -r * 0.25, r * 0.4, r * 0.5); ctx.restore();
  }
  function drawCup() {
    const { x, y, w } = cup, h = 58, top = y - h;
    // cat behind the rim
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.moveTo(x - w * 0.36, top + 4); ctx.lineTo(x - w * 0.3, top - 24); ctx.lineTo(x - w * 0.1, top - 10); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w * 0.36, top + 4); ctx.lineTo(x + w * 0.3, top - 24); ctx.lineTo(x + w * 0.1, top - 10); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, top - 2, w * 0.4, 18, 0, Math.PI, 0); ctx.fill();
    const blink = (performance.now() % 3200) < 140;
    ctx.fillStyle = '#FFF9E8';
    [-1, 1].forEach((s) => { ctx.beginPath(); ctx.ellipse(x + s * w * 0.15, top - 6, 4.5, blink ? 0.8 : 5, 0, 0, 7); ctx.fill(); });
    // cup body
    ctx.save(); ctx.beginPath(); ctx.moveTo(x - w / 2, top); ctx.lineTo(x + w / 2, top); ctx.lineTo(x + w / 2 - 8, y); ctx.lineTo(x - w / 2 + 8, y); ctx.closePath();
    ctx.fillStyle = '#FFFDF5'; ctx.fill(); ctx.clip();
    const lvl = top + h * (1 - Math.min(0.85, 0.2 + cup.fill * 0.012));
    ctx.fillStyle = '#9BCB6B'; ctx.fillRect(x - w, lvl, w * 2, h);
    for (let i = 0; i < Math.min(14, 2 + Math.floor(cup.fill / 3)); i++) drawPearl(x - w / 2 + 14 + ((i * 11) % (w - 26)), y - 7 - Math.floor(i / 5) * 8, 5, false);
    ctx.restore();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - w / 2, top); ctx.lineTo(x + w / 2, top); ctx.lineTo(x + w / 2 - 8, y); ctx.lineTo(x - w / 2 + 8, y); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.fillRect(x - w / 2 - 4, top - 4, w + 8, 7);
    // paws on the rim
    [-1, 1].forEach((s) => { ctx.beginPath(); ctx.ellipse(x + s * w * 0.28, top - 2, 7, 5, 0, 0, 7); ctx.fill(); });
  }
  function draw() {
    ctx.save();
    if (shake > 0 && !reduce) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.clearRect(-20, -20, W + 40, H + 40);
    // soft café background
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FFF6DE'); g.addColorStop(1, '#F3E7C6');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = 'rgba(6,107,35,.06)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc((i * 97 + (t * 8)) % (W + 60) - 30, 40 + (i * 53) % (H - 120), 18 + (i % 3) * 8, 0, 7); ctx.fill(); }
    for (const it of items) it.kind === 'chili' ? drawChili(it.x, it.y, it.r, it.rot) : drawPearl(it.x, it.y, it.r, it.kind === 'gold');
    drawCup();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of pops) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; ctx.font = '700 18px system-ui'; ctx.fillText(p.txt, p.x, p.y); }
    ctx.globalAlpha = 1; ctx.restore();
  }

  // ---------- loop
  function step(now) {
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (state === 'play') {
      t += dt;
      // move the cup
      const kd = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
      if (kd) { cup.tx = null; cup.x += kd * 420 * dt; } else if (cup.tx != null) cup.x += (cup.tx - cup.x) * Math.min(1, dt * 16);
      cup.x = Math.min(Math.max(cup.x, cup.w / 2), W - cup.w / 2);
      spawnIn -= dt; if (spawnIn <= 0) spawn();
      const top = cup.y - 58;
      for (const it of items) {
        it.y += it.vy * dt; it.rot += it.spin * dt; it.x += Math.sin(t * 2 + it.sway) * 12 * dt;
        if (!it.done && it.y + it.r >= top && it.y - it.r <= top + 14 && Math.abs(it.x - cup.x) < cup.w / 2 + it.r * 0.4) {
          it.done = true;
          if (it.kind === 'chili') {
            lives--; shake = 10; beep(140, 0.25, 'square', 0.05); navigator.vibrate?.(80);
            pops.push({ x: it.x, y: top - 10, txt: '🌶️ Spicy!', c: '#e0352b', life: 1 });
            if (lives <= 0) { hud(); over(); }
          } else {
            const n = it.kind === 'gold' ? 5 : 1; score += n; cup.fill += n;
            beep(it.kind === 'gold' ? 1046 : 520 + Math.min(400, score * 6), 0.07);
            pops.push({ x: it.x, y: top - 10, txt: `+${n}`, c: it.kind === 'gold' ? '#c98a00' : '#066B23', life: 1 });
          }
          hud();
        }
      }
      items = items.filter((it) => !it.done && it.y < H + 30);
    }
    for (const p of pops) { p.y -= 40 * dt; p.life -= dt * 1.4; }
    pops = pops.filter((p) => p.life > 0); shake = Math.max(0, shake - dt * 40);
    draw();
  }

  // ---------- live order status
  let getOrder = null, statusTimer = 0, toldReady = false;
  const LABEL = { new: '📝 Order received', making: '☕ Being made…', ready: '🎉 Ready for pickup!', delivering: '🛵 On the way!', done: '✅ Done', cancelled: 'Cancelled' };
  function checkStatus() {
    const o = getOrder?.(); if (!o) return;
    $('#gStatus').innerHTML = `<b>#${String(o.code || '').replace(/[<>&"]/g, '')}</b> ${LABEL[o.status] || 'Checking…'}`;
    $('#gStatus').className = `g-status ${o.status === 'ready' || o.status === 'delivering' ? 'hot' : ''}`;
    if (!toldReady && (o.status === 'ready' || o.status === 'delivering')) {
      toldReady = true; if (state === 'play') state = 'paused';
      beep(784, 0.12); setTimeout(() => beep(1046, 0.18), 140); navigator.vibrate?.([120, 80, 120]);
      showCard(`<b class="g-big">🎉</b><p><b>${o.status === 'ready' ? 'Your order is ready for pickup!' : 'Your order is on the way!'}</b></p><p class="g-small">Score so far: ${score}</p>
        <button class="btn" type="button" data-g="close">${o.status === 'ready' ? 'Go get it' : 'OK'}</button><button class="btn ghost" type="button" data-g="${score && lives > 0 ? 'resume' : 'play'}">Keep playing</button>`);
    }
  }

  function close() { state = state === 'play' ? 'paused' : state; cancelAnimationFrame(raf); clearInterval(statusTimer); dlg.close(); }
  $('#gClose').onclick = close;
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') { state = 'paused'; showCard(`<p><b>Paused</b></p><button class="btn" type="button" data-g="resume">Resume</button>`); } });
  addEventListener('resize', () => { if (dlg.open) size(); });

  window.DDGame = {
    open(order) {
      getOrder = order; toldReady = false;
      const o = getOrder?.(); toldReady = !!o && (o.status === 'ready' || o.status === 'delivering'); // already ready: don't interrupt
      dlg.showModal(); setSoundIcon(); size(); hud(); checkStatus();
      if (state === 'paused' && lives > 0 && score) showCard(`<p><b>Welcome back!</b></p><p class="g-small">Score: ${score}</p><button class="btn" type="button" data-g="resume">Resume</button><button class="btn ghost" type="button" data-g="play">New game</button>`);
      else if (state !== 'play') showCard(`<b class="g-big">🧋</b><p><b>Pearl Catch</b></p><p class="g-small">Drag the cat's cup to catch the boba pearls.<br>⭐ Golden pearl = +5 · 🌶️ 3 chilis and it's over!</p><button class="btn" type="button" data-g="play">Play</button>`);
      last = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
      clearInterval(statusTimer); statusTimer = setInterval(checkStatus, 1000);
    },
  };
})();