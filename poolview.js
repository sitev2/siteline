// Level 2's 3D scene: the Poolrooms. Everything is drawn in code (no image files):
//   - the boxy parts (floors, walls, ceilings, steps) come straight from the collision grid, so what you see is what
//     you bump into; the curved parts (pool edges with their rounded lips, round pillars, the stair tower, arches,
//     vaults, coves, the lane hall's slanted wall of capsule windows) are built on top from the plan in poolmap.js;
//   - soft light is "baked" when the level loads: every corner works out what reaches it from the white sky in the
//     windows and skylights and from the sun patches (bounced light), with shadows; the low sun itself comes through
//     one shadow picture taken at load (it never moves), so its patches have clean soft edges;
//   - the shaders (poolfx.js) draw the 5 cm mosaic, the water, the caustics, the beams and the dust.
import * as THREE from 'three';
import { CELL } from './world.js';
import { rng } from './brmap.js';
import { POOL, towerH } from './poolmap.js';
import { poolUniforms, tileMaterial, waterMaterial, shaftMaterial, dustMaterial, chromeMaterial, plainMaterial, glowMaterial, MAX_RIPPLES } from './poolfx.js';

const { G, U, WY, SH, ROOF } = POOL;
const ROOFT = ROOF + 0.4;
const S = POOL.sun;                                   // the way the sunlight travels
const SUN = [3.3, 2.4, 1.4], SKY = [13, 12.6, 11.6], ALB = [0.84, 0.79, 0.66];
const FIN = { cream: 0, white: 1, blue: 2, smooth: 3, gutter: 4 };

class Buf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.light = []; this.fx = []; this.glint = []; this.idx = []; this.map = new Map(); }
}

export function buildPoolScene(world, renderer, gfx = {}) {
  const plan = world.def.pool, Wc = world.w, Dc = world.h;
  const Q = gfx.effects === 'low' ? 0 : gfx.effects === 'medium' ? 1 : 2;
  const group = new THREE.Group(), ud = group.userData;
  const R = rng(4242);
  const UNI = poolUniforms(S);
  const spansAt = (ix, iz) => (ix < 0 || iz < 0 || ix >= Wc || iz >= Dc ? null : world.spans[iz * Wc + ix]);
  const outdoors = (ix, iz) => ix < 3 || iz < 3 || iz >= 101;            // beyond the glazed walls: open sky
  const drawn = s => s.m[0] !== '_';
  const solidAt = (ix, iz, y) => { const sp = spansAt(ix, iz); if (!sp) return true; for (const s of sp) if (s.y0 < y && s.y1 > y) return true; return false; };
  const bodyIdx = (ix, iz) => (ix < 0 || iz < 0 || ix >= Wc || iz >= Dc ? 0 : world.waterGrid[iz * Wc + ix]);
  // which water a surface at this cell can be under: 0 none, 1 a pool, 2 the Great Pool (and its tunnel), 3 flooded
  const wkOf = (ix, iz) => { const b = bodyIdx(ix, iz); if (!b) return 0; const o = world.bodies[b - 1]; return o.shallow ? 3 : o.name === 'great' ? 2 : 1; };
  const inExit = (x, z) => { const t = plan.exit.tunnel; return x > t.x0 - 0.01 && x < t.x1 + 0.01 && z > t.z0 - 0.01 && z < t.z1 + 0.01; };
  const sdfMin = (x, z) => { let d = 9; for (const p of plan.pools) if (x > p.x0 - 1.5 && x < p.x1 + 1.5 && z > p.z0 - 1.5 && z < p.z1 + 1.5) d = Math.min(d, p.sdf(x, z)); return d; };

  // ================= the light, worked out once =================
  // Everything that sends light: the white sky seen through each window and skylight, and the patches where the
  // sun lands (they glow warm and light the room round them). { x, y, z, nx, ny, nz, r, g, b, max, range2, sky }
  const emit = [], glints = [], apertures = [];
  const addEmit = (x, y, z, nx, ny, nz, c, sky) => {
    const max = Math.max(c[0], c[1], c[2]);
    emit.push({ x, y, z, nx, ny, nz, r: c[0], g: c[1], b: c[2], max, range2: Math.min(34 * 34, max / 0.0016), sky });
  };
  // the sun through an opening: follow rays to where they land; each landing spot becomes a warm lamp
  const vpl = new Map(), glintMap = new Map();
  const sunRay = (ox, oy, oz, area) => {
    const hit = world.raycast(ox, oy, oz, S[0], S[1], S[2], 90);
    if (!hit || hit.t < 0.02) return;
    const px = ox + S[0] * hit.t, py = oy + S[1] * hit.t, pz = oz + S[2] * hit.t;
    const b = world.bodyAt(px, pz);
    let k = 1;
    if (b && py < b.y - 0.02 && oy > b.y) {
      // it went into water on the way: that patch of surface throws dancing light back up
      const tw = (b.y - oy) / S[1], wx = ox + S[0] * tw, wz = oz + S[2] * tw, key = `${Math.round(wx)},${Math.round(wz)}`;
      const gl = glintMap.get(key) || { x: 0, y: b.y, z: 0, w: 0 };
      gl.x += wx * area; gl.z += wz * area; gl.w += area; glintMap.set(key, gl);
      k = 0.55;
    }
    const key = `${Math.round(px / 0.9)},${Math.round(py / 0.9)},${Math.round(pz / 0.9)},${hit.nx},${hit.ny},${hit.nz}`;
    const v = vpl.get(key) || { x: 0, y: 0, z: 0, nx: hit.nx, ny: hit.ny, nz: hit.nz, w: 0 };
    v.x += px * area * k; v.y += py * area * k; v.z += pz * area * k; v.w += area * k; vpl.set(key, v);
  };
  // an opening: its middle, the way in (n), two half-axes across it (a, b), its shape; sky light and sun through it
  const aperture = (c, n, a, b, shape, sunStep = 0.3) => {
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    const inside = (u, v) => {
      if (shape === 'rect') return true;
      const rr = Math.min(la, lb), du = Math.max(0, Math.abs(u) * la - (la - rr)), dv = Math.max(0, Math.abs(v) * lb - (lb - rr));
      if (shape === 'arch' && v < 0) return true;
      if (shape === 'arch') { const r2 = la, y = v * lb - (lb - r2); return y <= 0 || (u * la) ** 2 + y * y <= r2 * r2; }
      return du * du + dv * dv <= rr * rr;
    };
    // sky: a few samples across it
    const nu = Math.max(1, Math.round(la * 2 / 1.3)), nv = Math.max(1, Math.round(lb * 2 / 1.3));
    let area = 0;
    const pts = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = (i + 0.5) / nu * 2 - 1, v = (j + 0.5) / nv * 2 - 1;
      if (!inside(u * 0.8, v * 0.8)) continue;
      pts.push([c[0] + a[0] * u + b[0] * v + n[0] * 0.12, c[1] + a[1] * u + b[1] * v + n[1] * 0.12, c[2] + a[2] * u + b[2] * v + n[2] * 0.12]);
    }
    area = la * lb * 4 * (shape === 'rect' ? 1 : 0.86);
    for (const p of pts) addEmit(p[0], p[1], p[2], n[0], n[1], n[2], SKY.map(v => v * area / pts.length), true);
    // sun: a fine grid of rays
    const cosA = n[0] * S[0] + n[1] * S[1] + n[2] * S[2];
    const ap = { c, n, a, b, shape, la, lb, sun: 0, inside };
    if (cosA > 0.05) {
      const su = Math.max(2, Math.round(la * 2 / sunStep)), sv = Math.max(2, Math.round(lb * 2 / sunStep));
      const dA = (la * 2 / su) * (lb * 2 / sv) * cosA;
      for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) {
        const u = (i + 0.5) / su * 2 - 1, v = (j + 0.5) / sv * 2 - 1;
        if (!inside(u, v)) continue;
        sunRay(c[0] + a[0] * u + b[0] * v - n[0] * 0.3, c[1] + a[1] * u + b[1] * v - n[1] * 0.3, c[2] + a[2] * u + b[2] * v - n[2] * 0.3, dA);
        ap.sun += dA;
      }
    }
    apertures.push(ap);
  };
  for (const s of plan.skylights) aperture([(s.x0 + s.x1) / 2, ROOF + 0.2, (s.z0 + s.z1) / 2], [0, -1, 0], [(s.x1 - s.x0) / 2, 0, 0], [0, 0, (s.z1 - s.z0) / 2], s.round ? 'round' : 'rect');
  for (const o of plan.openings) {
    if (!o.out) continue;
    const at = o.out > 0 ? o.a0 + 0.1 : o.a1 - 0.1, uc = (o.u0 + o.u1) / 2, yc = (o.y0 + o.y1) / 2, hu = (o.u1 - o.u0) / 2, hy = (o.y1 - o.y0) / 2;
    if (o.axis === 'z') aperture([uc, yc, at], [0, 0, -o.out], [hu, 0, 0], [0, hy, 0], o.shape);
    else aperture([at, yc, uc], [-o.out, 0, 0], [0, 0, hu], [0, hy, 0], o.shape);
  }
  { const s = plan.slant; for (const w of s.windows) aperture([s.x - 0.1, (w.y0 + w.y1) / 2, w.z], [1, 0, 0], [0, 0, w.w / 2], [0, (w.y1 - w.y0) / 2, 0], 'capsule'); }
  for (const v of vpl.values()) {
    if (v.w < 0.02) continue;
    const k = v.w / Math.PI * 3.2;
    addEmit(v.x / v.w + v.nx * 0.06, v.y / v.w + v.ny * 0.06, v.z / v.w + v.nz * 0.06, v.nx, v.ny, v.nz, [SUN[0] * ALB[0] * k, SUN[1] * ALB[1] * k, SUN[2] * ALB[2] * k], false);
  }
  for (const gl of glintMap.values()) if (gl.w > 0.05) glints.push({ x: gl.x / gl.w, y: gl.y, z: gl.z / gl.w, w: gl.w });

  // move a point on a surface a little way into the open (so its light isn't looked up from inside a wall)
  const nudge = (x, y, z, out) => {
    const xa = Math.floor((x - 0.02) / CELL), xb = Math.floor((x + 0.02) / CELL), za = Math.floor((z - 0.02) / CELL), zb = Math.floor((z + 0.02) / CELL);
    let ox = 0, oz = 0, n = 0, tot = 0;
    for (let iz = za; iz <= zb; iz++) for (let ix = xa; ix <= xb; ix++) { tot++; if (!solidAt(ix, iz, y)) { ox += (ix + 0.5) * CELL - x; oz += (iz + 0.5) * CELL - z; n++; } }
    out.solid = tot - n; out.tot = tot;
    if (!n || n === tot) { out.x = x; out.z = z; return out; }
    const l = Math.hypot(ox, oz) || 1;
    out.x = x + ox / l * 0.08; out.z = z + oz / l * 0.08;
    return out;
  };
  const nd = { x: 0, z: 0, solid: 0, tot: 1 };
  const raw = { r: 0, g: 0, b: 0, gx: 0, gy: 0, gz: 0, c: 0 };
  // the light landing on a surface at p facing n (straight from the lamps above; no fill yet)
  const direct = (px, py, pz, nx, ny, nz, wantGlint) => {
    let r = 0, g = 0, b = 0, gx = 0, gy = 0, gz = 0;
    for (let i = 0; i < emit.length; i++) {
      const e = emit[i], dx = e.x - px, dy = e.y - py, dz = e.z - pz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > e.range2) continue;
      const cr = nx * dx + ny * dy + nz * dz; if (cr <= 0) continue;
      const ce = -(e.nx * dx + e.ny * dy + e.nz * dz); if (ce <= 0) continue;
      const k = cr * ce / (d2 * (d2 + 0.7));
      if (k * e.max < 0.0012) continue;
      if (!world.los(px, py, pz, e.x, e.y, e.z)) continue;
      r += e.r * k; g += e.g * k; b += e.b * k;
      if (wantGlint && e.sky) { const d = Math.sqrt(d2), w = e.max * ce / (d * (d2 + 0.7)) / d; gx += dx * w; gy += dy * w; gz += dz * w; }
    }
    raw.r = r; raw.g = g; raw.b = b; raw.gx = gx; raw.gy = gy; raw.gz = gz;
    let c = 0;
    if (Q > 0 && glints.length) {
      for (const gl of glints) {
        const dx = gl.x - px, dy = gl.y - py, dz = gl.z - pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 140 || dy > -0.03) continue;
        const cr = nx * dx + ny * dy + nz * dz; if (cr <= 0) continue;
        const k = gl.w * cr * (-dy) / (d2 * (d2 + 1.2));
        if (k < 0.004) continue;
        if (!world.los(px, py, pz, gl.x, gl.y + 0.05, gl.z)) continue;
        c += k;
      }
    }
    raw.c = c;
    return raw;
  };
  // probes: the light level in the air on a coarse grid (2 m), for the soft fill light and for lighting people
  const PS = 2, PW = Math.ceil(64 / PS) + 1, PD = Math.ceil(52 / PS) + 1, PY = [G + 1.3, 6.6, U + 1.3];
  const probe = PY.map(() => new Float32Array(PW * PD * 3)), probeOk = PY.map(() => new Uint8Array(PW * PD));
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  PY.forEach((y, L) => {
    for (let j = 0; j < PD; j++) for (let i = 0; i < PW; i++) {
      const x = Math.min(63.75, i * PS + 0.25), z = Math.min(51.75, j * PS + 0.25), ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
      if (outdoors(ix, iz) || solidAt(ix, iz, y) || solidAt(ix, iz, y - 0.6)) continue;
      let r = 0, g = 0, b = 0;
      for (const d of DIRS) { direct(x, y, z, d[0], d[1], d[2], false); r += raw.r; g += raw.g; b += raw.b; }
      const k = (j * PW + i) * 3;
      probe[L][k] = r / 6; probe[L][k + 1] = g / 6; probe[L][k + 2] = b / 6; probeOk[L][j * PW + i] = 1;
    }
  });
  // the fill: the probes blurred (light that has bounced about the room)
  const fill = probe.map((src, L) => {
    let a = src;
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(a.length);
      for (let j = 0; j < PD; j++) for (let i = 0; i < PW; i++) {
        if (!probeOk[L][j * PW + i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= PW || jj >= PD || !probeOk[L][jj * PW + ii]) continue;
          const k = (jj * PW + ii) * 3, w = di || dj ? 1 : 2;
          r += a[k] * w; g += a[k + 1] * w; b += a[k + 2] * w; n += w;
        }
        const k = (j * PW + i) * 3; o[k] = r / n; o[k + 1] = g / n; o[k + 2] = b / n;
      }
      a = o;
    }
    return a;
  });
  const fo = [0, 0, 0];
  const sample = (grid, x, y, z) => {
    const order = y < 5.2 ? [0, 1, 2] : y < 8.7 ? [1, 0, 2] : [2, 1, 0];
    const fx = Math.max(0, Math.min(PW - 1.001, (x - 0.25) / PS)), fz = Math.max(0, Math.min(PD - 1.001, (z - 0.25) / PS)), i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
    for (const L of order) {
      let r = 0, g = 0, b = 0, n = 0;
      for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]]) {
        const idx = (j0 + dj) * PW + i0 + di;
        if (!probeOk[L][idx] || w <= 0) continue;
        r += grid[L][idx * 3] * w; g += grid[L][idx * 3 + 1] * w; b += grid[L][idx * 3 + 2] * w; n += w;
      }
      if (n > 0.05) { fo[0] = r / n; fo[1] = g / n; fo[2] = b / n; return fo; }
    }
    fo[0] = fo[1] = fo[2] = 0; return fo;
  };
  // damp patches on the dry floor near water (0 … 1), blotchy
  const blotch = (x, z) => 0.5 + 0.5 * Math.sin(x * 1.31 + Math.sin(z * 0.83) * 1.7) * Math.cos(z * 1.17 - Math.sin(x * 0.61) * 1.3);
  const wetAt = (x, y, z) => {
    if (Math.abs(y - G) > 0.12) return 0;
    let d = sdfMin(x, z);
    for (const s of plan.shallows) { const dx = Math.max(s.x0 - x, 0, x - s.x1), dz = Math.max(s.z0 - z, 0, z - s.z1); d = Math.min(d, Math.hypot(dx, dz)); }
    if (d > 2.6) return 0;
    const near = Math.max(0, 1 - d / 2.6);
    return Math.min(1, near * near * 1.5 * (0.25 + 0.75 * blotch(x, z)) + (d < 0.5 ? 0.35 : 0));
  };
  // the finished light at a point on a surface: { l: [r, g, b], g: [x, y, z] (where the sky's shine comes from), c }
  const shadeCache = new Map();
  const shade = (x, y, z, nx, ny, nz) => {
    const key = `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)},${Math.round(nx * 8)},${Math.round(ny * 8)},${Math.round(nz * 8)}`;
    let o = shadeCache.get(key);
    if (o) return o;
    const py = y + ny * 0.07 + (Math.abs(ny) < 0.5 ? 0 : 0);
    nudge(x + nx * 0.07, Math.max(0.05, py), z + nz * 0.07, nd);
    direct(nd.x, Math.max(0.05, py), nd.z, nx, ny, nz, true);
    let ao = 1;
    if (nd.tot > 1) ao -= 0.13 * nd.solid;
    if (Math.abs(ny) < 0.5) {
      // on a wall: darker right down by the floor and right up under the ceiling
      const ix = Math.floor(nd.x / CELL), iz = Math.floor(nd.z / CELL);
      if (solidAt(ix, iz, y - 0.25)) ao -= 0.18;
      if (solidAt(ix, iz, y + 0.25)) ao -= 0.22;
    }
    const f = sample(fill, nd.x, y + ny * 0.5, nd.z);
    const up = ny > 0.5 ? 0.85 : ny < -0.5 ? 1.0 : 1;
    const l = [(raw.r + f[0] * 1.5 * up + 0.05) * ao, (raw.g + f[1] * 1.5 * up + 0.048) * ao, (raw.b + f[2] * 1.5 * up + 0.045) * ao];
    // the eye gets used to each room: very bright halls are pulled down, dim ones hardly changed
    { const m = Math.max(l[0], l[1], l[2], 1e-4), room = roomAt(nd.x, y + ny * 0.3, nd.z), k = 1.12 / (m + 1) * (room && room.dark ? room.dark : 1); l[0] *= k; l[1] *= k; l[2] *= k; }
    const gm = Math.hypot(raw.gx, raw.gy, raw.gz), gk = gm > 1e-5 ? Math.min(1.6, gm * 0.55) / gm : 0;
    o = { l, g: [raw.gx * gk, raw.gy * gk, raw.gz * gk], c: Math.min(1.6, raw.c * 5.5), w: ny > 0.5 ? wetAt(x, y, z) : 0 };
    shadeCache.set(key, o);
    return o;
  };

  // ================= geometry =================
  const chunks = new Map();
  const bufAt = (x, y, z, set = 'tile') => {
    const k = `${set}:${Math.floor(x / 16)},${Math.floor(z / 13)},${y > 8.6 ? 1 : 0}`;
    let B = chunks.get(k);
    if (!B) { B = new Buf(); B.set = set; chunks.set(k, B); }
    return B;
  };
  // one corner: position, the way the surface faces, where it is on the tiling (metres), finish, water kind
  const V = (B, x, y, z, nx, ny, nz, u, v, fin, wk = 0, lit = null) => {
    const key = `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)},${Math.round(nx * 30)},${Math.round(ny * 30)},${Math.round(nz * 30)},${Math.round(u * 500)},${Math.round(v * 500)},${fin},${wk}`;
    let i = B.map.get(key);
    if (i !== undefined) return i;
    i = B.pos.length / 3;
    const s = lit || shade(x, y, z, nx, ny, nz);
    B.pos.push(x, y, z); B.nor.push(nx, ny, nz); B.uv.push(u, v);
    B.light.push(s.l[0], s.l[1], s.l[2]); B.glint.push(s.g[0], s.g[1], s.g[2]);
    B.fx.push(fin, wk, wk ? 0 : s.c, s.w || 0);
    B.map.set(key, i);
    return i;
  };
  // a triangle, wound so that it faces n
  const tri = (B, a, b, c, nx, ny, nz) => {
    const p = B.pos, ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az, vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * gx + gy * gy + gz * gz < 1e-14) return;
    if (gx * nx + gy * ny + gz * nz >= 0) B.idx.push(a, b, c); else B.idx.push(a, c, b);
  };
  const quad = (B, a, b, c, d, nx, ny, nz) => { tri(B, a, b, c, nx, ny, nz); tri(B, a, c, d, nx, ny, nz); };
  // a level rectangle (ny = ±1)
  const flat = (x0, z0, x1, z1, y, ny, fin, wk) => {
    const B = bufAt((x0 + x1) / 2, y - ny * 0.3, (z0 + z1) / 2);
    quad(B, V(B, x0, y, z0, 0, ny, 0, x0, z0, fin, wk), V(B, x1, y, z0, 0, ny, 0, x1, z0, fin, wk), V(B, x1, y, z1, 0, ny, 0, x1, z1, fin, wk), V(B, x0, y, z1, 0, ny, 0, x0, z1, fin, wk), 0, ny, 0);
  };
  const roomAt = plan.roomAt;

  // ---- which cells are at a pool's edge (their deck is cut to the smooth edge by hand, below) ----
  const isDeck = (ix, iz) => { const sp = spansAt(ix, iz); return !!sp && sp.some(s => Math.abs(s.y1 - G) < 0.01) && !sp.some(s => s.y0 < G + 2 && s.y1 > G + 0.01); };
  const poolCell = (ix, iz) => (ix < 0 || iz < 0 || ix >= Wc || iz >= Dc ? -1 : plan.poolGrid[iz * Wc + ix]);
  const edge = new Uint8Array(Wc * Dc);
  for (const p of plan.pools) {
    for (let iz = Math.floor((p.z0 - 1) * 2); iz < Math.ceil((p.z1 + 1) * 2); iz++) for (let ix = Math.floor((p.x0 - 1) * 2); ix < Math.ceil((p.x1 + 1) * 2); ix++) {
      if (ix < 0 || iz < 0 || ix >= Wc || iz >= Dc) continue;
      if (!isDeck(ix, iz) && poolCell(ix, iz) < 0) continue;
      let neg = false;
      for (let j = 0; j <= 2 && !neg; j++) for (let i = 0; i <= 2; i++) if (sdfMin(ix * CELL + i * 0.25, iz * CELL + j * 0.25) < 0) { neg = true; break; }
      if (neg || poolCell(ix, iz) >= 0) edge[iz * Wc + ix] = 1;
    }
  }

  // ---- the mesher: every face of the collision grid you can see ----
  const ROWS = [1.2, 2.1, WY - 0.2, G, G + 0.7, G + 1.5, G + 2.3, G + 3.1, G + 4.2, 8.6, U, U + 0.7, U + 1.4, U + 2.1];
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const wallFin = (x, y, z) => { const r = roomAt(x, y, z); return r && r.wall === 'smooth' ? FIN.smooth : FIN.cream; };
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    if (outdoors(ix, iz)) continue;
    const spans = world.spans[iz * Wc + ix], x0 = ix * CELL, z0 = iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL, cx = x0 + 0.25, cz = z0 + 0.25;
    const wk = wkOf(ix, iz) || (inExit(cx, cz) ? 2 : 0);
    if (!spans.some(s => s.y0 <= 0.01)) flat(x0, z0, x1, z1, 0, 1, FIN.cream, wk);        // the Great Pool's floor, the tunnel
    for (const s of spans) {
      if (!drawn(s)) continue;
      // top
      if (s.y1 < ROOFT - 0.01 && !spans.some(t => t !== s && t.y0 <= s.y1 + 0.001 && t.y1 > s.y1 + 0.001)) {
        if (!(edge[iz * Wc + ix] && Math.abs(s.y1 - G) < 0.01)) flat(x0, z0, x1, z1, s.y1, 1, s.m === 'pillar' ? FIN.white : FIN.cream, s.y1 < WY ? wk : 0);
      }
      // underside
      if (s.y0 > 0.01 && !spans.some(t => t !== s && t.y1 >= s.y0 - 0.001 && t.y0 < s.y0 - 0.001)) {
        const r = roomAt(cx, s.y0 - 0.1, cz);
        flat(x0, z0, x1, z1, s.y0, -1, r && r.ceil === 'smooth' ? FIN.smooth : FIN.cream, 0);
      }
      // sides
      for (const [nx, nz] of SIDES) {
        const jx = ix + nx, jz = iz + nz, nb = spansAt(jx, jz);
        if (!nb || outdoors(jx, jz)) continue;
        let parts = [[s.y0, Math.min(s.y1, ROOFT)]];
        for (const t of nb) {
          if (!drawn(t)) continue;
          const next = [];
          for (const [a, b] of parts) { if (t.y1 <= a || t.y0 >= b) { next.push([a, b]); continue; } if (t.y0 > a + 0.001) next.push([a, t.y0]); if (t.y1 < b - 0.001) next.push([t.y1, b]); }
          parts = next;
        }
        if (!parts.length) continue;
        // a deck's edge down into a pool is drawn by hand along the smooth edge (unless a wall stands on it)
        const nbPool = poolCell(jx, jz) >= 0, deckEdge = nbPool && Math.abs(s.y1 - G) < 0.01 && !spans.some(t => t.y0 < G + 2 && t.y1 > G + 0.01);
        if (deckEdge) continue;
        const nwk = wkOf(jx, jz) || (inExit((jx + 0.5) * CELL, (jz + 0.5) * CELL) ? 2 : 0);
        const e = nx === 1 ? [[x1, z1], [x1, z0]] : nx === -1 ? [[x0, z0], [x0, z1]] : nz === 1 ? [[x0, z1], [x1, z1]] : [[x1, z0], [x0, z0]];
        const ua = nx ? e[0][1] : e[0][0], ub = nx ? e[1][1] : e[1][0];
        const mx = (e[0][0] + e[1][0]) / 2 + nx * 0.06, mz = (e[0][1] + e[1][1]) / 2 + nz * 0.06;
        for (const [a, b] of parts) {
          const rows = [a, ...ROWS.filter(y => y > a + 0.05 && y < b - 0.05), b];
          for (let r = 0; r < rows.length - 1; r++) {
            const ya = rows[r], yb = rows[r + 1], ym = (ya + yb) / 2;
            let fin = s.m === 'pillar' ? FIN.white : wallFin(mx, ym, mz);
            if (nbPool && ym > WY - 0.2 && ym < G) fin = FIN.blue;                  // the waterline band
            const w2 = ym < WY + 0.05 ? nwk : 0;
            const B = bufAt(mx, ym, mz);
            quad(B, V(B, e[0][0], ya, e[0][1], nx, 0, nz, ua, ya, fin, w2), V(B, e[1][0], ya, e[1][1], nx, 0, nz, ub, ya, fin, w2),
              V(B, e[1][0], yb, e[1][1], nx, 0, nz, ub, yb, fin, w2), V(B, e[0][0], yb, e[0][1], nx, 0, nz, ua, yb, fin, w2), nx, 0, nz);
          }
        }
      }
    }
  }

  // ---- pool edges: the deck cut to the smooth outline, the wall under it, the rounded lip, the overflow gutter ----
  const H = 0.25;
  const lerpX = (a, b, va, vb) => a + (b - a) * (va / (va - vb));
  // the dry part (sdf >= 0) of one 0.25 m square, as a polygon
  const dryPoly = (x, z, f) => {
    const c = [[x, z], [x + H, z], [x + H, z + H], [x, z + H]], v = c.map(p => f(p[0], p[1])), out = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (v[i] >= 0) out.push(c[i]);
      if ((v[i] >= 0) !== (v[j] >= 0)) out.push([lerpX(c[i][0], c[j][0], v[i], v[j]), lerpX(c[i][1], c[j][1], v[i], v[j])]);
    }
    return out;
  };
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    if (!edge[iz * Wc + ix]) continue;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const poly = dryPoly(ix * CELL + i * H, iz * CELL + j * H, sdfMin);
      if (poly.length < 3) continue;
      const B = bufAt(poly[0][0], G, poly[0][1]);
      const idx = poly.map(p => V(B, p[0], G, p[1], 0, 1, 0, p[0], p[1], FIN.cream, 0));
      for (let k = 1; k < idx.length - 1; k++) tri(B, idx[0], idx[k], idx[k + 1], 0, 1, 0);
    }
  }
  // each pool's outline as chains of points (only where it runs between water and deck, not inside a wall)
  const wallAbove = (ix, iz) => { const sp = spansAt(ix, iz); return !sp || sp.some(s => s.y0 < G + 1.5 && s.y1 > G + 0.05); };
  const outlines = [];
  for (const p of plan.pools) {
    const segs = [];
    for (let z = Math.floor(p.z0 * 4) / 4 - 0.5; z < p.z1 + 0.5; z += H) for (let x = Math.floor(p.x0 * 4) / 4 - 0.5; x < p.x1 + 0.5; x += H) {
      const c = [[x, z], [x + H, z], [x + H, z + H], [x, z + H]], v = c.map(q => p.sdf(q[0], q[1])), cross = [];
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; if ((v[i] >= 0) !== (v[j] >= 0)) cross.push([lerpX(c[i][0], c[j][0], v[i], v[j]), lerpX(c[i][1], c[j][1], v[i], v[j])]); }
      if (cross.length < 2) continue;
      for (let k = 0; k + 1 < cross.length; k += 2) {
        const a = cross[k], b = cross[k + 1], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, e = 0.03;
        let gx = p.sdf(mx + e, mz) - p.sdf(mx - e, mz), gz = p.sdf(mx, mz + e) - p.sdf(mx, mz - e); const l = Math.hypot(gx, gz) || 1; gx /= l; gz /= l;
        if (poolCell(Math.floor((mx - gx * 0.2) / CELL), Math.floor((mz - gz * 0.2) / CELL)) !== p.id) continue;
        if (wallAbove(Math.floor((mx + gx * 0.3) / CELL), Math.floor((mz + gz * 0.3) / CELL))) continue;
        segs.push([a, b]);
      }
    }
    // join them end to end
    const key = q => `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`, ends = new Map();
    segs.forEach((s, i) => { for (const q of s) { const k = key(q); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
    const used = new Uint8Array(segs.length);
    const walk = (i, from) => {
      const pts = [from === 0 ? segs[i][0] : segs[i][1]];
      let cur = i, at = from === 0 ? segs[i][1] : segs[i][0];
      for (;;) {
        used[cur] = 1; pts.push(at);
        const nxt = (ends.get(key(at)) || []).find(j => !used[j]);
        if (nxt === undefined) break;
        cur = nxt; at = key(segs[nxt][0]) === key(at) ? segs[nxt][1] : segs[nxt][0];
      }
      return pts;
    };
    // open chains start at a loose end; what is left are closed loops
    segs.forEach((s, i) => { if (used[i]) return; for (const e of [0, 1]) if ((ends.get(key(s[e])) || []).length === 1 && !used[i]) outlines.push({ pool: p, pts: walk(i, e), closed: false }); });
    segs.forEach((s, i) => { if (!used[i]) { const pts = walk(i, 0); outlines.push({ pool: p, pts, closed: key(pts[0]) === key(pts[pts.length - 1]) }); } });
  }
  const LIP = [[0.0, -0.09], [-0.05, -0.06], [-0.06, 0.0], [-0.035, 0.055], [0.03, 0.086], [0.13, 0.092], [0.25, 0.074], [0.33, 0.04], [0.37, 0.004]];
  for (const o of outlines) {
    const p = o.pool, pts = o.pts, n = pts.length;
    if (n < 2) continue;
    // the way out of the water at each point, and the distance along the edge (for the tiling)
    const nrm = pts.map(q => { const e = 0.03; let gx = p.sdf(q[0] + e, q[1]) - p.sdf(q[0] - e, q[1]), gz = p.sdf(q[0], q[1] + e) - p.sdf(q[0], q[1] - e); const l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; });
    const len = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[n - 1], fit = o.closed ? Math.max(0.05, Math.round(total / 0.05) * 0.05) / total : 1;
    const wk = p.name === 'great' ? 2 : 1;
    const wallRows = [p.bottom, ...[1.2, 2.1].filter(y => y > p.bottom + 0.3 && y < WY - 0.4), WY - 0.2, G - 0.09];
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1], na = nrm[i], nb = nrm[i + 1], ua = len[i] * fit, ub = len[i + 1] * fit;
      const B = bufAt(a[0], G - 1, a[1]);
      // the wall down into the pool (a pale blue band at the waterline)
      for (let r = 0; r < wallRows.length - 1; r++) {
        const ya = wallRows[r], yb = wallRows[r + 1], fin = r === wallRows.length - 2 ? FIN.blue : FIN.cream;
        quad(B, V(B, a[0], ya, a[1], -na[0], 0, -na[1], ua, ya, fin, wk), V(B, b[0], ya, b[1], -nb[0], 0, -nb[1], ub, ya, fin, wk),
          V(B, b[0], yb, b[1], -nb[0], 0, -nb[1], ub, yb, fin, wk), V(B, a[0], yb, a[1], -na[0], 0, -na[1], ua, yb, fin, wk), -(na[0] + nb[0]), 0, -(na[1] + nb[1]));
      }
      // the lip: a thick rounded band of tiles standing a little proud of the deck
      let vv = 0;
      for (let k = 0; k < LIP.length - 1; k++) {
        const [o0, h0] = LIP[k], [o1, h1] = LIP[k + 1], dl = Math.hypot(o1 - o0, h1 - h0);
        // the profile's own normal: turned a quarter from its direction
        const tx = (o1 - o0) / dl, ty = (h1 - h0) / dl, pn = [-ty, tx];                 // (outwards part, upwards part)
        const up = Math.max(-1, Math.min(1, pn[1])), outw = pn[0];
        const P = (q, nq, off, h, u, v) => V(B, q[0] + nq[0] * off, G + h, q[1] + nq[1] * off, nq[0] * outw, up, nq[1] * outw, u, v, FIN.cream, 0);
        quad(B, P(a, na, o0, h0, ua, vv), P(b, nb, o0, h0, ub, vv), P(b, nb, o1, h1, ub, vv + dl), P(a, na, o1, h1, ua, vv + dl), (na[0] + nb[0]) * outw, up * 2, (na[1] + nb[1]) * outw);
        vv += dl;
      }
      // the overflow gutter just outside it
      { const P = (q, nq, off, u, v) => V(B, q[0] + nq[0] * off, G + 0.004, q[1] + nq[1] * off, 0, 1, 0, u, v, FIN.gutter, 0);
        quad(B, P(a, na, 0.4, ua, 0), P(b, nb, 0.4, ub, 0), P(b, nb, 0.475, ub, 0.075), P(a, na, 0.475, ua, 0.075), 0, 1, 0); }
    }
  }
  // lane lines on the floors of the straight pools (pale blue)
  const stripe = (x0, z0, x1, z1, y, wk) => {
    for (let z = z0; z < z1 - 0.01; z += 2) {
      const zb = Math.min(z1, z + 2), B = bufAt(x0, y, z);
      quad(B, V(B, x0, y, z, 0, 1, 0, x0, z, FIN.blue, wk), V(B, x1, y, z, 0, 1, 0, x1, z, FIN.blue, wk), V(B, x1, y, zb, 0, 1, 0, x1, zb, FIN.blue, wk), V(B, x0, y, zb, 0, 1, 0, x0, zb, FIN.blue, wk), 0, 1, 0);
    }
  };
  for (const xm of [48, 52, 56]) { stripe(xm - 0.15, 27, xm + 0.15, 39, 0.004, 2); stripe(xm - 0.6, 26.7, xm + 0.6, 27, 0.004, 2); stripe(xm - 0.6, 39, xm + 0.6, 39.3, 0.004, 2); }
  stripe(3.65, 18, 3.95, 41, plan.pools[6].bottom + 0.004, 1);
  stripe(37.85, 23, 38.15, 44, plan.pools[3].bottom + 0.004, 1);

  // ---- round pillars ----
  const segsRound = Q === 0 ? 14 : 24;
  const cylinder = (cx, cz, r, y0, y1, fin, wkBase, inward = false, a0 = 0, a1 = Math.PI * 2, segs = segsRound, yBot = null) => {
    const tiles = Math.max(8, Math.round(Math.PI * 2 * r / 0.05)), uPer = tiles * 0.05 / (Math.PI * 2);
    const rows = [y0, ...ROWS.filter(y => y > y0 + 0.1 && y < y1 - 0.1), y1], sg = inward ? -1 : 1;
    for (let k = 0; k < segs; k++) {
      const ta = a0 + (a1 - a0) * k / segs, tb = a0 + (a1 - a0) * (k + 1) / segs;
      const ca = Math.cos(ta), sa = Math.sin(ta), cb = Math.cos(tb), sb = Math.sin(tb);
      const ba = yBot ? yBot(ta) : y0, bb = yBot ? yBot(tb) : y0;
      const B = bufAt(cx + ca * r, (y0 + y1) / 2, cz + sa * r);
      for (let i = 0; i < rows.length - 1; i++) {
        let ya0 = Math.max(rows[i], ba), ya1 = Math.max(rows[i + 1], ba), yb0 = Math.max(rows[i], bb), yb1 = Math.max(rows[i + 1], bb);
        if (ya1 - ya0 < 1e-4 && yb1 - yb0 < 1e-4) continue;
        const wk = (rows[i] + rows[i + 1]) / 2 < WY ? wkBase : 0;
        const P = (c, s, t, y) => V(B, cx + c * r, y, cz + s * r, c * sg, 0, s * sg, t * uPer, y, fin, wk);
        quad(B, P(ca, sa, ta, ya0), P(cb, sb, tb, yb0), P(cb, sb, tb, yb1), P(ca, sa, ta, ya1), (ca + cb) * sg, 0, (sa + sb) * sg);
      }
    }
  };
  for (const p of plan.pillars) cylinder(p.x, p.z, p.r, p.y0, p.y1, FIN.white, p.y0 < G - 0.1 ? 3 : 0);

  // ---- round rooms: their walls (with arched ways through), and the curved stair in the tower ----
  for (const o of plan.rings) {
    const gaps = o.gaps.map(g => {
      const gx = (g.x0 + g.x1) / 2, gz = (g.z0 + g.z1) / 2, w = Math.abs(gx - o.x) > Math.abs(gz - o.z) ? g.z1 - g.z0 : g.x1 - g.x0;
      return { th: Math.atan2(gz - o.z, gx - o.x), half: Math.asin(Math.min(0.99, w / 2 / o.R)), a: w / 2, y0: g.y0, top: g.y1 - 0.02 };
    });
    // the bottom of the wall at an angle: the floor, or the arch over a way through
    const yBot = (t) => {
      for (const g of gaps) {
        let d = t - g.th; d = Math.atan2(Math.sin(d), Math.cos(d));
        const s = Math.sin(d) * o.R;                         // how far across the doorway
        if (Math.abs(d) < g.half + 1e-6 && Math.abs(s) <= g.a + 1e-6) return g.top - g.a + Math.sqrt(Math.max(0, g.a * g.a - s * s));
      }
      return o.y0;
    };
    // angles: plenty of them, and extra ones across each doorway
    const cuts = new Set();
    const N = Math.round(o.R * 9);
    for (let k = 0; k < N; k++) cuts.add(Math.round((k / N * Math.PI * 2) * 1e4) / 1e4);
    for (const g of gaps) for (let k = 0; k <= 12; k++) { let t = g.th - g.half + g.half * 2 * k / 12; t = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); cuts.add(Math.round(t * 1e4) / 1e4); }
    const list = [...cuts].sort((a, b) => a - b);
    for (let k = 0; k < list.length; k++) {
      const ta = list[k], tb = k + 1 < list.length ? list[k + 1] : list[0] + Math.PI * 2;
      cylinder(o.x, o.z, o.R, o.y0, o.y1, FIN.cream, 0, true, ta, tb, 1, yBot);
    }
    // the arch's underside, out through the thickness of the wall
    for (const g of gaps) {
      const dx = Math.cos(g.th), dz = Math.sin(g.th), tx = -dz, tz = dx, depth = 1.3;
      for (let k = 0; k < 12; k++) {
        const s0 = -g.a + g.a * 2 * k / 12, s1 = -g.a + g.a * 2 * (k + 1) / 12;
        const P = (s, out) => {
          const y = g.top - g.a + Math.sqrt(Math.max(0, g.a * g.a - s * s)), rr = Math.sqrt(Math.max(0, o.R * o.R - s * s)) - 0.02 + out;
          const x = o.x + dx * rr + tx * s, z = o.z + dz * rr + tz * s, B = bufAt(x, y, z);
          return [B, x, y, z, s];
        };
        const B = bufAt(o.x + dx * o.R, g.top, o.z + dz * o.R);
        const mk = (s, out) => { const q = P(s, out), nn = [-(s / g.a) * tx, -Math.sqrt(Math.max(0, 1 - (s / g.a) ** 2)), -(s / g.a) * tz]; return V(B, q[1], q[2], q[3], nn[0], nn[1], nn[2], out, g.a * Math.asin(Math.max(-1, Math.min(1, s / g.a))), FIN.cream, 0); };
        quad(B, mk(s0, 0), mk(s1, 0), mk(s1, depth), mk(s0, depth), 0, -1, 0);
      }
    }
    if (o.core) cylinder(o.x, o.z, o.core, o.y0, o.y1, FIN.white, 0);
  }
  {
    const T = plan.tower, RAD = Math.PI / 180;
    const at = (th, r) => [T.x + Math.cos((th + 90) * RAD) * r, T.z + Math.sin((th + 90) * RAD) * r];
    const tan = (th) => [-Math.sin((th + 90) * RAD), Math.cos((th + 90) * RAD)];         // the way round (uphill)
    const rIn = T.core, rOut = T.R, rs = [rIn, (rIn + rOut) / 2, rOut];
    const dth = (T.a1 - T.a0) / T.steps, rise = (U - G) / T.steps;
    const sector = (t0, t1, y, ny, fin = FIN.cream) => {
      const sub = 2;
      for (let k = 0; k < sub; k++) {
        const ta = t0 + (t1 - t0) * k / sub, tb = t0 + (t1 - t0) * (k + 1) / sub;
        for (let j = 0; j < 2; j++) {
          const pa = at(ta, rs[j]), pb = at(tb, rs[j]), pc = at(tb, rs[j + 1]), pd = at(ta, rs[j + 1]), B = bufAt(pa[0], y, pa[1]);
          const P = (p, t, r) => V(B, p[0], y, p[1], 0, ny, 0, t * RAD * 3.3, r, fin, 0);
          quad(B, P(pa, ta, rs[j]), P(pb, tb, rs[j]), P(pc, tb, rs[j + 1]), P(pd, ta, rs[j + 1]), 0, ny, 0);
        }
      }
    };
    const riser = (th, ya, yb, dir, fin = FIN.cream) => {            // an upright face across the stair at an angle
      const t = tan(th), nx = t[0] * dir, nz = t[1] * dir;
      const rows = [ya, ...ROWS.filter(y => y > ya + 0.2 && y < yb - 0.2), yb];
      for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < 2; j++) {
        const pa = at(th, rs[j]), pb = at(th, rs[j + 1]), B = bufAt(pa[0], rows[i], pa[1]);
        quad(B, V(B, pa[0], rows[i], pa[1], nx, 0, nz, rs[j], rows[i], fin, 0), V(B, pb[0], rows[i], pb[1], nx, 0, nz, rs[j + 1], rows[i], fin, 0),
          V(B, pb[0], rows[i + 1], pb[1], nx, 0, nz, rs[j + 1], rows[i + 1], fin, 0), V(B, pa[0], rows[i + 1], pa[1], nx, 0, nz, rs[j], rows[i + 1], fin, 0), nx, 0, nz);
      }
    };
    for (let i = 0; i < T.steps; i++) {
      const t0 = T.a0 + i * dth, y = G + (i + 0.5) * rise;
      sector(t0, t0 + dth, y, 1);
      riser(t0, i === 0 ? G : y - rise, y, -1, i % 2 ? FIN.cream : FIN.cream);
    }
    // the top landing, and the last little step onto it
    sector(T.a1, T.a1 + 30, U, 1);
    riser(T.a1, U - rise * 0.5, U, -1);
    riser(T.a1 + 30, U - 0.35, U, 1);
    // where the stair passes over itself it is a slab: its underside, and the wall that closes the solid part
    const from = 345;
    for (let t = from; t < T.a1 + 30 - 0.01; t += 7.5) {
      const tb = Math.min(T.a1 + 30, t + 7.5), ya = G + towerH(t) - 0.35, yb = G + towerH(tb) - 0.35;
      for (let j = 0; j < 2; j++) {
        const pa = at(t, rs[j]), pb = at(tb, rs[j]), pc = at(tb, rs[j + 1]), pd = at(t, rs[j + 1]), B = bufAt(pa[0], ya, pa[1]);
        quad(B, V(B, pa[0], ya, pa[1], 0, -1, 0, t * RAD * 3.3, rs[j], FIN.cream, 0), V(B, pb[0], yb, pb[1], 0, -1, 0, tb * RAD * 3.3, rs[j], FIN.cream, 0),
          V(B, pc[0], yb, pc[1], 0, -1, 0, tb * RAD * 3.3, rs[j + 1], FIN.cream, 0), V(B, pd[0], ya, pd[1], 0, -1, 0, t * RAD * 3.3, rs[j + 1], FIN.cream, 0), 0, -1, 0);
      }
    }
    riser(from, G, G + towerH(from), 1);
  }

  // ---- shaped openings: the wall round an arch, a capsule or a circle, and the curve through its thickness ----
  // corner pieces: each fills the gap between one corner of the square hole and the curve
  const shapeArcs = (o, w, h) => {
    // in the opening's own flat coordinates (u across, 0 … w; v up, 0 … h): [corner u, corner v, centre u, centre v, r, start angle]
    if (o.shape === 'rect') return [];
    if (o.shape === 'arch') { const r = Math.min(w / 2, h); return [[0, h, r, h - r, r, Math.PI / 2], [w, h, w - r, h - r, r, 0]]; }
    const r = Math.min(w, h) / 2;
    return [[0, h, r, h - r, r, Math.PI / 2], [w, h, w - r, h - r, r, 0], [0, 0, r, r, r, Math.PI], [w, 0, w - r, r, r, Math.PI * 1.5]];
  };
  // to3: (u, v, depth) → [x, y, z]; nFace: the way a plate at depth d faces; inner: towards the hole's middle
  const shapedHole = (o, w, h, to3, plates, d0, d1, lit = null) => {
    const NA = 7;
    for (const [cu, cv, ou, ov, r, a0] of shapeArcs(o, w, h)) {
      const arc = [];
      for (let k = 0; k <= NA; k++) { const a = a0 + (Math.PI / 2) * k / NA; arc.push([ou + Math.cos(a) * r, ov + Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
      for (const [d, n] of plates) {
        const c3 = to3(cu, cv, d), B = bufAt(c3[0], c3[1], c3[2], lit ? 'tile' : 'tile');
        const uvOf = (u, v) => [o.uAt ? o.uAt(u) : u, o.vAt ? o.vAt(v) : v];
        const ci = V(B, c3[0], c3[1], c3[2], n[0], n[1], n[2], ...uvOf(cu, cv), o.fin || FIN.cream, 0, lit);
        const ids = arc.map(q => { const p = to3(q[0], q[1], d); return V(B, p[0], p[1], p[2], n[0], n[1], n[2], ...uvOf(q[0], q[1]), o.fin || FIN.cream, 0, lit); });
        for (let k = 0; k < NA; k++) tri(B, ci, ids[k], ids[k + 1], n[0], n[1], n[2]);
      }
      // the curve through the wall
      for (let k = 0; k < NA; k++) {
        const q0 = arc[k], q1 = arc[k + 1];
        const nn = (q) => { const a = to3(q[0], q[1], d0), b = to3(q[0] - q[2] * 0.1, q[1] - q[3] * 0.1, d0); const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; };
        const n0 = nn(q0), n1 = nn(q1), al0 = a0 + (Math.PI / 2) * k / NA, al1 = a0 + (Math.PI / 2) * (k + 1) / NA;
        const p00 = to3(q0[0], q0[1], d0), p10 = to3(q1[0], q1[1], d0), p11 = to3(q1[0], q1[1], d1), p01 = to3(q0[0], q0[1], d1), B = bufAt(p00[0], p00[1], p00[2]);
        const fin = o.finIn == null ? (o.fin || FIN.cream) : o.finIn, dd = Math.abs(d1 - d0);
        quad(B, V(B, p00[0], p00[1], p00[2], n0[0], n0[1], n0[2], 0, al0 * r, fin, 0, lit), V(B, p10[0], p10[1], p10[2], n1[0], n1[1], n1[2], 0, al1 * r, fin, 0, lit),
          V(B, p11[0], p11[1], p11[2], n1[0], n1[1], n1[2], dd, al1 * r, fin, 0, lit), V(B, p01[0], p01[1], p01[2], n0[0], n0[1], n0[2], dd, al0 * r, fin, 0, lit), n0[0] + n1[0], n0[1] + n1[1], n0[2] + n1[2]);
      }
    }
  };
  for (const o of plan.openings) {
    const w = o.u1 - o.u0, h = o.y1 - o.y0;
    const to3 = o.axis === 'x' ? (u, v, d) => [d, o.y0 + v, o.u0 + u] : (u, v, d) => [o.u0 + u, o.y0 + v, d];
    const nA = o.axis === 'x' ? [-1, 0, 0] : [0, 0, -1], nB = o.axis === 'x' ? [1, 0, 0] : [0, 0, 1];
    const plates = [];
    if (o.out !== -1 && o.only !== 1) plates.push([o.a0, nA]);
    if (o.out !== 1 && o.only !== -1) plates.push([o.a1, nB]);
    const fin = wallFin(...to3(w / 2, h / 2, o.a0 - 0.2)) === FIN.smooth || wallFin(...to3(w / 2, h / 2, o.a1 + 0.2)) === FIN.smooth ? FIN.smooth : FIN.cream;
    shapedHole({ ...o, fin, uAt: u => o.u0 + u, vAt: v => o.y0 + v }, w, h, to3, plates, o.a0 - (o.pad0 || 0), o.a1 + (o.pad1 || 0));
  }
  // the way from the stair tower's top out to the corridor: an arch in the corridor's wall
  { const g = plan.rings[0].gaps[1], o = { shape: 'arch', fin: FIN.cream, uAt: u => g.z0 + u, vAt: v => g.y0 + v };
    shapedHole(o, g.z1 - g.z0, g.y1 - g.y0 - 0.02, (u, v, d) => [d, g.y0 + v, g.z0 + u], [[50, [-1, 0, 0]]], 50, 50.9); }
  // round skylights: the ceiling round the circle, and the circle's edge up through the roof
  for (const s of plan.skylights) {
    if (!s.round) continue;
    const w = s.x1 - s.x0, h = s.z1 - s.z0;
    shapedHole({ shape: 'round', fin: FIN.smooth, uAt: u => s.x0 + u, vAt: v => s.z0 + v }, w, h, (u, v, d) => [s.x0 + u, d, s.z0 + v], [[ROOF, [0, -1, 0]]], ROOF, ROOFT);
  }

  // ---- the lane hall's slanted wall with its row of capsule windows ----
  {
    const s = plan.slant, hgt = s.y1 - s.y0, len = Math.hypot(hgt, s.lean), n = [hgt / len, -s.lean / len, 0];
    const xAt = y => s.x + (y - s.y0) / hgt * s.lean;
    const P = (B, y, z) => V(B, xAt(y), y, z, n[0], n[1], n[2], z, s.y0 + (y - s.y0) * len / hgt, FIN.cream, 0);
    const rect = (z0, z1, y0, y1) => {
      const ys = [y0, ...ROWS.filter(y => y > y0 + 0.1 && y < y1 - 0.1), y1];
      for (let z = z0; z < z1 - 1e-6;) {
        const zb = Math.min(z1, Math.floor(z / 0.5 + 1 + 1e-6) * 0.5);
        for (let i = 0; i < ys.length - 1; i++) { const B = bufAt(s.x, ys[i], z); quad(B, P(B, ys[i], z), P(B, ys[i], zb), P(B, ys[i + 1], zb), P(B, ys[i + 1], z), n[0], n[1], n[2]); }
        z = zb;
      }
    };
    let z = s.z0;
    for (const w of s.windows) {
      rect(z, w.z - w.w / 2, s.y0, s.y1);
      rect(w.z - w.w / 2, w.z + w.w / 2, s.y0, w.y0); rect(w.z - w.w / 2, w.z + w.w / 2, w.y1, s.y1);
      // the capsule: its corners on the slanted wall, and a bright reveal straight back to the glass line
      const o = { shape: 'capsule', fin: FIN.cream, finIn: FIN.white, uAt: u => w.z - w.w / 2 + u, vAt: v => s.y0 + (w.y0 + v - s.y0) * len / hgt };
      const to3 = (u, v, d) => [d < 0.5 ? xAt(w.y0 + v) : s.x - 0.5, w.y0 + v, w.z - w.w / 2 + u];
      shapedHole(o, w.w, w.y1 - w.y0, to3, [[0, n]], 0, 1);
      z = w.z + w.w / 2;
    }
    rect(z, s.z1, s.y0, s.y1);
  }
  // (the capsule's straight sides back to the glass line, which the corner pieces above don't cover)
  {
    const s = plan.slant, hgt = s.y1 - s.y0, xAt = y => s.x + (y - s.y0) / hgt * s.lean;
    for (const w of s.windows) {
      const r = w.w / 2;
      for (const sd of [-1, 1]) {
        const z = w.z + sd * r, ya = w.y0 + r, yb = w.y1 - r, B = bufAt(s.x, ya, z);
        quad(B, V(B, xAt(ya), ya, z, 0, 0, -sd, 0, ya, FIN.white, 0), V(B, s.x - 0.5, ya, z, 0, 0, -sd, 0.6, ya, FIN.white, 0), V(B, s.x - 0.5, yb, z, 0, 0, -sd, 0.6, yb, FIN.white, 0), V(B, xAt(yb), yb, z, 0, 0, -sd, 0, yb, FIN.white, 0), 0, 0, -sd);
      }
    }
  }

  // ---- barrel vaults: a curved ceiling in the tunnels, the lobby and the grotto (where two cross, the higher wins) ----
  {
    const vaults = plan.rooms.filter(r => r.vault);
    const hOf = (r, x, z) => {
      const along = r.vault === 'z', a0 = along ? r.x0 : r.z0, a1 = along ? r.x1 : r.z1, t = ((along ? x : z) - a0) / (a1 - a0);
      if (t < -0.001 || t > 1.001) return -1;
      return r.spring + (r.y1 - r.spring) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    };
    const inR = (r, x, z) => x >= r.x0 - 0.001 && x <= r.x1 + 0.001 && z >= r.z0 - 0.001 && z <= r.z1 + 0.001;
    const hgt = (x, z) => { let h = -1; for (const r of vaults) if (inR(r, x, z)) h = Math.max(h, hOf(r, x, z)); return h; };
    for (const r of vaults) {
      const along = r.vault === 'z', NS = 12;
      const across = Array.from({ length: NS + 1 }, (_, k) => { const a = Math.PI * k / NS; return (1 - Math.cos(a)) / 2; });      // closer together near the walls
      const l0 = along ? r.z0 : r.x0, l1 = along ? r.z1 : r.x1, c0 = along ? r.x0 : r.z0, c1 = along ? r.x1 : r.z1;
      const fin = r.ceil === 'smooth' ? FIN.smooth : FIN.cream;
      let arcLen = [0];
      for (let k = 1; k <= NS; k++) { const ca = c0 + (c1 - c0) * across[k - 1], cb = c0 + (c1 - c0) * across[k]; arcLen.push(arcLen[k - 1] + Math.hypot(cb - ca, hOf(r, along ? cb : 0, along ? 0 : cb) - hOf(r, along ? ca : 0, along ? 0 : ca))); }
      for (let l = l0; l < l1 - 1e-6; l += 0.5) {
        for (let k = 0; k < NS; k++) {
          const P = (kk, ll) => {
            const c = c0 + (c1 - c0) * across[kk], x = along ? c : ll, z = along ? ll : c, own = hOf(r, x, z), y = Math.max(own, hgt(x, z));
            // the way it faces: down and towards the middle
            const t = across[kk] * 2 - 1, sl = y > own + 0.01 ? 0 : t * (r.y1 - r.spring) / Math.max(0.05, Math.sqrt(Math.max(0.0025, 1 - t * t))) / ((c1 - c0) / 2);
            const nl = Math.hypot(1, sl), nc = -sl / nl, ny = -1 / nl;
            const B = bufAt(x, y, z);
            return [B, V(B, x, y, z, along ? nc : 0, ny, along ? 0 : nc, ll, arcLen[kk], fin, 0)];
          };
          const a = P(k, l), B = a[0];
          const mk = (kk, ll) => { const c = c0 + (c1 - c0) * across[kk], x = along ? c : ll, z = along ? ll : c, own = hOf(r, x, z), y = Math.max(own, hgt(x, z)); const t = across[kk] * 2 - 1, sl = y > own + 0.01 ? 0 : t * (r.y1 - r.spring) / Math.max(0.05, Math.sqrt(Math.max(0.0025, 1 - t * t))) / ((c1 - c0) / 2), nl = Math.hypot(1, sl); return V(B, x, y, z, along ? -sl / nl : 0, -1 / nl, along ? 0 : -sl / nl, ll, arcLen[kk], fin, 0); };
          quad(B, mk(k, l), mk(k + 1, l), mk(k + 1, l + 0.5), mk(k, l + 0.5), 0, -1, 0);
        }
      }
    }
  }

  // ---- coves: where a room says so, its ceiling curves down into its walls ----
  {
    const NC = 5;
    const ceilOver = (ix, iz, y) => { const sp = spansAt(ix, iz); let c = 99; if (sp) for (const s of sp) if (s.y0 > y && s.y0 < c) c = s.y0; return c; };
    const openAt = (ix, iz, y) => !solidAt(ix, iz, y);
    for (let iz = 3; iz < Dc - 3; iz++) for (let ix = 3; ix < Wc; ix++) {
      const cx = (ix + 0.5) * CELL, cz = (iz + 0.5) * CELL;
      // (this cell is open air under a ceiling; look at each side for a wall that reaches that ceiling)
      for (const lvl of [G + 1, U + 1]) {
        if (!openAt(ix, iz, lvl)) continue;
        const cy = ceilOver(ix, iz, lvl);
        if (cy > ROOF + 0.01) continue;
        const room = roomAt(cx, cy - 0.2, cz);
        if (!room || !room.cove || room.vault) continue;
        const r = room.cove, fin = room.ceil === 'smooth' ? FIN.smooth : FIN.cream;
        for (const [nx, nz] of SIDES) {
          if (!solidAt(ix + nx, iz + nz, cy - 0.15) || !solidAt(ix + nx, iz + nz, cy - r)) continue;       // a wall on this side, right up to the ceiling
          // the wall's face: at this cell's edge; (wx, wz) a point on it, t along it
          const wx = cx + nx * 0.25, wz = cz + nz * 0.25, tx = nz, tz = -nx, inx = -nx, inz = -nz;
          const strip = (ax, az, bx, bz) => {
            for (let k = 0; k < NC; k++) {
              const a0 = Math.PI / 2 * k / NC, a1 = Math.PI / 2 * (k + 1) / NC;
              const P = (px, pz, a) => { const off = r * (1 - Math.cos(a)), y = cy - r + r * Math.sin(a), B = bufAt(px, y, pz); return V(B, px + inx * off, y, pz + inz * off, inx * Math.cos(a), -Math.sin(a), inz * Math.cos(a), nx ? pz : px, cy - r + a * r, fin, 0); };
              const B = bufAt(ax, cy - r, az);
              const mk = (px, pz, a) => { const off = r * (1 - Math.cos(a)), y = cy - r + r * Math.sin(a); return V(B, px + inx * off, y, pz + inz * off, inx * Math.cos(a), -Math.sin(a), inz * Math.cos(a), nx ? pz : px, cy - r + a * r, fin, 0); };
              quad(B, mk(ax, az, a0), mk(bx, bz, a0), mk(bx, bz, a1), mk(ax, az, a1), inx, -1, inz);
            }
          };
          strip(wx - tx * 0.25, wz - tz * 0.25, wx + tx * 0.25, wz + tz * 0.25);
          // an outside corner at either end (the wall turns away): a quarter of a round, swept round the corner
          for (const sd of [-1, 1]) {
            const ex = ix + tx * sd, ez = iz + tz * sd;                    // the next cell along the wall, on our side
            if (!openAt(ex, ez, cy - 0.15) || solidAt(ex + nx, ez + nz, cy - 0.15)) continue;     // (only where the wall ends and the air goes on round it)
            if (Math.abs(ceilOver(ex + nx, ez + nz, lvl) - cy) > 0.01) continue;
            const px = wx + tx * 0.25 * sd, pz = wz + tz * 0.25 * sd, B = bufAt(px, cy - r, pz), NR = 4;
            for (let m = 0; m < NR; m++) for (let k = 0; k < NC; k++) {
              const mk = (mm, kk) => {
                const ph = Math.PI / 2 * mm / NR, a = Math.PI / 2 * kk / NC, dx = inx * Math.cos(ph) + tx * sd * Math.sin(ph), dz = inz * Math.cos(ph) + tz * sd * Math.sin(ph);
                const off = r * (1 - Math.cos(a)), y = cy - r + r * Math.sin(a);
                return V(B, px + dx * off, y, pz + dz * off, dx * Math.cos(a), -Math.sin(a), dz * Math.cos(a), (nx ? pz : px) + ph * off, cy - r + a * r, fin, 0);
              };
              quad(B, mk(m, k), mk(m + 1, k), mk(m + 1, k + 1), mk(m, k + 1), inx + tx * sd, -1, inz + tz * sd);
            }
          }
        }
      }
    }
  }

  // ---- turn the buffers into meshes ----
  const tileMat = tileMaterial(UNI, Q);
  const casters = new THREE.Group();
  let tris = 0, verts = 0;
  for (const B of chunks.values()) {
    if (!B.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(B.light, 3));
    g.setAttribute('aGlint', new THREE.Float32BufferAttribute(B.glint, 3));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(B.fx, 4));
    g.setIndex(B.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    tris += B.idx.length / 3; verts += B.pos.length / 3;
    casters.add(new THREE.Mesh(g, tileMat));
  }
  group.add(casters);
  ud.stats = { tris, verts, lamps: emit.length };

  // ================= the sun: one shadow picture, taken now (the sun never moves) =================
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const sunCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const sunDirV = new THREE.Vector3(S[0], S[1], S[2]);
  const fitSun = (cam, cx, cy, cz, box) => {
    cam.position.set(cx - S[0] * 100, cy - S[1] * 100, cz - S[2] * 100);
    cam.up.set(0, 1, 0); cam.lookAt(cx, cy, cz); cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    let l = 1e9, r = -1e9, b = 1e9, t = -1e9, n = 1e9, f = -1e9;
    const v = new THREE.Vector3();
    for (const x of [box[0], box[3]]) for (const y of [box[1], box[4]]) for (const z of [box[2], box[5]]) {
      v.set(x, y, z).applyMatrix4(inv);
      l = Math.min(l, v.x); r = Math.max(r, v.x); b = Math.min(b, v.y); t = Math.max(t, v.y); n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    cam.left = l; cam.right = r; cam.bottom = b; cam.top = t; cam.near = n - 1; cam.far = f + 1;
    cam.updateProjectionMatrix();
  };
  const shadowSize = Math.min(renderer.capabilities.maxTextureSize, Q === 2 ? 4096 : 2048);
  const mkDepthRT = (size) => {
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
    return rt;
  };
  const shadowRT = mkDepthRT(shadowSize);
  {
    fitSun(sunCam, 32, 6.5, 26, [1.5, 0, 1.5, 64, ROOFT, 50.5]);
    const sc = new THREE.Scene();
    sc.add(casters);
    sc.overrideMaterial = depthMat;
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(shadowRT);
    renderer.clear();
    renderer.render(sc, sunCam);
    renderer.setRenderTarget(prev);
    renderer.autoClear = auto;
    group.add(casters);
    UNI.uShadow.value = shadowRT.depthTexture;
    UNI.uShadowMat.value.multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse);
    UNI.uShadowTexel.value = 1 / shadowSize;
  }

  // ================= water =================
  const waterMat = waterMaterial(UNI, Q);
  const waters = [];
  {
    const up = { l: [0, 0, 0], g: [0, 0, 0] };
    world.bodies.forEach((body, bi) => {
      const B = new Buf(), box = new THREE.Box3();
      const has = (ix, iz) => bodyIdx(ix, iz) === bi + 1;
      const P = (x, z) => {
        const key = `${x},${z}`; let i = B.map.get(key);
        if (i !== undefined) return i;
        i = B.pos.length / 3;
        // what the mirror would show there on Low: the ceiling over it, as it is lit; and where the sky's shine comes from
        const ix = Math.min(Wc - 1, Math.floor(x / CELL - 0.01)), iz = Math.min(Dc - 1, Math.floor(z / CELL - 0.01));
        let cy = 99; const sp = spansAt(ix, iz); if (sp) for (const s of sp) if (s.y0 > WY && s.y0 < cy) cy = s.y0;
        const c = cy < 90 ? shade((ix + 0.5) * CELL, cy, (iz + 0.5) * CELL, 0, -1, 0) : up, f = shade(x, WY + 0.02, z, 0, 1, 0);
        B.pos.push(x, 0, z); B.light.push(c.l[0] * 0.8, c.l[1] * 0.78, c.l[2] * 0.7); B.glint.push(f.g[0], f.g[1], f.g[2]);
        B.map.set(key, i); box.expandByPoint(new THREE.Vector3(x, body.y, z));
        return i;
      };
      for (let iz = 1; iz < Dc - 1; iz++) for (let ix = 1; ix < Wc - 1; ix++) {
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) if (has(ix + dx, iz + dz)) { near = true; break; }
        if (!near) continue;
        const x0 = ix * CELL, z0 = iz * CELL;
        const a = P(x0, z0), b = P(x0 + CELL, z0), c = P(x0 + CELL, z0 + CELL), d = P(x0, z0 + CELL);
        B.idx.push(a, d, c, a, c, b);
      }
      if (!B.idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('aLight', new THREE.Float32BufferAttribute(B.light, 3));
      g.setAttribute('aGlint', new THREE.Float32BufferAttribute(B.glint, 3));
      g.setIndex(B.idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, waterMat);
      m.position.y = body.y; m.renderOrder = 5; m.frustumCulled = false;
      group.add(m);
      waters.push({ body, mesh: m, box });
    });
  }

  // ================= small things: ladders, drains, the lift's doors, the slides' mouths =================
  // (each is merged into one mesh per material; lit by the light where it stands)
  const merged = { chrome: [], plain: [] };
  const lightAir = (x, y, z) => { const f = sample(probe, x, y, z), g2 = sample(fill, x, y, z); return [f[0] * 1.2 + g2[0] * 0.8 + 0.08, f[1] * 1.2 + g2[1] * 0.8 + 0.08, f[2] * 1.2 + g2[2] * 0.8 + 0.08]; };
  const put = (set, geo, x, y, z, color = null, m4 = null) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (m4) g.applyMatrix4(m4);
    const n = g.attributes.position.count, L = lightAir(x, y, z), la = new Float32Array(n * 3), ca = new Float32Array(n * 3);
    const c = color ? new THREE.Color(color) : null;
    for (let i = 0; i < n; i++) { la.set(L, i * 3); if (c) ca.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('aLight', new THREE.BufferAttribute(la, 3));
    if (c) g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    g.deleteAttribute('uv');
    merged[set].push(g);
  };
  const tube = (pts, r, set, color) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    put(set, new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), r, Q === 0 ? 5 : 8, false), pts[0][0], pts[0][1], pts[0][2], color);
  };
  const rod = (a, b, r, set, color) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, Q === 0 ? 5 : 8, 1, true);
    const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()), new THREE.Vector3(1, 1, 1));
    put(set, g, a[0], a[1], a[2], color, m);
  };
  for (const L of plan.ladders) {
    const tx = -L.nz, tz = L.nx;
    for (const sd of [-0.25, 0.25]) {
      const bx = L.x + tx * sd, bz = L.z + tz * sd;
      const at = (o, y) => [bx + L.nx * o, y, bz + L.nz * o];
      // a shiny rail: up out of the deck, over in a hoop, and down into the water
      tube([at(0.62, G - 0.02), at(0.62, G + 0.5), at(0.55, G + 0.82), at(0.3, G + 0.97), at(0.02, G + 0.84), at(-0.13, G + 0.5), at(-0.13, G - 0.1), at(-0.13, L.bottom + 0.04)], 0.024, 'chrome');
    }
    for (let y = G - 0.14; y > L.bottom + 0.1; y -= 0.27) rod([L.x + tx * -0.25 - L.nx * 0.13, y, L.z + tz * -0.25 - L.nz * 0.13], [L.x + tx * 0.25 - L.nx * 0.13, y, L.z + tz * 0.25 - L.nz * 0.13], 0.02, 'chrome');
  }
  { const L = plan.exit.ladder;                              // the exit ladder up the shaft
    for (const sd of [-0.25, 0.25]) rod([L.x + sd, 0.02, L.z - 0.12], [L.x + sd, L.top - 0.15, L.z - 0.12], 0.024, 'chrome');
    for (let y = 0.3; y < L.top - 0.2; y += 0.28) rod([L.x - 0.25, y, L.z - 0.12], [L.x + 0.25, y, L.z - 0.12], 0.02, 'chrome'); }
  for (const d of plan.drains) {
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(d.x, d.y + 0.005, d.z);
    put('chrome', new THREE.RingGeometry(0.055, 0.095, 18), d.x, d.y + 0.3, d.z, null, m);
    put('plain', new THREE.CircleGeometry(0.056, 14), d.x, d.y + 0.3, d.z, '#1c1d1e', new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(d.x, d.y + 0.004, d.z));
    for (const k of [-0.03, 0, 0.03]) rod([d.x - 0.05, d.y + 0.007, d.z + k], [d.x + 0.05, d.y + 0.007, d.z + k], 0.006, 'chrome');
  }
  { // the lift you came in by: shut steel doors at the east end of the hallway
    const L = plan.lift, x = L.x - 0.03;
    const panel = (z0, z1, y0, y1, col, dx = 0) => put('plain', new THREE.PlaneGeometry(z1 - z0, y1 - y0), x - 1, y0 + 1, (z0 + z1) / 2, col, new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(x - dx, (y0 + y1) / 2, (z0 + z1) / 2));
    panel(L.z - 1.15, L.z + 1.15, L.y, L.y + 2.35, '#8f9396', 0);
    panel(L.z - 1.0, L.z - 0.012, L.y + 0.02, L.y + 2.2, '#c2c6c8', 0.02); panel(L.z + 0.012, L.z + 1.0, L.y + 0.02, L.y + 2.2, '#c2c6c8', 0.02);
    panel(L.z - 0.012, L.z + 0.012, L.y + 0.02, L.y + 2.2, '#2a2c2e', 0.021);
    panel(L.z - 0.16, L.z + 0.16, L.y + 2.4, L.y + 2.52, '#16361f', 0.02);
  }
  // the slides: a coloured ring round each dark mouth upstairs, and the end of each tube where it lets you out
  for (const s of plan.slides) {
    const m = s.mouth;
    put('plain', new THREE.TorusGeometry(0.78, 0.09, 8, 28), m.x, m.y, m.z + 1, s.color, new THREE.Matrix4().setPosition(m.x, m.y, m.z + 0.03));
    put('plain', new THREE.CircleGeometry(0.76, 28), m.x, m.y, m.z + 1, '#07080a', new THREE.Matrix4().setPosition(m.x, m.y, m.z + 0.012));
    const o = s.out, len = 1.5, q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(o.nx, -0.18, o.nz).normalize());
    const mid = new THREE.Vector3(o.x + o.nx * (len / 2 - 0.3), o.y + 0.05, o.z + o.nz * (len / 2 - 0.3));
    const m4 = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    put('plain', new THREE.CylinderGeometry(0.8, 0.8, len, 24, 1, true), mid.x, mid.y, mid.z + 0.5, s.color, m4);
    put('plain', new THREE.CylinderGeometry(0.74, 0.74, len, 24, 1, true).scale(-1, 1, 1), mid.x, mid.y, mid.z + 0.5, '#101214', m4);
    const ringM = new THREE.Matrix4().compose(new THREE.Vector3(o.x + o.nx * (len - 0.3), o.y + 0.05 - 0.18 * (len / 2), o.z + o.nz * (len - 0.3)), q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)), new THREE.Vector3(1, 1, 1));
    put('plain', new THREE.TorusGeometry(0.77, 0.045, 8, 28), mid.x, mid.y, mid.z + 0.5, s.color, ringM);
  }
  const mergeGeo = (list) => {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), la = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0, hasCol = false;
    for (const g of list) {
      pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); la.set(g.attributes.aLight.array, o);
      if (g.attributes.color) { col.set(g.attributes.color.array, o); hasCol = true; }
      o += g.attributes.position.count * 3; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('aLight', new THREE.BufferAttribute(la, 3));
    if (hasCol) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  };
  const chromeMat = chromeMaterial(UNI), plainMat = plainMaterial(UNI, { side: THREE.DoubleSide });
  if (merged.chrome.length) group.add(new THREE.Mesh(mergeGeo(merged.chrome), chromeMat));
  if (merged.plain.length) group.add(new THREE.Mesh(mergeGeo(merged.plain), plainMat));

  // ================= the sun's beams, the dust in them, the glow of the windows =================
  const fxGroup = new THREE.Group();
  group.add(fxGroup);
  {
    const sp = [], sn = [], sa = [], dust = [], seed = [], gp = [], guv = [];
    for (const ap of apertures) {
      const { c, n, a, b, la, lb } = ap;
      // the window's glow: a soft white sheet just inside it
      const k = 1.7, e = 0.04;
      const corner = (u, v) => [c[0] + a[0] * u * k + b[0] * v * k + n[0] * e, c[1] + a[1] * u * k + b[1] * v * k + n[1] * e, c[2] + a[2] * u * k + b[2] * v * k + n[2] * e];
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      for (const i of [0, 1, 2, 0, 2, 3]) { gp.push(...q[i]); guv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); }
      if (Q === 0 || ap.sun < 0.3) continue;
      // the outline, and how far the beam runs before it lands
      const out = [], NO = ap.shape === 'rect' ? 4 : 16;
      for (let i = 0; i < NO; i++) {
        let u, v;
        if (ap.shape === 'rect') { u = [-1, 1, 1, -1][i]; v = [-1, -1, 1, 1][i]; }
        else {
          const t = i / NO * Math.PI * 2, rr = Math.min(la, lb);
          const cu = Math.sign(Math.cos(t)) * (la - rr), cv = Math.sign(Math.sin(t)) * (lb - rr);
          u = (cu + Math.cos(t) * rr) / la; v = (cv + Math.sin(t) * rr) / lb;
          if (ap.shape === 'arch' && v < 0) { u = Math.sign(Math.cos(t)); v = Math.max(-1, Math.sin(t) * 1.6); }
        }
        out.push([c[0] + a[0] * u * 0.94 + b[0] * v * 0.94, c[1] + a[1] * u * 0.94 + b[1] * v * 0.94, c[2] + a[2] * u * 0.94 + b[2] * v * 0.94]);
      }
      const hit = world.raycast(c[0], c[1], c[2], S[0], S[1], S[2], 60);
      const len = Math.min(34, (hit ? hit.t : 20) + 0.6);
      if (len < 1.6) continue;
      for (let i = 0; i < out.length; i++) {
        const p = out[i], p2 = out[(i + 1) % out.length];
        const ex = p2[0] - p[0], ey = p2[1] - p[1], ez = p2[2] - p[2];
        let nx = ey * S[2] - ez * S[1], ny = ez * S[0] - ex * S[2], nz = ex * S[1] - ey * S[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const far = (pp) => [pp[0] + S[0] * len, pp[1] + S[1] * len, pp[2] + S[2] * len];
        const v4 = [[p, 0], [p2, 0], [far(p2), 1], [far(p), 1]];
        for (const j of [0, 1, 2, 0, 2, 3]) { sp.push(...v4[j][0]); sn.push(nx, ny, nz); sa.push(v4[j][1]); }
      }
      // dust: specks scattered through the beam
      const count = Math.min(140, Math.round(la * lb * len * 2.4));
      for (let i = 0; i < count; i++) {
        let u = R() * 2 - 1, v = R() * 2 - 1;
        if (!ap.inside(u, v)) continue;
        const t = 0.5 + R() * (len - 1.2);
        dust.push(c[0] + a[0] * u + b[0] * v + S[0] * t, c[1] + a[1] * u + b[1] * v + S[1] * t, c[2] + a[2] * u + b[2] * v + S[2] * t);
        seed.push(R(), R(), R(), R());
      }
    }
    if (gp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2));
      const m = new THREE.Mesh(g, glowMaterial()); m.renderOrder = 7; m.frustumCulled = false; fxGroup.add(m);
    }
    if (sp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3)); g.setAttribute('aAlong', new THREE.Float32BufferAttribute(sa, 1));
      const m = new THREE.Mesh(g, shaftMaterial(UNI)); m.renderOrder = 8; m.frustumCulled = false; fxGroup.add(m);
    }
    if (dust.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
      const m = new THREE.Points(g, dustMaterial(UNI, renderer.getPixelRatio())); m.renderOrder = 9; m.frustumCulled = false; fxGroup.add(m);
    }
  }

  // ================= people: lit by the light where you stand =================
  const hemi = new THREE.HemisphereLight('#fff6e4', '#b9b4a0', 1.7), sunL = new THREE.DirectionalLight('#ffd9a0', 0);
  sunL.position.set(-S[0] * 10, -S[1] * 10, -S[2] * 10);
  group.add(hemi, sunL, sunL.target);
  ud.lightAt = (x, z, y = G) => { const f = sample(probe, x, y + 1.2, z), g2 = sample(fill, x, y + 1.2, z); return Math.min(1.5, (f[1] * 1.3 + g2[1] * 0.9 + 0.06) * 1.25); };
  ud.debugLight = (x, y, z, nx = 0, ny = 1, nz = 0) => shade(x, y, z, nx, ny, nz).l.map(v => Math.round(v * 100) / 100);
  ud.sunAt = (x, y, z) => !world.raycast(x, y, z, -S[0], -S[1], -S[2], 80);
  ud.dimPeople = (k, sun = false) => { hemi.intensity = 0.5 + 1.5 * Math.min(1.2, k); sunL.intensity = sun ? 2.4 : 0; };

  // ================= every frame =================
  let ripI = 0;
  ud.uniforms = UNI;
  ud.addRipple = (x, z, strength = 1) => { const r = UNI.uRipples.value[ripI++ % MAX_RIPPLES]; r.set(x, z, UNI.uTime.value, strength); };
  ud.setBlobs = (list) => { const b = UNI.uBlobs.value; for (let i = 0; i < b.length; i++) { const p = list[i]; if (p) b[i].set(p.x, p.y, p.z, p.r || 0.75); else b[i].set(0, -99, 0, 0); } };
  // the Great Pool's water going down (stage 2 drains it)
  ud.setWater = (name, y) => {
    for (const w of waters) if (w.body.name === name) { w.mesh.position.y = y; w.mesh.visible = y > w.body.bottom + 0.03; w.box.min.y = w.box.max.y = y; }
    if (name === 'great') UNI.uGreatY.value = y;
  };
  ud.update = (dt) => { UNI.uTime.value += dt; };

  // the mirror picture for the water (Medium and up), and people's shadows in the sun
  const mirror = Q >= 1 ? { rt: null, cam: new THREE.PerspectiveCamera(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -(WY - 0.03)), scale: Q === 1 ? 0.5 : 0.7 } : null;
  const dyn = Q >= 1 ? { rt: mkDepthRT(1024), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10) } : null;
  if (dyn) UNI.uDyn.value = dyn.rt.depthTexture;
  ud.castLayer = 3;                                         // things on this layer throw a shadow in the sun (people)
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), size = new THREE.Vector2();
  const vTmp = new THREE.Vector3(), tTmp = new THREE.Vector3(), q4 = new THREE.Matrix4();
  ud.preRender = (rend, scene, camera) => {
    const prevRT = rend.getRenderTarget(), auto = rend.autoClear;
    rend.autoClear = true;
    if (dyn) {
      // a small shadow picture of the people near the camera
      const cx = Math.round(camera.position.x / 0.5) * 0.5, cz = Math.round(camera.position.z / 0.5) * 0.5, cy = camera.position.y;
      fitSun(dyn.cam, cx, cy, cz, [cx - 13, cy - 9, cz - 13, cx + 13, cy + 5, cz + 13]);
      dyn.cam.layers.set(ud.castLayer);
      const om = scene.overrideMaterial; scene.overrideMaterial = depthMat;
      const bg = scene.background; scene.background = null;
      rend.setRenderTarget(dyn.rt); rend.clear(); rend.render(scene, dyn.cam);
      scene.overrideMaterial = om; scene.background = bg;
      UNI.uDynMat.value.multiplyMatrices(dyn.cam.projectionMatrix, dyn.cam.matrixWorldInverse);
      UNI.uDynOn.value = 1;
    }
    if (mirror) {
      pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
      const seen = camera.position.y > WY + 0.03 && waters.some(w => w.mesh.visible && Math.abs(w.mesh.position.y - WY) < 0.4 && frustum.intersectsBox(w.box));
      UNI.uReflOn.value = seen ? 1 : 0;
      if (seen) {
        rend.getDrawingBufferSize(size);
        const w = Math.max(64, Math.round(size.x * mirror.scale)), h = Math.max(64, Math.round(size.y * mirror.scale));
        if (!mirror.rt || mirror.rt.width !== w || mirror.rt.height !== h) {
          if (mirror.rt) mirror.rt.dispose();
          mirror.rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
          UNI.uRefl.value = mirror.rt.texture;
        }
        // the camera's twin under the water, looking up at the same things
        const mc = mirror.cam, y0 = WY;
        vTmp.copy(camera.position); vTmp.y = 2 * y0 - vTmp.y;
        q4.extractRotation(camera.matrixWorld);
        tTmp.set(0, 0, -1).applyMatrix4(q4).add(camera.position); tTmp.y = 2 * y0 - tTmp.y;
        mc.position.copy(vTmp);
        mc.up.set(0, 1, 0).applyMatrix4(q4); mc.up.y = -mc.up.y;
        mc.lookAt(tTmp);
        mc.projectionMatrix.copy(camera.projectionMatrix); mc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
        mc.updateMatrixWorld(true); mc.matrixWorldInverse.copy(mc.matrixWorld).invert();
        UNI.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
        for (const wt of waters) wt.mesh.userData.was = wt.mesh.visible, wt.mesh.visible = false;
        fxGroup.visible = false;
        UNI.uClipY.value = WY - 0.03; UNI.uLite.value = 1;
        const cp = rend.clippingPlanes; rend.clippingPlanes = [mirror.plane];
        rend.setRenderTarget(mirror.rt); rend.clear(); rend.render(scene, mc);
        rend.clippingPlanes = cp;
        UNI.uClipY.value = -1e6; UNI.uLite.value = 0;
        fxGroup.visible = true;
        for (const wt of waters) wt.mesh.visible = wt.mesh.userData.was;
      }
    }
    rend.setRenderTarget(prevRT); rend.autoClear = auto;
  };
  ud.dispose = () => { shadowRT.dispose(); if (dyn) dyn.rt.dispose(); if (mirror && mirror.rt) mirror.rt.dispose(); };

  renderer.setClearColor(0xffffff, 1);                      // the sky in every window: blown-out white
  return { group, theme: { name: 'pool' }, fog: null, sky: null, sun: null, far: Math.min(gfx.viewDistance || 140, 110) };
}
