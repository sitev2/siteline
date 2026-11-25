Build "The Poolrooms" (Level 2 of the Backrooms) in SITELINE. Read CLAUDE.md first and follow all its rules: flat layout, our own art and sound made in code, new .js files added to index.html's `files` list, touch controls for every feature, plain-language explanations, auto-merge once tested. This builds on Level 1 (the parking garage). If Level 1 isn't merged yet, ask me.

ACCESS + PLAYERS
- Name in the menus: "The Poolrooms".
- Reached two ways: escaping Level 1 continues straight into it as one run; and its own choice in the lobby and Practice menus, only for players who have beaten Level 1 (the host checks; saved on the device AND on the account, like Level 1's unlock).
- A small "escaped" tick in the menu once you've beaten it.
- 2–4 players online, 1–4 in solo Practice. Keep easy / normal / hard.
- This is the end of the run for now (no next level). Account stats are not reported.

THE LOOK (owner's reference picture)
- TOP PRIORITY: the Poolrooms must look REALLY good: beautiful, believable water (gentle ripples, clear see-through depth, reflections, caustics, soft wet highlights on the tiles) and high-quality tiles, light and everything else. Take the time it needs; polish it, compare it with the reference picture in browser screenshots and keep improving until it looks great (still smooth on phones on Low).
- MORE REFERENCE PICTURES (owner's): (a) curvy, kidney-shaped pools with thick rounded tiled edges and walkways winding between them; warm cream/off-white tiles on EVERYTHING (floor, walls, the curved ceiling); fat round pillars, some standing on rounded tiled islands at the pool edge; warm low sunlight making bright patches and soft wavy light reflections on the walls; shiny steel pool ladders; calm turquoise water mirroring the pillars. (b) a long, narrow pool hall with a slanted wall full of a row of tall OVAL / capsule-shaped windows glowing with bright white light, reflected in the water; a small arched doorway at the far end; ceilings that curve into the walls. Make our own rooms with this feel (not a copy).
- Water details: rings of ripples spread from players walking or swimming; teal-green water like the picture; rounded tile lips with overflow gutters on pool edges; no underwater view or effects (only swimming on the surface); damp shiny patches on dry floor near water; light reflections dance on the walls and ceiling above water, not just the floor.
- Tiles: small ~5 cm mosaic like the picture, in perfect condition (no stains or cracks).
- Wide, low halls with big ROUND pillars covered in small white square tiles with dark grout, a few tall square tiled pillars, smooth pale walls and ceiling.
- Floors are a MIX: some flooded with shallow, glassy teal-green water that mirrors the pillars, some dry, plus real pools.
- Soft hazy light, brighter in the distance, with dark openings far back. Mostly empty and quiet: only pillars, ladders and drains, no loungers or plants. Our own build, nothing copied.
- Pale blue accent lines (lane stripes, edges). Curvy, rounded rooms and arches.
- Bright soft daylight from skylights with a blown-out white sky; light shafts on Medium graphics and up. A soft bright haze in the distance.
- Ceilings vary: low tunnels and some tall halls.
- Water reflections and caustics depend on the graphics quality (simpler on Low so phones stay smooth).
- Loading can take as long as it needs for the detail.
- No night mode: always bright.

LAYOUT
- About half of Level 0's area. ONE fixed, hand-made layout (not random).
- Two floors, joined by stairs and enclosed water-slide tubes (dark inside, one way down, you splash out at the bottom).
- NO doors anywhere: open archways only.
- Players start standing in a hallway.

WATER + MOVEMENT
- Shallow water is knee-deep with only a very subtle slowdown.
- In deep water you swim at about 80 % of walking speed. No going underwater. No water drops on the screen.
- You climb out of deep pools only at ladders and steps.
- Clear water with caustic light patterns on the tiles.
- Movement is the same as the Backrooms (walk by default; Shift or the held jump button sprints), BUT jumping is allowed (normal 2v2 jump height).
- Shoulder boost like Level 0 (climb on a teammate).
- No flashlight (it's bright enough), no diving board.
- Touch: the same joystick swims automatically in deep water.
- Camera shake and head-bob settings apply as in the Backrooms.
- Players wear the hazmat suits, as in Level 0 and Level 1.

DANGER
- No creature, no hallucinations, no time limit. The tension comes from the atmosphere only.
- You can only die from falls: more than ~6 m onto a hard floor kills; anything lower does no harm (no damage in between). Landing in deep water always saves you.
- "Sabotage" is just for fun, not a feature or a role: stepping off a pressure plate makes the bridge sink and a friend on it splashes into deep water (safe; they have to swim round).
- Dead players spectate, as in Level 0.

ITEMS
- Only 2 floaties / swim rings, just for fun: they bob and drift on the water, synced for everyone. The E / hand button picks one up; fire throws it.

THE ORDER (4 steps, water-based; Claude designs the exact order and puzzles)
- No step text in the HUD, no explorer logs, no map: players work it out by seeing the valves and the pools.
- Pressure plates: tiled slabs rise out of the water as a bridge only while someone stands on the plate (the 2-player step). Solo fallback: the bridge stays up a few seconds after you step off.
- Temperature valves/levers: steam rising off a pool shows it is hot; a hot pool is linked to a hidden valve or path (hot water is harmless to swim in).
- Drain: pull a plug chain or a big valve and the water level simply drops over ~10 s (no whirlpool), revealing a path at the bottom and the hidden exit ladder.
- Exit: the ladder leads up to a bright white hatch, then the white screen ("You got out."). Each player escapes on their own (like Level 0). Results show the total run time and the time on this level.
- Notes (N key) work as in Level 0. Normal text chat.

SOUND
- Water lapping, drips and strong tiled reverb; a full set of swimming, splashing and wading sounds; no music.
- Bridges and valves: a deep stone grind and pipe gurgles.

MORE DETAILS (owner's answers 101–180; these win over anything above)
- Look: warm cream tiles (picture 2's colour), late-afternoon golden light, fixed (the sun doesn't move), warm low sun patches. Tiled ceilings that curve into the walls. Round-topped arched openings. Shiny steel pool ladders (the climb-out spots). Pools are a mix of curvy/kidney shapes and long straight lanes; NO pillar islands in the pools. Some long corridors of shallow water. Small round steel floor drains. Oval glowing windows only in a few long halls. Subtle dust specks floating in the light beams. Player shadows on Medium and up. No crawl tunnels, no fountains, spouts or waterfalls: calm water only.
- Players: suits get wet-shiny after swimming and dry slowly; wet footprints on dry tiles fade out; no dripping. Others see a breaststroke with the head up; in first person you see your arms' strokes; the camera bobs gently on the water. Teammates are shown only by the names on their suits (no markers).
- Upper floor: balconies overlooking the pools, with NO railings (you can fall off); a lower, cosier ceiling up there. About 7 m between floors, with some drops onto hard floor that kill (and others with water below). Curved tiled stairs. Skylights on the top floor only; the ground floor gets light through openings. A fall death shows a ragdoll, no blood.
- Slides: 3 tubes, one red, one blue, one green; dark inside with light at the end; a fast, twisty first-person ride of ~5 s; one slide is needed on the puzzle path.
- Puzzles: pressure plates are slightly raised blue-tiled squares that sink a little with a clunk. Valves are big brass wheels on pipes: HOLD E / the hand button to turn one. Steam puzzle: 3 valves; it can be undone by turning them back; the hot pool hides the valve/path; soft wisps of steam, no colour change. Drained pools stay empty. One bridge is needed plus one optional bridge that only leads to a nice view. No hints, however long you're stuck. No bots.
- Floaties: one red-and-white ring and one yellow ring, throw only (you can't wear them), rubber squeak/thump when they hit something; a lost one stays lost.
- Sound: wet tile footsteps (slaps) with echo, a soft air hum and distant water, a whoosh + rushing water + splash on slides, a soft hiss near hot pools.
- Flow: the Level 1 lift opens onto a bright hallway (the start). Loading screen: pale tiled background + the name. No graphics tips, no photo mode. Exit: first-person hands on the ladder rungs; the water sounds fade into soft wind and birds; others see the player vanish into the light; escaped players can spectate the rest. After the Poolrooms, a short "Run complete" screen with each level's time. If everyone dies, the Poolrooms restart. No joining mid-game in the Poolrooms.
- BUILD IT IN PARTS to save usage: (1) the map + the look, (2) the puzzles and the order, (3) menus, unlock, checks and tests. Merge each part when it's tested.

CHECKS
- Add check_pool.mjs proving the start, every step, the ladder and both floors can be walked or swum to (with bridges up as needed).
- Full browser tests at phone and PC sizes: menus, the unlock (device and account), a full solo Practice run and a full 2-player run.
- If accounts need a SQL change, tell me click by click how to re-run supabase.sql.
- Update CLAUDE.md. Auto-merge when tested. ANY QUESTIONS ASK ME.
