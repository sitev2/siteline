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

// Fetch short-lived relay credentials once (if a TURN provider is configured).
let iceCache = null;
export function relayConfigured() { return !!(CONFIG.turnApp && CONFIG.turnApiKey); }
async function iceServers() {
  if (iceCache) return iceCache;
  let list = CONFIG.iceServers.slice();
  if (relayConfigured()) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const url = `https://${encodeURIComponent(CONFIG.turnApp)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(CONFIG.turnApiKey)}`;
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      const relay = await res.json();
      if (Array.isArray(relay) && relay.length) list = list.concat(relay);
    } catch (e) {
      console.warn('Relay credentials unavailable, using direct connections only', e);
    }
  }
  iceCache = list;
  return list;
}

function makePeer(id, ice) {
  if (typeof Peer === 'undefined') throw new Error('Networking library failed to load.');
  const config = { iceServers: ice || CONFIG.iceServers };
  if (CONFIG.relayOnly) config.iceTransportPolicy = 'relay';
  const opts = { config, debug: CONFIG.debug ? 2 : 0 };
  if (CONFIG.peerServer) Object.assign(opts, CONFIG.peerServer);
  return id ? new Peer(id, opts) : new Peer(opts);
}

function describe(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'Room not found. Check the code and that the host is still in the lobby.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the matchmaking server. Check your internet — some school and work networks block it.';
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
  constructor({ onMessage, onClose }) {
    Object.assign(this, { onMessage, onClose });
    this.peer = null;
    this.conn = null;
    this.closed = false;
  }

  async connect(code, name) {
    const ice = await iceServers();
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { this.destroy(); reject(new Error(describe(err))); } else resolve();
      };
      const timer = setTimeout(() => done({ message: relayConfigured()
        ? 'Timed out connecting to the host. Check that the host is still in the lobby and both of you have internet.'
        : 'Found the room but couldn\'t connect to the host. This network (often school or work Wi-Fi) blocks direct connections — a relay server fixes it (see README).' }), 20000);
      let peer;
      try { peer = makePeer(undefined, ice); } catch (e) { done(e); return; }
      this.peer = peer;
      peer.on('error', (e) => {
        if (!settled) done(e);
        else if (e.type === 'peer-unavailable' || e.type === 'disconnected') this.lost();
      });
      peer.on('open', () => {
        const conn = peer.connect(CONFIG.peerPrefix + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          conn.send({ t: 'hello', name });
          done();
        });
        conn.on('data', (msg) => {
          if (msg && msg.t === 'full') { done({ message: 'That room is full.' }); return; }
          this.onMessage(msg);
        });
        conn.on('close', () => this.lost());
        conn.on('error', () => this.lost());
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
    if (this.peer) this.peer.destroy();
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
