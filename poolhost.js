// Level 2 (the Poolrooms) on the host: the order and everything in it that has to be the same for everyone.
// Runs in the host's browser and on the home server (server.js makes one in startPool()). No three.js in here.
//   1 the bridge: a pressure plate raises a tiled bridge across the deep channel while someone stands on it
//     (alone: it stays up `hold` seconds after you step off). A second, optional one leads to the apse.
//   2 the steam: three valves (HOLD E), each heating its own lane of the Great Pool; turned, one stays open; steam shows it.
//   3 the drain: with every lane hot the big wheel turns (HOLD E); the Great Pool empties over 10 s, for good.
//   4 the exit: the tunnel at the bottom, the ladder up the shaft, the white hatch: each player gets out alone.
// Also: falls of more than 6 m onto a hard floor kill (deep water always saves you), the three slides (the host
// only tells the others), and the two floaties (pick up with E, throw with fire; they bob and drift).
import { POOL, POOL_LEVELS, hotLanes, setBridge } from './poolmap.js';

const { G, U, WY } = POOL;
const r2 = v => Math.round(v * 100) / 100;
const DRAIN_SECS = 10;
export const FALL_KILL = 6;            // metres onto a hard floor
const RING_G = 12;                     // a floatie falls a little slower than a person (it is light and catches the air)

export class PoolHost {
  constructor(S) {
    this.S = S; this.world = S.world; this.plan = S.world.def.pool;
    this.L = POOL_LEVELS[this.plan.level] || POOL_LEVELS.normal;
    this.at = performance.now(); this.sentAt = 0; this.t = 0;
    this.bridges = this.plan.bridges.map(br => ({ up: 0, solid: false, holdUntil: 0, pressed: br.plates.map(() => false), dir: 0 }));
    this.valves = this.plan.valves.map(() => ({ p: 0, open: false, held: false }));
    this.heat = [0, 0, 0];
    this.unlocked = false;
    this.drainP = 0; this.drainHeld = false; this.drainAt = null; this.stuckAt = 0;
    this.great = this.world.bodies.find(b => b.name === 'great');
    this.level = this.great.y;
    this.rings = this.plan.floaties.map((f, i) => ({ i, x: f.x, y: WY, z: f.z, vx: 0, vy: 0, vz: 0, mode: 'float', holder: null, hitAt: 0 }));
  }

  // where you stand to turn a valve (or the drain wheel), and whether you are near enough
  standAt(v) { return { x: v.x + v.nx * 0.7, z: v.z + v.nz * 0.7 }; }
  reach(p, v, r = 1.9) { const s = this.standAt(v); return Math.hypot(p.x - s.x, p.z - s.z) < r && Math.abs(p.y - v.y) < 1.5; }

  fx(m) { this.S.broadcast({ t: 'pfx', ...m }); }

  // a message from a player (returns nothing; anything odd is ignored)
  msg(p, m) {
    if (!p.alive || p.escaped) return;
    const now = performance.now();
    switch (m.t) {
      // (sent several times a second while E / the hand button is held at a valve or the drain wheel)
      case 'valve': if (Number.isInteger(m.i) && this.valves[m.i]) p.poolUse = { k: 'valve', i: m.i, at: now }; return;
      case 'drain': p.poolUse = { k: 'drain', at: now }; return;
      case 'fell': {
        // a long fall onto a hard floor: the player's own game says so; the host checks they really were up there
        const top = Math.max(...(p.poolYs || [p.y]).map(e => e[1] ?? e));
        // (landing in water at least waist deep saves you: a drained pool doesn't)
        const b = this.world.bodyAt(p.x, p.z), wet = b && b.y > p.y + 0.5;
        if (Number(m.h) > FALL_KILL && top - p.y > FALL_KILL - 0.6 && !wet) { p.brDeath = 'poolfall'; this.S.kill(p, null, 'poolfall', false); }
        return;
      }
      case 'slide': {
        const s = this.plan.slides[m.i];
        if (s && Math.hypot(p.x - s.mouth.x, p.z - s.mouth.z) < 2.5 && Math.abs(p.y - U) < 1.2) this.S.broadcast({ t: 'slide', id: p.id, i: m.i }, p.id);
        return;
      }
      case 'ring': {
        if (this.rings.some(r => r.holder === p.id)) return;
        let best = null, bd = 1.9;
        for (const r of this.rings) {
          if (r.holder || r.mode === 'lost') continue;
          const d = Math.hypot(r.x - p.x, r.z - p.z), dy = r.y - p.y;
          if (d < bd && dy > -0.6 && dy < 2.3) { bd = d; best = r; }
        }
        if (best) { best.holder = p.id; best.mode = 'held'; this.fx({ k: 'grab', i: best.i, id: p.id }); this.sentAt = 0; }
        return;
      }
      case 'throw': {
        const r = this.rings.find(q => q.holder === p.id);
        if (!r || !Number.isFinite(m.yaw) || !Number.isFinite(m.pitch)) return;
        const cp = Math.cos(m.pitch), dx = -Math.sin(m.yaw) * cp, dy = Math.sin(m.pitch), dz = -Math.cos(m.yaw) * cp;
        r.holder = null; r.mode = 'fly';
        r.x = p.x + dx * 0.45; r.y = p.y + 1.35 + dy * 0.45; r.z = p.z + dz * 0.45;
        // (not from inside a wall: if the hand is past one, it leaves from your middle)
        if (this.world.blocked(r.x, r.z, 0.05, r.y - 0.1, 0, 0.2)) { r.x = p.x; r.z = p.z; }
        r.vx = dx * 9; r.vy = dy * 9 + 1.6; r.vz = dz * 9;
        this.fx({ k: 'throw', i: r.i, id: p.id });
        this.sentAt = 0;
        return;
      }
    }
  }

  // a player died, got out or left: a floatie in their hands drops where they were
  drop(p) {
    for (const r of this.rings) if (r.holder === p.id) { r.holder = null; r.mode = 'fly'; r.x = p.x; r.y = p.y + 1.1; r.z = p.z; r.vx = r.vz = 0; r.vy = 0; }
  }

  tick() {
    const S = this.S, now = performance.now(), plan = this.plan;
    const dt = Math.min(0.25, (now - this.at) / 1000);
    this.at = now; this.t += dt;
    const inside = S.humans().filter(p => p.alive && !p.escaped), solo = S.brSolo();
    // (how high each player has been in the last few seconds: the host's check on a reported fall)
    for (const p of inside) { const ys = p.poolYs || (p.poolYs = []); ys.push([now, p.y]); while (ys.length && now - ys[0][0] > 4000) ys.shift(); }
    let changed = false;

    // ---- 1: plates and bridges ----
    plan.bridges.forEach((br, bi) => {
      const b = this.bridges[bi];
      br.plates.forEach((pl, j) => {
        const on = inside.some(p => Math.abs(p.x - pl.x) <= plan.plate.half + 0.05 && Math.abs(p.z - pl.z) <= plan.plate.half + 0.05 && Math.abs(p.y - G - plan.plate.h) < 0.35);
        if (on !== b.pressed[j]) { b.pressed[j] = on; this.fx({ k: 'plate', b: bi, j, on: on ? 1 : 0 }); changed = true; }
        if (on) b.holdUntil = Math.max(b.holdUntil, now + (solo ? this.L.hold : 0.3) * 1000);
      });
      const want = now < b.holdUntil;
      // (it won't come up under someone swimming there: they'd be caught in it)
      const under = inside.some(p => p.y < G - 0.5 && p.x > br.x0 - 0.45 && p.x < br.x1 + 0.45 && p.z > br.z0 - 0.45 && p.z < br.z1 + 0.45);
      const dir = want && (b.solid || !under) ? 1 : want ? 0 : -1;
      if (dir !== b.dir && dir !== 0 && ((dir > 0 && b.up < 1) || (dir < 0 && b.up > 0))) this.fx({ k: 'bridge', b: bi, up: dir > 0 ? 1 : 0 });
      b.dir = dir;
      const was = b.up;
      b.up = Math.max(0, Math.min(1, b.up + dir * dt / (dir > 0 ? 1.3 : 1.0)));
      if (b.up !== was) changed = true;
      const solid = b.up >= 0.98;
      if (solid !== b.solid) {
        b.solid = solid; setBridge(this.world, br, solid);
        // a floatie lying on it drops into the water
        if (!solid) for (const r of this.rings) if (r.mode === 'rest' && r.x > br.x0 && r.x < br.x1 && r.z > br.z0 && r.z < br.z1) { r.mode = 'fly'; r.vx = r.vy = r.vz = 0; }
      }
    });

    // ---- 2: valves and the lanes' heat ----
    this.valves.forEach((v, i) => {
      const pv = plan.valves[i];
      // (only one way: open. Let go half way and it stays there; once all the way open it can't be turned again)
      const held = !v.open && inside.some(p => p.poolUse && p.poolUse.k === 'valve' && p.poolUse.i === i && now - p.poolUse.at < 400 && this.reach(p, pv));
      if (held && !v.held) this.fx({ k: 'valve', i, on: 1 });
      if (!held && v.held) this.fx({ k: 'valve', i, on: 0 });
      v.held = held;
      if (held) {
        v.p = Math.min(1, v.p + dt / this.L.turn);
        if (v.p >= 1) { v.open = true; v.held = false; this.fx({ k: 'valveEnd', i, open: 1 }); }
        changed = true;
      }
    });
    const hot = hotLanes(this.valves.map(v => v.open));
    hot.forEach((h, l) => { const t = h ? 1 : 0, was = this.heat[l]; this.heat[l] += Math.max(-dt / 3, Math.min(dt / 3, t - this.heat[l])); if (this.heat[l] !== was) changed = true; });
    const unlocked = this.heat.every(h => h > 0.9);
    if (unlocked !== this.unlocked && !this.drainAt) { this.unlocked = unlocked; this.fx({ k: 'unlock', on: unlocked ? 1 : 0 }); changed = true; }

    // ---- 3: the drain ----
    const dr = plan.drain;
    const dHeld = !this.drainAt && inside.some(p => p.poolUse && p.poolUse.k === 'drain' && now - p.poolUse.at < 400 && this.reach(p, dr, 2.1));
    if (dHeld && !this.unlocked) {
      if (now - this.stuckAt > 1400) { this.stuckAt = now; this.fx({ k: 'stuck' }); }       // (it rattles and won't budge: no words)
    } else if (dHeld) {
      if (!this.drainHeld) this.fx({ k: 'wheel', on: 1 });
      this.drainP = Math.min(1, this.drainP + dt / (this.L.turn * 2.5));
      changed = true;
      if (this.drainP >= 1) { this.drainAt = now; this.fx({ k: 'drain' }); }
    }
    if (this.drainHeld && !dHeld && !this.drainAt) this.fx({ k: 'wheel', on: 0 });
    this.drainHeld = dHeld;
    if (this.drainAt) {
      const k = Math.min(1, (now - this.drainAt) / 1000 / DRAIN_SECS), e = k * k * (3 - 2 * k);
      const lv = WY - (WY - this.great.bottom) * e;
      if (lv !== this.level) { this.level = lv; this.great.y = lv; changed = true; }
    }

    // ---- 4: the way out: up the exit ladder and through the white hatch ----
    if (this.drainAt && this.level <= this.great.bottom + 0.01) {
      const sh = plan.exit.shaft, h = plan.exit.hatch;
      for (const p of inside) {
        if (p.x > sh.x0 && p.x < sh.x1 && p.z > sh.z0 && p.z < sh.z1 && p.y >= h.out) {
          p.escaped = true; p.alive = false; p.escapeTime = Math.round(S.timer);
          this.drop(p);
          S.broadcast({ t: 'escaped', id: p.id, name: p.name, time: p.escapeTime, hatch: 1 });
          S.brCheck();
        }
      }
    }

    // ---- the floaties ----
    for (const r of this.rings) if (this.ringStep(r, dt, inside)) changed = true;

    if (changed && now - this.sentAt > 100) { this.sentAt = now; S.broadcast({ t: 'pool', s: this.state() }); }
    else if (now - this.sentAt > 1000) { this.sentAt = now; S.broadcast({ t: 'pool', s: this.state() }); }
  }

  // one floatie for one step; true if it moved
  ringStep(r, dt, inside) {
    const W = this.world, S = this.S, now = performance.now();
    const x0 = r.x, y0 = r.y, z0 = r.z;
    if (r.holder) {
      const p = S.players.get(r.holder);
      if (!p || !p.alive || p.escaped) { this.drop(p || { x: r.x, y: r.y - 1.1, z: r.z, id: r.holder }); return true; }
      r.x = p.x; r.y = p.y + 1.1; r.z = p.z;
      return x0 !== r.x || y0 !== r.y || z0 !== r.z;
    }
    if (r.mode === 'lost') return false;
    if (r.mode === 'float') {
      const b = W.bodyAt(r.x, r.z);
      const floor = W.groundAt(r.x, r.z, 0.3, r.y + 0.2, 0.3);
      if (!b || b.y - floor < 0.25) { r.mode = 'rest'; r.y = floor; r.vx = r.vz = 0; return true; }      // (the water went: it lies on the floor)
      r.y = b.y;
      // a slow, wandering drift, and swimmers nearby push it along
      const cx = Math.sin(this.t * 0.11 + r.i * 2.1) * 0.06 + Math.sin(this.t * 0.043 + r.i) * 0.04, cz = Math.cos(this.t * 0.09 + r.i * 1.3) * 0.06;
      r.vx += (cx - r.vx) * Math.min(1, dt * 0.6); r.vz += (cz - r.vz) * Math.min(1, dt * 0.6);
      for (const p of inside) {
        const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.75 && d > 0.01 && Math.abs(p.y + 1.35 - r.y) < 0.8) { r.vx += dx / d * 2 * dt; r.vz += dz / d * 2 * dt; }
      }
      const sp = Math.hypot(r.vx, r.vz); if (sp > 1.5) { r.vx *= 1.5 / sp; r.vz *= 1.5 / sp; }
      const nx = r.x + r.vx * dt, nz = r.z + r.vz * dt;
      const ok = (x, z) => { const bb = W.bodyAt(x, z); return bb === b && !W.blocked(x, z, 0.32, b.y - 0.15, 0, 0.3); };
      if (ok(nx, r.z)) r.x = nx; else r.vx = -r.vx * 0.5;
      if (ok(r.x, nz)) r.z = nz; else r.vz = -r.vz * 0.5;
      return Math.abs(x0 - r.x) + Math.abs(z0 - r.z) + Math.abs(y0 - r.y) > 1e-4;
    }
    if (r.mode === 'rest') {
      const g = W.groundAt(r.x, r.z, 0.25, r.y + 0.1, 0.12);
      const b = W.bodyAt(r.x, r.z);
      if (b && b.y > r.y + 0.05) { r.mode = 'float'; return true; }
      if (g < r.y - 0.04) { r.mode = 'fly'; r.vx = r.vy = r.vz = 0; }
      return false;
    }
    // flying
    r.vy -= RING_G * dt;
    let left = dt;
    for (let k = 0; k < 4 && left > 1e-4; k++) {
      const sp = Math.hypot(r.vx, r.vy, r.vz);
      if (sp < 1e-4) break;
      const len = sp * left, dx = r.vx / sp, dy = r.vy / sp, dz = r.vz / sp;
      const hit = W.raycast(r.x, r.y, r.z, dx, dy, dz, len + 0.2);
      // into water on the way down: a splash, and it floats
      const b = W.bodyAt(r.x + dx * len, r.z + dz * len);
      if (b && r.vy < 0 && r.y + dy * len <= b.y && r.y >= b.y - 0.05 && b.y - W.groundAt(r.x + dx * len, r.z + dz * len, 0.2, b.y, 0.05) > 0.25 && (!hit || hit.t > (b.y - r.y) / dy - 0.01)) {
        const t = (b.y - r.y) / dy;
        r.x += dx * t; r.z += dz * t; r.y = b.y; r.mode = 'float'; r.vx *= 0.25; r.vz *= 0.25; r.vy = 0;
        this.fx({ k: 'splash', i: r.i, x: r2(r.x), y: r2(r.y), z: r2(r.z) });
        return true;
      }
      if (hit && hit.t <= len + 0.2) {
        const t = Math.max(0, hit.t - 0.2);
        r.x += dx * t; r.y += dy * t; r.z += dz * t;
        const vn = r.vx * hit.nx + r.vy * hit.ny + r.vz * hit.nz;
        if (now - r.hitAt > 150 && sp > 2) { r.hitAt = now; this.fx({ k: 'bump', i: r.i, x: r2(r.x), y: r2(r.y), z: r2(r.z), v: r2(Math.min(1, sp / 10)) }); }
        r.vx -= 1.45 * vn * hit.nx; r.vy -= 1.45 * vn * hit.ny; r.vz -= 1.45 * vn * hit.nz;
        r.vx *= 0.7; r.vz *= 0.7; r.vy *= 0.7;
        left -= t / sp;
        if (hit.ny > 0.7 && Math.hypot(r.vx, r.vy, r.vz) < 1.6) { r.mode = 'rest'; r.y = W.groundAt(r.x, r.z, 0.2, r.y + 0.3, 0.4); r.vx = r.vy = r.vz = 0; return true; }
        continue;
      }
      r.x += dx * len; r.y += dy * len; r.z += dz * len;
      left = 0;
    }
    // round pillars (they are shapes, not grid cells)
    if (W.solid && W.solid(r.x, r.z, 0.3, r.y - 0.15, 0, 0.3)) {
      r.x = x0; r.z = z0; r.vx = -r.vx * 0.5; r.vz = -r.vz * 0.5;
      if (now - r.hitAt > 150) { r.hitAt = now; this.fx({ k: 'bump', i: r.i, x: r2(r.x), y: r2(r.y), z: r2(r.z), v: 0.6 }); }
    }
    // gone out of the building (up a skylight and onto the roof, say): a lost one stays lost
    if (r.y < -5) r.mode = 'lost';
    if (r.y > POOL.ROOF + 0.6 && r.vy <= 0 && W.groundAt(r.x, r.z, 0.2, r.y, 0.1) >= POOL.ROOF) { r.mode = 'lost'; this.fx({ k: 'lost', i: r.i }); }
    return true;
  }

  // everything the players' screens need, small (sent ~10 times a second while things change, else once a second)
  state() {
    return {
      b: this.bridges.map(b => r2(b.up)), pl: this.bridges.map(b => b.pressed.map(o => (o ? 1 : 0))),
      v: this.valves.map(v => r2(v.p)), o: this.valves.map(v => (v.open ? 1 : 0)), h: this.heat.map(r2),
      u: this.unlocked ? 1 : 0, d: r2(this.drainP), lv: r2(this.level), dr: this.drainAt ? 1 : 0,
      r: this.rings.map(r => [r2(r.x), r2(r.y), r2(r.z), r.holder || 0, ['float', 'fly', 'rest', 'held', 'lost'].indexOf(r.mode)]),
    };
  }
}
