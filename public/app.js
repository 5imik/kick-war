'use strict';

/* OPIOR (Gougoule) vs YAYA (Résistance) - front-end */

const SVGNS = 'http://www.w3.org/2000/svg';
const W = 1000, H = 560;
const COL = { russia: '#e23b3b', ukraine: '#3b82f6' };

const state = {
  data: null, fetchedAt: 0, control: 50, display: 50,
  seenBombs: new Set(), bombsInit: false, gridBuilt: false, campPrompted: false,
  assaultWasOpen: false, cdReady: { russia: null, ukraine: null },
};

let logSeen = new Set(), logInit = false, logUnread = 0, logPanelOpen = false;
let soldiersVisible = localStorage.getItem('sw_soldiers') !== '0';

const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat('fr-FR');
const fmt = (n) => nf.format(Math.round(n || 0));
function fmtDur(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; if (h) return `${h}h ${String(m).padStart(2, '0')}m`; if (m) return `${m}m ${String(s).padStart(2, '0')}s`; return `${s}s`; }
function fmtHours(h) { return h >= 1000 ? (h / 1000).toFixed(1) + 'k h' : (Math.round(h * 10) / 10).toFixed(1) + ' h'; }
function fmtClock(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

/* ----------------------- Sons (Web Audio, sans fichier) ----------------------- */
const Sound = (() => {
  let ctx, enabled = localStorage.getItem('sw_sound') !== '0';
  const init = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (ctx && ctx.state === 'suspended') ctx.resume(); return ctx; };
  const env = (t0, dur, peak) => { const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); return g; };
  function siren() { // alerte "tu peux bombarder"
    if (!enabled || !init()) return;
    const t = ctx.currentTime, o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(620, t); o.frequency.linearRampToValueAtTime(1150, t + 0.22); o.frequency.linearRampToValueAtTime(720, t + 0.45);
    const g = env(t, 0.5, 0.16); o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.52);
  }
  function boom() { // explosion
    if (!enabled || !init()) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(950, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const g = env(t, 0.5, 0.5); src.connect(lp); lp.connect(g); g.connect(ctx.destination); src.start(t);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    const g2 = env(t, 0.45, 0.5); o.connect(g2); g2.connect(ctx.destination); o.start(t); o.stop(t + 0.46);
  }
  function setEnabled(v) { enabled = v; localStorage.setItem('sw_sound', v ? '1' : '0'); }
  return { siren, boom, init, setEnabled, get enabled() { return enabled; } };
})();

/* ----------------------- Cartes combattants ----------------------- */
const cardRefs = {};
function buildCard(side, ch) {
  const el = $('#card-' + side);
  el.innerHTML = `
    <div class="card-top">
      <div class="avatar">${ch.emoji}</div>
      <div class="who"><div class="name"><span class="nm"></span></div><div class="faction"></div><div class="role"></div></div>
      <div class="livebadge"><span class="lbl">&hellip;</span></div>
    </div>
    <div class="title-line"></div>
    <div class="stats">
      <div class="stat"><div class="k">Spectateurs</div><div class="v viewers">&ndash;</div></div>
      <div class="stat"><div class="k">En direct depuis</div><div class="v uptime">&ndash;</div></div>
      <div class="stat"><div class="k">Heures streamées</div><div class="v hours">&ndash;</div></div>
      <div class="stat"><div class="k">Pic spectateurs</div><div class="v peak">&ndash;</div></div>
      <div class="stat"><div class="k">Abonnés</div><div class="v followers">&ndash;</div></div>
      <div class="stat"><div class="k">Bombes larguées</div><div class="v bombs">&ndash;</div></div>
    </div>
    <div class="rage">
      <div class="rage-top"><span class="rage-k">JAUGE DE RAGE</span><span class="rage-n"><b class="rcount">0</b> / ${ch.rageThreshold} /min</span></div>
      <div class="rage-bar"><div class="rage-fill"></div></div>
      <p class="rage-hint">💬 Spammez <b>${ch.command}</b> dans le chat (×${ch.rageThreshold}) pour larguer une bombe.</p>
      <p class="rage-cd"></p>
    </div>`;
  el.querySelector('.nm').textContent = ch.title;
  el.querySelector('.faction').textContent = ch.flag + ' ' + ch.army;
  el.querySelector('.role').textContent = ch.name + ' — ' + ch.role;
  cardRefs[side] = {
    badge: el.querySelector('.livebadge'), lbl: el.querySelector('.lbl'), title: el.querySelector('.title-line'),
    viewers: el.querySelector('.viewers'), uptime: el.querySelector('.uptime'), hours: el.querySelector('.hours'),
    peak: el.querySelector('.peak'), followers: el.querySelector('.followers'), bombs: el.querySelector('.bombs'),
    rcount: el.querySelector('.rcount'), rfill: el.querySelector('.rage-fill'), rcd: el.querySelector('.rage-cd'),
    avatar: el.querySelector('.avatar'), avSrc: '',
  };
}
function chiefUrl(side) { const r = cardRefs[side], ch = state.data && state.data.channels[side]; return (r && r.avCustom) || (ch && ch.avatar) || null; }
function applyAvatar(side) {
  const r = cardRefs[side]; if (!r) return;
  const ch = state.data && state.data.channels[side]; if (!ch) return;
  const url = r.avCustom || ch.avatar || null;          // priorité : art perso > photo Kick > emoji
  const key = url || ('emoji:' + ch.emoji);
  if (r.avKey === key) return; r.avKey = key;
  if (url) r.avatar.innerHTML = `<img class="av-img" src="${url}" alt="" onerror="this.parentElement.textContent='${ch.emoji}'">`;
  else r.avatar.textContent = ch.emoji;
}
function updateCard(side, ch) {
  if (!cardRefs[side]) buildCard(side, ch);
  const r = cardRefs[side];
  r.badge.classList.toggle('on', ch.live); r.lbl.textContent = ch.live ? 'EN DIRECT' : 'HORS LIGNE';
  r.title.textContent = ch.live && ch.title2 ? ch.title2 : '';
  r.viewers.innerHTML = ch.live ? fmt(ch.viewers) : '<small>hors ligne</small>';
  r.hours.textContent = fmtHours(ch.hours); r.peak.textContent = fmt(ch.peak);
  r.followers.textContent = fmt(ch.followers); r.bombs.textContent = fmt(ch.bombsFired);
  if (!r.avProbed) { // teste une seule fois l'art perso (public/opior.png | yaya.png)
    r.avProbed = true;
    const custom = side === 'russia' ? 'opior.png' : 'yaya.png';
    const test = new Image();
    test.onload = () => { r.avCustom = custom; applyAvatar(side); };
    test.onerror = () => { r.avCustom = null; applyAvatar(side); };
    test.src = custom;
  }
  applyAvatar(side);
  const pct = Math.min(100, (ch.ragePerMin / ch.rageThreshold) * 100);
  r.rcount.textContent = ch.ragePerMin; r.rfill.style.width = pct + '%'; r.rfill.classList.toggle('hot', pct >= 80);
}

function tickUptimes() {
  if (!state.data) return;
  for (const side of ['russia', 'ukraine']) {
    const ch = state.data.channels[side], r = cardRefs[side]; if (!r) continue;
    if (ch.live) r.uptime.textContent = fmtDur(ch.uptimeSec + (Date.now() - state.fetchedAt) / 1000);
    else r.uptime.innerHTML = '<small>&ndash;</small>';
    const cd = Math.max(0, ch.cooldownMs - (Date.now() - state.fetchedAt));
    const ready = cd <= 0 && ch.live && state.data.war.status === 'active';
    if (r.rcd) {
      if (cd > 0) { r.rcd.textContent = '🕓 Rechargement : ' + fmtDur(cd / 1000); r.rcd.classList.remove('ready'); }
      else if (ready) { r.rcd.innerHTML = `⚠️ BOMBE PRÊTE — spammez <b>${ch.command}</b> !`; r.rcd.classList.add('ready'); }
      else { r.rcd.textContent = ''; r.rcd.classList.remove('ready'); }
    }
    if (ready && state.cdReady[side] === false) Sound.siren(); // vient de redevenir disponible
    state.cdReady[side] = ready;
  }
  if (state.data.war) {
    const rem = Math.max(0, state.data.war.remainingMs - (Date.now() - state.fetchedAt));
    const d = Math.floor(rem / 86400000), h = Math.floor(rem % 86400000 / 3600000), m = Math.floor(rem % 3600000 / 60000), s = Math.floor(rem % 60000 / 1000);
    $('#cdValue').textContent = `${d}j ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  // cooldown pixel
  if (state.data && state.data.me) {
    const cd = Math.max(0, state.data.me.cooldownMs - (Date.now() - state.fetchedAt));
    const st = $('#pxStatus');
    if (!state.data.me.camp) st.textContent = 'Choisis ton camp pour jouer';
    else if (cd > 0) st.textContent = 'Rechargement : ' + fmtDur(cd / 1000);
    else st.textContent = '✅ Frappe disponible';
  } else { $('#pxStatus').textContent = 'Connecte-toi pour jouer'; }
}

/* ----------------------- Carte SVG ----------------------- */
let svg, fillR, fillU, frontLine, frontGlow, citiesG, sparksG, fxG, cratersG;
const sparks = [], cityNodes = [], explosions = [];
function buildMap() {
  svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = `
    <defs>
      <linearGradient id="gU" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1d4ed8" stop-opacity=".55"/><stop offset="1" stop-color="#2563eb" stop-opacity=".30"/></linearGradient>
      <linearGradient id="gR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b91c1c" stop-opacity=".32"/><stop offset="1" stop-color="#7f1d1d" stop-opacity=".58"/></linearGradient>
      <radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#3a4a60" stroke-opacity=".18" stroke-width="1"/></pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="#0b1018"/><rect width="${W}" height="${H}" fill="url(#grid)"/>
    <polygon id="fillU" fill="url(#gU)"></polygon><polygon id="fillR" fill="url(#gR)"></polygon>
    <g id="craters"></g><g id="sparks"></g>
    <polyline id="frontGlow" fill="none" stroke="#ffd0a0" stroke-opacity=".5" stroke-width="7" filter="url(#glow)"></polyline>
    <polyline id="frontLine" fill="none" stroke="#fff3e0" stroke-width="2.2"></polyline>
    <g id="cities"></g><g id="fx"></g>
    <rect width="${W}" height="${H}" fill="url(#vig)" pointer-events="none"/>`;
  $('#map').appendChild(svg);
  fillU = svg.querySelector('#fillU'); fillR = svg.querySelector('#fillR'); frontLine = svg.querySelector('#frontLine');
  frontGlow = svg.querySelector('#frontGlow'); citiesG = svg.querySelector('#cities'); sparksG = svg.querySelector('#sparks');
  fxG = svg.querySelector('#fx'); cratersG = svg.querySelector('#craters');
  for (let i = 0; i < 12; i++) { const c = document.createElementNS(SVGNS, 'circle'); c.setAttribute('r', (Math.random() * 1.6 + 0.8).toFixed(1)); c.setAttribute('fill', '#ffd9a0'); sparksG.appendChild(c); sparks.push({ el: c, y: Math.random() * H, off: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 0.6, ph: Math.random() * 6 }); }
}
function buildCities(cities) {
  citiesG.innerHTML = ''; cityNodes.length = 0;
  for (const c of cities) {
    const g = document.createElementNS(SVGNS, 'g'); const cx = c.x * W, cy = c.y * H, ar = c.x > 0.82;
    const halo = document.createElementNS(SVGNS, 'circle'); halo.setAttribute('cx', cx); halo.setAttribute('cy', cy); halo.setAttribute('r', 9); halo.setAttribute('fill', 'none'); halo.setAttribute('stroke-width', '2'); halo.setAttribute('opacity', '0');
    const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', c.camp ? 9 : 5); dot.setAttribute('stroke', c.camp ? '#fff' : '#0b1018'); dot.setAttribute('stroke-width', c.camp ? 2.5 : 1.5); dot.style.transition = 'fill .6s ease';
    const label = document.createElementNS(SVGNS, 'text'); label.setAttribute('x', ar ? cx - 10 : cx + 12); label.setAttribute('y', cy + 4); label.setAttribute('text-anchor', ar ? 'end' : 'start'); label.setAttribute('font-size', c.camp ? '16' : '13'); label.setAttribute('font-weight', c.camp ? '800' : '600'); label.setAttribute('fill', '#e8eef6'); label.setAttribute('paint-order', 'stroke'); label.setAttribute('stroke', '#0b1018'); label.setAttribute('stroke-width', c.camp ? 4 : 3); label.textContent = (c.camp ? '★ ' : '') + c.name;
    g.append(halo, dot, label); citiesG.appendChild(g); cityNodes.push({ name: c.name, x: c.x, dot, halo, flash: 0 });
  }
}
function frontNoise(y, t) { return 26 * (Math.sin(y * 0.012 + t * 0.0006) * 0.6 + Math.sin(y * 0.03 - t * 0.0009) * 0.4); }
function spawnExplosion(x, y, mega) {
  const cx = x * W, cy = y * H;
  const ring = document.createElementNS(SVGNS, 'circle'); ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#ffd9a0'); ring.setAttribute('stroke-width', mega ? 5 : 3);
  const core = document.createElementNS(SVGNS, 'circle'); core.setAttribute('cx', cx); core.setAttribute('cy', cy); core.setAttribute('fill', '#fff2c8');
  fxG.append(ring, core); explosions.push({ ring, core, t: 0, max: mega ? 130 : 80 });
  const cr = document.createElementNS(SVGNS, 'circle'); cr.setAttribute('cx', cx); cr.setAttribute('cy', cy); cr.setAttribute('r', mega ? 9 : 6); cr.setAttribute('fill', '#000'); cr.setAttribute('opacity', '0.45'); cratersG.appendChild(cr);
  while (cratersG.childNodes.length > 12) cratersG.removeChild(cratersG.firstChild);
}
function render(t) {
  requestAnimationFrame(render); if (!svg) return;
  state.display += (state.control - state.display) * 0.05;
  const share = state.display, baseX = (1 - share / 100) * W, N = 30, pts = [];
  for (let i = 0; i <= N; i++) { const y = (i / N) * H; let x = baseX + frontNoise(y, t); x = Math.max(26, Math.min(W - 26, x)); pts.push(x.toFixed(1) + ',' + y.toFixed(1)); }
  const front = pts.join(' ');
  fillU.setAttribute('points', `0,0 ${front} 0,${H}`); fillR.setAttribute('points', `${W},0 ${front} ${W},${H}`);
  frontLine.setAttribute('points', front); frontGlow.setAttribute('points', front);
  const boundary = 1 - share / 100;
  for (const cn of cityNodes) {
    const owner = cn.x >= boundary ? 'russia' : 'ukraine';
    if (cn.owner !== owner) { if (cn.owner !== undefined) cn.flash = 1; cn.owner = owner; cn.dot.style.fill = COL[owner]; cn.halo.setAttribute('stroke', COL[owner]); }
    if (cn.flash > 0) { cn.flash -= 0.012; const f = Math.max(0, cn.flash); cn.halo.setAttribute('r', (9 + (1 - f) * 22).toFixed(1)); cn.halo.setAttribute('opacity', f.toFixed(2)); }
  }
  for (const sp of sparks) { sp.y += sp.vy; if (sp.y < 0) sp.y = H; if (sp.y > H) sp.y = 0; sp.el.setAttribute('cx', (baseX + frontNoise(sp.y, t) + sp.off).toFixed(1)); sp.el.setAttribute('cy', sp.y.toFixed(1)); sp.el.setAttribute('opacity', (0.25 + 0.45 * Math.abs(Math.sin(t * 0.005 + sp.ph))).toFixed(2)); }
  for (let i = explosions.length - 1; i >= 0; i--) { const e = explosions[i]; e.t += 1.6; const p = Math.min(1, e.t / e.max); e.ring.setAttribute('r', e.t.toFixed(1)); e.ring.setAttribute('opacity', (1 - p).toFixed(2)); e.core.setAttribute('r', Math.max(0, (1 - p) * 16).toFixed(1)); e.core.setAttribute('opacity', (1 - p).toFixed(2)); if (p >= 1) { e.ring.remove(); e.core.remove(); explosions.splice(i, 1); } }
}

/* ----------------------- Barre de controle ----------------------- */
function updateControl(share) {
  $('#pctUkraine').textContent = Math.round((100 - share) * 10) / 10 + '%';
  $('#pctRussia').textContent = Math.round(share * 10) / 10 + '%';
  $('#fillUkraine').style.width = (100 - share) + '%'; $('#fillRussia').style.width = share + '%';
  $('#frontMarker').style.left = (100 - share) + '%';
}

/* ----------------------- Pixel war ----------------------- */
function buildGrid(g) {
  const el = $('#pixelGrid'); el.style.setProperty('--gw', g.w); el.innerHTML = '';
  for (let i = 0; i < g.w * g.h; i++) { const c = document.createElement('button'); c.className = 'px'; c.type = 'button'; c.dataset.i = i; c.addEventListener('click', () => placePixel(i)); el.appendChild(c); }
  state.gridBuilt = true;
}
function renderPixels(d) {
  if (!state.gridBuilt) buildGrid(d.grid);
  const g = d.grid, boundary = 1 - d.control / 100, me = d.me;
  const canHit = me && me.camp && me.cooldownMs <= 0 && d.war.status === 'active';
  const cells = $('#pixelGrid').children;
  for (let i = 0; i < cells.length; i++) {
    const col = i % g.w, x = (col + 0.5) / g.w, base = x >= boundary ? 'russia' : 'ukraine';
    const px = d.pixels[i];
    const c = cells[i];
    const owner = px || base;
    c.style.background = px ? COL[owner] : (base === 'russia' ? 'rgba(226,59,59,.16)' : 'rgba(59,130,246,.16)');
    const attackable = canHit && base === (me.camp === 'russia' ? 'ukraine' : 'russia');
    c.classList.toggle('hit', !!attackable);
  }
  const hint = $('#pxHint');
  if (hint) {
    if (!me) hint.textContent = 'Connecte-toi avec Kick pour combattre.';
    else if (!me.camp) hint.textContent = 'Choisis ton camp pour pouvoir frapper.';
    else hint.innerHTML = `Tu es dans ${me.camp === 'russia' ? "👹 l'Armée de la Goule" : '🎖️ l\'Armée de Yaya'} — frappe les cases <b>surlignées</b> (territoire ennemi). 1 frappe / heure.`;
  }
}
async function placePixel(i) {
  if (!state.data) return;
  if (!state.data.me) { openLogin(); return; }
  if (!state.data.me.camp) { openLogin(); return; }
  try { const r = await (await fetch('/api/pixel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i }) })).json(); if (r.error) $('#pxStatus').textContent = '⛔ ' + r.error; await poll(); } catch {}
}

/* ----------------------- Armees ----------------------- */
function rankIcon(rank) { return ({ 'Général': '★★★', 'Colonel': '★★', 'Capitaine': '★', 'Sergent': '▲', 'Caporal': '▴' })[rank] || '•'; }
function renderArmy(side, roster) {
  const ol = $(side === 'russia' ? '#armyRussia' : '#armyUkraine');
  $(side === 'russia' ? '#countRussia' : '#countUkraine').textContent = '(' + roster.total + ')';
  ol.innerHTML = '';
  for (const u of roster.top) {
    const li = document.createElement('li'); if (u.you) li.className = 'you';
    li.innerHTML = `<span class="rk">${u.avatar ? `<img class="ava" src="${u.avatar}" alt="">` : rankIcon(u.rank)}</span><span class="un"></span><span class="rkn">${u.rank}</span><span class="msgs">${fmt(u.msgs)} msg</span>`;
    li.querySelector('.un').textContent = u.name + (u.viewer ? ' 👤' : '');
    ol.appendChild(li);
  }
}

/* ----------------------- Auth ----------------------- */
function renderAuth(me, kickConfigured) {
  const a = $('#authArea');
  if (!me) { a.innerHTML = `<button class="hbtn primary" id="loginBtn" type="button">Rejoindre la guerre</button>`; a.querySelector('#loginBtn').onclick = openLogin; return; }
  const campTxt = me.camp ? (me.camp === 'russia' ? '👹 Goule' : '🎖️ Yaya') : 'sans camp';
  a.innerHTML = `<span class="user-chip ${me.camp || ''}"><b>${escapeHtml(me.name)}</b> · ${campTxt}</span><button class="hbtn" id="logoutBtn" type="button">Quitter</button>`;
  a.querySelector('#logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); await poll(); };
  a.querySelector('.user-chip').onclick = openLogin;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function openLogin() {
  const d = state.data, me = d && d.me, body = $('#loginBody');
  if (!me) {
    body.innerHTML = `
      <h2 class="modal-h">Rejoindre la guerre</h2>
      ${d && d.kickConfigured
        ? `<p class="modal-note">Connecte-toi avec ton compte Kick pour choisir ton camp et combattre.</p><a class="kick-btn" href="/api/auth/kick">Se connecter avec Kick</a>`
        : `<p class="modal-note">Connexion Kick indisponible (serveur non configuré).</p>`}`;
  } else {
    body.innerHTML = `
      <h2 class="modal-h">Choisis ton camp, <b>${escapeHtml(me.name)}</b></h2>
      <p class="modal-note">Tu rejoins une armée et tu peux frapper le territoire ennemi (pixel war).</p>
      <div class="camp-pick">
        <button class="camp-btn russia ${me.camp === 'russia' ? 'sel' : ''}" data-side="russia"><span class="ci">👹</span><b>Armée de la Goule</b><small>Opior / Ténèbres</small></button>
        <button class="camp-btn ukraine ${me.camp === 'ukraine' ? 'sel' : ''}" data-side="ukraine"><span class="ci">🎖️</span><b>Armée de Yaya</b><small>Résistance</small></button>
      </div>`;
    body.querySelectorAll('.camp-btn').forEach((b) => b.onclick = async () => { await fetch('/api/camp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: b.dataset.side }) }); await poll(); closeModal(); });
  }
  $('#loginModal').classList.add('show');
}

/* ----------------------- Infos / Traité du jour ----------------------- */
const CLAUSES = [
  "Toute insulte sous la ceinture du clavier sera sanctionnée par un timeout.",
  "Les bombes lâchées pendant un live de l'ennemi comptent double dans les cœurs.",
  "Le camp qui dort perd du terrain : RIP les couche-tôt.",
  "Un pixel posé est un pixel donné à la patrie.",
  "Le médiateur Rousseau veille : pas de paix sans bon contenu.",
];
function renderInfo(d) {
  const date = new Date(d.serverTime).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const clause = CLAUSES[new Date(d.serverTime).getDate() % CLAUSES.length];
  const lead = d.control >= 50 ? d.channels.russia : d.channels.ukraine, leadPct = d.control >= 50 ? d.control : 100 - d.control;
  $('#infoContent').innerHTML = `
    <h2 class="modal-h">📜 Traité du jour</h2>
    <p class="info-date">${date}</p>
    <p class="info-clause">« ${clause} »</p>
    <p>Situation : <b>${lead.name}</b> mène avec <b>${Math.round(leadPct)}%</b> du territoire. Assauts du jour : ${d.assault.countToday}/${d.assault.limit}.</p>
    <hr/>
    <h2 class="modal-h">ℹ️ Comment ça marche</h2>
    <ul class="info-list">
      <li><b>Territoire</b> : un streamer <b>en ligne</b> avance, <b>hors ligne</b> recule. Plus de spectateurs = poussée plus forte.</li>
      <li><b>Bombes</b> : <b>uniquement via le chat</b>. ${d.channels.russia.command} (camp Goule) / ${d.channels.ukraine.command} (camp Yaya). <b>${d.channels.russia.rageThreshold} messages = 1 bombe</b>, et <b>max 1 bombe / 30 min</b> par camp.</li>
      <li><b>Assaut général</b> (~2×/jour) : les bombes font <b>×2 dégâts</b>.</li>
      <li><b>Armée</b> : plus tu écris dans un chat, plus tu montes en grade (Soldat → Général).</li>
      <li><b>Pixel war</b> : connecte-toi, choisis ton camp, puis frappe une case du territoire ennemi (1×/heure).</li>
      <li><b>Fin</b> : la guerre s'arrête au bout d'<b>1 semaine</b>. Le camp avec le plus de territoire gagne.</li>
    </ul>`;
  $('#infoModal').classList.add('show');
}
function closeModal() { $('#infoModal').classList.remove('show'); $('#loginModal').classList.remove('show'); }

/* ----------------------- Depeches + ticker ----------------------- */
const TAG = { russia: 'GOUGOULE', ukraine: 'YAYA', system: 'FRONT' };
function makeLogLi(e) {
  const li = document.createElement('li'); li.className = e.side;
  li.innerHTML = `<span class="time">${fmtClock(e.t)}</span><span class="tag">${TAG[e.side] || 'FRONT'}</span><span class="msg"></span>`;
  li.querySelector('.msg').textContent = e.msg; return li;
}
function updateLogBadge() { const b = $('#logBadge'); if (b) { b.textContent = logUnread > 99 ? '99+' : logUnread; b.classList.toggle('show', logUnread > 0); } }
function renderLog(log) {
  const ul = $('#log'); if (!ul) return;
  const fresh = [];
  for (const e of log) { const k = e.t + '|' + e.msg; if (!logSeen.has(k)) { logSeen.add(k); fresh.push(e); } }
  if (!fresh.length) return;                                  // rien de neuf -> on ne touche à rien (plus de saut)
  for (const e of fresh.slice().reverse()) ul.insertBefore(makeLogLi(e), ul.firstChild);
  while (ul.children.length > 60) ul.removeChild(ul.lastChild);
  const items = log.slice(0, 8).map((e) => `<span><b>${TAG[e.side] || 'FRONT'}</b> ${e.msg}</span>`).join('');
  $('#tickerTrack').innerHTML = items + items;
  if (logInit && !logPanelOpen) { logUnread += fresh.length; updateLogBadge(); }
  logInit = true;
}

/* ----------------------- Bombe FX + toast ----------------------- */
function bombFx(b) {
  Sound.boom();
  spawnExplosion(b.x, b.y, b.mega);
  if (window.Globe && Globe.available) Globe.addBomb(b.from);
  const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const sh = document.querySelector('main'); sh.classList.remove('shake'); void sh.offsetWidth; sh.classList.add('shake'); setTimeout(() => sh.classList.remove('shake'), 600);
}
let toastTimer = null;
function showToast(msg, side) { const t = $('#captureToast'); t.textContent = msg; t.style.borderLeftColor = COL[side] || '#fff'; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }

/* ----------------------- Assaut + fin ----------------------- */
function updateAssault(d) {
  const b = $('#assaultBanner'), open = !!d.assault.open;
  b.classList.toggle('show', open);
  if (open) b.innerHTML = `⚠️ <b>ASSAUT GÉNÉRAL</b> — spammez <b>${d.commands.russia}</b> (Goule) ou <b>${d.commands.ukraine}</b> (Yaya) dans le chat ! Bombes ×2 (${fmtDur(d.assault.closesInMs / 1000)})`;
  if (open && !state.assaultWasOpen) Sound.siren();
  state.assaultWasOpen = open;
}
function renderEnd(war, channels) {
  const o = $('#endOverlay');
  if (war.status !== 'ended') { o.classList.remove('show'); return; }
  if (o.classList.contains('show')) return;
  const w = channels[war.winner], l = channels[war.winner === 'russia' ? 'ukraine' : 'russia'], pct = war.winner === 'russia' ? state.control : 100 - state.control;
  $('#treaty').innerHTML = `<div class="treaty-top">★ ★ ★</div><h2>TRAITÉ DE PAIX</h2><p class="treaty-sub">Édition finale — Front des Streams</p>
    <div class="treaty-win" style="color:${COL[war.winner]}">${w.flag} ${w.title}</div>
    <p class="treaty-line"><b>${w.name}</b> (${w.army}) remporte la guerre avec <b>${Math.round(pct)}%</b> du territoire.</p>
    <p class="treaty-loser">${l.name} capitule après 7 jours de combats.</p>
    <button class="treaty-btn" onclick="document.getElementById('endOverlay').classList.remove('show')">Fermer</button>`;
  o.classList.add('show');
}

/* ----------------------- Journal ----------------------- */
function renderJournal(d) {
  const lead = d.control >= 50 ? d.channels.russia : d.channels.ukraine, leadPct = d.control >= 50 ? d.control : 100 - d.control;
  let headline;
  if (d.war.status === 'ended') headline = `ARMISTICE : ${d.channels[d.war.winner].name.toUpperCase()} REMPORTE LA GUERRE`;
  else if (d.assault.open) headline = 'ASSAUT GÉNÉRAL : LE CHAT SE DÉCHAÎNE';
  else if (leadPct >= 65) headline = `${lead.name.toUpperCase()} ENFONCE LE FRONT (${Math.round(leadPct)}%)`;
  else headline = 'GUERRE DE TRANCHÉES : LE FRONT NE CÈDE PAS';
  const lastBomb = d.log.find((e) => /bombe/i.test(e.msg));
  const totalBombs = d.channels.russia.bombsFired + d.channels.ukraine.bombsFired;
  const date = new Date(d.serverTime).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#journal').innerHTML = `
    <div class="jp-masthead"><span class="jp-side">POUR LE LOL<br>POUR LE STREAM</span>
      <div class="jp-title"><h2>LE JOURNAL DE LA GUERRE</h2><div class="jp-rule">ÉDITION SPÉCIALE — FRONT DES STREAMS</div></div>
      <span class="jp-side">PRIX :<br>2 KICKS</span></div>
    <div class="jp-dateline"><span>${date}</span><span>N° ${d.war.durationDays} — GUERRE DU STREAM</span></div>
    <h1 class="jp-headline">${headline}</h1>
    <div class="jp-cols">
      <div class="jp-col"><h3>Situation sur le front</h3><p>${lead.name} contrôle <b>${Math.round(leadPct)}%</b> du territoire. ${d.channels.russia.live ? 'Opior est en ligne et pousse.' : 'Opior est hors ligne.'} ${d.channels.ukraine.live ? 'Yaya tient le front.' : 'Yaya a quitté le stream.'}</p></div>
      <div class="jp-col"><h3>Dernier bombardement</h3><p>${lastBomb ? '« ' + lastBomb.msg + ' »' : 'Aucun bombardement récent.'}</p><p class="jp-small">Total : <b>${totalBombs}</b> bombes.</p></div>
      <div class="jp-col"><h3>Communiqué</h3><p>Spectateurs : <b>${fmt(d.channels.russia.viewers + d.channels.ukraine.viewers)}</b>. Soldats enrôlés : <b>${d.army.russia.total + d.army.ukraine.total}</b>.</p><p class="jp-small">Assauts du jour : ${d.assault.countToday}/${d.assault.limit}.</p></div>
    </div>`;
}

/* ----------------------- Donnees ----------------------- */
function applyData(d) {
  const prev = state.data; state.data = d; state.fetchedAt = Date.now(); state.control = d.control;
  updateCard('russia', d.channels.russia); updateCard('ukraine', d.channels.ukraine);
  updateControl(d.control);
  if (window.Globe && Globe.available) { Globe.setControl(d.control); Globe.setSoldiers(d.army.russia.top, d.army.ukraine.top); Globe.setChiefs({ russia: chiefUrl('russia'), ukraine: chiefUrl('ukraine') }); Globe.setSoldiersVisible(soldiersVisible); }
  if (!cityNodes.length) buildCities(d.cities);
  renderPixels(d);
  renderArmy('russia', d.army.russia); renderArmy('ukraine', d.army.ukraine);
  renderAuth(d.me, d.kickConfigured);
  $('#linkRussia').href = d.channels.russia.url; $('#linkUkraine').href = d.channels.ukraine.url;
  renderLog(d.log); updateAssault(d); renderJournal(d); renderEnd(d.war, d.channels);
  if ($('#infoModal').classList.contains('show')) renderInfo(d);

  // à la 1re connexion sans camp : ouvre le choix du camp automatiquement
  if (!d.me) state.campPrompted = false;
  else if (!d.me.camp && !state.campPrompted) { state.campPrompted = true; openLogin(); }

  // effets de bombe : uniquement pour une vraie bombe RÉCENTE (pas de rejeu quand il ne se passe rien)
  for (const b of d.bombs) {
    if (!state.seenBombs.has(b.id)) { state.seenBombs.add(b.id); if (state.bombsInit && Date.now() - b.t < 12000) bombFx(b); }
  }
  state.bombsInit = true;
}
async function poll() { try { const r = await fetch('/api/state', { cache: 'no-store' }); if (r.ok) applyData(await r.json()); } catch {} }

/* ----------------------- Init ----------------------- */
buildMap();
if (window.Globe) Globe.init($('#globe'));
requestAnimationFrame(render);
$('#infoBtn').onclick = () => { if (state.data) renderInfo(state.data); };
// son : bouton mute + déverrouillage au premier clic (politique navigateur)
const soundBtn = $('#soundBtn');
if (soundBtn) {
  soundBtn.textContent = Sound.enabled ? '🔊' : '🔇';
  soundBtn.onclick = () => { Sound.setEnabled(!Sound.enabled); soundBtn.textContent = Sound.enabled ? '🔊' : '🔇'; if (Sound.enabled) Sound.siren(); };
}
['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, () => Sound.init(), { once: true }));
const eyeBtn = $('#globeEye');
if (eyeBtn) {
  const applyEye = () => { eyeBtn.textContent = soldiersVisible ? '👁️' : '🙈'; eyeBtn.classList.toggle('off', !soldiersVisible); if (window.Globe && Globe.available) Globe.setSoldiersVisible(soldiersVisible); };
  eyeBtn.onclick = () => { soldiersVisible = !soldiersVisible; localStorage.setItem('sw_soldiers', soldiersVisible ? '1' : '0'); applyEye(); };
  applyEye();
}
$('#logBubble').onclick = () => { logPanelOpen = !logPanelOpen; $('#logPanel').classList.toggle('show', logPanelOpen); if (logPanelOpen) { logUnread = 0; updateLogBadge(); } };
$('#logClose').onclick = () => { logPanelOpen = false; $('#logPanel').classList.remove('show'); };
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeModal);
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(); }));
poll();
setInterval(poll, 2000);
setInterval(tickUptimes, 1000);
