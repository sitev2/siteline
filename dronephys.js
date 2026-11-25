// FPV drones: the flight model and collisions. No three.js here: the host, every player's game and the
// automated checks (check_drones.mjs) all use the same sums.
//
// A drone is a sphere (DRONE.r) with an orientation (quaternion [x, y, z, w]; forward = -Z, up = +Y, right = +X,
// like the camera), a velocity and a thrust that pushes along its own up axis. Three ways to fly (FLIGHT):
//   easy  — "Casual": self-levelling, holds its height and stops when let go (W/S forward/back, A/D sideways, mouse turns,
//           Space/Shift up/down)
//   angle — self-levelling, but you hold the throttle yourself (like a real drone in "angle" mode)
//   acro  — the real thing: the sticks turn the drone and it stays where you leave it; throttle is all yours
// Hitting something hard (DRONE.crash m/s straight into it) or touching water crashes it; a glancing hit only bounces.
import { CELL } from './world.js';

// Tuned to feel like the heavy FPV drone in the game Bodycam (owner's request, v3.1): a drone carrying a load, about
// twice its weight in thrust, so it hovers near half throttle (the middle of the stick), carries its speed, slides in
// turns, and its turning builds up over a moment instead of snapping. (The first version was a light racing quad: 4 g.)
export const DRONE = {
  r: 0.17,          // collision radius (m): a 5-inch quad with its props
  g: 9.81,
  thrust: 19.9,     // m/s² at full throttle (≈ 2 g): hovers at about half throttle
  drag1: 0.04,      // linear drag (1/s)
  drag2: 0.012,     // quadratic drag (1/m): about 27 m/s (≈ 97 km/h) flat out holding its height; it coasts a long way
  dragUp: 0.02,     // extra drag along its own up axis (the props' disc): a little grip in a turn, it still slides
  crash: 7,         // m/s straight into a surface breaks it
  bounce: 0.3,
  spool: 0.05,      // how fast the motors follow the throttle (s)
  rateLag: 0.035,   // how fast its turning follows the sticks in Acro (s): it has some weight
  hover: 9.81 / 19.9,
};
// The throttle stick → the motors (Angle and Acro), like a real drone's (and Bodycam's) Throttle Mid and Expo: the curve
// passes through (mid, mid) and is flatter round it, so small moves near the middle (about a hover) are gentle.
export const THROTTLE = { mid: 0.5, expo: 0.35 };
export function throttleCurve(t, mid = THROTTLE.mid, expo = THROTTLE.expo) {
  t = clamp(t, 0, 1); mid = clamp(mid, 0.05, 0.95); expo = clamp(expo, 0, 1);
  const dx = t - mid, n = dx / (dx > 0 ? 1 - mid : mid);
  return clamp(mid + dx * (1 - expo + expo * n * n), 0, 1);
}

export const FLIGHT = {
  easy: { level: true, tilt: 0.7, yaw: 2.2, snap: 7.5, climb: 6, speed: 20, side: 12, brake: 1.5 },     // (Casual: the beginners' mode, it holds its place)
  angle: { level: true, tilt: 0.95, yaw: 2.6, snap: 8 },
  acro: { level: false, rate: 600 * Math.PI / 180, yaw: 5, expo: 0.55 },     // (rate and expo: Settings → Drones can change them)
};
// ('easy' is shown as "Casual", Bodycam's name for its self-levelling mode; the settings keep the key 'easy')
export const FLIGHT_NAMES = { easy: 'Casual', angle: 'Angle', acro: 'Acro' };

// ---------- quaternion helpers ([x, y, z, w]) ----------
export function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function qnorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
export function qaxis(x, y, z, a) { const s = Math.sin(a / 2); return [x * s, y * s, z * s, Math.cos(a / 2)]; }
// rotate vector v by q
export function qrot(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
export function qslerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (c > 0.9995) return qnorm([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  const th = Math.acos(c), s = Math.sin(th), k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
  return [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
}
// yaw (about +Y), then pitch (about +X, + = nose up), then roll (about +Z, + = left side down): three.js 'YXZ'
export function qypr(yaw, pitch, roll) {
  return qmul(qmul(qaxis(0, 1, 0, yaw), qaxis(1, 0, 0, pitch)), qaxis(0, 0, 1, roll));
}
// the compass heading of a direction (0 = towards -Z, like a player's yaw)
export const headingOf = (f) => Math.atan2(-f[0], -f[2]);
export function droneHeading(q) {
  const f = qrot(q, [0, 0, -1]);
  if (Math.hypot(f[0], f[2]) > 0.2) return headingOf(f);
  const u = qrot(q, [0, 1, 0]);          // nose straight up or down: the top of the drone points the way
  return headingOf(f[1] < 0 ? u : [-u[0], -u[1], -u[2]]);
}

// ---------- the drone ----------
export function makeDrone(x = 0, y = 0, z = 0, yaw = 0) {
  return { p: [x, y, z], v: [0, 0, 0], q: qaxis(0, 1, 0, yaw), w: [0, 0, 0], f: 0, hd: yaw, armed: false, crashed: 0, ground: false, air: false, spin: 0 };
}

// a stick's curve: fine near the middle, full rate at the end
const curve = (s, expo) => s * (1 - expo + expo * s * s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// One step of flight. inp: { thr, yaw, pitch, roll } sticks (-1…1; thr 0…1, or -1…1 = climb rate in easy mode),
// dYaw / dPitch / dRoll = direct turns from the mouse (radians), lock = may not take off (race countdown).
// col: a collider (MapCollider / GridCollider). t: the game clock (spinning things). Returns events:
// { crash: { speed, water, x, y, z } , bump: speed }
export function stepDrone(d, inp, dt, mode, col, t = 0) {
  const F = FLIGHT[mode] || FLIGHT.easy, D = DRONE, ev = {};
  dt = Math.min(dt, 0.05);
  // orientation (not while crashed: it tumbles)
  if (!d.crashed) {
    if (F.level) {
      d.hd -= ((inp.yaw || 0) * F.yaw * dt) + (inp.dYaw || 0);
      if (d.hd > Math.PI) d.hd -= Math.PI * 2; else if (d.hd < -Math.PI) d.hd += Math.PI * 2;
      let tp = (inp.pitch || 0) * F.tilt, tr = (inp.roll || 0) * F.tilt;
      if (F.speed) {
        // Casual: the sticks ask for a speed (forward / sideways); it tilts to get there, and to stop when let go
        const fx = -Math.sin(d.hd), fz = -Math.cos(d.hd), rx = Math.cos(d.hd), rz = -Math.sin(d.hd);
        const vf = d.v[0] * fx + d.v[2] * fz, vr = d.v[0] * rx + d.v[2] * rz;
        const af = ((inp.pitch || 0) * F.speed - vf) * F.brake, ar = ((inp.roll || 0) * F.side - vr) * F.brake;
        tp = clamp(Math.atan(af / D.g), -F.tilt, F.tilt); tr = clamp(Math.atan(ar / D.g), -F.tilt, F.tilt);
      }
      const tgt = d.ground && !d.air ? qaxis(0, 1, 0, d.hd) : qypr(d.hd, -tp, -tr);
      d.q = qslerp(d.q, tgt, 1 - Math.exp(-F.snap * dt));
      d.w = [0, 0, 0];
    } else {
      // the sticks set how fast it turns; it gets there over a moment (it has weight) and keeps its attitude when let go
      const rate = inp.rate || F.rate, expo = inp.expo ?? F.expo;
      const rx = -curve(inp.pitch || 0, expo) * rate, ry = -(inp.yaw || 0) * F.yaw, rz = -curve(inp.roll || 0, expo) * rate;
      const k = 1 - Math.exp(-dt / D.rateLag);
      d.w = [d.w[0] + (rx - d.w[0]) * k, d.w[1] + (ry - d.w[1]) * k, d.w[2] + (rz - d.w[2]) * k];
      const ax = d.w[0] * dt - (inp.dPitch || 0), ay = d.w[1] * dt - (inp.dYaw || 0), az = d.w[2] * dt - (inp.dRoll || 0);
      const a = Math.hypot(ax, ay, az);
      if (a > 1e-7) d.q = qnorm(qmul(d.q, qaxis(ax / a, ay / a, az / a, a)));
      d.hd = droneHeading(d.q);
    }
  } else if (d.w[0] || d.w[1] || d.w[2]) {
    const a = Math.hypot(d.w[0], d.w[1], d.w[2]) * dt;
    if (a > 1e-7) { const n = Math.hypot(d.w[0], d.w[1], d.w[2]); d.q = qnorm(qmul(d.q, qaxis(d.w[0] / n, d.w[1] / n, d.w[2] / n, a))); }
    const k = Math.exp(-(d.ground ? 6 : 0.6) * dt);
    d.w = [d.w[0] * k, d.w[1] * k, d.w[2] * k];
  }
  const up = qrot(d.q, [0, 1, 0]);
  // throttle → thrust
  let want = 0;
  if (!d.crashed && !inp.lock) {
    if (mode === 'easy') {
      const thr = clamp(inp.thr || 0, -1, 1);
      if (thr > 0.08) d.air = true;
      if (d.air || !d.ground) {
        const vy = thr * F.climb, need = (D.g + 5 * (vy - d.v[1])) / Math.max(0.4, up[1]) / D.thrust;
        want = clamp(need, 0, 1);
      }
      if (d.ground && thr <= 0.02 && d.v[1] <= 0.5) { d.air = false; want = 0; }
    } else {
      const stick = clamp(inp.thr || 0, 0, 1);
      want = throttleCurve(stick, inp.mid, inp.texpo);
      if (stick > 0.04) d.air = true;
      else if (d.ground) d.air = false;
    }
    d.armed = want > 0.02 || d.air;
  }
  d.f += (want - d.f) * (1 - Math.exp(-dt / D.spool));
  if (d.crashed) d.f = 0;
  // turtle mode: upside down on the ground, any stick flips it back over
  if (!d.crashed && d.ground && up[1] < 0.3 && ((inp.thr || 0) > 0.2 || Math.abs(inp.roll || 0) + Math.abs(inp.pitch || 0) > 0.4)) {
    let ax = [-up[2], 0, up[0]], l = Math.hypot(ax[0], ax[2]);      // (up × world up: turns its top towards the sky)
    if (l < 0.05) { const f = qrot(d.q, [0, 0, -1]); ax = [f[0], 0, f[2]]; l = Math.hypot(ax[0], ax[2]) || 1; }
    const turn = qaxis(ax[0] / l, 0, ax[2] / l, 3.2 * dt);
    d.q = qnorm(qmul(turn, d.q));
    if (mode !== 'acro') d.hd = droneHeading(d.q);
  }
  // forces, in small steps (fast drones and thin bars)
  const speed = Math.hypot(d.v[0], d.v[1], d.v[2]);
  const n = Math.max(1, Math.ceil((speed * dt) / 0.12));
  const h = dt / n;
  d.ground = false;
  for (let i = 0; i < n; i++) {
    const v = d.v, s = Math.hypot(v[0], v[1], v[2]);
    const T = d.f * D.thrust;
    const vu = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
    const ax = up[0] * T - v[0] * (D.drag1 + D.drag2 * s) - up[0] * D.dragUp * vu * Math.abs(vu);
    const ay = up[1] * T - D.g - v[1] * (D.drag1 + D.drag2 * s) - up[1] * D.dragUp * vu * Math.abs(vu);
    const az = up[2] * T - v[2] * (D.drag1 + D.drag2 * s) - up[2] * D.dragUp * vu * Math.abs(vu);
    v[0] += ax * h; v[1] += ay * h; v[2] += az * h;
    d.p[0] += v[0] * h; d.p[1] += v[1] * h; d.p[2] += v[2] * h;
    if (!col) continue;
    for (let k = 0; k < 4; k++) {
      const c = col.contact(d.p[0], d.p[1], d.p[2], D.r, t);
      if (!c) break;
      if (c.water) {
        if (!d.crashed) { ev.crash = { speed: s, water: true, x: d.p[0], y: d.p[1], z: d.p[2] }; crash(d, 0.5); }
        // in the water: it sinks a little and stops
        d.p[1] = Math.max(d.p[1], c.water - D.r * 0.6);
        v[0] *= 0.8; v[1] = Math.max(v[1] * 0.5, -0.3); v[2] *= 0.8;
        d.ground = true;
        break;
      }
      d.p[0] += c.n[0] * c.d; d.p[1] += c.n[1] * c.d; d.p[2] += c.n[2] * c.d;
      const vn = v[0] * c.n[0] + v[1] * c.n[1] + v[2] * c.n[2];
      if (vn < 0) {
        if (-vn > D.crash && !d.crashed && !c.soft) { ev.crash = { speed: -vn, x: d.p[0], y: d.p[1], z: d.p[2] }; crash(d, -vn); }
        else if (-vn > 1.5) ev.bump = Math.max(ev.bump || 0, -vn);
        const e = d.crashed ? 0.35 : D.bounce;
        v[0] -= c.n[0] * vn * (1 + e); v[1] -= c.n[1] * vn * (1 + e); v[2] -= c.n[2] * vn * (1 + e);
        // rubbing along it slows it a little
        const fr = d.crashed ? 0.25 : 0.06;
        const vn2 = v[0] * c.n[0] + v[1] * c.n[1] + v[2] * c.n[2];
        v[0] = c.n[0] * vn2 + (v[0] - c.n[0] * vn2) * (1 - fr); v[1] = c.n[1] * vn2 + (v[1] - c.n[1] * vn2) * (1 - fr); v[2] = c.n[2] * vn2 + (v[2] - c.n[2] * vn2) * (1 - fr);
      }
      if (c.n[1] > 0.55) d.ground = true;
    }
  }
  // sitting on the ground with the motors off: it stays put
  if (d.ground && d.f < D.hover * 0.6) {
    const k = Math.exp(-10 * dt);
    d.v[0] *= k; d.v[2] *= k;
    if (Math.abs(d.v[1]) < 0.3) d.v[1] = 0;
  }
  d.spin = (d.spin + (0.3 + d.f * 6) * dt * 40) % (Math.PI * 2);
  return ev;
}

function crash(d, speed) {
  d.crashed = 1e-3;
  d.armed = false;
  d.air = false;
  const s = Math.min(14, 3 + speed * 0.8);
  d.w = [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s];
}

// ---------- gates ----------
// A gate's opening: c centre, n the way through it, u its right and v its up axis (both across the opening),
// hw / hh half its width and height, or rad for a ring, or arch (half an ellipse standing on the bottom edge).
export function gateFrame(yaw, pitch) {
  const cp = Math.cos(pitch);
  const n = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  const u = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const v = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
  return { n, u, v };
}
// where (and whether) the straight line a → b went through gate g, front to back. margin: a little leeway (m)
export function gateCross(g, a, b, margin = 0) {
  const da = (a[0] - g.c[0]) * g.n[0] + (a[1] - g.c[1]) * g.n[1] + (a[2] - g.c[2]) * g.n[2];
  const db = (b[0] - g.c[0]) * g.n[0] + (b[1] - g.c[1]) * g.n[1] + (b[2] - g.c[2]) * g.n[2];
  if (!(da < 0 && db >= 0)) return false;
  const t = da / (da - db);
  const px = a[0] + (b[0] - a[0]) * t - g.c[0], py = a[1] + (b[1] - a[1]) * t - g.c[1], pz = a[2] + (b[2] - a[2]) * t - g.c[2];
  const x = px * g.u[0] + py * g.u[1] + pz * g.u[2], y = px * g.v[0] + py * g.v[1] + pz * g.v[2];
  if (g.rad) return Math.hypot(x, y) <= g.rad + margin;
  if (g.arch) return y >= -g.hh - margin && (x / (g.hw + margin)) ** 2 + (Math.max(0, y + g.hh) / (2 * g.hh + margin)) ** 2 <= 1;
  return Math.abs(x) <= g.hw + margin && Math.abs(y) <= g.hh + margin;
}

// ---------- colliders ----------
// The drone maps (dronemaps.js): boxes turned about Y, upright cylinders and cones, capsules (any slope), spheres,
// a height field for the ground, water, the map's edges and ceiling, and spinning rotor blades.
const BUCKET = 8;
export class MapCollider {
  constructor(m) {
    this.m = m;
    this.W = m.size[0]; this.D = m.size[1]; this.ceil = m.ceil || 100;
    this.bw = Math.ceil(this.W / BUCKET) + 1; this.bd = Math.ceil(this.D / BUCKET) + 1;
    this.buckets = new Array(this.bw * this.bd);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
    for (const s of m.solids) {
      if (s.nocol) continue;
      const b = bounds(s);
      s.bb = b;
      const x0 = Math.max(0, Math.floor(b[0] / BUCKET)), x1 = Math.min(this.bw - 1, Math.floor(b[3] / BUCKET));
      const z0 = Math.max(0, Math.floor(b[2] / BUCKET)), z1 = Math.min(this.bd - 1, Math.floor(b[5] / BUCKET));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.buckets[z * this.bw + x].push(s);
    }
    this.stamp = 0;
  }
  heightAt(x, z) { return this.m.ground ? groundHeight(this.m.ground, x, z) : 0; }
  waterAt(x, z) {
    for (const w of this.m.waters || []) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && this.heightAt(x, z) < w.y) return w.y;
    return null;
  }
  // the deepest overlap of a sphere with anything solid: { n: push-out direction, d: how far } (or { water: level })
  contact(x, y, z, r, t = 0) {
    let best = null;
    const take = (nx, ny, nz, d, soft) => { if (d > 0 && (!best || d > best.d)) best = { n: [nx, ny, nz], d, soft }; };
    // the ground
    const gh = this.heightAt(x, z);
    if (y - r < gh + 0.6) {
      const w = this.waterAt(x, z);
      if (w != null && y - r < w) return { water: w };
      if (y - r < gh) {
        const e = 0.5, gx = this.heightAt(x + e, z) - this.heightAt(x - e, z), gz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
        const nx = -gx / (2 * e), nz = -gz / (2 * e), l = Math.hypot(nx, 1, nz);
        take(nx / l, 1 / l, nz / l, (gh + r - y) / l);
      }
    }
    // the edges of the map and the ceiling (soft: no crash, just a wall)
    if (x < r) take(1, 0, 0, r - x, true);
    if (x > this.W - r) take(-1, 0, 0, x - (this.W - r), true);
    if (z < r) take(0, 0, 1, r - z, true);
    if (z > this.D - r) take(0, 0, -1, z - (this.D - r), true);
    if (y > this.ceil - r) take(0, -1, 0, y - (this.ceil - r), !this.m.hardCeil);
    // solids nearby
    const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
    this.stamp++;
    for (let zz = bz - 1; zz <= bz + 1; zz++) {
      if (zz < 0 || zz >= this.bd) continue;
      for (let xx = bx - 1; xx <= bx + 1; xx++) {
        if (xx < 0 || xx >= this.bw) continue;
        for (const s of this.buckets[zz * this.bw + xx]) {
          if (s.seen === this.stamp) continue;
          s.seen = this.stamp;
          const b = s.bb;
          if (x + r < b[0] || x - r > b[3] || y + r < b[1] || y - r > b[4] || z + r < b[2] || z - r > b[5]) continue;
          const c = solidContact(s, x, y, z, r);
          if (c) take(c[0], c[1], c[2], c[3]);
        }
      }
    }
    // spinning rotor blades (wind turbines): where they are depends on the clock
    for (const ro of this.m.rotors || []) {
      if (Math.abs(x - ro.x) > ro.len + 2 || Math.abs(z - ro.z) > ro.len + 2 || Math.abs(y - ro.y) > ro.len + 2) continue;
      for (const seg of rotorBlades(ro, t)) { const c = capsuleContact(seg[0], seg[1], seg[2], x, y, z, r); if (c) take(c[0], c[1], c[2], c[3]); }
    }
    return best;
  }
  // is a point (with radius r) clear of everything? (the checks)
  free(x, y, z, r) { const c = this.contact(x, y, z, r); return !c || (c.d !== undefined && c.d < 1e-4); }
}

// the three blades of a rotor at time t: [a, b, radius]
export function rotorBlades(ro, t) {
  const out = [], ang = t * ro.speed, fx = -Math.sin(ro.yaw), fz = -Math.cos(ro.yaw), rx = Math.cos(ro.yaw), rz = -Math.sin(ro.yaw);
  for (let k = 0; k < 3; k++) {
    const a = ang + k * Math.PI * 2 / 3, cx = Math.cos(a), cy = Math.sin(a);
    const hub = [ro.x + fx * (ro.hub || 0.6), ro.y, ro.z + fz * (ro.hub || 0.6)];
    out.push([hub, [hub[0] + rx * cx * ro.len, hub[1] + cy * ro.len, hub[2] + rz * cx * ro.len], 0.5]);
  }
  return out;
}

function bounds(s) {
  if (s.t === 'box') {
    const c = Math.abs(Math.cos(s.ry || 0)), sn = Math.abs(Math.sin(s.ry || 0));
    const hx = (s.sx * c + s.sz * sn) / 2, hz = (s.sx * sn + s.sz * c) / 2;
    return [s.x - hx, s.y - s.sy / 2, s.z - hz, s.x + hx, s.y + s.sy / 2, s.z + hz];
  }
  if (s.t === 'cyl' || s.t === 'cone') return [s.x - s.r, s.y0, s.z - s.r, s.x + s.r, s.y1, s.z + s.r];
  if (s.t === 'sph') return [s.x - s.r, s.y - s.r, s.z - s.r, s.x + s.r, s.y + s.r, s.z + s.r];
  // capsule
  return [Math.min(s.a[0], s.b[0]) - s.r, Math.min(s.a[1], s.b[1]) - s.r, Math.min(s.a[2], s.b[2]) - s.r,
    Math.max(s.a[0], s.b[0]) + s.r, Math.max(s.a[1], s.b[1]) + s.r, Math.max(s.a[2], s.b[2]) + s.r];
}

// sphere (x, y, z, r) against one solid: [nx, ny, nz, depth] or null
function solidContact(s, x, y, z, r) {
  if (s.t === 'box') {
    const c = Math.cos(s.ry || 0), sn = Math.sin(s.ry || 0);
    const dx = x - s.x, dz = z - s.z;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c, ly = y - s.y;   // into the box's own axes
    const hx = s.sx / 2, hy = s.sy / 2, hz = s.sz / 2;
    const qx = clamp(lx, -hx, hx), qy = clamp(ly, -hy, hy), qz = clamp(lz, -hz, hz);
    let ox = lx - qx, oy = ly - qy, oz = lz - qz, dist = Math.hypot(ox, oy, oz), depth;
    if (dist > 1e-6) {
      if (dist >= r) return null;
      ox /= dist; oy /= dist; oz /= dist; depth = r - dist;
    } else {
      // the middle is inside: out through the nearest face
      const px = hx - Math.abs(lx), py = hy - Math.abs(ly), pz = hz - Math.abs(lz);
      if (px <= py && px <= pz) { ox = Math.sign(lx) || 1; oy = 0; oz = 0; depth = px + r; }
      else if (py <= pz) { ox = 0; oy = Math.sign(ly) || 1; oz = 0; depth = py + r; }
      else { ox = 0; oy = 0; oz = Math.sign(lz) || 1; depth = pz + r; }
    }
    // back to the world's axes
    return [ox * c + oz * sn, oy, -ox * sn + oz * c, depth];
  }
  if (s.t === 'cyl' || s.t === 'cone') {
    const dx = x - s.x, dz = z - s.z, dh = Math.hypot(dx, dz);
    const rad = s.t === 'cone' ? s.r * clamp((s.y1 - y) / (s.y1 - s.y0), 0, 1) : s.r;
    const top = s.y1, bot = s.y0;
    if (y - r > top || y + r < bot) return null;
    // closest point on the cylinder (cone: treated as a stack of rings)
    const qy = clamp(y, bot, top), qr = Math.min(dh, rad);
    const nx = dh > 1e-6 ? dx / dh : 1, nz = dh > 1e-6 ? dz / dh : 0;
    let ox = (dh - qr) * nx, oy = y - qy, oz = (dh - qr) * nz;
    const dist = Math.hypot(ox, oy, oz);
    if (dist > 1e-6) { if (dist >= r) return null; return [ox / dist, oy / dist, oz / dist, r - dist]; }
    const side = rad - dh, upD = top - y, dnD = y - bot;
    if (side <= upD && side <= dnD) return [nx, 0, nz, side + r];
    return upD < dnD ? [0, 1, 0, upD + r] : [0, -1, 0, dnD + r];
  }
  if (s.t === 'sph') {
    const dx = x - s.x, dy = y - s.y, dz = z - s.z, dist = Math.hypot(dx, dy, dz);
    if (dist >= s.r + r) return null;
    if (dist < 1e-6) return [0, 1, 0, s.r + r];
    return [dx / dist, dy / dist, dz / dist, s.r + r - dist];
  }
  return capsuleContact(s.a, s.b, s.r, x, y, z, r);
}
function capsuleContact(a, b, cr, x, y, z, r) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz;
  const t = l2 > 1e-9 ? clamp(((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / l2, 0, 1) : 0;
  const dx = x - (a[0] + abx * t), dy = y - (a[1] + aby * t), dz = z - (a[2] + abz * t);
  const dist = Math.hypot(dx, dy, dz);
  if (dist >= cr + r) return null;
  if (dist < 1e-6) return [0, 1, 0, cr + r];
  return [dx / dist, dy / dist, dz / dist, cr + r - dist];
}

export function groundHeight(g, x, z) {
  const fx = clamp(x / g.res, 0, g.nx - 1.001), fz = clamp(z / g.res, 0, g.nz - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const h = g.h, n = g.nx, i = iz * n + ix;
  return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - tz) + (h[i + n] * (1 - tx) + h[i + n + 1] * tx) * tz;
}

// The game's other maps (world.js grid of spans): every span is an upright box one cell wide.
export class GridCollider {
  constructor(world, ceil = 40) {
    this.w = world;
    this.W = world.width; this.D = world.depth;
    // the highest thing on the map + some sky (indoor maps have their own ceilings in the spans)
    let top = 0;
    for (const list of world.spans) for (const s of list) if (s.m !== 'mass' && s.y1 > top) top = s.y1;
    this.ceil = Math.max(ceil, top + 18);
    this.m = { waters: [] };
  }
  heightAt() { return 0; }
  waterAt(x, z) { const w = this.w.waterAt(x, z); return w > 0 ? w : null; }
  contact(x, y, z, r) {
    let best = null;
    const take = (nx, ny, nz, d, soft) => { if (d > 0 && (!best || d > best.d)) best = { n: [nx, ny, nz], d, soft }; };
    const w = this.waterAt(x, z);
    if (w != null && y - r < w && y > w - 3) return { water: w };
    // the floor (not over a hole in it)
    if (y - r < 0 && !(this.w.pitGrid && this.w.isPit(x, z))) take(0, 1, 0, r - y);
    if (y > this.ceil - r) take(0, -1, 0, y - (this.ceil - r), true);
    if (x < r) take(1, 0, 0, r - x, true);
    if (x > this.W - r) take(-1, 0, 0, x - (this.W - r), true);
    if (z < r) take(0, 0, 1, r - z, true);
    if (z > this.D - r) take(0, 0, -1, z - (this.D - r), true);
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const spans = this.w.cellSpans(ix, iz);
        const bx0 = ix * CELL, bz0 = iz * CELL;
        for (const s of spans) {
          if (s.y1 < y - r || s.y0 > y + r) continue;
          // closest point of this cell's span to the middle of the drone
          const qx = clamp(x, bx0, bx0 + CELL), qy = clamp(y, s.y0, s.y1), qz = clamp(z, bz0, bz0 + CELL);
          let ox = x - qx, oy = y - qy, oz = z - qz;
          const dist = Math.hypot(ox, oy, oz);
          if (dist > 1e-6) { if (dist < r) take(ox / dist, oy / dist, oz / dist, r - dist); continue; }
          // inside it: out the nearest way (up out of a floor, sideways out of a wall)
          const dxn = x - bx0, dxp = bx0 + CELL - x, dzn = z - bz0, dzp = bz0 + CELL - z, dyu = s.y1 - y, dyd = y - s.y0;
          const m = Math.min(dxn, dxp, dzn, dzp, dyu, dyd);
          if (m === dyu) take(0, 1, 0, dyu + r); else if (m === dyd) take(0, -1, 0, dyd + r);
          else if (m === dxn) take(-1, 0, 0, dxn + r); else if (m === dxp) take(1, 0, 0, dxp + r);
          else if (m === dzn) take(0, 0, -1, dzn + r); else take(0, 0, 1, dzp + r);
        }
      }
    }
    // round pillars, curved pool sides… (the map's own test): push back the way it is most open
    if (this.w.solid && this.w.solid(x, z, r, y - r, 0, 2 * r)) {
      let nx = 0, ny = 0, nz = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
        if (!this.w.solid(x + dx * r * 1.5, z + dz * r * 1.5, r, y - r + dy * r * 1.5, 0, 2 * r)) { nx += dx; ny += dy; nz += dz; }
      }
      const l = Math.hypot(nx, ny, nz);
      if (l > 0) take(nx / l, ny / l, nz / l, r * 0.5);
    }
    return best;
  }
  free(x, y, z, r) { const c = this.contact(x, y, z, r); return !c || (c.d !== undefined && c.d < 1e-4); }
}
