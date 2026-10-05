// Local stand-in for the claude.ai Artifact viewer, for testing artifact/pot-luck.html.
//
//   node scripts/artifact-test.mjs [options] [outPrefix] [evalJs]
//
// What it reproduces:
// - the publisher's skeleton around the page (doctype/head/reset with :root safe-area padding,
//   off-white body, [hidden]{display:none!important})
// - a CSP that only admits inline scripts and the CDN allowlist (no fetch to other hosts),
//   with or without WebAssembly ('wasm-unsafe-eval')
// - a cross-origin sandboxed iframe (no allow-downloads, no allow-modals, no gamepad policy)
// - window.claude.use('downloads') stub that records saves (or null with --no-claude)
// - jsDelivr requests answered from node_modules (same npm files the CDN serves)
//
// Options: --port=N (default 5700; uses N and N+1)  --mobile  --opaque (sandbox without
// allow-same-origin: storage throws)  --no-wasm  --no-claude  --wait=ms (default 6000)
// --no-self-scripts (script-src without 'self': the page's own files can't run as scripts)
// --blob-scripts (add blob: to script-src)  --viewport=WxH  --init=<js run in the frame before
// the page's scripts>  --click=x,y (click/tap at these viewport coords after load, repeatable)
// The frame also serves artifact/rapier-js.mjs at ./rapier-js.mjs, as the published artifact does.
// Prints JSON: {errors, consoleErrors, result, screenshot}
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require('/opt/node22/lib/node_modules/playwright');

const root = new URL('..', import.meta.url).pathname;
const opts = { port: 5700, wait: 6000, clicks: [] };
const rest = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
  else if (a === '--mobile') opts.mobile = true;
  else if (a === '--opaque') opts.opaque = true;
  else if (a === '--no-wasm') opts.noWasm = true;
  else if (a === '--no-claude') opts.noClaude = true;
  else if (a.startsWith('--wait=')) opts.wait = Number(a.slice(7));
  else if (a.startsWith('--click=')) opts.clicks.push(a.slice(8).split(',').map(Number));
  else if (a === '--no-self-scripts') opts.noSelfScripts = true;
  else if (a === '--blob-scripts') opts.blobScripts = true;
  else if (a.startsWith('--viewport=')) opts.viewport = a.slice(11).split('x').map(Number);
  else if (a.startsWith('--init=')) opts.init = a.slice(7);
  else rest.push(a);
}
const [outPrefix = '/tmp/artifact-test', evalJs = ''] = rest;
const HOST = opts.port;
const FRAME = opts.port + 1;

const page = readFileSync(join(root, 'artifact', 'pot-luck.html'), 'utf8');
const claudeStub = opts.noClaude
  ? ''
  : `<script>window.__saves=[];window.claude={use:function(n){return new Promise(function(r){setTimeout(function(){r(n==='downloads'?Object.freeze({save:function(q){var size=q.data&&(q.data.size||q.data.byteLength||q.data.length)||0;window.__saves.push({filename:q.filename,size:size});return Promise.resolve({status:'saved'})}}):null)},30)})}};</script>`;
const initScript = opts.init ? `<script>${opts.init}</script>` : '';
const skeleton = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.4 system-ui,sans-serif;background:#fbfaf7}img{max-width:100%}[hidden]{display:none!important}</style>${claudeStub}${initScript}</head><body>${page}</body></html>`;
const rapierJsPath = join(root, 'artifact', 'rapier-js.mjs');
const csp = [
  "default-src 'none'",
  `script-src 'unsafe-inline'${opts.noSelfScripts ? '' : " 'self'"}${opts.blobScripts ? ' blob:' : ''} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com${opts.noWasm ? '' : " 'wasm-unsafe-eval'"}`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

const frameServer = createServer((req, res) => {
  if (req.url.split('?')[0] === '/rapier-js.mjs' && existsSync(rapierJsPath)) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-security-policy': csp });
    res.end(readFileSync(rapierJsPath));
    return;
  }
  if (req.url !== '/' && !req.url.startsWith('/?')) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp });
  res.end(skeleton);
});
const sandbox = opts.opaque ? 'allow-scripts allow-pointer-lock allow-popups' : 'allow-scripts allow-same-origin allow-pointer-lock allow-popups';
const hostServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#222}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe id=f sandbox="${sandbox}" src="http://127.0.0.1:${FRAME}/"></iframe></body></html>`);
});
await new Promise((r) => frameServer.listen(FRAME, '127.0.0.1', r));
await new Promise((r) => hostServer.listen(HOST, '127.0.0.1', r));

const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });
const ctx = await browser.newContext(
  opts.mobile
    ? { viewport: { width: opts.viewport?.[0] ?? 844, height: opts.viewport?.[1] ?? 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: opts.viewport?.[0] ?? 1280, height: opts.viewport?.[1] ?? 720 } },
);
// the CDN: answer jsDelivr npm paths from node_modules
await ctx.route('https://cdn.jsdelivr.net/npm/**', (route) => {
  const u = new URL(route.request().url());
  const m = u.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.*)$/);
  if (!m) return route.fulfill({ status: 404, body: 'bad cdn path' });
  const [, pkg, ver, path] = m;
  const pj = JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8'));
  const file = join(root, 'node_modules', pkg, path);
  if (pj.version !== ver || !existsSync(file)) return route.fulfill({ status: 404, body: `not found ${pkg}@${ver}/${path}` });
  const type = extname(file) === '.json' ? 'application/json' : 'application/javascript; charset=utf-8';
  route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
});
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (route) => route.abort('blockedbyclient'));

const out = { options: opts, errors: [], consoleErrors: [], result: null, screenshot: `${outPrefix}.png` };
const pageObj = await ctx.newPage();
pageObj.on('pageerror', (e) => out.errors.push(String(e.message).slice(0, 400)));
pageObj.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    const t = m.text();
    if (!/GPU stall|GL Driver|useProgram/.test(t)) out.consoleErrors.push(`${m.type()}: ${t.slice(0, 300)}`);
  }
});
await pageObj.goto(`http://127.0.0.1:${HOST}/`);
await pageObj.waitForTimeout(opts.wait);
const frame = pageObj.frames().find((f) => f.url().startsWith(`http://127.0.0.1:${FRAME}`));
for (const [x, y] of opts.clicks) {
  if (opts.mobile) await pageObj.touchscreen.tap(x, y);
  else await pageObj.mouse.click(x, y);
  await pageObj.waitForTimeout(700);
}
if (evalJs && frame) {
  try {
    out.result = await frame.evaluate(evalJs);
  } catch (e) {
    out.result = 'EVAL ERROR: ' + e.message;
  }
}
if (process.env.WAIT_AFTER) await pageObj.waitForTimeout(Number(process.env.WAIT_AFTER));
await pageObj.screenshot({ path: out.screenshot });
console.log(JSON.stringify(out, null, 1));
await browser.close();
frameServer.close();
hostServer.close();
