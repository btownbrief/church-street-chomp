/* Church Street Chomp - game loop, movement, modes, input, HUD, juice. */
(function () {
  'use strict';
  const { COLS, ROWS, MAZES } = window.CSC_MAZES;
  const CROP = 0.62; // tiles of the outer hedge ring cropped away on every side (the thin frame that remains is the maze's outer wall)
  const AI = window.CSC_AI, Art = window.CSCArt, A = window.CSCAudio;
  const { DX, DY, OPP } = AI;
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;

  /* ---------- saves ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('csc_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('csc_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const settings = Object.assign({ sfx: true, music: true, pad: false, haptics: true }, store.get('settings', {}));
  const best = Object.assign({ rush: 0, classic: 0 }, store.get('best', {}));
  let seenTut = store.get('tut', false);
  // Daily Patrol: one date-seeded 3-minute run a day, with a twist, today's best and a day streak
  const daily = Object.assign({ date: '', best: 0, streak: 0, last: '', plays: 0 }, store.get('daily', {}));
  const dayKey = (off) => { const d = new Date(); d.setDate(d.getDate() + (off || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dayNum = () => { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };
  const TWISTS = [
    { name: 'Double Scoop', desc: 'Creemees last 25% longer', panicMul: 1.25 },
    { name: 'Rush Hour', desc: 'Faster scooters, candies worth double', offMul: 1.08, candyMul: 2 },
    { name: 'Sleepy Squad', desc: 'Slower scooters, tickets cost 15 s', offMul: 0.9, penalty: 15 },
    { name: 'Treat Street', desc: 'Bonus treats worth triple', bonusMul: 3 },
    { name: 'Close Shave', desc: 'Close calls pay 300', nearPts: 300 },
  ];
  const todayTwist = () => TWISTS[dayNum() % TWISTS.length];
  /* Daily goals: three small goals a day, picked by date, done in any mode. test(run) is checked live. */
  const GOALS = [
    { id: 'catch8', text: 'Catch 8 officers in one run', test: r => r.caught >= 8 },
    { id: 'chain3', text: 'Catch 3 officers on one creemee', test: r => r.panicBest >= 3 },
    { id: 'sweep', text: 'Land a Clean Sweep (all 4 on one creemee)', test: r => r.sweeps >= 1 },
    { id: 'x3', text: 'Build a x3 munch streak', test: r => r.maxMult >= 3 },
    { id: 'rush40', text: 'Score 40,000 in Rush', test: r => r.mode === 'rush' && !r.daily && r.score >= 40000 },
    { id: 'classic2', text: 'Clear a street in Classic', test: r => r.mode === 'classic' && r.level >= 2 },
    { id: 'daily', text: "Finish today's Daily Patrol", test: r => r.daily && r.over },
    { id: 'close1', text: 'Dodge an officer for a Close Call', test: r => r.near >= 1 },
    { id: 'treats3', text: 'Grab 3 bonus treats in one run', test: r => r.treats >= 3 },
    { id: 'refill5', text: 'Reach speed 6 in Rush', test: r => r.mode === 'rush' && r.speedLvl >= 5 },
    { id: 'clean60', text: 'Go 60 s in a run without a ticket', test: r => r.cleanBest >= 60 },
  ];
  const goalsToday = () => { const n = dayNum(), out = [], R = (k) => (n * 2654435761 + k * 40503) >>> 0; let k = 0; while (out.length < 3 && k < 50) { const g = GOALS[R(k++) % GOALS.length]; if (!out.includes(g)) out.push(g); } return out; };
  const goalSave = Object.assign({ date: '', done: [] }, store.get('goals', {}));
  const goalDone = () => (goalSave.date === dayKey() ? goalSave.done : []);
  /* One-time coaching tips for new players */
  const tips = Object.assign({}, store.get('tips', {}));
  const dailyBest = () => (daily.date === dayKey() ? daily.best : 0);
  const liveStreak = () => (daily.last === dayKey() || daily.last === dayKey(-1) ? daily.streak : 0);

  /* ---------- tuning ---------- */
  const TUNE = {
    assist: 0.42,        // cornering window (a human-late swipe still lands), in tiles, either side of a junction center
    bufferMs: 300,       // a swiped turn is held at least this long...
    bufferJunctions: 1,  // ...and until we've passed this many junctions without using it
    bufferMaxMs: 1100,   // hard cap
    hitR: 0.58,          // officer touch distance (tiles) - forgiving
    nearR: 1.2,          // near-miss distance
    rushTime: 300,
    rushPenalty: 10,
    swipePx: 14,
  };
  const SCHED_1 = [['scatter', 8], ['chase', 15], ['scatter', 7], ['chase', 18], ['scatter', 6], ['chase', 22], ['scatter', 4], ['chase', 1e9]];
  const SCHED_N = [['scatter', 5], ['chase', 22], ['scatter', 5], ['chase', 25], ['scatter', 3], ['chase', 30], ['scatter', 2], ['chase', 1e9]];
  /* Officer voices: short speech bubbles at key moments (personality in play, not just on the card). */
  const QUIPS = [
    { chase: ['HALT!', 'Stop, raccoon!', 'By the book!'], panic: ['Not the creemee!', 'Retreat!'], caught: ['My mustache!', 'Ow, my badge!'], ticket: ['Ticket time.', 'Case closed!'], near: ['Hey!'] },
    { chase: ["Meter's running!", 'Cutting you off!'], panic: ['Eek!', 'Brain freeze!'], caught: ['My ticket pad!', 'Not fair!'], ticket: ["That's a fine!", 'Pay up!'], near: ['So close!'] },
    { chase: ['Zoom zoom!', 'Flanking!'], panic: ['Abort! Abort!', 'Nope!'], caught: ['Bzzt!', 'Wheee-ow!'], ticket: ["Boltin' ya!", 'Too slow!'], near: ['Whoa!'] },
    { chase: ['...huh?', 'On it. Ish.'], panic: ['Coffee break!', 'Uh oh.'], caught: ['zzz...', 'Worth it.'], ticket: ['Oh. Got one.', 'Wasn\'t even trying.'], near: ['Hm?'], doze: ['zzz', 'Five more mins...', '*yawn*'] },
  ];
  /* Score medals: something to chase between runs. */
  const MEDALS = {
    rush: [['Bronze', 15000], ['Silver', 40000], ['Gold', 75000], ['Maple', 120000]],
    classic: [['Bronze', 3000], ['Silver', 8000], ['Gold', 18000], ['Maple', 35000]],
  };
  function medalFor(mode, score) { let m = -1; MEDALS[mode].forEach((x, i) => { if (score >= x[1]) m = i; }); return m; }
  const CHAIN_COL = ['#ffffff', '#ffe28a', '#ffb15e', '#ff8ad8', '#c9a0ff'];
  const SCHED_RUSH = [['scatter', 5], ['chase', 15], ['scatter', 6], ['chase', 16], ['scatter', 5], ['chase', 18], ['scatter', 5], ['chase', 18]];

  function speeds() {
    if (G.mode === 'rush') {
      const L = G.speedLvl;
      const tw = G.twist;
      return { player: Math.min(10.6, 7.4 + 0.34 * L), off: Math.min(9.7, 5.4 + 0.42 * L) * (tw.offMul || 1), panicOff: 4.0 + 0.15 * L,
        tunnel: 3.6 + 0.12 * L, ret: 16, panicTime: Math.max(2.8, 5.5 - 0.3 * L) * (tw.panicMul || 1) };
    }
    const L = G.level - 1;
    // level 1 is a warm-up: officers clearly slower than you; the ramp starts at level 2
    return { player: Math.min(9.2, 7.2 + 0.26 * L), off: L === 0 ? 4.9 : Math.min(8.9, 5.7 + 0.36 * L), panicOff: 4.0 + 0.1 * L,
      tunnel: 3.4 + 0.1 * L, ret: 16, panicTime: Math.max(1.6, 6 - 0.6 * L) };
  }

  /* ---------- state ---------- */
  const G = {
    screen: 'title', state: 'idle', mode: 'rush', paused: false, daily: false, twist: {},
    score: 0, lives: 3, level: 1, time: TUNE.rushTime, speedLvl: 0, refills: 0, mazeIdx: 0,
    maze: null, grid: null, candy: null, candyLeft: 0, half: [0, 0], eaten: 0,
    p: null, offs: [], phaseIdx: 0, phaseT: 0, panicT: 0, chain: 0, bestChain: 0, caughtN: 0, nearN: 0,
    bonus: null, bonusSpawns: 0, stateT: 0, banner: null, flash: 0, flashCol: '#fff', shake: 0, hitPause: 0, slowmo: 0, nearCD: 0, nearPending: null,
    fx: [], pops: [], time0: 0, god: false, extraGiven: false, gateLift: 0, tickSec: -1, collected: [],
    log: [], rnd: mulberry(7), clock: 0, lastPhase: 'scatter',
    streak: 0, streakT: 9, mult: 1, maxMult: 1, panicBest: 0, cleanT: 0, cleanBest: 0, coachT: 0, coachPtr: null,
    hist: [], histT: 0, bubbles: [], bubbleCD: 0, trail: [], trailT: 0, sugar: null, punch: 0, panicMax: 1, panicCatches: 0, sweeps: 0, ticketBy: [0, 0, 0, 0], lastTicketBy: null,
  };
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- grid helpers ---------- */
  const wx = x => ((Math.round(x) % COLS) + COLS) % COLS;
  const fx = x => ((x % COLS) + COLS) % COLS; // wrapped but not rounded (smooth drawing)
  function open(x, y) { if (y < 0 || y >= ROWS) return false; x = ((x % COLS) + COLS) % COLS; return G.grid[y][x] === 0; }
  function exits(x, y) { let n = 0; for (let d = 0; d < 4; d++) if (open(x + DX[d], y + DY[d])) n++; return n; }
  function wrap(e) { if (e.x < -0.5) e.x += COLS; else if (e.x >= COLS - 0.5) e.x -= COLS; }
  function wdx(a, b) { let d = a - b; if (d > COLS / 2) d -= COLS; else if (d < -COLS / 2) d += COLS; return d; }
  const halfOf = x => (x <= 9 ? 0 : 1);
  function inTunnel(e) { const ty = Math.round(e.y); return G.maze.tunnels.includes(ty) && (e.x < 3.5 || e.x > COLS - 4.5); }

  /* Move an entity along its direction, stopping at every tile center to let `onCenter` decide.
   * Entities live on tile centers' axes; this is the grid logic under the smooth movement. */
  function stepAlong(e, dist, onCenter) {
    let guard = 0;
    while (dist > 1e-7 && guard++ < 24) {
      const horiz = DX[e.dir] !== 0, sgn = horiz ? DX[e.dir] : DY[e.dir];
      const cur = horiz ? e.x : e.y, c = Math.round(cur);
      let nextC;
      if (Math.abs(cur - c) < 1e-6) {
        if (!e.atC) { e.atC = true; if (horiz) e.x = c; else e.y = c; if (onCenter(e) === false) return; continue; }
        nextC = c + sgn;
      } else nextC = sgn > 0 ? Math.ceil(cur) : Math.floor(cur);
      const d = Math.abs(nextC - cur), mv = Math.min(d, dist);
      if (horiz) e.x += sgn * mv; else e.y += sgn * mv;
      dist -= mv; e.atC = false;
      if (mv >= d - 1e-9) { if (horiz) e.x = nextC; else e.y = nextC; }
      wrap(e);
    }
  }

  /* ---------- level / maze setup ---------- */
  function loadMaze(idx) {
    G.mazeIdx = idx % MAZES.length; G.maze = MAZES[G.mazeIdx]; A.setKey(G.mazeIdx); Sky.dirty = true;
    G.grid = G.maze.grid.map(r => r.slice());
    G.candy = G.maze.candy.map(r => r.slice());
    countCandy();
    G.bonus = null; G.bonusSpawns = 0; G.eaten = 0;
    G.homeDist = distField(9, 8);
    View.mazeDirty = true;
  }
  // BFS distance from a tile over the open paths (with tunnel wrap); used to send caught officers home
  function distField(sx, sy) {
    const D = G.grid.map(r => r.map(() => 1e9)); D[sy][sx] = 0; const q = [[sx, sy]];
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (let d = 0; d < 4; d++) { const nx = (x + DX[d] + COLS) % COLS, ny = y + DY[d]; if (open(nx, ny) && D[ny][nx] > D[y][x] + 1) { D[ny][nx] = D[y][x] + 1; q.push([nx, ny]); } }
    }
    return D;
  }
  function countCandy() {
    G.candyLeft = 0; G.half = [0, 0];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (G.candy[y][x]) { G.candyLeft++; G.half[halfOf(x)]++; }
  }
  function refillHalf(h) {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (halfOf(x) === h && G.maze.candy[y][x] && !G.candy[y][x]) {
      G.candy[y][x] = G.maze.candy[y][x];
      if (G.p && wx(G.p.x) === x && Math.round(G.p.y) === y) G.candy[y][x] = 0;
    }
    countCandy(); View.candyDirty = true;
  }

  function resetActors(firstOfLevel) {
    const st = G.maze.start;
    G.p = { x: st.x, y: st.y, dir: [0, 1, 3, 2].find(d => open(st.x + DX[d], st.y + DY[d])), moving: false /* waits for your first swipe */, buf: null, atC: false, chomp: 0, eatT: 9, squash: 0, shield: G.mode === 'rush' && !firstOfLevel ? 2 : 0, dead: 0 };
    const corners = AI.corners(COLS, ROWS);
    const rel = G.mode === 'rush' ? (firstOfLevel ? [0, 1.5, 4, 7] : [0.6, 2, 4, 6]) : (G.level === 1 ? (firstOfLevel ? [0, 2.5, 14, 26] : [0, 2, 6, 10]) : [0, 0.5, 2, 4]);
    const homes = [9, 9, 8, 10];
    G.offs = [0, 1, 2, 3].map(i => ({
      i, x: i === 0 ? 9 : homes[i], y: i === 0 ? 8 : 10.5, dir: i === 0 ? 1 : (i === 2 ? 0 : 2), face: i === 2 ? 1 : -1,
      st: i === 0 ? 'active' : 'home', release: rel[i], homeX: homes[i], corner: corners[i], panic: false, atC: false,
      target: { x: 9, y: 8 }, lastD: 99, bob: i * 1.3,
    }));
    G.phaseIdx = 0; G.phaseT = sched()[0][1]; G.panicT = 0; G.chain = 0; G.nearPending = null; G.bubbles = []; G.trail = []; G.bubbleCD = 1.5; G.hist = []; G.histT = 0; G.forceScatter = 0;
    G.offs.forEach(o => { o.quipCD = 4 + o.i * 2; });
    A.music(settings.music ? 'calm' : 'off');
  }
  const sched = () => (G.mode === 'rush' ? SCHED_RUSH : G.level === 1 ? SCHED_1 : SCHED_N);
  const phase = () => { if (G.forceScatter > 0) return 'scatter'; const s = sched(); return s[Math.min(G.phaseIdx, s.length - 1)][0]; };

  let played = false;
  function newGame(mode) {
    G.daily = mode === 'daily'; G.twist = G.daily ? todayTwist() : {}; if (G.daily) mode = 'rush';
    G.mode = mode; G.score = 0; G.lives = 3; G.level = 1; G.time = TUNE.rushTime; G.speedLvl = 0; G.refills = 0;
    G.bestChain = 0; G.eatenTotal = 0; G.ticketN = 0; G.caughtN = 0; G.nearN = 0; G.extraGiven = false; G.collected = []; G.clock = 0; G.tickSec = -1;
    G.streak = 0; G.streakT = 9; G.mult = 1; G.maxMult = 1; G.panicBest = 0; G.cleanT = 0; G.cleanBest = 0; G.coachT = 2.5; G.coachPtr = null; G.goalsHit = [];
    G.bubbles = []; G.bubbleCD = 0; G.trail = []; G.sugar = null; G.punch = 0; G.sweeps = 0; G.ticketBy = [0, 0, 0, 0]; G.lastTicketBy = null;
    G.fx = []; G.pops = []; G.flash = 0; G.shake = 0; G.hitPause = 0; G.slowmo = 0; G.nearCD = 0; G.log = [];
    G.rnd = mulberry(G.daily ? dayNum() * 7919 : (Date.now() & 0xffff) || 7);
    if (G.daily) G.time = 180;
    loadMaze(G.daily ? dayNum() % MAZES.length : 0);
    resetActors(true);
    toReady(played ? 1.0 : 1.9, true); played = true; // replays get going faster
    showScreen('game');
    HUD.full();
    if (G.daily && seenTut) setTimeout(() => { if (G.screen === 'game') toast('Twist: ' + G.twist.name, G.twist.desc); }, 350); // first run: the banner sub-line carries the twist
  }
  function toReady(sec, jingle) {
    G.state = 'ready'; G.stateT = sec;
    G.banner = { text: G.mode === 'rush' && G.clock === 0 ? (G.daily ? 'DAILY PATROL' : 'RUSH!') : 'GET SET!', sub: G.daily && G.clock === 0 ? G.twist.name : undefined, t: 0 };
    if (jingle) A.sfx.start();
  }

  /* ---------- input ---------- */
  const Input = {
    keys: [], padDir: null, suppressClickUntil: 0, gestures: new Map(), lastInputAt: 0,
    held() { return this.keys.length ? this.keys[this.keys.length - 1] : this.padDir; },
  };
  function setBuffer(d, hold) {
    const p = G.p; if (!p) return;
    Input.lastInputAt = performance.now();
    if (!seenTut) { seenTut = true; store.set('tut', true); Tut.hide(); }
    if (hold && p.buf && p.buf.d === d) { p.buf.age = 0; p.buf.junc = 0; return; }
    if (d === p.dir && p.moving) { if (!p.buf || p.buf.d === d) p.buf = null; return; } // never overwrite a queued turn with "keep going"
    p.buf = { d, age: 0, junc: 0 };
  }
  const KEYMAP = { ArrowUp: 0, KeyW: 0, ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 3, KeyD: 3 };
  window.addEventListener('keydown', e => {
    A.unlock();
    const d = KEYMAP[e.code];
    if (d != null) {
      e.preventDefault();
      if (G.screen === 'game') { Input.keys = Input.keys.filter(k => k !== d); Input.keys.push(d); setBuffer(d, false); }
      return;
    }
    if (e.code === 'Escape' && !$('how').classList.contains('hidden')) { $('how').classList.add('hidden'); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { if (G.screen === 'game') togglePause(); }
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      if (G.screen === 'title') startMode('rush');
      else if (G.screen === 'over') startMode(curMode());
      else if (G.paused) togglePause();
    }
  });
  window.addEventListener('keyup', e => { const d = KEYMAP[e.code]; if (d != null) Input.keys = Input.keys.filter(k => k !== d); });
  window.addEventListener('blur', () => { Input.keys = []; Input.padDir = null; });

  function bindSwipe(el) {
    el.addEventListener('pointerdown', e => {
      A.unlock();
      if (e.target.closest && e.target.closest('#pad')) return;
      Input.gestures.set(e.pointerId, { x: e.clientX, y: e.clientY, swiped: false });
    });
    const move = e => {
      const g = Input.gestures.get(e.pointerId); if (!g) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y, ax = Math.abs(dx), ay = Math.abs(dy), ad = Math.max(ax, ay);
      if (ad < TUNE.swipePx) return;
      const d = ax > ay ? (dx > 0 ? 3 : 1) : (dy > 0 ? 2 : 0);
      if (g.d != null) {
        // after the first turn of a stroke, only a deliberate new stroke counts:
        // twice the distance, clearly on one axis, and not the same direction again
        if (d === g.d) { g.x = e.clientX; g.y = e.clientY; return; }
        if (ad < TUNE.swipePx * 2 || Math.max(ax, ay) < 2 * Math.min(ax, ay)) return;
      }
      if (G.screen === 'game' && !G.paused) setBuffer(d, false);
      g.d = d; g.x = e.clientX; g.y = e.clientY; g.swiped = true;
      Tut.hide();
    };
    el.addEventListener('pointermove', move);
    const end = e => {
      const g = Input.gestures.get(e.pointerId);
      if (g) { if (e.type === 'pointerup') move(e); if (g.swiped) Input.suppressClickUntil = performance.now() + 80; }
      Input.gestures.delete(e.pointerId);
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  function bindPad(pad) {
    let pid = null;
    const dirAt = e => {
      const r = pad.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.1) return Input.padDir;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : (dy > 0 ? 2 : 0);
    };
    const show = d => { pad.dataset.dir = d == null ? '' : ['up', 'left', 'down', 'right'][d]; };
    pad.addEventListener('pointerdown', e => {
      e.preventDefault(); A.unlock(); pid = e.pointerId; try { pad.setPointerCapture(pid); } catch (er) { /* ok */ }
      const d = dirAt(e); Input.padDir = d; if (d != null) { setBuffer(d, false); buzz(6); } show(d); Tut.hide();
    });
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return; const d = dirAt(e);
      if (d !== Input.padDir) { Input.padDir = d; if (d != null) { setBuffer(d, false); buzz(6); } show(d); }
    });
    const up = e => { if (e.pointerId !== pid) return; pid = null; Input.padDir = null; show(null); };
    pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up); pad.addEventListener('lostpointercapture', up);
  }
  function buzz(ms) {
    if (!settings.haptics || !navigator.vibrate) return;               // iOS has no vibrate: skip quietly
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // needs a real tap first
    try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }

  /* ---------- simulation ---------- */
  function tick(dt) {
    G.clock += dt;
    if (G.state === 'ready') {
      G.stateT -= dt;
      if (G.stateT < 0.45 && G.banner && G.banner.text !== 'GO!') G.banner = { text: 'GO!', t: 0 };
      if (G.stateT <= 0) { G.state = 'play'; G.banner = null; }
      return;
    }
    if (G.state === 'dying') {
      G.stateT -= dt; G.p.dead = Math.min(1, G.p.dead + dt / 1.1);
      if (G.stateT <= 0) afterDeath();
      return;
    }
    if (G.state === 'clear' || G.state === 'swap') {
      G.stateT -= dt;
      if (G.stateT <= 0) { if (G.state === 'clear') nextLevel(); else finishSwap(); }
      return;
    }
    if (G.state === 'timeup') { G.stateT -= dt; if (G.stateT <= 0) gameOver(); return; }
    if (G.state !== 'play') return;

    const sp = speeds();
    // timers
    if (G.mode === 'rush') {
      G.time -= dt;
      const s = Math.ceil(G.time);
      if (G.time <= 10 && s !== G.tickSec && s >= 0) { G.tickSec = s; A.sfx.tick(); }
      if (G.time <= 0) { G.time = 0; G.state = 'timeup'; G.stateT = 1.8; G.banner = { text: "TIME'S UP!", t: 0 }; if (G.panicT > 0) endPanic(); A.music('off'); A.sfx.clear(); buzz(60); return; }
    }
    if (G.panicT > 0) {
      G.panicT -= dt;
      if (G.panicT <= 0) endPanic();
    } else {
      G.phaseT -= dt;
      if (G.phaseT <= 0) {
        G.phaseIdx++;
        const s = sched(); if (G.mode === 'rush' && G.phaseIdx >= s.length) G.phaseIdx = 0;
        G.phaseT = s[Math.min(G.phaseIdx, s.length - 1)][1];
        if (phase() === 'chase') { const act = G.offs.filter(o => o.st === 'active' && !o.panic); if (act.length) { say(act[Math.floor(G.rnd() * act.length)], 'chase', true); A.sfx.siren(); } }
      }
    }
    G.nearCD -= dt; if (G.forceScatter > 0) G.forceScatter -= dt;
    G.streakT += dt; if (G.streakT > 0.3) G.streak = Math.max(0, G.streak - 0.8 * sp.player * dt); // a short grace for corners
    { const m = G.streak >= 80 ? 4 : G.streak >= 45 ? 3 : G.streak >= 20 ? 2 : 1; if (m < G.mult) { G.mult = m; HUD.mult(); } }
    G.cleanT += dt; G.cleanBest = Math.max(G.cleanBest, G.cleanT);
    G.goalT = (G.goalT || 0) - dt; if (G.goalT <= 0) { G.goalT = 0.5; checkGoals(false); }
    coach(dt);
    if (G.p.shield > 0) G.p.shield -= dt;
    // releases
    for (const o of G.offs) if (o.st === 'home') {
      o.release -= dt;
      if (G.mode === 'classic' && G.level === 1) { if ((o.i === 2 && G.eaten >= 40) || (o.i === 3 && G.eaten >= 80)) o.release = Math.min(o.release, 0); }
      if (o.release <= 0) o.st = 'leave';
    }
    updatePlayer(dt, sp);
    for (const o of G.offs) updateOfficer(o, dt, sp);
    collide();
    if (G.bonus) {
      G.bonus.life -= dt;
      if (G.bonus.life <= 0 && G.mode === 'classic') G.bonus = null;
    }
    if (G.nearPending) {
      G.nearPending.t -= dt;
      if (G.nearPending.t <= 0) { const n = G.nearPending, np = G.twist.nearPts || 50; G.nearPending = null; G.nearN++; addScore(np); pop(n.x, n.y, 'CLOSE ONE! +' + np, '#9fe8ff', 0.85); }
    }
    // the gate lifts while anyone passes through it
    const gateBusy = G.offs.some(o => o.st === 'leave' && o.y < 9.8 || o.st === 'enter');
    G.gateLift += ((gateBusy ? 1 : 0) - G.gateLift) * Math.min(1, dt * 10);
  }

  function updatePlayer(dt, sp) {
    const p = G.p;
    p.eatT += dt; p.squash *= Math.pow(0.0005, dt);
    p.chomp = p.eatT < 0.22 ? Math.abs(Math.sin(p.eatT / 0.22 * Math.PI)) : Math.max(0, p.chomp - dt * 6);
    const held = Input.held(); if (held != null) setBuffer(held, true);
    G.histT -= dt; if (G.histT <= 0) { G.histT = 0.25; G.hist.push([wx(p.x), Math.round(p.y)]); if (G.hist.length > 12) G.hist.shift(); }
    if (p.buf) {
      p.buf.age += dt * 1000;
      if ((p.buf.age > TUNE.bufferMs && p.buf.junc >= TUNE.bufferJunctions) || p.buf.age > TUNE.bufferMaxMs) p.buf = null;
    }
    const tx = wx(p.x), ty = Math.round(p.y);
    if (p.buf) {
      const b = p.buf.d;
      if (b === OPP[p.dir]) { // reversing is always instant
        if (p.moving || open(tx + DX[b], ty + DY[b])) { p.dir = b; p.moving = true; p.buf = null; p.atC = false; }
      } else if (b === p.dir) {
        if (!p.moving && open(tx + DX[b], ty + DY[b])) { p.moving = true; p.buf = null; }
      } else {
        // perpendicular: cornering assist - turn if we're within the window of this tile's center
        const along = DX[p.dir] !== 0 ? p.x : p.y, off = along - Math.round(along);
        if (Math.abs(off) <= TUNE.assist && open(tx + DX[b], ty + DY[b])) {
          if (DX[p.dir] !== 0) p.y = ty; else p.x = Math.round(p.x);
          turnPuff(p, b); p.dir = b; p.moving = true; p.buf = null; p.atC = true; p.squash = 0.6;
        }
      }
    }
    if (!p.moving) { eatAt(wx(p.x), Math.round(p.y), p); return; }
    let dist = sp.player * dt * (p.eatT < 0.12 ? 0.93 : 1) * (G.panicT > 0 ? 1.08 : 1); // sugar rush: a little faster
    if (G.panicT > 0) { G.trailT -= dt; if (G.trailT <= 0) { G.trailT = 0.03; G.trail.push({ x: p.x, y: p.y, t: 0 }); } }
    // pull the off-axis coordinate back to the lane (this is the corner cut)
    if (DX[p.dir] !== 0) { const c = Math.round(p.y), d = c - p.y; if (Math.abs(d) > 1e-6) p.y += Math.sign(d) * Math.min(Math.abs(d), dist); else p.y = c; }
    else { const c = Math.round(p.x), d = c - p.x; if (Math.abs(d) > 1e-6) p.x += Math.sign(d) * Math.min(Math.abs(d), dist); else p.x = c; }
    stepAlong(p, dist, playerCenter);
    eatAt(wx(p.x), Math.round(p.y), p);
  }
  function playerCenter(p) {
    const tx = wx(p.x), ty = Math.round(p.y);
    eatAt(tx, ty, p);
    if (p.buf && p.buf.d !== p.dir && open(tx + DX[p.buf.d], ty + DY[p.buf.d])) { turnPuff(p, p.buf.d); p.dir = p.buf.d; p.buf = null; p.squash = 0.6; return true; }
    if (p.buf && exits(tx, ty) >= 3) p.buf.junc++;
    if (!open(tx + DX[p.dir], ty + DY[p.dir])) { p.moving = false; p.squash = 0.4; return false; }
    return true;
  }
  // a little scuff of dust behind the raccoon on every turn
  function turnPuff(p, nd) {
    if (nd === OPP[p.dir]) return;
    for (let k = 0; k < 3; k++) {
      const a = G.rnd() * TAU, sp = 0.6 + G.rnd() * 0.8;
      G.fx.push({ x: p.x - DX[nd] * .3, y: p.y + .3 - DY[nd] * .3, vx: Math.cos(a) * sp - DX[nd] * 1.2, vy: Math.sin(a) * sp - 0.8, life: 0.32, t: 0, col: k % 2 ? 'rgba(230,214,255,.55)' : 'rgba(200,180,220,.45)', kind: 'dust', rot: 0, vr: 0, size: 0.13 + G.rnd() * 0.06 });
    }
  }
  function say(o, kind, force, delay) {
    const q = QUIPS[o.i][kind]; if (!q) return;
    if (kind === 'chase' || kind === 'near' || kind === 'doze') return; // chatter that covers the corridors was cut: bubbles only for panic, catches and tickets
    if (!force && G.bubbleCD > 0) return;
    if (!force && G.bubbles.length) return;
    if (kind === 'panic' && G.bubbles.length) return; // one speech bubble on the board at a time
    G.bubbles = G.bubbles.filter(b => false);
    const b = { i: o.i, text: q[Math.floor(G.rnd() * q.length)], t: -(delay || 0), life: kind === 'ticket' ? 1.6 : 1.35 };
    if (kind === 'caught' || kind === 'ticket') { b.x = o.x; b.y = o.y; b.below = kind === 'caught'; } // caught: under the score pop
    G.bubbles.push(b); G.bubbleCD = 2.4;
  }
  function eatAt(tx, ty, p) {
    if (ty < 0 || ty >= ROWS) return;
    // only when close to the tile's center along both axes
    if (Math.abs(wdx(p.x, tx)) > 0.45 || Math.abs(p.y - ty) > 0.45) return;
    const c = G.candy[ty][tx];
    if (c) {
      G.candy[ty][tx] = 0; G.candyLeft--; G.half[halfOf(tx)]--; G.eaten++; G.eatenTotal++; View.eraseCandy(tx, ty);
      p.eatT = 0;
      if (c === 1) {
        // munch streak (Rush/Daily): keep eating without a gap to build x2 / x3 / x4 on candy points
        if (G.mode === 'rush') {
          // "heat": +1 per candy, draining 4.5/s, so only long runs through fresh candy climb (x4 takes ~20 s of nonstop eating)
          G.streak = Math.min(90, G.streak + 1); G.streakT = 0;
          const m = G.streak >= 80 ? 4 : G.streak >= 45 ? 3 : G.streak >= 20 ? 2 : 1;
          if (m > G.mult) { pop(tx, ty - 0.9, 'x' + m + ' STREAK!', ['', '', '#ffd36b', '#ff9a5c', '#ff6fb8'][m], 0.8 + m * .08); A.sfx.streak(m); buzz(10); }
          G.mult = m; G.maxMult = Math.max(G.maxMult, m); HUD.mult();
        }
        addScore((G.mode === 'rush' ? 10 + G.speedLvl * 2 : 10) * (G.twist.candyMul || 1) * G.mult); A.sfx.munch(G.mult);
        if (G.rnd() < 0.3) burst(tx, ty, 1, ['#ffe9ae'], 'crumb');
      } else {
        addScore(60); startPanic(); burst(tx, ty, 16, ['#fffaf0', '#ffe2a8', '#e9b56a'], 'spark');
        G.flash = 0.22; G.flashCol = '#fff3d6'; buzz(25);
      }
      afterEat();
    }
    if (G.state === 'play' && G.bonus && Math.abs(wdx(p.x, G.bonus.x)) < 0.6 && Math.abs(p.y - G.bonus.y) < 0.6) eatBonus();
  }
  function afterEat() {
    if (G.mode === 'classic') {
      if ((G.eaten === 60 || G.eaten === 130) && !G.bonus) {
        const b = Art.BONUS[Math.min(G.level - 1, Art.BONUS.length - 1)];
        const cs = []; for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (G.grid[y][x] === 0 && x !== 9 && !(y >= 8 && y <= 12 && x >= 6 && x <= 12) && Math.abs(wdx(G.p.x, x)) + Math.abs(G.p.y - y) >= 7) cs.push([x, y]);
        const c = cs.length ? cs[Math.floor(G.rnd() * cs.length)] : [4, 13];
        G.bonus = { x: c[0], y: c[1], key: b.key, name: b.name, pts: b.pts, life: 11 };
        pop(c[0], c[1] - .8, b.name + '!', '#fff2a8', .8);
      }
      if (G.candyLeft <= 0) levelClear();
    } else {
      if (G.candyLeft <= 0) { boardClear(); return; }
      for (const h of [0, 1]) if (G.half[h] <= 6 && !G.bonus) spawnRushBonus(h); // nearly clear: no long hunt for strays
    }
  }
  function spawnRushBonus(clearedHalf) {
    const other = 1 - clearedHalf, cands = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (G.grid[y][x] !== 0 || halfOf(x) !== other || x === 9) continue;
      const d = Math.abs(wdx(G.p.x, x)) + Math.abs(G.p.y - y);
      if (d >= 6) cands.push([x, y]);
    }
    const c = cands.length ? cands[Math.floor(G.rnd() * cands.length)] : [other ? 14 : 4, 13];
    const b = Art.BONUS[Math.min(Math.floor(G.refills / 2), Art.BONUS.length - 1)];
    G.bonus = { x: c[0], y: c[1], key: b.key, name: b.name, pts: Math.min(5000, 500 + 250 * G.refills) * (G.twist.bonusMul || 1), life: 1e9, refill: clearedHalf, born: G.clock };
    pop(c[0], c[1] - 0.8, 'BONUS!', '#fff2a8', 0.9);
    toast((clearedHalf ? 'Right' : 'Left') + ' side nearly clear!', 'Grab the ' + b.name + ' to refill it');
    A.sfx.bonus();
  }
  function eatBonus() {
    const b = G.bonus; G.bonus = null;
    addScore(b.pts); pop(b.x, b.y, '+' + b.pts, '#fff2a8', 1.1); A.sfx.bonus(); burst(b.x, b.y, 14, ['#fff2a8', '#ffd36b', '#ffffff'], 'spark'); buzz(20);
    G.collected.push(b.key);
    if (G.mode === 'rush' && b.refill != null) {
      G.refills++; G.speedLvl++;
      refillHalf(b.refill); A.sfx.refill(); A.setTempo(1 + Math.min(0.5, G.speedLvl * 0.04));
      if (G.refills % 4 === 0) { startSwap('NEW STREET!'); return; }
      toast('Refill! Speed ' + (G.speedLvl + 1), 'The whole street just got faster');
      for (const h of [0, 1]) if (G.half[h] <= 6 && !G.bonus) spawnRushBonus(h); // nearly clear: no long hunt for strays
    }
  }
  function boardClear() {
    G.bonus = null;
    addScore(2000); pop(G.p.x, G.p.y - 1, 'BOARD CLEAR +2000', '#fff2a8', 1.2);
    G.speedLvl++; G.refills++;
    startSwap('BOARD CLEAR!');
  }
  function startSwap(text) {
    G.state = 'swap'; G.stateT = 1.5; G.banner = { text, sub: 'Next: ' + MAZES[(G.mazeIdx + 1) % MAZES.length].name, t: 0 }; A.sfx.clear();
    if (G.panicT > 0) endPanic();
  }
  function finishSwap() {
    loadMaze(G.mazeIdx + 1); resetActors(true); toReady(1.0, false); HUD.full();
  }

  function startPanic() {
    const sp = speeds();
    const wasPanic = G.panicT > 0;
    G.panicT = sp.panicTime; G.panicMax = sp.panicTime; G.panicCatches = 0;
    // SUGAR RUSH: shockwave, zoom punch, callout, and the officers react
    if (G.p) {
      G.sugar = { x: G.p.x, y: G.p.y, t: 0 }; G.punch = 0.32; G.trail = [];
      // callout away from the raccoon, so it never hides the lanes you're about to choose
      const act = G.offs.filter(o => o.st === 'active'); act.sort(() => G.rnd() - .5);
      act.slice(0, 2).forEach((o, k) => say(o, 'panic', true, 0.45 + k * 0.3)); // after the callout has landed
      if (tip('sugar', 'Sugar Rush!', 'Catch officers in a row: 250, 500, 1000...')) G.coachT = 4;
      G.bubbleCD = 2.5;
    }
    if (!wasPanic || G.mode === 'classic') G.chain = G.mode === 'rush' && wasPanic ? G.chain : 0;
    for (const o of G.offs) {
      if (o.st === 'active') { if (!o.panic) o.dir = OPP[o.dir]; o.panic = true; }
      else if (o.st === 'home' || o.st === 'leave') o.panic = true;
    }
    A.sfx.creemee(); if (settings.music) A.music('panic');
  }
  function endPanic() {
    G.panicT = 0; G.chain = 0;
    for (const o of G.offs) o.panic = false;
    if (settings.music && G.state === 'play') A.music('calm');
  }

  function updateOfficer(o, dt, sp) {
    o.bob += dt; if (o.quipCD > 0) o.quipCD -= dt;
    if (o.st === 'home') { o.y = 10.5 + Math.sin(o.bob * 5) * 0.18; return; }
    if (o.st === 'leave') {
      const v = 3.2 * dt;
      if (Math.abs(o.x - 9) > 1e-3) { o.x += Math.sign(9 - o.x) * Math.min(v, Math.abs(9 - o.x)); o.face = Math.sign(9 - o.x) || o.face; }
      else if (Math.abs(o.y - 10.5) > 0.02 && o.y > 10.5) { o.y -= Math.min(v, o.y - 10.5); }
      else { o.x = 9; o.y -= v; if (o.y <= 8) { o.y = 8; o.st = 'active'; o.dir = 0; o.atC = false; } }
      return;
    }
    if (o.st === 'enter') {
      const v = 7 * dt;
      if (o.y < 10.5) { o.y = Math.min(10.5, o.y + v); }
      else if (Math.abs(o.x - o.homeX) > 1e-3) { o.x += Math.sign(o.homeX - o.x) * Math.min(v, Math.abs(o.homeX - o.x)); }
      else { o.st = 'home'; o.release = 0.5; o.panic = false; }
      return;
    }
    let v;
    if (o.st === 'back') v = sp.ret;
    else if (inTunnel(o)) v = sp.tunnel;
    else if (o.panic) v = sp.panicOff;
    else v = sp.off;
    // Doug and Bolt idle a touch slower; Chalk gets a nudge when few candies remain (classic "hurry")
    if (o.st === 'active' && !o.panic) {
      if (o.i === 0 && G.mode === 'classic' && G.level > 1 && G.candyLeft < 25) v *= 1.06;
      if (G.mode === 'classic' && G.level === 1 && G.candyLeft <= 15) v *= 0.85; // level 1 home stretch is gentle
    }
    stepAlong(o, v * dt, officerCenter);
    if (DX[o.dir]) o.face = DX[o.dir];
  }
  function officerCenter(o) {
    const tx = wx(o.x), ty = Math.round(o.y);
    if (o.st === 'back') {
      if (tx === 9 && ty === 8) { o.x = 9; o.y = 8; o.st = 'enter'; return false; }
      o.target = { x: 9, y: 8 };
      let best = o.dir, bd = 1e9;   // follow the distance field downhill (reversing allowed)
      for (let d = 0; d < 4; d++) { const nx = (tx + DX[d] + COLS) % COLS, ny = ty + DY[d]; if (open(nx, ny) && G.homeDist[ny][nx] < bd) { bd = G.homeDist[ny][nx]; best = d; } }
      o.dir = best;
      return true;
    }
    if (o.panic) { o.dir = AI.panicDir(open, tx, ty, o.dir, G.rnd); o.target = null; return true; }
    const p = G.p, chief = G.offs[0];
    const px = wx(p.x), py = Math.round(p.y), ah = aheadJunction(px, py, p.dir), gd = guardSpot(px, py), tr = G.hist[0] || [px, py];
    const ctx = { px, py, pdir: p.dir, chiefX: wx(chief.x), chiefY: Math.round(chief.y), phase: phase(), aheadX: ah[0], aheadY: ah[1], guardX: gd && gd[0], guardY: gd && gd[1], trailX: tr[0], trailY: tr[1] };
    o.target = AI.targetFor(o.i, ctx, { tx, ty, corner: o.corner });
    if (o.i === 3 && ctx.phase === 'chase' && o.quipCD <= 0 && Math.hypot(px - tx, py - ty) > 8) { o.quipCD = 10; say(o, 'doze'); }
    o.dir = AI.chooseDir(open, tx, ty, o.dir, o.target);
    if (exits(tx, ty) >= 3) {
      G.log.push({ t: +G.clock.toFixed(2), i: o.i, phase: ctx.phase, at: [tx, ty], player: [ctx.px, ctx.py, ctx.pdir], chief: [ctx.chiefX, ctx.chiefY], ahead: ah, guard: gd, trail: [tr[0], tr[1]], target: [o.target.x, o.target.y], dir: o.dir });
      if (G.log.length > 400) G.log.shift();
    }
    return true;
  }

  function runStats(over) {
    return { mode: G.mode, daily: G.daily, over: !!over, score: G.score, caught: G.caughtN, panicBest: G.panicBest, sweeps: G.sweeps, maxMult: G.maxMult,
      level: G.level, near: G.nearN, treats: G.collected.length, speedLvl: G.speedLvl, cleanBest: G.cleanBest };
  }
  function checkGoals(over) {
    const list = goalsToday(), d = dayKey();
    if (goalSave.date !== d) { goalSave.date = d; goalSave.done = []; }
    const r = runStats(over);
    list.forEach(g => {
      if (goalSave.done.includes(g.id) || !g.test(r)) return;
      goalSave.done.push(g.id); store.set('goals', goalSave); G.goalsHit.push(g.text);
      if (!over) { toast('Goal done!', g.text); A.sfx.goal(); buzz([15, 30, 15]); }
    });
  }
  // first-run coaching: one short tip per situation, once ever
  function tip(id, text, sub) { if (tips[id]) return false; tips[id] = 1; store.set('tips', tips); toast(text, sub, 3200); return true; }
  function coach(dt) {
    G.coachT -= dt; if (G.coachPtr) { G.coachPtr.t -= dt; if (G.coachPtr.t <= 0 || !G.candy[G.coachPtr.y][G.coachPtr.x]) G.coachPtr = null; }
    if (G.coachT > 0 || tips.done) return;
    const p = G.p, px = wx(p.x), py = Math.round(p.y);
    if (!tips.creemee && G.panicT <= 0) {
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (G.candy[y][x] === 2 && Math.abs(x - px) + Math.abs(y - py) <= 6) {
        if (tip('creemee', 'Maple creemee!', 'Eat it and the officers panic: then chase them')) { G.coachPtr = { x, y, t: 4 }; G.coachT = 4; return; }
      }
    }
    if (!tips.officer && G.panicT <= 0 && G.offs.some(o => o.st === 'active' && !o.panic && Math.hypot(o.x - p.x, o.y - p.y) < 4)) {
      if (tip('officer', 'Officers write tickets!', 'Steer away: a touch costs you')) { G.coachT = 4; return; }
    }
    if (!tips.streak && G.mode === 'rush' && G.mult >= 2) { if (tip('streak', 'Munch streak!', 'Keep munching fresh candy to heat up: x2, x3, x4')) { G.coachT = 4; return; } }
    if (tips.creemee && tips.officer && tips.sugar && tips.streak) { tips.done = 1; store.set('tips', tips); }
  }
  // Tina: the next junction (3+ exits) along the raccoon's heading, up to 8 tiles out
  function aheadJunction(px, py, d) {
    let x = px, y = py;
    for (let k = 0; k < 8; k++) {
      const nx = wx(x + DX[d]), ny = y + DY[d]; if (!open(nx, ny)) break;
      x = nx; y = ny; if (exits(x, y) >= 3) break;
    }
    return [x, y];
  }
  // Bolt: the Rush treat if there is one, else the creemee nearest the raccoon
  function guardSpot(px, py) {
    if (G.bonus) return [G.bonus.x, G.bonus.y];
    let best = null, bd = 1e9;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (G.candy[y][x] === 2) { const d = Math.abs(wdx(x, px)) + Math.abs(y - py); if (d < bd) { bd = d; best = [x, y]; } }
    return best;
  }
  function collide() {
    const p = G.p;
    for (const o of G.offs) {
      if (o.st !== 'active') { o.lastD = 99; continue; }
      const d = Math.hypot(wdx(o.x, p.x), o.y - p.y);
      if (d < TUNE.hitR) {
        if (o.panic) { catchOfficer(o); continue; }
        if (p.shield > 0 || G.god) continue;
        die(o); return;
      }
      // near miss: arm when an officer gets close, pay out only once it is moving away again (you dodged it)
      if (!o.panic && p.shield <= 0 && d < 1.5) { o.nearMin = Math.min(o.nearArm ? o.nearMin : 9, d); o.nearArm = true; }
      if (o.nearArm && (o.panic || p.shield > 0 || d > 2.1)) o.nearArm = false;
      else if (o.nearArm && d > o.nearMin + .1 && d > o.lastD && G.nearCD <= 0 && !G.offs.some(q => q !== o && q.st === 'active' && !q.panic && Math.hypot(wdx(q.x, p.x), q.y - p.y) < 1.3)) {
        o.nearArm = false; G.nearCD = 3; G.slowmo = 0.3; A.sfx.nearMiss(); buzz(12);
        G.nearPending = { t: 0.35, x: p.x, y: p.y - 0.9 }; say(o, 'near', true);
      }
      o.lastD = d;
    }
  }
  function catchOfficer(o) {
    G.chain++; G.bestChain = Math.max(G.bestChain, G.chain); G.caughtN++; G.panicCatches++; G.panicBest = Math.max(G.panicBest, G.panicCatches);
    const pts = Math.min(G.mode === 'rush' ? 4000 : 2000, 250 * Math.pow(2, G.chain - 1)); // 250, 500, 1000, 2000 (Rush carries the chain on to 4000)
    addScore(pts);
    o.st = 'back'; o.panic = false; o.atC = false;
    pop(o.x, o.y - 0.4, String(pts), CHAIN_COL[Math.min(G.chain, CHAIN_COL.length) - 1], 1.0 + Math.min(0.7, G.chain * 0.15), true);
    G.hitPause = 0.22 + Math.min(0.2, G.chain * 0.05); G.flash = 0.08; G.flashCol = '#ffffff'; G.shake = 0.14 + Math.min(0.12, G.chain * 0.03);
    say(o, 'caught', true);
    if (G.panicCatches === 4) { // all four in one creemee
      G.sweeps++; addScore(3000); G.flashCol = '#ffd6f2'; G.flash = 0.18;
      G.pops.push({ x: 9, y: 5, text: 'CLEAN SWEEP! +3000', col: '#ffe28a', size: 1.15, t: -0.25, life: 1.6 });
      setTimeout(() => { if (G.screen === 'game' && !G.paused) A.sfx.life(); }, 250);
    }
    burst(o.x, o.y, 18, ['#fff7d6', '#ffffff', '#d63a3a', Art.OFF_STYLE[o.i].body], 'paper');
    A.sfx.catch(G.chain); A.sfx.honk(); buzz(30);
  }
  function die(o) {
    const p = G.p;
    G.pops = G.pops.filter(q => !/^CLOSE ONE/.test(q.text));
    G.ticketN++; G.state = 'dying'; G.stateT = G.mode === 'rush' ? 1.25 : 1.7; p.dead = 0.001; p.ticketBy = o.i;
    G.ticketBy[o.i]++; G.lastTicketBy = o.i; G.bubbles = []; say(o, 'ticket', true);
    G.cleanT = 0; G.streak = 0; G.mult = 1; HUD.mult();
    G.shake = 0.35; G.flash = 0.25; G.flashCol = '#ff6b6b'; G.panicT = 0; G.chain = 0; G.nearPending = null;
    for (const q of G.offs) { q.panic = false; q.nearArm = false; }
    A.music('off'); A.sfx.caught(); buzz([40, 40, 80]);
    burst(p.x, p.y, 12, ['#fff7d6', '#d63a3a'], 'paper');
  }
  function afterDeath() {
    if (G.mode === 'rush') {
      const pen = G.twist.penalty || TUNE.rushPenalty;
      G.time = Math.max(0, G.time - pen);
      if (G.time <= 0) { G.state = 'timeup'; G.stateT = 1.2; G.banner = { text: "TIME'S UP!", t: 0 }; return; }
      // keep the flow: stay where you are, officers back off, short shield, no READY
      const p = G.p; p.dead = 0; p.shield = 1.8; p.moving = true; p.buf = null; G.state = 'play'; G.forceScatter = 3.5;
      for (const o of G.offs) if (o.st === 'active') { o.dir = OPP[o.dir]; o.atC = false; }
      if (settings.music) A.music('calm');
      pop(G.p.x, G.p.y - 1.2, '-' + pen + 's', '#ff8a8a', 1.1);
    } else {
      G.lives--;
      if (G.lives <= 0) { gameOver(); return; }
      resetActors(false); toReady(1.4, false);
    }
    HUD.full();
  }
  function levelClear() {
    G.state = 'clear'; G.stateT = 2.0; G.banner = { text: 'STREET CLEARED!', sub: 'Level ' + (G.level + 1) + ': ' + MAZES[G.level % MAZES.length].name, t: 0 };
    A.music('off'); A.sfx.clear(); G.panicT = 0; G.chain = 0; G.bonus = null; buzz(40);
    for (const o of G.offs) o.panic = false;
  }
  function nextLevel() {
    G.level++; loadMaze(G.level - 1); resetActors(true); toReady(1.4, false); HUD.full();
  }
  function addScore(n) {
    G.score += n;
    if (G.mode === 'classic' && !G.extraGiven && G.score >= 12000) { G.extraGiven = true; G.lives++; A.sfx.life(); pop(G.p.x, G.p.y - 1.5, 'EXTRA LIFE!', '#7dff9a', 1); HUD.full(); }
    HUD.score();
  }

  let toastTimer = null;
  function toast(text, sub, ms) {
    const el = $('toast'); el.innerHTML = '<b>' + text + '</b>' + (sub ? '<small>' + sub + '</small>' : '');
    el.classList.remove('hidden'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 1900);
  }
  /* ---------- effects ---------- */
  function burst(x, y, n, cols, kind) {
    for (let k = 0; k < n; k++) {
      const a = G.rnd() * TAU, s = (kind === 'crumb' ? 1.2 : 3) + G.rnd() * (kind === 'crumb' ? 1.5 : 4);
      G.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (kind === 'paper' ? 2 : 0), life: kind === 'crumb' ? 0.3 : 0.7 + G.rnd() * 0.4, t: 0,
        col: cols[k % cols.length], kind, rot: G.rnd() * TAU, vr: (G.rnd() - .5) * 14, size: kind === 'paper' ? 0.22 : kind === 'spark' ? 0.12 : 0.08 });
    }
  }
  function pop(x, y, text, col, size, big) {
    // stack instead of overlapping when pops land in the same spot (chain catches)
    for (let k = 0; k < 3; k++) if (G.pops.some(q => q.t < .6 && Math.abs(q.x - x) < 2.5 && Math.abs(q.y - y) < 1.2)) y -= 1.2;
    G.pops.push({ x, y, text, col, size: size || 1, t: 0, life: big ? 1.1 : 0.95 });
  }
  function updateFx(dt) {
    for (const f of G.fx) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.kind === 'paper' ? 5 : 2) * dt; f.vx *= Math.pow(0.15, dt); f.rot += f.vr * dt; }
    G.fx = G.fx.filter(f => f.t < f.life);
    for (const q of G.pops) q.t += dt;
    for (const b of G.bubbles) b.t += dt;
    G.bubbles = G.bubbles.filter(b => b.t < b.life); if (G.bubbleCD > 0) G.bubbleCD -= dt;
    for (const q of G.trail) q.t += dt;
    G.trail = G.trail.filter(q => q.t < 0.22);
    if (G.sugar) { G.sugar.t += dt; if (G.sugar.t > 0.8) G.sugar = null; }
    if (G.punch > 0) G.punch -= dt;
    G.pops = G.pops.filter(q => q.t < q.life);
    if (G.flash > 0) G.flash -= dt; if (G.shake > 0) G.shake -= dt;
    if (G.banner) { G.banner.t += dt; if (G.banner.life && G.banner.t > G.banner.life) G.banner = null; }
  }

  /* ---------- game over / modes ---------- */
  function gameOver() {
    G.state = 'over'; A.music('off'); A.sfx.lose();
    checkGoals(true);
    let isBest;
    if (G.daily) {
      const d = dayKey();
      if (daily.date !== d) { daily.streak = daily.last === dayKey(-1) ? daily.streak + 1 : 1; daily.date = d; daily.best = 0; daily.plays = 0; }
      daily.last = d; daily.plays++;
      isBest = G.score > daily.best; if (isBest) daily.best = G.score;
      store.set('daily', daily);
    } else {
      isBest = G.score > best[G.mode];
      if (isBest) { best[G.mode] = G.score; store.set('best', best); }
    }
    Over.show(isBest);
  }
  function startMode(m) { A.unlock(); A.sfx.ui(); newGame(m); }
  const curMode = () => (G.daily ? 'daily' : G.mode);

  /* ---------- view ---------- */
  const View = {
    T: 20, dpr: 1, cv: null, c: null, cache: null, candyCv: null, mazeDirty: true, candyDirty: true, candySprite: null,
    init() { this.cv = $('board'); this.c = this.cv.getContext('2d'); },
    size(T) {
      this.T = T; this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      // the outer hedge ring is cropped to a thin frame so the maze can use the whole phone width
      const W = (COLS - 2 * CROP) * T, H = (ROWS - 2 * CROP) * T;
      this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
      this.cv.width = Math.round(W * this.dpr); this.cv.height = Math.round(H * this.dpr);
      this.mazeDirty = true;
    },
    build() {
      if (!G.maze) return;
      const T = this.T, d = this.dpr;
      this.cache = Art.renderMaze(G.maze, T, d, COLS, ROWS);
      this.candySprite = Art.makeCandy(T, d);
      this.candyCv = document.createElement('canvas'); this.candyCv.width = Math.round(COLS * T * d); this.candyCv.height = Math.round(ROWS * T * d);
      this.mazeDirty = false; this.candyDirty = true;
    },
    drawCandies() {
      const c = this.candyCv.getContext('2d'), T = this.T, d = this.dpr, s = this.candySprite;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.candyCv.width, this.candyCv.height);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (G.candy[y][x] === 1) c.drawImage(s, Math.round((x + .5) * T * d - s.width / 2), Math.round((y + .5) * T * d - s.height / 2));
      this.candyDirty = false;
    },
    eraseCandy(x, y) {
      if (!this.candyCv) return; const c = this.candyCv.getContext('2d'), T = this.T, d = this.dpr;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(Math.floor(x * T * d), Math.floor(y * T * d), Math.ceil(T * d) + 1, Math.ceil(T * d) + 1);
    },
    render(now) {
      if (!G.maze) return;
      if (this.mazeDirty) this.build();
      if (this.candyDirty) this.drawCandies();
      const c = this.c, T = this.T, d = this.dpr, W = COLS * T, H = ROWS * T, t = now / 1000;
      const ox = CROP * T, oy = CROP * T, VW = W - 2 * ox, VH = H - 2 * oy; // visible window into the full board
      c.setTransform(d, 0, 0, d, -ox * d, -oy * d); // everything below is in full-board tile coordinates
      c.clearRect(0, 0, W, H);
      c.save();
      if (G.shake > 0) { const m = G.shake * 14; c.translate((Math.random() - .5) * m, (Math.random() - .5) * m); }
      if (G.punch > 0 && G.p) { // creemee zoom punch, centred on the raccoon
        const k = G.punch / .32, z = 1 + .07 * k * k, cx = (G.p.x + .5) * T, cy = (G.p.y + .5) * T;
        c.translate(cx, cy); c.scale(z, z); c.translate(-cx, -cy);
      }
      c.drawImage(this.cache.bg, 0, 0, W, H);
      if (G.state === 'clear' || G.state === 'swap') { // walls flash white on a street clear
        const on = Math.floor(t * 8) % 2; c.globalAlpha = on ? .75 : 0; c.drawImage(this.cache.flash, 0, 0, W, H); c.globalAlpha = 1;
      }
      // a soft spotlight around the raccoon lifts the floor under it, so you always find yourself
      if (G.p && G.state !== 'over') {
        const sx = (G.p.x + .5) * T, sy = (G.p.y + .5) * T, sr = T * 3.4, sg = c.createRadialGradient(sx, sy, T * .4, sx, sy, sr);
        sg.addColorStop(0, 'rgba(255,244,205,.20)'); sg.addColorStop(1, 'rgba(255,244,205,0)');
        c.fillStyle = sg; c.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
      c.drawImage(this.candyCv, 0, 0, W, H);
      // the last few candies glow so they're easy to find
      const few = G.mode === 'classic' ? (G.candyLeft <= 12 ? -1 : null) : (G.half[0] <= 8 && G.half[0] > 0 ? 0 : G.half[1] <= 8 && G.half[1] > 0 ? 1 : null);
      if (few !== null && G.state === 'play') {
        const pr = .5 + .5 * Math.sin(t * 6);
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (G.candy[y][x] === 1 && (few < 0 || halfOf(x) === few)) {
          const cx = (x + .5) * T, cy = (y + .5) * T, r = T * (.4 + .12 * pr), g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(255,214,120,.4)'); g.addColorStop(1, 'rgba(255,170,60,0)'); c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
        c.restore();
      }
      // creemees
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (G.candy[y][x] === 2) Art.drawCreemee(c, (x + .5) * T, (y + .5) * T, T, t + x);
      if (G.coachPtr) { // first-run pointer at a creemee
        const q = G.coachPtr, bx = (q.x + .5) * T, by = (q.y + .5) * T - T * (1.1 + .25 * Math.abs(Math.sin(t * 6)));
        c.save(); c.fillStyle = '#fff3d6'; c.strokeStyle = '#2a1430'; c.lineWidth = 2; c.beginPath();
        c.moveTo(bx, by + T * .45); c.lineTo(bx - T * .4, by); c.lineTo(bx - T * .15, by); c.lineTo(bx - T * .15, by - T * .4); c.lineTo(bx + T * .15, by - T * .4); c.lineTo(bx + T * .15, by); c.lineTo(bx + T * .4, by); c.closePath(); c.fill(); c.stroke(); c.restore();
      }
      if (G.bonus) {
        const b = G.bonus, blink = G.mode === 'classic' && b.life < 2.5 && Math.floor(t * 8) % 2;
        if (!blink) Art.drawBonus(c, b.key, (b.x + .5) * T, (b.y + .5) * T, T * (1.45 + .1 * Math.sin(t * 6)), t);
        if (G.mode === 'rush') { const pr = (t * 1.2) % 1; c.strokeStyle = 'rgba(255,242,168,' + (1 - pr) * .7 + ')'; c.lineWidth = 2; c.beginPath(); c.arc((b.x + .5) * T, (b.y + .5) * T, T * (.5 + pr * 1.2), 0, TAU); c.stroke(); }
      }
      Art.drawGate(c, T, G.gateLift);
      // tunnel mouths fade into the side alleys
      for (const ty of G.maze.tunnels) {
        for (const side of [0, 1]) {
          const x0 = side ? W - ox - T * 1.6 : ox, gr = c.createLinearGradient(side ? W - ox : ox, 0, side ? W - ox - T * 1.6 : ox + T * 1.6, 0);
          gr.addColorStop(0, 'rgba(6,4,12,.8)'); gr.addColorStop(1, 'rgba(6,4,12,0)');
          c.fillStyle = gr; c.fillRect(x0, ty * T, T * 1.6, T);
        }
      }
      // actors (draw twice near the edges so tunnel crossings look continuous)
      const drawWrapped = (x, fn) => { fn(x); if (x < 1) fn(x + COLS); if (x > COLS - 2) fn(x - COLS); };
      const sorted = G.offs.slice().sort((a, b) => a.y - b.y);
      const panicLeft = G.panicT;
      for (const o of sorted) {
        let state = 'normal';
        if (o.st === 'back' || o.st === 'enter') state = 'caught';
        else if (o.panic) state = panicLeft < 1.8 ? 'flash' : 'panic';
        if (o.st === 'active' || o.st === 'leave') { // a flat pool of the officer's own colour: threats read as colour blobs
          const gx = (fx(o.x) + .5) * T, gy = (o.y + .5) * T, gr0 = c.createRadialGradient(gx, gy, 0, gx, gy, T * 1.05);
          const gc = Art.OFF_STYLE[o.i].body; // frightened officers stay identifiable by their colour pool
          gr0.addColorStop(0, Art.hexA(gc, .55)); gr0.addColorStop(1, Art.hexA(gc, 0));
          c.fillStyle = gr0; c.beginPath(); c.arc(gx, gy, T * 1.05, 0, TAU); c.fill();
        }
        if (o.st === 'active' && !o.panic) { // short headlight beam shows which way they're driving
          const hx = (o.x + .5) * T, hy = (o.y + .5) * T, dx = DX[o.dir], dy = DY[o.dir], L = T * 1.5, Wd = T * .4;
          const gr = c.createLinearGradient(hx, hy, hx + dx * L, hy + dy * L);
          const col = Art.OFF_STYLE[o.i].body;
          gr.addColorStop(0, Art.hexA('#fff4c0', .5)); gr.addColorStop(.45, Art.hexA('#fff4c0', .18)); gr.addColorStop(1, Art.hexA(col, 0));
          c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = gr; c.beginPath();
          c.moveTo(hx + dx * T * .3 - dy * T * .12, hy + dy * T * .3 + dx * T * .12);
          c.lineTo(hx + dx * L - dy * Wd, hy + dy * L + dx * Wd); c.lineTo(hx + dx * L + dy * Wd, hy + dy * L - dx * Wd);
          c.lineTo(hx + dx * T * .3 + dy * T * .12, hy + dy * T * .3 - dx * T * .12); c.closePath(); c.fill(); c.restore();
        }
        const look = o.target && o.st === 'active' && !o.panic ? { x: Math.sign(o.target.x - o.x) * .8, y: Math.sign(o.target.y - o.y) * .8 } : { x: DX[o.dir], y: DY[o.dir] };
        drawWrapped(o.x, x => Art.drawOfficer(c, (x + .5) * T, (o.y + .5) * T - T * .12, T, o.i, { dir: o.dir, face: o.face, t: t + o.i, state, lookX: look.x, lookY: look.y, scale: 1.18 }));
      }
      const p = G.p;
      const drawMarker = (x) => { // bright ring + facing arrow: the raccoon is always the easiest thing on the board to find
        if (p.dead > 0) return;
        const cx = (x + .5) * T, cy = (p.y + .5) * T, R = T * .78, blink = p.shield > 0 && Math.floor(t * 12) % 2;
        c.save(); c.globalAlpha = blink ? .4 : 1;
        c.fillStyle = 'rgba(255,246,214,.22)'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
        c.lineWidth = Math.max(2, T * .09); c.strokeStyle = G.panicT > 0 ? '#ffd0f0' : '#fff6c8'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
        const ax = cx + DX[p.dir] * R, ay = cy + DY[p.dir] * R; // pointer on the ring, facing the way you're heading
        c.translate(ax, ay); c.rotate([-Math.PI / 2, Math.PI, Math.PI / 2, 0][p.dir]); c.fillStyle = '#ffffff'; c.strokeStyle = '#1a0f26'; c.lineWidth = 2; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(T * .42, 0); c.lineTo(-T * .14, -T * .34); c.lineTo(-T * .14, T * .34); c.closePath(); c.stroke(); c.fill();
        c.restore();
      };
      const drawRac = () => drawWrapped(p.x, x => { drawMarker(x); Art.drawRaccoon(c, (x + .5) * T, (p.y + .5) * T - T * .06, T, { scale: 1.3, dir: p.dir, t, chomp: p.chomp, squash: p.squash, moving: p.moving && G.state === 'play', shield: p.shield > 0, dying: p.dead > 0 ? Math.min(1, p.dead * 1.1) : 0, ticket: p.dead > 0.05 }); });
      if (p && G.state !== 'over') { // raccoon crossing a side tunnel: keep a marker on the screen edge while it is out of sight
        const sx = (fx(p.x) + .5) * T, sy = (p.y + .5) * T;
        for (const side of [-1, 1]) {
          const edge = side < 0 ? ox : W - ox, out = side < 0 ? edge + T * .3 - sx : sx - (edge - T * .3);
          if (out > 0) { c.save(); c.globalAlpha = Math.min(1, out / (T * .5)); c.translate(edge - side * T * .35, sy); c.scale(side, 1); c.fillStyle = '#fff'; c.strokeStyle = '#1a0f26'; c.lineWidth = 2;
            c.beginPath(); c.moveTo(T * .32, 0); c.lineTo(-T * .12, -T * .3); c.lineTo(-T * .12, T * .3); c.closePath(); c.stroke(); c.fill(); c.restore(); }
        }
      }
      if (G.sugar) { // creemee shockwave rings
        for (const lag of [0, .12]) {
          const k = Math.max(0, Math.min(1, (G.sugar.t - lag) / .45)); if (k <= 0 || k >= 1) continue;
          const e = 1 - Math.pow(1 - k, 3), cx = (G.sugar.x + .5) * T, cy = (G.sugar.y + .5) * T;
          c.strokeStyle = lag ? 'rgba(255,240,210,' + (1 - k) * .4 + ')' : 'rgba(255,138,216,' + (1 - k) * .5 + ')';
          c.lineWidth = T * .45 * (1 - k) + 1; c.beginPath(); c.arc(cx, cy, T * (.6 + 9 * e), 0, TAU); c.stroke();
        }
      }
      if (p && G.panicT > 0 && G.state === 'play') { // sugar-rush glow + speed trail
        c.save(); c.globalCompositeOperation = 'lighter';
        for (const q of G.trail) { const k = 1 - q.t / .22; c.fillStyle = 'rgba(255,140,215,' + .32 * k + ')'; c.beginPath(); c.arc((fx(q.x) + .5) * T, (q.y + .5) * T, T * (.2 + .28 * k), 0, TAU); c.fill(); }
        const pr = .5 + .5 * Math.sin(t * 14), r = T * (1 + .18 * pr), cx = (p.x + .5) * T, cy = (p.y + .5) * T;
        const g = c.createRadialGradient(cx, cy, T * .2, cx, cy, r);
        g.addColorStop(0, 'rgba(255,190,235,.5)'); g.addColorStop(1, 'rgba(255,120,200,0)'); c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.restore();
      }
      if (p) {
        drawRac();
        // stopped: pulsing arrows show which ways are open
        if (!p.moving && G.state === 'play') {
          const tx = wx(p.x), ty = Math.round(p.y), a = .45 + .4 * Math.abs(Math.sin(t * 5));
          for (let d = 0; d < 4; d++) if (open(tx + DX[d], ty + DY[d])) {
            c.save(); c.translate((p.x + .5 + DX[d] * .95) * T, (p.y + .5 + DY[d] * .95) * T); c.rotate([-Math.PI / 2, Math.PI, Math.PI / 2, 0][d]); c.globalAlpha = a * .8;
            c.strokeStyle = '#fff6c8'; c.lineWidth = Math.max(1.5, T * .08); c.lineCap = 'round'; c.beginPath(); c.moveTo(-T * .08, -T * .2); c.lineTo(T * .12, 0); c.lineTo(-T * .08, T * .2); c.stroke(); c.restore();
          }
        }
        // buffered-turn hint: a little chevron where the next turn will happen
        if (p.buf && G.state === 'play' && p.buf.d !== p.dir) {
          const a = .55 + .35 * Math.sin(t * 20), hx = (p.x + .5 + DX[p.buf.d] * .85) * T, hy = (p.y + .5 + DY[p.buf.d] * .85) * T;
          c.save(); c.translate(hx, hy); c.rotate([-Math.PI / 2, Math.PI, Math.PI / 2, 0][p.buf.d]); c.globalAlpha = a;
          c.fillStyle = '#fff6c8'; c.beginPath(); c.moveTo(T * .22, 0); c.lineTo(-T * .1, -T * .2); c.lineTo(-T * .1, T * .2); c.closePath(); c.fill(); c.restore();
        }
      }
      // particles
      for (const f of G.fx) {
        const k = 1 - f.t / f.life; c.globalAlpha = Math.min(1, k * 1.6);
        c.fillStyle = f.col;
        if (f.kind === 'paper') { c.save(); c.translate((f.x + .5) * T, (f.y + .5) * T); c.rotate(f.rot); c.fillRect(-f.size * T / 2, -f.size * T * .35, f.size * T, f.size * T * .7); c.restore(); }
        else { c.beginPath(); c.arc((f.x + .5) * T, (f.y + .5) * T, f.size * T * (f.kind === 'spark' ? k : 1), 0, TAU); c.fill(); }
      }
      c.globalAlpha = 1;
      // score pop-ups
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const q of G.pops) {
        if (q.t < 0) continue;
        const k = q.t / q.life, sc = q.t < .12 ? .6 + q.t / .12 * .55 : 1.15 - Math.min(.15, (q.t - .12) * .6);
        c.globalAlpha = k > .7 ? (1 - k) / .3 : 1;
        c.font = '400 ' + Math.round(T * .66 * q.size * sc) + 'px Bungee, Impact, sans-serif';
        let hw = c.measureText(q.text).width / 2 + 4, px = Math.min(W - ox - hw, Math.max(ox + hw, (q.x + .5) * T)), py = Math.min(H - oy - T * .8, Math.max(oy + T * .6, (q.y + .5) * T - k * T * 1.2));
        if (p) { const rx = (fx(p.x) + .5) * T, ry = (p.y + .5) * T; // never sit on the raccoon: slide to the roomier side
          if (Math.abs(px - rx) < hw + T * .7 && Math.abs(py - ry) < T * 1.1) { const dn = ry + T * 1.5, up = ry - T * 1.5; py = dn < H - oy - T * .8 && (up < oy + T * .6 || ry < H / 2) ? dn : up; py = Math.min(H - oy - T * .8, Math.max(oy + T * .6, py)); } }
        c.lineWidth = Math.max(3, T * .2); c.strokeStyle = 'rgba(20,8,24,.9)'; c.strokeText(q.text, px, py);
        c.fillStyle = q.col; c.fillText(q.text, px, py);
      }
      c.globalAlpha = 1;
      // officer speech bubbles
      for (const b of G.bubbles) {
        if (b.t < 0) continue;
        const o = G.offs[b.i]; const bx = b.x != null ? b.x : o.x, by = b.y != null ? b.y : o.y;
        const kIn = Math.min(1, b.t / .14), kOut = Math.min(1, (b.life - b.t) / .25), sc = .55 + .45 * (1 - Math.pow(1 - kIn, 3)) + (b.t < .25 ? Math.sin(b.t / .25 * Math.PI) * .08 : 0);
        const fs = Math.max(10, Math.round(T * .46));
        c.font = '800 ' + fs + 'px Rubik, sans-serif';
        const tw = c.measureText(b.text).width, bw = tw + fs * .9, bh = fs * 1.55;
        let cx = Math.min(W - ox - bw / 2 - 2, Math.max(ox + bw / 2 + 2, (fx(bx) + .5) * T)), cy = (by + .5) * T - T * 1.25;
        let below = b.below || cy - bh / 2 < oy + 2; if (below) cy = Math.min(H - oy - bh / 2 - 2, (by + .5) * T + T * 1.25);
        if (p) { const rx = (fx(p.x) + .5) * T, ry = (p.y + .5) * T; // don't cover the raccoon: flip to the other side
          if (Math.abs(cx - rx) < bw / 2 + T * .5 && Math.abs(cy - ry) < bh / 2 + T * .5) { below = !below; cy = below ? Math.min(H - oy - bh / 2 - 2, (by + .5) * T + T * 1.25) : Math.max(oy + bh / 2 + 2, (by + .5) * T - T * 1.25); } }
        c.save(); c.globalAlpha = kOut; c.translate(cx, cy); c.scale(sc, sc);
        c.fillStyle = '#fffaf0'; c.strokeStyle = Art.OFF_STYLE[b.i].body; c.lineWidth = 2;
        c.beginPath(); if (c.roundRect) c.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); else c.rect(-bw / 2, -bh / 2, bw, bh); c.fill(); c.stroke();
        const ax = Math.max(-bw / 2 + 8, Math.min(bw / 2 - 8, (fx(bx) + .5) * T - cx)), ay = below ? -bh / 2 : bh / 2, dir = below ? -1 : 1;
        c.beginPath(); c.moveTo(ax - 4, ay - dir); c.lineTo(ax, ay + dir * 6); c.lineTo(ax + 4, ay - dir); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(ax - 4, ay); c.lineTo(ax, ay + dir * 6); c.lineTo(ax + 4, ay); c.stroke();
        c.fillStyle = '#2a1430'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.text, 0, fs * .04);
        c.restore();
      }
      if (p && (G.pops.length || G.bubbles.length)) drawRac(); // nothing is ever drawn over the raccoon
      // chain counter
      if (G.chain >= 2 && G.panicT > 0) {
        const s = 1 + Math.min(.6, G.chain * .12);
        c.font = '400 ' + Math.round(T * .62 * s) + 'px Bungee, Impact, sans-serif';
        c.lineWidth = 4; c.strokeStyle = 'rgba(20,8,24,.9)'; const cyc = p && p.y < ROWS / 2 ? H - oy - T * 1.1 : oy + T * 1.1; c.strokeText('CHAIN x' + G.chain, W / 2, cyc);
        c.fillStyle = '#ff8ad8'; c.fillText('CHAIN x' + G.chain, W / 2, cyc);
      }
      c.restore();
      // slow-mo vignette
      if (G.slowmo > 0) {
        const k = Math.min(1, G.slowmo / .15);
        const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.max(W, H) * .7);
        vg.addColorStop(0, 'rgba(60,140,255,0)'); vg.addColorStop(1, 'rgba(40,90,200,' + .45 * k + ')'); c.fillStyle = vg; c.fillRect(0, 0, W, H);
      }
      if (G.panicT > 0) { // melting creemee timer: a thin pink bar along the bottom frame
        const f = Math.max(0, G.panicT / G.panicMax), bw = VW * .7, bx = ox + (VW - bw) / 2, bh = Math.max(5, T * .26), by = H - oy - bh / 2 - 1.5;
        const blink = G.panicT < 1.8 && Math.floor(t * 8) % 2;
        c.fillStyle = 'rgba(12,6,20,.9)'; c.beginPath(); if (c.roundRect) c.roundRect(bx - 2, by - bh / 2 - 2, bw + 4, bh + 4, bh); else c.rect(bx - 2, by - bh / 2 - 2, bw + 4, bh + 4); c.fill();
        const gr = c.createLinearGradient(bx, 0, bx + bw, 0); gr.addColorStop(0, '#ff8ad8'); gr.addColorStop(1, '#fff0c8');
        c.fillStyle = blink ? '#ffffff' : gr; c.beginPath(); if (c.roundRect) c.roundRect(bx, by - bh / 2, Math.max(bh, bw * f), bh, bh / 2); else c.rect(bx, by - bh / 2, bw * f, bh); c.fill();
      }
      if (G.flash > 0) { const fk = Math.min(1, G.flash / .2); c.globalAlpha = fk * .08; c.fillStyle = G.flashCol; c.fillRect(0, 0, W, H); c.globalAlpha = fk * .9; c.strokeStyle = G.flashCol; c.lineWidth = T * .5; c.strokeRect(ox, oy, VW, VH); c.globalAlpha = 1; }
      // banners
      const bn = G.banner;
      if (bn) {
        const k = Math.min(1, bn.t / .18), e = 1 - Math.pow(1 - k, 3), sc = .7 + .3 * e + (bn.t < .3 ? Math.sin(bn.t / .3 * Math.PI) * .08 : 0);
        c.save(); c.translate(W / 2, H * .5); c.scale(sc, sc); c.globalAlpha = e; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = 'rgba(14,6,22,.55)'; const bw = VW * .94, bh = bn.sub ? T * 2.8 : T * 1.8;
        if (c.roundRect) { c.beginPath(); c.roundRect(-bw / 2, -bh / 2, bw, bh, T * .6); c.fill(); } else c.fillRect(-bw / 2, -bh / 2, bw, bh);
        let fs = T * 1.25; c.font = '400 ' + Math.round(fs) + 'px Bungee, Impact, sans-serif';
        while (c.measureText(bn.text).width > bw * .9 && fs > 8) { fs -= 1; c.font = '400 ' + Math.round(fs) + 'px Bungee, Impact, sans-serif'; }
        c.shadowColor = '#ff5fa8'; c.shadowBlur = T * .6; c.fillStyle = '#fff4d6';
        c.fillText(bn.text, 0, bn.sub ? -T * .45 : 0);
        c.shadowBlur = 0;
        if (bn.sub) { c.font = '700 ' + Math.round(T * .62) + 'px Rubik, sans-serif'; c.fillStyle = '#ffd98a'; c.fillText(bn.sub, 0, T * .75); }
        c.restore();
      }
    },
  };

  /* ---------- skyline header (fills spare height on tall phones) ---------- */
  const Sky = {
    dirty: true, shown: false,
    draw() {
      if (!this.shown || !G.maze) return;
      const cv = $('skyCv'), d = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      cv.width = Math.round(w * d); cv.height = Math.round(h * d);
      const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); this.dirty = false;
      const R = mulberry(31 + G.mazeIdx * 7);
      // sky, rounded card
      c.save(); c.beginPath(); if (c.roundRect) c.roundRect(0, 0, w, h, 14); else c.rect(0, 0, w, h); c.clip();
      const art = Art.ASSETS.skyline; // painted backdrop, if one has been dropped in
      if (art && art.img) { const k = Math.max(w / art.img.width, h / art.img.height); c.drawImage(art.img, (w - art.img.width * k) / 2, h - art.img.height * k, art.img.width * k, art.img.height * k); }
      const sg = c.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, '#120a24'); sg.addColorStop(.6, '#2a1640'); sg.addColorStop(1, '#43203e'); c.fillStyle = sg;
      if (!(art && art.img)) { c.fillRect(0, 0, w, h);
      for (let k = 0; k < 40; k++) { const x = R() * w, y = R() * h * .55, r = R() * 1.1 + .3; c.fillStyle = 'rgba(255,245,220,' + (.3 + R() * .6) + ')'; c.fillRect(x, y, r, r); }
      const mx = w * (.78 + .1 * (G.mazeIdx % 2)), my = h * .28, mr = Math.max(7, h * .13);
      const mg = c.createRadialGradient(mx, my, mr * .6, mx, my, mr * 3.2); mg.addColorStop(0, 'rgba(255,236,200,.35)'); mg.addColorStop(1, 'rgba(255,236,200,0)'); c.fillStyle = mg; c.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
      c.fillStyle = '#fff1d0'; c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
      c.fillStyle = 'rgba(200,180,150,.35)'; c.beginPath(); c.arc(mx - mr * .3, my - mr * .1, mr * .22, 0, TAU); c.arc(mx + mr * .25, my + mr * .3, mr * .15, 0, TAU); c.fill();
      // far mountains across the lake (one double-humped peak)
      const hz = h * .62;
      c.fillStyle = '#3d2f6c'; c.beginPath(); c.moveTo(0, hz);
      const peaks = [[0, .78], [.12, .66], [.22, .5], [.3, .38], [.34, .44], [.38, .33], [.47, .58], [.6, .52], [.72, .64], [.86, .56], [1, .7]];
      for (const [px, py] of peaks) c.lineTo(px * w, py * h);
      c.lineTo(w, hz); c.closePath(); c.fill();
      // lake with the moon's reflection
      const lg = c.createLinearGradient(0, hz, 0, h * .78); lg.addColorStop(0, '#1d2a52'); lg.addColorStop(1, '#141a36'); c.fillStyle = lg; c.fillRect(0, hz, w, h * .2);
      c.strokeStyle = 'rgba(255,236,200,.45)'; c.lineWidth = 1.2;
      for (let k = 0; k < 5; k++) { const y = hz + 3 + k * 3, hw = mr * (1.2 - k * .18); c.beginPath(); c.moveTo(mx - hw, y); c.lineTo(mx + hw, y); c.stroke(); }
      // rooftops + a steeple, lit windows
      const base = h; let x = -4;
      c.fillStyle = '#1c0f22';
      const roofs = [];
      while (x < w) { const bw = 26 + R() * 34, bh = h * (.18 + R() * .16); roofs.push([x, base - bh, bw, bh]); x += bw - 1; }
      const sx = w * (.16 + .5 * ((G.mazeIdx * 37) % 10) / 10);
      for (const [rx, ry, rw, rh] of roofs) { c.fillRect(rx, ry, rw, rh + 1); }
      c.beginPath(); c.moveTo(sx - 9, base - h * .3); c.lineTo(sx - 9, base - h * .5); c.lineTo(sx, base - h * .82); c.lineTo(sx + 9, base - h * .5); c.lineTo(sx + 9, base - h * .3); c.closePath(); c.fill();
      c.fillRect(sx - 14, base - h * .32, 28, h * .32);
      c.fillStyle = '#ffcf7a'; c.fillRect(sx - 2, base - h * .45, 4, 6);
      for (const [rx, ry, rw] of roofs) for (let wx2 = rx + 5; wx2 < rx + rw - 6; wx2 += 9) for (let wy = ry + 5; wy < base - 4; wy += 9) if (R() < .32) { c.fillStyle = R() < .5 ? 'rgba(255,200,110,.85)' : 'rgba(255,170,90,.6)'; c.fillRect(wx2, wy, 4, 5); }
      // string lights across the top of the street
      const cols = ['#ffd36b', '#ff8ad8', '#8fe6ff', '#9dff9a'];
      for (let row = 0; row < 2; row++) {
        const y0 = h * (.08 + row * .12), sag = h * (.2 + row * .06);
        c.strokeStyle = 'rgba(20,10,20,.8)'; c.lineWidth = 1; c.beginPath();
        for (let k = 0; k <= 40; k++) { const u = k / 40, yy = y0 + sag * 4 * u * (1 - u); if (k) c.lineTo(u * w, yy); else c.moveTo(0, yy); } c.stroke();
        for (let k = 1; k < 18; k++) { const u = (k + row * .5) / 18, yy = y0 + sag * 4 * u * (1 - u) + 3, col = cols[(k + row) % 4];
          const g = c.createRadialGradient(u * w, yy, 0, u * w, yy, 7); g.addColorStop(0, Art.hexA(col, .7)); g.addColorStop(1, Art.hexA(col, 0)); c.fillStyle = g; c.fillRect(u * w - 7, yy - 7, 14, 14);
          c.fillStyle = col; c.beginPath(); c.arc(u * w, yy, 1.8, 0, TAU); c.fill(); }
      }
      } // end of the code-drawn backdrop
      // the street sign
      const name = G.maze.name.toUpperCase(); let fs = Math.max(12, Math.min(20, h * .19));
      c.font = '400 ' + fs + 'px Bungee, Impact, sans-serif'; const tw = c.measureText(name).width, pw = tw + fs * 1.4, ph = fs * 1.7, px = (w - pw) / 2, py = h * .3;
      c.strokeStyle = 'rgba(20,10,20,.9)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(px + 10, py); c.lineTo(px + 14, h * .14); c.moveTo(px + pw - 10, py); c.lineTo(px + pw - 14, h * .14); c.stroke();
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); if (c.roundRect) c.roundRect(px + 2, py + 3, pw, ph, 6); else c.rect(px + 2, py + 3, pw, ph); c.fill();
      c.fillStyle = '#1f7a4c'; c.beginPath(); if (c.roundRect) c.roundRect(px, py, pw, ph, 6); else c.rect(px, py, pw, ph); c.fill();
      c.strokeStyle = '#eafff4'; c.lineWidth = 1.6; c.beginPath(); if (c.roundRect) c.roundRect(px + 3, py + 3, pw - 6, ph - 6, 4); else c.rect(px + 3, py + 3, pw - 6, ph - 6); c.stroke();
      c.fillStyle = '#f4fff8'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, w / 2, py + ph / 2 + 1);
      c.restore();
    },
  };

  /* ---------- officer roster (who's doing what, with their faces) ---------- */
  const Roster = {
    shown: false, built: false, last: [], t: 0,
    build() {
      const el = $('roster'); el.innerHTML = '';
      AI.OFFICERS.forEach((o, i) => { const d = document.createElement('div'); d.className = 'ro'; d.innerHTML = '<canvas width="64" height="64"></canvas><div><b>' + ['Chalk', 'Tina', 'Bolt', 'Doug'][i] + '</b><span></span></div>'; d.title = o.name; el.appendChild(d); });
      this.built = true; this.last = [];
    },
    status(o) {
      if (o.st === 'back' || o.st === 'enter') return ['towed', 'Towed!', 'caught'];
      if (o.st === 'home') return ['home', 'Office', 'normal'];
      if (o.st === 'leave') return ['home', 'Out!', 'normal'];
      if (o.panic) return ['panic', 'Panic!', 'panic'];
      if (o.i === 2 && phase() === 'chase' && o.target && G.p && Math.hypot(o.target.x - G.p.x, o.target.y - G.p.y) > 2.5) return ['doze', 'Guarding', 'normal'];
      if (o.i === 3 && phase() === 'chase') return ['doze', 'Trailing', 'normal'];
      return phase() === 'chase' ? ['chase', 'Chasing', 'normal'] : ['scatter', 'Patrol', 'normal'];
    },
    update(dt, force) {
      if (!this.shown || !G.offs.length) return;
      if (!this.built) this.build();
      this.t -= dt; if (this.t > 0 && !force) return; this.t = .12;
      const cells = $('roster').children;
      G.offs.forEach((o, i) => {
        const [cls, txt, look] = this.status(o), key = cls + txt + look;
        if (this.last[i] === key && !force) return; this.last[i] = key;
        const cell = cells[i]; cell.className = 'ro s-' + cls; cell.querySelector('span').textContent = txt;
        const cv = cell.querySelector('canvas'), c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 64, 64);
        Art.drawOfficer(c, 32, look === 'caught' ? 36 : 34, look === 'caught' ? 34 : 40, i, { dir: 3, face: 1, t: i, lookX: 1, state: look });
      });
    },
  };

  /* ---------- HUD (DOM) ---------- */
  const HUD = {
    last: {},
    set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } },
    score() {
      const t = G.score.toLocaleString(); this.set('score', t);
      $('score').style.fontSize = t.length > 7 ? '17px' : t.length > 6 ? '19px' : '';
      this.set('best', Math.max(G.daily ? dailyBest() : best[G.mode], G.score).toLocaleString());
    },
    mult() {
      const el = $('mult'), m = G.mult > 1 ? 'x' + G.mult : '';
      if (el.textContent !== m) { el.textContent = m; el.className = 'm' + G.mult; if (m) { void el.offsetWidth; el.classList.add('bump'); } }
    },
    lifeIcon() {
      if (this.lifeUrl) return this.lifeUrl;
      const c = document.createElement('canvas'); c.width = c.height = 56; const x = c.getContext('2d');
      Art.drawRaccoon(x, 28, 30, 30, { dir: 2, t: 0, moving: false }); this.lifeUrl = c.toDataURL(); return this.lifeUrl;
    },
    full() {
      this.score();
      $('hudMode').textContent = G.daily ? 'DAILY' : G.mode === 'rush' ? 'RUSH' : 'LEVEL ' + G.level;
      $('timerBox').classList.toggle('hidden', G.mode !== 'rush');
      $('livesBox').classList.toggle('hidden', G.mode !== 'classic');
      if (G.mode === 'classic') {
        const lv = $('lives'); lv.innerHTML = '';
        for (let k = 0; k < Math.max(0, G.lives - (G.state === 'play' || G.state === 'ready' ? 1 : 0)); k++) { const i = document.createElement('i'); i.style.backgroundImage = 'url(' + this.lifeIcon() + ')'; lv.appendChild(i); }
      }
      this.strip(true); this.mult();
      Roster.update(0, true); if (Sky.dirty) Sky.draw();
    },
    frame() {
      if (G.mode === 'rush') {
        const s = Math.max(0, Math.ceil(G.time)); const txt = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        this.set('timer', txt); $('timerBox').classList.toggle('low', G.time <= 10 && G.screen === 'game');
      }
      this.strip(false);
      Roster.update(1 / 60, false);
    },
    strip(force) {
      const el = $('strip'); if (!G.maze) return;
      const tot = [0, 0]; for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (G.maze.candy[y][x]) tot[halfOf(x)]++;
      const pct = h => Math.round(100 * (1 - G.half[h] / tot[h])) + '%';
      if (G.mode === 'rush' && !force) { // cheap path: just slide the bars
        const bs = el.querySelectorAll('.half b');
        if (bs.length === 2) { bs[0].style.width = pct(0); bs[1].style.width = pct(1); }
        if (this.last.stripSpeed === G.speedLvl && this.last.stripMaze === G.mazeIdx) return;
      }
      if (G.mode === 'classic' && !force) {
        const key = G.candyLeft + '/' + G.collected.length;
        if (key === this.last.stripC) return; this.last.stripC = key;
      }
      this.last.stripSpeed = G.speedLvl; this.last.stripMaze = G.mazeIdx;
      if (G.mode === 'rush') {
        const bar = h => '<span class="half"><b style="width:' + pct(h) + '"></b></span>';
        el.innerHTML = '<div class="sl"><span class="lbl">Left</span>' + bar(0) + '<span class="lbl">Right</span>' + bar(1) + '</div>' +
          '<div class="sl"><span class="lbl">Speed</span><span class="pips">' + Array.from({ length: 8 }, (_, k) => '<i class="' + (k <= G.speedLvl ? 'on' : '') + '"></i>').join('') + '</span><span class="street">' + G.maze.name + '</span></div>';
      } else {
        el.innerHTML = '<div class="sl"><span class="street">' + G.maze.name + '</span><span class="got">' + G.collected.slice(-7).map(k => '<i class="b-' + k + '"></i>').join('') + '</span></div>' +
          '<div class="sl dim">Candies left: ' + G.candyLeft + '</div>';
      }
    },
  };

  /* ---------- screens & overlays ---------- */
  function showScreen(s) {
    G.screen = s;
    $('title').classList.toggle('hidden', s !== 'title');
    $('game').classList.toggle('hidden', s !== 'game' && s !== 'over');
    $('over').classList.toggle('hidden', s !== 'over');
    if (s === 'title') { Parade.on = true; A.setKey(0); A.setIntensity(2); A.music(settings.music && A.S.started ? 'calm' : 'off'); TitleUI.refresh(); } else Parade.on = false;
    if (s === 'game') { layout(true); Tut.maybe(); }
  }
  function togglePause(force) {
    if (G.screen !== 'game') return;
    const want = force != null ? force : !G.paused;
    if (want === G.paused) return;
    G.paused = want; $('pause').classList.toggle('hidden', !want);
    if (want) { A.music('off'); Input.keys = []; Input.padDir = null; }
    else {
      if (G.state === 'play') { G.state = 'ready'; G.stateT = 0.75; G.banner = { text: 'GO!', t: 0 }; } // a beat to get your thumb back
      if (settings.music && (G.state === 'play' || G.state === 'ready')) A.music(G.panicT > 0 ? 'panic' : 'calm');
    }
    syncToggles();
  }
  const Over = {
    show(isBest) {
      showScreen('over');
      $('overTitle').textContent = G.daily ? 'PATROL DONE!' : G.mode === 'rush' ? "TIME'S UP!" : 'TICKETED!';
      $('btnSwitch').textContent = G.daily ? 'Play Rush' : 'Switch mode';
      $('overBest').classList.add('hidden'); // the ribbon lands when the count-up finishes
      if (isBest) setTimeout(() => { if (G.screen === 'over') $('overBest').classList.remove('hidden'); }, 900);
      const rows = [
        ['Candies', G.eatenTotal || 0], ['Officers caught', G.caughtN], ['Best chain', G.bestChain ? 'x' + G.bestChain : '\u2013'], ['Close calls', G.nearN], ['Tickets', G.ticketN || 0],
        G.mode === 'rush' ? ['Refills', G.refills] : ['Level reached', G.level],
        G.sweeps ? ['Clean sweeps', G.sweeps] : null,
      ];
      $('overStats').innerHTML = rows.filter(Boolean).map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
      $('overBestVal').textContent = G.daily ? "Today's best: " + dailyBest().toLocaleString() : 'Best: ' + best[G.mode].toLocaleString();
      const med = $('overMedal');
      if (G.daily) { // daily: the streak is the medal
        med.className = 'medal m2'; med.textContent = 'Day streak ' + daily.streak;
        $('overNext').textContent = G.twist.name + ' · new street tomorrow';
      } else { // medal + the next one to chase
        const m = medalFor(G.mode, G.score), M = MEDALS[G.mode];
        med.className = 'medal' + (m >= 0 ? ' m' + m : ' none'); med.textContent = m >= 0 ? M[m][0] : 'No medal yet';
        $('overNext').textContent = m < M.length - 1 ? (M[m + 1][1] - G.score).toLocaleString() + ' to ' + M[m + 1][0] : 'Top medal!';
      }
      const og = $('overGoals'); og.classList.toggle('hidden', !G.goalsHit.length);
      og.textContent = G.goalsHit.length ? '\u2713 Goal done: ' + G.goalsHit.join(' \u00b7 ') + ' (' + goalDone().length + '/3 today)' : '';
      // who wrote the ticket
      let who = G.lastTicketBy;
      if (G.mode === 'rush') { who = null; G.ticketBy.forEach((n, i) => { if (n && (who == null || n > G.ticketBy[who])) who = i; }); }
      const bc = $('overByCv'), bx = bc.getContext('2d'); bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, 96, 96);
      if (who != null) {
        Art.drawOfficer(bx, 48, 50, 64, who, { dir: 3, face: 1, t: 0, lookX: 1 });
        const nm = AI.OFFICERS[who].name;
        $('overByTxt').innerHTML = G.mode === 'rush' ? '<b>' + nm + '</b> wrote you up ' + (G.ticketBy[who] === 1 ? 'once' : G.ticketBy[who] + ' times') : 'Ticketed by <b>' + nm + '</b>';
      } else {
        Art.drawRaccoon(bx, 48, 50, 60, { dir: 2, t: 0, moving: false });
        $('overByTxt').innerHTML = '<b>Clean record!</b> Not one ticket';
      }
      // count-up
      const target = G.score, t0 = performance.now(), el = $('overScore');
      (function up(now) { const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(target * e).toLocaleString(); if (k < 1 && G.screen === 'over') requestAnimationFrame(up); })(t0);
      if (isBest) { setTimeout(() => A.sfx.life(), 500); buzz([20, 40, 20]); }
      $('btnAgain').focus({ preventScroll: true });
    },
  };

  /* ---------- tutorial hand ---------- */
  const Tut = {
    el: null,
    maybe() {
      this.el = $('tut');
      this.el.querySelector('p').innerHTML = (settings.pad ? 'Swipe or use the pad' : 'Swipe to steer') + '<br><small>Turn early: the raccoon waits for the next corner</small>';
      if (!seenTut && G.screen === 'game') this.el.classList.remove('hidden'); else this.el.classList.add('hidden');
    },
    hide() { if (this.el) this.el.classList.add('hidden'); },
  };

  /* ---------- title parade ---------- */
  const Parade = {
    on: true, t: 0, cv: null, c: null,
    draw(dt) {
      if (!this.on) return;
      if (!this.cv) { this.cv = $('parade'); this.c = this.cv.getContext('2d'); }
      const d = Math.min(window.devicePixelRatio || 1, 2), w = this.cv.clientWidth, h = this.cv.clientHeight;
      if (!w) return;
      if (this.cv.width !== Math.round(w * d)) { this.cv.width = Math.round(w * d); this.cv.height = Math.round(h * d); }
      this.t += dt; const c = this.c; c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
      const T = Math.min(34, h * .5), loop = 7, k = (this.t % loop) / loop, pass = Math.floor(this.t / loop) % 2;
      const span = w + T * 10, y = h * .55;
      // candies line
      for (let x = T * .5; x < w; x += T) {
        const rx = pass ? (w + T * 5) - k * span : -T * 5 + k * span;
        if ((pass === 0 && x > rx) || (pass === 1 && x < rx)) { c.save(); c.translate(x, y); Art.leafPath(c, T * .18); c.fillStyle = '#f2a33a'; c.fill(); c.restore(); }
      }
      if (pass === 0) { // officers chase the raccoon to the right
        const rx = -T * 1.5 + k * span;
        Art.drawRaccoon(c, rx, y, T, { dir: 3, t: this.t, chomp: Math.abs(Math.sin(this.t * 9)) });
        for (let i = 0; i < 4; i++) Art.drawOfficer(c, rx - T * (2.2 + i * 1.7), y - T * .1, T, i, { dir: 3, face: 1, t: this.t + i, lookX: 1 });
      } else { // after a creemee, the raccoon chases them back
        const rx = w + T * 1.5 - k * span;
        for (let i = 0; i < 4; i++) Art.drawOfficer(c, rx - T * (2.2 + i * 1.7), y - T * .1, T, i, { dir: 1, face: -1, t: this.t + i, state: 'panic' });
        Art.drawRaccoon(c, rx, y, T, { dir: 1, t: this.t, chomp: Math.abs(Math.sin(this.t * 9)) });
      }
    },
  };

  /* ---------- settings / title wiring ---------- */
  function saveSettings() { store.set('settings', settings); }
  function syncToggles() {
    document.querySelectorAll('[data-set]').forEach(b => {
      const k = b.dataset.set, on = settings[k];
      b.classList.toggle('off', !on);
      const lbl = { sfx: 'Sound', music: 'Music', pad: 'D-pad', haptics: 'Buzz' }[k];
      b.textContent = lbl + ': ' + (on ? 'on' : 'off');
    });
    if (!navigator.vibrate) document.querySelectorAll('[data-set="haptics"]').forEach(b => b.classList.add('hidden'));
    $('pad').classList.toggle('hidden', !settings.pad); $('game').classList.toggle('withpad', !!settings.pad);
  }
  const TitleUI = {
    refresh() {
      const tag = md => { const m = medalFor(md, best[md]); return m >= 0 ? ' · ' + MEDALS[md][m][0] : ''; };
      $('bestRush').textContent = best.rush ? 'Best ' + best.rush.toLocaleString() + tag('rush') : '5-minute score attack';
      $('bestClassic').textContent = best.classic ? 'Best ' + best.classic.toLocaleString() + tag('classic') : '3 lives, clear every street';
      const tw = todayTwist(), db = dailyBest();
      $('dailyTwist').textContent = "Today: " + tw.name + (db ? ' · best ' + db.toLocaleString() : ' · 3 min');
      const done = goalDone(), gl = goalsToday();
      $('goals').innerHTML = '<h3>TODAY\'S GOALS <span>' + gl.filter(g => done.includes(g.id)).length + '/3</span></h3>' +
        gl.map(g => '<div class="goal' + (done.includes(g.id) ? ' done' : '') + '"><i>' + (done.includes(g.id) ? '\u2713' : '') + '</i><span>' + g.text + '</span></div>').join('');
      const st = liveStreak(); $('dailyStreak').textContent = st ? 'Streak ' + st + (daily.last === dayKey() ? '' : ' · play today!') : '';
      syncToggles();
    },
  };
  function wireUI() {
    const click = (id, fn) => $(id).addEventListener('click', e => { if (performance.now() < Input.suppressClickUntil) return; A.unlock(); fn(e); });
    click('btnRush', () => startMode('rush'));
    click('btnClassic', () => startMode('classic'));
    click('btnHow', () => { A.sfx.ui(); How.open(); });
    click('howClose', () => { A.sfx.ui(); $('how').classList.add('hidden'); });
    $('how').addEventListener('click', e => { if (e.target.id === 'how') $('how').classList.add('hidden'); });
    click('btnPause', () => togglePause(true));
    click('pResume', () => togglePause(false));
    let restartArm = 0;
    click('pRestart', () => { // two taps, so it can't be hit by accident next to Home
      if (performance.now() - restartArm > 2500) { restartArm = performance.now(); $('pRestart').textContent = 'Tap again to restart'; setTimeout(() => { $('pRestart').textContent = 'Restart'; }, 2500); A.sfx.ui(); return; }
      restartArm = 0; $('pRestart').textContent = 'Restart'; togglePause(false); startMode(curMode());
    });
    click('pHome', () => { togglePause(false); G.state = 'idle'; showScreen('title'); });
    click('btnAgain', () => startMode(curMode()));
    click('btnDaily', () => startMode('daily'));
    click('btnOverHome', () => { G.state = 'idle'; showScreen('title'); });
    click('btnSwitch', () => startMode(G.daily ? 'rush' : G.mode === 'rush' ? 'classic' : 'rush'));
    document.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.set; settings[k] = !settings[k]; saveSettings(); A.unlock();
      if (k === 'sfx') A.setSfx(settings.sfx);
      if (k === 'music') { A.setMusic(settings.music); }
      if (k === 'pad') layout(true);
      syncToggles(); A.sfx.ui();
    }));
    A.setSfx(settings.sfx); A.setMusic(settings.music);
    bindSwipe($('game')); bindPad($('pad'));
    // stop iOS long-press menus / double-tap zoom / scroll
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('touchmove', e => { if (e.touches.length > 1 || G.screen === 'game') e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (!window.__T.noPause && G.screen === 'game' && G.state !== 'over') togglePause(true); A.suspend(); }
      else A.resume();
    });
    window.addEventListener('blur', () => { if (!window.__T.noPause && G.screen === 'game') togglePause(true); });
  }
  const How = {
    open() {
      $('how').classList.remove('hidden');
      const cv = $('howCv'), d = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * d; cv.height = h * d; const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
      const T = Math.min(30, w / 9), rowH = h / 4;
      c.textBaseline = 'middle';
      AI.OFFICERS.forEach((o, i) => {
        const y = rowH * (i + .5);
        Art.drawOfficer(c, T * 1.1, y, T, i, { dir: 3, face: 1, t: i, lookX: 1 });
        c.fillStyle = '#fff1d0'; c.font = '400 ' + Math.round(T * .52) + 'px Bungee, Impact, sans-serif'; c.fillText(o.name, T * 2.3, y - T * .25);
        c.fillStyle = '#ffd98a'; c.font = '600 ' + Math.round(T * .45) + 'px Rubik, sans-serif'; c.fillText(o.role, T * 2.3, y + T * .32);
      });
    },
  };

  /* ---------- layout: once per width/orientation change ---------- */
  let lastW = 0, lastOrient = '', lockedH = 0, pendingLayout = false;
  function safe() {
    const p = $('safeProbe'), cs = getComputedStyle(p);
    return { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0 };
  }
  function layout(force) {
    const W = window.innerWidth, H = window.innerHeight, orient = W > H ? 'land' : 'port';
    if (!force && W === lastW && orient === lastOrient) {
      if (Math.abs(H - lockedH) > 2) {
        // Safari toolbar showed/hid: never re-fit mid-play (controls must not jump); shrink so nothing hides under it,
        // and re-fit properly at the next calm moment (pause, ticket, ready, game over)
        if (H < lockedH) { $('app').style.height = H + 'px'; $('game').classList.add('clipped'); } // the roster may be cut: fade it
        if (G.screen === 'game' && G.state === 'play' && !G.paused) pendingLayout = true; else layout(true);
      }
      return;
    }
    lastW = W; lastOrient = orient; lockedH = H; $('app').style.height = H + 'px'; $('game').classList.remove('clipped');
    const s = safe();
    const land = orient === 'land' && W > 700;
    document.body.classList.toggle('land', land);
    const hudH = land ? 0 : 64, stripH = land ? 0 : 54;
    let padH = settings.pad ? Math.min(210, Math.max(150, H * .22)) : 0;
    let availW = W - s.l - s.r - 4, availH = H - s.t - s.b - hudH - stripH - padH - 12;
    if (land) { availW = W - s.l - s.r - 190 - 18 - (settings.pad ? 180 + 18 : 150 + 18) - 16; availH = H - s.t - s.b - 16; padH = 0; }
    let T = Math.floor(Math.min(availW / (COLS - 2 * CROP), availH / (ROWS - 2 * CROP)) * 4) / 4;
    T = Math.max(10, Math.min(T, 40));
    View.size(T);
    // tall phones: fill the spare height with the skyline header and the officer roster
    let spare = land ? 0 : H - s.t - s.b - (hudH + (ROWS - 2 * CROP) * T + stripH + padH + 12);
    const showRoster = land ? !settings.pad : !settings.pad && spare >= 70; // landscape: a column on the right
    if (showRoster) spare -= 64;
    const mqH = !land && !settings.pad && spare >= 64 ? Math.floor(Math.min(130, spare - 8)) : 0;
    $('game').classList.toggle('has-roster', showRoster); $('game').classList.toggle('has-mq', mqH > 0);
    Roster.shown = showRoster; Sky.shown = mqH > 0; Sky.dirty = true;
    document.documentElement.style.setProperty('--mqH', mqH + 'px');
    requestAnimationFrame(() => { if (Sky.shown) Sky.draw(); Roster.update(0, true); anchor(); });
    const root = document.documentElement.style;
    root.setProperty('--boardW', (COLS - 2 * CROP) * T + 'px'); root.setProperty('--boardH', (ROWS - 2 * CROP) * T + 'px'); root.setProperty('--padH', padH + 'px');
  }
  // fix the column's top gap in px at layout time (instead of auto margins), so Safari's toolbar
  // shrinking the viewport mid-play clips the bottom band rather than moving the board
  function anchor() {
    const g = $('game'); if (document.body.classList.contains('land') || settings.pad || g.classList.contains('hidden')) { g.classList.remove('anchored'); return; }
    g.classList.remove('anchored'); const kids = [...g.children].filter(k => k.offsetParent && getComputedStyle(k).position !== 'absolute');
    if (!kids.length) return;
    const top = kids[0].getBoundingClientRect().top, bottom = kids[kids.length - 1].getBoundingClientRect().bottom, gr = g.getBoundingClientRect();
    const padT = parseFloat(getComputedStyle(g).paddingTop) || 0;
    g.style.setProperty('--topGap', Math.max(0, Math.round(top - gr.top - padT)) + 'px'); g.classList.add('anchored');
    void bottom;
  }
  window.addEventListener('resize', () => layout(false));
  window.addEventListener('orientationchange', () => { if (G.screen === 'game' && G.state !== 'over') togglePause(true); setTimeout(() => layout(true), 300); });

  /* ---------- main loop ---------- */
  let last = performance.now();
  function frame(now) {
    const rdt = Math.min(0.05, (now - last) / 1000); last = now;
    if (pendingLayout && !(G.screen === 'game' && G.state === 'play' && !G.paused)) { pendingLayout = false; layout(true); }
    if (G.screen === 'game' && !G.paused && !window.__T.freeze) advance(rdt);
    else if (G.screen !== 'game') updateFx(rdt);
    if (G.screen === 'game' || G.screen === 'over') { View.render(now); HUD.frame(); }
    Parade.draw(rdt);
    requestAnimationFrame(frame);
  }
  function advance(rdt) {
    let ts = 1;
    if (G.hitPause > 0) { G.hitPause -= rdt; ts = 0; }
    else if (G.slowmo > 0) { G.slowmo -= rdt; ts = 0.3; }
    let dt = rdt * ts;
    while (dt > 1e-6) { const h = Math.min(dt, 1 / 120); tick(h); dt -= h; if (G.state === 'over') break; }
    updateFx(rdt);
    A.setIntensity(G.mode === 'rush' ? Math.max(1, G.mult) : 3);
    if (G.state === 'play' && settings.music) A.setTempo(G.mode === 'rush' ? 1 + Math.min(.5, G.speedLvl * .04) + (G.time < 30 ? .1 : 0) : 1);
  }

  /* ---------- test hooks ---------- */
  window.__T = {
    noPause: false, freeze: false,
    start(mode, opts) { opts = opts || {}; newGame(mode || 'rush'); if (opts.skipReady !== false) { G.state = 'play'; G.banner = null; } return this.state(); },
    step(ms) { const n = Math.round((ms || 16) / (1000 / 120)); for (let k = 0; k < n; k++) { if (G.screen !== 'game') break; let ts = 1; if (G.hitPause > 0) { G.hitPause -= 1 / 120; ts = 0; } else if (G.slowmo > 0) { G.slowmo -= 1 / 120; ts = .3; } tick(ts / 120); updateFx(1 / 120); } return this.state(); },
    state() {
      return {
        screen: G.screen, state: G.state, mode: G.mode, score: G.score, lives: G.lives, level: G.level, time: +G.time.toFixed(2), speedLvl: G.speedLvl, refills: G.refills,
        maze: G.maze && G.maze.name, mazeIdx: G.mazeIdx, phase: G.panicT > 0 ? 'panic' : phase(), panicT: +G.panicT.toFixed(2), chain: G.chain, candyLeft: G.candyLeft, half: G.half.slice(),
        bonus: G.bonus && { x: G.bonus.x, y: G.bonus.y, key: G.bonus.key, refill: G.bonus.refill },
        player: G.p && { x: +G.p.x.toFixed(3), y: +G.p.y.toFixed(3), dir: G.p.dir, moving: G.p.moving, buf: G.p.buf && { ...G.p.buf } },
        officers: G.offs.map(o => ({ i: o.i, st: o.st, x: +o.x.toFixed(2), y: +o.y.toFixed(2), dir: o.dir, panic: o.panic, target: o.target })),
        T: View.T, paused: G.paused, slowmo: G.slowmo, nearN: G.nearN, caught: G.caughtN,
      };
    },
    input(d) { setBuffer(d, false); },
    setPlayer(x, y, dir) { Object.assign(G.p, { x, y, dir: dir == null ? G.p.dir : dir, moving: true, atC: false, buf: null }); },
    setOfficer(i, props) { Object.assign(G.offs[i], props); },
    parkOfficers(except) { G.offs.forEach(o => { if (except == null || !except.includes(o.i)) { o.st = 'home'; o.release = 1e9; o.x = o.homeX; o.y = 10.5; } }); },
    god(on) { G.god = on !== false; },
    creemee() { startPanic(); },
    setTime(s) { G.time = s; },
    clearHalf(h) { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (halfOf(x) === h) G.candy[y][x] = 0; countCandy(); View.candyDirty = true; afterEat(); },
    clearAll() { for (let y = 0; y < ROWS; y++) G.candy[y].fill(0); countCandy(); View.candyDirty = true; afterEat(); },
    loadMaze(i) { loadMaze(i); resetActors(true); G.state = 'play'; },
    get log() { return G.log; },
    // drive frames by hand (useful when the tab is hidden and rAF is throttled)
    render(ms) { const now = performance.now(); if (G.screen === 'game' || G.screen === 'over') { View.render(now); HUD.frame(); } Parade.draw((ms || 16) / 1000); },
    advance(ms) { const n = Math.max(1, Math.round((ms || 16) / 16)); for (let k = 0; k < n; k++) { advance(1 / 60); } this.render(16); return this.state(); },
    open, G, View, TUNE, layout,
  };

  /* ---------- boot ---------- */
  function boot() {
    View.init(); wireUI(); Art.loadAssets();
    layout(true); showScreen('title');
    requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { View.mazeDirty = true; Sky.draw(); });
  }
  boot();
})();
