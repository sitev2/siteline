// Friends: add by username, see who's online and what they're doing, look at their stats,
// invite them to the game you're in (they get a "Join" pop-up instead of typing the code),
// and chat with them (messages are deleted after a week; the swear filter runs on every message).
// Everything goes through Supabase (accounts.js → the functions in supabase.sql). While logged in,
// the game says "I'm online" every 20 s; friends count as online for 90 s after the last one.
import * as acct from './accounts.js';
import { WEAPONS } from './weapons.js';
import { cleanChat } from './filter.js';

const $ = (id) => document.getElementById(id);
const BEAT_MS = 20000;
const LIST_MS = 10000;
const CHAT_MS = 3000;

let hooks = null;          // { joinGame(code), activity(), roomCode(), toast(text), openAccount(), isOpen() }
let beatTimer = null, listTimer = null;
let friends = [];
let requests = 0;
let shownInvites = new Set();   // invite ids already shown
let invite = null;              // the invite pop-up on screen: { id, from, code }
let openStats = null;           // friend id whose stats are expanded
let confirmRemove = null;       // friend id waiting for "Yes, remove"
let lastError = '';
let unread = {};                // friend id → unread messages
let chatWith = null;            // friend we're chatting with
let chatMsgs = [], chatLast = 0, chatTimer = null, sending = false;

export function initFriends(h) {
  hooks = h;
  $('friend-add').addEventListener('click', add);
  $('friend-name').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  $('friends-login').addEventListener('click', () => hooks.openAccount());
  $('invite-pop-join').addEventListener('click', joinInvite);
  $('invite-pop-close').addEventListener('click', () => closeInvite(true));
  $('fchat-back').addEventListener('click', closeChat);
  $('fchat-send').addEventListener('click', send);
  $('fchat-input').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') send(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  acct.onAccountChange(onAccount);
  onAccount();
}

function onAccount() {
  clearInterval(beatTimer);
  beatTimer = null;
  friends = []; requests = 0; shownInvites = new Set(); unread = {};
  closeChat();
  closeInvite(false);
  if (acct.loggedIn()) {
    beat();
    beatTimer = setInterval(beat, BEAT_MS);
  }
  updateBadge();
  if (hooks.isOpen()) render();
}

// ---------- "I'm online" + incoming requests and invites ----------
async function beat() {
  if (!acct.loggedIn()) return;
  try {
    const r = await acct.heartbeat(hooks.activity());
    requests = r.requests | 0;
    const before = unread;
    unread = r.unread || {};
    if (chatWith) delete unread[chatWith.id];
    const fresh = Object.keys(unread).filter(id => unread[id] > (before[id] || 0));
    if (fresh.length && fresh.some(id => !friends.find(f => f.id === id))) await loadList();
    for (const id of fresh) {
      const f = friends.find(x => x.id === id);
      hooks.toast(`💬 New message from ${f ? f.username : 'a friend'}`, 4000);
    }
    updateBadge();
    if (fresh.length && hooks.isOpen() && !chatWith) render();
    for (const inv of r.invites || []) {
      if (shownInvites.has(inv.id)) continue;
      shownInvites.add(inv.id);
      showInvite(inv);
      break;   // one at a time
    }
  } catch (e) { /* offline or not set up yet: try again next time */ }
}
// call when the player starts/leaves a game so friends see it straight away
export function activityChanged() { if (acct.loggedIn()) beat(); }

function updateBadge() {
  const b = $('btn-friends');
  const online = friends.filter(f => f.state === 'friend' && f.online).length;
  const bits = [];
  const msgs = Object.values(unread).reduce((a, n) => a + (n | 0), 0);
  if (requests) bits.push(`${requests} request${requests > 1 ? 's' : ''}`);
  if (msgs) bits.push(`${msgs} new message${msgs > 1 ? 's' : ''}`);
  if (!bits.length && online) bits.push(`${online} online`);
  b.textContent = bits.length ? `Friends (${bits.join(', ')})` : 'Friends';
  b.classList.toggle('has-news', !!(requests || msgs));
  const lb = $('btn-invite-friends');
  if (lb) lb.classList.toggle('hidden', !acct.loggedIn());
}

// ---------- invite pop-up ----------
function showInvite(inv) {
  invite = inv;
  $('invite-pop-text').textContent = `${inv.from} invited you to their game`;
  $('invite-pop').classList.remove('hidden');
}
function closeInvite(dismiss) {
  if (dismiss && invite) acct.dismissInvite(invite.id).catch(() => {});
  invite = null;
  $('invite-pop').classList.add('hidden');
}
function joinInvite() {
  if (!invite) return;
  const code = invite.code;
  closeInvite(true);
  hooks.joinGame(code);
}

// ---------- the Friends screen ----------
export function openFriends() {
  closeChat();
  render();
  refresh();
  clearInterval(listTimer);
  listTimer = setInterval(() => { if (hooks.isOpen()) refresh(); else { clearInterval(listTimer); listTimer = null; } }, LIST_MS);
}

async function loadList() {
  try {
    friends = await acct.friendList() || [];
    lastError = '';
  } catch (e) { lastError = e.message; }
}
async function refresh() {
  if (!acct.loggedIn()) return render();
  await loadList();
  updateBadge();
  if (chatWith) {
    const f = friends.find(x => x.id === chatWith.id);
    if (!f || f.state !== 'friend') return closeChat();
    chatWith = f;
    chatHeader();
  } else render();
}

// ---------- chat ----------
function openChat(f) {
  chatWith = f;
  chatMsgs = []; chatLast = 0;
  delete unread[f.id];
  updateBadge();
  $('friends-main').classList.add('hidden');
  $('fchat-view').classList.remove('hidden');
  chatHeader();
  $('fchat-log').innerHTML = '<p class="empty">Loading…</p>';
  $('fchat-msg').textContent = 'Messages are deleted after a week.';
  $('fchat-msg').classList.remove('bad');
  loadChat();
  clearInterval(chatTimer);
  chatTimer = setInterval(() => { if (chatWith && hooks.isOpen()) loadChat(); else closeChat(); }, CHAT_MS);
  if (!matchMedia('(pointer: coarse)').matches) $('fchat-input').focus();
}
function closeChat() {
  clearInterval(chatTimer);
  chatTimer = null;
  const was = !!chatWith;
  chatWith = null;
  $('fchat-view').classList.add('hidden');
  $('friends-main').classList.remove('hidden');
  if (was) render();
}
function chatHeader() {
  $('fchat-name').textContent = chatWith.username;
  const st = $('fchat-status');
  st.textContent = chatWith.online ? (chatWith.activity || 'Online') : ago(chatWith.last_seen);
  st.classList.toggle('on', !!chatWith.online);
}
async function loadChat() {
  const f = chatWith;
  if (!f) return;
  try {
    const add = await acct.chatHistory(f.id, chatLast) || [];
    if (f !== chatWith) return;
    if (add.length || !chatLast) {
      chatMsgs = chatMsgs.concat(add);
      if (add.length) chatLast = add[add.length - 1].id;
      drawChat();
    }
  } catch (e) {
    if (f === chatWith) chatNote(e.message, true);
  }
}
function chatNote(text, bad) {
  const m = $('fchat-msg');
  m.textContent = text;
  m.classList.toggle('bad', !!bad);
}
function drawChat() {
  const log = $('fchat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.innerHTML = '';
  if (!chatMsgs.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = `No messages yet. Say hi to ${chatWith.username}!`;
    log.appendChild(p);
    return;
  }
  let day = '';
  for (const m of chatMsgs) {
    const t = new Date(m.at);
    const d = t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    if (d !== day) {
      day = d;
      const sep = document.createElement('div');
      sep.className = 'fchat-day';
      sep.textContent = t.toDateString() === new Date().toDateString() ? 'Today' : d;
      log.appendChild(sep);
    }
    const b = document.createElement('div');
    b.className = m.mine ? 'bubble mine' : 'bubble';
    b.textContent = cleanChat(m.body, 200);
    const time = document.createElement('small');
    time.textContent = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    b.appendChild(time);
    log.appendChild(b);
  }
  if (atBottom || chatMsgs.length && chatMsgs[chatMsgs.length - 1].mine) log.scrollTop = log.scrollHeight;
}
async function send() {
  if (!chatWith || sending) return;
  const input = $('fchat-input');
  const text = cleanChat(input.value, 200);
  if (!text) { input.focus(); return; }
  sending = true;
  $('fchat-send').disabled = true;
  try {
    await acct.sendMessage(chatWith.id, text);
    input.value = '';
    chatNote('Messages are deleted after a week.');
    await loadChat();
    const log = $('fchat-log');
    log.scrollTop = log.scrollHeight;
  } catch (e) { chatNote(e.message, true); }
  sending = false;
  $('fchat-send').disabled = false;
}

async function add() {
  const input = $('friend-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  msg('Sending…');
  try {
    const r = await acct.addFriend(name);
    input.value = '';
    msg(r === 'accepted' ? `You and ${name} are now friends!` : `Friend request sent to ${name}.`);
    refresh();
  } catch (e) { msg(e.message, true); }
}

function msg(text, bad) {
  const m = $('friend-msg');
  m.textContent = text;
  m.classList.toggle('bad', !!bad);
}

function ago(iso) {
  if (!iso) return 'Offline';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `Online ${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `Online ${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d < 60 ? `Online ${d} day${d > 1 ? 's' : ''} ago` : 'Offline';
}

function button(text, cls, fn) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

async function act(fn, done) {
  try { await fn(); if (done) hooks.toast(done); } catch (e) { msg(e.message, true); }
  refresh();
}

function statsGrid(st) {
  const fav = Object.entries(st.weapon_kills || {}).sort((a, b) => b[1] - a[1])[0];
  const kd = st.deaths ? (st.kills / st.deaths).toFixed(2) : String(st.kills);
  const hsp = st.kills ? `${Math.round(st.headshots / st.kills * 100)}%` : '—';
  const rows = [
    ['Kills', st.kills], ['Deaths', st.deaths], ['K/D', kd], ['Headshots', `${st.headshots} (${hsp})`], ['Damage', st.damage],
    ['Matches played', st.matches_played], ['Matches won', st.matches_won], ['Rounds won', st.rounds_won],
    ['Deathmatch wins', st.dm_wins], ['Favourite weapon', fav && WEAPONS[fav[0]] ? WEAPONS[fav[0]].name : '—'],
  ];
  const g = document.createElement('div');
  g.className = 'stat-grid friend-stats';
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    d.className = 'stat';
    const s = document.createElement('small'); s.textContent = k;
    const b = document.createElement('b'); b.textContent = v;
    d.append(s, b);
    g.appendChild(d);
  }
  return g;
}

function render() {
  const inn = acct.loggedIn();
  $('friends-out').classList.toggle('hidden', inn);
  $('friends-in').classList.toggle('hidden', !inn);
  if (!inn) return;
  const code = hooks.roomCode();
  $('friends-room').textContent = code ? `You're in room ${code}: tap Invite next to an online friend to bring them in.` : 'Host or join a game, then come back here to invite friends.';
  if (lastError) msg(lastError, true);

  const incoming = friends.filter(f => f.state === 'incoming');
  const outgoing = friends.filter(f => f.state === 'outgoing');
  const real = friends.filter(f => f.state === 'friend');

  const reqList = $('friend-requests');
  reqList.innerHTML = '';
  for (const f of incoming) {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'fname'; name.textContent = `${f.username} wants to be friends`;
    const acts = document.createElement('span'); acts.className = 'factions';
    acts.append(
      button('Accept', 'primary small', () => act(() => acct.answerFriend(f.id, true), `You and ${f.username} are now friends`)),
      button('Decline', 'ghost small', () => act(() => acct.answerFriend(f.id, false))),
    );
    li.append(name, acts);
    reqList.appendChild(li);
  }
  for (const f of outgoing) {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'fname muted'; name.textContent = `${f.username}: request sent`;
    const acts = document.createElement('span'); acts.className = 'factions';
    acts.append(button('Cancel', 'ghost small', () => act(() => acct.removeFriend(f.id))));
    li.append(name, acts);
    reqList.appendChild(li);
  }
  $('friend-requests-wrap').classList.toggle('hidden', !incoming.length && !outgoing.length);

  const list = $('friend-list');
  list.innerHTML = '';
  if (!real.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No friends yet. Type a friend\'s username above to add them.';
    list.appendChild(li);
  }
  for (const f of real) {
    const li = document.createElement('li');
    li.className = f.online ? 'online' : 'offline';
    const dot = document.createElement('span'); dot.className = 'fdot'; dot.setAttribute('aria-hidden', 'true');
    const who = document.createElement('span'); who.className = 'fwho';
    const n = document.createElement('b'); n.textContent = f.username;
    const st = document.createElement('small'); st.textContent = f.online ? (f.activity || 'Online') : ago(f.last_seen);
    who.append(n, st);
    const acts = document.createElement('span'); acts.className = 'factions';
    if (code && f.online) acts.appendChild(button('Invite', 'primary small', () => act(() => acct.inviteFriend(f.id, code), `Invite sent to ${f.username}`)));
    const chatBtn = button('Chat', 'secondary small fchat-btn', () => openChat(f));
    if (unread[f.id]) { const n = document.createElement('span'); n.className = 'n'; n.textContent = unread[f.id]; chatBtn.appendChild(n); }
    acts.appendChild(chatBtn);
    acts.appendChild(button(openStats === f.id ? 'Hide stats' : 'Stats', 'ghost small', () => { openStats = openStats === f.id ? null : f.id; render(); }));
    if (confirmRemove === f.id) {
      acts.appendChild(button('Yes, remove', 'danger small', () => { confirmRemove = null; act(() => acct.removeFriend(f.id), `Removed ${f.username}`); }));
      acts.appendChild(button('Keep', 'ghost small', () => { confirmRemove = null; render(); }));
    } else acts.appendChild(button('Remove', 'link small', () => { confirmRemove = f.id; render(); }));
    const row = document.createElement('div'); row.className = 'frow';
    row.append(dot, who, acts);
    li.appendChild(row);
    if (openStats === f.id && f.stats) li.appendChild(statsGrid(f.stats));
    list.appendChild(li);
  }
}
