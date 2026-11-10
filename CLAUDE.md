# SITELINE — notes for Claude

SITELINE is a browser 2v2 tactical shooter (wingman bomb defusal), published with
GitHub Pages at https://sitev2.github.io/siteline/. The owner is not a developer:
explain changes in plain language and keep instructions click-by-click.

## Layout — keep it flat
Every website file sits at the repo root (no folders). `index.html` loads them by
bare name (`main.js`, `style.css`, `three.module.js`…), so new files go in the root too.
The only folder is `server/` (the optional home game server).

- `index.html`, `style.css` — page, menus, HUD, touch controls
- `main.js` — menus, lobby, hosting/joining, starting games
- `game.js` — 3D client: movement, shooting, effects, HUD updates
- `server.js` — match rules (rounds, halftime swap, bomb, damage, hit checks). Runs in the
  host's browser AND on the home server
- `net.js` — connections: PeerJS peer-to-peer, Metered relay, WebSocket server mode. Joining tries any route, then relay-only;
  it resolves once the host answers. A failed relay sign-in is retried next time (never cached). Errors stay on the menu (`#net-error`).
- `netlog.js` — connection log: every host/join/server attempt saves its steps (relay sign-in, matchmaking, ICE states, routes
  offered/tried from getStats, errors, drops, page hidden/offline) in localStorage (last 20). Copy via the error box
  (“Copy details”) or Connection check (“Copy everything”). Practice invite rooms only log when a friend connects.
- `nettest.js` — Menu → Connection check: tests relay sign-in, matchmaking (PeerJS), direct UDP, relay over UDP/TCP/TLS, and a
  real message through the relay; plain-language verdict + Copy results (for school/work Wi-Fi problems)
- `world.js` (multi-level map model, collision, wall-bang penetration), `maps.js` (map
  build scripts), `mapview.js` (3D scene), `mapdeco.js` (visual-only dressing read from the span grid: wall caps, windows/doors, lamps, pipes, decals, distant scenery — no collision), `houses.js` (village houses: tiled roofs, windows, shutters, balconies, church/tower/inn details), `models.js` (characters with arm IK + gun models with moving parts, all built in code), `textures.js`, `audio.js` (all sound synthesised in code: 3D positional, per-map reverb, wall muffling, layered gunshots, surface footsteps, reload/bolt/pump sequences timed to `anim.js`, ambience; `__test` renders buffers for checks),
  `input.js` (keyboard/mouse + touch), `hud.js`, `weapons.js` (weapon stats)
- `config.js` — network settings and match RULES (2v2 wingman: first to 9, sides swap after round 8, 8–8 draw,
  1:55 rounds, 20 s buy time, bomb/defuse timers, blast size). After a plant, the round ends at once for the attackers
  when every defender is dead (no waiting for the explosion). The bomb preview has no text: the part of the health bar the
  blast would take is striped (`#hp-ghost`), and the bar glows red if it would kill you.
- `buy.js` — buy menu UI. Weapon stats, prices, money rules, spray patterns and armour maths live in `weapons.js`
- Game rules follow the owner's design brief (CS-style numbers; 1 game unit = 0.0254 m). No grenades, taser or knife (the owner removed the knife).
- Secret spoon (the owner asked for it): a melee weapon that works like a CS knife, only for the player whose name is `y1kes`
  (any capitals; `SPOON_OWNER` / `SPOON` in `weapons.js`, kept OUT of `WEAPONS` so it is never bought, dropped or counted in stats).
  The host sets `p.spoon` from the name in `Server.addPlayer` and checks every swing in `onMelee` (`melee` message; others get `swing`).
  Key 3 / mouse wheel / touch ⇄ to hold it; fire = slash (40, then 25; 90 from behind), alt / 🥄 button = stab (65; 180 from behind).
  Keep it secret: no buy-menu entry, no How-to-play text, no entry in the key settings (`w3` is a hidden fallback in `keys.js`).
  Only its owner sees a 10 s reminder ("🥄 Press 3 for the spoon") the first time it turns up in a game. `reverseMap` ignores
  saved key settings for actions that no longer exist (an old one on key 3 used to block the spoon).
- `bots.js` — bots for practice games only (range / bot match / bot deathmatch): `NavGrid` walking grid + `BotBrain`.
  Runs on the host; `Server.startBotGame(cfg)` starts them. Friends who join take a bot's place. Never add bots to normal matches.
  Bots hear footsteps / gunfire / the bomb (`Ears`), remember and share sightings, pre-aim, counter-strafe, use cover, and read
  each bomb map once (`tactics()`: routes into the site, hidden gathering points, holding spots). Difficulty knobs in `BOT_LEVELS`.
  `node check_bots.mjs foundry hard 5` plays fast bot-vs-bot matches with no graphics (add `dm` for deathmatch).
- `accounts.js` (+ `supabase.sql`, `SUPABASE.md`) — optional Supabase accounts; `config.js` `supabaseUrl` / `supabaseAnonKey`
  (empty = guest only). Stats only change through the `report_match` SQL function; practice / bot games never report.
- `keys.js` (rebindable keys), `crosshair.js` (incl. "follow recoil": HUD moves it to the next bullet's spot), `touchlayout.js` (phone button layout), `graphics.js` (presets),
  `post.js` (own AO / bloom / FXAA, no three.js add-ons), `anim.js` (draw + inspect poses, `poseViewModel`: first-person hands, reloads, slides, bolts, pumps), `filter.js` (chat filter)
- Night mode: `settings.night` (host lobby toggle / practice option); flashlights synced via `light` messages
- `ragdoll.js` — death ragdolls (cannon-es physics), client only; the host never runs it
- `three.module.js`, `three.core.js`, `peerjs.min.js`, `cannon-es.js` — bundled libraries, don't edit
- Canal is a sunny hill village (theme `village`; own layout, generic Mediterranean style — not a copy of any CS map).
  `village: {...}` in a map def makes `World.fillHouses` split all leftover mass into separate houses (`world.houses`, `houseAt`),
  each with its own height, colour, wall finish, roof and window style; `b.house(...)` places landmarks by hand (church, bell tower,
  inn, arch houses). `houses.js` draws roofs, facades and landmark details. One shallow canal: `b.water(...)` + `world.waterAt(x, z)`
  (wading ×0.72 speed, splashes even when walking, bots path around it). Props `b.cart`, `b.well`; visual-only
  `b.deco('canalbridge'|'arch'|'paving', ...)`. Materials starting with `_` are invisible collision (bridge parapets).
- `flame` = "Flame (beta)": built from the owner's own drawn plan (1 px = 12.5 cm, lines straightened), shapes only so far;
  `tuscan` theme (own Tuscan hill-town look, no copied assets/signs; no grass tufts): flaking 'oldplaster' + stone, 'ply' crates on pallets,
  wooden barrels, small blue pickup (`truck.mini`), drainpipes/aerials (`theme.pipes/antennas`),
  deco 'shopfront' (stone arcade built 0.5 m out, own sign "CANTINA FIAMMA"; its piers + stone above the arches are
  '_stone' collision in the map), 'railing', 'corbels', 'painta', 'gate', 'bucket', 'stairarch', 'curb', 'shrubs', 'pot', 'arcade' (long roofed arcade
  along the site's west side, pillars incl. the old 1 m block at 39.5–40.5 × 29.5–30.5; walls/pillars/roof are '_stone'/'_roof' collision in the map),
  paving 'terracotta'; ground texture 'setts'. Wood barrels (`theme.woodBarrels`) are closed lathe bodies + lid + 4 hoops.
  Upstairs floor H 3.2 m; barrel → truck (bed 1.3, cab 2.4) → balcony jump route (tested in game).
- Maps: 2v2 `outpost`, `foundry`, `frostline`, `canal`, `flame` (one bomb site each, plus `dm` spawns for 3-player deathmatch);
  deathmatch `quarry`, `railyard` (`mode: 'dm'`, small/large variants via `build(b, size)`; `resolveMap()` in `maps.js`)
- Deathmatch rules: `RULES.dm` in `config.js`; server phase `'dm'`, everyone on team `'ffa'` during the match
- `check_map.mjs` — `node check_map.mjs outpost` / `node check_map.mjs quarry large` checks every area and spawn is reachable

- Rejoin: the last room joined as a guest is kept in localStorage for 30 min (`siteline-lastroom`); the menu shows
  "Rejoin your last game (CODE)". The host remembers leavers by name (`rememberLeaver` / `restoreLeaver` in `server.js`): team,
  score and money come back. If a whole team leaves a 2v2, the clocks stop for `REJOIN_WAIT` (60 s, `this.hold`) and the round is
  replayed when they are back; after that it is a forfeit. A host who leaves a peer-to-peer room closes it (no rejoin).
- Phones: the canvas always fills the page by CSS; `renderer.setSize(w, h, false)` only (never let three.js write a pixel size
  on the canvas, that caused half-black screens after turning the phone). `Game.loop` re-checks the window size 3×/s.
  `stopPageZoom()` in `main.js` blocks pinch / double-tap zoom.

## Must keep working
- Phone, iPad and PC: every feature needs a touch control as well as a keyboard/mouse one.
- `config.js` holds the owner's Metered relay settings (`turnApp`, `turnApiKey`) and,
  later, `serverUrl`. Never blank or remove these values.
- Originals only: no maps, characters, logos or assets copied from existing games
  (for example, no recreations of CS maps).
- All art and sound is generated in code; there are no image or audio asset files.
- No vines/ivy anywhere, and no dry-grass tufts or dirt patches on Flame (the owner removed them).

## Home server (`server/`)
Node + `ws`. `server/server.mjs` imports the root `server.js` and `config.js`, so changes
to the rules, maps or weapons also need the home server updated: the owner re-downloads
the repo ZIP and restarts `server/start.bat`. Say so whenever a change touches
`server.js`, `world.js`, `maps.js`, `weapons.js` or `config.js`.

## Testing
- `python3 -m http.server 8080` in the root, then open http://localhost:8080
- `?debug` exposes `window.__app` / `window.__game`; practice and bot games need no network (invites do)
- `?relay` forces the relay; `?server=ws://localhost:8787` uses a local game server
  (`cd server && npm install && node server.mjs`)
