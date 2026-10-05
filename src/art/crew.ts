/**
 * makeCrew(): chunky toy deckhand in a slicker. Each body part is its own Object3D so the
 * same view can be driven by the standing animation or by the 6-body ragdoll.
 * Part origin = its joint pivot; `center` = offset from pivot to the physics body centre.
 */
import * as THREE from 'three';
import { config } from '../config';
import { toon, toonUnique, box, sphere, capsule, cyl, outlineOf } from './materials';

const P = config.palette;

export type PartName = 'legs' | 'pelvis' | 'chest' | 'head' | 'armL' | 'armR';
export type HatStyle = 'beanie' | 'cap' | 'souwester' | 'bobble';

export interface CrewLook {
  name: string;
  slicker: number;
  skin: number;
  hatStyle: HatStyle;
  hatColor: number;
  beard?: number;
  hair?: number;
  boots?: number;
  isPlayer?: boolean;
}

export interface CrewPart {
  obj: THREE.Object3D;
  /** pivot position in the root (standing pose) */
  rest: THREE.Vector3;
  /** body centre relative to the pivot (in part space) */
  center: THREE.Vector3;
  /** ragdoll body shape */
  shape: { type: 'box' | 'ball' | 'capsule'; size: number[] };
  mass: number;
  coloured: THREE.Mesh[];
}

export interface CrewView {
  root: THREE.Group; // standing root = capsule centre
  body: THREE.Group; // lean / wobble group
  parts: Record<PartName, CrewPart>;
  hat: THREE.Group;
  hatRest: THREE.Vector3;
  mittens: THREE.Mesh[];
  ring: THREE.Mesh; // soft ring under the feet (positioned in deck space by the owner)
  bubble: THREE.Mesh; // tiny "!" for warnings (unused by default)
  setSuit(on: boolean): void;
  setHatColor(c: number): void;
  setSlicker(c: number): void;
  setHighlight(on: boolean): void;
  outlines: THREE.Mesh[];
}

export function makeHat(style: HatStyle, color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = toonUnique(color);
  g.userData.mat = mat;
  if (style === 'beanie' || style === 'bobble') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.castShadow = true;
    g.add(dome);
    const cuff = cyl(0.19, 0.19, 0.07, mat, 14);
    cuff.position.y = 0.02;
    g.add(cuff);
    if (style === 'bobble') {
      const pom = sphere(0.07, toon(P.foam), 8);
      pom.position.y = 0.2;
      g.add(pom);
    }
  } else if (style === 'cap') {
    const crown = cyl(0.17, 0.18, 0.12, mat, 14);
    crown.position.y = 0.05;
    g.add(crown);
    const top = cyl(0.21, 0.17, 0.05, mat, 14);
    top.position.y = 0.13;
    g.add(top);
    const brim = box(0.24, 0.025, 0.14, toon(0x1b1d22), 0, 0.0, 0.17);
    g.add(brim);
    const badge = box(0.08, 0.05, 0.01, toon(0xd8b450), 0, 0.07, 0.18);
    g.add(badge);
  } else {
    // sou'wester: floppy brim, longer at the back
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.castShadow = true;
    g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.03, 18), mat);
    brim.position.set(0, 0.0, -0.04);
    brim.rotation.x = -0.12;
    brim.castShadow = true;
    g.add(brim);
  }
  return g;
}

export function makeCrew(look: CrewLook): CrewView {
  const root = new THREE.Group();
  root.name = look.name;
  const body = new THREE.Group();
  root.add(body);

  const slickerMat = toonUnique(look.slicker);
  const darkMat = toon(look.boots ?? 0x2b2f36);
  const skinMat = toon(look.skin);
  const mitMat = toonUnique(0x3c6e8f);
  const coloured: Record<PartName, THREE.Mesh[]> = { legs: [], pelvis: [], chest: [], head: [], armL: [], armR: [] };

  // --- legs (merged), pivot at the hips
  const legs = new THREE.Group();
  const legsRest = new THREE.Vector3(0, -0.28, 0);
  const pants = box(0.46, 0.46, 0.3, slickerMat, 0, -0.2, 0);
  const crease = box(0.04, 0.36, 0.31, toon(0x000000, {}), 0, -0.24, 0);
  crease.material = toonUnique(new THREE.Color(look.slicker).multiplyScalar(0.7).getHex());
  const boots = box(0.48, 0.2, 0.36, darkMat, 0, -0.5, 0.03);
  legs.add(pants, crease, boots);
  coloured.legs.push(pants);
  body.add(legs);
  legs.position.copy(legsRest);

  // --- pelvis
  const pelvis = new THREE.Group();
  const pelvisRest = new THREE.Vector3(0, -0.14, 0);
  const hips = box(0.48, 0.2, 0.32, slickerMat);
  pelvis.add(hips);
  coloured.pelvis.push(hips);
  body.add(pelvis);
  pelvis.position.copy(pelvisRest);

  // --- chest (slicker jacket with toggles)
  const chest = new THREE.Group();
  const chestRest = new THREE.Vector3(0, 0.2, 0);
  const jacket = box(0.58, 0.5, 0.38, slickerMat);
  jacket.geometry = new THREE.BoxGeometry(0.58, 0.5, 0.38, 2, 2, 2);
  const zip = box(0.03, 0.46, 0.02, toon(0x5a4a20), 0, 0, 0.195);
  const collar = box(0.46, 0.1, 0.34, slickerMat, 0, 0.27, 0);
  chest.add(jacket, zip, collar);
  coloured.chest.push(jacket, collar);
  body.add(chest);
  chest.position.copy(chestRest);

  // --- head, pivot at the neck
  const head = new THREE.Group();
  const headRest = new THREE.Vector3(0, 0.47, 0);
  const skull = sphere(0.19, skinMat, 16);
  skull.position.y = 0.16;
  skull.scale.set(1, 0.95, 0.95);
  head.add(skull);
  const eyeMat = toon(0x1a1a1a);
  for (const s of [-1, 1]) {
    const eye = sphere(0.025, eyeMat, 6);
    eye.position.set(s * 0.07, 0.18, 0.165);
    eye.castShadow = false;
    head.add(eye);
    const cheek = sphere(0.03, toonUnique(0xe89a8a, { transparent: true, opacity: 0.6 }), 6);
    cheek.position.set(s * 0.11, 0.12, 0.15);
    cheek.castShadow = false;
    head.add(cheek);
  }
  const nose = sphere(0.04, toon(new THREE.Color(look.skin).multiplyScalar(0.9).getHex()), 8);
  nose.position.set(0, 0.14, 0.19);
  head.add(nose);
  if (look.beard !== undefined) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(look.beard));
    beard.position.set(0, 0.12, 0.03);
    beard.scale.set(1.05, 1.1, 1.1);
    head.add(beard);
  }
  if (look.hair !== undefined) {
    const hair = box(0.3, 0.12, 0.08, toon(look.hair), 0, 0.12, -0.17);
    head.add(hair);
  }
  body.add(head);
  head.position.copy(headRest);

  // --- arms, pivot at the shoulders
  const mittens: THREE.Mesh[] = [];
  const makeArm = (s: number) => {
    const arm = new THREE.Group();
    const sleeve = capsule(0.085, 0.3, slickerMat, 8);
    sleeve.position.y = -0.2;
    const mit = sphere(0.085, mitMat, 8);
    mit.position.y = -0.42;
    mit.scale.set(1, 1.1, 0.9);
    arm.add(sleeve, mit);
    mittens.push(mit);
    coloured[s < 0 ? 'armR' : 'armL'].push(sleeve);
    return arm;
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);
  const armLRest = new THREE.Vector3(0.36, 0.4, 0);
  const armRRest = new THREE.Vector3(-0.36, 0.4, 0);
  armL.position.copy(armLRest);
  armR.position.copy(armRRest);
  body.add(armL, armR);

  // --- hat (separate: flies off on knockdowns)
  const hat = makeHat(look.hatStyle, look.hatColor);
  const hatRest = new THREE.Vector3(0, 0.17 + 0.47 + 0.07, 0);
  hat.position.copy(hatRest);
  body.add(hat);

  // --- soft ring under the feet
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.5, 28),
    new THREE.MeshBasicMaterial({ color: look.isPlayer ? P.slicker : 0xffffff, transparent: true, opacity: look.isPlayer ? 0.75 : 0.35, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  blob.position.z = 0.0;
  ring.add(blob);

  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), toon(P.buoy));
  bubble.visible = false;
  bubble.position.y = 1.3;
  root.add(bubble);

  const parts: Record<PartName, CrewPart> = {
    legs: { obj: legs, rest: legsRest, center: new THREE.Vector3(0, -0.28, 0), shape: { type: 'capsule', size: [0.2, 0.2] }, mass: 26, coloured: coloured.legs },
    pelvis: { obj: pelvis, rest: pelvisRest, center: new THREE.Vector3(0, 0, 0), shape: { type: 'box', size: [0.22, 0.1, 0.15] }, mass: 14, coloured: coloured.pelvis },
    chest: { obj: chest, rest: chestRest, center: new THREE.Vector3(0, 0, 0), shape: { type: 'box', size: [0.27, 0.24, 0.18] }, mass: 22, coloured: coloured.chest },
    head: { obj: head, rest: headRest, center: new THREE.Vector3(0, 0.16, 0), shape: { type: 'ball', size: [0.18] }, mass: 6, coloured: coloured.head },
    armL: { obj: armL, rest: armLRest, center: new THREE.Vector3(0, -0.22, 0), shape: { type: 'capsule', size: [0.18, 0.08] }, mass: 6, coloured: coloured.armL },
    armR: { obj: armR, rest: armRRest, center: new THREE.Vector3(0, -0.22, 0), shape: { type: 'capsule', size: [0.18, 0.08] }, mass: 6, coloured: coloured.armR },
  };

  // outline (player only)
  const outlines: THREE.Mesh[] = [];
  if (look.isPlayer) {
    for (const m of [pants, boots, hips, jacket, skull]) {
      const o = outlineOf(m, 0x1a1a1a, 0.03);
      m.parent!.add(o);
      outlines.push(o);
    }
  }

  let slickerColor = look.slicker;
  const view: CrewView = {
    root,
    body,
    parts,
    hat,
    hatRest,
    mittens,
    ring,
    bubble,
    outlines,
    setSuit(on: boolean) {
      slickerMat.color.setHex(on ? P.buoy : slickerColor);
    },
    setHatColor(c: number) {
      (hat.userData.mat as THREE.MeshToonMaterial).color.setHex(c);
    },
    setSlicker(c: number) {
      slickerColor = c;
      slickerMat.color.setHex(c);
    },
    setHighlight(on: boolean) {
      outlines.forEach((o) => ((o.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xffffff : 0x1a1a1a)));
    },
  };
  return view;
}

/** The four crew looks for the demo. */
export const CREW_LOOKS: Record<'player' | 'mo' | 'dot' | 'ike', CrewLook> = {
  player: { name: 'You', slicker: P.slicker, skin: 0xf1c7a5, hatStyle: 'beanie', hatColor: 0xc8432f, isPlayer: true },
  mo: { name: 'Mo', slicker: 0xe9b62a, skin: 0xe3b493, hatStyle: 'cap', hatColor: 0x23314a, beard: 0xd9d9d9 },
  dot: { name: 'Dot', slicker: 0xf2c230, skin: 0xa8714f, hatStyle: 'bobble', hatColor: 0x2c8c8c, hair: 0x2a1d16 },
  ike: { name: 'Ike', slicker: 0xf5cf3c, skin: 0xf6d2b8, hatStyle: 'souwester', hatColor: 0x4f8a3a, hair: 0xd0782f },
};
