// DOM heads-up display + radar.
import { CELL } from './world.js';
import { TEAM_COLORS } from './models.js';
import { itemName, WEAPON_ICONS } from './weapons.js';
import { drawCrosshair, crosshairCfg } from './crosshair.js';
import { icon, iconHTML } from './icons.js';

const $ = (id) => document.getElementById(id);
export const TEAM_NAMES = { atk: 'Attackers', def: 'Defenders' };

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtPing(p) {
  if (p === 'host') return 'HOST';
  if (p === 'bot') return 'BOT';
  return Number.isFinite(p) && p > 0 ? `${Math.round(p)}` : '—';
}
function pingClass(p) {
  if (!Number.isFinite(p) || p <= 0) return '';
  return p < 80 ? 'good' : p < 160 ? 'ok' : 'bad';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Top-down picture of a map: ground, upper floors, walls, cover, roofs, bomb site.
export function drawMinimap(canvas, world) {
  const size = canvas.width;
  const g = canvas.getContext('2d');
  const scale = size / Math.max(world.width, world.depth);
  const ox = (size - world.width * scale) / 2, oy = (size - world.depth * scale) / 2;
  const colors = ['rgba(230,225,210,.6)', 'rgba(160,190,130,.75)', null, 'rgba(160,130,90,.8)', 'rgba(200,120,80,.55)'];
  const cs = CELL * scale;
  for (let iz = 0; iz < world.h; iz++) for (let ix = 0; ix < world.w; ix++) {
    const col = colors[world.cellKind(ix, iz)];
    if (!col) continue;
    g.fillStyle = col;
    g.fillRect(ox + ix * cs, oy + iz * cs, cs + 0.5, cs + 0.5);
  }
  // canals
  for (const w of world.water || []) {
    g.fillStyle = 'rgba(70,140,175,.8)';
    g.fillRect(ox + w.x0 * scale, oy + w.z0 * scale, (w.x1 - w.x0) * scale, (w.z1 - w.z0) * scale);
  }
  for (const r of world.siteRects) {
    g.fillStyle = 'rgba(240,110,80,.22)';
    g.fillRect(ox + r.x0 * scale, oy + r.z0 * scale, (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
    g.strokeStyle = 'rgba(240,110,80,.9)'; g.lineWidth = Math.max(1, size / 200);
    g.strokeRect(ox + r.x0 * scale, oy + r.z0 * scale, (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
    g.font = `bold ${Math.round(size / 10)}px system-ui`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(r.name, ox + world.sites[r.name].x * scale, oy + world.sites[r.name].z * scale);
  }
}

export class Hud {
  constructor() {
    this.el = $('hud');
    this.cache = {};
    this.centerTimer = 0;
    this.hitTimer = 0;
    this.radarBase = null;
  }

  set(id, value, prop = 'textContent') {
    const key = id + prop;
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    $(id)[prop] = value;
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  setHealth(hp) {
    this.set('hp-value', String(Math.max(0, Math.round(hp))));
    const el = $('hp-bar');
    el.style.width = `${Math.max(0, hp)}%`;
    el.classList.toggle('low', hp <= 30);
  }

  // mag = null for the bomb (no ammo)
  setAmmo(weapon, mag, res, reloading, mode = '') {
    const noAmmo = mag == null;
    this.set('ammo-mag', noAmmo ? icon(weapon === 'spoon' ? 'spoon' : 'bomb') : reloading ? '··' : String(mag), 'innerHTML');
    this.set('ammo-res', noAmmo ? '' : `/ ${res}`);
    this.set('weapon-name', itemName(weapon));
    this.set('fire-mode', mode);
    $('ammo').classList.toggle('empty', mag === 0 && !reloading);
  }

  setArmor(armor, helmet) {
    this.set('armor-value', String(Math.max(0, Math.round(armor))));
    $('armor').classList.toggle('none', armor <= 0);
    $('helmet-icon').classList.toggle('hidden', !helmet || armor <= 0);
  }

  setMoney(m, practice, dm) {
    $('econ').classList.toggle('hidden', !!dm);
    this.set('money', practice ? '$ ∞' : `$${Number(m).toLocaleString('en-US')}`);
  }

  kitIcon(on) { $('kit-icon').classList.toggle('hidden', !on); }

  income(items) {
    const box = $('income');
    for (const [label, amount] of items) {
      const row = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = `${amount < 0 ? '−' : '+'}$${Math.abs(amount)}`;
      if (amount < 0) b.className = 'neg';
      row.append(b, document.createTextNode(label));
      box.appendChild(row);
      setTimeout(() => row.remove(), 4000);
    }
    while (box.children.length > 6) box.firstChild.remove();
  }

  // Bomb blast preview: the part of your health bar the blast would take where you stand
  // (no text; the whole bar flashes red if it would kill you). dmg = null hides it.
  blastPreview(dmg, hp) {
    const ghost = $('hp-ghost');
    if (dmg == null) {
      ghost.style.width = '0'; $('hp').classList.remove('lethal');
      return;
    }
    const lethal = dmg >= hp;
    const take = Math.min(hp, dmg);
    ghost.style.width = `${take}%`;
    ghost.style.right = `${100 - hp}%`;
    $('hp').classList.toggle('lethal', lethal);
  }

  damagePop(dmg, head) {
    const el = $('dmg-pop');
    el.textContent = `-${dmg}`;
    el.className = head ? 'head' : '';
    void el.offsetWidth;
    el.classList.add('show');
  }

  setTimer(sec, planted) {
    this.set('timer', planted ? `${icon('bomb')} ${fmtTime(sec)}` : fmtTime(sec), 'innerHTML');
    $('timer').classList.toggle('planted', !!planted);
  }

  // deathmatch top bar: my kills on the left, the best other player on the right
  setDeathmatch(mine, best, bestName, limit) {
    this.set('tname-atk', 'YOU');
    this.set('tname-def', 'BEST');
    this.set('score-atk', String(mine));
    this.set('score-def', String(best));
    this.set('round-no', `First to ${limit}`);
    this.set('alive-atk', '');
    this.set('alive-def', bestName ? bestName.slice(0, 10) : '');
    this.set('team-label', 'Deathmatch');
    $('team-label').style.color = TEAM_COLORS.ffa.css;
  }

  // Backrooms top bar: how many are still inside, and how many have got out
  setBackrooms(inside, out, step = 'Find the exit') {
    this.set('tname-atk', 'INSIDE');
    this.set('tname-def', 'OUT');
    this.set('score-atk', String(inside));
    this.set('score-def', String(out));
    this.set('round-no', step);
    this.set('alive-atk', '');
    this.set('alive-def', '');
    this.set('team-label', 'The Backrooms');
    $('team-label').style.color = '#e8dc8a';
  }

  setScore(score, round, alive, myTeam, practice) {
    this.set('tname-atk', 'ATK');
    this.set('tname-def', 'DEF');
    this.set('score-atk', String(score[0]));
    this.set('score-def', String(score[1]));
    this.set('round-no', practice ? 'Practice' : `Round ${round}`);
    this.set('alive-atk', practice ? '' : `${alive.atk} alive`);
    this.set('alive-def', practice ? '' : `${alive.def} alive`);
    this.set('team-label', `You: ${TEAM_NAMES[myTeam]}`);
    $('team-label').style.color = TEAM_COLORS[myTeam].css;
  }

  killfeed(killer, victim, weapon, head) {
    if (weapon === 'ceiling' || weapon === 'corner') return;     // nobody saw what happened
    const row = document.createElement('div');
    row.className = 'kf';
    // weapon silhouette (or the bomb), a headshot mark, then the victim
    const wIcon = WEAPON_ICONS[weapon] ? `<svg class="kf-icon" viewBox="0 0 120 40" aria-label="${esc(itemName(weapon))}">${WEAPON_ICONS[weapon]}</svg>`
      : `<span class="kf-w">${weapon === 'bomb' ? icon('blast') : weapon === 'monster' ? icon('skull') : weapon === 'fall' ? 'fell' : esc(itemName(weapon))}</span>`;
    const col = t => (TEAM_COLORS[t] || TEAM_COLORS.ffa).css;
    const k = killer ? `<b style="color:${col(killer.team)}">${esc(killer.name)}</b> ` : '';
    row.innerHTML = `${k}${wIcon}${head ? `<span class="kf-hs" title="Headshot">${icon('star')}</span>` : ''} <b style="color:${col(victim.team)}">${esc(victim.name)}</b>`;
    const feed = $('killfeed');
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 6000);
  }

  center(text, sub = '', color = '#fff', seconds = 3) {
    $('center-msg').innerHTML = iconHTML(text);
    $('center-msg').style.color = color;
    $('center-sub').innerHTML = iconHTML(sub);
    $('center').classList.remove('hidden');
    this.centerTimer = seconds;
  }

  progress(label, frac) {
    const el = $('progress');
    if (frac == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.set('progress-label', label);
    $('progress-fill').style.width = `${Math.min(100, frac * 100)}%`;
  }

  hint(text) {
    this.set('hint', iconHTML(text || ''), 'innerHTML');
    $('hint').classList.toggle('hidden', !text);
  }

  // spread: how far the crosshair opens (pixels) from moving / shooting; cfg: the player's crosshair settings;
  // ox, oy: where the next bullet goes relative to the screen centre (pixels), used by "follow recoil"
  crosshair(spread, visible, cfg, ox = 0, oy = 0) {
    const el = $('crosshair');
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    const c = crosshairCfg(cfg);
    if (!c.recoil) ox = oy = 0;
    const mx = Math.round(ox * 2) / 2, my = Math.round(oy * 2) / 2;
    if (this.cache.xhPos !== mx + ',' + my) {
      this.cache.xhPos = mx + ',' + my;
      el.style.transform = `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`;
    }
    const key = JSON.stringify(c) + '|' + (c.dynamic ? Math.round(spread) : 0);
    if (this.cache.xh === key) return;
    this.cache.xh = key;
    drawCrosshair(el, c, spread);
  }

  // chat line: name in team colour, message text; fades after 10 s
  chatLine(m, myTeam) {
    const feed = $('chat-feed');
    const row = document.createElement('div');
    row.className = 'chat-line';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = (m.dead ? icon('skull') + ' ' : '') + (m.toTeam ? '(team)' : '');
    const name = document.createElement('b');
    name.style.color = (TEAM_COLORS[m.team] || TEAM_COLORS.ffa).css;
    name.textContent = m.name + ': ';
    row.append(tag, name, document.createTextNode(m.text));
    feed.appendChild(row);
    while (feed.children.length > 7) feed.firstChild.remove();
    setTimeout(() => row.classList.add('fade'), 10000);
    setTimeout(() => row.remove(), 10700);
    void myTeam;
  }

  hitmarker(head, kill) {
    const el = $('hitmarker');
    el.className = kill ? 'kill' : head ? 'head' : '';
    void el.offsetWidth;
    el.classList.add('show');
  }

  scope(on) { $('scope').classList.toggle('hidden', !on); }

  hurt(angleDeg) {
    const el = document.createElement('div');
    el.className = 'hurt-arc';
    el.style.transform = `translate(-50%,-50%) rotate(${angleDeg}deg)`;
    $('hurt').appendChild(el);
    setTimeout(() => el.remove(), 900);
    const f = $('flash');
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  bombIcon(on) { $('bomb-icon').classList.toggle('hidden', !on); }

  death(text) {
    $('death').classList.toggle('hidden', !text);
    if (text) this.set('death-text', text);
  }

  buyButton(on) { $('buy-chip').classList.toggle('hidden', !on); }

  // money is only shown for your own team
  scoreboard(visible, players, score, myTeam, dm = false) {
    const el = $('scoreboard');
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (dm) {
      // one free-for-all table, most kills first
      const rows = players.filter(p => !p.dummy).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((p, i) => `<tr class="${p.alive ? '' : 'dead'}${p.me ? ' me' : ''}"><td>${i + 1}. ${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td><td class="ping ${pingClass(p.ping)}">${fmtPing(p.ping)}</td></tr>`).join('');
      const html = `<div class="sb-team" style="--tc:${TEAM_COLORS.ffa.css}"><h3>Deathmatch</h3>
        <table><tr><th>Player</th><th>K</th><th>D</th><th>Ping</th></tr>${rows}</table></div>`;
      if (this.cache.sb !== html) { el.innerHTML = html; this.cache.sb = html; }
      return;
    }
    const rows = (team) => players.filter(p => p.team === team && !p.dummy)
      .sort((a, b) => b.kills - a.kills)
      .map(p => `<tr class="${p.alive ? '' : 'dead'}${p.me ? ' me' : ''}"><td>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td><td class="money">${team === myTeam && Number.isFinite(p.money) ? '$' + p.money : ''}</td><td class="ping ${pingClass(p.ping)}">${fmtPing(p.ping)}</td></tr>`).join('');
    const html = ['atk', 'def'].map((t, i) => `
      <div class="sb-team" style="--tc:${TEAM_COLORS[t].css}">
        <h3>${TEAM_NAMES[t]} <span>${score[i]}</span></h3>
        <table><tr><th>Player</th><th>K</th><th>D</th><th>$</th><th>Ping</th></tr>${rows(t)}</table>
      </div>`).join('');
    if (this.cache.sb !== html) { el.innerHTML = html; this.cache.sb = html; }
  }

  tick(dt) {
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) $('center').classList.add('hidden');
    }
  }

  // ---------- radar ----------
  prepareRadar(world) {
    const c = $('radar');
    const size = 320;
    c.width = c.height = size;
    const base = document.createElement('canvas');
    base.width = base.height = size;
    drawMinimap(base, world);
    const scale = size / Math.max(world.width, world.depth);
    this.radarBase = base;
    this.radarMap = { scale, ox: (size - world.width * scale) / 2, oy: (size - world.depth * scale) / 2 };
  }

  drawRadar(me, mates, bomb) {
    const c = $('radar');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (!this.radarBase) return;
    g.drawImage(this.radarBase, 0, 0);
    const { scale, ox, oy } = this.radarMap;
    const P = (x, z) => [ox + x * scale, oy + z * scale];
    for (const m of mates) {
      const [x, y] = P(m.x, m.z);
      g.fillStyle = m.color;
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    }
    if (bomb) {
      const [x, y] = P(bomb.x, bomb.z);
      g.fillStyle = bomb.planted ? '#ff3b2f' : '#ffb347';
      g.fillRect(x - 6, y - 6, 12, 12);
    }
    if (me) {
      const [x, y] = P(me.x, me.z);
      g.save();
      g.translate(x, y); g.rotate(-me.yaw);
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill();
      g.restore();
    }
  }
}
