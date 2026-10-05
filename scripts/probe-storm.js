// M9 stability test: 10 minutes of sim in a locked storm with rogue sets back to back.
// Checks for NaN, fall-throughs, runaway velocities and the dynamic body budget.
// Run: node scripts/shot.mjs "?autostart=1&skipTutorial=1&weather=storm" out.png 2500 "$(cat scripts/probe-storm.js)"
(() => {
  const g = window.__game;
  const V = g.boat.pos.constructor;
  if (g.weather.forced !== 'storm') g.weather.force('storm');
  const out = { log: [], maxBodies: 0, maxAwake: 0, nan: 0, fallThrough: [], maxSpeed: 0, overboards: 0, knockdowns: 0, rogues: 0, allHeld: 0, msPerStep: 0, longestLoosePot: 0, landings: { good: 0, bad: 0 } };
  window.__events.on('potLanded', (e) => out.landings[e.good ? 'good' : 'bad']++);
  const looseSince = new Map();
  window.__events.on('overboard', (e) => e.kind === 'crew' && out.overboards++);
  window.__events.on('knockdown', (e) => e.reason !== 'flop' && out.knockdowns++);
  window.__events.on('rogueResolved', (e) => { out.rogues++; if (e.allHeld) out.allHeld++; });
  const bad = (x) => !Number.isFinite(x);
  const p = new V();
  const t0 = performance.now();
  const SECS = 600;
  for (let s = 0; s < SECS; s++) {
    for (let i = 0; i < 60; i++) g.step(1 / 60);
    const bc = g.dw.countBodies();
    out.maxBodies = Math.max(out.maxBodies, bc.total);
    out.maxAwake = Math.max(out.maxAwake, bc.awake);
    if (bad(g.boat.pos.x) || bad(g.boat.pos.y) || bad(g.boat.rollDeg)) out.nan++;
    for (const c of g.crew.list) {
      c.pos(p);
      if (bad(p.x) || bad(p.y) || bad(p.z)) out.nan++;
      if (!c.inSea && c.body && c.body.isEnabled() && p.y < -0.5) out.fallThrough.push(`${s}s ${c.id} y=${p.y.toFixed(2)}`);
    }
    for (const it of g.ctx.items.items) {
      if (it.mode !== 'deck' || !it.body || !it.body.isEnabled()) continue;
      const t = it.body.translation();
      const v = it.body.linvel();
      if (bad(t.x) || bad(t.y) || bad(t.z)) out.nan++;
      if (t.y < -0.6) out.fallThrough.push(`${s}s ${it.def.kind} y=${t.y.toFixed(2)}`);
      out.maxSpeed = Math.max(out.maxSpeed, Math.hypot(v.x, v.y, v.z));
    }
    for (const q of g.pots.pots) {
      if (q.state === 'deck') {
        if (!looseSince.has(q)) looseSince.set(q, s);
        out.longestLoosePot = Math.max(out.longestLoosePot, s - looseSince.get(q));
      } else looseSince.delete(q);
    }
    if (s % 60 === 59) out.log.push(`${s + 1}s phase ${g.trip.phase} bodies ${bc.total} swell ${g.sea.swell.toFixed(2)} ice ${g.ctx.surface.totalIce().toFixed(2)} tank ${g.crabs.tank.length} rogues ${out.rogues}`);
  }
  out.msPerStep = ((performance.now() - t0) / (SECS * 60)).toFixed(3);
  out.fallThrough = out.fallThrough.slice(0, 20);
  out.maxSpeed = out.maxSpeed.toFixed(1);
  return out;
})()
