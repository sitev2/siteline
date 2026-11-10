// Connection check: tests, one by one, what this network lets through for online games, so a player on a
// school or work Wi-Fi can see exactly which part is blocked. Runs in the browser; nothing is sent anywhere
// except the test connections themselves.
//   1. relay sign-in   — fetching relay (TURN) login details from Metered
//   2. matchmaking     — the PeerJS server that finds rooms (0.peerjs.com)
//   3. direct route    — a STUN answer over UDP (needed for direct player-to-player connections)
//   4. relay routes    — reaching the relay over UDP, TCP and TLS (port 443)
//   5. game connection — two test players on this device connecting through the relay and swapping a message
/* global Peer */
import { CONFIG } from './config.js';
import { relayServers, relayConfigured } from './net.js';

export const STEPS = [
  { id: 'relayLogin', label: 'Relay sign-in', what: 'Gets login details for the relay from metered.live' },
  { id: 'match', label: 'Matchmaking server', what: 'Finds rooms (0.peerjs.com)' },
  { id: 'direct', label: 'Direct connections', what: 'Connecting straight to the other player (UDP)' },
  { id: 'relayUdp', label: 'Relay over UDP', what: 'The fastest relay route' },
  { id: 'relayTcp', label: 'Relay over TCP', what: 'Port 80' },
  { id: 'relayTls', label: 'Relay over TLS', what: 'Port 443, looks like a normal secure website' },
  { id: 'loop', label: 'Game connection through the relay', what: 'Sends a test message through the relay and back' },
];

// collect the kinds of ICE candidates a browser finds with these servers ('host', 'srflx', 'relay')
function gather(iceServers, policy, want, ms) {
  return new Promise((resolve) => {
    const types = new Set();
    let pc;
    try { pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy }); } catch (e) { resolve(types); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(t); try { pc.close(); } catch (e) { /* closed */ } resolve(types); };
    const t = setTimeout(finish, ms);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { finish(); return; }
      const m = / typ ([a-z]+)/.exec(e.candidate.candidate || '');
      if (m) types.add(m[1]);
      if (types.has(want)) finish();
    };
    pc.createDataChannel('check');
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(finish);
  });
}

function openPeer(opts, ms) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') { reject(new Error('the networking library did not load')); return; }
    const peer = new Peer(opts);
    const t = setTimeout(() => { peer.destroy(); reject(new Error('no answer')); }, ms);
    peer.on('open', () => { clearTimeout(t); resolve(peer); });
    peer.on('error', (e) => { clearTimeout(t); peer.destroy(); reject(new Error(e && e.type || 'error')); });
  });
}

// two test players on this device swap a message through the relay only (direct routes are switched
// off, otherwise they would simply talk inside this iPad and prove nothing about the network)
function relayLoop(a, b, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no message came back')), ms);
    a.on('connection', (c) => c.on('data', (d) => { if (d && d.ping) c.send({ pong: d.ping }); }));
    const conn = b.connect(a.id, { reliable: true, serialization: 'json' });
    const sent = performance.now();
    conn.on('open', () => conn.send({ ping: 1 }));
    conn.on('data', (d) => { if (d && d.pong) { clearTimeout(t); resolve(Math.round(performance.now() - sent)); } });
    conn.on('error', () => { clearTimeout(t); reject(new Error('connection failed')); });
  });
}

// Run every test. update(id, state, detail) is called as results come in; state is 'run' | 'ok' | 'fail' | 'skip'.
export async function runNetTest(update) {
  const R = {};
  const set = (id, state, detail = '') => { R[id] = { state, detail }; update(id, state, detail); };
  for (const s of STEPS) set(s.id, 'wait');

  // 1. relay sign-in
  let relay = [];
  if (!relayConfigured()) set('relayLogin', 'skip', 'No relay is set up in config.js');
  else {
    set('relayLogin', 'run');
    relay = await relayServers({ fresh: true });
    set('relayLogin', relay.length ? 'ok' : 'fail', relay.length ? 'Got relay login details' : 'Blocked or no answer');
  }

  // 2. matchmaking server (the test player opens with relay-only settings, ready for test 5)
  set('match', 'run');
  const opts = { config: { iceServers: relay.length ? relay : CONFIG.iceServers, iceTransportPolicy: relay.length ? 'relay' : 'all' }, debug: 0 };
  if (CONFIG.peerServer) Object.assign(opts, CONFIG.peerServer);
  let a = null;
  try { a = await openPeer(opts, 12000); set('match', 'ok', 'Reached'); }
  catch (e) { set('match', 'fail', `Blocked or no answer (${e.message})`); }

  // 3 and 4: run the route checks side by side
  set('direct', 'run');
  const pick = (re) => relay.find(s => re.test(String(s.urls)));
  const routes = [
    ['relayUdp', pick(/^turn:[^?]*$/)],
    ['relayTcp', pick(/^turn:.*transport=tcp/)],
    ['relayTls', pick(/^turns:/)],
  ];
  const checks = [gather([CONFIG.iceServers[0]], 'all', 'srflx', 6000).then((types) => {
    set('direct', types.has('srflx') ? 'ok' : 'fail', types.has('srflx') ? 'Got an answer over UDP' : 'No answer over UDP — direct connections are blocked');
  })];
  for (const [id, server] of routes) {
    if (!server) { set(id, 'skip', relay.length ? 'Not offered by the relay' : 'Needs the relay sign-in'); continue; }
    set(id, 'run');
    checks.push(gather([server], 'relay', 'relay', 9000).then((types) => {
      set(id, types.has('relay') ? 'ok' : 'fail', `${types.has('relay') ? 'Reached' : 'Blocked or no answer'} (${String(server.urls).replace(/\?.*/, '')})`);
    }));
  }
  await Promise.all(checks);

  // 5. a real message through the relay and back
  if (!a || !relay.length) set('loop', 'skip', !a ? 'Needs the matchmaking server' : 'Needs the relay sign-in');
  else {
    set('loop', 'run');
    let b = null;
    try {
      b = await openPeer(opts, 12000);
      const ms = await relayLoop(a, b, 20000);
      set('loop', 'ok', `Works (message there and back in ${ms} ms)`);
    } catch (e) { set('loop', 'fail', `Failed (${e.message})`); }
    if (b) b.destroy();
  }
  if (a) a.destroy();
  return R;
}

// A plain-language verdict from the results.
export function summarise(R) {
  const ok = (id) => R[id] && R[id].state === 'ok';
  const anyRelay = ok('relayUdp') || ok('relayTcp') || ok('relayTls');
  if (!ok('match')) {
    return { good: false, text: 'This Wi-Fi blocks the matchmaking server (0.peerjs.com), so nobody on it can host or join a room. The school\'s IT team would need to allow 0.peerjs.com, or the game needs its own server (see the README).' };
  }
  if (ok('loop') && ok('direct')) return { good: true, text: 'Everything the game needs gets through this Wi-Fi. If joining still fails, run this check on the other player\'s iPad too: the problem may be on their side.' };
  if (ok('loop')) return { good: true, text: 'Direct connections are blocked here, but the relay works, so online games should still connect (through the relay, with a little more delay). If joining still fails, run this check on the other player\'s iPad too.' };
  if (R.relayLogin && R.relayLogin.state === 'fail') {
    return { good: false, text: `This Wi-Fi blocks the relay sign-in (metered.live)${ok('direct') ? '' : ' and direct connections'}. Without the relay, players can only connect straight to each other, which school Wi-Fi usually stops, so joining will fail or only work now and then. The school's IT team would need to allow siteline-lukloc.metered.live and global.relay.metered.ca.` };
  }
  if (!anyRelay) {
    return { good: false, text: `This Wi-Fi blocks the relay servers (global.relay.metered.ca) on every route${ok('direct') ? '' : ', and direct connections too'}. Joining will fail or only work now and then. The school's IT team would need to allow global.relay.metered.ca (ports 80 and 443).` };
  }
  return { good: false, text: 'The relay answers, but game data does not get through it on this Wi-Fi. Joining will fail or only work now and then. The school\'s IT team would need to allow global.relay.metered.ca (ports 80 and 443).' };
}

// The results as plain text, to copy and send to whoever is fixing it.
export function resultsText(R) {
  const icon = { ok: 'OK', fail: 'BLOCKED', skip: 'skipped', run: '…', wait: '…' };
  const lines = STEPS.map(s => `${s.label}: ${icon[(R[s.id] || {}).state] || '?'}${R[s.id] && R[s.id].detail ? ` — ${R[s.id].detail}` : ''}`);
  return [`SITELINE connection check, ${new Date().toLocaleString()}`, ...lines, `Verdict: ${summarise(R).text}`, `Device: ${navigator.userAgent}`].join('\n');
}
