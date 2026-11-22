// Level 1 of the Backrooms: an underground parking garage. ONE fixed, hand-made layout (not random), about
// half the area of Level 0: two floors of open decks with rows of pillars, joined by two car ramps and two
// stairwells, with side rooms (attendant booths / storerooms) round the edges. No three.js in here: the host,
// every player and the home server build the same world from it.
//
//   lower floor "P2" at y = 0, upper floor "P1" at y = GAR.FL. Each is GAR.clear high under its ceiling.
//   x runs west → east (0…64), z north → south (0…52); 1 m of solid edge all round.
//
// Rows (z):  1–6.5 bays | 6.5–12.5 aisle A | 12.5–22.5 block 1 | 22.5–29.5 aisle B | 29.5–39.5 block 2 |
//            39.5–45.5 aisle C | 45.5–51 bays.   Cross aisles at x 1–9.5 (west) and 55–63 (east).
// Ramp A (block 1) climbs east from x 10 to 25; ramp B (block 2) climbs west from x 54.5 to 39.5.
import { rng, brLevel } from './brmap.js';

export const GAR = {
  size: [64, 52],
  FL: 3.4,            // the upper floor's level
  clear: 3.0,         // floor to ceiling, both floors ("low ceilings")
  top: 6.4,           // the upper floor's ceiling
  door: 2.2,          // doorway height
  car: { w: 2, l: 4.5, h: 1.4 },
};
const { FL, clear: CLEAR, top: TOP } = GAR;
export const floorY = f => (f ? FL : 0);
// which floor a height is on (0 lower, 1 upper)
export const floorOf = y => (y > FL - 1.2 ? 1 : 0);

// What changes with the difficulty for the shapeshifter (its speeds, sight and hearing are Level 0's: BR_LEVELS):
// spring: how close you get before a disguise breaks out (m); burst: how long breaking out takes (s: your head start);
// ambush: how often it chooses to wait as a prop rather than prowl; tell: how clear its giveaways are (1 = obvious).
export const GAR_LEVELS = {
  easy: { spring: 2.6, burst: 1.2, ambush: 0.4, tell: 1, crank: 10 },
  normal: { spring: 3.3, burst: 0.95, ambush: 0.6, tell: 0.6, crank: 14 },
  hard: { spring: 4.0, burst: 0.75, ambush: 0.8, tell: 0.3, crank: 18 },
};
export const garLevel = v => brLevel(String(v == null ? '' : v).split(':').pop());

// pillars: half a metre across (x) by one metre (z); a bay line runs through the middle of each
const PX = [9.5, 17, 24.5, 32, 39.5, 47, 54.5];
const PZ = [5.5, 12.5, 21.5, 29.5, 38.5, 45.5];
const bayX = k => 9.75 + k * 2.5;                        // the painted line on the west side of bay k (0…17)

// side rooms: the inside of each (walls go round it), its door and its windows. floor: 0 lower, 1 upper.
// door / windows: the cells of the gap in the wall; v: the wall runs north–south (you walk through along x).
const ROOMS = [
  { name: 'STORE', floor: 0, x0: 1, z0: 1, x1: 5, z1: 5.5, door: { v: false, x0: 3, z0: 5.5, x1: 4.5, z1: 6 }, win: [{ x0: 5, z0: 2, x1: 5.5, z1: 4 }] },
  { name: 'ATTENDANT', floor: 0, x0: 59, z0: 40, x1: 63, z1: 44, door: { v: true, x0: 58.5, z0: 41.5, x1: 59, z1: 43 }, win: [{ x0: 60, z0: 39.5, x1: 62, z1: 40 }, { x0: 60, z0: 44, x1: 62, z1: 44.5 }] },
  { name: 'ATTENDANT', floor: 0, x0: 1, z0: 24, x1: 5, z1: 28.5, door: { v: true, x0: 5, z0: 25.5, x1: 5.5, z1: 27 }, win: [{ x0: 2, z0: 23.5, x1: 4, z1: 24 }, { x0: 2, z0: 28.5, x1: 4, z1: 29 }] },
  { name: 'STORE', floor: 0, x0: 28, z0: 47, x1: 33, z1: 51, door: { v: false, x0: 29.5, z0: 46.5, x1: 31, z1: 47 }, win: [{ x0: 27.5, z0: 48, x1: 28, z1: 50 }, { x0: 33, z0: 48, x1: 33.5, z1: 50 }] },
  { name: 'ATTENDANT', floor: 1, x0: 59, z0: 20, x1: 63, z1: 24, door: { v: true, x0: 58.5, z0: 21.5, x1: 59, z1: 23 }, win: [{ x0: 60, z0: 19.5, x1: 62, z1: 20 }, { x0: 60, z0: 24, x1: 62, z1: 24.5 }] },
  { name: 'STORE', floor: 1, x0: 1, z0: 30, x1: 5, z1: 34.5, door: { v: true, x0: 5, z0: 31.5, x1: 5.5, z1: 33 }, win: [{ x0: 2, z0: 29.5, x1: 4, z1: 30 }, { x0: 2, z0: 34.5, x1: 4, z1: 35 }] },
  { name: 'STORE', floor: 1, x0: 30, z0: 1, x1: 35, z1: 5, door: { v: false, x0: 33, z0: 5, x1: 34.5, z1: 5.5 }, win: [{ x0: 29.5, z0: 2, x1: 30, z1: 4 }, { x0: 35, z0: 2, x1: 35.5, z1: 4 }] },
];

const RAMPS = [
  { x0: 10, x1: 25, z0: 15, z1: 20, dir: '+x' },          // A: up towards the east
  { x0: 39.5, x1: 54.5, z0: 32, z1: 37, dir: '-x' },      // B: up towards the west
];
const STAIRS = [
  { x0: 1, x1: 3, z0: 44, z1: 49.5, dir: '-z', wall: [3, 44, 3.5, 51], gap: [3, 49.5, 3.5, 51], land: [1, 49.5, 3, 51] },      // south-west
  { x0: 61, x1: 63, z0: 2.5, z1: 8, dir: '+z', wall: [60.5, 1, 61, 8], gap: [60.5, 1, 61, 2.5], land: [61, 1, 63, 2.5] },       // north-east
];
// shallow puddles, on the lower floor (it is the damp one): wading is slower and it splashes
const PUDDLES = [[19, 24, 25, 27.5], [40, 6.5, 45.5, 9], [12, 43, 17.5, 46], [56, 30, 61, 33.5], [5.5, 15, 9, 19], [26, 16, 31, 21]];

const inRect = (x, z, r, pad = 0) => x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad;

// The whole plan as plain data (the same on every computer): where everything is.
function makePlan(level) {
  const R = rng(1977);
  const plan = { level, rooms: ROOMS, ramps: RAMPS, stairs: STAIRS, puddles: PUDDLES.map(([x0, z0, x1, z1]) => ({ x0, z0, x1, z1 })) };
  plan.pillars = [];
  for (const f of [0, 1]) for (const z of PZ) for (const x of PX) {
    // (none where a side room or a ramp stands)
    const c = [x, z, x + 0.5, z + 1];
    if (ROOMS.some(r => r.floor === f && inRect(x + 0.25, z + 0.5, [r.x0, r.z0, r.x1, r.z1], 0.6))) continue;
    plan.pillars.push({ x, z, f, name: `${'ABCDEF'[PZ.indexOf(z)]}${PX.indexOf(x) + 1}`, c });
  }
  // parking bays: { f, k, x (middle), z0, z1 (the car's ends), nose: which way the car's nose points (dz) }
  const rows = [[1.5, 6, -1, 'N'], [13, 17.5, -1, 'B1'], [17.5, 22, 1, 'B1'], [30, 34.5, -1, 'B2'], [34.5, 39, 1, 'B2'], [46.5, 51, 1, 'S']];
  plan.bays = [];
  for (const f of [0, 1]) for (const [z0, z1, nose, row] of rows) for (let k = 0; k < 18; k++) {
    const x = bayX(k) + 1.25;
    if (row === 'B1' && x < 32.25) continue;                       // ramp A and the lane past its top
    if (row === 'B2' && x > 32.25) continue;                       // ramp B and its lane
    if (ROOMS.some(r => r.floor === f && inRect(x, (z0 + z1) / 2, [r.x0, r.z0, r.x1, r.z1], 1.6))) continue;
    if (f === 1 && row === 'N' && x < 8) continue;
    plan.bays.push({ f, k, x, z0, z1, nose, row });
  }
  // the order (stage 7): fuse box (lower floor, north wall), the crank and the roller shutter (upper floor,
  // north-west), the goods lift behind the shutter, and where everyone starts (upper floor, south-east)
  plan.fuse = { x: 57.5, y: 0, z: 1, nx: 0, nz: 1 };
  plan.shutter = { x0: 2, z0: 5.5, x1: 5, z1: 6, y: FL, h: 2.4 };
  plan.crank = { x: 1.5, y: FL, z: 6, nx: 0, nz: 1 };
  plan.lift = { x0: 1, z0: 1, x1: 5, z1: 5.5, y: FL };
  plan.start = { x: 59, y: FL, z: 48, yaw: Math.PI / 4 };
  plan.log = { x: 61, y: FL + 1.45, z: 51, nx: 0, nz: -1 };          // the one explorer log, on the wall by the start
  plan.monster = { x: 14, y: 0, z: 42.5 };
  // real cars: about a third of the bays, never right by the start
  const COLOURS = 7;
  plan.cars = [];
  for (const b of plan.bays) {
    const nearStart = b.f === 1 && Math.hypot(b.x - plan.start.x, (b.z0 + b.z1) / 2 - plan.start.z) < 9;
    const r = R(), kind = R(), col = Math.floor(R() * COLOURS), skew = (R() - 0.5) * 0.08, flat = Math.floor(R() * 5);
    if (r < 0.34 && !nearStart) { b.car = plan.cars.length; plan.cars.push({ bay: plan.bays.indexOf(b), f: b.f, x: b.x, z: (b.z0 + b.z1) / 2, nose: b.nose, kind: kind < 0.5 ? 'saloon' : kind < 0.8 ? 'hatch' : 'van', col, skew, flat }); }
  }
  // traffic cones: real stacks and single ones; and spots where there could be a stack (but isn't)
  plan.cones = []; plan.coneSpots = [];
  plan.risers = []; plan.riserSpots = [];           // drain pipes down the side of a pillar (and pillars without one)
  for (const p of plan.pillars) {
    const y = floorY(p.f), side = R() < 0.5 ? -1 : 1;
    const cone = { x: p.x + 0.25 + side * 0.75, y, z: p.z + 0.5 + (R() - 0.5) * 0.4 };
    const r = R();
    if (r < 0.14) plan.cones.push({ ...cone, n: 3 + Math.floor(R() * 2) });
    else if (r < 0.2) plan.cones.push({ ...cone, n: 1 });
    else if (r < 0.6) plan.coneSpots.push(cone);
    const ps = R() < 0.5 ? -1 : 1, pipe = { x: p.x + 0.25, y, z: p.z + (ps < 0 ? -0.09 : 1.09), side: ps };
    if (R() < 0.3) plan.risers.push(pipe); else plan.riserSpots.push(pipe);
  }
  // batteries (stage 5): on the floor, some in the side rooms
  plan.batteries = [[2.5, 0, 2.5], [61, 0, 42], [39, 0, 26], [30.5, 0, 49.5], [56.5, 0, 37.5], [61, FL, 22], [2.5, FL, 32], [32, FL, 2.5], [20, FL, 9.5]].map(([x, y, z]) => ({ x, y, z }));
  // lights: orange sodium lamps (the emergency circuit: always on) and white tubes (they need the power back;
  // group 0 steady, 1 and 2 flicker). The lower floor is mostly sodium, the upper mostly tubes.
  plan.lights = [];
  const L = (x, z, f, kind, grp = 0) => plan.lights.push({ x, z, f, y: floorY(f) + CLEAR - 0.12, kind, grp });
  for (const f of [0, 1]) {
    for (const z of [9.5, 26, 42.5]) {
      for (const x of [5, 20, 35, 50, 60]) L(x, z, f, 'sodium');
      for (const x of [12.5, 27.5, 42.5, 55]) L(x, z, f, 'tube', f === 0 ? 1 + ((x + z) % 2 > 1 ? 1 : 0) : R() < 0.25 ? 1 : 0);
    }
    for (const z of [3.5, 48.5]) for (const x of [14, 29, 44]) L(x, z, f, 'tube', R() < (f ? 0.2 : 0.5) ? 2 : 0);
    L(43, 17.5, f, 'tube', 0); L(21, 34.5, f, 'tube', f ? 0 : 2);
    L(28.5, 17.5, f, 'sodium'); L(36, 34.5, f, 'sodium'); L(5, 17.5, f, 'sodium'); L(59, 34.5, f, 'sodium');
  }
  for (const r of ROOMS) L((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.floor, 'tube', 0);
  L(3, 3.2, 1, 'tube', 0);                                       // in the lift
  for (const s of STAIRS) { L((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, 1, 'sodium'); L((s.land[0] + s.land[2]) / 2, (s.land[1] + s.land[3]) / 2, 0, 'sodium'); }
  // drips from the ceiling: over the puddles, and a few more
  plan.drips = [];
  for (const p of plan.puddles) for (let i = 0; i < 2; i++) plan.drips.push({ x: p.x0 + 0.5 + R() * (p.x1 - p.x0 - 1), z: p.z0 + 0.5 + R() * (p.z1 - p.z0 - 1), f: 0, every: 1.6 + R() * 3 });
  for (const [x, z] of [[22, 10], [47, 27], [8, 40], [36, 43]]) plan.drips.push({ x, z, f: 1, every: 2.5 + R() * 4 });
  // ducts that hang low across the aisles (it folds itself low to get under them): [x0, z0, x1, z1, floor]
  plan.ducts = [[16, 6.5, 16.8, 12.5, 0], [46, 22.5, 46.8, 29.5, 0], [22, 39.5, 22.8, 45.5, 0], [40, 6.5, 40.8, 12.5, 1], [14, 22.5, 14.8, 29.5, 1], [50, 39.5, 50.8, 45.5, 1]]
    .map(([x0, z0, x1, z1, f]) => ({ x0, z0, x1, z1, f }));
  return plan;
}

// is this spot inside a side room? (its index, or -1)  — pad: how far outside the walls still counts
export function sideRoomAt(plan, x, y, z, pad = 0) {
  const f = floorOf(y);
  return plan.rooms.findIndex(r => r.floor === f && x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);
}

// The map definition the World is built from (same shape as the maps in maps.js). variant = the difficulty.
export function garageMap(variant) {
  const level = garLevel(variant);
  const plan = makePlan(level);
  const [W, D] = GAR.size;
  return {
    name: 'Level 1: The Garage',
    description: 'Co-op escape, level 1: an underground car park. Not everything parked here is a car.',
    mode: 'br',
    theme: 'garage',
    size: [W, D],
    massHeight: 7.2,
    variant, level,
    gar: plan,
    build(b) {
      const wall = (x0, z0, x1, z1, y0, y1, m = 'conc') => b.add(x0, z0, x1, z1, y0, y1, m);
      b.open(1, 1, W - 1, D - 1);
      b.add(1, 1, W - 1, D - 1, CLEAR, FL, 'slab');                 // the deck between the floors
      b.add(1, 1, W - 1, D - 1, TOP, TOP + 0.4, '_ceiling');
      for (const p of plan.pillars) wall(p.x, p.z, p.x + 0.5, p.z + 1, floorY(p.f), floorY(p.f) + (p.f ? CLEAR : FL), 'pillar');
      // car ramps: a hole in the deck over each, a wall down both sides (a low parapet upstairs), and the slope
      for (const r of plan.ramps) {
        b.cut(r.x0, r.z0, r.x1, r.z1, CLEAR - 0.1, FL + 0.1);
        b.stairs(r.x0, r.z0, r.x1, r.z1, r.dir, 0, FL, 'ramp');
        wall(r.x0, r.z0 - 0.5, r.x1, r.z0, 0, FL + 1.1);
        wall(r.x0, r.z1, r.x1, r.z1 + 0.5, 0, FL + 1.1);
        // across the low end upstairs, so nobody walks off the edge
        if (r.dir === '+x') wall(r.x0 - 0.5, r.z0 - 0.5, r.x0, r.z1 + 0.5, CLEAR, FL + 1.1);
        else wall(r.x1, r.z0 - 0.5, r.x1 + 0.5, r.z1 + 0.5, CLEAR, FL + 1.1);
      }
      // stairwells: one straight flight, a wall beside it right up through both floors
      for (const s of plan.stairs) {
        b.cut(s.x0, s.z0, s.x1, s.z1, CLEAR - 0.1, FL + 0.1);
        b.stairs(s.x0, s.z0, s.x1, s.z1, s.dir, 0, FL, 'stairs');
        wall(s.wall[0], s.wall[1], s.wall[2], s.wall[3], 0, TOP);
        b.cut(s.gap[0], s.gap[1], s.gap[2], s.gap[3], 0, 2.4);     // the way in, downstairs
        wall(s.land[0], s.land[1], s.land[2], s.land[3], FL, TOP);   // (nothing to stand on above the bottom landing)
      }
      // side rooms: four walls, a door that opens and shuts, windows it can see you through
      plan.rooms.forEach((r, i) => {
        const y = floorY(r.floor), x0 = Math.max(1, r.x0 - 0.5), z0 = Math.max(1, r.z0 - 0.5), x1 = Math.min(W - 1, r.x1 + 0.5), z1 = Math.min(D - 1, r.z1 + 0.5);
        if (x0 < r.x0) wall(x0, z0, r.x0, z1, y, y + CLEAR);
        if (x1 > r.x1) wall(r.x1, z0, x1, z1, y, y + CLEAR);
        if (z0 < r.z0) wall(x0, z0, x1, r.z0, y, y + CLEAR);
        if (z1 > r.z1) wall(x0, r.z1, x1, z1, y, y + CLEAR);
        for (const w of r.win) b.cut(w.x0, w.z0, w.x1, w.z1, y + 1.0, y + 2.1);
        const d = r.door;
        b.cut(d.x0, d.z0, d.x1, d.z1, y, y + GAR.door);
        b.door({ kind: 'way', v: d.v, open: i % 3 !== 1, y, room: i }, d.x0, d.z0, d.x1, d.z1);
      });
      // the goods lift (upstairs, over the north-west store room): its walls, and the roller shutter across its front
      {
        const s = plan.shutter;
        wall(5, 1, 5.5, 6, FL, TOP); wall(1, 5.5, 5.5, 6, FL, TOP);
        b.cut(s.x0, s.z0, s.x1, s.z1, s.y, s.y + s.h);
        b.door({ kind: 'way', v: false, open: false, y: s.y, lock: 'shutter' }, s.x0, s.z0, s.x1, s.z1);
      }
      // the little recess the fuse box is in
      wall(55.5, 1, 56, 2.5, 0, CLEAR); wall(59, 1, 59.5, 2.5, 0, CLEAR);
      // cars: solid, too high to climb
      for (const c of plan.cars) { const y = floorY(c.f); b.add(c.x - 1, c.z - 2.25, c.x + 1, c.z + 2.25, y, y + GAR.car.h, '_car'); }
      for (const p of plan.puddles) b.water(p.x0, p.z0, p.x1, p.z1, 0.03);
      // six spots (online it takes up to 6 players: RULES.br)
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8], [-0.8, 0], [0.8, 0]]) b.spawn('atk', plan.start.x + dx, plan.start.z + dz, plan.start.yaw);
      b.spawn('def', plan.monster.x, plan.monster.z, 0);
    },
  };
}
