(() => {
  const g = window.__game;
  const V = g.boat.pos.constructor;
  const out = {};
  const buckets = g.ctx.items.items.filter(i => i.kind === 'bucket');
  const b0 = buckets[0].localPos(new V()).clone();
  g.sea.swell = 0.7;
  g.boat.yaw = -20 * Math.PI / 180; // beam-on to the main swell
  g.boat.targetSpeed = 0; g.boat.speed = 0;
  let maxRoll = 0, minY = 9, playerKnocks = 0;
  const p = g.crew.player;
  for (let i = 0; i < 60 * 25; i++) {
    g.step(1 / 60);
    maxRoll = Math.max(maxRoll, Math.abs(g.boat.rollDeg));
  }
  const b1 = buckets[0].localPos(new V());
  out.bucketMoved = +b1.distanceTo(b0).toFixed(2);
  out.bucketFrom = b0.toArray().map(x => +x.toFixed(2));
  out.bucketTo = b1.toArray().map(x => +x.toFixed(2));
  out.maxRoll = +maxRoll.toFixed(1);
  out.crew = g.crew.list.map(c => c.id + ':' + c.state + ':k' + c.knockCount);
  // grab + throw test: target the second bucket
  const bucket = buckets[1];
  const ia = g.ctx.interact.list.find(x => x.itemRef === bucket);
  // walk the player to it
  const tgt = bucket.localPos(new V());
  for (let i = 0; i < 60 * 4; i++) {
    const pp = p.pos(new V());
    const dx = tgt.x - pp.x, dz = tgt.z - pp.z; const d = Math.hypot(dx, dz);
    p.input.move.set(d > 0.9 ? dx / d : 0, d > 0.9 ? dz / d : 0);
    g.step(1 / 60);
  }
  p.input.move.set(0, 0);
  p.input.targetId = ia.id; p.input.use = true; p.input.usePressed = 1;
  g.step(1 / 60);
  out.heldAfterGrab = p.held ? p.held.kind : null;
  for (let i = 0; i < 40; i++) { p.input.use = true; g.step(1 / 60); }
  out.bucketHeldPos = bucket.localPos(new V()).toArray().map(x => +x.toFixed(2));
  // throw toward the port rail
  p.input.aim = new V(2.0, 0.3, -1.0); p.input.throwAim = true; g.step(1 / 60);
  p.input.throwRelease = 1; g.step(1 / 60); p.input.throwAim = false; p.input.use = false; p.input.targetId = null;
  for (let i = 0; i < 90; i++) g.step(1 / 60);
  out.afterThrow = { held: p.held ? p.held.kind : null, pos: bucket.localPos(new V()).toArray().map(x => +x.toFixed(2)), mode: bucket.mode };
  // crab grab test
  const crab = g.crabs.crabs[0];
  out.crabPos = crab.localPos(new V()).toArray().map(x => +x.toFixed(2));
  out.bodies = g.dw.countBodies();
  return out;
})()
