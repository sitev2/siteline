// Dressing for the maps: purely visual details added on top of the walls built by maps.js.
// Nothing here changes collision, bullets or bots — it reads the span grid in world.js to
// find wall tops and wall faces, then adds (as a few instanced meshes):
//   • caps along the tops of walls (snow on them in the snow theme)
//   • windows and the odd door on buildings (lit at night), wooden roof beams on desert buildings
//   • lamps, drainpipes, vents, air-con units, electrical boxes and signs on long walls
//   • dirt, cracks, oil stains, puddles, drifts and painted lines on the ground
//   • distant scenery all round the map so the walls don't end in empty sky
import * as THREE from 'three';
import { CELL, hash2 } from './world.js';
import { dressHouses, villageDeco } from './houses.js';

// what each theme adds
const DRESS = {
  // Tuscan hill town (Flame): dusty cobbles with dirt patches and dry grass, hills and mountains around
  tuscan: {
    windowOn: [], frame: '#e6dac2', glass: '#20262c', door: '#6b4a30',
    items: [], decals: ['dirt', 'dirt', 'crack', 'stain'], tufts: true,
    backdrop: 'tuscan',
  },
  // houses dress themselves (houses.js); keep the streets clean
  village: {
    windowOn: [], frame: '#e6dac2', glass: '#20262c', door: '#6b4a30',
    items: [], decals: ['crack', 'stain'],
    backdrop: 'village',
  },
  desert: {
    pilasters: true, windowOn: ['building'], frame: '#efe2c4', glass: '#2c3a46', door: '#6b4426', beams: ['building'], beamColor: '#5a3b22',
    items: ['lamp', 'lamp', 'box', 'sign'], decals: ['crack', 'stain', 'drift', 'drift'], drift: '#e2c99a',
    backdrop: 'mesas',
  },
  industrial: {
    windowOn: ['building', 'mass'], frame: '#c9c4b8', glass: '#2a3138', door: '#4a5c6e',
    items: ['pipe', 'lamp', 'vent', 'ac', 'box', 'pipe', 'sign'], decals: ['oil', 'crack', 'line', 'stain'],
    backdrop: 'factory',
  },
  snow: {
    pilasters: true, windowOn: ['building'], frame: '#f2f2ee', glass: '#26323e', door: '#3e4e5e', snowCaps: true,
    items: ['lamp', 'pipe', 'vent', 'box', 'sign'], decals: ['drift', 'drift', 'crack', 'stain'], drift: '#ffffff',
    backdrop: 'mountains',
  },
  harbour: {
    windowOn: ['building', 'mass', 'wall'], frame: '#efeae0', glass: '#26303a', door: '#2f4f3e', shutters: '#3d6b52',
    items: ['lamp', 'pipe', 'lamp', 'sign', 'box'], decals: ['puddle', 'crack', 'stain', 'puddle'],
    backdrop: 'harbour',
  },
  quarry: {
    pilasters: true, windowOn: ['building'], frame: '#e8e0cc', glass: '#2c3640', door: '#6b5030',
    items: ['lamp', 'box', 'sign'], decals: ['crack', 'drift', 'stain'], drift: '#ddd2bb',
    backdrop: 'cliffs',
  },
  railyard: {
    windowOn: ['building', 'mass'], frame: '#d8d0c0', glass: '#28313a', door: '#3e4a56',
    items: ['lamp', 'pipe', 'sign', 'box', 'vent'], decals: ['oil', 'crack', 'stain', 'line'],
    backdrop: 'yard',
  },
};

const col = (hex, l = 0) => { const c = new THREE.Color(hex); if (l) c.offsetHSL(0, 0, l); return c; };

// collects instances of one shape, then builds a single InstancedMesh
class Inst {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.list = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) { this.list.push([x, y, z, sx, sy, sz, color, rx, ry, rz]); }
  build(group, shadows = false) {
    if (!this.list.length) return null;
    const m = new THREE.InstancedMesh(this.geo, this.mat, this.list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    this.list.forEach(([x, y, z, sx, sy, sz, c, rx, ry, rz], i) => {
      m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz));
      m.setMatrixAt(i, m4);
      m.setColorAt(i, c instanceof THREE.Color ? c : col(c));
    });
    m.castShadow = shadows; m.receiveShadow = shadows;
    group.add(m);
    return m;
  }
}

// ---------- reading the walls ----------
// the solid height of a cell from the ground up (0 if it's open floor)
function groundTop(spans) {
  let top = 0;
  for (const s of spans) if (s.prop < 0 && s.y0 <= top + 0.01) top = Math.max(top, s.y1);
  return top;
}
// the highest solid thing in a cell
function maxTop(spans) {
  let t = 0;
  for (const s of spans) if (s.y1 > t) t = s.y1;
  return t;
}
// a wall face at ground level between a solid cell and an open neighbour:
// { h: how high the face is open to view, m: material }
function groundFace(world, ix, iz, dx, dz) {
  const a = world.cellSpans(ix, iz);
  if (!a.length || a[0].y0 > 0.01 || a[0].prop >= 0 || a[0].m[0] === '_') return null;
  const top = groundTop(a);
  if (top < 1.2) return null;
  const b = world.cellSpans(ix + dx, iz + dz);
  if (b === a || ix + dx < 0 || iz + dz < 0 || ix + dx >= world.w || iz + dz >= world.h) return null;
  let nb = Infinity;
  for (const s of b) if (s.y1 > 0.6 && s.prop < 0 && s.m[0] !== '_') nb = Math.min(nb, s.y0);   // props don't hide the wall
  const h = Math.min(top, nb);
  if (h < 1.2) return null;
  return { h, m: a[0].m, house: a[0].house };
}
// runs of matching wall faces: { x, z (start, on the face), dir: [ux, uz] along, n: [nx, nz] out, len, h, m }
function faceRuns(world) {
  const runs = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const alongX = dz !== 0;          // faces pointing ±z run along x
    const outer = alongX ? world.h : world.w, inner = alongX ? world.w : world.h;
    for (let o = 0; o < outer; o++) {
      let cur = null;
      for (let k = 0; k <= inner; k++) {
        const ix = alongX ? k : o, iz = alongX ? o : k;
        const f = k < inner ? groundFace(world, ix, iz, dx, dz) : null;
        if (cur && f && f.m === cur.m && f.house === cur.house && Math.abs(f.h - cur.h) < 0.05) { cur.len += CELL; continue; }
        if (cur && cur.len >= 1) runs.push(cur);
        cur = null;
        if (!f) continue;
        // face plane position
        const fx = dx > 0 ? (ix + 1) * CELL : dx < 0 ? ix * CELL : ix * CELL;
        const fz = dz > 0 ? (iz + 1) * CELL : dz < 0 ? iz * CELL : iz * CELL;
        cur = { x: fx, z: fz, dir: alongX ? [1, 0] : [0, 1], n: [dx, dz], len: CELL, h: f.h, m: f.m, house: f.house };
      }
    }
  }
  return runs;
}
// runs of wall-top edges where the wall drops away: { x, z, dir, n, len, y, m }
function topRuns(world) {
  const runs = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const topOf = (ix, iz) => {
    const sp = world.cellSpans(ix, iz);
    let best = null;
    for (const s of sp) if (s.prop < 0 && s.m[0] !== '_' && (!best || s.y1 > best.y1)) best = s;
    return best;
  };
  for (const [dx, dz] of dirs) {
    const alongX = dz !== 0;
    const outer = alongX ? world.h : world.w, inner = alongX ? world.w : world.h;
    for (let o = 0; o < outer; o++) {
      let cur = null;
      for (let k = 0; k <= inner; k++) {
        const ix = alongX ? k : o, iz = alongX ? o : k;
        let e = null;
        if (k < inner) {
          const s = topOf(ix, iz);
          const nx = ix + dx, nz = iz + dz;
          const inside = nx >= 0 && nz >= 0 && nx < world.w && nz < world.h;
          if (s && s.y1 >= 1.0 && inside && s.m !== 'stairs') {
            const nt = maxTop(world.cellSpans(nx, nz));
            if (nt < s.y1 - 0.25) e = { y: s.y1, m: s.m, house: s.house };
          }
        }
        if (cur && e && e.m === cur.m && e.house === cur.house && Math.abs(e.y - cur.y) < 0.01) { cur.len += CELL; continue; }
        if (cur) runs.push(cur);
        cur = null;
        if (!e) continue;
        const fx = dx > 0 ? (ix + 1) * CELL : ix * CELL, fz = dz > 0 ? (iz + 1) * CELL : iz * CELL;
        cur = { x: fx, z: fz, dir: alongX ? [1, 0] : [0, 1], n: [dx, dz], len: CELL, y: e.y, m: e.m, house: e.house };
      }
    }
  }
  return runs;
}

// ---------- little canvas textures (no image files) ----------
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const DECAL = {
  crack: (g, n) => {
    const r = rng(11); g.strokeStyle = 'rgba(30,24,18,0.38)'; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      let x = n / 2, y = n / 2, a = r() * Math.PI * 2;
      g.lineWidth = 2.2 - k * 0.6;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 9; i++) { a += (r() - 0.5) * 1.1; x += Math.cos(a) * n * 0.06; y += Math.sin(a) * n * 0.06; g.lineTo(x, y); }
      g.stroke();
    }
  },
  stain: (g, n) => {
    const r = rng(5);
    for (let i = 0; i < 14; i++) {
      const x = n / 2 + (r() - 0.5) * n * 0.5, y = n / 2 + (r() - 0.5) * n * 0.5, rad = n * (0.08 + r() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(40,32,24,0.22)'); gr.addColorStop(1, 'rgba(40,32,24,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    }
  },
  oil: (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n * 0.45);
    gr.addColorStop(0, 'rgba(12,12,14,0.75)'); gr.addColorStop(0.6, 'rgba(18,18,22,0.45)'); gr.addColorStop(1, 'rgba(18,18,22,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(n / 2, n / 2, n * 0.45, n * 0.3, 0.4, 0, Math.PI * 2); g.fill();
  },
  puddle: (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n * 0.45);
    gr.addColorStop(0, 'rgba(70,90,110,0.75)'); gr.addColorStop(0.75, 'rgba(70,90,110,0.55)'); gr.addColorStop(1, 'rgba(70,90,110,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(n / 2, n / 2, n * 0.46, n * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(220,235,255,0.25)'; g.beginPath(); g.ellipse(n * 0.42, n * 0.44, n * 0.16, n * 0.05, 0.2, 0, Math.PI * 2); g.fill();
  },
  // a patch of bare, sandy earth between the cobbles
  dirt: (g, n) => {
    const r = rng(23);
    for (let i = 0; i < 22; i++) {
      const x = n / 2 + (r() - 0.5) * n * 0.55, y = n / 2 + (r() - 0.5) * n * 0.55, rad = n * (0.1 + r() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(196,170,120,0.85)'); gr.addColorStop(0.7, 'rgba(190,165,115,0.5)'); gr.addColorStop(1, 'rgba(190,165,115,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120,100,70' : '230,215,180'},${0.25 + r() * 0.3})`; g.fillRect(n * 0.2 + r() * n * 0.6, n * 0.2 + r() * n * 0.6, 1.5, 1.5); }
  },
  // a soft band (sand or snow blown against a wall): bright at the bottom edge, fading out
  drift: (g, n) => {
    const gr = g.createLinearGradient(0, n, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  },
  line: (g, n) => {
    g.fillStyle = 'rgba(214,176,40,0.8)'; g.fillRect(0, n * 0.42, n, n * 0.16);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 30; i++) g.fillRect(Math.random() * n, n * 0.42 + Math.random() * n * 0.16, 3, 2);
  },
};
function signTex() {
  return canvasTex(128, (g, n) => {
    // hazard / direction placards in a 2×2 sheet
    g.fillStyle = '#d6b028'; g.fillRect(0, 0, n / 2, n / 2);
    g.fillStyle = '#1b1b1b';
    for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 14, n / 2); g.lineTo(i * 14 + 7, n / 2); g.lineTo(i * 14 + 7 + 32, 0); g.lineTo(i * 14 + 32, 0); g.fill(); }
    g.fillStyle = '#e8e8e2'; g.fillRect(n / 2, 0, n / 2, n / 2);
    g.fillStyle = '#b8322a'; g.beginPath(); g.arc(n * 0.75, n * 0.25, n * 0.18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8e8e2'; g.fillRect(n * 0.62, n * 0.23, n * 0.26, n * 0.05);
    g.fillStyle = '#2f5f8a'; g.fillRect(0, n / 2, n / 2, n / 2);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(n * 0.1, n * 0.75); g.lineTo(n * 0.3, n * 0.62); g.lineTo(n * 0.3, n * 0.7); g.lineTo(n * 0.42, n * 0.7); g.lineTo(n * 0.42, n * 0.8); g.lineTo(n * 0.3, n * 0.8); g.lineTo(n * 0.3, n * 0.88); g.fill();
    g.fillStyle = '#2f6b45'; g.fillRect(n / 2, n / 2, n / 2, n / 2);
    g.fillStyle = '#ffffff'; g.fillRect(n * 0.72, n * 0.58, n * 0.06, n * 0.34); g.fillRect(n * 0.58, n * 0.72, n * 0.34, n * 0.06);
  });
}

// ---------- distant scenery ----------
// simple shapes merged into one mesh with vertex colours; colours fade towards the horizon
// with distance (so it works whatever the fog setting)
class Merge {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  geo(g, x, y, z, ry, c, sx = 1, sy = 1, sz = 1, topColor = null, topFrom = 0) {
    const gg = g.index ? g.toNonIndexed() : g;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const P = gg.attributes.position, N = gg.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const ly = v.y;
      v.applyMatrix4(m); n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(n.x, n.y, n.z);
      const cc = topColor && ly > topFrom ? topColor : c;
      this.col.push(cc.r, cc.g, cc.b);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const U_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const U_CYL = (seg = 10, top = 1) => new THREE.CylinderGeometry(top, 1, 1, seg).translate(0, 0.5, 0);
const U_CONE = (seg = 9) => new THREE.ConeGeometry(1, 1, seg).translate(0, 0.5, 0);
const U_ROOF = (() => {   // a pitched roof: triangle prism 1 wide (x), 1 tall, 1 deep (z)
  const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
})();

function backdrop(world, theme, kind, night, far) {
  const W = world.width, D = world.depth, cx = W / 2, cz = D / 2;
  const R = Math.max(55, Math.min(150, far * 0.6));          // how far out the scenery sits (inside the view distance)
  const S = R / 110;                                         // scale things with it so they look the same size
  const horizon = col(night ? '#141c2c' : theme.skyHorizon);
  const M = new Merge();
  const r = rng(world.def.name.length * 97 + 13);
  // a colour faded by distance
  const fade = (hex, x, z, extra = 0) => {
    const d = Math.hypot(x - cx, z - cz);
    const c = col(hex);
    if (night) c.multiplyScalar(0.18);
    return c.lerp(horizon, Math.min(0.85, 0.25 + d / (R * 2.4) + extra));
  };
  // walk round the map at a distance, placing things
  // size: how far the biggest of these things reaches from its middle (so even its edge stays outside the map)
  const around = (n, rMin, rMax, fn, size = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.4;
      const rr = (rMin + r() * (rMax - rMin) + size) * S;
      // go out from the middle to the map's edge in this direction, then further out (never inside the map,
      // corners included)
      const ca = Math.cos(a), sa = Math.sin(a);
      const edge = Math.min(Math.abs(ca) > 1e-6 ? W / 2 / Math.abs(ca) : Infinity, Math.abs(sa) > 1e-6 ? D / 2 / Math.abs(sa) : Infinity);
      const x = cx + ca * (edge + rr), z = cz + sa * (edge + rr);
      fn(x, z, a, rr);
    }
  };
  if (kind === 'tuscan') {
    // dry fields and vineyards, rolling hills with cypresses, a blue mountain ridge, and more of the town just outside
    M.geo(new THREE.CylinderGeometry(R * 2.2, R * 2.2, 0.2, 40), cx, -0.15, cz, 0, fade('#b9a56e', cx + R, cz, -0.2));
    around(9, 130, 190, (x, z) => { const w = (70 + r() * 60) * S; M.geo(U_CONE(7), x, -2, z, r() * 3, fade('#7d8fa6', x, z, 0.05), w, (45 + r() * 45) * S, w * 0.8, fade('#a7b4c4', x, z, 0.05), 0.75); }, 60);
    around(14, 70, 130, (x, z) => { const w = (45 + r() * 45) * S; M.geo(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, -2, z, r() * 3, fade(['#8f925a', '#9c9560', '#7f8a52'][Math.floor(r() * 3)], x, z), w, (14 + r() * 18) * S, w * 0.7); });
    around(40, 14, 70, (x, z) => { const hgt = (8 + r() * 7) * S; M.geo(U_CONE(7), x, 0, z, 0, fade('#33482c', x, z), 0.9 * S + r() * 0.4 * S, hgt, 0.9 * S + r() * 0.4 * S); }, 1.5);
    const walls = ['#e3a35a', '#e8bf6a', '#d9cfc0', '#cfc8bc', '#e6b277', '#d8a160', '#c9c2b6'];
    around(30, 2, 16, (x, z, a) => {
      const w = (6 + r() * 5) * S, hh = (7 + r() * 7) * S, d = (6 + r() * 4) * S;
      M.geo(U_BOX, x, 0, z, -a, fade(walls[Math.floor(r() * walls.length)], x, z, -0.15), w, hh, d);
      M.geo(U_ROOF, x, hh, z, -a + (r() < 0.5 ? Math.PI / 2 : 0), fade('#c98a5c', x, z, -0.15), w * 1.08, w * 0.28, d * 1.08);
      if (r() < 0.4) M.geo(U_BOX, x + 1.2 * S, hh + 0.5 * S, z, -a, fade('#d9cfc0', x, z, -0.15), 0.8 * S, 1.8 * S, 0.8 * S);
    }, 8);
  } else if (kind === 'village') {
    // farmland all round, rolling hills with cypresses and olive trees, and more of the village just outside
    M.geo(new THREE.CylinderGeometry(R * 2.2, R * 2.2, 0.2, 40), cx, -0.15, cz, 0, fade('#a39a5e', cx + R, cz, -0.2));
    around(14, 75, 140, (x, z) => { const w = (45 + r() * 45) * S; M.geo(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, -2, z, r() * 3, fade(['#7f8a52', '#8f8a56', '#6f7f4a'][Math.floor(r() * 3)], x, z), w, (16 + r() * 20) * S, w * 0.7); });
    around(46, 14, 70, (x, z) => { const hgt = (8 + r() * 7) * S; M.geo(U_CONE(7), x, 0, z, 0, fade('#2f4a2c', x, z), 0.9 * S + r() * 0.4 * S, hgt, 0.9 * S + r() * 0.4 * S); }, 1.5);   // cypresses
    around(28, 10, 55, (x, z) => { const w = (2.2 + r() * 1.5) * S; M.geo(U_CYL(6), x, 0, z, 0, fade('#5a4a38', x, z), 0.25 * S, 1.6 * S, 0.25 * S); M.geo(new THREE.SphereGeometry(1, 8, 6), x, 2.4 * S, z, r() * 3, fade('#7d8a6a', x, z), w, w * 0.7, w); }, 4);   // olives
    const walls = ['#e6c9a0', '#dcae7a', '#d39b6a', '#e8d6b8', '#c98a5e', '#cdb894', '#e3b98c'];
    around(30, 2, 16, (x, z, a) => {
      const w = (6 + r() * 5) * S, hh = (7 + r() * 6) * S, d = (6 + r() * 4) * S;
      M.geo(U_BOX, x, 0, z, -a, fade(walls[Math.floor(r() * walls.length)], x, z, -0.15), w, hh, d);
      M.geo(U_ROOF, x, hh, z, -a + (r() < 0.5 ? Math.PI / 2 : 0), fade('#b05a36', x, z, -0.15), w * 1.08, w * 0.3, d * 1.08);
    }, 8);
    // a hill town far off with its own tower
    const ta = r() * Math.PI * 2, tx = cx + Math.cos(ta) * (W / 2 + 95 * S), tz = cz + Math.sin(ta) * (D / 2 + 95 * S);
    M.geo(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), tx, -2, tz, 0, fade('#8a8656', tx, tz), 40 * S, 22 * S, 32 * S);
    for (let k = 0; k < 16; k++) { const ox = (r() - 0.5) * 34 * S, oz = (r() - 0.5) * 24 * S, hh = (5 + r() * 5) * S; M.geo(U_BOX, tx + ox, 17 * S, tz + oz, r(), fade(walls[k % walls.length], tx, tz), 5 * S, hh, 5 * S); M.geo(U_ROOF, tx + ox, 17 * S + hh, tz + oz, r(), fade('#b05a36', tx, tz), 5.3 * S, 1.6 * S, 5.3 * S); }
    M.geo(U_BOX, tx, 17 * S, tz, 0, fade('#cdb894', tx, tz), 3.5 * S, 20 * S, 3.5 * S);
    M.geo(U_CONE(4), tx, 37 * S, tz, Math.PI / 4, fade('#b05a36', tx, tz), 2.8 * S, 4 * S, 2.8 * S);
  } else if (kind === 'mesas') {
    around(16, 55, 110, (x, z) => { const h = (22 + r() * 30) * S, w = (18 + r() * 30) * S; M.geo(U_CYL(7, 0.82), x, 0, z, r() * 3, fade('#c79a64', x, z), w, h, w * (0.6 + r() * 0.6), fade('#d8b07a', x, z), 0.92); }, 10);
    around(22, 20, 60, (x, z) => { const w = (10 + r() * 18) * S; M.geo(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, -1, z, r() * 3, fade('#dfc08e', x, z), w * 1.6, (4 + r() * 6) * S, w); }, 32);
    around(10, 14, 30, (x, z) => { const h = (6 + r() * 6) * S, w = (6 + r() * 5) * S; M.geo(U_BOX, x, 0, z, r() * 3, fade('#d9c49c', x, z), w, h, w * 0.8); }, 7);
    around(5, 18, 35, (x, z) => { M.geo(U_CYL(8), x, 0, z, 0, fade('#8a8a86', x, z), 0.5 * S, 16 * S, 0.5 * S); M.geo(U_CYL(10), x, 16 * S, z, 0, fade('#bcb6a8', x, z), 3 * S, 4 * S, 3 * S); }, 3);  // water towers
  } else if (kind === 'factory') {
    around(8, 25, 55, (x, z) => { const h = (40 + r() * 25) * S, rad = (1.8 + r()) * S; M.geo(U_CYL(10, 0.85), x, 0, z, 0, fade('#8a5a44', x, z), rad, h, rad, fade('#e8e4dc', x, z, -0.05), 0.88); }, 3);
    around(3, 45, 80, (x, z) => { M.geo(new THREE.CylinderGeometry(0.75, 1, 1, 16, 1, true).translate(0, 0.5, 0), x, 0, z, 0, fade('#a8a8a2', x, z), 12 * S, 28 * S, 12 * S); }, 12);
    around(14, 15, 45, (x, z, a) => { const w = (16 + r() * 18) * S, h = (10 + r() * 8) * S; M.geo(U_BOX, x, 0, z, -a, fade('#7d7f82', x, z), w, h, 10 * S); for (let k = 0; k < 3; k++) M.geo(U_ROOF, x, h, z, -a + Math.PI / 2, fade('#5f656c', x, z), 6 * S, 3 * S, w / 3); }, 18);
    around(4, 30, 60, (x, z, a) => { M.geo(U_BOX, x, 0, z, -a, fade('#d0a020', x, z), 1.2 * S, 30 * S, 1.2 * S); M.geo(U_BOX, x, 29 * S, z, -a, fade('#d0a020', x, z), 18 * S, 1.2 * S, 1.2 * S); }, 10);  // cranes
  } else if (kind === 'mountains') {
    around(12, 80, 140, (x, z) => { const h = (55 + r() * 60) * S, w = (45 + r() * 40) * S; M.geo(U_CONE(8), x, 0, z, r() * 3, fade('#7d8a99', x, z), w, h, w, fade('#f4f7fa', x, z, -0.1), 0.6); });
    around(40, 18, 55, (x, z) => { const h = (9 + r() * 8) * S; M.geo(U_CYL(6), x, 0, z, 0, fade('#4a3a2c', x, z), 0.4 * S, h * 0.3, 0.4 * S); M.geo(U_CONE(7), x, h * 0.2, z, 0, fade('#2f4a3a', x, z), h * 0.28, h * 0.85, h * 0.28, fade('#eef2f5', x, z), 0.55); }, 5);
    around(2, 25, 45, (x, z) => { M.geo(U_CYL(6), x, 0, z, 0, fade('#c84a3a', x, z), 0.35 * S, 35 * S, 0.35 * S); }, 1);   // radio masts
  } else if (kind === 'harbour') {
    around(26, 12, 40, (x, z, a) => {
      const w = (7 + r() * 6) * S, h = (8 + r() * 8) * S, d = (7 + r() * 4) * S;
      M.geo(U_BOX, x, 0, z, -a, fade(['#a35a45', '#8e4a3a', '#c9b79a', '#7a6a5a'][Math.floor(r() * 4)], x, z), w, h, d);
      M.geo(U_ROOF, x, h, z, -a, fade('#4f5a66', x, z), w * 1.05, w * 0.45, d * 1.05);
    }, 9);
    around(4, 40, 70, (x, z, a) => { M.geo(U_BOX, x, 0, z, -a, fade('#c84a3a', x, z), 2 * S, 28 * S, 2 * S); M.geo(U_BOX, x, 27 * S, z, -a, fade('#c84a3a', x, z), 24 * S, 2 * S, 2 * S); }, 12);   // dock cranes
    around(2, 55, 75, (x, z) => { M.geo(U_CYL(10, 0.8), x, 0, z, 0, fade('#f0f0ea', x, z), 2.4 * S, 26 * S, 2.4 * S, fade('#c84a3a', x, z), 0.75); }, 3);   // lighthouse
  } else if (kind === 'cliffs') {
    around(18, 30, 70, (x, z, a) => { for (let k = 0; k < 3; k++) { const w = (30 + r() * 25) * S; M.geo(U_BOX, x, k * 9 * S, z, -a + r() * 0.3, fade(['#bdb39e', '#c9bfa8', '#aea48f'][k], x, z), w * (1 - k * 0.22), 10 * S, (12 + r() * 6) * S); } }, 29);
    around(5, 20, 40, (x, z, a) => { M.geo(U_BOX, x, 0, z, -a, fade('#d6c04a', x, z), 1 * S, 22 * S, 1 * S); M.geo(U_BOX, x, 21 * S, z, -a, fade('#7a6f62', x, z), 22 * S, 1.2 * S, 2 * S); }, 12);  // conveyors
  } else {   // rail yard
    around(14, 15, 40, (x, z, a) => { const w = (18 + r() * 14) * S, h = (10 + r() * 7) * S; M.geo(U_BOX, x, 0, z, -a, fade('#86503e', x, z), w, h, 12 * S); M.geo(U_ROOF, x, h, z, -a + Math.PI / 2, fade('#4c535a', x, z), 12 * S, 4 * S, w); }, 17);
    around(3, 25, 45, (x, z) => { M.geo(U_CYL(10), x, 0, z, 0, fade('#5c6168', x, z), 0.6 * S, 18 * S, 0.6 * S); M.geo(U_CYL(12), x, 18 * S, z, 0, fade('#8a3a2c', x, z), 4 * S, 6 * S, 4 * S); M.geo(U_CONE(12), x, 24 * S, z, 0, fade('#4c535a', x, z), 4.4 * S, 2.5 * S, 4.4 * S); }, 5);
    around(14, 70, 130, (x, z) => { const w = (50 + r() * 50) * S; M.geo(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, -2, z, r() * 3, fade('#7d8a6a', x, z), w, (14 + r() * 18) * S, w * 0.7); });
  }
  const mesh = new THREE.Mesh(M.build(), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  mesh.renderOrder = -5;
  return mesh;
}

// ---------- the dressing ----------
export function decorateMap(world, theme, group, { gfx = {}, night = false, shadows = false } = {}) {
  const T = DRESS[world.def.theme] || DRESS.desert;
  const lowDetail = gfx.modelDetail === 'low' || gfx.effects === 'low';
  const lam = (opts) => new THREE.MeshLambertMaterial(opts);
  const box = new Inst(new THREE.BoxGeometry(1, 1, 1), lam({ color: '#ffffff' }));
  const cyl = new Inst(new THREE.CylinderGeometry(1, 1, 1, 8), lam({ color: '#ffffff' }));
  const glow = new Inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }));   // lit glass and bulbs
  // a half disc standing up, its flat side down, facing +z (arches over windows and under bridges)
  const halfGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  const half = new Inst(halfGeo, lam({ color: '#ffffff' }));
  const halfGlow = new Inst(halfGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const matCol = (m, l = 0) => col((theme.mats[m] || theme.mats.wall)[1], l);
  const h = (a, b) => hash2(Math.floor(a * 7.3) + 101, Math.floor(b * 5.1) + 37);

  // caps along wall tops (and snow lying on them)
  const tops = topRuns(world);
  for (const t of tops) {
    if (t.house != null) continue;        // houses get their own cornice and roof (houses.js)
    const [ux, uz] = t.dir, [nx, nz] = t.n;
    const cxr = t.x + ux * t.len / 2 + nx * 0.03, czr = t.z + uz * t.len / 2 + nz * 0.03;
    const sx = ux ? t.len + 0.1 : 0.16, sz = uz ? t.len + 0.1 : 0.16;
    if (T.snowCaps && t.m !== 'roof') box.add(cxr, t.y + 0.07, czr, sx + (ux ? 0 : 0.08), 0.14, sz + (uz ? 0 : 0.08), '#f6f8fa');
    else if (t.m !== 'stairs') box.add(cxr, t.y + 0.04, czr, sx, 0.08, sz, matCol(t.m, 0.1));
    // wooden roof beams poking out of desert buildings
    if (T.beams && T.beams.includes(t.m) && !lowDetail && t.y > 2.5) {
      for (let s = 0.45; s < t.len - 0.2; s += 0.9) {
        const bx = t.x + ux * s + nx * 0.18, bz = t.z + uz * s + nz * 0.18;
        cyl.add(bx, t.y - 0.45, bz, 0.07, 0.4, 0.07, T.beamColor, 0, nx ? 0 : Math.PI / 2, nx ? Math.PI / 2 : 0);
      }
    }
  }
  // snow lying on the top of every wall (snow theme)
  if (T.snowCaps) {
    for (let iz = 0; iz < world.h; iz++) {
      let run = null;
      for (let ix = 0; ix <= world.w; ix++) {
        const sp = ix < world.w ? world.cellSpans(ix, iz) : [];
        const t = sp.length ? sp[sp.length - 1] : null;
        const y = t && t.prop < 0 && t.y1 > 1 && t.m !== 'stairs' ? t.y1 : 0;
        if (run && y === run.y) { run.n++; continue; }
        if (run) box.add((run.ix + run.n / 2) * CELL, run.y + 0.05, (iz + 0.5) * CELL, run.n * CELL, 0.1, CELL, '#f4f7fa');
        run = y ? { ix, n: 1, y } : null;
      }
    }
  }

  // windows, doors and wall clutter along wall faces at ground level
  const faces = faceRuns(world);
  const add = (r, s, y, w, hh, depth, c, glowing = false) => {
    const [ux, uz] = r.dir, [nx, nz] = r.n;
    const x = r.x + ux * s + nx * depth / 2, z = r.z + uz * s + nz * depth / 2;
    const sx = ux ? w : depth, sz = uz ? w : depth;
    (glowing ? glow : box).add(x, y, z, sx, hh, sz, c);
  };
  const litWarm = col('#ffcf7a'), glass = col(T.glass);
  let lampCount = 0;
  const lamps = [], signs = [];
  for (const r of faces) {
    if (r.house != null) continue;        // dressed by houses.js
    const winMat = T.windowOn.includes(r.m);
    // windows on buildings, upstairs too
    if (winMat && r.h >= 2.7 && r.len >= 2.4) {
      const n = Math.max(1, Math.floor((r.len - 0.8) / 3));
      const gap = r.len / n;
      const doorAt = r.len >= 3 && h(r.x, r.z) < 0.35 ? Math.floor(h(r.z, r.x) * n) : -1;
      for (let i = 0; i < n; i++) {
        const s = gap * (i + 0.5);
        const floors = r.h >= 6.2 ? [1.75, 5.35] : [1.75];
        for (const fy of floors) {
          if (fy === 1.75 && i === doorAt) {
            add(r, s, 1.15, 1.25, 2.3, 0.05, col(T.frame, -0.1));
            add(r, s, 1.1, 1.05, 2.15, 0.08, col(T.door));
            add(r, s + 0.35, 1.05, 0.08, 0.08, 0.14, '#c8b060');
            continue;
          }
          const lit = night && h(s + r.x, fy + r.z) < 0.45;
          add(r, s, fy, 1.05, 1.3, 0.05, col(T.frame));
          add(r, s, fy + 0.02, 0.86, 1.1, 0.07, lit ? litWarm : glass, lit);
          add(r, s, fy, 0.05, 1.1, 0.085, col(T.frame));                       // mullion
          add(r, s, fy - 0.7, 1.2, 0.07, 0.14, col(T.frame, -0.06));           // sill
          if (T.shutters && !lowDetail) { add(r, s - 0.73, fy, 0.38, 1.25, 0.06, col(T.shutters)); add(r, s + 0.73, fy, 0.38, 1.25, 0.06, col(T.shutters)); }
        }
      }
      continue;
    }
    // plain walls: a darker base band and columns every few metres so big walls aren't flat
    if (r.m !== 'low' && r.m !== 'stairs' && r.m !== 'platform') {
      add(r, r.len / 2, 0.16, r.len, 0.32, 0.05, matCol(r.m, -0.07));
      if (T.pilasters && r.h >= 2.5 && r.len >= 4 && (r.m === 'mass' || r.m === 'wall')) {
        const n = Math.floor(r.len / 4.5);
        for (let i = 1; i <= n; i++) {
          const s = (r.len / (n + 1)) * i;
          const hh = Math.min(r.h, 9);
          add(r, s, hh / 2, 0.5, hh, 0.12, matCol(r.m, 0.05));
          add(r, s, hh - 0.12, 0.62, 0.22, 0.16, matCol(r.m, 0.1));
        }
      }
    }
    if (lowDetail || r.len < 3) continue;
    // one or two things on a long wall
    const per = Math.max(1, Math.floor(r.len / 8));
    for (let i = 0; i < per; i++) {
      const s = (r.len / per) * (i + 0.3 + h(r.x + i, r.z) * 0.4);
      const kind = T.items[Math.floor(h(r.z + i, r.x + s) * T.items.length)];
      const [ux, uz] = r.dir, [nx, nz] = r.n;
      const px = r.x + ux * s, pz = r.z + uz * s;
      if (kind === 'lamp' && r.h >= 3.2) {
        const y = Math.min(r.h - 0.5, 3.0);
        add(r, s, y, 0.12, 0.12, 0.42, '#2a2a2a');
        add(r, s, y - 0.1, 0.32, 0.1, 0.3, '#333333');
        const lx = px + nx * 0.3, lz = pz + nz * 0.3;
        glow.add(lx, y - 0.18, lz, 0.22, 0.05, 0.18, night ? '#fff0c0' : '#e8e4d8');
        lamps.push([lx, y - 0.25, lz]);
        lampCount++;
      } else if (kind === 'pipe') {
        const top = Math.min(r.h - 0.2, 7);
        cyl.add(px + nx * 0.12, top / 2, pz + nz * 0.12, 0.06, top, 0.06, '#5c6066');
        for (let y = 0.8; y < top; y += 1.6) add(r, s, y, 0.16, 0.05, 0.14, '#3a3d42');
        if (r.h > 3) { add(r, s + 0.6, top - 0.25, 1.3, 0.12, 0.2, '#5c6066'); }
      } else if (kind === 'vent') {
        const y = Math.min(r.h - 0.6, 2.6);
        add(r, s, y, 0.8, 0.5, 0.08, '#6c7076');
        for (let k = 0; k < 4; k++) add(r, s, y - 0.18 + k * 0.12, 0.7, 0.03, 0.1, '#30343a');
      } else if (kind === 'ac' && r.h >= 3.4) {
        const y = Math.min(r.h - 0.6, 3.1);
        add(r, s, y, 0.85, 0.6, 0.4, '#d6d6d0');
        add(r, s, y, 0.5, 0.45, 0.42, '#55595e');
      } else if (kind === 'box') {
        add(r, s, 1.45, 0.42, 0.55, 0.16, '#8a8f94');
        add(r, s, 1.45, 0.36, 0.06, 0.17, '#5a5e62');
        cyl.add(px + nx * 0.05, 0.6, pz + nz * 0.05, 0.025, 1.2, 0.025, '#2a2a2a');
      } else if (kind === 'sign') {
        signs.push([r, s, Math.min(r.h - 0.8, 2.2), Math.floor(h(px, pz) * 4)]);
      }
    }
  }
  // signs: one textured instanced quad sheet
  if (signs.length) {
    const tex = signTex();
    const geo = new THREE.PlaneGeometry(0.7, 0.7);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    // pick a quarter of the sheet per sign by giving each its own geometry UVs (4 variants)
    for (let v = 0; v < 4; v++) {
      const list = signs.filter(sg => sg[3] === v);
      if (!list.length) continue;
      const g = geo.clone();
      const uv = g.attributes.uv, u0 = (v % 2) * 0.5, v0 = v < 2 ? 0.5 : 0;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
      const im = new THREE.InstancedMesh(g, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
      list.forEach(([r, s, y], i) => {
        const [ux, uz] = r.dir, [nx, nz] = r.n;
        m4.compose(new THREE.Vector3(r.x + ux * s + nx * 0.03, y, r.z + uz * s + nz * 0.03), q.setFromEuler(e.set(0, Math.atan2(nx, nz), 0)), one);
        im.setMatrixAt(i, m4);
      });
      group.add(im);
    }
  }
  // village houses: roofs, windows, doors, balconies, landmarks; bridges, archways and paving
  if (world.houses && world.houses.length) {
    const I = { box, cyl, glow, half, halfGlow };
    for (const l of dressHouses(world, theme, group, I, { night, lowDetail, shadows })) { lamps.push(l); lampCount++; }
    for (const d of world.deco || []) villageDeco(world, d, I, group, { night, shadows });
  }
  box.build(group, shadows); cyl.build(group, shadows); glow.build(group);
  half.build(group, shadows); halfGlow.build(group);
  // a soft glow round lamps at night
  if (night && lamps.length && !lowDetail) {
    const tex = canvasTex(64, (g, n) => { const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); gr.addColorStop(0, 'rgba(255,220,150,0.9)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); });
    for (const [x, y, z] of lamps) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
      s.position.set(x, y, z); s.scale.setScalar(1.6);
      group.add(s);
    }
  }

  // ground detail: cracks, stains, oil, puddles, drifts against walls, painted lines
  if (!lowDetail) {
    const kinds = [...new Set(T.decals)];
    const inst = {};
    for (const k of kinds) {
      const tex = canvasTex(128, DECAL[k]);
      const tint = k === 'drift' ? col(T.drift || '#ffffff') : col('#ffffff');
      inst[k] = new Inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex, color: tint, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    }
    const r = rng(world.def.name.length * 31 + 7);
    // scattered on open ground
    const scatter = kinds.filter(k => k !== 'drift' && k !== 'line');
    const n = Math.floor(world.width * world.depth / 28);
    for (let i = 0; i < n && scatter.length; i++) {
      const x = r() * world.width, z = r() * world.depth;
      const sp = world.cellSpans(Math.floor(x / CELL), Math.floor(z / CELL));
      if (sp.length) continue;
      const k = scatter[Math.floor(r() * scatter.length)];
      const s = k === 'puddle' ? 1.5 + r() * 2 : k === 'oil' ? 1 + r() * 1.5 : 1.2 + r() * 2.2;
      inst[k].add(x, 0.012 + r() * 0.004, z, s, 1, s * (0.7 + r() * 0.5), '#ffffff', r() * Math.PI * 2);
    }
    // drifts and painted lines run along the bottom of walls
    for (const f of faces) {
      if (f.len < 2) continue;
      const [ux, uz] = f.dir, [nx, nz] = f.n;
      if (inst.drift) {
        const d = 0.9;
        inst.drift.add(f.x + ux * f.len / 2 + nx * d / 2, 0.014, f.z + uz * f.len / 2 + nz * d / 2, f.len, 1, d, '#ffffff', Math.atan2(-nx, -nz));
      }
      if (inst.line && f.len >= 4 && h(f.x, f.z) < 0.5) {
        const d = 0.45;
        inst.line.add(f.x + ux * f.len / 2 + nx * 0.7, 0.013, f.z + uz * f.len / 2 + nz * 0.7, f.len - 0.6, 1, d, '#ffffff', Math.atan2(nx, nz));
      }
    }
    for (const k of kinds) { const m = inst[k].build(group); if (m) m.renderOrder = 1; }
    // tufts of dry grass along the foot of walls and in the corners of the streets
    if (T.tufts) {
      const blade = new Inst(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
      const tuft = (x, z) => {
        const n = 4 + Math.floor(r() * 4), hgt = 0.18 + r() * 0.22;
        for (let b = 0; b < n; b++) blade.add(x + (r() - 0.5) * 0.25, 0, z + (r() - 0.5) * 0.25, 0.05, hgt * (0.6 + r() * 0.6), 1, ['#c9a85a', '#b89848', '#d6bb72', '#a8904a'][Math.floor(r() * 4)], r() * Math.PI, (r() - 0.5) * 0.5, (r() - 0.5) * 0.5);
      };
      for (const f of faces) {
        if (f.len < 2) continue;
        const [ux, uz] = f.dir, [nx, nz] = f.n;
        for (let s = 0.3; s < f.len; s += 0.6 + r() * 1.6) if (r() < 0.45) tuft(f.x + ux * s + nx * 0.18, f.z + uz * s + nz * 0.18);
      }
      blade.build(group, false);
    }
  }

  // distant scenery
  group.add(backdrop(world, theme, T.backdrop, night, gfx.viewDistance || 170));
  return { lamps: lampCount };
}
