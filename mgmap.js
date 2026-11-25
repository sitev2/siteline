// The Minigames arena: ONE small hall in the Poolrooms' look (poolview.js draws it from the plan below, with the same
// tiles, water and baked light). A dry tiled court on the west side (Floatie Dodgeball, Keep Away, Hot Potato) and a
// pool with a goal at each end on the east side (Pool Ball), split by a low tiled wall nobody can jump. Each round
// everyone is put in the area that round uses; the other area is simply out of reach.
// No three.js in here: the host, every player and the home server build the same world from it.
//
//   x runs west → east (0…44), z north → south (0…18). The deck is at POOL.G (3 m), the water at POOL.WY, the roof's
//   underside at POOL.ROOF (a tall, bright hall). The glazed outer walls are 0.5 m thick; beyond them is open sky.
//   court   x 2–17,  z 2–16   (15 × 14 m, a centre line at x 9.5 for team Dodgeball)
//   divider x 17–18           (1.6 m high: too high to jump)
//   pool    x 21.5–38.5, z 3.5–14.5 (17 × 11 m, deep: you swim), goals in alcoves at each end (z 7–11)
import { POOL } from './poolmap.js';

const { G, WY, ROOF } = POOL;
const ROOFT = ROOF + 0.4;
const W = 44, D = 18;

// ---------- the games (shared by the host, the HUD and the menus) ----------
// area: where it is played. time: the round's length in seconds (0: none, it ends by itself). min: fewest players.
export const MG_GAMES = {
  dodge: { name: 'Floatie Dodgeball', area: 'court', time: 150, min: 2,
    how: 'Throw floaties at the others: hit before it bounces and they are out. Catch one thrown at you and the thrower is out.' },
  poolball: { name: 'Pool Ball', area: 'pool', time: 180, goals: 3, min: 2,
    how: 'Two teams in the pool: push or throw the floatie into the other team\'s goal. First to 3 goals.' },
  keepaway: { name: 'Keep Away', area: 'court', time: 120, min: 2,
    how: 'Hold the floatie to score a point every second. Touch whoever has it to steal it.' },
  potato: { name: 'Hot Potato', area: 'court', time: 0, fuse: 20, min: 2,
    how: 'Touch someone to pass the ticking floatie. Whoever holds it when it pops is out.' },
  // the same game as the Volleyball mode (volley.js): the same court, net, ball and rules; here one set, at most 4 minutes
  volley: { name: 'Volleyball', area: 'court', time: 240, min: 2,
    how: 'Two teams, one net: hit the ball over before it lands on your side. 3 touches a side. First to 11.' },
};
export const MG_ORDER = ['dodge', 'poolball', 'keepaway', 'potato', 'volley'];
export const MG_ROUNDS = 5;            // a party run: five rounds, each a random game (never the same twice in a row)
export const MG_POINTS = [3, 2, 1];    // points for 1st, 2nd and 3rd in a round (a shared place shares its points)
export const MG_TEAMS = { atk: 'Orange', def: 'Blue' };

// ---------- the layout ----------
export const ARENA = {
  size: [W, D],
  court: { x0: 2, z0: 2, x1: 17, z1: 16, mid: 9.5, cx: 9.5, cz: 9 },
  poolSide: { x0: 18, z0: 2, x1: 42, z1: 16 },
  pool: { x0: 21.5, z0: 3.5, x1: 38.5, z1: 14.5, cx: 30, cz: 9 },
  divider: { x0: 17, x1: 18, h: 1.6 },
  // the goals: the water in each alcove past the goal line. side: the team whose goal it is (they defend it)
  goals: [
    { side: 'atk', line: 21.5, back: 20, dir: -1, z0: 7, z1: 11 },
    { side: 'def', line: 38.5, back: 40, dir: 1, z0: 7, z1: 11 },
  ],
  postH: 1.15,          // the crossbar's height over the water
};

// The goal's posts (both host and players): normally they stand half a metre in from each side of the alcove, so the
// mouth is 3 m; a big goal (the smaller team's target when the teams are uneven) has them back at the sides: 4 m.
export function goalMouth(g, big) { return big ? { z0: g.z0, z1: g.z1 } : { z0: g.z0 + 0.5, z1: g.z1 - 0.5 }; }
export function setGoalPosts(world, i, big) {
  const g = ARENA.goals[i], x0 = g.dir < 0 ? g.line - 0.5 : g.line, x1 = x0 + 0.5;
  for (const z0 of [g.z0, g.z1 - 0.5]) {
    for (let iz = Math.round(z0 * 2); iz < Math.round((z0 + 0.5) * 2); iz++) for (let ix = Math.round(x0 * 2); ix < Math.round(x1 * 2); ix++) {
      const k = iz * world.w + ix, list = world.spans[k].filter(s => s.m !== '_post');
      if (!big) { list.push({ y0: G - 1.8, y1: WY + ARENA.postH, m: '_post', pen: false, prop: -1 }); list.sort((a, b) => a.y0 - b.y0); }
      world.spans[k] = list;
    }
  }
}

// where everyone starts in a round: the court (all round the middle, or each team on its own half) or the pool
// (each team in front of its own goal, floating)
export function mgSpawns(area, teams) {
  const C = ARENA.court, P = ARENA.pool, out = [];
  if (area === 'pool') {
    for (const [side, x0] of [['atk', 24.5], ['def', 35.5]]) {
      const yaw = side === 'atk' ? -Math.PI / 2 : Math.PI / 2;       // (facing the other end)
      for (const [dx, z] of [[0, 9], [0, 6], [0, 12], [side === 'atk' ? 2 : -2, 7.5], [side === 'atk' ? 2 : -2, 10.5], [side === 'atk' ? 3.5 : -3.5, 9]]) out.push({ side, x: x0 + dx, y: WY - POOL.swim, z, yaw });
    }
    return out;
  }
  if (teams) {
    for (const [side, x] of [['atk', 4.5], ['def', 14.5]]) {
      const yaw = side === 'atk' ? -Math.PI / 2 : Math.PI / 2;
      for (const z of [9, 5.5, 12.5]) out.push({ side, x, y: G, z, yaw });
    }
    return out;
  }
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + 0.3, x = C.cx + Math.cos(a) * 4.6, z = C.cz + Math.sin(a) * 4.2;
    out.push({ side: 'ffa', x, y: G, z, yaw: Math.atan2(x - C.cx, z - C.cz) });
  }
  return out;
}

// is this point in the area a round is played in? (a floatie outside it goes back in)
export function inArea(area, x, z) {
  const A = area === 'pool' ? ARENA.poolSide : ARENA.court;
  return x > A.x0 && x < A.x1 && z > A.z0 && z < A.z1;
}

// ---------- shapes (as poolmap.js: smooth pool edges) ----------
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const sdBox = (x, z, x0, z0, x1, z1, rad) => {
  const dx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - rad), dz = Math.abs(z - (z0 + z1) / 2) - ((z1 - z0) / 2 - rad);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - rad;
};

function makePlan() {
  const plan = { arena: true, level: 'normal' };
  plan.pillars = [];
  plan.rings = [];
  // the pool: the main basin and the two goal alcoves melted into it
  const P = { name: 'pitch', boxes: [[21.5, 3.5, 38.5, 14.5, 0.5], [20, 7, 22, 11, 0.25], [38, 7, 40, 11, 0.25]], k: 0.5, bottom: G - 1.8, clip: [18, 2, 42, 16] };
  const o = { ...P, id: 0, y: WY, bites: [] };
  o.raw = (x, z) => { let d = 1e9; for (const b of P.boxes) d = smin(d, sdBox(x, z, ...b), P.k); return d; };
  o.sdf = o.raw;
  o.x0 = 19; o.z0 = 2.5; o.x1 = 41; o.z1 = 15.5;
  plan.pools = [o];
  const Wc = W * 2, Dc = D * 2;
  plan.poolGrid = new Int8Array(Wc * Dc).fill(-1);
  for (let iz = Math.floor(o.z0 * 2); iz < Math.ceil(o.z1 * 2); iz++) for (let ix = Math.floor(o.x0 * 2); ix < Math.ceil(o.x1 * 2); ix++) {
    if (o.sdf(ix * 0.5 + 0.25, iz * 0.5 + 0.25) < 0.3) plan.poolGrid[iz * Wc + ix] = 0;
  }
  plan.poolAt = (x, z) => { const ix = Math.floor(x * 2), iz = Math.floor(z * 2); return ix < 0 || iz < 0 || ix >= Wc || iz >= Dc ? -1 : plan.poolGrid[iz * Wc + ix]; };
  plan.shallows = [];
  // windows: tall arches in the south wall (the low sun comes in through them) and round-topped ones in the west wall;
  // a row of small capsules high in the north wall
  const O = [];
  const snap = v => Math.round(v * 2) / 2;
  for (let x = 4.5; x < 41; x += 4.25) O.push({ axis: 'z', a0: 16, a1: 16.5, u0: x - 0.9, u1: x + 0.9, y0: G + 0.8, y1: G + 4.6, shape: 'arch', out: 1 });
  for (const z of [5.5, 12.5]) O.push({ axis: 'x', a0: 1.5, a1: 2, u0: z - 1, u1: z + 1, y0: G + 1, y1: G + 4.4, shape: 'arch', out: -1 });
  for (let x = 6; x < 40; x += 7) O.push({ axis: 'z', a0: 1.5, a1: 2, u0: x - 1.5, u1: x + 1.5, y0: G + 5.2, y1: G + 6.2, shape: 'capsule', out: -1 });
  for (const q of O) { q.u0 = snap(q.u0); q.u1 = snap(q.u1); }
  plan.openings = O;
  plan.slant = null;
  // skylights: over the court and over the pool (one round one over each middle)
  const S = [];
  const sky = (x0, z0, x1, z1, round = false) => S.push({ x0, z0, x1, z1, round });
  sky(4, 4, 6.5, 6.5); sky(12.5, 4, 15, 6.5); sky(4, 11.5, 6.5, 14); sky(12.5, 11.5, 15, 14); sky(8.5, 8, 10.5, 10, true);
  sky(24, 5, 27, 7); sky(33, 5, 36, 7); sky(24, 11, 27, 13); sky(33, 11, 36, 13); sky(29, 8, 31, 10, true);
  plan.skylights = S;
  plan.rooms = [{ name: 'hall', x0: 2, z0: 2, x1: 42, z1: 16, y0: 0, y1: ROOF, wall: 'tile', ceil: 'big', cove: 0.6 }];
  plan.roomAt = (x, y, z) => plan.rooms.find(r => x >= r.x0 - 0.01 && x <= r.x1 + 0.01 && z >= r.z0 - 0.01 && z <= r.z1 + 0.01 && y >= r.y0 - 0.01 && y <= r.y1 + 0.01) || null;
  plan.ladders = [];
  plan.exit = null; plan.lift = null; plan.tower = null; plan.well = null; plan.drain = null; plan.lanes = null; plan.grottoSteam = null;
  plan.valves = []; plan.bridges = []; plan.slides = [];
  plan.noClimb = []; plan.climbOK = () => false;
  // the floaties: five of them (Dodgeball uses most, the other games one)
  plan.floaties = [
    { name: 'red', x: 9.5, z: 9, color: '#d83a2e', stripe: '#f4f1ea' },
    { name: 'yellow', x: 7, z: 7, color: '#f2c227', stripe: null },
    { name: 'blue', x: 12, z: 7, color: '#2f6fd8', stripe: '#f4f1ea' },
    { name: 'green', x: 7, z: 11, color: '#3aa95a', stripe: null },
    { name: 'pink', x: 12, z: 11, color: '#e7609b', stripe: '#f4f1ea' },
  ];
  // painted lines in pale blue tile: the court's edge and centre line, the pool's lane lines and its goal lines
  const C = ARENA.court, st = [];
  const line = (x0, z0, x1, z1, y = G, wk = 0) => st.push({ x0, z0, x1, z1, y, wk });
  line(C.x0 + 0.6, C.z0 + 0.6, C.x1 - 0.6, C.z0 + 0.75); line(C.x0 + 0.6, C.z1 - 0.75, C.x1 - 0.6, C.z1 - 0.6);
  line(C.x0 + 0.6, C.z0 + 0.6, C.x0 + 0.75, C.z1 - 0.6); line(C.x1 - 0.75, C.z0 + 0.6, C.x1 - 0.6, C.z1 - 0.6);
  line(C.mid - 0.075, C.z0 + 0.6, C.mid + 0.075, C.z1 - 0.6);
  for (const z of [6.25, 9, 11.75]) line(23, z - 0.15, 37, z + 0.15, G - 1.8, 1);
  plan.stripes = st;
  // the volleyball court (volley.js: 12 × 6 m, the same as on the Volleyball maps), on the court's centre line, and the room
  // round it players may use (the court's walls and the low wall)
  plan.volley = { cx: ARENA.court.mid, cz: ARENA.court.cz, y: G, area: [2, 2, 17, 16] };
  plan.drains = [[19, 3], [19, 15], [41, 3], [41, 15], [3, 3], [3, 15], [16, 3], [16, 15]].map(([x, z]) => ({ x, y: G, z }));
  // beyond the glazed walls: open sky (poolview.js draws nothing there)
  plan.outdoors = (ix, iz) => ix < 3 || iz < 3 || ix >= W * 2 - 3 || iz >= D * 2 - 3;
  plan.sunBox = { c: [22, 6.5, 9], box: [1.5, 0, 1.5, W - 1.5, ROOFT, D - 1.5] };
  return plan;
}

// The map definition the World is built from (same shape as the maps in maps.js).
export function arenaMap() {
  const plan = makePlan();
  return {
    name: 'The Pool Hall',
    description: 'Minigames: a tiled court and a pool with two goals, under the skylights.',
    mode: 'mg',
    theme: 'pool',
    size: [W, D],
    massHeight: ROOFT,
    level: 'normal',
    pool: plan,
    // the pool's smooth sides only stop you once you are down in it (as in the Poolrooms)
    solid(x, z, r, y, step) {
      if (y + step < G - 0.02) {
        const i = plan.poolAt(x, z);
        if (i >= 0 && plan.pools[i].sdf(x, z) > -r) return true;
      }
      return false;
    },
    build(b) {
      const air = (x0, z0, x1, z1, y0, y1) => b.cut(x0, z0, x1, z1, y0, y1);
      air(0, 0, W, D, ROOFT, 99);
      b.open(0, 0, 1.5, D); b.open(W - 1.5, 0, W, D); b.open(0, 0, W, 1.5); b.open(0, D - 1.5, W, D);
      // the hall
      air(2, 2, W - 2, D - 2, G, ROOF);
      // the low wall between the court and the pool
      b.add(ARENA.divider.x0, 2, ARENA.divider.x1, D - 2, G, G + ARENA.divider.h, 'mass');
      // windows (glazed) and skylights
      for (const o of plan.openings) {
        const r = o.axis === 'x' ? [o.a0, o.u0, o.a1, o.u1] : [o.u0, o.a0, o.u1, o.a1];
        air(r[0], r[1], r[2], r[3], o.y0, o.y1);
        if (o.out) b.add(r[0], r[1], r[2], r[3], o.y0, o.y1, '_glass');
      }
      for (const s of plan.skylights) air(s.x0, s.z0, s.x1, s.z1, ROOF, 99);
      // the pool: dug out of the deck cell by cell
      const p = plan.pools[0], body = b.body({ y: WY, bottom: p.bottom, pool: 0, name: p.name });
      const Wc = W * 2;
      for (let iz = 0; iz < D * 2; iz++) for (let ix = 0; ix < Wc; ix++) {
        if (plan.poolGrid[iz * Wc + ix] < 0) continue;
        const x = ix * 0.5, z = iz * 0.5;
        air(x, z, x + 0.5, z + 0.5, p.bottom, G);
        b.wet(body, x, z, x + 0.5, z + 0.5);
      }
      // the goals' posts (the normal, 3 m goal)
      for (let i = 0; i < ARENA.goals.length; i++) {
        const g = ARENA.goals[i], x0 = g.dir < 0 ? g.line - 0.5 : g.line;
        for (const z0 of [g.z0, g.z1 - 0.5]) b.add(x0, z0, x0 + 0.5, z0 + 0.5, p.bottom, WY + ARENA.postH, '_post');
      }
      for (const s of mgSpawns('court', false)) b.spawn('atk', s.x, s.z, s.yaw);
      b.spawn('def', ARENA.court.cx, ARENA.court.cz, 0);
    },
  };
}
