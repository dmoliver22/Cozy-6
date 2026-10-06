/**
 * Prop kit for the boat and the pots: cheap rounded geometry, a few bespoke materials (the
 * Puffin's painted plank hull, fishing net, wire mesh, name boards) and small clutter builders
 * (tyre fenders, buoys, fish crates, barrels, rope coils, net piles, deck hardware).
 *
 * Everything here is static art meant to be folded by mergeStatic(), so builders return plain
 * groups of meshes that share the cached library materials (the K kit). Small coloured plastic
 * parts and lamps go through a palette atlas (pal()): every colour shares one material, so dozens
 * of colours cost one draw call. Baked contact-shadow decals (aoBlob, aoEdge) ground props on the
 * Low tier, which has no shadow maps. Positions are local to each prop.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint, wood, metal, rope, rubber, glass, glow, line3, meshGridTex, canvasTexture } from './materials';

// ---------------------------------------------------------------------------------------------
// colours

export const C = {
  hullRed: 0xc9573c,
  /** dark boot-top at the waterline: the lacy sea collar reads against it */
  boot: 0x2b2724,
  antifoul: 0x5b2523,
  stripe: 0xf2e7cf,
  cream: 0xf3ead8,
  deckWood: 0xe0b98a,
  varnish: 0xe0a060,
  darkWood: 0x8a5634,
  roofWood: 0xc08a58,
  fascia: 0x2f5560,
  gearOrange: 0xe4692a,
  machine: 0x2f7480,
  steel: 0xb8bfc3,
  iron: 0x3a3e42,
  brass: 0xd0a04a,
  orange: 0xf06a1c,
  white: 0xf4efe4,
  red: 0xd23b2b,
  rubber: 0x2b2d30,
  manila: 0xe7cf9c,
  greenRope: 0x5fae8e,
  blueBarrel: 0x2f6fb0,
  net: 0x5f9058,
  /** sun-faded off-white for domes, rafts and scanners (pure white blooms under the post pass) */
  offWhite: 0xe8e2d4,
  tyre: 0x343434,
  tyreRim: 0x8f8d86,
  galv: 0x9aa3a8,
  navy: 0x22344a,
  rigging: 0x3a3a3a,
} as const;

// ---------------------------------------------------------------------------------------------
// detail tier

/**
 * Phones start on the Low tier (no MSAA, no shadow maps): the boat builds with fewer segments on
 * round clutter and skips some fine detail. Mirrors the first-tier rule in Stage.
 */
export function isLowTier(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
let lowSeg = false;
/** While building for Low, clutter builders use about half their radial segments. */
export function setLowDetail(on: boolean): void {
  lowSeg = on;
}
export function lowDetail(): boolean {
  return lowSeg;
}
/** Segment count for round clutter: halved on Low. */
export function sg(n: number, min = 3): number {
  return lowSeg ? Math.max(min, Math.round(n / 2)) : n;
}

// ---------------------------------------------------------------------------------------------
// geometry

const cboxCache = new Map<string, THREE.BufferGeometry>();

/**
 * A box with chamfered edges whose normals blend across the chamfer, so it shades like a rounded
 * moulding at 44 triangles (a 2-segment RoundedBoxGeometry is 300).
 */
export function cboxGeo(w: number, h: number, d: number, r = 0.03): THREE.BufferGeometry {
  const half = [w / 2, h / 2, d / 2];
  const rr = Math.max(0, Math.min(r, half[0] - 1e-3, half[1] - 1e-3, half[2] - 1e-3));
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}_${rr.toFixed(3)}`;
  const hit = cboxCache.get(key);
  if (hit) return hit;
  const inner = half.map((v) => v - rr);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const ids = new Map<string, number>();
  const vert = (ax: number, s: number, sg: number[]): number => {
    const sig = [sg[0], sg[1], sg[2]];
    sig[ax] = s;
    const key = `${ax}${sig.join(',')}`;
    const got = ids.get(key);
    if (got !== undefined) return got;
    const p = [0, 0, 0];
    const n = [0, 0, 0];
    for (let i = 0; i < 3; i++) p[i] = i === ax ? s * half[i] : sig[i] * inner[i];
    n[ax] = s;
    const u = (ax + 1) % 3,
      v = (ax + 2) % 3;
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    uv.push((p[u] + half[u]) / (2 * half[u]), (p[v] + half[v]) / (2 * half[v]));
    const id = pos.length / 3 - 1;
    ids.set(key, id);
    return id;
  };
  const index: number[] = [];
  const P = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const tri = (a: number, b: number, c: number) => {
    const pa = P(a),
      pb = P(b),
      pc = P(c);
    const n = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    const cen = pa.add(pb).add(pc);
    if (n.lengthSq() < 1e-14) return;
    if (n.dot(cen) < 0) index.push(a, c, b);
    else index.push(a, b, c);
  };
  const quad = (a: number, b: number, c: number, d: number) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  // main faces
  for (let ax = 0; ax < 3; ax++)
    for (const s of [-1, 1]) {
      const u = (ax + 1) % 3,
        v = (ax + 2) % 3;
      const sg = (a: number, b: number) => {
        const o = [0, 0, 0];
        o[u] = a;
        o[v] = b;
        return o;
      };
      quad(vert(ax, s, sg(-1, -1)), vert(ax, s, sg(1, -1)), vert(ax, s, sg(1, 1)), vert(ax, s, sg(-1, 1)));
    }
  if (rr > 0) {
    // edge fillets
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++) {
        const c = 3 - a - b;
        for (const sa of [-1, 1])
          for (const sb of [-1, 1]) {
            const sg = (sc: number) => {
              const o = [0, 0, 0];
              o[a] = sa;
              o[b] = sb;
              o[c] = sc;
              return o;
            };
            quad(vert(a, sa, sg(-1)), vert(a, sa, sg(1)), vert(b, sb, sg(1)), vert(b, sb, sg(-1)));
          }
      }
    // corners
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const sg = [sx, sy, sz];
          tri(vert(0, sx, sg), vert(1, sy, sg), vert(2, sz, sg));
        }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  cboxCache.set(key, g);
  return g;
}

function prep<T extends THREE.Mesh>(m: T, cast = true): T {
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** Chamfered ("rounded") box mesh. On Low, thin parts lose the chamfer (12 triangles, not 44). */
export function cbox(w: number, h: number, d: number, mat: THREE.Material, r = 0.03, x = 0, y = 0, z = 0): THREE.Mesh {
  if (lowSeg && Math.min(w, h, d) < 0.1) r = 0;
  const m = prep(new THREE.Mesh(cboxGeo(w, h, d, r), mat));
  m.position.set(x, y, z);
  return m;
}

const cylCache = new Map<string, THREE.BufferGeometry>();
/** Cached cylinder (open = no caps). */
export function cylGeo(rt: number, rb: number, h: number, seg = 10, open = false): THREE.BufferGeometry {
  const key = `${rt}_${rb}_${h}_${seg}_${open}`;
  let g = cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    cylCache.set(key, g);
  }
  return g;
}
export function tube(rt: number, rb: number, h: number, mat: THREE.Material, seg = 10, x = 0, y = 0, z = 0): THREE.Mesh {
  if (lowSeg && seg > 8) seg = Math.max(8, Math.round(seg * 0.6));
  const m = prep(new THREE.Mesh(cylGeo(rt, rb, h, seg), mat));
  m.position.set(x, y, z);
  return m;
}
/** A cylinder lying along x. */
export function tubeX(r: number, len: number, mat: THREE.Material, seg = 10, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = tube(r, r, len, mat, seg, x, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}
/** A cylinder lying along z. */
export function tubeZ(r: number, len: number, mat: THREE.Material, seg = 10, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = tube(r, r, len, mat, seg, x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

const torCache = new Map<string, THREE.BufferGeometry>();
export function ring(r: number, t: number, mat: THREE.Material, radial = 6, tubular = 16, arc = Math.PI * 2): THREE.Mesh {
  if (lowSeg) {
    radial = Math.max(3, Math.round(radial * 0.6));
    if (tubular > 10) tubular = Math.max(10, Math.round(tubular * 0.6));
  }
  const key = `${r}_${t}_${radial}_${tubular}_${arc}`;
  let g = torCache.get(key);
  if (!g) {
    g = new THREE.TorusGeometry(r, t, radial, tubular, arc);
    torCache.set(key, g);
  }
  return prep(new THREE.Mesh(g, mat));
}

const sphCache = new Map<string, THREE.BufferGeometry>();
export function ball(r: number, mat: THREE.Material, seg = 10, x = 0, y = 0, z = 0): THREE.Mesh {
  if (lowSeg && seg > 8) seg = Math.max(8, Math.round(seg * 0.6));
  const key = `${r}_${seg}`;
  let g = sphCache.get(key);
  if (!g) {
    g = new THREE.SphereGeometry(r, seg, Math.max(5, Math.round(seg * 0.7)));
    sphCache.set(key, g);
  }
  const m = prep(new THREE.Mesh(g, mat));
  m.position.set(x, y, z);
  return m;
}

/** A rope / bar between two points (line3 with a cached-ish thickness). */
export function bar(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, mat: THREE.Material, seg = 6): THREE.Mesh {
  return line3(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), r, mat, seg);
}

/**
 * Sweep a closed 2D profile (x = sideways, y = up) along a path. The profile stays vertical
 * (world up), which suits rails and rub strakes that run roughly level. UV u = metres along the
 * path, v = 0..1 around the profile.
 */
export function sweep(path: THREE.Vector3[], profile: [number, number][], closed: boolean): THREE.BufferGeometry {
  const n = path.length;
  const pn = profile.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  let along = 0;
  for (let i = 0; i < n; i++) {
    const prev = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    t.copy(next).sub(prev).setY(0).normalize();
    side.crossVectors(t, up).normalize(); // right-hand side of travel
    // keep the section width through bends
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t0 = path[i].clone().sub(a).setY(0).normalize();
    const t1 = b.clone().sub(path[i]).setY(0).normalize();
    const cosHalf = Math.max(0.5, Math.sqrt(Math.max(0, (1 + (t0.lengthSq() > 0 && t1.lengthSq() > 0 ? t0.dot(t1) : 1)) / 2)));
    if (i > 0) along += path[i].distanceTo(path[i - 1]);
    for (let j = 0; j <= pn; j++) {
      const [px, py] = profile[j % pn];
      pos.push(path[i].x + (side.x * px) / cosHalf, path[i].y + py, path[i].z + (side.z * px) / cosHalf);
      uv.push(along, j / pn);
    }
  }
  const rows = closed ? n : n - 1;
  for (let i = 0; i < rows; i++) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < pn; j++) {
      const a = i * (pn + 1) + j,
        b = a + 1,
        c = i1 * (pn + 1) + j,
        d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // wind outward: compare the first face's normal with the direction away from the section centre
  const V = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const cen = new THREE.Vector3();
  for (let j = 0; j < pn; j++) cen.add(V(j));
  cen.multiplyScalar(1 / pn);
  const fa = V(idx[0]),
    fb = V(idx[1]),
    fc = V(idx[2]);
  const fn = fb.clone().sub(fa).cross(fc.clone().sub(fa));
  if (fn.dot(fa.clone().add(fb).multiplyScalar(0.5).sub(cen)) < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A chamfered rectangle profile (for sweep), centred, w × h, chamfer c. Wound for an outward face. */
export function rectProfile(w: number, h: number, c: number, dx = 0, dy = 0): [number, number][] {
  const x = w / 2,
    y = h / 2;
  const pts: [number, number][] = [
    [x - c, -y],
    [x, -y + c],
    [x, y - c],
    [x - c, y],
    [-x + c, y],
    [-x, y - c],
    [-x, -y + c],
    [-x + c, -y],
  ];
  return pts.map(([a, b]) => [a + dx, b + dy]);
}

// ---------------------------------------------------------------------------------------------
// bespoke materials

const own = new Map<string, THREE.Material>();
function once<T extends THREE.Material>(key: string, make: () => T): T {
  let m = own.get(key) as T | undefined;
  if (!m) {
    m = make();
    own.set(key, m);
  }
  return m;
}

/**
 * A unique, fadeable copy of a library material (keeps its box-projection shader hook), for the
 * dollhouse cutaway.
 */
export function fadeCopy<T extends THREE.MeshStandardMaterial>(src: T): T {
  const m = src.clone() as T;
  m.onBeforeCompile = src.onBeforeCompile;
  m.customProgramCacheKey = src.customProgramCacheKey;
  m.transparent = true;
  m.opacity = 1;
  return m;
}

/** Seeded RNG for canvas art. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hull plank texture: covers HULL_TEX_U metres along the boat × HULL_TEX_V metres of girth. */
export const HULL_TEX_U = 8;
export const HULL_TEX_V = 2.4;

function hullTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const Wt = 1024,
    Ht = 512;
  const strakes = 10;
  const sh = Ht / strakes;
  const r = rng(4242);
  const joints: number[][] = [];
  const map = canvasTexture(Wt, Ht, (g) => {
    for (let s = 0; s < strakes; s++) {
      const tone = 0.93 + r() * 0.07;
      const v = Math.floor(236 * tone);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, s * sh, Wt, sh);
      // brush streaks along the plank
      for (let k = 0; k < 14; k++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,50,45'},${0.03 + r() * 0.04})`;
        g.fillRect(0, s * sh + r() * sh, Wt, 1 + r() * 2);
      }
      // butt joints with fastenings
      const js: number[] = [];
      for (let j = 0; j < 1; j++) {
        const x = Math.floor(r() * Wt);
        js.push(x);
        g.fillStyle = 'rgba(40,30,28,0.18)';
        g.fillRect(x, s * sh, 2, sh);
        g.fillStyle = 'rgba(40,30,28,0.25)';
        for (const dy of [0.3, 0.7]) {
          g.beginPath();
          g.arc(x - 6, s * sh + dy * sh, 1.6, 0, Math.PI * 2);
          g.arc(x + 8, s * sh + dy * sh, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      joints.push(js);
      // seam: dark caulk line then a soft highlight
      g.fillStyle = 'rgba(35,25,22,0.3)';
      g.fillRect(0, s * sh, Wt, 3);
      g.fillStyle = 'rgba(255,250,240,0.2)';
      g.fillRect(0, s * sh + 3, Wt, 2);
      g.fillStyle = 'rgba(0,0,0,0.03)';
      g.fillRect(0, s * sh + sh - 8, Wt, 8);
    }
    // weathering: worn paint scuffs (lighter), rust and grime streaks running down
    for (let i = 0; i < 140; i++) {
      const x = r() * Wt,
        y = r() * Ht;
      g.fillStyle = `rgba(255,248,236,${0.06 + r() * 0.12})`;
      g.beginPath();
      g.ellipse(x, y, 3 + r() * 14, 1 + r() * 4, (r() - 0.5) * 0.4, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 26; i++) {
      const x = r() * Wt,
        y = r() * Ht * 0.6;
      const len = 40 + r() * 200;
      const grd = g.createLinearGradient(0, y, 0, y + len);
      const rust = r() < 0.6;
      grd.addColorStop(0, rust ? 'rgba(120,58,28,0.32)' : 'rgba(40,35,30,0.18)');
      grd.addColorStop(1, 'rgba(120,58,28,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, 2 + r() * 5, len);
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(30,22,18,${0.02 + r() * 0.03})`;
      g.beginPath();
      g.ellipse(r() * Wt, r() * Ht, 20 + r() * 70, 6 + r() * 20, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  const bump = canvasTexture(Wt, Ht, (g) => {
    g.fillStyle = '#b4b4b4';
    g.fillRect(0, 0, Wt, Ht);
    for (let s = 0; s < strakes; s++) {
      // each plank slightly crowned: lighter in the middle (soft, so the grooves stay shallow)
      const grd = g.createLinearGradient(0, s * sh, 0, s * sh + sh);
      grd.addColorStop(0, '#9c9c9c');
      grd.addColorStop(0.25, '#c2c2c2');
      grd.addColorStop(0.7, '#bebebe');
      grd.addColorStop(1, '#949494');
      g.fillStyle = grd;
      g.fillRect(0, s * sh, Wt, sh);
      g.fillStyle = '#5a5a5a';
      g.fillRect(0, s * sh, Wt, 3);
      for (const x of joints[s] ?? []) g.fillRect(x, s * sh, 2, sh);
    }
  });
  bump.colorSpace = THREE.NoColorSpace;
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / HULL_TEX_U, 1 / HULL_TEX_V);
    t.anisotropy = 4;
  }
  return { map, bump };
}

/**
 * The Puffin's hull paint: planked topsides (uv = metres along × metres of girth from the
 * gunwale), with a cream sheer stripe under the rail, a dark boot-top at the waterline (with a
 * thin cream pinstripe above it) and dark antifouling below, all picked in the shader from object-space height so merging keeps it.
 */
export function hullPaint(waterlineY: number): THREE.MeshStandardMaterial {
  return once(`hull${waterlineY}`, () => {
    const { map, bump } = hullTextures();
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map, bumpMap: bump, bumpScale: 1.1, roughness: 0.58, metalness: 0 });
    const uni = {
      uTop: { value: new THREE.Color(C.hullRed) },
      uBoot: { value: new THREE.Color(C.boot) },
      uBottom: { value: new THREE.Color(C.antifoul) },
      uStripe: { value: new THREE.Color(C.stripe) },
      uWL: { value: waterlineY },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHullY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullY = position.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHullY;\nuniform vec3 uTop, uBoot, uBottom, uStripe;\nuniform float uWL;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float aa = fwidth(vHullY) + 1e-4;
            vec3 tint = uTop;
            #ifdef USE_MAP
              float girth = vMapUv.y * ${HULL_TEX_V.toFixed(2)};
              float ga = fwidth(girth) + 1e-4;
              float stripe = smoothstep(0.04 - ga, 0.04 + ga, girth) * (1.0 - smoothstep(0.36 - ga, 0.36 + ga, girth));
              tint = mix(tint, uStripe, stripe);
            #endif
            float bootTop = uWL + 0.22;
            float bootBot = uWL - 0.03;
            tint = mix(tint, uBoot, 1.0 - smoothstep(bootTop - aa, bootTop + aa, vHullY));
            // a thin cream pinstripe on top of the boot-top
            float pin = smoothstep(bootTop - aa, bootTop + aa, vHullY + 0.035) * (1.0 - smoothstep(bootTop - aa, bootTop + aa, vHullY));
            tint = mix(tint, uStripe, pin);
            tint = mix(tint, uBottom, 1.0 - smoothstep(bootBot - aa, bootBot + aa, vHullY));
            // grime near the waterline
            tint *= mix(1.0, 0.86, (1.0 - smoothstep(uWL + 0.15, uWL + 0.7, vHullY)) * step(bootTop, vHullY));
            diffuseColor.rgb *= tint;
          }`,
        );
    };
    m.customProgramCacheKey = () => 'puffinHull';
    return m;
  });
}

/** A unique copy of a library material with its colour scaled past white (brightens a texture). */
export function brightCopy<T extends THREE.MeshStandardMaterial>(src: T, r: number, g: number, b: number): T {
  const m = src.clone() as T;
  m.onBeforeCompile = src.onBeforeCompile;
  m.customProgramCacheKey = src.customProgramCacheKey;
  m.color.setRGB(r, g, b);
  return m;
}

/**
 * Galvanised wire-mesh panel, drawn procedurally (no texture, no dither, no MSAA needed). Up close
 * the grid is analytically anti-aliased thin wire; as the cells shrink toward a few pixels it eases
 * into a semi-opaque tinted panel, so a stack of pots reads as stacked boxes instead of moire.
 * Blended (no depth write, single pass): the catch and bait inside show through. UVs are expected
 * in "uv units" where one unit holds `cells` cells. `panelOnly` skips the grid (Low tier).
 */
export function meshPanelMat(
  color: number,
  cells = 8,
  opts: { rough?: number; metalness?: number; wire?: number; panel?: number; panelOnly?: boolean } = {},
): THREE.MeshStandardMaterial {
  const wire = (opts.wire ?? 0.065).toFixed(3);
  const panel = (opts.panel ?? 0.45).toFixed(3);
  const only = opts.panelOnly ? 1 : 0;
  return once(`meshPanel${color}_${cells}_${opts.rough ?? ''}_${opts.metalness ?? ''}_${wire}_${panel}_${only}`, () => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.5,
      metalness: opts.metalness ?? 0.3,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    m.forceSinglePass = true;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWireCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvWireCell = uv * ${cells.toFixed(1)};`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWireCell;').replace(
        '#include <alphatest_fragment>',
        only
          ? `diffuseColor.a *= ${panel};`
          : `{
          vec2 fw = fwidth(vWireCell);
          vec2 d = abs(fract(vWireCell + 0.5) - 0.5);
          vec2 l = 1.0 - smoothstep(vec2(${wire}) - fw * 0.7, vec2(${wire}) + fw * 0.7, d);
          float cov = max(l.x, l.y);
          float far = smoothstep(0.14, 0.4, max(fw.x, fw.y));
          diffuseColor.a *= mix(cov, ${panel}, far);
          if (diffuseColor.a < 0.004) discard;
        }`,
      );
    };
    m.customProgramCacheKey = () => `wirePanel_${cells}_${wire}_${panel}_${only}`;
    return m;
  });
}

/** Knotted netting alpha texture (thicker than wire mesh), for pot tunnels and net bags. */
function netAlphaTex(): THREE.CanvasTexture {
  const t = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    // diamond mesh
    for (let i = -128; i <= 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 128, 128);
      g.stroke();
      g.beginPath();
      g.moveTo(i + 128, 0);
      g.lineTo(i, 128);
      g.stroke();
    }
    g.fillStyle = '#fff';
    for (let x = 0; x <= 128; x += 32)
      for (let y = 0; y <= 128; y += 32) {
        g.beginPath();
        g.moveTo(x + 4.5, y);
        g.arc(x, y, 4.5, 0, Math.PI * 2);
        g.moveTo(x + 16 + 4.5, y + 16);
        g.arc(x + 16, y + 16, 4.5, 0, Math.PI * 2);
        g.fill();
      }
  });
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let _netAlpha: THREE.CanvasTexture | null = null;

/** Solid webbing parts with this uv.x or less take webbingMat's `solidColor` (the alpha map repeats). */
export const WEB_SOLID_U = -7.875;

/**
 * Webbing cutout from the knotted-net alpha: crisp edges up close (alpha to coverage smooths them
 * where MSAA is on, and they stay crisp where it is not); far away it turns into an even partial
 * coverage (no screen-door pattern), so it reads as a netting funnel. With `solidColor`, solid
 * parts whose uvs sit at u = WEB_SOLID_U (a knot, alpha 1) take that colour instead: two colours
 * in one material, so a merged pot keeps one webbing draw call.
 */
export function webbingMat(color: number, solidColor?: number): THREE.MeshStandardMaterial {
  return once(`webbing${color}_${solidColor ?? ''}`, () => {
    _netAlpha ??= netAlphaTex();
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, alphaMap: _netAlpha, alphaTest: 0.5, side: THREE.DoubleSide });
    m.alphaToCoverage = true;
    const solid = solidColor !== undefined ? new THREE.Color(solidColor) : null;
    m.onBeforeCompile = (sh) => {
      if (solid) sh.uniforms.uWebSolid = { value: solid };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${solid ? '#define WEB_SOLID\nuniform vec3 uWebSolid;' : ''}`)
        .replace(
          '#include <alphamap_fragment>',
          `#include <alphamap_fragment>
        #ifdef USE_ALPHAMAP
        {
          float a = diffuseColor.a;
          float tpp = length(fwidth(vAlphaMapUv)) * 128.0;
          float sharp = clamp((a - 0.5) / max(fwidth(a), 1e-4) * 0.5 + 0.5, 0.0, 1.0);
          // far away: 65% coverage (a soft see-through netting where MSAA is on, solid where not)
          diffuseColor.a = mix(sharp, 0.68, smoothstep(2.5, 5.5, tpp));
          #ifdef WEB_SOLID
            if (vAlphaMapUv.x < ${(WEB_SOLID_U + 1).toFixed(1)}) diffuseColor = vec4(uWebSolid, 1.0);
          #endif
        }
        #endif`,
        );
    };
    m.customProgramCacheKey = () => (solid ? 'webbingA2C_solid' : 'webbingA2C');
    return m;
  });
}

/** Piled fishing net: an opaque lumpy mound painted with a net-and-shadow texture. */
export function netPileMat(color: number = C.net): THREE.MeshStandardMaterial {
  return once(`netPile${color}`, () => {
    const r = rng(77);
    const t = canvasTexture(256, 256, (g) => {
      g.fillStyle = '#7d7d7d';
      g.fillRect(0, 0, 256, 256);
      // dark folds
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(20,20,20,${0.1 + r() * 0.2})`;
        g.beginPath();
        g.ellipse(r() * 256, r() * 256, 8 + r() * 30, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      // mesh strands
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 1.6;
      for (let i = -256; i < 512; i += 12) {
        g.beginPath();
        g.moveTo(i, 0);
        g.bezierCurveTo(i + 60, 80, i + 30, 170, i + 120, 256);
        g.stroke();
        g.beginPath();
        g.moveTo(i + 120, 0);
        g.bezierCurveTo(i + 60, 90, i + 90, 160, i, 256);
        g.stroke();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.9, metalness: 0 });
  });
}

/** A single texture atlas of painted lettering (name boards, crate labels), alpha-tested. */
export const LETTERS = {
  /** uv rects [u0, v0, u1, v1] in the atlas */
  transom: [0, 0.5, 1, 1] as const,
  bow: [0, 0.25, 0.75, 0.5] as const,
  curios: [0, 0, 0.5, 0.25] as const,
  reg: [0.75, 0.25, 1, 0.5] as const,
  bait: [0.5, 0, 0.75, 0.25] as const,
  fish: [0.75, 0, 1, 0.25] as const,
};
export function lettersMat(): THREE.MeshStandardMaterial {
  return once('letters', () => {
    const W = 1024,
      H = 512;
    const t = canvasTexture(W, H, (g) => {
      g.clearRect(0, 0, W, H);
      const txt = (s: string, x: number, y: number, size: number, fill: string, font = 'Georgia, serif', weight = 'bold', stroke = 'rgba(40,20,10,0.55)') => {
        g.font = `${weight} ${size}px ${font}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = size * 0.08;
        g.strokeStyle = stroke;
        g.strokeText(s, x, y);
        g.fillStyle = fill;
        g.fillText(s, x, y);
      };
      // transom (top half)
      txt('PUFFIN', 512, 100, 132, '#f6ead2');
      txt('KITTIWAKE HBR', 512, 205, 54, '#f6ead2');
      // bow name (row 3)
      txt('PUFFIN', 384, 320, 104, '#f6ead2');
      // registration
      txt('KH 27', 896, 320, 74, '#f6ead2');
      // crate labels (bottom row): stencilled ink on wood, so no background
      txt('CURIOS', 256, 448, 70, '#4a2c18', 'Georgia, serif', 'bold', 'rgba(0,0,0,0)');
      txt('BAIT', 640, 448, 70, '#f6ead2', 'Georgia, serif', 'bold', 'rgba(20,20,20,0.6)');
      txt('FRESH', 896, 448, 56, '#ffffff', 'Arial, sans-serif', 'bold', 'rgba(0,0,0,0)');
    });
    t.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, roughness: 0.6, metalness: 0, side: THREE.FrontSide });
  });
}
/** A plane (facing +z) showing one rect of the lettering atlas. */
export function letterPlane(rect: readonly [number, number, number, number], w: number, h: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
  }
  const m = new THREE.Mesh(g, lettersMat());
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------------------------
// the shared kit: one material per surface type, so mergeStatic folds the whole boat into a few
// dozen draw calls

export const K = {
  iron: () => metal(C.iron, { rough: 0.5, metalness: 0.6 }),
  steel: () => metal(C.steel, { rough: 0.36, metalness: 0.65 }),
  brass: () => metal(C.brass, { rough: 0.3, metalness: 0.85 }),
  machine: () => paint(C.machine, { rough: 0.5 }),
  gear: () => paint(C.gearOrange, { rough: 0.66 }),
  cream: () => paint(C.cream, { rough: 0.5 }),
  varnish: () => wood(C.varnish, { plankWidth: 0.12, along: 'z', weathered: false, rough: 0.42 }),
  darkWood: () => wood(C.darkWood, { plankWidth: 0.14, along: 'x', weathered: true, rough: 0.6 }),
  deck: () => wood(C.deckWood, { plankWidth: 0.15, along: 'z', weathered: true }),
  manila: () => rope(C.manila),
  greenRope: () => rope(C.greenRope),
  rubber: () => rubber(C.rubber),
  net: () => netPileMat(C.net),
  glass: () => glass(0xc9d9a8, 0x000000, 0),
  /** sun-faded tyre rubber, a touch lighter than black so the fenders don't read as holes */
  tyre: () => rubber(C.tyre),
  /** standing rigging: dark grey wire, not black */
  rigging: () => paint(C.rigging, { rough: 0.55, wear: 0 }),
  /** the launch stand: dark navy machinery paint (keeps it apart from the teal tank) */
  navy: () => paint(C.navy, { rough: 0.55 }),
  galv: () => metal(C.galv, { rough: 0.45, metalness: 0.55 }),
};

// ---------------------------------------------------------------------------------------------
// more bespoke surfaces: sorting-table top, stove pipe, window glass, hazard tape, rust streaks

/**
 * Sorting-table top: a scrubbed, warm tan board (the red, blue and orange crabs and their yellow
 * and blue markers read against it), grain along u, knife scratches, darker wet patches.
 */
export function sortTableTopMat(): THREE.MeshStandardMaterial {
  return once('sortTableTop', () => {
    const r = rng(9091);
    const N = 512;
    const wet: [number, number, number, number][] = [];
    for (let i = 0; i < 5; i++) wet.push([60 + r() * (N - 120), 60 + r() * (N - 120), 22 + r() * 40, 12 + r() * 22]);
    const map = canvasTexture(N, N, (g) => {
      g.fillStyle = '#c8b28a';
      g.fillRect(0, 0, N, N);
      // scrubbed grain
      for (let i = 0; i < 900; i++) {
        const y = r() * N;
        g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.04 + r() * 0.08})` : `rgba(110,86,58,${0.03 + r() * 0.07})`;
        g.fillRect(r() * N * 0.3 - 40, y, N * (0.4 + r() * 0.8), 1);
      }
      // wet patches and a grimy rim
      for (const [x, y, rx, ry] of wet) {
        const grd = g.createRadialGradient(x, y, 0, x, y, rx);
        grd.addColorStop(0, 'rgba(110,88,60,0.2)');
        grd.addColorStop(0.6, 'rgba(110,88,60,0.12)');
        grd.addColorStop(1, 'rgba(110,88,60,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x, y, rx, ry, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      const edge = g.createLinearGradient(0, 0, 0, N);
      edge.addColorStop(0, 'rgba(60,55,50,0.18)');
      edge.addColorStop(0.06, 'rgba(60,55,50,0)');
      edge.addColorStop(0.94, 'rgba(60,55,50,0)');
      edge.addColorStop(1, 'rgba(60,55,50,0.18)');
      g.fillStyle = edge;
      g.fillRect(0, 0, N, N);
      // scratches: bright hairlines with a dark side
      for (let i = 0; i < 70; i++) {
        const x = r() * N,
          y = r() * N,
          a = (r() - 0.5) * 1.2 + (r() < 0.5 ? 0 : Math.PI / 2),
          len = 10 + r() * 60;
        g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.3})`;
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
        g.strokeStyle = 'rgba(60,66,70,0.25)';
        g.beginPath();
        g.moveTo(x + 1, y + 1);
        g.lineTo(x + 1 + Math.cos(a) * len, y + 1 + Math.sin(a) * len);
        g.stroke();
      }
    });
    const rough = canvasTexture(N, N, (g) => {
      g.fillStyle = 'rgb(140,140,140)';
      g.fillRect(0, 0, N, N);
      for (let i = 0; i < 500; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '200,200,200' : '90,90,90'},0.12)`;
        g.fillRect(r() * N - 40, r() * N, N * (0.3 + r() * 0.6), 1);
      }
      for (const [x, y, rx, ry] of wet) {
        g.fillStyle = 'rgba(60,60,60,0.35)';
        g.beginPath();
        g.ellipse(x, y, rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
    rough.colorSpace = THREE.NoColorSpace;
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughnessMap: rough, roughness: 0.85, metalness: 0 });
  });
}

/** Stove pipe: dark iron near the stove, rusting up the flue, sooty at the top (uv v runs up). */
export function stovePipeMat(): THREE.MeshStandardMaterial {
  return once('stovePipe', () => {
    const r = rng(515);
    const t = canvasTexture(64, 256, (g) => {
      const grd = g.createLinearGradient(0, 256, 0, 0);
      grd.addColorStop(0, '#4f4a45');
      grd.addColorStop(0.5, '#5c4b3e');
      grd.addColorStop(0.66, '#a35f34');
      grd.addColorStop(0.86, '#8d5430');
      grd.addColorStop(0.95, '#3e3129');
      grd.addColorStop(1, '#2a231e');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 256);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = r() < 0.5 ? `rgba(150,80,40,${0.1 + r() * 0.2})` : `rgba(20,16,14,${0.1 + r() * 0.15})`;
        g.fillRect(r() * 64, r() * 256, 1 + r() * 4, 2 + r() * 14);
      }
    });
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.7, metalness: 0.2 });
  });
}

/**
 * Wheelhouse window: dark glass with a sky streak, glowing warm from the cabin lamp (emissive
 * gradient, brighter low in the pane). Unique per boat: gameplay may dim or brighten it.
 */
export function windowGlassMat(): THREE.MeshStandardMaterial {
  const map = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#26343a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(200,225,235,0.22)';
    g.beginPath();
    g.moveTo(10, 0);
    g.lineTo(24, 0);
    g.lineTo(6, 64);
    g.lineTo(-8, 64);
    g.fill();
    g.fillStyle = 'rgba(200,225,235,0.12)';
    g.beginPath();
    g.moveTo(30, 0);
    g.lineTo(36, 0);
    g.lineTo(18, 64);
    g.lineTo(12, 64);
    g.fill();
  });
  const em = canvasTexture(64, 64, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, '#2e2014');
    grd.addColorStop(0.3, '#6e4c2a');
    grd.addColorStop(0.75, '#e8b47a');
    grd.addColorStop(1, '#f6d2a2');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    // the lampshade glow, off to one side
    const rg = g.createRadialGradient(40, 42, 0, 40, 42, 26);
    rg.addColorStop(0, 'rgba(255,230,180,0.7)');
    rg.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
  });
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.08, metalness: 0.3, emissive: 0xffc98e, emissiveMap: em, emissiveIntensity: 0.85 });
}

/** Yellow-and-black hazard tape (uv u along the tape, one stripe pair per 0.2 uv). */
export function hazardMat(): THREE.MeshStandardMaterial {
  return once('hazard', () => {
    const t = canvasTexture(64, 32, (g) => {
      g.fillStyle = '#f2c230';
      g.fillRect(0, 0, 64, 32);
      g.fillStyle = '#1e1e1e';
      for (let x = -32; x < 96; x += 32) {
        g.beginPath();
        g.moveTo(x, 32);
        g.lineTo(x + 16, 32);
        g.lineTo(x + 32, 0);
        g.lineTo(x + 16, 0);
        g.fill();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0 });
  });
}
/** A flat strip of hazard tape, len × w, facing +z. */
export function hazardStrip(len: number, w = 0.06): THREE.Mesh {
  const g = new THREE.PlaneGeometry(len, w);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 0.12), uv.getY(i));
  const m = new THREE.Mesh(g, hazardMat());
  m.receiveShadow = true;
  return m;
}

/** Rust weeping from a scupper: a soft streak fading downward (transparent decal). */
export function rustStreakMat(): THREE.MeshStandardMaterial {
  return once('rustStreak', () => {
    const t = canvasTexture(32, 128, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 32, 128);
      const r = rng(31);
      for (let k = 0; k < 5; k++) {
        const x = 8 + r() * 16,
          w = 2 + r() * 6,
          len = 60 + r() * 68;
        const grd = g.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, 'rgba(255,255,255,0.85)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x - w / 2, 0, w, len);
      }
    });
    t.colorSpace = THREE.NoColorSpace;
    const m = new THREE.MeshStandardMaterial({ color: 0x5c2c14, alphaMap: t, transparent: true, depthWrite: false, roughness: 0.8, metalness: 0 });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  });
}

// ---------------------------------------------------------------------------------------------
// palette atlas: small coloured plastic parts and lamps share one material each; every mesh's
// uvs point at its colour's texel, so dozens of colours cost one draw call.

const PAL_N = 16; // 16 × 16 cells
const PAL_CELL = 4; // px per cell
const palColors: number[] = [];
const palIndex = new Map<number, number>();
let palCanvas: HTMLCanvasElement | null = null;
let palTex: THREE.CanvasTexture | null = null;

function palDraw(i: number): void {
  if (!palCanvas) return;
  const g = palCanvas.getContext('2d')!;
  g.fillStyle = '#' + palColors[i].toString(16).padStart(6, '0');
  g.fillRect((i % PAL_N) * PAL_CELL, Math.floor(i / PAL_N) * PAL_CELL, PAL_CELL, PAL_CELL);
  if (palTex) palTex.needsUpdate = true;
}
function paletteTexture(): THREE.CanvasTexture {
  if (palTex) return palTex;
  palCanvas = document.createElement('canvas');
  palCanvas.width = palCanvas.height = PAL_N * PAL_CELL;
  palTex = new THREE.CanvasTexture(palCanvas);
  palTex.colorSpace = THREE.SRGBColorSpace;
  palTex.magFilter = THREE.NearestFilter;
  palTex.minFilter = THREE.NearestFilter;
  palTex.generateMipmaps = false;
  for (let i = 0; i < palColors.length; i++) palDraw(i);
  return palTex;
}
function palUv(hex: number): [number, number] {
  let i = palIndex.get(hex);
  if (i === undefined) {
    i = palColors.length;
    if (i >= PAL_N * PAL_N) i = 0;
    else {
      palColors.push(hex);
      palIndex.set(hex, i);
      palDraw(i);
    }
  }
  const u = ((i % PAL_N) + 0.5) / PAL_N;
  const v = 1 - (Math.floor(i / PAL_N) + 0.5) / PAL_N; // canvas rows run down, v runs up
  return [u, v];
}

/** Glossy toy plastic from the palette atlas. */
export function palettePlastic(): THREE.MeshStandardMaterial {
  return once('palPlastic', () => new THREE.MeshStandardMaterial({ map: paletteTexture(), roughness: 0.38, metalness: 0 }));
}
/** Lamps and screens from the palette atlas (emissive, blooms in the post pass). */
export function paletteGlow(): THREE.MeshStandardMaterial {
  return once('palGlow', () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: paletteTexture(), emissiveIntensity: 2.3, roughness: 1 }));
}

/** Coloured lamps (nav lights, screens, firebox) glow softer so tone mapping keeps their hue. */
export function paletteGlowSoft(): THREE.MeshStandardMaterial {
  return once('palGlowSoft', () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: paletteTexture(), emissiveIntensity: 1.15, roughness: 1 }));
}

/** Recolour a mesh (or every mesh under a group) through the palette atlas (lit: a lamp). */
export function pal<T extends THREE.Object3D>(o: T, hex: number, lit: boolean | 'soft' = false): T {
  const [u, v] = palUv(hex);
  const mat = lit === 'soft' ? paletteGlowSoft() : lit ? paletteGlow() : palettePlastic();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    const n = g.attributes.position.count;
    const uv = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    m.geometry = g;
    m.material = mat;
    if (lit) m.castShadow = false;
  });
  return o;
}

// ---------------------------------------------------------------------------------------------
// cloth: the harbour flag and the signal-pennant bunting share one texture

function clothMat(): THREE.MeshStandardMaterial {
  return once('cloth', () => {
    const t = canvasTexture(256, 128, (g) => {
      // left: Kittiwake harbour flag (cream field, orange cross, teal canton)
      g.fillStyle = '#f3e6c8';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#e8692a';
      g.fillRect(0, 50, 128, 28);
      g.fillRect(36, 0, 22, 128);
      g.fillStyle = '#25606a';
      g.fillRect(0, 0, 36, 50);
      // right: six pennant colours as vertical bands
      const cols = ['#e8692a', '#f2c230', '#2f7480', '#f3ead8', '#d23b2b', '#5fae8e'];
      cols.forEach((c, i) => {
        g.fillStyle = c;
        g.fillRect(128 + Math.floor((i * 128) / 6), 0, Math.ceil(128 / 6), 128);
      });
    });
    t.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
  });
}
export function flagMat(): THREE.MeshStandardMaterial {
  return clothMat();
}
/** A small cloth flag with baked ripples, hoisted along +x from the staff at x = 0. */
export function flagGeo(w: number, h: number, ripples = 2, amp = 0.06): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 8, 1);
  g.translate(w / 2, 0, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const k = x / w;
    p.setZ(i, Math.sin(k * Math.PI * ripples) * amp * k);
    p.setY(i, p.getY(i) - k * k * h * 0.12);
    uv.setX(i, uv.getX(i) * 0.5);
  }
  g.computeVertexNormals();
  return g;
}

export function buntingMat(): THREE.MeshStandardMaterial {
  return clothMat();
}
/** Triangular pennants hanging from a line a→b, as one geometry. */
export function buntingGeo(a: THREE.Vector3, b: THREE.Vector3, count: number, size = 0.22): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const dir = b.clone().sub(a);
  const step = dir.clone().multiplyScalar(1 / count);
  const halfW = step.clone().multiplyScalar(0.36);
  for (let i = 0; i < count; i++) {
    const c = a.clone().addScaledVector(step, i + 0.5);
    // sag of the line
    const s = Math.sin(((i + 0.5) / count) * Math.PI) * dir.length() * 0.025;
    c.y -= s;
    const p0 = c.clone().sub(halfW),
      p1 = c.clone().add(halfW),
      p2 = c.clone().add(new THREE.Vector3(0, -size, 0));
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    const u = 0.5 + ((i % 6) + 0.5) / 12;
    uv.push(u, 0.5, u, 0.5, u, 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// clutter builders (static; local origin on the floor or at the hang point as noted)

/**
 * Tyre fender hanging flat against the topsides (hole facing local x, the hull normal) from a short
 * rope `drop` metres long. Sun-faded rubber with pale sidewall rims so it never reads as a hole.
 * Origin = hang point on the rail.
 */
export function tyreFender(drop = 0.35, r = 0.27, out = 0.045): THREE.Group {
  const g = new THREE.Group();
  const cy = -drop - r;
  const t = ring(r, r * 0.38, K.tyre(), sg(6), sg(16));
  t.rotation.y = Math.PI / 2;
  t.position.set(out, cy, 0);
  g.add(t);
  for (const s of [-1, 1]) {
    // a raised pale ring on each sidewall (the sidewall sits at about 0.38 r off the mid-plane)
    const rim = pal(ring(r * 0.98, r * 0.055, K.iron(), 3, sg(18)), C.tyreRim);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(out + s * r * 0.37, cy, 0);
    rim.castShadow = false;
    g.add(rim);
  }
  // the rope: down from the rail and through the tyre
  g.add(bar(0, 0, 0, out, cy + r * 0.62, 0, 0.02, K.manila(), 5));
  const loop = ring(0.06, 0.018, K.manila(), 3, 8);
  loop.position.set(out, cy + r * 0.66, 0);
  loop.rotation.y = Math.PI / 2;
  g.add(loop);
  return g;
}

/** One ball buoy with its white (or orange) band and lifting eye; centre at the origin. */
function buoyBall(r: number, color: number, g: THREE.Group, x: number, y: number, z: number, tilt = 0): void {
  const b = pal(ball(r, K.iron(), sg(12, 6), x, y, z), color);
  b.scale.y = 0.94;
  g.add(b);
  const band = pal(ring(r * 0.99, r * 0.11, K.iron(), sg(4), sg(18, 8)), color === C.white ? C.orange : C.white);
  band.rotation.set(Math.PI / 2 + tilt, 0, tilt * 0.5);
  band.position.set(x, y, z);
  g.add(band);
  if (!lowSeg) {
    const eye = pal(ring(r * 0.2, r * 0.07, K.iron(), 3, 8), color);
    eye.position.set(x, y + r * 0.98, z);
    eye.rotation.z = tilt;
    g.add(eye);
  }
}

/** Ball buoy hanging on a short lanyard `drop` metres below the origin. */
export function hangingBuoy(drop = 0.2, r = 0.22, color: number = C.orange): THREE.Group {
  const g = new THREE.Group();
  buoyBall(r, color, g, 0, -drop - r, 0);
  g.add(bar(0, 0, 0, 0, -drop + 0.02, 0, 0.016, K.manila(), 4));
  return g;
}

/**
 * A tight bunch of buoys hung from one point on the rail on short lanyards, hugging the topsides
 * (like the stern-quarter bunch in the reference). Origin = hang point; the hull face is the local
 * yz plane through x = 0 with outboard = +x.
 */
export function buoyBunch(colors: number[], seed = 1): THREE.Group {
  const g = new THREE.Group();
  const r = rng(seed * 77 + 5);
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const rad = i === 0 ? 0.23 : 0.17 + r() * 0.04;
    const z = (i - (n - 1) / 2) * 0.36 + (r() - 0.5) * 0.05;
    const drop = 0.06 + (i % 2) * 0.2 + r() * 0.05;
    const x = rad - 0.035 + (i % 2) * 0.07;
    const y = -drop - rad;
    buoyBall(rad, colors[i], g, x, y, z, (r() - 0.5) * 0.5);
    g.add(bar(0.04, 0, z * 0.3, x, y + rad, z, 0.014, K.manila(), 4));
  }
  // the lashing round the rail
  const lash = ring(0.07, 0.022, K.manila(), 3, 8);
  lash.position.set(0.0, 0.02, 0);
  lash.rotation.y = Math.PI / 2;
  g.add(lash);
  return g;
}

/** A lying ball buoy (on deck or roof). Origin on the floor. */
export function buoyOnDeck(r = 0.24, color: number = C.orange): THREE.Group {
  const g = new THREE.Group();
  buoyBall(r, color, g, 0, r * 0.95, 0, 0.4);
  return g;
}

/** Plastic fish crate (open top) 0.62 × 0.28 × 0.42, origin on the floor. `fill` shows fish. */
export function fishCrate(color: number = C.orange, fill = false): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  const w = 0.62,
    h = 0.28,
    d = 0.42,
    t = 0.035;
  g.add(cbox(w, 0.04, d, m, 0.015, 0, 0.02, 0));
  g.add(cbox(w, h, t, m, 0.015, 0, h / 2, d / 2 - t / 2));
  g.add(cbox(w, h, t, m, 0.015, 0, h / 2, -d / 2 + t / 2));
  g.add(cbox(t, h, d - 2 * t, m, 0.015, w / 2 - t / 2, h / 2, 0));
  g.add(cbox(t, h, d - 2 * t, m, 0.015, -w / 2 + t / 2, h / 2, 0));
  pal(g, color);
  // handle slots read as darker bands
  const dark = (color & 0xfefefe) >> 1;
  g.add(pal(cbox(0.16, 0.05, 0.01, m, 0.01, 0, h - 0.06, d / 2 + 0.001), dark));
  g.add(pal(cbox(0.16, 0.05, 0.01, m, 0.01, 0, h - 0.06, -d / 2 - 0.001), dark));
  if (fill) {
    // a heap of silver fish (and a red one), heads and tails catching the light
    const fishCols = [0xc3d2d8, 0xa9bcc4, 0xd0dade, 0xe0743a, 0xb4c6cc, 0xc8d6da];
    for (let i = 0; i < 6; i++) {
      const fx = -0.2 + (i % 3) * 0.2 + (i > 2 ? 0.05 : 0),
        fz = i > 2 ? 0.08 : -0.08;
      const f = pal(ball(0.065, m, sg(8, 5), fx, h - 0.06 + (i > 2 ? 0.03 : 0), fz), fishCols[i]);
      f.scale.set(0.9, 0.5, 2.5);
      f.rotation.y = 1.2 + i * 0.7;
      g.add(f);
      const tail = pal(cbox(0.012, 0.06, 0.06, m, 0), 0x8fa4ad);
      tail.position.set(fx + Math.sin(1.2 + i * 0.7) * 0.17, h - 0.055 + (i > 2 ? 0.03 : 0), fz + Math.cos(1.2 + i * 0.7) * 0.17);
      tail.rotation.y = 1.2 + i * 0.7;
      g.add(tail);
    }
  }
  return g;
}

/** Oil drum (painted steel, ribbed) or plastic barrel. Origin on the floor. */
export function barrel(kind: 'steel' | 'plastic' = 'steel', color: number = C.blueBarrel): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  if (kind === 'steel') {
    g.add(pal(tube(0.28, 0.28, 0.86, m, sg(14, 8), 0, 0.43, 0), color));
    for (const y of [0.29, 0.57]) {
      const rib = pal(ring(0.285, 0.018, m, 3, sg(16, 8)), color);
      rib.rotation.x = Math.PI / 2;
      rib.position.y = y;
      g.add(rib);
    }
    const lid = ring(0.27, 0.025, m, 3, sg(16, 8));
    lid.rotation.x = Math.PI / 2;
    lid.position.y = 0.86;
    g.add(lid);
  } else {
    g.add(pal(tube(0.25, 0.25, 0.8, m, 12, 0, 0.42, 0), color));
    for (const y of [0.04, 0.8]) g.add(pal(tube(0.27, 0.27, 0.07, m, 12, 0, y, 0), color));
    g.add(pal(tube(0.05, 0.05, 0.05, m, 8, 0.12, 0.86, 0), C.white));
  }
  return g;
}

/** A flemish-coiled rope lying flat (a short stack of shrinking rings). Origin on the floor. */
export function ropeCoil(r = 0.36, turns = 4, color: number = C.manila, t = 0.045): THREE.Group {
  const g = new THREE.Group();
  const m = color === C.greenRope ? K.greenRope() : K.manila();
  for (let i = 0; i < turns; i++) {
    const c = ring(r - i * t * 1.6, t, m, sg(4), sg(16, 8));
    c.rotation.x = Math.PI / 2;
    c.position.y = t + i * t * 1.35;
    g.add(c);
  }
  return g;
}

/** A rope coil hanging on a peg (vertical rings), origin = peg. Faces local +z. */
export function hangingCoil(r = 0.22, color: number = C.manila): THREE.Group {
  const g = new THREE.Group();
  const m = color === C.greenRope ? K.greenRope() : K.manila();
  for (let i = 0; i < 4; i++) {
    const c = ring(r + (i % 2) * 0.02, 0.03, m, sg(4), sg(14, 7));
    c.position.set(0, -r + 0.02, 0.04 + i * 0.035);
    c.rotation.z = i * 0.6;
    g.add(c);
  }
  // the tail
  g.add(bar(0.02, -2 * r, 0.06, 0.08, -2 * r - 0.25, 0.08, 0.025, m));
  const peg = tube(0.025, 0.025, 0.12, K.iron(), 6, 0, 0, 0.06);
  peg.rotation.x = Math.PI / 2;
  g.add(peg);
  return g;
}

const netGeoCache = new Map<string, THREE.BufferGeometry>();
/** A heap of net, w × d footprint, h tall, with cork floats. Origin on the floor. */
export function netPile(w = 1.0, d = 0.8, h = 0.42, seed = 1): THREE.Group {
  const g = new THREE.Group();
  const det = lowDetail() ? 1 : 2;
  const key = `${w}_${d}_${h}_${seed}_${det}`;
  let geo = netGeoCache.get(key);
  if (!geo) {
    geo = new THREE.IcosahedronGeometry(1, det);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const r = rng(seed * 991);
    const bumps = Array.from({ length: 7 }, () => [r() * 2 - 1, r() * 0.6, r() * 2 - 1, 0.25 + r() * 0.35] as const);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let k = 1;
      for (const [bx, by, bz, s] of bumps) k += s * Math.exp(-((v.x - bx) ** 2 + (v.y - by) ** 2 + (v.z - bz) ** 2) * 3);
      v.multiplyScalar(k * 0.75);
      v.y = Math.max(0, v.y);
      p.setXYZ(i, (v.x * w) / 2, v.y * h, (v.z * d) / 2);
    }
    geo.computeVertexNormals();
    netGeoCache.set(key, geo);
  }
  g.add(prep(new THREE.Mesh(geo, K.net())));
  const r = rng(seed * 313);
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2,
      rr = 0.2 + r() * 0.35;
    const x = Math.cos(a) * rr * w * 0.5,
      z = Math.sin(a) * rr * d * 0.5;
    const f = pal(ball(0.06, K.iron(), sg(6, 4), x, h * (0.45 + 0.4 * (1 - rr)), z), C.orange);
    f.scale.set(1, 0.7, 1.4);
    f.rotation.y = a;
    g.add(f);
  }
  return g;
}

/**
 * A net thrown over the bulwark: a lumpy heap on the cap rail that spills down the outside of the
 * topsides, with a few floats. Origin = the outer edge of the cap rail at its top; outboard = +x,
 * the rail runs along z. Nothing reaches inboard of x = -0.16 (the cap's inner edge).
 */
export function netDrape(len = 1.2, drop = 0.75, seed = 4): THREE.Group {
  const g = new THREE.Group();
  // heap on the cap
  const top = netPile(0.3, len, 0.17, seed);
  top.position.set(-0.02, -0.01, 0);
  g.add(top);
  // hanging folds: upside-down heaps hugging the hull side, longest in the middle
  const folds: [number, number, number][] = [
    [0, len * 0.8, drop],
    [-len * 0.28, len * 0.38, drop * 0.72],
    [len * 0.3, len * 0.34, drop * 0.82],
  ];
  folds.forEach(([z, l, h], k) => {
    const f = netPile(0.2, l, h, seed + 3 + k);
    f.rotation.z = Math.PI;
    f.position.set(0.09 + k * 0.015, 0.03, z);
    g.add(f);
  });
  return g;
}

/** Mooring cleat (dark iron), origin on the mounting surface, horn along local z. */
export function cleat(len = 0.26): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(cbox(0.08, 0.05, 0.1, m, 0.015, 0, 0.025, 0));
  g.add(cbox(0.05, 0.04, len, m, 0.018, 0, 0.07, 0));
  return g;
}

/** Twin mooring bitts on a base plate. Origin on the deck. */
export function bitts(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(cbox(0.6, 0.04, 0.22, m, 0.015, 0, 0.02, 0));
  for (const x of [-0.18, 0.18]) {
    g.add(tube(0.065, 0.075, 0.32, m, 10, x, 0.2, 0));
    g.add(tube(0.085, 0.085, 0.04, m, 10, x, 0.37, 0));
  }
  return g;
}

/** Fire extinguisher on a bracket (origin at the wall, facing +z). */
export function extinguisher(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(pal(tube(0.07, 0.07, 0.42, m, 10, 0, 0, 0.09), C.red));
  g.add(pal(ball(0.07, m, 8, 0, 0.21, 0.09), C.red));
  g.add(cbox(0.05, 0.08, 0.04, m, 0.01, 0, 0.3, 0.09));
  g.add(cbox(0.16, 0.04, 0.04, m, 0.01, 0, 0.0, 0.02));
  return g;
}

/** A wooden boathook / pike pole on two pegs, along local x (origin at the wall, facing +z). */
export function boathook(len = 1.8): THREE.Group {
  const g = new THREE.Group();
  g.add(tubeX(0.022, len, K.varnish(), 6, 0, 0, 0.05));
  const hook = ring(0.06, 0.012, K.brass(), 4, 8, Math.PI * 1.3);
  hook.position.set(len / 2 + 0.02, 0.04, 0.05);
  g.add(hook);
  for (const x of [-len * 0.3, len * 0.3]) {
    const peg = tube(0.015, 0.015, 0.08, K.iron(), 6, x, -0.03, 0.03);
    peg.rotation.x = Math.PI / 2;
    g.add(peg);
  }
  return g;
}

/** Life-raft canister on a cradle, axis along local x. Origin on the floor. */
export function liferaft(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(pal(tubeX(0.26, 0.86, m, 14, 0, 0.36, 0), C.offWhite));
  for (const x of [-0.43, 0.43]) {
    const cap = pal(ball(0.26, m, 12, x, 0.36, 0), C.offWhite);
    cap.scale.x = 0.35;
    g.add(cap);
  }
  // straps and the cradle
  for (const x of [-0.25, 0.25]) {
    const s = pal(ring(0.27, 0.024, K.iron(), 3, 18), C.orange);
    s.rotation.y = Math.PI / 2;
    s.position.set(x, 0.36, 0);
    g.add(s);
    g.add(cbox(0.06, 0.12, 0.5, m, 0.01, x, 0.06, 0));
  }
  const seam = pal(ring(0.262, 0.012, m, 3, 16), 0x9aa3a6);
  seam.rotation.y = Math.PI / 2;
  seam.position.set(0, 0.36, 0);
  g.add(seam);
  return g;
}

/**
 * Radome: a short off-white drum with a domed top and a dark seam, on a steel bracket with a
 * cable gland. Origin on the mounting surface.
 */
export function radarDome(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  // bracket: base plate, two gussets and a short post
  g.add(cbox(0.42, 0.03, 0.42, m, 0.01, 0, 0.015, 0));
  g.add(tube(0.07, 0.08, 0.2, K.steel(), 10, 0, 0.12, 0));
  for (const s of [-1, 1]) g.add(cbox(0.02, 0.14, 0.24, K.steel(), 0.005, s * 0.06, 0.09, 0));
  g.add(cbox(0.5, 0.03, 0.5, K.steel(), 0.01, 0, 0.23, 0));
  // drum + dome
  g.add(pal(tube(0.32, 0.31, 0.16, m, sg(20, 12), 0, 0.33, 0), C.offWhite));
  const seam = pal(ring(0.322, 0.012, m, 3, sg(24, 12)), 0x6b6f72);
  seam.rotation.x = Math.PI / 2;
  seam.position.y = 0.41;
  g.add(seam);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, sg(20, 12), sg(6, 4), 0, Math.PI * 2, 0, Math.PI / 2), m);
  dome.scale.y = 0.55;
  dome.position.y = 0.41;
  dome.castShadow = true;
  dome.receiveShadow = true;
  g.add(pal(dome, C.offWhite));
  // cable gland
  const cab = bar(0.05, 0.05, 0.08, 0.2, 0.0, 0.2, 0.018, m, 5);
  g.add(cab);
  return g;
}

/** Open-array radar scanner (bar), along local x. Origin at its pedestal base. */
export function radarScanner(len = 1.2): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(pal(cbox(0.22, 0.18, 0.26, m, 0.04, 0, 0.09, 0), C.offWhite));
  g.add(pal(cbox(len, 0.1, 0.12, m, 0.04, 0, 0.26, 0), C.offWhite));
  g.add(pal(cbox(len - 0.1, 0.02, 0.124, m, 0.005, 0, 0.26, 0), 0x3a3f43));
  return g;
}

/**
 * Navigation sidelight: a little dark lamp box with a cap, a black screen on its inboard side and
 * a coloured lens on the outboard face only (+x). Origin at the base.
 */
export function sidelight(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(cbox(0.12, 0.14, 0.14, K.cream(), 0.025, 0, 0.07, 0));
  g.add(cbox(0.16, 0.025, 0.18, K.cream(), 0.01, 0.01, 0.152, 0));
  g.add(pal(cbox(0.02, 0.18, 0.26, m, 0.006, -0.072, 0.085, 0.02), 0x26292c));
  g.add(pal(cbox(0.025, 0.1, 0.11, m, 0.008, 0.062, 0.075, 0), color, 'soft'));
  return g;
}

/**
 * Deck floodlight: dark housing with a short visor, warm lens (not pure white) facing local -z.
 * Origin at the bracket.
 */
export function floodlight(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(cbox(0.24, 0.18, 0.14, m, 0.035, 0, 0, 0));
  g.add(cbox(0.16, 0.12, 0.06, m, 0.02, 0, 0, 0.08));
  const visor = cbox(0.27, 0.02, 0.1, m, 0.006, 0, 0.1, -0.1);
  visor.rotation.x = -0.25;
  g.add(visor);
  for (const s of [-1, 1]) g.add(cbox(0.015, 0.16, 0.08, m, 0.004, s * 0.128, 0.02, -0.08));
  g.add(pal(cbox(0.19, 0.13, 0.015, m, 0.008, 0, -0.005, -0.072), 0xffc884, 'soft'));
  return g;
}

/** Searchlight on a yoke, pointing local +z. Origin on the mounting surface. */
export function searchlight(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(tube(0.05, 0.07, 0.12, m, 8, 0, 0.06, 0));
  g.add(cbox(0.3, 0.04, 0.06, m, 0.01, 0, 0.14, 0));
  g.add(tubeZ(0.11, 0.26, K.steel(), 12, 0, 0.26, 0));
  const lens = pal(ball(0.1, m, 10, 0, 0.26, 0.13), 0xffd59a, 'soft');
  lens.scale.z = 0.3;
  g.add(lens);
  return g;
}

/** Brass air horn pointing local +z. Origin on the mounting surface. */
export function horn(): THREE.Group {
  const g = new THREE.Group();
  g.add(cbox(0.08, 0.08, 0.1, K.iron(), 0.01, 0, 0.04, 0));
  const bell = new THREE.Mesh(cylGeo(0.09, 0.025, 0.36, 10, true), K.brass());
  bell.rotation.x = Math.PI / 2;
  bell.position.set(0, 0.12, 0.12);
  bell.castShadow = true;
  g.add(bell);
  return g;
}

/** A stockless anchor, shank along -y from the origin (the hawse). */
export function anchor(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  g.add(cbox(0.09, 0.62, 0.07, m, 0.02, 0, -0.32, 0));
  g.add(cbox(0.46, 0.14, 0.12, m, 0.04, 0, -0.66, 0));
  for (const s of [-1, 1]) {
    const fl = cbox(0.12, 0.34, 0.08, m, 0.03, s * 0.2, -0.56, 0.04);
    fl.rotation.z = s * -0.25;
    fl.rotation.x = -0.25;
    g.add(fl);
  }
  g.add(ring(0.06, 0.018, m, 4, 10));
  return g;
}

/** Anchor windlass: a drum (gypsy) between cheeks on a base. Origin on the deck, drum along x. */
export function windlass(): THREE.Group {
  const g = new THREE.Group();
  const body = K.machine();
  const iron = K.iron();
  g.add(cbox(0.9, 0.12, 0.5, body, 0.04, 0, 0.06, 0));
  for (const x of [-0.4, 0, 0.4]) g.add(cbox(0.08, 0.42, 0.4, body, 0.03, x, 0.3, 0));
  g.add(tubeX(0.04, 1.0, iron, 8, 0, 0.36, 0));
  for (const x of [-0.2, 0.2]) {
    g.add(tubeX(0.13, 0.22, iron, 12, x, 0.36, 0));
    g.add(tubeX(0.17, 0.03, iron, 12, x - 0.11, 0.36, 0));
    g.add(tubeX(0.17, 0.03, iron, 12, x + 0.11, 0.36, 0));
  }
  return g;
}

/** A short run of chain from a to b (alternating links, approximated as small rings). */
export function chain(a: THREE.Vector3, b: THREE.Vector3, link = 0.07): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  const n = Math.max(2, Math.floor(a.distanceTo(b) / (link * 1.4)));
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  for (let i = 0; i < n; i++) {
    const l = ring(link * 0.5, link * 0.14, m, 3, 8);
    l.position.copy(a).lerp(b, (i + 0.5) / n);
    l.quaternion.copy(q);
    l.rotateX(i % 2 ? Math.PI / 2 : 0);
    l.scale.set(1.3, 0.75, 1);
    l.castShadow = false;
    g.add(l);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// baked contact shadows: soft dark decals under props and along wall bases, so things sit on the
// deck even on the Low tier (no shadow maps). One material, folded into one draw call.

let _aoTex: THREE.CanvasTexture | null = null;
function aoTexture(): THREE.CanvasTexture {
  if (_aoTex) return _aoTex;
  const n = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * 2 - 1,
        y = ((j + 0.5) / n) * 2 - 1;
      const d = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(y), 4), 0.25); // rounded square
      const t = Math.min(1, Math.max(0, (1 - d) / 0.75));
      const a = Math.round(255 * t * t * (3 - 2 * t));
      const k = (j * n + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = a;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  _aoTex = new THREE.CanvasTexture(cv);
  _aoTex.colorSpace = THREE.NoColorSpace;
  return _aoTex;
}
export function aoMat(): THREE.MeshBasicMaterial {
  return once('ao', () => {
    const m = new THREE.MeshBasicMaterial({ color: 0x1a0e06, alphaMap: aoTexture(), transparent: true, opacity: 0.42, depthWrite: false });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  });
}
/** A soft rounded-rectangle shadow lying flat at height y, w × d. */
export function aoBlob(x: number, z: number, w: number, d: number, y = 0.006, rotY = 0): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, aoMat());
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 1;
  return m;
}
/** A soft strip fading away from the edge a→b toward (nx, nz) over `width` (wall-base occlusion). */
export function aoEdge(ax: number, az: number, bx: number, bz: number, nx: number, nz: number, width: number, y = 0.006): THREE.Mesh {
  const pos = [ax, y, az, bx, y, bz, ax + nx * width, y, az + nz * width, bx + nx * width, y, bz + nz * width];
  const uv = [0.5, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  // both windings so it shows whichever way the edge runs
  g.setIndex([0, 1, 2, 1, 3, 2, 0, 2, 1, 1, 2, 3]);
  const m = new THREE.Mesh(g, aoMat());
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 1;
  return m;
}

/** A herring gull perched (facing local +z). Origin at its feet. */
export function gull(): THREE.Group {
  const g = new THREE.Group();
  const m = K.iron();
  const body = pal(ball(0.1, m, 8, 0, 0.13, 0), 0xf6f3ec);
  body.scale.set(0.85, 0.8, 1.45);
  g.add(body);
  const head = pal(ball(0.065, m, 8, 0, 0.24, 0.12), 0xf6f3ec);
  g.add(head);
  const beak = pal(new THREE.Mesh(cylGeo(0.0, 0.018, 0.08, 5), m), 0xf2c230);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.23, 0.21);
  g.add(beak);
  for (const s of [-1, 1]) {
    const wing = pal(cbox(0.03, 0.08, 0.26, m, 0.012, s * 0.075, 0.16, -0.03), 0x8f979c);
    wing.rotation.x = 0.18;
    g.add(wing);
    const tip = pal(cbox(0.032, 0.05, 0.08, m, 0.01, s * 0.07, 0.17, -0.19), 0x2a2d30);
    tip.rotation.x = 0.25;
    g.add(tip);
    g.add(pal(cbox(0.015, 0.06, 0.015, m, 0.004, s * 0.035, 0.03, 0.0), 0xe8a040));
  }
  for (const s of [-1, 1]) g.add(pal(ball(0.012, m, 4, s * 0.03, 0.26, 0.17), 0x1a1a1a));
  return g;
}

/** A cheap merged geometry from a list of meshes (local transforms baked). */
export function mergeMeshes(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  const geos = meshes.map((m) => {
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  });
  return mergeGeometries(geos, false)!;
}

/** Glow helper re-exported for convenience. */
export { glow };
