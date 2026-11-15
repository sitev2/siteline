// Level 1's 3D scene: the underground garage. Bare concrete on two floors, drawn in code, with the lighting
// "baked" when it loads (like brview.js): every corner of every floor, wall and ceiling works out the light it
// gets from the lamps on its own floor, with shadows from walls and pillars. Two kinds of lamp:
//   orange sodium lamps: the emergency circuit, always on, baked into the vertex colours;
//   white tubes: need the power (stage 7's fuse box). Their light is baked separately (the aTube attribute, one
//   number per flicker group) and switched in the shader (uTube), so tubes can be off, on, or flickering — and
//   their light on the walls flickers with them — at no cost.
// No fog and no dark zones: it is dim everywhere.
import * as THREE from 'three';
import { CELL } from './world.js';
import { rng } from './brmap.js';
import { GAR, floorY } from './garmap.js';
import { addFlash } from './brview.js';
import { mergeParts, carGeometry, coneGeometry, riserGeometry, CAR_PAINTS } from './garprops.js';

const { FL, clear: CLEAR, top: TOP } = GAR;
export const TUBE = { uTube: { value: new THREE.Vector3(1, 1, 1) } };
const TUBE_COL = [0.86, 0.95, 1.0], SODIUM = [1.0, 0.56, 0.18];

// a baked-light material: vertex colours (sodium light) + the tubes' share + flashlights (brview's addFlash)
export function garMaterial(params = {}) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, ...params });
  addFlash(m);
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    inner(sh, r);
    sh.uniforms.uTube = TUBE.uTube;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTube; uniform vec3 uTube;')
      .replace('#include <color_vertex>', `#include <color_vertex>\nvColor.rgb += vec3(${TUBE_COL.join(', ')}) * dot(aTube, uTube);`);
  };
  m.customProgramCacheKey = () => 'garflash';
  return m;
}

// ---------- textures (canvas) ----------
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, renderer, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  return t;
}
function speckle(g, S, n, cols, a, R, size = 2) { for (let i = 0; i < n; i++) { g.globalAlpha = a * (0.4 + R() * 0.6); g.fillStyle = cols[Math.floor(R() * cols.length)]; const s = size * (0.5 + R()); g.fillRect(R() * S, R() * S, s, s); } g.globalAlpha = 1; }
function blots(g, S, n, col, a, R, r0, r1) {
  for (let i = 0; i < n; i++) {
    const x = R() * S, y = R() * S, r = r0 + R() * (r1 - r0);
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = a * (0.5 + R() * 0.5); g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
  g.globalAlpha = 1;
}
// poured concrete walls: board marks, tie holes, damp streaks running down (1 tile = 3 m)
function wallTexture(renderer) {
  const S = 512, [c, g] = canvas(S), R = rng(101);
  g.fillStyle = '#8f8d86'; g.fillRect(0, 0, S, S);
  speckle(g, S, 26000, ['#7c7a73', '#a09e96', '#86847d', '#989690'], 0.4, R, 1.5);
  for (let y = 0; y < S; y += S / 6) { g.fillStyle = 'rgba(40,40,38,0.22)'; g.fillRect(0, y, S, 2); g.fillStyle = 'rgba(200,198,190,0.12)'; g.fillRect(0, y + 2, S, 1); }
  for (const x of [S / 4, S * 3 / 4]) for (const y of [S / 6, S / 2, S * 5 / 6]) { g.fillStyle = 'rgba(30,30,28,0.5)'; g.beginPath(); g.arc(x, y - S / 12, 4, 0, 7); g.fill(); }
  blots(g, S, 7, 'rgba(50,48,42,1)', 0.16, R, 30, 110);
  for (let i = 0; i < 12; i++) { const x = R() * S, w = 3 + R() * 10, gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(45,42,34,0.3)'); gr.addColorStop(1, 'rgba(45,42,34,0)'); g.fillStyle = gr; g.fillRect(x, 0, w, S * (0.4 + R() * 0.6)); }
  return tex(c, renderer);
}
// the deck: sealed concrete gone dark, tyre marks, oil, cracks (1 tile = 4 m)
function deckTexture(renderer) {
  const S = 512, [c, g] = canvas(S), R = rng(202);
  g.fillStyle = '#6f6e6a'; g.fillRect(0, 0, S, S);
  speckle(g, S, 40000, ['#5e5d59', '#7d7c77', '#666561', '#75746f'], 0.5, R, 1.4);
  blots(g, S, 9, 'rgba(25,24,22,1)', 0.22, R, 14, 60);              // oil
  blots(g, S, 5, 'rgba(150,148,140,1)', 0.08, R, 40, 120);
  g.strokeStyle = 'rgba(20,20,20,0.16)'; g.lineWidth = 9; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) { const y = R() * S; g.beginPath(); g.moveTo(-20, y); g.bezierCurveTo(S * 0.3, y + (R() - 0.5) * 90, S * 0.7, y + (R() - 0.5) * 90, S + 20, y + (R() - 0.5) * 60); g.stroke(); }
  g.strokeStyle = 'rgba(20,20,18,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 7; i++) { let x = R() * S, y = R() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (R() - 0.5) * 50; y += (R() - 0.3) * 40; g.lineTo(x, y); } g.stroke(); }
  return tex(c, renderer);
}
// the underside of the deck: shuttering lines, stains where water comes through (1 tile = 3 m)
function ceilTexture(renderer) {
  const S = 512, [c, g] = canvas(S), R = rng(303);
  g.fillStyle = '#84827b'; g.fillRect(0, 0, S, S);
  speckle(g, S, 22000, ['#72706a', '#93918a', '#7b7973'], 0.4, R, 1.5);
  for (let x = 0; x < S; x += S / 5) { g.fillStyle = 'rgba(35,35,33,0.28)'; g.fillRect(x, 0, 2, S); }
  for (let y = 0; y < S; y += S / 2) { g.fillStyle = 'rgba(35,35,33,0.2)'; g.fillRect(0, y, S, 2); }
  blots(g, S, 6, 'rgba(60,50,30,1)', 0.2, R, 20, 80); blots(g, S, 4, 'rgba(205,205,195,1)', 0.12, R, 10, 40);
  return tex(c, renderer);
}
// a pillar's side, floor to ceiling: bare concrete with a painted yellow and black band low down (1 × 3.4 m)
function pillarTexture(renderer) {
  const [c, g] = canvas(128, 512), R = rng(404);
  g.fillStyle = '#93918a'; g.fillRect(0, 0, 128, 512);
  speckle(g, 512, 9000, ['#807e77', '#a3a199', '#8a8881'], 0.4, R, 1.5);
  const y0 = 512 - 512 * 1.15 / 3.4, y1 = 512 - 512 * 0.15 / 3.4;
  g.fillStyle = '#b8962a'; g.fillRect(0, y0, 128, y1 - y0);
  g.fillStyle = '#1d1c1a'; g.save(); g.beginPath(); g.rect(0, y0, 128, y1 - y0); g.clip();
  for (let k = -200; k < 200; k += 44) { g.beginPath(); g.moveTo(k, y1); g.lineTo(k + 22, y1); g.lineTo(k + 22 + (y1 - y0), y0); g.lineTo(k + (y1 - y0), y0); g.fill(); }
  g.restore();
  speckle(g, 512, 2500, ['rgba(80,78,70,0.8)', 'rgba(150,146,134,0.6)'], 0.5, R, 2.2);        // the paint is chipped
  blots(g, 512, 3, 'rgba(40,38,32,1)', 0.2, R, 20, 60);
  return tex(c, renderer);
}
// every painted label in the garage on one sheet: pillar numbers, level signs, room names (our own wording)
function labelAtlas(renderer, labels) {
  const CW = 256, CH = 96, cols = 4, rows = Math.ceil(labels.length / cols), [c, g] = canvas(CW * cols, Math.max(CH, CH * rows));
  const R = rng(55);
  labels.forEach((L, i) => {
    const x = (i % cols) * CW, y = Math.floor(i / cols) * CH;
    g.save(); g.beginPath(); g.rect(x, y, CW, CH); g.clip();
    if (L.plate) { g.fillStyle = L.plate; g.fillRect(x + 4, y + 4, CW - 8, CH - 8); }
    g.fillStyle = L.ink || '#e9e4cf'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let px = L.px || 64;
    g.font = `bold ${px}px "Arial Narrow", Arial, sans-serif`;
    while (g.measureText(L.text).width > CW - 24 && px > 16) { px -= 4; g.font = `bold ${px}px "Arial Narrow", Arial, sans-serif`; }
    g.fillText(L.text, x + CW / 2, y + CH / 2 + 2);
    // worn stencil paint
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 260; k++) { g.globalAlpha = 0.5 * R(); g.fillRect(x + R() * CW, y + R() * CH, 1 + R() * 5, 1 + R() * 2); }
    g.restore();
    L.uv = [x / c.width, 1 - (y + CH) / c.height, (x + CW) / c.width, 1 - y / c.height];
  });
  return tex(c, renderer, false);
}

export function buildGarageScene(world, renderer, gfx = {}) {
  const plan = world.def.gar, Wc = world.w, Dc = world.h;
  const group = new THREE.Group();
  const soft = gfx.effects !== 'low';
  const R = rng(9001);
  const vis_ = s => s.m[0] !== '_';                               // spans that are drawn
  const cell = (ix, iz) => (ix < 0 || iz < 0 || ix >= Wc || iz >= Dc ? null : world.spans[iz * Wc + ix]);
  // ramps are drawn as smooth slopes (their collision is 11 cm steps): for hiding the walls beside them they
  // count as one step lower
  const rampStep = FL / ((plan.ramps[0].x1 - plan.ramps[0].x0) / CELL);
  const top_ = s => (s.m === 'ramp' ? s.y1 - rampStep : s.y1);

  // ---------- what blocks light, per floor (walls and pillars: anything solid from knee to head height) ----------
  const block = [0, 1].map(f => {
    const y = floorY(f), a = new Uint8Array(Wc * Dc);
    for (let i = 0; i < Wc * Dc; i++) if (world.spans[i].some(s => (vis_(s) || s.m === 'mass') && s.y0 <= y + 0.6 && s.y1 >= y + 2.4)) a[i] = 1;
    return a;
  });
  const blocked = (f, ix, iz) => ix < 0 || iz < 0 || ix >= Wc || iz >= Dc || block[f][iz * Wc + ix] === 1;
  const vis = (f, ax, az, bx, bz) => {
    let ix = Math.floor(ax / CELL), iz = Math.floor(az / CELL);
    const tx = Math.floor(bx / CELL), tz = Math.floor(bz / CELL), dx = bx - ax, dz = bz - az;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? Math.abs(CELL / dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? Math.abs(CELL / dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? (dx > 0 ? (ix + 1) * CELL - ax : ax - ix * CELL) / Math.abs(dx) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? (dz > 0 ? (iz + 1) * CELL - az : az - iz * CELL) / Math.abs(dz) : Infinity;
    for (let g = 0; g < 200; g++) {
      if (ix === tx && iz === tz) return true;
      let enter;
      if (tmx < tmz) { enter = tmx; ix += sx; tmx += tdx; } else { enter = tmz; iz += sz; tmz += tdz; }
      if (enter > 1) return true;
      if (blocked(f, ix, iz)) return false;
    }
    return true;
  };
  // lamps by floor, in 4 m buckets
  const lights = plan.lights.map(L => ({ ...L }));
  const bucket = [new Map(), new Map()];
  lights.forEach((L, i) => { const k = `${Math.floor(L.x / 4)},${Math.floor(L.z / 4)}`, b = bucket[L.f]; if (!b.has(k)) b.set(k, []); b.get(k).push(i); });
  const RANGE = 15;
  const near = (f, x, z) => {
    const out = [], bx = Math.floor(x / 4), bz = Math.floor(z / 4);
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) { const l = bucket[f].get(`${bx + dx},${bz + dz}`); if (l) for (const i of l) out.push(i); }
    return out;
  };
  const OFF = soft ? [-0.5, 0, 0.5] : [0];
  // direct light at a point with normal n on floor f → out[0..2] sodium (rgb), out[3..5] tubes (by flicker group)
  const direct = (f, px, py, pz, nx, ny, nz, out) => {
    out.fill(0);
    for (const i of near(f, px, pz)) {
      const L = lights[i], tube = L.kind === 'tube';
      const offs = tube ? OFF : [0];
      let acc = 0;
      for (const o of offs) {
        const lx = L.x + o, lz = L.z, dx = lx - px, dy = L.y - py, dz = lz - pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > RANGE * RANGE) continue;
        const d = Math.sqrt(d2) || 1e-3, cr = (nx * dx + ny * dy + nz * dz) / d;
        if (cr <= 0) continue;
        const ce = dy / d;
        if (ce <= 0) continue;
        if (!vis(f, px, pz, lx, lz)) continue;
        acc += cr * (0.3 + 0.7 * ce) / (1 + d2 * (tube ? 0.15 : 0.11));
      }
      acc /= offs.length;
      if (tube) out[3 + L.grp] += acc * 1.25;
      else { out[0] += acc * SODIUM[0] * 1.35; out[1] += acc * SODIUM[1] * 1.35; out[2] += acc * SODIUM[2] * 1.35; }
    }
    return out;
  };
  // ---------- floor light on each floor's grid, and the light bounced about (a wide blur of it) ----------
  const FW = Wc + 1, FD = Dc + 1, tmp = new Float32Array(6);
  // is cell (ix, iz) open air between y0 and y1?
  const openAt = (ix, iz, y0, y1) => { const sp = cell(ix, iz); return !!sp && !sp.some(s => s.m !== '_ceiling' && s.y0 < y1 && s.y1 > y0); };
  // nudge a grid corner towards the open cells round it (so its light isn't sampled from inside a wall)
  const nudge = (x, z, y0, y1) => {
    const ix = Math.round(x / CELL), iz = Math.round(z / CELL);
    let ox = 0, oz = 0, n = 0;
    for (const [cx, cz] of [[ix - 1, iz - 1], [ix, iz - 1], [ix - 1, iz], [ix, iz]]) if (openAt(cx, cz, y0, y1)) { ox += (cx + 0.5) * CELL; oz += (cz + 0.5) * CELL; n++; }
    return n ? [x + (ox / n - x) * 0.3, z + (oz / n - z) * 0.3, 4 - n] : [x, z, 4];
  };
  const floorL = [0, 1].map(f => {
    const a = new Float32Array(FW * FD * 6), y = floorY(f);
    for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) {
      const [px, pz, bl] = nudge(ix * CELL, iz * CELL, y + 0.3, y + 1.6);
      if (bl === 4) continue;
      direct(f, px, y, pz, 0, 1, 0, tmp);
      a.set(tmp, (iz * FW + ix) * 6);
    }
    return a;
  });
  const blur = (src, rad) => {
    const t = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) for (let c = 0; c < 6; c++) { let s = 0, n = 0; for (let d = -rad; d <= rad; d++) { const x = ix + d; if (x < 0 || x >= FW) continue; s += src[(iz * FW + x) * 6 + c]; n++; } t[(iz * FW + ix) * 6 + c] = s / n; }
    for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) for (let c = 0; c < 6; c++) { let s = 0, n = 0; for (let d = -rad; d <= rad; d++) { const z = iz + d; if (z < 0 || z >= FD) continue; s += t[(z * FW + ix) * 6 + c]; n++; } out[(iz * FW + ix) * 6 + c] = s / n; }
    return out;
  };
  const bounce = floorL.map(a => blur(a, 6));
  const bAt = (f, x, z) => (Math.max(0, Math.min(FD - 1, Math.round(z / CELL))) * FW + Math.max(0, Math.min(FW - 1, Math.round(x / CELL)))) * 6;
  const EXPO = 1.05, AMB = [0.02, 0.016, 0.012];
  const grime = (x, z) => 0.9 + 0.13 * (Math.sin(x * 0.37 + z * 0.21) * 0.5 + 0.5) + 0.05 * Math.sin(x * 1.3 - z * 0.9);
  // the finished light at a point: [r, g, b, tube0, tube1, tube2]
  const out6 = new Float32Array(6);
  const shade = (x, y, z, nx, ny, nz) => {
    let f, px = x, pz = z, py = y, ao = 1, own = 1, bk = 0.3;
    if (ny > 0.5) {                               // a floor or the top of something
      f = y > FL - 1.5 ? 1 : 0;
      const n = nudge(x, z, y + 0.3, y + 1.6); px = n[0]; pz = n[1]; ao = 1 - n[2] * 0.1; bk = 0.3;
    } else if (ny < -0.5) {                       // a ceiling: only bounced light and the glow round the lamps
      f = y > FL + 0.2 ? 1 : 0;
      const n = nudge(x, z, y - 1.6, y - 0.3); px = n[0]; pz = n[1]; ao = 0.9 - n[2] * 0.07; own = 0; bk = 0.6;
    } else {
      f = y >= FL - 0.21 ? 1 : 0;
      const base = floorY(f), h = y - base;
      px = x + nx * 0.07; pz = z + nz * 0.07; py = Math.max(base + 0.05, Math.min(base + CLEAR - 0.05, y));
      // an inside corner beside this end of the wall face: sample a little away from it
      const ix = Math.floor(px / CELL), iz = Math.floor(pz / CELL), tx = nz ? 1 : 0, tz = nx ? 1 : 0;
      const fr = (nz ? px : pz) / CELL, on = Math.abs(fr - Math.round(fr)) < 0.2;
      if (on) {
        const ca = tx ? Math.round(fr) - 1 : ix, cb = tx ? Math.round(fr) : ix, za = tz ? Math.round(fr) - 1 : iz, zb = tz ? Math.round(fr) : iz;
        const ba = blocked(f, ca, za), bb = blocked(f, cb, zb);
        if (ba && !bb) { px += tx * 0.06; pz += tz * 0.06; ao *= 0.8; } else if (bb && !ba) { px -= tx * 0.06; pz -= tz * 0.06; ao *= 0.8; }
      }
      ao *= (h < 0.3 ? 0.7 + h : 1) * (h > CLEAR - 0.3 ? 0.78 + (CLEAR - h) * 0.7 : 1);
      bk = 0.3 * (1 - h / CLEAR * 0.35) + 0.1 * (h / CLEAR);
    }
    if (own) direct(f, px, py, pz, nx, ny, nz, out6); else out6.fill(0);
    const b = bounce[f], k = bAt(f, px, pz), g = grime(x + y, z) * EXPO * Math.max(0.45, ao);
    if (!own) {
      // the glow on the ceiling right round each lamp
      for (const i of near(f, x, z)) {
        const L = lights[i], dd = Math.hypot(Math.max(0, Math.abs(x - L.x) - (L.kind === 'tube' ? 0.6 : 0.1)), z - L.z);
        if (dd > 1.6 || !vis(f, px, pz, L.x, L.z)) continue;
        const v = (1 - dd / 1.6) ** 2 * 0.5;
        if (L.kind === 'tube') out6[3 + L.grp] += v; else { out6[0] += v * SODIUM[0]; out6[1] += v * SODIUM[1]; out6[2] += v * SODIUM[2]; }
      }
    }
    for (let c = 0; c < 3; c++) out6[c] = Math.min(1.5, (out6[c] + b[k + c] * bk * 0.9 + AMB[c]) * g);
    for (let c = 3; c < 6; c++) out6[c] = Math.min(1.5, (out6[c] + b[k + c] * bk) * g);
    return out6;
  };

  // ---------- the mesher: every visible face of every span, with shared, lit corners ----------
  const MATS = ['conc', 'deck', 'ceil', 'pillar', 'paint'];
  const buf = Object.fromEntries(MATS.map(m => [m, { pos: [], uv: [], col: [], tube: [], idx: [], map: new Map() }]));
  const vert = (m, x, y, z, nx, ny, nz, u, v, tint = null) => {
    const B = buf[m];
    const key = `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)},${nx},${ny},${nz},${Math.round(u * 50)},${Math.round(v * 50)}`;
    let i = B.map.get(key);
    if (i !== undefined) return i;
    i = B.pos.length / 3;
    const s = shade(x, y, z, nx, ny, nz), t = tint || [1, 1, 1];
    B.pos.push(x, y, z); B.uv.push(u, v); B.col.push(s[0] * t[0], s[1] * t[1], s[2] * t[2]); B.tube.push(s[3] * t[0], s[4] * t[0], s[5] * t[0]);
    B.map.set(key, i);
    return i;
  };
  const quad = (m, a, b, c, d) => buf[m].idx.push(a, b, c, a, c, d);
  // a level face (ny = ±1) over the rectangle x0…x1, z0…z1
  const flat = (m, x0, z0, x1, z1, y, ny, s, tint) => {
    const P = (x, z) => vert(m, x, y, z, 0, ny, 0, x / s, z / s, tint);
    const a = P(x0, z0), b = P(x1, z0), c = P(x0, z1), d = P(x1, z1);
    if (ny > 0) buf[m].idx.push(a, c, d, a, d, b); else buf[m].idx.push(a, b, d, a, d, c);
  };
  const puddleCell = new Uint8Array(Wc * Dc);
  for (const p of plan.puddles) for (let iz = Math.round(p.z0 / CELL); iz < Math.round(p.z1 / CELL); iz++) for (let ix = Math.round(p.x0 / CELL); ix < Math.round(p.x1 / CELL); ix++) puddleCell[iz * Wc + ix] = 1;
  const ROWS = [0, 0.3, 1.0, 2.0, 2.7, CLEAR, FL, FL + 0.3, FL + 1.0, FL + 1.1, FL + 2.0, FL + 2.7, TOP];
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    const spans = world.spans[iz * Wc + ix], x0 = ix * CELL, z0 = iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const mass = spans.length === 1 && spans[0].m === 'mass';
    const drawn = spans.filter(vis_);
    if (!mass) {
      // the ground, and the top floor's ceiling
      if (!drawn.some(s => s.y0 <= 0.01) && !puddleCell[iz * Wc + ix]) flat('deck', x0, z0, x1, z1, 0, 1, 4);
      if (spans.some(s => s.m === '_ceiling') && !drawn.some(s => s.y0 < TOP && s.y1 >= TOP)) flat('ceil', x0, z0, x1, z1, TOP, -1, 3);
    }
    for (const s of drawn) {
      if (s.m === 'ramp') continue;
      const y1 = Math.min(s.y1, TOP), isMass = s.m === 'mass';
      if (!isMass) {
        if (y1 < TOP - 0.01 && !drawn.some(t => t !== s && t.y0 <= y1 + 0.001 && t.y1 > y1 + 0.001)) flat(s.m === 'slab' || s.m === 'stairs' ? 'deck' : 'conc', x0, z0, x1, z1, y1, 1, 4);
        if (s.y0 > 0.01 && !drawn.some(t => t !== s && t.y1 >= s.y0 - 0.001 && t.y0 < s.y0 - 0.001)) flat('ceil', x0, z0, x1, z1, s.y0, -1, 3);
      }
      for (const [nx, nz] of SIDES) {
        const nb = cell(ix + nx, iz + nz);
        if (!nb) continue;
        // the parts of this span's side that the neighbouring cell doesn't cover
        let parts = [[s.y0, y1]];
        for (const t of nb) {
          if (!vis_(t)) continue;
          const t1 = top_(t), next = [];
          for (const [a, b] of parts) { if (t1 <= a || t.y0 >= b) { next.push([a, b]); continue; } if (t.y0 > a + 0.001) next.push([a, t.y0]); if (t1 < b - 0.001) next.push([t1, b]); }
          parts = next;
        }
        if (!parts.length) continue;
        const ends = nx === 1 ? [[x1, z1], [x1, z0]] : nx === -1 ? [[x0, z0], [x0, z1]] : nz === 1 ? [[x0, z1], [x1, z1]] : [[x1, z0], [x0, z0]];
        const m = s.m === 'pillar' ? 'pillar' : 'conc';
        const ua = nx ? ends[0][1] : ends[0][0], ub = nx ? ends[1][1] : ends[1][0];
        for (const [a, b] of parts) {
          const rows = [a, ...ROWS.filter(y => y > a + 0.01 && y < b - 0.01), b];
          for (let r = 0; r < rows.length - 1; r++) {
            const ya = rows[r], yb = rows[r + 1];
            const V = (e, y, u) => (m === 'pillar' ? vert(m, e[0], y, e[1], nx, 0, nz, (u - (nx ? z0 : x0)) / (nx ? 1 : 0.5), (y - (y >= FL - 0.01 && s.y0 >= FL - 0.5 ? FL : 0)) / FL)
              : vert(m, e[0], y, e[1], nx, 0, nz, u / 3, y / 3));
            quad(m, V(ends[0], ya, ua), V(ends[1], ya, ub), V(ends[1], yb, ub), V(ends[0], yb, ua));
          }
        }
      }
    }
  }
  // the car ramps: a smooth slope from one floor to the other, lit from below at the bottom and from above at the top
  for (const r of plan.ramps) {
    const n = Math.round((r.x1 - r.x0) / CELL), up = r.dir === '+x';
    const hAt = x => (up ? (x - r.x0) : (r.x1 - x)) / (r.x1 - r.x0) * FL;
    const P = (x, z) => {
      const h = hAt(x), t = h / FL, key = `r${x},${z}`;
      const B = buf.deck;
      let i = B.map.get(key);
      if (i !== undefined) return i;
      i = B.pos.length / 3;
      const lo = Float32Array.from(shade(x, 0, z, 0, 1, 0)), hi = shade(x, FL, z, 0, 1, 0);
      const ka = (1 - t), kb = 0.3 + 0.7 * t;
      B.pos.push(x, h + 0.01, z); B.uv.push(x / 4, z / 4);
      B.col.push(lo[0] * ka + hi[0] * kb, lo[1] * ka + hi[1] * kb, lo[2] * ka + hi[2] * kb);
      B.tube.push(lo[3] * ka + hi[3] * kb, lo[4] * ka + hi[4] * kb, lo[5] * ka + hi[5] * kb);
      B.map.set(key, i);
      return i;
    };
    for (let k = 0; k < n; k++) for (let z = r.z0; z < r.z1 - 0.01; z += CELL) {
      const xa = r.x0 + k * CELL, xb = xa + CELL;
      const a = P(xa, z), b = P(xb, z), c = P(xa, z + CELL), d = P(xb, z + CELL);
      buf.deck.idx.push(a, c, d, a, d, b);
    }
  }
  // painted lines on the deck: the bays, hatching where nobody may park, arrows up and down the ramps
  const WHITE = [1.5, 1.5, 1.4], YELLOW = [1.6, 1.25, 0.35];
  const stripe = (x0, z0, x1, z1, y, tint) => flat('paint', x0, z0, x1, z1, y + 0.006, 1, 4, tint);
  for (const b of plan.bays) {
    const y = floorY(b.f), xl = b.x - 1.25;
    stripe(xl - 0.05, b.z0 - 0.25, xl + 0.05, b.z1 - 0.25 + 0.5, y, WHITE);
    if (!plan.bays.some(o => o.f === b.f && o.row === b.row && o.z0 === b.z0 && o.k === b.k + 1)) stripe(xl + 2.45, b.z0 - 0.25, xl + 2.55, b.z1 + 0.25, y, WHITE);
  }
  for (const f of [0, 1]) {
    const y = floorY(f);
    for (const [x0, z0, x1, z1] of [[26, 13.5, 31.5, 21.5], [33, 30.5, 38.5, 38.5]]) for (let k = 0; k < (x1 - x0) / 1; k++) stripe(x0 + k, z0, x0 + k + 0.12, z1, y, YELLOW);
    for (const z of [6.5, 12.5, 22.5, 29.5, 39.5, 45.5]) for (let x = 10; x < 54; x += 3) stripe(x, z - 0.04, x + 1.5, z + 0.04, y, YELLOW);
  }

  const makeMesh = (m, material) => {
    const B = buf[m];
    if (!B.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
    g.setAttribute('aTube', new THREE.Float32BufferAttribute(B.tube, 3));
    g.setIndex(B.idx);
    g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    group.add(mesh);
    return mesh;
  };
  makeMesh('conc', garMaterial({ map: wallTexture(renderer) }));
  makeMesh('deck', garMaterial({ map: deckTexture(renderer) }));
  makeMesh('ceil', garMaterial({ map: ceilTexture(renderer) }));
  makeMesh('pillar', garMaterial({ map: pillarTexture(renderer) }));
  const paint = makeMesh('paint', garMaterial({ color: '#8f8c80', polygonOffset: true, polygonOffsetFactor: -2 }));
  if (paint) paint.renderOrder = 1;

  // ---------- the light a thing standing at (x, y, z) gets (for props, people and the shapeshifter's disguises) ----------
  const propLight = (x, y, z) => {
    const f = y > FL - 1.5 ? 1 : 0, k = bAt(f, x, z), a = floorL[f], b = bounce[f], o = [];
    for (let c = 0; c < 6; c++) o.push(Math.min(1.4, (a[k + c] * 0.55 + b[k + c] * 0.6 + (c < 3 ? AMB[c] * 2 : 0)) * EXPO));
    return o;
  };
  // paint a merged prop geometry with the light at its place: colours × sodium light, and its tube share
  const litGeo = (geo, x, y, z) => {
    const g = geo.clone(), L = propLight(x, y, z), C = g.attributes.color, n = C.count, tube = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = C.getX(i), gg = C.getY(i), b = C.getZ(i), lum = (r + gg + b) / 3;
      C.setXYZ(i, r * L[0] * 1.6, gg * L[1] * 1.6, b * L[2] * 1.6);
      tube[i * 3] = lum * L[3] * 1.6; tube[i * 3 + 1] = lum * L[4] * 1.6; tube[i * 3 + 2] = lum * L[5] * 1.6;
    }
    g.setAttribute('aTube', new THREE.BufferAttribute(tube, 3));
    return g;
  };
  group.userData.propLight = propLight;
  group.userData.litGeo = litGeo;
  const propMat = garMaterial({});
  group.userData.propMat = propMat;
  // every fixed prop goes into one mesh
  const props = [];
  const place = (geo, x, y, z, ry = 0) => props.push({ geo: litGeo(geo, x, y, z), m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)) });
  const carYaw = c => (c.nose < 0 ? 0 : Math.PI) + c.skew;
  for (const c of plan.cars) place(carGeometry(c.kind, CAR_PAINTS[c.col], c.flat), c.x, floorY(c.f), c.z, carYaw(c));
  for (const c of plan.cones) place(coneGeometry(c.n), c.x, c.y, c.z, R() * 6);
  for (const c of plan.risers) place(riserGeometry(), c.x, c.y, c.z, 0);
  // ducts hanging low across the aisles, and pipe runs under the ceilings
  for (const d of plan.ducts) {
    const y = floorY(d.f), w = d.x1 - d.x0, l = d.z1 - d.z0;
    place(mergeParts([{ geo: new THREE.BoxGeometry(w, 0.5, l), color: '#6f747a' }, ...[0.25, 0.5, 0.75].map(k => ({ geo: new THREE.BoxGeometry(w + 0.06, 0.54, 0.05), color: '#565a5f', m: new THREE.Matrix4().makeTranslation(0, 0, (k - 0.5) * l) }))]), (d.x0 + d.x1) / 2, y + 2.5, (d.z0 + d.z1) / 2);
  }
  for (const f of [0, 1]) for (const [z, r, col] of [[7.3, 0.07, '#5a4a3a'], [23.4, 0.09, '#3d4f5c'], [23.75, 0.05, '#6a2f28'], [44.7, 0.07, '#5a4a3a']]) {
    for (let x = 6; x < 58; x += 8) { const g = new THREE.CylinderGeometry(r, r, 8, 8); g.rotateZ(Math.PI / 2); place(mergeParts([{ geo: g, color: col }, { geo: new THREE.BoxGeometry(0.04, 0.3, 0.04), color: '#2a2a2a', m: new THREE.Matrix4().makeTranslation(0, 0.15, 0) }]), x + 4, floorY(f) + CLEAR - 0.3, z); }
  }
  // the fuse box (in its recess) and the crank beside the shutter: shapes only for now (stage 7 makes them work)
  {
    const F = plan.fuse;
    place(mergeParts([{ geo: new THREE.BoxGeometry(0.7, 0.95, 0.18), color: '#59605a' }, { geo: new THREE.BoxGeometry(0.6, 0.85, 0.02), color: '#6f7770', m: new THREE.Matrix4().makeTranslation(0, 0, 0.1) },
      { geo: new THREE.BoxGeometry(0.05, 0.14, 0.05), color: '#a52a1e', m: new THREE.Matrix4().makeTranslation(0.2, -0.1, 0.13) }, { geo: new THREE.BoxGeometry(0.3, 0.1, 0.012), color: '#c9b54a', m: new THREE.Matrix4().makeTranslation(-0.08, 0.28, 0.115), flat: 1 }]), F.x, F.y + 1.35, F.z + 0.09);
  }
  const crank = new THREE.Group();
  {
    const C = plan.crank;
    place(mergeParts([{ geo: new THREE.BoxGeometry(0.34, 0.44, 0.16), color: '#4d5257' }, { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10).rotateX(Math.PI / 2), color: '#2c2d2f', m: new THREE.Matrix4().makeTranslation(0, 0, 0.12) }]), C.x, C.y + 1.1, C.z + 0.08);
    const L = propLight(C.x, C.y, C.z + 0.5), tint = new THREE.Color(0.25 + L[0] + L[3], 0.25 + L[1] + L[3], 0.25 + L[2] + L[3]);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.03), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#77797c').multiply(tint) }))); arm.position.y = 0.15;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8).rotateX(Math.PI / 2), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#1b1b1c').multiply(tint) }))); knob.position.set(0, 0.29, 0.07);
    crank.add(arm, knob); crank.position.set(C.x, C.y + 1.1, C.z + 0.24); group.add(crank);
  }
  if (props.length) { const m = new THREE.Mesh(mergeLit(props), propMat); group.add(m); }
  function mergeLit(list) {
    const pos = [], col = [], tube = [], v = new THREE.Vector3();
    for (const p of list) {
      const P = p.geo.attributes.position, C = p.geo.attributes.color, T = p.geo.attributes.aTube;
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(p.m); pos.push(v.x, v.y, v.z); col.push(C.getX(i), C.getY(i), C.getZ(i)); tube.push(T.getX(i), T.getY(i), T.getZ(i)); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aTube', new THREE.Float32BufferAttribute(tube, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
  // a soft dark patch under each car (they throw no baked shadow)
  {
    const [c, g] = canvas(64), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const geo = new THREE.PlaneGeometry(2.6, 5.1).rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex(c, renderer, false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), plan.cars.length + 1);
    const m4 = new THREE.Matrix4();
    plan.cars.forEach((cr, i) => { m4.makeTranslation(cr.x, floorY(cr.f) + 0.012, cr.z); inst.setMatrixAt(i, m4); });
    m4.makeTranslation(0, -50, 0); inst.setMatrixAt(plan.cars.length, m4);
    inst.renderOrder = 2; group.add(inst);
    // (the last one follows the shapeshifter when it is parked as a car)
    group.userData.carShadow = (x, y, z) => { m4.makeTranslation(x, y == null ? -50 : y + 0.012, z); inst.setMatrixAt(plan.cars.length, m4); inst.instanceMatrix.needsUpdate = true; };
  }

  // ---------- painted labels: pillar numbers, level names, signs over the rooms ----------
  {
    const labels = [], quads = [];
    const label = (text, o = {}) => { let L = labels.find(l => l.text === text && l.plate === o.plate); if (!L) { L = { text, ...o }; labels.push(L); } return L; };
    const put = (L, x, y, z, nx, nz, w, h) => quads.push({ L, x, y, z, nx, nz, w, h });
    for (const p of plan.pillars) {
      const y = floorY(p.f) + 1.75, L = label(`${p.f ? 'P1' : 'P2'}·${p.name}`, { px: 54 });
      put(L, p.x + 0.25, y, p.z - 0.008, 0, -1, 0.44, 0.165); put(L, p.x + 0.25, y, p.z + 1.008, 0, 1, 0.44, 0.165);
    }
    for (const r of plan.rooms) {
      const d = r.door, y = floorY(r.floor) + 2.5, L = label(r.name, { plate: '#2c4a3a', px: 44 });
      // on the outside of the wall, over the door
      const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2, out = d.v ? [Math.sign(cx - (r.x0 + r.x1) / 2), 0] : [0, Math.sign(cz - (r.z0 + r.z1) / 2)];
      put(L, cx + out[0] * 0.26, y, cz + out[1] * 0.26, out[0], out[1], 1.3, 0.34);
    }
    const big = (text, x, y, z, nx, nz, w = 2.4, o = {}) => put(label(text, o), x, y, z, nx, nz, w, w * 0.375);
    big('LEVEL P2', 1.008, 1.9, 21, 1, 0); big('LEVEL P2', 62.992, 1.9, 28, -1, 0); big('LEVEL P1', 1.008, FL + 1.9, 21, 1, 0); big('LEVEL P1', 62.992, FL + 1.9, 28, -1, 0);
    big('GOODS LIFT', 3.5, FL + 2.7, 6.008, 0, 1, 1.6, { plate: '#6a5a1c' }); big('WIND BY HAND', 1.5, FL + 1.75, 6.008, 0, 1, 0.7, { plate: '#6a5a1c', px: 34 });
    big('FUSES', plan.fuse.x, 2.2, 1.008, 0, 1, 0.8, { plate: '#6a2a1c' });
    big('STAIRS', 3.508, 2.5, 47, 1, 0, 1.2, { plate: '#2c3a4a' }); big('STAIRS', 3.508, FL + 2.5, 46, 1, 0, 1.2, { plate: '#2c3a4a' });
    big('STAIRS', 60.492, 2.5, 5, -1, 0, 1.2, { plate: '#2c3a4a' }); big('STAIRS', 60.492, FL + 2.5, 6, -1, 0, 1.2, { plate: '#2c3a4a' });
    big('UP TO P1', 17.5, 2.3, 14.492, 0, -1, 2); big('UP TO P1', 47, 2.3, 37.508, 0, 1, 2);
    big('MAX HEADROOM 2.0 m', 14, FL + 0.75, 14.492, 0, -1, 2.6, { px: 30 }); big('MAX HEADROOM 2.0 m', 50, FL + 0.75, 37.508, 0, 1, 2.6, { px: 30 });
    const atlas = labelAtlas(renderer, labels);
    const pos = [], uv = [], col = [], tube = [];
    for (const q of quads) {
      const ux = q.nz, uz = -q.nx, [u0, v0, u1, v1] = q.L.uv, s = shade(q.x, q.y, q.z, q.nx, 0, q.nz), k = q.L.plate ? 1 : 1.25;
      const P = (su, sv) => [q.x + ux * q.w / 2 * su, q.y + q.h / 2 * sv, q.z + uz * q.w / 2 * su];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { pos.push(...P(su, sv)); uv.push(su < 0 ? u0 : u1, sv < 0 ? v0 : v1); col.push(s[0] * k, s[1] * k, s[2] * k); tube.push(s[3] * k, s[4] * k, s[5] * k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aTube', new THREE.Float32BufferAttribute(tube, 3));
    const m = new THREE.Mesh(g, garMaterial({ map: atlas, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.renderOrder = 1; group.add(m);
  }

  // ---------- the lamps themselves ----------
  const tubeMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.85, 1.95) }));
  {
    const tg = new THREE.BoxGeometry(1.25, 0.05, 0.1), hg = new THREE.BoxGeometry(1.35, 0.06, 0.2), m4 = new THREE.Matrix4();
    const housing = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ color: '#2a2b2c' }), lights.filter(L => L.kind === 'tube').length);
    let hi = 0;
    for (const grp of [0, 1, 2]) {
      const list = lights.filter(L => L.kind === 'tube' && L.grp === grp);
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(tg, tubeMats[grp], list.length);
      list.forEach((L, i) => { m4.makeTranslation(L.x, L.y, L.z); inst.setMatrixAt(i, m4); m4.makeTranslation(L.x, L.y + 0.055, L.z); housing.setMatrixAt(hi++, m4); });
      group.add(inst);
    }
    group.add(housing);
    const so = lights.filter(L => L.kind === 'sodium');
    const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.08, 0.34), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 1.25, 0.4) }), so.length);
    const cage = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), new THREE.MeshBasicMaterial({ color: '#1c1a17' }), so.length);
    so.forEach((L, i) => { m4.makeTranslation(L.x, L.y + 0.02, L.z); lamp.setMatrixAt(i, m4); m4.makeTranslation(L.x, L.y + 0.07, L.z); cage.setMatrixAt(i, m4); });
    group.add(lamp, cage);
  }

  // ---------- doors (side rooms), the roller shutter, window glass ----------
  const leaves = [];
  const dirAngle = (dx, dz) => Math.atan2(-dz, dx);
  const tintAt = (x, y, z) => { const L = propLight(x, y, z); return new THREE.Color(0.3 + L[0] + L[3], 0.3 + L[1] + L[3], 0.3 + L[2] + L[3]); };
  let shutter = null;
  world.doors.forEach((d, i) => {
    const y = d.y || 0, v = d.v, g0 = v ? d.z0 : d.x0, g1 = v ? d.z1 : d.x1, wl = v ? d.cx : d.cz, mid = (g0 + g1) / 2;
    const at3 = (u, yy, w) => (v ? [w, yy, u] : [u, yy, w]);
    const tint = tintAt(d.cx, y, d.cz);
    if (d.lock === 'shutter') {
      // a roller shutter: ribbed steel that winds up into a box over the opening
      const [c, g] = canvas(64, 64);
      g.fillStyle = '#7b8086'; g.fillRect(0, 0, 64, 64);
      for (let k = 0; k < 8; k++) { g.fillStyle = 'rgba(20,22,25,0.45)'; g.fillRect(0, k * 8, 64, 2); g.fillStyle = 'rgba(220,225,230,0.25)'; g.fillRect(0, k * 8 + 2, 64, 1); }
      const t = tex(c, renderer); t.repeat.set(3, 10);
      const H = plan.shutter.h, panel = new THREE.Mesh(new THREE.BoxGeometry(g1 - g0, H, 0.06).translate(0, -H / 2, 0), addFlash(new THREE.MeshBasicMaterial({ map: t, color: tint })));
      const p = at3(mid, y + H, wl); panel.position.set(p[0], p[1], p[2]);
      const boxm = new THREE.Mesh(new THREE.BoxGeometry(g1 - g0 + 0.3, 0.34, 0.6), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#4a4e53').multiply(tint) })));
      boxm.position.set(p[0], y + H + 0.17, p[2]);
      group.add(panel, boxm);
      shutter = { panel, t, p: d.open ? 1 : 0, H };
      leaves[i] = [];
      return;
    }
    const DH = GAR.door, list = [];
    const frameM = addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#3f4a44').multiply(tint) }));
    const box = (w, h, dd, x, yy, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), frameM); o.position.set(x, yy, z); group.add(o); };
    const depth = CELL + 0.06;
    for (const [u, s] of [[g0, 1], [g1, -1]]) { const p = at3(u + s * 0.01, y + DH / 2, wl); box(v ? depth : 0.08, DH, v ? 0.08 : depth, p[0], p[1], p[2]); }
    { const p = at3(mid, y + DH - 0.01, wl); box(v ? depth : g1 - g0 + 0.16, 0.08, v ? g1 - g0 + 0.16 : depth, p[0], p[1], p[2]); }
    // one steel door, hinged at one side of the gap, with a small wired-glass pane
    const dw = g1 - g0 - 0.11, lh = DH - 0.07, pivot = new THREE.Group(), p = at3(g0 + 0.055, y, wl);
    pivot.position.set(p[0], y, p[2]);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw, lh, 0.05), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#5d6a63').multiply(tint) })));
    leaf.position.set(dw / 2, 0.012 + lh / 2, 0);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.056), new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a2124').multiply(tint) })); pane.position.set(dw * 0.5, 1.5, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.1), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#9a9c9e').multiply(tint) }))); handle.position.set(dw - 0.14, 1.02, 0);
    pivot.add(leaf, pane, handle); pivot.rotation.order = 'YXZ';
    group.add(pivot);
    const shut = v ? dirAngle(0, 1) : dirAngle(1, 0), nx = v ? 1 : 0, nz = v ? 0 : 1;
    const L = { pivot, shut, open: [dirAngle(nx, nz), dirAngle(-nx, -nz)], v };
    L.now = L.to = d.open ? L.open[0] : L.shut; pivot.rotation.y = L.now;
    list.push(L); leaves[i] = list;
  });
  const turnTo = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d; };
  const setShutter = (p) => { if (!shutter) return; shutter.p = Math.max(0, Math.min(1, p)); shutter.panel.scale.y = Math.max(0.03, 1 - shutter.p); shutter.t.repeat.y = 10 * Math.max(0.03, 1 - shutter.p); crank.rotation.z = -shutter.p * Math.PI * 16; };
  group.userData.setShutter = setShutter;
  setShutter(shutter ? shutter.p : 0);
  group.userData.setDoor = (i, open, swing = 1, instant = false) => {
    if (world.doors[i] && world.doors[i].lock === 'shutter') { setShutter(open ? 1 : 0); return; }
    for (const L of leaves[i] || []) { L.to = turnTo(L.now, !open ? L.shut : swing >= 0 ? L.open[0] : L.open[1]); if (instant) { L.now = L.to; L.pivot.rotation.y = L.now; } }
  };
  group.userData.kickDoor = (i, swing = 1) => { for (const L of leaves[i] || []) { L.jolt = 1; L.joltSign = swing >= 0 ? 1 : -1; } };
  // window glass: dirty panes in the side rooms' windows (you see through them, and so does it)
  {
    const gm = new THREE.MeshBasicMaterial({ color: '#8fa7a2', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const fm = addFlash(new THREE.MeshBasicMaterial({ color: '#23292a' }));
    for (const r of plan.rooms) for (const w of r.win) {
      const y = floorY(r.floor), v = w.x1 - w.x0 < w.z1 - w.z0, len = v ? w.z1 - w.z0 : w.x1 - w.x0, cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), gm); pane.position.set(cx, y + 1.55, cz); if (v) pane.rotation.y = Math.PI / 2; pane.renderOrder = 3; group.add(pane);
      for (const [dy, hh] of [[1.02, 0.05], [2.08, 0.05]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(v ? 0.1 : len, hh, v ? len : 0.1), fm); b.position.set(cx, y + dy, cz); group.add(b); }
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.05), fm); mull.position.set(cx, y + 1.55, cz); group.add(mull);
    }
  }

  // ---------- puddles (lower floor): the floor is cut away there, and an upside-down copy of what stands round
  // it lies underneath, seen through dark water: a cheap true reflection of the ceiling, lamps, pillars and cars.
  // (The shapeshifter's fake car has no upside-down twin: no reflection.) ----------
  {
    const mirror = [], dark = '#0b0d0e';
    const water = new THREE.MeshBasicMaterial({ color: '#0c1113', transparent: true, opacity: 0.42, depthWrite: false });
    const mm = new THREE.Matrix4();
    for (const p of plan.puddles) {
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, w = p.x1 - p.x0, l = p.z1 - p.z0;
      const surf = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), water); surf.position.set(cx, 0.002, cz); surf.renderOrder = 2; group.add(surf);
      // the upside-down ceiling, a long way round
      const L = propLight(cx, 0, cz), cl = 0.07;
      mirror.push({ geo: new THREE.PlaneGeometry(w + 44, l + 44).rotateX(-Math.PI / 2), color: new THREE.Color((L[0] + L[3]) * cl + 0.02, (L[1] + L[3]) * cl + 0.02, (L[2] + L[3]) * cl + 0.02), m: new THREE.Matrix4().makeTranslation(cx, -CLEAR, cz), flat: 1 });
      // the sides of the cut (a few centimetres of wet concrete)
      mirror.push({ geo: new THREE.BoxGeometry(w, 0.02, l), color: dark, m: new THREE.Matrix4().makeTranslation(cx, -CLEAR - 0.02, cz), flat: 1 });
    }
    const nearPuddle = (x, z, pad) => plan.puddles.some(p => x > p.x0 - pad && x < p.x1 + pad && z > p.z0 - pad && z < p.z1 + pad);
    for (const L of lights) if (L.f === 0 && nearPuddle(L.x, L.z, 18)) {
      const tube = L.kind === 'tube';
      mirror.push({ geo: new THREE.BoxGeometry(tube ? 1.25 : 0.34, 0.05, tube ? 0.1 : 0.34), color: tube ? new THREE.Color(0.8, 0.88, 0.95) : new THREE.Color(1.1, 0.6, 0.2), m: new THREE.Matrix4().makeTranslation(L.x, -L.y, L.z), flat: 1 });
    }
    for (const pl of plan.pillars) if (pl.f === 0 && nearPuddle(pl.x, pl.z, 10)) { const L = propLight(pl.x + 0.25, 0, pl.z + 1.4); mirror.push({ geo: new THREE.BoxGeometry(0.5, CLEAR, 1), color: new THREE.Color((L[0] + L[3]) * 0.5 + 0.02, (L[1] + L[3]) * 0.5 + 0.02, (L[2] + L[3]) * 0.5 + 0.02), m: new THREE.Matrix4().makeTranslation(pl.x + 0.25, -CLEAR / 2, pl.z + 0.5) }); }
    const merged = mergeParts(mirror);
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    group.add(mesh);
    // upside-down cars
    const flip = [];
    for (const c of plan.cars) if (c.f === 0 && nearPuddle(c.x, c.z, 7)) {
      mm.compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, carYaw(c), 0)), new THREE.Vector3(1, -1, 1));
      flip.push({ geo: litGeo(carGeometry(c.kind, CAR_PAINTS[c.col], c.flat), c.x, 0, c.z), m: mm.clone() });
    }
    if (flip.length) { const m = new THREE.Mesh(mergeLit(flip), garMaterial({ side: THREE.DoubleSide })); group.add(m); }
    // a wet, darker rim round each puddle
    const [rc, rg] = canvas(64);
    const gr = rg.createRadialGradient(32, 32, 14, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); rg.fillStyle = gr; rg.fillRect(0, 0, 64, 64);
    const rimT = tex(rc, renderer, false);
    for (const p of plan.puddles) {
      const rim = new THREE.Mesh(new THREE.PlaneGeometry((p.x1 - p.x0) * 1.5, (p.z1 - p.z0) * 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: rimT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      rim.position.set((p.x0 + p.x1) / 2, 0.004, (p.z0 + p.z1) / 2); rim.renderOrder = 1; group.add(rim);
    }
  }

  // ---------- the goods lift: its own two doors (they shut for the ride: the ending), a call lamp that comes on with the power ----------
  const liftDoors = [];
  {
    const S = plan.shutter, y = S.y, w = (S.x1 - S.x0) / 2, tint = tintAt(3, y, 4);
    const dm = addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#6d7378').multiply(tint) }));
    for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.BoxGeometry(w, S.h, 0.05), dm); d.position.set((S.x0 + S.x1) / 2 + s * w * 1.5, y + S.h / 2, S.z0 - 0.06); d.userData = { s, w, mid: (S.x0 + S.x1) / 2 }; group.add(d); liftDoors.push(d); }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.03), new THREE.MeshBasicMaterial({ color: '#2a0d0a' })); lamp.position.set(S.x1 + 0.25, y + 1.4, S.z1 + 0.012); group.add(lamp);
    group.userData.liftLamp = lamp;
    const floorM = new THREE.Mesh(new THREE.PlaneGeometry(plan.lift.x1 - plan.lift.x0, plan.lift.z1 - plan.lift.z0).rotateX(-Math.PI / 2), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#3b4046').multiply(tint) })));
    floorM.position.set((plan.lift.x0 + plan.lift.x1) / 2, y + 0.008, (plan.lift.z0 + plan.lift.z1) / 2); group.add(floorM);
  }
  // k: 0 open (drawn back into the door posts, out of sight) … 1 shut (each door grows from its own side to the middle)
  group.userData.setLiftDoors = (k) => {
    k = Math.max(0, Math.min(1, k));
    for (const d of liftDoors) { const u = d.userData; d.visible = k > 0.01; d.scale.x = Math.max(0.01, k); d.position.x = u.mid + u.s * u.w * (1 - k / 2); }
  };
  group.userData.setLiftDoors(0);

  // ---------- batteries lying about (stage 5 makes them work): shown until someone takes one ----------
  const batt = plan.batteries.map((b) => {
    const tint = tintAt(b.x, b.y, b.z);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 10), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#2f6b3a').multiply(tint) })));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 10), addFlash(new THREE.MeshBasicMaterial({ color: new THREE.Color('#b9a23c').multiply(tint) }))); cap.position.y = 0.075;
    g.add(body, cap); g.rotation.z = Math.PI / 2; g.rotation.y = b.x * 3; g.position.set(b.x, b.y + 0.04, b.z);
    group.add(g);
    return g;
  });
  group.userData.setBattery = (i, on) => { if (batt[i]) batt[i].visible = !!on; };

  // ---------- drips from the ceiling ----------
  const DR = plan.drips.length, dGeo = new THREE.BufferGeometry(), dPos = new Float32Array(DR * 3).fill(-99);
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const drops = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: '#9fb4bd', size: 0.035, transparent: true, opacity: 0.8, depthWrite: false }));
  drops.frustumCulled = false; group.add(drops);
  const drip = plan.drips.map((d, i) => ({ ...d, y0: floorY(d.f) + CLEAR, base: floorY(d.f), t: -(i * 0.7) % d.every, v: 0, y: null }));
  group.userData.onDrip = null;            // game code: the plink, and a ripple if it lands in a puddle

  // ---------- how bright it is where you stand (for dimming people and the monster) ----------
  let power = 1;
  const flick = [1, 1, 1];
  group.userData.lightAt = (x, z, y = 0) => {
    const L = propLight(x, y, z);
    return (L[0] * 0.5 + L[1] * 0.4 + L[2] * 0.1 + (L[3] * flick[0] + L[4] * flick[1] + L[5] * flick[2]) * power) * 1.5;
  };
  const hemi = new THREE.HemisphereLight('#ffe6c4', '#3a3530', 1.5), topL = new THREE.DirectionalLight('#ffe9d0', 0.8);
  topL.position.set(0.3, 1, 0.2);
  group.add(hemi, topL);
  group.userData.dimPeople = (k) => { hemi.intensity = 1.5 * k; topL.intensity = 0.8 * k; };
  // the power: off = only the orange emergency lamps; on = the white tubes too (stage 7's fuse box will call this)
  group.userData.setPower = (on) => { power = on ? 1 : 0; if (group.userData.liftLamp) group.userData.liftLamp.material.color.set(on ? '#3cff6a' : '#2a0d0a'); };

  // ---------- runtime ----------
  let t = 0;
  group.userData.update = (dt, dread = 0, cam = null) => {
    t += dt;
    for (const list of leaves) for (const L of list || []) {
      if (L.jolt > 0) { L.jolt = Math.max(0, L.jolt - dt * 5); L.pivot.rotation.x = L.joltSign * 0.07 * Math.sin(L.jolt * Math.PI); }
      if (L.now === L.to) continue;
      const step = dt * 5.5, d = L.to - L.now;
      L.now = Math.abs(d) <= step ? L.to : L.now + Math.sign(d) * step;
      L.pivot.rotation.y = L.now;
    }
    // tubes that won't stay on: mostly on, with stutters and short blackouts (two groups, out of step)
    const s1 = Math.sin(t * 13.1) + Math.sin(t * 31.7) * 0.6 + Math.sin(t * 2.3) * 1.4;
    const s2 = Math.sin(t * 11.3 + 2) + Math.sin(t * 27.1) * 0.7 + Math.sin(t * 1.7 + 1) * 1.5;
    flick[1] = (s1 > -1.2 ? 1 : 0.06) * (0.9 + 0.1 * Math.sin(t * 90));
    flick[2] = (s2 > -1.0 ? 1 : 0.06) * (0.9 + 0.1 * Math.sin(t * 83));
    TUBE.uTube.value.set(power * flick[0], power * flick[1], power * flick[2]);
    for (let g = 0; g < 3; g++) { const k = power * flick[g]; tubeMats[g].color.setRGB(0.18 + 1.55 * k, 0.19 + 1.7 * k, 0.2 + 1.8 * k); }
    // drips
    for (let i = 0; i < DR; i++) {
      const d = drip[i];
      d.t += dt;
      if (d.y == null) { if (d.t >= d.every) { d.y = d.y0; d.v = 0; d.t = 0; } else { dPos[i * 3 + 1] = -99; continue; } }
      d.v += 9.8 * dt; d.y -= d.v * dt;
      if (d.y <= d.base + 0.02) { d.y = null; if (group.userData.onDrip && cam && Math.hypot(d.x - cam.x, d.z - cam.z) < 26) group.userData.onDrip(d.x, d.base, d.z); dPos[i * 3 + 1] = -99; continue; }
      dPos[i * 3] = d.x; dPos[i * 3 + 1] = d.y; dPos[i * 3 + 2] = d.z;
    }
    dGeo.attributes.position.needsUpdate = true;
  };
  TUBE.uTube.value.set(1, 1, 1);
  return { group, theme: { name: 'garage' }, fog: null, sky: null, sun: null, far: Math.min(gfx.viewDistance || 140, 100) };
}
