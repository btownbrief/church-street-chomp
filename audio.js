/* Church Street Chomp - WebAudio synth. No audio files; every sound and both music loops are made here.
 * Music: a mellow night-street groove, swapped for a bouncy "panic" loop during creemee time. */
(function (root) {
  'use strict';
  let ctx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  const S = { sfx: true, music: true, started: false };
  let timer = null, nextT = 0, step = 0, track = 'calm', playing = false, tempoMul = 1;
  let munchFlip = false, lastMunch = 0;

  function init() {
    if (ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = S.sfx ? 1 : 0; sfxBus.connect(comp);
    musBus = ctx.createGain(); musBus.gain.value = S.music ? 0.32 : 0; musBus.connect(comp);
    const len = ctx.sampleRate * 0.5; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function unlock() {
    init(); if (!ctx) return;
    if (ctx.state !== 'running' && ctx.resume) ctx.resume();
    // iOS: play even when the ringer switch is on silent (Safari 16.4+)
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    S.started = true;
  }
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && S.started && ctx.state !== 'running') ctx.resume(); }

  function tone(f, dur, type, vol, o) {
    if (!ctx || !S.sfx) return; o = o || {};
    const t0 = ctx.currentTime + (o.delay || 0), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type || 'sine'; osc.frequency.setValueAtTime(f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .2, t0 + (o.atk || .005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(o.bus || sfxBus); osc.start(t0); osc.stop(t0 + dur + .03);
  }
  function noise(dur, f, q, vol, o) {
    if (!ctx || !S.sfx) return; o = o || {};
    const t0 = ctx.currentTime + (o.delay || 0), src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.frequency.setValueAtTime(f, t0);
    if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t0 + dur); fl.Q.value = q || 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .2, t0 + (o.atk || .006)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(fl); fl.connect(g); g.connect(o.bus || sfxBus); src.start(t0); src.stop(t0 + dur + .03);
  }
  const mid = n => 440 * Math.pow(2, (n - 69) / 12);

  const sfx = {
    // crunchy candy bite: mostly a noise crunch; alternates a bright and a low bite, each a little different
    munch(m) { // m: munch-streak multiplier (1-4) brightens the crunch a little
      munchFlip = !munchFlip; const v = (0.94 + Math.random() * 0.12) * (1 + ((m || 1) - 1) * 0.07);
      const fast = ctx && ctx.currentTime - lastMunch < 0.17, k = fast ? 0.62 : 1; if (ctx) lastMunch = ctx.currentTime; // ease off in long runs
      noise(.05, (munchFlip ? 3000 : 1900) * v, 3, .14 * k);
      noise(.03, 5200 * v, 1.5, .05 * k, { delay: .012 });
      tone((munchFlip ? 330 : 260) * v, .045, 'square', .025 * k, { to: 140 });
    },
    creemee() {
      [72, 76, 79, 84, 88].forEach((n, i) => tone(mid(n), .16, 'triangle', .12, { delay: i * .045 }));
      noise(.35, 900, .7, .08, { to: 5000 });
    },
    catch(n) {
      const base = 64 + Math.min(n, 8) * 2;
      noise(.18, 600, 1.2, .14, { to: 4000 });
      tone(mid(base), .1, 'square', .07);
      tone(mid(base + 7), .14, 'square', .07, { delay: .07 });
      tone(mid(base + 12), .22, 'triangle', .12, { delay: .14 });
    },
    caught() { // the ticket printer, then a droopy phrase
      for (let i = 0; i < 9; i++) noise(.03, 3200, 4, .1, { delay: i * .035 });
      tone(160, .35, 'square', .05, { delay: 0 , to: 120 });
      [67, 63, 60, 55].forEach((n, i) => tone(mid(n), .22, 'triangle', .14, { delay: .38 + i * .16, to: mid(n) * .97 }));
    },
    nearMiss() { noise(.35, 300, .8, .16, { to: 2400, atk: .05 }); tone(70, .3, 'sine', .25, { to: 45 }); },
    bonus() { tone(mid(79), .08, 'square', .07); tone(mid(86), .2, 'triangle', .13, { delay: .07 }); noise(.15, 5000, 1, .05); },
    refill() { for (let i = 0; i < 8; i++) tone(mid(60 + i * 3), .1, 'triangle', .08, { delay: i * .035 }); },
    start() { // a cheeky little street-band hook (original)
      const mel = [[67, 0, .14], [72, .16, .14], [76, .32, .1], [74, .44, .14], [72, .6, .1], [79, .72, .32]];
      mel.forEach(m => tone(mid(m[0]), m[2] + .05, 'square', .06, { delay: m[1] }));
      mel.forEach(m => tone(mid(m[0] - 12), m[2] + .05, 'triangle', .1, { delay: m[1] }));
      [[48, 0], [55, .32], [43, .6], [48, .72]].forEach(b => tone(mid(b[0]), .2, 'triangle', .16, { delay: b[1] }));
    },
    clear() { [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => tone(mid(n), .25, 'triangle', .1, { delay: i * .08 })); },
    life() { [76, 80, 83, 88].forEach((n, i) => tone(mid(n), .18, 'sine', .14, { delay: i * .07 })); },
    tick() { tone(1800, .03, 'square', .04); },
    lose() { [64, 60, 57, 52].forEach((n, i) => tone(mid(n), .32, 'triangle', .13, { delay: i * .2 })); },
    streak(m) { [0, 4, 7, 12].slice(0, m + 1).forEach((k, i) => tone(mid(76 + k + m * 2), .09, 'square', .05, { delay: i * .04 })); noise(.12, 6000, 1, .04); },
    goal() { [72, 79, 84, 88, 91].forEach((n, i) => tone(mid(n), .16, 'triangle', .11, { delay: i * .06 })); noise(.3, 4000, .8, .05, { to: 9000, delay: .1 }); },
    siren() { tone(620, .18, 'triangle', .05, { to: 880 }); tone(880, .18, 'triangle', .05, { to: 620, delay: .18 }); }, // scooter whoop: the chase is on
    honk() { tone(330, .08, 'square', .05, { delay: .25 }); tone(330, .1, 'square', .05, { delay: .37 }); }, // tow truck: beep-beep
    ui() { tone(900, .05, 'triangle', .06, { to: 1200 }); },
    reverse() { tone(300, .05, 'sine', .05, { to: 420 }); },
  };

  /* ---------- music ---------- */
  // calm: an original late-night street groove in A minor, 4 bars (32 eighths) with an A and a B melody,
  // light kit (kick, rim, hats), and an echo on the lead. Each street plays it in its own key.
  // panic: bouncy oom-pah in D with woodblock.
  const CALM = {
    bpm: 100,
    bass: [45, 0, 0, 52, 0, 45, 57, 0, 41, 0, 0, 48, 0, 41, 53, 0, 43, 0, 0, 50, 0, 43, 55, 0, 40, 0, 0, 47, 0, 40, 52, 47],
    chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]],
    leadA: [69, 0, 72, 0, 74, 72, 0, 69, 67, 0, 69, 0, 0, 0, 64, 0, 69, 0, 72, 0, 76, 74, 72, 0, 74, 0, 0, 72, 69, 0, 0, 0],
    leadB: [76, 0, 74, 72, 0, 74, 76, 0, 79, 0, 76, 0, 74, 0, 72, 0, 74, 0, 72, 69, 0, 67, 69, 0, 72, 0, 71, 0, 69, 0, 0, 0],
  };
  const PANIC = { bpm: 168, bass: [50, 57, 50, 57, 48, 55, 48, 55, 46, 53, 46, 53, 45, 52, 49, 52], lead: [74, 0, 77, 74, 0, 72, 0, 69, 70, 0, 72, 0, 69, 0, 0, 0],
    leadB: [81, 0, 79, 77, 0, 79, 81, 0, 82, 0, 81, 79, 77, 0, 76, 0] };
  const KEYS = [0, 3, -2, 5]; let key = 0, intensity = 4; // intensity 1-4: the calm loop builds with the munch streak
  function schedule() {
    if (!ctx) return;
    const tr = track === 'panic' ? PANIC : CALM;
    const spb = 60 / (tr.bpm * tempoMul) / 2; // eighth notes
    while (nextT < ctx.currentTime + 0.25) {
      if (track === 'panic') {
        const i = step % 16, b = tr.bass[i];
        if (b) mtone(mid(b + key), spb * .8, 'square', .07, nextT);
        const l = ((step >> 4) % 2 ? tr.leadB : tr.lead)[i]; if (l) { mtone(mid(l + key), spb * .9, 'triangle', .07, nextT); mtone(mid(l + key + 12), spb * .5, 'square', .012, nextT); } // softer lead: less ear fatigue
        mnoise(.03, i % 2 ? 2400 : 1200, 6, .1, nextT);
      } else {
        const i = step % 32, phrase = (step >> 5) % 2, sw = i % 2 ? spb * .16 : 0, t = nextT + sw; // a little swing
        const b = tr.bass[i]; if (b) mtone(mid(b + key), spb * 1.6, 'triangle', .17, t);
        if (i % 8 === 0) tr.chords[i >> 3].forEach(n => mtone(mid(n + key), spb * 7, 'sine', .028, t));
        const l = (phrase ? tr.leadB : tr.leadA)[i];
        // adaptive: x1 = groove only, x2 adds the melody, x3 a harmony a third up, x4 busier hats
        if (l && intensity >= 2 && (intensity >= 3 || (step >> 6) % 3 !== 2)) {
          mtone(mid(l + key), spb * 1.3, 'triangle', .05, t); mtone(mid(l + key + 12), spb * .9, 'sine', .012, t); mtone(mid(l + key), spb * 1.1, 'triangle', .016, t + spb * 3); }
        if (i % 8 === 0) mkick(t);
        if (i % 8 === 4) mnoise(.05, 1700, 3, .06, t);
        if (l && intensity >= 3) mtone(mid(l + key + (l % 12 === 9 || l % 12 === 4 ? 3 : 4)), spb * 1.1, 'sine', .022, t);
        if (i % 2 === 1 || intensity >= 4) mnoise(.025, 8000, 1, i % 2 ? .028 : .018, t);
        if (i === 30) mnoise(.04, 3500, 2, .04, t);
      }
      nextT += spb; step++;
    }
  }
  function mkick(t0) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + .12);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(.22, t0 + .005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + .16);
    o.connect(g); g.connect(musBus); o.start(t0); o.stop(t0 + .2);
  }
  function setIntensity(n) { intensity = n; }
  function setKey(streetIdx) { key = KEYS[((streetIdx % KEYS.length) + KEYS.length) % KEYS.length]; }
  function mtone(f, dur, type, vol, t0) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + .01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(musBus); o.start(t0); o.stop(t0 + dur + .02);
  }
  function mnoise(dur, f, q, vol, t0) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + .004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(musBus); s.start(t0); s.stop(t0 + dur + .02);
  }
  function music(which) {
    if (!ctx) return;
    if (which === 'off') { playing = false; if (timer) clearInterval(timer); timer = null; return; }
    if (which !== track) { track = which; step = 0; }
    if (!playing) { playing = true; nextT = ctx.currentTime + .05; timer = setInterval(schedule, 60); }
  }
  function setTempo(m) { tempoMul = m; }

  function setSfx(on) { S.sfx = on; if (sfxBus) sfxBus.gain.value = on ? 1 : 0; }
  function setMusic(on) { S.music = on; if (musBus) musBus.gain.value = on ? .32 : 0; }

  root.CSCAudio = { unlock, suspend, resume, sfx, music, setTempo, setKey, setIntensity, setSfx, setMusic, S, get ctx() { return ctx; } };
})(window);
