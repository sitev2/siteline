// Keyboard + mouse (pointer lock) and multi-touch controls. Keys come from settings.keys (see keys.js).
import { reverseMap } from './keys.js';

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
    this.scoreHeld = false;
    this.pressed = new Set();     // one-shot actions consumed each frame
    this.touchMove = { x: 0, y: 0 };
    this.pointers = new Map();
    this.locked = false;
    this.enabled = true;
    this.handlers = [];
    this.onPauseRequest = null;
    this.bind();
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.handlers.push([target, type, fn, opts]);
  }

  destroy() {
    for (const [t, type, fn, opts] of this.handlers) t.removeEventListener(type, fn, opts);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  press(action) { this.pressed.add(action); }


  consume(action) {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  takeLook() {
    const r = [this.lookX, this.lookY];
    this.lookX = 0; this.lookY = 0;
    return r;
  }

  // let go of the mouse (for the buy menu) without opening the pause menu
  releaseForMenu() {
    if (document.pointerLockElement) { this.menuRelease = true; document.exitPointerLock(); }
  }

  requestLock() {
    if (this.settings.touch) return;
    const el = this.canvas;
    if (el.requestPointerLock && document.pointerLockElement !== el) {
      try {
        const p = el.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => { try { el.requestPointerLock(); } catch (e) { /* ignore */ } });
      } catch (e) { try { el.requestPointerLock(); } catch (e2) { /* ignore */ } }
    }
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
      if (act === 'score') { this.scoreHeld = true; return; }
      if (act === 'use') this.useHeld = true;
      if (act === 'walk') { this.walk = true; return; }
      if (!e.repeat) this.press(act);
    });
    this.on(window, 'keyup', (e) => {
      const act = actionOf(e.code);
      if (!act) return;
      if (MOVES.has(act)) { this.held.delete(act); this.updateMove(); return; }
      if (act === 'score') this.scoreHeld = false;
      if (act === 'use') this.useHeld = false;
      if (act === 'walk') this.walk = false;
    });
    this.on(window, 'blur', () => {
      this.held.clear(); this.fire = false; this.useHeld = false; this.scoreHeld = false; this.walk = false; this.updateMove();
    });

    // mouse
    this.on(this.canvas, 'mousedown', (e) => {
      if (!this.enabled || this.settings.touch) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.fire = true; this.press('click'); }
      if (e.button === 2) this.press('alt');
    });
    this.on(this.canvas, 'wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.press(e.deltaY > 0 ? 'next' : 'prev');
    }, { passive: false });
    this.on(window, 'mouseup', (e) => { if (e.button === 0) this.fire = false; });
    this.on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022 * this.settings.sens;
      // ignore the occasional huge jump some browsers report
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookX += e.movementX * s;
      this.lookY += e.movementY * s * (this.settings.invert ? -1 : 1);
    });
    this.on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked) {
        this.fire = false;
        if (this.menuRelease) this.menuRelease = false;
        else if (this.onPauseRequest) this.onPauseRequest();
      }
    });

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
