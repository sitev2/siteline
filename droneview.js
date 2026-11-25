// FPV drones: how the drone maps look (dronemaps.js), the gates, and the drone itself. All drawn in code.
// The game's other maps are drawn by mapview.js as usual (drone.js decides which).
import * as THREE from 'three';
import { makeTexture, labelTexture, radialTexture } from './textures.js';
import { hash2 } from './world.js';
import { fbm } from './dronemaps.js';
import { rotorBlades } from './dronephys.js';

// ---------- textures (canvas, cached) ----------
const texCache = new Map();
function canvasTex(key, size, draw, renderer, repeat = true) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  texCache.set(key, t);
  return t;
}
const R = (i) => hash2(i * 7 + 1, i * 13 + 5);
// a grey speckle for the ground (multiplied by the ground's own colours)
const detailTex = (r) => canvasTex('detail', 256, (g, s) => {
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) { const v = 150 + R(i) * 105 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.globalAlpha = 0.35; g.fillRect(R(i + 1e4) * s, R(i + 2e4) * s, 1 + R(i + 3e4) * 3, 1 + R(i + 4e4) * 3); }
  g.globalAlpha = 1;
}, r);
const facadeTex = (base, win, r, seed) => canvasTex(`facade${base}${win}`, 256, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  // 4 floors × 4 bays per tile (tile = 14 m × 14 m): windows with a few lit
  for (let f = 0; f < 4; f++) for (let b = 0; b < 4; b++) {
    const x = b * 64 + 9, y = f * 64 + 12, k = R(seed * 100 + f * 4 + b);
    g.fillStyle = k < 0.18 ? '#ffe7b0' : win; g.fillRect(x, y, 46, 38);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y, 46, 4);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 22, y, 2, 38);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)'; for (let f = 0; f < 4; f++) g.fillRect(0, f * 64 + 54, s, 3);
}, r);
const corrugated = (base, r) => canvasTex(`corr${base}`, 128, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 8) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(0.5, 'rgba(0,0,0,.22)'); gr.addColorStop(1, 'rgba(255,255,255,.18)'); g.fillStyle = gr; g.fillRect(x, 0, 8, s); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(90,50,30,${R(i) * 0.25})`; g.fillRect(R(i + 5) * s, R(i + 9) * s, 2 + R(i + 3) * 6, 1 + R(i + 7) * 4); }
}, r);
const asphaltTex = (r) => canvasTex('asphalt', 256, (g, s) => {
  g.fillStyle = '#4a4c50'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 12000; i++) { const v = 55 + R(i) * 50 | 0; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(R(i + 7e3) * s, R(i + 9e3) * s, 1.5, 1.5); }
}, r);
const rockTex = (r) => canvasTex('rock', 256, (g, s) => {
  g.fillStyle = '#9a9286'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 260; i++) { const v = 110 + R(i) * 90 | 0; g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.5)`; g.beginPath(); g.ellipse(R(i + 1) * s, R(i + 2) * s, 6 + R(i + 3) * 26, 3 + R(i + 4) * 12, R(i + 5) * 3, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(40,36,30,0.35)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.moveTo(R(i + 50) * s, R(i + 60) * s); g.lineTo(R(i + 70) * s, R(i + 80) * s); g.stroke(); }
}, r);
const padTex = (r) => canvasTex('pad', 128, (g, s) => {
  g.fillStyle = '#2b2e33'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#f0a040'; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
  g.fillStyle = '#f2efe8'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('▲', 64, 66);
}, r, false);
const hangarFloor = (r) => canvasTex('hfloor', 256, (g, s) => {
  g.fillStyle = '#6d6f72'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 6000; i++) { const v = 95 + R(i) * 40 | 0; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(R(i + 3e3) * s, R(i + 5e3) * s, 2, 2); }
  g.strokeStyle = 'rgba(30,30,30,.5)'; g.lineWidth = 2; g.strokeRect(0, 0, s, s);
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(40,36,30,0.18)'; g.beginPath(); g.ellipse(R(i + 90) * s, R(i + 95) * s, 20 + R(i) * 40, 10 + R(i + 1) * 20, R(i + 2) * 3, 0, 7); g.fill(); }
}, r);

// ---------- materials ----------
// key → [colour, texture kind, metres per texture tile]
const MATS = {
  concrete: ['#a8a59d', 'concrete', 4], brick: ['#9a5a44', 'brick', 3], rust: ['#7c4a32', 'metal', 2], steel: ['#7f868d', 'metal', 2],
  pipe: ['#8a6a4a', 'metal', 2], tank: ['#9aa1a3', 'corr', 4], sheet: ['#7d7468', 'corr', 3], parapet: ['#b9b5ad', 'concrete', 3],
  stone: ['#b7ad9c', 'blocks', 3], cont1: ['#b44a2e', 'corr', 3], cont2: ['#2f6e9a', 'corr', 3], cont3: ['#3d7a46', 'corr', 3], cont4: ['#c8962c', 'corr', 3],
  facade1: ['#cfc7b8', 'facade', 14, '#2a3a4a'], facade2: ['#7d8c99', 'facade', 14, '#1b2836'], facade3: ['#a8775c', 'facade', 14, '#2b2b30'], facade4: ['#e2ddd2', 'facade', 14, '#35506a'],
  glass: ['#5d8db0', 'facade', 10, '#183048'], unit: ['#b0b3b2', 'metal', 2], crane: ['#e0b028', 'metal', 2], cab: ['#d8d2c4', 'metal', 2],
  train: ['#c8ccd0', 'metal', 3], barn: ['#8e3b2c', 'crate', 3], plaster: ['#e8dcc4', 'plaster', 3], tiles: ['#a5513a', 'crate', 2], tin: ['#8a8f94', 'corr', 3],
  silo: ['#c9cdd0', 'corr', 4], white: ['#eef0f2', 'plaster', 6], rock: ['#9a8c7a', 'rock', 6], wood: ['#7a5a3c', 'crate', 2], hay: ['#d8b860', 'sand', 2],
  plane: ['#dfe3e6', 'plaster', 6], engine: ['#6e757c', 'metal', 2], rack: ['#3c6ea0', 'metal', 2], grate: ['#5d6166', 'metal', 1], gate: ['#ffffff', null, 1],
  tent: ['#ffffff', null, 1], bark: ['#5a4030', null, 1], leaf: ['#3a6a2a', null, 1], sidewalk: ['#a9a69e', 'concrete', 3],
};
function makeMat(key, renderer, lowTex) {
  const [col, kind, , win] = MATS[key] || MATS.concrete;
  if (!kind || lowTex) return new THREE.MeshLambertMaterial({ color: col });
  let map;
  if (kind === 'facade') map = facadeTex(col, win, renderer, key.length);
  else if (kind === 'corr') map = corrugated(col, renderer);
  else if (kind === 'rock') map = rockTex(renderer);
  else map = makeTexture(kind, col, renderer, key.length);
  const m = new THREE.MeshLambertMaterial({ map, color: kind === 'rock' ? col : '#ffffff' });
  if (kind === 'rock') m.color.multiplyScalar(1.4);
  return m;
}

// ---------- merging shapes into one mesh per material ----------
class Merger {
  constructor() { this.parts = new Map(); }
  add(key, geo) { if (!this.parts.has(key)) this.parts.set(key, []); this.parts.get(key).push(geo.index ? geo.toNonIndexed() : geo); }
  build(fn) {
    for (const [key, list] of this.parts) {
      let n = 0;
      for (const g of list) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let o = 0;
      for (const g of list) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
        o += g.attributes.position.count;
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      fn(key, geo);
    }
  }
}
// a box with its texture in metres on every face (tile = metres per texture repeat)
function boxGeo(s, tile) {
  const g = new THREE.BoxGeometry(s.sx, s.sy, s.sz);
  const uv = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const x = p.getX(i) + s.sx / 2, y = p.getY(i) + s.y, z = p.getZ(i) + s.sz / 2;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, x / tile, z / tile); else if (ax > 0.5) uv.setXY(i, z / tile, y / tile); else uv.setXY(i, x / tile, y / tile);
  }
  g.rotateY(s.ry || 0);
  g.translate(s.x, s.y, s.z);
  return g;
}
function scaleUV(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
const UP = new THREE.Vector3(0, 1, 0);
function capsuleGeo(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.01, L), seg, 1, false);
  scaleUV(g, Math.max(1, Math.round(2 * Math.PI * r)), Math.max(1, L / 2));
  const q = new THREE.Quaternion().setFromUnitVectors(UP, B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

// ---------- the ground ----------
const C = (h) => new THREE.Color(h);
const GROUND = {
  yard: (x, z, h, sl) => { const k = fbm(x / 18, z / 18, 3, 3); return k > 0.55 ? C('#7d7c6a').lerp(C('#6d7448'), (k - 0.55) * 2.2) : C('#9a978f').lerp(C('#85827a'), k); },
  grass: (x, z, h, sl, m) => {
    let c = C('#5f8a3a').lerp(C('#7a9a44'), fbm(x / 30, z / 30, 3, 11));
    if (m.riverX && Math.abs(x - m.riverX(z)) < 15) c.lerp(C('#8a7a5a'), 0.6);
    if (m.deco && m.deco.some(d => d.kind === 'field' && x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1)) c = C(Math.floor(z / 3) % 2 ? '#8a7040' : '#7a6236');
    if (sl > 0.7) c.lerp(C('#8a8580'), Math.min(1, (sl - 0.7) * 2.2));
    if (h > 62) c.lerp(C('#f2f4f6'), Math.min(1, (h - 62) / 10));
    if (h < 1.2) c.lerp(C('#8c7c5e'), 0.5);
    return c;
  },
  desert: (x, z, h, sl) => {
    // rock bands in the walls, pale sand on the floor
    const band = Math.sin(h * 0.9 + fbm(x / 60, z / 60, 2, 2) * 3) * 0.5 + 0.5;
    const rock = C('#b0603c').lerp(C('#d49660'), band).lerp(C('#8a4a30'), Math.max(0, Math.sin(h * 0.33)) * 0.35);
    const sand = C('#e0c08c').lerp(C('#d0a874'), fbm(x / 20, z / 20, 2, 5));
    return sand.lerp(rock, Math.min(1, Math.max(0, (h - 1.5) / 3) + Math.max(0, sl - 0.5)));
  },
};

// ---------- the scene ----------
// md: loadDroneMap(); G: graphics settings. Returns { group, fog, far, sun, gateViews, update(dt, t, camPos) }
export function buildDroneScene(md, renderer, G) {
  const m = md.map, L = m.look, group = new THREE.Group();
  const shadows = !!G.shadows && G.shadows !== 'off';
  const lowTex = G.textures === 'low';
  const far = Math.max(180, L.fogFar * ((G.viewDistance || 200) / 200));
  const fog = new THREE.Fog(L.fog, far * 0.25, far);
  const mats = new Map();
  const mat = (k) => { if (!mats.has(k)) mats.set(k, makeMat(k, renderer, lowTex)); return mats.get(k); };

  // sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: C(L.sky[0]) }, hor: { value: C(L.sky[1]) }, sun: { value: new THREE.Vector3(...L.sunDir).normalize() }, sunCol: { value: C(L.sun) }, indoor: { value: L.indoor ? 1 : 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hor, sun, sunCol; uniform float indoor; varying vec3 vD;
      void main(){ float h = clamp(vD.y, -0.2, 1.0); vec3 c = mix(hor, top, pow(max(h, 0.0), 0.55));
        float s = max(dot(normalize(vD), sun), 0.0); c += sunCol * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25) * (1.0 - indoor);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // light
  const hemi = new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  const sd = new THREE.Vector3(...L.sunDir).normalize();
  sun.userData.dir = sd;
  sun.position.copy(sd).multiplyScalar(120);
  if (shadows) {
    sun.castShadow = true;
    const sz = G.shadows === 'low' ? 1024 : G.shadows === 'medium' ? 2048 : 4096;
    sun.shadow.mapSize.set(sz, sz);
    const e = 70;
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 400 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  }
  group.add(sun, sun.target);

  // the ground
  const W = m.size[0], D = m.size[1];
  const detail = lowTex ? null : detailTex(renderer);
  if (m.ground) {
    const gr = m.ground, nx = gr.nx, nz = gr.nz;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    const H = (i, k) => gr.h[Math.min(nz - 1, Math.max(0, k)) * nx + Math.min(nx - 1, Math.max(0, i))];
    const fnC = GROUND[m.groundMat] || GROUND.grass;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const j = k * nx + i, x = i * gr.res, z = k * gr.res, h = gr.h[j];
      pos[j * 3] = x; pos[j * 3 + 1] = h; pos[j * 3 + 2] = z;
      uv[j * 2] = x / 6; uv[j * 2 + 1] = z / 6;
      const sl = Math.hypot(H(i + 1, k) - H(i - 1, k), H(i, k + 1) - H(i, k - 1)) / (2 * gr.res);
      const c = fnC(x, z, h, sl, m);
      col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b;
    }
    const idx = [];
    for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) { const a = k * nx + i; idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const g = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }));
    g.receiveShadow = shadows;
    group.add(g);
  } else if (m.groundMat === 'city') {
    const t = asphaltTex(renderer).clone(); t.needsUpdate = true; t.repeat.set(W / 8, D / 8);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, D * 3), new THREE.MeshLambertMaterial({ map: lowTex ? null : t, color: lowTex ? '#55575b' : '#ffffff' }));
    t.repeat.set(W * 3 / 8, D * 3 / 8);
    g.rotation.x = -Math.PI / 2; g.position.set(W / 2, 0, D / 2); g.receiveShadow = shadows;
    group.add(g);
    // pavements round every block, grass in the park, lines down the streets
    const S = m.streets, mg = new Merger();
    for (let i = 0; i < S.n; i++) for (let k = 0; k < S.n; k++) {
      const x0 = S.st + i * (S.blk + S.st), z0 = S.st + k * (S.blk + S.st);
      mg.add(i === 2 && k === 2 ? 'park' : 'sidewalk', boxGeo({ x: x0 + S.blk / 2, y: 0.08, z: z0 + S.blk / 2, sx: S.blk, sy: 0.16, sz: S.blk }, 3));
    }
    for (let i = 0; i <= S.n; i++) {
      const c = i * (S.blk + S.st) + S.st / 2;
      for (let a = 4; a < W; a += 9) { mg.add('line', boxGeo({ x: c, y: 0.01, z: a, sx: 0.25, sy: 0.02, sz: 4.5 }, 4)); mg.add('line', boxGeo({ x: a, y: 0.01, z: c, sx: 4.5, sy: 0.02, sz: 0.25 }, 4)); }
    }
    mg.build((key, geo) => {
      const mm = key === 'park' ? new THREE.MeshLambertMaterial({ color: '#5f8a3a', map: detail }) : key === 'line' ? new THREE.MeshLambertMaterial({ color: '#e8e4d8' }) : mat('sidewalk');
      const mesh = new THREE.Mesh(geo, mm); mesh.receiveShadow = shadows; group.add(mesh);
    });
  } else {
    // the hangar: a concrete floor, walls and a curved roof
    const t = hangarFloor(renderer).clone(); t.needsUpdate = true; t.repeat.set(W / 6, D / 6);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: lowTex ? null : t, color: lowTex ? '#6d6f72' : '#ffffff' }));
    g.rotation.x = -Math.PI / 2; g.position.set(W / 2, 0, D / 2); g.receiveShadow = shadows;
    group.add(g);
  }
  if (m.indoor) addHangarShell(group, m, mat, renderer, shadows, lowTex);

  // water
  for (const w of m.waters || []) {
    const geo = new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0);
    const wm = new THREE.MeshPhongMaterial({ color: '#2d6f86', specular: '#d8f0ff', shininess: 90, transparent: true, opacity: 0.86, depthWrite: true });
    const mesh = new THREE.Mesh(geo, wm);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set((w.x0 + w.x1) / 2, w.y, (w.z0 + w.z1) / 2);
    mesh.receiveShadow = shadows;
    group.add(mesh);
  }

  // the solids
  const mg = new Merger();
  for (const s of m.solids) {
    if (s.novis || s.mat === 'gate') continue;
    const tile = (MATS[s.mat] || MATS.concrete)[2] || 3;
    if (s.t === 'box') mg.add(s.mat, boxGeo(s, tile));
    else if (s.t === 'cyl') { const g = new THREE.CylinderGeometry(s.r, s.r, s.y1 - s.y0, Math.max(10, Math.min(28, Math.round(s.r * 6))), 1); scaleUV(g, Math.max(1, Math.round(2 * Math.PI * s.r / tile)), (s.y1 - s.y0) / tile); g.translate(s.x, (s.y0 + s.y1) / 2, s.z); mg.add(s.mat, g); }
    else if (s.t === 'cone') { const g = new THREE.ConeGeometry(s.r, s.y1 - s.y0, 18, 1); scaleUV(g, Math.max(1, Math.round(2 * Math.PI * s.r / tile)), 1); g.translate(s.x, (s.y0 + s.y1) / 2, s.z); mg.add(s.mat, g); }
    else if (s.t === 'sph') {
      const g = s.mat === 'rock' ? lumpy(s.r, s.x * 3 + s.z) : new THREE.SphereGeometry(s.r, 16, 10);
      scaleUV(g, Math.max(1, s.r * 2 / tile), Math.max(1, s.r / tile)); g.translate(s.x, s.y, s.z); mg.add(s.mat, g);
    } else if (s.t === 'cap') mg.add(s.mat, capsuleGeo(s.a, s.b, s.r));
  }
  mg.build((key, geo) => {
    const mesh = new THREE.Mesh(geo, mat(key));
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    group.add(mesh);
  });

  // trees
  if (m.trees.length) addTrees(group, m.trees, shadows);
  // things drawn only
  const anim = [];
  addDeco(group, m, mat, renderer, shadows, anim);
  // wind turbines' rotors
  const rotors = [];
  for (const ro of m.rotors || []) {
    const r = new THREE.Group();
    const hubM = mat('white');
    const hub = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), hubM); r.add(hub);
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(ro.len, 1.6, 0.35), hubM);
      b.geometry.translate(ro.len / 2, 0, 0);
      b.rotation.z = k * Math.PI * 2 / 3;
      b.castShadow = shadows;
      r.add(b);
    }
    const fx = -Math.sin(ro.yaw), fz = -Math.cos(ro.yaw);
    r.position.set(ro.x + fx * (ro.hub || 0.6), ro.y, ro.z + fz * (ro.hub || 0.6));
    r.rotation.order = 'YXZ'; r.rotation.y = ro.yaw;
    group.add(r);
    rotors.push({ r, ro });
  }

  // gates
  const gateViews = addGates(group, md.gates, shadows);

  const update = (dt, t) => {
    for (const { r, ro } of rotors) r.rotation.z = t * ro.speed;
    for (const a of anim) a(dt, t);
  };
  void rotorBlades;
  return { group, fog, far, sun, sky, gateViews, update, indoor: !!L.indoor };
}

// a rock: a sphere pushed in and out
function lumpy(r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.82 + 0.3 * hash2(Math.round(x * 3 + seed), Math.round(y * 3 + z * 5));
    p.setXYZ(i, x * k, y * k * 0.9, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function addTrees(group, trees, shadows) {
  const trunkG = new THREE.CylinderGeometry(0.14, 0.22, 1, 6); trunkG.translate(0, 0.5, 0);
  const pineG = new THREE.ConeGeometry(1, 1, 8); pineG.translate(0, 0.5, 0);
  const leafG = new THREE.IcosahedronGeometry(1, 1);
  const lp = leafG.attributes.position;
  for (let i = 0; i < lp.count; i++) { const k = 0.85 + 0.3 * hash2(Math.round(lp.getX(i) * 9), Math.round(lp.getY(i) * 9 + lp.getZ(i) * 5)); lp.setXYZ(i, lp.getX(i) * k, lp.getY(i) * k, lp.getZ(i) * k); }
  leafG.computeVertexNormals();
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: '#5a4030' }), trees.length);
  const pines = trees.filter(t => t.kind === 'pine'), leaves = trees.filter(t => t.kind === 'leaf');
  const pineM = new THREE.InstancedMesh(pineG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, pines.length * 2));
  const leafM = new THREE.InstancedMesh(leafG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, leaves.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  trees.forEach((t, i) => {
    const th = t.kind === 'dead' ? t.h * 0.9 : t.kind === 'pine' ? t.h * 0.35 : t.h * 0.5;
    m4.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.h / 9, th + 0.2, t.h / 9));
    trunks.setMatrixAt(i, m4);
  });
  let pi = 0;
  for (const t of pines) {
    c.setHSL(0.3 + t.tint * 0.06, 0.45, 0.2 + t.tint * 0.08);
    m4.compose(new THREE.Vector3(t.x, t.y + t.h * 0.2, t.z), q, new THREE.Vector3(t.r, t.h * 0.55, t.r)); pineM.setMatrixAt(pi, m4); pineM.setColorAt(pi++, c);
    m4.compose(new THREE.Vector3(t.x, t.y + t.h * 0.5, t.z), q, new THREE.Vector3(t.r * 0.7, t.h * 0.5, t.r * 0.7)); pineM.setMatrixAt(pi, m4); pineM.setColorAt(pi++, c);
  }
  leaves.forEach((t, i) => {
    c.setHSL(0.22 + t.tint * 0.1, 0.45, 0.28 + t.tint * 0.1);
    m4.compose(new THREE.Vector3(t.x, t.y + t.h * 0.62, t.z), q.setFromAxisAngle(UP, t.tint * 6), new THREE.Vector3(t.r, t.r * 0.85, t.r)); leafM.setMatrixAt(i, m4); leafM.setColorAt(i, c);
  });
  pineM.count = Math.max(0, pi); leafM.count = leaves.length;
  for (const im of [trunks, pineM, leafM]) { im.castShadow = shadows; im.receiveShadow = shadows; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; group.add(im); }
}

function addHangarShell(group, m, mat, renderer, shadows, lowTex) {
  const { W, D, H } = m.indoor;
  const wallT = lowTex ? null : corrugated('#7f8790', renderer).clone();
  if (wallT) { wallT.needsUpdate = true; wallT.repeat.set(W / 3, H / 3); }
  const wm = new THREE.MeshLambertMaterial({ color: lowTex ? '#7f8790' : '#ffffff', map: wallT, side: THREE.DoubleSide });
  for (const [x, z, w, ry] of [[W / 2, 0, W, 0], [W / 2, D, W, Math.PI], [0, D / 2, D, Math.PI / 2], [W, D / 2, D, -Math.PI / 2]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, H + 8), wm);
    p.position.set(x, (H + 8) / 2, z); p.rotation.y = ry; p.receiveShadow = shadows;
    group.add(p);
  }
  // the roof: a shallow arch, and steel arches holding it up
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(D * 0.9, D * 0.9, W, 32, 1, true, -Math.asin(0.5 / 0.9), 2 * Math.asin(0.5 / 0.9)), new THREE.MeshLambertMaterial({ color: '#3a3f46', side: THREE.DoubleSide }));
  roof.rotation.z = Math.PI / 2; roof.position.set(W / 2, H + 2 - D * 0.9 * Math.cos(Math.asin(0.5 / 0.9)) + 6, D / 2);
  group.add(roof);
  for (let x = 6; x < W; x += 12) {
    const a = new THREE.Mesh(new THREE.TorusGeometry(D * 0.9, 0.35, 6, 40, 2 * Math.asin(0.5 / 0.9)), mat('steel'));
    a.rotation.y = Math.PI / 2; a.rotation.z = Math.PI / 2 - Math.asin(0.5 / 0.9);
    a.position.set(x, roof.position.y, D / 2);
    group.add(a);
  }
  // big doors at the east end (shut), painted floor markings
  const dm = new THREE.Mesh(new THREE.PlaneGeometry(D - 8, H - 4), new THREE.MeshLambertMaterial({ color: '#566070', map: lowTex ? null : corrugated('#566070', renderer) }));
  dm.position.set(W - 0.05, (H - 4) / 2, D / 2); dm.rotation.y = -Math.PI / 2; group.add(dm);
  const line = new THREE.MeshLambertMaterial({ color: '#d8b030' });
  for (const [x, z, w, d] of [[W / 2, 8, W - 10, 0.25], [W / 2, D - 8, W - 10, 0.25], [40, D / 2, 0.25, D - 20]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), line); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.02, z); group.add(p); }
}

// ---------- gates ----------
export const GATE_COLORS = { next: '#ffb43a', later: '#9fd8ff', done: '#5ae07a', start: '#ffffff' };
function addGates(group, gates, shadows) {
  const views = [];
  const legM = new THREE.MeshLambertMaterial({ color: '#4a4e54' });
  for (const g of gates) {
    const pts = [];
    const P = (a, b) => new THREE.Vector3(g.c[0] + g.u[0] * a + g.v[0] * b, g.c[1] + g.u[1] * a + g.v[1] * b, g.c[2] + g.u[2] * a + g.v[2] * b);
    const T = g.kind === 'led' ? 0.11 : 0.14;
    if (g.rad) for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push(P(Math.cos(a) * (g.rad + T), Math.sin(a) * (g.rad + T))); }
    else if (g.arch) for (let k = 0; k <= 24; k++) { const a = Math.PI - (k / 24) * Math.PI; pts.push(P(Math.cos(a) * (g.hw + T), -g.hh + Math.sin(a) * (2 * g.hh + T))); }
    else { const hw = g.hw + T, hh = g.hh + T; for (const [a, b] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]]) pts.push(P(a, b)); }
    const path = new THREE.CurvePath();
    for (let k = 0; k < pts.length - 1; k++) path.add(new THREE.LineCurve3(pts[k], pts[k + 1]));
    const segs = g.rad || g.arch ? pts.length * 2 : 4 * 6;
    const tubeR = g.arch ? T * 1.7 : T;
    const geo = new THREE.TubeGeometry(path, segs, tubeR, 8, !g.arch);
    // the frame: a dark core with a glowing outer layer (the LEDs / the bright fabric)
    const glow = new THREE.MeshBasicMaterial({ color: GATE_COLORS.later, fog: true });
    const mesh = new THREE.Mesh(geo, glow);
    const vg = new THREE.Group();
    vg.add(mesh);
    // a soft halo (additive) so the next gate can be found from far away
    const halo = new THREE.Mesh(new THREE.TubeGeometry(path, segs, tubeR * (g.arch ? 2.2 : 3.2), 6, !g.arch), new THREE.MeshBasicMaterial({ color: GATE_COLORS.next, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.visible = false;
    vg.add(halo);
    for (const [x, y0, z, y1] of g.legs || []) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, y1 - y0, 6), legM);
      l.position.set(x, (y0 + y1) / 2, z); l.castShadow = shadows; vg.add(l);
    }
    // the start / finish line: a chequered banner over it
    if (g.color === 'start') {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const x = c.getContext('2d');
      for (let i = 0; i < 16; i++) for (let k = 0; k < 4; k++) { x.fillStyle = (i + k) % 2 ? '#111' : '#f4f4f4'; x.fillRect(i * 16, k * 16, 16, 16); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(g.hw * 2 + 0.6, 0.7), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
      const top = g.arch ? P(0, g.hh + 0.6) : P(0, g.hh + 0.55);
      b.position.copy(top); b.rotation.y = g.yaw;
      vg.add(b);
    }
    group.add(vg);
    views.push({ g, mesh, halo, glow, state: '' });
  }
  return views;
}
// colour the gates: done (passed this lap), next, the one after (a hint), the rest
export function paintGates(views, next, t) {
  views.forEach((v, i) => {
    const st = next < 0 ? 'later' : i === next ? 'next' : (next === 0 ? false : i < next) ? 'done' : 'later';
    if (st !== v.state) { v.state = st; v.glow.color.set(GATE_COLORS[st]); v.halo.visible = st === 'next'; }
    if (st === 'next') { const k = 0.6 + 0.4 * Math.sin(t * 6); v.halo.material.opacity = 0.12 + 0.16 * k; }
  });
}

// ---------- drawn-only extras ----------
function addDeco(group, m, mat, renderer, shadows, anim) {
  const mg = new Merger();
  const basic = (c) => new THREE.MeshLambertMaterial({ color: c });
  for (const d of m.deco) {
    if (d.kind === 'pad') {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.1, 24), [new THREE.MeshLambertMaterial({ color: '#2b2e33' }), new THREE.MeshLambertMaterial({ map: padTex(renderer) }), basic('#2b2e33')]);
      p.position.set(d.x, d.y + 0.05, d.z); p.rotation.y = d.yaw; p.receiveShadow = shadows;
      group.add(p);
    } else if (d.kind === 'sheet') {
      const len = Math.hypot(d.z1 - d.z0, d.y1 - d.y0);
      const g = new THREE.PlaneGeometry(d.x1 - d.x0, len);
      scaleUV(g, (d.x1 - d.x0) / 3, len / 3);
      g.rotateX(-Math.PI / 2 + Math.atan2(d.y1 - d.y0, d.z1 - d.z0) * -1);
      g.translate((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2 + 0.05, (d.z0 + d.z1) / 2);
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: corrugated('#7d7468', renderer), side: THREE.DoubleSide }));
      mesh.castShadow = shadows; mesh.receiveShadow = shadows; group.add(mesh);
    } else if (d.kind === 'rail') mg.add('steel', capsuleGeo(d.a, d.b, 0.04, 5));
    else if (d.kind === 'wires') {
      for (let k = 0; k < d.pts.length - 1; k++) {
        const a = d.pts[k], b = d.pts[k + 1], pts = [];
        for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 4, a[2] + (b[2] - a[2]) * t)); }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#2a2a2a' })));
      }
    } else if (d.kind === 'roof') {
      // a prism: two sloping sides and two gable ends
      const hx = d.sx / 2, hz = d.sz / 2, h = d.h;
      const v = [[-hx, 0, -hz], [hx, 0, -hz], [0, h, -hz], [-hx, 0, hz], [hx, 0, hz], [0, h, hz]];
      const tri = [[0, 2, 1], [3, 4, 5], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 4]];
      const pos = [];
      for (const t of tri) for (const i of t) pos.push(...v[i]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const uvs = []; for (let i = 0; i < pos.length / 3; i++) uvs.push(pos[i * 3 + 2] / 2, (pos[i * 3] + pos[i * 3 + 1]) / 2);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      g.rotateY(d.ry); g.translate(d.x, d.y, d.z);
      mg.add(d.mat, g);
    } else if (d.kind === 'fall') {
      const c = document.createElement('canvas'); c.width = 64; c.height = 256;
      const x = c.getContext('2d');
      for (let i = 0; i < 64; i++) { x.fillStyle = `rgba(${220 + Math.random() * 35 | 0},${235 + Math.random() * 20 | 0},255,${0.35 + Math.random() * 0.5})`; x.fillRect(i, 0, 1, 256); }
      for (let i = 0; i < 300; i++) { x.fillStyle = 'rgba(255,255,255,0.7)'; x.fillRect(Math.random() * 64, Math.random() * 256, 1, 6 + Math.random() * 20); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.y1 - d.y0 + 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      g.position.set(d.x, (d.y0 + d.y1) / 2, d.z + 1.2);
      group.add(g);
      anim.push((dt) => { t.offset.y += dt * 1.6; });
      const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,0.6)', 'rgba(255,255,255,0)'), depthWrite: false, transparent: true }));
      mist.scale.set(d.w * 1.4, 8, 1); mist.position.set(d.x, d.y0 + 2, d.z + 4); group.add(mist);
    } else if (d.kind === 'pond') {
      const p = new THREE.Mesh(new THREE.CircleGeometry(d.r, 24), new THREE.MeshPhongMaterial({ color: '#3d7d92', shininess: 80 }));
      p.rotation.x = -Math.PI / 2; p.position.set(d.x, 0.82, d.z); group.add(p);
    } else if (d.kind === 'cars') {
      const n = d.floors * 10, im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.3, 4.2), new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      let i = 0;
      for (let f = 0; f < d.floors; f++) for (let k = 0; k < 10; k++) {
        if (hash2(f * 11 + k, 5) < 0.3) continue;
        const x = d.x - d.w / 2 + 3 + k * (d.w - 6) / 9, z = d.z + (k % 2 ? -1 : 1) * (d.d / 2 - 3.5);
        m4.compose(new THREE.Vector3(x, f * 3.6 + 3.6 + 0.65, z), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m4);
        c.setHSL(hash2(f, k * 3), 0.5, 0.45); im.setColorAt(i++, c);
      }
      im.count = i; im.castShadow = shadows; group.add(im);
    } else if (d.kind === 'train') {
      for (let k = 0; k < 2; k++) mg.add('train', boxGeo({ x: d.x - 10 + k * 20.5, y: d.y + 1.7, z: d.z, sx: 20, sy: 3.4, sz: 3 }, 3));
    } else if (d.kind === 'lamp') {
      mg.add('steel', boxGeo({ x: d.x + 0.6, y: d.y, z: d.z, sx: 1.4, sy: 0.18, sz: 0.4 }, 2));
    } else if (d.kind === 'hook') {
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(d.x, d.y0, d.z), new THREE.Vector3(d.x, d.y1, d.z)]), new THREE.LineBasicMaterial({ color: '#222' })));
    } else if (d.kind === 'flag') {
      mg.add('steel', capsuleGeo([d.x, d.y, d.z], [d.x, d.y + 4.2, d.z], 0.05, 5));
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), new THREE.MeshLambertMaterial({ color: d.c < 0.5 ? '#e8463a' : '#2f8ae0', side: THREE.DoubleSide }));
      f.position.set(d.x + 0.7, d.y + 2.9, d.z); group.add(f);
      anim.push((dt, t) => { f.rotation.y = Math.sin(t * 2 + d.x) * 0.3; });
    } else if (d.kind === 'tent') {
      const c = d.c < 0.33 ? '#e8463a' : d.c < 0.66 ? '#f0f0f0' : '#2f8ae0';
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.6, 4), basic(c)); roof.rotation.y = Math.PI / 4; roof.position.set(d.x, d.y + 3.3, d.z); roof.scale.set(1, 1, 0.75); roof.castShadow = shadows; group.add(roof);
      for (const [a, b] of [[-3.3, -2.3], [3.3, -2.3], [3.3, 2.3], [-3.3, 2.3]]) mg.add('steel', capsuleGeo([d.x + a, d.y, d.z + b], [d.x + a, d.y + 2.5, d.z + b], 0.05, 5));
      mg.add('tentTable', boxGeo({ x: d.x, y: d.y + 0.38, z: d.z, sx: 4, sy: 0.76, sz: 1.2 }, 2));
    } else if (d.kind === 'banner') {
      mg.add('steel', capsuleGeo([d.x, d.y, d.z], [d.x, d.y + 2.2, d.z], 0.04, 5));
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshLambertMaterial({ color: d.z % 16 < 8 ? '#f0a040' : '#2f8ae0', side: THREE.DoubleSide }));
      b.position.set(d.x, d.y + 1.7, d.z); b.rotation.y = d.ry; group.add(b);
    } else if (d.kind === 'prop') {
      const p = new THREE.Group();
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.35), basic('#2a2a2a')); b.geometry.translate(0, 0.8, 0); b.rotation.x = k * Math.PI * 2 / 3; p.add(b); }
      p.position.set(d.x, d.y, d.z); group.add(p);
    } else if (d.kind === 'boxes') {
      for (let lv = 0; lv < 3; lv++) for (let i = 0; i < 6; i++) {
        if (hash2(i + lv * 7, d.x) < 0.25) continue;
        const w = 1.2 + hash2(i, lv) * 1.2;
        mg.add('crate', boxGeo({ x: d.x - d.w / 2 + 1.5 + i * (d.w - 3) / 5, y: lv * 2.7 + 0.45 + 0.6, z: d.z, sx: w, sy: 1.2 + hash2(lv, i) * 0.6, sz: d.d - 0.4 }, 1.5));
      }
      for (let lv = 1; lv < 4; lv++) mg.add('steel', boxGeo({ x: d.x, y: lv * 2.7 - 0.1 + 0.05, z: d.z, sx: d.w, sy: 0.1, sz: d.d }, 2));
    } else if (d.kind === 'hlamp') {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 0.5, 14), new THREE.MeshBasicMaterial({ color: '#fff6dc' }));
      l.position.set(d.x, d.y, d.z); group.add(l);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,246,220,0.45)', 'rgba(255,246,220,0)'), depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
      s.scale.set(9, 9, 1); s.position.set(d.x, d.y - 0.6, d.z); group.add(s);
    }
  }
  mg.build((key, geo) => {
    const mm = key === 'crate' ? new THREE.MeshLambertMaterial({ map: makeTexture('crate', '#9c7a50', renderer, 4) }) : key === 'tentTable' ? basic('#d8d2c4') : mat(key);
    const mesh = new THREE.Mesh(geo, mm);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    group.add(mesh);
  });
}

// ---------- the drone ----------
export const DRONE_COLORS = ['#ff9a2e', '#36a6ff', '#4fe07a', '#ff4fa0', '#ffe04a', '#b07cff', '#4ff0e0', '#ff5a4a'];
// a 5-inch racing quad (our own design): carbon X frame, four motors and props, a camera up front, a battery on top,
// coloured LEDs under the arms. The real thing is small (0.25 m): `scale` makes others easier to see far away.
export function makeDroneModel(color = '#ff9a2e', name = '') {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const carbon = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.55, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: '#7b8088', roughness: 0.35, metalness: 0.8 });
  const bat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  const led = new THREE.MeshBasicMaterial({ color });
  const add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; body.add(o); return o; };
  add(new THREE.BoxGeometry(0.05, 0.006, 0.13), carbon, 0, 0, 0);
  add(new THREE.BoxGeometry(0.045, 0.004, 0.11), carbon, 0, 0.028, 0);
  for (const [x, z] of [[-0.018, -0.05], [0.018, -0.05], [-0.018, 0.05], [0.018, 0.05]]) add(new THREE.CylinderGeometry(0.003, 0.003, 0.028, 5), metal, x, 0.014, z);
  add(new THREE.BoxGeometry(0.034, 0.018, 0.04), new THREE.MeshStandardMaterial({ color: '#2d4a2a', roughness: 0.7 }), 0, 0.012, 0.005);     // the flight controller stack
  add(new THREE.BoxGeometry(0.036, 0.03, 0.075), bat, 0, 0.046, 0.005);
  add(new THREE.BoxGeometry(0.04, 0.004, 0.012), new THREE.MeshStandardMaterial({ color: '#c02020' }), 0, 0.062, 0.005);     // battery strap
  const cam = add(new THREE.BoxGeometry(0.022, 0.022, 0.02), carbon, 0, 0.016, -0.058);
  cam.rotation.x = 0.35;
  add(new THREE.CylinderGeometry(0.007, 0.008, 0.01, 10), new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.1, metalness: 0.6 }), 0, 0.02, -0.07).rotation.x = Math.PI / 2 + 0.35;
  for (const s of [-1, 1]) { const a = add(new THREE.CylinderGeometry(0.0015, 0.0015, 0.06, 4), carbon, s * 0.012, 0.035, 0.07); a.rotation.x = -0.9; a.rotation.z = s * 0.4; }
  const props = [], discs = [];
  const discM = new THREE.MeshBasicMaterial({ color: '#bcc4cc', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
  const bladeM = new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, opacity: 0.95 });
  for (const [x, z] of [[-0.078, -0.078], [0.078, -0.078], [-0.078, 0.078], [0.078, 0.078]]) {
    const arm = add(new THREE.BoxGeometry(0.016, 0.005, Math.hypot(x, z) * 2 - 0.02), carbon, x / 2, 0, z / 2);
    arm.rotation.y = Math.atan2(x, z);
    add(new THREE.CylinderGeometry(0.014, 0.013, 0.018, 12), metal, x, 0.011, z);
    add(new THREE.BoxGeometry(0.006, 0.004, 0.03), led, x * 0.65, -0.004, z * 0.65).rotation.y = Math.atan2(x, z);
    const p = new THREE.Group(); p.position.set(x, 0.024, z);
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.002, 0.012), bladeM); b.geometry.translate(0.03, 0, 0); b.rotation.y = k * Math.PI * 2 / 3; p.add(b); }
    body.add(p); props.push(p);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.064, 20), discM); disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.025, z); body.add(disc); discs.push(disc);
  }
  body.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // seen from far away: a soft dot of its colour, and the pilot's name
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(0.7, 0.7, 1);
  root.add(glow);
  let label = null;
  if (name) {
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, color), depthTest: false, transparent: true }));
    label.scale.set(1.6, 0.4, 1); label.position.y = 0.55; label.renderOrder = 5;
    root.add(label);
  }
  return {
    root, body, glow, label,
    // f: throttle (0…1), spin: the props' angle; dist: how far the camera is (bigger dot and label far away)
    animate(f, spin, dist = 5) {
      const fast = f > 0.03;
      props.forEach((p, i) => { p.rotation.y = (i % 2 ? spin : -spin); p.visible = !fast || f < 0.06; });
      discM.opacity = fast ? 0.18 + f * 0.25 : 0;
      for (const d of discs) d.visible = fast;
      const k = Math.min(4, Math.max(0.5, dist / 10));
      glow.scale.set(0.35 * k, 0.35 * k, 1);
      glow.material.opacity = Math.min(1, Math.max(0.25, (dist - 2) / 8));
      if (label) { label.visible = dist < 140; const s = Math.min(3, Math.max(0.6, dist / 14)); label.scale.set(1.6 * s, 0.4 * s, 1); label.position.y = 0.2 + 0.25 * s; }
    },
  };
}
