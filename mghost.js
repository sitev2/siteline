// The Minigames on the host: everything that has to be the same for everyone. Runs in the host's browser and on the
// home server (server.js makes one in startMinigames()). No three.js in here. Clients only send their inputs
// (E: { t: 'ring' } picks a floatie up, or catches one thrown at you; fire: { t: 'throw', yaw, pitch }); hits,
// catches, passes, steals, goals and points are all decided here, with the floaties' physics (poolhost.js ringStep).
//
// A match is a party run (5 rounds, each a random game, never the same one twice in a row) or one game played for
// 1–5 rounds. Each round: a 3 s countdown in the area the game uses ('intro'), the game ('play'), who won ('end',
// 2.5 s), the standings ('board', 5 s). Points per round: 1st 3, 2nd 2, 3rd 1 (a shared place shares them; in team
// games everyone on the winning team is 1st). Most points after the last round wins.
//   dodge     Floatie Dodgeball: a thrown floatie that hits you before it touches anything puts you out; one that has
//             bounced, or lies on the floor, is safe. Press E just as one reaches you to catch it: the thrower is out.
//             Free-for-all, or two teams (each on its own half) with 4 or 6 players when the host turns it on.
//   poolball  Pool Ball: two teams in the pool, one floatie; push it (swim into it) or throw it into the other team's
//             goal. First to 3 goals, or the most after 3 minutes. Uneven teams: in Practice a bot evens them; online
//             the goal the smaller team shoots at is a metre wider.
//   keepaway  Keep Away: whoever holds the floatie scores a point every second. Touch the holder to steal it (they
//             can't take it back for 2 s). The holder is a little slower and can throw it away. 2 minutes.
//   potato    Hot Potato: a ticking floatie starts with someone; touch someone to pass it (1 s before it can be passed
//             on again). After 20 s it pops: whoever holds it is out, and a new fuse starts with someone else.
import { PoolHost, RING_G } from './poolhost.js';
import { POOL } from './poolmap.js';
import { ARENA, MG_GAMES, MG_ORDER, MG_ROUNDS, MG_POINTS, mgSpawns, inArea, setGoalPosts, goalMouth } from './mgmap.js';

const { G, WY } = POOL;
const r2 = v => Math.round(v * 100) / 100;
const MODES = ['float', 'fly', 'rest', 'held', 'lost'];
export const MG = {
  intro: 3, end: 2.5, board: 5,
  throwSpeed: 12.5, throwUp: 1.4,
  reach: 1.9,             // E picks a floatie up this close (as in the Poolrooms)
  touch: 1.05,            // two players this close (their middles) touch
  hitR: 0.58,             // a live floatie this close to someone's middle line hits them
  catchBefore: 0.45,      // a catch press up to this long before the hit counts…
  catchAfter: 0.25,       // …and up to this long after it (the press was still on its way)
  passGuard: 1,           // Hot Potato: seconds before the new holder can pass it on
  stealGuard: 2,          // Keep Away: seconds before whoever lost it can take it back
  goalPause: 2.5,         // Pool Ball: the celebration after a goal
  outBack: 1.2,           // a floatie out of play goes back in after this long
  fuse: MG_GAMES.potato.fuse,
  speed: { run: 5, swim: 2.8, keep: 0.85, potato: 1.12 },      // m/s; the Keep Away holder is slower, the Hot Potato holder faster
};
const READY_WAIT = 15;       // seconds the first round waits at most for everyone's game to load
const BOT_LEVEL = {
  easy: { aim: 1.7, err: 0.16, react: 0.8, catch: 0.1, speed: 0.8 },
  normal: { aim: 1.15, err: 0.1, react: 0.5, catch: 0.25, speed: 0.9 },
  hard: { aim: 0.7, err: 0.06, react: 0.32, catch: 0.42, speed: 1 },
};

// competition ranking: groups of ids, best first; everyone in a group shares that place
export function placesOf(groups) {
  const out = new Map();
  let place = 1;
  for (const g of groups) { if (!g.length) continue; for (const id of g) out.set(id, place); place += g.length; }
  return out;
}
export const pointsFor = (place) => MG_POINTS[place - 1] || 0;

export class MiniHost {
  // cfg: { run: 'party' | 'single', game, rounds, teams }
  constructor(S, cfg) {
    this.S = S; this.world = S.world; this.plan = S.world.def.pool;
    this.cfg = { run: cfg.run === 'single' ? 'single' : 'party', game: MG_GAMES[cfg.game] ? cfg.game : 'dodge', rounds: Math.max(1, Math.min(5, cfg.rounds | 0 || 3)), teams: !!cfg.teams };
    this.rounds = this.cfg.run === 'single' ? this.cfg.rounds : MG_ROUNDS;
    this.at = performance.now(); this.t = 0; this.sentAt = 0; this.fastAt = 0;
    this.round = 0; this.game = null; this.last = null;
    this.stage = 'wait'; this.until = 0; this.endAt = 0;
    this.table = new Map();          // standings: id → { id, name, pts, bot }
    this.rings = this.plan.floaties.map((f, i) => ({ i, x: f.x, y: G, z: f.z, vx: 0, vy: 0, vz: 0, mode: 'lost', holder: null, hitAt: 0, live: false, by: null, outAt: 0 }));
    this.pending = [];               // Dodgeball hits waiting a moment for a late catch press
    this.big = [false, false];       // Pool Ball: a goal made wider (uneven teams)
    this.results = null; this.text = '';
    this.score = { atk: 0, def: 0 }; this.held = new Map(); this.hot = null; this.guard = null; this.outOrder = [];
  }

  fx(m) { this.S.broadcast({ t: 'mgfx', ...m }); }

  // everyone in the room who plays (bots too); a friend who joined during a round watches until the next one
  players() { return [...this.S.players.values()].filter(p => !p.dummy && !p.mgLate); }
  alive() { return this.players().filter(p => p.alive); }
  entry(p) {
    let e = this.table.get(p.id);
    if (!e) {
      // (someone who left and came back under the same name keeps their points)
      const old = [...this.table.values()].find(o => !o.bot && !p.bot && o.name.toLowerCase() === p.name.toLowerCase() && !this.S.players.has(o.id));
      if (old) { this.table.delete(old.id); old.id = p.id; e = old; } else e = { id: p.id, name: p.name, pts: 0, bot: !!p.bot };
      this.table.set(p.id, e);
    }
    return e;
  }
  standings() { return [...this.table.values()].filter(e => !e.sub).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name)); }

  // ---------- rounds ----------
  pickGame() {
    if (this.cfg.run === 'single') return this.cfg.game;
    const n = this.players().length, list = MG_ORDER.filter(g => g !== this.last && MG_GAMES[g].min <= n);
    return list[Math.floor(Math.random() * list.length)] || MG_ORDER[0];
  }

  startRound() {
    const S = this.S, now = performance.now();
    this.round++;
    S.round++;                       // (players' states from the round before are ignored)
    if (S.removeMiniSubs) S.removeMiniSubs();
    // (a practice room that friends filled up: bots make room, from the next round)
    while (S.botCfg && this.S.players.size > 6 && S.bots.size) { const id = [...S.bots.keys()].pop(); S.bots.delete(id); S.players.delete(id); this.table.delete(id); }
    for (const p of S.players.values()) p.mgLate = false;
    const game = this.game = this.pickGame();
    this.last = game;
    const def = MG_GAMES[game], list = this.players();
    // teams: Pool Ball always; Dodgeball when the host chose teams and there are 4 or 6 players
    this.teams = game === 'poolball' || (game === 'dodge' && this.cfg.teams && (list.length === 4 || list.length === 6));
    this.big = [false, false];
    if (this.teams) {
      // humans spread over both teams first, then the bots
      const order = [...list].sort((a, b) => (a.bot ? 1 : 0) - (b.bot ? 1 : 0) || Math.random() - 0.5);
      const first = Math.random() < 0.5 ? 'atk' : 'def', other = first === 'atk' ? 'def' : 'atk';
      order.forEach((p, i) => { p.team = i % 2 ? other : first; });
      // Pool Ball with an odd number: Practice gets a bot to even it out; online the smaller team's target is wider
      if (game === 'poolball' && order.length % 2) {
        const small = order.filter(p => p.team === 'atk').length < order.filter(p => p.team === 'def').length ? 'atk' : 'def';
        if (S.botCfg && S.addMiniBot) { const b = S.addMiniBot(true); b.team = small; this.entry(b).sub = true; }
        else this.big[ARENA.goals.findIndex(g => g.side !== small)] = true;
      }
    } else for (const p of list) p.team = 'ffa';
    this.big.forEach((b, i) => setGoalPosts(this.world, i, b));
    // the floaties
    this.pending = []; this.outOrder = []; this.score = { atk: 0, def: 0 }; this.held = new Map(); this.hot = null; this.guard = null;
    this.results = null; this.text = ''; this.pause = 0;
    for (const r of this.rings) Object.assign(r, { mode: 'lost', holder: null, live: false, by: null, vx: 0, vy: 0, vz: 0, outAt: 0 });
    const C = ARENA.court;
    if (game === 'dodge') {
      const n = Math.max(2, Math.min(this.rings.length, this.players().length));
      for (let k = 0; k < n; k++) this.placeRing(this.rings[k], C.mid, C.z0 + 2 + (C.z1 - C.z0 - 4) * (n === 1 ? 0.5 : k / (n - 1)));
    } else if (game === 'keepaway') this.placeRing(this.rings[0], C.cx, C.cz);
    else if (game === 'poolball') this.ballToMiddle(false);
    // everyone to their spot
    const all = this.players(), spots = mgSpawns(def.area, this.teams), used = new Set();
    for (const p of all) {
      const side = this.teams ? p.team : 'ffa';
      let s = spots.find((q, k) => q.side === side && !used.has(k));
      if (!s) s = spots.find((q, k) => !used.has(k)) || spots[0];
      used.add(spots.indexOf(s));
      this.entry(p);
      Object.assign(p, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, alive: true, mgOut: false, hp: 100, w: 'none', use: false, catchAt: -1e9, mvx: 0, mvz: 0, mgLx: s.x, mgLz: s.z });
      S.send(p.id, { t: 'spawn', x: r2(s.x), y: r2(s.y), z: r2(s.z), yaw: r2(s.yaw), rd: S.round });
      const brain = S.bots.get(p.id); if (brain && brain.reset) brain.reset();
    }
    if (game === 'potato') this.newFuse(null, 0);
    this.endAt = 0;
    // the first round waits until everyone's game has loaded (the hall's light is worked out on each computer, which
    // takes a few seconds, and in Practice until you click Play), at most READY_WAIT seconds; then the 3-2-1
    if (this.round === 1 && !this.allReady()) { this.stage = 'wait'; this.until = now + READY_WAIT * 1000; }
    else { this.stage = 'intro'; this.until = now + MG.intro * 1000; }
    S.broadcastRoster();
    this.send(true);
  }
  allReady() { return this.S.humans().every(p => p.mgReady); }
  ready(p) {
    p.mgReady = true;
    if (this.stage === 'wait' && this.allReady()) { this.stage = 'intro'; this.until = performance.now() + MG.intro * 1000; this.send(true); }
  }

  placeRing(r, x, z) { Object.assign(r, { x, y: G, z, vx: 0, vy: 0, vz: 0, mode: 'rest', holder: null, live: false, by: null, outAt: 0 }); }
  ballToMiddle(pause = true) {
    const r = this.rings[0], P = ARENA.pool;
    Object.assign(r, { x: P.cx, y: WY, z: P.cz, vx: 0, vy: 0, vz: 0, mode: 'float', holder: null, live: false, by: null, outAt: 0 });
    if (pause) this.pause = performance.now() + MG.goalPause * 1000;
  }

  // the round is over. groups: ids best first (a shared place shares its points); text: what the HUD says
  endRound(groups, text) {
    if (this.stage !== 'play') return;
    const places = placesOf(groups);
    this.results = [];
    for (const p of this.players()) {
      const place = places.get(p.id) || (Math.max(0, ...places.values()) + 1), pts = pointsFor(place), e = this.entry(p);
      if (!e.sub) e.pts += pts;
      this.results.push({ id: p.id, place, pts });
    }
    this.results.sort((a, b) => a.place - b.place);
    this.text = text;
    this.stage = 'end'; this.until = performance.now() + MG.end * 1000;
    for (const r of this.rings) if (r.holder) this.dropRing(r);
    this.pending = [];
    this.fx({ k: 'end', text });
    this.send(true);
  }

  finish() {
    this.stage = 'over';
    const st = this.standings(), top = st[0], tie = st.length > 1 && st[1].pts === top.pts;
    this.S.matchOver(tie || !top ? null : top.id, tie ? 'draw' : 'points');
  }

  // ---------- a player's input ----------
  msg(p, m) {
    if (this.stage !== 'play' || !p.alive || p.mgLate) return;
    const now = performance.now(), g = this.game;
    if (m.t === 'ring') {
      // Dodgeball: E is also a catch, just as a floatie thrown at you reaches you
      if (g === 'dodge') {
        p.catchAt = now;
        const pd = this.pending.find(h => h.q === p.id && now <= h.until);
        if (pd) { this.catchIt(pd); return; }
        if (this.rings.some(r => r.live && r.by !== p.id && Math.hypot(r.x - p.x, r.z - p.z) < 3.2)) return;
      }
      if (g === 'potato') return;
      if (g === 'poolball' && now < this.pause) return;
      if (this.rings.some(r => r.holder === p.id)) return;
      if (g === 'keepaway' && this.guard && this.guard.id === p.id && now < this.guard.until) return;
      let best = null, bd = MG.reach;
      for (const r of this.rings) {
        if (r.holder || r.mode === 'lost' || r.live) continue;
        const d = Math.hypot(r.x - p.x, r.z - p.z), dy = r.y - p.y;
        if (d < bd && dy > -0.6 && dy < 2.3) { bd = d; best = r; }
      }
      if (best) this.take(best, p);
      return;
    }
    if (m.t === 'throw') {
      if (g === 'potato') return;
      const r = this.rings.find(q => q.holder === p.id);
      if (!r || !Number.isFinite(m.yaw) || !Number.isFinite(m.pitch)) return;
      const pitch = Math.max(-1.4, Math.min(1.4, m.pitch));
      const cp = Math.cos(pitch), dx = -Math.sin(m.yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(m.yaw) * cp;
      Object.assign(r, { holder: null, mode: 'fly', live: g === 'dodge', by: p.id, outAt: 0 });
      r.x = p.x + dx * 0.45; r.y = p.y + 1.35 + dy * 0.45; r.z = p.z + dz * 0.45;
      if (this.world.blocked(r.x, r.z, 0.05, r.y - 0.1, 0, 0.2)) { r.x = p.x; r.z = p.z; }
      r.vx = dx * MG.throwSpeed; r.vy = dy * MG.throwSpeed + MG.throwUp; r.vz = dz * MG.throwSpeed;
      this.fx({ k: 'throw', i: r.i, id: p.id });
      this.sentAt = 0;
    }
  }

  take(r, p) {
    Object.assign(r, { holder: p.id, mode: 'held', live: false, by: null, outAt: 0 });
    this.fx({ k: 'grab', i: r.i, id: p.id });
    this.sentAt = 0;
  }
  // a floatie in someone's hands drops where they are (they are out, or left)
  dropRing(r, p = null) {
    const q = p || this.S.players.get(r.holder);
    Object.assign(r, { holder: null, mode: 'fly', live: false, by: null, vx: 0, vy: 0.5, vz: 0 });
    if (q) { r.x = q.x; r.y = q.y + 1.1; r.z = q.z; }
  }

  // someone is out: they watch the rest of the round (a puff of smoke on everyone's screen, no body)
  out(p, how, by = null) {
    if (!p.alive) return;
    p.alive = false; p.mgOut = true; p.use = false;
    for (const r of this.rings) if (r.holder === p.id) this.dropRing(r, p);
    this.pending = this.pending.filter(h => h.q !== p.id);
    this.outOrder.push(p.id);
    this.S.broadcast({ t: 'kill', killer: by, victim: p.id, w: 'mg', how, from: null });
  }

  // a player left the room
  leave(p) {
    for (const r of this.rings) if (r.holder === p.id) this.dropRing(r, p);
    this.pending = this.pending.filter(h => h.q !== p.id && h.by !== p.id);
    if (this.hot && this.hot.holder === p.id) this.newFuse(p.id, 0.5);
    const e = this.table.get(p.id);
    if (e && (e.sub || e.bot)) this.table.delete(p.id);
  }
  // after someone left: is there anyone left to play against?
  check() {
    if (this.stage === 'over') return;
    const n = this.players().length;
    if (n < 2) { this.finish(); return; }
    if (this.stage === 'play') this.checkEnd(performance.now());
  }

  // ---------- every tick ----------
  tick() {
    const S = this.S, now = performance.now();
    const dt = Math.min(0.25, (now - this.at) / 1000);
    this.at = now; this.t += dt;
    if (dt <= 0) return;
    // how fast everyone is moving (swimmers push the ball with it)
    for (const p of this.players()) {
      if (p.mgLx == null) { p.mgLx = p.x; p.mgLz = p.z; p.mvx = p.mvz = 0; }
      const k = Math.min(1, dt * 8), vx = (p.x - p.mgLx) / dt, vz = (p.z - p.mgLz) / dt;
      if (Math.hypot(vx, vz) < 12) { p.mvx += (vx - p.mvx) * k; p.mvz += (vz - p.mvz) * k; }
      p.mgLx = p.x; p.mgLz = p.z;
    }
    switch (this.stage) {
      case 'wait':
        if (now >= this.until) { this.stage = 'intro'; this.until = now + MG.intro * 1000; this.send(true); }
        break;
      case 'intro':
        if (now >= this.until) {
          this.stage = 'play'; this.playAt = now;
          const tm = MG_GAMES[this.game].time;
          this.endAt = tm ? now + tm * 1000 : 0;
          if (this.hot) this.hot.since = now;
          this.fx({ k: 'go' });
          this.send(true);
        }
        break;
      case 'play': this.play(dt, now); break;
      case 'end':
        if (now >= this.until) {
          if (this.round >= this.rounds) { this.finish(); return; }
          this.stage = 'board'; this.until = now + MG.board * 1000; this.send(true);
        }
        break;
      case 'board': if (now >= this.until) this.startRound(); break;
    }
    if (this.stage === 'over') return;
    const inside = this.alive();
    let moving = false;
    for (const r of this.rings) if (this.stepRing(r, dt, inside, now)) moving = true;
    S.timer = this.timeLeft(now);
    const wait = moving ? 50 : 100;
    if (now - this.sentAt >= wait - 1) this.send();
  }

  timeLeft(now = performance.now()) {
    if (this.stage === 'play') return this.endAt ? Math.max(0, (this.endAt - now) / 1000) : this.hot ? Math.max(0, this.hot.fuse) : 0;
    return Math.max(0, (this.until - now) / 1000);
  }

  play(dt, now) {
    const g = this.game, list = this.alive();
    if (g === 'dodge') {
      // hits waiting for a late catch press
      for (const h of [...this.pending]) if (now >= h.until) { this.pending.splice(this.pending.indexOf(h), 1); const q = this.S.players.get(h.q); if (q && q.alive) this.out(q, 'hit', h.by); }
    } else if (g === 'keepaway') {
      const r = this.rings[0], h = r.holder && this.S.players.get(r.holder);
      if (h && h.alive) {
        this.held.set(h.id, (this.held.get(h.id) || 0) + dt);
        // a touch steals it (not straight back by whoever just lost it)
        for (const q of list) {
          if (q === h || (this.guard && this.guard.id === q.id && now < this.guard.until)) continue;
          if (this.touching(q, h)) { this.guard = { id: h.id, until: now + MG.stealGuard * 1000 }; this.take(r, q); this.fx({ k: 'steal', id: q.id, from: h.id }); break; }
        }
      }
    } else if (g === 'potato') {
      const H = this.hot;
      if (H && H.holder) {
        H.fuse -= dt;
        const h = this.S.players.get(H.holder);
        if (h && h.alive && now - H.since > MG.passGuard * 1000) {
          for (const q of list) if (q !== h && this.touching(q, h)) { H.from = h.id; H.holder = q.id; H.since = now; this.take(this.rings[0], q); this.fx({ k: 'pass', id: q.id, from: h.id }); break; }
        }
        if (H.fuse <= 0) {
          const victim = this.S.players.get(H.holder);
          this.fx({ k: 'pop', id: H.holder, x: victim ? r2(victim.x) : 0, y: victim ? r2(victim.y + 1.2) : 0, z: victim ? r2(victim.z) : 0 });
          if (victim) this.out(victim, 'pop');
          this.rings[0].mode = 'lost'; this.rings[0].holder = null;
          this.newFuse(victim ? victim.id : null, 2);
        }
      } else if (H && !H.holder && now >= H.at) this.giveHot(H.not);
    } else if (g === 'poolball') this.goals(now);
    this.checkEnd(now);
  }

  touching(a, b) { return Math.hypot(a.x - b.x, a.z - b.z) < MG.touch && Math.abs(a.y - b.y) < 1.2; }

  // Hot Potato: a new fuse with someone else (after a short breath: wait seconds)
  newFuse(not, wait) {
    if (wait) Object.assign(this.rings[0], { mode: 'lost', holder: null, live: false });
    this.hot = { holder: null, fuse: MG.fuse, at: performance.now() + wait * 1000, since: performance.now(), not, from: null };
    if (!wait) this.giveHot(not);
  }
  giveHot(not) {
    const H = this.hot, list = this.alive().filter(p => p.id !== not);
    const pick = list.length ? list : this.alive();
    if (!pick.length) return;
    const p = pick[Math.floor(Math.random() * pick.length)];
    H.holder = p.id; H.fuse = MG.fuse; H.since = performance.now();
    this.take(this.rings[0], p);
    this.fx({ k: 'hot', id: p.id });
  }

  // is the round over?
  checkEnd(now) {
    if (this.stage !== 'play') return;
    const g = this.game, list = this.alive(), timeUp = this.endAt && now >= this.endAt;
    const T = n => (n === 'atk' ? 'Orange' : 'Blue');
    if (g === 'dodge' || g === 'potato') {
      if (this.teams) {
        const a = list.filter(p => p.team === 'atk').length, d = list.filter(p => p.team === 'def').length;
        if (a && d && !timeUp) return;
        const win = a === d ? null : a > d ? 'atk' : 'def';
        if (!win) { this.endRound([this.players().map(p => p.id)], 'A draw'); return; }
        const all = this.players();
        this.endRound([all.filter(p => p.team === win).map(p => p.id), all.filter(p => p.team !== win).map(p => p.id)], `${T(win)} win the round`);
        return;
      }
      if (list.length > 1 && !timeUp) return;
      const ins = list.map(p => p.id), outs = [...this.outOrder].reverse().filter(id => !ins.includes(id)).map(id => [id]);
      const name = ins.length === 1 ? (this.S.players.get(ins[0]) || {}).name : null;
      this.endRound([ins, ...outs], name ? `${name} wins the round` : ins.length ? 'Time! The ones still in share the win' : 'Nobody left');
      return;
    }
    if (g === 'keepaway') {
      if (!timeUp && list.length > 1) return;
      const by = new Map();
      for (const p of this.players()) { const s = Math.floor(this.held.get(p.id) || 0); if (!by.has(s)) by.set(s, []); by.get(s).push(p.id); }
      const groups = [...by.entries()].sort((a, b) => b[0] - a[0]).map(e => e[1]);
      const top = groups[0] || [], name = top.length === 1 ? (this.S.players.get(top[0]) || {}).name : null;
      this.endRound(groups, name ? `${name} wins with ${Math.floor(this.held.get(top[0]) || 0)} points` : 'A shared win');
      return;
    }
    if (g === 'poolball') {
      const s = this.score, goal = MG_GAMES.poolball.goals;
      const a = this.players().filter(p => p.team === 'atk'), d = this.players().filter(p => p.team === 'def');
      const gone = !a.length || !d.length;
      if (s.atk < goal && s.def < goal && !timeUp && !gone) return;
      let win = s.atk === s.def ? null : s.atk > s.def ? 'atk' : 'def';
      if (gone) win = a.length ? 'atk' : 'def';
      if (!win) { this.endRound([this.players().map(p => p.id)], `A draw, ${s.atk}–${s.def}`); return; }
      this.endRound([(win === 'atk' ? a : d).map(p => p.id), (win === 'atk' ? d : a).map(p => p.id)], `${T(win)} win ${Math.max(s.atk, s.def)}–${Math.min(s.atk, s.def)}`);
    }
  }

  // ---------- Pool Ball: goals ----------
  goals(now) {
    const r = this.rings[0];
    if (now < this.pause) { Object.assign(r, { x: ARENA.pool.cx, z: ARENA.pool.cz, y: WY, vx: 0, vz: 0, vy: 0, mode: 'float', holder: null }); return; }
    if (r.holder) return;
    ARENA.goals.forEach((g, i) => {
      if (this.stage !== 'play' || now < this.pause) return;
      const mouth = goalMouth(g, this.big[i]), past = g.dir < 0 ? r.x < g.line - 0.3 : r.x > g.line + 0.3;
      if (past && r.z > mouth.z0 && r.z < mouth.z1 && r.y < WY + ARENA.postH && r.y > POOL.G - 2.2) {
        const team = g.side === 'atk' ? 'def' : 'atk';       // (the other team scores in your goal)
        this.score[team]++;
        const by = r.by && this.S.players.get(r.by);
        this.fx({ k: 'goal', team, by: by ? by.name : null, sc: [this.score.atk, this.score.def], x: r2(r.x), z: r2(r.z) });
        this.ballToMiddle(true);
        this.send(true);
      }
    });
  }

  // ---------- the floaties ----------
  // one floatie for one step; true if it moved (or is in someone's hands)
  stepRing(r, dt, inside, now) {
    if (r.mode === 'lost') return false;
    if (r.holder) {
      const p = this.S.players.get(r.holder);
      if (!p || !p.alive) { this.dropRing(r, p); return true; }
      r.x = p.x; r.y = p.y + 1.1; r.z = p.z; r.vx = r.vy = r.vz = 0;
      return true;
    }
    // out of the round's area (over the low wall, onto the pool's deck in Pool Ball): it goes back in a moment later
    const area = MG_GAMES[this.game] ? MG_GAMES[this.game].area : 'court';
    const outside = !inArea(area, r.x, r.z) || (this.game === 'poolball' && r.mode === 'rest' && !this.world.bodyAt(r.x, r.z)) || r.y < -2;
    if (outside && r.mode !== 'fly') {
      if (!r.outAt) r.outAt = now;
      else if (now - r.outAt > MG.outBack * 1000) {
        if (this.game === 'poolball') { this.ballToMiddle(false); this.pause = now + 1000; }
        else { const C = ARENA.court; this.placeRing(r, C.mid + (Math.random() - 0.5) * 3, C.cz + (Math.random() - 0.5) * 6); }
        this.fx({ k: 'back', i: r.i });
        return true;
      }
    } else r.outAt = 0;
    if (this.game === 'poolball' && r.i === 0 && this.pause > now) return false;      // (after a goal it waits in the middle)
    if (r.mode === 'float') return this.floatStep(r, dt, inside);
    const x0 = r.x, y0 = r.y, z0 = r.z, vx = r.vx, vy = r.vy, vz = r.vz, wasLive = r.live && r.mode === 'fly';
    const moved = PoolHost.prototype.ringStep.call(this, r, dt, inside);
    if (wasLive) {
      // bounced off anything (its speed changed more than falling would change it) or landed: it is safe now
      const ex = r.vx - vx, ey = r.vy - (vy - RING_G * dt), ez = r.vz - vz;
      if (r.mode !== 'fly' || Math.hypot(ex, ey, ez) > 0.6) r.live = false;
      if (this.stage === 'play' && this.game === 'dodge') this.hits(r, x0, y0, z0);
    }
    return moved;
  }

  // Pool Ball's floatie on the water: swimmers push it along (harder the faster they swim into it); it glides
  // to a stop, and bounces off the pool's sides and the goals' posts
  floatStep(r, dt, inside) {
    const W = this.world, b = W.bodyAt(r.x, r.z);
    if (!b) { r.mode = 'fly'; r.vy = 0; return true; }
    const x0 = r.x, z0 = r.z;
    r.y = b.y;
    for (const p of inside) {
      const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot(dx, dz);
      if (d > 0.85 || d < 0.01 || Math.abs(p.y + 1.35 - r.y) > 0.8) continue;
      const nx = dx / d, nz = dz / d, into = (p.mvx || 0) * nx + (p.mvz || 0) * nz;
      const want = Math.max(0.5, into * 1.35), cur = r.vx * nx + r.vz * nz;
      if (cur < want) { r.vx += nx * (want - cur); r.vz += nz * (want - cur); }
      if (into > 0.3) r.by = p.id;
    }
    const drag = Math.exp(-0.65 * dt); r.vx *= drag; r.vz *= drag;
    const sp = Math.hypot(r.vx, r.vz); if (sp > 4.2) { r.vx *= 4.2 / sp; r.vz *= 4.2 / sp; }
    const nx = r.x + r.vx * dt, nz = r.z + r.vz * dt;
    const ok = (x, z) => { const bb = W.bodyAt(x, z); return bb === b && !W.blocked(x, z, 0.32, b.y - 0.15, 0, 0.3); };
    if (ok(nx, r.z)) r.x = nx; else r.vx = -r.vx * 0.55;
    if (ok(r.x, nz)) r.z = nz; else r.vz = -r.vz * 0.55;
    return Math.abs(x0 - r.x) + Math.abs(z0 - r.z) > 1e-4;
  }

  // Dodgeball: did this live floatie (moving from a to where it is now) hit anyone?
  hits(r, ax, ay, az) {
    if (r.by == null) return;
    const now = performance.now(), thrower = this.S.players.get(r.by);
    const bx = r.x, by = r.y, bz = r.z, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    for (const q of this.alive()) {
      if (q.id === r.by || this.pending.some(h => h.q === q.id)) continue;
      if (this.teams && thrower && thrower.team === q.team) continue;       // (teammates: it flies on past)
      const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.z - az) * dz) / L2)) : 0;
      const cx = ax + dx * t, cz = az + dz * t, cy = ay + (by - ay) * t;
      if (Math.hypot(cx - q.x, cz - q.z) > MG.hitR || cy < q.y - 0.2 || cy > q.y + 2.0) continue;
      // a hit: the floatie bounces off them (no longer dangerous)
      r.live = false;
      const sp = Math.hypot(r.vx, r.vz) || 1;
      r.vx = -r.vx / sp * 1.2; r.vz = -r.vz / sp * 1.2; r.vy = 2.2;
      r.x = cx; r.z = cz; r.y = Math.max(cy, q.y + 0.3);
      const h = { q: q.id, by: r.by, ring: r.i, at: now, until: now + Math.min(MG.catchAfter, 0.08 + (q.ping || 0) / 2000) * 1000 };
      this.fx({ k: 'hit', id: q.id, i: r.i, x: r2(cx), y: r2(cy), z: r2(cz) });
      if (now - (q.catchAt || -1e9) < MG.catchBefore * 1000) this.catchIt(h);
      else this.pending.push(h);
      return;
    }
  }
  // a floatie caught just as it reached you: the thrower is out, you hold it
  catchIt(h) {
    this.pending = this.pending.filter(o => o !== h);
    const q = this.S.players.get(h.q), by = this.S.players.get(h.by), r = this.rings[h.ring];
    if (!q || !q.alive) return;
    this.fx({ k: 'catch', id: q.id, by: h.by });
    // (one in your hands already: it drops at your feet, you have the one you caught)
    if (r && !r.holder) { for (const o of this.rings) if (o.holder === q.id) this.dropRing(o, q); this.take(r, q); }
    if (by && by.alive) this.out(by, 'caught', q.id);
  }

  // ---------- what the players' screens need ----------
  send(now = false) {
    this.sentAt = performance.now();
    this.S.broadcast({ t: 'mg', s: this.state(), now: now ? 1 : 0 });
  }
  state() {
    const H = this.hot;
    return {
      st: this.stage, tl: r2(this.timeLeft()), g: this.game, rd: this.round, of: this.rounds, run: this.cfg.run, tm: this.teams ? 1 : 0,
      sc: [this.score.atk, this.score.def], big: this.big.map(b => (b ? 1 : 0)), ps: this.pause > performance.now() ? 1 : 0,
      r: this.rings.map(r => [r2(r.x), r2(r.y), r2(r.z), r2(r.vx), r2(r.vy), r2(r.vz), r.holder || 0, MODES.indexOf(r.mode), r.live ? 1 : 0]),
      hot: H ? [H.holder || 0, r2(Math.max(0, H.fuse))] : null,
      kp: this.game === 'keepaway' ? [...this.held.entries()].map(([id, s]) => [id, Math.floor(s)]) : null,
      gd: this.guard && this.guard.until > performance.now() ? this.guard.id : 0,
      res: this.results ? this.results.map(o => [o.id, o.place, o.pts]) : null, txt: this.text,
      pts: this.standings().map(e => [e.id, e.name, e.pts]),
    };
  }
}

// ---------- bots (Practice only) ----------
// Simple players for each game: chase the floatie, throw at the nearest player, run from the Hot Potato's holder,
// swim the ball towards the goal. They move on the host (no physics: they walk on the court or swim at the water's
// level, sliding along walls), and use the same messages as everyone (host.msg).
export class MiniBot {
  constructor(S, p, level = 'normal') {
    this.S = S; this.p = p; this.L = BOT_LEVEL[level] || BOT_LEVEL.normal;
    this.reset();
  }
  reset() { this.aimAt = 0; this.wander = null; this.dodge = null; this.thinkAt = 0; this.catchRoll = new Set(); this.holdSince = 0; }
  get host() { return this.S.mgHost; }

  update(dt) {
    const H = this.host, p = this.p;
    if (!H || !p.alive || H.stage !== 'play') return;
    const now = performance.now(), g = H.game;
    const mine = H.rings.find(r => r.holder === p.id);
    if (mine && !this.holdSince) this.holdSince = now;
    if (!mine) this.holdSince = 0;
    if (g === 'dodge') this.dodgeball(dt, now, mine);
    else if (g === 'keepaway') this.keepAway(dt, now, mine);
    else if (g === 'potato') this.potato(dt, now);
    else if (g === 'poolball') this.poolBall(dt, now, mine);
  }

  others() { return this.host.alive().filter(q => q !== this.p); }
  foes() { const H = this.host; return this.others().filter(q => !H.teams || q.team !== this.p.team); }
  nearest(list) { let best = null, bd = Infinity; for (const q of list) { const d = Math.hypot(q.x - this.p.x, q.z - this.p.z); if (d < bd) { bd = d; best = q; } } return best; }

  speed() {
    const H = this.host, p = this.p, sw = this.swimming();
    let v = (sw ? MG.speed.swim : MG.speed.run) * this.L.speed;
    if (H.game === 'keepaway' && H.rings[0].holder === p.id) v *= MG.speed.keep;
    if (H.game === 'potato' && H.hot && H.hot.holder === p.id) v *= MG.speed.potato;
    return v;
  }
  swimming() { const b = this.S.world.bodyAt(this.p.x, this.p.z); return !!b && this.p.y < b.y - 0.5; }

  // walk (or swim) towards (tx, tz); slides along walls; team Dodgeball keeps to its own half
  moveTo(tx, tz, dt, k = 1) {
    const p = this.p, W = this.S.world, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.08) return;
    const step = Math.min(d, this.speed() * k * dt), ux = dx / d, uz = dz / d;
    const sw = this.swimming();
    const ok = (x, z) => {
      if (sw && !W.bodyAt(x, z)) return false;
      if (W.blocked(x, z, 0.36, p.y, sw ? 0.05 : 0.42)) return false;
      const H = this.host;
      if (H.game === 'dodge' && H.teams) { const m = ARENA.court.mid; if (p.team === 'atk' ? x > m - 0.4 : x < m + 0.4) return false; }
      return inArea(MG_GAMES[H.game].area, x, z);
    };
    const nx = p.x + ux * step, nz = p.z + uz * step;
    if (ok(nx, nz)) { p.x = nx; p.z = nz; }
    else if (ok(nx, p.z)) p.x = nx;
    else if (ok(p.x, nz)) p.z = nz;
    if (!sw) p.y = W.groundAt(p.x, p.z, 0.36, p.y + 0.3, 0.45);
  }
  face(tx, tz, pitch = 0) { this.p.yaw = Math.atan2(-(tx - this.p.x), -(tz - this.p.z)); this.p.pitch = pitch; }
  // somewhere to drift to when there is nothing better to do
  roam(dt, now) {
    const C = ARENA.court, p = this.p, H = this.host;
    if (!this.wander || now > this.wander.until || Math.hypot(this.wander.x - p.x, this.wander.z - p.z) < 0.5) {
      let x0 = C.x0 + 1.5, x1 = C.x1 - 1.5;
      if (H.game === 'dodge' && H.teams) { if (p.team === 'atk') x1 = C.mid - 1; else x0 = C.mid + 1; }
      this.wander = { x: x0 + Math.random() * (x1 - x0), z: C.z0 + 1.5 + Math.random() * (C.z1 - C.z0 - 3), until: now + 1500 + Math.random() * 2000 };
    }
    this.moveTo(this.wander.x, this.wander.z, dt, 0.6);
  }
  // the pitch that throws a floatie from here onto (tx, ty, tz), or null (out of reach)
  aim(tx, ty, tz) {
    const p = this.p, d = Math.hypot(tx - p.x, tz - p.z), h = ty - (p.y + 1.35);
    let best = null, be = Infinity;
    for (let a = -0.5; a <= 0.9; a += 0.02) {
      const vh = MG.throwSpeed * Math.cos(a), vy = MG.throwSpeed * Math.sin(a) + MG.throwUp, t = d / vh, y = vy * t - 0.5 * RING_G * t * t;
      const e = Math.abs(y - h);
      if (e < be) { be = e; best = a; }
    }
    return be < 0.5 ? best : null;
  }
  throwAt(q, now) {
    const p = this.p, d = Math.hypot(q.x - p.x, q.z - p.z), t = d / MG.throwSpeed;
    // lead the target a little (where they will be when it arrives)
    const tx = q.x + (q.mvx || 0) * t * 0.8, tz = q.z + (q.mvz || 0) * t * 0.8;
    const pitch = this.aim(tx, q.y + 1.0, tz);
    if (pitch == null) return false;
    this.face(tx, tz, pitch);
    const e = this.L.err;
    this.host.msg(p, { t: 'throw', yaw: p.yaw + (Math.random() - 0.5) * e * 2, pitch: pitch + (Math.random() - 0.5) * e });
    return true;
  }
  grab() { this.host.msg(this.p, { t: 'ring' }); }

  dodgeball(dt, now, mine) {
    const H = this.host, p = this.p;
    // a live floatie coming at me: try to catch it (sometimes), or step out of its way
    for (const r of H.rings) {
      if (!r.live || r.by === p.id) continue;
      const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz), sp = Math.hypot(r.vx, r.vz);
      if (d > 7 || sp < 1) continue;
      const toward = (r.vx * dx + r.vz * dz) / (d * sp);
      if (toward < 0.85) continue;
      if (!this.catchRoll.has(r)) { this.catchRoll.add(r); r.botTry = r.botTry || new Map(); r.botTry.set(p.id, Math.random() < this.L.catch); }
      if (r.botTry && r.botTry.get(p.id) && d < 2.2) { this.grab(); continue; }
      if (Math.random() < dt / (this.L.react * 0.6)) { const sx = -r.vz / sp, sz = r.vx / sp, sd = Math.random() < 0.5 ? 1 : -1; this.dodge = { x: p.x + sx * sd * 2.5, z: p.z + sz * sd * 2.5, until: now + 600 }; }
    }
    if (this.catchRoll.size > 20) this.catchRoll.clear();
    if (this.dodge && now < this.dodge.until) { this.moveTo(this.dodge.x, this.dodge.z, dt); return; }
    if (mine) {
      const q = this.nearest(this.foes());
      if (!q) return;
      this.face(q.x, q.z);
      if (!this.aimAt) this.aimAt = now + (this.L.aim * (0.6 + Math.random() * 0.8)) * 1000;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > 11) this.moveTo(q.x, q.z, dt, 0.7);
      if (now >= this.aimAt && d < 13) { this.throwAt(q, now); this.aimAt = 0; }
      return;
    }
    this.aimAt = 0;
    // the nearest floatie that is safe to pick up (on my half in team play)
    let best = null, bd = Infinity;
    for (const r of H.rings) {
      if (r.holder || r.live || r.mode === 'lost' || !inArea('court', r.x, r.z)) continue;
      if (H.teams && (p.team === 'atk' ? r.x > ARENA.court.mid : r.x < ARENA.court.mid)) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d < bd) { bd = d; best = r; }
    }
    if (best) { this.moveTo(best.x, best.z, dt); if (bd < 1.3) this.grab(); }
    else this.roam(dt, now);
  }

  keepAway(dt, now, mine) {
    const H = this.host, p = this.p, r = H.rings[0], C = ARENA.court;
    if (mine) {
      // run from the nearest chaser (and away from the walls); throw it away when they are on me
      const q = this.nearest(this.others());
      if (!q) return;
      let fx = p.x - q.x, fz = p.z - q.z;
      const d = Math.hypot(fx, fz) || 1; fx /= d; fz /= d;
      fx += (C.cx - p.x) / 6; fz += (C.cz - p.z) / 6;
      this.moveTo(p.x + fx * 3, p.z + fz * 3, dt);
      this.face(p.x + fx, p.z + fz, 0.25);
      if (d < 1.6 && Math.random() < dt * 1.5) this.host.msg(p, { t: 'throw', yaw: p.yaw, pitch: 0.35 });
      return;
    }
    const guarded = H.guard && H.guard.id === p.id && now < H.guard.until;
    if (r.holder) { const h = this.S.players.get(r.holder); if (h && !guarded) this.moveTo(h.x + (h.mvx || 0) * 0.3, h.z + (h.mvz || 0) * 0.3, dt); else this.roam(dt, now); return; }
    if (r.mode === 'lost') return this.roam(dt, now);
    this.moveTo(r.x, r.z, dt);
    if (!guarded && Math.hypot(r.x - p.x, r.z - p.z) < 1.3) this.grab();
  }

  potato(dt, now) {
    const H = this.host, p = this.p, C = ARENA.court;
    if (!H.hot) return this.roam(dt, now);
    if (H.hot.holder === p.id) {
      const q = this.nearest(this.others());
      if (q) this.moveTo(q.x + (q.mvx || 0) * 0.35, q.z + (q.mvz || 0) * 0.35, dt);
      return;
    }
    const h = H.hot.holder && this.S.players.get(H.hot.holder);
    if (!h) return this.roam(dt, now);
    const d = Math.hypot(p.x - h.x, p.z - h.z);
    if (d > 7) return this.roam(dt, now);
    // run away from the holder, round the court rather than into a corner
    let fx = (p.x - h.x) / (d || 1), fz = (p.z - h.z) / (d || 1);
    const wx = (C.cx - p.x) / ((C.x1 - C.x0) / 2), wz = (C.cz - p.z) / ((C.z1 - C.z0) / 2);
    fx += wx * 0.9; fz += wz * 0.9;
    this.moveTo(p.x + fx * 3, p.z + fz * 3, dt);
  }

  poolBall(dt, now, mine) {
    const H = this.host, p = this.p, r = H.rings[0];
    const goal = ARENA.goals.find(g => g.side !== p.team), own = ARENA.goals.find(g => g.side === p.team);
    const gx = goal.line + goal.dir * 0.8, gz = (goal.z0 + goal.z1) / 2;
    if (mine) {
      const d = Math.hypot(gx - p.x, gz - p.z);
      this.face(gx, gz);
      if (d < 9 || now - this.holdSince > 2500) {
        const pitch = this.aim(gx, WY + 0.4, gz);
        this.host.msg(p, { t: 'throw', yaw: p.yaw + (Math.random() - 0.5) * this.L.err * 3, pitch: pitch == null ? 0.3 : pitch + (Math.random() - 0.5) * this.L.err });
      } else this.moveTo(gx, gz, dt);
      return;
    }
    if (r.holder) {
      // someone has it: theirs → get between them and our goal; ours → swim up the pool
      const h = this.S.players.get(r.holder);
      if (h && h.team !== p.team) this.moveTo((h.x + own.line) / 2, (h.z + 9) / 2, dt);
      else this.moveTo(gx - goal.dir * 4, 9 + (Math.random() - 0.5) * 3, dt, 0.7);
      return;
    }
    if (H.pause > now) { this.moveTo(own.line - own.dir * 3, 9, dt, 0.5); return; }
    // am I the one nearest the ball on my team? then go for it; else hang back in front of our goal
    const mates = H.alive().filter(q => q.team === p.team);
    const near = mates.reduce((a, q) => (Math.hypot(q.x - r.x, q.z - r.z) < Math.hypot(a.x - r.x, a.z - r.z) ? q : a), p);
    if (near !== p) { this.moveTo(own.line - own.dir * 2.5, Math.max(6, Math.min(12, r.z)), dt, 0.8); return; }
    const bx = r.x - gx, bz = r.z - gz, bl = Math.hypot(bx, bz) || 1;
    // swim to just behind the ball (on the side away from their goal), then through it towards the goal
    const sx = r.x + bx / bl * 0.7, sz = r.z + bz / bl * 0.7, ds = Math.hypot(sx - p.x, sz - p.z);
    if (ds > 0.6) this.moveTo(sx, sz, dt); else this.moveTo(gx, gz, dt);
    this.face(r.x, r.z);
    if (Math.hypot(r.x - p.x, r.z - p.z) < 1.4 && Math.random() < dt * 0.8) this.grab();
  }
}
