// Peer-to-peer networking with PeerJS (WebRTC). The host's browser is the
// game server; other players connect to it using a short room code.
/* global Peer */
import { CONFIG } from './config.js';
import { startLog, watchRtc } from './netlog.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// Direct (peer-to-peer) rooms connect players straight to each other: STUN (config.js iceServers) finds the route.
// There is no relay (TURN) any more: the owner removed Metered — online games go through the game server instead.
const matchmaker = () => (CONFIG.peerServer ? `${CONFIG.peerServer.host}:${CONFIG.peerServer.port}` : '0.peerjs.com');
const errText = (e) => `${(e && e.type) || 'error'}${e && e.message ? `: ${e.message}` : ''}`;

function makePeer(id) {
  if (typeof Peer === 'undefined') throw new Error('Networking library failed to load.');
  const config = { iceServers: CONFIG.iceServers };
  const opts = { config, debug: CONFIG.debug ? 2 : 0 };
  if (CONFIG.peerServer) Object.assign(opts, CONFIG.peerServer);
  return id ? new Peer(id, opts) : new Peer(opts);
}

function describe(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'Room not found. Check the code and that the host is still in the lobby.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the matchmaking server (0.peerjs.com). This Wi-Fi may be blocking it.';
  if (t === 'browser-incompatible') return 'This browser does not support WebRTC multiplayer.';
  return (err && err.message) || 'Connection error';
}

export class HostNet {
  // logKind: 'host' logs from the start; 'invite' (a practice game's quiet invite room) only starts a log
  // when something goes wrong or a friend tries to join, so practice games don't fill the log
  // capacity(): how many people the room takes now, the host included (default CONFIG.maxPlayers)
  constructor({ onJoin, onMessage, onLeave, onError, capacity, logKind = 'host' }) {
    Object.assign(this, { onJoin, onMessage, onLeave, onError, capacity, logKind });
    this.conns = new Map();
    this.peer = null;
    this.code = null;
    this.log = logKind === 'host' ? startLog('host', { matchmaker: matchmaker() }) : null;
  }

  // the log, started on first use for an invite room
  note(text) {
    if (!this.log) this.log = startLog(this.logKind, { matchmaker: matchmaker(), code: this.code || undefined });
    this.log.event(text);
  }

  async open() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        await this.tryOpen(code);
        this.code = code;
        if (this.log) { this.log.entry.info.code = code; this.log.end('connected', `room ${code} open`); }
        return code;
      } catch (e) {
        if (e && e.type === 'unavailable-id') { if (this.log) this.log.event(`matchmaking: code ${code} already taken, picking another`); continue; }
        const msg = describe(e);
        if (this.logKind !== 'invite') { this.note(`matchmaking: could not open room (${errText(e)})`); this.log.end('failed', msg); }
        throw new Error(msg);
      }
    }
    if (this.logKind !== 'invite') { this.note('matchmaking: no free room code after 5 tries'); this.log.end('failed', 'Could not create a room.'); }
    throw new Error('Could not create a room. Try again.');
  }

  tryOpen(code) {
    return new Promise((resolve, reject) => {
      if (this.log) this.log.event(`matchmaking: opening room ${code} on ${matchmaker()}`);
      const t0 = performance.now();
      const peer = makePeer(CONFIG.peerPrefix + code);
      const fail = (e) => { peer.destroy(); reject(e); };
      const timer = setTimeout(() => fail({ type: 'network', message: 'no answer within 15 s' }), 15000);
      peer.on('open', () => {
        clearTimeout(timer);
        if (this.log) this.log.event(`matchmaking: room open after ${Math.round(performance.now() - t0)} ms`);
        this.peer = peer;
        peer.off('error', fail);
        peer.on('error', (e) => { this.note(`matchmaking/peer error (${errText(e)})`); if (this.onError) this.onError(describe(e)); });
        peer.on('disconnected', () => { this.note('matchmaking: lost the server connection, reconnecting (friends can\'t join until it is back)'); if (!peer.destroyed) peer.reconnect(); });
        peer.on('open', () => { if (this.log) this.log.event('matchmaking: connected again'); });
        peer.on('connection', (conn) => this.accept(conn));
        resolve();
      });
      peer.on('error', (e) => { clearTimeout(timer); fail(e); });
    });
  }

  accept(conn) {
    const who = `player ${String(conn.peer).slice(0, 8)}`;
    this.note(`${who}: trying to connect`);
    const report = watchRtc(this.log, conn.peerConnection, who);
    let opened = false;
    const check = setTimeout(() => { if (!opened) { this.note(`${who}: still not connected after 20 s`); report(); } }, 20000);
    conn.on('open', () => { opened = true; clearTimeout(check); this.note(`${who}: connected`); report(); });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        if (this.conns.size >= (this.capacity ? this.capacity() : CONFIG.maxPlayers) - 1) {
          this.note(`${who}: room full, turned away`);
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        this.note(`${who}: said hello, joining as "${String(msg.name || '').slice(0, 16)}"`);
        this.conns.set(conn.peer, conn);
        this.onJoin(conn.peer, msg.name);
      } else if (this.conns.has(conn.peer)) {
        this.onMessage(conn.peer, msg);
      }
    });
    const gone = (why) => {
      clearTimeout(check);
      this.note(`${who}: ${why}`);
      report();
      if (this.conns.get(conn.peer) === conn) {
        this.conns.delete(conn.peer);
        this.onLeave(conn.peer);
      }
    };
    conn.on('close', () => gone('connection closed'));
    conn.on('error', (e) => gone(`connection error (${errText(e)})`));
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) {
      try { c.send(msg); } catch (e) { /* channel closing */ }
    }
  }

  destroy() {
    if (this.log) this.log.end('left');
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    if (this.peer) this.peer.destroy();
  }
}

export class ClientNet {
  // onStatus (optional) gets short progress texts while connecting
  constructor({ onMessage, onClose, onStatus }) {
    Object.assign(this, { onMessage, onClose, onStatus });
    this.peer = null;
    this.conn = null;
    this.closed = false;
  }

  status(text) { if (this.onStatus && !this.closed) this.onStatus(text); }

  // Joins the room and resolves once the host has answered (one try of up to 20 s).
  async connect(code, name) {
    const log = this.log = startLog('join', { code, matchmaker: matchmaker() });
    try { await this.attempt(code, name, 20000, 'try 1'); log.end('connected'); }
    catch (e) {
      log.event(`try 1 failed: ${e.message}`);
      log.end('failed', e.message);
      this.destroy();
      throw new Error(e.message || 'Could not connect to the host.');
    }
  }

  attempt(code, name, ms, label) {
    const log = this.log;
    return new Promise((resolve, reject) => {
      let settled = false, opened = false, signalled = false, peer, timer, replyTimer, report = null;
      const t0 = performance.now();
      const fail = async (message, final = false) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(replyTimer);
        if (report) await report();
        try { peer && peer.destroy(); } catch (e) { /* already gone */ }
        if (this.peer === peer) { this.peer = null; this.conn = null; }
        reject(Object.assign(new Error(message), { final }));
      };
      const blocked = () => 'Found the room but couldn\'t connect to the host. This network (often school or work Wi-Fi) blocks direct connections between players. Games on the game server (6-character codes) still work. Tap “Check this Wi-Fi” to see what is blocked.';
      timer = setTimeout(() => {
        if (!signalled) fail('Could not reach the matchmaking server (0.peerjs.com). This Wi-Fi may be blocking it, or the server is busy — try again.', true);
        else fail(blocked());
      }, ms);
      try { peer = makePeer(); } catch (e) { fail(describe(e), true); return; }
      this.peer = peer;
      log.event(`${label}: contacting the matchmaking server (${matchmaker()})`);
      peer.on('error', (e) => {
        log.event(`${label}: error from PeerJS (${errText(e)})`);
        if (!settled) {
          const t = e && e.type;
          // a missing room or an unreachable matchmaking server won't change on a second try
          fail(describe(e), t === 'peer-unavailable' || t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' || t === 'browser-incompatible');
        } else if (e.type === 'peer-unavailable' || e.type === 'disconnected') this.lost(errText(e));
      });
      peer.on('open', () => {
        if (settled) return;
        signalled = true;
        log.event(`${label}: matchmaking server answered after ${Math.round(performance.now() - t0)} ms; asking for room ${code}`);
        this.status('Connecting to the host…');
        const conn = peer.connect(CONFIG.peerPrefix + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        report = watchRtc(log, conn.peerConnection, label);
        conn.on('open', () => {
          if (settled) return;
          opened = true;
          log.event(`${label}: connected to the host after ${Math.round(performance.now() - t0)} ms; saying hello`);
          report();
          this.status('Waiting for the host…');
          conn.send({ t: 'hello', name });
          // the host answers straight away; don't wait the whole timeout for an answer that isn't coming
          clearTimeout(timer);
          replyTimer = setTimeout(() => fail('Connected to the host, but no answer came back. Try again.'), 10000);
        });
        conn.on('data', (msg) => {
          if (msg && msg.t === 'full') { fail('That room is full.', true); return; }
          if (!settled && opened) { settled = true; clearTimeout(timer); clearTimeout(replyTimer); log.event(`${label}: the host answered (${msg && msg.t})`); this.report = report; resolve(); }
          if (this.conn === conn) this.onMessage(msg);
        });
        conn.on('close', () => { if (settled) { if (this.conn === conn) this.lost('the connection to the host closed'); } else if (opened) fail('The host closed the connection.'); });
        conn.on('error', (e) => { log.event(`${label}: connection error (${errText(e)})`); if (settled && this.conn === conn) this.lost(`connection error (${errText(e)})`); });
      });
    });
  }

  lost(why = 'connection lost') {
    if (this.closed) return;
    this.closed = true;
    if (this.log) {
      const log = this.log;
      log.event(`lost the host: ${why}`);
      (this.report ? this.report() : Promise.resolve()).then(() => log.end('lost', why));
    }
    if (this.onClose) this.onClose();
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(msg); } catch (e) { /* closing */ }
    }
  }

  destroy() {
    if (!this.closed && this.log) this.log.end('left');
    this.closed = true;
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* already gone */ } }
  }
}

// ---------- dedicated server (WebSocket) ----------
// Used when CONFIG.serverUrl is set: every player connects to the same server,
// which runs the match. Same message format as peer-to-peer.
export class ServerNet {
  constructor({ onMessage, onClose }) {
    Object.assign(this, { onMessage, onClose });
    this.ws = null;
    this.closed = false;
  }

  // action: { t: 'create', name } or { t: 'join', code, name }
  connect(url, action) {
    const log = this.log = startLog('server', { code: action.code || undefined, server: String(url).replace(/^wss?:\/\//, ''), action: action.t });
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { log.end('failed', err.message); this.destroy(); reject(err); } else { log.end('connected'); resolve(); }
      };
      const timer = setTimeout(() => done(new Error('The game server is not responding. It may be offline — try again later.')), 12000);
      let ws;
      log.event('game server: connecting');
      try { ws = new WebSocket(url); } catch (e) { done(new Error('The game server address in config.js is not valid.')); return; }
      this.ws = ws;
      ws.onopen = () => { log.event(`game server: connected after ${Math.round(performance.now() - t0)} ms`); ws.send(JSON.stringify(action)); };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'error') { log.event(`game server said: ${msg.text}`); done(new Error(msg.text)); return; }
        if (msg.t === 'room') { log.event(`game server: in room ${msg.code || ''}`); done(); }
        this.onMessage(msg);
      };
      ws.onerror = () => { log.event('game server: connection error'); done(new Error('Could not reach the game server. It may be offline, or this network blocks it.')); };
      ws.onclose = (ev) => {
        log.event(`game server: connection closed (code ${ev.code}${ev.reason ? `, ${ev.reason}` : ''}${ev.wasClean ? '' : ', not cleanly'})`);
        if (!settled) done(new Error('Could not reach the game server. It may be offline, or this network blocks it.'));
        else this.lost(`closed with code ${ev.code}`);
      };
    });
  }

  lost(why = 'connection lost') {
    if (this.closed) return;
    this.closed = true;
    if (this.log) this.log.end('lost', why);
    if (this.onClose) this.onClose();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); } catch { /* closing */ }
    }
  }

  destroy() {
    if (!this.closed && this.log) this.log.end('left');
    this.closed = true;
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
  }
}
