// Rebindable keyboard controls. Each action maps to one key code (KeyboardEvent.code).
// Saved in settings.keys; anything missing falls back to the defaults below.

export const ACTIONS = [
  ['moveF', 'Move forward'], ['moveB', 'Move back'], ['moveL', 'Move left'], ['moveR', 'Move right'],
  ['jump', 'Jump'], ['walk', 'Walk quietly (sprint in the Backrooms)'],
  ['reload', 'Reload'], ['alt', 'Scope / burst mode'], ['use', 'Plant / defuse / pick up'],
  ['buy', 'Buy menu'], ['inspect', 'Inspect weapon (flashlight in the Backrooms)'], ['flashlight', 'Flashlight'], ['drop', 'Drop weapon'],
  ['chatAll', 'All chat'], ['chatTeam', 'Team chat'], ['note', 'Leave a note (Backrooms)'],
  ['w1', 'Main gun'], ['w2', 'Pistol'], ['w5', 'Bomb'],
  ['score', 'Scoreboard'], ['menu', 'Menu'],
];

export const DEFAULT_KEYS = {
  moveF: 'KeyW', moveB: 'KeyS', moveL: 'KeyA', moveR: 'KeyD',
  jump: 'Space', walk: 'ShiftLeft',
  reload: 'KeyR', alt: 'KeyQ', use: 'KeyE',
  buy: 'KeyB', inspect: 'KeyF', flashlight: 'KeyL', drop: 'KeyG',
  chatAll: 'KeyY', chatTeam: 'KeyU', note: 'KeyN',
  w1: 'Digit1', w2: 'Digit2', w5: 'Digit5',
  score: 'Tab', menu: 'Escape',
};

export function keyMap(keys) { return { ...DEFAULT_KEYS, ...(keys || {}) }; }

// code → action (both Shift keys walk, both Ctrl keys do the same if Ctrl is chosen, and so on)
export function reverseMap(keys) {
  const k = keyMap(keys), out = {};
  for (const [act, code] of Object.entries(k)) {
    if (!(act in DEFAULT_KEYS)) continue;      // left over from an older version of the game: ignore
    out[code] = act;
    const twin = code.replace(/Left$/, 'Right');
    if (twin !== code) out[twin] = out[twin] || act;
  }
  // slot 3 (the secret spoon) is not in the settings list; it only takes key 3 while nothing else uses it
  if (!out.Digit3) out.Digit3 = 'w3';
  return out;
}

const NAMES = {
  Space: 'Space', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace',
  ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Alt', AltRight: 'Right Alt', CapsLock: 'Caps Lock',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};
export function keyLabel(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}
