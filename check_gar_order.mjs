// Plays Level 1's order with no graphics: the crank is dead without power, the fuse box turns it on, the crank winds
// the shutter up (only while it is held, and the monster is told), and the lift only takes you once both are done.
//   node check_gar_order.mjs
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const { GAR_LEVELS } = await import('./garmap.js');
let bad = 0;
const ok = (c, t) => { if (!c) { bad++; console.log('  FAIL', t); } };
for (const [level, n] of [['easy', 1], ['normal', 2], ['hard', 2]]) {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: null });
  S.addPlayer('a', 'Ann'); if (n > 1) S.addPlayer('b', 'Ben');
  S.startBotGame({ kind: 'br', stage: 1, level });
  const plan = S.world.def.gar, a = S.players.get('a'), brain = S.bots.get('monster');
  brain.update = () => {};                                   // (the monster stays out of this one)
  let heard = 0; brain.hearNoise = () => { heard++; };
  const run = (secs, hold) => { for (let t = 0; t < secs * 20; t++) { simNow += 50; if (hold) S.receive('a', { t: 'crank' }); S.tick(); } };
  const at = (o, dx = 0, dz = 0) => { a.x = o.x + dx; a.y = o.y; a.z = o.z + dz; };
  const sh = S.world.doors.find(d => d.lock === 'shutter'), L = plan.lift;
  // the lift before anything: nothing (it is behind the shutter anyway)
  a.x = 3; a.y = L.y; a.z = 3; run(1);
  ok(!a.escaped, 'the lift took someone before the power and the shutter');
  // the crank without power
  at(plan.crank, 0, 0.7); run(3, true);
  ok(S.garSt.crank === 0 && msgs.some(m => m.t === 'toast' && /brake/.test(m.text)), 'the crank turned without power');
  // the fuse box: not from far away, then from in front of it
  at(plan.start); S.receive('a', { t: 'fuse' }); ok(!S.garSt.power, 'the fuse box worked from across the map');
  at(plan.fuse, 0, 0.8); S.receive('a', { t: 'fuse' }); ok(S.garSt.power && msgs.some(m => m.t === 'power'), 'the fuse box did not turn the power on');
  // winding: half way, let go (it stays), then the rest
  const T = GAR_LEVELS[level].crank;
  at(plan.crank, 0, 0.7); run(T / 2, true);
  run(0.8, false);                                           // (let go: the last press counts for a moment)
  const half = S.garSt.crank; ok(Math.abs(half - 0.5) < 0.08 && !sh.open, `half the winding time gave ${half}`);
  run(3, false); ok(S.garSt.crank === half, 'the shutter moved with nobody at the crank');
  a.x = 30; run(1, true); ok(S.garSt.crank === half, 'the crank turned from far away'); at(plan.crank, 0, 0.7);
  run(T / 2 + 1, true);
  ok(sh.open && S.garSt.crank >= 1, 'the shutter did not open');
  ok(heard >= T - 2, `the monster was told about the crank only ${heard} times`);
  // into the lift
  a.x = 3; a.z = 3; run(0.5);
  ok(a.escaped && msgs.some(m => m.t === 'escaped' && m.lift), 'the lift did not take the player');
  if (n > 1) { ok(S.phase === 'br', 'the game ended with someone still inside'); const b = S.players.get('b'); b.x = 2; b.y = L.y; b.z = 2; run(0.5); ok(b.escaped, 'the second player could not take the lift'); }
  run(11);
  const over = msgs.find(m => m.t === 'over');
  ok(over && over.winner === 'escaped' && over.reason === 'all' && over.map === 'garage', 'no "everyone escaped" result');
  // a late joiner is told how far things are
  ok(S.startMsg().gar.power === true && S.startMsg().gar.crank === 1, 'the start message does not carry the order');
  console.log(`${level}, ${n} player${n > 1 ? 's' : ''}: crank ${T} s, monster told ${heard} times`);
}
// ---- one run: escaping Level 0 carries straight on into Level 1, everyone alive again ----
for (const l1 of [true, false]) {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: null });
  S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
  S.receive('a', { t: 'settings', mode: 'br', l1 });
  S.receive('b', { t: 'settings', stage: 1, l1: true });                 // (only the host may say so)
  S.receive('a', { t: 'settings', stage: 1 });
  ok(S.settings.stage === (l1 ? 1 : 0), 'Level 1 could be chosen by a host who may not play it');
  S.receive('a', { t: 'settings', stage: 0 });
  S.receive('a', { t: 'startMatch' });
  ok(S.phase === 'br' && !S.gar, 'Level 0 did not start');
  const a = S.players.get('a'), b = S.players.get('b'), e = S.world.exit;
  S.bots.get('monster').update = () => {};
  const run = (secs) => { for (let t = 0; t < secs * 20; t++) { simNow += 50; S.tick(); } };
  run(30);
  b.lives = 1; S.kill(b, null, 'fall', false);                           // Ben dies in Level 0, on his last life (3 lives each)
  a.x = e.x + e.nx * 0.3; a.z = e.z + e.nz * 0.3; a.y = 0; run(1);        // Ann walks out of the exit
  ok(a.escaped, 'Ann did not escape Level 0');
  const t0 = S.timer;
  run(9);
  if (l1) {
    ok(S.gar && S.phase === 'br' && msgs.some(m => m.t === 'start' && m.map === 'garage'), 'the run did not carry on into Level 1');
    ok(a.alive && b.alive && !a.escaped && Math.abs(a.y - S.world.def.gar.start.y) < 0.01, 'not everyone starts Level 1 alive at its start');
    ok(S.timer > t0 && !msgs.some(m => m.t === 'over'), 'the clock was reset, or the results were shown, between the levels');
    ok(S.bots.get('monster').constructor.name === 'ShifterBrain', "Level 1 does not have its own monster");
  } else ok(!S.gar && msgs.some(m => m.t === 'over' && m.winner === 'escaped'), 'without Level 1 the game should end at the exit');
  console.log(l1 ? 'Level 0 exit → Level 1: carried on, both alive' : 'no Level 1 for this host: the game ends at the exit');
}
console.log(bad ? `${bad} problem(s)` : "Level 1's order: all checks passed");
process.exit(bad ? 1 : 0);
