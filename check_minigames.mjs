// Checks the Minigames on the real host code (server.js + mghost.js) with pretend players and no graphics:
//   - the arena: the court and the pool can be reached from their spawns, nobody can cross the low wall, the goals'
//     posts narrow the mouth to 3 m (4 m for a big goal);
//   - Floatie Dodgeball: a thrown floatie that hits someone before it touches anything puts them out; one that has
//     bounced, or lies on the floor, doesn't; a catch (E just before, or just after, it reaches you) puts the thrower
//     out and leaves you holding it; too late is out; teammates aren't hit; the last one in wins (places and points);
//   - Keep Away: a point a second while you hold it; a touch steals it; the one who lost it can't take it back for
//     2 s (then can); throwing it away; the most points after 2 minutes wins;
//   - Hot Potato: it starts with someone; a touch passes it, not again within 1 s; after 20 s it pops: the holder is
//     out and a new fuse starts with someone else; the last one in wins;
//   - Pool Ball: teams; a goal (only inside the posts, not while held) scores for the other team, the ball goes back to
//     the middle and waits; on the deck it goes back too; first to 3; uneven teams: online the smaller team's target is
//     wider, in Practice a bot evens them up (and gets no points);
//   - Volleyball (in the Minigames and in its own mode): the court and net are the same on the Pool Hall and all three
//     Volleyball maps, flat and clear; the serve (only the server hits the toss, a missed toss is tossed again once, then
//     it is a point), hits only in reach and on your own side, a ball landing in scores for the other side, out / under
//     the net / round a post / a 4th touch / the same player twice are points for the other team, the net sends it back,
//     the winner of a rally serves (a new server when the serve changes sides), sets to 11 with a lead of 2 (15 at most),
//     the spike, the lift over the net; uneven teams online: the smaller team touches 4 times and serves first; the
//     Volleyball mode: fixed teams, best of 3 ends at 2 sets, the over message's sets and teams, Practice evens the bots;
//   - a party run: 5 rounds, never the same game twice in a row, the points add up, the final standings; a single game
//     for its number of rounds; room size 6; a friend who joins during a round watches until the next one; the first
//     round waits for everyone to load (at most 15 s).
// Usage: node check_minigames.mjs
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const { World, PLAYER_RADIUS } = await import('./world.js');
const { resolveMap } = await import('./maps.js');
const { POOL } = await import('./poolmap.js');
const { ARENA, MG_GAMES, MG_POINTS, mgSpawns, setGoalPosts } = await import('./mgmap.js');
const { MG } = await import('./mghost.js');

const { G, WY } = POOL;
let bad = 0, checks = 0;
const ok = (c, t) => { checks++; if (!c) { bad++; console.log('  FAIL', t); } };

// ---------- the arena ----------
{
  const w = new World(resolveMap('arena'));
  const reach = (from, swim) => {
    const seen = new Set(), q = [[Math.floor(from.x * 2), Math.floor(from.z * 2)]], y = swim ? WY - POOL.swim : G;
    const free = (ix, iz) => { const x = ix / 2 + 0.25, z = iz / 2 + 0.25; return (!swim || w.bodyAt(x, z)) && !w.blocked(x, z, PLAYER_RADIUS, y, swim ? 0.05 : 0.42); };
    while (q.length) { const [ix, iz] = q.pop(), k = iz * 1000 + ix; if (seen.has(k) || !free(ix, iz)) continue; seen.add(k); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) q.push([ix + dx, iz + dz]); }
    return seen;
  };
  const court = reach({ x: ARENA.court.cx, z: ARENA.court.cz }, false);
  ok(court.size > 600, `the court is too small to walk about (${court.size} cells)`);
  ok(![...court].some(k => (k % 1000) / 2 > ARENA.divider.x0), 'you can walk from the court past the low wall');
  for (const s of mgSpawns('court', false).concat(mgSpawns('court', true))) ok(court.has(Math.floor(s.z * 2) * 1000 + Math.floor(s.x * 2)), `a court spawn (${s.x}, ${s.z}) can't be stood on`);
  ok(ARENA.divider.h > 1.4, 'the low wall can be jumped');
  const pool = reach({ x: ARENA.pool.cx, z: ARENA.pool.cz }, true);
  for (const s of mgSpawns('pool', true)) ok(pool.has(Math.floor(s.z * 2) * 1000 + Math.floor(s.x * 2)) && w.bodyAt(s.x, s.z), `a pool spawn (${s.x}, ${s.z}) is not in the water`);
  ok([...pool].some(k => (k % 1000) / 2 < ARENA.goals[0].line) && [...pool].some(k => (k % 1000) / 2 > ARENA.goals[1].line), 'you can\'t swim into the goal alcoves');
  // the posts: 3 m between them normally, 4 m for a big goal
  const g = ARENA.goals[0], postAt = (z) => w.cellSpans(Math.floor((g.line - 0.25) * 2), Math.floor(z * 2)).some(s => s.m === '_post');
  ok(postAt(g.z0 + 0.25) && postAt(g.z1 - 0.25) && !postAt(9), 'the goal posts are not where they should be');
  setGoalPosts(w, 0, true); ok(!postAt(g.z0 + 0.25) && !postAt(g.z1 - 0.25), 'a big goal still has its posts in the mouth');
  setGoalPosts(w, 0, false); ok(postAt(g.z0 + 0.25), 'the posts did not come back');
}

// ---------- the host ----------
const mkRoom = (names, settings = {}) => {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: null });
  names.forEach((n, i) => S.addPlayer(String.fromCharCode(97 + i), n));
  S.receive('a', { t: 'settings', mode: 'mg', ...settings });
  return { S, msgs };
};
const runFor = (S, secs, each) => { for (let t = 0; t < secs * 20; t++) { simNow += 50; if (each) each(); S.tick(); } };
const put = (p, x, z, y = G) => { p.x = x; p.y = y; p.z = z; };
const begin = (S) => { for (const p of S.humans()) S.receive(p.id, { t: 'mgReady' }); runFor(S, MG.intro + 0.1); };
const H = (S) => S.mgHost;
const yawTo = (p, x, z) => Math.atan2(-(x - p.x), -(z - p.z));
// spread everyone round the edge of the court, far from each other
const spread = (S) => { const ps = H(S).players(); ps.forEach((p, i) => { const a = i / ps.length * Math.PI * 2; put(p, ARENA.court.cx + Math.cos(a) * 6, ARENA.court.cz + Math.sin(a) * 5.5); }); };

// ----- Dodgeball -----
{
  const { S, msgs } = mkRoom(['Ann', 'Ben', 'Cal'], { mgRun: 'single', mgGame: 'dodge', mgRounds: 1 });
  ok(S.roomMax() === 6, `the Minigames room takes ${S.roomMax()} players (should be 6)`);
  S.receive('a', { t: 'startMatch' });
  ok(S.phase === 'mg' && H(S) && H(S).game === 'dodge', 'the Minigames did not start from the lobby');
  ok(H(S).stage === 'wait', 'the first round did not wait for everyone to load');
  ok(msgs.some(m => m.id === 'c' && m.t === 'start' && m.mode === 'mg' && m.mg), 'the start message does not carry the Minigames');
  S.receive('a', { t: 'mgReady' }); S.receive('b', { t: 'mgReady' });
  ok(H(S).stage === 'wait', 'the round started before everyone was ready');
  S.receive('c', { t: 'mgReady' });
  ok(H(S).stage === 'intro', 'the round did not start once everyone was ready');
  runFor(S, MG.intro + 0.1);
  ok(H(S).stage === 'play', 'the countdown did not end in the game');
  const [a, b, c] = ['a', 'b', 'c'].map(id => S.players.get(id));
  spread(S);
  ok(H(S).rings.filter(r => r.mode !== 'lost').length >= 2, 'Dodgeball has fewer than two floaties');
  // a picks one up
  const r0 = H(S).rings[0];
  put(a, r0.x + 1, r0.z);
  S.receive('a', { t: 'ring' });
  ok(r0.holder === 'a', 'a floatie in reach could not be picked up');
  S.receive('a', { t: 'ring' });
  ok(H(S).rings.filter(r => r.holder === 'a').length === 1, 'someone could hold two floaties');
  // a throws at b (4 m away), who doesn't catch: b is out
  const throwAt = (from, to, pitch = 0.08) => S.receive(from.id, { t: 'throw', yaw: yawTo(from, to.x, to.z), pitch });
  put(a, 6, 9); put(b, 10, 9); put(c, 6, 14);
  throwAt(a, b);
  ok(r0.mode === 'fly' && r0.live && r0.by === 'a', 'a thrown floatie is not live');
  runFor(S, 1);
  ok(!b.alive && b.mgOut, 'a live floatie hit someone and they were not put out');
  ok(msgs.some(m => m.t === 'kill' && m.victim === 'b' && m.w === 'mg' && m.how === 'hit'), 'no "out" message for the hit');
  ok(!r0.live, 'the floatie stayed live after hitting someone');
  ok(H(S).outOrder[0] === 'b', 'the hit was not recorded in the order people went out');
  // a bounced floatie is safe: throw it at the north wall, then stand in its way once it has bounced
  r0.holder = 'a'; r0.mode = 'held'; put(a, 6, 4); put(c, 12, 14);
  S.receive('a', { t: 'throw', yaw: 0, pitch: 0.1 });      // (straight north: the wall at z 2)
  let bounced = false;
  for (let k = 0; k < 40 && !bounced; k++) { runFor(S, 0.05); if (!r0.live && r0.mode === 'fly') bounced = true; }
  ok(bounced, 'the floatie never bounced off the wall');
  if (bounced) { put(c, r0.x + r0.vx * 0.12, r0.z + r0.vz * 0.12, Math.max(G, r0.y - 1)); runFor(S, 1); ok(c.alive, 'a floatie that had bounced off a wall put someone out'); }
  // a floatie lying on the floor is safe to touch
  const r1 = H(S).rings[1];
  if (r1.mode !== 'rest') { r1.mode = 'rest'; r1.y = G; r1.holder = null; }
  put(c, r1.x, r1.z); runFor(S, 1);
  ok(c.alive, 'walking over a floatie on the floor put someone out');
  // a catch: c presses E just before it reaches them: a is out, c holds it
  r0.holder = 'a'; r0.mode = 'held'; r0.live = false; put(a, 6, 9); put(c, 10, 9);
  throwAt(a, c);
  runFor(S, 0.1);
  S.receive('c', { t: 'ring' });
  for (let k = 0; k < 20 && a.alive && c.alive; k++) runFor(S, 0.05);
  ok(c.alive && !a.alive, `a catch did not put the thrower out (thrower ${a.alive ? 'in' : 'out'}, catcher ${c.alive ? 'in' : 'out'})`);
  ok(r0.holder === 'c', 'the catcher does not hold the caught floatie');
  ok(msgs.some(m => m.t === 'mgfx' && m.k === 'catch' && m.id === 'c'), 'no catch message');
  // the last one in wins: c (Ann out second, Ben first): places 1, 2, 3 → 3, 2, 1 points
  runFor(S, 0.2);
  ok(H(S).stage === 'end', 'the round did not end with one player left');
  const res = new Map((H(S).results || []).map(o => [o.id, o]));
  ok(res.get('c') && res.get('c').place === 1 && res.get('c').pts === 3, 'the last one in did not come first with 3 points');
  ok(res.get('a') && res.get('a').place === 2 && res.get('a').pts === 2, 'the last one out did not come second with 2 points');
  ok(res.get('b') && res.get('b').place === 3 && res.get('b').pts === 1, 'the first one out did not come third with 1 point');
  runFor(S, MG.end + 0.2);
  ok(S.phase === 'over', 'a single game of one round did not end the match');
  const over = msgs.filter(m => m.t === 'over').pop();
  ok(over && over.mode === 'mg' && over.winner === 'c' && over.standings && over.standings[0].id === 'c' && over.standings[0].pts === 3, 'the final standings are wrong');
}
// a catch pressed just after the floatie reached you still counts; much later it doesn't
for (const [delay, catchIt] of [[0.05, true], [0.6, false]]) {
  const { S } = mkRoom(['Ann', 'Ben', 'Cal'], { mgRun: 'single', mgGame: 'dodge', mgRounds: 1 });
  S.receive('a', { t: 'startMatch' }); begin(S);
  const [a, b, c] = ['a', 'b', 'c'].map(id => S.players.get(id));
  const r = H(S).rings[0];
  put(a, 6, 9); put(b, 10, 9); put(c, 6, 14);
  Object.assign(r, { holder: 'a', mode: 'held' });
  S.receive('a', { t: 'throw', yaw: yawTo(a, 10, 9), pitch: 0.08 });
  for (let k = 0; k < 40 && !H(S).pending.length && b.alive; k++) runFor(S, 0.05);
  ok(H(S).pending.length === 1, 'the hit did not wait a moment for a late catch press');
  runFor(S, delay);
  S.receive('b', { t: 'ring' });
  runFor(S, 0.5);
  ok(catchIt ? b.alive && !a.alive : !b.alive && a.alive, catchIt ? 'a catch pressed just after the hit did not count' : 'a catch pressed long after the hit counted');
}
// team Dodgeball (4 players, host option): two teams, each on its own half; a floatie doesn't hit a teammate
{
  const { S } = mkRoom(['Ann', 'Ben', 'Cal', 'Dee'], { mgRun: 'single', mgGame: 'dodge', mgRounds: 1, mgTeams: true });
  S.receive('a', { t: 'startMatch' }); begin(S);
  const ps = H(S).players();
  ok(H(S).teams && ps.filter(p => p.team === 'atk').length === 2 && ps.filter(p => p.team === 'def').length === 2, 'team Dodgeball did not make two teams of two');
  ok(ps.every(p => (p.team === 'atk') === (p.x < ARENA.court.mid)), 'a team did not start on its own half');
  const [p1, p2] = ps.filter(p => p.team === 'atk');
  const r = H(S).rings[0];
  put(p1, 4, 6); put(p2, 4, 11);
  Object.assign(r, { holder: p1.id, mode: 'held' });
  S.receive(p1.id, { t: 'throw', yaw: yawTo(p1, 4, 11), pitch: 0.05 });
  runFor(S, 1);
  ok(p2.alive, 'a floatie put a teammate out');
}
// 3 players: no teams even with the option on
{
  const { S } = mkRoom(['Ann', 'Ben', 'Cal'], { mgRun: 'single', mgGame: 'dodge', mgRounds: 1, mgTeams: true });
  S.receive('a', { t: 'startMatch' }); begin(S);
  ok(!H(S).teams && H(S).players().every(p => p.team === 'ffa'), 'team Dodgeball was played with 3 players');
}

// ----- Keep Away -----
{
  const { S, msgs } = mkRoom(['Ann', 'Ben', 'Cal'], { mgRun: 'single', mgGame: 'keepaway', mgRounds: 1 });
  S.receive('a', { t: 'startMatch' }); begin(S);
  const [a, b, c] = ['a', 'b', 'c'].map(id => S.players.get(id));
  spread(S);
  const r = H(S).rings[0];
  put(a, r.x + 0.8, r.z); S.receive('a', { t: 'ring' });
  ok(r.holder === 'a', 'the Keep Away floatie could not be picked up');
  runFor(S, 3.05);
  ok(Math.floor(H(S).held.get('a') || 0) === 3, `3 s holding it gave ${Math.floor(H(S).held.get('a') || 0)} points (should be 3)`);
  // b touches a: b has it
  put(a, 8, 8); put(b, 8.6, 8); runFor(S, 0.1);
  ok(r.holder === 'b' && msgs.some(m => m.t === 'mgfx' && m.k === 'steal' && m.id === 'b'), 'a touch did not steal it');
  // a can't take it straight back (2 s), then can
  runFor(S, 1.2);
  ok(r.holder === 'b', 'the one who lost it took it straight back');
  S.receive('a', { t: 'ring' }); ok(r.holder === 'b', 'E took it straight back from the holder');
  runFor(S, 1.0);
  ok(r.holder === 'a', 'after 2 s a touch did not take it back');
  // throwing it away
  put(c, 3, 3);
  S.receive('a', { t: 'throw', yaw: 0, pitch: 0.4 });
  ok(!r.holder && r.mode === 'fly', 'the holder could not throw it away');
  ok(!r.live, 'a Keep Away throw was live (it is not Dodgeball)');
  // the most points after 2 minutes
  runFor(S, 2.5, () => { put(a, 3, 3); put(b, 15, 15); });
  ok(r.mode === 'rest', 'the thrown Keep Away floatie did not land');
  put(b, r.x + 0.5, r.z); S.receive('b', { t: 'ring' });
  ok(r.holder === 'b', 'b could not pick up the floatie a threw away');
  const before = H(S).held.get('b') || 0;
  runFor(S, MG_GAMES.keepaway.time + 2, () => { put(a, 3, 3); put(c, 15, 15); if (b.alive) put(b, 9, 14); });
  ok(H(S).stage === 'end' || H(S).stage === 'over' || S.phase === 'over', 'Keep Away did not end after 2 minutes');
  const res = new Map((H(S).results || []).map(o => [o.id, o]));
  ok(res.get('b') && res.get('b').place === 1, `the one with the most points did not win (b had ${Math.floor(H(S).held.get('b'))}, from ${Math.floor(before)})`);
}

// ----- Hot Potato -----
{
  const { S, msgs } = mkRoom(['Ann', 'Ben', 'Cal'], { mgRun: 'single', mgGame: 'potato', mgRounds: 1 });
  S.receive('a', { t: 'startMatch' }); begin(S);
  const P = (id) => S.players.get(id);
  const far = () => { const ps = H(S).players(); ps.forEach((p, i) => put(p, 4 + i * 5, 4 + i * 4)); };
  far();
  const h0 = H(S).hot.holder;
  ok(h0 && H(S).rings[0].holder === h0, 'the hot potato did not start with someone');
  ok(Math.abs(H(S).hot.fuse - MG.fuse) < 0.3, `the fuse is ${H(S).hot.fuse} s (should be 20)`);
  S.receive(h0, { t: 'throw', yaw: 0, pitch: 0 }); ok(H(S).rings[0].holder === h0, 'the hot potato could be thrown away');
  // a touch passes it; not on again within 1 s
  runFor(S, 1.1);
  const others = H(S).players().filter(p => p.id !== h0), x = others[0], y = others[1];
  put(x, P(h0).x + 0.7, P(h0).z); runFor(S, 0.1);
  ok(H(S).hot.holder === x.id, 'touching the holder did not pass it on');
  put(y, x.x + 0.7, x.z); put(P(h0), x.x - 0.7, x.z); runFor(S, 0.4);
  ok(H(S).hot.holder === x.id, 'it was passed on again within 1 s');
  runFor(S, 0.8);
  ok(H(S).hot.holder !== x.id, 'after 1 s a touch did not pass it on');
  // the fuse runs out: the holder pops and is out; a new fuse starts with someone else
  far();
  const holder = H(S).hot.holder, left = H(S).hot.fuse;
  runFor(S, left - 0.3, far);
  ok(P(holder).alive, 'the holder popped before the fuse ran out');
  runFor(S, 0.5, far);
  ok(!P(holder).alive && msgs.some(m => m.t === 'mgfx' && m.k === 'pop' && m.id === holder), 'the holder did not pop when the fuse ran out');
  for (let k = 0; k < 60 && !(H(S).hot && H(S).hot.holder); k++) runFor(S, 0.05, far);
  ok(H(S).hot && H(S).hot.holder && H(S).hot.holder !== holder && P(H(S).hot.holder).alive, 'no new fuse started with someone else');
  ok(H(S).hot && Math.abs(H(S).hot.fuse - MG.fuse) < 0.2, 'the new fuse is not 20 s');
  const second = H(S).hot.holder;
  runFor(S, MG.fuse + 0.5, far);
  ok(H(S).stage === 'end', 'Hot Potato did not end with one player left');
  const res = new Map((H(S).results || []).map(o => [o.id, o]));
  const last = H(S).players().find(p => p.alive);
  ok(last && res.get(last.id).place === 1 && res.get(second).place === 2 && res.get(holder).place === 3, 'Hot Potato places are wrong (the last one in first)');
  ok(res.get(last.id).pts === MG_POINTS[0] && res.get(second).pts === MG_POINTS[1] && res.get(holder).pts === MG_POINTS[2], 'Hot Potato points are wrong');
}

// ----- Pool Ball -----
{
  const { S, msgs } = mkRoom(['Ann', 'Ben', 'Cal', 'Dee'], { mgRun: 'single', mgGame: 'poolball', mgRounds: 1 });
  S.receive('a', { t: 'startMatch' }); begin(S);
  const ps = H(S).players();
  ok(ps.filter(p => p.team === 'atk').length === 2 && ps.filter(p => p.team === 'def').length === 2, 'Pool Ball did not make two teams of two');
  ok(ps.every(p => S.world.bodyAt(p.x, p.z) && p.y < WY - 1), 'Pool Ball players did not start in the water');
  ok(!H(S).big[0] && !H(S).big[1], 'even teams got a big goal');
  const r = H(S).rings[0], g0 = ARENA.goals[0];
  ok(r.mode === 'float' && Math.hypot(r.x - ARENA.pool.cx, r.z - ARENA.pool.cz) < 0.1, 'the ball does not start in the middle of the pool');
  // into the orange (atk) goal: blue scores; the ball goes back to the middle and waits
  Object.assign(r, { x: g0.line - 0.7, z: 9, y: WY, mode: 'float', vx: 0, vz: 0 });
  runFor(S, 0.1);
  ok(H(S).score.def === 1 && H(S).score.atk === 0, `a goal in the orange goal gave ${JSON.stringify(H(S).score)}`);
  ok(msgs.some(m => m.t === 'mgfx' && m.k === 'goal' && m.team === 'def'), 'no goal message');
  ok(Math.hypot(r.x - ARENA.pool.cx, r.z - ARENA.pool.cz) < 0.1, 'the ball did not go back to the middle after a goal');
  const swimmer = ps.find(p => p.team === 'atk');
  put(swimmer, r.x + 0.8, r.z, WY - POOL.swim); S.receive(swimmer.id, { t: 'ring' });
  ok(!r.holder, 'the ball could be picked up during the celebration');
  runFor(S, MG.goalPause + 0.2);
  S.receive(swimmer.id, { t: 'ring' });
  ok(r.holder === swimmer.id, 'the ball could not be picked up after the celebration');
  // carried into the goal: no goal (it has to be pushed or thrown in)
  put(swimmer, g0.line - 0.7, 9, WY - POOL.swim); runFor(S, 0.2);
  ok(H(S).score.def === 1 && H(S).score.atk === 0, 'carrying the ball into a goal scored');
  // outside the posts: not a goal
  r.holder = null; Object.assign(r, { x: g0.line - 0.8, z: g0.z0 + 0.3, y: WY, mode: 'float', vx: 0, vz: 0 });
  put(swimmer, 30, 13, WY - POOL.swim);
  runFor(S, 0.1);
  ok(H(S).score.def === 1, 'a ball beside the posts counted as a goal');
  // thrown onto the deck: back to the middle
  Object.assign(r, { x: 19.2, z: 3, y: G, mode: 'rest', vx: 0, vz: 0, holder: null });
  runFor(S, MG.outBack + 0.3);
  ok(Math.hypot(r.x - ARENA.pool.cx, r.z - ARENA.pool.cz) < 0.1 && r.mode === 'float', 'a ball on the deck did not go back to the middle');
  // a swimmer swimming into the ball pushes it
  runFor(S, 1.5);
  const sw = ps.find(p => p.team === 'def');
  put(sw, r.x + 1.6, r.z, WY - POOL.swim); sw.mgLx = sw.x; sw.mgLz = sw.z;
  const x0 = r.x;
  runFor(S, 1.2, () => { sw.x -= 2.6 * 0.05; });
  ok(r.x < x0 - 0.5, `swimming into the ball did not push it (moved ${(x0 - r.x).toFixed(2)} m)`);
  // first to 3
  for (let k = 0; k < 2; k++) { runFor(S, MG.goalPause + 0.2); Object.assign(r, { x: ARENA.goals[1].line + 0.7, z: 9, y: WY, mode: 'float', vx: 0, vz: 0, holder: null }); runFor(S, 0.1); }
  ok(H(S).score.atk === 2, `two goals in the blue goal gave orange ${H(S).score.atk}`);
  runFor(S, MG.goalPause + 0.2); Object.assign(r, { x: ARENA.goals[1].line + 0.7, z: 9, y: WY, mode: 'float', vx: 0, vz: 0, holder: null }); runFor(S, 0.1);
  ok(H(S).stage === 'end' && /Orange win 3–1/.test(H(S).text), `the first to 3 did not win (${H(S).text})`);
  const res = new Map((H(S).results || []).map(o => [o.id, o]));
  ok(ps.every(p => res.get(p.id).place === (p.team === 'atk' ? 1 : 3)), 'team places are wrong (winners share 1st, losers 3rd)');
}
// uneven teams online: the smaller team's target is wider
{
  const { S } = mkRoom(['Ann', 'Ben', 'Cal'], { mgRun: 'single', mgGame: 'poolball', mgRounds: 1 });
  S.receive('a', { t: 'startMatch' }); begin(S);
  const ps = H(S).players(), small = ps.filter(p => p.team === 'atk').length < ps.filter(p => p.team === 'def').length ? 'atk' : 'def';
  const i = ARENA.goals.findIndex(g => g.side !== small);
  ok(H(S).big[i] && !H(S).big[1 - i], `uneven teams: the wide goal is ${JSON.stringify(H(S).big)} (the smaller team, ${small}, should shoot at goal ${i})`);
  ok(ps.length === 3 && ![...S.players.values()].some(p => p.bot), 'online, a bot was added to even the teams');
  const r = H(S).rings[0], g = ARENA.goals[i];
  Object.assign(r, { x: g.line + g.dir * 0.8, z: g.z0 + 0.3, y: WY, mode: 'float', vx: 0, vz: 0 });
  runFor(S, 0.1);
  ok(H(S).score[small] === 1, 'a ball in the wide part of a big goal did not count');
}
// uneven teams in Practice: a bot evens them up, and gets no points
{
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: 'a' });
  S.addPlayer('a', 'Ann');
  S.startBotGame({ kind: 'mg', run: 'single', game: 'poolball', rounds: 2, count: 2, level: 'normal' });
  begin(S);
  const ps = H(S).players();
  ok(ps.length === 4 && ps.filter(p => p.team === 'atk').length === 2, 'Practice did not add a bot to even the Pool Ball teams');
  const sub = ps.find(p => p.mgSub);
  ok(sub && !H(S).standings().some(e => e.id === sub.id), 'the extra bot is in the standings');
  runFor(S, 200);
  ok(S.phase === 'over' || H(S).round === 2, 'the Practice Pool Ball game did not go on');
  ok(!H(S).standings().some(e => e.id === (sub && sub.id)), 'the extra bot got points');
}

// ----- a party run with bots, and a friend joining during it -----
{
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: 'a' });
  S.addPlayer('a', 'Ann');
  S.startBotGame({ kind: 'mg', run: 'party', count: 3, level: 'hard' });
  begin(S);
  const games = [H(S).game];
  let rd = 1, joined = false, roundPts = 0;
  for (let t = 0; t < 5000 && S.phase === 'mg'; t++) {
    runFor(S, 0.5, () => { const a = S.players.get('a'); if (a.alive && a.y > 2) { a.x = ARENA.court.cx; a.z = ARENA.court.z0 + 1; } });
    if (H(S).stage === 'end' && H(S).results && !H(S).results.counted) { H(S).results.counted = true; roundPts += H(S).results.filter(o => !H(S).table.get(o.id) || !H(S).table.get(o.id).sub).reduce((s, o) => s + o.pts, 0); }
    if (H(S).round !== rd) { rd = H(S).round; games.push(H(S).game); }
    if (!joined && H(S).stage === 'play' && rd === 2) {
      joined = true;
      S.addPlayer('z', 'Zed');
      const z = S.players.get('z');
      ok(!z.alive && z.mgLate, 'a friend who joined during a round was put straight in');
      ok(msgs.some(m => m.id === 'z' && m.t === 'start' && m.mode === 'mg'), 'a friend who joined got no start message');
    }
    if (joined === true && rd === 3 && H(S).stage === 'play') { const z = S.players.get('z'); ok(z && !z.mgLate && z.alive, 'the friend did not play from the next round'); joined = 'done'; }
  }
  ok(S.phase === 'over', 'the party run never ended');
  ok(games.length === 5, `the party run had ${games.length} rounds (should be 5)`);
  ok(games.every((g, i) => i === 0 || g !== games[i - 1]), `a game came twice in a row: ${games.join(', ')}`);
  ok(games.every(g => MG_GAMES[g]), 'an unknown game was played');
  const over = msgs.filter(m => m.t === 'over').pop();
  const total = over ? over.standings.reduce((s, e) => s + e.pts, 0) : -1;
  ok(over && over.mode === 'mg' && total === roundPts, `the final standings (${total} points) don't add up to the rounds' points (${roundPts})`);
  ok(over && over.standings.every((e, i) => i === 0 || e.pts <= over.standings[i - 1].pts), 'the final standings are not best first');
  console.log(`  party run: ${games.join(' → ')}; ${over ? over.standings.map(e => `${e.name} ${e.pts}`).join(', ') : ''}`);
  // play again (Practice): a new run
  S.receive('a', { t: 'restart' });
  ok(S.phase === 'mg' && H(S).round === 1, 'Play again did not start a new run');
}
// a single game of 3 rounds is 3 rounds of that game; someone leaving mid-round
{
  const { S } = mkRoom(['Ann', 'Ben', 'Cal'], { mgRun: 'single', mgGame: 'keepaway', mgRounds: 3 });
  S.receive('a', { t: 'startMatch' }); begin(S);
  const seen = [];
  for (let t = 0; t < 2000 && S.phase === 'mg'; t++) { runFor(S, 1); if (seen[seen.length - 1] !== H(S).round) seen.push(H(S).round); if (H(S).game !== 'keepaway') ok(false, 'a single game changed game'); }
  ok(S.phase === 'over' && seen.length === 3, `a single game of 3 rounds played ${seen.length}`);
}
{
  const { S } = mkRoom(['Ann', 'Ben'], { mgRun: 'party' });
  S.receive('a', { t: 'startMatch' }); begin(S);
  S.removePlayer('b');
  ok(S.phase === 'over', 'the match went on with one player left');
}
{
  // online alone: refused
  const { S, msgs } = mkRoom(['Ann'], { mgRun: 'party' });
  S.receive('a', { t: 'startMatch' });
  ok(S.phase === 'lobby' && msgs.some(m => m.t === 'toast' && /at least 2/.test(m.text)), 'the Minigames started online with one player');
}

// ----- Volleyball -----
{
  const { VB, courtOf, stepBall, hitVelocity, netAssist, clampSide, inCourt } = await import('./volley.js');
  const { VB_MAPS } = await import('./vbmaps.js');
  // the same court and net everywhere, flat and clear
  const defs = [['the Pool Hall', resolveMap('arena')], ...Object.keys(VB_MAPS).map(id => [id, resolveMap(id)])];
  const base = courtOf(defs[0][1]);
  for (const [name, def] of defs) {
    const c = courtOf(def), w = new World(def);
    ok(c && Math.abs(c.x1 - c.x0 - 12) < 1e-9 && Math.abs(c.z1 - c.z0 - 6) < 1e-9 && Math.abs((c.pz1 - c.pz0) - (base.pz1 - base.pz0)) < 1e-9, `${name}: the court is not the standard 12 × 6 m`);
    let bumpy = 0, low = 0;
    for (let x = c.area.x0 + 0.45; x < c.area.x1 - 0.4; x += 0.5) for (let z = c.area.z0 + 0.45; z < c.area.z1 - 0.4; z += 0.5) {
      if (w.blocked(x, z, 0.36, c.y, 0.05) || Math.abs(w.groundAt(x, z, 0.36, c.y + 0.3, 0.45) - c.y) > 0.01) bumpy++;
      if (inCourt(c, x, z) && w.ceilingAt(x, z, 0.1, c.y) < c.y + 7) low++;
    }
    ok(!bumpy, `${name}: ${bumpy} spots round the court are not flat, open floor`);
    ok(!low, `${name}: something hangs lower than 7 m over the court`);
    ok(c.area.x1 - c.x1 >= 1.4 && c.x0 - c.area.x0 >= 1.4 && c.area.z1 - c.z1 >= 2 && c.z0 - c.area.z0 >= 2, `${name}: too little room round the court`);
  }
  // a room playing Volleyball (pass the map for the Volleyball mode, none for the Minigames' Pool Hall)
  const vbRoom = (names, vbMap = null, sets = 1) => {
    const { S, msgs } = mkRoom(names, vbMap ? { mode: 'vb' } : { mgRun: 'single', mgGame: 'volley', mgRounds: 1 });
    if (vbMap) S.receive('a', { t: 'settings', map: vbMap, vbSets: sets });
    S.receive('a', { t: 'startMatch' }); begin(S);
    return { S, msgs, H: S.mgHost, V: () => S.mgHost.vb, c: S.mgHost.court };
  };
  // the pitch that lands a ball (from where it is now) nearest a spot, by flying it on the real ball physics
  const pitchFor = (S, c, b, yaw, tx, tz, spike = false) => {
    let best = 0, be = Infinity;
    for (let a = -0.35; a <= 1.25; a += 0.01) {
      const v = hitVelocity(yaw, a, spike), q = { ...b, vx: v[0], vy: v[1], vz: v[2] }, nv = spike ? v : netAssist(c, q, v);
      Object.assign(q, { vx: nv[0], vy: nv[1], vz: nv[2] });
      let ev = null;
      for (let k = 0; k < 400 && !(ev && ev.k !== 'cross' && ev.k !== 'net'); k++) ev = stepBall(S.world, c, q, 0.02);
      if (!ev || ev.k !== 'land') continue;
      const e = Math.hypot(ev.x - tx, ev.z - tz);
      if (e < be) { be = e; best = a; }
    }
    return best;
  };
  const yawTo = (p, x, z) => Math.atan2(-(x - p.x), -(z - p.z));
  const until = (S, f, secs = 6) => { for (let k = 0; k < secs * 20 && !f(); k++) runFor(S, 0.05); return f(); };
  // hit the ball onto (tx, tz) from where it is (the player must be in reach)
  const hitTo = (S, H, p, tx, tz) => { const b = H.vb.ball, yaw = yawTo(b, tx, tz); S.receive(p.id, { t: 'throw', yaw, pitch: pitchFor(S, H.court, b, yaw, tx, tz) }); };
  // a player stands under the ball (on their own side)
  const under = (p, b) => { p.x = b.x - 0.3 * Math.sign(b.x - 22); p.z = b.z; };

  {
    const { S, msgs, H, V, c } = vbRoom(['Ann', 'Ben', 'Cal', 'Dee'], 'sandbar');
    ok(S.phase === 'mg' && H.game === 'volley' && S.settings.map === 'sandbar', 'the Volleyball mode did not start on its map');
    const ps = H.players(), A = ps.filter(p => p.team === 'atk'), D = ps.filter(p => p.team === 'def');
    ok(A.length === 2 && D.length === 2, 'Volleyball did not make two teams of two');
    ok(ps.every(p => (p.team === 'atk') === (p.x < c.cx)), 'a team did not start on its own side of the net');
    const v = V(), server = S.players.get(v.server);
    ok(server && server.team === v.serving && v.rally === 'ready' && v.ball.mode === 2, 'the ball does not wait over the first server');
    // the toss: only the server may hit it
    until(S, () => V().rally === 'toss');
    ok(V().rally === 'toss' && V().ball.mode === 1 && V().ball.vy > 0, 'the serve was not tossed up');
    const mate = ps.find(p => p.team === server.team && p !== server), other = ps.find(p => p.team !== server.team);
    mate.x = V().ball.x - 0.2 * Math.sign(V().ball.x - c.cx); mate.z = V().ball.z;
    S.receive(mate.id, { t: 'throw', yaw: 0, pitch: 0.2 });
    ok(V().rally === 'toss', 'a teammate hit the server\'s toss');
    // a missed toss: tossed again once, then it is a point for the other team
    until(S, () => V().rally === 'dead');
    ok(V().score.atk + V().score.def === 0 && msgs.some(m => m.t === 'mgfx' && m.k === 'vretoss'), 'a missed toss was not tossed again');
    until(S, () => V().rally === 'toss'); until(S, () => V().rally === 'dead');
    const recv = server.team === 'atk' ? 'def' : 'atk';
    ok(V().score[recv] === 1 && V().why === 'serve', `missing the toss twice did not give the other team the point (${JSON.stringify(V().score)}, ${V().why})`);
    ok(V().serving === recv && S.players.get(V().server).team === recv, 'the point\'s team did not get the serve');
    // the new server: out of reach, a hit does nothing; in reach, it goes over and lands in: their point
    until(S, () => V().rally === 'toss');
    const sv = S.players.get(V().server), sgn = sv.team === 'atk' ? 1 : -1;
    const far = { x: sv.x, z: sv.z }; sv.x -= sgn * 3;
    S.receive(sv.id, { t: 'throw', yaw: 0, pitch: 0.2 });
    ok(V().rally === 'toss', 'a hit from out of reach counted');
    sv.x = far.x; sv.z = far.z;
    until(S, () => V().ball.vy < 0);
    const before = { ...V().score };
    hitTo(S, H, sv, c.cx + sgn * 3.5, c.cz);
    ok(V().rally === 'play' && V().touches === H.maxTouches(sv.team), 'the serve was not hit (or did not use up the serving side\'s touches)');
    // the receivers stand away: it lands in
    for (const p of ps) if (p.team !== sv.team) { p.x = c.cx + sgn * 5.5; p.z = c.area.z0 + 0.5; }
    until(S, () => V().rally === 'dead');
    ok(V().score[sv.team] === before[sv.team] + 1 && V().why === 'in', `a serve that landed in did not score (${JSON.stringify(V().score)}, ${V().why})`);
    ok(V().server === sv.id, 'the server changed though their team kept the serve');
    // a ball hit long, out of the court: a point for the other team
    until(S, () => V().rally === 'toss'); until(S, () => V().ball.vy < 0);
    hitTo(S, H, sv, c.x1 * (sgn > 0 ? 1 : 0) + c.x0 * (sgn > 0 ? 0 : 1) + sgn * 1.5, c.cz);
    const recvTeam = sv.team === 'atk' ? 'def' : 'atk', sc0 = V().score[recvTeam];
    until(S, () => V().rally === 'dead');
    ok(V().score[recvTeam] === sc0 + 1 && V().why === 'out', `a ball hit out did not give the other team the point (${V().why})`);
    ok(V().serving === recvTeam, 'the serve did not change sides');
    // the receiving side: 3 touches are fine, a 4th is a point for the other team; the same player twice too
    const rv = S.players.get(V().server);                  // (now the other team serves to sv's team)
    until(S, () => V().rally === 'toss'); until(S, () => V().ball.vy < 0);
    hitTo(S, H, rv, c.cx - Math.sign(rv.x - c.cx) * 3, c.cz);
    const mine = ps.filter(p => p.team === sv.team);
    // (a pass: almost straight up, a little towards the middle of their own side)
    const touch = (p) => { until(S, () => { const b = V().ball; return b.mode !== 1 || (b.vy < 0 && b.y < c.y + 2.4); }, 4); under(p, V().ball); S.receive(p.id, { t: 'throw', yaw: yawTo(V().ball, c.cx + Math.sign(p.x - c.cx) * 3, c.cz), pitch: 1.25 }); };
    until(S, () => Math.sign(V().ball.x - c.cx) === Math.sign(mine[0].x - c.cx) || V().rally === 'dead');
    touch(mine[0]); ok(V().side === sv.team && V().touches === 1, 'the first touch was not counted');
    touch(mine[1]); touch(mine[0]);
    ok(V().touches === 3 && V().rally === 'play', `three touches on a side were not allowed (${V().touches}, ${V().rally})`);
    const sc1 = V().score[rv.team];
    touch(mine[1]);
    ok(V().score[rv.team] === sc1 + 1 && V().why === 'touches', `a 4th touch did not give the other team the point (${V().why})`);
    // the same player twice in a row
    until(S, () => V().rally === 'toss'); until(S, () => V().ball.vy < 0);
    const rv2 = S.players.get(V().server);
    hitTo(S, H, rv2, c.cx - Math.sign(rv2.x - c.cx) * 3, c.cz);
    until(S, () => Math.sign(V().ball.x - c.cx) === Math.sign(mine[0].x - c.cx) || V().rally === 'dead');
    touch(mine[0]);
    const sc2 = V().score[rv2.team];
    touch(mine[0]);
    ok(V().score[rv2.team] === sc2 + 1 && V().why === 'twice', `the same player touching twice was not a point for the other team (${V().why})`);
    // the net sends it back: hit straight into it from close
    until(S, () => V().rally === 'toss'); until(S, () => V().ball.vy < 0);
    const nv = S.players.get(V().server), ns = Math.sign(c.cx - nv.x), sc3 = V().score[nv.team === 'atk' ? 'def' : 'atk'];
    // (a flat ball at the net, 1.4 m up: into the mesh)
    Object.assign(V().ball, { x: c.cx - ns * 1.2, y: c.y + 1.4, z: c.cz, vx: ns * 8, vy: 0, vz: 0, mode: 1 }); V().rally = 'play'; V().lastTeam = nv.team; V().side = nv.team; V().touches = 1;
    until(S, () => V().rally === 'dead');
    ok(msgs.some(m => m.t === 'mgfx' && m.k === 'vnet') && V().why === 'in', `a ball into the net did not bounce back off it (${V().why})`);
    ok(V().score[nv.team === 'atk' ? 'def' : 'atk'] === sc3 + 1, 'a ball that went into the net and fell back did not give the other team the point');
    // under the net is a fault
    until(S, () => V().rally === 'toss');
    const uv = S.players.get(V().server), us = Math.sign(c.cx - uv.x), sc4 = V().score[uv.team === 'atk' ? 'def' : 'atk'];
    H.vbHit(uv, 0, 0); Object.assign(V().ball, { x: c.cx - us * 0.5, y: c.y + 0.5, z: c.cz, vx: us * 6, vy: 0, vz: 0, mode: 1 }); V().rally = 'play'; V().lastTeam = uv.team;
    until(S, () => V().rally === 'dead');
    ok(V().why === 'under' && V().score[uv.team === 'atk' ? 'def' : 'atk'] === sc4 + 1, `a ball under the net was not a point for the other team (${V().why})`);
    // nobody can stand on the other side
    const pp = { x: c.cx + 3, z: c.cz }; clampSide(c, 'atk', pp);
    ok(pp.x <= c.cx - 0.39, 'an Orange player could stand on Blue\'s side');
    // a set ends at 11 with a lead of 2, not at 11–10; at 15 whatever
    V().score.atk = 10; V().score.def = 10; H.vbPoint('atk', 'in'); runFor(S, 0.1);
    ok(H.stage === 'play', 'a set ended at 11–10');
    H.vbPoint('atk', 'in'); runFor(S, 0.1);
    ok(H.stage === 'end' || S.phase === 'over', 'a set did not end at 12–10');
    runFor(S, MG.end + 0.3);
    const over = msgs.filter(m => m.t === 'over').pop();
    ok(over && over.mode === 'mg' && over.vb && over.winner === 'atk' && over.vb.sets.length === 1 && over.vb.won[0] === 1 && over.vb.teams[0].length === 2, `the Volleyball mode's result is wrong: ${JSON.stringify(over && over.vb)}`);
  }
  {
    // the cap: 15 wins whatever the lead; the spike; the lift over the net
    const { S, H, V, c } = vbRoom(['Ann', 'Ben'], 'piazza');
    V().score.atk = 14; V().score.def = 14; H.vbPoint('def', 'in'); runFor(S, 0.1);
    ok(H.stage === 'end' || S.phase === 'over', 'a set did not end at 15–14');
  }
  {
    const { S, H, V, c } = vbRoom(['Ann', 'Ben'], 'summit');
    until(S, () => V().rally === 'toss'); until(S, () => V().ball.vy < 0);
    const p = S.players.get(V().server), sgn = Math.sign(c.cx - p.x), b = V().ball;
    // a spike: jumping (feet off the ground) at the net, looking down
    b.x = c.cx - sgn * 0.8; b.y = c.y + 2.9; b.z = c.cz; p.x = b.x - sgn * 0.2; p.z = b.z; p.y = c.y + 0.9;
    S.receive(p.id, { t: 'throw', yaw: yawTo(p, c.cx + sgn, c.cz), pitch: -0.5 });
    ok(V().ball.vy < -3 && Math.hypot(V().ball.vx, V().ball.vz) > 7, `a jump hit at the net looking down was not a spike (${V().ball.vx.toFixed(1)}, ${V().ball.vy.toFixed(1)})`);
    // the lift: a low, flat hit towards the net clears it
    const q = { x: c.cx - sgn * 3, y: c.y + 0.8, z: c.cz, vx: 0, vy: 0, vz: 0 };
    const v0 = hitVelocity(yawTo(q, c.cx + sgn, c.cz), 0), v1 = netAssist(c, q, v0);
    const t = (c.cx - q.x) / v1[0], y = q.y + v1[1] * t - 0.5 * VB.g * t * t;
    ok(y > c.y + VB.netTop, `a low flat hit was not lifted over the net (${y.toFixed(2)} at the net)`);
  }
  {
    // uneven teams online: the smaller team touches 4 times and serves first
    const { H, V } = vbRoom(['Ann', 'Ben', 'Cal'], 'sandbar');
    const small = ['atk', 'def'].find(t => H.players().filter(p => p.team === t).length === 1);
    ok(small && H.vbExtra === small && H.maxTouches(small) === 4 && H.maxTouches(small === 'atk' ? 'def' : 'atk') === 3, 'the smaller team does not get a 4th touch');
    ok(V().serving === small, 'the smaller team does not serve first');
    ok(H.players().length === 3, 'online, a bot was added to the Volleyball teams');
  }
  {
    // the Volleyball mode: best of 3 ends at 2 sets; the same teams in every set
    const { S, msgs, H, V } = vbRoom(['Ann', 'Ben', 'Cal', 'Dee'], 'piazza', 3);
    const teams = H.players().map(p => p.id + p.team).join();
    for (let k = 0; k < 2; k++) {
      V().score.atk = 10; V().score.def = 3; H.vbPoint('atk', 'in');
      runFor(S, MG.end + MG.board + 0.5);
      if (S.phase === 'mg') { begin(S); ok(H.players().map(p => p.id + p.team).join() === teams, 'the teams changed between sets'); }
    }
    ok(S.phase === 'over', 'best of 3 did not end after one team won 2 sets');
    const over = msgs.filter(m => m.t === 'over').pop();
    ok(over && over.vb && over.vb.won.join() === '2,0' && over.winner === 'atk', `best of 3: the result is ${JSON.stringify(over && over.vb)}`);
  }
  {
    // Practice: the bots even the teams; a whole bot-only set gets played to the end
    const msgs = [];
    const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push({ id, ...m }); }, practice: false, ownerId: 'a', localId: 'a' });
    S.addPlayer('a', 'Ann');
    S.startBotGame({ kind: 'vb', map: 'summit', sets: 1, count: 2, level: 'normal' });
    begin(S);
    const ps = S.mgHost.players();
    ok(ps.length === 4 && ps.filter(p => p.team === 'atk').length === 2, `Practice Volleyball did not even the teams (${ps.length} players)`);
    let hits = 0;
    for (let t = 0; t < 600 * 20 && S.phase === 'mg'; t++) { simNow += 50; S.tick(); const a = S.players.get('a'); if (a.alive) { a.x = a.team === 'atk' ? 12.6 : 31.4; a.z = 9.6; } }
    hits = msgs.filter(m => m.t === 'mgfx' && m.k === 'vhit').length;
    ok(S.phase === 'over' && hits > 10, `a bot set did not finish (phase ${S.phase}, ${hits} hits)`);
  }
  {
    // in the Minigames: the Pool Hall's court, one set, at most 4 minutes (then the most points; a draw shares)
    const { S, H, V } = vbRoom(['Ann', 'Ben']);
    ok(H.game === 'volley' && H.court && H.court.y === G, 'Volleyball in the Minigames is not on the Pool Hall\'s court');
    V().score.atk = 4; V().score.def = 4;
    runFor(S, MG_GAMES.volley.time + 1, () => { for (const p of H.players()) { p.x = p.team === 'atk' ? 2.6 : 16.4; p.z = 2.6; } V().score.atk = 4; V().score.def = 4; });
    ok(H.stage === 'end' || S.phase === 'over', 'Minigames Volleyball did not stop after 4 minutes');
    ok(/draw/.test(H.text) && H.results.every(r => r.place === 1), `a 4–4 set at the time limit was not a draw (${H.text})`);
  }
}

console.log(bad ? `\n${bad} of ${checks} checks FAILED` : `\nall ${checks} Minigames checks passed`);
process.exit(bad ? 1 : 0);
