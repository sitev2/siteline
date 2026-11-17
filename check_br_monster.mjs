// Plays Backrooms Level 0 fast with no graphics: two pretend players go through the sections stage by stage, and it
// checks where the monster goes (owner's rules, monster.js): it stays in the section of the current task, never
// gets ahead of the players (a gate opened with the players still behind it: it stays put), follows them on once
// they go through, can chase someone back through an open gate but then goes home again, and crosses the pit hall.
//   node check_br_monster.mjs [easy|normal|hard] [seed]
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const { brSection } = await import('./brmap.js');
const [level = 'normal', seedArg] = process.argv.slice(2);
const S = new Server({ send: () => {}, practice: false, ownerId: 'a', localId: null });
S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
if (seedArg) { const orig = Math.random; let k = 0; Math.random = () => (k++ ? orig() : (Number(seedArg) % 1000) / 1000); }
S.startBotGame({ kind: 'br', stage: 0, level });
S.brCheck = () => {};          // (the game never ends)
// the pretend players can't be caught (this checks where the monster goes, not how well they hide): a catch is
// counted and the player is put down again somewhere else in the section they want to be in, away from it
let grabs = 0;
S.monsterKill = (m, q) => {
  grabs++;
  const w = walkers.find(o => o.p === q);
  const i = nav.randomNode((x, y, z, k) => nodeSec[k] === w.want && nav.reach[k] && Math.hypot(x - m.x, z - m.z) > 25);
  q.x = nav.x[i]; q.z = nav.z[i]; w.path = null;
};
S.world.def.br.holes = []; S.cornerUsed = true;      // (no snatches either)
const plan = S.world.def.br, nav = S.navGrid(), brain = S.bots.get('monster'), mon = S.players.get('monster');
const secOf = (x, z) => { const s = brSection(plan, x, z); return s === 4 ? 3 : s; };
const nodeSec = new Int8Array(nav.n);
for (let i = 0; i < nav.n; i++) nodeSec[i] = secOf(nav.x[i], nav.z[i]);
const walkers = ['a', 'b'].map((id, k) => ({ p: S.players.get(id), want: 0, path: null, i: 0, speed: 2.7, k }));
for (const w of walkers) w.p.lives = 999;
const gateOpen = (lock) => { const i = S.world.doors.findIndex(d => d.lock === lock); if (!S.world.doors[i].open) S.openTeamDoor(i, null, ''); };
let kills = 0;
const step = () => {
  simNow += 50;
  for (const w of walkers) {
    const p = w.p;
    if (!p.alive) { if (!w.dead) { w.dead = simNow; kills++; } continue; }
    w.dead = 0;
    const here = secOf(p.x, p.z);
    if (!w.path || w.i >= w.path.length) {
      // somewhere in the section they want to be in (walking there through the open gates)
      let goal = nav.randomNode((x, y, z, i) => nodeSec[i] === w.want && nav.reach[i]);
      if (nodeSec[goal] !== w.want) goal = nav.randomNode();
      w.path = nav.path(nav.nearest(p.x, p.y, p.z), goal, nav.n * 2) || []; w.i = 0;
      w.speed = Math.random() < 0.3 ? 4.5 : 2.7;
      if (!w.path.length && here !== w.want) w.path = null;
    }
    const sp = mon.use ? 4.1 : w.speed, j = w.path && w.path[w.i];
    if (j == null) continue;
    const dx = nav.x[j] - p.x, dz = nav.z[j] - p.z, d = Math.hypot(dx, dz), stepLen = sp * 0.05;
    if (d < stepLen + 0.05) { p.x = nav.x[j]; p.z = nav.z[j]; w.i++; } else { p.x += dx / d * stepLen; p.z += dz / d * stepLen; p.yaw = Math.atan2(-dx, -dz); }
    // doors in the way: open them (players can)
    S.world.doors.forEach((dr, i) => { if (!dr.open && !dr.lock && Math.hypot(dr.cx - p.x, dr.cz - p.z) < 1.2) S.toggleDoor(i, true, p); });
  }
  S.tick();
};
const bad = [];
// run `secs` of game time; returns the share of time the monster spent in each section, and the longest stretch in
// a section other than `home` while it wasn't after anyone (seen, heard or searching for them): that is its walk home
const run = (secs, home) => {
  const time = [0, 0, 0, 0], idleAway = { now: 0, max: 0 };
  for (let t = 0; t < secs * 20; t++) {
    step();
    const s = secOf(mon.x, mon.z);
    time[s]++;
    if (process.env.TRACE && s !== run.last) {
      const g = brain.goal, gs = g ? 'ABCD'[secOf(g.x, g.z)] : '-';
      const tg = brain.target ? `${brain.target.id}@${'ABCD'[secOf(brain.target.x, brain.target.z)]}` : '';
      console.log(`    t=${(simNow / 1000).toFixed(0)}s ${'ABCD'[run.last] || '?'}→${'ABCD'[s]} state ${brain.state} home ${'ABCD'[brain.home]} goal ${gs} ${tg} players ${walkers.map(w => 'ABCD'[secOf(w.p.x, w.p.z)]).join('')}`);
      run.last = s;
    }
    // (following a clue counts as hunting: seen, heard, or searching where it last had one)
    const hunting = ['chase', 'stalk', 'pursue', 'search', 'hangGo'].includes(brain.state) || brain.catching || brain.dragging;
    if (home != null && s !== home && !hunting) { idleAway.now++; idleAway.max = Math.max(idleAway.max, idleAway.now); } else idleAway.now = 0;
    if (!Number.isFinite(mon.x + mon.z)) { bad.push('position is not a number'); break; }
  }
  const n = time.reduce((a, b) => a + b, 0);
  return { share: time.map(v => Math.round(v / n * 100)), awayMax: idleAway.max / 20 };
};
const report = (name, r) => console.log(`  ${name}: monster in A/B/C/D ${r.share.join('/')} %, home ${'ABCD'[brain.home]}${r.awayMax ? `, longest away from home not hunting ${r.awayMax.toFixed(0)} s` : ''}`);
console.log(`level ${level}:`);
// stage A: everyone in A
let r = run(150, 0); report('stage A, players in A', r);
if (r.share[1] || r.share[2] || r.share[3]) bad.push('left A while the heavy door was shut');
// heavy door open, players still in A: it stays in A (never ahead of them)
gateOpen('heavy');
r = run(90, 0); report('heavy door open, players still in A', r);
if (r.share[1]) bad.push('went into B ahead of the players');
// players go into B: it follows
walkers.forEach(w => { w.want = 1; w.path = null; });
r = run(240, 1); report('players in B', r);
if (brain.home !== 1) bad.push('home did not move to B');
if (r.share[1] < 30) bad.push('hardly came into B');
// locked door open, players into C's maze (not across): it comes to C, never ahead into D
gateOpen('red'); S.brKey.holder = 'used';
walkers.forEach(w => { w.want = 2; w.path = null; });
r = run(240, 2); report('players in C', r);
if (r.share[3]) bad.push('went into D ahead of the players');
if (brain.home !== 2) bad.push('home did not move to C');
// one player goes back to B: it may chase them back, but then it goes home to C
walkers[1].want = 1; walkers[1].path = null;
r = run(240, 2); report('one player back in B, one in C', r);
if (r.awayMax > 45) bad.push(`stayed in an earlier section ${r.awayMax.toFixed(0)} s without hunting anyone`);
// both cross the pit hall into D: its home moves to D and it crosses the hall after them
walkers.forEach(w => { w.want = 3; w.path = null; });
r = run(300, 3); report('players in D', r);
if (!S.brCrossed) bad.push('crossing into D was not noticed');
if (brain.home !== 3) bad.push('home did not move to D');
if (!r.share[3]) bad.push('never crossed the pit hall into D');
console.log(`  times it caught someone: ${grabs}`);
console.log(bad.length ? `PROBLEMS: ${bad.join('; ')}` : 'monster rules OK');
process.exit(bad.length ? 1 : 0);
