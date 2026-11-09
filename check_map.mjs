// Validates a map: builds it, checks every key area is reachable on foot,
// and writes a top-down preview (PPM) of ground/upper levels.
// Usage: node check_map.mjs outpost [preview.ppm]
//        node check_map.mjs quarry large [preview.ppm]   (deathmatch maps: small or large)
import { MAPS, resolveMap, isDmMap } from './maps.js';
import { World, CELL, STEP, PLAYER_HEIGHT } from './world.js';
import { writeFileSync } from 'fs';

const id = process.argv[2] || 'outpost';
if (!MAPS[id]) { console.log(`No map called "${id}". Maps: ${Object.keys(MAPS).join(', ')}`); process.exit(1); }
const dm = isDmMap(id);
let args = process.argv.slice(3);
const variant = dm ? (args[0] === 'large' || args[0] === 'small' ? args.shift() : 'small') : null;
const out = args[0];
const def = resolveMap(id, variant);
if (dm) console.log(`${def.name} (${variant}, ${def.size[0]} × ${def.size[1]} m)`);
const w = new World(def);
const surfaces = (ix, iz) => {
  const spans = w.cellSpans(ix, iz);
  const tops = [0, ...spans.map(s => s.y1)];
  return tops.filter(t => !spans.some(s => (s.y0 < t + PLAYER_HEIGHT && s.y1 > t + 0.01) || (s.y0 < t - 0.01 && s.y1 > t + 0.01)));
};
const key = (ix, iz, y) => `${ix},${iz},${y.toFixed(2)}`;
const surf = new Map();
for (let iz = 0; iz < w.h; iz++) for (let ix = 0; ix < w.w; ix++) for (const y of surfaces(ix, iz)) surf.set(key(ix, iz, y), [ix, iz, y]);
// a player (0.72 m wide) needs the neighbouring cells to be standable at about the same height
const near = (ix, iz, y) => surfaces(ix, iz).find(t => Math.abs(t - y) <= STEP + 0.01);
const fits = (ix, iz, y) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (near(ix + dx, iz + dz, y) === undefined) return false; return true; };
const start = dm ? w.spawns.dm[0] : w.spawns.atk[0];
const s0 = [Math.floor(start.x / CELL), Math.floor(start.z / CELL), 0];
const seen = new Set([key(...s0)]), q = [s0];
while (q.length) {
  const [ix, iz, y] = q.shift();
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = ix + dx, nz = iz + dz;
    const t = near(nx, nz, y);
    if (t === undefined || !fits(nx, nz, t)) continue;
    const k = key(nx, nz, t);
    if (!seen.has(k)) { seen.add(k); q.push([nx, nz, t]); }
  }
}
const reach = (x, z, y = 0) => {
  const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
  for (let r = 0; r <= 2; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const t = near(ix + dx, iz + dz, y);
    if (t !== undefined && seen.has(key(ix + dx, iz + dz, t))) return true;
  }
  return false;
};
const checks = dm ? {} : {
  'defender spawn': reach(w.spawns.def[0].x, w.spawns.def[0].z),
  'bomb site': reach(w.sites.A.x, w.sites.A.z + 3),
};
for (const [name, [x, z, y]] of Object.entries(def.checkPoints || {})) checks[name] = reach(x, z, y);
// every spawn point must be reachable and standing in the open
const allSpawns = [...w.spawns.atk.map(s => ['attacker', s]), ...w.spawns.def.map(s => ['defender', s]), ...w.spawns.dm.map(s => ['deathmatch', s])];
for (const [kind, s] of allSpawns) {
  checks[`${kind} spawn at ${s.x}, ${s.z}`] = reach(s.x, s.z) && !w.blocked(s.x, s.z, 0.38, 0);
}
const needDm = dm ? 8 : 3;   // 3-player deathmatch on wingman maps, up to 4 on deathmatch maps
checks[`at least ${needDm} deathmatch spawns (${w.spawns.dm.length})`] = w.spawns.dm.length >= needDm;
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? 'OK  ' : 'FAIL'} reachable: ${k}`); ok = ok && v; }
console.log(`walkable surface cells: ${seen.size}, props: ${w.props.length}, spans: ${w.spans.reduce((a, s) => a + s.length, 0)}`);
if (out) {
  const S = 4, W = w.w * S, H = w.h * S, px = Buffer.alloc(W * H * 3);
  const col = { 0: [226, 214, 186], 1: [150, 175, 120], 2: [70, 62, 55], 3: [170, 125, 70], 4: [210, 120, 70] };
  for (let iz = 0; iz < w.h; iz++) for (let ix = 0; ix < w.w; ix++) {
    let c = col[w.cellKind(ix, iz)];
    const site = w.siteAt((ix + .5) * CELL, (iz + .5) * CELL);
    if (site && w.cellKind(ix, iz) === 0) c = [235, 150, 140];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const o = ((iz * S + j) * W + ix * S + i) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; }
  }
  for (const t of ['atk', 'def', 'dm']) for (const s of w.spawns[t]) {
    const c = t === 'atk' ? [240, 150, 30] : t === 'def' ? [60, 120, 230] : [200, 40, 200];
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { const o = ((Math.floor(s.z / CELL * S) + j) * W + Math.floor(s.x / CELL * S) + i) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; }
  }
  writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), px]));
}
process.exit(ok ? 0 : 1);
