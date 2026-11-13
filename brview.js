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

// a big black arrow sprayed on a wall (pointing right): soft overspray edges, speckles, drips
function arrowTexture(renderer) {
  // just lines, big but skinny (owner's request): a long thin shaft and an open head, sprayed by hand, a little wobbly
  const [c, g] = canvas(512, 256);
  const R = rng(4242);
  const tip = [490, 128];
  const strokes = [[[22, 132], [250, 121], tip], [[370, 34], [428, 84], tip], [[370, 222], [428, 174], tip]];   // from, bend, to
  const at = ([a, m, b], t) => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * m[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * m[1] + t * t * b[1]];
  const path = () => { g.beginPath(); for (const [a, m, b] of strokes) { g.moveTo(a[0], a[1]); g.quadraticCurveTo(m[0], m[1], b[0], b[1]); } };
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = g.fillStyle = '#000';
  // overspray: the same lines wider and fainter, then the line itself
  for (const [w, a] of [[22, 0.05], [15, 0.1], [11, 0.18]]) { g.globalAlpha = a; g.lineWidth = w; path(); g.stroke(); }
  g.globalAlpha = 0.95; g.lineWidth = 8; path(); g.stroke();          // (about 5 cm wide on the wall)
  // speckles along the lines
  for (let i = 0; i < 360; i++) {
    const [px, py] = at(strokes[Math.floor(R() * 3)], R()), r = 5 + R() * 11, ang = R() * Math.PI * 2;
    g.globalAlpha = 0.2 + R() * 0.45;
    g.fillRect(px + Math.cos(ang) * r, py + Math.sin(ang) * r, 1 + R() * 1.5, 1 + R() * 1.5);
  }
  // drips running down from the lines
  g.globalAlpha = 0.85;
  for (let i = 0; i < 9; i++) {
    const k = i < 5 ? 0 : 1 + (i % 2), [px, py] = at(strokes[k], 0.08 + R() * 0.84), top = py + 3, len = Math.min(8 + R() * 40, 250 - top);
    g.lineWidth = 1.5 + R() * 1.5; g.beginPath(); g.moveTo(px, top); g.lineTo(px + (R() - 0.5) * 2, top + len); g.stroke();
    g.beginPath(); g.arc(px, top + len, g.lineWidth * 0.8, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  return tex(c, renderer, false);
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

// a plain painted wooden door: two recessed panels, a brass handle
function doorTexture(renderer) {
  const [c, ctx] = canvas(128, 256), R = rng(51);
  ctx.fillStyle = '#9a8460'; ctx.fillRect(0, 0, 128, 256);
  noise(ctx, 128, 256, 2500, ['#8a7452', '#ab9570', '#7d6848'], 0.3, R, 1.4);
  for (const [y, h] of [[20, 96], [136, 100]]) {
    ctx.fillStyle = 'rgba(60,45,25,0.35)'; ctx.fillRect(18, y, 92, h);
    ctx.fillStyle = 'rgba(200,180,140,0.25)'; ctx.fillRect(22, y + 4, 84, h - 8);
    ctx.strokeStyle = 'rgba(50,38,20,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(22, y + 4, 84, h - 8);
  }
  ctx.fillStyle = '#c9a85a'; ctx.beginPath(); ctx.arc(110, 132, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b5528'; ctx.beginPath(); ctx.arc(111, 133, 2, 0, Math.PI * 2); ctx.fill();
  return tex(c, renderer, false);
}

// the bricked-up doorway behind a door to nowhere
function bricksTexture(renderer) {
  const [c, ctx] = canvas(128, 256), R = rng(77);
  ctx.fillStyle = '#5e574a'; ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row * 16 < 256; row++) {
    const off = (row % 2) * 16;
    for (let col = -1; col * 32 < 128; col++) {
      const v = 120 + Math.floor(R() * 30);
      ctx.fillStyle = `rgb(${v},${v - 8},${v - 22})`;
      ctx.fillRect(col * 32 + off + 2, row * 16 + 2, 28, 12);
    }
  }
  noise(ctx, 128, 256, 1500, ['#3e3a30', '#8a8270'], 0.3, R, 1.4);
  return tex(c, renderer, false);
}

// a wall power outlet: off-white plate, two slots, one screw
function outletTexture(renderer) {
  const [c, ctx] = canvas(64, 104);
  ctx.fillStyle = '#e9e4d2'; ctx.fillRect(0, 0, 64, 104);
  ctx.strokeStyle = '#b9b29a'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, 60, 100);
  for (const y of [22, 66]) {
    ctx.fillStyle = '#d8d2bc'; ctx.beginPath(); ctx.ellipse(32, y + 8, 17, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2722'; ctx.fillRect(23, y, 4, 13); ctx.fillRect(37, y, 4, 13);
  }
  ctx.fillStyle = '#a49d86'; ctx.beginPath(); ctx.arc(32, 52, 3, 0, Math.PI * 2); ctx.fill();
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

// ---------- flashlights on baked surfaces ----------
// The walls, floor and ceiling are unlit (their light is baked into them), so the usual three.js lights don't
// touch them. Instead their shader adds up to four flashlight cones itself; game code fills these uniforms.
// uDark: the lights die around the monster — (x, z, radius, strength 0..1); brfx.js moves it every frame
export const FLASH = {
  uFlashPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
  uFlashDir: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1, 0)) },
  uFlashOn: { value: [0, 0, 0, 0] },
  uDark: { value: new THREE.Vector4(0, 0, 1, 0) },
};
const DARK_FN = `uniform vec4 uDark;
float darkAt(vec3 P) { return 1.0 - uDark.w * (1.0 - smoothstep(uDark.z * 0.4, uDark.z, length(P.xz - uDark.xy))); }
// in the dark the walls keep their own colour (just darker): very dim light is mostly warm bounce light,
// which would otherwise turn the yellow wallpaper and the carpet into muddy dark-red streaks
vec3 keepHue(vec3 c, vec3 albedo) {
  const vec3 W = vec3(0.299, 0.587, 0.114);
  float l = dot(c, W), la = max(dot(albedo, W), 0.0001);
  return mix(c, albedo * (l / la), 1.0 - smoothstep(0.02, 0.14, l));
}`;
const WORLD_POS = 'vec4 fwp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nfwp = instanceMatrix * fwp;\n#endif\n';
// the ceiling panels (and anything else lit by nothing but itself) go dark around the monster too
export function addDark(material) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uDark = FLASH.uDark;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDarkPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLD_POS + 'vDarkPos = (modelMatrix * fwp).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDarkPos;\n' + DARK_FN)
      .replace('vec3 outgoingLight = reflectedLight.indirectDiffuse;', 'vec3 outgoingLight = reflectedLight.indirectDiffuse * darkAt(vDarkPos);');
  };
  material.customProgramCacheKey = () => 'dark';
  return material;
}
export function addFlash(material) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FLASH);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFlashPos; varying vec3 vFlashN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WORLD_POS + 'vFlashPos = (modelMatrix * fwp).xyz; vFlashN = mat3(modelMatrix) * normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFlashPos; varying vec3 vFlashN;
${DARK_FN}
uniform vec3 uFlashPos[4]; uniform vec3 uFlashDir[4]; uniform float uFlashOn[4];
vec3 flashLight(vec3 P, vec3 N) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (uFlashOn[i] < 0.01) continue;
    vec3 L = P - uFlashPos[i]; float d = length(L); L /= max(d, 0.001);
    float c = dot(L, uFlashDir[i]);
    // a bright beam reaching well down a corridor, with a soft dim spill round its edge
    // a small beam (owner's request) whose edge melts into the dark instead of ending in a hard ring
    float core = smoothstep(0.86, 0.995, c);
    float cone = core * core * 1.15 + 0.07 * smoothstep(0.7, 0.95, c);
    float lam = abs(dot(N, L)) * 0.85 + 0.15;
    s += uFlashOn[i] * cone * lam * 1.84 / (1.0 + d * d * 0.022);      // (20 % dimmer: owner's request)
  }
  return s * vec3(1.0, 0.95, 0.82);
}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\nvec3 flashAlbedo = diffuseColor.rgb;')
      .replace('vec3 outgoingLight = reflectedLight.indirectDiffuse;', 'vec3 outgoingLight = keepHue(reflectedLight.indirectDiffuse * darkAt(vFlashPos), flashAlbedo) + flashAlbedo * flashLight(vFlashPos, length(vFlashN) > 0.001 ? normalize(vFlashN) : vec3(0.0, 1.0, 0.0));');
  };
  material.customProgramCacheKey = () => 'flash';
  return material;
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
    // dark areas: every light off (owner's request: no stuttering ones in there either)
    const dark = (plan.darkZones || []).some(d => x >= d.x && x < d.x + d.w && z >= d.z && z < d.z + d.d);
    const state = dark ? 'dead' : r < 0.06 ? 'dead' : r < 0.12 ? 'flicker' : 'on';
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
  // a dark area's own lights are dead, and even the light that spills in from next door fades out. The fade runs
  // from 2 m before its edge to 4 m inside, in steps the eye sees as even (the light drops by the same factor
  // every few cm, not by the same amount), so there is no line where the dark begins (owner: "blend more")
  const zones = (plan.darkZones || []).map(d => ({ x0: at(d.x) + 0.5, z0: at(d.z) + 0.5, x1: at(d.x + d.w), z1: at(d.z + d.d) }));
  const DARK_MIN = 0.02, FADE_OUT = 2, FADE_IN = 4;             // (nearly pitch black: bring a flashlight)
  const darkK = (x, z) => {
    let k = 1;
    for (const d of zones) {
      const ox = Math.max(d.x0 - x, 0, x - d.x1), oz = Math.max(d.z0 - z, 0, z - d.z1);
      const inside = ox || oz ? -Math.hypot(ox, oz) : Math.min(x - d.x0, d.x1 - x, z - d.z0, d.z1 - z);
      if (inside <= -FADE_OUT) continue;
      const f = Math.min(1, (inside + FADE_OUT) / (FADE_OUT + FADE_IN));
      k = Math.min(k, Math.pow(DARK_MIN, f * f * (3 - 2 * f)));
    }
    return k;
  };
  let fx_ = 0, fz_ = 0;                  // where finish() is being worked out (set before each call)
  const finish = (r, g, b, ao, gr) => {
    const dk = darkK(fx_, fz_), k = ao * gr * EXPO * dk;
    return [Math.min(1.6, (r + AMB) * k), Math.min(1.6, (g + AMB) * k), Math.min(1.6, (b + AMB * 0.8) * k)];
  };

  // ---------- floor (carpet) and ceiling ----------
  const fPos = [], fUV = [], fCol = [], cPos = [], cUV = [], cCol = [];
  for (let iz = 0; iz < FD; iz++) for (let ix = 0; ix < FW; ix++) {
    const x = ix * CELL, z = iz * CELL, k = iz * FW + ix;
    const gr = grime(x, z);
    fx_ = x; fz_ = z;
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
  const baked = (map) => addFlash(new THREE.MeshBasicMaterial({ map, vertexColors: true }));
  const surfaces = [];
  surfaces.push(mesh(fPos, fUV, fCol, fIdx, baked(carpetTexture(renderer))));
  surfaces.push(mesh(cPos, cUV, cCol, cIdx, baked(ceilingTexture(renderer))));

  // ---------- walls, pillars, the wall above doorways, skirting boards and outlets ----------
  // bottom of the wall in each cell: 0 for a wall, the doorway height for the wall above a doorway, none for open floor
  const bottom = new Float32Array(Wc * Dc).fill(Infinity);
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    const i = iz * Wc + ix;
    if (solid[i]) bottom[i] = 0;
    else { const lin = world.cellSpans(ix, iz).find(sp => sp.m === 'wallpaper' && sp.y0 > 1.5 && sp.y0 < H - 0.1); if (lin) bottom[i] = lin.y0; }
  }
  const bot = (ix, iz) => (ix < 0 || iz < 0 || ix >= Wc || iz >= Dc ? 0 : bottom[iz * Wc + ix]);
  const BASE_ROWS = [0, 0.11, 0.35, 0.8, 1.4, 2.0, 2.45, 2.72, H];
  const wPos = [], wUV = [], wCol = [], bPos = [], bCol = [];
  const outlets = [];                     // [x, y, z, nx, nz, colour]
  const RO = rng(plan.seed * 17 + 9);
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const wallLight = (px, pz, nx, nz, y, corner, gr) => {
    fx_ = px; fz_ = pz;
    direct(px, Math.max(0.05, Math.min(H - 0.05, y)), pz, nx, 0, nz, tmp);
    const bk2 = 0.3 * (1 - y / H * 0.4), up = 0.12 * (y / H);
    const r = tmp[0] + (bounceAt(px, pz, 0) * BOUNCE[0]) * (bk2 + up), g = tmp[1] + (bounceAt(px, pz, 1) * BOUNCE[1]) * (bk2 + up), b = tmp[2] + (bounceAt(px, pz, 2) * BOUNCE[2]) * (bk2 + up);
    const ao = corner * (y < 0.3 ? 0.72 + y : 1) * (y > H - 0.3 ? 0.8 + (H - y) * 0.6 : 1);
    return finish(r, g, b, Math.min(1, ao), gr);
  };
  const quadPush = (P, UV, COL, A, B, C, Dv, ua, ub, va, vb, ca, cb, cc, cd) => {
    for (const [p, u, v, c] of [[A, ua, va, ca], [B, ub, va, cb], [C, ub, vb, cc], [A, ua, va, ca], [C, ub, vb, cc], [Dv, ua, vb, cd]]) {
      P.push(...p); if (UV) UV.push(u, v); COL.push(...c);
    }
  };
  for (let iz = 0; iz < Dc; iz++) for (let ix = 0; ix < Wc; ix++) {
    const bc = bottom[iz * Wc + ix];
    if (bc === Infinity) continue;
    const x0 = ix * CELL, z0 = iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    // the underside of the wall above a doorway
    if (bc > 0) {
      const k = Math.min(FD - 1, iz) * FW + Math.min(FW - 1, ix);
      fx_ = x0; fz_ = z0;
      const c = finish(bounce[k * 3] * 0.5, bounce[k * 3 + 1] * 0.48, bounce[k * 3 + 2] * 0.4, 0.8, 1);
      quadPush(wPos, wUV, wCol, [x0, bc, z0], [x1, bc, z0], [x1, bc, z1], [x0, bc, z1], x0, x1, z0, z1, c, c, c, c);
    }
    for (const [nx, nz] of SIDES) {
      const ox = ix + nx, oz = iz + nz;
      const bn = bot(ox, oz);
      if (bn <= bc) continue;                         // the neighbour covers this face
      const top = Math.min(H, bn);
      // the face between this cell and its neighbour, as two ends a → b (seen from the neighbour's side, left to right)
      const ends = nx === 1 ? [[x1, z1], [x1, z0]] : nx === -1 ? [[x0, z0], [x0, z1]] : nz === 1 ? [[x0, z1], [x1, z1]] : [[x1, z0], [x0, z0]];
      const rows = [bc, ...BASE_ROWS.filter(y => y > bc + 0.01 && y < top - 0.01), top];
      const gr0 = grime(ends[0][0], ends[0][1]), gr1 = grime(ends[1][0], ends[1][1]);
      const cols = ends.map(([ex, ez], e) => {
        // light along this end of the face, bottom to top; the sample point sits just off the wall
        const px = ex + nx * 0.06 - (nx ? 0 : Math.sign(ex - (x0 + x1) / 2) * 0.04), pz = ez + nz * 0.06 - (nz ? 0 : Math.sign(ez - (z0 + z1) / 2) * 0.04);
        // an inside corner next to this end darkens it
        const sx = nz !== 0 ? Math.sign(ex - (x0 + x1) / 2) : 0, sz = nx !== 0 ? Math.sign(ez - (z0 + z1) / 2) : 0;
        const corner = bot(ox + sx, oz + sz) === 0 ? 0.78 : 1;
        return rows.map(y => wallLight(px, pz, nx, nz, y, corner, e ? gr1 : gr0));
      });
      const ua = nx ? ends[0][1] : ends[0][0], ub = nx ? ends[1][1] : ends[1][0];
      const flip = nx === -1 || nz === 1 ? 1 : -1;      // keep the paper running the same way on every wall
      for (let r = 0; r < rows.length - 1; r++) {
        const ya = rows[r], yb = rows[r + 1];
        quadPush(wPos, wUV, wCol, [ends[0][0], ya, ends[0][1]], [ends[1][0], ya, ends[1][1]], [ends[1][0], yb, ends[1][1]], [ends[0][0], yb, ends[0][1]],
          ua * flip, ub * flip, ya, yb, cols[0][r], cols[1][r], cols[1][r + 1], cols[0][r + 1]);
      }
      if (bc > 0) continue;
      // skirting board along the foot of the wall. At the outside corner of a wall end or pillar the board on the
      // face pointing along x runs on past the corner and gets an end, so the two boards meet with no gap.
      const o = 0.02, hgt = 0.1;
      const ca = cols[0][1], cb = cols[1][1];
      const A = [...ends[0]], B = [...ends[1]];
      const tx = Math.sign(B[0] - A[0]), tz = Math.sign(B[1] - A[1]);
      const caps = [];
      if (nx !== 0) {
        if (bot(ix - tx, iz - tz) !== 0) { A[0] -= tx * o; A[1] -= tz * o; caps.push([A, -tx, -tz]); }
        if (bot(ix + tx, iz + tz) !== 0) { B[0] += tx * o; B[1] += tz * o; caps.push([B, tx, tz]); }
      }
      const Af = [A[0] + nx * o, A[1] + nz * o], Bf = [B[0] + nx * o, B[1] + nz * o];
      quadPush(bPos, null, bCol, [Af[0], 0, Af[1]], [Bf[0], 0, Bf[1]], [Bf[0], hgt, Bf[1]], [Af[0], hgt, Af[1]], 0, 0, 0, 0, ca, cb, cb, ca);
      const ta = ca.map(v => v * 0.95), tb = cb.map(v => v * 0.95);
      quadPush(bPos, null, bCol, [Af[0], hgt, Af[1]], [Bf[0], hgt, Bf[1]], [B[0], hgt, B[1]], [A[0], hgt, A[1]], 0, 0, 0, 0, ta, tb, tb, ta);
      for (const [E] of caps) {
        const F = [E[0] + nx * o, E[1] + nz * o], c = E === A ? ca : cb;
        quadPush(bPos, null, bCol, [E[0], 0, E[1]], [F[0], 0, F[1]], [F[0], hgt, F[1]], [E[0], hgt, E[1]], 0, 0, 0, 0, c, c, c, c);
      }
      // now and then a power outlet just above the skirting (not on pillars, not next to a hole)
      if (kind[iz * Wc + ix] === 1 && bn === Infinity && !isPit(ox, oz) && RO() < 0.012) {
        const cx = (ends[0][0] + ends[1][0]) / 2, cz = (ends[0][1] + ends[1][1]) / 2;
        if (!outlets.some(q => Math.hypot(q[0] - cx, q[2] - cz) < 6)) outlets.push([cx + nx * 0.004, 0.32, cz + nz * 0.004, nx, nz, cols[0][2]]);
      }
    }
  }
  const wallTex = wallpaperTexture(renderer);
  surfaces.push(mesh(wPos, wUV, wCol, null, baked(wallTex)));
  surfaces[surfaces.length - 1].material.userData.base = 0.95;       // the wallpaper a touch darker (owner's request)
  if (bPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, addFlash(new THREE.MeshBasicMaterial({ color: '#b9ae84', vertexColors: true, side: THREE.DoubleSide })));
    surfaces.push(m); group.add(m);
  }

  // ---------- doors ----------
  // light at a spot on a wall (for things fixed to walls: they use the same baked light)
  const spotLight = (x, y, z, nx, nz) => { const c = wallLight(x + nx * 0.06, z + nz * 0.06, nx, nz, y, 1, 1); return new THREE.Color(c[0], c[1], c[2]); };
  const frameM = addFlash(new THREE.MeshBasicMaterial({ color: '#cfc6a2' }));
  const doorTex = doorTexture(renderer);
  const box = (w, h, d, m, x, y, z, ry = 0, tint = null) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tint ? addFlash(m.clone()) : m);
    if (tint) o.material.color.multiply(tint);
    o.position.set(x, y, z); o.rotation.y = ry; group.add(o); return o;
  };
  // Every door (world.doors) swings on a hinge: doorways have double doors, doors to nowhere a single one.
  // A leaf's local x runs from its hinge to its free edge; its angle turns it about the hinge.
  const leaves = [];                       // per door: [{ pivot, shut, open: [angle when swung to + side, to - side], now, to }]
  const dirAngle = (dx, dz) => Math.atan2(-dz, dx);       // the y rotation that points local +x along (dx, dz)
  const brickTex = bricksTexture(renderer);
  world.doors.forEach((d, i) => {
    const list = [];
    if (d.kind === 'way') {
      const v = d.v, g0 = v ? d.z0 : d.x0, g1 = v ? d.z1 : d.x1, wl = v ? d.cx : d.cz, mid = (g0 + g1) / 2;
      const DH = BR.door, depth = CELL + 0.06;
      const tint = spotLight(v ? wl + 0.3 : mid, 1.2, v ? mid : wl + 0.3, v ? 1 : 0, v ? 0 : 1);
      const at3 = (u, y, w) => (v ? [w, y, u] : [u, y, w]);
      // a painted frame round the gap: it covers the cut edges of the wall (sticking 5 cm into the gap, so the
      // wall's own faces never show through it) and stands 3 cm proud of both wall faces
      const IN = 0.05;
      for (const [u, s] of [[g0, 1], [g1, -1]]) { const p = at3(u + s * (IN - 0.04), DH / 2, wl); box(v ? depth : 0.08, DH, v ? 0.08 : depth, frameM, p[0], p[1], p[2], 0, tint); }
      { const p = at3(mid, DH - IN + 0.04, wl); box(v ? depth : g1 - g0 + 0.16, 0.08, v ? g1 - g0 + 0.16 : depth, frameM, p[0], p[1], p[2], 0, tint); }
      // double doors, hinged just inside the frame on both sides of the gap: opened, a leaf lies along the
      // frame (never through it)
      const gapH = DH - IN, inset = IN + 0.028, dw = (g1 - g0) / 2 - inset - 0.012, lh = gapH - 0.03;
      for (const [hinge, toward] of [[g0 + inset, 1], [g1 - inset, -1]]) {
        const pivot = new THREE.Group();
        const p = at3(hinge, 0, wl);
        pivot.position.set(p[0], 0, p[2]);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw, lh, 0.045), addFlash(new THREE.MeshBasicMaterial({ map: doorTex })));
        leaf.material.color.copy(tint);
        leaf.position.set(dw / 2, 0.012 + lh / 2, 0);
        pivot.add(leaf);
        group.add(pivot);
        const shut = v ? dirAngle(0, toward) : dirAngle(toward, 0);
        // open: turned a quarter, so the free edge points into one room or the other
        const nx = v ? 1 : 0, nz = v ? 0 : 1;
        pivot.rotation.order = 'YXZ';          // (so it can also tip over about its bottom edge: kicked, knocked down)
        list.push({ pivot, shut, open: [dirAngle(nx, nz), dirAngle(-nx, -nz)], v });
      }
    } else {
      const nx = d.nx, nz = d.nz, px = d.cx, pz = d.cz;
      const tint = spotLight(px, 1.1, pz, nx, nz);
      const ry = Math.atan2(nx, nz);
      // the bricked-up hole you find behind it, then the frame and the door itself
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.04), addFlash(new THREE.MeshBasicMaterial({ map: brickTex })));
      back.material.color.copy(tint).multiplyScalar(0.8);
      back.position.set(px + nx * 0.004, 1.02, pz + nz * 0.004); back.rotation.y = ry; group.add(back);
      for (const s of [-1, 1]) box(0.07, 2.12, 0.06, frameM, px + nx * 0.03 + (d.v ? 0 : s * 0.5), 1.06, pz + nz * 0.03 + (d.v ? s * 0.5 : 0), ry, tint);
      box(1.07, 0.07, 0.06, frameM, px + nx * 0.03, 2.12, pz + nz * 0.03, ry, tint);
      // hinge on the left edge (seen from the room), the door lying flat over the bricks when shut
      const tx = d.v ? 0 : 1, tz = d.v ? 1 : 0;              // along the wall
      const sgn = d.v ? -nx : nz;                              // which way along the wall is "left" from the room
      const hx = px + nx * 0.025 - tx * 0.46 * sgn, hz = pz + nz * 0.025 - tz * 0.46 * sgn;
      const pivot = new THREE.Group();
      pivot.position.set(hx, 0, hz);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.05, 0.04), addFlash(new THREE.MeshBasicMaterial({ map: doorTex })));
      leaf.material.color.copy(tint);
      leaf.position.set(0.46, 1.025, 0);
      pivot.add(leaf);
      group.add(pivot);
      const shut = dirAngle(tx * sgn, tz * sgn);
      // swings 100° out into the room: try both ways, keep the one whose free edge ends up in front of the wall
      const out = [shut + 1.75, shut - 1.75].find(a => Math.cos(a) * nx + -Math.sin(a) * nz > 0);
      list.push({ pivot, shut, open: [out, null] });
    }
    for (const L of list) { L.now = L.to = d.open ? L.open[0] : L.shut; L.pivot.rotation.y = L.now; }
    leaves[i] = list;
  });
  // open / shut a door (swing: +1 opens towards +x / +z, −1 the other way); instant: no animation (joining a game)
  const turnTo = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d; };
  // which way a leaf tips (+1/-1 about its bottom edge) to fall towards the side `swing` points at
  const tipSign = (L, swing) => {
    const fx = L.v ? (swing >= 0 ? 1 : -1) : 0, fz = L.v ? 0 : (swing >= 0 ? 1 : -1);
    return Math.sign(Math.sin(L.now) * fx + Math.cos(L.now) * fz) || 1;
  };
  // broken: kicked in by the monster, both leaves torn off their hinges and flat on the floor (for good)
  group.userData.setDoor = (i, open, swing = 1, instant = false, broken = false) => {
    for (const L of leaves[i] || []) {
      if (broken) {
        if (L.broken) continue;
        L.broken = true;
        L.now = L.to = L.shut + (Math.random() - 0.5) * 0.25;
        L.pivot.rotation.y = L.now;
        L.pivot.position.y = 0.025;
        L.tip = tipSign(L, swing);
        L.fall = instant ? 1 : 0;
        L.pivot.rotation.x = L.tip * (Math.PI / 2 - 0.03) * L.fall;
        continue;
      }
      if (L.broken) continue;
      const target = !open ? L.shut : (L.open[1] == null || swing >= 0 ? L.open[0] : L.open[1]);
      L.to = turnTo(L.now, target);
      if (instant) { L.now = L.to; L.pivot.rotation.y = L.now; }
    }
  };
  // a kick: the shut leaves jump in their frame
  group.userData.kickDoor = (i, swing = 1) => {
    for (const L of leaves[i] || []) if (!L.broken) { L.jolt = 1; L.joltSign = tipSign(L, swing); }
  };
  const animateDoors = (dt) => {
    for (const list of leaves) for (const L of list || []) {
      if (L.broken) {
        // falling flat, faster and faster
        if (L.fall < 1) { L.fall = Math.min(1, L.fall + dt / 0.4); L.pivot.rotation.x = L.tip * (Math.PI / 2 - 0.03) * L.fall * L.fall; }
        continue;
      }
      if (L.jolt > 0) { L.jolt = Math.max(0, L.jolt - dt * 5); L.pivot.rotation.x = L.joltSign * 0.08 * Math.sin(L.jolt * Math.PI); }
      if (L.now === L.to) continue;
      const step = dt * 5.5, d = L.to - L.now;
      L.now = Math.abs(d) <= step ? L.to : L.now + Math.sign(d) * step;
      L.pivot.rotation.y = L.now;
    }
  };

  // ---------- power outlets ----------
  if (outlets.length) {
    const geo = new THREE.PlaneGeometry(0.09, 0.145);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: outletTexture(renderer) }), outlets.length);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    outlets.forEach(([x, y, z, nx, nz, c], i) => {
      e.set(0, Math.atan2(nx, nz), 0); q.setFromEuler(e);
      inst.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, one));
      inst.setColorAt(i, new THREE.Color(Math.min(1.2, c[0] * 1.1), Math.min(1.2, c[1] * 1.1), Math.min(1.2, c[2] * 1.1)));
    });
    group.add(inst);
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
      const top = Math.min(0.5, (floorL[k * 3] + 0.05) * 0.45) * darkK(ends[0][0], ends[0][1]);
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
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#7a6a45', vertexColors: true, side: THREE.DoubleSide, fog: false }));
    surfaces.push(m); group.add(m);
  }

  // ---------- the fluorescent panels ----------
  const pTex = panelTexture(renderer);
  const panelGeo = new THREE.PlaneGeometry(1.2, 0.6);
  panelGeo.rotateX(Math.PI / 2);          // facing down
  const states = ['on', 'flicker', 'dead'];
  const panelMats = {
    on: addDark(new THREE.MeshBasicMaterial({ map: pTex, color: new THREE.Color(1.6, 1.55, 1.38) })),
    flicker: addDark(new THREE.MeshBasicMaterial({ map: pTex, color: new THREE.Color(1.4, 1.36, 1.2) })),
    dead: addDark(new THREE.MeshBasicMaterial({ map: pTex, color: new THREE.Color(0.32, 0.31, 0.27) })),
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

  // ---------- big black arrows sprayed on the walls, pointing the rough compass direction of the exit ----------
  if ((plan.arrows || []).length) {
    const aPos = [], aUV = [];
    for (const a of plan.arrows) {
      // the face of the wall on side (wx, wz) of room (x, z), and its normal (into the room)
      const nx = -a.wx, nz = -a.wz;
      let fx = at(a.x) + 2.25, fz = at(a.z) + 2.25;
      if (a.wx < 0) fx = a.x === 0 ? at(0) : at(a.x) + 0.5;
      if (a.wx > 0) fx = at(a.x + 1);
      if (a.wz < 0) fz = a.z === 0 ? at(0) : at(a.z) + 0.5;
      if (a.wz > 0) fz = at(a.z + 1);
      const cx = fx + nx * 0.012, cz = fz + nz * 0.012, cy = 1.5;
      // across the wall, turned so the tip points the way to go; a little crooked, like it was done by hand
      let ux = nz, uz = -nx;
      if (ux * a.dx + uz * a.dz < 0) { ux = -ux; uz = -uz; }
      const hw = 1.62 * a.s, hh = 0.81 * a.s, ct = Math.cos(a.tilt), st = Math.sin(a.tilt);      // about 3.3 m long: twice as big (owner), as long as a wall
      const U = [ux * ct, st, uz * ct], V = [-ux * st, ct, -uz * st];
      const P = (su, sv) => [cx + U[0] * hw * su + V[0] * hh * sv, cy + U[1] * hw * su + V[1] * hh * sv, cz + U[2] * hw * su + V[2] * hh * sv];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { aPos.push(...P(su, sv)); aUV.push((su + 1) / 2, (sv + 1) / 2); }
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3));
    ag.setAttribute('uv', new THREE.Float32BufferAttribute(aUV, 2));
    const am = new THREE.MeshBasicMaterial({ map: arrowTexture(renderer), color: '#0d0b07', transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const arrows = new THREE.Mesh(ag, am);
    arrows.renderOrder = 1;
    group.add(arrows);
  }

  // ---------- holes in the ceiling: a missing tile, or one pushed aside (something up there) ----------
  const voidM = new THREE.MeshBasicMaterial({ color: '#000000', fog: false, side: THREE.DoubleSide });
  const ceilTex = ceilingTexture(renderer);
  for (const h of plan.holes || []) {
    const S = h.size, k = Math.min(FD - 1, Math.round(h.z / CELL)) * FW + Math.min(FW - 1, Math.round(h.x / CELL));
    const lit = Math.max(0.05, Math.min(1.2, bounce[k * 3] * 0.62 + 0.04));
    // a black shaft going up into the dark
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(S - 0.02, 0.9, S - 0.02), voidM);
    shaft.position.set(h.x, H + 0.45 - 0.002, h.z);
    group.add(shaft);
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(S - 0.01, S - 0.01), voidM);
    gap.rotation.x = Math.PI / 2; gap.position.set(h.x, H - 0.003, h.z);
    group.add(gap);
    if (h.kind === 'shifted') {
      // the tile itself, lifted and slid half off its hole, tilted up into the dark
      const tm = new THREE.MeshBasicMaterial({ map: ceilTex.clone(), color: new THREE.Color(lit * 0.75, lit * 0.72, lit * 0.6) });
      tm.map.repeat.set(0.5, 0.5); tm.map.needsUpdate = true;
      const tile = new THREE.Mesh(new THREE.BoxGeometry(S - 0.02, 0.015, S - 0.02), tm);
      const dx = [1, 0, -1, 0][h.dir] * S * 0.45, dz = [0, 1, 0, -1][h.dir] * S * 0.45;
      tile.position.set(h.x + dx, H + 0.05, h.z + dz);
      tile.rotation.set(dz ? Math.sign(dz) * -0.22 : 0, 0, dx ? Math.sign(dx) * 0.22 : 0);
      group.add(tile);
    }
  }

  // how much light falls on a spot (0 dark … ~1.3 under a panel): for dimming the people and the monster in dark areas
  group.userData.lightAt = (x, z) => {
    const ix = Math.max(0, Math.min(FW - 1, Math.round(x / CELL))), iz = Math.max(0, Math.min(FD - 1, Math.round(z / CELL)));
    const k = iz * FW + ix;
    return (floorL[k * 3] + bounce[k * 3] * 0.35 + AMB) * EXPO * darkK(x, z);
  };

  // lights for players and the monster (the walls are baked and don't need them)
  const hemi = new THREE.HemisphereLight('#fff1c4', '#6b5a2a', 1.6);
  group.add(hemi);
  const top = new THREE.DirectionalLight('#fff4d8', 0.9);
  top.position.set(0.3, 1, 0.2);
  group.add(top);
  group.userData.dimPeople = (k) => { hemi.intensity = 1.6 * k; top.intensity = 0.9 * k; };

  // ---------- sparks from flickering panels ----------
  const SPARKS = 160;
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(SPARKS * 3), sVel = new Float32Array(SPARKS * 3), sLife = new Float32Array(SPARKS);
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  // round, hot sparks (a soft dot drawn on a tiny canvas)
  const [dotC, dotX] = canvas(32);
  const dg = dotX.createRadialGradient(16, 16, 0, 16, 16, 16);
  dg.addColorStop(0, 'rgba(255,255,255,1)'); dg.addColorStop(0.35, 'rgba(255,220,140,0.9)'); dg.addColorStop(1, 'rgba(255,140,40,0)');
  dotX.fillStyle = dg; dotX.fillRect(0, 0, 32, 32);
  const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dotC), color: new THREE.Color(2.4, 1.9, 1.1), size: 0.045, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sparks.frustumCulled = false;
  group.add(sparks);
  let sNext = 0;
  const emit = (x, y, z, n) => {
    for (let i = 0; i < n; i++) {
      const j = sNext++ % SPARKS;
      sPos[j * 3] = x + (Math.random() - 0.5) * 1.0; sPos[j * 3 + 1] = y; sPos[j * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
      sVel[j * 3] = (Math.random() - 0.5) * 2.2; sVel[j * 3 + 1] = -Math.random() * 1.2; sVel[j * 3 + 2] = (Math.random() - 0.5) * 2.2;
      sLife[j] = 0.5 + Math.random() * 0.7;
    }
  };
  const flickLights = lights.filter(L => L.state === 'flicker');
  group.userData.onSpark = null;           // game code: play the zap sound
  let burst = null;                        // a hallucinated burst: every light near (x, z) goes mad for a moment
  group.userData.flickerBurst = (x, z, secs = 1.4) => { burst = { x, z, until: t + secs }; };

  // ---------- runtime: flickering panels, and the whole place dimming when "it" is near ----------
  const flick = panelMats.flicker, flickBase = flick.color.clone();
  const surfMats = surfaces.map(m => m.material);
  let t = 0;
  let wasOn = 1;
  group.userData.update = (dt, dread = 0, cam = null) => {
    t += dt;
    animateDoors(dt);
    // a fluorescent tube that won't stay on: mostly on, with stutters and short blackouts
    const s = Math.sin(t * 13.1) + Math.sin(t * 31.7) * 0.6 + Math.sin(t * 2.3) * 1.4;
    let on = s > -1.2 ? 1 : 0.08;
    if (burst && t < burst.until) on = Math.random() < 0.5 ? 1 : 0.05;
    flick.color.copy(flickBase).multiplyScalar(on * (0.85 + 0.15 * Math.sin(t * 90)));
    // as a tube stutters back on it throws sparks (and buzzes), for the ones near you
    if (on > 0.5 && wasOn < 0.5 && cam) {
      for (const L of flickLights) {
        const d = Math.hypot(L.x - cam.x, L.z - cam.z);
        if (d > 22 || Math.random() < 0.35) continue;
        emit(L.x, H - 0.05, L.z, 6 + Math.floor(Math.random() * 8));
        if (group.userData.onSpark && d < 16) group.userData.onSpark(L.x, H - 0.1, L.z);
      }
    }
    if (burst && t < burst.until && cam && Math.random() < dt * 6) { emit(burst.x, H - 0.05, burst.z, 8); if (group.userData.onSpark) group.userData.onSpark(burst.x, H - 0.1, burst.z); }
    wasOn = on;
    // sparks fall, bounce off the floor and die out
    for (let j = 0; j < SPARKS; j++) {
      if (sLife[j] <= 0) { sPos[j * 3 + 1] = -100; continue; }
      sLife[j] -= dt;
      sVel[j * 3 + 1] -= 9 * dt;
      sPos[j * 3] += sVel[j * 3] * dt; sPos[j * 3 + 1] += sVel[j * 3 + 1] * dt; sPos[j * 3 + 2] += sVel[j * 3 + 2] * dt;
      if (sPos[j * 3 + 1] < 0.01) { sPos[j * 3 + 1] = 0.01; sVel[j * 3 + 1] *= -0.3; sVel[j * 3] *= 0.5; sVel[j * 3 + 2] *= 0.5; }
    }
    sGeo.attributes.position.needsUpdate = true;
    // dread: everything buzzes and dips when the monster is close
    const k = dread > 0 ? 1 - dread * (0.25 + 0.25 * (Math.sin(t * 23) > 0.6 ? 1 : 0) * (Math.sin(t * 3.1) > 0 ? 1 : 0.3)) : 1;
    for (const m of surfMats) m.color.setScalar(k * (m.userData.base || 1));
    panelMats.on.color.setRGB(1.6 * k, 1.55 * k, 1.38 * k);
  };

  const far = Math.min(gfx.viewDistance || 140, 60);
  const fog = new THREE.Fog('#9a8f55', 5, Math.max(30, far * 0.72));
  return { group, theme: { name: 'backrooms' }, fog, sky: null, sun: null, far };
}
