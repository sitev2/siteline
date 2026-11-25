// FPV drones: the game on your screen. Your drone (flown here, sent to the host ~25 times a second), the others
// (smoothed between the host's snapshots), the camera (from the drone, or behind it), a goggle-style display
// (OSD), the race on your side (the next gate, laps) and the controls: keyboard + mouse, a game controller or an
// RC radio over USB, and two touch sticks whose layout you choose (Settings → Drones).
import * as THREE from 'three';
import { loadDroneMap, spawnFor, gateRespawn } from './dronemaps.js';
import { makeDrone, stepDrone, FLIGHT_NAMES, DRONE, qrot, qmul, qaxis, qslerp, gateCross, droneHeading, qypr } from './dronephys.js';
import { buildDroneScene, paintGates, makeDroneModel, DRONE_COLORS } from './droneview.js';
import { buildMapScene } from './mapview.js';
import { PostFX } from './post.js';
import { resolveGraphics } from './graphics.js';
import { keyMap, keyLabel } from './keys.js';
import { radialTexture } from './textures.js';
import * as sfx from './audio.js';
import { icon } from './icons.js';

// ---------- the player's drone settings (settings.drone) ----------
export const STICK_MODES = {
  mode2: { lx: 'yaw', ly: 'thr', rx: 'roll', ry: 'pitch' },
  mode1: { lx: 'yaw', ly: 'pitch', rx: 'roll', ry: 'thr' },
  mode3: { lx: 'roll', ly: 'pitch', rx: 'yaw', ry: 'thr' },
  mode4: { lx: 'roll', ly: 'thr', rx: 'yaw', ry: 'pitch' },
};
export const DRONE_DEFAULTS = {
  fly: 'easy', cam: 'fpv', tilt: 20, fov: 90, sticks: 'mode2',
  axes: { lx: 'yaw', ly: 'thr', rx: 'roll', ry: 'pitch' }, inv: { lx: false, ly: false, rx: false, ry: false },
  spring: false, pad: 'pad', size: 1,
};
export function droneSettings(settings) {
  const d = settings.drone && typeof settings.drone === 'object' ? settings.drone : {};
  return { ...DRONE_DEFAULTS, ...d, axes: { ...DRONE_DEFAULTS.axes, ...(d.axes || {}) }, inv: { ...DRONE_DEFAULTS.inv, ...(d.inv || {}) } };
}
// which stick axis does what (the touch layout): { lx, ly, rx, ry } → 'thr' | 'yaw' | 'pitch' | 'roll' | 'none'
export function stickAxes(ds) { return ds.sticks === 'custom' ? ds.axes : STICK_MODES[ds.sticks] || STICK_MODES.mode2; }

const SEND_EVERY = 0.04;
const INTERP = 0.12;          // s behind the newest snapshot others are drawn at
const RESPAWN_AFTER = 1.6;    // s of "signal lost" after a crash
const fmt = (s) => { if (!(s >= 0)) return '--:--.--'; const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- input ----------
class DroneInput {
  constructor(game, canvas, root) {
    this.g = game; this.canvas = canvas; this.root = root;
    this.keys = new Set(); this.pressed = new Set();
    this.mx = 0; this.my = 0;               // mouse movement since the last frame
    this.k = { pitch: 0, roll: 0, yaw: 0, thr: 0 };     // keyboard sticks (eased)
    this.ms = { pitch: 0, roll: 0 };                    // the mouse as a stick (Angle mode)
    this.thrHeld = 0;                                   // touch throttle that stays where you leave it (-1…1)
    this.sticks = { l: null, r: null };                 // touches on the left / right half: { id, bx, by, x, y }
    this.handlers = [];
    this.locked = false;
    this.bind();
  }
  on(t, type, fn, o) { t.addEventListener(type, fn, o); this.handlers.push([t, type, fn, o]); }
  destroy() { for (const [t, type, fn, o] of this.handlers) t.removeEventListener(type, fn, o); if (document.pointerLockElement) document.exitPointerLock(); }
  requestLock() {
    if (this.g.settings.touch || !this.canvas.requestPointerLock) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* refused */ }
  }
  bind() {
    const K = () => keyMap(this.g.settings.keys);
    this.on(window, 'keydown', (e) => {
      // (typing in a box on screen: not flying. A menu's box left focused but hidden doesn't count)
      if (this.g.chatOpen || (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.offsetParent !== null)) return;
      const k = K();
      if (e.code === 'Space' || e.code === 'Tab' || /^Arrow|^Page/.test(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === k.menu) this.pressed.add('menu');
      else if (e.code === k.reload) this.pressed.add('reset');
      else if (e.code === 'KeyC') this.pressed.add('cam');
      else if (e.code === k.inspect) this.pressed.add('fly');
      else if (e.code === k.chatAll || e.code === 'Enter') this.pressed.add('chat');
      else if (e.code === k.score) this.keys.add('__board');
    });
    this.on(window, 'keyup', (e) => { this.keys.delete(e.code); if (e.code === K().score) this.keys.delete('__board'); });
    this.on(window, 'blur', () => { this.keys.clear(); this.endTouch('l'); this.endTouch('r'); });
    this.on(this.canvas, 'mousedown', () => { if (!this.locked) this.requestLock(); });
    this.on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
      this.mx += dx; this.my += dy;
    });
    this.on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked && !this.g.chatOpen && !this.menuRelease) this.pressed.add('menu');
      this.menuRelease = false;
    });
    // touch: two floating sticks (left / right half of the screen) and the buttons
    const root = this.root;
    this.on(root, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.g.settings.touch) return;
      const btn = e.target.closest('[data-fpv]');
      e.preventDefault();
      if (btn) { btn.classList.add('down'); setTimeout(() => btn.classList.remove('down'), 150); this.pressed.add(btn.dataset.fpv); return; }
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const side = e.clientX < window.innerWidth / 2 ? 'l' : 'r';
      if (this.sticks[side]) return;
      // a stick holding the throttle starts where the throttle is now (so touching it doesn't change it)
      const R = this.radius(), ax = this.g.axes(), v = this.heldValue(side, ax);
      this.sticks[side] = { id: e.pointerId, bx: e.clientX - v[0] * R, by: e.clientY + v[1] * R, x: v[0], y: v[1] };
      this.drawStick(side);
    }, { passive: false });
    this.on(root, 'pointermove', (e) => {
      for (const side of ['l', 'r']) {
        const s = this.sticks[side];
        if (!s || s.id !== e.pointerId) continue;
        e.preventDefault();
        const R = this.radius();
        let dx = (e.clientX - s.bx) / R, dy = -(e.clientY - s.by) / R;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        s.x = dx; s.y = dy;
        this.drawStick(side);
      }
    }, { passive: false });
    const end = (e) => { for (const side of ['l', 'r']) if (this.sticks[side] && this.sticks[side].id === e.pointerId) this.endTouch(side); };
    this.on(root, 'pointerup', end);
    this.on(root, 'pointercancel', end);
  }
  radius() { return 62 * (droneSettings(this.g.settings).size || 1); }
  // the knob's resting place when a stick is let go: the middle, except a throttle that stays put
  heldValue(side, ax) {
    const keep = this.g.keepThrottle();
    const vx = keep && ax[side + 'x'] === 'thr' ? this.thrHeld * (this.g.ds.inv[side + 'x'] ? -1 : 1) : 0;
    const vy = keep && ax[side + 'y'] === 'thr' ? this.thrHeld * (this.g.ds.inv[side + 'y'] ? -1 : 1) : 0;
    return [vx, vy];
  }
  endTouch(side) {
    const s = this.sticks[side];
    if (!s) return;
    const ax = this.g.axes();
    if (this.g.keepThrottle()) {
      if (ax[side + 'x'] === 'thr') this.thrHeld = s.x * (this.g.ds.inv[side + 'x'] ? -1 : 1);
      if (ax[side + 'y'] === 'thr') this.thrHeld = s.y * (this.g.ds.inv[side + 'y'] ? -1 : 1);
    }
    this.sticks[side] = null;
    this.drawStick(side);
  }
  drawStick(side) {
    const el = document.getElementById(`fpv-stick-${side}`);
    if (!el) return;
    const s = this.sticks[side], R = this.radius();
    el.style.setProperty('--r', `${R}px`);
    if (s) {
      el.classList.add('active');
      el.style.left = `${s.bx}px`; el.style.top = `${s.by}px`;
      el.firstElementChild.style.transform = `translate(calc(-50% + ${s.x * R}px), calc(-50% + ${-s.y * R}px))`;
    } else {
      el.classList.remove('active');
      el.style.left = ''; el.style.top = '';
      const v = this.heldValue(side, this.g.axes());
      el.firstElementChild.style.transform = `translate(calc(-50% + ${v[0] * R}px), calc(-50% + ${-v[1] * R}px))`;
    }
  }
  consume(a) { const h = this.pressed.has(a); this.pressed.delete(a); return h; }

  // the four sticks for this frame. mode: easy | angle | acro
  read(dt, mode) {
    const ds = this.g.ds, sens = this.g.settings.sens || 1, inv = this.g.settings.invert ? -1 : 1, K = keyMap(this.g.settings.keys);
    const out = { thr: 0, yaw: 0, pitch: 0, roll: 0, dYaw: 0, dPitch: 0, dRoll: 0 };
    const easy = mode === 'easy', hover = DRONE.hover;
    if (this.g.chatOpen || this.g.paused) { this.mx = this.my = 0; return easy ? out : { ...out, thr: this.g.me.f > 0.02 ? hover : 0 }; }
    // keyboard (eased, so a tap is gentle)
    const has = (c) => this.keys.has(c);
    const ease = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate * dt, rate * dt);
    const fwd = has(K.moveF), back = has(K.moveB), left = has(K.moveL), right = has(K.moveR);
    const up = has(K.jump), down = has(K.walk) || has('ShiftRight');
    const aU = has('ArrowUp'), aD = has('ArrowDown'), aL = has('ArrowLeft'), aR = has('ArrowRight');
    let kp, kr, ky, kt;
    if (easy) { kp = (fwd || aU ? 1 : 0) - (back || aD ? 1 : 0); kr = (right ? 1 : 0) - (left ? 1 : 0); ky = (aR ? 1 : 0) - (aL ? 1 : 0); kt = (up ? 1 : 0) - (down ? 1 : 0); }
    else {
      kp = (aU ? 1 : 0) - (aD ? 1 : 0); kr = (aR ? 1 : 0) - (aL ? 1 : 0); ky = (right ? 1 : 0) - (left ? 1 : 0);
      // throttle: W / Space = full, S / Shift = off, neither = about a hover (eased so a tap gives a little)
      kt = (fwd || up) ? 1 : (back || down) ? 0 : (this.g.me.ground ? (this.k.thr > hover * 0.9 ? hover * 1.05 : 0) : hover * 1.05);
    }
    this.k.pitch = ease(this.k.pitch, kp, easy ? 4 : 6); this.k.roll = ease(this.k.roll, kr, easy ? 4 : 6); this.k.yaw = ease(this.k.yaw, ky, 5);
    this.k.thr = ease(this.k.thr, kt, easy ? 6 : 2.6);
    out.pitch = this.k.pitch; out.roll = this.k.roll; out.yaw = this.k.yaw; out.thr = this.k.thr;
    // the mouse
    const mk = 0.0022 * sens;
    if (this.mx || this.my) {
      if (easy) out.dYaw = this.mx * mk;
      else if (mode === 'acro') { out.dRoll = this.mx * mk; out.dPitch = -this.my * mk * inv; }
      else { this.ms.roll = clamp(this.ms.roll + this.mx * mk * 1.6, -1, 1); this.ms.pitch = clamp(this.ms.pitch - this.my * mk * 1.6 * inv, -1, 1); }
    }
    this.mx = this.my = 0;
    if (mode === 'angle') {
      const k = Math.exp(-2.5 * dt); this.ms.roll *= k; this.ms.pitch *= k;
      out.roll = clamp(out.roll + this.ms.roll, -1, 1); out.pitch = clamp(out.pitch + this.ms.pitch, -1, 1);
    }
    // a game controller or an RC radio
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected || p.axes.length < 4) continue;
      const dz = (v) => (Math.abs(v) < 0.06 ? 0 : v);
      let yaw, thr, roll, pitch, abs = false;
      if (ds.pad === 'radio') { roll = dz(p.axes[0]); pitch = -dz(p.axes[1]); thr = p.axes[2]; yaw = dz(p.axes[3]); abs = true; }
      else { yaw = dz(p.axes[0]); thr = -dz(p.axes[1]); roll = dz(p.axes[2]); pitch = -dz(p.axes[3]); }
      for (const [i, a] of [[0, 'reset'], [3, 'cam'], [9, 'menu']]) { if (p.buttons[i] && p.buttons[i].pressed) { if (!this['pb' + i]) this.pressed.add(a); this['pb' + i] = true; } else this['pb' + i] = false; }
      if (Math.abs(yaw) + Math.abs(roll) + Math.abs(pitch) + Math.abs(thr) < 0.01 && !abs) continue;
      out.yaw = yaw || out.yaw; out.roll = roll || out.roll; out.pitch = pitch || out.pitch;
      if (easy) out.thr = abs ? thr : (thr || out.thr);
      else out.thr = abs ? (thr + 1) / 2 : thr > 0 ? hover + thr * (1 - hover) : thr < 0 ? hover * (1 + thr) : (this.g.me.air ? hover : out.thr);
      break;
    }
    // the touch sticks
    const ax = this.g.axes();
    let touched = false;
    for (const side of ['l', 'r']) {
      const s = this.sticks[side];
      for (const dir of ['x', 'y']) {
        const role = ax[side + dir];
        if (!role || role === 'none') continue;
        let v = s ? s[dir] : 0;
        if (s) touched = true;
        if (ds.inv[side + dir]) v = -v;
        if (role === 'thr') {
          if (!s && this.g.keepThrottle()) v = this.thrHeld;
          else if (s && this.g.keepThrottle()) this.thrHeld = v;
          if (!s && !this.g.keepThrottle()) continue;
          out.thr = easy ? v : this.g.keepThrottle() ? (v + 1) / 2 : v >= 0 ? hover + v * (1 - hover) : hover * (1 + v);
          touched = true;
        } else if (s) out[role] = clamp(v, -1, 1);
      }
    }
    if (this.g.settings.touch && !touched && !easy && !this.g.keepThrottle()) out.thr = this.g.me.air ? hover : 0;
    return out;
  }
}

// ---------- the game ----------
export class DroneGame {
  constructor({ transport, myId, roster, map, practice, settings, quality, isHost, onPause, fpv }) {
    this.transport = transport; this.myId = myId; this.practice = practice; this.settings = settings;
    this.isHost = isHost; this.onPause = onPause;
    this.mapId = map;
    this.fpvMode = true;
    this.running = true; this.paused = false; this.clock = 0;
    this.md = loadDroneMap(map);
    this.race = this.md.gates.length > 0;
    this.ds = droneSettings(settings);

    // ---- renderer ----
    const G = this.gfx = quality && typeof quality === 'object' ? quality : resolveGraphics(null, !!settings.touch);
    const usePost = G.ao || G.bloom || G.look || G.aa === 'fxaa';
    this.nativeAA = G.aa === 'msaa' && !usePost;
    this.renderer = new THREE.WebGLRenderer({ antialias: this.nativeAA, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(3, Math.min(window.devicePixelRatio || 1, 2) * (G.renderScale || 1))));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = G.shadows !== 'off';
    this.renderer.shadowMap.type = G.shadows === 'high' || G.shadows === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.post = usePost ? new PostFX(this.renderer, { ao: !!G.ao, bloom: !!G.bloom, fxaa: G.aa === 'fxaa', msaa: G.aa === 'msaa', look: !!G.look }) : null;
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'game-canvas';
    document.getElementById('stage').appendChild(this.canvas);
    this.scene = new THREE.Scene();
    // a soft sky-and-sun reflection for the metal and plastic of the drones
    const pm = new THREE.PMREMGenerator(this.renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: '#b8c4d0', side: THREE.BackSide })));
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: '#fff6e0', side: THREE.DoubleSide })); sp.position.set(3, 7, 2); sp.lookAt(0, 0, 0); env.add(sp);
    this.scene.environment = pm.fromScene(env, 0.04).texture; this.scene.environmentIntensity = 0.7;
    pm.dispose();
    this.buildScene();
    this.camera = new THREE.PerspectiveCamera(this.ds.fov, window.innerWidth / window.innerHeight, 0.03, this.far + 60);
    this.camera.rotation.order = 'YXZ';

    // ---- state ----
    this.roster = roster || [];
    this.raceSt = fpv || null;
    this.slot = this.slotOf(this.myId);
    const s = spawnFor(this.md, this.slot);
    this.me = makeDrone(s.x, s.y, s.z, s.yaw);
    this.me.ground = true;
    this.myModel = makeDroneModel(this.colorOf(this.myId));
    this.myModel.root.scale.setScalar(1.4);
    this.scene.add(this.myModel.root);
    this.remotes = new Map();
    this.n = 0;                    // gates passed in order so far (race)
    this.lastGateAt = -1;
    this.sendT = 0;
    this.camPos = new THREE.Vector3(s.x, s.y + 1, s.z + 3);
    this.shake = 0;
    this.fx = [];
    this.flightTime = 0;
    this.topSpeed = 0;
    this.raceSt = null;
    this.applyRace(fpv);

    // ---- screen ----
    this.root = document.getElementById('fpv');
    this.root.classList.remove('hidden');
    document.body.classList.add('fpv-mode');
    document.body.classList.toggle('touch', !!settings.touch);
    this.osd = document.getElementById('fpv-osd');
    this.octx = this.osd.getContext('2d');
    this.staticC = document.getElementById('fpv-static');
    this.sctx = this.staticC.getContext('2d');
    this.board = document.getElementById('fpv-board');
    this.feed = document.getElementById('fpv-feed');
    this.feed.innerHTML = '';
    for (const [id, name] of [['fpv-reset', 'reload'], ['fpv-cam', 'camera'], ['fpv-boardbtn', 'list'], ['fpv-chat', 'chat'], ['fpv-menu', 'pause']]) document.getElementById(id).innerHTML = icon(name);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();     // (a menu's box keeps no keys)
    this.input = new DroneInput(this, this.canvas, document.getElementById('fpv-touch'));
    this.input.drawStick('l'); this.input.drawStick('r');
    this.bindChat();
    this.tipUntil = 12;
    this.onResize = () => {
      const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      this.viewW = w; this.viewH = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      const k = Math.min(2, window.devicePixelRatio || 1);
      this.osd.width = Math.round(w * k); this.osd.height = Math.round(h * k);
      this.osdK = k;
    };
    this.onResize();
    window.addEventListener('resize', this.onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.onResize);

    // ---- sound ----
    const look = this.md.map ? this.md.map.look : null;
    sfx.setRoom(look ? (look.indoor ? 'industrial' : 'beach') : this.md.world.def.theme);
    sfx.startAmbience(look ? look.amb : this.md.world.def.theme, false, { x: this.md.size[0] / 2, z: this.md.size[1] / 2 }, Math.max(...this.md.size) * 0.5);
    this.voice = sfx.droneVoice(null);

    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.transport.send({ t: 'fpvReady' });
  }

  // ---------- the map's picture ----------
  buildScene() {
    const G = this.gfx;
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      if (this.mapGroup.userData.dispose) this.mapGroup.userData.dispose();
      this.mapGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    if (this.md.map) {
      const b = this.built = buildDroneScene(this.md, this.renderer, G);
      this.mapGroup = b.group; this.scene.fog = b.fog; this.far = b.far;
      this.sun = b.sun; this.sky = [b.sky]; this.gateViews = b.gateViews;
      this.mapUpdate = (dt, t) => b.update(dt, t);
    } else {
      // one of the game's other maps, drawn as in the rest of the game (daylight; the garage with its lights on)
      const b = this.built = buildMapScene(this.md.world, this.renderer, G, false);
      this.mapGroup = b.group; this.scene.fog = b.fog; this.far = b.far;
      this.sky = []; b.group.traverse(o => { if (o.userData.sky) this.sky.push(o); });
      const ud = b.group.userData;
      if (ud.setPower) ud.setPower(true);
      if (ud.setDoor) this.md.world.doors.forEach((d, i) => ud.setDoor(i, true, 1, true));
      this.gateViews = [];
      this.sun = null;
      this.mapUpdate = ud.update ? (dt) => ud.update(dt, 0, this.camera ? this.camera.position : new THREE.Vector3()) : null;
      this.water = this.md.world.def.theme === 'pool' && ud.preRender ? ud : null;
    }
    this.scene.add(this.mapGroup);
    if (this.camera) { this.camera.far = this.far + 60; this.camera.updateProjectionMatrix(); }
  }
  onLoaded() { this.loadedAt = performance.now(); }

  applyGraphics(G) {
    const old = this.gfx || {}, R = this.renderer;
    const changed = (k) => String(old[k]) !== String(G[k]);
    this.gfx = G;
    if (changed('renderScale')) R.setPixelRatio(Math.max(0.5, Math.min(3, Math.min(window.devicePixelRatio || 1, 2) * (G.renderScale || 1))));
    if (['ao', 'bloom', 'look', 'aa'].some(changed)) {
      if (this.post) this.post.dispose();
      const usePost = G.ao || G.bloom || G.look || G.aa === 'fxaa' || (G.aa === 'msaa' && !this.nativeAA);
      this.post = usePost ? new PostFX(R, { ao: !!G.ao, bloom: !!G.bloom, fxaa: G.aa === 'fxaa', msaa: G.aa === 'msaa', look: !!G.look }) : null;
    }
    if (changed('shadows')) { R.shadowMap.enabled = G.shadows !== 'off'; R.shadowMap.type = G.shadows === 'high' || G.shadows === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; }
    if (['shadows', 'textures', 'viewDistance', 'effects'].some(changed)) { this.buildScene(); this.paintedFor = null; this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  }

  // ---------- who is who ----------
  slotOf(id) { const s = this.raceSt && this.raceSt.slots; return s && Number.isInteger(s[id]) ? s[id] : Math.max(0, this.roster.findIndex(p => p.id === id)); }
  colorOf(id) { return DRONE_COLORS[this.slotOf(id) % DRONE_COLORS.length]; }
  nameOf(id) { const p = this.roster.find(q => q.id === id); return p ? p.name : '?'; }
  axes() { return stickAxes(this.ds); }
  keepThrottle() { return this.ds.fly !== 'easy' && !this.ds.spring; }
  get mode() { return this.ds.fly in FLIGHT_NAMES ? this.ds.fly : 'easy'; }

  // ---------- the race (the host decides; this screen follows) ----------
  applyRace(st) {
    if (!st) return;
    const was = this.raceSt;
    this.raceSt = st;
    this.raceAt = performance.now();
    if (st.slots && Number.isInteger(st.slots[this.myId]) && st.slots[this.myId] !== this.slot) this.slot = st.slots[this.myId];
    const mine = (st.racers || []).find(r => r[0] === this.myId);
    if (mine) {
      // the host's count of my gates: catch up if it is ahead, or go back if it turned a gate down
      if (mine[1] > this.n || (this.pendingGate && performance.now() - this.pendingGate > 1500 && mine[1] !== this.n)) { this.n = mine[1]; this.pendingGate = 0; }
      if (mine[1] === this.n) this.pendingGate = 0;
      this.finished = mine[2] != null;
    }
    // a new race: everyone back on the pads
    if (was && st.ph === 'count' && was.ph !== 'count') this.toPad();
    if (st.ph === 'count' && (!was || was.ph !== 'count')) { this.n = 0; this.finished = false; this.lastCount = null; }
    if (st.ph === 'race' && was && was.ph === 'count') { sfx.playMG('go'); this.goFlash = 1.2; }
  }
  raceTime() {
    const st = this.raceSt;
    if (!st || st.t == null) return 0;
    return st.ph === 'race' ? st.t + (performance.now() - this.raceAt) / 1000 : st.t;
  }
  locked() { const st = this.raceSt; return !!(st && (st.ph === 'wait' || st.ph === 'count')); }

  toPad() {
    const s = spawnFor(this.md, this.slot);
    this.place(s);
  }
  place(s) {
    const d = this.me;
    d.p = [s.x, s.y, s.z]; d.v = [0, 0, 0]; d.w = [0, 0, 0];
    d.q = qaxis(0, 1, 0, s.yaw); d.hd = s.yaw; d.crashed = 0; d.f = s.air ? DRONE.hover : 0; d.air = !!s.air; d.ground = !s.air;
    this.input.thrHeld = s.air ? DRONE.hover * 2 - 1 : -1;
    this.input.k.thr = s.air ? DRONE.hover : 0;
    this.crashAt = 0;
    this.prevP = [...d.p];
    this.input.drawStick('l'); this.input.drawStick('r');
  }
  respawn() {
    // in a race: just past the last gate you got through, facing the next one; otherwise back on your pad
    if (this.race && this.n > 0 && !this.locked()) this.place(gateRespawn(this.md, (this.n - 1) % this.md.gates.length));
    else this.toPad();
    this.transport.send({ t: 'reset' });
  }

  // ---------- messages from the host ----------
  onMessage(m) {
    switch (m.t) {
      case 'roster':
        this.roster = m.roster;
        for (const [id, r] of this.remotes) if (!this.roster.some(p => p.id === id)) this.dropRemote(id, r);
        return;
      case 'dsnap': {
        const now = performance.now() / 1000;
        for (const e of m.d) {
          const id = e[0];
          if (id === this.myId) continue;
          let r = this.remotes.get(id);
          if (!r) r = this.addRemote(id);
          r.buf.push([now, [e[1], e[2], e[3]], [e[4], e[5], e[6], e[7]], e[8] / 100, e[9]]);
          if (r.buf.length > 12) r.buf.shift();
          r.seen = now;
        }
        return;
      }
      case 'fpv': this.applyRace(m.s); return;
      case 'fpvfx': return this.onFx(m);
      case 'chat':
        if (this.settings.showChat !== false) this.feedLine(`${m.name}: ${m.text}`, '#fff');
        sfx.playClick();
        return;
    }
  }
  addRemote(id) {
    const model = makeDroneModel(this.colorOf(id), this.nameOf(id));
    model.root.scale.setScalar(1.6);
    this.scene.add(model.root);
    const r = { id, model, buf: [], voice: null, spin: 0, f: 0, p: new THREE.Vector3(), seen: 0 };
    this.remotes.set(id, r);
    return r;
  }
  dropRemote(id, r) {
    this.scene.remove(r.model.root);
    if (r.voice) r.voice.stop();
    this.remotes.delete(id);
  }
  onFx(m) {
    const pos = m.x != null ? { x: m.x, y: m.y, z: m.z } : null;
    if (m.k === 'crash' && m.id !== this.myId) { if (pos) { this.burst(pos, m.w); sfx.playDrone(m.w ? 'bump' : 'crash', pos); if (m.w) sfx.playPool('splash', pos, 0, 0.6); } }
    else if (m.k === 'gate' && m.id !== this.myId) { /* others' gates: shown in the standings */ }
    else if (m.k === 'lap') { if (m.id !== this.myId) this.feedLine(`${this.nameOf(m.id)}: lap ${m.lap} in ${fmt(m.time)}${m.best ? ' (best)' : ''}`, '#9fd8ff'); }
    else if (m.k === 'finish') {
      this.feedLine(m.id === this.myId ? `You finished ${ord(m.pos)} — ${fmt(m.time)}` : `${this.nameOf(m.id)} finished ${ord(m.pos)} — ${fmt(m.time)}`, '#ffd36a');
      if (m.id === this.myId) { sfx.playDrone('finish'); this.finished = true; this.bigText = { text: ord(m.pos).toUpperCase(), sub: fmt(m.time), until: this.clock + 4 }; }
    } else if (m.k === 'reject' && m.id === this.myId) { this.n = m.n; this.pendingGate = 0; }
    else if (m.k === 'ends') this.feedLine(`The race ends in ${Math.round(m.s)} seconds`, '#ffd36a');
  }

  // ---------- chat ----------
  bindChat() {
    const box = document.getElementById('chat-box'), input = document.getElementById('chat-input');
    this.chatHandlers = {
      submit: (e) => { e.preventDefault(); const text = input.value.trim(); if (text) this.transport.send({ t: 'chat', text: text.slice(0, 100) }); this.closeChat(); },
      key: (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeChat(); } e.stopPropagation(); },
      close: () => this.closeChat(),
    };
    box.addEventListener('submit', this.chatHandlers.submit);
    input.addEventListener('keydown', this.chatHandlers.key);
    document.getElementById('chat-close').addEventListener('click', this.chatHandlers.close);
    document.getElementById('chat-mode').classList.add('hidden');
  }
  openChat() {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.input.keys.clear();
    if (document.pointerLockElement) { this.input.menuRelease = true; document.exitPointerLock(); }
    const box = document.getElementById('chat-box'), input = document.getElementById('chat-input');
    box.classList.remove('hidden'); input.value = ''; input.placeholder = 'Say something…'; input.focus();
    setTimeout(() => input.focus(), 0);
  }
  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    document.getElementById('chat-box').classList.add('hidden');
    document.getElementById('chat-input').blur();
    if (!this.settings.touch && !this.paused) this.input.requestLock();
  }
  feedLine(text, color) {
    const el = document.createElement('div');
    el.textContent = text; el.style.color = color;
    this.feed.appendChild(el);
    while (this.feed.children.length > 6) this.feed.firstChild.remove();
    setTimeout(() => el.remove(), 9000);
  }

  // ---------- effects ----------
  burst(p, water) {
    const n = this.gfx.effects === 'low' ? 6 : 14;
    if (!this.sparkTex) this.sparkTex = radialTexture('rgba(255,230,170,1)', 'rgba(255,140,40,0)');
    if (!this.smokeTex) this.smokeTex = radialTexture('rgba(90,90,90,0.7)', 'rgba(90,90,90,0)');
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: water ? this.smokeTex : this.sparkTex, transparent: true, depthWrite: false, blending: water ? THREE.NormalBlending : THREE.AdditiveBlending, color: water ? '#dff4ff' : '#ffffff' }));
      s.position.set(p.x, p.y, p.z); s.scale.setScalar(0.12);
      this.scene.add(s);
      this.fx.push({ s, v: [(Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6], life: 0.5 + Math.random() * 0.4, t: 0, g: 12 });
    }
    const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }));
    smoke.position.set(p.x, p.y, p.z); smoke.scale.setScalar(0.4); this.scene.add(smoke);
    this.fx.push({ s: smoke, v: [0, 0.8, 0], life: 2.2, t: 0, g: -0.2, grow: 1.6 });
  }
  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      f.v[1] -= f.g * dt;
      f.s.position.x += f.v[0] * dt; f.s.position.y += f.v[1] * dt; f.s.position.z += f.v[2] * dt;
      if (f.grow) f.s.scale.setScalar(0.4 + f.t * f.grow);
      f.s.material.opacity = Math.max(0, 1 - f.t / f.life);
      if (f.t >= f.life) { this.scene.remove(f.s); f.s.material.dispose(); this.fx.splice(i, 1); }
    }
  }

  // ---------- each frame ----------
  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (this.gfx.fpsCap && now - this.last < 1000 / this.gfx.fpsCap - 1.5) return;
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.clock += dt;
    this.ds = droneSettings(this.settings);
    this.sizeCheck = (this.sizeCheck || 0) - dt;
    if (this.sizeCheck <= 0) { this.sizeCheck = 0.3; if (window.innerWidth !== this.viewW || window.innerHeight !== this.viewH) this.onResize(); }
    this.buttons();
    this.fly(dt);
    this.send(dt);
    this.updateRemotes(dt);
    this.updateFx(dt);
    this.updateCamera(dt);
    if (this.mapUpdate) this.mapUpdate(dt, this.clock);
    if (this.gateViews && this.gateViews.length) paintGates(this.gateViews, this.race ? this.n % this.md.gates.length : -1, this.clock);
    const skyK = (this.camera.far * 0.9) / 500;
    for (const s of this.sky) { s.position.copy(this.camera.position); s.scale.setScalar(skyK); }
    // the sun's shadow box follows the camera
    if (this.sun && this.sun.castShadow) {
      const c = this.camera.position, d = this.sun.userData.dir;
      this.sun.target.position.set(Math.round(c.x / 4) * 4, Math.round(c.y / 4) * 4, Math.round(c.z / 4) * 4);
      this.sun.position.copy(this.sun.target.position).addScaledVector(d, 150);
    }
    if (this.water) { this.water.setBlobs([]); this.water.preRender(this.renderer, this.scene, this.camera); }
    if (this.post) this.post.render(this.scene, this.camera);
    else { this.renderer.setRenderTarget(null); this.renderer.clear(); this.renderer.render(this.scene, this.camera); }
    this.drawOsd(dt);
    this.drawStatic(dt);
  }

  buttons() {
    const I = this.input;
    if (I.consume('menu')) { if (this.chatOpen) this.closeChat(); else if (this.onPause) this.onPause(); }
    if (this.paused) return;
    if (I.consume('reset')) this.respawn();
    if (I.consume('cam')) { this.settings.drone = { ...this.ds, cam: this.ds.cam === 'fpv' ? 'chase' : 'fpv' }; this.ds = droneSettings(this.settings); this.feedLine(this.ds.cam === 'fpv' ? 'Camera: FPV' : 'Camera: behind the drone', '#cfd8e0'); }
    if (I.consume('fly')) {
      const order = ['easy', 'angle', 'acro'], next = order[(order.indexOf(this.mode) + 1) % 3];
      this.settings.drone = { ...this.ds, fly: next }; this.ds = droneSettings(this.settings);
      this.setFly(next);
    }
    if (I.consume('chat')) this.openChat();
    if (I.consume('board')) this.boardOpen = !this.boardOpen;
  }
  setFly(mode) {
    const d = this.me;
    d.hd = droneHeading(d.q);
    this.input.k.thr = mode === 'easy' ? 0 : d.air ? DRONE.hover : 0;
    if (mode !== 'easy' && this.keepThrottle()) this.input.thrHeld = d.air ? DRONE.hover * 2 - 1 : -1;
    this.feedLine(`Flight mode: ${FLIGHT_NAMES[mode]}`, '#cfd8e0');
    this.tipUntil = this.clock + 8;
    this.input.drawStick('l'); this.input.drawStick('r');
  }

  fly(dt) {
    const d = this.me, mode = this.mode;
    const inp = this.input.read(dt, mode);
    inp.lock = this.locked();
    if (inp.lock) { inp.thr = mode === 'easy' ? 0 : 0; }
    const before = [...d.p];
    const ev = stepDrone(d, inp, dt, mode, this.md.col, this.clock);
    // gates (race): the straight line from where it was to where it is now
    if (this.race && !d.crashed && !this.locked() && !this.finished && this.raceSt && (this.raceSt.ph === 'race')) {
      const G = this.md.gates, g = G[this.n % G.length];
      if (gateCross(g, before, d.p, 0.2)) this.passGate();
    }
    if (ev.crash) {
      this.crashAt = this.clock;
      this.shake = 1;
      this.burst({ x: ev.crash.x, y: ev.crash.y, z: ev.crash.z }, ev.crash.water);
      sfx.playDrone('crash', null, 0.8);
      if (ev.crash.water) sfx.playPool('splash', null, 0, 0.7);
      sfx.playDrone('static', null, 0.6);
      this.transport.send({ t: 'crash', x: r2(ev.crash.x), y: r2(ev.crash.y), z: r2(ev.crash.z), w: ev.crash.water ? 1 : 0 });
      if (navigator.vibrate && this.settings.touch) { try { navigator.vibrate(60); } catch (e) { /* not allowed */ } }
    } else if (ev.bump) { this.shake = Math.min(1, this.shake + ev.bump / 10); sfx.playDrone('bump', null, Math.min(1, ev.bump / 6)); }
    if (d.crashed) { d.crashed += dt; if (d.crashed > RESPAWN_AFTER) this.respawn(); }
    const speed = Math.hypot(d.v[0], d.v[1], d.v[2]);
    if (d.air && !d.crashed) { this.flightTime += dt; this.topSpeed = Math.max(this.topSpeed, speed); }
    if (this.voice) this.voice.set(d.f, speed, null);
    sfx.setListener(d.p[0], d.p[1], d.p[2], d.hd, 0);
    this.myModel.root.position.set(d.p[0], d.p[1], d.p[2]);
    this.myModel.root.quaternion.set(d.q[0], d.q[1], d.q[2], d.q[3]);
    this.myModel.animate(d.f, d.spin, 3);
    this.myModel.glow.visible = false;
  }
  passGate() {
    const G = this.md.gates.length;
    this.n++;
    this.pendingGate = performance.now();
    this.transport.send({ t: 'gate', n: this.n });
    const lapDone = this.n > 1 && (this.n - 1) % G === 0;
    const laps = (this.raceSt && this.raceSt.laps) || 3;
    if (lapDone && (this.n - 1) / G >= laps) sfx.playDrone('lap');
    else sfx.playDrone(lapDone ? 'lap' : 'gate');
    this.gateFlash = 0.25;
  }

  send(dt) {
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = SEND_EVERY;
    const d = this.me;
    this.transport.send({ t: 'ds', s: [r2(d.p[0]), r2(d.p[1]), r2(d.p[2]), r3(d.q[0]), r3(d.q[1]), r3(d.q[2]), r3(d.q[3]), Math.round(d.f * 100), (d.crashed ? 1 : 0) | (d.armed ? 2 : 0)] });
  }

  updateRemotes(dt) {
    const now = performance.now() / 1000, rt = now - INTERP;
    const cam = this.camera.position;
    let voices = 0;
    const list = [...this.remotes.values()].sort((a, b) => a.p.distanceToSquared(cam) - b.p.distanceToSquared(cam));
    for (const r of list) {
      if (now - r.seen > 3) { r.model.root.visible = false; if (r.voice) { r.voice.stop(); r.voice = null; } continue; }
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) if (b[i][0] <= rt && b[i + 1][0] >= rt) { a = b[i]; c = b[i + 1]; break; }
      const t = c[0] > a[0] ? clamp((rt - a[0]) / (c[0] - a[0]), 0, 1) : 1;
      const p = [a[1][0] + (c[1][0] - a[1][0]) * t, a[1][1] + (c[1][1] - a[1][1]) * t, a[1][2] + (c[1][2] - a[1][2]) * t];
      const q = qslerp(a[2], c[2], t);
      r.f = a[3] + (c[3] - a[3]) * t;
      r.p.set(p[0], p[1], p[2]);
      r.model.root.visible = true;
      r.model.root.position.copy(r.p);
      r.model.root.quaternion.set(q[0], q[1], q[2], q[3]);
      r.spin = (r.spin + (0.3 + r.f * 6) * dt * 40) % (Math.PI * 2);
      const dist = r.p.distanceTo(cam);
      r.model.animate(r.f, r.spin, dist);
      // only the nearest few are heard (phones)
      if (voices < 4 && dist < 120) {
        voices++;
        if (!r.voice) r.voice = sfx.droneVoice({ x: p[0], y: p[1], z: p[2] });
        if (r.voice) r.voice.set(c[4] & 1 ? 0 : r.f, 0, { x: p[0], y: p[1], z: p[2] });
      } else if (r.voice) { r.voice.stop(); r.voice = null; }
    }
  }

  updateCamera(dt) {
    const d = this.me, cam = this.camera;
    const fov = clamp(this.ds.fov || 90, 60, 120);
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * 0.04;
    if (this.ds.cam === 'chase') {
      // behind and a little above, along the way it is heading
      const hd = d.hd, back = new THREE.Vector3(Math.sin(hd), 0, Math.cos(hd));
      const want = new THREE.Vector3(d.p[0], d.p[1], d.p[2]).addScaledVector(back, 1.6).add(new THREE.Vector3(0, 0.5, 0));
      // don't end up inside a wall
      for (let k = 0; k < 6 && !this.md.col.free(want.x, want.y, want.z, 0.15); k++) want.lerp(new THREE.Vector3(d.p[0], d.p[1] + 0.3, d.p[2]), 0.3);
      this.camPos.lerp(want, 1 - Math.exp(-10 * dt));
      cam.position.copy(this.camPos);
      cam.lookAt(d.p[0] - back.x * 3, d.p[1] + 0.2, d.p[2] - back.z * 3);
      this.myModel.root.visible = true;
    } else {
      const tilt = (this.mode === 'easy' ? 0.45 : 1) * clamp(this.ds.tilt ?? 20, 0, 50) * Math.PI / 180;
      const q = qmul(d.q, qaxis(1, 0, 0, tilt));
      const off = qrot(d.q, [0, 0.03, -0.06]);
      cam.position.set(d.p[0] + off[0], d.p[1] + off[1], d.p[2] + off[2]);
      cam.quaternion.set(q[0], q[1], q[2], q[3]);
      // a little vibration from the motors (the "jello" of a real FPV camera), more after a hit
      const j = (d.f > 0.05 ? 0.0012 * d.f : 0) + sh * 0.3;
      if (j > 0) { cam.rotateX((Math.random() - 0.5) * j); cam.rotateZ((Math.random() - 0.5) * j); }
      this.myModel.root.visible = false;
    }
    if (sh > 0 && this.ds.cam === 'chase') cam.position.add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
  }

  // ---------- the goggles' display (OSD) ----------
  drawOsd(dt) {
    const c = this.octx, k = this.osdK, W = this.osd.width / k, H = this.osd.height / k, d = this.me;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.clearRect(0, 0, W, H);
    const big = Math.max(13, Math.min(20, H / 34));
    c.font = `700 ${big}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    const txt = (s, x, y, align = 'left', col = '#ffffff', size = big) => {
      c.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      c.textAlign = align; c.lineWidth = Math.max(2.5, size / 5); c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y);
    };
    const touch = !!this.settings.touch;
    const top = touch ? 74 : 26;
    const speed = Math.hypot(d.v[0], d.v[1], d.v[2]) * 3.6;
    const alt = d.p[1] - this.md.col.heightAt(d.p[0], d.p[2]);
    // corners: flight mode + throttle, speed + height
    txt(`${FLIGHT_NAMES[this.mode].toUpperCase()}${this.ds.cam === 'chase' ? '  CAM' : ''}`, 18, top, 'left', '#9fd8ff');
    txt(`THR ${String(Math.round(d.f * 100)).padStart(3)}%`, 18, top + big * 1.4);
    txt(`${String(Math.round(speed)).padStart(3)} KM/H`, W - 18, top, 'right');
    txt(`ALT ${alt.toFixed(1)} M`, W - 18, top + big * 1.4, 'right');
    // the throttle bar with the hover mark (not in Easy, where the height holds itself)
    if (this.mode !== 'easy') {
      const bx = 18, by = top + big * 2.6, bh = Math.min(140, H * 0.22);
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; c.strokeRect(bx, by, 10, bh);
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(bx + 2, by + bh - 2 - (bh - 4) * d.f, 6, (bh - 4) * d.f);
      c.fillStyle = '#f0a040'; c.fillRect(bx - 4, by + bh - 2 - (bh - 4) * DRONE.hover - 1, 18, 2);
    }
    // the middle: a small cross, and an artificial horizon line
    const cx = W / 2, cy = H / 2;
    if (this.ds.cam === 'fpv' && !d.crashed) {
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - 9, cy); c.lineTo(cx - 3, cy); c.moveTo(cx + 3, cy); c.lineTo(cx + 9, cy); c.moveTo(cx, cy - 7); c.lineTo(cx, cy - 3); c.stroke();
      const up = qrot(d.q, [0, 1, 0]), rt = qrot(d.q, [1, 0, 0]);
      const roll = Math.atan2(rt[1], up[1]);
      c.save(); c.translate(cx, cy); c.rotate(roll);
      c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-90, 0); c.lineTo(-40, 0); c.moveTo(40, 0); c.lineTo(90, 0); c.stroke();
      c.restore();
    }
    // the race
    const st = this.raceSt, G = this.md.gates.length;
    if (this.race && st) {
      const laps = st.laps || 3, lap = this.n === 0 ? 1 : Math.min(laps, Math.floor((this.n - 1) / G) + 1);
      const racers = st.racers || [];
      const pos = racers.findIndex(r => r[0] === this.myId) + 1;
      const bottom = H - (touch ? 30 : 34);
      txt(`LAP ${lap}/${laps}`, cx - 110, bottom, 'center');
      txt(fmt(st.ph === 'race' || st.ph === 'done' ? this.raceTime() : 0), cx, bottom, 'center', '#ffffff', big * 1.2);
      if (pos) txt(`P${pos}/${racers.length}`, cx + 110, bottom, 'center', pos === 1 ? '#ffd36a' : '#ffffff');
      const mine = racers.find(r => r[0] === this.myId);
      if (mine && mine[3] != null) txt(`BEST ${fmt(mine[3])}`, cx, bottom - big * 1.5, 'center', '#9fd8ff', big * 0.85);
      // the next gate: a box round it on screen, or an arrow at the edge pointing to it
      if (!this.finished && st.ph !== 'done') this.drawGateMark(c, W, H, this.md.gates[this.n % G], txt, big);
      // the standings (always while racing, short)
      const rows = racers.slice(0, 6);
      let y = H * 0.32;
      if (!touch || this.boardOpen || this.input.keys.has('__board')) {
        for (const r of rows) {
          const name = this.nameOf(r[0]).slice(0, 10), fin = r[2] != null;
          txt(`${racers.indexOf(r) + 1}. ${name}`, 18, y, 'left', r[0] === this.myId ? '#ffd36a' : '#ffffff', big * 0.8);
          txt(fin ? fmt(r[2]) : `L${Math.min(laps, Math.floor(Math.max(0, r[1] - 1) / G) + 1)}`, 18 + big * 9.5, y, 'left', fin ? '#5ae07a' : '#cfd8e0', big * 0.8);
          y += big * 1.15;
        }
      }
      // countdown
      if (st.ph === 'wait') txt('WAITING FOR PILOTS…', cx, cy - H * 0.18, 'center', '#ffffff', big * 1.2);
      if (st.ph === 'count') {
        const left = Math.max(0, st.cd - (performance.now() - this.raceAt) / 1000), n = Math.ceil(left);
        if (n !== this.lastCount && n > 0 && n <= 3) { sfx.playMG('count'); this.lastCount = n; }
        if (n >= 1) txt(n > 3 ? 'GET READY' : String(n), cx, cy - H * 0.16, 'center', '#ffd36a', n > 3 ? big * 1.8 : big * 4);
        txt(`${laps} LAP${laps > 1 ? 'S' : ''} · ${G} GATES`, cx, cy - H * 0.16 + big * 3.2, 'center', '#ffffff', big);
      }
      if (this.goFlash > 0) { this.goFlash -= dt; txt('GO!', cx, cy - H * 0.16, 'center', '#5ae07a', big * 4); }
    } else {
      txt(`FLIGHT ${fmt(this.flightTime).slice(0, -3)}`, cx, H - (touch ? 30 : 34), 'center');
      txt(`TOP ${Math.round(this.topSpeed * 3.6)} KM/H`, cx, H - (touch ? 30 : 34) - big * 1.4, 'center', '#cfd8e0', big * 0.8);
      if (this.boardOpen || this.input.keys.has('__board')) {
        let y = H * 0.32;
        txt('PILOTS', 18, y, 'left', '#9fd8ff', big * 0.8); y += big * 1.2;
        for (const p of this.roster.filter(q => !q.dummy)) { txt(p.name.slice(0, 14), 18, y, 'left', this.colorOf(p.id), big * 0.8); y += big * 1.1; }
      }
    }
    if (this.bigText && this.clock < this.bigText.until) { txt(this.bigText.text, cx, cy - H * 0.2, 'center', '#ffd36a', big * 3); txt(this.bigText.sub, cx, cy - H * 0.2 + big * 2.6, 'center', '#ffffff', big * 1.3); }
    if (this.gateFlash > 0) { this.gateFlash -= dt; c.fillStyle = `rgba(90,224,122,${this.gateFlash * 0.5})`; c.fillRect(0, 0, W, 6); c.fillRect(0, H - 6, W, 6); }
    // how to fly, for the first seconds (and after changing the flight mode)
    if (this.clock < this.tipUntil && !d.crashed) {
      const lines = this.tips();
      let y = H * 0.66;
      for (const l of lines) { txt(l, cx, y, 'center', '#ffffff', big * 0.78); y += big * 1.15; }
    }
    if (d.crashed) {
      txt('SIGNAL LOST', cx, cy, 'center', '#ff6b5a', big * 1.6);
      txt(touch ? 'Coming back…' : `Coming back… (${keyLabel(keyMap(this.settings.keys).reload)} resets any time)`, cx, cy + big * 2, 'center', '#ffffff', big * 0.8);
    }
  }
  tips() {
    const t = !!this.settings.touch, K = keyMap(this.settings.keys), L = (a) => keyLabel(K[a]);
    const m = this.mode;
    if (t) {
      const ax = this.axes(), say = { thr: m === 'easy' ? 'up/down' : 'throttle', yaw: 'turn', pitch: 'forward/back', roll: 'sideways', none: '—' };
      return [`Left stick: ${say[ax.ly]} ↕  ${say[ax.lx]} ↔   ·   Right stick: ${say[ax.ry]} ↕  ${say[ax.rx]} ↔`, 'Change what each stick does in Settings → Drones'];
    }
    if (m === 'easy') return [`EASY: ${L('moveF')}/${L('moveB')} forward/back · ${L('moveL')}/${L('moveR')} sideways · mouse or ←→ turn · ${L('jump')}/${L('walk')} up/down`, `${L('reload')} reset · C camera · ${L('inspect')} flight mode (Easy / Angle / Acro)`];
    if (m === 'angle') return [`ANGLE: ${L('moveF')}/${L('jump')} throttle up, ${L('moveB')}/${L('walk')} down (lets go = hover) · ${L('moveL')}/${L('moveR')} turn · arrows or mouse tilt`, `${L('reload')} reset · C camera · ${L('inspect')} flight mode · a game controller or RC radio works too`];
    return [`ACRO: ${L('moveF')}/${L('jump')} throttle up, ${L('moveB')}/${L('walk')} down · ${L('moveL')}/${L('moveR')} yaw · mouse rolls and pitches (it stays where you leave it)`, `${L('reload')} reset · C camera · ${L('inspect')} flight mode · a game controller or RC radio works too`];
  }
  drawGateMark(c, W, H, g, txt, big) {
    if (!g) return;
    const v = new THREE.Vector3(g.c[0], g.c[1], g.c[2]);
    const dist = v.distanceTo(this.camera.position);
    v.project(this.camera);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    const on = !behind && x > 30 && x < W - 30 && y > 30 && y < H - 30;
    c.strokeStyle = '#ffb43a'; c.fillStyle = '#ffb43a'; c.lineWidth = 2.5;
    if (on) {
      const s = clamp(600 / Math.max(1, dist), 10, 60);
      c.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(x + a * s, y + b * s * 0.6); c.lineTo(x + a * s, y + b * s); c.lineTo(x + a * s * 0.6, y + b * s); }
      c.stroke();
      txt(`${Math.round(dist)} M`, x, y + clamp(600 / Math.max(1, dist), 10, 60) + 14, 'center', '#ffb43a', big * 0.75);
    } else {
      // an arrow on a ring round the middle, pointing the way to turn
      let dx = x - W / 2, dy = y - H / 2;
      if (behind) { dx = -dx; dy = -dy; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1; }
      const a = Math.atan2(dy, dx), r = Math.min(W, H) * 0.3;
      const ax = W / 2 + Math.cos(a) * r, ay = H / 2 + Math.sin(a) * r;
      c.save(); c.translate(ax, ay); c.rotate(a);
      c.beginPath(); c.moveTo(16, 0); c.lineTo(-8, -11); c.lineTo(-3, 0); c.lineTo(-8, 11); c.closePath(); c.fill();
      c.restore();
      txt(`${Math.round(dist)} M`, ax, ay + 22, 'center', '#ffb43a', big * 0.7);
    }
  }
  // analogue video breaking up after a crash
  drawStatic(dt) {
    const d = this.me, on = !!d.crashed;
    this.staticC.classList.toggle('hidden', !on);
    if (!on) return;
    const s = this.sctx, w = this.staticC.width, h = this.staticC.height;
    const img = s.createImageData(w, h), a = img.data;
    const k = Math.min(1, d.crashed / 0.35);
    for (let i = 0; i < a.length; i += 4) { const v = Math.random() * 255; a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255 * k; }
    s.putImageData(img, 0, 0);
    for (let i = 0; i < 6; i++) { s.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`; s.fillRect(0, Math.random() * h, w, 2 + Math.random() * 6); }
  }

  destroy() {
    this.running = false;
    this.closeChat();
    const box = document.getElementById('chat-box'), input = document.getElementById('chat-input');
    box.removeEventListener('submit', this.chatHandlers.submit);
    input.removeEventListener('keydown', this.chatHandlers.key);
    document.getElementById('chat-close').removeEventListener('click', this.chatHandlers.close);
    document.getElementById('chat-mode').classList.remove('hidden');
    this.input.destroy();
    if (this.voice) this.voice.stop();
    for (const [id, r] of this.remotes) this.dropRemote(id, r);
    sfx.stopAmbience();
    window.removeEventListener('resize', this.onResize);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', this.onResize);
    this.root.classList.add('hidden');
    document.body.classList.remove('fpv-mode');
    if (this.post) this.post.dispose();
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.renderer.dispose();
    this.canvas.remove();
  }
}
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
function ord(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; }
void qypr;
