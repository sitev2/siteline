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
// terracotta brick paving laid in rows: muted reds and browns, worn and dusty
function brickPaving() {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#8c7a68'; g.fillRect(0, 0, n, n);
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bh = 16, bw = 48;
  const tones = [[150, 80, 62], [142, 74, 58], [158, 90, 70], [128, 70, 56], [164, 104, 84], [138, 66, 52]];
  for (let row = 0; row < n / bh; row++) for (let col = -1; col < n / bw + 1; col++) {
    const x = col * bw + (row % 2) * bw / 2, v = 0.86 + r() * 0.2, t = tones[Math.floor(r() * tones.length)];
    g.fillStyle = `rgb(${Math.round(t[0] * v)},${Math.round(t[1] * v)},${Math.round(t[2] * v)})`;
    g.fillRect(x + 1.5, row * bh + 1.5, bw - 3, bh - 3);
    g.fillStyle = 'rgba(255,235,210,0.10)'; g.fillRect(x + 1.5, row * bh + 1.5, bw - 3, 2);        // worn top edge
    g.fillStyle = 'rgba(40,20,10,0.12)'; g.fillRect(x + 1.5, row * bh + bh - 3.5, bw - 3, 2);
    if (r() < 0.15) { g.fillStyle = 'rgba(70,50,40,0.25)'; g.fillRect(x + 4 + r() * (bw - 14), row * bh + 3 + r() * 6, 3 + r() * 6, 2 + r() * 3); }   // a chip
  }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,220'},${r() * 0.08})`; g.fillRect(r() * n, r() * n, 2, 2); }
  // dust in the joints and pale patches where feet wear it
  for (let i = 0; i < 6; i++) {
    const x = r() * n, y = r() * n, rad = 30 + r() * 50;
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, 'rgba(214,190,160,0.22)'); gr.addColorStop(1, 'rgba(214,190,160,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    }
  }
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
    // [x0, x1, z (wall face), dir (+1 faces +z), name, depth, lanterns 'both' | 'east' | 'west']: a stone arcade built out in front of a plain wall —
    // two deep round arches with wooden cellar doors, piers, a cornice and a framed sign. Collision for the piers is
    // added in the map (the openings stay walkable, a little way in).
    const [x0, x1, z, dir, name, D = 0.5, lanterns = 'both'] = a, len = x1 - x0;
    const pw = 0.5, n = 2, r = (len - pw * (n + 1)) / n / 2, sp = 2.2, H = sp + r + 1.5;
    const cxs = Array.from({ length: n }, (_, k) => x0 + pw + r + k * (2 * r + pw));
    const front = z + dir * D, stone = '#ddd4c4', stoneDk = '#c9bfae', iron = '#2b2a28', wood = '#6e4e34';
    // the stone front itself: one slab with the arch openings cut out of it, pushed out from the wall
    const pts = [new THREE.Vector2(0, 0)];
    for (const cx of cxs) {
      const lx = cx - x0;
      pts.push(new THREE.Vector2(lx - r, 0), new THREE.Vector2(lx - r, sp));
      for (let k = 1; k < 16; k++) { const t = Math.PI - (k / 16) * Math.PI; pts.push(new THREE.Vector2(lx + Math.cos(t) * r, sp + Math.sin(t) * r)); }
      pts.push(new THREE.Vector2(lx + r, sp), new THREE.Vector2(lx + r, 0));
    }
    pts.push(new THREE.Vector2(len, 0), new THREE.Vector2(len, H), new THREE.Vector2(0, H));
    const tex = makeTexture('blocks', '#e2dacb', null, 41).clone();
    tex.needsUpdate = true; tex.repeat.set(1 / 3, 1 / 3);
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: D, bevelEnabled: false, curveSegments: 1 }), new THREE.MeshLambertMaterial({ map: tex }));
    if (dir > 0) slab.position.set(x0, 0, z); else { slab.position.set(x1, 0, z); slab.rotation.y = Math.PI; }
    slab.castShadow = shadows; slab.receiveShadow = shadows;
    group.add(slab);
    for (const cx of cxs) {
      // inside the arch: shade, a pair of plank doors, a fanlight grille, iron straps and rings
      box.add(cx, sp / 2, z + dir * 0.02, 2 * r, sp, 0.04, '#3a2f27');
      half.add(cx, sp, z + dir * 0.02, r, r, 0.04, '#2c241e', 0);
      box.add(cx, (sp - 0.1) / 2, z + dir * 0.06, 2 * r - 0.12, sp - 0.1, 0.06, wood);
      for (let b = 1; b < 12; b++) box.add(cx - r + b * (2 * r / 12), (sp - 0.1) / 2, z + dir * 0.095, 0.025, sp - 0.14, 0.02, '#4d3624');
      box.add(cx, (sp - 0.1) / 2, z + dir * 0.1, 0.05, sp - 0.1, 0.03, '#3a2a1c');
      for (const y of [0.45, 1.75]) box.add(cx, y, z + dir * 0.11, 2 * r - 0.3, 0.07, 0.02, iron);
      for (const sx of [-0.18, 0.18]) cyl.add(cx + sx, 1.15, z + dir * 0.12, 0.06, 0.02, 0.06, '#8a7a5a', 0, Math.PI / 2);
      box.add(cx, sp - 0.05, z + dir * 0.08, 2 * r, 0.1, 0.08, '#4d3624');                                  // transom
      for (let b = -3; b <= 3; b++) {
        const bx = b * r / 4, hgt = Math.sqrt(r * r - bx * bx) - 0.05;
        box.add(cx + bx, sp + hgt / 2, z + dir * 0.06, 0.03, hgt, 0.03, iron);
      }
      // a ring of wedge stones round the arch, and a keystone
      const nv = 13;
      for (let k = 0; k < nv; k++) {
        const t = Math.PI * (k + 0.5) / nv, rr = r + 0.16;
        box.add(cx + Math.cos(t) * rr, sp + Math.sin(t) * rr, front + dir * 0.02, 0.32, Math.PI * rr / nv - 0.03, 0.04, k % 2 ? '#e4dccd' : '#d8cfbf', 0, 0, t);
      }
      box.add(cx, sp + r + 0.2, front + dir * 0.05, 0.36, 0.5, 0.1, '#e6dfd2');
      // a worn stone step in front of each doorway
      box.add(cx, 0.06, z + dir * (D - 0.2), 2 * r - 0.1, 0.12, 0.4, '#cfc6b6');
    }
    // impost blocks on the piers, a plinth along the bottom, a cornice along the top
    for (let k = 0; k <= n; k++) {
      const px = x0 + pw / 2 + k * (2 * r + pw);
      box.add(px, sp - 0.07, front + dir * 0.03, pw + 0.12, 0.16, 0.06, '#e6dfd2');
      box.add(px, 0.22, front + dir * 0.03, pw + 0.08, 0.44, 0.06, stoneDk);
    }
    box.add((x0 + x1) / 2, H + 0.09, z + dir * (D + 0.1) / 2, len + 0.3, 0.18, D + 0.1, '#e6dfd2');
    box.add((x0 + x1) / 2, H + 0.24, z + dir * (D + 0.2) / 2, len + 0.4, 0.12, D + 0.2, stone);
    box.add((x0 + x1) / 2, H - 0.12, front + dir * 0.02, len, 0.08, 0.04, stoneDk);
    // the sign, set in a stone frame between the arches and the cornice
    const sw = Math.min(len * 0.55, 4.6), sy = sp + r + (H - sp - r) / 2 + 0.05;
    box.add((x0 + x1) / 2, sy, front + dir * 0.03, sw + 0.3, 1.05, 0.06, '#e6dfd2');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.78), new THREE.MeshLambertMaterial({ map: shopSign(name || 'CANTINA FIAMMA') }));
    sign.position.set((x0 + x1) / 2, sy, front + dir * 0.065); if (dir < 0) sign.rotation.y = Math.PI;
    group.add(sign);
    // iron lanterns on the outer piers
    for (const lx of lanterns === 'east' ? [x1 - pw / 2] : lanterns === 'west' ? [x0 + pw / 2] : [x0 + pw / 2, x1 - pw / 2]) {
      box.add(lx, 3.0, front + dir * 0.2, 0.04, 0.04, 0.4, '#2a2a2a');
      box.add(lx, 2.92, front + dir * 0.38, 0.24, 0.05, 0.24, '#2a2a2a');
      glow.add(lx, 2.74, front + dir * 0.38, 0.16, 0.3, 0.16, night ? '#ffe3a0' : '#efe2bc');
      box.add(lx, 2.57, front + dir * 0.38, 0.2, 0.04, 0.2, '#2a2a2a');
    }
  } else if (d.type === 'arcade') {
    // [x0, z0, x1, z1, pillars]: a long roofed arcade against a building whose face is at x0, running from z0 to z1.
    // Its front (x1 - 1 … x1) is a row of square stone pillars, given as [[za, zb], …] along z, with wide round
    // arches between them; a smaller arch closes the z0 end, a tall wall with a window closes the z1 end, and a tiled
    // lean-to roof on wooden rafters covers it all. Collision (pillars, walls, stone above the arches, roof) is in the map.
    const [x0, z0, x1, z1, pillars] = a, T = 1.0, sp = 2.6, archB = 2.0, eave = 5.6, high = 6.6;
    const roofY = (x) => high - (high - eave) * (x - x0) / (x1 - x0);       // underside of the rafters
    const scaledTex = (kind, base, seed) => { const t = makeTexture(kind, base, null, seed).clone(); t.needsUpdate = true; t.repeat.set(1 / 3, 1 / 3); return t; };
    const plaster = new THREE.MeshLambertMaterial({ map: scaledTex('oldplaster', '#e6dccb', 53) });
    const stoneTex = makeTexture('blocks', '#ddd5c6', null, 41).clone(); stoneTex.needsUpdate = true;
    const stoneM = new THREE.MeshLambertMaterial({ map: stoneTex });
    const trim = '#e8e1d5';
    const slab = (pts, mat, x, z, ry, depth) => {
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth, bevelEnabled: false, curveSegments: 1 }), mat);
      m.position.set(x, 0, z); m.rotation.y = ry; m.castShadow = shadows; m.receiveShadow = shadows;
      group.add(m);
    };
    // a box whose texture keeps a 3 m tile whatever its size
    const stoneBox = (w, h, dd, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, dd), uv = g.attributes.uv;
      const faces = [[dd, h], [dd, h], [w, dd], [w, dd], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * faces[f][0] / 3, uv.getY(k) * faces[f][1] / 3); }
      const m = new THREE.Mesh(g, stoneM);
      m.position.set(x, y, z); m.castShadow = shadows; m.receiveShadow = shadows;
      group.add(m);
    };
    const V2 = (u, y) => new THREE.Vector2(u, y);
    // points along an arch from its left foot over the top to its right foot (rise b; a semicircle when b = half the width)
    const arch = (u0, u1, b, n = 24) => {
      const r = (u1 - u0) / 2, c = (u0 + u1) / 2, out = [];
      for (let k = 0; k <= n; k++) { const t = Math.PI - (k / n) * Math.PI; out.push(V2(c + Math.cos(t) * r, sp + Math.sin(t) * b)); }
      return out;
    };
    // a smooth moulded band just outside an arch, on a face; toWorld(u, y) gives the world point
    const band = (u0, u1, b, toWorld, alongX) => {
      const pts = arch(u0 - 0.12, u1 + 0.12, b + 0.12, 28);
      for (let k = 0; k < pts.length - 1; k++) {
        const p = pts[k], q = pts[k + 1], du = q.x - p.x, dy = q.y - p.y, len = Math.hypot(du, dy) + 0.02;
        const [x, y, z] = toWorld((p.x + q.x) / 2, (p.y + q.y) / 2);
        if (alongX) box.add(x, y, z, len, 0.2, 0.05, trim, 0, 0, Math.atan2(dy, du));
        else box.add(x, y, z, 0.05, 0.2, len, trim, 0, Math.atan2(-dy, du), 0);
      }
    };
    const L = x1 - x0, fi = x1 - T;              // fi: inner face of the arcade front
    const zEnd = z1 - 0.5;                       // the front runs up to the tall end wall
    // the front above the pillars: one slab with the arches cut out of its bottom edge
    const front = [V2(0, sp)];
    for (let k = 0; k < pillars.length - 1; k++) front.push(...arch(pillars[k][1] - z0, pillars[k + 1][0] - z0, archB));
    front.push(V2(zEnd - z0, sp), V2(zEnd - z0, eave + 0.1), V2(0, eave + 0.1));
    slab(front, plaster, x1, z0, -Math.PI / 2, T);
    // the pillars: a stone shaft on a plinth, with a moulded capital where the arches spring
    for (const [za, zb] of pillars) {
      const zc = (za + zb) / 2, w = zb - za, xc = x1 - T / 2;
      stoneBox(T, sp, w, xc, sp / 2, zc);
      box.add(xc, 0.22, zc, T + 0.14, 0.44, w + 0.14, '#d2c9b9');
      box.add(xc, 0.47, zc, T + 0.08, 0.06, w + 0.08, '#ddd5c6');
      box.add(xc, sp - 0.17, zc, T + 0.06, 0.08, w + 0.06, '#e3dccf');
      box.add(xc, sp - 0.06, zc, T + 0.18, 0.14, w + 0.18, trim);
    }
    for (let k = 0; k < pillars.length - 1; k++) band(pillars[k][1] - z0, pillars[k + 1][0] - z0, archB, (u, y) => [x1 + 0.025, y, z0 + u], false);
    // iron lanterns on brackets over the pillars, on the outside
    for (const [za, zb] of pillars.slice(0, -1)) {
      const zc = (za + zb) / 2;
      box.add(x1 + 0.22, 3.55, zc, 0.44, 0.04, 0.04, '#2a2a2a');
      box.add(x1 + 0.12, 3.4, zc, 0.03, 0.3, 0.03, '#2a2a2a', 0, 0, 0.6);
      box.add(x1 + 0.42, 3.48, zc, 0.24, 0.05, 0.24, '#2a2a2a');
      glow.add(x1 + 0.42, 3.3, zc, 0.16, 0.3, 0.16, night ? '#ffe3a0' : '#efe2bc');
      box.add(x1 + 0.42, 3.13, zc, 0.2, 0.04, 0.2, '#2a2a2a');
    }
    // the z0 end: a round arch from the building to the first pillar, the wall above it following the roof
    const nw = fi - x0;
    slab([...arch(0, nw, nw / 2), V2(nw, roofY(fi) + 0.1), V2(0, high + 0.1)], plaster, x0, z0, 0, 0.5);
    band(0, nw, nw / 2, (u, y) => [x0 + u, y, z0 - 0.025], true);
    box.add(x0 + 0.06, sp - 0.06, z0 + 0.25, 0.12, 0.14, 0.68, trim);
    // the z1 end: a tall wall along the street, its top following the roof, with a small barred window
    slab([V2(0, 0), V2(L, 0), V2(L, eave + 0.1), V2(0, high + 0.1)], plaster, x0, z1 - 0.5, 0, 0.5);
    const wx = x0 + L * 0.42;
    box.add(wx, 2.0, z1 + 0.03, 0.9, 1.15, 0.06, '#e3dccf');
    box.add(wx, 2.0, z1 + 0.05, 0.66, 0.9, 0.04, '#20262c');
    for (let b = -1.5; b <= 1.5; b++) box.add(wx + b * 0.15, 2.0, z1 + 0.09, 0.025, 0.9, 0.025, '#2a2a2a');
    box.add(wx, 1.4, z1 + 0.08, 1.0, 0.07, 0.16, '#e3dccf');
    // cornice under the eaves along the front, and a timber plate on its inner top edge under the rafters
    box.add(x1 + 0.05, eave - 0.1, (z0 + zEnd) / 2, 0.16, 0.14, zEnd - z0 + 0.1, trim);
    box.add(fi + 0.12, (eave + 0.1 + roofY(fi) + 0.02) / 2, (z0 + z1) / 2, 0.24, roofY(fi) + 0.02 - eave - 0.1, z1 - z0, '#5e4430');
    // the roof: clay tiles on top, boards underneath, on rafters, sloping down from the building to the front
    const over = 0.45, run = L + over, drop = (high - eave) * run / L, ang = Math.atan2(high - eave, L);
    const slopeLen = Math.hypot(run, drop), wz = z1 - z0 + 0.4, thick = 0.12;
    const tt = tiles().clone(); tt.needsUpdate = true; tt.repeat.set(wz / 1.6, slopeLen / 1.6);
    const wood = new THREE.MeshLambertMaterial({ color: '#7a5a3e' }), dark = new THREE.MeshLambertMaterial({ color: '#5e4430' });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(wz, thick, slopeLen),
      [wood, wood, new THREE.MeshLambertMaterial({ map: tt, color: '#d3936a' }), dark, wood, wood]);
    const mx = x0 + run / 2;
    roof.position.set(mx, roofY(mx) + 0.16 + thick / 2, (z0 + z1) / 2 + 0.1);
    roof.rotation.set(ang, Math.PI / 2, 0, 'YXZ');
    roof.castShadow = shadows; roof.receiveShadow = shadows;
    group.add(roof);
    for (let zz = z0 + 0.3; zz < z1 - 0.2; zz += 0.55) box.add(mx, roofY(mx) + 0.08, zz, slopeLen, 0.16, 0.12, '#6a4a30', 0, 0, -ang);
    box.add(x0 + 0.08, high + 0.12, (z0 + z1) / 2, 0.16, 0.16, z1 - z0 + 0.4, '#5e4430');           // ledger on the building
    box.add(x0 + 0.05, high + 0.38, (z0 + z1) / 2, 0.1, 0.12, z1 - z0 + 0.4, '#bfae98');            // flashing where it meets the wall
    // a lantern hanging in the middle of each bay
    const lx = (x0 + fi) / 2;
    for (let k = 0; k < pillars.length - 1; k++) {
      const lz = (pillars[k][1] + pillars[k + 1][0]) / 2;
      box.add(lx, (roofY(lx) + 4.05) / 2, lz, 0.02, roofY(lx) - 4.05, 0.02, '#2a2a2a');
      box.add(lx, 4.02, lz, 0.26, 0.05, 0.26, '#2a2a2a');
      glow.add(lx, 3.83, lz, 0.17, 0.32, 0.17, night ? '#ffe3a0' : '#efe2bc');
      box.add(lx, 3.65, lz, 0.22, 0.04, 0.22, '#2a2a2a');
    }
  } else if (d.type === 'curb') {
    // [x0, z0, x1, z1]: a low stone kerb round a paved area
    const [x0, z0, x1, z1] = a;
    box.add((x0 + x1) / 2, 0.03, (z0 + z1) / 2, x1 - x0, 0.06, z1 - z0, '#d6cebf');
    box.add((x0 + x1) / 2, 0.062, (z0 + z1) / 2, x1 - x0 - 0.04, 0.008, z1 - z0 - 0.04, '#e2dbcd');
  } else if (d.type === 'shrubs') {
    // [x0, z0, x1, z1, y]: a bed of low shrubs and a few flowers on top of a planter
    const [x0, z0, x1, z1, y] = a;
    const leaves = new THREE.IcosahedronGeometry(1, 0);
    let s = Math.floor(x0 * 13 + z0 * 7);
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    box.add((x0 + x1) / 2, y + 0.01, (z0 + z1) / 2, x1 - x0 - 0.16, 0.03, z1 - z0 - 0.16, '#5a4632');
    const greens = ['#4f7a36', '#5d8a3e', '#466e30', '#6b9446'];
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(leaves, new THREE.MeshLambertMaterial({ color: greens[i % greens.length], flatShading: true }));
      const sz = 0.16 + r() * 0.12;
      m.position.set(x0 + 0.2 + r() * (x1 - x0 - 0.4), y + sz * 0.6, z0 + 0.2 + r() * (z1 - z0 - 0.4));
      m.scale.set(sz, sz * 0.8, sz); m.rotation.set(r() * 3, r() * 3, 0);
      m.castShadow = shadows; group.add(m);
      // a couple of small flowers sitting on top of each shrub
      for (let f = 0; f < 2; f++) { const a2 = r() * Math.PI * 2; box.add(m.position.x + Math.cos(a2) * sz * 0.35, m.position.y + sz * 0.68, m.position.z + Math.sin(a2) * sz * 0.35, 0.035, 0.02, 0.035, ['#d8323a', '#f2c84a', '#ffffff'][(i + f) % 3]); }
    }
  } else if (d.type === 'pot') {
    // [x, z]: a big terracotta pot with a small bush
    const [x, z] = a;
    cyl.add(x, 0.3, z, 0.24, 0.6, 0.24, '#b5653f');
    cyl.add(x, 0.58, z, 0.28, 0.06, 0.28, '#a85a38');
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), new THREE.MeshLambertMaterial({ color: '#557f3a', flatShading: true }));
    m.position.set(x, 0.85, z); m.scale.set(1, 0.85, 1); m.castShadow = shadows;
    group.add(m);
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
    const tile = kind === 'tiles' ? 1.4 : kind === 'terracotta' ? 1.8 : 6;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / tile, uv.getY(i) * (z1 - z0) / tile);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: kind === 'tiles' ? floorTiles() : kind === 'terracotta' ? brickPaving() : flagstones(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
    m.receiveShadow = shadows;
    group.add(m);
  }
}
