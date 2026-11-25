// Checks FPV drones with no graphics, on the real code (dronemaps.js, dronephys.js, dronehost.js, server.js):
//   - every drone map and every other map of the game: enough launch pads, each one clear, and a drone left on its
//     pad stays there; on the drone maps there is room to take off above every pad;
//   - the circuits: every gate's opening is clear, there is room before and after it, and there is a way to fly from
//     each gate to the next (a 3D search through the air with room to spare), and from the pads to the first gate;
//   - the flight model: Easy holds its height and levels itself, a hard landing or flying into a wall breaks the
//     drone, a soft one doesn't, water breaks it, Acro turns at its rate and keeps its attitude, turtle mode flips it back;
//   - the race on the real host code with pretend pilots flying the routes: the countdown, gates in order (a gate out
//     of order or far from their path is turned down), laps, best laps, places, the finish, the others' 45 s, someone
//     who joins during a race flies but isn't placed, someone leaving; free flight never ends by itself and the room's
//     leader can end it; the room takes 6; the mode only with the host game's say-so (fpvOk).
// Usage: node check_drones.mjs            (everything)
//        node check_drones.mjs quick      (skips the slow route searches on the big maps)
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const { loadDroneMap, DRONE_MAPS, existingMaps, spawnFor, gateRespawn } = await import('./dronemaps.js');
const { makeDrone, stepDrone, DRONE, gateCross, qaxis, qrot, qypr, throttleCurve } = await import('./dronephys.js');
const { FPV } = await import('./dronehost.js');
const { RULES } = await import('./config.js');

const quick = process.argv.includes('quick');
let bad = 0, checks = 0;
const ok = (c, t) => { checks++; if (!c) { bad++; console.log('  FAIL', t); } };
const ids = [...Object.keys(DRONE_MAPS), ...existingMaps().map(e => e.id)];

// ---------- pads ----------
for (const id of ids) {
  const md = loadDroneMap(id);
  ok(md.spawns.length >= RULES.fpv.maxPlayers, `${id}: only ${md.spawns.length} launch pads`);
  md.spawns.forEach((s, i) => {
    ok(md.col.free(s.x, s.y, s.z, DRONE.r), `${id}: pad ${i} (${s.x.toFixed(1)}, ${s.y.toFixed(2)}, ${s.z.toFixed(1)}) is blocked`);
    for (let k = 0; k < i; k++) ok(Math.hypot(md.spawns[k].x - s.x, md.spawns[k].z - s.z) > 1.1, `${id}: pads ${k} and ${i} overlap`);
    const d = makeDrone(s.x, s.y, s.z, s.yaw);
    let crash = false;
    for (let t = 0; t < 2; t += 1 / 60) if (stepDrone(d, { thr: 0 }, 1 / 60, 'easy', md.col, t).crash) crash = true;
    ok(!crash && Math.hypot(d.p[0] - s.x, d.p[2] - s.z) < 0.3 && Math.abs(d.p[1] - s.y) < 0.3, `${id}: a drone left on pad ${i} doesn't stay put (${d.p.map(v => v.toFixed(2))})`);
    if (md.map) for (let h = 0.5; h < 5; h += 0.5) ok(md.col.free(s.x, s.y + h, s.z, 0.3), `${id}: no room to take off above pad ${i} (at ${h} m)`);
  });
}

// ---------- the circuits ----------
// a way through the air from a to b (1.5 m steps, keeping `clr` from everything): the list of points, or null
function route(md, a, b, clr = 0.45, vox = 1.5) {
  const col = md.col, W = md.size[0], D = md.size[1], margin = 34;
  const x0 = Math.max(0.5, Math.min(a[0], b[0]) - margin), x1 = Math.min(W - 0.5, Math.max(a[0], b[0]) + margin);
  const z0 = Math.max(0.5, Math.min(a[2], b[2]) - margin), z1 = Math.min(D - 0.5, Math.max(a[2], b[2]) + margin);
  let gmin = Infinity;
  for (let x = x0; x <= x1; x += 4) for (let z = z0; z <= z1; z += 4) gmin = Math.min(gmin, col.heightAt(x, z));
  const y0 = Math.min(gmin, a[1], b[1]) - 1, y1 = Math.min(col.ceil - 0.5, Math.max(a[1], b[1]) + 30);
  const nx = Math.ceil((x1 - x0) / vox) + 1, ny = Math.ceil((y1 - y0) / vox) + 1, nz = Math.ceil((z1 - z0) / vox) + 1;
  const cell = (p) => [Math.round((p[0] - x0) / vox), Math.round((p[1] - y0) / vox), Math.round((p[2] - z0) / vox)];
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  const pos = (i, j, k) => [x0 + i * vox, y0 + j * vox, z0 + k * vox];
  const state = new Int8Array(nx * ny * nz), from = new Int32Array(nx * ny * nz).fill(-1);
  const free = (i, j, k) => { const n = idx(i, j, k); if (!state[n]) { const p = pos(i, j, k); state[n] = col.free(p[0], p[1], p[2], clr) ? 1 : 2; } return state[n] === 1; };
  const s = cell(a), e = cell(b), goal = idx(...e);
  const q = [idx(...s)];
  from[q[0]] = q[0];
  state[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const n = q[h];
    if (n === goal) {
      const out = [b];
      for (let m = n; m !== q[0]; m = from[m]) { const k = Math.floor(m / (nx * ny)), j = Math.floor((m % (nx * ny)) / nx), i = m % nx; out.push(pos(i, j, k)); }
      out.push(a);
      return out.reverse();
    }
    const k = Math.floor(n / (nx * ny)), j = Math.floor((n % (nx * ny)) / nx), i = n % nx;
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const I = i + di, J = j + dj, K = k + dk;
      if (I < 0 || J < 0 || K < 0 || I >= nx || J >= ny || K >= nz) continue;
      const m = idx(I, J, K);
      if (from[m] >= 0 || !(m === goal || free(I, J, K))) continue;
      from[m] = n; q.push(m);
    }
  }
  return null;
}
const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];
const routes = {};
for (const id of Object.keys(DRONE_MAPS).filter(i => DRONE_MAPS[i].kind === 'race')) {
  const md = loadDroneMap(id), G = md.gates;
  ok(G.length >= 8, `${id}: only ${G.length} gates`);
  G.forEach((g, i) => {
    // the opening is clear (a drone with room to spare fits through anywhere in its middle part)
    const pts = [];
    for (let a = -0.6; a <= 0.6; a += 0.3) for (let b = -0.6; b <= 0.6; b += 0.3) {
      if (g.rad) { if (Math.hypot(a, b) <= 0.6) pts.push(add(add(g.c, g.u, a * g.rad), g.v, b * g.rad)); }
      else if (g.arch) pts.push(add(add(g.c, g.u, a * g.hw * 0.6), g.v, b * g.hh * 0.6 - 0.2));
      else pts.push(add(add(g.c, g.u, a * g.hw), g.v, b * g.hh));
    }
    for (const p of pts) ok(md.col.free(p[0], p[1], p[2], DRONE.r + 0.05), `${id}: gate ${i}'s opening is blocked at (${p.map(v => v.toFixed(1))})`);
    for (const k of [-2.5, 2.5]) { const p = add(g.c, g.n, k); ok(md.col.free(p[0], p[1], p[2], 0.45), `${id}: no room ${k < 0 ? 'before' : 'after'} gate ${i}`); }
    // the gate can be passed: a straight line through its middle counts, one beside it doesn't
    ok(gateCross(g, add(g.c, g.n, -1), add(g.c, g.n, 1)), `${id}: flying through gate ${i}'s middle doesn't count`);
    ok(!gateCross(g, add(g.c, g.n, 1), add(g.c, g.n, -1)), `${id}: gate ${i} counts the wrong way round`);
    const side = add(g.c, g.u, (g.rad || g.hw) + 1.5);
    ok(!gateCross(g, add(side, g.n, -1), add(side, g.n, 1)), `${id}: flying past gate ${i} counts`);
  });
  if (quick && id === 'canyon') continue;
  // from the pads to gate 0, then each gate to the next (round to gate 0 again)
  const legs = [];
  const s0 = md.spawns[0];
  // (a roomy route where there is room — the autopilot below follows it — else a tight one: there must be a way)
  const roomy = (a, b) => route(md, a, b, 0.9) || route(md, a, b, 0.45);
  const lead = roomy([s0.x, s0.y + 1.2, s0.z], add(G[0].c, G[0].n, -2.5));
  ok(!!lead, `${id}: no way from the pads to the first gate`);
  legs.push(lead);
  for (let i = 0; i < G.length; i++) {
    const a = G[i], b = G[(i + 1) % G.length];
    const r = roomy(add(a.c, a.n, 2.5), add(b.c, b.n, -2.5));
    ok(!!r, `${id}: no way to fly from gate ${i} to gate ${(i + 1) % G.length}`);
    legs.push(r);
  }
  routes[id] = legs;
  console.log(`  ${id}: ${G.length} gates, a lap is about ${Math.round(legs.slice(1).reduce((s, l) => s + (l ? len(l) : 0), 0))} m`);
}
function len(path) { let s = 0; for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]); return s; }

// ---------- the flight model ----------
{
  const md = loadDroneMap('meadow'), s = md.spawns[0];
  const d = makeDrone(s.x, s.y, s.z, 0);
  let t = 0;
  const run = (inp, secs, mode = 'easy') => { const ev = []; for (let k = 0; k < secs * 120; k++) { const e = stepDrone(d, inp, 1 / 120, mode, md.col, t); t += 1 / 120; if (e.crash) ev.push(e.crash); } return ev; };
  run({ thr: 1 }, 1.2);
  const h0 = d.p[1];
  ok(h0 > s.y + 4, `Easy: full climb for 1.2 s only got to ${h0.toFixed(2)}`);
  run({ thr: 0 }, 1.5); const h1 = d.p[1]; run({ thr: 0 }, 2);
  ok(Math.abs(d.p[1] - h1) < 0.25, `Easy doesn't hold its height (${h1.toFixed(2)} → ${d.p[1].toFixed(2)})`);
  run({ thr: 0, pitch: 1 }, 4);
  const v = Math.hypot(d.v[0], d.v[2]);
  ok(v > 10 && v < 26, `Easy flat out: ${v.toFixed(1)} m/s`);
  ok(Math.abs(d.p[1] - h1) < 2.5, `Easy loses or gains height going forward (${h1.toFixed(2)} → ${d.p[1].toFixed(2)})`);
  run({ thr: 0 }, 3);
  const up = qrot(d.q, [0, 1, 0]);
  ok(up[1] > 0.99 && Math.hypot(d.v[0], d.v[2]) < 3, 'Easy doesn\'t level itself and slow down when the sticks are let go');
  // landings: soft is fine, hard breaks it
  const drop = (vy, mode = 'acro') => { const e = makeDrone(s.x, s.y + 1.2, s.z - 30, 0); e.v = [0, vy, 0]; e.air = true; const evs = []; for (let k = 0; k < 240; k++) { const r = stepDrone(e, { thr: 0 }, 1 / 120, mode, md.col, 0); if (r.crash) evs.push(r.crash); } return evs; };
  ok(drop(-3).length === 0, 'a soft landing (3 m/s) breaks the drone');
  ok(drop(-14).length === 1, 'a hard landing (14 m/s) doesn\'t break the drone');
  // into a gate's post at speed
  const g = md.gates[1], post = add(add(g.c, g.u, -(g.hw + 0.14)), g.v, 0);
  const e = makeDrone(post[0] - g.n[0] * 6, post[1], post[2] - g.n[2] * 6, g.yaw); e.v = [g.n[0] * 16, 0, g.n[2] * 16]; e.air = true; e.f = DRONE.hover;
  let hit = null;
  for (let k = 0; k < 120 && !hit; k++) hit = stepDrone(e, { thr: DRONE.hover }, 1 / 120, 'acro', md.col, 0).crash;
  ok(!!hit, 'flying into a gate\'s post at 16 m/s doesn\'t break the drone');
  // grazing a wall (glancing) only bounces
  const W = loadDroneMap('hangar');
  const gz = makeDrone(40, 6, 1.0, -Math.PI / 2); gz.v = [14, 0, -1.5]; gz.air = true; gz.f = DRONE.hover;
  let gc = false;
  for (let k = 0; k < 120; k++) if (stepDrone(gz, { thr: DRONE.hover }, 1 / 120, 'acro', W.col, 0).crash) gc = true;
  ok(!gc, 'grazing the hangar wall at a shallow angle breaks the drone');
  // water
  const V = loadDroneMap('valley');
  const wd = makeDrone(300, 4, 300, 0); wd.air = true;
  let wet = null;
  for (let k = 0; k < 480 && !wet; k++) { const r = stepDrone(wd, { thr: 0 }, 1 / 120, 'acro', V.col, 0); if (r.crash) wet = r.crash; }
  ok(wet && wet.water, 'falling into the lake doesn\'t count as a crash in the water');
  // Acro: full roll for 0.3 s turns about 3 rad and it stays tilted when let go
  const a = makeDrone(100, 30, 100, 0); a.air = true;
  for (let k = 0; k < 36; k++) stepDrone(a, { thr: DRONE.hover, roll: 1 }, 1 / 120, 'acro', null, 0);
  const r1 = qrot(a.q, [1, 0, 0]);
  const ang = Math.atan2(-r1[1], r1[0]);
  ok(Math.abs(ang) > 2 && Math.abs(ang) < 3.3, `Acro: full roll for 0.3 s turned ${ang.toFixed(2)} rad`);
  // let go: it stops turning within a moment (it has some weight), then stays at that angle
  for (let k = 0; k < 24; k++) stepDrone(a, { thr: 0.5 }, 1 / 120, 'acro', null, 0);
  const r15 = qrot(a.q, [1, 0, 0]), ang2 = Math.atan2(-r15[1], r15[0]);
  ok(Math.abs(ang2 - ang) < 0.45, `Acro keeps turning too long after the stick is let go (${(ang2 - ang).toFixed(2)} rad)`);
  for (let k = 0; k < 60; k++) stepDrone(a, { thr: 0.5 }, 1 / 120, 'acro', null, 0);
  const r2 = qrot(a.q, [1, 0, 0]);
  ok(Math.abs(Math.atan2(-r2[1], r2[0]) - ang2) < 0.02, 'Acro doesn\'t keep its attitude when the sticks are let go');
  // turtle: upside down on the ground, throttle flips it back
  const tu = makeDrone(100, DRONE.r + 0.1, 150, 0); tu.q = qaxis(0, 0, 1, Math.PI); tu.ground = true;
  for (let k = 0; k < 240; k++) stepDrone(tu, { thr: 0.5 }, 1 / 120, 'acro', md.col, 0);
  ok(qrot(tu.q, [0, 1, 0])[1] > 0.3, 'turtle mode doesn\'t flip an upside-down drone back over');
  // the Bodycam-like feel: a heavy drone that hovers at about half throttle (the middle of the stick), with a throttle
  // curve that is gentle round the middle, and about 100 km/h flat out (not a 140 km/h racing quad)
  ok(DRONE.hover > 0.44 && DRONE.hover < 0.52, `it should hover at about half throttle (hovers at ${(DRONE.hover * 100).toFixed(0)} %)`);
  ok(throttleCurve(0) === 0 && throttleCurve(1) === 1 && Math.abs(throttleCurve(0.5) - 0.5) < 1e-9, 'the throttle curve doesn\'t run 0 → 1 through its middle');
  ok(throttleCurve(0.55) - throttleCurve(0.45) < 0.1 * 0.8, 'the throttle curve isn\'t gentler round the middle');
  for (let m = 0.3; m <= 0.7; m += 0.2) for (let t = 0; t < 1; t += 0.05) ok(throttleCurve(t + 0.05, m, 0.6) >= throttleCurve(t, m, 0.6), `the throttle curve goes down somewhere (mid ${m})`);
  const hv = makeDrone(100, 40, 100, 0); hv.air = true; hv.f = DRONE.hover;
  for (let k = 0; k < 360; k++) stepDrone(hv, { thr: 0.5 }, 1 / 120, 'angle', null, 0);
  ok(Math.abs(hv.v[1]) < 1.2, `the middle of the throttle stick isn't about a hover (${hv.v[1].toFixed(2)} m/s up)`);
  const fast = makeDrone(100, 60, 100, 0); fast.air = true; fast.f = 1;
  fast.q = qypr(0, -0.85, 0);              // nose down ~50° (about level flight), full throttle, for 10 s (Acro keeps the attitude)
  for (let k = 0; k < 1200; k++) stepDrone(fast, { thr: 1 }, 1 / 120, 'acro', null, 0);
  const vmax = Math.hypot(fast.v[0], fast.v[2]) * 3.6;
  ok(vmax > 80 && vmax < 125, `flat out it does ${vmax.toFixed(0)} km/h (should be about 100)`);
  // a race restart point is just past the gate and facing the next one
  const rp = gateRespawn(md, 3);
  ok(md.col.free(rp.x, rp.y, rp.z, DRONE.r), 'the restart point past gate 3 is blocked');
}

// ---------- an autopilot flies each circuit in Casual ('easy'), with the real flight model ----------
// (follows the route found above, a few metres ahead, slowing down near gates and flying through each gate's middle
// before aiming further on, like a person would; every gate must count, in order, with no crash)
for (const id of Object.keys(routes)) {
  const md = loadDroneMap(id), legs = routes[id], G = md.gates;
  if (legs.some(l => !l)) continue;
  const pts = [];
  const through = (g) => pts.push(add(g.c, g.n, -2.5), g.c, add(g.c, g.n, 2.5));
  pts.push(...legs[0]);
  for (let i = 0; i < G.length; i++) { through(G[i]); pts.push(...legs[i + 1]); }
  through(G[0]); pts.push(add(G[0].c, G[0].n, 9));
  // the route by distance along it
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const total = cum[cum.length - 1];
  let seg = 0;
  const at = (q) => {
    q = Math.max(0, Math.min(total, q));
    let i = Math.max(0, Math.min(seg, cum.length - 2));
    while (i > 0 && cum[i] > q) i--;
    while (i < cum.length - 2 && cum[i + 1] < q) i++;
    const f = cum[i + 1] > cum[i] ? (q - cum[i]) / (cum[i + 1] - cum[i]) : 0, A = pts[i], B = pts[i + 1];
    return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
  };
  const s = md.spawns[0], d = makeDrone(s.x, s.y, s.z, s.yaw);
  let q = 0, n = 0, crashes = 0, t = 0, prev = [...d.p];
  for (let step = 0; step < 120 * 600 && q < total - 0.6; step++) {
    // how far along the route it is: the nearest point a little ahead of where it was
    let best = q, bd = Infinity;
    for (let r = q; r <= q + 8; r += 0.25) { const P = at(r), e = Math.hypot(P[0] - d.p[0], P[1] - d.p[1], P[2] - d.p[2]); if (e < bd) { bd = e; best = r; } }
    q = best;
    while (seg < cum.length - 2 && cum[seg + 1] < q) seg++;
    // aim 3 m further on; slow down for a sharp bend ahead and near the next gate
    // (close to the next gate: straight through its middle)
    const gn = G[n % G.length], rel = [d.p[0] - gn.c[0], d.p[1] - gn.c[1], d.p[2] - gn.c[2]];
    const along = rel[0] * gn.n[0] + rel[1] * gn.n[1] + rel[2] * gn.n[2];
    const side = Math.hypot(rel[0] - gn.n[0] * along, rel[1] - gn.n[1] * along, rel[2] - gn.n[2] * along);
    const lined = along > -4.5 && along < 0 && side < 1.6;      // in front of it and lined up with its middle
    // (still drifting across it: settle in front of its middle first, then go through)
    const vAlong = d.v[0] * gn.n[0] + d.v[1] * gn.n[1] + d.v[2] * gn.n[2];
    const vSide = Math.hypot(d.v[0] - gn.n[0] * vAlong, d.v[1] - gn.n[1] * vAlong, d.v[2] - gn.n[2] * vAlong);
    const settled = side < 0.7 && vSide < 1.2;
    // close to the gate it still has to pass: line up in front of it (missed it: back round to the front), else the route
    const close = Math.hypot(...rel) < 7;
    const tg = (close && along < 0.2) || lined ? add(gn.c, gn.n, settled && lined ? 2 : -2.5) : close ? add(gn.c, gn.n, -3) : at(q + 3), A = at(q), B = at(q + 9);
    const u1 = [tg[0] - A[0], tg[2] - A[2]], u2 = [B[0] - tg[0], B[2] - tg[2]];
    const bend = Math.acos(Math.max(-1, Math.min(1, (u1[0] * u2[0] + u1[1] * u2[1]) / ((Math.hypot(...u1) * Math.hypot(...u2)) || 1))));
    const ng = G[n % G.length].c, near = Math.hypot(ng[0] - d.p[0], ng[2] - d.p[2]);
    const dx = tg[0] - d.p[0], dy = tg[1] + 0.2 - d.p[1], dz = tg[2] - d.p[2], dh = Math.hypot(dx, dz) || 1;
    const sp = Math.min(near < 10 ? 5 : 9 * (1 - 0.65 * bend / Math.PI), dh * 2.2);
    const want = Math.atan2(-dx, -dz);
    let diff = want - d.hd; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    const fx = -Math.sin(d.hd), fz = -Math.cos(d.hd), rx = Math.cos(d.hd), rz = -Math.sin(d.hd);
    const vf = (dx * fx + dz * fz) / dh * sp, vr = (dx * rx + dz * rz) / dh * sp;
    const inp = { pitch: Math.max(-1, Math.min(1, vf / 20)), roll: Math.max(-1, Math.min(1, vr / 12)), dYaw: -diff * 0.05, thr: Math.max(-1, Math.min(1, dy * 0.8)) };
    prev = [...d.p];
    const ev = stepDrone(d, inp, 1 / 120, 'easy', md.col, t);
    t += 1 / 120;
    if (ev.crash) { crashes++; if (crashes < 4) console.log(`    ${id}: autopilot crashed at (${d.p.map(v => v.toFixed(1))}) on the way to gate ${n % G.length}, ${ev.crash.speed.toFixed(1)} m/s`); const r = n > 0 ? gateRespawn(md, (n - 1) % G.length) : s; Object.assign(d, makeDrone(r.x, r.y, r.z, r.yaw)); d.air = !!r.air; }
    if (gateCross(G[n % G.length], prev, d.p, 0.2)) n++;
  }
  ok(n === G.length + 1, `${id}: the Casual autopilot got through ${n} of ${G.length + 1} gates in order`);
  ok(crashes === 0, `${id}: the Casual autopilot crashed ${crashes} times`);
  console.log(`  ${id}: autopilot lap ${(t).toFixed(1)} s, ${n} gates, ${crashes} crashes`);
}

// ---------- the race on the host ----------
const sent = [];
function makeRoom(practice = true) {
  sent.length = 0;
  const srv = new Server({ practice, send: (id, m) => sent.push([id, m]) });
  return srv;
}
const tick = (srv, secs) => { for (let k = 0; k < secs * 20; k++) { simNow += 50; srv.tick(); } };
const lastOf = (t, id) => { for (let i = sent.length - 1; i >= 0; i--) if (sent[i][1].t === t && (!id || sent[i][0] === id)) return sent[i][1]; return null; };
// a pretend pilot: flies a list of routes at `speed`, telling the host where it is and which gates it passed
class Pilot {
  constructor(srv, id, md, legs, speed) { this.srv = srv; this.id = id; this.md = md; this.speed = speed; this.n = 0; this.pts = [].concat(...legs.map((l, i) => i === 0 ? l : l)); this.k = 0; this.p = [...this.pts[0]]; this.legs = legs; }
  // the whole course for `laps` laps: the lead-in, then the gates' legs round and round, through each gate's middle
  static course(md, legs, laps) {
    const G = md.gates, out = [...legs[0]];
    for (let lap = 0; lap < laps; lap++) for (let i = 0; i < G.length; i++) { out.push(add(G[i].c, G[i].n, -2.5), G[i].c, add(G[i].c, G[i].n, 2.5)); out.push(...legs[i + 1]); }
    const g0 = G[0]; out.push(add(g0.c, g0.n, -2.5), g0.c, add(g0.c, g0.n, 3));
    return out;
  }
  step(dt) {
    let go = this.speed * dt;
    const prev = [...this.p];
    while (go > 0 && this.k < this.pts.length - 1) {
      const t = this.pts[this.k + 1], d = Math.hypot(t[0] - this.p[0], t[1] - this.p[1], t[2] - this.p[2]);
      if (d <= go) { this.p = [...t]; this.k++; go -= d; } else { const f = go / d; this.p = [this.p[0] + (t[0] - this.p[0]) * f, this.p[1] + (t[1] - this.p[1]) * f, this.p[2] + (t[2] - this.p[2]) * f]; go = 0; }
    }
    this.srv.receive(this.id, { t: 'ds', s: [...this.p.map(v => Math.round(v * 100) / 100), 0, 0, 0, 1, 30, 2] });
    const G = this.md.gates;
    if (gateCross(G[this.n % G.length], prev, this.p, 0.2)) { this.n++; this.srv.receive(this.id, { t: 'gate', n: this.n }); }
  }
  done() { return this.k >= this.pts.length - 1; }
}
for (const id of Object.keys(routes)) {
  const md = loadDroneMap(id), legs = routes[id];
  if (legs.some(l => !l)) continue;
  const srv = makeRoom(true);
  srv.addPlayer('host', 'Ace');
  srv.startBotGame({ kind: 'fpv', map: id, laps: 2 });
  ok(srv.fpv && srv.phase === 'fpv' && srv.droneHost && srv.droneHost.race, `${id}: Practice didn't start a race`);
  const start = sent.find(([, m]) => m.t === 'start');
  ok(start && start[1].mode === 'fpv' && start[1].map === id && start[1].fpv && start[1].fpv.ph === 'wait', `${id}: the start message is wrong`);
  srv.addPlayer('p2', 'Bee');
  srv.receive('host', { t: 'fpvReady' });
  tick(srv, 1);
  ok(srv.droneHost.ph === 'wait', `${id}: the countdown started before everyone had loaded`);
  srv.receive('p2', { t: 'fpvReady' });
  tick(srv, 0.2);
  ok(srv.droneHost.ph === 'count', `${id}: no countdown once everyone has loaded`);
  // a gate claimed during the countdown is ignored
  srv.receive('host', { t: 'gate', n: 1 });
  ok(srv.droneHost.racers.get('host').n === 0, `${id}: a gate counted during the countdown`);
  tick(srv, FPV.count + 0.1);
  ok(srv.droneHost.ph === 'race', `${id}: the race didn't start after the countdown`);
  const course = Pilot.course(md, legs, 2);
  const a = new Pilot(srv, 'host', md, [course], 20), b = new Pilot(srv, 'p2', md, [course], 13);
  a.pts = course; b.pts = course;
  // cheating: claiming gate 2 straight away, or gate 1 from the pads
  srv.receive('p2', { t: 'gate', n: 2 });
  ok(srv.droneHost.racers.get('p2').n === 0, `${id}: a gate out of order counted`);
  srv.receive('p2', { t: 'ds', s: [md.spawns[1].x, md.spawns[1].y, md.spawns[1].z, 0, 0, 0, 1, 0, 0] });
  srv.receive('p2', { t: 'gate', n: 1 });
  const g0far = Math.hypot(md.spawns[1].x - md.gates[0].c[0], md.spawns[1].z - md.gates[0].c[2]) > FPV.near + 6;
  if (g0far) ok(srv.droneHost.racers.get('p2').n === 0, `${id}: a gate claimed far from it counted`);
  else srv.droneHost.racers.get('p2').n = 0;
  // a friend joins during the race: flies, isn't placed
  srv.addPlayer('p3', 'Cat');
  ok(srv.droneHost.racers.get('p3') && srv.droneHost.racers.get('p3').late, `${id}: someone who joined during the race is in the standings`);
  ok(Number.isInteger(srv.droneHost.slots.p3), `${id}: someone who joined has no pad`);
  let over = null, guard = 0;
  while (!over && guard++ < 20 * 600) {
    simNow += 50;
    a.step(0.05); b.step(0.05);
    srv.tick();
    over = lastOf('over');
  }
  ok(!!over, `${id}: the race never ended`);
  if (!over) continue;
  const res = over.results;
  const A = res.find(r => r.id === 'host'), B = res.find(r => r.id === 'p2'), C = res.find(r => r.id === 'p3');
  const lap = len(legs.slice(1).flat ? [].concat(...legs.slice(1)) : []);
  void lap;
  ok(A && A.pos === 1 && A.time > 0 && A.laps.length === 2, `${id}: the faster pilot isn't 1st with 2 laps (${JSON.stringify(A)})`);
  ok(A && A.best != null && A.best <= Math.max(...A.laps) + 1e-6, `${id}: the best lap is wrong`);
  const bLapTime = len(course) / 13;
  if (bLapTime - len(course) / 20 > FPV.tail) ok(B && B.pos === 2 && B.time == null, `${id}: the slow pilot should not have finished in the 45 s after the winner (${JSON.stringify(B)})`);
  else ok(B && B.pos === 2 && B.time > A.time, `${id}: the slower pilot isn't 2nd behind the winner (${JSON.stringify(B)})`);
  ok(C && C.pos == null && C.late, `${id}: the late joiner got a place`);
  ok(over.mode === 'fpv' && over.race && over.laps === 2 && srv.phase === 'over', `${id}: the over message is wrong`);
  const fin = sent.filter(([, m]) => m.t === 'fpvfx' && m.k === 'finish');
  ok(fin.length >= 1 && fin[0][1].id === 'host' && fin[0][1].pos === 1, `${id}: no "finished 1st" for the winner`);
  // Play again (Practice): a new race on the same map
  srv.receive('host', { t: 'restart' });
  ok(srv.phase === 'fpv' && srv.droneHost.ph === 'wait', `${id}: Play again didn't start a new race`);
  console.log(`  ${id}: race OK — winner ${A.time.toFixed(1)} s (laps ${A.laps.map(v => v.toFixed(1)).join(', ')})`);
}

// ---------- free flight, online rooms, leaving ----------
{
  const srv = makeRoom(false);
  srv.addPlayer('host', 'Owner');
  srv.receive('host', { t: 'settings', mode: 'fpv' });
  ok(srv.settings.mode !== 'fpv', 'the mode could be picked without the host game\'s say-so (fpvOk)');
  srv.receive('host', { t: 'settings', fpvOk: true, mode: 'fpv', fpvMap: 'skyline' });
  ok(srv.settings.mode === 'fpv' && srv.settings.fpvMap === 'skyline', 'the leader with fpvOk can\'t pick drones and a map');
  srv.receive('host', { t: 'settings', fpvMap: 'nowhere', fpvLaps: 7 });
  ok(srv.settings.fpvMap === 'skyline' && srv.settings.fpvLaps === 3, 'a made-up map or lap count was accepted');
  ok(srv.roomMax() === RULES.fpv.maxPlayers, `the room doesn't take ${RULES.fpv.maxPlayers}`);
  srv.addPlayer('p2', 'Two');
  srv.receive('p2', { t: 'settings', mode: 'wingman' });
  ok(srv.settings.mode === 'fpv', 'a guest changed the mode');
  srv.receive('host', { t: 'startMatch' });
  ok(srv.phase === 'fpv' && srv.droneHost && !srv.droneHost.race && srv.droneHost.ph === 'free', 'free flight on Skyline didn\'t start online');
  srv.receive('host', { t: 'ds', s: [100, 20, 100, 0, 0, 0, 1, 40, 2] });
  tick(srv, 0.2);
  const snap = lastOf('dsnap', 'p2');
  ok(snap && snap.d.some(e => e[0] === 'host' && e[1] === 100 && e[2] === 20), 'the other pilot doesn\'t get my drone in the snapshots');
  srv.receive('host', { t: 'ds', s: [NaN, 1, 2, 0, 0, 0, 1, 0, 0] });
  ok(srv.players.get('host').x === 100, 'a broken position was taken');
  tick(srv, 120);
  ok(srv.phase === 'fpv', 'free flight ended by itself');
  srv.receive('p2', { t: 'fpvEnd' });
  ok(srv.phase === 'fpv', 'a guest ended free flight');
  srv.receive('host', { t: 'crash', x: 1, y: 2, z: 3 });
  ok(sent.some(([to, m]) => to === 'p2' && m.t === 'fpvfx' && m.k === 'crash' && m.id === 'host'), 'a crash isn\'t shown to the others');
  srv.receive('host', { t: 'fpvEnd' });
  const ov = lastOf('over');
  ok(srv.phase === 'over' && ov && ov.mode === 'fpv' && !ov.race, 'the leader couldn\'t end free flight');
  srv.receive('host', { t: 'toLobby' });
  ok(srv.phase === 'lobby' && !srv.fpv && srv.players.get('host').team !== 'ffa', 'back to the lobby didn\'t put things back');
  // a race where the only other pilot leaves: it ends when the one left finishes
  srv.receive('host', { t: 'settings', fpvMap: 'meadow', fpvLaps: 1 });
  srv.receive('host', { t: 'startMatch' });
  ok(srv.droneHost && srv.droneHost.race && srv.droneHost.laps === 1, 'a 1-lap race on Meadow didn\'t start online');
  tick(srv, FPV.wait + FPV.count + 0.5);
  ok(srv.droneHost.ph === 'race', 'the race didn\'t start once the wait for loading ran out');
  srv.removePlayer('p2');
  ok(!srv.droneHost.racers.has('p2'), 'a pilot who left is still in the standings');
  if (routes.meadow) {
    const md = loadDroneMap('meadow'), course = Pilot.course(md, routes.meadow, 1), a = new Pilot(srv, 'host', md, [course], 22);
    a.pts = course;
    sent.length = 0;
    for (let k = 0; k < 20 * 200 && srv.phase !== 'over'; k++) { simNow += 50; a.step(0.05); srv.tick(); }
    const o = lastOf('over');
    ok(o && o.results.length === 1 && o.results[0].pos === 1 && o.results[0].time > 0, 'the race with one pilot left didn\'t end with them 1st');
  }
  // the room's leader leaves a free flight: the next one leads
  srv.receive('host', { t: 'toLobby' });
  srv.addPlayer('p4', 'Four');
  srv.receive('host', { t: 'settings', fpvMap: 'outpost' });
  srv.receive('host', { t: 'startMatch' });
  ok(srv.phase === 'fpv' && srv.fpvMap === 'outpost', 'free flight on one of the game\'s other maps (Outpost) didn\'t start');
  srv.removePlayer('host');
  ok(srv.ownerId === 'p4' && srv.phase === 'fpv', 'the room didn\'t carry on with a new leader');
}

console.log(bad ? `\n${bad} of ${checks} checks FAILED` : `\nAll ${checks} checks passed`);
process.exit(bad ? 1 : 0);
