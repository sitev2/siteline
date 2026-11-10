// Village houses (maps with `village` in maps.js): roofs, facades and landmark details drawn on top
// of the plain house blocks in world.houses (see World.fillHouses). Visual only — collision, bullets
// and bots use the blocks. Called from mapdeco.js with its instancers (box, cyl, glow, half…).
import * as THREE from 'three';
import { CELL, hash2 } from './world.js';
import { makeTexture } from './textures.js';

const col = (hex, l = 0) => { const c = new THREE.Color(hex); if (l) c.offsetHSL(0, 0, l); return c; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// triangles with normals, uvs and colours, built into one mesh per material
class Soup {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
  // `out` = roughly which way the face should look (the winding is fixed to match)
  tri(a, b, c, ua, ub, uc, cc, out) {
    const n = V(...b).sub(V(...a)).cross(V(...c).sub(V(...a))).normalize();
    if (out && n.dot(out) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; n.negate(); }
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]]) { this.pos.push(...p); this.nor.push(n.x, n.y, n.z); this.uv.push(...u); this.col.push(cc.r, cc.g, cc.b); }
  }
  quad(a, b, c, d, ua, ub, uc, ud, cc, out) { this.tri(a, b, c, ua, ub, uc, cc, out); this.tri(a, c, d, ua, uc, ud, cc, out); }
  mesh(mat, shadows) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadows; m.receiveShadow = shadows;
    return m;
  }
}

// curved clay roof tiles in rows (grey, tinted per house by vertex colour)
let tileTex = null;
function tiles() {
  if (tileTex) return tileTex;
  const n = 128, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const rows = 4, cols = 8, rh = n / rows, cw = n / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw + (r % 2) * cw / 2, y = r * rh;
      for (const dx of [0, -n]) {
        const gr = g.createLinearGradient(x + dx, 0, x + dx + cw, 0);
        const v = 205 + ((r * 7 + k * 13) % 5) * 9;
        gr.addColorStop(0, `rgb(${v * 0.62},${v * 0.62},${v * 0.62})`); gr.addColorStop(0.45, `rgb(${v},${v},${v})`); gr.addColorStop(1, `rgb(${v * 0.55},${v * 0.55},${v * 0.55})`);
        g.fillStyle = gr; g.fillRect(x + dx, y, cw, rh);
      }
    }
    const sh = g.createLinearGradient(0, r * rh + rh * 0.7, 0, r * rh + rh);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = sh; g.fillRect(0, r * rh, n, rh);
  }
  tileTex = new THREE.CanvasTexture(c);
  tileTex.colorSpace = THREE.SRGBColorSpace;
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  return tileTex;
}
// big stone flags for the piazza
function flagstones() {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#8f8270'; g.fillRect(0, 0, n, n);
  let s = 9;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = 4, rh = n / rows;
  for (let row = 0; row < rows; row++) {
    let x = -r() * 40;
    while (x < n) {
      const w = 50 + r() * 50, v = 196 + r() * 26;
      for (const dx of [0, n]) { g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.86})`; g.fillRect(x + 2 - (dx && x + w > n ? n : 0), row * rh + 2, w - 4, rh - 4); }
      x += w;
    }
  }
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.06})`; g.fillRect(r() * n, r() * n, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// red brick paving laid in rows, a little worn
function brickPaving() {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#b8806a'; g.fillRect(0, 0, n, n);
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bh = 16, bw = 48;
  for (let row = 0; row < n / bh; row++) for (let col = -1; col < n / bw + 1; col++) {
    const x = col * bw + (row % 2) * bw / 2, v = 0.88 + r() * 0.2;
    g.fillStyle = `rgb(${Math.round(222 * v)},${Math.round(112 * v)},${Math.round(92 * v)})`;
    g.fillRect(x + 1.5, row * bh + 1.5, bw - 3, bh - 3);
  }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,220'},${r() * 0.08})`; g.fillRect(r() * n, r() * n, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// square terracotta floor tiles (for rooms)
function floorTiles() {
  const n = 128, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#8a5a3c'; g.fillRect(0, 0, n, n);
  let s = 3;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 0.9 + r() * 0.18;
    g.fillStyle = `rgb(${Math.round(186 * v)},${Math.round(104 * v)},${Math.round(70 * v)})`;
    g.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// a painted shop sign: cream letters on a deep red board (our own name)
function shopSign(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#8c2f2c'; g.fillRect(0, 0, 512, 96);
  g.strokeStyle = '#efe2c8'; g.lineWidth = 5; g.strokeRect(8, 8, 496, 80);
  g.fillStyle = '#f3e7cf'; g.font = 'bold 50px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 96, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// a big painted site letter with an arrow underneath
function letterArrow(letter, arrow) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(214,92,60,0.88)'; g.font = 'bold 150px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 100);
  if (arrow) {
    g.save(); g.translate(128, 208); if (arrow === 'right') g.scale(-1, 1);
    g.beginPath(); g.moveTo(-70, 0); g.lineTo(-30, -26); g.lineTo(-30, -11); g.lineTo(70, -11); g.lineTo(70, 11); g.lineTo(-30, 11); g.lineTo(-30, 26); g.closePath(); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// the inn's hanging sign: a bunch of grapes and a cup on a painted board
function innSign() {
  const n = 128, c = document.createElement('canvas');
  c.width = n; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#3d5a3a'; g.fillRect(0, 0, n, 96);
  g.strokeStyle = '#d9b860'; g.lineWidth = 5; g.strokeRect(5, 5, n - 10, 86);
  g.fillStyle = '#6a2d4a';
  for (const [x, y] of [[44, 34], [56, 34], [68, 34], [50, 46], [62, 46], [56, 58], [44, 46], [68, 46]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#5a8a3a'; g.beginPath(); g.ellipse(64, 22, 10, 5, -0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8d8b0'; g.beginPath(); g.moveTo(84, 36); g.lineTo(104, 36); g.lineTo(98, 58); g.lineTo(90, 58); g.closePath(); g.fill();
  g.fillRect(92, 58, 4, 12); g.fillRect(86, 70, 16, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FLOOR_MIN = 2.4;

export function dressHouses(world, theme, group, I, { night = false, lowDetail = false, shadows = false } = {}) {
  const { box, cyl, glow, half, halfGlow } = I;
  const W = world.width, D = world.depth;
  const R = new Soup(), U = new Soup();
  const gables = { stucco: new Soup(), stone: new Soup(), brick: new Soup() };
  const lamps = [];
  const glass = col('#20262c'), litWarm = col('#ffcf7a'), trim = col('#e6dac2');
  const hh = (a, b) => hash2(Math.floor(a * 7.3) + 211, Math.floor(b * 5.1) + 97);

  for (const hs of world.houses) {
    const id = hs.id, h = hs.h;
    const hcol = col(hs.color);
    const stoneTrim = hs.mat === 'stone' ? col(hs.color, 0.06) : trim;
    const baseCol = hs.mat === 'stone' ? col(hs.color, -0.08) : col('#b9a888');

    // ---------- the four faces ----------
    const cx0 = Math.round(hs.x0 / CELL), cx1 = Math.round(hs.x1 / CELL), cz0 = Math.round(hs.z0 / CELL), cz1 = Math.round(hs.z1 / CELL);
    const sides = [
      { x: hs.x0, z: hs.z0, dir: [1, 0], n: [0, -1], len: hs.x1 - hs.x0, cell: k => [cx0 + k, cz0], nb: k => [cx0 + k, cz0 - 1] },
      { x: hs.x0, z: hs.z1, dir: [1, 0], n: [0, 1], len: hs.x1 - hs.x0, cell: k => [cx0 + k, cz1 - 1], nb: k => [cx0 + k, cz1] },
      { x: hs.x0, z: hs.z0, dir: [0, 1], n: [-1, 0], len: hs.z1 - hs.z0, cell: k => [cx0, cz0 + k], nb: k => [cx0 - 1, cz0 + k] },
      { x: hs.x1, z: hs.z0, dir: [0, 1], n: [1, 0], len: hs.z1 - hs.z0, cell: k => [cx1 - 1, cz0 + k], nb: k => [cx1, cz0 + k] },
    ];
    for (const sd of sides) {
      const N = Math.round(sd.len / CELL);
      sd.nbTop = []; sd.own = []; sd.propTop = [];
      for (let k = 0; k < N; k++) {
        const [nx, nz] = sd.nb(k);
        const out = nx < 0 || nz < 0 || nx >= world.w || nz >= world.h;
        let t = 0, pt = 0;
        if (out) t = Infinity;
        else for (const s of world.cellSpans(nx, nz)) {
          if (s.prop >= 0) { pt = Math.max(pt, s.y1); continue; }      // barrels, crates… stand in front of the wall
          if (s.m[0] === '_') continue;
          if (s.y1 > t && !(s.y0 > 2.5 && s.m === 'slab')) t = s.y1;
        }
        sd.nbTop.push(t); sd.propTop.push(pt);
        sd.own.push(world.cellSpans(...sd.cell(k)));
      }
    }
    const kAt = (sd, s) => Math.max(0, Math.min(sd.nbTop.length - 1, Math.floor(s / CELL)));
    const seen = (sd, s0, s1) => { let t = 0; for (let k = kAt(sd, s0); k <= kAt(sd, s1); k++) t = Math.max(t, sd.nbTop[k]); return t; };
    const propIn = (sd, s0, s1) => { let t = 0; for (let k = kAt(sd, s0); k <= kAt(sd, s1); k++) t = Math.max(t, sd.propTop[k]); return t; };
    const solid = (sd, s0, s1, y0, y1) => {
      for (let k = kAt(sd, s0); k <= kAt(sd, s1); k++) if (!sd.own[k].some(sp => sp.house === id && sp.y0 <= y0 + 0.01 && sp.y1 >= y1 - 0.01)) return false;
      return true;
    };
    // a piece flat on (or standing `depth` out from) a face
    const put = (sd, s, y, w, hgt, depth, c, glowing = false, gap = 0) => {
      const [ux, uz] = sd.dir, [nx, nz] = sd.n;
      (glowing ? glow : box).add(sd.x + ux * s + nx * (gap + depth / 2), y, sd.z + uz * s + nz * (gap + depth / 2), ux ? w : depth, hgt, uz ? w : depth, c);
    };
    const arch = (sd, s, y, rad, depth, c, glowing = false) => {
      const [ux, uz] = sd.dir, [nx, nz] = sd.n;
      (glowing ? halfGlow : half).add(sd.x + ux * s + nx * depth / 2, y, sd.z + uz * s + nz * depth / 2, rad, rad, depth, c, nx ? Math.PI / 2 : 0);
    };

    const nF = hs.kind === 'church' ? 1 : Math.max(1, Math.round((h - 0.7) / 3.0));
    const fH = Math.max(FLOOR_MIN, (h - 0.7) / nF);
    const winCentre = f => f * fH + fH * 0.6;
    let doorDone = 0, lampDone = false, balconyDone = !hs.balcony, plantsLeft = hs.plants ? 2 : 0;
    // the longest face seen from the street is the front
    const front = sides.reduce((best, sd) => { const v = sd.nbTop.filter(t => t < 0.5).length; return v > best.v ? { sd, v } : best; }, { sd: null, v: 0 }).sd;

    for (const sd of sides) {
      const len = sd.len, Nk = sd.nbTop.length;
      if (sd.nbTop.every(t => t >= h - 0.3)) continue;       // hidden face
      // ground band, corners and cornice where the face can be seen
      if (!lowDetail || hs.kind) {
        let k = 0;
        while (k < Nk) {
          if (sd.nbTop[k] > 0.3 || !sd.own[k].some(sp => sp.house === id && sp.y0 < 0.05)) { k++; continue; }
          let e = k;
          while (e < Nk && sd.nbTop[e] <= 0.3 && sd.own[e].some(sp => sp.house === id && sp.y0 < 0.05)) e++;
          put(sd, (k + e) / 2 * CELL, 0.28, (e - k) * CELL, 0.56, 0.035, baseCol);
          k = e;
        }
        k = 0;
        while (k < Nk) {
          if (sd.nbTop[k] > h - 0.4) { k++; continue; }
          let e = k;
          while (e < Nk && sd.nbTop[e] <= h - 0.4) e++;
          put(sd, (k + e) / 2 * CELL, h - 0.12, (e - k) * CELL + 0.1, 0.22, 0.14, stoneTrim);
          if (hs.kind === 'tower' || hs.kind === 'church') put(sd, (k + e) / 2 * CELL, h - 0.42, (e - k) * CELL + 0.06, 0.12, 0.08, stoneTrim);
          k = e;
        }
        if (hs.quoins) {
          for (const [s0, flip] of [[0, 1], [len, -1]]) {
            for (let y = 0.6, q = 0; y < h - 0.5; y += 0.6, q++) {
              if (seen(sd, Math.max(0, s0 - 0.3), Math.min(len, s0 + 0.3)) > y) continue;
              if (!solid(sd, flip > 0 ? 0 : len - 0.6, flip > 0 ? 0.6 : len, y - 0.15, y + 0.15)) continue;
              const w = q % 2 ? 0.34 : 0.58;
              put(sd, s0 + flip * w / 2, y, w, 0.3, 0.045, trim);
            }
          }
        }
        if (hs.kind === 'tower') for (const y of [6, 12]) put(sd, len / 2, y, len + 0.1, 0.2, 0.1, stoneTrim);
      }
      // frames round real doors and windows cut through the wall
      sd.cuts = [];
      {
        let k = 0;
        const gapAt = kk => { const sp = sd.own[kk].filter(p => p.house === id).sort((a, b) => a.y0 - b.y0); if (!sp.length) return null; if (sp[0].y0 > 0.3) return [0, sp[0].y0]; for (let i = 1; i < sp.length; i++) if (sp[i].y0 - sp[i - 1].y1 > 0.3) return [sp[i - 1].y1, sp[i].y0]; return null; };
        while (k < Nk) {
          const g0 = gapAt(k);
          if (!g0 || sd.nbTop[k] > g0[0] + 0.5) { k++; continue; }
          let e = k;
          while (e < Nk && gapAt(e) && Math.abs(gapAt(e)[0] - g0[0]) < 0.05) e++;
          const s0 = k * CELL, s1 = e * CELL, [y0, y1] = g0;
          sd.cuts.push([s0, s1, y0, y1]);
          if (s1 - s0 <= 3.2 && y1 < 3.5 && !lowDetail) {     // doors and windows (not the big archways)
            put(sd, s0 - 0.09, (y0 + y1) / 2, 0.18, y1 - y0, 0.06, stoneTrim);
            put(sd, s1 + 0.09, (y0 + y1) / 2, 0.18, y1 - y0, 0.06, stoneTrim);
            put(sd, (s0 + s1) / 2, y1 + 0.1, s1 - s0 + 0.36, 0.2, 0.07, stoneTrim);
            if (y0 > 0.3) put(sd, (s0 + s1) / 2, y0 - 0.04, s1 - s0 + 0.3, 0.08, 0.12, stoneTrim);
          }
          k = e;
        }
      }

      // ---------- windows and doors ----------
      if (hs.kind === 'church' || hs.kind === 'tower' || hs.plain) continue;
      const sp = hs.spacing || 2.8;
      const n = len < 1.6 ? 0 : Math.floor((len - 1.4) / sp) + 1;
      for (let f = 0; f < nF; f++) {
        const yc = winCentre(f);
        for (let i = 0; i < n; i++) {
          const s = len / 2 + (i - (n - 1) / 2) * sp;
          const r = hh(sd.x + sd.z * 0.37 + s, f + id * 0.13);
          if (f === 0) {
            // ground floor: at most one door per street face (none right beside a real doorway),
            // shuttered or barred windows elsewhere
            const street = seen(sd, s - 0.8, s + 0.8) < 0.3;
            const nearCut = sd.cuts.some(c => c[2] < 1 && s + 0.7 > c[0] - 1.6 && s - 0.7 < c[1] + 1.6);
            if (street && !sd.door && doorDone < 2 && !nearCut && propIn(sd, s - 1.0, s + 1.0) === 0 && len >= 2.5 && r < 0.55 && solid(sd, s - 0.7, s + 0.7, 0.1, 2.9)) {
              doorDone++; sd.door = true;
              const dc = ['#6b4a30', '#4f5f3e', '#5a3a2a', '#6a5a48'][Math.floor(r * 40) % 4];
              put(sd, s, 1.15, 1.42, 2.3, 0.05, stoneTrim); arch(sd, s, 2.3, 0.71, 0.05, stoneTrim);
              put(sd, s, 1.12, 1.12, 2.24, 0.08, col(dc)); arch(sd, s, 2.24, 0.56, 0.08, col(dc));
              put(sd, s, 1.2, 0.04, 2.1, 0.1, col(dc, -0.08));
              put(sd, s + 0.3, 1.1, 0.07, 0.07, 0.12, '#c8b060');
              put(sd, s, 0.03, 1.5, 0.06, 0.4, baseCol);
              if (!lampDone && !lowDetail && len >= 4 && lamps.length < 16) {
                lampDone = true;
                const ls = s + (r < 0.3 ? -1.1 : 1.1);
                // an iron wall lantern: bracket arm, little roof, glass, base
                put(sd, ls, 3.02, 0.04, 0.04, 0.46, '#2a2a2a');
                put(sd, ls, 2.95, 0.03, 0.12, 0.03, '#2a2a2a', false, 0.39);
                put(sd, ls, 2.86, 0.27, 0.06, 0.27, '#2a2a2a', false, 0.27);
                put(sd, ls, 2.69, 0.18, 0.28, 0.18, night ? '#ffe3a0' : '#efe2bc', true, 0.315);
                put(sd, ls, 2.53, 0.21, 0.05, 0.21, '#2a2a2a', false, 0.3);
                const [ux, uz] = sd.dir, [nx, nz] = sd.n;
                lamps.push([sd.x + ux * ls + nx * 0.4, 2.65, sd.z + uz * ls + nz * 0.4]);
              }
              continue;
            }
            const low = fH < 2.8;
            const gy = low ? Math.min(1.55, fH * 0.58) : 1.7, gw = low ? 0.7 : 0.86, gh = low ? 0.8 : 0.96;
            if (r > 0.72 || nearCut || Math.max(seen(sd, s - 0.6, s + 0.6), propIn(sd, s - 0.6, s + 0.6)) > gy - gh / 2 - 0.1 || !solid(sd, s - 0.5, s + 0.5, gy - gh / 2 - 0.1, gy + gh / 2 + 0.1)) continue;
            put(sd, s, gy, gw + 0.2, gh + 0.2, 0.05, stoneTrim);
            put(sd, s, gy, gw, gh, 0.07, night && r < 0.25 ? litWarm : glass, night && r < 0.25);
            put(sd, s, gy - gh / 2 - 0.1, gw + 0.34, 0.07, 0.14, stoneTrim);
            if (hs.shutters && r < 0.4 && !lowDetail) {
              const sc = col(hs.shutters);
              put(sd, s - gw / 2 - 0.22, gy, 0.4, gh + 0.1, 0.05, sc); put(sd, s + gw / 2 + 0.22, gy, 0.4, gh + 0.1, 0.05, sc);
            } else for (let b = -1; b <= 1; b++) put(sd, s + b * gw / 4, gy, 0.035, gh, 0.1, '#2a2a2a');
            continue;
          }
          const tall = hs.win === 'tall' || (!balconyDone && sd === front && f === 1 && i === Math.floor(n / 2));
          const wh = tall ? 1.85 : hs.win === 'arch' ? 1.15 : 1.3;
          const wy = tall ? f * fH + 0.15 + wh / 2 : yc;
          const top = wy + wh / 2 + (hs.win === 'arch' && !tall ? 0.48 : 0.12);
          if (seen(sd, s - 0.7, s + 0.7) > wy - wh / 2 - 0.1 || !solid(sd, s - 0.55, s + 0.55, wy - wh / 2 - 0.1, top) || top > h - 0.3) continue;
          const lit = night && r < 0.38;
          const shutClosed = hs.shutters && r > 0.78;
          put(sd, s, wy, 1.06, wh + 0.1, 0.05, stoneTrim);
          put(sd, s, wy, 0.86, wh - 0.06, 0.07, lit ? litWarm : glass, lit);
          if (hs.win === 'arch' && !tall) { arch(sd, s, wy + wh / 2, 0.53, 0.05, stoneTrim); arch(sd, s, wy + wh / 2 - 0.03, 0.43, 0.07, lit ? litWarm : glass, lit); }
          else put(sd, s, wy + wh / 2 + 0.1, 1.24, 0.14, 0.07, stoneTrim);       // lintel
          put(sd, s, wy, 0.05, wh - 0.06, 0.085, stoneTrim);                         // mullion
          put(sd, s, wy - wh / 2 - 0.05, 1.22, 0.07, 0.15, stoneTrim);               // sill
          if (hs.shutters && !lowDetail) {
            const sc = col(hs.shutters);
            if (shutClosed) { put(sd, s - 0.22, wy, 0.42, wh - 0.08, 0.1, sc); put(sd, s + 0.22, wy, 0.42, wh - 0.08, 0.1, sc); }
            else { put(sd, s - 0.76, wy, 0.44, wh, 0.05, sc); put(sd, s + 0.76, wy, 0.44, wh, 0.05, sc); }
          }
          // one balcony on the front, flower boxes under a couple of windows
          if (tall && !lowDetail) {
            const by = f * fH + 0.1;
            const big = !balconyDone && sd === front && f === 1;
            if (big) {
              balconyDone = true;
              put(sd, s, by, 1.9, 0.12, 0.8, stoneTrim);
              put(sd, s - 0.6, by - 0.14, 0.12, 0.16, 0.6, stoneTrim); put(sd, s + 0.6, by - 0.14, 0.12, 0.16, 0.6, stoneTrim);
              put(sd, s, by + 1.0, 1.9, 0.04, 0.04, '#2a2a2a', false, 0.76);
              for (let b = 0; b <= 9; b++) put(sd, s - 0.9 + b * 0.2, by + 0.5, 0.025, 0.95, 0.025, '#2a2a2a', false, 0.77);
              put(sd, s - 0.93, by + 1.0, 0.04, 0.04, 0.8, '#2a2a2a'); put(sd, s + 0.93, by + 1.0, 0.04, 0.04, 0.8, '#2a2a2a');
              if (hs.plants) { for (const ps of [-0.65, 0.65]) { put(sd, s + ps, by + 0.2, 0.28, 0.28, 0.28, '#a5512f', false, 0.35); put(sd, s + ps, by + 0.45, 0.36, 0.3, 0.32, '#4f7a3a', false, 0.33); } }
            } else {
              put(sd, s, by + 0.75, 1.0, 0.04, 0.04, '#2a2a2a', false, 0.12);
              for (let b = 0; b <= 5; b++) put(sd, s - 0.45 + b * 0.18, by + 0.45, 0.025, 0.6, 0.025, '#2a2a2a', false, 0.12);
            }
          } else if (plantsLeft > 0 && !lowDetail && r < 0.5) {
            plantsLeft--;
            put(sd, s, wy - wh / 2 - 0.2, 0.95, 0.22, 0.24, '#a5512f', false, 0.03);
            put(sd, s, wy - wh / 2 - 0.04, 0.9, 0.16, 0.22, '#4f7a3a', false, 0.04);
            for (let b = 0; b < 4; b++) put(sd, s - 0.33 + b * 0.22, wy - wh / 2 + 0.03, 0.12, 0.1, 0.12, ['#d8323a', '#f2c84a', '#ffffff', '#e05a8a'][(b + Math.floor(r * 10)) % 4], false, 0.06);
          }
        }
      }
    }

    // ---------- landmarks ----------
    if (hs.kind === 'church') {
      const sd = sides[1], s = sd.len / 2;                          // the facade on the piazza
      put(sd, s, 1.75, 3.0, 3.5, 0.12, stoneTrim); arch(sd, s, 3.5, 1.5, 0.12, stoneTrim);
      put(sd, s, 1.7, 2.3, 3.4, 0.16, col('#5a3a24')); arch(sd, s, 3.4, 1.15, 0.16, col('#5a3a24'));
      put(sd, s, 1.75, 0.05, 3.3, 0.2, col('#3e2818'));
      for (const y of [1.0, 2.4]) for (const dx of [-0.6, 0.6]) put(sd, s + dx, y, 0.12, 0.12, 0.2, '#2a2a2a');
      // rose window
      const [nx, nz] = sd.n, fx = sd.x + s, fz = sd.z;
      cyl.add(fx, 7.6, fz + nz * 0.06, 1.45, 0.12, 1.45, stoneTrim, 0, Math.PI / 2, 0);
      cyl.add(fx, 7.6, fz + nz * 0.1, 1.15, 0.1, 1.15, night ? litWarm : col('#2a2e3a'), 0, Math.PI / 2, 0);
      for (let k = 0; k < 6; k++) box.add(fx, 7.6, fz + nz * 0.16, 0.08, 2.3, 0.05, stoneTrim, 0, 0, k * Math.PI / 6);
      cyl.add(fx, 7.6, fz + nz * 0.17, 0.28, 0.06, 0.28, stoneTrim, 0, Math.PI / 2, 0);
      for (const ps of [0.35, sd.len - 0.35]) put(sd, ps, h / 2, 0.7, h, 0.16, stoneTrim);      // corner pilasters
      put(sd, s, 5.2, sd.len - 1.2, 0.16, 0.1, stoneTrim);
      // tall arched windows down the side walls
      for (const side of [sides[2], sides[3]]) {
        for (let ss = 1.8; ss < side.len - 1; ss += 3) {
          if (seen(side, ss - 0.5, ss + 0.5) > 5.0) continue;
          put(side, ss, 6.6, 0.95, 2.7, 0.05, stoneTrim); arch(side, ss, 7.95, 0.475, 0.05, stoneTrim);
          put(side, ss, 6.6, 0.75, 2.6, 0.07, night ? litWarm : glass, night); arch(side, ss, 7.9, 0.375, 0.07, night ? litWarm : glass, night);
          put(side, ss, 5.22, 1.1, 0.08, 0.14, stoneTrim);
        }
      }
    } else if (hs.kind === 'tower') {
      for (const sd of sides) {
        const nOpen = sd.len >= 5 ? 2 : 1;
        for (let k = 0; k < nOpen; k++) {
          const s = sd.len * (k + 0.5) / nOpen, y = h - 3.0;
          put(sd, s, y, 1.3, 2.3, 0.06, stoneTrim); arch(sd, s, y + 1.15, 0.65, 0.06, stoneTrim);
          put(sd, s, y, 1.0, 2.2, 0.08, col('#1c1712')); arch(sd, s, y + 1.1, 0.5, 0.08, col('#1c1712'));
          put(sd, s, y - 1.2, 1.4, 0.1, 0.18, stoneTrim);
          if (sd.len >= 4) for (const yy of [8.5, 11]) { if (seen(sd, s - 0.3, s + 0.3) < yy - 1) put(sd, s, yy, 0.3, 1.0, 0.06, col('#1c1712')); }
        }
      }
      // a clock above the church roof
      const sd = sides[2], s = sd.len / 2, y = h - 6;
      const [nx] = sd.n;
      cyl.add(sd.x + nx * 0.05, y, sd.z + s, 1.0, 0.1, 1.0, stoneTrim, 0, 0, Math.PI / 2);
      cyl.add(sd.x + nx * 0.1, y, sd.z + s, 0.85, 0.1, 0.85, '#f2ece0', 0, 0, Math.PI / 2);
      box.add(sd.x + nx * 0.16, y + 0.25, sd.z + s, 0.04, 0.55, 0.06, '#1c1c1c');
      box.add(sd.x + nx * 0.16, y + 0.12, sd.z + s + 0.2, 0.04, 0.06, 0.45, '#1c1c1c', 0, -0.5, 0);
    } else if (hs.kind === 'inn' && !lowDetail) {
      // a painted sign hanging over the street by the front door
      const sd = sides[2], s = 13.0;
      put(sd, s, 3.3, 0.06, 0.06, 1.0, '#2a2a2a');
      put(sd, s, 3.1, 0.05, 0.4, 0.05, '#2a2a2a', false, 0.92);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.64), new THREE.MeshLambertMaterial({ map: innSign(), side: THREE.DoubleSide }));
      sign.position.set(sd.x - 0.62, 2.75, sd.z + s);
      group.add(sign);
      cyl.add(sd.x - 0.34, 3.27, sd.z + s, 0.012, 0.1, 0.012, '#2a2a2a');
      cyl.add(sd.x - 0.9, 3.27, sd.z + s, 0.012, 0.1, 0.012, '#2a2a2a');
    }

    // ---------- the roof ----------
    addRoof(hs, W, D, R, U, gables, box, hcol, lowDetail);

    // ---------- drainpipes and TV aerials (themes that ask for them) ----------
    if (theme.pipes && !lowDetail && !hs.kind) {
      const sd = front;
      if (sd && sd.len >= 3) {
        const s = hh(id, 3.3) < 0.5 ? 0.25 : sd.len - 0.25;
        if (seen(sd, Math.max(0, s - 0.3), Math.min(sd.len, s + 0.3)) < 0.3) {
          const [ux, uz] = sd.dir, [nx, nz] = sd.n, px = sd.x + ux * s + nx * 0.1, pz = sd.z + uz * s + nz * 0.1;
          cyl.add(px, h / 2, pz, 0.055, h, 0.055, '#8c9196');
          for (let y = 1.2; y < h - 0.3; y += 2.2) put(sd, s, y, 0.16, 0.05, 0.14, '#6f7378');
          put(sd, s, 0.15, 0.14, 0.3, 0.3, '#8c9196');                                // shoe at the bottom
        }
      }
    }
    if (theme.antennas && !lowDetail && !hs.kind && hs.roof !== 'flat' && hh(id, 7.7) < 0.3) {
      const ax = (hs.x0 + hs.x1) / 2 + (hh(id, 1.1) - 0.5) * 1.5, az = (hs.z0 + hs.z1) / 2 + (hh(id, 2.2) - 0.5) * 1.5;
      const top = h + Math.min(hs.x1 - hs.x0, hs.z1 - hs.z0) * 0.25;
      cyl.add(ax, top + 0.8, az, 0.025, 1.8, 0.025, '#5c6064');
      const ang = hh(id, 4.4) * Math.PI;
      for (const [y, w] of [[top + 1.5, 1.2], [top + 1.25, 1.0], [top + 1.0, 0.8]]) box.add(ax, y, az, w, 0.025, 0.025, '#5c6064', ang);
      for (let k = -2; k <= 2; k++) box.add(ax + Math.cos(ang) * k * 0.25, top + 1.5, az - Math.sin(ang) * k * 0.25, 0.02, 0.025, 0.4, '#5c6064', ang);
    }
  }

  // build the merged meshes
  const tileMat = new THREE.MeshLambertMaterial({ map: tiles(), vertexColors: true });
  const roof = R.mesh(tileMat, shadows); if (roof) group.add(roof);
  const under = U.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }), false); if (under) group.add(under);
  const texFor = { stucco: ['plaster', 4], stone: ['blocks', 5], brick: ['brick', 6] };
  for (const [m, soup] of Object.entries(gables)) {
    const mesh = soup.mesh(new THREE.MeshLambertMaterial({ map: makeTexture(texFor[m][0], '#ffffff', null, texFor[m][1]), vertexColors: true }), shadows);
    if (mesh) group.add(mesh);
  }
  return lamps;
}

// Pitched roofs of clay tiles: gable (ridge along x or z), hip, a steep tower roof, or flat with a parapet.
// Houses on the map's edge carry on outside it, so their roofs are made deeper there.
function addRoof(hs, W, D, R, U, gables, box, hcol, lowDetail) {
  const h = hs.h;
  let x0 = hs.x0, x1 = hs.x1, z0 = hs.z0, z1 = hs.z1;
  const ext = 4, edge = x0 <= 0 || x1 >= W || z0 <= 0 || z1 >= D;
  if (x0 <= 0) x0 -= ext; if (x1 >= W) x1 += ext; if (z0 <= 0) z0 -= ext; if (z1 >= D) z1 += ext;
  let type = hs.roof || 'gable-x';
  if (type === 'hip' && edge) type = x1 - x0 >= z1 - z0 ? 'gable-x' : 'gable-z';
  const rc = col(hs.roofColor || '#b5532f'), uc = col('#4a3426'), capC = col(hs.roofColor || '#b5532f', -0.06);
  if (type === 'flat') {
    // a low parapet with clay coping round the edges you can see
    const pc = col(hs.color, 0.04);
    if (hs.z0 > 0) box.add((hs.x0 + hs.x1) / 2, h + 0.3, hs.z0 + 0.12, hs.x1 - hs.x0, 0.6, 0.24, pc);
    if (hs.z1 < D) box.add((hs.x0 + hs.x1) / 2, h + 0.3, hs.z1 - 0.12, hs.x1 - hs.x0, 0.6, 0.24, pc);
    if (hs.x0 > 0) box.add(hs.x0 + 0.12, h + 0.3, (hs.z0 + hs.z1) / 2, 0.24, 0.6, hs.z1 - hs.z0, pc);
    if (hs.x1 < W) box.add(hs.x1 - 0.12, h + 0.3, (hs.z0 + hs.z1) / 2, 0.24, 0.6, hs.z1 - hs.z0, pc);
    if (hs.z0 > 0) box.add((hs.x0 + hs.x1) / 2, h + 0.64, hs.z0 + 0.12, hs.x1 - hs.x0 + 0.1, 0.08, 0.34, capC);
    if (hs.z1 < D) box.add((hs.x0 + hs.x1) / 2, h + 0.64, hs.z1 - 0.12, hs.x1 - hs.x0 + 0.1, 0.08, 0.34, capC);
    if (hs.x0 > 0) box.add(hs.x0 + 0.12, h + 0.64, (hs.z0 + hs.z1) / 2, 0.34, 0.08, hs.z1 - hs.z0 + 0.1, capC);
    if (hs.x1 < W) box.add(hs.x1 - 0.12, h + 0.64, (hs.z0 + hs.z1) / 2, 0.34, 0.08, hs.z1 - hs.z0 + 0.1, capC);
    return;
  }
  const tower = type === 'tower';
  const p = tower ? 1.1 : Math.min(x1 - x0, z1 - z0) < 3.2 ? 0.56 : 0.46;     // rise per metre
  const o = tower ? 0.35 : 0.42, slopeK = Math.sqrt(1 + p * p) / 1.6;
  // local frame: a = along the ridge, b = across it
  const alongX = type === 'gable-x' || ((type === 'hip' || tower) && x1 - x0 >= z1 - z0);
  const toW = alongX ? (a, y, b) => [a, y, b] : (a, y, b) => [b, y, a];
  const dirW = alongX ? (a, y, b) => V(a, y, b) : (a, y, b) => V(b, y, a);
  const A0 = alongX ? x0 : z0, A1 = alongX ? x1 : z1, B0 = alongX ? z0 : x0, B1 = alongX ? z1 : x1;
  const ye = h - o * p;
  const slope = (pts, uvA, out) => {
    // pts: [a, y, b] corners; u along the eave, v up the slope from the eave
    const w = pts.map(q => toW(...q));
    const uv = pts.map(q => [q[uvA] / 2, (q[1] - ye) / p * slopeK]);
    if (pts.length === 4) {
      R.quad(...w, ...uv, rc, out);
      U.quad(...w.map(q => [q[0], q[1] - 0.1, q[2]]), ...uv, uc, out.clone().negate());
    } else {
      R.tri(...w, ...uv, rc, out);
      U.tri(...w.map(q => [q[0], q[1] - 0.1, q[2]]), ...uv, uc, out.clone().negate());
    }
  };
  const gable = gables[hs.mat] || gables.stucco;
  const gUV = (q) => [(alongX ? q[2] : q[0]) / 3, q[1] / 3];
  if (type === 'gable-x' || type === 'gable-z') {
    const og = 0.3, bc = (B0 + B1) / 2, half = (B1 - B0) / 2, yr = h + half * p;
    slope([[A0 - og, ye, B0 - o], [A1 + og, ye, B0 - o], [A1 + og, yr, bc], [A0 - og, yr, bc]], 0, dirW(0, 1, -p));
    slope([[A1 + og, ye, B1 + o], [A0 - og, ye, B1 + o], [A0 - og, yr, bc], [A1 + og, yr, bc]], 0, dirW(0, 1, p));
    const [rx, , rz] = toW((A0 + A1) / 2, 0, bc);
    box.add(rx, yr + 0.04, rz, alongX ? A1 - A0 + 2 * og : 0.26, 0.14, alongX ? 0.26 : A1 - A0 + 2 * og, capC);
    // the triangle of wall under each end of the roof
    for (const [a, s] of [[alongX ? hs.x0 : hs.z0, -1], [alongX ? hs.x1 : hs.z1, 1]]) {
      const q = [toW(a, h, B0), toW(a, h, B1), toW(a, yr, bc)];
      gable.tri(...q, ...q.map(gUV), hcol, dirW(s, 0, 0));
    }
    if (hs.chimney && !lowDetail) chimney(box, toW, A0 + (A1 - A0) * 0.28, bc + Math.min(0.5, half * 0.4), yr - Math.min(0.5, half * 0.4) * p, yr, hs);
  } else {
    // hip (and the steep tower roof): four slopes up to a short ridge along the longer side
    const ea0 = A0 - o, ea1 = A1 + o, eb0 = B0 - o, eb1 = B1 + o;
    const halfB = (eb1 - eb0) / 2, bc = (eb0 + eb1) / 2, yr = ye + halfB * p;
    let r0 = ea0 + halfB, r1 = ea1 - halfB;
    if (r0 > r1) r0 = r1 = (ea0 + ea1) / 2;
    slope([[ea0, ye, eb0], [ea1, ye, eb0], [r1, yr, bc], [r0, yr, bc]], 0, dirW(0, 1, -p));
    slope([[ea1, ye, eb1], [ea0, ye, eb1], [r0, yr, bc], [r1, yr, bc]], 0, dirW(0, 1, p));
    slope([[ea0, ye, eb1], [ea0, ye, eb0], [r0, yr, bc]], 2, dirW(-p, 1, 0));
    slope([[ea1, ye, eb0], [ea1, ye, eb1], [r1, yr, bc]], 2, dirW(p, 1, 0));
    if (r1 - r0 > 0.2) { const [rx, , rz] = toW((r0 + r1) / 2, 0, bc); box.add(rx, yr + 0.04, rz, alongX ? r1 - r0 : 0.26, 0.14, alongX ? 0.26 : r1 - r0, capC); }
    if (tower) { const [rx, , rz] = toW((r0 + r1) / 2, 0, bc); box.add(rx, yr + 0.35, rz, 0.12, 0.8, 0.12, '#3a3a3a'); box.add(rx, yr + 0.6, rz, 0.5, 0.06, 0.06, '#3a3a3a'); }
    if (hs.chimney && !lowDetail && !tower) chimney(box, toW, (r0 + r1) / 2 + 0.6, bc + 0.5, yr - 0.5 * p, yr, hs);
  }
}
function chimney(box, toW, a, b, base, ridge, hs) {
  const [x, , z] = toW(a, 0, b), top = ridge + 0.9;
  const c = hs.mat === 'stucco' ? col(hs.color, -0.03) : col('#c9b48f');
  box.add(x, (base - 0.3 + top) / 2, z, 0.55, top - base + 0.3, 0.55, c);
  box.add(x, top + 0.05, z, 0.75, 0.1, 0.75, col('#a5512f'));
  box.add(x, top + 0.3, z, 0.4, 0.06, 0.4, col('#9c4a2e'));
  box.add(x - 0.15, top + 0.18, z, 0.06, 0.2, 0.3, col('#9c4a2e'));
  box.add(x + 0.15, top + 0.18, z, 0.06, 0.2, 0.3, col('#9c4a2e'));
}

// village extras from world.deco: humped bridge parapets over the canal, vaulted archways, piazza paving
export function villageDeco(world, d, I, group, { night = false, shadows = false } = {}) {
  const { box, half, cyl, glow } = I;
  const a = d.args;
  if (d.type === 'canalbridge') {
    // [x0, x1, z (the face over the water), dir (+1 / -1: which way the water lies), deck height]
    const [x0, x1, z, dir, top] = a;
    const zc = z - dir * 0.25, len = x1 - x0, xc = (x0 + x1) / 2;
    box.add(xc, (top + 0.9) / 2, zc, len, top + 0.9, 0.5, '#d6c8ab');
    box.add(xc, top + 0.95, zc, len + 0.2, 0.1, 0.62, '#e6dac2');
    box.add(x0 - 0.15, top + 0.5, zc, 0.3, 1.0, 0.6, '#e6dac2'); box.add(x1 + 0.15, top + 0.5, zc, 0.3, 1.0, 0.6, '#e6dac2');
    half.add(xc, 0, z + dir * 0.02, len / 2 - 0.15, len / 2 - 0.15, 0.04, '#e6dac2', 0);
    half.add(xc, 0, z + dir * 0.035, len / 2 - 0.45, len / 2 - 0.45, 0.04, '#1f302c', 0);
  } else if (d.type === 'arch') {
    // [x0, z0, x1, z1, opening height, axis the passage runs along, how high the arch rises]
    const [x0, z0, x1, z1, top, axis, rise] = a;
    const span = axis === 'z' ? x1 - x0 : z1 - z0, len = axis === 'z' ? z1 - z0 : x1 - x0;
    const ys = top - rise;
    const sh = new THREE.Shape();
    sh.moveTo(-span / 2, ys); sh.lineTo(-span / 2, top + 0.01); sh.lineTo(span / 2, top + 0.01); sh.lineTo(span / 2, ys);
    sh.absellipse(0, ys, span / 2, rise, 0, Math.PI, false);
    const hsId = world.houseAt(Math.floor((x0 + x1) / 2 / CELL), Math.floor((z0 + z1) / 2 / CELL));
    const wallCol = hsId >= 0 ? world.houses[hsId].color : '#e6c9a0';
    const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 16 });
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: makeTexture('plaster', '#ffffff', null, 4), color: wallCol }));
    if (axis === 'z') m.position.set((x0 + x1) / 2, 0, z0);
    else { m.rotation.y = Math.PI / 2; m.position.set(x0, 0, (z0 + z1) / 2); }
    m.receiveShadow = shadows; m.castShadow = shadows;
    group.add(m);
    // a ring of light stone on both faces
    const ring = new THREE.Shape();
    ring.absellipse(0, ys, span / 2 + 0.32, rise + 0.32, 0, Math.PI, false);
    ring.lineTo(-span / 2, ys);
    ring.absellipse(0, ys, span / 2, rise, Math.PI, 0, true);
    ring.lineTo(span / 2 + 0.32, ys);
    const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.06, bevelEnabled: false, curveSegments: 16 });
    for (const end of [0, 1]) {
      const r = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: '#e6dac2' }));
      if (axis === 'z') r.position.set((x0 + x1) / 2, 0, end ? z1 : z0 - 0.06);
      else { r.rotation.y = Math.PI / 2; r.position.set(end ? x1 : x0 - 0.06, 0, (z0 + z1) / 2); }
      group.add(r);
      // the jambs either side
      for (const sgn of [-1, 1]) {
        if (axis === 'z') box.add((x0 + x1) / 2 + sgn * (span / 2 + 0.16), ys / 2, end ? z1 + 0.03 : z0 - 0.03, 0.32, ys, 0.06, '#e6dac2');
        else box.add(end ? x1 + 0.03 : x0 - 0.03, ys / 2, (z0 + z1) / 2 + sgn * (span / 2 + 0.16), 0.06, ys, 0.32, '#e6dac2');
      }
    }
  } else if (d.type === 'shopfront') {
    // [x0, x1, z (wall face), dir (+1 faces +z), name]: a two-arch shopfront on a plain wall, with a sign
    const [x0, x1, z, dir, name] = a, len = x1 - x0, n = 2, aw = len / n;
    const zf = z + dir * 0.02, depth = 0.08;
    const stone = '#e4dccd', dark = '#3a2c22', wood = '#7a5a3c';
    for (let k = 0; k < n; k++) {
      const cx = x0 + aw * (k + 0.5), r = aw * 0.38, spring = 2.3;
      box.add(cx, spring / 2, zf + dir * 0.02, r * 2, spring, 0.04, '#4a3a2e');                  // shadowed opening
      half.add(cx, spring, zf + dir * 0.02, r, r, 0.04, '#4a3a2e', 0);
      box.add(cx, 1.2, zf + dir * 0.05, r * 1.25, 2.4, 0.05, wood);                              // big wooden doors
      for (let b = -2; b <= 2; b++) box.add(cx + b * r * 0.25, 1.2, zf + dir * 0.08, 0.04, 2.3, 0.02, '#5c4430');
      box.add(cx, 2.42, zf + dir * 0.08, r * 1.3, 0.08, 0.04, '#5c4430');
      half.add(cx, spring, zf + dir * 0.04, r + 0.28, r + 0.28, 0.05, stone, 0);                 // stone arch ring
      half.add(cx, spring, zf + dir * 0.05, r, r, 0.05, '#4a3a2e', 0);
      for (const s of [-1, 1]) box.add(cx + s * (r + 0.14), spring / 2, zf + dir * depth / 2, 0.28, spring, depth, stone);   // piers
      box.add(cx, 0.12, zf + dir * 0.25, r * 2, 0.24, 0.5, '#cfc6b6');                           // worn step
    }
    // sign board, a cornice, and lamps on iron arms
    const signY = 2.3 + aw * 0.38 + 0.75;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len * 0.6, 5), 0.85), new THREE.MeshLambertMaterial({ map: shopSign(name || 'CANTINA FIAMMA') }));
    sign.position.set((x0 + x1) / 2, signY, z + dir * 0.06); if (dir < 0) sign.rotation.y = Math.PI;
    group.add(sign);
    box.add((x0 + x1) / 2, signY + 0.6, zf + dir * 0.08, len, 0.14, 0.16, stone);
    for (const lx of [x0 + 0.5, (x0 + x1) / 2, x1 - 0.5]) {
      box.add(lx, signY - 0.2, zf + dir * 0.22, 0.04, 0.04, 0.44, '#2a2a2a');
      box.add(lx, signY - 0.42, zf + dir * 0.42, 0.18, 0.26, 0.18, '#2e2c28');
      glow.add(lx, signY - 0.44, zf + dir * 0.42, 0.13, 0.18, 0.13, night ? '#ffe3a0' : '#efe2bc');
    }
  } else if (d.type === 'railing') {
    // [x0, z0, x1, z1, y]: an iron railing (thin bars) along a balcony edge; collision is invisible ('_rail')
    const [x0, z0, x1, z1, y] = a, alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box.add(cx, y + 1.0, cz, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, '#3a3c3e');
    box.add(cx, y + 0.12, cz, alongX ? len : 0.04, 0.04, alongX ? 0.04 : len, '#3a3c3e');
    for (let s = 0.06; s < len; s += 0.13) box.add(alongX ? x0 + s : cx, y + 0.56, alongX ? cz : z0 + s, 0.022, 0.9, 0.022, '#3a3c3e');
  } else if (d.type === 'corbels') {
    // [x0, z0, x1, z1, y]: stone brackets under a balcony's outer edge
    const [x0, z0, x1, z1, y] = a, alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let s = 0.4; s < len; s += 1.1) {
      const x = alongX ? x0 + s : (x0 + x1) / 2, z = alongX ? (z0 + z1) / 2 : z0 + s;
      box.add(x, y - 0.55, z, alongX ? 0.18 : 0.5, 0.5, alongX ? 0.5 : 0.18, '#d7cfc1');
      box.add(x, y - 0.22, z, alongX ? 0.22 : 0.7, 0.16, alongX ? 0.7 : 0.22, '#e1dacd');
    }
  } else if (d.type === 'painta') {
    // [x, y, z, ry (which way the wall faces), arrow 'left' | 'right' | '']
    const [x, y, z, ry, arrow] = a;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshLambertMaterial({ map: letterArrow('A', arrow), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 1;
    group.add(m);
  } else if (d.type === 'gate') {
    // [x0, x1, z]: an iron gate across a passage
    const [x0, x1, z] = a, cx = (x0 + x1) / 2, len = x1 - x0;
    for (const s of [x0 + 0.08, x1 - 0.08]) box.add(s, 1.3, z, 0.16, 2.6, 0.16, '#3a3c3e');
    for (const y of [0.2, 1.2, 2.3]) box.add(cx, y, z, len, 0.06, 0.06, '#3a3c3e');
    for (let s = 0.2; s < len - 0.1; s += 0.14) box.add(x0 + s, 1.3, z, 0.025, 2.4, 0.025, '#3a3c3e');
    for (let s = 0.2; s < len - 0.1; s += 0.14) box.add(x0 + s, 2.6, z, 0.06, 0.12, 0.06, '#3a3c3e');
  } else if (d.type === 'bucket') {
    // [x, z, kind 'bucket' | 'can']: a metal bucket or a watering can on the ground
    const [x, z, kind] = a;
    cyl.add(x, 0.17, z, 0.15, 0.34, 0.15, '#7e8388');
    if (kind === 'can') { box.add(x + 0.2, 0.22, z, 0.3, 0.04, 0.04, '#7e8388', 0, 0, -0.6); box.add(x, 0.4, z, 0.2, 0.04, 0.04, '#6c7176'); }
    else box.add(x, 0.36, z, 0.3, 0.02, 0.02, '#4a4d50');
  } else if (d.type === 'stairarch') {
    // [x (side face of a stair block), z centre, radius, dir (+1 faces +x)]: a dark arch under a stone stair
    const [x, zc, rad, dir] = a;
    half.add(x + dir * 0.03, 0, zc, rad, rad, 0.05, '#3c3630', Math.PI / 2);
    half.add(x + dir * 0.02, 0, zc, rad + 0.2, rad + 0.2, 0.04, '#cfc8bc', Math.PI / 2);
  } else if (d.type === 'paving') {
    // [x0, z0, x1, z1, 'flags' (big stone slabs) | 'tiles' (terracotta, for rooms) | 'terracotta' (red brick paving)]
    const [x0, z0, x1, z1, kind = 'flags'] = a;
    const tile = kind === 'tiles' ? 1.4 : kind === 'terracotta' ? 2.4 : 6;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / tile, uv.getY(i) * (z1 - z0) / tile);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: kind === 'tiles' ? floorTiles() : kind === 'terracotta' ? brickPaving() : flagstones(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
    m.receiveShadow = shadows;
    group.add(m);
  }
}
