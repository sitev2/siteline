import { World } from './world.js';

// The Backrooms: a new random maze every game, built from one number (the seed) so the host,
// every player and the home server all build exactly the same one. No three.js in here.
//
// The maze sits on a grid of 4 m rooms. A random spanning tree makes sure everything is connected,
// then extra walls are knocked out for loops, some blocks become bigger rooms, some become halls of
// repeating pillars, and pitfalls (holes in the floor) are dropped in. The exit is a door in the
// outer wall, as far from the start as possible.

export const BR = {
  cells: 18,          // rooms across (4 m each)
  cell: 4,            // metres per room
  border: 1,          // solid edge around the maze
  ceiling: 2.9,       // ceiling height
  wall: 0.5,          // wall thickness
  door: 2.2,          // doorway height
};

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

// Plan the maze (pure data): walls between rooms, pillar halls, pits, start, exit, monster start.
export function planMaze(seed) {
  const R = rng(seed), N = BR.cells;
  const pick = (a, b) => a + Math.floor(R() * (b - a + 1));
  // vWall[z][x]: wall between room (x, z) and (x + 1, z); hWall[z][x]: between (x, z) and (x, z + 1)
  const vWall = Array.from({ length: N }, () => new Array(N - 1).fill(true));
  const hWall = Array.from({ length: N - 1 }, () => new Array(N).fill(true));
  const open = (x, z, dx, dz) => {
    if (dx) vWall[z][Math.min(x, x + dx)] = false;
    else hWall[Math.min(z, z + dz)][x] = false;
  };
  // 1. random spanning tree (everything connected)
  const seen = Array.from({ length: N }, () => new Array(N).fill(false));
  const stack = [[pick(0, N - 1), pick(0, N - 1)]];
  seen[stack[0][1]][stack[0][0]] = true;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const next = DIRS.map(([dx, dz]) => [x + dx, z + dz, dx, dz]).filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < N && nz < N && !seen[nz][nx]);
    if (!next.length) { stack.pop(); continue; }
    const [nx, nz, dx, dz] = next[Math.floor(R() * next.length)];
    open(x, z, dx, dz);
    seen[nz][nx] = true;
    stack.push([nx, nz]);
  }
  // 2. loops: knock out a share of the remaining walls
  for (let z = 0; z < N; z++) for (let x = 0; x < N - 1; x++) if (vWall[z][x] && R() < 0.18) vWall[z][x] = false;
  for (let z = 0; z < N - 1; z++) for (let x = 0; x < N; x++) if (hWall[z][x] && R() < 0.18) hWall[z][x] = false;
  // 3. bigger rooms and pillar halls: clear every wall inside a block
  const clearBlock = (x0, z0, w, d) => {
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w - 1; x++) vWall[z][x] = false;
    for (let z = z0; z < z0 + d - 1; z++) for (let x = x0; x < x0 + w; x++) hWall[z][x] = false;
  };
  const halls = [];
  const overlaps = (a, b) => a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.z < b.z + b.d + 1 && b.z < a.z + a.d + 1;
  for (let tries = 0; halls.length < 3 && tries < 60; tries++) {
    const h = { w: pick(4, 6), d: pick(4, 6) };
    h.x = pick(0, N - h.w); h.z = pick(0, N - h.d);
    if (halls.some(o => overlaps(o, h))) continue;
    halls.push(h);
    clearBlock(h.x, h.z, h.w, h.d);
  }
  for (let i = 0; i < 5; i++) {
    const w = pick(2, 3), d = pick(2, 3);
    clearBlock(pick(0, N - w), pick(0, N - d), w, d);
  }
  const inHall = (x, z) => halls.find(h => x >= h.x && x < h.x + h.w && z >= h.z && z < h.z + h.d);

  // distances between rooms through the openings (for the start, exit and monster)
  const walk = (sx, sz) => {
    const dist = Array.from({ length: N }, () => new Array(N).fill(-1));
    const q = [[sx, sz]]; dist[sz][sx] = 0;
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || dist[nz][nx] >= 0) continue;
        const blocked = dx ? vWall[z][Math.min(x, nx)] : hWall[Math.min(z, nz)][x];
        if (blocked) continue;
        dist[nz][nx] = dist[z][x] + 1;
        q.push([nx, nz]);
      }
    }
    return dist;
  };
  // 4. start in a corner room, the exit in the outer wall as far away as possible
  const corners = [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]];
  const [sx, sz] = corners[Math.floor(R() * 4)];
  const dist = walk(sx, sz);
  let exit = null, far = -1;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (x !== 0 && z !== 0 && x !== N - 1 && z !== N - 1) continue;      // edge rooms only
    const d = dist[z][x] + R() * 3;
    if (d > far) { far = d; exit = { x, z }; }
  }
  // which outer wall the door is in (the side facing away from the middle)
  exit.side = exit.x === 0 ? 'w' : exit.x === N - 1 ? 'e' : exit.z === 0 ? 'n' : 's';
  if (exit.x === 0 && exit.z === 0) exit.side = R() < 0.5 ? 'w' : 'n';
  if (exit.x === N - 1 && exit.z === N - 1) exit.side = R() < 0.5 ? 'e' : 's';
  // the monster starts around half way between, out of sight of the start
  const maxD = Math.max(...dist.flat());
  let mon = null, best = -Infinity;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const d = dist[z][x];
    if (d < 0 || (x === exit.x && z === exit.z)) continue;
    const score = -Math.abs(d - maxD * 0.55) + R() * 2 + (Math.hypot(x - sx, z - sz) > N * 0.4 ? 4 : -20);
    if (score > best) { best = score; mon = { x, z }; }
  }
  // 5. pit rooms: a big room whose floor is a grid of square holes with narrow walkways between them
  const pitRooms = [];
  const special = (x, z) => (Math.abs(x - sx) <= 1 && Math.abs(z - sz) <= 1) || (x === exit.x && z === exit.z) || (x === mon.x && z === mon.z);
  for (let tries = 0; pitRooms.length < 2 && tries < 80; tries++) {
    const r = { w: pick(3, 4), d: pick(3, 4) };
    r.x = pick(0, N - r.w); r.z = pick(0, N - r.d);
    if (halls.some(o => overlaps(o, r)) || pitRooms.some(o => overlaps(o, r))) continue;
    let bad = false;
    for (let z = r.z; z < r.z + r.d && !bad; z++) for (let x = r.x; x < r.x + r.w; x++) if (special(x, z)) bad = true;
    if (bad) continue;
    pitRooms.push(r);
    clearBlock(r.x, r.z, r.w, r.d);
  }
  const inPitRoom = (x, z) => pitRooms.find(r => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d);
  // 6. doorways: some openings between ordinary rooms get a wall back with a door-sized gap in it
  const doorways = [];
  const plain = (x, z) => !inHall(x, z) && !inPitRoom(x, z);
  for (let tries = 0; doorways.length < 14 && tries < 400; tries++) {
    const x = pick(0, N - 1), z = pick(0, N - 1);
    if (R() < 0.5) {
      if (x >= N - 1 || vWall[z][x] || !plain(x, z) || !plain(x + 1, z)) continue;
      if (doorways.some(d => d.dir === 'v' && d.x === x && d.z === z)) continue;
      doorways.push({ dir: 'v', x, z });
    } else {
      if (z >= N - 1 || hWall[z][x] || !plain(x, z) || !plain(x, z + 1)) continue;
      if (doorways.some(d => d.dir === 'h' && d.x === x && d.z === z)) continue;
      doorways.push({ dir: 'h', x, z });
    }
  }
  // 7. pitfalls: holes in the floor, never in the start, exit or monster rooms or next to the start
  const pits = [];
  const nPits = pick(9, 13);
  for (let tries = 0; pits.length < nPits && tries < 300; tries++) {
    const x = pick(0, N - 1), z = pick(0, N - 1);
    if (Math.abs(x - sx) + Math.abs(z - sz) < 3) continue;
    if ((x === exit.x && z === exit.z) || (x === mon.x && z === mon.z) || inPitRoom(x, z)) continue;
    if (pits.some(p => Math.abs(p.x - x) + Math.abs(p.z - z) < 2)) continue;
    const size = inHall(x, z) ? (R() < 0.5 ? 2.5 : 2) : (R() < 0.5 ? 1.5 : 2);
    // a small hole sits off-centre a little (so it isn't always in the same place); the edge of a
    // hole stays at least 1.25 m from the middle of the room, clear of walls and pillars
    const off = size <= 1.5 ? 0.5 : 0;
    const ox = pick(-1, 1) * off, oz = pick(-1, 1) * off;
    pits.push({ x, z, size, ox, oz });
  }
  return { seed, N, vWall, hWall, halls, pitRooms, doorways, start: { x: sx, z: sz }, exit, monster: mon, pits, flicker: R() };
}

// Where the holes go along one side of a pit room (length in metres, walls take the first 0.5 m):
// equal walkways of at least 1 m between square holes. Returns [start, size] of each hole.
export function holeRow(len) {
  const inner = len - 0.5;
  for (const s of [2.5, 2]) for (let n = 6; n >= 2; n--) {
    const b = (inner - s * n) / (n + 1);
    if (b >= 1 && b <= 1.6 && Math.abs(b * 2 - Math.round(b * 2)) < 1e-9) return Array.from({ length: n }, (_, i) => [0.5 + b + i * (s + b), s]);
  }
  return [[0.5 + (inner - 2) / 2, 2]];
}

// metres: the corner of room (x, z)
const at = i => BR.border + i * BR.cell;

// The map definition the World is built from (same shape as the maps in maps.js).
// Every maze is checked before it is used: a player can walk from the start to the exit without
// falling, and the monster (which needs more room) can reach the start. If not, a variation of the
// seed is tried instead; every computer makes the same choice, so everyone still gets the same maze.
export function backroomsMap(seed) {
  for (let k = 0; k < 12; k++) {
    const def = mazeDef(k ? ((seed * 7919 + k * 104729) >>> 0) || 1 : seed);
    def.variant = seed;
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

function mazeDef(seed) {
  const plan = planMaze(seed);
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
      for (const d of plan.doorways) {
        if (d.dir === 'v') {
          const wx = at(d.x + 1), c = at(d.z) + C / 2;
          b.wall(wx - T, at(d.z) - T, wx + T, at(d.z + 1) + T, H, 'wallpaper');
          b.cut(wx - T, c - 0.75, wx + T, c + 0.75, 0, BR.door);
        } else {
          const wz = at(d.z + 1), c = at(d.x) + C / 2;
          b.wall(at(d.x) - T, wz - T, at(d.x + 1) + T, wz + T, H, 'wallpaper');
          b.cut(c - 0.75, wz - T, c + 0.75, wz + T, 0, BR.door);
        }
      }
      // pit rooms: the floor is a grid of square holes
      for (const r of plan.pitRooms) {
        const X0 = at(r.x), Z0 = at(r.z);
        for (const [hx, sx] of holeRow(r.w * C)) for (const [hz, sz] of holeRow(r.d * C)) b.pit(X0 + hx, Z0 + hz, X0 + hx + sx, Z0 + hz + sz);
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
        // never right next to a hole in the floor (it would leave a gap too narrow to get past)
        if (plan.pits.some(p => (p.x === x || p.x === x - 1) && (p.z === z || p.z === z - 1))) continue;
        const touching = (plan.vWall[z - 1] && plan.vWall[z - 1][x - 1]) || (plan.vWall[z] && plan.vWall[z][x - 1])
          || (plan.hWall[z - 1] && (plan.hWall[z - 1][x - 1] || plan.hWall[z - 1][x]));
        if (!touching && R() < 0.35) b.wall(at(x) - 0.5, at(z) - 0.5, at(x) + 0.5, at(z) + 0.5, H, 'pillar');
      }
      // the ceiling over everything (drawn by brview.js, so it is an invisible span here)
      b.roof(BR.border, BR.border, size - BR.border, size - BR.border, H, '_ceiling');
      // pitfalls
      for (const p of plan.pits) {
        const cx = at(p.x) + C / 2 + p.ox, cz = at(p.z) + C / 2 + p.oz, s = p.size / 2;
        b.pit(cx - s, cz - s, cx + s, cz + s);
      }
      // players start in their corner room, the monster in its own
      const sx = at(plan.start.x) + C / 2, sz = at(plan.start.z) + C / 2;
      const toMid = Math.atan2(-(size / 2 - sx), -(size / 2 - sz));
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) b.spawn('atk', sx + dx, sz + dz, toMid);
      b.spawn('def', at(plan.monster.x) + C / 2, at(plan.monster.z) + C / 2, 0);
      // the exit door in the outer wall
      const e = plan.exit, ex = at(e.x) + C / 2, ez = at(e.z) + C / 2, B = BR.border;
      const door = e.side === 'w' ? { x: B, z: ez, nx: 1, nz: 0 } : e.side === 'e' ? { x: size - B, z: ez, nx: -1, nz: 0 }
        : e.side === 'n' ? { x: ex, z: B, nx: 0, nz: 1 } : { x: ex, z: size - B, nx: 0, nz: -1 };
      b.exit(door);
    },
  };
}
