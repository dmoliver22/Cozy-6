/**
 * Light 6-body ragdoll (pelvis, chest, head, 2 arms, merged legs). Pool of at most 3;
 * bodies are pre-created and disabled so knockdowns never allocate.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../config';
import { BodyState, type DeckWorld } from '../deck/deckWorld';
import { CG } from '../deck/groups';
import type { CrewView, PartName } from '../art/crew';

export const PART_NAMES: PartName[] = ['pelvis', 'chest', 'head', 'armL', 'armR', 'legs'];

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Rest geometry shared by all crew (matches art/crew.ts). */
const REST: Record<PartName, { pivot: THREE.Vector3; center: THREE.Vector3; shape: { type: string; size: number[] }; mass: number }> = {
  legs: { pivot: new THREE.Vector3(0, -0.28, 0), center: new THREE.Vector3(0, -0.28, 0), shape: { type: 'capsule', size: [0.2, 0.2] }, mass: 26 },
  pelvis: { pivot: new THREE.Vector3(0, -0.14, 0), center: new THREE.Vector3(0, 0, 0), shape: { type: 'box', size: [0.22, 0.1, 0.15] }, mass: 14 },
  chest: { pivot: new THREE.Vector3(0, 0.2, 0), center: new THREE.Vector3(0, 0, 0), shape: { type: 'box', size: [0.27, 0.24, 0.18] }, mass: 22 },
  head: { pivot: new THREE.Vector3(0, 0.47, 0), center: new THREE.Vector3(0, 0.16, 0), shape: { type: 'ball', size: [0.17] }, mass: 6 },
  armL: { pivot: new THREE.Vector3(0.36, 0.4, 0), center: new THREE.Vector3(0, -0.22, 0), shape: { type: 'capsule', size: [0.16, 0.08] }, mass: 6 },
  armR: { pivot: new THREE.Vector3(-0.36, 0.4, 0), center: new THREE.Vector3(0, -0.22, 0), shape: { type: 'capsule', size: [0.16, 0.08] }, mass: 6 },
};

/** Joints: [parent, child, joint position in root space] */
const JOINTS: [PartName, PartName, THREE.Vector3][] = [
  ['pelvis', 'chest', new THREE.Vector3(0, 0.0, 0)],
  ['chest', 'head', new THREE.Vector3(0, 0.47, 0)],
  ['chest', 'armL', new THREE.Vector3(0.36, 0.4, 0)],
  ['chest', 'armR', new THREE.Vector3(-0.36, 0.4, 0)],
  ['pelvis', 'legs', new THREE.Vector3(0, -0.28, 0)],
];

function centerInRoot(name: PartName): THREE.Vector3 {
  const r = REST[name];
  return r.pivot.clone().add(r.center);
}

export class Ragdoll {
  readonly bodies = {} as Record<PartName, RAPIER.RigidBody>;
  readonly states = {} as Record<PartName, BodyState>;
  readonly colliders: RAPIER.Collider[] = [];
  active = false;
  owner: string | null = null;

  constructor(private dw: DeckWorld, index: number) {
    const w = dw.world;
    for (const name of PART_NAMES) {
      const r = REST[name];
      const c = centerInRoot(name);
      const bd = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(c.x + index * 3, -20 - index * 3, c.z)
        .setLinearDamping(0.35)
        .setAngularDamping(2.2)
        .setCanSleep(false)
        .setCcdEnabled(name === 'chest' || name === 'pelvis');
      const b = w.createRigidBody(bd);
      let cd: RAPIER.ColliderDesc;
      if (r.shape.type === 'box') cd = RAPIER.ColliderDesc.cuboid(r.shape.size[0], r.shape.size[1], r.shape.size[2]);
      else if (r.shape.type === 'ball') cd = RAPIER.ColliderDesc.ball(r.shape.size[0]);
      else cd = RAPIER.ColliderDesc.capsule(r.shape.size[0], r.shape.size[1]);
      cd.setMass(r.mass).setFriction(0.55).setRestitution(0.05).setCollisionGroups(CG.ragdoll);
      const col = w.createCollider(cd, b);
      this.colliders.push(col);
      dw.setOwner(col, { kind: 'ragdoll', ragdoll: this, part: name });
      b.setEnabled(false);
      this.bodies[name] = b;
      this.states[name] = new BodyState();
    }
    for (const [pa, ch, jp] of JOINTS) {
      const a1 = jp.clone().sub(centerInRoot(pa));
      const a2 = jp.clone().sub(centerInRoot(ch));
      const jd = RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z });
      w.createImpulseJoint(jd, this.bodies[pa], this.bodies[ch], true);
    }
  }

  /**
   * Switch on at the crew's current pose. rootP/rootQ = capsule centre transform in local space.
   */
  activate(owner: string, view: CrewView, rootP: THREE.Vector3, rootQ: THREE.Quaternion, vel: THREE.Vector3, spin: THREE.Vector3): void {
    this.active = true;
    this.owner = owner;
    const rootM = _m.compose(rootP, rootQ, new THREE.Vector3(1, 1, 1));
    for (const name of PART_NAMES) {
      const part = view.parts[name];
      // body centre = root * (pivot + partQuat * center); orientation = rootQ * partQuat (ignoring lean group)
      const pq = part.obj.quaternion;
      _p.copy(REST[name].center).applyQuaternion(pq).add(REST[name].pivot).applyMatrix4(rootM);
      _q.copy(rootQ).multiply(pq);
      const b = this.bodies[name];
      b.setEnabled(true);
      b.setTranslation({ x: _p.x, y: _p.y, z: _p.z }, true);
      b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
      // linear velocity + rotational kick (ω × r)
      const r = _p.clone().sub(rootP);
      const v = new THREE.Vector3().crossVectors(spin, r).add(vel);
      b.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      b.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
      this.states[name].reset(_p, _q);
    }
  }

  deactivate(): void {
    this.active = false;
    this.owner = null;
    for (const name of PART_NAMES) {
      const b = this.bodies[name];
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.setTranslation({ x: 0, y: -30, z: 0 }, false);
      b.setEnabled(false);
    }
  }

  capture(): void {
    if (!this.active) return;
    for (const name of PART_NAMES) this.states[name].capture(this.bodies[name]);
  }

  pelvis(out: THREE.Vector3): THREE.Vector3 {
    const t = this.bodies.pelvis.translation();
    return out.set(t.x, t.y, t.z);
  }
  velocity(out: THREE.Vector3): THREE.Vector3 {
    const v = this.bodies.chest.linvel();
    return out.set(v.x, v.y, v.z);
  }
  /** Move every part up by dy and kill downward motion (fell through the deck). */
  lift(dy: number): void {
    for (const name of PART_NAMES) {
      const b = this.bodies[name];
      const t = b.translation();
      const v = b.linvel();
      b.setTranslation({ x: t.x, y: t.y + dy, z: t.z }, true);
      b.setLinvel({ x: v.x, y: Math.max(0, v.y), z: v.z }, true);
    }
  }
  /** Apply the same impulse distributed by mass (wash pushes, vaults). */
  pushAll(dv: THREE.Vector3): void {
    for (const name of PART_NAMES) {
      const b = this.bodies[name];
      const m = b.mass();
      b.applyImpulse({ x: dv.x * m, y: dv.y * m, z: dv.z * m }, true);
    }
  }
  /** Drive part views from body states. */
  pose(view: CrewView, alpha: number, rootInvP: THREE.Vector3, rootInvQ: THREE.Quaternion): void {
    for (const name of PART_NAMES) {
      const part = view.parts[name];
      const st = this.states[name];
      st.interp(alpha, _p, _q);
      // convert local(deck) → root space: inverse root transform
      const pr = _p.sub(rootInvP).applyQuaternion(rootInvQ);
      const qr = new THREE.Quaternion().copy(rootInvQ).multiply(_q);
      // pivot = centre − R*center
      const c = REST[name].center.clone().applyQuaternion(qr);
      part.obj.position.copy(pr).sub(c);
      part.obj.quaternion.copy(qr);
    }
  }
}

export class RagdollPool {
  readonly list: Ragdoll[] = [];
  constructor(dw: DeckWorld) {
    for (let i = 0; i < config.crew.ragdollPool; i++) this.list.push(new Ragdoll(dw, i));
  }
  acquire(): Ragdoll | null {
    return this.list.find((r) => !r.active) ?? null;
  }
  capture(): void {
    for (const r of this.list) r.capture();
  }
}

export { REST as RAGDOLL_REST };
