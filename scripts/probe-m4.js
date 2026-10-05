(() => {
  const g = window.__game;
  const V = g.boat.pos.constructor;
  const out = { log: [] };
  const L = (m) => out.log.push(`${g.ctx.time.toFixed(1)} ${m}`);
  const step = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  const until = (fn, maxSec) => { let t = 0; while (!fn() && t < maxSec * 60) { g.step(1 / 60); t++; } return t / 60; };
  const p = g.crew.player;
  const ia = (name) => g.ctx.interact.list.find(x => x.name === name);
  const tp = (x, z) => { p.body.setTranslation({ x, y: 0.86, z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); if (p.held && p.held.body) p.held.body.setTranslation({ x, y: 1.3, z: z + 0.5 }, true); };
  const verb = (name, id) => { const i = ia(name); const vs = i && i.verbs('player', p.held ? p.held.kind : null); const v = vs && (id ? vs.find(x => x.id === id) : vs[0]); return v; };
  g.sea.swell = 0.3;
  // keep the other crew out of the way for this test
  for (const c of g.crew.list) if (c.id !== 'player' && c.id !== 'mo') c.body.setTranslation({ x: 1.5, y: 0.86, z: -3 - (c.id === 'ike' ? 0.8 : 0) }, true);
  g.nav.cruise(0, 1.6);
  // ---- SET a string of 5
  for (let k = 0; k < 5; k++) {
    until(() => g.pots.cradlePot && g.pots.cradlePot.state === 'cradle', 10);
    tp(-2.3, -0.8);
    step(5);
    const tb = verb('bait box'); if (!tb) { L('no bait verb'); break; }
    tb.start('player'); p.input.use = true; step(3);
    tp(-1.4, -0.4); step(3);
    const pb = verb('pot on cradle'); if (!pb) { L('no placeBait verb, held=' + (p.held && p.held.kind)); break; }
    pb.start('player'); p.input.use = false; step(2);
    const lv = verb('launcher lever', 'launch'); if (!lv) { L('no launch verb'); break; }
    lv.start('player'); for (let i = 0; i < 30; i++) { lv.tick('player', 1 / 60); g.step(1 / 60); } lv.end && lv.end('player');
    until(() => g.pots.pots.some(q => q.number === k + 1 && q.state === 'soaking'), 8);
    L(`pot ${k + 1} soaking, buoy=${!!g.pots.pots.find(q => q.number === k + 1).buoy}`);
    step(60 * 4);
  }
  out.soaking = g.pots.soakingPots().length;
  g.nav.hold();
  step(60 * 120); // soak
  // ---- HAUL
  const results = [];
  for (const pot of g.pots.soakingPots(0).slice().sort((a, b) => a.number - b.number)) {
    const r = { n: pot.number };
    g.nav.alongside(() => pot.buoy ? pot.buoy.wp : null, 0);
    r.approachSec = +until(() => g.nav.arrived, 90).toFixed(1);
    const bl = g.boat.worldToLocal(pot.buoy.wp, new V());
    r.buoyLocal = bl.toArray().map(x => +x.toFixed(1));
    // grab the grapple and throw it at the buoy (crew API; input mapping is covered by the M2/M3 probes)
    tp(-2.4, -0.7); step(10);
    if (p.held) p.drop();
    p.grab(g.grapple.grapple);
    if (p.held && p.held.body) p.held.body.setTranslation(p.holdPoint(new V()), true);
    step(2);
    if (!p.held) { r.err = 'no grapple'; results.push(r); continue; }
    p.throwTo(g.boat.worldToLocal(pot.buoy.wp, new V()));
    const gr = g.grapple.grapple; let landed = null; const tr=[];
    for (let i = 0; i < 200 && !(p.held && p.held.kind === 'lineEnd'); i++) { g.step(1/60); if (i % 10 === 0) tr.push(gr.mode + ':' + (gr.mode === 'sea' ? g.boat.worldToLocal(gr.wp, new V()).toArray().map(x=>x.toFixed(1)).join(',') + ':' + gr.seaPhase : gr.localPos(new V()).toArray().map(x=>x.toFixed(1)).join(','))); }
    r.gtrace = tr.slice(0, 14);
    r.grapple = g.grapple.lastResult; r.line = p.held ? p.held.kind : null;
    if (!r.line) { results.push(r); continue; }
    tp(-2.1, 2.7); step(5);
    const cv = verb('block'); if (cv) cv.start('player'); else r.err = 'no clip';
    const hv = verb('hauler');
    r.haulSec = +until(() => { if (hv) hv.tick('player', 1 / 60); return pot.state === 'hanging'; }, 30).toFixed(1);
    step(60);
    // guide & land when level
    const potIa = g.ctx.interact.list.find(x => x.itemRef === pot.item);
    tp(-2.0, -0.5); step(5);
    if (!potIa) { r.err = 'not hanging: ' + pot.state; results.push(r); break; }
    p.input.targetId = potIa.id; p.input.usePressed = 1; p.input.use = true; step(2); p.input.targetId = null;
    r.guiding = p.held === pot.item;
    if (!r.guiding) { const it = pot.item; const pp = p.pos(new V()); r.dbg = { item: !!it, itemPos: it && it.localPos(new V()).toArray().map(x=>+x.toFixed(2)), player: pp.toArray().map(x=>+x.toFixed(2)), verbs: potIa && (potIa.verbs('player', null)||[]).map(v=>v.id), inReach: potIa && p.inReach(potIa, pp), target: p.target && p.target.name, held: p.held && p.held.kind, state: p.state }; }
    step(90);
    { const it = pot.item; const b = it.body; const contacts = []; g.dw.world.contactPairsWith(it.collider, (c2) => { const o = g.dw.ownerOf(c2); contacts.push(o ? o.kind : '?'); }); r.body = { dyn: b.isDynamic(), en: b.isEnabled(), mass: +b.mass().toFixed(0), lv: [b.linvel().x.toFixed(2), b.linvel().y.toFixed(2)], sleeping: b.isSleeping(), contacts, ropeLen: pot.ropeLen, groups: it.collider.collisionGroups().toString(16) }; }
    r.trace = [];
    for (let i = 0; i < 12; i++) { p.input.use = true; step(10); const it = pot.item; const lp = it.localPos(new V()); r.trace.push([+lp.x.toFixed(2), +lp.y.toFixed(2), +lp.z.toFixed(2), +g.pots.deckLevelDeg().toFixed(1), p.held === it ? 'H' : '-', g.pots.cradlePot ? 'C' : '']); }
    const lw = until(() => { p.input.use = true; const it = pot.item; if (!it) return true; const lp = it.localPos(new V()); return Math.abs(g.pots.deckLevelDeg()) < 2.5 && Math.hypot(lp.x + 2.1, lp.z - 1.1) < 0.75; }, 20);
    p.input.use = false; step(30);
    r.landWait = +lw.toFixed(1);
    r.landed = g.pots.landings.length ? g.pots.landings[g.pots.landings.length - 1] : null;
    r.state = pot.state;
    if (pot.state === 'cradle') {
      const tv = verb('launcher lever', 'tip');
      tp(-1.4, -0.6); step(3);
      const tv2 = verb('launcher lever', 'tip');
      if (tv2) { tv2.start('player'); for (let i = 0; i < 30; i++) { tv2.tick('player', 1 / 60); g.step(1 / 60); } }
      step(60 * 3);
      r.crabsOnDeck = g.crabs.onDeck().length;
    }
    results.push(r);
    // quick sort: drop keepers into the hatch, toss the rest
    for (const c of g.crabs.onDeck().slice()) {
      const d = c.data.crab;
      if (d.keep) c.body.setTranslation({ x: 0.7, y: 0.3, z: -2.0 }, true);
      else { c.body.setTranslation({ x: -3.6, y: 1.5, z: -1 }, true); c.body.setLinvel({ x: -2, y: 1, z: 0 }, true); }
    }
    step(60);
    if (results.length >= 5) break;
  }
  out.results = results;
  out.tank = g.crabs.tank.length;
  out.released = g.crabs.released;
  out.landings = g.pots.landings;
  out.stack = g.pots.stackCount();
  out.bodies = g.dw.countBodies();
  out.specials = g.specials.curios;
  return out;
})()
