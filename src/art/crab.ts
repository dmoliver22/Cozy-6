/**
 * Crab art. Instanced in-game: one geometry per sex (body+legs+claws, tinted per instance by species)
 * plus a cream "apron" marker geometry. The sorting rule is visual:
 *   KEEP  = wide body + narrow V-shaped flap (male, big)
 *   THROW = rounder body + broad round flap (female) or a small crab.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, toonUnique } from './materials';

export type CrabSex = 'm' | 'f';

function leg(side: number, i: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.2, 0.025, 0.03);
  g.translate(0.1, 0, 0);
  g.rotateZ(-0.55);
  const m = new THREE.Matrix4();
  const ang = (i - 1.5) * 0.38;
  m.makeRotationY(side > 0 ? -ang : Math.PI + ang);
  g.applyMatrix4(m);
  g.translate(side * 0.09, -0.005, (i - 1.5) * 0.045);
  return g;
}

/** Body geometry (width along X). Origin = body centre. ~0.42 m leg span for a big male. */
export function crabBodyGeometry(sex: CrabSex): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shell = new THREE.SphereGeometry(0.11, 12, 8);
  shell.scale(sex === 'm' ? 1.25 : 1.0, 0.45, sex === 'm' ? 0.85 : 0.95);
  parts.push(shell);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(leg(s, i));
  // claws
  for (const s of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.035, 0.03, 0.12);
    arm.rotateY(s * 0.5);
    arm.translate(s * 0.08, 0.0, 0.12);
    parts.push(arm);
    const claw = new THREE.SphereGeometry(0.045, 8, 6);
    claw.scale(0.8, 0.7, 1.3);
    claw.translate(s * 0.11, 0.01, 0.2);
    parts.push(claw);
  }
  // eye stalks
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.014, 6, 4);
    e.translate(s * 0.03, 0.05, 0.1);
    parts.push(e);
  }
  // strip non-shared attributes so merging works
  const cleaned = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k);
    return q;
  });
  const merged = mergeGeometries(cleaned)!;
  merged.computeVertexNormals();
  return merged;
}

/** The apron marker drawn on top so it reads from the overhead camera. */
export function crabFlapGeometry(sex: CrabSex): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (sex === 'm') {
    // narrow V
    const s = new THREE.Shape();
    s.moveTo(-0.028, 0.055);
    s.lineTo(0.028, 0.055);
    s.lineTo(0.0, -0.06);
    s.closePath();
    g = new THREE.ShapeGeometry(s);
  } else {
    g = new THREE.CircleGeometry(0.075, 14);
  }
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.052, -0.005);
  return g;
}

export const SPECIES_COLOR: Record<string, number> = {
  red: 0xc8432f,
  blue: 0x3f6fa8,
  snow: 0xd8875a,
  golden: 0xf2c230,
};

/** Non-instanced crab (harbor scale, galley, previews). */
export function makeCrab(kind: string, sex: CrabSex = 'm', scale = 1): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(crabBodyGeometry(sex), kind === 'golden' ? toonUnique(SPECIES_COLOR.golden, { emissive: 0x6a4a00 }) : toon(SPECIES_COLOR[kind] ?? 0xc8432f));
  body.castShadow = true;
  g.add(body);
  const flap = new THREE.Mesh(crabFlapGeometry(sex), toon(0xf3e2c4));
  g.add(flap);
  g.scale.setScalar(scale);
  return g;
}
