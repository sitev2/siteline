// Flashlights stop at walls (owner's request). For each flashlight that is on, we trace rays all the way round it
// on the map's grid (at the lamp's height) and keep how far each one gets before it meets something solid: a
// "shadow ring", one row of a small texture per light. Anything further from the lamp than the ring says, in that
// direction, is behind a wall and gets none of its light:
//   - the Backrooms' baked surfaces (brview.js addFlash: the flashlight cones are drawn by their own shader),
//   - the visible beam of other people's flashlights (game.js),
// and the lamp's own reach (three.js SpotLight, for people and props) is cut where its middle hits a wall.
// The ring only depends on where the lamp is, not where it points, so it is worked out again only when the lamp
// has moved (or a door opened or shut), at most two lights a frame.
import * as THREE from 'three';
import { CELL } from './world.js';

export const FLASH_RAYS = 512;      // directions round the lamp
export const FLASH_ROWS = 8;        // lights (you + up to 7 others)
export const FLASH_RANGE = 64;      // m (the depths are stored in 16 bits over this)
const SEE_THROUGH = new Set(['_shelf', '_desk', '_ceiling']);     // open racks, a desk below the lamp, the sky

export class FlashShadow {
  constructor(world) {
    this.world = world;
    this.data = new Uint8Array(FLASH_RAYS * FLASH_ROWS * 4);
    this.tex = new THREE.DataTexture(this.data, FLASH_RAYS, FLASH_ROWS, THREE.RGBAFormat);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.wrapS = THREE.RepeatWrapping; this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.rows = [];          // row → { id, x, y, z, ver }
    this.budget = 0;
  }

  // does cell (ix, iz) stop light at height y?
  solid(ix, iz, y) {
    const sp = this.world.cellSpans(ix, iz);
    for (const s of sp) if (s.y0 < y && s.y1 > y && !SEE_THROUGH.has(s.m)) return true;
    return false;
  }

  // the ring for row `row`, a lamp at (x, y, z)
  cast(row, x, y, z) {
    const W = this.world, d = this.data, base = row * FLASH_RAYS * 4, max = FLASH_RANGE - 0.01;
    for (let a = 0; a < FLASH_RAYS; a++) {
      const ang = ((a + 0.5) / FLASH_RAYS - 0.5) * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
      // walk the grid cell by cell along the ray (the cell the lamp is in never counts)
      let ix = Math.floor(x / CELL), iz = Math.floor(z / CELL), t = max;
      const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = Math.abs(dx) > 1e-9 ? Math.abs(CELL / dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? Math.abs(CELL / dz) : Infinity;
      let tmx = Math.abs(dx) > 1e-9 ? (dx > 0 ? (ix + 1) * CELL - x : x - ix * CELL) / Math.abs(dx) : Infinity;
      let tmz = Math.abs(dz) > 1e-9 ? (dz > 0 ? (iz + 1) * CELL - z : z - iz * CELL) / Math.abs(dz) : Infinity;
      for (let g = 0; g < 400; g++) {
        let enter;
        if (tmx < tmz) { enter = tmx; ix += sx; tmx += tdx; } else { enter = tmz; iz += sz; tmz += tdz; }
        if (enter >= max) break;
        if (ix < 0 || iz < 0 || ix >= W.w || iz >= W.h || this.solid(ix, iz, y)) { t = enter; break; }
      }
      const v = Math.round(t / FLASH_RANGE * 65535), i = base + a * 4;
      d[i] = v >> 8; d[i + 1] = v & 255; d[i + 2] = 0; d[i + 3] = 255;
    }
    this.tex.needsUpdate = true;
  }

  // lights: [{ id, x, y, z }] that are on this frame, nearest first. Gives each a row (kept from frame to frame
  // while it stays on) and works rings out again where a lamp has moved. Returns id → row.
  update(lights) {
    const ver = this.world.ver || 0, out = new Map();
    const keep = new Set(lights.slice(0, FLASH_ROWS).map(L => L.id));
    for (let r = 0; r < FLASH_ROWS; r++) if (this.rows[r] && !keep.has(this.rows[r].id)) this.rows[r] = null;
    let budget = 2;
    for (const L of lights.slice(0, FLASH_ROWS)) {
      let r = this.rows.findIndex(o => o && o.id === L.id);
      if (r < 0) { r = [...Array(FLASH_ROWS).keys()].find(k => !this.rows[k]); if (r == null) continue; this.rows[r] = { id: L.id, x: Infinity, y: 0, z: 0, ver: -1 }; }
      const o = this.rows[r], moved = Math.hypot(L.x - o.x, L.z - o.z) + Math.abs(L.y - o.y);
      // (a brand-new row is always worked out; a moved lamp when there is budget left this frame)
      if (o.ver !== ver || moved > 0.12) {
        if (o.x === Infinity || budget > 0) { budget--; this.cast(r, L.x, L.y, L.z); o.x = L.x; o.y = L.y; o.z = L.z; o.ver = ver; }
      }
      out.set(L.id, r);
    }
    return out;
  }

  // how far (m) the middle of a beam from (x, y, z) along (dx, dy, dz) gets before it meets a wall (for a lamp's reach)
  reach(x, y, z, dx, dy, dz, max) {
    const h = this.world.trace(x, y, z, dx, dy, dz, max);
    return h.solid ? h.t : max;
  }
}

// the GLSL that reads a ring: how much of light `row` (lamp at L) reaches P — 0 behind a wall, 1 in its view.
// yr: the heights it can light (the garage: its own floor only, the deck between the floors is in the way).
export const FLASH_GLSL = `
float flashSeen(sampler2D ring, float row, vec3 L, vec2 yr, vec3 P) {
  if (row < -0.5) return 1.0;
  if (P.y < yr.x || P.y > yr.y) return 0.0;
  vec2 d = P.xz - L.xz;
  float dist = length(d);
  if (dist < 0.3) return 1.0;
  float u = atan(d.y, d.x) / 6.2831853 + 0.5;
  vec4 t = texture2D(ring, vec2(u, (row + 0.5) / ${FLASH_ROWS.toFixed(1)}));
  float depth = (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * ${FLASH_RANGE.toFixed(1)};
  return 1.0 - smoothstep(depth + 0.12, depth + 0.4, dist);
}`;
