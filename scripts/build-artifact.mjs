// Assembles artifact/pot-luck.html from the dist-artifact build: one page with the game's CSS
// and JS inline, three.js and Rapier from jsDelivr through an import map (exact versions taken
// from node_modules). The Artifact publisher wraps the page in its own <html>/<head>/<body>, so
// none of those tags are written here.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist-artifact');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsFile = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"/)?.[1];
const cssFile = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"/)?.[1];
if (!jsFile || !cssFile) throw new Error('could not find the built JS/CSS in dist-artifact/index.html');
const assets = readdirSync(join(dist, 'assets'));
if (assets.length !== 2) throw new Error(`expected one JS and one CSS asset, found: ${assets.join(', ')}`);

const ver = (pkg) => JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
const three = ver('three');
const rapier = ver('@dimforge/rapier3d-compat');
const CDN = 'https://cdn.jsdelivr.net/npm';
const importMap = {
  imports: {
    three: `${CDN}/three@${three}/build/three.module.js`,
    'three/examples/jsm/': `${CDN}/three@${three}/examples/jsm/`,
    '@dimforge/rapier3d-compat': `${CDN}/@dimforge/rapier3d-compat@${rapier}/dist/rapier.mjs`,
  },
};

// inline-script safety: no "</script" or "<!--" inside script data
const safe = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const js = safe(readFileSync(join(dist, jsFile), 'utf8'));
const css = readFileSync(join(dist, cssFile), 'utf8').replace(/<\/style/gi, '<\\/style');

// Shown if the engine can't be fetched (offline, or the CDN is blocked on this network).
const watchdog = `(function(){
  var done = function(){ var l = document.getElementById('loading'); return !l || l.classList.contains('hidden') || l.querySelector('.loading-error'); };
  var show = function(msg){
    var l = document.getElementById('loading'); if (!l || done()) return;
    var card = l.querySelector('.loading-card');
    var p = document.createElement('div'); p.className = 'loading-sub loading-error'; p.textContent = msg;
    card.appendChild(p);
  };
  var s = document.getElementById('game-module');
  if (s) s.addEventListener('error', function(){ show("The game engine couldn't load from cdn.jsdelivr.net. Check your connection, then reload."); });
  setTimeout(function(){ show('Still loading the game engine from cdn.jsdelivr.net — a slow connection can take a little while.'); }, 25000);
})();`;

const page = `<title>Pot Luck</title>
<style>
${css}
/* artifact frame: the publisher's skeleton pads :root for safe areas; the game is a fixed full-screen layer */
html, body { height: 100%; background: #1f5c66; }
.loading-error { margin-top: 14px; max-width: 30ch; font-size: 15px; line-height: 1.4; color: #ffd28a; }
</style>
<div id="app"></div>
<div id="loading">
  <div class="loading-card">
    <div class="loading-title">Pot Luck</div>
    <div class="loading-sub">warming up the stove…</div>
  </div>
</div>
<script type="importmap">
${JSON.stringify(importMap, null, 1)}
</script>
<script type="module" id="game-module">
${js}
</script>
<script>
${watchdog}
</script>
`;
mkdirSync(join(root, 'artifact'), { recursive: true });
writeFileSync(join(root, 'artifact', 'pot-luck.html'), page);
console.log(`artifact/pot-luck.html  ${(page.length / 1024).toFixed(0)} KB  (three ${three}, rapier ${rapier})`);
