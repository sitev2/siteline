// The thing in the garage: Level 1's creature. Its brain runs on the host (and the home server), never in a client.
// It has no look of its own (owner's design): it is always a perfect copy of one of the players in the game — their
// suit, name patch, walk, footsteps and flashlight — and it walks with them like a teammate. No giveaways at all
// (difficulty only changes how long it waits, how often it strikes and how far it chases: GAR_LEVELS).
//
//   pretend  walks with someone (the "mark") at a teammate's distance, or stands at the edge of sight like a
//            teammate who got lost. Never in view of the player it copies (and it keeps out of the way of
//            anyone who could see both of them at once).
//   stalk    the wait is over: it picks someone (alone or with their back turned, if it can; not required) and
//            walks up to them like a teammate would…
//   chase    …then lunges, at Level 0's chasing speeds (BR_LEVELS), across floors by the ramps and stairs, into
//            side rooms (forcing shut doors in 1.5 s). It may strike in full view of the others.
//   take     the take-over (~3 s, SHIFTER.take): it grabs them, opens up and pulls them inside, closes and stands
//            up as them. Nothing can stop it. Then it pretends again (a shorter wait) and strikes again.
//   slip     it has to get out of sight (the one it copies saw it, or it gave up a chase) …
//   form     … and, where nobody can see it, it re-forms as somebody else.
// One real player alone (solo Practice): there is nobody to copy, so it is a made-up teammate (a plain hazmat
// suit with a made-up name, never a real player's: FAKE_NAMES) that walks with you and strikes the same way.
//
// Side rooms: it never goes into one unless it is going for someone (stalk / chase); then a shut door doesn't stop it.
//
// What the players' screens draw travels in its weapon field (p.w):
//   s:copy:<id>:<still|walk|hunt|force>   a copy of player <id> (or of a made-up teammate: '~Name')
//   s:take:<victim id>:<old id>           pulling someone inside (it was <old id> until now)
//   s:form:<new id>:<old id>              re-forming as someone else
import { PLAYER_RADIUS, PLAYER_HEIGHT, EYE } from './world.js';
import { BR, BR_LEVELS, brLevel } from './brmap.js';
import { GAR_LEVELS, floorOf, sideRoomAt } from './garmap.js';

export const SHIFTER = {
  walk: BR.walk,          // m/s: exactly a player's walk…
  run: BR.sprint,         // …and sprint
  search: 3.4,            // m/s looking round where it lost someone
  lunge: 1.12,            // × its chasing speed for the last few metres
  lungeAt: 4.5,           // m: walking up to its victim, it lunges from here
  reach: 1.15,            // m: it has you this close
  force: 1.5,             // s to force a shut door
  take: 3.0,              // s: the take-over, from the grab to walking away as them
  form: 1.2,              // s: re-forming as somebody else (only where nobody can see)
  near: [3.5, 9],         // m: a teammate's distance
  edge: [14, 24],         // m: "a teammate who got lost", at the edge of sight
  sight: 45,              // m: how far people can make it out
};
// made-up teammates for one player alone (plausible names; never one that a player in the game has)
export const FAKE_NAMES = ['Mara', 'Jonah', 'Tess', 'Ruben', 'Ilse', 'Owen', 'Nadia', 'Felix', 'Lena', 'Hugo', 'Petra', 'Simon'];
const RUN_SPEED = 3.5;
const angTo = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const rand = ([a, b]) => a + Math.random() * (b - a);

export class ShifterBrain {
  constructor(server, p) {
    this.s = server; this.p = p;
    const w = this.world = server.world;
    this.plan = w.def.gar;
    const level = brLevel(w.def.level);
    this.lv = BR_LEVELS[level].monster;
    this.gl = GAR_LEVELS[level];
    this.chaseSpeed = BR.sprint * this.lv.speed;
    const nav = this.nav = server.navGrid();
    // which side room (if any) and which door each walking spot is in; and the goods lift (never)
    this.roomOf = new Int8Array(nav.n).fill(-1);
    this.doorOf = new Int16Array(nav.n).fill(-1);
    this.liftOf = new Uint8Array(nav.n);
    const cellDoor = new Map(), L = this.plan.lift;
    w.doors.forEach((d, k) => { for (const c of d.cells) cellDoor.set(`${c}:${floorOf((d.y || 0) + 0.1)}`, k); });
    for (let i = 0; i < nav.n; i++) {
      this.roomOf[i] = sideRoomAt(this.plan, nav.x[i], nav.y[i], nav.z[i], 0.05);
      const k = cellDoor.get(`${Math.floor(nav.z[i] / 0.5) * w.w + Math.floor(nav.x[i] / 0.5)}:${floorOf(nav.y[i] + 0.1)}`);
      if (k != null) this.doorOf[i] = k;
      if (floorOf(nav.y[i]) === 1 && nav.x[i] > L.x0 - 0.3 && nav.x[i] < L.x1 + 0.3 && nav.z[i] > L.z0 - 0.3 && nav.z[i] < L.z1 + 0.3) this.liftOf[i] = 1;
    }
    // the cost of a route through spot i: side rooms are out of bounds unless it is going for someone (or it is in
    // that room and has to get out); a shut door costs the time to force it (a locked one, the shutter, is a wall)
    this.cost = (i) => {
      if (this.liftOf[i]) return Infinity;
      const room = this.roomOf[i];
      if (room >= 0 && !this.hunting() && room !== this.myRoom()) return Infinity;
      const d = this.doorOf[i] >= 0 && w.doors[this.doorOf[i]];
      if (d && !d.open) return d.lock || (!this.hunting() && this.myRoom() < 0) ? Infinity : SHIFTER.force * this.chaseSpeed;
      return 0;
    };
    this.vel = { x: 0, y: 0, z: 0 };
    this.onGround = true;
    this.state = 'start';
    this.ident = null;           // who it looks like: { id, name } ('~Name': a made-up teammate)
    this.takenId = null;         // the last one it pulled inside (it may keep their shape though they are dead)
    this.track = new Map();
    this.last = null; this.searchPts = [];
    this.thinkAt = 0; this.pauseUntil = 0; this.standUntil = 0;
    this.started = null;
    this.hunted = 0;             // metres run since the chase began
    this.bothT = 0;              // how long someone has been able to see it and the one it copies at once
    this.takes = 0;
  }

  hunting() { return this.state === 'stalk' || this.state === 'chase' || this.state === 'pursue'; }
  // shown for what it is (on the players' screens: its chase, a heartbeat, the screen shaking)
  revealed() { return this.state === 'chase' || this.state === 'pursue' || (this.state === 'search' && this.wasHunting) || !!this.forcing || this.state === 'take'; }
  myRoom() { return sideRoomAt(this.plan, this.p.x, this.p.y, this.p.z, 0.3); }
  humans() { return [...this.s.players.values()].filter(q => !q.bot && !q.dummy); }
  // players it could copy, follow or take: in the game, alive, still inside
  copyable() { return this.humans().filter(q => q.alive && !q.escaped && Number.isFinite(q.x)); }
  solo() { return this.humans().length <= 1; }
  // can player q make out the spot (x, y, z)? (anywhere round them: people look about)
  seenBy(q, x, y, z, range = SHIFTER.sight) {
    return Math.hypot(q.x - x, q.z - z) < range && Math.abs(q.y - y) < 3 && this.world.los(q.x, q.y + EYE, q.z, x, y + 1.2, z);
  }
  watched(x, y, z, except = null, range = SHIFTER.sight) { return this.copyable().some(q => q !== except && this.seenBy(q, x, y, z, range)); }
  // the real player it is copying, while they are alive and inside (else null)
  original() {
    if (!this.ident || this.ident.id[0] === '~') return null;
    const q = this.s.players.get(this.ident.id);
    return q && q.alive && !q.escaped ? q : null;
  }
  // may it go on looking like this? (never someone who left or got out; a made-up teammate only while one plays alone;
  // the dead only if it has just taken them)
  identOk() {
    const I = this.ident;
    if (!I) return false;
    if (I.id[0] === '~') return this.solo() || !this.copyable().length;
    const q = this.s.players.get(I.id);
    if (!q || q.escaped) return false;
    return q.alive || I.id === this.takenId;
  }

  // ---------- every tick ----------
  update(dt, now) {
    this.now = now;
    this.step(dt, now);
    const p = this.p, I = this.ident ? this.ident.id : '~';
    let mode;
    if (this.state === 'take') mode = `take:${this.take.id}:${this.take.old}`;
    else if (this.state === 'form') mode = `form:${I}:${this.formFrom}`;
    else mode = `copy:${I}:${this.forcing ? 'force' : this.revealed() ? 'hunt' : Math.hypot(this.vel.x, this.vel.z) > 0.4 ? 'walk' : 'still'}`;
    p.w = `s:${mode}`;
    p.use = this.revealed();
  }

  step(dt, now) {
    const p = this.p;
    if (this.started == null) { this.started = now; this.begin(now); }
    if (this.state === 'take') { this.takeStep(dt, now); return; }
    if (this.forcing) { this.forceStep(dt, now); return; }
    if (now >= this.thinkAt) { this.thinkAt = now + 0.12; this.think(now); }
    if (this.state === 'form') { this.move(null, 0, dt); if (now >= this.formUntil) this.formDone(now); return; }
    if (this.state === 'idle') { this.move(null, 0, dt); return; }
    if (now < this.pauseUntil) { this.move(null, 0, dt); return; }

    let speed = SHIFTER.walk, goal = this.goal;
    if (this.state === 'chase' && this.target) {
      const t = this.target, tr = this.track.get(t.id), d = Math.hypot(t.x - p.x, t.z - p.z);
      speed = d < 4 ? this.chaseSpeed * SHIFTER.lunge : this.chaseSpeed;
      goal = { x: t.x, y: t.y, z: t.z };
      if (tr && d > 3) {
        const lead = Math.min(0.8, d / 10), ax = t.x + tr.vx * lead, az = t.z + tr.vz * lead;
        if (this.nav.standable(ax, t.y, az)) goal = { x: ax, y: t.y, z: az };
      }
      if (d < 3 && Math.abs(t.y - p.y) < 0.9 && this.sees(t) && this.straight(p.x, p.z, t.x, t.z, p.y)) {
        const dir = [(t.x - p.x) / (d || 1), (t.z - p.z) / (d || 1)];
        if (this.doorAhead(now, dir)) { this.move(null, 0, dt); return; }
        this.move(dir, speed, dt); this.tryGrab(now); return;
      }
    } else if (this.state === 'stalk' && this.target) {
      // walking up to them like a teammate would (jogging if it is far), then the lunge
      const t = this.target, d = Math.hypot(t.x - p.x, t.z - p.z);
      goal = { x: t.x, y: t.y, z: t.z };
      speed = d + Math.abs(t.y - p.y) * 8 > 22 ? SHIFTER.run : SHIFTER.walk;
      if (d < SHIFTER.lungeAt && Math.abs(t.y - p.y) < 0.9 && this.sees(t)) { this.lunge(t, now); return; }
    } else if (this.state === 'pursue') speed = this.chaseSpeed;
    else if (this.state === 'search') speed = this.wasHunting ? SHIFTER.search : SHIFTER.walk;
    else if (this.state === 'slip') speed = this.wasHunting ? this.chaseSpeed * 0.9 : SHIFTER.walk;
    else if (this.state === 'pretend') { speed = this.pace || SHIFTER.walk; if (now < this.standUntil) goal = null; }
    const dir = goal ? this.navigate(goal, now) : null;
    if (this.doorAhead(now, dir)) { this.move(null, 0, dt); return; }
    if (!dir && goal) this.arrived(now);
    this.move(dir, speed, dt);
    if (this.state === 'chase' || this.state === 'pursue') this.tryGrab(now);
  }

  // the very start: it is somebody already, a long way from where everyone starts (nobody sees it begin)
  begin(now) {
    this.ident = this.chooseIdent();
    this.state = this.ident ? 'pretend' : 'idle';
    this.strikeAt = now + rand(this.gl.first);
    this.standUntil = now + 2;
  }

  // ---------- noises ----------
  // a door, the crank, a mistake at the crank, the fuse box: it notices whoever made it (and strikes sooner)
  hearNoise(x, z, range, y = this.p.y, loud = false) {
    const p = this.p, now = this.now || 0;
    if (Math.hypot(x - p.x, z - p.z) + Math.abs(y - p.y) * 2 > range) return;
    if (this.state === 'pretend') {
      const q = this.copyable().filter(c => !this.original() || c !== this.original()).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      if (q) { this.mark = q; this.markUntil = now + 25; this.goal = null; this.standUntil = 0; }
      this.strikeAt = Math.min(this.strikeAt, now + (loud ? 2 : 6) + Math.random() * 4);
    } else if (this.state === 'search' && sideRoomAt(this.plan, x, y, z) < 0) {
      this.goal = { x: x + (Math.random() - 0.5) * 2, y, z: z + (Math.random() - 0.5) * 2 }; this.path = null;
    }
  }

  // ---------- what it notices ----------
  think(now) {
    const p = this.p;
    for (const q of this.copyable()) {
      const tr = this.track.get(q.id);
      if (tr) {
        const dtt = Math.max(0.05, now - tr.t), vx = (q.x - tr.x) / dtt, vz = (q.z - tr.z) / dtt, sp = Math.hypot(vx, vz);
        if (sp < 12) { tr.vx = tr.vx * 0.5 + vx * 0.5; tr.vz = tr.vz * 0.5 + vz * 0.5; }
        tr.x = q.x; tr.z = q.z; tr.t = now; tr.sp = sp;
      } else this.track.set(q.id, { x: q.x, z: q.z, vx: 0, vz: 0, t: now, sp: 0 });
    }
    if (this.state === 'take' || this.state === 'form') return;
    if (this.state === 'idle') { if (this.copyable().length) this.begin(now); return; }
    // (someone it may not look like any more: the one it copies left or got out, or a second player joined)
    if ((this.state === 'pretend' || this.state === 'stalk') && !this.identOk()) { this.startSlip(now, true); return; }
    this.lightStep(now);
    // never in view of the one it copies: close, it goes for them; further, it gets out of their sight
    const O = this.original();
    if (O && (this.state === 'pretend' || this.state === 'stalk' || this.state === 'slip') && this.seenBy(O, p.x, p.y, p.z)) {
      const d = Math.hypot(O.x - p.x, O.z - p.z), t = this.target, close = Math.abs(O.y - p.y) < 1;
      if (this.state === 'stalk' && t === O) { if (d < 14 && close) { this.lunge(O, now); return; } }       // (it was coming for them anyway)
      else if (d < 6 && close) { this.lunge(O, now); return; }
      else if (this.state === 'stalk' && t && Math.hypot(t.x - p.x, t.z - p.z) < 10) { this.lunge(t, now); return; }
      else if (this.state !== 'slip') { this.startSlip(now, false); return; }
    }
    if (this.state === 'pretend') this.pretendThink(now);
    else if (this.state === 'stalk') this.stalkThink(now);
    else if (this.state === 'slip') this.slipThink(now);
    else this.huntThink(now);
  }

  // its flashlight: the copied player's (it does what they do); a made-up teammate's follows yours, a moment later
  lightStep(now) {
    const p = this.p, O = this.original();
    if (O) { p.light = !!O.light; return; }
    if (this.ident && this.ident.id[0] === '~' && this.mark) {
      if (!!this.mark.light !== !!p.light) { if (!this.lightAt) this.lightAt = now + 1.2 + Math.random() * 2.2; else if (now >= this.lightAt) { p.light = !!this.mark.light; this.lightAt = 0; } }
      else this.lightAt = 0;
    }
  }

  // ---------- pretending: a teammate ----------
  pretendThink(now) {
    const p = this.p, O = this.original();
    if (now >= this.strikeAt) { const v = this.pickVictim(); if (v) { this.startStalk(v, now); return; } this.strikeAt = now + 5; }
    // the one it walks with (never the one it copies)
    const M = this.mark;
    if (!M || !M.alive || M.escaped || M === O || now > this.markUntil || !this.s.players.has(M.id)) this.pickMark(now);
    if (!this.mark) {
      // nobody but the one it copies: it keeps out of their sight, a little way behind them (and strikes from there)
      if (!this.goal && O && now >= this.standUntil) { const i = this.spotNear(O, 12, 22, (x, y, z) => !this.seenBy(O, x, y, z)); if (i >= 0) this.setGoal(i); else this.standUntil = now + 2; }
      return;
    }
    // someone who can see it AND the real one at the same time: it moves off
    if (O) {
      const both = this.copyable().some(q => q !== O && this.seenBy(q, p.x, p.y, p.z, 35) && this.seenBy(q, O.x, O.y, O.z, 35));
      this.bothT = both ? this.bothT + 0.12 : 0;
      if (this.bothT > 1.5) { this.bothT = 0; this.startSlip(now, false); return; }
    }
    const m = this.mark, d = Math.hypot(m.x - p.x, m.z - p.z) + Math.abs(m.y - p.y) * 6;
    // keep up: jog when they get away
    this.pace = d > 20 ? SHIFTER.run : SHIFTER.walk;
    const want = this.lost ? SHIFTER.edge : SHIFTER.near;
    const drift = this.goalFor ? Math.hypot(m.x - this.goalFor.x, m.z - this.goalFor.z) + Math.abs(m.y - this.goalFor.y) * 6 : 99;
    if ((!this.goal && now >= this.standUntil) || (this.goal && drift > 6) || (!this.goal && (d > want[1] + 4 || d < 2.2))) this.teammateSpot(now);
    else if (!this.goal) this.faceMark(m);
  }

  // where a teammate would be: near them (and where they can see it), or now and then at the edge of sight
  teammateSpot(now) {
    const m = this.mark, O = this.original();
    this.lost = Math.random() < 0.22;
    const room = sideRoomAt(this.plan, m.x, m.y, m.z);
    // they went into a side room: it waits outside, by the door, like someone keeping watch
    const c = room >= 0 ? this.doorOutside(room) : m;
    const [r0, r1] = room >= 0 ? [1.5, 5] : this.lost ? SHIFTER.edge : SHIFTER.near;
    const fine = (x, y, z, strict) => (!O || !this.seenBy(O, x, y, z)) && (!strict || room >= 0 || this.world.los(m.x, m.y + EYE, m.z, x, y + 1.2, z))
      && (!O || !this.copyable().some(q => q !== O && this.seenBy(q, x, y, z, 35) && this.seenBy(q, O.x, O.y, O.z, 35)));
    let i = this.spotNear(c, r0, r1, (x, y, z) => fine(x, y, z, true));
    if (i < 0) i = this.spotNear(c, r0, r1 + 6, (x, y, z) => fine(x, y, z, false));
    if (i < 0) { this.standUntil = now + 1.5; return; }
    this.setGoal(i);
    this.goalFor = { x: m.x, y: m.y, z: m.z };
  }

  // the way into side room k, from outside (a little in front of its door)
  doorOutside(k) {
    const d = this.world.doors.find(dd => dd.room === k);
    const r = this.plan.rooms[k];
    if (!d) return { x: (r.x0 + r.x1) / 2, y: r.floor ? this.plan.start.y : 0, z: (r.z0 + r.z1) / 2 };
    const s = Math.sign((d.cx - (r.x0 + r.x1) / 2) * d.nx + (d.cz - (r.z0 + r.z1) / 2) * d.nz) || 1;
    return { x: d.cx + d.nx * s * 1.2, y: d.y || 0, z: d.cz + d.nz * s * 1.2 };
  }

  faceMark(m) {
    const p = this.p, now = this.now || 0;
    if (now > (this.glanceAt || 0)) { this.glanceAt = now + 1.5 + Math.random() * 4; this.glance = Math.random() < 0.4 ? (Math.random() - 0.5) * 2.4 : 0; this.lookPitch = (Math.random() - 0.6) * 0.25; }
    const want = Math.atan2(-(m.x - p.x), -(m.z - p.z)) + (this.glance || 0);
    p.yaw += angTo(p.yaw, want) * 0.18;
    p.pitch += ((this.lookPitch || 0) - p.pitch) * 0.2;
  }

  pickMark(now) {
    const O = this.original(), p = this.p;
    const c = this.copyable().filter(q => q !== O);
    if (!c.length) { this.mark = null; return; }
    // someone on their own first (the others are together), then whoever is nearest
    const alone = q => !this.copyable().some(o => o !== q && Math.hypot(o.x - q.x, o.z - q.z) < 12 && Math.abs(o.y - q.y) < 1.5);
    c.sort((a, b) => (alone(b) - alone(a)) * 30 + (Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)) * (0.5 + Math.random()));
    this.mark = c[0];
    this.markUntil = now + 20 + Math.random() * 25;
    this.goal = null; this.goalFor = null;
  }

  // ---------- striking ----------
  // whom to go for: alone, back turned, close, in a side room — preferred, never required
  pickVictim() {
    const p = this.p, all = this.copyable();
    let best = null, bs = -Infinity;
    for (const q of all) {
      if (this.liftOfAt(q)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 8;
      const alone = !all.some(o => o !== q && Math.hypot(o.x - q.x, o.z - q.z) < 12 && Math.abs(o.y - q.y) < 1.5);
      const back = Math.abs(angTo(q.yaw, Math.atan2(-(p.x - q.x), -(p.z - q.z)))) > 1.9;
      const s = (1 + (alone ? 2 : 0) + (back ? 1.5 : 0) + 2 * (1 - Math.min(d, 60) / 60) + (sideRoomAt(this.plan, q.x, q.y, q.z) >= 0 ? 0.5 : 0)) * (0.7 + Math.random() * 0.6);
      if (s > bs) { bs = s; best = q; }
    }
    return best;
  }

  startStalk(q, now) {
    this.state = 'stalk'; this.target = q; this.stalkSince = now; this.path = null; this.goal = null; this.wasHunting = false;
  }

  stalkThink(now) {
    const t = this.target;
    if (!t || !t.alive || t.escaped || !this.s.players.has(t.id)) { this.backToPretend(now, [3, 8]); return; }
    if (now - this.stalkSince > 60) { this.backToPretend(now, this.gl.again.map(v => v / 2)); return; }
  }

  // it shows itself: a sprint at them
  lunge(q, now) {
    this.state = 'chase'; this.target = q; this.lostAt = now; this.path = null; this.wasHunting = true; this.hunted = 0;
    const tr = this.track.get(q.id) || { vx: 0, vz: 0 };
    this.last = { x: q.x, y: q.y, z: q.z, vx: tr.vx, vz: tr.vz, t: now, id: q.id };
  }

  huntThink(now) {
    const p = this.p;
    let seen = null, seenD = Infinity, heard = null, heardD = Infinity;
    for (const q of this.copyable()) {
      const d = Math.hypot(q.x - p.x, q.z - p.z), tr = this.track.get(q.id), sp = tr ? tr.sp : 0;
      if (d < seenD && this.sees(q)) { seen = q; seenD = d; }
      const wet = q.y < 0.3 && this.world.waterAt(q.x, q.z) > 0 && sp > 0.8, dd = d + Math.abs(q.y - p.y) * 2.5;
      if ((((sp > RUN_SPEED && sp < 12) || wet) && dd < this.lv.hear) || (sp > 0.4 && dd < this.lv.hearWalk) || dd < 2) { if (dd < heardD) { heard = q; heardD = dd; } }
    }
    const clue = (q) => { const tr = this.track.get(q.id) || { vx: 0, vz: 0 }; this.last = { x: q.x, y: q.y, z: q.z, vx: tr.vx, vz: tr.vz, t: now, id: q.id }; };
    // it never chases further than its difficulty allows
    if (this.hunted > this.gl.chase) { this.giveUp(now); return; }
    if (seen) { clue(seen); this.state = 'chase'; this.target = seen; this.lostAt = now; }
    else if (this.state === 'chase') {
      if (!this.last) { this.giveUp(now); return; }
      if (now - this.lostAt > this.lv.lose) {
        // lost sight: run on to where they were heading
        const L = this.last, lead = this.lv.lead;
        let gx = L.x + L.vx * lead, gz = L.z + L.vz * lead;
        const i = this.nav.nearest(gx, L.y, gz);
        if (i >= 0) { gx = this.nav.x[i]; gz = this.nav.z[i]; }
        this.state = 'pursue'; this.goal = { x: gx, y: L.y, z: gz }; this.target = null; this.path = null;
      }
    } else if (heard && this.state === 'search' && sideRoomAt(this.plan, heard.x, heard.y, heard.z) < 0) {
      clue(heard);
      if (!this.goal || Math.hypot(heard.x - this.goal.x, heard.z - this.goal.z) > 3) { this.goal = { x: heard.x, y: heard.y, z: heard.z }; this.path = null; }
    }
    if (this.state === 'chase' && this.target && (!this.target.alive || this.target.escaped)) { this.giveUp(now); return; }
    if (this.state === 'search' && (now > this.searchUntil || (!this.goal && !this.searchPts.length))) this.giveUp(now);
  }

  // it gave up (lost them, or chased far enough): out of sight, it becomes somebody else, and pretends again
  giveUp(now) {
    this.target = null; this.goal = null; this.path = null;
    this.strikeAt = now + rand(this.gl.again);
    this.startSlip(now, true);
  }

  backToPretend(now, wait) {
    this.state = 'pretend'; this.target = null; this.goal = null; this.path = null; this.wasHunting = false;
    this.strikeAt = now + rand(wait); this.standUntil = now + 1;
    if (!this.mark) this.pickMark(now);
  }

  // ---------- getting out of sight, and re-forming as someone else ----------
  startSlip(now, reform) {
    this.reform = !!reform || (this.state === 'slip' && !!this.reform);
    this.state = 'slip'; this.slipSince = now;
    this.target = null; this.goal = null; this.path = null; this.unseenSince = null;
    this.pickHide(now);
  }

  pickHide(now) {
    const p = this.p;
    const i = this.spotNear(p, 6, 24, (x, y, z) => !this.watched(x, y, z), 60);
    if (i >= 0) this.setGoal(i); else { this.goal = null; this.standUntil = now + 1; }
  }

  slipThink(now) {
    const p = this.p, seen = this.watched(p.x, p.y, p.z);
    if (seen) { this.unseenSince = null; if (!this.goal || now - this.slipSince > 12) { this.slipSince = now; this.pickHide(now); } return; }
    if (this.unseenSince == null) this.unseenSince = now;
    if (now - this.unseenSince < 0.6) return;
    // out of everyone's sight
    const want = this.reform || !this.identOk() ? this.chooseIdent(true) : this.ident;
    if (want && (!this.ident || want.id !== this.ident.id)) { this.startForm(now, want); return; }
    if (!want) { this.state = 'idle'; return; }
    this.backToPretend(now, [Math.max(0, this.strikeAt - now), Math.max(0, this.strikeAt - now) + 0.1]);
    this.reform = false;
  }

  startForm(now, ident) {
    this.formFrom = this.ident ? this.ident.id : '~';
    this.ident = ident;
    this.state = 'form'; this.formUntil = now + SHIFTER.form;
    this.goal = null; this.path = null; this.vel.x = this.vel.z = 0;
    const O = this.original(); if (O) this.p.light = !!O.light;
  }

  formDone(now) {
    this.reform = false; this.wasHunting = false;
    this.state = 'pretend'; this.goal = null; this.standUntil = now + 1.5;
    if (!(this.strikeAt > now)) this.strikeAt = now + rand(this.gl.again);
    this.pickMark(now);
  }

  // whom to look like: one real player alone → a made-up teammate; otherwise a player who isn't watching it right
  // now, preferably one far away from it (so the copy and the real one are not seen together)
  chooseIdent(change = false) {
    if (this.solo() || !this.copyable().length) return this.fake();
    const p = this.p, cur = this.ident && this.ident.id;
    const c = this.copyable().filter(q => !this.seenBy(q, p.x, p.y, p.z) && (!change || q.id !== cur || this.copyable().length === 1));
    const list = c.length ? c : this.copyable();
    list.sort((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) + Math.abs(b.y - p.y) * 6) * (0.6 + Math.random() * 0.8) - (Math.hypot(a.x - p.x, a.z - p.z) + Math.abs(a.y - p.y) * 6) * (0.6 + Math.random() * 0.8));
    const q = list[0];
    return { id: q.id, name: q.name };
  }

  fake() {
    if (!this.fakeName) {
      const used = new Set(this.humans().map(q => String(q.name || '').trim().toLowerCase()));
      const free = FAKE_NAMES.filter(n => !used.has(n.toLowerCase()));
      this.fakeName = free[Math.floor(Math.random() * free.length)] || 'Mara';
    }
    return { id: `~${this.fakeName}`, name: this.fakeName, fake: true };
  }

  // ---------- the take-over ----------
  tryGrab(now) {
    const p = this.p;
    for (const q of this.copyable()) {
      if (this.state === 'stalk' && q !== this.target) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) < SHIFTER.reach && Math.abs(q.y - p.y) < 1.2 && this.world.los(p.x, p.y + 1.2, p.z, q.x, q.y + 1.2, q.z)) {
        p.yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z));
        this.s.monsterKill(p, q);
        return;
      }
    }
  }

  // the host has taken q (lost a life, screen black): it pulls them inside, then stands up as them (~3 s)
  startCatch(q) {
    const now = this.now || 0;
    this.take = { id: q.id, name: q.name, old: this.ident ? this.ident.id : '~', until: now + SHIFTER.take, t0: now, x: q.x, y: q.y, z: q.z, light: !!q.light };
    this.state = 'take'; this.target = null; this.goal = null; this.path = null; this.forcing = null;
    this.vel.x = this.vel.z = 0;
    this.p.light = false;
    this.takes++;
  }

  takeStep(dt, now) {
    const p = this.p, k = this.take, T = now - k.t0;
    p.yaw += angTo(p.yaw, Math.atan2(-(k.x - p.x), -(k.z - p.z))) * Math.min(1, dt * 8);
    // closing up, it steps into where they stood
    const d = Math.hypot(k.x - p.x, k.z - p.z);
    if (T > 2.0 && d > 0.08) this.move([(k.x - p.x) / d, (k.z - p.z) / d], Math.min(1.6, d / dt), dt);
    else this.move(null, 0, dt);
    if (now < k.until) return;
    this.ident = { id: k.id, name: k.name };
    this.takenId = k.id;
    p.light = k.light;
    this.take = null;
    this.wasHunting = false;
    this.state = 'pretend'; this.goal = null; this.path = null; this.mark = null;
    this.strikeAt = now + rand(this.gl.again); this.standUntil = now + 1.2;
    // one player alone: there is nobody to copy but them, so straight back into the made-up teammate
    if (this.solo()) this.startForm(now, this.fake());
    else this.pickMark(now);
  }

  // ---------- getting about ----------
  arrived(now) {
    if (this.state === 'pretend') { this.goal = null; this.standUntil = now + (this.lost ? 4 + Math.random() * 6 : 2 + Math.random() * 5); }
    else if (this.state === 'pursue') this.startSearch(now);
    else if (this.state === 'search') {
      this.pauseUntil = now + 0.6 + Math.random() * 0.9;
      this.goal = this.searchPts.shift() || null;
    } else if (this.state === 'slip') { this.goal = null; }
    else this.goal = null;
  }

  // look round the last clue, the way they were going first (never in a side room)
  startSearch(now) {
    const L = this.last, nav = this.nav;
    this.state = 'search'; this.searchPts = []; this.path = null;
    if (!L) { this.giveUp(now); return; }
    const sp = Math.hypot(L.vx, L.vz), fx = sp > 0.5 ? L.vx / sp : 0, fz = sp > 0.5 ? L.vz / sp : 0, pts = [];
    for (let k = 0; k < 40 && pts.length < 12; k++) {
      const i = this.spotNear(L, 2.5, 12, null, 3);
      if (i < 0) continue;
      const x = nav.x[i], z = nav.z[i], d = Math.hypot(x - L.x, z - L.z);
      pts.push({ x, y: nav.y[i], z, score: ((x - L.x) * fx + (z - L.z) * fz) / (d || 1) * 2 + Math.random() });
    }
    pts.sort((a, b) => b.score - a.score);
    this.searchPts = pts.slice(0, this.lv.search);
    this.searchUntil = now + 22;
    this.goal = this.searchPts.shift() || null;
    if (!this.goal) this.giveUp(now);
  }

  // a walking spot r0…r1 from c on c's floor (not in a side room, not in the lift) that passes ok(x, y, z, i), or -1
  spotNear(c, r0, r1, ok = null, tries = 40) {
    const nav = this.nav;
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const i = nav.nearest(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
      if (i < 0 || !nav.reach[i] || this.roomOf[i] >= 0 || this.liftOf[i] || Math.abs(nav.y[i] - c.y) > 0.5) continue;
      const d = Math.hypot(nav.x[i] - c.x, nav.z[i] - c.z);
      if (d < r0 * 0.8 || d > r1 * 1.1) continue;
      if (ok && !ok(nav.x[i], nav.y[i], nav.z[i], i)) continue;
      return i;
    }
    return -1;
  }
  setGoal(i) { this.goal = { x: this.nav.x[i], y: this.nav.y[i], z: this.nav.z[i] }; this.path = null; }
  liftOfAt(q) { const i = this.nav.nearest(q.x, q.y, q.z); return i >= 0 && this.liftOf[i] === 1; }

  sees(q) {
    const p = this.p, d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d > (this.state === 'chase' && this.target === q ? this.lv.chaseSight : this.lv.sight)) return false;
    // (through side-room windows too: the line of sight is traced through the real walls)
    return this.world.los(p.x, p.y + 1.6, p.z, q.x, q.y + EYE - 0.2, q.z) || this.world.los(p.x, p.y + 1.0, p.z, q.x, q.y + 0.9, q.z);
  }

  // a shut door right in front of it. Only when it is going for someone (or has to get back out of a room): it forces it.
  doorAhead(now, dir) {
    const p = this.p, w = this.world;
    if (!dir || (!this.hunting() && this.myRoom() < 0)) return false;
    for (let i = 0; i < w.doors.length; i++) {
      const d = w.doors[i];
      if (d.open || d.lock || Math.abs((d.y || 0) - p.y) > 1) continue;
      const dx = d.cx - p.x, dz = d.cz - p.z, dist = Math.hypot(dx, dz);
      if (dist > 1.2 || (dx * dir[0] + dz * dir[1]) / (dist || 1) < 0.3) continue;
      this.forcing = { i, until: now + SHIFTER.force, next: now + 0.2 };
      this.vel.x = this.vel.z = 0;
      return true;
    }
    return false;
  }

  forceStep(dt, now) {
    const p = this.p, k = this.forcing, d = this.world.doors[k.i];
    if (!d || d.open) { this.forcing = null; this.path = null; return; }
    p.yaw += angTo(p.yaw, Math.atan2(-(d.cx - p.x), -(d.cz - p.z))) * Math.min(1, dt * 8);
    this.move(null, 0, dt);
    if (now >= k.next) { k.next = now + 0.5; this.s.broadcast({ t: 'doorKick', i: k.i, swing: -(Math.sign((p.x - d.cx) * d.nx + (p.z - d.cz) * d.nz) || 1) }); }
    if (now >= k.until) {
      this.forcing = null; this.path = null; this.s.forceDoor(k.i, p);
      if (this.state === 'stalk' && this.target) this.lunge(this.target, now);       // (the door is down: no more pretending)
    }
  }

  move(dir, speed, dt) {
    const p = this.p, v = this.vel;
    const tx = dir ? dir[0] * speed : 0, tz = dir ? dir[1] * speed : 0, k = Math.min(1, dt * (dir ? 6 : 10));
    v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    const ox = p.x, oz = p.z;
    this.onGround = this.world.move(p, v, dt, PLAYER_RADIUS, this.onGround, PLAYER_HEIGHT);
    const moved = Math.hypot(p.x - ox, p.z - oz);
    if (moved > 0.002) { p.yaw += angTo(p.yaw, Math.atan2(-(p.x - ox), -(p.z - oz))) * Math.min(1, dt * 8); p.pitch *= 0.9; }
    else if (this.target) p.yaw += angTo(p.yaw, Math.atan2(-(this.target.x - p.x), -(this.target.z - p.z))) * Math.min(1, dt * 6);
    p.moved = (p.moved || 0) + moved;
    if (this.state === 'chase' || this.state === 'pursue' || (this.state === 'search' && this.wasHunting)) this.hunted += moved;
    if (dir) {
      this.stuckT = moved < speed * dt * 0.2 ? (this.stuckT || 0) + dt : 0;
      if (this.stuckT > 0.7) { this.stuckT = 0; this.path = null; if (this.state === 'pretend' || this.state === 'slip') this.goal = null; }
    }
  }

  // follow the walking grid (both floors, by the ramps and stairs) to the goal; a direction, or null when there
  navigate(goal, now) {
    const p = this.p, nav = this.nav;
    if (Math.hypot(goal.x - p.x, goal.z - p.z) < 0.6 && Math.abs((goal.y || 0) - p.y) < 1) return null;
    const key = `${Math.round(goal.x)},${Math.round(goal.y || 0)},${Math.round(goal.z)}`;
    if (!this.path || key !== this.pathKey || now > this.repathAt) {
      this.pathKey = key;
      this.path = nav.path(nav.nearest(p.x, p.y, p.z), nav.nearest(goal.x, goal.y || 0, goal.z), Math.round(nav.n * 1.2), this.cost);
      this.pathIdx = 0;
      this.repathAt = now + (this.state === 'chase' || this.state === 'stalk' ? 0.5 : this.state === 'pursue' ? 1 : 4);
      if (!this.path) {
        // no way there (a side room it may not go into, the lift): give that up
        this.goal = null;
        if (this.state === 'stalk') this.backToPretend(now, [4, 9]);
        else if (this.state === 'chase' || this.state === 'pursue') this.giveUp(now);
        else if (this.state === 'pretend') this.standUntil = now + 2;
        return null;
      }
    }
    const path = this.path;
    while (this.pathIdx < path.length - 1 && Math.hypot(nav.x[path[this.pathIdx]] - p.x, nav.z[path[this.pathIdx]] - p.z) < 0.5) this.pathIdx++;
    for (let k = Math.min(path.length - 1, this.pathIdx + 6); k > this.pathIdx; k--) {
      const j = path[k];
      if (Math.abs(nav.y[j] - p.y) < 0.2 && this.straight(p.x, p.z, nav.x[j], nav.z[j], p.y)) { this.pathIdx = k; break; }
    }
    const i = path[this.pathIdx];
    let dx = nav.x[i] - p.x, dz = nav.z[i] - p.z;
    if (this.pathIdx === path.length - 1) { dx = goal.x - p.x; dz = goal.z - p.z; }
    const d = Math.hypot(dx, dz);
    return d > 0.01 ? [dx / d, dz / d] : null;
  }

  // a straight walk on the level from a to b? (nothing in the way, no door, and no side room it may not enter)
  straight(ax, az, bx, bz, y) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.25), w = this.world, hunting = this.hunting();
    for (let i = 1; i <= n; i++) {
      const k = i / n, x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      if (!this.nav.standable(x, y, z)) return false;
      if (!hunting && sideRoomAt(this.plan, x, y, z, 0.05) >= 0 && this.myRoom() < 0) return false;
      if (w.cellSpans(Math.floor(x / 0.5), Math.floor(z / 0.5)).some(sp => sp.m === '_door' && sp.y0 < y + 1 && sp.y1 > y)) return false;
    }
    return true;
  }
}
