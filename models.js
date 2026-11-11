// Player, weapon and bomb models, all built in code.
// Characters use rounded shapes, camouflage fabric and team gear; guns are built from
// side profiles (extruded 2D outlines) with separate moving parts (magazine, slide,
// bolt, pump) and "anchor" points that tell the hands where to hold them.
import * as THREE from 'three';
import { labelTexture } from './textures.js';

export const TEAM_COLORS = {
  atk: {
    body: '#8a7352', vest: '#5e4a30', accent: '#e39a3b', css: '#f0a040',
    camo: ['#9a8360', '#7a6444', '#b3a078', '#5c4b34'], pants: '#7a684a', boots: '#3a2c20', glove: '#6a5940', gloveTrim: '#3b3126', gear: '#5a4630', scarf: '#a85a34',
  },
  def: {
    body: '#2f3f5c', vest: '#3a4048', accent: '#5f9be8', css: '#5aa0ff',
    camo: ['#34465f', '#26334a', '#4a5e7c', '#1d2839'], pants: '#2c3646', boots: '#1a1c20', glove: '#2c2f36', gloveTrim: '#17181c', gear: '#2f343c', scarf: '#3b4a5e',
  },
  ffa: {
    body: '#5d6b3c', vest: '#2f3526', accent: '#c9d65a', css: '#d6e05a',
    camo: ['#5f6b40', '#48522f', '#7a8652', '#353c23'], pants: '#4d5733', boots: '#2a2a20', glove: '#55553f', gloveTrim: '#2c2c22', gear: '#3a4028', scarf: '#6b5a3a',
  },
};
const SKINS = ['#e3b48f', '#c99068', '#a8734c', '#86593a', '#f0c9a4', '#b98159'];

// ---------- detail level (graphics "model detail") ----------
let DETAIL = 'high';
export function setModelDetail(d) { DETAIL = d === 'low' ? 'low' : 'high'; }
const HI = () => DETAIL !== 'low';

// ---------- materials ----------
const matCache = new Map();
function mat(color, { metal = 0, rough = 0.85, map = null, emissive = null } = {}) {
  const key = `${color}|${metal}|${rough}|${map ? map.uuid : ''}|${emissive}|${DETAIL}`;
  if (!matCache.has(key)) {
    const opts = { color, map, emissive: emissive || '#000000' };
    matCache.set(key, HI() ? new THREE.MeshStandardMaterial({ ...opts, metalness: metal, roughness: rough })
      : new THREE.MeshLambertMaterial(opts));
  }
  return matCache.get(key);
}
// gun finishes
const G = {
  steel: () => mat('#3a3e44', { metal: 0.65, rough: 0.38 }),
  blued: () => mat('#22252b', { metal: 0.55, rough: 0.42 }),
  dark: () => mat('#1b1c20', { metal: 0.3, rough: 0.55 }),
  poly: () => mat('#26282c', { metal: 0.05, rough: 0.8 }),
  polyLight: () => mat('#3a3d42', { metal: 0.05, rough: 0.78 }),
  wood: () => mat('#93582e', { rough: 0.55 }),
  woodDark: () => mat('#64381a', { rough: 0.6 }),
  tan: () => mat('#a48c66', { rough: 0.75 }),
  olive: () => mat('#5a6544', { rough: 0.72 }),
  green: () => mat('#46613c', { rough: 0.6 }),
  chrome: () => mat('#c9cdd2', { metal: 0.9, rough: 0.2 }),
  grey: () => mat('#5c6067', { metal: 0.45, rough: 0.45 }),
  glass: () => mat('#2b5a86', { metal: 0.4, rough: 0.05, emissive: '#0b2034' }),
  brass: () => mat('#c29a42', { metal: 0.85, rough: 0.3 }),
  red: () => mat('#b03a2c', { rough: 0.5 }),
  rubber: () => mat('#141416', { rough: 0.95 }),
};

// seeded camouflage pattern (tiles seamlessly)
const texCache = new Map();
function camoTex(colors, repeat = 3) {
  const key = colors.join() + '|' + repeat;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 128, 128);
  let seed = colors.join('').length * 7919;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let layer = 1; layer < colors.length; layer++) {
    g.fillStyle = colors[layer];
    for (let i = 0; i < 9; i++) {
      const x = rnd() * 128, y = rnd() * 128, rx = 8 + rnd() * 18, ry = 5 + rnd() * 12, a = rnd() * Math.PI;
      for (const ox of [-128, 0, 128]) for (const oy of [-128, 0, 128]) {
        g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, a, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // fine weave
  g.globalAlpha = 0.08;
  for (let y = 0; y < 128; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, 128, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
const fabric = (c, which = 'camo', rep = 3) => mat('#ffffff', { rough: 0.95, map: camoTex(which === 'camo' ? c.camo : [c.pants, c.camo[1], c.pants, c.camo[3]], rep) });

// ---------- geometry helpers (cached) ----------
const geoCache = new Map();
const cached = (key, make) => { key += '|' + DETAIL; if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };
const f4 = v => (+v).toFixed(4);

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// box with rounded edges
function rbox(w, h, d, r = 0.008) {
  r = Math.max(0.0006, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  return cached(`rb|${f4(w)}|${f4(h)}|${f4(d)}|${f4(r)}`, () => {
    if (!HI()) return new THREE.BoxGeometry(w, h, d);
    const g = new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth: Math.max(1e-4, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelOffset: -r, bevelSegments: 2, curveSegments: 3 });
    g.translate(0, 0, -(d - 2 * r) / 2);
    return g;
  });
}
// side profile: points [z, y] (z = forward/back, front is -z), extruded `t` wide (x), rounded edges
function profile(key, pts, t, b = 0.0025, holes = null) {
  return cached(`pf|${key}|${f4(t)}`, () => {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    if (holes) for (const h of holes) s.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
    const bev = HI() && b > 0;
    const g = new THREE.ExtrudeGeometry(s, bev
      ? { depth: Math.max(1e-4, t - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 6 }
      : { depth: t, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, bev ? -(t - 2 * b) / 2 : -t / 2);
    g.rotateY(-Math.PI / 2);   // shape x → world z, extrusion → world x
    return g;
  });
}
// cylinder along z (rear radius, front radius)
function cylZ(rRear, rFront, len, seg = 14) {
  return cached(`cz|${f4(rRear)}|${f4(rFront)}|${f4(len)}|${seg}`, () => {
    const g = new THREE.CylinderGeometry(rRear, rFront, len, HI() ? seg : Math.min(seg, 8));
    g.rotateX(Math.PI / 2);
    return g;
  });
}
const cylY = (r1, r2, len, seg = 12) => cached(`cy|${f4(r1)}|${f4(r2)}|${f4(len)}|${seg}`, () => new THREE.CylinderGeometry(r1, r2, len, HI() ? seg : Math.min(seg, 8)));
const capsule = (r, len, seg = 10) => cached(`cap|${f4(r)}|${f4(len)}`, () => new THREE.CapsuleGeometry(r, len, HI() ? 4 : 2, HI() ? seg : 6));
const sphere = (r, a0 = 0, a1 = Math.PI) => cached(`sp|${f4(r)}|${f4(a0)}|${f4(a1)}`, () => new THREE.SphereGeometry(r, HI() ? 18 : 10, HI() ? 12 : 7, 0, Math.PI * 2, a0, a1 - a0));

// Merge a group's direct mesh children that share a material into one mesh each
// (looks identical, far fewer draw calls). Child groups (moving parts) are left alone.
function mergeStatic(group) {
  const byMat = new Map();
  for (const ch of [...group.children]) {
    if (!ch.isMesh || ch.userData.keep) continue;
    if (!byMat.has(ch.material)) byMat.set(ch.material, []);
    byMat.get(ch.material).push(ch);
  }
  for (const [m, list] of byMat) {
    if (list.length < 2) continue;
    const pos = [], nor = [], uv = [];
    for (const mesh of list) {
      mesh.updateMatrix();
      const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
      pos.push(geo.attributes.position.array); nor.push(geo.attributes.normal.array);
      uv.push(geo.attributes.uv ? geo.attributes.uv.array : new Float32Array(geo.attributes.position.count * 2));
      geo.dispose();
      group.remove(mesh);
    }
    const cat = (arrs) => { const n = arrs.reduce((a, b) => a + b.length, 0), out = new Float32Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(cat(uv), 2));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true;
    group.add(mesh);
  }
}

function P(parent, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, typeof m === 'function' ? m() : m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
// detail-only part (skipped on low model detail)
const D = (...a) => (HI() ? P(...a) : null);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// shared gun bits
function sightsIron(g, zf, zr, base, h = 0.014, m = G.dark) {
  D(g, rbox(0.006, h + 0.002, 0.008, 0.002), m, 0, base + h / 2, zf);
  D(g, rbox(0.006, h * 0.86 + 0.002, 0.008, 0.002), m, -0.008, base + h * 0.43, zr);
  D(g, rbox(0.006, h * 0.86 + 0.002, 0.008, 0.002), m, 0.008, base + h * 0.43, zr);
  D(g, rbox(0.024, 0.005, 0.01, 0.002), m, 0, base + 0.0015, zr);                    // rear sight base
}
function picatinny(g, len, z, y, w = 0.024) {
  P(g, rbox(w, 0.008, len, 0.002), G.dark, 0, y + 0.004, z);
  if (HI()) for (let i = 0; i < Math.floor(len / 0.012); i++) P(g, rbox(w + 0.006, 0.005, 0.006, 0.0015), G.dark, 0, y + 0.0085, z - len / 2 + 0.006 + i * 0.012);
}
function trigger(g, z, y) { D(g, rbox(0.005, 0.02, 0.006, 0.002), G.steel, 0, y, z, -0.25); }
function serrations(g, z0, z1, y, h, w, n = 6) {
  if (!HI()) return;
  for (let i = 0; i < n; i++) {
    const z = z0 + (z1 - z0) * (i / (n - 1));
    P(g, rbox(w + 0.002, h, 0.0025, 0.0008), G.dark, 0, y, z);
  }
}
// screw-on silencer (a group, so the whole thing hides when it's taken off)
function silencer(g, r, len, y, z) {
  const s = new THREE.Group();
  g.add(s);
  P(s, cylZ(r, r, len, 20), G.dark, 0, y, z);
  if (HI()) for (const dz of [-len / 2 + 0.01, len / 2 - 0.01]) P(s, cylZ(r * 1.04, r * 1.04, 0.008, 20), G.blued, 0, y, z + dz);
  D(s, cylZ(r * 0.35, r * 0.35, 0.004, 10), G.rubber, 0, y, z - len / 2 - 0.001);
  return s;
}
// charging handle / cocking knob as its own group: the left hand pulls it back u.stroke when racking
function chargingHandle(g, u, x, y, z, stroke, build) {
  const h = new THREE.Group(); h.position.set(x, y, z); g.add(h);
  build(h);
  u.handle = h; u.stroke = stroke;
  u.charge = V(x, y, z);
  return h;
}
// the top cartridge sitting in a magazine (seen when the magazine is out)
function topRound(m, len, r, z = 0, y = -0.003) {
  P(m, cylZ(r, r * 0.92, len * 0.62, 10), G.brass, 0, y, z + len * 0.12);
  P(m, cylZ(r * 0.9, r * 0.35, len * 0.38, 10), mat('#b8743a', { metal: 0.7, rough: 0.35 }), 0, y, z - len * 0.38);
}
// a magazine as its own group (pivot = top of the magazine, where it meets the gun)
function magGroup(parent, x, y, z, tilt) {
  const m = new THREE.Group();
  m.position.set(x, y, z);
  m.rotation.x = tilt;
  parent.add(m);
  return m;
}
// scope with rings and lenses
function scope(g, y, z0, len, r, objR, eyeR, base, mount = G.dark) {
  P(g, cylZ(r, r, len), G.dark, 0, y, z0);
  P(g, cylZ(r, objR, 0.06), G.dark, 0, y, z0 - len / 2 - 0.03);
  P(g, cylZ(eyeR, r, 0.05), G.dark, 0, y, z0 + len / 2 + 0.025);
  D(g, cylZ(objR - 0.003, objR - 0.003, 0.004), G.glass, 0, y, z0 - len / 2 - 0.061);
  D(g, cylZ(eyeR - 0.004, eyeR - 0.004, 0.004), G.glass, 0, y, z0 + len / 2 + 0.051);
  D(g, cylY(0.009, 0.009, 0.02), G.dark, 0, y + r + 0.006, z0);          // elevation turret
  D(g, cylZ(0.009, 0.009, 0.02), G.dark, r + 0.006, y, z0, 0, Math.PI / 2, 0);
  for (const dz of [-len * 0.3, len * 0.3]) {
    const mh = y - r - base + 0.006;
    P(g, rbox(0.018, mh, 0.016, 0.003), mount, 0, base - 0.003 + mh / 2, z0 + dz);       // ring mount down to the receiver
    D(g, new THREE.TorusGeometry(r + 0.003, 0.004, 6, 16), mount, 0, y, z0 + dz);
  }
}

// ---------- guns (front = -z; the right hand grips around the origin) ----------
// Every gun returns a group with userData:
//   grip / gripTilt: where the right hand holds (and the grip angle)
//   fore / foreKind: where the left hand holds ('cup' pistol support, 'under' handguard, 'vgrip', 'pump')
//   mag (group), slide (group), bolt (group), pump (group): moving parts for the animations
//   charge: where the left hand pulls the charging handle / racks the slide
//   muzzle: Object3D at the end of the barrel; silencer: mesh (or null); kind: weapon family
function gunMesh(weapon) {
  const g = new THREE.Group();
  const u = g.userData = { kind: 'rifle', grip: V(0, -0.06, 0.02), gripTilt: 0.25, fore: V(0, -0.04, -0.25), foreKind: 'under', charge: V(0, 0.05, 0.02), muzzleAt: V(0, 0.02, -0.6), silencer: null };
  const B = BUILD[weapon];
  if (B) B(g, u); else P(g, rbox(0.05, 0.08, 0.5), G.steel, 0, 0, -0.1);
  if (u.rot) g.rotation.set(u.rot.x, u.rot.y, u.rot.z);     // how a melee weapon sits in the fist
  // merge the fixed parts (moving parts — magazine, slide, bolt, pump, silencer — are groups)
  if (u.mag) {
    const bb = new THREE.Box3(), tmp = new THREE.Box3();
    u.mag.traverse(o => { if (o.isMesh) { o.updateMatrix(); o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrix); bb.union(tmp); } });
    u.magGrab = V((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);
  }
  mergeStatic(g);
  for (const k of ['mag', 'slide', 'bolt', 'pump', 'silencer', 'handle', 'hammer']) if (u[k] && u[k].isGroup) mergeStatic(u[k]);
  const mz = new THREE.Object3D();
  mz.position.copy(u.muzzleAt);
  g.add(mz);
  u.muzzle = mz;
  return g;
}

function pistolFrame(g, key, { len = 0.155, gripH = 0.12, color = G.poly, w = 0.03 } = {}) {
  const L = len;
  const pts = [[0.03, 0.012], [-L, 0.012], [-L, -0.004], [-0.08, -0.004], [-0.083, -0.02], [-0.076, -0.042], [-0.04, -0.044], [-0.031, -0.03],
    [-0.013, -0.01 - gripH], [0.0, -0.016 - gripH], [0.042, -0.012 - gripH], [0.04, -0.06], [0.046, -0.02], [0.05, -0.004]];
  const hole = [[-0.07, -0.008], [-0.074, -0.024], [-0.066, -0.036], [-0.043, -0.036], [-0.037, -0.01]];
  P(g, profile('pframe' + key, pts, w, 0.003, [hole]), color);
  trigger(g, -0.053, -0.018);
  D(g, rbox(0.022, 0.006, 0.06, 0.002), G.dark, 0, -0.007, -L + 0.04);          // accessory rail
  if (HI()) for (let i = 0; i < 4; i++) P(g, rbox(w + 0.003, 0.008, 0.012, 0.003), G.dark, 0, -0.045 - i * 0.02, 0.01 + i * 0.004);   // grip texture bands
}
function pistolSlide(g, u, key, { len = 0.165, h = 0.038, w = 0.026, color = G.poly, rear = 0.032 } = {}) {
  const s = new THREE.Group();
  g.add(s);
  const L = len;
  P(s, profile('pslide' + key, [[rear, 0.012], [rear, 0.012 + h - 0.004], [rear - 0.006, 0.012 + h], [-L + 0.008, 0.012 + h], [-L, 0.012 + h - 0.008], [-L, 0.016], [-L + 0.006, 0.012]], w, 0.003), color);
  serrations(s, rear - 0.026, rear - 0.006, 0.012 + h / 2, h * 0.7, w);
  P(s, cylZ(0.0058, 0.0058, 0.004, 10), G.blued, 0, 0.012 + h * 0.5, -L - 0.001);
  D(s, rbox(0.004, 0.013, 0.032, 0.0015), G.steel, w / 2, 0.012 + h * 0.62, -0.03);    // ejection port
  sightsIron(s, -L + 0.012, rear - 0.01, 0.012 + h);
  u.slide = s;
  u.muzzleAt = V(0, 0.012 + h * 0.5, -L - 0.004);
  u.charge = V(0, 0.012 + h, rear - 0.012);
  return s;
}
function hammer(g, u, z, color = G.blued, big = 1) {
  P(g, rbox(0.012, 0.014, 0.016, 0.003), color, 0, 0.007, z + 0.004);                // seat in the frame
  const hm = new THREE.Group(); hm.position.set(0, 0.012, z + 0.004); g.add(hm);
  P(hm, profile('hammer' + big, [[-0.004, -0.003], [0.006, -0.003], [0.009, 0.02 * big], [0.015, 0.03 * big], [0.008, 0.034 * big], [0.0, 0.026 * big], [-0.004, 0.006]], 0.008, 0.0015), color);
  u.hammer = hm;
}
function pistolMag(g, u, gripH, color = G.dark) {
  const m = magGroup(g, 0, -0.022, 0.016, -0.23);
  P(m, rbox(0.022, gripH - 0.01, 0.03, 0.003), G.blued, 0, -(gripH - 0.01) / 2, 0);
  P(m, rbox(0.031, 0.012, 0.046, 0.004), color, 0, -gripH + 0.002, 0.002);
  topRound(m, 0.026, 0.0045, 0.0, -0.002);
  u.mag = m;
}
function pistolCommon(u, gripH) {
  u.kind = 'pistol';
  u.grip = V(0, -0.07, 0.009);
  u.gripTilt = 0.23;
  u.fore = V(-0.012, -0.082, 0.004);
  u.foreKind = 'cup';
  u.gripH = gripH;
}

const BUILD = {
  glock(g, u) {
    pistolFrame(g, 'glock', { gripH: 0.12 });
    pistolSlide(g, u, 'glock', { len: 0.165, h: 0.038, color: G.poly });
    pistolMag(g, u, 0.12);
    pistolCommon(u, 0.12);
  },
  usp(g, u) {
    pistolFrame(g, 'usp', { len: 0.16, gripH: 0.122, color: G.poly });
    pistolSlide(g, u, 'usp', { len: 0.175, h: 0.039, color: G.grey });
    hammer(g, u, 0.032);
    P(g, cylZ(0.008, 0.008, 0.022), G.blued, 0, 0.0315, -0.186);                     // threaded barrel
    u.silencer = silencer(g, 0.018, 0.13, 0.0315, -0.262);
    pistolMag(g, u, 0.122);
    pistolCommon(u, 0.122);
    u.muzzleAt = V(0, 0.0315, -0.329);                                                // end of the silencer
  },
  deagle(g, u) {
    pistolFrame(g, 'deagle', { len: 0.19, gripH: 0.13, color: G.blued, w: 0.034 });
    const s = pistolSlide(g, u, 'deagle', { len: 0.22, h: 0.046, w: 0.034, color: G.chrome, rear: 0.04 });
    P(s, profile('deagleRib', [[0.0, 0.058], [-0.215, 0.058], [-0.215, 0.066], [0.0, 0.066]], 0.012, 0.002), G.chrome);   // triangular barrel rib
    D(s, rbox(0.036, 0.006, 0.17, 0.002), G.grey, 0, 0.03, -0.12);
    hammer(g, u, 0.04, G.blued, 1.15);
    pistolMag(g, u, 0.13, G.blued);
    pistolCommon(u, 0.13);
    u.muzzleAt = V(0, 0.035, -0.226);
  },
  tec9(g, u) {
    u.kind = 'pistol';
    // long receiver, shroud with cooling slots, magazine in front of the trigger
    P(g, profile('tec9rcv', [[0.07, 0.0], [0.07, 0.04], [0.05, 0.05], [-0.14, 0.05], [-0.15, 0.04], [-0.15, 0.0]], 0.036), G.blued);
    P(g, cylZ(0.019, 0.019, 0.11), G.dark, 0, 0.025, -0.205);
    if (HI()) for (let i = 0; i < 5; i++) P(g, rbox(0.04, 0.012, 0.01, 0.003), G.poly, 0, 0.025, -0.165 - i * 0.02);
    P(g, cylZ(0.006, 0.006, 0.02), G.steel, 0, 0.025, -0.265);
    P(g, profile('tec9grip', [[0.05, 0.0], [0.012, 0.0], [0.004, -0.02], [0.02, -0.11], [0.06, -0.11], [0.065, -0.02]], 0.03, 0.003,
      [[[0.012, -0.012], [0.008, -0.03], [0.02, -0.04], [0.035, -0.04], [0.03, -0.012]]]), G.poly);
    trigger(g, 0.0, -0.016);
    const m = magGroup(g, 0, 0.0, -0.05, 0.0);
    P(m, rbox(0.022, 0.16, 0.034, 0.003), G.dark, 0, -0.08, 0);
    P(m, rbox(0.028, 0.01, 0.04, 0.003), G.poly, 0, -0.163, 0);
    u.mag = m;
    chargingHandle(g, u, -0.018, 0.035, -0.06, 0.05, h => { P(h, rbox(0.014, 0.012, 0.028, 0.004), G.steel, -0.005, 0, 0); });
    sightsIron(g, -0.14, 0.05, 0.05);
    u.grip = V(0, -0.06, 0.035); u.gripTilt = 0.15;
    u.fore = V(0, -0.075, -0.052); u.foreKind = 'vgrip';
    u.charge.x -= 0.008;
    u.muzzleAt = V(0, 0.025, -0.277);
    u.gripH = 0.11;
  },
  mac10(g, u) {
    u.kind = 'smg';
    P(g, profile('mac10rcv', [[0.07, -0.01], [0.07, 0.05], [-0.12, 0.05], [-0.13, 0.04], [-0.13, -0.01]], 0.05, 0.004), G.blued);
    P(g, profile('mac10lower', [[0.06, -0.01], [-0.12, -0.01], [-0.12, -0.03], [-0.07, -0.032], [-0.06, -0.05], [-0.035, -0.05], [-0.03, -0.03], [0.0, -0.03], [0.065, -0.02]], 0.044, 0.003,
      [[[-0.058, -0.016], [-0.06, -0.038], [-0.045, -0.042], [-0.034, -0.03], [-0.04, -0.016]]]), G.dark);
    P(g, cylZ(0.012, 0.012, 0.05), G.steel, 0, 0.02, -0.155);
    D(g, cylZ(0.014, 0.014, 0.02), G.dark, 0, 0.02, -0.142);
    P(g, rbox(0.04, 0.05, 0.03, 0.006), G.poly, 0, -0.045, -0.11);                   // front strap
    trigger(g, -0.046, -0.024);
    chargingHandle(g, u, 0, 0.05, -0.06, 0.05, h => { P(h, rbox(0.012, 0.016, 0.016, 0.004), G.steel, 0, 0.006, 0); });
    // folded wire stock along the sides
    for (const sx of [-0.026, 0.026]) D(g, cylZ(0.004, 0.004, 0.19), G.steel, sx, -0.0, 0.16);
    D(g, rbox(0.06, 0.035, 0.008, 0.003), G.steel, 0, -0.005, 0.255);
    const m = magGroup(g, 0, -0.03, -0.008, -0.05);
    P(m, rbox(0.03, 0.2, 0.036, 0.004), G.poly, 0, -0.1, 0);
    P(m, rbox(0.036, 0.012, 0.044, 0.004), G.dark, 0, -0.203, 0);
    u.mag = m;
    sightsIron(g, -0.12, 0.06, 0.05);
    u.grip = V(0, -0.08, -0.008); u.gripTilt = 0.05;
    u.fore = V(0, -0.055, -0.11); u.foreKind = 'vgrip';
    u.charge.y += 0.01;
    u.muzzleAt = V(0, 0.02, -0.182);
  },
  mp9(g, u) {
    u.kind = 'smg';
    P(g, profile('mp9rcv', [[0.07, -0.01], [0.075, 0.035], [0.06, 0.05], [-0.18, 0.05], [-0.2, 0.035], [-0.2, 0.0], [-0.17, -0.012]], 0.046, 0.004), G.poly);
    picatinny(g, 0.2, -0.06, 0.05, 0.022);
    P(g, profile('mp9lower', [[0.06, -0.01], [-0.12, -0.01], [-0.075, -0.035], [-0.04, -0.045], [-0.025, -0.03], [0.0, -0.03], [0.04, -0.02]], 0.04, 0.003,
      [[[-0.068, -0.016], [-0.06, -0.032], [-0.042, -0.036], [-0.034, -0.026], [-0.045, -0.016]]]), G.poly);
    P(g, cylZ(0.011, 0.011, 0.04), G.steel, 0, 0.018, -0.218);
    const vg = new THREE.Group(); vg.position.set(0, -0.012, -0.16); g.add(vg);   // folding front grip
    P(vg, rbox(0.026, 0.06, 0.03, 0.008), G.poly, 0, -0.03, 0, 0.1);
    trigger(g, -0.052, -0.022);
    // folded stock on the right side
    D(g, rbox(0.012, 0.03, 0.2, 0.004), G.poly, 0.03, 0.012, 0.13);
    D(g, rbox(0.02, 0.06, 0.02, 0.005), G.poly, 0.03, -0.0, 0.23);
    const m = magGroup(g, 0, -0.028, -0.01, -0.12);
    P(m, rbox(0.026, 0.17, 0.032, 0.004), G.dark, 0, -0.085, 0);
    P(m, rbox(0.032, 0.012, 0.04, 0.004), G.poly, 0, -0.172, 0);
    u.mag = m;
    sightsIron(g, -0.175, 0.055, 0.05, 0.022);
    chargingHandle(g, u, 0, 0.038, 0.074, 0.035, h => {
      P(h, rbox(0.044, 0.012, 0.012, 0.004), G.dark, 0, 0, 0.004);
      P(h, rbox(0.012, 0.01, 0.03, 0.003), G.dark, 0, 0, -0.01);
    });
    u.charge.z += 0.004;
    u.grip = V(0, -0.075, -0.0); u.gripTilt = 0.12;
    u.fore = V(0, -0.055, -0.16); u.foreKind = 'vgrip';
    u.muzzleAt = V(0, 0.018, -0.24);
  },
  mag7(g, u) {
    u.kind = 'shotgun';
    P(g, profile('mag7rcv', [[0.09, -0.01], [0.1, 0.04], [0.08, 0.055], [-0.2, 0.055], [-0.22, 0.04], [-0.22, -0.01]], 0.06, 0.005), G.olive);
    D(g, rbox(0.062, 0.012, 0.26, 0.003), G.dark, 0, 0.05, -0.06);
    P(g, cylZ(0.021, 0.021, 0.2), G.blued, 0, 0.03, -0.32);
    P(g, cylZ(0.023, 0.023, 0.012), G.dark, 0, 0.03, -0.425);
    const pump = new THREE.Group(); pump.position.set(0, -0.005, -0.335); g.add(pump);
    P(pump, rbox(0.054, 0.05, 0.11, 0.012), G.poly, 0, -0.01, 0);
    P(pump, cylZ(0.024, 0.024, 0.104), G.dark, 0, 0.035, 0);                         // sleeve round the barrel
    if (HI()) for (let i = 0; i < 4; i++) P(pump, rbox(0.057, 0.006, 0.008, 0.002), G.dark, 0, -0.01, -0.04 + i * 0.027);
    u.pump = pump; u.stroke = 0.055;
    P(g, profile('mag7lower', [[0.09, -0.01], [-0.06, -0.01], [-0.075, -0.035], [-0.04, -0.05], [-0.02, -0.03], [0.0, -0.03], [0.09, -0.02]], 0.05, 0.003,
      [[[-0.062, -0.016], [-0.058, -0.034], [-0.042, -0.04], [-0.03, -0.028], [-0.04, -0.016]]]), G.poly);
    trigger(g, -0.048, -0.024);
    // folded stock along the right side
    D(g, rbox(0.012, 0.03, 0.2, 0.005), G.poly, 0.036, 0.01, 0.02);
    D(g, rbox(0.016, 0.06, 0.02, 0.006), G.rubber, 0.036, 0.0, 0.12);
    const m = magGroup(g, 0, -0.03, 0.005, -0.18);   // magazine in the pistol grip
    P(m, rbox(0.04, 0.15, 0.05, 0.006), G.poly, 0, -0.075, 0);
    P(m, rbox(0.046, 0.014, 0.058, 0.005), G.dark, 0, -0.152, 0);
    u.mag = m;
    sightsIron(g, -0.185, 0.065, 0.055);
    u.grip = V(0, -0.085, 0.012); u.gripTilt = 0.18;
    u.fore = V(0, -0.045, -0.335); u.foreKind = 'pump';
    u.charge = u.fore.clone();
    u.muzzleAt = V(0, 0.03, -0.432);
  },
  xm1014(g, u) {
    u.kind = 'shotgun';
    P(g, profile('xmrcv', [[0.04, -0.01], [0.04, 0.045], [0.02, 0.055], [-0.2, 0.055], [-0.21, 0.045], [-0.21, -0.012]], 0.052, 0.004), G.dark);
    picatinny(g, 0.14, -0.07, 0.055, 0.022);
    P(g, cylZ(0.019, 0.019, 0.4), G.blued, 0, 0.032, -0.41);
    P(g, cylZ(0.017, 0.017, 0.32), G.dark, 0, -0.008, -0.37);                       // tube magazine
    P(g, cylZ(0.019, 0.019, 0.016), G.dark, 0, -0.008, -0.535);
    P(g, rbox(0.052, 0.052, 0.2, 0.012), G.poly, 0, 0.004, -0.3);                   // forend
    if (HI()) for (let i = 0; i < 6; i++) P(g, rbox(0.055, 0.006, 0.01, 0.002), G.dark, 0, 0.0, -0.22 - i * 0.03);
    D(g, rbox(0.016, 0.022, 0.022, 0.004), G.dark, 0, 0.059, -0.6);                 // front sight
    D(g, rbox(0.03, 0.026, 0.02, 0.004), G.dark, 0, 0.075, 0.01);                   // ghost ring
    P(g, profile('xmlower', [[0.04, -0.01], [-0.06, -0.012], [-0.07, -0.035], [-0.04, -0.05], [-0.02, -0.03], [0.04, -0.02]], 0.046, 0.003,
      [[[-0.058, -0.017], [-0.055, -0.035], [-0.042, -0.04], [-0.03, -0.027], [-0.04, -0.017]]]), G.dark);
    trigger(g, -0.046, -0.025);
    // pistol grip + collapsible stock
    P(g, profile('xmgrip', [[0.04, -0.02], [0.0, -0.03], [0.012, -0.13], [0.05, -0.13], [0.06, -0.03]], 0.034, 0.004), G.poly);
    P(g, cylZ(0.015, 0.015, 0.16), G.dark, 0, 0.02, 0.12);
    P(g, profile('xmstock', [[0.12, 0.05], [0.25, 0.05], [0.26, -0.07], [0.22, -0.07], [0.15, 0.0], [0.12, 0.0]], 0.04, 0.005), G.poly);
    P(g, rbox(0.046, 0.13, 0.02, 0.006), G.rubber, 0, -0.008, 0.265);
    D(g, rbox(0.03, 0.022, 0.03, 0.005), G.dark, 0, 0.0, -0.14);                     // loading port
    u.grip = V(0, -0.07, 0.03); u.gripTilt = 0.3;
    u.fore = V(0, -0.02, -0.3); u.foreKind = 'under';
    u.port = V(0, -0.03, -0.14);
    chargingHandle(g, u, 0.026, 0.026, -0.1, 0.06, h => { P(h, rbox(0.02, 0.012, 0.022, 0.004), G.steel, 0.008, 0, 0); });
    u.charge.x += 0.012;
    u.muzzleAt = V(0, 0.032, -0.612);
  },
  galil(g, u) {
    rifleBody(g, u, { color: G.steel, len: 0.32 });
    P(g, profile('galilhg', [[-0.2, 0.035], [-0.42, 0.035], [-0.43, 0.025], [-0.43, -0.03], [-0.2, -0.03]], 0.058, 0.006), G.tan);
    if (HI()) for (let i = 0; i < 6; i++) P(g, rbox(0.061, 0.008, 0.012, 0.002), G.dark, 0, 0.005, -0.24 - i * 0.03);
    P(g, cylZ(0.012, 0.012, 0.16), G.blued, 0, 0.012, -0.51);
    P(g, cylZ(0.015, 0.015, 0.04), G.dark, 0, 0.012, -0.6);
    D(g, cylZ(0.007, 0.007, 0.21), G.blued, 0, 0.04, -0.33);                         // gas tube
    P(g, rbox(0.03, 0.03, 0.03, 0.004), G.dark, 0, 0.03, -0.45);                     // gas block
    D(g, rbox(0.012, 0.04, 0.012, 0.003), G.dark, 0, 0.06, -0.45);                   // front sight post
    D(g, rbox(0.03, 0.022, 0.03, 0.004), G.dark, 0, 0.064, 0.03);                    // rear sight
    rifleGrip(g, 'galil', G.poly);
    // skeleton folding stock
    P(g, rbox(0.04, 0.05, 0.04, 0.008), G.dark, 0, 0.02, 0.105);                    // stock hinge
    P(g, profile('galilstock', [[0.12, 0.04], [0.33, 0.04], [0.35, -0.08], [0.31, -0.08], [0.3, 0.0], [0.14, 0.0]], 0.026, 0.004,
      [[[0.17, 0.028], [0.29, 0.028], [0.29, 0.012], [0.17, 0.012]]]), G.dark);
    P(g, rbox(0.04, 0.14, 0.02, 0.006), G.rubber, 0, -0.02, 0.352);
    curvedMag(g, u, 'galil', 0.035, G.dark, 0.2);
    u.fore = V(0, -0.025, -0.3);
    u.muzzleAt = V(0, 0.012, -0.62);
  },
  ak47(g, u) {
    // receiver with dust cover, wooden furniture, curved magazine
    P(g, profile('akrcv', [[0.11, -0.01], [0.11, 0.04], [0.09, 0.055], [-0.2, 0.055], [-0.215, 0.04], [-0.215, -0.012], [0.11, -0.012]], 0.052, 0.004), G.steel);
    P(g, profile('akcover', [[0.105, 0.05], [0.1, 0.066], [-0.17, 0.066], [-0.19, 0.055], [-0.19, 0.05]], 0.048, 0.006), G.blued);
    D(g, rbox(0.004, 0.012, 0.11, 0.002), G.blued, 0.027, 0.03, -0.04);             // safety lever
    chargingHandle(g, u, 0.026, 0.04, -0.12, 0.09, h => {
      P(h, rbox(0.004, 0.012, 0.09, 0.0015), G.steel, 0.0, 0, 0.03);                  // carrier strip in the slot
      P(h, rbox(0.016, 0.011, 0.024, 0.004), G.steel, 0.008, 0, 0);                    // handle
    });
    P(g, profile('akhgl', [[-0.215, 0.04], [-0.42, 0.035], [-0.43, 0.02], [-0.43, -0.022], [-0.215, -0.025]], 0.06, 0.008), G.wood);
    P(g, profile('akhgu', [[-0.215, 0.055], [-0.215, 0.078], [-0.41, 0.075], [-0.41, 0.058]], 0.044, 0.008), G.wood);
    P(g, cylZ(0.0115, 0.0115, 0.2), G.blued, 0, 0.018, -0.53);
    P(g, rbox(0.03, 0.05, 0.03, 0.005), G.blued, 0, 0.04, -0.6);                    // front sight block
    P(g, rbox(0.006, 0.03, 0.006, 0.002), G.blued, 0, 0.078, -0.6);
    P(g, cylZ(0.016, 0.014, 0.06), G.blued, 0, 0.018, -0.655);                      // muzzle brake
    D(g, cylZ(0.008, 0.008, 0.18), G.blued, 0, 0.062, -0.5);                        // gas tube
    D(g, rbox(0.03, 0.022, 0.05, 0.004), G.blued, 0, 0.066, -0.205);                // rear sight block
    P(g, profile('akgrip', [[0.07, -0.012], [0.035, -0.012], [0.05, -0.13], [0.085, -0.13], [0.095, -0.02]], 0.032, 0.005), G.wood);
    P(g, profile('akguard', [[0.035, -0.012], [-0.055, -0.012], [-0.06, -0.03], [-0.04, -0.045], [0.02, -0.045], [0.04, -0.025]], 0.03, 0.002,
      [[[0.025, -0.016], [-0.045, -0.016], [-0.048, -0.028], [-0.034, -0.038], [0.014, -0.038], [0.027, -0.025]]]), G.blued);
    trigger(g, -0.01, -0.026);
    P(g, profile('akstock', [[0.11, 0.045], [0.38, 0.0], [0.39, -0.1], [0.36, -0.105], [0.21, -0.04], [0.11, -0.012]], 0.04, 0.008), G.wood);
    P(g, rbox(0.044, 0.11, 0.012, 0.004), G.blued, 0, -0.05, 0.384, 0, 0, 0).rotation.x = -0.15;
    curvedMag(g, u, 'ak', 0.038, G.woodDark, 0.32, -0.07);
    u.grip = V(0, -0.07, 0.065); u.gripTilt = 0.3;
    u.fore = V(0, -0.03, -0.3); u.foreKind = 'under';
    u.charge.x += 0.014;
    u.muzzleAt = V(0, 0.018, -0.688);
  },
  m4a4(g, u) {
    arBody(g, u, 'm4a4');
    // quad-rail handguard + front sight post
    P(g, rbox(0.06, 0.06, 0.24, 0.008), G.dark, 0, 0.015, -0.322);
    if (HI()) for (const [sx, sy] of [[0, 0.048], [0.034, 0.015], [-0.034, 0.015], [0, -0.018]]) {
      for (let i = 0; i < 9; i++) P(g, rbox(sx ? 0.006 : 0.03, sx ? 0.03 : 0.006, 0.01, 0.0015), G.dark, sx, sy, -0.23 - i * 0.024);
    }
    P(g, cylZ(0.011, 0.011, 0.17), G.blued, 0, 0.02, -0.535);
    D(g, profile('m4fsp', [[-0.43, 0.02], [-0.44, 0.08], [-0.455, 0.08], [-0.47, 0.02]], 0.014, 0.002), G.dark);
    P(g, cylZ(0.014, 0.014, 0.05), G.dark, 0, 0.02, -0.64);                        // flash hider
    D(g, rbox(0.024, 0.03, 0.03, 0.004), G.dark, 0, 0.075, 0.03);                  // rear sight
    straightMag(g, u, 'm4', 0.175);
    u.fore = V(0, -0.025, -0.3);
    u.muzzleAt = V(0, 0.02, -0.665);
  },
  m4a1s(g, u) {
    arBody(g, u, 'm4a1s');
    P(g, rbox(0.056, 0.055, 0.25, 0.012), G.dark, 0, 0.015, -0.327);              // slim handguard
    if (HI()) for (let i = 0; i < 7; i++) P(g, rbox(0.058, 0.014, 0.012, 0.004), G.grey, 0, 0.0, -0.24 - i * 0.03);
    picatinny(g, 0.25, -0.327, 0.0425, 0.022);
    P(g, cylZ(0.011, 0.011, 0.1), G.blued, 0, 0.02, -0.485);
    D(g, rbox(0.018, 0.03, 0.02, 0.004), G.dark, 0, 0.065, -0.43);                 // flip-up front sight
    D(g, rbox(0.022, 0.026, 0.02, 0.004), G.dark, 0, 0.068, 0.03);
    u.silencer = silencer(g, 0.021, 0.23, 0.02, -0.645);
    straightMag(g, u, 'm4s', 0.13);
    u.fore = V(0, -0.025, -0.3);
    u.muzzleAt = V(0, 0.02, -0.762);                                                  // end of the silencer
  },
  ssg08(g, u) {
    u.kind = 'sniper';
    // slim stock with a thumbhole, long thin barrel, scope and bolt
    P(g, profile('ssgstock', [[0.36, 0.045], [0.36, -0.1], [0.32, -0.105], [0.17, -0.055], [0.1, -0.06], [0.065, -0.13], [0.03, -0.13], [0.02, -0.03],
      [-0.33, -0.03], [-0.35, -0.01], [-0.35, 0.02], [0.08, 0.02], [0.14, 0.045]], 0.044, 0.007,
    [[[0.09, -0.005], [0.15, 0.0], [0.17, -0.04], [0.1, -0.042]]]), G.grey);
    P(g, rbox(0.046, 0.15, 0.02, 0.006), G.rubber, 0, -0.03, 0.365);
    P(g, profile('ssgrcv', [[0.08, 0.018], [0.08, 0.05], [0.06, 0.058], [-0.13, 0.058], [-0.14, 0.05], [-0.14, 0.018]], 0.036, 0.004), G.blued);
    P(g, cylZ(0.012, 0.009, 0.46), G.blued, 0, 0.038, -0.37);
    P(g, cylZ(0.011, 0.011, 0.03), G.dark, 0, 0.038, -0.6);
    scope(g, 0.1, -0.04, 0.2, 0.017, 0.028, 0.024, 0.058);
    trigger(g, 0.035, -0.04);
    D(g, profile('ssgguard', [[0.06, -0.03], [0.0, -0.03], [-0.005, -0.05], [0.02, -0.062], [0.06, -0.05]], 0.022, 0.002,
      [[[0.05, -0.034], [0.006, -0.034], [0.005, -0.046], [0.022, -0.055], [0.05, -0.045]]]), G.dark);
    const bolt = new THREE.Group(); bolt.position.set(0, 0.038, 0.06); g.add(bolt);
    P(bolt, cylZ(0.0095, 0.0095, 0.13), G.steel, 0, 0, -0.06);                       // bolt body
    P(bolt, cylZ(0.011, 0.011, 0.016), G.blued, 0, 0, 0.004);                         // bolt shroud
    P(bolt, cylZ(0.005, 0.005, 0.045), G.steel, 0.026, 0, 0, 0, Math.PI / 2, 0);     // handle
    P(bolt, sphere(0.009), G.dark, 0.05, -0.004, 0);
    u.bolt = bolt; u.stroke = 0.075;
    const m = magGroup(g, 0, -0.025, -0.01, 0);
    P(m, rbox(0.03, 0.05, 0.05, 0.004), G.dark, 0, -0.022, 0);
    u.mag = m;
    u.grip = V(0, -0.075, 0.05); u.gripTilt = 0.35;
    u.fore = V(0, -0.04, -0.24); u.foreKind = 'under';
    u.charge = V(0.05, 0.034, 0.06);
    u.muzzleAt = V(0, 0.038, -0.615);
  },
  awp(g, u) {
    u.kind = 'sniper';
    // big chassis with a thumbhole and cheek rest, heavy barrel, large scope
    P(g, profile('awpstock', [[0.44, 0.06], [0.44, -0.12], [0.4, -0.125], [0.22, -0.07], [0.12, -0.07], [0.075, -0.14], [0.035, -0.14], [0.025, -0.035],
      [-0.33, -0.035], [-0.35, -0.01], [-0.35, 0.03], [0.09, 0.03], [0.16, 0.06]], 0.06, 0.008,
    [[[0.1, -0.008], [0.18, 0.0], [0.2, -0.05], [0.11, -0.052]]]), G.green);
    D(g, rbox(0.05, 0.03, 0.14, 0.008), G.dark, 0, 0.075, 0.31);                    // cheek rest
    P(g, rbox(0.064, 0.18, 0.025, 0.008), G.rubber, 0, -0.03, 0.452);
    P(g, profile('awprcv', [[0.09, 0.025], [0.09, 0.062], [0.07, 0.07], [-0.16, 0.07], [-0.17, 0.06], [-0.17, 0.025]], 0.044, 0.004), G.blued);
    P(g, cylZ(0.019, 0.016, 0.44), G.blued, 0, 0.048, -0.39);
    P(g, cylZ(0.022, 0.022, 0.07), G.dark, 0, 0.048, -0.64);                        // muzzle brake
    if (HI()) for (const dz of [-0.62, -0.645]) P(g, rbox(0.05, 0.012, 0.01, 0.003), G.dark, 0, 0.048, dz);
    scope(g, 0.125, -0.04, 0.26, 0.024, 0.04, 0.033, 0.07);
    trigger(g, 0.04, -0.045);
    D(g, profile('awpguard', [[0.07, -0.035], [0.0, -0.035], [-0.006, -0.058], [0.025, -0.072], [0.07, -0.058]], 0.026, 0.002,
      [[[0.06, -0.039], [0.006, -0.039], [0.004, -0.054], [0.026, -0.064], [0.06, -0.052]]]), G.dark);
    P(g, rbox(0.05, 0.016, 0.03, 0.005), G.dark, 0, -0.04, -0.17);                   // bipod mount
    for (const sx of [-0.019, 0.019]) D(g, cylZ(0.006, 0.006, 0.16), G.dark, sx, -0.045, -0.25);   // folded bipod legs
    const bolt = new THREE.Group(); bolt.position.set(0, 0.048, 0.07); g.add(bolt);
    P(bolt, cylZ(0.0115, 0.0115, 0.15), G.steel, 0, 0, -0.07);                       // bolt body
    P(bolt, cylZ(0.0135, 0.0135, 0.018), G.blued, 0, 0, 0.005);                       // bolt shroud
    P(bolt, cylZ(0.006, 0.006, 0.05), G.steel, 0.03, 0, 0, 0, Math.PI / 2, 0);       // handle
    P(bolt, sphere(0.012), G.dark, 0.058, -0.005, 0);
    u.bolt = bolt; u.stroke = 0.085;
    const m = magGroup(g, 0, -0.03, -0.02, 0);
    P(m, rbox(0.04, 0.07, 0.07, 0.006), G.dark, 0, -0.03, 0);
    u.mag = m;
    u.grip = V(0, -0.08, 0.055); u.gripTilt = 0.35;
    u.fore = V(0, -0.045, -0.24); u.foreKind = 'under';
    u.charge = V(0.058, 0.043, 0.07);
    u.muzzleAt = V(0, 0.048, -0.68);
  },
  // The secret spoon: a big polished serving spoon held in the fist like a knife.
  // Built standing up (handle along y, the hollow of the bowl facing +z) and tipped forward by u.rot.
  spoon(g, u) {
    const steel = G.chrome;
    // handle: a flat bar that is widest at the end and narrows to the neck
    const handle = cached('spoonHandle', () => {
      const s = new THREE.Shape();
      const half = [[-0.078, 0.012], [-0.03, 0.011], [0.04, 0.0078], [0.088, 0.005], [0.112, 0.006]];
      s.moveTo(0, -0.09);
      s.quadraticCurveTo(0.012, -0.09, half[0][1], half[0][0]);
      for (const [y, w] of half.slice(1)) s.lineTo(w, y);
      for (const [y, w] of half.slice().reverse()) s.lineTo(-w, y);
      s.quadraticCurveTo(-0.012, -0.09, 0, -0.09);
      const geo = new THREE.ExtrudeGeometry(s, HI()
        ? { depth: 0.0022, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0009, bevelOffset: -0.0009, bevelSegments: 2, curveSegments: 8 }
        : { depth: 0.004, bevelEnabled: false, curveSegments: 4 });
      geo.translate(0, 0, HI() ? -0.0011 : -0.002);
      return geo;
    });
    P(g, handle, steel);
    // bowl: a thin shell (outside and inside), oval, hollow side towards +z
    const bowl = cached('spoonBowl', () => {
      const R = 0.031, d = 0.015, R2 = R - 0.0017, d2 = d - 0.0015, n = HI() ? 7 : 4, pts = [];
      for (let i = 0; i <= n; i++) { const a = i / n * Math.PI / 2; pts.push(new THREE.Vector2(R * Math.sin(a) + (i ? 0 : 1e-5), -d * Math.cos(a))); }
      pts.push(new THREE.Vector2(R - 0.0004, 0.0007), new THREE.Vector2(R2, 0.0007));
      for (let i = n; i >= 0; i--) { const a = i / n * Math.PI / 2; pts.push(new THREE.Vector2(R2 * Math.sin(a) + (i ? 0 : 1e-5), -d2 * Math.cos(a))); }
      const geo = new THREE.LatheGeometry(pts, HI() ? 22 : 10);
      geo.rotateX(Math.PI / 2);
      geo.scale(1, 1.42, 1);
      return geo;
    });
    P(g, bowl, steel, 0, 0.15, 0.0005);
    D(g, rbox(0.013, 0.004, 0.0034, 0.0012), G.grey, 0, -0.066, 0);                  // maker's stamp on the handle
    u.kind = 'melee';
    u.grip = V(0, -0.028, -0.004); u.gripTilt = 0;
    u.fore = null; u.foreKind = 'cup';
    u.muzzleAt = V(0, 0.15, 0);
    u.rot = V(-0.95, 0.25, 0.3);
  },
};

// AR-style upper/lower receivers, buffer tube, stock and grip
function arBody(g, u, key) {
  P(g, profile(key + 'lower', [[0.07, -0.012], [0.07, 0.022], [-0.12, 0.022], [-0.14, 0.005], [-0.145, -0.02], [-0.11, -0.03], [-0.045, -0.03], [-0.02, -0.012]], 0.046, 0.004), G.dark);
  P(g, profile(key + 'upper', [[0.075, 0.02], [0.075, 0.05], [-0.2, 0.05], [-0.205, 0.02]], 0.05, 0.005), G.dark);
  picatinny(g, 0.13, -0.04, 0.05, 0.022);
  D(g, rbox(0.006, 0.02, 0.06, 0.002), G.blued, 0.026, 0.035, -0.04);             // ejection port cover
  D(g, rbox(0.012, 0.016, 0.02, 0.004), G.dark, 0.026, 0.044, 0.0);               // forward assist
  chargingHandle(g, u, 0, 0.044, 0.068, 0.05, h => {
    P(h, rbox(0.036, 0.01, 0.014, 0.003), G.dark, 0, 0.004, 0.012);                   // T-handle
    P(h, rbox(0.012, 0.008, 0.06, 0.002), G.dark, 0, 0.004, -0.018);
  });
  P(g, profile(key + 'guard', [[0.0, -0.012], [-0.045, -0.03], [-0.04, -0.045], [0.02, -0.045], [0.03, -0.012]], 0.028, 0.002,
    [[[-0.004, -0.016], [-0.034, -0.03], [-0.03, -0.038], [0.014, -0.038], [0.02, -0.016]]]), G.dark);
  trigger(g, 0.0, -0.026);
  rifleGrip(g, key, G.poly);
  P(g, cylZ(0.016, 0.016, 0.17), G.dark, 0, 0.02, 0.16);                           // buffer tube
  P(g, profile(key + 'stock', [[0.15, 0.045], [0.3, 0.045], [0.31, -0.07], [0.27, -0.075], [0.2, -0.015], [0.15, -0.01]], 0.044, 0.006), G.poly);
  P(g, rbox(0.048, 0.125, 0.02, 0.006), G.rubber, 0, -0.012, 0.31);
  u.grip = V(0, -0.07, 0.04); u.gripTilt = 0.32;
  u.foreKind = 'under';
  u.charge = V(0, 0.05, 0.08);
  P(g, rbox(0.006, 0.014, 0.02, 0.002), G.dark, -0.025, 0.006, -0.03);             // bolt release (left side)
  u.boltCatch = V(-0.03, 0.006, -0.03);
}
function rifleBody(g, u, { color, len }) {
  P(g, profile('rcv' + len, [[0.1, -0.01], [0.1, 0.045], [0.08, 0.055], [-len + 0.1, 0.055], [-len + 0.08, 0.035], [-len + 0.08, -0.012]], 0.054, 0.004), color);
  P(g, profile('rcvg' + len, [[0.035, -0.012], [-0.055, -0.012], [-0.06, -0.03], [-0.04, -0.045], [0.02, -0.045], [0.04, -0.025]], 0.03, 0.002,
    [[[0.025, -0.016], [-0.045, -0.016], [-0.048, -0.028], [-0.034, -0.038], [0.014, -0.038], [0.027, -0.025]]]), G.dark);
  trigger(g, -0.01, -0.026);
  chargingHandle(g, u, 0.027, 0.04, -0.1, 0.08, h => {
    P(h, rbox(0.004, 0.012, 0.08, 0.0015), G.steel, 0, 0, 0.03);
    P(h, rbox(0.016, 0.012, 0.022, 0.004), G.steel, 0.008, 0, 0);
  });
  u.charge.x += 0.014;
  u.grip = V(0, -0.07, 0.065); u.gripTilt = 0.3;
  u.foreKind = 'under';
}
function rifleGrip(g, key, m) {
  P(g, profile(key + 'pgrip', [[0.07, -0.012], [0.03, -0.012], [0.045, -0.13], [0.085, -0.13], [0.095, -0.02]], 0.032, 0.006), m);
}
// curved (banana) magazine built from its outline
function curvedMag(g, u, key, w, m, curve, z = -0.06) {
  const pts = [];
  const N = 8, H = 0.2;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push([0.0 - t * curve * 0.25 - t * t * curve * 0.2, -t * H]); }
  for (let i = N; i >= 0; i--) { const t = i / N; pts.push([0.075 - t * curve * 0.25 - t * t * curve * 0.2 + t * 0.012, -t * H]); }
  const grp = magGroup(g, 0, -0.012, z, 0);
  P(grp, profile(key + 'mag', pts, w, 0.004), m).position.z = -0.037;
  const tipZ = -curve * 0.45 + 0.04;
  P(grp, rbox(w + 0.006, 0.014, 0.088, 0.004), G.blued, 0, -H - 0.004, tipZ - 0.037, -curve * 0.9, 0, 0);   // floor plate
  topRound(grp, 0.05, 0.0058, 0.0, -0.002);
  u.mag = grp;
}
function straightMag(g, u, key, h) {
  const grp = magGroup(g, 0, -0.025, -0.075, -0.1);
  const pts = [[0.03, 0], [-0.03, 0], [-0.034, -h], [0.03, -h - 0.004]];
  P(grp, profile(key + 'smag', pts, 0.028, 0.003), G.grey);
  P(grp, rbox(0.034, 0.012, 0.07, 0.004), G.dark, 0, -h - 0.004, 0.0);
  topRound(grp, 0.05, 0.005, 0.0, -0.002);
  u.mag = grp;
}

// ---------- hands and arms ----------
// A gloved hand built around a grip that runs along its local y axis. side: +1 right, -1 left.
// Gloved hand, posed as if wrapped round a pistol grip: the grip runs along y through the
// curl of the fingers, the fingers wrap round the front (-z) and the back of the hand faces
// +x for the right hand (side = 1) or -x for the left hand (side = -1).
function makeHand(c, side) {
  const h = new THREE.Group();
  const glove = mat(c.glove, { rough: 0.85 });
  const pad = mat(c.gloveTrim || '#3a3a3c', { rough: 0.75 });
  const s = side;
  P(h, rbox(0.026, 0.088, 0.078, 0.011), glove, 0.033 * s, -0.002, 0.004);                 // back of the hand / palm
  D(h, rbox(0.006, 0.07, 0.05, 0.003), pad, 0.047 * s, 0.002, -0.004);                     // padded back plate
  // four fingers, each in two pieces: across the front, then curling round the far side
  const fingers = [[0.031, 0.0175, 1], [0.0105, 0.0185, 1.02], [-0.0105, 0.0175, 0.97], [-0.03, 0.015, 0.86]];
  for (const [y, w, l] of fingers) {
    P(h, rbox(0.046 * l, w, 0.022, 0.0075), glove, (0.012 - 0.004 * (1 - l)) * s, y, -0.037);            // first joints (front)
    P(h, rbox(0.021, w * 0.94, 0.03 * l, 0.0075), glove, -0.016 * s, y, -0.021, 0, 0.25 * s, 0);        // finger tips (far side)
    D(h, rbox(0.024, w * 0.8, 0.006, 0.0025), pad, 0.016 * s, y, -0.0495);                               // knuckle pads
  }
  // thumb: base on the palm, tip over the top of the grip
  P(h, rbox(0.024, 0.022, 0.04, 0.009), glove, 0.02 * s, 0.04, 0.012, 0, 0.5 * s, 0);
  P(h, rbox(0.019, 0.019, 0.034, 0.008), glove, -0.004 * s, 0.047, -0.012, 0.15, 0.95 * s, 0);
  // cuff with a strap
  P(h, rbox(0.05, 0.044, 0.064, 0.014), glove, 0.03 * s, -0.052, 0.034);
  D(h, rbox(0.052, 0.014, 0.066, 0.005), pad, 0.03 * s, -0.056, 0.034);
  h.userData.wrist = V(0.03 * s, -0.064, 0.042);
  mergeStatic(h);
  h.traverse(o => { o.castShadow = false; });
  return h;
}
// tapered forearm from the wrist (y = 0) to the elbow (y = 1): drawn at unit length and
// stretched to the real length each frame, so its outline is a lathe profile
const lathe = (key, pts, seg = 14) => cached(`la|${key}`, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), HI() ? seg : 7));
function makeForearm(c, skin) {
  const a = new THREE.Group();
  P(a, lathe('farm', [[0, -0.01], [0.022, -0.01], [0.025, 0.04], [0.031, 0.14], [0.036, 0.25], [0.038, 0.34], [0, 0.34]]), mat(skin, { rough: 0.65 }));
  P(a, lathe('sleeve', [[0.034, 0.258], [0.044, 0.26], [0.054, 0.29], [0.056, 0.36], [0.052, 0.42], [0.054, 1.05], [0, 1.05]]), fabric(c, 'camo', 1.5));  // rolled-up sleeve
  a.traverse(o => { o.castShadow = false; });
  return a;
}

// First-person view model: the gun plus both hands and forearms. The hands are posed by
// poseViewModel() in anim.js (holding, reloading, racking, bolt and pump actions).
export function makeViewModel(weapon, team) {
  const c = TEAM_COLORS[team] || TEAM_COLORS.atk;
  const skin = SKINS[(team || '').length % SKINS.length];
  const g = new THREE.Group();
  const gun = weapon === 'c4' ? bombInHand() : gunMesh(weapon);
  g.add(gun);
  const handR = makeHand(c, 1), handL = makeHand(c, -1);
  const armR = makeForearm(c, skin), armL = makeForearm(c, skin);
  g.add(handR, handL, armR, armL);
  gun.traverse(o => { o.castShadow = false; });
  const u = gun.userData;
  if (u.kind === 'melee') handL.visible = armL.visible = false;      // held in one hand
  g.userData = {
    gun, handR, handL, armR, armL, muzzle: u.muzzle, silencer: u.silencer || null, parts: u,
    elbowR: V(0.22, -0.28, 0.3), elbowL: V(-0.3, -0.5, -0.05),
    rest: { mag: u.mag && { p: u.mag.position.clone(), r: u.mag.rotation.clone() }, slide: u.slide && u.slide.position.clone(), pump: u.pump && u.pump.position.clone(), bolt: u.bolt && { p: u.bolt.position.clone(), r: u.bolt.rotation.clone() }, handle: u.handle && u.handle.position.clone() },
  };
  return g;
}

// ---------- characters ----------
function segment(parent, name, rag, half, offsetY, build) {
  const seg = new THREE.Group();
  seg.position.y = offsetY;
  build(seg);
  mergeStatic(seg);
  parent.add(seg);
  rag[name] = { seg, half };
  return seg;
}
const hashName = s => { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

export function makePlayerModel(team, name, showName) {
  const c = TEAM_COLORS[team] || TEAM_COLORS.atk;
  const root = new THREE.Group();
  const skinCol = SKINS[hashName(name) % SKINS.length];
  const skin = mat(skinCol, { rough: 0.65 });
  const shirt = fabric(c, 'camo', 3), shirtCap = fabric(c, 'camo', 1.4);
  const pants = fabric(c, 'pants', 3), pantsCap = fabric(c, 'pants', 1.4);
  const vest = mat(c.vest, { rough: 0.85 }), gear = mat(c.gear, { rough: 0.85 });
  const dark = mat('#1d1e21', { rough: 0.7 }), boots = mat(c.boots, { rough: 0.8 }), sole = mat('#121212', { rough: 0.95 });
  const glove = mat(c.glove, { rough: 0.9 });
  const rag = {};

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);
  segment(hips, 'pelvis', rag, [0.17, 0.1, 0.12], 0, g => {
    P(g, rbox(0.32, 0.18, 0.22, 0.06), pants);
    P(g, rbox(0.34, 0.045, 0.24, 0.015), dark, 0, 0.075, 0);                        // belt
    D(g, rbox(0.05, 0.035, 0.012, 0.004), mat('#8a8a8a', { metal: 0.7, rough: 0.4 }), 0, 0.075, -0.125);   // buckle
    D(g, rbox(0.06, 0.08, 0.05, 0.012), gear, -0.17, 0.03, 0.03);                   // hip pouch
  });

  const thighs = [], shins = [], feet = [];
  for (const [side, sx] of [['L', -0.1], ['R', 0.1]]) {
    const thigh = new THREE.Group();
    thigh.position.set(sx, -0.04, 0);
    hips.add(thigh);
    segment(thigh, 'thigh' + side, rag, [0.09, 0.21, 0.1], -0.21, g => {
      P(g, capsule(0.088, 0.25), pantsCap, 0, 0.0, 0);
      D(g, rbox(0.04, 0.12, 0.1, 0.02), pants, 0.085 * Math.sign(sx), -0.03, 0.0);   // cargo pocket
      if (side === 'R' && HI()) {
        P(g, rbox(0.05, 0.16, 0.1, 0.02), dark, 0.1, 0.03, 0.0);                     // drop-leg holster
        P(g, rbox(0.045, 0.06, 0.08, 0.015), mat('#2a2b2f', { rough: 0.6 }), 0.1, 0.12, 0.0);
      }
    });
    const shin = new THREE.Group();
    shin.position.y = -0.42;
    thigh.add(shin);
    segment(shin, 'shin' + side, rag, [0.085, 0.23, 0.11], -0.22, g => {
      P(g, capsule(0.072, 0.2), pantsCap, 0, 0.05, 0);
      P(g, rbox(0.11, 0.13, 0.05, 0.02), gear, 0, 0.18, -0.06);                     // knee pad
      // boot from its side outline, with a darker sole
      P(g, profile('boot', [[0.055, -0.08], [0.06, -0.225], [-0.16, -0.225], [-0.185, -0.205], [-0.18, -0.17], [-0.12, -0.15], [-0.05, -0.12], [-0.04, -0.06], [-0.035, 0.0], [0.05, 0.0]], 0.12, 0.018), boots, 0, 0, 0);
      P(g, profile('sole', [[0.062, -0.215], [0.064, -0.24], [-0.17, -0.24], [-0.192, -0.22], [-0.18, -0.205], [0.06, -0.205]], 0.13, 0.01), sole, 0, 0, 0);
      D(g, rbox(0.125, 0.012, 0.06, 0.004), dark, 0, -0.1, -0.03);                   // laces band
      feet.push(g);
    });
    thighs.push(thigh); shins.push(shin);
  }

  const spine = new THREE.Group();
  spine.position.y = 0.08;
  hips.add(spine);
  segment(spine, 'chest', rag, [0.25, 0.25, 0.15], 0.26, g => {
    // torso tapering from shoulders to waist
    P(g, profile('torso', [[0.105, -0.29], [0.13, -0.05], [0.12, 0.2], [0.09, 0.26], [-0.09, 0.26], [-0.12, 0.2], [-0.13, -0.05], [-0.105, -0.29]], 0.36, 0.05), shirt, 0, 0, 0);
    P(g, sphere(0.068), shirtCap, 0.2, 0.19, 0).scale.set(1, 0.9, 1.1);            // shoulders
    P(g, sphere(0.068), shirtCap, -0.2, 0.19, 0).scale.set(1, 0.9, 1.1);
    // plate carrier
    P(g, rbox(0.38, 0.36, 0.06, 0.03), vest, 0, 0.02, -0.13);
    P(g, rbox(0.38, 0.36, 0.05, 0.03), vest, 0, 0.02, 0.125);
    P(g, rbox(0.06, 0.36, 0.2, 0.02), vest, 0.19, -0.02, 0);
    P(g, rbox(0.06, 0.36, 0.2, 0.02), vest, -0.19, -0.02, 0);
    P(g, rbox(0.07, 0.06, 0.28, 0.02), vest, 0.13, 0.22, 0);                         // shoulder straps
    P(g, rbox(0.07, 0.06, 0.28, 0.02), vest, -0.13, 0.22, 0);
    if (HI()) {
      for (const x of [-0.11, 0, 0.11]) {
        P(g, rbox(0.085, 0.11, 0.045, 0.012), gear, x, -0.06, -0.175);             // magazine pouches
        P(g, rbox(0.088, 0.03, 0.05, 0.008), gear, x, 0.0, -0.177);
      }
      P(g, rbox(0.09, 0.04, 0.02, 0.008), mat(team === 'def' ? '#8fa3c0' : '#3a3226', { rough: 0.8 }), 0.08, 0.13, -0.163);   // patch
      for (let i = 0; i < 3; i++) P(g, rbox(0.36, 0.008, 0.062, 0.002), dark, 0, 0.08 - i * 0.05, 0.127);   // MOLLE webbing on the back
      if (team === 'def') {
        P(g, rbox(0.08, 0.16, 0.06, 0.012), dark, 0.11, 0.06, 0.18);                 // radio
        P(g, cylY(0.004, 0.004, 0.3), dark, 0.14, 0.26, 0.19);                       // antenna
        P(g, rbox(0.05, 0.06, 0.04, 0.01), gear, -0.11, 0.0, 0.17);
      } else {
        P(g, rbox(0.3, 0.32, 0.12, 0.04), mat('#5a4630', { rough: 0.9 }), 0, 0.0, 0.21);   // backpack
        P(g, rbox(0.26, 0.1, 0.05, 0.02), mat('#4a3826', { rough: 0.9 }), 0, -0.07, 0.28);
        P(g, rbox(0.27, 0.025, 0.13, 0.008), dark, 0, 0.1, 0.21);
      }
    }
    P(g, cylY(0.058, 0.064, 0.1), skin, 0, 0.3, 0);                                  // neck
  });

  const neck = new THREE.Group();
  neck.position.y = 0.52;
  spine.add(neck);
  segment(neck, 'head', rag, [0.14, 0.15, 0.14], 0.1, g => {
    P(g, sphere(0.105), skin, 0, 0.0, 0).scale.set(1, 1.12, 1.08);                   // skull
    P(g, rbox(0.15, 0.08, 0.13, 0.035), skin, 0, -0.075, -0.018);                    // jaw
    P(g, rbox(0.026, 0.045, 0.035, 0.01), skin, 0, -0.012, -0.112);                  // nose
    for (const sx of [-1, 1]) {
      P(g, sphere(0.03), skin, 0.102 * sx, -0.01, 0.005).scale.set(0.45, 1, 0.8);    // ears
      D(g, rbox(0.026, 0.012, 0.008, 0.003), mat('#f2f0ea', { rough: 0.4 }), 0.038 * sx, 0.022, -0.1);   // eyes
      D(g, rbox(0.012, 0.012, 0.006, 0.003), mat('#2a1d14', { rough: 0.4 }), 0.038 * sx, 0.022, -0.104);
      D(g, rbox(0.034, 0.008, 0.01, 0.003), mat('#3a2a1e', { rough: 0.9 }), 0.038 * sx, 0.042, -0.1);    // brows
    }
    if (team === 'def') {
      // ballistic helmet with rails, NVG mount and headset; tinted glasses
      const helm = mat(c.gear, { rough: 0.6 });
      P(g, sphere(0.128, 0, Math.PI * 0.52), helm, 0, 0.018, 0.004).scale.set(1, 0.92, 1.06);
      P(g, new THREE.TorusGeometry(0.124, 0.008, 6, 22), helm, 0, 0.016, 0.004, Math.PI / 2, 0, 0);
      D(g, rbox(0.03, 0.03, 0.12, 0.006), dark, 0.118, 0.035, 0.0);                  // side rails
      D(g, rbox(0.03, 0.03, 0.12, 0.006), dark, -0.118, 0.035, 0.0);
      D(g, rbox(0.05, 0.035, 0.03, 0.008), dark, 0, 0.09, -0.125);                    // NVG mount
      for (const sx of [-1, 1]) D(g, cylY(0.038, 0.038, 0.03), dark, 0.11 * sx, -0.015, 0.0, 0, 0, Math.PI / 2);   // ear cups
      D(g, rbox(0.16, 0.026, 0.02, 0.008), mat('#101418', { metal: 0.3, rough: 0.15 }), 0, 0.02, -0.112);   // glasses
    } else if (team === 'atk') {
      // shemagh wrapped over the lower face and a soft cap
      const wrap = mat(c.scarf, { rough: 0.95, map: camoTex([c.scarf, '#8a4a2a', '#c27a4c', '#6e3a20'], 2) });
      P(g, sphere(0.116, Math.PI * 0.5, Math.PI), wrap, 0, 0.0, -0.004).scale.set(1, 1.15, 1.1);
      P(g, rbox(0.17, 0.1, 0.14, 0.04), wrap, 0, -0.085, -0.02);
      P(g, sphere(0.114, 0, Math.PI * 0.45), mat(c.gear, { rough: 0.9 }), 0, 0.03, 0.004).scale.set(1, 0.85, 1.05);
      P(g, rbox(0.15, 0.012, 0.08, 0.006), mat(c.gear, { rough: 0.9 }), 0, 0.045, -0.12, -0.15, 0, 0);   // peak
      D(g, rbox(0.2, 0.03, 0.02, 0.008), mat('#151515', { metal: 0.3, rough: 0.2 }), 0, 0.02, -0.112);   // sunglasses
    } else {
      P(g, sphere(0.114, 0, Math.PI * 0.5), mat(c.gear, { rough: 0.95 }), 0, 0.025, 0.004).scale.set(1, 0.95, 1.05);   // beanie
      D(g, rbox(0.18, 0.02, 0.012, 0.004), mat('#2c3320', { rough: 0.9 }), 0, -0.04, -0.104);   // face paint
    }
  });

  // arms: two-bone arms whose hands are placed on the gun each frame (inverse kinematics)
  const arms = new THREE.Group();
  arms.position.set(0, 0.44, 0);
  spine.add(arms);
  const L1 = 0.31, L2 = 0.3;
  const limb = (side, sx) => {
    const sh = new THREE.Group();
    sh.position.set(sx, 0, 0);
    arms.add(sh);
    segment(sh, 'uarm' + side, rag, [0.06, L1 / 2, 0.06], -L1 / 2, g => {
      P(g, capsule(0.058, L1 - 0.06), shirtCap);
      D(g, rbox(0.06, 0.06, 0.08, 0.02), gear, 0.04 * Math.sign(sx), 0.05, 0);        // shoulder pocket / flag patch
    });
    const el = new THREE.Group();
    el.position.y = -L1;
    sh.add(el);
    const fseg = segment(el, 'farm' + side, rag, [0.055, L2 / 2, 0.055], -L2 / 2, g => {
      P(g, capsule(0.05, L2 - 0.08), shirtCap, 0, 0.02, 0);
      D(g, rbox(0.075, 0.07, 0.08, 0.02), gear, 0, 0.13, -0.02);                      // elbow pad
      P(g, cylY(0.036, 0.042, 0.06), glove, 0, -L2 / 2 + 0.02, 0);                     // glove cuff at the wrist
    });
    const hand = makeHand(c, Math.sign(sx));
    hand.traverse(o => { o.castShadow = true; });
    fseg.add(hand);
    return { sh, el, sx, seg: fseg, hand };
  };
  const armR = limb('R', 0.215), armL = limb('L', -0.215);
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.1, -0.1, -0.3);
  arms.add(gunHolder);

  let label = null;
  if (showName) {
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, c.css), depthTest: false, transparent: true }));
    label.scale.set(1.6, 0.4, 1);
    label.position.y = 2.15;
    label.renderOrder = 10;
    root.add(label);
  }
  const model = {
    root, hips, spine, neck, thighs, shins, feet, arms, armL, armR, gunHolder, label, rag, team, L1, L2,
    weapon: null, phase: 0, air: 0, t: Math.random() * 10, kick: 0, land: 0, legYaw: 0, lean: 0, wasAir: false, useW: 0,
  };
  setModelWeapon(model, team === 'def' ? 'usp' : 'glock');
  return model;
}

// how each kind of gun is held: gun position (in front of the chest) and how far the upper
// body turns sideways into a shooting stance (long guns: left shoulder forward)
const HOLD = {
  pistol: V(0.0, -0.1, -0.44), smg: V(0.1, -0.11, -0.36), shotgun: V(0.12, -0.1, -0.36), rifle: V(0.12, -0.1, -0.36), sniper: V(0.12, -0.11, -0.34), bomb: V(0, -0.22, -0.32),
  melee: V(0.2, -0.2, -0.36),
};
const BLADE = { pistol: 0, smg: -0.45, shotgun: -0.6, rifle: -0.6, sniper: -0.6, bomb: 0, melee: 0 };
const YAXIS = new THREE.Vector3(0, 1, 0);
export function setModelWeapon(model, weapon) {
  if (model.weapon === weapon) return;
  model.weapon = weapon;
  model.gunHolder.clear();
  const gun = weapon === 'c4' ? bombInHand() : gunMesh(weapon);
  model.gunHolder.add(gun);
  model.gunData = gun.userData;
  model.gunHolder.position.copy(HOLD[gun.userData.kind] || HOLD.rifle);
}

// two-bone IK: point the upper arm and forearm so the hand reaches `target` (arms space)
const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
function solveArm(arm, target, L1, L2, pole) {
  const s = arm.sh.position;
  _d.subVectors(target, s);
  const dist = Math.max(0.08, Math.min(L1 + L2 - 0.002, _d.length()));
  _d.normalize();
  const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(s).addScaledVector(_d, L1 * Math.cos(a)).addScaledVector(_p, L1 * Math.sin(a));   // elbow
  _f.subVectors(_e, s).normalize();
  arm.sh.quaternion.setFromUnitVectors(DOWN, _f);
  _f.copy(s).addScaledVector(_d, dist).sub(_e).normalize();
  _q.copy(arm.sh.quaternion).invert();
  _f.applyQuaternion(_q);
  arm.el.quaternion.setFromUnitVectors(DOWN, _f);
}
const POLE_R = new THREE.Vector3(0.8, -1, 0.35), POLE_L = new THREE.Vector3(-0.8, -1, 0.15);
const _t = new THREE.Vector3();

// state: { speed, fwd, side (m/s in the body's frame), pitch, air, use (planting / defusing) }
export function animateModel(model, dt, state) {
  model.t += dt;
  const speed = state.speed || 0;
  const use = !!state.use;
  // airborne / landing
  model.air += ((state.air ? 1 : 0) - model.air) * Math.min(1, dt * 10);
  if (model.wasAir && !state.air) model.land = 1;
  model.wasAir = !!state.air;
  model.land = Math.max(0, model.land - dt * 4);
  model.kick = Math.max(0, model.kick - dt * 9);
  // legs face the way you move (strafing / walking backwards), the upper body keeps aiming
  const fwd = state.fwd != null ? state.fwd : speed, side = state.side || 0;
  let ang = Math.atan2(side, fwd), dir = 1;
  if (Math.abs(ang) > 1.95) { ang -= Math.sign(ang) * Math.PI; dir = -1; }
  const moving = Math.min(1, speed / 1.2);
  const wantYaw = Math.max(-1.1, Math.min(1.1, ang)) * moving;
  model.legYaw += (wantYaw - model.legYaw) * Math.min(1, dt * 8);
  const walk = speed < 3.2;
  model.phase += dt * speed * (walk ? 2.6 : 1.85) * dir;
  const run = Math.min(1, speed / 5.5) * (1 - model.air);
  const amp = (walk ? 0.38 : 0.62) * Math.min(1, speed / 2) * (1 - model.air);
  const ph = model.phase;
  const breathe = Math.sin(model.t * 1.6) * (1 - moving);

  // hips: height, bob and sway
  let hipY = 0.92 - model.land * 0.07 - model.air * 0.04;
  hipY += (Math.abs(Math.sin(ph)) - 0.6) * 0.03 * Math.min(1, speed / 2) * (1 - model.air);
  model.hips.position.y = hipY;
  const gd = model.gunData || {};
  const kind = gd.kind || 'rifle';
  model.blade = (model.blade || 0) + ((use ? 0 : BLADE[kind] || 0) - (model.blade || 0)) * Math.min(1, dt * 8);
  model.hips.rotation.set(0, -model.legYaw, Math.sin(ph) * 0.035 * run);
  model.spine.rotation.y = model.legYaw + model.blade;

  for (let i = 0; i < 2; i++) {
    const s = Math.sin(ph + (i ? Math.PI : 0));
    const c = Math.cos(ph + (i ? Math.PI : 0));
    // forward swing lifts the knee; idle stance keeps the left foot a little ahead
    const stance = (1 - moving) * (i === 0 ? -0.12 : 0.1);
    const tuck = model.air * (i ? 0.45 : 0.85);
    model.thighs[i].rotation.set(s * amp + stance + tuck - model.land * 0.25, 0, 0);
    const knee = 0.12 * moving + Math.max(0, c) * (walk ? 0.55 : 1.1) * Math.min(1, speed / 2) * (1 - model.air) + model.land * 0.5;
    model.shins[i].rotation.set(-knee - tuck * 1.25, 0, 0);
  }
  // kneeling to plant or defuse: right knee on the ground, left foot forward (blends in and out)
  model.useW += ((use ? 1 : 0) - model.useW) * Math.min(1, dt * 7);
  const kw = smooth01(model.useW);
  if (kw > 0.001) {
    const mix = (a, b) => a + (b - a) * kw;
    model.hips.position.y = mix(model.hips.position.y, 0.53);
    model.hips.rotation.set(mix(model.hips.rotation.x, 0), mix(model.hips.rotation.y, 0), mix(model.hips.rotation.z, 0));
    model.spine.rotation.y = mix(model.spine.rotation.y, 0);
    const T = model.thighs, S = model.shins;
    T[1].rotation.x = mix(T[1].rotation.x, 0.25); S[1].rotation.x = mix(S[1].rotation.x, -1.65);
    T[0].rotation.x = mix(T[0].rotation.x, 1.4); S[0].rotation.x = mix(S[0].rotation.x, -1.4);
  }
  // upper body: lean into a run, breathing
  const lean = -0.18 * run - 0.35 * kw + breathe * 0.012;
  model.spine.rotation.x = lean;
  model.spine.rotation.z = -Math.sin(ph) * 0.03 * run;
  // aim pitch and gun hold
  const aim = (state.pitch || 0) * (1 - kw) - 0.35 * kw;
  model.armsPitch = model.armsPitch == null ? aim : model.armsPitch + (aim - model.armsPitch) * Math.min(1, dt * 12);
  model.arms.rotation.x = model.armsPitch - lean + model.kick * 0.12;
  model.arms.position.y = 0.44 + Math.sin(ph * 2) * 0.01 * run - model.air * 0.01;
  model.neck.rotation.x = (state.pitch || 0) * 0.6 - lean;
  model.neck.rotation.y = -model.blade * 0.85 - model.legYaw * 0.3;
  // hands on the gun (or working on the bomb); the gun turns back to point straight ahead
  const hold = model.gunHolder.position;
  hold.copy(HOLD[kind] || HOLD.rifle);
  hold.z += model.kick * 0.04;
  // swinging the spoon: a sweep across the body, or a jab straight out
  let swingX = 0;
  if (model.swingT != null) {
    model.swingT += dt / (model.swingStab ? 0.42 : 0.34);
    if (model.swingT >= 1 || kind !== 'melee') model.swingT = null;
    else {
      const s = Math.sin(Math.PI * model.swingT);      // out and back
      if (model.swingStab) { hold.z -= 0.3 * s; hold.y += 0.1 * s; hold.x -= 0.08 * s; swingX = -0.5 * s; }
      else { hold.x -= 0.5 * s; hold.z -= 0.14 * s; hold.y += 0.06 * s; swingX = -0.45 * s; }
    }
  }
  hold.applyAxisAngle(YAXIS, -model.blade);
  model.gunHolder.rotation.y = -model.blade;
  model.gunHolder.rotation.x = swingX;
  model.gunHolder.visible = kw < 0.5;
  model.gunHolder.updateMatrix();
  const gun = model.gunHolder.children[0];
  if (gun) { gun.updateMatrix(); _gm.multiplyMatrices(model.gunHolder.matrix, gun.matrix); } else _gm.copy(model.gunHolder.matrix);
  _gq.setFromRotationMatrix(_gm);
  const work = Math.sin(model.t * 7) * 0.025;
  for (const right of [true, false]) {
    const arm = right ? model.armR : model.armL;
    if (!arm.hand) continue;
    // where the hand holds the gun, and how it is turned (arms space)
    const pt = right ? gd.grip : gd.fore;
    if (pt) {
      _hp.copy(pt);
      if (!right && (gd.foreKind === 'under' || gd.foreKind === 'pump')) _hp.y += 0.026;
      _hp.applyMatrix4(_gm);
      _hq.copy(_gq).multiply(right ? _qa.setFromEuler(_eu.set(-(gd.gripTilt || 0), 0, 0)) : leftHoldQuat(gd, _qa));
    } else { _hp.set(right ? 0.1 : -0.2, -0.3, -0.26); _hq.identity(); }      // a free hand (the spoon is held in one)
    // working on the bomb: palms down, hands busy
    if (kw > 0.001) {
      _t.set(right ? 0.1 : -0.1, -0.55 + (right ? work : -work), -0.4);
      _hp.lerp(_t, kw);
      _hq.slerp(right ? Q_USE_R : Q_USE_L, kw);
    }
    // aim the arm at the wrist, then seat the hand on the end of the forearm
    _w.copy(arm.hand.userData.wrist).applyQuaternion(_hq).add(_hp);
    settleArm(model, right ? 'R' : 'L', _w, dt);
    solveArm(arm, _w, model.L1, model.L2, right ? POLE_R : POLE_L);
    arm.sh.updateMatrix(); arm.el.updateMatrix(); arm.seg.updateMatrix();
    _sm.multiplyMatrices(arm.sh.matrix, arm.el.matrix).multiply(arm.seg.matrix);
    // if the gun is a little out of reach, the hand stays on the arm rather than floating
    _end.set(0, -model.L2 / 2, 0).applyMatrix4(_sm);
    _hp.add(_end.sub(_w));
    _hm.compose(_hp, _hq, _one);
    _sm.invert().multiply(_hm).decompose(arm.hand.position, arm.hand.quaternion, _sc);
  }
}
const smooth01 = t => t * t * (3 - 2 * t);
const _gm = new THREE.Matrix4(), _sm = new THREE.Matrix4(), _hm = new THREE.Matrix4(), _gq = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _qa = new THREE.Quaternion();
const _hp = new THREE.Vector3(), _w = new THREE.Vector3(), _end = new THREE.Vector3(), _sc = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _eu = new THREE.Euler();
// hand orientations for the left hand (see anim.js for the first-person versions)
const PALM_UP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, -1), V(-1, 0, 0)));
const Q_UNDER = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.3).multiply(PALM_UP);
const Q_USE_R = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 1, 0), V(-1, 0, 0), V(0, 0, 1)));
const Q_USE_L = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1)));
function leftHoldQuat(gd, out) {
  if (gd.foreKind === 'under' || gd.foreKind === 'pump') return out.copy(Q_UNDER);
  return out.setFromEuler(_eu.set(-(gd.gripTilt || 0), 0, gd.foreKind === 'cup' ? 0.35 : 0));
}
// sudden jumps in where a hand should go glide over a fraction of a second instead of snapping
function settleArm(model, side, target, dt) {
  const k = 'set' + side;
  let s = model[k];
  if (!s) s = model[k] = { prev: target.clone(), off: new THREE.Vector3(), vel: new THREE.Vector3() };
  _hp2.subVectors(target, s.prev);
  if (_hp2.length() > 3 * dt + 0.01) s.off.sub(_hp2);
  s.prev.copy(target);
  const w = 14;
  s.vel.addScaledVector(s.off, -w * w * dt).multiplyScalar(Math.max(0, 1 - 2 * w * dt));
  s.off.addScaledVector(s.vel, dt);
  target.add(s.off);
}
const _hp2 = new THREE.Vector3();

// someone fired: kick the arms back a little
export function modelRecoil(model, strength = 1) { model.kick = Math.min(1.4, model.kick + strength); }
// someone swung the spoon (stab = the slow jab)
export function modelSwing(model, stab) { model.swingT = 0; model.swingStab = !!stab; }

// ---------- the bomb ----------
function bombInHand() {
  const g = new THREE.Group();
  buildBomb(g, 0.55);
  g.position.set(0, -0.03, -0.06);
  g.userData = { kind: 'bomb', grip: V(0.065, -0.03, 0.0), gripTilt: 0, fore: V(-0.065, -0.03, -0.02), foreKind: 'cup', muzzleAt: V(0, 0, -0.1) };
  const mz = new THREE.Object3D(); mz.position.copy(g.userData.muzzleAt); g.add(mz); g.userData.muzzle = mz;
  return g;
}
// explosive charge: wrapped blocks, timer with a screen and keypad, wires
function buildBomb(g, s = 1) {
  const wrap = mat('#5b4a3a', { rough: 0.9 }), tape = mat('#2a2a2a', { rough: 0.6 }), body = mat('#3b3f44', { metal: 0.3, rough: 0.5 });
  for (let i = 0; i < 4; i++) P(g, rbox(0.09 * s, 0.11 * s, 0.26 * s, 0.012 * s), wrap, (-0.135 + i * 0.09) * s, 0.055 * s, 0);
  for (const z of [-0.08, 0.08]) P(g, rbox(0.38 * s, 0.115 * s, 0.03 * s, 0.006 * s), tape, 0, 0.056 * s, z * s);
  P(g, rbox(0.17 * s, 0.035 * s, 0.13 * s, 0.008 * s), body, 0.06 * s, 0.125 * s, 0);
  P(g, rbox(0.08 * s, 0.006 * s, 0.035 * s, 0.002 * s), mat('#1a3a20', { emissive: '#2bd65a', rough: 0.4 }), 0.06 * s, 0.1435 * s, -0.035 * s);   // timer screen
  if (HI()) for (let i = 0; i < 9; i++) P(g, rbox(0.016 * s, 0.006 * s, 0.014 * s, 0.002 * s), mat('#cfcfcf', { rough: 0.5 }), (0.035 + (i % 3) * 0.022) * s, 0.1435 * s, (0.005 + Math.floor(i / 3) * 0.02) * s);
  // wires: loops from the side of the timer down into the blocks
  for (const [col, z, r] of [['#c0392b', -0.035, 0.03], ['#2e86c1', 0.0, 0.04], ['#f1c40f', 0.035, 0.05]]) {
    D(g, new THREE.TorusGeometry(r * s, 0.004 * s, 5, 12, Math.PI), mat(col, { rough: 0.6 }), (-0.024 - r) * s, 0.112 * s, z * s);
  }
  return g;
}
export function makeBombModel() {
  const g = new THREE.Group();
  buildBomb(g, 1);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
  light.position.set(0.12, 0.155, -0.04);
  g.add(light);
  g.userData.light = light;
  return g;
}

// A gun or defuse kit lying on the floor
export function makeDropModel(kind, weapon) {
  const g = new THREE.Group();
  if (kind === 'kit') {
    P(g, rbox(0.3, 0.08, 0.2, 0.02), mat('#2f4f86', { rough: 0.7 }), 0, 0.04, 0);
    P(g, rbox(0.12, 0.03, 0.06, 0.008), mat('#c9b27a', { rough: 0.6 }), 0, 0.095, 0);
    P(g, rbox(0.06, 0.02, 0.14, 0.006), mat('#111', { rough: 0.6 }), 0.09, 0.09, 0);
  } else {
    const gun = gunMesh(weapon);
    if (gun.userData.silencer) gun.userData.silencer.visible = true;
    gun.rotation.z = Math.PI / 2;    // lying on its side
    gun.position.y = 0.04;
    g.add(gun);
  }
  g.traverse(o => { o.castShadow = false; });
  return g;
}
