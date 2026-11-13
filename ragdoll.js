// Ragdolls: when a player dies their body goes limp and falls with physics
// (cannon-es). Purely visual and only on each player's own screen — the host
// never simulates them, so they cost nothing on the network.
import * as THREE from 'three';
import * as CANNON from './cannon-es.js';
import { CELL } from './world.js';

const GROUP_WORLD = 1, GROUP_BODY = 2;
const MASS = { pelvis: 10, chest: 14, head: 4, thighL: 6, thighR: 6, shinL: 4, shinR: 4, uarmL: 2.5, uarmR: 2.5, farmL: 1.6, farmR: 1.6 };
// [child, parent, end, cone angle]. The joint sits at one end of the child segment:
// end +1 = its top (hips, knees, shoulders, elbows — limbs hang down from the joint), -1 = its bottom (spine, neck).
const JOINTS = [
  ['chest', 'pelvis', -1, 0.5], ['head', 'chest', -1, 0.6],
  ['thighL', 'pelvis', 1, 0.9], ['thighR', 'pelvis', 1, 0.9],
  ['shinL', 'thighL', 1, 1.1], ['shinR', 'thighR', 1, 1.1],
  ['uarmL', 'chest', 1, 1.4], ['uarmR', 'chest', 1, 1.4],
  ['farmL', 'uarmL', 1, 1.2], ['farmR', 'uarmR', 1, 1.2],
];
const MAX_RAGDOLLS = 6;
const SETTLE_TIME = 7;    // seconds before a body is frozen in place for good

export class Ragdolls {
  constructor(scene, world) {
    this.scene = scene;
    this.map = world;
    this.list = [];
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.solver.iterations = 8;
    const mat = new CANNON.Material('rag');
    this.world.defaultContactMaterial = new CANNON.ContactMaterial(mat, mat, { friction: 0.6, restitution: 0.05 });
    this.world.defaultMaterial = mat;
    const ground = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: GROUP_WORLD, collisionFilterMask: GROUP_BODY });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    this.cellsAdded = new Set();
  }

  // Add the map's walls, floors and props around a spot as static boxes (once per cell).
  // Cells in a row with identical spans are merged into one long box.
  addMapAround(x, z, radius = 3.5) {
    const m = this.map;
    const ix0 = Math.max(0, Math.floor((x - radius) / CELL)), ix1 = Math.min(m.w - 1, Math.floor((x + radius) / CELL));
    const iz0 = Math.max(0, Math.floor((z - radius) / CELL)), iz1 = Math.min(m.h - 1, Math.floor((z + radius) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      let run = null;
      const flush = () => {
        if (!run) return;
        for (const s of run.spans) {
          const hy = Math.max(0.01, (s.y1 - Math.max(-0.5, s.y0)) / 2);
          const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: GROUP_WORLD, collisionFilterMask: GROUP_BODY });
          body.addShape(new CANNON.Box(new CANNON.Vec3((run.n * CELL) / 2, hy, CELL / 2)));
          body.position.set((run.ix + run.n / 2) * CELL, Math.max(-0.5, s.y0) + hy, (iz + 0.5) * CELL);
          this.world.addBody(body);
        }
        run = null;
      };
      for (let ix = ix0; ix <= ix1; ix++) {
        const key = iz * m.w + ix;
        const spans = m.cellSpans(ix, iz);
        if (this.cellsAdded.has(key) || !spans.length) { flush(); continue; }
        this.cellsAdded.add(key);
        const sig = spans.map(s => `${s.y0},${s.y1}`).join('|');
        if (run && run.sig === sig) run.n++;
        else { flush(); run = { ix, n: 1, sig, spans }; }
      }
      flush();
    }
  }

  // model: a player model from makePlayerModel (posed as it was at the moment of death)
  // vel: {x, y, z} the player's velocity; push: {dir: [x, y, z], force, part} the killing blow
  spawn(id, model, vel, push) {
    this.remove(id);
    model.root.updateMatrixWorld(true);
    const rp = model.root.position;
    this.addMapAround(rp.x, rp.z);
    const parts = {};
    const group = new THREE.Group();
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    for (const [name, info] of Object.entries(model.rag)) {
      info.seg.getWorldPosition(wp);
      info.seg.getWorldQuaternion(wq);
      const body = new CANNON.Body({
        mass: MASS[name] || 3, linearDamping: 0.08, angularDamping: 0.5,
        collisionFilterGroup: GROUP_BODY, collisionFilterMask: GROUP_WORLD,
        sleepSpeedLimit: 0.2, sleepTimeLimit: 0.5,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(...info.half)));
      body.position.set(wp.x, Math.max(wp.y, info.half[1] * 0.5), wp.z);
      body.quaternion.set(wq.x, wq.y, wq.z, wq.w);
      body.velocity.set(vel.x || 0, vel.y || 0, vel.z || 0);
      this.world.addBody(body);
      const mesh = info.seg.clone(true);
      mesh.position.copy(wp); mesh.quaternion.copy(wq); mesh.scale.set(1, 1, 1);
      group.add(mesh);
      parts[name] = { body, mesh, half: info.half };
    }
    const constraints = [];
    for (const [child, parent, end, cone] of JOINTS) {
      const a = parts[child], b = parts[parent];
      if (!a || !b) continue;
      const pivotA = new CANNON.Vec3(0, a.half[1] * end, 0);
      const jointW = a.body.pointToWorldFrame(pivotA);
      const pivotB = b.body.pointToLocalFrame(jointW);
      const axisW = a.body.vectorToWorldFrame(new CANNON.Vec3(0, 1, 0));
      const c = new CANNON.ConeTwistConstraint(a.body, b.body, {
        pivotA, pivotB, axisA: new CANNON.Vec3(0, 1, 0), axisB: b.body.vectorToLocalFrame(axisW),
        // cannon-es measures twist against arbitrary reference axes per body, which makes a twist
        // limit yank limbs around at spawn — so twisting is left free and only the cone is limited
        angle: cone, twistAngle: Math.PI, collideConnected: false,
      });
      this.world.addConstraint(c);
      constraints.push(c);
    }
    if (push && push.dir) {
      const target = parts[push.part === 'head' ? 'head' : push.part === 'legs' ? 'thighR' : push.part === 'stomach' ? 'pelvis' : 'chest'] || parts.chest;
      const [dx, dy, dz] = push.dir;
      const imp = new CANNON.Vec3(dx * push.force, dy * push.force, dz * push.force);
      // (applyImpulse takes a point relative to the body's centre; slightly above it adds a little spin)
      target.body.applyImpulse(imp, new CANNON.Vec3(0, target.half[1] * 0.5, 0));
      // a little to the whole body so it doesn't just fold in place
      for (const p of Object.values(parts)) p.body.applyImpulse(imp.scale(0.06 * p.body.mass / 10), new CANNON.Vec3());
    }
    this.scene.add(group);
    this.list.push({ id, parts, constraints, group, age: 0, frozen: false });
    while (this.list.length > MAX_RAGDOLLS) this.dispose(this.list[0]);
  }

  has(id) { return this.list.some(r => r.id === id); }

  // ---------- a ragdoll held by one end (the Backrooms creature has it by an ankle or a wrist) ----------
  // hold(): pins the far end of a part ('shinR' = right ankle, 'farmR' = right wrist) to a point you then move
  // every frame with moveHold(); release() lets go. A held body never settles.
  hold(id, partName) {
    const r = this.list.find(x => x.id === id);
    const part = r && r.parts[partName];
    if (!part) return null;
    this.release(id);
    const end = new CANNON.Vec3(0, -part.half[1], 0);
    const pin = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: 0, collisionFilterMask: 0 });
    pin.position.copy(part.body.pointToWorldFrame(end));
    this.world.addBody(pin);
    const c = new CANNON.PointToPointConstraint(part.body, end, pin, new CANNON.Vec3(0, 0, 0));
    this.world.addConstraint(c);
    r.hold = { pin, c };
    r.age = 0;
    for (const p of Object.values(r.parts)) { p.body.allowSleep = false; p.body.wakeUp(); }
    return { x: pin.position.x, y: pin.position.y, z: pin.position.z };
  }

  moveHold(id, x, y, z, dt) {
    const r = this.list.find(q => q.id === id);
    if (!r || !r.hold) return;
    const pin = r.hold.pin, k = dt > 0 ? 1 / dt : 0;
    // (a hand can move 20 m/s in a slam; the speed handed to the physics is capped so the body whips instead of exploding)
    const cap = v => Math.max(-14, Math.min(14, v));
    pin.velocity.set(cap((x - pin.position.x) * k), cap((y - pin.position.y) * k), cap((z - pin.position.z) * k));
    pin.position.set(x, y, z);
    r.age = 0;
    this.addMapAround(x, z, 2.6);
  }

  release(id) {
    const r = this.list.find(x => x.id === id);
    if (!r || !r.hold) return;
    this.world.removeConstraint(r.hold.c);
    this.world.removeBody(r.hold.pin);
    r.hold = null; r.age = 0;
    for (const p of Object.values(r.parts)) p.body.allowSleep = true;
  }

  held(id) { const r = this.list.find(x => x.id === id); return !!(r && r.hold); }

  // world position of one part's middle ('head', 'chest'…), or null
  partPos(id, name) {
    const r = this.list.find(x => x.id === id);
    return r && r.parts[name] ? r.parts[name].body.position : null;
  }

  showPart(id, name, on) {
    const r = this.list.find(x => x.id === id);
    if (r && r.parts[name]) r.parts[name].mesh.visible = on;
  }

  // a flat ceiling the bodies can't be swung through (the Backrooms: 2.9 m)
  setCeiling(y) {
    const top = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: GROUP_WORLD, collisionFilterMask: GROUP_BODY });
    top.addShape(new CANNON.Plane());
    top.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    top.position.set(0, y, 0);
    this.world.addBody(top);
  }

  // world position of a ragdoll's chest (for the death camera)
  chestOf(id) {
    const r = this.list.find(x => x.id === id);
    return r ? r.parts.chest.body.position : null;
  }

  update(dt) {
    let active = false;
    for (const r of this.list) {
      r.age += dt;
      if (r.frozen) continue;
      if (r.age > SETTLE_TIME) {
        r.frozen = true;
        for (const p of Object.values(r.parts)) { p.body.type = CANNON.Body.STATIC; p.body.mass = 0; p.body.updateMassProperties(); p.body.velocity.set(0, 0, 0); p.body.angularVelocity.set(0, 0, 0); }
        continue;
      }
      active = true;
    }
    if (!active) return;
    this.world.step(1 / 60, Math.min(dt, 0.05), 3);
    for (const r of this.list) {
      if (r.frozen && r.synced) continue;
      for (const p of Object.values(r.parts)) {
        p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
        p.mesh.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      }
      if (r.frozen) r.synced = true;
    }
  }

  dispose(r) {
    if (r.hold) { this.world.removeConstraint(r.hold.c); this.world.removeBody(r.hold.pin); r.hold = null; }
    for (const c of r.constraints) this.world.removeConstraint(c);
    for (const p of Object.values(r.parts)) this.world.removeBody(p.body);
    this.scene.remove(r.group);
    this.list = this.list.filter(x => x !== r);
  }

  remove(id) {
    const r = this.list.find(x => x.id === id);
    if (r) this.dispose(r);
  }

  clear() { for (const r of [...this.list]) this.dispose(r); }
}
