/**
 * Pots: the heart of the trip.
 *   stack → (crane) → cradle → bait → LAUNCH (cradle tips outboard) → splash, buoy pops → soak
 *   buoy alongside → grapple → line to the block → HAUL (hold the lever) → pot rises streaming water
 *   → swings on its line (driven by the boat's roll) → guide it over the cradle → release in the LEVEL window
 *   → THUNK (good) or skid & slide (bad) → TIP onto the sorting table → crabs cascade → pot back to the stack.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { later } from '../core/schedule';
import * as THREE from 'three';
import { config, DEG } from '../config';
import { clamp, easeInOut, lerp, smoothstep } from '../core/math';
import { BodyState } from '../deck/deckWorld';
import { CG } from '../deck/groups';
import { ItemManager, type Item, type ItemDef } from '../deck/items';
import { interactableId, type Interactable, type Verb } from '../deck/interact';
import { L } from '../boat/layout';
import { makePot, type PotView } from '../art/pot';
import { makeBuoy, makeBaitJar, makeOtter } from '../art/items';
import type { Ctx } from '../game/ctx';
import type { Crew, CrewId } from '../crew/crew';
import type { CrewManager } from '../crew/crewManager';
import type { CrabSystem, Species } from './crabs';
import { rollCatch, type PotCatch } from './catch';
import { events } from '../core/events';
import { haptics } from '../core/haptics';
import { sfx } from '../audio';
import type { Rng } from '../core/rng';

export type PotState = 'stacked' | 'craning' | 'cradle' | 'launching' | 'falling' | 'soaking' | 'onLine' | 'onBlock' | 'rising' | 'hanging' | 'deck' | 'rehook' | 'tipping' | 'stowing';

const [PW, PH, PD] = config.fishing.potSize;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const ID = new THREE.Quaternion();

export const POT_DEF: ItemDef = {
  kind: 'pot',
  label: 'crab pot',
  icon: '🧺',
  shape: { type: 'box', half: [PW / 2, PH / 2, PD / 2] },
  mass: config.fishing.potMass,
  friction: 0.14,
  restitution: 0.02,
  carry: 'push',
  sea: 'sink',
  linDamp: 0.12,
  angDamp: 1.6,
  group: CG.pot,
};

interface Tween {
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  t: number;
  dur: number;
  arc: number;
  done: () => void;
}

export interface PotString {
  id: number;
  pots: Pot[];
  color: string;
}

export class Pot {
  state: PotState = 'stacked';
  readonly body: RAPIER.RigidBody;
  readonly bs = new BodyState();
  item: Item | null = null;
  baited = false;
  catch: PotCatch | null = null;
  stringNo = -1;
  number = -1;
  setAt = 0;
  readonly setWorld = new THREE.Vector3();
  quality = 1;
  buoy: Item | null = null;
  slot = -1;
  tw: Tween | null = null;
  riseY = 0;
  ropeLen = 0;
  // falling into the sea (world)
  readonly wp = new THREE.Vector3();
  readonly wv = new THREE.Vector3();
  readonly prevWp = new THREE.Vector3();
  readonly wq = new THREE.Quaternion();
  fallT = 0;
  splashed = false;
  hauled = false;
  otter: THREE.Object3D | null = null;
  heldPrev = false;
  landedAt = -10;
  /** seconds 'onLine' with no line anywhere (see PotSystem.stepPot) */
  strandT = 0;
  /** who last had hold of it while it hung on the line (the landing is credited to them) */
  guideBy?: string;
  /** when the player started lining up its landing / its grapple throw (bots wait at most 6 s) */
  dibsSince?: number;
  grappleDibsSince?: number;
  readonly kinP = new THREE.Vector3();
  readonly kinQ = new THREE.Quaternion();

  constructor(
    readonly index: number,
    readonly view: PotView,
    body: RAPIER.RigidBody,
  ) {
    this.body = body;
  }

  get fill(): number {
    return this.catch ? this.catch.crabs.length / config.fishing.maxCatchBodies : 0;
  }
}

export class PotSystem {
  readonly pots: Pot[] = [];
  readonly strings: PotString[] = [];
  cradlePot: Pot | null = null;
  blockPot: Pot | null = null;
  /** cradle animation */
  cradleMode: 'idle' | 'launch' | 'tip' = 'idle';
  cradleT = 0;
  cradleAngle = 0;
  /** trip control */
  settingString = 0; // which string new pots belong to
  settingAllowed = true;
  /** the trip wants the next pot over the side (spacing along the string) */
  launchWanted = false;
  autoCrane = true;
  private catchRng: Rng;
  private spotRng: Rng;
  private ropeLine: THREE.Line;
  private ropePos = new Float32Array(5 * 3);
  private craneLine: THREE.Line;
  private cranePos = new Float32Array(2 * 3);
  hauling = false;
  hauler: Crew | null = null;
  private winch: ReturnType<typeof sfx.loop>;
  goldenGiven = false;
  specialsQueue: string[] = [];
  potsHauled = 0;
  readonly landings: { good: boolean; deg: number; grade?: string; by?: string }[] = [];
  /** |deck level| samples over the last 150 ms: the landing grade forgives a late release */
  private levelBuf: { t: number; v: number }[] = [];
  /** the player's missed landings in a row (two: Mo holds her steady) */
  steadyMisses = 0;
  private tipSeq = 0;
  private pendingCatchLeft: { crabs: number; species: Species[] } = { crabs: 0, species: [] };

  constructor(private ctx: Ctx) {
    ctx.sys.pots = this;
    this.catchRng = ctx.rng.stream('catch');
    this.spotRng = ctx.rng.stream('spots');
    const specials = ['otter', 'bottle', 'golden', 'octopus', 'boot', 'jelly', 'bell'];
    // shuffle (seeded) — a "pot luck" order of surprises
    for (let i = specials.length - 1; i > 0; i--) {
      const j = Math.floor(this.catchRng.next() * (i + 1));
      [specials[i], specials[j]] = [specials[j], specials[i]];
    }
    this.specialsQueue = specials;
    const total = config.fishing.stringCount * config.fishing.potsPerString;
    for (let i = 0; i < total; i++) {
      const view = makePot();
      ctx.boatGroup.add(view.root);
      const slotPos = this.slotPos(i, new THREE.Vector3());
      const body = ctx.dw.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(slotPos.x, slotPos.y, slotPos.z));
      const col = ctx.dw.world.createCollider(RAPIER.ColliderDesc.cuboid(PW / 2 - 0.02, PH / 2, PD / 2 - 0.02).setCollisionGroups(CG.potStacked).setFriction(0.5), body);
      const pot = new Pot(i, view, body);
      ctx.dw.setOwner(col, { kind: 'pot', pot });
      pot.slot = i;
      pot.bs.reset(slotPos, ID);
      pot.kinP.copy(slotPos);
      this.pots.push(pot);
    }
    for (let s = 0; s < config.fishing.stringCount; s++) this.strings.push({ id: s, pots: [], color: s === 0 ? '#e8742b' : '#f2c230' });

    // rope from the hauler over the block to the pot
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.ropePos, 3));
    this.ropeLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe8d8a0 }));
    this.ropeLine.frustumCulled = false;
    this.ropeLine.visible = false;
    ctx.boatGroup.add(this.ropeLine);
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(this.cranePos, 3));
    this.craneLine = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: 0x333333 }));
    this.craneLine.frustumCulled = false;
    this.craneLine.visible = false;
    ctx.boatGroup.add(this.craneLine);
    this.winch = sfx.loop('winch', { volume: 0 });
    this.registerInteractables();
  }

  private get crew(): CrewManager {
    return this.ctx.sys.crew as CrewManager;
  }
  private get crabs(): CrabSystem {
    return this.ctx.sys.crabs as CrabSystem;
  }

  slotPos(slot: number, out: THREE.Vector3): THREE.Vector3 {
    // top tier first when taking, so index 0..5 = bottom, 6..11 = top
    const cols = L.stackCols.length;
    const rows = L.stackRows.length;
    const perTier = cols * rows;
    const tier = Math.floor(slot / perTier);
    const k = slot % perTier;
    const col = k % cols;
    const row = Math.floor(k / cols);
    return out.set(L.stackCols[col], L.stackTierY[tier] + 0.01, L.stackRows[row]);
  }

  private freeSlot(): number {
    const used = new Set(this.pots.filter((p) => p.state === 'stacked' || p.state === 'stowing').map((p) => p.slot));
    for (let s = 0; s < 12; s++) if (!used.has(s)) return s;
    return 11;
  }

  stackCount(): number {
    return this.pots.filter((p) => p.state === 'stacked').length;
  }

  // -------------------------------------------------------------------------
  // body helpers
  private setKinematic(pot: Pot, at: THREE.Vector3, q = ID): void {
    const b = pot.body;
    b.setEnabled(true);
    b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    b.collider(0).setCollisionGroups(CG.pot);
    b.setTranslation({ x: at.x, y: at.y, z: at.z }, true);
    b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    pot.kinP.copy(at);
    pot.kinQ.copy(q);
    pot.bs.reset(at, q);
  }
  private setFixedInStack(pot: Pot): void {
    const p = this.slotPos(pot.slot, _v);
    const b = pot.body;
    b.setEnabled(true);
    b.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    b.collider(0).setCollisionGroups(CG.potStacked);
    b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    pot.kinP.copy(p);
    pot.kinQ.identity();
    pot.bs.reset(p, ID);
  }
  private moveKinematic(pot: Pot, p: THREE.Vector3, q: THREE.Quaternion): void {
    pot.kinP.copy(p);
    pot.kinQ.copy(q);
    pot.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    pot.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
  /** Switch to a free dynamic body (an Item) — swinging on the line or sliding on deck. */
  private toDynamic(pot: Pot, p: THREE.Vector3, q: THREE.Quaternion, vel?: THREE.Vector3): Item {
    pot.body.setEnabled(false);
    const it = this.ctx.items.add(POT_DEF, pot.view.root, p, { quat: q, vel });
    it.data.pot = pot;
    it.data.label = 'crab pot';
    it.data.verbs = (crewId: string, held: string | null) => this.potItemVerbs(pot, crewId, held);
    it.def.noOverboard = true;
    pot.item = it;
    return it;
  }
  private fromDynamic(pot: Pot): THREE.Vector3 {
    const it = pot.item!;
    const p = it.localPos(new THREE.Vector3());
    for (const c of this.crew.list) if (c.held === it) c.releaseHeld();
    it.view = null; // keep the pot view
    this.ctx.items.remove(it);
    pot.item = null;
    this.ctx.boatGroup.add(pot.view.root);
    return p;
  }

  // -------------------------------------------------------------------------
  // cradle geometry
  /** Cradle transform for a tilt angle (deg>0 launch outboard, <0 tip inboard). */
  cradleTransform(angle: number, outP: THREE.Vector3, outQ: THREE.Quaternion): void {
    const c = L.cradle;
    const pivotX = angle >= 0 ? c.center.x - c.half.x : c.center.x + c.half.x;
    outQ.setFromAxisAngle(Z, angle);
    outP.set(c.center.x - pivotX, 0, 0).applyQuaternion(outQ);
    outP.x += pivotX;
    outP.y += c.center.y;
    outP.z = c.center.z;
  }
  private potOnCradle(angle: number, outP: THREE.Vector3, outQ: THREE.Quaternion): void {
    this.cradleTransform(angle, _v3, outQ);
    outP.set(0, L.cradle.half.y + PH / 2, 0).applyQuaternion(outQ).add(_v3);
  }

  // -------------------------------------------------------------------------
  // Actions
  /** Crane the next stacked pot onto the empty cradle. */
  craneNext(): boolean {
    if (this.cradlePot || this.cradleMode !== 'idle') return false;
    const stacked = this.pots.filter((p) => p.state === 'stacked').sort((a, b) => b.slot - a.slot);
    const pot = stacked[0];
    if (!pot) return false;
    this.cradlePot = pot;
    pot.state = 'craning';
    pot.baited = false;
    pot.catch = null;
    pot.view.setBaited(false);
    pot.view.setFullness(0);
    pot.view.setNumber(null);
    const from = this.slotPos(pot.slot, new THREE.Vector3());
    this.setKinematic(pot, from);
    const to = new THREE.Vector3();
    this.potOnCradle(0, to, _q);
    pot.tw = { from, to, fromQ: ID.clone(), toQ: ID.clone(), t: 0, dur: 2.2, arc: 2.6, done: () => this.arriveOnCradle(pot) };
    sfx.play('winchStart', { volume: 0.5 });
    return true;
  }

  private arriveOnCradle(pot: Pot): void {
    pot.state = 'cradle';
    sfx.play('clunk', { volume: 0.7, pitch: 0.8 });
    events.emit('tutorial', { step: 'potOnCradle' });
  }

  bait(pot: Pot, crew: Crew): void {
    if (pot.baited) return;
    const jar = crew.held;
    if (!jar || jar.kind !== 'baitJar') return;
    crew.releaseHeld();
    this.ctx.items.remove(jar);
    pot.baited = true;
    pot.view.setBaited(true);
    sfx.play('clunk', { volume: 0.6, pitch: 1.3 });
    sfx.play('plus', { volume: 0.4, delay: 0.05 });
    events.emit('tutorial', { step: 'baited' });
    this.ctx.sys.hud?.pop('Baited!', pot.kinP.clone().setY(pot.kinP.y + 0.8), 'good', 1.0);
  }

  launch(): boolean {
    const pot = this.cradlePot;
    if (!pot || pot.state !== 'cradle' || !pot.baited || this.cradleMode !== 'idle' || !this.settingAllowed) return false;
    const str = this.strings[this.settingString];
    if (str.pots.length >= config.fishing.potsPerString) return false;
    pot.state = 'launching';
    pot.stringNo = str.id;
    pot.number = this.settingString * config.fishing.potsPerString + str.pots.length + 1;
    str.pots.push(pot);
    this.cradleMode = 'launch';
    this.cradleT = 0;
    sfx.play('lever', { volume: 0.8 });
    return true;
  }

  tip(): boolean {
    const pot = this.cradlePot;
    if (!pot || pot.state !== 'cradle' || !pot.catch || this.cradleMode !== 'idle') return false;
    pot.state = 'tipping';
    this.cradleMode = 'tip';
    this.cradleT = 0;
    sfx.play('lever', { volume: 0.8 });
    return true;
  }

  /** The grapple hooked a buoy: the pot is now on a line held by `crew`. */
  hookPot(pot: Pot): void {
    pot.state = 'onLine';
    events.emit('potHooked', { index: pot.number });
  }

  /** A hooked line got away before it came aboard: the buoy floats again off the block side. */
  private unhook(pot: Pot): void {
    pot.state = 'soaking';
    pot.strandT = 0;
    const g = this.ctx.sys.grapple as { hooked: Pot | null } | undefined;
    if (g && g.hooked === pot) g.hooked = null;
    const b = pot.buoy;
    if (b) {
      b.visible = true;
      this.ctx.items.spawnInSea(b, this.ctx.boat.localToWorld(_v.set(-5, 0, 1), new THREE.Vector3()), new THREE.Vector3(), 'float');
    }
  }

  /** Line end clipped into the block. */
  clipToBlock(pot: Pot): void {
    if (this.blockPot) return;
    this.blockPot = pot;
    pot.state = 'onBlock';
    pot.riseY = -config.fishing.potDepth;
    if (pot.buoy) {
      // the buoy comes aboard with the line
      this.ctx.items.remove(pot.buoy);
      pot.buoy = null;
    }
    sfx.play('clunk', { volume: 0.7 });
    this.ctx.sys.hud?.toast('Line in the block — hold the hauler lever!', '#f2c230');
    events.emit('tutorial', { step: 'clipped' });
  }

  private haulTick(dt: number, crew: Crew): void {
    const pot = this.blockPot;
    if (!pot) return;
    this.hauling = true;
    this.hauler = crew;
    if (pot.state === 'onBlock') {
      pot.state = 'rising';
      pot.view.root.visible = true;
      pot.view.setFullness(pot.catch ? pot.fill : 0.4);
      this.setKinematic(pot, _v.set(L.riseX, pot.riseY, L.block.z));
      pot.body.collider(0).setCollisionGroups(CG.potStacked);
      this.ensureCatch(pot);
      sfx.play('winchStart', { volume: 0.7 });
    }
    if (pot.state === 'rising') {
      const speed = config.fishing.haulSpeed * (this.ctx.upgrades.has('fasterHauler') ? config.fishing.fasterHaulerScale : 1);
      const before = pot.riseY;
      pot.riseY += speed * dt;
      const waterY = -config.boat.freeboard + this.waterOffsetAt(L.riseX, L.block.z);
      if (before - PH / 2 < waterY && pot.riseY - PH / 2 >= waterY) {
        // breaking the surface: water streams off in sheets
        sfx.play('splash', { volume: 0.9, pitch: 0.9 });
        this.ctx.sys.spray?.burstLocal(_v.set(L.riseX, waterY + 0.3, L.block.z), _v2.set(0, 1, 0), 22, 3.5, 1.2);
      }
      const hangStart = config.deck.railHeight + 0.2 + PH / 2;
      if (pot.riseY >= hangStart) this.startHanging(pot);
    }
  }

  /** Local sea surface offset from the mean waterline at a local XZ point. */
  private waterOffsetAt(x: number, z: number): number {
    const b = this.ctx.boat;
    b.localToWorld(_v2.set(x, -config.boat.freeboard, z), _v3);
    const h = this.ctx.sea.height(_v3.x, _v3.z);
    return h - _v3.y;
  }

  private ensureCatch(pot: Pot): void {
    if (pot.catch) return;
    const soakMin = Math.max(0.5, (this.ctx.time - pot.setAt) / 60);
    const fill = Math.min(config.fishing.maxCatchBodies, config.fishing.soakFillPerMin * soakMin * pot.quality);
    let special: string | null = null;
    // specials: the "pot luck"
    if (this.specialsQueue.length && (this.catchRng.chance(config.fishing.specialChance * 1.6) || this.potsHauled === 2)) special = this.specialsQueue.shift()!;
    let forceGolden = false;
    if (special === 'golden') {
      forceGolden = true;
      special = null;
    }
    if (!this.goldenGiven && this.potsHauled >= 6) forceGolden = true;
    const c = rollCatch(this.catchRng, fill, (s) => this.crabs.roll(s, this.catchRng), { forceGolden, special: special as never });
    if (c.golden) this.goldenGiven = true;
    pot.catch = c;
    pot.view.setFullness(pot.fill);
    if (c.special === 'otter') {
      // a sea otter rides up on top of the pot
      const o = makeOtter();
      o.position.set(0, PH / 2 + 0.12, 0);
      o.rotation.y = 0.6;
      pot.view.root.add(o);
      pot.otter = o;
    }
  }

  private startHanging(pot: Pot): void {
    pot.state = 'hanging';
    pot.guideBy = undefined;
    pot.dibsSince = undefined;
    const p = pot.kinP.clone();
    const it = this.toDynamic(pot, p, ID.clone(), new THREE.Vector3(0.6, 0.6, 0));
    it.data.label = pot.otter ? 'pot (with an otter on it!)' : 'swinging pot';
    // manual rope to the block: length = current distance; reel to hang length
    pot.ropeLen = p.clone().setY(p.y + PH / 2).distanceTo(L.block);
    it.body!.setLinearDamping(config.fishing.swingDamping);
    // hangs level from its bridle: swings as a pendulum without tumbling
    it.body!.lockRotations(true, true);
    pot.view.setDrip(0.9);
    this.ctx.sys.spray?.cascade(p, 30, 1.8);
    sfx.play('ropeCreak', { volume: 0.8 });
    events.emit('tutorial', { step: 'hanging' });
  }

  /** Called when someone lets go of a guided hanging pot. */
  private tryLand(pot: Pot): void {
    const it = pot.item;
    if (!it || !it.body) return;
    const p = it.localPos(_v);
    const target = new THREE.Vector3();
    this.potOnCradle(0, target, _q);
    const dx = Math.hypot(p.x - target.x, p.z - target.z);
    if (dx > 0.85 || this.cradlePot) return; // not over the cradle: keeps swinging
    const level = this.deckLevelDeg();
    // graded on the levelest the deck was over the last few frames before letting go (touch latency)
    const g = this.minRecentLevel(config.fishing.landingGraceMs);
    const good = g <= this.levelWindow();
    const grade: 'perfect' | 'good' | 'miss' = good ? (g <= this.levelCore() ? 'perfect' : 'good') : 'miss';
    const by = pot.guideBy;
    this.landings.push({ good, deg: level, grade, by });
    if (!good && by === 'player') {
      this.steadyMisses++;
      if (this.steadyMisses === 2) events.emit('radio', { who: 'Mo', text: "Easy, kid, I'll hold her steady." });
    } else if (good) this.steadyMisses = 0;
    const cascadeAt = target.clone();
    if (good) {
      this.fromDynamic(pot);
      this.cradlePot = pot;
      pot.state = 'cradle';
      this.setKinematic(pot, p, ID);
      pot.tw = { from: p.clone(), to: target, fromQ: ID.clone(), toQ: ID.clone(), t: 0, dur: 0.16, arc: 0, done: () => this.goodThunk(pot, grade, by, dx) };
      pot.state = 'craning';
    } else {
      // bad landing: the rope pays out on a tilted deck — the pot skids off the cradle
      pot.state = 'deck';
      pot.ropeLen = 0;
      it.body.lockRotations(false, true);
      const downhill = _v2.set(this.ctx.dw.gLocal.x, 0, this.ctx.dw.gLocal.z).normalize().multiplyScalar(2.2);
      it.body.setLinvel({ x: downhill.x, y: -1, z: downhill.z }, true);
      it.data.guide = undefined;
      it.data.label = 'loose pot (push it back)';
      for (const c of this.crew.list) if (c.held === it) c.releaseHeld();
      sfx.play('skid', { volume: 1 });
      sfx.play('clunk', { volume: 0.8, pitch: 0.7, delay: 0.05 });
      this.ctx.sys.hud?.toast(`Deck tilted ${Math.abs(level).toFixed(0)}° — the pot's loose! Wrestle it back!`, '#ffb070');
      this.ctx.sys.spray?.cascade(cascadeAt, 20, 1.6);
      this.blockPot = null;
      haptics.buzz(60);
      events.emit('potLanded', { good: false, levelDeg: level, grade, by, dx, stringNo: pot.stringNo, pot: pot.number });
    }
  }

  private goodThunk(pot: Pot, grade: 'perfect' | 'good' | 'miss' = 'good', by?: string, dx = 0): void {
    pot.state = 'cradle';
    this.blockPot = null;
    pot.hauled = true;
    pot.landedAt = this.ctx.time;
    pot.view.setDrip(0.4);
    const level = this.deckLevelDeg();
    const mine = by === 'player';
    if (mine && grade === 'perfect') {
      // DEAD LEVEL: a deeper dip, a fatter THUNK, a little chime and a gold flash
      this.ctx.boat.landingDip(config.boat.perfectDip);
      sfx.play('thunk', { volume: 1, pitch: 0.85 });
      sfx.play('chime', { pitch: 1.5, volume: 0.4, delay: 0.06 });
      this.ctx.sys.hud?.flash('rgba(242,194,48,.45)');
    } else {
      this.ctx.boat.landingDip(config.boat.landingDip);
      sfx.play('thunk', { volume: 1 });
      this.ctx.sys.hud?.flash('rgba(88,196,106,.55)');
    }
    sfx.play('splash', { volume: 0.5, pitch: 1.3, delay: 0.05 });
    this.ctx.sys.spray?.cascade(pot.kinP, 40, 2.0);
    haptics.buzz(config.haptics.landing);
    // the player's landing gets its grade pop from the score keeper; a bot's keeps the plain one
    if (!mine) this.ctx.sys.hud?.pop('THUNK! Level landing', pot.kinP.clone().setY(pot.kinP.y + 1.2), 'good', 1.4);
    events.emit('potLanded', { good: true, levelDeg: level, grade, by, dx, stringNo: pot.stringNo, pot: pot.number });
    this.potsHauled++;
  }

  /** Re-hook a loose pot from the deck back onto the block. */
  rehook(pot: Pot): void {
    if (pot.state !== 'deck' || this.blockPot) return;
    const p = this.fromDynamic(pot);
    this.blockPot = pot;
    pot.state = 'rehook';
    this.setKinematic(pot, p, ID);
    pot.body.collider(0).setCollisionGroups(CG.potStacked);
    const to = new THREE.Vector3(L.riseX + 0.6, config.deck.railHeight + 0.3 + PH / 2, L.block.z);
    pot.tw = { from: p.clone(), to, fromQ: ID.clone(), toQ: ID.clone(), t: 0, dur: 1.4, arc: 0.8, done: () => this.startHanging(pot) };
    sfx.play('winchStart', { volume: 0.7 });
  }

  /** Smoothed deck level (what the spirit level shows and the landing judges). */
  level = 0;
  /** The levelest |deck level| seen over the last `ms` (the landing grace). */
  minRecentLevel(ms: number): number {
    const since = this.ctx.time - ms / 1000 - 1e-6;
    let m = Math.abs(this.deckLevelDeg());
    for (const s of this.levelBuf) if (s.t >= since && s.v < m) m = s.v;
    return m;
  }
  /** The green window for this landing (the trip's tier, plus Mo holding her steady after two misses). */
  levelWindow(): number {
    return config.fishing.levelWindowDeg + (this.steadyMisses >= 2 ? config.fishing.steadyHandBonusDeg : 0);
  }
  /** The gold "dead level" core inside the window. */
  levelCore(): number {
    return config.fishing.levelPerfectDeg;
  }
  /** Signed deck level angle for landing: roll dominates, pitch counts a little. */
  deckLevelDeg(): number {
    return this.level;
  }
  private rawLevelDeg(): number {
    const g = this.ctx.dw.gLocal;
    // tilt of local gravity across the cradle (x) — what the pot actually feels
    const across = (Math.atan2(-g.x, -g.y) * 180) / Math.PI;
    const along = (Math.atan2(-g.z, -g.y) * 180) / Math.PI;
    return Math.abs(across) > Math.abs(along) * 2 ? across : Math.sign(across || 1) * Math.hypot(across, along * 0.5);
  }

  // -------------------------------------------------------------------------
  step(dt: number): void {
    const ctx = this.ctx;
    this.hauling = false;
    this.level += (this.rawLevelDeg() - this.level) * Math.min(1, dt * 8);
    // the same value the bubble shows, kept for the release grace
    const buf = this.levelBuf;
    buf.push({ t: ctx.time, v: Math.abs(this.deckLevelDeg()) });
    while (buf.length && buf[0].t < ctx.time - 0.15) buf.shift();
    // auto-crane the next pot onto the cradle while setting
    if (this.autoCrane && this.settingAllowed && !this.cradlePot && this.cradleMode === 'idle' && !this.blockPot) {
      const str = this.strings[this.settingString];
      if (str && str.pots.length < config.fishing.potsPerString) this.craneNext();
    }
    for (const pot of this.pots) this.stepPot(pot, dt);
    this.stepCradle(dt);
  }

  private stepPot(pot: Pot, dt: number): void {
    // tweens (crane, settle, rehook)
    if (pot.tw) {
      const tw = pot.tw;
      tw.t += dt;
      const k = easeInOut(clamp(tw.t / tw.dur, 0, 1));
      _v.lerpVectors(tw.from, tw.to, k);
      _v.y += Math.sin(k * Math.PI) * tw.arc;
      _q.slerpQuaternions(tw.fromQ, tw.toQ, k);
      this.moveKinematic(pot, _v, _q);
      if (tw.t >= tw.dur) {
        pot.tw = null;
        tw.done();
      }
      return;
    }
    switch (pot.state) {
      case 'onLine': {
        // Hooked, but the line never came aboard: the grapple hands it over only if its thrower
        // is still on their feet when it arrives, and a wave can knock them down mid-reel. With
        // no line on deck the pot would wait 'onLine' forever (nobody re-throws at a pot that
        // isn't soaking), so after a moment the buoy floats free again for another throw.
        const g = this.ctx.sys.grapple as { hooked: Pot | null; grapple: Item } | undefined;
        const reeling = !!g && g.hooked === pot && g.grapple.mode === 'sea';
        const aboard = this.ctx.items.items.some((it) => it.kind === 'lineEnd' && it.data.pot === pot);
        pot.strandT = reeling || aboard ? 0 : pot.strandT + dt;
        if (pot.strandT > 1.5) this.unhook(pot);
        break;
      }
      case 'cradle':
      case 'launching':
      case 'tipping': {
        this.potOnCradle(this.cradleAngle * DEG, _v, _q);
        this.moveKinematic(pot, _v, _q);
        break;
      }
      case 'falling': {
        pot.prevWp.copy(pot.wp);
        pot.fallT += dt;
        const h = this.ctx.sea.height(pot.wp.x, pot.wp.z);
        if (!pot.splashed) {
          pot.wv.y -= config.sim.gravity * dt;
          pot.wp.addScaledVector(pot.wv, dt);
          if (pot.wp.y <= h) {
            pot.splashed = true;
            sfx.play('splash', { volume: 1, pitch: 0.75 });
            this.ctx.sys.spray?.splashWorld(pot.wp, 1.4);
            pot.wv.set(pot.wv.x * 0.1, -1.6, pot.wv.z * 0.1);
            pot.setWorld.copy(pot.wp).setY(0);
            const buoyAt = pot.setWorld.clone();
            later((900) / 1000, () => this.popBuoy(pot, buoyAt));
          }
        } else {
          pot.wp.addScaledVector(pot.wv, dt);
          if (pot.wp.y < h - 4) {
            pot.state = 'soaking';
            pot.setAt = this.ctx.time;
            pot.view.root.visible = false;
          }
        }
        break;
      }
      case 'rising': {
        this.moveKinematic(pot, _v.set(L.riseX, pot.riseY, L.block.z), ID);
        const above = pot.riseY - PH / 2 > -config.boat.freeboard + this.waterOffsetAt(L.riseX, L.block.z);
        pot.view.setDrip(above ? 0.9 : 0);
        if (above && Math.random() < dt * 20) this.ctx.sys.spray?.cascade(_v.set(L.riseX, pot.riseY - PH / 2, L.block.z), 3, 1.8);
        break;
      }
      case 'hanging': {
        const it = pot.item;
        if (!it || !it.body) break;
        // reel in to the hang length
        pot.ropeLen = Math.max(config.fishing.hangLength, pot.ropeLen - dt * 0.6);
        this.applyRope(pot, it, dt);
        if (it.heldBy) pot.guideBy = (it.heldBy as unknown as Crew).id;
        // guided landing: whoever grabs it pulls it over the cradle
        this.potOnCradle(0, _v2, _q);
        _v2.x += 0.6; // aim a little past the cradle so it settles over it
        it.data.guide = _v2.clone().setY(it.localPos(_v).y);
        const held = !!it.heldBy;
        if (pot.heldPrev && !held) this.tryLand(pot);
        pot.heldPrev = held;
        if (pot.view.drips.visible) pot.view.setDrip(Math.max(0, ((pot.view.drips.material as THREE.PointsMaterial).opacity ?? 0) - dt * 0.15));
        break;
      }
      case 'deck': {
        const it = pot.item;
        if (it && it.body) {
          const p = it.localPos(_v);
          // 40 kg of steel never leaves the boat: if a sea shoved it over the rail or under the
          // deck plate, it's hanging off its line — drag it back aboard by the cradle.
          if (!it.heldBy && (p.y < -0.6 || ItemManager.outsideHull(p, 0))) {
            it.body.setTranslation({ x: -1.6, y: PH / 2 + 0.1, z: L.cradle.center.z - 2.05 }, true);
            it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            it.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            sfx.play('thunk', { volume: 0.6, pitch: 0.8 });
            break;
          }
          it.data.label = this.nearCradle(p) ? 'loose pot — re-hook it!' : 'loose pot (push it back to the block)';
        }
        break;
      }
    }
    if (pot.state === 'cradle' && pot.view.drips.visible && this.ctx.time - pot.landedAt > 3) pot.view.setDrip(0);
  }

  /** Close enough for the block to reach: the working deck around and aft of the cradle. */
  nearCradle(p: THREE.Vector3): boolean {
    return Math.abs(p.x - L.cradle.center.x) < 3.2 && p.z > L.cradle.center.z - 5.1 && p.z < L.cradle.center.z + 2.6;
  }

  /** Manual rope: only pulls when stretched (a soft inextensible line). */
  private applyRope(pot: Pot, it: Item, dt: number): void {
    const b = it.body!;
    const t = b.translation();
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const anchor = _v3.set(0, PH / 2, 0).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
    const d = _v2.subVectors(anchor, L.block);
    const len = d.length();
    const stretch = len - pot.ropeLen;
    if (stretch <= 0) return;
    d.divideScalar(len);
    const lv = b.velocityAtPoint(anchor);
    const vr = lv.x * d.x + lv.y * d.y + lv.z * d.z;
    const m = it.mass;
    const k = 220,
      c = 22;
    const f = -(k * stretch + c * Math.max(-3, vr)) * m;
    b.applyImpulseAtPoint({ x: d.x * f * dt, y: d.y * f * dt, z: d.z * f * dt }, anchor, true);
    if (Math.random() < dt * Math.min(2, Math.abs(vr) * 3)) sfx.play('ropeCreak', { volume: 0.3, pitch: 0.8 + Math.random() * 0.4 });
  }

  private stepCradle(dt: number): void {
    const pot = this.cradlePot;
    if (this.cradleMode === 'launch') {
      this.cradleT += dt;
      const up = 0.9,
        hold = 0.15,
        back = 0.7;
      const t = this.cradleT;
      const maxA = 68;
      this.cradleAngle = t < up ? maxA * easeInOut(t / up) : t < up + hold ? maxA : maxA * (1 - easeInOut((t - up - hold) / back));
      if (pot && pot.state === 'launching' && this.cradleAngle > 46) {
        // it slides off into the sea
        pot.state = 'falling';
        this.cradlePot = null;
        pot.body.setEnabled(false);
        const lp = pot.kinP.clone();
        this.ctx.boat.localToWorld(lp, pot.wp);
        pot.prevWp.copy(pot.wp);
        this.ctx.boat.pointVelocity(lp, pot.wv);
        _v.set(-2.6, -0.5, 0).applyQuaternion(this.ctx.boat.quat);
        pot.wv.add(_v);
        pot.fallT = 0;
        pot.splashed = false;
        pot.wq.copy(this.ctx.boat.quat).multiply(pot.kinQ);
        pot.quality = 0.7 + this.spotRng.next() * 0.6;
        events.emit('potLaunched', { index: pot.number, string: pot.stringNo });
        sfx.play('throw', { volume: 0.7, pitch: 0.6 });
      }
      if (t >= up + hold + back) {
        this.cradleMode = 'idle';
        this.cradleAngle = 0;
      }
    } else if (this.cradleMode === 'tip') {
      this.cradleT += dt;
      const up = 0.7,
        hold = 0.8,
        back = 0.7;
      const t = this.cradleT;
      const maxA = 58;
      this.cradleAngle = -(t < up ? maxA * easeInOut(t / up) : t < up + hold ? maxA : maxA * (1 - easeInOut((t - up - hold) / back)));
      if (pot) pot.view.door.rotation.z = -smoothstep(0.2, 0.6, t) * 2.0 * (1 - smoothstep(up + hold, up + hold + back, t));
      if (pot && pot.catch && t > up * 0.7) this.spill(pot);
      if (t >= up + hold + back) {
        this.cradleMode = 'idle';
        this.cradleAngle = 0;
        if (pot) this.stow(pot);
      }
    }
    // drive the cradle body + art
    this.cradleTransform(this.cradleAngle * DEG, _v, _q);
    const cb = this.ctx.structure.cradleBody;
    cb.setNextKinematicTranslation({ x: _v.x, y: _v.y, z: _v.z });
    cb.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    const art = this.ctx.boatArt.cradle;
    art.position.copy(_v);
    art.quaternion.copy(_q);
  }

  private spill(pot: Pot): void {
    const c = pot.catch!;
    pot.catch = null;
    pot.view.setFullness(0);
    const crabs = this.crabs;
    const maxBodies = config.fishing.maxCrabsOnDeck;
    const onDeck = crabs.crabs.filter((x) => x.mode === 'deck').length;
    let spawned = 0;
    let auto = 0;
    let golden = false;
    const tipId = ++this.tipSeq;
    c.crabs.forEach((data, i) => {
      if (onDeck + spawned >= maxBodies && data.species !== 'golden') {
        // the rest go straight down the chute, sorted by the boat's luck
        auto++;
        if (data.keep) crabs.tank.push({ species: data.species, weight: data.weight, correct: true, at: this.ctx.time });
        return;
      }
      const r = this.spotRng;
      const p = new THREE.Vector3(-1.05 + r.next() * 0.3, 1.5 + r.next() * 0.4, L.cradle.center.z - 0.7 + (i % 6) * 0.28);
      const v = new THREE.Vector3(1.6 + r.next() * 1.6, 1.2 + r.next() * 1.2, (r.next() - 0.5) * 1.4);
      data.tipId = tipId;
      later((i * 55) / 1000, () => crabs.spawn(p, data, v));
      spawned++;
      if (data.species === 'golden') golden = true;
    });
    if (auto) this.ctx.sys.hud?.toast(`+${auto} crab straight down the chute`, '#fff3c0');
    sfx.play('clatter', { volume: 1 });
    sfx.play('chatter', { volume: 0.7, pitch: 1.2, delay: 0.25 });
    events.emit('potTipped', { count: c.crabs.length, spawned, tipId });
    if (golden) {
      later((380) / 1000, () => {
        sfx.play('chime');
        sfx.play('sparkle', { delay: 0.1 });
        sfx.play('fanfare', { delay: 0.35 });
        events.emit('golden', { localPos: L.table.center.clone() });
      });
    }
    if (c.special) {
      const kind = c.special;
      later((300) / 1000, () => this.ctx.sys.specials?.spawnFromPot(kind, pot));
    }
    if (pot.otter) {
      const o = pot.otter;
      pot.otter = null;
      o.removeFromParent();
    }
  }

  private stow(pot: Pot): void {
    if (this.cradlePot === pot) this.cradlePot = null;
    pot.state = 'stowing';
    pot.slot = this.freeSlot();
    pot.baited = false;
    pot.view.setBaited(false);
    pot.view.setDrip(0);
    pot.view.door.rotation.z = 0;
    pot.view.setNumber(null);
    const to = this.slotPos(pot.slot, new THREE.Vector3());
    pot.tw = { from: pot.kinP.clone(), to, fromQ: pot.kinQ.clone(), toQ: ID.clone(), t: 0, dur: 2.2, arc: 2.4, done: () => {
      pot.state = 'stacked';
      this.setFixedInStack(pot);
    } };
  }

  private popBuoy(pot: Pot, at: THREE.Vector3): void {
    const def: ItemDef = { kind: 'buoy', label: 'buoy', icon: '🟠', shape: { type: 'ball', r: 0.42 }, mass: 4, carry: 'none', sea: 'float' };
    const view = makeBuoy(pot.number, true);
    const it = this.ctx.items.add(def, view, new THREE.Vector3(0, -50, 0), { fixed: true });
    it.data.noGrab = true;
    it.data.anchor = at.clone();
    it.data.pot = pot;
    it.wq.identity();
    this.ctx.items.spawnInSea(it, at.clone().setY(at.y - 1.2), new THREE.Vector3(0, 3.5, 0), 'float');
    pot.buoy = it;
    sfx.play('buoyPop', { volume: 0.9 });
    events.emit('buoyPopped', { index: pot.number, string: pot.stringNo, worldPos: at.clone() });
  }

  // -------------------------------------------------------------------------
  // Interactables
  private registerInteractables(): void {
    const ia = this.ctx.interact;
    const crewOf = (id: string) => this.crew.get(id as CrewId);
    // bait box: a jar appears in your mitten
    const takeBait: Verb = {
      id: 'takeBait',
      icon: '🫙',
      label: 'Grab a bait jar',
      button: 'use',
      start: (id) => {
        const c = crewOf(id);
        const p = c.holdPoint(new THREE.Vector3());
        const jar = this.ctx.items.add((this.ctx.sys.defs ?? {}).baitJar ?? BAIT_DEF, makeBaitJar(), p);
        c.grab(jar);
        events.emit('tutorial', { step: 'gotBait' });
      },
    };
    ia.add({
      id: interactableId(),
      name: 'bait box',
      radius: 0.45,
      pos: (out) => out.copy(L.baitBox.center).setY(0.6),
      verbs: (_id, held) => (held ? null : [takeBait]),
    });
    // the pot on the cradle: bait it
    const placeBait: Verb = { id: 'placeBait', icon: '🫙', label: 'Put the bait in the pot', button: 'any', start: (id) => this.cradlePot && this.bait(this.cradlePot, crewOf(id)) };
    ia.add({
      id: interactableId(),
      name: 'pot on cradle',
      radius: 1.1,
      priority: 1,
      pos: (out) => out.copy(L.potOnCradle),
      verbs: (_id, held) => (held === 'baitJar' && this.cradlePot && this.cradlePot.state === 'cradle' && !this.cradlePot.baited && !this.cradlePot.catch ? [placeBait] : null),
    });
    // launcher lever: launch / tip (hold to push)
    let leverHold = 0;
    const leverVerb = (mode: 'launch' | 'tip'): Verb => ({
      id: mode,
      icon: mode === 'launch' ? '🚀' : '🦀',
      label: mode === 'launch' ? 'Hold to launch the pot' : 'Hold to tip the pot onto the table',
      button: 'any',
      hold: true,
      start: () => {
        leverHold = 0;
        sfx.play('lever', { volume: 0.4, pitch: 1.3 });
      },
      tick: (_id, dt) => {
        leverHold += dt;
        this.ctx.boatArt.launcherLever.rotation.x = -Math.min(1, leverHold / 0.45) * 0.9;
        if (leverHold >= 0.45) {
          leverHold = -99;
          if (mode === 'launch') this.launch();
          else this.tip();
        }
      },
      end: () => {
        leverHold = 0;
        this.ctx.boatArt.launcherLever.rotation.x = 0;
      },
    });
    const launchV = leverVerb('launch');
    const tipV = leverVerb('tip');
    const needBait: Verb = { id: 'needBait', icon: '🫙', label: 'Bait the pot first (bait box)', button: 'any' };
    ia.add({
      id: interactableId(),
      name: 'launcher lever',
      radius: 0.35,
      priority: 0.5,
      pos: (out) => out.copy(L.launcherLever),
      verbs: (_id, held) => {
        const p = this.cradlePot;
        if (held || !p || p.state !== 'cradle' || this.cradleMode !== 'idle') return null;
        if (p.catch) return [tipV];
        if (!this.settingAllowed) return null;
        return p.baited ? [launchV] : [needBait];
      },
    });
    // hauler lever: hold to winch
    const haulV: Verb = {
      id: 'haul',
      icon: '⚙️',
      label: 'Hold to haul the pot up',
      button: 'any',
      hold: true,
      tick: (id, dt) => this.haulTick(dt, crewOf(id)),
    };
    ia.add({
      id: interactableId(),
      name: 'hauler',
      radius: 0.4,
      priority: 1,
      pos: (out) => out.copy(L.haulerLever),
      verbs: (_id, held) => (!held && this.blockPot && (this.blockPot.state === 'onBlock' || this.blockPot.state === 'rising') ? [haulV] : null),
    });
    // the block: clip a line in
    const clipV: Verb = {
      id: 'clip',
      icon: '🪝',
      label: 'Clip the line into the block',
      button: 'any',
      start: (id) => {
        const c = crewOf(id);
        const it = c.held;
        if (!it || it.kind !== 'lineEnd') return;
        const pot = it.data.pot as Pot;
        c.releaseHeld();
        this.ctx.items.remove(it);
        this.clipToBlock(pot);
      },
    };
    ia.add({
      id: interactableId(),
      name: 'block',
      radius: 0.9,
      priority: 2,
      pos: (out) => out.set(L.davitBase.x + 0.3, 1.0, L.davitBase.z - 0.6),
      verbs: (_id, held) => (held === 'lineEnd' && !this.blockPot ? [clipV] : null),
    });
  }

  /** Verbs for a pot that is a free dynamic item (hanging or loose on deck). */
  private potItemVerbs(pot: Pot, crewId: string, held: string | null): Verb[] | null {
    if (held) return null;
    const it = pot.item;
    if (!it || it.heldBy) return null;
    const verbs: Verb[] = [];
    if (pot.state === 'hanging') {
      verbs.push({ id: 'guide', icon: '🧺', label: 'Guide the pot — release over the cradle when LEVEL', button: 'use', start: (id) => this.crew.get(id as CrewId).grab(it) });
    } else if (pot.state === 'deck') {
      const p = it.localPos(_v);
      if (this.nearCradle(p) && !this.blockPot && !this.cradlePot) verbs.push({ id: 'rehook', icon: '🪝', label: 'Re-hook the pot to the block', button: 'interact', start: () => this.rehook(pot) });
      verbs.push({ id: 'push', icon: '🫸', label: 'Push the pot', button: 'use', start: (id) => this.crew.get(id as CrewId).grab(it) });
    }
    void crewId;
    return verbs;
  }

  // -------------------------------------------------------------------------
  capture(): void {
    for (const p of this.pots) if (p.body.isEnabled() && !p.item) p.bs.capture(p.body);
  }

  render(alpha: number, boatP: THREE.Vector3, boatQ: THREE.Quaternion): void {
    for (const pot of this.pots) {
      const v = pot.view.root;
      if (pot.state === 'soaking' || pot.state === 'onLine' || pot.state === 'onBlock') {
        v.visible = false;
        continue;
      }
      v.visible = true;
      if (pot.item) continue; // ItemManager places it
      if (pot.state === 'falling') {
        _v.lerpVectors(pot.prevWp, pot.wp, alpha).sub(boatP).applyQuaternion(_q.copy(boatQ).invert());
        v.position.copy(_v);
        v.quaternion.copy(_q).multiply(pot.wq);
        continue;
      }
      pot.bs.interp(alpha, v.position, v.quaternion);
    }
    // rope over the block
    const bp = this.blockPot;
    if (bp && (bp.state === 'onBlock' || bp.state === 'rising' || bp.state === 'hanging' || bp.state === 'rehook')) {
      this.ropeLine.visible = true;
      const drum = _v.set(L.davitBase.x + 0.3, 0.7, L.davitBase.z - 0.25);
      const blk = L.block;
      let end: THREE.Vector3;
      if (bp.state === 'onBlock') end = _v2.set(L.riseX, -config.boat.freeboard - 0.5, L.block.z);
      else if (bp.item) end = _v3.set(0, PH / 2, 0).applyQuaternion(bp.view.root.quaternion).add(bp.view.root.position);
      else end = _v3.copy(bp.view.root.position).setY(bp.view.root.position.y + PH / 2);
      const pts = [drum, new THREE.Vector3(L.davitTop.x, L.davitTop.y - 0.1, L.davitTop.z), blk, end, end];
      pts.forEach((p, i) => {
        this.ropePos[i * 3] = p.x;
        this.ropePos[i * 3 + 1] = p.y;
        this.ropePos[i * 3 + 2] = p.z;
      });
      (this.ropeLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    } else this.ropeLine.visible = false;
    // crane line while craning/stowing
    const cr = this.pots.find((p) => (p.state === 'craning' || p.state === 'stowing' || p.state === 'rehook') && p.tw && p.tw.dur > 1);
    const art = this.ctx.boatArt;
    if (cr) {
      const pp = cr.view.root.position;
      const mast = L.mast;
      const want = Math.atan2(-(pp.x - mast.x), -(pp.z - mast.z));
      art.craneBoom.rotation.y = lerp(art.craneBoom.rotation.y, want, 0.2);
      art.craneBoom.updateMatrix();
      art.craneHook.updateMatrix();
      _v.copy(art.craneHook.position).applyMatrix4(art.craneBoom.matrix);
      this.cranePos.set([_v.x, _v.y, _v.z, pp.x, pp.y + PH / 2, pp.z]);
      (this.craneLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.craneLine.visible = true;
    } else this.craneLine.visible = false;
    // spirit level on the rail
    const lv = this.deckLevelDeg();
    const sl = art.spiritLevel;
    sl.bubble.position.x = clamp(lv / 15, -1, 1) * 0.38;
    // gold in the dead-level core, green in the window, dark outside (the HUD level reads the same numbers)
    const alv = Math.abs(lv);
    ((sl.window.material as THREE.MeshStandardMaterial).emissive as THREE.Color).setHex(alv <= this.levelCore() ? 0xffd24a : alv <= this.levelWindow() ? 0x3aff6a : 0x1d6a2a);
    // hauler drum spins, winch sound follows haul speed
    if (this.hauling) art.haulerDrum.rotation.x += 0.25;
    this.winch.setVolume(this.hauling ? 0.8 : 0, 0.1);
    this.winch.setPitch(this.hauling ? 1.0 + (this.ctx.upgrades.has('fasterHauler') ? 0.5 : 0) : 0.6, 0.2);
    art.haulerLever.rotation.x = this.hauling ? -0.7 : 0;
  }

  /** Is any pot hanging (for the HUD spirit level)? */
  get hangingPot(): Pot | null {
    return this.pots.find((p) => p.state === 'hanging') ?? null;
  }

  /** Pots in the sea with buoys, for indicators and the captain. */
  soakingPots(stringNo?: number): Pot[] {
    return this.pots.filter((p) => p.state === 'soaking' && p.buoy && (stringNo === undefined || p.stringNo === stringNo));
  }
}

export const BAIT_DEF: ItemDef = { kind: 'baitJar', label: 'bait jar', icon: '🫙', shape: { type: 'cylinder', halfH: 0.12, r: 0.095 }, mass: 1.2, carry: 'hold', sea: 'float', friction: 0.2, holdUpright: true, ccd: true };
