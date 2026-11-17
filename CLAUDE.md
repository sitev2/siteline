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
  build scripts), `mapview.js` (3D scene; a wall's top/underside is hidden only by a VISIBLE wall touching it — invisible '_' spans and
  props don't count, they left see-through strips, e.g. Flame's upstairs floor edge under the '_rail'), `mapdeco.js` (visual-only dressing read from the span grid: wall caps, windows/doors, lamps, pipes, decals, distant scenery — no collision), `houses.js` (village houses: tiled roofs, windows, shutters, balconies, church/tower/inn details), `models.js` (characters with arm IK + gun models with moving parts, all built in code), `textures.js`, `audio.js` (all sound synthesised in code: 3D positional, per-map reverb, wall muffling, layered gunshots, surface footsteps (per-map loudness: `STEP_VOLUME` in `game.js` → `setStepVolume`; outpost and flame 0.6 = 40 % quieter, owner's request, landings too), reload/bolt/pump sequences timed to `anim.js`, ambience; `__test` renders buffers for checks),
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
  spawns you at once, `snapScore.now`; later you wait for the next round). `accounts.heartbeat` falls back to the old one-argument call when the database hasn't got the newer one (it must test `e.raw` / `e.status` from `call()`, NOT `e.message`: that is the friendly text, and testing it made every heartbeat fail silently — everyone showed offline and invites never arrived). A failing heartbeat now shows on the Friends screen (`beatError`).
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
  `post.js` (own AO / bloom / FXAA, no three.js add-ons; plus the 'look' shaders in the composite pass (owner: "add shaders to make the game look better"; graphics option `look` "Picture shaders", on from Medium up: a little sharpening, a gentle S-curve + 10 % more colour, warm highlights / cool shadows, a faint colour fringe and a soft vignette in the corners, less-than-one-step dither against banding — NOT film grain, the owner removed grain —, and one wider bloom round); the scene and FXAA targets are sRGB 8-bit (`colorSpace: SRGBColorSpace`): plain
  8-bit linear had only a few steps near black, so dark areas showed hard bands and dark yellow broke into red streaks), `anim.js` (draw + inspect poses, `poseViewModel`: first-person hands, reloads, slides, bolts, pumps), `filter.js` (chat filter)
- Inspects (`INSPECT` / `SPECIAL` in `anim.js`): left side → right side → back, on monotone curves (`tanSoft`: never swing past a pose) plus a
  small hand sway; an inspect cut short blends out over 0.13 s (`vmInspect` in `game.js`). The Deagle spins FORWARDS round the trigger finger
  (`inspectTrick`: wrist cock, ~0.3 s full turn, catch; the gun turns about `pivot`, the hand only flicks; left hand lets go). `settle` (jump
  soaking) is an exactly-solved spring: a step-by-step one froze below ~32 fps and left the gun turned a bit more after every reload.
- Spectating shows the watched player's view: their gun in first person (`this.specTarget` / `this.view` in `updateCamera`; the
  view-model block reads `V` = me or a stand-in built from the remote: weapon, scope level, reloading, last shot, spoon swings),
  their scope, their crosshair style (sent as a share code in a `xh` message → `p.xh` in the roster) and their health/armour/gun
  name in the HUD (no ammo numbers). Clients send `zm`/`rl` with `st`; the snapshot flags carry them (bits 4–5 zoom, 64 reloading).
- Night mode: `settings.night` (host lobby toggle / practice option); flashlights synced via `light` messages
- `ragdoll.js` — death ragdolls (cannon-es physics), client only; the host never runs it. A ragdoll can be held by one end (`hold`): the Backrooms entity swings it about; `keepTogether` closes every joint again after each physics step while it is held (+2.5 s), because swung hard the joints stretched and limbs came away from the body (owner saw it)
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
  `#lobby-level` → `settings.level`, Practice uses `#p-level`): walkway width in pit rooms (1.5 / 1 / 0.5 m), ceiling holes
  (4 / 6 / 7: the owner halved them), dark areas (4 / 6 / 8: doubled with the maze's area), arrows, and the monster (`lv`): chase speed = your sprint × 1.05 / 1.10 / 1.15 (owner's choice),
  sight / chaseSight (it loses you sooner on easy), fov, `lose` (s before it gives up seeing you), `lead`, hearing, search spots, wake time.
  Controls in the Backrooms only (owner's choice; 2v2/DM unchanged): you WALK by default (`BR.walk` 2.7 m/s, quiet; was 3.2 — owner asked for slower, may still tune), Shift (the 'walk'
  key) or holding the jump button on phones (it shows the `run` icon; `input.jumpHeld`) SPRINTS (`BR.sprint` 4.5 m/s, was 5.3, loud; the monster's speeds were cut ~15 % too; `Game.sprinting()`),
  no jumping, F (the inspect key) is the flashlight as well as L.
  A new random layout every game: `brmap.js` (`planMaze(seed, level)` / `backroomsMap(variant)`;
  NOT in `MAPS`, `resolveMap('backrooms', variant)`; the variant is "seed:level" (`brVariant` / `parseBrVariant`, a plain number = normal)).
  LINEAR (owner's layout, so players don't get lost; it replaced one 28×28 maze cut into diagonal areas): FOUR SECTIONS IN A ROW,
  west → east, on 44 × 22 rooms of 4 m (`BR.cols` / `BR.rows`, `SECTIONS`; about the old area; ~10 % slower to load than the old maze):
  A start (11 × 22, start in a west corner) | B key (11 × 22) | C pits (11 wide but only 11 rows, `plan.cz0`…`cz1`, about centred, solid
  wall above and below; its west 6 columns a short maze, its east 5 the PIT HALL) | D levers + exit (11 × 22). `plan.sec[z][x]` = 0–3
  (-1 solid); `brSection(plan, x, z)` (metres) also gives 4 for the exit room. Each section is its own maze: a growing tree (`NEWEST` 0.75:
  mostly from the newest room, sometimes an older one), no dead-end corridor longer than `DEAD_END` 4 rooms (its far end is opened into a
  neighbour), `LOOPS` 5 % extra openings (~6 % in all; never zero: players need something to run round), bigger rooms (as many per area as
  before), ONE pillar hall (in A, B or D, repeating 1 m pillars, 3–5 rooms a side), a few free pillars (12 %, never across a section
  edge), NO single pitfalls (owner removed them). The pit hall (`plan.hall`, `hallHoles(plan)`): entered by ONE doorway (a gap, no door:
  `plan.hallDoor`) from C's maze onto a landing of 1.5 m+, then the 2.5 m holes with the level's walkway width; across it they reach the
  north and south walls (owner's choice: no walking round by the wall; the floor left over is thicker wall, `padN` / `padS`); its east
  side is open all along into D (no wall, no gate) with 1 m+ of floor kept on D's side (the walls between D's rooms end there; with
  less, some of D's rooms could only be reached the long way). The exit (owner: "going all left mustn't find it"): a door in a small room
  at D's far east end (columns W−4…W−2, not on an edge), as far as it can be from the pit hall; the 8 walls meeting that room's corners from
  outside are knocked out and it gets its own 4 walls but one (the way in, random), so its walls are an island: keeping a hand on one
  wall (always left / always right) never gets there. The door is on the inside of the wall facing the way in (`b.exit` → `world.exit`,
  n points into the room; the host only counts you through it from in front: `ahead > -0.3`). No pit rooms or doors in the 3×3 rooms
  round it (`byExit`), and no pillar hall within a room of it (a pillar on its corner would join it to the rest). Small pit rooms (extras besides the pit hall; owner's reference picture; "composed of square holes", the room itself may be a
  rectangle): one in B and one in D, 2×3 / 3×2 / 3×3 rooms (8×12 / 12×8 / 12×12 m), set across the way through that section; a regular grid of identical
  2.5 m square holes (`PIT_HOLE`, `pitHoles()`; `b.pit` → `world.pitGrid`, `isPit`: no floor, you fall; below y −3 the host kills you)
  with walkways of the level's width between them; at each end of a row the strip by the wall is either none (the holes touch the wall)
  or at least 1 m — never a thinner ledge, which nobody could walk along; a side with a way in always keeps its strip (`pitHoles(…, needLo,
  needHi)`; the plan stores the layout in `r.xs` / `r.zs`), or the way in opened straight onto a hole. Big black spray-painted arrows (`plan.arrows`, drawn in `brview.js` from `arrowTexture`): just lines, big but skinny (owner: a ~3.3 × 1.6 m quad, the size of a wall, 5 cm lines: a shaft + an open head, overspray, drips); few and USEFUL (owner: "make the arrows actually useful and put less of them"): one in the start room plus at most `arrowMax` (5 / 4 / 3 by difficulty) in rooms where the way splits (3+ openings), at least 6 rooms apart; each points the real way — the first step of the shortest walk to the exit through the gates, so along the strip, generally east (`arrowAt` in `brmap.js`), no longer the vague compass direction. Doorways: `L.doors` = 28 / 20 / 12 a maze by difficulty (easy / normal / hard; owner: "enough doors to evade the monster" — it was 3), at least 4 rooms apart, each where going round is a real detour (6+ rooms, `goodDoor`) and nothing is
  ever sealed off with every door shut (`walkShut`); a wall with a
  1.5 × 2.2 m gap; the wall above is a `wallpaper` span from 2.2 m. Walls fill the
  cell [line, line + 0.5) east/south of each room line. `backroomsMap` checks every maze (`mazeOk`: player start→exit, monster→start with
  3×3 clearance, and on to D across the pit hall; `brTest.mazeOk` says why one fails) and deterministically tries seed variations if one
  fails (in 300 seeds none needs to). `node check_br.mjs 300` checks many seeds (all three levels; see Testing). On easy only (owner's choice
  so far), a faint worn trail in the carpet (`plan.guide`, `wear()` in `brview.js`: ~20 % darker, ~1 m wide) runs task by task: start →
  heavy door → the key → the locked door → the pit hall's doorway → (none across holes) → the levers → the lever door → the exit. Each
  section has its own LIGHT colour (`LOOKS` in `brview.js`: A warm white as before, B greenish white, C cold blue-white, D amber; the panels,
  the baked light, the haze via `userData.fogAt` → brfx), so you always know where you are; the walls and the floor stay the same colour
  everywhere (owner). The NavGrid treats a
  hole next to a cell as no wall (walk along its edge).
  Doors open and shut (`b.door` → `world.doors`; kind 'way' = double doors in a doorway; every door leads somewhere — the old 'blank' doors
  onto bricks were removed at the owner's request, the code for them is unused). The door frame covers the wall's cut edges (5 cm into the
  gap) and the leaves hang just inside it, so nothing clips. The world is built with every door open (so mazes/NavGrid treat doors as passable); the host then shuts the ones that start
  shut (`world.setDoor(i, open)` adds/removes '_door' spans in the gap). Players: E / hand button within ~1.9 m (`Game.doorTarget`,
  `{t:'door', i}`); host `toggleDoor` (range 2.4 m, 0.45 s cooldown) broadcasts
  `{t:'door', i, open, swing}` (swings away from whoever moved it); doors shut even with someone in the doorway (owner's rule):
  `world.pushOutOfDoor` moves them out to the side they're more on (players on their own screen in game.js, the monster on the host); door states travel in the start message (`doors`). The monster can't
  open doors (owner's rule): it KICKS shut ones in (`KICK_TIME` 2 s, owner's choice, `kicking` / `kickStep` in `monster.js`, mode 'kick'; a
  `{t:'doorKick', i, swing}` boom every 0.75 s — the leaves jump, `kickDoor` in `brview.js`), then `Server.breakDoor`: the door is
  `broken`, open for good, both leaves torn off and flat on the floor (`setDoor(..., broken)`, sound 'break'); players can't shut a
  broken door (toast; start message sends 2 for broken). Its routes weigh a shut door as `KICK_TIME` of running (`NavGrid.path(a, b, max, cost)`
  with `doorCost`), so it goes round when that's quicker; `straight()` stops at '_door' spans; shut doors block its sight. Opened by a player mid-kick: it stops and walks through. It hears doors within 14 m.
  `brview.js` `group.userData.setDoor` animates the leaves on hinges.
  Snatches (owner's design): ceiling holes (`plan.holes`, by difficulty; drawn in `brview.js` as a tile that has just SHIFTED, owner: "nothing
  obvious" — the ceiling's own material/baked light at that spot ×0.9, slid 8–14 cm over its neighbour 12 mm below the ceiling plane,
  a thin black gap where it came from; the ceiling mesh has no hole, so everything hangs just below it) — walk under one
  (reach 0.63 m from its middle: 50 % more than before, owner's request) and the host `snatch(p, 'ceiling', …)` takes you, every time;
  2.5 s later it spits the victim's head back out (`brfx.updateHeads`: the hazmat hood from `makePlayerModel(...).rag.head.seg` drops,
  bounces, rolls and lies visor-up on the carpet for the rest of the game; sounds `spit`, `thud`; client only, no gore); the corner snatch (`cornerSnatch`, at most once a game, after 45 s):
  2+ players, the one behind (1.5–8 m) watching the one in front while walking, passes within 0.85 m of an outside wall corner
  (`outerCorners()` in `monster.js`), a spot just round it that they couldn't see a moment ago, nobody at all looking at that spot,
  15 % per corner. Both broadcast `{t:'snatch', id, kind, x, z}` then a kill with weapon 'ceiling' / 'corner' (no kill feed, no
  ragdoll: the body is gone). `brfx.js` animates the arm (`makeSnatchArm` in `models.js`), the victim's body and the victim's
  own camera (fades to `#br-black`).
  Dark areas: `plan.darkZones` (blocks of rooms with every light off; the panels there are drawn OFF — owner's request: a 'dead' panel is a grey diffuser tinted per instance by the baked light where it hangs (`setColorAt`) with the flashlight hook (`addFlash`), so in the dark it is as dark as the ceiling and only shows in a beam; before, dead panels were a fixed pale grey that looked lit — no flickering ones in there either, owner's request; `darkK` fades the light from 2 m before the edge to 4 m inside
  (`FADE_OUT` / `FADE_IN`) in even-looking steps (`DARK_MIN ** smoothstep`, owner: "blend more"), down to `DARK_MIN` 2 %, nearly pitch
  black — owner asked for darker twice; people dim to 2.5 % and the haze to 1.5 % there; `keepHue()` in the
  shader keeps very dim baked light in the surface's own colour, just darker (owner: walls must not lose their colour in the dark; plain
  dim bounce light turned the wallpaper/carpet into dark-red streaks). The wallpaper is 5 % darker (`material.userData.base` 0.95, owner's
  request). Flashlights work in the Backrooms (F or L / light button) and reach further there (shader: a small cone whose edge melts into the
  dark, core = smoothstep 0.86–0.995 squared + a faint spill, 1.84 / (1 + 0.022 d²) — owner asked for a smaller circle that blends better, then 20 % dimmer;
  SpotLight for people 12.8 / 11.2 intensity, others' beam cone at 0.8, 48 / 42 m, 0.36 rad, penumbra 0.9; 2v2 night mode keeps the old flashlight); the baked surfaces get flashlight cones through a shader hook (`addFlash` / `FLASH`
  uniforms in `brview.js`, filled by `brfx.js`); people and the haze dim with the light where you stand (`lightAt`, `dimPeople`).
  Flickering panels throw sparks + a zap when they stutter back on (`userData.update(dt, dread, cam)`, `onSpark`).
  THE ORDER (owner's design; it replaced the optional team shortcuts): everyone has to finish the Backrooms in one order, one task per
  section. The only opening in the wall between two sections is its gate (`plan.locked`: a real opening at a random row, with a locked
  'way' door in it; into C at one of C's rows):
  A (start) → 'heavy' door (riveted steel; two players press E within 1.5 s) → B, where the key hangs (`plan.key`, a BRASS
  key now, owner asked for a normal colour) on its high shelf: climb on a teammate's shoulders (`{t:'boost'}` → `tryBoost`) → 'red'
  door (only its name in the code: it is an ordinary dark door with a brass lock plate; the key opens it) → C → across the PIT HALL (no
  door: it is the gate, the only way into D; done once someone is in D: the host's `brCrossed` → `{t:'crossed'}`, the start message
  carries `crossed`) → D with the lever room (`plan.switches`: both levers in ONE room, on two walls, pulled within 2 s, a few rooms from
  the exit) → 'twin' door (hazard stripes) on the exit room's one way in → the exit. Solo (`Server.brSolo()`: fewer than 2
  players alive inside): the heavy door opens for one, E under the shelf just takes the key, and a pulled lever stays down so one
  player pulls one then the other. Instead of the top bar (hidden in `br-mode`), a task list sits middle left (vertically centred, sized by the screen: `max(10px, 1.75vh)`, all in em) as plain text, no box (`#br-tasks`,
  owner's request): all six tasks in order (Open the heavy door / Find the key / Unlock the door / Cross the pit hall / Pull both levers
  together / Get out), finished ones ticked and crossed out, the current one highlighted
  (`hud.setBackrooms([{ text, done }])`, filled from the gates' `open`, `keyTaken` and `brCrossed` in `Game.updateHud`).
  The monster's HOME (owner's rules, `monster.js`): the section of the current task (`Server.brStage()`: 0 A until the heavy door is open,
  1 B until the locked door is open, 2 C until someone has crossed, 3 D). It starts in A (`plan.monster`, well away from the start; wakes
  after `lv.wake` s as before) and can't pass a shut gate (`MonsterBrain.region` = `brSection`, `canReach`; gates [heavy, red, none, twin]).
  `updateHome()`: its home only moves on once a player is in a later section or standing in the open gateway (never ahead of the
  players: a gate opened with them still behind it, it stays put; it never teleports, it walks through). It wanders, peeks, backs off and
  searches only in its home (`inHome`, `wanderGoal`: towards the nearest player in there); past its home it only goes after someone it has
  seen there (`ahead()` turns it back). Players who go back through an open gate can be chased back as anyone is (seen, heard: chase,
  stalk, pursue, search; across the pit hall on the walkways too); once it has lost them it goes home again (`startSearch` outside home →
  wander → home). Split players: whoever it hears or sees first, else the nearest one at home. A seed that can't be laid out sets
  `plan.bad` and `backroomsMap` tries the next (up to 40); `mazeOk` now also checks, on the real floor with every ordinary door shut
  and the gates open, that the exit, the key and the lever room can be walked to (a wall end can pinch a 1 m pit walkway shut).
  `check_br.mjs` checks the order (see Testing). Once open the gates stay open. The key goes back on its shelf if its holder dies, escapes or
  leaves (`dropKey`, `{t:'keyBack'}`); the start message carries `key`. E / the hand button picks the target with `Game.useTarget()` (key spot,
  lever, then door), with hints for each. Explorer logs 9–11 explain them, taped up near each.
  Explorer logs (owner's pick): `plan.logs` (brmap step 10, `LOG_COUNT` 7 a maze: clue 0 always in the start room, the rest spread out
  ≥ 6 rooms apart, never on a wall with an arrow) → `brfx.startNotes` adds them as wall notes (ids −1…, `log` = clue index, 0.42 m) drawn
  by `paintNote` with the clue's text + its own pencil drawing (`LOGS` in `brfx.js`: our own words/pictures; signatures `WHO`; 9–11 = the team shortcuts); read close
  up like any note. Self-drawn map (owner's pick): M (`map` key) / `#btn-map` → `#br-map`: only cells you've been within 2.4 m of AND could
  see (2D ray through `mapKind`), drawn like pencil on paper (`initMap` / `mapStep` / `drawMap`: floor, walls, holes, your trail in blue,
  you as a red arrowhead, EXIT once you've seen its door); client only. Ending scene (owner's pick): your own `escaped` →
  `Game.escapeScene` (game clock): you step into the doorway, turn round for a last look back (`updateCamera`), the screen goes white
  (`#br-escape`) and shows "You got out." + your time; the host waits 7 s (not 2) before the results when the last one out just escaped.
  Notes: N / note button → `#note-editor` (draw on a canvas + up to 140 characters), put on the floor or taped to the wall in front
  of you; host `onNote` (rate + count limits, text through `cleanChat`, drawing as a PNG data URL < 60 KB) broadcasts `{t:'note'}`;
  notes travel in the start message; `#note-read` shows the one you're looking at close up. Drawings can't be filtered.
  Hallucinations (`brfx.js`, client only — nobody else sees or hears them): footsteps behind you, whispers, knocking, a distant
  screech, lights going mad, a figure (the monster) standing far off that vanishes when looked at or approached; more often alone
  or in the dark. No fake teammates, and no skin-wearing any more (the owner removed the shape-shifting when the tall one came in).
  It, the main entity (owner's design brief; it REPLACED the old thin black shadow monster, which is gone): a tall stiff machine,
  `makeTallModel` in `models.js` (`makeMonsterModel()`).
  - Looks: ~2.8 m (root scale 0.88; ceiling 2.9), all black worn metal, like an animatronic: flat bars, rams, rivets, an open rib cage
    round a motor drum, cables, arms to its knees with four flat fingers, two face plates out of line with a deep socket each, a hinged
    jaw of slats. Each joint's fixed parts are merged (`mergeStatic`) — about 100 meshes. Eyes: pale pin-points, RED once it has
    spotted you (notice / run / catching); `setGlow(k)` from `brfx.eyeGlow` still adds the dark / flashlight glow (`m.eyes(k, red)`).
  - Moves (`animateTall`; `animateMonster` picks it by `m.tall`): nothing eases. Every joint is a motor (`sv`) turning at a fixed speed
    to its next position and stopping dead; positions change on a step clock that keeps time with its real speed. Walking = 3
    positions a step (`TALL_WALK_KEYS`, owner asked for the extra one; 2 = the first version), running = 2 with bigger strides, both
    arms out in front with the elbows a bit bent (owner). Standing it is dead still, then one part clicks. NO crawling (removed), and
    game.js doesn't drop frames for it. Ducks through doorways (`duck`), kicks
    doors (mode 'kick'), peeks, and freezes mid-step when a stalked player turns round (mode 'freeze' = dt 0).
  - The stare (owner): the moment it sees someone (`MonsterBrain.spot`) it stops dead, its head snaps onto them (the host sends the
    angle to its target in the monster's `pitch` field → `lookYaw`) and it stares for `STARE` 1 s (mode 'notice': a head tilt, the jaw
    drops, eyes red, sound 'servo'), then chases. Not again within `STARE_AGAIN` 8 s of a chase. Its speeds are unchanged.
  - No darkness round it (owner removed it): `FLASH.uDark` stays 0, the lights don't dip when it is near.
  - Sound: a metal 'clank' per footstep (from its own step clock, `model.stepHit`), 'servo' on the head snap, 'slam' on each hit
    (all `BRS` in audio.js); your heartbeat (`playHeart`) within 22 m; breathing right behind you; hallucinated breathing and
    footsteps (`follow`); lures (`{t:'lure'}`). Within 10 m the screen shakes and the rumble swells (`brfx.staticK`, `sfx.setDread`).
  - Catching someone (owner's design; `MonsterBrain.planCatch` / `startCatch` / `catchStep`, `Server.monsterKill`): it grabs them by a
    leg or an arm (50/50), lifts them, and slams them 1 or 2 times (50/50) on the floor, or into a wall when one is 1.2–1.7 m from
    it (then 50/50; it turns so the wall is on its right). Modes seize → hoist → slam / slamWall with 4 key frames each (swung up,
    halfway, the hit, the settle; the key travels as the mode's number) → then, one roll (owner's numbers): 1/3 'hang' (`wallSpot`
    within 7 m, state 'hangGo', mode 'hang' 1.6 s, `{t:'hangBody'}`: pinned up by two spikes; no wall = drag), 1/3 'drag' (until it
    sees its next victim or 120 s: `{t:'dropBody'}`), otherwise left where it fell. No blood. The kill message carries
    `{ fate: 'slam'|'drag'|'hang', by, on, n, wall }`. On the players' screens the body is the real hazmat RAGDOLL (`ragdoll.js`
    `hold` / `moveHold` / `release`: one ankle or wrist pinned to a point) held in its right hand for as long as the host names it
    in the mode string (`m:<mode>:<n>:<body id>` → `dragId`; `brfx.takeBody` / `updateBodies`); `setCeiling` keeps it under 2.9 m.
    The victim sees it through the ragdoll's eyes (`caughtMe` / `caughtCamera`), then black, then the usual death view. When the last
    player is caught the host waits 6 s (not 2) before the results. Bodies are only on screens that saw the kill.
  The Listener (a second, blind creature) was REMOVED at the owner's request: no option, brain, model or sounds for it any more.
  Monster peeking: now and then it picks one player (the most alone), finds a spot by an outside corner 7–16 m away where its body is
  hidden but its head leaning out is clearly visible (`findPeek`), leans out (mode `peek:±1`), and leaves 0.5 s after that player
  looks at its head (also if they come within 6 m, see its body, or after 15 s); after a few peeks it may charge them next time.
  Its animation mode travels in its weapon field: `p.w = 'm:<idle|listen|walk|stalk|search|run|notice|kick|freeze|seize|hoist|slam|slamWall|hang|drag>:<n>[:bodyId]'` (or `m:peek:±1`).
  In the Backrooms players wear hazmat suits (`makePlayerModel(team, name, false, 'hazmat')`: yellow rubber, black boots/gloves/tape,
  hood with a dark visor and a respirator) with their name printed on a patch on the back instead of a name tag over the head.
  Suit legs: round hip joints, the thigh runs on past the knee + a knee sphere, so joints never open up when they bend. The torso shell's
  front/back are ~0.14 m from its middle (zip flap and name patch sit there).
  2v2 and deathmatch keep the team uniforms and name tags.
  `brview.js` draws it with baked lighting (per-vertex light from every ceiling panel with 2D wall shadows, soft edges, bounce, AO;
  MeshBasic + vertex colours, so it's cheap), canvas textures (chevron wallpaper, carpet, ceiling tiles, panels, doors, outlets, own EXIT
  sign), pits, skirting boards (the board on the x-facing face runs past outside corners and gets an end cap, so corners close), the wall
  above doorways, door frames, doors, wall outlets, flicker (`group.userData.update`; it no longer dims when the monster is near). Hand-held camera sway in `Game.updateCamera` (Backrooms only, more when running or near the
  monster), strength = `settings.camShake` (Settings → General "Camera shake in the Backrooms", default 0.5, 0 = off). Head bobbing while you walk
  (Backrooms only, owner's request): `settings.headBob` (Settings → General "Head bobbing in the Backrooms", default 0.5, 0 = off; synced
  to the account), step-paced rise/fall + sway + a little roll in `Game.updateCamera`. `monster.js` = the monster's brain on the host (player
  id `'monster'`, team `'monster'` = snapshot team index 3, `use` = chasing): waits `lv.wake` s; its route search may cover the whole walking grid (`nav.n * 1.2`: the longest ways across the big maze need up to ~65 % of it; ~35 ms at worst); states chase (aims ahead of a running
  target), stalk (creeps up on someone far away looking the other way, charges when they turn or it's within 9 m), pursue (runs to where you
  were heading), search (4 nearby spots, in your direction first, listening at each), wander (towards players, more surely the longer it has
  no clue; stops to listen now and then). Hears sprinting (> 3.5 m/s) within `lv.hear` and walking within `lv.hearWalk`; catches on contact (`monsterKill`). The models in
  `models.js` are OUR OWN designs (the owner once asked for a known character from someone else's Backrooms videos; we declined to copy it).
  Sounds in `audio.js` (fluorescent buzz bed, clank/servo/slam, screech/grab). Account stats are not reported for this mode.
- Backrooms lives (PR #77): in Level 0 and Level 1 everyone has 3 lives (`BR_LIVES` in `server.js`): caught or fallen, you are back in the
  start room after 7 s; the game ends when everyone is out of lives, escaped or gone, and when everyone is dead the same level starts again
  5 s after the results. Leaving and rejoining keeps your lives, and a dead player who rejoins stays dead (`brGone`). NOT in the Poolrooms:
  there, when everyone is dead, the Poolrooms start again (`brCheck`, `check_pool.mjs`).
- Backrooms online needs 2–4 players (owner's rule): the lobby's Start is off with fewer and says so, and `Server.startMatch` refuses too.
  Practice can still be played alone; Level 0's solo rules (`brSolo`) stay for solo Practice and for the last one alive. The HUD has no
  timer and no alive counter in the Backrooms (the top bar is hidden; only the task list shows).
- **Backrooms Level 1: the garage (test account only).** `LEVEL1_OPEN = false` in `main.js`: only `LEVEL1_TESTERS` (`test123`)
  get a "Level" choice (Practice and lobby) and the run-on from Level 0's exit. Nobody else can reach it (`Server.startGarage()`).
  DONE: everything in the owner's brief except stage 8 (the final real-device test and hand-over).
  - `garmap.js` — ONE fixed layout (`resolveMap('garage', difficulty)`, theme `garage`, `world.def.gar` = the plan): 64 × 52 m, two floors
    (lower "P2" y 0, upper "P1" y `GAR.FL` 3.4; 3 m clear), about half Level 0's area. Rows of 0.5 × 1 m pillars, parking bays, two car
    ramps (`plan.ramps`, collision = 11 cm steps, drawn smooth), two stairwells, 7 side rooms (`plan.rooms`: attendant booths / storerooms,
    each with windows and a door; NEVER call them "safe rooms"), puddles on the lower floor (`b.water`), and the places for the order:
    `plan.fuse` (lower, north wall), `plan.crank` + `plan.shutter` (a door with `lock: 'shutter'`) + `plan.lift` (upper, north-west),
    `plan.start` (upper, south-east), `plan.log`, `plan.batteries`, plus cars / cones / drain pipes and the empty spots a fake one could be.
    Doors have a floor now: `door.y` (`World.setDoor`, `pushOutOfDoor`, the host's reach check and `Game.doorTarget` all use it).
    `node check_gar.mjs` (add `map` to print both floors): start, fuse box, crank, lift, every side room, battery and empty bay can be
    walked to; ramps alone and stairs alone both join the floors; the lift is shut off while the shutter is down.
  - `garview.js` (+ `garprops.js`: car / cone / pipe shapes) — baked lighting like `brview.js`, per floor. Orange sodium lamps are baked
    into the vertex colours (always on); the white tubes' light is a separate attribute (`aTube`, one number per flicker group) switched
    by the `uTube` uniform, so tubes can be off / on / flickering with their light on the walls (`userData.setPower(on)`: OFF until
    the fuse box is used). No fog, no dark zones. Puddles: the floor is cut away and an upside-down copy of the ceiling,
    lamps, pillars and nearby cars lies under dark water (a cheap true reflection). Also `setShutter(0…1)`, `setBattery(i, on)`,
    `setDoor`, `kickDoor`, `lightAt(x, z, y)`, `propLight` / `litGeo` / `propMat` (so a disguise is lit exactly like a real prop), drips.
  - `shifter.js` — the shapeshifter's brain on the host (`ShifterBrain`; Level 0 keeps `monster.js`). It hides as a prop (a car in an
    empty bay — solid while it is one: `World.setBlock` / `{t:'block'}` —, a stack of cones, a drain pipe on a pillar) and breaks out
    when someone on its floor comes within `GAR_LEVELS.spring` or stays near with their back turned for a second; with 2+ players it
    can walk about as a copy of one of them (never in view of someone who can also see the real one, nor of the real one). Then it
    chases at Level 0's speeds (`BR_LEVELS`), across floors by the ramps and stairs. Side rooms: out of bounds (route cost ∞) unless it
    is chasing; then a shut door is forced in 1.5 s (`Server.forceDoor`). It hears running, wading and doors (and `hearNoise` for the
    crank later). Its shape travels in its weapon field: `s:car:<bay>:<colour>`, `s:cones:n`, `s:pipe:0`, `s:copy:<id>:<walk|still>`,
    `s:true:<tall|lope|low|wide|lump>:<keepsake>`, `s:burst:…`, `s:settle:…`, `s:force:0`, `s:kill:<id>`. Catch: kill weapon `shifter`
    (`{ eng: 1 }`): it closes round the victim; their screen goes black, then the usual death view. No snatches or hallucinations there.
    `node check_shifter.mjs [easy|normal|hard] [minutes]` plays it fast with two pretend players and checks all of that.
  - `shiftmodel.js` — how it looks (OUR OWN design): no shape of its own, a heap of dark wet lumps that never stops rearranging, limbs
    growing and pulling in, pale eyes wandering over it, a keepsake of its last disguise stuck in it; each change has a synthesised
    sound (`shift*` in `audio.js` `BRS`). Giveaways scale with `GAR_LEVELS.tell` (easy 1 … hard 0.3): disguises breathe slightly and tick
    quietly, a fake car has no reflection in the puddles, a copied player walks a little wrong, twitches and has no flashlight. A
    disguised one is not "felt" (no heartbeat / shake): only once it shows itself (`r.revealed` in `Game.updateShifter`).
  - The order (any one player can do each step; `Server.garSt` = `{ power, crank }`, sent to late joiners in the start message's `gar`):
    1 the fuse box: E / hand button within reach (`{t:'fuse'}` → `garFuse` → `{t:'power'}`: the white tubes come on, the lift's lamp goes
    green); 2 the crank: HOLD E / the hand button (`Game.useTarget` kind `crank`; the client sends `{t:'crank'}` every 150 ms of REAL time
    while held — the game clock runs slow at low frame rates — and the host counts a press for 0.7 s). Without power its brake is on
    (toast). It winds only while held and stays where it is left; `GAR_LEVELS.crank` 10 / 14 / 18 s in all; `{t:'crank', p}` moves the
    shutter (`setShutter`) and clicks the ratchet; the monster is told once a second (`hearNoise`, 26 m). At 1 the shutter door opens.
    3 the lift: with power on and the shutter up, standing in `plan.lift` = escaped (`{t:'escaped', lift: 1}`). Ending: you step in and
    turn round, the lift's own doors shut (`setLiftDoors`), it rides up, then the white "You got out." screen (`escapeScene.lift`,
    `delay`); the host waits 9.5 s before the results. The task list ticks the three steps. ONE explorer log (`LOGS[12]` in `brfx.js`)
    on the wall by the start. `node check_gar_order.mjs` plays the order with no graphics.
  - Unlock and level flow. Escaping Level 0 yourself unlocks Level 1: `Game` calls `onEscape(0)` → `unlockBrLevel(1)` in `main.js` saves
    it on the device (localStorage `siteline-br-level`) and, logged in, on the account (`profiles.br_level`, only through the RPC
    `unlock_br_level` in `supabase.sql`; `syncUnlock()` on login copies it both ways; guests only have the device). Choosing Level 1:
    `#p-stage` (Practice) and `#lobby-stage` (lobby; the host's choice, `settings.stage`), shown only where Level 1 is allowed
    (`level1Allowed()`: `LEVEL1_OPEN` or the tester account) and locked ("escape Level 0 first") until the chooser has it unlocked. The
    host's game tells the room whether Level 1 may be played (`{t:'settings', l1}` → `settings.l1`; Practice: `cfg.l1`). With that set,
    escaping Level 0 carries straight on as one run: `Server.brCheck` → `startGarage(true)` 7 s later instead of the results (same
    players and room, the clock keeps going, everyone alive again, also those who died in Level 0). Stats are never reported.
  - The flashlight battery (Level 1 only; Level 0's flashlight is unchanged): `Game.batt` 1 → 0 over 150 s while the light is on; under
    12 % the light stutters (`flashK`, also on the baked walls), at 0 it goes out and won't switch on. HUD bar `#br-batt` under the
    task list (icon `battery`). Batteries (`plan.batteries`) are shared world items: E / the hand button within reach when yours is
    under 90 % → `{t:'batt', i}` → the host gives each one once (`garBattery`, `garSt.batts`, sent to late joiners) → `{t:'batt', i, id}`:
    it vanishes for everyone and the taker's battery is full. Flickering tubes throw sparks and zap (`onSpark`).
  - STILL TO DO for Level 1: stage 8 only — a full test on a real phone and PC with real players (two-player run from Level 0's exit to
    the lift), then set `LEVEL1_OPEN = true` when the owner wants it public.
- **Backrooms Level 2: The Poolrooms (all three stages done).** The end of the Backrooms run for now (no Level 3). Who can reach it:
  wherever Level 1 can be played (`level1Allowed()`: `LEVEL1_OPEN` or the tester account) — so today only `test123`, and everyone the day
  `LEVEL1_OPEN` is set to true. Two ways in: (1) escaping Level 1 carries straight on into it as ONE run (`Server.brCheck` → `startPool(true)`
  9.5 s after the last one takes the lift: same players and room, the clock keeps going, everyone alive again); (2) its own choice
  "Level 2: The Poolrooms" in the Level chooser (Practice `#p-stage`, lobby `#lobby-stage`), locked ("escape Level 1 first") until the
  chooser has escaped Level 1 (`level2Unlocked()`; the tester account can always pick it). The host checks it: the host's game sends
  `{t:'settings', l2}` and `Server` only accepts stage 2 when `settings.l2` (Practice: `cfg.l2`). Escaping the Poolrooms earns a small
  "✓ escaped" tick after its name (`stageName()`, `poolEscaped()`).
  Progress (one number, `brProgress()` in main.js): 1 = escaped Level 0, 2 = escaped Level 1, 3 = escaped the Poolrooms. Saved on the
  device (localStorage `siteline-br-level`, now the number) and on the account (`profiles.br_level` through the RPC `unlock_br_level`,
  capped at 3 — it was 1 before, so the owner had to re-run `supabase.sql`); `syncUnlock()` copies the higher one both ways on login.
  `Game.onEscape(n)` → `unlockBrLevel(n + 1)` (Level 0 → 1, the lift → 2, the hatch → 3).
  "Run complete": the host keeps each level's time in the run (`levelStart()` / `this.run`, `levelEnd` = when the last one got out; a
  restart after everyone died doesn't start a new level) and sends `run` + `runTotal` (the run's clock when the last one got out, rides
  between levels included) with `over`; `showBrOver` shows "Run complete", each level's time, the whole run, then the players.
  No joining mid-game: a friend who joins while the Poolrooms run watches (not spawned, `brDeath = 'late'`, "Joined to watch"); they
  play from the next start (a restart after everyone died). Account stats are not reported. Online it takes 2–4 players like the rest.
  - `poolmap.js` — ONE fixed, hand-made layout (`resolveMap('pool', difficulty)`, theme `pool`, `world.def.pool` = the plan), 64 × 52 m:
    ground floor deck at `POOL.G` 3 m (pools go down from there; their water at `POOL.WY` 2.88), flooded rooms (knee-deep, floor `POOL.SH`),
    upper floor at `POOL.U` 10 m (7 m higher), roof underside `POOL.ROOF` 12.8. West side (start): lane hall (Picture B: slanted wall with
    capsule windows), flooded hall + vaulted tunnels + dark dead ends (Picture C), kidney hall (Picture A), the start hallway (Level 1's lift
    doors at its east end, shut). East side (needs the bridge across the deep channel, stage 2): atrium with the Great Pool (open to the roof),
    slide hall + plunge pool, round stair tower (curved stair, `towerH`), galleries upstairs with NO railings, slide platform (three mouths),
    the grotto (only by the green slide), the exit tunnel under the Great Pool (opens when it is drained, stage 2). No doors anywhere.
    New world hooks (also used by the host): `b.body(info)` + `b.wet(...)` = bodies of water with their own level (`world.bodies`,
    `world.bodyAt(x, z)`; `waterAt` answers from them), and `mapDef.solid(x, z, r, y, step, h)` = shapes that aren't boxes (round pillars,
    round rooms, the pools' smooth curved edges), checked in `World.blocked`. Pillars never stand in the water (checked).
  - `poolview.js` (+ `poolfx.js` shaders, `poolprops.js`: valve wheels, the drain stand + gauges, floaties, the hatch) — the look: every surface's soft light is baked at load (white sky in windows/skylights + the
    sun's landing patches as lamps, with shadows, blurred fill) and then adapted to how bright the place is overall (`EXPO`: bright halls
    turned down as a whole so sun patches still stand out); the low sun (fixed, `POOL.sun`) comes through ONE shadow picture taken at load.
    The 5 cm mosaic (and 6×6 sheet seams) is drawn by the tile shader (exact grout filtering: no shimmer), damp shiny floor near water,
    caustics under water and dancing light on walls/ceilings above it (Medium up), teal depth tint, soft haze. Water: gentle swell + rings
    from people (`addRipple`), a real mirror picture on Medium up (`preRender`; Low uses the baked ceiling light instead), sun glints.
    Light shafts + dust specks (Medium up), people's shadows in the sun (Medium up: a small second shadow picture, layer `castLayer`).
    Curved parts are built on top of the grid: rounded pool lips + overflow gutters, round pillars, arches/capsules (`shapedHole`), vaults,
    coves where ceilings curve into walls, the slanted window wall, steel ladders, round floor drains, coloured slide mouths.
  - `poolplay.js` — your first-person arms (`PoolHands`: breaststroke while swimming, hand over hand on a ladder's rails), `poolTint`
    (people's parts under the surface are seen through the water; `setWet`: a soaked suit is darker and shinier, dries over 90 s) and
    `PoolClient` (the level on your screen: applies the host's `{t:'pool', s}` state, plays `{t:'pfx'}` events, the use target and hold-E
    sends, throwing, the slide ride + its camera, floaties' bobbing, wet footprints that fade, steam hiss).
  - THE ORDER (Claude's design; the owner asked for 4 water-based steps, no hints, no task list, no logs, no map). Host side: `poolhost.js`
    (`PoolHost`, made in `Server.startPool`; runs in the host's browser and on the home server). Any one player can do each step.
    1 the bridge: pressure plates (`plan.bridges[].plates`, 1 m squares of blue tiles that sink 3 cm) raise a tiled bridge across the deep
      channel (`'need'`) while someone stands on one; alone (`brSolo`) it stays up `POOL_LEVELS.hold` s (9 / 7 / 5.5) after you step off.
      It never rises onto a swimmer; sinking with someone on it drops them into the water (safe, they swim round). `setBridge()` in poolmap.js
      adds/removes '_bridge' spans (host and players). A second, optional bridge (`'view'`) crosses the lane pool to the apse under its
      light well (`plan.well`): only a view.
    2 the steam: three valves (`plan.valves`: atrium wall, upstairs gallery on a post, the grotto — only reached by the GREEN slide), RED
      handwheels on brass pipes (owner's request). HOLD E / the hand button (sent every 150 ms of real time, counts 0.4 s) turns one over
      `POOL_LEVELS.turn` s (2 / 3 / 4); it stays where it is left; turning again goes back (undo). Each valve heats lanes of the Great Pool
      (`POOL_LEVELS.lanes`, `hotLanes()`: a lane is hot when an odd number of open valves feed it). Easy: one lane each (all three open);
      normal / hard: the upstairs valve must stay SHUT, the grotto's open. Soft wisps of steam rise off hot lanes (`steamMaterial`), and the
      grotto's basin always steams a little; three gauges on the drain stand show each lane's heat.
    3 the drain: every lane hot = the brass catch on the drain wheel swings away (`unlocked`); HOLD E turns it (`turn × 2.5` s, stays where
      left; locked it rattles, no words). Then the Great Pool empties over 10 s for good (`DRAIN_SECS`, host sets `great.y`), revealing the
      tunnel in its south wall.
    4 the exit: through the tunnel, up the exit ladder in the shaft (`plan.exit`), out through the white hatch (feet ≥ `hatch.out`):
      `{t:'escaped', hatch: 1}` → `Game.escapeScene.hatch` (you rise into the light, white "You got out.", the water sounds give way to wind
      and birds: ambience `poolout`). Each player gets out on their own; the others see them climb into the light.
    Falls: more than 6 m (`FALL_KILL`) onto a hard floor kills — your game sends `{t:'fell', h}` on landing, the host checks you really were
    that high in the last 4 s and that you didn't land in water at least waist deep (a drained pool doesn't count) → kill weapon
    `poolfall` (ragdoll, no blood, "You fell too far"). Everyone dead → the Poolrooms start again 5 s later (the run's clock keeps going).
    Slides (`plan.slides`, `slideCurve()`): walk into a mouth on the slide platform → a ~5 s first-person ride down the tube (`RIDE_SECS`,
    camera leans into the bends, dark inside with joints flashing by, light at the end), then you shoot out over the water (red → kidney
    hall, blue → plunge pool, green → the grotto). The tubes run inside solid wall all the way (checked); the outlets are built along the
    same path. Others: the rider vanishes into the tube (`{t:'slide'}`) and shoots out ~5 s later.
    Floaties (`plan.floaties`: a red-and-white ring, a yellow one): host physics in `PoolHost.ringStep` (drift + bob on water, pushed by
    swimmers, thrown arcs that bounce off walls and pillars, rest on floors, lost for good on the roof); E / hand button picks one up,
    fire / the aim button (shown in `pool-ring` mode) throws it. Rubber squeak / thump sounds.
    Sounds (all synthesised, `POOLS` + `playPool` in audio.js): plate clunk, stone grind (bridges), valve squeak + clank + pipe gurgle,
    steam hiss, catch unlock, drain rush, slide whoosh + rushing water, splashes, strokes, rubber, wet tile footsteps (`STEP.tile`).
    Interaction prompts only say how ("Hold E to turn the wheel", "Press E to pick it up"), never what to do.
  - Movement (game.js `poolWater` / `poolFloat` / `poolLadder`): walk 2.7 / sprint 4.5 as in the Backrooms, knee-deep water hardly slows
    you, deep water = swimming at 80 % of a walk (head up, the camera bobs; falling in is a splash, never a landing), you climb out at
    ladders (push towards one), the lane pool's steps, or ANYWHERE over a pool's edge (owner's request; `Game.poolUnstick` moves you to the nearest free water if you fall in right by a pool's side or a wall — you used to land inside the edge and could not swim; `Game.poolEdge`: swim up against the
    side and keep pushing: hands on the edge, up and over in 0.8 s) except onto the three edges the order needs (`plan.noClimb`: the
    channel's far bank, the grotto from the Great Pool, the apse's deck; `check_pool.mjs` models edge climbs and proves the order still holds). Jumping IS allowed here (normal jump). Phones: the jump button jumps; the run
    button (`#btn-inspect`, moved next to it in `pool-mode`) sprints while held (`input.runHeld`). No flashlight, no map, no task list, no hints
    (only the move keys for the first seconds). Others see you swim (breaststroke, frog kick) or climb (`animateModel` `swim` / `climb`).
  - `node check_pool.mjs [map]` walks and swims the whole map with no graphics: the start side is all reachable, nothing past the channel
    without the bridge, everything (both floors, every ladder, plate spot, valve spot, slide mouth) with it, the grotto only by the green
    slide and you can get out of it, nobody can get stuck anywhere, the exit only once the Great Pool is drained. `map` prints both floors.
    It also checks every slide tube runs inside solid wall, and plays the whole order on the real host code with pretend players (1 and 2,
    every difficulty): plates and bridges (solo hold, never onto a swimmer), wrong valves don't unlock, undo, the drain, the hatch, falls
    (deadly onto floor, safe into water), floaties, slides, everyone dead = start again.
- `check_map.mjs` — `node check_map.mjs outpost` / `node check_map.mjs quarry large` checks every area and spawn is reachable
- `check_br.mjs` — `node check_br.mjs 300` (or `node check_br.mjs 300 0 hard` for one level; `node check_br.mjs 1 <seed>` prints a map) checks
  Level 0 layouts on the real floor: start, key, levers and exit reachable with every ordinary door shut; every room reachable; each gate the
  only way between its sections; C → D only across the pit hall (block the hall: D unreachable); no section a dead end; exit room an
  island; no dead end longer than 4 rooms; the monster starts in A, can only get into sections whose gates are open at each stage, reaches
  every room of the current section, and (doors shut) can follow players back into earlier sections; its home logic (`MonsterBrain`).
- `check_br_monster.mjs` — `node check_br_monster.mjs [easy|normal|hard]` plays Level 0 fast with no graphics: two pretend (uncatchable)
  players go through the stages; checks the monster stays in A when a gate opens with them still behind it, follows them into B, C, D (across
  the pit hall), never gets ahead of them, and walks home after chasing someone back.

- Rejoin: the last room joined as a guest is kept in localStorage for 30 min (`siteline-lastroom`); the menu shows
  "Rejoin your last game (CODE)". The host remembers leavers by name (`rememberLeaver` / `restoreLeaver` in `server.js`): team,
  score and money come back. If a whole team leaves a 2v2, the clocks stop for `REJOIN_WAIT` (60 s, `this.hold`) and the round is
  replayed when they are back; after that it is a forfeit. A host who leaves a peer-to-peer room closes it (no rejoin).
- Menus: no "How to play" screen and no tagline under the logo (owner removed both). Loading screen while a game is built
  (`#game-loading`, `beginGame()` in `main.js`: map name, mode, steps on a bar, fades out after the first frames are drawn); messages
  that arrive meanwhile wait in `app.starting` and are handled in order once the game exists (so your spawn is never lost).
- `Game.loop` clamps dt to ≥ 0: a first frame stamped before loading finished used to wind the game clock back by seconds (monsters' jerky
  steps froze until it caught up).
- Phones held upright in a game get the "Turn your device sideways" pop-up (`#rotate`). A self-turning page (`turn.js`) was tried and
  REMOVED at the owner's request; don't bring it back.
- Pause menu on phones: the tap on the pause button also arrived as a click on the dark background (which resumes), so the menu shut
  at once and Leave was unreachable; background taps are ignored for 0.5 s after it opens (`app.pauseAt`). Overlays scroll when taller
  than the screen, and the pause menu is compact (2 columns) when the screen is under 500 px tall.
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
