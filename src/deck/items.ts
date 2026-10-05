/**
 * Items: everything loose on the boat (buckets, crabs, jars, buoys, tools, specials…).
 * An item lives either in the deck world (a Rapier body in boat-local space), on a hook
 * ('fixed', no body), or in the SEA STATE (world-space ballistic / floating / sinking).
 * Overboard: passing the rail plane by > margin → removed from the deck world → sea state.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../config';
import { BodyState, type DeckWorld } from './deckWorld';
import { CG } from './groups';
import { hullHalfWidth, STERN_Z, BOW_Z, HOUSE } from '../boat/layout';
import type { Boat } from '../boat/boat';
import type { Sea } from '../sea/waves';
import { events } from '../core/events';
import { sfx } from '../audio';

export type CarryMode = 'hold' | 'sticky' | 'push' | 'none';
export type ItemShape = { type: 'box'; half: [number, number, number] } | { type: 'ball'; r: number } | { type: 'cylinder'; halfH: number; r: number } | { type: 'capsule'; halfH: number; r: number };

export interface ItemDef {
  kind: string;
  label: string;
  icon: string;
  shape: ItemShape;
  mass: number;
  friction?: number;
  restitution?: number;
  carry: CarryMode;
  sea: 'float' | 'sink' | 'floatLow';
  ccd?: boolean;
  linDamp?: number;
  angDamp?: number;
  /** keep upright while carried */
  holdUpright?: boolean;
  /** cannot ever go overboard (the cat) */
  noOverboard?: boolean;
  group?: number;
}

export type ItemMode = 'deck' | 'fixed' | 'sea' | 'gone';
export type SeaPhase = 'air' | 'float' | 'sink';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Item {
  static nextId = 1;
  readonly id = Item.nextId++;
  mode: ItemMode = 'deck';
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  readonly state = new BodyState();
  heldBy: { name: string } | null = null;
  /** where it hangs when 'fixed' (local) */
  readonly fixedPos = new THREE.Vector3();
  readonly fixedQuat = new THREE.Quaternion();
  // sea state (world space)
  readonly wp = new THREE.Vector3();
  readonly wv = new THREE.Vector3();
  readonly wq = new THREE.Quaternion();
  readonly wSpin = new THREE.Vector3();
  readonly prevWp = new THREE.Vector3();
  readonly prevWq = new THREE.Quaternion();
  seaPhase: SeaPhase = 'air';
  seaAge = 0;
  /** an external world-space pull (rope) applied while in the sea */
  readonly seaPull = new THREE.Vector3();
  /** render transform in boat-local space (filled each frame) */
  readonly renderP = new THREE.Vector3();
  readonly renderQ = new THREE.Quaternion();
  visible = true;
  stuckTime = 0;
  roofTime = 0;
  /** free-form per-kind data */
  data: Record<string, any> = {};
  /** hooks */
  onToSea?: (it: Item) => void;
  onSeaLand?: (it: Item) => void;
  onStep?: (it: Item, dt: number) => void;
  noOverboardUntil = 0;

  constructor(
    readonly def: ItemDef,
    public view: THREE.Object3D | null,
  ) {}

  get kind(): string {
    return this.def.kind;
  }

  /** Local position (deck or fixed); for sea items this is meaningless. */
  localPos(out: THREE.Vector3): THREE.Vector3 {
    if (this.mode === 'deck' && this.body) {
      const t = this.body.translation();
      return out.set(t.x, t.y, t.z);
    }
    if (this.mode === 'fixed') return out.copy(this.fixedPos);
    return out.copy(this.state.currP);
  }
  localVel(out: THREE.Vector3): THREE.Vector3 {
    if (this.body && this.mode === 'deck') {
      const v = this.body.linvel();
      return out.set(v.x, v.y, v.z);
    }
    return out.set(0, 0, 0);
  }
  get mass(): number {
    return this.def.mass;
  }
}

export class ItemManager {
  readonly items: Item[] = [];
  private byCollider = new Map<number, Item>();
  time = 0;
  /** set by weather: wind drift direction in world XZ */
  readonly drift = new THREE.Vector2(0.3, 0.1);
  railNets = false;
  onAdd?: (it: Item) => void;
  onRemove?: (it: Item) => void;

  constructor(
    private dw: DeckWorld,
    private boat: Boat,
    private sea: Sea,
    private boatGroup: THREE.Group,
  ) {}

  itemOf(c: RAPIER.Collider | null | undefined): Item | undefined {
    return c ? this.byCollider.get(c.handle) : undefined;
  }

  private makeColliderDesc(def: ItemDef): RAPIER.ColliderDesc {
    const s = def.shape;
    let d: RAPIER.ColliderDesc;
    if (s.type === 'box') d = RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]);
    else if (s.type === 'ball') d = RAPIER.ColliderDesc.ball(s.r);
    else if (s.type === 'cylinder') d = RAPIER.ColliderDesc.cylinder(s.halfH, s.r);
    else d = RAPIER.ColliderDesc.capsule(s.halfH, s.r);
    d.setMass(def.mass)
      .setFriction(def.friction ?? config.deck.itemFriction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min) // the item's own grip decides (ice still wins)
      .setRestitution(def.restitution ?? 0.15)
      .setCollisionGroups(def.group ?? CG.item);
    return d;
  }

  private createBody(it: Item, p: THREE.Vector3, q: THREE.Quaternion, v?: THREE.Vector3): void {
    const def = it.def;
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(def.linDamp ?? 0.15)
      .setAngularDamping(def.angDamp ?? 0.6)
      .setCanSleep(false)
      .setCcdEnabled(def.ccd ?? false);
    if (v) bd.setLinvel(v.x, v.y, v.z);
    const body = this.dw.world.createRigidBody(bd);
    const col = this.dw.world.createCollider(this.makeColliderDesc(def), body);
    it.body = body;
    it.collider = col;
    this.byCollider.set(col.handle, it);
    this.dw.setOwner(col, { kind: 'item', item: it });
    it.state.reset(p, q);
  }

  private destroyBody(it: Item): void {
    if (!it.body) return;
    if (it.collider) this.byCollider.delete(it.collider.handle);
    this.dw.world.removeRigidBody(it.body);
    it.body = null;
    it.collider = null;
  }

  add(def: ItemDef, view: THREE.Object3D | null, localPos: THREE.Vector3, opts: { quat?: THREE.Quaternion; vel?: THREE.Vector3; fixed?: boolean } = {}): Item {
    const it = new Item(def, view);
    const q = opts.quat ?? new THREE.Quaternion();
    if (opts.fixed) {
      it.mode = 'fixed';
      it.fixedPos.copy(localPos);
      it.fixedQuat.copy(q);
      it.state.reset(localPos, q);
    } else {
      this.createBody(it, localPos, q, opts.vel);
    }
    if (view) this.boatGroup.add(view);
    this.items.push(it);
    this.onAdd?.(it);
    return it;
  }

  remove(it: Item): void {
    this.destroyBody(it);
    it.mode = 'gone';
    if (it.view) it.view.removeFromParent();
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    this.onRemove?.(it);
  }

  /** Take an item off its hook into the deck world. */
  unfix(it: Item, vel?: THREE.Vector3): void {
    if (it.mode !== 'fixed') return;
    it.mode = 'deck';
    this.createBody(it, it.fixedPos, it.fixedQuat, vel);
  }
  /** Put an item onto a hook / slot (no body). */
  fix(it: Item, localPos: THREE.Vector3, q = new THREE.Quaternion()): void {
    this.destroyBody(it);
    it.mode = 'fixed';
    it.fixedPos.copy(localPos);
    it.fixedQuat.copy(q);
    it.state.reset(localPos, q);
    it.heldBy = null;
  }

  /** Move a deck item into the sea state (world space). */
  toSea(it: Item): void {
    if (it.mode !== 'deck' || !it.body) return;
    const t = it.body.translation();
    const r = it.body.rotation();
    const lv = it.body.linvel();
    const av = it.body.angvel();
    _v.set(t.x, t.y, t.z);
    this.boat.localToWorld(_v, it.wp);
    this.boat.pointVelocity(_v, it.wv);
    _v2.set(lv.x, lv.y, lv.z).applyQuaternion(this.boat.quat);
    it.wv.add(_v2);
    _q.set(r.x, r.y, r.z, r.w);
    it.wq.copy(this.boat.quat).multiply(_q);
    it.wSpin.set(av.x, av.y, av.z).applyQuaternion(this.boat.quat);
    it.prevWp.copy(it.wp);
    it.prevWq.copy(it.wq);
    this.destroyBody(it);
    it.mode = 'sea';
    it.seaPhase = 'air';
    it.seaAge = 0;
    it.heldBy = null;
    it.onToSea?.(it);
    events.emit('overboard', { kind: it.kind, worldPos: it.wp.clone() });
  }

  /** Bring a sea item back aboard at a local position with a local velocity. */
  toDeck(it: Item, localPos: THREE.Vector3, localVel = new THREE.Vector3()): void {
    if (it.mode !== 'sea') return;
    _q.copy(this.boat.quat).invert().multiply(it.wq);
    it.mode = 'deck';
    this.createBody(it, localPos, _q, localVel);
    it.noOverboardUntil = this.time + 1.0;
  }

  /** Spawn something directly into the sea (world space). */
  spawnInSea(it: Item, wp: THREE.Vector3, wv: THREE.Vector3, phase: SeaPhase = 'float'): void {
    this.destroyBody(it);
    it.mode = 'sea';
    it.wp.copy(wp);
    it.wv.copy(wv);
    it.prevWp.copy(wp);
    it.prevWq.copy(it.wq);
    it.seaPhase = phase;
    it.seaAge = 0;
  }

  /** Is a local point outside the hull plan by more than `margin`? */
  static outsideHull(p: THREE.Vector3, margin: number): boolean {
    if (p.z < STERN_Z - margin || p.z > BOW_Z + margin) return true;
    const hw = hullHalfWidth(THREE.MathUtils.clamp(p.z, STERN_Z, BOW_Z));
    return Math.abs(p.x) > hw + margin;
  }

  stepPre(dt: number): void {
    this.time += dt;
    const g = config.sim.gravity;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.onStep?.(it, dt);
      if (it.mode !== 'sea') continue;
      it.prevWp.copy(it.wp);
      it.prevWq.copy(it.wq);
      it.seaAge += dt;
      const h = this.sea.height(it.wp.x, it.wp.z);
      if (it.seaPhase === 'air') {
        it.wv.y -= g * dt;
        it.wv.addScaledVector(it.seaPull, dt);
        it.wp.addScaledVector(it.wv, dt);
        _q.setFromAxisAngle(_n.copy(it.wSpin).normalize(), it.wSpin.length() * dt);
        if (it.wSpin.lengthSq() > 1e-6) it.wq.premultiply(_q);
        if (it.wp.y <= h) {
          it.seaPhase = it.def.sea === 'sink' ? 'sink' : 'float';
          it.wv.multiplyScalar(0.25);
          it.wv.y = 0;
          it.seaAge = 0;
          const big = it.mass > 20;
          sfx.play(it.mass < 3 ? 'plop' : 'splash', { volume: big ? 1 : 0.6, pitch: big ? 0.8 : 1.2 });
          it.onSeaLand?.(it);
        }
      } else if (it.seaPhase === 'float') {
        const off = it.def.sea === 'floatLow' ? -0.1 : 0.05;
        const target = h + off;
        it.wv.y += ((target - it.wp.y) * 30 - it.wv.y * 6) * dt;
        // drift with wind + damping, plus any rope pull
        const dx = this.drift.x * config.sea.swimmerDrift;
        const dz = this.drift.y * config.sea.swimmerDrift;
        it.wv.x += ((dx - it.wv.x) * 0.8 + it.seaPull.x) * dt;
        it.wv.z += ((dz - it.wv.z) * 0.8 + it.seaPull.z) * dt;
        const anchor = it.data.anchor as THREE.Vector3 | undefined;
        if (anchor) {
          // buoys are tethered to their pot: gentle spring back to the anchor
          it.wv.x += ((anchor.x - it.wp.x) * 0.5 - it.wv.x * 0.6) * dt;
          it.wv.z += ((anchor.z - it.wp.z) * 0.5 - it.wv.z * 0.6) * dt;
        }
        it.wp.addScaledVector(it.wv, dt);
        this.sea.normal(it.wp.x, it.wp.z, _n);
        _q.setFromUnitVectors(UP, _n);
        // keep yaw from the current orientation
        const yaw = Math.atan2(2 * (it.wq.w * it.wq.y + it.wq.x * it.wq.z), 1 - 2 * (it.wq.y * it.wq.y + it.wq.x * it.wq.x));
        _v.set(0, 1, 0);
        const yq = new THREE.Quaternion().setFromAxisAngle(_v, yaw + dt * 0.2);
        it.wq.slerp(_q.multiply(yq), Math.min(1, dt * 3));
      } else {
        it.wp.y -= 0.9 * dt;
        it.wp.addScaledVector(it.wv, dt);
        if (it.seaAge > 2.2) {
          this.remove(it);
        }
      }
      it.seaPull.set(0, 0, 0);
    }
  }

  stepPost(dt: number): void {
    const margin = config.deck.overboardMargin;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.mode !== 'deck' || !it.body) continue;
      it.state.capture(it.body);
      const p = it.state.currP;
      if (!it.heldBy && this.time > it.noOverboardUntil && ItemManager.outsideHull(p, margin)) {
        if (it.def.noOverboard) continue;
        this.toSea(it);
        continue;
      }
      // unstick: fell through the deck, or stranded on the wheelhouse roof
      if (p.y < -0.8 && !ItemManager.outsideHull(p, -0.2)) {
        it.stuckTime += dt;
        if (it.stuckTime > 0.3) {
          it.body.setTranslation({ x: p.x * 0.8, y: 0.6, z: p.z }, true);
          it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          it.stuckTime = 0;
        }
      } else it.stuckTime = 0;
      if (p.y > HOUSE.roofY && p.x > HOUSE.x0 - 0.2 && p.x < HOUSE.x1 + 0.2 && p.z > HOUSE.z0 - 0.2 && p.z < HOUSE.z1 + 0.3) {
        it.roofTime += dt;
        if (it.roofTime > config.deck.unstickSec) {
          it.body.applyImpulse({ x: 0, y: it.mass * 2, z: -it.mass * 4 }, true);
          it.roofTime = 0;
        }
      } else it.roofTime = 0;
    }
  }

  /** Compute render transforms (boat-local) and place views. */
  render(alpha: number, boatRenderPos: THREE.Vector3, boatRenderQuat: THREE.Quaternion): void {
    const inv = _q.copy(boatRenderQuat).invert();
    for (const it of this.items) {
      if (it.mode === 'deck' || it.mode === 'fixed') {
        if (it.mode === 'fixed') {
          it.renderP.copy(it.fixedPos);
          it.renderQ.copy(it.fixedQuat);
        } else it.state.interp(alpha, it.renderP, it.renderQ);
      } else if (it.mode === 'sea') {
        _v.lerpVectors(it.prevWp, it.wp, alpha);
        it.renderP.copy(_v).sub(boatRenderPos).applyQuaternion(inv);
        _v2.set(0, 0, 0);
        const wq = new THREE.Quaternion().slerpQuaternions(it.prevWq, it.wq, alpha);
        it.renderQ.copy(inv).multiply(wq);
      }
      if (it.view) {
        it.view.visible = it.visible && it.mode !== 'gone';
        it.view.position.copy(it.renderP);
        it.view.quaternion.copy(it.renderQ);
      }
    }
  }

  countDeck(kind?: string): number {
    let n = 0;
    for (const it of this.items) if (it.mode === 'deck' && (!kind || it.kind === kind)) n++;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Item definitions
export const ITEM_DEFS = {
  bucket: { kind: 'bucket', label: 'bucket', icon: '🪣', shape: { type: 'cylinder', halfH: 0.17, r: 0.19 }, mass: 3, carry: 'hold', sea: 'float', friction: 0.12, holdUpright: true } as ItemDef,
  baitJar: { kind: 'baitJar', label: 'bait jar', icon: '🫙', shape: { type: 'cylinder', halfH: 0.12, r: 0.095 }, mass: 1.2, carry: 'hold', sea: 'float', friction: 0.2, holdUpright: true, ccd: true } as ItemDef,
  mallet: { kind: 'mallet', label: 'ice mallet', icon: '🔨', shape: { type: 'box', half: [0.13, 0.4, 0.06] }, mass: 2.5, carry: 'sticky', sea: 'float', friction: 0.3, holdUpright: true } as ItemDef,
  ring: { kind: 'ring', label: 'life ring', icon: '🛟', shape: { type: 'cylinder', halfH: 0.08, r: 0.4 }, mass: 2.5, carry: 'sticky', sea: 'float', restitution: 0.3, ccd: true } as ItemDef,
  grapple: { kind: 'grapple', label: 'grapple hook', icon: '🪝', shape: { type: 'box', half: [0.1, 0.28, 0.1] }, mass: 3, carry: 'sticky', sea: 'sink', ccd: true, holdUpright: true } as ItemDef,
  buoy: { kind: 'buoy', label: 'buoy', icon: '🟠', shape: { type: 'ball', r: 0.28 }, mass: 1.5, carry: 'hold', sea: 'float', friction: 0.25, restitution: 0.45, linDamp: 0.3 } as ItemDef,
  hat: { kind: 'hat', label: 'hat', icon: '🧢', shape: { type: 'cylinder', halfH: 0.07, r: 0.17 }, mass: 0.3, carry: 'hold', sea: 'float', friction: 0.4, linDamp: 0.6, angDamp: 1.2 } as ItemDef,
  crab: { kind: 'crab', label: 'crab', icon: '🦀', shape: { type: 'box', half: [0.12, 0.05, 0.1] }, mass: 2, carry: 'hold', sea: 'sink', friction: 0.5, restitution: 0.25, ccd: true, linDamp: 0.3, angDamp: 1.0 } as ItemDef,
  special: { kind: 'special', label: 'curiosity', icon: '✨', shape: { type: 'box', half: [0.16, 0.12, 0.16] }, mass: 2, carry: 'hold', sea: 'float', ccd: true } as ItemDef,
  lineEnd: { kind: 'lineEnd', label: 'buoy line', icon: '🪢', shape: { type: 'ball', r: 0.14 }, mass: 1, carry: 'sticky', sea: 'float' } as ItemDef,
};
