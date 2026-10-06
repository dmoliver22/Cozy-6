/**
 * makeBoat(): the Puffin, a chunky toy-diorama crabber built from code geometry.
 *
 * Varnished honey-teak plank hull (HULL_FINISH in props.ts; the older red paint is kept as an
 * option) with a narrow red-orange sheer stripe, a varnished cap rail, rub rail and a dark
 * boot-top; a clapboard wheelhouse with framed, warmly lit windows, a cluttered roof, mast, crane
 * and rigging; working gear in galvanised steel, teal machinery paint and orange; and the clutter
 * that makes a working boat (tyre fenders, hanging buoys, crates, barrels, nets, rope coils).
 *
 * Static art is folded with mergeStatic() into one mesh per material. Moving parts live in
 * groups named "dyn:*"; the dollhouse cutaway parts (upper walls, roof and everything on it) are
 * merged separately and handed to the game through `cutaway` / `cutawayMats`.
 *
 * Decor has no colliders, so it only sits where nothing walks or slides: outside the bulwarks,
 * on the wheelhouse roof and walls, tucked into the bow and behind the pot stack at the stern.
 *
 * On the Low tier (phones) round clutter uses half the segments, the inner-bulwark stanchions are
 * flat painted strips, and the bunting and whip antennas are skipped (none of it shows from the
 * overhead camera).
 */
import * as THREE from 'three';
import { config } from '../config';
import { HOUSE, L, STERN_Z, BOW_Z, hullHalfWidth, railHeight, BULWARK_T } from '../boat/layout';
import { paint, wood, canvasTexture, mergeStatic, line3 } from './materials';
import {
  C,
  cbox,
  tube,
  tubeX,
  tubeZ,
  ring,
  ball,
  bar,
  sweep,
  rectProfile,
  fadeCopy,
  K,
  pal,
  brightCopy,
  hullPaint,
  letterPlane,
  LETTERS,
  tyreFender,
  buoyBunch,
  buoyOnDeck,
  fishCrate,
  barrel,
  ropeCoil,
  hangingCoil,
  netPile,
  netDrape,
  cleat,
  bitts,
  extinguisher,
  boathook,
  liferaft,
  radarDome,
  radarScanner,
  sidelight,
  floodlight,
  searchlight,
  horn,
  anchor,
  windlass,
  chain,
  flagMat,
  flagGeo,
  buntingMat,
  buntingGeo,
  gull,
  aoBlob,
  aoEdge,
  isLowTier,
  setLowDetail,
  sortTableTopMat,
  stovePipeMat,
  windowGlassMat,
  hazardStrip,
  rustStreakMat,
} from './props';

export interface BoatArt {
  root: THREE.Group;
  /** Parts that fade for the dollhouse cutaway. */
  cutaway: THREE.Mesh[];
  cutawayMats: THREE.MeshStandardMaterial[];
  cradle: THREE.Group; // tilts to launch/tip
  launcherLever: THREE.Object3D;
  haulerLever: THREE.Object3D;
  haulerDrum: THREE.Object3D;
  block: THREE.Object3D;
  wheel: THREE.Object3D;
  craneBoom: THREE.Group;
  craneHook: THREE.Object3D;
  stoveGlow: THREE.PointLight | null;
  windowMat: THREE.MeshStandardMaterial;
  spiritLevel: { group: THREE.Group; bubble: THREE.Mesh; window: THREE.Mesh };
  hatchLid: THREE.Object3D;
}

const WL = -config.boat.freeboard;
const { smoothstep, lerp } = THREE.MathUtils;

// ---------------------------------------------------------------------------------------------
// hull

/** [fraction of the deck half-width, fraction of the depth to the keel] from the deck down. */
const SECTION: [number, number][] = [
  [1.0, 0],
  [0.997, 0.14],
  [0.988, 0.3],
  [0.968, 0.44],
  [0.93, 0.56],
  [0.86, 0.67],
  [0.74, 0.77],
  [0.56, 0.86],
  [0.34, 0.93],
  [0.14, 0.98],
  [0.04, 1],
];

function keelAt(z: number): number {
  const bowT = smoothstep(z, 3, BOW_Z);
  return lerp(-2.7, -0.95, Math.pow(bowT, 1.5));
}

function sectionPoint(i: number, z: number, hw: number): [number, number] {
  const [xf, t] = SECTION[i];
  // forward sections sharpen into a V
  const bowT = Math.pow(smoothstep(z, 4, BOW_Z), 1.4) * 0.85;
  const f = lerp(xf, Math.pow(1 - t, 1.1), bowT);
  return [f * hw, t * keelAt(z)];
}

function hullStations(n: number): number[] {
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const e = s * (1.3 - 0.3 * s); // a little denser toward the bow
    zs.push(STERN_Z + (BOW_Z - STERN_Z) * e);
  }
  return zs;
}

/** The hull shell: uv u = metres along the boat, v = metres of girth below the gunwale. */
function hullGeometry(stations = 44): THREE.BufferGeometry {
  const zs = hullStations(stations);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ns = SECTION.length;
  let rn = 0;
  for (const z of zs) {
    const hw = Math.max(0.03, hullHalfWidth(z));
    const top = railHeight(z) + 0.02;
    // half ring: gunwale top, then the section down to the keel
    const half: [number, number][] = [[hw, top]];
    for (let i = 0; i < ns; i++) half.push(sectionPoint(i, z, hw));
    const girth: number[] = [0];
    for (let i = 1; i < half.length; i++) girth.push(girth[i - 1] + Math.hypot(half[i][0] - half[i - 1][0], half[i][1] - half[i - 1][1]));
    const ringPts: [number, number, number][] = [];
    for (let i = 0; i < half.length; i++) ringPts.push([half[i][0], half[i][1], girth[i]]);
    for (let i = half.length - 2; i >= 0; i--) ringPts.push([-half[i][0], half[i][1], girth[i]]);
    rn = ringPts.length;
    for (const [x, y, g] of ringPts) {
      pos.push(x, y, z);
      uv.push(z, g);
    }
  }
  for (let i = 0; i < zs.length - 1; i++)
    for (let j = 0; j < rn - 1; j++) {
      const a = i * rn + j,
        b = a + 1,
        c = a + rn,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat transom face (facing aft) from the stern station outline. */
function transomGeometry(): THREE.BufferGeometry {
  const z = STERN_Z;
  const hw = hullHalfWidth(z);
  const top = railHeight(z) + 0.02;
  const half: [number, number][] = [[hw, top]];
  for (let i = 0; i < SECTION.length; i++) half.push(sectionPoint(i, z, hw));
  const shape = new THREE.Shape();
  shape.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) shape.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 2; i >= 0; i--) shape.lineTo(-half[i][0], half[i][1]);
  const g = new THREE.ShapeGeometry(shape, 4);
  // uv: metres across × metres below the gunwale (for the sheer stripe in the hull shader)
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), top - p.getY(i));
  g.rotateY(Math.PI);
  g.translate(0, 0, z - 0.004);
  return g;
}

export function deckGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const z = STERN_Z + ((BOW_Z - STERN_Z) * i) / n;
    const x = hullHalfWidth(z) - 0.02;
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  for (let i = n; i >= 0; i--) {
    const z = STERN_Z + ((BOW_Z - STERN_Z) * i) / n;
    shape.lineTo(-(hullHalfWidth(z) - 0.02), -z);
  }
  const g = new THREE.ShapeGeometry(shape);
  // rotateX(−90°): (x, y, 0) → (x, 0, −y) with the face normal pointing +Y, so shape y = −z.
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A closed loop around the hull plan at lateral offset `off` from the outer skin (− = inboard). */
function hullLoop(off: number, y: (z: number) => number, n = 40, sternInset = 0): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const z0 = STERN_Z + sternInset;
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    zs.push(z0 + (BOW_Z - 0.02 - z0) * (s * (1.3 - 0.3 * s)));
  }
  // stop where the two sides would meet, then close across the bow
  const usable = zs.filter((z) => hullHalfWidth(z) + off > 0.06);
  for (const z of usable) pts.push(new THREE.Vector3(hullHalfWidth(z) + off, y(z), z));
  const tipZ = usable[usable.length - 1];
  const tip = new THREE.Vector3(0, y(tipZ), tipZ + Math.max(0.04, (hullHalfWidth(tipZ) + off) * 0.6));
  pts.push(tip);
  for (let i = usable.length - 1; i >= 0; i--) {
    const z = usable[i];
    pts.push(new THREE.Vector3(-(hullHalfWidth(z) + off), y(z), z));
  }
  // across the transom
  const sx = hullHalfWidth(z0) + off;
  for (let k = 1; k < 4; k++) pts.push(new THREE.Vector3(-sx + (2 * sx * k) / 4, y(z0), z0 - (sternInset > 0 ? 0 : 0.0)));
  return pts;
}

/** A vertical strip along one side at x = side·(hw − inset), from the deck to the rail top. */
function bulwarkInnerGeometry(side: 1 | -1, stations = 44): THREE.BufferGeometry {
  const inset = BULWARK_T;
  const zs = hullStations(stations).filter((z) => hullHalfWidth(z) - inset > 0.02);
  zs[0] = STERN_Z + inset;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const z of zs) {
    const x = side * (hullHalfWidth(z) - inset);
    pos.push(x, 0, z, x, railHeight(z) + 0.01, z);
  }
  for (let i = 0; i < zs.length - 1; i++) {
    const a = i * 2;
    // face inboard
    if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

function meshOf(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true, recv = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = recv;
  return m;
}

/** Yaw that turns a +z-facing plane to face outward from the hull side at station z. */
function sideYaw(side: 1 | -1, z: number): number {
  const d = (hullHalfWidth(z + 0.05) - hullHalfWidth(z - 0.05)) / 0.1;
  return Math.atan2(side, -d * side * side);
}

// ---------------------------------------------------------------------------------------------

export function makeBoat(): BoatArt {
  const low = isLowTier();
  setLowDetail(low);
  try {
    return buildBoat(low);
  } finally {
    setLowDetail(false);
  }
}

function buildBoat(low: boolean): BoatArt {
  const root = new THREE.Group();
  root.name = 'Puffin';

  // ---- materials (cached library materials; folded per material by mergeStatic)
  const M = {
    hull: hullPaint(WL),
    deck: K.deck(),
    varnish: K.varnish(),
    darkWood: K.darkWood(),
    wall: brightCopy(wood(0xffffff, { plankWidth: 0.16, along: 'x', weathered: false, rough: 0.6 }), 1.36, 1.25, 1.03),
    roof: wood(C.roofWood, { plankWidth: 0.14, along: 'z', weathered: true }),
    gear: K.gear(),
    machine: K.machine(),
    baitPaint: paint(0x3f8fa8, { rough: 0.55, wear: 1 }),
    cream: K.cream(),
    steel: K.steel(),
    iron: K.iron(),
    brass: K.brass(),
    manila: K.manila(),
    rubber: K.rubber(),
    rigging: K.rigging(),
    navy: K.navy(),
    galv: K.galv(),
  };

  // =============================================================================================
  // HULL
  const stations = low ? 30 : 44;
  root.add(meshOf(hullGeometry(stations), M.hull));
  root.add(meshOf(transomGeometry(), M.hull));
  // varnished cap rail on the bulwark (wraps around the stern)
  const capPath = hullLoop(-BULWARK_T / 2, (z) => railHeight(z) + 0.045, low ? 32 : 46, 0.075);
  root.add(meshOf(sweep(capPath, rectProfile(0.235, 0.09, 0.03, -0.0325), true), M.varnish));
  // rub rail (wale) along the sheer at deck level
  const rubY = (z: number) => -0.04 + 0.33 * smoothstep(z, 3, BOW_Z);
  root.add(meshOf(sweep(hullLoop(0.0, rubY, low ? 32 : 46, 0), rectProfile(0.13, 0.17, 0.055, -0.055), true), M.darkWood));
  // stem band at the bow
  const stemTop = railHeight(BOW_Z - 0.05) + 0.08;
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(stemTop, keelAt(BOW_Z) + 0.1, i / 8);
      pts.push(new THREE.Vector3(0, y, BOW_Z + 0.035 - Math.pow(i / 8, 2) * 0.35));
    }
    const stem = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.055, 6, false);
    root.add(meshOf(stem, M.brass));
  }
  // names: transom and both bows
  {
    const t = letterPlane(LETTERS.transom, 2.7, 0.675);
    t.position.set(0, 0.35, STERN_Z - 0.02);
    t.rotation.y = Math.PI;
    root.add(t);
    for (const side of [1, -1] as const) {
      const zN = 5.9;
      const n = letterPlane(LETTERS.bow, 2.7, 0.45);
      n.position.set(side * (hullHalfWidth(zN) + 0.012), 0.62, zN);
      n.rotation.y = sideYaw(side, zN);
      root.add(n);
      const zR = 8.7;
      const r = letterPlane(LETTERS.reg, 0.62, 0.31);
      r.position.set(side * (hullHalfWidth(zR) + 0.014), 0.72 + 0.1, zR);
      r.rotation.y = sideYaw(side, zR);
      root.add(r);
    }
  }
  // scuppers: small dark slots above the rub rail, each weeping a rust streak down the topsides
  {
    const rust = rustStreakMat();
    for (const side of [1, -1] as const) {
      for (let z = -8; z < 3; z += 2.2) {
        const hw = hullHalfWidth(z);
        const s = cbox(0.04, 0.07, 0.24, M.iron, 0, side * (hw + 0.004), 0.14, z);
        s.castShadow = false;
        root.add(s);
        const si = cbox(0.03, 0.07, 0.24, M.iron, 0, side * (hw - BULWARK_T - 0.004), 0.055, z);
        si.castShadow = false;
        root.add(si);
        for (const [y0, y1, w] of [
          [0.11, 0.05, 0.12],
          [-0.13, -0.78, 0.16],
        ]) {
          const st = new THREE.Mesh(new THREE.PlaneGeometry(w, y0 - y1), rust);
          st.position.set(side * (hw + 0.012), (y0 + y1) / 2, z);
          st.rotation.y = sideYaw(side, z);
          st.renderOrder = 1;
          root.add(st);
        }
      }
    }
  }

  // =============================================================================================
  // DECK, BULWARKS
  const deck = meshOf(deckGeometry(), M.deck, false, true);
  deck.position.y = 0.001;
  root.add(deck);
  root.add(meshOf(bulwarkInnerGeometry(1, stations), M.deck, false, true));
  root.add(meshOf(bulwarkInnerGeometry(-1, stations), M.deck, false, true));
  const sternHw = hullHalfWidth(STERN_Z + BULWARK_T);
  root.add(cbox(2 * (sternHw - BULWARK_T) + 0.04, 1.0, 0.05, M.deck, 0.01, 0, 0.5, STERN_Z + BULWARK_T - 0.02));
  // stanchions (frames) on the inner bulwark; on Low they are flat painted strips
  for (const side of [1, -1] as const) {
    for (let z = -8.7; z < 9.6; z += 1.3) {
      const hw = hullHalfWidth(z);
      if (hw < 1.0) continue;
      const h = railHeight(z);
      if (low) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.1, h), M.varnish);
        s.position.set(side * (hw - BULWARK_T - 0.006), h / 2, z);
        s.rotation.y = sideYaw(side, z) + Math.PI;
        s.receiveShadow = true;
        root.add(s);
      } else {
        const s = cbox(0.07, h, 0.1, M.varnish, 0.022, side * (hw - BULWARK_T - 0.032), h / 2, z);
        s.rotation.y = sideYaw(side, z);
        s.castShadow = false;
        root.add(s);
      }
    }
  }
  // cleats on the cap rail
  for (const side of [1, -1] as const) {
    for (const z of [-8.3, -4.6, 3.4, 7.2]) {
      const cl = cleat(0.24);
      cl.position.set(side * (hullHalfWidth(z) - BULWARK_T / 2), railHeight(z) + 0.09, z);
      root.add(cl);
    }
  }
  for (const x of [-2.0, 2.0]) {
    const cl = cleat(0.24);
    cl.rotation.y = Math.PI / 2;
    cl.position.set(x, 1.09, STERN_Z + 0.075);
    root.add(cl);
  }

  // =============================================================================================
  // WHEELHOUSE (lower walls solid; upper walls, roof and roof gear fade for the dollhouse)
  const H = HOUSE;
  const upper = new THREE.Group();
  upper.name = 'dyn:upper';
  root.add(upper);
  const upperMat = fadeCopy(M.wall);
  const roofMat = fadeCopy(M.roof);
  const trimMat = fadeCopy(M.varnish);
  const fasciaMat = fadeCopy(paint(C.fascia, { rough: 0.55 }));
  const cutawayMats: THREE.MeshStandardMaterial[] = [upperMat, roofMat, trimMat, fasciaMat];
  const windowMat = windowGlassMat();
  const lowerH = 1.05;
  const W = H.x1 - H.x0;
  const D = H.z1 - H.z0;
  const zc = (H.z0 + H.z1) / 2;
  const t = H.wallT;
  const aftW = -H.doorHalf - H.x0; // width of each aft wall piece
  // walls: cream clapboard outside, varnished panelling inside (lower part)
  const wallSet = (y0: number, y1: number, outer: THREE.Material, inner: THREE.Material | null, into: THREE.Object3D) => {
    const h = y1 - y0,
      y = (y0 + y1) / 2;
    const to = inner ? t * 0.6 : t;
    const ti = t - to;
    const add = (m: THREE.Mesh) => into.add(m);
    // front
    add(cbox(W, h, to, outer, 0.012, 0, y, H.z1 - to / 2));
    // sides
    add(cbox(to, h, D, outer, 0.012, H.x0 + to / 2, y, zc));
    add(cbox(to, h, D, outer, 0.012, H.x1 - to / 2, y, zc));
    // aft either side of the door
    add(cbox(aftW, h, to, outer, 0.012, (H.x0 - H.doorHalf) / 2, y, H.z0 + to / 2));
    add(cbox(aftW, h, to, outer, 0.012, (H.x1 + H.doorHalf) / 2, y, H.z0 + to / 2));
    if (inner) {
      add(cbox(W - 2 * to, h, ti, inner, 0.005, 0, y, H.z1 - to - ti / 2));
      add(cbox(ti, h, D - 2 * to, inner, 0.005, H.x0 + to + ti / 2, y, zc));
      add(cbox(ti, h, D - 2 * to, inner, 0.005, H.x1 - to - ti / 2, y, zc));
      add(cbox(aftW - to, h, ti, inner, 0.005, (H.x0 + to - H.doorHalf) / 2, y, H.z0 + to + ti / 2));
      add(cbox(aftW - to, h, ti, inner, 0.005, (H.x1 - to + H.doorHalf) / 2, y, H.z0 + to + ti / 2));
    }
  };
  wallSet(0, lowerH, M.wall, M.varnish, root);
  wallSet(lowerH, H.wallH, upperMat, null, upper);
  // over the door
  upper.add(cbox(H.doorHalf * 2, H.wallH - H.doorH, t, upperMat, 0.012, 0, H.doorH + (H.wallH - H.doorH) / 2, H.z0 + t / 2));
  // trim: skirting, belt rail, corner posts, door frame
  const trimRing = (y: number, hgt: number, depth: number, mat: THREE.Material, into: THREE.Object3D) => {
    into.add(cbox(W + 2 * depth, hgt, depth, mat, 0.02, 0, y, H.z1 + depth / 2));
    into.add(cbox(depth, hgt, D, mat, 0.02, H.x0 - depth / 2, y, zc));
    into.add(cbox(depth, hgt, D, mat, 0.02, H.x1 + depth / 2, y, zc));
    into.add(cbox(aftW + depth, hgt, depth, mat, 0.02, (H.x0 - depth - H.doorHalf) / 2, y, H.z0 - depth / 2));
    into.add(cbox(aftW + depth, hgt, depth, mat, 0.02, (H.x1 + depth + H.doorHalf) / 2, y, H.z0 - depth / 2));
  };
  trimRing(0.07, 0.14, 0.04, M.darkWood, root);
  trimRing(lowerH, 0.09, 0.05, M.varnish, root);
  for (const [x, z] of [
    [H.x0, H.z0],
    [H.x1, H.z0],
    [H.x0, H.z1],
    [H.x1, H.z1],
  ]) {
    root.add(cbox(0.15, lowerH, 0.15, M.varnish, 0.04, x, lowerH / 2, z));
    upper.add(cbox(0.15, H.wallH - lowerH, 0.15, trimMat, 0.04, x, (H.wallH + lowerH) / 2, z));
  }
  for (const s of [-1, 1]) {
    root.add(cbox(0.08, lowerH, 0.16, M.varnish, 0.02, s * (H.doorHalf + 0.03), lowerH / 2, H.z0 + 0.02));
    upper.add(cbox(0.08, H.doorH - lowerH, 0.16, trimMat, 0.02, s * (H.doorHalf + 0.03), (H.doorH + lowerH) / 2, H.z0 + 0.02));
  }
  upper.add(cbox(H.doorHalf * 2 + 0.22, 0.1, 0.18, trimMat, 0.025, 0, H.doorH + 0.04, H.z0 + 0.02));
  // the door itself, hooked open flat against the inside of the aft wall (port side)
  {
    const dz = H.z0 + t + 0.03;
    const dw = H.x1 - H.doorHalf - t - 0.08;
    const dx = H.doorHalf + 0.04 + dw / 2;
    root.add(cbox(dw, lowerH, 0.05, M.varnish, 0.015, dx, lowerH / 2 + 0.01, dz));
    root.add(cbox(dw - 0.16, 0.5, 0.02, M.darkWood, 0.01, dx, 0.5, dz + 0.03));
    upper.add(cbox(dw, H.doorH - lowerH - 0.02, 0.05, trimMat, 0.015, dx, (H.doorH + lowerH) / 2, dz));
    const port = ring(0.15, 0.03, M.brass, 5, 16);
    port.position.set(dx, 1.55, dz + 0.03);
    upper.add(port);
    const glassDisc = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), windowMat);
    glassDisc.position.set(dx, 1.55, dz + 0.028);
    upper.add(glassDisc);
    root.add(pal(ball(0.035, M.iron, 8, dx - dw / 2 + 0.1, 0.95, dz + 0.04), C.brass));
  }
  // windows: glowing panes on both faces, framed outside
  const winGeo = new THREE.PlaneGeometry(0.8, 0.55);
  const addWin = (x: number, y: number, z: number, ry: number, w = 0.8, h = 0.55) => {
    const n = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    for (const s of [1, -1]) {
      const pane = new THREE.Mesh(winGeo, windowMat);
      pane.scale.set(w / 0.8, h / 0.55, 1);
      pane.position.set(x, y, z).addScaledVector(n, s * (t / 2 + 0.006));
      pane.rotation.y = ry + (s < 0 ? Math.PI : 0);
      pane.castShadow = false;
      upper.add(pane);
    }
    // a deep frame (so the glass sits recessed), a drip head, a sill and a recessed mullion
    const f = new THREE.Group();
    f.position.set(x, y, z).addScaledVector(n, t / 2 + 0.04);
    f.rotation.y = ry;
    f.add(cbox(w + 0.16, 0.08, 0.09, trimMat, 0.025, 0, h / 2 + 0.04, 0));
    f.add(cbox(w + 0.24, 0.035, 0.12, trimMat, 0.012, 0, h / 2 + 0.095, 0.01));
    f.add(cbox(w + 0.22, 0.07, 0.13, trimMat, 0.025, 0, -h / 2 - 0.035, 0.02));
    f.add(cbox(0.08, h, 0.09, trimMat, 0.025, w / 2 + 0.04, 0, 0));
    f.add(cbox(0.08, h, 0.09, trimMat, 0.025, -w / 2 - 0.04, 0, 0));
    if (w > 0.7) f.add(cbox(0.035, h, 0.035, trimMat, 0.01, 0, 0, -0.03));
    upper.add(f);
  };
  for (const x of [-1.15, 0, 1.15]) addWin(x, 1.66, H.z1 - t / 2, 0, 0.92, 0.6);
  for (const z of [4.4, 6.4]) {
    addWin(H.x1 - t / 2, 1.66, z, Math.PI / 2);
    addWin(H.x0 + t / 2, 1.66, z, -Math.PI / 2);
  }
  addWin(-1.25, 1.66, H.z0 + t / 2, Math.PI, 0.62, 0.5);
  addWin(1.25, 1.66, H.z0 + t / 2, Math.PI, 0.62, 0.5);
  // roof: planked top over a painted fascia
  const roofZ = zc + 0.1;
  upper.add(cbox(W + 0.4, 0.1, D + 0.5, roofMat, 0.035, 0, H.roofY + 0.02, roofZ));
  upper.add(cbox(W + 0.46, 0.14, D + 0.56, fasciaMat, 0.04, 0, H.roofY - 0.05, roofZ));
  const roofTop = H.roofY + 0.07;

  // handrails (brace points): house sides and aft wall
  {
    const rail = M.steel;
    for (const s of [-1, 1]) {
      const x = s * (H.x1 + 0.08);
      root.add(bar(x, 1.15, H.z0 + 0.2, x, 1.15, H.z1 - 0.2, 0.028, rail, 8));
      for (const z of [H.z0 + 0.3, zc, H.z1 - 0.3]) root.add(bar(s * (H.x1 + 0.0), 1.15, z, x, 1.15, z, 0.02, rail, 6));
      const xa = s * (H.doorHalf + 0.12),
        xb = s * (H.x1 - 0.12);
      root.add(bar(xa, 1.2, H.z0 - 0.09, xb, 1.2, H.z0 - 0.09, 0.028, rail, 8));
      for (const xx of [xa, xb]) root.add(bar(xx, 1.2, H.z0, xx, 1.2, H.z0 - 0.09, 0.02, rail, 6));
    }
  }
  // hooks for the gear that hangs on the aft wall (items hang here)
  for (const [x, y] of [
    [L.ringHook.x, L.ringHook.y + 0.38],
    [L.grappleHook.x, L.grappleHook.y + 0.3],
    [L.malletHook.x - 0.12, L.malletHook.y + 0.2],
    [L.malletHook.x + 0.12, L.malletHook.y + 0.2],
  ]) {
    const peg = tubeZ(0.022, 0.12, M.brass, 6, x, y, H.z0 - 0.06);
    root.add(peg);
  }
  // wall decor (lower walls only, flat against them)
  {
    const ex = extinguisher();
    ex.position.set(H.x0 - 0.02, 0.55, 6.9);
    ex.rotation.y = -Math.PI / 2;
    root.add(ex);
    const bh = boathook(1.9);
    bh.position.set(H.x1 + 0.02, 0.82, 5.6);
    bh.rotation.y = Math.PI / 2;
    root.add(bh);
    const hc = hangingCoil(0.2, C.greenRope);
    hc.position.set(H.x1 + 0.0, 0.98, 4.0);
    hc.rotation.y = Math.PI / 2;
    root.add(hc);
    const hc2 = hangingCoil(0.2, C.manila);
    hc2.position.set(H.x0 - 0.0, 0.98, 4.6);
    hc2.rotation.y = -Math.PI / 2;
    root.add(hc2);
  }

  // ---- roof gear (fades with the roof)
  {
    const g = upper;
    // roof rail
    const rx = W / 2 + 0.1,
      rz0 = roofZ - (D + 0.5) / 2 + 0.1,
      rz1 = roofZ + (D + 0.5) / 2 - 0.1;
    const ry = roofTop + 0.3;
    const posts: [number, number][] = [];
    for (const z of [rz0, rz0 + 1.2, rz0 + 2.4, rz0 + 3.6, rz1]) posts.push([-rx, z], [rx, z]);
    for (const x of [-rx + 1.4, rx - 1.4]) posts.push([x, rz1]);
    for (const [x, z] of posts) g.add(bar(x, roofTop, z, x, ry, z, 0.022, M.steel, 6));
    g.add(bar(-rx, ry, rz0, -rx, ry, rz1, 0.026, M.steel, 6));
    g.add(bar(rx, ry, rz0, rx, ry, rz1, 0.026, M.steel, 6));
    g.add(bar(-rx, ry, rz1, rx, ry, rz1, 0.026, M.steel, 6));
    // life-raft canister (aft, starboard)
    const lr = liferaft();
    lr.position.set(-1.0, roofTop, 4.55);
    g.add(lr);
    // radar dome, searchlight, horn up front
    const rd = radarDome();
    rd.position.set(-1.3, roofTop, 7.15);
    g.add(rd);
    const sl = searchlight();
    sl.position.set(-0.25, roofTop, 7.6);
    g.add(sl);
    const hn = horn();
    hn.position.set(0.45, roofTop, 7.62);
    g.add(hn);
    // whip antennas at the front corners (skipped on Low)
    if (!low)
      for (const s of [-1, 1]) {
        g.add(tube(0.035, 0.045, 0.12, M.iron, 6, s * 1.95, roofTop + 0.06, 7.75));
        g.add(pal(tube(0.012, 0.018, 1.6, M.iron, 5, s * 1.95, roofTop + 0.9, 7.75), C.offWhite));
      }
    // orange fish crates stacked on the aft starboard corner (full of fish, readable from the
    // overhead camera), a teal one up front, buoys, rope and a net bundle
    const c1 = fishCrate(C.orange);
    c1.position.set(-1.6, roofTop, 3.5);
    c1.rotation.y = 0.04;
    g.add(c1);
    const c2 = fishCrate(C.orange, true);
    c2.position.set(-1.58, roofTop + 0.29, 3.53);
    c2.rotation.y = -0.12;
    g.add(c2);
    const c2b = fishCrate(C.orange, true);
    c2b.rotation.y = Math.PI / 2 + 0.06;
    c2b.position.set(-0.92, roofTop, 3.47);
    g.add(c2b);
    const c3 = fishCrate(0x2f8f9a);
    c3.position.set(1.32, roofTop, 6.85);
    c3.rotation.y = -0.1;
    g.add(c3);
    const b1 = buoyOnDeck(0.24);
    b1.position.set(0.25, roofTop, 4.75);
    g.add(b1);
    const b2 = buoyOnDeck(0.22, C.white);
    b2.position.set(-0.2, roofTop, 4.45);
    g.add(b2);
    const rc = ropeCoil(0.32, 4, C.manila);
    rc.position.set(-0.45, roofTop, 6.3);
    g.add(rc);
    const np = netPile(0.9, 0.75, 0.32, 3);
    np.position.set(-1.15, roofTop, 5.5);
    g.add(np);
  }

  // =============================================================================================
  // MAST, RIGGING, LIGHTS (static: the crane hangs from the mast)
  const mastH = 4.2;
  const mastBase = new THREE.Vector3(L.mast.x, roofTop, L.mast.z);
  const mastTop = L.mast.y + mastH;
  {
    root.add(tube(0.085, 0.13, mastTop - roofTop, M.cream, 12, mastBase.x, (mastTop + roofTop) / 2, mastBase.z));
    root.add(tube(0.2, 0.22, 0.06, M.iron, 12, mastBase.x, roofTop + 0.03, mastBase.z));
    // bell
    const bellG = new THREE.Group();
    bellG.add(tube(0.07, 0.13, 0.2, M.brass, 12, 0, 0, 0));
    const lip = ring(0.13, 0.018, M.brass, 4, 14);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = -0.1;
    bellG.add(lip);
    bellG.add(cbox(0.2, 0.03, 0.04, M.iron, 0.01, -0.1, 0.12, 0));
    bellG.position.set(mastBase.x + 0.24, 3.3, mastBase.z);
    root.add(bellG);
    // spreader with sidelights (red to port, green to starboard)
    const spY = 5.55;
    root.add(cbox(1.5, 0.07, 0.1, M.cream, 0.02, mastBase.x, spY, mastBase.z));
    for (const s of [1, -1]) {
      const sl = sidelight(s > 0 ? 0xff3a1e : 0x2cff6a);
      sl.position.set(mastBase.x + s * 0.68, spY + 0.035, mastBase.z);
      sl.rotation.y = s > 0 ? 0 : Math.PI;
      root.add(sl);
    }
    // radar scanner on a platform on the forward face
    root.add(cbox(0.5, 0.04, 0.46, M.iron, 0.01, mastBase.x, 4.98, mastBase.z + 0.3));
    root.add(bar(mastBase.x, 4.7, mastBase.z + 0.08, mastBase.x, 4.96, mastBase.z + 0.45, 0.02, M.iron, 5));
    const sc = radarScanner(1.3);
    sc.position.set(mastBase.x, 5.0, mastBase.z + 0.32);
    sc.rotation.y = 0.35;
    root.add(sc);
    // floodlights aimed aft over the working deck
    root.add(cbox(0.56, 0.05, 0.06, M.iron, 0.015, mastBase.x, 4.66, mastBase.z - 0.1));
    for (const s of [-1, 1]) {
      const fl = floodlight();
      fl.position.set(mastBase.x + s * 0.2, 4.55, mastBase.z - 0.17);
      fl.rotation.set(-0.42, s * 0.12, 0);
      root.add(fl);
    }
    // masthead: white light, VHF whip, little weather vane
    root.add(tube(0.07, 0.07, 0.1, M.iron, 8, mastBase.x, mastTop + 0.03, mastBase.z));
    root.add(pal(tube(0.055, 0.055, 0.12, M.iron, 8, mastBase.x, mastTop + 0.14, mastBase.z), 0xffe9c4, 'soft'));
    root.add(tube(0.075, 0.075, 0.03, M.iron, 8, mastBase.x, mastTop + 0.215, mastBase.z));
    if (!low) root.add(pal(tube(0.008, 0.014, 1.1, M.iron, 5, mastBase.x + 0.08, mastTop + 0.6, mastBase.z), C.offWhite));
    // the harbour flag off the starboard spreader
    const flag = new THREE.Mesh(flagGeo(0.55, 0.36, 2, 0.07), flagMat());
    flag.position.set(mastBase.x - 0.72, spY - 0.22, mastBase.z);
    flag.rotation.y = Math.PI / 2 + 0.25; // streams aft
    flag.castShadow = true;
    root.add(flag);
    root.add(bar(mastBase.x - 0.72, spY, mastBase.z, mastBase.x - 0.72, spY - 0.42, mastBase.z, 0.005, M.rigging, 4));
    // forestay to the stem head (with signal-flag bunting) and a backstay to the stern staff
    const stayTop = new THREE.Vector3(mastBase.x, mastTop - 0.1, mastBase.z);
    const stem = new THREE.Vector3(0, stemTop, BOW_Z - 0.02);
    root.add(line3(stayTop, stem, 0.007, M.rigging, 4));
    for (const sx of [-0.6, 0.6]) root.add(line3(new THREE.Vector3(mastBase.x, mastTop - 0.15, mastBase.z), new THREE.Vector3(mastBase.x + sx, spY + 0.03, mastBase.z), 0.006, M.rigging, 4));
    if (!low) {
      const bunt = new THREE.Mesh(buntingGeo(stayTop.clone().lerp(stem, 0.04), stem.clone().lerp(stayTop, 0.05), 14, 0.2), buntingMat());
      bunt.castShadow = false;
      root.add(bunt);
    }
  }
  // stern flagstaff with the stern light and the ensign
  {
    root.add(tube(0.03, 0.04, 1.9, M.varnish, 6, 0, 1.09 + 0.95, STERN_Z + 0.08));
    root.add(ball(0.05, M.brass, 8, 0, 3.0, STERN_Z + 0.08));
    root.add(pal(tube(0.05, 0.05, 0.1, M.iron, 8, 0, 1.25, STERN_Z + 0.08), 0xffe9c4, 'soft'));
    root.add(tube(0.065, 0.065, 0.03, M.iron, 8, 0, 1.315, STERN_Z + 0.08));
    const ens = new THREE.Mesh(flagGeo(0.7, 0.46, 2, 0.08), flagMat());
    ens.position.set(0, 2.72, STERN_Z + 0.08);
    ens.rotation.y = Math.PI / 2 + 0.35;
    ens.castShadow = true;
    root.add(ens);
  }

  // =============================================================================================
  // INTERIOR
  let stoveGlow: THREE.PointLight | null = null;
  const wheel = new THREE.Group();
  {
    // striped rug
    const rugMat = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      map: canvasTexture(128, 64, (g) => {
        const cols = ['#8a3f30', '#c98a3c', '#8a3f30', '#2f6a70', '#e9dcc0', '#2f6a70', '#8a3f30', '#c98a3c', '#8a3f30'];
        cols.forEach((c, i) => {
          g.fillStyle = c;
          g.fillRect(0, (i * 64) / cols.length, 128, 64 / cols.length + 1);
        });
        g.fillStyle = 'rgba(255,255,255,0.12)';
        for (let x = 0; x < 128; x += 4) g.fillRect(x, 0, 1, 64);
      }),
    });
    const rug = meshOf(new THREE.PlaneGeometry(2.3, 1.5), rugMat, false, true);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.15, 0.012, 5.3);
    root.add(rug);
    // stove
    const st = L.stove;
    const sx = st.center.x,
      sz = st.center.z;
    const top = st.half.y * 2;
    root.add(cbox(st.half.x * 2 - 0.04, top - 0.12, st.half.z * 2 - 0.04, M.iron, 0.04, sx, 0.12 + (top - 0.12) / 2, sz));
    root.add(cbox(st.half.x * 2 + 0.04, 0.05, st.half.z * 2 + 0.04, M.iron, 0.02, sx, top - 0.02, sz));
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      root.add(cbox(0.06, 0.14, 0.06, M.iron, 0.015, sx + dx * (st.half.x - 0.07), 0.07, sz + dz * (st.half.z - 0.07)));
    root.add(pal(cbox(0.34, 0.2, 0.02, M.iron, 0.01, sx, 0.4, sz - st.half.z + 0.01), 0xff6a1a, 'soft'));
    root.add(cbox(0.42, 0.28, 0.03, M.brass, 0.01, sx, 0.4, sz - st.half.z + 0.025));
    root.add(bar(sx - st.half.x, top + 0.07, sz - st.half.z, sx + st.half.x, top + 0.07, sz - st.half.z, 0.012, M.brass, 5));
    {
      // flue: dark iron rusting toward the roof and sooty at the top, a brass collar where it
      // passes the roof (fades with it) and a cream rain cap on three legs
      const px = sx + 0.12,
        pz = sz + 0.08,
        pTop = roofTop + 0.75;
      root.add(tube(0.075, 0.075, pTop - top, stovePipeMat(), 12, px, (top + pTop) / 2, pz));
      root.add(tube(0.09, 0.09, 0.05, M.brass, 12, px, top + 0.04, pz));
      upper.add(tube(0.15, 0.17, 0.06, M.brass, 12, px, roofTop + 0.03, pz));
      upper.add(tube(0.09, 0.09, 0.04, M.brass, 12, px, roofTop + 0.08, pz));
      upper.add(tube(0.085, 0.085, 0.035, M.iron, 12, px, pTop - 0.02, pz));
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        upper.add(bar(px + Math.cos(a) * 0.07, pTop - 0.02, pz + Math.sin(a) * 0.07, px + Math.cos(a) * 0.1, pTop + 0.1, pz + Math.sin(a) * 0.1, 0.01, M.iron, 4));
      }
      upper.add(tube(0.02, 0.19, 0.11, M.cream, 14, px, pTop + 0.15, pz));
      upper.add(tube(0.19, 0.19, 0.02, M.cream, 14, px, pTop + 0.09, pz));
    }
    const kettle = new THREE.Group();
    kettle.add(pal(tube(0.11, 0.14, 0.18, M.iron, 12, 0, 0.09, 0), 0x3f8c8f));
    const kh = ring(0.08, 0.012, M.iron, 4, 10, Math.PI);
    kh.position.y = 0.2;
    kettle.add(kh);
    kettle.add(pal(bar(0.12, 0.12, 0, 0.22, 0.2, 0, 0.02, M.iron, 6), 0x3f8c8f));
    kettle.position.set(sx - 0.12, top, sz - 0.02);
    root.add(kettle);
    stoveGlow = new THREE.PointLight(config.palette.amber, 2.2, 5, 1.6);
    stoveGlow.position.set(sx - 0.3, 0.9, sz - 0.4);
    root.add(stoveGlow);
    // galley table, bench with a cushion, mug and plate
    const gt = L.galleyTable;
    const ty = gt.half.y * 2;
    root.add(cbox(gt.half.x * 2, 0.06, gt.half.z * 2, M.varnish, 0.025, gt.center.x, ty - 0.03, gt.center.z));
    root.add(tube(0.06, 0.06, ty - 0.06, M.iron, 8, gt.center.x, (ty - 0.06) / 2, gt.center.z));
    root.add(cbox(0.5, 0.04, 0.5, M.iron, 0.01, gt.center.x, 0.02, gt.center.z));
    const bx = gt.center.x - 0.42;
    root.add(cbox(0.4, 0.36, 1.3, M.darkWood, 0.03, bx, 0.18, gt.center.z));
    root.add(pal(cbox(0.38, 0.08, 1.24, M.iron, 0.035, bx, 0.4, gt.center.z), 0xb5452f));
    root.add(pal(tube(0.05, 0.045, 0.1, M.iron, 10, gt.center.x + 0.1, ty + 0.05, gt.center.z - 0.2), C.red));
    root.add(pal(tube(0.12, 0.1, 0.02, M.iron, 14, gt.center.x - 0.05, ty + 0.01, gt.center.z + 0.25), C.white));
    // helm console: wooden desk with a sloped instrument top, screens, compass, throttle
    root.add(cbox(1.9, 0.86, 0.45, M.darkWood, 0.04, 0, 0.43, 7.33));
    const panel = cbox(1.9, 0.06, 0.5, M.iron, 0.02, 0, 0.92, 7.3);
    panel.rotation.x = -0.32;
    root.add(panel);
    const scr = pal(cbox(0.46, 0.3, 0.03, M.iron, 0.01, 0.55, 1.08, 7.24), 0x57d6a0, 'soft');
    scr.rotation.x = -0.32 - Math.PI / 2 + 1.25;
    root.add(scr);
    const scr2 = pal(cbox(0.36, 0.24, 0.03, M.iron, 0.01, -0.6, 1.06, 7.24), 0xffb85a, 'soft');
    scr2.rotation.x = scr.rotation.x;
    root.add(scr2);
    root.add(tube(0.09, 0.11, 0.16, M.brass, 12, 0, 1.06, 7.42));
    root.add(ball(0.08, K.glass(), 10, 0, 1.17, 7.42));
    root.add(bar(0.95, 0.95, 7.2, 0.95, 1.15, 7.12, 0.018, M.iron, 5));
    root.add(pal(ball(0.04, M.iron, 8, 0.95, 1.16, 7.11), C.red));
    // the wheel (spoked, with handles)
    // (the wheel sits a little proud of the console face, on a short shaft)
    const wh = new THREE.Group();
    wh.position.z = -0.09;
    wh.add(ring(0.3, 0.032, M.varnish, 6, 22));
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      if (i < 4) {
        const sp = tube(0.016, 0.016, 0.76, M.varnish, 5);
        sp.rotation.z = a;
        wh.add(sp);
      }
      const hd = tube(0.022, 0.016, 0.1, M.varnish, 6, Math.sin(-a) * 0.43, Math.cos(a) * 0.43, 0);
      hd.rotation.z = a;
      wh.add(hd);
    }
    wh.add(tubeZ(0.07, 0.08, M.brass, 10));
    wheel.add(wh);
    wheel.add(tubeZ(0.03, 0.12, M.brass, 6, 0, 0, -0.03));
    wheel.position.copy(L.wheel);
    wheel.name = 'dyn:wheel';
    root.add(wheel);
    // hat hook
    root.add(tubeZ(0.022, 0.2, M.brass, 6, L.hatHook.x, L.hatHook.y, L.hatHook.z));
    // a shelf with jars and a clock on the inside of the port wall
    root.add(cbox(0.14, 0.03, 1.1, M.varnish, 0.01, H.x1 - t - 0.07, 0.95, 5.3));
    for (let i = 0; i < 4; i++) root.add(pal(tube(0.04, 0.04, 0.12, M.iron, 8, H.x1 - t - 0.07, 1.03, 4.9 + i * 0.26), [0xc94f2f, 0x3f8c8f, 0xe8b44a, 0xf3ead8][i]));
  }

  // =============================================================================================
  // CRANE: boom on the mast (yaws and pitches), with a hanging hook block
  const craneBoom = new THREE.Group();
  craneBoom.name = 'dyn:boom';
  craneBoom.position.set(L.mast.x, L.mast.y + 1.5, L.mast.z);
  const craneHook = new THREE.Group();
  craneHook.name = 'dyn:hook';
  {
    const b = craneBoom;
    b.add(cbox(0.26, 0.26, 0.22, M.iron, 0.04, 0, 0, 0.0));
    b.add(cbox(0.22, 0.26, 3.1, M.gear, 0.05, 0, 0, -1.6));
    b.add(cbox(0.16, 0.19, 2.3, M.steel, 0.04, 0, -0.02, -3.95));
    b.add(cbox(0.235, 0.06, 0.08, M.iron, 0.02, 0, 0.0, -3.12));
    // tip sheave between cheek plates
    for (const s of [-1, 1]) b.add(cbox(0.03, 0.26, 0.3, M.gear, 0.01, s * 0.07, -0.1, -5.0));
    b.add(tubeX(0.1, 0.1, M.iron, 12, 0, -0.12, -5.0));
    // hydraulic ram from the mast collar to under the boom
    b.add(cbox(0.14, 0.2, 0.16, M.iron, 0.03, 0, -0.2, -0.2));
    b.add(bar(0, -0.26, -0.24, 0, -0.2, -1.0, 0.05, M.gear, 8));
    b.add(bar(0, -0.2, -1.0, 0, -0.13, -1.75, 0.03, M.steel, 8));
    // hook block: an orange weight, swivel and steel hook
    const h = craneHook;
    h.add(cbox(0.2, 0.22, 0.14, M.gear, 0.05, 0, 0.02, 0));
    h.add(cbox(0.21, 0.04, 0.15, M.iron, 0.01, 0, 0.1, 0));
    h.add(tube(0.025, 0.025, 0.1, M.iron, 6, 0, -0.13, 0));
    const hk = ring(0.07, 0.02, M.iron, 5, 10, Math.PI * 1.45);
    hk.position.set(0, -0.24, 0);
    hk.rotation.z = Math.PI * 0.75;
    h.add(hk);
    h.position.set(0, -0.8, -5.0);
    b.add(h);
    // the hoist cable from the tip down to the hook; it stretches as the hook drops
    const cableGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true).translate(0, -0.5, 0);
    const cable = new THREE.Mesh(cableGeo, M.iron);
    cable.name = 'dyn:cable';
    cable.position.set(0, -0.14, -5.0);
    cable.frustumCulled = false;
    cable.castShadow = true;
    cable.onBeforeRender = () => {
      cable.scale.y = Math.max(0.02, cable.position.y - (craneHook.position.y + 0.13));
      cable.updateMatrixWorld();
    };
    b.add(cable);
    b.rotation.x = -0.35;
  }
  root.add(craneBoom);

  // =============================================================================================
  // DAVIT, BLOCK, HAULER
  const block = new THREE.Group();
  block.name = 'dyn:block';
  const haulerDrum = new THREE.Group();
  haulerDrum.name = 'dyn:drum';
  const haulerLever = new THREE.Group();
  haulerLever.name = 'dyn:hlever';
  {
    const db = L.davitBase,
      dt = L.davitTop;
    root.add(tube(0.13, 0.155, dt.y - 0.1, M.gear, 12, db.x, (dt.y - 0.1) / 2, db.z));
    root.add(tube(0.25, 0.27, 0.06, M.iron, 12, db.x, 0.03, db.z));
    root.add(cbox(0.36, 0.08, 0.4, M.iron, 0.02, db.x, railHeight(db.z) + 0.13, db.z));
    // head housing with a guide sheave
    root.add(cbox(0.3, 0.34, 0.32, M.gear, 0.06, dt.x, dt.y - 0.05, dt.z));
    root.add(tubeX(0.13, 0.36, M.iron, 12, dt.x, dt.y - 0.08, dt.z));
    // arm out to the block, and a knee brace
    const armEnd = new THREE.Vector3(L.block.x, L.block.y + 0.34, L.block.z + 0.08);
    const armStart = new THREE.Vector3(dt.x, dt.y + 0.02, dt.z - 0.12);
    const arm = cbox(0.17, 0.2, armStart.distanceTo(armEnd) + 0.1, M.gear, 0.04);
    arm.position.copy(armStart).lerp(armEnd, 0.5);
    arm.lookAt(armEnd);
    root.add(arm);
    root.add(bar(db.x, dt.y - 0.9, db.z - 0.05, (armStart.x + armEnd.x) / 2, (armStart.y + armEnd.y) / 2 - 0.08, (armStart.z + armEnd.z) / 2, 0.045, M.gear, 8));
    // block: orange cheeks, steel sheave, shackle up to the arm
    for (const s of [-1, 1]) block.add(cbox(0.04, 0.52, 0.5, M.gear, 0.02, s * 0.085, 0.0, 0));
    block.add(tubeX(0.2, 0.12, M.steel, 16, 0, 0, 0));
    block.add(tubeX(0.06, 0.24, M.iron, 8, 0, 0, 0));
    block.add(cbox(0.2, 0.08, 0.14, M.iron, 0.02, 0, 0.29, 0.03));
    const sh = ring(0.06, 0.016, M.iron, 4, 10);
    sh.position.set(0, 0.36, 0.06);
    sh.rotation.y = Math.PI / 2;
    block.add(sh);
    block.position.copy(L.block);
    root.add(block);
    // hauler: teal pedestal with cheek plates carrying the drum, hydraulic motor outboard
    const hx = db.x + 0.3,
      hz = db.z - 0.25;
    root.add(cbox(0.48, 0.42, 0.56, M.machine, 0.05, hx, 0.21, hz));
    root.add(cbox(0.56, 0.05, 0.62, M.iron, 0.015, hx, 0.025, hz));
    for (const s of [-1, 1]) root.add(cbox(0.045, 0.56, 0.42, M.machine, 0.02, hx + s * 0.235, 0.66, hz));
    root.add(tubeX(0.1, 0.14, M.iron, 10, hx - 0.33, 0.7, hz));
    root.add(cbox(0.1, 0.12, 0.12, M.brass, 0.02, hx + 0.32, 0.62, hz - 0.05));
    // drum (spins about x): rope wraps between flanges, spoked so the spin reads
    const drumBody = tubeX(0.16, 0.34, M.gear, 14);
    haulerDrum.add(drumBody);
    for (const s of [-1, 1]) {
      const fl = tubeX(0.22, 0.035, M.steel, 16, s * 0.18, 0, 0);
      haulerDrum.add(fl);
      for (let k = 0; k < 4; k++) {
        const sp = cbox(0.012, 0.3, 0.05, M.steel, 0.005, s * 0.2, 0, 0);
        sp.rotation.x = (k * Math.PI) / 4;
        haulerDrum.add(sp);
      }
    }
    for (let k = 0; k < 4; k++) {
      const w = ring(0.175, 0.028, M.manila, 5, 16);
      w.rotation.y = Math.PI / 2;
      w.position.x = -0.12 + k * 0.08;
      haulerDrum.add(w);
    }
    haulerDrum.position.set(hx, 0.7, hz);
    root.add(haulerDrum);
    // hauler lever
    haulerLever.add(tubeX(0.04, 0.08, M.steel, 8));
    haulerLever.add(tube(0.022, 0.022, 0.55, M.steel, 6, 0, 0.27, 0));
    haulerLever.add(pal(ball(0.065, M.iron, 12, 0, 0.57, 0), C.red));
    haulerLever.position.copy(L.haulerLever).setY(0.75);
    root.add(haulerLever);
    root.add(cbox(0.07, 0.34, 0.07, M.machine, 0.02, L.haulerLever.x, 0.58, L.haulerLever.z));
  }

  // =============================================================================================
  // LAUNCH CRADLE (tilts about its outboard / inboard edge) on a navy stand with teal legs
  const cradle = new THREE.Group();
  cradle.name = 'dyn:cradle';
  const c = L.cradle;
  cradle.position.copy(c.center);
  {
    const hx = c.half.x,
      hz = c.half.z;
    // frame: side rails, end bars, rollers
    for (const s of [-1, 1]) cradle.add(cbox(hx * 2, 0.12, 0.14, M.steel, 0.035, 0, -0.0, s * (hz - 0.07)));
    for (const s of [-1, 1]) cradle.add(cbox(0.1, 0.1, hz * 2 - 0.2, M.steel, 0.03, s * (hx - 0.06), -0.01, 0));
    for (let i = -2; i <= 2; i++) {
      cradle.add(tubeZ(0.052, hz * 2 - 0.28, M.steel, 10, i * 0.38, 0.005, 0));
      for (const s of [-1, 1]) cradle.add(tubeZ(0.058, 0.04, M.gear, 10, i * 0.38, 0.005, s * (hz - 0.16)));
    }
    // galvanised drip tray under the rollers (grey shows between them, not the stand)
    cradle.add(cbox(hx * 2 - 0.16, 0.025, hz * 2 - 0.26, M.galv, 0.008, 0, -0.07, 0));
    for (const s of [-1, 1]) cradle.add(cbox(hx * 2 - 0.16, 0.05, 0.025, M.galv, 0.008, 0, -0.055, s * (hz - 0.14)));
    // outboard stop: a padded orange bumper with hazard tape along its top and face
    cradle.add(cbox(0.12, 0.26, hz * 2, M.gear, 0.045, -hx - 0.02, 0.1, 0));
    const tapeTop = hazardStrip(hz * 2 - 0.12, 0.085);
    tapeTop.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    tapeTop.position.set(-hx - 0.02, 0.2305, 0);
    cradle.add(tapeTop);
    const tapeFace = hazardStrip(hz * 2 - 0.12, 0.1);
    tapeFace.rotation.y = -Math.PI / 2;
    tapeFace.position.set(-hx - 0.0805, 0.12, 0);
    cradle.add(tapeFace);
    // hinge knuckles under both long edges
    for (const s of [-1, 1]) for (const z of [-0.6, 0.6]) cradle.add(tubeZ(0.05, 0.18, M.iron, 8, s * (hx - 0.03), -0.08, z));
    // stand (static): corner posts, top frame, a darker solid core, a ram
    const cx = c.center.x,
      cz = c.center.z;
    const topY = c.center.y - 0.1;
    root.add(cbox(1.66, topY - 0.1, 1.66, M.navy, 0.05, cx, (topY - 0.1) / 2 + 0.02, cz));
    for (const dx of [-1, 1])
      for (const dz of [-1, 1]) root.add(cbox(0.15, topY, 0.15, M.machine, 0.04, cx + dx * 0.86, topY / 2, cz + dz * 0.86));
    for (const dz of [-1, 1]) root.add(cbox(1.86, 0.12, 0.12, M.navy, 0.035, cx, topY - 0.02, cz + dz * 0.86));
    for (const dx of [-1, 1]) root.add(cbox(0.12, 0.12, 1.86, M.navy, 0.035, cx + dx * 0.86, topY - 0.02, cz));
    for (const dz of [-1, 1]) root.add(bar(cx - 0.8, 0.12, cz + dz * 0.86, cx + 0.8, topY - 0.1, cz + dz * 0.86, 0.035, M.machine, 6));
    // hazard tape down the outboard face of the stand
    const tapeStand = hazardStrip(1.6, 0.09);
    tapeStand.rotation.y = -Math.PI / 2;
    tapeStand.position.set(cx - 0.835, topY - 0.02, cz);
    root.add(tapeStand);
    root.add(cbox(1.9, 0.05, 1.9, M.iron, 0.015, cx, 0.025, cz));
    // hinge blocks along both top edges (the cradle pivots on either)
    for (const s of [-1, 1]) for (const z of [-0.6, 0.6]) root.add(cbox(0.14, 0.12, 0.26, M.iron, 0.03, cx + s * (c.half.x - 0.03), topY + 0.05, cz + z));
    cradle.position.copy(c.center);
  }
  root.add(cradle);

  // launcher lever on a teal pedestal with a quadrant gate
  const launcherLever = new THREE.Group();
  launcherLever.name = 'dyn:llever';
  {
    const p = L.launcherLever;
    root.add(cbox(0.3, 0.32, 0.3, M.machine, 0.05, p.x, 0.16, p.z));
    root.add(cbox(0.34, 0.04, 0.34, M.iron, 0.012, p.x, 0.02, p.z));
    for (const s of [-1, 1]) root.add(cbox(0.03, 0.12, 0.3, M.iron, 0.01, p.x + s * 0.06, 0.37, p.z));
    root.add(pal(cbox(0.2, 0.05, 0.08, M.iron, 0.015, p.x, 0.34, p.z + 0.14), C.red));
    launcherLever.add(tubeX(0.04, 0.1, M.steel, 8));
    launcherLever.add(tube(0.022, 0.022, 0.6, M.steel, 6, 0, 0.3, 0));
    launcherLever.add(pal(ball(0.07, M.iron, 12, 0, 0.62, 0), C.red));
    launcherLever.position.copy(p).setY(0.35);
    root.add(launcherLever);
  }

  // spirit level on the starboard rail by the cradle
  const spiritGroup = new THREE.Group();
  spiritGroup.name = 'dyn:level';
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xd8f0e0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55 });
  const windowLevelMat = new THREE.MeshStandardMaterial({ color: 0x58c46a, emissive: 0x1d6a2a, roughness: 0.3, transparent: true, opacity: 0.6 });
  const tubeMesh = tubeX(0.055, 0.9, tubeMat, 14);
  tubeMesh.castShadow = false;
  const windowMesh = tubeX(0.064, 0.2, windowLevelMat, 14);
  windowMesh.castShadow = false;
  const bubble = ball(0.045, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x99ffcc, emissiveIntensity: 0.8, roughness: 0.2 }), 10);
  {
    spiritGroup.add(cbox(1.04, 0.05, 0.17, M.brass, 0.015, 0, -0.085, 0));
    for (const s of [-1, 1]) spiritGroup.add(cbox(0.08, 0.19, 0.17, M.brass, 0.03, s * 0.49, -0.005, 0));
    spiritGroup.add(cbox(0.07, 0.11, 0.07, M.brass, 0.015, 0, -0.16, 0));
    spiritGroup.add(tubeMesh, windowMesh, bubble);
    spiritGroup.position.set(-2.95, 1.2, -0.25);
    spiritGroup.rotation.y = Math.PI / 2; // tube runs athwartships so it shows roll
  }
  root.add(spiritGroup);

  // =============================================================================================
  // SORTING TABLE: a scrubbed tan board top with varnished lips (matching the lip colliders), a rounded
  // varnished nosing along the open edge and a drain, on a planked cabinet (solid, like its collider)
  {
    const tb = L.table;
    const tx = tb.center.x,
      tz = tb.center.z;
    const w = tb.half.x * 2,
      d = tb.half.z * 2;
    root.add(cbox(w - 0.08, 0.8, d - 0.08, M.darkWood, 0.04, tx, 0.42, tz));
    root.add(cbox(w - 0.04, 0.06, d - 0.04, M.iron, 0.02, tx, 0.03, tz));
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) root.add(cbox(0.1, 0.84, 0.1, M.steel, 0.025, tx + dx * (w / 2 - 0.05), 0.42, tz + dz * (d / 2 - 0.05)));
    root.add(cbox(w - 0.02, 0.05, d - 0.02, sortTableTopMat(), 0.018, tx, 0.875, tz));
    root.add(cbox(w + 0.02, 0.03, d + 0.02, M.steel, 0.01, tx, 0.84, tz));
    root.add(cbox(0.07, 0.13, d, M.varnish, 0.03, tx + w / 2, 0.955, tz));
    root.add(cbox(w, 0.13, 0.07, M.varnish, 0.03, tx, 0.955, tz - d / 2));
    root.add(cbox(w, 0.13, 0.07, M.varnish, 0.03, tx, 0.955, tz + d / 2));
    // brass caps where the lips meet
    for (const dz of [-1, 1]) root.add(cbox(0.09, 0.03, 0.09, M.brass, 0.012, tx + w / 2, 1.025, tz + dz * (d / 2)));
    // the open (starboard) edge: a rounded varnished nosing, flush with the steel
    root.add(tubeZ(0.032, d - 0.06, M.varnish, 10, tx - w / 2 + 0.01, 0.876, tz));
    // drain slot near the open edge, and its spout under the nosing
    root.add(cbox(0.05, 0.008, 0.26, M.iron, 0.003, tx - w / 2 + 0.11, 0.901, tz + d / 2 - 0.32));
    root.add(cbox(0.07, 0.004, 0.3, M.steel, 0.002, tx - w / 2 + 0.11, 0.899, tz + d / 2 - 0.32));
    root.add(tubeX(0.024, 0.14, M.steel, 8, tx - w / 2 - 0.03, 0.78, tz + d / 2 - 0.32));
    // a brass crab gauge hanging off the port lip
    const gauge = cbox(0.32, 0.08, 0.02, M.brass, 0.01, tx + w / 2 + 0.05, 0.84, tz + 0.5);
    gauge.rotation.y = Math.PI / 2;
    root.add(gauge);
  }

  // =============================================================================================
  // TANK HATCH: teal coaming, dark water, a planked lid leaning beside it
  const hatchLid = new THREE.Group();
  hatchLid.name = 'dyn:lid';
  {
    const h = L.hatch;
    const hx = h.center.x,
      hz = h.center.z,
      hh = h.coaming;
    root.add(cbox(h.half * 2 + 0.2, hh, 0.1, M.machine, 0.03, hx, hh / 2, hz - h.half - 0.05));
    root.add(cbox(h.half * 2 + 0.2, hh, 0.1, M.machine, 0.03, hx, hh / 2, hz + h.half + 0.05));
    root.add(cbox(0.1, hh, h.half * 2, M.machine, 0.03, hx - h.half - 0.05, hh / 2, hz));
    root.add(cbox(0.1, hh, h.half * 2, M.machine, 0.03, hx + h.half + 0.05, hh / 2, hz));
    root.add(cbox(h.half * 2 + 0.24, 0.035, 0.13, M.iron, 0.01, hx, hh + 0.012, hz - h.half - 0.05));
    root.add(cbox(h.half * 2 + 0.24, 0.035, 0.13, M.iron, 0.01, hx, hh + 0.012, hz + h.half + 0.05));
    root.add(cbox(0.13, 0.035, h.half * 2, M.iron, 0.01, hx - h.half - 0.05, hh + 0.012, hz));
    root.add(cbox(0.13, 0.035, h.half * 2, M.iron, 0.01, hx + h.half + 0.05, hh + 0.012, hz));
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(h.half * 2, h.half * 2), new THREE.MeshBasicMaterial({ color: 0x0b2228 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(hx, 0.02, hz);
    root.add(hole);
    const waterIn = new THREE.Mesh(
      new THREE.PlaneGeometry(h.half * 2, h.half * 2),
      new THREE.MeshStandardMaterial({ color: 0x1f6670, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.78, emissive: 0x0c3a40, emissiveIntensity: 0.5 }),
    );
    waterIn.rotation.x = -Math.PI / 2;
    waterIn.position.set(hx, 0.12, hz);
    waterIn.receiveShadow = true;
    root.add(waterIn);
    const lw = h.half * 2 + 0.2;
    hatchLid.add(cbox(lw, 0.06, lw, M.deck, 0.02, 0, 0, 0));
    for (const s of [-1, 1]) {
      hatchLid.add(cbox(lw + 0.02, 0.07, 0.06, M.iron, 0.015, 0, 0.005, s * (lw / 2 - 0.03)));
      hatchLid.add(cbox(0.06, 0.07, lw - 0.1, M.iron, 0.015, s * (lw / 2 - 0.03), 0.005, 0));
    }
    const lh = ring(0.08, 0.016, M.iron, 4, 10, Math.PI);
    lh.position.set(0.3, 0.035, 0);
    hatchLid.add(lh);
    hatchLid.position.set(hx - h.half - 0.2, hh + 0.3, hz);
    hatchLid.rotation.z = 1.3;
  }
  root.add(hatchLid);

  // =============================================================================================
  // CURIO CRATE: open slatted crate (things go in)
  {
    const cr = L.crate;
    const cx = cr.center.x,
      cz = cr.center.z;
    const w = cr.half.x * 2,
      h = cr.half.y * 2,
      d = cr.half.z * 2;
    root.add(cbox(w, 0.05, d, M.deck, 0.01, cx, 0.03, cz));
    for (let k = 0; k < 3; k++) {
      const y = 0.06 + k * 0.215;
      const sh = 0.15;
      root.add(cbox(w, sh, 0.05, M.varnish, 0.015, cx, y + sh / 2, cz - d / 2 + 0.025));
      root.add(cbox(w, sh, 0.05, M.varnish, 0.015, cx, y + sh / 2, cz + d / 2 - 0.025));
      root.add(cbox(0.05, sh, d - 0.1, M.varnish, 0.015, cx - w / 2 + 0.025, y + sh / 2, cz));
      root.add(cbox(0.05, sh, d - 0.1, M.varnish, 0.015, cx + w / 2 - 0.025, y + sh / 2, cz));
    }
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) root.add(cbox(0.07, h, 0.07, M.darkWood, 0.02, cx + dx * (w / 2 - 0.035), h / 2, cz + dz * (d / 2 - 0.035)));
    const lab = letterPlane(LETTERS.curios, 0.62, 0.155);
    lab.position.set(cx - w / 2 - 0.004, h * 0.62, cz);
    lab.rotation.y = -Math.PI / 2;
    root.add(lab);
  }

  // =============================================================================================
  // BAIT BOX: blue-painted planked box, lid propped against the bulwark, jars and bait
  {
    const bb = L.baitBox;
    const bx = bb.center.x,
      bz = bb.center.z;
    const w = bb.half.x * 2,
      h = bb.half.y * 2,
      d = bb.half.z * 2;
    root.add(cbox(w, h - 0.04, d, M.baitPaint, 0.04, bx, (h - 0.04) / 2, bz));
    root.add(cbox(w + 0.03, 0.05, d + 0.03, M.varnish, 0.015, bx, h - 0.03, bz));
    root.add(cbox(w - 0.1, 0.02, d - 0.1, M.iron, 0.005, bx, h - 0.008, bz));
    for (const s of [-1, 1]) {
      const hdl = ring(0.08, 0.018, M.manila, 4, 10, Math.PI);
      hdl.position.set(bx, h * 0.55, bz + s * (d / 2 + 0.005));
      hdl.rotation.x = Math.PI;
      root.add(hdl);
    }
    // the lid, hinged on the outboard edge and propped back against the bulwark
    const lid = cbox(0.05, 0.62, d + 0.03, M.baitPaint, 0.015);
    lid.rotation.z = 0.2;
    lid.position.set(bx - w / 2 - Math.sin(0.2) * 0.31, h + Math.cos(0.2) * 0.31, bz);
    root.add(lid);
    const jarGlass = K.glass();
    for (let i = 0; i < 3; i++) {
      const jx = bx - 0.18 + i * 0.2,
        jz = bz + (i === 1 ? 0.06 : -0.06);
      root.add(tube(0.085, 0.085, 0.16, jarGlass, 10, jx, h + 0.06, jz));
      root.add(pal(tube(0.09, 0.09, 0.04, M.iron, 10, jx, h + 0.155, jz), C.red));
      root.add(pal(tube(0.07, 0.07, 0.1, M.iron, 8, jx, h + 0.03, jz), 0x9c7a5a));
    }
    const f = pal(ball(0.06, M.iron, 8, bx + 0.25, h + 0.03, bz + 0.12), 0xa9bcc4);
    f.scale.set(2.6, 0.45, 1);
    root.add(f);
    const lab = letterPlane(LETTERS.bait, 0.4, 0.2);
    lab.position.set(bx + w / 2 + 0.004, h * 0.48, bz);
    lab.rotation.y = Math.PI / 2;
    root.add(lab);
  }

  // =============================================================================================
  // ENGINE HATCH (the cat's warm spot) and the rope coil
  {
    const eh = L.engineHatch;
    root.add(cbox(eh.half * 2, 0.12, eh.half * 2, M.iron, 0.03, eh.center.x, 0.06, eh.center.z));
    for (let i = 0; i < 5; i++) root.add(cbox(eh.half * 1.5, 0.025, 0.05, M.steel, 0.01, eh.center.x, 0.125, eh.center.z - 0.3 + i * 0.15));
    for (const s of [-1, 1]) {
      const hd = ring(0.06, 0.012, M.brass, 4, 8, Math.PI);
      hd.position.set(eh.center.x + s * 0.33, 0.12, eh.center.z);
      hd.rotation.y = Math.PI / 2;
      root.add(hd);
    }
    const coil = ropeCoil(0.42, 4, C.manila, 0.05);
    coil.position.copy(L.coilSpot);
    root.add(coil);
  }

  // =============================================================================================
  // CLUTTER: tyres and buoy bunches hung on the topsides, a net over the starboard quarter, the bow,
  // the stern corners behind the pot stack
  {
    /** Hang `obj` (built with outboard = local +x) from the outer edge of the cap rail at station z. */
    const hang = (obj: THREE.Object3D, side: 1 | -1, z: number) => {
      obj.position.set(side * (hullHalfWidth(z) + 0.07), railHeight(z) + 0.085, z);
      obj.rotation.y = sideYaw(side, z) - Math.PI / 2;
      root.add(obj);
    };
    // tyre fenders just under the cap, on short ropes (starboard keeps the launch/haul zone clear)
    for (const z of [-6.2, -2.8, 1.6, 4.6]) hang(tyreFender(0.35, 0.27), 1, z);
    for (const z of [-5.6, -2.4, 4.4, 6.9]) hang(tyreFender(0.35, 0.27), -1, z);
    // transom tyres
    for (const x of [-1.7, 1.7]) {
      const tf = tyreFender(0.35, 0.27);
      tf.rotation.y = Math.PI / 2;
      tf.position.set(x, railHeight(STERN_Z) + 0.085, STERN_Z - 0.07);
      root.add(tf);
    }
    // tight bunches of buoys on short lanyards: both stern quarters and the port bow
    hang(buoyBunch([C.orange, C.orange, C.white, C.orange], 1), -1, -8.75);
    hang(buoyBunch([C.orange, C.white, C.orange], 2), 1, -8.25);
    hang(buoyBunch([C.orange, C.orange, C.white], 3), 1, 6.3);
    // a net thrown over the starboard quarter, spilling down the topsides
    hang(netDrape(1.25, 0.78, 4), -1, -7.3);
    // bow: windlass and chain, bitts, the anchor; a net pile and a barrel tucked against the
    // bulwarks forward of the walkway mouths (z 7.6-8.3 stays clear)
    const wl = windlass();
    wl.position.set(0, 0, 9.0);
    root.add(wl);
    const bt = bitts();
    bt.position.set(0, 0, 9.78);
    root.add(bt);
    root.add(chain(new THREE.Vector3(-0.2, 0.36, 9.18), new THREE.Vector3(-0.5, 0.05, 9.75)));
    root.add(tube(0.09, 0.09, 0.05, M.iron, 10, -0.52, 0.025, 9.8));
    const an = anchor();
    an.position.set(-(hullHalfWidth(9.55) + 0.09), 0.2, 9.55);
    an.rotation.y = sideYaw(-1, 9.55);
    root.add(an);
    const np = netPile(0.7, 0.8, 0.42, 1);
    np.position.set(1.02, 0, 8.95);
    np.rotation.y = -0.25;
    root.add(np);
    const br = barrel('steel', C.blueBarrel);
    br.position.set(-1.1, 0, 8.86);
    root.add(br);
    // stern corners behind the pot stack
    const b1 = barrel('steel', 0xc8432f);
    b1.position.set(2.3, 0, -9.02);
    root.add(b1);
    const b2 = barrel('plastic', C.blueBarrel);
    b2.position.set(-2.3, 0, -9.02);
    root.add(b2);
    const rc = ropeCoil(0.3, 3, C.greenRope);
    rc.position.set(-1.35, 0, -9.0);
    root.add(rc);
    const sk1 = fishCrate(C.orange);
    sk1.position.set(1.2, 0, -9.0);
    root.add(sk1);
    const sk2 = fishCrate(C.orange, true);
    sk2.position.set(1.22, 0.29, -8.98);
    sk2.rotation.y = 0.1;
    root.add(sk2);
  }

  // gulls: one on the davit head, one on the wheelhouse roof rail
  {
    const g1 = gull();
    g1.position.set(L.davitTop.x, L.davitTop.y + 0.12, L.davitTop.z);
    g1.rotation.y = -2.3;
    root.add(g1);
    const g2 = gull();
    g2.position.set(W / 2 + 0.1, roofTop + 0.33, 7.2);
    g2.rotation.y = 0.9;
    upper.add(g2);
  }

  // =============================================================================================
  // CONTACT SHADOWS: soft decals under the gear and along wall bases (one draw call)
  {
    const tb = L.table,
      cr = L.cradle,
      ht = L.hatch,
      bb = L.baitBox,
      eh = L.engineHatch;
    const blobs: [number, number, number, number][] = [
      [tb.center.x, tb.center.z, tb.half.x * 2 + 0.35, tb.half.z * 2 + 0.35],
      [cr.center.x, cr.center.z, 2.15, 2.15],
      [ht.center.x, ht.center.z, ht.half * 2 + 0.65, ht.half * 2 + 0.65],
      [L.crate.center.x, L.crate.center.z, 1.0, 0.85],
      [bb.center.x, bb.center.z, bb.half.x * 2 + 0.3, bb.half.z * 2 + 0.3],
      [eh.center.x, eh.center.z, eh.half * 2 + 0.25, eh.half * 2 + 0.25],
      [L.coilSpot.x, L.coilSpot.z, 1.15, 1.15],
      [L.launcherLever.x, L.launcherLever.z, 0.6, 0.6],
      [L.davitBase.x + 0.3, L.davitBase.z - 0.25, 0.85, 0.95],
      [L.davitBase.x, L.davitBase.z, 0.6, 0.6],
      // foredeck
      [0, 9.0, 1.15, 0.75],
      [0, 9.78, 0.8, 0.4],
      [1.02, 8.95, 1.0, 1.05],
      [-1.1, 8.86, 0.8, 0.8],
      // stern corners
      [2.3, -9.02, 0.8, 0.8],
      [-2.3, -9.02, 0.8, 0.8],
      [-1.35, -9.0, 0.85, 0.85],
      [1.2, -9.0, 0.85, 0.65],
      // wheelhouse interior
      [L.stove.center.x, L.stove.center.z, 1.0, 0.85],
      [L.galleyTable.center.x - 0.15, L.galleyTable.center.z, 1.3, 1.65],
      [0, 7.3, 2.2, 0.7],
    ];
    for (const [x, z, w, d] of blobs) root.add(aoBlob(x, z, w, d));
    // along the inside of the bulwarks and the transom
    const zs = hullStations(30).filter((z) => hullHalfWidth(z) - BULWARK_T > 0.5);
    for (const side of [1, -1]) {
      for (let i = 0; i < zs.length - 1; i++) {
        const za = Math.max(zs[i], STERN_Z + BULWARK_T),
          zb = zs[i + 1];
        root.add(aoEdge(side * (hullHalfWidth(za) - BULWARK_T), za, side * (hullHalfWidth(zb) - BULWARK_T), zb, -side, 0, 0.42));
      }
    }
    const sx = hullHalfWidth(STERN_Z + BULWARK_T) - BULWARK_T;
    root.add(aoEdge(-sx, STERN_Z + BULWARK_T + 0.01, sx, STERN_Z + BULWARK_T + 0.01, 0, 1, 0.42));
    // around the wheelhouse, outside and in
    const o = 0.045;
    root.add(aoEdge(H.x0 - o, H.z1 + o, H.x1 + o, H.z1 + o, 0, 1, 0.4));
    root.add(aoEdge(H.x1 + o, H.z0, H.x1 + o, H.z1 + o, 1, 0, 0.4));
    root.add(aoEdge(H.x0 - o, H.z0, H.x0 - o, H.z1 + o, -1, 0, 0.4));
    root.add(aoEdge(H.x0 - o, H.z0 - o, -H.doorHalf - 0.08, H.z0 - o, 0, -1, 0.4));
    root.add(aoEdge(H.doorHalf + 0.08, H.z0 - o, H.x1 + o, H.z0 - o, 0, -1, 0.4));
    root.add(aoEdge(H.x0 + t, H.z1 - t, H.x1 - t, H.z1 - t, 0, -1, 0.32));
    root.add(aoEdge(H.x1 - t, H.z0 + t, H.x1 - t, H.z1 - t, -1, 0, 0.32));
    root.add(aoEdge(H.x0 + t, H.z0 + t, H.x0 + t, H.z1 - t, 1, 0, 0.32));
    root.add(aoEdge(H.x0 + t, H.z0 + t, H.x1 - t, H.z0 + t, 0, 1, 0.32));
    // on the roof (fades with it)
    const ry = roofTop + 0.006;
    const roofBlobs: [number, number, number, number][] = [
      [-1.0, 4.55, 1.25, 0.75],
      [-1.6, 3.5, 0.9, 0.65],
      [-0.92, 3.47, 0.62, 0.85],
      [-1.3, 7.15, 0.75, 0.75],
      [1.32, 6.85, 0.85, 0.65],
      [0.25, 4.75, 0.6, 0.6],
      [-0.2, 4.45, 0.55, 0.55],
      [-0.45, 6.3, 0.8, 0.8],
      [-1.15, 5.5, 1.15, 0.95],
      [L.mast.x, L.mast.z, 0.55, 0.55],
    ];
    for (const [x, z, w, d] of roofBlobs) upper.add(aoBlob(x, z, w, d, ry));
  }

  // the deck work light (warm pool over the working deck)
  const lamp = new THREE.PointLight(0xffd59a, 1.4, 9, 1.8);
  lamp.position.set(0, 3.0, 1.5);
  root.add(lamp);

  // =============================================================================================
  // fold static meshes: per-group first (moving parts keep their own pivots), then the boat
  for (const g of [cradle, block, haulerDrum, haulerLever, launcherLever, wheel, hatchLid, spiritGroup]) foldExcept(g, g === spiritGroup ? [tubeMesh, windowMesh, bubble] : []);
  foldExcept(craneHook, []);
  foldExcept(craneBoom, []);
  mergeStatic(upper);
  const cutaway: THREE.Mesh[] = [];
  for (const ch of upper.children) if ((ch as THREE.Mesh).isMesh) cutaway.push(ch as THREE.Mesh);
  mergeStatic(root);

  const spiritLevel = { group: spiritGroup, bubble, window: windowMesh };
  return {
    root,
    cutaway,
    cutawayMats,
    cradle,
    launcherLever,
    haulerLever,
    haulerDrum,
    block,
    wheel,
    craneBoom,
    craneHook,
    stoveGlow,
    windowMat,
    spiritLevel,
    hatchLid,
  };
}

/** mergeStatic for a moving group, keeping the listed meshes (they are animated or swapped). */
function foldExcept(g: THREE.Object3D, keep: THREE.Mesh[]): void {
  for (const k of keep) k.userData.keep = true;
  mergeStatic(g);
}
