// Probe for the "Good Hands" scoring layer (stickiness spec §6). Drives the game through
// window.__game.step; the save/seed checks boot extra copies of the game in iframes.
// Run: SHOT_PORT=5910 node scripts/shot.mjs "?autostart=1&skipTutorial=1" out.png 5000 "$(cat scripts/probe-score.js)"
(async () => {
  const g = window.__game;
  const P = g.pots;
  const prog = window.__progress;
  const ev = window.__events;
  const p = g.crew.player;
  const V = g.boat.pos.constructor;
  const Q = g.boat.quat.constructor;
  const out = { checks: [], log: [] };
  const L = (m) => out.log.push(`${g.ctx.time.toFixed(1)} ${m}`);
  const check = (name, ok, detail) => out.checks.push({ name, ok: !!ok, detail });
  const step = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  const secs = (s) => step(Math.round(s * 60));
  const grades = [];
  ev.on('grade', (e) => grades.push({ t: g.ctx.time, moment: e.moment, grade: e.grade, label: e.label, points: e.points, mult: e.mult, knots: e.knots, chain: e.chain, chainUp: e.chainUp }));
  const radios = [];
  ev.on('radio', (e) => radios.push(e.text));
  let broken = 0;
  ev.on('streakBroken', () => broken++);
  g.loop.paused = true; // the probe owns the clock (also while it awaits the iframes)
  g.trip.step = () => {}; // freeze the trip director: the probe sets up each moment itself
  const sk = g.score;
  const lp = (x, y, z) => p.body.setTranslation({ x, y, z }, true);
  const park = (x, z) => { lp(x, 0.86, z); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); };

  // ------------------------------------------------------------------ helpers: the cradle and a hanging pot
  P.settingAllowed = false;
  P.autoCrane = false;
  const restack = (pot) => {
    if (pot.item) P.fromDynamic(pot);
    pot.tw = null;
    pot.state = 'stacked';
    P.setFixedInStack(pot);
  };
  const clearCradle = () => {
    const cp = P.cradlePot;
    if (cp) { P.cradlePot = null; restack(cp); }
    P.cradleMode = 'idle';
    P.cradleAngle = 0;
  };
  /** Haul a stacked pot straight up to hanging (through the real haulTick path). */
  const hang = () => {
    const pot = P.pots.find((q) => q.state === 'stacked');
    pot.catch = null;
    pot.state = 'onBlock';
    pot.stringNo = 0;
    pot.number = 1 + P.pots.indexOf(pot);
    P.blockPot = pot;
    pot.riseY = 1.0 + 0.2 + 0.45 - 0.001;
    for (let i = 0; i < 4 && pot.state !== 'hanging'; i++) P.haulTick(1 / 60, g.crew.get('mo'));
    return pot;
  };
  const target = () => { const t = new V(); P.potOnCradle(0, t, new Q()); return t; };
  const botsOff = () => {
    if (g.bots.__step) return;
    g.bots.__step = g.bots.step;
    g.bots.step = () => {};
    for (const b of g.bots.brains) {
      b.endTask();
      const i = b.crew.input;
      i.move.set(0, 0); i.use = false; i.brace = false; i.throwAim = false; i.targetId = null;
      if (b.crew.held) b.crew.releaseHeld();
    }
  };

  // ================================================================== 1. Dibs
  {
    step(30);
    clearCradle();
    if (p.held) p.releaseHeld();
    park(-1.25, -0.75); // L.launcherSpot
    const pot = hang();
    let claimedAt = -1;
    const t0 = g.ctx.time;
    let heldEarly = false;
    while (g.ctx.time - t0 < 40) {
      p.lastActiveAt = g.ctx.time; // the player is playing (an idle one is never waited on: below)
      g.step(1 / 60);
      park(-1.25, -0.75);
      const h = g.bots.board.holder('land');
      if (h && claimedAt < 0) claimedAt = g.ctx.time - t0;
      if (g.ctx.time - t0 < 5.9 && pot.item && pot.item.heldBy) heldEarly = true;
      if (pot.state === 'cradle' || pot.state === 'craning') break;
    }
    const land = P.landings[P.landings.length - 1];
    check('dibs: no bot claims the landing for 6 s while the player stands by the cradle', claimedAt >= 5.9 && !heldEarly, { claimedAt: +claimedAt.toFixed(2), heldEarly });
    check('dibs: after 6 s a bot lands it', (pot.state === 'cradle' || pot.state === 'craning') && land && land.by !== 'player', { state: pot.state, by: land && land.by, after: +(g.ctx.time - t0).toFixed(1) });
    secs(0.5);
    clearCradle();
    park(2.3, -4.3); // 5 m away, on deck by the line coil (and playing)
    const pot2 = hang();
    const t1 = g.ctx.time;
    let claim2 = -1;
    while (g.ctx.time - t1 < 3 && claim2 < 0) {
      p.lastActiveAt = g.ctx.time;
      g.step(1 / 60);
      if (g.bots.board.holder('land')) claim2 = g.ctx.time - t1;
    }
    const away = Math.hypot(p.pos(new V()).x + 1.25, p.pos(new V()).z + 0.75);
    check('dibs: with the player 5 m away a bot claims it at once', claim2 >= 0 && claim2 < 1.0 && away >= 4.9 && p.isUp, { claim2: +claim2.toFixed(2), away: +away.toFixed(2), state: p.state });
    // with nobody on the launcher spot the bot walks all the way onto it before taking hold
    let holdDist = -1;
    for (let i = 0; i < 20 * 60 && holdDist < 0; i++) {
      g.step(1 / 60);
      const hb = pot2.item && pot2.item.heldBy;
      if (hb && hb.id !== 'player') holdDist = Math.hypot(hb.pos(new V()).x + 1.25, hb.pos(new V()).z + 0.75);
    }
    check('dibs: with the launcher spot free a bot takes hold from the spot itself (≤ 0.65 m), not from beside it', holdDist >= 0 && holdDist <= 0.65, { holdDist: +holdDist.toFixed(2) });
    // let it land (or not) and tidy up
    secs(20);
    const tidy = () => {
      clearCradle();
      for (const q of P.pots) if (q.state === 'hanging' || q.state === 'deck') { P.blockPot = null; restack(q); }
      P.blockPot = null;
    };
    tidy();
    // an idle player (no input for 15 s) standing at the cradle is not waited on
    const claimWith = (x, z, active) => {
      clearCradle();
      park(x, z);
      p.lastActiveAt = active ? g.ctx.time : -1e9;
      const pot3 = hang();
      const t2 = g.ctx.time;
      let c = -1;
      while (g.ctx.time - t2 < 3 && c < 0) {
        if (active) p.lastActiveAt = g.ctx.time;
        g.step(1 / 60);
        park(x, z);
        if (g.bots.board.holder('land')) c = g.ctx.time - t2;
      }
      secs(20);
      tidy();
      void pot3;
      return +c.toFixed(2);
    };
    const idle = claimWith(-1.25, -0.75, false);
    const table = claimWith(0.3, -0.55, true);
    check('dibs: an idle player at the cradle, or one working the sorting table, is not waited on', idle >= 0 && idle < 1.0 && table >= 0 && table < 1.0, { idle, table });
  }

  // ================================================================== 2. Landing grades (+ 9. same function as the HUD)
  botsOff();
  const realLevel = P.deckLevelDeg;
  let cur = 0;
  P.deckLevelDeg = () => cur; // the HUD bubble and the landing judge both read this
  /** Feed per-frame levels while the player guides the pot over the cradle, then let go. */
  const landWith = (levels) => {
    clearCradle();
    if (p.held) p.releaseHeld();
    park(-1.25, -0.75);
    const pot = hang();
    const it = pot.item;
    const t = target();
    p.grab(it);
    p.input.use = true; // holding on (a standing player lets go when the button comes up)
    for (const lv of levels) {
      cur = lv;
      it.body.setTranslation({ x: t.x, y: t.y + 0.25, z: t.z }, true);
      it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      g.step(1 / 60);
    }
    p.input.use = false;
    p.releaseHeld();
    it.body.setTranslation({ x: t.x, y: t.y + 0.25, z: t.z }, true);
    g.step(1 / 60); // the judging step (still at the last level)
    const res = P.landings[P.landings.length - 1];
    step(20);
    if (pot.state === 'deck') { P.blockPot = null; restack(pot); }
    return res;
  };
  const rep = (v, n) => Array(n).fill(v);
  {
    const n0 = grades.length;
    const a = landWith(rep(1.0, 12));
    const b = landWith(rep(3.0, 12));
    const c = landWith(rep(6.0, 12));
    check('landing: inside the core grades PERFECT', a.grade === 'perfect' && a.by === 'player', a);
    check('landing: inside the window grades GOOD', b.grade === 'good', b);
    check('landing: outside the window is a MISS', c.grade === 'miss', c);
    const d = landWith([...rep(1.0, 12), ...rep(3.0, 3)]);
    check('landing: a release ~60 ms after leaving the core still grades PERFECT (grace)', d.grade === 'perfect', d);
    const e = landWith([...rep(1.0, 12), ...rep(3.0, 8)]);
    check('landing: …but not ~140 ms after (the grace is 80 ms)', e.grade === 'good', e);
    const lg = grades.slice(n0).filter((x) => x.moment === 'land').map((x) => x.grade + ':' + x.label + ':+' + x.points);
    check('landing: grade events for the player (DEAD LEVEL / THUNK / MISS)', lg.length === 5 && /DEAD LEVEL/.test(lg[0]) && /THUNK/.test(lg[1]) && /^miss/.test(lg[2]), lg);
    // two MISSes in a row: Mo holds her steady
    const w0 = P.levelWindow();
    landWith(rep(6.0, 12));
    landWith(rep(6.5, 12));
    const w1 = P.levelWindow();
    const moSaid = radios.some((r) => /hold her steady/.test(r));
    // HUD matches: hang one and run the HUD update
    clearCradle();
    park(-1.25, -0.75);
    const pot = hang();
    cur = 2.0;
    // two frames: the scoring layer sets the gold targets, the frame's own setLevel draws them
    g.render(1, 1 / 60, 1 / 60);
    g.render(1, 1 / 60, 1 / 60);
    const width = g.hud.levelWin.style.width;
    const want = `${(w1 / 15) * 90}%`;
    check('steady hand: two misses widen levelWindow() by 1.5° and the HUD green matches', Math.abs(w1 - w0 - 1.5) < 1e-9 && moSaid && width === want, { w0, w1, moSaid, width, want });
    // 9. determinism: the bubble shows the same value the judge reads
    const left = g.hud.levelBubble.style.left;
    const coreW = g.hud.levelCore.style.width;
    check('determinism: hud.setLevel is fed by pots.deckLevelDeg() (bubble at 2.0°) and the core width by levelCore()', left === `${50 + (2 / 15) * 45}%` && coreW === `${(P.levelCore() / 15) * 90}%`, { left, coreW });
    // tidy that pot away, then a landing at 5.0° (inside the widened window only) is GOOD and clears the bonus
    P.blockPot = null;
    restack(pot);
    const f = landWith(rep(5.0, 12));
    check('steady hand: the widened window lands a 5.0° release GOOD, then resets', f.grade === 'good' && P.levelWindow() === w0, { grade: f.grade, w: P.levelWindow() });
    // the grade the judge uses comes from the same buffer as the bubble
    check('determinism: minRecentLevel reads deckLevelDeg()', (cur = 2.5, P.minRecentLevel(0) === 2.5), { v: P.minRecentLevel(0) });
  }
  P.deckLevelDeg = realLevel;
  clearCradle();

  // ================================================================== 3. Brace grades
  const braceCase = (offset) => {
    p.input.brace = false;
    step(20);
    for (let i = 0; i < 300 && !p.isUp; i++) g.step(1 / 60);
    park(-2.5, -3.6);
    step(10);
    const set = g.rogue.schedule('starboard', 0.8, { lead: 6.5 });
    const tI = set.tImpact;
    while (g.ctx.time < tI + offset) g.step(1 / 60);
    p.input.brace = true;
    const n0 = grades.length;
    while (g.rogue.current === set && set.stage < 5) g.step(1 / 60);
    step(30);
    p.input.brace = false;
    step(10);
    const bg = grades.slice(n0).filter((x) => x.moment === 'brace');
    braceAt.push(bg.length ? +(bg[0].t - tI).toFixed(2) : null);
    return bg.length ? bg[0].grade : 'none';
  };
  const braceAt = [];
  {
    const r = { m10: braceCase(-1.0), m20: braceCase(-2.0), m40: braceCase(-4.0), p03: braceCase(0.3) };
    check('brace: −1.0 s PERFECT, −2.0 s GOOD, −4.0 s SAFE, +0.3 s CLUTCH (tier 2)', r.m10 === 'perfect' && r.m20 === 'good' && r.m40 === 'safe' && r.p03 === 'clutch', r);
    check('brace: pips recorded P G S P', sk.pips.brace.endsWith('PGSP'), sk.pips.brace);
    check('brace: graded at resolve (1.6 s after impact), once the player is known to be still up', braceAt.every((t) => t !== null && t >= 1.55 && t < 1.8), braceAt);
    // braced at impact, then the grip breaks before resolve: the sea won that one (no grade, no untie)
    p.input.brace = false;
    step(20);
    for (let i = 0; i < 300 && !p.isUp; i++) g.step(1 / 60);
    park(-2.5, -3.6);
    step(10);
    const set = g.rogue.schedule('starboard', 0.8, { lead: 6.5 });
    while (g.ctx.time < set.tImpact - 1.0) g.step(1 / 60);
    p.input.brace = true;
    sk.knots = 5;
    const n0 = grades.length;
    while (g.ctx.time < set.tImpact + 0.9) g.step(1 / 60);
    const braced = p.braced;
    p.input.brace = false;
    p.knockdown(new V(1.5, 0.5, 0), 'brace broke');
    while (g.rogue.current === set && set.stage < 5) g.step(1 / 60);
    step(30);
    const bg = grades.slice(n0).filter((x) => x.moment === 'brace');
    check('brace: a grip that breaks after the wash but before resolve gets no grade and keeps the streak', braced && bg.length === 0 && sk.knots === 5, { braced, grades: bg.map((x) => x.label), knots: sk.knots });
  }

  // ================================================================== 4. Streak
  {
    for (let i = 0; i < 60 && !p.isUp; i++) step(10);
    sk.knots = 0;
    const at = new V(0, 2, 0);
    for (let i = 0; i < 6; i++) sk.award('bonus', 'good', 10, 'test', at, true);
    const m6 = sk.mult;
    const pts = sk.award('bonus', 'good', 100, 'test', at, false);
    check('streak: 6 knots gives ×1.5 (and the next 100 pays 150 in calm water)', m6 === 1.5 && pts === 150, { m6, pts, wx: sk.weatherMult() });
    const s0 = sk.score;
    const b0 = broken;
    park(0.0, 1.0);
    step(5);
    p.knockdown(new V(1.5, 0.5, 0), 'impact');
    step(2);
    check('streak: a player knockdown unties it, the score never drops, "Knot slipped!"', sk.knots === 0 && sk.score === s0 && broken === b0 + 1, { knots: sk.knots, score: sk.score, s0 });
    for (let i = 0; i < 60 && !p.isUp; i++) step(10);
    // tier 0: only a missed landing unties
    prog.applyTier(0);
    for (let i = 0; i < 4; i++) sk.award('bonus', 'good', 10, 'test', at, true);
    const k0 = sk.knots;
    step(5);
    p.knockdown(new V(1.5, 0.5, 0), 'impact');
    step(2);
    check('streak: on tier 0 a knockdown does not untie it', k0 === 4 && sk.knots === 4, { k0, after: sk.knots });
    prog.applyTier(2);
    for (let i = 0; i < 60 && !p.isUp; i++) step(10);
    // a bot's wrong sort never unties it; the player's does
    const keeper = (by) => {
      const d = g.crabs.roll('red');
      d.keep = true; d.sex = 'm';
      const it = g.crabs.spawn(new V(-5.5, 1.0, -2.0), d, new V(-1, 0, 0));
      it.data.lastBy = by;
      it.data.lastHeldAt = g.ctx.time;
      step(40);
      return it;
    };
    const kb = sk.knots;
    keeper('dot');
    const afterBot = sk.knots;
    keeper('player');
    check('streak: a bot\'s wrong sort never unties it, the player\'s does (tier 2)', kb === 4 && afterBot === 4 && sk.knots === 0, { kb, afterBot, afterPlayer: sk.knots });
  }

  // ================================================================== 5. Sorting
  const H = { x: 0.7, y: 0.26 + 0.05, z: -2.0 }; // the hatch
  const keepIt = (it, by) => {
    it.data.lastBy = by;
    it.data.lastHeldAt = g.ctx.time;
    it.body.setTranslation(H, true);
    it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  };
  const tossIt = (it, by) => {
    it.data.lastBy = by;
    it.data.lastHeldAt = g.ctx.time;
    it.body.setTranslation({ x: -5.5, y: 1.0, z: -2.0 }, true);
    it.body.setLinvel({ x: -1, y: 0, z: 0 }, true);
  };
  {
    sk.knots = 0;
    sk.chain = 0;
    const n0 = grades.length;
    for (let i = 0; i < 5; i++) {
      const d = g.crabs.roll('red');
      d.keep = true; d.sex = 'm';
      const it = g.crabs.spawn(new V(0.7, 1.2, -1.0), d);
      keepIt(it, 'player');
      secs(1.0);
    }
    const sg = grades.slice(n0).filter((x) => x.moment === 'sort');
    const chain = sg.map((x) => x.chain);
    const sum = sg.reduce((a, x) => a + x.points, 0);
    const want = sg.reduce((a, x) => a + Math.round(10 * x.chain * x.mult), 0);
    check('sorting: player sorts 1 s apart build the chain 1→5 and pay Σ 10·k × mult', chain.join(',') === '1,2,3,4,5' && sum === want && sum === 150, { chain, sum, want });
    secs(4.0);
    const d = g.crabs.roll('red');
    d.keep = true; d.sex = 'm';
    keepIt(g.crabs.spawn(new V(0.7, 1.2, -1.0), d), 'player');
    secs(0.5);
    const last = grades[grades.length - 1];
    check('sorting: a 4 s gap at tier 2 resets the chain', last.moment === 'sort' && last.chain === 1, { chain: last.chain });
    // up to the cap of 8 and one more: only a growing chain chimes (chainUp), not every sort at the cap
    secs(4.0);
    const n1 = grades.length;
    for (let i = 0; i < 10; i++) {
      const d2 = g.crabs.roll('red');
      d2.keep = true; d2.sex = 'm';
      keepIt(g.crabs.spawn(new V(0.7, 1.2, -1.0), d2), 'player');
      secs(0.5);
    }
    const cs = grades.slice(n1).filter((x) => x.moment === 'sort');
    check('sorting: the chain caps at 8; chainUp marks growth only (the chime at 5 and 8 plays once each)', cs.map((x) => x.chain).join() === '1,2,3,4,5,6,7,8,8,8' && cs.map((x) => (x.chainUp ? 1 : 0)).join('') === '1111111100', { chain: cs.map((x) => x.chain), up: cs.map((x) => x.chainUp) });
  }
  // Clean Table: tip real pots onto the table and sort them by hand
  const tipCrabs = (spec) => {
    clearCradle();
    const pot = P.pots.find((q) => q.state === 'stacked');
    const crabs = spec.map((keep) => { const d = g.crabs.roll('red'); d.keep = keep; d.sex = keep ? 'm' : 'f'; return d; });
    pot.catch = { crabs, special: null, golden: false };
    P.cradlePot = pot;
    pot.state = 'cradle';
    const tp = new V(); P.potOnCradle(0, tp, new Q());
    P.setKinematic(pot, tp);
    let tip = null;
    const off = ev.on('potTipped', (e) => (tip = e));
    P.tip();
    secs(1.4);
    off();
    const items = g.crabs.crabs.filter((it) => it.mode === 'deck' && it.data.crab.tipId === tip.tipId);
    return { tip, items };
  };
  const clean = () => grades.filter((x) => x.label === 'CLEAN TABLE!').length;
  {
    // a: all by the player, inside 30 s, none wrong
    let c0 = clean();
    let r = tipCrabs([true, true, false, true, false, true]);
    r.items.forEach((it, i) => { (it.data.crab.keep ? keepIt : tossIt)(it, 'player'); if (i % 2) secs(0.6); });
    secs(2);
    const a = clean() - c0;
    // b: one wrong (by a bot): no Clean Table
    c0 = clean();
    r = tipCrabs([true, true, false, true]);
    r.items.forEach((it, i) => (i === 0 ? tossIt(it, 'dot') : (it.data.crab.keep ? keepIt : tossIt)(it, 'player')));
    secs(2);
    const b = clean() - c0;
    // c: only 40% by the player
    c0 = clean();
    r = tipCrabs([true, true, true, false, false]);
    r.items.forEach((it, i) => (it.data.crab.keep ? keepIt : tossIt)(it, i < 2 ? 'player' : 'dot'));
    secs(2);
    const c = clean() - c0;
    // d: too slow (the last one after 30 s)
    c0 = clean();
    r = tipCrabs([true, false, true]);
    r.items.slice(0, 2).forEach((it) => (it.data.crab.keep ? keepIt : tossIt)(it, 'player'));
    secs(31);
    const lastOne = r.items[2];
    if (lastOne.mode === 'deck') keepIt(lastOne, 'player');
    secs(2);
    const dd = clean() - c0;
    check('sorting: Clean Table only for a whole tip sorted in 30 s, 0 wrong, ≥ 50% by the player', a === 1 && b === 0 && c === 0 && dd === 0, { a, b, c, d: dd, spawned: r.tip.spawned });
    check('sorting: one pip per tip the player touched (gold = Clean Table, amber = a wrong sort)', /^P/.test(sk.summary().pips.sort), sk.summary().pips.sort);
  }

  // ================================================================== Grapple: each buoy once; only a real throw
  {
    const n0 = grades.length;
    const cs0 = sk.counts.cleanStrings;
    const hk = (pot, hit = true) => ev.emit('hooked', { by: 'player', rawErr: 0.5, dist: 5, hit, stringNo: 7, pot });
    for (let i = 0; i < 5; i++) hk(71); // the same buoy, dropped back over the rail and hooked again
    const once = grades.slice(n0).filter((x) => x.moment === 'hook' || x.label === 'EVERY BUOY!');
    const n1 = grades.length;
    [72, 73, 74, 75].forEach((n) => hk(n));
    const every = grades.slice(n1).filter((x) => x.label === 'EVERY BUOY!').length;
    check('grapple: re-hooking one buoy scores once; five different buoys (no misses) make EVERY BUOY', once.length === 1 && every === 1 && sk.counts.cleanStrings === cs0 + 1, { once: once.map((x) => x.label), every });
    // a grapple that goes overboard without a throw (a stale thrower) is nobody's throw
    let n = 0;
    const off = ev.on('hooked', () => n++);
    const G = g.grapple;
    G.thrower = p;
    G.onLand();
    G.thrower = null;
    off();
    check('grapple: no hooked event (no grade, pip or knot) for a landing that was never thrown', n === 0, { n });
    // LIFELINE: only a ring the player threw just now
    const R = g.rescue.ring;
    const n2 = grades.length;
    R.data.lastBy = 'player';
    R.data.thrownAt = g.ctx.time - 20;
    R.data.lastHeldAt = g.ctx.time - 3; // dropped on deck later, then washed over
    ev.emit('ringLanded', { worldPos: new V(), hit: true });
    const washed = grades.slice(n2).filter((x) => x.label === 'LIFELINE!').length;
    R.data.thrownAt = R.data.lastHeldAt = g.ctx.time - 1.2;
    ev.emit('ringLanded', { worldPos: new V(), hit: true });
    const thrown = grades.slice(n2).filter((x) => x.label === 'LIFELINE!').length;
    check('lifeline: a ring the player just threw scores; one dropped on deck and washed over does not', washed === 0 && thrown === 1, { washed, thrown });
  }

  // ================================================================== Show scores / reduce flashing
  {
    const fb = g.feedback;
    fb.showScores = false;
    const at = new V(0, 2, 0);
    sk.award('bonus', 'good', 100, 'WORDS ONLY', at, false);
    const pop = Array.from(document.querySelectorAll('.hud-pop.grade')).pop();
    g.hud.setScore(1234, 1.5, 4, false);
    const strip = document.querySelector('.hud-score').textContent;
    fb.showScores = true;
    g.hud.setScore(1234, 1.5, 4, true);
    const stripOn = document.querySelector('.hud-score').textContent;
    check('show scores off: the grade pop keeps its words, the numbers hide (strip too)', pop && pop.textContent === 'WORDS ONLY' && !/\d/.test(strip) && /1,234/.test(stripOn), { pop: pop && pop.textContent, strip, stripOn });
    g.hud.setScore(100, 2, 12, true);
    const s2 = document.querySelector('.hud-score').textContent;
    g.hud.setScore(4973, 1.75, 7, true);
    const s175 = document.querySelector('.hud-score').textContent;
    check('rope strip reads "⚓ 4,973 · ×1.75" and "⚓ 100 · ×2" (no "×2.0")', s175 === '⚓ 4,973 · ×1.75' && s2 === '⚓ 100 · ×2', { s175, s2 });
    const st = { ...g.settings, reduceFlashing: true };
    g.applySettings(st);
    const brace = document.querySelector('.t-brace');
    brace.classList.add('gold');
    const anim = getComputedStyle(brace).animationName;
    const fl = document.querySelector('.hud-flash');
    fl.style.background = 'rgb(1, 2, 3)';
    const flashBefore = fl.style.background;
    g.hud.flash('rgba(242,194,48,.45)'); // the PERFECT landing's gold flash
    const flashAfter = fl.style.background;
    brace.classList.remove('gold');
    g.applySettings({ ...g.settings, reduceFlashing: false });
    const anim2 = (brace.classList.add('gold'), getComputedStyle(brace).animationName);
    brace.classList.remove('gold');
    check('reduce flashing: no gold flash and the BRACE pulse holds still', document.documentElement.classList.contains('reduce-flashing') === false && anim === 'none' && anim2 === 'bracegold' && flashBefore === flashAfter, { anim, anim2, flashAfter });
  }

  // ================================================================== 8. Ramp
  {
    prog.applyTier(2);
    const same = JSON.stringify(prog.configSnapshot()) === JSON.stringify(prog.DEFAULTS);
    const T2 = prog.TIERS[2], D = prog.DEFAULTS;
    const tableMatches = T2.stormSets === D.stormRogueSets && T2.stormAmp === D.rogueAmp.storm && T2.choppyAmp === D.rogueAmp.choppy && T2.window === D.levelWindowDeg && T2.core === D.levelPerfectDeg && T2.bracePerfect === D.bracePerfectSec && T2.chain === D.chainSec && T2.aim === D.aimAssistRadius && T2.ice === D.iceScale && T2.stormGap.join() === D.stormRogueGapSec.join() && T2.choppyGap.join() === D.choppyRogueGapSec.join();
    check('ramp: applyTier(2) leaves every touched config value identical to the defaults', same && tableMatches, { same, tableMatches });
    const max = 3.0;
    prog.applyTier(4);
    const s4 = prog.configSnapshot();
    prog.applyTide({ tripsCompleted: 6 }, { tide: '5' }); // Big Swell on top
    const s4t = prog.configSnapshot();
    check('ramp: tier 4 (+ Big Swell) never exceeds maxAmp; the window never under 4.0°', s4.rogueAmp.storm <= max && s4t.rogueAmp.storm <= max && s4t.rogueAmp.choppy <= max && s4.levelWindowDeg >= 4.0 && s4t.stormRogueSets === 5 && s4t.priceScale === 1.2, { s4: s4.rogueAmp, s4t: s4t.rogueAmp, sets: s4t.stormRogueSets, win: s4.levelWindowDeg });
    const winOk = prog.TIERS.every((t) => t.window >= 4.0);
    prog.applyTier(0);
    const s0 = prog.configSnapshot();
    check('ramp: tier 0 is softer (window 6°, core 2°, 2 storm sets, hints on, lenient)', s0.levelWindowDeg === 6 && s0.levelPerfectDeg === 2 && s0.stormRogueSets === 2 && s0.hints && s0.lenient && winOk, s0);
    prog.applyTier(2);
    check('ramp: back to tier 2 clears the tide too', JSON.stringify(prog.configSnapshot()) === JSON.stringify(prog.DEFAULTS), {});
    check('ramp: TRIP_TIER maps trips 1..10 to 0,1,2,2,3,3,4,4,4,4 and autostart is tier 2', [0, 1, 2, 3, 4, 5, 6, 9, 30].map((n) => prog.tierFor({ tripsCompleted: n }, {})).join() === '0,1,2,2,3,3,4,4,4' && prog.tierFor({ tripsCompleted: 7 }, { autostart: '1' }) === 2 && prog.tierFor({ tripsCompleted: 0 }, { tier: '3' }) === 3, {});
  }

  // ================================================================== 7. Daily seed (in-page parts)
  {
    check('seed: with ?autostart=1 the seed is 20251005', g.ctx.rng.seed === 20251005, g.ctx.rng.seed);
    const d = new Date(2026, 0, 1, 12);
    let repeats = 0;
    let prev = prog.tideIndex(prog.todayKey(d));
    const seen = new Set();
    for (let i = 0; i < 800; i++) {
      d.setDate(d.getDate() + 1);
      const k = prog.todayKey(d);
      const idx = prog.tideIndex(k);
      seen.add(idx);
      if (idx === prev) repeats++;
      prev = idx;
    }
    // stub the clock to "yesterday" and "today"
    const realNow = prog.clock.now;
    prog.clock.now = () => new Date(2026, 9, 5, 9);
    const y = prog.tideIndex();
    prog.clock.now = () => new Date(2026, 9, 6, 9);
    const t = prog.tideIndex();
    prog.clock.now = realNow;
    check('tide: the flavour never repeats on consecutive days (800 days), all 7 appear', repeats === 0 && seen.size === 7 && y !== t, { repeats, kinds: seen.size, yesterday: y, today: t });
    const before = JSON.stringify(prog.configSnapshot());
    const idx = prog.applyTide({ tripsCompleted: 0 }, {});
    check('tide: the tutorial trip gets no flavour', idx === -1 && JSON.stringify(prog.configSnapshot()) === before, { idx });
    const forced = prog.tideFor({ tripsCompleted: 0 }, { autostart: '1', skipTutorial: '1', tide: '5' });
    check('tide: ?tide=N is honoured on a fresh save too', forced === 5, { forced });
    // the trip's date is fixed at boot: a trip that runs past midnight still counts for its own day
    const k0 = prog.tripDateKey();
    prog.clock.now = () => new Date(2031, 0, 1, 0, 5);
    const k1 = prog.tripDateKey();
    const save2 = { tripsCompleted: 2, mastery: undefined, tides: {}, daysAtSea: 0, lastDay: null };
    prog.recordTrip(save2, sk.summary());
    const lvDate = prog.logView(save2, sk.summary(), g.trip.stats, true).dateLine;
    prog.clock.now = realNow;
    check('date: the trip is recorded under the day it was fished (captured at boot), not the day it ended', k1 === k0 && Object.keys(save2.tides).join() === k0 && save2.lastDay === k0 && !/Jan/.test(lvDate), { k0, k1, tides: Object.keys(save2.tides), lvDate });
  }

  // ================================================================== 6. Save: history and tides stay small
  {
    const save = { tripsCompleted: 3, mastery: undefined, tides: {}, daysAtSea: 0, lastDay: null };
    const summary = sk.summary();
    const d = new Date(2026, 3, 1, 12);
    for (let i = 0; i < 20; i++) {
      d.setDate(d.getDate() + 1);
      prog.recordTrip(save, { ...summary, score: 1000 + i }, prog.todayKey(d));
      if (i % 3 === 0) prog.recordTrip(save, { ...summary, score: 500 }, prog.todayKey(d));
    }
    const k = Object.keys(save.tides);
    check('save: history ≤ 10 and tides ≤ 14 after 20 dates; days at sea counts dates', save.mastery.history.length === 10 && k.length === 14 && save.daysAtSea === 20 && save.tides[k[k.length - 1]].best === 1019, { history: save.mastery.history.length, tides: k.length, days: save.daysAtSea });
    // the Log for a parked trip: Greenhorn, "Lend a hand!", no amber
    const empty = { score: 0, bestStreak: 0, pips: { land: '', brace: '', hook: '', sort: '' }, counts: Object.fromEntries(Object.keys(summary.counts).map((c) => [c, 0])), tier: 2, tide: -1, tumbles: { ike: 1 } };
    const lv = prog.logView({ tripsCompleted: 1, mastery: undefined, tides: {} }, empty, g.trip.stats, true);
    check('log: a parked trip is a Greenhorn with the "Lend a hand!" tip and no pips', lv.rankName === 'Greenhorn' && /Lend a hand/.test(lv.tip) && lv.rows.every((r) => !r.pips), { rank: lv.rankName, tip: lv.tip });
    // standing about on deck and knocked over by the waves is still not lending a hand
    const knocked = { ...empty, pips: { ...empty.pips, brace: 'MMMM' }, counts: { ...empty.counts, braceMiss: 4 } };
    const tip2 = prog.tipFor(knocked);
    check('log: an idle player knocked down by four waves still gets "Lend a hand!"', /Lend a hand/.test(tip2), { tip: tip2 });
  }

  // ================================================================== One ScoreKeeper on the bus
  {
    const n0 = grades.length;
    const k2 = new sk.constructor(g.ctx); // e.g. a second Game in the same page
    ev.emit('potLanded', { good: true, levelDeg: 0.5, grade: 'perfect', by: 'player', dx: 0.1, stringNo: -1, pot: 99 });
    const lands = grades.slice(n0).filter((x) => x.moment === 'land').length;
    check('score: a second ScoreKeeper replaces the first on the event bus (a landing grades once, not twice)', lands === 1 && k2.score > 0, { lands, k2: k2.score });
    k2.dispose();
  }

  // ================================================================== 6/7. A returning v1 save, booted in an iframe
  const boot = (src) =>
    new Promise((res) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:400px;border:0;z-index:99;opacity:0.01';
      f.src = src;
      document.body.appendChild(f);
      const t0 = performance.now();
      const poll = () => {
        const w = f.contentWindow;
        if (w && w.__game && w.document.querySelector('.chart-screen, .title-screen')) return res(f);
        if (performance.now() - t0 > 60000) return res(f);
        setTimeout(poll, 200);
      };
      poll();
    });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  {
    const v1 = { version: 1, tripsCompleted: 3, coins: 120, upgrades: ['railNets'], hatColor: 0xf2c230, photos: [{ img: 'data:image/jpeg;base64,/9j/4AAQ', caption: 'Ike, airborne', kind: 'wipeout' }], buff: null, finds: { boot: true, bell: false, lore: [2] }, lastTrip: { earnings: 412, kg: 60.2, crabs: 22, golden: 1, overboards: 1, allHeld: 3, date: '2026-10-01T10:00:00.000Z' } };
    localStorage.setItem('potluck.save.v1', JSON.stringify(v1));
    const f = await boot('/');
    const w = f.contentWindow;
    const gg = w.__game;
    const chart = w.document.querySelector('.chart-screen');
    const s = gg && gg.save;
    check('save: a v1 save loads, the chart renders, mastery and tides have defaults, old fields kept', !!chart && /trip 4/.test(chart.textContent) && /Not fished yet today/.test(chart.textContent) && s.mastery && s.mastery.bestScore === 0 && s.mastery.history.length === 0 && s.mastery.perfects.land === 0 && JSON.stringify(s.tides) === '{}' && s.photos.length === 1 && s.upgrades[0] === 'railNets' && s.finds.boot, { chart: chart && chart.textContent.replace(/\s+/g, ' ').slice(0, 220) });
    check('seed: with no URL flags the seed is dailySeed()', gg.ctx.rng.seed === w.__progress.dailySeed(), { seed: gg.ctx.rng.seed, daily: w.__progress.dailySeed() });
    check('tide: a returning trip gets today\'s tide and tier 2 (trip 4)', w.__progress.tideFor(s) === w.__progress.tideIndex() && gg.ctx && w.__progress.tierFor(s) === 2, { tide: w.__progress.tideFor(s) });
    // play the end of a trip through: Log → fish buyer → galley, and check the save is written as v2
    w.document.querySelector('.chart-screen [data-go]').click();
    await wait(300);
    gg.score.award('land', 'perfect', 300, 'DEAD LEVEL!', new w.__game.boat.pos.constructor(0, 2, 0), true);
    gg.trip.end();
    await wait(1700);
    const logCard = w.document.querySelector('.log-card');
    const logText = logCard ? logCard.textContent.replace(/\s+/g, ' ') : '';
    const btn = w.document.querySelector('.log-go');
    const btnH = btn ? btn.getBoundingClientRect().height : 0;
    check('log: the Deckhand\'s Log shows before the fish buyer (rank stamp, rows, tip, 64 px button)', !!logCard && /Deckhand's Log/.test(logText) && /Greenhorn/.test(logText) && /Landing/.test(logText) && /fish buyer/.test(logText) && btnH >= 64 && !gg.harbor, { text: logText.slice(0, 260), btnH });
    const focused = w.document.activeElement === btn;
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    await wait(1500);
    const hadHarbor = !!gg.harbor;
    gg.harbor && gg.harbor.onDone && gg.harbor.onDone();
    await wait(1500);
    const saved = JSON.parse(w.localStorage.getItem('potluck.save.v1') || '{}');
    const today = w.__progress.todayKey();
    const gsub = w.document.querySelector('.g-sub');
    check('log: Enter carries on to the fish buyer (the button has focus)', focused && hadHarbor, { focused, hadHarbor });
    check('save: after a trip it is written back (still version 1, so an older cached build keeps it) with history, today\'s tide and a day at sea', hadHarbor && saved.version === 1 && saved.tripsCompleted === 4 && saved.mastery.history.length === 1 && saved.tides[today] && saved.tides[today].runs === 1 && saved.daysAtSea === 1 && saved.lastDay === today && saved.photos.length >= 0, { version: saved.version, trips: saved.tripsCompleted, history: saved.mastery && saved.mastery.history, tide: saved.tides && saved.tides[today], days: saved.daysAtSea });
    check('galley: the g-sub line carries the rank and score', !!gsub && /Greenhorn \d/.test(gsub.textContent), gsub && gsub.textContent);
    f.remove();
    const f2 = await boot('/?seed=7');
    check('seed: with ?seed=7 the seed is 7', f2.contentWindow.__game.ctx.rng.seed === 7, f2.contentWindow.__game.ctx.rng.seed);
    f2.remove();
    localStorage.removeItem('potluck.save.v1');
  }

  out.pass = out.checks.every((c) => c.ok);
  out.failed = out.checks.filter((c) => !c.ok).map((c) => c.name);
  out.score = { score: sk.score, knots: sk.knots, best: sk.bestKnots, pips: sk.summary().pips };
  out.gradeCount = grades.length;
  return out;
})()
