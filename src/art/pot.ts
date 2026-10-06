/**
 * makePot(): 2 × 0.9 × 2 m king-crab pot: a chunky galvanised round-bar frame with orange corner
 * bumpers and skids, galvanised wire-mesh panels (procedural, anti-aliased wire up close that eases
 * into a semi-opaque tinted panel at a distance or on Low, so a stack reads as stacked boxes),
 * light orange-tan webbing entrance tunnels (see-through netting from afar, so a pot reads as a
 * clean wire cage with netting inside; the red catch stands out against it), a single hinged mesh
 * door with a thin rim, and a hanging bait tub with a bait bag.
 * Origin = pot centre. Handles let gameplay show bait, fullness, door, water.
 *
 * Static parts are folded with mergeStatic() (three draw calls per pot plus two for the door); the
 * catch is one instanced mesh.
 */
import * as THREE from 'three';
import { config } from '../config';
import { canvasTexture, mergeStatic, metal, plastic } from './materials';
import { C, K, WEB_SOLID_U, ball, bar, cbox, cylGeo, isLowTier, meshPanelMat, mergeMeshes, pal, tube, webbingMat } from './props';

export interface PotView {
  root: THREE.Group;
  bait: THREE.Object3D;
  door: THREE.Object3D;
  catchGroup: THREE.Group; // little crab silhouettes inside, scaled with fullness
  drips: THREE.Points;
  setFullness(f: number): void;
  setBaited(b: boolean): void;
  setDrip(amount: number): void;
  setNumber(n: number | null): void;
}

/** Wire mesh cells per metre (8 cells per uv unit → ~12 cm cells). */
const MESH_UV_PER_M = 1.05;
/** Webbing diamonds: uv units per metre. */
const WEB_UV_PER_M = 2.6;

/** Open round bar of length `len` along local y (ends hidden by knuckles). */
function rod(r: number, len: number, mat: THREE.Material, seg = 8): THREE.Mesh {
  const m = new THREE.Mesh(cylGeo(r, r, len, seg, true), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function rodX(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8): THREE.Mesh {
  const m = rod(r, len, mat, seg);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function rodY(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8): THREE.Mesh {
  const m = rod(r, len, mat, seg);
  m.position.set(x, y, z);
  return m;
}
function rodZ(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8): THREE.Mesh {
  const m = rod(r, len, mat, seg);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
/**
 * Solid bits drawn with the webbing material: every uv points at a knot (alpha 1). `accent` parts
 * sit at u = WEB_SOLID_U and take the material's solid colour (the orange bumpers and skids).
 */
function solidWeb<T extends THREE.Mesh>(m: T, web: THREE.Material, accent = false): T {
  const g = m.geometry.clone();
  const n = g.attributes.position.count;
  const uv = new Float32Array(n * 2).fill(0.125);
  if (accent) for (let i = 0; i < n; i++) uv[i * 2] = WEB_SOLID_U;
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.geometry = g;
  m.material = web;
  m.castShadow = false;
  return m;
}

function panel(w: number, h: number, uvPerM: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uvPerM, uv.getY(i) * h * uvPerM);
  return g;
}

let crabGeo: THREE.BufferGeometry | null = null;
/** A little low-poly crab (body, legs, claws) for the catch inside the pot. */
function catchCrabGeometry(): THREE.BufferGeometry {
  if (crabGeo) return crabGeo;
  const m = new THREE.MeshBasicMaterial();
  const parts: THREE.Mesh[] = [];
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 5), m);
  body.scale.set(1.35, 0.5, 1);
  body.position.y = 0.05;
  parts.push(body);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.025), m);
      leg.position.set(s * 0.14, 0.03, -0.05 + k * 0.05);
      leg.rotation.set(0, s * (0.3 - k * 0.3), s * -0.35);
      parts.push(leg);
    }
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), m);
    claw.scale.set(1, 0.6, 1.5);
    claw.position.set(s * 0.09, 0.05, 0.13);
    parts.push(claw);
  }
  crabGeo = mergeMeshes(parts);
  return crabGeo;
}

export function makePot(): PotView {
  const [W, H, D] = config.fishing.potSize;
  const low = isLowTier();
  const root = new THREE.Group();
  root.name = 'pot';
  const frame = metal(0xbcc4c8, { rough: 0.4, metalness: 0.6 });
  const wire = meshPanelMat(C.galv, 8, { rough: 0.5, metalness: 0.3, wire: 0.06, panel: 0.45, panelOnly: low });
  // the bumpers and skids (accent parts) are solid orange; the tunnels, tags and bait bag are a
  // lighter orange-tan netting. One material for both, so the merged pot keeps three draw calls
  const web = webbingMat(0xd9955a, C.orange);
  const seg = low ? 6 : 8;
  const r = 0.063; // round bar radius
  const hx = W / 2 - r,
    hy = H / 2 - r,
    hz = D / 2 - r;

  // ---- frame: 12 chunky edges, a slim mid-height belt, orange corner bumpers and skids
  for (const y of [-hy, hy]) {
    for (const z of [-hz, hz]) root.add(rodX(r, 2 * hx, frame, 0, y, z, seg));
    for (const x of [-hx, hx]) root.add(rodZ(r, 2 * hz, frame, x, y, 0, seg));
  }
  for (const x of [-hx, hx]) for (const z of [-hz, hz]) root.add(rodY(r, 2 * hy, frame, x, 0, z, seg));
  for (const z of [-hz, hz]) root.add(rodX(r * 0.45, 2 * hx, frame, 0, 0.02, z, 5));
  for (const x of [-hx, hx]) root.add(rodZ(r * 0.45, 2 * hz, frame, x, 0.02, 0, 5));
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) root.add(solidWeb(ball(r * 1.25, frame, low ? 6 : 8, x, y, z), web, true));
  for (const z of [-0.6, 0.6]) root.add(solidWeb(cbox(W - 0.1, 0.06, 0.12, frame, 0.025, 0, -H / 2 + 0.03, z), web, true));

  // ---- wire mesh at the bar centrelines: four sides, the bottom, and the top around the door
  const sides: [THREE.PlaneGeometry, number, number, number, number, number][] = [
    [panel(2 * hx, 2 * hy, MESH_UV_PER_M), 0, 0, hz, 0, 0],
    [panel(2 * hx, 2 * hy, MESH_UV_PER_M), 0, 0, -hz, 0, 0],
    [panel(2 * hz, 2 * hy, MESH_UV_PER_M), hx, 0, 0, 0, Math.PI / 2],
    [panel(2 * hz, 2 * hy, MESH_UV_PER_M), -hx, 0, 0, 0, Math.PI / 2],
    [panel(2 * hx, 2 * hz, MESH_UV_PER_M), 0, -hy, 0, Math.PI / 2, 0],
  ];
  const dh = 0.42; // half size of the door opening
  const tw = hx - dh; // strips either side of the opening
  sides.push([panel(tw, 2 * hz, MESH_UV_PER_M), -(dh + tw / 2), hy, 0, Math.PI / 2, 0]);
  sides.push([panel(tw, 2 * hz, MESH_UV_PER_M), dh + tw / 2, hy, 0, Math.PI / 2, 0]);
  const td = hz - dh;
  sides.push([panel(2 * dh, td, MESH_UV_PER_M), 0, hy, -(dh + td / 2), Math.PI / 2, 0]);
  sides.push([panel(2 * dh, td, MESH_UV_PER_M), 0, hy, dh + td / 2, Math.PI / 2, 0]);
  for (const [g, x, y, z, rx, ry] of sides) {
    const m = new THREE.Mesh(g, wire);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    m.castShadow = false;
    m.receiveShadow = true;
    root.add(m);
  }

  // ---- entrance tunnels: webbing funnels on two opposite sides (clear of the catch)
  const tunY = -0.05;
  for (const s of [-1, 1]) {
    const len = 0.5;
    const g = new THREE.CylinderGeometry(0.12, 0.29, len, low ? 8 : 12, 1, true);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * 0.24 * WEB_UV_PER_M, uv.getY(i) * len * WEB_UV_PER_M);
    const tun = new THREE.Mesh(g, web);
    tun.rotation.z = (s * Math.PI) / 2;
    tun.position.set(s * (hx - len / 2 + 0.005), tunY, 0);
    tun.castShadow = false;
    root.add(tun);
    // the funnel mouth ring and the trigger bars at the narrow end
    const mouth = solidWeb(new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.024, 3, low ? 8 : 12), web), web);
    mouth.rotation.y = Math.PI / 2;
    mouth.position.set(s * hx, tunY, 0);
    root.add(mouth);
    const tx = s * (hx - len - 0.02);
    root.add(bar(tx, tunY + 0.14, -0.1, tx, tunY - 0.13, -0.1, 0.012, frame, 4));
    root.add(bar(tx, tunY + 0.14, 0.1, tx, tunY - 0.13, 0.1, 0.012, frame, 4));
  }
  // ID tags and the bungee hook that holds the door shut
  root.add(solidWeb(cbox(0.2, 0.12, 0.025, frame, 0.01, W / 2 - 0.34, hy - 0.12, hz + 0.02), web));
  root.add(solidWeb(cbox(0.2, 0.12, 0.025, frame, 0.01, -W / 2 + 0.34, hy - 0.12, -hz - 0.02), web));
  root.add(solidWeb(cbox(0.06, 0.05, 0.18, frame, 0.015, dh + 0.1, hy + 0.04, 0), web));
  root.add(bar(dh + 0.1, hy + 0.06, 0, dh - 0.02, hy + 0.06, 0, 0.012, frame, 4));

  // ---- the door: one hinged mesh panel with a thin rim, lying in the top (hinged on its −x edge;
  // gameplay rotates it about z)
  const door = new THREE.Group();
  door.name = 'dyn:door';
  door.userData.shadowDetail = true; // thin rods: left out of small shadow maps (Stage)
  {
    const ds = 2 * dh + 0.04; // overlaps the opening a little so no gap shows
    const rr = 0.02;
    const dm = new THREE.Mesh(panel(ds, ds, MESH_UV_PER_M), wire);
    dm.rotation.x = Math.PI / 2;
    dm.position.set(ds / 2, 0, 0);
    dm.castShadow = false;
    door.add(dm);
    for (const z of [-ds / 2, ds / 2]) door.add(rodX(rr, ds, frame, ds / 2, 0, z, 5));
    for (const x of [0, ds]) door.add(rodZ(rr, ds, frame, x, 0, 0, 5));
    // hinge knuckles and the latch tab
    for (const z of [-0.25, 0.25]) door.add(ball(0.035, frame, 6, 0, 0, z));
    door.add(cbox(0.06, 0.03, 0.12, frame, 0.01, ds + 0.02, 0.0, 0));
  }
  door.position.set(-dh - 0.02, hy + 0.022, 0);
  root.add(door);

  // ---- bait: a small tub hung from the top centre and a webbing bait bag beside it (shown when
  // baited)
  const bait = new THREE.Group();
  bait.name = 'dyn:bait';
  {
    const tub = new THREE.Group();
    tub.add(pal(tube(0.075, 0.065, 0.11, frame, 10, 0, 0, 0), 0x9c7a5a));
    tub.add(pal(tube(0.08, 0.08, 0.025, frame, 10, 0, 0.062, 0), 0x7d6046));
    bait.add(tub);
    bait.add(bar(0, 0.075, 0, 0, H / 2 - 0.1 - 0.1, 0, 0.008, K.manila(), 4));
    const bag = ball(0.11, web, 10, 0.24, 0.0, 0.05);
    bag.scale.set(1, 1.3, 1);
    bait.add(bag);
    const fish = pal(ball(0.08, frame, 8, 0.24, -0.01, 0.05), 0xa9bcc4);
    fish.scale.set(0.6, 1.2, 0.6);
    bait.add(fish);
    bait.add(bar(0.24, 0.13, 0.05, 0.24, H / 2 - 0.2, 0.05, 0.008, K.manila(), 4));
  }
  bait.position.set(0, 0.1, 0);
  bait.visible = false;
  root.add(bait);

  // ---- the catch inside: one instanced mesh, shown up to `count`
  const catchGroup = new THREE.Group();
  catchGroup.name = 'dyn:catch';
  const MAXC = 9;
  const catchMesh = new THREE.InstancedMesh(catchCrabGeometry(), plastic(0xd8452c, { rough: 0.4 }), MAXC);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < MAXC; i++) {
      const x = ((i % 3) - 1) * 0.4 + Math.sin(i * 2.3) * 0.06;
      const z = (Math.floor(i / 3) - 1) * 0.5 + Math.cos(i * 1.7) * 0.08;
      e.set(0, i * 1.9, Math.sin(i) * 0.15);
      m.compose(new THREE.Vector3(x, -H / 2 + 0.06, z), q.setFromEuler(e), new THREE.Vector3(1, 1, 1).multiplyScalar(0.9 + (i % 4) * 0.08));
      catchMesh.setMatrixAt(i, m);
    }
    catchMesh.count = 0;
    catchMesh.visible = false;
    catchMesh.castShadow = false;
    catchMesh.receiveShadow = true;
    catchMesh.frustumCulled = false;
  }
  catchGroup.add(catchMesh);
  root.add(catchGroup);

  // ---- water drips when hauled
  const n = 60;
  const dripGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * W;
    pos[i * 3 + 1] = -Math.random() * 1.5 - H / 2;
    pos[i * 3 + 2] = (Math.random() - 0.5) * D;
  }
  dripGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const drips = new THREE.Points(dripGeo, new THREE.PointsMaterial({ color: 0xdff4f4, size: 0.09, transparent: true, opacity: 0.0, depthWrite: false }));
  drips.frustumCulled = false;
  drips.visible = false;
  root.add(drips);

  // fold the static frame, mesh and webbing (the door, bait and catch keep their own transforms)
  mergeStatic(door);
  mergeStatic(bait);
  mergeStatic(root);
  for (const o of [...root.children, ...door.children]) {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material === wire) mesh.castShadow = false;
  }

  let label: THREE.Sprite | null = null;
  return {
    root,
    bait,
    door,
    catchGroup,
    drips,
    setFullness(f: number) {
      const k = Math.round(Math.min(1, Math.max(0, f)) * MAXC);
      catchMesh.count = k;
      catchMesh.visible = k > 0;
    },
    setBaited(b: boolean) {
      bait.visible = b;
    },
    setDrip(a: number) {
      (drips.material as THREE.PointsMaterial).opacity = a;
      drips.visible = a > 0.01;
    },
    setNumber(num: number | null) {
      if (label) {
        root.remove(label);
        label = null;
      }
      if (num === null) return;
      const tex = canvasTexture(64, 64, (ctx) => {
        ctx.fillStyle = '#e8742b';
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fff3e0';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 38px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(num), 32, 35);
      });
      label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      label.scale.setScalar(0.5);
      label.position.set(0, H / 2 + 0.4, 0);
      root.add(label);
    },
  };
}

/** A ratchet strap across the stack (yellow webbing). */
export function makeStackLashing(): THREE.Group {
  const g = new THREE.Group();
  const strap = plastic(0xf2c230, { rough: 0.7 });
  g.add(cbox(6.0, 0.05, 0.06, strap, 0.015, 0, 1.82, -4.5));
  return g;
}
