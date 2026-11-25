// FPV drones: the maps. Three free-flight maps (Bando, Skyline, Valley), three race circuits (Meadow Cup, Hangar,
// Canyon Run), and every map of the rest of the game for free flight (built from world.js's grid).
// All our own designs. Built from simple shapes so the host, the players' games and the checks share them:
//   solids: { t: 'box' (turned about Y by ry), 'cyl', 'cone', 'sph', 'cap' (capsule a → b) , mat, nocol, novis }
//   ground: a height field (map.height(x, z) sampled every map.res metres), waters: [{ y, x0, z0, x1, z1 }]
//   trees, gates (race order; gate 0 is the start/finish line), spawns (launch pads), deco (drawn only), rotors.
import { hash2, World } from './world.js';
import { MAPS, resolveMap, isDmMap } from './maps.js';
import { gateFrame, MapCollider, GridCollider, DRONE, groundHeight } from './dronephys.js';

// ---------- noise ----------
function vnoise(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf), s = seed * 131;
  const a = hash2(xi + s, zi), b = hash2(xi + 1 + s, zi), c = hash2(xi + s, zi + 1), d = hash2(xi + 1 + s, zi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function fbm(x, z, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f, seed + i); f *= 2.03; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
let seedN = 1;
const rnd = () => hash2(seedN++ * 7 + 3, seedN * 13 + 1);

// ---------- building blocks ----------
function begin(o) {
  seedN = o.seed || 1;
  return { solids: [], trees: [], gates: [], spawns: [], deco: [], rotors: [], waters: [], ...o };
}
// box standing on y0 (x, z = its middle), turned ry about Y
const box = (m, x, y0, z, sx, sy, sz, mat, ry = 0, o = {}) => { m.solids.push({ t: 'box', x, y: y0 + sy / 2, z, sx, sy, sz, ry, mat, ...o }); };
const cyl = (m, x, y0, z, r, h, mat, o = {}) => { m.solids.push({ t: 'cyl', x, z, y0, y1: y0 + h, r, mat, ...o }); };
const cone = (m, x, y0, z, r, h, mat, o = {}) => { m.solids.push({ t: 'cone', x, z, y0, y1: y0 + h, r, mat, ...o }); };
const sph = (m, x, y, z, r, mat, o = {}) => { m.solids.push({ t: 'sph', x, y, z, r, mat, ...o }); };
const cap = (m, a, b, r, mat, o = {}) => { m.solids.push({ t: 'cap', a, b, r, mat, ...o }); };
const deco = (m, kind, o) => { m.deco.push({ kind, ...o }); };
const gh = (m, x, z) => (m.height ? m.height(x, z) : 0);

// a tree: pine (cone canopy), leaf (round crown) or dead (bare)
function tree(m, x, z, h, kind = 'pine') {
  const y = gh(m, x, z);
  const r = kind === 'pine' ? h * 0.22 : h * 0.3;
  m.trees.push({ x, y, z, h, r, kind, tint: rnd() });
  cap(m, [x, y, z], [x, y + h * (kind === 'dead' ? 0.9 : 0.45), z], Math.max(0.15, h * 0.03), 'bark', { novis: true });
  if (kind === 'pine') cone(m, x, y + h * 0.2, z, r * 0.8, h * 0.8, 'leaf', { novis: true });
  else if (kind === 'leaf') sph(m, x, y + h * 0.62, z, r * 0.85, 'leaf', { novis: true });
}

// a launch pad (spawn)
function pad(m, x, z, yaw, y = null) {
  const g = y == null ? gh(m, x, z) : y;
  m.spawns.push({ x, y: g + 0.08 + DRONE.r + 0.02, z, yaw });
  deco(m, 'pad', { x, y: g, z, yaw });
}

// a race gate. (x, y, z) the middle of the opening, yaw the way through it, pitch -π/2 = a dive gate (fly down
// through it). kind: square | arch | ring | led. w, h: the opening. stand: legs down to the ground.
function gate(m, x, y, z, yaw, o = {}) {
  const kind = o.kind || 'square', pitch = o.pitch || 0;
  const w = o.w || (kind === 'ring' ? 4.2 : 3.6), h = o.h || (kind === 'arch' ? 3.4 : kind === 'ring' ? 4.2 : 2.6);
  const { n, u, v } = gateFrame(yaw, pitch);
  const g = { i: m.gates.length, kind, c: [x, y, z], n, u, v, yaw, pitch, hw: w / 2, hh: h / 2, color: o.color || null };
  const R = kind === 'led' ? 0.11 : 0.14;
  const P = (a, b) => [x + u[0] * a + v[0] * b, y + u[1] * a + v[1] * b, z + u[2] * a + v[2] * b];
  if (kind === 'ring') {
    g.rad = w / 2;
    const N = 20;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      cap(m, P(Math.cos(a0) * (g.rad + R), Math.sin(a0) * (g.rad + R)), P(Math.cos(a1) * (g.rad + R), Math.sin(a1) * (g.rad + R)), R, 'gate', { novis: true });
    }
  } else if (kind === 'arch') {
    // (x, y, z) is still the middle: the arch's feet are hh below it
    g.arch = true;
    const N = 12, hw = g.hw + R, H = h + R;
    let prev = P(-hw, -g.hh);
    for (let k = 1; k <= N; k++) {
      const a = Math.PI - (k / N) * Math.PI, p = P(Math.cos(a) * hw, -g.hh + Math.sin(a) * H);
      cap(m, prev, p, R * 1.6, 'gate', { novis: true });
      prev = p;
    }
  } else {
    const hw = g.hw + R, hh = g.hh + R;
    const c = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
    for (let k = 0; k < 4; k++) cap(m, c[k], c[(k + 1) % 4], R, 'gate', { novis: true });
  }
  // legs down to the ground (upright gates that float above it, and dive gates on a scaffold)
  if (o.stand !== false) {
    const legs = pitch ? [P(-g.hw - R, -g.hh - R), P(g.hw + R, -g.hh - R), P(g.hw + R, g.hh + R), P(-g.hw - R, g.hh + R)]
      : kind === 'ring' ? [P(0, -g.rad - R)] : kind === 'arch' ? [] : [P(-g.hw - R, -g.hh - R), P(g.hw + R, -g.hh - R)];
    g.legs = [];
    for (const p of legs) {
      const floor = o.floor != null ? o.floor : gh(m, p[0], p[2]);
      if (p[1] - floor > 0.15) { cap(m, [p[0], floor, p[2]], p, 0.07, 'steel', { novis: true }); g.legs.push([p[0], floor, p[2], p[1]]); }
    }
  }
  m.gates.push(g);
  return g;
}
const yawTo = (ax, az, bx, bz) => Math.atan2(-(bx - ax), -(bz - az));
// a line of gates: each faces the way from the one before to the one after
function course(m, list, floorOf = null) {
  const pts = list.map(e => ({ ...e }));
  for (let i = 0; i < pts.length; i++) {
    const e = pts[i];
    if (e.yaw == null) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
      const y1 = yawTo(a.x, a.z, e.x, e.z), y2 = yawTo(e.x, e.z, b.x, b.z);
      let d = y2 - y1; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      e.yaw = y1 + d / 2;
    }
    const base = floorOf ? floorOf(e.x, e.z) : gh(m, e.x, e.z);
    gate(m, e.x, base + e.up, e.z, e.yaw, e);
  }
}

// a building (box) with a flat roof and a few things on top
function building(m, x, z, sx, sz, h, mat, ry = 0, top = true) {
  const y = gh(m, x, z);
  box(m, x, y - 1, z, sx, h + 1, sz, mat, ry);
  box(m, x, y + h, z, sx + 0.3, 0.5, sz + 0.3, 'parapet', ry);
  if (!top) return;
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const [px, pz] = at((rnd() - 0.5) * (sx - 5), (rnd() - 0.5) * (sz - 5));
    if (rnd() < 0.35) { cyl(m, px, y + h + 0.5, pz, 1.4, 3.2, 'tank'); cone(m, px, y + h + 3.7, pz, 1.5, 0.9, 'tank'); }
    else box(m, px, y + h + 0.5, pz, 2 + rnd() * 2.5, 1.4 + rnd(), 1.6 + rnd() * 2, 'unit', ry);
  }
  if (rnd() < 0.4) { const [px, pz] = at((rnd() - 0.5) * (sx - 3), (rnd() - 0.5) * (sz - 3)); cap(m, [px, y + h + 0.5, pz], [px, y + h + 6 + rnd() * 8, pz], 0.07, 'steel'); }
}
// a gabled house: walls (collide), a roof drawn as a prism (collides up to its middle, plus its ridge)
function house(m, x, z, sx, sz, h, ry, wall = 'plaster', roof = 'tiles') {
  const y = gh(m, x, z) - 0.5;
  box(m, x, y, z, sx, h + 0.5, sz, wall, ry);
  const rh = Math.min(sx, sz) * 0.42;
  deco(m, 'roof', { x, y: y + h + 0.5, z, sx: sx + 0.8, sz: sz + 0.8, h: rh, ry, mat: roof });
  box(m, x, y + h + 0.5, z, sx * 0.6, rh * 0.5, sz + 0.6, roof, ry, { novis: true });
  const c = Math.cos(ry), s = Math.sin(ry), L = (sz + 0.8) / 2;
  cap(m, [x - s * L, y + h + 0.5 + rh * 0.95, z - c * L], [x + s * L, y + h + 0.5 + rh * 0.95, z + c * L], 0.2, roof, { novis: true });
}
// a lattice tower (pylons, crane masts): 4 legs + braces
function lattice(m, x, z, y0, h, base, top, mat = 'steel', r = 0.12, bands = 6) {
  const corner = (k, t) => { const s = lerp(base, top, t) / 2, a = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k]; return [x + a[0] * s, y0 + h * t, z + a[1] * s]; };
  for (let k = 0; k < 4; k++) cap(m, corner(k, 0), corner(k, 1), r, mat);
  for (let b = 1; b <= bands; b++) {
    const t0 = (b - 1) / bands, t1 = b / bands;
    for (let k = 0; k < 4; k++) {
      cap(m, corner(k, t1), corner((k + 1) % 4, t1), r * 0.6, mat);
      cap(m, corner(k, t0), corner((k + 1) % 4, t1), r * 0.45, mat);
    }
  }
}
// an open concrete frame (no walls): columns and floor slabs, with holes in the slabs
function frame(m, x0, z0, nx, nz, bay, floors, fh, mat = 'concrete', holes = []) {
  const W = nx * bay, D = nz * bay, y = gh(m, x0 + W / 2, z0 + D / 2);
  for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) box(m, x0 + i * bay, y - 0.5, z0 + k * bay, 0.6, floors * fh + 0.5, 0.6, mat);
  for (let f = 1; f <= floors; f++) {
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      if (holes.some(hh => hh[0] === i && hh[1] === k && (hh[2] == null || hh[2] === f))) continue;
      box(m, x0 + (i + 0.5) * bay, y + f * fh - 0.35, z0 + (k + 0.5) * bay, bay + 0.6, 0.35, bay + 0.6, mat);
    }
  }
}

// ============================================================================================
// the maps
// ============================================================================================
const LOOKS = {
  overcast: { sky: ['#7d8c9c', '#cfd5d8'], fog: '#c3c9cc', fogFar: 330, sun: '#fff4e4', sunI: 1.7, sunDir: [0.4, 0.75, 0.3], hemi: ['#dfe7ee', '#6e6a60', 1.5], amb: 'industrial' },
  clear: { sky: ['#3f86d6', '#dceaf5'], fog: '#d5e3ee', fogFar: 520, sun: '#fff2dc', sunI: 2.6, sunDir: [-0.45, 0.62, 0.35], hemi: ['#d4e6ff', '#8a7d68', 1.25], amb: 'village' },
  valley: { sky: ['#4a8fd8', '#e6eef0'], fog: '#cfdde4', fogFar: 600, sun: '#fff0d4', sunI: 2.7, sunDir: [0.5, 0.55, -0.4], hemi: ['#d2e6ff', '#6c7a4a', 1.3], amb: 'snow' },
  meadow: { sky: ['#4b92dc', '#e2eef4'], fog: '#d8e6ec', fogFar: 420, sun: '#fff3dc', sunI: 2.6, sunDir: [-0.3, 0.7, 0.45], hemi: ['#d4e8ff', '#6f8048', 1.3], amb: 'village' },
  hangar: { sky: ['#20242a', '#2b3038'], fog: '#1d2126', fogFar: 260, sun: '#e8eeff', sunI: 0.9, sunDir: [0.2, 1, 0.1], hemi: ['#9aa6b8', '#3a3a3a', 1.6], amb: 'industrial', indoor: true },
  canyon: { sky: ['#5b8fcf', '#f3dcc0'], fog: '#e8d2b6', fogFar: 600, sun: '#fff0d8', sunI: 2.8, sunDir: [0.55, 0.5, 0.3], hemi: ['#cfe0ff', '#9a6a44', 1.3], amb: 'desert' },
};

// ---------- Bando: an abandoned factory yard ----------
function bando() {
  const m = begin({ id: 'bando', name: 'Bando', kind: 'free', seed: 11, size: [260, 260], ceil: 95, res: 2, look: LOOKS.overcast,
    desc: 'An empty factory yard: a roofless hall, a concrete frame, a chimney and a water tower to dive.',
    groundMat: 'yard' });
  m.height = (x, z) => {
    const edge = Math.min(x, z, 260 - x, 260 - z);
    return 0.35 * (fbm(x / 22, z / 22, 3, 2) - 0.5) + 7 * (1 - sstep(4, 30, edge));
  };
  // the big hall: 80 × 40, 14 m tall, walls full of window holes, half its roof gone
  const X0 = 70, X1 = 150, Z0 = 60, Z1 = 100, H = 14, T = 0.7;
  for (const zw of [Z0, Z1]) {
    // the low wall (0–3 m) with gaps knocked through under some windows, piers between the windows, the wall above them
    const gaps = zw === Z0 ? [98] : [82, 130];
    let from = X0 - T / 2;
    for (const g of [...gaps, Infinity]) {
      const to = Math.min(g - 3, X1 + T / 2);
      if (to > from) box(m, (from + to) / 2, -0.5, zw, to - from, 3.5, T, 'brick');
      from = g + 3;
    }
    box(m, (X0 + X1) / 2, 10, zw, X1 - X0 + T, H - 10, T, 'brick');
    for (let x = X0; x <= X1; x += 8) box(m, x, 3, zw, 2, 7, T, 'brick');
  }
  for (const xw of [X0, X1]) {
    box(m, xw, -0.5, Z0 + 7.5, T, H + 0.5, 15, 'brick');
    box(m, xw, -0.5, Z1 - 7.5, T, H + 0.5, 15, 'brick');
    box(m, xw, 9.5, (Z0 + Z1) / 2, T, H - 9.5, 10.5, 'brick');
  }
  // roof trusses every 10 m, roof sheets on some bays, columns down the middle
  for (let x = X0 + 10; x < X1; x += 10) {
    cap(m, [x, H, Z0], [x, H, Z1], 0.25, 'rust');
    cap(m, [x, H, Z0], [x, H + 4, (Z0 + Z1) / 2], 0.18, 'rust');
    cap(m, [x, H + 4, (Z0 + Z1) / 2], [x, H, Z1], 0.18, 'rust');
    cyl(m, x, 0, (Z0 + Z1) / 2, 0.4, H + 4, 'rust');
  }
  for (const [a, b] of [[X0, X0 + 20], [X0 + 40, X0 + 50], [X1 - 10, X1]]) {
    for (const side of [0, 1]) {
      const z0 = side ? (Z0 + Z1) / 2 : Z0, z1 = side ? Z1 : (Z0 + Z1) / 2;
      if (a === X0 + 40 && side === 1) continue;
      deco(m, 'sheet', { x0: a, x1: b, z0, z1, y0: side ? H + 4 : H, y1: side ? H : H + 4 });
      // the sheet as collision: a thin sloping slab made of steps
      for (let k = 0; k < 6; k++) {
        const t = (k + 0.5) / 6, zz = lerp(z0, z1, t), yy = lerp(side ? H + 4 : H, side ? H : H + 4, t);
        box(m, (a + b) / 2, yy - 0.1, zz, b - a, 0.25, (z1 - z0) / 6 + 0.1, 'sheet', 0, { novis: true });
      }
    }
  }
  // a mezzanine inside, along the north wall
  box(m, 92, 6, 66.5, 36, 0.4, 12, 'concrete');
  for (let x = 76; x <= 108; x += 8) cyl(m, x, 0, 72, 0.3, 6, 'rust');
  deco(m, 'rail', { a: [74, 7.2, 72.5], b: [110, 7.2, 72.5] });
  cap(m, [74, 7.2, 72.5], [110, 7.2, 72.5], 0.05, 'rust', { novis: true });

  // the skeleton: a 4-storey concrete frame with holes in the floors
  frame(m, 172, 136, 4, 3, 6, 4, 4, 'concrete', [[0, 0], [3, 2, 2], [1, 2, 3], [2, 1, 4], [3, 0, 1]]);
  cyl(m, 178, 16.05, 145, 2.2, 4, 'tank'); cone(m, 178, 20.05, 145, 2.4, 1.2, 'tank');
  // the chimney
  cyl(m, 118, -1, 182, 3, 49, 'brick'); cyl(m, 118, 44, 182, 3.4, 2, 'concrete');
  // two tanks with a pipe rack running from them to the hall
  cyl(m, 36, -1, 150, 8, 12, 'rust'); cyl(m, 36, -1, 182, 6, 15, 'rust');
  for (let z = 100; z <= 150; z += 12.5) {
    box(m, 56, -0.5, z, 0.5, 8, 0.5, 'steel'); box(m, 60, -0.5, z, 0.5, 8, 0.5, 'steel');
    box(m, 58, 7.5, z, 4.8, 0.4, 0.5, 'steel');
  }
  cap(m, [57, 8.4, 100], [57, 8.4, 152], 0.45, 'pipe'); cap(m, [59, 8.3, 100], [59, 8.3, 152], 0.3, 'pipe');
  cap(m, [57, 8.4, 152], [44, 8.4, 152], 0.45, 'pipe'); cap(m, [57, 8.4, 100], [X0, 8.4, 100 - 4], 0.45, 'pipe');
  cap(m, [59, 8.3, 100], [X0, 8.3, 97], 0.3, 'pipe');
  // the water tower: four legs, a tank on top
  const wx = 205, wz = 55;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cap(m, [wx + a * 5, 0, wz + b * 5], [wx + a * 2.6, 17, wz + b * 2.6], 0.3, 'rust');
  for (const yy of [6, 12]) { const s = lerp(5, 2.6, yy / 17); for (const [a, b, c, d] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) cap(m, [wx + a * s, yy, wz + b * s], [wx + c * s, yy, wz + d * s], 0.14, 'rust'); }
  cyl(m, wx, 17, wz, 4.2, 6, 'tank'); cone(m, wx, 23, wz, 4.5, 2.5, 'tank');
  // shipping containers
  const cols = ['cont1', 'cont2', 'cont3', 'cont4'];
  for (const [x, z, ry, n] of [[176, 92, 0, 3], [176, 98.5, 0, 2], [188, 106, 0.4, 1], [196, 88, Math.PI / 2, 2], [168, 110, 1.2, 1], [208, 112, 0.1, 3]]) {
    for (let k = 0; k < n; k++) box(m, x, k * 2.6, z, 12, 2.6, 2.45, cols[Math.floor(rnd() * 4)], ry + (rnd() - 0.5) * 0.06);
  }
  // power pylons with lines across the yard
  for (const [x, z] of [[20, 30], [130, 24], [240, 30]]) { lattice(m, x, z, gh(m, x, z) - 0.5, 30, 7, 1.6, 'steel', 0.14, 7); box(m, x, 27, z, 1, 0.6, 12, 'steel'); }
  deco(m, 'wires', { pts: [[20, 27.6, 24], [130, 27.6, 18], [240, 27.6, 24]] });
  deco(m, 'wires', { pts: [[20, 27.6, 36], [130, 27.6, 30], [240, 27.6, 36]] });
  // broken walls and rubble
  for (let i = 0; i < 14; i++) {
    const x = 20 + rnd() * 220, z = 115 + rnd() * 110;
    if (Math.hypot(x - 118, z - 182) < 12 || (x > 160 && x < 210 && z > 130 && z < 165) || (x > 25 && x < 50 && z > 135 && z < 195) || z > 212) continue;
    box(m, x, gh(m, x, z) - 0.5, z, 4 + rnd() * 9, 1.5 + rnd() * 3.5, 0.5, 'concrete', rnd() * 3);
  }
  for (let i = 0; i < 30; i++) {
    const x = 8 + rnd() * 244, z = 8 + rnd() * 244;
    if ((x > 60 && x < 230 && z > 40 && z < 200) || (x > 30 && x < 75 && z > 215)) continue;
    tree(m, x, z, 7 + rnd() * 7, rnd() < 0.3 ? 'dead' : 'leaf');
  }
  for (let i = 0; i < 6; i++) pad(m, 40 + i * 5, 228, 0);
  return m;
}

// ---------- Skyline: city blocks ----------
function skyline() {
  const N = 5, BLK = 56, ST = 18, S = N * (BLK + ST) + ST;
  const m = begin({ id: 'skyline', name: 'Skyline', kind: 'free', seed: 23, size: [S, S], ceil: 150, res: 4, look: LOOKS.clear,
    desc: 'City blocks: towers with a sky bridge, a crane over a building site, a car park and a railway on stilts.',
    groundMat: 'city', streets: { n: N, blk: BLK, st: ST } });
  const o = i => ST + i * (BLK + ST);          // a block's west / north edge
  const FAC = ['facade1', 'facade2', 'facade3', 'facade4'];
  const special = { '1,1': 'twins', '3,1': 'garage', '2,2': 'park', '1,3': 'site', '3,3': 'spire' };
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
    const x0 = o(i) + 3, z0 = o(k) + 3, w = BLK - 6, cx = x0 + w / 2, cz = z0 + w / 2;
    const sp = special[`${i},${k}`];
    if (sp === 'twins') {
      building(m, cx - 13, cz, 18, 20, 96, 'facade2', 0, false);
      building(m, cx + 13, cz, 18, 20, 88, 'facade2', 0, false);
      box(m, cx, 60, cz, 8.2, 5, 6, 'glass');           // the sky bridge (fly under it, or over it)
      cap(m, [cx - 13, 96.5, cz], [cx - 13, 118, cz], 0.18, 'steel');
    } else if (sp === 'garage') {
      // a car park: open floors on columns
      for (let f = 0; f < 6; f++) box(m, cx, f * 3.6 + 3.2, cz, w - 4, 0.4, w - 14, 'concrete');
      for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++) box(m, cx + a * (w - 6) / 4, -0.5, cz + b * (w - 16) / 2, 0.7, 6 * 3.6 + 4, 0.7, 'concrete');
      for (let f = 1; f < 7; f++) for (const s of [-1, 1]) box(m, cx, f * 3.6 - 0.4, cz + s * ((w - 14) / 2 - 0.1), w - 4, 0.9, 0.25, 'parapet');
      deco(m, 'cars', { x: cx, z: cz, w: w - 6, d: w - 16, floors: 6, fh: 3.6 });
    } else if (sp === 'park') {
      for (let t = 0; t < 26; t++) {
        const x = x0 + 3 + rnd() * (w - 6), z = z0 + 3 + rnd() * (w - 6);
        if (Math.hypot(x - cx, z - cz) < 11 || (z > cz + 10 && Math.abs(x - cx) < 17)) continue;
        tree(m, x, z, 8 + rnd() * 6, 'leaf');
      }
      cyl(m, cx, 0, cz, 4.5, 0.8, 'stone'); cyl(m, cx, 0.8, cz, 0.6, 2.6, 'stone'); sph(m, cx, 3.6, cz, 1.1, 'stone');
      deco(m, 'pond', { x: cx, z: cz, r: 4 });
      for (let a = 0; a < 6; a++) pad(m, cx - 12.5 + a * 5, cz + 16, 0);
    } else if (sp === 'site') {
      // a building going up: a tall concrete frame and a tower crane
      frame(m, x0 + 4, z0 + 4, 3, 3, 8, 9, 3.6, 'concrete', [[1, 1, 9], [0, 2, 8], [2, 0, 9], [2, 2, 7], [0, 0, 9]]);
      const mx = x0 + w - 8, mz = z0 + w - 8;
      lattice(m, mx, mz, -0.5, 66, 2.2, 2.2, 'crane', 0.12, 22);
      cap(m, [mx, 66, mz], [mx - 48, 66, mz], 0.35, 'crane'); cap(m, [mx, 66, mz + 1.1], [mx - 48, 66, mz + 1.1], 0.2, 'crane');
      cap(m, [mx, 66, mz], [mx + 14, 66, mz], 0.4, 'crane');
      box(m, mx + 11, 63.5, mz, 4, 2.6, 2.5, 'concrete');
      cap(m, [mx, 72, mz], [mx - 46, 66.4, mz], 0.06, 'steel'); cap(m, [mx, 72, mz], [mx + 13, 66.4, mz], 0.06, 'steel');
      box(m, mx - 0.1, 64, mz, 3, 2.5, 2.6, 'cab');
      deco(m, 'hook', { x: mx - 30, y0: 66, y1: 30, z: mz });
      cap(m, [mx - 30, 66, mz], [mx - 30, 30, mz], 0.05, 'steel', { novis: true });
      box(m, mx - 30, 28.6, mz, 1.2, 1.4, 1.2, 'cont1');
    } else if (sp === 'spire') {
      building(m, cx, cz, 26, 26, 112, 'facade3', 0, false);
      building(m, cx, cz, 16, 16, 128, 'glass', 0, false);
      cap(m, [cx, 128.5, cz], [cx, 146, cz], 0.35, 'steel');
    } else {
      // ordinary block: one to four buildings
      const split = rnd();
      const parts = split < 0.3 ? [[0, 0, 1, 1]] : split < 0.65 ? [[0, 0, 0.5, 1], [0.5, 0, 1, 1]] : [[0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5], [0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]];
      for (const [a, b, c, d] of parts) {
        const bw = (c - a) * w - 3, bd = (d - b) * w - 3;
        const h = 9 + Math.floor(rnd() * 14) * 4 + (i === 2 || k === 2 ? 12 : 0);
        building(m, x0 + (a + c) / 2 * w, z0 + (b + d) / 2 * w, bw, bd, h, FAC[Math.floor(rnd() * 4)]);
      }
    }
  }
  // a railway on stilts along one street
  const rz = o(3) - ST / 2;
  for (let x = 6; x <= S - 6; x += 16) { box(m, x, -0.5, rz, 1.2, 9.5, 1.6, 'concrete'); }
  box(m, S / 2, 9, rz, S - 4, 1.2, 6, 'concrete');
  box(m, S / 2, 10.2, rz - 2.9, S - 4, 1, 0.25, 'parapet'); box(m, S / 2, 10.2, rz + 2.9, S - 4, 1, 0.25, 'parapet');
  deco(m, 'train', { x: S * 0.3, y: 10.2, z: rz });
  box(m, S * 0.3, 10.2, rz, 40, 3.4, 3, 'train', 0, { novis: true });
  // street lamps
  for (let i = 0; i <= N; i++) for (let k = 0; k < N * 3; k++) {
    const x = o(i) - ST / 2 - 7.5, z = ST + k * (BLK + ST) / 3 + 10;
    if (Math.abs(z - rz) < 6) continue;
    cap(m, [x, 0, z], [x, 7, z], 0.1, 'steel'); deco(m, 'lamp', { x, y: 7, z });
  }
  return m;
}

// ---------- Valley: hills, a river, woods ----------
function valley() {
  const S = 400;
  const m = begin({ id: 'valley', name: 'Valley', kind: 'free', seed: 37, size: [S, S], ceil: 170, res: 2, look: LOOKS.valley,
    desc: 'A green valley: a river with a waterfall, a stone bridge, a farm, wind turbines on the ridge and a rock arch.',
    groundMat: 'grass' });
  const riverX = z => 190 + 46 * Math.sin(z / 75) + 14 * Math.sin(z / 23 + 1);
  const STEP = 110;              // the waterfall: upstream (z < STEP) the valley floor is higher
  m.riverX = riverX;
  m.height = (x, z) => {
    const edge = Math.min(x, z, S - x, S - z);
    const rx = riverX(z), d = Math.abs(x - rx);
    const up = 13 * sstep(STEP + 4, STEP - 4, z);
    let h = up + 8 * (fbm(x / 90, z / 90, 4, 5) - 0.4) + 22 * sstep(30, 140, d) * fbm(x / 60 + 7, z / 60, 3, 9);
    h += 4 * sstep(14, 40, d);
    if (d < 13) h = lerp(h, up - 1.8, sstep(13, 6, d));       // the river bed
    // a lake in a bowl
    const ld = Math.hypot(x - 300, z - 300);
    if (ld < 55) h = lerp(h, -2.5, sstep(55, 30, ld));
    h += 85 * (1 - sstep(10, 75, edge)) * (0.6 + 0.4 * fbm(x / 40, z / 40, 3, 3));
    return h;
  };
  m.waters.push({ y: 0.6, x0: 0, z0: STEP, x1: S, z1: S });
  m.waters.push({ y: 13.4, x0: 0, z0: 0, x1: S, z1: STEP });
  deco(m, 'fall', { x: riverX(STEP), z: STEP, y0: 0.6, y1: 13.4, w: 18 });
  // the stone bridge over the river
  const bz = 200, bx = riverX(bz);
  const deckY = gh(m, bx + 30, bz) + 0.5;
  box(m, bx, deckY + 6, bz, 44, 1.2, 6, 'stone', 0.0);
  for (const s of [-1, 1]) { box(m, bx + s * 9, -2, bz, 3, deckY + 8, 6, 'stone'); box(m, bx + s * 22, -2, bz, 3, deckY + 8, 6.4, 'stone'); }
  box(m, bx, deckY + 7.2, bz - 2.8, 44, 1, 0.4, 'stone'); box(m, bx, deckY + 7.2, bz + 2.8, 44, 1, 0.4, 'stone');
  // the farm: a barn, a house, a silo, fields
  const fx = 110, fz = 300;
  house(m, fx, fz, 14, 22, 7, 0.3, 'barn', 'tin');
  house(m, fx + 26, fz + 14, 9, 11, 5.5, 0.3, 'plaster', 'tiles');
  cyl(m, fx - 14, gh(m, fx - 14, fz - 10) - 1, fz - 10, 3, 17, 'silo'); sph(m, fx - 14, gh(m, fx - 14, fz - 10) + 16, fz - 10, 3, 'silo');
  for (let a = 0; a < 6; a++) pad(m, fx + 8 + a * 5, fz - 22, Math.PI * 0.85);
  deco(m, 'field', { x0: 60, z0: 320, x1: 150, z1: 370 });
  // wind turbines on the eastern ridge (the blades spin and are solid)
  for (const z of [120, 190, 260]) {
    const x = 330 + (z % 3) * 4, y = gh(m, x, z);
    cyl(m, x, y - 1, z, 1.3, 57, 'white');
    box(m, x, y + 56, z, 2.4, 2.6, 6.5, 'white', Math.PI / 2 + 0.25);
    m.rotors.push({ x, y: y + 57.3, z, yaw: Math.PI / 2 + 0.25, len: 24, hub: 3.7, speed: 0.9 + (z % 7) * 0.05 });
  }
  // a rock arch on the west slopes
  const ax = 70, az = 150, ag = gh(m, ax, az);
  for (let k = 0; k <= 14; k++) {
    const a = (k / 14) * Math.PI, r = 4.2 - Math.sin(a) * 1.6;
    sph(m, ax + Math.cos(a) * 14, ag + Math.sin(a) * 16 + 1, az + Math.sin(k * 1.7) * 0.8, r, 'rock');
  }
  // rocks
  for (let i = 0; i < 40; i++) { const x = 15 + rnd() * 370, z = 15 + rnd() * 370; if (Math.abs(x - riverX(z)) < 16) continue; sph(m, x, gh(m, x, z) + 0.4, z, 1 + rnd() * 2.6, 'rock'); }
  // woods: pines on the slopes, round trees by the water
  let n = 0;
  for (let i = 0; i < 1400 && n < 520; i++) {
    const x = 8 + rnd() * (S - 16), z = 8 + rnd() * (S - 16);
    const d = Math.abs(x - riverX(z));
    if (d < 15 || Math.hypot(x - 300, z - 300) < 48 || (x > 50 && x < 160 && z > 270 && z < 380) || Math.hypot(x - bx, z - bz) < 30 || Math.hypot(x - ax, z - az) < 22 || x > 312 && x < 352 && z > 100 && z < 280) continue;
    const dens = fbm(x / 50, z / 50, 3, 17);
    if (dens < 0.48) continue;
    tree(m, x, z, 9 + rnd() * 9, d < 40 && rnd() < 0.6 ? 'leaf' : 'pine');
    n++;
  }
  return m;
}

// ---------- Meadow Cup: the beginners' circuit on a field ----------
function meadow() {
  const S = 240;
  const m = begin({ id: 'meadow', name: 'Meadow Cup', kind: 'race', seed: 51, size: [S, S], ceil: 80, res: 2, look: LOOKS.meadow,
    desc: 'A grass field with flags and tents. Wide gates, a ring, an arch and one dive gate on a tower.', groundMat: 'grass' });
  m.height = (x, z) => 1.4 * (fbm(x / 45, z / 45, 3, 21) - 0.5) + 14 * (1 - sstep(4, 34, Math.min(x, z, S - x, S - z)));
  course(m, [
    { x: 120, z: 188, up: 1.8, kind: 'arch', w: 6, h: 4.2, yaw: 0, color: 'start' },
    { x: 120, z: 148, up: 1.7 },
    { x: 134, z: 110, up: 4, h: 2.8 },
    { x: 166, z: 80, up: 4.6, kind: 'ring' },
    { x: 196, z: 58, up: 2.2, kind: 'arch' },
    { x: 172, z: 30, up: 1.9 },
    { x: 130, z: 36, up: 9, pitch: -Math.PI / 2, yaw: Math.PI / 2, w: 3.6, h: 3.6 },
    { x: 98, z: 60, up: 1.6 },
    { x: 72, z: 92, up: 1.9, kind: 'arch' },
    { x: 58, z: 132, up: 3.2, kind: 'ring' },
    { x: 66, z: 176, up: 2.2 },
    { x: 92, z: 208, up: 1.9, yaw: -Math.PI / 2 - 0.35 },
  ]);
  // the dive gate stands on a scaffold tower: platform under it is open
  // flags at the turns, tents and banners by the start
  for (const [x, z] of [[205, 40], [52, 112], [80, 222], [150, 24], [40, 150]]) deco(m, 'flag', { x, y: gh(m, x, z), z, c: rnd() });
  for (const [x, z] of [[150, 205], [160, 205], [170, 205]]) { box(m, x, gh(m, x, z) - 0.3, z, 7, 2.8, 5, 'tent', 0, { novis: true }); deco(m, 'tent', { x, y: gh(m, x, z), z, c: rnd() }); }
  for (let z = 152; z <= 184; z += 8) for (const s of [-1, 1]) deco(m, 'banner', { x: 120 + s * 8, y: gh(m, 120 + s * 8, z), z, ry: s * Math.PI / 2 });
  for (let i = 0; i < 18; i++) {
    const x = 30 + rnd() * 180, z = 30 + rnd() * 180;
    if (m.gates.some(g => Math.hypot(g.c[0] - x, g.c[2] - z) < 14) || Math.hypot(x - 120, z - 205) < 22) continue;
    cyl(m, x, gh(m, x, z) - 0.1, z, 0.75, 1.3, 'hay');
  }
  for (let i = 0; i < 60; i++) {
    const x = 6 + rnd() * (S - 12), z = 6 + rnd() * (S - 12);
    if (x > 30 && x < 215 && z > 14 && z < 228) continue;
    tree(m, x, z, 8 + rnd() * 8, rnd() < 0.5 ? 'leaf' : 'pine');
  }
  for (let i = 0; i < 6; i++) pad(m, 108 + i * 4.8, 202, 0);
  return m;
}

// ---------- Hangar: an indoor circuit ----------
function hangar() {
  const W = 150, D = 72, H = 24;
  const m = begin({ id: 'hangar', name: 'Hangar', kind: 'race', seed: 67, size: [W, D], ceil: H, hardCeil: true, res: 4, look: LOOKS.hangar,
    desc: 'A huge aircraft hangar at night: glowing gates under a wing, over a crane beam, through a tunnel of containers.',
    groundMat: 'hangar', indoor: { W, D, H } });
  // a cargo plane (our own shape): fuselage, wings, engines, tail
  const px = 46, pz = 40;
  cap(m, [px - 17, 3.8, pz], [px + 15, 3.8, pz], 2.4, 'plane');
  sph(m, px + 16, 3.6, pz, 2.2, 'plane');
  box(m, px, 5.2, pz, 4.8, 0.5, 40, 'plane');
  for (const s of [-1, 1]) { cap(m, [px - 3, 4.2, pz + s * 9], [px + 3.5, 4.2, pz + s * 9], 1, 'engine'); deco(m, 'prop', { x: px + 3.8, y: 4.2, z: pz + s * 9 }); }
  box(m, px - 16, 5.5, pz, 3.2, 6, 0.5, 'plane');
  box(m, px - 16, 6.5, pz, 2.6, 0.35, 14, 'plane');
  for (const [x, z] of [[px + 12, pz], [px - 2, pz - 4], [px - 2, pz + 4]]) cap(m, [x, 0, z], [x, 2, z], 0.25, 'steel');
  // a small jet
  const jx = 108, jz = 16;
  cap(m, [jx - 9, 2.4, jz], [jx + 9, 2.4, jz], 1.3, 'white'); sph(m, jx + 9.6, 2.3, jz, 1.2, 'white');
  box(m, jx - 1, 1.8, jz, 3, 0.3, 16, 'white'); box(m, jx - 9, 3.4, jz, 2.2, 3.2, 0.3, 'white');
  // racks along the north wall
  for (let x = 66; x <= 140; x += 22) { box(m, x, 0, 3.2, 18, 8, 2.4, 'rack'); deco(m, 'boxes', { x, z: 3.2, w: 18, d: 2.4, h: 8 }); }
  // the overhead crane beam across the middle
  box(m, 82, 18, D / 2, 2.2, 1.6, D, 'crane');
  box(m, 82, 16.2, 30, 2.6, 1.8, 3, 'cab');
  // a tunnel of containers (two rows of two, a roof across)
  for (let x = 102; x <= 124; x += 12.2) {
    for (const z of [54.2, 65.8]) { box(m, x, 0, z, 12, 2.6, 2.45, x > 110 ? 'cont2' : 'cont1'); box(m, x, 2.6, z, 12, 2.6, 2.45, 'cont3'); }
  }
  for (let x = 98; x <= 128; x += 2.5) box(m, x, 5.2, 60, 2.44, 2.6, 14.1, 'cont4');
  // the catwalk along the south wall
  box(m, 75, 9.6, 69, 130, 0.4, 5.8, 'grate');
  for (let x = 12; x <= 138; x += 14) cap(m, [x, 0, 66.3], [x, 9.6, 66.3], 0.15, 'steel');
  cap(m, [10, 11, 66.2], [140, 11, 66.2], 0.05, 'steel');
  deco(m, 'rail', { a: [10, 11, 66.2], b: [140, 11, 66.2] });
  // the gates (glowing LEDs)
  course(m, [
    { x: 16, z: 40, up: 2.4, kind: 'led', yaw: 0, color: 'start', w: 4.4, h: 3 },
    { x: 26, z: 14, up: 2.6, kind: 'led' },
    { x: 44, z: 24, up: 2.1, kind: 'led' },
    { x: 72, z: 30, up: 7, kind: 'led' },
    { x: 92, z: 36, up: 21.4, kind: 'led', yaw: -Math.PI / 2 },
    { x: 114, z: 40, up: 12, kind: 'led', pitch: -Math.PI / 2, yaw: -Math.PI / 2, w: 3.8, h: 3.8 },
    { x: 136, z: 50, up: 3, kind: 'ring', w: 4 },
    { x: 112, z: 60, up: 2.2, kind: 'led', yaw: Math.PI / 2 },
    { x: 78, z: 66, up: 5, kind: 'led', yaw: Math.PI / 2 },
    { x: 48, z: 67.5, up: 11.6, kind: 'led', yaw: Math.PI / 2, floor: 10, h: 2.6 },
    { x: 24, z: 60, up: 4, kind: 'led' },
  ]);
  // lamps under the roof
  for (let x = 12; x < W; x += 22) for (let z = 12; z < D; z += 24) deco(m, 'hlamp', { x, y: H - 1.5, z });
  for (let i = 0; i < 6; i++) pad(m, 8 + i * 4, 50, 0);
  return m;
}

// ---------- Canyon Run: a loop through a desert gorge ----------
function canyon() {
  const S = 440, C = 220;
  const m = begin({ id: 'canyon', name: 'Canyon Run', kind: 'race', seed: 89, size: [S, S], ceil: 130, res: 2, look: LOOKS.canyon,
    desc: 'A long, fast loop through a desert gorge: a rock arch, a rock tunnel and an old trestle bridge.', groundMat: 'desert' });
  const loop = [];
  const R = (th) => 140 + 22 * Math.sin(3 * th + 0.4) + 12 * Math.cos(5 * th + 1);
  for (let i = 0; i < 360; i++) { const th = (i / 360) * Math.PI * 2; loop.push([C + R(th) * Math.cos(th), C + R(th) * Math.sin(th), th]); }
  const width = (th) => 32 + 8 * Math.sin(4 * th + 2) + 50 * Math.exp(-((((th - Math.PI / 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) ** 2) / 0.06);
  // distance from a point to the loop (and where along it)
  const grid = new Map(), GS = 20;
  loop.forEach((p, i) => { const k = `${Math.floor(p[0] / GS)},${Math.floor(p[1] / GS)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const near = (x, z) => {
    let best = 1e9, bi = 0;
    const gx = Math.floor(x / GS), gz = Math.floor(z / GS);
    for (let r = 1; r <= 4 && best > ((r - 1) * GS) ** 2; r++) {
      for (let a = gx - r; a <= gx + r; a++) for (let b = gz - r; b <= gz + r; b++) {
        for (const i of grid.get(`${a},${b}`) || []) { const p = loop[i], d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < best) { best = d; bi = i; } }
      }
    }
    return [Math.sqrt(best), bi];
  };
  m.loop = loop;
  m.height = (x, z) => {
    const [d, i] = near(x, z), th = loop[i][2], w = width(th) / 2;
    const plateau = 34 + 6 * fbm(x / 70, z / 70, 3, 4) + 30 * (1 - sstep(5, 45, Math.min(x, z, S - x, S - z)));
    const t = (d - w) / 9;
    // terraced walls
    const wall = sstep(0, 1, t) * 0.75 + 0.25 * sstep(0.6, 1.8, t);
    const floor = 1.2 * fbm(x / 25, z / 25, 2, 8) + (d < w * 0.35 ? -0.4 : 0);
    return lerp(floor, plateau, Math.min(1, wall));
  };
  const at = (th) => { const i = Math.round(((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 360) % 360; return loop[i]; };
  const dirAt = (th) => { const a = at(th - 0.01), b = at(th + 0.01); return yawTo(a[0], a[1], b[0], b[1]); };
  // gates along the loop (the way round: growing th)
  const list = [];
  const kinds = ['arch', 'square', 'ring', 'square', 'arch', 'square', 'ring', 'square', 'arch', 'square', 'ring', 'square', 'square', 'ring'];
  const N = 14, th0 = Math.PI / 2;
  for (let k = 0; k < N; k++) {
    const th = th0 + (k / N) * Math.PI * 2, p = at(th);
    const e = { x: p[0], z: p[1], yaw: dirAt(th), up: k === 0 ? 2.2 : 2.4 + (k % 3) * 1.6, kind: k === 0 ? 'arch' : kinds[k], w: k === 0 ? 7 : 5, h: k === 0 ? 5 : 3.4 };
    if (e.kind === 'ring') { e.w = 5.4; e.up = 4 + (k % 2) * 2; }
    if (k === 0) e.color = 'start';
    list.push(e);
  }
  course(m, list);
  // a natural rock arch over gate 3
  const g3 = m.gates[3], a3 = g3.c;
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI, r = 3.6 - Math.sin(a) * 1.2;
    const lx = Math.cos(a) * 13, ly = Math.sin(a) * 15;
    sph(m, a3[0] + g3.u[0] * lx + g3.n[0] * 4, gh(m, a3[0], a3[2]) + ly + 1.5, a3[2] + g3.u[2] * lx + g3.n[2] * 4, r, 'rock');
  }
  // a rock roof over the gorge (a tunnel) by gate 6, and the trestle bridge by gate 10
  const g6 = m.gates[6];
  for (let s = -22; s <= 22; s += 5.5) {
    const cx = g6.c[0] + g6.n[0] * s, cz = g6.c[2] + g6.n[2] * s;
    box(m, cx, 13 + Math.sin(s) * 0.8, cz, 70, 26, 6, 'rock', g6.yaw);
  }
  const g10 = m.gates[10], tb = 26;
  for (let s = -33.75; s <= 34; s += 7.5) {
    const cx = g10.c[0] + g10.n[0] * 10 + g10.u[0] * s, cz = g10.c[2] + g10.n[2] * 10 + g10.u[2] * s, y0 = gh(m, cx, cz);
    if (tb - y0 > 1) {
      cap(m, [cx, y0, cz], [cx, tb, cz], 0.35, 'wood');
      cap(m, [cx - g10.n[0] * 2.5, y0, cz - g10.n[2] * 2.5], [cx, tb, cz], 0.25, 'wood');
      cap(m, [cx + g10.n[0] * 2.5, y0, cz + g10.n[2] * 2.5], [cx, tb, cz], 0.25, 'wood');
    }
  }
  box(m, g10.c[0] + g10.n[0] * 10, tb, g10.c[2] + g10.n[2] * 10, 2.8, 1, 74, 'wood', g10.yaw + Math.PI / 2);
  // boulders and dead trees in the gorge (away from the gates)
  for (let i = 0; i < 90; i++) {
    const th = rnd() * Math.PI * 2, p = at(th), w = width(th) / 2;
    const off = (rnd() - 0.5) * w * 1.6, dx = Math.cos(th) * off, dz = Math.sin(th) * off;
    const x = p[0] + dx, z = p[1] + dz;
    if (m.gates.some(g => Math.hypot(g.c[0] - x, g.c[2] - z) < 16)) continue;
    if (rnd() < 0.7) sph(m, x, gh(m, x, z), z, 1 + rnd() * 2.2, 'rock'); else tree(m, x, z, 5 + rnd() * 4, 'dead');
  }
  // the start: pads in the wide basin, behind gate 0
  const g0 = m.gates[0];
  for (let i = 0; i < 6; i++) {
    const s = (i - 2.5) * 5, x = g0.c[0] - g0.n[0] * 14 + g0.u[0] * s, z = g0.c[2] - g0.n[2] * 14 + g0.u[2] * s;
    pad(m, x, z, g0.yaw);
  }
  return m;
}

// ---------- the list ----------
const BUILD = { bando, skyline, valley, meadow, hangar, canyon };
export const DRONE_MAPS = {
  bando: { name: 'Bando', kind: 'free', desc: 'An empty factory yard: a roofless hall, a concrete frame, a chimney and a water tower.' },
  skyline: { name: 'Skyline', kind: 'free', desc: 'City blocks: towers with a sky bridge, a crane, a car park and a railway on stilts.' },
  valley: { name: 'Valley', kind: 'free', desc: 'A river with a waterfall, a stone bridge, a farm, wind turbines and a rock arch.' },
  meadow: { name: 'Meadow Cup', kind: 'race', desc: 'Beginners\' circuit on a field: wide gates, a ring and a dive gate on a tower.' },
  hangar: { name: 'Hangar', kind: 'race', desc: 'Indoor circuit at night: under a wing, over a crane beam, through containers.' },
  canyon: { name: 'Canyon Run', kind: 'race', desc: 'A long, fast loop through a desert gorge: a rock arch, a tunnel, a trestle bridge.' },
};
// the game's other maps, for free flight
const OTHER = { arena: 'The Pool Hall', pool: 'The Poolrooms', garage: 'The Garage' };
export function existingMaps() {
  return [...Object.keys(MAPS), ...Object.keys(OTHER)].map(id => ({ id, name: OTHER[id] || MAPS[id].name, kind: 'map', dm: isDmMap(id) }));
}
export const isDroneMapId = (id) => !!DRONE_MAPS[id] || !!MAPS[id] || !!OTHER[id];
export const droneKind = (id) => (DRONE_MAPS[id] ? DRONE_MAPS[id].kind : 'free');
export function droneMapName(id) { return DRONE_MAPS[id] ? DRONE_MAPS[id].name : OTHER[id] || (MAPS[id] ? MAPS[id].name : id); }

// Build a map (for the game, the host, or the checks). Returns
// { id, name, kind, map (drone map) | world (other map), col (collider), spawns, gates }
const built = new Map();
export function loadDroneMap(id) {
  if (built.has(id)) return built.get(id);
  let out;
  if (BUILD[id]) {
    const m = BUILD[id]();
    if (m.height) {
      const res = m.res || 2, nx = Math.ceil(m.size[0] / res) + 1, nz = Math.ceil(m.size[1] / res) + 1;
      const h = new Float32Array(nx * nz);
      for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) h[k * nx + i] = m.height(i * res, k * res);
      m.ground = { res, nx, nz, h };
    }
    // (spawn pads sit on the sampled ground, not the exact sum)
    if (m.ground) for (const s of m.spawns) { const g = groundHeight(m.ground, s.x, s.z); s.y = g + 0.1 + DRONE.r + 0.02; }
    for (const d of m.deco) if (d.kind === 'pad' && m.ground) d.y = groundHeight(m.ground, d.x, d.z);
    out = { id, name: m.name, kind: m.kind, map: m, col: new MapCollider(m), spawns: m.spawns, gates: m.gates, size: m.size };
  } else {
    // one of the game's other maps: the world.js grid, its spawn points lifted onto the floor
    const variant = isDmMap(id) ? 'large' : id === 'pool' || id === 'garage' ? 'normal' : undefined;
    const world = new World(resolveMap(id, variant));
    const col = new GridCollider(world);
    const spawns = [];
    const pts = [...(world.spawns.dm || []), ...(world.spawns.atk || []), ...(world.spawns.def || [])];
    if (!pts.length) pts.push({ x: world.width / 2, z: world.depth / 2, yaw: 0 });
    for (const s of pts) {
      const y = floorAt(world, s.x, s.z);
      if (y == null) continue;
      if (spawns.some(o => Math.hypot(o.x - s.x, o.z - s.z) < 1.2)) continue;
      spawns.push({ x: s.x, y: y + DRONE.r + 0.05, z: s.z, yaw: Number.isFinite(s.yaw) ? s.yaw : 0 });
    }
    // (few spawn points, e.g. the Volleyball maps: more pads round them, on the same floor)
    for (let ring = 1; ring <= 3 && spawns.length < 6; ring++) {
      for (const s of [...spawns]) {
        for (let k = 0; k < 8 && spawns.length < 6; k++) {
          const a = (k / 8) * Math.PI * 2, x = s.x + Math.cos(a) * 2.5 * ring, z = s.z + Math.sin(a) * 2.5 * ring, y = floorAt(world, x, z);
          if (y == null || Math.abs(y + DRONE.r + 0.05 - s.y) > 0.3 || spawns.some(o => Math.hypot(o.x - x, o.z - z) < 2) || !col.free(x, s.y, z, DRONE.r) || !col.free(x, s.y + 1.5, z, 0.3)) continue;
          spawns.push({ x, y: s.y, z, yaw: s.yaw });
        }
      }
    }
    out = { id, name: droneMapName(id), kind: 'free', world, variant, col, spawns, gates: [], size: [world.width, world.depth] };
  }
  built.set(id, out);
  return out;
}
// the lowest floor with 1.5 m of room above it (the ground floor of a building, a deck in the Poolrooms)
function floorAt(world, x, z) {
  const ix = Math.floor(x / 0.5), iz = Math.floor(z / 0.5);
  const spans = world.cellSpans(ix, iz).filter(s => s.y1 > -5).sort((a, b) => a.y0 - b.y0);
  let y = 0;
  for (const s of spans) {
    if (s.y0 - y >= 1.5 && y >= 0) return y;
    y = Math.max(y, s.y1);
  }
  return y < 60 ? y : null;
}

// a spawn pad for player number `slot`, and the place to start again after a crash in a race
export function spawnFor(md, slot) {
  const s = md.spawns[((slot % md.spawns.length) + md.spawns.length) % md.spawns.length] || { x: md.size[0] / 2, y: 2, z: md.size[1] / 2, yaw: 0 };
  return { ...s };
}
export function gateRespawn(md, i) {
  const g = md.gates[i];
  if (!g) return null;
  const nx = md.gates[(i + 1) % md.gates.length] || g;
  const x = g.c[0] + g.n[0] * 3, z = g.c[2] + g.n[2] * 3;
  const y = Math.max(g.c[1] + g.n[1] * 3, md.col.heightAt(x, z) + 1.2);
  return { x, y, z, yaw: yawTo(x, z, nx.c[0], nx.c[2]), air: true };
}
