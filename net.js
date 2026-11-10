// Peer-to-peer networking with PeerJS (WebRTC). The host's browser is the
// game server; other players connect to it using a short room code.
/* global Peer */
import { CONFIG } from './config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// ---------- relay (TURN) ----------
// Short-lived relay login details from Metered (if configured). Only a good answer is kept: a fetch that a
// school filter blocks or slows down is tried again next time, instead of leaving the game without a relay.
let relayCache = null;
let relayState = 'none';                 // 'none' (not configured) | 'ok' | 'blocked'
export function relayConfigured() { return !!(CONFIG.turnApp && CONFIG.turnApiKey); }
export function relayStatus() { return relayConfigured() ? relayState : 'none'; }
export async function relayServers({ fresh = false } = {}) {
  if (!relayConfigured()) return [];
  if (relayCache && !fresh) return relayCache;
  const url = `https://${encodeURIComponent(CONFIG.turnApp)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(CONFIG.turnApiKey)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      const list = await res.json();
      // keep the relay routes (TURN over UDP, TCP and TLS); its extra STUN entry adds nothing
      const relay = Array.isArray(list) ? list.filter(s => s && /^turns?:/.test(String(s.urls))) : [];
      if (relay.length) { relayCache = relay; relayState = 'ok'; return relay; }
    } catch (e) { /* blocked or slow: try once more */ }
  }
  relayState = 'blocked';
  console.warn('Relay login unavailable on this network — direct connections only');
  return [];
}
// one STUN server (to find a direct route) plus the relay routes; more servers only slow down the search
async function iceServers() {
  const relay = await relayServers();
  return relay.length ? [CONFIG.iceServers[0], ...relay] : CONFIG.iceServers.slice();
}

function makePeer(id, ice, relayOnly = false) {
  if (typeof Peer === 'undefined') throw new Error('Networking library failed to load.');
  const config = { iceServers: ice || CONFIG.iceServers };
  if (CONFIG.relayOnly || relayOnly) config.iceTransportPolicy = 'relay';
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
  constructor({ onJoin, onMessage, onLeave, onError }) {
    Object.assign(this, { onJoin, onMessage, onLeave, onError });
    this.conns = new Map();
    this.peer = null;
    this.code = null;
  }

  async open() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        await this.tryOpen(code, await iceServers());
        this.code = code;
        return code;
      } catch (e) {
        if (e && e.type === 'unavailable-id') continue;
        throw new Error(describe(e));
      }
    }
    throw new Error('Could not create a room. Try again.');
  }

  tryOpen(code, ice) {
    return new Promise((resolve, reject) => {
      const peer = makePeer(CONFIG.peerPrefix + code, ice);
      const fail = (e) => { peer.destroy(); reject(e); };
      const timer = setTimeout(() => fail({ type: 'network' }), 15000);
      peer.on('open', () => {
        clearTimeout(timer);
        this.peer = peer;
        peer.off('error', fail);
        peer.on('error', (e) => this.onError && this.onError(describe(e)));
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        peer.on('connection', (conn) => this.accept(conn));
        resolve();
      });
      peer.on('error', (e) => { clearTimeout(timer); fail(e); });
    });
  }

  accept(conn) {
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        if (this.conns.size >= CONFIG.maxPlayers - 1) {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        this.conns.set(conn.peer, conn);
        this.onJoin(conn.peer, msg.name);
      } else if (this.conns.has(conn.peer)) {
        this.onMessage(conn.peer, msg);
      }
    });
    const gone = () => {
      if (this.conns.get(conn.peer) === conn) {
        this.conns.delete(conn.peer);
        this.onLeave(conn.peer);
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) {
      try { c.send(msg); } catch (e) { /* channel closing */ }
    }
  }

  destroy() {
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

  // Joins the room and resolves once the host has answered. First try: any route (direct or relay).
  // If that never opens and there is a relay, a second try goes through the relay only, which gets
  // through networks where a direct route looks possible but never connects.
  async connect(code, name) {
    const ice = await iceServers();
    const relay = ice.some(s => /^turns?:/.test(String(s.urls)));
    const tries = relay ? [[false, 12000], [true, 16000]] : [[false, 20000]];
    let last = null;
    for (const [relayOnly, ms] of tries) {
      if (this.closed) throw new Error('Cancelled.');
      if (relayOnly) this.status('Trying the relay…');
      try { await this.attempt(code, name, ice, relayOnly, ms); return; }
      catch (e) { last = e; if (e.final) break; }
    }
    this.destroy();
    throw new Error(last && last.message || 'Could not connect to the host.');
  }

  attempt(code, name, ice, relayOnly, ms) {
    return new Promise((resolve, reject) => {
      let settled = false, opened = false, signalled = false, peer, timer, replyTimer;
      const fail = (message, final = false) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(replyTimer);
        try { peer && peer.destroy(); } catch (e) { /* already gone */ }
        if (this.peer === peer) { this.peer = null; this.conn = null; }
        reject(Object.assign(new Error(message), { final }));
      };
      const blocked = () => {
        const r = relayStatus();
        if (r === 'ok') return 'Found the room but could not connect to the host, even through the relay. This Wi-Fi seems to block game connections. Tap “Check this Wi-Fi” to see what is blocked.';
        if (r === 'blocked') return 'Found the room but could not connect to the host. This Wi-Fi blocks direct connections and the relay sign-in (metered.live). Tap “Check this Wi-Fi” to see what is blocked.';
        return 'Found the room but couldn\'t connect to the host. This network (often school or work Wi-Fi) blocks direct connections — a relay server fixes it (see README).';
      };
      timer = setTimeout(() => {
        if (!signalled) fail('Could not reach the matchmaking server (0.peerjs.com). This Wi-Fi may be blocking it, or the server is busy — try again.', true);
        else fail(blocked());
      }, ms);
      try { peer = makePeer(undefined, ice, relayOnly); } catch (e) { fail(describe(e), true); return; }
      this.peer = peer;
      peer.on('error', (e) => {
        if (!settled) {
          const t = e && e.type;
          // a missing room or an unreachable matchmaking server won't change on a second try
          fail(describe(e), t === 'peer-unavailable' || t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' || t === 'browser-incompatible');
        } else if (e.type === 'peer-unavailable' || e.type === 'disconnected') this.lost();
      });
      peer.on('open', () => {
        if (settled) return;
        signalled = true;
        this.status('Connecting to the host…');
        const conn = peer.connect(CONFIG.peerPrefix + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          if (settled) return;
          opened = true;
          this.status('Waiting for the host…');
          conn.send({ t: 'hello', name });
          // the host answers straight away; don't wait the whole timeout for an answer that isn't coming
          clearTimeout(timer);
          replyTimer = setTimeout(() => fail('Connected to the host, but no answer came back. Try again.'), 10000);
        });
        conn.on('data', (msg) => {
          if (msg && msg.t === 'full') { fail('That room is full.', true); return; }
          if (!settled && opened) { settled = true; clearTimeout(timer); clearTimeout(replyTimer); resolve(); }
          if (this.conn === conn) this.onMessage(msg);
        });
        conn.on('close', () => { if (settled) { if (this.conn === conn) this.lost(); } else if (opened) fail('The host closed the connection.'); });
        conn.on('error', () => { if (settled) { if (this.conn === conn) this.lost(); } });
      });
    });
  }

  lost() {
    if (this.closed) return;
    this.closed = true;
    if (this.onClose) this.onClose();
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(msg); } catch (e) { /* closing */ }
    }
  }

  destroy() {
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
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { this.destroy(); reject(err); } else resolve();
      };
      const timer = setTimeout(() => done(new Error('The game server is not responding. It may be offline — try again later.')), 12000);
      let ws;
      try { ws = new WebSocket(url); } catch (e) { done(new Error('The game server address in config.js is not valid.')); return; }
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(action));
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'error') { done(new Error(msg.text)); return; }
        if (msg.t === 'room') done();
        this.onMessage(msg);
      };
      ws.onerror = () => done(new Error('Could not reach the game server. It may be offline, or this network blocks it.'));
      ws.onclose = () => {
        if (!settled) done(new Error('Could not reach the game server. It may be offline, or this network blocks it.'));
        else this.lost();
      };
    });
  }

  lost() {
    if (this.closed) return;
    this.closed = true;
    if (this.onClose) this.onClose();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); } catch { /* closing */ }
    }
  }

  destroy() {
    this.closed = true;
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
  }
}
