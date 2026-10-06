// Headless screenshot + probe harness (uses the globally installed Playwright + Chromium).
// Usage: [SHOT_PORT=5173] node scripts/shot.mjs <url-query> <outfile.png> [waitMs] [evalJs] [--mobile | --viewport=390x844]
//   --mobile: an 844x390 touch phone held sideways · --viewport=WxH: a touch phone of that size (e.g. 390x844 upright)
//   env: WAIT_AFTER=ms (after the eval) · DPR=2 (device pixel ratio) · CLIP=x,y,w,h (screenshot just that CSS-pixel box)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [, , query = '', out = 'shot.png', waitMs = '4000', evalJs = '', flag = ''] = process.argv;
const vp = /^--viewport=(\d+)x(\d+)$/.exec(flag);
const mobile = flag === '--mobile' || !!vp;
const browser = await pw.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext(
  mobile
    ? { viewport: vp ? { width: Number(vp[1]), height: Number(vp[2]) } : { width: 844, height: 390 }, deviceScaleFactor: Number(process.env.DPR) || 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DPR) || 1 },
);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${process.env.SHOT_PORT || 5173}/${query}`, { waitUntil: 'load' });
await page.waitForTimeout(Number(waitMs));
let result = null;
if (evalJs) {
  try { result = await page.evaluate(evalJs); } catch (e) { result = 'EVAL ERROR: ' + e.message; }
}
if (process.env.WAIT_AFTER) await page.waitForTimeout(Number(process.env.WAIT_AFTER));
console.log(logs.filter(l=>!l.includes("useProgram")).slice(-40).join('\n'));
if (result !== null) console.log('RESULT:', typeof result === 'string' ? result : JSON.stringify(result, null, 1));
// software GL on a busy machine can take a while to produce a frame
const clip = process.env.CLIP ? process.env.CLIP.split(',').map(Number) : null;
try {
  await page.screenshot(clip ? { path: out, timeout: 120000, clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : { path: out, timeout: 120000 });
} catch (e) {
  console.log('SCREENSHOT FAILED:', e.message.split('\n')[0]);
}
await browser.close();
