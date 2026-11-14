// Multi-level map model: every 0.5 m grid cell holds a list of solid vertical
// spans (walls, floors, stairs, roofs, cover). Shared by the host (hit checks)
// and every client (movement, shooting). No rendering code here.

export const CELL = 0.5;          // metres per grid cell
export const GRAVITY = 20;
export const STEP = 0.42;         // max height you can walk up without jumping
export const PLAYER_RADIUS = 0.36;
export const PLAYER_HEIGHT = 1.8;
export const EYE = 1.62;

export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const snap = v => Math.round(v / CELL);

// Collects primitives from a map's build() script and rasterises them.
class Builder {
  constructor(world) { this.wd = world; }

  cells(x0, z0, x1, z1, fn) {
    const w = this.wd;
    for (let iz = Math.max(0, snap(z0)); iz < Math.min(w.h, snap(z1)); iz++) {
      for (let ix = Math.max(0, snap(x0)); ix < Math.min(w.w, snap(x1)); ix++) fn(ix, iz, iz * w.w + ix);
    }
  }

  // carve walkable ground (removes everything in the area)
  open(x0, z0, x1, z1) { this.cells(x0, z0, x1, z1, (ix, iz, i) => { this.wd.spans[i] = []; }); }

  // remove only the parts of spans that fall within [y0, y1] — for doors & windows
  cut(x0, z0, x1, z1, y0, y1) {
    this.cells(x0, z0, x1, z1, (ix, iz, i) => {
      const out = [];
      for (const s of this.wd.spans[i]) {
        if (s.y1 <= y0 || s.y0 >= y1) { out.push(s); continue; }
        if (s.y0 < y0) out.push({ ...s, y1: y0 });
        if (s.y1 > y1) out.push({ ...s, y0: y1 });
      }
      this.wd.spans[i] = out;
    });
  }

  add(x0, z0, x1, z1, y0, y1, m, pen = false, prop = -1) {
    this.cells(x0, z0, x1, z1, (ix, iz, i) => {
      this.wd.spans[i].push({ y0, y1, m, pen, prop });
    });
  }

  wall(x0, z0, x1, z1, h = 6, m = 'wall', y0 = 0) { this.add(x0, z0, x1, z1, y0, h, m); }
  slab(x0, z0, x1, z1, top, thick = 0.3, m = 'slab') { this.add(x0, z0, x1, z1, top - thick, top, m); }
  roof(x0, z0, x1, z1, y = 3.6, m = 'roof') { this.add(x0, z0, x1, z1, y, y + 0.3, m); }

  // dir: '+x' | '-x' | '+z' | '-z' = the direction you walk to go UP
  stairs(x0, z0, x1, z1, dir, h0, h1, m = 'stairs') {
    const axis = dir[1];
    const n = axis === 'x' ? snap(x1) - snap(x0) : snap(z1) - snap(z0);
    this.cells(x0, z0, x1, z1, (ix, iz, i) => {
      let k = axis === 'x' ? ix - snap(x0) : iz - snap(z0);
      if (dir[0] === '-') k = n - 1 - k;
      const h = h0 + (h1 - h0) * (k + 1) / n;
      this.wd.spans[i].push({ y0: 0, y1: h, m, pen: false, prop: -1 });
    });
  }

  prop(type, x0, z0, x1, z1, h, opts = {}) {
    const id = this.wd.props.length;
    this.wd.props.push({ type, x0, z0, x1, z1, h, ...opts });
    if (type === 'truck') {
      // cab is tall, bed is a step you can climb from a barrel
      const cabLen = 2;
      const f = opts.facing || '+x';
      const cab = f === '+x' ? [x1 - cabLen, z0, x1, z1] : f === '-x' ? [x0, z0, x0 + cabLen, z1] : f === '+z' ? [x0, z1 - cabLen, x1, z1] : [x0, z0, x1, z0 + cabLen];
      this.add(x0, z0, x1, z1, 0, opts.bed || 1.4, 'truck', false, id);
      this.add(cab[0], cab[1], cab[2], cab[3], opts.bed || 1.4, h, 'truck', false, id);
      return;
    }
    this.add(x0, z0, x1, z1, 0, h, type, !!opts.pen, id);
  }

  box(x0, z0, x1, z1, h = 1.0) { this.prop('box', x0, z0, x1, z1, h, { pen: true }); }
  crate(x0, z0, x1, z1, h = 2.1) { this.prop('crate', x0, z0, x1, z1, h, { pen: true }); }
  barrel(x, z) { this.prop('barrel', x, z, x + 1, z + 1, 1.0, { pen: true }); }
  truck(x0, z0, x1, z1, facing = '+x') { this.prop('truck', x0, z0, x1, z1, 2.7, { facing, bed: 1.4 }); }
  // a stone well head in a square (solid low cover)
  well(x0, z0, x1, z1) { this.prop('well', x0, z0, x1, z1, 0.95); }
  // shallow canal water you can wade through (slower and noisy); y = the water's surface
  water(x0, z0, x1, z1, y = 0.25) { this.wd.water.push({ x0, z0, x1, z1, y }); }
  // a wooden hand cart (low cover you can shoot through); facing: the way the handles point
  cart(x0, z0, x1, z1, facing = '+x') { this.prop('cart', x0, z0, x1, z1, 1.25, { pen: true, facing }); }
  // purely visual extras for the 3D scene (bridges, arches, paving…): no collision
  deco(type, ...args) { this.wd.deco.push({ type, args }); }
  // a solid house: one block with its own height, wall finish and style (colour, roof, windows…).
  // opts: h, mat ('stucco' | 'stone' | 'brick'), color, roof ('gable' | 'gable-x' | 'gable-z' | 'hip' | 'flat' | 'tower'),
  // kind ('church' | 'tower' | 'inn'), shutters, quoins, balcony, plants. Missing ones are picked for you.
  house(x0, z0, x1, z1, opts = {}) {
    const id = this.wd.houses.length;
    const h = opts.h || 7;
    this.wd.houses.push({ ...opts, x0, z0, x1, z1, h, id });
    this.cells(x0, z0, x1, z1, (ix, iz, i) => { this.wd.spans[i] = [{ y0: 0, y1: h, m: opts.mat || 'stucco', pen: false, prop: -1, house: id }]; });
  }

  // a pitfall: a hole in the floor you fall down (and don't come back from)
  pit(x0, z0, x1, z1) {
    const w = this.wd;
    if (!w.pitGrid) w.pitGrid = new Uint8Array(w.w * w.h);
    w.pits.push({ x0, z0, x1, z1 });
    this.cells(x0, z0, x1, z1, (ix, iz, i) => { w.spans[i] = w.spans[i].filter(s => s.y0 > 0.5); w.pitGrid[i] = 1; });
  }
  // the way out of the Backrooms: a door in a wall at (x, z), (nx, nz) pointing into the maze
  exit(door) { this.wd.exit = door; }
  // a door that can be opened and shut (Backrooms). 'way' doors fill a doorway (x0..z1) when shut;
  // 'blank' doors sit on a wall face at (cx, cz) and only ever open onto more wall.
  door(info, x0, z0, x1, z1) {
    const w = this.wd, d = { ...info, cells: [] };
    if (info.kind === 'way') {
      this.cells(x0, z0, x1, z1, (ix, iz, i) => d.cells.push(i));
      const ix0 = Math.max(0, snap(x0)), iz0 = Math.max(0, snap(z0)), ix1 = snap(x1), iz1 = snap(z1);
      Object.assign(d, { x0: ix0 * CELL, z0: iz0 * CELL, x1: ix1 * CELL, z1: iz1 * CELL });
      d.cx = (d.x0 + d.x1) / 2; d.cz = (d.z0 + d.z1) / 2;
      d.nx = info.v ? 1 : 0; d.nz = info.v ? 0 : 1;
    } else { d.nx = info.v ? info.side : 0; d.nz = info.v ? 0 : info.side; }
    w.doors.push(d);
  }

  spawn(team, x, z, yaw) { this.wd.spawns[team].push({ x, z, yaw }); }
  site(name, x0, z0, x1, z1) { this.wd.siteRects.push({ name, x0, z0, x1, z1 }); }
}

// do two house rectangles share a stretch of wall?
function housesTouch(a, b) {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return (Math.abs(ox) < 1e-6 && oz > 0) || (Math.abs(oz) < 1e-6 && ox > 0);
}
// how different two '#rrggbb' colours look (0 = the same)
function colourGap(a, b) {
  const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = c(a), B = c(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

export class World {
  constructor(mapDef) {
    this.def = mapDef;
    const [W, D] = mapDef.size;
    this.w = Math.round(W / CELL);
    this.h = Math.round(D / CELL);
    this.spans = new Array(this.w * this.h);
    // start fully solid: the map script carves the playable space out of it
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const hgt = mapDef.massHeight + Math.floor(hash2(Math.floor(ix / 8), Math.floor(iz / 8)) * 4) * 0.8;
        this.spans[iz * this.w + ix] = [{ y0: 0, y1: hgt, m: 'mass', pen: false, prop: -1 }];
      }
    }
    this.props = [];
    this.water = [];      // shallow canals: { x0, z0, x1, z1, y }
    this.deco = [];       // visual-only extras for mapdeco.js
    this.houses = [];     // village maps: each house block with its look
    this.spawns = { atk: [], def: [], dm: [] };   // dm = deathmatch spawn points
    this.siteRects = [];
    this.pits = [];       // holes in the floor (Backrooms)
    this.pitGrid = null;
    this.exit = null;     // Backrooms exit door
    this.doors = [];      // Backrooms doors that open and shut (all start open in the grid; setDoor shuts them)
    mapDef.build(new Builder(this));
    if (mapDef.village) this.fillHouses(mapDef.village);
    for (const list of this.spans) list.sort((a, b) => a.y0 - b.y0);

    this.sites = {};
    for (const r of this.siteRects) this.sites[r.name] = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
    this.centre = { x: W / 2, z: D / 2 };
    this.width = W; this.depth = D;
  }

  // Village maps: turn every block of untouched mass into houses of different sizes, heights and looks
  // (so streets are lined by separate buildings, not one long wall), then fill in each house's style.
  fillHouses(cfg) {
    const W = this.w, H = this.h, taken = new Uint8Array(W * H);
    const isMass = i => { const s = this.spans[i]; return !taken[i] && s.length === 1 && s[0].m === 'mass'; };
    let seed = 7;
    const rnd = () => hash2(seed++ * 31 + 5, seed * 17 + 3);
    const add = (cx0, cz0, cx1, cz1) => {
      const id = this.houses.length;
      const h = cfg.hMin + Math.floor(rnd() * ((cfg.hMax - cfg.hMin) / 0.5 + 1)) * 0.5;
      const kinds = rnd();
      const mat = kinds < 0.66 ? 'stucco' : kinds < 0.9 ? 'stone' : 'brick';
      this.houses.push({ x0: cx0 * CELL, z0: cz0 * CELL, x1: cx1 * CELL, z1: cz1 * CELL, h, mat, id, auto: true });
      for (let iz = cz0; iz < cz1; iz++) for (let ix = cx0; ix < cx1; ix++) {
        taken[iz * W + ix] = 1;
        this.spans[iz * W + ix] = [{ y0: 0, y1: h, m: mat, pen: false, prop: -1, house: id }];
      }
    };
    // take the biggest block of free mass each time (thin slivers last), and split long ones
    const hgt = new Int32Array(W);
    const biggest = () => {
      let best = null;
      hgt.fill(0);
      for (let iz = 0; iz < H; iz++) {
        for (let ix = 0; ix < W; ix++) hgt[ix] = isMass(iz * W + ix) ? hgt[ix] + 1 : 0;
        const st = [];
        for (let ix = 0; ix <= W; ix++) {
          const hh = ix < W ? hgt[ix] : 0;
          let start = ix;
          while (st.length && st[st.length - 1][1] >= hh) {
            const [s0, h0] = st.pop();
            const wdt = ix - s0, score = h0 * wdt * Math.min(1, Math.min(h0, wdt) / 6);
            if (h0 > 0 && (!best || score > best.score)) best = { score, x0: s0, x1: ix, z0: iz - h0 + 1, z1: iz + 1 };
            start = s0;
          }
          st.push([start, hh]);
        }
      }
      return best;
    };
    for (let blk = biggest(); blk; blk = biggest()) {
      const { x0: ix, x1, z0: iz, z1 } = blk;
      const along = x1 - ix >= z1 - iz, len = along ? x1 - ix : z1 - iz;
      const n = Math.max(1, Math.round(len * CELL / (6 + rnd() * 5)));
      let a = 0;
      for (let k = 0; k < n; k++) {
        const b = k === n - 1 ? len : Math.max(a + 6, Math.min(len - 6 * (n - k - 1), Math.round(len * (k + 1) / n + (rnd() - 0.5) * 3)));
        if (along) add(ix + a, iz, ix + b, z1); else add(ix, iz + a, x1, iz + b);
        a = b;
      }
    }
    // fill in each house's look (explicit choices in the map win)
    const pal = cfg.palette, stones = cfg.stone || ['#cdb894', '#d6c4a2', '#c4ad88'], bricks = cfg.brick || ['#b9785a', '#a86a4e'];
    const shut = cfg.shutters || ['#4f6b45', '#6b4a32', '#5a7080', '#7a3b2e', '#3f5f5a'];
    const roofs = cfg.roofs || ['#b5532f', '#a84a2a', '#c0643a', '#9c4a2e', '#b8603e', '#ad5a36'];
    for (const hs of this.houses) {
      const r = () => hash2(hs.id * 13 + 7, Math.floor(rnd() * 1e6));
      const w = hs.x1 - hs.x0, d = hs.z1 - hs.z0;
      hs.mat = hs.mat || 'stucco';
      if (!hs.color) {
        // next-door houses of the same finish get clearly different colours (or exactly the same one),
        // never two nearly-matching shades that look like a mistake
        const list = hs.mat === 'stone' ? stones : hs.mat === 'brick' ? bricks : pal;
        const near = this.houses.filter(o => o !== hs && o.color && o.mat === hs.mat && housesTouch(o, hs)).map(o => o.color);
        const ok = list.filter(c => near.every(n => colourGap(c, n) >= 55));
        const same = list.filter(c => near.includes(c));
        const pick = ok.length ? ok : same.length ? same : list;
        hs.color = pick[Math.floor(r() * pick.length)];
      }
      if (!hs.roof) hs.roof = Math.min(w, d) < 2.6 ? 'gable' : Math.max(w, d) / Math.min(w, d) < 1.35 ? (r() < 0.6 ? 'hip' : 'flat') : (r() < 0.82 ? 'gable' : 'flat');
      if (hs.roof === 'gable') hs.roof = w >= d ? 'gable-x' : 'gable-z';
      if (!hs.roofColor) hs.roofColor = roofs[Math.floor(r() * roofs.length)];
      if (hs.shutters === undefined) hs.shutters = r() < 0.8 ? shut[Math.floor(r() * shut.length)] : null;
      if (!hs.win) hs.win = r() < 0.5 ? 'square' : r() < 0.7 ? 'arch' : 'tall';
      if (hs.quoins === undefined) hs.quoins = hs.mat === 'stucco' && r() < 0.45;
      if (hs.balcony === undefined) hs.balcony = r() < 0.18;
      if (hs.plants === undefined) hs.plants = r() < 0.22;
      if (hs.chimney === undefined) hs.chimney = hs.roof !== 'flat' && r() < 0.3;
      if (!hs.spacing) hs.spacing = 2.5 + r() * 0.9;
    }
  }

  // which house (index into this.houses) a cell belongs to, or -1
  houseAt(ix, iz) {
    if (!this.houseGrid) {
      this.houseGrid = new Int16Array(this.w * this.h).fill(-1);
      for (const hs of this.houses) {
        for (let z = Math.round(hs.z0 / CELL); z < Math.round(hs.z1 / CELL); z++) for (let x = Math.round(hs.x0 / CELL); x < Math.round(hs.x1 / CELL); x++) this.houseGrid[z * this.w + x] = hs.id;
      }
    }
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return -1;
    return this.houseGrid[iz * this.w + ix];
  }

  cellSpans(ix, iz) {
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return OUTSIDE;
    return this.spans[iz * this.w + ix];
  }

  // open or shut a door: a shut doorway is solid from the floor to just under the top of the gap
  setDoor(i, open) {
    const d = this.doors[i];
    if (!d) return;
    d.open = !!open;
    for (const c of d.cells) {
      const list = this.spans[c].filter(s => s.m !== '_door');
      if (!open) { list.push({ y0: 0, y1: 2.15, m: '_door', pen: false, prop: -1 }); list.sort((a, b) => a.y0 - b.y0); }
      this.spans[c] = list;
    }
  }

  // a door just shut on someone standing in its doorway: move them out to the side they're more on (owner's rule:
  // doors shut whoever is in the way). p = { x, z }, changed in place; true if they were moved.
  pushOutOfDoor(i, p, r = PLAYER_RADIUS) {
    const d = this.doors[i];
    if (!d || d.x0 == null) return false;
    if (p.x <= d.x0 - r || p.x >= d.x1 + r || p.z <= d.z0 - r || p.z >= d.z1 + r) return false;
    if (d.nx) p.x = d.cx + (p.x >= d.cx ? 1 : -1) * ((d.x1 - d.x0) / 2 + r + 0.02);
    else p.z = d.cz + (p.z >= d.cz ? 1 : -1) * ((d.z1 - d.z0) / 2 + r + 0.02);
    return true;
  }

  // the door nearest to (x, z) within reach, or -1
  doorNear(x, z, reach = 1.9) {
    let best = -1, bd = reach;
    this.doors.forEach((d, i) => {
      const dd = Math.hypot(d.cx - x, d.cz - z);
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  }

  // is there a hole in the floor at this point?
  isPit(x, z) {
    if (!this.pitGrid) return false;
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h && this.pitGrid[iz * this.w + ix] === 1;
  }
  pitCell(ix, iz) { return !!this.pitGrid && ix >= 0 && iz >= 0 && ix < this.w && iz < this.h && this.pitGrid[iz * this.w + ix] === 1; }

  // the water surface height here (0 = dry)
  waterAt(x, z) {
    for (const w of this.water) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) return w.y;
    return 0;
  }

  siteAt(x, z) {
    for (const r of this.siteRects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.name;
    return null;
  }

  nearSpawn(team, x, z, dist = 10) {
    return (this.spawns[team] || []).some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < dist * dist);
  }

  spawnYaw(team) {
    const s = this.spawns[team][0];
    return s && Number.isFinite(s.yaw) ? s.yaw : 0;
  }

  // iterate cells overlapped by a circle (precise test)
  forCircle(x, z, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const cx = Math.max(ix * CELL, Math.min(x, (ix + 1) * CELL));
        const cz = Math.max(iz * CELL, Math.min(z, (iz + 1) * CELL));
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) {
          if (fn(this.cellSpans(ix, iz)) === true) return true;
        }
      }
    }
    return false;
  }

  // would a player with feet at y collide at (x,z)? `step` = how high a ledge can be walked up
  blocked(x, z, r, y, step = STEP, height = PLAYER_HEIGHT) {
    // down a pitfall: the floor around the hole is solid, so you can't walk out under it
    if (y < -0.3 && this.pitGrid) {
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (!this.pitCell(ix, iz)) return true;
    }
    return this.forCircle(x, z, r, spans => {
      for (const s of spans) if (s.y1 > y + step && s.y0 < y + height) return true;
      return false;
    });
  }

  // highest surface at or below y + step
  groundAt(x, z, r, y, step = STEP) {
    // over a hole (your middle, not just an edge of you): nothing to stand on
    let g = this.pitGrid && this.isPit(x, z) ? -60 : 0;
    this.forCircle(x, z, r, spans => {
      for (const s of spans) if (s.y1 <= y + step && s.y1 > g) g = s.y1;
    });
    return g;
  }

  // lowest overhead surface above a player standing at y
  ceilingAt(x, z, r, y) {
    let c = Infinity;
    this.forCircle(x, z, r, spans => {
      for (const s of spans) if (s.y0 >= y + STEP && s.y0 < c) c = s.y0;
    });
    return c;
  }

  // Move a body (feet position p, velocity v). Returns true if on the ground.
  // height: body height. platforms: [{x, z, r, top}] — round tops you can
  // stand on, such as a teammate's head.
  move(p, v, dt, r = PLAYER_RADIUS, wasOnGround = false, height = PLAYER_HEIGHT, platforms = null) {
    let onGround = false;
    const steps = Math.max(1, Math.ceil(dt / 0.016));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      // full step-up on the ground (stairs); only a small lip in the air
      const step = wasOnGround ? STEP : 0.12;
      const nx = p.x + v.x * h;
      if (!this.blocked(nx, p.z, r, p.y, step, height)) p.x = nx; else v.x = 0;
      const nz = p.z + v.z * h;
      if (!this.blocked(p.x, nz, r, p.y, step, height)) p.z = nz; else v.z = 0;
      let ground = this.groundAt(p.x, p.z, r, p.y, step);
      if (platforms) {
        for (const pl of platforms) {
          if (pl.top > ground && pl.top <= p.y + step && (p.x - pl.x) ** 2 + (p.z - pl.z) ** 2 < pl.r * pl.r) ground = pl.top;
        }
      }
      v.y -= GRAVITY * h;
      let ny = p.y + v.y * h;
      if (v.y > 0) {
        const ceil = this.ceilingAt(p.x, p.z, r, p.y);
        if (ny + height > ceil) { ny = ceil - height; v.y = 0; }
      }
      // stick to the ground when walking down stairs
      if ((wasOnGround || onGround) && v.y <= 0 && p.y - ground <= STEP + 0.01) ny = Math.min(ny, ground);
      p.y = ny;
      onGround = false;
      if (p.y <= ground) { p.y = ground; if (v.y < 0) v.y = 0; onGround = true; }
      wasOnGround = onGround;
    }
    return onGround;
  }

  // Trace a ray through the grid. dir must be normalised.
  // Returns { t, solid, nx, ny, nz, pen: [[t0, t1], ...] } — `t` is the first
  // solid hit (or maxT), `pen` lists stretches of bullet-penetrable cover crossed before it.
  trace(ox, oy, oz, dx, dy, dz, maxT = 400) {
    const pen = [];
    const floorT = dy < -1e-6 ? -oy / dy : Infinity;
    let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-9 ? (dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx) : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? (dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / Math.abs(dz) : Infinity;
    let tEnter = 0, axis = -1;
    for (let guard = 0; guard < 4000 && tEnter < maxT; guard++) {
      const tExit = Math.min(tMaxX, tMaxZ, maxT);
      const spans = this.cellSpans(ix, iz);
      let best = null;
      for (const s of spans) {
        let tLo, tHi;
        if (Math.abs(dy) < 1e-9) {
          if (oy < s.y0 || oy > s.y1) continue;
          tLo = -Infinity; tHi = Infinity;
        } else if (dy > 0) { tLo = (s.y0 - oy) / dy; tHi = (s.y1 - oy) / dy; }
        else { tLo = (s.y1 - oy) / dy; tHi = (s.y0 - oy) / dy; }
        const a = Math.max(tLo, tEnter), b = Math.min(tHi, tExit);
        if (a > b || (a === 0 && axis === -1 && tLo < 0)) continue; // started inside: ignore
        if (s.pen) { pen.push([a, b]); continue; }
        if (!best || a < best.t) {
          if (a === tEnter && axis !== -1) {
            best = axis === 0 ? { t: a, nx: -stepX, ny: 0, nz: 0 } : { t: a, nx: 0, ny: 0, nz: -stepZ };
          } else best = { t: a, nx: 0, ny: dy < 0 ? 1 : -1, nz: 0 };
        }
      }
      if (best && best.t <= floorT) return { ...best, solid: true, pen: pen.filter(p => p[0] < best.t) };
      if (floorT <= tExit) return { t: floorT, nx: 0, ny: 1, nz: 0, solid: true, pen: pen.filter(p => p[0] < floorT) };
      if (tMaxX < tMaxZ) { ix += stepX; tEnter = tMaxX; tMaxX += tDeltaX; axis = 0; }
      else { iz += stepZ; tEnter = tMaxZ; tMaxZ += tDeltaZ; axis = 1; }
    }
    return { t: maxT, solid: false, nx: 0, ny: 0, nz: 0, pen };
  }

  // Solid hit only (cover that bullets pass through is ignored).
  raycast(ox, oy, oz, dx, dy, dz, maxT = 400) {
    const r = this.trace(ox, oy, oz, dx, dy, dz, maxT);
    return r.solid ? r : null;
  }

  // Damage multiplier for a bullet from a to b: 0 = blocked by something solid,
  // otherwise reduced by how much penetrable cover it passes through.
  traceFactor(ax, ay, az, bx, by, bz, penPower = 2) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return 1;
    const r = this.trace(ax, ay, az, dx / d, dy / d, dz / d, d);
    if (r.solid && r.t < d - 0.25) return 0;
    return penFactor(r.pen, d, penPower);
  }

  los(ax, ay, az, bx, by, bz) { return this.traceFactor(ax, ay, az, bx, by, bz, Infinity) > 0; }

  // For the radar / previews: 0 open ground, 1 upper walkable level, 2 wall, 3 cover, 4 roof/overhead
  cellKind(ix, iz) {
    const spans = this.cellSpans(ix, iz);
    if (!spans.length) return 0;
    let tallSolid = false, upper = false, cover = false, over = false;
    for (const s of spans) {
      if (s.y0 < 0.1 && s.y1 >= 2.2 && !s.pen && s.m !== 'truck') tallSolid = true;
      else if (s.y0 >= 2.5) { if (s.m === 'roof') over = true; else upper = true; }
      else if (s.pen || s.m === 'truck' || s.m === 'low' || s.m === 'stairs' || s.y1 < 2.5) cover = true;
    }
    if (tallSolid && !upper) return 2;
    if (upper) return 1;
    if (cover) return 3;
    return over ? 4 : 0;
  }
}

const OUTSIDE = [{ y0: -10, y1: 200, m: 'mass', pen: false, prop: -1 }];

export function penFactor(pen, uptoT, penPower) {
  if (!pen || !pen.length) return 1;
  let thick = 0;
  for (const [a, b] of pen) if (a < uptoT) thick += Math.min(b, uptoT) - a;
  if (!Number.isFinite(penPower)) return 1;
  return Math.max(0, 1 - thick / penPower);
}

// ---------- player hitboxes ----------
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmax < 0 ? null : Math.max(tmin, 0);
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tc = lx * dx + ly * dy + lz * dz;
  if (tc < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tc * tc;
  if (d2 > r * r) return null;
  return tc - Math.sqrt(r * r - d2);
}

// Hit zones in the player's own frame (x = right, z = back, feet at y = 0).
// `h` scales heights; `yaw` turns the zones with the player.
const ZONES = [
  ['chest', -0.2, 1.12, -0.16, 0.2, 1.42, 0.16],
  ['stomach', -0.19, 0.82, -0.15, 0.19, 1.12, 0.15],
  ['arms', 0.2, 0.95, -0.16, 0.31, 1.42, 0.14],
  ['arms', -0.31, 0.95, -0.16, -0.2, 1.42, 0.14],
  ['arms', -0.16, 1.18, -0.52, 0.3, 1.36, -0.16],   // forearms holding the gun
  ['legs', -0.24, 0, -0.16, 0.24, 0.82, 0.16],
];
export function rayVsPlayer(ox, oy, oz, dx, dy, dz, px, py, pz, yaw = 0, h = 1) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // move the ray into the player's frame
  const rx = ox - px, rz = oz - pz;
  const lox = rx * c - rz * s, loz = rx * s + rz * c, loy = oy - py;
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  let best = null;
  const head = raySphere(lox, loy, loz, ldx, dy, ldz, 0, 1.6 * h, -0.02, 0.22);
  if (head != null) best = { t: head, part: 'head' };
  for (const [part, x0, y0, z0, x1, y1, z1] of ZONES) {
    const t = rayBox(lox, loy, loz, ldx, dy, ldz, x0, y0 * h, z0, x1, y1 * h, z1);
    if (t != null && (!best || t < best.t)) best = { t, part };
  }
  return best;
}

// ---------- bomb blast ----------
// The blast is a shockwave that spreads from the bomb. Walls block it, so it
// travels around them: we flood the grid outwards from the bomb (shortest path
// round obstacles) and use that path length as the blast distance.
function blastOpen(world, ix, iz, by) {
  const y = by + 1.0;
  for (const s of world.cellSpans(ix, iz)) if (!s.pen && s.y0 < y && s.y1 > y) return false;
  return true;
}

export function blastField(world, bx, by, bz, reach) {
  const W = world.w, H = world.h;
  const field = new Float32Array(W * H).fill(Infinity);
  const sx = Math.max(0, Math.min(W - 1, Math.floor(bx / CELL))), sz = Math.max(0, Math.min(H - 1, Math.floor(bz / CELL)));
  const heap = [];   // [dist, index]
  const push = (d, i) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  const start = sz * W + sx;
  field[start] = 0;
  push(0, start);
  const D = [[1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL],
    [1, 1, CELL * Math.SQRT2], [1, -1, CELL * Math.SQRT2], [-1, 1, CELL * Math.SQRT2], [-1, -1, CELL * Math.SQRT2]];
  while (heap.length) {
    const [d, i] = pop();
    if (d > field[i] || d > reach) continue;
    const ix = i % W, iz = (i - ix) / W;
    for (const [ddx, ddz, cost] of D) {
      const nx = ix + ddx, nz = iz + ddz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (!blastOpen(world, nx, nz, by)) continue;
      // no squeezing diagonally between two blocked cells
      if (ddx && ddz && (!blastOpen(world, ix + ddx, iz, by) || !blastOpen(world, ix, iz + ddz, by))) continue;
      const ni = nz * W + nx, nd = d + cost;
      if (nd < field[ni]) { field[ni] = nd; push(nd, ni); }
    }
  }
  return { field, bx, by, bz, W, H };
}

// Effective blast distance for someone standing at (x, y, z). Going round a
// corner costs extra, so the blast fades faster out of direct sight.
export function blastDistance(bf, x, y, z) {
  const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
  let path = Infinity;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const jx = ix + dx, jz = iz + dz;
    if (jx < 0 || jz < 0 || jx >= bf.W || jz >= bf.H) continue;
    const v = bf.field[jz * bf.W + jx] + (dx || dz ? CELL * 0.5 : 0);
    if (v < path) path = v;
  }
  if (!Number.isFinite(path)) return Infinity;
  const straight = Math.hypot(x - bf.bx, z - bf.bz);
  const bent = path + 0.5 * Math.max(0, path - straight);
  return Math.hypot(bent, y - bf.by);
}

// Blast damage to health. rules: { blastLethal, blastMax, blastArmor }
export function blastDamage(bf, x, y, z, armor, rules) {
  const d = blastDistance(bf, x, y, z);
  if (d >= rules.blastMax) return 0;
  let dmg = d <= rules.blastLethal ? 500 : 200 * Math.pow((rules.blastMax - d) / (rules.blastMax - rules.blastLethal), 1.6);
  if (armor > 0 && d > rules.blastLethal) dmg *= rules.blastArmor;
  return Math.round(dmg);
}
