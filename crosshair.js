// Crosshair drawing and settings. Used by the HUD and by the editor in Settings.

export const DEFAULT_CROSSHAIR = {
  color: '#ffffff', length: 9, thickness: 2, gap: 4, outline: true, dot: false, opacity: 1, dynamic: true,
  recoil: false,     // follow recoil: the crosshair moves to where the next bullet will go while spraying
};

export function crosshairCfg(c) { return { ...DEFAULT_CROSSHAIR, ...(c || {}) }; }

// Draw onto a canvas centred in it. spread = extra gap in CSS pixels from movement / shooting
// (only used when "dynamic" is on); ox, oy = shift from the centre in CSS pixels (the settings preview
// uses it to show "follow recoil"; in game the HUD moves the whole canvas instead).
export function drawCrosshair(canvas, cfg, spread = 0, ox = 0, oy = 0) {
  const c = crosshairCfg(cfg);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = canvas.clientWidth || 200;
  if (canvas.width !== Math.round(size * dpr)) { canvas.width = canvas.height = Math.round(size * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const cx = size / 2 + ox, cy = size / 2 + oy;
  const t = Math.max(1, c.thickness), L = Math.max(0, c.length);
  const gap = c.gap + (c.dynamic ? spread : 0);
  const rects = [];
  if (L > 0) {
    rects.push([cx - t / 2, cy - gap - L, t, L]);       // top
    rects.push([cx - t / 2, cy + gap, t, L]);           // bottom
    rects.push([cx - gap - L, cy - t / 2, L, t]);       // left
    rects.push([cx + gap, cy - t / 2, L, t]);           // right
  }
  if (c.dot) rects.push([cx - t / 2, cy - t / 2, t, t]);
  g.globalAlpha = Math.max(0.05, Math.min(1, c.opacity));
  if (c.outline) {
    g.fillStyle = 'rgba(0,0,0,0.85)';
    for (const [x, y, w, h] of rects) g.fillRect(x - 1, y - 1, w + 2, h + 2);
  }
  g.fillStyle = c.color;
  for (const [x, y, w, h] of rects) g.fillRect(x, y, w, h);
  g.globalAlpha = 1;
}

// Share codes: "SL-" + base64 of the settings, so friends can copy each other's crosshair
export function crosshairCode(cfg) {
  const c = crosshairCfg(cfg);
  const raw = [c.color.replace('#', ''), c.length, c.thickness, c.gap, c.outline ? 1 : 0, c.dot ? 1 : 0, Math.round(c.opacity * 100), c.dynamic ? 1 : 0, c.recoil ? 1 : 0].join('.');
  return 'SL-' + btoa(raw).replace(/=+$/, '');
}

export function parseCrosshairCode(code) {
  try {
    const s = String(code || '').trim().replace(/^SL-/i, '');
    const [color, length, thickness, gap, outline, dot, opacity, dynamic, recoil] = atob(s).split('.');
    if (!/^[0-9a-f]{6}$/i.test(color)) return null;
    const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
    return {
      color: '#' + color.toLowerCase(), length: num(length, 0, 30), thickness: num(thickness, 1, 8), gap: num(gap, -5, 20),
      outline: outline === '1', dot: dot === '1', opacity: num(opacity, 5, 100) / 100, dynamic: dynamic === '1',
      recoil: recoil === '1',     // older codes don't have it: off
    };
  } catch (e) { return null; }
}
