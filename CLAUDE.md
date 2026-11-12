# SITELINE — notes for Claude

SITELINE is a browser 2v2 tactical shooter (wingman bomb defusal), published with
GitHub Pages at https://sitev2.github.io/siteline/. The owner is not a developer:
explain changes in plain language and keep instructions click-by-click.
The owner asked for finished, tested pull requests to be **merged automatically** (no need to ask first).
Still say what changed and anything they must do themselves (e.g. re-run `supabase.sql`, update the home server).

## Layout — keep it flat
Every website file sits at the repo root (no folders). `index.html` loads them by
bare name (`main.js`, `style.css`, `three.module.js`…), so new files go in the root too.
The only folder is `server/` (the optional home game server).

- `index.html`, `style.css` — page, menus, HUD, touch controls. A small script at the top of `index.html` loads `style.css`, `main.js`
  and every game module with `?v=<page publish time>` (`document.lastModified`, import map), so an update never mixes new and saved
  old files (that crashed to a black screen). **Add every new game .js file to its `files` list.**
- `main.js` — menus, lobby, hosting/joining, starting games
- `game.js` — 3D client: movement, shooting, effects, HUD updates
- `server.js` — match rules (rounds, halftime swap, bomb, damage, hit checks). Runs in the
  host's browser AND on the home server
- `net.js` — connections: PeerJS peer-to-peer, Metered relay, WebSocket server mode. Joining tries any route, then relay-only;
  it resolves once the host answers. A failed relay sign-in is retried next time (never cached). Errors stay on the menu (`#net-error`).
- Game servers: `CONFIG.servers` = [{ name, url }] best first (owner's plan: home PC first, Render as backup); `?server=wss://…` uses only
  that one. Host picks the first that answers (4 s check), else waits up to 90 s for one to wake (free Render sleeps), else makes a
  direct P2P room. Server room codes are 6 chars with the server's list position in front ("1ABCDE" = first server, `roomRoute()` in
  `main.js`); P2P codes stay 5. The menu row `#server-wake` shows which server is ready. Empty list + no `?server` = P2P only, as before.
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
  Keep it secret: no buy-menu entry, no entry in the key settings (`w3` is a hidden fallback in `keys.js`).
  Only its owner sees a 10 s reminder ("[[spoon]] Press 3 for the spoon") the first time it turns up in a game. `reverseMap` ignores
  saved key settings for actions that no longer exist (an old one on key 3 used to block the spoon).
- `bots.js` — bots for practice games only (range / bot match / bot deathmatch): `NavGrid` walking grid + `BotBrain`.
  Runs on the host; `Server.startBotGame(cfg)` starts them. Friends who join take a bot's place. Never add bots to normal matches.
  Bots hear footsteps / gunfire / the bomb (`Ears`), remember and share sightings, pre-aim, counter-strafe, use cover, and read
  each bomb map once (`tactics()`: routes into the site, hidden gathering points, holding spots). Difficulty knobs in `BOT_LEVELS`.
  `node check_bots.mjs foundry hard 5` plays fast bot-vs-bot matches with no graphics (add `dm` for deathmatch).
- `accounts.js` (+ `supabase.sql`, `SUPABASE.md`) — optional Supabase accounts; `config.js` `supabaseUrl` / `supabaseAnonKey`
  (empty = guest only). Username + password only, no real email (owner's choice): `loginEmail()` turns a username into
  `name@players.siteline.invalid` (Supabase "Confirm email" must be OFF; input with '@' = an older email account). No email resets:
  "Forgot password?" tells players to ask the owner, who runs `select public.owner_reset_password('Name', 'temp')` in the SQL Editor
  (revoked from everyone else); players then use Change password (`setNewPassword`). Admin accounts get NO powers, stats only. Stats only change through the `report_match` SQL function; practice / bot games never report.
- `friends.js` — Friends screen (logged-in only): add by username + accept, online dot + activity (`activityText()` in `main.js`), friends'
  stats, Invite button (sends `app.code`) → friend gets the `#invite-pop` "Join" pop-up. `heartbeat(activity, room)` also saves your room
  code (`profiles.room`, only shown to friends via `friend_list`) → friends see a Join button and can join mid-match (joining in buy time
  spawns you at once, `snapScore.now`; later you wait for the next round). `accounts.heartbeat` falls back to the old one-argument call.
  Friend messages show in game: heartbeat's `latest` (`unread_latest()`, newest 5 unread, NOT marked read) → `hooks.friendMessage` →
  the usual toast, now with the text ("💬 New message from Name: text"), in game and in the menus. All via Supabase RPCs in `supabase.sql`
  (`heartbeat` every 20 s returns requests + invites; online = seen in the last 90 s; tables `friends`, `game_invites` have no direct
  access). Chat: Chat button → `#fchat-view` (ids `fchat-*`; `chat-*` belong to the in-match chat), polls `chat_history` every 3 s while
  open, `cleanChat(text, 200)` on send and display; `messages` deleted after 7 days or on unfriend; heartbeat returns `unread` per friend.
  The owner must re-run `supabase.sql` in Supabase after SQL changes (steps in `SUPABASE.md`). No avatars (owner's choice).
- `admin.js` — read-only Admin screen (menu link only for admins): game-wide numbers, game servers' status, every player's stats/online.
  Admins = `public.admins`, filled by `supabase.sql` from the username `test123` only (owner's test account; others are removed from `admins`) at the time it's run.
  `admin_overview()` / `admin_players()` check `is_admin()`. Never expose emails, passwords or chat text (owner agreed).
- `icons.js` — white line icons (SVG drawn in code) used INSTEAD of emojis everywhere (owner's choice): `<i data-icon="cart">` in HTML
  (`fillIcons()` at start-up), `[[cart]]` tokens in hint / centre / toast text (`iconHTML()` escapes the rest), `icon(name)` in code.
  Don't add emojis to the UI; add an icon to `PATHS` instead. New game .js files must also go in the `files` list in `index.html`. Plain text marks (✓ ✕ → arrows) are fine.
- No crouching (the owner removed it): no crouch key/button, no `duck` anywhere; everyone is always standing (`PLAYER_HEIGHT`, `EYE`).
- `keys.js` (rebindable keys), `crosshair.js` (incl. "follow recoil": HUD moves it to the next bullet's spot), `touchlayout.js` (phone button layout), `graphics.js` (presets),
  `post.js` (own AO / bloom / FXAA, no three.js add-ons), `anim.js` (draw + inspect poses, `poseViewModel`: first-person hands, reloads, slides, bolts, pumps), `filter.js` (chat filter)
- Inspects (`INSPECT` / `SPECIAL` in `anim.js`): left side → right side → back, on monotone curves (`tanSoft`: never swing past a pose) plus a
  small hand sway; an inspect cut short blends out over 0.13 s (`vmInspect` in `game.js`). The Deagle spins FORWARDS round the trigger finger
  (`inspectTrick`: wrist cock, ~0.3 s full turn, catch; the gun turns about `pivot`, the hand only flicks; left hand lets go). `settle` (jump
  soaking) is an exactly-solved spring: a step-by-step one froze below ~32 fps and left the gun turned a bit more after every reload.
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
- The Backrooms (`settings.mode = 'br'`; server phase `'br'`, `this.br`): **public** (the owner made it public after testing):
  `BACKROOMS_OPEN = true` in `main.js`. Setting it to false hides the lobby and Practice buttons from everyone but the test accounts
  (`BACKROOMS_TESTERS` = `test123`; `backroomsAllowed()` / `hideBackrooms()`, re-checked on login/logout). 1–4 players co-op,
  no guns (`p.w = 'none'`, empty hands), find the exit door. Three difficulties (`BR_LEVELS` in `brmap.js`: easy / normal / hard; lobby
  `#lobby-level` → `settings.level`, Practice uses `#p-level`): bridge width over pit rooms (1.5 / 1 / 0.5 m), extra bridges, ceiling holes
  (8 / 11 / 14), dark areas (2 / 3 / 4), arrows, and the monster (`lv`): chase speed = your sprint × 1.05 / 1.10 / 1.15 (owner's choice),
  sight / chaseSight (it loses you sooner on easy), fov, `lose` (s before it gives up seeing you), `lead`, hearing, search spots, wake time.
  Controls in the Backrooms only (owner's choice; 2v2/DM unchanged): you WALK by default (`BR.walk` 3.2 m/s, quiet), Shift (the 'walk'
  key) or holding the jump button on phones (it shows the `run` icon; `input.jumpHeld`) SPRINTS (`BR.sprint` 5.3 m/s, loud; `Game.sprinting()`),
  no jumping, F (the inspect key) is the flashlight as well as L.
  A new random maze every game: `brmap.js` (`planMaze(seed, level)` / `backroomsMap(variant)`;
  NOT in `MAPS`, `resolveMap('backrooms', variant)`; the variant is "seed:level" (`brVariant` / `parseBrVariant`, a plain number = normal)):
  20×20 rooms of 4 m, spanning tree + 14 % loops + bigger rooms, ONE pillar hall (repeating 1 m pillars, 3–5 rooms a side), a few free
  pillars (12 %), NO single pitfalls (owner removed them), exit door in the outer wall as far as possible from the start (`b.exit` →
  `world.exit`, never on the start's side). Pit rooms (owner's reference picture, then "make it an obstacle"): two, set across the
  shortest way to the exit; the floor is all hole (`b.pit` → `world.pitGrid`, `isPit`: no floor, you fall; below y −3 the host kills you)
  except bridges (`pitStrips()`): a strip through the middle of each of its rooms, a random tree of links between them (+ extras), and out
  to every way in (`r.ways`); holes reach the walls. Big black spray-painted arrows (`plan.arrows`, drawn in `brview.js` from
  `arrowTexture`) on walls of rooms where the way splits, pointing to the next room on the shortest way to the exit ("vaguely": only some
  rooms). Doorways (6 a maze, spread out; a wall with a
  1.5 × 2.2 m gap; the wall above is a `wallpaper` span from 2.2 m). Walls fill the
  cell [line, line + 0.5) east/south of each room line. `backroomsMap` checks every maze (`mazeOk`: player start→exit, monster→start with
  3×3 clearance) and deterministically tries seed variations if one fails. `node check_br.mjs 300` checks many seeds (all three levels). The NavGrid treats a
  hole next to a cell as no wall (walk along its edge).
  Doors open and shut (`b.door` → `world.doors`; kind 'way' = double doors in a doorway; every door leads somewhere — the old 'blank' doors
  onto bricks were removed at the owner's request, the code for them is unused). The door frame covers the wall's cut edges (5 cm into the
  gap) and the leaves hang just inside it, so nothing clips. The world is built with every door open (so mazes/NavGrid treat doors as passable); the host then shuts the ones that start
  shut (`world.setDoor(i, open)` adds/removes '_door' spans in the gap). Players: E / hand button within ~1.9 m (`Game.doorTarget`,
  `{t:'door', i}`); host `toggleDoor` (range 2.4 m, 0.45 s cooldown, won't shut on anyone standing in the gap) broadcasts
  `{t:'door', i, open, swing}` (swings away from whoever moved it); door states travel in the start message (`doors`). The monster stops
  at a shut door on its way, rattles it (`doorRattle`, 0.7 s chasing / 1.2 s otherwise) and opens it; it hears doors within 14 m.
  `brview.js` `group.userData.setDoor` animates the leaves on hinges.
  Snatches (owner's design): ceiling holes (`plan.holes`: a missing or pushed-aside 0.6 m ceiling tile, by difficulty) — walk under one
  (reach 0.63 m from its middle: 50 % more than before, owner's request) and the host `snatch(p, 'ceiling', …)` takes you, every time;
  2.5 s later it spits the victim's head back out (`brfx.updateHeads`: the hazmat hood from `makePlayerModel(...).rag.head.seg` drops,
  bounces, rolls and lies visor-up on the carpet for the rest of the game; sounds `spit`, `thud`; client only, no gore); the corner snatch (`cornerSnatch`, at most once a game, after 45 s):
  2+ players, the one behind (1.5–8 m) watching the one in front while walking, passes within 0.85 m of an outside wall corner
  (`outerCorners()` in `monster.js`), a spot just round it that they couldn't see a moment ago, nobody at all looking at that spot,
  15 % per corner. Both broadcast `{t:'snatch', id, kind, x, z}` then a kill with weapon 'ceiling' / 'corner' (no kill feed, no
  ragdoll: the body is gone). `brfx.js` animates the arm (`makeSnatchArm` in `models.js`), the victim's body and the victim's
  own camera (fades to `#br-black`).
  Dark areas: `plan.darkZones` (blocks of rooms with dead lights, light from next door fades out over 1.5 m, `darkK`); flashlights
  work in the Backrooms (F or L / light button); the baked surfaces get flashlight cones through a shader hook (`addFlash` / `FLASH`
  uniforms in `brview.js`, filled by `brfx.js`); people and the haze dim with the light where you stand (`lightAt`, `dimPeople`).
  Flickering panels throw sparks + a zap when they stutter back on (`userData.update(dt, dread, cam)`, `onSpark`).
  Notes: N / note button → `#note-editor` (draw on a canvas + up to 140 characters), put on the floor or taped to the wall in front
  of you; host `onNote` (rate + count limits, text through `cleanChat`, drawing as a PNG data URL < 60 KB) broadcasts `{t:'note'}`;
  notes travel in the start message; `#note-read` shows the one you're looking at close up. Drawings can't be filtered.
  Hallucinations (`brfx.js`, client only — nobody else sees or hears them): footsteps behind you, whispers, knocking, a distant
  screech, lights going mad, a figure (the monster) standing far off that vanishes when looked at or approached; more often alone
  or in the dark. No fake teammates any more (the owner replaced them with the skin-wearing below).
  Wearing a skin (owner's design): when the monster catches someone and nobody else saw it (`canWear`: no living player with a line
  of sight within 32 m) and someone is still alive to fool, 1 time in 3 (`SKIN_CHANCE`, all levels) it takes their skin
  (`Server.monsterKill` → `brSkin = { id }`, `brain.wear`). Only the victim and the already dead/escaped are sent the kill (w 'skin',
  no ragdoll, the victim's screen blacks out: "It took your skin"); `snapshot()` shows the victim alive where the monster is (no
  flashlight) and hides the monster, so the scoreboard and "Inside" count still count them. While it lasts, chat from dead players
  only reaches the dead/escaped. Brain state 'skin' (`skinStep`): walks like a player (`BR.walk`, sprints only when far and unseen)
  to the nearest player, stands ~2 m away facing them; clues: head twitch (pitch jerk) every 5–14 s, it stares, never a flashlight
  or a note, it opens doors like a person. It changes back (`unmask` → `revealSkin`: `{t:'skinReveal'}` + the delayed kill to
  everyone) when they come within 1.3 m, after 1.6–4.2 s next to them, when they turn their back, after 180 s, or if the victim
  leaves; state 'reveal' (0.9 s, mode 'm:reveal', game.js grows it from 0.6× after 0.3 s), then it chases. `brfx.onSkinReveal`:
  the suit shudders and bursts into torn scraps that stay on the floor (sound 'tear' + screech). No gore.
  Monster peeking: now and then it picks one player (the most alone), finds a spot by an outside corner 7–16 m away where its body is
  hidden but its head leaning out is clearly visible (`findPeek`), leans out (mode `peek:±1`), and leaves 0.5 s after that player
  looks at its head (also if they come within 6 m, see its body, or after 15 s); after a few peeks it may charge them next time.
  Its animation mode travels in its weapon field: `p.w = 'm:<idle|listen|walk|stalk|search|run|grab|peek:±1>'`.
  In the Backrooms players wear hazmat suits (`makePlayerModel(team, name, false, 'hazmat')`: yellow rubber, black boots/gloves/tape,
  hood with a dark visor and a respirator) with their name printed on a patch on the back instead of a name tag over the head.
  Suit legs: round hip joints, the thigh runs on past the knee + a knee sphere, so joints never open up when they bend. The torso shell's
  front/back are ~0.14 m from its middle (zip flap and name patch sit there).
  2v2 and deathmatch keep the team uniforms and name tags.
  `brview.js` draws it with baked lighting (per-vertex light from every ceiling panel with 2D wall shadows, soft edges, bounce, AO;
  MeshBasic + vertex colours, so it's cheap), canvas textures (chevron wallpaper, carpet, ceiling tiles, panels, doors, outlets, own EXIT
  sign), pits, skirting boards (the board on the x-facing face runs past outside corners and gets an end cap, so corners close), the wall
  above doorways, door frames, doors, wall outlets, flicker + "dread" dimming when the monster
  is near (`group.userData.update`). Hand-held camera sway in `Game.updateCamera` (Backrooms only, more when running or near the
  monster), strength = `settings.camShake` (Settings → General "Camera shake in the Backrooms", default 0.5, 0 = off). `monster.js` = the monster's brain on the host (player
  id `'monster'`, team `'monster'` = snapshot team index 3, `use` = chasing): waits `lv.wake` s; states chase (aims ahead of a running
  target), stalk (creeps up on someone far away looking the other way, charges when they turn or it's within 9 m), pursue (runs to where you
  were heading), search (4 nearby spots, in your direction first, listening at each), wander (towards players, more surely the longer it has
  no clue; stops to listen now and then). Hears sprinting (> 3.5 m/s) within `lv.hear` and walking within `lv.hearWalk`; kills on contact (`monsterKill`). Model `makeMonsterModel` / `animateMonster` in
  `models.js` is OUR OWN design (the owner asked for a known character from someone else's Backrooms videos; we declined to copy it).
  Sounds in `audio.js` (fluorescent buzz bed, monster steps/screech/grab). Account stats are not reported for this mode.
- `check_map.mjs` — `node check_map.mjs outpost` / `node check_map.mjs quarry large` checks every area and spawn is reachable

- Rejoin: the last room joined as a guest is kept in localStorage for 30 min (`siteline-lastroom`); the menu shows
  "Rejoin your last game (CODE)". The host remembers leavers by name (`rememberLeaver` / `restoreLeaver` in `server.js`): team,
  score and money come back. If a whole team leaves a 2v2, the clocks stop for `REJOIN_WAIT` (60 s, `this.hold`) and the round is
  replayed when they are back; after that it is a forfeit. A host who leaves a peer-to-peer room closes it (no rejoin).
- Menus: no "How to play" screen and no tagline under the logo (owner removed both). Loading screen while a game is built
  (`#game-loading`, `beginGame()` in `main.js`: map name, mode, steps on a bar, fades out after the first frames are drawn); messages
  that arrive meanwhile wait in `app.starting` and are handled in order once the game exists (so your spawn is never lost).
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
the repo ZIP and restarts `server/start.bat`. On Linux (`server/LINUX.txt`, `server/install-linux.sh`: systemd service +
Tailscale Funnel) it updates itself: every (re)start runs `git pull`, and a timer restarts it nightly at 04:30.
On ZimaOS (owner's plan; `server/ZIMAOS.txt`) it is a custom app from `server/zimaos-compose.yml`: `node:22` container running
`server/docker-run.sh` (clones the repo, checks GitHub every 30 min, restarts for an update only when "Players online: 0") + a
`tailscale/tailscale` container (userspace, Funnel via TS_SERVE_CONFIG → http://game:8787). The same server can run on Render (build `cd server && npm install`, start `node server/server.mjs`; free plan sleeps,
the menu's Wake server row handles that). Say so whenever a change touches
`server.js`, `world.js`, `maps.js`, `weapons.js` or `config.js`.

## Testing
- `python3 -m http.server 8080` in the root, then open http://localhost:8080
- `?debug` exposes `window.__app` / `window.__game`; practice and bot games need no network (invites do)
- `?relay` forces the relay; `?server=ws://localhost:8787` uses a local game server
  (`cd server && npm install && node server.mjs`)
