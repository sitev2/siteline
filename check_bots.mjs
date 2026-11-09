// Plays fast bot-vs-bot games with no graphics, to check bot changes work and see how rounds go.
//   node check_bots.mjs                      → 3 bomb matches on outpost, normal bots
//   node check_bots.mjs foundry hard 5       → 5 matches on foundry with hard bots
//   node check_bots.mjs quarry normal 2 dm   → 2 deathmatches on quarry
let simNow = 0;
globalThis.performance = { now: () => simNow };   // run the game clock as fast as the computer can
globalThis.setInterval = () => 0;
const { Server } = await import('./server.js');
const [map = 'outpost', level = 'normal', n = '3', kind = 'match'] = process.argv.slice(2);
for (let m = 1; m <= +n; m++) {
  const S = new Server({ send: () => {}, practice: false, ownerId: 'nobody', localId: null });
  S.startBotGame({ kind, map, level, side: 'atk', count: 4 });
  const ends = {};
  let lastPhase = '', plants = 0;
  const endRound = S.endRound.bind(S);
  S.endRound = (winner, reason, ...rest) => { ends[`${winner} ${reason}`] = (ends[`${winner} ${reason}`] || 0) + 1; return endRound(winner, reason, ...rest); };
  for (let i = 0; i < 20 * 60 * 40 && S.phase !== 'over'; i++) {
    simNow += 50;
    S.tick();
    // (bot games keep the 'live' phase after a plant, so watch the bomb itself)
    const st = S.bomb && S.bomb.state;
    if (st !== lastPhase) { if (st === 'planted') plants++; lastPhase = st; }
  }
  const players = [...S.players.values()].map(p => `${p.name} ${p.kills}/${p.deaths}`).join(', ');
  if (kind === 'dm') console.log(`game ${m}: ${players}`);
  else console.log(`match ${m}: squads ${S.squadScore[0]}-${S.squadScore[1]}, plants ${plants}, round ends ${JSON.stringify(ends)}\n   ${players}`);
}
process.exit(0);
