// Checks Level 1 (the garage): from the start a player can walk to the fuse box, the crank, the lift (with the
// shutter up), every side room and every battery, on both floors, and the shapeshifter's walking grid joins both
// floors by the ramps and by the stairs. Usage: node check_gar.mjs [map]   (map: print both floors)
import { resolveMap } from './maps.js';
import { World, CELL, STEP } from './world.js';
import { NavGrid } from './bots.js';
import { GAR, floorY } from './garmap.js';

let bad = 0;
const fail = (t) => { bad++; console.log('  FAIL', t); };
for (const level of ['easy', 'normal', 'hard']) {
  const w = new World(resolveMap('garage', level)), plan = w.def.gar;
  w.doors.forEach((d, i) => w.setDoor(i, true));               // doors open (the shutter up): can everything be reached?
  const nav = new NavGrid(w);
  const node = (p, y = p.y) => nav.nearest(p.x, y, p.z);
  const start = node(plan.start);
  if (start < 0 || Math.abs(nav.y[start] - GAR.FL) > 0.1) fail('the start is not on the upper floor');
  // every node you can walk to from the start (walking only: no dropping off ledges)
  const flood = (from, block = null) => {
    const seen = new Uint8Array(nav.n), q = [from];
    seen[from] = 1;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], e = nav.edges[i];
      for (let j = 0; j < e.length; j += 2) {
        const t = e[j];
        if (seen[t] || Math.abs(nav.y[t] - nav.y[i]) > STEP + 0.01 || (block && block(t))) continue;
        seen[t] = 1; q.push(t);
      }
    }
    return seen;
  };
  const seen = flood(start);
  const reach = (name, p, y = p.y) => { const i = node(p, y); if (i < 0 || !seen[i] || Math.hypot(nav.x[i] - p.x, nav.z[i] - p.z) > 1.6 || Math.abs(nav.y[i] - y) > 0.3) fail(`cannot walk to ${name} (${p.x}, ${y}, ${p.z})`); };
  reach('the fuse box', { x: plan.fuse.x, z: plan.fuse.z + 0.8 }, plan.fuse.y);
  reach('the crank', { x: plan.crank.x, z: plan.crank.z + 0.8 }, plan.crank.y);
  reach('the lift', { x: (plan.lift.x0 + plan.lift.x1) / 2, z: (plan.lift.z0 + plan.lift.z1) / 2 }, plan.lift.y);
  reach('the monster start', plan.monster);
  plan.rooms.forEach((r, i) => reach(`side room ${i} (${r.name})`, { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }, floorY(r.floor)));
  plan.batteries.forEach((b, i) => reach(`battery ${i}`, b));
  plan.bays.forEach((b, i) => { if (b.car == null) reach(`empty bay ${i}`, { x: b.x, z: (b.z0 + b.z1) / 2 }, floorY(b.f)); });
  // both floors are joined by the ramps alone, and by the stairs alone
  const inAny = (list) => (t) => list.some(r => nav.x[t] > r.x0 && nav.x[t] < r.x1 && nav.z[t] > r.z0 && nav.z[t] < r.z1);
  const lower = node({ x: 30, z: 26 }, 0);
  if (!flood(start, inAny(plan.stairs))[lower]) fail('the ramps alone do not join the floors');
  if (!flood(start, inAny(plan.ramps))[lower]) fail('the stairs alone do not join the floors');
  for (const r of [...plan.ramps, ...plan.stairs]) {
    const mid = nav.nearest((r.x0 + r.x1) / 2, GAR.FL / 2, (r.z0 + r.z1) / 2);
    if (mid < 0 || !seen[mid]) fail(`nobody can walk on the ${r.land ? 'stairs' : 'ramp'} at ${r.x0}, ${r.z0}`);
  }
  // with the shutter down, the lift is shut off
  const sh = w.doors.findIndex(d => d.lock === 'shutter');
  w.setDoor(sh, false);
  const nav2 = new NavGrid(w), s2 = nav2.nearest(plan.start.x, plan.start.y, plan.start.z);
  const q = [s2], sn = new Uint8Array(nav2.n); sn[s2] = 1;
  for (let k = 0; k < q.length; k++) { const e = nav2.edges[q[k]]; for (let j = 0; j < e.length; j += 2) if (!sn[e[j]]) { sn[e[j]] = 1; q.push(e[j]); } }
  const li = nav2.nearest(3, GAR.FL, 3);
  if (li >= 0 && sn[li]) fail('the lift can be reached with the shutter down');
  // the monster's routes: a path from its start to the players' start and to both ends of the map on both floors
  const m = node(plan.monster);
  for (const [x, y, z] of [[plan.start.x, GAR.FL, plan.start.z], [60, 0, 5], [5, GAR.FL, 45], [30, GAR.FL, 9]]) {
    if (!nav.path(m, nav.nearest(x, y, z), nav.n * 2)) fail(`no route for the monster to ${x}, ${y}, ${z}`);
  }
  const area = (GAR.size[0] - 2) * (GAR.size[1] - 2) * 2;
  console.log(`${level}: ${nav.n} walking spots, ${plan.cars.length} cars, ${plan.bays.length} bays, ${plan.rooms.length} side rooms, ${plan.batteries.length} batteries, ${area} m² on two floors`);
  if (process.argv[2] === 'map' && level === 'easy') {
    for (const f of [1, 0]) {
      console.log(f ? '--- upper floor (P1) ---' : '--- lower floor (P2) ---');
      const y = floorY(f);
      for (let iz = 0; iz < w.h; iz += 2) {
        let row = '';
        for (let ix = 0; ix < w.w; ix++) {
          const sp = w.cellSpans(ix, iz), x = (ix + 0.5) * CELL, z = (iz + 0.5) * CELL;
          const solid = sp.some(s => s.y0 < y + 1.2 && s.y1 > y + 1.7), low = sp.some(s => s.y0 < y + 1.2 && s.y1 > y + 0.5);
          const hole = f && !sp.some(s => Math.abs(s.y1 - y) < 0.01) && !solid;
          row += solid ? '#' : hole ? '/' : low ? 'c' : f === 0 && w.waterAt(x, z) ? '~' : nav.standable(x, y, z) ? '.' : ' ';
        }
        console.log(row);
      }
    }
  }
}
console.log(bad ? `${bad} problem(s)` : 'Level 1 garage: all checks passed');
process.exit(bad ? 1 : 0);
