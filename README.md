# SITELINE

A free, browser-based 2v2 tactical shooter (wingman). Two teams of two, one bomb site, 14 weapons and a full money system. Runs on phones, iPads and PCs with no install and no game server — it's a static website you can host on GitHub Pages.

- **Attackers** plant the bomb on the site and protect it until it explodes.
- **Defenders** stop the plant or defuse the bomb. Wiping out the other team also wins the round.
- **14 weapons** bought with money at the start of each round: Glock-18, USP-S, Tec-9, Desert Eagle, MAC-10, MP9, MAG-7, XM1014, Galil AR, AK-47, M4A4, M4A1-S, SSG 08 and AWP. Some are attackers-only, some defenders-only, some both. Plus **Kevlar, helmet** and the **defuse kit**.
- **Money:** $800 at the start of each half, round-win money, kill rewards per weapon, a loss bonus that grows each round you lose, and bomb plant/defuse bonuses. Max $16,000.
- **Realistic shooting:** each automatic gun has its own fixed spray pattern, you're only accurate when (nearly) standing still, armour reduces damage and stops your aim being knocked about, and damage drops with distance.
- **Movement:** speed depends on the gun in your hands, counter-strafing stops you instantly, walking and crouching are silent, crouching in mid-air jumps higher, and well-timed jumps keep your speed (bunny hopping). Jump onto a teammate's head to **boost** — they can walk around with you on top, and crouch to lower you.
- **Drops:** the dead drop their main gun (or pistol) and defuse kit; walk over a gun to take it into an empty slot or press E to swap. G drops your gun for a teammate (you always keep at least one) or the bomb, if you're holding it with 5. Only defenders can pick up kits.
- **Ragdolls:** bodies go limp and fall with physics ([cannon-es](https://github.com/pmndrs/cannon-es)), pushed by the shot that killed them.
- The scoreboard shows every player's **ping** to the host, colour-coded green / yellow / red.
- **Accounts (optional):** sign up with an email, password and username to keep your stats and settings. Your stats are kills, deaths, headshots, damage, matches and rounds won, deathmatch wins and favourite weapon, and each match win adds 10–80 cents to a balance. Guests can still play. Turning accounts on is explained in **SUPABASE.md**.
- **Chat:** all chat (Y) and team chat (U), with a 💬 button on phones. Messages are limited to 100 characters and 3 every 5 seconds, and swear words are starred out but keep their first letter.
- **Settings:**
  - every key can be rebound
  - a crosshair editor with share codes
  - a phone layout editor (move, resize and fade every button)
  - graphics presets Low / Medium / High / Ultra / Custom. Custom covers render scale, shadows, anti-aliasing, ambient occlusion, bloom, textures, view distance, model detail, effects, FPS cap and field of view.
- **Night mode:** the host can make the map dark. Everyone has a flashlight (L / 🔦), and other players can see its beam and the light it casts.
- Every gun has a **draw** animation and an **inspect** animation (F / 🔍). Characters are animated running, walking, crouching, jumping, planting and defusing, and turn into **ragdolls** when they die.
- **Four 2v2 maps**, each with one bomb site:
  - **Outpost**: a desert trading post with a two-storey depot, a balcony and a covered gate.
  - **Foundry**: a steel works where the site is inside the main hall, ringed by catwalks you can also reach by outside stairs.
  - **Frostline**: a snowy research station. The site is a courtyard overlooked by a two-storey lab with a balcony.
  - **Canal**: a sunny hill village of stone and plaster houses split by a narrow canal. The site is the church piazza under the bell tower. Three ways in: the north bridge and gate arch, through the two-storey inn and a quick wade under the archway, or the long south street and its bridge. Wading is slow and every step splashes.
  - All maps have boxes and barrels you can jump on and **shoot through**.
- **Deathmatch** for 2–4 players: everyone for themselves, first to 30 kills or 10 minutes. You respawn after about a second at the safest spot, with full armour and a helmet. Any gun is free at any time from the buy menu. It has two maps of its own, **Quarry** and **Railyard**, each with a small version (2 players) and a large one (4 players), picked automatically when the match starts. With exactly 3 players, deathmatch is played on the 2v2 maps instead.
- 2v2, up to 4 players per room. **First to 9 rounds** wins, the teams **swap sides after round 8**, and 8–8 is a draw. Rounds last 1:55, the buy menu is open for the first 20 seconds.
- **Bomb:** plant in 3.2 s, explodes 40 s later. Defuse takes 10 s (5 s with a kit) and you must keep looking at it. The blast is a shockwave that walls block — while the bomb ticks the floor glows where it would hurt you and your health bar shows how much damage you'd take.

## Put it on GitHub Pages

1. Create a new repository on GitHub (e.g. `siteline`).
2. Upload **everything in this folder** to the root of the repo (drag-and-drop on github.com works, or use git — see below).
3. In the repo go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute your game is live at `https://<your-username>.github.io/<repo-name>/`.

```bash
git init
git add .
git commit -m "SITELINE"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

The site needs to be served over HTTP(S) — opening `index.html` straight from your disk won't work because it uses JavaScript modules. To try it locally run `python3 -m http.server 8080` in this folder and open `http://localhost:8080`.

## Playing with friends

1. One player clicks **Host a game** and gets a 5-letter room code.
2. Everyone else types the code and taps **Join** — or the host taps **Copy invite link** and sends it.
3. The host picks **2v2 Bomb** or **Deathmatch** and a map. In 2v2, players pick a team (two per side). In deathmatch there are no teams. Then the host presses **Start match**.
   - The map list only shows maps that fit. Deathmatch shows Quarry and Railyard for 2 or 4 players, and the 2v2 maps for 3 players.

**How it works:** there is no game server. The host's browser runs the match and the other players connect to it directly over WebRTC (using [PeerJS](https://peerjs.com)). The free public PeerJS server is only used to introduce players to each other.

Things to know:

- **The host must keep the game open and in the foreground.** If the host leaves, the match ends for everyone. On phones, switching apps can pause the host's browser — the best host is a PC or laptop.
- Most home Wi-Fi works out of the box. Some mobile data networks and strict school/office networks block direct connections. If players can't join, add a TURN relay server in `config.js` (services like Metered, Twilio or a self-hosted coturn provide one).
- The public PeerJS server is free and best-effort. You can run your own with `npx peerjs --port 9000` and point the game at it in `config.js` (or with `?peerhost=…&peerport=…` in the URL).

## Controls

| PC | Phone / iPad |
| --- | --- |
| **WASD** move, **mouse** aim, **left click** shoot | Left thumb anywhere on the left half = joystick |
| **Right click / Q** scope · silencer on/off · burst mode | Drag on the right half to aim |
| **Space** jump, **Shift** walk quietly, **C** crouch | Hold the big fire button (drag it to aim while firing) |
| **R** reload | ↻ reload, ⤒ jump, ◎ / 🔇 / ≡ scope, silencer or burst |
| **Hold E** plant / defuse, **tap E** pick up the gun you look at | Hold ✋ (appears when you can plant, defuse or pick up) |
| **B** buy menu, **1 / 2 / 5 / wheel** main gun / pistol / bomb / switch | 🛒 buy menu, ⇄ switch gun / bomb |
| **F** inspect, **L** flashlight (night mode), **Y / U** all / team chat | 🔍 inspect, 🔦 flashlight, 💬 chat |
| All keys can be changed in **Settings → Controls** | All buttons can be moved in **Settings → Phone layout** |
| **G** drop gun / bomb | ⇩ drop, ⤓ crouch on/off |
| **Tab** scoreboard + ping, **Esc** menu | ☰ scoreboard + ping, ❚❚ menu |

On iPhone, use Safari's **Share → Add to Home Screen** and launch from the icon for full-screen play. Play in landscape.

## Ping

The host measures each player's round-trip time every 2 seconds. Under 80 ms is green, under 160 ms is yellow, anything higher is red. The host's own ping shows as **HOST** (they *are* the server). High ping usually means a player is far from the host or on a weak connection — pick the player with the best internet as host.

## Practice and bots

**Practice & bots** on the main menu has three ways to play against computer players (bots only ever appear here, never in normal matches):

- **Practice range:** walk any 2v2 map, try every gun for free and practise planting.
  - Turn bots on or off and pick how many there are (1–8).
  - Pick what they do: stand still as targets, move around, or move and shoot back.
  - Every hit shows the damage it did. Bots marked "(armour)" wear a vest and helmet, and bots respawn 3 seconds after dying.
- **Bot match:** a full 2v2 bomb match, with you and a bot against two bots. Choose your side.
  - Bots buy guns and armour with their money.
  - Attacking bots carry the bomb to the site and plant it. Defending bots hold the site and defuse.
- **Bot deathmatch:** you against 1–3 bots on the deathmatch maps (or the 2v2 maps with 3 players).

Bots come in **easy, normal and hard**. Harder bots react faster, aim better, control recoil and go for headshots more often.

**Invite friends:** open the pause menu (Esc or ❚❚) to see the room code and a **Copy invite link** button. A friend who joins takes a bot's place: in the bot match they replace your team's bot from the next round, otherwise straight away. When they leave, a bot comes back. Practice works without an internet connection; only the invites need one.

## Project layout

```
All website files sit side by side in the top folder:

index.html            page, HUD, menus, touch controls
style.css             all styling
main.js               menus, lobby, hosting/joining, practice menu
bots.js               computer players for practice games: walking grid, aiming, buying, planting/defusing
accounts.js           optional Supabase accounts: sign up / log in, stats, settings sync (see SUPABASE.md, supabase.sql)
keys.js, crosshair.js, touchlayout.js, graphics.js   key bindings, crosshair, phone layout and graphics settings
post.js, anim.js      graphics effects (ambient occlusion, bloom, FXAA) and first-person animations (draw, inspect, reloads, hands)
filter.js             chat swear filter
server.js             match rules (runs in the host's browser): rounds, money, buying, halftime, bomb, damage, hit checks
game.js               3D client: movement, shooting, recoil, effects, bomb blast preview, HUD updates
buy.js                the buy menu
net.js                PeerJS host/client connections
world.js              map model, collision, ray casting, wall-bang penetration, hit zones, bomb shockwave
mapview.js            builds the 3D scene from a map grid
mapdeco.js            map dressing: windows, wall caps, lamps, pipes, ground detail, distant scenery
maps.js               map build scripts
weapons.js            weapon stats, prices, money rules, spray patterns, armour maths — tweak numbers here
ragdoll.js            death ragdolls (physics with cannon-es, client only)
config.js             network settings and match rules (rounds to win, halftime, timers, blast size)
models.js, textures.js, audio.js, input.js, hud.js
three.module.js, three.core.js, peerjs.min.js, cannon-es.js   bundled libraries (MIT licensed)
check_map.mjs         checks a map's routes connect and draws a preview
```

## Cover and wall-banging

Boxes, crates and barrels can be shot through — damage drops the more of them a bullet crosses, and each weapon punches through a different amount (`pen` in `weapons.js`: 2.5 for the snipers, 2 for rifles and the Desert Eagle, 1 for the rest). Walls, floors and the truck stop everything.

Barrels and 1 m boxes can be jumped onto. Climb a barrel to reach the truck bed. The tall crates can't be climbed.

## Making your own maps

Maps live in `maps.js` as small build scripts measured in metres (x runs west → east, z runs north → south). The world starts as solid rock and the script carves it out:

```js
b.open(2, 17, 13, 31);                    // walkable ground
b.wall(18, 23, 38, 23.5, 7.2, 'building'); // wall (x0, z0, x1, z1, height, material)
b.cut(26, 23, 28.5, 23.5, 3.6, 5.8);        // door/window through it (y from, y to)
b.slab(22, 19.5, 31, 23, 3.6);              // upper floor or balcony at 3.6 m
b.stairs(25.5, 37, 31, 39.5, '+x', 0, 3.6); // stairs climbing toward +x
b.roof(13, 3, 20, 8, 3.4);                  // roof overhead
b.box(27.5, 12.5, 29, 14);                  // 1 m box (shoot-through, jumpable)
b.crate(40, 13, 41.5, 14.5);                // tall crate (shoot-through, not climbable)
b.barrel(29, 7.5);                          // barrel (shoot-through, jumpable)
b.truck(30, 7, 37.5, 9.5, '+x');           // truck facing east
b.site('A', 28, 3, 42, 16);                 // bomb site
b.spawn('atk', 5, 21, -Math.PI / 2);        // spawn facing east
```

Keep coordinates on 0.5 m steps, corridors at least 1.5 m wide, and stairs rising no more than 0.4 m per 0.5 m. Add `b.spawn('dm', x, z, yaw)` points (at least 3 on a 2v2 map) so it can host a 3-player deathmatch.

Deathmatch maps have `mode: 'dm'`, a `sizes: { small: [w, d], large: [w, d] }` entry and `build(b, size)`, which builds the small or large version. They need at least 8 `dm` spawns.

Then check that everything connects:

```bash
node check_map.mjs outpost preview.ppm
node check_map.mjs quarry large preview.ppm
```

It confirms every spawn, the site and any `checkPoints` you list can be reached on foot, and writes a top-down preview image.

## Credits

- [three.js](https://threejs.org) — MIT License (`THREE-LICENSE.txt`)
- [PeerJS](https://peerjs.com) — MIT License (`PEERJS-LICENSE.txt`)
- [cannon-es](https://github.com/pmndrs/cannon-es) 0.20.0 — MIT License (`CANNON-LICENSE.txt`)
- All models, textures and sounds are generated in code.
