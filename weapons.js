// Weapon data and damage rules. Numbers come from the SITELINE design brief
// (CS-style values). Distances in the brief are in game units: 1 unit = 0.0254 m.
//
//   team:   'atk' (attackers / T side), 'def' (defenders / CT side) or 'both'
//   slot:   'primary' or 'secondary' (pistols)
//   speed:  running speed in units per second while the gun is in your hands
//   pen:    wall penetration power (2.5 best, 1 weakest) — see penMetres()
//   rangeMod: share of damage kept per 500 units of distance
//   Inaccuracy values are in radians (the radius of the random spread cone):
//     stand = standing still, move = extra at full running speed,
//     air = extra while airborne, fire = extra added per shot, recover = seconds to recover it
export const U = 0.0254;              // metres per game unit
export const TOP_SPEED = 250;         // u/s — running with the bomb in your hands, the fastest you can go
export const ACCURATE_SPEED = 0.34;   // accurate again below 34 % of the weapon's max speed

export const WEAPONS = {
  // ---------------- pistols ----------------
  glock: {
    name: 'Glock-18', type: 'pistol', slot: 'secondary', team: 'atk', price: 200, reward: 300,
    damage: 30, head: 4, armorPen: 0.47, rpm: 400, mag: 20, reserve: 60, reload: 2.3, deploy: 1.0,
    speed: 240, rangeMod: 0.85, pen: 1, auto: false, alt: 'burst',
    stand: 0.0045, move: 0.035, air: 0.22, fire: 0.03, recover: 0.3, kick: [0.018, 0.008],
    burstInterval: 0.055, burstCooldown: 0.5, burstSpread: 0.012,
    blurb: 'Free attacker pistol. Big magazine; right-click for 3-round burst.',
    sound: { freq: 1500, decay: 0.08, gain: 0.42, thump: 170 },
  },
  usp: {
    name: 'USP-S', type: 'pistol', slot: 'secondary', team: 'def', price: 200, reward: 300,
    damage: 35, head: 4, armorPen: 0.505, rpm: 352, mag: 12, reserve: 24, reload: 2.2, deploy: 1.0,
    speed: 240, rangeMod: 0.91, pen: 1, auto: false, silenced: true,
    stand: 0.0035, move: 0.04, air: 0.25, fire: 0.03, recover: 0.3, kick: [0.02, 0.007],
    blurb: 'Free defender pistol. Silenced.',
    sound: { freq: 1250, decay: 0.09, gain: 0.48, thump: 160 },
  },
  tec9: {
    name: 'Tec-9', type: 'pistol', slot: 'secondary', team: 'atk', price: 500, reward: 300,
    damage: 33, head: 4, armorPen: 0.906, rpm: 500, mag: 18, reserve: 54, reload: 2.6, deploy: 1.0,
    speed: 240, rangeMod: 0.79, pen: 1, auto: false,
    stand: 0.004, move: 0.018, air: 0.08, fire: 0.035, recover: 0.35, kick: [0.022, 0.01],
    blurb: 'Hits hard through armour and stays accurate on the run.',
    sound: { freq: 1350, decay: 0.09, gain: 0.5, thump: 150 },
  },
  deagle: {
    name: 'Desert Eagle', type: 'pistol', slot: 'secondary', team: 'both', price: 700, reward: 300,
    damage: 53, head: 3.9, armorPen: 0.932, rpm: 266, mag: 7, reserve: 21, reload: 2.2, deploy: 1.0,
    speed: 230, rangeMod: 0.85, pen: 2, auto: false,
    stand: 0.0055, move: 0.085, air: 0.3, fire: 0.06, recover: 0.45, kick: [0.06, 0.018],
    blurb: 'One headshot kills, even through a helmet. Heavy kick.',
    sound: { freq: 700, decay: 0.2, gain: 0.75, thump: 90 },
  },
  // ---------------- shotguns ----------------
  mag7: {
    name: 'MAG-7', type: 'shotgun', slot: 'primary', team: 'def', price: 1300, reward: 900,
    damage: 30, pellets: 8, head: 4, armorPen: 0.75, rpm: 70, mag: 5, reserve: 15, reload: 2.5, deploy: 1.0,
    speed: 225, rangeMod: 0.45, pen: 1, auto: false,
    stand: 0.035, move: 0.02, air: 0.12, fire: 0.0, recover: 0.3, kick: [0.07, 0.02],
    blurb: 'Close-range shotgun. Reloads the whole magazine at once.',
    sound: { freq: 480, decay: 0.3, gain: 0.85, thump: 65 },
  },
  xm1014: {
    name: 'XM1014', type: 'shotgun', slot: 'primary', team: 'both', price: 2000, reward: 600,
    damage: 20, pellets: 6, head: 4, armorPen: 0.8, rpm: 171, mag: 7, reserve: 32, reload: 0.6, reloadType: 'shell', deploy: 1.0,
    speed: 215, rangeMod: 0.7, pen: 1, auto: true,
    stand: 0.05, move: 0.03, air: 0.15, fire: 0.0, recover: 0.3,
    pattern: [[5, 0.03, 0.004], [3, 0.012, -0.012]],
    blurb: 'Automatic shotgun. Shreds anyone up close.',
    sound: { freq: 520, decay: 0.26, gain: 0.8, thump: 70 },
  },
  // ---------------- SMGs ----------------
  mac10: {
    name: 'MAC-10', type: 'smg', slot: 'primary', team: 'atk', price: 1050, reward: 600,
    damage: 29, head: 4, armorPen: 0.575, rpm: 800, mag: 30, reserve: 90, reload: 2.6, deploy: 1.0,
    speed: 240, rangeMod: 0.8, pen: 1, auto: true,
    stand: 0.008, move: 0.02, air: 0.1, fire: 0.006, recover: 0.35,
    pattern: [[5, 0.012, 0], [10, 0.006, 0.009]], sway: [0.035, 7, -1],
    blurb: 'Cheap and very accurate on the move. Weak against armour.',
    sound: { freq: 1400, decay: 0.08, gain: 0.42, thump: 160 },
  },
  mp9: {
    name: 'MP9', type: 'smg', slot: 'primary', team: 'def', price: 1250, reward: 600,
    damage: 26, head: 4, armorPen: 0.6, rpm: 857, mag: 30, reserve: 60, reload: 2.1, deploy: 1.2,
    speed: 240, rangeMod: 0.87, pen: 1, auto: true,
    stand: 0.007, move: 0.025, air: 0.05, fire: 0.006, recover: 0.33,
    pattern: [[4, 0.011, 0], [8, 0.007, -0.005]], sway: [0.022, 6, 1],
    blurb: 'Fastest fire rate. Unusually accurate while jumping.',
    sound: { freq: 1600, decay: 0.07, gain: 0.4, thump: 170 },
  },
  // ---------------- rifles ----------------
  galil: {
    name: 'Galil AR', type: 'rifle', slot: 'primary', team: 'atk', price: 1800, reward: 300,
    damage: 30, head: 4, armorPen: 0.775, rpm: 666, mag: 35, reserve: 140, reload: 3.0, deploy: 1.1,
    speed: 215, rangeMod: 0.98, pen: 2, auto: true,
    stand: 0.0035, move: 0.13, air: 0.33, fire: 0.008, recover: 0.4,
    pattern: [[5, 0.016, 0], [8, 0.01, -0.006]], sway: [0.03, 10, 1],
    blurb: 'Cheap rifle with a 35-round magazine.',
    sound: { freq: 950, decay: 0.12, gain: 0.55, thump: 115 },
  },
  ak47: {
    name: 'AK-47', type: 'rifle', slot: 'primary', team: 'atk', price: 2700, reward: 300,
    damage: 36, head: 4, armorPen: 0.775, rpm: 600, mag: 30, reserve: 90, reload: 2.5, deploy: 1.0,
    speed: 215, rangeMod: 0.98, pen: 2, auto: true,
    stand: 0.003, move: 0.14, air: 0.35, fire: 0.008, recover: 0.4,
    pattern: [[4, 0.02, 0], [8, 0.012, 0.006]], sway: [0.032, 9, -1],
    blurb: 'One headshot kills, even through a helmet.',
    sound: { freq: 850, decay: 0.14, gain: 0.6, thump: 105 },
  },
  m4a4: {
    name: 'M4A4', type: 'rifle', slot: 'primary', team: 'def', price: 2900, reward: 300,
    damage: 33, head: 4, armorPen: 0.7, rpm: 666, mag: 30, reserve: 120, reload: 3.1, deploy: 1.1,
    speed: 225, rangeMod: 0.97, pen: 2, auto: true,
    stand: 0.0028, move: 0.12, air: 0.33, fire: 0.007, recover: 0.38,
    pattern: [[4, 0.016, 0], [9, 0.009, -0.005]], sway: [0.024, 8, 1],
    blurb: 'Fast-firing defender rifle with a 30-round magazine.',
    sound: { freq: 1000, decay: 0.11, gain: 0.55, thump: 120 },
  },
  m4a1s: {
    name: 'M4A1-S', type: 'rifle', slot: 'primary', team: 'def', price: 2900, reward: 300,
    damage: 38, head: 3.475, armorPen: 0.7, rpm: 600, mag: 20, reserve: 60, reload: 3.1, deploy: 1.1,
    speed: 225, rangeMod: 0.94, pen: 2, auto: true, silenced: true,
    stand: 0.0025, move: 0.12, air: 0.33, fire: 0.007, recover: 0.36,
    pattern: [[4, 0.014, 0], [8, 0.008, 0.004]], sway: [0.018, 8, -1],
    blurb: 'Silenced and very accurate. Only 20 rounds.',
    sound: { freq: 1100, decay: 0.1, gain: 0.55, thump: 125 },
  },
  // ---------------- snipers ----------------
  ssg08: {
    name: 'SSG 08', type: 'sniper', slot: 'primary', team: 'both', price: 1700, reward: 300,
    damage: 88, head: 4, armorPen: 0.85, rpm: 48, mag: 10, reserve: 20, reload: 3.7, deploy: 1.0,
    speed: 230, rangeMod: 0.98, pen: 2.5, auto: false, alt: 'scope', zoom: [40, 15], bolt: true,
    stand: 0.05, scoped: 0.0006, move: 0.12, air: 0.035, fire: 0.0, recover: 0.3, kick: [0.05, 0.01],
    blurb: 'Light sniper. Deadly headshots and great accuracy in the air.',
    sound: { freq: 560, decay: 0.3, gain: 0.85, thump: 75 },
  },
  awp: {
    name: 'AWP', type: 'sniper', slot: 'primary', team: 'both', price: 4750, reward: 100,
    damage: 115, head: 4, armorPen: 0.975, rpm: 41, mag: 5, reserve: 10, reload: 3.7, deploy: 1.3,
    speed: 200, scopedSpeed: 100, rangeMod: 0.99, pen: 2.5, auto: false, alt: 'scope', zoom: [40, 10], bolt: true,
    stand: 0.09, scoped: 0.0003, move: 0.2, air: 0.5, fire: 0.0, recover: 0.3, kick: [0.07, 0.012],
    blurb: 'One body shot kills anywhere except the legs. Slow to rechamber.',
    sound: { freq: 380, decay: 0.45, gain: 1.0, thump: 55 },
  },
};

for (const [id, w] of Object.entries(WEAPONS)) {
  w.id = id;
  w.pellets = w.pellets || 1;
  w.interval = 60 / w.rpm;
  w.reloadType = w.reloadType || 'mag';
  w.scopedSpeed = w.scopedSpeed || w.speed;
  w.recoilPattern = w.auto ? makePattern(w) : null;
}

// ---------------- the bomb as a held item (never bought) ----------------
// The bomb, when you hold it in your hands (key 5). Only the carrier has it.
export const BOMB_ITEM = {
  id: 'c4', name: 'Bomb', type: 'bomb', slot: 'bomb', speed: TOP_SPEED, scopedSpeed: TOP_SPEED, deploy: 0.3,
  stand: 0, move: 0, air: 0, fire: 0, recover: 0.3,
};

// ---------------- the secret spoon (never bought, never dropped) ----------------
// A melee weapon that works like a CS knife. Only the player whose name is SPOON_OWNER gets one
// (the host decides: see `spoon` in server.js). It is deliberately NOT in WEAPONS, so it never
// shows up in the buy menu, on the floor or in account stats.
//   slash (fire): quick swings — `damage` on the first swing, `quick` on swings straight after it
//   stab (alt):   slow and short, hits much harder
//   `back`: damage when you hit someone from behind. Ranges in metres, times in seconds.
export const SPOON_OWNER = 'y1kes';
export const SPOON = {
  id: 'spoon', name: 'Spoon', type: 'melee', slot: 'melee', speed: TOP_SPEED, scopedSpeed: TOP_SPEED, deploy: 0.5,
  stand: 0, move: 0, air: 0, fire: 0, recover: 0.3, alt: 'stab', reward: 1500, armorPen: 0.85,
  slash: { damage: 40, quick: 25, back: 90, range: 48 * U, miss: 0.4, hit: 0.5 },
  stab: { damage: 65, quick: 65, back: 180, range: 32 * U, miss: 1.0, hit: 1.0 },
};
export function hasSpoon(name) { return String(name || '').trim().toLowerCase() === SPOON_OWNER; }

// Anything you can hold: a gun, the bomb or the spoon
export function itemDef(id) { return WEAPONS[id] || (id === 'c4' ? BOMB_ITEM : id === 'spoon' ? SPOON : null); }
export function itemName(id) {
  if (id === 'bomb') return 'bomb';
  const d = itemDef(id);
  return d ? d.name : String(id);
}

// Buy menu order (also keyboard order inside each group)
export const WEAPON_LIST = ['glock', 'usp', 'tec9', 'deagle', 'mac10', 'mp9', 'mag7', 'xm1014', 'galil', 'ak47', 'm4a4', 'm4a1s', 'ssg08', 'awp'];
export const BUY_GROUPS = [
  { name: 'Pistols', ids: ['glock', 'usp', 'tec9', 'deagle'] },
  { name: 'SMGs & shotguns', ids: ['mac10', 'mp9', 'mag7', 'xm1014'] },
  { name: 'Rifles', ids: ['galil', 'ak47', 'm4a4', 'm4a1s'] },
  { name: 'Snipers', ids: ['ssg08', 'awp'] },
];
export const STARTER_PISTOL = { atk: 'glock', def: 'usp' };

export const EQUIPMENT = {
  vest: { name: 'Kevlar vest', price: 650, team: 'both', blurb: 'Protects chest, stomach and arms.' },
  vesthelm: { name: 'Kevlar + helmet', price: 1000, team: 'both', blurb: 'Also protects your head.' },
  helmet: { name: 'Helmet', price: 350, team: 'both', blurb: 'Needs a full (100) vest.' },
  kit: { name: 'Defuse kit', price: 400, team: 'def', blurb: 'Defuse in 5 s instead of 10 s.' },
};

export const MONEY = {
  start: 800, max: 16000,
  win: { elim: 3250, time: 3250, bomb: 3500, defuse: 3500 },
  lossLadder: [1400, 1900, 2400, 2900, 3400],
  plantTeamBonus: 600, plantBonus: 300, defuseBonus: 300,
  teamkill: -300,
};

export function canTeamBuy(w, team) { return w.team === 'both' || w.team === team; }

// Running speed in metres per second for the gun in hand
export function runSpeed(w, scoped) { return (scoped ? w.scopedSpeed : w.speed) * U; }

// How much shoot-through cover (in metres) a bullet can cross
export function penMetres(w) { return w.pen * 1.2; }

// ---------- damage ----------
export const HITGROUP_MULT = { chest: 1, arms: 1, stomach: 1.25, legs: 0.75 };
export const HITGROUPS = ['head', 'chest', 'stomach', 'arms', 'legs'];

// Damage before armour: base × hitgroup × rangeMod ^ (distance / 500 units)
export function rawDamage(w, part, distMetres) {
  const mult = part === 'head' ? w.head : (HITGROUP_MULT[part] || 1);
  return w.damage * mult * Math.pow(w.rangeMod, distMetres / U / 500);
}

export function isArmored(part, armor, helmet) {
  if (armor <= 0 || part === 'legs') return false;
  return part !== 'head' || !!helmet;
}

// Split damage between health and armour. Returns { hp, armor } lost.
export function applyArmor(dmg, part, armor, helmet, armorPen) {
  if (!isArmored(part, armor, helmet)) return { hp: dmg, armor: 0 };
  let hp = dmg * armorPen;
  let ar = (dmg - hp) * 0.5;
  if (ar > armor) { hp = dmg - armor * 2; ar = armor; }
  return { hp, armor: ar };
}

// ---------- recoil ----------
// Fixed spray pattern: cumulative [yaw, pitch] offsets (radians) for each bullet.
// `pattern` segments: [shots, up per shot, sideways per shot]; `sway`: [amplitude, period, first direction].
function makePattern(w) {
  const out = [[0, 0]];
  let yaw = 0, pitch = 0;
  const segs = w.pattern || [[w.mag, 0.01, 0]];
  let n = 0;
  for (const [shots, up, side] of segs) {
    for (let i = 0; i < shots && out.length < w.mag; i++) { pitch += up; yaw += side; out.push([yaw, pitch]); n++; }
  }
  const [amp, period, dir] = w.sway || [0, 1, 1];
  const centre = yaw;
  for (let i = 0; out.length < w.mag; i++) {
    pitch += 0.0025 * Math.max(0, 1 - i / 12);
    yaw = centre + dir * amp * Math.sin((i + 1) / period * Math.PI * 2 * 0.5) + dir * amp * 0.25 * Math.sin((i + 1) / period * Math.PI * 3);
    out.push([yaw, pitch]);
  }
  return out;
}

// Interpolated pattern offset for a (fractional) bullet index
export function patternAt(w, idx) {
  const p = w.recoilPattern;
  if (!p || idx <= 0) return [0, 0];
  const i = Math.min(p.length - 1, Math.floor(idx));
  const j = Math.min(p.length - 1, i + 1);
  const k = idx - Math.floor(idx);
  return [p[i][0] + (p[j][0] - p[i][0]) * k, p[i][1] + (p[j][1] - p[i][1]) * k];
}

// ---------- buy-menu silhouettes (120×40 viewBox, original drawings) ----------
export const WEAPON_ICONS = {
  glock: '<path d="M30 12h56v8H70l-3 4h-6l-4 15H45l4-15h-8l-2-4h-9z"/><path d="M58 22h6v6h-6z" opacity=".6"/>',
  usp: '<path d="M14 14h20v-2h56v8H72l-3 4h-7l-4 15H46l4-15h-8l-2-4H34v-2H14z"/>',
  tec9: '<path d="M20 15h66v7H64l-3 5h-6v11h-8V27h-6l-3 5h-6l3-10H20z"/><path d="M50 27h6v12h-6z"/>',
  deagle: '<path d="M22 10h68v11H72l-4 4h-7l-5 15H42l5-15h-7l-3-4H22z"/><path d="M30 13h52v2H30z" opacity=".5"/>',
  mac10: '<path d="M34 14h52v9H72v15h-9V23h-9l-3 6h-7l2-6H34zM86 16h14v4H86z"/>',
  mp9: '<path d="M22 14h66v8h-8l-3 4h-6v12h-8V26h-9l-3 7h-7l3-11H22zM88 16h16v4H88z"/><path d="M6 15h16v3H6z"/>',
  mag7: '<path d="M8 14h86v8H76v5H62l-3 10h-9l3-10H40v-5H8z"/><path d="M60 22h10v12H60z"/><path d="M94 16h20v4H94z"/>',
  xm1014: '<path d="M4 17h38l6-3h72v7H50v5H40l-8 10H18l8-10H4z"/><path d="M56 21h40v4H56z"/>',
  galil: '<path d="M4 16h20v-2h70v7h20v3H94v3H72l-2 4h-7l-4 8h-8l4-12H42l-6 10H24l6-12H4z"/>',
  ak47: '<path d="M2 18h32l4-4h58v6h20v3H96v3H72l2 4-6 9h-8l4-9-2-4H46l-6 10H26l6-12H2z"/><path d="M42 12h14v2H42z"/>',
  m4a4: '<path d="M2 16h36v-3h6v-4h22v4h26v6h18v3H98v4H70v8h-8v-8H48l-6 10H28l6-12H2z"/>',
  m4a1s: '<path d="M2 16h36v-3h6v-4h22v4h22v6h30v4H88v3H70v8h-8v-8H48l-6 10H28l6-12H2z"/>',
  ssg08: '<path d="M4 20h44v-4h70v4H62v4H46l-6 10h-8l4-10H26l-6 10H10l4-10H4z"/><rect x="40" y="8" width="26" height="6" rx="3"/>',
  awp: '<path d="M2 20h46v-4h70v5H64v5H46l-6 9h-9l4-9H24l-8 10H6l6-11H2z"/><rect x="38" y="6" width="30" height="8" rx="4"/>',
  spoon: '<ellipse cx="94" cy="20" rx="20" ry="12"/><path d="M12 15.5h46l18 2v5l-18 2H12a4.5 4.5 0 0 1 0-9z"/>',
};
