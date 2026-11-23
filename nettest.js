// Connection check: tests, one by one, what this network lets through for online games, so a player on a
// school or work Wi-Fi can see exactly which part is blocked. Runs in the browser; nothing is sent anywhere
// except the test connections themselves.
//   1. game server     — the server online games are played on (config.js servers): can this network reach it?
//   2. matchmaking     — the PeerJS server that finds direct rooms (0.peerjs.com)
//   3. direct route    — a STUN answer over UDP (needed for direct player-to-player connections)
// (There is no relay any more: the owner removed Metered. Direct rooms — practice invites, or a room made when no game
// server answers — need tests 2 and 3; games on the game server only need test 1.)
/* global Peer */
import { CONFIG } from './config.js';

export const STEPS = [
  { id: 'server', label: 'Game server', what: 'Where online games are played' },
  { id: 'match', label: 'Matchmaking server', what: 'Finds direct rooms, e.g. a friend joining your practice game (0.peerjs.com)' },
  { id: 'direct', label: 'Direct connections', what: 'Connecting straight to the other player (UDP)' },
];
const gameServers = () => (CONFIG.serverUrl ? [{ name: 'Game server', url: CONFIG.serverUrl }] : (CONFIG.servers || []).filter(s => s && s.url));
// one game server's status page (a free cloud server that is asleep takes up to a minute to answer)
async function reachServer(srv, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(String(srv.url).replace(/^ws(s?):\/\//i, 'http$1://'), { cache: 'no-store', signal: ctl.signal });
    return res.ok && (await res.text()).includes('SITELINE server is running');
  } catch (e) { return false; } finally { clearTimeout(t); }
}

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

// Run every test. update(id, state, detail) is called as results come in; state is 'run' | 'ok' | 'fail' | 'skip'.
export async function runNetTest(update) {
  const R = {};
  const set = (id, state, detail = '') => { R[id] = { state, detail }; update(id, state, detail); };
  for (const s of STEPS) set(s.id, 'wait');

  // 1. the game server(s), side by side with the other two
  const list = gameServers();
  const serverCheck = (async () => {
    if (!list.length) { set('server', 'skip', 'No game server is set up in config.js'); return; }
    set('server', 'run');
    const ok = await Promise.all(list.map(s => reachServer(s, 60000)));
    const up = list.filter((s, i) => ok[i]).map(s => s.name);
    set('server', up.length ? 'ok' : 'fail', up.length ? `Reached ${up.join(', ')}` : 'No answer within a minute (blocked here, or the server is off)');
  })();

  // 2. matchmaking server
  set('match', 'run');
  const opts = { config: { iceServers: CONFIG.iceServers }, debug: 0 };
  if (CONFIG.peerServer) Object.assign(opts, CONFIG.peerServer);
  const matchCheck = openPeer(opts, 12000).then((a) => { set('match', 'ok', 'Reached'); a.destroy(); }, (e) => set('match', 'fail', `Blocked or no answer (${e.message})`));

  // 3. a direct route
  set('direct', 'run');
  const directCheck = gather([CONFIG.iceServers[0]], 'all', 'srflx', 6000).then((types) => {
    set('direct', types.has('srflx') ? 'ok' : 'fail', types.has('srflx') ? 'Got an answer over UDP' : 'No answer over UDP — direct connections are blocked');
  });
  await Promise.all([serverCheck, matchCheck, directCheck]);
  return R;
}

// A plain-language verdict from the results.
export function summarise(R) {
  const ok = (id) => R[id] && R[id].state === 'ok';
  const direct = ok('match') && ok('direct');
  const directNote = direct ? '' : ' Direct rooms (a friend joining your practice game, or a room made when the game server is down) may not connect on this Wi-Fi: it blocks ' + (ok('match') ? 'direct connections between players.' : 'the matchmaking server (0.peerjs.com).');
  if (ok('server')) return { good: true, text: `Online games work here: they go through the game server.${directNote}` };
  if (R.server && R.server.state === 'skip') {
    return direct ? { good: true, text: 'Everything the game needs gets through this Wi-Fi. If joining still fails, run this check on the other player\'s device too.' }
      : { good: false, text: `Joining rooms will fail or only work now and then here.${directNote}` };
  }
  return { good: false, text: `The game server didn't answer: this Wi-Fi may block it (the school's IT team would need to allow it), or it is switched off or still waking up — try again in a minute.${directNote}` };
}

// The results as plain text, to copy and send to whoever is fixing it.
export function resultsText(R) {
  const icon = { ok: 'OK', fail: 'BLOCKED', skip: 'skipped', run: '…', wait: '…' };
  const lines = STEPS.map(s => `${s.label}: ${icon[(R[s.id] || {}).state] || '?'}${R[s.id] && R[s.id].detail ? ` — ${R[s.id].detail}` : ''}`);
  return [`SITELINE connection check, ${new Date().toLocaleString()}`, ...lines, `Verdict: ${summarise(R).text}`, `Device: ${navigator.userAgent}`].join('\n');
}
