/**
 * Crab art. Instanced in-game: one geometry per sex (shell + legs + claws, tinted per instance by
 * species) plus an "apron" marker geometry on top of the shell. The sorting rule is visual, and
 * the markers differ by hue as well as shape:
 *   KEEP  = wide body + a bold yellow chevron across most of the shell (male, big)
 *   THROW = rounder body + a pale blue open ring (female), or a small crab whose chevron is grey
 *
 * The body geometry carries a vertex colour that multiplies the species colour: a knobbly glossy
 * shell with darker spots, a paler underside, banded legs, black-tipped claws and black eyes.
 * Use it with a material that has `vertexColors: true` (see crabMaterial()).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type CrabSex = 'm' | 'f';

// ---------------------------------------------------------------------------------------------
// building blocks: every piece gets a uniform (or per-vertex) shade in a 'color' attribute

function shaded(g: THREE.BufferGeometry, shade: number | ((p: THREE.Vector3, n: THREE.Vector3) => number)): THREE.BufferGeometry {
  const q = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k);
  const pos = q.attributes.position as THREE.BufferAttribute;
  const nor = q.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const s = typeof shade === 'number' ? shade : shade(p, n);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  q.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return q;
}

const _up = new THREE.Vector3(0, 1, 0);
/** A tapered limb segment from a to b (open cylinder, few sides). */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 5): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

function ball(r: number, at: THREE.Vector3, scale: [number, number, number] = [1, 1, 1], w = 6, h = 4): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(scale[0], scale[1], scale[2]);
  g.translate(at.x, at.y, at.z);
  return g;
}

function cone(r: number, len: number, at: THREE.Vector3, dir: THREE.Vector3, sides = 5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, dir.clone().normalize()));
  g.translate(at.x, at.y, at.z);
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const R = 0.11;
const H = 0.43;
const shellScale = (sex: CrabSex) => (sex === 'm' ? { sx: 1.25, sz: 0.85 } : { sx: 1.02, sz: 0.93 });
const shellCache = new Map<CrabSex, THREE.BufferGeometry>();
/** The carapace: a flattened dome, broad in front, with knobbly tubercles and a gentle ridge. */
function shellGeometry(sex: CrabSex): THREE.BufferGeometry {
  const hit = shellCache.get(sex);
  if (hit) return hit;
  const { sx, sz } = shellScale(sex);
  const shell = new THREE.SphereGeometry(R, 22, 11);
  const pos = shell.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const top = Math.max(0, v.y / R);
    // a broad front edge, narrower behind
    const zf = v.z / R;
    const widen = 1 + 0.08 * Math.max(0, zf) - 0.06 * Math.max(0, -zf);
    // knobbles on the upper shell
    const bump = 1 + 0.07 * top * Math.max(0, Math.sin(v.x * 70) * Math.sin(v.z * 64 + 0.6));
    v.set(v.x * sx * widen, v.y * H * bump, v.z * sz);
    // a gentle ridge across the middle
    v.y += top * 0.008 * Math.cos(zf * 1.6);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  shell.computeVertexNormals();
  shellCache.set(sex, shell);
  return shell;
}

/** Body geometry (width along X, claws toward +Z). Origin = body centre. ~0.45 m leg span for a big male. */
export function crabBodyGeometry(sex: CrabSex): THREE.BufferGeometry {
  const male = sex === 'm';
  const { sx, sz } = shellScale(sex);
  const parts: THREE.BufferGeometry[] = [];
  const shell = shellGeometry(sex).clone();

  // dark freckle spots in a loose ring, a pale centre
  const spots: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4 + 0.3;
    const rr = 0.35 + 0.4 * ((i * 0.618) % 1);
    spots.push([Math.sin(a) * rr * R * sx, Math.cos(a) * rr * R * sz, 0.02 + 0.012 * ((i * 0.37) % 1)]);
  }
  parts.push(
    shaded(shell, (p, n) => {
      if (n.y < -0.2) return 1.45; // pale underside
      let s = 1.0;
      for (const [x, z, r] of spots) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) s = 0.6;
      const knob = Math.max(0, Math.sin(p.x * 70) * Math.sin(p.z * 64 + 0.6));
      const rim = 1 - Math.min(1, Math.max(0, n.y) * 1.4); // the edge reads a touch darker
      const centre = Math.max(0, 1 - Math.hypot(p.x / (R * sx), p.z / (R * sz)) * 1.6);
      return s + knob * 0.18 - rim * 0.14 + centre * 0.12;
    }),
  );
  const edgeX = R * sx * 1.02;
  // lateral spines and front teeth
  for (const s of [-1, 1]) {
    parts.push(shaded(cone(0.016, male ? 0.06 : 0.035, V(s * edgeX * 0.96, 0.004, 0.018), V(s, 0.08, 0.25)), 0.85));
    for (let k = 0; k < 3; k++) {
      const a = 0.35 + k * 0.28;
      parts.push(shaded(cone(0.009, 0.022, V(s * Math.sin(a) * R * sx * 0.98, 0.006, Math.cos(a) * R * sz * 1.02), V(s * Math.sin(a), 0.1, Math.cos(a))), 0.8));
    }
  }

  // walking legs: thigh up and out to a knee, then down to the deck (y = -0.05)
  for (const s of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const z = 0.035 - i * 0.033;
      const spread = 0.35 - i * 0.32; // front legs reach forward, back legs backward
      const out = V(s * Math.cos(spread), 0, Math.sin(spread));
      const root = V(s * R * sx * 0.82, -0.008, z);
      const knee = root.clone().addScaledVector(out, male ? 0.085 : 0.075).add(V(0, 0.042, 0));
      const foot = knee.clone().addScaledVector(out, male ? 0.06 : 0.052).setY(-0.05);
      parts.push(shaded(limb(root, knee, 0.022, 0.018), 0.88));
      parts.push(shaded(ball(0.0185, knee, [1, 1, 1], 5, 3), 0.72));
      parts.push(shaded(limb(knee, foot, 0.017, 0.005), (p) => (p.y < -0.032 ? 0.42 : 0.84)));
    }

  // claws: an arm to the elbow, a big hand, two black-tipped fingers
  const k = male ? 1.25 : 0.95;
  for (const s of [-1, 1]) {
    const sh = V(s * 0.06 * sx, -0.004, 0.07);
    const el = V(s * 0.125 * k, 0.012, 0.125);
    parts.push(shaded(limb(sh, el, 0.02 * k, 0.018 * k, 6), 0.9));
    const hand = V(s * 0.128 * k, 0.016, 0.19 * Math.max(1, k * 0.95));
    parts.push(shaded(ball(0.044 * k, hand, [0.78, 0.62, 1.3], 8, 6), (p, n) => 1.05 + Math.max(0, n.y) * 0.15));
    const tip = hand.clone().add(V(-s * 0.012, 0, 0.052 * k));
    parts.push(shaded(cone(0.017 * k, 0.062 * k, tip, V(-s * 0.18, -0.12, 1), 6), (p) => (p.distanceTo(tip) > 0.03 * k ? 0.14 : 0.95)));
    const tip2 = hand.clone().add(V(s * 0.006, 0.02 * k, 0.045 * k));
    parts.push(shaded(cone(0.013 * k, 0.058 * k, tip2, V(-s * 0.12, 0.25, 1), 6), (p) => (p.distanceTo(tip2) > 0.026 * k ? 0.14 : 0.95)));
  }

  // eyes on stalks
  for (const s of [-1, 1]) {
    const base = V(s * 0.028, 0.03, 0.085);
    const top = V(s * 0.036, 0.068, 0.098);
    parts.push(shaded(limb(base, top, 0.008, 0.007, 4), 0.85));
    parts.push(shaded(ball(0.0145, top, [1, 1, 1], 6, 4), 0.07));
  }

  const merged = mergeGeometries(parts)!;
  return merged;
}

type P2 = [number, number];

/** Offset a closed polygon inward by d (miter joins, clamped at sharp corners). */
function insetPoly(poly: P2[], d: number, kernel: P2): P2[] {
  const n = poly.length;
  const normals: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    let nx = -(b[1] - a[1]),
      nz = b[0] - a[0];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    // point the edge normal into the polygon (toward the kernel)
    if (nx * (kernel[0] - (a[0] + b[0]) / 2) + nz * (kernel[1] - (a[1] + b[1]) / 2) < 0) {
      nx = -nx;
      nz = -nz;
    }
    normals.push([nx, nz]);
  }
  return poly.map((p, i) => {
    const n0 = normals[(i + n - 1) % n],
      n1 = normals[i];
    let mx = n0[0] + n1[0],
      mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = Math.min(2.6, 1 / Math.max(0.2, mx * n1[0] + mz * n1[1]));
    return [p[0] + mx * d * k, p[1] + mz * d * k];
  });
}

/** Split every edge of a closed polygon so the outline can drape over the dome. */
function densify(poly: P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/** Marker colours (linear). The undersize male's grey is applied per instance (crabFlapMaterial). */
const MARK_KEEP = new THREE.Color(0xffd23a);
const MARK_FEMALE = new THREE.Color(0x9fe3ff);
const MARK_SMALL = new THREE.Color(0xb8b8b8);
const MARK_EDGE = new THREE.Color(0x2a1d10);
/** Instance scale below which a male is undersize (sizes: undersize 0.62–0.75, keepers 0.92+). */
const SMALL_SCALE = 0.82;

/**
 * The apron marker drawn on top so it reads from the overhead camera, different in hue and in
 * shape: a bold yellow chevron across 70% of the shell on males (KEEP; grey on an undersize male,
 * see crabFlapMaterial) and a pale blue open ring on females (THROW), each with a dark outline.
 * Every vertex is draped onto the actual shell mesh (ray cast) 4 mm up, and the material has a
 * polygon offset, so the marker hugs the carapace without fins or z-fighting. Colours live in the
 * vertex colours.
 */
export function crabFlapGeometry(sex: CrabSex): THREE.BufferGeometry {
  const male = sex === 'm';
  // drape onto the rendered shell
  const shellMesh = new THREE.Mesh(shellGeometry(sex), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  const drape = (p: P2): [number, number, number] => {
    ray.set(o.set(p[0], 0.5, p[1]), down);
    const hit = ray.intersectObject(shellMesh, false)[0];
    return [p[0], (hit ? hit.point.y : 0.03) + 0.004, p[1]];
  };
  const verts: number[] = [];
  const cols: number[] = [];
  const tri = (a: P2, b: P2, c: P2, col: THREE.Color) => {
    // wind counter-clockwise seen from above (+y normal)
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const pts = cross < 0 ? [a, b, c] : [a, c, b];
    for (const p of pts) {
      verts.push(...drape(p));
      cols.push(col.r, col.g, col.b);
    }
  };
  const finish = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return g;
  };

  if (!male) {
    // an open ring: dark edge, pale blue band, dark edge (the shell shows through the middle)
    const cz = -0.006;
    const radii: [number, number, THREE.Color][] = [
      [0.08, 0.069, MARK_EDGE],
      [0.069, 0.047, MARK_FEMALE],
      [0.047, 0.039, MARK_EDGE],
    ];
    const n = 28;
    const at = (r: number, i: number): P2 => {
      const a = (i / n) * Math.PI * 2;
      return [Math.sin(a) * r, Math.cos(a) * r + cz];
    };
    for (const [r0, r1, col] of radii)
      for (let i = 0; i < n; i++) {
        tri(at(r0, i), at(r0, i + 1), at(r1, i), col);
        tri(at(r0, i + 1), at(r1, i + 1), at(r1, i), col);
      }
    return finish();
  }

  // chevron (an arrowhead pointing at the tail): 19 cm across the front (70% of the shell), 14 cm long
  let outline: P2[];
  let kernel: P2;
  {
    const zf = 0.062,
      L = 0.14,
      hw = 0.096,
      notch = 0.03;
    // slightly convex flanks fatten the arms of the V
    outline = [
      [0, zf - L],
      [hw * 0.55 + 0.007, zf - L * 0.45 - 0.002],
      [hw, zf],
      [hw * 0.5, zf + 0.003],
      [0, zf - notch],
      [-hw * 0.5, zf + 0.003],
      [-hw, zf],
      [-hw * 0.55 - 0.007, zf - L * 0.45 - 0.002],
    ];
    kernel = [0, -0.012];
  }
  const outer = densify(outline, 0.012);
  // the inner loop: the same points pushed 1.2 cm in (keeps the point count, so the ring is a strip)
  const innerAll = insetPoly(outline, 0.012, kernel);
  const inner: P2[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = innerAll[i],
      b = innerAll[(i + 1) % outline.length];
    const oa = outline[i],
      ob = outline[(i + 1) % outline.length];
    const k = Math.max(1, Math.ceil(Math.hypot(ob[0] - oa[0], ob[1] - oa[1]) / 0.012));
    for (let j = 0; j < k; j++) inner.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }

  const fill = MARK_KEEP;
  const edge = MARK_EDGE;
  // outline strip
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(outer[i], outer[j], inner[i], edge);
    tri(outer[j], inner[j], inner[i], edge);
  }
  // fill: rings shrinking toward the kernel (the shapes are star-shaped around it)
  const rings = 3;
  const ring = (k: number) => inner.map((p): P2 => [p[0] + (kernel[0] - p[0]) * (k / rings), p[1] + (kernel[1] - p[1]) * (k / rings)]);
  for (let k = 0; k < rings; k++) {
    const r0 = ring(k),
      r1 = ring(k + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (k === rings - 1) tri(r0[i], r0[j], kernel, fill);
      else {
        tri(r0[i], r0[j], r1[i], fill);
        tri(r0[j], r1[j], r1[i], fill);
      }
    }
  }
  return finish();
}

export const SPECIES_COLOR: Record<string, number> = {
  red: 0xc8432f,
  blue: 0x3f6fa8,
  snow: 0xd8875a,
  golden: 0xf2c230,
};

/** Glossy shell material for crab bodies (white base: tinted by instance or material colour). */
export function crabMaterial(color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.3, metalness: 0 });
}
/**
 * The apron marker (its colours are in the vertex colours); offset so it never z-fights the shell.
 * Instanced, an undersize male's yellow chevron turns grey: the instance's scale is the crab's
 * size, and undersize males are well below keepers (the landing squash keeps the volume under it).
 */
export function crabFlapMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <color_vertex>',
      `#include <color_vertex>
      #if defined( USE_INSTANCING ) && defined( USE_COLOR )
        // the yellow keeper fill only (not the outline, not the female's blue)
        if (color.r > color.b + 0.3 && pow(abs(determinant(mat3(instanceMatrix))), 1.0 / 3.0) < ${SMALL_SCALE.toFixed(2)})
          vColor.rgb = vec3(${MARK_SMALL.r.toFixed(4)}, ${MARK_SMALL.g.toFixed(4)}, ${MARK_SMALL.b.toFixed(4)});
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'crabFlap';
  return m;
}

const kindMats = new Map<string, THREE.MeshStandardMaterial>();
const geoCache = new Map<string, THREE.BufferGeometry>();
let flapMat: THREE.MeshStandardMaterial | null = null;

/** Non-instanced crab (harbor scale, galley, previews). */
export function makeCrab(kind: string, sex: CrabSex = 'm', scale = 1): THREE.Group {
  const g = new THREE.Group();
  let mat = kindMats.get(kind);
  if (!mat) {
    mat = crabMaterial(SPECIES_COLOR[kind] ?? 0xc8432f);
    if (kind === 'golden') {
      mat.metalness = 0.55;
      mat.roughness = 0.22;
      mat.emissive.setHex(0x5a3a00);
      mat.emissiveIntensity = 0.5;
    }
    kindMats.set(kind, mat);
  }
  let bodyGeo = geoCache.get(`b${sex}`);
  if (!bodyGeo) geoCache.set(`b${sex}`, (bodyGeo = crabBodyGeometry(sex)));
  let flapGeo = geoCache.get(`f${sex}`);
  if (!flapGeo) geoCache.set(`f${sex}`, (flapGeo = crabFlapGeometry(sex)));
  const body = new THREE.Mesh(bodyGeo, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const flap = new THREE.Mesh(flapGeo, (flapMat ??= crabFlapMaterial()));
  g.add(flap);
  g.scale.setScalar(scale);
  return g;
}
