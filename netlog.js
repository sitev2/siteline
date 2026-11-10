// Connection log: every host / join attempt writes down each step (relay sign-in, matchmaking server,
// route search, errors, what the network let through) and keeps it on this device, so a failure on a
// school or work Wi-Fi can be looked at afterwards. Nothing is sent anywhere: the player copies it
// (Menu → Connection check → Copy everything, or "Copy details" under an error) and passes it on.
const KEY = 'siteline-netlog-v1';
const MAX_ENTRIES = 20, MAX_EVENTS = 250;

let entries = load();
const open = new Set();          // entries still being written (to note page hide/show, offline…)

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
let saveTimer = 0;
function save(now = false) {
  const write = () => { saveTimer = 0; try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) { /* storage full or blocked */ } };
  if (now) { clearTimeout(saveTimer); write(); } else if (!saveTimer) saveTimer = setTimeout(write, 300);
}

// Start a new log entry. kind: 'join' | 'host' | 'invite' | 'server'. Returns an object with
// .event(text) and .end(outcome, text); safe to call in any order and more than once.
export function startLog(kind, info = {}) {
  const e = {
    kind, at: new Date().toISOString(), t0: Date.now(), outcome: 'running', message: '', info: {
      ...info,
      online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
      device: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    }, events: [],
  };
  entries.push(e);
  while (entries.length > MAX_ENTRIES) entries.shift();
  open.add(e);
  save(true);
  return {
    entry: e,
    event(text) {
      if (e.events.length >= MAX_EVENTS) { if (e.events.length === MAX_EVENTS) e.events.push([Date.now() - e.t0, '… (more steps not saved)']); return; }
      e.events.push([Date.now() - e.t0, String(text).slice(0, 400)]);
      save();
    },
    // outcome: 'connected' (keeps listening for a later drop), 'failed', 'lost' or 'left'
    end(outcome, message = '') {
      const was = e.outcome;
      if (was !== 'running' && was !== 'connected') return;
      if (was === 'connected' && outcome === 'connected') return;
      if (outcome === 'left') { e.events.push([Date.now() - e.t0, 'left (closed by the player)']); if (was === 'running') e.outcome = 'left'; }
      else {
        e.outcome = was === 'connected' && outcome === 'lost' ? 'connected, then lost' : outcome;
        if (message) e.message = String(message).slice(0, 400);
        e.events.push([Date.now() - e.t0, `RESULT: ${e.outcome}${message ? ` — ${message}` : ''}`]);
      }
      if (e.outcome !== 'connected') open.delete(e);
      save(true);
    },
    close() { open.delete(e); save(true); },
  };
}

// note things that often explain a dropped connection on a tablet
if (typeof document !== 'undefined') {
  const note = (text) => { for (const e of open) { if (e.events.length < MAX_EVENTS) e.events.push([Date.now() - e.t0, text]); } if (open.size) save(); };
  document.addEventListener('visibilitychange', () => note(document.hidden ? 'page hidden (app switched, screen locked or tab changed)' : 'page visible again'));
  window.addEventListener('offline', () => note('device went offline'));
  window.addEventListener('online', () => note('device back online'));
}

// Watch one WebRTC connection: candidates found, state changes; returns a function that writes a
// summary of every route tried (from getStats) into the log.
export function watchRtc(log, pc, label = 'route search') {
  if (!pc || !log) return async () => {};
  const found = {};
  const on = (ev, fn) => { try { pc.addEventListener(ev, fn); } catch (e) { /* old browser */ } };
  on('icecandidate', (ev) => {
    if (!ev.candidate) { log.event(`${label}: this device found ${fmt(found) || 'no routes'}`); return; }
    const k = candKind(ev.candidate.candidate || '');
    found[k] = (found[k] || 0) + 1;
  });
  on('icegatheringstatechange', () => log.event(`${label}: looking for routes — ${pc.iceGatheringState}`));
  on('iceconnectionstatechange', () => log.event(`${label}: ICE ${pc.iceConnectionState}`));
  on('connectionstatechange', () => log.event(`${label}: connection ${pc.connectionState}`));
  // (nothing to report once the connection is closed: the browser has thrown its statistics away)
  return async () => { if (pc.signalingState !== 'closed') log.event(`${label}: ${await rtcReport(pc)}`); };
}

function candKind(c) {
  const typ = (/ typ ([a-z]+)/.exec(c) || [])[1] || '?';
  const proto = (/ (udp|tcp) /i.exec(c) || [])[1] || '';
  return `${typ}${proto ? '/' + proto.toLowerCase() : ''}`;
}
function fmt(counts) { return Object.entries(counts).map(([k, n]) => `${n}× ${k}`).join(', '); }

// What both sides offered and what came of each pairing, from the browser's own statistics.
export async function rtcReport(pc) {
  try {
    const st = await pc.getStats();
    const local = {}, remote = {}, pairs = {};
    let chosen = '';
    const byId = new Map();
    st.forEach(r => byId.set(r.id, r));
    st.forEach(r => {
      if (r.type === 'local-candidate') { const k = `${r.candidateType}/${r.relayProtocol || r.protocol}`; local[k] = (local[k] || 0) + 1; }
      if (r.type === 'remote-candidate') { const k = `${r.candidateType}/${r.protocol}`; remote[k] = (remote[k] || 0) + 1; }
      if (r.type === 'candidate-pair') {
        pairs[r.state] = (pairs[r.state] || 0) + 1;
        if (r.nominated && r.state === 'succeeded') {
          const l = byId.get(r.localCandidateId), m = byId.get(r.remoteCandidateId);
          chosen = `${l ? l.candidateType : '?'} → ${m ? m.candidateType : '?'}, round trip ${r.currentRoundTripTime != null ? Math.round(r.currentRoundTripTime * 1000) + ' ms' : '?'}`;
        }
      }
    });
    return `this device offered [${fmt(local) || 'nothing'}]; the other side offered [${fmt(remote) || 'nothing'}]; pairs tried [${fmt(pairs) || 'none'}]${chosen ? `; using ${chosen}` : '; no working pair'}`;
  } catch (e) { return `no statistics (${e && e.message})`; }
}

// ---------- reading it back ----------
export function logEntries() { return entries.slice().reverse(); }
export function clearLog() { entries = []; open.clear(); save(true); }

const KIND = { join: 'Join', host: 'Host', invite: 'Practice invite room', server: 'Game server' };
export function entryTitle(e) {
  const what = `${KIND[e.kind] || e.kind}${e.info && e.info.code ? ` ${e.info.code}` : ''}`;
  return `${new Date(e.at).toLocaleString()} — ${what} — ${e.outcome}`;
}
export function entryText(e) {
  const info = Object.entries(e.info || {}).filter(([k]) => k !== 'device').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  const lines = e.events.map(([t, text]) => `  ${(t / 1000).toFixed(1).padStart(6)} s  ${text}`);
  return [entryTitle(e), e.message ? `  Reason: ${e.message}` : null, info ? `  ${info}` : null, `  Device: ${e.info && e.info.device}`, ...lines].filter(Boolean).join('\n');
}
export function logText(list = logEntries()) {
  return list.length ? list.map(entryText).join('\n\n') : '(no connection attempts saved yet)';
}
