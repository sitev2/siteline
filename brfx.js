// The Backrooms on each player's own screen: people being snatched (by the ceiling or round a corner),
// paper notes, hallucinations (only you see or hear them), flashlights lighting the baked walls, and
// people dimming in the dark areas. Nothing here decides anything — the host does that.
import * as THREE from 'three';
import { FLASH, addFlash } from './brview.js';
import { BR } from './brmap.js';
import { EYE } from './world.js';
import { makeSnatchArm, makeMonsterModel, animateMonster, makePlayerModel, animateModel, setModelWeapon } from './models.js';
import * as sfx from './audio.js';
import { cleanChat } from './filter.js';

const $ = id => document.getElementById(id);
const H = BR.ceiling;
const smooth = t => t * t * (3 - 2 * t);

// a paper note drawn on a canvas: paper, tape (on walls), the drawing, the writing
export function paintNote(canvas, note, drawing) {
  const g = canvas.getContext('2d'), S = canvas.width;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#f3efe2'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(120,140,170,0.25)'; g.lineWidth = 1;
  for (let y = 40; y < S; y += 24) { g.beginPath(); g.moveTo(10, y); g.lineTo(S - 10, y); g.stroke(); }
  if (drawing) g.drawImage(drawing, 0, 0, S, S);
  // an explorer log: the clue's own little drawing under the writing (smaller writing, so both fit)
  const log = note.log != null ? LOGS[note.log] : null;
  if (log) { g.save(); g.scale(S / 256, S / 256); log.draw(g); g.restore(); }
  if (note.text) {
    g.fillStyle = '#1f2a44';
    g.font = `${Math.round(S / (log ? 13 : 10))}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
    const words = note.text.split(' '), lines = [];
    let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > S - 24 && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    if (log) lines.slice(0, 4).forEach((l, i) => g.fillText(l, 12, S / 13 + 10 + i * (S / 11)));
    else lines.slice(0, 7).forEach((l, i) => g.fillText(l, 12, S / 10 + 8 + i * (S / 9)));
  }
  if (note.wall) {
    g.fillStyle = 'rgba(230,225,190,0.75)';
    g.save(); g.translate(S * 0.18, 6); g.rotate(-0.2); g.fillRect(-22, -6, 44, 14); g.restore();
    g.save(); g.translate(S * 0.82, 6); g.rotate(0.2); g.fillRect(-22, -6, 44, 14); g.restore();
  }
}

// explorer logs: notes from people who were here before. Each is a clue about what to do, with a little
// pencil drawing (our own words and pictures). brmap.js picks which ones go where (plan.logs, k = index).
const WHO = ['M.', 'unit 7', 'R.', 'someone', '?', 'J. (day 3)'];
const pen = (g, w = 2.4, a = 0.85) => { g.strokeStyle = `rgba(35,35,48,${a})`; g.fillStyle = `rgba(35,35,48,${a})`; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; };
const line = (g, ...p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };
const stick = (g, x, y, s = 1) => {      // a little person standing at (x, y) = feet
  g.beginPath(); g.arc(x, y - 44 * s, 7 * s, 0, Math.PI * 2); g.stroke();
  line(g, x, y - 37 * s, x, y - 16 * s); line(g, x - 11 * s, y - 30 * s, x, y - 26 * s, x + 11 * s, y - 30 * s); line(g, x - 9 * s, y, x, y - 16 * s, x + 9 * s, y);
};
const shadow = (g, x, y, s = 1) => {     // it: a scribbled black figure with two dots for eyes
  g.save(); g.fillStyle = 'rgba(20,20,26,0.9)';
  g.beginPath(); g.ellipse(x, y - 50 * s, 9 * s, 11 * s, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(x - 12 * s, y - 40 * s); g.lineTo(x + 12 * s, y - 40 * s); g.lineTo(x + 9 * s, y); g.lineTo(x - 9 * s, y); g.fill();
  line(g, x - 12 * s, y - 38 * s, x - 22 * s, y - 8 * s); line(g, x + 12 * s, y - 38 * s, x + 22 * s, y - 8 * s);
  g.fillStyle = '#f3efe2'; g.fillRect(x - 5 * s, y - 53 * s, 3, 3); g.fillRect(x + 2 * s, y - 53 * s, 3, 3);
  g.restore();
};
const cross = (g, x, y, r) => { g.save(); g.strokeStyle = 'rgba(170,30,30,0.85)'; g.lineWidth = 4; line(g, x - r, y - r, x + r, y + r); line(g, x + r, y - r, x - r, y + r); g.restore(); };
export const LOGS = [
  { text: 'Walk. Never run, it hears running. The way out is a door that stands on its own.', draw(g) {
    stick(g, 70, 236); pen(g, 1.6, 0.6); for (const r of [14, 22]) { g.beginPath(); g.arc(70, 226, r, -0.9, 0.9); g.stroke(); }
    cross(g, 92, 222, 16);
    pen(g); g.strokeRect(150, 168, 64, 64); line(g, 182, 232, 182, 196, 200, 196, 200, 232); g.fillRect(193, 214, 3, 3);
    pen(g, 1.4, 0.5); g.setLineDash([4, 5]); g.strokeRect(138, 156, 88, 88); g.setLineDash([]);
  } },
  { text: "It can't open doors. Shut them behind you. It has to break them.", draw(g) {
    pen(g); g.strokeRect(96, 150, 56, 90); g.fillRect(140, 196, 4, 4); shadow(g, 196, 240, 1.1); stick(g, 52, 240);
    pen(g, 2, 0.7); line(g, 170, 200, 158, 196); line(g, 170, 210, 158, 214);
  } },
  { text: 'Never walk under a missing ceiling tile. Something lives up there.', draw(g) {
    pen(g, 1.6, 0.6); for (let x = 40; x <= 220; x += 36) line(g, x, 140, x, 176); for (const y of [140, 158, 176]) line(g, 40, y, 220, y);
    g.fillStyle = 'rgba(15,15,20,0.95)'; g.fillRect(112, 158, 36, 18);
    pen(g, 2.6); line(g, 124, 176, 120, 200, 116, 214); line(g, 136, 176, 140, 202, 146, 214); line(g, 116, 214, 110, 222); line(g, 116, 214, 118, 224); line(g, 146, 214, 152, 222);
    stick(g, 128, 248, 0.7);
  } },
  { text: 'The dark rooms are black. Keep your light for them.', draw(g) {
    g.fillStyle = 'rgba(25,25,32,0.85)'; g.fillRect(28, 140, 200, 104);
    g.fillStyle = 'rgba(243,239,226,0.9)'; g.beginPath(); g.moveTo(60, 196); g.lineTo(220, 156); g.lineTo(220, 236); g.fill();
    pen(g, 2.4, 0.95); g.save(); g.translate(48, 196); g.strokeStyle = '#f3efe2'; g.strokeRect(-18, -8, 28, 16); g.restore();
  } },
  { text: 'Following one wall only walks you in circles. I tried. Twice.', draw(g) {
    pen(g); g.strokeRect(46, 140, 164, 100); g.strokeRect(96, 172, 64, 36);
    pen(g, 1.8, 0.6); g.setLineDash([5, 5]); g.strokeRect(62, 154, 132, 72); g.setLineDash([]);
    pen(g, 2.2); line(g, 194, 190, 194, 206); line(g, 188, 200, 194, 208, 200, 200);
    g.font = '18px "Segoe Print", "Comic Sans MS", cursive'; g.fillStyle = 'rgba(35,35,48,0.85)'; g.fillText('door', 104, 196);
  } },
  { text: "If someone stands too still and just stares, it isn't them any more. Keep away.", draw(g) {
    pen(g); stick(g, 70, 240); stick(g, 180, 240);
    g.fillStyle = 'rgba(35,35,48,0.9)'; g.fillRect(176, 194, 3, 3); g.fillRect(183, 194, 3, 3);
    pen(g, 1.6, 0.7); line(g, 194, 186, 200, 180, 196, 176, 202, 170); line(g, 162, 186, 156, 180, 160, 176, 154, 170);
    g.font = '30px "Segoe Print", "Comic Sans MS", cursive'; g.fillStyle = 'rgba(170,30,30,0.85)'; g.fillText('?', 120, 200);
  } },
  { text: "Arrows on the walls only show roughly which way. Not how to get there.", draw(g) {
    pen(g, 2.4); line(g, 40, 200, 200, 200); line(g, 178, 182, 202, 200, 178, 218);
    pen(g, 1.6, 0.6); g.beginPath(); g.arc(128, 200, 46, 0, Math.PI * 2); g.stroke();
    g.font = '20px "Segoe Print", "Comic Sans MS", cursive'; g.fillStyle = 'rgba(35,35,48,0.85)'; g.fillText('N', 122, 148); g.fillText('~', 214, 206);
  } },
  { text: 'In the rooms with holes, keep to the strips between them. Slowly.', draw(g) {
    g.fillStyle = 'rgba(20,20,26,0.9)';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g.fillRect(40 + c * 46, 146 + r * 50, 34, 38);
    pen(g, 2, 0.7); g.setLineDash([4, 6]); line(g, 30, 190, 80, 190, 80, 240, 222, 240); g.setLineDash([]);
  } },
  { text: 'If it freezes when you look at it, keep looking and back away. Slowly.', draw(g) {
    pen(g); g.beginPath(); g.ellipse(70, 196, 34, 18, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(70, 196, 9, 0, Math.PI * 2); g.fill();
    shadow(g, 190, 244, 1);
    pen(g, 1.6, 0.6); g.setLineDash([3, 5]); line(g, 106, 196, 166, 196); g.setLineDash([]);
  } },
  // the gates (9 the key, 10 the heavy door, 11 the two levers): taped up near each one
  { text: "The locked door's key is up on a shelf on this side. Too high for one: climb on a friend's shoulders.", draw(g) {
    stick(g, 120, 248); stick(g, 120, 206, 0.9);
    pen(g, 2.2); line(g, 60, 150, 110, 150); line(g, 66, 150, 66, 160); line(g, 104, 150, 104, 160);
    g.save(); g.strokeStyle = 'rgba(35,35,48,0.9)'; g.lineWidth = 2.5; g.beginPath(); g.arc(80, 143, 6, 0, Math.PI * 2); g.stroke(); line(g, 86, 143, 100, 143); g.restore();
    pen(g, 2); line(g, 128, 176, 104, 152);
    g.font = '30px "Segoe Print", "Comic Sans MS", cursive'; g.fillStyle = 'rgba(170,30,30,0.85)'; g.fillText('!', 150, 160);
  } },
  { text: 'The grey door is too heavy for one person. Two of you push at the same moment.', draw(g) {
    pen(g); g.strokeRect(150, 140, 60, 104); line(g, 150, 160, 210, 160); line(g, 150, 200, 210, 200);
    stick(g, 100, 244); stick(g, 126, 244);
    pen(g, 2); line(g, 111, 214, 148, 210); line(g, 137, 214, 148, 218);
    g.font = '22px "Segoe Print", "Comic Sans MS", cursive'; g.fillStyle = 'rgba(35,35,48,0.85)'; g.fillText('+', 108, 176);
  } },
  { text: 'The striped door is the way out. Past the big pits there is a room with two levers: pull both together.', draw(g) {
    pen(g); g.strokeRect(36, 160, 34, 48); g.strokeRect(186, 160, 34, 48); line(g, 53, 176, 53, 196); line(g, 203, 176, 203, 196);
    g.save(); g.strokeStyle = 'rgba(35,35,48,0.6)'; g.setLineDash([4, 6]); line(g, 70, 184, 186, 184); g.restore();
    g.font = '24px "Segoe Print", "Comic Sans MS", cursive'; g.fillStyle = 'rgba(35,35,48,0.9)'; g.fillText('1 2 3', 98, 176);
    stick(g, 53, 252, 0.7); stick(g, 203, 252, 0.7);
  } },
];

export class BackroomsFX {
  constructor(game, built) {
    this.g = game;
    this.built = built.group.userData;
    this.scene = game.scene;
    this.notes = new Map();           // id → { note, mesh }
    this.events = [];                 // snatch animations in progress
    this.heads = [];                  // heads the ceiling spat back out: { wait, x, z, name, obj, v, spin }
    this.bodies = new Map();          // bodies it has caught: id → { mode: 'held' (a ragdoll pinned to its hand) | 'loose' | 'hung' (+ model) }
    this.darkK = 0;                   // the lights dying round it (0 … 1)
    this.heartAt = 0; this.breathAt = 0;
    this.follow = null;               // footsteps behind you that copy yours
    this.caught = null;               // caught by it: you see the slam through your own eyes
    this.staticK = 0;                 // how close it is, 0 … 1 (screen shake and the rumble)
    this.hallu = null;                // a hallucination being shown
    this.halluAt = 60 + Math.random() * 40;
    this.editing = false;
    this.built.onSpark = (x, y, z) => sfx.playBR('spark', { x, y, z }, game.occlusion(x, y, z), 0.8);
    this.bindEditor();
  }

  destroy() {
    clearTimeout(this.blackTimer);
    sfx.setDread(0);
    FLASH.uDark.value.w = 0;
    for (const [el, ev, fn] of this.bound || []) el.removeEventListener(ev, fn);
    $('note-editor').classList.add('hidden');
    $('note-read').classList.add('hidden');
    $('br-black').classList.add('hidden');
    $('br-map').classList.add('hidden');
    $('br-escape').classList.add('hidden');
  }

  onMessage(m) {
    if (m.t === 'snatch') { this.onSnatch(m); return true; }
    if (m.t === 'note') { this.addNote(m.note); return true; }
    if (m.t === 'lure') { this.onLure(m); return true; }
    if (m.t === 'dropBody' || m.t === 'hangBody') { this.placeBody(m); return true; }
    return false;
  }

  // ---------- snatches ----------
  onSnatch(m) {
    const g = this.g, me = m.id === g.myId;
    const r = me ? null : g.remotes.get(m.id);
    const from = me ? { x: g.me.pos.x, y: g.me.pos.y, z: g.me.pos.z } : r ? { x: r.rp.x, y: r.rp.y, z: r.rp.z } : null;
    if (!from) return;
    const arm = makeSnatchArm();
    const outer = new THREE.Group(), inner = new THREE.Group();
    outer.add(inner); inner.add(arm.root);
    this.scene.add(outer);
    if (m.kind === 'corner') {
      const dx = from.x - m.x, dz = from.z - m.z;
      outer.position.set(m.x, 1.35, m.z);
      outer.rotation.y = Math.atan2(-dz, dx);
      inner.rotation.z = Math.PI / 2;           // the arm (hanging along -y) now points at the victim
    } else outer.position.set(m.x, H + 2.2, m.z);
    const ev = { kind: m.kind, x: m.x, z: m.z, t: 0, from, me, r, arm, outer, dist: Math.hypot(from.x - m.x, from.z - m.z) };
    this.events.push(ev);
    const pos = { x: m.x, y: m.kind === 'corner' ? 1.2 : H, z: m.z };
    sfx.playBR(m.kind === 'corner' ? 'corner' : 'ceiling', me ? null : pos, me ? 0 : g.occlusion(pos.x, pos.y, pos.z), me ? 1.2 : 1);
    if (me) { g.shake = 2; this.mine = ev; }
    // 2.5 s later the thing in the ceiling spits your head back out (the suit's hood, visor and all)
    if (m.kind === 'ceiling') {
      const ro = (g.roster || []).find(p => p.id === m.id);
      this.heads.push({ wait: 2.5, x: m.x, z: m.z, name: me ? g.settings.name : ro ? ro.name : '' });
    }
  }

  // the heads: wait, drop out of the hole, bounce and roll to a stop on the carpet (and stay there)
  updateHeads(dt) {
    const g = this.g, w = g.world, R = 0.14;
    for (const h of this.heads) {
      if (!h.obj) {
        h.wait -= dt;
        if (h.wait > 0) continue;
        const model = makePlayerModel('atk', h.name, false, 'hazmat');
        const head = model.rag.head.seg;
        head.parent.remove(head);
        head.position.set(0, 0, 0);
        h.obj = new THREE.Group();
        h.obj.add(head);
        h.obj.position.set(h.x, H - 0.1, h.z);
        h.obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        this.scene.add(h.obj);
        const a = Math.random() * Math.PI * 2, sp = 0.7 + Math.random() * 0.8;
        h.v = { x: Math.cos(a) * sp, y: -2.2, z: Math.sin(a) * sp };
        h.spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9);
        h.bounces = 0;
        const pos = { x: h.x, y: H, z: h.z };
        sfx.playBR('spit', pos, g.occlusion(pos.x, pos.y, pos.z), 1.1);
        continue;
      }
      if (h.still) continue;
      const o = h.obj.position, v = h.v;
      v.y -= 9.8 * dt;
      // roll off walls and pillars
      const nx = o.x + v.x * dt, nz = o.z + v.z * dt;
      if (w.blocked(nx, o.z, R, 0.05)) v.x *= -0.4; else o.x = nx;
      if (w.blocked(o.x, nz, R, 0.05)) v.z *= -0.4; else o.z = nz;
      o.y += v.y * dt;
      h.obj.rotation.x += h.spin.x * dt; h.obj.rotation.y += h.spin.y * dt; h.obj.rotation.z += h.spin.z * dt;
      if (o.y < R && v.y < 0) {
        o.y = R;
        if (h.bounces++ < 3 && v.y < -1) {
          const pos = { x: o.x, y: 0.1, z: o.z };
          sfx.playBR('thud', pos, g.occlusion(pos.x, pos.y, pos.z), Math.min(1, -v.y / 5));
        }
        v.y = -v.y * 0.3;
        if (v.y < 0.4) v.y = 0;
        v.x *= 0.75; v.z *= 0.75;
        h.spin.multiplyScalar(0.6);
      }
      // on the floor it rolls to a stop, settling on the back of the hood with the visor staring up
      if (o.y <= R + 0.001 && v.y === 0) {
        v.x *= Math.pow(0.2, dt * 6); v.z *= Math.pow(0.2, dt * 6);
        h.spin.set(0, 0, 0);
        if (!h.rest) h.rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.05 + Math.random() * 0.35, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5, 'YXZ'));
        h.obj.quaternion.slerp(h.rest, Math.min(1, dt * 5));
        if (Math.hypot(v.x, v.z) < 0.05 && h.obj.quaternion.angleTo(h.rest) < 0.02) { h.still = true; h.obj.quaternion.copy(h.rest); }
      }
    }
  }

  // advance the snatch animations; returns where the victim's body is (or null when it's gone)
  updateSnatches(dt) {
    for (const ev of this.events) {
      ev.t += dt;
      const A = ev.arm;
      let body = null;
      if (ev.kind === 'corner') {
        // out from round the corner (0.12 s), grab, yank back (0.3 s), gone
        const reach = Math.max(0.6, ev.dist + 0.2);
        const out = ev.t < 0.12 ? smooth(ev.t / 0.12) : ev.t < 0.45 ? 1 - smooth((ev.t - 0.12) / 0.33) : 0;
        A.upper.position.y = 0.15 + (1 - out) * 1.9 - (reach - 1.9);     // slide the arm along itself
        A.claws.forEach((c, k) => { c.rotation.x = ev.t < 0.12 ? -0.7 : 0.35; c.rotation.y = (k - 1) * 0.6; });
        const k = ev.t < 0.12 ? 0 : smooth(Math.min(1, (ev.t - 0.12) / 0.3));
        body = { x: ev.from.x + (ev.x - ev.from.x) * k * 1.3, y: ev.from.y, z: ev.from.z + (ev.z - ev.from.z) * k * 1.3, lean: k };
        if (ev.t > 0.42) body = null;
      } else {
        // down out of the hole (0.18 s), grab, straight back up with them (0.45 s)
        const down = ev.t < 0.18 ? smooth(ev.t / 0.18) : 1;
        const up = ev.t < 0.24 ? 0 : smooth(Math.min(1, (ev.t - 0.24) / 0.45));
        ev.outer.position.set(ev.x, H + 2.2 - down * 1.55 + up * 2.6, ev.z);
        A.upper.rotation.x = Math.sin(ev.t * 40) * 0.05 * (1 - up);
        A.claws.forEach((c, k) => { c.rotation.x = ev.t < 0.2 ? -0.7 : 0.4; c.rotation.y = (k - 1) * 0.6; });
        if (ev.t >= 0.2) {
          const handY = ev.outer.position.y - 1.95;
          body = { x: ev.from.x + (ev.x - ev.from.x) * Math.min(1, up * 3), y: handY - 1.45, z: ev.from.z + (ev.z - ev.from.z) * Math.min(1, up * 3), lift: up };
          if (handY - 1.45 > H + 0.3) body = null;
        } else body = { x: ev.from.x, y: ev.from.y, z: ev.from.z };
      }
      ev.body = body;
      if (ev.r && ev.r.model) {
        const m = ev.r.model;
        if (body) {
          m.root.visible = true;
          m.root.position.set(body.x, body.y, body.z);
          m.root.rotation.z = ev.kind === 'corner' ? (body.lean || 0) * 0.9 : 0;
        } else { m.root.visible = false; m.root.rotation.z = 0; }
      }
    }
    for (const ev of this.events.filter(e => e.t > 1.2)) this.scene.remove(ev.outer);
    this.events = this.events.filter(e => e.t <= 1.2);
  }

  // my own snatch: where the camera is (or null to leave it alone)
  camera(cam) {
    if (this.caught) { const c = this.caughtCamera(); if (c) return c; }
    const ev = this.mine;
    if (!ev) return null;
    const black = $('br-black');
    if (ev.t > 3.2) { this.mine = null; black.style.opacity = '0'; setTimeout(() => black.classList.add('hidden'), 400); return null; }
    if (ev.kind === 'corner') {
      // yanked sideways towards it, turning to see the arm, then nothing
      const k = smooth(Math.min(1, ev.t / 0.35));
      const yaw = Math.atan2(-(ev.x - ev.from.x), -(ev.z - ev.from.z));
      if (ev.t > 0.3) { black.classList.remove('hidden'); black.style.opacity = '1'; }
      return { x: ev.from.x + (ev.x - ev.from.x) * k, y: ev.from.y + EYE - k * 0.5, z: ev.from.z + (ev.z - ev.from.z) * k, yaw, pitch: -0.1, roll: k * 0.6 };
    }
    // pulled up into the hole, looking up at it
    const up = ev.t < 0.22 ? 0 : smooth(Math.min(1, (ev.t - 0.22) / 0.4));
    if (up > 0.85) { black.classList.remove('hidden'); black.style.opacity = '1'; }
    return { x: ev.from.x + (ev.x - ev.from.x) * up, y: ev.from.y + EYE + up * (H - EYE + 0.6), z: ev.from.z + (ev.z - ev.from.z) * up, yaw: cam.rotation.y, pitch: Math.min(1.5, 0.4 + ev.t * 5), roll: Math.sin(ev.t * 30) * 0.08 };
  }

  // the screen goes black for a moment, then fades back (it took your skin)
  blackout(secs) {
    const black = $('br-black');
    black.classList.remove('hidden'); black.style.opacity = '1';
    clearTimeout(this.blackTimer);
    this.blackTimer = setTimeout(() => { black.style.opacity = '0'; setTimeout(() => { if (black.style.opacity === '0') black.classList.add('hidden'); }, 400); }, secs * 1000);
  }

  // ---------- the map you draw by walking (M / the map button): only what you have been close to ----------
  initMap() {
    const w = this.g.world, W = w.w, H = w.h;
    this.mapKnown = new Uint8Array(W * H);            // 0 not seen, 1 floor, 2 wall, 3 hole
    this.mapKind = new Uint8Array(W * H);             // what each cell really is (1 floor, 2 wall, 3 hole)
    for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) {
      const solid = w.cellSpans(ix, iz).some(s => s.m[0] !== '_' && s.y0 < 1 && s.y1 > 1.5);
      this.mapKind[iz * W + ix] = solid ? 2 : w.pitCell(ix, iz) ? 3 : 1;
    }
    this.mapImg = document.createElement('canvas');
    this.mapImg.width = W; this.mapImg.height = H;
    this.mapCtx = this.mapImg.getContext('2d');
    this.mapData = this.mapCtx.createImageData(W, H);
    this.mapBox = null; this.mapDirty = false; this.mapT = 0; this.trail = []; this.mapOpen = false;
  }
  toggleMap() {
    if (!this.mapKnown) this.initMap();
    this.mapOpen = !this.mapOpen && this.g.me.alive;
    $('br-map').classList.toggle('hidden', !this.mapOpen);
    if (this.mapOpen) this.drawMap();
  }
  mapStep(dt) {
    if (!this.mapKnown) this.initMap();
    const g = this.g, me = g.me;
    if (!me.alive) { if (this.mapOpen) this.toggleMap(); return; }
    this.mapT -= dt;
    if (this.mapT > 0) return;
    this.mapT = 0.12;
    const W = this.mapImg.width, H = this.mapImg.height, C = 0.5, R = 2.4, px = me.pos.x, pz = me.pos.z;
    const kind = this.mapKind, known = this.mapKnown, d = this.mapData.data;
    const COL = { 1: [214, 205, 178, 255], 2: [44, 44, 56, 255], 3: [95, 92, 98, 255] };
    const i0 = Math.max(0, Math.floor((px - R) / C)), i1 = Math.min(W - 1, Math.floor((px + R) / C));
    const k0 = Math.max(0, Math.floor((pz - R) / C)), k1 = Math.min(H - 1, Math.floor((pz + R) / C));
    for (let iz = k0; iz <= k1; iz++) for (let ix = i0; ix <= i1; ix++) {
      const j = iz * W + ix;
      if (known[j]) continue;
      const cx = (ix + 0.5) * C, cz = (iz + 0.5) * C, dist = Math.hypot(cx - px, cz - pz);
      if (dist > R) continue;
      // only what you can actually see from here (walls hide what's behind them)
      let seen = true;
      for (let t = 0.25; t < dist - 0.3; t += 0.25) {
        const qx = Math.floor((px + (cx - px) * t / dist) / C), qz = Math.floor((pz + (cz - pz) * t / dist) / C);
        if (kind[qz * W + qx] === 2) { seen = false; break; }
      }
      if (!seen) continue;
      known[j] = kind[j];
      d.set(COL[kind[j]], j * 4);
      this.mapDirty = true;
      const b = this.mapBox || (this.mapBox = { x0: ix, x1: ix, z0: iz, z1: iz });
      b.x0 = Math.min(b.x0, ix); b.x1 = Math.max(b.x1, ix); b.z0 = Math.min(b.z0, iz); b.z1 = Math.max(b.z1, iz);
    }
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - px, last.z - pz) > 0.6) { this.trail.push({ x: px, z: pz }); if (this.trail.length > 4000) this.trail.splice(0, 1000); }
    if (this.mapOpen) this.drawMap();
  }
  drawMap() {
    const c = $('br-map-canvas'), ctx = c.getContext('2d'), S = c.width, b = this.mapBox, me = this.g.me;
    ctx.fillStyle = '#efe9d8'; ctx.fillRect(0, 0, S, S);
    if (!b) return;
    if (this.mapDirty) { this.mapCtx.putImageData(this.mapData, 0, 0); this.mapDirty = false; }
    // the part you have explored, square, with a margin (at least 30 m across)
    const span = Math.max(60, b.x1 - b.x0 + 16, b.z1 - b.z0 + 16);
    const vx = (b.x0 + b.x1) / 2 - span / 2, vz = (b.z0 + b.z1) / 2 - span / 2, k = S / span;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapImg, vx, vz, span, span, 0, 0, S, S);
    const to = (x, z) => [(x / 0.5 - vx) * k, (z / 0.5 - vz) * k];
    // the way you came, in pencil
    ctx.strokeStyle = 'rgba(40,70,150,0.75)'; ctx.lineWidth = 2; ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    this.trail.forEach((p, i) => { const [x, y] = to(p.x, p.z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    // the exit, once you've seen its door
    const e = this.g.world.exit;
    if (e) {
      const j = Math.floor((e.z + e.nz * 0.3) / 0.5) * this.mapImg.width + Math.floor((e.x + e.nx * 0.3) / 0.5);
      if (this.mapKnown[j]) { const [x, y] = to(e.x, e.z); ctx.fillStyle = '#1d7a3a'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('EXIT', x + e.nx * 22, y + e.nz * 22 + 5); }
    }
    // you: a red arrowhead pointing the way you face
    const [mx, my] = to(me.pos.x, me.pos.z), fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    ctx.fillStyle = '#c0392b'; ctx.beginPath();
    ctx.moveTo(mx + fx * 11, my + fz * 11); ctx.lineTo(mx - fx * 6 - fz * 6, my - fz * 6 + fx * 6); ctx.lineTo(mx - fx * 6 + fz * 6, my - fz * 6 - fx * 6);
    ctx.fill();
  }

  // ---------- notes ----------
  startNotes(list) {
    for (const n of list || []) this.addNote(n);
    // the explorer logs this maze came with (the same on every screen: from the maze plan)
    const plan = this.g.world.def.br, at = i => BR.border + i * BR.cell;
    (plan && plan.logs || []).forEach((l, i) => {
      const nx = -l.wx, nz = -l.wz;
      let fx = at(l.x) + 2.25, fz = at(l.z) + 2.25;
      if (l.wx < 0) fx = l.x === 0 ? at(0) : at(l.x) + 0.5;
      if (l.wx > 0) fx = at(l.x + 1);
      if (l.wz < 0) fz = l.z === 0 ? at(0) : at(l.z) + 0.5;
      if (l.wz > 0) fz = at(l.z + 1);
      const ux = nz, uz = -nx;           // along the wall
      const L = LOGS[l.k];
      if (!L) return;
      this.addNote({ id: -1 - i, wall: true, log: l.k, x: fx + nx * 0.012 + ux * l.off, y: 1.45, z: fz + nz * 0.012 + uz * l.off, nx, nz, text: L.text, name: WHO[l.who % WHO.length], size: 0.42 });
    });
  }

  addNote(note) {
    if (!note || this.notes.has(note.id)) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const draw = (img) => { paintNote(canvas, note, img); tex.needsUpdate = true; };
    draw(null);
    if (note.img) { const im = new Image(); im.onload = () => draw(im); im.src = note.img; }
    const light = this.built.lightAt ? Math.max(0.12, Math.min(1.1, this.built.lightAt(note.x, note.z))) : 1;
    const mat = addFlash(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(light, light, light * 0.96) }));
    const size = note.size || (note.wall ? 0.3 : 0.32);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    const tilt = (((note.id * 37) % 11) - 5) * 0.03;      // the same slight angle on every screen
    mesh.rotation.order = 'YXZ';
    if (note.wall) { mesh.position.set(note.x, note.y, note.z); mesh.rotation.set(0, Math.atan2(note.nx, note.nz), tilt * 0.6); }
    else { mesh.position.set(note.x, 0.006, note.z); mesh.rotation.set(-Math.PI / 2, note.yaw + tilt, 0); }
    this.scene.add(mesh);
    this.notes.set(note.id, { note, mesh, canvas });
  }

  // the note you're looking at, close up (or none)
  readNote() {
    const g = this.g, me = g.me, cam = g.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bd = 0.3;
    for (const n of this.notes.values()) {
      const p = n.mesh.position, dx = p.x - cam.position.x, dy = p.y - cam.position.y, dz = p.z - cam.position.z, d = Math.hypot(dx, dy, dz);
      if (d > 2.3) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d)));
      if (ang < bd && g.world.los(cam.position.x, cam.position.y, cam.position.z, p.x - dx / d * 0.05, p.y - dy / d * 0.05, p.z - dz / d * 0.05)) { bd = ang; best = n; }
    }
    const el = $('note-read');
    if (!best || !me.alive) { el.classList.add('hidden'); this.reading = null; return; }
    if (this.reading !== best) {
      this.reading = best;
      const c = $('note-read-canvas');
      c.getContext('2d').drawImage(best.canvas, 0, 0, c.width, c.height);
      $('note-read-who').textContent = `— ${best.note.name}`;
    }
    el.classList.remove('hidden');
  }

  bindEditor() {
    const c = $('note-canvas'), ctx = c.getContext('2d');
    this.bound = [];
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); this.bound.push([el, ev, fn]); };
    let drawing = null;
    const at = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    on(c, 'pointerdown', e => { e.preventDefault(); c.setPointerCapture(e.pointerId); drawing = at(e); this.drawn = true; ctx.fillStyle = '#1b1b22'; ctx.beginPath(); ctx.arc(drawing[0], drawing[1], 2, 0, Math.PI * 2); ctx.fill(); });
    on(c, 'pointermove', e => {
      if (!drawing) return;
      const p = at(e);
      ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(drawing[0], drawing[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      drawing = p;
    });
    on(c, 'pointerup', () => { drawing = null; });
    on(c, 'pointercancel', () => { drawing = null; });
    on($('note-clear'), 'click', () => { ctx.clearRect(0, 0, c.width, c.height); this.drawn = false; });
    on($('note-cancel'), 'click', () => this.closeEditor());
    on($('note-floor'), 'click', () => this.place(false));
    on($('note-wall'), 'click', () => this.place(true));
    on($('note-text'), 'keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.closeEditor(); });
  }

  // a wall right in front of you to tape a note to: { x, y, z, nx, nz } or null
  wallSpot() {
    const g = this.g, me = g.me;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), ey = me.pos.y + 1.35;
    const tr = g.world.trace(me.pos.x, ey, me.pos.z, fx, 0, fz, 1.6);
    if (!tr.solid || Math.abs(tr.ny) > 0.5 || (!tr.nx && !tr.nz)) return null;
    return { x: me.pos.x + fx * tr.t + tr.nx * 0.012, y: ey, z: me.pos.z + fz * tr.t + tr.nz * 0.012, nx: tr.nx, nz: tr.nz };
  }

  openEditor() {
    const g = this.g;
    if (!g.me.alive || this.editing) return;
    this.editing = true;
    g.input.held.clear(); g.input.updateMove(); g.input.fire = false;
    if (!g.settings.touch) g.input.releaseForMenu();
    $('note-msg').textContent = '';
    $('note-text').value = '';
    $('note-canvas').getContext('2d').clearRect(0, 0, 256, 256);
    this.drawn = false;
    $('note-wall').disabled = !this.wallSpot();
    $('note-editor').classList.remove('hidden');
  }

  closeEditor() {
    if (!this.editing) return;
    this.editing = false;
    $('note-editor').classList.add('hidden');
    $('note-text').blur();
    const g = this.g;
    if (!g.settings.touch && !g.paused) g.input.requestLock();
  }

  place(wall) {
    const g = this.g, me = g.me;
    const text = cleanChat($('note-text').value, 140);
    if (!text && !this.drawn) { $('note-msg').textContent = 'Write or draw something first'; return; }
    let spot;
    if (wall) {
      spot = this.wallSpot();
      if (!spot) { $('note-msg').textContent = 'Face a wall to tape it up'; return; }
    } else {
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), x = me.pos.x + fx * 0.8, z = me.pos.z + fz * 0.8;
      if (g.world.isPit(x, z) || g.world.blocked(x, z, 0.12, 0)) { $('note-msg').textContent = "There's no floor there"; return; }
      spot = { x, y: 0, z, nx: 0, nz: 0 };
    }
    const img = this.drawn ? $('note-canvas').toDataURL('image/png') : '';
    g.transport.send({ t: 'note', x: spot.x, y: spot.y, z: spot.z, wall, nx: spot.nx, nz: spot.nz, yaw: me.yaw, text, img });
    this.closeEditor();
  }

  // ---------- hallucinations: only you see or hear them ----------
  hallucinate(dt) {
    const g = this.g, me = g.me;
    if (this.hallu) { this.updateVision(dt); return; }
    if (!me.alive || g.clock < this.halluAt) return;
    // sooner when you're alone or in the dark
    const alone = ![...g.remotes.values()].some(r => r.alive && r.team !== 'monster' && Math.hypot(r.rp.x - me.pos.x, r.rp.z - me.pos.z) < 10);
    const dark = this.built.lightAt && this.built.lightAt(me.pos.x, me.pos.z) < 0.25;
    this.halluAt = g.clock + (40 + Math.random() * 70) * (alone ? 0.7 : 1) * (dark ? 0.6 : 1);
    const kinds = ['steps', 'whisper', 'knock', 'screech', 'figure', 'lights', 'figure', 'follow', 'follow', 'breath'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), P = me.pos;
    const occ = (x, z) => g.occlusion(x, 1.2, z);
    if (kind === 'steps') {
      // something walking up behind you… then nothing
      for (let k = 0; k < 4; k++) setTimeout(() => { const d = 7 - k * 1.2; const x = P.x - fx * d, z = P.z - fz * d; sfx.playMonsterStep({ x, y: 0.05, z }, occ(x, z), false); }, k * 520);
    } else if (kind === 'whisper') {
      const side = Math.random() < 0.5 ? 1 : -1;
      sfx.playBR('whisper', { x: P.x + fz * side * 0.6, y: P.y + 1.6, z: P.z - fx * side * 0.6 }, 0, 0.6);
    } else if (kind === 'knock') {
      const tr = g.world.trace(P.x, 1.4, P.z, -fz, 0, fx, 6);
      sfx.playBR('knock', { x: P.x - fz * tr.t, y: 1.4, z: P.z + fx * tr.t }, 0.3, 0.9);
    } else if (kind === 'screech') {
      const a = Math.random() * Math.PI * 2;
      sfx.playScreech({ x: P.x + Math.cos(a) * 25, y: 2.4, z: P.z + Math.sin(a) * 25 }, 0.8);
    } else if (kind === 'follow') {
      // footsteps behind you that copy yours, and stop a moment after you stop
      this.follow = { until: g.clock + 12 + Math.random() * 8, next: 0, moved: g.clock };
    } else if (kind === 'breath') {
      sfx.playBR('breath', { x: P.x - fx * 0.5, y: P.y + 1.6, z: P.z - fz * 0.5 }, 0, 0.7);
    } else if (kind === 'lights') {
      if (this.built.flickerBurst) this.built.flickerBurst(P.x, P.z, 1.4);
    } else this.startVision(kind);
  }

  // a figure standing far off down a corridor, in plain view; gone if you look straight at it or come close
  startVision(kind) {
    const g = this.g, me = g.me, w = g.world;
    for (let tries = 0; tries < 24; tries++) {
      const a = me.yaw + (Math.random() - 0.5) * 1.2, d = 10 + Math.random() * 9;
      const x = me.pos.x - Math.sin(a) * d, z = me.pos.z - Math.cos(a) * d;
      if (w.blocked(x, z, 0.4, 0) || w.isPit(x, z) || !w.los(me.pos.x, me.pos.y + EYE, me.pos.z, x, 1.5, z)) continue;
      const model = makeMonsterModel();
      model.root.position.set(x, 0, z);
      // it faces you
      model.root.rotation.y = Math.atan2(-(me.pos.x - x), -(me.pos.z - z));
      this.scene.add(model.root);
      this.hallu = { kind, model, t: 0, x, z, seen: 0 };
      return;
    }
  }

  updateVision(dt) {
    const h = this.hallu, g = this.g, me = g.me;
    h.t += dt;
    animateMonster(h.model, dt, { speed: 0, mode: 'idle' });
    const dx = h.x - me.pos.x, dz = h.z - me.pos.z, d = Math.hypot(dx, dz);
    const look = Math.abs(((Math.atan2(-dx, -dz) - me.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.12;
    if (look) h.seen += dt;
    if (h.seen > 0.25 || d < 7 || h.t > 3 || !me.alive) { this.scene.remove(h.model.root); this.hallu = null; }
  }

  // ---------- the monster, felt rather than seen ----------
  monster() { return this.g.remotes.get('monster') || null; }      // (the main one: not the Listener)

  // how brightly its eyes burn: barely at all in the light, fully in the dark or in your flashlight beam
  eyeGlow(r) {
    const g = this.g, x = r.rp.x, z = r.rp.z;
    if (this.caught) return 0.3;               // right in front of its face: you see the face, not just a glare
    let l = this.built.lightAt ? this.built.lightAt(x, z) : 1;
    l *= 1 - 0.92 * this.darkK;
    let k = Math.max(0, Math.min(1, 1.1 - l * 1.25));
    const me = g.me, cam = g.camera.position;
    if (me.alive && me.light) {
      const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
      let a = Math.atan2(-dx, -dz) - me.yaw;
      while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      if (d < 22 && Math.abs(a) < 0.35) k = 1;
    }
    return k;
  }

  updateDread(dt) {
    const g = this.g, me = g.me, cam = g.camera.position, mon = this.monster();
    const here = !!(mon && mon.alive && mon.model && mon.model.root.visible);
    const mp = here ? mon.model.root.position : null;
    const d = here ? Math.hypot(mp.x - cam.x, mp.z - cam.z) : Infinity;
    // (the lights used to die round it; the owner asked for that darkness to go: it darkens nothing now)
    this.darkK = 0;
    FLASH.uDark.value.w = 0;
    if (!me.alive || g.paused) { this.follow = null; }
    // your heart: faster and louder the closer it is (even through walls)
    if (me.alive && d < 22 && g.clock >= this.heartAt) {
      const k = 1 - d / 22;
      sfx.playHeart(k);
      this.heartAt = g.clock + 1.05 - 0.68 * k;
    }
    // breathing right behind you when it is right behind you
    if (me.alive && d < 4.5 && g.clock >= this.breathAt) {
      let a = Math.atan2(-(mp.x - cam.x), -(mp.z - cam.z)) - me.yaw;
      while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      if (Math.abs(a) > 1.6) {
        sfx.playBR('breath', { x: cam.x + Math.sin(me.yaw) * 0.45, y: cam.y, z: cam.z + Math.cos(me.yaw) * 0.45 }, 0, 1);
        this.breathAt = g.clock + 5;
      }
    }
    // footsteps that copy yours
    const f = this.follow;
    if (f && me.alive) {
      const sp = Math.hypot(me.vel.x, me.vel.z);
      if (sp > 0.6) f.moved = g.clock;
      if (g.clock - f.moved < 0.65 && g.clock >= f.next) {
        const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), x = me.pos.x - fx * 6, z = me.pos.z - fz * 6;
        sfx.playStep({ pos: { x, y: 0.05, z }, surface: g.surfaceAt(x, 0, z), occ: g.occlusion(x, 0.3, z) });
        f.next = g.clock + (sp > 3.5 ? 0.36 : 0.55);
      }
      if (g.clock > f.until) this.follow = null;
    }
    // when it is close (within 10 m), and when it has you: the screen shakes and a low distorted rumble swells
    // (the owner swapped the old screen grain/static for these)
    const want = this.caught ? (this.caught.t < 1.25 ? 1 : 0) : here && me.alive ? Math.max(0, Math.min(1, (10 - d) / 8)) : 0;
    this.staticK += (want - this.staticK) * Math.min(1, dt * 4);
    if (this.staticK > 0.01) g.shake = Math.max(g.shake || 0, this.staticK * (this.caught ? 1.8 : 0.9));
    sfx.setDread(this.caught ? this.staticK : this.staticK * 0.75);
    return { here, d };
  }

  // a sound it makes to draw someone over: a person's footsteps, or a door opening
  onLure(m) {
    const g = this.g;
    if (m.kind === 'door') {
      let best = null, bd = 14;
      for (const d of g.world.doors || []) { const dd = Math.hypot(d.cx - m.x, d.cz - m.z); if (dd < bd) { bd = dd; best = d; } }
      const p = best ? { x: best.cx, y: 1.2, z: best.cz } : { x: m.x, y: 1.2, z: m.z };
      sfx.playDoor(p, 'open', g.occlusion(p.x, p.y, p.z));
      return;
    }
    const fx = -Math.sin(m.yaw || 0), fz = -Math.cos(m.yaw || 0);
    for (let k = 0; k < 5; k++) setTimeout(() => {
      if (!this.g.running) return;
      const x = m.x + fx * k * 0.7, z = m.z + fz * k * 0.7;
      sfx.playStep({ pos: { x, y: 0.05, z }, surface: g.surfaceAt(x, 0, z), occ: g.occlusion(x, 0.3, z) });
    }, k * 360);
  }

  // ---------- caught: you are the ragdoll. You see it through your own eyes, then nothing ----------
  caughtMe() {
    this.caught = { t: 0, t0: performance.now(), endAt: 0 };
  }
  caughtCamera() {
    const c = this.caught, g = this.g, mon = this.monster(), black = $('br-black');
    c.t = (performance.now() - c.t0) / 1000;                // (real time: it must not drag on when frames are slow)
    const hp = g.ragdolls.partPos(g.myId, 'head');
    const slamming = mon && (mon.mode === 'seize' || mon.mode === 'hoist' || mon.mode === 'slam' || mon.mode === 'slamWall');
    // once it has finished with you (or 7 s at most) the screen goes black, and the usual death view takes over
    if (!c.endAt && (c.t > 7 || (c.t > 0.8 && !slamming))) { c.endAt = c.t + 1.1; black.classList.remove('hidden'); black.style.opacity = '1'; }
    if (!hp || !mon || !mon.model || (c.endAt && c.t > c.endAt)) {
      this.caught = null; g.ragdolls.showPart(g.myId, 'head', true);
      black.style.opacity = '0'; setTimeout(() => black.classList.add('hidden'), 400);
      return null;
    }
    g.ragdolls.showPart(g.myId, 'head', false);            // (your own hood would be in the way)
    const head = new THREE.Vector3();
    mon.model.head.getWorldPosition(head);
    const yaw = Math.atan2(-(head.x - hp.x), -(head.z - hp.z)), pitch = Math.atan2(head.y + 0.1 - hp.y, Math.hypot(head.x - hp.x, head.z - hp.z));
    return { x: hp.x, y: Math.max(0.2, hp.y), z: hp.z, yaw, pitch, roll: Math.sin(c.t * 31) * 0.06 + (this.slamK || 0) * 0.5 * Math.sin(c.t * 60) };
  }

  // ---------- bodies it catches (the host: MonsterBrain.startCatch) ----------
  // The kill message says how: { fate: 'slam' | 'drag' | 'hang', by: 'leg' | 'arm', on: 'floor' | 'wall', n, wall }.
  // The body becomes a ragdoll (ragdoll.js) pinned by that ankle or wrist to its right hand for as long as the host
  // names it as the body being held (the last part of the creature's mode, game.js `dragId`): through the lift, the
  // slams and the dragging. Then it is let go, or pinned up on a wall (hangBody).
  takeBody(m) {
    const g = this.g, id = m.victim;
    if (id !== g.myId && !g.remotes.get(id)) return;
    g.spawnRagdoll(id, { ...m, from: null });                 // as they stood, with no push
    const from = g.ragdolls.hold(id, m.by === 'leg' ? 'shinR' : 'farmR');
    if (!from) return;
    const old = this.bodies.get(id);
    if (old && old.model) this.scene.remove(old.model.root);
    this.bodies.set(id, { mode: 'held', t: 0, from, wall: m.wall || null, key: -1 });
  }

  // let go of (dropBody) or pinned to a wall (hangBody)
  placeBody(m) {
    const b = this.bodies.get(m.id), g = this.g;
    if (!b) return;
    if (m.t === 'dropBody') { g.ragdolls.release(m.id); b.mode = 'loose'; return; }
    // hung on the wall: upright, facing out of it, feet off the floor, head hanging, held up by two black spikes
    g.ragdolls.remove(m.id);
    const ro = (g.roster || []).find(p => p.id === m.id);
    const M = makePlayerModel('atk', m.id === g.myId ? g.settings.name : ro ? ro.name : '', false, 'hazmat');
    setModelWeapon(M, 'none');
    animateModel(M, 0.016, { speed: 0, pitch: 0 });
    this.scene.add(M.root);
    b.mode = 'hung'; b.model = M;
    M.thighs.forEach(t => { t.rotation.x = 0; });
    M.root.rotation.set(0, Math.atan2(-m.nx, -m.nz), (Math.random() - 0.5) * 0.15, 'YXZ');
    M.root.position.set(m.x + m.nx * 0.2, 0.8, m.z + m.nz * 0.2);
    M.neck.rotation.x = 0.65;
    const spike = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.9 });
    for (const s of [-1, 1]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.004, 0.5, 6), spike);
      pin.rotation.x = Math.PI / 2;
      pin.position.set(s * 0.17, 1.38, 0.1);
      M.root.add(pin);
    }
    const pos = { x: m.x, y: 1.4, z: m.z };
    sfx.playBR('slam', pos, g.occlusion(pos.x, pos.y, pos.z), 0.7);
  }

  updateBodies(dt) {
    const g = this.g, mon = this.monster();
    this.slamK = (this.slamK || 0) * Math.exp(-dt * 7);
    for (const [id, b] of this.bodies) {
      if (b.mode !== 'held') continue;
      b.t += dt;
      const has = mon && mon.model && mon.alive && mon.dragId === id;
      if (!has) {
        // (the first moments, before the host's next update names the body, it is still on its way to the hand)
        if (b.t > 0.6 || !mon || !mon.model) { g.ragdolls.release(id); b.mode = 'loose'; }
        if (!mon || !mon.model) continue;
      }
      mon.model.root.updateMatrixWorld(true);
      const hand = mon.model.arms[1].hand.localToWorld(new THREE.Vector3(0, -0.2, 0));
      // snatched off their feet: the held ankle / wrist goes to its hand in about a tenth of a second
      const k = smooth(Math.min(1, b.t / 0.13));
      let x = b.from.x + (hand.x - b.from.x) * k, y = Math.max(0.1, b.from.y + (hand.y - b.from.y) * k), z = b.from.z + (hand.z - b.from.z) * k;
      if (b.wall) {
        // its hand may end a little way inside the wall it swings them into: the body stops at the wall
        const d = (x - b.wall[0]) * b.wall[2] + (z - b.wall[1]) * b.wall[3];
        if (d < 0.14) { x += b.wall[2] * (0.14 - d); z += b.wall[3] * (0.14 - d); }
      }
      if (b.mode === 'held') g.ragdolls.moveHold(id, x, y, z, dt);
      // the hit: the third position of each slam
      const key = (mon.mode === 'slam' || mon.mode === 'slamWall') ? mon.modeN : -1;
      if (key === 2 && b.key !== 2) {
        const pos = { x, y: Math.max(0.3, y), z };
        setTimeout(() => {
          sfx.playBR('slam', pos, g.occlusion(pos.x, pos.y, pos.z), 1.5);
          const d = Math.hypot(pos.x - g.camera.position.x, pos.z - g.camera.position.z);
          if (id === g.myId) { g.shake = 3; this.slamK = 1; } else if (d < 12) g.shake = Math.max(g.shake || 0, 1.6 * (1 - d / 12));
        }, 70);
      }
      b.key = key;
    }
  }

  // ---------- every frame ----------
  update(dt) {
    const g = this.g;
    this.updateSnatches(dt);
    this.updateHeads(dt);
    this.updateBodies(dt);
    this.updateDread(dt);
    if (!g.paused) this.hallucinate(dt);
    this.readNote();
    this.mapStep(dt);
    // people (and it) are only as bright as the place you are in
    if (this.built.lightAt && this.built.dimPeople) {
      let l = this.built.lightAt(g.camera.position.x, g.camera.position.z);
      // (and the dark it brings with it)
      if (this.darkPos) { const dd = Math.hypot(this.darkPos.x - g.camera.position.x, this.darkPos.z - g.camera.position.z); l *= 1 - 0.9 * this.darkK * Math.max(0, Math.min(1, (7.5 - dd) / 4.5)); }
      const k = Math.max(0.025, Math.min(1, 0.025 + l * 1.0));
      this.dim = this.dim == null ? k : this.dim + (k - this.dim) * Math.min(1, dt * 3);
      this.built.dimPeople(this.dim);
      // the haze goes dark too, or distant dark rooms would glow yellow
      const fog = g.scene.fog;
      if (fog) {
        if (!this.fogBase) this.fogBase = fog.color.clone();
        fog.color.copy(this.fogBase).multiplyScalar(Math.max(0.015, Math.min(1, this.dim * 1.1)));
      }
    }
    // flashlights light the baked walls too (up to four, nearest first)
    const list = [];
    const me = g.me, cam = g.camera;
    if (me.alive && me.light) {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      list.push({ p: cam.position.clone().addScaledVector(f, 0.2), d: f, dist: 0 });
    }
    for (const r of g.remotes.values()) {
      if (!r.alive || !r.light || r.team === 'monster') continue;
      const cy = Math.cos(r.rp.pitch);
      const d = new THREE.Vector3(-Math.sin(r.rp.yaw) * cy, Math.sin(r.rp.pitch), -Math.cos(r.rp.yaw) * cy);
      list.push({ p: new THREE.Vector3(r.rp.x, r.rp.y + EYE - 0.15, r.rp.z), d, dist: Math.hypot(r.rp.x - cam.position.x, r.rp.z - cam.position.z) });
    }
    list.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < 4; i++) {
      const L = list[i];
      FLASH.uFlashOn.value[i] = L ? 1 : 0;
      if (L) { FLASH.uFlashPos.value[i].copy(L.p); FLASH.uFlashDir.value[i].copy(L.d); }
    }
  }
}
