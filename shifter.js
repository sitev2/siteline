// The shapeshifter: Level 1's monster (the garage). Its brain runs on the host (and the home server), never in a
// client. It has no shape of its own. It hides as a garage prop (an old car in an empty bay, a stack of cones, a
// drain pipe on a pillar) and waits, or walks about as a copy of one of the players; it breaks out when someone
// comes close or turns their back, and then it chases like Level 0's monster does (same speeds, sight and hearing
// per difficulty: BR_LEVELS), using the ramps and stairs to follow people between the floors.
//
// Side rooms: it never goes into one on its own (not wandering, searching or hiding). Only when it is CHASING
// someone does it follow them in, and then a shut door doesn't stop it: it forces the door open.
//
// What the players' screens draw travels in its weapon field:  p.w = 's:<form>:<a>:<b>'
//   s:car:<bay>:<colour>   s:cones:<n>   s:pipe:0          disguised as a prop, waiting
//   s:copy:<player id>:<walk|still>                         walking about as a copy of that player
//   s:true:<posture>:<keepsake>                             itself: tall | lope | low | wide | lump (never the same for long)
//   s:burst:<form>:<a>   s:settle:<form>:<a>                changing out of / into a disguise
//   s:force:0                                               forcing a side room's door
//   s:kill:<victim id>                                      closing round someone it caught
import { PLAYER_RADIUS, PLAYER_HEIGHT, EYE } from './world.js';
import { BR, BR_LEVELS, brLevel } from './brmap.js';
import { GAR, GAR_LEVELS, floorY, floorOf, sideRoomAt } from './garmap.js';

export const SHIFTER = {
  creep: 2.2,        // m/s moving between hiding places (never fast unless it is chasing)
  copyWalk: 2.4,     // m/s as a copy of a player (a little slower than a real one walks: 2.7)
  search: 3.4,       // m/s going to a noise, or searching where you were last seen
  lunge: 1.12,       // × its chasing speed for the last few metres
  reach: 1.15,       // m: it has you this close
  settle: 1.3,       // s to take a shape
  force: 1.5,        // s to force a shut door
  kill: 2.8,         // s: closing round someone
};
const RUN_SPEED = 3.5;
const angTo = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const r2 = v => Math.round(v * 100) / 100;

export class ShifterBrain {
  constructor(server, p) {
    this.s = server; this.p = p;
    const w = this.world = server.world;
    this.plan = w.def.gar;
    const level = brLevel(w.def.level);
    this.lv = BR_LEVELS[level].monster;
    this.gl = GAR_LEVELS[level];
    this.chaseSpeed = BR.sprint * this.lv.speed;
    const nav = this.nav = server.navGrid();
    // which side room (if any) and which door each walking spot is in
    this.roomOf = new Int8Array(nav.n).fill(-1);
    this.doorOf = new Int16Array(nav.n).fill(-1);
    const cellDoor = new Map();
    w.doors.forEach((d, k) => { for (const c of d.cells) cellDoor.set(`${c}:${floorOf((d.y || 0) + 0.1)}`, k); });
    for (let i = 0; i < nav.n; i++) {
      this.roomOf[i] = sideRoomAt(this.plan, nav.x[i], nav.y[i], nav.z[i], 0.05);
      const k = cellDoor.get(`${Math.floor(nav.z[i] / 0.5) * w.w + Math.floor(nav.x[i] / 0.5)}:${floorOf(nav.y[i] + 0.1)}`);
      if (k != null) this.doorOf[i] = k;
    }
    // the cost of a route through spot i: side rooms are out of bounds unless it is chasing (or it is in that
    // room and has to get out); a shut door costs the time to force it (a locked one, the shutter, is a wall)
    this.cost = (i) => {
      const room = this.roomOf[i];
      if (room >= 0 && !this.hunting() && room !== this.myRoom()) return Infinity;
      const d = this.doorOf[i] >= 0 && w.doors[this.doorOf[i]];
      if (d && !d.open) return d.lock || (!this.hunting() && this.myRoom() < 0) ? Infinity : SHIFTER.force * this.chaseSpeed;
      return 0;
    };
    this.vel = { x: 0, y: 0, z: 0 };
    this.onGround = true;
    this.state = 'start';
    this.form = { kind: 'true', a: 'lump' };     // what it looks like now
    this.keep = 'none';                          // a bit of the last thing it copied, still stuck in it
    this.posture = 'lump'; this.postureAt = 0;
    this.track = new Map();
    this.last = null; this.searchPts = [];
    this.thinkAt = 0; this.pauseUntil = 0; this.lastClue = 0;
    this.started = null;
  }

  hunting() { return this.state === 'chase' || this.state === 'pursue'; }
  myRoom() { return sideRoomAt(this.plan, this.p.x, this.p.y, this.p.z, 0.3); }
  humans() { return [...this.s.players.values()].filter(q => !q.bot && !q.dummy && q.alive && !q.escaped); }
  disguised() { return this.state === 'prop' || this.state === 'copy'; }
  sameFloor(q, tol = 1.6) { return Math.abs(q.y - this.p.y) < tol; }
  // can player q see the spot (x, y, z)? (anywhere round them: people look about)
  seenBy(q, x, y, z, range = 40) {
    return Math.hypot(q.x - x, q.z - z) < range && this.world.los(q.x, q.y + EYE, q.z, x, y, z);
  }
  watched(x, y, z, range = 40) { return this.humans().some(q => this.seenBy(q, x, y + 1.1, z, range)); }

  // ---------- every tick ----------
  update(dt, now) {
    this.now = now;
    this.step(dt, now);
    const p = this.p, f = this.form;
    let mode;
    if (this.catching) mode = `kill:${this.catching.id}`;
    else if (this.forcing) mode = 'force:0';
    else if (this.state === 'burst') mode = `burst:${f.kind}:${f.a}`;
    else if (this.state === 'settle') mode = `settle:${f.kind}:${f.a}`;
    else if (f.kind === 'copy') mode = `copy:${f.a}:${Math.hypot(this.vel.x, this.vel.z) > 0.4 ? 'walk' : 'still'}`;
    else if (f.kind !== 'true') mode = `${f.kind}:${f.a}:${f.b || 0}`;
    else mode = `true:${this.posture}:${this.keep}`;
    p.w = `s:${mode}`;
    p.use = this.state === 'chase';
    p.pitch = 0;
  }

  // it never keeps one shape for long: tall and thin to run, low under the ducts and through doors, and so on
  pickPosture(now) {
    const p = this.p, sp = Math.hypot(this.vel.x, this.vel.z);
    const f = floorOf(p.y + 0.3);
    const low = this.plan.ducts.some(d => d.f === f && p.x > d.x0 - 1.2 && p.x < d.x1 + 1.2 && p.z > d.z0 && p.z < d.z1)
      || this.world.doors.some(d => !d.lock && Math.abs((d.y || 0) - p.y) < 1 && Math.hypot(d.cx - p.x, d.cz - p.z) < 1.3);
    let want;
    if (low) want = 'low';
    else if (now < this.postureAt) return;
    else if (this.hunting()) want = this.posture === 'tall' ? (Math.random() < 0.6 ? 'lope' : 'wide') : 'tall';
    else if (sp < 0.3) want = this.posture === 'lump' ? 'wide' : 'lump';
    else want = ['low', 'wide', 'lope', 'tall'].filter(k => k !== this.posture)[Math.floor(Math.random() * 3)];
    if (want !== this.posture) { this.posture = want; this.postureAt = now + (this.hunting() ? 1.1 + Math.random() * 1.4 : 2 + Math.random() * 3); }
  }

  step(dt, now) {
    const p = this.p;
    if (this.started == null) { this.started = now; this.lastClue = now; this.firstHide(now); }
    if (this.catching) { this.vel.x = this.vel.z = 0; if (now >= this.catching.until) { this.catching = null; this.pauseUntil = now + 1.2; this.toRoam(now); } return; }
    if (this.forcing) { this.forceStep(dt, now); return; }
    if (now >= this.thinkAt) { this.thinkAt = now + 0.12; this.think(now); }
    if (this.state === 'prop') { this.vel.x = this.vel.z = 0; return; }
    if (this.state === 'burst' || this.state === 'settle') {
      this.vel.x = this.vel.z = 0;
      if (now >= this.shiftUntil) this.shiftDone(now);
      return;
    }
    if (this.form.kind === 'true') this.pickPosture(now);
    if (now < this.pauseUntil) { this.move(null, 0, dt); return; }

    let speed = SHIFTER.creep, goal = this.goal;
    if (this.state === 'chase' && this.target) {
      const t = this.target, tr = this.track.get(t.id), d = Math.hypot(t.x - p.x, t.z - p.z);
      speed = d < 4 ? this.chaseSpeed * SHIFTER.lunge : this.chaseSpeed;
      goal = { x: t.x, y: t.y, z: t.z };
      if (tr && d > 3) {
        const lead = Math.min(0.8, d / 10), ax = t.x + tr.vx * lead, az = t.z + tr.vz * lead;
        if (this.nav.standable(ax, t.y, az)) goal = { x: ax, y: t.y, z: az };
      }
      if (d < 3 && this.sameFloor(t, 0.9) && this.sees(t) && this.straight(p.x, p.z, t.x, t.z, p.y)) {
        const dir = [(t.x - p.x) / (d || 1), (t.z - p.z) / (d || 1)];
        if (this.doorAhead(now, dir)) { this.move(null, 0, dt); return; }
        this.move(dir, speed, dt); this.tryGrab(now); return;
      }
    } else if (this.state === 'pursue') speed = this.chaseSpeed;
    else if (this.state === 'search') speed = SHIFTER.search;
    else if (this.state === 'copy') { speed = SHIFTER.copyWalk; if (now < this.standUntil) goal = null; }
    const dir = goal ? this.navigate(goal, now) : null;
    if (this.doorAhead(now, dir)) { this.move(null, 0, dt); return; }
    if (!dir) this.arrived(now);
    this.move(dir, speed, dt);
    if (this.form.kind === 'true') this.tryGrab(now);
  }

  // ---------- noises ----------
  // a door, the crank, a splash: go and look, if it is close enough to hear. A disguise stays put (it waits).
  hearNoise(x, z, range, y = this.p.y) {
    const p = this.p;
    if (this.hunting() || this.disguised() || this.state === 'burst' || this.state === 'settle' || this.catching) return;
    if (Math.hypot(x - p.x, z - p.z) + Math.abs(y - p.y) * 2 > range) return;
    if (sideRoomAt(this.plan, x, y, z) >= 0) return;                   // (it doesn't go looking in side rooms)
    this.last = { x, y, z, vx: 0, vz: 0, t: this.now || 0, id: null };
    this.lastClue = this.now || 0;
    this.state = 'search'; this.searchPts = []; this.pauseUntil = 0; this.path = null;
    this.goal = { x: x + (Math.random() - 0.5) * 2, y, z: z + (Math.random() - 0.5) * 2 };
  }

  // ---------- what it notices ----------
  think(now) {
    const p = this.p, awake = now - this.started >= this.lv.wake;
    let seen = null, seenD = Infinity, heard = null, heardD = Infinity;
    for (const q of this.humans()) {
      const d = Math.hypot(q.x - p.x, q.z - p.z), tr = this.track.get(q.id);
      let sp = 0;
      if (tr) {
        const dtt = Math.max(0.05, now - tr.t), vx = (q.x - tr.x) / dtt, vz = (q.z - tr.z) / dtt;
        sp = Math.hypot(vx, vz);
        if (sp < 12) { tr.vx = tr.vx * 0.5 + vx * 0.5; tr.vz = tr.vz * 0.5 + vz * 0.5; }
        tr.x = q.x; tr.z = q.z; tr.t = now; tr.sp = sp;
      } else this.track.set(q.id, { x: q.x, z: q.z, vx: 0, vz: 0, t: now, sp: 0 });
      if (d < seenD && this.sees(q)) { seen = q; seenD = d; }
      // running is loud, and so is wading through a puddle; walking only close by. Another floor muffles it.
      const wet = q.y < 0.3 && this.world.waterAt(q.x, q.z) > 0 && sp > 0.8;
      const dd = d + Math.abs(q.y - p.y) * 2.5;
      const loud = (sp > RUN_SPEED && sp < 12) || wet;
      if ((loud && dd < this.lv.hear) || (sp > 0.4 && dd < this.lv.hearWalk) || dd < 2) { if (dd < heardD) { heard = q; heardD = dd; } }
    }
    const clue = (q) => { const tr = this.track.get(q.id) || { vx: 0, vz: 0 }; this.last = { x: q.x, y: q.y, z: q.z, vx: tr.vx, vz: tr.vz, t: now, id: q.id }; this.lastClue = now; };
    if (this.state === 'burst' || this.state === 'settle') return;
    if (this.state === 'prop') { this.propThink(now, awake); return; }
    if (this.state === 'copy') { if (this.copyThink(now)) return; }
    if (!awake) return;
    if (seen) {
      clue(seen);
      if (this.state !== 'chase') this.s.monsterAlert(p, seen);
      this.state = 'chase'; this.target = seen; this.lostAt = now;
    } else if (this.state === 'chase') {
      if (!this.last) this.toRoam(now);
      else if (now - this.lostAt > this.lv.lose) {
        // lost sight: run on to where they were heading
        const L = this.last, lead = this.lv.lead;
        let gx = L.x + L.vx * lead, gz = L.z + L.vz * lead;
        const i = this.nav.nearest(gx, L.y, gz);
        if (i >= 0) { gx = this.nav.x[i]; gz = this.nav.z[i]; }
        this.state = 'pursue'; this.goal = { x: gx, y: L.y, z: gz }; this.target = null; this.path = null;
      }
    } else if (heard && this.state !== 'toProp' && this.state !== 'toCopy') {
      clue(heard);
      if (sideRoomAt(this.plan, heard.x, heard.y, heard.z) < 0 && (this.state !== 'search' || Math.hypot(heard.x - (this.goal ? this.goal.x : 1e9), heard.z - (this.goal ? this.goal.z : 1e9)) > 3)) {
        this.state = 'search'; this.searchPts = []; this.pauseUntil = 0; this.path = null;
        this.goal = { x: heard.x + (Math.random() - 0.5) * 2, y: heard.y, z: heard.z + (Math.random() - 0.5) * 2 };
      }
    }
    if (this.state === 'chase' && this.target && (!this.target.alive || this.target.escaped)) this.toRoam(now);
    if (this.state === 'search' && now > (this.searchUntil || 0) + 8 && !this.searchPts.length && !this.goal) this.toRoam(now);
    if (this.state === 'roam' && !this.goal && now >= this.pauseUntil) this.decide(now);
  }

  sees(q) {
    const p = this.p, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d > (this.state === 'chase' && this.target === q ? this.lv.chaseSight : this.lv.sight)) return false;
    if (d > 3 && this.form.kind === 'true' && Math.abs(angTo(p.yaw, Math.atan2(-dx, -dz))) > this.lv.fov) return false;
    // (through side-room windows too: the line of sight is traced through the real walls)
    return this.world.los(p.x, p.y + 1.6, p.z, q.x, q.y + EYE - 0.2, q.z) || this.world.los(p.x, p.y + 1.0, p.z, q.x, q.y + 0.9, q.z);
  }

  // ---------- hiding as a prop ----------
  // where it could be a prop: an empty bay (a car), a spot by a pillar (a stack of cones), a pillar (a drain pipe)
  propSpots() {
    const P = this.plan, out = [];
    P.bays.forEach((b, i) => { if (b.car == null) out.push({ kind: 'car', a: i, b: Math.floor(Math.random() * 7), x: b.x, y: floorY(b.f), z: (b.z0 + b.z1) / 2, yaw: b.nose < 0 ? 0 : Math.PI, block: [b.x - 1, b.z0, b.x + 1, b.z1] }); });
    for (const c of P.coneSpots) out.push({ kind: 'cones', a: 3 + Math.floor(Math.random() * 2), x: c.x, y: c.y, z: c.z, yaw: 0 });
    for (const c of P.riserSpots) out.push({ kind: 'pipe', a: 0, x: c.x, y: c.y, z: c.z, yaw: 0, stand: { x: c.x, z: c.z + c.side * 0.45 } });
    return out;
  }

  // the very first thing: it is already something, somewhere a good way from the players' start
  firstHide(now) {
    const st = this.plan.start, spots = this.propSpots().filter(s => Math.hypot(s.x - st.x, s.z - st.z) + Math.abs(s.y - st.y) * 3 > 22);
    const s = spots[Math.floor(Math.random() * spots.length)];
    if (!s) { this.toRoam(now); return; }
    this.takeProp(s, now);
  }

  takeProp(s, now) {
    const p = this.p;
    p.x = s.x; p.y = s.y; p.z = s.z; p.yaw = s.yaw;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.form = { kind: s.kind, a: s.a, b: s.b || 0 };
    this.spot = s;
    this.state = 'prop'; this.goal = null; this.path = null; this.target = null;
    this.propUntil = now + 50 + Math.random() * 50;
    this.backAt = 0;
    if (s.block) this.s.setBlock({ x0: s.block[0], z0: s.block[1], x1: s.block[2], z1: s.block[3], y: s.y, h: GAR.car.h });
  }

  propThink(now, awake) {
    const p = this.p, gl = this.gl;
    let trigger = null, near = Infinity;
    for (const q of this.humans()) {
      if (!this.sameFloor(q)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      near = Math.min(near, d);
      const los = this.world.los(p.x, p.y + 1.0, p.z, q.x, q.y + 1.0, q.z) || this.world.los(p.x, p.y + 1.5, p.z, q.x, q.y + EYE, q.z);
      if (!los) continue;
      // they come close…
      if (d < (awake ? gl.spring : 1.3)) { trigger = q; break; }
      // …or they are near and turn their back on it (for a good second)
      const away = Math.abs(angTo(q.yaw, Math.atan2(-(p.x - q.x), -(p.z - q.z)))) > 2.0;
      if (awake && d < gl.spring + 4.5 && away) {
        if (!this.backAt) this.backAt = now;
        if (now - this.backAt > 1.1) { trigger = q; break; }
      } else if (d < gl.spring + 4.5) this.backAt = 0;
    }
    if (trigger) { this.burst(now, trigger); return; }
    // nobody has come by for a long while: it moves on (when nobody is anywhere near to see it change)
    if (awake && now > this.propUntil && near > 16 && !this.watched(p.x, p.y, p.z, 30)) this.burst(now, null);
  }

  // out of its disguise: at `q` (then it chases them), or quietly (then it goes somewhere else)
  burst(now, q) {
    if (this.spot && this.spot.block) this.s.setBlock(null);
    this.keep = this.form.kind === 'copy' ? 'suit' : this.form.kind;
    this.state = 'burst';
    this.shiftUntil = now + (q ? this.gl.burst : 0.7);
    this.after = q ? { chase: q } : null;
    const st = this.spot && this.spot.stand;          // a pipe on a pillar: it comes off onto the floor beside it
    if (st) { this.p.x = st.x; this.p.z = st.z; }
    this.spot = null;
    if (q) this.s.monsterAlert(this.p, q);
  }

  shiftDone(now) {
    if (this.state === 'burst') {
      this.form = { kind: 'true', a: 'tall' }; this.posture = 'tall'; this.postureAt = now + 1;
      const q = this.after && this.after.chase;
      if (q && q.alive && !q.escaped) { this.state = 'chase'; this.target = q; this.lostAt = now; this.last = { x: q.x, y: q.y, z: q.z, vx: 0, vz: 0, t: now, id: q.id }; this.path = null; }
      else this.toRoam(now);
    } else {
      // it has settled into its new shape
      const t = this.settleTo;
      this.settleTo = null;
      if (t.kind === 'copy') { this.form = { kind: 'copy', a: t.a }; this.state = 'copy'; this.copyUntil = now + 70 + Math.random() * 50; this.standUntil = now + 2; this.goal = null; }
      else this.takeProp(t, now);
    }
  }

  toRoam(now) { this.state = 'roam'; this.target = null; this.goal = null; this.path = null; if (this.form.kind !== 'true') this.form = { kind: 'true', a: 'lump' }; }

  // nothing to go on: wait somewhere as a prop (more often on harder levels), walk about as a copy of someone
  // (with two or more players), or prowl
  decide(now) {
    const hs = this.humans(), p = this.p;
    if (!hs.length) return;
    const roll = Math.random();
    if (roll < this.gl.ambush) {
      // a hiding place 9–32 m from someone, on their floor if it can, that nobody can see right now
      const t = hs[Math.floor(Math.random() * hs.length)];
      const spots = this.propSpots().map(s => ({ s, d: Math.hypot(s.x - t.x, s.z - t.z) + Math.abs(s.y - t.y) * 4 }))
        .filter(o => o.d > 9 && o.d < 32).sort(() => Math.random() - 0.5).slice(0, 14);
      const o = spots.find(c => !this.watched(c.s.x, c.s.y, c.s.z)) || spots[0];
      if (o) { this.state = 'toProp'; this.propGoal = o.s; const g = o.s.stand || o.s; this.goal = { x: g.x, y: o.s.y, z: g.z }; this.path = null; return; }
    } else if (hs.length >= 2 && roll < this.gl.ambush + 0.22) {
      // a copy of A, to be met by B: A must be well away from B
      const B = hs[Math.floor(Math.random() * hs.length)];
      const A = hs.filter(q => q !== B && Math.hypot(q.x - B.x, q.z - B.z) + Math.abs(q.y - B.y) * 4 > 14 && !this.seenBy(B, q.x, q.y + 1.2, q.z))[0];
      const i = A ? this.nav.randomNode((x, y, z, j) => this.roomOf[j] < 0 && Math.abs(y - B.y) < 0.3 && Math.hypot(x - B.x, z - B.z) > 13 && Math.hypot(x - B.x, z - B.z) < 24 && !this.watched(x, y, z), 160) : -1;
      if (A && i >= 0 && this.roomOf[i] < 0) {
        this.state = 'toCopy'; this.copyOf = A.id; this.copyFor = B.id;
        this.goal = { x: this.nav.x[i], y: this.nav.y[i], z: this.nav.z[i] }; this.path = null;
        return;
      }
    }
    this.goal = this.wanderGoal(now);
    if (!this.goal) this.pauseUntil = now + 1;
  }

  wanderGoal(now) {
    const hs = this.humans(), nav = this.nav, p = this.p;
    const bored = Math.min(1, (now - this.lastClue) / 60);
    const q = hs.length && Math.random() < 0.45 + bored * 0.4 ? hs[Math.floor(Math.random() * hs.length)] : null;
    const r = 24 - bored * 12;
    const i = nav.randomNode((x, y, z, j) => this.roomOf[j] < 0 && (!q || (Math.abs(y - q.y) < 0.5 && Math.hypot(x - q.x, z - q.z) < r)) && Math.hypot(x - p.x, z - p.z) > 8, 300);
    return i >= 0 && this.roomOf[i] < 0 ? { x: nav.x[i], y: nav.y[i], z: nav.z[i] } : null;
  }

  // ---------- walking about as a copy of a player ----------
  // true: nothing else to think about this time
  copyThink(now) {
    const p = this.p, hs = this.humans(), A = this.s.players.get(this.form.a);
    // the one it copies is gone: so is the copy
    if (!A || !A.alive || A.escaped || hs.length < 2) { this.melt(now); return true; }
    for (const q of hs) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const sees = this.sameFloor(q, 2.5) && this.seenBy(q, p.x, p.y + 1.2, p.z, 45);
      // someone comes close: it breaks out at them
      if (sees && this.sameFloor(q) && d < this.gl.spring * 1.1) { this.burst(now, q); return true; }
      // never in view of someone who can also see the real one (and never in the real one's own view):
      // close, it breaks out; further off, it is gone before they are sure what they saw
      if (sees && (q === A || this.seenBy(q, A.x, A.y + 1.2, A.z, 45))) { if (d < 8) this.burst(now, q); else this.melt(now); return true; }
    }
    if (now > this.copyUntil && !this.watched(p.x, p.y, p.z)) { this.melt(now); return true; }
    // wandering, or standing still: now and then a few steps towards somebody
    if (!this.goal && now >= this.standUntil) {
      const B = this.s.players.get(this.copyFor), t = B && B.alive ? B : hs.find(q => q !== A);
      const i = t ? this.nav.randomNode((x, y, z, j) => this.roomOf[j] < 0 && Math.abs(y - p.y) < 0.3 && Math.hypot(x - p.x, z - p.z) < 9 && Math.hypot(x - p.x, z - p.z) > 3
        && Math.hypot(x - t.x, z - t.z) < Math.hypot(p.x - t.x, p.z - t.z) + 2, 80) : -1;
      if (i >= 0 && this.roomOf[i] < 0 && Math.hypot(this.nav.x[i] - p.x, this.nav.z[i] - p.z) < 10) { this.goal = { x: this.nav.x[i], y: this.nav.y[i], z: this.nav.z[i] }; this.path = null; }
      else this.standUntil = now + 2;
    }
    return true;
  }

  // the copy comes apart where it stands, and it slinks off
  melt(now) { this.burst(now, null); }

  // ---------- getting about ----------
  arrived(now) {
    const p = this.p;
    if (this.state === 'toProp') {
      const s = this.propGoal;
      this.propGoal = null;
      // (not while someone is looking, or standing where the car would be)
      if (!s || this.watched(p.x, p.y, p.z, 26) || this.humans().some(q => Math.abs(q.y - s.y) < 1.5 && Math.hypot(q.x - s.x, q.z - s.z) < 5)) { this.toRoam(now); this.pauseUntil = now + 0.5; return; }
      this.state = 'settle'; this.settleTo = s; this.shiftUntil = now + SHIFTER.settle;
      p.x = s.x; p.z = s.z; p.yaw = s.yaw;
      this.form = { kind: s.kind, a: s.a, b: s.b || 0 };
    } else if (this.state === 'toCopy') {
      const A = this.s.players.get(this.copyOf);
      if (!A || !A.alive || A.escaped || this.watched(p.x, p.y, p.z)) { this.toRoam(now); return; }
      this.state = 'settle'; this.settleTo = { kind: 'copy', a: A.id }; this.shiftUntil = now + SHIFTER.settle;
      this.form = { kind: 'copy', a: A.id };
    } else if (this.state === 'copy') { this.goal = null; this.standUntil = now + 3 + Math.random() * 7; }
    else if (this.state === 'pursue') this.startSearch(now);
    else if (this.state === 'search') {
      this.pauseUntil = now + 0.6 + Math.random() * 0.9;
      this.goal = this.searchPts.shift() || null;
      if (!this.goal) this.toRoam(now);
    } else if (this.state === 'roam') this.goal = null;
  }

  // look round the last clue, the way they were going first (never in a side room)
  startSearch(now) {
    const L = this.last, nav = this.nav;
    this.state = 'search'; this.searchPts = []; this.path = null;
    if (!L) { this.toRoam(now); return; }
    const sp = Math.hypot(L.vx, L.vz), fx = sp > 0.5 ? L.vx / sp : 0, fz = sp > 0.5 ? L.vz / sp : 0, pts = [];
    for (let k = 0; k < 40 && pts.length < 12; k++) {
      const i = nav.randomNode((x, y, z, j) => this.roomOf[j] < 0 && Math.abs(y - L.y) < 0.6 && Math.hypot(x - L.x, z - L.z) < 12 && Math.hypot(x - L.x, z - L.z) > 2.5, 60);
      if (i < 0 || this.roomOf[i] >= 0) continue;
      const x = nav.x[i], z = nav.z[i], d = Math.hypot(x - L.x, z - L.z);
      if (d > 12) continue;
      pts.push({ x, y: nav.y[i], z, score: ((x - L.x) * fx + (z - L.z) * fz) / (d || 1) * 2 + Math.random() });
    }
    pts.sort((a, b) => b.score - a.score);
    this.searchPts = pts.slice(0, this.lv.search);
    this.searchUntil = now + 22;
    this.goal = this.searchPts.shift() || null;
    if (!this.goal) this.toRoam(now);
  }

  // a shut door right in front of it. Only when it is chasing (or has to get back out of a room): it forces it.
  doorAhead(now, dir) {
    const p = this.p, w = this.world;
    if (!dir || (!this.hunting() && this.myRoom() < 0)) return false;
    for (let i = 0; i < w.doors.length; i++) {
      const d = w.doors[i];
      if (d.open || d.lock || Math.abs((d.y || 0) - p.y) > 1) continue;
      const dx = d.cx - p.x, dz = d.cz - p.z, dist = Math.hypot(dx, dz);
      if (dist > 1.2 || (dx * dir[0] + dz * dir[1]) / (dist || 1) < 0.3) continue;
      this.forcing = { i, until: now + SHIFTER.force, next: now + 0.2 };
      this.vel.x = this.vel.z = 0;
      return true;
    }
    return false;
  }

  forceStep(dt, now) {
    const p = this.p, k = this.forcing, d = this.world.doors[k.i];
    if (!d || d.open) { this.forcing = null; this.path = null; return; }
    p.yaw += angTo(p.yaw, Math.atan2(-(d.cx - p.x), -(d.cz - p.z))) * Math.min(1, dt * 8);
    this.move(null, 0, dt);
    if (now >= k.next) { k.next = now + 0.5; this.s.broadcast({ t: 'doorKick', i: k.i, swing: -(Math.sign((p.x - d.cx) * d.nx + (p.z - d.cz) * d.nz) || 1) }); }
    if (now >= k.until) { this.forcing = null; this.path = null; this.s.forceDoor(k.i, p); }
  }

  tryGrab(now) {
    const p = this.p;
    if (this.state === 'toProp' || this.state === 'toCopy') return;
    for (const q of this.humans()) {
      if (Math.hypot(q.x - p.x, q.z - p.z) < SHIFTER.reach && Math.abs(q.y - p.y) < 1.2 && this.world.los(p.x, p.y + 1.2, p.z, q.x, q.y + 1.2, q.z)) {
        p.yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));
        this.s.monsterKill(p, q);
        return;
      }
    }
  }

  // the host has killed q: it closes round them (the players' screens play it), then moves on
  startCatch(q) {
    this.catching = { id: q.id, until: (this.now || 0) + SHIFTER.kill };
    this.keep = 'suit';
    this.state = 'roam'; this.target = null; this.goal = null; this.path = null;
    this.vel.x = this.vel.z = 0;
  }

  move(dir, speed, dt) {
    const p = this.p, v = this.vel;
    const tx = dir ? dir[0] * speed : 0, tz = dir ? dir[1] * speed : 0, k = Math.min(1, dt * (dir ? 6 : 10));
    v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    const ox = p.x, oz = p.z;
    this.onGround = this.world.move(p, v, dt, PLAYER_RADIUS, this.onGround, PLAYER_HEIGHT);
    const moved = Math.hypot(p.x - ox, p.z - oz);
    if (moved > 0.002) p.yaw += angTo(p.yaw, Math.atan2(-(p.x - ox), -(p.z - oz))) * Math.min(1, dt * 8);
    else if (this.target) p.yaw += angTo(p.yaw, Math.atan2(-(this.target.x - p.x), -(this.target.z - p.z))) * Math.min(1, dt * 6);
    p.moved = (p.moved || 0) + moved;
    if (dir) {
      this.stuckT = moved < speed * dt * 0.2 ? (this.stuckT || 0) + dt : 0;
      if (this.stuckT > 0.7) { this.stuckT = 0; this.path = null; if (this.state === 'roam' || this.state === 'copy') this.goal = null; }
    }
  }

  // follow the walking grid (both floors, by the ramps and stairs) to the goal; a direction, or null when there
  navigate(goal, now) {
    const p = this.p, nav = this.nav;
    if (Math.hypot(goal.x - p.x, goal.z - p.z) < 0.6 && Math.abs((goal.y || 0) - p.y) < 1) return null;
    const key = `${Math.round(goal.x)},${Math.round(goal.y || 0)},${Math.round(goal.z)}`;
    if (!this.path || key !== this.pathKey || now > this.repathAt) {
      this.pathKey = key;
      this.path = nav.path(nav.nearest(p.x, p.y, p.z), nav.nearest(goal.x, goal.y || 0, goal.z), Math.round(nav.n * 1.2), this.cost);
      this.pathIdx = 0;
      this.repathAt = now + (this.state === 'chase' ? 0.5 : this.state === 'pursue' ? 1 : 4);
      if (!this.path) {
        // no way there (a side room it may not go into, the lift behind its shutter): give that up
        if (this.state === 'chase') { this.state = 'search'; this.searchPts = []; this.target = null; }
        this.goal = null; return null;
      }
    }
    const path = this.path;
    while (this.pathIdx < path.length - 1 && Math.hypot(nav.x[path[this.pathIdx]] - p.x, nav.z[path[this.pathIdx]] - p.z) < 0.5) this.pathIdx++;
    for (let k = Math.min(path.length - 1, this.pathIdx + 6); k > this.pathIdx; k--) {
      const j = path[k];
      if (Math.abs(nav.y[j] - p.y) < 0.2 && this.straight(p.x, p.z, nav.x[j], nav.z[j], p.y)) { this.pathIdx = k; break; }
    }
    const i = path[this.pathIdx];
    let dx = nav.x[i] - p.x, dz = nav.z[i] - p.z;
    if (this.pathIdx === path.length - 1) { dx = goal.x - p.x; dz = goal.z - p.z; }
    const d = Math.hypot(dx, dz);
    return d > 0.01 ? [dx / d, dz / d] : null;
  }

  // a straight walk on the level from a to b? (nothing in the way, no door, and no side room it may not enter)
  straight(ax, az, bx, bz, y) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25), w = this.world, hunting = this.hunting();
    for (let i = 1; i <= n; i++) {
      const k = i / n, x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      if (!this.nav.standable(x, y, z)) return false;
      if (!hunting && sideRoomAt(this.plan, x, y, z, 0.05) >= 0 && this.myRoom() < 0) return false;
      if (w.cellSpans(Math.floor(x / 0.5), Math.floor(z / 0.5)).some(sp => sp.m === '_door' && sp.y0 < y + 1 && sp.y1 > y)) return false;
    }
    return true;
  }
}

export { r2 as _r2 };
