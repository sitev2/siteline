// Builds the 3D scene for a map from the span grid in world.js plus props.
import * as THREE from 'three';
import { CELL, hash2 } from './world.js';
import { makeTexture, letterTexture } from './textures.js';
import { decorateMap } from './mapdeco.js';

export const THEMES = {
  desert: {
    skyTop: '#4f8fd0', skyHorizon: '#f2dcb4', fog: '#ead7b3', fogNear: 45, fogFar: 170,
    sun: '#fff1d6', sunIntensity: 2.6, hemiSky: '#cfe3ff', hemiGround: '#c2a477', hemiIntensity: 1.25,
    floor: ['sand', '#d6bb8a'],
    mats: {
      mass: ['blocks', '#c8a26c'], wall: ['blocks', '#c49a62'], building: ['plaster', '#dcc7a0'],
      pillar: ['blocks', '#b89361'], low: ['blocks', '#dcc49a'], slab: ['concrete', '#b8ab93'],
      roof: ['crate', '#a9573a'], stairs: ['blocks', '#cdb48a'], platform: ['blocks', '#bf9f70'],
    },
    crate: ['crate', '#9c6d3c'], bigCrate: ['crate', '#7d5130'],
    barrels: ['#3f6f8f', '#9a3b2c', '#5d7a3a', '#b0802c'],
    truck: { body: '#c7c1ae', cab: '#9a3b2c', glass: '#2a3540', tyre: '#1d1d1d' },
    site: '#d8603f',
  },
  // steel works: cool grey concrete, rusty metal, hazy overcast light
  industrial: {
    skyTop: '#7f93a8', skyHorizon: '#d5d9db', fog: '#c9ced1', fogNear: 40, fogFar: 150,
    sun: '#f4f1e8', sunIntensity: 2.0, hemiSky: '#dfe6ee', hemiGround: '#8a8478', hemiIntensity: 1.45,
    floor: ['concrete', '#9a978f'],
    mats: {
      mass: ['brick', '#8a5a44'], wall: ['concrete', '#a3a199'], building: ['brick', '#94604a'],
      pillar: ['metal', '#6f7378'], low: ['concrete', '#c9a23a'], slab: ['metal', '#7c8086'],
      roof: ['metal', '#5f656c'], stairs: ['metal', '#80858b'], platform: ['concrete', '#8e8b84'],
      machine: ['metal', '#4c5258'],
    },
    crate: ['crate', '#8c6a42'], bigCrate: ['crate', '#5f7f8f'],
    barrels: ['#c9a23a', '#3e5f86', '#8a3a2c', '#4b6b46'],
    truck: { body: '#d0cbbd', cab: '#2f5f8a', glass: '#2a3540', tyre: '#1d1d1d' },
    site: '#e0a020',
  },
  // snowed-in research station: white ground, pale timber and painted panels, low winter sun
  snow: {
    skyTop: '#6f9cc8', skyHorizon: '#e8eef4', fog: '#e3e9ef', fogNear: 35, fogFar: 140,
    sun: '#fff6e8', sunIntensity: 2.2, hemiSky: '#e4efff', hemiGround: '#b8c4d0', hemiIntensity: 1.4,
    floor: ['sand', '#e8edf1'],
    mats: {
      mass: ['blocks', '#9aa3ab'], wall: ['blocks', '#a8b0b6'], building: ['plaster', '#c84a3a'],
      pillar: ['metal', '#6c747c'], low: ['sand', '#f2f5f7'], slab: ['metal', '#8a939b'],
      roof: ['metal', '#59626b'], stairs: ['metal', '#8a939b'], platform: ['concrete', '#b6bec5'],
      machine: ['metal', '#d6b038'], fence: ['metal', '#7b848c'],
    },
    crate: ['crate', '#9c7a52'], bigCrate: ['crate', '#5f7f9f'],
    barrels: ['#c84a3a', '#d6b038', '#3e6f96', '#4b6b46'],
    truck: { body: '#e0e0dc', cab: '#c84a3a', glass: '#2a3540', tyre: '#1d1d1d' },
    site: '#e0503a',
  },
  // brick dock town: red brick, slate roofs, grey cobbled ground, soft sea light
  harbour: {
    skyTop: '#5b8fc0', skyHorizon: '#dfe8ec', fog: '#d4dde2', fogNear: 45, fogFar: 160,
    sun: '#fff3dc', sunIntensity: 2.4, hemiSky: '#d8e8ff', hemiGround: '#9a8a7a', hemiIntensity: 1.3,
    floor: ['blocks', '#8f8d88'],
    mats: {
      mass: ['brick', '#8e4a3a'], wall: ['brick', '#9a5442'], building: ['brick', '#a35a45'],
      pillar: ['blocks', '#6e6a64'], low: ['blocks', '#a9a59c'], slab: ['crate', '#7c5a3a'],
      roof: ['metal', '#4f5a66'], stairs: ['crate', '#7c5a3a'], platform: ['crate', '#6e5034'],
    },
    crate: ['crate', '#8c6a42'], bigCrate: ['crate', '#4f6f5f'],
    barrels: ['#3e5f86', '#8a3a2c', '#4b6b46', '#b0802c'],
    truck: { body: '#c9c3b0', cab: '#3a6a4a', glass: '#2a3540', tyre: '#1d1d1d' },
    site: '#e06a3a',
  },
  // sunny hill village: stone and plaster houses (each its own colour, see world.houses), terracotta roofs,
  // cobbled streets, a paved church piazza and a narrow green canal
  village: {
    skyTop: '#4a8fd6', skyHorizon: '#f3e2c2', fog: '#eadcc4', fogNear: 45, fogFar: 170,
    sun: '#fff0d6', sunIntensity: 2.7, hemiSky: '#d4e6ff', hemiGround: '#c9a882', hemiIntensity: 1.25,
    floor: ['cobble', '#c4b393'], floorTile: 2.4,
    mats: {
      // house walls are white here and tinted per house
      stucco: ['plaster', '#ffffff'], stone: ['blocks', '#ffffff'], brick: ['brick', '#ffffff'],
      mass: ['plaster', '#e6c9a0'], wall: ['blocks', '#d8c8a8'], building: ['plaster', '#efe2cc'],
      pillar: ['blocks', '#d9cbb0'], low: ['blocks', '#cdbd9e'], slab: ['crate', '#7a5636'], beams: ['crate', '#6a4a2e'],
      roof: ['crate', '#a5512f'], stairs: ['blocks', '#cfc2a8'], platform: ['blocks', '#cdbd9e'],
      quay: ['blocks', '#cbbd9f'], bridge: ['blocks', '#d6c8ab'], steps: ['blocks', '#d6c8ab'],
    },
    crate: ['crate', '#8c6a42'], bigCrate: ['crate', '#6a5034'],
    barrels: ['#7a4a2e', '#6a4028', '#80512f', '#5f3a24'],
    truck: { body: '#c9c3b0', cab: '#3a6a4a', glass: '#2a3540', tyre: '#1d1d1d' },
    site: '#e06a3a',
    water: '#3e7266',
  },
  // Tuscan hill town (Flame): sun-faded orange, ochre and grey stone, flaking plaster, pale terracotta
  // roofs, dusty cobbles, pale plywood crates on pallets, wooden barrels, a little blue pickup
  tuscan: {
    skyTop: '#6fa3d6', skyHorizon: '#f1e6d2', fog: '#ece2cf', fogNear: 50, fogFar: 180,
    sun: '#fff1da', sunIntensity: 2.8, hemiSky: '#dbe9ff', hemiGround: '#cdb592', hemiIntensity: 1.3,
    floor: ['setts', '#c7bca6'], floorTile: 2.6,
    mats: {
      stucco: ['oldplaster', '#ffffff'], stone: ['blocks', '#ffffff'], brick: ['brick', '#ffffff'],
      mass: ['oldplaster', '#e3a35a'], wall: ['blocks', '#d6cfc3'], building: ['oldplaster', '#e9c27a'],
      pillar: ['blocks', '#d8d1c5'], low: ['blocks', '#d4cdc1'], slab: ['blocks', '#d9d3c8'], beams: ['crate', '#6a4a2e'],
      roof: ['crate', '#c98a5c'], stairs: ['blocks', '#d2cbbf'], platform: ['blocks', '#cdc6ba'],
      quay: ['blocks', '#cbc4b8'], bridge: ['blocks', '#d6cfc3'], steps: ['blocks', '#d6cfc3'],
    },
    crate: ['ply', '#ddcdb0'], crateStyle: 'ply', woodBarrels: true,
    bigCrate: ['crate', '#6a5034'],
    barrels: ['#9a6a40', '#a8764a', '#8f6038', '#a06e44'],
    truck: { body: '#7aa6c8', cab: '#7aa6c8', glass: '#2c3a44', tyre: '#1d1d1d', mini: true },
    site: '#e06a3a',
    pipes: true, antennas: true,
  },
  // stone quarry: pale limestone and dusty ground under a hot sky
  quarry: {
    skyTop: '#3f86d0', skyHorizon: '#efe2c8', fog: '#e6dcc6', fogNear: 45, fogFar: 160,
    sun: '#fff0d0', sunIntensity: 2.7, hemiSky: '#d0e4ff', hemiGround: '#b7a892', hemiIntensity: 1.2,
    floor: ['sand', '#cbbfa6'],
    mats: {
      mass: ['blocks', '#bdb39e'], wall: ['blocks', '#c4b9a2'], building: ['plaster', '#d8cdb4'],
      pillar: ['blocks', '#a99f8a'], low: ['blocks', '#d2c8b0'], slab: ['concrete', '#b0a690'],
      roof: ['metal', '#7a6f62'], stairs: ['blocks', '#c9bfa8'], platform: ['blocks', '#b8ad96'],
    },
    crate: ['crate', '#9c6d3c'], bigCrate: ['crate', '#7d5130'],
    barrels: ['#c9a23a', '#9a3b2c', '#3f6f8f', '#5d7a3a'],
    truck: { body: '#d6c04a', cab: '#d6c04a', glass: '#2a3540', tyre: '#1d1d1d' },
    site: '#d8603f',
  },
  // rail yard: gravel, dark sleepers, painted goods wagons, late-afternoon light
  railyard: {
    skyTop: '#6a8fbf', skyHorizon: '#f0d8b8', fog: '#ddd0bd', fogNear: 45, fogFar: 160,
    sun: '#ffe2bc', sunIntensity: 2.4, hemiSky: '#d6e2f6', hemiGround: '#8c7f70', hemiIntensity: 1.3,
    floor: ['sand', '#9c938a'],
    mats: {
      mass: ['brick', '#7a4a3c'], wall: ['concrete', '#9d968c'], building: ['brick', '#86503e'],
      pillar: ['metal', '#5c6168'], low: ['concrete', '#aaa398'], slab: ['crate', '#6e5034'],
      roof: ['metal', '#4c535a'], stairs: ['metal', '#6f747a'], platform: ['concrete', '#a59e92'],
      wagon: ['metal', '#8a3a2c'],
    },
    crate: ['crate', '#8c6a42'], bigCrate: ['crate', '#4f6f8f'],
    barrels: ['#3e5f86', '#8a3a2c', '#c9a23a', '#4b6b46'],
    truck: { body: '#c9c3b0', cab: '#2f5f8a', glass: '#2a3540', tyre: '#1d1d1d' },
    site: '#d8603f',
  },
};

// Merge visible faces of all non-prop spans into one geometry per material,
// with world-space UVs (1 texture tile = 3 m) and baked darkening near the ground.
const INSIDE = [0.96, 0.92, 0.84];
function meshSpans(world, theme = {}) {
  const pal = theme.palette;
  const palCols = pal ? pal.colors.map(c => new THREE.Color(c)) : null;
  const houseCols = (world.houses || []).map(hs => { const c = new THREE.Color(hs.color || '#ffffff'); return [c.r, c.g, c.b]; });
  const groups = new Map();
  const tile = 3;
  const g = (m) => {
    if (!groups.has(m)) groups.set(m, { pos: [], nor: [], uv: [], col: [] });
    return groups.get(m);
  };
  const quad = (G, a, b, c, d, n, uvs, cs) => {
    for (const [p, u, cc] of [[a, uvs[0], cs[0]], [b, uvs[1], cs[1]], [c, uvs[2], cs[2]], [a, uvs[0], cs[0]], [c, uvs[2], cs[2]], [d, uvs[3], cs[3]]]) {
      G.pos.push(...p); G.nor.push(...n); G.uv.push(...u); G.col.push(...cc);
    }
  };
  // walls darken towards the ground: straight from 62 % at the foot to full at SHADE_TOP, then even.
  // Faces are split at SHADE_TOP so two pieces of one wall always meet in the same shade.
  const SHADE_TOP = 2.5;
  const shadeAt = (y, base) => {
    const k = Math.min(1, 0.62 + 0.38 * Math.max(0, y) / SHADE_TOP);
    return [base * k, base * k, base * k];
  };
  // what hides a wall face: other walls only. Props (barrels, crates, carts…) are drawn as their own
  // smaller shapes, and '_' spans are invisible, so the wall behind them must still be drawn.
  const solidOnly = (spans) => spans.filter(o => o.prop < 0 && o.m[0] !== '_');
  for (let iz = 0; iz < world.h; iz++) {
    for (let ix = 0; ix < world.w; ix++) {
      const spans = world.cellSpans(ix, iz);
      if (!spans.length) continue;
      const x0 = ix * CELL, x1 = x0 + CELL, z0 = iz * CELL, z1 = z0 + CELL;
      // tint per 1.5 m block so walls aren't uniform
      const v = 0.93 + hash2(Math.floor(ix / 3) + 11, Math.floor(iz / 3) + 7) * 0.12;
      for (const s of spans) {
        if (s.prop >= 0 || s.m[0] === '_') continue;     // props are drawn on their own; '_' = invisible
        const G = g(s.m);
        let tint = null;
        if (s.house != null) tint = houseCols[s.house];
        else if (pal && pal.mats.includes(s.m)) {
          const c = palCols[Math.floor(hash2(Math.floor(ix / pal.block) + 3, Math.floor(iz / pal.block) + 9) * palCols.length)];
          tint = [c.r, c.g, c.b];
        }
        const vv = s.house != null ? 1 : v;     // a house is one even colour
        const top = tint ? [vv * tint[0], vv * tint[1], vv * tint[2]] : [v, v, v];
        // top face
        if (!spans.some(o => o !== s && o.y0 <= s.y1 + 0.001 && o.y1 > s.y1 + 0.001)) {
          quad(G, [x0, s.y1, z0], [x0, s.y1, z1], [x1, s.y1, z1], [x1, s.y1, z0], [0, 1, 0],
            [[x0 / tile, z0 / tile], [x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile]], [top, top, top, top]);
        }
        // underside (balconies, upper floors, roofs)
        if (s.y0 > 0.01 && !spans.some(o => o !== s && o.y1 >= s.y0 - 0.001 && o.y0 < s.y0 - 0.001)) {
          const u = [v * 0.72, v * 0.72, v * 0.72];
          quad(G, [x0, s.y0, z0], [x1, s.y0, z0], [x1, s.y0, z1], [x0, s.y0, z1], [0, -1, 0],
            [[x0 / tile, z0 / tile], [x1 / tile, z0 / tile], [x1 / tile, z1 / tile], [x0 / tile, z1 / tile]], [u, u, u, u]);
        }
        // sides: expose only the parts not covered by the neighbour's spans
        const sides = [
          [ix + 1, iz, [1, 0, 0], [x1, z1], [x1, z0]],
          [ix - 1, iz, [-1, 0, 0], [x0, z0], [x0, z1]],
          [ix, iz + 1, [0, 0, 1], [x0, z1], [x1, z1]],
          [ix, iz - 1, [0, 0, -1], [x1, z0], [x0, z0]],
        ];
        for (const [nx, nz, n, a, b] of sides) {
          if (nx < 0 || nz < 0 || nx >= world.w || nz >= world.h) continue;
          const nspans = solidOnly(world.cellSpans(nx, nz));
          let parts = [[s.y0, s.y1]];
          for (const o of nspans) {
            const next = [];
            for (const [p0, p1] of parts) {
              if (o.y1 <= p0 || o.y0 >= p1) { next.push([p0, p1]); continue; }
              if (o.y0 > p0) next.push([p0, o.y0]);
              if (o.y1 < p1) next.push([o.y1, p1]);
            }
            parts = next;
            if (!parts.length) break;
          }
          const ua = (n[0] !== 0 ? a[1] : a[0]) / tile, ub = (n[0] !== 0 ? b[1] : b[0]) / tile;
          // inside a house (a room carved out of it): plain cream plaster
          // (a room, not a passage: the neighbour has none of the house left above it)
          const inside = s.house != null && world.houseAt(nx, nz) === s.house && !nspans.some(o => o.house === s.house);
          const pieces = [];
          for (const [p0, p1] of parts) {
            if (p0 < SHADE_TOP && p1 > SHADE_TOP) pieces.push([p0, SHADE_TOP], [SHADE_TOP, p1]); else pieces.push([p0, p1]);
          }
          for (const [p0, p1] of pieces) {
            if (p1 - p0 < 0.005) continue;
            let c0 = shadeAt(p0, vv), c1 = shadeAt(p1, vv);
            if (inside) { c0 = c0.map((q, k) => q * INSIDE[k]); c1 = c1.map((q, k) => q * INSIDE[k]); }
            else if (tint) { c0 = c0.map((q, k) => q * tint[k]); c1 = c1.map((q, k) => q * tint[k]); }
            quad(G, [a[0], p0, a[1]], [b[0], p0, b[1]], [b[0], p1, b[1]], [a[0], p1, a[1]], n,
              [[ua, p0 / tile], [ub, p0 / tile], [ub, p1 / tile], [ua, p1 / tile]], [c0, c0, c1, c1]);
          }
        }
      }
    }
  }
  const out = new Map();
  for (const [m, G] of groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3));
    geo.computeBoundingSphere();
    out.set(m, geo);
  }
  return out;
}

function skyDome(theme) {
  const geo = new THREE.SphereGeometry(500, 24, 12);
  const top = new THREE.Color(theme.skyTop), hor = new THREE.Color(theme.skyHorizon);
  const colors = [];
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = Math.pow(Math.max(0, p.getY(i) / 500), 0.6);
    const c = hor.clone().lerp(top, k);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.renderOrder = -10;
  return mesh;
}

const lam = (color) => new THREE.MeshLambertMaterial({ color });

function buildTruck(p, theme, shadows) {
  const g = new THREE.Group();
  const T = theme.truck;
  const L = Math.max(p.x1 - p.x0, p.z1 - p.z0), Wd = Math.min(p.x1 - p.x0, p.z1 - p.z0);
  const along = p.facing === '+x' || p.facing === '-x';
  const add = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = shadows; m.receiveShadow = shadows;
    g.add(m);
    return m;
  };
  // built facing +x, centred at the origin
  const body = lam(T.body), cab = lam(T.cab), glass = lam(T.glass), tyre = lam(T.tyre), dark = lam('#333');
  const bed = p.bed || 1.4;
  if (T.mini) {
    // a small pickup: short rounded cab with big round lamps, a low flat bed with drop sides
    const cl = 2.0, cabH = p.h - 0.4;          // flat sides up to here, then a low rounded roof up to the cab height you can stand on
    add(L - 0.2, 0.3, Wd - 0.3, 0, 0.42, 0, dark);                                   // chassis
    add(L - cl, bed - 0.57, Wd, -cl / 2, 0.57 + (bed - 0.57) / 2, 0, body);          // solid body under the bed
    add(L - cl + 0.02, 0.08, Wd + 0.02, -cl / 2, bed - 0.04, 0, lam('#5f88aa'));      // rim of the bed
    add(L - cl - 0.2, 0.03, Wd - 0.2, -cl / 2, bed + 0.005, 0, lam('#6a5a48'));       // wooden bed floor
    for (const sz of [1, -1]) {
      add(L - cl, 0.32, 0.05, -cl / 2, bed + 0.16, sz * (Wd / 2 - 0.025), body);      // low drop sides
      for (let k = 0; k <= 4; k++) add(0.05, 0.32, 0.07, -L / 2 + 0.05 + k * (L - cl - 0.1) / 4, bed + 0.16, sz * (Wd / 2 - 0.03), lam('#5f88aa'));
    }
    add(0.05, 0.32, Wd, -L / 2 + 0.025, bed + 0.16, 0, body);
    for (const sz of [1, -1]) add(0.06, 0.12, 0.25, -L / 2 - 0.01, 0.95, sz * (Wd / 2 - 0.25), lam('#b8402e'));   // tail lights
    add(cl, cabH - 0.57, Wd, L / 2 - cl / 2, 0.57 + (cabH - 0.57) / 2, 0, cab);       // cab
    for (const sz of [1, -1]) add(0.06, 0.06, 0.32, L / 2 - cl + 0.1, cabH - 0.3, sz * (Wd / 2 + 0.15), lam('#2a2a2a'));   // mirrors
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(Wd / 2, Wd / 2, cl, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), cab);
    roof.scale.set(1, 0.4 / (Wd / 2), 1); roof.position.set(L / 2 - cl / 2, cabH, 0); roof.castShadow = shadows; g.add(roof);
    add(0.04, 0.55, Wd - 0.35, L / 2 + 0.002, cabH - 0.05, 0, glass);               // windscreen
    for (const sz of [1, -1]) add(0.9, 0.45, 0.04, L / 2 - cl / 2 + 0.2, cabH - 0.05, sz * (Wd / 2 + 0.002), glass);
    add(0.12, 0.22, Wd + 0.05, L / 2 + 0.04, 0.55, 0, lam('#c9ced2'));             // bumper
    for (const sz of [1, -1]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 14).rotateZ(Math.PI / 2), lam('#f4f2ea'));
      lamp.position.set(L / 2 + 0.03, 0.95, sz * (Wd / 2 - 0.3)); g.add(lamp);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
    for (const wx of [L / 2 - 0.8, -L / 2 + 1.0]) for (const sz of [1, -1]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.rotation.x = Math.PI / 2; w.position.set(wx, 0.34, sz * (Wd / 2 - 0.15));
      w.castShadow = shadows; g.add(w);
    }
    g.position.set((p.x0 + p.x1) / 2, 0, (p.z0 + p.z1) / 2);
    g.rotation.y = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[p.facing || '+x'];
    return g;
  }
  add(L, 0.35, Wd - 0.1, 0, 0.75, 0, dark);                       // chassis
  add(L - 2, 0.12, Wd, -1, bed - 0.06, 0, body);                  // bed floor
  add(L - 2, 0.5, 0.08, -1, bed + 0.25, Wd / 2 - 0.04, body);      // bed rails
  add(L - 2, 0.5, 0.08, -1, bed + 0.25, -Wd / 2 + 0.04, body);
  add(0.08, 0.5, Wd, -L / 2 + 0.04, bed + 0.25, 0, body);
  add(1.95, p.h - 0.85, Wd, L / 2 - 1, 0.85 + (p.h - 0.85) / 2, 0, cab); // cab
  add(0.05, 0.7, Wd - 0.3, L / 2 + 0.005, p.h - 0.6, 0, glass);    // windscreen
  add(1.2, 0.6, 0.05, L / 2 - 1, p.h - 0.6, Wd / 2 + 0.005, glass);
  add(1.2, 0.6, 0.05, L / 2 - 1, p.h - 0.6, -Wd / 2 - 0.005, glass);
  add(0.15, 0.3, Wd + 0.1, L / 2 + 0.05, 0.6, 0, dark);           // bumper
  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.32, 16);
  for (const wx of [L / 2 - 1, -L / 2 + 1.2, -L / 2 + 2.4]) for (const sz of [1, -1]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.rotation.x = Math.PI / 2; w.position.set(wx, 0.48, sz * (Wd / 2 - 0.1));
    w.castShadow = shadows; g.add(w);
  }
  g.position.set((p.x0 + p.x1) / 2, 0, (p.z0 + p.z1) / 2);
  g.rotation.y = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[p.facing || '+x'];
  if (!along) { /* rotation already swaps axes */ }
  return g;
}

// merge plain-coloured meshes into one vertex-coloured mesh (one draw call instead of dozens)
function mergeColoured(group, list, shadows) {
  if (list.length < 2) return;
  const pos = [], nor = [], colr = [];
  for (const mesh of list) {
    mesh.updateMatrix();
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
    const c = mesh.material.color, n = geo.attributes.position.count;
    pos.push(geo.attributes.position.array); nor.push(geo.attributes.normal.array);
    const ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
    colr.push(ca);
    geo.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
    group.remove(mesh);
  }
  const cat = arrs => { const out = new Float32Array(arrs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(cat(colr), 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.castShadow = shadows; m.receiveShadow = shadows;
  group.add(m);
}
// a wooden hand cart with two big wheels and its handles resting on the ground
function buildCart(p, shadows) {
  const g = new THREE.Group();
  const along = p.facing === '+x' || p.facing === '-x';
  const L = along ? p.x1 - p.x0 : p.z1 - p.z0, W = along ? p.z1 - p.z0 : p.x1 - p.x0;
  const parts = [];
  const add = (w, h, d, x, y, z, c, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(c)); m.position.set(x, y, z); m.rotation.z = rz; g.add(m); parts.push(m); return m; };
  const bl = L * 0.7, bx = -L * 0.12;
  add(bl, 0.08, W * 0.9, bx, 0.72, 0, '#7a5636');                                    // bed
  for (const sz of [-1, 1]) add(bl, 0.42, 0.06, bx, 0.95, sz * W * 0.43, '#8a6442'); // sides
  add(0.06, 0.42, W * 0.9, bx - bl / 2, 0.95, 0, '#8a6442');
  add(0.06, 0.42, W * 0.9, bx + bl / 2, 0.95, 0, '#8a6442');
  for (let k = 0; k < 3; k++) add(0.5, 0.35, 0.5, bx - bl * 0.25 + k * bl * 0.25, 1.0, (k - 1) * 0.15, k === 1 ? '#c9a24a' : '#8c6a42');   // sacks and a crate
  for (const sz of [-1, 1]) add(L * 0.42, 0.06, 0.06, L * 0.3, 0.42, sz * W * 0.3, '#6a4a2e', -0.55);   // handles down to the ground
  add(0.08, 0.08, W * 0.75, -L * 0.1, 0.6, 0, '#5a3a22');                             // axle
  mergeColoured(g, parts, shadows);
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.08, 14).rotateX(Math.PI / 2);
  for (const sz of [-1, 1]) {
    const wh = new THREE.Mesh(wheelGeo, lam('#5a3a22'));
    wh.position.set(-L * 0.1, 0.55, sz * (W * 0.5 - 0.04)); wh.castShadow = shadows; g.add(wh);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 8).rotateX(Math.PI / 2), lam('#3a2a1c'));
    hub.position.copy(wh.position); g.add(hub);
  }
  g.position.set((p.x0 + p.x1) / 2, 0, (p.z0 + p.z1) / 2);
  g.rotation.y = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[p.facing || '+x'];
  return g;
}
// a stone well head
function buildWell(p, shadows) {
  const g = new THREE.Group();
  const r = Math.min(p.x1 - p.x0, p.z1 - p.z0) / 2;
  const stone = lam('#d2c7b2');
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.95, p.h - 0.12, 8), stone);
  body.position.y = (p.h - 0.12) / 2; body.castShadow = shadows; g.add(body);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 8), lam('#ddd3bf'));
  rim.position.y = p.h - 0.06; g.add(rim);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(r * 0.62, 12), lam('#1c2a2a'));
  hole.rotation.x = -Math.PI / 2; hole.position.y = p.h + 0.003; g.add(hole);
  const step = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.2, 0.12, 8), lam('#cfc6b4'));
  step.position.y = 0.06; g.add(step);
  g.position.set((p.x0 + p.x1) / 2, 0, (p.z0 + p.z1) / 2);
  return g;
}
// a ripple normal map for the water (drawn once)
let rippleTex = null;
function ripples() {
  if (rippleTex) return rippleTex;
  const n = 128, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  const hgt = (x, y) => Math.sin((x + y * 0.3) / n * Math.PI * 6) * 0.5 + Math.sin((y - x * 0.4) / n * Math.PI * 10) * 0.3 + Math.sin((x * 0.7 + y) / n * Math.PI * 16) * 0.2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
    const i = (y * n + x) * 4;
    img.data[i] = 128 + dx * 60; img.data[i + 1] = 128 + dy * 60; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  rippleTex = new THREE.CanvasTexture(c);
  rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
  return rippleTex;
}
// canal water: a dark bed and a gently moving, reflective surface
function buildWater(world, theme, group, night) {
  if (!world.water || !world.water.length) return;
  const tex = ripples();
  const mat = new THREE.MeshStandardMaterial({ color: night ? '#10282a' : (theme.water || '#2e6b6c'), roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.86, normalMap: tex, normalScale: new THREE.Vector2(0.35, 0.35) });
  const bedMat = new THREE.MeshLambertMaterial({ color: '#1d3330' });
  for (const w of world.water) {
    const W = w.x1 - w.x0, D = w.z1 - w.z0;
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(W, D), bedMat);
    bed.rotation.x = -Math.PI / 2; bed.position.set(w.x0 + W / 2, 0.008, w.z0 + D / 2);
    group.add(bed);
    const geo = new THREE.PlaneGeometry(W, D);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 3, uv.getY(i) * D / 3);
    const surf = new THREE.Mesh(geo, mat);
    surf.rotation.x = -Math.PI / 2; surf.position.set(w.x0 + W / 2, w.y, w.z0 + D / 2);
    surf.renderOrder = 2;
    group.add(surf);
  }
  // the ripples drift slowly
  group.userData.tick = (t) => { tex.offset.set(t * 0.03, t * 0.017); };
}

// gfx: resolved graphics settings (graphics.js); night: dark map lit by the moon and flashlights
export function buildMapScene(world, renderer, gfx = {}, night = false) {
  const theme = THEMES[world.def.theme] || THEMES.desert;
  const group = new THREE.Group();
  const shadows = !!gfx.shadows && gfx.shadows !== 'off';
  const texMat = (spec, seed) => new THREE.MeshLambertMaterial({ map: makeTexture(spec[0], spec[1], renderer, seed), vertexColors: true });

  // ground
  const W = world.width, D = world.depth;
  const floorTex = makeTexture(theme.floor[0], theme.floor[1], renderer, 3).clone();
  floorTex.needsUpdate = true;
  const ft = theme.floorTile || 4;      // metres per texture tile
  floorTex.repeat.set(W / ft, D / ft);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, D / 2);
  floor.receiveShadow = shadows;
  group.add(floor);

  // walls, floors, stairs, roofs
  let seed = 1;
  for (const [m, geo] of meshSpans(world, theme)) {
    const spec = theme.mats[m] || theme.mats.wall;
    const mesh = new THREE.Mesh(geo, texMat(spec, seed++));
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    group.add(mesh);
  }

  // props
  const boxes = world.props.filter(p => p.type === 'box' || p.type === 'crate');
  if (boxes.length) {
    const cm = new THREE.MeshLambertMaterial({ map: makeTexture(theme.crate[0], theme.crate[1], renderer, 7) });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cm, boxes.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const ply = theme.crateStyle === 'ply', pal = ply ? 0.14 : 0;      // plywood crates stand on a pallet
    boxes.forEach((p, i) => {
      const w = p.x1 - p.x0, d = p.z1 - p.z0;
      m4.compose(new THREE.Vector3((p.x0 + p.x1) / 2, pal + (p.h - pal) / 2, (p.z0 + p.z1) / 2), q, new THREE.Vector3(w - 0.04, p.h - pal, d - 0.04));
      inst.setMatrixAt(i, m4);
      const t = ply ? 0.94 + hash2(i, 3) * 0.08 : p.type === 'crate' ? 0.62 : 0.88 + hash2(i, 3) * 0.24;
      inst.setColorAt(i, ply ? new THREE.Color(t, t, t) : new THREE.Color(t, t * (p.type === 'crate' ? 0.85 : 1), t * (p.type === 'crate' ? 0.8 : 1)));
    });
    inst.castShadow = shadows; inst.receiveShadow = shadows;
    group.add(inst);
    if (ply) {
      // pallets: three runners and a deck of slats
      const parts = [];
      for (const p of boxes) {
        const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
        for (const k of [-1, 0, 1]) parts.push([cx + k * (w / 2 - 0.12), 0.05, cz, 0.12, 0.1, d - 0.04]);
        for (let s = -d / 2 + 0.1; s < d / 2 - 0.05; s += 0.22) parts.push([cx, 0.12, cz + s, w - 0.02, 0.04, 0.12]);
      }
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lam('#9c8466'), parts.length);
      parts.forEach(([x, y, z, sx, sy, sz], i) => { m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)); pm.setMatrixAt(i, m4); });
      pm.castShadow = shadows;
      group.add(pm);
    }
  }
  const barrels = world.props.filter(p => p.type === 'barrel');
  if (barrels.length && theme.woodBarrels) group.add(...woodBarrels(barrels, theme, shadows));
  else if (barrels.length) {
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 16);
    const ringGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.06, 16);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), barrels.length);
    const rings = new THREE.InstancedMesh(ringGeo, lam('#2a2a2a'), barrels.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    barrels.forEach((p, i) => {
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      m4.compose(new THREE.Vector3(cx, 0.5, cz), q, one);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, new THREE.Color(theme.barrels[i % theme.barrels.length]));
      for (const [k, y] of [[0, 0.3], [1, 0.7]]) { m4.compose(new THREE.Vector3(cx, y, cz), q, one); rings.setMatrixAt(i * 2 + k, m4); }
    });
    inst.castShadow = shadows; inst.receiveShadow = shadows; rings.castShadow = shadows;
    group.add(inst, rings);
  }
  for (const p of world.props.filter(p => p.type === 'truck')) group.add(buildTruck(p, theme, shadows));
  for (const p of world.props.filter(p => p.type === 'well')) group.add(buildWell(p, shadows));
  for (const p of world.props.filter(p => p.type === 'cart')) group.add(buildCart(p, shadows));
  buildWater(world, theme, group, night);
  // windows, wall caps, lamps, pipes, ground detail and distant scenery (visual only)
  decorateMap(world, theme, group, { gfx, night, shadows });

  // bomb site: tinted ground + painted letter + floating marker
  for (const r of world.siteRects) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const tint = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: theme.site, transparent: true, opacity: night ? 0.04 : 0.12, depthWrite: false }));
    tint.rotation.x = -Math.PI / 2; tint.position.set(r.x0 + w / 2, 0.02, r.z0 + d / 2);
    group.add(tint);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d)), new THREE.LineBasicMaterial({ color: night ? '#5a2a20' : theme.site }));
    edge.rotation.x = -Math.PI / 2; edge.position.set(r.x0 + w / 2, 0.03, r.z0 + d / 2);
    group.add(edge);
    const s = world.sites[r.name];
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5),
      new THREE.MeshBasicMaterial({ map: letterTexture(r.name, theme.site), transparent: true, depthWrite: false, opacity: night ? 0.25 : 0.9 }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(s.x + 3, 0.04, s.z + 4);
    group.add(decal);
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: letterTexture(r.name, '#ffffff'), transparent: true, depthWrite: false, depthTest: false, opacity: 0.55 }));
    marker.position.set(s.x, 7, s.z);
    marker.userData.billboard = true;
    marker.renderOrder = 5;
    group.add(marker);
  }

  const sky = skyDome(night ? { skyTop: '#02040a', skyHorizon: '#141c2c' } : theme);
  sky.userData.sky = true;
  group.add(sky);
  if (night) group.add(stars());
  group.add(new THREE.HemisphereLight(night ? '#5a6f9a' : theme.hemiSky, night ? '#1a1612' : theme.hemiGround, night ? 0.32 : theme.hemiIntensity));
  const sun = new THREE.DirectionalLight(night ? '#9fb4e0' : theme.sun, night ? 0.45 : theme.sunIntensity);
  sun.position.set(W * 0.5 + 40, 80, D * 0.5 - 30);
  sun.target.position.set(W / 2, 0, D / 2);
  group.add(sun, sun.target);
  if (shadows) {
    sun.castShadow = true;
    const map = { low: 1024, medium: 2048, high: 2048, ultra: 4096 }[gfx.shadows] || 2048;
    sun.shadow.mapSize.set(map, map);
    if (gfx.shadows === 'ultra' || gfx.shadows === 'high') sun.shadow.radius = 3;
    const r = Math.max(W, D) * 0.7;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 220 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
  }
  // texture sharpness at an angle (texture quality)
  const aniso = { low: 1, medium: 4, high: renderer.capabilities.getMaxAnisotropy() }[gfx.textures || 'medium'] || 4;
  group.traverse(o => {
    const m = o.material;
    if (m && m.map && m.map.anisotropy !== aniso) { m.map.anisotropy = aniso; m.map.needsUpdate = true; }
  });
  // view distance: how far before things fade into the haze
  const far = gfx.viewDistance || 170;
  const fog = night ? new THREE.Fog('#070a12', 6, Math.min(far, 70))
    : new THREE.Fog(theme.fog, Math.min(theme.fogNear, far * 0.3), Math.min(theme.fogFar * Math.max(1, far / 200), far));
  return { group, theme, fog, sky, sun, far };
}

// wooden barrels: a closed, bulging body of staves with a lid sunk inside a rim, and four iron hoops
const BARREL_R = (y) => 0.37 + 0.07 * Math.sin(Math.PI * y);     // radius at height y (0 = bottom, 1 = top)
function woodBarrels(barrels, theme, shadows) {
  // join a few pieces into one geometry (positions, normals, uvs)
  const join = (parts) => {
    const pos = [], nor = [], uv = [];
    for (const g0 of parts) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  };
  const seg = 20, lid = 0.345, top = BARREL_R(1);
  const body = new THREE.LatheGeometry(Array.from({ length: 11 }, (_, k) => new THREE.Vector2(BARREL_R(k / 10), k / 10)), seg);
  const chime = new THREE.LatheGeometry([new THREE.Vector2(lid, 1), new THREE.Vector2(lid, 0.965)], seg);      // inside of the rim (faces in)
  const rim = new THREE.RingGeometry(lid, top, seg).rotateX(-Math.PI / 2).translate(0, 1, 0);
  const head = new THREE.CircleGeometry(lid, seg).rotateX(-Math.PI / 2).translate(0, 0.965, 0);
  const bottom = new THREE.CircleGeometry(top, seg).rotateX(Math.PI / 2);
  const geo = join([body, chime, rim, head, bottom]);
  // pale stave texture (tinted per barrel by the instance colour)
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const staves = 16, sw = c.width / staves;
  for (let k = 0; k < staves; k++) {
    const v = 0.8 + hash2(k, 5) * 0.2;
    g.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(245 * v)},${Math.round(230 * v)})`; g.fillRect(k * sw, 0, sw, 64);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(90,60,30,${0.05 + hash2(k, i) * 0.08})`; g.fillRect(k * sw + hash2(i, k + 9) * sw, 0, 1, 64); }
    g.fillStyle = 'rgba(40,25,10,0.55)'; g.fillRect(k * sw, 0, 1.5, 64);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: tex }), barrels.length);
  // hoops follow the bulge (open-ended, so no discs inside the barrel)
  const hoopAt = [0.07, 0.24, 0.76, 0.93];
  const hoopGeo = join(hoopAt.map(y => new THREE.CylinderGeometry(BARREL_R(y + 0.025) + 0.008, BARREL_R(y - 0.025) + 0.008, 0.05, seg, 1, true).translate(0, y, 0)));
  const hoops = new THREE.InstancedMesh(hoopGeo, lam('#34302c'), barrels.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  barrels.forEach((p, i) => {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    q.setFromAxisAngle(up, hash2(i, 17) * Math.PI * 2);
    m4.compose(new THREE.Vector3(cx, 0, cz), q, one);
    inst.setMatrixAt(i, m4); hoops.setMatrixAt(i, m4);
    inst.setColorAt(i, new THREE.Color(theme.barrels[i % theme.barrels.length]));
  });
  inst.castShadow = shadows; inst.receiveShadow = shadows; hoops.castShadow = shadows;
  return [inst, hoops];
}

// a dome of faint stars for night mode
function stars() {
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.92);
    pos[i * 3] = Math.sin(v) * Math.cos(u) * 450; pos[i * 3 + 1] = Math.cos(v) * 450 + 20; pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 450;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
  pts.renderOrder = -9;
  pts.userData.sky = true;
  return pts;
}
