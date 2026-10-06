/**
 * Crab art. Instanced in-game: one geometry per sex (shell + legs + claws, tinted per instance by
 * species) plus a cream "apron" marker geometry. The sorting rule is visual:
 *   KEEP  = wide body + narrow V-shaped flap (male, big)
 *   THROW = rounder body + broad round flap (female) or a small crab.
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

/** Body geometry (width along X, claws toward +Z). Origin = body centre. ~0.45 m leg span for a big male. */
export function crabBodyGeometry(sex: CrabSex): THREE.BufferGeometry {
  const male = sex === 'm';
  const sx = male ? 1.25 : 1.02;
  const sz = male ? 0.85 : 0.93;
  const R = 0.11;
  const H = 0.43;
  const parts: THREE.BufferGeometry[] = [];

  // carapace: a flattened dome with knobbly tubercles and darker spots
  const shell = new THREE.SphereGeometry(R, 22, 11);
  {
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
  }
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

/** The apron marker drawn on top so it reads from the overhead camera, hugging the shell. */
export function crabFlapGeometry(sex: CrabSex): THREE.BufferGeometry {
  const male = sex === 'm';
  const sx = male ? 1.25 : 1.02;
  const sz = male ? 0.85 : 0.93;
  // outline in xz: rows from front (+z) to back, each with a half width
  const rows: [number, number][] = [];
  if (male) {
    // narrow V, point toward the back
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      rows.push([0.055 - t * 0.115, 0.03 * (1 - t) + 0.002]);
    }
  } else {
    // broad round flap
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      rows.push([Math.cos(a) * 0.075 - 0.005, Math.max(0.002, Math.sin(a) * 0.075)]);
    }
  }
  const verts: number[] = [];
  const cols: number[] = [];
  // dome height of the shell at (x, z), plus a hair so the flap sits just on top
  const shellY = (x: number, z: number) => {
    const d = (x / (0.11 * sx)) ** 2 + (z / (0.11 * sz)) ** 2;
    return 0.11 * 0.43 * Math.sqrt(Math.max(0, 1 - d)) + 0.012;
  };
  const cross = [-1, -0.7, 0, 0.7, 1];
  const shade = [0.72, 1, 1, 1, 0.72];
  const pt = (r: number, j: number) => {
    const [z, w] = rows[r];
    const x = cross[j] * w;
    return [x, shellY(x, z), z];
  };
  for (let r = 0; r < rows.length - 1; r++)
    for (let j = 0; j < cross.length - 1; j++) {
      const a = pt(r, j),
        b = pt(r, j + 1),
        c = pt(r + 1, j),
        d = pt(r + 1, j + 1);
      const ca = shade[j],
        cb = shade[j + 1];
      // two triangles, wound to face up
      verts.push(...a, ...b, ...c, ...b, ...d, ...c);
      cols.push(ca, ca, ca, cb, cb, cb, ca, ca, ca, cb, cb, cb, cb, cb, cb, ca, ca, ca);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
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
/** The cream apron marker. */
export function crabFlapMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xf6e7c8, vertexColors: true, roughness: 0.5, metalness: 0 });
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
