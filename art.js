/* Church Street Chomp - code-drawn art.
 * Every drawable has a key in ASSETS. If a painted PNG is later dropped into assets/ and its `src`
 * filled in, drawSprite() uses the image; otherwise the code-drawn version below is used. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];

  /* ---------- painted-art slots (see IMAGE-PROMPTS.md) ---------- */
  const ASSETS = {
    raccoon:       { src: null, w: 1.6, h: 1.6 },
    officer_chalk: { src: null, w: 1.7, h: 1.6 },
    officer_tina:  { src: null, w: 1.7, h: 1.6 },
    officer_bolt:  { src: null, w: 1.7, h: 1.6 },
    officer_doug:  { src: null, w: 1.7, h: 1.6 },
    officer_panic: { src: null, w: 1.7, h: 1.6 },
    creemee:       { src: null, w: 1.0, h: 1.2 },
    candy:         { src: null, w: 0.42, h: 0.42 },
    bonus_apple:   { src: null, w: 1.0, h: 1.0 },
    bonus_donut:   { src: null, w: 1.0, h: 1.0 },
    bonus_cheddar: { src: null, w: 1.0, h: 1.0 },
    bonus_syrup:   { src: null, w: 1.0, h: 1.0 },
    bonus_pie:     { src: null, w: 1.0, h: 1.0 },
    bonus_lantern: { src: null, w: 1.0, h: 1.0 },
    officer_towed: { src: null, w: 1.9, h: 1.4 },
    skyline:       { src: null, w: 0, h: 0 },
    title_art:     { src: null, w: 0, h: 0 },
  };
  function loadAssets() {
    for (const k in ASSETS) {
      const a = ASSETS[k];
      if (!a.src) continue;
      const img = new Image();
      img.onload = () => { a.img = img; };
      img.src = a.src;
    }
  }
  function painted(key) { const a = ASSETS[key]; return a && a.img ? a : null; }

  /* ---------- themes (one per maze) ---------- */
  /* Readability first: a flat dark floor, solid walls with one bright edge colour per street,
   * and nothing decorative inside the play field. The Burlington flavour lives in the frame around it. */
  const THEMES = [
    { name: 'Church Street', floor: '#0c0912', wall: '#4d2030', edge: '#ff8a5c', office: '#17122a', sign: '#ff8a5c',
      brick: ['#5a2a22', '#64302a', '#4f241e', '#6b3a2c'], mortar: '#2a1412', sky: '#120a14' },
    { name: 'Waterfront', floor: '#070d14', wall: '#12384d', edge: '#52d9ff', office: '#10182a', sign: '#52d9ff',
      brick: ['#3c3a44', '#45424e', '#34323b', '#4c4752'], mortar: '#1a1920', sky: '#07111c' },
    { name: 'City Hall Park', floor: '#0a0b08', wall: '#553512', edge: '#ffb43d', office: '#171409', sign: '#ffb43d',
      brick: ['#5c3424', '#673b29', '#51301f', '#714230'], mortar: '#29160f', sky: '#0b0f12' },
    { name: 'Battery Street', floor: '#0d0710', wall: '#4a1648', edge: '#ff7ad9', office: '#1c1030', sign: '#ff7ad9',
      brick: ['#4a2436', '#54293d', '#401f2f', '#5e3044'], mortar: '#21101a', sky: '#140814' },
  ];

  /* ---------- small helpers ---------- */
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  }
  function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, TAU); }
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  /* ---------- maple candy (the pellet) ---------- */
  const LEAF = (function () {
    // right half of a stylised maple leaf, mirrored
    const R = [[0, -1], [.16, -.62], [.42, -.78], [.34, -.36], [.86, -.44], [.72, -.16], [.98, .06], [.5, .24], [.56, .52], [.16, .38], [.06, .66]];
    const L = R.slice(1, -1).reverse().map(p => [-p[0], p[1]]);
    return R.concat([[-.06, .66]], L);
  })();
  function leafPath(c, s) {
    c.beginPath();
    LEAF.forEach((p, i) => i ? c.lineTo(p[0] * s, p[1] * s) : c.moveTo(p[0] * s, p[1] * s));
    c.closePath();
  }
  // pickups are plain, small, identical cream dots: nothing else on the floor looks like one
  function makeCandy(T, dpr) {
    const S = Math.ceil(T * 0.5 * dpr), cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d'); c.translate(S / 2, S / 2); c.scale(dpr, dpr);
    c.fillStyle = '#ffe9ae'; c.beginPath(); c.arc(0, 0, T * 0.125, 0, TAU); c.fill();
    return cv;
  }

  /* ---------- maple creemee (power item) ---------- */
  function drawCreemee(c, x, y, T0, t) {
    const a = painted('creemee'); const pulse = Math.sin(t * 6);
    const T = T0 * (1.32 + 0.1 * pulse); // power-ups are clearly the biggest pickup and they pulse
    const bob = Math.sin(t * 4) * T0 * 0.04;
    c.save(); c.translate(x, y + bob);
    // pulsing halo + ring
    const pr = T0 * (.85 + .12 * pulse);
    const hg = c.createRadialGradient(0, 0, 0, 0, 0, pr);
    hg.addColorStop(0, 'rgba(255,240,200,.75)'); hg.addColorStop(.6, 'rgba(255,200,230,.35)'); hg.addColorStop(1, 'rgba(255,170,220,0)');
    c.fillStyle = hg; c.beginPath(); c.arc(0, 0, pr, 0, TAU); c.fill();
    if (a) { c.drawImage(a.img, -a.w * T / 2, -a.h * T / 2, a.w * T, a.h * T); c.restore(); return; }
    const s = T;
    c.lineWidth = Math.max(1, s * 0.05); c.strokeStyle = '#4a2a14'; c.lineJoin = 'round';
    // cone
    c.beginPath(); c.moveTo(-s * .22, -s * .02); c.lineTo(s * .22, -s * .02); c.lineTo(0, s * .46); c.closePath();
    const cg = c.createLinearGradient(-s * .2, 0, s * .2, 0); cg.addColorStop(0, '#e9b56a'); cg.addColorStop(1, '#b97a35');
    c.fillStyle = cg; c.fill(); c.stroke();
    c.save(); c.clip(); c.strokeStyle = 'rgba(110,60,20,.55)'; c.lineWidth = s * 0.025;
    for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(i * s * .1 - s * .2, -s * .02); c.lineTo(i * s * .1 + s * .2, s * .46); c.stroke(); c.beginPath(); c.moveTo(i * s * .1 + s * .2, -s * .02); c.lineTo(i * s * .1 - s * .2, s * .46); c.stroke(); }
    c.restore();
    // swirl
    const sw = (cx, cy, rx, ry) => { ell(c, cx, cy, rx, ry); const g = c.createLinearGradient(0, cy - ry, 0, cy + ry); g.addColorStop(0, '#fffdf4'); g.addColorStop(1, '#e9dcc4'); c.fillStyle = g; c.fill(); c.stroke(); };
    sw(0, -s * .06, s * .27, s * .1); sw(s * .01, -s * .19, s * .21, s * .09); sw(-s * .01, -s * .3, s * .14, s * .07);
    c.beginPath(); c.moveTo(-s * .03, -s * .36); c.quadraticCurveTo(s * .06, -s * .47, s * .1, -s * .4); c.stroke();
    // maple drizzle
    c.fillStyle = '#c8751c'; c.beginPath(); c.moveTo(-s * .2, -s * .12); c.quadraticCurveTo(0, -s * .02, s * .2, -s * .12); c.quadraticCurveTo(s * .14, -s * .02, s * .1, s * .02); c.quadraticCurveTo(s * .06, -s * .04, 0, -s * .03); c.quadraticCurveTo(-s * .1, -s * .02, -s * .14, s * .03); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.9)'; ell(c, -s * .1, -s * .22, s * .05, s * .025); c.fill();
    c.restore();
  }

  /* ---------- bonus items ---------- */
  const BONUS = [
    { key: 'donut', name: 'Cider Donut', pts: 150 },
    { key: 'apple', name: 'Apple', pts: 250 },
    { key: 'cheddar', name: 'Cheddar', pts: 400 },
    { key: 'syrup', name: 'Syrup Jug', pts: 650 },
    { key: 'pie', name: 'Blueberry Pie', pts: 900 },
    { key: 'lantern', name: 'Lake Lantern', pts: 1500 },
  ];
  function drawBonus(c, key, x, y, T, t) {
    const a = painted('bonus_' + key);
    c.save(); c.translate(x, y + Math.sin(t * 3.2) * T * 0.05);
    const pr = T * 0.7; const hg = c.createRadialGradient(0, 0, 0, 0, 0, pr);
    hg.addColorStop(0, 'rgba(255,255,200,.35)'); hg.addColorStop(1, 'rgba(255,255,200,0)'); c.fillStyle = hg; c.beginPath(); c.arc(0, 0, pr, 0, TAU); c.fill();
    if (a) { c.drawImage(a.img, -T / 2, -T / 2, T, T); c.restore(); return; }
    const s = T; c.lineWidth = Math.max(1, s * 0.05); c.strokeStyle = '#2a1a12'; c.lineJoin = 'round';
    if (key === 'apple') {
      ell(c, 0, s * .05, s * .32, s * .3); let g = c.createRadialGradient(-s * .1, -s * .05, s * .03, 0, s * .05, s * .35); g.addColorStop(0, '#ff8a7a'); g.addColorStop(1, '#c0242c'); c.fillStyle = g; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(0, -s * .2); c.lineTo(s * .03, -s * .36); c.stroke();
      c.fillStyle = '#4caf50'; c.beginPath(); c.ellipse(s * .12, -s * .3, s * .12, s * .06, -0.5, 0, TAU); c.fill(); c.stroke();
    } else if (key === 'donut') {
      c.beginPath(); c.arc(0, 0, s * .34, 0, TAU); c.arc(0, 0, s * .12, 0, TAU, true); c.fillStyle = '#c98a4a'; c.fill('evenodd'); c.stroke();
      c.beginPath(); c.arc(0, 0, s * .12, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(255,245,230,.85)'; for (let i = 0; i < 14; i++) { const an = i * 2.4, r = s * (.18 + (i % 3) * .05); c.fillRect(Math.cos(an) * r, Math.sin(an) * r, s * .035, s * .035); }
    } else if (key === 'cheddar') {
      c.beginPath(); c.moveTo(-s * .34, s * .2); c.lineTo(s * .34, s * .2); c.lineTo(s * .34, -s * .06); c.lineTo(-s * .34, s * .02); c.closePath(); c.fillStyle = '#f5a623'; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-s * .34, s * .02); c.lineTo(s * .34, -s * .06); c.lineTo(s * .1, -s * .28); c.closePath(); c.fillStyle = '#ffc94d'; c.fill(); c.stroke();
      c.fillStyle = '#c97d0e'; [[-.15, .1, .05], [.12, .08, .04], [.05, -.1, .035]].forEach(h => { ell(c, h[0] * s, h[1] * s, h[2] * s, h[2] * s * .8); c.fill(); });
    } else if (key === 'syrup') {
      rr(c, -s * .22, -s * .14, s * .44, s * .48, s * .1); let g = c.createLinearGradient(-s * .2, 0, s * .2, 0); g.addColorStop(0, '#e2a54a'); g.addColorStop(1, '#a8601a'); c.fillStyle = g; c.fill(); c.stroke();
      rr(c, -s * .07, -s * .32, s * .14, s * .2, s * .03); c.fillStyle = '#f2e6d0'; c.fill(); c.stroke();
      c.beginPath(); c.arc(s * .2, -s * .06, s * .12, -1.4, 1.2); c.stroke();
      c.fillStyle = '#fff7e0'; rr(c, -s * .15, s * .02, s * .3, s * .16, s * .03); c.fill();
      c.fillStyle = '#b5401c'; c.save(); c.translate(0, s * .1); leafPath(c, s * .065); c.fill(); c.restore();
    } else if (key === 'pie') {
      c.beginPath(); c.moveTo(-s * .36, s * .08); c.lineTo(s * .36, s * .08); c.lineTo(s * .28, s * .26); c.lineTo(-s * .28, s * .26); c.closePath(); c.fillStyle = '#c8894a'; c.fill(); c.stroke();
      ell(c, 0, s * .06, s * .36, s * .16); c.fillStyle = '#e0a860'; c.fill(); c.stroke();
      c.fillStyle = '#3b3f9e'; [[-.15, .03], [.05, .1], [.17, 0], [-.04, -.02]].forEach(p => { c.beginPath(); c.arc(p[0] * s, p[1] * s, s * .05, 0, TAU); c.fill(); });
      c.strokeStyle = '#b0743a'; c.lineWidth = s * .03; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * s * .1, -s * .08); c.lineTo(i * s * .1 + s * .04, s * .2); c.stroke(); }
    } else { // lantern
      c.beginPath(); c.arc(0, -s * .3, s * .07, Math.PI, 0); c.stroke();
      rr(c, -s * .2, -s * .24, s * .4, s * .5, s * .06); const g = c.createRadialGradient(0, 0, 0, 0, 0, s * .3); g.addColorStop(0, '#fff6b8'); g.addColorStop(1, '#ffad33'); c.fillStyle = g; c.fill(); c.stroke();
      c.strokeStyle = '#2a1a12'; c.beginPath(); c.moveTo(-s * .2, 0); c.lineTo(s * .2, 0); c.stroke();
    }
    c.restore();
  }

  /* ---------- the raccoon ---------- */
  function drawRaccoon(c, x, y, T, o) {
    o = o || {};
    const dir = o.dir == null ? 1 : o.dir, t = o.t || 0;
    const a = painted('raccoon');
    c.save(); c.translate(x, y);
    const s = T * (o.scale || 1.08);
    // squash & stretch + death spin
    const sq = o.squash || 0;
    if (o.dying) { const d = o.dying; c.rotate(d * TAU * 1.5); c.scale(1 - d * .7, 1 - d * .7); }
    c.scale(s * (1 + sq * 0.12), s * (1 - sq * 0.12));
    if (a) { c.drawImage(a.img, -a.w / 2 / (o.scale || 1.08), -a.h / 2 / (o.scale || 1.08), a.w / (o.scale || 1.08), a.h / (o.scale || 1.08)); c.restore(); return; }
    const lx = DX[dir] * 0.07, ly = DY[dir] * 0.05;
    const side = DX[dir] !== 0 ? -DX[dir] : (Math.sin(t * 3) > 0 ? 1 : -1);
    const moving = o.moving !== false;
    const wag = Math.sin(t * (moving ? 14 : 4)) * 0.18;
    c.lineJoin = 'round'; c.lineCap = 'round';
    const LW = 0.055, INK = '#211c25';
    // shadow
    c.fillStyle = 'rgba(0,0,0,.35)'; ell(c, 0, .5, .42, .1); c.fill();
    // tail (ringed)
    for (let i = 6; i >= 0; i--) {
      const k = i / 6, tx = side * (.28 + k * .38), ty = .3 - k * .34 + Math.sin(k * 3 + wag * 3) * .05 + wag * k * .4 * side;
      const r = .15 - k * .03;
      c.fillStyle = i % 2 ? '#4a4452' : '#e6e2ea'; c.strokeStyle = INK; c.lineWidth = LW * .7;
      ell(c, tx, ty, r, r); c.fill(); if (i === 6 || i === 0) c.stroke();
    }
    c.fillStyle = '#26212b'; ell(c, side * .66, -.04 + wag * .4 * side, .1, .1); c.fill();
    // feet
    const step = moving ? Math.sin(t * 22) : 0;
    c.fillStyle = '#2b2630';
    ell(c, -.17, .46 + step * .03, .09, .06); c.fill(); ell(c, .17, .46 - step * .03, .09, .06); c.fill();
    // body
    ell(c, 0, .26, .34, .27);
    let g = c.createLinearGradient(0, 0, 0, .55); g.addColorStop(0, '#d2cdd8'); g.addColorStop(1, '#948e9e'); c.fillStyle = g; c.fill();
    c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
    c.fillStyle = '#f6f1e8'; ell(c, 0, .32, .17, .15); c.fill();
    // scarf tail flapping behind
    const fl = Math.sin(t * 16) * .06;
    c.beginPath(); c.moveTo(side * .12, .04); c.lineTo(side * .5, .08 + fl); c.lineTo(side * .56, .2 - fl); c.lineTo(side * .16, .16); c.closePath();
    c.fillStyle = '#ff3b3b'; c.fill(); c.strokeStyle = INK; c.lineWidth = LW * .8; c.stroke();
    c.strokeStyle = '#ffe9c9'; c.lineWidth = .05; c.beginPath(); c.moveTo(side * .32, .06 + fl * .5); c.lineTo(side * .35, .18 - fl * .5); c.stroke();
    c.beginPath(); c.moveTo(side * .44, .07 + fl * .8); c.lineTo(side * .47, .19 - fl * .8); c.stroke();
    // scarf band
    rr(c, -.31, -.02, .62, .16, .08); c.fillStyle = '#ff3b3b'; c.fill();
    c.save(); c.clip(); c.fillStyle = '#ffe9c9';
    for (let i = -4; i < 5; i++) { c.beginPath(); c.moveTo(i * .14, -.04); c.lineTo(i * .14 + .06, -.04); c.lineTo(i * .14 + .1, .16); c.lineTo(i * .14 + .04, .16); c.fill(); }
    c.restore(); rr(c, -.31, -.02, .62, .16, .08); c.strokeStyle = INK; c.lineWidth = LW * .8; c.stroke();
    // head
    c.save(); c.translate(lx, ly - .02);
    // ears
    for (const sx of [-1, 1]) {
      c.beginPath(); c.moveTo(sx * .17, -.44); c.quadraticCurveTo(sx * .36, -.72, sx * .4, -.38); c.closePath();
      c.fillStyle = '#c4bfca'; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
      c.beginPath(); c.moveTo(sx * .22, -.45); c.quadraticCurveTo(sx * .34, -.6, sx * .35, -.42); c.closePath(); c.fillStyle = '#3a2f36'; c.fill();
    }
    ell(c, 0, -.24, .41, .33);
    g = c.createLinearGradient(0, -.56, 0, .08); g.addColorStop(0, '#e4e0e8'); g.addColorStop(1, '#aaa4b2'); c.fillStyle = g; c.fill();
    c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
    // cheek fluff
    c.fillStyle = '#ece6dd';
    c.beginPath(); c.moveTo(-.4, -.18); c.quadraticCurveTo(-.3, .02, 0, .04); c.quadraticCurveTo(.3, .02, .4, -.18); c.quadraticCurveTo(.2, -.08, 0, -.12); c.quadraticCurveTo(-.2, -.08, -.4, -.18); c.fill();
    // white brows
    c.fillStyle = '#f4f0ea'; ell(c, -.17, -.39, .13, .05); c.fill(); ell(c, .17, -.39, .13, .05); c.fill();
    // mask
    c.fillStyle = '#1e1a22';
    c.beginPath(); c.moveTo(-.39, -.22); c.quadraticCurveTo(-.3, -.36, -.12, -.33); c.quadraticCurveTo(0, -.29, .12, -.33); c.quadraticCurveTo(.3, -.36, .39, -.22); c.quadraticCurveTo(.3, -.13, .14, -.17); c.quadraticCurveTo(0, -.2, -.14, -.17); c.quadraticCurveTo(-.3, -.13, -.39, -.22); c.fill();
    // eyes
    const blink = (Math.sin(t * 0.9) > 0.985) ? 0.15 : 1;
    for (const sx of [-1, 1]) {
      c.fillStyle = '#fff'; ell(c, sx * .17, -.245, .075, .07 * blink); c.fill();
      c.fillStyle = '#1b1b1b'; ell(c, sx * .17 + lx * .5, -.245 + ly * .6, .045, .048 * blink); c.fill();
      c.fillStyle = '#fff'; ell(c, sx * .17 + lx * .5 - .015, -.265 + ly * .6, .016, .016); c.fill();
    }
    // snout + nose
    c.fillStyle = '#f1ebe2'; ell(c, 0, -.09, .14, .1); c.fill();
    c.fillStyle = '#1b1720'; ell(c, lx * .4, -.14, .055, .038); c.fill();
    c.fillStyle = 'rgba(255,255,255,.6)'; ell(c, lx * .4 - .015, -.152, .015, .01); c.fill();
    // mouth
    const ch = o.chomp || 0;
    if (ch > 0.05) {
      ell(c, 0, -.04 + ch * .02, .1, .02 + ch * .07); c.fillStyle = '#5a1420'; c.fill(); c.strokeStyle = INK; c.lineWidth = LW * .7; c.stroke();
      c.fillStyle = '#ff7f8f'; ell(c, 0, -.0 + ch * .05, .06, .02 + ch * .02); c.fill();
      c.fillStyle = '#fff'; c.fillRect(-.05, -.06 + ch * .01 - .02 * ch, .035, .03); c.fillRect(.015, -.06 + ch * .01 - .02 * ch, .035, .03);
    } else {
      c.strokeStyle = INK; c.lineWidth = LW * .7;
      c.beginPath(); c.moveTo(-.06, -.07); c.quadraticCurveTo(-.03, -.03, 0, -.07); c.quadraticCurveTo(.03, -.03, .06, -.07); c.stroke();
    }
    c.restore();
    if (o.ticket) { // a parking ticket slapped on the face
      c.save(); c.rotate(-.25); rr(c, -.22, -.42, .44, .3, .03); c.fillStyle = '#fff7d6'; c.fill(); c.strokeStyle = INK; c.lineWidth = .03; c.stroke();
      c.fillStyle = '#d63a3a'; c.fillRect(-.18, -.38, .36, .06); c.fillStyle = '#7a6f5a'; c.fillRect(-.18, -.28, .3, .025); c.fillRect(-.18, -.22, .24, .025); c.restore();
    }
    c.restore();
  }

  /* ---------- the parking officers ---------- */
  const OFF_STYLE = [
    { key: 'chalk', body: '#2f6bff', trim: '#14307f', skin: '#f1c7a0', hat: '#14245c' },
    { key: 'tina', body: '#d23cff', trim: '#6a1a8f', skin: '#c98e62', hat: '#3a1560' },
    { key: 'bolt', body: '#22dd66', trim: '#0c6b30', skin: '#ffd7b0', hat: '#0f3a22' },
    { key: 'doug', body: '#ffcf1f', trim: '#8a6a00', skin: '#e7b48b', hat: '#4a3608' },
  ];
  function drawOfficer(c, x, y, T, i, o) {
    o = o || {};
    const st = OFF_STYLE[i], t = o.t || 0, dir = o.dir == null ? 1 : o.dir;
    const face = o.face || (DX[dir] || 1); // +1 faces right, -1 faces left
    const state = o.state || 'normal';
    const flashOn = state === 'flash' && Math.floor(t * 7) % 2 === 0;
    const panic = state === 'panic' || (state === 'flash' && !flashOn);
    c.save(); c.translate(x, y);
    const s = T * (o.scale || 1.0);
    if (state === 'caught') { drawCaught(c, s, st, t, face); c.restore(); return; }
    const key = panic ? 'officer_panic' : 'officer_' + st.key, a = painted(key);
    const bump = Math.abs(Math.sin(t * 18)) * 0.03;
    c.scale(s * face, s); c.translate(0, -bump);
    if (a) { c.drawImage(a.img, -a.w / 2, -a.h / 2, a.w, a.h); c.restore(); return; }
    const INK = '#1a1622', LW = 0.055;
    c.lineJoin = 'round'; c.lineCap = 'round';
    const body = panic ? '#f2f8ff' : st.body, trim = panic ? st.trim : st.trim;
    // shadow
    c.fillStyle = 'rgba(0,0,0,.38)'; ell(c, 0, .55, .62, .1); c.fill();
    // beacon on a pole at the back
    c.strokeStyle = INK; c.lineWidth = .04; c.beginPath(); c.moveTo(-.5, .02); c.lineTo(-.5, -.3); c.stroke();
    const beacon = panic ? (Math.floor(t * 10) % 2 ? '#ff5050' : '#ffd84a') : (Math.sin(t * 9 + i) > 0 ? '#ffb020' : '#7a4a10');
    ell(c, -.5, -.36, .08, .07); c.fillStyle = beacon; c.fill(); c.stroke();
    // officer head (behind the dash)
    const lookX = o.lookX || 0, lookY = o.lookY || 0;
    c.save(); c.translate(.02, -.28);
    // hair / ponytail
    if (st.key === 'tina') { c.fillStyle = '#3a1d10'; c.beginPath(); c.ellipse(-.3, .02, .14, .09, .6 + Math.sin(t * 10) * .2, 0, TAU); c.fill(); c.strokeStyle = INK; c.lineWidth = LW * .7; c.stroke(); }
    ell(c, 0, 0, .28, .27); c.fillStyle = st.skin; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
    // cap
    c.beginPath(); c.moveTo(-.29, -.06); c.quadraticCurveTo(-.28, -.36, 0, -.37); c.quadraticCurveTo(.28, -.36, .29, -.06); c.closePath();
    c.fillStyle = st.hat; c.fill(); c.stroke();
    c.fillStyle = st.body; c.fillRect(-.27, -.12, .54, .06);
    c.beginPath(); c.moveTo(.08, -.07); c.quadraticCurveTo(.3, -.08, .42, -.02); c.lineTo(.12, -.02); c.closePath(); c.fillStyle = '#111'; c.fill(); c.stroke(); // brim forward
    c.fillStyle = '#ffd34d'; ell(c, -.02, -.25, .05, .055); c.fill();
    if (st.key === 'bolt') { // goggles on the cap
      c.strokeStyle = INK; c.lineWidth = .03;
      for (const gx of [-.12, .1]) { ell(c, gx, -.22, .07, .06); c.fillStyle = '#9fe0ff'; c.fill(); c.stroke(); }
    }
    // face
    const ex = .06 + lookX * .05, ey = .02 + lookY * .04;
    if (panic) {
      for (const sx of [-.07, .13]) { c.fillStyle = '#fff'; ell(c, sx, .02, .07, .08); c.fill(); c.strokeStyle = INK; c.lineWidth = .025; c.stroke(); c.fillStyle = '#111'; ell(c, sx + Math.sin(t * 40) * .01, .03, .022, .022); c.fill(); }
      c.strokeStyle = INK; c.lineWidth = .03; c.beginPath(); c.moveTo(-.14, -.1); c.lineTo(-.02, -.08); c.moveTo(.08, -.08); c.lineTo(.2, -.1); c.stroke();
      c.fillStyle = '#4a1a1a'; c.beginPath(); c.moveTo(0, .16); for (let k = 0; k <= 6; k++) c.lineTo(k * .03, .15 + (k % 2 ? .03 : 0)); c.lineTo(.18, .21); c.lineTo(0, .21); c.fill();
      c.fillStyle = '#9fd8ff'; c.beginPath(); c.moveTo(-.26, -.04); c.quadraticCurveTo(-.33, .06, -.27, .09); c.quadraticCurveTo(-.2, .06, -.26, -.04); c.fill(); // sweat
    } else if (st.key === 'chalk') {
      eyes(c, ex, ey, .055, .05);
      c.strokeStyle = INK; c.lineWidth = .045; c.beginPath(); c.moveTo(-.14, -.1); c.lineTo(.02, -.04); c.moveTo(.1, -.04); c.lineTo(.24, -.1); c.stroke(); // angry brows
      c.fillStyle = '#c8c3bd'; c.beginPath(); c.moveTo(-.12, .14); c.quadraticCurveTo(.06, .06, .26, .14); c.quadraticCurveTo(.2, .2, .07, .15); c.quadraticCurveTo(-.06, .22, -.12, .14); c.fill(); c.strokeStyle = INK; c.lineWidth = .025; c.stroke();
      c.beginPath(); c.moveTo(0, .22); c.quadraticCurveTo(.07, .19, .14, .22); c.stroke();
    } else if (st.key === 'tina') {
      eyes(c, ex, ey, .055, .04);
      c.strokeStyle = INK; c.lineWidth = .04; c.beginPath(); c.moveTo(-.13, -.07); c.quadraticCurveTo(-.06, -.04, .0, -.03); c.moveTo(.09, -.03); c.quadraticCurveTo(.16, -.04, .23, -.07); c.stroke();
      c.fillStyle = 'rgba(0,0,0,.0)';
      c.lineWidth = .04; c.beginPath(); c.moveTo(-.03, .14); c.quadraticCurveTo(.1, .2, .2, .1); c.stroke(); // smirk
      c.fillStyle = 'rgba(255,120,140,.45)'; ell(c, .22, .1, .05, .03); c.fill();
    } else if (st.key === 'bolt') {
      eyes(c, ex, ey, .065, .065);
      c.strokeStyle = INK; c.lineWidth = .04; c.beginPath(); c.moveTo(-.12, -.08); c.lineTo(0, -.09); c.moveTo(.1, -.09); c.lineTo(.22, -.08); c.stroke();
      c.beginPath(); c.moveTo(-.06, .12); c.quadraticCurveTo(.07, .26, .22, .12); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(.08, .13); c.lineTo(.08, .19); c.stroke();
    } else { // doug: sleepy
      const lid = 0.5 + 0.2 * Math.sin(t * 1.3);
      for (const sx of [-.06, .14]) {
        c.fillStyle = '#fff'; ell(c, sx + lookX * .02, ey, .055, .05); c.fill();
        c.fillStyle = '#111'; ell(c, sx + lookX * .04, ey + .015, .03, .03); c.fill();
        c.fillStyle = st.skin; c.fillRect(sx - .07, ey - .06, .14, .06 + .05 * lid); c.strokeStyle = INK; c.lineWidth = .03; c.beginPath(); c.moveTo(sx - .06, ey - .01 + .05 * lid); c.lineTo(sx + .06, ey - .01 + .05 * lid); c.stroke();
      }
      c.strokeStyle = INK; c.lineWidth = .03; c.beginPath(); c.moveTo(-.02, .17); c.quadraticCurveTo(.04, .14, .08, .17); c.quadraticCurveTo(.12, .2, .18, .16); c.stroke();
      c.fillStyle = 'rgba(60,40,30,.35)'; for (let k = 0; k < 6; k++) { c.fillRect(-.08 + k * .05, .21 + (k % 2) * .02, .015, .015); }
    }
    c.restore();
    // scooter body
    rr(c, -.6, -.02, 1.16, .44, .16);
    const g = c.createLinearGradient(0, -.02, 0, .42); g.addColorStop(0, shade(body, .25)); g.addColorStop(.55, body); g.addColorStop(1, shade(body, -.35)); c.fillStyle = g; c.fill();
    c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
    // windshield nub + stripe + emblem
    c.beginPath(); c.moveTo(.3, -.02); c.quadraticCurveTo(.46, -.18, .5, -.3); c.lineTo(.56, -.28); c.quadraticCurveTo(.54, -.1, .5, -.02); c.closePath(); c.fillStyle = 'rgba(190,230,255,.7)'; c.fill(); c.stroke();
    c.fillStyle = panic ? st.body : '#ffffff'; c.fillRect(-.56, .12, 1.08, .11);
    c.fillStyle = trim; c.fillRect(-.56, .21, 1.08, .03);
    ell(c, -.22, .1, .1, .1); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = trim; c.lineWidth = .03; c.stroke();
    c.strokeStyle = trim; c.lineWidth = .035; c.lineCap = 'round'; c.beginPath(); c.moveTo(-.25, .16); c.lineTo(-.25, .04); c.lineTo(-.2, .04); c.arc(-.2, .075, .035, -Math.PI / 2, Math.PI / 2); c.lineTo(-.25, .11); c.stroke();
    // headlight
    ell(c, .52, .1, .05, .06); c.fillStyle = '#fff8c8'; c.fill(); c.strokeStyle = INK; c.lineWidth = .03; c.stroke();
    // doug's coffee
    if (st.key === 'doug' && !panic) { rr(c, .2, -.16, .12, .16, .02); c.fillStyle = '#f5f0e6'; c.fill(); c.strokeStyle = INK; c.lineWidth = .025; c.stroke(); c.fillStyle = '#7a4a2a'; c.fillRect(.2, -.1, .12, .04); c.strokeStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(.24, -.2); c.quadraticCurveTo(.28, -.26, .25, -.32); c.stroke(); }
    // tina's ticket pad
    if (st.key === 'tina' && !panic) { c.save(); c.translate(.32, -.12); c.rotate(-.3 + Math.sin(t * 6) * .1); rr(c, -.07, -.09, .14, .17, .02); c.fillStyle = '#fff7d6'; c.fill(); c.strokeStyle = INK; c.lineWidth = .025; c.stroke(); c.fillStyle = '#d63a3a'; c.fillRect(-.05, -.07, .1, .03); c.restore(); }
    // wheels
    for (const wx of [-.36, .34]) {
      ell(c, wx, .44, .14, .14); c.fillStyle = '#16141a'; c.fill();
      ell(c, wx, .44, .06, .06); c.fillStyle = '#9a98a4'; c.fill();
      c.strokeStyle = '#4b4854'; c.lineWidth = .025; const sp = t * 20;
      c.beginPath(); c.moveTo(wx + Math.cos(sp) * .1, .44 + Math.sin(sp) * .1); c.lineTo(wx - Math.cos(sp) * .1, .44 - Math.sin(sp) * .1); c.stroke();
    }
    c.restore();
  }
  function eyes(c, ex, ey, rx, ry) {
    for (const sx of [-.06, .14]) {
      c.fillStyle = '#fff'; ell(c, sx, .0, rx, ry + .01); c.fill();
      c.fillStyle = '#16131a'; ell(c, sx + ex * .5, ey, rx * .55, rx * .6); c.fill();
      c.fillStyle = '#fff'; ell(c, sx + ex * .5 - .012, ey - .015, .012, .012); c.fill();
    }
  }
  // a caught officer gets towed back to the office: a little orange tow truck hauling their scooter
  // (front wheel up), with the officer dazed in the seat and stars circling
  function drawCaught(c, s, st, t, face) {
    const INK = '#1a1622', pa = painted('officer_towed');
    if (pa) { c.scale(s * face, s); c.drawImage(pa.img, -pa.w / 2, -pa.h / 2, pa.w, pa.h); return; }
    c.scale(s * face, s); c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = .05; c.strokeStyle = INK;
    // speed streaks behind
    c.strokeStyle = 'rgba(255,255,255,.45)';
    for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(-.72 - k * .04, -.05 + k * .13); c.lineTo(-1.0 - k * .08, -.05 + k * .13); c.stroke(); }
    c.strokeStyle = INK;
    // shadow
    c.fillStyle = 'rgba(0,0,0,.35)'; ell(c, 0, .42, .75, .08); c.fill();
    // tow truck (front)
    const blink = Math.floor(t * 9) % 2;
    rr(c, .12, -.16, .56, .44, .1); c.fillStyle = '#ff9a2e'; c.fill(); c.stroke();
    rr(c, .38, -.1, .22, .16, .04); c.fillStyle = '#bfe6ff'; c.fill(); c.stroke();
    c.fillStyle = '#ffe9c0'; c.fillRect(.16, .08, .2, .05);
    ell(c, .3, -.22, .07, .05); c.fillStyle = blink ? '#ffe84a' : '#b07010'; c.fill(); c.stroke();
    if (blink) { const g = c.createRadialGradient(.3, -.22, 0, .3, -.22, .3); g.addColorStop(0, 'rgba(255,220,80,.5)'); g.addColorStop(1, 'rgba(255,220,80,0)'); c.fillStyle = g; ell(c, .3, -.22, .3, .3); c.fill(); }
    for (const wx of [.24, .56]) { ell(c, wx, .3, .09, .09); c.fillStyle = '#2a2430'; c.fill(); c.stroke(); }
    // tow arm + hook
    c.beginPath(); c.moveTo(.14, -.02); c.lineTo(-.02, -.14); c.lineTo(-.1, -.06); c.stroke();
    // towed scooter, tilted nose-up
    c.save(); c.translate(-.42, .1); c.rotate(-.32);
    rr(c, -.32, -.14, .58, .3, .12); c.fillStyle = st.body; c.fill(); c.stroke();
    c.fillStyle = st.trim; c.fillRect(-.28, .0, .5, .05);
    ell(c, -.22, .2, .08, .08); c.fillStyle = '#2a2430'; c.fill(); c.stroke();
    // dazed officer in the seat
    ell(c, -.08, -.26, .15, .14); c.fillStyle = st.skin; c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-.24, -.29); c.quadraticCurveTo(-.22, -.46, -.08, -.46); c.quadraticCurveTo(.07, -.46, .08, -.29); c.closePath(); c.fillStyle = st.hat; c.fill(); c.stroke();
    c.lineWidth = .03;
    for (const sx of [-.13, -.03]) { c.beginPath(); c.moveTo(sx - .025, -.28); c.lineTo(sx + .025, -.23); c.moveTo(sx + .025, -.28); c.lineTo(sx - .025, -.23); c.stroke(); }
    c.fillStyle = '#ffe56b';
    for (let k = 0; k < 3; k++) { const an = t * 8 + k * TAU / 3; star(c, -.08 + Math.cos(an) * .24, -.56 + Math.sin(an) * .06, .055); }
    c.restore();
  }
  function star(c, x, y, r) { c.beginPath(); for (let k = 0; k < 10; k++) { const an = k * Math.PI / 5 - Math.PI / 2, rr2 = k % 2 ? r * .45 : r; c.lineTo(x + Math.cos(an) * rr2, y + Math.sin(an) * rr2); } c.closePath(); c.fill(); }

  /* ---------- the maze: flat dark floor, solid walls with one bright edge ---------- */
  function renderMaze(maze, T, dpr, cols, rows) {
    const th = THEMES[maze.theme % THEMES.length];
    const W = cols * T, H = rows * T;
    const mk = () => { const cv = document.createElement('canvas'); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); const c = cv.getContext('2d'); c.scale(dpr, dpr); return [cv, c]; };
    const [bg, c] = mk();
    const g = maze.grid;
    const isWall = (x, y) => x < 0 || y < 0 || x >= cols || y >= rows ? true : g[y][x] === 1;
    // floor: one calm flat colour, no texture
    c.fillStyle = th.floor; c.fillRect(0, 0, W, H);
    // parking office pen: a slightly different floor so the gate area reads as "inside"
    c.fillStyle = th.office; c.fillRect(8 * T, 10 * T, 3 * T, 2 * T);
    const ins = T * 0.2, edgeW = Math.max(1.6, T * 0.085), ov = 0.8;
    // one path for every wall cell: inset on the sides that face a corridor, rounded convex corners,
    // and a hair of overlap into wall neighbours so merged shapes have no seams
    const wallPath = (cc) => {
      cc.beginPath();
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (g[y][x] !== 1) continue;
        const L = isWall(x - 1, y) ? -ov : ins, Rr = isWall(x + 1, y) ? -ov : ins, Tt = isWall(x, y - 1) ? -ov : ins, B = isWall(x, y + 1) ? -ov : ins;
        const px = x * T + L, py = y * T + Tt, w = T - L - Rr, h = T - Tt - B, rad = T * 0.24;
        const rads = [L > 0 && Tt > 0 ? rad : 0, Rr > 0 && Tt > 0 ? rad : 0, Rr > 0 && B > 0 ? rad : 0, L > 0 && B > 0 ? rad : 0];
        if (cc.roundRect) cc.roundRect(px, py, w, h, rads); else cc.rect(px, py, w, h);
      }
    };
    c.lineJoin = 'round';
    wallPath(c); c.lineWidth = edgeW * 2; c.strokeStyle = th.edge; c.stroke();   // bright edge (outer half only survives the fill)
    c.fillStyle = th.wall; c.fill();
    // "P" sign on the office's bottom wall
    const sx = 9.5 * T, sy = 12.5 * T;
    c.fillStyle = th.edge; rr(c, sx - T * .3, sy - T * .27, T * .6, T * .54, T * .1); c.fill();
    c.fillStyle = th.wall; c.font = '900 ' + (T * .46) + 'px Rubik, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('P', sx, sy + T * .03);
    // white copy of the walls, flashed on a street clear
    const [fl, fc] = mk();
    wallPath(fc); fc.lineWidth = edgeW * 2; fc.strokeStyle = '#fff'; fc.stroke(); fc.fillStyle = '#fff'; fc.fill();
    return { bg, flash: fl, lightA: null, lightB: null, bulbs: 0, theme: th };
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

  /* ---------- gate barrier (drawn each frame so it can lift) ---------- */
  function drawGate(c, T, lift) {
    const x0 = 9 * T + T * .06, y = 9 * T + T * .5;
    c.save(); c.translate(x0, y); c.rotate(-lift * 1.25);
    rr(c, 0, -T * .09, T * .9, T * .18, T * .09); c.fillStyle = '#fff'; c.fill();
    c.save(); c.clip(); c.fillStyle = '#ff4d6d'; for (let i = 0; i < 6; i++) c.fillRect(i * T * .26, -T * .1, T * .13, T * .2); c.restore();
    c.restore();
    c.fillStyle = '#ffcc33'; c.beginPath(); c.arc(x0, y, T * .1, 0, TAU); c.fill();
  }

  root.CSCArt = { ASSETS, loadAssets, THEMES, BONUS, makeCandy, drawCreemee, drawBonus, drawRaccoon, drawOfficer, OFF_STYLE, renderMaze, drawGate, leafPath, star, hexA };
})(window);
