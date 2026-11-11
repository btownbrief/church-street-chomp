/* Church Street Chomp - maze layouts.
 * Each maze is written as its LEFT half (cols 0..9, 10 chars) and mirrored, so every board is
 * left/right symmetric and 19 x 23. Legend:
 *   #  wall (planter / bench / brick wall, with string lights on its rim)
 *   .  maple candy        o  maple creemee (power item)
 *   (space) open path, no candy (corridors around the parking office)
 *   -  parking-office gate (officers only)      P  inside the parking office
 *   R  raccoon start (center column only)
 * A row whose col 0 is open is a side tunnel (wraps to col 18).
 * All four layouts are original; the office sits in the same spot so officer logic is shared. */
(function (root) {
  'use strict';
  const COLS = 19, ROWS = 23;

  const RAW = [
    {
      name: 'Church Street', theme: 0,
      rows: [
        '##########',
        '#.....#...',
        '#.###.#.#.',
        '#.#.....#.',
        '#.#.###.#.',
        '#o..#...#.',
        '##.##.#...',
        '#.....#.##',
        '#.##.#    ',
        '#.##.# ##-',
        '   .   #PP',
        '#.##.# #PP',
        '#....# ###',
        '##.#.#    ',
        '#..#.# ###',
        '#.##...#..',
        '#o##.#.#.#',
        '#.##.#....',
        '#.##.#.##.',
        '#....#.#.R',
        '#.##.#.#.#',
        '#.........',
        '##########',
      ],
    },
    {
      name: 'Waterfront', theme: 1,
      rows: [
        '##########',
        '#...o.....',
        '#.##.####.',
        '#.##.####.',
        '#.........',
        '##.#.##.##',
        '#..#..#...',
        '#.###.#.##',
        '#.....    ',
        '###.## ##-',
        '   .   #PP',
        '###.## #PP',
        '#....# ###',
        '#.##.#    ',
        '#....# ###',
        '###.#.....',
        '#...#.##.#',
        '#.#...#..R',
        '#.#.#.#.##',
        '#.o.#.....',
        '#.###.###.',
        '#.........',
        '##########',
      ],
    },
    {
      name: 'City Hall Park', theme: 2,
      rows: [
        '##########',
        '#....#....',
        '#.##.#.##.',
        '#.##...##.',
        '#....#....',
        '#.##.#####',
        '#.#o......',
        '#.#.####.#',
        '#...##    ',
        '###.## ##-',
        '   .   #PP',
        '###.## #PP',
        '#...## ###',
        '#.#.##    ',
        '#.#.## ###',
        '#.#.......',
        '#.###.##.#',
        '#........R',
        '#.##.##.##',
        '#....#....',
        '#o##.#.##.',
        '#.........',
        '##########',
      ],
    },
    {
      name: 'Battery Street', theme: 3,
      rows: [
        '##########',
        '#.....#...',
        '#.###.#.#.',
        '#.........',
        '#.#.###.##',
        '#.#.o.#..#',
        '#.###.##.#',
        '#...#.##.#',
        '###...    ',
        '###.## ##-',
        '   .   #PP',
        '###.## #PP',
        '#....# ###',
        '#.##.#    ',
        '#.##.# ###',
        '#....#....',
        '##.#.#.##.',
        '#..#.o.#.R',
        '#.##.#.#.#',
        '#.........',
        '#.###.###.',
        '#.........',
        '##########',
      ],
    },
  ];

  function mirror(left) {
    // left is cols 0..9; full row col (18-i) = left[i] for i = 0..8
    let s = left.slice(0, 10);
    for (let i = 8; i >= 0; i--) s += left[i];
    return s;
  }

  function build(raw) {
    const rows = raw.rows.map(r => mirror(r.padEnd(10, '#').slice(0, 10)));
    const g = [];          // 0 path, 1 wall, 2 gate, 3 office
    const candy = [];      // 0 none, 1 candy, 2 creemee
    let start = { x: 9, y: 17 };
    for (let y = 0; y < ROWS; y++) {
      const gr = [], cr = [];
      for (let x = 0; x < COLS; x++) {
        const ch = (rows[y] || '')[x] || '#';
        gr.push(ch === '#' ? 1 : ch === '-' ? 2 : ch === 'P' ? 3 : 0);
        cr.push(ch === '.' ? 1 : ch === 'o' ? 2 : 0);
        if (ch === 'R') start = { x, y };
      }
      g.push(gr); candy.push(cr);
    }
    const tunnels = [];
    for (let y = 0; y < ROWS; y++) if (g[y][0] === 0 && g[y][COLS - 1] === 0) tunnels.push(y);
    return { name: raw.name, theme: raw.theme, rows, grid: g, candy, start, tunnels,
      gate: { x: 9, y: 9 }, door: { x: 9, y: 8 }, office: { x: 9, y: 10.5 } };
  }

  const MAZES = RAW.map(build);
  root.CSC_MAZES = { COLS, ROWS, MAZES, mirror };
})(typeof window !== 'undefined' ? window : globalThis);
