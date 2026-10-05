/**
 * Starting Rapier. Normally that's its WebAssembly build. Where WebAssembly can't run (a page
 * frame whose CSP leaves out 'wasm-unsafe-eval', iOS Lockdown Mode), the Artifact build loads
 * rapier-js.mjs instead: the same engine compiled to JavaScript (scripts/build-rapier-js.mjs),
 * handed to Rapier's own loader in place of WebAssembly.instantiate. Same results, slower.
 */
import RAPIER from '@dimforge/rapier3d-compat';

export type PhysicsBackend = 'wasm' | 'js';

/** Can this page compile WebAssembly? (An empty module compiles instantly, or throws when refused.) */
function wasmAllowed(): boolean {
  try {
    if (typeof WebAssembly !== 'object') return false;
    new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    return true;
  } catch {
    return false;
  }
}

type JsInstantiate = (imports: object) => object;

async function loadJsBackend(): Promise<JsInstantiate> {
  const url = new URL('rapier-js.mjs', document.baseURI).href;
  let mod: { instantiateRapierJs?: JsInstantiate };
  try {
    mod = await import(/* @vite-ignore */ url);
  } catch {
    // some frames refuse module scripts from their own files but allow fetch + blob: modules
    const text = await (await fetch(url)).text();
    const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    mod = await import(/* @vite-ignore */ blobUrl);
  }
  if (typeof mod.instantiateRapierJs !== 'function') throw new Error('rapier-js.mjs did not load');
  return mod.instantiateRapierJs;
}

export async function initPhysics(): Promise<PhysicsBackend> {
  if (wasmAllowed()) {
    await RAPIER.init();
    return 'wasm';
  }
  if (!__ARTIFACT__) throw new Error('WebAssembly is blocked on this page, and the physics engine needs it.');
  const instantiateJs = await loadJsBackend();
  const g = globalThis as unknown as { WebAssembly?: Record<string, unknown> };
  const hadWasm = typeof g.WebAssembly === 'object';
  const saved = hadWasm ? g.WebAssembly!.instantiate : undefined;
  // Rapier's loader calls WebAssembly.instantiate(bytes, imports) and reads `.instance.exports`
  const fake = async (_bytes: unknown, imports: object) => ({ instance: { exports: instantiateJs(imports) }, module: {} });
  if (hadWasm) g.WebAssembly!.instantiate = fake;
  else g.WebAssembly = { instantiate: fake, Instance: class {} };
  try {
    await RAPIER.init();
  } finally {
    if (hadWasm) g.WebAssembly!.instantiate = saved;
    else delete g.WebAssembly;
  }
  return 'js';
}
