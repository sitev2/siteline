// Shapes of the things standing about in Level 1's garage: old cars, traffic cones, drain pipes. Built in code
// (our own plain designs), as one merged geometry each with the paint in its vertex colours. The scene (garview.js)
// uses them for the real props, and the shapeshifter's model (shiftmodel.js) uses the very same shapes when it
// pretends to be one, so a copy can't be told from the real thing by its shape.
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
