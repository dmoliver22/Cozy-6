/**
 * The Puffin's deck plan in boat-local coordinates (metres).
 * +Z = bow, +X = port, −X = starboard, deck surface at y = 0, waterline at y = −freeboard.
 * Both the art (art/boat.ts) and the physics (deck/structure.ts) read from here.
 */
import * as THREE from 'three';
import { config } from '../config';

export const STERN_Z = -9.5;
export const BOW_Z = 10.5;
export const HALF_BEAM = config.boat.beam / 2; // 3.2
export const BULWARK_T = 0.15;

/** Half width of the hull (outer) at station z. */
export function hullHalfWidth(z: number): number {
  if (z <= STERN_Z) return 2.85;
  if (z < -8) return 2.85 + (HALF_BEAM - 2.85) * Math.sin(((z - STERN_Z) / 1.5) * Math.PI * 0.5);
  if (z <= 4) return HALF_BEAM;
  if (z >= BOW_Z) return 0;
  const t = (z - 4) / (BOW_Z - 4);
  return HALF_BEAM * Math.pow(Math.max(0, 1 - t * t), 0.6);
}

/** Rail (bulwark top) height above the deck at station z — rises toward the bow (sheer). */
export function railHeight(z: number): number {
  const t = THREE.MathUtils.smoothstep(z, 3, BOW_Z);
  return config.deck.railHeight + 0.55 * t;
}

/** Hull plan outline (port side then starboard), useful for colliders and art. */
export function hullOutline(n = 28): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const z = STERN_Z + ((BOW_Z - STERN_Z) * i) / n;
    pts.push(new THREE.Vector2(hullHalfWidth(z), z));
  }
  for (let i = n - 1; i >= 0; i--) {
    const z = STERN_Z + ((BOW_Z - STERN_Z) * i) / n;
    pts.push(new THREE.Vector2(-hullHalfWidth(z), z));
  }
  return pts;
}

export const HOUSE = {
  x0: -1.9,
  x1: 1.9,
  z0: 3.2, // aft wall
  z1: 7.6, // front wall
  wallH: 2.3,
  roofY: 2.42,
  wallT: 0.12,
  doorHalf: 0.6,
  doorH: 2.0,
};

export const L = {
  // Sea-facing working gear (starboard side)
  cradle: { center: new THREE.Vector3(-2.1, 1.0, 1.1), half: new THREE.Vector3(1.0, 0.06, 1.0) },
  potOnCradle: new THREE.Vector3(-2.1, 1.0 + 0.45 + 0.06, 1.1),
  launcherLever: new THREE.Vector3(-1.05, 0.95, -0.15),
  launcherSpot: new THREE.Vector3(-1.25, 0, -0.75),
  davitBase: new THREE.Vector3(-2.95, 0, 2.6),
  davitTop: new THREE.Vector3(-2.95, 4.3, 2.6),
  block: new THREE.Vector3(-3.75, 4.05, 1.1),
  haulerLever: new THREE.Vector3(-2.6, 1.05, 2.6),
  haulerSpot: new THREE.Vector3(-2.25, 0, 2.75),
  table: { center: new THREE.Vector3(-0.05, 0.9, 1.0), half: new THREE.Vector3(0.95, 0.05, 1.1) },
  tableSpot: new THREE.Vector3(0.3, 0, -0.55),
  hatch: { center: new THREE.Vector3(0.7, 0, -2.0), half: 0.55, coaming: 0.26 },
  crate: { center: new THREE.Vector3(1.95, 0, 2.45), half: new THREE.Vector3(0.45, 0.32, 0.35) },
  baitBox: { center: new THREE.Vector3(-2.45, 0, -1.5), half: new THREE.Vector3(0.42, 0.3, 0.32) },
  buoyPile: new THREE.Vector3(2.45, 0, 0.3),
  engineHatch: { center: new THREE.Vector3(1.75, 0.06, -3.55), half: 0.45 },
  coilSpot: new THREE.Vector3(2.3, 0, -4.0),
  stackRows: [-5.45, -7.6],
  stackCols: [-1.95, 0, 1.95],
  stackTierY: [0.45, 1.36],
  // Tool wall on the house aft face
  ringHook: new THREE.Vector3(-1.3, 1.45, HOUSE.z0 - 0.12),
  malletHook: new THREE.Vector3(1.3, 1.15, HOUSE.z0 - 0.1),
  grappleHook: new THREE.Vector3(-1.98, 1.25, 3.9),
  // Inside the house
  wheel: new THREE.Vector3(0, 1.15, 7.15),
  helmSpot: new THREE.Vector3(0, 0, 6.6),
  stove: { center: new THREE.Vector3(1.4, 0, 3.75), half: new THREE.Vector3(0.38, 0.45, 0.32) },
  galleyTable: { center: new THREE.Vector3(-1.25, 0, 4.9), half: new THREE.Vector3(0.45, 0.38, 0.7) },
  hatHook: new THREE.Vector3(-1.75, 1.75, 3.45),
  mast: new THREE.Vector3(1.25, 0, 2.75),
  // Spawn points
  spawn: {
    player: new THREE.Vector3(-1.4, 0, -1.6),
    dot: new THREE.Vector3(1.6, 0, -0.4),
    ike: new THREE.Vector3(-2.0, 0, -3.0),
    mo: new THREE.Vector3(0, 0, 6.6),
    cat: new THREE.Vector3(1.6, 0, -3.2),
  },
  buckets: [new THREE.Vector3(1.0, 0, -0.9), new THREE.Vector3(-0.6, 0, -3.6)],
};

/** Brace anchors: line segments the crew can grab (rails, handholds). */
export interface BraceSegment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  name: string;
}

export function braceSegments(): BraceSegment[] {
  const segs: BraceSegment[] = [];
  const add = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, name: string) =>
    segs.push({ a: new THREE.Vector3(ax, ay, az), b: new THREE.Vector3(bx, by, bz), name });
  const inner = HALF_BEAM - BULWARK_T - 0.02;
  // Port rail along the working deck, then along the house walkway
  add(inner, 1.0, -4.4, inner, 1.0, 3.2, 'port rail');
  for (let z = 3.2; z < 7.6; z += 1.1) {
    add(hullHalfWidth(z) - BULWARK_T, railHeight(z), z, hullHalfWidth(z + 1.1) - BULWARK_T, railHeight(z + 1.1), z + 1.1, 'port rail fwd');
    add(-(hullHalfWidth(z) - BULWARK_T), railHeight(z), z, -(hullHalfWidth(z + 1.1) - BULWARK_T), railHeight(z + 1.1), z + 1.1, 'stbd rail fwd');
  }
  // Starboard rail, split around the launcher cradle
  add(-inner, 1.0, -4.4, -inner, 1.0, 0.0, 'starboard rail');
  add(-inner, 1.0, 2.2, -inner, 1.0, 3.2, 'starboard rail');
  // House aft handrails (either side of the door)
  add(HOUSE.x0 + 0.1, 1.2, HOUSE.z0 - 0.08, -HOUSE.doorHalf - 0.1, 1.2, HOUSE.z0 - 0.08, 'house rail');
  add(HOUSE.doorHalf + 0.1, 1.2, HOUSE.z0 - 0.08, HOUSE.x1 - 0.1, 1.2, HOUSE.z0 - 0.08, 'house rail');
  // House side handrails
  add(HOUSE.x1 + 0.06, 1.15, HOUSE.z0 + 0.2, HOUSE.x1 + 0.06, 1.15, HOUSE.z1 - 0.2, 'house side');
  add(HOUSE.x0 - 0.06, 1.15, HOUSE.z0 + 0.2, HOUSE.x0 - 0.06, 1.15, HOUSE.z1 - 0.2, 'house side');
  // Sorting table edges
  const t = L.table;
  add(t.center.x - t.half.x, 0.92, t.center.z - t.half.z, t.center.x + t.half.x, 0.92, t.center.z - t.half.z, 'table');
  add(t.center.x + t.half.x, 0.92, t.center.z - t.half.z, t.center.x + t.half.x, 0.92, t.center.z + t.half.z, 'table');
  // Davit post (vertical)
  add(L.davitBase.x, 0.6, L.davitBase.z, L.davitBase.x, 1.6, L.davitBase.z, 'davit');
  // Lashed pot stack face
  add(-2.8, 0.88, -4.45, 2.8, 0.88, -4.45, 'stack');
  // Inside: helm console and galley table
  add(-0.9, 1.0, 7.35, 0.9, 1.0, 7.35, 'helm');
  add(-0.85, 0.78, 4.15, -0.85, 0.78, 5.6, 'galley table');
  return segs;
}

/** Is a local point inside the wheelhouse footprint? */
export function insideHouse(p: THREE.Vector3): boolean {
  return p.x > HOUSE.x0 + 0.05 && p.x < HOUSE.x1 - 0.05 && p.z > HOUSE.z0 + 0.05 && p.z < HOUSE.z1 - 0.05 && p.y < HOUSE.roofY;
}

/** Ice / friction zones (6): index = row*2 + side, row 0 aft, 1 mid, 2 fore; side 0 port, 1 starboard. */
export function iceZoneOf(x: number, z: number): number {
  const row = z < -3.2 ? 0 : z < 3.0 ? 1 : 2;
  const side = x >= 0 ? 0 : 1;
  return row * 2 + side;
}
export const ICE_ZONE_ROWS: [number, number][] = [
  [STERN_Z, -3.2],
  [-3.2, 3.0],
  [3.0, BOW_Z],
];
