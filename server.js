'use strict';

/*
 * OPIOR (Général Gougoule / Ténèbres) vs YAYA (Résistance) - La Guerre du Stream
 * --------------------------------------------------------------
 *  - Territoire facon tug-of-war (streamer en ligne = avance).
 *  - Bombes UNIQUEMENT via le chat : spam d'une commande -> jauge de rage,
 *    60 / minute -> BOMBE sur l'ennemi. (pas de bouton clic)
 *  - Fenetres d'ASSAUT (~2x/jour) : bombes x2.
 *  - Armees : chaque pseudo qui parle dans un chat monte en grade.
 *  - Connexion (Kick OAuth en prod, login pseudo en local) + choix du camp.
 *  - Pixel war : chaque heure, un membre connecté peut frapper le territoire ennemi.
 *  - La guerre se termine au bout d'1 semaine -> vainqueur.
 *
 * Mapping : Yaya = Ukraine (Résistance), Opior = Russie (Gougoule).
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 3000;
const DEMO = process.env.WAR_DEMO === '1' || process.argv[3] === 'demo';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'state.json');
const POLL_MS = 2000;

const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID || '';
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || '';
// Identifiants Kick présents -> mode LIVE (vraies stats + vrai chat, AUCUNE simulation).
const CONFIGURED = !!(KICK_CLIENT_ID && KICK_CLIENT_SECRET);
const SIMULATE = !CONFIGURED;
// chatroom IDs pour lire le chat (l'API officielle ne les fournit pas) — à définir en env.
// chatroom IDs Kick (publics, stables) — défauts intégrés, surchargeables par env
const CHATROOM = {
  russia: process.env.KICK_CHATROOM_RUSSIA || '64463412',   // theblackwall (Opior)
  ukraine: process.env.KICK_CHATROOM_UKRAINE || '41997470', // yayaaakl (Yaya)
};
// persistance durable (survit aux redéploiements Render) : Upstash Redis REST
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REMOTE = !!(UPSTASH_URL && UPSTASH_TOKEN);

// --- Reglages -----------------------------------------------------------
const RATE_PER_MIN = Number(process.env.WAR_RATE) || (process.env.WAR_DEMO === '1' || process.argv[3] === 'demo' ? 0.22 : 0.05);
const WAR_DURATION_DAYS = Number(process.env.WAR_DAYS) || 7;
const RAGE_WINDOW_MS = 60000;
const BOMB_THRESHOLD = 5;                                    // 5 spams = 1 bombe
const BOMB_COOLDOWN_MS = DEMO ? 60000 : 30 * 60 * 1000;      // 1 bombe / 30 min par camp
const BOMB_DAMAGE = 2;
const ASSAULT_LIMIT = 2;
const ASSAULT_INTERVAL_MS = DEMO ? 150000 : 8 * 3600 * 1000;
const ASSAULT_WINDOW_MS = DEMO ? 60000 : 10 * 60 * 1000;
const PIXEL_COOLDOWN_MS = DEMO ? 8000 : 3600 * 1000;
const GW = 48, GH = 20; // grille pixel war

const CHANNELS = {
  russia: { key: 'russia', slug: 'theblackwall', name: 'Opior', title: 'Général Gougoule', faction: 'Armée de la Goule', army: 'Armée de la Goule', role: 'Streamer alcoolique - 42 ans - RSA', emoji: '\u{1F47A}', flag: '\u{1F1F7}\u{1F1FA}', side: 'Ténèbres', command: 'GOUGOULE', url: 'https://kick.com/theblackwall' },
  ukraine: { key: 'ukraine', slug: 'yayaaakl', name: 'Yaya', title: 'Yaya', faction: 'Armée de Yaya', army: 'Armée de Yaya', role: 'Multi-millionnaire', emoji: '\u{1F396}', flag: '\u{1F1FA}\u{1F1E6}', side: 'Résistance', command: 'SLAVA', url: 'https://kick.com/yayaaakl' },
};

const CITIES = [
  { name: 'Villa Yaya', x: 0.06, y: 0.30 }, { name: 'Cryptopolis', x: 0.14, y: 0.66 },
  { name: 'Lambo Heights', x: 0.22, y: 0.18 }, { name: 'Yacht Harbor', x: 0.29, y: 0.80 },
  { name: 'Banque Centrale', x: 0.36, y: 0.44 }, { name: 'Diamant City', x: 0.43, y: 0.70 },
  { name: 'Front-du-Kick', x: 0.50, y: 0.30 }, { name: "No Man's Land", x: 0.57, y: 0.60 },
  { name: 'Kebabgrad', x: 0.64, y: 0.22 }, { name: 'Biereville', x: 0.72, y: 0.74 },
  { name: 'Fort RSA', x: 0.80, y: 0.42 }, { name: 'Canape-City', x: 0.88, y: 0.68 },
  { name: 'Ploumstan', x: 0.95, y: 0.28 },
  { name: 'Cappuccino-ma-Reine', x: 0.10, y: 0.50 },
  { name: 'Le Ledger Perdu', x: 0.33, y: 0.16 },
  { name: 'Pâtes-au-Poivre', x: 0.76, y: 0.18 },
];

const PERSONA = {
  russia: { onMin: 38, offMin: 16, vBase: 650, vSpread: 700, spike: 0.04, spikeMul: 2.2 },
  ukraine: { onMin: 20, offMin: 38, vBase: 1300, vSpread: 1700, spike: 0.07, spikeMul: 2.8 },
};

// faux chatters (avec un poids d'activite pour creer des grades)
const CHATTERS = {
  russia: ['xX_Goule_Xx', 'BièreMan', 'RSA_Warrior', 'KebabKiller', 'CanapéKing', 'DarkGougoule', 'TipiakPro', 'Ploum92', 'NoLifeNico', 'GobelinGG', 'PinardForce', 'Trollogre', 'SDF_Sniper', 'GougouleFan', 'Kro_Necro', 'BongoBob'],
  ukraine: ['YayaFan99', 'CryptoBro', 'LamboLover', 'RichKidd', 'SlavaYaya', 'DiamondHand', 'ResistanceFR', 'MrMillion', 'YachtMaster', 'GoldGuy', 'BankerBoy', 'ElegantElf', 'YayaSimp', 'NobleNoa', 'ParisHilton', 'FreeUkr'],
};

// ---------------------------------------------------------------------------
function dayKeyOf(t) { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

function defaultState() {
  const now = Date.now();
  const mkArmy = (side) => {
    if (CONFIGURED) return {}; // en live, l'armée se remplit avec les vrais chatters
    const o = {};
    for (const n of CHATTERS[side]) o[n] = { msgs: Math.floor(Math.random() * 30), w: 0.3 + Math.random() * Math.random() * 3, viewer: false };
    return o;
  };
  return {
    russiaShare: 50, lastUpdate: now,
    war: { start: now, durationDays: WAR_DURATION_DAYS, status: 'active', winner: null },
    channels: CONFIGURED ? {
      russia: { live: false, viewers: 0, peak: 0, followers: 0, hours: 0, since: null, title: '', source: 'live' },
      ukraine: { live: false, viewers: 0, peak: 0, followers: 0, hours: 0, since: null, title: '', source: 'live' },
    } : {
      russia: { live: true, viewers: 700, peak: 1500, followers: 12450, hours: 128.5, since: now, title: '', source: 'sim' },
      ukraine: { live: true, viewers: 1300, peak: 4200, followers: 88990, hours: 47.2, since: now, title: '', source: 'sim' },
    },
    sim: { russia: { live: true, target: 700, since: now }, ukraine: { live: true, target: 1300, since: now } },
    rage: { russia: { hits: [], cooldownUntil: 0, bombs: 0 }, ukraine: { hits: [], cooldownUntil: 0, bombs: 0 } },
    assault: { open: false, opensAt: now + ASSAULT_INTERVAL_MS, closesAt: 0, countToday: 0, dayKey: dayKeyOf(now) },
    bombs: [], bombSeq: 1,
    army: { russia: mkArmy('russia'), ukraine: mkArmy('ukraine') },
    pixels: {}, cooldowns: {},
    log: [{ t: now, side: 'system', msg: 'Les hostilités ont commencé. Que le meilleur streamer gagne.' }],
  };
}

function mergeState(raw) {
  const b = defaultState();
  return { ...b, ...raw,
    war: { ...b.war, ...raw.war },
    channels: { russia: { ...b.channels.russia, ...(raw.channels && raw.channels.russia) }, ukraine: { ...b.channels.ukraine, ...(raw.channels && raw.channels.ukraine) } },
    sim: { russia: { ...b.sim.russia, ...(raw.sim && raw.sim.russia) }, ukraine: { ...b.sim.ukraine, ...(raw.sim && raw.sim.ukraine) } },
    rage: { russia: { ...b.rage.russia, ...(raw.rage && raw.rage.russia) }, ukraine: { ...b.rage.ukraine, ...(raw.rage && raw.rage.ukraine) } },
    assault: { ...b.assault, ...raw.assault },
    army: raw.army && raw.army.russia ? raw.army : b.army,
    pixels: raw.pixels || {},
    cooldowns: raw.cooldowns || {},
    bombs: Array.isArray(raw.bombs) ? raw.bombs : [],
    log: Array.isArray(raw.log) ? raw.log : b.log,
  };
}
function loadStateSync() {
  try { return mergeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch { return defaultState(); }
}

let state = loadStateSync();
const sessions = {}; // token -> { name, camp, kick }
const pkce = new Map(); // state OAuth -> { verifier, createdAt }
function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// --- Persistance : Upstash Redis REST si configuré, sinon fichier local ---
let remoteSaveTimer = 0, remoteDirty = false;
async function flushRemote() {
  remoteSaveTimer = 0; if (!remoteDirty) return; remoteDirty = false;
  try { await fetch(`${UPSTASH_URL}/set/warstate`, { method: 'POST', headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN }, body: JSON.stringify(state) }); }
  catch (e) { console.error('[upstash] save KO', e.message); }
}
function saveState() {
  if (REMOTE) { remoteDirty = true; if (!remoteSaveTimer) remoteSaveTimer = setTimeout(flushRemote, 20000); }
  else { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }
}
async function loadRemote() {
  try {
    const r = await fetch(`${UPSTASH_URL}/get/warstate`, { headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN } });
    const j = await r.json();
    if (j && j.result) { state = mergeState(JSON.parse(j.result)); console.log('[upstash] état restauré'); }
    else console.log('[upstash] aucun état sauvegardé → nouveau départ');
  } catch (e) { console.error('[upstash] load KO', e.message); }
}

// ---------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round1 = (v) => Math.round(v * 10) / 10;
const rand = (a, b) => a + Math.random() * (b - a);
function pushLog(side, msg) { state.log.unshift({ t: Date.now(), side, msg }); if (state.log.length > 60) state.log.length = 60; }
function ownerAt(share, x) { return x >= 1 - share / 100 ? 'russia' : 'ukraine'; }
function enemyOf(s) { return s === 'russia' ? 'ukraine' : 'russia'; }
function rankTitle(m) { return m >= 400 ? 'Général' : m >= 200 ? 'Colonel' : m >= 100 ? 'Capitaine' : m >= 40 ? 'Sergent' : m >= 12 ? 'Caporal' : 'Soldat'; }

// ---------------------------------------------------------------------------
function ingestCommand(side, n = 1) {
  if (state.war.status !== 'active' || !state.rage[side]) return;
  const now = Date.now();
  for (let i = 0; i < n; i++) state.rage[side].hits.push(now);
}
function onChatMessage(side, user, text, id) { // <- chat Kick live
  addToArmy(side, user, 1, id);
  if (String(text).toUpperCase().includes(CHANNELS[side].command)) ingestCommand(side, 1);
}
function addToArmy(side, name, msgs, id) {
  const a = state.army[side];
  if (!a[name]) a[name] = { msgs: 0, w: 1, viewer: false };
  const before = rankTitle(a[name].msgs);
  a[name].msgs += msgs;
  if (id && !a[name].id) a[name].id = id;
  if (msgs > 0) { const after = rankTitle(a[name].msgs); if (after !== before) pushLog(side, `🎖️ ${name} est promu ${after} dans ${CHANNELS[side].army} !`); }
}
function pruneRage(side, now) {
  const arr = state.rage[side].hits, cut = now - RAGE_WINDOW_MS;
  let i = 0; while (i < arr.length && arr[i] < cut) i++; if (i) arr.splice(0, i);
  return arr.length;
}
function dropBomb(side, now) {
  const enemy = enemyOf(side), r = state.rage[side], mega = state.assault.open, dmg = BOMB_DAMAGE * (mega ? 2 : 1);
  const prev = state.russiaShare;
  state.russiaShare = clamp(prev + (side === 'russia' ? dmg : -dmg), 3, 97);
  const boundary = 1 - state.russiaShare / 100;
  const x = enemy === 'ukraine' ? rand(0.04, Math.max(0.06, boundary - 0.04)) : rand(Math.min(0.94, boundary + 0.04), 0.96);
  const y = rand(0.2, 0.8);
  let nearest = CITIES[0], best = 9; for (const c of CITIES) { const d = Math.abs(c.x - x); if (d < best) { best = d; nearest = c; } }
  state.bombs.push({ id: state.bombSeq++, from: side, x, y, t: now, mega }); if (state.bombs.length > 16) state.bombs.shift();
  r.hits.length = 0; r.cooldownUntil = now + BOMB_COOLDOWN_MS; r.bombs++;
  pushLog(side, `${mega ? 'MÉGA-BOMBE' : 'Bombe'} larguée par ${CHANNELS[side].name} sur ${nearest.name} ! (-${dmg}%)`);
  detectCaptures(prev, state.russiaShare);
}
function updateAssault(now) {
  const a = state.assault, dk = dayKeyOf(now);
  if (a.dayKey !== dk) { a.dayKey = dk; a.countToday = 0; }
  if (!a.open && now >= a.opensAt && a.countToday < ASSAULT_LIMIT && state.war.status === 'active') {
    a.open = true; a.closesAt = now + ASSAULT_WINDOW_MS; a.countToday++;
    pushLog('system', `⚠️ ASSAUT GÉNÉRAL ! Spammez GOUGOULE (Goule) ou SLAVA (Yaya) — bombes ×2 !`);
  } else if (a.open && now >= a.closesAt) {
    a.open = false; a.opensAt = now + ASSAULT_INTERVAL_MS; pushLog('system', "Fin de l'assaut. Le front se stabilise.");
  }
}
function simChat(now, dtSec) {
  for (const side of ['russia', 'ukraine']) {
    const ch = state.channels[side]; if (!ch.live) continue;
    const rate = (state.assault.open ? ch.viewers / 220 : ch.viewers / 700) * dtSec;
    let n = Math.round(rate + (Math.random() < (rate % 1) ? 1 : 0));
    const names = Object.keys(state.army[side]);
    for (let i = 0; i < n && names.length; i++) {
      // tirage pondere par l'activite
      let total = 0; for (const nm of names) total += state.army[side][nm].w;
      let r = Math.random() * total, pick = names[0];
      for (const nm of names) { r -= state.army[side][nm].w; if (r <= 0) { pick = nm; break; } }
      state.army[side][pick].msgs++;
      if (Math.random() < (state.assault.open ? 0.7 : 0.08)) ingestCommand(side, 1);
    }
  }
}
function simulateChannel(key, dtMin) {
  const s = state.sim[key], p = PERSONA[key], meanDur = s.live ? p.onMin : p.offMin;
  if (Math.random() < 1 - Math.exp(-dtMin / meanDur)) { s.live = !s.live; s.since = Date.now(); s.target = s.live ? rand(p.vBase * 0.5, p.vBase + p.vSpread * 0.4) : 0; }
  if (s.live) { if (Math.random() < 0.25) s.target = rand(p.vBase * 0.5, p.vBase + p.vSpread); if (Math.random() < p.spike) s.target = Math.min(s.target * p.spikeMul, p.vBase + p.vSpread * 2); } else s.target = 0;
  return { live: s.live, target: s.target };
}
function push(ch) { return ch.live ? 0.6 + ch.viewers / 2200 : -0.5; }
function detectCaptures(p, n) { if (p === n) return; for (const c of CITIES) { const b = ownerAt(p, c.x), a = ownerAt(n, c.x); if (b !== a) pushLog(a, `${c.name} tombe aux mains de ${CHANNELS[a].name} !`); } }
function detectMilestones(p, n) { for (const th of [10, 25, 50, 75, 90]) { if (p < th && n >= th) pushLog('russia', `Opior franchit la barre des ${th}% !`); if (p >= th && n < th) pushLog('ukraine', `Yaya repousse Opior sous les ${th}%.`); } }
function endWar() { state.war.status = 'ended'; state.war.winner = state.russiaShare >= 50 ? 'russia' : 'ukraine'; const w = CHANNELS[state.war.winner]; pushLog('system', `🏳️ FIN DE LA GUERRE. Victoire de ${w.name} (${w.army}).`); }

// ---------------------------------------------------------------------------
// Mode LIVE : API officielle Kick (stats) + socket de chat public (Pusher)
// ---------------------------------------------------------------------------
let appToken = null, appTokenExp = 0, lastChannelFetch = 0, liveErrLogged = false, liveLoggedRaw = false;
const chatWS = {};
const avatarCache = {}; // user_id -> url photo de profil
let lastAvatarFetch = 0;

async function getAppToken() {
  if (appToken && Date.now() < appTokenExp) return appToken;
  const r = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: KICK_CLIENT_ID, client_secret: KICK_CLIENT_SECRET }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token app KO: ' + JSON.stringify(j).slice(0, 150));
  appToken = j.access_token; appTokenExp = Date.now() + (j.expires_in || 3600) * 1000 - 60000;
  return appToken;
}

async function fetchChannelsLive() {
  const tok = await getAppToken();
  const r = await fetch(`https://api.kick.com/public/v1/channels?slug=${CHANNELS.russia.slug}&slug=${CHANNELS.ukraine.slug}`, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  if (!liveLoggedRaw) { console.log('[live] channels brut:', JSON.stringify(j).slice(0, 500)); liveLoggedRaw = true; }
  const arr = j.data || j.channels || [];
  for (const c of arr) {
    const slug = String(c.slug || c.broadcaster_user_slug || (c.broadcaster && c.broadcaster.slug) || '').toLowerCase();
    const key = slug === CHANNELS.russia.slug ? 'russia' : slug === CHANNELS.ukraine.slug ? 'ukraine' : null;
    if (!key) continue;
    const ch = state.channels[key], stream = c.stream || c.livestream || {};
    ch.live = !!(stream.is_live ?? c.is_live ?? (stream.viewer_count != null));
    ch.viewers = stream.viewer_count ?? stream.viewers ?? c.viewer_count ?? 0;
    ch.followers = c.active_subscribers_count ?? c.followers_count ?? c.followers ?? ch.followers; // abonnés
    ch.title = stream.session_title || c.stream_title || stream.title || '';
    ch._uid = c.broadcaster_user_id || c.broadcaster_id || ch._uid;
    if (ch.live && stream.start_time) { const t = Date.parse(stream.start_time); if (t > 0) ch._startTime = t; }
    ch.source = 'live';
    const cid = CHATROOM[key] || ch._chatroomId || await resolveChatroom(key);
    if (cid && !chatWS[key]) connectChat(key, cid);
  }
}

// l'API officielle ne renvoie pas le chatroom_id : on tente l'endpoint public (souvent
// bloqué par Cloudflare côté serveur) ; sinon il faut le fournir via KICK_CHATROOM_*.
// récupère les photos de profil des meilleurs soldats (par user_id)
async function refreshAvatars() {
  const ids = new Set();
  for (const side of ['russia', 'ukraine']) {
    const u = state.channels[side]._uid; if (u && !avatarCache[u]) ids.add(u); // avatars des streamers (cartes)
    const a = state.army[side];
    Object.keys(a).sort((x, y) => a[y].msgs - a[x].msgs).slice(0, 10).forEach((n) => { if (a[n].id && !avatarCache[a[n].id]) ids.add(a[n].id); });
  }
  if (!ids.size) return;
  const tok = await getAppToken();
  const qs = [...ids].slice(0, 40).map((i) => 'id=' + i).join('&');
  const r = await fetch('https://api.kick.com/public/v1/users?' + qs, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  for (const u of (j.data || [])) if (u.user_id && u.profile_picture) avatarCache[u.user_id] = u.profile_picture;
}

async function resolveChatroom(side) {
  if (CHATROOM[side]) return CHATROOM[side];
  if (state.channels[side]._chatroomId) return state.channels[side]._chatroomId;
  try {
    const r = await fetch('https://kick.com/api/v2/channels/' + CHANNELS[side].slug, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (r.ok) { const j = await r.json(); const id = j.chatroom && j.chatroom.id; if (id) { state.channels[side]._chatroomId = id; return id; } }
  } catch {}
  return null;
}

function connectChat(side, chatroomId) {
  if (typeof WebSocket === 'undefined') { console.warn('[chat] WebSocket indisponible (Node < 22) — chat live désactivé'); return; }
  try {
    const ws = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false');
    chatWS[side] = ws;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: `chatrooms.${chatroomId}.v2` } })));
    ws.addEventListener('message', (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.event && m.event.indexOf('ChatMessage') >= 0) {
          const d = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
          const user = (d.sender && (d.sender.username || d.sender.slug)) || 'anon';
          const uid = d.sender && (d.sender.id || d.sender.user_id);
          onChatMessage(side, user, d.content || '', uid);
        }
      } catch {}
    });
    ws.addEventListener('close', () => { chatWS[side] = null; setTimeout(() => connectChat(side, chatroomId), 5000); });
    ws.addEventListener('error', () => {});
    console.log('[chat] connecté:', side, 'chatroom', chatroomId);
  } catch (e) { console.warn('[chat] échec', side, e.message); }
}

async function tick() {
  const now = Date.now();
  const dtSec = clamp((now - state.lastUpdate) / 1000, 0, 60), dtMin = dtSec / 60;
  if (state.war.status === 'active' && now - state.war.start >= state.war.durationDays * 86400000) endWar();
  const active = state.war.status === 'active';

  const prevLive = { russia: state.channels.russia.live, ukraine: state.channels.ukraine.live };
  if (CONFIGURED && now - lastChannelFetch > 20000) {
    lastChannelFetch = now;
    try { await fetchChannelsLive(); } catch (e) { if (!liveErrLogged) { console.error('[live] API Kick KO:', e.message); liveErrLogged = true; } }
  }
  if (CONFIGURED && now - lastAvatarFetch > 30000) { lastAvatarFetch = now; refreshAvatars().catch(() => {}); }

  for (const key of ['russia', 'ukraine']) {
    const ch = state.channels[key], wasLive = prevLive[key];
    if (SIMULATE) {
      const sim = simulateChannel(key, dtMin);
      ch.live = sim.live;
      ch.viewers = Math.max(0, Math.round(ch.viewers + (sim.target - ch.viewers) * 0.25 + (ch.live ? rand(-30, 30) : 0)));
      ch.followers += ch.live ? rand(0, 1.6) : rand(0, 0.25); ch.source = 'sim';
    }
    if (ch.live && !wasLive) { ch.since = ch._startTime || now; pushLog(key, key === 'russia' ? 'Opior lance son stream. Les Ténèbres avancent !' : 'Yaya entre en résistance. Le front se renforce.'); }
    else if (!ch.live && wasLive) { ch.since = null; pushLog(key, key === 'russia' ? "Opior s'est endormi sur son canapé." : 'Yaya part en yacht.'); }
    if (ch.live) { ch.hours += dtMin / 60; if (ch.viewers > ch.peak) ch.peak = ch.viewers; }
  }

  if (active) {
    updateAssault(now);
    if (SIMULATE) simChat(now, dtSec);
    for (const key of ['russia', 'ukraine']) { const c = pruneRage(key, now); if (c >= BOMB_THRESHOLD && now >= state.rage[key].cooldownUntil) dropBomb(key, now); }
    const prev = state.russiaShare;
    state.russiaShare = clamp(prev + RATE_PER_MIN * (push(state.channels.russia) - push(state.channels.ukraine)) * dtMin, 3, 97);
    detectCaptures(prev, state.russiaShare); detectMilestones(prev, state.russiaShare);
  }
  state.lastUpdate = now; saveState();
}

// ---------------------------------------------------------------------------
function rosterOf(side, myName) {
  const a = state.army[side];
  const arr = Object.keys(a).map((n) => ({ name: n, msgs: Math.round(a[n].msgs), rank: rankTitle(a[n].msgs), viewer: !!a[n].viewer, you: n === myName, avatar: (a[n].id && avatarCache[a[n].id]) || null }));
  arr.sort((x, y) => y.msgs - x.msgs);
  return { total: arr.length, top: arr.slice(0, 14) };
}

function publicState(session) {
  const now = Date.now();
  const share = round1(state.russiaShare);
  const channels = {};
  for (const key of ['russia', 'ukraine']) {
    const c = state.channels[key], m = CHANNELS[key]; pruneRage(key, now);
    channels[key] = {
      key, name: m.name, slug: m.slug, title: m.title, faction: m.faction, army: m.army,
      role: m.role, emoji: m.emoji, flag: m.flag, side: m.side, command: m.command, url: m.url,
      live: c.live, viewers: Math.round(c.viewers), peak: Math.round(c.peak), followers: Math.round(c.followers),
      hours: round1(c.hours), uptimeSec: c.live && c.since ? Math.floor((now - c.since) / 1000) : 0,
      title2: c.title || '', avatar: (c._uid && avatarCache[c._uid]) || null,
      ragePerMin: state.rage[key].hits.length, rageThreshold: BOMB_THRESHOLD,
      cooldownMs: Math.max(0, state.rage[key].cooldownUntil - now), bombsFired: state.rage[key].bombs,
    };
  }
  const cities = CITIES.map((c) => ({ name: c.name, x: c.x, y: c.y, owner: ownerAt(share, c.x) }));
  const endsAt = state.war.start + state.war.durationDays * 86400000;
  const myName = session ? session.name : null;
  return {
    control: share,
    commands: { russia: CHANNELS.russia.command, ukraine: CHANNELS.ukraine.command },
    war: { status: state.war.status, winner: state.war.winner, start: state.war.start, endsAt, remainingMs: Math.max(0, endsAt - now), durationDays: state.war.durationDays },
    assault: { open: state.assault.open, countToday: state.assault.countToday, limit: ASSAULT_LIMIT, opensInMs: state.assault.open ? 0 : Math.max(0, state.assault.opensAt - now), closesInMs: state.assault.open ? Math.max(0, state.assault.closesAt - now) : 0 },
    channels, cities, bombs: state.bombs.slice(-16),
    army: { russia: rosterOf('russia', myName), ukraine: rosterOf('ukraine', myName) },
    grid: { w: GW, h: GH }, pixels: state.pixels,
    me: session ? { name: session.name, camp: session.camp || null, kick: !!session.kick, cooldownMs: Math.max(0, ((state.cooldowns[session.name] || 0) + PIXEL_COOLDOWN_MS) - now) } : null,
    kickConfigured: !!KICK_CLIENT_ID,
    log: state.log.slice(0, 40), serverTime: now,
  };
}

// ---------------------------------------------------------------------------
function placePixel(session, i) {
  if (!session || !session.camp) return { error: 'connecte-toi et choisis ton camp' };
  if (state.war.status !== 'active') return { error: 'la guerre est terminée' };
  const now = Date.now();
  const last = state.cooldowns[session.name] || 0; // cooldown par utilisateur (résiste à la reconnexion)
  if (last + PIXEL_COOLDOWN_MS > now) return { error: 'rechargement', cooldownMs: last + PIXEL_COOLDOWN_MS - now };
  i = Math.floor(Number(i)); if (!(i >= 0 && i < GW * GH)) return { error: 'case invalide' };
  const col = i % GW, xfrac = (col + 0.5) / GW, frontOwner = ownerAt(state.russiaShare, xfrac);
  if (frontOwner !== enemyOf(session.camp)) return { error: 'tu ne peux frapper que le territoire ennemi' };
  state.pixels[i] = session.camp;
  state.cooldowns[session.name] = now;
  addToArmy(session.camp, session.name, 3);
  const prev = state.russiaShare;
  state.russiaShare = clamp(prev + (session.camp === 'russia' ? 0.18 : -0.18), 3, 97);
  detectCaptures(prev, state.russiaShare);
  saveState();
  return { ok: true, cooldownMs: PIXEL_COOLDOWN_MS };
}

// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let u = decodeURIComponent((req.url.split('?')[0]) || '/'); if (u === '/') u = '/index.html';
  const fp = path.join(PUBLIC_DIR, path.normalize(u));
  if (!fp.startsWith(PUBLIC_DIR)) return res.writeHead(403).end('Forbidden');
  fs.readFile(fp, (e, d) => { if (e) return res.writeHead(404).end('404'); res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(d); });
}
function json(res, obj, code = 200, headers = {}) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); }
function parseCookies(req) { const h = req.headers.cookie || '', o = {}; h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function getSession(req) { const t = parseCookies(req).sw; return t && sessions[t] ? sessions[t] : null; }
function readBody(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); }); }
function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 20); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method;
  const session = getSession(req);

  if (p === '/api/state') return json(res, publicState(session));

  // diagnostic live (à ouvrir après déploiement pour vérifier la connexion Kick)
  if (p === '/api/debug/kick') {
    if (!CONFIGURED) return json(res, { configured: false, note: 'KICK_CLIENT_ID / KICK_CLIENT_SECRET non définis → mode simulation' });
    try {
      const tok = await getAppToken();
      const r = await fetch(`https://api.kick.com/public/v1/channels?slug=${CHANNELS.russia.slug}&slug=${CHANNELS.ukraine.slug}`, { headers: { Authorization: 'Bearer ' + tok } });
      return json(res, { configured: true, tokenOK: !!tok, wsSupported: typeof WebSocket !== 'undefined',
        chatroomEnv: { russia: !!CHATROOM.russia, ukraine: !!CHATROOM.ukraine },
        chatroomResolved: { russia: state.channels.russia._chatroomId || CHATROOM.russia || null, ukraine: state.channels.ukraine._chatroomId || CHATROOM.ukraine || null },
        chatConnected: { russia: !!chatWS.russia, ukraine: !!chatWS.ukraine },
        persist: REMOTE ? 'upstash' : 'fichier (éphémère sur Render!)',
        channels: await r.json() });
    } catch (e) { return json(res, { configured: true, error: e.message }); }
  }

  if (p === '/api/login' && m === 'POST') {
    const body = await readBody(req); const name = cleanName(body.name);
    if (!name) return json(res, { error: 'pseudo invalide' }, 400);
    const token = crypto.randomUUID(); sessions[token] = { name, camp: null, lastPixel: 0, kick: false };
    return json(res, { ok: true, me: { name, camp: null, kick: false } }, 200, { 'Set-Cookie': `sw=${token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax` });
  }
  if (p === '/api/logout' && m === 'POST') { const t = parseCookies(req).sw; if (t) delete sessions[t]; return json(res, { ok: true }, 200, { 'Set-Cookie': 'sw=; Path=/; Max-Age=0' }); }
  if (p === '/api/camp' && m === 'POST') {
    if (!session) return json(res, { error: 'non connecté' }, 401);
    const body = await readBody(req); const side = body.side === 'ukraine' ? 'ukraine' : body.side === 'russia' ? 'russia' : null;
    if (!side) return json(res, { error: 'camp invalide' }, 400);
    // retire de l'autre armee
    const other = enemyOf(side); if (state.army[other][session.name]) delete state.army[other][session.name];
    session.camp = side; addToArmy(side, session.name, 0); state.army[side][session.name].viewer = true;
    pushLog(side, `${session.name} rejoint ${CHANNELS[side].army} !`); saveState();
    return json(res, { ok: true, camp: side });
  }
  if (p === '/api/pixel' && m === 'POST') { const body = await readBody(req); return json(res, placePixel(session, body.i)); }

  // Kick OAuth 2.1 (PKCE)
  if (p === '/api/auth/kick') {
    if (!KICK_CLIENT_ID) return json(res, { error: 'Kick non configuré (voir README).' }, 501);
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const st = crypto.randomUUID();
    pkce.set(st, { verifier, createdAt: Date.now() });
    for (const [k, v] of pkce) if (Date.now() - v.createdAt > 600000) pkce.delete(k);
    const a = new URL('https://id.kick.com/oauth/authorize');
    a.searchParams.set('client_id', KICK_CLIENT_ID);
    a.searchParams.set('redirect_uri', PUBLIC_URL + '/api/auth/kick/callback');
    a.searchParams.set('response_type', 'code');
    a.searchParams.set('scope', 'user:read');
    a.searchParams.set('state', st);
    a.searchParams.set('code_challenge', challenge);
    a.searchParams.set('code_challenge_method', 'S256');
    return res.writeHead(302, { Location: a.toString() }).end();
  }
  if (p === '/api/auth/kick/callback') {
    const code = url.searchParams.get('code'), st = url.searchParams.get('state'), entry = st && pkce.get(st);
    if (!code || !entry) return res.writeHead(302, { Location: '/?login=err' }).end();
    pkce.delete(st);
    try {
      const tokRes = await fetch('https://id.kick.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: KICK_CLIENT_ID, client_secret: KICK_CLIENT_SECRET, redirect_uri: PUBLIC_URL + '/api/auth/kick/callback', code_verifier: entry.verifier, code }),
      });
      const tok = await tokRes.json();
      if (!tok.access_token) throw new Error('pas de token: ' + JSON.stringify(tok).slice(0, 120));
      const profRes = await fetch('https://api.kick.com/public/v1/users', { headers: { Authorization: 'Bearer ' + tok.access_token } });
      const prof = await profRes.json();
      const u = (prof.data && prof.data[0]) || {};
      const name = cleanName(u.name || u.username || u.slug || ('kick_' + (u.user_id || u.id || ''))) || 'Soldat';
      const token = crypto.randomUUID(); sessions[token] = { name, camp: null, lastPixel: 0, kick: true };
      return res.writeHead(302, { Location: '/', 'Set-Cookie': `sw=${token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax` }).end();
    } catch (e) { console.error('OAuth Kick:', e.message); return res.writeHead(302, { Location: '/?login=err' }).end(); }
  }

  serveStatic(req, res);
});

(async () => {
  if (REMOTE) await loadRemote();
  server.listen(PORT, () => { console.log(`\n  GOUGOULE vs YAYA -> ${PUBLIC_URL}  ${DEMO ? '[DEMO]' : ''}  [persist: ${REMOTE ? 'upstash' : 'fichier'}]\n`); });
  tick().catch((e) => console.error(e));
  setInterval(() => tick().catch((e) => console.error(e)), POLL_MS);
})();
// sauvegarde avant l'arrêt (déploiement Render) pour ne rien perdre
process.on('SIGTERM', async () => { try { await flushRemote(); } catch {} process.exit(0); });
