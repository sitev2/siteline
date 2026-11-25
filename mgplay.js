// The Minigames on your own screen: the host's state (mghost.js state()) drawn and heard — the floaties (in hands,
// flying, floating, lying on the court), the goals' posts and nets, a puff of smoke where someone went out, the Hot
// Potato's glow and its beeps — and the HUD: the game's name, how to play and the 3-2-1 at the start of each round,
// the timer, the score or who is still in, and the standings between rounds. Your inputs: E / the hand button picks
// a floatie up (or catches one thrown at you), fire / the aim button throws it. The host decides everything else.
import * as THREE from 'three';
import { POOL } from './poolmap.js';
import { ARENA, MG_GAMES, MG_TEAMS, setGoalPosts, goalMouth } from './mgmap.js';
import { MG } from './mghost.js';
import { RING_G } from './poolhost.js';
import { radialTexture } from './textures.js';
import { setIconText, iconHTML } from './icons.js';
import * as sfx from './audio.js';
import { TEAM_COLORS } from './models.js';
import { VB, courtOf, sideOf, clampSide, inReach } from './volley.js';

const { G, WY } = POOL;
const EYE_H = 1.62;
const TEAM_CSS = { atk: '#f0a040', def: '#5aa0ff', ffa: '#e9eef5' };
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;

export class MiniClient {
  constructor(game) {
    this.g = game;
    this.ud = game.builtMap.group.userData;
    // (the Pool Hall's plan; a Volleyball map has none: no floaties, no goals, only the court)
    this.plan = game.world.def.pool || game.world.def.vb || {};
    this.arena = !!(game.world.def.pool && game.world.def.pool.arena);
    this.court = courtOf(game.world.def);
    this.rings = (this.plan.floaties || []).map((f, i) => ({ i, x: f.x, y: G, z: f.z, vx: 0, vy: 0, vz: 0, tx: f.x, ty: G, tz: f.z, holder: 0, mode: 4, live: 0, spin: 0, seen: false }));
    this.s = null;
    this.stage = 'wait';
    this.big = [false, false];
    this.lastCount = -1;
    this.beepAt = 0;
    this.puffs = [];
    this.boardFor = -1;
    // the Hot Potato's floatie glows: its own material, so the others don't
    const m0 = this.ud.floaties && this.ud.floaties[0] && this.ud.floaties[0].children[0];
    this.hotMat = m0 ? m0.material : null;
    this.goals = [];
    if (this.arena) this.buildGoals();
    if (this.court) this.buildVolley();
    this.puffTex = radialTexture('rgba(255,255,255,0.95)', 'rgba(220,225,230,0)');
    for (const id of ['mg-top', 'mg-side']) $(id).classList.remove('hidden');
    document.body.classList.add('mg-mode');
  }

  // ---- the goals: two posts, a crossbar in the team's colour, and a net sloping back to the alcove's far wall ----
  buildGoals() {
    this.goals = ARENA.goals.map((g) => {
      const root = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.4 }), team = new THREE.MeshStandardMaterial({ color: TEAM_CSS[g.side], roughness: 0.45 });
      const H = ARENA.postH, postGeo = new THREE.CylinderGeometry(0.07, 0.07, H + 0.5, 12);
      const posts = [0, 1].map(() => { const m = new THREE.Mesh(postGeo, white); root.add(m); return m; });
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 12), team);
      bar.rotation.x = Math.PI / 2; root.add(bar);
      const net = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f4f4f0', transparent: true, opacity: 0.55 }));
      root.add(net);
      this.g.scene.add(root);
      return { g, root, posts, bar, net };
    });
    this.placeGoals();
  }
  placeGoals() {
    this.goals.forEach((o, i) => {
      // (the normal goal: each post on the inner edge of its 0.5 m column, the host's '_post' collision; a big goal: at the sides)
      const g = o.g, m = goalMouth(g, this.big[i]), H = ARENA.postH, x = g.line + (g.dir < 0 ? -0.07 : 0.07), e = this.big[i] ? 0.07 : -0.07;
      o.posts[0].position.set(x, WY + H / 2 - 0.25, m.z0 + e);
      o.posts[1].position.set(x, WY + H / 2 - 0.25, m.z1 - e);
      const z0 = o.posts[0].position.z, z1 = o.posts[1].position.z;
      o.bar.position.set(x, WY + H, (z0 + z1) / 2); o.bar.scale.set(1, z1 - z0, 1);
      // the net: from the crossbar back and down to the far wall's top edge, and its two sides
      const bx = g.back + (g.dir < 0 ? 0.08 : -0.08), pts = [];
      for (let k = 0; k <= 10; k++) { const z = z0 + (z1 - z0) * k / 10; pts.push(x, WY + H, z, bx, G + 0.02, z); }
      for (let k = 0; k <= 5; k++) { const t = k / 5, xx = x + (bx - x) * t, yy = WY + H + (G + 0.02 - WY - H) * t; pts.push(xx, yy, z0, xx, yy, z1); }
      for (const z of [z0, z1]) for (let k = 0; k <= 4; k++) { const t = k / 4, xx = x + (bx - x) * t, yy = WY + H + (G + 0.02 - WY - H) * t; pts.push(xx, yy, z, xx, WY - 0.05, z); }
      o.net.geometry.dispose();
      o.net.geometry = new THREE.BufferGeometry();
      o.net.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    });
  }
  showGoals(on) { for (const o of this.goals) o.root.visible = on; }

  // ---- Volleyball: the court's lines, the net on its two posts, the ball and its shadow (the same on every map) ----
  buildVolley() {
    const c = this.court, root = this.vbRoot = new THREE.Group(), y = c.y;
    root.visible = false;
    // the lines: white, 5 cm wide, just over the floor (the end lines, the side lines and the line under the net)
    const lineMat = new THREE.MeshLambertMaterial({ color: '#f6f6f2', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const strip = (x0, z0, x1, z1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), lineMat); m.position.set((x0 + x1) / 2, y + 0.014, (z0 + z1) / 2); root.add(m); };
    const w = 0.05;
    strip(c.x0 - w, c.z0 - w, c.x1 + w, c.z0); strip(c.x0 - w, c.z1, c.x1 + w, c.z1 + w);
    strip(c.x0 - w, c.z0, c.x0, c.z1); strip(c.x1, c.z0, c.x1 + w, c.z1); strip(c.cx - w / 2, c.z0, c.cx + w / 2, c.z1);
    // the posts (dark steel) and the net: a white band along its top, a dark mesh, a thin cord along its bottom
    const steel = new THREE.MeshStandardMaterial({ color: '#30353b', metalness: 0.5, roughness: 0.45 });
    for (const z of [c.pz0, c.pz1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, VB.netTop + 0.25, 12), steel); p.position.set(c.cx, y + (VB.netTop + 0.25) / 2, z); root.add(p); }
    const L = c.pz1 - c.pz0, band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, L), new THREE.MeshStandardMaterial({ color: '#f4f4ee', roughness: 0.6 }));
    band.position.set(c.cx, y + VB.netTop - 0.035, c.cz); root.add(band);
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, L), new THREE.MeshStandardMaterial({ color: '#d8d8d0' }));
    cord.position.set(c.cx, y + VB.netBottom, c.cz); root.add(cord);
    const pts = [], step = 0.1;
    for (let z = c.pz0 + 0.05; z < c.pz1; z += step) pts.push(c.cx, y + VB.netBottom, z, c.cx, y + VB.netTop - 0.07, z);
    for (let yy = VB.netBottom; yy < VB.netTop - 0.05; yy += step) pts.push(c.cx, y + yy, c.pz0, c.cx, y + yy, c.pz1);
    const net = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#1c1f24', transparent: true, opacity: 0.75 }));
    net.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(net);
    // the ball: white, yellow and blue curved panels (vertex colours)
    const geo = new THREE.SphereGeometry(VB.r, 24, 16), pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    const C3 = [new THREE.Color('#f6f4ec'), new THREE.Color('#f2c22e'), new THREE.Color('#2c63c8')];
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i) / VB.r, vy = pos.getY(i) / VB.r, vz = pos.getZ(i) / VB.r;
      const panel = Math.floor(((Math.atan2(vz, vx) + Math.PI) / (Math.PI * 2)) * 6 + vy * 1.6 + 6) % 3;
      cols.set([C3[panel].r, C3[panel].g, C3[panel].b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const ball = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    ball.castShadow = true;
    root.add(ball);
    // its shadow straight below it on the floor: where it will come down (bigger and fainter the higher it is)
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    root.add(sh);
    this.vball = { mesh: ball, shadow: sh, x: c.cx, y: y + 1, z: c.cz, tx: c.cx, ty: y + 1, tz: c.cz, vx: 0, vy: 0, vz: 0, mode: 0, spin: 0 };
    this.g.scene.add(root);
  }
  // every frame: the ball carries on along its arc between the host's updates (falling, as on the host)
  updateVolley(dt) {
    const B = this.vball, c = this.court;
    if (!B || !this.vbRoot.visible) return;
    if (B.mode === 1) {
      B.tx += B.vx * dt; B.ty += B.vy * dt; B.tz += B.vz * dt; B.vy -= VB.g * dt;
      if (B.ty < c.y + VB.r) B.ty = c.y + VB.r;
      const k = Math.min(1, dt * 18);
      B.x += (B.tx - B.x) * k; B.y += (B.ty - B.y) * k; B.z += (B.tz - B.z) * k;
      B.spin += dt * Math.hypot(B.vx, B.vz) * 3;
    } else { const k = Math.min(1, dt * 12); B.x += (B.tx - B.x) * k; B.y += (B.ty - B.y) * k; B.z += (B.tz - B.z) * k; }
    B.mesh.visible = B.mode !== 0;
    B.mesh.position.set(B.x, B.y, B.z);
    B.mesh.rotation.set(B.spin, B.spin * 0.6, 0);
    const hgt = Math.max(0, B.y - c.y - VB.r), k = Math.max(0.25, 1 - hgt / 9);
    B.shadow.visible = B.mesh.visible && hgt > 0.05;
    B.shadow.position.set(B.x, c.y + 0.02, B.z);
    B.shadow.scale.setScalar(1.6 - 0.8 * k);
    B.shadow.material.opacity = 0.12 + 0.3 * k;
  }

  // ---- the host's state ----
  apply(s) {
    if (!s) return;
    const g = this.g, first = !this.s, was = this.stage;
    this.s = s; this.stage = s.st;
    this.stamp();
    // the goals' width (Pool Ball with uneven teams): the same posts as the host's
    const big = (s.big || [0, 0]).map(Boolean);
    if (this.arena && (big[0] !== this.big[0] || big[1] !== this.big[1])) { this.big = big; big.forEach((b, i) => setGoalPosts(g.world, i, b)); this.placeGoals(); }
    this.showGoals(s.g === 'poolball');
    // Volleyball: its court, net and ball show only in its rounds (on the Volleyball maps, always)
    if (this.vbRoot) this.vbRoot.visible = s.g === 'volley';
    if (s.vb && this.vball) {
      const [x, y, z, vx, vy, vz, mode] = s.vb.b, B = this.vball;
      if (first || B.mode !== mode || Math.hypot(x - B.x, y - B.y, z - B.z) > 2.5) { B.x = x; B.y = y; B.z = z; }
      Object.assign(B, { tx: x, ty: y, tz: z, vx, vy, vz, mode });
    }
    s.r.forEach((q, i) => {
      const r = this.rings[i];
      if (!r) return;
      const [x, y, z, vx, vy, vz, holder, mode, live] = q;
      const jump = Math.hypot(x - r.x, y - r.y, z - r.z);
      if (first || r.mode === 4 || mode === 4 || jump > 3 || (r.mode !== 1 && mode === 1)) { r.x = x; r.y = y; r.z = z; }
      r.tx = x; r.ty = y; r.tz = z; r.vx = vx; r.vy = vy; r.vz = vz; r.holder = holder; r.mode = mode; r.live = live;
    });
    if (was !== s.st || first) this.onStage(was, s.st);
  }

  onStage(was, st) {
    const s = this.s, def = MG_GAMES[s.g];
    $('mg-intro').classList.toggle('hidden', st !== 'intro' && st !== 'wait');
    $('mg-board').classList.toggle('hidden', st !== 'board');
    if ((st === 'intro' || st === 'wait') && def) {
      this.lastCount = -1;
      $('mg-round').textContent = s.vbm ? `${this.g.world.def.name} · ${s.vbm.of > 1 ? `set ${s.rd} · best of ${s.vbm.of}` : 'one set'}` : s.run === 'party' ? `Party run · round ${s.rd} of ${s.of}` : `Round ${s.rd} of ${s.of}`;
      $('mg-title').textContent = def.name;
      $('mg-how').textContent = def.how;
      setIconText($('mg-keys'), this.keysLine());
      const team = this.g.me.team;
      $('mg-team').innerHTML = s.tm && (team === 'atk' || team === 'def') ? `You are <b style="color:${TEAM_CSS[team]}">${MG_TEAMS[team]}</b>${s.g === 'poolball' ? ` · defend the ${MG_TEAMS[team].toLowerCase()} goal` : ''}` : '';
    }
    if (st === 'board') this.renderBoard($('mg-board-table'), true);
  }

  // what the buttons do, for this round (keyboard or touch)
  keysLine() {
    const g = this.s && this.s.g, t = this.g.settings.touch, k = a => this.g.key(a);
    const pick = t ? '[[hand]] pick up' : `${k('use')} pick up`, thr = t ? '[[aim]] throw' : 'click to throw';
    if (g === 'dodge') return `${pick} · ${thr} · ${t ? '[[hand]]' : k('use')} just as one reaches you to catch it`;
    if (g === 'keepaway') return `${pick} · ${thr} · run into whoever has it to steal it`;
    if (g === 'potato') return 'Run into someone to pass it on';
    if (g === 'poolball') return `Swim into the floatie to push it · ${pick} · ${thr}`;
    if (g === 'volley') return `${t ? 'Tap [[aim]]' : 'Click (or E)'} to hit the ball when it comes to you: it goes where you look · jump at the net and look down to spike`;
    return '';
  }

  // something happened: a sound, and sometimes a few words
  fx(m) {
    const g = this.g, me = g.myId, at = (x, y, z) => ({ x, y, z }), occ = (p) => g.occlusion(p.x, p.y, p.z);
    const R = (i) => this.rings[i] || this.rings[0];
    const who = (id) => (id === me ? 'You' : g.playerById(id).name);
    switch (m.k) {
      case 'grab': { const r = R(m.i), p = at(r.x, r.y, r.z); sfx.playPool('rubber', p, occ(p), 0.6, 1.2); return; }
      case 'throw': { const r = R(m.i); sfx.playSwing({ pos: at(r.x, r.y, r.z) }); return; }
      case 'splash': sfx.playPool('splash', at(m.x, m.y, m.z), 0, 0.7, 1.3); g.addRipple(m.x, m.z, 1.6); return;
      case 'bump': sfx.playPool(Math.random() < 0.5 ? 'rubber' : 'bonk', at(m.x, m.y, m.z), 0, 0.4 + m.v * 0.6); return;
      case 'hit': sfx.playPool('bonk', at(m.x, m.y, m.z), 0, 1.3, 0.9); if (m.id === me) g.shake = Math.min(1, g.shake + 0.5); return;
      case 'catch':
        sfx.playPool('rubber', null, 0, 1, 0.8);
        g.hud.center('', m.id === me ? 'Caught it! The thrower is out' : m.by === me ? `${who(m.id)} caught your throw: you are out` : `${who(m.id)} caught it`, '#9dffb5', 2);
        return;
      case 'steal': sfx.playPool('rubber', null, 0, 0.7, 1.4); if (m.id === me) g.hud.center('', 'You have it! Keep away', '#ffd27a', 1.4); else if (m.from === me) g.hud.center('', `${who(m.id)} stole it`, '#ff9a7a', 1.4); return;
      case 'hot': case 'pass':
        sfx.playClick();
        if (m.id === me) g.hud.center('', 'You have the hot potato! Touch someone', '#ff7a4a', 1.6);
        else if (m.k === 'pass' && m.from === me) g.hud.center('', `Passed to ${who(m.id)}`, '#ffd27a', 1.2);
        return;
      case 'pop': {
        const p = at(m.x, m.y, m.z);
        sfx.playMG('pop', m.id === me ? null : p, 1.3);
        this.puff(m.x, m.y, m.z, 1.4);
        if (Math.hypot(m.x - g.me.pos.x, m.z - g.me.pos.z) < 6) g.shake = Math.min(1.5, g.shake + 0.8);
        g.hud.center('', m.id === me ? 'Pop! You are out' : `Pop! ${who(m.id)} is out`, '#ff7a4a', 2.2);
        return;
      }
      case 'goal': {
        sfx.playMG('horn', null, 1);
        g.addRipple(m.x, m.z, 2.4);
        const mine = m.team === g.me.team;
        g.hud.center(`${MG_TEAMS[m.team]} scores!`, `${m.by ? `${m.by} · ` : ''}${MG_TEAMS.atk} ${m.sc[0]} – ${m.sc[1]} ${MG_TEAMS.def}`, TEAM_CSS[m.team], 2.6);
        if (mine) sfx.playChime(true);
        return;
      }
      case 'go': sfx.playMG('go', null, 1); g.hud.center('GO!', '', '#ffffff', 1); return;
      case 'end': sfx.playChime(true); g.hud.center(m.text, '', '#ffe08a', MG.end); return;
      case 'back': sfx.playClick(); return;
      // Volleyball
      case 'vtoss': { const B = this.vball; if (B) sfx.playSwing({ pos: at(B.x, B.y, B.z) }); return; }
      case 'vhit': sfx.playPool('bonk', at(m.x, m.y, m.z), 0, m.spike ? 1.5 : 1.1, m.spike ? 0.75 : 1.05); if (m.spike && m.id === me) g.shake = Math.min(0.6, g.shake + 0.3); return;
      case 'vnet': sfx.playPool('rattle', at(m.x, m.y, m.z), 0, 0.8, 1.2); return;
      case 'vretoss': if (this.vbServer() === me) g.hud.center('', 'Hit the ball as it drops: click (or E) when it is over you', '#ffe08a', 2.4); return;
      case 'vpoint': {
        sfx.playMG('whistle', null, 0.55);
        const why = { in: '', out: 'Out', under: 'Under the net', wide: 'Round the post', touches: 'Too many touches', twice: 'Touched twice', serve: 'Missed serve' }[m.why] || '';
        g.hud.center(`${MG_TEAMS[m.team]} point`, `${why ? `${why} · ` : ''}${MG_TEAMS.atk} ${m.sc[0]} – ${m.sc[1]} ${MG_TEAMS.def}`, TEAM_CSS[m.team], 1.6);
        if (m.team === g.me.team) sfx.playChime(true);
        return;
      }
    }
  }
  vbServer() { return this.s && this.s.vb ? this.s.vb.srv : null; }

  // someone went out (Dodgeball: hit or their throw caught; Hot Potato: the pop): a puff of smoke, no body
  onOut(m) {
    const g = this.g, id = m.victim;
    const p = id === g.myId ? g.me.pos : (g.remotes.get(id) || {}).rp;
    if (p) { this.puff(p.x, p.y + 1, p.z, 1); if (m.how !== 'pop') sfx.playMG('whistle', id === g.myId ? null : { x: p.x, y: p.y + 1.5, z: p.z }, 0.8); sfx.playMG('puff', id === g.myId ? null : { x: p.x, y: p.y + 1, z: p.z }, 0.7); }
    const r = g.remotes.get(id);
    if (r && r.model) r.model.root.visible = false;
    if (id === g.myId) {
      g.me.killedBy = m.how === 'pop' ? 'pop' : m.how === 'caught' ? 'caught' : 'hit';
      if (m.how !== 'pop') g.hud.center('', m.how === 'caught' ? `${g.playerById(m.killer).name} caught your throw: you are out` : 'Hit! You are out', '#ff9a7a', 2.2);
    } else if (m.how !== 'pop' && m.how !== 'caught') g.hud.center('', `${g.playerById(id).name} is out`, '#e8e8e8', 1.4);
  }

  puff(x, y, z, size = 1) {
    for (let k = 0; k < 9; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false, opacity: 0.85, color: new THREE.Color().setScalar(0.85 + Math.random() * 0.15) }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35 * size;
      s.position.set(x + Math.cos(a) * r, y + (Math.random() - 0.3) * 0.6 * size, z + Math.sin(a) * r);
      s.userData = { t: 0, life: 0.8 + Math.random() * 0.5, grow: (1.1 + Math.random() * 0.8) * size, vx: Math.cos(a) * 0.9 * size, vz: Math.sin(a) * 0.9 * size, vy: 0.4 + Math.random() * 0.6 };
      s.scale.setScalar(0.3 * size);
      this.g.scene.add(s);
      this.puffs.push(s);
    }
  }

  // ---- what I can do ----
  holding() { return this.rings.some(r => r.holder === this.g.myId); }
  playing() { return !!this.s && this.s.st === 'play' && this.g.me.alive; }
  // E / the hand button would: catch (a live floatie on its way at me, Dodgeball), or pick one up
  useTarget() {
    const g = this.g, me = g.me, s = this.s;
    if (!this.playing() || s.g === 'potato') return null;
    if (s.g === 'volley') {
      const v = s.vb, B = this.vball;
      if (!v || !B || B.mode !== 1 || (v.r !== 'play' && v.r !== 'toss') || (v.r === 'toss' && v.srv !== g.myId)) return null;
      return sideOf(this.court, B.x) === me.team && inReach(me.pos, B) ? { kind: 'hit' } : null;
    }
    if (s.g === 'dodge') {
      for (const r of this.rings) {
        if (!r.live || r.mode !== 1) continue;
        const dx = me.pos.x - r.x, dz = me.pos.z - r.z, d = Math.hypot(dx, dz), sp = Math.hypot(r.vx, r.vz);
        if (d < 4 && sp > 1 && (r.vx * dx + r.vz * dz) / (d * sp) > 0.6) return { kind: 'catch', i: r.i };
      }
    }
    if (this.holding() || (s.g === 'poolball' && s.ps) || (s.g === 'keepaway' && s.gd === g.myId)) return null;
    for (const r of this.rings) {
      if (r.holder || r.mode === 4 || r.live) continue;
      const dy = r.y - me.pos.y;
      if (Math.hypot(r.x - me.pos.x, r.z - me.pos.z) < 1.75 && dy > -0.6 && dy < 2.3) return { kind: 'ring', i: r.i };
    }
    return null;
  }
  // E pressed: in Dodgeball always sent (it may be a catch: the host decides); else only with something in reach
  use() {
    if (!this.playing()) return;
    if (this.s.g === 'volley') { this.throw(); return; }        // (Volleyball: E hits the ball too)
    if (this.s.g === 'dodge' || this.useTarget()) this.g.transport.send({ t: 'ring' });
  }
  // a few words while you hold something that matters (game.js shows it as the hint)
  holdHint() {
    const s = this.s, id = this.g.myId;
    if (!this.playing()) return '';
    if (s.g === 'potato' && s.hot && s.hot[0] === id) return 'You have the hot potato! Run into someone';
    if (s.g === 'keepaway' && this.rings[0].holder === id) return this.g.settings.touch ? 'Keep away! Tap [[aim]] to throw it' : 'Keep away! Click to throw it';
    if (s.g === 'volley' && s.vb) {
      const v = s.vb, t = this.g.settings.touch, me = this.g.me;
      if (v.srv === id && (v.r === 'ready' || v.r === 'dead' || v.r === 'toss')) return `Your serve: look over the net, ${t ? 'tap [[aim]]' : 'click'} as the ball drops to you`;
      if (this.useTarget()) return `${t ? 'Tap [[aim]]' : 'Click'} to hit it!`;
      const mx = v.mx[me.team === 'atk' ? 0 : 1];
      if (v.r === 'play' && v.sd === me.team && v.t > 0) return `${v.t} of ${mx} touches: get it over`;
    }
    return '';
  }
  // the fire / aim button: throws the floatie you hold; in Volleyball it is always there (it hits the ball)
  canThrow() { return this.playing() && this.s.g !== 'potato' && (this.s.g === 'volley' || this.holding()); }
  throw() { const me = this.g.me; if (this.canThrow()) this.g.transport.send({ t: 'throw', yaw: me.yaw, pitch: me.pitch }); }
  // nobody moves during the countdown
  frozen() { return !this.s || this.s.st === 'intro' || this.s.st === 'wait'; }
  // how fast I may run: the Keep Away holder is slower, the Hot Potato holder a little faster
  speedK() {
    const s = this.s, id = this.g.myId;
    if (!s || s.st !== 'play') return 1;
    if (s.g === 'keepaway' && this.rings[0].holder === id) return MG.speed.keep;
    if (s.g === 'potato' && s.hot && s.hot[0] === id) return MG.speed.potato;
    return 1;
  }
  // team Dodgeball: each team keeps to its own half of the court
  clamp(pos) {
    const s = this.s, team = this.g.me.team;
    if (s && s.g === 'volley' && this.court) { clampSide(this.court, team, pos); return; }      // (your own side of the net)
    if (!s || s.g !== 'dodge' || !s.tm || (team !== 'atk' && team !== 'def')) return;
    const m = ARENA.court.mid;
    if (team === 'atk' && pos.x > m - 0.4) pos.x = m - 0.4;
    if (team === 'def' && pos.x < m + 0.4) pos.x = m + 0.4;
  }

  // ---- every frame ----
  update(dt) {
    const g = this.g, me = g.me, ud = this.ud, now = g.clock, s = this.s;
    // the floaties
    this.updateVolley(dt);
    this.rings.forEach((r, i) => {
      const m = ud.floaties && ud.floaties[i];
      if (!m) return;
      m.visible = r.mode !== 4;
      if (r.mode === 4) return;
      // (in my hands, or in the hands of the one I am watching from their eyes: held low in front of the view)
      const view = me.alive ? g.myId : me.spectate, vr = view && view !== g.myId ? g.remotes.get(view) : null;
      if (r.holder && r.holder === view && (me.alive || (vr && vr.rp))) {
        const yaw = me.alive ? me.yaw : vr.rp.yaw, pitch = me.alive ? me.pitch : vr.rp.pitch, P = me.alive ? me.pos : vr.rp;
        // (low enough to see past, high enough to stay in sight at the bottom of the screen)
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), up = (me.alive ? me.swim : false) ? -0.5 : -0.56;
        m.position.set(P.x + fx * 0.78, P.y + EYE_H + up + Math.sin(pitch) * 0.45, P.z + fz * 0.78);
        m.rotation.set(0.75, yaw, 0, 'YXZ');
        r.x = m.position.x; r.y = m.position.y; r.z = m.position.z;
      } else if (r.holder === g.myId && me.alive) {
        const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
        m.position.set(me.pos.x + fx * 0.62, me.pos.y + EYE_H - 0.78 + Math.sin(me.pitch) * 0.35, me.pos.z + fz * 0.62);
        m.rotation.set(0.5, me.yaw, 0, 'YXZ');
        r.x = m.position.x; r.y = m.position.y; r.z = m.position.z;
      } else if (r.holder) {
        const q = g.remotes.get(r.holder);
        if (q && q.rp) { const fx = -Math.sin(q.rp.yaw), fz = -Math.cos(q.rp.yaw); m.position.set(q.rp.x + fx * 0.38, q.rp.y + 1.15, q.rp.z + fz * 0.38); m.rotation.set(Math.PI / 2, q.rp.yaw, 0, 'YXZ'); r.x = m.position.x; r.y = m.position.y; r.z = m.position.z; }
        m.visible = !!(q && q.alive);
      } else {
        if (r.mode === 1) {
          // flying: where the host had it carries on along its arc between updates; the picture follows closely
          r.tx += r.vx * dt; r.ty += r.vy * dt; r.tz += r.vz * dt; r.vy -= RING_G * dt;
          const k = Math.min(1, dt * 18);
          r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k;
        } else { const k = Math.min(1, dt * 10); r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; }
        const t = now + i * 1.7, float = r.mode === 0;
        r.spin += dt * (r.mode === 1 ? 7 : float ? 0.12 : 0);
        m.position.set(r.x, r.y + (float ? 0.035 + Math.sin(t * 1.25) * 0.022 : r.mode === 2 ? 0.12 : 0), r.z);
        m.rotation.set(float ? Math.sin(t * 0.9) * 0.06 : r.mode === 1 ? r.spin * 0.7 : 0, r.spin, float ? Math.cos(t * 1.1) * 0.06 : 0);
        if (float && Math.random() < dt * 0.25) g.addRipple(r.x, r.z, 0.35);
      }
    });
    // the Hot Potato: it glows hotter and beeps faster as its fuse runs down
    const hot = s && s.g === 'potato' && s.hot && s.hot[0] && s.st === 'play' ? s.hot : null;
    if (this.hotMat) {
      if (hot) {
        const f = Math.max(0, hot[1] - (performance.now() - (this.hotAt || performance.now())) / 1000), k = 1 - f / MG.fuse;
        const rate = 1.2 + k * k * 9, pulse = 0.5 + 0.5 * Math.sin(now * rate * Math.PI * 2);
        this.hotMat.emissive.setRGB(1, 0.28 + 0.2 * (1 - k), 0.06);
        this.hotMat.emissiveIntensity = 0.25 + k * 1.2 + pulse * (0.3 + k * 0.9);
        if (performance.now() >= this.beepAt) {
          this.beepAt = performance.now() + (0.12 + 0.88 * Math.max(0, f / MG.fuse)) * 1000;
          const r = this.rings[0];
          sfx.playBeep(hot[0] === g.myId ? null : { x: r.x, y: r.y, z: r.z });
        }
      } else { this.hotMat.emissiveIntensity = 0; this.beepAt = 0; }
    }
    // puffs of smoke
    for (const p of [...this.puffs]) {
      const u = p.userData; u.t += dt;
      const k = u.t / u.life;
      p.position.x += u.vx * dt; p.position.z += u.vz * dt; p.position.y += u.vy * dt;
      u.vx *= 1 - dt * 2.5; u.vz *= 1 - dt * 2.5;
      p.scale.setScalar(0.3 + u.grow * Math.sqrt(k));
      p.material.opacity = 0.85 * (1 - k);
      if (k >= 1) { this.g.scene.remove(p); p.material.dispose(); this.puffs.splice(this.puffs.indexOf(p), 1); }
    }
    document.body.classList.toggle('pool-ring', this.canThrow());
    // your own sleeves while you swim: your team's colour (they are the Poolrooms' yellow suit otherwise)
    if (g.poolHands && this.sleeveTeam !== me.team) {
      this.sleeveTeam = me.team;
      const c = TEAM_COLORS[me.team] || TEAM_COLORS.ffa, sl = g.poolHands.sleeve;
      sl.map = null; sl.color.set(c.body); sl.needsUpdate = true;
    }
    this.hud(dt);
  }

  // ---- the HUD ----
  hud() {
    const s = this.s, g = this.g;
    if (!s) return;
    const def = MG_GAMES[s.g] || {};
    // the countdown: 3, 2, 1 (a blip each), then GO (the host's 'go')
    if (s.st === 'intro') {
      const n = Math.max(1, Math.ceil(s.tl - (performance.now() - (this.sAt || performance.now())) / 1000));
      if (n !== this.lastCount) { this.lastCount = n; $('mg-count').textContent = String(n); $('mg-count').classList.remove('wait'); sfx.playMG('count', null, 0.8); }
    } else if (s.st === 'wait') { this.setText('mg-count', 'Waiting for everyone…'); $('mg-count').classList.add('wait'); }
    // the top: the game, the timer (Hot Potato: its fuse), the score
    const tl = Math.max(0, s.tl - (s.st === 'play' || s.st === 'intro' || s.st === 'board' ? (performance.now() - (this.sAt || performance.now())) / 1000 : 0));
    const vbm = s.vbm;      // (the Volleyball mode: sets, no time limit)
    const top = vbm ? '' : s.st === 'play' ? (s.g === 'potato' ? (s.hot && s.hot[0] ? `${Math.ceil(tl)}` : '…') : def.time ? fmt(Math.ceil(tl)) : '') : s.st === 'board' ? '' : s.st === 'intro' || s.st === 'wait' ? (def.time ? fmt(def.time) : s.g === 'potato' ? String(MG.fuse) : '') : '';
    this.setText('mg-game', vbm ? `${this.g.world.def.name} · ${vbm.of > 1 ? `set ${s.rd} · best of ${vbm.of}` : 'one set'}` : `${def.name || 'Minigames'}${s.of > 1 ? ` · ${s.rd}/${s.of}` : ''}`);
    this.setText('mg-timer', top);
    $('mg-timer').classList.toggle('hot', s.g === 'potato' && s.st === 'play');
    const list = this.people();
    let score = '';
    if (s.g === 'volley' && s.vb) {
      const w = [0, 0]; for (const [a, d] of (vbm && vbm.sets) || []) { if (a > d) w[0]++; else if (d > a) w[1]++; }
      score = `<span style="color:${TEAM_CSS.atk}">${MG_TEAMS.atk} ${s.vb.s[0]}</span> – <span style="color:${TEAM_CSS.def}">${s.vb.s[1]} ${MG_TEAMS.def}</span>${vbm && vbm.of > 1 ? ` <small>· sets ${w[0]}–${w[1]}</small>` : ''}`;
    } else if (s.g === 'poolball') score = `<span style="color:${TEAM_CSS.atk}">${MG_TEAMS.atk} ${s.sc[0]}</span> – <span style="color:${TEAM_CSS.def}">${s.sc[1]} ${MG_TEAMS.def}</span>`;
    else if (s.g === 'keepaway') { const mine = (s.kp || []).find(e => e[0] === g.myId); score = `Your points: <b>${mine ? mine[1] : 0}</b>`; }
    else if (s.tm) { const n = t => list.filter(p => p.team === t && p.alive).length; score = `<span style="color:${TEAM_CSS.atk}">${MG_TEAMS.atk} ${n('atk')}</span> · <span style="color:${TEAM_CSS.def}">${MG_TEAMS.def} ${n('def')}</span> still in`; }
    else score = `${list.filter(p => p.alive).length} still in`;
    this.setHTML('mg-score', s.st === 'board' || s.st === 'wait' ? '' : score);
    // the side: who is still in (Dodgeball, Hot Potato), everyone's points (Keep Away), the teams (Pool Ball)
    let side = '';
    if (s.st === 'play' || s.st === 'intro' || s.st === 'end') {
      const kp = new Map(s.kp || []), hotId = s.hot && s.hot[0];
      const rows = list.slice().sort((a, b) => (s.g === 'keepaway' ? (kp.get(b.id) || 0) - (kp.get(a.id) || 0) : 0) || (b.alive - a.alive) || (a.team > b.team ? 1 : -1));
      side = rows.map(p => {
        const col = TEAM_CSS[p.team] || TEAM_CSS.ffa, tags = [];
        if (s.g === 'keepaway') tags.push(`<b>${kp.get(p.id) || 0}</b>`);
        if (hotId === p.id) tags.push(iconHTML('[[ring]]'));
        else if (s.g === 'volley' && s.vb && s.vb.srv === p.id) tags.push(iconHTML('[[ball]]'));
        else if (s.g === 'keepaway' && this.rings[0] && this.rings[0].holder === p.id) tags.push(iconHTML('[[ring]]'));
        return `<li class="${p.alive ? '' : 'out'}${p.id === g.myId ? ' me' : ''}"><i style="background:${col}"></i><span>${esc(p.name)}</span>${tags.join(' ')}</li>`;
      }).join('');
    }
    this.setHTML('mg-side', side ? `<ol>${side}</ol>` : '');
    // the standings: between rounds, and while the scoreboard key / button is held
    const want = s.st === 'board' || (g.input.scoreHeld && s.st !== 'intro');
    $('mg-board').classList.toggle('hidden', !want);
    document.body.classList.toggle('mg-boardup', want);
    if (want) {
      this.renderBoard($('mg-board-table'), s.st === 'board');
      this.setText('mg-board-next', s.st === 'board' ? `Next ${s.vbm ? 'set' : 'round'} in ${Math.ceil(tl)}…` : '');
    }
  }
  setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
  setHTML(id, h) { const el = $(id); if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; } }

  // everyone in the room (me first), with their team and whether they are still in
  people() {
    const g = this.g, out = [{ id: g.myId, name: g.settings.name || 'You', team: g.me.team, alive: g.me.alive }];
    for (const r of g.remotes.values()) if (!r.dummy && r.team !== 'monster') out.push({ id: r.id, name: r.name, team: r.team, alive: r.alive });
    return out;
  }

  renderBoard(table, between) {
    const s = this.s;
    if (s.vbm) return this.renderSets(table);
    const res = new Map((s.res || []).map(e => [e[0], e]));
    const key = JSON.stringify([s.pts, s.res, between, s.rd]);
    if (this.boardKey === key) return;
    this.boardKey = key;
    const during = s.st === 'play' || s.st === 'intro' || s.st === 'wait';
    $('mg-board-title').innerHTML = iconHTML(`[[trophy]] ${!during && s.rd >= s.of ? 'Final standings' : during ? `Standings · round ${s.rd} of ${s.of}` : `Standings after round ${s.rd} of ${s.of}`}`);
    let place = 0, last = null;
    const rows = (s.pts || []).map(([id, name, pts], k) => {
      if (pts !== last) { place = k + 1; last = pts; }
      const r = res.get(id), gain = r && between ? `<td class="gain">${r[2] ? `+${r[2]}` : ''}</td>` : between ? '<td class="gain"></td>' : '';
      return `<tr class="${id === this.g.myId ? 'me' : ''}"><td class="pl">${place}</td><td>${esc(name)}</td>${gain}<td class="pts">${pts}</td></tr>`;
    }).join('');
    table.innerHTML = `<tr><th></th><th>Player</th>${between ? '<th>Round</th>' : ''}<th>Points</th></tr>${rows}`;
  }

  // the Volleyball mode's board: each set's score and the sets won
  renderSets(table) {
    const s = this.s, sets = s.vbm.sets || [], w = [0, 0];
    for (const [a, d] of sets) { if (a > d) w[0]++; else if (d > a) w[1]++; }
    const key = JSON.stringify([sets, s.st]);
    if (this.boardKey === key) return;
    this.boardKey = key;
    $('mg-board-title').innerHTML = iconHTML(`[[trophy]] Sets: ${MG_TEAMS.atk} ${w[0]} – ${w[1]} ${MG_TEAMS.def}`);
    const mine = this.g.me.team;
    const rows = sets.map(([a, d], k) => `<tr><td class="pl">${k + 1}</td><td>Set ${k + 1}</td><td style="color:${TEAM_CSS.atk}">${a}</td><td style="color:${TEAM_CSS.def}" class="pts">${d}</td></tr>`).join('');
    table.innerHTML = `<tr><th></th><th></th><th style="color:${TEAM_CSS.atk}">${MG_TEAMS.atk}${mine === 'atk' ? ' (you)' : ''}</th><th style="color:${TEAM_CSS.def}">${MG_TEAMS.def}${mine === 'def' ? ' (you)' : ''}</th></tr>${rows || '<tr><td></td><td colspan="3">The first set is on</td></tr>'}`;
  }

  // the state's clock is "seconds left when it was sent": remember when that was
  stamp() { this.sAt = performance.now(); if (this.s && this.s.hot) this.hotAt = performance.now(); }

  destroy() {
    document.body.classList.remove('mg-mode', 'pool-ring', 'mg-boardup');
    for (const id of ['mg-top', 'mg-side', 'mg-intro', 'mg-board']) $(id).classList.add('hidden');
    for (const o of this.goals) this.g.scene.remove(o.root);
    if (this.vbRoot) this.g.scene.remove(this.vbRoot);
    for (const p of this.puffs) this.g.scene.remove(p);
  }
}
