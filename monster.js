// The Backrooms monster's brain. Runs on the host (and the home server), never in a client.
// It wanders the maze, listens for running footsteps, chases anyone it sees and kills on contact.
// Walking (Shift / walk) is quiet; running is heard about 16 m away, through walls.
import { PLAYER_RADIUS, PLAYER_HEIGHT, EYE } from './world.js';

export const MONSTER = {
  wander: 2.3,       // m/s walking around
  stalk: 2.9,        // m/s creeping up behind someone who hasn't seen it
  search: 4.0,       // m/s going to a noise, or searching where you were last seen
  chase: 5.7,        // m/s chasing (a running player is a little faster: ~6.1 m/s)
  lunge: 6.6,        // m/s for the last few metres
  reach: 1.15,       // m: grabs you this close
  sight: 28,         // m: sees you this far (in front of it, with a clear line)
  hear: 16,          // m: hears running feet this far
  hearWalk: 3.5,     // m: hears walking this close
  wake: 20,          // s: it starts moving this long after the game starts
  height: 2.75,      // m: how tall it is (for its eyes)
};
const RUN_SPEED = 3.5;   // m/s: faster than this is running (loud)

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
    const p = this.p;
    if (this.started == null) { this.started = now; this.listenAt = now + MONSTER.wake + 15; this.lastClue = now; }
    if (now - this.started < MONSTER.wake) { p.use = false; return; }
    if (this.state === 'wait') this.state = 'wander';
    if (now >= this.thinkAt) { this.thinkAt = now + 0.12; this.think(now); }
    if (now < this.pauseUntil) { p.use = false; if (this.opening) this.doors(now, null); this.move(null, 0, dt); return; }

    let speed = MONSTER.wander, goal = this.goal;
    if (this.state === 'chase' && this.target) {
      const t = this.target, tr = this.track.get(t.id);
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      speed = d < 4 ? MONSTER.lunge : MONSTER.chase;
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
    } else if (this.state === 'pursue') speed = MONSTER.chase;
    else if (this.state === 'search') speed = MONSTER.search;
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
    if (this.state === 'pursue') this.startSearch(now);
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
    this.searchPts = pts.slice(0, 4);
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
      if (d < seenD && this.sees(q)) { seen = q; seenD = d; }
      const loud = sp > RUN_SPEED && sp < 12;
      if ((loud && d < MONSTER.hear) || (sp > 0.4 && d < MONSTER.hearWalk) || d < 2) { if (d < heardD) { heard = q; heardD = d; } }
    }
    const clue = (q) => { const tr = this.track.get(q.id) || { vx: 0, vz: 0 }; this.last = { x: q.x, z: q.z, vx: tr.vx, vz: tr.vz, t: now, id: q.id }; this.lastClue = now; };
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
      if (this.state === 'stalk' || now - this.lostAt > 0.6) {
        const L = this.last, lead = 1.6;
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
      // now and then it stops dead and listens
      if (now > this.listenAt) { this.listenAt = now + 14 + Math.random() * 14; this.pauseUntil = now + 1.8 + Math.random() * 1.6; }
      if (!this.goal) this.goal = this.wanderGoal(now);
    }
    p.use = this.state === 'chase';     // clients: screeching, running animation
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
    if (d > MONSTER.sight) return false;
    if (d > 3) {
      // in front of it (about 150° wide)
      const yaw = Math.atan2(-dx, -dz);
      if (Math.abs(angTo(p.yaw, yaw)) > 1.3) return false;
    }
    return this.world.los(p.x, p.y + 2.2, p.z, q.x, q.y + EYE - 0.2, q.z) || this.world.los(p.x, p.y + 1.2, p.z, q.x, q.y + 0.9, q.z);
  }

  tryGrab(now) {
    const p = this.p;
    for (const q of this.humans()) {
      if (Math.hypot(q.x - p.x, q.z - p.z) < MONSTER.reach && Math.abs(q.y - p.y) < 1.6 && this.world.los(p.x, p.y + 1.2, p.z, q.x, q.y + 1.2, q.z)) {
        this.s.monsterKill(p, q);
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
