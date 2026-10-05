(() => {
  const g = window.__game;
  const V = g.boat.pos.constructor;
  const out = {};
  const step = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  const p = g.crew.player;
  g.sea.swell = 0.6;
  g.boat.targetSpeed = 0;
  // move player to the starboard rail and brace
  p.body.setTranslation({ x: -2.4, y: 0.86, z: -2.0 }, true);
  step(30);
  p.input.brace = true; step(5);
  out.playerBraced = p.braced;
  g.triggerRogue('starboard', 2.6, 6);
  const log = [];
  let maxRoll = 0;
  for (let i = 0; i < 60 * 10; i++) { p.input.brace = true; g.step(1/60); maxRoll = Math.max(maxRoll, Math.abs(g.boat.rollDeg)); }
  out.maxRollDuringRogue = +maxRoll.toFixed(1);
  out.afterRogue = g.crew.list.map(c => c.id + ':' + c.state + ':k' + c.knockCount + (c.braced ? ':braced' : ''));
  out.history = g.rogue.history;
  p.input.brace = false;
  step(60 * 3);
  out.afterRecover = g.crew.list.map(c => c.id + ':' + c.state);
  // more rogues to see overboards
  let overs = 0;
  const off = [];
  for (let k = 0; k < 4; k++) {
    g.triggerRogue(k % 2 ? 'port' : 'starboard', 2.8, 5);
    for (let i = 0; i < 60 * 9; i++) { g.step(1/60); }
    overs += g.crew.list.filter(c => c.inSea).length;
    off.push(g.crew.list.map(c => c.id[0] + ':' + c.state).join(' '));
  }
  out.rogueSeries = off;
  out.knockTotal = g.crew.knockdowns;
  // force Ike overboard and rescue with the ring
  for (let i = 0; i < 60 * 60 && !g.crew.list.every(c => c.state === 'stand'); i++) g.step(1/60);
  out.allBackAboard = g.crew.list.map(c => c.id + ':' + c.state);
  const ike = g.crew.get('ike');
  if (!ike.inSea) ike.goOverboard();
  step(30);
  out.ikeState = ike.state;
  // player: teleport near ring hook, grab ring
  p.body.setTranslation({ x: -1.3, y: 0.86, z: 2.2 }, true);
  p.body.setLinvel({x:0,y:0,z:0}, true);
  step(20);
  const ringIa = g.ctx.interact.list.find(x => x.itemRef === g.rescue.ring);
  p.input.targetId = ringIa.id; p.input.usePressed = 1; p.input.use = true; step(2); p.input.use = false; p.input.targetId = null;
  out.playerHolds = p.held ? p.held.kind : null;
  // walk to a rail on Ike's side
  const ikeLocal = g.boat.worldToLocal(ike.wp, new V());
  out.ikeLocal = ikeLocal.toArray().map(x => +x.toFixed(1));
  const side = ikeLocal.x >= 0 ? 1 : -1;
  p.body.setTranslation({ x: side * 2.5, y: 0.86, z: -1.5 }, true);
  g.rescue.ring.body.setTranslation({ x: side * 2.5, y: 1.2, z: -0.9 }, true);
  step(20);
  out.stillHolding = p.held ? p.held.kind : null;
  const tgt = g.boat.worldToLocal(ike.wp, new V());
  p.input.aim = tgt.clone(); p.input.throwAim = true; step(3);
  p.input.throwRelease = 1; step(1); p.input.throwAim = false;
  step(100);
  out.ringMode = g.rescue.ring.mode + ':' + g.rescue.ring.seaPhase;
  out.swimmerOnRing = ike.onRing;
  out.ringToIke = +Math.hypot(g.rescue.ring.wp.x - ike.wp.x, g.rescue.ring.wp.z - ike.wp.z).toFixed(2);
  // pull
  const ropeIa = g.ctx.interact.list.find(x => x.name === 'rope');
  let t = 0;
  for (; t < 60 * 20 && ike.inSea; t++) { p.input.use = true; if (t === 0) p.input.usePressed = 1; g.step(1/60); }
  p.input.use = false;
  out.pullSeconds = +(t / 60).toFixed(1);
  out.ikeAfterPull = ike.state;
  step(120);
  out.ikeLater = ike.state;
  // crane auto-rescue
  const dot = g.crew.get('dot');
  if (dot.isUp) dot.goOverboard();
  let ct = 0;
  for (; ct < 60 * 40 && dot.inSea; ct++) g.step(1/60);
  out.craneRescueAfter = +(ct / 60).toFixed(1);
  out.dotState = dot.state;
  out.bodies = g.dw.countBodies();
  return out;
})()
