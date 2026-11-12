// SITELINE dedicated game server.
// Runs the same match rules as the browser version (../server.js), one
// instance per room, and talks to players over WebSockets.
//
//   node server.mjs            → listens on port 8787
//   set PORT=9000 && node server.mjs   (Windows) to change the port
//
// Open http://localhost:8787 in a browser to check it's running.

import http from 'node:http';
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
  if (room.game.humans().length >= CONFIG.maxPlayers) {      // real people only (the Backrooms monster doesn't count)
    send(ws, { t: 'error', text: `That room is full (${CONFIG.maxPlayers} players max).` });
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

// ---------- HTTP: status page + WebSocket upgrade ----------
const httpServer = http.createServer((req, res) => {
  const players = [...rooms.values()].reduce((n, r) => n + r.sockets.size, 0);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(`SITELINE server is running.\nRooms: ${rooms.size}\nPlayers online: ${players}\nUp since: ${started.toLocaleString()}\n`);
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
});

process.on('SIGINT', () => { log('shutting down'); process.exit(0); });
