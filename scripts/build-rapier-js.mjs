// Builds artifact/rapier-js.mjs: Rapier (from @dimforge/rapier3d-compat) compiled from
// WebAssembly to plain JavaScript, for viewers whose frame blocks WebAssembly (a CSP without
// 'wasm-unsafe-eval', iOS Lockdown Mode). The game loads it only when WebAssembly can't run;
// see src/core/physicsInit.ts. Results match the WebAssembly build exactly; it is roughly an
// order of magnitude slower.
//
// Steps: pull the embedded wasm out of rapier.mjs → lower bulk-memory / sign-ext /
// nontrapping-fptoint to MVP with wasm-opt → wasm2js → make memory growth detach the old
// buffer (wasm-bindgen only refreshes its views when they go detached) → export asmFunc →
// minify with esbuild.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const pkgDir = join(root, 'node_modules', '@dimforge', 'rapier3d-compat');
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const bin = (name) => join(root, 'node_modules', 'binaryen', 'bin', name);
const tmp = mkdtempSync(join(tmpdir(), 'rapier-js-'));
const node = (args) => execFileSync(process.execPath, ['--stack-size=16000', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

try {
  const glue = readFileSync(join(pkgDir, 'dist', 'rapier.mjs'), 'utf8');
  const b64 = [...glue.matchAll(/"([A-Za-z0-9+/=]{100000,})"/g)];
  if (b64.length !== 1) throw new Error(`expected one embedded wasm blob in rapier.mjs, found ${b64.length}`);
  const wasm = Buffer.from(b64[0][1], 'base64');
  if (wasm.readUInt32BE(0) !== 0x0061736d) throw new Error('embedded blob is not WebAssembly');
  writeFileSync(join(tmp, 'rapier.wasm'), wasm);

  console.log(`rapier ${version}: lowering post-MVP features…`);
  node([bin('wasm-opt'), join(tmp, 'rapier.wasm'), '--mvp-features', '--enable-bulk-memory', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '--enable-mutable-globals',
    '--signext-lowering', '--llvm-nontrapping-fptoint-lowering', '--llvm-memory-copy-fill-lowering', '-o', join(tmp, 'lowered.wasm')]);
  console.log('wasm2js (about a minute)…');
  node([bin('wasm2js'), join(tmp, 'lowered.wasm'), '--mvp-features', '--enable-mutable-globals', '-O2', '-o', join(tmp, 'rapier.w2j.js')]);

  let s = readFileSync(join(tmp, 'rapier.w2j.js'), 'utf8');
  const lines = s.split('\n');
  if (!lines[0].startsWith('import * as')) throw new Error('unexpected wasm2js header');
  lines[0] = '';
  const cut = lines.findIndex((l) => l.startsWith('var retasmFunc'));
  if (cut < 0 || lines[cut + 2] !== '});' || !lines.slice(cut + 3).every((l) => l === '' || l.startsWith('export var '))) throw new Error('unexpected wasm2js footer');
  s = lines.slice(0, cut).join('\n') + '\nexport { asmFunc as instantiateRapierJs };\n';

  const grow = '   var newBuffer = new ArrayBuffer(newPages << 16);\n   var newHEAP8 = new Int8Array(newBuffer);\n   newHEAP8.set(HEAP8);\n';
  if (s.split(grow).length !== 2) throw new Error('memory.grow pattern not found exactly once');
  s = s.replace(grow, '   var newBuffer = growDetaching(buffer, newPages << 16);\n');
  s = s.replace('function asmFunc(imports) {', `function growDetaching(old, size) {
  if (typeof old.transfer === 'function') return old.transfer(size);
  var next = new ArrayBuffer(size);
  new Uint8Array(next).set(new Uint8Array(old));
  try { structuredClone(old, { transfer: [old] }); } catch (e) {}
  return next;
}
function asmFunc(imports) {`);
  writeFileSync(join(tmp, 'rapier-js.src.mjs'), s);

  console.log('minifying…');
  execFileSync(join(root, 'node_modules', '.bin', 'esbuild'), [join(tmp, 'rapier-js.src.mjs'), '--minify', '--format=esm', '--target=es2020', '--log-level=error', `--outfile=${join(tmp, 'rapier-js.min.mjs')}`], { stdio: 'inherit' });
  const banner = `/*! Rapier 3D ${version} (https://rapier.rs, © Dimforge, Apache-2.0), compiled from WebAssembly to JavaScript with binaryen wasm2js. */\n`;
  mkdirSync(join(root, 'artifact'), { recursive: true });
  const out = banner + readFileSync(join(tmp, 'rapier-js.min.mjs'), 'utf8');
  writeFileSync(join(root, 'artifact', 'rapier-js.mjs'), out);
  console.log(`artifact/rapier-js.mjs  ${(out.length / 1048576).toFixed(1)} MB`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
