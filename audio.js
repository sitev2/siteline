// Synthesised sound — no audio files. Every sound is built in code the first time it's needed
// (layered noise, tones and filters rendered into little sample buffers), then played through:
//   • 3D positioning (you hear where things are, in front or behind), with distance fading
//   • air absorption (far sounds lose their top end) and muffling through walls
//   • a reverb made for each map (bigger indoors), and a limiter so loud moments don't distort
// Plus a quiet ambience bed for each map.
import { WEAPONS } from './weapons.js';

let ctx = null, master = null, comp = null, verbIn = null, verbOut = null, convolver = null, ambBus = null;
let volume = 0.7, ambVolume = 0.6;
const L = { x: 0, y: 0, z: 0 };           // where the listener is
let env = { wet: 0.2, indoor: 0 };         // reverb amount for this map, and how indoors you are
let active = 0;                            // sounds playing right now (to keep phones happy)
const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  // master → limiter → speakers
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.18;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(comp);
  // reverb send
  verbIn = ctx.createGain();
  convolver = ctx.createConvolver();
  verbOut = ctx.createGain();
  verbOut.gain.value = 1;
  verbIn.connect(convolver); convolver.connect(verbOut); verbOut.connect(master);
  convolver.buffer = impulse(1.1, 4000);
  ambBus = ctx.createGain();
  ambBus.gain.value = ambVolume * 0.85;
  ambBus.connect(master);
}

// background sound level (0 = off), separate from the main volume
export function setAmbienceVolume(v) {
  ambVolume = v;
  if (ambBus) ambBus.gain.value = v * 0.85;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

// ---------- the room ----------
// each map's acoustics: how long the reverb rings, how much of it, how bright
const ROOMS = {
  desert: { decay: 0.9, wet: 0.16, damp: 3200 },
  industrial: { decay: 2.1, wet: 0.3, damp: 5200 },
  snow: { decay: 0.75, wet: 0.13, damp: 2400 },
  harbour: { decay: 1.3, wet: 0.2, damp: 4200 },
  quarry: { decay: 1.7, wet: 0.26, damp: 3800 },
  railyard: { decay: 1.2, wet: 0.19, damp: 3800 },
  village: { decay: 1.4, wet: 0.22, damp: 4000 },   // narrow stone streets
  tuscan: { decay: 1.3, wet: 0.2, damp: 4200 },
};
let room = ROOMS.desert;
export function setRoom(theme) {
  if (!ctx) return;
  room = ROOMS[theme] || ROOMS.desert;
  convolver.buffer = impulse(room.decay, room.damp);
  env.wet = room.wet;
}
// 0 = out in the open, 1 = under a roof (more reverb)
export function setIndoor(k) { env.indoor = k; }

// a stereo impulse response: a few early reflections, then a decaying tail that gets darker
function impulse(decay, damp) {
  const sr = ctx.sampleRate, n = Math.floor(sr * Math.min(3, decay * 1.3));
  const b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const x = b.getChannelData(ch);
    for (let i = 0; i < n; i++) { const t = i / sr; x[i] = (Math.random() * 2 - 1) * Math.exp(-t * 6.9 / decay); }
    // the tail loses highs as it dies away: blend a dark copy in over time
    const dark = Float32Array.from(x); biquad(dark, 'lowpass', damp * 0.35, 0.7, sr);
    biquad(x, 'lowpass', damp, 0.7, sr);
    for (let i = 0; i < n; i++) { const k = Math.min(1, i / n * 2.2); x[i] = x[i] * (1 - k) + dark[i] * k * 1.3; }
    // early reflections
    for (let r = 0; r < 6; r++) {
      const at = Math.floor(sr * (0.006 + Math.random() * 0.045 + ch * 0.003)), g = 0.5 * Math.exp(-r * 0.35);
      for (let k = 0; k < 40 && at + k < n; k++) x[at + k] += (Math.random() * 2 - 1) * g * Math.exp(-k / 8);
    }
  }
  return b;
}

// ---------- the listener ----------
export function setListener(x, y, z, yaw, pitch) {
  if (!ctx) return;
  L.x = x; L.y = y; L.z = z;
  const li = ctx.listener;
  const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
  if (li.positionX) {
    const t = ctx.currentTime;
    li.positionX.setValueAtTime(x, t); li.positionY.setValueAtTime(y, t); li.positionZ.setValueAtTime(z, t);
    li.forwardX.setValueAtTime(fx, t); li.forwardY.setValueAtTime(fy, t); li.forwardZ.setValueAtTime(fz, t);
    li.upX.setValueAtTime(0, t); li.upY.setValueAtTime(1, t); li.upZ.setValueAtTime(0, t);
  } else {
    li.setPosition(x, y, z);
    li.setOrientation(fx, fy, fz, 0, 1, 0);
  }
}

// ---------- playing a buffer ----------
// o: { gain, pos: {x,y,z} (null = in your head), ref, roll (distance fading), air (metres for the
//      top end to fade), occ (0..1 behind walls), wet (reverb send), rate, when, lowpass, dest }
function play(buffer, o = {}) {
  if (!ctx || !buffer) return null;
  if (active > (isTouch ? 28 : 56) && !o.important) return null;
  const when = o.when || ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = o.rate || 1;
  let node = src;
  let gain = o.gain == null ? 1 : o.gain;
  let cutoff = o.lowpass || 22000;
  if (o.pos) {
    const d = Math.hypot(o.pos.x - L.x, o.pos.y - L.y, o.pos.z - L.z);
    cutoff = Math.min(cutoff, Math.max(500, 22000 * Math.exp(-d / (o.air || 40))));
    if (o.occ) { cutoff = Math.min(cutoff, 22000 - (22000 - 650) * o.occ); gain *= 1 - 0.5 * o.occ; }
  }
  if (cutoff < 18000) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5;
    node.connect(f); node = f;
  }
  const g = ctx.createGain();
  g.gain.value = gain;
  node.connect(g);
  let outNode = g;
  if (o.pos) {
    const p = ctx.createPanner();
    p.panningModel = isTouch ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref || 2; p.rolloffFactor = o.roll == null ? 1 : o.roll; p.maxDistance = 400;
    if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; }
    else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
    g.connect(p); outNode = p;
  }
  outNode.connect(o.dest || master);
  const wet = (o.wet == null ? 0.5 : o.wet) * env.wet * (1 + env.indoor * 0.9);
  if (wet > 0.001 && !o.dest) {
    const s = ctx.createGain(); s.gain.value = wet;
    outNode.connect(s); s.connect(verbIn);
  }
  active++;
  src.onended = () => { active--; try { src.disconnect(); } catch (e) { /* already gone */ } };
  src.start(when);
  return src;
}

// a run of sounds at set times that can be cancelled (reloads, bolt actions…)
function sequence(events, base = {}) {
  if (!ctx) return () => {};
  const t0 = ctx.currentTime, srcs = [];
  for (const [at, name, o] of events) {
    const b = typeof name === 'string' ? sound(name) : name;
    const s = play(b, { gain: 0.5, wet: 0.25, ...base, ...(o || {}), when: t0 + at, rate: 0.96 + Math.random() * 0.08 });
    if (s) srcs.push([s, t0 + at]);
  }
  return () => { const now = ctx.currentTime; for (const [s, at] of srcs) if (at > now) { try { s.stop(); } catch (e) { /* done */ } } };
}

// ---------- building sounds out of samples ----------
const rnd = () => Math.random() * 2 - 1;
function buf(seconds, fill, channels = 1) {
  const sr = ctx.sampleRate, n = Math.max(1, Math.floor(seconds * sr));
  const b = ctx.createBuffer(channels, n, sr);
  for (let c = 0; c < channels; c++) fill(b.getChannelData(c), sr, c);
  return b;
}
// RBJ biquad filters run over an array
function biquad(x, type, f, q, sr) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], y = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
// a band-passed noise burst whose centre frequency sweeps (scrapes, slides)
function sweepNoise(x, sr, at, dur, f0, f1, q, gain, decay = 0.4) {
  const n0 = Math.floor(at * sr), n = Math.floor(dur * sr);
  const tmp = new Float32Array(n);
  // filter in short blocks so the band can move
  const block = 128;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let b = 0; b < n; b += block) {
    const f = f0 * Math.pow(f1 / f0, b / n), w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    for (let i = b; i < Math.min(n, b + block); i++) {
      const t = i / n, e = Math.sin(Math.PI * Math.min(1, t / 0.15)) * (t < 0.15 ? 1 : Math.exp(-(t - 0.15) / decay));
      const xi = rnd() * e, y = (al * xi - al * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = xi; y2 = y1; y1 = y; tmp[i] = y;
    }
  }
  for (let i = 0; i < n && n0 + i < x.length; i++) x[n0 + i] += tmp[i] * gain;
}
// a short metallic click (band-passed impulse) at a time
function click(x, sr, at, f, q, gain, len = 0.012) {
  const n0 = Math.floor(at * sr), n = Math.floor(len * sr);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) tmp[i] = rnd() * Math.exp(-i / (n * 0.18));
  biquad(tmp, 'bandpass', f, q, sr);
  for (let i = 0; i < n && n0 + i < x.length; i++) x[n0 + i] += tmp[i] * gain * 3;
}
// decaying sine partials (bells, pings, metal)
function partials(x, sr, at, list, gain) {
  const n0 = Math.floor(at * sr);
  for (const [f, a, d] of list) {
    const ph = Math.random() * 6.28;
    for (let i = 0; n0 + i < x.length; i++) {
      const t = i / sr, e = Math.exp(-t / d);
      if (e < 0.001) break;
      x[n0 + i] += Math.sin(ph + 2 * Math.PI * f * t) * a * e * gain * Math.min(1, t / 0.0015);
    }
  }
}
// a low thump: a sine that drops in pitch
function thump(x, sr, at, f0, f1, dur, gain, drive = 1) {
  const n0 = Math.floor(at * sr);
  let ph = 0;
  for (let i = 0; n0 + i < x.length; i++) {
    const t = i / sr, e = Math.exp(-t / dur);
    if (e < 0.001) break;
    const f = f1 + (f0 - f1) * Math.exp(-t / (dur * 0.35));
    ph += 2 * Math.PI * f / sr;
    const v = Math.sin(ph) * e * Math.min(1, t / 0.002);
    x[n0 + i] += (drive > 1 ? Math.tanh(v * drive) / Math.tanh(drive) : v) * gain;
  }
}
// filtered noise with an attack/decay envelope
function noiseHit(x, sr, at, type, f, q, dur, gain, attack = 0.001) {
  const n0 = Math.floor(at * sr), n = Math.min(x.length - n0, Math.floor(dur * 6 * sr));
  if (n <= 0) return;
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; tmp[i] = rnd() * (t < attack ? t / attack : Math.exp(-(t - attack) / dur)); }
  biquad(tmp, type, f, q, sr);
  for (let i = 0; i < n; i++) x[n0 + i] += tmp[i] * gain;
}
// grains: lots of tiny clicks (crunching snow, gravel)
// little rising 'bloop's of air bubbles in water
function bubbles(x, sr, at, dur, count, gain) {
  for (let k = 0; k < count; k++) {
    const p = Math.floor((at + Math.random() * dur) * sr), f0 = 500 + Math.random() * 900, len = 0.012 + Math.random() * 0.02, a = gain * (0.4 + Math.random() * 0.6);
    let ph = 0;
    for (let i = 0; i < len * sr && p + i < x.length; i++) {
      const t = i / sr;
      ph += 6.283 * f0 * (1 + 1.4 * t / len) / sr;
      x[p + i] += Math.sin(ph) * a * Math.sin(Math.PI * t / len);
    }
  }
}
function grains(x, sr, at, dur, count, f, q, gain) {
  const tmp = new Float32Array(Math.floor((dur + 0.02) * sr));
  for (let k = 0; k < count; k++) {
    const p = Math.floor(Math.pow(Math.random(), 1.6) * dur * sr), a = Math.random() * (1 - p / tmp.length);
    for (let i = 0; i < 30 && p + i < tmp.length; i++) tmp[p + i] += rnd() * a * Math.exp(-i / 6);
  }
  biquad(tmp, 'bandpass', f, q, sr);
  const n0 = Math.floor(at * sr);
  for (let i = 0; i < tmp.length && n0 + i < x.length; i++) x[n0 + i] += tmp[i] * gain;
}
function normalize(x, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  // tiny fade-out so nothing clicks at the end
  const f = Math.min(x.length, 256);
  for (let i = 0; i < f; i++) x[x.length - 1 - i] *= i / f;
  return x;
}
// match loudness (not just the peak), keeping peaks under control
function normalizeRms(x, target, cap = 0.95) {
  let r = 0;
  for (let i = 0; i < x.length; i++) r += x[i] * x[i];
  r = Math.sqrt(r / x.length) || 1;
  for (let i = 0; i < x.length; i++) x[i] *= target / r;
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > cap) { softclip(x, 1.3); normalize(x, cap); }
  return x;
}
function softclip(x, drive) { const k = Math.tanh(drive); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / k; }

// ---------- the sound library (built on first use, then reused) ----------
const cache = new Map();
function sound(name, variants = 1) {
  const key = variants > 1 ? `${name}#${Math.floor(Math.random() * variants)}` : name;
  if (!cache.has(key)) cache.set(key, (MAKERS[name] || MAKERS.click)());
  return cache.get(key);
}
const MAKERS = {
  // mechanisms
  click: () => buf(0.05, (x, sr) => { click(x, sr, 0, 3200, 3, 0.8); click(x, sr, 0.012, 1900, 3, 0.5); normalize(x, 0.8); }),
  dry: () => buf(0.08, (x, sr) => { click(x, sr, 0, 2600, 4, 0.7, 0.008); click(x, sr, 0.035, 1500, 3, 0.5); noiseHit(x, sr, 0.035, 'lowpass', 600, 0.7, 0.01, 0.3); normalize(x, 0.7); }),
  magOut: () => buf(0.25, (x, sr) => { click(x, sr, 0, 2800, 5, 0.7); sweepNoise(x, sr, 0.02, 0.16, 1400, 3200, 2.5, 0.9); normalize(x, 0.8); }),
  magIn: () => buf(0.22, (x, sr) => { sweepNoise(x, sr, 0, 0.12, 1100, 2400, 2.5, 0.7); normalize(x, 0.6); }),
  magSeat: () => buf(0.15, (x, sr) => { click(x, sr, 0, 2400, 4, 1); click(x, sr, 0.006, 1300, 3, 0.7); thump(x, sr, 0, 220, 140, 0.03, 0.6); noiseHit(x, sr, 0, 'lowpass', 500, 0.7, 0.02, 0.4); normalize(x, 0.9); }),
  slap: () => buf(0.12, (x, sr) => { noiseHit(x, sr, 0, 'lowpass', 900, 0.7, 0.018, 1); thump(x, sr, 0, 160, 100, 0.03, 0.6); normalize(x, 0.7); }),
  magDrop: () => buf(0.45, (x, sr) => {
    for (const [at, a] of [[0, 1], [0.09, 0.55], [0.15, 0.3], [0.2, 0.15]]) { click(x, sr, at, 1500 + Math.random() * 900, 2.5, a); noiseHit(x, sr, at, 'lowpass', 400, 0.7, 0.015, a * 0.6); partials(x, sr, at, [[2300, 0.2, 0.03], [3700, 0.12, 0.02]], a); }
    normalize(x, 0.8);
  }),
  slideBack: () => buf(0.12, (x, sr) => { click(x, sr, 0, 2600, 4, 0.5); sweepNoise(x, sr, 0.005, 0.07, 3200, 2000, 3, 0.8); normalize(x, 0.7); }),
  slideSlam: () => buf(0.2, (x, sr) => { click(x, sr, 0, 3100, 4, 1); click(x, sr, 0.003, 1400, 3, 0.8); partials(x, sr, 0, [[2650, 0.25, 0.05], [4150, 0.18, 0.035], [6100, 0.1, 0.02]], 1); normalize(x, 0.9); }),
  handlePull: () => buf(0.16, (x, sr) => { click(x, sr, 0, 2200, 4, 0.6); click(x, sr, 0.03, 1800, 4, 0.4); sweepNoise(x, sr, 0.01, 0.1, 2400, 1500, 2.5, 0.8); click(x, sr, 0.1, 1600, 3, 0.6); normalize(x, 0.75); }),
  handleRelease: () => buf(0.22, (x, sr) => { sweepNoise(x, sr, 0, 0.03, 1500, 2600, 2, 0.5); click(x, sr, 0.03, 2300, 3, 1); click(x, sr, 0.034, 1100, 2.5, 0.9); partials(x, sr, 0.03, [[1850, 0.2, 0.06], [3300, 0.14, 0.04]], 1); thump(x, sr, 0.03, 180, 120, 0.03, 0.4); normalize(x, 0.9); }),
  boltLift: () => buf(0.08, (x, sr) => { click(x, sr, 0, 2100, 4, 0.8); click(x, sr, 0.02, 3000, 5, 0.4); normalize(x, 0.6); }),
  boltBack: () => buf(0.18, (x, sr) => { sweepNoise(x, sr, 0, 0.13, 2600, 1500, 2.5, 0.9); click(x, sr, 0.13, 1700, 3, 0.8); normalize(x, 0.75); }),
  boltForward: () => buf(0.16, (x, sr) => { sweepNoise(x, sr, 0, 0.11, 1500, 2700, 2.5, 0.9); click(x, sr, 0.11, 2200, 3, 0.7); normalize(x, 0.75); }),
  boltLock: () => buf(0.14, (x, sr) => { click(x, sr, 0, 2600, 4, 1); click(x, sr, 0.004, 1200, 3, 0.7); partials(x, sr, 0, [[2400, 0.2, 0.04]], 1); normalize(x, 0.85); }),
  pumpBack: () => buf(0.16, (x, sr) => { click(x, sr, 0, 1600, 3, 0.8); sweepNoise(x, sr, 0.005, 0.1, 1300, 800, 2, 1); thump(x, sr, 0.09, 150, 110, 0.03, 0.5); normalize(x, 0.85); }),
  pumpForward: () => buf(0.18, (x, sr) => { sweepNoise(x, sr, 0, 0.08, 800, 1400, 2, 0.9); click(x, sr, 0.08, 2100, 3, 1); click(x, sr, 0.085, 1000, 2.5, 0.8); thump(x, sr, 0.08, 170, 110, 0.04, 0.5); normalize(x, 0.9); }),
  shellIn: () => buf(0.2, (x, sr) => { click(x, sr, 0, 2800, 4, 0.6); sweepNoise(x, sr, 0.01, 0.06, 1600, 2300, 2.5, 0.6); click(x, sr, 0.07, 1700, 3, 0.9); thump(x, sr, 0.07, 200, 130, 0.03, 0.4); normalize(x, 0.8); }),
  rustle: () => buf(0.3, (x, sr) => { sweepNoise(x, sr, 0, 0.25, 2500, 4500, 0.7, 0.8, 0.6); normalize(x, 0.4); }),
  // bullets hitting you, your hits on others
  hitBody: () => buf(0.12, (x, sr) => { noiseHit(x, sr, 0, 'bandpass', 1700, 1.4, 0.02, 1); thump(x, sr, 0, 260, 160, 0.03, 0.6); normalize(x, 0.8); }),
  hitHead: () => buf(0.3, (x, sr) => { click(x, sr, 0, 4000, 3, 0.5); partials(x, sr, 0, [[2650, 0.6, 0.09], [4120, 0.45, 0.065], [5930, 0.25, 0.045], [8100, 0.12, 0.03]], 1); normalize(x, 0.85); }),
  kill: () => buf(0.35, (x, sr) => { thump(x, sr, 0, 190, 90, 0.09, 1, 2); noiseHit(x, sr, 0, 'lowpass', 700, 0.7, 0.04, 0.5); partials(x, sr, 0.02, [[1320, 0.12, 0.14], [1980, 0.08, 0.1]], 1); normalize(x, 0.9); }),
  killHead: () => buf(0.45, (x, sr) => { thump(x, sr, 0, 210, 100, 0.09, 1, 2); partials(x, sr, 0, [[2650, 0.35, 0.18], [4120, 0.25, 0.12]], 1); partials(x, sr, 0.05, [[1760, 0.14, 0.18], [2640, 0.08, 0.12]], 1); normalize(x, 0.9); }),
  hurt: () => buf(0.3, (x, sr) => { noiseHit(x, sr, 0, 'lowpass', 520, 0.8, 0.07, 1); thump(x, sr, 0, 120, 70, 0.1, 0.9, 2); partials(x, sr, 0.01, [[230, 0.15, 0.15]], 1); normalize(x, 0.9); }),
  // the bomb
  beep: () => buf(0.12, (x, sr) => { for (let i = 0; i < x.length; i++) { const t = i / sr, e = t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / 0.035); const ph = 2 * Math.PI * 1950 * t; x[i] = (Math.sin(ph) * 0.8 + Math.sign(Math.sin(ph)) * 0.15) * e; } normalize(x, 0.8); }),
  keypad: () => buf(0.12, (x, sr) => { const pairs = [[697, 1209], [770, 1336], [852, 1477], [941, 1336], [697, 1477], [852, 1209]]; const [a, b] = pairs[Math.floor(Math.random() * pairs.length)]; for (let i = 0; i < x.length; i++) { const t = i / sr, e = Math.min(1, t / 0.003) * (t < 0.07 ? 1 : Math.exp(-(t - 0.07) / 0.01)); x[i] = (Math.sin(6.283 * a * t) + Math.sin(6.283 * b * t)) * 0.5 * e; } click(x, sr, 0, 3000, 3, 0.2); normalize(x, 0.7); }),
  defuse: () => buf(0.15, (x, sr) => { click(x, sr, 0, 3400, 4, 0.8); noiseHit(x, sr, 0.03, 'highpass', 5500, 0.7, 0.008, 0.5); click(x, sr, 0.05, 1800, 3, 0.4); normalize(x, 0.6); }),
  explosion: () => buf(3.6, (x, sr) => {
    noiseHit(x, sr, 0, 'highpass', 1500, 0.7, 0.004, 0.8);             // crack
    thump(x, sr, 0, 70, 26, 0.9, 1.6, 3);                              // the big boom
    noiseHit(x, sr, 0, 'lowpass', 240, 0.7, 1.3, 2.2, 0.01);           // rumble
    noiseHit(x, sr, 0, 'lowpass', 1300, 0.7, 0.32, 1.1, 0.002);        // blast
    for (let k = 0; k < 70; k++) {                                     // debris pattering down
      const at = 0.25 + Math.pow(Math.random(), 1.5) * 2.2;
      click(x, sr, at, 1500 + Math.random() * 3000, 2, 0.12 * Math.exp(-(at - 0.25) / 1.2));
    }
    softclip(x, 1.4); normalize(x, 0.95);
  }),
  // menus and round events
  buy: () => buf(0.3, (x, sr) => { partials(x, sr, 0, [[1046, 0.6, 0.06], [2093, 0.2, 0.04]], 1); partials(x, sr, 0.07, [[1568, 0.6, 0.1], [3136, 0.2, 0.06]], 1); noiseHit(x, sr, 0.07, 'highpass', 7000, 0.7, 0.04, 0.15); normalize(x, 0.6); }),
  deny: () => buf(0.2, (x, sr) => { for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = Math.sign(Math.sin(6.283 * 196 * t)) * Math.exp(-t / 0.08) * Math.min(1, t / 0.004); } biquad(x, 'lowpass', 1200, 0.7, sr); normalize(x, 0.5); }),
  chimeUp: () => buf(0.9, (x, sr) => { const bell = (at, f) => partials(x, sr, at, [[f, 0.6, 0.35], [f * 2.76, 0.2, 0.18], [f * 5.4, 0.08, 0.08]], 1); bell(0, 659); bell(0.11, 988); normalize(x, 0.55); }),
  chimeDown: () => buf(0.9, (x, sr) => { const bell = (at, f) => partials(x, sr, at, [[f, 0.6, 0.35], [f * 2.76, 0.2, 0.18], [f * 5.4, 0.08, 0.08]], 1); bell(0, 523); bell(0.12, 392); normalize(x, 0.55); }),
  ui: () => buf(0.05, (x, sr) => { partials(x, sr, 0, [[1800, 0.5, 0.012]], 1); click(x, sr, 0, 3500, 2, 0.2); normalize(x, 0.5); }),
  // the spoon: a swing through the air, a ringing bonk on a body, a clink on a wall
  swoosh: () => buf(0.26, (x, sr) => { sweepNoise(x, sr, 0, 0.2, 500, 2600, 1.6, 1, 0.5); sweepNoise(x, sr, 0.03, 0.16, 2400, 900, 2.2, 0.5, 0.5); normalize(x, 0.6); }),
  spoonHit: () => buf(0.6, (x, sr) => { thump(x, sr, 0, 240, 130, 0.05, 0.9, 2); noiseHit(x, sr, 0, 'lowpass', 900, 0.7, 0.025, 0.6); const f = 1480 + Math.random() * 120; partials(x, sr, 0.004, [[f, 0.55, 0.16], [f * 2.71, 0.35, 0.11], [f * 5.2, 0.18, 0.06]], 1); normalize(x, 0.9); }),
  spoonWall: () => buf(0.35, (x, sr) => { click(x, sr, 0, 3200, 3, 0.8); const f = 2300 + Math.random() * 300; partials(x, sr, 0, [[f, 0.5, 0.07], [f * 2.4, 0.3, 0.045], [f * 4.1, 0.15, 0.025]], 1); noiseHit(x, sr, 0, 'lowpass', 700, 0.7, 0.012, 0.4); normalize(x, 0.7); }),
  // a dropped gun hitting the floor
  drop: () => buf(0.4, (x, sr) => { thump(x, sr, 0, 160, 90, 0.04, 0.7); noiseHit(x, sr, 0, 'lowpass', 700, 0.7, 0.03, 0.6); for (const [at, a] of [[0, 0.8], [0.1, 0.4], [0.17, 0.2]]) { click(x, sr, at, 1200 + Math.random() * 1200, 2, a); partials(x, sr, at, [[1700, 0.15, 0.04], [2900, 0.1, 0.03]], a); } normalize(x, 0.8); }),
  casing: () => buf(0.25, (x, sr) => { const f = 4200 + Math.random() * 1500; for (const [at, a] of [[0, 1], [0.06 + Math.random() * 0.03, 0.5], [0.12, 0.2]]) partials(x, sr, at, [[f, 0.5 * a, 0.03], [f * 1.63, 0.3 * a, 0.02], [f * 2.4, 0.15 * a, 0.012]], 1); normalize(x, 0.6); }),
};

// footsteps by surface (a few variations of each)
const STEP = {
  sand: (x, sr) => { noiseHit(x, sr, 0, 'lowpass', 900, 0.7, 0.03, 1, 0.006); grains(x, sr, 0, 0.06, 30, 2800, 1, 0.5); },
  gravel: (x, sr) => { noiseHit(x, sr, 0, 'lowpass', 1500, 0.7, 0.025, 0.7, 0.004); grains(x, sr, 0, 0.08, 70, 2400, 0.8, 1.2); },
  snow: (x, sr) => { noiseHit(x, sr, 0, 'lowpass', 300, 0.7, 0.025, 0.6, 0.004); grains(x, sr, 0, 0.1, 110, 3400, 1.4, 1.4); partials(x, sr, 0.02, [[1150 + Math.random() * 300, 0.04, 0.03]], 1); },
  hard: (x, sr) => { noiseHit(x, sr, 0, 'lowpass', 700, 0.7, 0.012, 1); thump(x, sr, 0, 150, 100, 0.02, 0.5); noiseHit(x, sr, 0.045, 'bandpass', 2200, 2, 0.008, 0.6); },
  metal: (x, sr) => { thump(x, sr, 0, 140, 90, 0.03, 0.8); partials(x, sr, 0, [[420 + Math.random() * 40, 0.3, 0.07], [1030, 0.2, 0.05], [1870, 0.12, 0.035], [2950, 0.08, 0.025]], 1); noiseHit(x, sr, 0, 'bandpass', 3000, 2, 0.006, 0.5); },
  wood: (x, sr) => { thump(x, sr, 0, 210, 170, 0.05, 0.7); partials(x, sr, 0, [[430, 0.3, 0.035], [910, 0.12, 0.02]], 1); noiseHit(x, sr, 0, 'bandpass', 900, 1.5, 0.02, 0.5); },
  // wading: a sloshing push through the water, a splash, droplets and bubbles
  water: (x, sr) => {
    noiseHit(x, sr, 0, 'lowpass', 650, 0.7, 0.09, 0.9, 0.03);
    noiseHit(x, sr, 0.03, 'bandpass', 1900 + Math.random() * 600, 0.9, 0.07, 0.7, 0.012);
    grains(x, sr, 0.05, 0.16, 26, 3600, 1.2, 0.9);
    bubbles(x, sr, 0.04, 0.16, 6, 0.25);
    thump(x, sr, 0, 120, 80, 0.05, 0.3);
  },
};
function stepBuffer(surface, land) {
  const key = `${land ? 'land' : 'step'}:${surface}#${Math.floor(Math.random() * 4)}`;
  if (!cache.has(key)) {
    cache.set(key, buf(land ? 0.45 : surface === 'water' ? 0.38 : 0.3, (x, sr) => {
      (STEP[surface] || STEP.hard)(x, sr);
      if (land) { thump(x, sr, 0, 110, 55, 0.09, 1, 2); noiseHit(x, sr, 0.01, 'bandpass', 2600, 1, 0.05, 0.25); (STEP[surface] || STEP.hard)(x, sr); }
      normalizeRms(x, land ? 0.15 : 0.11);
    }));
  }
  return cache.get(key);
}

// ---------- gunshots ----------
// layered: a sharp crack, the body of the bang, a low thump with some grit, the gun's action,
// and a short outdoor tail. Built per gun (3 variations each) from its sound settings in weapons.js.
const MECH = { glock: 'slide', usp: 'slide', deagle: 'slide', tec9: 'handle', mac10: 'handle', mp9: 'handle', mag7: 'pump', xm1014: 'shell', galil: 'handle', ak47: 'handle', m4a4: 'ar', m4a1s: 'ar', ssg08: 'bolt', awp: 'bolt' };
function gunBuffer(w, silenced) {
  const s = w.sound, type = w.type;
  const big = { sniper: 1, shotgun: 0.85, rifle: 0.6, smg: 0.4, pistol: 0.3 }[type] || 0.5;
  const j = (v, k = 0.06) => v * (1 + (Math.random() - 0.5) * 2 * k);
  if (silenced) {
    return buf(0.4, (x, sr) => {
      noiseHit(x, sr, 0, 'highpass', 4500, 0.7, 0.002, 0.25);
      noiseHit(x, sr, 0, 'bandpass', j(1700), 0.9, 0.03, 1);
      thump(x, sr, 0, j(240), 110, 0.05, 0.7);
      noiseHit(x, sr, 0.004, 'lowpass', 900, 0.7, 0.06, 0.25);
      if (type === 'pistol') { click(x, sr, 0.03, 2800, 5, 0.22); click(x, sr, 0.07, 2200, 5, 0.18); }
      else click(x, sr, 0.025, 1700, 4, 0.2);
      normalize(x, 0.9);
    });
  }
  const dur = Math.min(1.5, s.decay * 2.2 + 0.25 + big * 0.4);
  return buf(dur, (x, sr) => {
    const n = x.length;
    // crack
    noiseHit(x, sr, 0, 'highpass', 2200, 0.7, 0.0012, 1.1);
    // body: a resonant bang and a broad blast
    noiseHit(x, sr, 0, 'bandpass', j(s.freq), 1.1, j(s.decay * 0.45, 0.1), 1.6, 0.0015);
    noiseHit(x, sr, 0, 'lowpass', j(s.freq * 2.6), 0.7, j(s.decay * 0.35, 0.1), 0.9, 0.0008);
    // a short punch of low end (not a ringing tone) and a chesty mid thud
    thump(x, sr, 0, j(s.thump * 2.4), s.thump, 0.026 + big * 0.06, 0.9 + big * 0.6, 1.8);
    noiseHit(x, sr, 0, 'lowpass', 520, 0.7, 0.025 + big * 0.04, 0.9 + big * 0.5, 0.001);
    // short tail (the bang bouncing back off the world)
    const tail = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr; tail[i] = t < 0.012 ? 0 : rnd() * Math.exp(-(t - 0.012) / (0.1 + big * 0.35)) * Math.min(1, (t - 0.012) / 0.02); }
    biquad(tail, 'lowpass', 500 + big * 300, 0.7, sr);
    for (let i = 0; i < n; i++) x[i] += tail[i] * (0.4 + big * 0.5);
    // the action cycling
    const m = MECH[w.id];
    if (m === 'slide') { click(x, sr, 0.03, 2900, 5, 0.12); click(x, sr, 0.065, 2300, 5, 0.1); }
    else if (m === 'handle' || m === 'ar') click(x, sr, 0.022, 1600, 4, 0.1);
    softclip(x, 1.5);
    normalize(x, 0.95);
  });
}
function gunSound(id, silenced) {
  const key = `gun:${id}:${silenced ? 1 : 0}#${Math.floor(Math.random() * 3)}`;
  if (!cache.has(key)) cache.set(key, gunBuffer(WEAPONS[id], silenced));
  return cache.get(key);
}
// build a gun's sounds ahead of time (so the first shot doesn't stutter)
export function warmGun(id) {
  if (!ctx || !WEAPONS[id]) return;
  const w = WEAPONS[id];
  for (let v = 0; v < 3; v++) {
    const key = `gun:${id}:${w.silenced ? 1 : 0}#${v}`;
    if (!cache.has(key)) cache.set(key, gunBuffer(w, !!w.silenced));
  }
}

// opts: { pos (null for your own gun), silenced, occ (0..1 behind walls) }
export function playShot(weaponId, opts = {}) {
  if (!ctx) return;
  const w = WEAPONS[weaponId]; if (!w) return;
  const silenced = !!opts.silenced;
  const b = gunSound(weaponId, silenced);
  const loud = w.sound.gain;
  if (!opts.pos) {
    play(b, { gain: loud * 0.8, wet: 0.7, rate: 0.97 + Math.random() * 0.06, important: true });
    return;
  }
  const d = Math.hypot(opts.pos.x - L.x, opts.pos.z - L.z);
  play(b, { pos: opts.pos, gain: loud * 1.4, ref: silenced ? 2 : 4, roll: silenced ? 1.6 : 0.75, air: silenced ? 18 : 55, occ: opts.occ, wet: 0.8, rate: 0.97 + Math.random() * 0.06, important: true });
  // far-off shots roll back off the world a moment later
  if (!silenced && d > 22) {
    play(b, { pos: opts.pos, gain: loud * 0.8, ref: 6, roll: 0.5, lowpass: 450, occ: opts.occ, wet: 1.4, rate: 0.9, when: ctx.currentTime + 0.1 + d / 140 });
  }
}

// opts: { pos, surface, occ, walk } — no pos for your own feet
export function playStep(opts = {}) {
  if (!ctx) return;
  const b = stepBuffer(opts.surface || 'hard', false);
  if (!opts.pos) { play(b, { gain: 0.22, wet: 0.15, rate: 0.92 + Math.random() * 0.16 }); return; }
  play(b, { pos: opts.pos, gain: 1.1, ref: 1.5, roll: 1.5, air: 25, occ: opts.occ, wet: 0.3, rate: 0.92 + Math.random() * 0.16 });
}
export function playLand(opts = {}) {
  if (!ctx) return;
  const b = stepBuffer(opts.surface || 'hard', true);
  const k = 0.5 + (opts.hard || 0) * 0.5;
  if (!opts.pos) { play(b, { gain: 0.35 * k, wet: 0.2 }); return; }
  play(b, { pos: opts.pos, gain: 1.3 * k, ref: 1.5, roll: 1.3, air: 25, occ: opts.occ, wet: 0.35 });
}

// ---------- weapon handling, in time with the animations (see anim.js) ----------
// returns a function that cancels whatever hasn't played yet
export function reloadSequence(weaponId, empty) {
  const w = WEAPONS[weaponId]; if (!w || !ctx) return () => {};
  const R = w.reload, m = MECH[weaponId];
  if (m === 'shell') return sequence([[0.32 * R, 'rustle', { gain: 0.15 }], [0.74 * R, 'shellIn', { gain: 0.6 }]]);
  const ev = [
    [0.15 * R, 'click', { gain: 0.45 }],
    [0.19 * R, 'magOut', { gain: 0.5 }],
    [0.4 * R, 'magDrop', { gain: 0.22, lowpass: 3500 }],
    [0.45 * R, 'rustle', { gain: 0.15 }],
    [0.555 * R, 'magIn', { gain: 0.5 }],
    [0.612 * R, 'magSeat', { gain: 0.65 }],
    [0.635 * R, 'slap', { gain: 0.35 }],
  ];
  if (empty) {
    if (m === 'slide') ev.push([0.745 * R, 'slideBack', { gain: 0.5 }], [0.79 * R, 'slideSlam', { gain: 0.65 }]);
    else if (m === 'ar') ev.push([0.73 * R, 'slap', { gain: 0.4 }], [0.737 * R, 'handleRelease', { gain: 0.6 }]);
    else if (m === 'pump') ev.push([0.75 * R, 'pumpBack', { gain: 0.6 }], [0.83 * R, 'pumpForward', { gain: 0.65 }]);
    else if (m === 'bolt') ev.push([0.745 * R, 'boltLift', { gain: 0.5 }], [0.765 * R, 'boltBack', { gain: 0.5 }], [0.8 * R, 'boltForward', { gain: 0.5 }], [0.83 * R, 'boltLock', { gain: 0.6 }]);
    else ev.push([0.745 * R, 'handlePull', { gain: 0.55 }], [0.79 * R, 'handleRelease', { gain: 0.65 }]);
  }
  return sequence(ev);
}
// working a bolt-action rifle after a shot
export function boltSequence(weaponId) {
  const w = WEAPONS[weaponId]; if (!w) return () => {};
  const I = w.interval;
  return sequence([[0.15 * I, 'boltLift', { gain: 0.55 }], [0.27 * I, 'boltBack', { gain: 0.55 }], [0.5 * I, 'boltForward', { gain: 0.55 }], [0.66 * I, 'boltLock', { gain: 0.65 }]]);
}
// the MAG-7's pump after a shot
export function pumpSequence(weaponId) {
  const w = WEAPONS[weaponId]; if (!w) return () => {};
  return sequence([[0.12, 'pumpBack', { gain: 0.6 }], [0.12 + w.interval * 0.7 * 0.55, 'pumpForward', { gain: 0.65 }]]);
}
// pulling a gun out
export function playEquip(weaponId) {
  if (!ctx) return;
  if (weaponId === 'spoon') { sequence([[0, 'rustle', { gain: 0.2 }], [0.16, 'spoonWall', { gain: 0.16 }]]); return; }
  const m = MECH[weaponId];
  if (weaponId) warmGun(weaponId);
  if (m === 'slide') sequence([[0, 'rustle', { gain: 0.15 }], [0.25, 'slideBack', { gain: 0.35 }], [0.32, 'slideSlam', { gain: 0.4 }]]);
  else if (m === 'bolt') sequence([[0, 'rustle', { gain: 0.2 }], [0.3, 'boltLock', { gain: 0.4 }]]);
  else if (m === 'pump') sequence([[0, 'rustle', { gain: 0.2 }], [0.3, 'pumpForward', { gain: 0.35 }]]);
  else if (m) sequence([[0, 'rustle', { gain: 0.2 }], [0.3, 'handleRelease', { gain: 0.35 }]]);
  else sequence([[0, 'rustle', { gain: 0.25 }]]);
}
// the spoon. opts: { pos (null for your own), occ }
function spoonSound(name, opts, gain) {
  const o = opts || {};
  play(sound(name), o.pos ? { pos: o.pos, gain: gain * 1.6, ref: 1.5, roll: 1.3, air: 25, occ: o.occ, wet: 0.3, rate: 0.95 + Math.random() * 0.1 }
    : { gain, wet: 0.15, rate: 0.95 + Math.random() * 0.1 });
}
export function playSwing(opts) { spoonSound('swoosh', opts, 0.4); }
export function playSpoonHit(opts) { spoonSound('spoonHit', opts, 0.6); }
export function playSpoonWall(opts) { spoonSound('spoonWall', opts, 0.4); }
export function playDryFire() { play(sound('dry'), { gain: 0.5, wet: 0.2 }); }
export function playReload() { play(sound('magOut'), { gain: 0.4 }); }   // (kept for anything still calling it)
export function playBolt() { play(sound('boltBack'), { gain: 0.4 }); }

// ---------- feedback ----------
export function playHit(head) { play(sound(head ? 'hitHead' : 'hitBody'), { gain: head ? 0.5 : 0.45, wet: 0.05, important: true }); }
export function playKill(head) { play(sound(head ? 'killHead' : 'kill'), { gain: 0.55, wet: 0.1, important: true }); }
export function playHurt() { play(sound('hurt'), { gain: 0.6, wet: 0.05, important: true }); }

// ---------- the bomb ----------
export function playBeep(pos) { play(sound('beep'), { pos, gain: 1.2, ref: 3, roll: 0.9, air: 45, wet: 0.6, important: true }); }
export function playKeypad(pos) { play(sound('keypad'), { pos, gain: 0.7, ref: 1.5, roll: 1.2, air: 30, wet: 0.4 }); }
export function playDefuseTick(pos) { play(sound('defuse'), { pos, gain: 0.7, ref: 1.5, roll: 1.2, air: 30, wet: 0.35 }); }
export function playExplosion(pos) {
  if (!ctx) return;
  const b = sound('explosion');
  play(b, { pos, gain: 2.6, ref: 8, roll: 0.45, air: 140, wet: 1.4, important: true });
  // its echo off the surroundings
  if (pos) play(b, { pos, gain: 0.9, ref: 10, roll: 0.4, lowpass: 380, wet: 2, when: ctx.currentTime + 0.25 + Math.hypot(pos.x - L.x, pos.z - L.z) / 160, rate: 0.85 });
}

// ---------- menus / round events ----------
export function playBuy() { play(sound('buy'), { gain: 0.45, wet: 0 }); }
export function playDeny() { play(sound('deny'), { gain: 0.45, wet: 0 }); }
export function playChime(up = true) { play(sound(up ? 'chimeUp' : 'chimeDown'), { gain: 0.55, wet: 0.3 }); }
export function playClick() { play(sound('ui'), { gain: 0.5, wet: 0 }); }
export function playDrop(pos) { play(sound('drop'), { pos, gain: pos ? 1 : 0.4, ref: 1.5, roll: 1.2, air: 30, wet: 0.3, when: ctx ? ctx.currentTime + 0.28 : 0 }); }
export function playCasing(pos) { play(sound('casing'), { pos, gain: 0.25, ref: 1, roll: 1.5, air: 15, wet: 0.15, rate: 0.9 + Math.random() * 0.2 }); }

// ---------- ambience ----------
// a quiet looping bed for each map plus the odd distant sound
let amb = null;
const AMB = {
  desert: { wind: 0.6, windTone: 420, events: ['bird', 'bird', 'gust'] },
  industrial: { wind: 0.25, windTone: 300, hum: 0.5, events: ['clank', 'hiss', 'clank'] },
  snow: { wind: 1, windTone: 650, events: ['gust', 'gust', 'creak'] },
  harbour: { wind: 0.35, windTone: 380, water: 0.7, events: ['gull', 'gull', 'horn', 'gull'] },
  quarry: { wind: 0.55, windTone: 450, events: ['beeper', 'clank', 'gust'] },
  railyard: { wind: 0.4, windTone: 400, events: ['horn', 'clank', 'clank', 'bird'] },
  village: { wind: 0.3, windTone: 380, water: 0.35, lap: 0.6, events: ['bird', 'bell', 'bird', 'bird', 'bell', 'gust'] },
  tuscan: { wind: 0.35, windTone: 400, events: ['bird', 'bird', 'bell', 'gust', 'bird'] },
};
function ambienceBed(a, night) {
  const secs = 10;
  return buf(secs + 1, (x, sr, ch) => {
    const n = x.length;
    // wind: brownish noise, slowly swelling, its pitch drifting
    if (a.wind) {
      const w = new Float32Array(n);
      let y = 0;
      for (let i = 0; i < n; i++) { y = (y + rnd() * 0.08) * 0.995; w[i] = y; }
      biquad(w, 'lowpass', a.windTone * (night ? 0.8 : 1), 0.8, sr);
      const p1 = Math.random() * 6, p2 = Math.random() * 6;
      for (let i = 0; i < n; i++) { const t = i / sr; x[i] += w[i] * a.wind * 3 * (0.55 + 0.3 * Math.sin(t * 0.63 + p1 + ch) + 0.15 * Math.sin(t * 1.7 + p2)); }
    }
    if (a.hum) for (let i = 0; i < n; i++) { const t = i / sr; x[i] += (Math.sin(6.283 * 60 * t) * 0.5 + Math.sin(6.283 * 120 * t) * 0.3 + Math.sin(6.283 * 180 * t + ch) * 0.12) * a.hum * 0.08; }
    if (a.water) {
      const w = new Float32Array(n);
      for (let i = 0; i < n; i++) w[i] = rnd();
      biquad(w, 'lowpass', 420, 0.7, sr);
      for (let i = 0; i < n; i++) { const t = i / sr; x[i] += w[i] * a.water * 0.5 * Math.pow(0.5 + 0.5 * Math.sin(t * 1.9 + ch * 1.3 + Math.sin(t * 0.7) * 2), 2); }
    }
    // water lapping against the stone edges of the canals
    if (a.lap) {
      for (let k = 0; k < secs * 2.2; k++) {
        const at = Math.random() * (secs - 0.3), f = 380 + Math.random() * 500;
        noiseHit(x, sr, at, 'bandpass', f, 1.6, 0.05 + Math.random() * 0.07, 0.35 * a.lap * (0.5 + Math.random() * 0.5), 0.012);
        if (Math.random() < 0.35) bubbles(x, sr, at + 0.03, 0.1, 2, 0.04 * a.lap);
      }
    }
    // crickets at night (not in the snow or the steel works)
    if (night && !a.hum && a.windTone < 600) {
      for (let c = 0; c < 9; c++) {
        const at = Math.random() * secs, f = 4300 + Math.random() * 600;
        for (let p = 0; p < 6; p++) partials(x, sr, at + p * 0.045, [[f, 0.012, 0.012]], 1);
      }
    }
    // make the end flow back into the start
    const f = sr;
    for (let i = 0; i < f; i++) { const k = i / f; x[i] = x[i] * k + x[n - f + i] * (1 - k); }
    normalizeRms(x, 0.1, 0.6);
  }, 2);
}
const AMB_EVENT = {
  bird: () => buf(0.8, (x, sr) => { let at = 0; for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) { const f = 2600 + Math.random() * 1500; for (let i = 0; i < 0.08 * sr; i++) { const t = i / sr; x[Math.floor(at * sr) + i] += Math.sin(6.283 * (f + 900 * Math.sin(t * 60)) * t) * Math.sin(Math.PI * t / 0.08) * 0.5; } at += 0.12 + Math.random() * 0.08; } normalize(x, 0.5); }),
  gull: () => buf(1.2, (x, sr) => { let at = 0; for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) { const d = 0.22 + Math.random() * 0.12; for (let i = 0; i < d * sr; i++) { const t = i / sr, f = 1500 - 700 * (t / d) + 200 * Math.sin(t * 90); x[Math.floor(at * sr) + i] += (Math.sin(6.283 * f * t) + 0.4 * Math.sin(6.283 * 2 * f * t)) * Math.sin(Math.PI * t / d) * 0.4; } at += d + 0.06; } biquad(x, 'bandpass', 1600, 0.6, sr); normalize(x, 0.5); }),
  horn: () => buf(2.4, (x, sr) => { for (let i = 0; i < x.length; i++) { const t = i / sr, e = Math.min(1, t / 0.15) * (t < 1.8 ? 1 : Math.exp(-(t - 1.8) / 0.15)); let v = 0; for (let h = 1; h < 8; h++) v += Math.sin(6.283 * 110 * h * t) / h; x[i] = v * e * 0.4; } biquad(x, 'lowpass', 700, 0.7, sr); normalize(x, 0.5); }),
  clank: () => buf(1.2, (x, sr) => { partials(x, sr, 0, [[310 + Math.random() * 80, 0.5, 0.5], [780, 0.3, 0.35], [1440, 0.2, 0.2], [2310, 0.12, 0.12]], 1); noiseHit(x, sr, 0, 'lowpass', 800, 0.7, 0.03, 0.5); normalize(x, 0.5); }),
  hiss: () => buf(1.4, (x, sr) => { noiseHit(x, sr, 0, 'highpass', 3000, 0.7, 0.4, 0.6, 0.1); normalize(x, 0.35); }),
  beeper: () => buf(2.2, (x, sr) => { for (let p = 0; p < 4; p++) partials(x, sr, p * 0.5, [[1180, 0.5, 0.18]], 1); normalize(x, 0.4); }),
  gust: () => buf(2.5, (x, sr) => { sweepNoise(x, sr, 0, 2.4, 300, 900, 0.8, 1, 0.5); normalize(x, 0.5); }),
  // a church bell tolling a few times across the rooftops (bell partials: hum, prime, minor third, fifth, nominal)
  bell: () => buf(9, (x, sr) => {
    const f = 196 * Math.pow(2, Math.floor(Math.random() * 5) / 12), tolls = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < tolls; k++) {
      const at = k * 1.9, a = k ? 0.9 : 1;
      partials(x, sr, at, [[f * 0.5, 0.5 * a, 2.6], [f, 0.7 * a, 1.9], [f * 1.19, 0.4 * a, 1.3], [f * 1.5, 0.28 * a, 1.0], [f * 2.0, 0.42 * a, 0.9], [f * 2.51, 0.18 * a, 0.6], [f * 3.01, 0.14 * a, 0.45], [f * 4.07, 0.08 * a, 0.3]], 1);
      click(x, sr, at, 2400, 2, 0.15 * a);
    }
    biquad(x, 'lowpass', 2600, 0.7, sr);
    const fl = Math.floor(1.5 * sr);
    for (let i = 0; i < fl; i++) x[x.length - fl + i] *= 1 - i / fl;   // fade so the ringing doesn't cut off
    normalize(x, 0.5);
  }),
  creak: () => buf(1.2, (x, sr) => { for (let i = 0; i < 0.9 * sr; i++) { const t = i / sr; x[i] = Math.sign(Math.sin(6.283 * (60 + 25 * Math.sin(t * 7)) * t)) * Math.sin(Math.PI * t / 0.9) * 0.3; } biquad(x, 'bandpass', 900, 2, sr); normalize(x, 0.35); }),
};
// start the ambience for a map (theme name from mapview.js); centre: middle of the map
export function startAmbience(theme, night, centre = { x: 0, z: 0 }, size = 50) {
  if (!ctx) return;
  stopAmbience();
  const a = AMB[theme] || AMB.desert;
  const src = ctx.createBufferSource();
  src.buffer = ambienceBed(a, night);
  src.loop = true; src.loopStart = 0; src.loopEnd = src.buffer.duration - 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(night ? 0.3 : 0.4, ctx.currentTime + 2);
  src.connect(g); g.connect(ambBus);
  src.start();
  amb = { src, g, timer: 0 };
  // build the common sounds now, quietly, so nothing stutters the first time it's heard
  setTimeout(() => {
    if (!ctx) return;
    for (const n of ['beep', 'keypad', 'defuse', 'hitBody', 'hitHead', 'kill', 'killHead', 'hurt', 'magOut', 'magIn', 'magSeat', 'magDrop', 'slap', 'explosion', 'drop', 'casing']) sound(n);
  }, 1500);
  // now and then, something in the distance
  const next = () => {
    if (!amb) return;
    amb.timer = setTimeout(() => {
      if (!amb || !ctx) return;
      const kind = a.events[Math.floor(Math.random() * a.events.length)];
      const ang = Math.random() * Math.PI * 2, r = size * (0.7 + Math.random() * 0.6);
      const key = `amb:${kind}#${Math.floor(Math.random() * 2)}`;
      if (!cache.has(key)) cache.set(key, AMB_EVENT[kind]());
      play(cache.get(key), { pos: { x: centre.x + Math.cos(ang) * r, y: 8, z: centre.z + Math.sin(ang) * r }, gain: kind === 'horn' || kind === 'bell' ? 0.5 : 0.35, ref: 10, roll: 0.6, air: 120, wet: 1, dest: undefined });
      next();
    }, (7 + Math.random() * 14) * 1000);
  };
  next();
}
export function stopAmbience() {
  if (!amb || !ctx) return;
  const { src, g, timer } = amb;
  clearTimeout(timer);
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
  try { src.stop(ctx.currentTime + 0.6); } catch (e) { /* stopped */ }
  amb = null;
}

// for the automated sound checks only
export const __test = { sound: n => sound(n), gun: (id, sil) => gunBuffer(WEAPONS[id], sil), step: (s, land) => stepBuffer(s, land), bed: (theme, night) => ambienceBed(AMB[theme] || AMB.desert, night), event: k => AMB_EVENT[k](), impulse: (d, damp) => impulse(d, damp), rate: () => ctx && ctx.sampleRate, tap: () => { const d = ctx.createMediaStreamDestination(); comp.connect(d); return d.stream; } };
