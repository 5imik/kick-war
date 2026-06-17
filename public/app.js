'use strict';

/* OPIOR (Gougoule) vs YAYA (Résistance) - front-end */

const SVGNS = 'http://www.w3.org/2000/svg';
const W = 1000, H = 560;
const COL = { russia: '#e23b3b', ukraine: '#3b82f6' };

const state = {
  data: null, fetchedAt: 0, control: 50, display: 50,
  seenBombs: new Set(), bombsInit: false, gridBuilt: false,
};

const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat('fr-FR');
const fmt = (n) => nf.format(Math.round(n || 0));
function fmtDur(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; if (h) return `${h}h ${String(m).padStart(2, '0')}m`; if (m) return `${m}m ${String(s).padStart(2, '0')}s`; return `${s}s`; }
function fmtHours(h) { return h >= 1000 ? (h / 1000).toFixed(1) + 'k h' : (Math.round(h * 10) / 10).toFixed(1) + ' h'; }
function fmtClock(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

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
      <div class="stat"><div class="k">Followers</div><div class="v followers">&ndash;</div></div>
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
  };
}
function updateCard(side, ch) {
  if (!cardRefs[side]) buildCard(side, ch);
  const r = cardRefs[side];
  r.badge.classList.toggle('on', ch.live); r.lbl.textContent = ch.live ? 'EN DIRECT' : 'HORS LIGNE';
  r.title.textContent = ch.live && ch.title2 ? ch.title2 : '';
  r.viewers.innerHTML = ch.live ? fmt(ch.viewers) : '<small>hors ligne</small>';
  r.hours.textContent = fmtHours(ch.hours); r.peak.textContent = fmt(ch.peak);
  r.followers.textContent = fmt(ch.followers); r.bombs.textContent = fmt(ch.bombsFired);
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
    if (r.rcd) r.rcd.textContent = cd > 0 ? '🕓 Prochaine bombe dans ' + fmtDur(cd / 1000) : '';
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
    const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 5); dot.setAttribute('stroke', '#0b1018'); dot.setAttribute('stroke-width', '1.5'); dot.style.transition = 'fill .6s ease';
    const label = document.createElementNS(SVGNS, 'text'); label.setAttribute('x', ar ? cx - 10 : cx + 10); label.setAttribute('y', cy + 4); label.setAttribute('text-anchor', ar ? 'end' : 'start'); label.setAttribute('font-size', '13'); label.setAttribute('font-weight', '600'); label.setAttribute('fill', '#e8eef6'); label.setAttribute('paint-order', 'stroke'); label.setAttribute('stroke', '#0b1018'); label.setAttribute('stroke-width', '3'); label.textContent = c.name;
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
    li.innerHTML = `<span class="rk">${rankIcon(u.rank)}</span><span class="un"></span><span class="rkn">${u.rank}</span><span class="msgs">${fmt(u.msgs)} msg</span>`;
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
      ${d && d.kickConfigured ? `<a class="kick-btn" href="/api/auth/kick">Se connecter avec Kick</a><div class="or">ou</div>` : `<p class="modal-note">Connexion Kick non configurée (mode local). Choisis un pseudo :</p>`}
      <div class="login-row"><input id="pseudo" maxlength="20" placeholder="Ton pseudo" /><button class="hbtn primary" id="doLogin" type="button">Entrer</button></div>`;
    const go = async () => { const n = body.querySelector('#pseudo').value.trim(); if (!n) return; await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }); await poll(); openLogin(); };
    body.querySelector('#doLogin').onclick = go;
    body.querySelector('#pseudo').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
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
function renderLog(log) {
  const ul = $('#log'); ul.innerHTML = '';
  for (const e of log) { const li = document.createElement('li'); li.className = e.side; li.innerHTML = `<span class="time">${fmtClock(e.t)}</span><span class="tag">${TAG[e.side] || 'FRONT'}</span><span class="msg"></span>`; li.querySelector('.msg').textContent = e.msg; ul.appendChild(li); }
  const items = log.slice(0, 8).map((e) => `<span><b>${TAG[e.side] || 'FRONT'}</b> ${e.msg}</span>`).join('');
  $('#tickerTrack').innerHTML = items + items;
}

/* ----------------------- Bombe FX + toast ----------------------- */
function bombFx(b) {
  spawnExplosion(b.x, b.y, b.mega);
  if (window.Globe && Globe.available) Globe.addBomb(b.from);
  const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const sh = document.querySelector('main'); sh.classList.remove('shake'); void sh.offsetWidth; sh.classList.add('shake'); setTimeout(() => sh.classList.remove('shake'), 600);
}
let toastTimer = null;
function showToast(msg, side) { const t = $('#captureToast'); t.textContent = msg; t.style.borderLeftColor = COL[side] || '#fff'; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }

/* ----------------------- Assaut + fin ----------------------- */
function updateAssault(d) {
  const b = $('#assaultBanner'); b.classList.toggle('show', !!d.assault.open);
  if (d.assault.open) b.innerHTML = `⚠️ <b>ASSAUT GÉNÉRAL</b> — spammez <b>${d.commands.russia}</b> (Goule) ou <b>${d.commands.ukraine}</b> (Yaya) dans le chat ! Bombes ×2 (${fmtDur(d.assault.closesInMs / 1000)})`;
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
  if (window.Globe && Globe.available) Globe.setControl(d.control);
  if (!cityNodes.length) buildCities(d.cities);
  renderPixels(d);
  renderArmy('russia', d.army.russia); renderArmy('ukraine', d.army.ukraine);
  renderAuth(d.me, d.kickConfigured);
  $('#linkRussia').href = d.channels.russia.url; $('#linkUkraine').href = d.channels.ukraine.url;
  renderLog(d.log); updateAssault(d); renderJournal(d); renderEnd(d.war, d.channels);
  if ($('#infoModal').classList.contains('show')) renderInfo(d);
  for (const b of d.bombs) { if (!state.seenBombs.has(b.id)) { state.seenBombs.add(b.id); if (state.bombsInit) bombFx(b); } }
  state.bombsInit = true;
  if (prev && d.log.length && prev.log.length && d.log[0].t !== prev.log[0].t && /tombe aux mains/.test(d.log[0].msg)) showToast(d.log[0].msg, d.log[0].side);
}
async function poll() { try { const r = await fetch('/api/state', { cache: 'no-store' }); if (r.ok) applyData(await r.json()); } catch {} }

/* ----------------------- Init ----------------------- */
buildMap();
if (window.Globe) Globe.init($('#globe'));
requestAnimationFrame(render);
$('#infoBtn').onclick = () => { if (state.data) renderInfo(state.data); };
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeModal);
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(); }));
poll();
setInterval(poll, 2000);
setInterval(tickUptimes, 1000);
