// Backrooms: leaving a running game and coming back costs one life (owner's rule), on the real host code.
//   node check_rejoin.mjs
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
let bad = 0;
const ok = (c, t) => { if (!c) { bad++; console.log('  FAIL', t); } else console.log('  ok', t); };
const tick = (S, secs) => { for (let t = 0; t < Math.round(secs * 20); t++) { simNow += 50; S.tick(); } };

for (const stage of [0, 1, 2]) {
  console.log(`stage ${stage}`);
  const S = new Server({ send: () => {}, practice: false, ownerId: 'a', localId: null });
  S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
  S.startBotGame({ kind: 'br', stage, level: 'normal', l1: true, l2: true });
  const brain = S.bots.get('monster'); if (brain) brain.update = () => {};
  tick(S, 1);
  // Ben leaves alive and comes back
  S.removePlayer('b'); tick(S, 1);
  S.addPlayer('b2', 'Ben'); tick(S, 1);
  let b = S.players.get('b2');
  ok(b.alive, 'alive again after rejoining');
  if (stage < 2) ok(b.lives === 2, `one life lost (lives ${b.lives})`);
  if (stage < 2) {
    // twice more: no lives left, watching
    S.removePlayer('b2'); tick(S, 1); S.addPlayer('b3', 'Ben'); tick(S, 1);
    S.removePlayer('b3'); tick(S, 1); S.addPlayer('b4', 'Ben'); tick(S, 1);
    b = S.players.get('b4');
    ok(!b.alive && b.lives === 0, `out of lives after leaving three times (alive ${b.alive}, lives ${b.lives})`);
    ok(S.phase === 'br', 'the game goes on for the others');
    // Ann is caught (a life gone, waiting to come back), leaves, comes back: back in at once, no extra life lost
    const a = S.players.get('a');
    S.kill(a, null, 'fall', false);
    ok(a.lives === 2 && a.respawning, 'Ann caught: 2 lives, coming back');
    S.removePlayer('a'); tick(S, 0.5); S.addPlayer('a2', 'Ann'); tick(S, 1);
    const a2 = S.players.get('a2');
    ok(a2.alive && a2.lives === 2, `Ann back with no extra life lost (alive ${a2.alive}, lives ${a2.lives})`);
  }
}
console.log(bad ? `${bad} FAILED` : 'rejoin: all checks passed');
process.exit(bad ? 1 : 0);
