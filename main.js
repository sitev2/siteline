// App controller: menus, lobby, hosting/joining, starting and leaving games.
import { Server } from './server.js';
import { HostNet, ClientNet, ServerNet, normaliseCode } from './net.js';
import { STEPS as NET_STEPS, runNetTest, summarise as netVerdict, resultsText as netResultsText } from './nettest.js';
import { logEntries, logText, entryText, clearLog } from './netlog.js';
import { CONFIG } from './config.js';
import { Game } from './game.js';
import { fillIcons, setIconText } from './icons.js';
import { MAPS, mapsFor, isDmMap, isVbMap, dmVariant, resolveMap } from './maps.js';
import { initAudio, setVolume, setAmbienceVolume, playClick } from './audio.js';
import { World } from './world.js';
import { drawMinimap } from './hud.js';
import { RULES } from './config.js';
import { ACTIONS, DEFAULT_KEYS, keyMap, keyLabel } from './keys.js';
import { DEFAULT_CROSSHAIR, crosshairCfg, drawCrosshair, crosshairCode, parseCrosshairCode } from './crosshair.js';
import { applyTouchLayout, openLayoutEditor } from './touchlayout.js';
import { GFX_OPTIONS, PRESETS, resolveGraphics } from './graphics.js';
import * as acct from './accounts.js';
import { initFriends, openFriends, activityChanged } from './friends.js';
import { initAdmin, openAdmin } from './admin.js';
import { WEAPONS } from './weapons.js';
import { MG_GAMES, MG_ORDER } from './mgmap.js';
import { DroneGame, droneSettings, DRONE_DEFAULTS, STICK_MODES } from './drone.js';
import { DRONE_MAPS, existingMaps, droneMapName, droneKind } from './dronemaps.js';
import { FLIGHT_NAMES } from './dronephys.js';

const $ = (id) => document.getElementById(id);
const screens = ['menu', 'lobby', 'settings', 'practice', 'account', 'nettest', 'friends', 'admin'];

// The Backrooms is open to everyone (the owner made it public). Set this to false to show it only to the
// test accounts below again (friends who join their room play along; the lock is only in the page).
const BACKROOMS_OPEN = true;
const BACKROOMS_TESTERS = ['test123'];
// Level 1 of the Backrooms (the garage) is still being built: only its tester account sees it, as a Level choice
// in Practice. Set LEVEL1_OPEN to true to show it to everyone.
const LEVEL1_OPEN = true;
const LEVEL1_TESTERS = ['test123'];
// How far you have got in the Backrooms: 1 = escaped Level 0 (Level 1 unlocked), 2 = escaped Level 1 (the
// Poolrooms unlocked), 3 = escaped the Poolrooms (a tick in the menu). Remembered on this device, and on the account
// when logged in (so it follows the player to other devices; guests only have the device).
const BR_UNLOCK = 'siteline-br-level';
function localBrLevel() {
  try { return Math.max(0, Math.min(3, parseInt(localStorage.getItem(BR_UNLOCK) || '0', 10) || 0)); } catch (e) { return 0; }
}
function brProgress() {
  const p = acct.currentProfile();
  return Math.max(localBrLevel(), p ? (p.br_level | 0) : 0);
}
const isTester = () => { const t = acct.currentProfile(); return !!(t && LEVEL1_TESTERS.includes(String(t.username || '').toLowerCase())); };
// test accounts (LEVEL1_TESTERS) can always play Levels 1 and 2, without escaping the level before first
function level1Unlocked() { return isTester() || brProgress() >= 1; }
function level2Unlocked() { return isTester() || brProgress() >= 2; }
function poolEscaped() { return brProgress() >= 3; }
// a level's name in the Level choosers (the Poolrooms get a small tick once you have got out of them)
function stageName(n, open) {
  if (n === 2) return open ? `Level 2: The Poolrooms${poolEscaped() ? '  ✓ escaped' : ''}` : 'Level 2: locked';
  return n === 1 ? 'Level 1: the garage' : 'Level 0: the yellow rooms';
}
// escaped a level: the next one is unlocked (escaping the Poolrooms earns its tick)
function unlockBrLevel(n) {
  if (localBrLevel() < n) { try { localStorage.setItem(BR_UNLOCK, String(n)); } catch (e) { /* storage blocked */ } }
  acct.unlockBrLevel(n);
}
// logged in: the device and the account tell each other what they know
function syncUnlock() {
  const p = acct.currentProfile();
  if (!p) return;
  const local = localBrLevel(), acc = p.br_level | 0;
  if (acc > local) { try { localStorage.setItem(BR_UNLOCK, String(Math.min(3, acc))); } catch (e) { /* storage blocked */ } }
  else if (local > acc) acct.unlockBrLevel(local);
}
function level1Allowed() {
  if (LEVEL1_OPEN) return true;
  const p = acct.currentProfile();
  return !!(p && LEVEL1_TESTERS.includes(String(p.username || '').toLowerCase()));
}
// FPV drones are still being tested: only these accounts see them (friends who join their room fly along; the lock is
// only in the page, and the host's game tells its room it may: settings.fpvOk). Set DRONES_OPEN to true to open them to all.
const DRONES_OPEN = false;
const DRONE_TESTERS = ['test123'];
function dronesAllowed() {
  if (DRONES_OPEN) return true;
  const p = acct.loggedIn() && acct.currentProfile();
  return !!(p && DRONE_TESTERS.includes(String(p.username || '').toLowerCase()));
}
function backroomsAllowed() {
  if (BACKROOMS_OPEN) return true;
  const p = acct.loggedIn() && acct.currentProfile();
  return !!(p && BACKROOMS_TESTERS.includes(String(p.username || '').toLowerCase()));
}

// ---------- settings ----------
const STORE = 'siteline-settings';
const defaults = {
  name: '', sens: 1, fov: 75, volume: 0.7, ambience: 0.6, camShake: 0.5, headBob: 0.5, mapColor: 0, quality: 'auto', touchMode: 'auto', invert: false, showChat: true,
  keys: {}, crosshair: { ...DEFAULT_CROSSHAIR }, touchLayout: {}, graphics: { preset: 'auto', custom: {} },
  // last practice choices
  practice: { kind: 'range', map: 'outpost', bots: true, count: 6, behavior: 'still', side: 'atk', level: 'normal', dmMap: 'quarry', dmCount: 3, mgCount: 3, mgRun: 'party', mgGame: 'dodge', mgRounds: 3, mgTeams: false, vbMap: 'sandbar', vbSets: 3, vbCount: 3, fpvMap: 'meadow', fpvLaps: 3 },
  drone: { ...DRONE_DEFAULTS },
};
function loadSettings() {
  try {
    const s = { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
    s.practice = { ...defaults.practice, ...(s.practice || {}) };
    return s;
  } catch (e) { return { ...defaults, practice: { ...defaults.practice } }; }
}
// the settings that follow you to other devices when you're logged in
const SYNCED = ['keys', 'crosshair', 'touchLayout', 'graphics', 'sens', 'fov', 'invert', 'volume', 'ambience', 'showChat', 'camShake', 'headBob', 'drone'];
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
  setIconText(el, text);
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
  // while a game is being built (beginGame) everything else waits its turn, so nothing is lost
  if (app.starting && msg.t !== 'ping') { app.starting.push(msg); return; }
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
      beginGame(msg);
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
      app.code = app.serverIdx != null ? `${app.serverIdx + 1}${msg.code}` : msg.code;
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

// ---------- dedicated servers ----------
// CONFIG.servers lists game servers in order of preference (e.g. the home PC first, Render as
// the backup); ?server=wss://… uses only that one. Hosting picks the first server that answers
// from this network; if none does, it falls back to a direct (peer-to-peer) room.
// Server rooms get the server's place in the list in front of their code ("1ABCDE" = first
// server), so whoever types the code reaches the same server. Direct rooms keep 5-letter codes.
// Free cloud hosts (e.g. Render) sleep when nobody plays: the first request wakes them, which
// can take a minute, so a server that doesn't answer is asked again every few seconds.
const WAKE_LIMIT = 90000;   // how long hosting/joining waits for a sleeping server
const serverState = new Map();   // url → { up, checkedAt, waking: Promise | null }

function serverList() {
  if (CONFIG.serverUrl) return [{ name: 'Game server', url: CONFIG.serverUrl }];
  return (CONFIG.servers || []).filter(s => s && s.url);
}
function stateOf(url) {
  if (!serverState.has(url)) serverState.set(url, { up: false, checkedAt: 0, waking: null });
  return serverState.get(url);
}
async function pingServer(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(String(url).replace(/^ws(s?):\/\//i, 'http$1://'), { cache: 'no-store', signal: ctrl.signal });
    return res.ok && (await res.text()).includes('SITELINE server is running');
  } catch (e) {
    return false;
  } finally { clearTimeout(timer); }
}
// Keeps asking one server until it answers or `limit` ms pass. Calls for the same server share one attempt.
function wakeOne(url, limit = WAKE_LIMIT) {
  const st = stateOf(url);
  if (st.up && performance.now() - st.checkedAt < 5 * 60000) return Promise.resolve(true);
  if (st.waking) return st.waking;
  const t0 = performance.now();
  st.waking = (async () => {
    // (a sleeping server usually answers its second or third ask: try again soon, then a little less often)
    for (let wait = 1500; performance.now() - t0 < limit; wait = Math.min(8000, wait * 1.6)) {
      if (await pingServer(url, Math.min(20000, limit))) { st.up = true; st.checkedAt = performance.now(); return true; }
      st.up = false;
      await new Promise(r => setTimeout(r, wait));
    }
    return false;
  })().finally(() => { st.waking = null; refreshWakeRow(); });
  return st.waking;
}
// Index of the server to use: the first in the list that answers at once, otherwise the first
// to wake up within WAKE_LIMIT; -1 if none does. onTick(text) reports progress every second.
async function pickServer(onTick) {
  const list = serverList();
  const quick = await Promise.all(list.map(async s => {
    const st = stateOf(s.url);
    if (st.up && performance.now() - st.checkedAt < 5 * 60000) return true;
    st.up = await pingServer(s.url, 4000);
    if (st.up) st.checkedAt = performance.now();
    return st.up;
  }));
  const i = quick.indexOf(true);
  // (none answered at once: go straight on to "Waking…" — refreshing the row here flashed "offline" first)
  if (i >= 0) { refreshWakeRow(); return i; }
  const t0 = performance.now();
  const tick = () => {
    const text = `Waking the game server… ${Math.round((performance.now() - t0) / 1000)} s (can take up to a minute)`;
    setWake('waking', text);
    if (onTick) onTick(text);
  };
  tick();
  const clock = setInterval(tick, 1000);
  try {
    return await new Promise(resolve => {
      let left = list.length;
      list.forEach((s, k) => wakeOne(s.url).then(ok => {
        if (ok) resolve(k);
        else if (--left === 0) resolve(-1);
      }));
    });
  } finally { clearInterval(clock); refreshWakeRow(); }
}

// ----- the status row on the menu (#server-wake) -----
function setWake(state, text) {
  const box = $('server-wake');
  box.dataset.state = state;
  $('server-wake-text').textContent = text;
  const btn = $('btn-wake');
  btn.disabled = state === 'waking';
  btn.textContent = state === 'waking' ? 'Waking…' : 'Check again';
}
function refreshWakeRow() {
  const list = serverList();
  if (!list.length) return;
  const up = list.findIndex(s => stateOf(s.url).up);
  if (up >= 0) {
    const name = list.length > 1 ? `: ${list[up].name}` : '';
    setWake('awake', `Game server ready${name} ✓${up > 0 ? ' (backup)' : ''}`);
  } else if (list.some(s => stateOf(s.url).waking)) {
    setWake('waking', 'Waking the game server… (can take up to a minute)');
  } else if (CONFIG.serverUrl) {
    setWake('failed', 'The game server is not answering. It may be offline, or this Wi-Fi blocks it.');
  } else {
    setWake('failed', 'Game servers are offline or blocked here. Hosting will use a direct connection, which may not work on school Wi-Fi.');
  }
}
function checkServers() {
  for (const s of serverList()) { const st = stateOf(s.url); st.up = false; st.checkedAt = 0; }
  pickServer().catch(() => {});
}
function initServerWake() {
  if (!serverList().length) return;
  $('server-wake').classList.remove('hidden');
  $('btn-wake').addEventListener('click', checkServers);
  checkServers();   // start waking them as soon as the menu opens
}

// Which server a typed room code belongs to: { server, code } or null for a direct room.
function roomRoute(code) {
  const list = serverList();
  if (/^[1-9][A-Z0-9]{5}$/.test(code) && +code[0] <= list.length) return { server: +code[0] - 1, code: code.slice(1) };
  if (CONFIG.serverUrl) return { server: 0, code };
  return null;
}

async function serverGame(index, action, code) {
  const name = playerName();
  const srv = serverList()[index];
  cleanup();
  app.mode = 'client';
  app.serverIdx = index;
  app.code = code ? `${index + 1}${code}` : null;
  document.body.classList.remove('is-host');
  hideNetError();
  loading(code ? `Joining room ${app.code}…` : 'Creating room…');
  app.clientNet = new ServerNet({
    onMessage: deliver,
    onClose: () => {
      if (app.mode !== 'client') return;
      toast('Lost connection to the game server.', 5000);
      leaveToMenu();
    },
  });
  try {
    await app.clientNet.connect(srv.url, { t: action, code, name });
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
  if (serverList().length) {
    hideNetError();
    loading('Finding a game server…');
    const i = await pickServer(text => loading(text));
    if (i >= 0) return serverGame(i, 'create');
    loading(null);
    if (CONFIG.serverUrl) {
      showNetError('The game server did not answer. It may be offline, or this Wi-Fi blocks it. Try opening the server address in a new tab to check.');
      return;
    }
    toast('The game servers are offline or blocked here, so this room uses a direct connection. Friends on school Wi-Fi may not be able to join.', 9000);
  }
  const name = playerName();
  cleanup();
  app.mode = 'host';
  document.body.classList.add('is-host');
  loading('Creating room…');
  app.server = makeLocalServer(false);
  app.hostNet = new HostNet({
    onJoin: (id, n) => app.server && app.server.addPlayer(id, n),
    capacity: () => (app.server ? app.server.roomMax() : CONFIG.maxPlayers),
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
}

async function joinGame(rawCode) {
  initAudio();
  const code = normaliseCode(rawCode);
  if (code.length < 4) { toast('Enter the room code from the host.'); $('code').focus(); return; }
  tryFullscreen();
  const route = roomRoute(code);
  if (route) {
    const srv = serverList()[route.server];
    hideNetError();
    const t0 = performance.now();
    const tick = () => loading(`Connecting to the game server… ${Math.round((performance.now() - t0) / 1000)} s`);
    tick();
    const clock = setInterval(tick, 1000);
    const ok = await wakeOne(srv.url).finally(() => clearInterval(clock));
    if (!ok) {
      loading(null);
      showNetError(`Room ${code} is on a game server (${srv.name}) that isn't answering. It may be offline, or this Wi-Fi blocks it.`);
      return;
    }
    return serverGame(route.server, 'join', route.code);
  }
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
  activityChanged();
}

// Practice games also open a room (quietly) so friends can join with the code or link.
// If it can't be opened (offline, blocked network) practice still works, just without invites.
async function openInviteRoom() {
  if (CONFIG.serverUrl) return;
  const net = new HostNet({
    onJoin: (id, n) => app.server && app.server.addPlayer(id, n),
    capacity: () => (app.server ? app.server.roomMax() : CONFIG.maxPlayers),
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
    activityChanged();   // friends get a Join button straight away
  } catch (e) {
    if (app.hostNet === net) { app.hostNet = null; net.destroy(); }
  }
}

function updatePauseInvite() {
  const show = app.mode === 'practice' && !!app.code;
  $('pause-invite').classList.toggle('hidden', !show);
  if (show) $('pause-code').textContent = app.code;
}

// the Backrooms buttons show only for its testers (backroomsAllowed); for everyone else the other buttons close up.
// Checked at start-up and whenever someone logs in or out.
function hideBackrooms() {
  const ok = backroomsAllowed(), fpv = dronesAllowed();
  for (const el of document.querySelectorAll('[data-mode="br"], [data-pmode="br"]')) el.classList.toggle('hidden', !ok);
  // FPV drones: the mode buttons and the Drones tab in Settings, for the test account only (for now)
  for (const el of document.querySelectorAll('[data-mode="fpv"], [data-pmode="fpv"], .tab[data-tab="drones"]')) el.classList.toggle('hidden', !fpv);
  // (lay the buttons out in rows that fit how many there are)
  for (const pick of [$('lobby').querySelector('.mode-pick'), $('practice').querySelector('.mode-pick')]) {
    const n = [...pick.children].filter(b => !b.classList.contains('hidden')).length;
    for (const c of ['four', 'five', 'six', 'seven']) pick.classList.toggle(c, c === ['four', 'five', 'six', 'seven'][Math.max(0, Math.min(3, n - 4))]);
  }
  if (!ok && settings.practice.kind === 'br') { settings.practice.kind = 'range'; if (!$('practice').classList.contains('hidden')) renderPracticeMenu(); }
  if (!fpv && settings.practice.kind === 'fpv') { settings.practice.kind = 'range'; if (!$('practice').classList.contains('hidden')) renderPracticeMenu(); }
}

// FPV drones: the maps to pick from, grouped (free flight / circuits / the game's other maps)
function fillDroneMaps(sel) {
  if (sel.options.length) return;
  const groups = [['Free flight', Object.keys(DRONE_MAPS).filter(id => DRONE_MAPS[id].kind === 'free')], ['Circuits (races)', Object.keys(DRONE_MAPS).filter(id => DRONE_MAPS[id].kind === 'race')], ['The game\'s other maps (free flight)', existingMaps().map(e => e.id)]];
  for (const [label, ids] of groups) {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const id of ids) { const o = document.createElement('option'); o.value = id; o.textContent = droneMapName(id); g.appendChild(o); }
    sel.appendChild(g);
  }
}
function droneMapNote(id) { return DRONE_MAPS[id] ? DRONE_MAPS[id].desc : 'One of the game\'s own maps, to fly round freely.'; }

// ---------- practice menu ----------
function practiceMaps(kind, count) {
  return kind === 'dm' ? mapsFor('dm', 1 + count) : kind === 'vb' ? mapsFor('vb') : Object.keys(MAPS).filter(id => !isDmMap(id) && !isVbMap(id));
}

function renderPracticeMenu() {
  const P = settings.practice;
  const el = $('practice');
  el.classList.remove('m-range', 'm-match', 'm-dm', 'm-br', 'm-mg', 'm-vb', 'm-fpv');
  if (P.kind === 'fpv' && !dronesAllowed()) P.kind = 'range';
  el.classList.add(`m-${P.kind}`);
  el.classList.toggle('mg-single', P.mgRun === 'single');
  el.classList.toggle('bots-on', !!P.bots);
  for (const b of document.querySelectorAll('.pmode-btn')) b.classList.toggle('selected', b.dataset.pmode === P.kind);
  const count = P.kind === 'dm' ? P.dmCount : P.kind === 'mg' ? Math.max(1, Math.min(RULES.mg.maxPlayers - 1, P.mgCount || 3)) : P.kind === 'vb' ? Math.max(1, Math.min(RULES.mg.maxPlayers - 1, P.vbCount || 3)) : P.count;
  const slider = $('p-count');
  slider.max = P.kind === 'dm' ? RULES.dm.maxPlayers - 1 : P.kind === 'mg' || P.kind === 'vb' ? RULES.mg.maxPlayers - 1 : 8;
  slider.value = count;
  $('p-count-out').textContent = count;
  const maps = practiceMaps(P.kind, count);
  const cur = P.kind === 'dm' ? P.dmMap : P.kind === 'vb' ? P.vbMap : P.map;
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
  $('p-level-label').textContent = P.kind === 'br' ? 'Difficulty' : 'Bot difficulty';
  // the Minigames: a party run or one game (how many rounds), Dodgeball in teams
  $('p-mgrun').value = P.mgRun === 'single' ? 'single' : 'party';
  $('p-mggame').value = MG_GAMES[P.mgGame] ? P.mgGame : 'dodge';
  $('p-mgrounds').value = String(P.mgRounds || 3);
  $('p-mgteams').checked = !!P.mgTeams;
  $('p-vbsets').value = String(P.vbSets || 3);
  // FPV drones: the map (free flight, a circuit, or another map), laps for a circuit, the way you fly
  fillDroneMaps($('p-fpvmap'));
  $('p-fpvmap').value = P.fpvMap && (DRONE_MAPS[P.fpvMap] || existingMaps().some(e => e.id === P.fpvMap)) ? P.fpvMap : 'meadow';
  $('p-fpvlaps').value = String(P.fpvLaps || 3);
  $('p-fpvlaps').closest('label').classList.toggle('hidden', droneKind($('p-fpvmap').value) !== 'race');
  $('p-fpvnote').textContent = droneMapNote($('p-fpvmap').value);
  $('p-fpvfly').value = droneSettings(settings).fly;
  $('p-night').checked = !!P.night;
  // Levels 1 and 2 (testers only while Level 1 is being tested): each locked until you escaped the one before
  const l1 = P.kind === 'br' && level1Allowed(), open = level1Unlocked(), open2 = level2Unlocked();
  document.querySelector('.p-stageopt').classList.toggle('hidden', !l1);
  if (!l1 || (P.stage === 1 && !open) || (P.stage === 2 && !open2)) P.stage = 0;
  $('p-stage').options[1].disabled = !open;
  $('p-stage').options[1].textContent = open ? 'Level 1: the garage' : 'Level 1: locked';
  $('p-stage').options[2].disabled = !open2;
  $('p-stage').options[2].textContent = stageName(2, open2);
  $('p-stage-note').textContent = !open ? 'Level 1 is locked: escape Level 0 first.' : 'The Poolrooms are locked: escape Level 1 first.';
  $('p-stage-note').classList.toggle('hidden', !l1 || open2);
  $('p-stage').value = String(P.stage || 0);
}

function bindPracticeMenu() {
  const P = () => settings.practice;
  const save = () => { saveSettings(); renderPracticeMenu(); };
  for (const b of document.querySelectorAll('.pmode-btn')) b.addEventListener('click', () => { P().kind = b.dataset.pmode; save(); });
  $('p-map').addEventListener('change', e => { if (P().kind === 'dm') P().dmMap = e.target.value; else if (P().kind === 'vb') P().vbMap = e.target.value; else P().map = e.target.value; save(); });
  $('p-bots').addEventListener('change', e => { P().bots = e.target.checked; save(); });
  $('p-count').addEventListener('input', e => { if (P().kind === 'dm') P().dmCount = Number(e.target.value); else if (P().kind === 'mg') P().mgCount = Number(e.target.value); else if (P().kind === 'vb') P().vbCount = Number(e.target.value); else P().count = Number(e.target.value); save(); });
  $('p-vbsets').addEventListener('change', e => { P().vbSets = Number(e.target.value) || 3; save(); });
  $('p-fpvmap').addEventListener('change', e => { P().fpvMap = e.target.value; save(); });
  $('p-fpvlaps').addEventListener('change', e => { P().fpvLaps = Number(e.target.value) || 3; save(); });
  $('p-fpvfly').addEventListener('change', e => { settings.drone = { ...droneSettings(settings), fly: e.target.value }; save(); });
  $('p-mgrun').addEventListener('change', e => { P().mgRun = e.target.value; save(); });
  $('p-mggame').addEventListener('change', e => { P().mgGame = e.target.value; save(); });
  $('p-mgrounds').addEventListener('change', e => { P().mgRounds = Number(e.target.value) || 3; save(); });
  $('p-mgteams').addEventListener('change', e => { P().mgTeams = e.target.checked; save(); });
  $('p-behavior').addEventListener('change', e => { P().behavior = e.target.value; save(); });
  $('p-side').addEventListener('change', e => { P().side = e.target.value; save(); });
  $('p-level').addEventListener('change', e => { P().level = e.target.value; save(); });
  $('p-night').addEventListener('change', e => { P().night = e.target.checked; save(); });
  $('p-stage').addEventListener('change', e => { P().stage = Number(e.target.value) || 0; save(); });
  $('p-start').addEventListener('click', () => {
    const p = P();
    if (p.kind === 'fpv') {
      if (!dronesAllowed()) return;
      practice({ kind: 'fpv', map: $('p-fpvmap').value || 'meadow', laps: p.fpvLaps || 3 });
      return;
    }
    if (p.kind === 'vb') {
      const maps = practiceMaps('vb');
      practice({ kind: 'vb', map: maps.includes($('p-map').value) ? $('p-map').value : maps[0], sets: p.vbSets || 3, count: Math.max(1, Math.min(RULES.mg.maxPlayers - 1, p.vbCount || 3)), level: p.level });
      return;
    }
    if (p.kind === 'mg') {
      practice({ kind: 'mg', run: p.mgRun === 'single' ? 'single' : 'party', game: p.mgGame, rounds: p.mgRounds || 3, teams: !!p.mgTeams, count: Math.max(1, Math.min(RULES.mg.maxPlayers - 1, p.mgCount || 3)), level: p.level });
      return;
    }
    const maps = practiceMaps(p.kind, p.kind === 'dm' ? p.dmCount : p.count);
    const map = $('p-map').value || maps[0];
    const side = p.side === 'random' ? (Math.random() < 0.5 ? 'atk' : 'def') : p.side;
    practice({
      kind: p.kind, map, level: p.level, behavior: p.behavior, side, night: !!p.night,
      stage: p.kind === 'br' && level1Allowed() && ((p.stage === 1 && level1Unlocked()) || (p.stage === 2 && level2Unlocked())) ? p.stage : 0,
      l1: level1Allowed(),          // (escaping Level 0 then carries straight on into Level 1, and Level 1 into the Poolrooms)
      l2: level1Allowed() && level2Unlocked(),
      count: p.kind === 'dm' ? p.dmCount : (p.bots ? p.count : 0),
    });
  });
}

function cleanup() {
  app.starting = null;
  gameLoading(null);
  endGame();
  if (app.server) { app.server.destroy(); app.server = null; }
  if (app.hostNet) { app.hostNet.destroy(); app.hostNet = null; }
  if (app.clientNet) { app.clientNet.destroy(); app.clientNet = null; }
  app.mode = null; app.myId = null; app.roster = []; app.code = null; app.botGame = null; app.serverIdx = null;
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
  activityChanged();
}

// ---------- lobby ----------
function showLobby() {
  show('lobby');
  renderLobby();
  activityChanged();
}

// what friends see next to your name (friends.js)
function activityText() {
  if (app.game && app.game.fpvMode) return 'Flying FPV drones';
  if (app.mode === 'practice') return app.botGame === 'range' ? 'At the practice range' : app.botGame === 'br' ? 'In the Backrooms' : app.botGame === 'mg' ? 'Playing minigames' : app.botGame === 'vb' ? 'Playing volleyball' : 'Playing against bots';
  if (app.game) return app.lobby.mode === 'dm' ? 'In a deathmatch' : app.lobby.mode === 'br' ? 'In the Backrooms' : app.lobby.mode === 'mg' ? 'Playing minigames' : app.lobby.mode === 'vb' ? 'Playing volleyball' : 'In a 2v2 match';
  if (app.mode === 'host' || app.mode === 'client') return 'In a lobby';
  return 'In the menu';
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
      sz.textContent = n >= 2 && n !== 3 && n <= RULES.dm.maxPlayers ? `${v === 'large' ? 'Large' : 'Small'} version for ${n} players (${w} × ${d} m)` : `Small for 2 players, large for 4 to ${RULES.dm.maxPlayers}`;
    }
  }
}

function humans() { return app.roster.filter(p => !p.dummy); }

// the lobby's drone maps: the six drone maps as cards, then the game's other maps as a list
function renderDroneLobby(on) {
  const wrap = $('fpv-maps');
  if (!on) return;
  if (!wrap.children.length) {
    for (const id of Object.keys(DRONE_MAPS)) {
      const d = DRONE_MAPS[id];
      const b = document.createElement('button');
      b.className = 'map-card fpv-card';
      b.dataset.fpvmap = id;
      b.innerHTML = '<div><b></b><small class="map-size"></small><span></span></div>';
      b.querySelector('b').textContent = d.name;
      b.querySelector('small').textContent = d.kind === 'race' ? 'Circuit' : 'Free flight';
      b.querySelector('span').textContent = d.desc;
      b.addEventListener('click', () => sendToServer({ t: 'settings', fpvMap: id }));
      wrap.appendChild(b);
    }
    fillDroneMaps($('lobby-fpvother'));
    // (the other list only offers the game's other maps)
    for (const g of [...$('lobby-fpvother').querySelectorAll('optgroup')].slice(0, 2)) g.remove();
    const none = document.createElement('option'); none.value = ''; none.textContent = 'Or fly round one of the game\'s other maps…';
    $('lobby-fpvother').prepend(none);
  }
  const cur = app.lobby.fpvMap || 'meadow';
  for (const b of wrap.children) { b.classList.toggle('selected', b.dataset.fpvmap === cur); b.disabled = !isLeader(); }
  $('lobby-fpvother').value = DRONE_MAPS[cur] ? '' : cur;
  $('lobby-fpvother').disabled = !isLeader();
  $('lobby-fpvlaps').value = String(app.lobby.fpvLaps || 3);
  $('lobby-fpvlaps').disabled = !isLeader();
  $('lobby-fpvlaps').closest('label').classList.toggle('hidden', droneKind(cur) !== 'race');
}

function renderLobby() {
  if ($('lobby').classList.contains('hidden')) return;
  document.body.classList.toggle('is-host', isLeader());
  $('room-code').textContent = app.code || '-----';
  const dm = app.lobby.mode === 'dm', br = app.lobby.mode === 'br', mg = app.lobby.mode === 'mg', vb = app.lobby.mode === 'vb', fpv = app.lobby.mode === 'fpv';
  // FPV drones: the host's game tells the room whether this host may fly them (test account only, for now)
  if (isLeader() && !!app.lobby.fpvOk !== dronesAllowed()) sendToServer({ t: 'settings', fpvOk: dronesAllowed() });
  $('lobby').classList.toggle('fpv', fpv);
  renderDroneLobby(fpv);
  $('lobby').classList.toggle('dm', dm);
  $('lobby').classList.toggle('br', br);
  $('lobby').classList.toggle('mg', mg);
  $('lobby').classList.toggle('vb', vb);
  $('lobby-vbsets').value = String(app.lobby.vbSets || 3);
  $('lobby-vbsets').disabled = !isLeader();
  $('lobby').classList.toggle('mg-single', app.lobby.mgRun === 'single');
  // the Minigames' options (only the host can change them)
  $('lobby-mgrun').value = app.lobby.mgRun === 'single' ? 'single' : 'party';
  $('lobby-mggame').value = MG_GAMES[app.lobby.mgGame] ? app.lobby.mgGame : 'dodge';
  $('lobby-mgrounds').value = String(app.lobby.mgRounds || 3);
  $('lobby-mgteams').checked = !!app.lobby.mgTeams;
  for (const id of ['lobby-mgrun', 'lobby-mggame', 'lobby-mgrounds', 'lobby-mgteams']) $(id).disabled = !isLeader();
  $('lobby-night').checked = !!app.lobby.night;
  $('lobby-night').disabled = !isLeader();
  $('lobby-level').value = app.lobby.level || 'normal';
  $('lobby-level').disabled = !isLeader();
  // the Backrooms level: the host tells the room whether Level 1 may be played at all (testers only for now),
  // and can only choose it once they have escaped Level 0 themselves
  // (and the Poolrooms only once the host has escaped Level 1: the host's game says so, the host checks it)
  const l1 = !!app.lobby.l1, st = $('lobby-stage'), l2 = level1Allowed() && level2Unlocked();
  if (isLeader() && br && (l1 !== level1Allowed() || !!app.lobby.l2 !== l2)) sendToServer({ t: 'settings', l1: level1Allowed(), l2 });
  document.querySelector('.br-stage').classList.toggle('hidden', !l1);
  const mayPick = isLeader() && level1Unlocked();
  st.options[1].disabled = !mayPick && app.lobby.stage !== 1;
  st.options[1].textContent = isLeader() && !level1Unlocked() ? 'Level 1: locked (escape Level 0 first)' : 'Level 1: the garage';
  st.options[2].disabled = !(isLeader() && l2) && app.lobby.stage !== 2;
  st.options[2].textContent = isLeader() && !l2 ? 'Level 2: locked (escape Level 1 first)' : stageName(2, true);
  st.value = String(app.lobby.stage || 0);
  st.disabled = !isLeader();
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
  const M = RULES.mg, single = app.lobby.mgRun === 'single', gname = (MG_GAMES[app.lobby.mgGame] || MG_GAMES.dodge).name;
  const sets = app.lobby.vbSets || 3;
  const fk = droneKind(app.lobby.fpvMap || 'meadow');
  $('match-rules').innerHTML = fpv
    ? `<b>FPV drones</b> · 1–${RULES.fpv.maxPlayers} pilots · ${droneMapName(app.lobby.fpvMap || 'meadow')}: ${fk === 'race' ? `a race of ${app.lobby.fpvLaps || 3} lap${(app.lobby.fpvLaps || 3) > 1 ? 's' : ''} through the gates` : 'free flight'} · each pilot picks Casual, Angle or Acro in Settings → Drones`
    : vb
    ? `<b>Volleyball</b> · ${M.minPlayers}–${M.maxPlayers} players in two teams · ${sets > 1 ? `best of ${sets} sets` : 'one set'} to 11 · 3 touches a side · the same court and net on every map`
    : mg
    ? `<b>Minigames</b> · ${M.minPlayers}–${M.maxPlayers} players · ${single ? `${app.lobby.mgRounds || 3} round${(app.lobby.mgRounds || 3) > 1 ? 's' : ''} of ${gname}` : 'a party run of 5 random games'} · 1st 3 points, 2nd 2, 3rd 1 · no guns`
    : br
    ? (app.lobby.stage === 2 && app.lobby.l2 ? '<b>The Backrooms, Level 2: The Poolrooms</b> · 2–6 players together · bright tiled halls and still water · nothing lives here'
      : app.lobby.stage === 1 && app.lobby.l1 ? '<b>The Backrooms, Level 1</b> · 2–6 players together · the garage · find the fuses, wind the shutter up, take the lift'
      : '<b>The Backrooms</b> · 2–6 players together · a new random maze every game · no guns · find the exit before it finds you')
    : dm ? `<b>Deathmatch</b> · everyone for themselves · first to <b>${D.killLimit}</b> kills or <b>${D.timeLimit / 60}</b> minutes · ${n === 3 ? 'played on a 2v2 map with 3 players' : 'small map for 2, large for 4 to ${D.maxPlayers}'}`
    : '<b>2v2</b> · first to <b>9</b> · sides swap after round <b>8</b> · 8–8 is a draw';
  let note, ready;
  if (fpv) {
    const F = RULES.fpv;
    ready = n >= F.minPlayers && n <= F.maxPlayers && !!app.lobby.fpvOk;
    note = !isLeader() ? 'Waiting for the host to start…'
      : n > F.maxPlayers ? `FPV drones take ${F.maxPlayers} pilots at most.` : `${n} pilot${n > 1 ? 's' : ''} ready. Friends can join after it has started too.`;
  } else if (vb) {
    ready = n >= M.minPlayers && n <= M.maxPlayers;
    note = !isLeader() ? (n < M.minPlayers ? `Volleyball needs ${M.minPlayers} to ${M.maxPlayers} players. Waiting for one more…` : 'Waiting for the host to start…')
      : n < M.minPlayers ? `Volleyball needs ${M.minPlayers} to ${M.maxPlayers} players online. Share the room code or invite link (to play with bots, use Practice).`
        : n > M.maxPlayers ? `Volleyball takes ${M.maxPlayers} players at most.` : `${n} players ready: the teams are made when the match starts${n % 2 ? ' (the smaller team gets a 4th touch)' : ''}.`;
  } else if (mg) {
    ready = n >= M.minPlayers && n <= M.maxPlayers;
    note = !isLeader() ? (n < M.minPlayers ? `The Minigames need ${M.minPlayers} to ${M.maxPlayers} players. Waiting for one more…` : 'Waiting for the host to start…')
      : n < M.minPlayers ? `The Minigames need ${M.minPlayers} to ${M.maxPlayers} players online. Share the room code or invite link (to play alone with bots, use Practice).`
        : n > M.maxPlayers ? `The Minigames take ${M.maxPlayers} players at most.` : `${n} players ready. Friends who join later play from the next round.`;
  } else if (br) {
    // online it takes at least two (alone, play it from Practice)
    const B = RULES.br;
    ready = n >= B.minPlayers && n <= B.maxPlayers;
    note = !isLeader() ? (n < 2 ? `The Backrooms needs 2 to ${B.maxPlayers} players. Waiting for one more…` : 'Waiting for the host to start…')
      : n < 2 ? `The Backrooms needs 2 to ${B.maxPlayers} players online. Share the room code or invite link (to play alone, use Practice).`
        : `${n} players ready. Friends can also join after it has started.`;
  } else if (dm) {
    ready = n >= D.minPlayers && n <= D.maxPlayers;
    note = !isLeader() ? 'Waiting for the host to start the match…'
      : n < D.minPlayers ? `Deathmatch needs ${D.minPlayers} to ${D.maxPlayers} players. Share the room code or invite link.`
        : `${n} players ready. Start when everyone's in.`;
  } else {
    ready = counts.atk > 0 && counts.def > 0 && n <= CONFIG.maxPlayers;
    if (isLeader()) {
      note = n < 2 ? 'Share the room code or invite link with a friend or three. You need at least one player on each team.'
        : n > CONFIG.maxPlayers ? `2v2 takes ${CONFIG.maxPlayers} players at most (${n} are here). Pick deathmatch or the Backrooms, or ask someone to leave.`
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
// The loading screen: building a map (and baking the Backrooms' lighting) can take a moment, so the
// screen says what is loading and the bar moves on as each step is done.
const MODE_NAMES = { wingman: '2v2 Bomb', dm: 'Deathmatch', br: 'Co-op escape', mg: 'Minigames', vb: 'Volleyball', fpv: 'FPV drones' };
const nextPaint = () => new Promise(r => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(r, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 300);          // (a hidden tab draws nothing: don't wait for it)
});
function gameLoading(step, frac, msg = null) {
  const el = $('game-loading');
  if (step == null) {
    if (el.classList.contains('hidden')) return;
    el.classList.add('fade');
    setTimeout(() => { if (el.classList.contains('fade')) el.classList.add('hidden'); }, 380);
    return;
  }
  if (msg) {
    const def = msg.mode === 'fpv' ? { name: droneMapName(msg.map) } : msg.map === 'backrooms' ? { name: 'The Backrooms' } : msg.map === 'garage' ? { name: 'Level 1: The Garage' } : msg.map === 'pool' ? { name: 'The Poolrooms' } : msg.map === 'arena' ? { name: 'The Pool Hall' } : MAPS[msg.map];
    const lv = msg.mode === 'br' && typeof msg.variant === 'string' ? msg.variant.split(':').pop() : '';
    $('gl-title').textContent = def ? def.name : 'Loading';
    $('gl-sub').textContent = [msg.practice ? 'Practice' : '', MODE_NAMES[msg.mode === 'fpv' ? 'fpv' : isVbMap(msg.map) ? 'vb' : msg.mode] || '', msg.mode === 'fpv' ? (droneKind(msg.map) === 'race' ? 'Race' : 'Free flight') : '', lv ? lv[0].toUpperCase() + lv.slice(1) : ''].filter(Boolean).join(' · ');
    el.dataset.mode = msg.mode || '';
    el.dataset.map = msg.map || '';
    $('gl-fill').style.transition = 'none'; $('gl-fill').style.width = '0';
    void el.offsetWidth;
    $('gl-fill').style.transition = '';
  }
  el.classList.remove('hidden', 'fade');
  $('gl-step').textContent = step;
  $('gl-fill').style.width = `${Math.round(frac * 100)}%`;
}
async function beginGame(msg) {
  const queue = app.starting = [];
  gameLoading(msg.map === 'pool' || msg.map === 'arena' ? 'Filling the pools…' : msg.map === 'garage' ? 'Pouring the concrete…' : msg.mode === 'br' ? 'Building the maze…' : 'Building the map…', 0.15, msg);
  await nextPaint(); await nextPaint();
  if (app.starting !== queue) return;            // left before it was ready
  try {
    gameLoading(msg.map === 'pool' || msg.map === 'arena' ? 'Letting the light in…' : msg.mode === 'br' ? 'Wiring the lights…' : 'Lighting the map…', 0.45);
    startGame(msg);
  } catch (e) {
    app.starting = null;
    gameLoading(null);
    throw e;
  }
  app.starting = null;
  gameLoading('Getting ready…', 0.85);
  for (const m of queue) deliver(m);             // what arrived meanwhile (your spawn, other players…)
  await nextPaint(); await nextPaint();          // the first pictures are drawn (graphics warmed up)
  if (!app.game) { gameLoading(null); return; }
  gameLoading('Ready', 1);
  setTimeout(() => { gameLoading(null); if (app.game && app.game.onLoaded) app.game.onLoaded(); }, 250);
}

function startGame(msg) {
  endGame();
  hideScreens();
  $('over').classList.add('hidden');
  settings.touch = resolvedTouch();
  document.body.classList.add('in-game');
  if (msg.mode === 'fpv') {
    // FPV drones: their own game (drone.js)
    app.game = new DroneGame({ transport: { send: sendToServer }, myId: app.myId, roster: msg.roster, map: msg.map, practice: !!msg.practice, settings, quality: resolvedQuality(), isHost: app.mode !== 'client', onPause: showPause, fpv: msg.fpv });
    if (window.__debug) window.__game = app.game;
    if (!settings.touch) showPause(true);
    activityChanged();
    return;
  }
  app.game = new Game({
    transport: { send: sendToServer },
    myId: app.myId,
    roster: msg.roster,
    map: msg.map,
    practice: !!msg.practice,
    mode: msg.mode,
    variant: msg.variant,
    doors: msg.doors,
    notes: msg.notes,
    key: msg.key,
    crossed: msg.crossed,
    gar: msg.gar,
    pool: msg.pool,
    mg: msg.mg,
    onEscape: (stage) => unlockBrLevel(stage + 1),      // (escaped Level n: Level n + 1 is unlocked; the Poolrooms: their tick)
    night: !!(msg.settings && msg.settings.night),
    settings,
    quality: resolvedQuality(),
    isHost: app.mode !== 'client',
    onPause: showPause,
  });
  if (window.__debug) window.__game = app.game;
  if (!settings.touch) showPause(true);
  activityChanged();
}

function endGame() {
  if (app.game) { app.game.destroy(); app.game = null; saveSettings(); }
  document.body.classList.remove('in-game');
  $('pause').classList.add('hidden');
}

function showPause(first = false) {
  if (!app.game) return;
  app.game.paused = true;
  const titles = { range: 'Practice range', match: 'Bot match', dm: 'Bot deathmatch', mg: 'Minigames', vb: 'Volleyball', fpv: 'FPV drones' };
  const fpv = !!app.game.fpvMode;
  // FPV drones: the leader can end free flight online; the flight mode can be changed right here
  $('btn-fpv-end').classList.toggle('hidden', !(fpv && !app.game.race && isLeader() && app.mode !== 'practice'));
  $('pause-fpv').classList.toggle('hidden', !fpv);
  if (fpv) $('pause-fly').value = droneSettings(settings).fly;
  $('pause-title').textContent = first === true ? (titles[app.botGame] || 'Ready?') : 'Paused';
  $('pause-sub').textContent = fpv ? (first === true ? 'Click Play, then fly. Change the controls in Settings → Drones. Press Esc any time for this menu.' : 'Your drone keeps hovering while you\'re in this menu.')
    : first === true
    ? 'Click Play, then use your mouse to aim. Press Esc any time for this menu.'
    : (app.botGame === 'range' ? 'Bots respawn after 3 seconds. Bots marked (armour) wear a vest and helmet. Everything in the buy menu is free.'
      : 'The match keeps running while you\'re in this menu.');
  updatePauseInvite();
  $('btn-resume').textContent = first === true ? 'Play' : 'Resume';
  $('btn-fullscreen').classList.toggle('hidden', !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen));
  $('pause').classList.remove('hidden');
  app.pauseAt = performance.now();
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
  if (msg.mode === 'br') return showBrOver(msg);
  if (msg.mode === 'mg') return showMgOver(msg);
  if (msg.mode === 'fpv') return showFpvOver(msg);
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

function showBrOver(msg) {
  const me = msg.stats.find(s => s.id === app.myId);
  const clock = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
  // out of the Poolrooms (the last level): "Run complete", with each level's time and the whole run's
  const done = msg.map === 'pool' && msg.winner === 'escaped' && Array.isArray(msg.run) && msg.run.length;
  $('over-title').textContent = done ? 'Run complete' : msg.reason === 'all' ? (msg.stats.length > 1 ? 'Everyone escaped!' : 'You escaped!')
    : msg.reason === 'some' ? (me && me.escaped ? 'You escaped!' : 'Some of you escaped') : 'Nobody made it out';
  $('over-title').style.color = msg.winner === 'escaped' ? '#9dffb5' : '#ff6b4a';
  // (the whole run: its clock when the last one got out — the same clock as everyone's own time below)
  const total = done ? (msg.runTotal ?? msg.run.reduce((a, r) => a + (r.time | 0), 0)) : msg.time;
  $('over-score').innerHTML = `<span>${clock(total)}</span>`;
  const parts = [];
  if (done) {
    const NAMES = ['Level 0: the yellow rooms', 'Level 1: the garage', 'Level 2: The Poolrooms'];
    const levels = document.createElement('table');
    levels.className = 'run-levels';
    levels.innerHTML = '<tr><th>Level</th><th>Time</th></tr>';
    for (const r of msg.run) { const tr = document.createElement('tr'); for (const v of [NAMES[r.level] || `Level ${r.level}`, clock(r.time)]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); } levels.appendChild(tr); }
    const tr = document.createElement('tr'); tr.className = 'run-total';
    for (const v of ['The whole run', clock(total)]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    levels.appendChild(tr);
    parts.push(levels);
  }
  const table = document.createElement('table');
  table.innerHTML = '<tr><th>Player</th><th>What happened</th></tr>';
  for (const s of msg.stats.slice().sort((a, b) => (b.escaped - a.escaped) || ((a.time || 0) - (b.time || 0)))) {
    const tr = document.createElement('tr');
    const how = s.escaped ? `${msg.map === 'garage' ? 'Took the lift' : msg.map === 'pool' ? 'Climbed out' : 'Escaped'} (${clock(s.time)})` : s.how === 'fell' ? 'Fell into a pit' : s.how === 'poolfall' ? 'Fell too far' : s.how === 'late' ? 'Joined to watch' : s.how === 'monster' ? 'Caught by it'
      : s.how === 'ceiling' ? 'Taken by the ceiling' : s.how === 'corner' ? 'Vanished' : 'Left the game';
    for (const v of [s.name, how]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    tr.lastChild.style.color = s.escaped ? '#9dffb5' : '#ff8a6a';
    table.appendChild(tr);
  }
  parts.push(table);
  $('over-stats').replaceChildren(...parts);
  finishOver();
}

// the Minigames: the final standings (everyone's points, a shared place shares its number)
function showMgOver(msg) {
  if (msg.vb) return showVbOver(msg);
  const list = msg.standings || [], top = list[0];
  const win = msg.winner && list.find(e => e.id === msg.winner);
  $('over-title').textContent = win ? (win.id === app.myId ? 'You win the Minigames!' : `${win.name} wins the Minigames`) : list.length > 1 && top ? `A shared win on ${top.pts} points` : 'Minigames over';
  $('over-title').style.color = win && win.id === app.myId ? 'var(--accent)' : 'var(--text)';
  $('over-score').innerHTML = top ? `<span>${top.pts} point${top.pts === 1 ? '' : 's'}</span>` : '';
  const table = document.createElement('table');
  table.innerHTML = '<tr><th></th><th>Player</th><th>Points</th></tr>';
  let place = 0, last = null;
  list.forEach((e, k) => {
    if (e.pts !== last) { place = k + 1; last = e.pts; }
    const tr = document.createElement('tr');
    for (const v of [place, e.name, e.pts]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    if (e.id === app.myId) tr.style.color = 'var(--accent)';
    table.appendChild(tr);
  });
  $('over-stats').replaceChildren(table);
  finishOver();
}

// the Volleyball mode: the team that won, each set's score, the two teams
function showVbOver(msg) {
  const V = msg.vb, me = app.roster.find(p => p.id === app.myId), team = msg.winner, mine = me && me.team === team;
  const NAME = { atk: 'Orange', def: 'Blue' }, CSS = { atk: '#f0a040', def: '#5aa0ff' };
  $('over-title').textContent = team ? (mine ? `You win! ${NAME[team]} take the match` : `${NAME[team]} win the match`) : 'A draw';
  $('over-title').style.color = team ? CSS[team] : 'var(--text)';
  $('over-score').innerHTML = `<span style="color:${CSS.atk}">${V.won[0]}</span><span style="opacity:.5">–</span><span style="color:${CSS.def}">${V.won[1]}</span>`;
  const sets = document.createElement('table');
  sets.innerHTML = `<tr><th>Set</th><th style="color:${CSS.atk}">Orange</th><th style="color:${CSS.def}">Blue</th></tr>`;
  V.sets.forEach(([a, d], k) => { const tr = document.createElement('tr'); for (const v of [k + 1, a, d]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); } sets.appendChild(tr); });
  const teams = document.createElement('table');
  teams.className = 'run-levels';
  teams.innerHTML = '<tr><th>Team</th><th>Players</th></tr>';
  for (const [k, t] of [[0, 'atk'], [1, 'def']]) { const tr = document.createElement('tr'); const a = document.createElement('td'); a.textContent = NAME[t]; a.style.color = CSS[t]; const b = document.createElement('td'); b.textContent = (V.teams[k] || []).join(', '); tr.append(a, b); teams.appendChild(tr); }
  $('over-stats').replaceChildren(sets, teams);
  finishOver();
}

// FPV drones: the race's places, times and best laps (or, when the leader ended free flight, just that)
function showFpvOver(msg) {
  const fmt = (s) => { if (!(s >= 0)) return '—'; const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`; };
  const res = msg.results || [];
  const win = res.find(r => r.pos === 1 && r.time != null);
  $('over-title').textContent = !msg.race ? 'Free flight over' : !win ? 'Race over' : win.id === app.myId ? (res.length > 1 ? 'You win the race!' : 'Finished!') : `${win.name} wins the race`;
  $('over-title').style.color = win && win.id === app.myId ? 'var(--accent)' : 'var(--text)';
  $('over-score').innerHTML = win ? `<span>${fmt(win.time)}</span>` : '';
  if (!msg.race) { $('over-stats').replaceChildren(); finishOver(); return; }
  const table = document.createElement('table');
  table.innerHTML = '<tr><th>#</th><th>Pilot</th><th>Time</th><th>Best lap</th><th>Laps</th></tr>';
  for (const r of res) {
    const tr = document.createElement('tr');
    const laps = r.laps && r.laps.length ? r.laps.map(fmt).join('  ') : '—';
    for (const v of [r.pos || '–', r.name + (r.left ? ' (left)' : r.late ? ' (joined late)' : ''), r.time != null ? fmt(r.time) : 'did not finish', fmt(r.best), laps]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    if (r.id === app.myId) tr.style.color = 'var(--accent)';
    table.appendChild(tr);
  }
  $('over-stats').replaceChildren(table);
  finishOver();
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
  // ---- FPV drones ----
  for (const sel of document.querySelectorAll('select.dr-axis')) for (const [v, t] of [['thr', 'Throttle (up / down)'], ['yaw', 'Turn (yaw)'], ['pitch', 'Tilt forward / back (pitch)'], ['roll', 'Roll left / right'], ['none', 'Nothing']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
  const syncDrones = app.syncDrones = () => {
    const d = droneSettings(settings);
    $('dr-fly').value = d.fly; $('dr-cam').value = d.cam;
    $('dr-tilt').value = d.tilt; $('dr-tilt-out').textContent = `${d.tilt}°`;
    $('dr-fov').value = d.fov; $('dr-fov-out').textContent = `${d.fov}°`;
    $('dr-sticks').value = d.sticks; $('dr-spring').checked = !!d.spring; $('dr-pad').value = d.pad;
    $('dr-size').value = d.size; $('dr-size-out').textContent = `${Math.round(d.size * 100)}%`;
    $('dr-thrmid').value = d.thrMid; $('dr-thrmid-out').textContent = Number(d.thrMid).toFixed(2);
    $('dr-threxpo').value = d.thrExpo; $('dr-threxpo-out').textContent = Number(d.thrExpo).toFixed(2);
    $('dr-rate').value = d.rate; $('dr-rate-out').textContent = `${d.rate}°/s`;
    $('dr-expo').value = d.expo; $('dr-expo-out').textContent = Number(d.expo).toFixed(2);
    const ax = d.sticks === 'custom' ? d.axes : STICK_MODES[d.sticks] || STICK_MODES.mode2;
    for (const k of ['ly', 'lx', 'ry', 'rx']) { $(`dr-${k}`).value = ax[k]; $(`dr-${k}`).disabled = d.sticks !== 'custom'; $(`dr-inv-${k}`).checked = !!d.inv[k]; }
    drawStickPreview(d);
  };
  const setDrone = (patch) => { settings.drone = { ...droneSettings(settings), ...patch }; saveSettings(); syncDrones(); };
  $('dr-fly').addEventListener('change', e => setDrone({ fly: e.target.value }));
  $('dr-cam').addEventListener('change', e => setDrone({ cam: e.target.value }));
  $('dr-tilt').addEventListener('input', e => setDrone({ tilt: Number(e.target.value) }));
  $('dr-fov').addEventListener('input', e => setDrone({ fov: Number(e.target.value) }));
  $('dr-size').addEventListener('input', e => setDrone({ size: Number(e.target.value) }));
  $('dr-thrmid').addEventListener('input', e => setDrone({ thrMid: Number(e.target.value) }));
  $('dr-threxpo').addEventListener('input', e => setDrone({ thrExpo: Number(e.target.value) }));
  $('dr-rate').addEventListener('input', e => setDrone({ rate: Number(e.target.value) }));
  $('dr-expo').addEventListener('input', e => setDrone({ expo: Number(e.target.value) }));
  $('dr-spring').addEventListener('change', e => setDrone({ spring: e.target.checked }));
  $('dr-pad').addEventListener('change', e => setDrone({ pad: e.target.value }));
  $('dr-sticks').addEventListener('change', e => {
    const d = droneSettings(settings), v = e.target.value;
    // switching to Custom starts from the layout you had
    setDrone(v === 'custom' ? { sticks: v, axes: { ...(d.sticks === 'custom' ? d.axes : STICK_MODES[d.sticks] || STICK_MODES.mode2) } } : { sticks: v });
  });
  for (const k of ['ly', 'lx', 'ry', 'rx']) {
    $(`dr-${k}`).addEventListener('change', e => {
      const d = droneSettings(settings), axes = { ...d.axes }, v = e.target.value, was = axes[k];
      // each job on one axis only: whatever had this job takes the one this axis had
      if (v !== 'none') for (const o of ['ly', 'lx', 'ry', 'rx']) if (o !== k && axes[o] === v) axes[o] = was;
      axes[k] = v;
      setDrone({ axes });
    });
    $(`dr-inv-${k}`).addEventListener('change', e => setDrone({ inv: { ...droneSettings(settings).inv, [k]: e.target.checked } }));
  }
  $('btn-dr-reset').addEventListener('click', () => { settings.drone = { ...DRONE_DEFAULTS }; saveSettings(); syncDrones(); });
  $('pause-fly').addEventListener('change', e => { setDrone({ fly: e.target.value }); if (app.game && app.game.setFly) app.game.setFly(e.target.value); });
  syncDrones();
  // ---- general ----
  const sync = () => {
    $('set-sens').value = settings.sens; $('sens-out').textContent = Number(settings.sens).toFixed(2);
    $('set-fov').value = settings.fov; $('fov-out').textContent = `${settings.fov}°`;
    $('set-vol').value = settings.volume; $('vol-out').textContent = `${Math.round(settings.volume * 100)}%`;
    const amb = settings.ambience == null ? 0.6 : settings.ambience;
    $('set-amb').value = amb; $('amb-out').textContent = amb > 0 ? `${Math.round(amb * 100)}%` : 'off';
    const shk = settings.camShake == null ? 0.5 : settings.camShake;
    $('set-shake').value = shk; $('shake-out').textContent = shk > 0 ? `${Math.round(shk * 100)}%` : 'off';
    const bob = settings.headBob == null ? 0.5 : settings.headBob;
    $('set-bob').value = bob; $('bob-out').textContent = bob > 0 ? `${Math.round(bob * 100)}%` : 'off';
    $('set-touch').value = settings.touchMode;
    $('set-mapcol').value = String(settings.mapColor | 0);
    $('set-invert').checked = settings.invert;
    $('set-chat').checked = settings.showChat !== false;
    document.body.classList.toggle('no-chat', settings.showChat === false);
  };
  app.syncGeneral = sync;
  sync();
  $('set-sens').addEventListener('input', e => { settings.sens = Number(e.target.value); sync(); saveSettings(); });
  $('set-fov').addEventListener('input', e => { settings.fov = Number(e.target.value); sync(); saveSettings(); });
  $('set-vol').addEventListener('input', e => { settings.volume = Number(e.target.value); setVolume(settings.volume); sync(); saveSettings(); });
  $('set-shake').addEventListener('input', e => { settings.camShake = Number(e.target.value); sync(); saveSettings(); });
  ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'White'].forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; $('set-mapcol').appendChild(o); });
  $('set-mapcol').addEventListener('change', e => { settings.mapColor = Number(e.target.value); saveSettings(); });
  $('set-bob').addEventListener('input', e => { settings.headBob = Number(e.target.value); sync(); saveSettings(); });
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
  // changed during a game: the game takes it straight away (no need to leave and start again)
  const liveGfx = app.liveGfx = () => { if (app.game && app.game.applyGraphics) { try { app.game.applyGraphics(resolvedQuality()); } catch (err) { console.warn('graphics change', err); } } };
  $('set-preset').addEventListener('change', e => {
    const g = settings.graphics;
    // switching to Custom starts from whatever was showing
    if (e.target.value === 'custom' && g.preset !== 'custom') { const { preset, ...cur } = resolveGraphics(g, isTouchDevice()); g.custom = cur; void preset; }
    g.preset = e.target.value;
    renderGfx(); saveSettings(); liveGfx();
  });
  $('gfx-custom').addEventListener('change', e => {
    const key = e.target.dataset.gfx;
    if (!key) return;
    const opt = GFX_OPTIONS.find(o => o[0] === key);
    const raw = e.target.value;
    const val = opt[2].map(c => c[0]).find(v => String(v) === raw);
    settings.graphics.custom = { ...settings.graphics.custom, [key]: val };
    saveSettings(); liveGfx();
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
    for (const el of document.querySelectorAll('#account .acct-signup')) el.classList.toggle('hidden', m !== 'signup');
    $('btn-acct-forgot').classList.toggle('hidden', m !== 'login');
    $('btn-acct-go').textContent = m === 'signup' ? 'Create account' : 'Log in';
    $('acct-pass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    $('acct-msg').textContent = '';
  };
  for (const t of document.querySelectorAll('#account .tab')) t.addEventListener('click', () => setMode(t.dataset.acct));
  const go = async () => {
    const user = $('acct-user').value.trim(), pass = $('acct-pass').value;
    if (mode === 'signup' && pass !== $('acct-pass2').value) { $('acct-msg').textContent = 'The two passwords are different. Type them again.'; return; }
    $('acct-msg').textContent = mode === 'signup' ? 'Creating your account…' : 'Logging in…';
    try {
      if (mode === 'signup') await acct.signUp(user, pass);
      else await acct.logIn(user, pass);
      $('acct-pass').value = $('acct-pass2').value = '';
      $('acct-msg').textContent = '';
    } catch (e) { $('acct-msg').textContent = e.message || String(e); }
  };
  $('btn-acct-go').addEventListener('click', go);
  for (const id of ['acct-user', 'acct-pass', 'acct-pass2']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('btn-acct-forgot').addEventListener('click', () => {
    $('acct-msg').textContent = "Ask the game's owner to reset your password. They'll give you a temporary one: log in with it, then press \"Change password\" to pick your own.";
  });
  $('btn-acct-changepass').addEventListener('click', showNewPassword);
  $('btn-acct-newpass').addEventListener('click', async () => {
    $('acct-newpass-msg').textContent = 'Saving…';
    try {
      await acct.setNewPassword($('acct-newpass-input').value);
      $('acct-newpass-input').value = '';
      $('acct-newpass').classList.add('hidden');
      $('btn-acct-changepass').classList.remove('hidden');
      toast('New password saved');
    } catch (e) { $('acct-newpass-msg').textContent = e.message || String(e); }
  });
  $('btn-acct-logout').addEventListener('click', () => acct.logOut());
  acct.onAccountChange(() => { renderAccount(); onLogin(); hideBackrooms(); syncUnlock(); renderLobby(); if (!$('practice').classList.contains('hidden')) renderPracticeMenu(); });
  setMode('login');
}

function showNewPassword() {
  $('acct-newpass-msg').textContent = '';
  $('acct-newpass').classList.remove('hidden');
  $('btn-acct-changepass').classList.add('hidden');
  $('acct-newpass-input').focus();
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
    app.syncGeneral && app.syncGeneral(); app.syncDrones && app.syncDrones(); app.renderKeys && app.renderKeys(); app.syncCrosshair && app.syncCrosshair(); app.renderGfx && app.renderGfx(); app.liveGfx && app.liveGfx();
    applyTouchLayout(settings.touchLayout);
    toast('Loaded your saved settings');
  } else saveSettings();   // first login: upload this device's settings
}

// After a real online match, add it to the account (practice and bot games never count).
async function reportToAccount(msg) {
  if (!acct.loggedIn() || app.botGame || app.mode === 'practice' || !app.game || msg.mode === 'br' || msg.mode === 'mg' || msg.mode === 'vb' || msg.mode === 'fpv') return;
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

// Settings → Drones: a picture of the two sticks with what each direction does
const DRONE_JOBS = { thr: ['Throttle', 'more', 'less'], yaw: ['Turn', 'right', 'left'], pitch: ['Tilt', 'forward', 'back'], roll: ['Roll', 'right', 'left'], none: ['Nothing', '', ''] };
function drawStickPreview(d) {
  const c = $('dr-preview');
  if (!c) return;
  const g = c.getContext('2d'), W = c.width = 420, H = c.height = 190;
  g.clearRect(0, 0, W, H);
  const ax = d.sticks === 'custom' ? d.axes : STICK_MODES[d.sticks] || STICK_MODES.mode2;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  [['l', 105], ['r', 315]].forEach(([s, x]) => {
    const y = 80, v = DRONE_JOBS[ax[s + 'y']] || DRONE_JOBS.none, h = DRONE_JOBS[ax[s + 'x']] || DRONE_JOBS.none;
    const iy = d.inv[s + 'y'], ix = d.inv[s + 'x'];
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 44, 0, 7); g.stroke();
    g.fillStyle = 'rgba(240,160,64,.9)'; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill();
    g.font = '700 11px system-ui, sans-serif'; g.fillStyle = '#a7a39a';
    g.fillText(s === 'l' ? 'LEFT STICK' : 'RIGHT STICK', x, 12);
    g.font = '600 11px system-ui, sans-serif'; g.fillStyle = '#f2efe8';
    if (v[1]) { g.fillText(iy ? v[2] : v[1], x, y - 55); g.fillText(iy ? v[1] : v[2], x, y + 55); }
    if (h[1]) { g.textAlign = 'right'; g.fillText(ix ? h[1] : h[2], x - 50, y); g.textAlign = 'left'; g.fillText(ix ? h[2] : h[1], x + 50, y); g.textAlign = 'center'; }
    g.font = '700 12px system-ui, sans-serif'; g.fillStyle = '#f0a040';
    g.fillText(`↕ ${v[0]}   ↔ ${h[0]}`, x, 160);
  });
  if (d.fly === 'easy') { g.font = '500 11px system-ui, sans-serif'; g.fillStyle = '#a7a39a'; g.fillText('Casual: the throttle stick climbs / sinks and springs back.', W / 2, 181); }
}

function openSub(id) {
  app.returnTo = app.game ? 'game' : (!$('lobby').classList.contains('hidden') ? 'lobby' : 'menu');
  if (app.game) $('pause').classList.add('hidden');
  show(id);
  // flying a drone: Settings opens on the Drones tab
  if (id === 'settings' && app.game && app.game.fpvMode) document.querySelector('#settings .tab[data-tab="drones"]').click();
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
  fillIcons();   // white icons (icons.js) into every <i data-icon> in the page
  hideBackrooms();
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
  initServerWake();
  $('btn-rejoin').addEventListener('click', () => { const code = lastRoom(); if (code) joinGame(code); else updateRejoin(); });
  updateRejoin();
  stopPageZoom();
  $('btn-join').addEventListener('click', () => joinGame($('code').value));
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame($('code').value); });
  $('code').addEventListener('input', e => { e.target.value = normaliseCode(e.target.value); });
  $('btn-practice').addEventListener('click', () => { renderPracticeMenu(); openSub('practice'); });
  $('btn-settings').addEventListener('click', () => openSub('settings'));
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
  for (const b of document.querySelectorAll('.mode-btn[data-mode]')) b.addEventListener('click', () => sendToServer(b.dataset.mode === 'fpv' ? { t: 'settings', fpvOk: dronesAllowed(), mode: 'fpv' } : { t: 'settings', mode: b.dataset.mode }));
  $('lobby-fpvlaps').addEventListener('change', e => sendToServer({ t: 'settings', fpvLaps: Number(e.target.value) || 3 }));
  $('lobby-fpvother').addEventListener('change', e => { if (e.target.value) sendToServer({ t: 'settings', fpvMap: e.target.value }); });
  $('btn-fpv-end').addEventListener('click', () => sendToServer({ t: 'fpvEnd' }));
  $('lobby-night').addEventListener('change', e => sendToServer({ t: 'settings', night: e.target.checked }));
  $('lobby-level').addEventListener('change', e => sendToServer({ t: 'settings', level: e.target.value }));
  $('lobby-mgrun').addEventListener('change', e => sendToServer({ t: 'settings', mgRun: e.target.value }));
  $('lobby-mggame').addEventListener('change', e => sendToServer({ t: 'settings', mgGame: e.target.value }));
  $('lobby-mgrounds').addEventListener('change', e => sendToServer({ t: 'settings', mgRounds: Number(e.target.value) || 3 }));
  $('lobby-mgteams').addEventListener('change', e => sendToServer({ t: 'settings', mgTeams: e.target.checked }));
  $('lobby-vbsets').addEventListener('change', e => sendToServer({ t: 'settings', vbSets: Number(e.target.value) || 3 }));
  // the minigames to pick from (one list for the lobby and Practice)
  for (const sel of document.querySelectorAll('select.mg-games')) for (const id of MG_ORDER) { const o = document.createElement('option'); o.value = id; o.textContent = MG_GAMES[id].name; sel.appendChild(o); }
  $('lobby-stage').addEventListener('change', e => { const v = Number(e.target.value) || 0; sendToServer({ t: 'settings', stage: (v === 1 && level1Unlocked()) || (v === 2 && level2Unlocked()) ? v : 0 }); });
  $('btn-start').addEventListener('click', () => { initAudio(); tryFullscreen(); sendToServer({ t: 'startMatch' }); });

  $('btn-resume').addEventListener('click', resume);
  $('btn-fullscreen').addEventListener('click', () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (req) req.call(el).catch?.(() => toast('Full screen is not available here.'));
  });
  $('btn-pause-settings').addEventListener('click', () => openSub('settings'));
  $('btn-leave').addEventListener('click', leaveToMenu);
  $('btn-to-lobby').addEventListener('click', () => sendToServer({ t: app.botGame ? 'restart' : 'toLobby' }));
  $('btn-pause-invite').addEventListener('click', shareInvite);
  $('btn-over-leave').addEventListener('click', leaveToMenu);
  $('btn-cancel-load').addEventListener('click', leaveToMenu);
  // a tap on the dark background resumes, but not the tap that just opened the menu: on phones the same tap on the
  // pause button arrives here as a click on the background, so the menu used to shut at once (no way to Leave)
  $('pause').addEventListener('click', e => { if (e.target === $('pause') && app.game && performance.now() - (app.pauseAt || 0) > 500) resume(); });

  bindSettings();
  bindPracticeMenu();
  bindAccount();
  renderAccount();
  acct.initAccounts().then(() => { renderAccount(); onLogin(); });
  applyTouchLayout(settings.touchLayout);
  $('btn-account').addEventListener('click', () => { renderAccount(); openSub('account'); });
  $('btn-friends').addEventListener('click', () => { openSub('friends'); openFriends(); });
  $('btn-invite-friends').addEventListener('click', () => { openSub('friends'); openFriends(); });
  $('btn-admin').addEventListener('click', () => { openSub('admin'); openAdmin(); });
  initAdmin({ isOpen: () => !$('admin').classList.contains('hidden') });
  initFriends({
    joinGame: (code) => { if (app.mode) leaveToMenu(); joinGame(code); },
    activity: activityText,
    roomCode: () => app.code,
    toast,
    // a friend's message: the usual pop-up, now with what they wrote
    friendMessage: (name, text) => toast(`[[chat]] New message from ${name}: ${text}`, 6000),
    openAccount: () => { renderAccount(); show('account'); },
    isOpen: () => !$('friends').classList.contains('hidden'),
  });
  document.addEventListener('pointerdown', () => initAudio(), { once: true });
  window.addEventListener('beforeunload', () => cleanup());
  void playClick;
  show('menu');
}

window.__debug = new URLSearchParams(location.search).has('debug');
window.__app = { deliver: (m) => deliver(m), get game() { return app.game; }, get state() { return app; } };
if (window.__debug) window.__app.practice = (cfg) => practice(cfg);      // (tests start any practice game straight away)
init();
