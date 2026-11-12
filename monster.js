// The Backrooms monster's brain. Runs on the host (and the home server), never in a client.
// It wanders the maze, listens for running footsteps, chases anyone it sees and kills on contact.
// Walking is quiet; sprinting (Shift / the run button) is heard 11–16 m away (by difficulty), through walls.
import { PLAYER_RADIUS, PLAYER_HEIGHT, EYE } from './world.js';
import { BR, BR_LEVELS, brLevel } from './brmap.js';

// The fixed numbers. Everything that changes with the difficulty (how fast it chases: 5 / 10 / 15 %
// faster than your sprint, how far it sees and hears, how quickly it loses you) is in BR_LEVELS in brmap.js.
export const MONSTER = {
  wander: 2.3,       // m/s walking around
  stalk: 2.9,        // m/s creeping up behind someone who hasn't seen it
  search: 4.0,       // m/s going to a noise, or searching where you were last seen
  lunge: 1.12,       // × its chasing speed for the last few metres
  reach: 1.15,       // m: grabs you this close
  height: 2.75,      // m: how tall it is (for its eyes)
};
const RUN_SPEED = 3.5;   // m/s: faster than this is sprinting (loud); walking is BR.walk
export const SKIN_CHANCE = 1 / 3;   // a kill nobody else saw: how often it takes their skin and wears it (owner's choice)

const angTo = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// What it does, in order of what matters most:
//   chase   — it can see you: straight for you, aiming a little ahead of where you are running
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

  humans() { return [...this.s.players.values()].filter(q => !q.bot && !q.dummy && q.alive && !q.escaped); }

  update(dt, now) {
    this.lastNow = now;
    this.step(dt, now);
    // what the players' screens should animate: idle, walk, stalk, run, search, listen, grab, peek:±1,
    // skin (wearing someone: the host hides it and shows them instead), reveal (changing back)
    const p = this.p, sp = Math.hypot(this.vel.x, this.vel.z);
    const mode = this.state === 'skin' ? 'skin' : this.state === 'reveal' ? 'reveal' : now < (this.grabUntil || 0) ? 'grab'
      : this.state === 'peek' ? `peek:${this.peekSide || 1}`
        : now < this.pauseUntil ? (this.opening ? 'idle' : 'listen')
          : sp < 0.3 ? 'idle'
            : this.state === 'chase' || this.state === 'pursue' ? 'run'
              : this.state === 'stalk' || this.state === 'peekGo' ? 'stalk'
                : this.state === 'search' || this.state === 'retreat' ? 'search' : 'walk';
    p.w = `m:${mode}`;
  }

  step(dt, now) {
    const p = this.p;
    const wake = this.lv.wake;
    if (this.started == null) { this.started = now; this.listenAt = now + wake + 15; this.lastClue = now; this.nextPeek = now + wake + 25 + Math.random() * 30; }
    if (now - this.started < wake) { p.use = false; return; }
    if (this.state === 'wait') this.state = 'wander';
    if (this.state === 'skin') { this.thinkAt = now; this.skinStep(dt, now); return; }
    if (this.state === 'reveal') {
      // changing back (0.9 s), then straight for whoever it was standing next to
      p.use = false;
      this.move(null, 0, dt);
      if (now >= this.revealEnd) {
        const t = this.target;
        if (t && t.alive && !t.escaped) { this.state = 'chase'; this.lostAt = now; this.s.monsterAlert(p, t); } else { this.state = 'wander'; this.target = null; }
        this.goal = null; this.path = null;
      }
      return;
    }
    if (now >= this.thinkAt) { this.thinkAt = now + 0.12; this.think(now); }
    if (now < this.pauseUntil) { p.use = false; if (this.opening) this.doors(now, null); this.move(null, 0, dt); return; }
    if (this.state === 'peek') { this.peekHold(dt, now); this.move(null, 0, dt); return; }

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

  // a shut door right in front of it: it stops, rattles the handle, then opens it
  doors(now, dir) {
    const p = this.p, w = this.world;
    if (this.opening) {
      if (now >= this.opening.at) { this.s.toggleDoor(this.opening.i, true, p); this.opening = null; }
      return true;
    }
    if (!dir) return false;
    for (let i = 0; i < w.doors.length; i++) {
      const d = w.doors[i];
      if (d.kind !== 'way' || d.open) continue;
      const dx = d.cx - p.x, dz = d.cz - p.z, dist = Math.hypot(dx, dz);
      if (dist > 1.5 || (dx * dir[0] + dz * dir[1]) / (dist || 1) < 0.3) continue;
      // wearing someone: it just opens it, like a person would
      if (this.state === 'skin') { this.s.toggleDoor(i, true, p); return false; }
      const wait = this.state === 'chase' ? 0.7 : 1.2;
      this.opening = { i, at: now + wait };
      this.pauseUntil = now + wait;
      this.s.broadcast({ t: 'doorRattle', i });
      return true;
    }
    return false;
  }

  // reached where it was going
  arrived(now) {
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
    if (this.state === 'skin' || this.state === 'reveal') return;
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
    if (seen && this.ambush === seen.id) { this.ambush = null; this.s.monsterAlert(this.p, seen); this.state = 'chase'; this.target = seen; this.lostAt = now; }
    if (seen) {
      clue(seen);
      // far away and looking the other way: creep up on them; otherwise (or once they turn round) charge
      const lookingAtMe = Math.abs(angTo(seen.yaw, Math.atan2(-(p.x - seen.x), -(p.z - seen.z)))) < 0.9;
      const canStalk = seenD > 9 && !lookingAtMe && this.state !== 'chase';
      if (canStalk && (this.state === 'stalk' || seenD > 13)) { this.state = 'stalk'; this.target = seen; }
      else {
        if (this.state !== 'chase') this.s.monsterAlert(this.p, seen);
        this.state = 'chase'; this.target = seen; this.lostAt = now;
      }
    } else if (this.state === 'chase' || this.state === 'stalk') {
      // lost sight: run on to where they were heading
      // (on easier difficulties it gives up on you sooner and guesses less far ahead)
      if (this.state === 'stalk' || now - this.lostAt > this.lv.lose) {
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
    if (this.state === 'wander') {
      // now and then it picks one person and stalks them, peeking round corners at them
      if (now > this.nextPeek) { this.nextPeek = now + 12; this.planPeek(now); }
      // now and then it stops dead and listens
      if (this.state === 'wander' && now > this.listenAt) { this.listenAt = now + 14 + Math.random() * 14; this.pauseUntil = now + 1.8 + Math.random() * 1.6; }
      if (this.state === 'wander' && !this.goal) this.goal = this.wanderGoal(now);
    }
    p.use = this.state === 'chase';     // clients: screeching, running animation
  }

  // ---------- wearing someone ----------
  // It has just caught q. If nobody else saw (and 1 time in 3) it takes their skin and wears it: everyone else
  // still sees q, walking about. It goes to the nearest player like a teammate would, stands with them a
  // moment too long, then changes back and goes for them. Small clues give it away to a careful player:
  // it never turns a flashlight on or leaves a note, its head twitches now and then, and it stares.
  canWear(q) {
    if (this.state === 'skin' || this.state === 'reveal' || Math.random() >= SKIN_CHANCE) return false;
    const others = this.humans().filter(o => o !== q);
    if (!others.length) return false;                // nobody left to fool
    const w = this.world, p = this.p;
    return !others.some(o => Math.hypot(o.x - q.x, o.z - q.z) < 32
      && (w.los(o.x, o.y + EYE, o.z, q.x, q.y + 1.2, q.z) || w.los(o.x, o.y + EYE, o.z, p.x, p.y + 2.2, p.z)));
  }

  wear(q) {
    const now = this.lastNow || 0;
    this.skin = { id: q.id, since: now, target: null, pickAt: 0, close: 0, away: 0, hold: 1.6 + Math.random() * 2.6, twitchAt: now + 3 + Math.random() * 5, twitchUntil: 0, twitch: 0 };
    this.state = 'skin';
    this.goal = null; this.path = null; this.target = null; this.opening = null;
    this.pauseUntil = 0; this.grabUntil = 0;
    this.vel.x = this.vel.z = 0;
  }

  skinStep(dt, now) {
    const p = this.p, s = this.skin, hs = this.humans();
    p.use = false;
    if (!hs.length) { this.unmask(now); return; }
    // who it goes for: the nearest, thought about again every few seconds
    if (!s.target || !s.target.alive || s.target.escaped || now > s.pickAt) {
      s.target = hs.reduce((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? b : a));
      s.pickAt = now + 4;
    }
    const t = s.target, d = Math.hypot(t.x - p.x, t.z - p.z);
    this.target = t;                                 // (standing still, it turns to face them: it stares)
    // a clue: now and then its head twitches
    if (now > s.twitchAt) { s.twitchUntil = now + 0.14; s.twitch = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.25); s.twitchAt = now + 5 + Math.random() * 9; }
    p.pitch = now < s.twitchUntil ? s.twitch : 0;
    // it never found anyone to fool: it changes back where it is
    if (now - s.since > 180) { this.unmask(now); return; }
    const sees = this.world.los(p.x, p.y + EYE, p.z, t.x, t.y + EYE, t.z);
    if (d < 2.6 && sees) {
      // right next to them, the way a teammate stands... for a moment too long
      s.close += dt;
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
      const away = ((p.x - t.x) * fx + (p.z - t.z) * fz) / (d || 1) < -0.2;     // they turned their back on it
      s.away = away ? s.away + dt : 0;
      if (d < 1.3 || s.close > s.hold || (s.close > 0.6 && s.away > 0.35)) { this.unmask(now); return; }
      this.move(d > 1.9 ? [(t.x - p.x) / d, (t.z - p.z) / d] : null, 1.2, dt);
      return;
    }
    s.close = Math.max(0, s.close - dt * 0.5);
    // on its way: walking like a person (it only sprints to catch up when they're far off and can't see it)
    const speed = d > 22 && !sees ? BR.sprint : d > 7 ? BR.walk : Math.max(1.4, BR.walk * (d - 2) / 5);
    const k = Math.max(0, (d - 2) / (d || 1));
    const goal = sees && d < 9 ? { x: p.x + (t.x - p.x) * k, y: 0, z: p.z + (t.z - p.z) * k } : { x: t.x, y: 0, z: t.z };
    const dir = this.navigate(goal, now);
    this.doors(now, dir);
    this.move(dir, speed, dt);
  }

  // stop pretending: it changes back where it stands (everyone now learns who it had been wearing)
  unmask(now) {
    const s = this.skin;
    if (!s) return;
    this.skin = null;
    this.p.pitch = 0;
    this.state = 'reveal';
    this.revealEnd = now + 0.9;
    this.vel.x = this.vel.z = 0;
    this.target = s.target && s.target.alive && !s.target.escaped ? s.target : null;
    this.s.revealSkin(this.p, s.id);
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
    const i = nav.randomNode((x, y, z) => y < 0.1 && (!q || Math.hypot(x - q.x, z - q.z) < r) && Math.hypot(x - this.p.x, z - this.p.z) > 8);
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
        this.s.monsterKill(p, q);
        if (this.state === 'skin') return;          // it took their skin: now it is them
        this.grabUntil = now + 0.7;
        this.pauseUntil = now + 2.5;      // it stays over them for a moment
        this.state = 'wander'; this.target = null; this.goal = null;
        return;
      }
    }
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
    const key = `${Math.round(goal.x)},${Math.round(goal.z)}`;
    if (!this.path || key !== this.pathKey || now > this.repathAt) {
      this.pathKey = key;
      this.path = nav.path(nav.nearest(p.x, p.y, p.z), nav.nearest(goal.x, 0, goal.z), 20000);
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
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      if (!this.nav.standable(ax + (bx - ax) * k, 0, az + (bz - az) * k)) return false;
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
