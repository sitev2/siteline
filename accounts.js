// Player accounts with Supabase (optional). Talks to Supabase's REST API directly,
// so no extra library is needed. Fill in supabaseUrl + supabaseAnonKey in config.js
// (see SUPABASE.md); while they're empty the game simply runs in guest mode.
import { CONFIG } from './config.js';

const STORE = 'siteline-session';
let session = null;     // { access_token, refresh_token, expires_at, user: { id, email } }
let profile = null;     // row from public.profiles
const listeners = new Set();

export const accountsEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const currentProfile = () => profile;
export const loggedIn = () => !!(session && profile);
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => { for (const fn of listeners) { try { fn(profile); } catch (e) { /* ignore */ } } };

function base() { return CONFIG.supabaseUrl.replace(/\/+$/, ''); }

async function call(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  if (auth) await freshSession();
  // New-style keys (sb_publishable_…) go only in the apikey header; the older anon keys (eyJ…)
  // are also accepted as a bearer token. A logged-in player sends their own session token.
  const bearer = auth && session ? session.access_token : (/^sb_/.test(CONFIG.supabaseAnonKey) ? null : CONFIG.supabaseAnonKey);
  const res = await fetch(base() + path, {
    method,
    headers: {
      apikey: CONFIG.supabaseAnonKey,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `Request failed (${res.status})`;
    throw new Error(friendly(String(msg)));
  }
  return data;
}

function friendly(msg) {
  if (/invalid login/i.test(msg)) return 'Wrong email or password.';
  if (/already registered|already exists/i.test(msg)) return 'That email already has an account. Try logging in.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first (check your inbox), then log in.';
  if (/password/i.test(msg) && /6/.test(msg)) return 'The password needs at least 6 characters.';
  if (/rate limit|too many/i.test(msg)) return 'Too many tries — wait a minute and try again.';
  if (/could not find the function|schema cache/i.test(msg)) return 'Friends aren\'t set up in the database yet: the owner needs to run supabase.sql again (see SUPABASE.md).';
  return msg;
}

function saveSession(s) {
  session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || (Date.now() / 1000 + (s.expires_in || 3600)), user: s.user } : null;
  try { if (session) localStorage.setItem(STORE, JSON.stringify(session)); else localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
}

async function freshSession() {
  if (!session) return;
  if (session.expires_at - Date.now() / 1000 > 60) return;
  try {
    const s = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false });
    saveSession(s);
  } catch (e) { saveSession(null); profile = null; emit(); }
}

// ---------- public API ----------
export async function initAccounts() {
  if (!accountsEnabled()) return;
  try { session = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { session = null; }
  if (session) {
    try { await loadProfile(); } catch (e) { saveSession(null); profile = null; }
    emit();
  }
}

export async function loadProfile() {
  if (!session) return null;
  const rows = await call(`/rest/v1/profiles?id=eq.${session.user.id}&select=*`);
  profile = rows && rows[0] || null;
  return profile;
}

export async function usernameFree(name) {
  return !!(await call('/rest/v1/rpc/username_available', { method: 'POST', body: { name }, auth: false }));
}

export async function signUp(email, password, username) {
  username = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Usernames are 3–16 letters, numbers or _.');
  if (!(await usernameFree(username))) throw new Error('That username is taken.');
  const res = await call('/auth/v1/signup', { method: 'POST', body: { email, password, data: { username } }, auth: false });
  if (res && res.access_token) {
    saveSession(res);
    await loadProfile();
    emit();
    return { needsConfirm: false };
  }
  return { needsConfirm: true };   // Supabase sent a confirmation email
}

export async function logIn(email, password) {
  const s = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
  saveSession(s);
  await loadProfile();
  emit();
}

export function logOut() {
  if (session) call('/auth/v1/logout', { method: 'POST' }).catch(() => {});
  saveSession(null);
  profile = null;
  emit();
}

// keybinds, crosshair, phone layout and graphics, saved to the account
let saveTimer = null;
export function saveAccountSettings(settings) {
  if (!loggedIn()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    call(`/rest/v1/profiles?id=eq.${session.user.id}`, { method: 'PATCH', body: { settings }, headers: { Prefer: 'return=minimal' } })
      .catch(e => console.warn('Could not save settings to the account', e));
  }, 1500);
}

// After a real match (not practice or bots): add the stats; a win adds 10–80 cents.
// stats: { mode, won, kills, deaths, headshots, damage, roundsWon, weaponKills: { ak47: 3, … } }
export async function reportMatch(stats) {
  if (!loggedIn()) return null;
  const res = await call('/rest/v1/rpc/report_match', {
    method: 'POST',
    body: {
      p_mode: stats.mode, p_won: !!stats.won, p_kills: stats.kills | 0, p_deaths: stats.deaths | 0, p_headshots: stats.headshots | 0,
      p_damage: stats.damage | 0, p_rounds_won: stats.roundsWon | 0, p_weapon_kills: stats.weaponKills || {},
    },
  });
  await loadProfile();
  emit();
  return res;
}

export function favouriteWeapon(p) {
  const wk = (p && p.weapon_kills) || {};
  let best = null, n = 0;
  for (const [w, k] of Object.entries(wk)) if (k > n) { best = w; n = k; }
  return best;
}

// ---------- friends, online status and game invites (see supabase.sql) ----------
const rpc = (name, body = {}) => call(`/rest/v1/rpc/${name}`, { method: 'POST', body });
export const heartbeat = (activity) => rpc('heartbeat', { p_activity: activity });
export const friendList = () => rpc('friend_list');
export const addFriend = (name) => rpc('add_friend', { p_name: String(name || '').trim() });
export const answerFriend = (id, accept) => rpc('answer_friend', { p_other: id, p_accept: !!accept });
export const removeFriend = (id) => rpc('remove_friend', { p_other: id });
export const inviteFriend = (id, code) => rpc('invite_friend', { p_other: id, p_code: code });
export const dismissInvite = (id) => rpc('dismiss_invite', { p_id: id });
export const sendMessage = (id, body) => rpc('send_message', { p_to: id, p_body: body });
export const chatHistory = (id, after = 0) => rpc('chat_history', { p_other: id, p_after: after });
export const isAdmin = () => rpc('is_admin');
export const adminOverview = () => rpc('admin_overview');
export const adminPlayers = () => rpc('admin_players');
