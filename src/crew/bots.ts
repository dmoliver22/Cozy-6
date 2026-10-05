/**
 * Bot deckhands (Dot, Ike — and Mo when he's off the wheel). Small priority list, all acting
 * through CrewInput exactly like the player:
 *   1 brace on a wave warning · 2 rescue anyone overboard · 3 help with a pot on the rail
 *   4 sort crab · 5 bait jars · 6 coil line · 7 chip ice · 8 idle near the wheelhouse
 * Pings (player commands) slot in just under rescue.
 */
import * as THREE from 'three';
import { config } from '../config';
import { clamp } from '../core/math';
import { L, hullHalfWidth, insideHouse } from '../boat/layout';
import { NavGrid } from '../deck/navgrid';
import type { Ctx } from '../game/ctx';
import type { Crew, CrewId } from './crew';
import type { CrewManager } from './crewManager';
import type { Item } from '../deck/items';
import type { PotSystem, Pot } from '../fishing/pots';
import type { CrabData } from '../fishing/crabs';
import type { Rng } from '../core/rng';
import { events } from '../core/events';
import { sfx } from '../audio';

type Status = 'run' | 'done' | 'fail';
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class TaskBoard {
  readonly claims = new Map<string, CrewId>();
  claim(key: string, who: CrewId): boolean {
    const c = this.claims.get(key);
    if (c && c !== who) return false;
    this.claims.set(key, who);
    return true;
  }
  release(key: string | undefined, who: CrewId): void {
    if (key && this.claims.get(key) === who) this.claims.delete(key);
  }
  holder(key: string): CrewId | undefined {
    return this.claims.get(key);
  }
}

abstract class Task {
  abstract name: string;
  abstract pri: number;
  claimKey?: string;
  t = 0;
  stage = 0;
  abstract step(b: BotBrain, dt: number): Status;
  onEnd?(b: BotBrain): void;
}

// ---------------------------------------------------------------------------
export class BotBrain {
  task: Task | null = null;
  private path: THREE.Vector3[] = [];
  private pathGoal = new THREE.Vector3(1e9, 0, 0);
  private pathAge = 0;
  private thinkT = 0;
  private usingSince = -1;
  private throwT = -1;
  forgetThisWave = false;
  lastWaveId = -1;
  ping: { point: THREE.Vector3; iaId: number | null; until: number } | null = null;
  readonly rng: Rng;
  status = '';
  speed = 0.85;
  lateBrace = 0;

  constructor(
    readonly crew: Crew,
    readonly ctx: Ctx,
    readonly board: TaskBoard,
    readonly grid: NavGrid,
  ) {
    this.rng = ctx.rng.stream('bot-' + crew.id);
    if (crew.id === 'ike') this.speed = 1.0;
  }

  get crewMgr(): CrewManager {
    return this.ctx.sys.crew as CrewManager;
  }
  get pots(): PotSystem {
    return this.ctx.sys.pots as PotSystem;
  }
  get player(): Crew {
    return this.crewMgr.player;
  }

  // ------------------------------------------------------------------ helpers
  pos(out = new THREE.Vector3()): THREE.Vector3 {
    return this.crew.pos(out);
  }
  /** Walk toward p; returns true once within r. */
  goTo(p: THREE.Vector3, r = config.bots.arriveRadius, speed = this.speed): boolean {
    const me = this.pos(_v);
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d <= r) {
      this.crew.input.move.set(0, 0);
      return true;
    }
    this.pathAge += 1 / 60;
    if (this.pathGoal.distanceTo(p) > 0.4 || this.pathAge > 1.2 || !this.path.length) {
      this.path = this.grid.path(me, p);
      this.pathGoal.copy(p);
      this.pathAge = 0;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - me.x, this.path[0].z - me.z) < 0.35) this.path.shift();
    const wp = this.path[0] ?? p;
    let dx = wp.x - me.x,
      dz = wp.z - me.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const slow = clamp(d / 1.2, 0.35, 1);
    this.crew.input.move.set(dx * speed * slow, dz * speed * slow);
    return false;
  }
  face(p: THREE.Vector3): void {
    const me = this.pos(_v);
    this.crew.input.face = new THREE.Vector2(p.x - me.x, p.z - me.z);
  }
  /** Hold the use button on an interactable (press edge on the first frame). */
  holdUse(iaId: number | null): void {
    const inp = this.crew.input;
    inp.targetId = iaId;
    if (this.usingSince < 0) {
      inp.usePressed = 1;
      this.usingSince = this.ctx.time;
    }
    inp.use = true;
  }
  releaseUse(): void {
    this.usingSince = -1;
  }
  pressInteract(iaId: number | null): void {
    this.crew.input.targetId = iaId;
    this.crew.input.interactPressed = 1;
  }
  /** Aim & throw at a local point. Returns true once released. */
  throwAt(p: THREE.Vector3, error = 0): boolean {
    const inp = this.crew.input;
    if (this.throwT < 0) {
      this.throwT = 0;
      const e = error;
      this.throwAim = p.clone().add(new THREE.Vector3(this.rng.gauss() * e, 0, this.rng.gauss() * e));
    }
    this.throwT += 1 / 60;
    inp.aim = this.throwAim!.clone();
    inp.throwAim = true;
    this.face(p);
    if (this.throwT > 0.45) {
      inp.throwRelease = 1;
      inp.throwAim = false;
      this.throwT = -1;
      return true;
    }
    return false;
  }
  private throwAim: THREE.Vector3 | null = null;

  /** Nearest standing point on the rail facing a local point outside the hull. */
  railSpot(towards: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const side = towards.x >= 0 ? 1 : -1;
    let z = clamp(towards.z, -4.0, 2.8);
    // the starboard rail by the cradle is blocked; stand aft of it
    if (side < 0 && z > -0.2 && z < 2.3) z = -0.6;
    return out.set(side * (hullHalfWidth(z) - 0.75), 0, z);
  }

  // ------------------------------------------------------------------ main
  step(dt: number): void {
    const c = this.crew;
    const inp = c.input;
    // fresh intent every step
    inp.move.set(0, 0);
    inp.face = null;
    inp.aim = null;
    inp.lookDir = null;
    inp.use = false;
    inp.interact = false;
    inp.throwAim = false;
    inp.brace = false;
    inp.targetId = null;
    inp.steer.set(0, 0);
    if (!c.isUp || c.atHelm) {
      if (this.task && !c.isUp && !(this.task instanceof BraceTask)) this.endTask();
      if (c.inSea) this.seaBehaviour();
      return;
    }
    // late brace for a forgetful Ike (too late, comically)
    if (this.lateBrace > 0) {
      this.lateBrace -= dt;
      if (this.lateBrace <= 0) inp.brace = true;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = config.bots.thinkInterval;
      this.think();
    }
    if (this.task) {
      this.task.t += dt;
      const s = this.task.step(this, dt);
      if (s !== 'run') this.endTask();
      if (!inp.use) this.releaseUse();
    }
    // a carried thing with no task to use it: put it down
    if (!this.task && c.held && c.held.def.carry !== 'sticky') this.releaseUse();
  }

  private seaBehaviour(): void {
    // wave for attention, swim toward a floating ring
    const r = this.ctx.sys.rescue;
    if (r && r.ring.mode === 'sea' && !this.crew.onRing) {
      const dx = r.ring.wp.x - this.crew.wp.x,
        dz = r.ring.wp.z - this.crew.wp.z;
      const d = Math.hypot(dx, dz);
      if (d < 8 && d > 0.3) {
        // world dir → boat-local move
        const yaw = this.ctx.boat.yaw;
        const lx = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d;
        const lz = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
        this.crew.input.move.set(lx, lz);
      }
    }
  }

  endTask(): void {
    if (!this.task) return;
    this.task.onEnd?.(this);
    this.board.release(this.task.claimKey, this.crew.id);
    this.task = null;
    this.releaseUse();
    this.throwT = -1;
    this.status = '';
  }

  private setTask(t: Task): void {
    this.endTask();
    if (t.claimKey && !this.board.claim(t.claimKey, this.crew.id)) return;
    this.task = t;
    this.status = t.name;
  }

  private think(): void {
    const cand = this.candidates();
    if (!cand) return;
    if (!this.task || cand.pri > this.task.pri) this.setTask(cand);
  }

  /** Highest-priority available task right now (or null). */
  private candidates(): Task | null {
    const ctx = this.ctx;
    const c = this.crew;
    // 1. brace on a wave warning
    const rogue = ctx.sys.rogue;
    const st = rogue?.hudState?.();
    if (st && st.stage >= 1) {
      const wid = rogue.current ? rogue.current.tImpact : 0;
      if (wid !== this.lastWaveId) {
        this.lastWaveId = wid;
        this.forgetThisWave = c.id === 'ike' && (this.ctx.sys.tutorialGag ? true : this.rng.chance(config.bots.ikeForgetBraceRate));
        if (this.forgetThisWave) this.lateBrace = st.secs + 0.25;
      }
      if (!this.forgetThisWave && !c.insideHouse) return new BraceTask();
    }
    // 2. rescue
    const swimmers = this.crewMgr.overboard().filter((s) => s.state === 'sea' && s.seaTime > config.overboard.botThrowDelaySec);
    if (swimmers.length && !this.board.holder('rescue')) {
      // only the nearest free bot volunteers
      const me = this.pos();
      const others = this.crewMgr.list.filter((o) => o.bot && o.isUp && !o.atHelm && o !== c);
      const myD = me.distanceTo(L.ringHook);
      if (!others.some((o) => o.pos(_v2).distanceTo(L.ringHook) < myD - 0.5 && (ctx.sys.bots?.brainOf?.(o)?.task?.pri ?? 0) < 90)) return new RescueTask(swimmers[0]);
    }
    if (this.board.holder('rescue') === c.id && this.task) return null;
    // Mo goes back to the wheel when it's free
    if (c.id === 'mo' && !this.crewMgr.list.some((o) => o.atHelm)) return new HelmTask();
    // pings
    if (this.ping && ctx.time < this.ping.until) return new PingTask(this.ping);
    // 3. pot work
    const pj = this.potJob();
    if (pj) return pj;
    // 7. chip ice (urgent once it gets really slick)
    const ice = ctx.sys.ice;
    if (ice && ice.worstZone && ice.worstZone().level > 0.7 && !this.board.holder('chip')) {
      const t = new ChipTask();
      t.pri = 55;
      return t;
    }
    // 4. sort crab / specials
    const sort = this.sortJob();
    if (sort) return sort;
    // fetch your hat
    if (!c.hatOn && c.hatItem && c.hatItem.mode === 'deck') return new HatTask(c.hatItem);
    if (ice && ice.worstZone && ice.worstZone().level > 0.4 && !this.board.holder('chip')) return new ChipTask();
    // cat care
    const cat = ctx.sys.cat;
    if (cat && cat.wantsInside?.() && !this.board.holder('cat') && c.id === 'dot') return new CatTask();
    // 6/8. coil / idle
    if (this.task) return null;
    return this.rng.chance(0.35) && this.free('coil') ? new CoilTask() : new IdleTask();
  }

  // ------------------------------------------------------------------ planners
  private playerDoing(verbId: string): boolean {
    const p = this.player;
    return !!p.activeVerb && p.activeVerb.id === verbId;
  }

  private potJob(): Task | null {
    const pots = this.pots;
    const c = this.crew;
    const p = this.player;
    const trip = this.ctx.sys.trip;
    if (trip && trip.botsHold && trip.botsHold()) return null;
    // carrying a line: clip it
    if (c.held && c.held.kind === 'lineEnd') return new ClipTask();
    // somebody dropped the buoy line: pick it up
    const looseLine = this.ctx.items.items.find((it) => it.kind === 'lineEnd' && it.mode === 'deck' && !it.heldBy);
    if (looseLine && !pots.blockPot && this.free('line')) return claimed(new FetchTask(looseLine), 'line');
    const cp = pots.cradlePot;
    // tip a full pot
    if (cp && cp.state === 'cradle' && cp.catch && pots.cradleMode === 'idle' && !this.playerDoing('tip') && this.free('lever')) return claimed(new LeverTask('tip'), 'lever');
    // land a hanging pot
    const hang = pots.hangingPot;
    if (hang && hang.item && !hang.item.heldBy && this.free('land')) return claimed(new LandTask(hang), 'land');
    // haul
    const bp = pots.blockPot;
    if (bp && (bp.state === 'onBlock' || bp.state === 'rising') && !this.playerDoing('haul') && this.free('haul')) return claimed(new HaulTask(), 'haul');
    // rehook a loose pot near the cradle
    const loose = pots.pots.find((q) => q.state === 'deck' && q.item && !q.item.heldBy);
    if (loose && !pots.blockPot && this.free('rehook')) return claimed(new RehookTask(loose), 'rehook');
    // grapple a buoy that's alongside
    const nav = this.ctx.sys.nav;
    const target = trip?.haulTarget?.() as Pot | null;
    if (target && target.state === 'soaking' && target.buoy && nav?.arrived && !pots.blockPot && !this.anyoneHolds('grapple') && !this.anyoneHolds('lineEnd')) {
      const g = this.ctx.sys.grapple;
      if ((g.grapple.mode === 'fixed' || (g.grapple.mode === 'deck' && !g.grapple.heldBy)) && this.free('grapple')) return claimed(new GrappleTask(target), 'grapple');
    }
    if (c.held && c.held.kind === 'grapple' && target) return claimed(new GrappleTask(target), 'grapple');
    // setting: bait & launch
    if (cp && cp.state === 'cradle' && !cp.catch && pots.settingAllowed) {
      if (!cp.baited && !(p.held && p.held.kind === 'baitJar') && this.free('bait')) return claimed(new BaitTask(), 'bait');
      if (cp.baited && pots.launchWanted && !this.playerDoing('launch') && this.free('lever')) return claimed(new LeverTask('launch'), 'lever');
    }
    return null;
  }

  /** A claim nobody else holds (so a task we pick can actually be started). */
  private free(key: string): boolean {
    const h = this.board.holder(key);
    return !h || h === this.crew.id;
  }

  private anyoneHolds(kind: string): boolean {
    return this.crewMgr.list.some((o) => o.held && o.held.kind === kind);
  }

  private sortJob(): Task | null {
    const crabs = this.ctx.sys.crabs;
    const me = this.pos();
    const sp = this.ctx.sys.specials;
    for (const it of (sp?.active ?? []) as Item[]) {
      if (it.mode !== 'deck' || it.heldBy) continue;
      if (this.ctx.time - it.data.born < 6) continue; // let the player enjoy it first
      if (it.data.special === 'otter' && it.data.petted) continue; // it's leaving on its own
      const k = 'special:' + it.id;
      const h = this.board.holder(k);
      if (h && h !== this.crew.id) continue;
      return claimed(new SortTask(it), k);
    }
    let best: Item | null = null;
    let bd = Infinity;
    for (const it of crabs.crabs as Item[]) {
      if (it.mode !== 'deck' || it.heldBy) continue;
      const k = 'crab:' + it.id;
      const h = this.board.holder(k);
      if (h && h !== this.crew.id) continue;
      const d = it.localPos(_v2).distanceTo(me);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (best) return claimed(new SortTask(best), 'crab:' + best.id);
    return null;
  }
}

function claimed<T extends Task>(t: T, key: string): T {
  t.claimKey = key;
  return t;
}

// =============================================================================
// Tasks
class BraceTask extends Task {
  name = 'brace';
  pri = 100;
  private spot: THREE.Vector3 | null = null;
  step(b: BotBrain): Status {
    const st = b.ctx.sys.rogue?.hudState?.();
    if (!st) return b.crew.braced ? 'done' : 'done';
    if (!this.spot) this.spot = nearestBraceSpot(b);
    const me = b.pos();
    if (this.spot && !b.crew.braced && me.distanceTo(this.spot) > 0.5 && st.secs > 0.4) b.goTo(this.spot, 0.45, 1.0);
    // brace when close to something to hold, or when out of time
    if ((this.spot && me.distanceTo(this.spot) < 0.9) || st.secs < 1.0) b.crew.input.brace = true;
    return 'run';
  }
}

function nearestBraceSpot(b: BotBrain): THREE.Vector3 | null {
  const me = b.pos();
  let best: THREE.Vector3 | null = null;
  let bd = 6;
  const seg = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (const s of b.ctx.braceSegs) {
    seg.subVectors(s.b, s.a);
    const t = clamp(tmp.subVectors(me, s.a).dot(seg) / Math.max(1e-6, seg.lengthSq()), 0, 1);
    tmp.copy(s.a).addScaledVector(seg, t);
    const d = Math.hypot(tmp.x - me.x, tmp.z - me.z);
    if (d < bd) {
      bd = d;
      // stand a little inboard of the grab point
      const inward = new THREE.Vector3(-tmp.x, 0, 0).normalize().multiplyScalar(0.55);
      if (Math.abs(tmp.x) < 2.6) inward.set(0, 0, me.z < tmp.z ? -0.55 : 0.55);
      best = b.grid.nearestFree(tmp.clone().setY(0).add(inward), new THREE.Vector3());
    }
  }
  return best;
}

class RescueTask extends Task {
  name = 'rescue';
  pri = 90;
  claimKey = 'rescue';
  constructor(private swimmer: Crew) {
    super();
  }
  step(b: BotBrain): Status {
    const s = this.swimmer;
    const r = b.ctx.sys.rescue;
    const ring = r.ring as Item;
    const c = b.crew;
    if (!s.inSea || s.state === 'boarding') return 'done';
    const swimLocal = b.ctx.boat.worldToLocal(s.wp, new THREE.Vector3());
    // the ring is out on the rope: pull
    if (r.holder === c && ring.mode === 'sea') {
      b.holdUse(null);
      b.crew.input.targetId = (b.ctx.interact.list.find((x) => x.name === 'rope') ?? { id: null }).id;
      return 'run';
    }
    if (c.held === ring) {
      const spot = b.railSpot(swimLocal);
      if (!b.goTo(spot, 0.5)) return 'run';
      b.throwAt(swimLocal, config.bots.throwAimError * (c.id === 'ike' ? 1.6 : 1));
      return 'run';
    }
    if (ring.heldBy && ring.heldBy !== (c as unknown)) return 'fail';
    if (r.holder === c && ring.mode === 'deck' && !ring.heldBy && b.ctx.time - (ring.data.thrownAt ?? -10) < 2.5) return 'run'; // in flight
    if (ring.mode === 'fixed' || (ring.mode === 'deck' && !ring.heldBy)) {
      const at = ring.mode === 'fixed' ? ring.fixedPos : ring.localPos(new THREE.Vector3());
      if (!b.goTo(at, 1.0)) return 'run';
      b.holdUse(ring.data.iaId);
      return 'run';
    }
    return 'run';
  }
}

class HelmTask extends Task {
  name = 'helm';
  pri = 85;
  claimKey = 'helm';
  step(b: BotBrain): Status {
    if (b.crewMgr.list.some((o) => o.atHelm)) return 'done';
    if (!b.goTo(L.helmSpot, 0.45)) return 'run';
    b.ctx.sys.helm?.take(b.crew);
    return 'done';
  }
}

class PingTask extends Task {
  name = 'ping';
  pri = 80;
  constructor(private ping: { point: THREE.Vector3; iaId: number | null; until: number }) {
    super();
  }
  step(b: BotBrain): Status {
    if (b.ctx.time > this.ping.until) {
      b.ping = null;
      return 'done';
    }
    const arrived = b.goTo(this.ping.point, this.ping.iaId ? 1.0 : 0.45);
    if (arrived && this.ping.iaId) {
      const ia = b.ctx.interact.byId(this.ping.iaId);
      const verbs = ia?.verbs(b.crew.id, b.crew.held ? b.crew.held.kind : null);
      const v = verbs?.[0];
      if (v) {
        if (v.button === 'interact') b.pressInteract(this.ping.iaId);
        else b.holdUse(this.ping.iaId);
      }
      if (this.t > 1.5) {
        b.ping = null;
        return 'done';
      }
    }
    return 'run';
  }
}

class ClipTask extends Task {
  name = 'clip line';
  pri = 70;
  step(b: BotBrain): Status {
    const c = b.crew;
    if (!c.held || c.held.kind !== 'lineEnd') return 'done';
    if (!b.goTo(L.haulerSpot, 0.6)) return 'run';
    const ia = b.ctx.interact.list.find((x) => x.name === 'block');
    b.pressInteract(ia ? ia.id : null);
    return this.t > 6 ? 'fail' : 'run';
  }
}

class LeverTask extends Task {
  name: string;
  pri = 62;
  constructor(private mode: 'tip' | 'launch') {
    super();
    this.name = mode;
  }
  step(b: BotBrain): Status {
    const pots = b.pots;
    const cp = pots.cradlePot;
    if (!cp || cp.state !== 'cradle' || pots.cradleMode !== 'idle') return 'done';
    if (this.mode === 'launch' && (!cp.baited || !pots.launchWanted)) return 'done';
    if (this.mode === 'tip' && !cp.catch) return 'done';
    if (!b.goTo(L.launcherSpot, 0.5)) return 'run';
    const ia = b.ctx.interact.list.find((x) => x.name === 'launcher lever');
    b.holdUse(ia ? ia.id : null);
    return this.t > 8 ? 'fail' : 'run';
  }
}

class HaulTask extends Task {
  name = 'haul';
  pri = 64;
  step(b: BotBrain): Status {
    const bp = b.pots.blockPot;
    if (!bp || (bp.state !== 'onBlock' && bp.state !== 'rising')) return 'done';
    if (!b.goTo(L.haulerSpot, 0.5)) return 'run';
    const ia = b.ctx.interact.list.find((x) => x.name === 'hauler');
    b.holdUse(ia ? ia.id : null);
    return 'run';
  }
}

class LandTask extends Task {
  name = 'land pot';
  pri = 66;
  private releaseAt = -1;
  constructor(private pot: Pot) {
    super();
  }
  step(b: BotBrain): Status {
    const pot = this.pot;
    const it = pot.item;
    if (pot.state !== 'hanging' || !it) return 'done';
    if (it.heldBy && it.heldBy !== (b.crew as unknown)) return 'fail';
    if (!b.goTo(L.launcherSpot, 0.5)) return 'run';
    b.holdUse(it.data.iaId);
    // wait until it swings over the cradle while the deck is level, then let go
    const p = it.localPos(new THREE.Vector3());
    const over = Math.hypot(p.x - L.potOnCradle.x, p.z - L.potOnCradle.z) < 0.6;
    const level = Math.abs(b.pots.deckLevelDeg()) < config.fishing.levelWindowDeg * 0.6;
    const ike = b.crew.id === 'ike';
    if (this.releaseAt < 0 && it.heldBy === (b.crew as unknown) && over && (level || (ike && b.rng.chance(0.02)))) this.releaseAt = b.ctx.time + 0.05;
    if (this.releaseAt > 0 && b.ctx.time >= this.releaseAt) {
      b.crew.input.use = false;
      b.releaseUse();
      return 'done';
    }
    return this.t > 25 ? 'fail' : 'run';
  }
}

/** Where a stray pot gets dragged to so it can be re-hooked (just aft of the cradle). */
const REHOOK_SPOT = new THREE.Vector3(-1.4, 0, -0.9);

class RehookTask extends Task {
  name = 'rehook';
  pri = 63;
  /** +1: pull it from the cradle side · −1: push it from behind · 0: can't get at it (yet) */
  private side = 0;
  private sideT = 0;
  private stuckT = 0;
  constructor(private pot: Pot) {
    super();
  }
  step(b: BotBrain, dt: number): Status {
    const it = this.pot.item;
    const c = b.crew;
    if (this.pot.state !== 'deck' || !it) return 'done';
    const pots = b.pots;
    const p = it.localPos(new THREE.Vector3()).setY(0);
    if (!c.held) this.stuckT = this.side ? 0 : this.stuckT + dt;
    if ((this.t > 30 || this.stuckT > 5) && !pots.blockPot && !pots.cradlePot) {
      // still stuck: Mo swings the block over and hooks it where it lies
      pots.rehook(this.pot);
      return 'done';
    }
    if (pots.nearCradle(p)) {
      // close enough: let go and hook it on
      if (c.held === it) return 'run'; // use is released this step
      if (!b.goTo(p, 2.0)) return 'run';
      b.pressInteract(it.data.iaId);
      return 'run';
    }
    const dir = REHOOK_SPOT.clone().sub(p).setY(0).normalize();
    // stand just clear of the pot's square footprint on the nav grid, whatever the direction
    const off = 1.5 / Math.max(Math.abs(dir.x), Math.abs(dir.z));
    if (c.held !== it) {
      if (it.heldBy) return 'fail';
      // a pot lying across the deck can cut it in two: pick a side we can actually reach
      this.sideT -= dt;
      if (this.sideT <= 0) {
        this.sideT = 1.5;
        const me = c.pos(new THREE.Vector3());
        const reach = (s: number) => {
          const at = p.clone().addScaledVector(dir, off * s);
          if (!b.grid.isFree(at.x, at.z)) return false;
          b.grid.path(me, at);
          return b.grid.lastPathOk;
        };
        this.side = reach(1) ? 1 : reach(-1) ? -1 : 0;
      }
      if (!this.side) return 'run';
      if (!b.goTo(p.clone().addScaledVector(dir, off * this.side), 0.45)) return 'run';
      b.holdUse(it.data.iaId);
      return 'run';
    }
    // holding it (we face it): pull = back away past the spot · push = walk it onto the spot.
    // Steer straight — the pot itself is marked as an obstacle on the grid.
    b.holdUse(it.data.iaId);
    const goal = REHOOK_SPOT.clone().addScaledVector(dir, 1.45 * (this.side || 1));
    const me = c.pos(new THREE.Vector3());
    const dx = goal.x - me.x,
      dz = goal.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.3) c.input.move.set((dx / d) * b.speed * 0.8, (dz / d) * b.speed * 0.8);
    return 'run';
  }
  onEnd(b: BotBrain): void {
    if (this.pot.item && b.crew.held === this.pot.item) b.releaseUse();
  }
}

class GrappleTask extends Task {
  name = 'grapple';
  pri = 61;
  constructor(private pot: Pot) {
    super();
  }
  step(b: BotBrain): Status {
    const g = b.ctx.sys.grapple;
    const c = b.crew;
    if (c.held && c.held.kind === 'lineEnd') return 'done';
    if (this.pot.state !== 'soaking' && this.pot.state !== 'onLine') return 'done';
    if (g.thrower === c && (g.grapple.mode === 'sea' || b.ctx.time - g.lastThrowAt < 2.5)) return 'run'; // in flight / reeling
    if (c.held === g.grapple) {
      const buoy = this.pot.buoy;
      if (!buoy) return 'fail';
      if (!b.goTo(new THREE.Vector3(-2.35, 0, -0.7), 0.5)) return 'run';
      const target = b.ctx.boat.worldToLocal(buoy.wp, new THREE.Vector3());
      b.throwAt(target, config.bots.throwAimError * 0.5);
      return 'run';
    }
    if (g.grapple.heldBy) return 'fail';
    const at = g.grapple.mode === 'fixed' ? g.grapple.fixedPos : g.grapple.localPos(new THREE.Vector3());
    if (!b.goTo(at, 1.0)) return 'run';
    b.holdUse(g.grapple.data.iaId);
    return this.t > 30 ? 'fail' : 'run';
  }
}

class BaitTask extends Task {
  name = 'bait';
  pri = 58;
  step(b: BotBrain): Status {
    const pots = b.pots;
    const cp = pots.cradlePot;
    const c = b.crew;
    if (!cp || cp.state !== 'cradle' || cp.baited) {
      if (c.held && c.held.kind === 'baitJar') b.releaseUse();
      return 'done';
    }
    if (!c.held) {
      if (!b.goTo(new THREE.Vector3(L.baitBox.center.x + 0.15, 0, L.baitBox.center.z + 0.75), 0.5)) return 'run';
      const ia = b.ctx.interact.list.find((x) => x.name === 'bait box');
      b.holdUse(ia ? ia.id : null);
      return 'run';
    }
    if (c.held.kind !== 'baitJar') return 'fail';
    b.crew.input.use = true;
    if (!b.goTo(L.launcherSpot, 0.5)) {
      b.crew.input.use = true;
      return 'run';
    }
    // release over the pot → the "place" verb drops it in
    const ia = b.ctx.interact.list.find((x) => x.name === 'pot on cradle');
    b.crew.input.targetId = ia ? ia.id : null;
    if (this.stage === 0) {
      this.stage = 1;
      b.crew.input.use = true;
      return 'run';
    }
    b.crew.input.use = false;
    b.releaseUse();
    return 'done';
  }
}

class SortTask extends Task {
  name = 'sort';
  pri = 50;
  constructor(private it: Item) {
    super();
  }
  step(b: BotBrain): Status {
    const it = this.it;
    const c = b.crew;
    if (it.mode !== 'deck') return 'done';
    if (it.heldBy && it.heldBy !== (c as unknown)) return 'fail';
    const crab = it.data.crab as CrabData | undefined;
    const special = it.data.special as string | undefined;
    if (it.heldBy !== (c as unknown)) {
      // otters get a pat first
      if (special === 'otter' && !it.data.petted) {
        if (!b.goTo(it.localPos(new THREE.Vector3()), 1.1)) return 'run';
        b.pressInteract(it.data.iaId);
        return 'run';
      }
      if (special === 'otter') return 'done'; // it hops home on its own
      if (!b.goTo(it.localPos(new THREE.Vector3()), 0.9)) return 'run';
      b.holdUse(it.data.iaId);
      return this.t > 12 ? 'fail' : 'run';
    }
    // carrying it
    c.input.use = true;
    const keep = crab ? crab.keep : special === 'bottle' || special === 'boot' || special === 'bell';
    const me = b.pos();
    if (keep) {
      const isCrab = !!crab;
      const tank = b.ctx.sys.crabs;
      const full = isCrab && tank.tank.length >= tank.capacity;
      if (!full) {
        // lob it into the hatch / curio crate from a few steps away
        const goal = isCrab ? L.hatch.center.clone().setY(0.15) : L.crate.center.clone().setY(0.35);
        const d = Math.hypot(goal.x - me.x, goal.z - me.z);
        if (d > 3.2 || d < 0.9) {
          const stand = goal.clone().add(new THREE.Vector3(me.x - goal.x, 0, me.z - goal.z).normalize().multiplyScalar(1.8)).setY(0);
          if (!b.goTo(b.grid.nearestFree(stand, new THREE.Vector3()), 0.5)) return 'run';
        }
        b.throwAt(goal, 0.08);
        return this.t > 20 ? 'fail' : 'run';
      }
    }
    // toss it back over the nearest rail
    const out = me.x >= 0 ? 1 : -1;
    const railX = out * (hullHalfWidth(clamp(me.z, -4, 2.8)) - 0.2);
    if (Math.abs(railX - me.x) > 2.4 || (out < 0 && me.z > -0.3 && me.z < 2.3)) {
      const spot = b.railSpot(new THREE.Vector3(out * 5, 0, me.z));
      if (!b.goTo(spot, 0.7)) return 'run';
    }
    b.throwAt(new THREE.Vector3(out * (hullHalfWidth(clamp(me.z, -4, 2.8)) + 2.0), -1.0, clamp(me.z, -4, 2.8)), 0.3);
    return this.t > 20 ? 'fail' : 'run';
  }
}

class FetchTask extends Task {
  name = 'fetch line';
  pri = 69;
  constructor(private it: Item) {
    super();
  }
  step(b: BotBrain): Status {
    const it = this.it;
    if (it.mode !== 'deck') return 'done';
    if (it.heldBy) return it.heldBy === (b.crew as unknown) ? 'done' : 'fail';
    if (!b.goTo(it.localPos(new THREE.Vector3()), 0.9)) return 'run';
    b.holdUse(it.data.iaId);
    return this.t > 15 ? 'fail' : 'run';
  }
}

class HatTask extends Task {
  name = 'get hat';
  pri = 40;
  constructor(private hat: Item) {
    super();
  }
  step(b: BotBrain): Status {
    if (b.crew.hatOn || this.hat.mode !== 'deck') return 'done';
    b.goTo(this.hat.localPos(new THREE.Vector3()), 0.3);
    if (this.t > 15) {
      b.crew.abandonHat(); // can't reach it; the spare on the galley hook will do
      return 'fail';
    }
    return 'run';
  }
}

class ChipTask extends Task {
  name = 'chip ice';
  pri = 25;
  claimKey = 'chip';
  private zone = -1;
  step(b: BotBrain): Status {
    const ice = b.ctx.sys.ice;
    const m = ice.mallet as Item;
    const c = b.crew;
    if (this.zone < 0) this.zone = ice.worstZone().zone;
    const level = ice.level(this.zone);
    if (level < 0.08) {
      // this patch is clear: next worst, or hang the mallet back up
      const w = ice.worstZone();
      if (w.level > 0.3 && this.t < 40) {
        this.zone = w.zone;
        return 'run';
      }
      if (c.held === m) b.pressInteract(null); // put it down
      return 'done';
    }
    if (c.held !== m) {
      if (m.heldBy) return 'fail';
      const at = m.mode === 'fixed' ? m.fixedPos : m.localPos(new THREE.Vector3());
      if (!b.goTo(at, 1.0)) return 'run';
      b.holdUse(m.data.iaId);
      return 'run';
    }
    const spot = ice.spots[this.zone] as THREE.Vector3;
    const me = b.pos();
    if (Math.hypot(spot.x - me.x, spot.z - me.z) > 1.4) {
      b.goTo(spot, 0.6);
      return 'run';
    }
    b.face(spot.clone().setX(spot.x + Math.sign(spot.x) * 0.6));
    // rhythmic taps
    if (Math.floor(this.t * 4) !== Math.floor((this.t - 1 / 60) * 4)) {
      const ia = b.ctx.interact.list.find((x) => x.name === 'ice:' + this.zone);
      if (ia) {
        c.input.targetId = ia.id;
        c.input.usePressed = 1;
      }
    }
    return this.t > 60 ? 'done' : 'run';
  }
}

class CatTask extends Task {
  name = 'cat inside';
  pri = 35;
  claimKey = 'cat';
  step(b: BotBrain): Status {
    const cat = b.ctx.sys.cat;
    const it = cat.item as Item;
    const c = b.crew;
    if (!cat.wantsInside()) {
      if (c.held === it) c.input.use = false;
      return 'done';
    }
    if (c.held !== it) {
      if (it.heldBy) return 'fail';
      if (!b.goTo(it.localPos(new THREE.Vector3()), 0.9)) return 'run';
      b.holdUse(it.data.iaId);
      return this.t > 20 ? 'fail' : 'run';
    }
    c.input.use = true;
    if (!b.goTo(new THREE.Vector3(0.6, 0, 4.4), 0.5)) return 'run';
    c.input.use = false;
    b.releaseUse();
    return 'done';
  }
}

class CoilTask extends Task {
  name = 'coil line';
  pri = 20;
  claimKey = 'coil';
  step(b: BotBrain): Status {
    const spot = new THREE.Vector3(L.coilSpot.x - 0.7, 0, L.coilSpot.z + 0.4);
    if (!b.goTo(spot, 0.4)) return this.t > 12 ? 'done' : 'run';
    b.face(L.coilSpot);
    b.crew.walkPhase += 0.08; // busy hands
    if (Math.random() < 0.01) sfx.play('ropeCreak', { volume: 0.25 });
    return this.t > 9 ? 'done' : 'run';
  }
}

const IDLE_SPOTS = [new THREE.Vector3(-1.0, 0, 2.6), new THREE.Vector3(1.2, 0, 2.2), new THREE.Vector3(0.0, 0, 2.7), new THREE.Vector3(-1.6, 0, -2.6), new THREE.Vector3(1.5, 0, -1.2)];

class IdleTask extends Task {
  name = 'idle';
  pri = 10;
  private spot: THREE.Vector3 | null = null;
  step(b: BotBrain): Status {
    if (!this.spot) this.spot = b.grid.nearestFree(IDLE_SPOTS[Math.floor(b.rng.next() * IDLE_SPOTS.length)], new THREE.Vector3());
    if (!b.goTo(this.spot, 0.5)) return this.t > 10 ? 'done' : 'run';
    // Dot hums while she waits
    if (b.crew.id === 'dot' && b.rng.chance(0.003)) sfx.babble('mm-hmm-hm-hmmm', { pitch: 1.2, volume: 0.35 });
    return this.t > 6 ? 'done' : 'run';
  }
}

// =============================================================================
export class BotSystem {
  readonly board = new TaskBoard();
  readonly grid = new NavGrid();
  readonly brains: BotBrain[] = [];
  private dynT = 0;

  constructor(private ctx: Ctx) {
    ctx.sys.bots = this;
    const crew = ctx.sys.crew as CrewManager;
    for (const c of crew.list) if (c.bot) this.brains.push(new BotBrain(c, ctx, this.board, this.grid));
  }

  brainOf(c: Crew): BotBrain | undefined {
    return this.brains.find((b) => b.crew === c);
  }

  /** Player ping: nearest available bot (or a chosen one) heads to the spot / does the thing there. */
  ping(local: THREE.Vector3, who?: CrewId): BotBrain | null {
    const crew = this.ctx.sys.crew as CrewManager;
    let ia: number | null = null;
    let bd = 1.2;
    for (const i of this.ctx.interact.list) {
      if (i.name === 'rope') continue;
      const d = i.pos(_v).distanceTo(local);
      if (d < bd) {
        bd = d;
        ia = i.id;
      }
    }
    let brain: BotBrain | null = null;
    if (who) brain = this.brains.find((b) => b.crew.id === who) ?? null;
    else {
      let best = Infinity;
      for (const b of this.brains) {
        if (!b.crew.isUp || b.crew.atHelm) continue;
        const d = b.pos().distanceTo(local);
        if (d < best) {
          best = d;
          brain = b;
        }
      }
    }
    if (!brain) return null;
    const target = insideHouse(local) ? local.clone() : this.grid.nearestFree(local.clone().setY(0), new THREE.Vector3());
    brain.ping = { point: target, iaId: ia, until: this.ctx.time + config.bots.pingHoldSec + (ia ? 4 : 0) };
    brain.endTask();
    sfx.babble(brain.crew.id === 'ike' ? 'on it!' : brain.crew.id === 'mo' ? 'aye' : 'gotcha', { pitch: brain.crew.voicePitch, volume: 0.6 });
    events.emit('toast', { text: `${brain.crew.name}: on it!`, color: '#eaf2f0' });
    void crew;
    return brain;
  }

  step(dt: number): void {
    // mark loose pots as obstacles every so often
    this.dynT -= dt;
    if (this.dynT <= 0) {
      this.dynT = 0.5;
      const rects: [number, number, number, number][] = [];
      const pots = this.ctx.sys.pots as PotSystem | undefined;
      for (const p of pots?.pots ?? []) {
        if (p.state === 'deck' && p.item) {
          const lp = p.item.localPos(_v);
          rects.push([lp.x - 1, lp.z - 1, lp.x + 1, lp.z + 1]);
        }
      }
      this.grid.setDynamic(rects);
    }
    for (const b of this.brains) b.step(dt);
  }
}
