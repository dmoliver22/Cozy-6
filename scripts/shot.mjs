// Headless screenshot + probe harness (uses the globally installed Playwright + Chromium).
// Usage: node scripts/shot.mjs <url-query> <outfile.png> [waitMs] [evalJs] [--mobile]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [, , query = '', out = 'shot.png', waitMs = '4000', evalJs = '', flag = ''] = process.argv;
const mobile = flag === '--mobile';
const browser = await pw.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext(
  mobile
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:5173/${query}`, { waitUntil: 'load' });
await page.waitForTimeout(Number(waitMs));
let result = null;
if (evalJs) {
  try { result = await page.evaluate(evalJs); } catch (e) { result = 'EVAL ERROR: ' + e.message; }
}
if (process.env.WAIT_AFTER) await page.waitForTimeout(Number(process.env.WAIT_AFTER));
await page.screenshot({ path: out });
console.log(logs.filter(l=>!l.includes("useProgram")).slice(-40).join('\n'));
if (result !== null) console.log('RESULT:', typeof result === 'string' ? result : JSON.stringify(result, null, 1));
await browser.close();
