-- SITELINE accounts: paste ALL of this into Supabase → SQL Editor → New query → Run.
-- Safe to run again (it replaces the functions and keeps existing players).

-- ---------- player profiles ----------
create table if not exists public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  username       text unique not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  kills          integer not null default 0,
  deaths         integer not null default 0,
  headshots      integer not null default 0,
  damage         bigint  not null default 0,
  matches_played integer not null default 0,
  matches_won    integer not null default 0,
  rounds_won     integer not null default 0,
  dm_wins        integer not null default 0,
  weapon_kills   jsonb   not null default '{}'::jsonb,   -- kills per gun, for "favourite weapon"
  balance_cents  integer not null default 0,             -- 10–80 cents per match win (does nothing yet)
  settings       jsonb   not null default '{}'::jsonb,   -- keybinds, crosshair, phone layout, graphics
  last_report    timestamptz,
  created_at     timestamptz not null default now()
);

-- Row-level security: you can read your own profile and change only your settings.
-- Stats and balance can ONLY change through report_match() below.
alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "update own settings" on public.profiles;
create policy "update own settings" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (settings) on public.profiles to authenticated;

-- ---------- make a profile when someone signs up ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- is a username free? (checked before signing up) ----------
create or replace function public.username_available(name text) returns boolean
language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------- add a finished match to your stats ----------
-- Limits: one report per 2 minutes, numbers capped to what one match can produce,
-- headshots can't exceed kills, only known gun names count. A win adds 10–80 cents.
create or replace function public.report_match(
  p_mode text, p_won boolean, p_kills int, p_deaths int, p_headshots int, p_damage int, p_rounds_won int, p_weapon_kills jsonb
) returns json
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  prof public.profiles%rowtype;
  k int; d int; hs int; dmg int; rw int; bonus int := 0;
  wk jsonb := '{}'::jsonb; key text; val int; total int := 0;
  guns text[] := array['glock','usp','tec9','deagle','mac10','mp9','mag7','xm1014','galil','ak47','m4a4','m4a1s','ssg08','awp'];
begin
  if me is null then raise exception 'not logged in'; end if;
  select * into prof from public.profiles where id = me for update;
  if not found then raise exception 'no profile'; end if;
  if prof.last_report is not null and prof.last_report > now() - interval '2 minutes' then
    raise exception 'Too soon: one match report every 2 minutes';
  end if;
  if p_mode not in ('wingman', 'dm') then raise exception 'unknown mode'; end if;

  k   := greatest(0, least(coalesce(p_kills, 0), 60));
  d   := greatest(0, least(coalesce(p_deaths, 0), 60));
  hs  := greatest(0, least(coalesce(p_headshots, 0), k));
  dmg := greatest(0, least(coalesce(p_damage, 0), 9000));
  rw  := case when p_mode = 'wingman' then greatest(0, least(coalesce(p_rounds_won, 0), 9)) else 0 end;

  for key, val in select * from jsonb_each_text(coalesce(p_weapon_kills, '{}'::jsonb)) loop
    if key = any(guns) then
      val := greatest(0, least(val::int, k - total));
      if val > 0 then
        wk := wk || jsonb_build_object(key, val);
        total := total + val;
      end if;
    end if;
  end loop;

  if coalesce(p_won, false) then bonus := 10 + floor(random() * 71)::int; end if;

  update public.profiles set
    kills = kills + k, deaths = deaths + d, headshots = headshots + hs, damage = damage + dmg,
    matches_played = matches_played + 1,
    matches_won = matches_won + (case when p_won then 1 else 0 end),
    rounds_won = rounds_won + rw,
    dm_wins = dm_wins + (case when p_won and p_mode = 'dm' then 1 else 0 end),
    weapon_kills = (
      select coalesce(jsonb_object_agg(g, coalesce((weapon_kills->>g)::int, 0) + coalesce((wk->>g)::int, 0)), '{}'::jsonb)
      from unnest(guns) as g
      where coalesce((weapon_kills->>g)::int, 0) + coalesce((wk->>g)::int, 0) > 0
    ),
    balance_cents = balance_cents + bonus,
    last_report = now()
  where id = me;

  return json_build_object('bonus_cents', bonus);
end $$;
revoke all on function public.report_match(text, boolean, int, int, int, int, int, jsonb) from public, anon;
grant execute on function public.report_match(text, boolean, int, int, int, int, int, jsonb) to authenticated;

-- ---------- friends, online status and game invites ----------
-- Friends are added by username and must accept. Only friends see each other's online status,
-- what they're doing and their stats. Invites carry a room code and expire after 3 minutes.
-- Nobody can read or change these tables directly: only through the functions below.
alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles add column if not exists activity  text;

create table if not exists public.friends (
  user_id    uuid not null references public.profiles(id) on delete cascade,   -- sent the request
  friend_id  uuid not null references public.profiles(id) on delete cascade,   -- received it
  accepted   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.friends enable row level security;
revoke all on public.friends from anon, authenticated;

create table if not exists public.game_invites (
  id         bigserial primary key,
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  code       text not null check (code ~ '^[A-Z0-9]{4,8}$'),
  created_at timestamptz not null default now()
);
alter table public.game_invites enable row level security;
revoke all on public.game_invites from anon, authenticated;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.friends
                 where accepted and ((user_id = a and friend_id = b) or (user_id = b and friend_id = a)));
$$;
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- "I'm online": called every 20 s while the game is open. Returns friend requests and invites waiting for me.
create or replace function public.heartbeat(p_activity text) returns json
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not logged in'; end if;
  update public.profiles set last_seen = now(), activity = left(coalesce(p_activity, ''), 40) where id = me;
  delete from public.game_invites where created_at < now() - interval '10 minutes';
  return json_build_object(
    'requests', (select count(*) from public.friends where friend_id = me and not accepted),
    'invites', coalesce((
      select json_agg(json_build_object('id', i.id, 'from', p.username, 'code', i.code) order by i.id)
      from public.game_invites i join public.profiles p on p.id = i.from_id
      where i.to_id = me and i.created_at > now() - interval '3 minutes'), '[]'::json));
end $$;

-- Everyone on my friends list (and requests both ways), with status and stats for real friends.
create or replace function public.friend_list() returns json
language sql security definer set search_path = public stable as $$
  select coalesce(json_agg(row_to_json(x) order by x.state, x.online desc, lower(x.username)), '[]'::json) from (
    select p.id, p.username,
      case when f.accepted then 'friend' when f.user_id = auth.uid() then 'outgoing' else 'incoming' end as state,
      (f.accepted and p.last_seen > now() - interval '90 seconds') as online,
      case when f.accepted and p.last_seen > now() - interval '90 seconds' then p.activity end as activity,
      case when f.accepted then p.last_seen end as last_seen,
      case when f.accepted then json_build_object(
        'kills', p.kills, 'deaths', p.deaths, 'headshots', p.headshots, 'damage', p.damage,
        'matches_played', p.matches_played, 'matches_won', p.matches_won, 'rounds_won', p.rounds_won,
        'dm_wins', p.dm_wins, 'weapon_kills', p.weapon_kills) end as stats
    from public.friends f
    join public.profiles p on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
    where auth.uid() in (f.user_id, f.friend_id)
  ) x;
$$;

-- Send a friend request by username. If they already asked me, this accepts it.
create or replace function public.add_friend(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them uuid; row_ public.friends%rowtype;
begin
  if me is null then raise exception 'not logged in'; end if;
  select id into them from public.profiles where lower(username) = lower(trim(p_name));
  if them is null then raise exception 'No player is called "%".', trim(p_name); end if;
  if them = me then raise exception 'That''s you!'; end if;
  select * into row_ from public.friends where user_id = them and friend_id = me;
  if found then
    if row_.accepted then raise exception 'You''re already friends.'; end if;
    update public.friends set accepted = true where user_id = them and friend_id = me;
    return 'accepted';
  end if;
  select * into row_ from public.friends where user_id = me and friend_id = them;
  if found then
    if row_.accepted then raise exception 'You''re already friends.'; end if;
    raise exception 'Request already sent. Waiting for them to accept.';
  end if;
  if (select count(*) from public.friends where user_id = me and not accepted) >= 30 then
    raise exception 'Too many requests waiting. Cancel some first.';
  end if;
  insert into public.friends (user_id, friend_id) values (me, them);
  return 'sent';
end $$;

create or replace function public.answer_friend(p_other uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_accept then
    update public.friends set accepted = true where user_id = p_other and friend_id = auth.uid();
  else
    delete from public.friends where user_id = p_other and friend_id = auth.uid() and not accepted;
  end if;
end $$;

-- Unfriend, or cancel a request I sent.
create or replace function public.remove_friend(p_other uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.friends
  where (user_id = auth.uid() and friend_id = p_other) or (user_id = p_other and friend_id = auth.uid());
  delete from public.game_invites
  where (from_id = auth.uid() and to_id = p_other) or (from_id = p_other and to_id = auth.uid());
$$;

create or replace function public.invite_friend(p_other uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not logged in'; end if;
  if not public.are_friends(me, p_other) then raise exception 'You can only invite friends.'; end if;
  delete from public.game_invites where from_id = me and to_id = p_other;
  insert into public.game_invites (from_id, to_id, code) values (me, p_other, upper(p_code));
end $$;

create or replace function public.dismiss_invite(p_id bigint) returns void
language sql security definer set search_path = public as $$
  delete from public.game_invites where id = p_id and to_id = auth.uid();
$$;

do $$
declare f text;
begin
  foreach f in array array['heartbeat(text)', 'friend_list()', 'add_friend(text)', 'answer_friend(uuid, boolean)',
                           'remove_friend(uuid)', 'invite_friend(uuid, text)', 'dismiss_invite(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
