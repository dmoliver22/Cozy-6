/**
 * makeBoat(): the Puffin, a chunky toy crabber built from code geometry.
 * Returns the static boat art plus handles to the moving/fading parts.
 */
import * as THREE from 'three';
import { config } from '../config';
import { HOUSE, L, STERN_Z, BOW_Z, hullHalfWidth, railHeight, BULWARK_T } from '../boat/layout';
import { toon, toonUnique, box, cyl, canvasTexture, hex, torus } from './materials';

const P = config.palette;

export interface BoatArt {
  root: THREE.Group;
  /** Parts that fade for the dollhouse cutaway. */
  cutaway: THREE.Mesh[];
  cutawayMats: THREE.MeshToonMaterial[];
  cradle: THREE.Group; // tilts to launch/tip
  launcherLever: THREE.Object3D;
  haulerLever: THREE.Object3D;
  haulerDrum: THREE.Object3D;
  block: THREE.Object3D;
  wheel: THREE.Object3D;
  craneBoom: THREE.Group;
  craneHook: THREE.Object3D;
  stoveGlow: THREE.PointLight | null;
  windowMat: THREE.MeshToonMaterial;
  spiritLevel: { group: THREE.Group; bubble: THREE.Mesh; window: THREE.Mesh };
  hatchLid: THREE.Object3D;
}

function hullGeometry(): THREE.BufferGeometry {
  // Loft cross-sections from stern to bow. Profile: gunwale → deck-level side → waterline → bilge → keel (mirrored).
  const stations = 36;
  const prof: [number, number][] = [
    [1.0, -1], // gunwale (y = rail top)
    [1.0, 0.0],
    [0.985, 0.33],
    [0.9, 0.62],
    [0.62, 0.85],
    [0.1, 1.0], // keel
  ];
  const ring: [number, number][] = [...prof, ...prof.slice(0, -1).reverse().map(([x, t]) => [-x, t] as [number, number])];
  const rn = ring.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const z = STERN_Z + ((BOW_Z - STERN_Z) * i) / stations;
    const hw = Math.max(0.03, hullHalfWidth(z));
    const top = railHeight(z) + 0.02;
    const bowT = THREE.MathUtils.smoothstep(z, 3, BOW_Z);
    const keel = THREE.MathUtils.lerp(-2.7, -0.9, Math.pow(bowT, 1.5)); // the forefoot rakes up
    for (let j = 0; j < rn; j++) {
      const [xf, t] = ring[j];
      const y = t < 0 ? top : THREE.MathUtils.lerp(0, keel, t);
      pos.push(xf * hw, y, z);
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < rn - 1; j++) {
      const a = i * rn + j;
      const b = a + 1;
      const c = a + rn;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // transom cap (fan from the port gunwale)
  for (let j = 1; j < rn - 2; j++) idx.push(0, j, j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
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

function plankTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = hex(P.deck);
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16; i++) {
      const shade = 0.9 + ((i * 37) % 7) * 0.025;
      ctx.fillStyle = `rgba(${Math.floor(156 * shade)},${Math.floor(122 * shade)},${Math.floor(88 * shade)},1)`;
      ctx.fillRect(i * 16 + 1, 0, 14, 256);
      ctx.fillStyle = 'rgba(60,40,25,0.35)';
      ctx.fillRect(i * 16, 0, 1.5, 256);
      ctx.fillRect(i * 16, ((i * 71) % 256), 16, 1.5);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.18, 0.08); // UVs are in metres (shape coords)
  return t;
}

export function makeBoat(): BoatArt {
  const root = new THREE.Group();
  root.name = 'Puffin';

  // --- hull
  const hullMat = toon(P.hull);
  const hull = new THREE.Mesh(hullGeometry(), hullMat);
  hull.material = new THREE.MeshToonMaterial({ color: P.hull, gradientMap: (hullMat as THREE.MeshToonMaterial).gradientMap, side: THREE.DoubleSide });
  hull.castShadow = true;
  root.add(hull);
  // boot stripe (waterline) and name band
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.06, 4, 48),
    toon(P.cream),
  );
  stripe.visible = false;
  root.add(stripe);
  // gunwale cap (white rail on top of the bulwark)
  const capMat = toon(P.cream);
  const n = 26;
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const z0 = STERN_Z + ((BOW_Z - STERN_Z) * i) / n;
      const z1 = STERN_Z + ((BOW_Z - STERN_Z) * (i + 1)) / n;
      const x0 = side * (hullHalfWidth(z0) - BULWARK_T / 2);
      const x1 = side * (hullHalfWidth(z1) - BULWARK_T / 2);
      const y0 = railHeight(z0) + 0.04,
        y1 = railHeight(z1) + 0.04;
      const len = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
      if (len < 0.01) continue;
      const seg = box(0.2, 0.08, len + 0.02, capMat);
      seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      seg.lookAt(x1, y1, z1);
      root.add(seg);
      // inner bulwark face (painted lighter)
      const h = (y0 + y1) / 2 - 0.04;
      const wall = box(BULWARK_T, h, len + 0.02, toon(0xd9cfb8));
      wall.position.set((x0 + x1) / 2 - side * 0.02, h / 2, (z0 + z1) / 2);
      wall.lookAt(x1 - side * 0.02, h / 2, z1);
      wall.castShadow = false;
      root.add(wall);
    }
  }
  // transom wall
  const transom = box(2 * hullHalfWidth(STERN_Z) - 0.1, 1.0, BULWARK_T, toon(0xd9cfb8), 0, 0.5, STERN_Z + 0.08);
  root.add(transom);
  const transomCap = box(2 * hullHalfWidth(STERN_Z), 0.08, 0.2, capMat, 0, 1.04, STERN_Z + 0.08);
  root.add(transomCap);

  // name on the transom
  const nameTex = canvasTexture(512, 96, (ctx) => {
    ctx.fillStyle = hex(P.hull);
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = hex(P.cream);
    ctx.font = 'bold 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PUFFIN', 256, 42);
    ctx.font = '22px Georgia, serif';
    ctx.fillText('KITTIWAKE HBR', 256, 80);
  });
  const namePlate = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), new THREE.MeshBasicMaterial({ map: nameTex }));
  namePlate.position.set(0, 0.35, STERN_Z - 0.02);
  namePlate.rotation.y = Math.PI;
  root.add(namePlate);

  // --- deck
  const deckMat = new THREE.MeshToonMaterial({ color: 0xffffff, map: plankTexture() });
  const deck = new THREE.Mesh(deckGeometry(), deckMat);
  deck.position.y = 0.001;
  deck.receiveShadow = true;
  root.add(deck);
  // scuppers (little dark slots along the bulwark base)
  const scupMat = toon(0x2b2f33);
  for (const side of [1, -1]) {
    for (let z = -8; z < 3; z += 2.2) {
      const s = box(0.04, 0.12, 0.45, scupMat, side * (hullHalfWidth(z) - BULWARK_T - 0.01), 0.06, z);
      s.castShadow = false;
      root.add(s);
    }
  }

  // --- wheelhouse (dollhouse: roof + upper walls fade)
  const cutaway: THREE.Mesh[] = [];
  const cutawayMats: THREE.MeshToonMaterial[] = [];
  const wallMat = toonUnique(P.cream, { transparent: true });
  const upperMat = toonUnique(P.cream, { transparent: true });
  const roofMat = toonUnique(P.roof, { transparent: true });
  cutawayMats.push(upperMat, roofMat);
  const H = HOUSE;
  const lowerH = 1.05;
  const W = H.x1 - H.x0;
  const D = H.z1 - H.z0;
  // lower walls (always solid)
  const lowerParts: THREE.Mesh[] = [
    box(W, lowerH, H.wallT, wallMat, 0, lowerH / 2, H.z1 - H.wallT / 2), // front
    box(H.wallT, lowerH, D, wallMat, H.x0 + H.wallT / 2, lowerH / 2, (H.z0 + H.z1) / 2), // stbd
    box(H.wallT, lowerH, D, wallMat, H.x1 - H.wallT / 2, lowerH / 2, (H.z0 + H.z1) / 2), // port
    box(-H.doorHalf - H.x0, lowerH, H.wallT, wallMat, (H.x0 - H.doorHalf) / 2, lowerH / 2, H.z0 + H.wallT / 2), // aft stbd
    box(H.x1 - H.doorHalf, lowerH, H.wallT, wallMat, (H.x1 + H.doorHalf) / 2, lowerH / 2, H.z0 + H.wallT / 2), // aft port
  ];
  lowerParts.forEach((m) => root.add(m));
  // upper walls with window band
  const upH = H.wallH - lowerH;
  const upY = lowerH + upH / 2;
  const windowMat = toonUnique(P.amber, { emissive: P.amber });
  windowMat.emissiveIntensity = 0.9;
  const upper: THREE.Mesh[] = [
    box(W, upH, H.wallT, upperMat, 0, upY, H.z1 - H.wallT / 2),
    box(H.wallT, upH, D, upperMat, H.x0 + H.wallT / 2, upY, (H.z0 + H.z1) / 2),
    box(H.wallT, upH, D, upperMat, H.x1 - H.wallT / 2, upY, (H.z0 + H.z1) / 2),
    box(-H.doorHalf - H.x0, upH, H.wallT, upperMat, (H.x0 - H.doorHalf) / 2, upY, H.z0 + H.wallT / 2),
    box(H.x1 - H.doorHalf, upH, H.wallT, upperMat, (H.x1 + H.doorHalf) / 2, upY, H.z0 + H.wallT / 2),
    box(H.doorHalf * 2, H.wallH - H.doorH, H.wallT, upperMat, 0, H.doorH + (H.wallH - H.doorH) / 2, H.z0 + H.wallT / 2),
  ];
  upper.forEach((m) => {
    root.add(m);
    cutaway.push(m);
  });
  // windows: glowing amber panes (front 3, sides 2 each, aft 2)
  const winGeo = new THREE.PlaneGeometry(0.8, 0.55);
  const addWin = (x: number, y: number, z: number, ry: number) => {
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(winGeo, windowMat);
      w.position.set(x, y, z);
      w.rotation.y = ry + (s < 0 ? Math.PI : 0);
      // offset slightly out of the wall on both faces
      const n = new THREE.Vector3(0, 0, 1).applyEuler(w.rotation).multiplyScalar(H.wallT / 2 + 0.01);
      w.position.add(n);
      root.add(w);
      cutaway.push(w);
    }
  };
  for (const x of [-1.1, 0, 1.1]) addWin(x, 1.6, H.z1 - H.wallT / 2, 0);
  for (const z of [4.4, 6.4]) {
    addWin(H.x1 - H.wallT / 2, 1.6, z, Math.PI / 2);
    addWin(H.x0 + H.wallT / 2, 1.6, z, -Math.PI / 2);
  }
  addWin(-1.25, 1.65, H.z0 + H.wallT / 2, Math.PI);
  addWin(1.25, 1.65, H.z0 + H.wallT / 2, Math.PI);
  // roof with a little overhang + railing + radar + horn
  const roof = box(W + 0.4, 0.14, D + 0.5, roofMat, 0, H.roofY, (H.z0 + H.z1) / 2 + 0.1);
  root.add(roof);
  cutaway.push(roof);
  const radar = box(1.1, 0.08, 0.16, toon(0xeeeeee), 0, H.roofY + 0.5, 6.2);
  const radarPost = cyl(0.05, 0.05, 0.45, toon(0x888888));
  radarPost.position.set(0, H.roofY + 0.25, 6.2);
  root.add(radar, radarPost);
  cutaway.push(radar, radarPost);
  // the door frame
  const frame = box(H.doorHalf * 2 + 0.1, 0.08, 0.16, toon(P.roof), 0, H.doorH, H.z0 + 0.06);
  root.add(frame);

  // interior: floor rug, stove, galley table, helm console, wheel, hat hook
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), toon(0x8a4a3a));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.1, 0.012, 5.3);
  root.add(rug);
  const st = L.stove;
  const stove = box(st.half.x * 2, st.half.y * 2, st.half.z * 2, toon(0x2e3338), st.center.x, st.half.y, st.center.z);
  root.add(stove);
  const stoveFire = box(0.36, 0.2, 0.02, toonUnique(0xff8a3d, { emissive: 0xff6a1a }), st.center.x, 0.38, st.center.z - st.half.z - 0.012);
  root.add(stoveFire);
  const pipe = cyl(0.07, 0.07, 1.6, toon(0x2e3338));
  pipe.position.set(st.center.x + 0.1, 1.6, st.center.z + 0.05);
  root.add(pipe);
  const kettle = cyl(0.12, 0.15, 0.2, toon(0x5d8a8c));
  kettle.position.set(st.center.x - 0.1, st.half.y * 2 + 0.1, st.center.z);
  root.add(kettle);
  const gt = L.galleyTable;
  root.add(box(gt.half.x * 2, 0.06, gt.half.z * 2, toon(P.wood), gt.center.x, gt.half.y * 2, gt.center.z));
  root.add(box(0.12, gt.half.y * 2, 0.12, toon(P.wood), gt.center.x, gt.half.y, gt.center.z));
  root.add(box(0.4, 0.42, 1.3, toon(0x6b4b35), gt.center.x - 0.42, 0.21, gt.center.z));
  const mug = cyl(0.05, 0.05, 0.1, toon(P.slicker));
  mug.position.set(gt.center.x + 0.1, gt.half.y * 2 + 0.08, gt.center.z - 0.2);
  root.add(mug);
  const helm = box(1.9, 1.0, 0.45, toon(0x4a5560), 0, 0.5, 7.33);
  root.add(helm);
  const screen = box(0.5, 0.3, 0.02, toonUnique(0x60d0a0, { emissive: 0x2a8a60 }), 0.55, 1.05, 7.1);
  screen.rotation.x = -0.4;
  root.add(screen);
  const wheel = new THREE.Group();
  const wheelRim = torus(0.32, 0.035, toon(P.wood), 18);
  wheel.add(wheelRim);
  for (let i = 0; i < 6; i++) {
    const spoke = box(0.04, 0.8, 0.04, toon(P.wood));
    spoke.rotation.z = (i * Math.PI) / 6;
    wheel.add(spoke);
  }
  wheel.position.copy(L.wheel);
  root.add(wheel);
  const hatHook = cyl(0.025, 0.025, 0.2, toon(0x333333));
  hatHook.rotation.x = Math.PI / 2;
  hatHook.position.copy(L.hatHook);
  root.add(hatHook);
  // ship's bell (galley decor slot) is added by the galley when won; the boat has a brass bell on the mast
  let stoveGlow: THREE.PointLight | null = new THREE.PointLight(P.amber, 2.2, 5, 1.6);
  stoveGlow.position.set(st.center.x - 0.3, 0.9, st.center.z - 0.4);
  root.add(stoveGlow);

  // --- mast, crane boom and hook (used for the comedic crane rescue)
  const mast = cyl(0.12, 0.15, 6.2, toon(P.cream));
  mast.position.set(L.mast.x, 3.1, L.mast.z);
  root.add(mast);
  const bell = cyl(0.12, 0.18, 0.22, toon(0xc9a24a));
  bell.position.set(L.mast.x + 0.25, 2.9, L.mast.z);
  root.add(bell);
  const lightTop = box(0.18, 0.18, 0.18, toonUnique(0xfff1c0, { emissive: 0xffd27a }), L.mast.x, 6.25, L.mast.z);
  root.add(lightTop);
  const craneBoom = new THREE.Group();
  craneBoom.position.set(L.mast.x, 3.6, L.mast.z);
  const boom = box(0.16, 0.16, 5.2, toon(P.slicker), 0, 0, -2.5);
  craneBoom.add(boom);
  const craneHook = new THREE.Group();
  const hookShape = torus(0.12, 0.03, toon(0x333333), 10);
  hookShape.rotation.y = Math.PI / 2;
  craneHook.add(hookShape);
  craneHook.position.set(0, -0.8, -5.0);
  craneBoom.add(craneHook);
  craneBoom.rotation.x = -0.35;
  root.add(craneBoom);

  // --- davit + block + hauler
  const steel = toon(P.steel);
  const post = cyl(0.13, 0.15, L.davitTop.y, steel);
  post.position.set(L.davitBase.x, L.davitTop.y / 2, L.davitBase.z);
  root.add(post);
  const armLen = L.davitTop.distanceTo(L.block);
  const arm = box(0.16, 0.16, armLen, steel);
  arm.position.copy(L.davitTop).lerp(L.block, 0.5);
  arm.lookAt(L.block);
  root.add(arm);
  const block = new THREE.Group();
  const sheave = cyl(0.32, 0.32, 0.16, toon(P.slicker), 16);
  sheave.rotation.z = Math.PI / 2;
  block.add(sheave);
  const sheaveHub = cyl(0.08, 0.08, 0.2, toon(0x333333), 8);
  sheaveHub.rotation.z = Math.PI / 2;
  block.add(sheaveHub);
  block.position.copy(L.block);
  root.add(block);
  const haulerDrum = new THREE.Group();
  const drum = cyl(0.22, 0.22, 0.4, toon(P.slicker), 12);
  drum.rotation.z = Math.PI / 2;
  haulerDrum.add(drum);
  haulerDrum.position.set(L.davitBase.x + 0.3, 0.7, L.davitBase.z - 0.25);
  root.add(haulerDrum);
  const haulerLever = new THREE.Group();
  const hl = box(0.06, 0.55, 0.06, toon(0x2b2b2b), 0, 0.27, 0);
  const hk = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), toon(0xd23b2b));
  hk.position.y = 0.56;
  haulerLever.add(hl, hk);
  haulerLever.position.copy(L.haulerLever).setY(0.75);
  root.add(haulerLever);

  // --- launcher cradle (tilts outboard to launch, inboard to tip)
  const cradle = new THREE.Group();
  const c = L.cradle;
  // pivot about the cradle's centre line at rail height
  cradle.position.copy(c.center);
  const cradleMat = toon(0x55606a);
  cradle.add(box(c.half.x * 2, c.half.y * 2, 0.12, cradleMat, 0, 0, -c.half.z + 0.06));
  cradle.add(box(c.half.x * 2, c.half.y * 2, 0.12, cradleMat, 0, 0, c.half.z - 0.06));
  for (let i = -2; i <= 2; i++) cradle.add(box(0.08, 0.08, c.half.z * 2, cradleMat, i * 0.45, 0, 0));
  cradle.add(box(0.12, 0.35, c.half.z * 2, toon(P.slicker), -c.half.x - 0.02, 0.14, 0)); // outboard stop
  root.add(cradle);
  // cradle support legs
  for (const z of [c.center.z - 0.8, c.center.z + 0.8]) {
    root.add(box(0.12, c.center.y, 0.12, cradleMat, c.center.x + 0.6, c.center.y / 2, z));
  }
  const launcherLever = new THREE.Group();
  const ll = box(0.06, 0.6, 0.06, toon(0x2b2b2b), 0, 0.3, 0);
  const lk = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), toon(0xd23b2b));
  lk.position.y = 0.62;
  launcherLever.add(ll, lk);
  launcherLever.position.copy(L.launcherLever).setY(0.35);
  root.add(launcherLever);
  root.add(box(0.3, 0.35, 0.3, toon(0x4a5560), L.launcherLever.x, 0.18, L.launcherLever.z));

  // --- spirit level on the rail by the cradle
  const spiritGroup = new THREE.Group();
  const tube = box(0.9, 0.12, 0.12, toonUnique(0xd8f0e0, { transparent: true, opacity: 0.85 }));
  spiritGroup.add(tube);
  const windowMesh = box(0.2, 0.13, 0.13, toonUnique(0x58c46a, { emissive: 0x1d6a2a, transparent: true, opacity: 0.55 }));
  spiritGroup.add(windowMesh);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toonUnique(0xffffff, { emissive: 0x99ffcc }));
  spiritGroup.add(bubble);
  spiritGroup.position.set(-2.95, 1.2, -0.25);
  spiritGroup.rotation.y = Math.PI / 2; // tube runs athwartships so it shows roll
  root.add(spiritGroup);

  // --- sorting table
  const t = L.table;
  root.add(box(t.half.x * 2, 0.08, t.half.z * 2, toon(0x7d8b92), t.center.x, t.center.y - 0.04, t.center.z));
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    root.add(box(0.08, t.center.y, 0.08, cradleMat, t.center.x + dx * (t.half.x - 0.1), t.center.y / 2, t.center.z + dz * (t.half.z - 0.1)));
  }
  root.add(box(0.06, 0.12, t.half.z * 2, toon(0x7d8b92), t.center.x + t.half.x, t.center.y + 0.04, t.center.z)); // port lip
  root.add(box(t.half.x * 2, 0.12, 0.06, toon(0x7d8b92), t.center.x, t.center.y + 0.04, t.center.z - t.half.z)); // aft lip
  root.add(box(t.half.x * 2, 0.12, 0.06, toon(0x7d8b92), t.center.x, t.center.y + 0.04, t.center.z + t.half.z)); // fwd lip

  // --- tank hatch
  const h = L.hatch;
  const coamingMat = toon(0x55606a);
  root.add(box(h.half * 2 + 0.2, h.coaming, 0.1, coamingMat, h.center.x, h.coaming / 2, h.center.z - h.half - 0.05));
  root.add(box(h.half * 2 + 0.2, h.coaming, 0.1, coamingMat, h.center.x, h.coaming / 2, h.center.z + h.half + 0.05));
  root.add(box(0.1, h.coaming, h.half * 2, coamingMat, h.center.x - h.half - 0.05, h.coaming / 2, h.center.z));
  root.add(box(0.1, h.coaming, h.half * 2, coamingMat, h.center.x + h.half + 0.05, h.coaming / 2, h.center.z));
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(h.half * 2, h.half * 2), new THREE.MeshBasicMaterial({ color: 0x0d2a30 }));
  hole.rotation.x = -Math.PI / 2;
  hole.position.set(h.center.x, 0.02, h.center.z);
  root.add(hole);
  const waterIn = new THREE.Mesh(new THREE.PlaneGeometry(h.half * 2, h.half * 2), new THREE.MeshBasicMaterial({ color: 0x1f5c66, transparent: true, opacity: 0.7 }));
  waterIn.rotation.x = -Math.PI / 2;
  waterIn.position.set(h.center.x, 0.03, h.center.z);
  root.add(waterIn);
  const hatchLid = box(h.half * 2 + 0.2, 0.06, h.half * 2 + 0.2, toon(0x6b7a80));
  hatchLid.position.set(h.center.x - h.half - 0.2, h.coaming + 0.3, h.center.z);
  hatchLid.rotation.z = 1.3;
  root.add(hatchLid);

  // --- curiosity crate
  const cr = L.crate;
  const crateMat = toon(P.wood);
  root.add(box(cr.half.x * 2, 0.06, cr.half.z * 2, crateMat, cr.center.x, 0.03, cr.center.z));
  root.add(box(cr.half.x * 2, cr.half.y * 2, 0.06, crateMat, cr.center.x, cr.half.y, cr.center.z - cr.half.z));
  root.add(box(cr.half.x * 2, cr.half.y * 2, 0.06, crateMat, cr.center.x, cr.half.y, cr.center.z + cr.half.z));
  root.add(box(0.06, cr.half.y * 2, cr.half.z * 2, crateMat, cr.center.x - cr.half.x, cr.half.y, cr.center.z));
  root.add(box(0.06, cr.half.y * 2, cr.half.z * 2, crateMat, cr.center.x + cr.half.x, cr.half.y, cr.center.z));
  const crateLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.22),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 72, (ctx) => {
        ctx.fillStyle = '#e9dcc0';
        ctx.fillRect(0, 0, 256, 72);
        ctx.fillStyle = '#5a3a22';
        ctx.font = 'bold 34px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('CURIOS', 128, 48);
      }),
    }),
  );
  crateLabel.position.set(cr.center.x, cr.half.y, cr.center.z - cr.half.z - 0.04);
  crateLabel.rotation.y = Math.PI;
  root.add(crateLabel);

  // --- bait box (jars spawn from here)
  const bb = L.baitBox;
  root.add(box(bb.half.x * 2, bb.half.y * 2, bb.half.z * 2, toon(0x3f7f88), bb.center.x, bb.half.y, bb.center.z));
  for (let i = 0; i < 3; i++) {
    const jar = cyl(0.09, 0.09, 0.2, toonUnique(0xc8d8b0, { transparent: true, opacity: 0.9 }), 10);
    jar.position.set(bb.center.x - 0.2 + i * 0.2, bb.half.y * 2 + 0.08, bb.center.z);
    root.add(jar);
  }

  // --- engine hatch (cat's warm spot), coil of line
  const eh = L.engineHatch;
  root.add(box(eh.half * 2, 0.12, eh.half * 2, toon(0x5f6b70), eh.center.x, 0.06, eh.center.z));
  for (let i = 0; i < 4; i++) root.add(box(eh.half * 1.6, 0.02, 0.05, toon(0x30363a), eh.center.x, 0.125, eh.center.z - 0.3 + i * 0.2));
  const coil = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const r = torus(0.42 - i * 0.02, 0.05, toon(0xd9c27a), 18);
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.05 + i * 0.09;
    coil.add(r);
  }
  coil.position.copy(L.coilSpot);
  root.add(coil);

  // --- deck lights on the mast, wheelhouse lamp
  const lamp = new THREE.PointLight(0xffd59a, 1.4, 9, 1.8);
  lamp.position.set(0, 3.0, 1.5);
  root.add(lamp);

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
