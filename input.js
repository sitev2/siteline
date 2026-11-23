// Keyboard + mouse (pointer lock) and multi-touch controls. Keys come from settings.keys (see keys.js).
// Some embedded browsers / webviews refuse pointer lock on every click. Then the game falls back to
// "drag to look": hold the RIGHT mouse button and move the mouse (left still fires), and the optional
// keyboard turning keys (turnL / turnR / lookU / lookD in keys.js) work everywhere.
import { reverseMap } from './keys.js';

const TURN_RATE = 2.5;        // keyboard turning, radians a second at sensitivity 1
const TURN_KEYS = new Set(['turnL', 'turnR', 'lookU', 'lookD']);

export class Input {
  constructor(canvas, touchRoot, settings) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;
    this.settings = settings;
    this.held = new Set();        // movement actions held down
    this.move = { x: 0, y: 0 };
    this.lookX = 0; this.lookY = 0;
    this.fire = false;
    this.useHeld = false;
    this.walk = false;
    this.jumpHeld = false;        // the jump button held down (phones: sprint in the Backrooms)
    this.scoreHeld = false;
    this.pressed = new Set();     // one-shot actions consumed each frame
    this.touchMove = { x: 0, y: 0 };
    this.pointers = new Map();
    this.locked = false;
    this.lockUnavailable = false; // the browser refused pointer lock (cleared again once a lock works)
    this.everLocked = false;      // pointer lock has worked at least once in this game
    this.dragLook = false;        // (no lock) the right button is held down on the canvas: moving the mouse looks
    this.lastMouse = null;
    this.turn = new Set();        // keyboard turning keys held down
    this.enabled = true;
    this.handlers = [];
    this.onPauseRequest = null;
    this.onLockError = null;      // called when the browser refuses pointer lock (hud shows a one-time hint)
    this.bind();
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.handlers.push([target, type, fn, opts]);
  }

  destroy() {
    for (const [t, type, fn, opts] of this.handlers) t.removeEventListener(type, fn, opts);
    clearTimeout(this.lockErrTimer);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  press(action) { this.pressed.add(action); }


  consume(action) {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  // dt: seconds since the last frame, for keyboard turning (0 = just empty what the mouse gave)
  takeLook(dt = 0) {
    if (dt > 0 && this.turn.size && this.enabled) {
      const r = TURN_RATE * (this.settings.sens || 1) * dt, t = this.turn;
      this.lookX += ((t.has('turnR') ? 1 : 0) - (t.has('turnL') ? 1 : 0)) * r;
      this.lookY += ((t.has('lookD') ? 1 : 0) - (t.has('lookU') ? 1 : 0)) * r;
    }
    const r = [this.lookX, this.lookY];
    this.lookX = 0; this.lookY = 0;
    return r;
  }

  // let go of the mouse (for the buy menu) without opening the pause menu
  releaseForMenu() {
    if (document.pointerLockElement) { this.menuRelease = true; document.exitPointerLock(); }
  }

  // the mouse can turn the camera: locked, or (no lock here) dragging with the right button
  get mouseLook() { return this.locked || this.lockUnavailable; }

  lockFailed() {
    if (this.locked) return;
    this.lockUnavailable = true;
    // (tell the HUD a moment later, and only if the lock still isn't there: a refused first try is often
    //  followed by a plain one that works, e.g. where unadjustedMovement isn't supported)
    clearTimeout(this.lockErrTimer);
    this.lockErrTimer = setTimeout(() => { if (!this.locked && this.lockUnavailable && this.onLockError) this.onLockError(this.everLocked); }, 500);
  }

  requestLock() {
    if (this.settings.touch) return;
    const el = this.canvas;
    if (!el.requestPointerLock) { this.lockFailed(); return; }
    if (document.pointerLockElement === el) return;
    // (unadjustedMovement isn't supported everywhere: then try a plain lock. A refusal of that too ends up in
    //  lockFailed — from the promise or the document's pointerlockerror event, whichever the browser gives)
    const plain = () => {
      try { const q = el.requestPointerLock(); if (q && q.catch) q.catch(() => this.lockFailed()); } catch (e) { this.lockFailed(); }
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch (e) { plain(); }
  }

  updateMove() {
    let x = 0, y = 0;
    const k = this.held;
    if (k.has('moveF')) y += 1;
    if (k.has('moveB')) y -= 1;
    if (k.has('moveR')) x += 1;
    if (k.has('moveL')) x -= 1;
    x += this.touchMove.x; y += this.touchMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x; this.move.y = y;
  }

  bind() {
    const ARROWS = { ArrowUp: 'moveF', ArrowDown: 'moveB', ArrowLeft: 'moveL', ArrowRight: 'moveR' };
    const MOVES = new Set(['moveF', 'moveB', 'moveL', 'moveR']);
    const actionOf = (code) => reverseMap(this.settings.keys)[code] || ARROWS[code];
    this.on(window, 'keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Escape') this.press('escape');
      const act = actionOf(e.code);
      if (!act) return;
      // keep the browser from scrolling / switching focus / opening its own shortcuts
      if (e.code === 'Tab' || e.code === 'Space' || e.ctrlKey || /^Arrow/.test(e.code)) e.preventDefault();
      if (MOVES.has(act)) { this.held.add(act); this.updateMove(); return; }
      if (TURN_KEYS.has(act)) { this.turn.add(act); if (/^Page/.test(e.code)) e.preventDefault(); return; }
      if (act === 'score') { this.scoreHeld = true; return; }
      if (act === 'use') this.useHeld = true;
      if (act === 'walk') { this.walk = true; return; }
      if (!e.repeat) this.press(act);
    });
    this.on(window, 'keyup', (e) => {
      const act = actionOf(e.code);
      if (!act) return;
      if (MOVES.has(act)) { this.held.delete(act); this.updateMove(); return; }
      if (TURN_KEYS.has(act)) { this.turn.delete(act); return; }
      if (act === 'score') this.scoreHeld = false;
      if (act === 'use') this.useHeld = false;
      if (act === 'walk') this.walk = false;
    });
    this.on(window, 'blur', () => {
      this.held.clear(); this.turn.clear(); this.fire = false; this.useHeld = false; this.scoreHeld = false; this.walk = false; this.jumpHeld = false; this.runHeld = false; this.dragLook = false; this.updateMove();
    });

    // mouse
    this.on(this.canvas, 'mousedown', (e) => {
      if (!this.enabled || this.settings.touch) return;
      if (!this.locked) {
        // no lock yet: ask for it. Where the browser has refused it, keep asking (it may work later) but play on
        // without it: left fires as usual, the right button held down is "drag to look"
        this.requestLock();
        if (!this.lockUnavailable) return;
        if (e.button === 2) { this.dragLook = true; this.lastMouse = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
      }
      if (e.button === 0) { this.fire = true; this.press('click'); }
      if (e.button === 2) this.press('alt');
    });
    this.on(this.canvas, 'wheel', (e) => {
      if (!this.mouseLook || !this.enabled) return;
      e.preventDefault();
      this.press(e.deltaY > 0 ? 'next' : 'prev');
    }, { passive: false });
    this.on(window, 'mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.dragLook = false;
    });
    this.on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(document, 'mousemove', (e) => {
      if (!this.locked && !this.dragLook) return;
      let dx = e.movementX, dy = e.movementY;
      if (!this.locked) {
        // (some webviews report no movementX/Y without a lock: use how far the pointer moved instead)
        const last = this.lastMouse;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        if (!dx && !dy && last) { dx = e.clientX - last.x; dy = e.clientY - last.y; }
        if (!this.enabled || !(e.buttons & 2)) { if (!(e.buttons & 2)) this.dragLook = false; return; }
      }
      dx = dx || 0; dy = dy || 0;
      const s = 0.0022 * this.settings.sens;
      // ignore the occasional huge jump some browsers report
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
      this.lookX += dx * s;
      this.lookY += dy * s * (this.settings.invert ? -1 : 1);
    });
    this.on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) { this.lockUnavailable = false; this.everLocked = true; this.dragLook = false; }
      if (was && !this.locked) {
        this.fire = false;
        if (this.menuRelease) this.menuRelease = false;
        else if (this.onPauseRequest) this.onPauseRequest();
      }
    });
    this.on(document, 'pointerlockerror', () => this.lockFailed());

    // touch
    const root = this.touchRoot;
    const joy = root.querySelector('#joy');
    const knob = root.querySelector('#joy-knob');
    const R = 52;
    this.on(root, 'pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      const btn = e.target.closest('[data-act]');
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const info = { kind: 'look', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, btn: null };
      if (btn) {
        const act = btn.dataset.act;
        info.btn = btn; btn.classList.add('down');
        if (act === 'fire') { this.fire = true; this.press('click'); info.kind = 'look'; }
        else if (act === 'use') { this.useHeld = true; this.press('use'); info.kind = 'hold'; }
        else if (act === 'score') { this.scoreHeld = true; info.kind = 'hold'; }
        else if (act === 'jump') { this.jumpHeld = true; this.press('jump'); info.kind = 'hold'; }   // (held: sprint in the Backrooms)
        else if (act === 'inspect') { this.runHeld = true; this.press('inspect'); info.kind = 'hold'; }   // (held: sprint in the Poolrooms)
        else { this.press(act); info.kind = 'tap'; }
      } else if (e.clientX < window.innerWidth * 0.42 && ![...this.pointers.values()].some(p => p.kind === 'joy')) {
        info.kind = 'joy';
        joy.style.left = `${e.clientX}px`; joy.style.top = `${e.clientY}px`;
        joy.classList.add('active');
        knob.style.transform = 'translate(-50%,-50%)';
      }
      this.pointers.set(e.pointerId, info);
    }, { passive: false });
    this.on(root, 'pointermove', (e) => {
      const info = this.pointers.get(e.pointerId);
      if (!info) return;
      e.preventDefault();
      if (info.kind === 'joy') {
        let dx = e.clientX - info.ox, dy = e.clientY - info.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const dead = 0.12;
        let mx = dx / R, my = -dy / R;
        if (Math.hypot(mx, my) < dead) { mx = 0; my = 0; }
        this.touchMove.x = mx; this.touchMove.y = my;
        this.updateMove();
      } else if (info.kind === 'look') {
        const s = 0.0055 * this.settings.sens;
        this.lookX += (e.clientX - info.x) * s;
        this.lookY += (e.clientY - info.y) * s * (this.settings.invert ? -1 : 1);
        info.x = e.clientX; info.y = e.clientY;
      }
    }, { passive: false });
    const end = (e) => {
      const info = this.pointers.get(e.pointerId);
      if (!info) return;
      this.pointers.delete(e.pointerId);
      if (info.btn) {
        info.btn.classList.remove('down');
        const act = info.btn.dataset.act;
        if (act === 'fire') this.fire = [...this.pointers.values()].some(p => p.btn && p.btn.dataset.act === 'fire');
        if (act === 'use') this.useHeld = false;
        if (act === 'score') this.scoreHeld = false;
        if (act === 'jump') this.jumpHeld = false;
        if (act === 'inspect') this.runHeld = false;
      }
      if (info.kind === 'joy') {
        joy.classList.remove('active');
        this.touchMove.x = 0; this.touchMove.y = 0;
        this.updateMove();
      }
    };
    this.on(root, 'pointerup', end);
    this.on(root, 'pointercancel', end);
  }
}
