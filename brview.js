// The Backrooms 3D scene: mono-yellow wallpaper, damp carpet, acoustic ceiling tiles and buzzing
// fluorescent panels, all drawn in code. The lighting is "baked" when the maze loads: every corner
// of the floor, walls and ceiling works out how much light it gets from each panel near it, with
// real shadows from walls and pillars (soft edges: each panel is sampled at three points), light
// bounced back off the yellow carpet, and darker corners. At runtime it costs almost nothing.
import * as THREE from 'three';
import { CELL, hash2 } from './world.js';
import { BR, rng } from './brmap.js';

const at = i => BR.border + i * BR.cell;

// ---------- textures (canvas) ----------
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, renderer, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  return t;
}
function noise(ctx, w, h, n, cols, alpha, R, size = 2) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.4 + R() * 0.6);
    ctx.fillStyle = cols[Math.floor(R() * cols.length)];
    const s = size * (0.5 + R());
    ctx.fillRect(R() * w, R() * h, s, s);
  }
  ctx.globalAlpha = 1;
}
function blotches(ctx, w, h, n, col, alpha, R, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, r = rMin + R() * (rMax - rMin);
    for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha * (0.5 + R() * 0.5);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
}

// mono-yellow wallpaper: columns of pale chevrons, thin darker stripes, grime (1 tile = 1 m)
function wallpaperTexture(renderer) {
  const S = 512, [c, ctx] = canvas(S), R = rng(11);
  ctx.fillStyle = '#bfb257';
  ctx.fillRect(0, 0, S, S);
  const cols = 4, cw = S / cols;
  for (let k = 0; k < cols; k++) {
    const x0 = k * cw + cw / 2;
    // a slightly lighter band down each column
    const g = ctx.createLinearGradient(x0 - cw / 2, 0, x0 + cw / 2, 0);
    g.addColorStop(0, 'rgba(255,250,200,0)'); g.addColorStop(0.5, 'rgba(255,250,200,0.10)'); g.addColorStop(1, 'rgba(255,250,200,0)');
    ctx.fillStyle = g; ctx.fillRect(x0 - cw / 2, 0, cw, S);
    // stacked chevrons pointing up
    for (let y = -64; y < S + 64; y += 64) {
      for (const [w, lw, a, col] of [[42, 10, 0.55, '#d7cc7c'], [42, 3, 0.5, '#a39749'], [26, 6, 0.45, '#d9cf86']]) {
        ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'miter';
        ctx.beginPath(); ctx.moveTo(x0 - w, y + 26); ctx.lineTo(x0, y); ctx.lineTo(x0 + w, y + 26); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // thin stripes between the columns
    ctx.fillStyle = '#9f9443'; ctx.fillRect(k * cw - 1.5, 0, 3, S);
    ctx.fillStyle = 'rgba(230,222,150,0.35)'; ctx.fillRect(k * cw + 3, 0, 2, S);
  }
  noise(ctx, S, S, 9000, ['#8f8540', '#d8cd85', '#a99d4c'], 0.25, R, 1.6);
  blotches(ctx, S, S, 6, 'rgba(110,95,40,1)', 0.08, R, 40, 120);
  // faint vertical damp streaks
  for (let i = 0; i < 10; i++) {
    const x = R() * S, w = 2 + R() * 6;
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(120,105,45,0)'); g.addColorStop(0.5, 'rgba(120,105,45,0.10)'); g.addColorStop(1, 'rgba(120,105,45,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, S);
  }
  return tex(c, renderer);
}

// damp mustard carpet (1 tile = 2 m)
function carpetTexture(renderer) {
  const S = 512, [c, ctx] = canvas(S), R = rng(23);
  ctx.fillStyle = '#9c8641';
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, 60000, ['#7f6b31', '#b29b52', '#8d7838', '#a8914a', '#6f5d2a'], 0.55, R, 1.4);
  // tufted fibres
  ctx.lineWidth = 1;
  for (let i = 0; i < 9000; i++) {
    const x = R() * S, y = R() * S, a = R() * Math.PI * 2, l = 1.5 + R() * 2.5;
    ctx.globalAlpha = 0.18; ctx.strokeStyle = R() < 0.5 ? '#c4ad62' : '#6a5826';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  blotches(ctx, S, S, 7, 'rgba(70,55,20,1)', 0.16, R, 30, 110);     // damp patches
  blotches(ctx, S, S, 5, 'rgba(200,180,110,1)', 0.06, R, 40, 120);
  return tex(c, renderer);
}

// acoustic ceiling tiles in a T-bar grid (1 tile of the texture = 1.2 m = 2 × 2 tiles)
function ceilingTexture(renderer) {
  const S = 512, [c, ctx] = canvas(S), R = rng(37);
  ctx.fillStyle = '#d6d0ad';
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, 14000, ['#b9b28f', '#e4dfc2', '#a9a282'], 0.35, R, 1.5);
  for (let i = 0; i < 2600; i++) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#8f896c'; ctx.fillRect(R() * S, R() * S, 1.6, 1.6); }   // pinholes
  ctx.globalAlpha = 1;
  blotches(ctx, S, S, 3, 'rgba(160,135,60,1)', 0.12, R, 25, 70);     // water stains
  // T-bar grid
  for (const p of [0, S / 2]) {
    ctx.fillStyle = '#a7a083'; ctx.fillRect(p - 4, 0, 8, S); ctx.fillRect(0, p - 4, S, 8);
    ctx.fillStyle = '#e8e4cc'; ctx.fillRect(p - 1, 0, 2, S); ctx.fillRect(0, p - 1, S, 2);
  }
  return tex(c, renderer);
}

// fluorescent panel: metal frame and a prismatic diffuser
function panelTexture(renderer) {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, 256, 128);
  ctx.globalAlpha = 0.12; ctx.strokeStyle = '#c9c0a0';
  for (let x = 0; x < 256; x += 6) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
  for (let y = 0; y < 128; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#b8b39d'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 246, 118);
  return tex(c, renderer, false);
}

// the EXIT sign (our own: green panel, white letters, a running figure and an arrow)
function exitTexture(renderer) {
  const [c, ctx] = canvas(256, 96);
  ctx.fillStyle = '#0b3d1a'; ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#7dffa0'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', 150, 50);
  ctx.strokeStyle = '#7dffa0'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(46, 22, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(44, 32); ctx.lineTo(38, 56); ctx.lineTo(24, 76); ctx.moveTo(38, 56); ctx.lineTo(54, 74); ctx.moveTo(42, 40); ctx.lineTo(28, 46); ctx.moveTo(42, 40); ctx.lineTo(60, 44); ctx.stroke();
  ctx.strokeRect(4, 4, 248, 88);
  return tex(c, renderer, false);
}

// ---------- baked lighting ----------
const LIGHT = [1.0, 0.95, 0.82];         // warm fluorescent
const BOUNCE = [1.0, 0.9, 0.55];          // light bounced off yellow carpet and walls

export function buildBackroomsScene(world, renderer, gfx = {}) {
  const plan = world.def.br, H = BR.ceiling, N = BR.cells, Wc = world.w, Dc = world.h;
  const group = new THREE.Group();
  const soft = gfx.effects !== 'low';               // three samples per panel (soft shadow edges) or one
  // full-height solid cells (walls, pillars, the outer edge)
  const solid = new Uint8Array(Wc * Dc);
  const kind = new Uint8Array(Wc * Dc);           // 1 wallpaper / edge, 2 pillar
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    const sp = world.cellSpans(ix, iz).find(s => s.m[0] !== '_' && s.y0 < 1 && s.y1 > 1.5);
    if (sp) { solid[iz * Wc + ix] = 1; kind[iz * Wc + ix] = sp.m === 'pillar' ? 2 : 1; }
  }
  const isSolid = (ix, iz) => ix < 0 || iz < 0 || ix >= Wc || iz >= Dc || solid[iz * Wc + ix] === 1;
  const isPit = (ix, iz) => world.pitCell(ix, iz);

  // panels: one in the middle of every room, lengthwise along x; a few dead, a few flickering
  const R = rng(plan.seed * 13 + 5);
  const lights = [];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const cx = at(x) + BR.cell / 2, cz = at(z) + BR.cell / 2;
    if (isSolid(Math.floor(cx / CELL), Math.floor(cz / CELL))) continue;
    const r = R();
    const state = r < 0.06 ? 'dead' : r < 0.12 ? 'flicker' : 'on';
    lights.push({ x: cx, z: cz, y: H - 0.02, ax: 'x', I: state === 'dead' ? 0 : state === 'flicker' ? 0.7 : 1, col: LIGHT, state, seed: R() });
  }
  // the exit glows green-white
  const door = world.exit;
  if (door) lights.push({ x: door.x + door.nx * 0.5, z: door.z + door.nz * 0.5, y: 1.4, omni: true, I: 1.3, col: [0.7, 1.0, 0.78], state: 'on' });
  // spatial lookup: lights by 4 m bucket
  const bucket = new Map();
  const bk = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  lights.forEach((L, i) => { if (L.I > 0) { const k = bk(L.x, L.z); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(i); } });
  const RANGE = 10;
  const near = (x, z) => {
    const out = [], bx = Math.floor(x / 4), bz = Math.floor(z / 4), r = Math.ceil(RANGE / 4);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const l = bucket.get(`${bx + dx},${bz + dz}`); if (l) out.push(...l); }
    return out;
  };
  // 2D line of sight through the cell grid (walls go floor to ceiling, so 2D is exact)
  const vis = (ax, az, bx, bz) => {
    let ix = Math.floor(ax / CELL), iz = Math.floor(az / CELL);
    const tx = Math.floor(bx / CELL), tz = Math.floor(bz / CELL);
    const dx = bx - ax, dz = bz - az;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? Math.abs(CELL / dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? Math.abs(CELL / dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? (dx > 0 ? (ix + 1) * CELL - ax : ax - ix * CELL) / Math.abs(dx) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? (dz > 0 ? (iz + 1) * CELL - az : az - iz * CELL) / Math.abs(dz) : Infinity;
    for (let g = 0; g < 200; g++) {
      if (ix === tx && iz === tz) return true;
      let enter;
      if (tmx < tmz) { enter = tmx; ix += sx; tmx += tdx; } else { enter = tmz; iz += sz; tmz += tdz; }
      if (enter > 1) return true;
      if (isSolid(ix, iz)) return false;
    }
    return true;
  };
  const OFF = soft ? [-0.45, 0, 0.45] : [0];
  // direct light at a point with normal n: returns [r, g, b]
  const direct = (px, py, pz, nx, ny, nz, out) => {
    let r = 0, g = 0, b = 0;
    for (const i of near(px, pz)) {
      const L = lights[i];
      let acc = 0;
      const offs = L.omni ? [0] : OFF;
      for (const o of offs) {
        const lx = L.x + (L.ax === 'x' ? o : 0), lz = L.z + (L.ax === 'z' ? o : 0);
        const dx = lx - px, dy = L.y - py, dz = lz - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > RANGE * RANGE) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const cr = (nx * dx + ny * dy + nz * dz) / d;
        if (cr <= 0) continue;
        const ce = L.omni ? 1 : dy / d;
        if (ce <= 0) continue;
        if (!vis(px, pz, lx, lz)) continue;
        acc += cr * (L.omni ? 1 : 0.35 + 0.65 * ce) / (1 + d2 * 0.16);
      }
      acc *= L.I / offs.length;
      r += acc * L.col[0]; g += acc * L.col[1]; b += acc * L.col[2];
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  };
  const tmp = [0, 0, 0];

  // floor light at every grid corner (sampled just off the corner, into the open)
  const FW = Wc + 1, FD = Dc + 1;
  const floorL = new Float32Array(FW * FD * 3), floorAO = new Float32Array(FW * FD);
  for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) {
    let ox = 0, oz = 0, n = 0, blockedN = 0;
    for (const [cx, cz] of [[ix - 1, iz - 1], [ix, iz - 1], [ix - 1, iz], [ix, iz]]) {
      if (isSolid(cx, cz)) { blockedN++; continue; }
      ox += (cx + 0.5) * CELL; oz += (cz + 0.5) * CELL; n++;
    }
    const k = (iz * FW + ix);
    if (!n) continue;
    const x = ix * CELL, z = iz * CELL;
    const px = x + (ox / n - x) * 0.3, pz = z + (oz / n - z) * 0.3;
    direct(px, 0, pz, 0, 1, 0, tmp);
    floorL[k * 3] = tmp[0]; floorL[k * 3 + 1] = tmp[1]; floorL[k * 3 + 2] = tmp[2];
    // corners and wall feet are darker
    let wallsNear = 0;
    for (let dz = -2; dz <= 1; dz++) for (let dx = -2; dx <= 1; dx++) if (isSolid(ix + dx, iz + dz)) wallsNear++;
    floorAO[k] = Math.max(0.55, 1 - blockedN * 0.12 - wallsNear * 0.02);
  }
  // light bounced around: a wide blur of the floor light
  const blur = (src, rad) => {
    const tmpA = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) for (let c = 0; c < 3; c++) {
      let s = 0, n = 0;
      for (let d = -rad; d <= rad; d++) { const x = ix + d; if (x < 0 || x >= FW) continue; s += src[(iz * FW + x) * 3 + c]; n++; }
      tmpA[(iz * FW + ix) * 3 + c] = s / n;
    }
    for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) for (let c = 0; c < 3; c++) {
      let s = 0, n = 0;
      for (let d = -rad; d <= rad; d++) { const z = iz + d; if (z < 0 || z >= FD) continue; s += tmpA[(z * FW + ix) * 3 + c]; n++; }
      out[(iz * FW + ix) * 3 + c] = s / n;
    }
    return out;
  };
  const bounce = blur(floorL, 5);
  const bounceAt = (x, z, c) => {
    const ix = Math.max(0, Math.min(FW - 1, Math.round(x / CELL))), iz = Math.max(0, Math.min(FD - 1, Math.round(z / CELL)));
    return bounce[(iz * FW + ix) * 3 + c];
  };
  // per-area tint so it isn't the same everywhere (low frequency grime)
  const grime = (x, z) => 0.9 + 0.12 * hash2(Math.floor(x / 3) + 101, Math.floor(z / 3) + 57) + 0.04 * hash2(Math.floor(x) + 7, Math.floor(z) + 3);
  const EXPO = 1.05, AMB = 0.035;
  const finish = (r, g, b, ao, gr) => [Math.min(1.6, (r + AMB) * EXPO * ao * gr), Math.min(1.6, (g + AMB) * EXPO * ao * gr), Math.min(1.6, (b + AMB * 0.8) * EXPO * ao * gr)];

  // ---------- floor (carpet) and ceiling ----------
  const fPos = [], fUV = [], fCol = [], cPos = [], cUV = [], cCol = [];
  for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) {
    const x = ix * CELL, z = iz * CELL, k = iz * FW + ix;
    const gr = grime(x, z);
    const fr = floorL[k * 3] + bounce[k * 3] * BOUNCE[0] * 0.35, fg = floorL[k * 3 + 1] + bounce[k * 3 + 1] * BOUNCE[1] * 0.35, fb = floorL[k * 3 + 2] + bounce[k * 3 + 2] * BOUNCE[2] * 0.35;
    fPos.push(x, 0, z); fUV.push(x / 2, z / 2); fCol.push(...finish(fr, fg, fb, floorAO[k], gr));
    // the ceiling only gets bounced light (panels shine down), plus a glow right around each lit panel
    let glow = 0;
    for (const i of near(x, z)) {
      const L = lights[i];
      if (L.omni || L.I <= 0) continue;
      const dd = Math.hypot(Math.max(0, Math.abs(x - L.x) - 0.6), Math.max(0, Math.abs(z - L.z) - 0.3));
      if (dd < 1.4 && vis(x + 0.01, z + 0.01, L.x, L.z)) glow += (1 - dd / 1.4) ** 2 * 0.55 * L.I;
    }
    const cr = bounce[k * 3] * 0.62 * BOUNCE[0] + glow, cg = bounce[k * 3 + 1] * 0.62 * BOUNCE[1] + glow * 0.97, cb = bounce[k * 3 + 2] * 0.62 * BOUNCE[2] + glow * 0.88;
    cPos.push(x, H, z); cUV.push(x / 1.2, z / 1.2); cCol.push(...finish(cr, cg, cb, 0.55 + floorAO[k] * 0.45, gr));
  }
  const fIdx = [], cIdx = [];
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    if (isSolid(ix, iz)) continue;
    const a = iz * FW + ix, b = a + 1, c = a + FW, d = c + 1;
    cIdx.push(a, b, d, a, d, c);
    if (!isPit(ix, iz)) fIdx.push(a, c, d, a, d, b);
  }
  const mesh = (pos, uv, col, idx, material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (idx) g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    group.add(m);
    return m;
  };
  const baked = (map) => new THREE.MeshBasicMaterial({ map, vertexColors: true });
  const surfaces = [];
  surfaces.push(mesh(fPos, fUV, fCol, fIdx, baked(carpetTexture(renderer))));
  surfaces.push(mesh(cPos, cUV, cCol, cIdx, baked(ceilingTexture(renderer))));

  // ---------- walls, pillars and skirting boards ----------
  const ROWS = [0, 0.11, 0.35, 0.8, 1.4, 2.0, 2.45, 2.72, H];
  const wPos = [], wUV = [], wCol = [], bPos = [], bCol = [];
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    if (!solid[iz * Wc + ix]) continue;
    for (const [nx, nz] of SIDES) {
      const ox = ix + nx, oz = iz + nz;
      if (isSolid(ox, oz)) continue;
      // the face between this cell and the open one, as two ends a → b (seen from the open side, left to right)
      const x0 = ix * CELL, z0 = iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const ends = nx === 1 ? [[x1, z1], [x1, z0]] : nx === -1 ? [[x0, z0], [x0, z1]] : nz === 1 ? [[x0, z1], [x1, z1]] : [[x1, z0], [x0, z0]];
      const cols = ends.map(([ex, ez]) => {
        // light along this end of the face, bottom to top; the sample point sits just off the wall
        const px = ex + nx * 0.06 - (nx ? 0 : Math.sign(ex - (x0 + x1) / 2) * 0.04), pz = ez + nz * 0.06 - (nz ? 0 : Math.sign(ez - (z0 + z1) / 2) * 0.04);
        // an inside corner next to this end darkens it
        const sx = nz !== 0 ? Math.sign(ex - (x0 + x1) / 2) : 0, sz = nx !== 0 ? Math.sign(ez - (z0 + z1) / 2) : 0;
        const corner = isSolid(ox + sx, oz + sz) ? 0.78 : 1;
        const gr = grime(ex, ez);
        return ROWS.map(y => {
          direct(px, Math.max(0.05, Math.min(H - 0.05, y)), pz, nx, 0, nz, tmp);
          const bk2 = 0.3 * (1 - y / H * 0.4), up = 0.12 * (y / H);
          const r = tmp[0] + (bounceAt(px, pz, 0) * BOUNCE[0]) * (bk2 + up), g = tmp[1] + (bounceAt(px, pz, 1) * BOUNCE[1]) * (bk2 + up), b = tmp[2] + (bounceAt(px, pz, 2) * BOUNCE[2]) * (bk2 + up);
          const ao = corner * (y < 0.3 ? 0.72 + y : 1) * (y > H - 0.3 ? 0.8 + (H - y) * 0.6 : 1);
          return finish(r, g, b, Math.min(1, ao), gr);
        });
      });
      const ua = nx ? ends[0][1] : ends[0][0], ub = nx ? ends[1][1] : ends[1][0];
      const flip = nx === -1 || nz === 1 ? 1 : -1;      // keep the paper running the same way on every wall
      for (let r = 0; r < ROWS.length - 1; r++) {
        const ya = ROWS[r], yb = ROWS[r + 1];
        const A = [ends[0][0], ya, ends[0][1]], B = [ends[1][0], ya, ends[1][1]], C = [ends[1][0], yb, ends[1][1]], Dv = [ends[0][0], yb, ends[0][1]];
        const uA = ua * flip, uB = ub * flip;
        for (const [p, u, v, cc] of [[A, uA, ya, cols[0][r]], [B, uB, ya, cols[1][r]], [C, uB, yb, cols[1][r + 1]], [A, uA, ya, cols[0][r]], [C, uB, yb, cols[1][r + 1]], [Dv, uA, yb, cols[0][r + 1]]]) {
          wPos.push(...p); wUV.push(u, v); wCol.push(...cc);
        }
      }
      // skirting board along the foot of every wall and pillar
      {
        const o = 0.018, hgt = 0.1;
        const a0 = [ends[0][0] + nx * o, ends[0][1] + nz * o], b0 = [ends[1][0] + nx * o, ends[1][1] + nz * o];
        const ca = cols[0][1], cb = cols[1][1];
        for (const [p, cc] of [[[a0[0], 0, a0[1]], ca], [[b0[0], 0, b0[1]], cb], [[b0[0], hgt, b0[1]], cb], [[a0[0], 0, a0[1]], ca], [[b0[0], hgt, b0[1]], cb], [[a0[0], hgt, a0[1]], ca]]) { bPos.push(...p); bCol.push(...cc); }
        // its top edge
        for (const [p, cc] of [[[a0[0], hgt, a0[1]], ca], [[b0[0], hgt, b0[1]], cb], [[ends[1][0], hgt, ends[1][1]], cb], [[a0[0], hgt, a0[1]], ca], [[ends[1][0], hgt, ends[1][1]], cb], [[ends[0][0], hgt, ends[0][1]], ca]]) { bPos.push(...p); bCol.push(...cc.map(v => v * 1.05)); }
      }
    }
  }
  const wallTex = wallpaperTexture(renderer);
  surfaces.push(mesh(wPos, wUV, wCol, null, baked(wallTex)));
  if (bPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#b9ae84', vertexColors: true }));
    surfaces.push(m); group.add(m);
  }

  // ---------- pitfalls: a dark shaft going down ----------
  const pPos = [], pCol = [];
  const DEEP = 9;
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    if (!isPit(ix, iz)) continue;
    for (const [nx, nz] of SIDES) {
      if (isPit(ix + nx, iz + nz)) continue;
      const x0 = ix * CELL, z0 = iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      // the shaft wall on the far side of this edge, facing into the hole
      const ends = nx === 1 ? [[x1, z0], [x1, z1]] : nx === -1 ? [[x0, z1], [x0, z0]] : nz === 1 ? [[x1, z1], [x0, z1]] : [[x0, z0], [x1, z0]];
      const k = (Math.round(ends[0][1] / CELL)) * FW + Math.round(ends[0][0] / CELL);
      const top = Math.min(0.5, (floorL[k * 3] + 0.05) * 0.45);
      // the cut edge of the floor (carpet and concrete), then rough sides fading quickly into black
      const rows = [0, -0.04, -0.16, -0.6, -1.5, -DEEP];
      const lit = y => y > -0.04 ? top * 1.1 : y > -0.16 ? top * 0.75 : top * 0.4 * Math.exp((y + 0.16) * 2.6);
      for (let r = 0; r < rows.length - 1; r++) {
        const ya = rows[r], yb = rows[r + 1], ca = lit(ya), cb = lit(yb);
        const A = [ends[0][0], ya, ends[0][1]], B = [ends[1][0], ya, ends[1][1]], C = [ends[1][0], yb, ends[1][1]], Dv = [ends[0][0], yb, ends[0][1]];
        for (const [p, c] of [[A, ca], [C, cb], [B, ca], [A, ca], [Dv, cb], [C, cb]]) { pPos.push(...p); pCol.push(c, c * 0.92, c * 0.7); }
      }
    }
    // the bottom: nothing but black
    const x0 = ix * CELL, z0 = iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    for (const p of [[x0, -DEEP, z0], [x0, -DEEP, z1], [x1, -DEEP, z1], [x0, -DEEP, z0], [x1, -DEEP, z1], [x1, -DEEP, z0]]) { pPos.push(...p); pCol.push(0, 0, 0); }
  }
  if (pPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(pCol, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#7a6a45', vertexColors: true, side: THREE.DoubleSide, fog: false }));
    surfaces.push(m); group.add(m);
  }

  // ---------- the fluorescent panels ----------
  const pTex = panelTexture(renderer);
  const panelGeo = new THREE.PlaneGeometry(1.2, 0.6);
  panelGeo.rotateX(Math.PI / 2);          // facing down
  const states = ['on', 'flicker', 'dead'];
  const panelMats = {
    on: new THREE.MeshBasicMaterial({ map: pTex, color: new THREE.Color(1.6, 1.55, 1.38) }),
    flicker: new THREE.MeshBasicMaterial({ map: pTex, color: new THREE.Color(1.4, 1.36, 1.2) }),
    dead: new THREE.MeshBasicMaterial({ map: pTex, color: new THREE.Color(0.32, 0.31, 0.27) }),
  };
  const m4 = new THREE.Matrix4();
  for (const st of states) {
    const list = lights.filter(L => !L.omni && L.state === st);
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(panelGeo, panelMats[st], list.length);
    list.forEach((L, i) => { m4.makeTranslation(L.x, H - 0.006, L.z); inst.setMatrixAt(i, m4); });
    group.add(inst);
  }

  // ---------- the exit door ----------
  if (door) {
    const dg = new THREE.Group();
    dg.position.set(door.x, 0, door.z);
    dg.rotation.y = Math.atan2(door.nx, door.nz);      // local +z points into the maze
    const frameM = new THREE.MeshStandardMaterial({ color: '#4a3b26', roughness: 0.7 });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); dg.add(o); return o; };
    add(new THREE.BoxGeometry(0.12, 2.25, 0.16), frameM, -0.66, 1.125, 0.05);
    add(new THREE.BoxGeometry(0.12, 2.25, 0.16), frameM, 0.66, 1.125, 0.05);
    add(new THREE.BoxGeometry(1.44, 0.12, 0.16), frameM, 0, 2.25, 0.05);
    // a bright white nothing beyond the open door
    add(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.15) }), 0, 1.1, 0.002);
    // the door itself, swung open into the maze
    const leaf = add(new THREE.BoxGeometry(1.15, 2.15, 0.05), new THREE.MeshStandardMaterial({ color: '#8a7350', roughness: 0.6 }), 0, 1.08, 0);
    leaf.geometry.translate(0.575, 0, 0);
    leaf.position.set(-0.6, 1.08, 0.04);
    leaf.rotation.y = -1.9;
    add(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: '#c9b37a', metalness: 0.8, roughness: 0.3 }), 0, 0, 0).visible = false;
    const sign = add(new THREE.PlaneGeometry(0.62, 0.23), new THREE.MeshBasicMaterial({ map: exitTexture(renderer), color: new THREE.Color(1.5, 1.5, 1.5) }), 0, 2.55, 0.02);
    void sign;
    group.add(dg);
  }

  // lights for players and the monster (the walls are baked and don't need them)
  group.add(new THREE.HemisphereLight('#fff1c4', '#6b5a2a', 1.6));
  const top = new THREE.DirectionalLight('#fff4d8', 0.9);
  top.position.set(0.3, 1, 0.2);
  group.add(top);

  // ---------- runtime: flickering panels, and the whole place dimming when "it" is near ----------
  const flick = panelMats.flicker, flickBase = flick.color.clone();
  const surfMats = surfaces.map(m => m.material);
  let t = 0;
  group.userData.update = (dt, dread = 0) => {
    t += dt;
    // a fluorescent tube that won't stay on: mostly on, with stutters and short blackouts
    const s = Math.sin(t * 13.1) + Math.sin(t * 31.7) * 0.6 + Math.sin(t * 2.3) * 1.4;
    const on = s > -1.2 ? 1 : 0.08;
    flick.color.copy(flickBase).multiplyScalar(on * (0.85 + 0.15 * Math.sin(t * 90)));
    // dread: everything buzzes and dips when the monster is close
    const k = dread > 0 ? 1 - dread * (0.25 + 0.25 * (Math.sin(t * 23) > 0.6 ? 1 : 0) * (Math.sin(t * 3.1) > 0 ? 1 : 0.3)) : 1;
    for (const m of surfMats) m.color.setScalar(k);
    panelMats.on.color.setRGB(1.6 * k, 1.55 * k, 1.38 * k);
  };

  const far = Math.min(gfx.viewDistance || 140, 60);
  const fog = new THREE.Fog('#9a8f55', 5, Math.max(30, far * 0.72));
  return { group, theme: { name: 'backrooms' }, fog, sky: null, sun: null, far };
}
