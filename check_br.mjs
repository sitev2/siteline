// Checks Backrooms mazes: for many random seeds, a player can always walk from the start to the
// exit without falling down a pit, and the monster can always reach the players.
// Usage: node check_br.mjs [how many seeds = 40] [print one seed's map]
import { resolveMap } from './maps.js';
import { World, CELL } from './world.js';
import { NavGrid } from './bots.js';

const runs = Number(process.argv[2]) || 40, show = process.argv[3];
let bad = 0;
for (let k = 0; k < runs; k++) {
  const seed = show ? Number(show) : 1000 + k * 7919;
  const t0 = Date.now();
  const w = new World(resolveMap('backrooms', seed));
  const ms = Date.now() - t0;
  // player walk check: a 0.72 m wide player, standing on the floor (its middle never over a pit)
  const free = (ix, iz) => !w.cellSpans(ix, iz).some(s => s.y0 < 1.8 && s.y1 > 0.42);
  const fits = (ix, iz) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!free(ix + dx, iz + dz)) return false; return !w.pitCell(ix, iz); };
  const s = w.spawns.atk[0], e = w.exit;
  const start = [Math.floor(s.x / CELL), Math.floor(s.z / CELL)];
  const goal = [Math.floor((e.x + e.nx * 0.8) / CELL), Math.floor((e.z + e.nz * 0.8) / CELL)];
  const seen = new Uint8Array(w.w * w.h), q = [start];
  seen[start[1] * w.w + start[0]] = 1;
  let found = false;
  while (q.length && !found) {
    const [ix, iz] = q.shift();
    if (Math.abs(ix - goal[0]) <= 1 && Math.abs(iz - goal[1]) <= 1) found = true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx, nz = iz + dz, i = nz * w.w + nx;
      if (nx < 0 || nz < 0 || nx >= w.w || nz >= w.h || seen[i] || !fits(nx, nz)) continue;
      seen[i] = 1; q.push([nx, nz]);
    }
  }
  // monster: its walking grid reaches the start from its own room
  const nav = new NavGrid(w);
  const m = w.spawns.def[0];
  const path = nav.path(nav.nearest(m.x, 0, m.z), nav.nearest(s.x, 0, s.z));
  const spawnsOk = w.spawns.atk.every(p => !w.isPit(p.x, p.z) && fits(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  const ok = found && !!path && spawnsOk;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} seed ${seed}: exit ${found ? 'reachable' : 'NOT reachable'}, monster ${path ? `path ${path.length} steps` : 'NO path'}, spawns ${spawnsOk ? 'ok' : 'BAD'}, pits ${w.pits.length}, built in ${ms} ms`);
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
