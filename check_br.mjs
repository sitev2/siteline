// Checks Backrooms Level 0 layouts (brmap.js): for many random seeds, on all three difficulties, on the real floor
// (0.5 m cells, a 0.72 m wide player who never stands over a hole):
//   - the start, key, levers and exit can be walked to (every ordinary door shut, the gates open), the spawns are fine
//   - THE ORDER: each gate is the only way between its two sections (with it shut, nothing past it is reachable),
//     every route from C's entrance into D crosses the pit hall (block the hall and D can't be reached), and no
//     section is a dead end (from where you come in, its way out can be reached without leaving it)
//   - the exit room's walls touch no other wall (following one wall, always left or right, never finds the exit)
//   - no dead-end corridor is longer than 4 rooms
//   - the monster: it starts in A; at every task stage it can only get into sections whose gates are open; from its
//     start it can reach every room of the current section; with every door shut it can still reach players who
//     have gone back through an open gate (D → C means across the pit hall); and its brain (monster.js) keeps its
//     home in the current section, never ahead of the players, and wanders only there
// Usage: node check_br.mjs [how many seeds = 40] [print one seed's map] [easy|normal|hard = all three]
import { resolveMap } from './maps.js';
import { World, CELL } from './world.js';
import { NavGrid } from './bots.js';
import { BR, brSection, brRoomAt, inPitHall } from './brmap.js';
import { MonsterBrain } from './monster.js';

const runs = Number(process.argv[2]) || 40, show = Number(process.argv[3]) || 0, onlyLevel = process.argv[4];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let bad = 0, slowest = 0, retried = 0;
for (let k = 0; k < runs; k++) {
  const seed = show || 1000 + k * 7919;
  const level = onlyLevel || ['easy', 'normal', 'hard'][k % 3];
  const t0 = Date.now();
  const w = new World(resolveMap('backrooms', `${seed}:${level}`));
  const ms = Date.now() - t0;
  slowest = Math.max(slowest, ms);
  const plan = w.def.br, problems = [];
  if (plan.seed !== seed) retried++;          // (the first layout failed its own check and a variation was used)
  const at = i => BR.border + i * BR.cell;
  const secOfCell = (ix, iz) => brSection(plan, (ix + 0.5) * CELL, (iz + 0.5) * CELL);
  const roomOfCell = (ix, iz) => brRoomAt((ix + 0.5) * CELL, (iz + 0.5) * CELL);
  // ---------- the player ----------
  const free = (ix, iz) => !w.cellSpans(ix, iz).some(s => s.y0 < 1.8 && s.y1 > 0.42);
  const fits = (ix, iz) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!free(ix + dx, iz + dz)) return false; return !w.pitCell(ix, iz); };
  const cellOf = (x, z) => [Math.floor(x / CELL), Math.floor(z / CELL)];
  const s = w.spawns.atk[0], e = w.exit;
  const start = cellOf(s.x, s.z);
  const goal = cellOf(e.x + e.nx * 0.8, e.z + e.nz * 0.8);
  // where a player can walk to from `from` (block: cells they may not step on)
  const flood = (from, block) => {
    const seen = new Uint8Array(w.w * w.h), q = [from];
    seen[from[1] * w.w + from[0]] = 1;
    for (let i = 0; i < q.length; i++) {
      const [ix, iz] = q[i];
      for (const [dx, dz] of DIRS) {
        const nx = ix + dx, nz = iz + dz, j = nz * w.w + nx;
        if (nx < 0 || nz < 0 || nx >= w.w || nz >= w.h || seen[j] || !fits(nx, nz) || (block && block(nx, nz))) continue;
        seen[j] = 1; q.push([nx, nz]);
      }
    }
    return seen;
  };
  const near = (seen, cx, cz) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (seen[(cz + dz) * w.w + cx + dx]) return true; return false; };
  const mid = (x, z) => cellOf(at(x) + 2.25, at(z) + 2.25);       // the middle of room (x, z)
  // does `seen` reach any cell of section s (4 = the exit room)?
  const reachesSec = (seen, ss) => { for (let i = 0; i < seen.length; i++) if (seen[i] && ss.includes(secOfCell(i % w.w, Math.floor(i / w.w)))) return true; return false; };
  const gate = (lock) => w.doors.findIndex(d => d.lock === lock);
  const G = { heavy: gate('heavy'), red: gate('red'), twin: gate('twin') };
  const setGates = (open) => { for (const l of Object.keys(G)) if (G[l] >= 0) w.setDoor(G[l], open.includes(l)); };
  const shutOrdinary = (shut) => w.doors.forEach((d, i) => { if (!d.lock) w.setDoor(i, !shut); });
  shutOrdinary(true);
  setGates(['heavy', 'red', 'twin']);
  const all = flood(start);
  const keyAt = mid(plan.key.x, plan.key.z), leverAt = mid(plan.switches[0].x, plan.switches[0].z);
  if (!near(all, goal[0], goal[1])) problems.push('exit not reachable');
  if (!near(all, ...keyAt)) problems.push('key not reachable');
  if (!near(all, ...leverAt)) problems.push('levers not reachable');
  if (plan.switches.length !== 2 || plan.switches[0].x !== plan.switches[1].x || plan.switches[0].z !== plan.switches[1].z) problems.push('levers not in one room');
  if (brSection(plan, at(plan.key.x) + 2, at(plan.key.z) + 2) !== 1) problems.push('key not in B');
  if (brSection(plan, at(plan.switches[0].x) + 2, at(plan.switches[0].z) + 2) !== 3) problems.push('levers not in D');
  // every room of every section has floor you can walk to
  {
    const roomHit = new Set(), roomAny = new Set();
    for (let iz = 0; iz < w.h; iz++) for (let ix = 0; ix < w.w; ix++) {
      if (!fits(ix, iz)) continue;
      const r = roomOfCell(ix, iz).join(',');
      roomAny.add(r);
      if (all[iz * w.w + ix]) roomHit.add(r);
    }
    const lost = [...roomAny].filter(r => !roomHit.has(r));
    if (lost.length) problems.push(`rooms cut off: ${lost.slice(0, 4).join(' ')}`);
  }
  const spawnsOk = w.spawns.atk.every(p => !w.isPit(p.x, p.z) && fits(...cellOf(p.x, p.z)) && brSection(plan, p.x, p.z) === 0);
  if (!spawnsOk) problems.push('bad spawns');
  // THE ORDER: each gate is the only way between its two sections
  if (G.heavy < 0 || G.red < 0 || G.twin < 0) problems.push('a gate is missing');
  else {
    setGates(['red', 'twin']);
    if (reachesSec(flood(start), [1, 2, 3, 4])) problems.push('past the heavy door with it shut');
    setGates(['heavy', 'twin']);
    if (reachesSec(flood(start), [2, 3, 4])) problems.push('past the locked door without the key');
    setGates(['heavy', 'red']);
    if (near(flood(start), goal[0], goal[1]) || reachesSec(flood(start), [4])) problems.push('exit room reachable without the levers');
    setGates(['heavy', 'red', 'twin']);
    // C → D only across the pit hall: block every cell of the hall and D can't be reached from C's entrance
    const red = plan.locked.find(g => g.lock === 'red'), cIn = mid(...red.to);
    const hall = plan.hall, hx0 = at(hall.x), hx1 = at(hall.x + hall.w), hz0 = at(hall.z), hz1 = at(hall.z + hall.d);
    const inHall = (ix, iz) => { const x = (ix + 0.5) * CELL, z = (iz + 0.5) * CELL; return x >= hx0 && x < hx1 && z >= hz0 && z < hz1; };
    if (reachesSec(flood(cIn, inHall), [3, 4])) problems.push('D reachable from C without crossing the pit hall');
    if (!reachesSec(flood(cIn), [3])) problems.push('D not reachable from C even across the pit hall');
    // no section is a dead end: from where you come in, its way out (and its task) can be reached inside it (players
    // open doors; D may use the strip of hall floor along its edge, which joins its rooms there)
    shutOrdinary(false);
    const within = (ss) => (ix, iz) => !ss.includes(secOfCell(ix, iz)) && !(ss.includes(3) && inHall(ix, iz));
    const heavy = plan.locked.find(g => g.lock === 'heavy'), twin = plan.locked.find(g => g.lock === 'twin');
    const dEdge = cellOf(at(hall.x + hall.w) + 1, at(plan.hallDoor.z) + 2);
    const legs = [
      ['A', start, [0], [mid(...heavy.from)]],
      ['B', mid(...heavy.to), [1], [mid(...red.from), keyAt]],
      ['C', cIn, [2], [mid(plan.hallDoor.x, plan.hallDoor.z), cellOf(at(hall.x + hall.w) - 0.5, at(plan.hallDoor.z) + 2)]],
      ['D', dEdge, [3], [leverAt, mid(...twin.from)]],
    ];
    for (const [name, from, ss, targets] of legs) {
      const seen = flood(from, within(ss));
      if (!targets.every(t => near(seen, t[0], t[1]))) problems.push(`section ${name} is a dead end`);
    }
    shutOrdinary(true);
  }
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
  const behind = cellOf(e.x - e.nx * 0.25, e.z - e.nz * 0.25);
  const island = solid(behind[0], behind[1]) && !outer[behind[1] * w.w + behind[0]];
  if (!island) problems.push('exit room touches the other walls');
  // short dead ends (in the plan: rooms and openings)
  let longest = 0;
  {
    const inside = (x, z) => x >= 0 && z >= 0 && x < plan.W && z < plan.D && plan.sec[z][x] >= 0;
    const wallTo = (x, z, dx, dz) => { const nx = x + dx, nz = z + dz; if (!inside(nx, nz)) return true; return dx ? plan.vWall[z][Math.min(x, nx)] : plan.hWall[Math.min(z, nz)][x]; };
    const deg = (x, z) => DIRS.filter(([dx, dz]) => !wallTo(x, z, dx, dz)).length;
    for (let z = 0; z < plan.D; z++) for (let x = 0; x < plan.W; x++) {
      if (!inside(x, z) || inPitHall(plan, x, z) || (x === plan.exit.x && z === plan.exit.z) || deg(x, z) !== 1) continue;
      let px = -1, pz = -1, cx = x, cz = z, n = 1;
      for (let g = 0; g < 99; g++) {
        const st = DIRS.find(([dx, dz]) => !wallTo(cx, cz, dx, dz) && !(cx + dx === px && cz + dz === pz));
        if (!st) break;
        px = cx; pz = cz; cx += st[0]; cz += st[1];
        if (deg(cx, cz) !== 2) break;
        n++;
      }
      longest = Math.max(longest, n);
    }
    if (longest > 4) problems.push(`a dead end ${longest} rooms long`);
  }
  // ---------- the monster ----------
  const m = w.spawns.def[0];
  if (brSection(plan, m.x, m.z) !== 0) problems.push('monster does not start in A');
  w.doors.forEach((d, i) => w.setDoor(i, true));          // (its walking grid is made with every door open…)
  const nav = new NavGrid(w);
  const nodeDoor = new Int16Array(nav.n).fill(-1);       // (…and it steers round the shut ones, or kicks them in)
  w.doors.forEach((d, di) => { const cs = new Set(d.cells); for (let i = 0; i < nav.n; i++) if (cs.has(Math.floor(nav.z[i] / CELL) * w.w + Math.floor(nav.x[i] / CELL))) nodeDoor[i] = di; });
  const nodeSec = new Int8Array(nav.n), nodeRoom = new Array(nav.n);
  for (let i = 0; i < nav.n; i++) { nodeSec[i] = brSection(plan, nav.x[i], nav.z[i]); nodeRoom[i] = brRoomAt(nav.x[i], nav.z[i]).join(','); }
  // where it can get to from node a: gates in `openGates` open, other gates shut; ordinary doors kickable or (strict) shut
  const navFlood = (a, openGates, strict) => {
    const seen = new Uint8Array(nav.n), q = [a];
    seen[a] = 1;
    const passable = (j) => { const di = nodeDoor[j]; if (di < 0) return true; const d = w.doors[di]; return d.lock ? openGates.includes(d.lock) : !strict; };
    for (let i = 0; i < q.length; i++) {
      const e2 = nav.edges[q[i]];
      for (let t = 0; t < e2.length; t += 2) { const j = e2[t]; if (seen[j] || !passable(j)) continue; seen[j] = 1; q.push(j); }
    }
    return seen;
  };
  const roomsOf = (ss) => { const set = new Set(); for (let i = 0; i < nav.n; i++) if (ss.includes(nodeSec[i])) set.add(nodeRoom[i]); return set; };
  const roomsHit = (seen, ss) => { const set = new Set(); for (let i = 0; i < nav.n; i++) if (seen[i] && ss.includes(nodeSec[i])) set.add(nodeRoom[i]); return set; };
  const mNode = nav.nearest(m.x, 0, m.z);
  const STAGES = [[], ['heavy'], ['heavy', 'red'], ['heavy', 'red']];       // the gates open at each task stage (D: crossed, no gate)
  const allowed = [[0], [0, 1], [0, 1, 2, 3], [0, 1, 2, 3]];                // where it may physically get to then (C|D has no gate)
  STAGES.forEach((open, st) => {
    const seen = navFlood(mNode, open, false);
    for (let i = 0; i < nav.n; i++) if (seen[i] && !allowed[st].includes(nodeSec[i])) { problems.push(`stage ${st}: monster can get into section ${nodeSec[i]}`); break; }
    // it can reach every room of the current section (where the players' task is)
    const want = roomsOf([st]), got = roomsHit(seen, [st]);
    const missing = [...want].filter(r => !got.has(r));
    if (missing.length) problems.push(`stage ${st}: monster can't reach rooms ${missing.slice(0, 3).join(' ')} of section ${st}`);
    // with every door shut, from the current section it can still follow someone back into every earlier section
    if (st > 0) {
      let from = -1;
      for (let i = 0; i < nav.n && from < 0; i++) if (nodeSec[i] === st && nav.reach[i]) from = i;
      const back = navFlood(from, open, true);
      for (let s2 = 0; s2 < st; s2++) {
        const miss = [...roomsOf([s2])].filter(r => !roomsHit(back, [s2]).has(r));
        if (miss.length) { problems.push(`stage ${st}: (doors shut) can't chase back into section ${s2}`); break; }
      }
    }
  });
  // its brain: home section moves with the tasks but never ahead of the players, and it wanders only at home
  {
    const players = new Map();
    let stage = 0;
    const fake = { world: w, players, navGrid: () => nav, brStage: () => stage, broadcast() {}, send() {}, monsterAlert() {}, corners: null };
    const mp = { id: 'monster', x: m.x, y: 0, z: m.z, yaw: 0, alive: true };
    w.doors.forEach((d, i) => w.setDoor(i, !d.lock));
    const brain = new MonsterBrain(fake, mp);
    const player = { id: 'p', x: 0, y: 0, z: 0, yaw: 0, alive: true, escaped: false };
    players.set('p', player);
    const putIn = (sec) => { for (let i = 0; i < nav.n; i++) if (nodeSec[i] === sec && nav.reach[i]) { player.x = nav.x[i]; player.z = nav.z[i]; return; } };
    const openTo = (st) => { setGates(STAGES[st]); };
    // stage 1 (heavy open), the player still in A: its home stays A
    stage = 1; openTo(1); putIn(0); brain.updateHome();
    if (brain.home !== 0) problems.push('home moved on with the players still behind');
    // the player goes into B: it follows
    putIn(1); brain.updateHome();
    if (brain.home !== 1) problems.push('home did not follow the players into B');
    // stage 2: the player in C, home C; even standing in D before the stage says so, never past the stage
    stage = 2; openTo(2); putIn(2); brain.updateHome();
    if (brain.home !== 2) problems.push('home did not follow into C');
    putIn(3); brain.updateHome();
    if (brain.home !== 2) problems.push('home got ahead of the task (D before the pits were crossed)');
    stage = 3; brain.updateHome();
    if (brain.home !== 3) problems.push('home did not move to D');
    // the player goes back to A: home stays D, and it wanders only in D (from wherever it is)
    putIn(0); brain.updateHome();
    if (brain.home !== 3) problems.push('home went back with the player');
    mp.x = player.x; mp.z = player.z;          // (it chased them back to A and lost them)
    for (let i = 0; i < 25; i++) { const g = brain.wanderGoal(0); if (g && brSection(plan, g.x, g.z) !== 3) { problems.push('wanders outside its home'); break; } }
    w.doors.forEach((d, i) => w.setDoor(i, false));
  }
  const ok = !problems.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} seed ${seed} ${level}${plan.seed !== seed ? ` (used ${plan.seed})` : ''}: ${ok ? 'all checks pass' : problems.join('; ')}, doors ${w.doors.length}, pits ${w.pits.length}, longest dead end ${longest}, built in ${ms} ms`);
  if (show) {
    // a rough picture, one character per metre: # wall, o pillar, . floor, _ pit, S start, E exit, M monster
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
console.log(bad ? `${bad} of ${runs} mazes have a problem` : `all ${show ? 1 : runs} mazes OK (slowest built in ${slowest} ms; ${retried} needed a second try)`);
process.exit(bad ? 1 : 0);
