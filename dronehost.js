// FPV drones on the host (the host's browser and the home server): who is where, the race (countdown, gates in
// order, laps, places, the finish) and passing everyone's drone on to everyone else. Each player flies their own
// drone on their own screen and sends where it is (~25 times a second); the host checks that a gate someone
// says they passed was really on their way (their last positions came close to it) and in the right order.
import { loadDroneMap, droneKind } from './dronemaps.js';

export const FPV = {
  laps: [1, 2, 3, 5],
  wait: 12,          // s at most to wait for everyone's game to load
  count: 5,          // s of countdown (3, 2, 1 shown at the end)
  tail: 45,          // s the others get to finish after the winner
  near: 6,           // m: a claimed gate must have been this close to their path (plus the gate's own size)
};
const r2 = v => Math.round(v * 100) / 100;

export class DroneHost {
  // cfg: { map, laps }
  constructor(server, cfg) {
    this.s = server;
    this.map = cfg.map;
    this.md = loadDroneMap(cfg.map);
    this.race = droneKind(cfg.map) === 'race' && this.md.gates.length > 0;
    this.laps = FPV.laps.includes(cfg.laps) ? cfg.laps : 3;
    this.ph = this.race ? 'wait' : 'free';
    this.t = 0;              // the race clock (s since GO)
    this.phT = 0;            // s in this phase
    this.slots = {};
    this.racers = new Map(); // id → { n, at, lapAt, best, fin, laps: [] }
    this.done = 0;           // finished so far
    this.firstFin = null;
    this.stateT = 0;
    for (const p of this.humans()) this.join(p, false);
  }
  humans() { return [...this.s.players.values()].filter(p => !p.dummy && !p.bot); }

  // a pad of their own, and (before the countdown) a place in the race
  join(p, late = true) {
    const used = new Set(Object.values(this.slots));
    let k = 0;
    while (used.has(k)) k++;
    this.slots[p.id] = k;
    p.ready = false;
    p.hist = [];
    p.x = this.md.spawns[k % this.md.spawns.length].x; p.y = this.md.spawns[k % this.md.spawns.length].y; p.z = this.md.spawns[k % this.md.spawns.length].z;
    if (this.race) {
      const lateRacer = late && this.ph === 'race';
      this.racers.set(p.id, { n: 0, at: 0, lapAt: 0, best: null, fin: null, laps: [], late: lateRacer, name: p.name });
    }
    this.broadcastState();
  }
  leave(p) {
    delete this.slots[p.id];
    const r = this.racers.get(p.id);
    if (r && r.fin == null) this.racers.delete(p.id);
    this.broadcastState();
    this.check();
  }
  // is everyone (still racing) done? or nobody left?
  check() {
    if (!this.race || this.ph === 'over') return;
    const live = [...this.racers.entries()].filter(([id, r]) => !r.late && this.s.players.has(id));
    if (!this.humans().length) { this.end(); return; }
    if (this.ph === 'race' && live.length && live.every(([, r]) => r.fin != null)) this.later = 2.5;
  }

  msg(p, m) {
    switch (m.t) {
      case 'fpvReady': p.ready = true; return;
      case 'ds': {
        const s = m.s;
        if (!Array.isArray(s) || s.length < 9 || !s.slice(0, 8).every(Number.isFinite)) return;
        const [W, D] = this.md.size;
        p.x = Math.max(-5, Math.min(W + 5, s[0])); p.y = Math.max(-20, Math.min(400, s[1])); p.z = Math.max(-5, Math.min(D + 5, s[2]));
        p.q = [s[3], s[4], s[5], s[6]];
        p.f = Math.max(0, Math.min(100, s[7] | 0));
        p.fl = s[8] | 0;
        const now = performance.now() / 1000;
        p.hist.push([now, p.x, p.y, p.z]);
        while (p.hist.length && p.hist[0][0] < now - 2) p.hist.shift();
        return;
      }
      case 'crash':
        if ([m.x, m.y, m.z].every(Number.isFinite)) this.s.broadcast({ t: 'fpvfx', k: 'crash', id: p.id, x: r2(m.x), y: r2(m.y), z: r2(m.z), w: m.w ? 1 : 0 }, p.id);
        return;
      case 'reset': return;
      case 'gate': return this.gate(p, m.n);
    }
  }

  // a player says they got through their next gate (their count of gates becomes n)
  gate(p, n) {
    const r = this.racers.get(p.id);
    if (!this.race || !r || this.ph !== 'race' || r.fin != null || !Number.isInteger(n)) return;
    if (n !== r.n + 1) { this.s.send(p.id, { t: 'fpvfx', k: 'reject', id: p.id, n: r.n }); return; }
    const G = this.md.gates.length, g = this.md.gates[(n - 1) % G];
    // were they really there? one of their last positions came close to the gate
    const reach = FPV.near + Math.max(g.hw || 0, g.hh || 0, g.rad || 0);
    const ok = p.hist.some(h => Math.hypot(h[1] - g.c[0], h[2] - g.c[1], h[3] - g.c[2]) < reach) || Math.hypot(p.x - g.c[0], p.y - g.c[1], p.z - g.c[2]) < reach;
    if (!ok) { this.s.send(p.id, { t: 'fpvfx', k: 'reject', id: p.id, n: r.n }); return; }
    const at = Math.max(0, this.t - Math.min(0.25, (p.ping || 0) / 2000));
    r.n = n; r.at = at;
    if (n > 1 && (n - 1) % G === 0) {
      const lap = (n - 1) / G, time = at - r.lapAt;
      const best = r.best == null || time < r.best;
      r.laps.push(time); r.lapAt = at;
      if (best) r.best = time;
      this.s.broadcast({ t: 'fpvfx', k: 'lap', id: p.id, lap, time: r2(time), best: best ? 1 : 0 });
      if (lap >= this.laps && !r.late) {
        r.fin = at;
        this.done++;
        const pos = this.order().filter(([, q]) => q.fin != null).length;
        this.s.broadcast({ t: 'fpvfx', k: 'finish', id: p.id, pos, time: r2(at) });
        if (this.firstFin == null) {
          this.firstFin = this.t;
          if ([...this.racers.values()].filter(q => !q.late).length > 1) this.s.broadcast({ t: 'fpvfx', k: 'ends', s: FPV.tail });
        }
      }
    }
    this.broadcastState();
    this.check();
  }

  // places: finished first (by time), then the most gates, then who got there first
  order() {
    return [...this.racers.entries()].sort(([, a], [, b]) => {
      if (a.late !== b.late) return a.late ? 1 : -1;
      if ((a.fin != null) !== (b.fin != null)) return a.fin != null ? -1 : 1;
      if (a.fin != null) return a.fin - b.fin;
      return b.n - a.n || a.at - b.at;
    });
  }
  state() {
    return {
      ph: this.ph, t: r2(this.t), cd: this.ph === 'count' ? r2(Math.max(0, FPV.count - this.phT)) : 0, laps: this.laps,
      race: this.race ? 1 : 0, slots: this.slots,
      racers: this.order().map(([id, r]) => [id, r.n, r.fin != null ? r2(r.fin) : null, r.best != null ? r2(r.best) : null, r.late ? 1 : 0]),
    };
  }
  broadcastState() { this.stateT = 0; this.s.broadcast({ t: 'fpv', s: this.state() }); }

  tick(dt) {
    this.phT += dt;
    if (this.ph === 'race') this.t += dt;
    if (this.ph === 'wait' && (this.humans().every(p => p.ready) || this.phT > FPV.wait)) { this.ph = 'count'; this.phT = 0; this.broadcastState(); }
    else if (this.ph === 'count' && this.phT >= FPV.count) {
      this.ph = 'race'; this.phT = 0; this.t = 0;
      for (const r of this.racers.values()) { r.lapAt = 0; r.n = 0; r.at = 0; }
      this.broadcastState();
    } else if (this.ph === 'race') {
      if (this.firstFin != null && this.t - this.firstFin > FPV.tail) this.end();
      if (this.later != null) { this.later -= dt; if (this.later <= 0) { this.later = null; this.end(); } }
    }
    // everyone's drones to everyone, and the race state now and then (for anyone who missed a change)
    this.stateT += dt;
    if (this.stateT > 1) this.broadcastState();
    this.snapshot();
  }
  snapshot() {
    const d = [];
    for (const p of this.s.players.values()) {
      if (p.dummy || p.bot || !p.q) continue;
      d.push([p.id, r2(p.x), r2(p.y), r2(p.z), p.q[0], p.q[1], p.q[2], p.q[3], p.f | 0, p.fl | 0]);
    }
    if (d.length) this.s.broadcast({ t: 'dsnap', d });
  }

  // the results (the race), or nothing to report (free flight ended by the host)
  results() {
    let pos = 0;
    return this.order().map(([id, r]) => {
      const p = this.s.players.get(id);
      return { id, name: p ? p.name : r.name, pos: r.late ? null : ++pos, time: r.fin != null ? r2(r.fin) : null, best: r.best != null ? r2(r.best) : null, gates: r.n, laps: r.laps.map(r2), late: r.late ? 1 : 0, left: p ? 0 : 1 };
    });
  }
  end() {
    if (this.ph === 'over') return;
    this.ph = 'over';
    this.s.fpvOver(this.race ? this.results() : null);
  }
}
