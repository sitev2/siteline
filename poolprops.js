// The Poolrooms' moving things, built in code (no image files): red valve wheels on brass pipes, the drain's big
// wheel with three temperature gauges, the two floaties, the exit hatch. poolview.js places them.
import * as THREE from 'three';

// (not too metallic: on Low there are no reflections, and full metal would come out nearly black)
const brass = () => new THREE.MeshStandardMaterial({ color: '#d2a24c', metalness: 0.45, roughness: 0.32 });
const pipeMat = () => new THREE.MeshStandardMaterial({ color: '#b98d58', metalness: 0.4, roughness: 0.45 });
// the valves' handwheels are painted red (owner's choice)
const wheelPaint = () => new THREE.MeshStandardMaterial({ color: '#c3271d', metalness: 0.15, roughness: 0.42 });
const darkMat = () => new THREE.MeshStandardMaterial({ color: '#2a2622', metalness: 0.4, roughness: 0.6 });

// a wheel of radius r facing +z (its axle along z): rim, spokes, hub, and a handle knob on the rim
export function wheelGeometry(r, spokes = 5) {
  const g = new THREE.Group(), m = wheelPaint();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.085, 10, 36), m);
  g.add(rim);
  for (let k = 0; k < spokes; k++) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.04, r * 0.05, r * 0.92, 8), m);
    const a = k / spokes * Math.PI * 2;
    sp.position.set(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46, 0);
    sp.rotation.z = a - Math.PI / 2;
    g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.18, r * 0.25, 14), m);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.06, r * 0.06, r * 0.32, 8), m);
  knob.rotation.x = Math.PI / 2; knob.position.set(r, 0, r * 0.16);
  g.add(knob);
  return g;
}

// a valve on its pipe. post: a pipe standing from floor to ceiling (else: coming out of the wall).
// Returns { root, wheel } (turn wheel.rotation.z). The root's +z points out of the wall, towards you.
export function makeValve(post, h = 2.8) {
  const root = new THREE.Group(), pm = pipeMat();
  if (post) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, h, 14), pm);
    p.position.set(0, h / 2, -0.12);
    root.add(p);
    for (const y of [0.04, h - 0.04]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 14), pm); f.position.set(0, y, -0.12); root.add(f); }
  } else {
    // a pipe running up the wall, a T, and a short pipe out to the wheel
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, h, 14), pm);
    up.position.set(0.32, h / 2, -0.02 + 0.07);
    root.add(up);
    const across = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.36, 12), pm);
    across.rotation.z = Math.PI / 2; across.position.set(0.15, 1.05, 0.07);
    root.add(across);
    for (const y of [0.5, 2.0]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), darkMat()); c.position.set(0.32, y, 0.02); root.add(c); }
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), pm);
  stem.rotation.x = Math.PI / 2; stem.position.set(0, 1.05, post ? 0 : 0.14);
  root.add(stem);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), pm);
  body.position.set(0, 1.05, post ? -0.04 : 0.08);
  root.add(body);
  const wheel = wheelGeometry(0.27);
  wheel.position.set(0, 1.05, post ? 0.13 : 0.27);
  root.add(wheel);
  return { root, wheel };
}

// a round dial with a pale face, a red band at the top end and a black needle (no writing on it)
function gaugeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#efe9d8'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#2b2620'; g.stroke();
  // the scale: from 7 o'clock round to 5 o'clock; the last part red
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.lineWidth = 9; g.strokeStyle = '#c9392b'; g.beginPath(); g.arc(64, 64, 44, a1 - (a1 - a0) * 0.22, a1); g.stroke();
  g.lineWidth = 3; g.strokeStyle = '#2b2620';
  for (let k = 0; k <= 10; k++) { const a = a0 + (a1 - a0) * k / 10, r0 = k % 5 ? 46 : 40; g.beginPath(); g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(64 + Math.cos(a) * 53, 64 + Math.sin(a) * 53); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// the drain: a pipe stand by the pool with a big wheel on top and three gauges (one per lane, left to right)
// Returns { root, wheel, needles[3], lock } — root's +z points to where you stand.
export function makeDrain() {
  const root = new THREE.Group(), pm = pipeMat();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.15, 16), pm);
  stand.position.set(0, 0.575, -0.05); root.add(stand);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.06, 18), pm); foot.position.set(0, 0.03, -0.05); root.add(foot);
  // the pipe from the stand down into the floor towards the pool
  const down = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12), pm); down.rotation.x = Math.PI / 2; down.position.set(0, 0.12, -0.35); root.add(down);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 16), pm); head.rotation.x = Math.PI / 2; head.position.set(0, 1.12, 0.02); root.add(head);
  const wheel = wheelGeometry(0.42, 6);
  wheel.position.set(0, 1.12, 0.2); root.add(wheel);
  // a heavy brass catch across the wheel: it drops away when every lane is hot
  const lock = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.045), brass()); bar.position.set(0, -0.17, 0);
  lock.add(bar);
  lock.position.set(0.3, 1.32, 0.3);
  root.add(lock);
  const face = new THREE.MeshStandardMaterial({ map: gaugeTexture(), roughness: 0.35, metalness: 0 });
  const needles = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.Group();
    g.position.set((k - 1) * 0.3, 1.58, -0.02);
    g.rotation.x = -0.25;
    const case_ = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.06, 20), brass()); case_.rotation.x = Math.PI / 2; g.add(case_);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), face); dial.position.z = 0.031; g.add(dial);
    const nd = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.085, 0.006), new THREE.MeshBasicMaterial({ color: '#141210' }));
    nd.geometry.translate(0, 0.035, 0);
    const pivot = new THREE.Group(); pivot.position.z = 0.036; pivot.add(nd); g.add(pivot);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 8), pm); post.position.set(0, -0.2, -0.02); g.add(post);
    root.add(g);
    needles.push(pivot);
  }
  // needle angle for heat 0 … 1 (cold at 7 o'clock, hot at 5 o'clock, through the top)
  const setNeedle = (k, h) => { needles[k].rotation.z = Math.PI * 0.75 - h * Math.PI * 1.5; };
  for (let k = 0; k < 3; k++) setNeedle(k, 0);
  return { root, wheel, needles, lock, setNeedle };
}

// a floatie: a fat rubber ring (stripes: alternate quarters in a second colour)
export function makeFloatie(color, stripe) {
  const geo = new THREE.TorusGeometry(0.33, 0.12, 14, 40);
  geo.rotateX(Math.PI / 2);
  const cA = new THREE.Color(color), cB = new THREE.Color(stripe || color), pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i)), q = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2;
    const c = stripe && q ? cB : cA; cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 }));
  const root = new THREE.Group(); root.add(m);
  return root;
}

// the exit hatch: a square of white light in the shaft's ceiling, with a frame and an open lid hanging down
export function makeHatch() {
  const root = new THREE.Group();
  const light = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.9), toneMapped: false }));
  light.rotation.x = Math.PI / 2; root.add(light);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.05, 4, 4), new THREE.MeshStandardMaterial({ color: '#8a8a86', metalness: 0.8, roughness: 0.4 }));
  frame.rotation.set(Math.PI / 2, 0, Math.PI / 4); frame.position.y = -0.02; root.add(frame);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 1.25), new THREE.MeshStandardMaterial({ color: '#9a9a96', metalness: 0.7, roughness: 0.45 }));
  lid.geometry.translate(0, 0, 0.62); lid.position.set(0, -0.03, 0.66); lid.rotation.x = 1.45; root.add(lid);
  return root;
}
