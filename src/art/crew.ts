/**
 * makeCrew(): chunky glossy toy figurines. Each one wears an oilskin slicker (open at the front
 * over bib overalls, with wooden toggles and a puffy collar), rubber boots and knitted mittens,
 * and has a big round head with a simple face (dot eyes, brows, button nose, rosy cheeks).
 *
 * Each body part is its own Object3D so the same view can be driven by the standing animation or
 * by the 6-body ragdoll. Part origin = its joint pivot; `center` = offset from pivot to the
 * physics body centre. The pivots and physics shapes are shared by every crew member (see
 * crew/ragdoll.ts); builds (stocky, lanky) only change the meshes inside a part. Every part's
 * meshes are merged per material, so a figure costs about 17 draw calls.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { config } from '../config';
import { plastic, metal, rbox, mergeStatic } from './materials';

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
  /** bib overalls colour (defaults to a darker shade of the slicker) */
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

// ---------------------------------------------------------------------------------------------
// fabrics: knitted wool and crinkled oilskin, drawn on canvases (no image files)

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
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

/** Stocking stitch: columns of little V's. Tiles seamlessly; light so it barely darkens the colour. */
export function knitTexture(): THREE.Texture {
  return fabricTex('knit', 128, (g, n) => {
    g.fillStyle = '#a8a8a8';
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
              const x = cx + s * cw * 0.24 + dx,
                y = cy + dy;
              const grd = g.createRadialGradient(x, y - rh * 0.1, 0, x, y, cw * 0.42);
              grd.addColorStop(0, '#ffffff');
              grd.addColorStop(0.6, '#e6e6e6');
              grd.addColorStop(1, '#9a9a9a');
              g.fillStyle = grd;
              g.beginPath();
              g.ellipse(x, y, cw * 0.2, rh * 0.62, -s * 0.55, 0, Math.PI * 2);
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

const knitCache = new Map<number, THREE.MeshStandardMaterial>();
/** Knitted wool (hats, mittens). `unique` for a material whose colour changes later. */
export function knitMat(color: number, unique = false): THREE.MeshStandardMaterial {
  const make = () => {
    const t = knitTexture();
    return new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 2.2, roughness: 0.92, metalness: 0 });
  };
  if (unique) return make();
  let m = knitCache.get(color);
  if (!m) knitCache.set(color, (m = make()));
  return m;
}

/** Glossy waxed oilskin whose colour changes at runtime (one per figure). */
function slickerMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0, bumpMap: crinkleTexture(), bumpScale: 0.45 });
}

// ---------------------------------------------------------------------------------------------
// small builders

type V3 = [number, number, number];
function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: V3 = [0, 0, 0], s?: V3, r?: V3, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  if (s) m.scale.set(s[0], s[1], s[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const geoCache = new Map<string, THREE.BufferGeometry>();
/** Geometry shared between figures (merging copies it, so sharing is safe). */
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
/** Phones (which start on Low) get lighter meshes: the figures are only a few dozen pixels tall there. */
const LOD = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 0.7 : 1;
const segs = (k: number, min = 4) => Math.max(min, Math.round(k * LOD));
const sph = (r: number, w = 12, h = 8) => geo(`s${r}_${segs(w, 5)}_${segs(h)}`, () => new THREE.SphereGeometry(r, segs(w, 5), segs(h)));
const cylG = (rt: number, rbot: number, h: number, seg = 12, open = false) => geo(`c${rt}_${rbot}_${h}_${segs(seg, 6)}_${open}`, () => new THREE.CylinderGeometry(rt, rbot, h, segs(seg, 6), 1, open));
const DUMMY = new THREE.MeshBasicMaterial();
/** A (cached, shared) rounded-box geometry from the material library: 2 corner segments. */
const rb = (w: number, h: number, d: number, r: number) => rbox(w, h, d, DUMMY, r).geometry;
/** A cheaper rounded box (1 corner segment) for small or half-hidden pieces. */
const rb1 = (w: number, h: number, d: number, r: number) =>
  geo(`rb1_${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
/** A copy of a geometry with scaled UVs (sets the stitch density per piece before merging). */
function uvs(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  return geo(`${g.uuid}_uv${su}_${sv}`, () => {
    const c = g.clone();
    const uv = c.attributes.uv as THREE.BufferAttribute | undefined;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return c;
  });
}
/** Merge a part's meshes per material and drop the empty helper groups. */
function bake(part: THREE.Object3D): void {
  mergeStatic(part);
  for (const ch of part.children.slice()) if (!(ch as THREE.Mesh).isMesh && ch.children.length === 0) ch.removeFromParent();
}
/** A child group that applies a build scale to everything put in it (baked away by bake()). */
function inner(part: THREE.Object3D, s: V3 = [1, 1, 1], p: V3 = [0, 0, 0]): THREE.Group {
  const g = new THREE.Group();
  g.scale.set(s[0], s[1], s[2]);
  g.position.set(p[0], p[1], p[2]);
  part.add(g);
  return g;
}
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

// head geometry (head-part space, before the head scale and any neck raise)
const SKULL_R = 0.215;
const SKULL_Y = 0.17;
const SKULL_SZ = 0.95;
/** Heads (and hats) are drawn a little oversized so they read from the overhead camera. */
const HEAD_K = 1.08;
/** z of the face surface at (x, y) in head space, so features sit on the skull. */
function faceZ(x: number, y: number): number {
  const dy = (y - SKULL_Y) / SKULL_SZ;
  return SKULL_SZ * Math.sqrt(Math.max(0, SKULL_R * SKULL_R - x * x - dy * dy));
}

/** Where the hat's origin sits on the head (root space, before any neck raise). */
const HAT_SEAT: Record<HatStyle, number> = { beanie: 0.845, bobble: 0.845, cap: 0.86, bucket: 0.828, souwester: 0.83 };

// ---------------------------------------------------------------------------------------------
// hats. Origin = the hat item's physics centre (a 0.14 m tall cylinder), so a hat lying on the
// deck rests on its rim: every hat's lowest edge is near y = -0.07.

/** A lumpy knitted pom-pom. */
function pomGeometry(r: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 12, 9);
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
}

export function makeHat(style: HatStyle, color: number): THREE.Group {
  const hat = new THREE.Group();
  const g = inner(hat, [HEAD_K, HEAD_K, HEAD_K]);
  if (style === 'beanie' || style === 'bobble') {
    const mat = knitMat(color, true);
    hat.userData.mat = mat;
    // ribbed turn-up cuff, a fold line and a soft dome
    put(g, uvs(cylG(0.218, 0.218, 0.09, 22), 9, 0.4), mat, [0, -0.025, 0]);
    put(g, uvs(geo('beanieDome', () => new THREE.SphereGeometry(0.214, segs(22), segs(8), 0, Math.PI * 2, 0, Math.PI / 2)), 8, 1.6), mat, [0, 0.015, 0], [1, 0.98, 1]);
    put(g, geo('beanieFold', () => new THREE.TorusGeometry(0.216, 0.012, 4, segs(20))), mat, [0, 0.02, 0], undefined, [Math.PI / 2, 0, 0], false);
    if (style === 'bobble') put(g, uvs(geo('pom', () => pomGeometry(0.08)), 3, 2), knitMat(0xf3ead8), [0, 0.235, 0]);
  } else if (style === 'cap') {
    // captain's cap: black band, puffy flat crown, glossy visor, gold cord and badge
    const mat = plastic(color, { rough: 0.5 }).clone();
    hat.userData.mat = mat;
    const black = plastic(0x17191e, { rough: 0.22 });
    const gold = metal(0xd9b25a, { rough: 0.28, metalness: 0.9 });
    put(g, cylG(0.21, 0.212, 0.085, 22), black, [0, -0.0275, 0]);
    put(g, cylG(0.255, 0.212, 0.075, 22), mat, [0, 0.05, 0]);
    put(g, geo('capTop', () => new THREE.SphereGeometry(0.255, segs(22), 5, 0, Math.PI * 2, 0, Math.PI / 2)), mat, [0, 0.085, 0], [1, 0.22, 1]);
    put(g, geo('visor', () => new THREE.CylinderGeometry(0.2, 0.2, 0.018, 16, 1, false, -Math.PI / 2, Math.PI)), black, [0, -0.06, 0.07], [1, 1, 0.78], [0.28, 0, 0]);
    put(g, geo('capCord', () => new THREE.TorusGeometry(0.214, 0.011, 5, 14, Math.PI)), gold, [0, 0.0, 0], undefined, [-Math.PI / 2, 0, 0], false);
    put(g, cylG(0.036, 0.036, 0.012, 10), gold, [0, 0.045, 0.228], undefined, [Math.PI / 2 - 0.25, 0, 0], false);
    put(g, rb1(0.11, 0.022, 0.012, 0.005), gold, [0, 0.045, 0.226], undefined, [-0.25, 0, 0], false);
  } else if (style === 'bucket') {
    // bucket hat: tapered crown, darker band, sloping brim
    const mat = plastic(color, { rough: 0.72 }).clone();
    mat.side = THREE.DoubleSide;
    hat.userData.mat = mat;
    put(g, cylG(0.182, 0.214, 0.17, 22), mat, [0, 0.045, 0]);
    put(g, geo('bucketTop', () => new THREE.SphereGeometry(0.182, segs(22), 4, 0, Math.PI * 2, 0, Math.PI / 2)), mat, [0, 0.13, 0], [1, 0.22, 1]);
    put(g, cylG(0.212, 0.335, 0.05, 26, true), mat, [0, -0.045, 0]);
    put(g, geo('bucketRim', () => new THREE.TorusGeometry(0.334, 0.012, 4, segs(26))), mat, [0, -0.07, 0], undefined, [Math.PI / 2, 0, 0]);
    put(g, cylG(0.205, 0.213, 0.04, 22, true), plastic(shade(color, 0.55), { rough: 0.6, side: THREE.DoubleSide }), [0, -0.015, 0], [1.03, 1, 1.03]);
  } else {
    // sou'wester: rounded crown, floppy brim longer at the back
    const mat = slickerMat(color);
    mat.side = THREE.DoubleSide;
    hat.userData.mat = mat;
    put(g, geo('swDome', () => new THREE.SphereGeometry(0.218, segs(22), segs(8), 0, Math.PI * 2, 0, Math.PI / 2)), mat, [0, -0.03, 0], [1, 1.05, 1]);
    put(g, cylG(0.21, 0.34, 0.06, 26, true), mat, [0, -0.04, -0.04], [1, 1, 1.12], [-0.14, 0, 0]);
  }
  bake(hat);
  return hat;
}

// ---------------------------------------------------------------------------------------------

export function makeCrew(look: CrewLook): CrewView {
  const root = new THREE.Group();
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
  const bibs = new THREE.MeshStandardMaterial({ color: bibsColor, roughness: 0.42, metalness: 0 });
  const bootMat = plastic(look.boots ?? 0x2b2f36, { rough: 0.3 });
  const skin = plastic(look.skin, { rough: 0.48 });
  const dark = plastic(0x15161a, { rough: 0.12 });
  const blush = plastic(0xf08c80, { rough: 0.55 });
  const hairColor = look.hair ?? look.beard ?? 0x5a3c26;
  const hair = plastic(hairColor, { rough: 0.6 });
  const trim = plastic(0x6e4a2c, { rough: 0.45 });
  const mit = knitMat(look.mitts ?? 0x3c6e8f);
  const coloured: Record<PartName, THREE.Mesh[]> = { legs: [], pelvis: [], chest: [], head: [], armL: [], armR: [] };

  // --- legs (one part, two legs), pivot at the hips; the deck is at y = -0.57 here
  const legs = new THREE.Group();
  const legsRest = new THREE.Vector3(0, -0.28, 0);
  {
    const g = inner(legs, legS);
    for (const s of [-1, 1]) {
      const x = s * 0.118;
      put(g, rb1(0.22, 0.36, 0.26, 0.08), bibs, [x, -0.12, 0]);
      put(g, cylG(0.126, 0.126, 0.06, 14), bibs, [x, -0.29, 0], [1, 1, 1.12]);
      put(g, cylG(0.1, 0.105, 0.2, 12), bootMat, [x, -0.4, -0.01], [1, 1, 1.15]);
      put(g, rb1(0.214, 0.12, 0.33, 0.05), bootMat, [x, -0.51, 0.04]);
    }
  }
  bake(legs);
  body.add(legs);
  legs.position.copy(legsRest);

  // --- pelvis (seat of the overalls)
  const pelvis = new THREE.Group();
  const pelvisRest = new THREE.Vector3(0, -0.14, 0);
  put(inner(pelvis, torsoS), rb1(0.5, 0.26, 0.34, 0.1), bibs, [0, -0.06, 0]);
  bake(pelvis);
  body.add(pelvis);
  pelvis.position.copy(pelvisRest);

  // --- chest: slicker worn open over the bib, wooden toggles, puffy collar
  const chest = new THREE.Group();
  const chestRest = new THREE.Vector3(0, 0.2, 0);
  {
    const g = inner(chest, torsoS);
    put(g, rb(0.6, 0.5, 0.4, 0.1), slicker);
    put(g, rb1(0.63, 0.09, 0.43, 0.04), slicker, [0, -0.215, 0]);
    // the bib of the overalls between the open fronts: a pocket and two buckles
    put(g, rb1(0.22, 0.3, 0.04, 0.015), bibs, [0, 0.0, 0.19]);
    put(g, rb1(0.15, 0.075, 0.02, 0.008), bibs, [0, -0.05, 0.212]);
    for (const s of [-1, 1]) {
      put(g, rb1(0.085, 0.38, 0.05, 0.022), slicker, [s * 0.148, -0.02, 0.19]);
      put(g, geo('buckle', () => new THREE.BoxGeometry(0.036, 0.032, 0.014)), trim, [s * 0.072, 0.115, 0.213], undefined, undefined, false);
    }
    // wooden toggles down the right front
    for (const y of [0.1, -0.02, -0.14]) {
      put(g, geo('toggle', () => new THREE.CapsuleGeometry(0.013, 0.05, 1, 5)), trim, [-0.148, y, 0.222], undefined, [0, 0, Math.PI / 2], false);
    }
    // collar, and the hood rolled up behind it
    put(g, geo('collar', () => new THREE.TorusGeometry(0.168, 0.064, segs(7), segs(18))), slicker, [0, 0.255, 0], [1.04, 1, 1], [Math.PI / 2, 0, 0]);
    put(g, geo('hood', () => new THREE.CapsuleGeometry(0.075, 0.2, 4, 10)), slicker, [0, 0.27, -0.2], [1, 1, 0.8], [0.25, 0, Math.PI / 2]);
  }
  bake(chest);
  body.add(chest);
  chest.position.copy(chestRest);

  // --- head, pivot at the neck
  const head = new THREE.Group();
  const headRest = new THREE.Vector3(0, 0.47, 0);
  {
    if (neck > 0) put(head, cylG(0.072, 0.082, 0.2, 10), skin, [0, 0.03, 0]);
    const g = inner(head, [HEAD_K, HEAD_K, HEAD_K], [0, neck, 0]);
    put(g, sph(SKULL_R, 20, 14), skin, [0, SKULL_Y, 0], [1, SKULL_SZ, SKULL_SZ]);
    for (const s of [-1, 1]) {
      // ears, eyes, brows, cheeks
      put(g, sph(0.056, 7, 5), skin, [s * 0.208, 0.16, -0.002], [0.5, 1, 0.8]);
      put(g, sph(0.029, 7, 5), dark, [s * 0.075, 0.195, faceZ(0.075, 0.195) - 0.003], [0.85, 1.12, 0.55], undefined, false);
      const browL = look.beard !== undefined ? 0.06 : 0.044;
      put(g, geo(`brow${browL}`, () => new THREE.CapsuleGeometry(0.012, browL, 2, 6)), hair, [s * 0.078, 0.258, faceZ(0.078, 0.258) - 0.002], [1, 1, 0.8], [-0.25, 0, Math.PI / 2 + s * (look.brow ?? 0)], false);
      put(g, sph(0.034, 8, 5), blush, [s * 0.118, 0.115, faceZ(0.118, 0.115) - 0.004], [1, 0.75, 0.4], [0, s * 0.55, 0], false);
    }
    put(g, sph(0.046, 8, 6), skin, [0, 0.142, 0.198], [1.05, 0.9, 0.85]);
    // smile
    put(g, geo('smile', () => new THREE.TorusGeometry(0.03, 0.0085, 5, 8, Math.PI)), dark, [0, 0.093, faceZ(0, 0.093) - 0.004], undefined, [0.35, 0, Math.PI], false);
    // hair: a crown with a hairline above the brows, and the back down to the nape (behind the ears)
    put(g, geo('hairTop', () => new THREE.SphereGeometry(SKULL_R + 0.007, segs(18), 4, 0, Math.PI * 2, 0, 0.3 * Math.PI)), hair, [0, SKULL_Y, 0], [1, SKULL_SZ, SKULL_SZ]);
    put(g, geo('hairBack', () => new THREE.SphereGeometry(SKULL_R + 0.009, segs(14), segs(6), Math.PI + 0.25, Math.PI - 0.5, 0.25 * Math.PI, 0.45 * Math.PI)), hair, [0, SKULL_Y, 0], [1, SKULL_SZ, SKULL_SZ]);
    if (look.beard !== undefined) {
      // a big bushy beard and moustache
      put(g, sph(0.17, 12, 9), hair, [0, 0.05, 0.075], [1.15, 0.92, 0.88]);
      for (const s of [-1, 1]) {
        put(g, sph(0.09, 8, 5), hair, [s * 0.125, 0.075, 0.07]);
        put(g, sph(0.085, 8, 5), hair, [s * 0.065, 0.005, 0.13]);
        put(g, geo('stache', () => new THREE.CapsuleGeometry(0.032, 0.05, 3, 8)), hair, [s * 0.05, 0.112, 0.2], undefined, [0, s * 0.3, s * 1.2]);
      }
      put(g, sph(0.09, 8, 5), hair, [0, -0.025, 0.13]);
    }
    if (look.braid) {
      const ys = [0.07, -0.01, -0.09, -0.17, -0.245];
      const zs = [-0.205, -0.25, -0.258, -0.252, -0.245];
      const rs = [0.055, 0.05, 0.046, 0.042, 0.036];
      ys.forEach((y, i) => put(g, sph(rs[i], 8, 6), hair, [0.01 * i, y, zs[i]], [1, 1.3, 0.85], [0, 0, i % 2 ? 0.45 : -0.45]));
      put(g, geo('tie', () => new THREE.TorusGeometry(0.026, 0.012, 5, 10)), plastic(0x2c8c8c, { rough: 0.5 }), [0.05, -0.29, -0.243], undefined, [Math.PI / 2, 0, 0]);
      put(g, geo('tuft', () => new THREE.ConeGeometry(0.03, 0.08, 7)), hair, [0.05, -0.335, -0.243], undefined, [Math.PI, 0, 0]);
    }
    if (look.freckles) {
      for (const s of [-1, 1])
        for (const [fx, fy] of [
          [0.062, 0.16],
          [0.09, 0.148],
          [0.075, 0.136],
        ])
          put(g, sph(0.0075, 5, 4), hair, [s * fx, fy, faceZ(fx, fy)], undefined, undefined, false);
    }
    if (lanky) {
      // ginger tufts poking out under the hat
      for (const s of [-1, 1]) put(g, geo('tuftS', () => new THREE.ConeGeometry(0.03, 0.09, 6)), hair, [s * 0.2, 0.235, -0.04], undefined, [0.3, 0, s * -2.0]);
    }
  }
  bake(head);
  body.add(head);
  head.position.copy(headRest);

  // --- arms, pivot at the shoulders; they hang down -Y
  const makeArm = (s: number) => {
    const arm = new THREE.Group();
    const g = inner(arm, lanky ? [0.9, 1, 0.9] : [1, 1, 1]);
    put(g, sph(0.108, 8, 6), slicker, [0, -0.01, 0]);
    put(g, cylG(0.099, 0.09, 0.27, 12, true), slicker, [0, -0.15, 0]);
    put(g, cylG(0.101, 0.101, 0.05, 12), slicker, [0, -0.285, 0]);
    // chunky knitted mitten with a ribbed cuff and a thumb
    put(g, uvs(cylG(0.07, 0.074, 0.05, 10), 3, 0.3), mit, [0, -0.312, 0]);
    put(g, uvs(sph(0.09, 10, 8), 3, 1.5), mit, [0, -0.39, 0.005], [0.92, 1.12, 0.84]);
    put(g, uvs(sph(0.04, 8, 6), 2, 1), mit, [-s * 0.062, -0.36, 0.048], [1, 1.25, 1], [0.3, 0, s * 0.4]);
    bake(arm);
    return arm;
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);
  const armLRest = new THREE.Vector3(0.36, 0.4, 0);
  const armRRest = new THREE.Vector3(-0.36, 0.4, 0);
  armL.position.copy(armLRest);
  armR.position.copy(armRRest);
  body.add(armL, armR);

  const mittens: THREE.Mesh[] = [];
  const collect = (name: PartName, part: THREE.Object3D) =>
    part.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.material === slicker || m.material === bibs) coloured[name].push(m);
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
  const hatRest = new THREE.Vector3(0, HAT_SEAT[look.hatStyle] + neck, 0);
  hat.position.copy(hatRest);
  body.add(hat);

  // --- soft ring under the feet, with a soft contact shadow
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: look.isPlayer ? P.slicker : 0xffffff, transparent: true, opacity: look.isPlayer ? 0.75 : 0.35, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.32, depthWrite: false }),
  );
  ring.add(blob);

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

/** The four crew looks for the demo. */
export const CREW_LOOKS: Record<'player' | 'mo' | 'dot' | 'ike', CrewLook> = {
  player: { name: 'You', slicker: P.slicker, bibs: 0xe0662c, skin: 0xf1c7a5, hatStyle: 'beanie', hatColor: 0xc8432f, hair: 0x6b4630, mitts: 0x3c6e8f, brow: 0, isPlayer: true },
  mo: { name: 'Mo', slicker: 0xe56a2a, bibs: 0x2b3a56, skin: 0xe3b493, hatStyle: 'cap', hatColor: 0x23314a, beard: 0xe8e6e1, mitts: 0xb5372c, build: 'stocky', brow: 0.2 },
  dot: { name: 'Dot', slicker: 0xf2c230, bibs: 0x2a8c88, skin: 0xa8714f, hatStyle: 'bobble', hatColor: 0x2c8c8c, hair: 0x2a1d16, mitts: 0xe9e1cf, braid: true, brow: -0.1 },
  ike: { name: 'Ike', slicker: 0xf5d23c, bibs: 0x5a7d34, skin: 0xf6d2b8, hatStyle: 'bucket', hatColor: 0x4f8a3a, hair: 0xd0782f, mitts: 0xe2762e, build: 'lanky', freckles: true, brow: -0.3 },
};
