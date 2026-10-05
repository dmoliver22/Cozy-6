/**
 * makeCat(): Barnacle the boat cat. Grey tabby, white socks, one bent ear.
 * Origin = body centre (physics box). Poses: 'sit' | 'walk' | 'slide' | 'carried' | 'loaf'.
 */
import * as THREE from 'three';
import { toon, sphere, cyl } from './materials';

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

export function makeCat(): CatView {
  const root = new THREE.Group();
  const fur = toon(0x8d8f96);
  const dark = toon(0x55575e);
  const white = toon(0xf2efe8);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.24, 4, 10), fur);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  root.add(body);
  for (let i = 0; i < 3; i++) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.012, 4, 12, Math.PI), dark);
    stripe.position.z = -0.08 + i * 0.08;
    stripe.rotation.z = 0;
    root.add(stripe);
  }
  const head = new THREE.Group();
  const skull = sphere(0.095, fur, 12);
  head.add(skull);
  const muzzle = sphere(0.045, white, 8);
  muzzle.position.set(0, -0.025, 0.075);
  head.add(muzzle);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), fur);
    ear.position.set(s * 0.05, 0.085, 0);
    ear.rotation.z = -s * 0.25;
    if (s > 0) ear.rotation.x = 0.5; // the bent ear
    head.add(ear);
    const eye = sphere(0.016, toon(0x8fcf4a), 6);
    eye.position.set(s * 0.038, 0.015, 0.082);
    head.add(eye);
  }
  const nose = sphere(0.012, toon(0xd88a9a), 6);
  nose.position.set(0, 0.0, 0.115);
  head.add(nose);
  head.position.set(0, 0.07, 0.2);
  root.add(head);
  const tail = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const seg = cyl(0.022, 0.026, 0.09, i % 2 ? dark : fur, 6);
    seg.position.y = 0.045 + i * 0.085;
    seg.rotation.x = 0.15 * i;
    tail.add(seg);
  }
  tail.position.set(0, 0.03, -0.2);
  tail.rotation.x = -0.6;
  root.add(tail);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-0.06, 0.12],
    [0.06, 0.12],
    [-0.06, -0.12],
    [0.06, -0.12],
  ]) {
    const leg = new THREE.Group();
    const l = cyl(0.025, 0.025, 0.12, fur, 6);
    l.position.y = -0.06;
    const paw = sphere(0.03, white, 6);
    paw.position.y = -0.12;
    leg.add(l, paw);
    leg.position.set(x, -0.05, z);
    root.add(leg);
    legs.push(leg);
  }
  const hearts = new THREE.Group();
  root.add(hearts);

  const setPose = (p: CatPose, t: number) => {
    // defaults
    head.rotation.set(0, 0, 0);
    tail.rotation.set(-0.6, 0, 0);
    body.position.set(0, 0, 0);
    body.rotation.set(Math.PI / 2, 0, 0);
    legs.forEach((l, i) => {
      l.rotation.set(0, 0, 0);
      l.position.y = -0.05;
      l.position.x = i % 2 ? 0.06 : -0.06;
    });
    if (p === 'walk') {
      legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 9 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6));
      tail.rotation.set(-0.9 + Math.sin(t * 3) * 0.15, Math.sin(t * 2) * 0.3, 0);
      head.rotation.y = Math.sin(t * 1.3) * 0.2;
    } else if (p === 'sit') {
      body.rotation.x = Math.PI / 2 - 0.6;
      body.position.set(0, 0.04, -0.03);
      legs[2].position.y = -0.03;
      legs[3].position.y = -0.03;
      legs[2].rotation.x = 1.2;
      legs[3].rotation.x = 1.2;
      head.position.set(0, 0.17, 0.13);
      tail.rotation.set(-1.4, 0, Math.sin(t * 1.5) * 0.3);
    } else if (p === 'loaf') {
      legs.forEach((l) => (l.position.y = 0.02));
      head.rotation.x = 0.15;
      tail.rotation.set(-1.5, 0.9, 0);
    } else if (p === 'slide') {
      // belly flat, legs splayed like a starfish
      legs.forEach((l, i) => {
        l.rotation.z = (i % 2 ? 1 : -1) * 1.3;
        l.rotation.x = (i < 2 ? -1 : 1) * 0.6;
        l.position.y = 0;
      });
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
    if (p !== 'sit') head.position.set(0, 0.07, 0.2);
  };
  setPose('sit', 0);
  return { root, head, tail, legs, body, hearts, setPose };
}
