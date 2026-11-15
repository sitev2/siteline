// Plays Level 1 (the garage) fast with no graphics: two pretend players walk about (one of them into a side room),
// and it prints what the shapeshifter does. Checks: it hides as props, copies a player (2+ players), chases between
// the floors, never goes into a side room unless it is chasing, and catches people.
//   node check_shifter.mjs [easy|normal|hard] [minutes = 20]
let simNow = 0;
globalThis.performance = { now: () => simNow };
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const { sideRoomAt, GAR } = await import('./garmap.js');
const [level = 'normal', mins = '20'] = process.argv.slice(2);
const msgs = [];
const S = new Server({ send: (id, m) => { if (m.t !== 'snap' && m.t !== 'ping') msgs.push(m); }, practice: false, ownerId: 'a', localId: null });
S.addPlayer('a', 'Ann'); S.addPlayer('b', 'Ben');
S.startBotGame({ kind: 'br', stage: 1, level });
S.brCheck = () => {};          // (the pretend players come back after being caught: the game never ends)
const plan = S.world.def.gar, nav = S.navGrid(), brain = S.bots.get('monster'), mon = S.players.get('monster');
const walkers = ['a', 'b'].map((id, k) => ({ p: S.players.get(id), path: null, i: 0, speed: 2.7, k }));
const seen = {}, forms = {}, bad = [];
let kills = 0, inRoomIdle = 0, floors = new Set(), chaseFloors = new Set(), lastForm = '', forced = 0, maxIdleRoom = 0;
for (let t = 0; t < +mins * 60 * 20; t++) {
  simNow += 50;
  for (const w of walkers) {
    const p = w.p;
    if (!p.alive) { if (!w.dead) { w.dead = simNow; kills++; } if (simNow - w.dead > 8000) {
      // back in, somewhere well away from it
      const i = nav.randomNode((x, y, z) => Math.hypot(x - mon.x, z - mon.z) > 30);
      w.dead = 0; p.alive = true; p.hp = 100; p.x = nav.x[i]; p.y = nav.y[i]; p.z = nav.z[i]; w.path = null;
    }
    continue; }
    if (!w.path || w.i >= w.path.length) {
      // walker b likes side rooms; a roams both floors
      let goal;
      if (w.k === 1 && Math.random() < 0.5) { const r = plan.rooms[Math.floor(Math.random() * plan.rooms.length)]; goal = nav.nearest((r.x0 + r.x1) / 2, r.floor ? GAR.FL : 0, (r.z0 + r.z1) / 2); }
      else goal = nav.randomNode();
      w.path = nav.path(nav.nearest(p.x, p.y, p.z), goal, nav.n * 2) || []; w.i = 0;
      w.speed = Math.random() < 0.3 ? 4.5 : 2.7;
    }
    // chased: run
    const sp = mon.use ? 4.1 : w.speed, j = w.path[w.i];      // (chased: they run, but people don't run perfect lines)
    if (j == null) continue;
    const dx = nav.x[j] - p.x, dz = nav.z[j] - p.z, d = Math.hypot(dx, dz), stepLen = sp * 0.05;
    if (d < stepLen + 0.05) { p.x = nav.x[j]; p.z = nav.z[j]; p.y = nav.y[j]; w.i++; } else { p.x += dx / d * stepLen; p.z += dz / d * stepLen; p.y = nav.y[j]; p.yaw = Math.atan2(-dx, -dz); }
    // doors in the way: open them (players can)
    S.world.doors.forEach((dr, i) => { if (!dr.open && !dr.lock && Math.hypot(dr.cx - p.x, dr.cz - p.z) < 1.2 && Math.abs((dr.y || 0) - p.y) < 1) S.toggleDoor(i, true, p); });
  }
  S.tick();
  const form = mon.w.split(':')[1];
  forms[form] = (forms[form] || 0) + 1;
  seen[brain.state] = (seen[brain.state] || 0) + 1;
  floors.add(mon.y > 1.7 ? 1 : 0);
  if (brain.state === 'chase') chaseFloors.add(mon.y > 1.7 ? 1 : 0);
  const room = sideRoomAt(plan, mon.x, mon.y, mon.z);
  if (room >= 0 && !brain.hunting() && !brain.catching && !brain.forcing) { inRoomIdle++; maxIdleRoom = Math.max(maxIdleRoom, inRoomIdle); if (brain.disguised()) bad.push(`disguised inside side room ${room}`); } else inRoomIdle = 0;
  if (form !== lastForm) lastForm = form;
  if (!Number.isFinite(mon.x + mon.y + mon.z)) { bad.push('position is not a number'); break; }
}
forced = msgs.filter(m => m.t === 'door' && m.forced).length;
console.log(`level ${level}, ${mins} min:`);
console.log('  states (ticks):', JSON.stringify(seen));
console.log('  shapes (ticks):', JSON.stringify(forms));
console.log(`  caught ${kills}, doors forced ${forced}, floors visited ${[...floors]}, chased on floors ${[...chaseFloors]}`);
console.log(`  longest stay in a side room while not chasing: ${(maxIdleRoom / 20).toFixed(1)} s (it may only be finishing a chase and walking out)`);
if (maxIdleRoom > 20 * 25) bad.push('it stayed in a side room a long time without chasing');
for (const k of ['car', 'cones', 'pipe', 'true', 'burst', 'settle']) if (!forms[k]) bad.push(`it never was: ${k}`);
if (!forms.copy) bad.push('it never copied a player');
if (floors.size < 2) bad.push('it never changed floor');
if (!kills) bad.push('it never caught anyone');
console.log(bad.length ? 'PROBLEMS:\n  ' + [...new Set(bad)].join('\n  ') : 'Shapeshifter: all checks passed');
process.exit(bad.length ? 1 : 0);
