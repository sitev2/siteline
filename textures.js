// Procedural textures drawn on canvases — no image assets needed.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

function speckle(ctx, size, base, amount, count, r) {
  for (let i = 0; i < count; i++) {
    const v = (r() - 0.5) * amount;
    ctx.fillStyle = shade(base, v);
    const s = 1 + r() * 3;
    ctx.globalAlpha = 0.35 + r() * 0.4;
    ctx.fillRect(r() * size, r() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

function toTexture(c, renderer, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const cache = new Map();
export function makeTexture(kind, base, renderer, seed = 1) {
  const key = `${kind}|${base}|${seed}`;
  if (cache.has(key)) return cache.get(key);
  const size = 256;
  const [c, ctx] = canvas(size);
  const r = rng(seed * 7919 + kind.length * 31);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  if (kind === 'sand') {
    speckle(ctx, size, base, 0.12, 5000, r);
    ctx.strokeStyle = shade(base, -0.05);
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      const y = r() * size;
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x / 30 + i) * 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'blocks' || kind === 'brick') {
    const bh = kind === 'brick' ? 16 : 42, bw = kind === 'brick' ? 48 : 96;
    for (let row = 0; row * bh < size; row++) {
      const off = (row % 2) * bw / 2;
      for (let col = -1; col * bw < size; col++) {
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.1);
        ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
    speckle(ctx, size, base, 0.15, 3500, r);
    ctx.fillStyle = shade(base, -0.18);
    for (let row = 0; row * bh < size; row++) {
      ctx.fillRect(0, row * bh, size, 2);
      const off = (row % 2) * bw / 2;
      for (let col = -1; col * bw < size; col++) ctx.fillRect(col * bw + off, row * bh, 2, bh);
    }
  } else if (kind === 'cobble') {
    // rounded setts in loose rows with dark joints between them
    ctx.fillStyle = shade(base, -0.2);
    ctx.fillRect(0, 0, size, size);
    const rows = 10, rh = size / rows;
    for (let row = 0; row < rows; row++) {
      let x = (row % 2) * rh * 0.5 - rh;
      while (x < size + rh) {
        const w = rh * (0.85 + r() * 0.5);
        const cx = x + w / 2, cy = row * rh + rh / 2;
        const fill = shade(base, (r() - 0.5) * 0.1 + 0.02), rot = (r() - 0.5) * 0.2;
        for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.ellipse(cx + dx, cy + dy, w / 2 - 1, rh / 2 - 1, rot, 0, Math.PI * 2);
          ctx.fill();
        }
        x += w;
      }
    }
    speckle(ctx, size, base, 0.12, 2500, r);
  } else if (kind === 'oldplaster') {
    // sun-faded plaster, flaking off in places to show the grey stone underneath
    speckle(ctx, size, base, 0.1, 8000, r);
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = shade(base, (r() - 0.5) * 0.12); ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.ellipse(r() * size, r() * size, 20 + r() * 50, 10 + r() * 30, r() * 3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      // a patch of bare stone with a ragged edge
      const cx = r() * size, cy = r() * size, rw = 10 + r() * 18, rh = 7 + r() * 12;
      ctx.save();
      ctx.beginPath();
      for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, f = 0.7 + r() * 0.5; ctx.lineTo(cx + Math.cos(a) * rw * f, cy + Math.sin(a) * rh * f); }
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = '#c2bdb6'; ctx.fillRect(cx - rw * 2, cy - rh * 2, rw * 4, rh * 4);
      for (let y = cy - rh * 2; y < cy + rh * 2; y += 9) {
        let x = cx - rw * 2 - r() * 10;
        while (x < cx + rw * 2) { const w = 10 + r() * 12; ctx.fillStyle = shade('#e2ddd5', (r() - 0.5) * 0.08); ctx.fillRect(x + 1, y + 1, w - 2, 7); x += w; }
      }
      ctx.restore();
      ctx.strokeStyle = shade(base, -0.15); ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, rw * 1.02, rh * 1.02, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // streaks from the rain running down
    for (let i = 0; i < 10; i++) { ctx.fillStyle = 'rgba(70,60,50,0.07)'; ctx.fillRect(r() * size, 0, 2 + r() * 4, size * (0.3 + r() * 0.7)); }
  } else if (kind === 'ply') {
    // pale plywood crate: wavy grain, a darker frame round the edge, corner bolts
    for (let y = 0; y < size; y += 3) {
      ctx.strokeStyle = shade(base, (Math.sin(y * 0.21) * 0.5 + (r() - 0.5)) * 0.05); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + y * 0.13) * 3);
      ctx.stroke();
    }
    for (let i = 0; i < 18; i++) { ctx.fillStyle = shade(base, -0.08); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(r() * size, r() * size, 6 + r() * 10, 2 + r() * 3, r(), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = shade(base, -0.14);
    const f = 12;
    ctx.fillRect(0, 0, size, f); ctx.fillRect(0, size - f, size, f); ctx.fillRect(0, 0, f, size); ctx.fillRect(size - f, 0, f, size);
    ctx.fillStyle = shade(base, -0.4);
    for (const [x, y] of [[6, 6], [size - 6, 6], [6, size - 6], [size - 6, size - 6], [size / 2, 6], [size / 2, size - 6]]) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
    // our own stencil: a small flame in a ring
    ctx.strokeStyle = 'rgba(150,40,40,0.75)'; ctx.fillStyle = 'rgba(150,40,40,0.75)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(size * 0.5, size * 0.55, 30, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size * 0.5, size * 0.55 - 22); ctx.quadraticCurveTo(size * 0.5 + 16, size * 0.55, size * 0.5, size * 0.55 + 20);
    ctx.quadraticCurveTo(size * 0.5 - 16, size * 0.55, size * 0.5, size * 0.55 - 22); ctx.fill();
  } else if (kind === 'concrete') {
    speckle(ctx, size, base, 0.1, 6000, r);
    ctx.fillStyle = shade(base, -0.12);
    ctx.fillRect(0, 0, size, 2);
    ctx.fillRect(0, 0, 2, size);
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = shade(base, -0.1);
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      let x = r() * size, y = r() * size;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'crate') {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = shade(base, (r() - 0.5) * 0.08);
      ctx.fillRect(0, i * size / 6, size, size / 6 - 2);
    }
    speckle(ctx, size, base, 0.15, 2000, r);
    ctx.fillStyle = shade(base, -0.1);
    const f = 22;
    ctx.fillRect(0, 0, size, f); ctx.fillRect(0, size - f, size, f);
    ctx.fillRect(0, 0, f, size); ctx.fillRect(size - f, 0, f, size);
    ctx.save();
    ctx.translate(size / 2, size / 2); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size * 0.7, -f / 2, size * 1.4, f);
    ctx.restore();
    ctx.fillStyle = shade(base, -0.32);
    for (const [x, y] of [[11, 11], [size - 11, 11], [11, size - 11], [size - 11, size - 11]]) {
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    }
  } else if (kind === 'metal') {
    for (let x = 0; x < size; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, shade(base, 0.08)); g.addColorStop(0.5, shade(base, -0.08)); g.addColorStop(1, shade(base, 0.08));
      ctx.fillStyle = g; ctx.fillRect(x, 0, 16, size);
    }
    speckle(ctx, size, '#6b5040', 0.2, 900, r);
  } else if (kind === 'plaster') {
    speckle(ctx, size, base, 0.08, 7000, r);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = shade(base, -0.06);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(r() * size, r() * size, 10 + r() * 30, 6 + r() * 20, r() * 3, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const t = toTexture(c, renderer);
  cache.set(key, t);
  return t;
}

export function letterTexture(letter, color) {
  const [c, ctx] = canvas(256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = color; ctx.lineWidth = 14; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(128, 128, 110, 0, 7); ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 170px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function radialTexture(inner, outer) {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function labelTexture(text, color = '#fff') {
  const [c, ctx] = canvas(256);
  c.height = 64;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color; ctx.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
