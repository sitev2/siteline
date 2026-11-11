// Admin screen (read-only), only for the accounts listed in supabase.sql (public.admins).
// Shows game-wide numbers, the game servers and every player's stats and online status,
// to check for problems. No emails, passwords or chat text: the database never sends those.
import * as acct from './accounts.js';
import { CONFIG } from './config.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
let isAdmin = false;
let players = [];
let timer = null;
let hooks = null;   // { isOpen() }

export function initAdmin(h) {
  hooks = h;
  $('admin-refresh').addEventListener('click', refresh);
  $('admin-search').addEventListener('input', drawPlayers);
  acct.onAccountChange(check);
  check();
}

async function check() {
  isAdmin = false;
  if (acct.loggedIn()) {
    try { isAdmin = !!(await acct.isAdmin()); } catch (e) { isAdmin = false; }
  }
  $('btn-admin').classList.toggle('hidden', !isAdmin);
}

export function openAdmin() {
  refresh();
  clearInterval(timer);
  timer = setInterval(() => { if (hooks.isOpen()) refresh(); else { clearInterval(timer); timer = null; } }, 15000);
}

const num = (n) => Number(n || 0).toLocaleString();
function when(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function cell(tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

async function refresh() {
  $('admin-msg').textContent = 'Loading…';
  $('admin-msg').classList.remove('bad');
  try {
    const [o, list] = await Promise.all([acct.adminOverview(), acct.adminPlayers()]);
    players = list || [];
    drawOverview(o);
    drawPlayers();
    $('admin-msg').textContent = `Updated ${new Date().toLocaleTimeString()} · refreshes every 15 s while open`;
  } catch (e) {
    $('admin-msg').textContent = e.message;
    $('admin-msg').classList.add('bad');
  }
  checkServers();
}

function drawOverview(o) {
  const free = 500;   // MB on Supabase's free plan
  const rows = [
    ['Players', num(o.players)], ['Online now', num(o.online_now)], ['Active today', num(o.active_24h)],
    ['Active this week', num(o.active_7d)], ['New this week', num(o.new_7d)], ['Matches (all time)', num(o.matches)],
    ['Players who finished a match today', num(o.matches_24h)], ['Kills (all time)', num(o.kills)],
    ['Friendships', num(o.friendships)], ['Friend requests waiting', num(o.pending_requests)],
    ['Game invites open', num(o.invites_now)], ['Messages today', num(o.messages_24h)], ['Messages this week', num(o.messages_7d)],
    ['Balance handed out', `$${(o.balance_total / 100).toFixed(2)}`],
    ['Database size', `${o.db_mb} MB of ${free} MB (${Math.round(o.db_mb / free * 100)}%)`],
  ];
  const g = $('admin-stats');
  g.innerHTML = '';
  for (const [k, v] of rows) {
    const d = cell('div', '', 'stat');
    d.append(cell('small', k), cell('b', v));
    g.appendChild(d);
  }
  const acts = Object.entries(o.activities || {}).sort((a, b) => b[1] - a[1]);
  $('admin-activity').textContent = acts.length ? `Right now: ${acts.map(([a, n]) => `${n} ${a.toLowerCase()}`).join(' · ')}` : 'Nobody is online right now.';
}

function drawPlayers() {
  const q = $('admin-search').value.trim().toLowerCase();
  const list = players.filter(p => !q || p.username.toLowerCase().includes(q));
  const body = $('admin-players');
  body.innerHTML = '';
  for (const p of list) {
    const tr = document.createElement('tr');
    if (p.online) tr.className = 'online';
    const name = cell('td', '');
    const dot = cell('span', '', 'fdot');
    name.append(dot, document.createTextNode(` ${p.username}${p.admin ? ' (admin)' : ''}`));
    const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : String(p.kills);
    const hs = p.kills ? `${Math.round(p.headshots / p.kills * 100)}%` : '—';
    const fav = Object.entries(p.weapon_kills || {}).sort((a, b) => b[1] - a[1])[0];
    tr.append(
      name,
      cell('td', p.online ? (p.activity || 'Online') : when(p.last_seen)),
      cell('td', new Date(p.created_at).toLocaleDateString()),
      cell('td', `${num(p.matches_played)} (${num(p.matches_won)} won)`),
      cell('td', `${num(p.kills)} / ${num(p.deaths)}`),
      cell('td', kd),
      cell('td', hs),
      cell('td', num(p.dm_wins)),
      cell('td', fav && WEAPONS[fav[0]] ? WEAPONS[fav[0]].name : '—'),
      cell('td', when(p.last_report)),
      cell('td', num(p.friends)),
      cell('td', num(p.messages_7d)),
      cell('td', `$${(p.balance_cents / 100).toFixed(2)}`),
    );
    body.appendChild(tr);
  }
  $('admin-count').textContent = q ? `${list.length} of ${players.length} players` : `${players.length} players`;
}

// the game servers from config.js: do they answer from this network, and how fast?
async function checkServers() {
  const ul = $('admin-servers');
  const list = (CONFIG.servers || []).filter(s => s && s.url);
  if (!list.length) { ul.innerHTML = '<li>No game servers set up (direct connections only).</li>'; return; }
  ul.innerHTML = '';
  for (const s of list) {
    const li = cell('li', `${s.name}: checking…`);
    ul.appendChild(li);
    const t0 = performance.now();
    const ctrl = new AbortController();
    const stop = setTimeout(() => ctrl.abort(), 20000);
    fetch(s.url.replace(/^ws(s?):\/\//i, 'http$1://'), { cache: 'no-store', signal: ctrl.signal })
      .then(r => r.text())
      .then(t => {
        const ms = Math.round(performance.now() - t0);
        const rooms = /Rooms: (\d+)/.exec(t), online = /Players online: (\d+)/.exec(t);
        li.textContent = /SITELINE server is running/.test(t)
          ? `${s.name}: running ✓ · answered in ${ms} ms${ms > 3000 ? ' (it was probably asleep)' : ''} · ${rooms ? rooms[1] : '?'} rooms · ${online ? online[1] : '?'} players`
          : `${s.name}: answered, but not with the SITELINE status page`;
        li.className = 'ok';
      })
      .catch(() => { li.textContent = `${s.name}: no answer from this network (offline, asleep for too long, or blocked)`; li.className = 'bad'; })
      .finally(() => clearTimeout(stop));
  }
}
