(() => {
  const g = window.__game;
  const V = g.boat.pos.constructor;
  const out = { log: [], knocks: [] };
  const p = g.crew.player;
  const { events } = window.__dbg || {};
  g.ctx.sys.__knocks = out.knocks;
  for (let i = 0; i < 60 * 260; i++) {
    if (i === 0) p.body.setTranslation({ x: 1.0, y: 0.86, z: 5.6 }, true);
    g.step(1 / 60);
    if (g.trip.phase === 'haul1' && g.crew.get('dot').held && i % 20 === 0 && out.log.length < 30) {
      const dot = g.crew.get('dot');
      const gr = g.grapple.grapple;
      const tgt = g.trip.haulTarget();
      const br = g.bots.brainOf(dot); out.log.push(`${g.ctx.time.toFixed(1)} task ${br.task && br.task.name}:${br.task && br.task.t.toFixed(1)} move ${dot.input.move.toArray().map(x=>x.toFixed(2))} aim ${dot.input.aim ? dot.input.aim.toArray().map(x=>x.toFixed(1)) : '-'} thr ${dot.input.throwAim} dot ${dot.state} ${dot.pos(new V()).toArray().map(x=>x.toFixed(1))} held ${dot.held && dot.held.kind} target ${dot.target && dot.target.name} grapple ${gr.mode} thrower ${g.grapple.thrower && g.grapple.thrower.id} tgtPot ${tgt && tgt.number + ':' + tgt.state} buoyL ${tgt && tgt.buoy ? g.boat.worldToLocal(tgt.buoy.wp, new V()).toArray().map(x=>x.toFixed(1)) : '-'} nav ${g.nav.arrived}`);
    }
  }
  return out;
})()
