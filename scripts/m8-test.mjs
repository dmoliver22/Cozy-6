import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('/opt/node22/lib/node_modules/playwright');
const SP = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('ERR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ' ' + m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/?autostart=1&skipTutorial=1');
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:5173/?autostart=1&skipTutorial=1');
await page.waitForTimeout(3000);
const res = await page.evaluate(() => {
  const g = window.__game;
  g.crew.player.body.setTranslation({ x: 1.0, y: 0.86, z: 5.6 }, true);
  let n = 0;
  while (g.trip.phase !== 'ended' && n < 60 * 1400) {
    g.step(1 / 60); n++;
    if (g.trip.phase === 'decision') g.trip.decide(true);
  }
  return { phase: g.trip.phase, t: g.ctx.time.toFixed(0), photos: g.photos.photos.map(p => p.caption), tank: g.crabs.tank.length };
});
console.log('TRIP', JSON.stringify(res));
await page.waitForTimeout(2500);
await page.screenshot({ path: SP + '/m8-harbor1.png' });
await page.click('[data-n="1"]');
await page.waitForTimeout(2500);
await page.click('.u-card:not(.owned)');
await page.click('[data-n="2"]');
await page.waitForTimeout(2200);
await page.click('.swatch:nth-child(3)');
await page.screenshot({ path: SP + '/m8-harbor3.png' });
await page.click('[data-n="3"]');
await page.waitForTimeout(2500);
// cook: tap three chips
const chips = await page.$$('.g-chip');
for (const c of chips.slice(0, 3)) { const b = await c.boundingBox(); await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200); }
await page.click('[data-a="cook"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: SP + '/m8-galley.png' });
await page.click('[data-a="photos"]');
await page.waitForTimeout(800);
await page.screenshot({ path: SP + '/m8-photos.png' });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('[data-pc]').catch(() => null)]);
if (dl) { await dl.saveAs(SP + '/postcard.png'); console.log('POSTCARD saved'); } else console.log('no postcard');
const save = await page.evaluate(() => localStorage.getItem('potluck.save.v1')?.length);
console.log('SAVE bytes', save);
console.log(logs.slice(-15).join('\n'));
await browser.close();
