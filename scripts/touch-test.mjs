import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('/opt/node22/lib/node_modules/playwright');
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('ERR ' + e.message));
await page.goto('http://localhost:5173/?touch=1');
await page.waitForTimeout(3000);
// put the player next to the bait box and freeze bots
await page.evaluate(() => { const g = window.__game; g.crew.player.body.setTranslation({ x: -2.3, y: 0.86, z: -0.8 }, true); g.crew.player.facing = Math.PI; });
await page.touchscreen.tap(200, 300); // wake touch mode
await page.waitForTimeout(800);
const before = await page.evaluate(() => { const g = window.__game; return { device: g.player.lastDevice, label: g.touch.info.label, target: g.crew.player.target && g.crew.player.target.name }; });
// press & hold the Action button
const box = await page.locator('.t-action').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.evaluate(([x, y]) => {
  const el = document.querySelector('.t-action');
  const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
}, [cx, cy]);
await page.waitForTimeout(1500);
const during = await page.evaluate(() => { const g = window.__game; return { held: g.crew.player.held && g.crew.player.held.kind, use: g.crew.player.input.use }; });
await page.evaluate(([x, y]) => {
  const el = document.querySelector('.t-action');
  const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
}, [cx, cy]);
await page.waitForTimeout(1200);
const after = await page.evaluate(() => { const g = window.__game; return { held: g.crew.player.held && g.crew.player.held.kind }; });
console.log(JSON.stringify({ before, during, after, logs }));
await page.screenshot({ path: process.argv[2] });
await browser.close();
