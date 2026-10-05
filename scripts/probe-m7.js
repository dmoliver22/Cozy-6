(() => {
  const g = window.__game;
  const out = { log: [] };
  const L = (m) => out.log.push(`${g.ctx.time.toFixed(0)} ${m}`);
  let lastPhase = '';
  let lastLog = 0;
  const t0 = performance.now();
  // keep the player out of the way
  const p = g.crew.player;
  out.knocks = []; out.rogues = []; window.__events.on('rogueResolved', (e) => out.rogues.push(g.ctx.time.toFixed(0) + ':' + (e.allHeld ? 'ALLHELD' : 'fallen=' + e.fallen.join('+')))); out.overs = []; window.__events.on('overboard', (e) => e.kind === 'crew' && out.overs.push(g.ctx.time.toFixed(0) + ':' + e.who)); out.spawned = []; window.__events.on('special', (e) => out.spawned.push(g.ctx.time.toFixed(0) + ':' + e.kind)); window.__events.on('knockdown', (e) => out.knocks.push(g.ctx.time.toFixed(0) + ':' + e.crew + ':' + e.reason));
  for (let i = 0; i < 60 * (window.__secs || 600); i++) {
    if (i === 0) p.body.setTranslation({ x: 1.0, y: 0.86, z: 5.6 }, true);
    g.step(1 / 60);
    if (false && g.dw.slopeDeg > 18 && (out.spikes = out.spikes || []).length < 12) out.spikes.push(g.ctx.time.toFixed(2) + ' slope ' + g.dw.slopeDeg.toFixed(0) + ' acc ' + g.boat.acc.toArray().map(x=>x.toFixed(1)) + ' nav ' + g.nav.mode + (g.boat.pathPose ? ' path' : '') + ' yawRate ' + g.boat.yawRate.toFixed(2) + ' spd ' + g.boat.speed.toFixed(2));
    if (g.trip.phase !== lastPhase) { lastPhase = g.trip.phase; L('PHASE ' + lastPhase); if (lastPhase === 'decision') g.trip.decide(true); }
    if (g.ctx.time - lastLog > 30) {
      lastLog = g.ctx.time;
      L(`W ${g.weather.phase} sw ${g.sea.swell.toFixed(2)} st ${g.weather.storm.toFixed(2)} ice ${g.ctx.surface.totalIce().toFixed(2)} roll ${g.boat.rollDeg.toFixed(0)} | pots ${g.pots.pots.map(q => q.state[0] + (q.state === 'soaking' ? q.number : '')).join('')} tank ${g.crabs.tank.length} deckCrabs ${g.crabs.onDeck().length} bots ${g.bots.brains.map(b => b.crew.id + ':' + (b.status || '-') + (b.crew.held ? '[' + b.crew.held.kind + ']' : '')).join(' ')} nav ${g.nav.mode}${g.nav.arrived ? '*' : ''}`);
    }
    if (g.trip.phase === 'ended') break;
  }
  out.specials = { active: g.specials.active.map(i => i.data.special + ':' + i.mode), queue: g.pots.specialsQueue.slice(), spawned: out.spawned };
  out.final = { phase: g.trip.phase, stats: g.trip.stats, tank: g.crabs.tank.length, released: g.crabs.released, landings: g.pots.landings.length, curios: g.specials.curios, ms: Math.round(performance.now() - t0), bodies: g.dw.countBodies() };
  return out;
})()
