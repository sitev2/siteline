// White line icons used instead of emojis everywhere in the game (all drawn here, no image files).
// In HTML: <i data-icon="cart"></i> (filled in by fillIcons). In text from code: "Tap [[cart]] to buy"
// through iconHTML() / setIconText(), which escape everything else, so names and chat stay plain text.
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor" stroke="none"';
const L = (w) => `fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

const PATHS = {
  chat: `<path ${S} d="M4 5h16v11H10l-5 4v-4H4z"/>`,
  cart: `<path ${S} d="M3 4h2.5l2.2 10h10.1L20 7H6.4"/><circle ${S} cx="9" cy="19" r="1.4"/><circle ${S} cx="16.5" cy="19" r="1.4"/>`,
  // the bomb as it looks in the game: four blocks with a strap, the timer box on top (screen + keypad), wires
  bomb: `<rect ${L(1.6)} x="2" y="10.5" width="20" height="9.5" rx="1.2"/><path ${L(1.1)} d="M7 10.5v9.5M12 10.5v9.5M17 10.5v9.5"/>`
    + `<path ${F} d="M2 14.2h20v2.2H2z"/><rect ${F} x="10" y="4" width="10.5" height="6.5" rx=".7"/>`
    + `<path fill="#000" fill-opacity=".75" d="M11.3 5.3h5.6v1.9h-5.6zM11.4 8.3h1.4v1.1h-1.4zM13.6 8.3h1.4v1.1h-1.4zM15.8 8.3h1.4v1.1h-1.4zM18.1 5.3h1.2v4.1h-1.2z"/>`
    + `<path ${L(1.1)} d="M10 5.8c-3.4 0-4.8 1.7-4.8 4.7M10 8.2c-2 0-3 .9-3 2.3"/>`,
  blast: `<path ${S} d="M12 2.5l1.8 5.3 5-2.6-2.4 5 5.1 1.8-5.1 1.8 2.4 5-5-2.6-1.8 5.3-1.8-5.3-5 2.6 2.4-5-5.1-1.8 5.1-1.8-2.4-5 5 2.6z"/>`,
  spoon: `<ellipse ${S} cx="15.5" cy="8.5" rx="3.4" ry="4.8" transform="rotate(45 15.5 8.5)"/><path ${S} d="M12.8 11.2L4 20"/>`,
  wrench: `<path ${S} d="M15 3.5a5 5 0 0 0-4.7 6.7L3.8 16.7a1.9 1.9 0 0 0 2.7 2.7l6.5-6.5A5 5 0 0 0 19.7 8l-3 3-3-1-1-3 3-3a5 5 0 0 0-.7-.5z"/>`,
  search: `<circle ${S} cx="10.5" cy="10.5" r="6"/><path ${S} d="M15 15l5.5 5.5"/>`,
  light: `<path ${S} d="M6 3h12l-2.5 6h-7z"/><path ${S} d="M8.5 9h7v12h-7z"/><path ${S} d="M12 12.5v3"/>`,
  hand: `<path ${S} d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v6M17 12V9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.9-2.6l-2.8-4a1.5 1.5 0 0 1 2.4-1.8L8 14.5"/>`,
  moon: `<path ${S} d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>`,
  skull: `<path ${S} d="M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4.3 3 5.4V19h8v-3.6c1.8-1.1 3-3 3-5.4a7 7 0 0 0-7-7z"/><circle ${F} cx="9.3" cy="10.5" r="1.6"/><circle ${F} cx="14.7" cy="10.5" r="1.6"/><path ${S} d="M10.5 19v2M13.5 19v2"/>`,
  warn: `<path ${S} d="M12 3.5L2.5 20h19z"/><path ${S} d="M12 10v4.5M12 17.2v.3"/>`,
  swap: `<path ${S} d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5"/>`,
  reload: `<path ${S} d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4"/><path ${S} d="M18 2.5V7h-4.5"/>`,
  scope: `<circle ${S} cx="12" cy="12" r="7"/><path ${S} d="M12 2v6M12 16v6M2 12h6M16 12h6"/>`,
  burst: `<circle ${F} cx="5" cy="12" r="2.2"/><circle ${F} cx="12" cy="12" r="2.2"/><circle ${F} cx="19" cy="12" r="2.2"/>`,
  drop: `<path ${S} d="M12 3.5V15M7 10l5 5 5-5M5 20h14"/>`,
  jump: `<path ${S} d="M12 21V9M7 14l5-5 5 5M5 4h14"/>`,
  list: `<path ${S} d="M4 6h16M4 12h16M4 18h16"/>`,
  pause: `<path ${F} d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>`,
  plus: `<path ${F} d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>`,
  shield: `<path ${S} d="M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z"/>`,
  helmet: `<path ${S} d="M3.5 16a8.5 8.5 0 0 1 17 0z"/><path ${S} d="M12 7.5v4.5M2.5 16h19v2.5h-19z"/>`,
  star: `<path ${F} d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z"/>`,
};

export function icon(name) {
  const p = PATHS[name];
  return p ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>` : '';
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// plain text with [[name]] icon tokens → safe HTML
export function iconHTML(text) {
  return String(text == null ? '' : text).split(/(\[\[[a-z]+\]\])/).map(part => {
    const m = /^\[\[([a-z]+)\]\]$/.exec(part);
    return m && PATHS[m[1]] ? icon(m[1]) : esc(part);
  }).join('');
}

export function setIconText(el, text) { el.innerHTML = iconHTML(text); }

// <i data-icon="name"></i> → the icon
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
}
