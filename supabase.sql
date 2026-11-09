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
