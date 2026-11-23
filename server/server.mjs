// SITELINE dedicated game server.
// Runs the same match rules as the browser version (../server.js), one
// instance per room, and talks to players over WebSockets.
//
//   node server.mjs            → listens on port 8787
//   set PORT=9000 && node server.mjs   (Windows) to change the port
//
// Open http://localhost:8787 in a browser to check it's running.
//
// It also hands players their relay (TURN) login at /turn, so the Metered API key can live
// here instead of in the web page. The key comes from the METERED_API_KEY environment
// variable, or from a file turn-key.txt next to this one (first line). No key: /turn says
// so and the game asks Metered itself, as before. (README.txt: "RELAY KEY".)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Server } from '../server.js';
import { CONFIG, RULES } from '../config.js';

const PORT = Number(process.env.PORT || 8787);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 50);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const started = new Date();

const rooms = new Map();     // code -> { code, game, sockets: Map<playerId, ws> }
let nextId = 1;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch { /* closing */ }
  }
}

function createRoom() {
  const code = newCode();
  const room = { code, sockets: new Map(), game: null };
  room.game = new Server({
    ownerId: null,
    localId: null,
    send: (id, msg) => send(room.sockets.get(id), msg),
  });
  rooms.set(code, room);
  log(`room ${code} created (${rooms.size} open)`);
  return room;
}

function closeRoom(room) {
  room.game.destroy();
  rooms.delete(room.code);
  log(`room ${room.code} closed (${rooms.size} open)`);
}

function joinRoom(ws, room, name) {
  const max = room.game.roomMax ? room.game.roomMax() : CONFIG.maxPlayers;   // 4 for 2v2, 6 for deathmatch and the Backrooms
  if (room.game.humans().length >= max) {      // real people only (the Backrooms monster doesn't count)
    send(ws, { t: 'error', text: `That room is full (${max} players max).` });
    return;
  }
  const id = `p${nextId++}`;
  ws.player = { id, room };
  room.sockets.set(id, ws);
  if (!room.game.ownerId) room.game.ownerId = id;
  send(ws, { t: 'room', code: room.code });
  room.game.addPlayer(id, name);
  log(`${id} (${String(name).slice(0, 16)}) joined ${room.code} — ${room.game.humans().length} in room`);
}

function leave(ws) {
  const p = ws.player;
  if (!p) return;
  ws.player = null;
  const { room, id } = p;
  room.sockets.delete(id);
  room.game.removePlayer(id);
  log(`${id} left ${room.code}`);
  if (room.sockets.size === 0) closeRoom(room);
}

// ---------- relay (TURN) logins for players ----------
const HERE = path.dirname(fileURLToPath(import.meta.url));
const keyFile = () => { try { return fs.readFileSync(path.join(HERE, 'turn-key.txt'), 'utf8').split(/\r?\n/)[0].trim(); } catch { return ''; } };
const TURN_KEY = String(process.env.METERED_API_KEY || keyFile()).trim();
const TURN_APP = String(process.env.METERED_APP || CONFIG.turnApp || '').trim();
// web pages allowed to ask for it (the game's own site, and a copy on this computer for testing); more with
// ALLOWED_ORIGINS=https://a.example,https://b.example
const ORIGINS = [/^https:\/\/sitev2\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const EXTRA_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
const originOk = (o) => !o || ORIGINS.some(re => re.test(o)) || EXTRA_ORIGINS.includes(o);
// Metered is asked at most once every 10 minutes, however many players there are: everyone gets the same login
let turn = { list: null, at: 0, error: TURN_KEY ? '' : 'no key set', pending: null };
async function turnLogins() {
  if (turn.list && Date.now() - turn.at < 10 * 60000) return turn.list;
  if (!turn.pending) {
    turn.pending = (async () => {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(`https://${encodeURIComponent(TURN_APP)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(TURN_KEY)}`, { signal: ctl.signal });
        let list = null;
        try { list = await res.json(); } catch { /* not JSON */ }
        const relay = Array.isArray(list) ? list.filter(s => s && /^turns?:/.test(String(s.urls))) : [];
        if (!relay.length) throw new Error(`Metered answered ${res.status} with no relay routes (is the key right?)`);
        turn = { list: relay, at: Date.now(), error: '', pending: null };
        return relay;
      } catch (e) {
        turn.error = e && e.name === 'AbortError' ? 'Metered did not answer within 8 s' : String((e && e.message) || e);
        log(`relay login: ${turn.error}`);
        throw e;
      } finally { clearTimeout(timer); turn.pending = null; }
    })();
  }
  return turn.pending;
}
async function serveTurn(req, res) {
  const origin = req.headers.origin;
  if (!originOk(origin)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Not allowed from this website.'); return; }
  const head = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
  if (!TURN_KEY || !TURN_APP) { res.writeHead(404, head); res.end(JSON.stringify({ error: 'No relay key is set on this game server.' })); return; }
  try {
    const list = await turnLogins();
    res.writeHead(200, head); res.end(JSON.stringify(list));
  } catch {
    res.writeHead(502, head); res.end(JSON.stringify({ error: `Could not get a relay login: ${turn.error}` }));
  }
}
const turnStatus = () => (!TURN_KEY ? 'not set up (no key on this server: players get it from Metered themselves)'
  : turn.list ? 'ready' : turn.error ? `key set, but the last try failed: ${turn.error}` : 'key set (not asked for yet)');

// ---------- HTTP: status page, relay logins, WebSocket upgrade ----------
const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && String(req.url).split('?')[0] === '/turn') { serveTurn(req, res); return; }
  const players = [...rooms.values()].reduce((n, r) => n + r.sockets.size, 0);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(`SITELINE server is running.\nRooms: ${rooms.size}\nPlayers online: ${players}\nUp since: ${started.toLocaleString()}\nRelay logins for players: ${turnStatus()}\n`);
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.msgBudget = 0;

  ws.on('message', (raw) => {
    // simple flood protection: ~120 messages a second is far above normal play
    if (++ws.msgBudget > 240) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (!ws.player) {
      if (msg.t === 'create') {
        if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'error', text: 'The server is full right now. Try again later.' }); return; }
        joinRoom(ws, createRoom(), msg.name);
      } else if (msg.t === 'join') {
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        const room = rooms.get(code);
        if (!room) send(ws, { t: 'error', text: 'Room not found. Check the code and that the room is still open.' });
        else joinRoom(ws, room, msg.name);
      }
      return;
    }
    ws.player.room.game.receive(ws.player.id, msg);
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// refill flood budgets and drop dead connections
setInterval(() => { for (const ws of wss.clients) ws.msgBudget = 0; }, 2000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* closing */ }
  }
}, 15000);

httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — the server is probably already running in another window.\nClose the other window, or set a different PORT.\n`);
    process.exit(1);
  }
  throw e;
});
wss.on('error', () => { /* reported by httpServer */ });

httpServer.listen(PORT, () => {
  log(`SITELINE server listening on port ${PORT}`);
  log(`Check it at http://localhost:${PORT}  —  ${RULES.teamSize}v${RULES.teamSize}, first to ${RULES.winRounds}`);
  log(`relay logins for players (/turn): ${TURN_KEY ? `key set, for ${TURN_APP}.metered.live` : 'no key set (see README.txt, RELAY KEY)'}`);
  if (TURN_KEY && typeof fetch !== 'function') log('relay logins need Node.js 18 or newer: please update Node.js');
});

process.on('SIGINT', () => { log('shutting down'); process.exit(0); });
