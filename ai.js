/* Church Street Chomp - parking-officer brains. Pure functions, no drawing.
 * Directions: 0 up, 1 left, 2 down, 3 right. */
(function (root) {
  'use strict';
  const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
  const OPP = [2, 3, 0, 1];

  /* The four officers. Each one picks a TARGET tile; the officer then drives toward it one junction
   * at a time. Personality lives in how the target is chosen (game.js adds Bolt's dash and Doug's parking). */
  const OFFICERS = [
    { key: 'chalk', name: 'Chief Chalk', role: 'drives straight at you',
      // Straight at the raccoon's tile. Simple, relentless.
      target(c) { return { x: c.px, y: c.py }; } },
    { key: 'tina', name: 'Ticket Tina', role: 'cuts you off two corners ahead',
      // Heads for the SECOND junction along the raccoon's path (or the one after, if Chalk is already there).
      target(c) { return { x: c.tinaX, y: c.tinaY }; } },
    { key: 'bolt', name: 'Officer Bolt', role: 'guards treats, dashes down lanes',
      // Parks by the treat or creemee nearest the raccoon; within 6 tiles he goes straight at it.
      // In a clear straight line 3-7 tiles away he flashes his headlight and dashes (game.js).
      // With nothing left to guard he tailgates, 3 tiles behind.
      target(c, self) {
        if (c.dashing) return { x: c.px, y: c.py };
        if (Math.hypot(c.px - self.tx, c.py - self.ty) < 6) return { x: c.px, y: c.py };
        if (c.guardX != null) return { x: c.guardX, y: c.guardY };
        return { x: c.px - DX[c.pdir] * 3, y: c.py - DY[c.pdir] * 3 };
      } },
    { key: 'doug', name: 'Dozy Doug', role: 'naps by the candy, wakes up close',
      // Parks next to the thickest patch of candy on your side; within 5 tiles he wakes and chases
      // you directly until you are more than 8 tiles away.
      target(c) {
        if (c.dougAwake) return { x: c.px, y: c.py };
        if (c.sentryX != null) return { x: c.sentryX, y: c.sentryY };
        return { x: c.trailX, y: c.trailY };
      } },
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

  /** Target for officer i. ctx: {px,py,pdir,phase,...}; self: {tx,ty,corner}. */
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

  /** Panicked officers flee: at each junction take the non-reversing exit whose next tile is FARTHEST
   *  from the raccoon (wrap-aware), with a 20% chance of a random exit so they can still be cornered. */
  function fleeDir(open, tx, ty, dir, px, py, rnd, cols) {
    const opts = [];
    for (let d = 0; d < 4; d++) if (d !== OPP[dir] && open(tx + DX[d], ty + DY[d])) opts.push(d);
    if (!opts.length) return OPP[dir];
    if (opts.length > 1 && rnd() < 0.2) return opts[Math.floor(rnd() * opts.length) % opts.length];
    let best = opts[0], bd = -1;
    for (const d of opts) {
      let dx = tx + DX[d] - px; if (cols) { if (dx > cols / 2) dx -= cols; else if (dx < -cols / 2) dx += cols; }
      const dy = ty + DY[d] - py, dd = dx * dx + dy * dy;
      if (dd > bd + 1e-9) { bd = dd; best = d; }
    }
    return best;
  }

  root.CSC_AI = { DX, DY, OPP, OFFICERS, corners, targetFor, chooseDir, fleeDir };
})(typeof window !== 'undefined' ? window : globalThis);
