(() => {
  const g = window.__game;
  const V = g.boat.pos.constructor;
  const out = { log: [] };
  const L = (m) => out.log.push(`${g.ctx.time.toFixed(1)} ${m}`);
  const step = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  const until = (fn, s) => { let t = 0; while (!fn() && t < s * 60) { g.step(1 / 60); t++; } return (t / 60).toFixed(1); };
  const p = g.crew.player;
  const ia = (n) => g.ctx.interact.list.find(x => x.name === n);
  window.__events.on('radio', (e) => L('RADIO ' + e.text));
  window.__events.on('knockdown', (e) => L('KNOCK ' + e.crew + ' ' + e.reason));
  window.__events.on('photo', (e) => L('PHOTO ' + e.caption));
  L('step ' + g.trip.tutStep);
  until(() => g.pots.cradlePot && g.pots.cradlePot.state === 'cradle', 10);
  L('cradle ready; bots status ' + g.bots.brains.map(b => b.crew.id + ':' + b.status).join(' '));
  // walk to the bait box & grab a jar
  p.body.setTranslation({ x: -2.2, y: 0.86, z: -1.7 }, true); step(10);
  ia('bait box').verbs('player', null)[0].start('player'); p.input.use = true; step(3);
  L('held ' + (p.held && p.held.kind) + ' step ' + g.trip.tutStep);
  p.body.setTranslation({ x: -1.4, y: 0.86, z: -0.5 }, true); p.held.body.setTranslation(p.holdPoint(new V()), true); step(3);
  ia('pot on cradle').verbs('player', 'baitJar')[0].start('player'); p.input.use = false; step(3);
  L('baited ' + g.pots.cradlePot.baited + ' step ' + g.trip.tutStep);
  const lv = ia('launcher lever').verbs('player', null)[0]; lv.start('player'); for (let i = 0; i < 30; i++) { lv.tick('player', 1 / 60); g.step(1 / 60); }
  L('launched? ' + g.pots.pots.filter(q => q.state !== 'stacked' && q.state !== 'craning' && q.state !== 'cradle').length + ' step ' + g.trip.tutStep);
  until(() => g.rogue.current, 15);
  L('rogue scheduled: ' + (g.rogue.current && g.rogue.current.label));
  // the swell waits for the brace: idle a while first
  step(60 * 10);
  L('rogue stage ' + g.rogue.current.stage + ' impactIn ' + (g.rogue.current.tImpact - g.ctx.time).toFixed(1));
  // go to the starboard rail and brace
  p.body.setTranslation({ x: -2.5, y: 0.86, z: -3.6 }, true); step(5);
  p.input.brace = true;
  until(() => !g.rogue.current || g.rogue.current.stage >= 5, 15);
  for (let i = 0; i < 60 * 3; i++) { p.input.brace = true; g.step(1 / 60); }
  p.input.brace = false;
  const ike = g.crew.get('ike');
  L('ike ' + ike.state + ' pos ' + ike.pos(new V()).toArray().map(x => x.toFixed(1)) + ' hatOn ' + ike.hatOn + ' player ' + p.state);
  step(60 * 4);
  L('phase ' + g.trip.phase + ' step ' + g.trip.tutStep);
  out.photos = g.photos.photos.map(x => x.caption);
  return out;
})()
