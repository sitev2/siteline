// The Backrooms monster's brain. Runs on the host (and the home server), never in a client.
// It wanders the maze, listens for running footsteps, chases anyone it sees and kills on contact.
// Walking (Shift / walk) is quiet; running is heard about 16 m away, through walls.
import { PLAYER_RADIUS, PLAYER_HEIGHT, EYE } from './world.js';

export const MONSTER = {
  wander: 2.3,       // m/s walking around
  search: 4.0,       // m/s going to a noise
  chase: 5.7,        // m/s chasing (a running player is a little faster: ~6.1 m/s)
  lunge: 6.6,        // m/s for the last few metres
  reach: 1.15,       // m: grabs you this close
  sight: 28,         // m: sees you this far (in front of it, with a clear line)
  hear: 16,          // m: hears running feet this far
  wake: 20,          // s: it starts moving this long after the game starts
  height: 2.75,      // m: how tall it is (for its eyes)
};
const RUN_SPEED = 3.5;   // m/s: faster than this is running (loud)

const angTo = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

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
    this.prev = new Map();
    this.thinkAt = 0;
    this.pauseUntil = 0;
  }

  reset() { this.state = 'wait'; this.path = null; }

  humans() { return [...this.s.players.values()].filter(q => !q.bot && !q.dummy && q.alive && !q.escaped); }

  update(dt, now) {
    const p = this.p;
    if (this.started == null) this.started = now;
    if (now - this.started < MONSTER.wake) { p.use = false; return; }
    if (this.state === 'wait') this.state = 'wander';
    if (now < this.pauseUntil) { p.use = false; this.move(null, 0, dt); return; }
    if (now >= this.thinkAt) { this.thinkAt = now + 0.15; this.think(now); }

    let speed = MONSTER.wander;
    let goal = this.goal;
    if (this.state === 'chase' && this.target) {
      const t = this.target;
      goal = { x: t.x, y: t.y, z: t.z };
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      speed = d < 4 ? MONSTER.lunge : MONSTER.chase;
      // close and in plain view: straight at them
      if (d < 3 && this.sees(t)) { this.move([(t.x - p.x) / d, (t.z - p.z) / d], speed, dt); this.tryGrab(now); return; }
    } else if (this.state === 'search') speed = MONSTER.search;
    const dir = goal ? this.navigate(goal, now) : null;
    if (!dir && this.state !== 'chase') this.goal = null;      // got there: pick somewhere else
    this.move(dir, speed, dt);
    this.tryGrab(now);
  }

  // what it notices: who it can see (in front of it), and running feet it can hear
  think(now) {
    const p = this.p;
    let seen = null, seenD = Infinity, heard = null, heardD = Infinity;
    for (const q of this.humans()) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const pr = this.prev.get(q.id);
      const sp = pr ? Math.hypot(q.x - pr.x, q.z - pr.z) / Math.max(0.05, now - pr.t) : 0;
      this.prev.set(q.id, { x: q.x, z: q.z, t: now });
      if (d < seenD && this.sees(q)) { seen = q; seenD = d; }
      const loud = sp > RUN_SPEED && sp < 12;
      if ((loud && d < MONSTER.hear) || d < 2.5) { if (d < heardD) { heard = q; heardD = d; } }
    }
    if (seen) {
      if (this.state !== 'chase') this.s.monsterAlert(this.p, seen);
      this.state = 'chase'; this.target = seen; this.lostAt = now;
    } else if (this.state === 'chase') {
      // lost sight: keep going to where they were for a few seconds, then search there
      if (now - this.lostAt > 3.5) { this.state = 'search'; this.goal = { x: this.target.x, y: 0, z: this.target.z }; this.target = null; }
    } else if (heard) {
      this.state = 'search';
      this.goal = { x: heard.x + (Math.random() - 0.5) * 3, y: 0, z: heard.z + (Math.random() - 0.5) * 3 };
    }
    if (this.state === 'chase' && this.target && (!this.target.alive || this.target.escaped)) { this.state = 'wander'; this.target = null; this.goal = null; }
    if (this.state === 'search' && !this.goal) this.state = 'wander';
    if (this.state === 'wander' && !this.goal) this.goal = this.wanderGoal();
    p.use = this.state === 'chase';     // clients: screeching, running animation
  }

  // somewhere to wander: usually towards where the players are (it can smell them), never exactly
  wanderGoal() {
    const hs = this.humans(), nav = this.nav;
    const q = hs.length && Math.random() < 0.5 ? hs[Math.floor(Math.random() * hs.length)] : null;
    const i = nav.randomNode((x, y, z) => y < 0.1 && (!q || Math.hypot(x - q.x, z - q.z) < 22) && Math.hypot(x - this.p.x, z - this.p.z) > 8);
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
      this.repathAt = now + (this.state === 'chase' ? 0.5 : 4);
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
