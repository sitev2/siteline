import { World } from './world.js';

// The Backrooms: a new random maze every game, built from one number (the seed) so the host,
// every player and the home server all build exactly the same one. No three.js in here.
//
// The maze sits on a grid of 4 m rooms. A random spanning tree makes sure everything is connected,
// then extra walls are knocked out for loops, some blocks become bigger rooms, one becomes a hall of
// repeating pillars, and two pit rooms (a grid of equal square holes with narrow walkways) are set across
// the way to the exit. The exit is a door in a small room out in the maze, as far from the start as possible, whose
// walls touch no other wall (so keeping a hand on the wall never gets you there); big black arrows on a few walls
// point the rough compass direction of it.

export const BR = {
  cells: 28,          // rooms across (4 m each); was 20, the owner asked for a bigger map (about twice the area)
  cell: 4,            // metres per room
  border: 1,          // solid edge around the maze
  ceiling: 2.9,       // ceiling height
  wall: 0.5,          // wall thickness
  door: 2.2,          // doorway height
  walk: 2.7,          // m/s: how fast you walk (the normal speed in here; quiet)
  sprint: 4.5,        // m/s: holding Shift (or the run button): loud, it hears you
};

// The three difficulties. Maze: how wide the walkways between the holes of the pit rooms are (m), how many
// ceiling holes, dark areas and arrows. Monster: how much faster than your sprint it
// runs, how far it sees (sight; once chasing you, chaseSight), how wide it looks (fov, radians each side),
// how long it keeps after you once you are out of sight (lose, s) and how far ahead it guesses (lead, s),
// how far it hears running / walking, how many places it searches and when it wakes up (s).
export const BR_LEVELS = {
  easy: {
    bridge: 1.5, holes: 4, dark: 4, arrows: 0.22,
    monster: { speed: 1.05, sight: 16, chaseSight: 13, fov: 1.0, lose: 0.25, lead: 0.7, hear: 11, hearWalk: 2.5, search: 3, wake: 30 },
  },
  normal: {
    bridge: 1, holes: 6, dark: 6, arrows: 0.15,
    monster: { speed: 1.10, sight: 22, chaseSight: 19, fov: 1.2, lose: 0.55, lead: 1.2, hear: 14, hearWalk: 3, search: 4, wake: 20 },
  },
  hard: {
    bridge: 0.5, holes: 7, dark: 8, arrows: 0.09,
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

// Plan the maze (pure data): walls between rooms, the pillar hall, pit rooms, doors, start, exit, monster
// start, arrows. `level` is the difficulty (BR_LEVELS).
export function planMaze(seed, level = 'normal') {
  const R = rng(seed), N = BR.cells, L = BR_LEVELS[brLevel(level)];
  const pick = (a, b) => a + Math.floor(R() * (b - a + 1));
  // vWall[z][x]: wall between room (x, z) and (x + 1, z); hWall[z][x]: between (x, z) and (x, z + 1)
  const vWall = Array.from({ length: N }, () => new Array(N - 1).fill(true));
  const hWall = Array.from({ length: N - 1 }, () => new Array(N).fill(true));
  const open = (x, z, dx, dz) => {
    if (dx) vWall[z][Math.min(x, x + dx)] = false;
    else hWall[Math.min(z, z + dz)][x] = false;
  };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const inside = (x, z) => x >= 0 && z >= 0 && x < N && z < N;
  // is there a wall between room (x, z) and the next one in direction (dx, dz)? (the outer wall counts)
  const wallTo = (x, z, dx, dz) => {
    const nx = x + dx, nz = z + dz;
    if (!inside(nx, nz)) return true;
    return dx ? vWall[z][Math.min(x, nx)] : hWall[Math.min(z, nz)][x];
  };
  // 1. random spanning tree (everything connected)
  const seen = Array.from({ length: N }, () => new Array(N).fill(false));
  const stack = [[pick(0, N - 1), pick(0, N - 1)]];
  seen[stack[0][1]][stack[0][0]] = true;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const next = DIRS.map(([dx, dz]) => [x + dx, z + dz, dx, dz]).filter(([nx, nz]) => inside(nx, nz) && !seen[nz][nx]);
    if (!next.length) { stack.pop(); continue; }
    const [nx, nz, dx, dz] = next[Math.floor(R() * next.length)];
    open(x, z, dx, dz);
    seen[nz][nx] = true;
    stack.push([nx, nz]);
  }
  // 2. loops: knock out a share of the remaining walls (fewer loops = longer ways round)
  for (let z = 0; z < N; z++) for (let x = 0; x < N - 1; x++) if (vWall[z][x] && R() < 0.14) vWall[z][x] = false;
  for (let z = 0; z < N - 1; z++) for (let x = 0; x < N; x++) if (hWall[z][x] && R() < 0.14) hWall[z][x] = false;
  // 3. bigger rooms and one pillar hall: clear every wall inside a block
  const clearBlock = (x0, z0, w, d) => {
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w - 1; x++) vWall[z][x] = false;
    for (let z = z0; z < z0 + d - 1; z++) for (let x = x0; x < x0 + w; x++) hWall[z][x] = false;
  };
  const overlaps = (a, b) => a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.z < b.z + b.d + 1 && b.z < a.z + a.d + 1;
  const halls = [];
  {
    const h = { w: pick(3, 5), d: pick(3, 5) };
    h.x = pick(1, N - h.w - 1); h.z = pick(1, N - h.d - 1);
    halls.push(h);
    clearBlock(h.x, h.z, h.w, h.d);
  }
  for (let i = 0; i < Math.round(5 * N * N / 400); i++) {       // (as many per area as on the old 20 × 20 maze)
    const w = pick(2, 3), d = pick(2, 3);
    clearBlock(pick(0, N - w), pick(0, N - d), w, d);
  }
  const inHall = (x, z) => halls.find(h => x >= h.x && x < h.x + h.w && z >= h.z && z < h.z + h.d);

  // distances between rooms through the openings (for the start, exit, monster, pit rooms and arrows)
  const walk = (sx, sz) => {
    const dist = Array.from({ length: N }, () => new Array(N).fill(-1));
    const q = [[sx, sz]]; dist[sz][sx] = 0;
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
  // 4. start in a corner room. The exit is a door in a small room out in the maze, as far from the start as
  // possible, and every wall that met that room's corners from outside is knocked out, so its walls touch no
  // other wall: an island. Keeping a hand on the wall (always turning left, or always right) only ever goes
  // round the walls you started at, so it never finds the exit (owner's request).
  const corners = [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]];
  const [sx, sz] = corners[Math.floor(R() * 4)];
  let dist = walk(sx, sz);
  let exit = null, far = -1;
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    if (Math.abs(x - sx) + Math.abs(z - sz) < N) continue;                    // never on the start's side of the maze
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
  // the rooms round the exit room (its walls must stay an island: no pit rooms or doors there)
  const byExit = (x, z) => Math.abs(x - exit.x) <= 1 && Math.abs(z - exit.z) <= 1;
  dist = walk(sx, sz);
  // the monster starts around half way between, out of sight of the start
  const maxD = Math.max(...dist.flat());
  let mon = null, best = -Infinity;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const d = dist[z][x];
    if (d < 0 || (x === exit.x && z === exit.z)) continue;
    const score = -Math.abs(d - maxD * 0.55) + R() * 2 + (Math.hypot(x - sx, z - sz) > N * 0.4 ? 4 : -20);
    if (score > best) { best = score; mon = { x, z }; }
  }
  // 5. pit rooms, set across the way to the exit: the floor is almost all hole, with narrow bridges between
  // the middles of its rooms (a random tree of them, so the way across winds) and out to each way in.
  const special = (x, z) => (Math.abs(x - sx) <= 1 && Math.abs(z - sz) <= 1) || byExit(x, z) || (x === mon.x && z === mon.z);
  // the way from the start to the exit, room by room
  const route = [];
  {
    const back = walk(exit.x, exit.z);
    let x = sx, z = sz;
    route.push([x, z]);
    for (let g = 0; g < N * N && !(x === exit.x && z === exit.z); g++) {
      const nxt = DIRS.find(([dx, dz]) => inside(x + dx, z + dz) && !wallTo(x, z, dx, dz) && back[z + dz][x + dx] === back[z][x] - 1);
      if (!nxt) break;
      x += nxt[0]; z += nxt[1];
      route.push([x, z]);
    }
  }
  const pitRooms = [];
  for (const frac of [0.38, 0.7]) {
    for (let tries = 0; tries < 40; tries++) {
      const k = Math.max(0, Math.min(route.length - 1, Math.round(route.length * frac) + pick(-3, 3)));
      const [cx, cz] = route[k];
      // a rectangle of rooms: 2×3, 3×2 or 3×3 (8×12, 12×8 or 12×12 m)
      const r = { w: pick(2, 3), d: pick(2, 3) };
      if (r.w * r.d < 6) r[R() < 0.5 ? 'w' : 'd'] = 3;
      r.x = cx - pick(0, r.w - 1); r.z = cz - pick(0, r.d - 1);
      if (r.x < 0 || r.z < 0 || r.x + r.w > N || r.z + r.d > N) continue;
      if (halls.some(o => overlaps(o, r)) || pitRooms.some(o => overlaps(o, r))) continue;
      let bad = false;
      for (let z = r.z; z < r.z + r.d && !bad; z++) for (let x = r.x; x < r.x + r.w; x++) if (special(x, z)) bad = true;
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
  // 6. doorways: three openings between ordinary rooms get a wall back with a door in it. The monster can't
  // open doors, so a door only goes where there is another way round even with every door shut (a long
  // one: 6+ rooms): shutting one makes it go the long way, but never seals anyone in (or it out).
  const doorways = [];
  const plain = (x, z) => !inHall(x, z) && !inPitRoom(x, z) && !byExit(x, z);
  // rooms reachable from (x0, z0) with every door in `list` shut: steps to each (-1 = can't get there)
  const walkShut = (list, x0, z0) => {
    const isDoor = (x, z, dx, dz) => list.some(d => (dx ? d.dir === 'v' && d.z === z && d.x === Math.min(x, x + dx) : d.dir === 'h' && d.x === x && d.z === Math.min(z, z + dz)));
    const dist = new Int16Array(N * N).fill(-1), q = [[x0, z0]];
    dist[z0 * N + x0] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!inside(nx, nz) || dist[nz * N + nx] >= 0 || wallTo(x, z, dx, dz) || isDoor(x, z, dx, dz)) continue;
        dist[nz * N + nx] = dist[z * N + x] + 1; q.push([nx, nz]);
      }
    }
    return dist;
  };
  // a door is only worth having if going round it is a real detour (6+ rooms), and it never seals anything off
  const goodDoor = (list, d) => {
    const dist = walkShut(list, d.x, d.z);
    if (dist.some(v => v < 0)) return false;
    return dist[(d.dir === 'v' ? d.z * N + d.x + 1 : (d.z + 1) * N + d.x)] >= 6;
  };
  for (let tries = 0; doorways.length < 3 && tries < 1500; tries++) {
    const x = pick(0, N - 1), z = pick(0, N - 1);
    if (doorways.some(d => Math.abs(d.x - x) + Math.abs(d.z - z) < 5)) continue;      // spread out
    let d;
    if (R() < 0.5) {
      if (x >= N - 1 || vWall[z][x] || !plain(x, z) || !plain(x + 1, z)) continue;
      d = { dir: 'v', x, z, open: R() < 0.6 };
    } else {
      if (z >= N - 1 || hWall[z][x] || !plain(x, z) || !plain(x, z + 1)) continue;
      d = { dir: 'h', x, z, open: R() < 0.6 };
    }
    if (goodDoor([...doorways, d], d)) doorways.push(d);
  }
  // 6b. team shortcuts (owner's picks; they need two or more players, so a solo game just goes the long way):
  // walls that would cut the way to the exit short by 10+ rooms get a locked door instead: a red one (its key is
  // on a shelf too high to reach without climbing onto someone's shoulders), a heavy one (two must push at once)
  // and a 'twin' one that opens when two switches in different rooms are pressed together. They stay walls in the
  // plan, so the maze is solved without them.
  const used = new Set();                    // walls (room + side) taken by a locked door, a switch or the key shelf
  const wkey = (x, z, wx, wz) => `${x},${z},${wx},${wz}`;
  const distE = walk(exit.x, exit.z);
  const locked = [], switches = [];
  let key = null;
  {
    const cands = [];
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) for (const [dir, dx, dz] of [['v', 1, 0], ['h', 0, 1]]) {
      const x2 = x + dx, z2 = z + dz;
      if (!inside(x2, z2) || !wallTo(x, z, dx, dz) || !plain(x, z) || !plain(x2, z2)) continue;
      if (doorways.some(d => Math.abs(d.x - x) + Math.abs(d.z - z) < 3) || distE[z][x] < 0 || distE[z2][x2] < 0) continue;
      if ((Math.abs(x - sx) <= 1 && Math.abs(z - sz) <= 1) || (Math.abs(x2 - sx) <= 1 && Math.abs(z2 - sz) <= 1)) continue;
      const gain = Math.abs(distE[z][x] - distE[z2][x2]) - 1;
      // `from`: the side you come from (further from the exit); `to`: the side it lets you through to
      const fromA = distE[z][x] > distE[z2][x2];
      if (gain >= 10) cands.push({ dir, x, z, gain, from: fromA ? [x, z] : [x2, z2], to: fromA ? [x2, z2] : [x, z], score: gain * (0.6 + R() * 0.8) });
    }
    cands.sort((a, b) => b.score - a.score);
    // a free wall in room (x, z) for a switch or the shelf: not open, not a locked door, not taken
    const freeWall = (x, z) => [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([wx, wz]) => wallTo(x, z, wx, wz) && !used.has(wkey(x, z, wx, wz)));
    // rooms by how far they are (on foot) from room (x, z)
    const around = (x, z, lo, hi) => { const d = walk(x, z), out = []; for (let zz = 0; zz < N; zz++) for (let xx = 0; xx < N; xx++) if (d[zz][xx] >= lo && d[zz][xx] <= hi && plain(xx, zz) && !(Math.abs(xx - sx) <= 1 && Math.abs(zz - sz) <= 1)) out.push([xx, zz, d[zz][xx]]); return out; };
    for (const lock of ['red', 'heavy', 'twin']) {
      for (const c of cands) {
        if (locked.some(o => Math.abs(o.x - c.x) + Math.abs(o.z - c.z) < 6)) continue;
        if (used.has(wkey(c.x, c.z, c.dir === 'v' ? 1 : 0, c.dir === 'h' ? 1 : 0))) continue;
        const [fx, fz] = c.from;
        let extra = null;
        if (lock === 'red') {
          // the key: on a high shelf 2–7 rooms back from the door, on the side you come from
          const rooms = around(fx, fz, 2, 7);
          for (let k = 0; k < 40 && !extra && rooms.length; k++) {
            const [kx, kz] = rooms[Math.floor(R() * rooms.length)], ws = freeWall(kx, kz);
            if (ws.length) { const [wx, wz] = ws[Math.floor(R() * ws.length)]; extra = { x: kx, z: kz, wx, wz }; }
          }
        } else if (lock === 'twin') {
          // two switches in different rooms near the door (1–5 rooms back), at least 3 rooms apart on foot
          const rooms = around(fx, fz, 1, 5);
          for (let k = 0; k < 80 && !extra && rooms.length > 1; k++) {
            const a = rooms[Math.floor(R() * rooms.length)], b = rooms[Math.floor(R() * rooms.length)];
            if (walk(a[0], a[1])[b[1]][b[0]] < 3) continue;
            const wa = freeWall(a[0], a[1]), wb = freeWall(b[0], b[1]);
            if (wa.length && wb.length) extra = [{ x: a[0], z: a[1], wx: wa[0][0], wz: wa[0][1] }, { x: b[0], z: b[1], wx: wb[0][0], wz: wb[0][1] }];
          }
        } else extra = true;
        if (!extra) continue;
        locked.push({ dir: c.dir, x: c.x, z: c.z, lock, from: c.from, to: c.to });
        used.add(wkey(c.x, c.z, c.dir === 'v' ? 1 : 0, c.dir === 'h' ? 1 : 0));
        used.add(wkey(c.x + (c.dir === 'v' ? 1 : 0), c.z + (c.dir === 'h' ? 1 : 0), c.dir === 'v' ? -1 : 0, c.dir === 'h' ? -1 : 0));
        if (lock === 'red') { key = extra; used.add(wkey(extra.x, extra.z, extra.wx, extra.wz)); }
        if (lock === 'twin') for (const sw of extra) { switches.push(sw); used.add(wkey(sw.x, sw.z, sw.wx, sw.wz)); }
        break;
      }
    }
  }
  // 7. dark areas: blocks of rooms whose lights are all dead (bring a flashlight); never the start or the
  // exit, and (except on hard) never over a pit room
  const darkZones = [];
  for (let tries = 0; darkZones.length < L.dark && tries < 400; tries++) {
    const r = { w: pick(2, 4), d: pick(2, 4) };
    r.x = pick(0, N - r.w); r.z = pick(0, N - r.d);
    if (darkZones.some(o => overlaps(o, r))) continue;
    if (level !== 'hard' && pitRooms.some(o => overlaps(o, r))) continue;
    let bad = false;
    for (let z = r.z; z < r.z + r.d && !bad; z++) for (let x = r.x; x < r.x + r.w; x++) if (Math.abs(x - sx) <= 1 && Math.abs(z - sz) <= 1 || (x === exit.x && z === exit.z)) bad = true;
    if (!bad) darkZones.push(r);
  }
  // 8. ceiling holes: a missing or pushed-aside ceiling tile (0.6 m tiles), off the middle of a room so it
  // isn't under the light. Something lives up there: walk under one and it takes you.
  const holes = [];
  const T = 0.6;
  for (let tries = 0; holes.length < L.holes && tries < 400; tries++) {
    const x = pick(0, N - 1), z = pick(0, N - 1);
    if (Math.abs(x - sx) <= 1 && Math.abs(z - sz) <= 1) continue;
    if ((x === exit.x && z === exit.z) || inPitRoom(x, z)) continue;
    if (holes.some(h => Math.abs(h.rx - x) + Math.abs(h.rz - z) < 2)) continue;
    // a tile about 1.1 m from the middle of the room, to one side
    const cx = BR.border + x * BR.cell + 2.25, cz = BR.border + z * BR.cell + 2.25;
    const ang = pick(0, 3) * Math.PI / 2 + Math.PI / 4;
    const tx = Math.floor((cx + Math.cos(ang) * 1.1) / T) * T, tz = Math.floor((cz + Math.sin(ang) * 1.1) / T) * T;
    holes.push({ rx: x, rz: z, x: tx + T / 2, z: tz + T / 2, size: T, kind: R() < 0.5 ? 'missing' : 'shifted', dir: pick(0, 3) });
  }
  // 9. big black arrows sprayed on walls (the owner asked for fewer, and vaguer): in a few of the rooms where the
  // way splits (and always the start), pointing the rough compass direction of the exit, as the crow flies, not
  // the way through the maze; on a wall that runs that way
  dist = walk(exit.x, exit.z);
  const arrows = [];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if ((x === exit.x && z === exit.z) || inPitRoom(x, z) || dist[z][x] < 2) continue;
    const ways = DIRS.filter(([dx, dz]) => !wallTo(x, z, dx, dz));
    const atStart = x === sx && z === sz;
    if (!atStart && (ways.length < 3 || R() > L.arrows)) continue;
    const ox = exit.x - x, oz = exit.z - z, big = Math.max(Math.abs(ox), Math.abs(oz)), small = Math.min(Math.abs(ox), Math.abs(oz));
    // the bigger of the two compass directions; when it's nearly diagonal, either
    let alongX = Math.abs(ox) >= Math.abs(oz);
    if (small > big * 0.5 && R() < 0.4) alongX = !alongX;
    const dx = alongX ? Math.sign(ox) : 0, dz = alongX ? 0 : Math.sign(oz);
    if (!dx && !dz) continue;
    // a solid wall of this room running the same way (its normal is across the arrow)
    const walls = (dx ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]).filter(([wx, wz]) => wallTo(x, z, wx, wz) && !used.has(wkey(x, z, wx, wz)));
    if (!walls.length) continue;
    const [wx, wz] = walls[Math.floor(R() * walls.length)];
    arrows.push({ x, z, wx, wz, dx, dz, tilt: (R() - 0.5) * 0.18, s: 0.95 + R() * 0.1 });
  }
  // 10. explorer logs: notes taped up by people who were here before, each a clue (text + a little drawing,
  // brfx.js LOGS) about what to do. Clue 0 is always in the start room; the rest are spread out, never on a wall
  // that has an arrow on it.
  const logs = [], extraLogs = [];
  {
    const kinds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
    const want = [0, ...kinds.slice(0, LOG_COUNT - 1)];
    const free = (x, z) => [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([wx, wz]) => wallTo(x, z, wx, wz) && !used.has(wkey(x, z, wx, wz)) && !arrows.some(a => a.x === x && a.z === z && a.wx === wx && a.wz === wz));
    // a clue for each team shortcut, taped up near the side you come to it from (9 red key, 10 heavy, 11 switches)
    for (const L of locked) {
      const d = walk(L.from[0], L.from[1]);
      const rooms = [];
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (d[z][x] >= 0 && d[z][x] <= 3 && plain(x, z) && free(x, z).length) rooms.push([x, z]);
      if (!rooms.length) continue;
      const [x, z] = rooms[Math.floor(R() * rooms.length)], walls = free(x, z), [wx, wz] = walls[Math.floor(R() * walls.length)];
      used.add(wkey(x, z, wx, wz));
      extraLogs.push({ x, z, wx, wz, k: { red: 9, heavy: 10, twin: 11 }[L.lock], off: (R() - 0.5) * 1.6, who: pick(0, 5) });
    }
    for (let tries = 0; logs.length < want.length && tries < 3000; tries++) {
      const first = !logs.length;
      const x = first ? sx : pick(0, N - 1), z = first ? sz : pick(0, N - 1);
      if (!first && (inPitRoom(x, z) || (x === exit.x && z === exit.z) || logs.some(l => l && Math.abs(l.x - x) + Math.abs(l.z - z) < 6))) continue;
      const walls = free(x, z);
      if (!walls.length) { if (first) logs.push(null); continue; }
      const [wx, wz] = walls[Math.floor(R() * walls.length)];
      logs.push({ x, z, wx, wz, k: want[logs.length], off: (R() - 0.5) * 1.6, who: pick(0, 5) });
    }
  }
  return {
    seed, level: brLevel(level), N, vWall, hWall, halls, pitRooms, doorways, blankDoors: [], darkZones, holes, arrows, logs: [...logs.filter(Boolean), ...extraLogs],
    locked, switches, key,
    start: { x: sx, z: sz }, exit, monster: mon, pits: [], flicker: R(),
  };
}

// Pit rooms: a rectangle (any size of rooms) filled with a regular grid of square holes, all the same size,
// with walkways between them as wide as the difficulty says (r.bridge). Along one side of the room (n rooms
// from room r0), where each hole starts: as many as fit. The strip left at each end, by the walls, is either
// nothing (the holes touch the wall) or at least 1 m: anything narrower would be a ledge too thin to walk on.
export const PIT_HOLE = 2.5;
export function pitHoles(r0, n, bridge) {
  const lo = BR.border + r0 * BR.cell + 0.5, span = n * BR.cell - 0.5;      // the room's floor after its wall
  const ok = m => m === 0 || m >= 1;
  for (let k = Math.floor((span + bridge) / (PIT_HOLE + bridge)); k >= 1; k--) {
    const left = span - k * PIT_HOLE - (k - 1) * bridge;                    // the floor left over, both ends together
    if (left < 0 || Math.abs(left * 2 - Math.round(left * 2)) > 1e-9) continue;
    // split it as evenly as the 0.5 m grid allows, so that neither end is a thin ledge
    let best = null;
    for (let a = 0; a <= left + 1e-9; a += 0.5) {
      const b = left - a;
      if (ok(a) && ok(b) && (!best || Math.abs(a - b) < Math.abs(best - (left - best)))) best = a;
    }
    if (best != null) return Array.from({ length: k }, (_, i) => lo + best + i * (PIT_HOLE + bridge));
  }
  return [lo + (span - PIT_HOLE) / 2];
}

// metres: the corner of room (x, z)
const at = i => BR.border + i * BR.cell;
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
  for (let k = 0; k < 12; k++) {
    const def = mazeDef(k ? ((seed * 7919 + k * 104729) >>> 0) || 1 : seed, level);
    def.variant = variant;
    def.level = level;
    if (k === 11 || mazeOk(def)) return def;
  }
}

function mazeOk(def) {
  const w = new World(def), C = 0.5;
  const wall = (ix, iz) => ix < 0 || iz < 0 || ix >= w.w || iz >= w.h || w.cellSpans(ix, iz).some(s => s.m[0] !== '_' && s.y0 < 1.8 && s.y1 > 0.42);
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
  return !!e && reach(s.x, s.z, e.x + e.nx * 0.8, e.z + e.nz * 0.8) && reach(m.x, m.z, s.x, s.z);
}

function mazeDef(seed, level) {
  const plan = planMaze(seed, level);
  const N = BR.cells, C = BR.cell, H = BR.ceiling, T = BR.wall / 2;
  const size = BR.border * 2 + N * C;
  return {
    name: 'The Backrooms',
    description: 'Co-op escape. A new maze every game: find the exit before it finds you.',
    mode: 'br',
    theme: 'backrooms',
    size: [size, size],
    massHeight: 4,
    br: plan,
    build(b) {
      b.open(BR.border, BR.border, size - BR.border, size - BR.border);
      // walls on the room lines, from floor to ceiling (a little longer so corners close up)
      for (let z = 0; z < N; z++) for (let x = 0; x < N - 1; x++) {
        if (!plan.vWall[z][x]) continue;
        const wx = at(x + 1);
        b.wall(wx - T, at(z) - T, wx + T, at(z + 1) + T, H, 'wallpaper');
      }
      for (let z = 0; z < N - 1; z++) for (let x = 0; x < N; x++) {
        if (!plan.hWall[z][x]) continue;
        const wz = at(z + 1);
        b.wall(at(x) - T, wz - T, at(x + 1) + T, wz + T, H, 'wallpaper');
      }
      // doorways: a wall with a door-sized gap (1.5 m wide, 2.2 m high) in the middle
      // (each one has a door that can be opened and shut: b.door; closed doors only block the way once the game applies them)
      plan.doorways.forEach((d, i) => {
        if (d.dir === 'v') {
          const wx = at(d.x + 1), c = at(d.z) + C / 2;
          b.wall(wx - T, at(d.z) - T, wx + T, at(d.z + 1) + T, H, 'wallpaper');
          b.cut(wx - T, c - 0.75, wx + T, c + 0.75, 0, BR.door);
          b.door({ kind: 'way', v: true, open: d.open, plan: i }, wx - T, c - 0.75, wx + T, c + 0.75);
        } else {
          const wz = at(d.z + 1), c = at(d.x) + C / 2;
          b.wall(at(d.x) - T, wz - T, at(d.x + 1) + T, wz + T, H, 'wallpaper');
          b.cut(c - 0.75, wz - T, c + 0.75, wz + T, 0, BR.door);
          b.door({ kind: 'way', v: false, open: d.open, plan: i }, c - 0.75, wz - T, c + 0.75, wz + T);
        }
      });
      // the team shortcuts: a door-sized gap in their wall, with a locked door in it (red / heavy / twin)
      for (const d of plan.locked || []) {
        const i = (plan.doorways || []).length + plan.locked.indexOf(d);
        if (d.dir === 'v') {
          const wx = at(d.x + 1), c = at(d.z) + C / 2;
          b.cut(wx - T, c - 0.75, wx + T, c + 0.75, 0, BR.door);
          b.door({ kind: 'way', v: true, open: false, plan: i, lock: d.lock }, wx - T, c - 0.75, wx + T, c + 0.75);
        } else {
          const wz = at(d.z + 1), c = at(d.x) + C / 2;
          b.cut(c - 0.75, wz - T, c + 0.75, wz + T, 0, BR.door);
          b.door({ kind: 'way', v: false, open: false, plan: i, lock: d.lock }, c - 0.75, wz - T, c + 0.75, wz + T);
        }
      }
      // pit rooms: a grid of equal square holes (pitHoles)
      for (const r of plan.pitRooms) {
        for (const hx of pitHoles(r.x, r.w, r.bridge)) for (const hz of pitHoles(r.z, r.d, r.bridge)) b.pit(hx, hz, hx + PIT_HOLE, hz + PIT_HOLE);
      }
      // pillar halls: a square pillar at every room corner inside the hall
      for (const h of plan.halls) {
        for (let z = h.z; z <= h.z + h.d; z++) for (let x = h.x; x <= h.x + h.w; x++) {
          if (x === 0 || z === 0 || x === N || z === N) continue;
          const px = at(x), pz = at(z);
          b.wall(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5, H, 'pillar');
        }
      }
      // free-standing pillars dotted around ordinary rooms too (like the photo)
      const R = rng(plan.seed * 7 + 3);
      for (let z = 1; z < N; z++) for (let x = 1; x < N; x++) {
        if (plan.halls.some(h => x >= h.x && x <= h.x + h.w && z >= h.z && z <= h.z + h.d)) continue;
        if (plan.pitRooms.some(h => x >= h.x && x <= h.x + h.w && z >= h.z && z <= h.z + h.d)) continue;
        const touching = (plan.vWall[z - 1] && plan.vWall[z - 1][x - 1]) || (plan.vWall[z] && plan.vWall[z][x - 1])
          || (plan.hWall[z - 1] && (plan.hWall[z - 1][x - 1] || plan.hWall[z - 1][x]));
        if (!touching && R() < 0.12) b.wall(at(x) - 0.5, at(z) - 0.5, at(x) + 0.5, at(z) + 0.5, H, 'pillar');
      }
      // the ceiling over everything (drawn by brview.js, so it is an invisible span here)
      b.roof(BR.border, BR.border, size - BR.border, size - BR.border, H, '_ceiling');
      // players start in their corner room, the monster in its own
      const sx = at(plan.start.x) + C / 2, sz = at(plan.start.z) + C / 2;
      const toMid = Math.atan2(-(size / 2 - sx), -(size / 2 - sz));
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) b.spawn('atk', sx + dx, sz + dz, toMid);
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
