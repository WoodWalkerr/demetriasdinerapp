// Demetria's Diner: animations, menu and online ordering.
(() => {
  // ---------- helpers ----------
  const wave = (x0, y, w, period, amp, bottom = 460) => {
    let d = `M${x0} ${y}`;
    for (let x = x0; x < x0 + w; x += period) {
      d += ` Q${x + period / 4} ${y - amp} ${x + period / 2} ${y} Q${x + period * 3 / 4} ${y + amp} ${x + period} ${y}`;
    }
    return d + ` L${x0 + w} ${bottom} L${x0} ${bottom} Z`;
  };

  // ---------- hero cup ----------
  document.getElementById('w1').setAttribute('d', wave(80, 182, 480, 80, 9));
  document.getElementById('w2').setAttribute('d', wave(80, 190, 480, 80, 7));
  document.getElementById('w3').setAttribute('d', wave(80, 300, 480, 160, 14));
  const boba = document.getElementById('boba');
  const bp = [[160,375],[182,380],[204,377],[226,381],[248,374],[171,358],[194,362],[216,360],[238,357],[150,360],[205,344],[183,346]];
  boba.innerHTML = bp.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="10"/>`).join('');
  const bub = document.getElementById('bubbles');
  bub.innerHTML = Array.from({length:9},(_,i)=>`<circle class="bubble" cx="${150+i*13}" cy="${380 - (i%3)*12}" r="${2+(i%3)}" style="animation-delay:${-i*0.45}s;animation-duration:${3+(i%4)*.6}s"/>`).join('');

  const modes = {
    matcha:  {c1:'#6BA436', c2:'#F09AA8', blob:'#CFE3A8', straw:'#111111', name:'Strawberry Matcha', price:'₱149', note:'From our G-Matcha line. Served over ice.'},
    coffee:  {c1:'#8B5A3C', c2:'#F1E4CF', blob:'#E9D3B4', straw:'#066B23', name:'Iced Spanish Latte', price:'₱119', note:'From our Iced Coffee line.'},
    milktea: {c1:'#B98756', c2:'#6B3E1F', blob:'#EBCFAF', straw:'#111111', name:'Okinawa Boba', price:'₱119', note:'Boba tea with chewy pearls.'}
  };
  const hero = document.getElementById('hero'), stage = document.getElementById('stage');
  const sws = [...document.querySelectorAll('.switch button')];
  let auto = true;
  const setMode = (m) => {
    const d = modes[m]; hero.dataset.mode = m;
    stage.style.setProperty('--c1', d.c1); stage.style.setProperty('--c2', d.c2);
    stage.style.setProperty('--blob', d.blob); stage.style.setProperty('--straw', d.straw);
    document.getElementById('now-name').textContent = d.name;
    document.getElementById('now-price').textContent = d.price;
    document.getElementById('now-note').textContent = d.note;
    sws.forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
  };
  sws.forEach(b => b.addEventListener('click', () => { auto = false; setMode(b.dataset.mode); }));
  const order = ['matcha','coffee','milktea']; let mi = 0;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    setInterval(() => { if (auto) setMode(order[mi = (mi + 1) % 3]); }, 5000);

  // ---------- marquee ----------
  const words = ['Spanish Latte','G-Matcha','Okinawa Boba','Biscoff Matcha','Fruit Soda','Pork Sisig','Tocilog','Cheese Burger Deluxe'];
  const row = words.map(w => `<span>${w}</span><span class="s">✳</span>`).join('');
  document.getElementById('marq').innerHTML = row + row;

  // ---------- menu art (drawn in code, coloured per drink) ----------
  let cupN = 0;
  const cup = (c1, c2, opt = {}) => {
    const id = 'mc' + (cupN++);
    const shape = 'M24 34 H96 L88 140 Q87 147 80 147 H40 Q33 147 32 140 Z';
    const bob = opt.boba ? [[44,136],[56,139],[68,137],[80,135],[50,126],[62,128],[74,125]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="5.5" fill="#2B1A12"/>`).join('') : '';
    const foam = opt.foam ? `<rect x="0" y="52" width="120" height="16" fill="#F7EEDD"/>` : '';
    const fizz = opt.soda ? [[42,130],[58,138],[74,126],[50,112],[68,104],[80,118],[46,92]].map(([x,y],i)=>`<circle class="m-fizz" cx="${x}" cy="${y}" r="${2+i%3}" style="animation-delay:${-i*.4}s"/>`).join('') : '';
    return `<svg viewBox="0 0 120 155" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs>
      <rect class="m-straw" x="66" y="2" width="8" height="100" rx="4" fill="${opt.straw||'#111111'}" transform="rotate(10 70 50)"/>
      <g clip-path="url(#${id})"><g class="m-liq">
        <path class="m-wave" d="${wave(20,58,280,40,4,170)}" fill="${c1}"/>
        ${opt.soda ? '' : `<path class="m-swirl" d="${wave(20,104,280,80,7,170)}" fill="${c2}"/>`}
        ${foam}${bob}${fizz}
      </g>
      <rect x="40" y="70" width="18" height="18" rx="4" fill="#fff" fill-opacity=".3" stroke="#fff" stroke-opacity=".7"/>
      <rect x="62" y="80" width="16" height="16" rx="4" fill="#fff" fill-opacity=".3" stroke="#fff" stroke-opacity=".7"/></g>
      <path class="m-glass" d="${shape}"/><path class="m-glass" d="M18 34 H102" stroke-linecap="round"/>
    </svg>`;
  };
  const K = 'stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"';
  const rice = `<path d="M18 108 Q18 70 46 70 Q74 70 74 108 Z" fill="#FBF8F0" ${K}/><path d="M30 86 h3 M44 80 h3 M56 90 h3 M38 98 h3" stroke="#D8D2C2" stroke-width="2" stroke-linecap="round"/>`;
  const egg = `<path d="M70 94 Q66 76 86 76 Q106 74 104 92 Q104 108 86 108 Q72 108 70 94Z" fill="#FFFFFF" ${K}/><circle cx="87" cy="91" r="8" fill="#F6B21B"/>`;
  const silog = (meat) => rice + egg + meat;
  const foods = {
    bacon:  silog(`<path d="M24 114 q12 -8 24 0 t24 0 t24 0 v8 q-12 -8 -24 0 t-24 0 t-24 0z" fill="#B4442E" ${K}/><path d="M28 118 q10 -6 20 0 t24 0 t20 0" stroke="#F3C7B4" stroke-width="2" fill="none"/>`),
    ham:    silog(`<ellipse cx="54" cy="116" rx="30" ry="9" fill="#F28C9B" ${K}/><ellipse cx="54" cy="114" rx="20" ry="5" fill="#F7B3BE"/>`),
    tocino: silog(`<path d="M26 112 h56 q6 0 6 6 q0 6 -6 6 h-56 q-6 0 -6 -6 q0 -6 6 -6z" fill="#D2463A" ${K}/><path d="M32 118 h44" stroke="#F08A7E" stroke-width="2"/>`),
    hotdog: silog(`<rect x="22" y="110" width="64" height="14" rx="7" fill="#C8372D" ${K}/><path d="M32 113 l6 8 M46 113 l6 8 M60 113 l6 8" stroke="#E87368" stroke-width="2"/>`),
    corned: silog(`<path d="M24 120 q6 -12 18 -8 q8 -10 20 -2 q14 -6 22 8 q-30 10 -60 2z" fill="#9C4A3A" ${K}/><path d="M36 116 l4 2 M54 112 l3 3 M68 116 l4 1" stroke="#D88C78" stroke-width="2"/>`),
    sisig: `<ellipse cx="60" cy="104" rx="52" ry="22" fill="#2A2A2A" ${K}/><ellipse cx="60" cy="100" rx="42" ry="15" fill="#7A3A22"/>
      <path d="M32 98 l6 -3 M44 106 l7 1 M70 106 l6 -2 M84 98 l5 3 M50 94 l5 -2 M74 94 l6 1" stroke="#C26A3D" stroke-width="4" stroke-linecap="round"/>
      <circle cx="60" cy="98" r="9" fill="#F6B21B" ${K}/><circle cx="40" cy="104" r="3" fill="none" stroke="#6BA436" stroke-width="2"/><circle cx="80" cy="104" r="3" fill="none" stroke="#C8372D" stroke-width="2"/>
      <path class="sizzle" d="M38 74 q-5 -7 0 -14 M60 70 q-5 -7 0 -14 M82 74 q-5 -7 0 -14" fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round"/>`,
    burger: `<path d="M22 78 Q24 44 60 44 Q96 44 98 78 Z" fill="#E1A35B" ${K}/><path d="M40 56 l3 -2 M58 52 l3 -2 M76 58 l3 -2" stroke="#FFF3D6" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M18 82 q8 -8 16 0 t16 0 t16 0 t16 0 t16 0 v4 H18z" fill="#6BA436" ${K}/><path d="M22 86 H98 L84 98 L74 88 L22 92Z" fill="#F6C443" ${K}/>
      <rect x="20" y="90" width="80" height="14" rx="7" fill="#6B3A22" ${K}/><path d="M22 106 H98 Q98 120 84 120 H36 Q22 120 22 106Z" fill="#E1A35B" ${K}/>`,
    sandwich: `<path d="M16 112 L60 50 L104 112 Z" fill="#D99B4E" ${K}/><path d="M28 106 L60 62 L92 106 Z" fill="#F6E1B5"/><path d="M34 100 L60 66 L86 100 Z" fill="#F28C9B"/><path d="M42 98 L60 74 L78 98Z" fill="#F6C443"/>
      <path d="M36 112 l4 -4 M56 112 l4 -4 M76 112 l4 -4" stroke="#A9692A" stroke-width="2"/>`,
    chicken: `<path d="M30 104 Q14 84 30 66 Q48 52 62 70 Q72 86 56 104 Z" fill="#C9792E" ${K}/><path d="M56 102 L68 114" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/><circle cx="70" cy="117" r="5" fill="#FFF" ${K}/>
      <path d="M62 96 Q50 74 70 60 Q90 50 100 70 Q106 88 86 102 Z" fill="#D98A3A" ${K}/><path d="M86 100 L96 116" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/><circle cx="97" cy="119" r="5" fill="#FFF" ${K}/>
      <path d="M34 78 l4 3 M44 70 l3 4 M76 70 l4 2 M84 80 l3 3" stroke="#A55A1E" stroke-width="2" stroke-linecap="round"/>`,
    pops: [[36,100],[54,108],[72,102],[88,108],[46,86],[64,88],[80,86],[58,72]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="11" fill="#D98A3A" ${K}/><path d="M${x-4} ${y-3} l3 2" stroke="#A55A1E" stroke-width="2"/>`).join(''),
    strips: [[20,96,-18],[34,104,-6],[50,98,8],[64,106,-10],[46,84,14]].map(([x,y,r])=>`<rect x="${x}" y="${y}" width="52" height="14" rx="7" fill="#D98A3A" ${K} transform="rotate(${r} ${x+26} ${y+7})"/>`).join(''),
    fries: `<path d="M38 60 l4 40 M48 52 l2 48 M58 56 l1 44 M68 50 l-1 50 M78 58 l-3 42 M86 64 l-5 36" stroke="#F6C443" stroke-width="8" stroke-linecap="round"/>
      <path d="M30 76 H90 L82 122 H38 Z" fill="#C8372D" ${K}/><path d="M46 90 q14 10 28 0" stroke="#FFF" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    carbonara: `<path d="M16 88 H104 Q100 122 60 122 Q20 122 16 88Z" fill="var(--card)" ${K}/><path d="M24 88 q8 -14 16 -2 t16 -4 t16 4 t16 -6 t10 8" fill="#F3E0A8" ${K}/>
      <path d="M30 82 q10 -10 18 0 M56 78 q10 -10 18 0 M42 74 q8 -8 16 0" stroke="#E2C77E" stroke-width="3" fill="none"/><rect x="48" y="70" width="8" height="5" rx="2" fill="#C26A3D"/><rect x="68" y="74" width="8" height="5" rx="2" fill="#C26A3D"/>`,
    spaghetti: `<path d="M16 88 H104 Q100 122 60 122 Q20 122 16 88Z" fill="var(--card)" ${K}/><path d="M24 88 q8 -14 16 -2 t16 -4 t16 4 t16 -6 t10 8" fill="#F3E0A8" ${K}/>
      <path d="M30 86 Q34 64 60 64 Q86 64 90 86 Z" fill="#C7372F" ${K}/><circle cx="50" cy="76" r="5" fill="#8C2A1E"/><circle cx="70" cy="74" r="5" fill="#8C2A1E"/><path d="M58 64 l4 -6" stroke="#6BA436" stroke-width="3" stroke-linecap="round"/>`,
  };
  const food = (k) => `<svg viewBox="0 0 120 155" aria-hidden="true"><ellipse cx="60" cy="128" rx="54" ry="12" class="plate"/><g class="food">${foods[k]}</g></svg>`;
  const M = '#5E9A2E', MILK_C = '#F4ECE0';

  // Names and prices must match lib/menu.js (the server price list). Prices here are only a fallback.
  const menu = [
    // Boba Tea
    {c:'boba', n:'Taro', p:119, art:()=>cup('#B79AD0','#E6DAF2',{boba:true})},
    {c:'boba', n:'Thai', p:119, art:()=>cup('#E2873B','#F4E1C6',{boba:true})},
    {c:'boba', n:'Mango Cheesecake', p:119, art:()=>cup('#F2B33D','#FBEFD2',{boba:true,foam:true})},
    {c:'boba', n:'Choco', p:119, art:()=>cup('#6B4226','#A0714F',{boba:true})},
    {c:'boba', n:'Dark Choco', p:119, art:()=>cup('#3B2416','#5A3826',{boba:true})},
    {c:'boba', n:'Choco Hazelnut', p:119, art:()=>cup('#6E4A2E','#B48A5C',{boba:true})},
    {c:'boba', n:'Red Velvet', p:119, art:()=>cup('#B3263A','#F2E3DA',{boba:true})},
    {c:'boba', n:'Wintermelon', p:119, art:()=>cup('#C9A46C','#EADBB8',{boba:true})},
    {c:'boba', n:'Okinawa', p:119, art:()=>cup('#B98756','#6B3E1F',{boba:true}), tag:'Bestseller'},
    {c:'boba', n:'Cookies & Cream', p:119, art:()=>cup('#E8E2D8','#4A4440',{boba:true})},
    // G-Matcha
    {c:'matcha', n:'Kiwi Matcha', p:149, art:()=>cup(M,'#9BCF53')},
    {c:'matcha', n:'Mango Matcha', p:149, art:()=>cup(M,'#F5B83D')},
    {c:'matcha', n:'Taro Matcha', p:149, art:()=>cup(M,'#B79AD0')},
    {c:'matcha', n:'Strawberry Matcha', p:149, art:()=>cup(M,'#F09AA8',{straw:'#C9485B'}), tag:'Bestseller'},
    {c:'matcha', n:'Orange Matcha', p:149, art:()=>cup(M,'#F39A3A')},
    {c:'matcha', also:['favorite'], n:'Hazel Matcha', p:149, art:()=>cup(M,'#B07A4F'), tag:"Diner's favorite"},
    // Diner's Favorite
    {c:'favorite', n:"Bisco' Latte", p:149, art:()=>cup('#B5743B','#EAD3B0',{foam:true})},
    {c:'favorite', n:'Biscoff Matcha', p:149, art:()=>cup(M,'#B5743B')},
    {c:'favorite', n:'Thai Biscoff', p:149, art:()=>cup('#E2873B','#B5743B')},
    {c:'favorite', n:'Thai Cocoa', p:149, art:()=>cup('#E2873B','#5A3826')},
    {c:'favorite', n:'Taro Cocoa', p:149, art:()=>cup('#B79AD0','#5A3826')},
    // Fruit Latte
    {c:'fruitlatte', n:'Strawberry Latte', p:119, art:()=>cup(MILK_C,'#E0566B',{straw:'#C9485B'})},
    {c:'fruitlatte', n:'Blueberry Latte', p:119, art:()=>cup(MILK_C,'#5B5BB5',{straw:'#3E3E8F'})},
    {c:'fruitlatte', n:'Mango Latte', p:119, art:()=>cup(MILK_C,'#F5B83D',{straw:'#D98A1E'})},
    // Fruit Soda
    {c:'soda', n:'Strawberry Soda', p:99, art:()=>cup('#F07A8C',null,{soda:true,straw:'#C9485B'})},
    {c:'soda', n:'Green Apple Soda', p:99, art:()=>cup('#9BD35A',null,{soda:true,straw:'#4F8A1E'})},
    {c:'soda', n:'Blueberry Soda', p:99, art:()=>cup('#7C7CE0',null,{soda:true,straw:'#3E3E8F'})},
    {c:'soda', n:'Kiwi Soda', p:99, art:()=>cup('#8CC63F',null,{soda:true,straw:'#4F8A1E'})},
    {c:'soda', n:'Mango Soda', p:99, art:()=>cup('#FFC43D',null,{soda:true,straw:'#D98A1E'})},
    {c:'soda', n:'Orange Soda', p:99, art:()=>cup('#FF9A3C',null,{soda:true,straw:'#D9661E'})},
    // Food Classics (no prices on the menu board yet: see lib/menu.js)
    {c:'food', n:'Pork Sisig', p:null, art:()=>food('sisig'), tag:'Sizzling'},
    {c:'food', n:'Bacon Silog', p:null, art:()=>food('bacon')},
    {c:'food', n:'Hamsilog', p:null, art:()=>food('ham')},
    {c:'food', n:'Tocilog', p:null, art:()=>food('tocino')},
    {c:'food', n:'Hotsilog', p:null, art:()=>food('hotdog')},
    {c:'food', n:'Cornsilog', p:null, art:()=>food('corned')},
    {c:'food', n:'Chicken Wings', p:null, art:()=>food('chicken')},
    {c:'food', n:'Cheese Burger Deluxe', p:null, art:()=>food('burger')},
    {c:'food', n:'Carroza Sandwich', p:null, art:()=>food('sandwich')},
    {c:'food', n:'Chicken Pops', p:null, art:()=>food('pops')},
    {c:'food', n:'Chicken Fingers', p:null, art:()=>food('strips')},
    {c:'food', n:'Fries', p:null, art:()=>food('fries')},
    {c:'food', n:'Carbonara', p:null, art:()=>food('carbonara')},
    {c:'food', n:'Spaghetti', p:null, art:()=>food('spaghetti')},
    {c:'food', n:'Chicken Alamax', p:null, art:()=>food('chicken')},
    {c:'food', n:'Chicken Snake', p:null, art:()=>food('strips')},
  ];
  // =====================================================================
  // MENU + ONLINE ORDERING  (talks to /api; see README)
  //   Products, prices, stock and add-ons come from the server (edited in /staff → Products).
  //   The list above only supplies each item's picture and tag.
  // =====================================================================
  const $ = (q) => document.querySelector(q);
  const money = (n) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  const pesos = (c) => money(c / 100);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: r.status });
    return data;
  };
  let toastT;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3400); };
  const fmtTime = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ---------- catalog ----------
  // Category names come from the server; these are only used until it answers.
  let CAT_LABEL = { hotcoffee: 'Hot Coffee', icedcoffee: 'Iced Coffee', orange: 'Orange District', pistachio: 'Pistachio Infusion', matcha: 'G-Matcha', favorite: "Diner's Favorite",
    boba: 'Boba Tea', fruitlatte: 'Fruit Latte', soda: 'Fruit Soda', silog: 'Silog Meals', snacks: 'Snacks', food: 'Meals', pastries: 'Pastries', others: 'Others' };
  const ART = Object.fromEntries(menu.map(m => [slug(m.n), m]));
  const FOOD_CATS = ['silog', 'snacks', 'food', 'pastries'];
  const kindOf = (cat) => (FOOD_CATS.includes(cat) ? 'food' : cat === 'others' ? 'plain' : 'drink');
  const groupsFor = (cat) => ({ food: ['food', 'packaging'], drink: ['drink', 'packaging'], plain: [] })[kindOf(cat)];
  const GROUP_LABEL = { drink: 'Add-ons', food: 'Add-ons', packaging: 'Packaging' };

  // Extra drawings for the newer menu items (hot coffee, pastries, drinks in bottles, snacks).
  function mug(c1) {
    return `<svg viewBox="0 0 120 155" aria-hidden="true">
      <g class="steam"><path d="M46 40 q-8 -10 0 -20 q8 -10 0 -20"/><path d="M62 40 q-8 -10 0 -20 q8 -10 0 -20"/><path d="M78 40 q-8 -10 0 -20 q8 -10 0 -20"/></g>
      <ellipse cx="62" cy="140" rx="52" ry="9" class="plate"/>
      <path d="M92 74 q22 0 22 20 t-24 22" fill="none" stroke="var(--ink)" stroke-width="2.5"/>
      <path class="mug" d="M26 56 H98 V112 Q98 136 74 136 H50 Q26 136 26 112 Z"/>
      <ellipse cx="62" cy="58" rx="33" ry="7" fill="${c1}"/>
      <path d="M50 58 q12 -6 24 0" fill="none" stroke="#F4ECDD" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }
  function canSvg(c) { return `<rect x="40" y="46" width="40" height="74" rx="8" fill="${c}" ${K}/><rect x="40" y="70" width="40" height="22" fill="#FFF9E8" opacity=".9"/><rect x="46" y="40" width="28" height="8" rx="3" fill="#B8B8B8" ${K}/>`; }
  Object.assign(foods, {
    cookie: `<circle cx="60" cy="90" r="34" fill="#C98A4B" ${K}/><circle cx="48" cy="80" r="4" fill="#4A2A16"/><circle cx="68" cy="76" r="3.5" fill="#4A2A16"/><circle cx="72" cy="98" r="4" fill="#4A2A16"/><circle cx="52" cy="102" r="3.5" fill="#4A2A16"/><circle cx="60" cy="90" r="3" fill="#4A2A16"/>`,
    cake: `<path d="M18 80 L100 58 V112 L18 122 Z" fill="#FFF4D6" ${K}/><path d="M18 80 L100 58 L100 70 L18 94 Z" fill="#E9C66B"/><path d="M18 80 L100 58 L84 48 L18 70Z" fill="#F6E7B8" ${K}/><path d="M18 112 L100 102" stroke="#C98A4B" stroke-width="5"/>`,
    brownie: `<rect x="26" y="66" width="68" height="50" rx="8" fill="#5A3420" ${K}/><path d="M34 70 q8 -8 16 0 t16 0 t16 0" stroke="#7A4A2E" stroke-width="3" fill="none"/><circle cx="46" cy="64" r="6" fill="#FFF9E8" ${K}/><circle cx="72" cy="62" r="6" fill="#FFF9E8" ${K}/>`,
    loaf: `<path d="M18 112 V82 Q18 58 60 58 Q102 58 102 82 V112 Z" fill="#8A5530" ${K}/><path d="M30 76 q10 -8 20 0 M58 72 q10 -8 20 0" stroke="#5A3420" stroke-width="3" fill="none"/><circle cx="46" cy="94" r="3" fill="#3B2416"/><circle cx="72" cy="98" r="3" fill="#3B2416"/>`,
    roll: `<circle cx="60" cy="90" r="32" fill="#D99B4E" ${K}/><path d="M60 90 m-6 0 a6 6 0 1 1 12 0 a12 12 0 1 1 -24 0 a18 18 0 1 1 36 0 a24 24 0 1 1 -48 0" fill="none" stroke="#8A5530" stroke-width="3"/><path d="M40 70 q20 -12 40 0" stroke="#FFF9E8" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    muffin: `<path d="M34 92 L42 120 H78 L86 92 Z" fill="#B87333" ${K}/><path d="M40 98 v20 M52 98 v20 M64 98 v20 M76 98 v20" stroke="#8A5530" stroke-width="2"/><path d="M28 92 Q28 60 60 60 Q92 60 92 92 Z" fill="#5A3420" ${K}/><circle cx="50" cy="76" r="3" fill="#2B1A10"/><circle cx="68" cy="72" r="3" fill="#2B1A10"/>`,
    canRed: canSvg('#C8102E'), canGreen: canSvg('#1E9E4A'),
    bottle: `<path d="M50 30 h20 v14 q14 8 14 22 v52 q0 6 -6 6 h-36 q-6 0 -6 -6 v-52 q0 -14 14 -22 z" fill="#CFE8F5" ${K}/><rect x="48" y="24" width="24" height="8" rx="2" fill="#2B7BB9" ${K}/><rect x="40" y="76" width="40" height="22" fill="#2B7BB9" opacity=".8"/>`,
    sauce: `<path d="M38 86 h44 l-6 30 h-32 z" fill="#FFF9E8" ${K}/><ellipse cx="60" cy="86" rx="22" ry="6" fill="#C8372D" ${K}/>`,
    box: `<path d="M24 76 L60 62 L96 76 V112 L60 124 L24 112 Z" fill="#E7D3AE" ${K}/><path d="M24 76 L60 90 L96 76 M60 90 V124" fill="none" stroke="var(--ink)" stroke-width="2.5"/>`,
    chicksilog: silog(`<path d="M24 108 Q20 96 34 92 Q48 88 60 98 Q70 108 56 118 Q40 124 24 108Z" fill="#D98A3A" ${K}/><path d="M56 112 L68 120" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
    chorizo: silog(`<rect x="22" y="110" width="30" height="12" rx="6" fill="#A8322A" ${K}/><rect x="54" y="110" width="30" height="12" rx="6" fill="#A8322A" ${K}/>`),
  });
  const PIST = '#A8C97F';
  /** Picks a drawing from the item's category and name, so new products get a fitting picture automatically. */
  function autoArt(it) {
    const n = it.name.toLowerCase();
    switch (it.cat) {
      case 'hotcoffee': return mug(/choco/.test(n) ? '#5A3420' : /americano/.test(n) ? '#2E1A10' : '#8B5A3C');
      case 'icedcoffee':
        if (/americano/.test(n)) return cup('#2E1A10', '#3A2214');
        if (/mocha/.test(n)) return cup('#5A3420', '#B07A4F');
        if (/caramel/.test(n)) return cup('#6B3F22', '#D9A441', { foam: true });
        if (/cinnamon/.test(n)) return cup('#8B5A3C', '#D9A066');
        if (/cappuccino/.test(n)) return cup('#7A5034', '#E8D6BB', { foam: true });
        if (/hazelnut/.test(n)) return cup('#6E4A2E', '#B48A5C');
        return cup('#8B5A3C', '#F1E4CF');
      case 'orange':
        if (/cocoa/.test(n)) return cup('#5A3826', '#F08A24', { straw: '#F08A24' });
        if (/matcha/.test(n)) return cup(M, '#F39A3A', { straw: '#F08A24' });
        return cup('#2E1A10', '#F08A24', { straw: '#F08A24' });
      case 'pistachio':
        if (/violet/.test(n)) return cup('#8E6BBF', PIST, { foam: true });
        if (/mango/.test(n)) return cup('#F5B83D', PIST, { foam: true });
        if (/matcha/.test(n)) return cup(M, '#DCEBC0', { foam: true });
        if (/thai/.test(n)) return cup('#E2873B', PIST, { foam: true });
        if (/biscoff/.test(n)) return cup('#B5743B', PIST, { foam: true });
        return cup('#5A3420', PIST, { foam: true });
      case 'matcha':
        if (/dirty/.test(n)) return cup('#3E2716', M);
        if (/caramel/.test(n)) return cup(M, '#D9A441');
        return cup(M, '#F1E4CF');
      case 'favorite': return /tiramisu/.test(n) ? cup('#B5743B', '#6B4226', { foam: true }) : /taro/.test(n) ? cup('#B79AD0', '#B5743B') : cup('#B5743B', '#EAD3B0', { foam: true });
      case 'boba': return cup('#B98756', '#E6D3BC', { boba: true });
      case 'fruitlatte': return cup(MILK_C, '#E0566B');
      case 'soda': return cup('#FF9A3C', null, { soda: true });
      case 'silog':
        if (/bacon/.test(n)) return food('bacon');
        if (/ham/.test(n)) return food('ham');
        if (/hot/.test(n)) return food('hotdog');
        if (/corn/.test(n)) return food('corned');
        if (/cho/.test(n)) return food('chorizo');
        if (/chick/.test(n) && !/toci/.test(n)) return food('chicksilog');
        return food('tocino');
      case 'snacks': case 'food':
        if (/sisig/.test(n)) return food('sisig');
        if (/burger/.test(n)) return food('burger');
        if (/fries/.test(n)) return food('fries');
        if (/finger|snake/.test(n)) return food('strips');
        if (/pops|bundle/.test(n)) return food('pops');
        if (/cookie/.test(n)) return food('cookie');
        if (/carbonara/.test(n)) return food('carbonara');
        if (/spaghetti/.test(n)) return food('spaghetti');
        if (/wing|ala ?max|alamax/.test(n)) return food('chicken');
        return food('sandwich');
      case 'pastries':
        if (/cheesecake|sponge|cake/.test(n)) return food('cake');
        if (/brownie/.test(n)) return food('brownie');
        if (/loaf|banana slice/.test(n)) return food('loaf');
        if (/roll/.test(n)) return food('roll');
        if (/muffin/.test(n)) return food('muffin');
        if (/sandwich/.test(n)) return food('sandwich');
        return food('cookie');
      case 'others':
        if (/coke/.test(n)) return food('canRed');
        if (/sprite/.test(n)) return food('canGreen');
        if (/water|minerale/.test(n)) return food('bottle');
        if (/sauce/.test(n)) return food('sauce');
        if (/box/.test(n)) return food('box');
        return food('box');
      default: return cup('#8B5A3C', '#F1E4CF');
    }
  }

  // Until the server answers, show the menu from the built-in list so the page is never empty.
  let cat = {
    items: menu.map((m, i) => ({ id: slug(m.n), cat: m.c, name: m.n, price: m.p == null ? null : m.p * 100, sort: i, soldOut: false, left: null })),
    addons: [], payments: { counter: true }, delivery: { enabled: false }, accepting: true, v: null, build: null,
  };
  let byId = Object.fromEntries(cat.items.map(i => [i.id, i]));
  let addonById = {};
  let apiState = 'loading';

  const grid = document.getElementById('grid');
  let filter = 'all', bogoFilter = []; // bogoFilter: items shown by a promo code's "Show me" 
  // A real photo (uploaded in /staff → Products) wins; otherwise the drawing.
  const artFor = (it) => { if (it.img) return `<img class="photo" src="${esc(it.img)}" alt="${esc(it.name)}" loading="lazy" decoding="async">`; const a = ART[it.id]; return a && a.c === it.cat ? a.art() : autoArt(it); };
  const forSale = () => cat.items.filter(it => it.price != null); // items without a selling price stay hidden
  function renderFilters() {
    const used = new Set(forSale().map(it => it.cat));
    const cats = Object.entries(CAT_LABEL).filter(([k]) => used.has(k));
    const hasDeals = !!(cat.deals?.length && dealsAt().length); // cat.deals arrives with the menu, after the helpers exist
    if (filter !== 'all' && filter !== 'bogo' && !used.has(filter) && !(filter.startsWith('deal') && hasDeals)) filter = 'all';
    $('.filters').innerHTML = `<button type="button" data-f="all" aria-pressed="${filter === 'all'}">All</button>` +
      (hasDeals ? `<button type="button" data-f="deals" class="f-deal" aria-pressed="${filter.startsWith('deal')}">🎉 Buy 1 Take 1</button>` : '') +
      cats.map(([k, v]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${esc(v)}</button>`).join('');
  }
  document.querySelector('.filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; renderFilters(); render(); });
  function render() {
    const inDeal = (it) => filter === 'deals' ? !!dealFor(it) : filter.startsWith('deal:') ? !!dealsAt().find(d => d.id === filter.slice(5) && d.productIds.includes(it.id)) : false;
    const list = forSale().filter(it => filter === 'all' || it.cat === filter || inDeal(it) || (filter === 'bogo' && bogoFilter.includes(it.id)) || (filter === 'favorite' && ART[it.id]?.also?.includes('favorite')));
    grid.innerHTML = list.map((it, i) => {
      const pr = promoFor(it), dl = cat.deals ? dealFor(it) : null;
      const tag = dl ? 'Buy 1 Take 1' : pr ? `${pr.promo.name} −${pr.promo.pct}%` : ART[it.id]?.tag;
      const counterOnly = it.price == null;
      const label = it.soldOut ? 'Sold out' : counterOnly ? 'Order at counter' : 'Add +';
      return `
      <article class="card in${it.soldOut ? ' sold' : ''}${it.img ? ' has-photo' : ''}${pr || dl ? ' on-promo' : ''}${dl ? ' on-deal' : ''}" data-id="${it.id}" style="animation-delay:${Math.min(i, 12) * 35}ms">
        <span class="tag"${it.soldOut || tag ? '' : ' hidden'}>${it.soldOut ? 'Sold out' : esc(tag || '')}</span>
        ${it.left && !it.soldOut ? `<span class="left">Only ${it.left} left</span>` : ''}
        <div class="art">${artFor(it)}</div>
        <div class="card-top"><h3>${esc(it.name)}</h3><span class="price">${counterOnly ? 'At counter' : pr ? `<s>${pesos(it.price)}</s> ${pesos(it.price - pr.off)}` : pesos(it.price)}</span></div>
        <div class="card-foot"><span class="spec">${CAT_LABEL[it.cat] || ''}</span><button class="add" type="button" data-add="${it.id}" ${it.soldOut || counterOnly ? 'disabled' : ''}>${label}</button></div>
      </article>`;
    }).join('') || '<p class="hint-sm">Nothing here right now.</p>';
  }
  renderFilters(); render();

  // ---------- opening hours, happy hour (from the server; times in the café's time zone) ----------
  const TZ = () => cat.hours?.tz || 'Asia/Manila';
  const cafeDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(new Date(d));
  const tm = (d) => new Intl.DateTimeFormat('en-PH', { timeZone: TZ(), hour: 'numeric', minute: '2-digit' }).format(new Date(d));
  const t12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const niceDate = (date) => new Date(date + 'T00:00:00Z').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dayLabel = (date) => { const t = cafeDay(Date.now()), t1 = cafeDay(Date.now() + 86400e3); return date === t ? `Today · ${niceDate(date)}` : date === t1 ? `Tomorrow · ${niceDate(date)}` : niceDate(date); };
  const whenWord = (d) => { const day = cafeDay(d); return `${day === cafeDay(Date.now()) ? 'today' : day === cafeDay(Date.now() + 86400e3) ? 'tomorrow' : niceDate(day)} at ${tm(d)}`; };
  function openNow() {
    const H = cat.hours; if (!H || H.enabled === false) return { open: true };
    const now = Date.now(), W = H.windows || [];
    const w = W.find(x => now >= +new Date(x.start) && now < +new Date(x.end));
    if (w) return { open: true, until: w.end, note: w.note };
    const nx = W.find(x => +new Date(x.start) > now);
    return { open: false, next: nx?.start || null, note: nx && cafeDay(nx.start) === cafeDay(now) ? nx.note : '' };
  }
  // Happy hour: same rules as the server (lib/time.js); the server always re-checks prices.
  const clock = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value])); return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: +p.hour * 60 + +p.minute }; };
  const hm = (s2) => +s2.slice(0, 2) * 60 + +s2.slice(3, 5);
  const promoOn = (p, t) => { const { dow, min } = clock(t), f = hm(p.from), to = hm(p.to); return f < to ? p.days.includes(dow) && min >= f && min < to : (p.days.includes(dow) && min >= f) || (p.days.includes((dow + 6) % 7) && min < to); };
  function promoFor(it, t = new Date()) {
    if (!it || it.price == null) return null;
    let best = null;
    for (const p of cat.promos || []) {
      if (p.cats?.length && !p.cats.includes(it.cat)) continue;
      if (p.icedOnly && !(kindOf(it.cat) === 'drink' && !it.hot)) continue;
      if (!promoOn(p, t)) continue;
      const off = Math.min(it.price, Math.round((it.price * p.pct) / 10000) * 100);
      if (off > 0 && (!best || off > best.off)) best = { promo: p, off };
    }
    return best;
  }
  // Buy 1 Take 1: same rules as the server (lib/deals.js); the server always re-checks.
  const bizDay = (t) => cafeDay(new Date(t) - 4 * 3600e3); // business day: 4 AM → 4 AM
  const dealOn = (d, t = new Date()) => !(d.startsOn && bizDay(t) < d.startsOn) && !(d.endsOn && bizDay(t) > d.endsOn) && !(d.days?.length && !d.days.includes(clock(t).dow));
  const dealsAt = (t = new Date()) => (cat.deals || []).filter(d => dealOn(d, t));
  const dealFor = (it, t) => dealsAt(t).find(d => d.productIds.includes(it.id));
  function applyDeals(lines, deals) {
    const used = new Map(), applied = [], waiting = [], lineOff = new Map(), lineDeal = new Map(); let total = 0;
    for (const d of deals) {
      const units = [];
      lines.forEach((l, i) => { if (!d.productIds.includes(l.id)) return; const base = l.unitCents - (l.addons || []).reduce((a, x) => a + (x.cents || 0), 0); for (let k = used.get(i) || 0; k < l.qty; k++) units.push({ i, base }); });
      units.sort((a, b) => b.base - a.base);
      let pairs = Math.floor(units.length / 2); if (d.maxPairs) pairs = Math.min(pairs, d.maxPairs);
      let off = 0;
      for (let p = 0; p < pairs; p++) {
        const a = units[2 * p], b = units[2 * p + 1], save = a.base + b.base - (d.pairCents != null ? Math.min(d.pairCents, a.base + b.base) : a.base);
        off += save; used.set(a.i, (used.get(a.i) || 0) + 1); used.set(b.i, (used.get(b.i) || 0) + 1);
        // Show the saving on the cart line: on the cheaper item first (that's the "take 1"), any rest on the other one.
        const onB = Math.min(save, b.base), onA = save - onB;
        lineOff.set(b.i, (lineOff.get(b.i) || 0) + onB); if (onA) lineOff.set(a.i, (lineOff.get(a.i) || 0) + onA);
        lineDeal.set(b.i, d); lineDeal.set(a.i, d);
      }
      if (pairs && off > 0) { applied.push({ id: d.id, title: d.title, pairs, offCents: off }); total += off; }
      if (units.length % 2 === 1 && (!d.maxPairs || pairs < d.maxPairs)) waiting.push(d);
    }
    return { offCents: total, applied, waiting, used, lineOff, lineDeal };
  }
  const dealWhat = (d) => (d.pairCents != null ? `2 for ${pesos(d.pairCents)}` : 'the 2nd one is free');
  const promoSig = () => (cat.promos || []).filter(p => promoOn(p, new Date())).map(p => p.id).join() + '|' + dealsAt().map(d => d.id).join();
  const promoWhat = (p) => `${p.pct}% off ${p.cats?.length ? p.cats.map(c => CAT_LABEL[c] || c).join(', ') : 'everything'}${p.icedOnly ? ' (iced drinks)' : ''}`;
  function renderHours() {
    const H = cat.hours; if (!H) return;
    const order = [1, 2, 3, 4, 5, 6, 0], names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = clock(new Date()).dow;
    $('#hours').innerHTML = order.map(i => { const d = H.days[i]; return `<tr class="${i === today ? 'today' : ''}"><td>${names[i]}</td><td>${d.closed ? 'Closed' : `${t12(d.open)} – ${t12(d.close)}`}</td></tr>`; }).join('');
    const specials = [...(H.windows || []).filter(w => w.note).map(w => ({ date: w.date, text: `${tm(w.start)} – ${tm(w.end)}`, note: w.note })),
      ...(H.closedDays || []).filter(x => x.date >= cafeDay(Date.now())).map(x => ({ date: x.date, text: 'Closed', note: x.note === 'Closed today' ? '' : x.note }))]
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    $('#specialList').hidden = !specials.length;
    $('#specialList').innerHTML = '<h4>Special days</h4>' + specials.map(x => `<div><b>${esc(dayLabel(x.date))}</b><span>${esc(x.text)}</span>${x.note ? `<small>📍 ${esc(x.note)}</small>` : ''}</div>`).join('');
    const st = openNow();
    $('#open').classList.toggle('on', st.open);
    $('#open-t').textContent = st.open ? (st.until ? `Open until ${tm(st.until)}` : 'Open now') : st.next ? `Closed · opens ${whenWord(st.next)}` : 'Closed now';
    // Banner above the menu: closed / pop-up note / happy hour now
    const bits = [];
    if (!st.open) bits.push(`<span class="sb closed">🌙 We're closed right now${st.next ? ` · we open ${whenWord(st.next)}` : ''}. <b>You can still order ahead.</b></span>`);
    const note = st.open ? st.note : st.note;
    if (note) bits.push(`<span class="sb note">📍 ${st.open ? 'Today' : 'Next'}: ${esc(note)}</span>`);
    for (const p of (cat.promos || []).filter(p => promoOn(p, new Date()))) bits.push(`<span class="sb promo">🍹 ${esc(p.name)} now: ${esc(promoWhat(p))} until ${t12(p.to)}</span>`);
    $('#statusBar').hidden = !bits.length; $('#statusBar').innerHTML = bits.join('');
    if (typeof renderPromoChip === 'function' && cat.featured) renderPromoChip();
  }

  // ---------- order ahead: day + time slots (every 15 min while open, from 30 min from now) ----------
  function slots() {
    const out = new Map(), from = Date.now() + 30 * 60e3, Q = 15 * 60e3;
    for (const w of cat.hours?.windows || []) {
      const end = +new Date(w.end) - Q;
      for (let t = Math.ceil(Math.max(+new Date(w.start), from) / Q) * Q; t <= end; t += Q) { if (!out.has(w.date)) out.set(w.date, []); out.get(w.date).push(t); }
    }
    return out;
  }
  const whenAt = () => ($('#o-when').value === 'later' && $('#o-time').value ? new Date(+$('#o-time').value) : null);
  function applyWhen() {
    if (!cat.hours) return;
    const st = openNow(), sl = slots(), now = $('#o-when').options[0];
    now.disabled = !st.open; now.textContent = st.open ? 'As soon as possible' : 'As soon as possible (we\'re closed now)';
    if (!st.open && $('#o-when').value === 'now') $('#o-when').value = 'later';
    const later = $('#o-when').value === 'later';
    $('#whenPick').hidden = !later; $('#pickupF').hidden = later || isDelivery();
    const days = [...sl.keys()], curDay = $('#o-day').value, curT = $('#o-time').value;
    const short = (d) => (d === cafeDay(Date.now()) ? 'Today' : d === cafeDay(Date.now() + 86400e3) ? 'Tomorrow' : niceDate(d));
    $('#o-day').innerHTML = days.map(d => `<option value="${d}">${esc(short(d))}</option>`).join('') || '<option value="">No times available</option>';
    if (days.includes(curDay)) $('#o-day').value = curDay;
    const times = sl.get($('#o-day').value) || [];
    $('#o-time').innerHTML = times.map(t => `<option value="${t}">${tm(t)}${(cat.promos || []).some(p => promoOn(p, new Date(t))) ? ' 🍹' : ''}</option>`).join('');
    if (times.map(String).includes(curT)) $('#o-time').value = curT;
    const at = whenAt(), n = $('#whenNote');
    n.textContent = !st.open ? `We're closed right now${st.next ? `, and open ${whenWord(st.next)}` : ''}. Order ahead and we'll have it ready at your time.`
      : at ? `We'll have it ${isDelivery() ? 'at your door' : 'ready'} ${whenWord(at)}.`
      : st.until && +new Date(st.until) - Date.now() < 60 * 60e3 ? `We close at ${tm(st.until)} tonight.` : '';
    n.hidden = !n.textContent;
  }
  ['#o-when', '#o-day', '#o-time'].forEach(id => $(id).addEventListener('change', () => { applyWhen(); setNote(''); renderCart(); }));
  // Time passes: refresh open/closed, slots and happy-hour prices every minute.
  let lastSig = '';
  setInterval(() => { if (!cat.hours) return; renderHours(); applyWhen(); const sig = promoSig(); if (sig !== lastSig) { lastSig = sig; render(); } renderCart(); }, 60e3);

  // ---------- state ----------
  const STATUS = { new: 'Received', making: 'Being made', ready: 'Ready for pickup', delivering: 'Out for delivery', done: 'Picked up', cancelled: 'Cancelled' };
  const STEP = { new: 1, making: 2, ready: 3, delivering: 3, done: 3, cancelled: 0 };
  const PAY = { qrph: 'GCash / Maya QR', gcash: 'GCash', paymaya: 'Maya', card: 'Card', counter: 'Pay at counter' }; // 'card' only for old orders
  const PAY_ORDER = ['qrph', 'gcash', 'paymaya', 'counter'];
  let cart = ls.get('dd-cart2', []);
  let mine = ls.get('dd-orders', []).filter(o => Date.now() - o.at < 12 * 3600e3);
  let busy = false, payPicked = false;
  let pin = ls.get('dd-pin', null); // {lat, lng, km, feeCents}
  let promo = ls.get('dd-code', null); // applied promo code {code, kind, value, minCents, maxOffCents, label}
  let history = ls.get('dd-history', []); // past orders on this phone, for "Order again" (kept 60 days)
  history = history.filter(h => Date.now() - h.at < 60 * 86400e3);
  const told = {};

  const unitOf = (l, at = whenAt() || new Date()) => { const it = byId[l.id]; return (it?.price || 0) - (promoFor(it, at)?.off || 0) + (l.addons || []).reduce((a, id) => a + (addonById[id]?.price || 0), 0); };
  const subtotal = () => cart.reduce((a, l) => a + unitOf(l) * l.qty, 0);
  const isDelivery = () => $('#ot-delivery').checked && cat.delivery.enabled;
  const deliveryFee = () => (cart.length && isDelivery() && pin?.feeCents != null ? pin.feeCents : 0);
  // Promo code discount: same rule as the server (lib/promocodes.js): items only, whole pesos.
  // "Buy this, get that" codes: same rules as the server (lib/promocodes.js → bogoReward).
  function bogoReward(b, lines, used) {
    const units = [];
    lines.forEach((l, i) => { const base = l.unitCents - (l.addons || []).reduce((a, x) => a + (x.cents || 0), 0); for (let k = used?.get(i) || 0; k < l.qty; k++) units.push({ id: l.id, base }); });
    const getU = units.filter(u => b.getIds.includes(u.id)).sort((x, y) => x.base - y.base), buyU = units.filter(u => b.buyIds.includes(u.id)), per = Math.max(1, b.buyQty || 1);
    let best = 0;
    for (let r = 1; r <= getU.length && (!b.max || r <= b.max); r++) { const chosen = new Set(getU.slice(0, r)); if (buyU.filter(u => !chosen.has(u)).length >= r * per) best = r; else break; }
    return { offCents: getU.slice(0, best).reduce((a, u) => a + Math.round((u.base * Math.min(100, b.getPct)) / 10000) * 100, 0), rewards: best, need: best ? '' : buyU.length < per ? 'buy' : 'get' };
  }
  const pricedLines = () => cart.map(l => ({ id: l.id, cat: byId[l.id]?.cat, name: byId[l.id]?.name, qty: l.qty, unitCents: unitOf(l), addons: (l.addons || []).map(id => ({ cents: addonById[id]?.price || 0 })) }));
  // ---------- stamp card (same rules as lib/loyalty.js) ----------
  let stamp = { phone: ls.get('dd-stamp-phone', '') || '', card: null, redeem: false };
  const loyQualifies = (cfg, l) => (cfg.ids?.length || cfg.cats?.length ? cfg.ids.includes(l.id) || cfg.cats.includes(l.cat) : kindOf(l.cat) === 'drink');
  const loyEarn = (cfg, lines, reward = 0) => Math.max(0, lines.filter(l => loyQualifies(cfg, l)).reduce((a, l) => a + l.qty, 0) - reward);
  function loyReward(cfg, lines, used) {
    let best = null;
    lines.forEach((l, i) => { if (!loyQualifies(cfg, l) || l.qty - (used?.get(i) || 0) <= 0) return; const base = l.unitCents - (l.addons || []).reduce((a, x) => a + (x.cents || 0), 0); if (!best || base > best.base) best = { i, base }; });
    return best ? { offCents: cfg.maxCents ? Math.min(best.base, cfg.maxCents) : best.base, line: best.i } : { offCents: 0, line: -1 };
  }
  /** Everything the cart total needs, in the server's order: Buy 1 Take 1 → stamp card reward → promo code. */
  function cartMath(at = whenAt() || new Date()) {
    const pl = pricedLines(), deal = applyDeals(pl, dealsAt(at)), cfg = cat.loyalty || {};
    let loy = { off: 0, earn: 0, name: '' };
    if (cfg.enabled && stamp.card) {
      if (stamp.redeem && stamp.card.ready && cfg.online) {
        const r = loyReward(cfg, pl, deal.used);
        if (r.offCents) { deal.used.set(r.line, (deal.used.get(r.line) || 0) + 1); loy = { off: r.offCents, earn: loyEarn(cfg, pl, 1), name: pl[r.line].name }; }
      } else loy.earn = loyEarn(cfg, pl);
      if (stamp.card.todayLeft != null) { loy.capped = loy.earn > stamp.card.todayLeft; loy.earn = Math.min(loy.earn, stamp.card.todayLeft); } // max stamps per day
    }
    const gross = subtotal(), sub = gross - deal.offCents - loy.off;
    return { pl, deal, loy, gross, sub, disc: codeOff(sub, pl, deal.used) };
  }
  const codeOff = (sub, lines = [], used = null) => {
    if (!promo || sub < (promo.minCents || 0)) return 0;
    if (promo.kind === 'bogo') return Math.min(bogoReward(promo.bogo, lines, used).offCents, sub);
    let off = Math.round((promo.kind === 'pct' ? (sub * promo.value) / 100 : promo.value) / 100) * 100;
    if (promo.kind === 'pct' && promo.maxOffCents) off = Math.min(off, promo.maxOffCents);
    return Math.max(0, Math.min(off, sub));
  };
  /** The promo code's discount for the cart as it is now (after Buy 1 Take 1 deals). */
  const cartCodeOff = () => cartMath().disc;
  const optsLabel = (o) => (o ? [o.sweet != null ? o.sweet + '% sweet' : null, o.ice].filter(Boolean).join(' · ') : '');

  // ---------- drawer ----------
  const drawer = $('#drawer'), scrim = $('#scrim');
  const openDrawer = () => { drawer.classList.add('open'); drawer.inert = false; scrim.classList.add('on'); setTimeout(() => $('#drawerClose').focus(), 50); pollMine(); };
  const closeDrawer = () => { drawer.classList.remove('open'); drawer.inert = true; scrim.classList.remove('on'); };
  $('#fab').onclick = $('#orderBtn').onclick = $('#visitOrder').onclick = openDrawer;
  $('#drawerClose').onclick = scrim.onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closeDrawer(); });
  const saved = ls.get('dd-contact', {});
  $('#o-name').value = saved.name || ''; $('#d-address').value = saved.address || ''; $('#d-landmark').value = saved.landmark || ''; $('#d-phone').value = saved.phone || '';

  // ---------- item options + add-ons ----------
  const dlg = $('#optDlg'); let dlgItem = null, dlgQty = 1;
  function readOpts() {
    const f = $('#optForm');
    const drink = kindOf(dlgItem.cat) === 'drink';
    return {
      opts: drink ? { sweet: +f.sweet.value, ice: dlgItem.hot ? null : f.ice.value } : null,
      addons: [...f.querySelectorAll('input[name=addon]:checked')].map(x => x.value),
    };
  }
  const refreshDlg = () => {
    const { addons } = readOpts();
    $('#qVal').textContent = dlgQty;
    const unit = unitOf({ id: dlgItem.id, addons }, new Date());
    // Show the deal price too, e.g. "Add ₱238 · ₱149 with Okinawa for 2" (the cart applies it).
    const dl = cat.deals ? applyDeals([{ id: dlgItem.id, qty: dlgQty, unitCents: unit, addons: addons.map(id => ({ cents: addonById[id]?.price || 0 })) }], dealsAt()) : { offCents: 0 };
    $('#optAdd').textContent = 'Add ' + pesos(unit * dlgQty) + (dl.offCents ? ` · ${pesos(unit * dlgQty - dl.offCents)} with ${dl.applied[0].title}` : '');
  };
  function startAdd(id) {
    const it = byId[id]; if (!it || it.soldOut || it.price == null) return;
    dlgItem = it; dlgQty = 1; $('#optForm').reset();
    const pr = promoFor(it);
    $('#optTitle').textContent = it.name; $('#optCat').textContent = (CAT_LABEL[it.cat] || '') + ' · ' + (pr ? `${pr.promo.name}: ${pesos(it.price - pr.off)} (was ${pesos(it.price)})` : pesos(it.price));
    const drink = kindOf(it.cat) === 'drink';
    $('#g-sweet').hidden = !drink; $('#g-ice').hidden = !drink || !!it.hot;
    const groups = groupsFor(it.cat).map(g => [g, cat.addons.filter(a => a.grp === g)]).filter(([, list]) => list.length);
    $('#addonGroups').innerHTML = groups.map(([g, list]) => `
      <div class="grp grp-addons"><h4>${GROUP_LABEL[g]} <span style="text-transform:none;letter-spacing:0">(pick any)</span></h4><div class="seg">
        ${list.map(a => `<input type="checkbox" name="addon" id="ad-${a.id}" value="${a.id}"><label for="ad-${a.id}">${esc(a.name)} <small>+${pesos(a.price)}</small></label>`).join('')}
      </div></div>`).join('');
    refreshDlg(); dlg.showModal();
  }
  $('#optForm').addEventListener('change', refreshDlg);
  $('#qMinus').onclick = () => { dlgQty = Math.max(1, dlgQty - 1); refreshDlg(); };
  $('#qPlus').onclick = () => { dlgQty = Math.min(20, dlgQty + 1); refreshDlg(); };
  $('#optAdd').onclick = () => {
    const { opts, addons } = readOpts();
    const key = dlgItem.id + '|' + JSON.stringify(opts) + '|' + [...addons].sort().join(',');
    const ex = cart.find(l => l.key === key);
    if (ex) ex.qty = Math.min(20, ex.qty + dlgQty); else cart.push({ key, id: dlgItem.id, qty: dlgQty, opts, addons });
    dlg.close(); renderCart();
    const f = $('#fab'); f.classList.remove('bump'); void f.offsetWidth; f.classList.add('bump');
    toast(`${dlgQty > 1 ? dlgQty + ' × ' : ''}${dlgItem.name} added`);
  };
  grid.addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) startAdd(b.dataset.add); });
  const heroMap = { matcha: 'strawberry-matcha', coffee: 'iced-spanish-latte', milktea: 'okinawa' };
  $('#heroAdd').onclick = () => { auto = false; startAdd(heroMap[hero.dataset.mode]); };
  const applyHero = () => { const it = byId[heroMap[hero.dataset.mode]]; $('#heroAdd').disabled = !it || it.soldOut || it.price == null; };
  sws.forEach(b => b.addEventListener('click', applyHero));

  // ---------- pickup / delivery ----------
  function applyDelivery() {
    const d = cat.delivery;
    $('#oType').hidden = !d.enabled;
    $('#heroDeliv').hidden = !d.enabled;
    if (d.enabled) $('#heroDelivT').textContent = `· ${pesos(d.tiers[0].fee)}–${pesos(d.tiers[d.tiers.length - 1].fee)} within ${d.maxKm} km`;
    if (!d.enabled) $('#ot-pickup').checked = true;
    else $('#otDeliverySub').textContent = `${pesos(d.tiers[0].fee)}–${pesos(d.tiers[d.tiers.length - 1].fee)} · ${d.eta || ''}`;
    const del = isDelivery();
    $('#delivF').hidden = !del; $('#pickupF').hidden = del || $('#o-when').value === 'later';
    $('#o-name-l').textContent = del ? 'Name for the rider' : 'Name for pickup';
    $('#pay-counter').nextElementSibling.querySelector('b').textContent = del ? 'Cash on delivery' : 'At counter';
    $('#pay-counter').nextElementSibling.querySelector('small').textContent = del ? 'Pay the rider' : 'Cash on pickup';
    $('#pinInfo').innerHTML = !pin ? 'No location set yet.' : pin.feeCents == null ? `<span style="color:var(--danger)">${esc(pin.error || 'Outside our delivery area.')}</span>` : `Pin set · <b>${pin.km} km</b> away · delivery fee <b>${pesos(pin.feeCents)}</b>`;
    $('#pinBtn').textContent = pin ? '📍 Change delivery location' : '📍 Set delivery location on the map';
  }
  document.querySelectorAll('input[name=otype]').forEach(i => i.addEventListener('change', () => { applyDelivery(); setNote(''); renderCart(); }));

  // Fee from straight-line distance, same rule as the server (the server re-checks).
  function quote(lat, lng) {
    const d = cat.delivery, R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(lat - d.lat), dLng = rad(lng - d.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(d.lat)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
    const km = Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
    const tier = [...d.tiers].sort((x, y) => x.upToKm - y.upToKm).find(t => km <= t.upToKm);
    if (km > d.maxKm || !tier) return { lat, lng, km, feeCents: null, error: `${km} km away. We deliver up to ${d.maxKm} km.` };
    return { lat, lng, km, feeCents: tier.fee };
  }

  // Map (Leaflet + OpenStreetMap), loaded only when the customer opens it.
  let leaflet, map, storeMk, pinMk, draft = null;
  function loadLeaflet() {
    if (leaflet) return leaflet;
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.onload = () => resolve(window.L); js.onerror = () => { leaflet = null; reject(new Error('Map failed to load')); };
      document.head.appendChild(js);
    });
    return leaflet;
  }
  const showDraft = () => {
    const q = $('#mapQuote');
    q.classList.toggle('bad', !!draft && draft.feeCents == null);
    q.textContent = !draft ? 'Tap the map to drop your pin' : draft.feeCents == null ? draft.error : `${draft.km} km · fee ${pesos(draft.feeCents)}`;
    $('#mapOk').disabled = !draft || draft.feeCents == null;
  };
  const placePin = (lat, lng) => {
    draft = quote(lat, lng);
    if (!pinMk) {
      pinMk = window.L.marker([lat, lng], { draggable: true }).addTo(map);
      pinMk.on('dragend', () => { const p = pinMk.getLatLng(); placePin(p.lat, p.lng); });
    } else pinMk.setLatLng([lat, lng]);
    showDraft();
  };
  $('#pinBtn').onclick = async () => {
    $('#mapDlg').showModal(); draft = pin; showDraft();
    try {
      const L = await loadLeaflet();
      const d = cat.delivery;
      if (!map) {
        $('#map').innerHTML = '';
        map = L.map('map', { zoomControl: true }).setView([d.lat, d.lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
        storeMk = L.circleMarker([d.lat, d.lng], { radius: 9, color: '#066B23', fillColor: '#066B23', fillOpacity: 1 }).addTo(map).bindTooltip("Demetria's Diner", { permanent: true, direction: 'top', offset: [0, -8] });
        L.circle([d.lat, d.lng], { radius: d.maxKm * 1000, color: '#066B23', weight: 1, fillOpacity: 0.04 }).addTo(map);
        map.on('click', e => placePin(e.latlng.lat, e.latlng.lng));
      }
      setTimeout(() => map.invalidateSize(), 60);
      if (pin) { placePin(pin.lat, pin.lng); map.setView([pin.lat, pin.lng], 15); }
    } catch { $('#map').innerHTML = '<p class="map-loading">The map could not load. Check your connection and try again.</p>'; }
  };
  $('#locBtn').onclick = () => {
    if (!navigator.geolocation) return toast('Location is not available on this device.');
    $('#locBtn').disabled = true;
    navigator.geolocation.getCurrentPosition(p => {
      $('#locBtn').disabled = false;
      if (map) { placePin(p.coords.latitude, p.coords.longitude); map.setView([p.coords.latitude, p.coords.longitude], 16); }
      else { draft = quote(p.coords.latitude, p.coords.longitude); showDraft(); } // map didn't load: still works
    }, () => { $('#locBtn').disabled = false; toast('Allow location access, or tap the map instead.'); }, { enableHighAccuracy: true, timeout: 10000 });
  };
  $('#mapClose').onclick = () => $('#mapDlg').close();
  $('#mapOk').onclick = () => { pin = draft; ls.set('dd-pin', pin); $('#mapDlg').close(); applyDelivery(); setNote(''); renderCart(); };

  // ---------- payment choice ----------
  // Which of the shop's QRs exist: 'GCash / Maya', or just 'Maya' / 'GCash' (Staff → Settings → QR)
  const walletWord = () => { const w = cat.qrWallets || []; return w.length === 1 ? (w[0] === 'maya' ? 'Maya' : 'GCash') : 'GCash / Maya'; };
  function applyPay() {
    const ww = walletWord(); PAY.qrph = ww + ' QR'; $('#qrPayName').textContent = ww;
    document.querySelectorAll('.w-list').forEach(el => { if (!el.dataset.orig) el.dataset.orig = el.textContent; el.textContent = ww === 'Maya' ? (el.dataset.orig.endsWith(',') ? 'Maya,' : 'Maya') : el.dataset.orig; });
    Object.entries(cat.payments).forEach(([k, on]) => { const i = $('#pay-' + k); if (!i) return; i.disabled = !on; i.hidden = !on; i.nextElementSibling.hidden = !on; });
    const cur = $('input[name=pay]:checked');
    if (!payPicked || !cur || cur.disabled) {
      const first = PAY_ORDER.find(k => cat.payments[k]);
      document.querySelectorAll('input[name=pay]').forEach(i => { i.checked = i.value === first; });
    }
  }
  const payMethod = () => ($('input[name=pay]:checked') || {}).value;
  $('#payGrid').addEventListener('change', () => { payPicked = true; setNote(''); renderCart(); });

  // ---------- cart ----------
  const setNote = (t, err) => { const n = $('#orderNote'); n.textContent = t; n.classList.toggle('err', !!err); };
  function renderCart() {
    // Only drop items that are gone (or have no price) once the REAL menu has loaded. Before that, the page
    // shows a built-in copy of the menu, and checking against it would wipe a returning customer's cart.
    if (apiState === 'ready') { cart = cart.filter(l => byId[l.id] && byId[l.id].price != null); ls.set('dd-cart2', cart); }
    $('#fabCount').textContent = cart.reduce((a, l) => a + l.qty, 0);
    const known = (l) => byId[l.id] && byId[l.id].price != null;
    const lineDeals = cart.length ? applyDeals(pricedLines(), dealsAt(whenAt() || new Date())) : null; // to show each line's deal saving
    $('#lines').innerHTML = !cart.length ? `<div class="empty">Nothing here yet. Tap <b>Add +</b> on anything from the menu.</div>`
      : !cart.some(known) ? (apiState === 'down' ? "<div class=\"empty\">You're offline. Your order is saved and shows again when you're back online.</div>" : '<div class="empty">Loading your order…</div>')
      : cart.map((l, i) => {
      if (!known(l)) return ''; // still loading this item's details
      const it = byId[l.id], adds = (l.addons || []).map(id => addonById[id]).filter(Boolean);
      const full = unitOf(l) * l.qty, save = lineDeals?.lineOff.get(i) || 0, dl = lineDeals?.lineDeal.get(i);
      return `<div class="line${save ? ' on-deal' : ''}"><b>${esc(it.name)}</b><span class="lp">${save ? `<s>${pesos(full)}</s> ${pesos(full - save)}` : pesos(full)}</span>
        <small>${esc(optsLabel(l.opts)) || 'As served'}${it.soldOut ? ' · <b style="color:var(--danger)">sold out</b>' : ''}${(() => { const pr = promoFor(it, whenAt() || new Date()); return pr ? ` · <b class="promo-t">${esc(pr.promo.name)} −${pesos(pr.off)}</b>` : ''; })()}${dl ? `<br><b class="deal-t">🎉 ${esc(dl.title)}: ${esc(dealWhat(dl))}${save ? ` · you save ${pesos(save)}` : ''}</b>` : ''}</small>
        <div class="stepper"><button type="button" data-q="${i}" data-d="-1" aria-label="Fewer">−</button><span>${l.qty}</span><button type="button" data-q="${i}" data-d="1" aria-label="More">+</button></div>
        ${adds.length ? `<span class="addons">+ ${adds.map(a => `${esc(a.name)} (${pesos(a.price)})`).join(', ')}</span>` : ''}</div>`;
    }).join('');
    const at = whenAt() || new Date();
    const { pl, deal, loy, gross, sub, disc } = cartMath(at); // deals, then the stamp card, then the promo code
    const fee = deliveryFee(), del = isDelivery();
    $('#loyLbl').hidden = $('#loyTotal').hidden = !loy.off; $('#loyLbl').textContent = `🎟️ Free ${loy.name}`; $('#loyTotal').textContent = '−' + pesos(loy.off);
    renderStamp(loy); renderSuggest();
    const bogoNeed = promo?.kind === 'bogo' && cart.length && !disc ? bogoReward(promo.bogo, pl, deal.used).need : '';
    $('#dealLbl').hidden = $('#dealTotal').hidden = !deal.offCents;
    $('#dealLbl').textContent = `🎉 ${deal.applied.map(a => a.title + (a.pairs > 1 ? ` ×${a.pairs}` : '')).join(', ')}`; $('#dealTotal').textContent = '−' + pesos(deal.offCents);
    $('#dealHint').hidden = !(cart.length && deal.waiting.length);
    if (deal.waiting.length) { const w = deal.waiting[0]; $('#dealHint').innerHTML = `🎉 Add 1 more from <b>${esc(w.title)}</b> and ${esc(dealWhat(w))}! <button class="linkbtn" type="button" data-f-deal="${esc(w.id)}">See items</button>`; }
    $('#sums').hidden = (!del && !disc && !deal.offCents && !loy.off) || !cart.length; $('#subTotal').textContent = pesos(gross); $('#feeTotal').textContent = pin?.feeCents != null ? pesos(fee) : '—';
    $('#feeLbl').hidden = $('#feeTotal').hidden = !del;
    $('#discLbl').hidden = $('#discTotal').hidden = !disc; $('#discTotal').textContent = '−' + pesos(disc);
    $('#discLbl').textContent = promo ? `Promo ${promo.code}` : 'Discount';
    $('#codeRow').hidden = !!promo; $('#codeOn').hidden = !promo;
    if (promo) $('#codeOn').innerHTML = `<span><b>${esc(promo.code)}</b> · ${esc(promo.label)}${disc ? ` · <b>−${pesos(disc)}</b>` : bogoNeed ? `<br><small>${bogoNeed === 'buy' ? `Buy ${promo.bogo.buyQty > 1 ? promo.bogo.buyQty + ' × ' : ''}${esc(promo.bogo.buyLabel)} to use this code.` : `Add ${esc(promo.bogo.getLabel)} to your order. It's ${promo.bogo.getPct >= 100 ? 'free' : promo.bogo.getPct + '% off'} with this code!`} <button class="linkbtn" type="button" data-bogo-show="${bogoNeed}">Show me</button></small>` : cart.length && sub < promo.minCents ? `<br><small>Add ${pesos(promo.minCents - sub)} more to use this code (minimum ${pesos(promo.minCents)}).</small>` : ''}</span><button class="linkbtn" type="button" id="codeRemove">Remove</button>`;
    const totalNow = gross - deal.offCents - loy.off - disc + fee;
    $('#total').textContent = pesos(totalNow);
    let why = '';
    if (apiState === 'loading') why = 'Connecting to the order system…';
    else if (apiState === 'down') why = 'Online ordering is unavailable right now. Please order at the counter.';
    else if (!cat.accepting) why = "We're not taking online orders right now. Please order at the counter.";
    if (!why && cat.hours && $('#o-when').value === 'later' && !whenAt()) why = 'Choose a day and time for your order.';
    if (!why && cat.hours && $('#o-when').value === 'now' && !openNow().open) why = "We're closed right now. Choose a time to order ahead.";
    const sold = cart.find(l => byId[l.id]?.soldOut);
    if (!why && sold) why = `${byId[sold.id].name} just sold out. Remove it to continue.`;
    if (!why && del && (!pin || pin.feeCents == null)) why = 'Set your delivery location on the map.';
    if (!why && del && cat.delivery.minOrder && sub < cat.delivery.minOrder) why = `Delivery needs a minimum order of ${pesos(cat.delivery.minOrder)}.`;
    const pm = payMethod();
    if (!why && !pm) why = 'Choose how you want to pay.';
    const btn = $('#placeBtn');
    btn.disabled = busy || !cart.length || !!why;
    btn.textContent = busy ? 'Sending…' : !cart.length ? 'Place order'
      : pm === 'qrph' ? `Continue to pay ${pesos(totalNow)}` : ['gcash', 'paymaya', 'card'].includes(pm) ? `Pay ${pesos(totalNow)} with ${PAY[pm]}` : `Place order · ${pesos(totalNow)}`;
    renderAgain(); renderPromoChip();
    if (!busy && !$('#orderNote').classList.contains('err')) setNote(why || (!cart.length ? '' : pm === 'counter' ? (del ? 'Pay the rider in cash when your order arrives.' : 'Pay with cash or GCash at the counter when you pick up.') : pm === 'qrph' ? `Next, you'll see our ${walletWord() === 'GCash / Maya' ? 'GCash or Maya' : walletWord()} QR to scan and pay.` : `You'll be taken to ${PAY[pm]} to pay securely through PayMongo.`));
  }
  $('#lines').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const l = cart[+b.dataset.q]; l.qty += +b.dataset.d; if (l.qty <= 0) cart.splice(+b.dataset.q, 1);
    setNote(''); renderCart();
  });

  // ---------- promo code ----------
  async function applyCode() {
    const c = $('#o-code').value.trim().toUpperCase().replace(/\s+/g, '');
    if (!c) { setNote('Type your promo code first.', true); $('#o-code').focus(); return; }
    $('#codeApply').disabled = true;
    try {
      promo = await api('/api/orders?promo=' + encodeURIComponent(c));
      ls.set('dd-code', promo); $('#o-code').value = '';
      setNote(''); toast(`Promo ${promo.code} applied: ${promo.label}`);
    } catch (err) { setNote(err.message || "Couldn't check that code. Try again.", true); }
    $('#codeApply').disabled = false; renderCart();
  }
  $('#codeApply').onclick = applyCode;
  $('#o-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } });
  $('#codeOn').addEventListener('click', e => { if (e.target.closest('#codeRemove')) { promo = null; ls.set('dd-code', null); setNote(''); renderCart(); } });

  // ---------- promo pop-ups: Buy 1 Take 1 deals and promo codes the shop chose to advertise ----------
  // Each one pops up on its own, once per phone, a few seconds after the site opens. When it's closed,
  // the next one appears 2 seconds later, and so on. The banner above the menu reopens them any time.
  const ppDlg = $('#promoDlg');
  let ppList = [], ppIdx = 0, ppQueue = [], ppAuto = false, ppStarted = false, ppTimer = null;
  const ppOffered = new Set(); // pop-ups already queued this visit
  // Codes with hours ("2 PM – 5 PM") only pop up / show in the bar during those hours (café time).
  const codeNow = (c, t = new Date()) => { if (!c.startTime || !c.endTime) return true; const m = clock(t).min, s2 = hm(c.startTime), e2 = hm(c.endTime); return s2 < e2 ? m >= s2 && m < e2 : m >= s2 || m < e2; };
  const t12c = (t) => { const h = +t.slice(0, 2), m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : ':' + m} ${h < 12 ? 'AM' : 'PM'}`; };
  // Every minute: a code whose hours just started pops up now (no reload needed); one that ended leaves the bar.
  setInterval(() => { if (!cat.featured) return; renderPromoChip(); if (!ppAuto && !$('#promoDlg').open) { ppStarted = false; maybeAutoPopup(); } }, 60000);
  const ppSeen = () => ls.get('dd-popup-seen', {});
  const ppMark = (key) => { const s2 = ppSeen(); s2[key] = Date.now(); ls.set('dd-popup-seen', s2); };
  const niceEnd = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const dayNames = (days) => days.length === 7 ? 'Every day' : days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
  /** Everything that can pop up right now: deals first, then promo codes. */
  function ppItems() {
    const deals = (cat.deals || []).filter(d => d.popup && dealOn(d) && d.productIds.some(id => byId[id] && byId[id].price != null && !byId[id].soldOut))
      .map(d => ({ type: 'deal', key: 'deal:' + d.id, d }));
    const codes = (cat.featured || []).filter(c => codeNow(c)).map(c => ({ type: 'code', key: c.code, c }));
    return [...deals, ...codes];
  }
  // 🔒 Newsletter "unlock": promo codes in pop-ups stay hidden until the customer leaves their email
  // (Staff → Settings → Newsletter). Once signed up on this phone, codes show straight away.
  const codeLocked = () => !!(cat.newsletter?.enabled && cat.newsletter.gateCodes && ls.get('dd-news', '') !== 'yes');
  function drawPopup() {
    const x = ppList[ppIdx]; if (!x) return;
    const isDeal = x.type === 'deal';
    const locked = !isDeal && codeLocked();
    $('#ppGate').hidden = !locked; $('#ppBtns').hidden = locked; $('#ppCode').classList.toggle('locked', locked);
    ppDlg.classList.toggle('is-deal', isDeal);
    if (isDeal) {
      const d = x.d, items = d.productIds.map(id => byId[id]).filter(it => it && it.price != null);
      $('#ppEyebrow').textContent = '🎉 Buy 1 Take 1';
      $('#ppTitle').textContent = d.title;
      $('#ppText').textContent = d.description; $('#ppText').hidden = !d.description;
      $('#ppCode').textContent = 'BUY 1 TAKE 1'; $('#ppLabel').textContent = d.pairCents != null ? `2 for ${pesos(d.pairCents)}` : 'The 2nd one is free';
      $('#ppRules').textContent = [items.slice(0, 3).map(i => i.name).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : ''),
        d.days?.length ? dayNames(d.days) : '', d.endsOn ? `Until ${niceEnd(d.endsOn)}` : '', d.maxPairs ? `Up to ${d.maxPairs} per order` : '',
        d.channel === 'both' ? 'Online & in store' : 'Online orders'].filter(Boolean).join(' · ');
      $('#ppUse').textContent = items.length === 1 ? `Order 2 ${items[0].name}` : 'Choose your drinks'; $('#ppUse').disabled = false;
      $('#ppCopy').hidden = true;
    } else {
      const c = x.c;
      $('#ppEyebrow').textContent = '🎟️ Promo code';
      $('#ppTitle').textContent = c.title || (c.kind === 'bogo' ? `${c.label}!` : `Get ${c.label} today!`);
      $('#ppText').textContent = c.text; $('#ppText').hidden = !c.text;
      $('#ppCode').textContent = locked ? '• • • • • •' : c.code; $('#ppLabel').textContent = c.label;
      $('#ppRules').textContent = [c.minCents ? `Minimum order ${pesos(c.minCents)}` : '', c.startTime ? `${t12c(c.startTime)} – ${t12c(c.endTime)} only` : '', c.endsOn ? `Until ${niceEnd(c.endsOn)}` : '',
        c.channel === 'both' ? 'Online, or show this code at the counter' : 'For online orders'].filter(Boolean).join(' · ');
      const using = promo?.code === c.code;
      $('#ppUse').textContent = using ? '✓ Applied to your order' : 'Use this code'; $('#ppUse').disabled = using;
      $('#ppCopy').hidden = false;
    }
    // Opened from the banner: show the others to switch between. While popping up one by one: just this one.
    const others = ppAuto ? [] : ppList.filter((_, i) => i !== ppIdx);
    $('#ppOthers').hidden = !others.length;
    $('#ppOthers').innerHTML = others.length ? `<span>More promos:</span>${others.map(o => `<button type="button" data-pp="${esc(o.key)}">${o.type === 'deal' ? '🎉 ' + esc(o.d.title) : esc(o.c.code) + ' · ' + esc(o.c.label)}</button>`).join('')}` : '';
    ppMark(x.key);
  }
  function openPopup(key, auto = false) {
    ppList = ppItems(); if (!ppList.length) return;
    ppAuto = auto;
    ppIdx = Math.max(0, ppList.findIndex(x => x.key === key));
    drawPopup();
    if (!ppDlg.open) ppDlg.showModal();
    renderPromoChip();
  }
  const closePopup = () => { if (ppDlg.open) ppDlg.close(); };
  $('#ppGate').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#ppEmail').value.trim(), note = $('#ppGateNote');
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { note.textContent = 'Please enter a valid email address, like name@gmail.com.'; note.classList.add('err'); $('#ppEmail').focus(); return; }
    $('#ppUnlock').disabled = true; note.textContent = ''; note.classList.remove('err');
    try {
      await api('/api/news', { method: 'POST', body: JSON.stringify({ email, name: ($('#o-name').value || '').trim().split(' ')[0], phone: stamp.phone || '', source: 'promo', website: $('#ppHp').value }) });
      ls.set('dd-news', 'yes'); document.querySelectorAll('.news-open').forEach(b => { b.hidden = true; });
      drawPopup(); renderPromoChip(); toast('🎉 Unlocked! You can use the code now.');
    } catch (err) { note.textContent = err.message; note.classList.add('err'); }
    $('#ppUnlock').disabled = false;
  });
  $('#ppClose').onclick = $('#ppLater').onclick = closePopup;
  ppDlg.addEventListener('click', e => { if (e.target === ppDlg) closePopup(); }); // tap outside to close
  // When one closes (by any button, Esc or tapping outside), the next unseen one shows 2 seconds later.
  ppDlg.addEventListener('close', () => {
    if (!ppAuto) return;
    clearTimeout(ppTimer);
    ppTimer = setTimeout(function next() {
      const key = ppQueue.shift(); if (!key) { ppAuto = false; return; }
      if (!ppItems().some(x => x.key === key) || (promo && !key.startsWith('deal:'))) return next();
      if (document.querySelector('dialog[open]') || drawer.classList.contains('open') || document.hidden) { ppQueue.unshift(key); ppTimer = setTimeout(next, 4000); return; }
      openPopup(key, true);
    }, 2000);
  });
  $('#ppOthers').addEventListener('click', e => { const b = e.target.closest('[data-pp]'); if (b) { ppIdx = ppList.findIndex(x => x.key === b.dataset.pp); drawPopup(); } });
  $('#ppCopy').onclick = async () => {
    const code = ppList[ppIdx]?.c?.code; if (!code) return;
    try { await navigator.clipboard.writeText(code); toast(`${code} copied`); } catch { toast(`Your code: ${code}`); }
  };
  $('#ppUse').onclick = async () => {
    const x = ppList[ppIdx]; if (!x) return;
    if (x.type === 'deal') {
      const items = x.d.productIds.filter(id => byId[id] && byId[id].price != null && !byId[id].soldOut);
      ppQueue = []; ppAuto = false; closePopup();
      if (items.length === 1) { startAdd(items[0]); dlgQty = 2; refreshDlg(); return; }
      filter = 'deal:' + x.d.id; renderFilters(); render();
      document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
      toast(`Pick any 2: ${dealWhat(x.d)}`);
      return;
    }
    const c = x.c;
    $('#o-code').value = c.code; await applyCode();
    if (promo?.code === c.code) {
      ppQueue = []; ppAuto = false; closePopup();
      if (cart.length) openDrawer(); else toast(`${c.code} is saved. Add your drinks and it's taken off at checkout.`);
      document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
    } else drawPopup();
  };
  // Banner above the menu, so promos are easy to find again.
  function renderPromoChip() {
    const box = $('#statusBar');
    box.querySelectorAll('.sb.code').forEach(x => x.remove());
    const list = cat.deals ? ppItems() : (cat.featured || []).filter(c => codeNow(c)).map(c => ({ type: 'code', key: c.code, c }));
    if (!list.length) { if (!box.children.length) box.hidden = true; return; }
    const applied = list.find(x => x.type === 'code' && x.c.code === promo?.code);
    const x = applied || list[0];
    const text = x.type === 'deal' ? `🎉 <b>${esc(x.d.title)}</b>: ${esc(dealWhat(x.d))}`
      : applied ? `✅ <b>${esc(x.c.code)}</b> applied: ${esc(x.c.label)}` : codeLocked() ? `🎟️ <b>${esc(x.c.label)}</b> promo · tap to unlock 🔒` : `🎟️ Use code <b>${esc(x.c.code)}</b> for ${esc(x.c.label)}`;
    box.insertAdjacentHTML('afterbegin', `<button type="button" class="sb code" data-open-pp="${esc(x.key)}">${text}${list.length > 1 ? ` · +${list.length - 1} more` : ''}</button>`);
    box.hidden = false;
  }
  $('#statusBar').addEventListener('click', e => { const b = e.target.closest('[data-open-pp]'); if (b) { ppQueue = []; openPopup(b.dataset.openPp); } });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-bogo-show]'); if (!b || promo?.kind !== 'bogo') return;
    bogoFilter = b.dataset.bogoShow === 'buy' ? promo.bogo.buyIds : promo.bogo.getIds; filter = 'bogo'; renderFilters(); render(); closeDrawer();
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
  });
  document.addEventListener('click', e => { const b = e.target.closest('[data-f-deal]'); if (!b) return; filter = 'deal:' + b.dataset.fDeal; renderFilters(); render(); closeDrawer(); document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }); });
  // First pop-up a few seconds after the menu loads (once per visit; not while something else is open).
  function maybeAutoPopup() {
    renderPromoChip();
    if (ppStarted) return;
    // Only one code works per order, so once a code is applied, other codes don't pop up (deals still do).
    const fresh = ppItems().filter(x => !ppSeen()[x.key] && !ppOffered.has(x.key) && !(x.type === 'code' && promo)).map(x => x.key);
    if (!fresh.length) return;
    fresh.forEach(k => ppOffered.add(k));
    ppStarted = true; ppAuto = true; ppQueue = fresh.slice(1); // ppAuto: busy, so the every-minute check waits
    clearTimeout(ppTimer);
    ppTimer = setTimeout(function tryOpen() {
      if (document.querySelector('dialog[open]') || drawer.classList.contains('open') || document.hidden) { ppTimer = setTimeout(tryOpen, 4000); return; }
      openPopup(fresh[0], true);
    }, 3000);
  }

  // ---------- stamp card in the cart ----------
  const stampDots = (n, need) => `<div class="stamps">${Array.from({ length: need }, (_, i) => `<i class="${i < n ? 'on' : ''}">${i < n ? '🐾' : ''}</i>`).join('')}<i class="gift">🎁</i></div>`;
  // One card design for the cart and "My stamps": paws, "X more to a free drink", and today's stamp in plain words.
  const rewardWord = (cfg) => (cfg.ids?.length || cfg.cats?.length ? 'item' : 'drink');
  const maskP = (p) => (p ? `${p.slice(0, 4)}•••${p.slice(-4)}` : '');
  function stampCardHtml(c, cfg, adds) {
    const need = cfg.needed, have = Math.min(c.stamps, need), left = Math.max(0, need - c.stamps), w = rewardWord(cfg);
    let today;
    if (c.ready) today = cfg.online ? `Tick <b>Use my free ${w}</b> below, or show this number at the counter.` : `Show this number at the counter to get it. 🎉`;
    else if (adds > 0) today = `✅ This order adds <b>${adds} stamp${adds === 1 ? '' : 's'}</b>${c.stamps + adds >= need ? ` → your <b>free ${w}</b> is ready next time!` : ''} (counted once it's paid).`;
    else if (c.todayLeft === 0) today = c.pending ? `⏳ Today's stamp is waiting: it's added once your order is paid.` : `✅ You already got today's stamp. Come back tomorrow for the next one!`;
    else today = `☕ Order a ${w === 'drink' ? 'drink' : 'qualifying item'} today to get today's stamp.`;
    return `<div class="scard ${c.ready ? 'ready' : ''}">
      <div class="scard-top"><b>${esc(cfg.name)}</b><span>${esc(maskP(c.phone))}</span></div>
      ${stampDots(have, need)}
      <p class="scard-main">${c.ready ? `🎉 <b>Your free ${w} is ready!</b>` : `<b>${c.stamps} of ${need}</b> stamps · <b>${left} more</b> to a free ${w}`}</p>
      <p class="scard-today">${today}</p>
    </div>`;
  }
  function renderStamp(loy) {
    const cfg = cat.loyalty || {};
    $('#stampF').hidden = !cfg.enabled; $('#visitStamps').hidden = !cfg.enabled; $('.nav-stamps').hidden = !cfg.enabled; $('.stamps-mini').hidden = !cfg.enabled;
    if (!cfg.enabled) return;
    const w = rewardWord(cfg);
    $('#stampHow').innerHTML = `Type your mobile number: <b>${cfg.perDay ? `${cfg.perDay === 1 ? '1 stamp' : cfg.perDay + ' stamps'} a day` : '1 stamp per ' + w}</b> when you order a ${w === 'drink' ? 'drink' : 'qualifying item'}. <b>${cfg.needed} stamps = a free ${w}!</b>`;
    if (document.activeElement !== $('#o-stamp') && !$('#o-stamp').value && stamp.phone) $('#o-stamp').value = stamp.phone;
    $('#stampCheck').textContent = stamp.card ? 'Change' : 'Add';
    const c = stamp.card, box = $('#stampInfo');
    box.hidden = !c; if (!c) return;
    box.innerHTML = stampCardHtml(c, cfg, c.ready ? 0 : (loy?.earn || 0))
      + (c.ready && cfg.online ? `<label class="switchrow sm use-free"><input type="checkbox" class="toggle" id="stampUse" ${stamp.redeem ? 'checked' : ''}> Use my free ${w} on this order${loy?.off ? ` (−${pesos(loy.off)})` : ''}</label>` : '');
  }
  // ---------- "My stamps" window: how it works + check your card
  function stampSteps(cfg) {
    const w = rewardWord(cfg), daily = cfg.perDay ? `${cfg.perDay === 1 ? '1 stamp' : cfg.perDay + ' stamps'} per day` : `1 stamp per ${w}`;
    return [`Order a ${w === 'drink' ? 'drink' : 'qualifying item'} and type your <b>mobile number</b> in the cart (or tell the cashier).`,
      `You get <b>${daily}</b>. It's added once your order is <b>paid</b>.`,
      `Collect <b>${cfg.needed} stamps</b> → your next ${w} is <b>free</b>${cfg.maxCents ? ` (up to ${pesos(cfg.maxCents)})` : ''}. ${cfg.online ? 'Use it in the cart or at the counter.' : 'Claim it at the counter.'}`,
      `Forgot your number? Tap <b>Claim today's stamp</b> on today's order under <b>Your orders</b>. Stamps can only be claimed on the same day.`]
      .map(x => `<li>${x}</li>`).join('');
  }
  function openStamps() {
    const cfg = cat.loyalty || {}; if (!cfg.enabled) return;
    $('#sdlgName').textContent = cfg.name; $('#sdlgSteps').innerHTML = stampSteps(cfg);
    if (!$('#sdlgPhone').value && stamp.phone) $('#sdlgPhone').value = stamp.phone;
    $('#sdlgCard').innerHTML = stamp.card ? stampCardHtml(stamp.card, cfg, 0) : '';
    $('#stampDlg').showModal();
    if (stamp.phone && !stamp.card) sdlgCheck();
  }
  async function sdlgCheck() {
    const v = $('#sdlgPhone').value.trim(); if (!v) return $('#sdlgPhone').focus();
    $('#sdlgCheck').disabled = true;
    try {
      const c = await api('/api/orders?stamps=' + encodeURIComponent(v));
      const phone = v.replace(/\D/g, '').replace(/^63/, '0').replace(/^9/, '09');
      stamp = { ...stamp, phone, card: { ...c, phone } }; ls.set('dd-stamp-phone', phone); $('#sdlgPhone').value = phone; $('#o-stamp').value = phone;
      $('#sdlgCard').innerHTML = stampCardHtml(stamp.card, cat.loyalty, 0) + (c.stamps === 0 && !c.pending ? '<p class="hint-sm">No stamps yet on this number. Your first one comes with your next order!</p>' : '');
      renderCart();
    } catch (err) { $('#sdlgCard').innerHTML = `<p class="err-t">${esc(err.message)}</p>`; }
    $('#sdlgCheck').disabled = false;
  }
  $('#sdlgCheck').onclick = sdlgCheck;
  $('#sdlgPhone').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sdlgCheck(); } });
  $('#sdlgClose').onclick = () => $('#stampDlg').close();
  $('#stampDlg').addEventListener('click', e => { if (e.target === $('#stampDlg')) $('#stampDlg').close(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-open-stamps], #navStamps, #visitStamps')) { e.preventDefault(); openStamps(); } });
  async function checkStamp(quiet, keepNote) {
    const v = $('#o-stamp').value.trim() || stamp.phone; if (!v || !cat.loyalty?.enabled) return;
    try {
      const c = await api('/api/orders?stamps=' + encodeURIComponent(v));
      const phone = v.replace(/\D/g, '').replace(/^63/, '0').replace(/^9/, '09');
      stamp = { ...stamp, phone, card: { ...c, phone } }; ls.set('dd-stamp-phone', phone); $('#o-stamp').value = phone;
    } catch (err) { stamp.card = null; if (!quiet) setNote(err.message, true); }
    if (keepNote) renderStamp(cartMath().loy); else renderCart(); // keepNote: don't replace "Order sent" with the empty-cart text
  }
  $('#stampCheck').onclick = () => checkStamp(false);
  $('#o-stamp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkStamp(false); } });
  $('#o-stamp').addEventListener('input', () => { if (stamp.card) { stamp.card = null; stamp.redeem = false; renderCart(); } });
  $('#stampInfo').addEventListener('change', e => { if (e.target.id === 'stampUse') { stamp.redeem = e.target.checked; renderCart(); } });


  // ---------- "Add something?" suggestions in the cart (same order as the POS: lib/upsell.js) ----------
  // Promo bundles made as their own product ("Brownies (b1t1)", "… bundle") are never suggested.
  const BUNDLE_NAME = /\bb1t1\b|buy\s*1\s*take\s*1|\bbundle\b|\bpromo\b/i;
  function suggestions(max = 10) {
    const up = cat.upsell; if (!up?.enabled || !cart.length) return [];
    const inCart = new Set(cart.map(l => l.id)), out = [], only = up.onlyCats || [];
    const push = (id, why) => { const it = byId[id]; if (it && it.price != null && !it.soldOut && !inCart.has(id) && !BUNDLE_NAME.test(it.name) && (!only.length || only.includes(it.cat)) && !out.some(o => o.id === id)) out.push({ id, why }); };
    for (const r of up.rules || []) if (cart.some(l => r.whenIds.includes(l.id) || r.whenCats.includes(byId[l.id]?.cat))) r.suggestIds.forEach(id => push(id, r.text));
    if (up.auto) cart.forEach(l => (up.pairs?.[l.id] || []).forEach(id => push(id, 'Often ordered together')));
    const kinds = new Set(cart.map(l => kindOf(byId[l.id]?.cat))), order = [...(up.popular || []), ...cat.items.map(i => i.id)];
    if (only.length) order.forEach(id => push(id, kinds.has('drink') ? 'Great with your drink' : '')); // best sellers first, then the menu order
    else {
      if (kinds.has('drink') && !kinds.has('food')) order.filter(id => byId[id]?.cat === 'pastries').forEach(id => push(id, 'Great with your drink'));
      if (kinds.has('food') && !kinds.has('drink')) order.filter(id => kindOf(byId[id]?.cat) === 'drink').forEach(id => push(id, 'Something to drink?'));
    }
    return out.slice(0, max);
  }
  function renderSuggest() {
    const list = suggestions(10), box = $('#cartSuggest');
    const keep = box.querySelector('.sug-row')?.scrollLeft || 0; // don't jump back to the start while scrolling
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<h4>Add something? <small>${list.length > 2 ? 'swipe for more →' : ''}</small></h4><div class="sug-row">` + list.map(x => { const it = byId[x.id], pr = promoFor(it);
      return `<div class="sug"><div class="sug-art">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : artFor(it)}</div>
        <b>${esc(it.name)}</b>
        <button class="btn sm" type="button" data-sug="${esc(it.id)}" aria-label="Add ${esc(it.name)}">+ ${pesos(it.price - (pr?.off || 0))}</button></div>`; }).join('') + '</div>' : '';
    const row = box.querySelector('.sug-row'); if (row) row.scrollLeft = keep;
  }
  $('#cartSuggest').addEventListener('click', e => {
    const b = e.target.closest('[data-sug]'); if (!b) return;
    const it = byId[b.dataset.sug]; if (!it) return;
    const drink = kindOf(it.cat) === 'drink', opts = drink ? { sweet: 75, ice: it.hot ? null : 'Regular ice' } : null;
    const key = it.id + '|' + JSON.stringify(opts) + '||up';
    const ex = cart.find(l => l.key === key);
    if (ex) ex.qty = Math.min(20, ex.qty + 1); else cart.push({ key, id: it.id, qty: 1, opts, addons: [], upsell: true });
    toast(`${it.name} added${drink ? ' (75% sweet, regular ice)' : ''}`); renderCart();
  });

  // ---------- order again (past orders are remembered on this phone) ----------
  const lineName = (l) => `${byId[l.id]?.name || ''}${l.qty > 1 ? ' × ' + l.qty : ''}`;
  const usable = (l) => { const it = byId[l.id]; return it && it.price != null && !it.soldOut; };
  function renderAgain() {
    const last = history.find(h => h.lines.some(usable));
    const show = !!last && !cart.length && apiState === 'ready';
    $('#againBar').hidden = !show;
    if (show) $('#againBar').innerHTML = `<span>👋 Welcome back! Your last order: <b>${esc(last.lines.filter(usable).map(lineName).join(', '))}</b></span><button class="btn" type="button" data-again="${esc(last.code)}">Order again</button>`;
  }
  function orderAgain(code) {
    const h = history.find(x => x.code === code); if (!h) return;
    let added = 0; const skipped = [];
    for (const l of h.lines) {
      if (!usable(l)) { skipped.push(byId[l.id]?.name || 'an item no longer on the menu'); continue; }
      const addons = (l.addons || []).filter(id => addonById[id]);
      const key = l.id + '|' + JSON.stringify(l.opts) + '|' + [...addons].sort().join(',');
      const ex = cart.find(c => c.key === key);
      if (ex) ex.qty = Math.min(20, ex.qty + l.qty); else cart.push({ key, id: l.id, qty: l.qty, opts: l.opts, addons });
      added += l.qty;
    }
    setNote(skipped.length ? `Not available right now: ${skipped.join(', ')}.` : '', !!skipped.length);
    renderCart(); openDrawer();
    if (added) toast(`${added} item${added === 1 ? '' : 's'} added from order #${code}`);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-again]'); if (b) orderAgain(b.dataset.again); });

  // ---------- my orders: status + messages ----------
  const openChats = new Set();
  // Each order keeps its own box. Live updates (every 4 s) only change the parts that changed, and never
  // replace the message box, so the keyboard stays open while the customer types.
  const setHtml = (el, html) => { if (el._h !== html) { el.innerHTML = html; el._h = html; return true; } return false; };
  function orderView(o) {
    const ps = o.paymentStatus || 'unpaid', qr = o.paymentMethod === 'qrph';
    const online = ['gcash', 'paymaya', 'card'].includes(o.paymentMethod);
    let st = o.status || 'new', label = STATUS[st], pill = st;
    if (o.orderType === 'delivery' && st === 'done') label = 'Delivered';
    if (o.orderType === 'delivery' && st === 'ready') label = 'Ready · rider on the way soon';
    if (o.scheduledFor && st === 'new') label = `Scheduled · ${whenWord(o.scheduledFor)}`;
    if (qr && ps === 'awaiting_proof') { label = 'Waiting for payment'; pill = 'pending'; }
    if (qr && ps === 'submitted') { label = 'Checking payment'; pill = 'pending'; }
    if (online && ps === 'pending') { label = 'Waiting for payment'; pill = 'pending'; }
    if (['rejected', 'expired', 'failed'].includes(ps)) { st = 'cancelled'; label = ps === 'rejected' ? 'Payment not found' : 'Payment not completed'; pill = 'cancelled'; }
    if (['voided', 'refunded'].includes(ps)) label = ps === 'refunded' ? 'Cancelled · refunded' : 'Cancelled';
    const n = (online && ps === 'pending') || (qr && ps !== 'paid') ? 0 : STEP[st];
    const payLine = qr ? `${o.qr?.image === '' && o.qr?.maya ? 'Maya' : PAY.qrph.replace(' QR', '')} QR · ${ps === 'paid' ? 'Paid' : ps === 'submitted' ? `Ref ${o.reference || ''} sent` : 'Not paid yet'}`
      : online ? `${PAY[o.paymentMethod]} · ${ps === 'paid' ? 'Paid' : ps === 'refunded' ? 'Refunded' : 'Not paid yet'}`
      : o.orderType === 'delivery' ? 'Cash on delivery' : 'Pay at counter';
    const main = `<div class="ord-top"><b>#${esc(o.code)}</b><span class="pill ${pill}">${label}</span></div>
      ${st === 'cancelled' ? '' : `<div class="track"><i class="${n >= 1 ? 'on' : ''}"></i><i class="${n >= 2 ? 'on' : ''}"></i><i class="${n >= 3 ? 'on' : ''}"></i></div>`}
      <small>${(o.items || []).map(i => `${i.qty} × ${esc(i.name)}${(i.addons || []).length ? ' (+' + i.addons.map(a => esc(a.name)).join(', ') + ')' : ''}`).join(', ')} · ${pesos(o.totalCents || 0)}${o.discountCents ? ` (${o.promoCode ? esc(o.promoCode) + ' ' : ''}−${pesos(o.discountCents)})` : ''}${o.deliveryFeeCents ? ` incl. ${pesos(o.deliveryFeeCents)} delivery` : ''}<br>${esc(payLine)} · ${esc(o.pickupLabel || '')} · ordered ${fmtTime(o.at)}</small>
      ${['new', 'making', 'delivering'].includes(st) && !(qr && ['awaiting_proof', 'rejected'].includes(ps)) && !(online && ps === 'pending') ? `<button class="btn ghost sm play-btn" type="button" data-play="${esc(o.id)}">🎮 Play while you wait</button>` : ''}
      ${o.stampPhone ? `<small class="stamp-on">🎟️ On stamp card ${esc(o.stampPhone)}</small>` : ''}
      ${o.stampable && cat.loyalty?.enabled ? (claimOpen.has(o.id)
        ? `<div class="claim-row" data-claim="${esc(o.id)}"><input inputmode="tel" maxlength="16" enterkeyhint="done" placeholder="Your mobile number" value="${esc(stamp.phone || '')}" aria-label="Mobile number"><button class="btn sm" type="button" data-claim-go>Claim</button></div>`
        : `<button class="btn ghost sm claim-btn" type="button" data-claim-open="${esc(o.id)}">🎟️ Claim today's stamp</button>`) : ''}
      ${st === 'done' && history.some(h => h.code === o.code) ? `<button class="linkbtn again-btn" type="button" data-again="${esc(o.code)}">↻ Order again</button>` : ''}
      ${online && ps === 'pending' && o.checkoutUrl ? `<a class="btn" href="${esc(o.checkoutUrl)}">Finish paying with ${PAY[o.paymentMethod]}</a>` : ''}
      ${qr && ['awaiting_proof', 'rejected'].includes(ps) && o.qr ? `<button class="btn" type="button" data-payqr="${esc(o.id)}">${ps === 'rejected' ? 'Send the correct reference' : 'Show QR and pay'}</button>` : ''}`;
    const canChat = st !== 'cancelled' && !(st === 'done' && Date.now() - o.at > 3 * 3600e3);
    return { st, main, canChat };
  }
  function renderMine() {
    ls.set('dd-orders', mine.map(o => ({ ...o, qr: undefined })));
    const box = $('#mine'); box.hidden = !mine.length;
    if (!box.querySelector(':scope > h3')) box.innerHTML = '<h3>Your orders</h3>';
    const ids = new Set(mine.map(o => o.id));
    box.querySelectorAll(':scope > [data-ord]').forEach(el => { if (!ids.has(el.dataset.ord)) el.remove(); });
    let prev = box.querySelector(':scope > h3');
    for (const o of mine) {
      let el = [...box.children].find(x => x.dataset.ord === o.id);
      if (!el) {
        el = document.createElement('div'); el.dataset.ord = o.id;
        const quick = o.orderType === 'delivery' ? ["Where's my order?", "I'm outside / at the gate", 'Thank you!'] : ['Is my order ready?', "I'm on my way", "I'm here"];
        el.innerHTML = `<div class="ord-main"></div>
          <div class="chat" hidden>
            <button class="chat-toggle" type="button" data-chat="${esc(o.id)}"></button>
            <div class="chat-body" hidden>
              <div class="chat-log" aria-live="polite"></div>
              <form class="chat-row" data-chat-form="${esc(o.id)}">
                <textarea data-chat-input="${esc(o.id)}" rows="1" maxlength="300" enterkeyhint="send" placeholder="Type your message…" aria-label="Your message to the cashier"></textarea>
                <button type="submit">Send</button>
              </form>
              <div class="chat-quick"><span>Quick:</span>${quick.map(q => `<button type="button" data-quick="${esc(o.id)}">${esc(q)}</button>`).join('')}</div>
            </div>
          </div>`;
      }
      if (el.previousElementSibling !== prev) prev.after(el);
      prev = el;
      const v = orderView(o), msgs = o.messages || [];
      el.className = `ord ${v.st}`;
      setHtml(el.querySelector('.ord-main'), v.main);
      const chatOpen = openChats.has(o.id);
      const unread = msgs.filter(m => m.from === 'staff' && new Date(m.at) > new Date(o.seenAt || 0)).length;
      el.querySelector('.chat').hidden = !(v.canChat || msgs.length);
      setHtml(el.querySelector('.chat-toggle'), `${chatOpen ? 'Hide messages' : msgs.length ? `💬 Messages (${msgs.length})` : '💬 Message the cashier'}${unread && !chatOpen ? ` <b>${unread} new</b>` : ''}`);
      el.querySelector('.chat-body').hidden = !chatOpen;
      el.querySelector('.chat-row').hidden = !v.canChat;
      el.querySelector('.chat-quick').hidden = !v.canChat;
      const log = el.querySelector('.chat-log');
      if (setHtml(log, msgs.map(m => `<div class="bubble-msg ${m.from === 'customer' ? 'me' : 'them'}">${esc(m.body)}<small>${m.from === 'customer' ? 'You' : "Demetria's"} · ${fmtTime(m.at)}</small></div>`).join('')
        || '<p class="hint-sm">Write to the cashier about your order, like changes, directions or questions. They reply here.</p>')) log.scrollTop = log.scrollHeight;
    }
    const ready = mine.find(o => (o.status === 'ready' || o.status === 'delivering') && !told[o.id + o.status]);
    if (ready) { told[ready.id + ready.status] = 1; if (ready.notify) toast(ready.status === 'delivering' ? `Order #${ready.code} is on the way!` : `Order #${ready.code} is ready for pickup!`); }
  }
  async function sendChat(id, text, input) {
    const o = mine.find(x => x.id === id); if (!o || !text.trim()) return false;
    try {
      const s = await api(`/api/orders/${encodeURIComponent(o.id)}`, { method: 'POST', body: JSON.stringify({ token: o.token, action: 'message', body: text.trim() }) });
      Object.assign(o, { messages: s.messages, seenAt: new Date().toISOString() });
      renderMine(); return true;
    } catch (err) { toast(err.message); if (input && !input.value) input.value = text; return false; }
  }
  // ---------- "Play while you wait": Pearl Catch (js/game.js, loaded only when someone taps Play)
  let gameLoad = null;
  function playGame(id) {
    const live = () => mine.find(x => x.id === id);
    gameLoad = gameLoad || new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = '/js/game.js'; sc.onload = ok; sc.onerror = () => { gameLoad = null; no(); }; document.head.append(sc); });
    gameLoad.then(() => window.DDGame.open(live)).catch(() => toast("The game couldn't load. Check your connection."));
  }
  const claimOpen = new Set();
  // (a <div>, not a <form>: "Your orders" sits inside the checkout form, and forms can't be nested)
  $('#mine').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('[data-claim] input')) { e.preventDefault(); claimStamp(e.target.closest('[data-claim]')); } });
  async function claimStamp(f) {
    const o = mine.find(x => x.id === f.dataset.claim); if (!o) return;
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Claiming…';
    try {
      const r = await api(`/api/orders/${encodeURIComponent(o.id)}`, { method: 'POST', body: JSON.stringify({ token: o.token, action: 'stamp', phone: f.querySelector('input').value }) });
      Object.assign(o, { stampPhone: r.stampPhone, stampable: r.stampable }); claimOpen.delete(o.id);
      const phone = f.querySelector('input').value.replace(/\D/g, '').replace(/^63/, '0').replace(/^9/, '09');
      stamp = { ...stamp, phone, card: null }; ls.set('dd-stamp-phone', phone); $('#o-stamp').value = phone;
      toast(r.claimed.paid ? `🎟️ Stamp added! You now have ${r.claimed.stamps} of ${r.claimed.needed}.` : `🎟️ Stamp claimed! It's added once your order is paid.`);
      checkStamp(true, true);
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Claim'; return; }
    renderMine();
  }
  $('#mine').addEventListener('click', e => {
    if (e.target.closest('[data-claim-go]')) return claimStamp(e.target.closest('[data-claim]'));
    const pl = e.target.closest('[data-play]'); if (pl) return playGame(pl.dataset.play);
    const co = e.target.closest('[data-claim-open]');
    if (co) { claimOpen.add(co.dataset.claimOpen); renderMine(); $(`[data-claim="${CSS.escape(co.dataset.claimOpen)}"] input`)?.focus(); return; }
    const t = e.target.closest('[data-chat]');
    if (t) {
      const id = t.dataset.chat, opening = !openChats.has(id);
      opening ? openChats.add(id) : openChats.delete(id);
      const o = mine.find(x => x.id === id); if (o) o.seenAt = new Date().toISOString();
      renderMine();
      if (opening) t.closest('[data-ord]')?.querySelector('[data-chat-input]:not([hidden])')?.focus(); // opens the keyboard on phones
      return;
    }
    const q = e.target.closest('[data-quick]'); if (q) return sendChat(q.dataset.quick, q.textContent);
    const p = e.target.closest('[data-payqr]'); if (p) openQr(mine.find(o => o.id === p.dataset.payqr));
  });
  $('#mine').addEventListener('submit', async e => {
    const f = e.target.closest('[data-chat-form]'); if (!f) return;
    e.preventDefault();
    const i = f.querySelector('textarea'), btn = f.querySelector('button'), v = i.value;
    if (!v.trim()) { i.focus(); return; }
    i.value = ''; i.style.height = ''; btn.disabled = true; btn.textContent = 'Sending…';
    await sendChat(f.dataset.chatForm, v, i);
    btn.disabled = false; btn.textContent = 'Send';
  });
  // Enter sends, Shift+Enter makes a new line; the box grows as you type.
  $('#mine').addEventListener('keydown', e => {
    const i = e.target.closest('[data-chat-input]'); if (!i || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault(); i.form.requestSubmit();
  });
  $('#mine').addEventListener('input', e => { const i = e.target.closest('[data-chat-input]'); if (i) { i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 120) + 'px'; } });

  // Live updates: every 4 s while you have an active order and the page is visible.
  const isLive = (o) => !['done', 'cancelled'].includes(o.status) && !['expired', 'failed'].includes(o.paymentStatus) || o.paymentStatus === 'rejected'
    || (o.status === 'done' && Date.now() - o.at < 3 * 3600e3 && openChats.has(o.id));
  let polling = false;
  async function pollMine() {
    if (polling) return; polling = true;
    const live = mine.filter(isLive);
    await Promise.all(live.map(async o => {
      try {
        const s = await api(`/api/orders/${encodeURIComponent(o.id)}?token=${encodeURIComponent(o.token)}`);
        const before = (o.messages || []).length;
        Object.assign(o, { code: s.code, status: s.status, items: s.items, totalCents: s.totalCents, deliveryFeeCents: s.deliveryFeeCents, orderType: s.orderType,
          discountCents: s.discountCents, promoCode: s.promoCode, scheduledFor: s.scheduledFor, stampPhone: s.stampPhone, stampable: s.stampable,
          pickupLabel: s.pickupLabel, paymentMethod: s.paymentMethod, paymentStatus: s.paymentStatus, checkoutUrl: s.checkoutUrl, reference: s.reference,
          qr: s.qr || o.qr, messages: s.messages, notify: true });
        const newStaff = s.messages.slice(before).filter(m => m.from === 'staff');
        if (newStaff.length && before) { toast(`Demetria's: ${newStaff.at(-1).body}`); openChats.add(o.id); }
        if (openChats.has(o.id)) o.seenAt = new Date().toISOString();
        checkBuild(s.build);
      } catch (e) { if (e.status === 404) mine = mine.filter(x => x !== o); }
    }));
    polling = false; renderMine();
  }
  setInterval(() => { if (!document.hidden && mine.some(isLive)) pollMine(); }, 4000);

  // ---------- place order ----------
  $('#orderForm').addEventListener('submit', async (e) => {
    e.preventDefault(); if (busy || !cart.length || apiState !== 'ready' || !cat.accepting) return;
    const name = $('#o-name').value.trim();
    if (!name) { setNote('Add a name so we can call out your order.', true); $('#o-name').focus(); return; }
    const del = isDelivery();
    const contact = { name, address: $('#d-address').value.trim(), landmark: $('#d-landmark').value.trim(), phone: $('#d-phone').value.trim() };
    ls.set('dd-contact', contact);
    if (del && contact.address.length < 5) { setNote('Type your full address (house no., street, barangay).', true); $('#d-address').focus(); return; }
    if (del && !/^(\+?63|0)9\d{9}$/.test(contact.phone.replace(/[^\d+]/g, ''))) { setNote('Enter a mobile number for the rider, like 0917 123 4567.', true); $('#d-phone').focus(); return; }
    busy = true; setNote(''); renderCart();
    try {
      const o = await api('/api/orders', { method: 'POST', body: JSON.stringify({
        name, note: $('#o-note').value.trim(), paymentMethod: payMethod(),
        orderType: del ? 'delivery' : 'pickup', pickupMinutes: +$('#o-pickup').value, scheduleAt: whenAt()?.toISOString(),
        delivery: del ? { lat: pin.lat, lng: pin.lng, address: contact.address, landmark: contact.landmark, phone: contact.phone } : undefined,
        items: cart.map(l => ({ id: l.id, qty: l.qty, opts: l.opts, addons: l.addons, ...(l.upsell ? { upsell: true } : {}) })),
        loyaltyPhone: stamp.card ? stamp.card.phone : undefined, loyaltyRedeem: !!(stamp.redeem && stamp.card?.ready && cat.loyalty?.online),
        promoCode: promo && cartCodeOff() ? promo.code : undefined,
      }) });
      mine = [{ ...o, at: Date.now() }, ...mine].slice(0, 5);
      history = [{ at: Date.now(), code: o.code, totalCents: o.totalCents, lines: cart.map(({ key, id, qty, opts, addons }) => ({ key, id, qty, opts, addons })) }, ...history].slice(0, 6);
      ls.set('dd-history', history);
      cart = []; $('#o-note').value = ''; $('#o-when').value = 'now';
      if (stamp.card) { const earned = o.loyaltyEarn || 0; stamp.redeem = false; checkStamp(true, true); if (earned) toast(`Order #${o.code} placed · +${earned} stamp${earned === 1 ? '' : 's'} once it's paid`); }
      promo = null; ls.set('dd-code', null);
      busy = false; renderCart(); renderMine();
      if (o.checkoutUrl) { location.href = o.checkoutUrl; return; }
      if (o.qr) { openQr(mine[0]); return; }
      setNote(`Order #${o.code} sent · ${pesos(o.totalCents)}. We'll start on it shortly.`);
      toast(`Order #${o.code} placed`);
      offerInstall(5000);
    } catch (err) {
      if (promo && err.message && err.message.includes(promo.code)) { promo = null; ls.set('dd-code', null); }
      busy = false; setNote(err.message || "Couldn't send your order. Check your connection and try again.", true); renderCart();
      if (err.status === 409) loadMenu();
    }
  });

  // ---------- pay with our own GCash / Maya QR ----------
  // A personal GCash can't be opened with the amount filled in, so we make each step one tap:
  // copy the amount, save the QR to Photos (GCash → Pay QR → Upload QR), open GCash, paste the reference back.
  const qrDlg = $('#qrDlg'); let qrOrder = null;
  const onPhone = /iphone|ipad|ipod|android|mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const onIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const amountText = (c) => { const v = (c || 0) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); }; // "119" / "119.50": what GCash's amount box takes
  let qrWallet = 'gcash';
  const WALLET = {
    gcash: { name: 'GCash', open: 'Open GCash', how: 'In GCash tap <b>Pay QR</b> → <b>Upload QR</b> (top right) → choose the QR you saved.', ref: "It's on your GCash receipt (<b>Ref No.</b>, 13 digits) or in the GCash text message.",
      ios: 'gcash://', android: 'com.globe.gcash.android', store: { ios: 'https://apps.apple.com/ph/app/gcash/id520020791', android: 'https://play.google.com/store/apps/details?id=com.globe.gcash.android' } },
    maya: { name: 'Maya', open: 'Open Maya', how: 'In Maya tap <b>Scan</b> (the QR icon) → <b>Upload QR</b> / the photo icon → choose the QR you saved.', ref: "It's on your Maya receipt (<b>Reference ID</b>) or in the Maya text message.",
      ios: 'paymaya://', android: 'com.paymaya', store: { ios: '', android: 'https://play.google.com/store/apps/details?id=com.paymaya' } },
  };
  function showWallet() {
    const o = qrOrder, w = WALLET[qrWallet], q = qrWallet === 'maya' ? o.qr.maya : o.qr;
    document.querySelectorAll('#qrTabs [data-wallet]').forEach(b => { const on = b.dataset.wallet === qrWallet; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('#qrTitle').textContent = `Pay with ${$('#qrTabs').hidden && qrWallet === 'gcash' ? 'GCash or Maya' : w.name}`;
    if ($('#qrImg').getAttribute('src') !== q.image) $('#qrImg').src = q.image;
    $('#qrImg').alt = `Demetria's Diner ${w.name} QR code`;
    $('#qrName').textContent = q.name || '—'; $('#qrNum').textContent = q.number || '—'; $('#qrCopy').hidden = !q.number;
    $('#ps2t').textContent = `Open ${w.name} and upload the QR`; $('#qrOpenG').textContent = w.open; $('#qrOpenG').className = `btn ${qrWallet}-btn`;
    $('#ps2h').innerHTML = w.how + (qrWallet === 'gcash' && $('#qrTabs').hidden ? ' Using Maya? Tap <b>Scan</b> → <b>Upload QR</b>.' : '');
    $('#ps4h').innerHTML = w.ref;
    $('#qrSave').textContent = '⬇️ Save QR to Photos';
  }
  $('#qrTabs').addEventListener('click', e => { const b = e.target.closest('[data-wallet]'); if (!b || !qrOrder) return; qrWallet = b.dataset.wallet; ls.set('dd-wallet', qrWallet); showWallet(); });
  function openQr(o) {
    if (!o || !o.qr) return;
    qrOrder = o;
    $('#qrCode').textContent = `Order #${o.code}`;
    $('#qrAmount').textContent = $('#qrAmount2').textContent = pesos(o.totalCents || 0);
    // GCash and/or Maya: tabs when the shop has both QRs (remembers the customer's last choice)
    const both = !!(o.qr.image && o.qr.maya?.image);
    qrWallet = o.qr.image ? (both && ls.get('dd-wallet', '') === 'maya' ? 'maya' : 'gcash') : 'maya';
    $('#qrTabs').hidden = !both;
    showWallet();
    // phone: save + open GCash. Computer: just scan the QR on the screen with your phone.
    qrDlg.classList.toggle('on-phone', onPhone);
    $('#ps1t').textContent = onPhone ? 'Save our QR to your photos' : `Scan this QR with ${both ? 'GCash or Maya' : WALLET[qrWallet].name} on your phone`;
    $('#qrSave').hidden = $('#qrSaveHint').hidden = !onPhone;
    $('#ps3n').textContent = onPhone ? '3' : '2'; $('#ps4n').textContent = onPhone ? '4' : '3';
    $('#qrSave').textContent = '⬇️ Save QR to Photos'; $('#qrAmtCopy').textContent = 'Copy amount';
    $('#qrRef').value = '';
    $('#qrNote').textContent = o.paymentStatus === 'rejected' ? "We couldn't find that payment. Check the reference number and send it again." : '';
    $('#qrNote').classList.toggle('err', o.paymentStatus === 'rejected');
    if (!qrDlg.open) qrDlg.showModal();
  }
  $('#qrClose').onclick = () => { qrDlg.close(); openDrawer(); };
  const copyText = async (t, btn, done) => {
    try { await navigator.clipboard.writeText(t); }
    catch { const i = document.createElement('textarea'); i.value = t; i.setAttribute('readonly', ''); i.style.position = 'fixed'; i.style.opacity = '0'; document.body.append(i); i.select(); try { document.execCommand('copy'); } catch {} i.remove(); }
    const was = btn.textContent; btn.textContent = done; setTimeout(() => { btn.textContent = was; }, 2200);
  };
  $('#qrCopy').onclick = () => copyText($('#qrNum').textContent.replace(/\s/g, ''), $('#qrCopy'), 'Copied ✓');
  $('#qrAmtCopy').onclick = () => { if (qrOrder) { copyText(amountText(qrOrder.totalCents), $('#qrAmtCopy'), 'Copied ✓'); toast(`Amount ${amountText(qrOrder.totalCents)} copied`); } };
  // Save the QR: the phone's share sheet ("Save Image") where it works, or a normal download
  $('#qrSave').onclick = async () => {
    const btn = $('#qrSave');
    try {
      const blob = await (await fetch($('#qrImg').src)).blob();
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const file = new File([blob], `demetrias-${qrWallet}-qr.${ext}`, { type: blob.type || 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); btn.textContent = `✓ Saved? Now open ${WALLET[qrWallet].name}`; return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      btn.textContent = '✓ Saved to Downloads/Photos';
    } catch { toast('Press and hold the QR, then tap Save to Photos.'); }
  };
  // Open the GCash app (it can't fill in the amount or the QR; the steps say what to tap)
  $('#qrOpenG').onclick = () => {
    const W = WALLET[qrWallet], store = onIOS ? W.store.ios : W.store.android;
    let left = false; const away = () => { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', away);
    setTimeout(() => { document.removeEventListener('visibilitychange', away); if (!left && !document.hidden) toast(`Couldn't open ${W.name}. Open it from your home screen.`); }, 2500);
    location.href = onIOS ? W.ios : `intent://#Intent;package=${W.android};action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;S.browser_fallback_url=${encodeURIComponent(store)};end`;
  };
  // Pasting a whole GCash message also works: we pick out the reference number.
  const cleanRef = (t) => { const v = String(t || '').trim(); const m = v.match(/ref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*[:.]?\s*([0-9][0-9 ]{7,20}[0-9])/i) || v.match(/\b(\d[\d ]{11,16}\d)\b/); return (m ? m[1] : v).replace(/\s+/g, ''); };
  $('#qrRef').addEventListener('paste', e => { const t = e.clipboardData?.getData('text'); if (t && /\D{3,}/.test(t.trim())) { e.preventDefault(); $('#qrRef').value = cleanRef(t); } });
  $('#qrPaste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { $('#qrRef').value = cleanRef(t); $('#qrNote').textContent = ''; $('#qrNote').classList.remove('err'); return; } } catch {}
    $('#qrRef').focus(); toast('Press and hold the box, then tap Paste.');
  };
  // Back from GCash: jump to the reference box
  document.addEventListener('visibilitychange', () => { if (!document.hidden && qrDlg.open && !$('#qrRef').value) $('#ps4').scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  $('#qrForm').addEventListener('submit', async e => {
    e.preventDefault();
    const ref = cleanRef($('#qrRef').value);
    if (!ref) { $('#qrNote').textContent = 'Paste the reference number from your GCash or Maya receipt.'; $('#qrNote').classList.add('err'); $('#qrRef').focus(); return; }
    $('#qrSend').disabled = true;
    try {
      const s = await api(`/api/orders/${encodeURIComponent(qrOrder.id)}`, { method: 'POST', body: JSON.stringify({ token: qrOrder.token, action: 'reference', reference: ref, wallet: qrWallet }) });
      Object.assign(qrOrder, { paymentStatus: s.paymentStatus, reference: s.reference, status: s.status, messages: s.messages });
      qrDlg.close(); renderMine(); openDrawer();
      setNote(`Thanks! We're checking ${WALLET[qrWallet].name} for reference ${s.reference}. Your order starts as soon as it's confirmed.`);
    } catch (err) { $('#qrNote').textContent = err.message; $('#qrNote').classList.add('err'); }
    $('#qrSend').disabled = false;
  });

  // ---------- load menu; stay up to date without reloading ----------
  let stampLooked = false;
  // ---------- newsletter sign-up pop-up (Staff → Settings → Newsletter) ----------
  // Shows once after a short visit (never over the cart or another window); "No thanks" hides it for 14 days.
  // Also opens from the footer and "My stamps". Signed-up people never see it again on this phone.
  const news = { cfg: null, timer: 0, code: null };
  const newsSeen = () => ls.get('dd-news', '') === 'yes' || Date.now() - (ls.get('dd-news-later', 0) || 0) < 14 * 86400e3;
  function applyNews() {
    const c = cat.newsletter; news.cfg = c?.enabled ? c : null;
    document.querySelectorAll('.news-open').forEach(b => { b.hidden = !news.cfg || ls.get('dd-news', '') === 'yes'; });
    if (!news.cfg) return;
    $('#newsTitle').textContent = c.title; $('#newsText').textContent = c.text; $('#newsGo').textContent = c.button; $('#newsGift').hidden = !c.gift;
    if (!news.timer && !newsSeen()) news.timer = setTimeout(autoNews, (c.delay || 25) * 1000);
  }
  function autoNews() {
    if (!news.cfg || newsSeen()) return;
    if (document.querySelector('dialog[open]') || drawer.classList.contains('open') || document.getElementById('splash')) { news.timer = setTimeout(autoNews, 6000); return; }
    openNews('popup');
  }
  function openNews(source) {
    if (!news.cfg) return;
    news.source = source;
    $('#newsMain').hidden = false; $('#newsDone').hidden = true; $('#newsNote').textContent = '';
    if (!$('#newsName').value) $('#newsName').value = ($('#o-name').value || '').trim().split(' ')[0];
    if (!$('#newsDlg').open) $('#newsDlg').showModal();
  }
  const closeNews = (later) => { if (later && ls.get('dd-news', '') !== 'yes') ls.set('dd-news-later', Date.now()); $('#newsDlg').close(); };
  $('#newsClose').onclick = () => closeNews(true);
  $('#newsDlg').addEventListener('cancel', () => { if (ls.get('dd-news', '') !== 'yes') ls.set('dd-news-later', Date.now()); });
  $('#newsDlg').addEventListener('click', e => { if (e.target === $('#newsDlg')) closeNews(true); });
  $('#newsOk').onclick = () => closeNews(false);
  document.addEventListener('click', e => { if (e.target.closest('.news-open')) { e.preventDefault(); if ($('#stampDlg').open) $('#stampDlg').close(); openNews(e.target.closest('#stampDlg') ? 'stamps' : 'footer'); } });
  $('#newsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#newsEmail').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { $('#newsNote').textContent = 'Please enter a valid email address, like name@gmail.com.'; $('#newsNote').classList.add('err'); $('#newsEmail').focus(); return; }
    $('#newsGo').disabled = true; $('#newsNote').classList.remove('err'); $('#newsNote').textContent = '';
    try {
      const r = await api('/api/news', { method: 'POST', body: JSON.stringify({ email, name: $('#newsName').value, phone: stamp.phone || '', source: news.source || 'popup', website: $('#newsHp').value }) });
      ls.set('dd-news', 'yes'); news.code = r.code;
      $('#newsMain').hidden = true; $('#newsDone').hidden = false;
      $('#newsCodeBox').hidden = !r.code; if (r.code) $('#newsCode').textContent = r.code;
      document.querySelectorAll('.news-open').forEach(b => { b.hidden = true; });
    } catch (err) { $('#newsNote').textContent = err.message; $('#newsNote').classList.add('err'); }
    $('#newsGo').disabled = false;
  });
  $('#newsCopy').onclick = async () => { try { await navigator.clipboard.writeText(news.code || ''); } catch {} $('#newsCopy').textContent = 'Copied ✓'; setTimeout(() => { $('#newsCopy').textContent = 'Copy'; }, 2000); };
  $('#newsUse').onclick = () => { $('#newsDlg').close(); $('#o-code').value = news.code || ''; openDrawer(); setTimeout(() => { $('#codeApply').click(); $('#o-code').scrollIntoView({ block: 'center' }); }, 350); };
  // privacy notice
  document.addEventListener('click', e => { if (e.target.closest('#privacyOpen, [data-privacy]')) { e.preventDefault(); $('#privacyDlg').showModal(); } });
  $('#privClose').onclick = $('#privOk').onclick = () => $('#privacyDlg').close();

  // ---------- for Google: business details (hours and menu with prices) as structured data, always up to date
  // https://schema.org/CafeOrCoffeeShop · read by Google when it renders the page. The address comes from your
  // Google Business Profile, so it isn't repeated here.
  function seoData() {
    try {
      const origin = location.origin, days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const hm = (t) => String(t || '').slice(0, 5);
      const hours = [0, 1, 2, 3, 4, 5, 6].map((i) => cat.hours?.days?.[i]).map((d, i) => (d && !d.closed ? { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/' + days[i], opens: hm(d.open), closes: hm(d.close) } : null)).filter(Boolean);
      const sections = {};
      for (const it of cat.items || []) {
        if (it.price == null || BUNDLE_NAME.test(it.name)) continue;
        const sec = sections[it.cat] = sections[it.cat] || { '@type': 'MenuSection', name: CAT_LABEL?.[it.cat] || it.cat, hasMenuItem: [] };
        sec.hasMenuItem.push({ '@type': 'MenuItem', name: it.name, ...(it.desc ? { description: it.desc } : {}), offers: { '@type': 'Offer', price: (it.price / 100).toFixed(2), priceCurrency: 'PHP', availability: it.soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } });
      }
      const data = {
        '@context': 'https://schema.org', '@type': 'CafeOrCoffeeShop', '@id': origin + '/#cafe',
        name: "Demetria's Diner", slogan: 'Come for the drinks, stay for the comfort.', url: origin + '/',
        logo: origin + '/icons/icon-512.png', image: [origin + '/icons/og-image.jpg'],
        servesCuisine: ['Coffee', 'Matcha', 'Milk Tea', 'Filipino', 'Silog', 'Pastries'], priceRange: '₱', currenciesAccepted: 'PHP',
        paymentAccepted: 'Cash, GCash, Maya', acceptsReservations: false,
        sameAs: ['https://www.facebook.com/demetriasblngsn'],
        ...(hours.length ? { openingHoursSpecification: hours } : {}),
        hasMenu: { '@type': 'Menu', name: 'Menu', url: origin + '/#menu', hasMenuSection: Object.values(sections) },
        potentialAction: { '@type': 'OrderAction', target: { '@type': 'EntryPoint', urlTemplate: origin + '/#menu', actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] }, deliveryMethod: ['http://purl.org/goodrelations/v1#DeliveryModePickUp', 'http://purl.org/goodrelations/v1#DeliveryModeOwnFleet'] },
      };
      let el = document.getElementById('ld-cafe');
      if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ld-cafe'; document.head.append(el); }
      el.textContent = JSON.stringify(data);
      // one address for Google: the one people are on (your .com once it's connected)
      let c = document.querySelector('link[rel=canonical]');
      if (!c) { c = document.createElement('link'); c.rel = 'canonical'; document.head.append(c); }
      c.href = origin + '/';
    } catch (e) { console.warn('seo', e); }
  }
  // ---------- loading screen: leaves once the menu is ready (at least a short moment so it doesn't flash, at most 6 s)
  const splashT0 = performance.now();
  function hideSplash() {
    const el = document.getElementById('splash'); if (!el || el.classList.contains('out')) return;
    let seen = false; try { seen = !!sessionStorage.getItem('dd-splash'); sessionStorage.setItem('dd-splash', '1'); } catch {}
    const wait = Math.max(0, (seen ? 0 : 1100) - (performance.now() - splashT0));
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 800); }, wait);
  }
  setTimeout(hideSplash, 6000); // slow or no signal: show the saved menu instead of waiting
  function apply(d) {
    cat = d; byId = Object.fromEntries(d.items.map(i => [i.id, i])); addonById = Object.fromEntries(d.addons.map(a => [a.id, a]));
    if (d.categories) CAT_LABEL = d.categories;
    renderFilters();
    apiState = 'ready';
    if (pin && cat.delivery.enabled) pin = { ...quote(pin.lat, pin.lng) };
    lastSig = promoSig();
    render(); applyHero(); applyPay(); applyDelivery(); renderHours(); applyWhen(); renderCart(); maybeAutoPopup(); hideSplash(); seoData(); applyNews();
    if (cat.loyalty?.enabled && stamp.phone && !stamp.card && !stampLooked) { stampLooked = true; checkStamp(true); }
  }
  async function loadMenu() {
    try { apply(await api('/api/menu')); checkBuild(cat.build); }
    catch (e) { if (!e.status) console.error('Menu update failed:', e); if (apiState !== 'ready') { apiState = 'down'; renderCart(); } hideSplash(); }
  }
  // A new version of the site was deployed → reload at a safe moment (cart is saved).
  let firstBuild = null, reloadWanted = false;
  function checkBuild(b) {
    if (!b) return;
    if (!firstBuild) { firstBuild = b; return; }
    if (b !== firstBuild) { reloadWanted = true; maybeReload(); }
  }
  function maybeReload() {
    if (!reloadWanted) return;
    const busyNow = document.querySelector('dialog[open]') || busy || drawer.contains(document.activeElement) && document.activeElement.matches('input,textarea,select');
    if (busyNow && !document.hidden) return;
    location.reload();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); pollMine(); } else maybeReload(); });
  async function sync() {
    try {
      const s = await api('/api/menu?sync=1');
      checkBuild(s.build);
      if (s.v !== cat.v) await loadMenu();
    } catch {}
  }
  setInterval(() => { if (!document.hidden) { sync(); maybeReload(); } }, 15000);

  // Back from PayMongo: /?order=<id>&t=<token>&paid=1 | &cancelled=1
  (function handleReturn() {
    const u = new URL(location.href), id = u.searchParams.get('order'), t = u.searchParams.get('t');
    if (!id || !t) return;
    if (!mine.find(o => o.id === id)) mine.unshift({ id, token: t, code: '…', at: Date.now(), paymentStatus: 'pending' });
    const cancelled = u.searchParams.has('cancelled');
    window.history.replaceState(null, '', location.pathname + '#menu'); // window.history: "history" above is our saved-orders list
    setTimeout(() => { openDrawer(); setNote(cancelled ? "Payment wasn't completed, so your order hasn't been sent. You can finish paying below." : 'Thanks! Confirming your payment…', cancelled); }, 300);
  })();

  // ---------- install as an app ("Add to Home Screen") ----------
  // Every phone gets it: Android Chrome/Edge/Samsung show the real "Install" box; iPhones (Safari, Chrome, Edge…)
  // get picture-free step-by-step instructions for their browser; Facebook/Messenger/Instagram/TikTok browsers
  // can't install, so we explain how to open the page in Safari/Chrome (with a Copy link button).
  // The bar shows on the first visit (after a few seconds), and again 7 days after "Not now".
  // "📱 Get the app" buttons (menu bar, Visit us, footer) are always there until it's installed.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  const UA = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(UA);
  const inApp = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|TikTok|musical_ly|Bytedance|Snapchat|Twitter|; wv\)/i.test(UA);
  const iosBrowser = /CriOS/i.test(UA) ? 'Chrome' : /EdgiOS/i.test(UA) ? 'Edge' : /FxiOS/i.test(UA) ? 'Firefox' : /OPiOS|OPT\//i.test(UA) ? 'Opera' : 'Safari';
  const samsung = /SamsungBrowser/i.test(UA), andFirefox = isAndroid && /Firefox/i.test(UA);
  const isPhone = isIOS || isAndroid || /mobile/i.test(UA);
  let installEvt = null;
  try { if (!sessionStorage.getItem('dd-visit')) { sessionStorage.setItem('dd-visit', '1'); ls.set('dd-visits', (ls.get('dd-visits', 0) || 0) + 1); } } catch {}
  const canOffer = () => !standalone && (isPhone || !!installEvt);
  const snoozed = () => Date.now() - (ls.get('dd-install-later', 0) || 0) < 7 * 86400e3;
  const showButtons = () => document.querySelectorAll('.get-app').forEach(b => { (b.closest('.nav-app') || b).hidden = !canOffer(); });
  function installSteps() {
    const share = '<span class="ios-share" aria-hidden="true">⬆︎</span>';
    if (inApp) return { title: 'Open in your browser first', copy: true, steps: [
      `This page is open inside ${/Instagram/i.test(UA) ? 'Instagram' : /TikTok|musical_ly|Bytedance/i.test(UA) ? 'TikTok' : /Messenger|Orca/i.test(UA) ? 'Messenger' : 'Facebook'}, which can't add apps to your home screen.`,
      `Tap the <b>⋯</b> (or <b>⋮</b>) menu at the top or bottom of the screen and choose <b>Open in ${isIOS ? 'Safari' : 'Chrome'}</b> (or <b>Open in browser</b>).`,
      `No menu? Tap <b>Copy link</b> below, open <b>${isIOS ? 'Safari' : 'Chrome'}</b>, and paste it in the address bar.`,
      `Then tap <b>📱 Get the app</b> again on our page.`] };
    if (isIOS) {
      if (iosBrowser === 'Safari') return { steps: [`Tap the <b>Share</b> button ${share} at the bottom of the screen (top right on iPad).`, 'Scroll down and tap <b>Add to Home Screen</b> ➕.', 'Tap <b>Add</b> (top right). The cat icon 🐱 is now on your home screen!'] };
      if (iosBrowser === 'Chrome' || iosBrowser === 'Edge') return { copy: true, steps: [`Tap the <b>Share</b> button ${share} at the ${iosBrowser === 'Chrome' ? 'top right, next to the address bar' : 'bottom of the screen'}.`, 'Scroll down and tap <b>Add to Home Screen</b> ➕. (Don\'t see it? Update your iPhone, or open this page in <b>Safari</b>.)', 'Tap <b>Add</b>. The cat icon 🐱 is now on your home screen!'] };
      return { copy: true, steps: ['On iPhone, this works best in <b>Safari</b>. Tap <b>Copy link</b> below, open <b>Safari</b>, and paste it.', `In Safari, tap <b>Share</b> ${share} → <b>Add to Home Screen</b> → <b>Add</b>.`] };
    }
    if (samsung) return { steps: ['Tap the <b>≡</b> menu at the bottom right.', 'Tap <b>Add page to</b> → <b>Home screen</b> (or <b>Install</b> if you see it).', 'Tap <b>Add</b>. The cat icon 🐱 is now on your home screen!'] };
    if (andFirefox) return { steps: ['Tap the <b>⋮</b> menu.', 'Tap <b>Install</b> (or <b>Add to Home screen</b>).', 'Tap <b>Add</b>. The cat icon 🐱 is now on your home screen!'] };
    if (isAndroid) return { steps: ['Tap the <b>⋮</b> menu at the top right of Chrome.', 'Tap <b>Add to Home screen</b> (or <b>Install app</b>).', 'Tap <b>Install</b> / <b>Add</b>. The cat icon 🐱 is now on your home screen!'] };
    return { steps: ['Open this page on your phone.', 'iPhone: Safari → <b>Share</b> → <b>Add to Home Screen</b>. Android: Chrome → <b>⋮</b> → <b>Add to Home screen</b>.'] };
  }
  function openInstall() {
    hideInstall();
    if (installEvt) return nativeInstall();
    const h = installSteps();
    $('#iosTitle').textContent = h.title || "Add Demetria's to your home screen";
    $('#instSteps').innerHTML = h.steps.map(x => `<li>${x}</li>`).join('');
    $('#instCopy').hidden = !h.copy; $('#instUrl').value = location.origin + '/';
    $('#iosDlg').showModal();
  }
  async function nativeInstall() {
    const e = installEvt; installEvt = null; e.prompt();
    const r = await e.userChoice.catch(() => ({}));
    if (r.outcome !== 'accepted') ls.set('dd-install-later', Date.now());
    showButtons();
  }
  function offerInstall(after = 8000) {
    if (!canOffer() || snoozed()) return;
    clearTimeout(offerInstall.t);
    offerInstall.t = setTimeout(() => {
      // wait politely while a pop-up, the cart, or a window is open
      if (document.querySelector('dialog[open]') || drawer.classList.contains('open')) return offerInstall(5000);
      if (!canOffer() || snoozed()) return;
      $('#installSub').textContent = installEvt ? 'Order in two taps from your home screen. Free, no app store.' : inApp ? 'Open this page in your browser to add it to your home screen.' : 'Put the cat icon on your home screen: order in two taps. Free, no app store.';
      $('#installBtn').textContent = installEvt ? 'Install' : 'Show me how';
      $('#installBar').hidden = false; requestAnimationFrame(() => $('#installBar').classList.add('show'));
    }, after);
  }
  function hideInstall() { $('#installBar').classList.remove('show'); setTimeout(() => { $('#installBar').hidden = true; }, 300); }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; showButtons(); offerInstall(6000); });
  window.addEventListener('appinstalled', () => { installEvt = null; hideInstall(); ls.set('dd-installed', 1); document.querySelectorAll('.get-app').forEach(b => { (b.closest('.nav-app') || b).hidden = true; }); toast("Demetria's is on your home screen 🐱"); });
  $('#installBtn').onclick = openInstall;
  $('#installClose').onclick = () => { ls.set('dd-install-later', Date.now()); hideInstall(); };
  document.addEventListener('click', e => { if (e.target.closest('.get-app')) { e.preventDefault(); openInstall(); } });
  $('#iosOk').onclick = () => $('#iosDlg').close();
  $('#iosX').onclick = () => $('#iosDlg').close();
  $('#instCopyBtn').onclick = async () => {
    const u = $('#instUrl');
    try { await navigator.clipboard.writeText(u.value); } catch { u.select(); document.execCommand?.('copy'); }
    $('#instCopyBtn').textContent = 'Copied ✓'; setTimeout(() => { $('#instCopyBtn').textContent = 'Copy link'; }, 2000);
  };
  if (location.hash === '#app') setTimeout(openInstall, 600);
  showButtons();
  if (!(isAndroid && !inApp && !samsung && !andFirefox)) offerInstall(8000); // Android Chrome: wait for its own install event (fallback below)
  else setTimeout(() => { if (!installEvt) offerInstall(0); }, 9000);

  applyHero(); applyPay(); applyDelivery(); renderCart(); renderMine();
  loadMenu(); pollMine();
})();