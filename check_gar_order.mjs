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
  ok(JSON.stringify(S.startMsg().gar) === JSON.stringify({ power: true, crank: 1 }), 'the start message does not carry the order');
  console.log(`${level}, ${n} player${n > 1 ? 's' : ''}: crank ${T} s, monster told ${heard} times`);
}
console.log(bad ? `${bad} problem(s)` : "Level 1's order: all checks passed");
process.exit(bad ? 1 : 0);
