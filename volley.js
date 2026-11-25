// Volleyball: the one court, net and ball every volleyball game uses — in the Minigames (the Pool Hall's court) and in
// the Volleyball mode (its three maps, vbmaps.js). Only where the court is (its middle and floor height) and how much
// room there is round it differ from map to map; the court, the net, the ball and the rules never do.
// No three.js in here: the host, the bots, every player and the home server use the same numbers.
//
//   The court: 12 × 6 m (each team's side 6 × 6), lengthwise along x; the net across the middle (x = cx), its top
//   2.24 m over the floor, its mesh 1 m deep, its posts 0.5 m outside the side lines. Orange ('atk') plays the west
//   side, Blue ('def') the east side. Nobody can go round or under the net to the other side.
//   Rally scoring: every rally gives a point. A ball that lands inside the lines (the lines count as in) scores for
//   the team on the other side; out (outside the lines, into anything but the floor and the net, under the net or
//   round the posts), a fourth touch on a side, or the same player twice in a row: a point for the other team.
//   The team that wins a rally serves the next one (a new server each time the serve changes sides). A set is won
//   at 11 points with a lead of 2, or at 15.

export const VB = {
  len: 12, wid: 6,               // the court, in metres
  netTop: 2.24, netBottom: 1.24, // the net (over the floor)
  postOut: 0.5,                  // the posts stand this far outside the side lines
  g: 9.8,                        // the ball falls like a real one
  r: 0.14,                       // the ball's radius (a little bigger than a real one, to be seen)
  // hitting: E / fire with the ball in reach sends it the way you look, always with some lift; jumping near the net
  // and looking down spikes it (fast and straight)
  hit: { speed: 7, up: 4, spike: 11, reach: 1.3, lo: 0.3, hi: 2.7, cool: 0.35, spikeNet: 2.6 },
  points: 11, lead: 2, cap: 15,  // a set
  touches: 3,                    // per side (4 for the smaller team when the teams are uneven online)
  pause: 1.6,                    // after a rally, before the next serve
  toss: 2.8,                     // the serve: the ball is tossed up over the server's head (m/s)
};

// the court of this map: { cx, cz, y (floor), x0, x1, z0, z1 (the lines), pz0, pz1 (the posts), area (where players
// may be: the free zone round the court) }. def: a map definition with `vb` (a volleyball map) or a Pool Hall plan
// with `volley`.
export function courtOf(def) {
  const v = (def && def.vb) || (def && def.pool && def.pool.volley);
  if (!v) return null;
  const { cx, cz, y, area } = v;
  return {
    cx, cz, y, x0: cx - VB.len / 2, x1: cx + VB.len / 2, z0: cz - VB.wid / 2, z1: cz + VB.wid / 2,
    pz0: cz - VB.wid / 2 - VB.postOut, pz1: cz + VB.wid / 2 + VB.postOut,
    area: { x0: area[0], z0: area[1], x1: area[2], z1: area[3] },
  };
}

export const sideOf = (c, x) => (x < c.cx ? 'atk' : 'def');
// inside the lines (a ball touching a line is in)
export const inCourt = (c, x, z) => x >= c.x0 - VB.r && x <= c.x1 + VB.r && z >= c.z0 - VB.r && z <= c.z1 + VB.r;

// keep a player on their own side and inside the free zone round the court (players' games and the bots)
export function clampSide(c, team, p, r = 0.4) {
  const a = c.area;
  let x0 = a.x0 + r, x1 = a.x1 - r;
  if (team === 'atk') x1 = Math.min(x1, c.cx - r); else if (team === 'def') x0 = Math.max(x0, c.cx + r);
  p.x = Math.max(x0, Math.min(x1, p.x));
  p.z = Math.max(a.z0 + r, Math.min(a.z1 - r, p.z));
}

// where each team starts: spread over its own side, facing the net
export function vbSpawns(c, team, n) {
  const sgn = team === 'atk' ? -1 : 1, out = [];
  const spots = [[3, 0], [4.5, -1.8], [4.5, 1.8], [1.5, -1.6], [1.5, 1.6], [5.5, 0]];
  for (let k = 0; k < n; k++) { const [dx, dz] = spots[k % spots.length]; out.push({ x: c.cx + sgn * dx, z: c.cz + dz, y: c.y, yaw: team === 'atk' ? -Math.PI / 2 : Math.PI / 2 }); }
  return out;
}

// the ball's velocity off a hit, aimed by yaw / pitch (as a player looks). spike: a jump hit at the net, looking down.
export function hitVelocity(yaw, pitch, spike = false) {
  const H = VB.hit, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (spike) { const p = Math.max(-1.1, Math.min(-0.08, pitch)), k = Math.cos(p); return [fx * H.spike * k, H.spike * Math.sin(p), fz * H.spike * k]; }
  const p = Math.max(-0.35, Math.min(1.25, pitch)), k = Math.cos(p);
  return [fx * H.speed * k, H.speed * Math.sin(p) + H.up, fz * H.speed * k];
}

// A normal hit aimed over the net (not a spike) gets just enough extra lift to clear it, if it was going into it:
// a mouse or a thumb can't judge that to the centimetre. v: the velocity from hitVelocity; b: the ball; c: the court.
export function netAssist(c, b, v) {
  if (Math.abs(v[0]) < 0.3 || Math.sign(c.cx - b.x) !== Math.sign(v[0])) return v;
  const t = (c.cx - b.x) / v[0], z = b.z + v[2] * t;
  if (t <= 0 || z < c.pz0 || z > c.pz1) return v;
  const need = c.y + VB.netTop + 0.3, y = b.y + v[1] * t - 0.5 * VB.g * t * t;
  if (y >= need) return v;
  // (a ball that comes down on your own side before it gets to the net is a pass to a teammate: left as it is)
  if (y < c.y + VB.r) return v;
  return [v[0], v[1] + Math.min(4, (need - y) / t), v[2]];
}

// can a player standing (feet) at p reach the ball? (its middle close enough round them, between knee and jump height)
export function inReach(p, b) {
  const H = VB.hit, dy = b.y - p.y;
  return Math.hypot(b.x - p.x, b.z - p.z) < H.reach && dy > H.lo && dy < H.hi;
}

// One step of the ball in flight. Returns what happened (or null): { k: 'net' } it hit the net and bounced back;
// { k: 'cross' } it went over the net; { k: 'under' } under it, { k: 'wide' } round the posts (both faults);
// { k: 'land', x, z, in } it came down on the court's floor (in: inside the lines); { k: 'out' } into anything else
// (a wall, a fence, the ceiling, something standing about). The ball stops where it came down.
export function stepBall(world, c, b, dt) {
  const R = VB.r;
  let ev = null;
  const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
  for (let i = 0; i < n; i++) {
    b.vy -= VB.g * h;
    const nx = b.x + b.vx * h, ny = b.y + b.vy * h, nz = b.z + b.vz * h;
    // the net's plane
    if ((b.x - c.cx) * (nx - c.cx) < 0 || (nx === c.cx && b.x !== c.cx)) {
      const t = (c.cx - b.x) / (nx - b.x), yc = b.y + (ny - b.y) * t, zc = b.z + (nz - b.z) * t;
      if (zc > c.pz0 && zc < c.pz1) {
        if (yc <= c.y + VB.netTop + R && yc >= c.y + VB.netBottom - R) {
          // into the net: it drops back on the side it came from
          const from = Math.sign(b.x - c.cx) || 1;
          b.x = c.cx + from * (R + 0.03); b.y = yc; b.z = zc;
          b.vx = -b.vx * 0.25; b.vz *= 0.5; b.vy = Math.min(b.vy, 0) * 0.5;
          ev = ev || { k: 'net' };
          continue;
        }
        if (yc < c.y + VB.netBottom - R) return { k: 'under' };
        ev = { k: 'cross' };
      } else return { k: 'wide' };
    }
    // anything solid on the way (walls, fences, the ceiling, props); the floor itself
    const dx = nx - b.x, dy = ny - b.y, dz = nz - b.z, len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      const hit = world.raycast(b.x, b.y, b.z, dx / len, dy / len, dz / len, len + R);
      if (hit && hit.t <= len + R) {
        const t = Math.max(0, hit.t - R), px = b.x + dx / len * t, py = b.y + dy / len * t, pz = b.z + dz / len * t;
        b.x = px; b.y = py; b.z = pz; b.vx = b.vy = b.vz = 0;
        if (hit.ny > 0.7 && Math.abs(py - R - c.y) < 0.3) return { k: 'land', x: px, z: pz, in: inCourt(c, px, pz) };
        return { k: 'out' };
      }
    }
    b.x = nx; b.y = ny; b.z = nz;
    if (b.y <= c.y + R) { b.y = c.y + R; b.vx = b.vy = b.vz = 0; return { k: 'land', x: b.x, z: b.z, in: inCourt(c, b.x, b.z) }; }
  }
  return ev;
}

// where (and when) a ball in flight comes down to height y on the way down (for the bots), or null
export function whereAt(b, y) {
  const a = -0.5 * VB.g, bb = b.vy, cc = b.y - y, disc = bb * bb - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * a);
  if (!(t > 0)) return null;
  return { x: b.x + b.vx * t, z: b.z + b.vz * t, t };
}
