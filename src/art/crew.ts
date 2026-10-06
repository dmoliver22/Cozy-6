/**
 * makeCrew(): chunky glossy toy figurines. Each one wears an A-line oilskin slicker (open at the
 * front over bib overalls, a two-tone yoke across the shoulders, a puffy collar with a contrast
 * lining, the hood rolled up behind, wooden toggles and silver reflective tape), rubber boots and
 * hand-knitted mittens, and has a big round head with a simple face.
 *
 * Each body part is its own Object3D so the same view can be driven by the standing animation or
 * by the 6-body ragdoll. Part origin = its joint pivot; `center` = offset from pivot to the
 * physics body centre. The pivots and physics shapes are shared by every crew member (see
 * crew/ragdoll.ts); builds (stocky, lanky) only change the meshes inside a part.
 *
 * Two levels of detail per part (THREE.LOD, switched by camera distance): the full model for the
 * galley, the knit shop, photos and first person, and a light one for the overhead camera (where a
 * figure is only 50-120 px tall) with the face painted into the skin texture instead of modelled.
 * Both levels have the same silhouette. Every level's meshes are merged per material, and toy
 * wear and contact shading (creases under the collar, elbows, between the legs, boot tops, under
 * the hat) are baked into vertex colours, which cost nothing at run time.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config } from '../config';
import { plastic, metal } from './materials';
import { MARKER_LAYER, OVERLAY_LAYER } from '../render/overlay';

const P = config.palette;

export type PartName = 'legs' | 'pelvis' | 'chest' | 'head' | 'armL' | 'armR';
export type HatStyle = 'beanie' | 'cap' | 'souwester' | 'bobble' | 'bucket';

export interface CrewLook {
  name: string;
  slicker: number;
  skin: number;
  hatStyle: HatStyle;
  hatColor: number;
  beard?: number;
  hair?: number;
  boots?: number;
  isPlayer?: boolean;
  /** bib overalls colour (defaults to a darker shade of the slicker); also the yoke, hood and collar lining */
  bibs?: number;
  /** knitted mittens */
  mitts?: number;
  /** stocky = broad and round; lanky = narrow with a long neck */
  build?: 'regular' | 'stocky' | 'lanky';
  /** a braid down the back (hair colour) */
  braid?: boolean;
  freckles?: boolean;
  /** eyebrow tilt in radians: + outer ends up (stern), - inner ends up (worried) */
  brow?: number;
}

export interface CrewPart {
  obj: THREE.Object3D;
  /** pivot position in the root (standing pose) */
  rest: THREE.Vector3;
  /** body centre relative to the pivot (in part space) */
  center: THREE.Vector3;
  /** ragdoll body shape */
  shape: { type: 'box' | 'ball' | 'capsule'; size: number[] };
  mass: number;
  coloured: THREE.Mesh[];
}

export interface CrewView {
  root: THREE.Group; // standing root = capsule centre
  body: THREE.Group; // lean / wobble group
  parts: Record<PartName, CrewPart>;
  hat: THREE.Group;
  hatRest: THREE.Vector3;
  mittens: THREE.Mesh[];
  ring: THREE.Mesh; // soft ring under the feet (positioned in deck space by the owner)
  bubble: THREE.Mesh; // tiny "!" for warnings (unused by default)
  setSuit(on: boolean): void;
  setHatColor(c: number): void;
  setSlicker(c: number): void;
  setHighlight(on: boolean): void;
  outlines: THREE.Mesh[];
}

/** Beyond this camera distance (metres) a figure shows its light model. */
const LOD_DIST = 11;

// ---------------------------------------------------------------------------------------------
// fabrics: knitted wool and crinkled oilskin, drawn on canvases (no image files)

const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const texCache = new Map<string, THREE.Texture>();
function fabricTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, n: number) => void): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // a grey detail multiplier, used as-is (linear) so colours stay true
  t.colorSpace = THREE.NoColorSpace;
  // three clamps this to the GPU's maximum; phones get a cheaper cap
  t.anisotropy = COARSE ? 4 : 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  texCache.set(key, t);
  return t;
}

/**
 * Stocking stitch: columns of fat little V's. Tiles seamlessly; light so it barely darkens the
 * colour. Pieces set the stitch density through their UVs (a few chunky stitches, not a fine grain).
 */
export function knitTexture(): THREE.Texture {
  return fabricTex('knit2', 256, (g, n) => {
    g.fillStyle = '#9e9e9e';
    g.fillRect(0, 0, n, n);
    const cols = 8,
      rows = 10;
    const cw = n / cols,
      rh = n / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const cx = c * cw + cw / 2,
          cy = r * rh + rh / 2;
        for (const s of [-1, 1]) {
          for (const dx of [0, -n, n])
            for (const dy of [0, -n, n]) {
              const x = cx + s * cw * 0.23 + dx,
                y = cy + dy;
              const grd = g.createRadialGradient(x, y - rh * 0.12, 0, x, y, cw * 0.4);
              grd.addColorStop(0, '#ffffff');
              grd.addColorStop(0.55, '#e2e2e2');
              grd.addColorStop(1, '#a4a4a4');
              g.fillStyle = grd;
              g.beginPath();
              g.ellipse(x, y, cw * 0.21, rh * 0.6, -s * 0.5, 0, Math.PI * 2);
              g.fill();
            }
        }
      }
  });
}

/** Soft crinkles for waxed oilskin (a bump map). */
function crinkleTexture(): THREE.Texture {
  return fabricTex('crinkle', 128, (g, n) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, n, n);
    let s = 1234567;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      const x = r() * n,
        y = r() * n,
        l = 6 + r() * 22,
        a = r() * Math.PI;
      for (const dx of [0, -n, n])
        for (const dy of [0, -n, n]) {
          g.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
          g.lineWidth = 1 + r() * 2.5;
          g.beginPath();
          g.moveTo(x + dx - Math.cos(a) * l, y + dy - Math.sin(a) * l);
          g.quadraticCurveTo(x + dx + (r() - 0.5) * 8, y + dy + (r() - 0.5) * 8, x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
          g.stroke();
        }
    }
  });
}

/**
 * Fade a bump map out with view distance (no stitch moire or shimmer from the overhead camera;
 * full relief up close). `near`..`far` in metres.
 */
function bumpFade(m: THREE.MeshStandardMaterial, near: number, far: number, min: number): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `float bumpFadeK = clamp(1.0 - (length(vViewPosition) - ${near.toFixed(2)}) / ${(far - near).toFixed(2)}, ${min.toFixed(2)}, 1.0);\n` +
        THREE.ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '(dHdxy_fwd() * bumpFadeK)'),
    );
  };
  m.customProgramCacheKey = () => `bumpfade${near}_${far}_${min}`;
  return m;
}

const knitCache = new Map<number, THREE.MeshStandardMaterial>();
/** Knitted wool (hats, mittens). `unique` for a material whose colour changes later. */
export function knitMat(color: number, unique = false): THREE.MeshStandardMaterial {
  const make = () => {
    const t = knitTexture();
    return bumpFade(new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 0.9, roughness: 0.92, metalness: 0 }), 3, 11, 0.1);
  };
  if (unique) return make();
  let m = knitCache.get(color);
  if (!m) knitCache.set(color, (m = make()));
  return m;
}

/** Glossy waxed oilskin whose colour changes at run time (one per figure); takes baked shading. */
function slickerMat(color: number, vc = true): THREE.MeshStandardMaterial {
  return bumpFade(new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0, bumpMap: crinkleTexture(), bumpScale: 0.45, vertexColors: vc }), 4, 14, 0.25);
}

const vcCache = new Map<string, THREE.MeshStandardMaterial>();
/** Toy plastic that takes the baked vertex shading (shared by colour). */
function toy(color: number, rough: number, metalness = 0): THREE.MeshStandardMaterial {
  const k = `${color}_${rough}_${metalness}`;
  let m = vcCache.get(k);
  if (!m) vcCache.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness, vertexColors: true })));
  return m;
}

// ---------------------------------------------------------------------------------------------
// small builders

type V3 = [number, number, number];
/** Per-piece options: `tint` scales the baked shade (edge highlights), `ao` names a shading rule, `uv` pins the UVs to one texel. */
interface PieceOpts {
  tint?: number;
  ao?: AoTag;
  uv?: [number, number];
}
function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: V3 = [0, 0, 0], s?: V3, r?: V3, cast = true, o?: PieceOpts): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  if (s) m.scale.set(s[0], s[1], s[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = cast;
  m.receiveShadow = true;
  if (o) m.userData.piece = o;
  parent.add(m);
  return m;
}
const geoCache = new Map<string, THREE.BufferGeometry>();
/** Geometry shared between figures (baking copies it, so sharing is safe). */
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

/** Detail level being built: `k` scales segment counts (phones get lighter close-up models too). */
interface Q {
  hi: boolean;
  k: number;
}
const HI: Q = { hi: true, k: COARSE ? 0.7 : 1 };
const LO: Q = { hi: false, k: COARSE ? 0.85 : 1 };
const segs = (q: Q, n: number, min = 4) => Math.max(min, Math.round(n * q.k));
const sph = (q: Q, r: number, w = 12, h = 8) => {
  const a = segs(q, w, 5),
    b = segs(q, h);
  return geo(`s${r}_${a}_${b}`, () => new THREE.SphereGeometry(r, a, b));
};
const cylG = (q: Q, rt: number, rbot: number, h: number, seg = 12, open = false) => {
  const a = segs(q, seg, 6);
  return geo(`c${rt}_${rbot}_${h}_${a}_${open}`, () => new THREE.CylinderGeometry(rt, rbot, h, a, 1, open));
};
/** A cheaper rounded box (1 corner segment) for small or half-hidden pieces. */
const rb1 = (w: number, h: number, d: number, r: number) =>
  geo(`rb1_${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
/** The light model's rounded box: an octagonal prism (32 triangles instead of 108). */
const lowBox = (w: number, h: number, d: number) =>
  geo(`lb_${w}_${h}_${d}`, () => {
    const c = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    c.rotateY(Math.PI / 8);
    c.scale(w * 1.04, h, d * 1.04);
    return c;
  });
/** Rounded box at full detail, octagonal prism in the light model. */
const rbq = (q: Q, w: number, h: number, d: number, r: number) => (q.hi ? rb1(w, h, d, r) : lowBox(w, h, d));
/** A copy of a geometry with scaled UVs (sets the stitch density per piece before merging). */
function uvs(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  return geo(`${g.uuid}_uv${su}_${sv}`, () => {
    const c = g.clone();
    const uv = c.attributes.uv as THREE.BufferAttribute | undefined;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return c;
  });
}
/** A child group that applies a build scale to everything put in it (baked away). */
function inner(part: THREE.Object3D, s: V3 = [1, 1, 1], p: V3 = [0, 0, 0]): THREE.Group {
  const g = new THREE.Group();
  g.scale.set(s[0], s[1], s[2]);
  g.position.set(p[0], p[1], p[2]);
  part.add(g);
  return g;
}
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/**
 * A soft body swept through superellipse rings (rounded-rectangle cross-sections) from `rows`
 * [y, halfWidth, halfDepth] bottom to top, closed at both ends. Smooth normals, UVs u around and
 * v in metres of height (for the crinkle bump).
 */
function sweptBody(rows: [number, number, number][], around: number, pow = 2.6, close: [boolean, boolean] = [true, true], grow = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = around;
  const e = 2 / pow;
  const sgn = (v: number) => (v < 0 ? -1 : 1);
  rows.forEach(([y, hw, hd]) => {
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const c = Math.cos(t),
        s = Math.sin(t);
      pos.push(sgn(c) * Math.abs(c) ** e * (hw + grow), y, sgn(s) * Math.abs(s) ** e * (hd + grow));
      uv.push((i / n) * 6, y * 4);
    }
  });
  const R = n + 1;
  for (let r = 0; r < rows.length - 1; r++)
    for (let i = 0; i < n; i++) {
      const a = r * R + i,
        b = a + 1,
        c = a + R,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const cap = (row: number, top: boolean) => {
    const [y] = rows[row];
    const ci = pos.length / 3;
    pos.push(0, y + (top ? 0.012 : -0.012), 0);
    uv.push(0.5, y * 4);
    for (let i = 0; i < n; i++) {
      const a = row * R + i,
        b = a + 1;
      if (top) idx.push(a, ci, b);
      else idx.push(a, b, ci);
    }
  };
  if (close[0]) cap(0, false);
  if (close[1]) cap(rows.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam's normals (the seam column is duplicated for the UVs)
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3(),
    w = new THREE.Vector3();
  for (let r = 0; r < rows.length; r++) {
    v.fromBufferAttribute(nor, r * R).add(w.fromBufferAttribute(nor, r * R + n)).normalize();
    nor.setXYZ(r * R, v.x, v.y, v.z);
    nor.setXYZ(r * R + n, v.x, v.y, v.z);
  }
  return g;
}

/** Part of a torus lying in the XZ plane (y up); the tube angle v runs from v0 over dv (0 = outside, PI/2 = top, PI = inside). */
function torusPart(R: number, r: number, around: number, tube: number, v0: number, dv: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= tube; j++) {
    const v = v0 + (dv * j) / tube;
    for (let i = 0; i <= around; i++) {
      const u = (i / around) * Math.PI * 2;
      const cx = Math.cos(u),
        cz = Math.sin(u);
      pos.push((R + r * Math.cos(v)) * cx, r * Math.sin(v), (R + r * Math.cos(v)) * cz);
      nrm.push(Math.cos(v) * cx, Math.sin(v), Math.cos(v) * cz);
      uv.push((i / around) * 6, j / tube);
    }
  }
  const W = around + 1;
  for (let j = 0; j < tube; j++)
    for (let i = 0; i < around; i++) {
      const a = j * W + i,
        b = a + 1,
        c = a + W,
        d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A turned-up knitted cuff: a short thick band with a rolled top, ribbed vertically (hi detail only). */
function ribbedCuff(q: Q, r: number, h: number, ribs: number): THREE.BufferGeometry {
  const around = q.hi ? ribs * 2 : segs(q, 14, 10);
  const prof: [number, number][] = q.hi
    ? [
        [r - 0.012, -h / 2],
        [r, -h / 2],
        [r + 0.004, h / 2 - 0.012],
        [r + 0.001, h / 2 - 0.002],
        [r - 0.008, h / 2 + 0.004],
        [r - 0.016, h / 2],
      ]
    : [
        [r, -h / 2],
        [r + 0.004, h / 2 - 0.01],
        [r - 0.006, h / 2 + 0.004],
        [r - 0.016, h / 2],
      ];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= around; i++) {
    const t = (i / around) * Math.PI * 2;
    const rib = q.hi ? 0.007 * (0.5 + 0.5 * Math.cos(t * ribs)) : 0.003;
    prof.forEach(([pr, py], j) => {
      const rr = pr + (j > 0 && j < prof.length - 1 ? rib : 0);
      pos.push(Math.cos(t) * rr, py, Math.sin(t) * rr);
      uv.push(((i / around) * ribs) / 8, (j / (prof.length - 1)) * 0.4);
    });
  }
  const P2 = prof.length;
  for (let i = 0; i < around; i++)
    for (let j = 0; j < P2 - 1; j++) {
      const a = i * P2 + j,
        b = a + 1,
        c = a + P2,
        d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// baking: merge a level's meshes per material, with shading baked into vertex colours

type AoTag = 'slicker' | 'yoke' | 'bib' | 'skin' | 'hair' | 'boot' | 'tape' | 'trim' | 'none';
interface AoCtx {
  part: PartName | 'hat';
  /** pivot of the part in the root at rest (root-space shading) */
  rest: THREE.Vector3;
  /** root-space height of the hat's seat (for the shadow under the brim) */
  seat: number;
  side: number;
}

/** Contact shading and toy wear in root space (p, n at rest). */
function crewShade(c: AoCtx, tag: AoTag, p: THREE.Vector3, n: THREE.Vector3): number {
  if (tag === 'none') return 1;
  // sky occlusion: faces turned down are a little darker
  let k = 0.86 + 0.14 * (n.y * 0.5 + 0.5);
  const ax = Math.abs(p.x);
  if (c.part === 'chest') {
    // the crease under the collar and the hood
    k *= 1 - 0.24 * bump(p.y, 0.43, 0.035) * (ax < 0.24 ? 1 : 0.5);
    // the torso's sides, shadowed by the arms
    if (ax > 0.2 && p.y < 0.42) k *= 1 - 0.2 * Math.max(0, (n.x * Math.sign(p.x) - 0.3) / 0.7) * smooth(0.2, 0.28, ax);
    // the turned-under hem
    if (n.y < -0.4) k *= 0.72;
  }
  if (c.part === 'pelvis') k *= 1 - 0.3 * smooth(-0.16, -0.08, p.y); // under the slicker hem
  if (c.part === 'legs') {
    // between the legs
    if (ax < 0.13 && n.x * Math.sign(p.x) < -0.2) k *= 1 - 0.28 * smooth(0.13, 0.04, ax);
    // the crotch, in the shadow of the hem
    k *= 1 - 0.2 * smooth(-0.3, -0.18, p.y);
    // boot tops: the trouser cuff and the boot just below it
    k *= 1 - 0.22 * bump(p.y, -0.58, 0.03);
  }
  if (c.part === 'armL' || c.part === 'armR') {
    // the inside of the arm, against the body; the crook of the elbow
    const inward = Math.max(0, -n.x * c.side);
    k *= 1 - 0.2 * inward;
    k *= 1 - 0.15 * bump(p.y, 0.2, 0.05) * Math.max(0, n.z);
    // the top of the mitten, under the sleeve
    if (tag !== 'slicker' && tag !== 'yoke' && tag !== 'tape') k *= 1 - 0.2 * smooth(0.12, 0.1, p.y);
  }
  if (c.part === 'head' && (tag === 'skin' || tag === 'hair')) {
    // under the hat brim
    k *= 1 - 0.24 * smooth(c.seat - 0.17, c.seat - 0.07, p.y);
    // under the chin
    if (n.y < -0.3) k *= 1 - 0.22 * Math.min(1, -n.y);
  }
  if (tag === 'tape') k = 0.8 + 0.2 * k;
  return k;
}

/** Merge every mesh under `level` per material (relative to it), baking shade into vertex colours where the material takes them. */
function bakeLevel(level: THREE.Object3D, ctx: AoCtx | null): void {
  level.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(level.matrixWorld).invert();
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  const meshes: THREE.Mesh[] = [];
  level.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    g.applyMatrix4(rel);
    const o: PieceOpts = mesh.userData.piece ?? {};
    if (o.uv) {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, o.uv[0], o.uv[1]);
    }
    if (mat.vertexColors) {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const nor = g.attributes.normal as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      nm.identity();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        n.fromBufferAttribute(nor, i).normalize();
        if (ctx) p.add(ctx.rest);
        const k = (ctx ? crewShade(ctx, o.ao ?? 'none', p, n) : 1) * (o.tint ?? 1);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const e = byMat.get(mat) ?? { geos: [], cast: false };
    e.geos.push(g);
    e.cast ||= mesh.castShadow;
    byMat.set(mat, e);
    mesh.removeFromParent();
  }
  for (const ch of level.children.slice()) ch.removeFromParent();
  for (const [mat, e] of byMat) {
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = true;
    mesh.name = 'merged';
    level.add(mesh);
  }
}

/** Build a part twice (full and light), bake each, and hang both on a distance LOD under `part`. */
function lodPart(part: THREE.Object3D, build: (g: THREE.Group, q: Q) => void, ctx: AoCtx | null): void {
  const lod = new THREE.LOD();
  for (const q of [HI, LO]) {
    const lvl = new THREE.Group();
    build(lvl, q);
    bakeLevel(lvl, ctx);
    lod.addLevel(lvl, q.hi ? 0 : LOD_DIST, 0.08);
  }
  part.add(lod);
}

// head geometry (head-part space, before the head scale and any neck raise)
const SKULL_R = 0.215;
const SKULL_Y = 0.17;
const SKULL_SZ = 0.95;
/** Heads (and hats) are drawn oversized: chunky toy proportions that read from the overhead camera. */
const HEAD_K = 1.2;
/** z of the face surface at (x, y) in head space, so features sit on the skull. */
function faceZ(x: number, y: number): number {
  const dy = (y - SKULL_Y) / SKULL_SZ;
  return SKULL_SZ * Math.sqrt(Math.max(0, SKULL_R * SKULL_R - x * x - dy * dy));
}

/** Where each hat sits on the head, in unscaled head units above the neck pivot. */
const HAT_SEAT_UNIT: Record<HatStyle, number> = { beanie: 0.3472, bobble: 0.3472, cap: 0.3611, bucket: 0.3315, souwester: 0.3333 };
/** Hats are scaled by HEAD_K about a point raised so their rim stays at y = -0.07 (the hat item's base). */
const HAT_LIFT = 0.07 * (HEAD_K - 1);
/** Root-space height of the hat origin on the head (before any neck raise). */
const hatSeat = (style: HatStyle) => 0.47 + HEAD_K * HAT_SEAT_UNIT[style] - HAT_LIFT;

// ---------------------------------------------------------------------------------------------
// the painted face (light model): eyes with a sparkle, brows, smile, blush and freckles drawn into
// an equirectangular skin texture for the skull sphere

const FACE_W = 512,
  FACE_H = 256;
/** Texture coordinates (canvas pixels) of a point (x, y) on the face, head space. */
function faceProj(x: number, y: number): [number, number] {
  const z = faceZ(x, y);
  const d = new THREE.Vector3(x, (y - SKULL_Y) / SKULL_SZ, z / SKULL_SZ).normalize();
  const th = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
  let u = Math.atan2(d.z, -d.x) / (Math.PI * 2);
  if (u < 0) u += 1;
  return [u * FACE_W, (th / Math.PI) * FACE_H];
}
const css = (c: number) => '#' + new THREE.Color(c).getHexString();

const faceCache = new Map<string, THREE.Texture>();
function faceTexture(look: CrewLook): THREE.Texture {
  const key = `${look.skin}_${look.hair ?? look.beard}_${look.brow ?? 0}_${look.freckles ? 1 : 0}_${look.beard !== undefined ? 1 : 0}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = FACE_W;
  cv.height = FACE_H;
  const g = cv.getContext('2d')!;
  g.fillStyle = css(look.skin);
  g.fillRect(0, 0, FACE_W, FACE_H);
  /** Fill a closed outline given as head-space points. */
  const poly = (pts: [number, number][], fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [u, v] = faceProj(x, y);
      if (i === 0) g.moveTo(u, v);
      else g.lineTo(u, v);
    });
    g.closePath();
    g.fill();
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, rot: number, fill: string) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const ex = Math.cos(a) * rx,
        ey = Math.sin(a) * ry;
      pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
    }
    poly(pts, fill);
  };
  const hair = css(look.hair ?? look.beard ?? 0x5a3c26);
  for (const s of [-1, 1]) {
    // blush (soft: a few layered ellipses)
    for (let i = 0; i < 4; i++) ellipse(s * 0.118, 0.115, 0.038 - i * 0.006, 0.026 - i * 0.004, 0, 'rgba(240,120,110,0.28)');
    // eyes, with a sparkle
    ellipse(s * 0.075, 0.195, 0.025, 0.033, 0, '#15161a');
    ellipse(s * 0.075 - 0.008, 0.207, 0.0075, 0.0085, 0, '#ffffff');
    // brows: a fat rounded stroke, tilted by the look
    const bl = (look.beard !== undefined ? 0.06 : 0.044) / 2 + 0.01;
    const tilt = s * (look.brow ?? 0);
    ellipse(s * 0.078, 0.258, bl, 0.0125, tilt, hair);
  }
  // smile: a band along the lower half of a circle
  const sm: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    sm.push([Math.cos(a) * 0.038, 0.093 + Math.sin(a) * 0.026 + 0.012]);
  }
  for (let i = 12; i >= 0; i--) {
    const a = Math.PI + (i / 12) * Math.PI;
    sm.push([Math.cos(a) * 0.024, 0.093 + Math.sin(a) * 0.012 + 0.012]);
  }
  poly(sm, '#3a1f1a');
  if (look.freckles) {
    for (const s of [-1, 1])
      for (const [fx, fy] of [
        [0.062, 0.16],
        [0.09, 0.148],
        [0.075, 0.136],
        [0.1, 0.165],
      ])
        ellipse(s * fx, fy, 0.0065, 0.0065, 0, 'rgba(150,80,45,0.75)');
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = COARSE ? 2 : 8;
  faceCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------------------------
// hats. Origin = the hat item's physics centre (a 0.14 m tall cylinder), so a hat lying on the
// deck rests on its rim: every hat's lowest edge is near y = -0.07.

/** A lumpy knitted pom-pom. */
function pomGeometry(q: Q, r: number): THREE.BufferGeometry {
  const a = q.hi ? segs(q, 12, 7) : 8,
    b = q.hi ? segs(q, 9, 5) : 6;
  return geo(`pom${r}_${a}_${b}`, () => {
    const g = new THREE.SphereGeometry(r, a, b);
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const k = 1 + 0.13 * Math.sin(n.x * 11 + 1) * Math.sin(n.y * 9 + 2) * Math.sin(n.z * 13 + 3);
      v.multiplyScalar(k);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  });
}

function buildHat(g0: THREE.Group, q: Q, style: HatStyle, mat: THREE.MeshStandardMaterial, color: number): void {
  const g = inner(g0, [HEAD_K, HEAD_K, HEAD_K], [0, HAT_LIFT, 0]);
  if (style === 'beanie' || style === 'bobble') {
    // a turned-up ribbed cuff (a strong edge from above) and a soft dome of fat stitches
    put(g, geo(`cuff_${q.hi}_${q.k}`, () => ribbedCuff(q, 0.226, 0.075, 22)), mat, [0, -0.0325, 0]);
    const dw = q.hi ? segs(q, 22) : segs(q, 14),
      dh = q.hi ? segs(q, 8) : segs(q, 5);
    put(g, uvs(geo(`beanieDome${dw}_${dh}`, () => new THREE.SphereGeometry(0.214, dw, dh, 0, Math.PI * 2, 0, Math.PI / 2)), 4, 0.8), mat, [0, 0.0, 0], [1, 1.02, 1]);
    if (style === 'bobble') put(g, uvs(pomGeometry(q, 0.085), 1.5, 1), knitMat(0xf3ead8), [0, 0.235, 0]);
  } else if (style === 'cap') {
    // captain's cap: black band, puffy flat crown, glossy visor, gold cord and badge
    const black = plastic(0x17191e, { rough: 0.22 });
    const gold = metal(0xd9b25a, { rough: 0.28, metalness: 0.9 });
    const cs = q.hi ? 22 : 14;
    put(g, cylG(q, 0.21, 0.212, 0.085, cs, !q.hi), black, [0, -0.0275, 0]);
    put(g, cylG(q, 0.255, 0.212, 0.075, cs, !q.hi), mat, [0, 0.05, 0]);
    put(g, geo(`capTop${segs(q, cs)}`, () => new THREE.SphereGeometry(0.255, segs(q, cs), q.hi ? 5 : 3, 0, Math.PI * 2, 0, Math.PI / 2)), mat, [0, 0.085, 0], [1, 0.22, 1]);
    put(g, geo(`visor${segs(q, q.hi ? 16 : 8)}`, () => new THREE.CylinderGeometry(0.2, 0.2, 0.018, segs(q, q.hi ? 16 : 8), 1, false, -Math.PI / 2, Math.PI)), black, [0, -0.06, 0.07], [1, 1, 0.78], [0.28, 0, 0]);
    if (q.hi) {
      put(g, geo('capCord', () => new THREE.TorusGeometry(0.214, 0.011, 5, 14, Math.PI)), gold, [0, 0.0, 0], undefined, [-Math.PI / 2, 0, 0], false);
      put(g, cylG(q, 0.036, 0.036, 0.012, 10), gold, [0, 0.045, 0.228], undefined, [Math.PI / 2 - 0.25, 0, 0], false);
      put(g, rb1(0.11, 0.022, 0.012, 0.005), gold, [0, 0.045, 0.226], undefined, [-0.25, 0, 0], false);
    } else put(g, geo('capBadgeLo', () => new THREE.CircleGeometry(0.034, 8)), gold, [0, 0.045, 0.232], undefined, [-0.25, 0, 0], false);
  } else if (style === 'bucket') {
    // bucket hat: tapered crown, darker band, sloping brim
    const bs = q.hi ? 22 : 14,
      br = q.hi ? 26 : 16;
    put(g, cylG(q, 0.182, 0.214, 0.17, bs, true), mat, [0, 0.045, 0]);
    put(g, geo(`bucketTop${segs(q, bs)}`, () => new THREE.SphereGeometry(0.182, segs(q, bs), q.hi ? 4 : 2, 0, Math.PI * 2, 0, Math.PI / 2)), mat, [0, 0.13, 0], [1, 0.22, 1]);
    put(g, cylG(q, 0.212, 0.335, 0.05, br, true), mat, [0, -0.045, 0]);
    put(g, geo(`bucketRim${segs(q, br)}`, () => new THREE.TorusGeometry(0.334, 0.012, q.hi ? 4 : 3, segs(q, br))), mat, [0, -0.07, 0], undefined, [Math.PI / 2, 0, 0]);
    put(g, cylG(q, 0.205, 0.213, 0.04, bs, true), plastic(shade(color, 0.55), { rough: 0.6, side: THREE.DoubleSide }), [0, -0.015, 0], [1.03, 1, 1.03]);
  } else {
    // sou'wester: rounded crown, floppy brim longer at the back
    const ss = q.hi ? 22 : 14;
    put(g, geo(`swDome${segs(q, ss)}_${q.hi}`, () => new THREE.SphereGeometry(0.218, segs(q, ss), q.hi ? segs(q, 8) : 5, 0, Math.PI * 2, 0, Math.PI / 2)), mat, [0, -0.03, 0], [1, 1.05, 1]);
    put(g, cylG(q, 0.21, 0.34, 0.06, q.hi ? 26 : 16, true), mat, [0, -0.04, -0.04], [1, 1, 1.12], [-0.14, 0, 0]);
  }
}

export function makeHat(style: HatStyle, color: number): THREE.Group {
  const hat = new THREE.Group();
  let mat: THREE.MeshStandardMaterial;
  if (style === 'beanie' || style === 'bobble') mat = knitMat(color, true);
  else if (style === 'cap') mat = plastic(color, { rough: 0.5 }).clone();
  else if (style === 'bucket') {
    mat = plastic(color, { rough: 0.72 }).clone();
    mat.side = THREE.DoubleSide;
  } else {
    mat = slickerMat(color, false);
    mat.side = THREE.DoubleSide;
  }
  hat.userData.mat = mat;
  lodPart(hat, (g, q) => buildHat(g, q, style, mat, color), null);
  return hat;
}

// ---------------------------------------------------------------------------------------------

/** The A-line slicker body (chest space): narrow rounded shoulders flaring to a wide hem. */
const SLICKER_ROWS: [number, number, number][] = [
  [-0.318, 0.292, 0.186],
  [-0.312, 0.322, 0.214],
  [-0.296, 0.332, 0.222],
  [-0.2, 0.318, 0.218],
  [-0.1, 0.305, 0.212],
  [0.0, 0.293, 0.205],
  [0.1, 0.282, 0.198],
  [0.18, 0.272, 0.191],
  [0.225, 0.262, 0.183],
  [0.255, 0.236, 0.165],
  [0.274, 0.19, 0.134],
  [0.283, 0.12, 0.085],
];
/** Half-depth of the slicker front at chest-space height y (for things worn on the front). */
function slickerFront(y: number): number {
  const r = SLICKER_ROWS;
  for (let i = 0; i < r.length - 1; i++) if (y >= r[i][0] && y <= r[i + 1][0]) return r[i][2] + ((r[i + 1][2] - r[i][2]) * (y - r[i][0])) / (r[i + 1][0] - r[i][0]);
  return y < r[0][0] ? r[0][2] : r[r.length - 1][2];
}
/** Rows from `y0` up to the top of the slicker, for the yoke shell. */
function rowsFrom(y0: number): [number, number, number][] {
  const r = SLICKER_ROWS;
  const out: [number, number, number][] = [];
  for (let i = 0; i < r.length - 1; i++)
    if (y0 >= r[i][0] && y0 < r[i + 1][0]) {
      const t = (y0 - r[i][0]) / (r[i + 1][0] - r[i][0]);
      out.push([y0, r[i][1] + (r[i + 1][1] - r[i][1]) * t, r[i][2] + (r[i + 1][2] - r[i][2]) * t]);
    }
  for (const row of r) if (row[0] > y0) out.push(row);
  return out;
}
/**
 * The two-tone yoke: a shell over the top of the slicker whose lower edge dips from just under the
 * collar at the front to well down the back (so from above the shoulders and back read in the
 * bib colour, while the front stays slicker yellow).
 */
function yokeGeometry(around: number, grow: number, K: number): THREE.BufferGeometry {
  const top = SLICKER_ROWS[SLICKER_ROWS.length - 1][0];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const e = 2 / 2.6;
  const sgn = (v: number) => (v < 0 ? -1 : 1);
  for (let k = 0; k <= K; k++)
    for (let i = 0; i <= around; i++) {
      const t = (i / around) * Math.PI * 2;
      const c = Math.cos(t),
        sn = Math.sin(t);
      // edge height: 0.205 at the front (sin = 1), 0.06 at the back
      const edge = 0.1325 + 0.0725 * sn;
      const y = edge + (top - edge) * (1 - (1 - k / K) ** 1.4);
      const r = rowsFrom(Math.min(y, top - 1e-4))[0];
      pos.push(sgn(c) * Math.abs(c) ** e * (r[1] + grow), y, sgn(sn) * Math.abs(sn) ** e * (r[2] + grow));
      uv.push((i / around) * 6, y * 4);
    }
  const R = around + 1;
  for (let k = 0; k < K; k++)
    for (let i = 0; i < around; i++) {
      const a = k * R + i,
        b = a + 1,
        c2 = a + R,
        d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
  // close the crown
  const ci = pos.length / 3;
  pos.push(0, top + 0.012, 0);
  uv.push(0.5, top * 4);
  for (let i = 0; i < around; i++) idx.push(K * R + i, ci, K * R + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3(),
    w = new THREE.Vector3();
  for (let k = 0; k <= K; k++) {
    v.fromBufferAttribute(nor, k * R).add(w.fromBufferAttribute(nor, k * R + around)).normalize();
    nor.setXYZ(k * R, v.x, v.y, v.z);
    nor.setXYZ(k * R + around, v.x, v.y, v.z);
  }
  return g;
}

/** A thin band round the slicker at height y (reflective tape), `h` tall, standing `lift` proud. */
function bandRows(y: number, h: number, lift: number): [number, number, number][] {
  const at = (yy: number, l: number): [number, number, number] => {
    const r = rowsFrom(yy)[0];
    return [yy, r[1] + l, r[2] + l];
  };
  return [at(y - h / 2 - 0.002, 0), at(y - h / 2, lift), at(y + h / 2, lift), at(y + h / 2 + 0.002, 0)];
}

export function makeCrew(look: CrewLook): CrewView {
  const root = new THREE.Group();
  // the figure draws after the boat and the player's see-through ring (a later render group)
  root.renderOrder = 2;
  root.userData.keepShadow = true; // every part casts, even on small shadow maps (Stage)
  root.name = look.name;
  const body = new THREE.Group();
  root.add(body);
  const build = look.build ?? 'regular';
  const stocky = build === 'stocky';
  const lanky = build === 'lanky';
  const torsoS: V3 = stocky ? [1.08, 1, 1.12] : lanky ? [0.86, 1.03, 0.88] : [1, 1, 1];
  const legS: V3 = stocky ? [1.06, 1, 1.06] : lanky ? [0.84, 1, 0.9] : [1, 1, 1];
  const neck = lanky ? 0.08 : 0;

  const slicker = slickerMat(look.slicker);
  const bibsColor = look.bibs ?? shade(look.slicker, 0.75);
  const bibs = new THREE.MeshStandardMaterial({ color: bibsColor, roughness: 0.42, metalness: 0, vertexColors: true });
  // the yoke, rolled hood and collar lining: glossy oilskin in the bib colour (who's who from above)
  const yoke = slickerMat(bibsColor);
  const bootMat = toy(look.boots ?? 0x2b2f36, 0.3);
  const skin = toy(look.skin, 0.48);
  const skinFace = new THREE.MeshStandardMaterial({ color: 0xffffff, map: faceTexture(look), roughness: 0.48, metalness: 0, vertexColors: true });
  const dark = plastic(0x15161a, { rough: 0.12 });
  const blush = plastic(0xf08c80, { rough: 0.55 });
  const hairColor = look.hair ?? look.beard ?? 0x5a3c26;
  const hair = toy(hairColor, 0.6);
  const trim = toy(0x6e4a2c, 0.45);
  const tape = toy(0xdfe4e6, 0.26, 0.55);
  const mit = knitMat(look.mitts ?? 0x3c6e8f);
  const coloured: Record<PartName, THREE.Mesh[]> = { legs: [], pelvis: [], chest: [], head: [], armL: [], armR: [] };
  const seat = hatSeat(look.hatStyle) + neck;

  // --- legs (one part, two legs), pivot at the hips; the deck is at y = -0.57 here
  const legs = new THREE.Group();
  const legsRest = new THREE.Vector3(0, -0.28, 0);
  lodPart(
    legs,
    (lvl, q) => {
      const g = inner(lvl, legS);
      for (const s of [-1, 1]) {
        const x = s * 0.118;
        put(g, rbq(q, 0.22, 0.36, 0.26, 0.08), bibs, [x, -0.12, 0], undefined, undefined, true, { ao: 'bib' });
        // a turned-up trouser cuff (the light model flares it out of the leg, open-ended)
        if (q.hi) put(g, cylG(q, 0.126, 0.126, 0.06, 14), bibs, [x, -0.29, 0], [1, 1, 1.12], undefined, true, { ao: 'bib' });
        else put(g, cylG(q, 0.112, 0.128, 0.07, 8, true), bibs, [x, -0.295, 0], [1, 1, 1.12], [0, Math.PI / 8, 0], true, { ao: 'bib' });
        put(g, cylG(q, 0.1, 0.105, 0.2, q.hi ? 12 : 8, !q.hi), bootMat, [x, -0.4, -0.01], [1, 1, 1.15], undefined, true, { ao: 'boot' });
        put(g, rbq(q, 0.214, 0.12, 0.33, 0.05), bootMat, [x, -0.51, 0.04], undefined, undefined, true, { ao: 'boot' });
        // a pale sole edge and toe cap catch the light (full detail only)
        if (q.hi) put(g, lowBox(0.222, 0.03, 0.338), toy(0xcfc6b4, 0.5), [x, -0.555, 0.04], undefined, undefined, false, { ao: 'none' });
      }
    },
    { part: 'legs', rest: legsRest, seat, side: 0 },
  );
  body.add(legs);
  legs.position.copy(legsRest);

  // --- pelvis (seat of the overalls), tucked up under the slicker hem
  const pelvis = new THREE.Group();
  const pelvisRest = new THREE.Vector3(0, -0.14, 0);
  lodPart(
    pelvis,
    (lvl, q) => {
      put(inner(lvl, torsoS), rbq(q, 0.5, 0.26, 0.34, 0.1), bibs, [0, -0.06, 0], undefined, undefined, true, { ao: 'bib' });
    },
    { part: 'pelvis', rest: pelvisRest, seat, side: 0 },
  );
  body.add(pelvis);
  pelvis.position.copy(pelvisRest);

  // --- chest: an A-line slicker worn open over the bib, a yoke across the shoulders, toggles,
  // reflective tape round the hem, a puffy collar with a contrast lining and the hood rolled behind
  const chest = new THREE.Group();
  const chestRest = new THREE.Vector3(0, 0.2, 0);
  lodPart(
    chest,
    (lvl, q) => {
      const g = inner(lvl, torsoS);
      const around = q.hi ? 24 : segs(q, 14, 12);
      // the light model keeps every other ring (the hem and shoulder rings stay)
      const rows = q.hi ? SLICKER_ROWS : SLICKER_ROWS.filter((_, i) => [0, 2, 4, 6, 8, 9, 10, 11].includes(i));
      put(g, geo(`slickerBody${around}_${q.hi}`, () => sweptBody(rows, around)), slicker, [0, 0, 0], undefined, undefined, true, { ao: 'slicker' });
      put(g, geo(`slickerYoke2${around}_${q.hi}`, () => yokeGeometry(around, 0.005, q.hi ? 6 : 3)), yoke, [0, 0, 0], undefined, undefined, true, { ao: 'yoke' });
      const band = bandRows(-0.245, 0.022, 0.004);
      put(g, geo(`slickerTape${around}_${q.hi}`, () => sweptBody(q.hi ? band : band.slice(1, 3), around, 2.6, [false, false])), tape, [0, 0, 0], undefined, undefined, false, { ao: 'tape' });
      // the bib of the overalls between the open fronts, following the slicker's front
      const fz = (y: number) => slickerFront(y);
      // lean the front pieces back with the slicker's slope (the hem flares forward)
      const tilt = Math.atan2(fz(0.12) - fz(-0.12), 0.24);
      const plk = (y: number) => fz(-0.045) + 0.004 + (-0.045 - y) * Math.sin(-tilt);
      put(g, q.hi ? rb1(0.22, 0.31, 0.04, 0.015) : geo('box1', () => new THREE.BoxGeometry(1, 1, 1)), bibs, [0, 0.0, fz(0) - 0.004], q.hi ? undefined : [0.22, 0.31, 0.04], [tilt, 0, 0], true, { ao: 'bib' });
      // the open fronts: two plackets with a lighter worn edge, tape across their feet
      for (const s of [-1, 1]) {
        put(g, q.hi ? rb1(0.085, 0.47, 0.05, 0.022) : geo('box1', () => new THREE.BoxGeometry(1, 1, 1)), slicker, [s * 0.148, -0.045, fz(-0.045) + 0.004], q.hi ? undefined : [0.085, 0.47, 0.05], [tilt, 0, 0], true, { ao: 'slicker', tint: 1.1 });
        put(g, geo('box1', () => new THREE.BoxGeometry(1, 1, 1)), tape, [s * 0.148, -0.245, plk(-0.245)], [0.091, 0.022, 0.056], [tilt, 0, 0], false, { ao: 'tape' });
      }
      if (q.hi) {
        // a pocket and two strap buckles on the bib, wooden toggles down the right front
        put(g, rb1(0.15, 0.075, 0.02, 0.008), bibs, [0, -0.05, fz(-0.05) + 0.02], undefined, [tilt, 0, 0], true, { ao: 'bib', tint: 0.92 });
        for (const s of [-1, 1]) put(g, geo('buckle', () => new THREE.BoxGeometry(0.036, 0.032, 0.014)), trim, [s * 0.072, 0.115, fz(0.115) + 0.02], undefined, [tilt, 0, 0], false, { ao: 'trim', tint: 1.15 });
        for (const y of [0.1, -0.02, -0.14]) {
          put(g, geo('toggle', () => new THREE.CapsuleGeometry(0.014, 0.05, 1, 6)), trim, [-0.148, y, plk(y) + 0.03], undefined, [0, 0, Math.PI / 2], false, { ao: 'trim', tint: 1.2 });
          put(g, geo('toggleLoop', () => new THREE.TorusGeometry(0.016, 0.004, 3, 8)), trim, [-0.108, y, plk(y) + 0.012], [1.4, 0.8, 1], undefined, false, { ao: 'trim', tint: 0.8 });
        }
      }
      // collar: slicker outside, lined in the bib colour (the inner ring reads from above)
      const cA = q.hi ? 20 : segs(q, 10, 8),
        cT = q.hi ? 3 : 1;
      put(g, geo(`collarOut${cA}`, () => torusPart(0.168, 0.064, cA, cT + 1, -Math.PI / 2, Math.PI + 0.35)), slicker, [0, 0.255, 0], [1.04, 1, 1], undefined, true, { ao: 'slicker' });
      put(g, geo(`collarIn${cA}`, () => torusPart(0.168, 0.064, cA, cT, Math.PI / 2 + 0.35, Math.PI - 0.35)), yoke, [0, 0.255, 0], [1.04, 1, 1], undefined, true, { ao: 'yoke' });
      put(g, geo(`hood${q.hi}`, () => new THREE.CapsuleGeometry(0.075, 0.2, q.hi ? 3 : 1, q.hi ? 10 : 6)), yoke, [0, 0.27, -0.2], [1, 1, 0.8], [0.25, 0, Math.PI / 2], true, { ao: 'yoke' });
    },
    { part: 'chest', rest: chestRest, seat, side: 0 },
  );
  body.add(chest);
  chest.position.copy(chestRest);

  // --- head, pivot at the neck
  const head = new THREE.Group();
  const headRest = new THREE.Vector3(0, 0.47, 0);
  lodPart(
    head,
    (lvl, q) => {
      if (neck > 0) put(lvl, cylG(q, 0.072, 0.082, 0.2, 10), skin, [0, 0.03, 0], undefined, undefined, true, { ao: 'skin' });
      const g = inner(lvl, [HEAD_K, HEAD_K, HEAD_K], [0, neck, 0]);
      // the light model paints the face into the skin texture; its ears and nose take a plain texel
      const sk = q.hi ? skin : skinFace;
      const plain: PieceOpts = { ao: 'skin', uv: [0.75, 0.5] };
      put(g, q.hi ? sph(q, SKULL_R, 18, 12) : sph(q, SKULL_R, 14, COARSE ? 9 : 10), sk, [0, SKULL_Y, 0], [1, SKULL_SZ, SKULL_SZ], undefined, true, { ao: 'skin' });
      put(g, sph(q, 0.046, q.hi ? 8 : 6, q.hi ? 6 : 4), sk, [0, 0.142, 0.198], [1.05, 0.9, 0.85], undefined, true, plain);
      for (const s of [-1, 1]) {
        put(g, q.hi ? sph(q, 0.056, 7, 5) : sph(q, 0.056, 5, 3), sk, [s * 0.208, 0.16, -0.002], [0.5, 1, 0.8], undefined, true, plain);
        if (q.hi) {
          // eyes, brows, cheeks
          put(g, sph(q, 0.029, 7, 5), dark, [s * 0.075, 0.195, faceZ(0.075, 0.195) - 0.003], [0.85, 1.12, 0.55], undefined, false);
          const browL = look.beard !== undefined ? 0.06 : 0.044;
          put(g, geo(`brow${browL}`, () => new THREE.CapsuleGeometry(0.012, browL, 2, 6)), hair, [s * 0.078, 0.258, faceZ(0.078, 0.258) - 0.002], [1, 1, 0.8], [-0.25, 0, Math.PI / 2 + s * (look.brow ?? 0)], false, { ao: 'none' });
          put(g, sph(q, 0.034, 8, 5), blush, [s * 0.118, 0.115, faceZ(0.118, 0.115) - 0.004], [1, 0.75, 0.4], [0, s * 0.55, 0], false);
        }
      }
      if (q.hi) put(g, geo('smile', () => new THREE.TorusGeometry(0.03, 0.0085, 5, 8, Math.PI)), dark, [0, 0.093, faceZ(0, 0.093) - 0.004], undefined, [0.35, 0, Math.PI], false);
      // hair: a crown with a hairline above the brows, and the back down to the nape (behind the ears)
      const hs = q.hi ? 18 : 12;
      put(g, geo(`hairTop${hs}`, () => new THREE.SphereGeometry(SKULL_R + 0.007, hs, q.hi ? 4 : 2, 0, Math.PI * 2, 0, 0.3 * Math.PI)), hair, [0, SKULL_Y, 0], [1, SKULL_SZ, SKULL_SZ], undefined, true, { ao: 'hair' });
      put(g, geo(`hairBack${hs}`, () => new THREE.SphereGeometry(SKULL_R + 0.009, q.hi ? 14 : 8, q.hi ? 6 : 3, Math.PI + 0.25, Math.PI - 0.5, 0.25 * Math.PI, 0.45 * Math.PI)), hair, [0, SKULL_Y, 0], [1, SKULL_SZ, SKULL_SZ], undefined, true, { ao: 'hair' });
      if (look.beard !== undefined) {
        // a big bushy beard and moustache
        put(g, sph(q, 0.17, q.hi ? 12 : 8, q.hi ? 9 : 6), hair, [0, 0.05, 0.075], [1.15, 0.92, 0.88], undefined, true, { ao: 'hair' });
        for (const s of [-1, 1]) {
          put(g, sph(q, 0.09, q.hi ? 8 : 6, q.hi ? 5 : 4), hair, [s * 0.125, 0.075, 0.07], undefined, undefined, true, { ao: 'hair' });
          if (q.hi) put(g, sph(q, 0.085, 8, 5), hair, [s * 0.065, 0.005, 0.13], undefined, undefined, true, { ao: 'hair' });
          put(g, geo(`stache${q.hi}`, () => new THREE.CapsuleGeometry(0.032, 0.05, q.hi ? 3 : 1, q.hi ? 8 : 5)), hair, [s * 0.05, 0.112, 0.2], undefined, [0, s * 0.3, s * 1.2], true, { ao: 'hair', tint: 1.06 });
        }
        put(g, sph(q, 0.09, q.hi ? 8 : 6, q.hi ? 5 : 4), hair, [0, -0.025, 0.13], undefined, undefined, true, { ao: 'hair' });
      }
      if (look.braid) {
        const ys = q.hi ? [0.07, -0.01, -0.09, -0.17, -0.245] : [0.06, -0.07, -0.19];
        const zs = q.hi ? [-0.205, -0.25, -0.258, -0.252, -0.245] : [-0.215, -0.256, -0.25];
        const rs = q.hi ? [0.055, 0.05, 0.046, 0.042, 0.036] : [0.058, 0.052, 0.044];
        const sy = q.hi ? 1.3 : 1.65;
        ys.forEach((y, i) => put(g, sph(q, rs[i], q.hi ? 8 : 6, q.hi ? 6 : 4), hair, [0.01 * i, y, zs[i]], [1, sy, 0.85], [0, 0, i % 2 ? 0.45 : -0.45], true, { ao: 'hair' }));
        put(g, geo(`tie${q.hi}`, () => new THREE.TorusGeometry(0.026, 0.012, q.hi ? 5 : 3, q.hi ? 10 : 6)), plastic(0x2c8c8c, { rough: 0.5 }), [0.05, -0.29, -0.243], undefined, [Math.PI / 2, 0, 0]);
        put(g, geo(`tuft${q.hi}`, () => new THREE.ConeGeometry(0.03, 0.08, q.hi ? 7 : 5)), hair, [0.05, -0.335, -0.243], undefined, [Math.PI, 0, 0], true, { ao: 'hair' });
      }
      if (look.freckles && q.hi) {
        for (const s of [-1, 1])
          for (const [fx, fy] of [
            [0.062, 0.16],
            [0.09, 0.148],
            [0.075, 0.136],
          ])
            put(g, sph(q, 0.0075, 5, 4), hair, [s * fx, fy, faceZ(fx, fy)], undefined, undefined, false, { ao: 'none' });
      }
      if (lanky) {
        // ginger tufts poking out under the hat
        for (const s of [-1, 1]) put(g, geo(`tuftS${q.hi}`, () => new THREE.ConeGeometry(0.03, 0.09, q.hi ? 6 : 4)), hair, [s * 0.2, 0.235, -0.04], undefined, [0.3, 0, s * -2.0], true, { ao: 'hair' });
      }
    },
    { part: 'head', rest: headRest, seat, side: 0 },
  );
  body.add(head);
  head.position.copy(headRest);

  // --- arms, pivot at the shoulders; they hang down -Y, drawn 2 cm in so they hug the body
  const makeArm = (s: number, rest: THREE.Vector3, name: PartName) => {
    const arm = new THREE.Group();
    lodPart(
      arm,
      (lvl, q) => {
        const g = inner(lvl, lanky ? [0.9, 1, 0.9] : [1, 1, 1], [-s * 0.02, 0, 0]);
        put(g, sph(q, 0.108, q.hi ? 10 : 7, q.hi ? 8 : 4), slicker, [0, -0.01, 0], undefined, undefined, true, { ao: 'slicker' });
        put(g, cylG(q, 0.099, 0.09, 0.27, q.hi ? 12 : 8, true), slicker, [0, -0.15, 0], undefined, undefined, true, { ao: 'slicker' });
        put(g, cylG(q, 0.101, 0.101, 0.05, q.hi ? 12 : 8, !q.hi), slicker, [0, -0.285, 0], undefined, undefined, true, { ao: 'slicker', tint: 1.06 });
        // a band of reflective tape round the forearm
        put(g, cylG(q, 0.0965, 0.0955, 0.024, q.hi ? 12 : 8, true), tape, [0, -0.215, 0], undefined, undefined, false, { ao: 'tape' });
        // chunky knitted mitten with a ribbed cuff and a thumb
        put(g, uvs(cylG(q, 0.07, 0.074, 0.05, q.hi ? 10 : 8, !q.hi), 1.5, 0.3), mit, [0, -0.312, 0]);
        put(g, uvs(q.hi ? sph(q, 0.09, 10, 8) : sph(q, 0.09, 6, 5), 1.5, 0.75), mit, [0, -0.39, 0.005], [0.92, 1.12, 0.84]);
        put(g, uvs(q.hi ? sph(q, 0.04, 8, 6) : sph(q, 0.04, 5, 3), 1, 0.5), mit, [-s * 0.062, -0.36, 0.048], [1, 1.25, 1], [0.3, 0, s * 0.4]);
      },
      { part: name, rest, seat, side: s },
    );
    return arm;
  };
  const armLRest = new THREE.Vector3(0.36, 0.4, 0);
  const armRRest = new THREE.Vector3(-0.36, 0.4, 0);
  const armL = makeArm(1, armLRest, 'armL');
  const armR = makeArm(-1, armRRest, 'armR');
  armL.position.copy(armLRest);
  armR.position.copy(armRRest);
  body.add(armL, armR);

  const mittens: THREE.Mesh[] = [];
  const collect = (name: PartName, part: THREE.Object3D) =>
    part.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.material === slicker || m.material === bibs || m.material === yoke) coloured[name].push(m);
      if (m.material === mit) mittens.push(m);
    });
  collect('legs', legs);
  collect('pelvis', pelvis);
  collect('chest', chest);
  collect('head', head);
  collect('armL', armL);
  collect('armR', armR);

  // --- hat (separate: flies off on knockdowns)
  const hat = makeHat(look.hatStyle, look.hatColor);
  const hatRest = new THREE.Vector3(0, seat, 0);
  hat.position.copy(hatRest);
  body.add(hat);

  // --- ring under the feet, with a soft contact shadow. The player's is a bold slicker-yellow
  // ring on a dark under-ring (reads on pale wood and dark water alike) that pulses gently, plus a
  // faint copy that ignores depth so the half hidden by the bulwark still shows. Bots get a faint
  // white one. Rings and blobs live on MARKER_LAYER: the game camera draws them, the photo camera
  // (layer 0 only) leaves them out.
  const ringMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const ring = new THREE.Mesh(look.isPlayer ? new THREE.RingGeometry(0.3, 0.58, 40) : new THREE.RingGeometry(0.34, 0.5, 32), ringMat(look.isPlayer ? P.slicker : 0xffffff, look.isPlayer ? 0.95 : 0.22));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.32, depthWrite: false }),
  );
  ring.add(blob);
  if (look.isPlayer) {
    const under = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.62, 40), ringMat(0x1a1208, 0.5));
    under.position.z = -0.002;
    under.renderOrder = 1;
    // The see-through copy is drawn with the opaque pass (blended by hand, always passing the
    // depth test), after the boat but before the crew (whose root draws in a later group, below),
    // so it shows through the rail and the gear but never over the player's own legs.
    const xrayMat = new THREE.MeshBasicMaterial({ color: P.slicker, opacity: 0.45, transparent: false, depthWrite: false, depthFunc: THREE.AlwaysDepth });
    xrayMat.blending = THREE.CustomBlending;
    xrayMat.blendSrc = THREE.SrcAlphaFactor;
    xrayMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    xrayMat.userData.ringFeather = true; // keep it out of the transparent pass (render/overlay.ts)
    const xray = new THREE.Mesh(ring.geometry, xrayMat);
    xray.renderOrder = 3;
    ring.add(under, xray);
    // 1.0 → 1.08 at 1.2 Hz (the owner positions the ring every frame; the pulse only scales it)
    ring.onBeforeRender = () => {
      const s = 1.04 - 0.04 * Math.cos(performance.now() * 0.001 * Math.PI * 2 * 1.2);
      if (Math.abs(ring.scale.x - s) < 1e-4) return;
      ring.scale.setScalar(s);
      ring.updateMatrixWorld();
    };
  }
  ring.traverse((o) => o.layers.set(MARKER_LAYER));

  // phones: a chevron over the player's head, 2.1 m above the deck at a constant 20 px, drawn
  // over everything (overlay layer: crisp, never in photos)
  if (look.isPlayer && COARSE) {
    const chev = new THREE.Sprite(new THREE.SpriteMaterial({ map: chevronTexture(), depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    chev.position.y = 2.1 - 0.85; // the root is the capsule centre, ~0.85 m over the deck
    chev.renderOrder = 24;
    chev.layers.set(OVERLAY_LAYER);
    const _sz = new THREE.Vector2();
    chev.onBeforeRender = (r, _s, cam) => {
      const p11 = (cam as THREE.PerspectiveCamera).projectionMatrix.elements[5];
      const h = (2 * 20 * r.getPixelRatio()) / (p11 * Math.max(1, r.getDrawingBufferSize(_sz).y));
      if (Math.abs(chev.scale.y - h) < 1e-5) return;
      chev.scale.set(h, h, 1);
      chev.updateMatrixWorld();
    };
    root.add(chev);
  }

  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), plastic(P.buoy));
  bubble.visible = false;
  bubble.position.y = 1.3;
  root.add(bubble);

  const parts: Record<PartName, CrewPart> = {
    legs: { obj: legs, rest: legsRest, center: new THREE.Vector3(0, -0.28, 0), shape: { type: 'capsule', size: [0.2, 0.2] }, mass: 26, coloured: coloured.legs },
    pelvis: { obj: pelvis, rest: pelvisRest, center: new THREE.Vector3(0, 0, 0), shape: { type: 'box', size: [0.22, 0.1, 0.15] }, mass: 14, coloured: coloured.pelvis },
    chest: { obj: chest, rest: chestRest, center: new THREE.Vector3(0, 0, 0), shape: { type: 'box', size: [0.27, 0.24, 0.18] }, mass: 22, coloured: coloured.chest },
    head: { obj: head, rest: headRest, center: new THREE.Vector3(0, 0.16, 0), shape: { type: 'ball', size: [0.18] }, mass: 6, coloured: coloured.head },
    armL: { obj: armL, rest: armLRest, center: new THREE.Vector3(0, -0.22, 0), shape: { type: 'capsule', size: [0.18, 0.08] }, mass: 6, coloured: coloured.armL },
    armR: { obj: armR, rest: armRRest, center: new THREE.Vector3(0, -0.22, 0), shape: { type: 'capsule', size: [0.18, 0.08] }, mass: 6, coloured: coloured.armR },
  };

  // the toon look's outlines are gone; highlight is a warm glow on the slicker instead
  const outlines: THREE.Mesh[] = [];

  let slickerColor = look.slicker;
  const view: CrewView = {
    root,
    body,
    parts,
    hat,
    hatRest,
    mittens,
    ring,
    bubble,
    outlines,
    setSuit(on: boolean) {
      // survival suit: everything goes buoy orange
      slicker.color.setHex(on ? P.buoy : slickerColor);
      bibs.color.setHex(on ? P.buoy : bibsColor);
      yoke.color.setHex(on ? shade(P.buoy, 0.85) : bibsColor);
    },
    setHatColor(c: number) {
      (hat.userData.mat as THREE.MeshStandardMaterial).color.setHex(c);
    },
    setSlicker(c: number) {
      slickerColor = c;
      slicker.color.setHex(c);
    },
    setHighlight(on: boolean) {
      slicker.emissive.setHex(on ? 0x3a2a08 : 0x000000);
    },
  };
  return view;
}

let chevTex: THREE.Texture | null = null;
/** A down-pointing slicker-yellow chevron with a dark rim (the phone's "that's you" marker). */
function chevronTexture(): THREE.Texture {
  if (chevTex) return chevTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(8, 14);
  g.lineTo(32, 30);
  g.lineTo(56, 14);
  g.lineTo(56, 30);
  g.lineTo(32, 52);
  g.lineTo(8, 30);
  g.closePath();
  g.lineWidth = 8;
  g.strokeStyle = '#1a1208';
  g.stroke();
  g.fillStyle = '#' + new THREE.Color(P.slicker).getHexString(THREE.SRGBColorSpace);
  g.fill();
  chevTex = new THREE.CanvasTexture(cv);
  chevTex.colorSpace = THREE.SRGBColorSpace;
  return chevTex;
}

let blobTex: THREE.Texture | null = null;
/** Radial falloff for the contact shadow under a figure (alpha map, linear). */
function blobTexture(): THREE.Texture {
  if (blobTex) return blobTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.45, '#bdbdbd');
  grd.addColorStop(1, '#000000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(cv);
  return blobTex;
}

/**
 * The four crew looks for the demo. The player is the only one in slicker yellow (Mo wears
 * orange, Dot teal, Ike a pale oilskin cream), and the bib colour, which also colours the yoke,
 * hood and collar lining, identifies everyone from above even without a hat.
 */
export const CREW_LOOKS: Record<'player' | 'mo' | 'dot' | 'ike', CrewLook> = {
  player: { name: 'You', slicker: P.slicker, bibs: 0xe0662c, skin: 0xf1c7a5, hatStyle: 'beanie', hatColor: 0xc8432f, hair: 0x6b4630, mitts: 0x3c6e8f, brow: 0, isPlayer: true },
  mo: { name: 'Mo', slicker: 0xe56a2a, bibs: 0x2b3a56, skin: 0xe3b493, hatStyle: 'cap', hatColor: 0x23314a, beard: 0xe8e6e1, mitts: 0xb5372c, build: 'stocky', brow: 0.2 },
  dot: { name: 'Dot', slicker: 0x3c9c9a, bibs: 0x2a8c88, skin: 0xa8714f, hatStyle: 'bobble', hatColor: 0x2c8c8c, hair: 0x2a1d16, mitts: 0xe9e1cf, braid: true, brow: -0.1 },
  ike: { name: 'Ike', slicker: 0xdcd6c2, bibs: 0x5a7d34, skin: 0xf6d2b8, hatStyle: 'bucket', hatColor: 0x4f8a3a, hair: 0xd0782f, mitts: 0xe2762e, build: 'lanky', freckles: true, brow: -0.3 },
};
