/**
 * Small props: bucket, bait jar, mallet, life ring, grapple, buoys, specials, ice shards.
 * Each factory returns a Group centred on its physics body's centre.
 */
import * as THREE from 'three';
import { config } from '../config';
import { toon, toonUnique, box, cyl, sphere, torus, canvasTexture, basic } from './materials';

const P = config.palette;

export function makeBucket(): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(0x3f8fbf);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 14, 1, true), new THREE.MeshToonMaterial({ color: 0x3f8fbf, side: THREE.DoubleSide }));
  shell.castShadow = true;
  g.add(shell);
  const bottom = cyl(0.16, 0.16, 0.02, mat, 14);
  bottom.position.y = -0.16;
  g.add(bottom);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 4, 16, Math.PI), toon(0x333333));
  handle.position.y = 0.16;
  g.add(handle);
  return g;
}

export function makeBaitJar(): THREE.Group {
  const g = new THREE.Group();
  const glass = cyl(0.09, 0.09, 0.2, toonUnique(0xc9d9a8, { transparent: true, opacity: 0.85 }), 10);
  g.add(glass);
  const lid = cyl(0.095, 0.095, 0.04, toon(0xd23b2b), 10);
  lid.position.y = 0.12;
  g.add(lid);
  for (let i = 0; i < 3; i++) {
    const bit = box(0.05, 0.03, 0.03, toon(0xb0a9a0), -0.03 + i * 0.03, -0.04 + i * 0.04, 0.0);
    bit.rotation.z = i;
    g.add(bit);
  }
  return g;
}

export function makeMallet(): THREE.Group {
  const g = new THREE.Group();
  const handle = cyl(0.025, 0.025, 0.7, toon(P.wood), 8);
  g.add(handle);
  const head = box(0.26, 0.12, 0.12, toon(0x8a5a3a), 0, 0.34, 0);
  g.add(head);
  return g;
}

export function makeLifeRing(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.085, 8, 10, Math.PI / 2), toon(i % 2 ? P.foam : P.buoy));
    arc.rotation.z = (i * Math.PI) / 2;
    arc.castShadow = true;
    g.add(arc);
  }
  g.children.forEach((c) => (c.rotation.x = 0));
  const holder = new THREE.Group();
  holder.add(...g.children.slice());
  holder.rotation.x = Math.PI / 2; // lies flat in its body frame (body is a flat cylinder)
  g.add(holder);
  return g;
}

export function makeGrapple(): THREE.Group {
  const g = new THREE.Group();
  const steel = toon(0x5d666b);
  const shaft = cyl(0.03, 0.03, 0.5, steel, 8);
  g.add(shaft);
  for (let i = 0; i < 4; i++) {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 10, Math.PI * 0.9), steel);
    hook.position.y = -0.2;
    hook.rotation.y = (i * Math.PI) / 2;
    hook.rotation.z = Math.PI;
    g.add(hook);
  }
  const eye = torus(0.05, 0.015, toon(0x333333), 8);
  eye.position.y = 0.28;
  g.add(eye);
  return g;
}

function numberTexture(n: number): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#23262b';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 32, 35);
  });
}

/** A buoy: orange ball with a stick flag and a number. Origin = ball centre. */
export function makeBuoy(n?: number, big = false): THREE.Group {
  const g = new THREE.Group();
  const r = big ? 0.42 : 0.28;
  const ball = sphere(r, toon(P.buoy), 14);
  g.add(ball);
  const band = cyl(r * 1.01, r * 1.01, r * 0.35, toon(P.foam), 14);
  g.add(band);
  if (big) {
    const stick = cyl(0.025, 0.025, 1.3, toon(0x2b2b2b), 6);
    stick.position.y = r + 0.6;
    g.add(stick);
    const flag = box(0.03, 0.22, 0.34, toon(P.buoy), 0, r + 1.1, 0.17);
    g.add(flag);
  }
  if (n !== undefined) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(n), depthTest: false, transparent: true }));
    sp.scale.set(0.7, 0.7, 0.7);
    sp.position.y = big ? r + 1.75 : r + 0.4;
    sp.renderOrder = 10;
    g.add(sp);
  }
  return g;
}

export function makeLineCoil(): THREE.Group {
  const g = new THREE.Group();
  const t = torus(0.13, 0.03, toon(0xd9c27a), 12);
  t.rotation.x = Math.PI / 2;
  g.add(t);
  return g;
}

export function makeIceShardGeometry(): THREE.BufferGeometry {
  return new THREE.TetrahedronGeometry(0.06, 0);
}

// ---- specials ----------------------------------------------------------------

export function makeBottle(): THREE.Group {
  const g = new THREE.Group();
  const glass = toonUnique(0x5fa874, { transparent: true, opacity: 0.75 });
  const b = cyl(0.07, 0.07, 0.24, glass, 10);
  b.rotation.z = Math.PI / 2;
  g.add(b);
  const neck = cyl(0.03, 0.05, 0.1, glass, 8);
  neck.rotation.z = Math.PI / 2;
  neck.position.x = 0.16;
  g.add(neck);
  const cork = cyl(0.03, 0.03, 0.04, toon(0xa07850), 6);
  cork.rotation.z = Math.PI / 2;
  cork.position.x = 0.22;
  g.add(cork);
  const paper = cyl(0.04, 0.04, 0.16, toon(0xf3e6c4), 8);
  paper.rotation.z = Math.PI / 2;
  g.add(paper);
  return g;
}

export function makeOctopus(): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(0xc05a7a);
  const head = sphere(0.18, mat, 12);
  head.scale.set(1, 1.15, 1);
  head.position.y = 0.08;
  g.add(head);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 5, 8, Math.PI * 0.8), mat);
    t.position.set(Math.cos(a) * 0.12, -0.06, Math.sin(a) * 0.12);
    t.rotation.set(Math.PI / 2, 0, -a);
    g.add(t);
  }
  for (const s of [-1, 1]) {
    const eye = sphere(0.035, toon(0xffffff), 6);
    eye.position.set(s * 0.08, 0.12, 0.15);
    g.add(eye);
    const pupil = sphere(0.018, toon(0x111111), 6);
    pupil.position.set(s * 0.08, 0.12, 0.18);
    g.add(pupil);
  }
  return g;
}

export function makeBoot(): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(0x7d9a3a);
  g.add(box(0.14, 0.32, 0.16, mat, 0, 0.06, -0.04));
  g.add(box(0.14, 0.12, 0.3, mat, 0, -0.1, 0.05));
  g.add(box(0.15, 0.03, 0.31, toon(0x2b2b2b), 0, -0.17, 0.05));
  return g;
}

export function makeShipBell(): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.06 + 0.12 * Math.pow(t, 1.6) + (t > 0.9 ? 0.02 : 0), 0.14 - t * 0.28));
  }
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), new THREE.MeshToonMaterial({ color: 0xc9a24a, side: THREE.DoubleSide, emissive: 0x2a1a00 }));
  bell.castShadow = true;
  g.add(bell);
  const crown = torus(0.04, 0.015, toon(0xc9a24a), 8);
  crown.position.y = 0.17;
  g.add(crown);
  return g;
}

export function makeOtter(): THREE.Group {
  const g = new THREE.Group();
  const fur = toon(0x7a5236);
  const belly = toon(0xd9b892);
  const bodyM = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.45, 4, 10), fur);
  bodyM.rotation.x = Math.PI / 2;
  bodyM.castShadow = true;
  g.add(bodyM);
  const tummy = sphere(0.14, belly, 10);
  tummy.scale.set(0.9, 0.5, 1.6);
  tummy.position.y = 0.09;
  g.add(tummy);
  const head = sphere(0.14, fur, 12);
  head.position.set(0, 0.06, 0.36);
  g.add(head);
  const face = sphere(0.1, belly, 10);
  face.position.set(0, 0.04, 0.44);
  face.scale.set(1, 0.8, 0.7);
  g.add(face);
  const nose = sphere(0.025, toon(0x221a14), 6);
  nose.position.set(0, 0.07, 0.51);
  g.add(nose);
  for (const s of [-1, 1]) {
    const eye = sphere(0.022, toon(0x111111), 6);
    eye.position.set(s * 0.06, 0.12, 0.46);
    g.add(eye);
    const paw = sphere(0.045, fur, 6);
    paw.position.set(s * 0.06, 0.15, 0.25);
    g.add(paw);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 8), fur);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.42;
  g.add(tail);
  return g;
}

export function makeJelly(): THREE.Group {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshToonMaterial({ color: 0xb8a6ff, emissive: 0x7a5cff, emissiveIntensity: 0.9, transparent: true, opacity: 0.8 }),
  );
  g.add(dome);
  const tMat = basic(0xcfc2ff, { transparent: true, opacity: 0.7 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.3, 4), tMat);
    t.position.set(Math.cos(a) * 0.1, -0.15, Math.sin(a) * 0.1);
    g.add(t);
  }
  const glow = new THREE.PointLight(0x9b7dff, 1.2, 3, 2);
  g.add(glow);
  return g;
}

export type SpecialKind = 'bottle' | 'octopus' | 'boot' | 'bell' | 'otter' | 'jelly';
export function makeSpecial(kind: SpecialKind): THREE.Group {
  switch (kind) {
    case 'bottle':
      return makeBottle();
    case 'octopus':
      return makeOctopus();
    case 'boot':
      return makeBoot();
    case 'bell':
      return makeShipBell();
    case 'otter':
      return makeOtter();
    case 'jelly':
      return makeJelly();
  }
}

export function makeArrow(color: number): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 10), basic(color, { transparent: true, opacity: 0.9, depthWrite: false }));
  cone.rotation.x = Math.PI;
  g.add(cone);
  return g;
}
