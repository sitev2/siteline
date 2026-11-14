// Phones held upright during a game: the game turns ITSELF sideways (owner's request: iPhones don't let a web page
// turn the screen, and Android only does when full screen). When a game is on (body.in-game) and the screen is
// portrait and phone-sized, body gets the class 'rot90' and style.css rotates the whole page 90°: you just turn the
// phone. Everything that reads screen positions or sizes goes through here, so it works the same either way:
//   viewW() / viewH()  - the size of the picture the game draws (landscape when turned)
//   toView(x, y)       - a touch / mouse point on the glass → a point in the (turned) page
//   viewRect(r)        - a getBoundingClientRect() → the same box in the page
// It also keeps the size classes on body that style.css uses instead of @media (a media query would see the
// upright screen, not the turned picture): vw760, vw700 (narrow), vh500, vh600 (short), land (wider than tall),
// and the CSS units --vw / --vh (1 % of the picture's width / height).
const body = () => document.body;

export const turned = () => !!(body() && body().classList.contains('rot90'));
// the glass's full height: Safari's innerHeight leaves out the strip its toolbar may use, which left an empty band
// at the end of the turned picture on iPhones; 100lvh (the largest the viewport gets) covers the whole screen
let probe = null;
function fullH() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:100vh;height:100lvh;visibility:hidden;pointer-events:none';
    document.documentElement.appendChild(probe);
  }
  return Math.max(innerHeight, probe.offsetHeight || 0);
}
let turnH = 0;      // the glass height used while turned (fullH, kept up to date by updateTurn)
export const viewW = () => (turned() ? turnH || innerHeight : innerWidth);
export const viewH = () => (turned() ? innerWidth : innerHeight);

// the page is rotated 90° clockwise about its top-left corner and moved right by the screen width:
// page (u, v) is drawn at glass (W - v, u), so glass (x, y) is page (y, W - x)
export function toView(x, y) { return turned() ? [y, innerWidth - x] : [x, y]; }
export function viewRect(r) {
  if (!turned()) return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  const [l, t] = toView(r.right, r.top), w = r.height, h = r.width;
  return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h };
}

export function updateTurn() {
  const b = body();
  if (!b) return;
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const want = b.classList.contains('in-game') && touch && innerHeight > innerWidth && innerWidth <= 820;
  if (want !== turned()) b.classList.toggle('rot90', want);
  if (want && (scrollX || scrollY)) scrollTo(0, 0);      // (iOS can leave the page nudged after turning)
  turnH = fullH();
  const root = document.documentElement.style;
  root.setProperty('--W', `${innerWidth}px`);
  root.setProperty('--H', `${turnH}px`);
  const w = viewW(), h = viewH();
  root.setProperty('--vw', `${w / 100}px`);
  root.setProperty('--vh', `${h / 100}px`);
  b.classList.toggle('vw760', w <= 760);
  b.classList.toggle('vw700', w <= 700);
  b.classList.toggle('vh500', h <= 500);
  b.classList.toggle('vh600', h <= 600);
  b.classList.toggle('land', w > h);
}

export function initTurn() {
  updateTurn();
  addEventListener('resize', updateTurn);
  addEventListener('orientationchange', () => { updateTurn(); setTimeout(updateTurn, 300); });
  // follow the game starting and ending (body.in-game)
  new MutationObserver(updateTurn).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
