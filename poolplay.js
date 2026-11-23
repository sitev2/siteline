// The Poolrooms on your own screen: your arms in first person while you swim (a breaststroke) and while you
// climb a ladder (hand over hand on its rails). Drawn in the first-person pass (game.js vmScene / vmCamera,
// which looks down -z from the origin), in your hazmat suit's yellow sleeves and black gloves.
import * as THREE from 'three';
import { hazmatMat } from './models.js';
import { POOL, slideCurve, setBridge } from './poolmap.js';
import * as sfx from './audio.js';

const smooth = t => t * t * (3 - 2 * t);

export class PoolHands {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    const sleeve = this.sleeve = hazmatMat().clone(), glove = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.45 });
    this.arms = [1, -1].map(sd => {
      const g = new THREE.Group();
      // the forearm: a sleeve from the elbow to the wrist (along +y of the group, stretched each frame)
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.047, 1, 10, 1), sleeve);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14), new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.5 }));
      cuff.rotation.x = Math.PI / 2;
      // the hand: a flat rubber mitten with a thumb
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.05, 4, 8), glove);
      palm.rotation.x = Math.PI / 2; palm.scale.set(1.75, 1, 0.62); palm.position.z = -0.045;
      const fingers = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.05, 4, 8), glove);
      fingers.rotation.x = Math.PI / 2 - 0.25; fingers.scale.set(1.8, 1, 0.5); fingers.position.set(0, -0.006, -0.105);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 3, 6), glove);
      thumb.position.set(-sd * 0.04, 0.004, -0.06); thumb.rotation.set(Math.PI / 2, 0, sd * 0.6);
      hand.add(palm, fingers, thumb);
      g.add(fore, cuff, hand);
      this.root.add(g);
      return { g, fore, cuff, hand, sd, grip: null };
    });
    this.ph = 0;
    this.tmp = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.q = new THREE.Quaternion();
  }

  // a soaked suit is darker and shinier
  setWet(k) { if (this.sleeve.roughness !== undefined) { this.sleeve.roughness = 0.42 * (1 - 0.7 * k); this.sleeve.color.setScalar(1 - 0.18 * k); } }

  // place one arm: elbow (off the bottom of the screen) to wrist; palm: which way the palm faces, roll about the arm
  place(a, wx, wy, wz, ex, ey, ez, palmDown = 1, yaw = 0) {
    const d = this.tmp.set(wx - ex, wy - ey, wz - ez), len = d.length();
    a.fore.position.set((wx + ex) / 2, (wy + ey) / 2, (wz + ez) / 2);
    a.fore.scale.set(1, len, 1);
    a.fore.quaternion.setFromUnitVectors(this.up, d.normalize());
    a.cuff.position.set(wx - d.x * 0.03, wy - d.y * 0.03, wz - d.z * 0.03);
    a.cuff.quaternion.copy(a.fore.quaternion);
    a.hand.position.set(wx, wy, wz);
    a.hand.rotation.set(palmDown > 0 ? 0 : -1.25, yaw, palmDown > 0 ? -a.sd * 0.25 : a.sd * 0.2, 'YXZ');
  }

  // state: { swim, speed, climb: { eyeY, L (the ladder), camera (the main one), k (view-model scale) } | null }; dt in seconds
  update(dt, state) {
    const on = !!(state.swim || state.climb || state.ledge);
    this.root.visible = on;
    if (!on) return;
    if (state.ledge) {
      // pulling yourself out over the edge: both hands flat on the floor just past the edge (worked out in the world)
      const { c, camera, k } = state.ledge;
      camera.updateMatrixWorld();
      const sx = -c.dz, sz = c.dx;
      for (const a of this.arms) {
        const v = this.tmp.set(c.x0 + c.dx * 0.62 + sx * a.sd * 0.3, c.y1 + 0.03, c.z0 + c.dz * 0.62 + sz * a.sd * 0.3);
        camera.worldToLocal(v);
        const wx = v.x * k, wy = v.y * k, wz = v.z;
        if (wz > -0.12) { this.place(a, a.sd * 0.3, -0.62, -0.25, a.sd * 0.34, -0.85, 0.05, 1, 0); continue; }
        this.place(a, wx, wy, wz, a.sd * 0.34, Math.min(-0.6, wy - 0.45), 0.05, 1, 0);
      }
      return;
    }
    if (state.swim) {
      // one stroke every ~1.5 s while moving, slow sculling when still
      const sp = Math.min(1, state.speed / 1.8);
      this.ph = (this.ph + dt * (0.32 + 0.4 * sp)) % 1;
      const p = this.ph;
      for (const a of this.arms) {
        const sd = a.sd;
        let x, y, z;
        if (sp < 0.15) {
          // treading water: little circles out in front
          const t = this.ph * Math.PI * 2;
          x = sd * (0.2 + Math.cos(t) * 0.06); y = -0.36 + Math.sin(t) * 0.025; z = -0.42 + Math.sin(t) * 0.05;
        } else if (p < 0.35) { const t = smooth(p / 0.35); x = sd * (0.07 + 0.36 * t); y = -0.27 - 0.07 * t; z = -0.62 + 0.3 * t; }        // the pull: out and back
        else if (p < 0.55) { const t = smooth((p - 0.35) / 0.2); x = sd * (0.43 - 0.35 * t); y = -0.34 + 0.08 * t; z = -0.32 + 0.1 * t; }   // together under the chin
        else { const t = smooth(Math.min(1, (p - 0.55) / 0.22)); x = sd * (0.08 - 0.01 * t); y = -0.26 - 0.01 * t; z = -0.22 - 0.4 * t; }   // shoot forward, glide
        this.place(a, x, y, z, sd * 0.3, -0.62, 0.05, 1, -sd * 0.15);
      }
      return;
    }
    // the ladder: each hand holds its rail while you rise past the spot, then reaches up again (hand over hand).
    // The grips are worked out in the world (so they sit on the rails) and then turned into the view.
    const { eyeY, L, camera, k } = state.climb;
    camera.updateMatrixWorld();
    const tx = -L.nz, tz = L.nx, back = L.wall ? 0.12 : 0.13, top = L.wall ? L.top : L.top + 0.9;
    for (const a of this.arms) {
      const f = ((eyeY / 0.54 + (a.sd > 0 ? 0 : 0.5)) % 1 + 1) % 1;
      const rel = f < 0.2 ? -0.53 + smooth(f / 0.2) * 0.43 : -0.1 - (f - 0.2) * 0.54;
      const y = Math.min(eyeY + rel, top);
      // (over the top of a pool ladder the rail curves forward onto the deck: the hand follows it)
      const o = !L.wall && y > L.top + 0.45 ? -back + (y - L.top - 0.45) / 0.45 * 0.4 : -back;
      const v = this.tmp.set(L.x + L.nx * o + tx * a.sd * 0.25, y, L.z + L.nz * o + tz * a.sd * 0.25);
      camera.worldToLocal(v);
      const wx = v.x * k, wy = v.y * k, wz = v.z;
      // (a hand that would be behind you or far off the screen stays down by your side)
      if (wz > -0.12 || Math.abs(wx) > 0.7) { this.place(a, a.sd * 0.3, -0.62, -0.25, a.sd * 0.34, -0.85, 0.05, -1, 0); continue; }
      this.place(a, wx, wy, wz, a.sd * 0.34, Math.min(-0.55, wy - 0.4), 0.02, -1, 0);
    }
  }
}

// People in the water: the parts of them under the surface are seen through it (tinted teal, darker the deeper),
// as the tiles are. Each model gets its own copies of its materials with that added; setWaterY(y) says where
// the surface is at the model's spot (none: -1000).
export function poolTint(root) {
  const U = { uPoolWY: { value: -1000 } }, done = new Map();
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const one = (m) => {
      if (done.has(m)) return done.get(m);
      const c = m.clone();
      c.onBeforeCompile = (sh) => {
        sh.uniforms.uPoolWY = U.uPoolWY;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPoolY;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvPoolY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPoolY; uniform float uPoolWY;')
          .replace('#include <tonemapping_fragment>', `{ float d = uPoolWY - vPoolY;
            if (d > 0.0) { float k = clamp(d * 30.0, 0.0, 1.0); vec3 keep = exp(-(d * 1.6 + 0.5) * vec3(0.46, 0.085, 0.13));
              gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * keep + vec3(0.05, 0.36, 0.32) * (1.0 - exp(-(d + 0.4) * 0.6)), k); } }
            #include <tonemapping_fragment>`);
      };
      c.customProgramCacheKey = () => 'pooltint|' + (m.customProgramCacheKey ? m.customProgramCacheKey() : '');
      done.set(m, c);
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
  root.userData.setWaterY = (y) => { U.uPoolWY.value = y; };
  // a soaked suit: darker and shinier, drying back slowly
  const base = new Map();
  for (const c of done.values()) if (c.roughness !== undefined) base.set(c, { r: c.roughness, col: c.color.clone() });
  let lastWet = -1;
  root.userData.setWet = (k) => {
    if (Math.abs(k - lastWet) < 0.01) return;
    lastWet = k;
    for (const [c, b] of base) { c.roughness = b.r * (1 - 0.7 * k); c.color.copy(b.col).multiplyScalar(1 - 0.2 * k); }
  };
}

// ---------- the Poolrooms on this screen: the host's state, the things you use, the slides, wet suits ----------

const RIDE_SECS = 5;

export class PoolClient {
  constructor(game) {
    this.g = game;
    this.ud = game.builtMap.group.userData;
    this.plan = game.world.def.pool;
    this.great = game.world.bodies.find(b => b.name === 'great');
    this.level = this.great.y;
    this.wantLevel = this.level;
    this.solid = this.plan.bridges.map(() => false);
    this.rings = this.plan.floaties.map((f, i) => ({ i, x: f.x, y: POOL.WY, z: f.z, tx: f.x, ty: POOL.WY, tz: f.z, holder: 0, mode: 0, spin: 0 }));
    this.s = null;
    this.ride = null;
    this.useSend = 0;
    this.hissAt = 0;
    this.wet = new Map();           // id → how wet their suit is (0 … 1)
    this.lastValveP = [0, 0, 0];
    this.curves = this.plan.slides.map(sl => slideCurve(sl.path));
  }

  // the host's state ({ b, pl, v, o, h, u, d, lv, dr, r }: see poolhost.js state())
  apply(s) {
    if (!s) return;
    const ud = this.ud, W = this.g.world;
    this.plan.bridges.forEach((br, i) => {
      ud.setBridge(i, s.b[i]);
      const solid = s.b[i] >= 0.98;
      if (solid !== this.solid[i]) { this.solid[i] = solid; setBridge(W, br, solid); }
      br.plates.forEach((p, j) => ud.setPlate(i, j, s.pl[i][j]));
    });
    s.v.forEach((p, i) => {
      ud.setValve(i, p);
      // the ratchet clicks as it turns
      if (Math.floor(p * 8) !== Math.floor(this.lastValveP[i] * 8)) { const v = this.plan.valves[i]; sfx.playStep({ pos: { x: v.x, y: v.y + 1, z: v.z }, surface: 'metal' }); }
      this.lastValveP[i] = p;
    });
    ud.setHeat(s.h); ud.setGauges(s.h); ud.setUnlocked(!!s.u); ud.setDrain(s.d);
    // finished steps for the task list stay ticked (a bridge sinks again, a valve can be turned back)
    const dn = this.done || (this.done = { bridge: false, heat: false, drain: false });
    if (s.b[0] >= 0.98) dn.bridge = true;
    if (s.u) dn.heat = true;
    if (s.dr) dn.drain = true;
    this.wantLevel = s.lv;
    if (!this.s) this.level = s.lv;          // (the first one: no easing)
    s.r.forEach((q, i) => { const r = this.rings[i]; if (!r) return; r.tx = q[0]; r.ty = q[1]; r.tz = q[2]; r.holder = q[3]; r.mode = q[4]; if (!this.s) { r.x = q[0]; r.y = q[1]; r.z = q[2]; } });
    this.s = s;
  }

  // something happened (sounds, and a few things to see)
  fx(m) {
    const P = this.plan, g = this.g, at = (x, y, z) => ({ x, y, z }), occ = (p) => g.occlusion(p.x, p.y, p.z);
    const play = (k, p, gain = 1, rate = 1) => sfx.playPool(k, p, p ? occ(p) : 0, gain, rate);
    switch (m.k) {
      case 'plate': { const p = P.bridges[m.b].plates[m.j]; play('clunk', at(p.x, POOL.G + 0.1, p.z), 0.8, m.on ? 1 : 1.2); return; }
      case 'bridge': { const b = P.bridges[m.b]; play('grind', at((b.x0 + b.x1) / 2, POOL.G - 0.2, (b.z0 + b.z1) / 2), 1, m.up ? 1 : 0.85); return; }
      case 'valve': if (m.on) { const v = P.valves[m.i]; play('squeak', at(v.x, v.y + 1.05, v.z), 0.8); } return;
      case 'valveEnd': { const v = P.valves[m.i]; play('clank', at(v.x, v.y + 1.05, v.z), 0.9); play('gurgle', at(v.x, v.y + 0.3, v.z), 0.7); return; }
      case 'unlock': { const d = P.drain; play('unlock', at(d.x, d.y + 1.2, d.z), m.on ? 1 : 0.6, m.on ? 1 : 1.3); return; }
      case 'stuck': { const d = P.drain; play('rattle', at(d.x, d.y + 1.2, d.z), 0.9); this.ud.jiggleDrain(); return; }
      case 'wheel': if (m.on) { const d = P.drain; play('squeak', at(d.x, d.y + 1.2, d.z), 1, 0.7); } return;
      case 'drain': play('drain', at(52, 1, 33), 1.4); play('unlock', at(P.drain.x, P.drain.y + 1.2, P.drain.z), 1, 0.8); return;
      case 'grab': { const r = this.rings[m.i]; play('rubber', at(r.x, r.y, r.z), 0.6, 1.2); return; }
      case 'throw': { const r = this.rings[m.i]; sfx.playSwing({ pos: at(r.x, r.y, r.z) }); return; }
      case 'splash': play('splash', at(m.x, m.y, m.z), 0.7, 1.3); this.g.addRipple(m.x, m.z, 1.6); return;
      case 'bump': play(Math.random() < 0.5 ? 'rubber' : 'bonk', at(m.x, m.y, m.z), 0.4 + m.v * 0.6); return;
    }
  }

  // a remote player went down a slide: they vanish into the tube and shoot out at the bottom about 5 s later
  remoteSlide(m) {
    const r = this.g.remotes.get(m.id), sl = this.plan.slides[m.i];
    if (!r || !sl) return;
    r.slideUntil = this.g.clock + RIDE_SECS + 0.15;
    sfx.playPool('whoosh', { x: sl.mouth.x, y: sl.mouth.y, z: sl.mouth.z }, 0, 0.9);
    sfx.playPool('rush', { x: sl.out.x, y: sl.out.y, z: sl.out.z }, this.g.occlusion(sl.out.x, sl.out.y, sl.out.z), 0.6);
  }

  // what E / the hand button would do here: a valve, the drain wheel, or a floatie
  useTarget() {
    const me = this.g.me, P = this.plan;
    if (!me.alive || this.ride || me.ladder) return null;
    const near = (v, r = 1.6) => Math.abs(v.y - me.pos.y) < 1.4 && Math.hypot(v.x + v.nx * 0.7 - me.pos.x, v.z + v.nz * 0.7 - me.pos.z) < r;
    for (let i = 0; i < P.valves.length; i++) if (near(P.valves[i])) return { kind: 'valve', i };
    if (!(this.s && this.s.dr) && near(P.drain, 1.8)) return { kind: 'drain' };
    if (!this.holding()) for (const r of this.rings) {
      if (r.holder || r.mode === 4) continue;
      const dy = r.y - me.pos.y;
      if (Math.hypot(r.x - me.pos.x, r.z - me.pos.z) < 1.7 && dy > -0.6 && dy < 2.3) return { kind: 'ring', i: r.i };
    }
    return null;
  }
  holding() { return this.rings.some(r => r.holder === this.g.myId); }

  // E pressed (once)
  use(u) { if (u && u.kind === 'ring') this.g.transport.send({ t: 'ring' }); }
  // fire / tap: throw the floatie you are holding
  throw() { const me = this.g.me; if (this.holding()) this.g.transport.send({ t: 'throw', yaw: me.yaw, pitch: me.pitch }); }

  // ---- the slides ----
  // walk into a slide's mouth (on the platform upstairs) and away you go
  checkSlide() {
    const me = this.g.me;
    if (this.ride || !me.alive || !me.onGround || Math.abs(me.pos.y - POOL.U) > 0.3) return;
    this.plan.slides.forEach((sl, i) => {
      if (this.ride) return;
      if (Math.abs(me.pos.x - sl.mouth.x) < 0.42 && me.pos.z < sl.mouth.z + 0.62) this.startRide(i);
    });
  }
  startRide(i) {
    const g = this.g, me = g.me, sl = this.plan.slides[i];
    this.ride = { i, t0: g.clock };
    g.transport.send({ t: 'slide', i });
    this.ud.setTube(i, true);
    me.vel.x = me.vel.y = me.vel.z = 0;
    sfx.playPool('whoosh', null, 0, 1);
    sfx.playPool('rush', null, 0, 0.85);
    g.addRipple(sl.out.x, sl.out.z, 0.4);
  }
  // one step of a ride (moves you along the tube); true while riding
  rideStep() {
    const r = this.ride;
    if (!r) return false;
    const g = this.g, me = g.me, c = this.curves[r.i];
    const t = Math.min(1, (g.clock - r.t0) / RIDE_SECS), s = 0.3 * t + 0.7 * t * t;      // (picking up speed)
    const p = c.at(s);
    me.pos.x = p[0]; me.pos.y = p[1] - 0.55; me.pos.z = p[2];
    me.vel.x = me.vel.y = me.vel.z = 0; me.onGround = false; me.swim = false;
    if (t >= 1) {
      // shot out of the end: on into the water (or the grotto's basin)
      const a = c.at(0.985), dx = p[0] - a[0], dy = p[1] - a[1], dz = p[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
      me.vel.x = dx / l * 5.5; me.vel.z = dz / l * 5.5; me.vel.y = dy / l * 5.5;
      me.peakY = me.pos.y; me.airTime = 0;
      this.ud.setTube(r.i, false);
      this.ride = null;
      return false;
    }
    return true;
  }
  // the camera while riding: inside the tube, looking down it, leaning into the bends
  rideCamera() {
    const r = this.ride;
    if (!r) return null;
    const g = this.g, c = this.curves[r.i];
    const t = Math.min(1, (g.clock - r.t0) / RIDE_SECS), s = 0.3 * t + 0.7 * t * t;
    const p = c.at(s), q = c.at(Math.min(1, s + 0.012)), a = c.at(Math.max(0, s - 0.03)), b = c.at(Math.min(1, s + 0.05));
    const tx = q[0] - p[0], ty = q[1] - p[1], tz = q[2] - p[2], tl = Math.hypot(tx, ty, tz) || 1;
    const yaw = Math.atan2(-tx, -tz), pitch = Math.asin(Math.max(-0.9, Math.min(0.9, ty / tl)));
    // how sharply it turns left or right here
    const h1 = Math.atan2(-(p[0] - a[0]), -(p[2] - a[2])), h2 = Math.atan2(-(b[0] - p[0]), -(b[2] - p[2]));
    let turn = h2 - h1; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.roll = (this.roll || 0) + (Math.max(-0.6, Math.min(0.6, turn * 1.6)) - (this.roll || 0)) * 0.15;
    return { x: p[0], y: p[1] + 0.1, z: p[2], yaw, pitch, roll: this.roll };
  }

  // every frame
  update(dt) {
    const g = this.g, me = g.me, ud = this.ud, now = g.clock;
    // the Great Pool's water, easing to where the host says
    if (Math.abs(this.wantLevel - this.level) > 1e-3) {
      // (the host sends it ten times a second: just smooth out the steps, whatever the frame rate)
      this.level += (this.wantLevel - this.level) * Math.min(1, dt * 10);
      if (Math.abs(this.wantLevel - this.level) < 0.002) this.level = this.wantLevel;
      this.great.y = this.level; ud.setWater('great', this.level);
    }
    // holding E at a valve or the drain wheel: the host is told several times a second (real time)
    this.turning = false;
    if (me.alive && g.input.useHeld) {
      const u = this.useTarget();
      if (u && (u.kind === 'valve' || u.kind === 'drain')) {
        this.turning = true;
        const rt = performance.now();
        if (rt >= this.useSend) { this.useSend = rt + 150; g.transport.send(u.kind === 'valve' ? { t: 'valve', i: u.i } : { t: 'drain' }); }
      }
    }
    if (!this.ride) this.checkSlide();
    // floaties: ease to where the host has them; bob on the water; in your hands, or in someone else's
    this.rings.forEach((r, i) => {
      const m = ud.floaties[i];
      if (!m) return;
      m.visible = r.mode !== 4;
      const k = Math.min(1, dt * 10);
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k;
      if (r.holder === g.myId && me.alive) {
        // in front of you, both hands on it
        const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
        m.position.set(me.pos.x + fx * 0.62, me.pos.y + EYE_H - 0.78 + Math.sin(me.pitch) * 0.35, me.pos.z + fz * 0.62);
        m.rotation.set(0.5, me.yaw, 0, 'YXZ');      // (held low, tipped towards you: it doesn't block your view)
      } else if (r.holder) {
        const q = g.remotes.get(r.holder);
        if (q && q.rp) { const fx = -Math.sin(q.rp.yaw), fz = -Math.cos(q.rp.yaw); m.position.set(q.rp.x + fx * 0.38, q.rp.y + 1.15, q.rp.z + fz * 0.38); m.rotation.set(Math.PI / 2, q.rp.yaw, 0, 'YXZ'); }
      } else {
        const t = now + i * 1.7, float = r.mode === 0;
        r.spin += dt * (r.mode === 1 ? 7 : float ? 0.12 : 0);
        m.position.set(r.x, r.y + (float ? 0.035 + Math.sin(t * 1.25) * 0.022 : 0.12), r.z);
        m.rotation.set(float ? Math.sin(t * 0.9) * 0.06 : r.mode === 1 ? r.spin * 0.7 : 0, r.spin, float ? Math.cos(t * 1.1) * 0.06 : 0);
        if (float && Math.random() < dt * 0.25) g.addRipple(r.x, r.z, 0.35);
      }
    });
    document.body.classList.toggle('pool-ring', this.holding() && me.alive);
    // remotes riding a slide are out of sight inside the tube
    for (const r of g.remotes.values()) if (r.model && r.slideUntil && now < r.slideUntil) r.model.root.visible = false;
    // steam hisses softly near a hot lane
    if (this.s && now > this.hissAt) {
      this.hissAt = now + 2.1;
      const h = this.s.h;
      this.plan.lanes.forEach((l, k) => {
        if (h[k] < 0.3 || this.level < 1) return;
        const x = Math.max(l.x0, Math.min(l.x1, me.pos.x)), z = Math.max(l.z0, Math.min(l.z1, me.pos.z)), d = Math.hypot(x - me.pos.x, z - me.pos.z);
        if (d < 14) sfx.playPool('hiss', { x, y: this.level + 0.4, z }, g.occlusion(x, this.level + 0.5, z), h[k] * 0.7);
      });
    }
    // wet suits: soaked by deep water, drying slowly
    const wetStep = (id, p, model, swimming) => {
      const b = g.world.bodyAt(p.x, p.z), inWater = b && b.y > p.y + 0.35;
      let w = this.wet.get(id) || 0;
      w = inWater ? Math.min(1, w + dt * (swimming ? 2 : 0.6)) : Math.max(0, w - dt / 90);
      this.wet.set(id, w);
      if (model && model.root.userData.setWet) model.root.userData.setWet(w);
    };
    if (me.alive) wetStep(g.myId, me.pos, null, me.swim);
    for (const r of g.remotes.values()) if (r.alive && r.model && !r.model.monster && r.rp) wetStep(r.id, r.rp, r.model, false);
    if (g.poolHands) g.poolHands.setWet(this.wet.get(g.myId) || 0);
  }

  destroy() { document.body.classList.remove('pool-ring'); }
}
const EYE_H = 1.62;

