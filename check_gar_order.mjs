// Plays Level 1's order with no graphics, on the real host code:
//   the four fuses (each in a different side room; one carried at a time; reach checked; back in its room when its
//   carrier is taken) → the fuse box (the power only with all four in) → the crank's rhythm game (good presses wind
//   the shutter up, bad ones and missed turns slip it back, never below 0 or above 1; badly timed or too frequent
//   presses don't count as turns; two players wind about twice as fast; the brake without power) → the lift.
//   Alone it can be finished on every difficulty. And: escaping Level 0 carries straight on into Level 1.
//   node check_gar_order.mjs
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const { GAR_LEVELS, crankRule, FUSES } = await import('./garmap.js');
let bad = 0;
const ok = (c, t) => { if (!c) { bad++; console.log('  FAIL', t); } };

function game(level, names) {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m, to: id }); }, practice: names.length === 1, ownerId: 'a', localId: null });
  names.forEach((n, i) => S.addPlayer('ab'[i], n));
  S.startBotGame({ kind: 'br', stage: 1, level });
  const brain = S.bots.get('monster');
  brain.update = () => {};                                   // (the creature stays out of this one…)
  const heard = []; brain.hearNoise = (x, z, range, y, loud) => { heard.push({ range, loud: !!loud, t: simNow }); };
  return { S, msgs, heard, plan: S.world.def.gar, P: names.map((n, i) => S.players.get('ab'[i])) };
}
const tick = (S, secs = 0.05) => { for (let t = 0; t < Math.round(secs * 20); t++) { simNow += 50; S.tick(); } };
const at = (p, o, dx = 0, dz = 0) => { p.x = o.x + dx; p.y = o.y; p.z = o.z + dz; };
const ringOf = (msgs, id) => [...msgs].reverse().find(m => m.t === 'crankRing' && m.to === id);
// let the game run until the mark of p's ring is next at `f` round the ring (a share: 0 … 1)
function waitPhase(S, p, f) {
  const R = S.garSt.rings.get(p.id), lapMs = R.lap * 1000;
  let k = Math.floor((simNow - R.t0) / lapMs);
  if (R.t0 + (k + f) * lapMs <= simNow + 1) k++;
  const tgt = R.t0 + (k + f) * lapMs;
  while (simNow < tgt - 1) { simNow = Math.min(tgt, simNow + 50); S.tick(); }
}
// wait until the next moment (host time) when this ring's mark is in the middle of its good arc, then press
function pressGood(S, p, ring, msgs) {
  const R = S.garSt.rings.get(p.id);
  const lapMs = R.lap * 1000, ph = (simNow - R.t0) / lapMs;
  let k = Math.floor(ph);
  const target = () => R.t0 + (k + R.zone + R.w / 2) * lapMs;
  if (target() <= simNow + 1 || R.scored.has(k)) k++;
  while (simNow < target() - 1) { simNow = Math.min(target(), simNow + 50); S.tick(); }
  S.receive(p.id, { t: 'crankTap' });
}

for (const [level, names] of [['easy', ['Ann']], ['normal', ['Ann', 'Ben']], ['hard', ['Ann', 'Ben']], ['easy', ['Ann', 'Ben']], ['normal', ['Ann']], ['hard', ['Ann']]]) {
  const { S, msgs, heard, plan, P } = game(level, names);
  const a = P[0], b = P[1], L = plan.lift, F = plan.fuse, st = S.garSt;
  const sh = S.world.doors.find(d => d.lock === 'shutter');
  const solo = names.length === 1;
  // ---- the fuses ----
  ok(st.fuses.length === FUSES && new Set(st.fuses.map(f => f.room)).size === FUSES, 'not four fuses in four different side rooms');
  ok(st.fuses.every(f => f.state === 0), 'a fuse is not in its room at the start');
  ok(S.startMsg().gar.fuses.length === FUSES && S.startMsg().gar.n === 0, 'the start message does not carry the fuses');
  // the lift and the crank before anything: nothing
  a.x = 3; a.y = L.y; a.z = 3; tick(S, 1);
  ok(!a.escaped, 'the lift took someone before the power and the shutter');
  at(a, plan.crank, 0, 0.7); S.receive('a', { t: 'crankOn' }); tick(S, 0.5);
  ok(!st.rings.size && msgs.some(m => m.t === 'toast' && /brake/.test(m.text)), 'the crank started without power (or no brake toast)');
  // the box with nothing in your hand, and a fuse from across the map
  at(a, F, 0, 0.8); S.receive('a', { t: 'fuseIn' }); ok(st.inBox === 0, 'the box took a fuse nobody had');
  const f0 = st.fuses[0]; at(a, plan.start); S.receive('a', { t: 'fuseTake', i: 0 }); ok(f0.state === 0, 'a fuse was taken from across the map');
  // take one; a second while carrying is refused
  const take = (p, i) => { const f = st.fuses[i]; p.x = f.x + 0.6; p.z = f.z; p.y = f.y >= 3.4 ? 3.4 : 0; S.receive(p.id, { t: 'fuseTake', i }); return f.state === 1 && f.holder === p.id; };
  ok(take(a, 0), 'could not take a fuse from its spot');
  ok(!take(a, 1), 'took a second fuse while carrying one');
  // the carrier is taken: the fuse goes back to its room
  S.monsterKill(S.players.get('monster'), a);
  ok(f0.state === 0 && f0.holder === null && msgs.some(m => m.t === 'fuseBack' && m.i === 0), 'the fuse did not go back to its room when its carrier was taken');
  ok(a.lives === 2, 'a take-over did not cost a life');
  tick(S, 7.5);
  ok(a.alive && Math.hypot(a.x - plan.start.x, a.z - plan.start.z) < 3, 'the taken player was not back in the start room after 7 s');
  // all four in, one at a time (the power only once the fourth is in)
  for (let i = 0; i < FUSES; i++) {
    const p = P[i % P.length];
    ok(take(p, i), `could not take fuse ${i}`);
    at(p, F, 0, 0.8); S.receive(p.id, { t: 'fuseIn' });
    ok(st.inBox === i + 1 && st.fuses[i].state === 2, `fuse ${i} did not go into the box`);
    ok(st.power === (i === FUSES - 1), `the power was ${st.power ? 'on' : 'off'} with ${i + 1} fuse(s) in`);
  }
  ok(new Set(msgs.filter(m => m.t === 'fuseIn').map(m => m.i)).size === FUSES && msgs.some(m => m.t === 'power'), 'no fuseIn / power messages');
  ok(S.startMsg().gar.n === FUSES && S.startMsg().gar.power, 'the start message does not carry the fuses in the box');
  // ---- the crank ----
  const R = crankRule(level, solo), turns = R.turns;
  at(a, plan.crank, 0, 0.7); S.receive('a', { t: 'crankOn' });
  const ring = ringOf(msgs, 'a');
  ok(ring && st.rings.has('a') && ring.turns === turns && Math.abs(ring.w - R.zone) < 1e-9, 'no ring at the crank (or wrong turns / arc)');
  ok(Math.abs(ring.zone - st.rings.get('a').zone) < 0.002, 'the ring the player sees is not the host\'s');
  // a press badly out of time at 0: a mistake, and it never goes below 0
  const Ra = st.rings.get('a'), off = (Ra.zone + Ra.w / 2 + 0.5) % 1;      // (the far side of the ring from the bright arc)
  waitPhase(S, a, off); S.receive('a', { t: 'crankTap' });
  ok(st.crank === 0 && msgs.some(m => m.t === 'crankTap' && m.to === 'a' && m.ok === 0) && msgs.some(m => m.t === 'crankSlip' && m.id === 'a'), 'a badly timed press was not a mistake (or went below 0)');
  // good presses: each one a turn
  for (let k = 0; k < 3; k++) pressGood(S, a, ring, msgs);
  ok(Math.abs(st.crank - 3 / turns) < 0.011, `three good presses gave ${st.crank} (want ${3 / turns})`);
  ok(msgs.filter(m => m.t === 'crankTap' && m.to === 'a' && m.ok === 1).length === 3, 'good presses were not answered with crankTap ok');
  // a press that waited 0.1 s for a busy frame on the player's screen still counts (it says so: ago); a claimed wait
  // is never more than 0.12 s, so a press 0.3 s after the arc claiming 0.3 s is still a mistake
  { const Rg = st.rings.get('a'), lapMs = Rg.lap * 1000; let k = Math.floor((simNow - Rg.t0) / lapMs); if (Rg.t0 + (k + Rg.zone + Rg.w / 2) * lapMs <= simNow + 1 || Rg.scored.has(k)) k++;
    const mid = Rg.t0 + (k + Rg.zone + Rg.w / 2) * lapMs; while (simNow < mid + 100 - 1) { simNow = Math.min(mid + 100, simNow + 50); S.tick(); }
    const cb = st.crank; S.receive('a', { t: 'crankTap', ago: 100 }); ok(Math.abs(st.crank - cb - 1 / turns) < 0.011, `a press held back 0.1 s by a busy frame did not count (${(st.crank - cb).toFixed(3)})`); }
  { const Rg = st.rings.get('a'), lapMs = Rg.lap * 1000; let k = Math.floor((simNow - Rg.t0) / lapMs); if (Rg.t0 + (k + Rg.zone + Rg.w / 2) * lapMs <= simNow + 1 || Rg.scored.has(k)) k++;
    const end = Rg.t0 + (k + Rg.zone + Rg.w) * lapMs; while (simNow < end + 300 - 1) { simNow = Math.min(end + 300, simNow + 50); S.tick(); }
    const cb = st.crank; S.receive('a', { t: 'crankTap', ago: 300 }); ok(st.crank < cb, 'a press 0.3 s late claiming a 0.3 s wait counted as a turn'); }
  for (let k = 0; k < 2; k++) pressGood(S, a, ring, msgs);
  // a press straight after a good one (too soon): no turn, no mistake
  const c1 = st.crank; simNow += 60; S.receive('a', { t: 'crankTap' }); ok(st.crank === c1, 'a too-frequent press counted');
  // a bad press slips one turn back (gentler alone); a missed turn half that
  const loudBefore = heard.filter(h => h.loud).length;
  waitPhase(S, a, off);
  const c2 = st.crank; S.receive('a', { t: 'crankTap' });
  ok(Math.abs((c2 - st.crank) - R.slip / turns) < 0.011, `a bad press slipped ${(c2 - st.crank).toFixed(3)} (want ${(R.slip / turns).toFixed(3)})`);
  tick(S, 1.2); ok(heard.filter(h => h.loud && h.range === 35).length > loudBefore, 'a mistake was not heard from 35 m');
  const c3 = st.crank; tick(S, R.lap * 2.2);
  const miss = c3 - st.crank;
  ok(miss > 0 && Math.abs(miss / Math.round(miss / (0.5 * R.slip / turns)) - 0.5 * R.slip / turns) < 0.011, `missed turns slipped ${miss.toFixed(3)}`);
  // walk away: the ring goes, the shutter stays where it was left
  a.x += 4; tick(S, 0.2); ok(!st.rings.has('a'), 'the ring stayed open away from the crank');
  const c4 = st.crank; tick(S, 3); ok(st.crank === c4, 'the shutter moved with nobody at the crank');
  // the monster is told about the crank while anyone cranks
  ok(heard.some(h => h.range === 26), 'the creature was not told about the crank');
  // wind it all the way: alone, or both together (about twice as fast)
  at(a, plan.crank, 0, 0.7); S.receive('a', { t: 'crankOn' });
  if (b) { at(b, plan.crank, 0.8, 0.7); S.receive('b', { t: 'crankOn' }); }
  const t0 = simNow, start = st.crank;
  let presses = 0;
  while (!sh.open && presses < 400) {
    pressGood(S, a, null, msgs); presses++;
    if (b && !sh.open && st.rings.has('b')) { const Rb = st.rings.get('b'), Ra = st.rings.get('a'); if (Ra) { /* b presses in its own ring's arc */ const lapMs = Rb.lap * 1000; let k = Math.floor((simNow - Rb.t0) / lapMs); if (Rb.t0 + (k + Rb.zone + Rb.w / 2) * lapMs <= simNow + 1 || Rb.scored.has(k)) k++; const tb = Rb.t0 + (k + Rb.zone + Rb.w / 2) * lapMs; if (tb < simNow + Ra.lap * 1000) { while (simNow < tb - 1) { simNow = Math.min(tb, simNow + 50); S.tick(); } S.receive('b', { t: 'crankTap' }); } } }
  }
  const secs = (simNow - t0) / 1000, want = (1 - start) * GAR_LEVELS[level].crank / (b ? 2 : 1);
  ok(sh.open && st.crank === 1, `the shutter did not open (crank ${st.crank}, ${presses} presses, rings ${[...st.rings.keys()]}, a at the crank: ${S.nearCrank(a)}, alive ${a.alive})`);
  ok(secs < want * 1.35 + R.lap * 2 && secs > want * 0.6, `winding the rest took ${secs.toFixed(1)} s (expected about ${want.toFixed(1)} s)`);
  ok(st.crank <= 1 && !st.rings.size, 'past the top, or rings left open');
  S.receive('a', { t: 'crankTap' }); ok(st.crank === 1, 'the crank went past the top');
  // into the lift
  a.x = 3; a.y = L.y; a.z = 3; tick(S, 0.5);
  ok(a.escaped && msgs.some(m => m.t === 'escaped' && m.lift), 'the lift did not take the player');
  if (b) { ok(S.phase === 'br', 'the game ended with someone still inside'); b.x = 2; b.y = L.y; b.z = 2; tick(S, 0.5); ok(b.escaped, 'the second player could not take the lift'); }
  tick(S, 11);
  const over = msgs.find(m => m.t === 'over');
  ok(over && over.winner === 'escaped' && over.reason === 'all' && over.map === 'garage', 'no "everyone escaped" result');
  console.log(`${level}, ${names.length} player${b ? 's' : ''}: ${turns} turns (${R.lap} s a trip, arc ${(R.zone * 100).toFixed(0)} %), the rest wound in ${secs.toFixed(1)} s (${b ? 'two' : 'one'} cranking)`);
}

// ---- two players wind about twice as fast as one ----
{
  const time = (names) => {
    const { S, plan, P } = game('normal', names), st = S.garSt;
    st.power = true; st.inBox = FUSES;
    for (const [i, p] of P.entries()) { at(p, plan.crank, i * 0.8, 0.7); S.receive(p.id, { t: 'crankOn' }); }
    const t0 = simNow, sh = S.world.doors.find(d => d.lock === 'shutter');
    // everyone presses once per trip in their own arc
    for (let g = 0; g < 200000 && !sh.open; g++) {
      simNow += 10; S.tick();
      for (const p of P) { const R = st.rings.get(p.id); if (!R) continue; const ph = (simNow - R.t0) / 1000 / R.lap, k = Math.floor(ph); if (ph - k > R.zone + R.w / 2 && !R.scored.has(k)) S.receive(p.id, { t: 'crankTap' }); }
    }
    return (simNow - t0) / 1000;
  };
  const two = time(['Ann', 'Ben']);
  // (one: only Ann cranks, Ben stays away)
  const solo1 = (() => {
    const { S, plan, P } = game('normal', ['Ann', 'Ben']), st = S.garSt;
    st.power = true; st.inBox = FUSES;
    at(P[0], plan.crank, 0, 0.7); S.receive('a', { t: 'crankOn' });
    const t0 = simNow, sh = S.world.doors.find(d => d.lock === 'shutter');
    for (let g = 0; g < 200000 && !sh.open; g++) { simNow += 10; S.tick(); const R = st.rings.get('a'); if (!R) continue; const ph = (simNow - R.t0) / 1000 / R.lap, k = Math.floor(ph); if (ph - k > R.zone + R.w / 2 && !R.scored.has(k)) S.receive('a', { t: 'crankTap' }); }
    return (simNow - t0) / 1000;
  })();
  ok(solo1 / two > 1.6 && solo1 / two < 2.5, `two players wound it in ${two.toFixed(1)} s, one in ${solo1.toFixed(1)} s (not about twice as fast)`);
  console.log(`one player cranking: ${solo1.toFixed(1)} s; two together: ${two.toFixed(1)} s`);
}

// ---- a not-so-good player alone still gets there (4 good presses in 5, every difficulty) ----
for (const level of ['easy', 'normal', 'hard']) {
  const { S, plan, P } = game(level, ['Ann']), st = S.garSt;
  st.power = true; st.inBox = FUSES;
  at(P[0], plan.crank, 0, 0.7); S.receive('a', { t: 'crankOn' });
  const t0 = simNow, sh = S.world.doors.find(d => d.lock === 'shutter');
  let n = 0, low = 1;
  for (let g = 0; g < 400000 && !sh.open; g++) {
    simNow += 10; S.tick();
    const R = st.rings.get('a'); if (!R) break;
    const ph = (simNow - R.t0) / 1000 / R.lap, k = Math.floor(ph);
    if (ph - k > R.zone + R.w / 2 && !R.scored.has(k) && R.tried !== k) { R.tried = k; n++; if (n % 5 === 0) { simNow += Math.round(R.lap * 400); S.receive('a', { t: 'crankTap' }); } else S.receive('a', { t: 'crankTap' }); }
    low = Math.min(low, st.crank);
  }
  ok(sh.open, `${level}: a player alone pressing 4 in 5 right never opened the shutter`);
  ok(low >= 0, `${level}: the shutter went below 0`);
  console.log(`${level}, alone, 4 good presses in 5: the shutter is up after ${((simNow - t0) / 1000).toFixed(1)} s`);
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
    ok(S.bots.get('monster').constructor.name === 'ShifterBrain', "Level 1 does not have its own creature");
    const gs = msgs.filter(m => m.t === 'start' && m.map === 'garage').pop();
    ok(gs && gs.gar && gs.gar.fuses.length === FUSES, 'the Level 1 start message has no fuses');
  } else ok(!S.gar && msgs.some(m => m.t === 'over' && m.winner === 'escaped'), 'without Level 1 the game should end at the exit');
  console.log(l1 ? 'Level 0 exit → Level 1: carried on, both alive' : 'no Level 1 for this host: the game ends at the exit');
}
console.log(bad ? `${bad} problem(s)` : "Level 1's order: all checks passed");
process.exit(bad ? 1 : 0);
