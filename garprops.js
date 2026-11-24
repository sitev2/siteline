// Shapes of the things in Level 1's garage: old cars, traffic cones, drain pipes, the side rooms' furniture, the fuses
// and the fuse box. Built in code (our own plain designs), as one merged geometry each with the paint in its vertex
// colours; the scene (garview.js) lights them with its baked light.
import * as THREE from 'three';

export const CAR_PAINTS = ['#7d2f28', '#2f4a63', '#8a8f8c', '#3d5a44', '#b9b3a0', '#2a2b2e', '#9a6a2a'];

// merge parts [{ geo, color, m (Matrix4, optional) }] into one geometry: position, normal, uv (zero), colour
// (each face's colour is also shaded a little by which way it faces, since nothing lights these but baked light)
export function mergeParts(parts) {
  const pos = [], nor = [], col = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const P = g.attributes.position, N = g.attributes.normal;
    if (p.m) nm.getNormalMatrix(p.m);
    c.set(p.color);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
      if (p.m) { v.applyMatrix4(p.m); n.applyMatrix3(nm).normalize(); }
      pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z);
      const sh = (p.flat ? 1 : 0.62 + 0.3 * Math.max(0, n.y) + 0.08 * n.x + 0.05 * Math.abs(n.z)) * (p.k || 1);
      col.push(c.r * sh, c.g * sh, c.b * sh);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  return out;
}
const T = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
// a box whose top is narrower than its bottom (a car's cabin): taper in x and z, shifted along z by `shift`
function cabin(w, h, l, tx, tz, shift = 0) {
  const g = new THREE.BoxGeometry(w, h, l), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) if (P.getY(i) > 0) { P.setX(i, P.getX(i) * tx); P.setZ(i, P.getZ(i) * tz + shift); }
  g.computeVertexNormals();
  return g;
}

// An abandoned old car: nose towards −z, standing on y = 0. kind: 'saloon' | 'hatch' | 'van'; flat: which tyre is
// flat (0–3, 4 = none). About 2 m × 4.4 m, as its collision box is.
const carCache = new Map();
export function carGeometry(kind, paint, flat = 4) {
  const key = `${kind}|${paint}|${flat}`;
  if (carCache.has(key)) return carCache.get(key);
  const parts = [], body = paint, glass = '#10161a', trim = '#1c1c1e', tyre = '#0e0e0f', chrome = '#8d9094', lamp = '#b7b29a', red = '#5a1512';
  const van = kind === 'van', hatch = kind === 'hatch';
  const L = hatch ? 3.9 : 4.35, W = van ? 1.86 : 1.76, H0 = 0.28, HB = van ? 0.75 : 0.5;       // length, width, ground clearance, body height
  const add = (geo, color, m, o = {}) => parts.push({ geo, color, m, ...o });
  add(new THREE.BoxGeometry(W, HB, L), body, T(0, H0 + HB / 2, 0));
  if (van) {
    add(cabin(W, 0.85, L * 0.74, 0.9, 1, 0), body, T(0, H0 + HB + 0.425, L * 0.12));
    add(cabin(W, 0.6, L * 0.24, 0.9, 0.6, 0.18), body, T(0, H0 + HB + 0.3, -L * 0.37));
    add(new THREE.BoxGeometry(W * 0.84, 0.42, 0.02), glass, T(0, H0 + HB + 0.36, -L * 0.435).multiply(new THREE.Matrix4().makeRotationX(-0.55)), { flat: 1 });
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.36, 0.7), glass, T(s * (W / 2 - 0.02), H0 + HB + 0.36, -L * 0.3), { flat: 1 });
  } else {
    const cl = hatch ? L * 0.56 : L * 0.5, cz = hatch ? L * 0.1 : L * 0.04, ch = 0.52;
    add(cabin(W, ch, cl, 0.86, hatch ? 0.8 : 0.66, hatch ? 0.12 : 0), body, T(0, H0 + HB + ch / 2, cz));
    // windows: dark panes a hair proud of the cabin
    add(cabin(W + 0.012, ch * 0.62, cl * 0.9, 0.87, hatch ? 0.8 : 0.66, hatch ? 0.1 : 0), glass, T(0, H0 + HB + ch * 0.42, cz), { flat: 1 });
    add(cabin(W * 0.9, ch * 0.72, cl + 0.014, 0.86, hatch ? 0.8 : 0.66, hatch ? 0.12 : 0), glass, T(0, H0 + HB + ch * 0.42, cz), { flat: 1 });
    add(new THREE.BoxGeometry(W * 0.8, 0.03, cl * 0.5), body, T(0, H0 + HB + ch + 0.012, cz + (hatch ? 0.1 : 0)));
  }
  // bumpers, lamps, plates, door lines
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(W + 0.06, 0.16, 0.14), trim, T(0, H0 + 0.1, s * (L / 2 + 0.03)));
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.3, 0.13, 0.03), s < 0 ? lamp : red, T(sx * (W / 2 - 0.24), H0 + HB - 0.14, s * (L / 2 + 0.005)), { flat: 1 });
    add(new THREE.BoxGeometry(0.44, 0.11, 0.02), '#c9c6b4', T(0, H0 + 0.26, s * (L / 2 + 0.105)), { flat: 1 });
    add(new THREE.BoxGeometry(0.012, HB * 0.8, 0.02), trim, T(s * (W / 2 + 0.004), H0 + HB * 0.5, -L * 0.02), { flat: 1 });
    add(new THREE.BoxGeometry(0.03, 0.03, 0.14), chrome, T(s * (W / 2 + 0.012), H0 + HB * 0.78, L * 0.1));
  }
  add(new THREE.BoxGeometry(W * 0.5, 0.1, 0.02), trim, T(0, H0 + HB - 0.14, -L / 2 - 0.006), { flat: 1 });      // grille
  // wheels (one may be flat: the car sags on it)
  const wz = L * 0.31;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    const r = 0.3, fl = i === flat;
    const g = new THREE.CylinderGeometry(r, r, 0.2, 12); g.rotateZ(Math.PI / 2);
    add(g, tyre, T(sx * (W / 2 - 0.09), fl ? r * 0.8 : r, sz * wz, 0, 1, fl ? 0.8 : 1, 1));
    const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.21, 10); hub.rotateZ(Math.PI / 2);
    add(hub, chrome, T(sx * (W / 2 - 0.085), fl ? r * 0.8 : r, sz * wz), { k: 0.7 });
  });
  const geo = mergeParts(parts);
  geo.computeBoundingSphere();
  carCache.set(key, geo);
  return geo;
}

// traffic cones: n of them stacked (1 = a single cone), standing on y = 0
const coneCache = new Map();
export function coneGeometry(n = 1) {
  if (coneCache.has(n)) return coneCache.get(n);
  const parts = [];
  for (let k = 0; k < n; k++) {
    const y = k * 0.075;
    if (k === 0) parts.push({ geo: new THREE.BoxGeometry(0.34, 0.03, 0.34), color: '#1b1b1c', m: T(0, 0.015, 0) });
    const seg = (r0, r1, y0, y1, color) => { const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 12, 1, true); parts.push({ geo: g, color, m: T(0, y + (y0 + y1) / 2, 0) }); };
    seg(0.13, 0.095, 0.03, 0.2, '#c8501a'); seg(0.095, 0.07, 0.2, 0.32, '#d9d6c8'); seg(0.07, 0.03, 0.32, 0.52, '#c8501a');
    if (k === n - 1) parts.push({ geo: new THREE.CircleGeometry(0.03, 8).rotateX(-Math.PI / 2), color: '#a8431a', m: T(0, y + 0.52, 0) });
  }
  const g = mergeParts(parts);
  g.computeBoundingSphere();
  coneCache.set(n, g);
  return g;
}

// a drain pipe running up a pillar: cast iron, with a collar every metre and two wall brackets. h: its height.
let riser = null;
export function riserGeometry(h = 3) {
  if (riser) return riser;
  const parts = [{ geo: new THREE.CylinderGeometry(0.065, 0.065, h, 10), color: '#4a4640', m: T(0, h / 2, 0) }];
  for (const y of [0.05, 1, 2, h - 0.05]) parts.push({ geo: new THREE.CylinderGeometry(0.08, 0.08, 0.07, 10), color: '#3a3733', m: T(0, y, 0) });
  for (const y of [0.6, 2.4]) parts.push({ geo: new THREE.BoxGeometry(0.22, 0.03, 0.05), color: '#2b2927', m: T(0, y, 0) });
  riser = mergeParts(parts);
  riser.computeBoundingSphere();
  return riser;
}

// ---------- side-room furniture and the fuses (Level 1's first step) ----------
// Each piece is built facing +z (its front, into the room), its back on the wall at z = -depth/2, centred on x;
// garview.js turns it to face the room (yaw) and lights it like the other props.
const box = (w, h, d, x, y, z, color, extra = {}) => ({ geo: new THREE.BoxGeometry(w, h, d), color, m: T(x, y, z), ...extra });
const cyl = (r, h, x, y, z, color, seg = 10) => ({ geo: new THREE.CylinderGeometry(r, r, h, seg), color, m: T(x, y, z) });
// the heights of a rack's shelves (their tops), as in garmap's fuse spots
export const SHELF_TOPS = [0.45, 0.95, 1.45, 1.83];
// steel racking: four orange posts, grey boards, junk on the shelves (kept clear of `keep`: [x, shelf] spots)
export function shelfGeometry(len, depth, R = Math.random, keep = []) {
  const parts = [], post = '#b4652b', board = '#686d71';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.04, 1.86, 0.04, sx * (len / 2 - 0.03), 0.93, sz * (depth / 2 - 0.03), post));
  for (const top of SHELF_TOPS) {
    parts.push(box(len, 0.025, depth - 0.02, 0, top - 0.0125, 0, board));
    parts.push(box(len, 0.05, 0.02, 0, top - 0.03, depth / 2 - 0.02, post));                 // the front edge
  }
  // what is left on the shelves: cardboard boxes, paint tins, a coil of hose (never on a fuse's spot)
  for (let s = 0; s < 3; s++) for (let x = -len / 2 + 0.2; x < len / 2 - 0.15; x += 0.3 + R() * 0.35) {
    if (keep.some(([kx, ks]) => ks === s && Math.abs(kx - x) < 0.32) || R() < 0.3) continue;
    const top = SHELF_TOPS[s], r = R();
    if (r < 0.5) { const w = 0.2 + R() * 0.15, h = 0.12 + R() * 0.2; parts.push(box(w, h, depth * (0.5 + R() * 0.3), x, top + h / 2, (R() - 0.5) * 0.06, ['#8a6a45', '#7a5c3c', '#9a7a52'][Math.floor(R() * 3)])); }
    else if (r < 0.8) { const n = 1 + Math.floor(R() * 3); for (let k = 0; k < n; k++) parts.push(cyl(0.06, 0.14, x + k * 0.13 - 0.1, top + 0.07, (R() - 0.5) * 0.1, ['#7d7f80', '#5c6b4a', '#8a3a2a'][Math.floor(R() * 3)])); }
    else parts.push({ geo: new THREE.TorusGeometry(0.1, 0.03, 6, 12).rotateX(Math.PI / 2), color: '#2c3a2e', m: T(x, top + 0.04, 0) });
  }
  return mergeParts(parts);
}
// an attendant's desk: a worn top on steel legs, a drawer, a clipboard, a mug, an old phone
export function deskGeometry(len, depth) {
  const parts = [], steel = '#4f5559', top = '#6a5a44';
  parts.push(box(len, 0.04, depth + 0.1, 0, 0.74, 0.05, top));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.04, 0.72, 0.04, sx * (len / 2 - 0.05), 0.36, sz * (depth / 2 - 0.02) + 0.05, steel));
  parts.push(box(0.42, 0.18, depth, len / 2 - 0.3, 0.62, 0.05, steel));
  parts.push(box(0.2, 0.02, 0.012, len / 2 - 0.3, 0.62, depth / 2 + 0.1, '#9a9c9e'));            // the drawer handle
  parts.push(box(0.22, 0.012, 0.3, -len / 2 + 0.55, 0.766, 0.02, '#8a6a3a'), box(0.2, 0.004, 0.27, -len / 2 + 0.55, 0.774, 0.025, '#d9d4c4', { flat: 1 }));   // clipboard
  parts.push(cyl(0.04, 0.09, len / 2 - 0.25, 0.805, -0.05, '#c9c2b0'));                           // a mug
  parts.push(box(0.18, 0.07, 0.2, len / 2 - 0.65, 0.795, -0.04, '#262728'), box(0.2, 0.03, 0.05, len / 2 - 0.65, 0.845, -0.04, '#1c1d1e'));   // a phone
  return mergeParts(parts);
}
// a hook board on the wall: a panel with a row of hooks, keys and tags hanging on some (none on a fuse's hook)
export function boardGeometry(len, R = Math.random, keep = []) {
  const parts = [box(len, 0.5, 0.02, 0, 1.55, 0, '#6e5f48')];
  for (let x = -len / 2 + 0.1; x < len / 2 - 0.05; x += 0.15) {
    parts.push(box(0.01, 0.01, 0.06, x, 1.62, 0.04, '#9a9c9e'));
    if (keep.some(k => Math.abs(k - x) < 0.1) || R() < 0.35) continue;
    parts.push(box(0.035, 0.07, 0.004, x, 1.56, 0.05, ['#c9b24a', '#b84a3a', '#d9d4c4', '#4a6a9a'][Math.floor(R() * 4)]), box(0.012, 0.045, 0.004, x, 1.505, 0.05, '#a8a9a4'));
  }
  return mergeParts(parts);
}

// the fuse: a cartridge fuse ("knife-blade" style), about 16 cm, a pale ceramic body with a red band, brass caps and
// blades. Lies along x. on: 'shelf' / 'desk' (in a little open cardboard box) or 'hook' (strapped to a card on a hook).
function fuseParts(holder = null) {
  const r90 = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  const along = (geo) => geo.applyMatrix4(r90);
  const parts = [
    { geo: along(new THREE.CylinderGeometry(0.021, 0.021, 0.09, 12)), color: '#dcd6c4' },
    { geo: along(new THREE.CylinderGeometry(0.0225, 0.0225, 0.016, 12)), color: '#a8321f', m: T(0.012, 0, 0) },
    { geo: along(new THREE.CylinderGeometry(0.0222, 0.0222, 0.012, 12)), color: '#c9a23a', m: T(-0.02, 0, 0) },
  ];
  for (const s of [-1, 1]) {
    parts.push({ geo: along(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 12)), color: '#b08a3e', m: T(s * 0.055, 0, 0) });
    parts.push(box(0.03, 0.034, 0.005, s * 0.078, 0, 0, '#c8a95a'));
  }
  if (holder === 'box') parts.push(box(0.2, 0.015, 0.08, 0, -0.03, 0, '#8a6a45'), box(0.2, 0.04, 0.006, 0, -0.012, 0.037, '#7a5c3c'), box(0.2, 0.04, 0.006, 0, -0.012, -0.037, '#7a5c3c'), box(0.006, 0.04, 0.08, 0.097, -0.012, 0, '#7a5c3c'), box(0.006, 0.04, 0.08, -0.097, -0.012, 0, '#7a5c3c'));
  if (holder === 'card') parts.push(box(0.2, 0.09, 0.004, 0, 0.01, -0.024, '#cfc6ae'), box(0.012, 0.06, 0.004, -0.04, 0.0, 0.024, '#3a3a3a'), box(0.012, 0.06, 0.004, 0.04, 0.0, 0.024, '#3a3a3a'));
  return parts;
}
export function fuseGeometry(on = 'shelf') { return mergeParts(fuseParts(on === 'hook' ? 'card' : on === 'shelf' || on === 'desk' ? 'box' : null)); }
// a fuse to hold in a hand (no box or card): its own lit materials, for players' models and your own hand
export function fuseMesh() {
  const g = new THREE.Group();
  for (const p of fuseParts()) { const m = new THREE.Mesh(p.geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5, metalness: /b08a|c8a9/.test(p.color) ? 0.7 : 0.05 })); if (p.m) m.applyMatrix4(p.m); g.add(m); }
  return g;
}
// the fuse box's front: a grey steel box with a placard, four empty slots (dark sockets with brass clips) in a row and
// the main breaker lever. Its lamps and the fuses in the slots are drawn separately (they change).
export function fuseBoxGeometry(slots) {
  const parts = [box(0.7, 0.95, 0.18, 0, 0, 0, '#59605a'), box(0.62, 0.86, 0.02, 0, 0, 0.1, '#6f7770'),
    box(0.3, 0.08, 0.012, 0, 0.36, 0.116, '#c9b54a', { flat: 1 }), box(0.05, 0.14, 0.05, 0.24, -0.3, 0.13, '#a52a1e'), box(0.09, 0.05, 0.03, 0.24, -0.38, 0.12, '#2a2c2e')];
  for (const x of slots) {
    parts.push(box(0.085, 0.24, 0.015, x, -0.02, 0.112, '#141617', { flat: 1 }));
    for (const s of [-1, 1]) parts.push(box(0.05, 0.022, 0.02, x, -0.02 + s * 0.095, 0.12, '#a8893e'));
    parts.push(box(0.07, 0.05, 0.012, x, 0.19, 0.114, '#2a2c2e'));                               // each lamp's bezel
  }
  return mergeParts(parts);
}
