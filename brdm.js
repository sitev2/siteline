import { BR, rng } from './brmap.js';

// Backrooms deathmatch (owner's request): the Backrooms' look (yellow wallpaper, damp carpet, buzzing panels, the
// same doors) as a free-for-all map with guns. Unlike Level 0 it is ONE fixed layout per size (the same every game,
// so players can learn it), and much roomier: big halls of 2 × 2 up to 3 × 3 rooms (8–12 m across) instead of a maze
// of 4 m rooms, wide openings as well as doorways, pillar halls and short free-standing walls for cover.
// Doors work as in Level 0 (E / the hand button, host's toggleDoor), but here bullets go through a shut door
// (`pen`) and bots open the ones in their way. No monster, pits, holes, gates or exit.
//
// Sizes (owner: the big one no bigger than Railyard's large, 60 × 52 m):
//   small  9 × 7 rooms  = 38 × 30 m  (2–3 players)
//   large 14 × 12 rooms = 58 × 50 m  (4–6 players)
// The light colour differs by quarter (as Level 0's sections do), so you can tell where you are.

export const BRDM_SIZES = {
  small: { W: 9, D: 7, seed: 9001, spawns: 8, doors: 7 },
  large: { W: 14, D: 12, seed: 4207, spawns: 16, doors: 16 },
};
const at = i => BR.border + i * BR.cell;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// The layout (pure data, deterministic): rooms (rectangles of grid rooms), walls between them, openings, doorways
// (with or without a door), what stands inside each hall, and where people spawn.
export function brDmPlan(size) {
  const S = BRDM_SIZES[size] || BRDM_SIZES.small, W = S.W, D = S.D;
  const R = rng(S.seed);
  const pickW = (list) => { let t = list.reduce((a, o) => a + o.w, 0) * R(); for (const o of list) if ((t -= o.w) < 0) return o; return list[list.length - 1]; };
  // 1. split the grid into halls and a few corridors (big ones far more likely: "more spaced out than usual")
  const owner = new Array(W * D).fill(-1), rooms = [];
  const SHAPES = [
    { s: [3, 3], w: 5 }, { s: [3, 2], w: 5 }, { s: [2, 3], w: 5 }, { s: [2, 2], w: 6 },
    { s: [4, 2], w: 1.5 }, { s: [2, 4], w: 1.5 }, { s: [3, 1], w: 1 }, { s: [1, 3], w: 1 },
    { s: [2, 1], w: 0.6 }, { s: [1, 2], w: 0.6 }, { s: [1, 1], w: 0.2 },
  ];
  const free = (x, z, w, d) => { if (x + w > W || z + d > D) return false; for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (owner[(z + j) * W + x + i] >= 0) return false; return true; };
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (owner[z * W + x] >= 0) continue;
    const fit = SHAPES.filter(o => free(x, z, o.s[0], o.s[1]));
    const [w, d] = pickW(fit).s, id = rooms.length;
    rooms.push({ id, x, z, w, d, links: 0 });
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) owner[(z + j) * W + x + i] = id;
  }
  const own = (x, z) => owner[z * W + x];
  // walls on every room line between two different halls (the outer edge is solid rock)
  const vWall = Array.from({ length: D }, (_, z) => Array.from({ length: W - 1 }, (_, x) => own(x, z) !== own(x + 1, z)));
  const hWall = Array.from({ length: D - 1 }, (_, z) => Array.from({ length: W }, (_, x) => own(x, z) !== own(x, z + 1)));
  // 2. which halls touch, and along which stretches of wall
  const edges = new Map();
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (x + dx >= W || z + dz >= D) continue;
      const a = own(x, z), b = own(x + dx, z + dz);
      if (a === b) continue;
      const k = `${Math.min(a, b)},${Math.max(a, b)}`;
      if (!edges.has(k)) edges.set(k, { a: Math.min(a, b), b: Math.max(a, b), segs: [] });
      edges.get(k).segs.push({ dir: dx ? 'v' : 'h', x, z });
    }
  }
  const E = [...edges.values()];
  for (let i = E.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [E[i], E[j]] = [E[j], E[i]]; }
  // 3. connect them: a random spanning tree (everything reachable), plus plenty of extra links (loops to run round:
  // it's a deathmatch, not a maze), and every hall gets at least two ways in
  const parent = rooms.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of E) { if (find(e.a) !== find(e.b)) { parent[find(e.a)] = find(e.b); e.on = true; } }
  for (const e of E) if (!e.on && R() < 0.5) e.on = true;
  for (const e of E) if (e.on) { rooms[e.a].links++; rooms[e.b].links++; }
  for (const r of rooms) {
    if (r.links >= 2) continue;
    for (const e of E) if (!e.on && (e.a === r.id || e.b === r.id) && r.links < 2) { e.on = true; rooms[e.a].links++; rooms[e.b].links++; }
  }
  // 4. how each link is made: a doorway with a door, a plain doorway, or the wall knocked out over a stretch.
  // Doors first go where a link has only one way through (so they matter), up to the size's number of doors.
  const doorways = [];
  let doorsLeft = S.doors;
  const on = E.filter(e => e.on).sort((p, q) => p.segs.length - q.segs.length || (R() - 0.5));
  for (const e of on) {
    const L = e.segs.length;
    const r = R();
    const kind = doorsLeft > 0 && (L <= 2 ? r < 0.7 : r < 0.4) ? 'door' : L >= 2 && r < 0.8 ? 'wide' : 'gap';
    if (kind === 'wide') {
      // a stretch of 1 … L-1 rooms (all of it on a short wall), so a stub of wall is often left to hide behind
      const n = L <= 2 ? L : 1 + Math.floor(R() * (L - 1)), s0 = Math.floor(R() * (L - n + 1));
      for (let k = s0; k < s0 + n; k++) { const sg = e.segs[k]; if (sg.dir === 'v') vWall[sg.z][sg.x] = false; else hWall[sg.z][sg.x] = false; }
    } else {
      const sg = e.segs[Math.floor(R() * L)];
      doorways.push({ dir: sg.dir, x: sg.x, z: sg.z, door: kind === 'door', open: R() < 0.5 });
      if (kind === 'door') doorsLeft--;
    }
  }
  // 5. inside the halls: a pillar hall, a short free-standing wall (cover), one pillar, or nothing
  const pillars = [], stubs = [];
  for (const r of rooms) {
    if (r.w < 2 || r.d < 2) continue;
    const corners = [];
    for (let z = r.z + 1; z < r.z + r.d; z++) for (let x = r.x + 1; x < r.x + r.w; x++) corners.push([x, z]);
    const t = R();
    if (t < 0.3) for (const c of corners) pillars.push(c);
    else if (t < 0.8) {
      const c = corners[Math.floor(R() * corners.length)];
      stubs.push({ x: c[0], z: c[1], ax: R() < 0.5 ? 'x' : 'z', cross: corners.length >= 4 && R() < 0.35 });
    } else if (t < 0.92) pillars.push(corners[Math.floor(R() * corners.length)]);
  }
  // 6. light colour by quarter (brview.js LOOKS: 0 warm white, 1 greenish, 2 cold blue-white, 3 amber)
  const sec = Array.from({ length: D }, (_, z) => Array.from({ length: W }, (_, x) => (x < W / 2 ? 0 : 1) + (z < D / 2 ? 0 : 2)));
  // 7. spawns: room middles, spread out as far apart as possible (farthest point first), facing the map's middle
  const cand = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) cand.push([at(x) + 2.25, at(z) + 2.25]);
  const spawns = [cand[0]];
  while (spawns.length < S.spawns) {
    let best = null, bd = -1;
    for (const c of cand) {
      const d = Math.min(...spawns.map(s => Math.hypot(s[0] - c[0], s[1] - c[1])));
      if (d > bd) { bd = d; best = c; }
    }
    spawns.push(best);
  }
  // facing the longest straight view out of the room (rooms walked through before a wall), the map's middle on a tie
  const wallTo = (x, z, dx, dz) => (x + dx < 0 || z + dz < 0 || x + dx >= W || z + dz >= D ? true
    : dx ? vWall[z][Math.min(x, x + dx)] : hWall[Math.min(z, z + dz)][x]);
  const cx = at(W) / 2 + 0.5, cz = at(D) / 2 + 0.5;
  for (const s of spawns) {
    const x0 = Math.floor((s[0] - BR.border) / BR.cell), z0 = Math.floor((s[1] - BR.border) / BR.cell);
    let best = null, bl = -1;
    for (const [dx, dz] of DIRS) {
      let n = 0, x = x0, z = z0;
      while (!wallTo(x, z, dx, dz)) { x += dx; z += dz; n++; }
      const l = n + 0.01 * ((cx - s[0]) * dx + (cz - s[1]) * dz);
      if (l > bl) { bl = l; best = [dx, dz]; }
    }
    s[2] = Math.atan2(-best[0], -best[1]);
  }
  return { size, seed: S.seed, W, D, rooms, vWall, hWall, doorways, pillars, stubs, sec, spawns, dm: true,
    // (what brview.js reads from Level 0's plan: nothing of these here)
    darkZones: [], pitRooms: [], halls: [], holes: [], arrows: [], switches: [], key: null, guide: null, hall: null, exit: null, logs: [] };
}

// The map definition for one size (maps.js MAPS.backroomsdm → resolveMap)
export function brDmDef(base, size) {
  const plan = brDmPlan(size), W = plan.W, Dn = plan.D, C = BR.cell, H = BR.ceiling, T = BR.wall / 2;
  const sizeX = BR.border * 2 + W * C, sizeZ = BR.border * 2 + Dn * C;
  return {
    ...base,
    variant: size,
    size: [sizeX, sizeZ],
    massHeight: 4,
    br: plan,
    checkPoints: {},
    build(b) {
      b.open(at(0), at(0), at(W), at(Dn));
      for (let z = 0; z < Dn; z++) for (let x = 0; x < W - 1; x++) {
        if (!plan.vWall[z][x]) continue;
        const wx = at(x + 1);
        b.wall(wx - T, at(z) - T, wx + T, at(z + 1) + T, H, 'wallpaper');
      }
      for (let z = 0; z < Dn - 1; z++) for (let x = 0; x < W; x++) {
        if (!plan.hWall[z][x]) continue;
        const wz = at(z + 1);
        b.wall(at(x) - T, wz - T, at(x + 1) + T, wz + T, H, 'wallpaper');
      }
      // doorways: a 1.5 × 2.2 m gap in the middle of the wall (as in Level 0), some with a door
      plan.doorways.forEach((d, i) => {
        let g;
        if (d.dir === 'v') {
          const wx = at(d.x + 1), c = at(d.z) + C / 2;
          b.cut(wx - T, c - 0.75, wx + T, c + 0.75, 0, BR.door);
          g = [wx - T, c - 0.75, wx + T, c + 0.75];
        } else {
          const wz = at(d.z + 1), c = at(d.x) + C / 2;
          b.cut(c - 0.75, wz - T, c + 0.75, wz + T, 0, BR.door);
          g = [c - 0.75, wz - T, c + 0.75, wz + T];
        }
        if (d.door) b.door({ kind: 'way', v: d.dir === 'v', open: d.open, plan: i, pen: true }, ...g);
      });
      // pillar halls and lone pillars (1 m square), short free-standing walls (2.5 m, sometimes a cross)
      for (const [x, z] of plan.pillars) b.wall(at(x) - 0.5, at(z) - 0.5, at(x) + 0.5, at(z) + 0.5, H, 'pillar');
      for (const s of plan.stubs) {
        const px = at(s.x), pz = at(s.z), L = 1.25;
        if (s.ax === 'x' || s.cross) b.wall(px - L, pz - T, px + L, pz + T, H, 'wallpaper');
        if (s.ax === 'z' || s.cross) b.wall(px - T, pz - L, px + T, pz + L, H, 'wallpaper');
      }
      b.roof(BR.border, BR.border, sizeX - BR.border, sizeZ - BR.border, H, '_ceiling');
      for (const [x, z, yaw] of plan.spawns) b.spawn('dm', x, z, yaw);
    },
  };
}
