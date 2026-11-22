import { World } from './world.js';

// The Backrooms, Level 0: a new random layout every game, built from one number (the seed) so the host,
// every player and the home server all build exactly the same one. No three.js in here.
//
// The owner's layout: FOUR SECTIONS IN A ROW, west to east, on a grid of 4 m rooms (44 × 22 rooms), so there is
// always an obvious way to go. Start at the west end, the exit at the east end:
//   A  start        11 × 22 rooms, its own maze; the heavy door (two push at once) is the way into B
//   B  the key      11 × 22, its own maze; the key on its high shelf opens the locked door into C
//   C  the pits     11 × 11 (half as tall, solid wall above and below): a short maze, then ONE doorway into the
//                   pit hall (a grid of square holes from wall to wall), which opens straight into D
//   D  levers, exit 11 × 22, its own maze: the lever room, and at the far east end the exit room
// Each section's maze is a growing tree (mostly the newest room, sometimes an older one) with few loops (~6 %) and
// no dead end longer than 4 rooms. Each section looks different (carpet and light: brview.js). The exit is a door in
// a small room whose walls touch no other wall (keeping a hand on the wall never gets you there); big black arrows
// on a few walls point the way.

export const BR = {
  cols: 44,           // rooms west → east (4 m each): four sections in a row (owner's layout; was one 28 × 28 maze)
  rows: 22,           // rooms north → south
  cell: 4,            // metres per room
  border: 1,          // solid edge around the maze
  ceiling: 2.9,       // ceiling height
  wall: 0.5,          // wall thickness
  door: 2.2,          // doorway height
  walk: 2.7,          // m/s: how fast you walk (the normal speed in here; quiet)
  sprint: 4.5,        // m/s: holding Shift (or the run button): loud, it hears you
};

// The four sections, west to east: their first and last room column. C is only 11 rooms tall (plan.cz0 … plan.cz1)
// and its east part (from hallX) is the pit hall.
export const SECTIONS = [
  { name: 'A', x0: 0, x1: 10 },
  { name: 'B', x0: 11, x1: 21 },
  { name: 'C', x0: 22, x1: 32, hallX: 28, rows: 11 },
  { name: 'D', x0: 33, x1: 43 },
];
const LOOPS = 0.05;         // share of the walls inside a section knocked out for loops (plus the dead-end fixes: ~6 % in all)
const DEAD_END = 4;         // no dead-end corridor longer than this many rooms
const NEWEST = 0.75;        // growing tree: how often it grows from the newest room (else a random older one)

// The three difficulties. Maze: how wide the walkways between the holes of the pit rooms are (m), how many
// ceiling holes, dark areas and arrows. Monster: how much faster than your sprint it
// runs, how far it sees (sight; once chasing you, chaseSight), how wide it looks (fov, radians each side),
// how long it keeps after you once you are out of sight (lose, s) and how far ahead it guesses (lead, s),
// how far it hears running / walking, how many places it searches and when it wakes up (s).
export const BR_LEVELS = {
  easy: {
    bridge: 1.5, holes: 4, dark: 4, arrows: 0.22, arrowMax: 5, doors: 28, guide: true,
    monster: { speed: 1.05, sight: 16, chaseSight: 13, fov: 1.0, lose: 0.25, lead: 0.7, hear: 11, hearWalk: 2.5, search: 3, wake: 30 },
  },
  normal: {
    bridge: 1, holes: 6, dark: 6, arrows: 0.15, arrowMax: 4, doors: 20,
    monster: { speed: 1.10, sight: 22, chaseSight: 19, fov: 1.2, lose: 0.55, lead: 1.2, hear: 14, hearWalk: 3, search: 4, wake: 20 },
  },
  hard: {
    bridge: 0.5, holes: 7, dark: 8, arrows: 0.09, arrowMax: 3, doors: 12,
    monster: { speed: 1.15, sight: 28, chaseSight: 28, fov: 1.3, lose: 0.9, lead: 1.6, hear: 16, hearWalk: 3.5, search: 5, wake: 15 },
  },
};
export const brLevel = (lv) => (BR_LEVELS[lv] ? lv : 'normal');
// explorer logs (clue notes) per maze: brfx.js has the clues (LOGS), the first is always in the start room
export const LOG_COUNT = 7;

// The map variant carries the maze's seed and the difficulty: "12345:hard" (a plain number = normal)
export function brVariant(seed, level) { return `${seed >>> 0}:${brLevel(level)}`; }
export function parseBrVariant(v) {
  const [a, b] = String(v == null ? '' : v).split(':');
  return { seed: (Math.floor(Number(a)) >>> 0) || 1, level: brLevel(b) };
}

// small, fast, seeded random numbers (same seed → same maze everywhere)
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// metres: the corner of room (x, z)
const at = i => BR.border + i * BR.cell;
// the room (column, row) a point (metres) is in
export const brRoomAt = (x, z) => [Math.floor((x - BR.border) / BR.cell), Math.floor((z - BR.border) / BR.cell)];
// Which section a point (metres) is in: 0 A, 1 B, 2 C (with the pit hall), 3 D, 4 the exit room (behind the lever
// door), -1 none (solid). The monster's home and the gates use this.
export function brSection(plan, x, z) {
  const [rx, rz] = brRoomAt(x, z);
  if (!plan || !plan.sec || rx < 0 || rz < 0 || rx >= plan.W || rz >= plan.D) return -1;
  if (plan.exit && rx === plan.exit.x && rz === plan.exit.z) return 4;
  return plan.sec[rz][rx];
}
// is room (x, z) part of the pit hall?
export const inPitHall = (plan, x, z) => { const h = plan.hall; return !!h && x >= h.x && x < h.x + h.w && z >= h.z && z < h.z + h.d; };

// Plan the maze (pure data): walls between rooms, sections, the pit hall, pillar hall, pit rooms, doors, start, exit,
// monster start, arrows, logs. `level` is the difficulty (BR_LEVELS).
export function planMaze(seed, level = 'normal') {
  const R = rng(seed), W = BR.cols, D = BR.rows, L = BR_LEVELS[brLevel(level)];
  const pick = (a, b) => a + Math.floor(R() * (b - a + 1));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 0. the sections. C is 11 rows tall, about in the middle of the strip; solid wall above and below it.
  const SC = SECTIONS[2], cz0 = pick(5, 6), cz1 = cz0 + SC.rows - 1;
  const sec = Array.from({ length: D }, (_, z) => Array.from({ length: W }, (_, x) => (x <= SECTIONS[0].x1 ? 0 : x <= SECTIONS[1].x1 ? 1 : x <= SC.x1 ? (z >= cz0 && z <= cz1 ? 2 : -1) : 3)));
  const box = SECTIONS.map((s, i) => ({ x0: s.x0, x1: s.x1, z0: i === 2 ? cz0 : 0, z1: i === 2 ? cz1 : D - 1 }));
  const hall = { x: SC.hallX, z: cz0, w: SC.x1 + 1 - SC.hallX, d: SC.rows, bridge: L.bridge, hall: true };
  const inHallR = (x, z) => x >= hall.x && x < hall.x + hall.w && z >= hall.z && z < hall.z + hall.d;
  const inside = (x, z) => x >= 0 && z >= 0 && x < W && z < D && sec[z][x] >= 0;
  // vWall[z][x]: wall between room (x, z) and (x + 1, z); hWall[z][x]: between (x, z) and (x, z + 1)
  const vWall = Array.from({ length: D }, () => new Array(W - 1).fill(true));
  const hWall = Array.from({ length: D - 1 }, () => new Array(W).fill(true));
  const open = (x, z, dx, dz) => {
    if (dx) vWall[z][Math.min(x, x + dx)] = false;
    else hWall[Math.min(z, z + dz)][x] = false;
  };
  // is there a wall between room (x, z) and the next one in direction (dx, dz)? (the outer wall and solid parts count)
  const wallTo = (x, z, dx, dz) => {
    const nx = x + dx, nz = z + dz;
    if (!inside(nx, nz)) return true;
    return dx ? vWall[z][Math.min(x, nx)] : hWall[Math.min(z, nz)][x];
  };
  // an ordinary maze room of section s (not the pit hall)
  const mazeRoom = (x, z, s) => inside(x, z) && sec[z][x] === s && !inHallR(x, z);
  // 1. a maze in each section: a growing tree (mostly from the newest room, sometimes from an older one), which
  // makes shorter side branches than the old depth-first maze. C's maze is only its west part.
  for (let s = 0; s < 4; s++) {
    const cells = [];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (mazeRoom(x, z, s)) cells.push([x, z]);
    const seen = new Set(), first = cells[Math.floor(R() * cells.length)], act = [first];
    seen.add(first[1] * W + first[0]);
    while (act.length) {
      const i = R() < NEWEST ? act.length - 1 : Math.floor(R() * act.length);
      const [x, z] = act[i];
      const next = DIRS.map(([dx, dz]) => [x + dx, z + dz, dx, dz]).filter(([nx, nz]) => mazeRoom(nx, nz, s) && !seen.has(nz * W + nx));
      if (!next.length) { act.splice(i, 1); continue; }
      const [nx, nz, dx, dz] = next[Math.floor(R() * next.length)];
      open(x, z, dx, dz);
      seen.add(nz * W + nx);
      act.push([nx, nz]);
    }
  }
  // 2. short dead ends: a dead-end corridor longer than DEAD_END rooms has its far end opened into a neighbour
  // (that makes a small loop). `keep`: rooms whose walls must stay (the exit room).
  const openings = (x, z) => DIRS.filter(([dx, dz]) => !wallTo(x, z, dx, dz)).length;
  const shortDeadEnds = (keep) => {
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (!inside(x, z) || inHallR(x, z) || (keep && keep(x, z)) || openings(x, z) !== 1) continue;
      let px = -1, pz = -1, cx = x, cz = z, n = 1;
      for (let g = 0; g < W * D; g++) {
        const step = DIRS.find(([dx, dz]) => !wallTo(cx, cz, dx, dz) && !(cx + dx === px && cz + dz === pz));
        if (!step) break;
        px = cx; pz = cz; cx += step[0]; cz += step[1];
        if (openings(cx, cz) !== 2) break;
        n++;
      }
      if (n <= DEAD_END) continue;
      const s = sec[z][x];
      const ways = DIRS.filter(([dx, dz]) => mazeRoom(x + dx, z + dz, s) && wallTo(x, z, dx, dz) && !(keep && keep(x + dx, z + dz)));
      if (!ways.length) continue;
      const [dx, dz] = ways[Math.floor(R() * ways.length)];
      open(x, z, dx, dz);
    }
  };
  shortDeadEnds(null);
  // 3. a few loops, inside each section (players need something to run round when it chases them)
  for (let z = 0; z < D; z++) for (let x = 0; x < W - 1; x++) if (vWall[z][x] && mazeRoom(x, z, sec[z][x]) && mazeRoom(x + 1, z, sec[z][x]) && R() < LOOPS) vWall[z][x] = false;
  for (let z = 0; z < D - 1; z++) for (let x = 0; x < W; x++) if (hWall[z][x] && mazeRoom(x, z, sec[z][x]) && mazeRoom(x, z + 1, sec[z][x]) && R() < LOOPS) hWall[z][x] = false;
  // 4. bigger rooms and one pillar hall: clear every wall inside a block (always inside one section)
  const clearBlock = (x0, z0, w, d) => {
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w - 1; x++) vWall[z][x] = false;
    for (let z = z0; z < z0 + d - 1; z++) for (let x = x0; x < x0 + w; x++) hWall[z][x] = false;
  };
  const overlaps = (a, b) => a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.z < b.z + b.d + 1 && b.z < a.z + a.d + 1;
  const sx = 0, sz = R() < 0.5 ? 0 : D - 1;           // the start: a corner room at the west end
  const nearStart = (x, z) => Math.abs(x - sx) <= 1 && Math.abs(z - sz) <= 1;
  const halls = [];
  {
    const b = box[[0, 1, 3][pick(0, 2)]];
    for (let tries = 0; tries < 60 && !halls.length; tries++) {
      const h = { w: pick(3, 5), d: pick(3, 5) };
      h.x = pick(b.x0 + 1, b.x1 - h.w); h.z = pick(b.z0 + 1, b.z1 - h.d);
      if (overlaps(h, { x: sx - 2, z: sz - 2, w: 5, d: 5 })) continue;
      halls.push(h);
      clearBlock(h.x, h.z, h.w, h.d);
    }
  }
  for (let s = 0; s < 4; s++) {
    const b = box[s], x1 = s === 2 ? SC.hallX - 1 : b.x1, area = (x1 - b.x0 + 1) * (b.z1 - b.z0 + 1);
    for (let i = 0; i < Math.round(5 * area / 400); i++) {       // (as many per area as on the old mazes)
      const w = pick(2, 3), d = pick(2, 3);
      clearBlock(pick(b.x0, x1 - w + 1), pick(b.z0, b.z1 - d + 1), w, d);
    }
  }
  const inHall = (x, z) => halls.find(h => x >= h.x && x < h.x + h.w && z >= h.z && z < h.z + h.d);
  // 5. the pit hall: C's east part, one big room of holes from its north wall to its south wall. Its west wall is
  // whole but for one doorway from C's maze; its east side is open all along into D (no wall, no gate).
  clearBlock(hall.x, hall.z, hall.w, hall.d);
  for (let z = cz0; z <= cz1; z++) { vWall[z][hall.x - 1] = true; vWall[z][hall.x + hall.w - 1] = false; }
  const hallDoor = { dir: 'v', x: hall.x - 1, z: pick(cz0 + 1, cz1 - 1) };
  vWall[hallDoor.z][hallDoor.x] = false;
  // 6. the gates between sections (owner's design: THE ORDER). Each is the only opening in the wall between two
  // sections, at a random row (into C: one of C's rows), with a locked door in it (plan.locked):
  //   A --[ the heavy door: two push at once ]--> B --[ the locked door: the key opens it ]--> C
  //   C: across the pit hall, the only way on --> D: both levers together open the exit room's door ('twin')
  // (Alone, the two-player parts work for one: Server.brSolo.)
  const locked = [];
  const used = new Set();                    // walls (room + side) taken by a gate, a lever, the key shelf or a log
  const wkey = (x, z, wx, wz) => `${x},${z},${wx},${wz}`;
  const addGate = (x, z, dx, dz, lock, from, to) => {
    open(x, z, dx, dz);
    const g = { dir: dx ? 'v' : 'h', x: Math.min(x, x + dx), z: Math.min(z, z + dz), lock, from, to };
    locked.push(g);
    used.add(wkey(x, z, dx, dz)); used.add(wkey(x + dx, z + dz, -dx, -dz));
    return g;
  };
  const gateRow = (xa, z0, z1) => {
    const rows = [];
    for (let z = z0; z <= z1; z++) if (!inHall(xa, z) && !inHall(xa + 1, z) && !nearStart(xa, z)) rows.push(z);
    return rows.length ? rows[Math.floor(R() * rows.length)] : z0;
  };
  const zh = gateRow(SECTIONS[0].x1, 1, D - 2), zr = gateRow(SECTIONS[1].x1, cz0, cz1);
  const heavy = addGate(SECTIONS[0].x1, zh, 1, 0, 'heavy', [SECTIONS[0].x1, zh], [SECTIONS[1].x0, zh]);
  const keyDoor = addGate(SECTIONS[1].x1, zr, 1, 0, 'red', [SECTIONS[1].x1, zr], [SC.x0, zr]);      // ('red' is only its name in the code: an ordinary door with a brass lock)
  // distances between rooms through the openings (for the exit, monster, pit rooms, key, levers and arrows)
  const walk = (fx, fz) => {
    const dist = Array.from({ length: D }, () => new Array(W).fill(-1));
    const q = [[fx, fz]]; dist[fz][fx] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!inside(nx, nz) || dist[nz][nx] >= 0 || wallTo(x, z, dx, dz)) continue;
        dist[nz][nx] = dist[z][x] + 1;
        q.push([nx, nz]);
      }
    }
    return dist;
  };
  // 7. the exit: a door in a small room at D's far (east) end, as far as it can be from the pit hall, and every wall
  // that met that room's corners from outside is knocked out, so its walls touch no other wall: an island. Keeping a
  // hand on the wall (always turning left, or always right) only ever goes round the walls you started at, so it
  // never finds the exit (owner's request).
  let dist = walk(hall.x + hall.w - 1, hallDoor.z);
  let exit = null, far = -1;
  for (let z = 1; z < D - 1; z++) for (let x = W - 4; x <= W - 2; x++) {
    // (not by the pillar hall: a pillar on one of its corners would join its walls to the rest)
    if (halls.some(h => overlaps(h, { x: x - 1, z: z - 1, w: 3, d: 3 }))) continue;
    const d = dist[z][x] + R() * 3;
    if (d > far) { far = d; exit = { x, z }; }
  }
  {
    const ex = exit.x, ez = exit.z;
    // the eight walls that meet its corners from outside go…
    vWall[ez - 1][ex - 1] = vWall[ez - 1][ex] = vWall[ez + 1][ex - 1] = vWall[ez + 1][ex] = false;
    hWall[ez - 1][ex - 1] = hWall[ez - 1][ex + 1] = hWall[ez][ex - 1] = hWall[ez][ex + 1] = false;
    // …it gets all four of its own but one (the way in), and the door is in the wall facing the way in
    vWall[ez][ex - 1] = vWall[ez][ex] = hWall[ez - 1][ex] = hWall[ez][ex] = true;
    const [way, wdx, wdz] = [['w', -1, 0], ['e', 1, 0], ['n', 0, -1], ['s', 0, 1]][pick(0, 3)];
    open(ex, ez, wdx, wdz);
    exit.way = way;
    exit.side = { w: 'e', e: 'w', n: 's', s: 'n' }[way];
  }
  const isExit = (x, z) => x === exit.x && z === exit.z;
  // the rooms round the exit room (its walls must stay an island: no pit rooms or doors there)
  const byExit = (x, z) => Math.abs(x - exit.x) <= 1 && Math.abs(z - exit.z) <= 1;
  // the lever door: on the exit room's one way in
  const twin = (() => {
    const [wdx, wdz] = { w: [-1, 0], e: [1, 0], n: [0, -1], s: [0, 1] }[exit.way];
    return addGate(exit.x, exit.z, wdx, wdz, 'twin', [exit.x + wdx, exit.z + wdz], [exit.x, exit.z]);
  })();
  // (opening the corners may have joined corridors into long dead ends again: fix those, leaving the exit room be)
  shortDeadEnds(isExit);
  // 8. the monster starts in A (the section of the first task), well away from the start, out of sight of it
  dist = walk(sx, sz);
  let mon = null;
  {
    let maxA = 0;
    for (let z = 0; z < D; z++) for (let x = box[0].x0; x <= box[0].x1; x++) maxA = Math.max(maxA, dist[z][x]);
    let best = -Infinity;
    for (let z = 0; z < D; z++) for (let x = box[0].x0; x <= box[0].x1; x++) {
      if (dist[z][x] < 0 || inHall(x, z) || Math.abs(x - sx) + Math.abs(z - sz) < 7 || (x === heavy.from[0] && z === heavy.from[1])) continue;
      const score = -Math.abs(dist[z][x] - maxA * 0.75) + R() * 2;
      if (score > best) { best = score; mon = { x, z }; }
    }
  }
  // 9. small pit rooms (extras, as before): one in B and one in D, set across the way through that section. The
  // floor is a grid of equal square holes with walkways between them (pitHoles).
  const special = (x, z) => nearStart(x, z) || byExit(x, z) || (x === mon.x && z === mon.z)
    || locked.some(g => Math.abs(g.from[0] - x) + Math.abs(g.from[1] - z) <= 1 || Math.abs(g.to[0] - x) + Math.abs(g.to[1] - z) <= 1);
  const routeBetween = (a, b) => {
    const back = walk(b[0], b[1]), out = [];
    let [x, z] = a;
    out.push([x, z]);
    for (let g = 0; g < W * D && !(x === b[0] && z === b[1]); g++) {
      const nxt = DIRS.find(([dx, dz]) => inside(x + dx, z + dz) && !wallTo(x, z, dx, dz) && back[z + dz][x + dx] === back[z][x] - 1);
      if (!nxt) break;
      x += nxt[0]; z += nxt[1];
      out.push([x, z]);
    }
    return out;
  };
  const pitRooms = [];
  for (const [s, a, b] of [[1, heavy.to, keyDoor.from], [3, [SECTIONS[3].x0, hallDoor.z], twin.from]]) {
    const route = routeBetween(a, b), bx = box[s];
    const spread = Math.max(4, Math.round(route.length * 0.3));
    for (let tries = 0; tries < 300; tries++) {
      const [cx, cz] = route[Math.max(0, Math.min(route.length - 1, Math.round(route.length * 0.5) + pick(-spread, spread)))];
      // a rectangle of rooms: 2×3, 3×2 or 3×3 (8×12, 12×8 or 12×12 m)
      const r = { w: pick(2, 3), d: pick(2, 3) };
      if (r.w * r.d < 6) r[R() < 0.5 ? 'w' : 'd'] = 3;
      r.x = cx - pick(0, r.w - 1); r.z = cz - pick(0, r.d - 1);
      // (inside the section, and not on D's edge by the pit hall)
      if (r.x < bx.x0 + (s === 3 ? 2 : 0) || r.z < bx.z0 || r.x + r.w - 1 > bx.x1 || r.z + r.d - 1 > bx.z1) continue;
      if (halls.some(o => overlaps(o, r)) || pitRooms.some(o => overlaps(o, r))) continue;
      let bad = false;
      for (let z = r.z; z < r.z + r.d && !bad; z++) for (let x = r.x; x < r.x + r.w; x++) if (special(x, z)) bad = true;
      if (bad) continue;
      // a side with a way in keeps a strip of floor by its wall (if the holes touched that wall, the way in would
      // open straight onto a hole): pitHoles is told which ends need one
      const wayIn = { w: false, e: false, n: false, s: false };
      for (let z = r.z; z < r.z + r.d; z++) { if (!wallTo(r.x, z, -1, 0)) wayIn.w = true; if (!wallTo(r.x + r.w - 1, z, 1, 0)) wayIn.e = true; }
      for (let x = r.x; x < r.x + r.w; x++) { if (!wallTo(x, r.z, 0, -1)) wayIn.n = true; if (!wallTo(x, r.z + r.d - 1, 0, 1)) wayIn.s = true; }
      r.xs = pitHoles(r.x, r.w, L.bridge, wayIn.w, wayIn.e); r.zs = pitHoles(r.z, r.d, L.bridge, wayIn.n, wayIn.s);
      if (r.xs.length * r.zs.length < 2) continue;
      if (bad) continue;
      pitRooms.push(r);
      break;
    }
  }
  for (const r of pitRooms) {
    clearBlock(r.x, r.z, r.w, r.d);
    r.bridge = L.bridge;          // the walkways between its holes (all its holes are the same size: PIT_HOLE)
  }
  const inPitRoom = (x, z) => pitRooms.find(r => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d);
  // an ordinary room (for doors, the key, levers, logs…)
  const plain = (x, z) => inside(x, z) && !inHall(x, z) && !inPitRoom(x, z) && !byExit(x, z) && !inHallR(x, z);
  let bad = false;                            // this seed can't be laid out: backroomsMap tries another
  // a free wall in room (x, z) for a lever or the shelf: a real wall that nothing else is on
  const freeWall = (x, z) => [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([wx, wz]) => wallTo(x, z, wx, wz) && !used.has(wkey(x, z, wx, wz)));
  // 10. the key: on its high shelf somewhere in B, a good walk from both of B's gates
  let key = null;
  {
    const dA = walk(...heavy.to), dB = walk(...keyDoor.from);
    for (const far of [6, 4, 2, 0]) {
      const rooms = [];
      for (let z = 0; z < D; z++) for (let x = box[1].x0; x <= box[1].x1; x++) if (plain(x, z) && dA[z][x] >= far && dB[z][x] >= far && freeWall(x, z).length) rooms.push([x, z]);
      if (!rooms.length) continue;
      const [kx, kz] = rooms[Math.floor(R() * rooms.length)], ws = freeWall(kx, kz), [wx, wz] = ws[Math.floor(R() * ws.length)];
      key = { x: kx, z: kz, wx, wz };
      used.add(wkey(kx, kz, wx, wz));
      break;
    }
    if (!key) bad = true;
  }
  // 11. the lever room: one room in D with both levers in it, on two of its walls, a few rooms from the exit
  const switches = [];
  {
    const dE = walk(...twin.from);
    for (const [lo, hi] of [[3, 9], [2, 14], [1, 40]]) {
      const rooms = [];
      for (let z = 0; z < D; z++) for (let x = box[3].x0; x <= box[3].x1; x++) if (plain(x, z) && dE[z][x] >= lo && dE[z][x] <= hi && freeWall(x, z).length >= 2) rooms.push([x, z]);
      if (!rooms.length) continue;
      const [lx, lz] = rooms[Math.floor(R() * rooms.length)], ws = shuffle(freeWall(lx, lz));
      for (const [wx, wz] of ws.slice(0, 2)) { switches.push({ x: lx, z: lz, wx, wz }); used.add(wkey(lx, lz, wx, wz)); }
      break;
    }
    if (switches.length < 2) bad = true;
  }
  // check it: everything joined up with the gates open, nothing past a gate that is shut, and C → D only across the
  // pit hall (check_br.mjs checks all this again on the real floor)
  {
    const flood = (shut, block) => {
      const seenR = Array.from({ length: D }, () => new Array(W).fill(false)), q = [[sx, sz]];
      seenR[sz][sx] = true;
      for (let i = 0; i < q.length; i++) {
        const [x, z] = q[i];
        for (const [dx, dz] of DIRS) {
          const nx = x + dx, nz = z + dz;
          if (!inside(nx, nz) || seenR[nz][nx] || wallTo(x, z, dx, dz)) continue;
          if (shut && shut.dir === (dx ? 'v' : 'h') && shut.x === Math.min(x, nx) && shut.z === Math.min(z, nz)) continue;
          if (block && block(nx, nz)) continue;
          seenR[nz][nx] = true; q.push([nx, nz]);
        }
      }
      return seenR;
    };
    const all = flood(null, null);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (inside(x, z) && !all[z][x]) bad = true;
    const past = (seenR, ss) => seenR.some((row, z) => row.some((v, x) => v && ss.includes(sec[z][x])));
    if (past(flood(heavy, null), [1, 2, 3])) bad = true;
    if (past(flood(keyDoor, null), [2, 3])) bad = true;
    if (past(flood(null, inHallR), [3])) bad = true;
    if (flood(twin, null)[exit.z][exit.x]) bad = true;
    if (key && sec[key.z][key.x] !== 1) bad = true;
    if (switches.length && sec[switches[0].z][switches[0].x] !== 3) bad = true;
  }
  // rooms reachable from (x0, z0) with every door in `list` shut: steps to each (-1 = can't get there)
  const walkShut = (list, x0, z0) => {
    const set = new Set(list.map(d => `${d.dir}${d.x},${d.z}`));      // (a set: with 20-odd doors this runs thousands of times)
    const isDoor = (x, z, dx, dz) => (dx ? set.has(`v${Math.min(x, x + dx)},${z}`) : set.has(`h${x},${Math.min(z, z + dz)}`));
    const dd = new Int16Array(W * D).fill(-1), q = [[x0, z0]];
    dd[z0 * W + x0] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!inside(nx, nz) || dd[nz * W + nx] >= 0 || wallTo(x, z, dx, dz) || isDoor(x, z, dx, dz)) continue;
        dd[nz * W + nx] = dd[z * W + x] + 1; q.push([nx, nz]);
      }
    }
    return dd;
  };
  // 12. doorways: openings between ordinary rooms of one section get a wall back with a door in it — enough of them
  // that one is usually within a few rooms when it is after you (owner: "enough doors to evade the monster", by
  // difficulty: L.doors = 28 / 20 / 12). The monster can't open doors, so a door only goes where there is another
  // way round even with every door shut (a long one: 6+ rooms): shutting one makes it go the long way, but never
  // seals anyone in (or it out).
  const doorways = [];
  const goodDoor = (list, d) => {
    const dd = walkShut(list, d.x, d.z);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (inside(x, z) && dd[z * W + x] < 0) return false;
    return dd[(d.dir === 'v' ? d.z * W + d.x + 1 : (d.z + 1) * W + d.x)] >= 6;
  };
  for (let tries = 0; doorways.length < L.doors && tries < 6000; tries++) {
    const x = pick(0, W - 1), z = pick(0, D - 1);
    if (!plain(x, z) || doorways.some(d => Math.abs(d.x - x) + Math.abs(d.z - z) < 4)) continue;      // spread out
    let d;
    if (R() < 0.5) {
      if (x >= W - 1 || vWall[z][x] || !plain(x + 1, z) || sec[z][x + 1] !== sec[z][x]) continue;
      d = { dir: 'v', x, z, open: R() < 0.6 };
    } else {
      if (z >= D - 1 || hWall[z][x] || !plain(x, z + 1) || sec[z + 1][x] !== sec[z][x]) continue;
      d = { dir: 'h', x, z, open: R() < 0.6 };
    }
    if (locked.some(g => g.dir === d.dir && g.x === d.x && g.z === d.z)) continue;      // (that opening is a gate)
    if (d.dir === hallDoor.dir && d.x === hallDoor.x && d.z === hallDoor.z) continue;  // (the way into the pit hall)
    if (goodDoor([...doorways, d], d)) doorways.push(d);
  }
  // 13. dark areas: blocks of rooms whose lights are all dead (bring a flashlight); never the start or the
  // exit, and (except on hard) never over a pit room or the pit hall
  const darkZones = [];
  for (let tries = 0; darkZones.length < L.dark && tries < 600; tries++) {
    const r = { w: pick(2, 4), d: pick(2, 4) };
    r.x = pick(0, W - r.w); r.z = pick(0, D - r.d);
    if (darkZones.some(o => overlaps(o, r))) continue;
    if (level !== 'hard' && (pitRooms.some(o => overlaps(o, r)) || overlaps(hall, r))) continue;
    let no = false;
    for (let z = r.z; z < r.z + r.d && !no; z++) for (let x = r.x; x < r.x + r.w; x++) if (!inside(x, z) || nearStart(x, z) || isExit(x, z)) no = true;
    if (!no) darkZones.push(r);
  }
  // 14. ceiling holes: a missing or pushed-aside ceiling tile (0.6 m tiles), off the middle of a room so it
  // isn't under the light. Something lives up there: walk under one and it takes you.
  const holes = [];
  const T = 0.6;
  for (let tries = 0; holes.length < L.holes && tries < 600; tries++) {
    const x = pick(0, W - 1), z = pick(0, D - 1);
    if (!inside(x, z) || nearStart(x, z)) continue;
    if (isExit(x, z) || inPitRoom(x, z) || inHallR(x, z)) continue;
    if (holes.some(h => Math.abs(h.rx - x) + Math.abs(h.rz - z) < 2)) continue;
    // a tile about 1.1 m from the middle of the room, to one side
    const cx = BR.border + x * BR.cell + 2.25, cz = BR.border + z * BR.cell + 2.25;
    const ang = pick(0, 3) * Math.PI / 2 + Math.PI / 4;
    const tx = Math.floor((cx + Math.cos(ang) * 1.1) / T) * T, tz = Math.floor((cz + Math.sin(ang) * 1.1) / T) * T;
    holes.push({ rx: x, rz: z, x: tx + T / 2, z: tz + T / 2, size: T, kind: R() < 0.5 ? 'missing' : 'shifted', dir: pick(0, 3) });
  }
  // 15. big black arrows sprayed on walls (the owner: "make the arrows actually useful and put less of them"): each
  // one points the way to take (the first step of the shortest walk to the exit, through the gates: so along the
  // strip, generally east), and they stand only at the start and in rooms where the way splits (3+ openings),
  // well spread out (at least 6 rooms apart), on a wall that runs the same way as the arrow
  dist = walk(exit.x, exit.z);
  const arrows = [];
  const arrowCells = [];
  const arrowAt = (x, z) => {
    const ways = DIRS.filter(([dx, dz]) => !wallTo(x, z, dx, dz));
    // the neighbour that is one step nearer the exit
    const next = ways.find(([dx, dz]) => inside(x + dx, z + dz) && dist[z + dz][x + dx] === dist[z][x] - 1);
    if (!next) return null;
    const [dx, dz] = next;
    const walls = (dx ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]).filter(([wx, wz]) => wallTo(x, z, wx, wz) && !used.has(wkey(x, z, wx, wz)));
    if (!walls.length) return null;
    const [wx, wz] = walls[Math.floor(R() * walls.length)];
    return { x, z, wx, wz, dx, dz, tilt: (R() - 0.5) * 0.18, s: 0.95 + R() * 0.1 };
  };
  {
    const start = arrowAt(sx, sz);
    if (start) { arrows.push(start); arrowCells.push([sx, sz]); }
    const spots = [];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (!inside(x, z) || isExit(x, z) || inPitRoom(x, z) || inHallR(x, z) || dist[z][x] < 2) continue;
      if (DIRS.filter(([dx, dz]) => !wallTo(x, z, dx, dz)).length < 3) continue;
      spots.push([x, z]);
    }
    shuffle(spots);
    for (const [x, z] of spots) {
      if (arrows.length - (start ? 1 : 0) >= L.arrowMax) break;
      if (arrowCells.some(([ax, az]) => Math.abs(ax - x) + Math.abs(az - z) < 6)) continue;
      const a = arrowAt(x, z);
      if (a) { arrows.push(a); arrowCells.push([x, z]); }
    }
  }
  // 16. explorer logs: notes taped up by people who were here before, each a clue (text + a little drawing,
  // brfx.js LOGS) about what to do. Clue 0 is always in the start room; the rest are spread out, never on a wall
  // that has an arrow on it.
  const logs = [], extraLogs = [];
  {
    const kinds = shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const want = [0, ...kinds.slice(0, LOG_COUNT - 1)];
    const free = (x, z) => [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([wx, wz]) => wallTo(x, z, wx, wz) && !used.has(wkey(x, z, wx, wz)) && !arrows.some(a => a.x === x && a.z === z && a.wx === wx && a.wz === wz));
    // a clue for each gate, taped up near the side you come to it from (9 the key, 10 the heavy door, 11 the levers)
    for (const g of locked) {
      const d = walk(g.from[0], g.from[1]), s = sec[g.from[1]][g.from[0]];
      const rooms = [];
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (d[z][x] >= 0 && d[z][x] <= 3 && plain(x, z) && sec[z][x] === s && free(x, z).length) rooms.push([x, z]);
      if (!rooms.length) continue;
      const [x, z] = rooms[Math.floor(R() * rooms.length)], walls = free(x, z), [wx, wz] = walls[Math.floor(R() * walls.length)];
      used.add(wkey(x, z, wx, wz));
      extraLogs.push({ x, z, wx, wz, k: { red: 9, heavy: 10, twin: 11 }[g.lock], off: (R() - 0.5) * 1.6, who: pick(0, 5) });
    }
    for (let tries = 0; logs.length < want.length && tries < 3000; tries++) {
      const first = !logs.length;
      const x = first ? sx : pick(0, W - 1), z = first ? sz : pick(0, D - 1);
      if (!first && (!inside(x, z) || inPitRoom(x, z) || inHallR(x, z) || isExit(x, z) || logs.some(l => l && Math.abs(l.x - x) + Math.abs(l.z - z) < 6))) continue;
      const walls = free(x, z);
      if (!walls.length) { if (first) logs.push(null); continue; }
      const [wx, wz] = walls[Math.floor(R() * walls.length)];
      logs.push({ x, z, wx, wz, k: want[logs.length], off: (R() - 0.5) * 1.6, who: pick(0, 5) });
    }
  }
  // 17. on easy, a faint worn trail in the carpet (brview.js) along the way through, task by task: start → heavy
  // door → the key → the locked door → the doorway of the pit hall → (no trail across the holes) → the levers →
  // the lever door → the exit
  let guide = null;
  if (L.guide && key && switches.length) {
    const stops = [[sx, sz], heavy.from, heavy.to, [key.x, key.z], keyDoor.from, keyDoor.to, [hallDoor.x, hallDoor.z], [hall.x, hallDoor.z],
      [SECTIONS[3].x0, hallDoor.z], [switches[0].x, switches[0].z], twin.from, [exit.x, exit.z]];
    guide = [];
    for (let i = 0; i + 1 < stops.length; i++) {
      const leg = routeBetween(stops[i], stops[i + 1]);
      for (const c of (guide.length ? leg.slice(1) : leg)) guide.push(c);
    }
  }
  return {
    seed, level: brLevel(level), W, D, vWall, hWall, sec, cz0, cz1, hall, hallDoor, halls, pitRooms, doorways, blankDoors: [], darkZones,
    holes, arrows, logs: [...logs.filter(Boolean), ...extraLogs], locked, switches, key, bad, guide,
    start: { x: sx, z: sz }, exit, monster: mon, pits: [], flicker: R(),
  };
}

// The pit hall's holes (owner's layout): along its length (west → east) a landing of at least 1.5 m inside the
// doorway, then as many holes as fit, then at least 1 m of floor that joins D's; across it (north → south) the
// holes go right up to both walls, so nobody can walk round them by the wall (owner's choice), and the floor left
// over becomes thicker wall (padN / padS). All on the 0.5 m grid. Metres.
export function hallHoles(plan) {
  const h = plan.hall, b = h.bridge, P = PIT_HOLE + b, e = 1e-9;
  const z0 = at(h.z) + 0.5, z1 = at(h.z + h.d), span = z1 - z0;
  const kz = Math.floor((span + b) / P + e), usedZ = kz * PIT_HOLE + (kz - 1) * b;
  const padN = Math.floor((span - usedZ) / 2 / 0.5 + e) * 0.5, padS = span - usedZ - padN;
  const x0 = at(h.x) + 0.5, x1 = at(h.x + h.w);
  // (and at least 1 m of floor left on D's side, so you can walk along that edge between D's rooms: the walls
  // between them end there)
  const kx = Math.floor((x1 - x0 - 2.5 + b) / P + e), usedX = kx * PIT_HOLE + (kx - 1) * b;
  const land = 1.5 + Math.floor((x1 - x0 - 2.5 - usedX) / 2 / 0.5 + e) * 0.5;
  return {
    xs: Array.from({ length: kx }, (_, i) => x0 + land + i * P), zs: Array.from({ length: kz }, (_, i) => z0 + padN + i * P),
    x0, x1, z0, z1, padN, padS, land,
  };
}

// Pit rooms: a rectangle (any size of rooms) filled with a regular grid of square holes, all the same size,
// with walkways between them as wide as the difficulty says (r.bridge). Along one side of the room (n rooms
// from room r0), where each hole starts: as many as fit. The strip left at each end, by the walls, is either
// nothing (the holes touch the wall) or at least 1 m: anything narrower would be a ledge too thin to walk on.
export const PIT_HOLE = 2.5;
export function pitHoles(r0, n, bridge, needLo = false, needHi = false) {
  const lo = BR.border + r0 * BR.cell + 0.5, span = n * BR.cell - 0.5;      // the room's floor after its wall
  // (needLo / needHi: that end has a way in, so it must keep a strip of floor; then fewer holes may fit)
  const okLo = m => (m === 0 && !needLo) || m >= 1, okHi = m => (m === 0 && !needHi) || m >= 1;
  for (let k = Math.floor((span + bridge) / (PIT_HOLE + bridge)); k >= 1; k--) {
    const left = span - k * PIT_HOLE - (k - 1) * bridge;                    // the floor left over, both ends together
    if (left < 0 || Math.abs(left * 2 - Math.round(left * 2)) > 1e-9) continue;
    // split it as evenly as the 0.5 m grid allows, so that neither end is a thin ledge
    let best = null;
    for (let a = 0; a <= left + 1e-9; a += 0.5) {
      const b = left - a;
      if (okLo(a) && okHi(b) && (best == null || Math.abs(a - b) < Math.abs(best - (left - best)))) best = a;
    }
    if (best != null) return Array.from({ length: k }, (_, i) => lo + best + i * (PIT_HOLE + bridge));
  }
  return [lo + (span - PIT_HOLE) / 2];
}

// the middle of the face of room (x, z)'s wall on side (wx, wz), and its normal (into the room). A wall fills the
// half metre after its room line, so the faces are at at(x) + 0.5 and at(x + 1) (the outer edge: at(0)).
export function wallFace(x, z, wx, wz) {
  let fx = at(x) + 2.25, fz = at(z) + 2.25;
  if (wx < 0) fx = x === 0 ? at(0) : at(x) + 0.5;
  if (wx > 0) fx = at(x + 1);
  if (wz < 0) fz = z === 0 ? at(0) : at(z) + 0.5;
  if (wz > 0) fz = at(z + 1);
  return { x: fx, z: fz, nx: -wx, nz: -wz };
}
const CELL = 0.5;

// The map definition the World is built from (same shape as the maps in maps.js).
// Every maze is checked before it is used: a player can walk from the start to the exit without
// falling, and the monster (which needs more room) can reach the start. If not, a variation of the
// seed is tried instead; every computer makes the same choice, so everyone still gets the same maze.
export function backroomsMap(variant) {
  const { seed, level } = parseBrVariant(variant);
  for (let k = 0; k < 40; k++) {
    const def = mazeDef(k ? ((seed * 7919 + k * 104729) >>> 0) || 1 : seed, level);
    def.variant = variant;
    def.level = level;
    if (def.br.bad && k < 39) continue;             // (the sections and gates couldn't be laid out: next seed)
    if (k === 39 || mazeOk(def)) return def;
  }
}

function mazeOk(def, why = false) {
  const w = new World(def), C = CELL;
  // (every ordinary door shut, the gates open: the plan promises that nothing is cut off that way, but the plan
  // works in whole rooms; here it is checked on the real floor, where a wall end can pinch a 1 m pit walkway shut)
  w.doors.forEach((d, i) => w.setDoor(i, !!d.lock));
  const wall = (ix, iz) => ix < 0 || iz < 0 || ix >= w.w || iz >= w.h || w.cellSpans(ix, iz).some(s => s.y0 < 1.8 && s.y1 > 0.42);
  const ok = (ix, iz) => {
    if (w.pitCell(ix, iz)) return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (wall(ix + dx, iz + dz)) return false;
    return true;
  };
  const reach = (ax, az, bx, bz) => {
    const a = [Math.floor(ax / C), Math.floor(az / C)], b = [Math.floor(bx / C), Math.floor(bz / C)];
    const seen = new Uint8Array(w.w * w.h), q = [a];
    seen[a[1] * w.w + a[0]] = 1;
    for (let i = 0; i < q.length; i++) {
      const [ix, iz] = q[i];
      if (Math.abs(ix - b[0]) <= 1 && Math.abs(iz - b[1]) <= 1) return true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ix + dx, nz = iz + dz, j = nz * w.w + nx;
        if (nx < 0 || nz < 0 || nx >= w.w || nz >= w.h || seen[j] || !ok(nx, nz)) continue;
        seen[j] = 1; q.push([nx, nz]);
      }
    }
    return false;
  };
  const s = w.spawns.atk[0], m = w.spawns.def[0], e = w.exit;
  const P = def.br, mid = (r) => [BR.border + r.x * BR.cell + 2.25, BR.border + r.z * BR.cell + 2.25];
  const fail = !e ? 'no exit' : !reach(s.x, s.z, e.x + e.nx * 0.8, e.z + e.nz * 0.8) ? 'exit' : !reach(m.x, m.z, s.x, s.z) ? 'monster to start'
    : !P.key || !reach(s.x, s.z, ...mid(P.key)) ? 'key' : P.switches.length !== 2 || !reach(s.x, s.z, ...mid(P.switches[0])) ? 'levers'
      : !reach(m.x, m.z, ...mid(P.switches[0])) ? 'monster to D' : '';      // (it can follow them all the way to D, across the pit hall)
  return why ? fail : !fail;
}
// (for check_br.mjs: the maze a seed makes before any retries, and why the check turns it down)
export const brTest = { mazeDef: (seed, level) => mazeDef(seed, level), mazeOk: (def) => mazeOk(def, true) };

function mazeDef(seed, level) {
  const plan = planMaze(seed, level);
  const W = plan.W, Dn = plan.D, C = BR.cell, H = BR.ceiling, T = BR.wall / 2;
  const sizeX = BR.border * 2 + W * C, sizeZ = BR.border * 2 + Dn * C;
  const inside = (x, z) => x >= 0 && z >= 0 && x < W && z < Dn && plan.sec[z][x] >= 0;
  return {
    name: 'The Backrooms',
    description: 'Co-op escape. Four sections, a new layout every game: find the exit before it finds you.',
    mode: 'br',
    theme: 'backrooms',
    size: [sizeX, sizeZ],
    massHeight: 4,
    br: plan,
    build(b) {
      // only the sections are floor; above and below C stays solid
      for (const [i, s] of SECTIONS.entries()) {
        const z0 = i === 2 ? plan.cz0 : 0, z1 = i === 2 ? plan.cz1 + 1 : Dn;
        b.open(at(s.x0), at(z0), at(s.x1 + 1), at(z1));
      }
      // walls on the room lines, from floor to ceiling (a little longer so corners close up); on every line that has
      // a section on at least one side (so the rooms by the solid parts have their wall too, like everywhere else)
      for (let z = 0; z < Dn; z++) for (let x = 0; x < W - 1; x++) {
        if (!plan.vWall[z][x] || (!inside(x, z) && !inside(x + 1, z))) continue;
        const wx = at(x + 1);
        b.wall(wx - T, at(z) - T, wx + T, at(z + 1) + T, H, 'wallpaper');
      }
      for (let z = 0; z < Dn - 1; z++) for (let x = 0; x < W; x++) {
        if (!plan.hWall[z][x] || (!inside(x, z) && !inside(x, z + 1))) continue;
        const wz = at(z + 1);
        b.wall(at(x) - T, wz - T, at(x + 1) + T, wz + T, H, 'wallpaper');
      }
      // a wall with a door-sized gap (1.5 m wide, 2.2 m high) in the middle of room line (dir, x, z)
      const gap = (d) => {
        if (d.dir === 'v') {
          const wx = at(d.x + 1), c = at(d.z) + C / 2;
          b.wall(wx - T, at(d.z) - T, wx + T, at(d.z + 1) + T, H, 'wallpaper');
          b.cut(wx - T, c - 0.75, wx + T, c + 0.75, 0, BR.door);
          return [wx - T, c - 0.75, wx + T, c + 0.75];
        }
        const wz = at(d.z + 1), c = at(d.x) + C / 2;
        b.wall(at(d.x) - T, wz - T, at(d.x + 1) + T, wz + T, H, 'wallpaper');
        b.cut(c - 0.75, wz - T, c + 0.75, wz + T, 0, BR.door);
        return [c - 0.75, wz - T, c + 0.75, wz + T];
      };
      // doorways: each one has a door that can be opened and shut (b.door; closed doors only block the way once the game applies them)
      plan.doorways.forEach((d, i) => b.door({ kind: 'way', v: d.dir === 'v', open: d.open, plan: i }, ...gap(d)));
      // the gates (THE ORDER): a locked door in a door-sized gap (heavy / the key's / the levers')
      plan.locked.forEach((d, k) => b.door({ kind: 'way', v: d.dir === 'v', open: false, plan: plan.doorways.length + k, lock: d.lock }, ...gap(d)));
      // the one doorway into the pit hall: a gap, no door
      gap(plan.hallDoor);
      // the pit hall: holes right up to its north and south walls (the floor left over is thicker wall there)
      {
        const hh = hallHoles(plan), x0 = at(plan.hall.x), x1 = at(plan.hall.x + plan.hall.w);
        if (hh.padN > 0) b.wall(x0, hh.z0 - 0.5, x1, hh.z0 + hh.padN, H, 'wallpaper');
        if (hh.padS > 0) b.wall(x0, hh.z1 - hh.padS, x1, hh.z1, H, 'wallpaper');
        for (const hx of hh.xs) for (const hz of hh.zs) b.pit(hx, hz, hx + PIT_HOLE, hz + PIT_HOLE);
      }
      // pit rooms: a grid of equal square holes (pitHoles)
      for (const r of plan.pitRooms) {
        for (const hx of r.xs || pitHoles(r.x, r.w, r.bridge)) for (const hz of r.zs || pitHoles(r.z, r.d, r.bridge)) b.pit(hx, hz, hx + PIT_HOLE, hz + PIT_HOLE);
      }
      // pillar halls: a square pillar at every room corner inside the hall
      for (const h of plan.halls) {
        for (let z = h.z; z <= h.z + h.d; z++) for (let x = h.x; x <= h.x + h.w; x++) {
          if (x === 0 || z === 0 || x === W || z === Dn) continue;
          const px = at(x), pz = at(z);
          b.wall(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5, H, 'pillar');
        }
      }
      // free-standing pillars dotted around ordinary rooms too (like the photo): on a room corner with all four
      // rooms round it inside one section, and not in the pit hall
      const R = rng(plan.seed * 7 + 3);
      const hl = plan.hall;
      for (let z = 1; z < Dn; z++) for (let x = 1; x < W; x++) {
        const s0 = inside(x - 1, z - 1) ? plan.sec[z - 1][x - 1] : -1;
        if (s0 < 0 || [[x, z - 1], [x - 1, z], [x, z]].some(([a, c]) => !inside(a, c) || plan.sec[c][a] !== s0)) continue;
        if (x >= hl.x && x <= hl.x + hl.w && z >= hl.z && z <= hl.z + hl.d) continue;
        if (plan.halls.some(h => x >= h.x && x <= h.x + h.w && z >= h.z && z <= h.z + h.d)) continue;
        if (plan.pitRooms.some(h => x >= h.x && x <= h.x + h.w && z >= h.z && z <= h.z + h.d)) continue;
        const touching = plan.vWall[z - 1][x - 1] || plan.vWall[z][x - 1] || plan.hWall[z - 1][x - 1] || plan.hWall[z - 1][x];
        if (!touching && R() < 0.12) b.wall(at(x) - 0.5, at(z) - 0.5, at(x) + 0.5, at(z) + 0.5, H, 'pillar');
      }
      // the ceiling over everything (drawn by brview.js, so it is an invisible span here)
      b.roof(BR.border, BR.border, sizeX - BR.border, sizeZ - BR.border, H, '_ceiling');
      // players start in their corner room (facing into it, east), the monster in its own
      const sx = at(plan.start.x) + C / 2, sz = at(plan.start.z) + C / 2;
      const face = Math.atan2(-1, plan.start.z ? 1 : -1);
      // six spots (online it takes up to 6 players: RULES.br)
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8], [0, -0.8], [0, 0.8]]) b.spawn('atk', sx + dx, sz + dz, face);
      b.spawn('def', at(plan.monster.x) + C / 2, at(plan.monster.z) + C / 2, 0);
      // the exit door: on the inside of the exit room's wall facing its way in (the faces of room x's walls are at
      // at(x) + 0.5 and at(x + 1): a wall fills the half metre after its room line)
      const e = plan.exit, ex = at(e.x) + 2.25, ez = at(e.z) + 2.25;
      const door = e.side === 'w' ? { x: at(e.x) + 0.5, z: ez, nx: 1, nz: 0 } : e.side === 'e' ? { x: at(e.x + 1), z: ez, nx: -1, nz: 0 }
        : e.side === 'n' ? { x: ex, z: at(e.z) + 0.5, nx: 0, nz: 1 } : { x: ex, z: at(e.z + 1), nx: 0, nz: -1 };
      b.exit(door);
    },
  };
}
