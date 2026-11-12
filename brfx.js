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
  if (note.text) {
    g.fillStyle = '#1f2a44';
    g.font = `${Math.round(S / 10)}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
    const words = note.text.split(' '), lines = [];
    let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > S - 24 && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    lines.slice(0, 7).forEach((l, i) => g.fillText(l, 12, S / 10 + 8 + i * (S / 9)));
  }
  if (note.wall) {
    g.fillStyle = 'rgba(230,225,190,0.75)';
    g.save(); g.translate(S * 0.18, 6); g.rotate(-0.2); g.fillRect(-22, -6, 44, 14); g.restore();
    g.save(); g.translate(S * 0.82, 6); g.rotate(0.2); g.fillRect(-22, -6, 44, 14); g.restore();
  }
}

export class BackroomsFX {
  constructor(game, built) {
    this.g = game;
    this.built = built.group.userData;
    this.scene = game.scene;
    this.notes = new Map();           // id → { note, mesh }
    this.events = [];                 // snatch animations in progress
    this.heads = [];                  // heads the ceiling spat back out: { wait, x, z, name, obj, v, spin }
    this.hallu = null;                // a hallucination being shown
    this.halluAt = 60 + Math.random() * 40;
    this.editing = false;
    this.built.onSpark = (x, y, z) => sfx.playBR('spark', { x, y, z }, game.occlusion(x, y, z), 0.8);
    this.bindEditor();
  }

  destroy() {
    for (const [el, ev, fn] of this.bound || []) el.removeEventListener(ev, fn);
    $('note-editor').classList.add('hidden');
    $('note-read').classList.add('hidden');
    $('br-black').classList.add('hidden');
  }

  onMessage(m) {
    if (m.t === 'snatch') { this.onSnatch(m); return true; }
    if (m.t === 'note') { this.addNote(m.note); return true; }
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

  // ---------- notes ----------
  startNotes(list) { for (const n of list || []) this.addNote(n); }

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
    const size = note.wall ? 0.3 : 0.32;
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
    const kinds = ['steps', 'whisper', 'knock', 'screech', 'figure', 'friend', 'lights', 'figure'];
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
      let model;
      if (kind === 'figure') model = makeMonsterModel();
      else {
        // someone in a suit, back turned, with a friend's name on it (or no name at all)
        const mates = [...g.remotes.values()].filter(r => r.team !== 'monster');
        const who = mates.length && Math.random() < 0.6 ? mates[Math.floor(Math.random() * mates.length)].name : '';
        model = makePlayerModel('atk', who, false, 'hazmat'); setModelWeapon(model, 'none');
      }
      model.root.position.set(x, 0, z);
      // the monster faces you; a "friend" stands with their back to you
      const toMe = Math.atan2(-(me.pos.x - x), -(me.pos.z - z));
      model.root.rotation.y = kind === 'figure' ? toMe : toMe + Math.PI;
      this.scene.add(model.root);
      this.hallu = { kind, model, t: 0, x, z, seen: 0 };
      return;
    }
  }

  updateVision(dt) {
    const h = this.hallu, g = this.g, me = g.me;
    h.t += dt;
    if (h.kind === 'figure') animateMonster(h.model, dt, { speed: 0, mode: 'idle' });
    else animateModel(h.model, dt, { speed: 0, pitch: 0 });
    const dx = h.x - me.pos.x, dz = h.z - me.pos.z, d = Math.hypot(dx, dz);
    const look = Math.abs(((Math.atan2(-dx, -dz) - me.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.12;
    if (look) h.seen += dt;
    if (h.seen > 0.25 || d < 7 || h.t > 3 || !me.alive) { this.scene.remove(h.model.root); this.hallu = null; }
  }

  // ---------- every frame ----------
  update(dt) {
    const g = this.g;
    this.updateSnatches(dt);
    this.updateHeads(dt);
    if (!g.paused) this.hallucinate(dt);
    this.readNote();
    // people (and it) are only as bright as the place you are in
    if (this.built.lightAt && this.built.dimPeople) {
      const l = this.built.lightAt(g.camera.position.x, g.camera.position.z);
      const k = Math.max(0.1, Math.min(1, 0.1 + l * 0.95));
      this.dim = this.dim == null ? k : this.dim + (k - this.dim) * Math.min(1, dt * 3);
      this.built.dimPeople(this.dim);
      // the haze goes dark too, or distant dark rooms would glow yellow
      const fog = g.scene.fog;
      if (fog) {
        if (!this.fogBase) this.fogBase = fog.color.clone();
        fog.color.copy(this.fogBase).multiplyScalar(Math.max(0.06, Math.min(1, this.dim * 1.1)));
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
