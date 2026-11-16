// The Poolrooms on your own screen: your arms in first person while you swim (a breaststroke) and while you
// climb a ladder (hand over hand on its rails). Drawn in the first-person pass (game.js vmScene / vmCamera,
// which looks down -z from the origin), in your hazmat suit's yellow sleeves and black gloves.
import * as THREE from 'three';
import { hazmatMat } from './models.js';

const smooth = t => t * t * (3 - 2 * t);

export class PoolHands {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    const sleeve = hazmatMat(), glove = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.45 });
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
    const on = !!(state.swim || state.climb);
    this.root.visible = on;
    if (!on) return;
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
}
