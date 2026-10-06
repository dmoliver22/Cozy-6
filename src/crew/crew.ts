/**
 * A crew member: a 1.7 m capsule with an upright spring (wobbles but stays standing),
 * velocity-based movement limited by deck grip, brace springs, knockdowns (ragdoll / tumble),
 * carrying & throwing, and the overboard swimmer state. Acts only through CrewInput.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { later } from '../core/schedule';
import * as THREE from 'three';
import { config, DEG } from '../config';
import { clamp, damp, dampAngle, solveBallistic, throwFlightTime } from '../core/math';
import { BodyState } from '../deck/deckWorld';
import { CG } from '../deck/groups';
import { ITEM_DEFS, ItemManager, type Item } from '../deck/items';
import type { Interactable, Verb } from '../deck/interact';
import { insideHouse, L, hullHalfWidth } from '../boat/layout';
import { makeInput, consumeEdges, type CrewInput } from './input';
import type { CrewView, PartName } from '../art/crew';
import { PART_NAMES, type Ragdoll, type RagdollPool } from './ragdoll';
import type { Ctx } from '../game/ctx';
import { events } from '../core/events';
import { sfx } from '../audio';
import type { Rng } from '../core/rng';

export type CrewId = 'player' | 'mo' | 'dot' | 'ike';
export type CrewState = 'stand' | 'down' | 'getup' | 'sea' | 'helm' | 'boarding' | 'off';

const HALF_H = config.crew.height / 2 - config.crew.radius; // capsule half height
const CENTER_Y = config.crew.height / 2;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);

export class Crew {
  readonly input: CrewInput = makeInput();
  state: CrewState = 'stand';
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  readonly bs = new BodyState();
  facing = 0; // yaw in the deck plane, 0 = bow (+Z), + toward port
  grounded = true;
  sliding = false;
  slideTime = 0;
  walkPhase = 0;
  walkAmount = 0;
  // brace
  braced = false;
  crouch = false;
  readonly braceAnchor = new THREE.Vector3();
  braceStrain = 0;
  braceTime = 0;
  // carrying
  held: Item | null = null;
  throwAiming = false;
  readonly throwTarget = new THREE.Vector3();
  // interaction
  target: Interactable | null = null;
  targetVerbs: Verb[] = [];
  activeVerb: Verb | null = null;
  activeTarget: Interactable | null = null;
  // knockdown
  ragdoll: Ragdoll | null = null;
  downTime = 0;
  getupTime = 0;
  tumbleSpin = 0;
  readonly tumbleAxis = new THREE.Vector3(1, 0, 0);
  slopeTime = 0;
  lastKnock = -10;
  knockCount = 0;
  pendingImpulse = 0;
  readonly pendingImpulseDir = new THREE.Vector3();
  // stagger (crab pinch)
  stagger = 0;
  // hat
  hatOn = true;
  hatItem: Item | null = null;
  hatRespawn = 0;
  // swimmer (world space)
  readonly wp = new THREE.Vector3();
  readonly wv = new THREE.Vector3();
  readonly prevWp = new THREE.Vector3();
  seaTime = 0;
  readonly seaPull = new THREE.Vector3();
  onRing = false;
  // stuck detection
  stuckTime = 0;
  readonly lastPos = new THREE.Vector3();
  // render
  readonly renderP = new THREE.Vector3();
  readonly renderQ = new THREE.Quaternion();
  private getupFrom: { p: THREE.Vector3; q: THREE.Quaternion }[] | null = null;
  lean = 0;
  vocalCooldown = 0;
  insideHouse = false;
  /** speed multiplier set by systems (carrying the cat, wading) */
  speedScale = 1;
  bot = false;
  lastHeldTime = 0;
  /** free-form per-crew data (pinch cooldowns, …) */
  readonly data: Record<string, number> = {};
  /** If set, the crew is attached to the wheel. */
  atHelm = false;

  private rng: Rng;

  constructor(
    readonly id: CrewId,
    readonly name: string,
    readonly view: CrewView,
    private ctx: Ctx,
    private pool: RagdollPool,
    spawn: THREE.Vector3,
  ) {
    this.rng = ctx.rng.stream('crew:' + id);
    this.createBody(spawn);
    this.facing = Math.PI * 0.5;
    ctx.boatGroup.add(view.root);
    ctx.boatGroup.add(view.ring);
  }

  // -------------------------------------------------------------------------
  private createBody(feet: THREE.Vector3): void {
    const w = this.ctx.dw.world;
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(feet.x, feet.y + CENTER_Y + 0.02, feet.z)
      .setLinearDamping(0.4)
      .setAngularDamping(1.5)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = w.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.capsule(HALF_H, config.crew.radius)
      .setMass(config.crew.mass)
      .setFriction(0.0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.0)
      .setCollisionGroups(CG.crew)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold((config.crew.knockdownImpulse * config.sim.hz) * 0.5);
    this.collider = w.createCollider(cd, this.body);
    this.ctx.dw.setOwner(this.collider, { kind: 'crew', crew: this });
    const t = this.body.translation();
    this.bs.reset(t, this.body.rotation());
    this.lastPos.set(t.x, t.y, t.z);
  }

  /** Capsule centre (local). */
  pos(out: THREE.Vector3): THREE.Vector3 {
    if (this.state === 'down' && this.ragdoll) return this.ragdoll.pelvis(out);
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }
  /** Feet position (local, y ≈ deck). */
  feet(out: THREE.Vector3): THREE.Vector3 {
    this.pos(out);
    out.y -= CENTER_Y;
    return out;
  }
  vel(out: THREE.Vector3): THREE.Vector3 {
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }
  get isUp(): boolean {
    return this.state === 'stand' || this.state === 'helm';
  }
  get inSea(): boolean {
    return this.state === 'sea' || this.state === 'boarding';
  }
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }
  /** Where hands hold things (local). */
  holdPoint(out: THREE.Vector3): THREE.Vector3 {
    this.pos(out);
    const ld = this.input.lookDir;
    if (ld && !this.bot) {
      // first person: in front of the eyes, a little low
      out.y += config.crew.eyeHeight - CENTER_Y - 0.28;
      out.addScaledVector(_v3.copy(ld).setY(Math.max(-0.4, Math.min(0.3, ld.y))).normalize(), 0.7);
      return out;
    }
    this.forward(_v3);
    const h = this.held;
    if (h && h.def.carry === 'push' && h.def.shape.type === 'box') {
      // a heavy box sits just clear of us, not in our arms
      out.addScaledVector(_v3, config.crew.radius + Math.max(h.def.shape.half[0], h.def.shape.half[2]) + 0.1);
      return out;
    }
    out.addScaledVector(_v3, 0.62);
    out.y += 0.28;
    return out;
  }
  head(out: THREE.Vector3): THREE.Vector3 {
    this.pos(out);
    out.y += config.crew.eyeHeight - CENTER_Y;
    return out;
  }

  // -------------------------------------------------------------------------
  // Simulation
  step(dt: number): void {
    this.vocalCooldown = Math.max(0, this.vocalCooldown - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    if (this.state === 'stand' || this.state === 'helm' || this.state === 'down' || this.state === 'getup') this.belowDeckNet();
    switch (this.state) {
      case 'stand':
      case 'helm':
        this.stepStand(dt);
        break;
      case 'down':
        this.stepDown(dt);
        break;
      case 'getup':
        this.stepGetup(dt);
        break;
      case 'sea':
      case 'boarding':
        this.stepSea(dt);
        break;
    }
    this.stepHat(dt);
    consumeEdges(this.input);
  }

  private stepStand(dt: number): void {
    const c = config.crew;
    const b = this.body;
    const inp = this.input;
    const t = b.translation();
    const p = _v.set(t.x, t.y, t.z);
    this.insideHouse = insideHouse(p);
    const lv = b.linvel();

    // --- ground check (local down)
    const hit = this.ctx.dw.raycast(p, _down, CENTER_Y + 0.25, CG.queryStatic, b);
    this.grounded = !!hit && hit.toi < CENTER_Y + 0.15;

    // --- brace
    const wantBrace = inp.brace && !this.atHelm;
    if (wantBrace && !this.braced && !this.crouch) this.tryBrace();
    if (!wantBrace && (this.braced || this.crouch)) this.unbrace();

    // --- desired velocity
    const surf = this.ctx.surface;
    const grip = surf.grip(p.x, p.z, this.insideHouse);
    let speed = c.walkSpeed * surf.waterSlow() * this.speedScale * (this.stagger > 0 ? 0.35 : 1);
    if (this.held && this.held.mass > 10) speed *= 0.6;
    const mv = inp.move;
    let mx = mv.x,
      mz = mv.y;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) {
      mx /= mlen;
      mz /= mlen;
    }
    if (this.braced || this.crouch || this.atHelm) {
      mx = 0;
      mz = 0;
    }
    const vdx = mx * speed,
      vdz = mz * speed;
    // sliding = big unwanted velocity on a slippery surface
    const ux = lv.x - vdx,
      uz = lv.z - vdz;
    const unwanted = Math.hypot(ux, uz);
    this.sliding = this.grounded && unwanted > c.slideThreshold && grip < 0.8;
    this.slideTime = this.sliding ? this.slideTime + dt : 0;
    let accel = c.accel * grip;
    if (this.sliding && mlen > 0.1) accel = Math.max(accel, c.accel * c.slideControl);
    if (!this.grounded) accel = c.accel * 0.08;
    if (this.atHelm) accel = c.accel;
    const maxDv = accel * dt;
    let dvx = vdx - lv.x,
      dvz = vdz - lv.z;
    const dl = Math.hypot(dvx, dvz);
    if (dl > maxDv) {
      dvx *= maxDv / dl;
      dvz *= maxDv / dl;
    }
    const m = c.mass;
    b.applyImpulse({ x: dvx * m, y: 0, z: dvz * m }, true);

    // helm: hold position at the wheel
    if (this.atHelm) {
      const hs = L.helmSpot;
      b.applyImpulse({ x: (hs.x - p.x) * m * 6 * dt * 10 - lv.x * m * 0.2, y: 0, z: (hs.z - p.z) * m * 6 * dt * 10 - lv.z * m * 0.2 }, true);
    }

    // --- facing
    let wantFacing = this.facing;
    if (this.braced) {
      wantFacing = Math.atan2(this.braceAnchor.x - p.x, this.braceAnchor.z - p.z);
    } else if (this.atHelm) {
      wantFacing = 0;
    } else if ((this.throwAiming || inp.throwAim) && inp.aim) {
      wantFacing = Math.atan2(inp.aim.x - p.x, inp.aim.z - p.z);
    } else if (this.held && this.held.def.carry === 'push' && !this.held.data.guide && this.held.body) {
      // shoving or dragging something heavy: keep facing it
      const t = this.held.body.translation();
      wantFacing = Math.atan2(t.x - p.x, t.z - p.z);
    } else if (mlen > 0.15) {
      wantFacing = Math.atan2(mx, mz);
    } else if (inp.face) {
      wantFacing = Math.atan2(inp.face.x, inp.face.y);
    } else if (inp.aim && !this.bot) {
      const dx = inp.aim.x - p.x,
        dz = inp.aim.z - p.z;
      if (dx * dx + dz * dz > 0.3) wantFacing = Math.atan2(dx, dz);
    }
    this.facing = dampAngle(this.facing, wantFacing, this.braced ? 14 : 10, dt);

    // --- upright spring (wobble but stay standing); lean into the slope
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const bodyUp = _v2.copy(UP).applyQuaternion(_q);
    const gd = this.ctx.dw.gDir;
    const target = _v3.set(-gd.x, -gd.y, -gd.z).lerp(UP, 0.45).normalize();
    if (this.braced || this.crouch) {
      // lean against the downhill pull
      target.set(-gd.x * 1.8, -gd.y, -gd.z * 1.8).normalize();
    }
    const axis = new THREE.Vector3().crossVectors(bodyUp, target);
    const av = b.angvel();
    const k = c.uprightStiffness * (this.braced ? 1.6 : 1);
    const cd = c.uprightDamping;
    const tx = axis.x * k - av.x * cd;
    const tz = axis.z * k - av.z * cd;
    const ty = -av.y * 40;
    b.applyTorqueImpulse({ x: tx * dt, y: ty * dt, z: tz * dt }, true);

    // --- brace spring: hands to the anchor, breaks above breakForce
    if (this.braced) this.stepBraceSpring(dt, p);

    // --- carrying
    if (this.held) this.stepCarry(dt);

    // --- knockdown checks (impulse events are fed by the CrewManager)
    const unbracedSlope = this.ctx.dw.slopeDeg > c.knockdownSlopeDeg * (this.crouch ? 1.25 : 1) && !this.braced && !this.atHelm && !this.insideHouse;
    this.slopeTime = unbracedSlope ? this.slopeTime + dt : Math.max(0, this.slopeTime - dt * 2);
    if (this.slopeTime > 0.35) {
      _v2.set(this.ctx.dw.gLocal.x, 0, this.ctx.dw.gLocal.z).normalize();
      this.knockdown(_v2.multiplyScalar(3.2), 'slope');
      return;
    }
    if (this.pendingImpulse > 0) {
      const thr = c.knockdownImpulse * (this.crouch ? 1.4 : 1) * (this.braced ? 1e9 : 1);
      if (this.pendingImpulse > thr && !this.atHelm) {
        this.knockdown(this.pendingImpulseDir.clone().setLength(Math.min(6, this.pendingImpulse / c.mass + 1)), 'impact');
        this.pendingImpulse = 0;
        return;
      }
      this.pendingImpulse = 0;
    }

    // --- interactions
    this.stepInteract(dt, p);

    // --- unstick nudge: wants to move but hasn't for 2 s
    const moved = p.distanceTo(this.lastPos);
    if (mlen > 0.3 && moved < 0.002 && this.grounded) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    if (this.stuckTime > config.deck.unstickSec) {
      b.applyImpulse({ x: mx * m * 2.5, y: m * 3.5, z: mz * m * 2.5 }, true);
      this.stuckTime = 0;
    }
    if (p.y < -0.6 && !ItemManager.outsideHull(p, -0.2)) {
      b.setTranslation({ x: p.x * 0.85, y: CENTER_Y + 0.2, z: p.z }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.lastPos.copy(p);

    // walk anim
    const hs = Math.hypot(lv.x, lv.z);
    this.walkAmount = damp(this.walkAmount, this.sliding ? 0 : clamp(hs / c.walkSpeed, 0, 1), 8, dt);
    this.walkPhase += hs * dt * 3.2;
    this.lean = damp(this.lean, this.braced ? 1 : 0, 10, dt);
  }

  // -------------------------------------------------------------------------
  // Brace
  private tryBrace(): void {
    const p = this.pos(_v);
    const hands = _v2.copy(p);
    hands.y = 1.0;
    let best = -1;
    let bestD = config.brace.reach;
    const tmp = new THREE.Vector3();
    const seg = new THREE.Vector3();
    for (let i = 0; i < this.ctx.braceSegs.length; i++) {
      const s = this.ctx.braceSegs[i];
      seg.subVectors(s.b, s.a);
      const t = clamp(tmp.subVectors(hands, s.a).dot(seg) / Math.max(1e-6, seg.lengthSq()), 0, 1);
      tmp.copy(s.a).addScaledVector(seg, t);
      const dx = tmp.x - p.x,
        dz = tmp.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        best = i;
        this.braceAnchor.copy(tmp);
      }
    }
    if (best >= 0) {
      this.braced = true;
      this.braceTime = 0;
      this.braceStrain = 0;
      if (this.held && this.held.def.carry === 'hold') this.drop();
      sfx.play('ropeCreak', { volume: 0.5, pitch: 1 + Math.random() * 0.2 });
      events.emit('braceStart', { crew: this.id });
    } else {
      // nothing to grab: crouch with a wide stance (helps a little)
      this.crouch = true;
    }
  }

  unbrace(): void {
    this.braced = false;
    this.crouch = false;
    this.braceStrain = 0;
  }

  private stepBraceSpring(dt: number, p: THREE.Vector3): void {
    this.braceTime += dt;
    const bc = config.brace;
    const hands = _v2.copy(p);
    hands.y += 0.18;
    // rest: hands 0.35 m from the anchor, toward the body
    const toBody = _v3.subVectors(p, this.braceAnchor).setY(0);
    const dist = toBody.length();
    const rest = 0.42;
    const stretch = dist - rest;
    const lv = this.body.linvel();
    const dirx = dist > 1e-4 ? toBody.x / dist : 0;
    const dirz = dist > 1e-4 ? toBody.z / dist : 0;
    const vrel = lv.x * dirx + lv.z * dirz;
    let f = -(bc.stiffness * stretch + bc.damping * vrel);
    // also resist lateral sliding along the rail
    const latx = -dirz,
      latz = dirx;
    const vlat = lv.x * latx + lv.z * latz;
    const flat = -bc.damping * 1.5 * vlat;
    const total = Math.hypot(f, flat);
    const breakF = bc.breakForce * (this.ctx.buffs.has('warmBellies') ? bc.breakForceBuff : 1);
    this.braceStrain = damp(this.braceStrain, total / breakF, 12, dt);
    if (total > breakF && this.braceTime > 0.1) {
      // grip broke!
      this.braced = false;
      sfx.play('ropeCreak', { pitch: 0.7 });
      _v3.set(lv.x, 0, lv.z);
      this.knockdown(_v3.lengthSq() > 0.1 ? _v3 : _v3.set(this.ctx.dw.gLocal.x, 0, this.ctx.dw.gLocal.z).normalize().multiplyScalar(2), 'brace broke');
      return;
    }
    // vertical hold: help keep feet planted
    const fy = -this.body.linvel().y * config.crew.mass * 2;
    this.body.applyImpulse({ x: (f * dirx + flat * latx) * dt, y: Math.max(0, fy) * dt, z: (f * dirz + flat * latz) * dt }, true);
  }

  // -------------------------------------------------------------------------
  // Carrying & throwing
  grab(it: Item): void {
    if (this.held) this.drop();
    if (it.mode === 'fixed') this.ctx.items.unfix(it);
    if (it.mode !== 'deck' || !it.collider) return;
    if (it.heldBy && it.heldBy !== (this as unknown)) {
      // steal it gently
      const other = this.ctx.sys.crew?.byName?.(it.heldBy.name) as Crew | undefined;
      other?.releaseHeld();
    }
    this.held = it;
    it.heldBy = this;
    if (it.def.carry !== 'push') it.collider.setCollisionGroups(CG.held);
    sfx.play('grab', { volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
    it.data.grabbedAt = this.ctx.time;
    this.ctx.sys.onGrab?.(this, it);
  }

  /** Let go without throwing. */
  releaseHeld(): Item | null {
    const it = this.held;
    if (!it) return null;
    this.held = null;
    it.heldBy = null;
    this.throwAiming = false;
    // credit: whoever let go of it last (drops and throws both come through here)
    it.data.lastBy = this.id;
    it.data.lastHeldAt = this.ctx.time;
    if (it.collider && it.mode === 'deck') {
      const col = it.collider;
      const g = it.def.group ?? CG.item;
      // restore collisions shortly after so it doesn't pop off the carrier
      later((220) / 1000, () => {
        if (it.collider === col) col.setCollisionGroups(g);
      });
    }
    this.lastHeldTime = this.ctx.time;
    return it;
  }

  drop(): void {
    const it = this.releaseHeld();
    if (it) this.ctx.sys.onDrop?.(this, it);
  }

  throwTo(target: THREE.Vector3): void {
    const it = this.held;
    if (!it || !it.body) return;
    const raw = target.clone(); // where they actually aimed, before the assist (grades the grapple)
    target = (this.ctx.sys.aimAssist?.(it, target) as THREE.Vector3 | undefined) ?? target;
    const t = it.body.translation();
    const from = _v.set(t.x, t.y, t.z);
    const d = Math.hypot(target.x - from.x, target.z - from.z);
    const T = throwFlightTime(from, target, ItemManager.outsideHull(target, 0));
    const vel = solveBallistic(from, target, T, this.ctx.dw.gLocal, _v2);
    const maxS = config.crew.throwMaxSpeed;
    if (vel.length() > maxS) vel.setLength(maxS);
    this.releaseHeld();
    it.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    const r = this.rng;
    it.body.setAngvel({ x: (r.next() - 0.5) * 8, y: (r.next() - 0.5) * 12, z: (r.next() - 0.5) * 8 }, true);
    sfx.play('throw', { volume: 0.7, pitch: 0.9 + d * 0.02 });
    this.ctx.sys.onThrow?.(this, it, target.clone(), raw);
  }

  private stepCarry(dt: number): void {
    const it = this.held!;
    if (it.mode !== 'deck' || !it.body) {
      this.held = null;
      it.heldBy = null;
      return;
    }
    const b = it.body;
    const hp = this.holdPoint(_v);
    const guide = it.data.guide as THREE.Vector3 | undefined;
    if (guide) hp.copy(guide); // e.g. guiding a hanging pot over the cradle
    if (it.def.carry === 'push' && !guide) {
      // too heavy to lift: push/pull horizontally
      hp.y = b.translation().y;
    }
    const t = b.translation();
    const lv = b.linvel();
    const cv = this.body.linvel();
    // a guided load (a pot on its line) gets a soft pull so it still swings with the boat
    const k = guide ? 3.5 : config.crew.carrySpring;
    const cdmp = guide ? 0.8 : config.crew.carryDamping;
    const m = it.mass;
    const g = this.ctx.dw.gLocal;
    const fx = (k * (hp.x - t.x) - cdmp * (lv.x - cv.x)) * m;
    let fy = (k * (hp.y - t.y) - cdmp * (lv.y - cv.y)) * m - g.y * m;
    const fz = (k * (hp.z - t.z) - cdmp * (lv.z - cv.z)) * m;
    if (it.def.carry === 'push') fy = 0;
    const f = _v2.set(fx - (it.def.carry === 'push' ? 0 : g.x * m), fy, fz - (it.def.carry === 'push' ? 0 : g.z * m));
    const maxF = guide ? config.crew.carryMaxForce * 1.5 : it.def.carry === 'push' ? config.crew.carryMaxForce * 0.9 : config.crew.carryMaxForce;
    if (f.length() > maxF) f.setLength(maxF);
    b.applyImpulse({ x: f.x * dt, y: f.y * dt, z: f.z * dt }, true);
    // reaction on the carrier (heavy things pull you around a bit)
    const react = it.def.carry === 'push' ? 0.6 : 0.25;
    this.body.applyImpulse({ x: -f.x * dt * react, y: 0, z: -f.z * dt * react }, true);
    // orientation: keep upright & facing the carrier's facing
    if (it.def.holdUpright || it.kind === 'crab' || it.kind === 'cat') {
      const r = b.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _q2.setFromAxisAngle(UP, this.facing);
      const dq = _q2.multiply(_q.clone().invert());
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const ang = 2 * Math.acos(clamp(dq.w, -1, 1));
      const s = Math.sqrt(1 - dq.w * dq.w);
      const av = b.angvel();
      const kk = 30,
        cc = 6;
      const ax = s > 1e-4 ? dq.x / s : 0,
        ay = s > 1e-4 ? dq.y / s : 0,
        az = s > 1e-4 ? dq.z / s : 0;
      const wig = it.kind === 'crab' ? Math.sin(this.ctx.time * 22) * 6 : 0; // a crab struggles in your mitten
      b.setAngvel({ x: av.x + (ax * ang * kk - av.x * cc) * dt, y: av.y + (ay * ang * kk - av.y * cc + wig) * dt, z: av.z + (az * ang * kk - av.z * cc + wig * 0.5) * dt }, true);
    }
    // dropped if it gets yanked too far away (snagged)
    if (!guide && _v3.set(t.x, t.y, t.z).distanceTo(hp) > 1.8 + (it.def.carry === 'push' ? 1.2 : 0)) this.drop();
  }

  // -------------------------------------------------------------------------
  // Interaction targeting & verbs
  private stepInteract(dt: number, p: THREE.Vector3): void {
    const inp = this.input;
    const heldKind = this.held ? this.held.kind : null;

    // continuous verb in progress
    if (this.activeVerb) {
      const btnHeld = this.activeVerb.button === 'interact' ? inp.interact : this.activeVerb.button === 'use' ? inp.use : inp.use || inp.interact;
      const still = this.activeTarget && this.inReach(this.activeTarget, p, 0.6);
      if (btnHeld && still) {
        this.activeVerb.tick?.(this.id, dt);
      } else {
        this.activeVerb.end?.(this.id);
        this.activeVerb = null;
        this.activeTarget = null;
      }
    }

    // pick the target
    this.pickTarget(p, heldKind);

    // throw aim
    if (inp.throwAim && this.held && this.held.def.carry !== 'push') {
      this.throwAiming = true;
      if (inp.aim) this.throwTarget.copy(inp.aim);
    }
    if (inp.throwRelease > 0 && this.held && this.held.def.carry !== 'push') {
      const tgt = inp.aim ?? this.throwTarget;
      this.throwTo(tgt);
      this.throwAiming = false;
      return;
    }
    if (!inp.throwAim) this.throwAiming = false;

    const verbs = this.targetVerbs;
    const tryVerb = (button: 'use' | 'interact') => {
      const v = verbs.find((vb) => vb.button === button || vb.button === 'any');
      if (!v) return false;
      if (v.hold) {
        this.activeVerb = v;
        this.activeTarget = this.target;
        v.start?.(this.id);
      } else v.start?.(this.id);
      return true;
    };

    if (inp.usePressed > 0 && !this.activeVerb) {
      if (!tryVerb('use')) {
        if (this.held && this.held.def.carry === 'sticky') this.drop();
      }
    }
    if (inp.interactPressed > 0 && !this.activeVerb) {
      if (!tryVerb('interact')) {
        if (this.held) this.drop();
      }
    }
    // hold-to-carry: releasing the button puts it down (or places it on what you're over)
    if (this.held && this.held.def.carry !== 'sticky' && !inp.use && !this.throwAiming && !inp.throwAim) {
      const place = verbs.find((v) => v.id.startsWith('place'));
      if (place) place.start?.(this.id);
      if (this.held) this.drop();
    }
  }

  inReach(it: Interactable, p: THREE.Vector3, slack = 0): boolean {
    const ip = it.pos(_v3);
    const dx = ip.x - p.x,
      dz = ip.z - p.z;
    const dy = ip.y - p.y;
    if (it.minY !== undefined && ip.y < it.minY) return false;
    return Math.hypot(dx, dz) <= config.crew.reach + it.radius + slack && Math.abs(dy) < 2.6;
  }

  private pickTarget(p: THREE.Vector3, heldKind: string | null): void {
    const inp = this.input;
    let best: Interactable | null = null;
    let bestVerbs: Verb[] = [];
    let bestScore = Infinity;
    const fwdx = Math.sin(this.facing),
      fwdz = Math.cos(this.facing);
    const list = this.ctx.interact.list;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (inp.targetId !== null && it.id !== inp.targetId) continue;
      if (this.held && (it as { itemRef?: Item }).itemRef === this.held) continue;
      if (!this.inReach(it, p)) continue;
      const verbs = it.verbs(this.id, heldKind);
      if (!verbs || verbs.length === 0) continue;
      const ip = it.pos(_v3);
      const dx = ip.x - p.x,
        dz = ip.z - p.z;
      const d = Math.hypot(dx, dz);
      let score: number;
      if (inp.aim && !inp.lookDir) {
        score = Math.hypot(ip.x - inp.aim.x, ip.z - inp.aim.z) + d * 0.35;
      } else if (inp.aim && inp.lookDir) {
        // first person: closeness to the reticle ray hit
        score = ip.distanceTo(inp.aim) + d * 0.25;
      } else {
        const dot = d > 1e-3 ? (dx * fwdx + dz * fwdz) / d : 1;
        score = d * 0.6 + (1 - dot) * 1.4;
      }
      score -= (it.priority ?? 0) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = it;
        bestVerbs = verbs;
      }
    }
    this.target = best;
    this.targetVerbs = bestVerbs;
  }

  // -------------------------------------------------------------------------
  // Knockdowns
  /** dv: local velocity kick (m/s). */
  knockdown(dv: THREE.Vector3, reason: string, opts: { spin?: number; noHat?: boolean } = {}): void {
    if (this.state !== 'stand') return;
    if (this.atHelm) return;
    this.unbrace();
    if (this.held) this.drop();
    if (this.activeVerb) {
      this.activeVerb.end?.(this.id);
      this.activeVerb = null;
    }
    this.lastKnock = this.ctx.time;
    this.knockCount++;
    const p = this.pos(new THREE.Vector3());
    const lv = this.vel(new THREE.Vector3()).add(dv);
    // the hat flies!
    if (!opts.noHat) this.popHat(_v2.copy(dv).multiplyScalar(0.6).add(new THREE.Vector3(0, 3.2, 0)));
    const spinAxis = new THREE.Vector3(dv.z, 0, -dv.x);
    if (spinAxis.lengthSq() < 1e-4) spinAxis.set(1, 0, 0);
    spinAxis.normalize().multiplyScalar(opts.spin ?? 4.5);
    const rd = this.pool.acquire();
    const r = this.body.rotation();
    const rootQ = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    // the view's yaw is the facing, not the capsule's spin
    const viewQ = new THREE.Quaternion().setFromAxisAngle(UP, this.facing);
    const tilt = new THREE.Quaternion().setFromUnitVectors(UP, _v3.copy(UP).applyQuaternion(rootQ));
    viewQ.premultiply(tilt);
    if (rd) {
      this.ragdoll = rd;
      rd.activate(this.id, this.view, p, viewQ, lv, spinAxis);
      this.body.setEnabled(false);
    } else {
      // pool exhausted → tumble roll on the capsule
      this.ragdoll = null;
      this.tumbleSpin = 0;
      this.tumbleAxis.copy(spinAxis).normalize();
      this.body.setLinvel({ x: lv.x, y: lv.y + 1.5, z: lv.z }, true);
    }
    this.state = 'down';
    this.downTime = 0;
    sfx.play('squeak', { pitch: 0.9 + Math.random() * 0.3 });
    if (this.vocalCooldown <= 0) {
      sfx.play('hup', { pitch: this.voicePitch * 1.2, volume: 0.8 });
      this.vocalCooldown = 1;
    }
    events.emit('knockdown', { crew: this.id, pos: p.clone(), reason });
  }

  get voicePitch(): number {
    return this.id === 'mo' ? 0.75 : this.id === 'dot' ? 1.15 : this.id === 'ike' ? 1.3 : 1.0;
  }

  private stepDown(dt: number): void {
    this.downTime += dt;
    if (this.ragdoll) {
      const pel = this.ragdoll.pelvis(_v);
      if (ItemManager.outsideHull(pel, config.deck.overboardMargin)) {
        this.goOverboard();
        return;
      }
      // keep the disabled capsule riding along (for queries)
      this.body.setTranslation({ x: pel.x, y: pel.y + 0.3, z: pel.z }, false);
    } else {
      // tumble roll: capsule slides, view rolls
      const lv = this.body.linvel();
      this.tumbleSpin += Math.hypot(lv.x, lv.z) * dt * 3 + dt * 2;
      const t = this.body.translation();
      _v.set(t.x, t.y, t.z);
      if (ItemManager.outsideHull(_v, config.deck.overboardMargin)) {
        this.goOverboard();
        return;
      }
      // still keep upright-ish so the capsule does not wedge
      const r = this.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const bodyUp = _v2.copy(UP).applyQuaternion(_q);
      const axis = new THREE.Vector3().crossVectors(bodyUp, UP);
      const av = this.body.angvel();
      this.body.applyTorqueImpulse({ x: (axis.x * 300 - av.x * 60) * dt, y: 0, z: (axis.z * 300 - av.z * 60) * dt }, true);
    }
    const tired = this.ragdoll ? this.ragdoll.velocity(_v2).length() < 1.2 : true;
    if (this.downTime > config.crew.ragdollTime && (tired || this.downTime > config.crew.ragdollTime * 3)) this.beginGetup();
  }

  private beginGetup(): void {
    const p = new THREE.Vector3();
    if (this.ragdoll) {
      this.ragdoll.pelvis(p);
      // clamp inside the hull so we never stand up inside a rail
      p.y = Math.max(0, p.y - 0.4);
      this.getupFrom = PART_NAMES.map((n) => ({ p: this.view.parts[n].obj.position.clone(), q: this.view.parts[n].obj.quaternion.clone() }));
      this.ragdoll.deactivate();
      this.ragdoll = null;
      // find a free spot: lift until clear
      this.body.setEnabled(true);
      this.body.setTranslation({ x: p.x, y: CENTER_Y + 0.05 + Math.max(0, p.y), z: p.z }, true);
      this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const t = this.body.translation();
      this.bs.reset(t, this.body.rotation());
    } else {
      this.getupFrom = null;
      this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.state = 'getup';
    this.getupTime = 0;
  }

  private stepGetup(dt: number): void {
    this.getupTime += dt;
    // stand still while getting up, keep upright
    const lv = this.body.linvel();
    this.body.applyImpulse({ x: -lv.x * config.crew.mass * 0.2, y: 0, z: -lv.z * config.crew.mass * 0.2 }, true);
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const bodyUp = _v2.copy(UP).applyQuaternion(_q);
    const axis = new THREE.Vector3().crossVectors(bodyUp, UP);
    const av = this.body.angvel();
    this.body.applyTorqueImpulse({ x: (axis.x * 1200 - av.x * 150) * dt, y: -av.y * 40 * dt, z: (axis.z * 1200 - av.z * 150) * dt }, true);
    if (this.getupTime >= config.crew.getUpTime) {
      this.state = 'stand';
      this.getupFrom = null;
      this.slopeTime = 0;
    }
  }

  /**
   * Safety net: nothing on deck may end up under the deck plate. Near (or past) the hull edge
   * that means over the side, so go overboard; inside the hull, lift back onto the deck.
   */
  private belowDeckNet(): void {
    const p = this.ragdoll ? this.ragdoll.pelvis(_v) : this.pos(_v);
    if (p.y > -0.6) return;
    if (ItemManager.outsideHull(p, -0.2)) {
      this.goOverboard();
      return;
    }
    if (this.ragdoll) {
      this.ragdoll.lift(0.45 - p.y);
    } else {
      this.body.setTranslation({ x: p.x * 0.85, y: CENTER_Y + 0.2, z: p.z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // -------------------------------------------------------------------------
  // Overboard (sea state, world space)
  goOverboard(): void {
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    if (this.ragdoll) {
      this.ragdoll.pelvis(p);
      this.ragdoll.velocity(v);
      this.ragdoll.deactivate();
      this.ragdoll = null;
    } else {
      this.pos(p);
      this.vel(v);
    }
    if (this.held) this.drop();
    this.unbrace();
    // always land in the water outside the hull
    if (!ItemManager.outsideHull(p, 0.6)) {
      const side = p.x >= 0 ? 1 : -1;
      p.x = side * (hullHalfWidth(Math.max(-9, Math.min(9, p.z))) + 1.0);
      v.set(side * 1.5, 1.5, 0);
    }
    this.ctx.boat.localToWorld(p, this.wp);
    this.ctx.boat.pointVelocity(p, this.wv);
    this.wv.add(v.applyQuaternion(this.ctx.boat.quat));
    this.prevWp.copy(this.wp);
    this.body.setEnabled(false);
    this.state = 'sea';
    this.seaTime = 0;
    this.onRing = false;
    this.view.setSuit(true);
    if (this.hatOn) this.popHat(new THREE.Vector3(0, 2, 0));
    sfx.play('splash', { volume: 1, pitch: 0.8 });
    events.emit('overboard', { kind: 'crew', who: this.id, worldPos: this.wp.clone() });
  }

  private stepSea(dt: number): void {
    this.seaTime += dt;
    this.prevWp.copy(this.wp);
    const sea = this.ctx.sea;
    const h = sea.height(this.wp.x, this.wp.z);
    // bob upright in the survival suit
    const target = h - 0.95; // chest at the waterline
    if (this.wp.y > h + 0.2) this.wv.y -= config.sim.gravity * dt;
    else this.wv.y += ((target - this.wp.y) * 18 - this.wv.y * 5) * dt;
    // swim (input is boat-local; convert to world)
    const mv = this.input.move;
    _v.set(mv.x, 0, mv.y);
    if (_v.lengthSq() > 1) _v.normalize();
    _v.applyAxisAngle(UP, this.ctx.boat.yaw).multiplyScalar(this.onRing ? 0.1 : config.overboard.swimSpeed);
    const drift = this.ctx.items.drift;
    const ds = config.sea.swimmerDrift;
    this.wv.x += ((_v.x + drift.x * ds - this.wv.x) * 1.2 + this.seaPull.x) * dt;
    this.wv.z += ((_v.z + drift.y * ds - this.wv.z) * 1.2 + this.seaPull.z) * dt;
    this.wp.addScaledVector(this.wv, dt);
    this.seaPull.set(0, 0, 0);
    // keep clear of the hull (no collider out here): nudge outward
    if (this.state === 'sea') {
      const lp = this.ctx.boat.worldToLocal(this.wp, _v2);
      const z = Math.max(-9.4, Math.min(10.4, lp.z));
      const hw = hullHalfWidth(z) + 0.75;
      if (Math.abs(lp.x) < hw && lp.z > -10.2 && lp.z < 11) {
        const side = lp.x >= 0 ? 1 : -1;
        _v3.set(side, 0, 0).applyAxisAngle(UP, this.ctx.boat.yaw);
        this.wp.addScaledVector(_v3, Math.min(hw - Math.abs(lp.x), 2 * dt));
      }
    }
    if (_v.lengthSq() > 0.01) this.facing = Math.atan2(_v.x, _v.z) - this.ctx.boat.yaw;
    this.walkPhase += dt * 4;
  }

  /** Back aboard: flop over the rail at a local point with an inward velocity. */
  board(localPos: THREE.Vector3, inward: THREE.Vector3): void {
    this.body.setEnabled(true);
    this.body.setTranslation({ x: localPos.x, y: localPos.y + CENTER_Y, z: localPos.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: inward.x, y: inward.y, z: inward.z }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const t = this.body.translation();
    this.bs.reset(t, this.body.rotation());
    this.state = 'stand';
    this.view.setSuit(false);
    this.onRing = false;
    // like a seal: flop down for a moment
    this.knockdown(inward.clone().multiplyScalar(0.6), 'flop', { spin: 3, noHat: true });
    sfx.play('flop', { volume: 0.9 });
    later((350) / 1000, () => sfx.play('giggle', { pitch: this.voicePitch }));
  }

  // -------------------------------------------------------------------------
  // Hat
  popHat(vel: THREE.Vector3): void {
    if (!this.hatOn) return;
    this.hatOn = false;
    const hat = this.view.hat;
    const p = this.head(new THREE.Vector3());
    p.y += 0.15;
    if (this.state === 'sea' || this.inSea) {
      hat.visible = false;
      this.hatRespawn = config.crew.hatRespawnSec;
      return;
    }
    hat.removeFromParent();
    hat.position.set(0, 0, 0);
    hat.rotation.set(0, 0, 0);
    const it = this.ctx.items.add(ITEM_DEFS.hat, hat, p, { vel });
    it.data.owner = this.id;
    const r = this.rng;
    it.body?.setAngvel({ x: (r.next() - 0.5) * 14, y: (r.next() - 0.5) * 10, z: (r.next() - 0.5) * 14 }, true);
    it.onToSea = () => {
      this.hatRespawn = config.crew.hatRespawnSec;
    };
    this.hatItem = it;
    this.hatRespawn = config.crew.hatRespawnSec * 1.5;
  }

  /** Put the hat back on (or a fresh one appears on the galley hook). */
  private stepHat(dt: number): void {
    if (this.hatOn) return;
    const it = this.hatItem;
    // a hat nobody reaches for a long while (on the roof, wedged somewhere): a fresh one turns up on the hook
    if (it && it.mode === 'deck' && !it.heldBy) {
      this.hatDeckTime += dt;
      if (this.hatDeckTime > 45) {
        this.hatDeckTime = 0;
        this.abandonHat();
        return;
      }
    } else this.hatDeckTime = 0;
    if (it && it.mode === 'deck' && this.isUp && !it.heldBy) {
      // walk past it → pop it back on
      const p = this.pos(_v);
      const hp = it.localPos(_v2);
      if (p.distanceTo(hp) < 0.8 && this.ctx.time - (it.data.grabbedAt ?? -10) > 0.5) this.wearHat();
    }
    if (it && it.heldBy && (it.heldBy as unknown) !== this) {
      // someone hands it back
      const other = it.heldBy as unknown as Crew;
      const p = this.pos(_v);
      if (other.pos(_v2).distanceTo(p) < 1.2) {
        other.releaseHeld();
        this.wearHat();
      }
    }
    if (it && it.heldBy === (this as unknown)) {
      this.releaseHeld();
      this.wearHat();
      return;
    }
    if (this.hatRespawn > 0) {
      this.hatRespawn -= dt;
      if (this.hatRespawn <= 0 && (!it || it.mode !== 'deck')) {
        // respawn on the galley hat hook
        if (it && it.mode !== 'gone') this.ctx.items.remove(it);
        const hat = this.view.hat;
        hat.visible = true;
        hat.removeFromParent();
        const h = this.ctx.items.add(ITEM_DEFS.hat, hat, L.hatHook.clone(), { fixed: true });
        h.data.owner = this.id;
        this.hatItem = h;
      }
    }
    if (it && it.mode === 'fixed' && this.isUp) {
      const p = this.pos(_v);
      if (p.distanceTo(it.fixedPos) < 1.3) this.wearHat();
    }
  }

  private hatDeckTime = 0;
  /** Give up on a hat that blew somewhere awkward: a fresh one turns up on the galley hook. */
  abandonHat(): void {
    const it = this.hatItem;
    if (this.hatOn || !it || it.mode !== 'deck' || it.heldBy) return;
    it.view = null; // keep the hat group for the respawn
    this.ctx.items.remove(it);
    this.hatItem = null;
    this.hatRespawn = 2;
  }

  wearHat(): void {
    const it = this.hatItem;
    if (it && it.mode !== 'gone') {
      it.view = null; // keep the group
      this.ctx.items.remove(it);
    }
    this.hatItem = null;
    const hat = this.view.hat;
    hat.removeFromParent();
    hat.visible = true;
    hat.position.copy(this.view.hatRest);
    hat.rotation.set(0, 0, 0);
    this.view.body.add(hat);
    this.hatOn = true;
  }

  // -------------------------------------------------------------------------
  // Render
  capture(): void {
    if (this.body.isEnabled()) this.bs.capture(this.body);
  }

  render(alpha: number, dtRender: number, boatP: THREE.Vector3, boatQ: THREE.Quaternion): void {
    const v = this.view;
    const t = this.ctx.time;
    if (this.state === 'down' && this.ragdoll) {
      // ragdoll drives each part; root sits at the pelvis
      this.ragdoll.states.pelvis.interp(alpha, this.renderP, this.renderQ);
      v.root.position.copy(this.renderP);
      v.root.quaternion.identity();
      v.body.quaternion.identity();
      v.body.position.set(0, 0, 0);
      this.ragdoll.pose(v, alpha, this.renderP, new THREE.Quaternion());
      v.ring.visible = false;
      return;
    }
    if (this.state === 'sea' || this.state === 'boarding') {
      const inv = _q.copy(boatQ).invert();
      _v.lerpVectors(this.prevWp, this.wp, alpha);
      this.renderP.copy(_v).sub(boatP).applyQuaternion(inv);
      v.root.position.copy(this.renderP);
      // upright in world → local orientation
      _q2.setFromAxisAngle(UP, this.facing + this.ctx.boat.yaw);
      v.root.quaternion.copy(inv).multiply(_q2);
      v.body.position.set(0, Math.sin(t * 2.2) * 0.04, 0);
      v.body.quaternion.identity();
      this.restPose();
      // wave both arms
      const wave = Math.sin(t * 7) * 0.5;
      v.parts.armL.obj.rotation.set(0, 0, 2.6 + wave);
      v.parts.armR.obj.rotation.set(0, 0, -2.6 - wave);
      if (this.onRing) {
        v.parts.armL.obj.rotation.set(-1.4, 0, 0.3);
        v.parts.armR.obj.rotation.set(-1.4, 0, -0.3);
      }
      v.ring.visible = false;
      return;
    }
    this.bs.interp(alpha, this.renderP, this.renderQ);
    v.root.position.copy(this.renderP);
    // tilt from the capsule, yaw from facing
    const bodyUp = _v.copy(UP).applyQuaternion(this.renderQ);
    const tilt = _q.setFromUnitVectors(UP, bodyUp);
    _q2.setFromAxisAngle(UP, this.facing);
    v.root.quaternion.copy(tilt).multiply(_q2);
    v.ring.visible = true;
    v.ring.position.set(this.renderP.x, 0.03, this.renderP.z);

    if (this.state === 'down' && !this.ragdoll) {
      // tumble roll
      this.restPose();
      v.body.position.set(0, -0.45, 0);
      v.body.quaternion.setFromAxisAngle(_v.copy(this.tumbleAxis).applyQuaternion(_q2.clone().invert()), this.tumbleSpin);
      return;
    }
    v.body.position.set(0, 0, 0);
    if (this.state === 'getup' && this.getupFrom) {
      const k = clamp(this.getupTime / config.crew.getUpTime, 0, 1);
      const e = k * k * (3 - 2 * k);
      PART_NAMES.forEach((n, i) => {
        const part = v.parts[n];
        const from = this.getupFrom![i];
        part.obj.position.lerpVectors(from.p, part.rest, e);
        part.obj.quaternion.slerpQuaternions(from.q, new THREE.Quaternion(), e);
      });
      v.body.quaternion.identity();
      return;
    }
    this.animateStanding(dtRender);
  }

  private restPose(): void {
    for (const n of PART_NAMES) {
      const part = this.view.parts[n];
      part.obj.position.copy(part.rest);
      part.obj.quaternion.identity();
    }
    this.view.parts.legs.obj.scale.set(1, 1, 1);
  }

  private animateStanding(dt: number): void {
    const v = this.view;
    const t = this.ctx.time;
    this.restPose();
    const wa = this.walkAmount;
    const ph = this.walkPhase;
    // walk bob + waddle
    v.body.position.y = Math.abs(Math.sin(ph)) * 0.05 * wa + Math.sin(t * 2) * 0.008;
    v.body.rotation.set(0, 0, Math.sin(ph) * 0.07 * wa);
    v.parts.legs.obj.rotation.x = Math.sin(ph * 2) * 0.12 * wa;
    v.parts.armL.obj.rotation.x = Math.sin(ph) * 0.6 * wa;
    v.parts.armR.obj.rotation.x = -Math.sin(ph) * 0.6 * wa;
    v.parts.armL.obj.rotation.z = 0.12;
    v.parts.armR.obj.rotation.z = -0.12;
    if (this.sliding) {
      // arms out for balance, comic windmill
      v.parts.armL.obj.rotation.set(Math.sin(t * 14) * 0.8, 0, 1.4);
      v.parts.armR.obj.rotation.set(-Math.sin(t * 14) * 0.8, 0, -1.4);
    }
    if (this.braced || this.crouch) {
      // wide stance, hands on the rail
      v.parts.legs.obj.scale.set(1.25, 0.9, 1);
      v.body.position.y = -0.06 * this.lean;
      if (this.braced) {
        const p = this.pos(_v);
        const toA = _v2.subVectors(this.braceAnchor, p);
        // anchor in root space (yaw only)
        toA.applyAxisAngle(UP, -this.facing);
        for (const [n, s] of [
          ['armL', 1],
          ['armR', -1],
        ] as [PartName, number][]) {
          const part = v.parts[n];
          const d = _v3.copy(toA).sub(part.rest);
          d.x += s * 0.12;
          const len = d.length();
          d.normalize();
          // arm points down its -Y: rotate -Y to d
          part.obj.quaternion.setFromUnitVectors(_down, d);
          part.obj.scale.setScalar(1);
          part.obj.position.copy(part.rest);
          if (len < 0.2) part.obj.quaternion.identity();
        }
        // strain wobble on the hat
        v.hat.rotation.z = Math.sin(t * 30) * 0.08 * clamp(this.braceStrain, 0, 1);
      } else {
        v.parts.armL.obj.rotation.set(0, 0, 0.8);
        v.parts.armR.obj.rotation.set(0, 0, -0.8);
      }
    }
    if (this.held && !this.braced) {
      const lift = this.held.kind === 'cat' ? -1.1 : -1.35;
      v.parts.armL.obj.rotation.set(lift, 0, -0.25);
      v.parts.armR.obj.rotation.set(lift, 0, 0.25);
      if (this.throwAiming) {
        v.parts.armR.obj.rotation.set(-2.8, 0, 0.2);
      }
    }
    if (this.activeVerb) {
      // working a lever / wheel / chipping
      const k = Math.sin(t * 10) * 0.25;
      v.parts.armL.obj.rotation.set(-1.2 + k, 0, -0.2);
      v.parts.armR.obj.rotation.set(-1.2 - k, 0, 0.2);
    }
    if (this.atHelm) {
      v.parts.armL.obj.rotation.set(-1.3, 0, -0.3);
      v.parts.armR.obj.rotation.set(-1.3, 0, 0.3);
    }
    if (this.stagger > 0) {
      v.body.rotation.z += Math.sin(t * 25) * 0.15;
      v.parts.legs.obj.rotation.x = Math.sin(t * 30) * 0.3;
    }
  }
}
