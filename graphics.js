// Graphics presets and custom options. game.js reads the resolved settings.

// [key, label, choices as [value, text]]
export const GFX_OPTIONS = [
  ['renderScale', 'Render scale', [[0.5, '50 %'], [0.75, '75 %'], [1, '100 %'], [1.5, '150 %'], [2, '200 % (sharpest)']]],
  ['shadows', 'Shadow quality', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra (soft)']]],
  ['aa', 'Anti-aliasing', [['off', 'Off'], ['fxaa', 'FXAA (fast)'], ['msaa', 'MSAA (sharp)']]],
  ['ao', 'Ambient occlusion', [[false, 'Off'], [true, 'On']]],
  ['bloom', 'Bloom', [[false, 'Off'], [true, 'On']]],
  ['textures', 'Texture quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]],
  ['viewDistance', 'View distance', [[80, 'Near'], [140, 'Medium'], [200, 'Far'], [300, 'Very far']]],
  ['modelDetail', 'Model detail', [['low', 'Low'], ['high', 'High']]],
  ['effects', 'Effects quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]],
  ['fpsCap', 'FPS cap', [[30, '30'], [60, '60'], [90, '90'], [120, '120'], [0, 'Unlimited']]],
];

export const PRESETS = {
  low: { renderScale: 0.75, shadows: 'off', aa: 'off', ao: false, bloom: false, textures: 'low', viewDistance: 80, modelDetail: 'low', effects: 'low', fpsCap: 60 },
  medium: { renderScale: 1, shadows: 'off', aa: 'fxaa', ao: false, bloom: false, textures: 'medium', viewDistance: 140, modelDetail: 'high', effects: 'medium', fpsCap: 60 },
  high: { renderScale: 1, shadows: 'medium', aa: 'msaa', ao: false, bloom: true, textures: 'high', viewDistance: 200, modelDetail: 'high', effects: 'high', fpsCap: 0 },
  ultra: { renderScale: 1.5, shadows: 'ultra', aa: 'msaa', ao: true, bloom: true, textures: 'high', viewDistance: 300, modelDetail: 'high', effects: 'high', fpsCap: 0 },
};

// settings.graphics = { preset: 'auto' | 'low' | … | 'custom', custom: { …options } }
export function resolveGraphics(gfx, isTouch) {
  const g = gfx || {};
  let preset = g.preset || 'auto';
  if (preset === 'auto') preset = isTouch ? 'medium' : 'high';
  if (preset === 'custom') return { ...PRESETS.high, ...(g.custom || {}), preset };
  return { ...(PRESETS[preset] || PRESETS.medium), preset };
}
