// Level 2 of the Backrooms: the Poolrooms. ONE fixed, hand-made layout (not random), about half the area of
// Level 0: two floors of tiled halls, pools and flooded rooms, joined by a curved stair and three water slides.
// No three.js in here: the host, every player and the home server build the same world from it.
//
//   y: the ground floor's dry deck is at POOL.G (3 m: the pools go DOWN from there), the upper floor at POOL.U
//      (10 m: 7 m higher). Every ground-floor pool has its water at POOL.WY, 12 cm under the deck.
//   x runs west → east (0…64), z north → south (0…52). The low sun stands in the south-west.
//
//   WEST SIDE (where you start)                      | EAST SIDE (across the channel: needs the bridge)
//   lane hall      x 2–9,   z 8–47   (long pool,     | atrium       x 41–58, z 21–44  (the Great Pool, open to the roof)
//                  slanted wall of capsule windows)  | slide hall   x 41.5–47, z 9–19.5 (plunge pool, open to the roof)
//   flooded hall   x 11–34, z 2–20   (knee-deep)     | stair tower  round, centre 55.5 / 10.5 (curved stairs to upstairs)
//   flooded tunnels and corridor, z 20–28            | grotto       x 58.5–62.5, z 26–40 (only reached by the green slide)
//   kidney hall    x 11–35, z 28–50  (curvy pools)   | exit         a tunnel under the Great Pool's south end (drained)
//   start hallway  x 35–58.5, z 47–50 (the lift)     | upstairs     galleries all round the atrium, no railings
//   the channel    x 35–41, z 21–45.5: deep water between the two sides
import { brLevel } from './brmap.js';

export const POOL = {
  size: [64, 52],
  G: 3,             // the ground floor's dry deck
  U: 10,            // the upper floor
  WY: 2.88,         // the water's surface in every ground-floor pool and flooded room
  SH: 2.45,         // the floor of the flooded (knee-deep) rooms
  ROOF: 12.8,       // underside of the roof (upstairs is 2.8 m high: "cosier"); the roof is 0.4 m thick
  swim: 1.35,       // how far under the surface a swimmer's feet hang (their head stays out)
  deep: 1.15,       // water deeper than this is swum, not waded
  // the low late-afternoon sun never moves: the way its light TRAVELS (east and a little north, 27° down)
  sun: (() => { const e = 27 * Math.PI / 180, a = [0.76, -0.65]; const h = Math.hypot(a[0], a[1]); return [a[0] / h * Math.cos(e), -Math.sin(e), a[1] / h * Math.cos(e)]; })(),
};
const { G, U, WY, SH, ROOF } = POOL;
const ROOFT = ROOF + 0.4;

// What changes with the difficulty: hold = seconds a bridge stays up after a lone player steps off its plate;
// turn = seconds of holding to turn a valve (the drain wheel takes twice as long); lanes = which of the Great
// Pool's three lanes each valve heats. A lane is hot when an odd number of open valves feed it (a valve sends
// hot water down its pipe, a second one into the same lane mixes it lukewarm again). All three lanes hot
// unlocks the drain. Easy: one lane each (all three open). Normal and hard: the middle valve (upstairs) must
// stay SHUT and the grotto's must be open (so the green slide is always on the way).
export const POOL_LEVELS = {
  easy: { hold: 9, turn: 2, lanes: [[0], [1], [2]] },
  normal: { hold: 7, turn: 3, lanes: [[0, 1], [1, 2], [2]] },
  hard: { hold: 5.5, turn: 4, lanes: [[0, 2], [0, 1], [1]] },
};
// which lanes are hot with these valves open (open: [bool, bool, bool])
export function hotLanes(level, open) {
  const L = POOL_LEVELS[level] || POOL_LEVELS.normal, hot = [false, false, false];
  open.forEach((o, i) => { if (o) for (const l of L.lanes[i]) hot[l] = !hot[l]; });
  return hot;
}
export const poolLevel = v => brLevel(String(v == null ? '' : v).split(':').pop());

// ---------- shapes ----------
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
const sdBox = (x, z, x0, z0, x1, z1, rad) => {
  const dx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - rad), dz = Math.abs(z - (z0 + z1) / 2) - ((z1 - z0) / 2 - rad);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - rad;
};

// Round pillars: fat ones (tiled white) on the dry floor or on a rounded lip at a pool's edge. { x, z, r, y0, y1 }
const KID_PILLARS = [[14.5, 30.2], [20.6, 36.4], [26.4, 30.4], [13.2, 36.8], [26.6, 47.6], [32.6, 31], [21.5, 49], [31.4, 46.6], [14, 48.6], [24.2, 39.6], [33.6, 38.2]];
const FLOOD_PILLARS = [];
for (const z of [5, 10.5, 16]) for (const x of [14.5, 20, 25.5, 31]) FLOOD_PILLARS.push([x, z]);
const ATRIUM_COLUMNS = [[42.1, 23.4], [42.1, 28.6], [42.1, 37.6], [42.1, 42.6]];

// Pools: deep water you swim in. Curvy ones are a few circles melted together ("blobs": [x, z, r]); straight ones a
// rounded box. clip: the room they lie in (they stop at its walls). bottom: the floor's height.
const POOLS = [
  { name: 'kidney-sw', blobs: [[15.6, 41.4, 3.1], [19.4, 44.6, 3.0], [24.6, 44.2, 2.7]], k: 2.2, bottom: G - 1.8, clip: [11, 28, 35, 50] },
  { name: 'kidney-e', blobs: [[28.6, 36.2, 2.7], [30.4, 40.6, 2.5], [27.6, 32.6, 2.2]], k: 2.0, bottom: G - 1.8, clip: [11, 28, 35, 50] },
  { name: 'bean-nw', blobs: [[17.2, 32.2, 2.3], [20.6, 31.2, 1.9]], k: 1.6, bottom: G - 1.6, clip: [11, 28, 35, 50] },
  { name: 'channel', box: [35, 20, 41, 46.5, 0.3], bottom: G - 1.8, clip: [35, 21, 41, 45.5] },
  { name: 'great', box: [46, 25, 60, 41, 0.45], bottom: 0, clip: [41, 21, 58, 44], lanes: [[46, 50], [50, 54], [54, 58]], gaps: [[51, 40, 53, 42]] },      // gaps: the tunnel's mouth in its wall
  { name: 'plunge', box: [43, 6, 49, 17.5, 1.1], bottom: G - 2.2, clip: [41.5, 9, 47, 19.5] },
  { name: 'lane', boxes: [[0, 11, 5.6, 45, 0.5], [0, 10, 11, 16.2, 0.5]], k: 0.8, bottom: G - 1.8, clip: [2, 8, 9, 47] },
];

// Flooded rooms: knee-deep water over a floor at SH. [x0, z0, x1, z1]
const SHALLOWS = [
  [11, 2, 34, 20],                    // the flooded hall
  [14, 20, 16.5, 27.5],               // tunnel west
  [27.5, 20, 30, 27.5],               // tunnel east
  [12, 22.5, 32, 25.5],               // the long cross corridor
  [34, 4, 37, 6], [34, 9, 37, 11], [34, 14, 37, 16],      // dark dead ends off the flooded hall
  [9.5, 17, 11, 19.5],                // the way in from the lane hall
  [58.5, 26, 62.5, 29.5],             // the grotto's splash basin (where the green slide lets you out)
];

// the round stair tower
const TOWER = { x: 55.5, z: 10.5, R: 5, core: 1.75, rise: U - G, a0: 15, a1: 435, land: 15, steps: 40 };
// the height of the stair at an angle along the climb (degrees from the way in, at the south; it winds clockwise
// seen from above: south → west → north → east → south → west, one and a quarter turns)
export const towerH = th => (U - G) * Math.max(0, Math.min(1, (th - TOWER.a0) / (TOWER.a1 - TOWER.a0)));
export const towerAngle = (x, z) => { const a = Math.atan2(z - TOWER.z, x - TOWER.x) * 180 / Math.PI - 90; return ((a % 360) + 360) % 360; };

function makePlan(level) {
  const plan = { level, tower: TOWER };
  plan.pillars = [
    ...KID_PILLARS.map(([x, z]) => ({ x, z, r: 0.7, y0: G, y1: G + 4.2 })),
    ...FLOOD_PILLARS.map(([x, z]) => ({ x, z, r: 0.6, y0: SH, y1: G + 3.4 })),
    ...ATRIUM_COLUMNS.map(([x, z]) => ({ x, z, r: 0.75, y0: G, y1: ROOF })),
  ];
  // tall square tiled pillars in the atrium (ordinary boxes): [x0, z0, x1, z1]
  plan.squares = [[44.5, 22, 45.5, 23], [51.5, 22, 52.5, 23], [44.5, 42.5, 45.5, 43.5], [51.5, 42.5, 52.5, 43.5]];
  // ---- pools ----
  plan.pools = POOLS.map((p, id) => {
    const o = { ...p, id, y: WY };
    const bites = p.blobs ? plan.pillars.filter(q => q.y0 === G) : [];      // a pillar at the edge: the edge curves round it
    const raw = (x, z) => {
      let d;
      if (p.blobs) { d = 1e9; for (const [cx, cz, r] of p.blobs) d = smin(d, Math.hypot(x - cx, z - cz) - r, p.k); }
      else if (p.boxes) { d = 1e9; for (const b of p.boxes) d = smin(d, sdBox(x, z, ...b), p.k); }
      else d = sdBox(x, z, ...p.box);
      return d;
    };
    o.bites = bites.filter(q => { const d = raw(q.x, q.z); return d < q.r + 0.75 && d > -1.25; });
    // (a pillar further out in the water than that would be an island: there are none — see the check script)
    o.sdf = (x, z) => { let d = raw(x, z); for (const q of o.bites) d = smax(d, q.r + 0.62 - Math.hypot(x - q.x, z - q.z), 0.7); return d; };
    o.raw = raw;
    if (p.blobs) { o.x0 = Math.min(...p.blobs.map(b => b[0] - b[2])) - 1; o.z0 = Math.min(...p.blobs.map(b => b[1] - b[2])) - 1; o.x1 = Math.max(...p.blobs.map(b => b[0] + b[2])) + 1; o.z1 = Math.max(...p.blobs.map(b => b[1] + b[2])) + 1; }
    else { const bs = p.boxes || [p.box]; o.x0 = Math.min(...bs.map(b => b[0])) - 1; o.z0 = Math.min(...bs.map(b => b[1])) - 1; o.x1 = Math.max(...bs.map(b => b[2])) + 1; o.z1 = Math.max(...bs.map(b => b[3])) + 1; }
    o.x0 = Math.max(o.x0, p.clip[0]); o.z0 = Math.max(o.z0, p.clip[1]); o.x1 = Math.min(o.x1, p.clip[2]); o.z1 = Math.min(o.z1, p.clip[3]);
    return o;
  });
  // which pool a 0.5 m cell belongs to (−1: none). Generous: a cell counts when its middle is within 0.3 m of the
  // smooth edge, so the grid never stops you before the smooth edge does (see solid() below).
  const [W, D] = POOL.size, Wc = W * 2, Dc = D * 2;
  plan.poolGrid = new Int8Array(Wc * Dc).fill(-1);
  for (const p of plan.pools) {
    for (let iz = Math.floor(p.z0 * 2); iz < Math.ceil(p.z1 * 2); iz++) for (let ix = Math.floor(p.x0 * 2); ix < Math.ceil(p.x1 * 2); ix++) {
      if (p.sdf(ix * 0.5 + 0.25, iz * 0.5 + 0.25) < 0.3) plan.poolGrid[iz * Wc + ix] = p.id;
    }
  }
  plan.poolAt = (x, z) => { const ix = Math.floor(x * 2), iz = Math.floor(z * 2); return ix < 0 || iz < 0 || ix >= Wc || iz >= Dc ? -1 : plan.poolGrid[iz * Wc + ix]; };
  plan.shallows = SHALLOWS.map(([x0, z0, x1, z1]) => ({ x0, z0, x1, z1 }));
  // steps down into the lane pool at its south end (the only pool with steps; the others have ladders):
  // [z0, z1, top] across the pool's width
  plan.poolSteps = { pool: 6, x0: 2, x1: 6, rows: [[44, 45.5, G - 0.3], [43.5, 44, G - 0.6], [43, 43.5, G - 0.9], [42.5, 43, G - 1.2], [42, 42.5, G - 1.5]] };

  // ---- round rooms: the stair tower and the little apse at the lane hall's north end ----
  // gaps: the ways through the round wall { x0, z0, x1, z1, y0, y1 }
  plan.rings = [
    { name: 'tower', x: TOWER.x, z: TOWER.z, R: TOWER.R, core: TOWER.core, y0: G, y1: ROOF, gaps: [{ x0: 54.5, z0: 14.5, x1: 56.5, z1: 16.5, y0: G, y1: G + 3 }, { x0: 50, z0: 9.5, x1: 51.5, z1: 11.5, y0: U, y1: U + 2.5 }] },
    { name: 'apse', x: 5.5, z: 4.9, R: 2.4, core: 0, y0: G, y1: G + 4, gaps: [{ x0: 4.5, z0: 7, x1: 6.5, z1: 8, y0: G, y1: G + 2.6 }] },
  ];

  // ---- openings with a shape: arches between rooms, windows to the outside, skylights ----
  // axis: the way you walk (or look) through it. a0…a1: the wall's thickness along that axis; u0…u1: across.
  // shape: 'arch' (round top), 'capsule', 'round', 'rect'. out: -1 / +1 = that end is outdoors (a window).
  const O = [];
  const arch = (axis, a0, a1, u0, u1, y0, y1, extra = {}) => O.push({ axis, a0, a1, u0, u1, y0, y1, shape: 'arch', ...extra });
  arch('x', 9, 11, 30.5, 33.5, G, G + 3.3);                // lane hall ↔ kidney hall
  arch('x', 9, 11, 41, 44, G, G + 3.3);
  arch('x', 9, 11, 17, 19.5, SH, G + 2.9, { floor: 'steps' });      // lane hall → flooded hall
  // the two tunnels into the kidney hall (their own vault is the arch: only the wall round each end is drawn)
  arch('z', 26, 28, 14, 16.5, SH, G + 2.5, { floor: 'steps', only: 1, noSoffit: true });
  arch('z', 26, 28, 27.5, 30, SH, G + 2.5, { floor: 'steps', only: 1, noSoffit: true });
  arch('z', 20, 20.5, 14, 16.5, SH, G + 2.5, { only: -1, noSoffit: true, noCut: true });      // (and their mouths in the flooded hall)
  arch('z', 20, 20.5, 27.5, 30, SH, G + 2.5, { only: -1, noSoffit: true, noCut: true });
  // where the tunnels cross the long corridor the ceiling is flat: four arches meet round a square bay
  for (const x of [14, 27.5]) {
    arch('z', 22, 22.5, x, x + 2.5, SH, G + 2.5, { only: 1, noSoffit: true, noCut: true });
    arch('z', 25.5, 26, x, x + 2.5, SH, G + 2.5, { only: -1, noSoffit: true, noCut: true });
    arch('x', x - 0.5, x, 22.5, 25.5, SH, G + 2.5, { only: 1, noSoffit: true, noCut: true });
    arch('x', x + 2.5, x + 3, 22.5, 25.5, SH, G + 2.5, { only: -1, noSoffit: true, noCut: true });
  }
  for (const z of [4, 9, 14]) arch('x', 34, 34.5, z, z + 2, SH, G + 2.2);      // the dark dead ends
  arch('x', 35, 35.5, 47.2, 49.8, G, G + 3.1);              // start hallway → kidney hall
  arch('z', 19.5, 21, 43, 45.5, G, G + 2.9);               // slide hall ↔ atrium
  arch('z', 20, 21, 54.5, 56.5, G, G + 2.7);               // atrium ↔ the stair tower's lobby
  for (const z of [28, 32, 36]) arch('x', 58, 58.5, z, z + 2, G, G + 2.5, { drop: true });      // grotto → the Great Pool
  arch('z', 7.5, 8, 4.5, 6.5, G, G + 2.6);                 // the small arched doorway at the lane hall's far end
  // windows (the glazed outer walls are 0.5 m thick; beyond them is open sky)
  for (const x of [14.2, 18.9, 23.6, 28.3, 33]) O.push({ axis: 'z', a0: 50, a1: 50.5, u0: x - 0.8, u1: x + 0.8, y0: G + 0.5, y1: G + 3.5, shape: 'arch', out: 1 });
  for (let x = 37.6; x < 57; x += 3.1) O.push({ axis: 'z', a0: 50, a1: 50.5, u0: x - 0.6, u1: x + 0.6, y0: G + 0.9, y1: G + 2.9, shape: 'arch', out: 1 });
  for (const x of [13, 20.5, 28]) O.push({ axis: 'z', a0: 1.5, a1: 2, u0: x, u1: x + 4, y0: G + 2.0, y1: G + 3.0, shape: 'capsule', out: -1 });
  plan.openings = O;
  // the lane hall's slanted west wall and its row of tall capsule windows (Picture B)
  plan.slant = { x: 2, lean: 0.9, z0: 8, z1: 47, y0: G, y1: G + 4.6, windows: [] };
  for (let z = 13.5; z < 44.6; z += 3.75) plan.slant.windows.push({ z, w: 1.3, y0: G + 0.75, y1: G + 3.95 });
  // skylights: holes through the roof (upstairs and the tall halls only). round: a circle in the square
  const S = [];
  const sky = (x0, z0, x1, z1, round = false) => S.push({ x0, z0, x1, z1, round });
  sky(42.5, 24, 46.5, 29); sky(42.5, 37, 46.5, 43); sky(48.5, 30, 53.5, 36); sky(53, 23, 57, 27);      // over the atrium
  // (upstairs galleries: only a few small ones, so it stays softer and cosier than the tall halls)
  for (const z of [25, 37.5]) sky(36, z, 37.5, z + 1.5);                                              // west gallery
  sky(49.5, 45, 51, 46.5);                                                                           // south gallery
  for (const z of [27, 40.5]) sky(60, z, 61.5, z + 1.5);                                              // east gallery
  sky(58.5, 18, 60, 19.5);                                                                           // north gallery
  sky(48, 13, 49.5, 14.5);                                                                           // the corridor
  sky(43.5, 5, 45, 6.5);                                                                             // slide platform
  sky(42.5, 11.5, 45.5, 15.5);                                                                       // over the plunge pool
  for (const [dx, dz] of [[-3.3, 0], [0, -3.3], [3.3, 0], [0, 3.3]]) sky(TOWER.x + dx - 0.75, TOWER.z + dz - 0.75, TOWER.x + dx + 0.75, TOWER.z + dz + 0.75, true);
  plan.skylights = S;

  // ---- how each room is finished: tiled everywhere, or smooth pale walls and ceiling (first match wins) ----
  // vault: a barrel ceiling along 'x' or 'z' (spring: where it starts to curve); cove: ceilings curve into the walls
  plan.rooms = [
    { name: 'lane', x0: 2, z0: 8, x1: 9, z1: 47, y0: 0, y1: G + 4.6, wall: 'tile', ceil: 'tile', cove: 0.6 },
    { name: 'apse', x0: 3, z0: 2.5, x1: 8, z1: 8, y0: G, y1: G + 4, wall: 'tile', ceil: 'tile' },
    { name: 'flooded', x0: 11, z0: 2, x1: 34, z1: 20, y0: 0, y1: G + 3.4, wall: 'smooth', ceil: 'smooth', cove: 0.5 },
    { name: 'tunnel-w', x0: 14, z0: 20, x1: 16.5, z1: 28, y0: 0, y1: G + 2.5, wall: 'smooth', ceil: 'smooth', vault: 'z', spring: G + 1.25 },
    { name: 'tunnel-e', x0: 27.5, z0: 20, x1: 30, z1: 28, y0: 0, y1: G + 2.5, wall: 'smooth', ceil: 'smooth', vault: 'z', spring: G + 1.25 },
    { name: 'corridor', x0: 12, z0: 22.5, x1: 32, z1: 25.5, y0: 0, y1: G + 2.5, wall: 'smooth', ceil: 'smooth', vault: 'x', spring: G + 1.0 },
    { name: 'deadend', x0: 34.4, z0: 3, x1: 37.5, z1: 17, y0: 0, y1: G + 2.4, wall: 'smooth', ceil: 'smooth', dark: 0.3 },      // dark: hardly any light gets in
    { name: 'kidney', x0: 11, z0: 28, x1: 35, z1: 50, y0: 0, y1: G + 4.2, wall: 'tile', ceil: 'tile', cove: 0.6 },
    { name: 'channel', x0: 35, z0: 21, x1: 41, z1: 45.5, y0: 0, y1: G + 4.2, wall: 'tile', ceil: 'tile' },
    { name: 'hallway', x0: 35.5, z0: 47, x1: 58.5, z1: 50, y0: G, y1: G + 3.4, wall: 'tile', ceil: 'smooth', cove: 0.5 },
    { name: 'atrium', x0: 41, z0: 21, x1: 58, z1: 44, y0: 0, y1: ROOF, wall: 'tile', ceil: 'smooth' },
    { name: 'slidehall', x0: 41.5, z0: 9, x1: 47, z1: 19.5, y0: 0, y1: ROOF, wall: 'tile', ceil: 'smooth' },
    { name: 'lobby', x0: 54.5, z0: 15, x1: 56.5, z1: 20, y0: G, y1: G + 3, wall: 'tile', ceil: 'tile', vault: 'z', spring: G + 2 },
    { name: 'grotto', x0: 58.5, z0: 26, x1: 62.5, z1: 40, y0: 0, y1: G + 3.6, wall: 'tile', ceil: 'tile', vault: 'z', spring: G + 2.6 },
    { name: 'exit', x0: 51, z0: 41, x1: 53, z1: 46.5, y0: 0, y1: 8.5, wall: 'tile', ceil: 'tile' },
    { name: 'upstairs', x0: 30, z0: 2, x1: 63, z1: 48, y0: U, y1: ROOF, wall: 'tile', ceil: 'smooth', cove: 0.45 },
  ];
  plan.roomAt = (x, y, z) => plan.rooms.find(r => x >= r.x0 - 0.01 && x <= r.x1 + 0.01 && z >= r.z0 - 0.01 && z <= r.z1 + 0.01 && y >= r.y0 - 0.01 && y <= r.y1 + 0.01) || null;

  // ---- ladders: the only way out of deep water (besides the lane pool's steps) ----
  // given as a point near the edge; it is moved exactly onto the edge. bottom: how far down the rungs go.
  const ladder = (pool, x, z, deep = false) => {
    const p = plan.pools[pool];
    let px = x, pz = z, nx = 0, nz = 0;
    for (let i = 0; i < 12; i++) {
      const d = p.sdf(px, pz), e = 0.02;
      nx = (p.sdf(px + e, pz) - p.sdf(px - e, pz)) / (2 * e); nz = (p.sdf(px, pz + e) - p.sdf(px, pz - e)) / (2 * e);
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      px -= nx * d; pz -= nz * d;
    }
    // (nx, nz) points out of the water, onto the deck
    return { pool, x: px, z: pz, nx, nz, top: G, bottom: deep ? p.bottom : WY - 1.25 };
  };
  plan.ladders = [
    ladder(0, 19.6, 40.6), ladder(0, 27.6, 44.6), ladder(0, 12.6, 40.4),
    ladder(1, 25.4, 36.6), ladder(1, 32.9, 41.4),
    ladder(2, 18.6, 34.6),
    ladder(3, 35, 29.6), ladder(3, 35, 41.6),               // the channel: on the west (start) bank only
    ladder(4, 46, 28, true), ladder(4, 46, 38, true),       // the Great Pool: right down to its floor
    ladder(5, 43, 13.5),
    ladder(6, 5.6, 30), ladder(6, 5.6, 20),
  ];
  // the exit ladder: up the shaft at the end of the tunnel under the Great Pool, to the white hatch
  // (top: as high as your feet get on it, with your head just under the hatch; out: feet this high = out through it)
  plan.exit = { tunnel: { x0: 51, z0: 41, x1: 53, z1: 46.5, y0: 0, y1: 2.3 }, shaft: { x0: 51, z0: 44.5, x1: 53, z1: 46.5, y0: 0, y1: 8.5 }, ladder: { x: 52, z: 46.5, nx: 0, nz: 1, top: 6.6, bottom: 0, wall: true, rail: 8.4 }, hatch: { x: 52, y: 8.5, z: 45.5, out: 6.45 } };
  // the two floaties (only for fun): a red-and-white ring and a yellow one, floating when the level starts
  plan.floaties = [{ name: 'red', x: 21.5, z: 45.4, color: '#d83a2e', stripe: '#f4f1ea' }, { name: 'yellow', x: 44.6, z: 13.6, color: '#f2c227', stripe: null }];
  // the optional bridge leads to the apse: a round room under a tall light well (a nice view, and nothing else)
  plan.well = { x0: 4.5, z0: 3.9, x1: 6.5, z1: 5.9 };
  // ---- stage 2's things, placed now so the rooms fit them ----
  // pressure plates and the bridges they raise (need: the one on the way; view: the optional one to the apse)
  // (plates: 1 m squares of blue tiles, 4 cm proud of the floor; they sink 3 cm when stood on)
  plan.plate = { half: 0.5, h: 0.04 };
  plan.bridges = [
    { name: 'need', x0: 34.5, z0: 32, x1: 41.5, z1: 34, plates: [{ x: 33.2, z: 33 }, { x: 43, z: 33 }] },
    { name: 'view', x0: 6.5, z0: 9.5, x1: 8.5, z1: 16.5, plates: [{ x: 7.6, z: 18.2 }, { x: 4, z: 9 }] },
  ];
  // the three brass valves (v1 on the atrium's north wall, v2 upstairs on the west gallery, v3 in the grotto)
  plan.valves = [{ x: 49, y: G, z: 21, nx: 0, nz: 1 }, { x: 39.4, y: U, z: 33, nx: -1, nz: 0, post: true }, { x: 62.5, y: G, z: 34, nx: -1, nz: 0 }];
  plan.drain = { x: 45.4, y: G, z: 35.5, nx: -1, nz: 0, pool: 4 };            // the big wheel and its three gauges, by the Great Pool
  plan.lanes = [[46, 50], [50, 54], [54, 58]].map(([x0, x1]) => ({ x0, x1, z0: 25.6, z1: 40.4 }));      // the Great Pool's lanes
  plan.grottoSteam = { x0: 58.7, z0: 26.2, x1: 62.3, z1: 29.3 };              // the grotto's warm basin: it always steams a little
  // the slides: three mouths in the slide platform's north wall; where each lets you out. path: the middle of the
  // tube from the mouth to the outlet, all of it inside solid wall (so it is only ever seen from the inside)
  plan.slides = [
    { name: 'red', color: '#d8402f', mouth: { x: 42.45, y: U + 0.95, z: 3 }, out: { x: 20, y: WY + 1.3, z: 28, nx: 0, nz: 1 },
      path: [[42.45, 10.95, 3.4], [42.45, 10.6, 2.45], [42.2, 9.3, 2.35], [41, 8.6, 2.45], [38.5, 9.1, 3.6], [35.5, 9.4, 5.4], [32, 9.7, 6.4], [29, 9.5, 8.6], [27.6, 9.3, 11.6],
        [25, 9.1, 14], [23.4, 8.9, 17.4], [21.2, 8.7, 20], [20.6, 8.3, 23.4], [20.2, 7.3, 26.1], [20, 5.6, 26.9], [20, 4.45, 27.5], [20, 4.18, 28.2], [20, 4.06, 29.2]] },
    { name: 'blue', color: '#2f6fd8', mouth: { x: 44.25, y: U + 0.95, z: 3 }, out: { x: 45, y: WY + 1.2, z: 9, nx: 0, nz: 1 },
      path: [[44.25, 10.95, 3.4], [44.25, 10.6, 2.45], [44.5, 9.4, 2.35], [45.4, 8.8, 3.1], [46.1, 8.3, 5], [45.3, 7.8, 6.9], [43.4, 7.3, 7.3], [42.4, 6.8, 5.5],
        [43.2, 6.2, 3.4], [45.4, 5.6, 3.5], [46.1, 5.1, 5.4], [45.6, 4.6, 7.4], [45.1, 4.3, 8.4], [45, 4.08, 9.2], [45, 3.96, 10.2]] },
    { name: 'green', color: '#3aa95a', mouth: { x: 46.05, y: U + 0.95, z: 3 }, out: { x: 60.5, y: G + 0.75, z: 26, nx: 0, nz: 1 },
      path: [[46.05, 10.95, 3.4], [46.05, 10.6, 2.45], [46.1, 9.3, 2.3], [46.9, 8.5, 2.35], [47.8, 8.1, 2.45], [48.6, 8, 2.6], [51, 7.4, 2.4], [53.5, 7.2, 3], [56, 6.9, 2.3], [59, 6.5, 2.6], [61.6, 6.1, 4.2],
        [62.3, 5.8, 7], [62.25, 5.5, 10], [62.4, 5.2, 13], [61.7, 4.9, 16], [62.3, 4.6, 19.2], [62, 4.3, 22], [61.3, 4, 24.3], [60.7, 3.82, 25.5], [60.5, 3.75, 26.2], [60.5, 3.68, 27.2]] },
  ];
  // small round steel drains in the dry floor
  plan.drains = [[12.4, 46], [22.6, 34.2], [31, 48.8], [33.2, 44], [18, 29.2], [7.4, 24], [7.4, 36], [7.4, 45.9], [43.5, 31], [43.5, 40], [50, 23.2], [50, 42.6], [42.4, 18.4],
    [40, 48.5], [48, 48.5], [55, 48.5], [60.5, 33]].map(([x, z]) => ({ x, y: G, z }))
    .concat([[37, 26], [37, 38], [48.5, 9], [48.5, 18], [55, 18.8], [60.5, 28], [60.5, 40], [50, 45.5], [44, 6]].map(([x, z]) => ({ x, y: U, z })));
  // You can pull yourself out of deep water anywhere along a pool's edge (owner's request), EXCEPT onto these:
  // the channel's far bank (or you'd swim round the bridge), the grotto through its arches from the Great Pool
  // (it is only for the green slide), and the little deck in front of the apse (the optional bridge's end).
  plan.noClimb = [
    { x0: 40.8, z0: 20, x1: 43, z1: 46.5 },           // the atrium side of the channel (only its first 2 m: the Great Pool's own edge is free)
    { x0: 57.9, z0: 25.5, x1: 63, z1: 40.5 },         // the grotto
    { x0: 2, z0: 7, x1: 9.2, z1: 10.05 },             // in front of the apse
  ];
  plan.climbOK = (x, z) => !plan.noClimb.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  plan.start = { x: 55, y: G, z: 48.5, yaw: Math.PI / 2 };
  plan.lift = { x: 58.5, z: 48.5, y: G };                    // Level 1's lift doors, at the hallway's east end (shut)
  return plan;
}

// The map definition the World is built from (same shape as the maps in maps.js). variant = the difficulty.
export function poolMap(variant) {
  const level = poolLevel(variant);
  const plan = makePlan(level);
  const [W, D] = POOL.size;
  const T = plan.tower;
  return {
    name: 'Level 2: The Poolrooms',
    description: 'Co-op escape, level 2: bright tiled halls and still water. Nothing lives here.',
    mode: 'br',
    theme: 'pool',
    size: [W, D],
    massHeight: ROOFT,
    variant, level,
    pool: plan,
    // Shapes that aren't boxes: round pillars, round rooms, and the pools' smooth edges (when you are down in one).
    solid(x, z, r, y, step, height) {
      for (const p of plan.pillars) {
        const dx = x - p.x, dz = z - p.z, rr = p.r + r;
        if (dx * dx + dz * dz < rr * rr && y + height > p.y0 && y + step < p.y1) return true;
      }
      for (const o of plan.rings) {
        const dx = x - o.x, dz = z - o.z, d2 = dx * dx + dz * dz;
        if (d2 > (o.R + 1.2) * (o.R + 1.2) || y + height <= o.y0 || y >= o.y1) continue;
        if (o.core && d2 < (o.core + r) * (o.core + r)) return true;
        if (d2 > (o.R - r) * (o.R - r)) {
          if (!o.gaps.some(g => x > g.x0 + r * 0.6 && x < g.x1 - r * 0.6 && z > g.z0 - 0.6 && z < g.z1 + 0.6 && y >= g.y0 - 0.3 && y < g.y1)
            && d2 < (o.R + 0.6) * (o.R + 0.6)) return true;
        }
      }
      if (y + step < G - 0.02) {
        const i = plan.poolAt(x, z);
        if (i >= 0 && plan.pools[i].sdf(x, z) > -r) {
          const gp = plan.pools[i].gaps;
          if (!gp || !gp.some(g => x > g[0] + r && x < g[2] - r && z > g[1] && z < g[3])) return true;
        }
      }
      return false;
    },
    build(b) {
      const air = (x0, z0, x1, z1, y0, y1) => b.cut(x0, z0, x1, z1, y0, y1);
      // above the roof and beyond the glazed outer walls: open sky
      air(0, 0, W, D, ROOFT, 99);
      b.open(0, 0, 1.5, D); b.open(0, 50.5, W, D); b.open(0, 0, W, 1.5);
      // ---- ground floor ----
      air(2, 8, 9, 47, G, G + 4.6);                           // lane hall
      air(11, 2, 34, 20, SH, G + 3.4);                        // flooded hall
      air(14, 20, 16.5, 28, SH, G + 2.5); air(27.5, 20, 30, 28, SH, G + 2.5);      // tunnels
      air(12, 22.5, 32, 25.5, SH, G + 2.5);                   // cross corridor
      for (const z of [4, 9, 14]) air(34, z, 37, z + 2, SH, G + 2.3);              // dark dead ends
      air(11, 28, 35, 50, G, G + 4.2);                        // kidney hall
      air(35, 21, 41, 45.5, G, G + 4.2);                      // over the channel
      air(35.5, 47, 58.5, 50, G, G + 3.4);                    // start hallway
      air(41, 21, 58, 44, G, ROOF);                           // atrium
      air(41.5, 9, 47, 19.5, G, ROOF);                        // slide hall
      air(54.5, 16.5, 56.5, 20, G, G + 3);                    // the tower's lobby
      air(58.5, 26, 62.5, 40, G, G + 3.6);                    // grotto
      air(58.5, 26, 62.5, 29.5, SH, G);                       // (its splash basin, and the step out of it)
      b.add(58.5, 29, 62.5, 29.5, SH, SH + (G - SH) / 2, 'mass');
      // ---- upper floor ----
      air(33, 19.5, 41, 44, U, ROOF);                         // west gallery
      air(41, 19.5, 47, 21, U, ROOF);                         // the narrow walk between the two tall halls
      air(47, 3, 50, 21, U, ROOF);                            // corridor
      air(41.5, 3, 47, 9, U, ROOF);                           // slide platform
      air(50, 16.5, 62.5, 21, U, ROOF);                       // north gallery
      air(58, 21, 62.5, 47, U, ROOF);                         // east gallery
      air(41, 44, 58, 47, U, ROOF);                           // south gallery
      // ---- openings: arches, windows, skylights ----
      for (const o of plan.openings) {
        const r = o.axis === 'x' ? [o.a0, o.u0, o.a1, o.u1] : [o.u0, o.a0, o.u1, o.a1];
        if (!o.noCut) air(r[0], r[1], r[2], r[3], o.y0, o.y1);
        if (o.floor === 'steps') {
          // two steps up from the flooded floor to the dry deck, inside the arch (at its dry end)
          const dry = o.axis === 'x' ? -1 : 1;            // which end is the deck: west for 'x' arches, south for 'z'
          const e = dry < 0 ? o.a0 : o.a1;
          const s = (d0, d1, h) => { const lo = Math.min(e + dry * -d0, e + dry * -d1), hi = Math.max(e + dry * -d0, e + dry * -d1); if (o.axis === 'x') b.add(lo, o.u0, hi, o.u1, SH, h, 'mass'); else b.add(o.u0, lo, o.u1, hi, SH, h, 'mass'); };
          s(0, 0.5, G); s(0.5, 1, SH + (G - SH) / 2);
        }
      }
      { const s = plan.slant; air(1.5, 9.5, 2, 45.6, s.windows[0].y0 - 0.2, s.windows[0].y1 + 0.2); b.add(1.5, 9.5, 2, 45.6, s.windows[0].y0 - 0.2, s.windows[0].y1 + 0.2, '_glass'); }      // (one slot behind the slanted wall's windows, glazed)
      // windows to the outside are glazed: nobody (and no floatie) gets out through one
      for (const o of plan.openings) if (o.out) { const r = o.axis === 'x' ? [o.a0, o.u0, o.a1, o.u1] : [o.u0, o.a0, o.u1, o.a1]; b.add(r[0], r[1], r[2], r[3], o.y0, o.y1, '_glass'); }
      // the light well over the apse
      { const w = plan.well; air(w.x0, w.z0, w.x1, w.z1, G + 4, 99); }
      // the valves' pipes and the drain wheel's stand (small solid posts)
      { const v = plan.valves[1]; b.add(v.x + 0.05, v.z - 0.2, v.x + 0.5, v.z + 0.2, U, ROOF, '_pipe'); }
      { const d = plan.drain; b.add(d.x - 0.05, d.z - 0.25, d.x + 0.45, d.z + 0.25, G, G + 1.2, '_pipe'); }
      for (const s of plan.skylights) air(s.x0, s.z0, s.x1, s.z1, ROOF, 99);
      // ---- round rooms ----
      for (const o of plan.rings) {
        for (let z = Math.floor((o.z - o.R - 1) * 2) / 2; z < o.z + o.R + 1; z += 0.5) for (let x = Math.floor((o.x - o.R - 1) * 2) / 2; x < o.x + o.R + 1; x += 0.5) {
          const d = Math.hypot(x + 0.25 - o.x, z + 0.25 - o.z);
          if (d < o.R + 0.36) air(x, z, x + 0.5, z + 0.5, o.y0, o.y1);
        }
        // the ways through the round wall (only as high as the doorway, also in the cells the circle opened)
        for (const g of o.gaps) {
          air(g.x0, g.z0, g.x1, g.z1, g.y0, g.y1);
          for (let z = g.z0; z < g.z1; z += 0.5) for (let x = g.x0; x < g.x1; x += 0.5) if (Math.hypot(x + 0.25 - o.x, z + 0.25 - o.z) > o.R) b.add(x, z, x + 0.5, z + 0.5, g.y1, o.y1 + 0.4, 'mass');
        }
      }
      // the curved stair: each cell's height comes from its angle round the tower. Where the stair passes over
      // itself (the first quarter turn) the upper flight is a slab with air under it.
      for (let z = T.z - T.R - 1; z < T.z + T.R + 1; z += 0.5) for (let x = T.x - T.R - 1; x < T.x + T.R + 1; x += 0.5) {
        const cx = x + 0.25, cz = z + 0.25, d = Math.hypot(cx - T.x, cz - T.z);
        if (d >= T.R + 0.36 || d < T.core - 0.4) continue;
        const a = towerAngle(cx, cz), hs = [];
        for (const k of [-1, 0, 1]) { const th = a + 360 * k; if (th >= -T.land && th <= T.a1 + 30) hs.push(towerH(th)); }
        hs.sort((p, q) => p - q);
        hs.forEach((h, i) => { if (i === 0) { if (h > 0.01) b.add(x, z, x + 0.5, z + 0.5, G, G + h, '_rstair'); } else b.add(x, z, x + 0.5, z + 0.5, G + h - 0.35, G + h, '_rstair'); });
      }
      // ---- pillars: the round ones are tested exactly (solid above); a box inside each stops rays ----
      for (const p of plan.pillars) { const h = Math.floor(p.r * 0.7 * 2) / 2; if (h > 0) b.add(p.x - h, p.z - h, p.x + h, p.z + h, p.y0, p.y1, '_pillar'); }
      for (const [x0, z0, x1, z1] of plan.squares) b.add(x0, z0, x1, z1, G, ROOF, 'pillar');
      // (the lane hall's wall leans in: keep heads out of it where you can stand right against it)
      b.add(2, 8, 2.5, 10, G, G + 4.6, '_lean');
      // ---- water ----
      // pools: dug out of the deck cell by cell; flooded rooms: a floor at SH
      const bodyOf = plan.pools.map(p => b.body({ y: WY, bottom: p.bottom, pool: p.id, name: p.name }));
      const Wc = W * 2;
      for (let iz = 0; iz < D * 2; iz++) for (let ix = 0; ix < Wc; ix++) {
        const id = plan.poolGrid[iz * Wc + ix];
        if (id < 0) continue;
        const p = plan.pools[id], x = ix * 0.5, z = iz * 0.5;
        // only where the deck is (never through a wall)
        const sp = b.wd.spans[iz * b.wd.w + ix];
        if (sp.some(s => s.y0 < G + 2 && s.y1 > G + 0.01)) { plan.poolGrid[iz * Wc + ix] = -1; continue; }
        air(x, z, x + 0.5, z + 0.5, p.bottom, G);
        b.wet(bodyOf[id], x, z, x + 0.5, z + 0.5);
      }
      { const st = plan.poolSteps;
        for (const [z0, z1, top] of st.rows) for (let z = z0; z < z1; z += 0.5) for (let x = st.x0; x < st.x1; x += 0.5) if (plan.poolAt(x + 0.25, z + 0.25) === st.pool) b.add(x, z, x + 0.5, z + 0.5, plan.pools[st.pool].bottom, top, 'pstep'); }
      const shallow = b.body({ y: WY, bottom: SH, shallow: true, name: 'flooded' });
      for (const s of plan.shallows) b.wet(shallow, s.x0, s.z0, s.x1, s.z1);
      // ---- the way out: a tunnel under the Great Pool's south deck, and the shaft with the exit ladder ----
      { const e = plan.exit; air(e.tunnel.x0, e.tunnel.z0, e.tunnel.x1, e.tunnel.z1, e.tunnel.y0, e.tunnel.y1); air(e.shaft.x0, e.shaft.z0, e.shaft.x1, e.shaft.z1, e.shaft.y0, e.shaft.y1); }
      for (const [dx, dz] of [[0, -0.7], [0, 0.7], [1.4, -0.7], [1.4, 0.7]]) b.spawn('atk', plan.start.x + dx, plan.start.z + dz, plan.start.yaw);
      b.spawn('def', plan.start.x, plan.start.z, 0);
    },
  };
}

// A slide's path made smooth (Catmull-Rom through its points), measured along its length so a ride moves evenly:
// at(s) for s = 0 … 1 gives [x, y, z]; total = its length in metres. The same on every computer (no three.js).
export function slideCurve(pts) {
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const seg = (i, t) => {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
  };
  const N = 20, samples = [], len = [0];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < N; k++) samples.push(seg(i, k / N));
  samples.push(pts[pts.length - 1].slice());
  for (let i = 1; i < samples.length; i++) len.push(len[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1], samples[i][2] - samples[i - 1][2]));
  const total = len[len.length - 1];
  const at = (s) => {
    const d = Math.max(0, Math.min(1, s)) * total;
    let lo = 0, hi = len.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] < d) lo = m; else hi = m; }
    const f = len[hi] > len[lo] ? (d - len[lo]) / (len[hi] - len[lo]) : 0, a = samples[lo], b = samples[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  return { at, total, samples, len };
}

// put a bridge up (solid: a tiled slab you can walk on, at deck height) or take it away. Host and players alike.
export function setBridge(world, br, solid) {
  for (let iz = Math.round(br.z0 * 2); iz < Math.round(br.z1 * 2); iz++) for (let ix = Math.round(br.x0 * 2); ix < Math.round(br.x1 * 2); ix++) {
    const i = iz * world.w + ix, list = world.spans[i].filter(s => s.m !== '_bridge');
    if (solid) { list.push({ y0: G - 0.3, y1: G, m: '_bridge', pen: false, prop: -1 }); list.sort((a, b) => a.y0 - b.y0); }
    world.spans[i] = list;
  }
}
