// Computer-controlled players for practice games (never in normal matches).
// Runs on the host next to server.js: bots find their way round the map on a walking grid,
// hear footsteps and gunfire, remember where they last saw (or heard) you and tell their
// teammates, pre-aim the corners you're likely to come round, stop to shoot and strafe between
// bursts, fall back to cover when hurt or reloading, and play the bomb objective as a team
// (routes into the site, holding angles, guarding the planted bomb, retakes, saving).
// They fire through the same hit checks as players.
import { CELL, STEP, PLAYER_RADIUS, PLAYER_HEIGHT, EYE, GRAVITY, rayVsPlayer } from './world.js';
import { WEAPONS, U, runSpeed, penMetres, ACCURATE_SPEED, patternAt } from './weapons.js';
import { RULES } from './config.js';

// How each difficulty plays.
//   reaction: seconds before the first shot after spotting you
//   turn: how fast they turn their aim (radians per second)
//   err / minErr: aim error when they first see you / once settled; settle: seconds to settle
//   head: chance to aim for the head; recoil: share of the recoil they fail to control
//   burst: bullets per burst at range; pause: seconds between bursts; tap: seconds between pistol shots
//   stop: chance they stop moving to shoot; fov: how wide they look (cosine); sight: metres
//   smart: how much they use tactics (pre-aiming, counter-strafing, cover, teamwork) 0–1
//   hear: how far they hear (share of the full distance); callout: seconds before teammates share a sighting
//   retreatHp: fall back to cover below this much health
export const BOT_LEVELS = {
  easy: { reaction: 0.8, turn: 3.0, err: 0.12, minErr: 0.04, settle: 1.6, head: 0.08, recoil: 1.0, burst: [6, 12], pause: 0.5, tap: 0.5, stop: 0.35, fov: 0.45, sight: 35, smart: 0.25, hear: 0.55, callout: 1.2, retreatHp: 0 },
  normal: { reaction: 0.45, turn: 6.0, err: 0.065, minErr: 0.018, settle: 0.9, head: 0.22, recoil: 0.45, burst: [3, 7], pause: 0.32, tap: 0.32, stop: 0.8, fov: 0.25, sight: 50, smart: 0.65, hear: 0.85, callout: 0.6, retreatHp: 30 },
  hard: { reaction: 0.25, turn: 11, err: 0.032, minErr: 0.007, settle: 0.45, head: 0.42, recoil: 0.15, burst: [3, 5], pause: 0.2, tap: 0.21, stop: 1.0, fov: 0.1, sight: 70, smart: 1.0, hear: 1.0, callout: 0.35, retreatHp: 40 },
};

export const BOT_NAMES = ['Ash', 'Birch', 'Cedar', 'Dune', 'Ember', 'Flint', 'Grove', 'Haze', 'Iris', 'Jade', 'Kite', 'Lark', 'Moss', 'Nova', 'Onyx', 'Pike'];

const JUMP_V = Math.sqrt(2 * GRAVITY * 54 * U);
const eyeOf = p => p.y + EYE;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- walking grid ----------
// One node per standable surface in each 0.5 m cell (with room for a whole player
// around it), linked to neighbours you can walk or step to, plus one-way drops off ledges.
export class NavGrid {
  constructor(world) {
    this.world = world;
    const W = world.w, H = world.h;
    this.W = W;
    const tops = new Array(W * H);
    for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) {
      const spans = world.cellSpans(ix, iz);
      const list = [...(world.pitCell(ix, iz) ? [] : [0]), ...spans.map(s => s.y1)].filter((t, i, a) => a.indexOf(t) === i)
        .filter(t => !spans.some(s => (s.y0 < t + 1.8 && s.y1 > t + 0.01) || (s.y0 < t - 0.01 && s.y1 > t + 0.01)));
      tops[iz * W + ix] = list;
    }
    const near = (ix, iz, y) => {
      if (ix < 0 || iz < 0 || ix >= W || iz >= H) return undefined;
      return tops[iz * W + ix].find(t => Math.abs(t - y) <= STEP + 0.01);
    };
    const fits = (ix, iz, y) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (near(ix + dx, iz + dz, y) === undefined) return false;
      return true;
    };
    this.cellNodes = new Array(W * H);
    const xs = [], ys = [], zs = [];
    for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) {
      const list = [];
      for (const t of tops[iz * W + ix]) {
        if (!fits(ix, iz, t)) continue;
        list.push(xs.length);
        xs.push((ix + 0.5) * CELL); ys.push(t); zs.push((iz + 0.5) * CELL);
      }
      this.cellNodes[iz * W + ix] = list;
    }
    this.x = Float32Array.from(xs); this.y = Float32Array.from(ys); this.z = Float32Array.from(zs);
    this.n = xs.length;
    this.edges = new Array(this.n);
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < this.n; i++) {
      const ix = Math.floor(this.x[i] / CELL), iz = Math.floor(this.z[i] / CELL), y = this.y[i];
      const out = [];
      for (const [dx, dz] of D) {
        const nx = ix + dx, nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        if (dx && dz && (near(ix + dx, iz, y) === undefined || near(ix, iz + dz, y) === undefined)) continue;
        // wading through a canal is slow and loud: count it as nearly twice as far
        const wet = y < 0.3 && world.waterAt((nx + 0.5) * CELL, (nz + 0.5) * CELL) > 0 ? 1.9 : 1;
        const cost = (dx && dz ? CELL * Math.SQRT2 : CELL) * wet;
        for (const j of this.cellNodes[nz * W + nx]) {
          const dy = this.y[j] - y;
          if (Math.abs(dy) <= STEP + 0.01) out.push(j, cost);
          else if (!dz || !dx) {
            // drop down a ledge (one way) if nothing is in the way on the way down
            if (dy < -STEP && dy > -4 && !world.cellSpans(nx, nz).some(s => s.y0 < y + 1.8 && s.y1 > this.y[j] + 0.01)) out.push(j, cost + 1.5 - dy * 0.3);
          }
        }
      }
      this.edges[i] = out;
    }
    // which surfaces you can actually walk to from the spawns (not roofs, crate tops…)
    this.reach = new Uint8Array(this.n);
    const queue = [];
    for (const list of Object.values(world.spawns)) for (const sp of list) {
      const i = this.nearest(sp.x, 0, sp.z);
      if (i >= 0 && !this.reach[i]) { this.reach[i] = 1; queue.push(i); }
    }
    while (queue.length) {
      const i = queue.pop(), e = this.edges[i];
      for (let k = 0; k < e.length; k += 2) if (!this.reach[e[k]]) { this.reach[e[k]] = 1; queue.push(e[k]); }
    }
  }

  // closest node to a point (searching a few cells around it)
  nearest(x, y, z) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 4 && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = ix + dx, cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= this.W || cz * this.W + cx >= this.cellNodes.length) continue;
        for (const j of this.cellNodes[cz * this.W + cx]) {
          const dy = Math.abs(this.y[j] - y);
          if (dy > 1.4) continue;
          const d = (this.x[j] - x) ** 2 + (this.z[j] - z) ** 2 + dy * dy * 4 + (this.reach && !this.reach[j] ? 4 : 0);
          if (d < bd) { bd = d; best = j; }
        }
      }
    }
    return best;
  }

  // is there a node in this cell at about this height? (for straight-line checks)
  standable(x, y, z) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    if (ix < 0 || iz < 0 || ix >= this.W) return false;
    const list = this.cellNodes[iz * this.W + ix];
    return !!list && list.some(j => Math.abs(this.y[j] - y) < 0.45);
  }

  // A* search: list of node indices from a to b, or null
  path(a, b, maxIter = 30000) {
    if (a < 0 || b < 0) return null;
    if (a === b) return [a];
    const n = this.n;
    const g = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const bx = this.x[b], by = this.y[b], bz = this.z[b];
    const h = i => Math.hypot(this.x[i] - bx, this.z[i] - bz) + Math.abs(this.y[i] - by);
    const heap = [[h(a), a]];
    g[a] = 0;
    const push = (f, i) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    for (let it = 0; heap.length && it < maxIter; it++) {
      const [, i] = pop();
      if (closed[i]) continue;
      if (i === b) {
        const out = [];
        for (let k = b; k >= 0; k = came[k]) out.push(k);
        return out.reverse();
      }
      closed[i] = 1;
      const e = this.edges[i];
      for (let k = 0; k < e.length; k += 2) {
        const j = e[k];
        if (closed[j]) continue;
        const ng = g[i] + e[k + 1];
        if (ng < g[j]) { g[j] = ng; came[j] = i; push(ng + h(j), j); }
      }
    }
    return null;
  }

  // a random reachable node (that passes the filter, if given)
  randomNode(filter, tries = 400) {
    let any = -1;
    for (let t = 0; t < tries; t++) {
      const i = Math.floor(Math.random() * this.n);
      if (!this.reach[i]) continue;
      if (any < 0) any = i;
      if (!filter || filter(this.x[i], this.y[i], this.z[i], i)) return i;
    }
    return any >= 0 ? any : Math.floor(Math.random() * this.n);
  }
}

// ---------- what bots can hear ----------
// One per server, shared by every bot: works out who is making noise each tick.
// Running feet carry ~15 m, gunshots ~45 m (a silencer cuts that to ~9 m), planting and
// defusing the bomb ~18 m. Bots only learn a rough position from a sound.
const STEP_SPEED = 140 * U;
class Ears {
  constructor(s) { this.s = s; this.prev = new Map(); this.sounds = []; this.at = -1; }
  update(now) {
    if (now === this.at) return;
    const dt = this.at < 0 ? 0 : now - this.at;
    this.at = now;
    const s = this.s;
    for (const q of s.players.values()) {
      const pr = this.prev.get(q.id);
      if (q.alive && pr && dt > 0) {
        const sp = Math.hypot(q.x - pr.x, q.z - pr.z) / dt;
        const wet = q.y < 0.3 && s.world.waterAt(q.x, q.z) > 0;
        if ((wet ? sp > 0.8 : sp > STEP_SPEED) && sp < 12 && Math.abs(q.y - pr.y) < 0.15 && now - (pr.step || 0) > 0.33) {
          pr.step = now;
          this.sounds.push({ kind: 'step', id: q.id, x: q.x, y: q.y, z: q.z, t: now, r: wet ? 18 : 15 });
        }
        if (q.lastShot && q.lastShot !== pr.shot) {
          const w = WEAPONS[q.w];
          this.sounds.push({ kind: 'shot', id: q.id, x: q.x, y: q.y, z: q.z, t: now, r: w && w.silenced ? 9 : 45 });
        }
      }
      const rec = pr || {};
      Object.assign(rec, { x: q.x, y: q.y, z: q.z, shot: q.lastShot });
      if (!pr) this.prev.set(q.id, rec);
    }
    const b = s.bomb;
    if (b && b.user && now - (this.bombAt || 0) > 0.5) {
      const u = s.players.get(b.user);
      if (u) { this.bombAt = now; this.sounds.push({ kind: b.state === 'planted' ? 'defuse' : 'plant', id: u.id, x: u.x, y: u.y, z: u.z, t: now, r: 18 }); }
    }
    if (this.sounds.length > 80 || (this.sounds.length && now - this.sounds[0].t > 2)) this.sounds = this.sounds.filter(n => now - n.t < 2);
  }
}
const ears = s => s._botEars || (s._botEars = new Ears(s));

// ---------- reading the map (bomb maps) ----------
// Worked out once per map: the routes from the attacker spawn into the bomb site, where each
// route enters the site, a staging point just before it, and good spots to hold each entry from.
function tactics(nav, world) {
  if (nav._tac !== undefined) return nav._tac;
  nav._tac = null;
  const rect = world.siteRects && world.siteRects[0], sp = world.spawns.atk && world.spawns.atk[0];
  if (!rect || !sp) return null;
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const inRect = (x, z, m) => x > rect.x0 - m && x < rect.x1 + m && z > rect.z0 - m && z < rect.z1 + m;
  const start = nav.nearest(sp.x, 0, sp.z);
  // the middle of the site: the closest spot to it that you can actually walk to
  let goal = -1, gd = Infinity;
  for (let i = 0; i < nav.n; i++) {
    if (!nav.reach[i] || !inRect(nav.x[i], nav.z[i], 0)) continue;
    const d = (nav.x[i] - cx) ** 2 + (nav.z[i] - cz) ** 2 + nav.y[i] * nav.y[i] * 4;
    if (d < gd) { gd = d; goal = i; }
  }
  const pen = new Float32Array(nav.n);
  const routes = [];
  for (let r = 0; r < 4 && routes.length < 3; r++) {
    const path = penalisedPath(nav, start, goal, pen);
    if (!path) break;
    // where the route reaches the site
    let e = path.findIndex(i => inRect(nav.x[i], nav.z[i], 1.5));
    if (e < 0) e = path.length - 1;
    const entry = path[e];
    // staging point: about 7 m of path before the entry
    let s = e, len = 0;
    while (s > 0 && len < 7) { len += Math.hypot(nav.x[path[s]] - nav.x[path[s - 1]], nav.z[path[s]] - nav.z[path[s - 1]]); s--; }
    const P = i => ({ x: nav.x[i], y: nav.y[i], z: nav.z[i] });
    if (!routes.some(o => Math.hypot(o.entry.x - nav.x[entry], o.entry.z - nav.z[entry]) < 5)) {
      routes.push({ entry: P(entry), stage: P(path[s]), mid: P(path[Math.floor(e * 0.55)]), path, e });
    }
    // make the next search avoid this corridor
    markCorridor(nav, path, pen);
  }
  if (!routes.length) return null;
  // spots to hold each entry from: inside or near the site, with a clear view of the entry,
  // close to a wall or box, not too close to the entry itself
  const cand = [];
  for (let t = 0; t < 600 && cand.length < 260; t++) {
    const i = nav.randomNode((x, y, z) => inRect(x, z, 5) && Math.abs(y) < 2.5);
    if (cand.includes(i) || !inRect(nav.x[i], nav.z[i], 5)) continue;
    cand.push(i);
  }
  for (const r of routes) {
    const ex = r.entry.x, ey = r.entry.y + 1.5, ez = r.entry.z;
    r.holds = [];
    for (const i of cand) {
      const x = nav.x[i], y = nav.y[i] + 1.5, z = nav.z[i];
      const d = Math.hypot(x - ex, z - ez);
      if (d < 5 || d > 20) continue;
      if (!clearLine(world, x, y, z, ex, ey, ez)) continue;
      r.holds.push({ x, y: nav.y[i], z, score: coverAround(world, nav, i) * 1.2 + Math.min(d, 12) * 0.25 + (inRect(x, z, 0) ? 1 : 0) + Math.random() * 0.6 });
    }
    r.holds.sort((a, b) => b.score - a.score);
    r.holds = r.holds.slice(0, 6);
  }
  // where to gather before going in: on the way, a few metres short of the entry, out of
  // sight of every holding spot (so the defenders can't pick you off while you wait)
  const allHolds = routes.flatMap(r => r.holds.slice(0, 4));
  for (const r of routes) {
    let len = 0;
    for (let k = r.e; k > 0; k--) {
      const i = r.path[k];
      len += Math.hypot(nav.x[i] - nav.x[r.path[k - 1]], nav.z[i] - nav.z[r.path[k - 1]]);
      if (len < 3) continue;
      if (len > 22) break;
      const x = nav.x[i], y = nav.y[i] + 1.5, z = nav.z[i];
      // hidden even a step either side of it
      const seen = [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].some(([ox, oz]) =>
        allHolds.some(h => clearLine(world, x + ox, y, z + oz, h.x, h.y + 1.5, h.z)) || clearLine(world, x + ox, y, z + oz, cx, 1.5, cz));
      if (seen) continue;
      r.stage = { x, y: nav.y[i], z };
      break;
    }
  }
  nav._tac = { routes, rect, cx, cz, inRect };
  return nav._tac;
}
// A* that adds a penalty per node (to find a second and third way in)
function penalisedPath(nav, a, b, pen) {
  if (a < 0 || b < 0) return null;
  const n = nav.n;
  const g = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const bx = nav.x[b], bz = nav.z[b];
  const h = i => Math.hypot(nav.x[i] - bx, nav.z[i] - bz);
  const heap = [[h(a), a]];
  g[a] = 0;
  while (heap.length) {
    // small binary heap
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; }
    }
    const i = top[1];
    if (closed[i]) continue;
    if (i === b) { const out = []; for (let k = b; k >= 0; k = came[k]) out.push(k); return out.reverse(); }
    closed[i] = 1;
    const e = nav.edges[i];
    for (let k = 0; k < e.length; k += 2) {
      const j = e[k];
      if (closed[j]) continue;
      const ng = g[i] + e[k + 1] + pen[j];
      if (ng < g[j]) {
        g[j] = ng; came[j] = i;
        heap.push([ng + h(j), j]);
        for (let q = heap.length - 1; q > 0;) { const p = (q - 1) >> 1; if (heap[p][0] <= heap[q][0]) break; [heap[p], heap[q]] = [heap[q], heap[p]]; q = p; }
      }
    }
  }
  return null;
}
// penalise the nodes along (and either side of) a route
function markCorridor(nav, path, pen) {
  const W = nav.W;
  for (let k = Math.floor(path.length * 0.15); k < path.length * 0.9; k++) {
    const i = path[k], ix = Math.floor(nav.x[i] / CELL), iz = Math.floor(nav.z[i] / CELL);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const list = nav.cellNodes[(iz + dz) * W + ix + dx];
      if (list) for (const j of list) pen[j] = Math.max(pen[j], 3);
    }
  }
}
// nothing solid or see-through-blocking between two points?
function clearLine(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  const tr = world.trace(ax, ay, az, dx / d, dy / d, dz / d, d);
  return (!tr.solid || tr.t >= d - 0.3) && !tr.pen.some(([a]) => a < d - 0.3);
}
// how sheltered a spot is: walls / boxes right next to it
function coverAround(world, nav, i) {
  const ix = Math.floor(nav.x[i] / CELL), iz = Math.floor(nav.z[i] / CELL), y = nav.y[i];
  let n = 0;
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2]]) {
    const spans = world.cellSpans(ix + dx, iz + dz);
    if (spans.some(s => s.y0 < y + 1.2 && s.y1 > y + 0.6)) n++;
  }
  return Math.min(n, 4);
}

// ---------- one bot ----------
// cfg: { kind: 'match' | 'dm' | 'range', level: 'easy' | 'normal' | 'hard', behavior: 'still' | 'move' | 'shoot' }
export class BotBrain {
  constructor(server, p, cfg) {
    this.s = server;
    this.p = p;
    this.cfg = cfg;
    this.L = BOT_LEVELS[cfg.level] || BOT_LEVELS.normal;
    this.vel = { x: 0, y: 0, z: 0 };
    this.mem = new Map();
    this.reset();
  }

  get nav() { return this.s.navGrid(); }
  get world() { return this.s.world; }

  // fresh state after (re)spawning or at the start of a round
  reset() {
    Object.assign(this.vel, { x: 0, y: 0, z: 0 });
    this.onGround = true;
    this.path = null; this.pathIdx = 0; this.goal = null; this.goalKey = ''; this.repathAt = 0; this.smoothAt = 0;
    this.target = null; this.lastSeen = -10; this.lastSeenPos = null; this.reactAt = 0; this.lookAt = 0;
    this.errYaw = 0; this.errPitch = 0; this.aimHead = false;
    this.nextShot = 0; this.burstLeft = 0; this.reloadUntil = 0; this.shots = 0; this.fireInacc = 0; this.lastFire = -10;
    this.idleUntil = 0; this.stuckPos = null; this.stuckCount = 0;
    this.spot = null; this.alertYaw = null; this.alertUntil = 0; this.boughtRound = -1; this.buyAt = 0;
    this.p.use = false;
    this.strafe = 0; this.strafeUntil = 0;
    this.mem.clear();
    this.mode = 'objective'; this.cover = null; this.coverUntil = 0; this.holdLook = 0;
    this.plan = null; this.planRound = -1; this.waitUntil = 0; this.hurtAt = -10;
    this.searchUntil = 0; this.searchPos = null;
  }

  ammo() {
    const p = this.p, w = WEAPONS[p.w];
    if (!w) return null;
    const slot = w.slot;
    if (!p.ammo[slot]) p.ammo[slot] = [w.mag, w.reserve];
    return p.ammo[slot];
  }

  enemies() {
    const out = [];
    for (const q of this.s.players.values()) {
      if (q === this.p || !q.alive) continue;
      if (this.isFoe(q)) out.push(q);
    }
    return out;
  }
  isFoe(q) {
    if (q === this.p || this.s.mates(this.p, q)) return false;
    if (this.cfg.kind === 'range' && (q.bot || q.dummy)) return false;   // range bots only fight the players
    if (this.cfg.kind === 'match' && q.team === this.p.team) return false;
    return true;
  }
  // bots on my side (they share what they know)
  mates() {
    const out = [];
    for (const [id, b] of this.s.bots) if (b !== this && b.p.alive && this.s.mates(this.p, b.p) && this.cfg.kind === 'match') out.push(b);
    return out;
  }

  // can I see this player? (cover like boxes blocks sight even though bullets go through it)
  canSee(q) {
    const p = this.p, ex = p.x, ey = eyeOf(p), ez = p.z;
    const h = PLAYER_HEIGHT;
    for (const fy of [0.92, 0.55]) {
      if (clearLine(this.world, ex, ey, ez, q.x, q.y + h * fy, q.z)) return true;
    }
    return false;
  }

  // ---------- what I know about the enemy ----------
  remember(q, x, y, z, now, seen) {
    const m = this.mem.get(q.id);
    const e = m || { id: q.id, vx: 0, vz: 0 };
    if (m && seen && m.seen && now - m.t < 0.6 && now > m.t) {
      e.vx = (x - m.x) / (now - m.t); e.vz = (z - m.z) / (now - m.t);
    } else if (!seen) { e.vx = 0; e.vz = 0; }
    Object.assign(e, { x, y, z, t: now, seen });
    if (!m) this.mem.set(q.id, e);
  }
  // the enemy I should worry about most: recent and close
  threat(now, maxAge = 8) {
    let best = null, bs = -Infinity;
    for (const m of this.mem.values()) {
      const q = this.s.players.get(m.id);
      const age = now - m.t;
      if (!q || !q.alive || age > maxAge) continue;
      const d = Math.hypot(m.x - this.p.x, m.z - this.p.z);
      const sc = -age * 2 - d * 0.15 + (m.seen ? 1 : 0);
      if (sc > bs) { bs = sc; best = m; }
    }
    return best;
  }
  forgetOld(now) {
    for (const [id, m] of this.mem) {
      const q = this.s.players.get(id);
      if (!q || !q.alive || now - m.t > (m.seen ? 14 : 8)) this.mem.delete(id);
    }
  }

  perceive(now) {
    const p = this.p, L = this.L;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best = null, bd = Infinity;
    for (const q of this.enemies()) {
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > L.sight) continue;
      const tracked = this.target === q && now - this.lastSeen < 1.5;
      if (!tracked && d > 4 && (dx * fx + dz * fz) / (d || 1) < L.fov && !(this.alertYaw != null && now < this.alertUntil)) continue;
      if (!this.canSee(q)) continue;
      this.remember(q, q.x, q.y, q.z, now, true);
      // the most dangerous one: close, and looking my way
      const facing = -Math.sin(q.yaw) * -dx + -Math.cos(q.yaw) * -dz;
      const score = d - (facing / (d || 1)) * 4 - (q === this.target ? 3 : 0);
      if (score < bd) { bd = score; best = q; }
    }
    if (best) {
      const d = Math.hypot(best.x - p.x, best.z - p.z);
      if (best !== this.target || now - this.lastSeen > 1.5) {
        // new contact: react faster (and aim better) if I was already looking that way
        const dx = best.x - p.x, dz = best.z - p.z;
        const off = Math.abs(angDiff(p.yaw, Math.atan2(-dx, -dz)));
        const ready = off < 0.3 ? 1 - L.smart * 0.35 : 1;
        this.reactAt = now + L.reaction * rnd(0.8, 1.3) * (d > 25 ? 1.2 : 1) * ready;
        const a = Math.random() * Math.PI * 2, e = L.err * (d > 20 ? 1.2 : 1) * (off < 0.3 ? 1 - L.smart * 0.4 : 1);
        this.errYaw = Math.cos(a) * e; this.errPitch = Math.sin(a) * e * 0.6;
        this.aimHead = Math.random() < L.head;
        this.burstLeft = 0;
      }
      this.target = best;
      this.lastSeen = now;
      this.lastSeenPos = { x: best.x, y: best.y, z: best.z };
    } else if (this.target && (!this.target.alive || now - this.lastSeen > 3)) {
      this.target = null;
    }
    // teammates tell each other what they've seen (after a moment)
    for (const b of this.mates()) {
      for (const m of b.mem.values()) {
        if (!m.seen || now - m.t < L.callout) continue;
        const mine = this.mem.get(m.id);
        if (!mine || mine.t < m.t) {
          const q = this.s.players.get(m.id);
          if (q && q.alive) this.remember(q, m.x, m.y, m.z, m.t, false);
        }
      }
    }
    this.forgetOld(now);
  }

  // footsteps, gunfire and the bomb
  hear(now) {
    const p = this.p, L = this.L;
    for (const n of ears(this.s).sounds) {
      if (n.t <= (this.heardAt || 0) || n.id === p.id) continue;
      const q = this.s.players.get(n.id);
      if (!q || !q.alive || !this.isFoe(q)) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d > n.r * L.hear) continue;
      const m = this.mem.get(q.id);
      if (m && m.seen && now - m.t < 0.5) continue;      // can see them anyway
      // a rough idea of where it came from
      const err = Math.min(3, d * 0.06) * (1.2 - L.smart * 0.5);
      this.remember(q, n.x + rnd(-err, err), n.y, n.z + rnd(-err, err), now, false);
    }
    const S = ears(this.s).sounds;
    if (S.length) this.heardAt = S[S.length - 1].t;
  }

  // somebody shot me: turn that way, and remember roughly where they are
  onHurt(attacker) {
    if (!attacker || attacker === this.p) return;
    const now = performance.now() / 1000;
    this.alertYaw = Math.atan2(-(attacker.x - this.p.x), -(attacker.z - this.p.z));
    this.alertUntil = now + 1.5;
    this.hurtAt = now;
    if (this.isFoe(attacker)) this.remember(attacker, attacker.x, attacker.y, attacker.z, now, false);
  }

  // ---------- the main update, called by the host every tick ----------
  update(dt, now) {
    const p = this.p, s = this.s;
    if (!p.alive) { this.target = null; this.path = null; p.use = false; return; }
    if (this.cfg.kind === 'range' && this.cfg.behavior === 'still') return;
    const shoots = this.cfg.kind !== 'range' || this.cfg.behavior === 'shoot';
    ears(s).update(now);

    if (s.phase === 'freeze') { this.buy(now); this.planRound = -1; this.lookAround(dt, now, this.freezeFace()); return; }
    if (!['live', 'planted', 'end', 'practice', 'dm'].includes(s.phase)) return;

    this.updateWeapon(now);
    if ((this.thinkAt || 0) <= now) {
      this.thinkAt = now + 0.12;
      if (shoots) { this.perceive(now); this.hear(now); }
      this.decide(now, shoots);
    }
    const t = shoots && this.target && now - this.lastSeen < 0.25 ? this.target : null;

    let move = null, speedK = 1;
    if (this.mode === 'retreat' && this.cover) {
      // back off to cover, still shooting if they're in view
      p.use = false;
      move = this.navigate(this.cover, now);
      if (t) { this.aimAndShoot(t, dt, now); speedK = 0.8; } else this.lookAtPoint(this.retreatFrom || this.cover, dt, 1);
    } else if (t) {
      p.use = false;
      this.aimAndShoot(t, dt, now);
      move = this.combatMove(t, now);
      speedK = move ? (this.strafeK || 0.55) : 0;
    } else {
      if (this.alertYaw != null && now < this.alertUntil) this.turnTo(this.alertYaw, 0, dt);
      const goal = this.mode === 'hunt' ? this.huntGoal(now) : this.objective(now);
      if (goal && goal.use) {
        // planting / defusing: stand still and keep looking at the spot
        p.use = true;
        if (goal.look) this.faceSpot(goal.look, dt);
      } else {
        p.use = false;
        if (goal && goal.x != null) move = this.navigate(goal, now);
        if (goal && goal.sneak && move) speedK = 0.5;     // walking is silent
        const alert = this.alertYaw != null && now < this.alertUntil;
        if (!alert) {
          const th = this.threat(now, 6);
          if (goal && goal.lookAt) this.lookAtPoint(goal.lookAt, dt, 0.8);
          else if (th && this.L.smart > 0.3) this.lookAtPoint(th, dt, 0.5 + this.L.smart * 0.5);   // pre-aim where they should be
          else if (move) this.turnTo(Math.atan2(-move[0], -move[1]), 0, dt * 0.7);
          else this.lookAround(dt, now, goal && goal.face);
        }
      }
    }
    this.physics(move, speedK, dt, now);
  }

  // ---------- deciding what to do ----------
  decide(now, shoots) {
    const p = this.p, L = this.L;
    const seeing = this.target && now - this.lastSeen < 0.3;
    const a = this.ammo(), w = WEAPONS[p.w];
    const reloading = now < this.reloadUntil;
    const th = this.threat(now, 6);
    // fall back to cover when hurt, or when caught reloading, if I'm the type to
    const wantsCover = shoots && L.smart > 0.2 && th && Math.hypot(th.x - p.x, th.z - p.z) < 30
      && ((p.hp < L.retreatHp && seeing) || (reloading && (seeing || now - th.t < 2)));
    if (this.mode === 'retreat') {
      const there = this.cover && Math.hypot(this.cover.x - p.x, this.cover.z - p.z) < 0.8;
      if (now > this.coverUntil || (!wantsCover && there && !reloading) || (there && !seeing && !reloading && now - this.hurtAt > 2)) {
        this.mode = 'objective'; this.cover = null;
      } else return;
    }
    if (wantsCover && now > (this.nextCoverAt || 0) && Math.random() < L.smart) {
      const c = this.findCover(th, now);
      this.nextCoverAt = now + 3;
      if (c) { this.mode = 'retreat'; this.cover = c; this.coverUntil = now + 3.5; this.retreatFrom = { x: th.x, y: th.y, z: th.z }; return; }
    }
    if (seeing) { this.mode = 'fight'; return; }
    // lost sight of someone: wait a moment on the angle, then go and look for them
    if (shoots && th && this.cfg.kind !== 'range' && this.shouldHunt(th, now)) { this.mode = 'hunt'; return; }
    this.mode = 'objective';
  }

  shouldHunt(th, now) {
    const p = this.p, s = this.s;
    const d = Math.hypot(th.x - p.x, th.z - p.z);
    if (this.cfg.kind === 'dm') return now - th.t < 6 && d < 45;
    // bomb match: only leave the plan for nearby, recent contacts (or when trading a teammate)
    const b = s.bomb;
    if (p.team === 'def' && b.state === 'planted') return d < 14 && now - th.t < 3;
    if (p.team === 'atk' && b.state === 'planted') return d < 9 && now - th.t < 2.5;
    if (b.state === 'carried' && b.carrier === p.id) return th.seen && d < 8 && now - th.t < 2;
    if (p.team === 'def') return th.seen && d < 12 && now - th.t < 3;      // defenders hold their angles
    return th.seen && d < 16 && now - th.t < 3;
  }

  // where to look for someone I've lost track of: where they were (or where they were heading),
  // walking quietly when I'm close
  huntGoal(now) {
    const p = this.p, th = this.threat(now, 8);
    if (!th) { this.mode = 'objective'; return this.objective(now); }
    const age = Math.min(1.5, now - th.t);
    const gx = th.x + th.vx * age, gz = th.z + th.vz * age;
    const d = Math.hypot(gx - p.x, gz - p.z);
    // just lost them round a corner: hold the angle for a moment first
    if (th.seen && now - th.t < 0.9 * this.L.smart + 0.2 && d > 4) return { lookAt: th };
    if (d < 1.2) { th.t -= 3; return null; }   // nobody here: this clue gets old quickly
    return { x: gx, y: th.y, z: gz, r: 1, sneak: this.L.smart > 0.5 && d < 12, lookAt: th };
  }

  // a nearby place the enemy can't see me from
  findCover(th, now) {
    const p = this.p, nav = this.nav, w = this.world;
    const ex = th.x, ey = th.y + 1.6, ez = th.z;
    const ix = Math.floor(p.x / CELL), iz = Math.floor(p.z / CELL);
    let best = null, bs = Infinity;
    for (let k = 0; k < 70; k++) {
      const dx = Math.round(rnd(-16, 16)), dz = Math.round(rnd(-16, 16));
      const list = nav.cellNodes[(iz + dz) * nav.W + ix + dx];
      if (!list || !list.length) continue;
      const i = list[0];
      if (!nav.reach[i] || Math.abs(nav.y[i] - p.y) > 1.5) continue;
      const x = nav.x[i], y = nav.y[i], z = nav.z[i];
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 1.5 || d > 8.5) continue;
      if (clearLine(w, ex, ey, ez, x, y + 1.5, z) || clearLine(w, ex, ey, ez, x, y + 0.9, z)) continue;
      // prefer close spots that don't take me towards them
      const toward = ((x - p.x) * (ex - p.x) + (z - p.z) * (ez - p.z)) / (d * (Math.hypot(ex - p.x, ez - p.z) || 1));
      const sc = d + toward * 4;
      if (sc < bs) { bs = sc; best = { x, y, z, r: 0.5 }; }
    }
    return best;
  }

  // ---------- movement ----------
  physics(move, speedK, dt, now) {
    const p = this.p, v = this.vel;
    const w = WEAPONS[p.w];
    const wading = p.y < 0.3 && this.world.waterAt(p.x, p.z) > 0;   // canal water slows everyone
    const max = (w ? runSpeed(w, false) : 250 * U) * speedK * (wading ? 0.72 : 1);
    const tx = move ? move[0] * max : 0, tz = move ? move[1] * max : 0;
    const k = Math.min(1, dt * (move ? 8 : 14 + this.L.smart * 10));      // good players stop dead to shoot
    v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    const ox = p.x, oz = p.z;
    this.onGround = this.world.move(p, v, dt, PLAYER_RADIUS, this.onGround, PLAYER_HEIGHT);
    p.moved += Math.hypot(p.x - ox, p.z - oz);
    // stuck? jump, then find another way
    if (move) {
      if (!this.stuckPos) this.stuckPos = { x: p.x, z: p.z, t: now };
      else if (now - this.stuckPos.t > 0.8) {
        if (Math.hypot(p.x - this.stuckPos.x, p.z - this.stuckPos.z) < 0.2) {
          this.stuckCount++;
          if (this.onGround) { v.y = JUMP_V; this.onGround = false; }
          this.repathAt = 0;
          if (this.stuckCount > 3) { this.goal = null; this.stuckCount = 0; this.spot = null; this.cover = null; }
        } else this.stuckCount = 0;
        this.stuckPos = { x: p.x, z: p.z, t: now };
      }
    } else this.stuckPos = null;
  }

  // follow a path to goal {x, y, z}; returns a direction to walk, or null when there
  navigate(goal, now) {
    const p = this.p, nav = this.nav;
    const key = `${Math.round(goal.x * 2)},${Math.round(goal.z * 2)},${Math.round(goal.y || 0)}`;
    if (key !== this.goalKey || !this.path || now > this.repathAt) {
      this.goalKey = key;
      this.path = nav.path(nav.nearest(p.x, p.y, p.z), nav.nearest(goal.x, goal.y || 0, goal.z));
      this.pathIdx = 0;
      this.repathAt = now + 5;
    }
    const dGoal = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (dGoal < (goal.r || 0.5) && Math.abs((goal.y || 0) - p.y) < 1.2) return null;
    if (!this.path) {
      return dGoal > 0.01 ? [(goal.x - p.x) / dGoal, (goal.z - p.z) / dGoal] : null;
    }
    const path = this.path;
    // drop waypoints we've reached, and skip ahead where the way is straight
    while (this.pathIdx < path.length - 1 && Math.hypot(nav.x[path[this.pathIdx]] - p.x, nav.z[path[this.pathIdx]] - p.z) < 0.45) this.pathIdx++;
    if (now > this.smoothAt) {
      this.smoothAt = now + 0.25;
      for (let k = Math.min(path.length - 1, this.pathIdx + 8); k > this.pathIdx; k--) {
        if (this.straight(p.x, p.y, p.z, nav.x[path[k]], nav.y[path[k]], nav.z[path[k]])) { this.pathIdx = k; break; }
      }
    }
    const i = path[this.pathIdx];
    let dx = nav.x[i] - p.x, dz = nav.z[i] - p.z;
    if (this.pathIdx === path.length - 1) { dx = goal.x - p.x; dz = goal.z - p.z; }
    const d = Math.hypot(dx, dz);
    return d > 0.01 ? [dx / d, dz / d] : null;
  }

  straight(ax, ay, az, bx, by, bz) {
    if (Math.abs(by - ay) > 0.45) return false;
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      if (!this.nav.standable(ax + (bx - ax) * k, ay + (by - ay) * k, az + (bz - az) * k)) return false;
    }
    return true;
  }

  // ---------- where to go ----------
  // returns { x, y, z, r, face, lookAt, sneak } to walk to, { use: true, look } to
  // plant / defuse here, or null to stand
  objective(now) {
    const p = this.p;
    if (this.cfg.kind === 'range') return this.wander(now, p.home ? { x: p.home[0], z: p.home[1] } : p, 9);
    if (this.cfg.kind === 'dm') return this.roam(now);
    return p.team === 'atk' ? this.attack(now) : this.defend(now);
  }

  // a fresh plan each round (which way in, who holds what)
  roundPlan(now) {
    const s = this.s;
    if (this.planRound === s.round && this.plan) return this.plan;
    this.planRound = s.round;
    const tac = tactics(this.nav, this.world);
    const team = [...s.players.values()].filter(q => q.team === this.p.team && !q.dummy).sort((a, b) => (a.id < b.id ? -1 : 1));
    const slot = Math.max(0, team.indexOf(this.p));
    this.plan = { tac, slot, start: now };
    if (!tac) return this.plan;
    if (this.p.team === 'atk') {
      // the whole team goes in the same way (picked by the first attacker, shared)
      const lead = [...s.bots.values()].find(b => b !== this && b.p.team === 'atk' && b.planRound === s.round && b.plan && b.plan.route != null);
      this.plan.route = lead ? lead.plan.route : Math.floor(Math.random() * tac.routes.length);
      this.plan.waitUntil = now + rnd(2, 6) * this.L.smart;
    } else {
      // defenders spread out: each holds a different way in
      const r = tac.routes[slot % tac.routes.length];
      const holds = r.holds.length ? r.holds : [{ ...r.entry }];
      const h = holds[Math.floor(Math.random() * Math.min(holds.length, 3))];
      this.plan.hold = { x: h.x, y: h.y, z: h.z, r: 0.5 };
      this.plan.watch = { x: r.entry.x, y: r.entry.y, z: r.entry.z };
    }
    return this.plan;
  }

  attack(now) {
    const p = this.p, s = this.s, b = s.bomb, w = this.world, nav = this.nav;
    const plan = this.roundPlan(now), tac = plan.tac;
    const rect = w.siteRects[0];
    const inSite = (x, z) => rect && x > rect.x0 + 1 && x < rect.x1 - 1 && z > rect.z0 + 1 && z < rect.z1 - 1;
    const pickSpot = (filter) => { const i = nav.randomNode(filter); return { x: nav.x[i], y: nav.y[i], z: nav.z[i], r: 0.6 }; };
    const late = s.phase === 'live' && s.timer < 35;
    if (b.state === 'dropped') {
      // closest attacker goes for the bomb
      if (this.closestTeammateTo(b.x, b.z) === p) return { x: b.x, y: b.y, z: b.z, r: 0.3 };
    }
    if (b.state === 'planted') {
      // guard the bomb from a sheltered spot that can see it
      if (!this.spot || !this.spot.guard) this.spot = this.guardSpot(b, 5, 14) || { ...pickSpot((x, y, z) => Math.hypot(x - b.x, z - b.z) < 7 && Math.hypot(x - b.x, z - b.z) > 2), guard: true };
      const there = Math.hypot(this.spot.x - p.x, this.spot.z - p.z) < 0.8;
      return { ...this.spot, lookAt: { x: b.x, y: b.y, z: b.z } };
    }
    const carrier = b.state === 'carried' && b.carrier === p.id;
    const route = tac && tac.routes[plan.route || 0];
    // group up just before the site, then go in together
    if (route && !late && !plan.goneIn) {
      const st = route.stage;
      const mates = [...s.players.values()].filter(q => q !== p && q.alive && q.team === 'atk' && !q.dummy);
      const atStage = Math.hypot(st.x - p.x, st.z - p.z) < 1.4;
      const matesNear = mates.every(q => Math.hypot(q.x - st.x, q.z - st.z) < 6);
      if (!atStage) return { ...st, r: 0.8, sneak: this.L.smart > 0.7 && Math.hypot(st.x - p.x, st.z - p.z) < 10, lookAt: route.entry };
      if ((matesNear || now > plan.waitUntil + 8) && now > plan.waitUntil) plan.goneIn = now;
      else return { ...st, r: 1.4, lookAt: route.entry };
    }
    if (carrier) {
      // the other attacker goes first; plant once the site looks clear
      const entryFirst = route && plan.goneIn && now - plan.goneIn < 1.5 * this.L.smart && !late;
      if (entryFirst) return { x: p.x, y: p.y, z: p.z, r: 3, lookAt: route.entry };
      if (!this.spot || this.spot.guard) this.spot = this.plantSpot(tac) || pickSpot((x, y, z) => inSite(x, z) && y < 0.5);
      const d = Math.hypot(this.spot.x - p.x, this.spot.z - p.z);
      const th = this.threat(now, 3);
      const danger = th && th.seen && Math.hypot(th.x - p.x, th.z - p.z) < 12 && now - th.t < 2;
      if (d < 0.7 && w.siteAt(p.x, p.z) && (!danger || late)) return { use: true, look: { x: p.x - Math.sin(p.yaw) * 0.6, y: p.y, z: p.z - Math.cos(p.yaw) * 0.6 } };
      return this.spot;
    }
    // escort / entry: clear the site, then hold an angle covering the planter
    if (!this.spot || this.spot.guard) {
      const other = route && tac.routes.find(r => r !== route);
      const watch = other ? other.entry : (tac ? { x: tac.cx, y: 0, z: tac.cz } : null);
      this.spot = (other && other.holds[0] && { x: other.holds[0].x, y: other.holds[0].y, z: other.holds[0].z, r: 0.6, watch }) || pickSpot((x, y, z) => inSite(x, z));
      if (!this.spot.watch) this.spot.watch = watch;
    }
    const there = Math.hypot(this.spot.x - p.x, this.spot.z - p.z) < 1;
    return { ...this.spot, lookAt: there && this.spot.watch ? this.spot.watch : null };
  }

  defend(now) {
    const p = this.p, s = this.s, b = s.bomb, nav = this.nav;
    const plan = this.roundPlan(now);
    const pickSpot = (filter) => { const i = nav.randomNode(filter); return { x: nav.x[i], y: nav.y[i], z: nav.z[i], r: 0.6 }; };
    if (b.state === 'planted') {
      const need = (p.kit ? RULES.defuseKitTime : RULES.defuseTime) + 0.3;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      // not enough time to defuse: save yourself
      const travel = d / ((WEAPONS[p.w] ? runSpeed(WEAPONS[p.w], false) : 6) * 0.9);
      if (this.L.smart > 0.4 && b.timer < need + travel * 0.6 - 0.2 && !(b.user === p.id && b.timer > need - b.prog)) {
        const sp = this.world.spawns.def[0];
        return sp ? { x: sp.x, y: 0, z: sp.z, r: 2 } : null;
      }
      const defuser = this.closestTeammateTo(b.x, b.z) === p;
      const th = this.threat(now, 4);
      const hurry = b.timer < need + 5;
      const contested = th && Math.hypot(th.x - b.x, th.z - b.z) < 14 && now - th.t < 3;
      if (defuser) {
        if (d < 1.3 && Math.abs(b.y - p.y) < 1.5) {
          // keep going if it's nearly done, or there's no time to deal with them first
          if (!contested || hurry || b.prog > (p.kit ? 2.5 : 6)) return { use: true, look: { x: b.x, y: b.y, z: b.z } };
        }
        if (contested && !hurry && this.L.smart > 0.3) {
          // check the angles near the bomb before committing to the defuse
          return { x: b.x, y: b.y, z: b.z, r: 4, sneak: true, lookAt: th };
        }
        return { x: b.x, y: b.y, z: b.z, r: 0.9 };
      }
      if (!this.spot || !this.spot.guard) this.spot = { ...(this.guardSpot(b, 3, 9) || pickSpot((x, y, z) => Math.hypot(x - b.x, z - b.z) < 6)), guard: true };
      return { ...this.spot, lookAt: th || null };
    }
    // hold my angle on the site
    if (plan.hold) {
      const there = Math.hypot(plan.hold.x - p.x, plan.hold.z - p.z) < 0.8;
      // shift a little after a fight, so they don't know exactly where I am
      if (there && now - (this.lastFire || -10) < 1 && this.L.smart > 0.6 && Math.random() < 0.02) {
        const i = nav.randomNode((x, y, z) => Math.hypot(x - p.x, z - p.z) < 3 && Math.hypot(x - p.x, z - p.z) > 1.2);
        plan.hold = { x: nav.x[i], y: nav.y[i], z: nav.z[i], r: 0.5 };
      }
      const th = this.threat(now, 5);
      const heard = th && Math.hypot(th.x - p.x, th.z - p.z) < 30 ? th : null;
      return { ...plan.hold, lookAt: there ? heard || { x: plan.watch.x, y: plan.watch.y + 0.1, z: plan.watch.z } : null };
    }
    const rect = this.world.siteRects[0];
    if (!this.spot) this.spot = pickSpot((x, y, z) => rect && Math.hypot(x - (rect.x0 + rect.x1) / 2, z - (rect.z0 + rect.z1) / 2) < 14);
    const atk = this.world.spawns.atk[0];
    return { ...this.spot, face: atk ? Math.atan2(-(atk.x - p.x), -(atk.z - p.z)) : null };
  }

  // somewhere to watch the bomb from: can see it, sheltered, the right distance away
  guardSpot(b, near, far) {
    const nav = this.nav, w = this.world;
    let best = null, bs = -Infinity;
    for (let k = 0; k < 60; k++) {
      const i = nav.randomNode((x, y, z) => { const d = Math.hypot(x - b.x, z - b.z); return d > near && d < far; }, 60);
      const x = nav.x[i], y = nav.y[i], z = nav.z[i];
      const dd = Math.hypot(x - b.x, z - b.z);
      if (dd <= near || dd >= far || Math.abs(y - b.y) > 2.5) continue;
      if (!clearLine(w, x, y + 1.0, z, b.x, b.y + 0.3, b.z)) continue;
      const sc = coverAround(w, nav, i) + Math.random() * 0.5 - Math.abs(Math.hypot(x - b.x, z - b.z) - (near + far) / 2) * 0.1;
      if (sc > bs) { bs = sc; best = { x, y, z, r: 0.6, guard: true }; }
    }
    return best;
  }
  // somewhere on the site to plant: near cover, away from the open middle of the entries
  plantSpot(tac) {
    if (!tac) return null;
    const nav = this.nav, w = this.world, r = tac.rect;
    let best = null, bs = -Infinity;
    for (let k = 0; k < 40; k++) {
      const i = nav.randomNode((x, y, z) => x > r.x0 + 1 && x < r.x1 - 1 && z > r.z0 + 1 && z < r.z1 - 1 && y < 0.5, 80);
      if (!w.siteAt(nav.x[i], nav.z[i])) continue;
      const sc = coverAround(w, nav, i) + Math.random();
      if (sc > bs) { bs = sc; best = { x: nav.x[i], y: nav.y[i], z: nav.z[i], r: 0.4 }; }
    }
    return best;
  }

  closestTeammateTo(x, z) {
    let best = null, bd = Infinity;
    for (const q of this.s.players.values()) {
      if (!q.alive || q.team !== this.p.team || !q.bot) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  // deathmatch: head for the fighting (gunfire you heard), otherwise roam the map
  roam(now) {
    const nav = this.nav, p = this.p;
    const th = this.threat(now, 10);
    if (th && this.L.smart > 0.3 && Math.hypot(th.x - p.x, th.z - p.z) > 2 && p.hp >= 35) return { x: th.x, y: th.y, z: th.z, r: 1.5, sneak: this.L.smart > 0.7 && Math.hypot(th.x - p.x, th.z - p.z) < 10, lookAt: th };
    return this.wander(now, null, 0);
  }

  // roam between random spots (around a centre point if given)
  wander(now, centre, radius) {
    const nav = this.nav, p = this.p;
    if (now < this.idleUntil) return null;
    if (!this.goal || Math.hypot(this.goal.x - p.x, this.goal.z - p.z) < 0.7) {
      if (this.goal) { this.idleUntil = now + (this.cfg.kind === 'dm' ? rnd(0, 0.6) : rnd(0.4, 2)); this.goal = null; return null; }
      const i = nav.randomNode(centre ? (x, y, z) => Math.hypot(x - centre.x, z - centre.z) < radius : (x, y, z) => Math.hypot(x - p.x, z - p.z) > 8);
      this.goal = { x: nav.x[i], y: nav.y[i], z: nav.z[i], r: 0.6 };
    }
    return this.goal;
  }

  // during the buy time: face the way we'll be going
  freezeFace() {
    const p = this.p, w = this.world;
    const rect = w && w.siteRects && w.siteRects[0];
    if (!rect || this.cfg.kind !== 'match') return null;
    const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
    return Math.atan2(-(cx - p.x), -(cz - p.z));
  }

  // ---------- looking around ----------
  turnTo(yaw, pitch, dt) {
    const p = this.p, rate = this.L.turn * dt;
    const dy = angDiff(p.yaw, yaw);
    p.yaw += Math.max(-rate, Math.min(rate, dy));
    p.pitch += Math.max(-rate, Math.min(rate, pitch - p.pitch));
  }

  faceSpot(pt, dt) {
    const p = this.p, ey = eyeOf(p);
    const dx = pt.x - p.x, dz = pt.z - p.z, dy = pt.y + 0.15 - ey;
    this.turnTo(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), dt * 2);
  }

  // keep the crosshair at head height on a spot (pre-aiming a corner or a sound)
  lookAtPoint(pt, dt, k = 1) {
    const p = this.p, ey = eyeOf(p);
    const dx = pt.x - p.x, dz = pt.z - p.z, hd = Math.hypot(dx, dz);
    if (hd < 0.3) return;
    const dy = (pt.y || 0) + 1.55 - ey;
    this.turnTo(Math.atan2(-dx, -dz), Math.atan2(dy, hd) * this.L.smart, dt * k);
  }

  lookAround(dt, now, face) {
    if (now > this.lookAt) {
      this.lookAt = now + rnd(1, 2.5);
      const base = face != null ? face : this.p.yaw;
      this.lookYaw = base + rnd(-0.7, 0.7);
    }
    if (this.lookYaw != null) this.turnTo(this.lookYaw, 0, dt * 0.4);
  }

  // ---------- fighting ----------
  combatMove(t, now) {
    const p = this.p, L = this.L, w = WEAPONS[p.w];
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    const ready = now >= this.reactAt && now >= this.nextShot - 0.08 && now >= this.reloadUntil;
    const aimed = Math.abs(this.errYaw) < 0.05;
    // good players stop to shoot (for accuracy) and strafe between bursts
    if (now > this.strafeUntil) {
      this.strafeUntil = now + rnd(0.25, 0.6) * (1.4 - L.smart * 0.6);
      this.strafe = Math.random() < L.stop * (1 - L.smart * 0.5) ? 0 : (Math.random() < 0.5 ? -1 : 1);
      this.strafeK = 0.55 + L.smart * 0.35;
    }
    if (d < 2.5) return null;
    if (L.smart > 0.5 && ready && aimed) return null;                   // counter-strafe: stand still for the shot
    if (!this.strafe) return null;
    const fx = (t.x - p.x) / d, fz = (t.z - p.z) / d;
    let mx = -fz * this.strafe, mz = fx * this.strafe;
    // don't strafe into a wall or off a ledge
    if (!this.nav.standable(p.x + mx * 1.2, p.y, p.z + mz * 1.2)) { this.strafe = -this.strafe; mx = -mx; mz = -mz; }
    // with a pistol against a rifle up close, or a shotgun, close in; snipers keep their distance
    if (w && w.type === 'shotgun' && d > 6) { mx += fx * 0.8; mz += fz * 0.8; }
    if (w && w.type === 'sniper' && d < 10) { mx -= fx * 0.6; mz -= fz * 0.6; }
    const l = Math.hypot(mx, mz) || 1;
    return [mx / l, mz / l];
  }

  aimAndShoot(t, dt, now) {
    const p = this.p, L = this.L;
    // lead a moving target a little
    const m = this.mem.get(t.id), lead = L.smart * 0.06;
    const ax = t.x + (m ? m.vx * lead : 0), ay = t.y + (this.aimHead ? 1.6 : 1.2), az = t.z + (m ? m.vz * lead : 0);
    const ex = p.x, ey = eyeOf(p), ez = p.z;
    const dx = ax - ex, dy = ay - ey, dz = az - ez, hd = Math.hypot(dx, dz), d = Math.hypot(hd, dy);
    // aim error shrinks while we track the target
    const k = Math.exp(-dt / L.settle);
    const floor = L.minErr;
    this.errYaw = this.errYaw * k + (Math.random() - 0.5) * floor * 0.6 * (1 - k) * 4;
    this.errPitch = this.errPitch * k + (Math.random() - 0.5) * floor * 0.4 * (1 - k) * 4;
    const wantYaw = Math.atan2(-dx, -dz) + this.errYaw;
    const wantPitch = Math.atan2(dy, hd) + this.errPitch;
    this.turnTo(wantYaw, wantPitch, dt);
    if (now < this.reactAt) return;
    const w = WEAPONS[p.w];
    if (!w || now < this.reloadUntil || now < this.nextShot) return;
    // only shoot once the aim is roughly on target
    const off = Math.hypot(angDiff(p.yaw, Math.atan2(-dx, -dz)), p.pitch - Math.atan2(dy, hd));
    if (off > Math.max(0.03, 0.45 / Math.max(d, 1)) + Math.abs(this.errYaw) + 0.02) return;
    // good players wait until they've stopped moving (shots on the move go wild)
    const speed = Math.hypot(this.vel.x, this.vel.z), max = runSpeed(w, false);
    if (L.smart > 0.5 && speed > max * ACCURATE_SPEED * 1.4 && d > 6 && w.type !== 'shotgun' && now - this.reactAt < 2) return;
    if (this.mateInTheWay(t, d)) return;
    this.fire(w, now, d);
  }

  mateInTheWay(t, d) {
    const p = this.p, ex = p.x, ey = eyeOf(p), ez = p.z;
    const fx = -Math.sin(p.yaw) * Math.cos(p.pitch), fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * Math.cos(p.pitch);
    for (const q of this.s.players.values()) {
      if (q === p || q === t || !q.alive || !this.s.mates(p, q)) continue;
      const h = rayVsPlayer(ex, ey, ez, fx, fy, fz, q.x, q.y, q.z, q.yaw);
      if (h && h.t < d) return true;
    }
    return false;
  }

  updateWeapon(now) {
    const p = this.p;
    const a = this.ammo();
    if (!a) return;
    const w = WEAPONS[p.w];
    if (this.reloadUntil && now >= this.reloadUntil) {
      this.reloadUntil = 0;
      const take = Math.min(w.mag - a[0], a[1]);
      a[0] += take; a[1] -= take;
    }
    const fighting = this.target && now - this.lastSeen < 1;
    if (!this.reloadUntil && a[0] === 0) {
      const other = p.w === p.inv.primary ? p.inv.secondary : p.inv.primary;
      // empty mid-fight with someone close: drawing the pistol is quicker than reloading
      const close = fighting && Math.hypot(this.target.x - p.x, this.target.z - p.z) < 14;
      const ow = other && WEAPONS[other], oa = ow && p.ammo[ow.slot];
      if (close && other && this.L.smart > 0.75 && w.slot === 'primary' && (!oa || oa[0] > 0)) {
        p.w = other; this.nextShot = now + Math.min(0.6, ow.deploy || 0.6);
      } else if (a[1] > 0) this.reloadUntil = now + w.reload;
      else if (other) { p.w = other; this.nextShot = now + (ow.deploy || 1); }
    }
    // back to the main gun (and reloading it) once it's quiet
    if (!fighting && !this.reloadUntil && p.inv.primary && p.w !== p.inv.primary && p.w !== 'c4') {
      const pw = WEAPONS[p.inv.primary], pa = p.ammo[pw.slot];
      if (!pa || pa[0] + pa[1] > 0) { p.w = p.inv.primary; this.nextShot = now + (pw.deploy || 1); }
    }
    // top up between fights (smart bots wait until nobody is about)
    const quiet = !this.threat(now, 3);
    if (!this.reloadUntil && !fighting && a[0] < w.mag * (quiet ? 0.7 : 0.3) && a[1] > 0 && (quiet || a[0] < w.mag * 0.3)) this.reloadUntil = now + w.reload;
    this.fireInacc *= Math.exp(-0.05 * 3 / w.recover);
    if (now - this.lastFire > w.interval * 1.6) this.shots = Math.max(0, this.shots - 0.5);
  }

  fire(w, now, dist) {
    const p = this.p, L = this.L, a = this.ammo();
    if (!a || a[0] <= 0) return;
    a[0]--;
    this.lastFire = now;
    // pacing: bursts for automatic guns (longer up close, taps far away), taps for the rest
    if (w.auto) {
      if (this.burstLeft <= 0) {
        this.burstLeft = dist < 9 ? w.mag : dist > 30 && L.smart > 0.6 ? Math.round(rnd(1, 3)) : Math.round(rnd(L.burst[0], L.burst[1]));
      }
      this.burstLeft--;
      this.nextShot = now + w.interval + (this.burstLeft <= 0 ? L.pause * (dist > 20 ? 1.5 : 1) : 0);
    } else this.nextShot = now + Math.max(w.interval, L.tap * rnd(0.85, 1.2) * (w.type === 'sniper' ? 0 : 1));
    // recoil the bot doesn't control
    const [ry, rp] = w.auto ? patternAt(w, this.shots) : [0, 0];
    this.shots = Math.min(w.mag, this.shots + 1);
    const ex = p.x, ey = eyeOf(p), ez = p.z;
    const pitch = p.pitch + rp * L.recoil, yaw = p.yaw - ry * L.recoil;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // up = right × forward
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const speed = Math.hypot(this.vel.x, this.vel.z), max = runSpeed(w, false), thr = max * ACCURATE_SPEED;
    const spread = w.stand + w.move * Math.max(0, Math.min(1, (speed - thr) / (max - thr))) + (this.onGround ? 0 : w.air) + this.fireInacc
      + (w.type === 'sniper' ? -w.stand + w.scoped : 0);
    this.fireInacc = Math.min(w.fire * 6 + 0.001, this.fireInacc + w.fire);
    const penM = penMetres(w);
    const hits = [], ends = [];
    for (let i = 0; i < w.pellets; i++) {
      const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
      let dx = fx + rx * Math.cos(ang) * rad + ux * Math.sin(ang) * rad;
      let dy = fy + uy * Math.sin(ang) * rad;
      let dz = fz + rz * Math.cos(ang) * rad + uz * Math.sin(ang) * rad;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const tr = this.world.trace(ex, ey, ez, dx, dy, dz, 300);
      let wallT = tr.t;
      let used = 0;
      for (const [p0, p1] of tr.pen) {
        if (p0 >= wallT) break;
        used += p1 - p0;
        if (used >= penM) { wallT = Math.min(wallT, p1 - (used - penM)); break; }
      }
      let best = null;
      for (const q of this.s.players.values()) {
        if (q === p || !q.alive) continue;
        const h = rayVsPlayer(ex, ey, ez, dx, dy, dz, q.x, q.y, q.z, q.yaw);
        if (h && h.t < wallT && (!best || h.t < best.t)) best = { ...h, id: q.id };
      }
      const t = best ? best.t : wallT;
      const end = [ex + dx * t, ey + dy * t, ez + dz * t].map(v => Math.round(v * 100) / 100);
      if (best) hits.push({ id: best.id, part: best.part, p: end });
      if (ends.length < 3) ends.push(end);
    }
    // the host checks and applies it exactly like a player's shot
    this.s.onShot(p, { w: w.id, o: [ex, ey, ez].map(v => Math.round(v * 100) / 100), e: ends, hits, s: w.silenced ? 1 : 0 });
  }

  // ---------- buying (bomb match) ----------
  buy(now) {
    const p = this.p, s = this.s;
    if (this.cfg.kind !== 'match' || this.boughtRound === s.round) return;
    if (!this.buyAt) this.buyAt = now + rnd(0.5, 2.5);
    if (now < this.buyAt) return;
    this.boughtRound = s.round;
    this.buyAt = 0;
    const atk = p.team === 'atk';
    const has = p.inv.primary;
    const m = () => p.money;
    const armor = () => {
      if (p.armor >= 100 && p.helmet) return;
      if (m() >= 1000 && !(p.armor >= 100)) s.onBuy(p, 'vesthelm');
      else if (m() >= 650 && p.armor < 100) s.onBuy(p, 'vest');
      else if (m() >= 350 && p.armor >= 100 && !p.helmet) s.onBuy(p, 'helmet');
    };
    // team economy: if my teammate can't afford a proper buy either, save together
    const mates = [...s.players.values()].filter(q => q !== p && q.team === p.team && !q.dummy);
    const teamPoor = this.L.smart > 0.5 && s.round > 1 && !has && m() < 3700 && mates.every(q => q.inv.primary || (q.money || 0) < 3700);
    if (!has) {
      const rifle = atk ? 'ak47' : (Math.random() < 0.5 ? 'm4a4' : 'm4a1s');
      const sniper = this.L.smart > 0.6 && Math.random() < 0.15 && m() >= WEAPONS.awp.price + 1000 + 1500;
      if (sniper) { s.onBuy(p, 'awp'); armor(); }
      else if (m() >= WEAPONS[rifle].price + 1000) { s.onBuy(p, rifle); armor(); }
      else if (teamPoor && m() < 2500 && s.round !== RULES.halftimeAfter + 1) armor();         // eco round: armour only, buy next time
      else if (atk && m() >= WEAPONS.galil.price + 650) { s.onBuy(p, 'galil'); armor(); }
      else if (!atk && m() >= WEAPONS.mp9.price + 650 && s.round > 1) { s.onBuy(p, 'mp9'); armor(); }
      else if (m() >= 1250 + 650 && s.round > 1) { s.onBuy(p, atk ? 'mac10' : 'mp9'); armor(); }
      else if (m() >= 650) armor();
    } else armor();
    if (!p.inv.primary && m() >= 700 && p.inv.secondary !== 'deagle' && this.L.smart > 0.5) s.onBuy(p, 'deagle');
    if (!atk && !p.kit && m() >= 400 + (p.inv.primary ? 0 : 1000)) s.onBuy(p, 'kit');
    if (p.inv.primary) p.w = p.inv.primary;
    p.ammo = {};
  }
}
