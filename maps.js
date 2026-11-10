// Maps are build scripts. The world starts as solid rock; `open` carves walkable
// ground, then walls, floors, stairs, roofs and props are added on top.
// Units are metres. x runs west→east, z runs north→south. Keep edges on 0.5 m.
//
//   b.open(x0,z0,x1,z1)                 carve ground
//   b.wall(x0,z0,x1,z1, height, mat)     solid wall (mat: 'wall' | 'low' | ...)
//   b.slab(x0,z0,x1,z1, topHeight)       upper floor / balcony you can stand on
//   b.roof(x0,z0,x1,z1, height)          roof overhead
//   b.stairs(x0,z0,x1,z1, '+x', h0, h1)  stairs climbing in the given direction
//   b.cut(x0,z0,x1,z1, y0, y1)           punch a door or window through walls
//   b.box / b.crate / b.barrel / b.truck props (boxes, crates & barrels can be shot through)
//   b.spawn('atk' | 'def', x, z, yaw)    yaw: -π/2 faces east, +π/2 faces west, 0 north, π south
//   b.spawn('dm', x, z, yaw)             deathmatch spawn point (spread them out)
//   b.site('A', x0,z0,x1,z1)             bomb site area

const EAST = -Math.PI / 2, WEST = Math.PI / 2, NORTH = 0, SOUTH = Math.PI;
// Wraps a builder so a block of map script can be placed with an offset
// (deathmatch maps build the same core into a bigger area for 4 players).
function shifted(b, ox, oz) {
  const r = (x0, z0, x1, z1) => [x0 + ox, z0 + oz, x1 + ox, z1 + oz];
  return {
    open: (...a) => b.open(...r(...a)),
    wall: (x0, z0, x1, z1, ...rest) => b.wall(...r(x0, z0, x1, z1), ...rest),
    cut: (x0, z0, x1, z1, ...rest) => b.cut(...r(x0, z0, x1, z1), ...rest),
    slab: (x0, z0, x1, z1, ...rest) => b.slab(...r(x0, z0, x1, z1), ...rest),
    roof: (x0, z0, x1, z1, ...rest) => b.roof(...r(x0, z0, x1, z1), ...rest),
    stairs: (x0, z0, x1, z1, ...rest) => b.stairs(...r(x0, z0, x1, z1), ...rest),
    box: (...a) => b.box(...r(...a)),
    crate: (...a) => b.crate(...r(...a)),
    barrel: (x, z) => b.barrel(x + ox, z + oz),
    truck: (x0, z0, x1, z1, f) => b.truck(...r(x0, z0, x1, z1), f),
    spawn: (team, x, z, yaw) => b.spawn(team, x + ox, z + oz, yaw),
    site: (name, ...a) => b.site(name, ...r(...a)),
  };
}

const UP = 3.6;          // upper floor height
const BH = 7.2;          // building wall height

export const MAPS = {
  outpost: {
    name: 'Outpost',
    description: 'Wingman. A walled trading post: one bomb site, a two-storey depot with a balcony, and a covered gate.',
    theme: 'desert',
    size: [64, 48],
    massHeight: 6.5,
    // extra spots the map checker confirms you can walk to (x, z, height)
    checkPoints: {
      'depot upper floor': [34, 30, 3.6],
      'balcony': [26, 21, 3.6],
      'watch platform': [50, 22, 2.4],
      'gate passage': [17, 5.5, 0],
      'south lane': [30, 43.5, 0],
      'under the balcony': [28, 21, 0],
    },
    build(b) {
      // ---------- ground areas ----------
      b.open(2, 17, 13, 31);        // attacker spawn courtyard (west)
      b.open(3, 3, 8, 17);          // north alley
      b.open(8, 3, 26, 8);          // gate passage → site
      b.open(26, 2, 44, 18);        // bomb site plaza
      b.open(52, 4, 62, 16);        // defender spawn (east)
      b.open(44, 7, 52, 13);        // defender lane → site
      b.open(18, 18, 46, 23);       // yard between site and depot
      b.open(18, 23, 38, 40);       // depot footprint (walls added below)
      b.open(13, 29.5, 18, 33);     // spawn → depot side door
      b.open(6, 31, 12, 45.5);      // spawn → south lane
      b.open(12, 41, 54, 45.5);     // south lane
      b.open(46, 16, 54, 45.5);     // east side street
      b.open(52, 13, 54, 16);

      // ---------- covered gate ----------
      b.roof(13, 3, 20, 8, 3.4);
      b.wall(13, 3, 13.5, 8, 3.4, 'pillar');
      b.cut(13, 4, 13.5, 7, 0, 3.4);
      b.wall(19.5, 3, 20, 8, 3.4, 'pillar');
      b.cut(19.5, 4, 20, 7, 0, 3.4);
      b.box(21, 3, 22, 4);
      b.barrel(9, 6.5);
      // staggered crates so the gate passage isn't one long sniping lane
      b.crate(22.5, 3, 24, 6);
      b.crate(15.5, 5, 17, 7);

      // ---------- depot: two storeys ----------
      // outer walls
      b.wall(18, 23, 38, 23.5, BH, 'building');
      b.wall(18, 39.5, 38, 40, BH, 'building');
      b.wall(18, 23, 18.5, 40, BH, 'building');
      b.wall(37.5, 23, 38, 40, BH, 'building');
      // ground-floor doors
      b.cut(18, 30, 18.5, 32.5, 0, 2.4);          // west door from attacker side
      b.cut(33, 23, 35.5, 23.5, 0, 2.4);          // north door to the yard
      b.cut(37.5, 33, 38, 35, 0, 2.4);            // east door
      b.open(38, 33, 46, 35);                     // east door → east street
      // ground-floor windows
      b.cut(22, 23, 24, 23.5, 1.1, 2.0);
      b.cut(18, 25, 18.5, 27, 1.1, 2.0);
      // upper floor (with a stairwell opening above the stairs)
      b.slab(18.5, 23.5, 37.5, 36.5, UP);
      b.slab(18.5, 36.5, 25.5, 39.5, UP);
      b.slab(31, 36.5, 37.5, 39.5, UP);
      b.stairs(25.5, 37, 31, 39.5, '+x', 0, UP);
      b.wall(25.5, 36.5, 31, 37, UP + 1.0, 'low', UP - 0.3);   // railing round the stairwell
      // pillars holding the floor up
      b.wall(23.5, 29.5, 24.5, 30.5, UP - 0.3, 'pillar');
      b.wall(31.5, 29.5, 32.5, 30.5, UP - 0.3, 'pillar');
      // ground-floor cover
      b.crate(20.5, 34, 22.5, 36);
      b.box(28, 26, 29.5, 27.5);
      b.barrel(35, 27);
      b.crate(27, 32, 28.5, 33.5);            // no clear view straight through both doors
      // upper-floor doors & windows
      b.cut(26, 23, 28.5, 23.5, UP, UP + 2.2);     // door out to the balcony
      b.cut(30.5, 23, 33, 23.5, UP + 1.0, UP + 2.0); // window over the yard
      b.cut(18, 27, 18.5, 29, UP + 1.0, UP + 2.0);   // window toward attacker spawn
      b.cut(37.5, 26, 38, 28.5, UP + 1.0, UP + 2.0); // window toward the east street
      b.box(33.5, 25, 35, 26.5);                     // upper-floor cover
      // balcony over the yard, with ground and cover underneath
      b.slab(22, 19.5, 31, 23, UP);
      b.wall(22, 19.5, 31, 20, UP + 1.0, 'low', UP - 0.3);
      b.wall(22, 19.5, 22.5, 23, UP + 1.0, 'low', UP - 0.3);
      b.wall(30.5, 19.5, 31, 23, UP + 1.0, 'low', UP - 0.3);
      b.wall(23.5, 21.5, 27, 22, 1.0, 'low');     // low wall under the balcony
      b.wall(22, 22.5, 22.5, 23, UP - 0.3, 'pillar');
      b.wall(30.5, 22.5, 31, 23, UP - 0.3, 'pillar');

      // ---------- yard / site edge ----------
      b.wall(26, 17.5, 32, 18.5, 3.0, 'wall');
      b.wall(38, 17.5, 40, 18.5, 3.0, 'wall');
      b.barrel(36, 20);
      b.barrel(19.5, 19);
      b.box(42, 20, 43.5, 21.5);

      // ---------- bomb site ----------
      b.site('A', 28, 3, 42, 16);
      b.truck(30, 7, 37.5, 9.5, '+x');
      b.barrel(29, 7.5);            // climb onto the truck bed from here
      b.box(27.5, 12.5, 29, 14);
      b.box(29, 12.5, 30.5, 14);
      b.box(29, 14, 30.5, 15.5);
      b.crate(40, 13, 41.5, 14.5);  // too tall to climb
      b.barrel(39, 4);
      b.barrel(33, 13.5);
      b.box(35, 3, 36.5, 4.5);
      b.roof(26, 2, 31, 4.5, 3.2);  // awning on the north wall
      b.wall(30.5, 4, 31, 4.5, 3.2, 'pillar');

      // ---------- defender side ----------
      b.roof(46, 7, 50, 13, 3.4);
      b.wall(46, 7, 46.5, 7.5, 3.4, 'pillar');
      b.wall(49.5, 12.5, 50, 13, 3.4, 'pillar');
      b.box(55, 5, 56.5, 6.5);
      b.box(60, 13, 61.5, 14.5);
      // watch platform on the east street, reached by stairs
      b.wall(47, 20, 53, 24, 2.4, 'platform');
      b.stairs(49.5, 24, 53, 29, '-z', 0, 2.4);
      b.wall(47, 20, 47.5, 24, 3.4, 'low', 2.4);
      b.barrel(47.5, 32);
      b.box(51.5, 38, 53, 39.5);
      b.crate(52.5, 34, 54, 35.5);            // east street: block the slots beside the platform
      b.crate(46, 36, 47.5, 37.5);

      // ---------- attacker side ----------
      b.wall(3, 12, 6, 12.5, 3.0, 'wall');   // north alley: a wall stub and a crate break up the long view
      b.crate(6, 9, 8, 10.5);
      b.crate(24, 43.5, 25.5, 45.5);          // south lane cover
      b.crate(32, 42.5, 33.5, 43.5);
      b.box(9, 19, 10.5, 20.5);
      b.box(3, 27, 4.5, 28.5);
      b.box(14, 42, 15.5, 43.5);
      b.barrel(30, 42);
      b.crate(40, 41.5, 41.5, 43);

      // ---------- spawns ----------
      b.spawn('atk', 5, 21, EAST);
      b.spawn('atk', 5, 25, EAST);
      b.spawn('atk', 8, 23, EAST);
      b.spawn('def', 59, 8, WEST);
      b.spawn('def', 59, 11, WEST);
      b.spawn('def', 56.5, 9.5, WEST);
      // deathmatch with 3 players
      b.spawn('dm', 5, 10, SOUTH);
      b.spawn('dm', 25.5, 7, EAST);
      b.spawn('dm', 58, 14, WEST);
      b.spawn('dm', 34, 34, NORTH);
      b.spawn('dm', 9, 43, EAST);
      b.spawn('dm', 50, 42, NORTH);
      b.spawn('dm', 43, 15, WEST);
    },
  },
  // ======================================================================
  foundry: {
    name: 'Foundry',
    description: 'Wingman. An old steel works: the bomb site is inside the main hall, ringed by catwalks you can reach from outside.',
    theme: 'industrial',
    size: [64, 52],
    massHeight: 9,
    checkPoints: {
      'north catwalk': [34, 5, 3.2],
      'west catwalk': [24, 16, 3.2],
      'outside stair landing': [21, 19.5, 3.2],
      'loading yard': [30, 32, 0],
      'east corridor': [49, 15, 0],
    },
    build(b) {
      const H = 8, CW = 3.2;   // hall wall height, catwalk height
      // ---------- ground areas ----------
      b.open(2, 18, 14, 36);       // attacker yard (west)
      b.open(4, 4, 10, 18);        // north alley
      b.open(10, 4, 22, 9);        // alley → hall north-west door
      b.open(14, 14, 22, 22);      // west court with the outside stairs
      b.open(10, 14, 14, 18);      // west court → north alley / attacker yard
      b.open(14, 25, 50, 36);      // loading yard (south)
      b.open(22, 3, 46, 25);       // main hall
      b.open(46, 12, 52, 18);      // hall east door → defenders
      b.open(50, 3, 62, 18);       // defender spawn (east)
      b.open(48, 18, 54, 36);      // east street

      // ---------- main hall ----------
      b.wall(22, 3, 46, 3.5, H, 'building');
      b.wall(22, 24.5, 46, 25, H, 'building');
      b.wall(22, 3, 22.5, 25, H, 'building');
      b.wall(45.5, 3, 46, 25, H, 'building');
      b.cut(22, 5, 22.5, 8, 0, 2.6);          // north-west door
      b.cut(31, 24.5, 36, 25, 0, 3.4);        // big south loading door
      b.cut(24, 24.5, 26, 25, 0, 2.4);        // small south door
      b.cut(45.5, 13, 46, 16, 0, 2.6);        // east door
      b.cut(22, 18, 22.5, 20.5, CW, CW + 2.3); // catwalk door to the outside stairs
      b.cut(38, 24.5, 41, 25, 1.2, 2.2);      // window onto the loading yard
      // roof with a long skylight over the site
      b.roof(22.5, 3.5, 45.5, 9.5, 7.6);
      b.roof(22.5, 18.5, 45.5, 24.5, 7.6);
      // catwalks along the north and west walls
      b.slab(22.5, 3.5, 45.5, 6.5, CW);
      b.slab(22.5, 6.5, 25.5, 24.5, CW);
      b.wall(26, 6.5, 42, 7, CW + 1.0, 'low', CW - 0.3);       // railings
      b.wall(25.5, 7, 26, 24.5, CW + 1.0, 'low', CW - 0.3);
      b.stairs(42, 6.5, 45.5, 12, '-z', 0, CW);                // stairs up to the north catwalk
      b.wall(25, 12, 25.5, 12.5, CW - 0.3, 'pillar');          // catwalk supports
      b.wall(25, 20, 25.5, 20.5, CW - 0.3, 'pillar');
      // site cover: furnace in the middle, crates and boxes
      b.site('A', 27, 8, 44, 23);
      b.wall(33, 13, 36, 16, 4.2, 'machine');
      b.box(30, 10, 31.5, 11.5);
      b.box(31.5, 10, 33, 11.5);
      b.box(31.5, 8.5, 33, 10);
      b.crate(39, 9, 40.5, 10.5);
      b.crate(38, 18.5, 40, 20.5);
      b.box(28, 17, 29.5, 18.5);
      b.barrel(41, 15.5);
      b.box(42.5, 20, 44, 21.5);
      b.box(30, 21.5, 31.5, 23);
      b.crate(28, 8.5, 29.5, 10);
      b.crate(35, 4, 37, 6);                                   // catwalk cover
      b.box(24, 9, 25.5, 10.5);

      // ---------- outside stairs to the catwalk ----------
      b.stairs(14.5, 18, 20, 20.5, '+x', 0, CW);
      b.wall(20, 18, 22, 20.5, CW, 'platform');
      b.box(15, 14.5, 16.5, 16);

      // ---------- loading yard ----------
      b.truck(16, 29, 23.5, 31.5, '+x');
      b.barrel(15, 26);
      b.crate(26, 30, 28, 34);         // containers
      b.crate(37, 27, 39, 31);
      b.box(31, 33, 32.5, 34.5);
      b.box(32.5, 33, 34, 34.5);
      b.box(43, 27, 44.5, 28.5);
      b.barrel(46, 33);
      b.wall(18, 25, 21, 26, 1.0, 'low');
      b.crate(29, 25, 30.5, 27.5);       // break up the long views across the yard
      b.crate(40, 33.5, 41.5, 36);
      b.crate(44, 32.5, 45.5, 34);

      // ---------- defender side ----------
      b.box(55, 5, 56.5, 6.5);
      b.box(52, 16, 53.5, 17.5);
      b.crate(49, 22, 51, 24);
      b.barrel(52.5, 30);

      // ---------- attacker side ----------
      b.box(10, 21, 11.5, 22.5);
      b.box(3, 33, 4.5, 34.5);
      b.barrel(8, 6);
      b.box(16, 5, 17.5, 6.5);

      b.spawn('atk', 5, 24, EAST);
      b.spawn('atk', 5, 29, EAST);
      b.spawn('atk', 8, 26.5, EAST);
      b.spawn('def', 59, 7, WEST);
      b.spawn('def', 59, 11, WEST);
      b.spawn('def', 56, 9, WEST);
      b.spawn('dm', 7, 8, SOUTH);
      b.spawn('dm', 41, 32, WEST);
      b.spawn('dm', 59, 15, WEST);
      b.spawn('dm', 28, 13, EAST);
      b.spawn('dm', 6, 33, NORTH);
      b.spawn('dm', 51, 33, NORTH);
      b.spawn('dm', 18.5, 16, SOUTH);
    },
  },

  // ======================================================================
  frostline: {
    name: 'Frostline',
    description: 'Wingman. A snowed-in research station: the site is the courtyard between the lab and the hangar, watched from the lab’s upper floor.',
    theme: 'snow',
    size: [60, 56],
    massHeight: 8,
    checkPoints: {
      'lab upper floor': [30, 29, 3.6],
      'lab balcony': [30, 23, 3.6],
      'west trail': [8, 32, 0],
      'east trail': [50, 32, 0],
      'hangar apron': [30, 5, 0],
    },
    build(b) {
      const UPF = 3.6;
      // ---------- ground areas ----------
      b.open(18, 46, 42, 54);      // attacker spawn (south)
      b.open(4, 14, 12, 50);       // west trail
      b.open(12, 46, 18, 50);
      b.open(46, 14, 54, 50);      // east trail
      b.open(42, 46, 46, 50);
      b.open(14, 10, 46, 24);      // courtyard (bomb site)
      b.open(12, 15, 14, 20);      // west trail → courtyard
      b.open(18, 2, 42, 10);       // hangar apron (defenders)
      b.open(42, 2, 56, 10);
      b.open(46, 10, 54, 14);      // apron → east trail
      b.open(20, 26, 40, 40);      // lab
      b.open(26, 24, 34, 26);      // lab → courtyard passage
      b.open(28, 40, 32, 46);      // spawn → lab
      b.open(12, 31, 20, 33.5);    // west trail → lab side door
      b.open(40, 34, 46, 36.5);    // lab east door → east trail

      // fence between the apron and the courtyard, with two gaps
      b.wall(14, 9.5, 46, 10, 2.6, 'fence');
      b.cut(19, 9.5, 23, 10, 0, 2.6);
      b.cut(37, 9.5, 41, 10, 0, 2.6);

      // ---------- lab (two floors) ----------
      b.wall(20, 26, 40, 26.5, 7.2, 'building');
      b.wall(20, 39.5, 40, 40, 7.2, 'building');
      b.wall(20, 26, 20.5, 40, 7.2, 'building');
      b.wall(39.5, 26, 40, 40, 7.2, 'building');
      b.cut(28, 26, 32, 26.5, 0, 2.4);         // north door
      b.cut(28, 39.5, 32, 40, 0, 2.4);         // south door
      b.cut(20, 31, 20.5, 33.5, 0, 2.4);       // west door
      b.cut(39.5, 34, 40, 36.5, 0, 2.4);       // east door
      b.slab(20.5, 26.5, 39.5, 33, UPF);       // upper floor
      b.slab(20.5, 33, 22, 39.5, UPF);         // landing
      b.stairs(22, 36.5, 27.5, 39.5, '-x', 0, UPF);
      b.wall(22, 33, 39.5, 33.5, UPF + 1.0, 'low', UPF - 0.3);   // railing
      b.cut(24, 26, 27, 26.5, UPF + 0.9, UPF + 2.0);   // windows over the courtyard
      b.cut(33, 26, 36, 26.5, UPF + 0.9, UPF + 2.0);
      b.cut(29, 26, 31, 26.5, UPF, UPF + 2.2);         // balcony door
      b.slab(26, 22, 34, 26, UPF);                     // balcony over the passage
      b.wall(26, 22, 34, 22.5, UPF + 1.0, 'low', UPF - 0.3);
      b.wall(26, 22.5, 26.5, 26, UPF + 1.0, 'low', UPF - 0.3);
      b.wall(33.5, 22.5, 34, 26, UPF + 1.0, 'low', UPF - 0.3);
      b.wall(26, 25.5, 26.5, 26, UPF - 0.3, 'pillar');
      b.wall(33.5, 25.5, 34, 26, UPF - 0.3, 'pillar');
      // inside cover
      b.crate(23, 28, 25, 30);
      b.box(35, 29, 36.5, 30.5);
      b.box(31, 35, 32.5, 36.5);
      b.box(36, 36.5, 37.5, 38);
      b.wall(29, 30, 31, 31, UPF - 0.3, 'pillar');
      b.box(36, 27.5, 37.5, 29);        // upstairs cover
      b.crate(29, 33, 30.5, 34.5);      // no clear view straight through both lab doors

      // ---------- courtyard / site ----------
      b.site('A', 17, 11, 43, 22);
      b.wall(28, 14, 32, 17, 2.4, 'machine');     // generator
      b.crate(19, 12, 21, 14);
      b.box(21, 12, 22.5, 13.5);
      b.box(38, 18.5, 39.5, 20);
      b.box(39.5, 18.5, 41, 20);
      b.crate(39.5, 17, 41, 18.5);
      b.crate(23, 19, 25, 21);
      b.barrel(35, 12);
      b.barrel(42, 13);
      b.wall(15, 21, 18, 22, 1.0, 'low');         // snow bank
      b.crate(34, 18.5, 35.5, 20.5);
      b.crate(26, 10.5, 27.5, 12);

      // ---------- apron / defenders ----------
      b.crate(46, 4, 49, 6);
      b.box(22.5, 3, 24, 4.5);
      b.box(52, 11, 53.5, 12.5);
      b.barrel(19, 3);

      // ---------- trails ----------
      b.box(7, 24, 8.5, 25.5);
      b.crate(4.5, 38, 6.5, 40);
      b.wall(9, 44, 12, 45, 1.0, 'low');
      b.box(49, 22, 50.5, 23.5);
      b.crate(51.5, 40, 53.5, 42);
      b.barrel(47, 30);
      // staggered cover down both trails so neither is one long sniping lane
      b.crate(46, 27, 48, 28.5);
      b.crate(50.5, 21, 54, 22.5);
      b.crate(48, 33, 50.5, 35);
      b.crate(4, 21, 7.5, 22.5);
      b.crate(10, 27, 12, 28.5);
      b.crate(6.5, 33, 10, 35);
      // spawn
      b.box(21, 47, 22.5, 48.5);
      b.box(38, 51, 39.5, 52.5);
      b.crate(24, 46.5, 25.5, 48);
      b.crate(35, 48.5, 36.5, 50);

      b.spawn('atk', 26, 50, NORTH);
      b.spawn('atk', 30, 51, NORTH);
      b.spawn('atk', 34, 50, NORTH);
      b.spawn('def', 26, 5, SOUTH);
      b.spawn('def', 30, 4, SOUTH);
      b.spawn('def', 34, 5, SOUTH);
      b.spawn('dm', 8, 42, NORTH);
      b.spawn('dm', 50, 44, NORTH);
      b.spawn('dm', 33, 37, WEST);
      b.spawn('dm', 30, 5, SOUTH);
      b.spawn('dm', 8, 17, SOUTH);
      b.spawn('dm', 52, 17, SOUTH);
      b.spawn('dm', 36, 31, WEST);
    },
  },

  // ======================================================================
  canal: {
    name: 'Canal',
    description: 'Wingman. A sunny hill village of stone and plaster houses split by a narrow canal. The site is the church piazza under the bell tower. Cross by the north bridge and the gate arch, through the inn and a quick wade under the archway, or by the long south street and its bridge.',
    theme: 'village',
    size: [64, 48],
    massHeight: 8,
    // every block of houses not built by hand below gets its own height, colour and roof
    village: { hMin: 5.5, hMax: 10, palette: ['#e6c9a0', '#dcae7a', '#d39b6a', '#e8d6b8', '#c98a5e', '#e3b98c', '#cf9f7a', '#efe3cc', '#d8b48a', '#e9cfa8'] },
    checkPoints: {
      'inn upper floor': [16, 15, 3.6],
      'west landing': [27, 22, 0.4],
      'canal (wading)': [30, 22, 0],
      'east landing': [33.5, 22, 0.4],
      'archway': [36.5, 22, 0],
      'gate arch': [40, 9.5, 0],
      'north bridge': [30, 5, 1.1],
      'south bridge': [30, 41, 1.1],
      'piazza': [45, 18, 0],
    },
    build(b) {
      const UPF = 3.6;
      // ---------- landmark buildings (the rest of the village is filled in automatically) ----------
      b.house(42, 0, 52, 11, { h: 11.5, mat: 'stone', color: '#dccaa6', roof: 'gable-z', kind: 'church', quoins: false, balcony: false, plants: false, chimney: false, shutters: null });
      b.house(52, 0, 56, 6, { h: 19, mat: 'stone', color: '#dccaa6', roof: 'tower', kind: 'tower', quoins: false, balcony: false, plants: false, chimney: false, shutters: null });
      b.house(12, 12, 26, 31, { h: 7.6, mat: 'stucco', color: '#dba564', roof: 'hip', kind: 'inn', quoins: true, shutters: '#4f6b45', balcony: false, plants: true, chimney: true });
      b.house(26, 0, 34, 3, { h: 7, color: '#e3c49a', roof: 'gable-x' });          // houses over the ends of the canal
      b.house(26, 43, 34, 48, { h: 7.5, color: '#d9a77a', roof: 'gable-x' });
      b.house(36, 8, 42, 11, { h: 8.5, color: '#e8d6b8', roof: 'gable-x', quoins: true, balcony: false });   // the gate arch
      b.house(35, 19, 38, 25, { h: 8, color: '#cf9f7a', roof: 'gable-z', balcony: false });    // the archway by the canal

      // ---------- streets and squares ----------
      b.open(2, 18, 12, 31);        // attacker spawn (west)
      b.open(4, 3, 9, 18);          // north alley
      b.open(9, 3, 26, 8);          // north street
      b.open(26, 3, 34, 8);         // north bridge
      b.open(34, 3, 42, 8);         // north street, east of the canal: ends at the church
      b.open(38, 11, 52, 25);       // church piazza (bomb site)
      b.open(18, 8, 21, 12);        // north street → inn
      b.open(4, 31, 9, 38);         // south alley
      b.open(4, 38, 26, 43);        // south street
      b.open(26, 38, 34, 43);       // south bridge
      b.open(34, 38, 60, 44);       // south street, east of the canal
      b.open(44, 25, 48, 38);       // south street → piazza
      b.open(52, 12, 55, 18.5);     // defender lane → piazza
      b.open(55, 6, 62, 28);        // defender spawn (east)
      b.open(55, 28, 60, 38);       // defender spawn → south street

      // ---------- the canal: shallow water between the houses, two bridges and a crossing ----------
      b.open(28, 8, 32, 38);
      b.water(28, 8, 32, 38);
      b.open(26, 19, 28, 25); b.wall(26, 19, 28, 25, 0.4, 'quay');   // stone landings either side
      b.open(32, 19, 35, 25); b.wall(32, 19, 35, 25, 0.4, 'quay');
      // humped bridges with a stone parapet over the water (the parapet is the '_rail')
      b.stairs(26, 3, 28, 8, '+x', 0, 1.1, 'bridge'); b.wall(28, 3, 32, 7.5, 1.1, 'bridge'); b.stairs(32, 3, 34, 8, '-x', 0, 1.1, 'bridge');
      b.wall(28, 7.5, 32, 8, 2.0, '_rail');
      b.deco('canalbridge', 28, 32, 8, 1, 1.1);
      b.stairs(26, 38, 28, 43, '+x', 0, 1.1, 'bridge'); b.wall(28, 38.5, 32, 43, 1.1, 'bridge'); b.stairs(32, 38, 34, 43, '-x', 0, 1.1, 'bridge');
      b.wall(28, 38, 32, 38.5, 2.0, '_rail');
      b.deco('canalbridge', 28, 32, 38, -1, 1.1);

      // ---------- arches ----------
      b.cut(38, 8, 42, 11, 0, 3.6);           // gate arch from the north street into the piazza
      b.deco('arch', 38, 8, 42, 11, 3.6, 'z', 2.0);
      b.cut(35, 19.5, 38, 24.5, 0, 3.4);      // archway from the east landing into the piazza
      b.deco('arch', 35, 19.5, 38, 24.5, 3.4, 'x', 1.3);

      // ---------- the inn: two floors, a door at each end and a window over the canal ----------
      b.open(12.5, 12.5, 25.5, 30.5);
      b.deco('paving', 12.5, 12.5, 25.5, 30.5, 'tiles');
      b.roof(12.5, 12.5, 25.5, 30.5, 7.0, 'beams');            // ceiling
      b.slab(12.5, 12.5, 25.5, 22.5, UPF);                     // upper floor
      b.stairs(13, 22.5, 15.5, 28.5, '-z', 0, UPF);
      b.wall(15.5, 22.5, 25.5, 23, UPF + 1.0, 'low', UPF - 0.3);   // railing
      b.wall(19, 17, 19.5, 17.5, UPF - 0.3, 'pillar');
      b.cut(12, 21.5, 12.5, 24, 0, 2.5);         // front door from the attacker spawn
      b.cut(18.5, 12, 20.5, 12.5, 0, 2.5);       // side door to the north street
      b.cut(25.5, 20.75, 26, 23, 0, 2.6);        // back door onto the canal landing
      b.cut(25.5, 19.5, 26, 22.5, UPF + 0.9, UPF + 2.0);   // upstairs window over the canal
      b.cut(12, 27, 12.5, 29, 1.1, 2.1);         // window to the spawn
      b.crate(19, 20.25, 20.5, 23.25);            // no straight view through both doors
      b.crate(21, 14, 22.5, 15.5);
      b.box(17, 26, 18.5, 27.5);
      b.barrel(23.5, 28.5);
      b.box(23, 13.5, 24.5, 15);                  // upstairs

      // ---------- church piazza (bomb site) ----------
      b.site('A', 38, 11, 52, 25);
      b.deco('paving', 38, 11, 52, 25);
      b.wall(44, 11, 50, 12, 0.3, 'steps');      // church steps
      b.cart(40, 14, 43, 15.5, '-x');
      b.crate(46, 15, 48, 17);
      b.box(48, 15.5, 49.5, 17);
      b.wall(40, 19.5, 42, 20.5, 1.0, 'low');     // stone planter
      b.crate(42, 19.25, 44, 20.75);              // blocks the long view from the archway to the defender lane
      b.well(46, 21, 47.5, 22.5);
      b.box(48.5, 22.5, 50, 24);
      b.barrel(39, 23.3);                         // by the archway
      b.box(50, 13.5, 51.5, 15);

      // ---------- streets ----------
      // two houses jut into the south street so it isn't one long straight lane
      b.house(13, 40.5, 17, 43, { h: 6.5, roof: 'gable-x', balcony: false });
      b.house(49, 38, 53, 40.5, { h: 7, roof: 'gable-x', balcony: false });
      b.crate(6, 9, 8, 10.5);                     // north alley
      b.crate(14, 3, 15.5, 5);                    // north street: staggered cover
      b.crate(10, 5.8, 11.5, 7.3);
      b.cart(20, 6.2, 23, 7.8, '+x');
      b.barrel(24.5, 3.2);
      b.box(40, 3, 41.5, 4.5);                    // by the church wall
      b.crate(36.5, 6, 38, 7.5);                  // cover before turning into the gate
      b.barrel(36, 3.2);
      b.box(9, 19, 10.5, 20.5);                   // attacker spawn
      b.barrel(3, 28);
      b.crate(6.5, 27.5, 8, 29);
      b.crate(4, 34.5, 5.5, 36);                  // south alley
      b.crate(7.5, 32, 9, 33.5);
      b.barrel(6, 41);                            // south street
      b.cart(19, 38.3, 22, 39.9, '+x');
      b.box(24, 41.5, 25.5, 43);
      b.crate(23.5, 38.8, 25, 40.3);
      b.crate(38, 41.5, 39.5, 43.5);              // south street, east
      b.crate(42, 40, 43.5, 41.5);
      b.box(55, 41, 56.5, 42.5);
      b.barrel(55.5, 38);
      b.box(46.5, 30, 48, 31.5);                  // south street → piazza
      b.box(55, 7, 56.5, 8.5);                    // defender spawn
      b.crate(57, 25.5, 58.5, 27);
      b.crate(55, 31, 56.5, 32.5);                // defender lane south: staggered
      b.crate(58.5, 34, 60, 35.5);

      // ---------- spawns ----------
      b.spawn('atk', 5, 21, EAST);
      b.spawn('atk', 5, 25, EAST);
      b.spawn('atk', 8, 23, EAST);
      b.spawn('def', 59, 10, WEST);
      b.spawn('def', 59, 14, WEST);
      b.spawn('def', 57, 12, WEST);
      b.spawn('dm', 6, 6, SOUTH);
      b.spawn('dm', 18, 5.5, EAST);
      b.spawn('dm', 37, 5.5, EAST);
      b.spawn('dm', 49, 19, WEST);
      b.spawn('dm', 58, 24, NORTH);
      b.spawn('dm', 52, 41, WEST);
      b.spawn('dm', 10, 41, EAST);
      b.spawn('dm', 21, 27, NORTH);
    },
  },

  // Built from the owner's own drawn plan (1 drawing pixel = 12.5 cm, wobbly lines straightened).
  // Shapes only for now (beta): a two-storey building with three staircases and an upstairs
  // corridor to a balcony over a small truck, a site boxed in by an L-shaped block, roofed passages.
  flame: {
    name: 'Flame (beta)',
    description: 'Wingman. Beta layout from your plan: the site sits in the corner of an L-shaped block. Go round by the north street, down the middle corridor to the truck yard, or up through the two-storey building and out onto the balcony over the truck (barrel → truck → cab roof → balcony also works).',
    theme: 'tuscan',
    size: [62, 62],
    massHeight: 8,
    // sun-faded orange and ochre plaster, grey stone; pale terracotta roofs; green and brown shutters
    village: {
      hMin: 5.5, hMax: 9,
      palette: ['#e39a50', '#e8b65e', '#e5a85c', '#e9c77a', '#d98e4a', '#e4b26e', '#cd8a55', '#e7bd6c'],
      stone: ['#d3ccc0', '#cbc4b8', '#d9d2c6'],
      roofs: ['#cf9064', '#c9855a', '#d69a6e', '#c27c52', '#d38c60'],
      shutters: ['#6f9a52', '#7a5a3e', '#6a8f4c', '#8a6446', '#5f7a4a'],
    },
    checkPoints: {
      'upstairs corridor': [30, 49.2, 3.2],
      'west balcony': [14.7, 41.5, 3.2],
      'balcony over the truck': [46, 49, 3.2],
      'under the balcony': [46, 50, 0],
      'roofed hall': [55, 4, 0],
      'roofed passage': [38, 3, 0],
      'east stair landing': [54.7, 36.5, 1.4],
      'bottom-left room': [13.5, 58, 0],
      'yard behind the wall stub': [56.5, 45, 0],
    },
    build(b) {
      const H = 3.2;          // upstairs floor (and both balconies)
      const C = H + 2.8;      // upstairs ceiling
      // ---------- buildings drawn in black (solid, out of bounds) placed by hand ----------
      b.house(16, 30, 24.5, 59.5, { h: 6.8, roof: 'gable-z', balcony: false });              // the two-storey building
      b.house(24.5, 44, 44, 51, { h: 6.8, roof: 'gable-x', balcony: false });                // its wing along the truck yard
      b.house(30.5, 15.5, 37.5, 37, { h: 7.5, mat: 'stone', roof: 'gable-z', balcony: false }); // L-shaped block round the site
      b.house(37.5, 15.5, 47, 20, { h: 7, roof: 'gable-x', balcony: false });
      b.house(39.5, 20, 47, 22.5, { h: 7, mat: 'stone', roof: 'gable-x', balcony: false, plain: true, quoins: false });   // the cantina

      // ---------- ground the players walk on ----------
      b.open(1, 24, 5, 30);           // attacker spawn (west), its top-left corner set back
      b.open(5, 22.5, 16.5, 30);
      b.open(16.5, 25.5, 24.5, 30);   // spawn → middle corridor
      b.open(9.5, 30, 16, 48.5);      // west corridor, past the building
      b.open(13, 48.5, 16, 52);
      b.open(11.5, 52, 16, 60.5);     // bottom-left room (the south stairs come out here)
      b.open(23.5, 9, 26, 11);        // roofed corner at the west end of the north street
      b.open(26, 9, 53, 15.5);        // north street
      b.open(36, 1, 40, 9);           // roofed passage off the north street
      b.open(26, 15.5, 30.5, 19.5);   // middle corridor, from the north street down to the truck yard
      b.open(23.5, 19.5, 30.5, 22);
      b.open(24.5, 22, 30.5, 44);
      b.open(47, 15.5, 53.5, 44);     // defender side: spawn and the lane down the east of the site
      b.open(53.5, 16, 56, 18);       //   little bay by the defender spawn
      b.open(53, 11.5, 54, 13.5);     //   doorway into the roofed hall
      b.open(49.5, 1, 58, 7.5);       // roofed hall
      b.open(54, 7.5, 60, 15);
      b.open(37.5, 20, 39.5, 22.5);   // bomb site (in the corner of the L-shaped block)
      b.open(37.5, 22.5, 47, 37);
      b.open(30.5, 37, 53.5, 44);     // truck yard south of the site
      b.open(53.5, 31, 55.5, 37.5);   // bay with stairs on the east wall
      b.open(53, 40, 59, 44);         // south-east yard, round the wall stub
      b.open(44, 44, 59, 50.5);
      b.open(44, 50.5, 55.5, 54.5);
      for (let x = 55.5; x < 59; x += 0.5) b.open(x, 50.5, x + 0.5, 54.5 - (x + 0.5 - 55.5) * 8 / 7);   // the cut-off corner

      // ---------- roofs over the orange areas ----------
      b.roof(23.5, 9, 26, 11, 3.0);
      b.roof(36, 1, 40, 9, 3.4);
      b.roof(49.5, 1, 58, 7.5, 3.6);
      b.roof(54, 7.5, 60, 15, 3.6);
      b.roof(24.5, 39.5, 29, 44, 3.0);                 // awning at the bottom of the middle corridor…
      b.wall(28.5, 39.5, 29, 40, 3.0, 'pillar');       // …on a post

      // ---------- the two-storey building: upstairs rooms and corridor (grey) ----------
      b.cut(16.5, 40, 21, 46, H, C);                   // upstairs room
      b.cut(21, 39.5, 24, 50.5, H, C);                 // north–south corridor
      b.cut(19.5, 48, 38, 50.5, H, C);                 // long corridor east through the wing
      b.cut(38, 44.5, 41, 50.5, H, C);
      b.cut(41, 44.5, 44, 47, H, C);                   // out onto the balcony over the truck
      // east stairs: in from the middle corridor under a little roof, up to the corridor
      b.cut(21, 32, 24, 39.5, 0, C);
      b.cut(24, 32, 24.5, 34, 0, 2.6);                 // doorway
      b.stairs(21, 34, 24, 39.5, '+z', 0, H);
      // south stairs: down from the corridor to a half landing, then out into the bottom-left room
      b.cut(21.5, 50.5, 24, 56.5, 0, C);
      b.stairs(21.5, 50.5, 24, 56.5, '-z', H / 2, H);
      b.cut(16, 56.5, 24, 59, 0, C);
      b.wall(19.5, 56.5, 24, 59, H / 2, 'stairs');     // half landing
      b.stairs(16.5, 56.5, 19.5, 59, '+x', 0, H / 2);
      // west stairs: up from the west corridor to a landing and the west balcony, into the upstairs room
      b.stairs(13.5, 32, 16, 37, '+z', 0, H);
      b.wall(13.5, 37, 16, 39.5, H, 'stairs');         // landing
      b.slab(13.5, 39.5, 16, 43.5, H);                 // west balcony (open underneath)
      b.wall(13.5, 37, 14, 43.5, H + 1.0, '_rail', H);   // railings (iron bars drawn by the dressing)
      b.wall(14, 43, 16, 43.5, H + 1.0, '_rail', H);
      b.deco('railing', 13.5, 37, 13.6, 43.5, H); b.deco('railing', 13.5, 43.4, 16, 43.5, H);
      b.deco('corbels', 13.4, 39.5, 13.6, 43.5, H);
      b.deco('stairarch', 13.5, 35.8, 0.9, -1);       // dark arch under the stone stairs
      b.cut(16, 40.5, 16.5, 43, H, H + 2.4);           // door from the balcony into the room

      // ---------- balcony over the truck (dark blue), open underneath with a low wall (pink) ----------
      b.wall(47.5, 44, 48, 45, H - 0.3, 'pillar');     // supports / walls under it (way in from the east between them)
      b.wall(47.5, 48, 48, 52.5, H - 0.3, 'wall');
      b.wall(44, 52, 47.5, 52.5, H - 0.3, 'wall');
      b.slab(44, 44.5, 48, 52.5, H);
      b.wall(47.5, 45, 48, 52.5, H + 1.0, '_rail', H);   // railing on the east side…
      b.wall(44, 52, 47.5, 52.5, H + 1.0, '_rail', H);   // …and the south side; the north edge is left open for the truck jump
      b.deco('railing', 47.9, 45, 48, 52.5, H); b.deco('railing', 44, 52.4, 48, 52.5, H);
      b.deco('corbels', 44, 44.4, 48, 44.6, H);         // stone brackets along the edge over the truck
      b.wall(44.5, 45.5, 47.5, 46.5, 1.0, 'low');      // small wall on the ground under it
      b.wall(44, 47, 44.5, 47.5, 0.35, '_bucket'); b.deco('bucket', 44.25, 47.25, 'bucket');
      b.wall(44, 47.5, 44.5, 48, 0.35, '_bucket'); b.deco('bucket', 44.25, 47.75, 'can');

      // ---------- truck (yellow) and the barrel to climb it ----------
      b.prop('truck', 39.5, 41.5, 47.5, 44, 2.4, { facing: '+x', bed: 1.3 });   // small van: bed 1.3 m, cab roof 2.4 m
      b.barrel(42.8, 40.5);

      // ---------- east bay stairs (blue) up to a small landing ----------
      b.stairs(53.5, 31.5, 55.5, 35.5, '+z', 0, 1.4);
      b.wall(53.5, 35.5, 55.5, 37.5, 1.4, 'stairs');

      // ---------- wall stub in the south-east yard ----------
      b.wall(53.5, 42, 54, 48.5, 3.2, 'wall');

      // ---------- boxes (brown) and barrels (red) ----------
      b.crate(42.5, 23, 45, 25.5);                     // site
      b.box(37.5, 25, 39.5, 27.5);
      b.box(41, 30, 43, 32.5);
      // (the small solid block beside it, 39.5–40.5 × 29.5–30.5, is the middle pillar of the arcade below)
      b.crate(44, 34, 46, 36);
      b.crate(37.5, 34.5, 39.5, 36.5);
      // ---------- roofed arcade along the west side of the site, against the stone block ----------
      // from the cellar to the street: square pillars at x 39.5–40.5 (the middle one where the small block was),
      // two wide arches facing the site, a smaller arch at the north end, a tall wall on the street, one roof over it all
      b.wall(39.5, 23, 40.5, 24, 5.7, '_stone');                    // north pillar
      b.wall(39.5, 29.5, 40.5, 30.5, 5.7, '_stone');                // middle pillar
      b.wall(39.5, 36, 40.5, 36.5, 5.7, '_stone');                  // south pillar, against the end wall
      b.wall(39.5, 24, 40.5, 29.5, 5.7, '_stone', 3.6);             // stone above the two big arches
      b.wall(39.5, 30.5, 40.5, 36, 5.7, '_stone', 3.6);
      b.wall(37.5, 23, 39.5, 23.5, 6.7, '_stone', 3.3);             // stone above the north end arch
      b.wall(37.5, 36.5, 40.5, 37, 6.7, '_stone');                  // tall wall on the street
      b.roof(37.5, 23, 40.5, 37, 5.6, '_roof');
      b.barrel(42.5, 34);
      b.barrel(33, 37.2);                              // truck yard, below the L-shaped block
      b.barrel(52.2, 23); b.barrel(52.2, 24.1);        // defender lane
      b.barrel(52.4, 47.6); b.barrel(52.5, 48.8);      // by the wall stub

      // ---------- site and spawns ----------
      b.site('A', 37.5, 20.5, 47.5, 37);
      // ---------- look (visual, apart from the arcade's stone and the pot) ----------
      b.deco('paving', 37.5, 22.5, 47, 37, 'terracotta');          // brick paving on the site, with a stone kerb
      b.deco('paving', 37.5, 20, 39.5, 22.5, 'terracotta');
      b.deco('curb', 40.5, 36.85, 47.15, 37.1); b.deco('curb', 46.9, 22.5, 47.15, 37.1);
      // our own wine cellar on the site's back wall: a stone arcade built 0.5 m out (its piers and the stone above the
      // arches are solid; the two doorways are shallow recesses)
      b.deco('shopfront', 39.5, 47, 22.5, 1, 'CANTINA FIAMMA', 0.5, 'east');   // (the arcade's north pillar stands against its west end)
      for (const x of [39.5, 43, 46.5]) b.wall(x, 22.5, x + 0.5, 23, 2.2, '_stone');
      b.wall(39.5, 22.5, 47, 23, 5.2, '_stone', 2.2);
      b.wall(37.5, 20, 38, 20.5, 0.6, '_pot'); b.deco('pot', 37.75, 20.25);
      b.deco('ivy', 39.95, 37, 0, 0.9, 4.2);                         // ivy up the arcade's street wall
      b.deco('ivy', 38.6, 20, 0, 1.8, 4.6);
      b.deco('arcade', 37.5, 23, 40.5, 37, [[23, 24], [29.5, 30.5], [36, 36.5]]);
      b.deco('painta', 40, 2.6, 15.45, Math.PI, 'left');            // painted site letters with arrows
      b.deco('painta', 34, 2.4, 43.95, Math.PI, 'left');
      b.deco('painta', 30.55, 2.4, 29, -Math.PI / 2, 'right');
      b.deco('gate', 36, 40, 1.15);                                 // iron gate at the end of the roofed passage
      b.spawn('atk', 6.2, 25.6, EAST);
      b.spawn('atk', 6.1, 28.2, EAST);
      b.spawn('atk', 9, 27, EAST);
      b.spawn('def', 51, 18, SOUTH);
      b.spawn('def', 51, 21, SOUTH);
      b.spawn('def', 49, 19.5, SOUTH);
      b.spawn('dm', 6, 26.5, EAST);
      b.spawn('dm', 33, 12, SOUTH);
      b.spawn('dm', 50.5, 19, SOUTH);
      b.spawn('dm', 56, 47, WEST);
      b.spawn('dm', 13.5, 57, NORTH);
      b.spawn('dm', 27.5, 33, NORTH);
      b.spawn('dm', 42, 28, EAST);
      b.spawn('dm', 55, 11, WEST);
    },
  },

  // ======================================================================
  // Deathmatch maps: `sizes` gives a small (2 players) and a large (4 players)
  // version; build(b, size) builds whichever was chosen when the match starts.
  quarry: {
    name: 'Quarry',
    description: 'Deathmatch. A stone quarry: a raised middle platform, four corner huts and low walls. The large version adds an outer ring road.',
    mode: 'dm',
    theme: 'quarry',
    sizes: { small: [36, 36], large: [56, 56] },
    size: [56, 56],
    massHeight: 9,
    checkPoints: { 'centre platform': [18, 18, 1.6] },
    largeCheckPoints: { 'centre platform': [28, 28, 1.6], 'lookout ledge': [4, 4, 1.6] },
    build(base, size) {
      const o = size === 'large' ? 10 : 0;
      const b = shifted(base, o, o);
      b.open(2, 2, 34, 34);
      // raised centre with stairs north and south
      b.wall(14, 14, 22, 22, 1.6, 'platform');
      b.stairs(15, 22, 21, 25, '-z', 0, 1.6);
      b.stairs(15, 11, 21, 14, '+z', 0, 1.6);
      b.box(14.5, 14.5, 16, 16);
      b.box(20, 20, 21.5, 21.5);
      // four corner huts, each with two doors
      const hut = (x0, z0, sx, sz) => {
        const x1 = x0 + 8 * sx, z1 = z0 + 8 * sz;
        const X0 = Math.min(x0, x1), X1 = Math.max(x0, x1), Z0 = Math.min(z0, z1), Z1 = Math.max(z0, z1);
        const wx = sx > 0 ? X1 - 0.5 : X0, wz = sz > 0 ? Z1 - 0.5 : Z0;
        b.wall(wx, Z0, wx + 0.5, Z1, 3.6, 'building');
        b.wall(X0, wz, X1, wz + 0.5, 3.6, 'building');
        b.cut(wx, Z0 + 2.5, wx + 0.5, Z0 + 5, 0, 2.4);
        b.cut(X0 + 2.5, wz, X0 + 5, wz + 0.5, 0, 2.4);
        b.roof(X0, Z0, X1, Z1, 3.6);
      };
      hut(2, 2, 1, 1); hut(34, 2, -1, 1); hut(2, 34, 1, -1); hut(34, 34, -1, -1);
      // cover between the huts and the centre
      b.wall(16, 5, 20, 6, 1.0, 'low');
      b.wall(16, 30, 20, 31, 1.0, 'low');
      b.wall(5, 16, 6, 20, 1.0, 'low');
      b.wall(30, 16, 31, 20, 1.0, 'low');
      b.crate(10, 15, 12, 17);
      b.crate(24, 19, 26, 21);
      b.box(12, 24, 13.5, 25.5);
      b.box(22.5, 10.5, 24, 12);
      b.barrel(7, 25);
      b.barrel(28, 10);
      b.box(26, 26, 27.5, 27.5);
      b.box(8.5, 8.5, 10, 10);
      for (const [x, z, yaw] of [[5, 5, -2.4], [31, 5, 2.4], [5, 31, -0.8], [31, 31, 0.8], [18, 4, SOUTH], [18, 32, NORTH], [4, 18, EAST], [32, 18, WEST]]) b.spawn('dm', x, z, yaw);
      if (size !== 'large') return;
      // ---------- large: outer ring road around the quarry ----------
      base.open(2, 2, 54, 8);
      base.open(2, 48, 54, 54);
      base.open(2, 2, 8, 54);
      base.open(48, 2, 54, 54);
      base.open(8, 26, 12, 30);   // ring → quarry gaps
      base.open(44, 26, 48, 30);
      base.open(26, 8, 30, 12);
      base.open(26, 44, 30, 48);
      // lookout ledges in two corners
      base.wall(2, 2, 6, 6, 1.6, 'platform');
      base.stairs(6, 2, 8, 6, '-x', 0, 1.6);
      base.wall(50, 50, 54, 54, 1.6, 'platform');
      base.stairs(48, 50, 50, 54, '+x', 0, 1.6);
      base.truck(14, 3, 21.5, 5.5, '+x');
      base.crate(40, 49, 42, 51);
      base.box(3, 14, 4.5, 15.5);
      base.box(51, 40, 52.5, 41.5);
      base.barrel(36, 4);
      base.barrel(18, 51);
      base.wall(49, 12, 50, 16, 1.0, 'low');
      base.wall(6, 40, 7, 44, 1.0, 'low');
      for (const [x, z, yaw] of [[5, 12, SOUTH], [51, 44, NORTH], [44, 5, WEST], [12, 51, EAST], [28, 5, SOUTH], [28, 51, NORTH], [5, 28, EAST], [51, 28, WEST]]) base.spawn('dm', x, z, yaw);
    },
  },

  railyard: {
    name: 'Railyard',
    description: 'Deathmatch. Rows of goods wagons (some you can walk through) and a signal tower. The large version adds the station platform and a goods shed.',
    mode: 'dm',
    theme: 'railyard',
    sizes: { small: [40, 32], large: [60, 52] },
    size: [60, 52],
    massHeight: 9,
    checkPoints: { 'signal tower': [19.5, 14, 3.0] },
    largeCheckPoints: { 'signal tower': [29.5, 24, 3.0], 'station platform': [30, 4.5, 1.0], 'shed loft': [26, 48, 3.2] },
    build(base, size) {
      const o = size === 'large' ? 10 : 0;
      const b = shifted(base, o, o);
      b.open(2, 2, 38, 30);
      // wagons on two tracks (solid; the doors let you walk through some of them)
      const wagon = (x0, z0, x1, door) => {
        b.wall(x0, z0, x1, z0 + 2.5, 2.8, 'wagon');
        if (door) b.cut((x0 + x1) / 2 - 1, z0, (x0 + x1) / 2 + 1, z0 + 2.5, 0, 2.2);
      };
      wagon(4, 7, 13, false); wagon(15, 7, 24, true); wagon(26, 7, 35, false);
      wagon(5, 21, 14, true); wagon(16, 21, 25, false); wagon(27, 21, 36, true);
      // signal tower in the middle
      b.wall(18, 12.5, 21, 15.5, 3.0, 'platform');
      b.stairs(21, 12.5, 25, 15.5, '-x', 0, 3.0);
      b.wall(18, 12.5, 18.5, 15.5, 4.0, 'low', 3.0);
      b.box(10, 13, 11.5, 14.5);
      b.box(11.5, 13, 13, 14.5);
      b.box(29, 16, 30.5, 17.5);
      b.crate(31, 12, 33, 14);
      b.barrel(6, 15);
      b.barrel(35, 17);
      b.box(4, 26, 5.5, 27.5);
      b.box(33, 3, 34.5, 4.5);
      b.crate(20, 26, 22, 28);
      b.box(17, 3, 18.5, 4.5);
      for (const [x, z, yaw] of [[4, 4, -2.4], [36, 4, 2.4], [4, 28, -0.8], [36, 28, 0.8], [20, 4, SOUTH], [20, 18.5, NORTH], [8, 17, EAST], [32, 10, WEST]]) b.spawn('dm', x, z, yaw);
      if (size !== 'large') return;
      // ---------- large: station platform (north), goods shed (south), side roads ----------
      base.open(2, 2, 58, 12);
      base.open(2, 40, 58, 50);
      base.open(2, 12, 12, 40);
      base.open(48, 12, 58, 40);
      base.wall(14, 3, 46, 6, 1.0, 'platform');          // station platform
      base.stairs(12, 3, 14, 6, '+x', 0, 1.0);
      base.stairs(46, 3, 48, 6, '-x', 0, 1.0);
      base.roof(18, 3, 42, 6, 3.4);
      for (const x of [18, 25, 32, 41.5]) base.wall(x, 3, x + 0.5, 3.5, 3.4, 'pillar');
      // goods shed with an upper loft
      base.wall(20, 41, 40, 41.5, 6.5, 'building');
      base.wall(20, 49.5, 40, 50, 6.5, 'building');
      base.wall(20, 41, 20.5, 50, 6.5, 'building');
      base.wall(39.5, 41, 40, 50, 6.5, 'building');
      base.cut(28, 41, 32, 41.5, 0, 2.6);
      base.cut(20, 44, 20.5, 47, 0, 2.4);
      base.cut(39.5, 44, 40, 47, 0, 2.4);
      base.slab(20.5, 46, 39.5, 49.5, 3.2);
      base.stairs(30, 43, 39.5, 46, '+x', 0, 3.2);           // runs along the shed, up to the loft
      base.wall(20.5, 45.5, 30, 46, 4.2, 'low', 2.9);
      base.cut(24, 41, 27, 41.5, 4.1, 5.1);    // loft window over the yard
      base.crate(23, 42.5, 25, 44.5);
      base.box(22, 47, 23.5, 48.5);
      // side roads
      base.truck(3, 18, 5.5, 25.5, '+z');
      base.box(50, 20, 51.5, 21.5);
      base.crate(54, 30, 56, 32);
      base.barrel(9, 34);
      base.barrel(52, 14);
      base.crate(4, 30, 6, 32);
      base.box(53, 22, 54.5, 23.5);
      base.crate(14, 41, 16, 43);
      base.box(44, 43, 45.5, 44.5);
      base.wall(6, 12, 7, 15, 1.0, 'low');
      base.wall(53, 36, 54, 39, 1.0, 'low');
      for (const [x, z, yaw] of [[4, 8, EAST], [56, 8, WEST], [4, 46, EAST], [56, 46, WEST], [30, 10, SOUTH], [36, 48, WEST], [8, 30, EAST], [52, 26, WEST]]) base.spawn('dm', x, z, yaw);
    },
  },
};

// ---------- helpers for choosing maps ----------
export const isDmMap = id => !!(MAPS[id] && MAPS[id].mode === 'dm');
// Deathmatch map size from the number of players: small for 2, large for 4
export const dmVariant = players => (players >= 4 ? 'large' : 'small');

// The map definition to build, with a deathmatch map's size variant applied
export function resolveMap(id, variant) {
  const d = MAPS[id] || MAPS.outpost;
  if (!d.sizes) return d;
  const v = d.sizes[variant] ? variant : 'small';
  return { ...d, variant: v, size: d.sizes[v], build: b => d.build(b, v), checkPoints: v === 'large' && d.largeCheckPoints ? d.largeCheckPoints : d.checkPoints };
}

// Maps the host can pick: 2v2 shows the wingman maps; deathmatch shows the
// deathmatch maps for 2 or 4 players and the wingman maps for exactly 3.
export function mapsFor(mode, players) {
  const ids = Object.keys(MAPS);
  if (mode !== 'dm') return ids.filter(id => !isDmMap(id));
  return players === 3 ? ids.filter(id => !isDmMap(id)) : ids.filter(isDmMap);
}
