// Checks Backrooms mazes: for many random seeds, a player can always walk from the start to the
// exit without falling down a pit, and the monster can always reach the players — even with every
// door shut (it can't open doors) — and the exit room's walls touch no other wall (so following
// one wall, always left or always right, never finds the exit).
// Usage: node check_br.mjs [how many seeds = 40] [print one seed's map] [easy|normal|hard = all three]
import { resolveMap } from './maps.js';
import { World, CELL } from './world.js';
import { NavGrid } from './bots.js';
import { BR } from './brmap.js';

const runs = Number(process.argv[2]) || 40, show = Number(process.argv[3]) || 0, onlyLevel = process.argv[4];
let bad = 0;
for (let k = 0; k < runs; k++) {
  const seed = show || 1000 + k * 7919;
  const level = onlyLevel || ['easy', 'normal', 'hard'][k % 3];
  const t0 = Date.now();
  const w = new World(resolveMap('backrooms', `${seed}:${level}`));
  const ms = Date.now() - t0;
  // player walk check: a 0.72 m wide player, standing on the floor (its middle never over a pit)
  const free = (ix, iz) => !w.cellSpans(ix, iz).some(s => s.y0 < 1.8 && s.y1 > 0.42);
  const fits = (ix, iz) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!free(ix + dx, iz + dz)) return false; return !w.pitCell(ix, iz); };
  const s = w.spawns.atk[0], e = w.exit, plan = w.def.br;
  const start = [Math.floor(s.x / CELL), Math.floor(s.z / CELL)];
  const goal = [Math.floor((e.x + e.nx * 0.8) / CELL), Math.floor((e.z + e.nz * 0.8) / CELL)];
  // where a player can walk to from the start (block: cells they may not step on)
  const flood = (block) => {
    const seen = new Uint8Array(w.w * w.h), q = [start];
    seen[start[1] * w.w + start[0]] = 1;
    for (let k = 0; k < q.length; k++) {
      const [ix, iz] = q[k];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ix + dx, nz = iz + dz, i = nz * w.w + nx;
        if (nx < 0 || nz < 0 || nx >= w.w || nz >= w.h || seen[i] || !fits(nx, nz) || (block && block(nx, nz))) continue;
        seen[i] = 1; q.push([nx, nz]);
      }
    }
    return seen;
  };
  const near = (seen, cx, cz) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (seen[(cz + dz) * w.w + cx + dx]) return true; return false; };
  const mid = (x, z) => [Math.floor((BR.border + x * BR.cell + 2.25) / CELL), Math.floor((BR.border + z * BR.cell + 2.25) / CELL)];       // the middle of room (x, z)
  // every ordinary door shut (the monster can't open doors) and the gates open: everything must still be reachable
  w.doors.forEach((d, i) => w.setDoor(i, !!d.lock));
  const found = near(flood(), goal[0], goal[1]);
  // THE ORDER (owner's design): heavy door -> key -> locked door -> the big pit room -> the lever room -> exit.
  // With a gate shut, nothing that comes after it may be reachable.
  const order = [];
  const gate = (lock) => w.doors.findIndex(d => d.lock === lock);
  const withShut = (lock) => { const i = gate(lock); w.setDoor(i, false); const seen = flood(); w.setDoor(i, true); return seen; };
  const keyAt = mid(plan.key.x, plan.key.z), leverAt = mid(plan.switches[0].x, plan.switches[0].z);
  const redSide = mid(...plan.locked.find(g => g.lock === 'red').to), bigMid = mid(plan.big.x + (plan.big.w >> 1), plan.big.z + (plan.big.d >> 1));
  if (gate('heavy') < 0 || gate('red') < 0 || gate('twin') < 0) order.push('a gate is missing');
  else {
    const all = flood();
    if (!near(all, ...keyAt) || !near(all, ...leverAt) || !near(all, ...redSide)) order.push('key / levers not reachable with the gates open');
    if (near(withShut('heavy'), ...keyAt)) order.push('key reachable without the heavy door');
    if (near(withShut('red'), ...redSide) || near(withShut('red'), ...leverAt)) order.push('past the locked door without the key');
    if (near(withShut('twin'), goal[0], goal[1])) order.push('exit reachable without the levers');
    // the levers can't be reached without crossing the big pit room
    const b = plan.big, inBig = (ix, iz) => { const x = ((ix + 0.5) * CELL - BR.border) / BR.cell, z = ((iz + 0.5) * CELL - BR.border) / BR.cell; return x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d; };
    if (near(flood(inBig), ...leverAt)) order.push('lever room reachable without crossing the big pit room');
    if (plan.switches[0].x !== plan.switches[1].x || plan.switches[0].z !== plan.switches[1].z) order.push('levers not in one room');
    void bigMid;
  }
  w.doors.forEach((d, i) => w.setDoor(i, false));
  // monster: its walking grid reaches the start from its own room
  w.doors.forEach((d, i) => w.setDoor(i, true));          // (its walking grid is made with them open…)
  const nav = new NavGrid(w);
  w.doors.forEach((d, i) => w.setDoor(i, false));         // (…and it steers round the shut ones)
  const doorCell = new Set(w.doors.filter(d => !d.lock).flatMap(d => d.cells));      // (the gates count as open: the players open them, and they stay open)
  const m = w.spawns.def[0];
  const path = nav.path(nav.nearest(m.x, 0, m.z), nav.nearest(s.x, 0, s.z), nav.n * 2, j => doorCell.has(Math.floor(nav.z[j] / CELL) * w.w + Math.floor(nav.x[j] / CELL)));
  const spawnsOk = w.spawns.atk.every(p => !w.isPit(p.x, p.z) && fits(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  // the exit's walls must touch no other wall (8-way, every door shut), or keeping a hand on the wall would lead there
  const solid = (ix, iz) => ix < 0 || iz < 0 || ix >= w.w || iz >= w.h || !free(ix, iz);
  const outer = new Uint8Array(w.w * w.h), sq = [[0, 0]];
  outer[0] = 1;
  for (let i = 0; i < sq.length; i++) {
    const [ix, iz] = sq[i];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = ix + dx, nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= w.w || nz >= w.h || outer[nz * w.w + nx] || !solid(nx, nz)) continue;
      outer[nz * w.w + nx] = 1; sq.push([nx, nz]);
    }
  }
  const behind = [Math.floor((e.x - e.nx * 0.25) / CELL), Math.floor((e.z - e.nz * 0.25) / CELL)];
  const island = solid(behind[0], behind[1]) && !outer[behind[1] * w.w + behind[0]];
  const ok = found && !!path && spawnsOk && island && !order.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} seed ${seed} ${level}: exit ${found ? 'reachable' : 'NOT reachable'}, monster ${path ? `path ${path.length} steps` : 'NO path'}, spawns ${spawnsOk ? 'ok' : 'BAD'}, order ${order.length ? 'WRONG (' + order.join('; ') + ')' : 'ok'}, exit ${island ? 'on an island' : 'TOUCHES THE OTHER WALLS'}, doors ${w.doors.length} (all shut), pits ${w.pits.length}, built in ${ms} ms`);
  if (show) {
    // a rough picture: # wall, o pillar, . floor, _ pit, S start, E exit, M monster
    const rows = [];
    for (let iz = 0; iz < w.h; iz += 2) {
      let row = '';
      for (let ix = 0; ix < w.w; ix += 2) {
        const x = (ix + 1) * CELL, z = (iz + 1) * CELL;
        const sp = w.cellSpans(ix, iz).find(o => o.y0 < 1);
        row += Math.hypot(x - s.x, z - s.z) < 1.2 ? 'S' : Math.hypot(x - e.x, z - e.z) < 1.2 ? 'E' : Math.hypot(x - m.x, z - m.z) < 1.2 ? 'M'
          : w.pitCell(ix, iz) ? '_' : !sp ? '.' : sp.m === 'pillar' ? 'o' : '#';
      }
      rows.push(row);
    }
    console.log(rows.join('\n'));
    break;
  }
}
console.log(bad ? `${bad} of ${runs} mazes have a problem` : `all ${show ? 1 : runs} mazes OK`);
process.exit(bad ? 1 : 0);
