// The Volleyball mode's three maps. Each has the SAME court and net (volley.js: 12 × 6 m, the net's top 2.24 m) in the
// same place, the same room round it (players may use 4 m behind each end line and 5 m beyond each side line), and the
// same rules: only what is round it differs. Drawn by mapview.js like the 2v2 maps (the court's lines, the net and the
// ball are drawn by mgplay.js, the same on every map). No three.js in here.
//   Sandbar  a sunny sand bar in the sea: beach huts on a boardwalk, dunes, a lifeguard tower (theme 'beach')
//   Piazza   a village square: houses all round, a church and its tower, paving (theme 'village')
//   Summit   a snowy mountain station: red huts, a fence, crates and a snowcat truck (theme 'snow')
const EAST = -Math.PI / 2, WEST = Math.PI / 2;
const SIZE = [44, 34];
// the court's middle and floor, and the room round it — the same on all three
export const VB_PLACE = { cx: 22, cz: 17, y: 0, area: [12, 9, 32, 25] };
const spawns = (b) => { b.spawn('atk', 17, 17, EAST); b.spawn('def', 27, 17, WEST); };

export const VB_MAPS = {
  sandbar: {
    name: 'Sandbar',
    description: 'Volleyball. A sunny sand bar out in the sea: beach huts on a boardwalk, dunes and a lifeguard tower.',
    mode: 'vb',
    theme: 'beach',
    size: SIZE,
    massHeight: 6,
    vb: VB_PLACE,
    build(b) {
      b.open(0, 0, 44, 34);
      // the boardwalk and the beach huts behind it (north)
      b.wall(4, 2.5, 40, 5, 0.3, 'slab');
      for (const x of [7, 12, 17, 27, 32, 37]) { b.wall(x - 1.5, 0.5, x + 1.5, 2.5, 2.8, 'building'); b.roof(x - 1.75, 0.25, x + 1.75, 3, 2.8); }
      // dunes along the west and east ends
      for (const [z0, z1, h] of [[3, 8, 0.6], [8, 13, 1.1], [13, 18, 0.8], [18, 24, 1.2], [24, 30, 0.7]]) { b.wall(0.5, z0, 3, z1, h, 'low'); b.wall(41, z0 + 1, 43.5, z1 + 1, h * 0.9, 'low'); }
      // the lifeguard tower (south-east): four legs, a deck, a roof
      for (const [x, z] of [[36, 27], [38.5, 27], [36, 29.5], [38.5, 29.5]]) b.wall(x, z, x + 0.5, z + 0.5, 4.6, 'pillar');
      b.wall(36, 27, 39, 30, 2.2, 'platform'); b.cut(36.5, 27.5, 38.5, 29.5, 0, 1.9);
      b.roof(35.6, 26.6, 39.4, 30.4, 4.6);
      // a few things lying about (outside the court's room)
      b.barrel(5, 6); b.barrel(39, 6); b.box(8.5, 30, 10, 31.5); b.crate(30, 30, 32, 32, 1.2); b.box(4, 22, 5.5, 23.5);
      spawns(b);
    },
  },

  piazza: {
    name: 'Piazza',
    description: 'Volleyball. A paved village square with houses all round, a church and its bell tower.',
    mode: 'vb',
    theme: 'village',
    size: SIZE,
    massHeight: 8,
    village: { hMin: 6, hMax: 10.5, palette: ['#e6c9a0', '#dcae7a', '#d39b6a', '#e8d6b8', '#c98a5e', '#e3b98c', '#cf9f7a', '#efe3cc', '#d8b48a', '#e9cfa8'] },
    vb: VB_PLACE,
    build(b) {
      // the church and its tower on the north side
      b.house(25, 0, 33, 5.5, { h: 11.5, mat: 'stone', color: '#dccaa6', roof: 'gable-z', kind: 'church', quoins: false, balcony: false, plants: false, chimney: false, shutters: null });
      b.house(33, 0, 37, 4, { h: 18, mat: 'stone', color: '#dccaa6', roof: 'tower', kind: 'tower', quoins: false, balcony: false, plants: false, chimney: false, shutters: null });
      // the square and the streets out of it
      b.open(9, 5.5, 35, 28.5);
      b.open(19, 0, 23, 5.5); b.open(0, 15, 9, 19); b.open(35, 16, 44, 20); b.open(19, 28.5, 23, 34);
      b.deco('paving', 9, 5.5, 35, 28.5);
      b.well(9.5, 6, 10.9, 7.4);
      b.cart(36, 16.5, 39, 18, '+x'); b.cart(4, 17, 7, 18.5, '-x');
      b.barrel(33.5, 26.5); b.barrel(9.6, 26.8);
      spawns(b);
    },
  },

  summit: {
    name: 'Summit',
    description: 'Volleyball. A snowy station high in the mountains: red huts, a fence, crates and a snowcat.',
    mode: 'vb',
    theme: 'snow',
    size: SIZE,
    massHeight: 3.2,          // (low stone walls round it: the mountains show over them)
    vb: VB_PLACE,
    build(b) {
      b.open(3, 2, 41, 32);
      // red station huts on the north side, a store on the west
      b.wall(5, 2, 15, 6, 5, 'building'); b.roof(4.6, 1.6, 15.4, 6.4, 5);
      b.wall(28, 2, 38, 5.5, 4.2, 'building'); b.roof(27.6, 1.6, 38.4, 5.9, 4.2);
      b.wall(3, 12, 7, 22, 3.6, 'building'); b.roof(2.6, 11.6, 7.4, 22.4, 3.6);
      // a fence along the south, a generator, crates, barrels and the snowcat
      b.wall(4, 30, 40, 30.3, 1.3, 'fence');
      b.wall(36, 9, 39, 11.5, 2.4, 'machine');
      b.crate(37, 20, 39, 22); b.crate(37.5, 22.5, 39.5, 24, 1.2); b.box(9, 27, 10.5, 28.5); b.barrel(16, 7.5); b.barrel(30, 27.5);
      b.truck(18, 27, 25.5, 29.5, '+x');
      spawns(b);
    },
  },
};
export const VB_MAP_IDS = Object.keys(VB_MAPS);
