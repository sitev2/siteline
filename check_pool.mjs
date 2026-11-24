// Checks Level 2 (the Poolrooms) with no graphics: walks and swims the map the way a player does (steps up to
// 0.42 m, swimming in deep water, climbing out at ladders, steps and over the edges where allowed) and proves that
//   - the start is in the hallway, and every room on the start side can be reached from it;
//   - nobody can get stuck: from everywhere you can reach there is a way back to the start;
//   - the far side (atrium, slide hall, stairs, upstairs) needs the bridge, and with it all of it can be reached;
//   - the grotto can only be reached by the green slide, and you can get out of it again;
//   - no pillar stands in the water, every ladder works, the curved stair reaches the upper floor;
//   - the way out is shut while the Great Pool is full and open once it is drained.
//   - every slide's tube runs inside solid wall from its mouth to its outlet;
//   - walking or jumping off the edge into the drained Great Pool, all the way round it, never leaves you stuck in its side;
//   - the order, played on the real host code with pretend players (1 and 2 of them, every difficulty): the plates
//     raise the bridge (alone it stays up a while; never onto a swimmer), each valve heats its own lane and can't be
//     turned back, only all three unlock the drain (so the grotto's, only reached by the green slide, is needed), the drain
//     empties the Great Pool for good, the exit ladder takes you out through the hatch; long falls onto a hard floor
//     kill (not into water), everyone dead = the Poolrooms start again; the floaties; the start message.
// Usage: node check_pool.mjs [map]      (map: print both floors)
let simNow = 0;
const realNow = performance.now.bind(performance);
globalThis.performance = { now: () => (globalThis.__sim ? simNow : realNow()) };
globalThis.setInterval = () => 0;
import { resolveMap } from './maps.js';
import { World, CELL, STEP, PLAYER_RADIUS } from './world.js';
import { POOL, POOL_LEVELS, hotLanes, slideCurve, poolUnstickSpot } from './poolmap.js';
import { PLAYER_HEIGHT, GRAVITY } from './world.js';

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
    // out over a pool's edge (game.js poolEdge, the same tests): from deep water, push at the side, onto dry floor
    if (false && n.swim) {   // edge climbing is off (owner's request)
      const wb = w.bodyAt(n.x, n.z), wy = wb ? wb.y : 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707]]) {
        const nx = n.x + dx * (R + 0.22), nz = n.z + dz * (R + 0.22);
        if (w.bodyAt(nx, nz) && !w.blocked(nx, nz, 0.05, n.y, 0.05)) continue;
        for (const d of [0.7, 0.95, 1.2]) {
          const x = n.x + dx * d, z = n.z + dz * d, g = w.groundAt(x, z, R, wy, 0.6), b = w.bodyAt(x, z);
          if (g < wy - 0.05 || g - n.y > 1.7 || (b && b.y > g + 0.05) || w.blocked(x, z, R, g, 0.1) || !plan.climbOK(x, z)) continue;
          go(at(x, z, g + 0.05));
          break;
        }
      }
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

// ---- the slides' tubes: inside solid wall all the way (only their two ends are open) ----
{
  const w = new World(resolveMap('pool', 'normal')), plan = w.def.pool;
  const solidAt = (x, y, z) => w.cellSpans(Math.floor(x / CELL), Math.floor(z / CELL)).some(s => s.y0 <= y && s.y1 >= y);
  for (const sl of plan.slides) {
    const c = slideCurve(sl.path);
    let worst = 0;
    for (let i = 0; i < c.samples.length; i++) {
      if (c.len[i] < 1.9 || c.len[i] > c.total - 2.2) continue;      // (its two open ends)
      const [x, y, z] = c.samples[i], [x2, y2, z2] = c.samples[Math.min(c.samples.length - 1, i + 1)];
      let tx = x2 - x, ty = y2 - y, tz = z2 - z; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // a ring of points round the tube (radius 0.72: the tube is 0.7) must all be inside the wall
      let ax = -tz, az = tx, ay = 0; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      const bx = ty * az - tz * ay, by = tz * ax - tx * az, bz = tx * ay - ty * ax;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, cx = x + (ax * Math.cos(a) + bx * Math.sin(a)) * 0.72, cy = y + (ay * Math.cos(a) + by * Math.sin(a)) * 0.72, cz = z + (az * Math.cos(a) + bz * Math.sin(a)) * 0.72;
        if (!solidAt(cx, cy, cz) || (w.solid && w.solid(cx, cz, 0.01, cy - 0.01, 0, 0.02))) { worst++; if (worst < 3) fail(`the ${sl.name} slide's tube comes out into a room at ${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)}`); } }
    }
    const e = sl.path[sl.path.length - 1], m = sl.path[0];
    if (Math.hypot(m[0] - sl.mouth.x, m[2] - sl.mouth.z) > 0.6) fail(`the ${sl.name} slide's path doesn't start at its mouth`);
    if (Math.hypot(e[0] - (sl.out.x + sl.out.nx * 1.2), e[2] - (sl.out.z + sl.out.nz * 1.2)) > 0.7) fail(`the ${sl.name} slide's path doesn't end at its outlet`);
    console.log(`slide ${sl.name}: ${c.total.toFixed(1)} m of tube, ${(sl.path[0][1] - e[1]).toFixed(1)} m down`);
  }
}

// ---- off the lip into the drained Great Pool (owner: "jumping into the empty pool on the ledge makes you stuck") ----
// The pool's curved side only blocks you below the deck, so a drop right at the edge could leave you inside it. Walk or
// jump in from all round it (walking and sprinting, letting go of the keys after a moment, as players do), moving
// exactly as the game does (World.move, then poolUnstickSpot): you must land on the pool floor free to walk away.
{
  const w = new World(resolveMap('pool', 'normal')), P = w.def.pool, great = w.bodies.find(b => b.name === 'great');
  great.y = great.bottom;
  const gp = P.pools.find(p => p.name === 'great'), JUMP_V = Math.sqrt(2 * GRAVITY * 54 * 0.0254);
  let tries = 0, stuck = 0, eg = '';
  for (let a = 0; a < 360; a += 2) for (const sp of [2.7, 4.5]) for (const jump of [false, true]) for (const let_go of [0.15, 0.3, 0.6]) {
    const cx = 53, cz = 33, ang = a * Math.PI / 180;
    let x = cx + Math.cos(ang) * 12, z = cz + Math.sin(ang) * 12;
    for (let i = 0; i < 40; i++) { const d = gp.sdf(x, z), l = Math.hypot(cx - x, cz - z); x += (cx - x) / l * (d - 0.5); z += (cz - z) / l * (d - 0.5); }
    if (w.blocked(x, z, R, G, 0.1) || w.groundAt(x, z, R, G + 0.1, STEP) < G - 0.01) continue;
    tries++;
    const p = { x, y: G, z }, l = Math.hypot(cx - x, cz - z), v = { x: (cx - x) / l * sp, y: jump ? JUMP_V : 0, z: (cz - z) / l * sp };
    let og = true;
    for (let t = 0; t < 3; t += 1 / 60) {
      if (t > let_go) { v.x = 0; v.z = 0; }
      og = w.move(p, v, 1 / 60, R, og, PLAYER_HEIGHT);
      const s2 = poolUnstickSpot(w, p.x, p.y, p.z, R, PLAYER_HEIGHT); if (s2) { p.x = s2.x; p.z = s2.z; }
    }
    if (p.y > G - 0.5) continue;                     // (never went in)
    let away = 0;
    for (let k = 0; k < 16; k++) { const b = k / 16 * Math.PI * 2, q = { x: p.x, y: p.y, z: p.z }, vv = { x: Math.cos(b) * 2.7, y: 0, z: Math.sin(b) * 2.7 }; let g = true; for (let s3 = 0; s3 < 12; s3++) g = w.move(q, vv, 1 / 60, R, g, PLAYER_HEIGHT); if (Math.hypot(q.x - p.x, q.z - p.z) > 0.2) away++; }
    if (away < 4 || w.blocked(p.x, p.z, R, p.y, STEP, PLAYER_HEIGHT)) { stuck++; if (!eg) eg = `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`; }
  }
  if (stuck) fail(`${stuck} of ${tries} drops into the drained Great Pool left you stuck in its side, e.g. at ${eg}`);
  console.log(`off the lip into the drained Great Pool: ${tries} drops, ${stuck} stuck`);
}

// ---- the order on the real host code ----
globalThis.__sim = true;
const { Server } = await import('./server.js');
// every lane hot needs all three valves (so the grotto's, and with it the green slide, is always on the way)
{
  const good = [];
  for (let m = 0; m < 8; m++) { const o = [!!(m & 1), !!(m & 2), !!(m & 4)]; if (hotLanes(o).every(Boolean)) good.push(o.map(Number).join('')); }
  if (good.join() !== '111') fail(`the lanes are all hot with the valves ${good.join(' / ')} open (should be only all three)`);
}
for (const level of ['easy', 'normal', 'hard']) for (const n of [1, 2]) {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: null });
  S.addPlayer('a', 'Ann'); if (n > 1) S.addPlayer('b', 'Ben');
  S.startBotGame({ kind: 'br', stage: 2, level });
  const H = S.poolHost, plan = S.world.def.pool, a = S.players.get('a'), b = S.players.get('b'), Lv = POOL_LEVELS[level];
  const tag = `${level}, ${n} player${n > 1 ? 's' : ''}`;
  const ok = (c, t) => { if (!c) fail(`${tag}: ${t}`); };
  ok(S.pool && H && a.alive && Math.abs(a.y - G) < 0.01, 'the Poolrooms did not start with the player on the ground floor');
  ok(S.startMsg().pool && S.startMsg().pool.lv === WY, 'the start message does not carry the Poolrooms state');
  const run = (secs, each) => { for (let t = 0; t < secs * 20; t++) { simNow += 50; if (each) each(); S.tick(); } };
  const put = (p, x, y, z) => { p.x = x; p.y = y; p.z = z; };
  const far = (p) => put(p, 55, G, 48.5);
  far(a); if (b) far(b);
  const br = plan.bridges[0], pl = br.plates[0], B = H.bridges[0];
  const solidBridge = () => S.world.cellSpans(Math.floor(38 / CELL), Math.floor(33 / CELL)).some(s => s.m === '_bridge');
  // ---- 1: the bridge ----
  run(1); ok(!B.solid && !solidBridge(), 'the bridge was up before anyone stood on its plate');
  if (b) { put(b, 38, WY - POOL.swim, 33); put(a, pl.x, G, pl.z); run(2.5); ok(!B.solid, 'the bridge came up under someone swimming there'); far(b); run(2); ok(B.solid && solidBridge(), 'the bridge did not come up once the swimmer moved away'); }
  else { put(a, pl.x, G, pl.z); run(2); ok(B.solid && solidBridge(), 'the bridge did not come up'); }
  ok(msgs.some(m => m.t === 'pfx' && m.k === 'plate' && m.on) && msgs.some(m => m.t === 'pfx' && m.k === 'bridge' && m.up), 'no plate clunk or bridge sound was sent');
  // with the bridge up, the far side can be walked to (on the host's own world)
  ok(explore(S.world, { x: pl.x, y: G, z: pl.z }).has(43.5, G, 33), 'the bridge, once up, does not lead to the far side');
  // stepping off: with company it goes down at once; alone it waits a while
  far(a); run(n > 1 ? 1.5 : Lv.hold - 1);
  ok(n > 1 ? !B.solid : B.solid, n > 1 ? 'the bridge stayed up with nobody on the plate (two players)' : 'alone, the bridge went down too soon');
  if (n === 1) { run(3); ok(!B.solid, 'alone, the bridge never went down'); }
  // someone on it when it goes down: into the water (the host just takes it away; their game drops them in)
  // ---- 2: the valves ----
  const hold = (p, k, i, secs) => run(secs, () => S.receive(p.id, k === 'valve' ? { t: 'valve', i } : { t: 'drain' }));
  const stand = (p, v) => put(p, v.x + v.nx * 0.7, v.y, v.z + v.nz * 0.7);
  far(a); hold(a, 'valve', 0, 3); ok(H.valves[0].p === 0, 'a valve turned from far away');
  // the upstairs valve: it opens, heats its own lane (the middle one), and can't be turned back
  stand(a, plan.valves[1]); hold(a, 'valve', 1, Lv.turn + 0.3);
  ok(H.valves[1].open, `the upstairs valve did not open in ${Lv.turn} s`);
  run(4); ok(H.heat.map(h => h > 0.9).join() === 'false,true,false', `opening the upstairs valve heated the lanes ${H.heat.map(r => r.toFixed(1))}`);
  hold(a, 'valve', 1, Lv.turn + 0.3); ok(H.valves[1].open && H.valves[1].p === 1, 'an open valve could be turned back');
  // the drain wheel won't turn yet
  stand(a, plan.drain); hold(a, 'drain', 0, 3); ok(H.drainP === 0 && msgs.some(m => m.t === 'pfx' && m.k === 'stuck'), 'the drain wheel turned while the lanes were cold');
  // half a turn, let go: it stays half open; then the rest
  stand(a, plan.valves[0]); hold(a, 'valve', 0, Lv.turn / 2); run(1); const half = H.valves[0].p;
  ok(half > 0.3 && half < 0.7 && !H.valves[0].open, `half a turn left the valve at ${half}`);
  hold(a, 'valve', 0, Lv.turn / 2 + 0.4); ok(H.valves[0].open, 'the first valve did not open');
  run(4); ok(!H.unlocked, 'two valves unlocked the drain (all three are needed)');
  stand(a, plan.drain); hold(a, 'drain', 0, 2); ok(H.drainP === 0, 'the drain wheel turned with two lanes hot');
  // (the grotto's valve: only reached by the green slide; the explore check above proves that)
  const who = b || a; stand(who, plan.valves[2]); hold(who, 'valve', 2, Lv.turn + 0.3); ok(H.valves[2].open, 'the grotto valve did not open');
  ok(H.valves.every(v => v.open), `the valves are ${H.valves.map(v => v.open)}, wanted all open`);
  run(4); ok(H.unlocked && H.heat.every(h => h > 0.9), 'the three valves did not heat every lane');
  // ---- 3: the drain ----
  stand(a, plan.drain); hold(a, 'drain', 0, Lv.turn * 2.5 + 0.5);
  ok(H.drainAt && msgs.some(m => m.t === 'pfx' && m.k === 'drain'), 'the drain wheel did not open the plug');
  run(5); ok(H.level < WY - 0.5 && H.level > 0.2, `half way through draining the water is at ${H.level}`);
  run(6); ok(H.level === H.great.bottom && S.world.bodyAt(52, 33).y === H.great.bottom, 'the Great Pool did not empty');
  // trying a valve again now changes nothing: it stays open, and drained pools stay empty
  stand(a, plan.valves[0]); hold(a, 'valve', 0, Lv.turn + 0.3); run(5); ok(H.valves[0].open && H.level === H.great.bottom, 'the Great Pool filled up again');
  // the bottom, the tunnel and the exit ladder can now be reached (bridges up)
  for (const q of plan.bridges) { const { setBridge } = await import('./poolmap.js'); setBridge(S.world, q, true); }
  const ex = explore(S.world, plan.start);
  ok(ex.has(52, 0, 45.5, 1) && ex.list.some(q => q.ix === -1), 'after draining, the exit ladder cannot be reached');
  // ---- falls ----
  const fall = (p, from, to, h) => { put(p, from[0], from[1], from[2]); run(1); put(p, to[0], to[1], to[2]); run(0.2); S.receive(p.id, { t: 'fell', h }); };
  if (b) {
    fall(b, [43, U, 21.5], [52, 0, 30], 10);                        // (from the gallery into the drained Great Pool: onto its floor)
    ok(!b.alive, 'a 10 m fall onto the drained pool floor did not kill');
    ok(msgs.some(m => m.t === 'kill' && m.victim === 'b' && m.w === 'poolfall'), 'the fall was not reported as a fall');
  }
  // ---- 4: out through the hatch ----
  const sh = plan.exit.shaft;
  put(a, (sh.x0 + sh.x1) / 2, plan.exit.hatch.out - 0.3, sh.z0 + 0.6); run(0.5); ok(!a.escaped, 'got out below the hatch');
  a.y = plan.exit.hatch.out + 0.05; run(0.3);
  ok(a.escaped && msgs.some(m => m.t === 'escaped' && m.hatch), 'the hatch did not let the player out');
  run(12);
  const over = msgs.find(m => m.t === 'over');
  ok(over && over.winner === 'escaped' && over.map === 'pool', 'no result after the last one out');
}
// ---- falls into water save you; everyone dead = the Poolrooms start again; the floaties ----
{
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: null });
  S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
  S.startBotGame({ kind: 'br', stage: 2, level: 'normal' });
  const H = S.poolHost, a = S.players.get('a'), b = S.players.get('b');
  const run = (secs, each) => { for (let t = 0; t < secs * 20; t++) { simNow += 50; if (each) each(); S.tick(); } };
  const put = (p, x, y, z) => { p.x = x; p.y = y; p.z = z; };
  const ok = (c, t) => { if (!c) fail(`falls / restart / floaties: ${t}`); };
  // into the full Great Pool from the gallery: safe; onto the atrium deck from the gallery: dead
  put(a, 50, U, 45.5); run(1); put(a, 52, WY - POOL.swim, 39); run(0.2); S.receive('a', { t: 'fell', h: 7 }); ok(a.alive, 'a fall into deep water killed');
  put(a, 43, 3, 45); run(5); S.receive('a', { t: 'fell', h: 7 }); ok(a.alive, 'a fall from deck height counted as a long fall');
  // floaties: pick up the yellow one from the water, throw it, it flies and lands somewhere sensible
  const r = H.rings[1];
  put(b, r.x + 3, WY - POOL.swim, r.z); S.receive('b', { t: 'ring' }); ok(!r.holder, 'a floatie was picked up from 3 m away');
  put(b, r.x + 0.6, WY - POOL.swim, r.z); S.receive('b', { t: 'ring' }); ok(r.holder === 'b', 'the floatie could not be picked up');
  run(0.5); ok(Math.hypot(r.x - b.x, r.z - b.z) < 0.01, 'a held floatie does not stay with its holder');
  put(b, 44, G, 18); run(0.2); S.receive('b', { t: 'throw', yaw: Math.PI, pitch: 0.4 });
  ok(r.mode === 'fly' && !r.holder, 'the floatie was not thrown');
  run(6);
  ok(['float', 'rest', 'lost'].includes(r.mode) && [r.x, r.y, r.z].every(Number.isFinite) && r.x > 0 && r.x < 64 && r.z > 0 && r.z < 52, `a thrown floatie ended up ${r.mode} at ${r.x}, ${r.y}, ${r.z}`);
  ok(msgs.some(m => m.t === 'pfx' && (m.k === 'bump' || m.k === 'splash')), 'a thrown floatie made no sound when it landed');
  // floating ones drift but stay in their pool
  const f = H.rings[0], body = S.world.bodyAt(f.x, f.z);
  run(60); ok(f.mode === 'float' && S.world.bodyAt(f.x, f.z) === body, 'the floating floatie drifted out of its pool');
  // a slide: the others are told (and only from the mouth)
  S.receive('a', { t: 'slide', i: 0 }); ok(!msgs.some(m => m.t === 'slide'), 'a slide was started far from its mouth');
  const m0 = S.world.def.pool.slides[0].mouth; put(a, m0.x, U, m0.z + 0.5); S.receive('a', { t: 'slide', i: 0 });
  ok(msgs.some(m => m.t === 'slide' && m.id === 'a' && m.i === 0), 'the others were not told about a slide');
  // everyone dies: the Poolrooms start again (same run: the clock keeps going)
  const t0 = S.timer;
  for (const p of [a, b]) { put(p, 43, U, 21.5); }
  run(1);
  for (const p of [a, b]) { put(p, 43, G, 21.5); run(0.1); S.receive(p.id, { t: 'fell', h: 7 }); }
  ok(!a.alive && !b.alive, 'the falls did not kill');
  run(6);
  ok(S.phase === 'br' && S.pool && a.alive && b.alive && S.poolHost !== H && S.timer >= t0, 'with everyone dead the Poolrooms did not start again');
  ok(!msgs.some(m => m.t === 'over'), 'everyone dying ended the game instead of starting the Poolrooms again');
}
// ---- stage 3: choosing the Poolrooms in the lobby (only a host who has escaped Level 1), a friend joining late
//      only watches, and one whole run: Level 0 → Level 1 → the Poolrooms, ending in "Run complete" ----
for (const l2 of [false, true]) {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: null });
  const ok = (c, t) => { if (!c) fail(`the lobby (host ${l2 ? 'has' : 'hasn\'t'} escaped Level 1): ${t}`); };
  const run = (secs) => { for (let t = 0; t < secs * 20; t++) { simNow += 50; S.tick(); } };
  S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
  S.receive('a', { t: 'settings', mode: 'br', l1: true, l2 });
  S.receive('b', { t: 'settings', l2: true, stage: 2 });                  // (only the host may say so)
  S.receive('a', { t: 'settings', stage: 2 });
  ok((S.settings.stage || 0) === (l2 ? 2 : 0), 'the Poolrooms could be chosen by a host who has not escaped Level 1');
  if (!l2) continue;
  S.receive('a', { t: 'startMatch' });
  ok(S.phase === 'br' && S.pool && S.players.get('a').alive && S.players.get('b').alive, 'the Poolrooms did not start from the lobby');
  run(2);
  S.addPlayer('c', 'Cal');
  run(2);
  ok(!S.players.get('c').alive && msgs.some(m => m.id === 'c' && m.t === 'start'), 'a friend who joined late was put into the Poolrooms (they should watch)');
}
{
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: null });
  const ok = (c, t) => { if (!c) fail(`one whole run: ${t}`); };
  const run = (secs) => { for (let t = 0; t < secs * 20; t++) { simNow += 50; S.tick(); } };
  S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
  S.receive('a', { t: 'settings', mode: 'br', l1: true, l2: false, stage: 0 });
  S.receive('a', { t: 'startMatch' });
  const a = S.players.get('a'), b = S.players.get('b');
  // Level 0: both walk out of the exit
  S.bots.get('monster').update = () => {};
  run(20);
  const e = S.world.exit;
  for (const p of [a, b]) { p.x = e.x + e.nx * 0.3; p.z = e.z + e.nz * 0.3; p.y = 0; }
  run(1); ok(a.escaped && b.escaped, 'nobody got out of Level 0');
  run(8); ok(S.gar && a.alive && b.alive, 'the run did not carry on into Level 1');
  // Level 1: power, the shutter, the lift (the host's own state, quickly)
  S.bots.get('monster').update = () => {};
  run(15);
  S.garSt.power = true; S.garSt.crank = 1; const si = S.world.doors.findIndex(d => d.lock === 'shutter'); S.world.setDoor(si, true);
  for (const p of [a, b]) { p.x = 3; p.y = S.world.def.gar.lift.y; p.z = 3; }
  run(1); ok(a.escaped && b.escaped, 'nobody took the lift out of Level 1');
  run(11);
  ok(S.pool && S.phase === 'br' && a.alive && b.alive && !msgs.some(m => m.t === 'over'), 'escaping Level 1 did not carry straight on into the Poolrooms');
  ok(Math.abs(a.y - G) < 0.01 && S.timer > 30, 'the Poolrooms did not start at their start, or the run\'s clock was reset');
  // the Poolrooms: drained by the host, both climb out through the hatch
  run(25);
  const H = S.poolHost; H.drainAt = performance.now() - 11000; run(1);
  const sh = S.world.def.pool.exit.shaft, h = S.world.def.pool.exit.hatch;
  for (const p of [a, b]) { p.x = (sh.x0 + sh.x1) / 2; p.z = sh.z0 + 0.6; p.y = h.out + 0.05; }
  run(1); ok(a.escaped && b.escaped, 'nobody got out through the hatch');
  run(10);
  const over = msgs.find(m => m.t === 'over');
  ok(over && over.map === 'pool' && over.winner === 'escaped', 'no result at the end of the run');
  ok(over && Array.isArray(over.run) && over.run.map(r => r.level).join() === '0,1,2' && over.run.every(r => r.time > 0), `the run's level times are wrong: ${over && JSON.stringify(over.run)}`);
  if (over && over.run) console.log(`one whole run: ${over.run.map(r => `level ${r.level} ${r.time} s`).join(', ')}`);
}
console.log(bad ? `${bad} problem(s)` : 'Level 2 Poolrooms: all checks passed');
process.exit(bad ? 1 : 0);
