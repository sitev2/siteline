// Authoritative game state. Runs inside the host player's browser.
// Clients send their own movement and shots; the host validates hits,
// owns health, armour, money, the bomb, rounds and score, and broadcasts snapshots.
import { World, CELL, EYE, blastField, blastDamage } from './world.js';
import { MAPS, resolveMap, mapsFor, isDmMap, dmVariant } from './maps.js';
import { RULES } from './config.js';
import { NavGrid, BotBrain, BOT_NAMES } from './bots.js';
import { MonsterBrain, outerCorners } from './monster.js';
import { BR_LEVELS, brLevel, brVariant } from './brmap.js';
import { cleanChat, CHAT_LIMIT } from './filter.js';
import {
  WEAPONS, EQUIPMENT, MONEY, STARTER_PISTOL, canTeamBuy, rawDamage, applyArmor, isArmored, penMetres, HITGROUPS,
  SPOON, hasSpoon, itemDef,
} from './weapons.js';

const r2 = v => Math.round(v * 100) / 100;
const BOMB_STATES = ['none', 'carried', 'dropped', 'planted', 'defused', 'exploded'];
// guns you start a deathmatch with (change them any time in the buy menu)
const DM_LOADOUT = { primary: 'ak47', secondary: 'deagle' };
const PICK_AUTO = 0.9;   // walk this close to a dropped gun with a free slot to pick it up
const PICK_USE = 2.2;    // how far away you can swap for a gun with E / ✋
const REJOIN_WAIT = 60;   // seconds a match waits for a team that left before it is forfeited
const eyeOf = p => p.y + EYE;

function cleanName(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N} _.\-!?]/gu, '').trim().slice(0, 16);
  return s || 'Player';
}

export class Server {
  // ownerId: the player allowed to change settings and start the match.
  // localId: a player running in the same browser (no ping needed) — null on a dedicated server.
  constructor({ send, practice = false, ownerId = 'host', localId = 'host' }) {
    // messages to bots go nowhere: their state lives right here on the host
    this.send = (id, msg) => { if (!this.bots.has(id)) send(id, msg); };
    this.bots = new Map();         // bot id → BotBrain (practice games only)
    this.botCfg = null;            // { kind: 'range' | 'match' | 'dm', map, level, behavior, count, side }
    this.practice = practice;
    this.ownerId = ownerId;
    this.localId = localId;
    this.players = new Map();
    this.settings = { map: 'outpost', winRounds: RULES.winRounds, mode: 'wingman', level: 'normal' };   // level: Backrooms difficulty   // mode: 'wingman' (2v2 bomb), 'dm' (deathmatch) or 'br' (Backrooms)
    this.dm = false;               // true while a deathmatch is being played
    this.br = false;               // true while a Backrooms escape is being played
    this.variant = null;           // deathmatch map size: 'small' or 'large'
    this.swapped = false;          // true after the halftime side swap
    this.squadScore = [0, 0];      // squad 0 starts as attackers, squad 1 as defenders
    this.ladder = [1, 1];          // loss-bonus step per squad
    this.phase = 'lobby';
    this.score = { atk: 0, def: 0 };
    this.round = 0;
    this.timer = 0;
    this.bomb = this.freshBomb();
    this.roundPlanted = false;
    this.world = null;
    this.last = performance.now();
    this.pending = [];   // delayed actions [time, fn]
    this.drops = new Map();   // guns and defuse kits lying on the ground
    this.dropSeq = 0;
    this.interval = setInterval(() => this.tick(), 50);
  }

  destroy() { clearInterval(this.interval); }

  freshBomb() {
    return { state: 'none', carrier: null, x: 0, y: 0, z: 0, site: null, prog: 0, user: null, timer: 0, planter: null };
  }

  broadcast(msg, except) {
    for (const p of this.players.values()) if (!p.dummy && p.id !== except) this.send(p.id, msg);
  }

  later(sec, fn) { this.pending.push([performance.now() + sec * 1000, fn]); }

  roster() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, dummy: p.dummy, bot: !!p.bot, ping: p.ping, owner: p.id === this.ownerId }));
  }

  broadcastRoster() {
    if (this.phase === 'lobby' && !this.practice) this.fixMap();
    this.broadcast({ t: 'roster', roster: this.roster(), settings: this.settings, phase: this.phase, practice: this.practice, botGame: this.botCfg && this.botCfg.kind });
  }

  // which squad is currently playing a side
  squadOf(team) { return (team === 'atk') !== this.swapped ? 0 : 1; }
  sideOf(squad) { return (squad === 0) !== this.swapped ? 'atk' : 'def'; }
  updateScore() {
    this.score = { atk: this.squadScore[this.squadOf('atk')], def: this.squadScore[this.squadOf('def')] };
  }

  humanCount() { let n = 0; for (const p of this.players.values()) if (!p.dummy) n++; return n; }

  teamCount(team, aliveOnly = false) {
    let n = 0;
    for (const p of this.players.values()) if (!p.dummy && p.team === team && (!aliveOnly || p.alive)) n++;
    return n;
  }

  // ---------- players ----------
  addPlayer(id, name) {
    if (this.players.has(id)) return;
    const team = this.practice ? 'atk' : (this.teamCount('atk') <= this.teamCount('def') ? 'atk' : 'def');
    const squad = this.squadOf(team);
    const p = {
      id, name: cleanName(name), team, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, w: STARTER_PISTOL[team],
      hp: 100, alive: false, kills: 0, deaths: 0, lastShot: 0, use: false, moved: 0, dummy: false, ping: 0, squad,
      money: this.practice ? MONEY.max : MONEY.start, inv: { primary: null, secondary: STARTER_PISTOL[team] },
      armor: 0, helmet: false, kit: false, hs: 0, dmg: 0,
      ammo: {},
    };
    p.spoon = hasSpoon(p.name);    // the secret spoon: only for the player with that name
    this.players.set(id, p);
    const back = this.phase !== 'lobby' && this.phase !== 'over' ? this.restoreLeaver(p) : false;
    if (this.botCfg && this.phase !== 'lobby' && !this.br) this.replaceBotWith(p);
    this.send(id, { t: 'welcome', id, settings: this.settings, phase: this.phase, roster: this.roster(), practice: this.practice });
    if (this.practice && this.phase === 'practice') {
      // practice range: start shooting straight away
      this.send(id, this.startMsg());
      this.send(id, this.dropsMsg());
      this.later(0.3, () => this.respawn(p));
    } else if (this.br) {
      // a friend joins a running Backrooms game: they start in the starting room with nothing
      this.brPrepare(p);
      this.send(id, this.startMsg());
      if (this.phase === 'br') this.later(0.3, () => this.brSpawn(p));
    } else if (this.phase === 'dm') {
      // jump straight into a running deathmatch
      p.team = 'ffa';
      p.dmLoadout = p.rejoinLoadout || { ...DM_LOADOUT };
      p.money = 0;
      this.send(id, this.startMsg());
      this.later(0.3, () => this.respawn(p));
    } else if (this.phase !== 'lobby') {
      p.squad = this.squadOf(p.team);
      // joined during buy time (and the round isn't about to be replayed): play this round straight away
      const now = this.phase === 'freeze' && !this.hold && !this.botCfg && this.world;
      this.send(id, this.startMsg());
      this.send(id, { t: 'snapScore', score: this.score, round: this.round, now: !!now });
      this.send(id, this.dropsMsg());
      if (now) {
        this.later(0.3, () => {
          if (this.phase !== 'freeze' || !this.players.has(id) || p.alive) return;
          this.resetLoadout(p); p.ammo = {}; p.bought = {};
          p.w = p.inv.secondary = STARTER_PISTOL[p.team];
          this.respawn(p);
          this.broadcastRoster();
        });
      }
    }
    this.broadcastRoster();
    if (back) this.broadcast({ t: 'toast', text: `${p.name} is back in the game` }, id);
    // the match was waiting for this team to have a player again: play the round again from the start
    if (this.hold && this.teamCount('atk') > 0 && this.teamCount('def') > 0) {
      this.hold = null;
      this.later(0.6, () => {
        if (['freeze', 'live', 'planted', 'end'].includes(this.phase) && this.teamCount('atk') > 0 && this.teamCount('def') > 0) { this.round--; this.newRound(); }
      });
    }
  }

  // ---------- leaving and coming back ----------
  // Someone who leaves a running match is remembered by name, so if they rejoin they get their
  // team, score and money back.
  rememberLeaver(p) {
    if (p.bot || p.dummy || this.practice || this.br || this.phase === 'lobby' || this.phase === 'over') return;
    if (!this.gone) this.gone = new Map();
    this.gone.set(p.name.toLowerCase(), {
      dm: this.dm, squad: p.squad, kills: p.kills, deaths: p.deaths, hs: p.hs, dmg: p.dmg, money: p.money, dmLoadout: p.dmLoadout,
    });
  }

  restoreLeaver(p) {
    const rec = this.gone && this.gone.get(p.name.toLowerCase());
    if (!rec || rec.dm !== this.dm || this.botCfg) return false;
    this.gone.delete(p.name.toLowerCase());
    Object.assign(p, { kills: rec.kills, deaths: rec.deaths, hs: rec.hs, dmg: rec.dmg });
    if (this.dm) { if (rec.dmLoadout) p.rejoinLoadout = rec.dmLoadout; return true; }
    // back on the same squad (it may have swapped sides since) if there is room
    const team = this.sideOf(rec.squad);
    if (this.teamCount(team) - (p.team === team ? 1 : 0) < RULES.teamSize) { p.team = team; p.squad = rec.squad; p.inv.secondary = STARTER_PISTOL[team]; p.w = STARTER_PISTOL[team]; }
    p.money = rec.money;
    return true;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.bots.delete(id);
    // a friend left a practice game: a bot takes their place again
    if (this.botCfg && !p.bot && id !== this.localId && this.phase !== 'lobby' && this.phase !== 'over') {
      this.later(0.1, () => this.refillBot(p.team));
    }
    if (this.bomb.carrier === id && this.bomb.state === 'carried') this.dropBomb(p);
    this.rememberLeaver(p);
    this.players.delete(id);
    if (id === this.ownerId) {
      const next = [...this.players.values()].find(q => !q.dummy && !q.bot);
      if (next) {
        this.ownerId = next.id;
        this.send(next.id, { t: 'toast', text: 'You are now the room leader.' });
      }
    }
    this.broadcastRoster();
    this.broadcast({ t: 'toast', text: `${p.name} left the game` });
    if (this.phase === 'br') {
      this.brCheck();
    } else if (this.phase === 'dm' && this.humanCount() < RULES.dm.minPlayers) {
      const last = [...this.players.values()].find(q => !q.dummy);
      this.matchOver(last ? last.id : null, 'forfeit');
    } else if (!this.practice && ['freeze', 'live', 'planted', 'end'].includes(this.phase)) {
      if (this.teamCount('atk') === 0 || this.teamCount('def') === 0) {
        // a whole team is gone: hold the match for a minute so they can rejoin, then it's a forfeit
        if (this.humanCount() === 0 || this.botCfg) this.matchOver(this.teamCount('atk') === 0 ? 'def' : 'atk', 'forfeit');
        else if (!this.hold) {
          this.hold = { until: performance.now() + REJOIN_WAIT * 1000 };
          this.broadcast({ t: 'toast', text: `The other team left — waiting ${REJOIN_WAIT} seconds for them to rejoin` });
        }
      } else this.checkRoundEnd();
    }
  }

  receive(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'st': return this.onState(p, msg);
      case 'shot': return this.onShot(p, msg);
      case 'melee': return this.onMelee(p, msg);
      case 'buy': return this.onBuy(p, String(msg.item || ''));
      case 'refund': return this.onRefund(p, String(msg.item || ''));
      case 'drop': return this.onDrop(p, msg);
      case 'chat': return this.onChat(p, msg);
      case 'light': p.light = !!msg.on; return;
      case 'pick': return this.onPick(p, msg);
      case 'note': return this.onNote(p, msg);
      case 'door':
        if (this.phase === 'br' && p.alive && !p.escaped && Number.isInteger(msg.i)) {
          const d = this.world.doors[msg.i];
          if (d && Math.hypot(d.cx - p.x, d.cz - p.z) < 2.4) this.toggleDoor(msg.i, !d.open, p);
        }
        return;
      case 'pong':
        if (Number.isFinite(msg.ts)) {
          const rtt = Math.max(0, performance.now() - msg.ts);
          p.ping = Math.round(p.ping ? p.ping * 0.6 + rtt * 0.4 : rtt);
        }
        return;
      case 'team':
        if ((this.phase === 'lobby') && (msg.team === 'atk' || msg.team === 'def') && p.team !== msg.team) {
          if (this.teamCount(msg.team) >= RULES.teamSize) { this.send(id, { t: 'toast', text: `That team is full (${RULES.teamSize} max).` }); return; }
          p.team = msg.team; this.broadcastRoster();
        }
        return;
      case 'settings':
        if (id !== this.ownerId || this.phase !== 'lobby') return;
        if (msg.mode === 'wingman' || msg.mode === 'dm' || msg.mode === 'br') this.settings.mode = msg.mode;
        if (typeof msg.night === 'boolean') this.settings.night = msg.night;
        if (BR_LEVELS[msg.level]) this.settings.level = msg.level;
        if (MAPS[msg.map]) this.settings.map = msg.map;
        this.broadcastRoster();
        return;
      case 'shuffle':
        if (id !== this.ownerId || this.phase !== 'lobby') return;
        this.shuffleTeams();
        return;
      case 'startMatch':
        if (id === this.ownerId) this.startMatch();
        return;
      case 'restart':
        if (id === this.ownerId && this.botCfg && this.phase === 'over') this.startBotGame(this.botCfg);
        return;
      case 'toLobby':
        if (id === this.ownerId && !this.practice && !this.botCfg) this.toLobby();
        return;
    }
  }

  shuffleTeams() {
    const list = [...this.players.values()].filter(p => !p.dummy).sort(() => Math.random() - 0.5);
    list.forEach((p, i) => { p.team = i % 2 ? 'def' : 'atk'; });
    this.broadcastRoster();
  }

  // ---------- buying ----------
  canBuy(p) {
    if (!p.alive) return false;
    if (this.practice || this.dm) return true;
    if (this.phase !== 'freeze' && this.phase !== 'live') return false;
    if ((performance.now() - this.roundStart) / 1000 >= RULES.buyTime) return false;
    return this.world.nearSpawn(p.team, p.x, p.z, 14);
  }

  addMoney(p, amount, label, items) {
    if (this.practice || this.dm || p.dummy) return;
    const before = p.money;
    p.money = Math.max(0, Math.min(MONEY.max, p.money + amount));
    const got = p.money - before;
    if (items) items.push([label, amount]);
    else if (got || amount) this.send(p.id, { t: 'income', items: [[label, amount]], money: p.money });
  }

  sendInv(p, fresh = [], extra = null) {
    if (p.dummy) return;
    this.send(p.id, {
      t: 'inv', inv: p.inv, w: p.w, money: p.money, armor: p.armor, helmet: p.helmet, kit: p.kit, fresh,
      refunds: this.refundList(p), melee: p.spoon ? 'spoon' : null, ...(extra || {}),
    });
  }

  // ---------- refunds ----------
  // Everything bought this round is remembered on a small stack per slot
  // ('primary', 'secondary', 'armor', 'kit'), so a refund can give back the money
  // and restore whatever the purchase replaced.
  refundKey(item) {
    if (WEAPONS[item]) return WEAPONS[item].slot;
    if (item === 'vest' || item === 'vesthelm' || item === 'helmet') return 'armor';
    if (item === 'kit') return 'kit';
    return null;
  }

  canRefund(p, entry) {
    if (!entry || entry.fired) return false;
    // armour has to be untouched
    if (entry.key === 'armor') return p.armor === entry.after.armor && p.helmet === entry.after.helmet;
    if (entry.key === 'kit') return p.kit;
    return p.inv[entry.key] === entry.item;
  }

  // { item: price } for every purchase that can be refunded right now
  refundList(p) {
    const out = {};
    if (!p.bought || !this.canBuy(p)) return out;
    for (const stack of Object.values(p.bought)) {
      const top = stack[stack.length - 1];
      if (this.canRefund(p, top)) out[top.item] = top.price;
    }
    return out;
  }

  remember(p, key, entry) {
    if (!p.bought) p.bought = {};
    (p.bought[key] = p.bought[key] || []).push({ key, ...entry });
  }

  onRefund(p, item) {
    const key = this.refundKey(item);
    const stack = key && p.bought && p.bought[key];
    const top = stack && stack[stack.length - 1];
    if (!top || top.item !== item || !this.canBuy(p) || !this.canRefund(p, top)) {
      this.send(p.id, { t: 'toast', text: 'That can’t be refunded any more.' });
      this.sendInv(p);
      return;
    }
    stack.pop();
    if (!this.practice) p.money = Math.min(MONEY.max, p.money + top.price);
    if (key === 'armor') { p.armor = top.prev.armor; p.helmet = top.prev.helmet; }
    else if (key === 'kit') p.kit = false;
    else {
      p.inv[key] = top.prev;
      if (p.w === item) p.w = p.inv[key] || this.bestWeapon(p);
    }
    this.sendInv(p);
  }

  // a gun stops being refundable once it has been fired
  markFired(p, weapon) {
    const stack = p.bought && p.bought[WEAPONS[weapon].slot];
    const top = stack && stack[stack.length - 1];
    if (top && top.item === weapon && !top.fired) { top.fired = true; this.sendInv(p); }
  }

  onBuy(p, item) {
    if (!this.canBuy(p)) { this.send(p.id, { t: 'toast', text: 'You can only buy in your spawn area during buy time.' }); return; }
    if (this.dm) return this.onDmPick(p, item);
    const pay = (price) => {
      if (this.practice) return true;
      if (p.money < price) { this.send(p.id, { t: 'toast', text: 'Not enough money.' }); return false; }
      p.money -= price;
      return true;
    };
    const w = WEAPONS[item];
    if (w) {
      if (!this.practice && !canTeamBuy(w, p.team)) return;
      if (p.inv[w.slot] === item) { p.w = item; this.sendInv(p); return; }
      if (!pay(w.price)) return;
      this.remember(p, w.slot, { item, price: this.practice ? 0 : w.price, prev: p.inv[w.slot] });
      p.inv[w.slot] = item;
      p.w = item;
      this.sendInv(p, [item]);
      return;
    }
    if (!EQUIPMENT[item]) return;
    const before = { armor: p.armor, helmet: p.helmet }, money0 = p.money;
    if (item === 'vest') {
      if (p.armor >= 100) return;
      if (!pay(EQUIPMENT.vest.price)) return;
      p.armor = 100;
    } else if (item === 'vesthelm') {
      const needVest = p.armor < 100, needHelm = !p.helmet;
      if (!needVest && !needHelm) return;
      const price = needVest && needHelm ? EQUIPMENT.vesthelm.price : needVest ? EQUIPMENT.vest.price : EQUIPMENT.helmet.price;
      if (!pay(price)) return;
      p.armor = 100; p.helmet = true;
    } else if (item === 'helmet') {
      if (p.helmet) return;
      if (p.armor < 100) { this.send(p.id, { t: 'toast', text: 'The helmet needs a full vest first.' }); return; }
      if (!pay(EQUIPMENT.helmet.price)) return;
      p.helmet = true;
    } else if (item === 'kit') {
      if (p.kit || (p.team !== 'def' && !this.practice)) return;
      if (!pay(EQUIPMENT.kit.price)) return;
      p.kit = true;
    }
    const paid = money0 - p.money;
    if (item === 'kit') this.remember(p, 'kit', { item, price: paid });
    else this.remember(p, 'armor', { item, price: paid, prev: before, after: { armor: p.armor, helmet: p.helmet } });
    this.sendInv(p);
  }

  // ---------- movement + shooting ----------
  onState(p, m) {
    if (m.rd !== this.round || !p.alive) return;
    if (![m.x, m.y, m.z, m.yaw, m.pitch].every(Number.isFinite)) return;
    p.moved += Math.hypot(m.x - p.x, m.z - p.z);
    p.x = m.x; p.y = m.y; p.z = m.z; p.yaw = m.yaw; p.pitch = m.pitch;
    p.use = !!m.u;
    if (this.canHold(p, m.w)) p.w = m.w;
    // remember ammo so a dropped gun keeps what was left in it
    if (Array.isArray(m.am) && m.am.length === 4) {
      for (const [i, slot] of [[0, 'primary'], [2, 'secondary']]) {
        const w = WEAPONS[p.inv[slot]];
        if (w && Number.isFinite(m.am[i]) && Number.isFinite(m.am[i + 1])) p.ammo[slot] = this.clampAmmo(w, m.am[i], m.am[i + 1]);
      }
    }
  }

  canHold(p, id) {
    if (id === 'c4') return this.bomb.state === 'carried' && this.bomb.carrier === p.id;
    if (id === 'spoon') return !!p.spoon;
    return !!WEAPONS[id] && (id === p.inv.primary || id === p.inv.secondary);
  }

  clampAmmo(w, mag, res) {
    return [Math.max(0, Math.min(w.mag, Math.round(mag))), Math.max(0, Math.min(w.reserve, Math.round(res)))];
  }

  // weapon to hold when the current one goes away
  // (you can't drop your last gun, so there is always one)
  bestWeapon(p) { return p.inv.primary || p.inv.secondary || STARTER_PISTOL[p.team]; }

  onShot(p, m) {
    if (!p.alive || !this.world) return;
    if (!['live', 'planted', 'end', 'practice', 'dm'].includes(this.phase)) return;
    const w = WEAPONS[m.w];
    if (!w || (m.w !== p.inv.primary && m.w !== p.inv.secondary)) return;
    p.w = m.w;
    const now = performance.now();
    const minGap = (w.burstInterval || w.interval) * 1000 * 0.6;
    if (now - p.lastShot < minGap) return;
    p.lastShot = now;
    const o = Array.isArray(m.o) ? m.o.map(Number) : null;
    if (!o || o.length !== 3 || !o.every(Number.isFinite)) return;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 4) return;

    this.markFired(p, w.id);
    const silenced = !!m.s && !!w.silenced;
    const ends = Array.isArray(m.e) ? m.e.slice(0, 3) : [];
    this.broadcast({ t: 'shot', id: p.id, w: w.id, o, e: ends, s: silenced ? 1 : 0 }, p.id);

    // add up every pellet per target, applying armour hit by hit
    const totals = new Map();
    const hits = Array.isArray(m.hits) ? m.hits.slice(0, w.pellets) : [];
    for (const h of hits) {
      const tgt = this.players.get(h && h.id);
      if (!tgt || !tgt.alive || tgt === p) continue;
      const pt = Array.isArray(h.p) ? h.p.map(Number) : null;
      if (!pt || pt.length !== 3 || !pt.every(Number.isFinite)) continue;
      if (Math.hypot(pt[0] - tgt.x, pt[2] - tgt.z) > 3.5 || pt[1] < tgt.y - 1 || pt[1] > tgt.y + 3) continue;
      // solid walls block; boxes, crates and barrels let bullets through with less damage
      const factor = this.world.traceFactor(o[0], o[1], o[2], pt[0], pt[1], pt[2], penMetres(w));
      if (factor <= 0) continue;
      const part = HITGROUPS.includes(h.part) ? h.part : 'chest';
      const dist = Math.hypot(pt[0] - o[0], pt[1] - o[1], pt[2] - o[2]);
      const team = this.mates(tgt, p);
      let dmg = rawDamage(w, part, dist) * factor * (team ? RULES.friendlyFire : 1);
      const t = totals.get(tgt.id) || { hp: 0, armor: 0, head: false, part, armored: false, left: tgt.armor };
      const split = applyArmor(dmg, part, t.left, tgt.helmet, w.armorPen);
      t.hp += split.hp; t.armor += split.armor; t.left = Math.max(0, t.left - split.armor);
      t.head = t.head || part === 'head';
      t.armored = t.armored || isArmored(part, tgt.armor, tgt.helmet);
      if (dmg > (t.best || 0)) { t.best = dmg; t.part = part; }
      totals.set(tgt.id, t);
    }
    for (const [tid, t] of totals) this.damage(this.players.get(tid), p, t, w.id, o);
  }

  // The secret spoon: a swing (slash) or a stab. m: { stab, o: [x, y, z], hit: { id, part, p: [x, y, z] } | null, wall }
  // Works like a knife: short reach, no ammo, and much more damage from behind.
  onMelee(p, m) {
    if (!p.spoon || !p.alive || !this.world) return;
    if (!['live', 'planted', 'end', 'practice', 'dm'].includes(this.phase)) return;
    const stab = !!m.stab, a = stab ? SPOON.stab : SPOON.slash;
    const now = performance.now();
    const since = now - (p.meleeAt || -1e9);
    if (since < (p.meleeGap || 0) * 0.6) return;
    const o = Array.isArray(m.o) ? m.o.map(Number) : null;
    if (!o || o.length !== 3 || !o.every(Number.isFinite)) return;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 4) return;
    const first = since > (p.meleeGap || 0) + 400;    // swings straight after one another hit softer
    p.w = 'spoon';

    let tgt = null, pt = null;
    const h = m.hit;
    if (h && typeof h === 'object') {
      tgt = this.players.get(h.id);
      pt = Array.isArray(h.p) ? h.p.map(Number) : null;
      const ok = tgt && tgt.alive && tgt !== p && pt && pt.length === 3 && pt.every(Number.isFinite)
        && Math.hypot(pt[0] - tgt.x, pt[2] - tgt.z) <= 3.5 && pt[1] >= tgt.y - 1 && pt[1] <= tgt.y + 3
        && Math.hypot(pt[0] - o[0], pt[1] - o[1], pt[2] - o[2]) <= a.range + 0.35
        && this.world.traceFactor(o[0], o[1], o[2], pt[0], pt[1], pt[2], 0.05) > 0;   // nothing in the way, not even a crate
      if (!ok) tgt = null;
    }
    p.meleeAt = now;
    p.meleeGap = (tgt ? a.hit : a.miss) * 1000;
    this.broadcast({ t: 'swing', id: p.id, stab: stab ? 1 : 0, hit: tgt ? 2 : m.wall ? 1 : 0 }, p.id);
    if (!tgt) return;

    // from behind? (the victim is facing away from the attacker)
    const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz) || 1;
    const back = (dx * -Math.sin(tgt.yaw) + dz * -Math.cos(tgt.yaw)) / d > 0.475;
    const dmg = (back ? a.back : first ? a.damage : a.quick) * (this.mates(tgt, p) ? RULES.friendlyFire : 1);
    const part = HITGROUPS.includes(h.part) ? h.part : 'chest';
    // armour takes the edge off wherever the spoon lands (no headshot bonus)
    const split = applyArmor(dmg, 'chest', tgt.armor, tgt.helmet, SPOON.armorPen);
    this.damage(tgt, p, { hp: split.hp, armor: split.armor, head: false, part, armored: tgt.armor > 0 }, 'spoon', o);
  }

  // ---------- dropped guns, kits and the bomb ----------
  dropsMsg(fresh = null, from = null) {
    const list = [...this.drops.values()].map(d => [d.id, d.kind, d.w, r2(d.x), r2(d.y), r2(d.z), r2(d.yaw)]);
    return { t: 'drops', list, fresh, from };
  }

  broadcastDrops(fresh = null, from = null) { this.broadcast(this.dropsMsg(fresh, from)); }

  clearDrops() {
    this.drops.clear();
    this.broadcastDrops();
  }

  // a spot on the floor a little in front of the player (stops short of walls and cover)
  throwSpot(p, dist = 1.6, yawOff = 0) {
    const yaw = p.yaw + yawOff;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const oy = p.y + 1.0;
    const tr = this.world.trace(p.x, oy, p.z, fx, 0, fz, dist + 0.5);
    let t = Math.min(dist, tr.t - 0.35);
    if (tr.pen.length) t = Math.min(t, tr.pen[0][0] - 0.35);
    t = Math.max(0, t);
    const x = p.x + fx * t, z = p.z + fz * t;
    return { x, y: this.world.groundAt(x, z, 0.1, p.y + 0.5), z };
  }

  addDrop(kind, w, spot, by, ammo, from) {
    const id = ++this.dropSeq;
    const d = { id, kind, w, x: spot.x, y: spot.y, z: spot.z, yaw: Math.random() * Math.PI * 2, by, until: performance.now() + 1000 };
    if (kind === 'gun') {
      const def = WEAPONS[w];
      const [mag, res] = ammo || [def.mag, def.reserve];
      d.mag = mag; d.res = res;
    }
    this.drops.set(id, d);
    // the practice range never starts a new round, so don't let guns pile up forever
    if (this.drops.size > 24) this.drops.delete(this.drops.keys().next().value);
    this.broadcastDrops(id, from ? from.map(r2) : null);
    return d;
  }

  // G: drop the gun (or bomb) in your hands. m: { w, am: [mag, res] }
  onDrop(p, m) {
    if (this.dm) return;   // guns are free in deathmatch — nothing to drop or pick up
    if (!p.alive || !this.world || ['lobby', 'over', 'starting'].includes(this.phase)) return;
    const from = [p.x, eyeOf(p) - 0.3, p.z];
    if (m.w === 'c4') {
      if (this.bomb.state !== 'carried' || this.bomb.carrier !== p.id) return;
      this.dropBomb(p, this.throwSpot(p), from);
      return;
    }
    const w = WEAPONS[m.w];
    if (!w) return;
    const slot = w.slot;
    if (p.inv[slot] !== m.w) return;
    // your last gun stays in your hands
    if (!p.inv[slot === 'primary' ? 'secondary' : 'primary']) { this.send(p.id, { t: 'toast', text: 'You can’t drop your last weapon.' }); return; }
    const ammo = Array.isArray(m.am) && m.am.every(Number.isFinite) ? this.clampAmmo(w, m.am[0], m.am[1]) : p.ammo[slot];
    p.inv[slot] = null;
    delete p.ammo[slot];
    if (p.w === m.w) p.w = this.bestWeapon(p);
    this.addDrop('gun', m.w, this.throwSpot(p), p.id, ammo, from);
    this.sendInv(p);
  }

  // E / ✋ near a dropped gun: swap it for the one in the same slot. m: { id, am: [mag, res] }
  onPick(p, m) {
    if (this.dm) return;
    if (!p.alive || !this.world) return;
    const d = this.drops.get(Number(m.id));
    if (!d || d.kind !== 'gun') return;
    if (Math.hypot(d.x - p.x, d.z - p.z) > PICK_USE + 0.6 || Math.abs(d.y - p.y) > 1.6) return;
    const w = WEAPONS[d.w];
    const old = p.inv[w.slot];
    if (old) {
      const ow = WEAPONS[old];
      const ammo = Array.isArray(m.am) && m.am.every(Number.isFinite) ? this.clampAmmo(ow, m.am[0], m.am[1]) : p.ammo[w.slot];
      this.addDrop('gun', old, this.throwSpot(p, 0.5), p.id, ammo, [p.x, p.y + 1, p.z]);
    }
    this.takeDrop(p, d, true);
  }

  takeDrop(p, d, equip) {
    this.drops.delete(d.id);
    if (d.kind === 'kit') {
      p.kit = true;
      this.send(p.id, { t: 'toast', text: 'You picked up a defuse kit' });
      this.sendInv(p);
    } else {
      const slot = WEAPONS[d.w].slot;
      p.inv[slot] = d.w;
      p.ammo[slot] = [d.mag, d.res];
      if (equip) p.w = d.w;
      this.sendInv(p, [], { ammo: { [d.w]: [d.mag, d.res] }, eq: equip ? d.w : null });
    }
    this.broadcastDrops();
  }

  // walking over a gun with a free slot, or (defenders) over a kit, picks it up
  autoPickup() {
    if (!this.drops.size) return;
    const now = performance.now();
    for (const p of this.players.values()) {
      if (!p.alive || p.dummy) continue;
      for (const d of this.drops.values()) {
        if (d.by === p.id && now < d.until) continue;
        if (Math.hypot(d.x - p.x, d.z - p.z) > PICK_AUTO || Math.abs(d.y - p.y) > 1.0) continue;
        if (d.kind === 'kit') {
          if (p.kit || (p.team !== 'def' && !this.practice)) continue;
        } else if (p.inv[WEAPONS[d.w].slot]) continue;
        this.takeDrop(p, d, false);
        break;
      }
    }
  }

  // t: { hp, armor, head, part, armored }. from: where the attack came from (for the ragdoll push)
  damage(tgt, attacker, t, weapon, from) {
    if (!tgt || !tgt.alive) return;
    const before = tgt.hp;
    const hpLoss = Math.max(0, Math.round(t.hp));
    tgt.hp = Math.max(0, tgt.hp - hpLoss);
    const armorBefore = tgt.armor;
    tgt.armor = Math.max(0, Math.round(tgt.armor - t.armor));
    if (tgt.armor !== armorBefore && tgt.bought && tgt.bought.armor && tgt.bought.armor.length) this.sendInv(tgt);
    if (attacker && attacker !== tgt) attacker.dmg += before - tgt.hp;
    if (!tgt.dummy) {
      this.send(tgt.id, {
        t: 'hurt', hp: tgt.hp, armor: tgt.armor, part: t.part || 'chest', armored: !!t.armored,
        from: attacker ? [r2(attacker.x), r2(attacker.z)] : null,
      });
    }
    if (attacker && !attacker.dummy && attacker !== tgt) {
      this.send(attacker.id, { t: 'hit', id: tgt.id, head: !!t.head, kill: tgt.hp <= 0, dmg: hpLoss, mate: this.mates(tgt, attacker) });
    }
    const brain = this.bots.get(tgt.id);
    if (brain) brain.onHurt(attacker);
    if (tgt.hp <= 0) this.kill(tgt, attacker, weapon, t.head, from, t.part);
  }

  kill(tgt, attacker, weapon, head, from = null, part = 'chest') {
    if (!tgt.alive) return;
    tgt.alive = false;
    tgt.deaths++;
    tgt.use = false;
    if (attacker && attacker !== tgt) {
      if (this.mates(attacker, tgt)) {
        this.addMoney(attacker, MONEY.teamkill, 'Killed a teammate');
      } else {
        attacker.kills++;
        if (head) attacker.hs++;
        const w = itemDef(weapon);
        if (w && w.reward) this.addMoney(attacker, w.reward, `Kill with ${w.name}`);
      }
    }
    this.broadcast({
      t: 'kill', killer: attacker ? attacker.id : null, victim: tgt.id, w: weapon, head: !!head,
      from: from ? from.map(r2) : null, part: part || 'chest',
    });
    if (this.bomb.carrier === tgt.id && this.bomb.state === 'carried') this.dropBomb(tgt, this.throwSpot(tgt, 0.4, Math.PI));
    if (this.br) { this.brCheck(); return; }
    if (this.dm) {
      if (attacker && attacker !== tgt && attacker.kills >= RULES.dm.killLimit) this.dmOver('kills');
      else this.later(RULES.dm.respawn, () => { if (this.phase === 'dm') this.respawn(tgt); });
      return;
    }
    this.dropOnDeath(tgt);
    if (this.practice) {
      this.later(3, () => this.respawn(tgt));
      return;
    }
    this.checkRoundEnd();
  }

  // teammates? (nobody is a teammate in deathmatch; practice targets never are)
  mates(a, b) { return !this.dm && !!a && !!b && a.team === b.team && !a.dummy && !b.dummy; }

  // the dead drop their main gun (or pistol if they had no main gun) and, defenders, their kit
  dropOnDeath(p) {
    if (p.dummy || !this.world) return;
    const slot = p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : null;
    const from = [p.x, p.y + 1.2, p.z];
    if (slot) {
      const w = p.inv[slot];
      this.addDrop('gun', w, this.throwSpot(p, 0.7, (Math.random() - 0.5) * 1.2), null, p.ammo[slot], from);
      p.inv[slot] = null;
      delete p.ammo[slot];
    }
    if (p.kit) {
      p.kit = false;
      this.addDrop('kit', null, this.throwSpot(p, 0.5, Math.PI + (Math.random() - 0.5)), null, null, from);
    }
    this.sendInv(p);
  }

  dropBomb(p, spot = null, from = null) {
    const s = spot || { x: p.x, y: p.y, z: p.z };
    Object.assign(this.bomb, { state: 'dropped', carrier: null, x: s.x, y: s.y, z: s.z, prog: 0, user: null, droppedBy: p.id, dropUntil: performance.now() + 1000 });
    if (p.w === 'c4') p.w = this.bestWeapon(p);
    this.broadcast({ t: 'bombDrop', x: r2(s.x), y: r2(s.y), z: r2(s.z), from: from ? from.map(r2) : null, by: p.id });
  }

  // ---------- match flow ----------
  startMsg() {
    return {
      t: 'start', map: this.settings.map, settings: this.settings, roster: this.roster(), practice: this.practice, phase: this.phase,
      mode: this.br ? 'br' : this.dm ? 'dm' : 'wingman', variant: this.variant,
      doors: this.br && this.world ? this.world.doors.map(d => (d.open ? 1 : 0)) : undefined,
      notes: this.br ? this.notes : undefined,
    };
  }

  // keep the chosen map valid for the mode and the number of players in the room
  fixMap() {
    if (this.settings.mode === 'br') { this.settings.map = 'backrooms'; return; }
    if (this.settings.map === 'backrooms') this.settings.map = 'outpost';
    const ok = mapsFor(this.settings.mode, this.humanCount());
    if (!ok.includes(this.settings.map)) this.settings.map = ok[0];
  }

  // ---------- chat ----------
  // m: { text, team }. 100 characters, at most 3 messages every 5 seconds, swear words starred out.
  onChat(p, m) {
    const now = performance.now();
    p.chatTimes = (p.chatTimes || []).filter(t => now - t < CHAT_LIMIT.seconds * 1000);
    if (p.chatTimes.length >= CHAT_LIMIT.count) {
      this.send(p.id, { t: 'toast', text: `Slow down — ${CHAT_LIMIT.count} messages every ${CHAT_LIMIT.seconds} seconds.` });
      return;
    }
    const text = cleanChat(m.text);
    if (!text) return;
    p.chatTimes.push(now);
    const team = !!m.team && !this.dm;
    const out = { t: 'chat', id: p.id, name: p.name, team: p.team, text, toTeam: team, dead: !p.alive && this.phase !== 'lobby' };
    for (const q of this.players.values()) {
      if (q.dummy || q.bot) continue;
      if (team && q.team !== p.team) continue;
      this.send(q.id, out);
    }
  }

  // ---------- bots (practice games only) ----------
  // walking grid for the current map (built once per map)
  navGrid() {
    if (!this.nav || this.nav.world !== this.world) this.nav = new NavGrid(this.world);
    return this.nav;
  }

  addBot(team, extra = {}, cfg = null, suffix = '') {
    const used = new Set([...this.players.values()].map(p => p.botName));
    const name = BOT_NAMES.map(n => `BOT ${n}`).find(n => !used.has(n)) || `BOT ${this.players.size}`;
    let n = 1;
    while (this.players.has(`bot${n}`)) n++;
    const id = `bot${n}`;
    const p = {
      id, name: name + suffix, botName: name, team, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, w: STARTER_PISTOL[team] || 'glock',
      hp: 100, alive: false, kills: 0, deaths: 0, lastShot: 0, use: false, moved: 0, dummy: false, bot: true, ping: 0,
      squad: this.squadOf(team), money: MONEY.start, inv: { primary: null, secondary: STARTER_PISTOL[team] || 'glock' },
      armor: 0, helmet: false, kit: false, hs: 0, dmg: 0, ammo: {}, ...extra,
    };
    this.players.set(id, p);
    this.bots.set(id, new BotBrain(this, p, cfg || { kind: this.botCfg.kind, level: this.botCfg.level, behavior: this.botCfg.behavior }));
    return p;
  }

  // Start a practice game. cfg: { kind: 'range' | 'match' | 'dm', map, level, behavior, count, side }
  //   range: practice range with `count` bots (0 = none) that stand still / move / shoot back
  //   match: 2v2 bomb match, you and a bot against two bots (side: 'atk' | 'def')
  //   dm:    deathmatch against `count` bots (1–3)
  startBotGame(cfg) {
    this.botCfg = { ...cfg };
    this.settings.night = !!cfg.night;
    for (const id of [...this.bots.keys()]) { this.bots.delete(id); this.players.delete(id); }
    for (const [id, p] of [...this.players]) if (p.dummy) this.players.delete(id);
    this.phase = 'lobby';
    this.dm = false;
    if (this.br) this.brEnd();
    const humans = [...this.players.values()];
    if (cfg.kind === 'range') {
      for (const p of humans) p.team = 'atk';
      this.startPractice(cfg.map, cfg.count || 0, cfg.behavior || 'still', cfg.level);
      return;
    }
    if (cfg.kind === 'br') {
      this.settings.mode = 'br';
      this.settings.level = brLevel(cfg.level);
      this.startBackrooms();
      return;
    }
    if (cfg.kind === 'dm') {
      this.settings.mode = 'dm';
      this.settings.map = cfg.map;
      const n = Math.max(1, Math.min(RULES.dm.maxPlayers - humans.length, cfg.count || 3));
      for (let i = 0; i < n; i++) this.addBot('atk');
      this.startMatch();
      return;
    }
    // 2v2 bomb match: fill both teams up to two with bots, humans on the chosen side first
    this.settings.mode = 'wingman';
    this.settings.map = cfg.map;
    const side = cfg.side === 'def' ? 'def' : 'atk', other = side === 'atk' ? 'def' : 'atk';
    humans.forEach((p, i) => { p.team = i < RULES.teamSize ? side : other; });
    for (const team of [side, other]) while (this.teamCount(team) < RULES.teamSize) this.addBot(team);
    this.startMatch();
  }

  // a friend joined: they take a bot's place (your team's bot first)
  replaceBotWith(p) {
    const ownerTeam = (this.players.get(this.ownerId) || {}).team;
    const list = [...this.bots.entries()].filter(([, b]) => !b.leaving);
    if (!list.length) return;
    const pick = (this.botCfg.kind === 'match' && list.find(([, b]) => b.p.team === ownerTeam)) || list[list.length - 1];
    const [id, brain] = pick;
    if (this.botCfg.kind === 'match') {
      // the bot finishes this round; the friend plays from the next one
      brain.leaving = true;
      p.team = brain.p.team;
      p.squad = brain.p.squad;
      p.money = brain.p.money;
    } else {
      this.bots.delete(id);
      this.players.delete(id);
      if (this.botCfg.kind === 'range') p.team = 'atk';
    }
    this.broadcast({ t: 'toast', text: `${p.name} joined and takes ${brain.p.name}'s place` });
  }

  // a friend left: put a bot back in their place
  refillBot(team) {
    if (!this.botCfg) return;
    const cfg = this.botCfg;
    if (cfg.kind === 'match') {
      const leaving = [...this.bots.values()].find(b => b.leaving && b.p.team === team);
      if (leaving) { leaving.leaving = false; return; }
      if (this.teamCount(team) >= RULES.teamSize) return;
      const p = this.addBot(team);
      p.money = MONEY.start;
    } else if (cfg.kind === 'dm') {
      if (this.humanCount() >= RULES.dm.maxPlayers) return;
      const p = this.addBot('ffa', { dmLoadout: { ...DM_LOADOUT } });
      this.respawn(p);
    } else if (cfg.kind === 'range' && cfg.count) {
      const nav = this.navGrid();
      const i = nav.randomNode((x, y, z) => y < 0.1 && !this.world.nearSpawn('atk', x, z, 14));
      const x = nav.x[i], z = nav.z[i];
      const p = this.addBot('def', { dummy: true, home: [x, z], x, z, y: 0, alive: true, inv: { primary: 'ak47', secondary: 'usp' }, w: 'ak47' });
      void p;
    }
    this.broadcastRoster();
  }

  // ---------- deathmatch ----------
  startDeathmatch() {
    const n = this.humanCount();
    if (n < RULES.dm.minPlayers || n > RULES.dm.maxPlayers) {
      this.send(this.ownerId, { t: 'toast', text: `Deathmatch needs ${RULES.dm.minPlayers} to ${RULES.dm.maxPlayers} players.` });
      return;
    }
    this.fixMap();
    this.variant = isDmMap(this.settings.map) ? dmVariant(n) : null;
    this.world = new World(resolveMap(this.settings.map, this.variant));
    this.dm = true;
    this.round = 1;
    this.bomb = this.freshBomb();
    this.drops.clear();
    for (const p of this.players.values()) {
      if (p.dummy) continue;
      p.lobbyTeam = p.team;
      p.team = 'ffa';
      Object.assign(p, { kills: 0, deaths: 0, hs: 0, dmg: 0, alive: false, money: 0, bought: {}, dmLoadout: { ...DM_LOADOUT } });
      if (p.bot) {
        const guns = ['ak47', 'm4a4', 'm4a1s', 'galil', 'mp9', 'mac10', 'ak47', 'm4a4'];
        p.dmLoadout = { primary: guns[Math.floor(Math.random() * guns.length)], secondary: Math.random() < 0.5 ? 'deagle' : 'usp' };
      }
    }
    this.phase = 'dm';
    this.timer = RULES.dm.timeLimit;
    this.broadcast(this.startMsg());
    this.broadcastRoster();
    for (const p of this.players.values()) if (!p.dummy) this.respawn(p);
  }

  // Safest deathmatch spawn: as far as possible from everyone alive, avoiding spots they can see
  dmSpawn(p) {
    const others = [...this.players.values()].filter(q => q !== p && q.alive);
    let best = null, bestScore = -Infinity;
    for (const s of this.world.spawns.dm) {
      let score = 1000;
      for (const q of others) {
        const d = Math.hypot(q.x - s.x, q.z - s.z);
        score = Math.min(score, d);
        if (d < 30 && this.world.los(s.x, 1.6, s.z, q.x, q.y + 1.6, q.z)) score -= 15;
      }
      score += Math.random() * 2;   // don't always use the same spot
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best || this.world.spawns.atk[0];
  }

  // pick a gun from the menu: free, any team, equipped straight away and kept on respawn
  onDmPick(p, item) {
    const w = WEAPONS[item];
    if (!w) return;
    p.dmLoadout[w.slot] = item;
    const fresh = p.inv[w.slot] !== item;
    p.inv[w.slot] = item;
    p.w = item;
    this.sendInv(p, fresh ? [item] : []);
  }

  // ---------- the Backrooms: co-op escape from a random maze, with a monster ----------
  startBackrooms() {
    if (!this.humans().length) return;
    for (const id of [...this.bots.keys()]) { this.bots.delete(id); this.players.delete(id); }
    this.br = true;
    this.dm = false;
    this.brDone = false;
    this.settings.map = 'backrooms';
    // the maze's seed and the difficulty ("12345:hard"): a new maze every game
    this.variant = brVariant(1 + Math.floor(Math.random() * 2147483000), this.settings.level);
    this.world = new World(resolveMap('backrooms', this.variant));
    this.round = 1;
    this.timer = 0;
    this.bomb = this.freshBomb();
    this.drops.clear();
    for (const p of this.humans()) { p.lobbyTeam = p.team; this.brPrepare(p); p.kills = 0; p.deaths = 0; }
    const m = this.world.spawns.def[0];
    const mp = {
      id: 'monster', name: 'It', team: 'monster', x: m.x, y: 0, z: m.z, yaw: 0, pitch: 0, w: 'none', hp: 100, alive: true,
      kills: 0, deaths: 0, lastShot: 0, use: false, moved: 0, dummy: false, bot: true, ping: 0, squad: 0, money: 0,
      inv: { primary: null, secondary: null }, armor: 0, helmet: false, kit: false, hs: 0, dmg: 0, ammo: {},
    };
    this.players.set(mp.id, mp);
    this.bots.set(mp.id, new MonsterBrain(this, mp));     // (its walking grid is made with every door open)
    // then the doors that start shut are shut
    this.world.doors.forEach((d, i) => this.world.setDoor(i, d.open));
    this.doorAt = this.world.doors.map(() => 0);
    this.corners = outerCorners(this.world);       // for the corner snatch and the monster's peeking
    this.cornerUsed = false;                        // the corner snatch happens at most once a game
    this.notes = [];                                // paper notes people have left
    this.noteSeq = 0;
    this.phase = 'br';
    this.broadcast(this.startMsg());
    this.broadcastRoster();
    this.humans().forEach((p, i) => this.brSpawn(p, i));
  }

  humans() { return [...this.players.values()].filter(p => !p.dummy && !p.bot); }

  // no guns, no money: just you and your torch-less hands
  brPrepare(p) {
    Object.assign(p, {
      team: 'atk', w: 'none', inv: { primary: null, secondary: null }, ammo: {}, armor: 0, helmet: false, kit: false,
      money: 0, alive: false, escaped: false, escapeTime: null, brDeath: null, use: false,
    });
  }

  brSpawn(p, i = Math.floor(Math.random() * 4)) {
    if (!this.players.has(p.id) || this.phase !== 'br') return;
    const s = this.world.spawns.atk[i % this.world.spawns.atk.length];
    Object.assign(p, { x: s.x, y: 0, z: s.z, yaw: s.yaw, pitch: 0, hp: 100, alive: true, escaped: false, moved: 0 });
    this.send(p.id, { t: 'spawn', x: r2(s.x), y: 0, z: r2(s.z), yaw: r2(s.yaw), rd: this.round });
  }

  brTick() {
    const door = this.world.exit, now = performance.now();
    // where everyone has been in the last second or so (for the corner snatch)
    for (const p of this.humans()) {
      if (!p.alive || p.escaped) continue;
      const tr = p.trail || (p.trail = []);
      tr.push({ x: p.x, z: p.z, t: now });
      while (tr.length > 30) tr.shift();
    }
    if (!this.cornerUsed && this.timer > 45 && now >= (this.cornerCheckAt || 0)) { this.cornerCheckAt = now + 200; this.cornerSnatch(now); }
    const holes = (this.world.def.br && this.world.def.br.holes) || [];
    for (const p of this.humans()) {
      if (!p.alive || p.escaped) continue;
      // walked under a hole in the ceiling: something up there takes you
      // (it reaches 0.63 m out from the middle of the hole: half as far again as the tile's own edge + 12 cm)
      const h = holes.find(o => Math.abs(p.x - o.x) < (o.size / 2 + 0.12) * 1.5 && Math.abs(p.z - o.z) < (o.size / 2 + 0.12) * 1.5 && Math.abs(p.y) < 0.6);
      if (h) { this.snatch(p, 'ceiling', h.x, h.z); continue; }
      // down a pitfall
      if (p.y < -3) { p.brDeath = 'fell'; this.kill(p, null, 'fall', false); continue; }
      // through the exit door
      if (door) {
        const dx = p.x - door.x, dz = p.z - door.z;
        const ahead = dx * door.nx + dz * door.nz, side = Math.abs(-dx * door.nz + dz * door.nx);
        if (ahead < 0.9 && side < 1.1 && Math.abs(p.y) < 0.5) {
          p.escaped = true; p.alive = false; p.escapeTime = Math.round(this.timer);
          this.broadcast({ t: 'escaped', id: p.id, name: p.name, time: p.escapeTime });
          this.brCheck();
        }
      }
    }
  }

  // open or shut a door (players with E / the hand button, the monster when one is in its way)
  toggleDoor(i, open, by) {
    const d = this.world.doors[i], now = performance.now();
    if (!d || d.open === open || now - (this.doorAt[i] || 0) < 450) return false;
    if (!open && d.kind === 'way') {
      // nobody may be standing in the doorway when it shuts
      for (const q of this.players.values()) {
        if (!q.alive || q.escaped) continue;
        if (q.x > d.x0 - 0.45 && q.x < d.x1 + 0.45 && q.z > d.z0 - 0.45 && q.z < d.z1 + 0.45) {
          if (by && !by.bot) this.send(by.id, { t: 'toast', text: 'Something is in the way' });
          return false;
        }
      }
    }
    this.doorAt[i] = now;
    this.world.setDoor(i, open);
    // the door swings away from whoever moved it (a door to nowhere always opens outwards)
    const s = by ? Math.sign((by.x - d.cx) * d.nx + (by.z - d.cz) * d.nz) || 1 : 1;
    this.broadcast({ t: 'door', i, open, swing: d.kind === 'blank' ? 1 : -s, by: by ? by.id : null });
    // it hears doors
    const m = this.bots.get('monster');
    if (m && by && !by.bot) m.hearNoise(d.cx, d.cz, 14);
    return true;
  }

  // taken: by the thing in the ceiling, or by something round a corner. The body is never seen again.
  snatch(p, kind, x, z) {
    if (!p.alive || this.phase !== 'br') return;
    this.broadcast({ t: 'snatch', id: p.id, kind, x: r2(x), z: r2(z) });
    p.brDeath = kind;
    p.hp = 0;
    this.kill(p, null, kind, false);
  }

  // The corner snatch (once a game): two or more people walking together, the one behind watching the
  // one in front. As the one behind passes close to the outside corner of a wall, something reaches out
  // from just round the corner and takes them — but only if nobody at all is looking at that spot.
  cornerSnatch(now) {
    const hs = this.humans().filter(p => p.alive && !p.escaped);
    if (hs.length < 2 || !this.corners) return;
    const w = this.world, eye = q => q.y + EYE;
    const facing = (q, x, z) => { const dx = x - q.x, dz = z - q.z, d = Math.hypot(dx, dz) || 1; return (-Math.sin(q.yaw) * dx - Math.cos(q.yaw) * dz) / d; };
    for (const v of hs) {
      const tr = v.trail || [];
      if (tr.length < 12) continue;
      const back = tr[tr.length - 12], speed = Math.hypot(v.x - back.x, v.z - back.z) / Math.max(0.1, (now - back.t) / 1000);
      if (speed < 0.6) continue;
      // following someone: they're 1.5–8 m away, in front, and v is watching them
      const lead = hs.find(l => l !== v && Math.hypot(l.x - v.x, l.z - v.z) > 1.5 && Math.hypot(l.x - v.x, l.z - v.z) < 8
        && facing(v, l.x, l.z) > Math.cos(0.6) && (l.x - v.x) * (v.x - back.x) + (l.z - v.z) * (v.z - back.z) > 0
        && w.los(v.x, eye(v), v.z, l.x, l.y + 1.2, l.z));
      if (!lead) continue;
      for (const c of this.corners.near(v.x, v.z, 0.85)) {
        const key = `${c.x},${c.z}`;
        if (v.cornerTried === key) continue;     // one chance per corner as you pass it
        v.cornerTried = key;
        // just round the corner: beside one wall face, on the side v couldn't see a moment ago
        const spots = [[c.qx, -c.qz], [-c.qx, c.qz]].map(([sx, sz]) => ({ x: c.x + sx * 0.75, z: c.z + sz * 0.75 }))
          .filter(h => !w.blocked(h.x, h.z, 0.2, 0) && !w.isPit(h.x, h.z) && !w.los(back.x, 1.4, back.z, h.x, 1.2, h.z));
        const h = spots[0];
        if (!h || facing(v, h.x, h.z) > Math.cos(0.9)) continue;
        // nobody may be looking at that spot
        if (hs.some(q => q !== v && facing(q, h.x, h.z) > Math.cos(0.95) && w.los(q.x, eye(q), q.z, h.x, 1.2, h.z))) continue;
        if (Math.random() > 0.15) continue;      // only a chance, at each corner
        this.cornerUsed = true;
        this.snatch(v, 'corner', h.x, h.z);
        return;
      }
    }
  }

  // a paper note left on the floor or taped to a wall. m: { x, y, z, wall, nx, nz, yaw, text, img }
  onNote(p, m) {
    if (this.phase !== 'br' || !p.alive || p.escaped) return;
    const now = performance.now();
    if (now - (p.noteAt || 0) < 2500) { this.send(p.id, { t: 'toast', text: 'Wait a moment before leaving another note' }); return; }
    if (this.notes.filter(n => n.by === p.id).length >= 10) { this.send(p.id, { t: 'toast', text: 'You have left 10 notes already' }); return; }
    if (this.notes.length >= 80 || ![m.x, m.y, m.z, m.yaw].every(Number.isFinite)) return;
    if (Math.hypot(m.x - p.x, m.z - p.z) > 3 || m.y < -0.1 || m.y > 2.6) return;
    const img = typeof m.img === 'string' && m.img.startsWith('data:image/png;base64,') && m.img.length < 60000 ? m.img : '';
    const text = cleanChat(String(m.text || ''), 140);
    if (!text && !img) return;
    p.noteAt = now;
    const wall = !!m.wall;
    const note = {
      id: ++this.noteSeq, by: p.id, name: p.name, x: r2(m.x), y: r2(m.y), z: r2(m.z), wall, yaw: r2(m.yaw),
      nx: wall ? Math.sign(Number(m.nx) || 0) : 0, nz: wall ? Math.sign(Number(m.nz) || 0) : 0, text, img,
    };
    this.notes.push(note);
    this.broadcast({ t: 'note', note });
  }

  // the monster caught someone
  monsterKill(m, q) {
    if (!q.alive || this.phase !== 'br') return;
    q.brDeath = 'monster';
    q.hp = 0;
    this.kill(q, m, 'monster', false, [m.x, m.y + 1.4, m.z]);
  }

  // the monster has just spotted this player: they hear it scream
  monsterAlert(m, q) { this.send(q.id, { t: 'spotted' }); }

  // is anyone still inside? if not, the game is over (won if anyone got out)
  brCheck() {
    if (this.phase !== 'br' || this.brDone) return;
    const hs = this.humans();
    if (!hs.length || hs.some(p => p.alive && !p.escaped)) return;
    this.brDone = true;
    const out = hs.filter(p => p.escaped).length;
    this.later(2, () => { if (this.phase === 'br') this.matchOver(out ? 'escaped' : 'lost', out === hs.length ? 'all' : out ? 'some' : 'none'); });
  }

  brEnd() {
    this.bots.delete('monster');
    this.players.delete('monster');
    for (const p of this.humans()) { p.team = p.lobbyTeam === 'def' ? 'def' : 'atk'; p.escaped = false; p.w = STARTER_PISTOL[p.team]; }
    this.br = false;
  }

  dmOver(reason) {
    const humans = [...this.players.values()].filter(p => !p.dummy).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const tie = humans.length > 1 && humans[0].kills === humans[1].kills && humans[0].deaths === humans[1].deaths;
    this.matchOver(tie ? null : humans[0] && humans[0].id, tie ? 'draw' : reason);
  }

  resetLoadout(p) {
    p.inv = { primary: null, secondary: null };
    p.ammo = {};
    p.armor = 0; p.helmet = false; p.kit = false;
  }

  startMatch() {
    if (this.phase !== 'lobby') return;
    if (this.settings.mode === 'br' && !this.practice) return this.startBackrooms();
    if (this.settings.mode === 'dm' && !this.practice) return this.startDeathmatch();
    this.dm = false;
    this.variant = null;
    if (!this.practice && (this.teamCount('atk') === 0 || this.teamCount('def') === 0)) {
      this.send(this.ownerId, { t: 'toast', text: 'You need at least one player on each team.' });
      return;
    }
    this.fixMap();
    this.world = new World(MAPS[this.settings.map]);
    this.swapped = false;
    this.squadScore = [0, 0];
    this.ladder = [1, 1];
    this.updateScore();
    this.round = 0;
    for (const p of this.players.values()) {
      p.kills = 0; p.deaths = 0; p.hs = 0; p.dmg = 0; p.alive = false; p.squad = this.squadOf(p.team);
      p.money = MONEY.start;
      this.resetLoadout(p);
    }
    this.phase = 'starting';
    this.drops.clear();
    this.broadcast(this.startMsg());
    this.newRound();
  }

  // practice range: the map to yourself (and invited friends) plus bot targets.
  // bots: how many (0 = none); behavior: 'still' targets, 'move' around, or 'shoot' back
  startPractice(map, bots = 7, behavior = 'still', level = 'normal') {
    this.settings.map = MAPS[map] && !isDmMap(map) ? map : 'outpost';
    this.world = new World(MAPS[this.settings.map]);
    this.phase = 'practice';
    this.round = 1;
    const spots = [];
    const w = this.world;
    for (const s of w.spawns.def.slice(0, 2)) spots.push([s.x, s.z]);
    const site = w.sites.A;
    for (const [dx, dz] of [[-4, -3], [4, 1], [0, 5], [-6, 4]]) spots.push([site.x + dx, site.z + dz]);
    spots.push([w.centre.x, w.centre.z - 3]);
    const ok = spots.filter(([x, z]) => !w.blocked(x, z, 0.4, 0) && this.navGrid().nearest(x, 0, z) >= 0);
    // more bots than spots: add random places on the map, away from the attacker spawn
    const nav = this.navGrid();
    while (ok.length < bots) {
      const i = nav.randomNode((x, y, z) => y < 0.1 && !w.nearSpawn('atk', x, z, 14));
      ok.push([nav.x[i], nav.z[i]]);
    }
    const guns = ['ak47', 'm4a4', 'mp9', 'deagle', 'galil', 'm4a1s', 'mac10', 'usp'];
    ok.slice(0, bots).forEach(([x, z], i) => {
      const armor = i % 2 === 0;
      const p = this.addBot('def', {
        dummy: true, home: [x, z], x, y: w.groundAt(x, z, 0.38, 0), z, alive: true,
        yaw: Math.atan2(x - w.centre.x, z - w.centre.z), armor: armor ? 100 : 0, helmet: armor,
        inv: { primary: guns[i % guns.length] === 'usp' || guns[i % guns.length] === 'deagle' ? null : guns[i % guns.length], secondary: 'usp' },
      }, { kind: 'range', behavior, level }, armor ? ' (armour)' : '');
      p.w = p.inv.primary || p.inv.secondary;
    });
    this.broadcast(this.startMsg());
    this.broadcastRoster();
    for (const p of this.players.values()) if (!p.dummy) this.respawn(p);
    this.bomb = this.freshBomb();
    this.giveBomb();
  }

  giveBomb() {
    const atk = [...this.players.values()].filter(p => p.team === 'atk' && p.alive && !p.dummy);
    if (!atk.length) return;
    const c = atk[Math.floor(Math.random() * atk.length)];
    Object.assign(this.bomb, { state: 'carried', carrier: c.id, prog: 0, user: null });
  }

  respawn(p) {
    if (!this.players.has(p.id)) return;
    p.hp = 100; p.alive = true;
    const brain = this.bots.get(p.id);
    if (brain) p.light = !!this.settings.night;
    if (p.dummy) {
      p.x = p.home[0]; p.z = p.home[1]; p.y = this.world.groundAt(p.x, p.z, 0.38, 0);
      p.armor = p.helmet ? 100 : 0;
      p.ammo = {};
      if (brain) brain.reset();
      return;
    }
    if (brain) this.later(0, () => brain.reset());
    if (this.dm) {
      // deathmatch: your chosen guns, full armour and a helmet, at the safest spawn
      const lo = p.dmLoadout || DM_LOADOUT;
      p.inv = { primary: lo.primary, secondary: lo.secondary };
      p.w = p.inv.primary || p.inv.secondary;
      p.armor = 100; p.helmet = true; p.kit = false; p.ammo = {};
      const s = this.dmSpawn(p);
      p.x = s.x; p.y = 0; p.z = s.z;
      p.yaw = Number.isFinite(s.yaw) ? s.yaw : 0;
      this.send(p.id, { t: 'spawn', x: r2(s.x), y: 0, z: r2(s.z), yaw: p.yaw, rd: this.round });
      this.sendInv(p, [p.inv.primary, p.inv.secondary].filter(Boolean));
      return;
    }
    if (!p.inv.secondary) p.inv.secondary = STARTER_PISTOL[p.team];
    if (!p.inv.primary && !p.inv.secondary) p.inv.secondary = STARTER_PISTOL[p.team];
    if (p.w !== p.inv.primary && p.w !== p.inv.secondary) p.w = p.inv.primary || p.inv.secondary;
    const list = this.world.spawns[p.team];
    const s = list[Math.floor(Math.random() * list.length)];
    p.x = s.x; p.y = 0; p.z = s.z;
    this.send(p.id, { t: 'spawn', x: r2(s.x), y: 0, z: r2(s.z), yaw: this.world.spawnYaw(p.team), rd: this.round });
    this.sendInv(p, [p.inv.primary, p.inv.secondary].filter(Boolean));
    if (this.practice && this.bomb.state === 'none') this.giveBomb();
  }

  newRound() {
    // bots whose spot a friend has taken leave now, before the round starts
    for (const [id, brain] of [...this.bots]) if (brain.leaving) { this.bots.delete(id); this.players.delete(id); }
    if (this.botCfg) this.broadcastRoster();
    this.round++;
    this.phase = 'freeze';
    this.timer = RULES.freezeTime;
    this.roundStart = performance.now();
    this.bomb = this.freshBomb();
    this.roundPlanted = false;
    this.clearDrops();
    for (const p of this.players.values()) { p.bought = {}; if (p.bot) p.light = !!this.settings.night; }
    const spawns = {};
    for (const team of ['atk', 'def']) {
      const list = this.world.spawns[team].slice().sort(() => Math.random() - 0.5);
      const members = [...this.players.values()].filter(p => p.team === team && !p.dummy);
      members.forEach((p, i) => {
        // survivors keep their weapons and whatever armour is left; the dead start over
        if (!p.alive) { this.resetLoadout(p); p.ammo = {}; }
        if (!p.inv.secondary) p.inv.secondary = STARTER_PISTOL[team];
        p.w = p.inv.primary || p.inv.secondary;
        const s = list[i % list.length];
        const ring = Math.floor(i / list.length);
        const x = s.x + (ring ? Math.cos(i) * 1.1 : 0), z = s.z + (ring ? Math.sin(i) * 1.1 : 0);
        Object.assign(p, { x, y: 0, z, hp: 100, alive: true, use: false, moved: 0 });
        spawns[p.id] = [r2(x), 0, r2(z), r2(this.world.spawnYaw(team))];
      });
    }
    this.giveBomb();
    this.broadcast({ t: 'round', round: this.round, spawns, carrier: this.bomb.carrier, score: this.score });
    for (const p of this.players.values()) if (!p.dummy) this.sendInv(p, [p.inv.primary, p.inv.secondary].filter(Boolean));
  }

  checkRoundEnd() {
    if (this.phase !== 'live' && this.phase !== 'planted' && this.phase !== 'freeze') return;
    // once the bomb is down, dead attackers don't end the round (it can still be defused or explode),
    // but with every defender down nobody can defuse it: the attackers win straight away
    if (this.phase === 'planted') {
      if (this.teamCount('def', true) === 0) { this.bomb.state = 'defused'; this.endRound('atk', 'elim'); }   // the bomb goes quiet
      return;
    }
    const atkAlive = this.teamCount('atk', true), defAlive = this.teamCount('def', true);
    if (atkAlive === 0) this.endRound('def', 'elim');
    else if (defAlive === 0) this.endRound('atk', 'elim');
  }

  endRound(winner, reason) {
    if (this.phase === 'end' || this.phase === 'over') return;
    const winSquad = this.squadOf(winner), loseSquad = 1 - winSquad;
    this.squadScore[winSquad]++;
    this.updateScore();
    this.phase = 'end';
    this.timer = RULES.endTime;

    // ---- money ----
    this.ladder[loseSquad] = Math.min(MONEY.lossLadder.length, this.ladder[loseSquad] + 1);
    const lossBonus = MONEY.lossLadder[this.ladder[loseSquad] - 1];
    this.ladder[winSquad] = Math.max(0, this.ladder[winSquad] - 1);
    const winLabel = { elim: 'Won the round', time: 'Won the round (time)', bomb: 'Bomb exploded', defuse: 'Bomb defused' };
    for (const p of this.players.values()) {
      if (p.dummy) continue;
      const items = [];
      if (p.team === winner) this.addMoney(p, MONEY.win[reason] || MONEY.win.elim, winLabel[reason] || 'Won the round', items);
      else {
        // attackers still alive when time runs out without a plant get nothing
        const saved = reason === 'time' && p.team === 'atk' && p.alive && !this.roundPlanted;
        this.addMoney(p, saved ? 0 : lossBonus, saved ? 'No loss bonus (survived without planting)' : 'Loss bonus', items);
        if (p.team === 'atk' && this.roundPlanted) this.addMoney(p, MONEY.plantTeamBonus, 'Team planted the bomb', items);
      }
      if (items.length) this.send(p.id, { t: 'income', items, money: p.money });
    }
    this.broadcast({ t: 'roundEnd', winner, reason, score: this.score });
  }

  // swap sides: everyone changes team, scores follow their squad, economy resets
  halftime() {
    this.swapped = true;
    this.ladder = [1, 1];
    for (const p of this.players.values()) {
      if (p.dummy) continue;
      p.team = p.team === 'atk' ? 'def' : 'atk';
      p.money = MONEY.start;
      this.resetLoadout(p);
      p.alive = false;
    }
    this.updateScore();
    this.broadcastRoster();
    this.broadcast({ t: 'halftime', score: this.score });
  }

  // winner: a team ('atk' / 'def') in 2v2, a player id in deathmatch, null for a draw
  matchOver(winner, reason) {
    this.phase = 'over';
    const stats = [...this.players.values()].filter(p => !p.dummy && !(this.br && p.bot))
      .map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, hs: p.hs, dmg: p.dmg }));
    if (this.br) for (const s of stats) { const p = this.players.get(s.id); s.escaped = !!(p && p.escaped); s.time = p && p.escapeTime; s.how = p && p.brDeath; }
    this.broadcast({ t: 'over', winner, reason, score: this.score, stats, mode: this.br ? 'br' : this.dm ? 'dm' : 'wingman', time: this.br ? Math.round(this.timer) : undefined });
  }

  toLobby() {
    this.phase = 'lobby';
    if (this.br) this.brEnd();
    if (this.dm) {
      // back to the 2v2 teams everyone had before the deathmatch
      for (const p of this.players.values()) if (!p.dummy) p.team = p.lobbyTeam === 'def' ? 'def' : 'atk';
      this.dm = false;
    }
    this.bomb = this.freshBomb();
    this.drops.clear();
    for (const p of this.players.values()) p.alive = false;
    this.broadcast({ t: 'lobby' });
    this.broadcastRoster();
  }

  // ---------- simulation ----------
  tick() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.pending.length) {
      const due = this.pending.filter(([t]) => t <= now);
      this.pending = this.pending.filter(([t]) => t > now);
      due.forEach(([, fn]) => fn());
    }
    // measure round-trip time to every remote player every 2 s (works in the lobby too)
    this.pingTimer = (this.pingTimer || 0) - dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2;
      for (const p of this.players.values()) if (!p.dummy && p.id !== this.localId) this.send(p.id, { t: 'ping', ts: now });
    }
    if (!this.world || this.phase === 'lobby') return;
    if (this.bots.size) for (const brain of this.bots.values()) brain.update(dt, now / 1000);
    if (this.phase !== 'over') this.autoPickup();
    // waiting for a team that left: the clocks stand still until they are back or the minute is up
    if (this.hold) {
      if (!['freeze', 'live', 'planted', 'end'].includes(this.phase)) this.hold = null;
      else if (now >= this.hold.until) {
        this.hold = null;
        if (this.teamCount('atk') === 0 || this.teamCount('def') === 0) { this.matchOver(this.teamCount('atk') === 0 ? 'def' : 'atk', 'forfeit'); return; }
      } else { this.snapshot(); for (const p of this.players.values()) p.moved = 0; return; }
    }

    switch (this.phase) {
      case 'freeze':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'live';
          this.timer = RULES.roundTime;
          this.broadcast({ t: 'phase', phase: 'live' });
        }
        break;
      case 'live':
        this.timer -= dt;
        this.bombLogic(dt);
        if (this.phase === 'live' && this.timer <= 0) this.endRound('def', 'time');
        break;
      case 'planted':
        this.bombLogic(dt);
        break;
      case 'practice':
        this.bombLogic(dt);
        break;
      case 'dm':
        this.timer -= dt;
        if (this.timer <= 0) this.dmOver('time');
        break;
      case 'br':
        this.timer += dt;      // the clock counts up: how long you have been in there
        this.brTick();
        break;
      case 'end':
        this.timer -= dt;
        if (this.timer <= 0) {
          const win = this.squadScore.findIndex(v => v >= this.settings.winRounds);
          if (win >= 0) this.matchOver(this.sideOf(win), 'score');
          else if (this.round >= RULES.maxRounds) this.matchOver(null, 'draw');
          else {
            if (!this.swapped && this.round === RULES.halftimeAfter) this.halftime();
            this.newRound();
          }
        }
        break;
    }
    this.snapshot();
    for (const p of this.players.values()) p.moved = 0;
  }

  // is the player looking roughly at the bomb? (looking away cancels a defuse)
  lookingAt(p, b) {
    const ex = p.x, ey = p.y + 1.5, ez = p.z;
    const dx = b.x - ex, dy = b.y + 0.15 - ey, dz = b.z - ez;
    const d = Math.hypot(dx, dy, dz) || 1;
    const fx = -Math.sin(p.yaw) * Math.cos(p.pitch), fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * Math.cos(p.pitch);
    return (dx * fx + dy * fy + dz * fz) / d > 0.5;
  }

  bombLogic(dt) {
    const b = this.bomb;
    const w = this.world;
    if (b.state === 'dropped') {
      for (const p of this.players.values()) {
        if (p.id === b.droppedBy && performance.now() < (b.dropUntil || 0)) continue;
        if (p.team === 'atk' && p.alive && !p.dummy && Math.hypot(p.x - b.x, p.z - b.z) < 1.2 && Math.abs(p.y - b.y) < 2) {
          Object.assign(b, { state: 'carried', carrier: p.id });
          this.send(p.id, { t: 'toast', text: 'You picked up the bomb' });
          break;
        }
      }
    } else if (b.state === 'carried') {
      const c = this.players.get(b.carrier);
      if (c && c.alive && c.use && w.siteAt(c.x, c.z) && c.moved < 0.3) {
        b.user = c.id;
        b.prog += dt;
        if (b.prog >= RULES.plantTime) {
          const site = w.siteAt(c.x, c.z);
          Object.assign(b, { state: 'planted', carrier: null, x: c.x, y: c.y, z: c.z, site, prog: 0, user: null, timer: RULES.bombTime, planter: c.id });
          if (c.w === 'c4') c.w = this.bestWeapon(c);
          this.roundPlanted = true;
          if (!this.practice) this.phase = 'planted';
          this.addMoney(c, MONEY.plantBonus, 'Planted the bomb');
          this.broadcast({ t: 'planted', site, by: c.id, x: r2(c.x), y: r2(c.y), z: r2(c.z) });
        }
      } else { b.prog = 0; b.user = null; }
    } else if (b.state === 'planted') {
      b.timer -= dt;
      let defuser = null;
      for (const p of this.players.values()) {
        if ((p.team === 'def' || this.practice) && p.alive && !p.dummy && p.use && Math.hypot(p.x - b.x, p.z - b.z) < 2.2
          && Math.abs(p.y - b.y) < 2.2 && p.moved < 0.3 && this.lookingAt(p, b)) {
          if (!defuser || p.id === b.user) defuser = p;
        }
      }
      if (defuser) {
        if (b.user !== defuser.id) { b.user = defuser.id; b.prog = 0; }
        b.prog += dt;
        b.need = defuser.kit ? RULES.defuseKitTime : RULES.defuseTime;
        // a defuse that finishes on the same tick as the explosion still counts
        if (b.prog >= b.need) {
          b.state = 'defused';
          this.broadcast({ t: 'defused', by: defuser.id });
          this.addMoney(defuser, MONEY.defuseBonus, 'Defused the bomb');
          if (this.practice) this.later(3, () => { this.bomb = this.freshBomb(); this.giveBomb(); });
          else this.endRound('def', 'defuse');
          return;
        }
      } else { b.prog = 0; b.user = null; }
      if (b.timer <= 0) this.explode();
    }
  }

  explode() {
    const b = this.bomb;
    b.state = 'exploded';
    this.broadcast({ t: 'explode', x: r2(b.x), y: r2(b.y), z: r2(b.z) });
    const bf = blastField(this.world, b.x, b.y, b.z, RULES.blastMax * 1.6);
    // the shockwave travels outwards, so people further away are hit a moment later
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const dmg = blastDamage(bf, p.x, p.y, p.z, p.armor, RULES);
      if (dmg < 1) continue;
      const delay = Math.min(0.6, Math.hypot(p.x - b.x, p.z - b.z) / 45);
      this.later(delay, () => {
        if (!p.alive) return;
        p.hp = Math.max(0, p.hp - dmg);
        if (!p.dummy) this.send(p.id, { t: 'hurt', hp: p.hp, armor: p.armor, part: 'chest', armored: true, from: [r2(b.x), r2(b.z)], blast: 1 });
        if (p.hp <= 0) this.kill(p, null, 'bomb', false, [b.x, b.y + 0.3, b.z]);
      });
    }
    if (this.practice) this.later(3, () => { this.bomb = this.freshBomb(); this.giveBomb(); });
    else this.endRound('atk', 'bomb');
  }

  snapshot() {
    const ps = [];
    for (const p of this.players.values()) {
      ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), p.alive ? 1 : 0, p.hp, p.w, p.kills, p.deaths,
        p.team === 'atk' ? 0 : p.team === 'def' ? 1 : p.team === 'monster' ? 3 : 2, p.use ? 1 : 0, p.ping, p.armor | 0,
        (p.helmet ? 1 : 0) | (p.kit ? 2 : 0) | (p.light ? 4 : 0) | (p.escaped ? 8 : 0), p.money | 0]);
    }
    const b = this.bomb;
    const timeLeft = this.phase === 'planted' || (this.practice && b.state === 'planted') ? b.timer : this.timer;
    this.broadcast({
      t: 'snap', ph: this.phase, tl: r2(Math.max(0, timeLeft)), rd: this.round, sc: [this.score.atk, this.score.def],
      bs: Math.round((performance.now() - (this.roundStart || 0)) / 100) / 10,
      b: [BOMB_STATES.indexOf(b.state), b.carrier, r2(b.x), r2(b.y), r2(b.z), r2(b.prog), b.user, b.site, b.need || RULES.defuseTime],
      p: ps,
    });
  }
}

export { BOMB_STATES, CELL };
