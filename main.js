// App controller: menus, lobby, hosting/joining, starting and leaving games.
import { Server } from './server.js';
import { HostNet, ClientNet, ServerNet, normaliseCode, relayStatus } from './net.js';
import { STEPS as NET_STEPS, runNetTest, summarise as netVerdict, resultsText as netResultsText } from './nettest.js';
import { logEntries, logText, entryText, clearLog } from './netlog.js';
import { CONFIG } from './config.js';
import { Game } from './game.js';
import { MAPS, mapsFor, isDmMap, dmVariant, resolveMap } from './maps.js';
import { initAudio, setVolume, setAmbienceVolume, playClick } from './audio.js';
import { World } from './world.js';
import { drawMinimap } from './hud.js';
import { RULES } from './config.js';
import { ACTIONS, DEFAULT_KEYS, keyMap, keyLabel } from './keys.js';
import { DEFAULT_CROSSHAIR, crosshairCfg, drawCrosshair, crosshairCode, parseCrosshairCode } from './crosshair.js';
import { applyTouchLayout, openLayoutEditor } from './touchlayout.js';
import { GFX_OPTIONS, PRESETS, resolveGraphics } from './graphics.js';
import * as acct from './accounts.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const screens = ['menu', 'lobby', 'settings', 'howto', 'practice', 'account', 'nettest'];

// ---------- settings ----------
const STORE = 'siteline-settings';
const defaults = {
  name: '', sens: 1, fov: 75, volume: 0.7, ambience: 0.6, quality: 'auto', touchMode: 'auto', invert: false, showChat: true,
  keys: {}, crosshair: { ...DEFAULT_CROSSHAIR }, touchLayout: {}, graphics: { preset: 'auto', custom: {} },
  // last practice choices
  practice: { kind: 'range', map: 'outpost', bots: true, count: 6, behavior: 'still', side: 'atk', level: 'normal', dmMap: 'quarry', dmCount: 3 },
};
function loadSettings() {
  try {
    const s = { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
    s.practice = { ...defaults.practice, ...(s.practice || {}) };
    return s;
  } catch (e) { return { ...defaults, practice: { ...defaults.practice } }; }
}
// the settings that follow you to other devices when you're logged in
const SYNCED = ['keys', 'crosshair', 'touchLayout', 'graphics', 'sens', 'fov', 'invert', 'volume', 'ambience', 'showChat'];
function saveSettings() {
  try {
    const { touch, ...rest } = settings;
    localStorage.setItem(STORE, JSON.stringify(rest));
  } catch (e) { /* storage unavailable */ }
  const synced = {};
  for (const k of SYNCED) synced[k] = settings[k];
  acct.saveAccountSettings(synced);
}
const settings = loadSettings();
const isTouchDevice = () => (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches) || /iPad|iPhone|Android/i.test(navigator.userAgent);
function resolvedTouch() { return settings.touchMode === 'on' || (settings.touchMode === 'auto' && isTouchDevice()); }
function resolvedQuality() { return resolveGraphics(settings.graphics, isTouchDevice()); }
setVolume(settings.volume);
setAmbienceVolume(settings.ambience == null ? 0.6 : settings.ambience);

// ---------- app state ----------
const app = {
  mode: null,          // 'host' | 'client' | 'practice'
  server: null, hostNet: null, clientNet: null,
  myId: null, roster: [], lobby: { map: 'outpost', winRounds: RULES.winRounds, mode: 'wingman' }, code: null,
  game: null, returnTo: 'menu',
};

function show(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
}
function hideScreens() { for (const s of screens) $(s).classList.add('hidden'); }

export function toast(text, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function loading(text) {
  if (!text) { $('loading').classList.add('hidden'); return; }
  $('loading-text').textContent = text;
  $('loading').classList.remove('hidden');
}

function playerName() {
  let n = $('name').value.trim();
  if (!n) { n = `Player${Math.floor(100 + Math.random() * 900)}`; $('name').value = n; }
  settings.name = n.slice(0, 16);
  saveSettings();
  return settings.name;
}

function tryFullscreen() {
  if (!isTouchDevice()) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (e) { /* not supported */ }
  }
}

// ---------- transport ----------
function sendToServer(msg) {
  if (app.mode === 'client') app.clientNet && app.clientNet.send(msg);
  else if (app.server) app.server.receive('host', msg);
}

function makeLocalServer(practice) {
  return new Server({
    practice,
    send: (id, msg) => {
      if (id === 'host') queueMicrotask(() => deliver(msg));
      else if (app.hostNet) app.hostNet.send(id, msg);
    },
  });
}

// Every message from the host (or local server) to this player lands here.
function deliver(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome':
      if (app.mode === 'client') rememberRoom();
      app.myId = msg.id;
      app.roster = msg.roster;
      app.lobby = msg.settings;
      if (app.mode !== 'practice' && msg.phase === 'lobby') { loading(null); showLobby(); }
      return;
    case 'roster':
      app.roster = msg.roster;
      if (app.mode === 'client') app.botGame = msg.botGame || null;
      app.lobby = msg.settings;
      document.body.classList.toggle('is-host', isLeader());
      if (app.game) app.game.onMessage(msg);
      else if (app.mode !== 'practice') renderLobby();
      return;
    case 'start':
      loading(null);
      startGame(msg);
      return;
    case 'lobby':
      endGame();
      $('over').classList.add('hidden');
      showLobby();
      return;
    case 'over':
      showOver(msg);
      return;
    case 'toast':
      toast(msg.text);
      return;
    case 'room':
      app.code = msg.code;
      if (app.mode === 'client') rememberRoom();
      return;
    case 'ping':
      sendToServer({ t: 'pong', ts: msg.ts });
      return;
    default:
      if (app.game) app.game.onMessage(msg);
  }
}

// Is this player allowed to change settings and start the match?
function isLeader() {
  if (app.mode === 'host' || app.mode === 'practice') return true;
  const me = app.roster.find(p => p.id === app.myId);
  return !!(me && me.owner);
}

// ---------- dedicated server ----------
async function serverGame(action, code) {
  const name = playerName();
  cleanup();
  app.mode = 'client';
  app.code = code || null;
  document.body.classList.remove('is-host');
  hideNetError();
  loading(code ? `Joining room ${code}…` : 'Creating room…');
  app.clientNet = new ServerNet({
    onMessage: deliver,
    onClose: () => {
      if (app.mode !== 'client') return;
      toast('Lost connection to the game server.', 5000);
      leaveToMenu();
    },
  });
  try {
    await app.clientNet.connect(CONFIG.serverUrl, { t: action, code, name });
  } catch (e) {
    loading(null);
    cleanup();
    showNetError(e.message || String(e));
  }
}

// ---------- connection problems ----------
// A failed host/join leaves its reason on the menu (a toast is gone before anyone reads it),
// with a button to test this Wi-Fi.
function showNetError(text) {
  $('net-error-text').textContent = text;
  $('net-error').classList.remove('hidden');
}
function hideNetError() { $('net-error').classList.add('hidden'); }

let netTestRun = 0;
function openNetTest() {
  hideNetError();
  openSub('nettest');
  startNetTest();
}
async function startNetTest() {
  const run = ++netTestRun;
  const list = $('nettest-list');
  list.innerHTML = '';
  const rows = {};
  for (const s of NET_STEPS) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="mark" aria-hidden="true"></span><span class="name"></span><span class="detail"></span>';
    li.querySelector('.name').textContent = s.label;
    li.querySelector('.detail').textContent = s.what;
    list.appendChild(li);
    rows[s.id] = li;
  }
  $('nettest-verdict').classList.add('hidden');
  $('nettest-text').classList.add('hidden');
  $('nettest-run').disabled = true;
  renderNetLog();
  const marks = { ok: '✓', fail: '✕', skip: '–', wait: '', run: '' };
  const results = await runNetTest((id, state, detail) => {
    if (run !== netTestRun || !rows[id]) return;
    rows[id].dataset.state = state;
    rows[id].querySelector('.mark').textContent = marks[state] || '';
    if (detail) rows[id].querySelector('.detail').textContent = detail;
  });
  if (run !== netTestRun) return;
  const v = netVerdict(results);
  const box = $('nettest-verdict');
  box.textContent = v.text;
  box.className = `nettest-verdict ${v.good ? 'good' : 'bad'}`;
  lastCheck = netResultsText(results);
  try { localStorage.setItem('siteline-netcheck-v1', lastCheck); } catch (e) { /* storage blocked */ }
  $('nettest-run').disabled = false;
  renderNetLog();
}
let lastCheck = '';
// the saved host / join attempts (netlog.js), newest first
function renderNetLog() {
  const list = $('netlog-list');
  list.innerHTML = '';
  const entries = logEntries();
  if (!entries.length) { list.innerHTML = '<li><span class="empty">Nothing saved yet. Host or join a game and it will appear here.</span></li>'; return; }
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = /failed|lost/.test(e.outcome) ? 'bad' : e.outcome === 'connected' ? 'good' : '';
    const kind = { join: 'Joined', host: 'Hosted', invite: 'Practice invite room', server: 'Game server' }[e.kind] || e.kind;
    const t = document.createElement('span'); t.textContent = `${new Date(e.at).toLocaleString()} · ${kind}${e.info && e.info.code ? ` ${e.info.code}` : ''} · ${e.outcome}`;
    li.appendChild(t);
    if (e.message) { const m = document.createElement('span'); m.className = 'msg'; m.textContent = e.message; li.appendChild(m); }
    list.appendChild(li);
  }
}
function everythingText() {
  let check = lastCheck;
  if (!check) { try { check = localStorage.getItem('siteline-netcheck-v1') || ''; } catch (e) { /* storage blocked */ } }
  return [check || '(connection check not run yet)', '', '=== Saved connection attempts (newest first) ===', logText()].join('\n');
}
// copy text; where the clipboard isn't allowed, show it in the Connection check screen to copy by hand
async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch (e) {
    if ($('nettest').classList.contains('hidden')) openSub('nettest');
    renderNetLog();
    const ta = $('nettest-text');
    ta.value = text; ta.classList.remove('hidden'); ta.focus(); ta.select();
    toast('Select the text and copy it.');
  }
}

// ---------- host / join / practice ----------
async function hostGame() {
  initAudio();
  tryFullscreen();
  if (CONFIG.serverUrl) return serverGame('create');
  const name = playerName();
  cleanup();
  app.mode = 'host';
  document.body.classList.add('is-host');
  loading('Creating room…');
  app.server = makeLocalServer(false);
  app.hostNet = new HostNet({
    onJoin: (id, n) => app.server && app.server.addPlayer(id, n),
    onMessage: (id, m) => app.server && app.server.receive(id, m),
    onLeave: (id) => app.server && app.server.removePlayer(id),
    onError: (e) => toast(e),
  });
  hideNetError();
  try {
    app.code = await app.hostNet.open();
  } catch (e) {
    loading(null);
    cleanup();
    showNetError(e.message || String(e));
    return;
  }
  if (app.mode !== 'host') return; // cancelled
  app.server.addPlayer('host', name);
  if (relayStatus() === 'blocked') toast('This Wi-Fi blocks the relay sign-in, so friends on school or work Wi-Fi may not be able to join. Menu → Connection check shows more.', 9000);
}

async function joinGame(rawCode) {
  initAudio();
  const code = normaliseCode(rawCode);
  if (code.length < 4) { toast('Enter the room code from the host.'); $('code').focus(); return; }
  tryFullscreen();
  if (CONFIG.serverUrl) return serverGame('join', code);
  const name = playerName();
  cleanup();
  app.mode = 'client';
  app.code = code;
  document.body.classList.remove('is-host');
  hideNetError();
  loading(`Joining room ${code}…`);
  const net = app.clientNet = new ClientNet({
    onMessage: deliver,
    onStatus: (text) => { if (app.clientNet === net && !$('loading').classList.contains('hidden')) loading(text); },
    onClose: () => {
      if (app.mode !== 'client') return;
      toast('Disconnected from the host.', 5000);
      leaveToMenu();
    },
  });
  try {
    // resolves once the host has answered (its welcome has already opened the lobby or the game)
    await net.connect(code, name);
  } catch (e) {
    if (app.clientNet !== net) return;   // left or started something else meanwhile
    loading(null);
    cleanup();
    forgetRoom(code);                    // that room can't be reached any more: stop offering it
    showNetError(e.message || String(e));
  }
}

// cfg: { kind: 'range' | 'match' | 'dm', map, count, behavior, side, level } — see Server.startBotGame
function practice(cfg) {
  initAudio();
  tryFullscreen();
  const name = playerName();
  cleanup();
  app.mode = 'practice';
  app.botGame = cfg.kind;
  document.body.classList.add('is-host');
  app.server = makeLocalServer(cfg.kind === 'range');
  app.server.addPlayer('host', name);
  app.server.startBotGame(cfg);
  openInviteRoom();
}

// Practice games also open a room (quietly) so friends can join with the code or link.
// If it can't be opened (offline, blocked network) practice still works, just without invites.
async function openInviteRoom() {
  if (CONFIG.serverUrl) return;
  const net = new HostNet({
    onJoin: (id, n) => app.server && app.server.addPlayer(id, n),
    onMessage: (id, m) => app.server && app.server.receive(id, m),
    onLeave: (id) => app.server && app.server.removePlayer(id),
    onError: () => {},
    logKind: 'invite',
  });
  app.hostNet = net;
  try {
    const code = await net.open();
    if (app.hostNet !== net) { net.destroy(); return; }
    app.code = code;
    updatePauseInvite();
  } catch (e) {
    if (app.hostNet === net) { app.hostNet = null; net.destroy(); }
  }
}

function updatePauseInvite() {
  const show = app.mode === 'practice' && !!app.code;
  $('pause-invite').classList.toggle('hidden', !show);
  if (show) $('pause-code').textContent = app.code;
}

// ---------- practice menu ----------
function practiceMaps(kind, count) {
  return kind === 'dm' ? mapsFor('dm', 1 + count) : Object.keys(MAPS).filter(id => !isDmMap(id));
}

function renderPracticeMenu() {
  const P = settings.practice;
  const el = $('practice');
  el.classList.remove('m-range', 'm-match', 'm-dm');
  el.classList.add(`m-${P.kind}`);
  el.classList.toggle('bots-on', !!P.bots);
  for (const b of document.querySelectorAll('.pmode-btn')) b.classList.toggle('selected', b.dataset.pmode === P.kind);
  const count = P.kind === 'dm' ? P.dmCount : P.count;
  const slider = $('p-count');
  slider.max = P.kind === 'dm' ? 3 : 8;
  slider.value = count;
  $('p-count-out').textContent = count;
  const maps = practiceMaps(P.kind, count);
  const cur = P.kind === 'dm' ? P.dmMap : P.map;
  const sel = $('p-map');
  sel.innerHTML = '';
  for (const id of maps) {
    const o = document.createElement('option');
    const def = MAPS[id];
    o.value = id;
    o.textContent = def.sizes ? `${def.name} (${dmVariant(1 + count) === 'large' ? 'large' : 'small'})` : def.name;
    sel.appendChild(o);
  }
  sel.value = maps.includes(cur) ? cur : maps[0];
  $('p-bots').checked = !!P.bots;
  $('p-behavior').value = P.behavior;
  $('p-side').value = P.side;
  $('p-level').value = P.level;
  $('p-night').checked = !!P.night;
}

function bindPracticeMenu() {
  const P = () => settings.practice;
  const save = () => { saveSettings(); renderPracticeMenu(); };
  for (const b of document.querySelectorAll('.pmode-btn')) b.addEventListener('click', () => { P().kind = b.dataset.pmode; save(); });
  $('p-map').addEventListener('change', e => { if (P().kind === 'dm') P().dmMap = e.target.value; else P().map = e.target.value; save(); });
  $('p-bots').addEventListener('change', e => { P().bots = e.target.checked; save(); });
  $('p-count').addEventListener('input', e => { if (P().kind === 'dm') P().dmCount = Number(e.target.value); else P().count = Number(e.target.value); save(); });
  $('p-behavior').addEventListener('change', e => { P().behavior = e.target.value; save(); });
  $('p-side').addEventListener('change', e => { P().side = e.target.value; save(); });
  $('p-level').addEventListener('change', e => { P().level = e.target.value; save(); });
  $('p-night').addEventListener('change', e => { P().night = e.target.checked; save(); });
  $('p-start').addEventListener('click', () => {
    const p = P();
    const maps = practiceMaps(p.kind, p.kind === 'dm' ? p.dmCount : p.count);
    const map = $('p-map').value || maps[0];
    const side = p.side === 'random' ? (Math.random() < 0.5 ? 'atk' : 'def') : p.side;
    practice({
      kind: p.kind, map, level: p.level, behavior: p.behavior, side, night: !!p.night,
      count: p.kind === 'dm' ? p.dmCount : (p.bots ? p.count : 0),
    });
  });
}

function cleanup() {
  endGame();
  if (app.server) { app.server.destroy(); app.server = null; }
  if (app.hostNet) { app.hostNet.destroy(); app.hostNet = null; }
  if (app.clientNet) { app.clientNet.destroy(); app.clientNet = null; }
  app.mode = null; app.myId = null; app.roster = []; app.code = null; app.botGame = null;
  updatePauseInvite();
}

// ---------- rejoin ----------
// The last room you were in as a guest is remembered on this device for half an hour, so after
// leaving (or losing the connection) the menu offers to go straight back in.
const LAST_ROOM = 'siteline-lastroom';
function rememberRoom() {
  if (!app.code) return;
  try { localStorage.setItem(LAST_ROOM, JSON.stringify({ code: app.code, t: Date.now() })); } catch (e) { /* storage unavailable */ }
}
function forgetRoom(code) {
  try {
    const r = JSON.parse(localStorage.getItem(LAST_ROOM) || 'null');
    if (!code || (r && r.code === code)) localStorage.removeItem(LAST_ROOM);
  } catch (e) { /* ignore */ }
  updateRejoin();
}
function lastRoom() {
  try {
    const r = JSON.parse(localStorage.getItem(LAST_ROOM) || 'null');
    return r && r.code && Date.now() - r.t < 30 * 60 * 1000 ? r.code : null;
  } catch (e) { return null; }
}
function updateRejoin() {
  const code = lastRoom(), btn = $('btn-rejoin');
  btn.classList.toggle('hidden', !code);
  if (code) btn.textContent = `Rejoin your last game (${code})`;
}

function leaveToMenu() {
  cleanup();
  $('pause').classList.add('hidden');
  $('over').classList.add('hidden');
  loading(null);
  show('menu');
  updateRejoin();
}

// ---------- lobby ----------
function showLobby() {
  show('lobby');
  renderLobby();
}

function drawMapPreview(canvas, def) {
  canvas.width = canvas.height = 192;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, 192, 192);
  drawMinimap(canvas, new World(def));
}

function renderMapCards() {
  const wrap = $('map-cards');
  const isHost = isLeader();
  if (!wrap.children.length) {
    for (const [id, def] of Object.entries(MAPS)) {
      const b = document.createElement('button');
      b.className = 'map-card';
      b.dataset.map = id;
      const c = document.createElement('canvas');
      drawMapPreview(c, resolveMap(id, 'large'));
      const info = document.createElement('div');
      info.innerHTML = `<b></b><span></span>`;
      info.querySelector('b').textContent = def.name;
      info.querySelector('span').textContent = def.description;
      if (def.sizes) {
        const sz = document.createElement('small');
        sz.className = 'map-size';
        info.appendChild(sz);
      }
      b.append(c, info);
      b.addEventListener('click', () => sendToServer({ t: 'settings', map: id }));
      wrap.appendChild(b);
    }
  }
  const mode = app.lobby.mode || 'wingman';
  const n = humans().length;
  const fits = mapsFor(mode, n);
  for (const b of wrap.children) {
    b.classList.toggle('hidden', !fits.includes(b.dataset.map));
    b.classList.toggle('selected', b.dataset.map === app.lobby.map);
    b.disabled = !isHost;
    const sz = b.querySelector('.map-size');
    if (sz) {
      const v = dmVariant(n), [w, d] = MAPS[b.dataset.map].sizes[v];
      sz.textContent = n === 2 || n === 4 ? `${v === 'large' ? 'Large' : 'Small'} version for ${n} players (${w} × ${d} m)` : 'Small for 2 players, large for 4';
    }
  }
}

function humans() { return app.roster.filter(p => !p.dummy); }

function renderLobby() {
  if ($('lobby').classList.contains('hidden')) return;
  document.body.classList.toggle('is-host', isLeader());
  $('room-code').textContent = app.code || '-----';
  const dm = app.lobby.mode === 'dm';
  $('lobby').classList.toggle('dm', dm);
  $('lobby-night').checked = !!app.lobby.night;
  $('lobby-night').disabled = !isLeader();
  for (const b of document.querySelectorAll('.mode-btn[data-mode]')) {
    b.classList.toggle('selected', b.dataset.mode === (app.lobby.mode || 'wingman'));
    b.disabled = !isLeader();
  }
  // deathmatch: one list of everyone in the room
  const ffa = $('list-ffa');
  ffa.innerHTML = '';
  for (const p of humans()) {
    const li = document.createElement('li');
    li.textContent = p.name + (p.id === app.myId ? '  (you)' : '') + (p.owner ? '  · host' : '');
    ffa.appendChild(li);
  }
  for (const team of ['atk', 'def']) {
    const ul = $(`list-${team}`);
    ul.innerHTML = '';
    const members = app.roster.filter(p => p.team === team && !p.dummy);
    for (const p of members) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = p.name;
      li.appendChild(name);
      const tags = [];
      if (p.owner) tags.push('host');
      if (p.id === app.myId) tags.push('you');
      if (tags.length) {
        const t = document.createElement('span');
        t.className = 'tagme';
        t.textContent = tags.join(' · ');
        li.appendChild(t);
      }
      ul.appendChild(li);
    }
    if (!members.length) {
      const li = document.createElement('li');
      li.style.opacity = '.5';
      li.textContent = 'Empty';
      ul.appendChild(li);
    }
  }
  const me = app.roster.find(p => p.id === app.myId);
  for (const b of document.querySelectorAll('.team-join')) {
    const full = app.roster.filter(p => p.team === b.dataset.team && !p.dummy).length >= RULES.teamSize;
    b.classList.toggle('hidden', (!!me && me.team === b.dataset.team) || full);
  }
  renderMapCards();
  const n = humans().length;
  const counts = { atk: app.roster.filter(p => p.team === 'atk').length, def: app.roster.filter(p => p.team === 'def').length };
  const D = RULES.dm;
  $('match-rules').innerHTML = dm
    ? `<b>Deathmatch</b> · everyone for themselves · first to <b>${D.killLimit}</b> kills or <b>${D.timeLimit / 60}</b> minutes · ${n === 3 ? 'played on a 2v2 map with 3 players' : 'small map for 2, large for 4'}`
    : '<b>2v2</b> · first to <b>9</b> · sides swap after round <b>8</b> · 8–8 is a draw';
  let note, ready;
  if (dm) {
    ready = n >= D.minPlayers && n <= D.maxPlayers;
    note = !isLeader() ? 'Waiting for the host to start the match…'
      : n < D.minPlayers ? `Deathmatch needs ${D.minPlayers} to ${D.maxPlayers} players. Share the room code or invite link.`
        : `${n} players ready. Start when everyone's in.`;
  } else {
    ready = counts.atk > 0 && counts.def > 0;
    if (isLeader()) {
      note = n < 2 ? 'Share the room code or invite link with a friend or three. You need at least one player on each team.'
        : !ready ? 'Each team needs at least one player.' : `${n} players ready. Start when everyone's in.`;
    } else note = 'Waiting for the host to start the match…';
  }
  $('lobby-note').textContent = note;
  $('btn-start').disabled = !ready;
}

function inviteLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', app.code);
  // keep a custom signalling server in the link if one is in use
  const cur = new URLSearchParams(location.search);
  for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure', 'server']) if (cur.get(k)) u.searchParams.set(k, cur.get(k));
  return u.toString();
}

async function shareInvite() {
  const link = inviteLink();
  if (navigator.share && isTouchDevice()) {
    try { await navigator.share({ title: 'SITELINE', text: `Join my SITELINE game — room ${app.code}`, url: link }); return; } catch (e) { /* cancelled */ }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch (e) {
    prompt('Copy this invite link:', link);
  }
}

// ---------- game ----------
function startGame(msg) {
  endGame();
  hideScreens();
  $('over').classList.add('hidden');
  settings.touch = resolvedTouch();
  document.body.classList.add('in-game');
  app.game = new Game({
    transport: { send: sendToServer },
    myId: app.myId,
    roster: msg.roster,
    map: msg.map,
    practice: !!msg.practice,
    mode: msg.mode,
    variant: msg.variant,
    night: !!(msg.settings && msg.settings.night),
    settings,
    quality: resolvedQuality(),
    isHost: app.mode !== 'client',
    onPause: showPause,
  });
  if (window.__debug) window.__game = app.game;
  if (!settings.touch) showPause(true);
}

function endGame() {
  if (app.game) { app.game.destroy(); app.game = null; saveSettings(); }
  document.body.classList.remove('in-game');
  $('pause').classList.add('hidden');
}

function showPause(first = false) {
  if (!app.game) return;
  app.game.paused = true;
  const titles = { range: 'Practice range', match: 'Bot match', dm: 'Bot deathmatch' };
  $('pause-title').textContent = first === true ? (titles[app.botGame] || 'Ready?') : 'Paused';
  $('pause-sub').textContent = first === true
    ? 'Click Play, then use your mouse to aim. Press Esc any time for this menu.'
    : (app.botGame === 'range' ? 'Bots respawn after 3 seconds. Bots marked (armour) wear a vest and helmet. Everything in the buy menu is free.'
      : 'The match keeps running while you\'re in this menu.');
  updatePauseInvite();
  $('btn-resume').textContent = first === true ? 'Play' : 'Resume';
  $('btn-fullscreen').classList.toggle('hidden', !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen));
  $('pause').classList.remove('hidden');
}

function resume() {
  initAudio();
  $('pause').classList.add('hidden');
  if (!app.game) return;
  app.game.paused = false;
  app.game.input.requestLock();
}

function showOver(msg) {
  reportToAccount(msg);
  const names = { atk: 'Attackers', def: 'Defenders' };
  if (msg.mode === 'dm') return showDmOver(msg);
  $('over-title').textContent = msg.reason === 'draw' ? 'Draw — 8 rounds each'
    : msg.reason === 'forfeit' ? `${names[msg.winner]} win — the other team left` : `${names[msg.winner]} win the match`;
  $('over-title').style.color = msg.winner === 'atk' ? 'var(--atk)' : msg.winner === 'def' ? 'var(--def)' : 'var(--text)';
  $('over-score').innerHTML = `<span class="c-atk">${msg.score.atk}</span><span style="opacity:.5">–</span><span class="c-def">${msg.score.def}</span>`;
  const rows = msg.stats.slice().sort((a, b) => b.kills - a.kills).map(s => {
    const tr = document.createElement('tr');
    for (const v of [s.name, names[s.team], s.kills, s.deaths, s.hs || 0, s.dmg || 0]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    tr.firstChild.style.color = s.team === 'atk' ? 'var(--atk)' : 'var(--def)';
    return tr;
  });
  const table = document.createElement('table');
  table.innerHTML = '<tr><th>Player</th><th>Team</th><th>Kills</th><th>Deaths</th><th>HS</th><th>Damage</th></tr>';
  rows.forEach(r => table.appendChild(r));
  $('over-stats').replaceChildren(table);
  finishOver();
}

// shared end of the match-over screen: bot games offer "Play again" instead of the lobby
function finishOver() {
  $('btn-to-lobby').textContent = app.botGame ? 'Play again' : 'Back to lobby';
  $('over-wait').classList.toggle('hidden', isLeader());
  if (document.pointerLockElement) document.exitPointerLock();
  if (app.game) app.game.paused = true;
  $('pause').classList.add('hidden');
  $('over').classList.remove('hidden');
}

function showDmOver(msg) {
  const winner = msg.stats.find(s => s.id === msg.winner);
  $('over-title').textContent = msg.reason === 'draw' ? 'Draw — tied on kills'
    : msg.reason === 'forfeit' ? `${winner ? winner.name : 'Nobody'} wins — everyone else left`
      : `${winner ? (winner.id === app.myId ? 'You win' : `${winner.name} wins`) : 'Match over'}${msg.reason === 'time' ? ' (time)' : ''}`;
  $('over-title').style.color = winner && winner.id === app.myId ? 'var(--accent)' : 'var(--text)';
  $('over-score').innerHTML = winner ? `<span>${winner.kills} kill${winner.kills === 1 ? '' : 's'}</span>` : '';
  const table = document.createElement('table');
  table.innerHTML = '<tr><th>Player</th><th>Kills</th><th>Deaths</th><th>HS</th><th>Damage</th></tr>';
  for (const s of msg.stats.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)) {
    const tr = document.createElement('tr');
    for (const v of [s.name, s.kills, s.deaths, s.hs || 0, s.dmg || 0]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    table.appendChild(tr);
  }
  $('over-stats').replaceChildren(table);
  finishOver();
}

// ---------- settings screen ----------
function bindSettings() {
  // ---- tabs ----
  for (const t of document.querySelectorAll('#settings .tab')) {
    t.addEventListener('click', () => {
      for (const o of document.querySelectorAll('#settings .tab')) o.classList.toggle('selected', o === t);
      for (const p of document.querySelectorAll('#settings .tab-page')) p.classList.toggle('hidden', p.dataset.page !== t.dataset.tab);
      if (t.dataset.tab === 'crosshair') syncCrosshair();
    });
  }
  // ---- general ----
  const sync = () => {
    $('set-sens').value = settings.sens; $('sens-out').textContent = Number(settings.sens).toFixed(2);
    $('set-fov').value = settings.fov; $('fov-out').textContent = `${settings.fov}°`;
    $('set-vol').value = settings.volume; $('vol-out').textContent = `${Math.round(settings.volume * 100)}%`;
    const amb = settings.ambience == null ? 0.6 : settings.ambience;
    $('set-amb').value = amb; $('amb-out').textContent = amb > 0 ? `${Math.round(amb * 100)}%` : 'off';
    $('set-touch').value = settings.touchMode;
    $('set-invert').checked = settings.invert;
    $('set-chat').checked = settings.showChat !== false;
    document.body.classList.toggle('no-chat', settings.showChat === false);
  };
  app.syncGeneral = sync;
  sync();
  $('set-sens').addEventListener('input', e => { settings.sens = Number(e.target.value); sync(); saveSettings(); });
  $('set-fov').addEventListener('input', e => { settings.fov = Number(e.target.value); sync(); saveSettings(); });
  $('set-vol').addEventListener('input', e => { settings.volume = Number(e.target.value); setVolume(settings.volume); sync(); saveSettings(); });
  $('set-amb').addEventListener('input', e => { settings.ambience = Number(e.target.value); setAmbienceVolume(settings.ambience); sync(); saveSettings(); });
  $('set-touch').addEventListener('change', e => { settings.touchMode = e.target.value; saveSettings(); });
  $('set-invert').addEventListener('change', e => { settings.invert = e.target.checked; saveSettings(); });
  $('set-chat').addEventListener('change', e => { settings.showChat = e.target.checked; sync(); saveSettings(); });

  // ---- key bindings ----
  let listening = null;
  const renderKeys = () => {
    const k = keyMap(settings.keys);
    const used = {};
    for (const code of Object.values(k)) used[code] = (used[code] || 0) + 1;
    $('keybinds').innerHTML = ACTIONS.map(([act, label]) =>
      `<div class="kb-row"><span>${label}</span><button class="kb-key${listening === act ? ' listening' : ''}${used[k[act]] > 1 ? ' conflict' : ''}" data-act="${act}">${listening === act ? 'Press a key…' : keyLabel(k[act])}</button></div>`).join('');
    $('ctrl-warning').classList.toggle('hidden', !Object.values(k).some(c => /^Control/.test(c)));
  };
  app.renderKeys = renderKeys;
  $('keybinds').addEventListener('click', e => {
    const b = e.target.closest('.kb-key');
    if (!b) return;
    listening = listening === b.dataset.act ? null : b.dataset.act;
    renderKeys();
  });
  window.addEventListener('keydown', e => {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    if (e.code === 'Escape' && listening !== 'menu') { listening = null; renderKeys(); return; }
    const k = keyMap(settings.keys);
    // the key was used by another action: swap them
    const clash = Object.keys(k).find(a => a !== listening && k[a] === e.code);
    const next = { ...k, [listening]: e.code };
    if (clash) next[clash] = k[listening];
    settings.keys = next;
    listening = null;
    renderKeys();
    saveSettings();
  }, true);
  $('btn-keys-reset').addEventListener('click', () => { settings.keys = { ...DEFAULT_KEYS }; listening = null; renderKeys(); saveSettings(); });
  renderKeys();

  // ---- crosshair ----
  const XH = ['length', 'thickness', 'gap', 'opacity'];
  let demoT = 0;
  const syncCrosshair = () => {
    const c = settings.crosshair = crosshairCfg(settings.crosshair);
    $('xh-color').value = c.color;
    for (const k of XH) { $(`xh-${k}`).value = c[k]; $(`xh-${k}-out`).textContent = k === 'opacity' ? `${Math.round(c[k] * 100)}%` : c[k]; }
    $('xh-outline').checked = c.outline; $('xh-dot').checked = c.dot; $('xh-dynamic').checked = c.dynamic; $('xh-recoil').checked = c.recoil;
    $('xh-code').value = crosshairCode(c);
    // the preview "fires" a spray: the gap opens, and with follow recoil the crosshair climbs and sways
    const demo = $('xh-demo').checked, k = Math.sin(demoT) * 0.5 + 0.5;
    drawCrosshair($('xh-preview'), c, demo ? k * 18 : 0, demo && c.recoil ? Math.sin(demoT * 2.7) * 9 * k : 0, demo && c.recoil ? -k * 38 : 0);
  };
  const xhChange = () => {
    const c = settings.crosshair;
    c.color = $('xh-color').value;
    for (const k of XH) c[k] = Number($(`xh-${k}`).value);
    c.outline = $('xh-outline').checked; c.dot = $('xh-dot').checked; c.dynamic = $('xh-dynamic').checked; c.recoil = $('xh-recoil').checked;
    syncCrosshair();
    saveSettings();
  };
  for (const id of ['xh-color', ...XH.map(k => `xh-${k}`), 'xh-outline', 'xh-dot', 'xh-dynamic', 'xh-recoil']) $(id).addEventListener('input', xhChange);
  $('xh-demo').addEventListener('change', () => {
    const tick = () => {
      if (!$('xh-demo').checked || $('settings').classList.contains('hidden')) { syncCrosshair(); return; }
      demoT += 0.08; syncCrosshair(); requestAnimationFrame(tick);
    };
    tick();
  });
  $('btn-xh-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('xh-code').value); toast('Crosshair code copied'); } catch (e) { $('xh-code').select(); }
  });
  $('btn-xh-import').addEventListener('click', () => {
    const c = parseCrosshairCode($('xh-import').value);
    if (!c) { toast('That code doesn\'t look right.'); return; }
    settings.crosshair = c; $('xh-import').value = ''; syncCrosshair(); saveSettings(); toast('Crosshair imported');
  });
  $('btn-xh-reset').addEventListener('click', () => { settings.crosshair = { ...DEFAULT_CROSSHAIR }; syncCrosshair(); saveSettings(); });
  app.syncCrosshair = syncCrosshair;

  // ---- phone layout ----
  $('btn-layout-edit').addEventListener('click', () => {
    if (app.game) app.game.input.enabled = false;
    $('settings').classList.add('hidden');
    openLayoutEditor(settings.touchLayout, (layout) => {
      settings.touchLayout = layout;
      saveSettings();
      if (app.game) app.game.input.enabled = true;
      $('settings').classList.remove('hidden');
      applyTouchLayout(settings.touchLayout);
    });
  });
  $('btn-layout-reset').addEventListener('click', () => { settings.touchLayout = {}; applyTouchLayout({}); saveSettings(); toast('Phone layout reset'); });

  // ---- graphics ----
  const renderGfx = () => {
    const g = settings.graphics = { preset: 'auto', custom: {}, ...(settings.graphics || {}) };
    $('set-preset').value = g.preset;
    const cur = resolveGraphics(g, isTouchDevice());
    const custom = g.preset === 'custom';
    $('gfx-custom').innerHTML = GFX_OPTIONS.map(([key, label, choices]) =>
      `<label class="field"><span>${label}</span><select data-gfx="${key}" ${custom ? '' : 'disabled'}>${choices.map(([v, t]) =>
        `<option value="${v}" ${String(cur[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('');
  };
  app.renderGfx = renderGfx;
  $('set-preset').addEventListener('change', e => {
    const g = settings.graphics;
    // switching to Custom starts from whatever was showing
    if (e.target.value === 'custom' && g.preset !== 'custom') { const { preset, ...cur } = resolveGraphics(g, isTouchDevice()); g.custom = cur; void preset; }
    g.preset = e.target.value;
    renderGfx(); saveSettings();
  });
  $('gfx-custom').addEventListener('change', e => {
    const key = e.target.dataset.gfx;
    if (!key) return;
    const opt = GFX_OPTIONS.find(o => o[0] === key);
    const raw = e.target.value;
    const val = opt[2].map(c => c[0]).find(v => String(v) === raw);
    settings.graphics.custom = { ...settings.graphics.custom, [key]: val };
    saveSettings();
  });
  renderGfx();
  void PRESETS;
}

// ---------- account screen ----------
function bindAccount() {
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    for (const t of document.querySelectorAll('#account .tab')) t.classList.toggle('selected', t.dataset.acct === m);
    document.querySelector('.acct-signup').classList.toggle('hidden', m !== 'signup');
    $('btn-acct-go').textContent = m === 'signup' ? 'Create account' : 'Log in';
    $('acct-pass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    $('acct-msg').textContent = '';
  };
  for (const t of document.querySelectorAll('#account .tab')) t.addEventListener('click', () => setMode(t.dataset.acct));
  $('btn-acct-go').addEventListener('click', async () => {
    const email = $('acct-email').value.trim(), pass = $('acct-pass').value, user = $('acct-user').value.trim();
    $('acct-msg').textContent = mode === 'signup' ? 'Creating your account…' : 'Logging in…';
    try {
      if (mode === 'signup') {
        const r = await acct.signUp(email, pass, user);
        if (r.needsConfirm) setMode('login');
        $('acct-msg').textContent = r.needsConfirm ? 'Account created! Check your email and click the link to confirm, then log in here.' : '';
      } else await acct.logIn(email, pass);
    } catch (e) { $('acct-msg').textContent = e.message || String(e); }
  });
  $('btn-acct-logout').addEventListener('click', () => acct.logOut());
  acct.onAccountChange(() => { renderAccount(); onLogin(); });
  setMode('login');
}

function renderAccount() {
  const on = acct.accountsEnabled(), p = acct.currentProfile();
  $('acct-off').classList.toggle('hidden', on);
  $('acct-out').classList.toggle('hidden', !on || !!p);
  $('acct-in').classList.toggle('hidden', !p);
  $('btn-account').textContent = p ? `Account (${p.username})` : 'Account';
  if (!p) return;
  $('acct-name').textContent = p.username;
  $('acct-balance').textContent = `Balance $${(p.balance_cents / 100).toFixed(2)}`;
  const fav = acct.favouriteWeapon(p);
  const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : String(p.kills);
  const hsp = p.kills ? `${Math.round(p.headshots / p.kills * 100)}%` : '—';
  const stats = [
    ['Kills', p.kills], ['Deaths', p.deaths], ['K/D', kd], ['Headshots', `${p.headshots} (${hsp})`], ['Damage', p.damage],
    ['Matches played', p.matches_played], ['Matches won', p.matches_won], ['Rounds won', p.rounds_won], ['Deathmatch wins', p.dm_wins],
    ['Favourite weapon', fav && WEAPONS[fav] ? WEAPONS[fav].name : '—'],
  ];
  $('acct-stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('');
}

// logged in: use the account's username and its saved settings
let loadedFor = null;
function onLogin() {
  const p = acct.currentProfile();
  if (!p) { loadedFor = null; return; }
  $('name').value = p.username;
  settings.name = p.username;
  if (loadedFor === p.id) return;
  loadedFor = p.id;
  const remote = p.settings || {};
  if (Object.keys(remote).length) {
    for (const k of SYNCED) if (remote[k] !== undefined) settings[k] = remote[k];
    settings.crosshair = crosshairCfg(settings.crosshair);
    setVolume(settings.volume);
    setAmbienceVolume(settings.ambience == null ? 0.6 : settings.ambience);
    try { const { touch, ...rest } = settings; localStorage.setItem(STORE, JSON.stringify(rest)); } catch (e) { /* ignore */ }
    app.syncGeneral && app.syncGeneral(); app.renderKeys && app.renderKeys(); app.syncCrosshair && app.syncCrosshair(); app.renderGfx && app.renderGfx();
    applyTouchLayout(settings.touchLayout);
    toast('Loaded your saved settings');
  } else saveSettings();   // first login: upload this device's settings
}

// After a real online match, add it to the account (practice and bot games never count).
async function reportToAccount(msg) {
  if (!acct.loggedIn() || app.botGame || app.mode === 'practice' || !app.game) return;
  const me = msg.stats.find(s => s.id === app.myId);
  if (!me) return;
  const dm = msg.mode === 'dm';
  const won = dm ? msg.winner === app.myId : msg.winner === me.team;
  try {
    const r = await acct.reportMatch({
      mode: dm ? 'dm' : 'wingman', won, kills: me.kills, deaths: me.deaths, headshots: me.hs, damage: me.dmg,
      roundsWon: dm ? 0 : (msg.score && msg.score[me.team]) || 0, weaponKills: app.game.weaponKills || {},
    });
    if (r && r.bonus_cents) toast(`Match win! +$${(r.bonus_cents / 100).toFixed(2)} added to your balance`, 5000);
    else toast('Stats saved to your account');
  } catch (e) { toast(`Couldn't save stats: ${e.message}`); }
}

function openSub(id) {
  app.returnTo = app.game ? 'game' : (!$('lobby').classList.contains('hidden') ? 'lobby' : 'menu');
  if (app.game) $('pause').classList.add('hidden');
  show(id);
}

function closeSub() {
  if (app.returnTo === 'game' && app.game) { hideScreens(); showPause(); }
  else show(app.returnTo === 'lobby' ? 'lobby' : 'menu');
}

// Phones: no pinch or double-tap zooming of the page (the game can't be un-zoomed with its own
// controls), and if the page does end up zoomed in, snap it back.
function stopPageZoom() {
  const typing = (e) => e.target && e.target.closest && e.target.closest('input, select, textarea');
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, e => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', e => { if (!typing(e)) e.preventDefault(); }, { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now(), quick = now - lastTap < 350;
    lastTap = now;
    // a second tap straight after the first would zoom: cancel that, but still press whatever was tapped
    if (quick && !typing(e) && e.cancelable && e.touches.length === 0) {
      e.preventDefault();
      const b = e.target.closest && e.target.closest('button, a, label, summary');
      if (b && !b.closest('#touch')) b.click();
    }
  }, { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });
  const vv = window.visualViewport, meta = document.querySelector('meta[name="viewport"]');
  if (vv && meta) {
    const base = meta.getAttribute('content');
    vv.addEventListener('resize', () => {
      if (vv.scale > 1.02) {
        // re-stating the page scale makes the browser zoom back out
        meta.setAttribute('content', base + ', minimum-scale=1');
        setTimeout(() => meta.setAttribute('content', base), 300);
      }
    });
  }
}

// ---------- wire up ----------
function init() {
  $('name').value = settings.name || '';
  const params = new URLSearchParams(location.search);
  const invite = normaliseCode(params.get('join'));
  if (invite) {
    $('code').value = invite;
    $('invite-code').textContent = invite;
    $('invite').classList.remove('hidden');
    $('btn-join').classList.replace('secondary', 'primary');
    $('btn-host').classList.replace('primary', 'secondary');
  }

  $('btn-host').addEventListener('click', hostGame);
  $('btn-rejoin').addEventListener('click', () => { const code = lastRoom(); if (code) joinGame(code); else updateRejoin(); });
  updateRejoin();
  stopPageZoom();
  $('btn-join').addEventListener('click', () => joinGame($('code').value));
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame($('code').value); });
  $('code').addEventListener('input', e => { e.target.value = normaliseCode(e.target.value); });
  $('btn-practice').addEventListener('click', () => { renderPracticeMenu(); openSub('practice'); });
  $('btn-settings').addEventListener('click', () => openSub('settings'));
  $('btn-howto').addEventListener('click', () => openSub('howto'));
  $('btn-nettest').addEventListener('click', openNetTest);
  $('btn-net-check').addEventListener('click', openNetTest);
  $('btn-net-dismiss').addEventListener('click', hideNetError);
  $('nettest-run').addEventListener('click', startNetTest);
  $('nettest-copy').addEventListener('click', () => copyText(everythingText(), 'Copied — paste it into a message.'));
  $('btn-net-copy').addEventListener('click', () => { const last = logEntries()[0]; copyText(last ? entryText(last) : logText(), 'Details copied — paste them into a message.'); });
  $('netlog-clear').addEventListener('click', () => { clearLog(); renderNetLog(); toast('Saved attempts cleared.'); });
  for (const b of document.querySelectorAll('.back')) b.addEventListener('click', () => { netTestRun++; closeSub(); });

  $('btn-share').addEventListener('click', shareInvite);
  $('btn-leave-lobby').addEventListener('click', leaveToMenu);
  for (const b of document.querySelectorAll('.team-join')) b.addEventListener('click', () => sendToServer({ t: 'team', team: b.dataset.team }));
  $('btn-shuffle').addEventListener('click', () => sendToServer({ t: 'shuffle' }));
  for (const b of document.querySelectorAll('.mode-btn[data-mode]')) b.addEventListener('click', () => sendToServer({ t: 'settings', mode: b.dataset.mode }));
  $('lobby-night').addEventListener('change', e => sendToServer({ t: 'settings', night: e.target.checked }));
  $('btn-start').addEventListener('click', () => { initAudio(); tryFullscreen(); sendToServer({ t: 'startMatch' }); });

  $('btn-resume').addEventListener('click', resume);
  $('btn-fullscreen').addEventListener('click', () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (req) req.call(el).catch?.(() => toast('Full screen is not available here.'));
  });
  $('btn-pause-settings').addEventListener('click', () => openSub('settings'));
  $('btn-pause-howto').addEventListener('click', () => openSub('howto'));
  $('btn-leave').addEventListener('click', leaveToMenu);
  $('btn-to-lobby').addEventListener('click', () => sendToServer({ t: app.botGame ? 'restart' : 'toLobby' }));
  $('btn-pause-invite').addEventListener('click', shareInvite);
  $('btn-over-leave').addEventListener('click', leaveToMenu);
  $('btn-cancel-load').addEventListener('click', leaveToMenu);
  $('pause').addEventListener('click', e => { if (e.target === $('pause') && app.game) resume(); });

  bindSettings();
  bindPracticeMenu();
  bindAccount();
  renderAccount();
  acct.initAccounts().then(() => { renderAccount(); onLogin(); });
  applyTouchLayout(settings.touchLayout);
  $('btn-account').addEventListener('click', () => { renderAccount(); openSub('account'); });
  document.addEventListener('pointerdown', () => initAudio(), { once: true });
  window.addEventListener('beforeunload', () => cleanup());
  void playClick;
  show('menu');
}

window.__debug = new URLSearchParams(location.search).has('debug');
window.__app = { deliver: (m) => deliver(m), get game() { return app.game; }, get state() { return app; } };
init();
