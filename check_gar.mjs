// Checks Level 1 (the garage): from the start a player can walk to the fuse box, the crank, the lift (with the
// shutter up), every side room, on both floors; with every ordinary door shut the fuse box, the crank and the door of
// every side room can still be walked to, and every fuse spot in every room (a fuse can be in any 4 of the 7) is in
// reach from inside its room once its door is open; the creature's walking grid joins both floors by the ramps and by
// the stairs. Usage: node check_gar.mjs [map]   (map: print both floors)
import { resolveMap } from './maps.js';
import { World, CELL, STEP } from './world.js';
import { NavGrid } from './bots.js';
import { GAR, floorY, FUSES } from './garmap.js';

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
  // ---- the fuses: with every ordinary door shut, the fuse box, the crank and every side room's door can be walked to;
  // with a room's door open, each of its fuse spots is in reach (the host takes a fuse from 2 m, the hand button
  // shows from 1.5 m) from somewhere inside it ----
  if (plan.rooms.length < FUSES) fail('fewer side rooms than fuses');
  {
    const w2 = new World(resolveMap('garage', level));
    w2.doors.forEach((d, i) => w2.setDoor(i, !!d.lock && d.lock !== 'shutter' ? d.open : false));
    const shut = new NavGrid(w2);
    const flood2 = (nv, from) => { const sn = new Uint8Array(nv.n), q = [from]; sn[from] = 1; for (let k = 0; k < q.length; k++) { const e = nv.edges[q[k]]; for (let j = 0; j < e.length; j += 2) if (!sn[e[j]] && Math.abs(nv.y[e[j]] - nv.y[q[k]]) <= STEP + 0.01) { sn[e[j]] = 1; q.push(e[j]); } } return sn; };
    const sn = flood2(shut, shut.nearest(plan.start.x, plan.start.y, plan.start.z));
    const can = (name, x, y, z) => { const i = shut.nearest(x, y, z); if (i < 0 || !sn[i] || Math.hypot(shut.x[i] - x, shut.z[i] - z) > 1.6 || Math.abs(shut.y[i] - y) > 0.3) fail(`with the doors shut, cannot walk to ${name}`); };
    can('the fuse box', plan.fuse.x, plan.fuse.y, plan.fuse.z + 0.8);
    can('the crank', plan.crank.x, plan.crank.y, plan.crank.z + 0.8);
    plan.rooms.forEach((r, k) => {
      const d = w2.doors.find(dd => dd.room === k), y = floorY(r.floor);
      if (!d) { fail(`side room ${k} has no door`); return; }
      const s = Math.sign((d.cx - (r.x0 + r.x1) / 2) * d.nx + (d.cz - (r.z0 + r.z1) / 2) * d.nz) || 1;
      can(`the door of side room ${k}`, d.cx + d.nx * s * 0.9, y, d.cz + d.nz * s * 0.9);
      // that door open: every spot in the room in reach from inside it
      const w3 = new World(resolveMap('garage', level));
      w3.doors.forEach((dd, i) => w3.setDoor(i, dd.room === k));
      const nv = new NavGrid(w3), s3 = flood2(nv, nv.nearest(plan.start.x, plan.start.y, plan.start.z));
      if (!r.spots || !r.spots.length) fail(`side room ${k} has no fuse spot`);
      for (const S of r.spots || []) {
        let best = Infinity;
        for (let i = 0; i < nv.n; i++) {
          if (!s3[i] || Math.abs(nv.y[i] - y) > 0.3 || nv.x[i] < r.x0 || nv.x[i] > r.x1 || nv.z[i] < r.z0 || nv.z[i] > r.z1) continue;
          best = Math.min(best, Math.hypot(nv.x[i] - S.x, nv.z[i] - S.z));
        }
        if (!(best < 1.2)) fail(`side room ${k}: the fuse spot at ${S.x}, ${S.z} (${S.on}) is out of reach (${best.toFixed(2)} m)`);
        if (S.y < 0.3 || S.y > 1.8) fail(`side room ${k}: a fuse spot at an odd height (${S.y} m)`);
        if (!(r.furn || []).some(f => S.x >= f.x0 - 0.06 && S.x <= f.x1 + 0.06 && S.z >= f.z0 - 0.06 && S.z <= f.z1 + 0.06)) fail(`side room ${k}: a fuse spot not on any furniture`);
      }
    });
  }
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
  console.log(`${level}: ${nav.n} walking spots, ${plan.cars.length} cars, ${plan.bays.length} bays, ${plan.rooms.length} side rooms, ${area} m² on two floors`);
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
