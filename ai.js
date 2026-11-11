/* Church Street Chomp - parking-officer brains. Pure functions, no drawing.
 * Directions: 0 up, 1 left, 2 down, 3 right. */
(function (root) {
  'use strict';
  const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
  const OPP = [2, 3, 0, 1];

  /* The four officers. Each one picks a TARGET tile; the officer then drives toward it one junction
   * at a time. Personality lives entirely in how the target is chosen. */
  const OFFICERS = [
    { key: 'chalk', name: 'Chief Chalk', role: 'chases you head-on',
      // Straight at the raccoon's tile. Simple, relentless.
      target(c) { return { x: c.px, y: c.py }; } },
    { key: 'tina', name: 'Ticket Tina', role: 'waits at your next corner',
      // Heads for the next junction along the raccoon's path, to be there when it arrives.
      target(c) { return { x: c.aheadX, y: c.aheadY }; } },
    { key: 'bolt', name: 'Officer Bolt', role: 'guards the treats, then bolts',
      // Parks by the treat or creemee nearest the raccoon; within 6 tiles he bolts straight at it.
      // With nothing left to guard he tailgates, 3 tiles behind.
      target(c, self) {
        if (Math.hypot(c.px - self.tx, c.py - self.ty) < 6) return { x: c.px, y: c.py };
        if (c.guardX != null) return { x: c.guardX, y: c.guardY };
        return { x: c.px - DX[c.pdir] * 3, y: c.py - DY[c.pdir] * 3 };
      } },
    { key: 'doug', name: 'Dozy Doug', role: 'follows your trail, late',
      // Slow on the uptake: drives to where the raccoon was about 3 seconds ago.
      target(c) { return { x: c.trailX, y: c.trailY }; } },
  ];

  // Home corners for scatter time (just outside the board so they circle the nearest block).
  function corners(cols, rows) {
    return [
      { x: -1, y: rows + 1 },        // Chalk: bottom left
      { x: cols, y: rows + 1 },      // Tina: bottom right
      { x: 1, y: -3 },               // Bolt: top left
      { x: cols - 2, y: -3 },        // Doug: top right
    ];
  }

  /** Target for officer i. ctx: {px,py,pdir,chiefX,chiefY,phase}; self: {tx,ty,corner}. */
  function targetFor(i, ctx, self) {
    if (ctx.phase === 'scatter') return self.corner;
    return OFFICERS[i].target(ctx, self);
  }

  /** Choose a new direction at a tile center: never reverse, pick the open exit whose next tile is
   *  closest to the target (straight-line). Ties keep going straight, then prefer up, right, down, left. */
  function chooseDir(open, tx, ty, dir, target) {
    let best = -1, bestD = Infinity;
    for (const d of [dir, 0, 3, 2, 1]) {
      if (d === OPP[dir]) continue;
      const nx = tx + DX[d], ny = ty + DY[d];
      if (!open(nx, ny)) continue;
      const dd = (nx - target.x) * (nx - target.x) + (ny - target.y) * (ny - target.y);
      if (dd < bestD - 1e-9) { bestD = dd; best = d; }
    }
    if (best < 0) best = open(tx + DX[OPP[dir]], ty + DY[OPP[dir]]) ? OPP[dir] : dir; // dead end fallback
    return best;
  }

  /** Panicked officers dart around: random open exit, still no reversing. */
  function panicDir(open, tx, ty, dir, rnd) {
    const opts = [];
    for (let d = 0; d < 4; d++) if (d !== OPP[dir] && open(tx + DX[d], ty + DY[d])) opts.push(d);
    if (!opts.length) return OPP[dir];
    return opts[Math.floor(rnd() * opts.length) % opts.length];
  }

  root.CSC_AI = { DX, DY, OPP, OFFICERS, corners, targetFor, chooseDir, panicDir };
})(typeof window !== 'undefined' ? window : globalThis);
