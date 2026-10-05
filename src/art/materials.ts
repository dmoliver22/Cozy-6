/**
 * Shared toon materials and tiny geometry helpers for code-built placeholder art.
 * Swap any factory in src/art/ for a real model without touching game logic.
 */
import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 235, 235, 235, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map<string, THREE.Material>();

export function toon(color: number, opts: { emissive?: number; emissiveIntensity?: number; transparent?: boolean; opacity?: number; side?: THREE.Side } = {}): THREE.MeshToonMaterial {
  const key = `t${color}_${opts.emissive ?? 0}_${opts.emissiveIntensity ?? 0}_${opts.transparent ? 1 : 0}_${opts.opacity ?? 1}_${opts.side ?? 0}`;
  let m = cache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient(),
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
    cache.set(key, m);
  }
  return m;
}

/** A unique (non-cached) toon material, for things that fade or tint individually. */
export function toonUnique(color: number, opts: { emissive?: number; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    emissive: opts.emissive ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

export function basic(color: number, opts: { transparent?: boolean; opacity?: number; depthWrite?: boolean; side?: THREE.Side; blending?: THREE.Blending } = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
    side: opts.side ?? THREE.FrontSide,
    blending: opts.blending ?? THREE.NormalBlending,
  });
}

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function sphere(r: number, mat: THREE.Material, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, Math.floor(seg * 0.75))), mat);
  m.castShadow = true;
  return m;
}

export function capsule(r: number, len: number, mat: THREE.Material, seg = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, seg), mat);
  m.castShadow = true;
  return m;
}

export function torus(r: number, tube: number, mat: THREE.Material, seg = 16): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, seg), mat);
  m.castShadow = true;
  return m;
}

/** Inverted-hull outline helper: a back-face, slightly inflated copy of a mesh. */
export function outlineOf(mesh: THREE.Mesh, color = 0x1d1f24, thickness = 0.035): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uThick = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uThick;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uThick;');
  };
  const o = new THREE.Mesh(mesh.geometry, mat);
  o.position.copy(mesh.position);
  o.quaternion.copy(mesh.quaternion);
  o.scale.copy(mesh.scale);
  o.castShadow = false;
  o.receiveShadow = false;
  return o;
}

/** Canvas texture helper (labels, planks, signs) — all generated in code. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}
