/**
 * makeCat(): Barnacle the boat cat. A chubby orange tabby with a big round head, white socks and
 * chest, green eyes and one bent ear.
 * Origin = body centre (physics box). Poses: 'sit' | 'walk' | 'slide' | 'carried' | 'loaf' | 'cling'.
 *
 * Every piece is UV-mapped into one canvas atlas (striped fur for the body, head, tail and legs,
 * plus flat swatches for eyes, nose and socks), so the whole cat is one material. Contact shading
 * (under the belly and chin, where legs meet the body) is baked into vertex colours. The seated
 * pose swaps the hind legs and tail for one extra mesh (round haunches, hind feet and a tail curled
 * round the front paws), so it draws five meshes and the others draw seven.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type CatPose = 'sit' | 'walk' | 'slide' | 'carried' | 'loaf' | 'cling';

export interface CatView {
  root: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  legs: THREE.Object3D[];
  body: THREE.Mesh;
  hearts: THREE.Group;
  setPose(p: CatPose, t: number): void;
}

// ---------------------------------------------------------------------------------------------
// the fur atlas: 512 x 256. Regions in canvas pixels.

const AW = 512,
  AH = 256;
type Rect = [number, number, number, number];
const R_BODY: Rect = [0, 0, 256, 128];
const R_HEAD: Rect = [256, 0, 256, 128];
const R_TAIL: Rect = [0, 128, 256, 64];
const R_LEG: Rect = [256, 128, 128, 128];
const SWATCH = { white: 0, pink: 1, green: 2, black: 3, cream: 4, ear: 5, orange: 6 } as const;
type Swatch = keyof typeof SWATCH;
const swatchXY = (s: Swatch): [number, number] => {
  const i = SWATCH[s];
  return [384 + (i % 4) * 32 + 16, 128 + Math.floor(i / 4) * 32 + 16];
};

/** Phones (which start on Low) get lighter meshes. */
const LOD = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 0.6 : 1;
const segs = (k: number, min = 4) => Math.max(min, Math.round(k * LOD));

const ORANGE = '#ea8a3a';
const STRIPE = '#b4531b';
const CREAM = '#f7e6c8';

let atlas: { map: THREE.Texture; rough: THREE.Texture } | null = null;
function catAtlas(): { map: THREE.Texture; rough: THREE.Texture } {
  if (atlas) return atlas;
  const cv = document.createElement('canvas');
  cv.width = AW;
  cv.height = AH;
  const g = cv.getContext('2d')!;
  let seed = 99;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const clip = (r: Rect, fn: () => void) => {
    g.save();
    g.beginPath();
    g.rect(r[0], r[1], r[2], r[3]);
    g.clip();
    fn();
    g.restore();
  };
  /** A tapered, slightly wavy stripe from (x0,y0) to (x1,y1). */
  const stripe = (x0: number, y0: number, x1: number, y1: number, w: number, col = STRIPE) => {
    const n = 10;
    const dx = x1 - x0,
      dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len,
      ny = dx / len;
    const ph = rnd() * 6;
    const top: [number, number][] = [],
      bot: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const taper = Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85)) * 0.8 + 0.2;
      const wob = Math.sin(t * 7 + ph) * w * 0.25;
      const cx = x0 + dx * t + nx * wob,
        cy = y0 + dy * t + ny * wob;
      top.push([cx + nx * w * taper * 0.5, cy + ny * w * taper * 0.5]);
      bot.push([cx - nx * w * taper * 0.5, cy - ny * w * taper * 0.5]);
    }
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(top[0][0], top[0][1]);
    for (const p of top) g.lineTo(p[0], p[1]);
    for (const p of bot.reverse()) g.lineTo(p[0], p[1]);
    g.closePath();
    g.fill();
  };
  const softBlob = (x: number, y: number, rx: number, ry: number, col: string) => {
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    const grd = g.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx);
    grd.addColorStop(0, col);
    grd.addColorStop(1, col + '00');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  g.fillStyle = ORANGE;
  g.fillRect(0, 0, AW, AH);

  // body: u around (x), head end at the top. The back is u = 0.75 (x 192), the belly u = 0.25 (x 64).
  clip(R_BODY, () => {
    softBlob(192, 64, 60, 90, '#d9752c');
    for (let k = 0; k < 7; k++) {
      const y = 14 + k * 16.5;
      // a chevron across the back, slanting toward the tail down the flanks
      stripe(118, y + 16, 192, y, 7.5);
      stripe(192, y, 266, y + 16, 7.5);
      stripe(-10, y + 16, 12, y + 10, 5);
    }
    // a white bib from the chin down the chest, narrowing along the belly
    softBlob(64, 70, 44, 104, CREAM);
    softBlob(64, 18, 70, 40, CREAM);
    softBlob(64, 4, 80, 22, CREAM);
  });
  // head: u = 0.25 (x 320) is the face, top of the canvas is the crown
  clip(R_HEAD, () => {
    const fx = 256 + 64;
    softBlob(fx, 92, 40, 30, CREAM);
    // a white chin and throat running down into the chest bib
    softBlob(fx, 118, 66, 26, CREAM);
    // the tabby "M" on the forehead
    stripe(fx - 13, 16, fx - 9, 44, 6);
    stripe(fx, 10, fx, 48, 7);
    stripe(fx + 13, 16, fx + 9, 44, 6);
    // cheek stripes
    for (const s of [-1, 1]) {
      stripe(fx + s * 28, 60, fx + s * 46, 56, 5);
      stripe(fx + s * 29, 70, fx + s * 47, 70, 4.5);
    }
    // back of the head
    for (let k = 0; k < 5; k++) stripe(256 + 150 + k * 18, 6, 256 + 146 + k * 18, 56, 7);
  });
  // tail: u along the length (x), rings
  clip(R_TAIL, () => {
    for (let k = 0; k < 7; k++) {
      const x = 22 + k * 33;
      g.fillStyle = STRIPE;
      g.fillRect(x, 128, 13, 64);
    }
    g.fillStyle = '#a84c18';
    g.fillRect(232, 128, 24, 64);
  });
  // legs: hip at the top, white sock at the bottom
  clip(R_LEG, () => {
    stripe(256, 150, 384, 156, 8);
    stripe(256, 176, 384, 182, 7);
    const grd = g.createLinearGradient(0, 128 + 70, 0, 128 + 84);
    grd.addColorStop(0, CREAM + '00');
    grd.addColorStop(1, '#f8f3ea');
    g.fillStyle = grd;
    g.fillRect(256, 128 + 70, 128, 58);
  });
  // flat swatches
  const sw: [Swatch, string][] = [
    ['white', '#fbf8f2'],
    ['pink', '#f07f95'],
    ['green', '#9ad14a'],
    ['black', '#111214'],
    ['cream', CREAM],
    ['ear', '#f59aaa'],
    ['orange', ORANGE],
  ];
  for (const [s, col] of sw) {
    const [x, y] = swatchXY(s);
    g.fillStyle = col;
    g.fillRect(x - 16, y - 16, 32, 32);
  }
  // a little fur noise everywhere except the swatches
  for (let i = 0; i < 2500; i++) {
    const x = rnd() * 384,
      y = rnd() * AH;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,240,220,0.08)' : 'rgba(90,40,10,0.08)';
    g.fillRect(x, y, 1 + rnd() * 2, 3 + rnd() * 4);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  // roughness: satin fur, glossy eyes and nose
  const rc = document.createElement('canvas');
  rc.width = AW / 4;
  rc.height = AH / 4;
  const r = rc.getContext('2d')!;
  r.fillStyle = 'rgb(150,150,150)';
  r.fillRect(0, 0, rc.width, rc.height);
  r.fillStyle = 'rgb(28,28,28)';
  for (const s of ['pink', 'green', 'black', 'white'] as Swatch[]) {
    const [x, y] = swatchXY(s);
    r.fillRect((x - 16) / 4, (y - 16) / 4, 8, 8);
  }
  const rough = new THREE.CanvasTexture(rc);
  rough.colorSpace = THREE.NoColorSpace;
  atlas = { map, rough };
  return atlas;
}

let blobTex: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (blobTex) return blobTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.5, '#a0a0a0');
  grd.addColorStop(1, '#000000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(cv);
  return blobTex;
}

let catMat: THREE.MeshStandardMaterial | null = null;
function furMat(): THREE.MeshStandardMaterial {
  if (!catMat) {
    const a = catAtlas();
    catMat = new THREE.MeshStandardMaterial({ map: a.map, roughnessMap: a.rough, roughness: 1, metalness: 0, vertexColors: true });
  }
  return catMat;
}

// ---------------------------------------------------------------------------------------------
// geometry: pieces UV-mapped into the atlas and merged

interface Piece {
  geo: THREE.BufferGeometry;
  /** an atlas rectangle (the piece's 0..1 UVs map into it) or a flat swatch */
  to: Rect | Swatch;
  p?: [number, number, number];
  s?: [number, number, number];
  r?: [number, number, number];
  /** baked contact shade (mesh space, after the piece transform), multiplies the fur */
  ao?: (p: THREE.Vector3, n: THREE.Vector3) => number;
}

function atlasMerge(pieces: Piece[]): THREE.BufferGeometry {
  const out: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const pc of pieces) {
    const g = pc.geo.index ? pc.geo.toNonIndexed() : pc.geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (typeof pc.to === 'string') {
        const [x, y] = swatchXY(pc.to);
        uv.setXY(i, x / AW, 1 - y / AH);
      } else {
        const [x, y, w, h] = pc.to;
        // keep a 2px margin so mip filtering doesn't bleed across regions
        const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1),
          v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
        uv.setXY(i, (x + 2 + u * (w - 4)) / AW, 1 - (y + 2 + (1 - v) * (h - 4)) / AH);
      }
    }
    q.setFromEuler(new THREE.Euler(...(pc.r ?? [0, 0, 0])));
    m.compose(new THREE.Vector3(...(pc.p ?? [0, 0, 0])), q, new THREE.Vector3(...(pc.s ?? [1, 1, 1])));
    g.applyMatrix4(m);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const pv = new THREE.Vector3(),
      nv = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const k = pc.ao ? pc.ao(pv.fromBufferAttribute(pos, i), nv.fromBufferAttribute(nor, i)) : 1;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push(g);
  }
  return mergeGeometries(out)!;
}

/** A tube along a curve, tapered toward the end and capped with a ball. */
function tailGeometry(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.1, -0.01),
    new THREE.Vector3(0, 0.19, 0.0),
    new THREE.Vector3(0, 0.26, 0.04),
    new THREE.Vector3(0, 0.29, 0.1),
  ]);
  const r0 = 0.034;
  const tube = new THREE.TubeGeometry(curve, segs(16), r0, segs(8), false);
  const pos = tube.attributes.position as THREE.BufferAttribute;
  const uv = tube.attributes.uv as THREE.BufferAttribute;
  const c = new THREE.Vector3(),
    v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getX(i);
    curve.getPointAt(t, c);
    v.fromBufferAttribute(pos, i).sub(c);
    const k = 1 - 0.35 * t;
    v.multiplyScalar(k).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  tube.computeVertexNormals();
  const tip = new THREE.SphereGeometry(r0 * 0.65, 8, 6);
  return atlasMerge([
    { geo: tube, to: R_TAIL },
    { geo: tip, to: 'orange', p: curve.getPointAt(1).toArray() as [number, number, number] },
  ]);
}

// rest layout (root space)
const BODY_P = new THREE.Vector3(0, 0.02, -0.01);
const HEAD_P = new THREE.Vector3(0, 0.1, 0.19);
const TAIL_P = new THREE.Vector3(0, 0.05, -0.2);
const LEG_XZ: [number, number][] = [
  [-0.056, 0.115],
  [0.056, 0.115],
  [-0.056, -0.125],
  [0.056, -0.125],
];
const LEG_Y = -0.035;

/** A tapered tube along a curve (tail), UVs along its length; capped with a ball. */
function tailTube(curve: THREE.Curve<THREE.Vector3>, r0: number, taper: number, n: number, ao?: Piece['ao']): Piece[] {
  const tube = new THREE.TubeGeometry(curve, segs(n), r0, segs(8), false);
  const pos = tube.attributes.position as THREE.BufferAttribute;
  const uv = tube.attributes.uv as THREE.BufferAttribute;
  const c = new THREE.Vector3(),
    v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getX(i);
    curve.getPointAt(t, c);
    v.fromBufferAttribute(pos, i).sub(c);
    v.multiplyScalar(1 - taper * t).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  tube.computeVertexNormals();
  return [
    { geo: tube, to: R_TAIL, ao },
    { geo: new THREE.SphereGeometry(r0 * (1 - taper), 8, 6), to: 'orange', p: curve.getPointAt(1).toArray() as [number, number, number] },
  ];
}

// the seated figurine (root space): body upright, front legs straight down under the chest
const SIT = {
  body: new THREE.Vector3(0, 0.016, -0.03),
  bodyTilt: 0.32,
  bodyLen: 0.62,
  head: new THREE.Vector3(0, 0.228, 0.03),
  frontX: 0.033,
  frontZ: 0.062,
  frontY: 0.004,
  frontK: 1.35,
};

let geos: { body: THREE.BufferGeometry; head: THREE.BufferGeometry; tail: THREE.BufferGeometry; leg: THREE.BufferGeometry; sit: THREE.BufferGeometry } | null = null;
function catGeometry() {
  if (geos) return geos;
  // body: a chubby capsule along its local y (the mesh is rotated x = PI/2, so local (x, y, z)
  // lands at (x, -z, y) in the root and +y is the front), with a fluffy cream chest. The belly is
  // local +z: shaded darker toward the back legs.
  const body = atlasMerge([
    {
      geo: new THREE.CapsuleGeometry(0.1, 0.2, segs(5), segs(14)),
      to: R_BODY,
      ao: (p, n) => 1 - 0.24 * Math.max(0, n.z) * THREE.MathUtils.clamp(-p.y / 0.14 + 0.2, 0, 1),
    },
    { geo: new THREE.SphereGeometry(0.075, segs(9, 6), segs(7)), to: 'cream', p: [0, 0.155, 0.035], s: [1, 0.75, 1] },
  ]);
  // head: big round skull, cheek puffs, chin, nose, eyes, ears, whiskers. Darker under the chin.
  const chin: Piece['ao'] = (_p, n) => 1 - 0.25 * Math.max(0, -n.y);
  const hp: Piece[] = [{ geo: new THREE.SphereGeometry(0.105, segs(18), segs(12)), to: R_HEAD, s: [1.08, 0.95, 1], ao: chin }];
  for (const s of [-1, 1]) {
    hp.push({ geo: new THREE.SphereGeometry(0.042, segs(9, 6), segs(7)), to: 'cream', p: [s * 0.033, -0.035, 0.078], s: [1, 0.85, 0.9], ao: chin });
    // big eyes: green iris, black slit pupil, a white sparkle
    hp.push({ geo: new THREE.SphereGeometry(0.025, segs(9, 6), segs(7)), to: 'green', p: [s * 0.043, 0.02, 0.087], s: [1, 1.15, 0.5] });
    hp.push({ geo: new THREE.SphereGeometry(0.018, segs(7, 5), segs(5)), to: 'black', p: [s * 0.043, 0.02, 0.095], s: [0.5, 1.05, 0.45] });
    hp.push({ geo: new THREE.SphereGeometry(0.0055, 4, 3), to: 'white', p: [s * 0.037, 0.031, 0.1] });
    // ears: the right one is folded over; big pink insides facing forward
    const bent = s > 0;
    const earP: [number, number, number] = [s * 0.058, 0.083, -0.01];
    const earR: [number, number, number] = [bent ? 0.75 : -0.05, 0, -s * 0.32];
    hp.push({ geo: new THREE.ConeGeometry(0.046, 0.085, 10), to: 'orange', p: earP, r: earR });
    hp.push({ geo: new THREE.ConeGeometry(0.034, 0.066, 8).scale(1, 1, 0.42).translate(0, -0.006, 0.021), to: 'ear', p: earP, r: earR });
    // whiskers
    for (let i = LOD < 1 ? 1 : 0; i < 3; i++) {
      hp.push({
        geo: new THREE.CylinderGeometry(0.0022, 0.0012, 0.1, 3),
        to: 'white',
        p: [s * 0.095, -0.03 + i * 0.009 - 0.009, 0.075],
        r: [0, -s * 0.35, s * (Math.PI / 2 + (i - 1) * 0.18)],
      });
    }
  }
  hp.push({ geo: new THREE.SphereGeometry(0.03, segs(7, 5), segs(5)), to: 'cream', p: [0, -0.062, 0.07], s: [1, 0.8, 0.9], ao: chin });
  // a pink nose pad: a rounded triangle, point down
  hp.push({ geo: new THREE.SphereGeometry(0.018, 10, 6), to: 'pink', p: [0, -0.01, 0.108], s: [1.45, 0.9, 0.8] });
  hp.push({ geo: new THREE.ConeGeometry(0.014, 0.022, 8), to: 'pink', p: [0, -0.02, 0.106], s: [1.4, 1, 0.7], r: [Math.PI, 0, 0] });
  const head = atlasMerge(hp);
  // leg: a stubby capsule (orange with a white sock) and a round paw, darker where it meets the body
  const leg = atlasMerge([
    { geo: new THREE.CapsuleGeometry(0.03, 0.045, 2, 7), to: R_LEG, p: [0, -0.02, 0], ao: (p) => 1 - 0.2 * THREE.MathUtils.clamp((p.y + 0.005) / 0.035, 0, 1) },
    { geo: new THREE.SphereGeometry(0.034, segs(8, 5), segs(5)), to: 'white', p: [0, -0.06, 0.012], s: [1, 0.7, 1.25] },
  ]);
  // the seated extras (root space, only shown in the sit pose): round haunches either side of the
  // rump, hind feet poking forward, and the tail curled round the front paws
  const deck = -0.11;
  const low: Piece['ao'] = (p) => 1 - 0.3 * THREE.MathUtils.clamp(1 - (p.y - deck) / 0.06, 0, 1);
  const sit: Piece[] = [];
  for (const sx of [-1, 1]) {
    sit.push({ geo: new THREE.SphereGeometry(0.066, segs(12), segs(9)), to: R_BODY, p: [sx * 0.074, -0.068, -0.07], s: [0.82, 0.88, 1.12], r: [0, sx * 0.25, 0], ao: low });
    sit.push({ geo: new THREE.SphereGeometry(0.032, segs(8, 5), segs(5)), to: 'white', p: [sx * 0.098, -0.098, 0.03], s: [0.95, 0.6, 1.45], r: [0, sx * 0.15, 0], ao: low });
  }
  const curl = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, -0.05, -0.13),
    new THREE.Vector3(0.07, -0.078, -0.165),
    new THREE.Vector3(0.155, -0.082, -0.09),
    new THREE.Vector3(0.17, -0.082, 0.03),
    new THREE.Vector3(0.12, -0.082, 0.13),
    new THREE.Vector3(0.03, -0.084, 0.165),
  ]);
  sit.push(...tailTube(curl, 0.032, 0.32, 16, low));
  geos = { body, head, tail: tailGeometry(), leg, sit: atlasMerge(sit) };
  return geos;
}

export function makeCat(): CatView {
  const root = new THREE.Group();
  const mat = furMat();
  const G = catGeometry();
  const mesh = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const body = mesh(G.body);
  body.rotation.x = Math.PI / 2;
  body.position.copy(BODY_P);
  root.add(body);
  const head = new THREE.Group();
  head.add(mesh(G.head));
  head.position.copy(HEAD_P);
  root.add(head);
  const tail = new THREE.Group();
  tail.add(mesh(G.tail));
  tail.position.copy(TAIL_P);
  tail.rotation.x = -0.6;
  root.add(tail);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of LEG_XZ) {
    const leg = new THREE.Group();
    leg.add(mesh(G.leg));
    leg.position.set(x, LEG_Y, z);
    root.add(leg);
    legs.push(leg);
  }
  // haunches, hind feet and the curled tail of the seated pose (shown instead of the hind legs and tail)
  const sitExtras = mesh(G.sit);
  sitExtras.visible = false;
  root.add(sitExtras);
  const hearts = new THREE.Group();
  root.add(hearts);
  // a soft contact shadow on the deck (the only one on Low, where shadow maps are off)
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.24, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.3, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0, -0.106, 0);
  blob.scale.set(0.75, 1.15, 1);
  blob.renderOrder = 1;
  root.add(blob);

  const setPose = (p: CatPose, t: number) => {
    blob.visible = p !== 'carried' && p !== 'cling';
    // defaults
    head.rotation.set(0, 0, 0);
    head.position.copy(HEAD_P);
    tail.position.copy(TAIL_P);
    tail.rotation.set(-0.6, 0, 0);
    body.position.copy(BODY_P);
    body.rotation.set(Math.PI / 2, 0, 0);
    body.scale.set(1, 1, 1);
    legs.forEach((l, i) => {
      l.rotation.set(0, 0, 0);
      l.position.set(LEG_XZ[i][0], LEG_Y, LEG_XZ[i][1]);
      l.scale.set(1, 1, 1);
      l.visible = true;
    });
    tail.visible = true;
    sitExtras.visible = false;
    if (p === 'walk') {
      legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 9 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6));
      body.position.y = BODY_P.y + Math.abs(Math.sin(t * 9)) * 0.008;
      tail.rotation.set(-0.9 + Math.sin(t * 3) * 0.15, Math.sin(t * 2) * 0.3, 0);
      head.rotation.y = Math.sin(t * 1.3) * 0.2;
    } else if (p === 'sit') {
      // sitting up like a figurine: a short upright body on two round haunches, front legs
      // straight down under the chest with the white socks together, the tail curled round the
      // front paws, head up on top
      body.rotation.x = SIT.bodyTilt;
      body.scale.set(1, SIT.bodyLen, 1);
      body.position.copy(SIT.body);
      for (const i of [0, 1]) {
        legs[i].position.set((i ? 1 : -1) * SIT.frontX, SIT.frontY, SIT.frontZ);
        legs[i].scale.set(1, SIT.frontK, 1);
      }
      legs[2].visible = legs[3].visible = false;
      tail.visible = false;
      sitExtras.visible = true;
      head.position.copy(SIT.head);
      head.rotation.set(-0.12, Math.sin(t * 0.7) * 0.12, Math.sin(t * 0.45) * 0.06);
    } else if (p === 'loaf') {
      // paws tucked under: the body settles onto the deck
      body.position.y = -0.005;
      legs.forEach((l) => (l.position.y = 0.02));
      head.position.set(0, 0.07, 0.19);
      head.rotation.x = 0.15;
      tail.position.set(0, -0.04, -0.2);
      tail.rotation.set(-1.5, 0.9, 0);
    } else if (p === 'slide') {
      // belly flat, legs splayed like a starfish
      body.position.y = -0.005;
      legs.forEach((l, i) => {
        l.rotation.z = (i % 2 ? 1 : -1) * 1.3;
        l.rotation.x = (i < 2 ? -1 : 1) * 0.6;
        l.position.y = 0;
      });
      head.position.set(0, 0.07, 0.2);
      head.rotation.set(-0.3, Math.sin(t * 12) * 0.2, 0);
      tail.rotation.set(-1.6, Math.sin(t * 15) * 0.6, 0);
    } else if (p === 'cling') {
      legs.forEach((l, i) => (l.rotation.x = (i < 2 ? -1.2 : 1.2) + Math.sin(t * 30 + i) * 0.2));
      tail.rotation.set(-0.2, 0, 0);
    } else if (p === 'carried') {
      legs.forEach((l, i) => (l.rotation.x = (i < 2 ? -0.3 : 0.3) + Math.sin(t * 2 + i) * 0.1));
      tail.rotation.set(0.5, Math.sin(t * 2.5) * 0.4, 0);
      head.rotation.x = -0.2;
    }
  };
  setPose('sit', 0);
  return { root, head, tail, legs, body, hearts, setPose };
}
