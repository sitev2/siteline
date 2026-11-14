// The Backrooms monster's brain. Runs on the host (and the home server), never in a client.
// It wanders the maze, listens for running footsteps, chases anyone it sees and kills on contact.
// Walking is quiet; sprinting (Shift / the run button) is heard 11–16 m away (by difficulty), through walls.
import { PLAYER_RADIUS, PLAYER_HEIGHT, EYE } from './world.js';
import { BR, BR_LEVELS, brLevel } from './brmap.js';

// The fixed numbers. Everything that changes with the difficulty (how fast it chases: 5 / 10 / 15 %
// faster than your sprint, how far it sees and hears, how quickly it loses you) is in BR_LEVELS in brmap.js.
export const MONSTER = {
  wander: 2.0,       // m/s walking around
  stalk: 2.5,        // m/s creeping up behind someone who hasn't seen it
  search: 3.4,       // m/s going to a noise, or searching where you were last seen
  lunge: 1.12,       // × its chasing speed for the last few metres
  reach: 1.15,       // m: grabs you this close
  height: 2.8,       // m: how tall it is (for its eyes)
};
const RUN_SPEED = 3.5;   // m/s: faster than this is sprinting (loud); walking is BR.walk
export const STARE = 1.0;           // s: it has just seen you: its head snaps onto you and it stares this long before it chases (owner's design)
const STARE_AGAIN = 8;               // s without a chase before it stares again (so losing it for a moment doesn't buy another second)
export const KICK_TIME = 2;         // s: kicking a shut door in (owner's choice), one kick every 0.75 s

const angTo = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// What it does, in order of what matters most:
//   chase   — it can see you: first it stops dead, its head snaps onto you and it stares for a second (STARE);
//             then straight for you, aiming a little ahead of where you are running
//   stalk   — it sees you far away and you are looking the other way: it creeps closer quietly,
//             then charges when you turn round or it is close enough
//   pursue  — it just lost sight of you: it runs to where you were heading
//   search  — it looks through the rooms around the last place it saw or heard you, stopping to listen
//   wander  — nothing to go on: it roams, drifting towards where people are, and now and then stands
//             dead still to listen
export class MonsterBrain {
  constructor(server, p) {
    this.s = server;
    this.p = p;
    this.world = server.world;
    this.lv = BR_LEVELS[brLevel(this.world.def.level)].monster;      // the difficulty
    this.chaseSpeed = BR.sprint * this.lv.speed;
    this.nav = server.navGrid();
    // It can't open doors: the walking-grid spots in each doorway, so its routes go round the shut ones
    const w = this.world, nav = this.nav;
    this.doorOf = new Int16Array(nav.n).fill(-1);
    w.doors.forEach((d, k) => {
      const cells = new Set(d.cells);
      for (let i = 0; i < nav.n; i++) if (cells.has(Math.floor(nav.z[i] / 0.5) * w.w + Math.floor(nav.x[i] / 0.5))) this.doorOf[i] = k;
    });
    // a shut door on a route costs what kicking it in takes (KICK_TIME of running)
    // (a locked team door, red / heavy / switches, it can't kick in at all: a wall to it until the players open it)
    this.doorCost = (i) => { const d = this.doorOf[i] >= 0 && w.doors[this.doorOf[i]]; return d && !d.open ? (d.lock ? Infinity : KICK_TIME * this.chaseSpeed) : 0; };
    // the maze is areas shut off from each other by gates until the players open them (brmap.js step 5b)
    this.gates = ['heavy', 'red', 'twin'].map(l => w.doors.find(d => d.lock === l) || null);
    this.vel = { x: 0, y: 0, z: 0 };
    this.onGround = true;
    this.state = 'wait';
    this.started = null;
    this.goal = null;
    this.path = null;
    this.track = new Map();       // player id → { x, z, vx, vz, t } (where they are and how fast they move)
    this.last = null;             // last sighting or sound: { x, z, vx, vz, t, id }
    this.searchPts = [];
    this.thinkAt = 0;
    this.pauseUntil = 0;
    this.listenAt = 0;
    this.lastClue = 0;
  }

  reset() { this.state = 'wait'; this.path = null; }

  // Which shut-off part of the maze a spot is in: 0 the start area, 1 the key's, 2 everything past the locked door
  // (the big pit room has no door), 3 the exit room. It can't get from one to another while the gate between is shut.
  region(x, z) {
    const plan = this.world.def.br, zone = plan && plan.zone;
    if (!zone) return 0;
    const N = zone.length, rx = Math.max(0, Math.min(N - 1, Math.floor((x - BR.border) / BR.cell))), rz = Math.max(0, Math.min(N - 1, Math.floor((z - BR.border) / BR.cell)));
    if (rx === plan.exit.x && rz === plan.exit.z) return 3;
    const zn = zone[rz][rx];
    return zn === 0 ? 0 : zn === 1 ? 1 : 2;
  }
  canReach(x, z) {
    const a = this.region(this.p.x, this.p.z), b = this.region(x, z);
    for (let k = Math.min(a, b); k < Math.max(a, b); k++) { const g = this.gates[k]; if (g && !g.open) return false; }
    return true;
  }

  humans() { return [...this.s.players.values()].filter(q => !q.bot && !q.dummy && q.alive && !q.escaped); }

  update(dt, now) {
    this.lastNow = now;
    this.step(dt, now);
    // what the players' screens should animate (models.js animateTall): idle, listen, walk, stalk, search, run,
    // notice (the stare), peek:±1, kick, freeze, and catching someone: seize / hoist / slam / slamWall / hang / drag
    const p = this.p, sp = Math.hypot(this.vel.x, this.vel.z), c = this.catching;
    const staring = now < (this.noticeUntil || 0);
    if (this.state === 'chase' || this.state === 'pursue') this.chasedAt = now;
    const mode = c ? c.mode : this.kicking ? 'kick'
      : this.hanging ? 'hang'
        : staring ? 'notice'
          : this.state === 'peek' ? `peek:${this.peekSide || 1}`
            : this.state === 'stalk' && this.frozen ? 'freeze'
              : now < this.pauseUntil ? 'listen'
                : sp < 0.3 ? 'idle'
                  : this.dragging ? 'drag'
                    : this.state === 'chase' || this.state === 'pursue' ? 'run'
                      : this.state === 'stalk' || this.state === 'peekGo' ? 'stalk'
                        : this.state === 'search' || this.state === 'retreat' ? 'search' : 'walk';
    // 'm:<mode>:<n>[:<id of the body it is holding>]'   (n: the peek side, or which key frame of a slam)
    const held = c ? c.id : this.dragging ? this.dragging.id : '';
    p.w = `m:${mode}${mode.startsWith('peek') ? '' : `:${c ? c.k : 1}`}${held ? `:${held}` : ''}`;
    // where its head points: at whoever it is staring at or chasing, as an angle from straight ahead
    // (it has no use for looking up and down, so this travels in its pitch)
    const t = this.target;
    p.pitch = t && t.alive && (staring || this.state === 'chase') && !c ? angTo(p.yaw, Math.atan2(-(t.x - p.x), -(t.z - p.z))) : 0;
  }

  step(dt, now) {
    const p = this.p;
    const wake = this.lv.wake;
    if (this.started == null) { this.started = now; this.listenAt = now + wake + 15; this.lastClue = now; this.nextPeek = now + wake + 25 + Math.random() * 30; }
    if (now - this.started < wake) { p.use = false; return; }
    if (this.state === 'wait') this.state = 'wander';
    if (this.catching) { this.catchStep(dt, now); return; }
    if (this.kicking) { this.kickStep(dt, now); return; }
    if (this.hanging) {
      // lifting the body up and pinning it to the wall
      p.use = false;
      this.move(null, 0, dt);
      const w = this.dragging && this.dragging.wall;
      if (w) p.yaw += angTo(p.yaw, Math.atan2(w.nx, w.nz)) * Math.min(1, dt * 8);
      if (now >= this.hanging.until) {
        if (this.dragging && w) this.s.broadcast({ t: 'hangBody', id: this.dragging.id, x: w.x, z: w.z, nx: w.nx, nz: w.nz });
        this.dragging = null; this.hanging = null; this.state = 'wander'; this.goal = null;
      }
      return;
    }
    if (now >= this.thinkAt) { this.thinkAt = now + 0.12; this.think(now); }
    // it has just seen someone: it stops dead mid-step, only its head turns (update() above), and it stares
    if (now < (this.noticeUntil || 0)) { p.use = false; this.vel.x = this.vel.z = 0; return; }
    if (now < this.pauseUntil) { p.use = false; this.move(null, 0, dt); return; }
    if (this.state === 'peek') { this.peekHold(dt, now); this.move(null, 0, dt); return; }
    // stalking, and they turned round: it stands dead still until they look away
    if (this.state === 'stalk' && this.frozen) { p.use = false; this.vel.x = this.vel.z = 0; return; }

    let speed = MONSTER.wander, goal = this.goal;
    if (this.state === 'chase' && this.target) {
      const t = this.target, tr = this.track.get(t.id);
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      speed = d < 4 ? this.chaseSpeed * MONSTER.lunge : this.chaseSpeed;
      // aim a little ahead of a running target, if that spot is somewhere you can stand
      goal = { x: t.x, y: t.y, z: t.z };
      if (tr && d > 3) {
        const lead = Math.min(0.8, d / 10), ax = t.x + tr.vx * lead, az = t.z + tr.vz * lead;
        if (this.nav.standable(ax, 0, az)) goal = { x: ax, y: 0, z: az };
      }
      // close and in plain view, with nothing in the way: straight at them
      if (d < 3 && this.sees(t) && this.straight(p.x, p.z, t.x, t.z)) {
        const dir = [(t.x - p.x) / d, (t.z - p.z) / d];
        if (this.doors(now, dir)) { this.move(null, 0, dt); return; }
        this.move(dir, speed, dt); this.tryGrab(now); return;
      }
    } else if (this.state === 'stalk' && this.target) {
      speed = MONSTER.stalk;
      goal = { x: this.target.x, y: 0, z: this.target.z };
    } else if (this.state === 'pursue') speed = this.chaseSpeed;
    else if (this.state === 'search' || this.state === 'retreat') speed = MONSTER.search;
    else if (this.state === 'peekGo') speed = MONSTER.stalk;
    else if (this.state === 'hangGo') { speed = MONSTER.wander; goal = this.dragging && this.dragging.wall ? { x: this.dragging.wall.sx, y: 0, z: this.dragging.wall.sz } : null; }
    if (this.dragging) speed = Math.min(speed, MONSTER.wander * 1.1);         // a body is heavy
    const dir = goal ? this.navigate(goal, now) : null;
    if (this.doors(now, dir)) { this.move(null, 0, dt); return; }
    if (!dir) this.arrived(now);
    this.move(dir, speed, dt);
    this.tryGrab(now);
  }

  // a door banged somewhere: go and look if it's close enough to hear
  hearNoise(x, z, range) {
    const p = this.p;
    if (this.state === 'chase' || this.state === 'wait' || Math.hypot(x - p.x, z - p.z) > range) return;
    this.last = { x, z, vx: 0, vz: 0, t: this.thinkAt, id: null };
    this.lastClue = this.thinkAt;
    this.state = 'search'; this.searchPts = []; this.pauseUntil = 0;
    this.goal = { x: x + (Math.random() - 0.5) * 2, y: 0, z: z + (Math.random() - 0.5) * 2 };
  }

  // A shut door right in front of it. It can't open doors (owner's rule): it kicks them in. That takes
  // KICK_TIME (a boom every 0.75 s everyone near hears), then the door falls off its hinges and stays open
  // for good. Its routes weigh that up (doorCost): if going round is quicker, it goes round.
  doors(now, dir) {
    const p = this.p, w = this.world;
    if (!dir) return false;
    for (let i = 0; i < w.doors.length; i++) {
      const d = w.doors[i];
      if (d.kind !== 'way' || d.open || d.lock) continue;
      const dx = d.cx - p.x, dz = d.cz - p.z, dist = Math.hypot(dx, dz);
      if (dist > 1.2 || (dx * dir[0] + dz * dir[1]) / (dist || 1) < 0.3) continue;
      this.kicking = { i, until: now + KICK_TIME, next: now + 0.3 };
      this.vel.x = this.vel.z = 0;
      return true;
    }
    return false;
  }

  kickStep(dt, now) {
    const p = this.p, k = this.kicking, d = this.world.doors[k.i];
    p.use = this.state === 'chase';
    // someone opened it meanwhile: through it goes
    if (!d || d.open) { this.kicking = null; this.path = null; return; }
    p.yaw += angTo(p.yaw, Math.atan2(-(d.cx - p.x), -(d.cz - p.z))) * Math.min(1, dt * 8);
    this.move(null, 0, dt);
    const side = Math.sign((p.x - d.cx) * d.nx + (p.z - d.cz) * d.nz) || 1;
    if (now >= k.next) {
      k.next = now + 0.75; this.s.broadcast({ t: 'doorKick', i: k.i, swing: -side });
    }
    if (now >= k.until) { this.kicking = null; this.path = null; this.s.breakDoor(k.i, p); }
  }

  // reached where it was going
  arrived(now) {
    if (this.state === 'hangGo') { if (this.dragging && this.dragging.wall) this.hanging = { until: now + 1.6 }; else this.state = 'wander'; return; }
    if (this.state === 'peekGo') this.startPeek(now);
    else if (this.state === 'retreat') { this.state = 'wander'; this.goal = null; }
    else if (this.state === 'pursue') this.startSearch(now);
    else if (this.state === 'search') {
      // stop and listen for a moment, then on to the next place to look
      this.pauseUntil = now + 0.6 + Math.random() * 0.9;
      this.goal = this.searchPts.shift() || null;
      if (!this.goal) this.state = 'wander';
    } else if (this.state === 'wander') this.goal = null;
  }

  // look through the rooms around the last clue, the ones in the direction they were going first
  startSearch(now) {
    const L = this.last, nav = this.nav;
    this.state = 'search';
    this.searchPts = [];
    if (!L) { this.state = 'wander'; return; }
    const sp = Math.hypot(L.vx, L.vz), fx = sp > 0.5 ? L.vx / sp : 0, fz = sp > 0.5 ? L.vz / sp : 0;
    const pts = [];
    for (let k = 0; k < 40 && pts.length < 12; k++) {
      const i = nav.randomNode((x, y, z) => y < 0.1 && Math.hypot(x - L.x, z - L.z) < 11 && Math.hypot(x - L.x, z - L.z) > 2.5, 60);
      if (i < 0) continue;
      const x = nav.x[i], z = nav.z[i];
      if (Math.hypot(x - L.x, z - L.z) > 11) continue;        // (randomNode gives any spot if none fits)
      const ahead = ((x - L.x) * fx + (z - L.z) * fz) / (Math.hypot(x - L.x, z - L.z) || 1);
      pts.push({ x, y: 0, z, score: ahead * 2 + Math.random() });
    }
    pts.sort((a, b) => b.score - a.score);
    this.searchPts = pts.slice(0, this.lv.search);
    this.searchUntil = now + 22;
    this.goal = this.searchPts.shift() || null;
    if (!this.goal) this.state = 'wander';
  }

  // what it notices: who it can see, and footsteps it can hear
  think(now) {
    const p = this.p;
    let seen = null, seenD = Infinity, heard = null, heardD = Infinity;
    for (const q of this.humans()) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const tr = this.track.get(q.id);
      let sp = 0;
      if (tr) {
        const dtt = Math.max(0.05, now - tr.t);
        const vx = (q.x - tr.x) / dtt, vz = (q.z - tr.z) / dtt;
        sp = Math.hypot(vx, vz);
        if (sp < 12) { tr.vx = tr.vx * 0.5 + vx * 0.5; tr.vz = tr.vz * 0.5 + vz * 0.5; }
        tr.x = q.x; tr.z = q.z; tr.t = now;
      } else this.track.set(q.id, { x: q.x, z: q.z, vx: 0, vz: 0, t: now });
      if (!this.canReach(q.x, q.z)) continue;                 // the other side of a shut gate: nothing to do about them
      if (d < seenD && this.sees(q)) { seen = q; seenD = d; }
      const loud = sp > RUN_SPEED && sp < 12;
      if ((loud && d < this.lv.hear) || (sp > 0.4 && d < this.lv.hearWalk) || d < 2) { if (d < heardD) { heard = q; heardD = d; } }
    }
    const clue = (q) => { const tr = this.track.get(q.id) || { vx: 0, vz: 0 }; this.last = { x: q.x, z: q.z, vx: tr.vx, vz: tr.vz, t: now, id: q.id }; this.lastClue = now; };
    // stalking one player by peeking round corners: it ignores everything else unless someone gets right up close
    if (this.state === 'peekGo' || this.state === 'peek' || this.state === 'retreat') {
      if (!(seen && seenD < 4.5)) {
        const t = this.stalkTarget;
        if (!t || !t.alive || t.escaped) { this.state = 'wander'; this.goal = null; }
        p.use = false;
        return;
      }
      this.state = 'wander';
    }
    // carrying a body: it lets go of it the moment it sees its next one
    if (this.dragging && (seen || now > this.dragging.until)) this.dropBody(now);
    if (seen && this.ambush === seen.id) { this.ambush = null; this.spot(seen, now); this.state = 'chase'; this.target = seen; this.lostAt = now; }
    const lookingAtMe = seen ? Math.abs(angTo(seen.yaw, Math.atan2(-(p.x - seen.x), -(p.z - seen.z)))) < 0.9 : false;
    // stalking someone and they turn round: it stops dead mid-step (unless they're close, or for longer than 5 s)
    if (seen && this.state === 'stalk' && this.target === seen && lookingAtMe && seenD > 6 && (!this.frozenAt || now - this.frozenAt < 5)) {
      clue(seen);
      if (!this.frozenAt) this.frozenAt = now;
      this.frozen = true;
    } else if (seen) {
      this.frozen = false; this.frozenAt = 0;
      clue(seen);
      // far away and looking the other way: creep up on them; otherwise (or once they turn round) charge
      const canStalk = seenD > 9 && !lookingAtMe && this.state !== 'chase';
      if (canStalk && (this.state === 'stalk' || seenD > 13)) { this.state = 'stalk'; this.target = seen; }
      else {
        if (this.state !== 'chase') this.spot(seen, now);
        this.state = 'chase'; this.target = seen; this.lostAt = now;
      }
    } else if (this.state === 'hangGo') {
      // on its way to pin a body to a wall: nothing else matters
    } else if (this.state === 'chase' || this.state === 'stalk') {
      // lost sight: run on to where they were heading
      // (on easier difficulties it gives up on you sooner and guesses less far ahead)
      if (!this.last) { this.state = 'wander'; this.target = null; this.goal = null; }
      else if (this.state === 'stalk' || now - this.lostAt > this.lv.lose) {
        const L = this.last, lead = this.lv.lead;
        let gx = L.x + L.vx * lead, gz = L.z + L.vz * lead;
        const i = this.nav.nearest(gx, 0, gz);
        if (i >= 0) { gx = this.nav.x[i]; gz = this.nav.z[i]; }
        this.state = 'pursue'; this.goal = { x: gx, y: 0, z: gz }; this.target = null; this.path = null;
      }
    } else if (heard) {
      clue(heard);
      if (this.state !== 'search' || Math.hypot(heard.x - (this.goal ? this.goal.x : 1e9), heard.z - (this.goal ? this.goal.z : 1e9)) > 3) {
        this.state = 'search'; this.searchPts = [];
        this.goal = { x: heard.x + (Math.random() - 0.5) * 2, y: 0, z: heard.z + (Math.random() - 0.5) * 2 };
        this.pauseUntil = 0;
      }
    }
    if (this.state === 'search' && now > (this.searchUntil || 0) + 8 && !this.searchPts.length && !this.goal) this.state = 'wander';
    if ((this.state === 'chase' || this.state === 'stalk') && this.target && (!this.target.alive || this.target.escaped)) { this.state = 'wander'; this.target = null; this.goal = null; }
    if (!seen) { this.frozen = false; this.frozenAt = 0; }
    // now and then, somewhere nobody can see it, it makes a sound to draw someone over: a person's footsteps,
    // or a door opening
    if ((this.state === 'wander' || this.state === 'search') && !this.dragging && now > (this.lureAt || (this.lureAt = now + 30))) {
      this.lureAt = now + 30 + Math.random() * 35;
      const q = this.humans().find(o => { const d = Math.hypot(o.x - p.x, o.z - p.z); return d > 7 && d < 24 && !this.world.los(o.x, o.y + EYE, o.z, p.x, p.y + 1.5, p.z); });
      if (q) this.s.broadcast({ t: 'lure', kind: Math.random() < 0.6 ? 'steps' : 'door', x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: Math.round(p.yaw * 100) / 100 });
    }
    if (this.state === 'wander') {
      // now and then it picks one person and stalks them, peeking round corners at them
      if (now > this.nextPeek && !this.dragging) { this.nextPeek = now + 12; this.planPeek(now); }
      // now and then it stops dead and listens
      if (this.state === 'wander' && now > this.listenAt) { this.listenAt = now + 14 + Math.random() * 14; this.pauseUntil = now + 1.8 + Math.random() * 1.6; }
      if (this.state === 'wander' && !this.goal) this.goal = this.wanderGoal(now);
    }
    p.use = this.state === 'chase';     // clients: screeching, running animation
  }

  // It has just seen q: they hear it, and (unless it was chasing only a moment ago) it stares before it comes
  spot(q, now) {
    this.s.monsterAlert(this.p, q);
    if (now - (this.chasedAt ?? -99) > STARE_AGAIN) this.noticeUntil = now + STARE;
  }

  // ---------- peeking ----------
  // A spot near a corner, 7–16 m from the target, where its body is hidden from them but its head,
  // leaning out about 0.65 m, is in plain view.
  findPeek(t) {
    const w = this.world, nav = this.nav, corners = this.s.corners;
    if (!corners) return null;
    const ex = t.x, ey = t.y + 1.6, ez = t.z;
    const cands = corners.near(t.x, t.z, 16).filter(c => Math.hypot(c.x - t.x, c.z - t.z) > 7).sort(() => Math.random() - 0.5).slice(0, 40);
    for (const c of cands) {
      for (const [sx, sz] of [[-c.qx, -c.qz], [c.qx, -c.qz], [-c.qx, c.qz]]) {
        const mx = c.x + sx * 0.55, mz = c.z + sz * 0.55;
        if (!nav.standable(mx, 0, mz) || w.isPit(mx, mz)) continue;
        if (w.los(ex, ey, ez, mx, 1.4, mz) || w.los(ex, ey, ez, mx, 2.4, mz)) continue;       // all of it hidden
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, lx = Math.cos(a) * 0.65, lz = Math.sin(a) * 0.65;
          const hx = mx + lx, hz = mz + lz;
          if (w.cellSpans(Math.floor(hx / 0.5), Math.floor(hz / 0.5)).some(s => s.y0 < 2.4 && s.y1 > 2.2 && s.m[0] !== '_')) continue;
          // clearly in view (not just a sliver): the middle of the head and a bit below it
          if (!w.los(ex, ey, ez, hx, 2.35, hz) || !w.los(ex, ey, ez, hx, 2.15, hz) || !w.los(ex, ey, ez, mx + lx * 0.8, 2.3, mz + lz * 0.8)) continue;
          return { x: mx, z: mz, lx, lz };
        }
      }
    }
    return null;
  }

  planPeek(now) {
    const hs = this.humans();
    if (!hs.length) return;
    // it prefers whoever is furthest from everyone else
    const lonely = q => hs.reduce((m, o) => (o === q ? m : Math.min(m, Math.hypot(o.x - q.x, o.z - q.z))), 99);
    const t = this.stalkTarget && this.stalkTarget.alive && !this.stalkTarget.escaped && Math.random() < 0.7 ? this.stalkTarget
      : hs.slice().sort((a, b) => lonely(b) - lonely(a))[0];
    const spot = this.findPeek(t);
    if (!spot) return;
    this.stalkTarget = t;
    this.peekSpot = spot;
    this.state = 'peekGo';
    this.goal = { x: spot.x, y: 0, z: spot.z };
    this.path = null;
  }

  startPeek(now) {
    const t = this.stalkTarget, s = this.peekSpot, p = this.p;
    if (!t || !s || !t.alive) { this.state = 'wander'; this.goal = null; return; }
    // stand exactly on the spot that was checked (it stops walking up to half a metre short)
    if (Math.hypot(p.x - s.x, p.z - s.z) < 1) { p.x = s.x; p.z = s.z; }
    this.vel.x = this.vel.z = 0;
    // still hidden from them? (they may have moved) — then lean out
    if (this.world.los(t.x, t.y + 1.6, t.z, p.x, 1.4, p.z)) { this.leave(now); return; }
    // turn so the lean is to its side, facing roughly towards them
    const tx = t.x - p.x, tz = t.z - p.z;
    let fx = -s.lz, fz = s.lx;
    if (fx * tx + fz * tz < 0) { fx = -fx; fz = -fz; }
    p.yaw = Math.atan2(-fx, -fz);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    this.peekSide = Math.sign(s.lx * rx + s.lz * rz) || 1;
    this.state = 'peek';
    this.peekStart = now;
    this.lookedAt = 0;
  }

  // holding the peek: once they have looked straight at it for half a second, it's gone
  peekHold(dt, now) {
    const t = this.stalkTarget, s = this.peekSpot, p = this.p;
    if (!t || !t.alive || t.escaped) { this.state = 'wander'; this.goal = null; return; }
    const hx = p.x + s.lx, hz = p.z + s.lz;
    const dx = hx - t.x, dz = hz - t.z, d = Math.hypot(dx, dz);
    const facing = Math.abs(angTo(t.yaw, Math.atan2(-dx, -dz))) < 0.4;
    if (facing && (this.world.los(t.x, t.y + 1.6, t.z, hx, 2.35, hz) || this.world.los(t.x, t.y + 1.6, t.z, hx, 2.15, hz))) this.lookedAt += dt;
    const bodySeen = this.world.los(t.x, t.y + 1.6, t.z, p.x, 1.4, p.z);
    if (this.lookedAt >= 0.5 || bodySeen || d < 6 || now - this.peekStart > 15) this.leave(now);
  }

  // back off out of sight, then carry on; after a few peeks at someone, the next time it sees them it charges
  leave(now) {
    const t = this.stalkTarget, p = this.p, nav = this.nav;
    this.peeks = (this.peeks || 0) + 1;
    if (t && this.peeks >= 3 && Math.random() < 0.6) { this.ambush = t.id; this.peeks = 0; }
    this.nextPeek = now + 35 + Math.random() * 45;
    let goal = null;
    if (t) {
      const i = nav.randomNode((x, y, z) => y < 0.1 && Math.hypot(x - p.x, z - p.z) < 14 && Math.hypot(x - t.x, z - t.z) > Math.hypot(p.x - t.x, p.z - t.z) + 2
        && !this.world.los(t.x, t.y + 1.6, t.z, x, 1.4, z), 120);
      if (i >= 0 && Math.hypot(nav.x[i] - t.x, nav.z[i] - t.z) > Math.hypot(p.x - t.x, p.z - t.z)) goal = { x: nav.x[i], y: 0, z: nav.z[i] };
    }
    this.state = goal ? 'retreat' : 'wander';
    this.goal = goal;
    this.path = null;
  }

  // somewhere to wander: towards where the players are (it can smell them), more surely the longer it has had nothing to go on
  wanderGoal(now) {
    const hs = this.humans(), nav = this.nav;
    const bored = Math.min(1, (now - this.lastClue) / 60);
    const q = hs.length && Math.random() < 0.45 + bored * 0.4 ? hs[Math.floor(Math.random() * hs.length)] : null;
    const r = 24 - bored * 12;
    const i = nav.randomNode((x, y, z) => y < 0.1 && (!q || Math.hypot(x - q.x, z - q.z) < r) && Math.hypot(x - this.p.x, z - this.p.z) > 8 && this.canReach(x, z));
    return i >= 0 ? { x: nav.x[i], y: 0, z: nav.z[i] } : null;
  }

  sees(q) {
    const p = this.p;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    // how far it sees: less far once you have got away from it in a chase (on easier difficulties)
    if (d > (this.state === 'chase' && this.target === q ? this.lv.chaseSight : this.lv.sight)) return false;
    if (d > 3) {
      // in front of it (115–150° wide, by difficulty)
      const yaw = Math.atan2(-dx, -dz);
      if (Math.abs(angTo(p.yaw, yaw)) > this.lv.fov) return false;
    }
    return this.world.los(p.x, p.y + 2.2, p.z, q.x, q.y + EYE - 0.2, q.z) || this.world.los(p.x, p.y + 1.2, p.z, q.x, q.y + 0.9, q.z);
  }

  tryGrab(now) {
    const p = this.p;
    for (const q of this.humans()) {
      if (Math.hypot(q.x - p.x, q.z - p.z) < MONSTER.reach && Math.abs(q.y - p.y) < 1.6 && this.world.los(p.x, p.y + 1.2, p.z, q.x, q.y + 1.2, q.z)) {
        p.yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));          // face to face (their screen shows its face)
        if (this.dragging) this.dropBody(now);                    // (its hand is needed)
        this.s.monsterKill(p, q);                                 // -> startCatch: the slam, then what it does with the body
        this.state = 'wander'; this.target = null; this.goal = null; this.path = null;
        return;
      }
    }
  }

  // ---------- catching someone (owner's design) ----------
  // It grabs them by an arm or a leg, lifts them, slams them once or twice on the floor (or into a wall, if one is
  // in reach of its right arm), and then: 1 in 3 it hangs the body on the nearest wall, 1 in 3 it drags it about
  // until it sees its next victim, otherwise it leaves it where it fell. The players' screens show the body as a
  // ragdoll pinned to its hand (brfx.js); here it only stands and goes through the positions.
  planCatch(q) {
    const p = this.p, w = this.world;
    const by = Math.random() < 0.5 ? 'leg' : 'arm';
    // a wall close enough on some side to swing them into (not so close that it is in the way)
    let wall = null;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const r = w.trace(p.x, 1.5, p.z, dx, 0, dz, 1.7);
      if (!r.solid || Math.abs(r.ny) > 0.5 || r.t < 1.2 || (wall && r.t >= wall.t)) continue;
      wall = { t: r.t, dx, dz, x: p.x + dx * r.t, z: p.z + dz * r.t, nx: r.nx, nz: r.nz };
    }
    const on = wall && Math.random() < 0.5 ? 'wall' : 'floor';
    const roll = Math.random();
    let then = roll < 1 / 3 ? 'hang' : roll < 2 / 3 ? 'drag' : null;
    const spot = then === 'hang' ? this.wallSpot(q.x, q.z) : null;
    if (then === 'hang' && !spot) then = 'drag';                 // nowhere to hang it
    return { by, on, n: Math.random() < 0.5 ? 1 : 2, then, wall: on === 'wall' ? wall : null, spot };
  }

  startCatch(q, c) {
    const now = this.lastNow || 0, leg = c.by === 'leg', m = c.on === 'wall' ? 'slamWall' : 'slam';
    const stages = []; let e = now;
    const add = (mode, dur, k) => { e += dur; stages.push({ mode, k, end: e }); };
    add('seize', 0.35, leg ? 1 : 0); add('hoist', leg ? 0.9 : 0.7, 1);
    for (let i = 0; i < c.n; i++) {
      // each slam is four positions: swung up (or turned away from the wall), halfway, the hit, the settle
      add(m, i ? 0.42 : m === 'slam' ? 0.28 : 0.42, 0); add(m, 0.07, 1); add(m, i === c.n - 1 ? 0.6 : 0.38, 2); add(m, 0.25, 3);
    }
    // into a wall: while it lifts them it turns so that the wall is on its right, where the swing ends
    this.catching = { id: q.id, c, stages, mode: 'seize', k: stages[0].k, yaw: c.wall ? Math.atan2(-c.wall.dz, c.wall.dx) : null };
    this.vel.x = this.vel.z = 0; this.noticeUntil = 0; this.kicking = null;
  }

  catchStep(dt, now) {
    const c = this.catching, p = this.p;
    p.use = false; this.vel.x = this.vel.z = 0;
    if (c.yaw != null && c.mode === 'hoist') p.yaw += angTo(p.yaw, c.yaw) * Math.min(1, dt * 10);
    const st = c.stages.find(x => now < x.end);
    if (st) { c.mode = st.mode; c.k = st.k; return; }
    this.catching = null;
    const then = c.c.then;
    this.state = 'wander'; this.target = null; this.goal = null; this.path = null;
    if (then) {
      this.dragging = { id: c.id, fate: then, until: now + 120, wall: then === 'hang' ? c.c.spot : null };
      if (then === 'hang') this.state = 'hangGo';
    } else this.s.broadcast({ t: 'dropBody', id: c.id, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: Math.round(p.yaw * 100) / 100 });
    this.pauseUntil = now + (then ? 0.7 : 1.6);       // it stands over them a moment
  }

  // the nearest bit of wall within 7 m, with room to stand in front of it
  wallSpot(x, z) {
    let best = null;
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const r = this.world.trace(x, 1.5, z, dx, 0, dz, 7);
      if (!r.solid || Math.abs(r.ny) > 0.5 || (best && r.t >= best.t)) continue;
      const hx = x + dx * r.t, hz = z + dz * r.t, sx = hx + r.nx * 0.8, sz = hz + r.nz * 0.8;
      if (!this.nav.standable(sx, 0, sz) || this.world.isPit(sx, sz)) continue;
      best = { t: r.t, x: Math.round((hx + r.nx * 0.03) * 100) / 100, z: Math.round((hz + r.nz * 0.03) * 100) / 100, nx: r.nx, nz: r.nz, sx, sz };
    }
    return best;
  }

  // let go of the body it is dragging, where it is (just behind it)
  dropBody(now) {
    const d = this.dragging, p = this.p;
    if (!d) return;
    this.dragging = null; this.hanging = null;
    if (this.state === 'hangGo') this.state = 'wander';
    this.s.broadcast({ t: 'dropBody', id: d.id, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: Math.round(p.yaw * 100) / 100 });
  }

  move(dir, speed, dt) {
    const p = this.p, v = this.vel;
    const tx = dir ? dir[0] * speed : 0, tz = dir ? dir[1] * speed : 0;
    const k = Math.min(1, dt * (dir ? 6 : 10));
    v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    const ox = p.x, oz = p.z;
    this.onGround = this.world.move(p, v, dt, PLAYER_RADIUS, this.onGround, PLAYER_HEIGHT);
    // it never falls down its own pits: if it somehow drops, it climbs back out where it was
    if (p.y < -0.5) { p.x = ox; p.z = oz; p.y = 0; v.x = v.z = v.y = 0; }
    const moved = Math.hypot(p.x - ox, p.z - oz);
    if (moved > 0.002) p.yaw += angTo(p.yaw, Math.atan2(-(p.x - ox), -(p.z - oz))) * Math.min(1, dt * 8);
    else if (this.target) p.yaw += angTo(p.yaw, Math.atan2(-(this.target.x - p.x), -(this.target.z - p.z))) * Math.min(1, dt * 6);
    p.moved = (p.moved || 0) + moved;
    // stuck against something: think again about the route
    if (dir) {
      this.stuckT = moved < speed * dt * 0.2 ? (this.stuckT || 0) + dt : 0;
      if (this.stuckT > 0.7) { this.stuckT = 0; this.path = null; if (this.state === 'wander') this.goal = null; }
    }
  }

  // follow the walking grid to the goal; returns a direction, or null when there
  navigate(goal, now) {
    const p = this.p, nav = this.nav;
    const dGoal = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (dGoal < 0.6) return null;
    // behind a gate that is still shut: no way there (and no searching the whole maze for one)
    if (!this.canReach(goal.x, goal.z)) { this.goal = null; this.path = null; return null; }
    const key = `${Math.round(goal.x)},${Math.round(goal.z)}`;
    if (!this.path || key !== this.pathKey || now > this.repathAt) {
      this.pathKey = key;
      this.path = nav.path(nav.nearest(p.x, p.y, p.z), nav.nearest(goal.x, 0, goal.z), Math.round(nav.n * 1.2), this.doorCost);   // (no search limit to speak of: the longest ways across the big maze need over half the grid)
      this.pathIdx = 0;
      this.repathAt = now + (this.state === 'chase' ? 0.5 : this.state === 'pursue' || this.state === 'stalk' ? 1 : 4);
      if (!this.path) { this.goal = null; return null; }
    }
    const path = this.path;
    while (this.pathIdx < path.length - 1 && Math.hypot(nav.x[path[this.pathIdx]] - p.x, nav.z[path[this.pathIdx]] - p.z) < 0.5) this.pathIdx++;
    // skip ahead along straight stretches
    for (let k = Math.min(path.length - 1, this.pathIdx + 6); k > this.pathIdx; k--) {
      if (this.straight(p.x, p.z, nav.x[path[k]], nav.z[path[k]])) { this.pathIdx = k; break; }
    }
    const i = path[this.pathIdx];
    let dx = nav.x[i] - p.x, dz = nav.z[i] - p.z;
    if (this.pathIdx === path.length - 1) { dx = goal.x - p.x; dz = goal.z - p.z; }
    const d = Math.hypot(dx, dz);
    return d > 0.01 ? [dx / d, dz / d] : null;
  }

  straight(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25), w = this.world;
    for (let i = 1; i <= n; i++) {
      const k = i / n, x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      if (!this.nav.standable(x, 0, z)) return false;
      if (w.cellSpans(Math.floor(x / 0.5), Math.floor(z / 0.5)).some(sp => sp.m === '_door')) return false;     // a shut door
    }
    return true;
  }
}

// Every outside corner of the walls and pillars (where exactly one of the four cells around a grid
// point is solid): { x, z, qx, qz } with (qx, qz) pointing from the corner into the solid cell.
// Used for the corner snatch and for the monster's peeking spots.
export function outerCorners(world) {
  const C = 0.5, out = [];
  const solid = (ix, iz) => ix < 0 || iz < 0 || ix >= world.w || iz >= world.h || world.cellSpans(ix, iz).some(s => s.m[0] !== '_' && s.y0 < 1 && s.y1 > 1.5);
  for (let iz = 1; iz < world.h; iz++) for (let ix = 1; ix < world.w; ix++) {
    const q = [[-1, -1, solid(ix - 1, iz - 1)], [0, -1, solid(ix, iz - 1)], [-1, 0, solid(ix - 1, iz)], [0, 0, solid(ix, iz)]];
    const s = q.filter(c => c[2]);
    if (s.length !== 1) continue;
    out.push({ x: ix * C, z: iz * C, qx: s[0][0] ? -1 : 1, qz: s[0][1] ? -1 : 1 });
  }
  // a quick lookup by 2 m square
  const grid = new Map();
  for (const c of out) { const k = `${Math.floor(c.x / 2)},${Math.floor(c.z / 2)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
  out.near = (x, z, r) => {
    const res = [], n = Math.ceil(r / 2), bx = Math.floor(x / 2), bz = Math.floor(z / 2);
    for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) for (const c of grid.get(`${bx + dx},${bz + dz}`) || []) if (Math.hypot(c.x - x, c.z - z) <= r) res.push(c);
    return res;
  };
  return out;
}
