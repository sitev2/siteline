// Checks Level 2 (the Poolrooms) with no graphics: walks and swims the map the way a player does (steps up to
// 0.42 m, swimming in deep water, climbing out only at ladders and steps) and proves that
//   - the start is in the hallway, and every room on the start side can be reached from it;
//   - nobody can get stuck: from everywhere you can reach there is a way back to the start;
//   - the far side (atrium, slide hall, stairs, upstairs) needs the bridge, and with it all of it can be reached;
//   - the grotto can only be reached by the green slide, and you can get out of it again;
//   - no pillar stands in the water, every ladder works, the curved stair reaches the upper floor;
//   - the way out is shut while the Great Pool is full and open once it is drained.
// Usage: node check_pool.mjs [map]      (map: print both floors)
import { resolveMap } from './maps.js';
import { World, CELL, STEP, PLAYER_RADIUS } from './world.js';
import { POOL } from './poolmap.js';

const { G, U, WY } = POOL;
let bad = 0;
const fail = (t) => { bad++; console.log('  FAIL', t); };
const R = PLAYER_RADIUS;

// where a player's feet end up at (x, z) coming from height y: on the floor, or floating in deep water
function feet(w, x, z, y) {
  const g = w.groundAt(x, z, R, y, STEP), b = w.bodyAt(x, z);
  if (b && b.y - g > POOL.deep) return { y: Math.max(g, b.y - POOL.swim), swim: b.y - POOL.swim > g };
  return { y: g, swim: false };
}

// every spot that can be reached from `from`, and the steps between them (for the way-back check)
function explore(w, from, opt = {}) {
  const plan = w.def.pool;
  const key = (ix, iz, y) => `${ix},${iz},${Math.round(y * 10)}`;
  const nodes = new Map(), list = [];
  const add = (ix, iz, y, swim) => {
    const k = key(ix, iz, y);
    let n = nodes.get(k);
    if (!n) { n = { ix, iz, x: (ix + 0.5) * CELL, z: (iz + 0.5) * CELL, y, swim, out: [], id: list.length }; nodes.set(k, n); list.push(n); }
    return n;
  };
  const at = (x, z, y) => { const f = feet(w, x, z, y); return add(Math.floor(x / CELL), Math.floor(z / CELL), f.y, f.swim); };
  const start = at(from.x, from.z, from.y + 0.05);
  const done = new Set();
  const q = [start];
  const ladders = [...plan.ladders, plan.exit.ladder];
  while (q.length) {
    const n = q.pop();
    if (done.has(n.id)) continue;
    done.add(n.id);
    const go = (m) => { n.out.push(m.id); if (!done.has(m.id)) q.push(m); };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = n.x + dx * CELL, z = n.z + dz * CELL;
      if (w.blocked(x, z, R, n.y, STEP)) continue;
      const f = feet(w, x, z, n.y);
      const drop = n.y - f.y;
      // walking off an edge: fine into water or down a small drop; a long fall onto hard floor is not a way
      if (drop > STEP + 0.01 && !f.swim && (opt.noDrops || drop > 6)) continue;
      go(add(n.ix + dx, n.iz + dz, f.y, f.swim));
    }
    // ladders: from the water (or a drained pool's floor) at its foot up onto the deck, and back down
    for (const L of ladders) {
      const fx = L.x - L.nx * 0.45, fz = L.z - L.nz * 0.45, tx = L.x + L.nx * 0.6, tz = L.z + L.nz * 0.6;
      if (L.wall) {                                                  // the exit ladder: up the shaft to the hatch
        if (Math.hypot(n.x - fx, n.z - fz) < 0.9 && n.y < L.bottom + 0.5) go(add(-1, -1, L.top, false));
        continue;
      }
      const low = n.swim || n.y < L.top - 1;
      if (low && Math.hypot(n.x - fx, n.z - fz) < 0.9 && n.y >= L.bottom - 0.3) go(at(tx, tz, L.top + 0.05));
      else if (!low && Math.abs(n.y - L.top) < 0.1 && Math.hypot(n.x - tx, n.z - tz) < 0.9) go(at(fx, fz, Math.max(L.bottom, n.y - 1.6)));
    }
  }
  return { nodes, list, start, has: (x, y, z, tol = 0.75) => list.some(n => Math.hypot(n.x - x, n.z - z) < tol && Math.abs(n.y - y) < 0.35) };
}
// which of the reached spots have a way back to the start
function wayBack(ex) {
  const back = ex.list.map(() => []);
  for (const n of ex.list) for (const t of n.out) back[t].push(n.id);
  const ok = new Uint8Array(ex.list.length), q = [ex.start.id];
  ok[ex.start.id] = 1;
  while (q.length) { const i = q.pop(); for (const j of back[i]) if (!ok[j]) { ok[j] = 1; q.push(j); } }
  return ok;
}
// stage 2 raises the bridges with pressure plates; here they are simply put up
function raise(w, br) {
  for (let iz = Math.round(br.z0 / CELL); iz < Math.round(br.z1 / CELL); iz++) for (let ix = Math.round(br.x0 / CELL); ix < Math.round(br.x1 / CELL); ix++) {
    const l = w.spans[iz * w.w + ix]; l.push({ y0: G - 0.3, y1: G, m: '_bridge', pen: false, prop: -1 }); l.sort((a, b) => a.y0 - b.y0);
  }
}

for (const level of ['easy', 'normal', 'hard']) {
  const w = new World(resolveMap('pool', level)), plan = w.def.pool;
  const S = plan.start;
  // ---- 1: the start side, no bridge ----
  const a = explore(w, S);
  if (Math.abs(a.start.y - G) > 0.01) fail('the start is not on the dry ground floor');
  const west = { 'the kidney hall': [22, G, 39], 'the lane hall': [7.5, G, 30], 'the flooded hall': [22, POOL.SH, 10], 'the west tunnel': [15.25, POOL.SH, 24], 'the east tunnel': [28.75, POOL.SH, 24],
    'the long flooded corridor': [22, POOL.SH, 24], 'a dark dead end': [36, POOL.SH, 10], 'the channel (swimming)': [38, WY - POOL.swim, 30], 'the lane pool (swimming)': [4, WY - POOL.swim, 30],
    'the south-west kidney pool (swimming)': [18, WY - POOL.swim, 43], 'the east kidney pool (swimming)': [29, WY - POOL.swim, 37], 'the bean pool (swimming)': [18.5, WY - POOL.swim, 31.8] };
  for (const [name, [x, y, z]] of Object.entries(west)) if (!a.has(x, y, z)) fail(`${level}: cannot get to ${name} from the start`);
  const east = { 'the atrium': [43.5, G, 33], 'the slide hall': [42.2, G, 18.5], "the stair tower's lobby": [55.5, G, 18], 'the upper floor': [48.5, U, 12], 'the grotto': [60.5, G, 34], 'the apse': [5.5, G, 5.5] };
  for (const [name, [x, y, z]] of Object.entries(east)) if (a.has(x, y, z, 1.5)) fail(`${level}: ${name} can be reached without a bridge or a slide`);
  const okA = wayBack(a);
  const stuck = a.list.filter(n => !okA[n.id]);
  if (stuck.length) fail(`${level}: ${stuck.length} spots on the start side have no way back, e.g. ${stuck.slice(0, 3).map(n => `${n.x}, ${n.y.toFixed(2)}, ${n.z}`).join(' | ')}`);
  // ---- 2: with both bridges up ----
  for (const br of plan.bridges) raise(w, br);
  const b = explore(w, S);
  const all = { ...west, 'the atrium': [43.5, G, 33], 'the slide hall': [42.2, G, 18.5], "the stair tower's lobby": [55.5, G, 18], 'the Great Pool (swimming)': [52, WY - POOL.swim, 33], 'the plunge pool (swimming)': [45, WY - POOL.swim, 13],
    'the apse': [5.5, G, 5.5], 'the top of the stairs': [51.2, U, 10.5], 'the corridor upstairs': [48.5, U, 12], 'the slide platform': [44.2, U, 5], 'the narrow walk': [44, U, 20.25], 'the west gallery': [37, U, 33],
    'the south gallery': [50, U, 45.5], 'the east gallery': [60.5, U, 34], 'the north gallery': [56, U, 18.8] };
  for (const [name, [x, y, z]] of Object.entries(all)) if (!b.has(x, y, z)) fail(`${level}: cannot get to ${name} with the bridges up`);
  for (const s of plan.slides) if (!b.has(s.mouth.x, U, s.mouth.z + 0.7, 0.9)) fail(`${level}: cannot stand at the ${s.name} slide's mouth`);
  for (const v of plan.valves.slice(0, 2)) if (!b.has(v.x + v.nx * 0.7, v.y, v.z + v.nz * 0.7, 0.9)) fail(`${level}: cannot stand at the valve at ${v.x}, ${v.z}`);
  if (!b.has(plan.drain.x + plan.drain.nx * 0.7, G, plan.drain.z, 0.9)) fail(`${level}: cannot stand at the drain wheel`);
  if (b.has(60.5, G, 34, 1.5)) fail(`${level}: the grotto can be reached without the green slide`);
  if (b.list.some(n => n.ix === -1)) fail(`${level}: the exit ladder can be reached while the Great Pool is full`);
  const okB = wayBack(b);
  const stuckB = b.list.filter(n => !okB[n.id]);
  if (stuckB.length) fail(`${level}: ${stuckB.length} spots have no way back with the bridges up, e.g. ${stuckB.slice(0, 3).map(n => `${n.x}, ${n.y.toFixed(2)}, ${n.z}`).join(' | ')}`);
  // every plate can be stood on, every ladder's top and foot are used
  for (const br of plan.bridges) for (const p of br.plates) if (!b.has(p.x, G, p.z)) fail(`${level}: cannot stand on the ${br.name} bridge's plate at ${p.x}, ${p.z}`);
  plan.ladders.forEach((L, i) => {
    if (!b.has(L.x + L.nx * 0.6, L.top, L.z + L.nz * 0.6, 0.8)) fail(`${level}: ladder ${i} has no deck at its top (${L.x.toFixed(1)}, ${L.z.toFixed(1)})`);
    if (!b.has(L.x - L.nx * 0.45, WY - POOL.swim, L.z - L.nz * 0.45, 0.8)) fail(`${level}: ladder ${i} has no water at its foot (${L.x.toFixed(1)}, ${L.z.toFixed(1)})`);
  });
  // ---- 3: the grotto (from the green slide): the valve, and a way out through the Great Pool ----
  const gs = plan.slides[2].out;
  const c = explore(w, { x: gs.x, y: G, z: gs.z + 2.5 });
  if (!c.has(60.5, G, 34)) fail(`${level}: the green slide does not let you out in the grotto`);
  const v3 = plan.valves[2];
  if (!c.has(v3.x + v3.nx * 0.7, G, v3.z, 0.9)) fail(`${level}: cannot stand at the grotto's valve`);
  if (!c.has(43.5, G, 33)) fail(`${level}: no way out of the grotto`);
  // the other two slides let you out over deep water
  for (const s of plan.slides.slice(0, 2)) { const bd = w.bodyAt(s.out.x + s.out.nx * 2.6, s.out.z + s.out.nz * 2.6); if (!bd || bd.y - bd.bottom < POOL.deep) fail(`${level}: the ${s.name} slide does not end over deep water`); }
  // ---- 4: no pillar in the water; drains on dry floor ----
  for (const p of plan.pillars) {
    if (p.y0 !== G) continue;
    for (const pl of plan.pools) if (pl.sdf(p.x, p.z) < p.r + 0.3) fail(`${level}: the pillar at ${p.x}, ${p.z} stands in the ${pl.name} pool`);
    if (![0, 1, 2, 3, 4, 5, 6, 7].some(k => b.has(p.x + Math.cos(k * 0.785) * (p.r + 0.5), G, p.z + Math.sin(k * 0.785) * (p.r + 0.5), 0.5))) fail(`${level}: the pillar at ${p.x}, ${p.z} is an island`);
  }
  for (const d of plan.drains) if (!b.has(d.x, d.y, d.z, 0.6) && !c.has(d.x, d.y, d.z, 0.6)) fail(`${level}: the floor drain at ${d.x}, ${d.z} is not on dry floor you can reach`);
  // ---- 5: the Great Pool drained: down its ladder, through the tunnel, up the exit ladder ----
  const great = w.bodies.find(o => o.name === 'great');
  great.y = great.bottom;
  const d = explore(w, S);
  if (!d.has(52, 0, 33)) fail(`${level}: the drained pool's floor cannot be reached`);
  if (!d.has(52, 0, 45.5, 1)) fail(`${level}: the tunnel to the exit ladder cannot be reached once the pool is drained`);
  if (!d.list.some(n => n.ix === -1)) fail(`${level}: the exit ladder cannot be climbed once the pool is drained`);
  const dry = b.list.filter(n => !n.swim).length, wet = b.list.filter(n => n.swim).length;
  console.log(`${level}: ${b.list.length} spots (${dry} walking, ${wet} swimming) = about ${Math.round(b.list.length * 0.25)} m²; ${plan.pools.length} pools, ${plan.pillars.length} round pillars, ${plan.ladders.length} ladders, ${plan.skylights.length} skylights`);
  if (process.argv[2] === 'map' && level === 'easy') {
    great.y = WY;
    for (const [name, y] of [['upper floor', U], ['ground floor', G]]) {
      console.log(`--- ${name} ---  # wall  . dry floor  , flooded (knee-deep)  ~ deep water  o pillar  / open drop  = stairs`);
      for (let iz = 0; iz < w.h; iz += 2) {
        let row = '';
        for (let ix = 0; ix < w.w; ix++) {
          const sp = w.cellSpans(ix, iz), x = (ix + 0.5) * CELL, z = (iz + 0.5) * CELL;
          const solid = sp.some(s => s.y0 < y + 1.2 && s.y1 > y + 1.7) || w.solid(x, z, 0.05, y, 0.4, 1.8);
          const pil = plan.pillars.some(p => Math.hypot(p.x - x, p.z - z) < p.r && y >= p.y0 - 0.6 && y < p.y1);
          const top = sp.filter(s => s.y1 <= y + 0.45).reduce((m, s) => Math.max(m, s.y1), 0);
          const bd = w.bodyAt(x, z);
          const stair = sp.some(s => s.m === '_rstair' || s.m === 'pstep');
          row += pil ? 'o' : solid ? '#' : y === G && bd && bd.y - top > POOL.deep ? '~' : y === G && bd ? ',' : stair && y === G ? '=' : top < y - 0.6 ? (y === U ? '/' : ' ') : '.';
        }
        console.log(row);
      }
    }
  }
}
console.log(bad ? `${bad} problem(s)` : 'Level 2 Poolrooms: all checks passed');
process.exit(bad ? 1 : 0);
