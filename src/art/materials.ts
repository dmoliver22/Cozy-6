/**
 * Materials and geometry helpers for the code-built art: a "golden hour toy diorama" look.
 *
 * Everything is physically based (MeshStandardMaterial) and lit by the sun, sky fill and the
 * scene environment map that Stage builds from the sky, so surfaces pick up warm highlights and
 * soft reflections. Textures are generated on canvases (no image files):
 *   paint()   weathered painted wood/steel, slight mottling, satin
 *   plastic() glossy toy plastic (crew, buoys, crates, crabs)
 *   wood()    planks with grain, seams and colour variation, box-projected so any box gets
 *             correctly scaled planks without UV work
 *   metal(), rope(), rubber(), glass(), glow()
 * Geometry: rbox() rounded boxes catch highlights like moulded toys; mergeStatic() folds a
 * static group into one mesh per material to keep draw calls down.
 *
 * Old helper names (toon, toonUnique, outlineOf) still work: toon() is paint().
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------
// procedural textures (canvas), cached

/** Small seeded RNG so generated textures look the same every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const texCache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, r: () => number, size: number) => void, srgb = true): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  draw(g, rng(key.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  texCache.set(key, t);
  return t;
}

/** Soft mottling (0.82..1 grey) for paint wear and roughness variation. */
function mottleTex(): THREE.Texture {
  return canvasTex('mottle', 256, (g, r, n) => {
    g.fillStyle = '#ededed';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) {
      const v = 200 + Math.floor(r() * 55);
      g.fillStyle = `rgba(${v},${v},${v},${0.08 + r() * 0.12})`;
      const s = 2 + r() * 18;
      const x = r() * n,
        y = r() * n,
        sy = s * (0.5 + r()),
        rot = r() * 3;
      // drawn at every wrapped offset so the texture tiles seamlessly
      for (const dx of [0, -n, n])
        for (const dy of [0, -n, n]) {
          g.beginPath();
          g.ellipse(x + dx, y + dy, s, sy, rot, 0, Math.PI * 2);
          g.fill();
        }
    }
    // a few darker scuffs
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(90,80,70,${0.05 + r() * 0.08})`;
      g.lineWidth = 0.5 + r() * 1.5;
      const x = r() * n,
        y = r() * n;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 8);
      g.stroke();
    }
  });
}

/** Planks running along u: grain, seams every 1/planks of v, per-plank tone, knots. */
function plankTex(planks: number, weathered: boolean): THREE.Texture {
  return canvasTex(`plank${planks}${weathered ? 'w' : ''}`, 512, (g, r, n) => {
    const h = n / planks;
    for (let p = 0; p < planks; p++) {
      const y0 = p * h;
      const tone = 0.82 + r() * 0.3;
      const base = Math.floor(200 * tone);
      g.fillStyle = `rgb(${base},${Math.floor(base * 0.93)},${Math.floor(base * 0.84)})`;
      g.fillRect(0, y0, n, h);
      // grain: long wavy streaks
      for (let k = 0; k < 26; k++) {
        const yy = y0 + r() * h;
        const dark = r() < 0.5;
        g.strokeStyle = dark ? `rgba(70,45,25,${0.07 + r() * 0.12})` : `rgba(255,240,215,${0.05 + r() * 0.08})`;
        g.lineWidth = 0.6 + r() * 1.8;
        g.beginPath();
        const ph = r() * 6.28,
          amp = 0.5 + r() * 2.2,
          fr = 0.004 + r() * 0.012;
        for (let x = 0; x <= n; x += 8) {
          const y = yy + Math.sin(x * fr * 6.28 + ph) * amp;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      // knots
      if (r() < 0.6) {
        const kx = r() * n,
          ky = y0 + h * (0.3 + r() * 0.4);
        const kr = 3 + r() * 6;
        const grd = g.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
        grd.addColorStop(0, 'rgba(60,35,18,0.55)');
        grd.addColorStop(1, 'rgba(60,35,18,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(kx, ky, kr * 2.4, kr, 0, 0, Math.PI * 2);
        g.fill();
      }
      // butt joints
      const joints = 1 + Math.floor(r() * 2);
      for (let j = 0; j < joints; j++) {
        const jx = Math.floor(r() * n);
        g.fillStyle = 'rgba(40,25,14,0.55)';
        g.fillRect(jx, y0, 2, h);
      }
      // seam
      g.fillStyle = 'rgba(35,22,12,0.75)';
      g.fillRect(0, y0, n, 2.5);
      g.fillStyle = 'rgba(255,235,205,0.12)';
      g.fillRect(0, y0 + 2.5, n, 1.5);
    }
    if (weathered) {
      // salt-bleached patches and water stains
      for (let i = 0; i < 40; i++) {
        g.fillStyle = r() < 0.5 ? `rgba(235,230,220,${0.04 + r() * 0.07})` : `rgba(50,40,30,${0.04 + r() * 0.06})`;
        g.beginPath();
        g.ellipse(r() * n, r() * n, 10 + r() * 50, 4 + r() * 16, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

/** Rope: twisted strands. */
function ropeTex(): THREE.Texture {
  return canvasTex('rope', 128, (g, _r, n) => {
    g.fillStyle = '#d9c39a';
    g.fillRect(0, 0, n, n);
    for (let i = -n; i < n * 2; i += 10) {
      g.strokeStyle = 'rgba(120,90,50,0.55)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + n * 0.5, n);
      g.stroke();
      g.strokeStyle = 'rgba(255,245,220,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(i + 4, 0);
      g.lineTo(i + 4 + n * 0.5, n);
      g.stroke();
    }
  });
}

/** Wire mesh for crab pots: a transparent-cutout grid (alpha map, linear). */
export function meshGridTex(cells = 10): THREE.Texture {
  return canvasTex(`grid${cells}`, 256, (g, _r, n) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    const s = n / cells;
    for (let i = 0; i <= cells; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, n);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * s);
      g.lineTo(n, i * s);
      g.stroke();
    }
  }, false);
}

// ---------------------------------------------------------------------------------------------
// box projection: texture coordinates from object-space position (scaled to metres), picked by
// the dominant normal axis, so plank and grain density stays right on any box without UVs.

const bpScale = new WeakMap<THREE.Material, number>();
function boxProject<T extends THREE.MeshStandardMaterial>(m: T, metresPerTile: number, along: 'x' | 'z'): T {
  bpScale.set(m, metresPerTile);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBPScale = { value: 1 / metresPerTile };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uBPScale;').replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vec3 bpScl = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
      vec3 bpP = position * bpScl * uBPScale;
      vec3 bpN = abs(normal);
      vec2 bpUv = bpN.x > bpN.y && bpN.x > bpN.z ? bpP.zy : (bpN.y > bpN.z ? ${along === 'x' ? 'bpP.xz' : 'bpP.zx'} : bpP.xy);
      #ifdef USE_MAP
        vMapUv = bpUv;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = bpUv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = bpUv;
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `bp_${along}`;
  return m;
}

// ---------------------------------------------------------------------------------------------
// materials

export interface MatOpts {
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}
function common(m: THREE.MeshStandardMaterial, o: MatOpts): THREE.MeshStandardMaterial {
  if (o.emissive !== undefined) m.emissive.setHex(o.emissive);
  m.emissiveIntensity = o.emissiveIntensity ?? 1;
  m.transparent = o.transparent ?? false;
  m.opacity = o.opacity ?? 1;
  m.side = o.side ?? THREE.FrontSide;
  return m;
}
const okey = (o: MatOpts) => `${o.emissive ?? ''}_${o.emissiveIntensity ?? ''}_${o.transparent ? 1 : 0}_${o.opacity ?? 1}_${o.side ?? 0}`;

/** Painted wood or steel: satin, faintly mottled. `wear` 0..1 adds more mottling. */
export function paint(color: number, opts: MatOpts & { rough?: number; wear?: number } = {}): THREE.MeshStandardMaterial {
  return cached(`paint${color}_${opts.rough ?? ''}_${opts.wear ?? ''}_${okey(opts)}`, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.62, metalness: 0 });
    if ((opts.wear ?? 0.5) > 0) {
      m.map = mottleTex();
      m.roughnessMap = mottleTex();
    }
    return boxProject(common(m, opts), 1.6, 'x');
  });
}

/** Glossy moulded toy plastic. */
export function plastic(color: number, opts: MatOpts & { rough?: number } = {}): THREE.MeshStandardMaterial {
  return cached(`plastic${color}_${opts.rough ?? ''}_${okey(opts)}`, () => common(new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.24, metalness: 0 }), opts));
}

/**
 * Wooden planks. `tint` multiplies the plank texture; `plankWidth` in metres; planks run along
 * the object's local x or z axis on horizontal faces.
 */
export function wood(tint = 0xc89a6a, opts: MatOpts & { plankWidth?: number; along?: 'x' | 'z'; weathered?: boolean; rough?: number } = {}): THREE.MeshStandardMaterial {
  const pw = opts.plankWidth ?? 0.18;
  const along = opts.along ?? 'x';
  return cached(`wood${tint}_${pw}_${along}_${opts.weathered ? 1 : 0}_${opts.rough ?? ''}_${okey(opts)}`, () => {
    const planks = 8;
    const m = new THREE.MeshStandardMaterial({ color: tint, roughness: opts.rough ?? 0.78, metalness: 0 });
    m.map = plankTex(planks, opts.weathered ?? true);
    m.bumpMap = m.map;
    m.bumpScale = 1.2;
    return boxProject(common(m, opts), pw * planks, along);
  });
}

/** Steel and brass. */
export function metal(color: number, opts: MatOpts & { rough?: number; metalness?: number } = {}): THREE.MeshStandardMaterial {
  return cached(`metal${color}_${opts.rough ?? ''}_${opts.metalness ?? ''}_${okey(opts)}`, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.42, metalness: opts.metalness ?? 0.75 });
    m.roughnessMap = mottleTex();
    return boxProject(common(m, opts), 1.2, 'x');
  });
}

export function rope(tint = 0xffffff, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  return cached(`rope${tint}_${okey(opts)}`, () => {
    const t = ropeTex().clone();
    t.repeat.set(6, 1);
    t.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ color: tint, map: t, roughness: 0.95, metalness: 0 });
    return common(m, opts);
  });
}

export function rubber(color = 0x24272b, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  return cached(`rubber${color}_${okey(opts)}`, () => common(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 }), opts));
}

/** Window glass with an optional warm interior glow. */
export function glass(tint = 0x9fc4d0, glowColor = 0xffc77a, glowAmount = 0.6): THREE.MeshStandardMaterial {
  return cached(`glass${tint}_${glowColor}_${glowAmount}`, () => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.08, metalness: 0.1, emissive: glowColor, emissiveIntensity: glowAmount }));
}

/** Lamps, bulbs, screens: lit from within (blooms in the post pass). */
export function glow(color: number, intensity = 2.2): THREE.MeshStandardMaterial {
  return cached(`glow${color}_${intensity}`, () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 }));
}

/** Compatibility: the old toon() call sites get weathered satin paint. */
export function toon(color: number, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  return paint(color, opts);
}

/** A unique (non-cached) material, for things that fade or tint individually. */
export function toonUnique(color: number, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  return common(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 }), opts);
}
export const uniqueMat = toonUnique;

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

// ---------------------------------------------------------------------------------------------
// geometry helpers

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const rboxGeoCache = new Map<string, THREE.BufferGeometry>();
/** Rounded box (radius r, clamped to the smallest half-extent): soft highlights on every edge. */
export function rbox(w: number, h: number, d: number, mat: THREE.Material, r = 0.04, x = 0, y = 0, z = 0): THREE.Mesh {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}_${rr.toFixed(3)}`;
  let geo = rboxGeoCache.get(key);
  if (!geo) {
    geo = rr > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d);
    rboxGeoCache.set(key, geo);
  }
  const m = new THREE.Mesh(geo, mat);
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
  m.receiveShadow = true;
  return m;
}

export function capsule(r: number, len: number, mat: THREE.Material, seg = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function torus(r: number, tube: number, mat: THREE.Material, seg = 16): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A rope or cable between two points (a thin cylinder). */
export function line3(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, seg = 5): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, seg, 1, true), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

/**
 * Fold every static mesh under `root` into one mesh per material (positions baked relative to
 * `root`). Children whose names start with "dyn:" (and their subtrees) are left alone, as are
 * skinned/instanced meshes and anything with userData.keep. Cuts draw calls for big props.
 */
export function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean }>();
  const remove: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o !== root && (o.name.startsWith('dyn:') || o.userData.keep)) return;
    for (const ch of o.children) visit(ch);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || !mesh.visible) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count * 2) | 0), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const e = byMat.get(mesh.material) ?? { geos: [], cast: false, recv: false };
    e.geos.push(g);
    e.cast ||= mesh.castShadow;
    e.recv ||= mesh.receiveShadow;
    byMat.set(mesh.material, e);
    remove.push(mesh);
  };
  visit(root);
  for (const m of remove) m.removeFromParent();
  for (const [mat, e] of byMat) {
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = e.recv;
    mesh.name = 'merged';
    root.add(mesh);
  }
}

/**
 * Deprecated: the toon look's inverted-hull outline. The diorama look has no outlines; this
 * returns a hidden mesh so old call sites keep working.
 */
export function outlineOf(mesh: THREE.Mesh, _color = 0x1d1f24, _thickness = 0.035): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial());
  o.visible = false;
  return o;
}

/** Canvas texture helper (labels, signs) — all generated in code. */
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
