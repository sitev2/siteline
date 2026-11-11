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
  melee: [0.06, -0.3, 0.06, -1.3, 0.2, 0.9],
};

// Looking the gun over. Each inspect is a few poses the hands move the gun through: it eases
// into each pose, drifts a little while you look, then flows on to the next (see `curve`; the
// curve never swings past a pose and back). Keys: [time 0–1, pose].
const INSPECT = {
  // left side, lift it over, right side, a glance down the sights, back
  pistol: { dur: 2.7, keys: [[0, Z], [0.15, [-0.05, 0.045, 0.02, 0.14, 0.86, 0.5]], [0.38, [-0.055, 0.05, 0.02, 0.17, 0.93, 0.56]],
    [0.46, [-0.045, 0.07, 0.0, 0.3, -0.1, 0.0]], [0.54, [-0.07, 0.035, -0.01, 0.1, -1.2, -0.3]], [0.74, [-0.072, 0.04, -0.01, 0.12, -1.26, -0.33]],
    [0.86, [0.0, 0.03, -0.005, 0.2, -0.05, -0.08]], [1, Z]] },
  smg: { dur: 2.9, keys: [[0, Z], [0.16, [-0.055, 0.05, 0.03, 0.2, 0.74, 0.6]], [0.4, [-0.06, 0.058, 0.03, 0.24, 0.8, 0.66]],
    [0.5, [-0.07, 0.075, 0.01, 0.4, 0.05, 0.4]], [0.6, [-0.08, 0.055, 0.0, 0.42, -0.72, 0.38]], [0.8, [-0.082, 0.06, 0.0, 0.45, -0.77, 0.42]], [1, Z]] },
  shotgun: { dur: 3.1, keys: [[0, Z], [0.17, [-0.065, 0.05, 0.03, 0.15, 0.78, 0.52]], [0.4, [-0.07, 0.058, 0.03, 0.19, 0.84, 0.58]],
    [0.5, [-0.08, 0.075, 0.01, 0.38, 0.05, 0.4]], [0.6, [-0.09, 0.055, 0.0, 0.4, -0.68, 0.35]], [0.8, [-0.092, 0.06, 0.0, 0.43, -0.72, 0.38]], [1, Z]] },
  // across the body showing the left side, then raised muzzle-up to the right to show the right
  // side and the magazine (SMGs, shotguns and snipers do the same)
  rifle: { dur: 3.3, keys: [[0, Z], [0.16, [-0.07, 0.06, 0.04, 0.18, 0.78, 0.48]], [0.4, [-0.075, 0.07, 0.04, 0.24, 0.85, 0.53]],
    [0.5, [-0.08, 0.08, 0.01, 0.4, 0.05, 0.42]], [0.6, [-0.09, 0.06, 0.0, 0.42, -0.7, 0.35]], [0.8, [-0.092, 0.065, 0.0, 0.45, -0.74, 0.38]], [1, Z]] },
  sniper: { dur: 3.5, keys: [[0, Z], [0.18, [-0.07, 0.04, -0.04, 0.22, 0.88, 0.3]], [0.42, [-0.075, 0.047, -0.04, 0.26, 0.94, 0.33]],
    [0.52, [-0.07, 0.065, -0.05, 0.36, 0.1, 0.2]], [0.62, [-0.09, 0.045, -0.04, 0.38, -0.65, 0.3]], [0.82, [-0.092, 0.05, -0.04, 0.41, -0.7, 0.33]], [1, Z]] },
  bomb: { dur: 2.4, keys: [[0, Z], [0.25, [0, 0.06, 0.06, 0.8, 0.25, 0.05]], [0.45, [0, 0.065, 0.06, 0.84, 0.3, 0.08]], [0.65, [0, 0.06, 0.06, 0.8, -0.3, 0.2]], [0.8, [0, 0.062, 0.06, 0.82, -0.34, 0.22]], [1, Z]] },
  // the spoon: hold it up, admire both sides, give it a twirl
  melee: { dur: 2.8, keys: [[0, Z], [0.16, [-0.1, 0.09, 0.02, 0.75, 0.5, 0.2]], [0.36, [-0.1, 0.1, 0.02, 0.8, 0.55, 0.25]], [0.5, [-0.09, 0.1, 0.02, 0.8, -2.3, 0.1]], [0.68, [-0.09, 0.1, 0.02, 0.82, -2.4, 0.1]], [0.8, [-0.05, 0.07, 0, 0.5, -0.6, 0]], [1, [0, 0, 0, 0, 0, -6.2832]]] },
};

// a few guns get their own flourish
const SPECIAL = {
  // left side, right side, then the left hand lets go and the gun is spun forwards round the
  // trigger finger (see `spin`) and caught
  deagle: { dur: 3.1, keys: [[0, Z], [0.12, [-0.05, 0.045, 0.02, 0.14, 0.86, 0.5]], [0.29, [-0.055, 0.05, 0.02, 0.17, 0.93, 0.56]],
    [0.37, [-0.045, 0.07, 0.0, 0.3, -0.1, 0.0]], [0.44, [-0.07, 0.035, -0.01, 0.1, -1.2, -0.3]], [0.53, [-0.072, 0.04, -0.01, 0.12, -1.26, -0.33]],
    [0.65, [-0.025, 0.03, -0.035, 0.04, 0.75, 0.12]], [0.86, [-0.025, 0.03, -0.035, 0.03, 0.72, 0.1]], [1, Z]],
    spin: { at: 2.16, windup: 0.12, dur: 0.3, settle: 0.14, hand: [0.57, 0.97], pivot: [0, -0.028, -0.05] } },
  glock: { dur: 2.6, keys: [[0, Z], [0.15, [-0.045, 0.05, 0.02, 0.24, 0.72, 0.85]], [0.38, [-0.05, 0.056, 0.02, 0.28, 0.77, 0.92]],
    [0.46, [-0.045, 0.07, 0.0, 0.32, -0.05, 0.1]], [0.55, [-0.065, 0.03, -0.01, 0.0, -1.15, -0.55]], [0.78, [-0.068, 0.035, -0.01, -0.02, -1.2, -0.58]], [1, Z]] },
  ak47: { dur: 3.3, keys: [[0, Z], [0.16, [-0.07, 0.065, 0.04, 0.2, 0.8, 0.62]], [0.4, [-0.075, 0.075, 0.04, 0.26, 0.86, 0.68]],
    [0.5, [-0.08, 0.085, 0.01, 0.42, 0.05, 0.45]], [0.6, [-0.09, 0.06, 0.0, 0.45, -0.72, 0.4]], [0.8, [-0.092, 0.065, 0.0, 0.48, -0.76, 0.44]], [1, Z]] },
  awp: { dur: 3.6, keys: [[0, Z], [0.18, [-0.075, 0.045, -0.045, 0.3, 0.98, 0.2]], [0.42, [-0.08, 0.052, -0.045, 0.34, 1.04, 0.23]],
    [0.52, [-0.075, 0.068, -0.055, 0.4, 0.15, 0.15]], [0.62, [-0.095, 0.045, -0.045, 0.4, -0.68, 0.28]], [0.82, [-0.097, 0.05, -0.045, 0.43, -0.73, 0.31]], [1, Z]] },
  mag7: { dur: 3.0, keys: [[0, Z], [0.17, [-0.055, 0.06, 0.03, 0.42, 0.62, 0.5]], [0.4, [-0.06, 0.068, 0.03, 0.47, 0.66, 0.55]],
    [0.5, [-0.075, 0.08, 0.01, 0.48, 0.05, 0.4]], [0.6, [-0.085, 0.055, 0.0, 0.42, -0.68, 0.35]], [0.8, [-0.087, 0.06, 0.0, 0.45, -0.72, 0.38]], [1, Z]] },
};

const TYPE = { pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', sniper: 'sniper', bomb: 'bomb', melee: 'melee' };

// Swinging the spoon. A slash sweeps across the screen (alternating high-to-low and low-to-high);
// a stab pulls back and jabs straight out.
const SLASH = { dur: 0.42, keys: [[0, Z], [0.14, [0.05, 0.04, 0.03, 0.2, -0.35, -0.3]], [0.4, [-0.2, -0.01, -0.1, -0.25, 0.85, 0.75]], [0.58, [-0.27, -0.05, -0.05, -0.35, 1.15, 0.95]], [1, Z]] };
const STAB = { dur: 0.6, keys: [[0, Z], [0.2, [0.02, 0.03, 0.11, 0.3, -0.05, 0]], [0.4, [-0.07, 0.06, -0.17, -0.42, 0.28, 0.15]], [0.56, [-0.07, 0.06, -0.16, -0.4, 0.28, 0.15]], [1, Z]] };
// t = seconds since the swing started, dir = 1 or -1; returns a pose, or null when it's over
export function swingPose(stab, t, dir = 1) {
  const def = stab ? STAB : SLASH;
  const k = t / def.dur;
  if (k >= 1 || k < 0) return null;
  const p = curve(def.keys, k, 6);
  if (!stab && dir < 0) { p[1] = -p[1] * 0.6 + 0.03 * Math.sin(Math.PI * k); p[3] = -p[3]; p[5] *= 0.6; }
  return p;
}


const easeOut = t => 1 - Math.pow(1 - t, 3);

// ---------- smooth curves through keyframes ----------
// A Hermite curve whose speed carries through each key (no stop-start at every key), easing
// in at the first key and out at the last. keys: [[t, [values…], stop?], …]; a key marked
// `stop` is a dead stop (a hand grabbing something, say).
function tan(keys, i, j) {
  if (i === 0 || i === keys.length - 1 || keys[i][2]) return 0;
  return (keys[i + 1][1][j] - keys[i - 1][1][j]) / (keys[i + 1][0] - keys[i - 1][0]);
}
// The same, but it never swings past a key and back (monotone): fast moves glide into a slow
// drift instead of overshooting the pose and wobbling back. Used for inspects.
function tanSoft(keys, i, j) {
  if (i === 0 || i === keys.length - 1 || keys[i][2]) return 0;
  const h0 = keys[i][0] - keys[i - 1][0], h1 = keys[i + 1][0] - keys[i][0];
  const d0 = (keys[i][1][j] - keys[i - 1][1][j]) / h0, d1 = (keys[i + 1][1][j] - keys[i][1][j]) / h1;
  if (d0 * d1 <= 0) return 0;
  const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}
function curve(keys, k, n, tf = tan) {
  const last = keys.length - 1;
  if (k <= keys[0][0]) return keys[0][1].slice(0, n);
  if (k >= keys[last][0]) return keys[last][1].slice(0, n);
  let i = 0;
  while (keys[i + 1][0] < k) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1];
  const h = t1 - t0 || 1e-6, u = (k - t0) / h, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const out = new Array(n);
  for (let j = 0; j < n; j++) out[j] = h00 * a[j] + h10 * h * tf(keys, i, j) + h01 * b[j] + h11 * h * tf(keys, i + 1, j);
  return out;
}
// the same for points: keys [[t, Vector3, stop?], …]
function curveV(out, keys, k) {
  const r = curve(keys.map(([t, v, stop]) => [t, [v.x, v.y, v.z], stop]), k, 3);
  return out.set(r[0], r[1], r[2]);
}

const inspectDef = (weaponId, type) => SPECIAL[weaponId] || INSPECT[TYPE[type]] || INSPECT.rifle;

// t = seconds since the inspect started; returns a pose, or null when it's over
export function inspectPose(weaponId, type, t) {
  const def = inspectDef(weaponId, type);
  const k = t / def.dur;
  if (k >= 1) return null;
  const p = curve(def.keys, k, 6, tanSoft);
  // hands are never perfectly still: a slow, small sway while you look (none at the start and end)
  const life = Math.sin(Math.PI * k) ** 2;
  p[0] += 0.0022 * Math.sin(t * 2.3) * life;
  p[1] += 0.0018 * Math.sin(t * 1.7 + 1.3) * life;
  p[3] += 0.014 * Math.sin(t * 1.9 + 2.1) * life;
  p[4] += 0.016 * Math.sin(t * 1.3 + 0.4) * life;
  p[5] += 0.014 * Math.sin(t * 2.1 + 0.9) * life;
  return p;
}

// One-handed tricks during an inspect (the Deagle spin), t = seconds since it started:
// { oneHand: 0–1 how far the left hand has let go, spin: the gun's forward turn round the trigger
// finger (radians, a full turn is -2π), wrist: how far the right hand flicks with it }
const TURN = Math.PI * 2;
export function inspectTrick(weaponId, type, t) {
  const def = inspectDef(weaponId, type), s = def.spin;
  if (!s || t < 0 || t >= def.dur) return null;
  const k = t / def.dur;
  const oneHand = sm((k - s.hand[0]) / 0.06) * (1 - sm((k - s.hand[1] + 0.06) / 0.06));
  // cock the wrist back (muzzle up), flick it forwards, catch it after one full turn
  const COCK = 0.32, OVER = 0.12;
  let spin = 0, wrist = 0;
  const t0 = s.at - s.windup;
  if (t >= t0 && t < s.at) {
    spin = wrist = COCK * sm((t - t0) / s.windup);
  } else if (t >= s.at) {
    const u = (t - s.at) / s.dur;
    if (u < 1) {
      // starts at full speed (the flick) and slows into the catch: snappy, not floaty
      const e = 1 - Math.pow(1 - u, 2.6);
      spin = COCK - (TURN + COCK + OVER) * e;
      wrist = COCK - (COCK + 0.3) * sm(u / 0.45) + 0.3 * sm((u - 0.45) / 0.55);
    } else {
      // the catch: settle back from the little overshoot
      const c = clamp01((t - s.at - s.dur) / s.settle);
      spin = -TURN - OVER * (1 - sm(c));
      wrist = -0.05 * Math.sin(Math.PI * c);
    }
  }
  return { oneHand, spin, wrist, pivot: s.pivot };
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
// `fast` = the quickest a value moves in a normal animation (per second): anything quicker is
// a jump. (Positions move up to ~2.5 m/s, turns up to ~8 rad/s during a pistol reload.)
const _j = new V3(), _k = new V3();
function settle(A, name, raw, dt, fast = 3.5) {
  let s = A[name];
  if (!s) s = A[name] = { prev: raw.clone(), off: new V3(), vel: new V3() };
  _j.subVectors(raw, s.prev);
  if (_j.length() > fast * dt + 0.004) s.off.sub(_j);
  s.prev.copy(raw);
  // critically damped spring, solved exactly so it always comes back to rest, at any frame rate
  // (a step-by-step version froze below ~32 fps, so each reload left the gun a little more turned)
  const w = 16, e = Math.exp(-w * dt);
  _k.copy(s.vel).addScaledVector(s.off, w);
  s.off.addScaledVector(_k, dt).multiplyScalar(e);
  s.vel.addScaledVector(_k, -w * dt).multiplyScalar(e);
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
  if (u.rot) gr.copy(u.rot);        // a melee weapon is tipped forward in the fist

  // ---- where the hands normally hold the gun ----
  const R0 = _R0.copy(u.grip), L0 = _L0.copy(u.fore || u.grip);
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
  const trick = st.trick || null, oneHand = trick ? trick.oneHand : 0;
  if (oneHand > 0) {
    // a spot below the screen (camera space) turned into gun space, so it stays below the screen
    // however the gun is turned
    vm.updateMatrix();
    _gm4.compose(gp, _qt.setFromEuler(_e.set(gr.x, gr.y, gr.z)), _one);
    const away = _tmp2.set(-0.2, -0.45, -0.2).applyMatrix4(_inv.copy(vm.matrix).invert()).applyMatrix4(_gm4.invert());
    L.lerp(away, sm(oneHand));
  }

  // ---- hammer follows the slide ----
  if (u.slide) u.slide.position.z += slideBack;
  if (u.hammer) u.hammer.rotation.x = 1.35 * clamp01(slideBack / 0.026);

  // ---- gun pose, smoothed against sudden changes ----
  settle(A, 'gp', gp, dt); settle(A, 'gr', gr, dt, 20);
  gun.position.copy(gp);
  gun.rotation.set(gr.x, gr.y, gr.z);
  gun.updateMatrix();
  // what the hands hold on to: normally the gun itself
  const base = _gunM.copy(gun.matrix), baseQ = _gunQ.copy(gun.quaternion);
  const frameR = _frameR.copy(base), qFrameR = _qFrameR.copy(baseQ);
  if (trick) {
    // a spin: the gun turns forwards round the trigger finger while the hand only flicks
    const pv = _pv.fromArray(trick.pivot);
    if (trick.wrist) { frameR.multiply(aboutPivot(_ms, pv, trick.wrist)); qFrameR.multiply(_qt.setFromAxisAngle(XAX, trick.wrist)); }
    if (trick.spin) {
      _ms2.copy(base).multiply(aboutPivot(_ms, pv, trick.spin)).decompose(gun.position, gun.quaternion, gun.scale);
      gun.updateMatrix();
    }
  }

  // ---- hands: position in gun space (jumps soaked up), turned for what they are doing ----
  if (oneHand > 0 && A.L) { A.L.prev.copy(L); } else settle(A, 'L', L, dt);
  settle(A, 'R', R, dt);
  const qL = _qL.copy(qHold);
  if (wMag > 0) qL.slerp(Q_MAG, wMag);
  if (wOver > 0) qL.slerp(Q_OVER, wOver);
  const wPress = reloading && st.reloadEmpty && u.boltCatch ? (A.wPress || 0) : 0;
  if (wPress > 0) qL.slerp(Q_PRESS, wPress);
  if (wBolt > 0) qR.slerp(Q_BOLT, wBolt);
  settleQ(A, 'qL', qL, dt); settleQ(A, 'qR', qR, dt);
  placeHand(d.handR, R, qR, frameR, qFrameR);
  placeHand(d.handL, L, qL, base, baseQ);

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

// frame: the gun's matrix (or the hand's own frame during a spin), frameQ: its turn
function placeHand(hand, localPos, localQuat, frame, frameQ) {
  hand.position.copy(localPos).applyMatrix4(frame);
  hand.quaternion.copy(frameQ).multiply(localQuat);
}
// turning by `a` round the x axis through the point pv
function aboutPivot(out, pv, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return out.makeRotationX(a).setPosition(0, pv.y - (c * pv.y - s * pv.z), pv.z - (s * pv.y + c * pv.z));
}
const XAX = new V3(1, 0, 0), _pv = new V3(), _ms = new THREE.Matrix4(), _ms2 = new THREE.Matrix4();
const _gunM = new THREE.Matrix4(), _gunQ = new THREE.Quaternion(), _frameR = new THREE.Matrix4(), _qFrameR = new THREE.Quaternion();

function aimForearm(arm, hand, elbow) {
  hand.updateMatrix();
  const wrist = _wr.copy(hand.userData.wrist).applyMatrix4(hand.matrix);
  const dir = _dir.subVectors(elbow, wrist);
  const len = dir.length();
  arm.position.copy(wrist);
  arm.quaternion.setFromUnitVectors(UP, dir.normalize());
  arm.scale.set(1, len, 1);
}
