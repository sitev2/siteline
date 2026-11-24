// What the thing in the garage looks like on the players' screens (its brain is shifter.js, on the host).
// OUR OWN design. It has no look of its own: it is always drawn as a hazmat player, built exactly like a real one
// (makePlayerModel, the same name patch, animated by the same animateModel from the same movement), so a copy has
// no giveaways at all (owner's rule). The only time it shows what it is, is the take-over ("pulled inside", ~3 s):
//   grab     dark tendrils shoot out of its chest and wrap round the victim
//   open     its suit splits down the front and opens like two halves of a shell: wet black inside, ridged
//   swallow  the tendrils pull the victim in (they fold up into the dark)
//   close    the halves clap shut
//   re-form  it ripples, and stands up as the victim, with their name on its back
// No blood, no gore: the inside is black and glistening, nothing more.
import * as THREE from 'three';
import { makePlayerModel, animateModel, setModelWeapon, hazmatMat } from './models.js';

// the take-over's timing (s from the grab), shared with game.js (the victim's body and camera follow it)
export const TAKE = { grab: 0, open: 0.55, swallow: 1.2, close: 2.0, form: 2.45, swap: 2.7, end: 3.0 };
const smooth = t => t * t * (3 - 2 * t);
const clamp01 = v => Math.max(0, Math.min(1, v));
const ss = (a, b, t) => smooth(clamp01((t - a) / (b - a)));
// how far the victim has been pulled in (0 standing where they were … 1 gone inside it)
export function takePull(T) { return T < TAKE.open ? 0 : T < TAKE.swallow ? 0.25 * ss(TAKE.open, TAKE.swallow, T) : 0.25 + 0.75 * ss(TAKE.swallow, TAKE.close, T); }
// how far its body is open (0 shut … 1 wide open)
function openK(T) { return T < TAKE.open ? 0 : T < TAKE.close ? ss(TAKE.open, TAKE.swallow, T) : 1 - ss(TAKE.close, TAKE.form, T); }

// the outline of a suit's upper body, waist to the top of the hood (radius, height): the shell it opens into
const PROFILE = [[0.15, 0.9], [0.18, 1.0], [0.19, 1.15], [0.2, 1.3], [0.215, 1.41], [0.16, 1.49], [0.085, 1.53], [0.115, 1.56], [0.138, 1.63], [0.13, 1.71], [0.085, 1.77], [0.01, 1.8]];
const ZS = 0.82;           // (flatter front to back)
const HINGE = 0.11;        // the halves turn about a line down its back

function makeOpening() {
  const group = new THREE.Group();
  const pts = PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  const outer = hazmatMat();
  const wet = new THREE.MeshStandardMaterial({ color: '#120a0e', roughness: 0.2, metalness: 0.15, side: THREE.BackSide });
  const ridgeM = new THREE.MeshStandardMaterial({ color: '#2b1d24', roughness: 0.3, metalness: 0.1 });
  const halves = [];
  for (const side of [1, -1]) {
    // right half (side 1): phi 0 … π, from the back (+z) round +x to the front (-z); the left half the other way
    const geo = new THREE.LatheGeometry(pts, 10, side > 0 ? 0 : Math.PI, Math.PI);
    geo.scale(1, 1, ZS);
    geo.translate(0, 0, -HINGE);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, HINGE);
    const shell = new THREE.Mesh(geo, outer), inside = new THREE.Mesh(geo, wet);
    inside.scale.setScalar(0.985);
    pivot.add(shell, inside);
    // ridges round the inside of each half, like the inside of a throat
    for (let k = 0; k < 4; k++) {
      const y = 1.02 + k * 0.15, r = 0.17 - Math.abs(k - 1.5) * 0.015;
      // (a half ring lying flat on this half's side: from the front, round the side, to the back)
      const rg = new THREE.TorusGeometry(r, 0.012, 5, 10, Math.PI).rotateX(Math.PI / 2).rotateY(side * Math.PI / 2);
      rg.scale(1, 1, ZS); rg.translate(0, y, -HINGE);
      pivot.add(new THREE.Mesh(rg, ridgeM));
    }
    group.add(pivot);
    halves.push({ pivot, side });
  }
  // the dark it opens onto: a black hollow deeper than the body could be
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: '#020203' }));
  core.scale.set(0.15, 0.34, 0.1); core.position.set(0, 1.25, 0.02);
  group.add(core);
  // wet strands across the opening (they stretch, then let go)
  const strandM = new THREE.MeshStandardMaterial({ color: '#1b1217', roughness: 0.25, metalness: 0.1 });
  const strandGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5);
  const strands = [1.05, 1.22, 1.38].map(y => { const s = new THREE.Mesh(strandGeo, strandM); s.userData.y = y; group.add(s); return s; });
  // tendrils: four chains of tapering pieces from the opening to the victim
  const segGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0);
  const tendrils = [[0.07, 1.36], [-0.07, 1.32], [0.08, 1.12], [-0.06, 1.08]].map(([x, y], k) => {
    const segs = [];
    for (let j = 0; j < 7; j++) { const s = new THREE.Mesh(segGeo, strandM); group.add(s); segs.push(s); }
    return { segs, x, y, ph: k * 1.7, aim: [[0.12, 0.35], [-0.14, 0.25], [0.1, -0.05], [-0.08, -0.2]][k] };
  });
  return { group, halves, core, strands, tendrils };
}

export function makeShifterModel(env) {
  const root = new THREE.Group();
  const head = new THREE.Object3D(); head.position.set(0, 1.62, 0); root.add(head);       // (the victim's camera looks here…)
  const mouth = new THREE.Object3D(); mouth.position.set(0, 1.22, -0.12); root.add(mouth);   // (…and is pulled in here)
  const open = makeOpening(); open.group.visible = false; root.add(open.group);
  return { root, monster: true, shifter: true, env, head, mouth, open, copy: null, copyOf: null, copyName: '', key: '', modeT: 0, modeAt: 0, events: [], said: {} };
}

// the hazmat player it looks like (rebuilt only when that changes: a new name patch)
function setCopy(m, id, name) {
  if (m.copyOf === id && m.copy) return;
  if (m.copy) m.root.remove(m.copy.root);
  m.copyName = name || m.copyName || '';
  m.copy = makePlayerModel('atk', m.copyName, false, 'hazmat');
  setModelWeapon(m.copy, 'none');
  m.copyOf = id;
  m.root.add(m.copy.root);
  if (m.onCopy) m.onCopy(m.copy);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
// a chain of pieces along a bent line from a to b (the middle pushed out by `bow`)
function chain(segs, a, b, bow, r0, k) {
  const n = segs.length;
  let px = a.x, py = a.y, pz = a.z;
  for (let j = 0; j < n; j++) {
    const t = (j + 1) / n, s = segs[j];
    const x = a.x + (b.x - a.x) * t + bow.x * Math.sin(Math.PI * t), y = a.y + (b.y - a.y) * t + bow.y * Math.sin(Math.PI * t), z = a.z + (b.z - a.z) * t + bow.z * Math.sin(Math.PI * t);
    _d.set(x - px, y - py, z - pz);
    const len = _d.length() || 0.001;
    s.position.set(px, py, pz);
    s.quaternion.copy(_q.setFromUnitVectors(UP, _d.multiplyScalar(1 / len)));
    const r = r0 * (1 - t * 0.75) * k;
    s.scale.set(r, len, r);
    s.visible = k > 0.02;
    px = x; py = y; pz = z;
  }
}

// o: { parts: the host's mode split on ':' ('s', 'copy', id, 'walk'), speed, fwd, side, pitch: as for a player,
//      nameOf: id → name, victim: the victim's middle in its own (model) space, during a take-over }
// Sounds to play are queued in m.events: { kind, gain }.
export function animateShifter(m, dt, o = {}) {
  const parts = o.parts || ['s', 'copy', '~', 'still'], A = parts[2] || '~';
  let form = parts[1] || 'copy', B = parts[3] || '';
  let key = form === 'copy' ? `copy:${A}` : `${form}:${A}:${B}`;
  // (this screen started the take-over a moment after the host did: the host is already done and says "a copy of
  // the victim" — the take-over still plays to its end here, then it walks off)
  if (m.key.startsWith('take:') && form === 'copy' && m.key.split(':')[1] === A && performance.now() / 1000 - m.modeAt < TAKE.end) { form = 'take'; B = m.key.split(':')[2]; key = m.key; }
  // (timed by the real clock, like the host: a slow frame rate must not slow the take-over down on this screen)
  const now = performance.now() / 1000;
  if (key !== m.key) {
    m.key = key; m.modeAt = now; m.said = {};
    if (form === 'form') m.events.push({ kind: 'shiftSettle', gain: 0.35 });
  }
  m.modeT = now - m.modeAt;
  const T = m.modeT, name = id => (o.nameOf ? o.nameOf(id) : '');
  let look = A, ripple = 0, k = 0;
  const O = m.open;
  if (form === 'take') {
    // until it has re-formed it still looks like what it was (B); then like the victim (A)
    look = T < TAKE.swap && B && B !== '~' ? B : A;
    k = openK(T);
    for (const [at, kind, gain] of [[TAKE.grab, 'takeGrab', 1.3], [TAKE.open, 'takeOpen', 1.2], [TAKE.swallow, 'takeSwallow', 1.3], [TAKE.close, 'takeClose', 1.3], [TAKE.form, 'takeForm', 0.9]]) {
      if (T >= at && !m.said[kind]) { m.said[kind] = 1; m.events.push({ kind, gain }); }
    }
    ripple = (T > 0.38 && T < 0.62 ? Math.sin((T - 0.38) / 0.24 * Math.PI) * 0.6 : 0) + (T > TAKE.form && T < TAKE.end + 0.1 ? Math.sin(clamp01((T - TAKE.form) / 0.6) * Math.PI) : 0);
  } else if (form === 'form') {
    look = T < 0.6 ? B : A;
    ripple = Math.sin(clamp01(T / 1.2) * Math.PI) * 0.8;
  }
  if (look && look !== '~') setCopy(m, look, name(look));
  else if (!m.copy) setCopy(m, '~', '');
  const c = m.copy;
  c.root.visible = true;
  // moving exactly like a player (in a take-over it stands still on its own feet)
  const still = form !== 'copy';
  animateModel(c, dt, { speed: still ? 0 : o.speed || 0, fwd: still ? 0 : o.fwd, side: still ? 0 : o.side, pitch: still ? 0 : o.pitch || 0, air: false, use: false });
  // a ripple through it (changing shape): it shudders and swells a little
  const t = performance.now() / 1000;
  c.root.scale.set(1 + Math.sin(t * 43) * 0.05 * ripple + ripple * 0.04, 1 - Math.sin(t * 37) * 0.04 * ripple, 1 + Math.cos(t * 41) * 0.05 * ripple + ripple * 0.04);
  c.root.rotation.z = Math.sin(t * 29) * 0.03 * ripple;
  // ---- the take-over: open, pull them in, shut ----
  const showShell = form === 'take' && T > TAKE.open - 0.08 && T < TAKE.swap;
  O.group.visible = form === 'take' && T < TAKE.swap;
  c.spine.visible = !showShell;
  if (!O.group.visible) return;
  for (const h of O.halves) { h.pivot.visible = showShell; h.pivot.rotation.y = h.side * -1.35 * k; }
  O.core.visible = showShell && k > 0.05;
  O.core.scale.set(0.15 * (0.4 + 0.6 * k), 0.34 * (0.5 + 0.5 * k), 0.1 + 0.06 * k);
  // strands across the opening: stretched as it opens, gone (snapped) once it is wide
  const gap = Math.sin(1.35 * k) * 0.32;
  for (const s of O.strands) {
    s.visible = showShell && k > 0.04 && k < 0.7;
    s.position.set(0, s.userData.y, -0.13);
    s.rotation.set(0, 0, Math.PI / 2);
    s.scale.set(1 - k, Math.max(0.01, gap * 2), 1 - k);
  }
  // tendrils: out to the victim, round them, then back in with them
  const v = o.victim || { x: 0, y: 1.0, z: -0.9 }, reach = T < 0.45 ? ss(0, 0.45, T) : 1, back = takePull(T);
  const gone = T > TAKE.close + 0.05;
  for (const td of O.tendrils) {
    _a.set(td.x, td.y, -0.12);
    // the tip: round the victim (each one at its own height, a little to the side), drawn in as they are
    _b.set(v.x + td.aim[0] * (1 - back), v.y + td.aim[1] * (1 - back) + Math.sin(t * 6 + td.ph) * 0.02, v.z + 0.05);
    _b.lerp(_a, back * 0.9);
    _b.lerpVectors(_a, _b, reach);
    const wob = Math.sin(t * 9 + td.ph) * 0.05 * (1 - back);
    chain(td.segs, _a, _b, { x: td.x * 0.8 + wob, y: 0.06, z: 0 }, 0.035, gone ? 0 : 1);
  }
}
