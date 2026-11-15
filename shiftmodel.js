// What Level 1's shapeshifter looks like on the players' screens (its brain is shifter.js, on the host).
// OUR OWN design: it has no shape of its own. Out of disguise it is a heap of dark, wet lumps that never stops
// rearranging itself: it stretches tall and thin to run, lopes on four limbs, folds flat to go under the ducts and
// through doors, spreads wide, slumps into a heap; limbs grow out of it and pull back in, pale eyes wander over
// it, and a piece of the last thing it copied is still stuck in it (a car door, a cone, a length of pipe, a hazmat
// hood). In disguise it is drawn with the very same shapes and baked light as the real props (garprops.js /
// garview.js), or as a hazmat player with the copied player's name on the back.
// Fair giveaways (clearer on easy, `tell` 1 … 0.3): a disguise breathes very slightly; a copied car ticks quietly
// and has no reflection in the puddles; a copied player walks a little wrong, twitches, and has no flashlight.
import * as THREE from 'three';
import { carGeometry, coneGeometry, riserGeometry, CAR_PAINTS } from './garprops.js';
import { makePlayerModel, animateModel, setModelWeapon } from './models.js';

const N = 9;                      // lumps in its body
const smooth = t => t * t * (3 - 2 * t);
const clamp01 = v => Math.max(0, Math.min(1, v));
const CAR_KINDS = ['saloon', 'hatch', 'van'];

// where each lump goes in each posture: [side, height, forward, size x, size y, size z]
const POSTURE = {
  tall: i => { const k = i / (N - 1); return [Math.sin(i * 2.4) * 0.06, 0.75 + k * 1.75, Math.sin(i * 1.3) * 0.08 - k * 0.12, 0.3 - k * 0.08, 0.36, 0.3 - k * 0.08]; },
  lope: i => { const k = i / (N - 1); return [Math.sin(i * 2.1) * 0.1, 0.95 + Math.sin(k * Math.PI) * 0.25, 0.9 - k * 1.8, 0.34, 0.3, 0.36]; },
  low: i => { const a = i * 2.4, r = 0.25 + (i % 3) * 0.28; return [Math.cos(a) * r * 1.1, 0.2 + (i % 2) * 0.08, Math.sin(a) * r * 1.3, 0.5, 0.2, 0.5]; },
  wide: i => { const k = i / (N - 1) - 0.5; return [k * 1.9, 1.25 - Math.abs(k) * 0.5 + (i % 2) * 0.1, Math.sin(i * 1.7) * 0.15, 0.34, 0.3, 0.32]; },
  lump: i => { const a = i * 2.4, r = 0.12 + (i % 3) * 0.16; return [Math.cos(a) * r, 0.28 + (i % 4) * 0.19, Math.sin(a) * r, 0.42, 0.36, 0.42]; },
};
// how far each of its six limbs is out in each posture (0 = pulled right in), and which lump it grows from
const LIMBS = {
  tall: [1, 1, 0.8, 0.8, 0, 0.2], lope: [1, 1, 1, 1, 0.1, 0], low: [0.35, 0.35, 0.35, 0.35, 0.3, 0.3],
  wide: [1, 1, 0.9, 0.9, 0.7, 0.7], lump: [0.15, 0.1, 0.25, 0, 0.15, 0],
};
const LIMB_AT = { tall: [0, 0, 6, 6, 3, 4], lope: [1, 1, 7, 7, 4, 4], low: [0, 2, 4, 6, 7, 8], wide: [0, 8, 2, 6, 3, 5], lump: [1, 3, 5, 7, 2, 6] };
const LEG = { tall: [1, 1, 0, 0, 0, 0], lope: [1, 1, 1, 1, 0, 0], low: [1, 1, 1, 1, 1, 1], wide: [1, 1, 1, 1, 0, 0], lump: [0, 0, 0, 0, 0, 0] };

// env: the garage scene's helpers (garview.js group.userData): litGeo, propMat, propLight, carShadow
export function makeShifterModel(env) {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: '#1b191d', roughness: 0.32, metalness: 0.15 });
  const skin2 = new THREE.MeshStandardMaterial({ color: '#2a2327', roughness: 0.5, metalness: 0.05 });
  const body = new THREE.Group();
  root.add(body);
  const ball = new THREE.IcosahedronGeometry(1, 2);
  const lumps = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(ball, i % 3 === 1 ? skin2 : skin);
    body.add(m);
    lumps.push({ m, p: new THREE.Vector3(0, 0.5, 0), s: new THREE.Vector3(0.3, 0.3, 0.3), ph: i * 1.7 });
  }
  // limbs: three tapering pieces each, drawn from where they grow to where the tip is
  const segGeo = new THREE.CylinderGeometry(0.5, 1, 1, 7).translate(0, 0.5, 0);
  const limbs = [];
  for (let k = 0; k < 6; k++) {
    const segs = [0, 1, 2].map(j => { const s = new THREE.Mesh(segGeo, j === 1 ? skin2 : skin); body.add(s); return s; });
    limbs.push({ segs, grow: 0, tip: new THREE.Vector3(), foot: new THREE.Vector3(), planted: false, side: k % 2 ? 1 : -1, ph: k * 1.1 });
  }
  // pale eyes that wander over it (never where you'd expect a face)
  const eyeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.45, 1.2) });
  const eyes = [];
  for (let k = 0; k < 5; k++) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeM); body.add(e); eyes.push({ e, on: k % N, a: k * 1.3, b: k * 0.7 }); }
  // keepsakes: a piece of the last thing it copied, half swallowed
  const keeps = {};
  {
    const paint = new THREE.MeshStandardMaterial({ color: CAR_PAINTS[1], roughness: 0.5, metalness: 0.3 }), glass = new THREE.MeshStandardMaterial({ color: '#0e1316', roughness: 0.2 });
    const door = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.05), paint); panel.position.y = -0.1;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.035), glass); frame.position.y = 0.38;
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), new THREE.MeshStandardMaterial({ color: '#8d9094', metalness: 0.7, roughness: 0.3 })); hd.position.set(0.3, 0.05, 0.04);
    door.add(panel, frame, hd); keeps.car = door; keeps.paint = paint;
    keeps.cones = new THREE.Mesh(coneGeometry(1), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.1, 10), new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.6, metalness: 0.4 }));
    keeps.pipe = pipe;
    const suit = new THREE.Group(), yel = new THREE.MeshStandardMaterial({ color: '#c9a31a', roughness: 0.45 });
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), yel), visor = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.15 }));
    visor.position.set(0, 0.01, -0.09); visor.scale.set(1, 0.7, 0.7);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.55, 8), yel); sleeve.position.set(0.22, -0.3, 0.05); sleeve.rotation.z = 0.5;
    suit.add(hood, visor, sleeve); keeps.suit = suit;
    for (const k of ['car', 'cones', 'pipe', 'suit']) { keeps[k].visible = false; body.add(keeps[k]); }
  }
  // the prop it is pretending to be (the mesh is made when it takes the shape), and the copy of a player
  const prop = new THREE.Group();
  root.add(prop);
  const head = new THREE.Object3D();
  root.add(head);
  return {
    root, monster: true, shifter: true, env, body, lumps, limbs, eyes, keeps, prop, head,
    posture: 'lump', mode: '', modeT: 0, clock: 0, stride: 0, events: [], copy: null, copyOf: null, propKey: '', tickAt: 2, lastPos: null,
  };
}

function setProp(m, kind, a, b, pos) {
  const key = `${kind}:${a}:${b}:${Math.round(pos.x * 10)}:${Math.round(pos.y * 10)}:${Math.round(pos.z * 10)}`;
  if (m.propKey === key) return;
  m.propKey = key;
  m.prop.clear();
  if (m.propMesh) m.propMesh.geometry.dispose();
  const geo = kind === 'car' ? carGeometry(CAR_KINDS[Number(a) % 3], CAR_PAINTS[Number(b) % CAR_PAINTS.length], 4) : kind === 'cones' ? coneGeometry(Number(a) || 3) : riserGeometry();
  // (lit exactly as a real one standing there would be)
  m.propMesh = new THREE.Mesh(m.env && m.env.litGeo ? m.env.litGeo(geo, pos.x, pos.y, pos.z) : geo.clone(), m.env && m.env.propMat ? m.env.propMat : new THREE.MeshBasicMaterial({ vertexColors: true }));
  m.prop.add(m.propMesh);
  if (kind === 'car') m.keeps.paint.color.set(CAR_PAINTS[Number(b) % CAR_PAINTS.length]);
}

function setCopy(m, id, name) {
  if (m.copyOf === id && m.copy) return;
  if (m.copy) m.root.remove(m.copy.root);
  m.copy = makePlayerModel('atk', name || '', false, 'hazmat');
  setModelWeapon(m.copy, 'none');
  m.copyOf = id;
  m.root.add(m.copy.root);
}

// o: { parts: the host's mode ('s:car:12:3' split on ':'), speed, pos: { x, y, z }, tell: 0.3 … 1, nameOf: id → name,
//      eye: how brightly its eyes show (0 … 1) }
// Returns nothing; sounds to play are queued in m.events: { kind, gain }.
export function animateShifter(m, dt, o = {}) {
  const parts = o.parts || ['s', 'true', 'lump', 'none'], form = parts[1] || 'true', A = parts[2], B = parts[3];
  const mode = parts.slice(1).join(':'), tell = o.tell == null ? 0.6 : o.tell;
  m.clock += dt;
  const t = m.clock;
  if (mode !== m.mode) {
    const was = m.mode.split(':')[0];
    m.mode = mode; m.modeT = 0;
    if (form === 'burst') m.events.push({ kind: 'shiftBurst', gain: 1.3 });
    else if (form === 'settle') m.events.push({ kind: 'shiftSettle', gain: 0.5 });
    else if (form === 'kill') m.events.push({ kind: 'shiftKill', gain: 1.4 });
    else if (form === 'force') m.events.push({ kind: 'shiftFold', gain: 0.9 });
    else if (form === 'true' && was === 'true' && A !== m.posture) m.events.push({ kind: A === 'tall' ? 'shiftStretch' : A === 'low' ? 'shiftFold' : A === 'lump' ? 'shiftSlump' : 'shiftLimb', gain: 0.8 });
  }
  m.modeT += dt;
  const disguise = form === 'car' || form === 'cones' || form === 'pipe';
  const shifting = form === 'burst' || form === 'settle';
  const shapeKind = shifting ? A : form, shapeA = shifting ? B : A, shapeB = shifting ? parts[4] : B;
  const isProp = shapeKind === 'car' || shapeKind === 'cones' || shapeKind === 'pipe', isCopy = shapeKind === 'copy';
  // how much of it is the disguise (1) and how much itself (0)
  let k = disguise || form === 'copy' ? 1 : 0;
  if (form === 'settle') k = smooth(clamp01(m.modeT / 1.2));
  if (form === 'burst') k = 1 - smooth(clamp01(m.modeT / 0.55));
  const breathe = Math.sin(t * 1.9) * 0.5 + Math.sin(t * 0.83) * 0.5;

  // ---- the prop ----
  m.prop.visible = isProp && k > 0.02;
  if (m.prop.visible) {
    setProp(m, shapeKind, shapeA, shapeB, o.pos || { x: 0, y: 0, z: 0 });
    const j = shifting ? (1 - k) : 0, w = Math.sin(t * 47) * j;                       // changing: it shudders and buckles
    const br = disguise ? breathe * 0.011 * tell : 0;                                // waiting: it breathes, barely
    m.prop.scale.set((0.25 + 0.75 * k) * (1 + w * 0.12 + br), (0.2 + 0.8 * k) * (1 - w * 0.15 + br * 1.6), (0.25 + 0.75 * k) * (1 + Math.cos(t * 39) * j * 0.12 + br));
    m.prop.rotation.set(Math.sin(t * 31) * j * 0.08, 0, Math.cos(t * 27) * j * 0.08 + (shapeKind === 'cones' && disguise ? Math.sin(t * 0.9) * 0.012 * tell : 0));
    // a copied car ticks, like an engine cooling (a real one has been cold for years)
    if (disguise) { m.tickAt -= dt; if (m.tickAt <= 0) { m.tickAt = 1.4 + Math.random() * 3.2; m.events.push({ kind: 'shiftTick', gain: (shapeKind === 'car' ? 0.5 : 0.28) * (0.35 + tell) }); } }
  } else if (!isProp) m.propKey = m.propKey && '';
  if (m.env && m.env.carShadow) { const p = o.pos; if (isProp && shapeKind === 'car' && k > 0.5 && p) m.env.carShadow(p.x, p.y, p.z); else if (m.hadShadow) m.env.carShadow(0, null, 0); m.hadShadow = isProp && shapeKind === 'car' && k > 0.5; }

  // ---- the copy of a player ----
  if (isCopy && k > 0.02) {
    setCopy(m, shapeA, o.nameOf ? o.nameOf(shapeA) : '');
    const c = m.copy, walking = B === 'walk' || (o.speed || 0) > 0.4;
    c.root.visible = true;
    // it walks a little wrong: the stride hitches, it leans, and now and then its head twitches
    const hitch = Math.sin(t * 2.7) > 0.93 - tell * 0.1 ? 0 : 1;
    animateModel(c, dt * hitch * (walking ? 0.82 : 1), { speed: walking ? Math.max(1.2, (o.speed || 0)) * 0.9 : 0, fwd: walking ? 2 : 0, side: 0, pitch: -0.06, air: false, use: false });
    const j = shifting ? 1 - k : 0;
    c.root.rotation.set(0, 0, 0.03 * tell + Math.sin(t * 41) * j * 0.15);
    c.root.scale.set((0.4 + 0.6 * k) * (1 + Math.sin(t * 43) * j * 0.2), (0.3 + 0.7 * k) * (1 - Math.sin(t * 37) * j * 0.2), 0.4 + 0.6 * k);
    if (c.neck) c.neck.rotation.z = Math.sin(t * 0.6) > 0.985 - tell * 0.03 ? Math.sin(t * 60) * 0.25 : 0.05 * tell;
  } else if (m.copy) m.copy.root.visible = false;

  // ---- itself ----
  const own = 1 - k;
  m.body.visible = own > 0.02;
  m.head.position.set(0, 1.6, 0);
  if (!m.body.visible) return;
  let post = form === 'true' && POSTURE[A] ? A : form === 'force' ? 'low' : form === 'kill' ? 'tall' : m.posture;
  if (shifting) post = 'lump';
  m.posture = post;
  const keep = form === 'true' ? B : (shifting && form === 'burst' ? (A === 'copy' ? 'suit' : A) : m.keep);
  m.keep = keep;
  const P = POSTURE[post], sp = o.speed || 0;
  m.stride += dt * (1.2 + sp * 1.5);
  // catching someone: it rears up over them, folds down round them, tightens, and sinks into a heap
  let kill = null;
  if (form === 'kill') {
    const T = m.modeT;
    kill = { rear: smooth(clamp01(T / 0.5)) * (1 - smooth(clamp01((T - 0.5) / 0.7))), wrap: smooth(clamp01((T - 0.5) / 0.8)), squeeze: smooth(clamp01((T - 1.4) / 0.9)), sink: smooth(clamp01((T - 2.3) / 0.5)) };
  }
  const rate = Math.min(1, dt * (post === 'tall' ? 7 : 5));
  let top = 0;
  m.lumps.forEach((L, i) => {
    let [x, y, z, sx, sy, sz] = P(i);
    if (kill) {
      // a ring of lumps round where they stand (0.85 m in front of it), closing in
      const a = i / N * Math.PI * 2 + m.modeT * 1.5, r = 0.62 - 0.44 * kill.squeeze, h = 0.3 + (i % 5) * 0.36;
      const wx = Math.cos(a) * r, wz = -0.85 + Math.sin(a) * r, wy = h * (1 - 0.6 * kill.sink);
      x += (wx - x) * kill.wrap; y = (y + kill.rear * 0.5) * (1 - kill.wrap) + wy * kill.wrap; z += (wz - z) * kill.wrap;
      sx *= 1 + kill.squeeze * 0.5; sz *= 1 + kill.squeeze * 0.5;
    }
    // it never keeps still: every lump drifts and swells on its own clock, more when it moves
    const wob = 0.035 + Math.min(0.1, sp * 0.02), ph = L.ph;
    x += Math.sin(t * 1.7 + ph) * wob; y += Math.sin(t * 2.3 + ph * 1.3) * wob + (post === 'lope' || post === 'tall' ? Math.abs(Math.sin(m.stride * 2 + i * 0.5)) * 0.05 * Math.min(1, sp) : 0); z += Math.cos(t * 1.9 + ph * 0.7) * wob;
    const pulse = 1 + Math.sin(t * 3.1 + ph * 2) * 0.09;
    L.p.x += (x - L.p.x) * rate; L.p.y += (y - L.p.y) * rate; L.p.z += (z - L.p.z) * rate;
    L.s.x += (sx * pulse - L.s.x) * rate; L.s.y += (sy / pulse - L.s.y) * rate; L.s.z += (sz * pulse - L.s.z) * rate;
    L.m.position.copy(L.p).multiplyScalar(1).y = Math.max(L.s.y * own * 0.8, L.p.y * (0.25 + 0.75 * own));
    L.m.position.x = L.p.x * own; L.m.position.z = L.p.z * own;
    L.m.scale.set(L.s.x * own, L.s.y * own, L.s.z * own);
    top = Math.max(top, L.m.position.y + L.s.y * own);
  });
  m.head.position.set(0, Math.max(0.5, top - 0.15), 0);
  // limbs: out or in by posture (and on a whim), legs stepping, the others reaching about
  const G = LIMBS[post], AT = LIMB_AT[post], LG = LEG[post];
  const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), q = new THREE.Quaternion(), d = new THREE.Vector3();
  m.limbs.forEach((lb, i) => {
    const whim = 0.75 + 0.25 * Math.sin(t * 0.9 + lb.ph * 3) + (Math.sin(t * 0.37 + lb.ph * 5) > 0.8 ? 0.35 : 0);
    const want = clamp01(G[i] * whim) * (kill ? 1 - kill.squeeze * 0.8 : 1);
    lb.grow += (want - lb.grow) * Math.min(1, dt * 3.5);
    const from = m.lumps[AT[i]].m.position, g = lb.grow * own;
    const vis = g > 0.04;
    for (const s of lb.segs) s.visible = vis;
    if (!vis) return;
    a.copy(from);
    if (LG[i] && !kill) {
      // a leg: its foot on the floor, out to the side, swinging with the stride
      const ph = m.stride * 2 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0), swing = Math.sin(ph) * Math.min(0.5, 0.12 + sp * 0.1);
      const out = post === 'wide' ? 1.0 : post === 'low' ? 0.75 : 0.3;
      b.set(from.x + lb.side * out * g, Math.max(0, Math.cos(ph)) * 0.16 * Math.min(1, sp + 0.2), from.z + swing + (i > 1 ? -0.1 : 0.15));
    } else {
      // an arm: hanging, reaching, feeling about
      const len = (post === 'tall' ? 1.25 : 0.9) * g, ax = t * 0.8 + lb.ph * 2;
      b.set(from.x + lb.side * (0.35 + 0.25 * Math.sin(ax)) * len, from.y - (0.55 - 0.5 * Math.sin(ax * 0.7 + 1)) * len, from.z - (0.2 + 0.5 * Math.cos(ax * 0.6)) * len);
      if (kill) b.lerp(new THREE.Vector3(lb.side * 0.3, 0.9, -0.85), kill.wrap);
      if (b.y < 0.03) b.y = 0.03;
    }
    // a bent limb of three pieces: the joint pushed outwards and up
    mid.copy(a).lerp(b, 0.5); mid.x += lb.side * 0.22 * g; mid.y += 0.2 * g;
    const pts = [a, mid.clone().lerp(a, 0.35), mid.clone().lerp(b, 0.35), b];
    for (let j = 0; j < 3; j++) {
      const s = lb.segs[j], p0 = pts[j], p1 = pts[j + 1];
      d.copy(p1).sub(p0);
      const len = d.length() || 0.001;
      s.position.copy(p0);
      s.quaternion.copy(q.setFromUnitVectors(up, d.multiplyScalar(1 / len)));
      const r = (0.11 - j * 0.028) * (0.6 + 0.4 * g);
      s.scale.set(r, len, r);
    }
  });
  // eyes: each rides on a lump, sliding round it
  const eyeK = o.eye == null ? 0.6 : o.eye;
  m.eyes.forEach((E, i) => {
    E.a += dt * (0.3 + 0.2 * Math.sin(t * 0.4 + i)); E.b += dt * 0.23;
    if (Math.sin(t * 0.21 + i * 2) > 0.995) E.on = (E.on + 1 + i) % N;        // now and then one moves to another lump
    const L = m.lumps[E.on], th = E.a, ph = 0.9 + 0.5 * Math.sin(E.b);
    E.e.position.set(L.m.position.x + Math.cos(th) * Math.sin(ph) * L.m.scale.x, L.m.position.y + Math.cos(ph) * L.m.scale.y, L.m.position.z - Math.abs(Math.sin(th) * Math.sin(ph)) * L.m.scale.z);
    E.e.visible = own > 0.5;
    E.e.scale.setScalar(0.5 + eyeK * 0.9);
  });
  // the keepsake, stuck in its side
  for (const kk of ['car', 'cones', 'pipe', 'suit']) m.keeps[kk].visible = keep === kk && own > 0.3;
  const ks = m.keeps[keep];
  if (ks && ks.visible) {
    const L = m.lumps[keep === 'suit' ? N - 2 : 4].m.position;
    ks.scale.setScalar(own);
    if (keep === 'car') { ks.position.set(L.x + 0.3, L.y + 0.05, L.z + 0.05); ks.rotation.set(0.25 + Math.sin(t * 1.3) * 0.06, 1.1, 0.5); }
    else if (keep === 'cones') { ks.position.set(L.x - 0.2, L.y + 0.1, L.z); ks.rotation.set(0.9, 0, 1.1 + Math.sin(t * 1.1) * 0.08); }
    else if (keep === 'pipe') { ks.position.set(L.x, L.y + 0.1, L.z + 0.1); ks.rotation.set(0.7, 0.3, 0.9 + Math.sin(t) * 0.05); }
    else { ks.position.set(L.x + 0.12, L.y + 0.12, L.z - 0.1); ks.rotation.set(0.5 + Math.sin(t * 0.9) * 0.1, 0.4, -0.7); }
  }
}
