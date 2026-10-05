/**
 * Everything on the boat simulates in BOAT-LOCAL coordinates in one Rapier world.
 * Each step: g_local = R⁻¹ · (g − a_boat), plus per-body tangential/centrifugal terms
 * from the boat's angular motion. Roll tilts gravity → things slide downhill; a bow lift slams things aft.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../config';
import type { Boat } from '../boat/boat';
import { CG } from './groups';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _r = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Previous/current transform pair for render interpolation. */
export class BodyState {
  readonly prevP = new THREE.Vector3();
  readonly prevQ = new THREE.Quaternion();
  readonly currP = new THREE.Vector3();
  readonly currQ = new THREE.Quaternion();
  reset(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }): void {
    this.currP.set(p.x, p.y, p.z);
    this.currQ.set(q.x, q.y, q.z, q.w);
    this.prevP.copy(this.currP);
    this.prevQ.copy(this.currQ);
  }
  capture(body: RAPIER.RigidBody): void {
    this.prevP.copy(this.currP);
    this.prevQ.copy(this.currQ);
    const t = body.translation();
    const r = body.rotation();
    this.currP.set(t.x, t.y, t.z);
    this.currQ.set(r.x, r.y, r.z, r.w);
  }
  interp(alpha: number, outP: THREE.Vector3, outQ: THREE.Quaternion): void {
    outP.lerpVectors(this.prevP, this.currP, alpha);
    outQ.slerpQuaternions(this.prevQ, this.currQ, alpha);
  }
}

export type ColliderOwner = { kind: string; [k: string]: unknown };

export class DeckWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  readonly gLocal = new THREE.Vector3(0, -config.sim.gravity, 0);
  /** Unit "down" in the deck frame and the in-plane slope component. */
  readonly gDir = new THREE.Vector3(0, -1, 0);
  slopeDeg = 0;
  readonly ground: RAPIER.RigidBody;
  readonly owners = new Map<number, ColliderOwner>();
  /** Callbacks run before each physics step (gameplay forces). */
  readonly preStep: ((dt: number) => void)[] = [];
  readonly postStep: ((dt: number) => void)[] = [];
  /** Extra uniform acceleration (e.g. scripted shoves) — cleared each step. */
  readonly extraAccel = new THREE.Vector3();
  private stepIndex = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -config.sim.gravity, z: 0 });
    this.world.timestep = 1 / config.sim.hz;
    this.world.numSolverIterations = 6;
    this.events = new RAPIER.EventQueue(true);
    this.ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  setOwner(c: RAPIER.Collider, owner: ColliderOwner): void {
    this.owners.set(c.handle, owner);
  }
  ownerOf(c: RAPIER.Collider | null | undefined): ColliderOwner | undefined {
    return c ? this.owners.get(c.handle) : undefined;
  }

  /** Update local gravity from the boat's motion. */
  updateGravity(boat: Boat): void {
    const g = config.sim.gravity;
    _v.set(0, -g, 0).addScaledVector(boat.acc, -config.deck.accelScale);
    _q.copy(boat.quat).invert();
    this.gLocal.copy(_v.applyQuaternion(_q)).add(this.extraAccel);
    this.extraAccel.set(0, 0, 0);
    this.gDir.copy(this.gLocal).normalize();
    this.slopeDeg = (Math.acos(THREE.MathUtils.clamp(-this.gDir.y, -1, 1)) * 180) / Math.PI;
    this.world.gravity = { x: this.gLocal.x, y: this.gLocal.y, z: this.gLocal.z };
  }

  step(dt: number, boat: Boat): void {
    this.updateGravity(boat);
    for (const f of this.preStep) f(dt);
    // fictitious forces from the boat's rotation: −α×r − ω×(ω×r), applied as impulses
    const w = _w.copy(boat.angVel);
    const al = _a.copy(boat.angAcc).multiplyScalar(config.deck.tangentialScale);
    const maxV = config.deck.maxLinVel;
    const maxW = config.deck.maxAngVel;
    this.world.forEachActiveRigidBody((b) => {
      if (!b.isDynamic()) return;
      const t = b.translation();
      _r.set(t.x, t.y, t.z); // relative to the local origin, whose own acceleration is already in g_local
      const ax = -(al.y * _r.z - al.z * _r.y);
      const ay = -(al.z * _r.x - al.x * _r.z);
      const az = -(al.x * _r.y - al.y * _r.x);
      // centrifugal −ω×(ω×r)
      const cx = w.y * _r.z - w.z * _r.y;
      const cy = w.z * _r.x - w.x * _r.z;
      const cz = w.x * _r.y - w.y * _r.x;
      const fx = ax - (w.y * cz - w.z * cy);
      const fy = ay - (w.z * cx - w.x * cz);
      const fz = az - (w.x * cy - w.y * cx);
      const m = b.mass() * dt;
      b.applyImpulse({ x: fx * m, y: fy * m, z: fz * m }, false);
      // clamp velocities: if anything ever explodes, keep it bounded (and find the root cause)
      const lv = b.linvel();
      const s2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
      if (s2 > maxV * maxV) {
        const k = maxV / Math.sqrt(s2);
        b.setLinvel({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, false);
      }
      const av = b.angvel();
      const a2 = av.x * av.x + av.y * av.y + av.z * av.z;
      if (a2 > maxW * maxW) {
        const k = maxW / Math.sqrt(a2);
        b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, false);
      }
    });
    this.world.step(this.events);
    this.stepIndex++;
    for (const f of this.postStep) f(dt);
  }

  /** Raycast in local space against structure (and optionally everything). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filterGroups = CG.queryStatic, exclude?: RAPIER.RigidBody): { toi: number; collider: RAPIER.Collider; normal: THREE.Vector3 } | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, filterGroups, undefined, exclude);
    if (!hit) return null;
    return { toi: hit.timeOfImpact, collider: hit.collider, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }

  countBodies(): { total: number; awake: number } {
    let total = 0,
      awake = 0;
    this.world.forEachRigidBody((b) => {
      if (b.isDynamic() && b.isEnabled()) {
        total++;
        if (!b.isSleeping()) awake++;
      }
    });
    return { total, awake };
  }
}
