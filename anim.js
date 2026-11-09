import * as THREE from 'three';

// First-person weapon animations: pulling the gun out (draw) and looking it over (inspect).
// A pose is [x, y, z, pitch, yaw, roll] added to the gun's resting position. Keyframes are
// [time 0–1, pose]; poses in between are smoothed.

const Z = [0, 0, 0, 0, 0, 0];

// where the gun starts when you pull it out, by weapon type
const DRAW_FROM = {
  pistol: [0.05, -0.3, 0.05, -1.1, 0.3, 0.6],
  smg: [0.1, -0.28, 0.05, -0.8, 0.6, 0.4],
  shotgun: [0.12, -0.3, 0.08, -0.7, 0.7, 0.3],
  rifle: [0.15, -0.32, 0.1, -0.6, 0.9, 0.5],
  sniper: [0.18, -0.35, 0.12, -0.5, 1.0, 0.4],
  bomb: [0, -0.3, 0.05, -0.9, 0, 0],
};

const INSPECT = {
  pistol: { dur: 2.4, keys: [[0, Z], [0.15, [-0.05, 0.04, 0.02, 0.1, 0.9, 0.55]], [0.45, [-0.05, 0.05, 0.02, 0.12, 0.95, 0.6]], [0.6, [0.02, 0.03, 0, 0.05, -0.8, -0.5]], [0.82, [0.02, 0.03, 0, 0.05, -0.85, -0.55]], [1, Z]] },
  smg: { dur: 2.6, keys: [[0, Z], [0.2, [-0.04, 0.05, 0.03, 0.35, 0.6, 0.7]], [0.48, [-0.04, 0.06, 0.03, 0.38, 0.65, 0.75]], [0.64, [0.03, 0.02, 0, -0.2, -0.4, -0.3]], [0.84, [0.03, 0.02, 0, -0.22, -0.45, -0.32]], [1, Z]] },
  shotgun: { dur: 2.8, keys: [[0, Z], [0.2, [-0.05, 0.04, 0.04, 0.1, 0.8, 0.6]], [0.48, [-0.05, 0.05, 0.04, 0.12, 0.82, 0.62]], [0.62, [0.02, 0.06, 0, -0.25, -0.3, -0.2]], [0.82, [0.02, 0.06, -0.02, -0.28, -0.32, -0.22]], [1, Z]] },
  rifle: { dur: 3.0, keys: [[0, Z], [0.2, [-0.06, 0.06, 0.05, 0.15, 0.75, 0.45]], [0.45, [-0.06, 0.08, 0.05, 0.25, 0.85, 0.5]], [0.6, [0.02, 0.0, 0.02, -0.3, 0.1, -0.3]], [0.8, [0.02, 0.0, 0.02, -0.28, 0.05, -0.34]], [1, Z]] },
  sniper: { dur: 3.2, keys: [[0, Z], [0.25, [-0.06, 0.06, 0.03, 0.28, 0.95, 0.3]], [0.5, [-0.06, 0.07, 0.03, 0.3, 1.0, 0.32]], [0.65, [0.03, 0.03, 0, 0.05, -0.5, -0.6]], [0.85, [0.03, 0.03, 0, 0.06, -0.55, -0.62]], [1, Z]] },
  bomb: { dur: 2.2, keys: [[0, Z], [0.3, [0, 0.06, 0.06, 0.8, 0.2, 0]], [0.6, [0, 0.06, 0.06, 0.8, -0.3, 0.2]], [1, Z]] },
};

// a few guns get their own flourish
const SPECIAL = {
  deagle: { dur: 2.8, keys: [[0, Z], [0.15, [-0.05, 0.04, 0.02, 0.1, 0.9, 0.55]], [0.45, [-0.05, 0.05, 0.02, 0.12, 0.95, 0.6]], [0.6, [0.02, 0.03, 0, 0.05, -0.8, -0.5]], [0.72, [0.02, 0.05, 0, 0.1, -0.1, -0.1]], [1, [0, 0, 0, 0, 0, -6.2832]]] },   // ends with a spin
  glock: { dur: 2.4, keys: [[0, Z], [0.18, [-0.04, 0.05, 0.02, 0.25, 0.7, 0.9]], [0.45, [-0.04, 0.06, 0.02, 0.28, 0.75, 0.95]], [0.62, [0.03, 0.02, 0, -0.1, -0.7, -0.7]], [0.84, [0.03, 0.02, 0, -0.12, -0.72, -0.72]], [1, Z]] },
  ak47: { dur: 3.1, keys: [[0, Z], [0.18, [-0.06, 0.07, 0.05, 0.2, 0.8, 0.6]], [0.42, [-0.06, 0.08, 0.05, 0.25, 0.85, 0.65]], [0.56, [0.03, 0.0, 0.02, -0.32, 0.12, -0.45]], [0.78, [0.03, 0.0, 0.02, -0.3, 0.06, -0.5]], [1, Z]] },
  awp: { dur: 3.4, keys: [[0, Z], [0.22, [-0.07, 0.08, 0.03, 0.38, 1.05, 0.2]], [0.52, [-0.07, 0.09, 0.03, 0.4, 1.1, 0.22]], [0.68, [0.04, 0.04, 0, 0.05, -0.55, -0.7]], [0.88, [0.04, 0.04, 0, 0.06, -0.58, -0.72]], [1, Z]] },
  mag7: { dur: 2.8, keys: [[0, Z], [0.2, [-0.05, 0.06, 0.04, 0.5, 0.6, 0.5]], [0.48, [-0.05, 0.07, 0.04, 0.55, 0.62, 0.55]], [0.62, [0.02, 0.04, 0, -0.2, -0.4, -0.4]], [0.82, [0.02, 0.04, 0, -0.22, -0.42, -0.42]], [1, Z]] },
};

const TYPE = { pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', sniper: 'sniper', bomb: 'bomb' };


const easeOut = t => 1 - Math.pow(1 - t, 3);

// ---------- smooth curves through keyframes ----------
// A Hermite curve whose speed carries through each key (no stop-start at every key), easing
// in at the first key and out at the last. keys: [[t, [values…], stop?], …]; a key marked
// `stop` is a dead stop (a hand grabbing something, say).
function tan(keys, i, j) {
  if (i === 0 || i === keys.length - 1 || keys[i][2]) return 0;
  return (keys[i + 1][1][j] - keys[i - 1][1][j]) / (keys[i + 1][0] - keys[i - 1][0]);
}
function curve(keys, k, n) {
  const last = keys.length - 1;
  if (k <= keys[0][0]) return keys[0][1].slice(0, n);
  if (k >= keys[last][0]) return keys[last][1].slice(0, n);
  let i = 0;
  while (keys[i + 1][0] < k) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1];
  const h = t1 - t0 || 1e-6, u = (k - t0) / h, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const out = new Array(n);
  for (let j = 0; j < n; j++) out[j] = h00 * a[j] + h10 * h * tan(keys, i, j) + h01 * b[j] + h11 * h * tan(keys, i + 1, j);
  return out;
}
// the same for points: keys [[t, Vector3, stop?], …]
function curveV(out, keys, k) {
  const r = curve(keys.map(([t, v, stop]) => [t, [v.x, v.y, v.z], stop]), k, 3);
  return out.set(r[0], r[1], r[2]);
}

export function inspectDuration(weaponId, type) {
  return (SPECIAL[weaponId] || INSPECT[TYPE[type]] || INSPECT.rifle).dur;
}

// t = seconds since the inspect started; returns a pose, or null when it's over
export function inspectPose(weaponId, type, t) {
  const def = SPECIAL[weaponId] || INSPECT[TYPE[type]] || INSPECT.rifle;
  const k = t / def.dur;
  if (k >= 1) return null;
  return curve(def.keys, k, 6);
}

// k = how much of the draw is left (1 = just started, 0 = done)
export function drawPose(type, k) {
  const from = DRAW_FROM[TYPE[type]] || DRAW_FROM.rifle;
  const e = 1 - easeOut(1 - Math.max(0, Math.min(1, k)));
  return from.map(v => v * e);
}

// ======================================================================
// Hands and moving parts of the first-person gun (see makeViewModel in models.js).
// st: { dt, reload: 0–1 progress or -1, shell: 0–1 progress of one shell (shotgun) or -1,
//       reloadEmpty, empty, fireT: seconds since the last shot, bolt: 0–1 or -1, pump: 0–1 or -1,
//       hold: where the gun sits on screen (for anchoring the elbows) }
// Everything is worked out in the gun's own space, so a hand that holds a part (magazine,
// slide, charging handle, bolt, pump) and the part always move together.

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0), ZAX = new V3(0, 0, 1);
const clamp01 = t => Math.max(0, Math.min(1, t));
// smootherstep: starts and stops without a jolt
const sm = t => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
// a smooth 0 → 1 → 0 bump between a and b
const bump = (k, a, b) => (k <= a || k >= b ? 0 : Math.sin(Math.PI * (k - a) / (b - a)) ** 2);

// hand orientations (left hand), built from a palm-up hold under a handguard:
// palm up, fingers wrapping up the far side, thumb forward
const PALM_UP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new V3(0, 1, 0), new V3(0, 0, -1), new V3(-1, 0, 0)));
const rollZ = (a) => new THREE.Quaternion().setFromAxisAngle(ZAX, a).multiply(PALM_UP);
const Q_UNDER = rollZ(0.3), Q_PUMP = rollZ(0.2);
const Q_MAG = rollZ(0.55);                 // holding a magazine from below, palm turned towards you
// over the top from the left: palm down, fingers curling over the right side, wrist on your side
// (rolled onto the top-left of the slide so the forearm comes in from the left)
const Q_OVER = new THREE.Quaternion().setFromAxisAngle(ZAX, 0.7).multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new V3(0, -1, 0), new V3(0.777, 0, 0.629), new V3(-0.629, 0, 0.777))));
const Q_PRESS = rollZ(-1.25);              // palm flat against the left side of the gun
const Q_CUP = (tilt) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0.35));
const Q_VGRIP = (tilt) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0));
const Q_BOLT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0.55, 0.95));   // right hand pinching the bolt knob

function holdQuat(u) {
  const k = u.foreKind;
  if (k === 'under') return Q_UNDER.clone();
  if (k === 'pump') return Q_PUMP.clone();
  if (k === 'cup') return Q_CUP(u.gripTilt || 0);
  return Q_VGRIP(u.gripTilt || 0);
}

// Sudden jumps (an animation interrupted half way, a pose that starts at once) are soaked up:
// the jump becomes an offset that springs back to zero, so what you see glides instead.
const _j = new V3();
function settle(A, name, raw, dt) {
  let s = A[name];
  if (!s) s = A[name] = { prev: raw.clone(), off: new V3(), vel: new V3() };
  _j.subVectors(raw, s.prev);
  if (_j.length() > 3.5 * dt + 0.004) s.off.sub(_j);
  s.prev.copy(raw);
  // critically damped spring
  const w = 16;
  s.vel.addScaledVector(s.off, -w * w * dt).multiplyScalar(Math.max(0, 1 - 2 * w * dt));
  s.off.addScaledVector(s.vel, dt);
  if (s.off.lengthSq() < 1e-10) { s.off.set(0, 0, 0); s.vel.set(0, 0, 0); }
  return raw.add(s.off);
}
function settleQ(A, name, raw, dt) {
  if (!A[name]) A[name] = raw.clone();
  A[name].slerp(raw, 1 - Math.exp(-dt / 0.045));
  return raw.copy(A[name]);
}

const _gp = new V3(), _gr = new V3(), _R = new V3(), _L = new V3(), _L0 = new V3(), _R0 = new V3();
const _ax = new V3(), _go = new V3(), _tmp = new V3(), _tmp2 = new V3();
const _qL = new THREE.Quaternion(), _qR = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _e = new THREE.Euler();

// how the gun is lifted and turned during a magazine change so you can see the magazine:
// [x, y, z, pitch, turn, roll]
const RACK_POSE = {
  pistol: [-0.06, 0.04, -0.02, 0.15, 0.65, -0.5],
  smg: [-0.05, 0.03, -0.08, 0.2, 0.55, -0.5],
  rifle: [-0.08, 0.06, 0.0, 0.15, 0.5, -0.45],
};
const RELOAD_POSE = {
  pistol: [-0.03, 0.17, 0.0, 0.95, 0.35, -0.5],
  smg: [-0.07, 0.13, 0.03, 0.55, 0.3, -0.7],
  rifle: [-0.09, 0.11, 0.05, 0.35, 0.35, -0.8],
};

export function poseViewModel(vm, st) {
  const d = vm.userData, u = d.parts, gun = d.gun;
  if (!u) return;
  const kind = u.kind, dt = Math.min(0.05, Math.max(0.001, st.dt || 1 / 60));
  const A = d.anim || (d.anim = { shellW: 0 });
  // ---- moving parts back to rest ----
  if (u.mag && d.rest.mag) { u.mag.position.copy(d.rest.mag.p); u.mag.rotation.copy(d.rest.mag.r); u.mag.visible = true; }
  if (u.slide) u.slide.position.copy(d.rest.slide);
  if (u.pump) u.pump.position.copy(d.rest.pump);
  if (u.bolt) { u.bolt.position.copy(d.rest.bolt.p); u.bolt.rotation.copy(d.rest.bolt.r); }
  if (u.handle) u.handle.position.copy(d.rest.handle);
  if (u.hammer) u.hammer.rotation.x = 0;
  const gp = _gp.set(0, kind === 'bomb' ? -0.03 : 0, kind === 'bomb' ? -0.06 : 0), gr = _gr.set(0, 0, 0);

  // ---- where the hands normally hold the gun ----
  const R0 = _R0.copy(u.grip), L0 = _L0.copy(u.fore);
  if (u.foreKind === 'under' || u.foreKind === 'pump') L0.y += 0.026;   // the handguard sits in the curl of the fingers
  if (u.foreKind === 'under') L0.z -= 0.03;
  const R = _R.copy(R0), L = _L.copy(L0);
  const qHold = holdQuat(u);
  const qR = _qR.setFromEuler(_e.set(-(u.gripTilt || 0), 0, 0));
  let wMag = 0, wOver = 0, wBolt = 0;     // how far each hand has turned from its normal hold
  let slideBack = 0;

  // ---- firing: pistol slides blow back (and lock open on an empty magazine) ----
  if (u.slide) {
    const f = st.fireT;
    slideBack = f < 0.025 ? sm(f / 0.025) : 1 - sm((f - 0.025) / 0.07);
    if (st.empty && st.reload < 0) slideBack = 1;
    slideBack *= 0.026;
  }
  // ---- MAG-7 pump after each shot: quick back, quick forward ----
  if (u.pump && st.pump >= 0) {
    const k = st.pump, back = (sm(k / 0.42) - sm((k - 0.52) / 0.42)) * (u.stroke || 0.055);
    u.pump.position.z += back;
    L.z += back;
    gr.x -= 0.6 * back; gp.z += 0.15 * back;
  }
  // ---- bolt-action cycle: hand to the knob, lift, pull, push, down, back to the grip ----
  if (u.bolt && st.bolt >= 0) {
    const k = st.bolt;
    const lift = sm((k - 0.15) / 0.1) - sm((k - 0.64) / 0.1);
    const pull = sm((k - 0.26) / 0.15) - sm((k - 0.47) / 0.15);
    u.bolt.rotation.z = d.rest.bolt.r.z + lift * 1.15;
    u.bolt.position.z += pull * (u.stroke || 0.075);
    u.bolt.updateMatrix();
    const knob = _tmp.copy(u.charge).sub(d.rest.bolt.p).applyMatrix4(u.bolt.matrix);   // where the knob is now
    const off = _tmp2.set(0.012, -0.022, 0.028);
    const knob0 = u.charge.clone().add(off), mid = R0.clone().lerp(knob0, 0.5).add(new V3(0.03, -0.02, 0.02));
    if (k < 0.14) curveV(R, [[0, R0], [0.07, mid], [0.14, knob0, 1]], k);
    else if (k < 0.76) R.copy(knob).add(off);
    else curveV(R, [[0.76, knob0, 1], [0.87, mid], [1, R0, 1]], k);
    wBolt = sm(k / 0.12) * (1 - sm((k - 0.8) / 0.18));
    // turn the rifle a little so you can see the bolt being worked
    gr.z += 0.16 * wBolt; gr.x -= 0.05 * wBolt; gp.y -= 0.02 * wBolt; gp.x += 0.01 * wBolt;
    gp.z += 0.004 * bump(k, 0.36, 0.48);          // the bolt hits the back
  }

  // ---- magazine reload ----
  const reloading = st.reload >= 0 && u.mag && st.shell < 0;
  if (reloading) {
    const k = st.reload, pistol = kind === 'pistol';
    // lift the gun towards the middle and roll it so you can see the magazine change
    const tilt = sm(k / 0.14) * (1 - sm((k - 0.84) / 0.16));
    // while racking, the gun turns so you see its side and the hand comes over the top from the left
    const wRack = st.reloadEmpty && !u.pump ? sm((k - 0.62) / 0.1) * (1 - sm((k - (u.boltCatch ? 0.8 : 0.86)) / 0.1)) : 0;
    A.wRack = wRack;
    const RK = RACK_POSE[kind] || RACK_POSE.rifle;
    const RP = (RELOAD_POSE[kind] || RELOAD_POSE.rifle).map((v, i) => v + (RK[i] - v) * wRack);
    gp.x += RP[0] * tilt; gp.y += RP[1] * tilt; gp.z += RP[2] * tilt; gr.x += RP[3] * tilt; gr.y += RP[4] * tilt; gr.z += RP[5] * tilt;
    gp.y -= 0.008 * bump(k, 0.17, 0.32);           // tug as the magazine comes out
    gr.x += 0.07 * bump(k, 0.615, 0.7);            // jolt as the new one is slapped home
    gp.y += 0.006 * bump(k, 0.615, 0.68);

    const rest = d.rest.mag;
    const axis = _ax.set(0, -1, 0).applyEuler(rest.r);            // the way the magazine slides out
    const grab = (rot) => _go.copy(u.magGrab || new V3(0, -0.15, 0)).applyEuler(rot).addScaledVector(axis, -0.012);
    const H = (out) => new V3().copy(rest.p).addScaledVector(axis, out).add(grab(rest.r));   // hand holding the magazine pulled `out`
    const H0 = H(0), pouch = H0.clone().add(new V3(-0.13, -0.36, 0.14));
    const OUT = 0.168;
    let carried = false;      // the magazine moves with the hand
    // left hand path
    if (k < 0.14) {
      curveV(L, [[0, L0], [0.07, L0.clone().lerp(H0, 0.5).add(new V3(-0.03, -0.05, 0.02))], [0.14, H0, 1]], k);
    } else if (k < 0.3) {
      const out = 0.008 * sm((k - 0.15) / 0.03) + (OUT - 0.008) * sm((k - 0.18) / 0.12);
      L.copy(H(out)); carried = true;
    } else if (k < 0.44) {
      const H1 = H(OUT);
      curveV(L, [[0.3, H1, 1], [0.36, H1.clone().add(new V3(-0.05, -0.1, 0.05))], [0.44, pouch, 1]], k);
      // the old magazine drops away
      const t = k - 0.3, fall = OUT + 1.2 * t + 26 * t * t;
      u.mag.position.addScaledVector(axis, fall);
      u.mag.position.x -= 0.4 * t * t; u.mag.rotation.x += 6 * t * t;
      u.mag.visible = fall < 0.5;
    } else if (k < 0.62) {
      curveV(L, [[0.44, pouch, 1], [0.53, H(0.11).add(new V3(-0.025, -0.04, 0.02))], [0.585, H(0.03)], [0.62, H0, 1]], k);
      carried = true;
      // the new magazine comes in at a slight angle and straightens as it goes in
      u.mag.rotation.x = rest.r.x + 0.22 * (1 - sm((k - 0.5) / 0.1));
    } else {
      // slap it home, then back to the hold — or rack the slide / charging handle first
      const slap = H0.clone().addScaledVector(axis, -0.006 * bump(k, 0.615, 0.65));
      const rack = st.reloadEmpty && u.charge;
      if (rack && u.boltCatch) {
        // slap the bolt release on the left side; the bolt slams home
        const bc = u.boltCatch, near = bc.clone().add(new V3(-0.035, -0.01, 0.015));
        curveV(L, [[0.64, slap, 1], [0.7, near], [0.735, bc, 1], [0.765, near], [0.9, L0, 1]], k);
        wOver = 0; wMag = 0;
        A.wPress = sm((k - 0.64) / 0.06) * (1 - sm((k - 0.77) / 0.08));
        gp.z += 0.005 * bump(k, 0.735, 0.78); gr.x += 0.03 * bump(k, 0.735, 0.79);
      } else if (!rack || u.pump) {
        if (rack && u.pump) {
          // MAG-7: pump it with the hand that holds the pump
          const back = (sm((k - 0.75) / 0.06) - sm((k - 0.83) / 0.07)) * (u.stroke || 0.055);
          u.pump.position.z += back;
          curveV(L, [[0.64, slap, 1], [0.7, L0.clone().lerp(slap, 0.5).add(new V3(-0.04, -0.03, 0.02))], [0.75, L0, 1]], k);
          if (k >= 0.75) L.copy(L0).z += back;
        } else curveV(L, [[0.64, slap, 1], [0.74, slap.clone().lerp(L0, 0.5).add(new V3(-0.03, -0.04, 0.02))], [0.86, L0, 1]], k);
      } else {
        const pistol2 = !!u.slide;
        const stroke = pistol2 ? 0.006 : (u.stroke || 0.05);
        const C = u.charge.clone();
        if (pistol2) { C.z += 0.026; C.y -= 0.02; }      // grip the slide (locked open) round its middle
        const G0 = 0.745, G1 = 0.79;      // grab, let go
        const pull = sm((k - G0) / (G1 - G0)), back = k < G1 ? pull * stroke : stroke * (1 - sm((k - G1) / 0.012));
        const over = C.clone().lerp(slap, 0.5).add(new V3(-0.08, 0.05, 0.03));
        const Cp = C.clone(); Cp.z += stroke;
        if (k < G0) curveV(L, [[0.64, slap, 1], [0.695, over], [G0, C, 1]], k);
        else if (k < G1) { L.copy(C); L.z += back; }
        else curveV(L, [[G1, Cp, 1], [0.83, Cp.clone().add(new V3(-0.05, -0.01, 0.015))], [0.95, L0, 1]], k);
        if (pistol2) slideBack = k < G0 ? 0.026 : k < G1 ? 0.026 + back : (0.026 + stroke) * (1 - sm((k - G1) / 0.012));
        else if (u.handle) u.handle.position.z += back;
        wOver = sm((k - 0.635) / 0.11) * (1 - sm((k - 0.8) / 0.11));
        gp.z += 0.005 * bump(k, G1, G1 + 0.045);      // the slide / bolt slams forward
      }
    }
    if (carried) {
      // the magazine is wherever the hand holding it is
      u.mag.position.copy(L).sub(grab(u.mag.rotation));
    }
    wMag = sm(k / 0.12) * (1 - sm((k - 0.64) / 0.1));
    if (st.reloadEmpty && u.boltCatch) wMag *= 1 - (A.wPress || 0);
    if (st.reloadEmpty && u.slide && k < 0.745) slideBack = 0.026;     // stays open until racked
  }

  // ---- shotgun shells, one at a time, into the loading port underneath ----
  A.shellW += ((st.shell >= 0 ? 1 : 0) - A.shellW) * (1 - Math.exp(-dt * 7));
  const sw = sm(A.shellW);
  if (sw > 0.001) { gr.z -= 0.5 * sw; gr.x += 0.16 * sw; gr.y += 0.2 * sw; gp.y += 0.04 * sw; gp.x -= 0.03 * sw; }
  let shellAt = null;
  if (st.shell >= 0 && u.port) {
    const k = st.shell, port = u.port;
    const ready = port.clone().add(new V3(-0.01, -0.06, 0.06));
    const pouch = port.clone().add(new V3(-0.09, -0.22, 0.11));
    const entry = port.clone().add(new V3(0, -0.045, 0.045)), inside = port.clone().add(new V3(0, -0.014, -0.012));
    curveV(L, [[0, ready], [0.3, pouch, 1], [0.6, entry], [0.74, inside, 1], [1, ready]], k);
    wMag = 1;
    if (k > 0.3 && k < 0.8) {
      shellAt = L.clone().add(new V3(0, 0.024, -0.012));
      if (k > 0.74) shellAt.add(new V3(0, 0.01, -0.05).multiplyScalar(sm((k - 0.74) / 0.06)));
    }
  }

  // ---- one-handed moments (the Deagle spin): the left hand drops out of the way ----
  if (st.oneHand > 0) {
    // a spot below the screen (camera space) turned into gun space, so it stays below the screen
    // however the gun is turned
    vm.updateMatrix();
    _gm4.compose(gp, _qt.setFromEuler(_e.set(gr.x, gr.y, gr.z)), _one);
    const away = _tmp2.set(-0.2, -0.45, -0.2).applyMatrix4(_inv.copy(vm.matrix).invert()).applyMatrix4(_gm4.invert());
    L.lerp(away, sm(st.oneHand));
  }

  // ---- hammer follows the slide ----
  if (u.slide) u.slide.position.z += slideBack;
  if (u.hammer) u.hammer.rotation.x = 1.35 * clamp01(slideBack / 0.026);

  // ---- gun pose, smoothed against sudden changes ----
  settle(A, 'gp', gp, dt); settle(A, 'gr', gr, dt);
  gun.position.copy(gp);
  gun.rotation.set(gr.x, gr.y, gr.z);
  gun.updateMatrix();

  // ---- hands: position in gun space (jumps soaked up), turned for what they are doing ----
  if (st.oneHand > 0 && A.L) { A.L.prev.copy(L); } else settle(A, 'L', L, dt);
  settle(A, 'R', R, dt);
  const qL = _qL.copy(qHold);
  if (wMag > 0) qL.slerp(Q_MAG, wMag);
  if (wOver > 0) qL.slerp(Q_OVER, wOver);
  const wPress = reloading && st.reloadEmpty && u.boltCatch ? (A.wPress || 0) : 0;
  if (wPress > 0) qL.slerp(Q_PRESS, wPress);
  if (wBolt > 0) qR.slerp(Q_BOLT, wBolt);
  settleQ(A, 'qL', qL, dt); settleQ(A, 'qR', qR, dt);
  placeHand(d.handR, R, qR, gun);
  placeHand(d.handL, L, qL, gun);
  if (st.spin) {
    // the gun spins round the trigger finger: undo the spin for the hand holding it
    d.handR.position.applyAxisAngle(ZAX, -st.spin);
    d.handR.quaternion.premultiply(_qt.setFromAxisAngle(ZAX, -st.spin));
  }

  // a shell in the left hand while loading
  if (shellAt) {
    if (!d.shellMesh) {
      d.shellMesh = new THREE.Group();
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 12), new THREE.MeshStandardMaterial({ color: '#b3262a', roughness: 0.5 }));
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0102, 0.0102, 0.014, 12), new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.8, roughness: 0.3 }));
      r.rotation.x = b.rotation.x = Math.PI / 2; b.position.z = 0.03;
      d.shellMesh.add(r, b);
      gun.add(d.shellMesh);
    }
    d.shellMesh.visible = true;
    d.shellMesh.position.copy(shellAt);
  } else if (d.shellMesh) d.shellMesh.visible = false;

  // ---- forearms: from each wrist to an elbow that hangs from the shoulder ----
  // The elbows are anchored to the camera rather than the gun (so they stay put when the gun
  // turns) and follow the hands part of the way when the hands travel (reloads, racking).
  vm.updateMatrix();
  _inv.copy(vm.matrix).invert();
  const H = st.hold || [vm.position.x, vm.position.y, vm.position.z];
  _bp.set(H[0], H[1], H[2]);
  _base.compose(_bp, _bq.setFromEuler(_e.set(H[4] || 0, H[3] || 0, 0)), _bs.copy(vm.scale));
  _shift.subVectors(vm.position, _bp).multiplyScalar(0.6);
  const elbow = (hand, rest, anchor, out) => {
    // how far the hand has travelled from its normal place, in camera space
    _tmp.copy(hand.position).sub(rest).applyQuaternion(vm.quaternion).multiplyScalar(vm.scale.x);
    return out.copy(anchor).applyMatrix4(_base).add(_shift).addScaledVector(_tmp, 0.55).applyMatrix4(_inv);
  };
  aimForearm(d.armR, d.handR, elbow(d.handR, R0, d.elbowR, _elR));
  const wOut = Math.max(reloading ? (A.wRack || 0) : 0, wPress);
  const anchorL = wOut > 0 ? _anc.copy(d.elbowL).lerp(ELBOW_OUT, wOut) : d.elbowL;
  aimForearm(d.armL, d.handL, elbow(d.handL, L0, anchorL, _elL));
}
const ELBOW_OUT = new V3(-0.5, -0.5, -0.15), _anc = new V3();
const _inv = new THREE.Matrix4(), _base = new THREE.Matrix4(), _bp = new V3(), _bq = new THREE.Quaternion(), _bs = new V3();
const _shift = new V3(), _elR = new V3(), _elL = new V3(), _wr = new V3(), _dir = new V3(), _gm4 = new THREE.Matrix4(), _one = new V3(1, 1, 1);

function placeHand(hand, localPos, localQuat, gun) {
  hand.position.copy(localPos).applyMatrix4(gun.matrix);
  hand.quaternion.copy(gun.quaternion).multiply(localQuat);
}

function aimForearm(arm, hand, elbow) {
  hand.updateMatrix();
  const wrist = _wr.copy(hand.userData.wrist).applyMatrix4(hand.matrix);
  const dir = _dir.subVectors(elbow, wrist);
  const len = dir.length();
  arm.position.copy(wrist);
  arm.quaternion.setFromUnitVectors(UP, dir.normalize());
  arm.scale.set(1, len, 1);
}
