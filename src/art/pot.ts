/**
 * makePot(): 2 × 0.9 × 2 m steel crab pot with mesh panels, a door and a bait-jar holder.
 * Origin = pot centre. Handles let gameplay show bait, fullness, door, water streaming.
 */
import * as THREE from 'three';
import { config } from '../config';
import { toon, toonUnique, box, cyl, canvasTexture } from './materials';
import { makeBaitJar } from './items';

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

let meshTex: THREE.CanvasTexture | null = null;
function meshTexture(): THREE.CanvasTexture {
  if (meshTex) return meshTex;
  meshTex = canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(40,52,58,0.85)';
    ctx.lineWidth = 3;
    for (let i = -128; i < 256; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + 128, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
    }
  });
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
  meshTex.repeat.set(3, 1.5);
  return meshTex;
}

export function makePot(): PotView {
  const [W, H, D] = config.fishing.potSize;
  const root = new THREE.Group();
  const steel = toon(0x707c84);
  const t = 0.07;
  // 12 frame bars
  for (const y of [-H / 2 + t / 2, H / 2 - t / 2]) {
    root.add(box(W, t, t, steel, 0, y, -D / 2 + t / 2));
    root.add(box(W, t, t, steel, 0, y, D / 2 - t / 2));
    root.add(box(t, t, D, steel, -W / 2 + t / 2, y, 0));
    root.add(box(t, t, D, steel, W / 2 - t / 2, y, 0));
  }
  for (const x of [-W / 2 + t / 2, W / 2 - t / 2]) for (const z of [-D / 2 + t / 2, D / 2 - t / 2]) root.add(box(t, H, t, steel, x, 0, z));
  // mesh panels
  const meshMat = new THREE.MeshBasicMaterial({ map: meshTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const sidePanel = new THREE.PlaneGeometry(W - t, H - t);
  const topPanel = new THREE.PlaneGeometry(W - t, D - t);
  const mk = (geo: THREE.PlaneGeometry, x: number, y: number, z: number, rx: number, ry: number) => {
    const m = new THREE.Mesh(geo, meshMat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    m.renderOrder = 3;
    root.add(m);
  };
  mk(sidePanel, 0, 0, D / 2 - 0.02, 0, 0);
  mk(sidePanel, 0, 0, -D / 2 + 0.02, 0, 0);
  mk(sidePanel, W / 2 - 0.02, 0, 0, 0, Math.PI / 2);
  mk(sidePanel, -W / 2 + 0.02, 0, 0, 0, Math.PI / 2);
  mk(topPanel, 0, H / 2 - 0.02, 0, Math.PI / 2, 0);
  // floor plate (solid) so it reads from above
  root.add(box(W - 0.1, 0.03, D - 0.1, toon(0x4c565c), 0, -H / 2 + 0.03, 0));
  // tunnels (the entrances) — orange webbing cones
  for (const s of [-1, 1]) {
    const tun = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.34, 0.5, 8, 1, true), toonUnique(0xe8742b, { transparent: true, opacity: 0.7 }));
    tun.rotation.z = (s * Math.PI) / 2;
    tun.position.set(s * (W / 2 - 0.28), -0.05, 0);
    root.add(tun);
  }
  // door on the top (hinged)
  const door = new THREE.Group();
  door.add(box(0.8, 0.04, 0.8, toon(0x8c979e), 0.4, 0, 0));
  door.position.set(-0.4, H / 2 + 0.01, 0);
  root.add(door);
  // bait jar in the middle (hung from the top)
  const bait = makeBaitJar();
  bait.position.set(0, 0.1, 0);
  bait.visible = false;
  root.add(bait);
  // the catch inside (simple silhouettes)
  const catchGroup = new THREE.Group();
  const crabMat = toon(0xc8432f);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), crabMat);
    c.scale.set(1.3, 0.45, 1);
    c.position.set(((i % 3) - 1) * 0.5, -H / 2 + 0.08, (Math.floor(i / 3) - 1) * 0.5);
    c.rotation.y = i;
    c.visible = false;
    catchGroup.add(c);
  }
  root.add(catchGroup);
  // number tag (set when part of a string)
  // water drips when hauled
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
  root.add(drips);

  let label: THREE.Sprite | null = null;
  return {
    root,
    bait,
    door,
    catchGroup,
    drips,
    setFullness(f: number) {
      const k = Math.round(Math.min(1, f) * catchGroup.children.length);
      catchGroup.children.forEach((c, i) => (c.visible = i < k));
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

export function makeStackLashing(): THREE.Group {
  const g = new THREE.Group();
  const strap = toon(0xf2c230);
  g.add(box(6.0, 0.05, 0.06, strap, 0, 1.82, -4.5));
  const c = cyl(0.03, 0.03, 1.8, strap, 6);
  c.position.set(0, 0.9, -4.5);
  return g;
}
