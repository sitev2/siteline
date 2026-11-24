// Plays Level 1 (the garage) fast with no graphics and checks the thing in it (shifter.js): pretend players walk about
// (two of them together, one on their own), and it must
//   - only ever look like a real player in the game (never a made-up one when there are players to copy), and only
//     take a new look from someone it may copy (alive, inside); never stay in view of the one it copies;
//   - strike both in view of others and out of view; each take-over lasts ~3 s and it stands up as the victim;
//     it strikes again later; the victim loses a life and is back in the start room 7 s later;
//   - keep the teammate count on the HUD the same through a take-over;
//   - stay out of side rooms unless it is going for someone;
//   - alone (solo): be a made-up teammate (not the player's name) walking near you, strike the same way, the HUD
//     count shows 2.
//   node check_shifter.mjs [easy|normal|hard] [minutes = 40]
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const { sideRoomAt } = await import('./garmap.js');
const { EYE } = await import('./world.js');
const { SHIFTER } = await import('./shifter.js');
const [level = 'normal', mins = '40'] = process.argv.slice(2);
const bad = [];

// the teammate count a player's HUD shows (game.js does the same): everyone alive and inside, plus whoever it looks like
function hudCount(S) {
  const mon = S.players.get('monster'), parts = String(mon && mon.w || '').split(':');
  const ids = new Set([...S.players.values()].filter(q => !q.bot && q.alive && !q.escaped).map(q => q.id));
  const ident = parts[1] === 'take' ? parts[2] : parts[1] === 'copy' || parts[1] === 'form' ? parts[2] : null;
  if (ident && ident !== '~' && !(S.players.get(ident) || {}).escaped) ids.add(ident);
  return ids.size;
}

function play(names, label) {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push(m); }, practice: names.length === 1, ownerId: 'a', localId: null });
  names.forEach((n, i) => S.addPlayer('abc'[i], n));
  S.startBotGame({ kind: 'br', stage: 1, level });
  const plan = S.world.def.gar, nav = S.navGrid(), brain = S.bots.get('monster'), mon = S.players.get('monster');
  const ids = names.map((n, i) => 'abc'[i]);
  for (const id of ids) S.players.get(id).lives = 99;          // (so the run can go on: everyone comes back each time)
  S.brCheck = () => {};
  const walkers = ids.map((id, k) => ({ p: S.players.get(id), path: null, i: 0, speed: 2.7, k }));
  const solo = names.length === 1;
  const stat = { floors: new Set(), chaseFloors: new Set(), takes: 0, witnessed: 0, unwitnessed: 0, durations: [], seenByOrig: 0, seenRun: 0, maxSeenRun: 0, forms: 0, idents: new Set(), roomIdle: 0, maxRoomIdle: 0, near: [], countBad: 0, back: 0, backBad: 0, lives: 0 };
  let lastMode = '', take = null, prevIdent = null;
  for (let t = 0; t < +mins * 60 * 20; t++) {
    simNow += 50;
    // ---- the pretend players ----
    for (const w of walkers) {
      const p = w.p;
      if (!p.alive) { w.path = null; continue; }
      const chased = mon.use && Math.hypot(mon.x - p.x, mon.z - p.z) < 20;
      if (!w.path || w.i >= w.path.length || (chased && !w.fleeing)) {
        let goal;
        if (chased) { goal = nav.randomNode((x, y, z) => Math.hypot(x - mon.x, z - mon.z) > 25); w.fleeing = true; }
        else if (w.k === 1 && walkers[0].p.alive) { const q = walkers[0].p; goal = nav.nearest(q.x + 1.5, q.y, q.z + 1.5); }       // b keeps with a
        else if (w.k === 2 && Math.random() < 0.4) { const r = plan.rooms[Math.floor(Math.random() * plan.rooms.length)]; goal = nav.nearest((r.x0 + r.x1) / 2, r.floor ? plan.start.y : 0, (r.z0 + r.z1) / 2); }
        else goal = nav.randomNode();
        if (!chased) w.fleeing = false;
        w.path = nav.path(nav.nearest(p.x, p.y, p.z), goal, nav.n * 2) || []; w.i = 0;
        w.speed = chased ? 4.5 : w.k === 1 ? 2.9 : Math.random() < 0.2 ? 4.5 : 2.7;
      }
      const j = w.path[w.i];
      if (j == null) continue;
      const dx = nav.x[j] - p.x, dz = nav.z[j] - p.z, d = Math.hypot(dx, dz), stepLen = w.speed * 0.05;
      if (d < stepLen + 0.05) { p.x = nav.x[j]; p.z = nav.z[j]; p.y = nav.y[j]; w.i++; } else { p.x += dx / d * stepLen; p.z += dz / d * stepLen; p.y = nav.y[j]; p.yaw = Math.atan2(-dx, -dz); }
      S.world.doors.forEach((dr, i) => { if (!dr.open && !dr.lock && Math.hypot(dr.cx - p.x, dr.cz - p.z) < 1.2 && Math.abs((dr.y || 0) - p.y) < 1) S.toggleDoor(i, true, p); });
      // (the one on their own shuts the door behind them in a side room)
      const room = sideRoomAt(plan, p.x, p.y, p.z);
      if (w.k === 2 && room >= 0) S.world.doors.forEach((dr, i) => { if (dr.room === room && dr.open && Math.hypot(dr.cx - p.x, dr.cz - p.z) > 1.6) S.toggleDoor(i, false, p); });
    }
    const countBefore = hudCount(S);
    const aliveBefore = new Map(ids.map(id => [id, S.players.get(id).alive]));
    S.tick();
    // ---- what it did ----
    const parts = mon.w.split(':'), form = parts[1], id = parts[2];
    if (!Number.isFinite(mon.x + mon.y + mon.z)) { bad.push('position is not a number'); break; }
    // its look: only real players (or, alone, a made-up teammate that isn't the player's name)
    if (form === 'copy' || form === 'form') {
      if (id === '~') { if (t > 40) bad.push('it has no look'); }
      else if (id[0] === '~') { if (!solo) bad.push(`a made-up teammate (${id}) with real players to copy`); if (names.some(n => n.toLowerCase() === id.slice(1).toLowerCase())) bad.push('the made-up teammate has a real name'); }
      else if (!ids.includes(id)) bad.push(`it copies someone who is not a player: ${id}`);
      stat.idents.add(id);
    }
    if (form === 'form' && lastMode.split(':')[1] !== 'form') {
      stat.forms++;
      const q = S.players.get(id);
      if (q && (!q.alive || q.escaped)) bad.push(`it re-formed as someone it may not copy (${id})`);
    }
    // never in view of the one it copies (it reacts within moments: lunges, or gets out of sight)
    const orig = form === 'copy' && id[0] !== '~' ? S.players.get(id) : null;
    if (orig && orig.alive && brain.state === 'pretend' && !brain.forcing && brain.seenBy(orig, mon.x, mon.y, mon.z)) { stat.seenByOrig++; stat.seenRun++; stat.maxSeenRun = Math.max(stat.maxSeenRun, stat.seenRun); } else stat.seenRun = 0;
    // a take-over starting
    if (form === 'take' && lastMode.split(':')[1] !== 'take') {
      const v = S.players.get(id);
      const others = ids.map(k => S.players.get(k)).filter(q => q.id !== id && q.alive);
      const witness = others.some(q => Math.hypot(q.x - mon.x, q.z - mon.z) < 45 && S.world.los(q.x, q.y + EYE, q.z, mon.x, mon.y + 1.2, mon.z));
      take = { t0: simNow, id, witness, count: countBefore, lives: v ? v.lives : 0 };
      stat.takes++; if (witness) stat.witnessed++; else stat.unwitnessed++;
      if (v && aliveBefore.get(id) && v.alive) bad.push('the victim is still alive in a take-over');
      if (v && v.lives !== take.lives) stat.lives++;
    }
    if (!solo && take && form === 'take' && hudCount(S) !== take.count) stat.countBad++;       // (alone, the only one who could see it is the victim)
    if (take && form !== 'take') {
      const dur = (simNow - take.t0) / 1000;
      stat.durations.push(dur);
      if (!solo && id !== take.id) bad.push(`after the take-over it did not stand up as the victim (${id} instead of ${take.id})`);
      if (!solo && hudCount(S) !== take.count) stat.countBad++;
      const v = S.players.get(take.id);
      take.backAt = take.t0 + 7000; take.v = v;
      prevIdent = take; take = null;
    }
    // the victim back in the start room 7 s later
    if (prevIdent && simNow >= prevIdent.backAt + 150) {
      const v = prevIdent.v;
      if (v) { stat.back++; if (!v.alive || Math.hypot(v.x - plan.start.x, v.z - plan.start.z) > 3) stat.backBad++; else { const w = walkers.find(w => w.p === v); if (w) w.path = null; } }
      prevIdent = null;
    }
    if (solo && S.players.get('a').alive && (form === 'copy' || form === 'form') && hudCount(S) !== 2) stat.countBad++;
    if (solo && brain.state === 'pretend') { const a = S.players.get('a'); if (a.alive && Math.abs(a.y - mon.y) < 1) stat.near.push(Math.hypot(a.x - mon.x, a.z - mon.z)); }
    // side rooms: only when going for someone
    const room = sideRoomAt(plan, mon.x, mon.y, mon.z);
    if (room >= 0 && !brain.hunting() && !brain.revealed() && brain.state !== 'take') { stat.roomIdle++; stat.maxRoomIdle = Math.max(stat.maxRoomIdle, stat.roomIdle); } else stat.roomIdle = 0;
    stat.floors.add(mon.y > 1.7 ? 1 : 0);
    if (brain.state === 'chase') stat.chaseFloors.add(mon.y > 1.7 ? 1 : 0);
    lastMode = mon.w;
  }
  const forced = msgs.filter(m => m.t === 'door' && m.forced).length;
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const nearAvg = avg(stat.near.sort((a, b) => a - b).slice(0, Math.floor(stat.near.length * 0.5)));
  console.log(`${label}, level ${level}, ${mins} min: take-overs ${stat.takes} (${stat.witnessed} in view of others, ${stat.unwitnessed} unseen), re-formed ${stat.forms}×, looks ${[...stat.idents].join(' ')}`);
  console.log(`  take-over lasts ${stat.durations.length ? Math.min(...stat.durations).toFixed(2) + '–' + Math.max(...stat.durations).toFixed(2) : '–'} s; in view of the one it copies while pretending: ${(stat.seenByOrig / 20).toFixed(1)} s in all, longest ${(stat.maxSeenRun / 20).toFixed(2)} s`);
  console.log(`  floors visited ${[...stat.floors]}, chased on floors ${[...stat.chaseFloors]}, side-room doors forced ${forced}`);
  console.log(`  victims back in the start room: ${stat.back - stat.backBad}/${stat.back}; HUD count changed ${stat.countBad} times; longest in a side room while pretending ${(stat.maxRoomIdle / 20).toFixed(1)} s${solo ? `; walks with you at ~${nearAvg.toFixed(1)} m (nearer half)` : ''}`);
  if (stat.takes < 2) bad.push(`${label}: it struck only ${stat.takes} time(s)`);
  if (stat.floors.size < 2) bad.push(`${label}: it never changed floor`);
  if (!solo && !stat.witnessed) bad.push(`${label}: it never struck in view of the others`);
  if (!stat.unwitnessed) bad.push(`${label}: it never struck out of view`);
  if (stat.durations.some(d => d < SHIFTER.take - 0.1 || d > SHIFTER.take + 0.2)) bad.push(`${label}: a take-over did not last about ${SHIFTER.take} s`);
  if (stat.maxSeenRun > 12) bad.push(`${label}: it stayed in view of the one it copies for ${(stat.maxSeenRun / 20).toFixed(1)} s`);
  if (stat.countBad) bad.push(`${label}: the HUD teammate count changed ${stat.countBad} times`);
  if (stat.backBad) bad.push(`${label}: ${stat.backBad} victim(s) were not back in the start room after 7 s`);
  if (stat.lives) bad.push(`${label}: a life was not taken`);
  if (stat.maxRoomIdle > 20 * 25) bad.push(`${label}: it stayed in a side room a long time without going for anyone`);
  if (solo && !(nearAvg < 12)) bad.push(`${label}: the made-up teammate does not walk near you`);
  if (solo && ![...stat.idents].every(i => i[0] === '~')) bad.push(`${label}: alone, it looked like a real player for longer than the take-over`);
  if (!solo && [...stat.idents].some(i => i[0] === '~')) bad.push(`${label}: a made-up teammate in a game with players to copy`);
}

// hiding in a side room with the door shut is no escape: it walks up, forces the door (~1.5 s) and takes them
function hideInRoom() {
  const msgs = [];
  const S = new Server({ send: (id, m) => { if (m.t === 'door' && m.forced) msgs.push(m); }, practice: false, ownerId: 'a', localId: null });
  S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
  S.startBotGame({ kind: 'br', stage: 1, level });
  S.brCheck = () => {};
  const plan = S.world.def.gar, br = S.bots.get('monster'), a = S.players.get('a'), b = S.players.get('b');
  for (let t = 0; t < 60; t++) { simNow += 50; S.tick(); }
  const R = plan.rooms[2], di = S.world.doors.findIndex(d => d.room === 2);
  a.x = (R.x0 + R.x1) / 2 + 0.5; a.z = (R.z0 + R.z1) / 2; a.y = 0; b.x = 50; b.z = 10; b.y = plan.start.y;
  if (S.world.doors[di].open) S.toggleDoor(di, false, a);
  br.strikeAt = 0;
  let forcedAt = null, t0 = simNow;
  for (let t = 0; t < 20 * 90 && a.alive; t++) { simNow += 50; S.tick(); if (br.forcing && forcedAt == null) forcedAt = simNow; }
  const ok = !a.alive && msgs.length && S.world.doors[di].open;
  console.log(`a player hiding in a shut side room: ${ok ? `door forced, taken after ${((simNow - t0) / 1000).toFixed(1)} s` : 'NOT taken'}`);
  if (!ok) bad.push('it did not force a shut side-room door to take someone hiding inside');
}

hideInRoom();
play(['Ann', 'Ben', 'Cal'], '3 players');
play(['Ann', 'Ben'], '2 players');
play(['Mara'], 'solo');
console.log(bad.length ? 'PROBLEMS:\n  ' + [...new Set(bad)].join('\n  ') : 'The garage: all checks passed');
process.exit(bad.length ? 1 : 0);
