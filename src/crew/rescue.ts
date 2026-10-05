/**
 * Overboard rescue. Grab the life ring from its hook, throw it in an arc (rope trailing);
 * if it lands within 1.5 m the swimmer grabs it ("gotcha!"), then hold to winch them to the rail
 * where they flop back aboard. Nobody waits long: after 25 s the crane hook fishes them out.
 */
import * as THREE from 'three';
import { later } from '../core/schedule';
import { config } from '../config';
import { clamp, easeInOut, lerp } from '../core/math';
import { ITEM_DEFS, type Item } from '../deck/items';
import { interactableId, type Interactable, type Verb } from '../deck/interact';
import { hullHalfWidth, L } from '../boat/layout';
import { makeLifeRing } from '../art/items';
import type { Ctx } from '../game/ctx';
import type { Crew } from './crew';
import type { CrewManager } from './crewManager';
import { events } from '../core/events';
import { sfx } from '../audio';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _w = new THREE.Vector3();
const ROPE_N = 20;

interface CraneJob {
  crew: Crew;
  phase: 'swing' | 'lower' | 'lift' | 'drop';
  t: number;
  boomYaw0: number;
  boomYaw: number;
  hookLocal: THREE.Vector3;
}

export class RescueSystem {
  readonly ring: Item;
  holder: Crew | null = null;
  pulling = false;
  swimmer: Crew | null = null;
  private ropeLine: THREE.Line;
  private ropePos: Float32Array;
  private ropeIa: Interactable;
  crane: CraneJob | null = null;
  private loseRopeAt = -1;
  readonly ringHome = L.ringHook.clone();
  lastThrowHit = false;

  constructor(private ctx: Ctx) {
    ctx.sys.rescue = this;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.ring = ctx.items.add(ITEM_DEFS.ring, makeLifeRing(), this.ringHome.clone(), { fixed: true, quat: q });
    this.ring.data.label = 'life ring';
    this.ring.onSeaLand = () => this.onRingLanded();
    // rope
    const g = new THREE.BufferGeometry();
    this.ropePos = new Float32Array(ROPE_N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.ropePos, 3));
    this.ropeLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf3e3b0 }));
    this.ropeLine.frustumCulled = false;
    this.ropeLine.visible = false;
    ctx.boatGroup.add(this.ropeLine);
    // the "pull the rope" verb for whoever holds it
    const pull: Verb = {
      id: 'pull',
      icon: '🪢',
      label: 'Hold to pull the rope',
      button: 'use',
      hold: true,
      start: () => {
        this.pulling = true;
        sfx.play('ropeCreak', { volume: 0.6 });
      },
      tick: () => {
        this.pulling = true;
      },
      end: () => {
        this.pulling = false;
      },
    };
    this.ropeIa = {
      id: interactableId(),
      name: 'rope',
      radius: 5,
      priority: 5,
      pos: (out) => (this.holder ? this.holder.pos(out) : out.set(0, -50, 0)),
      verbs: (crewId) => {
        if (!this.holder || this.holder.id !== crewId) return null;
        if (this.ring.mode !== 'sea' && !(this.ring.mode === 'deck' && !this.ring.heldBy)) return null;
        pull.label = this.swimmer ? `Pull ${this.crewName(this.swimmer)} in!` : 'Hold to reel the ring in';
        return [pull];
      },
    };
    ctx.interact.add(this.ropeIa);
  }

  private crewName(c: Crew): string {
    return c.id === 'player' ? 'yourself' : c.name;
  }
  private get crewMgr(): CrewManager {
    return this.ctx.sys.crew as CrewManager;
  }

  /** Called by Crew.throwTo via ctx.sys.onThrow */
  onThrow(crew: Crew, it: Item): void {
    if (it !== this.ring) return;
    this.holder = crew;
    this.swimmer = null;
    this.loseRopeAt = -1;
    it.data.thrownAt = this.ctx.time;
  }

  private onRingLanded(): void {
    const swimmers = this.crewMgr.overboard();
    let hit = false;
    for (const s of swimmers) {
      if (s.state !== 'sea') continue;
      const d = Math.hypot(s.wp.x - this.ring.wp.x, s.wp.z - this.ring.wp.z);
      if (d < config.overboard.ringGrabRadius) {
        this.swimmer = s;
        s.onRing = true;
        hit = true;
        sfx.play('gotcha', { pitch: s.voicePitch, delay: 0.25 });
        events.emit('toast', { text: `${s.id === 'player' ? 'You grab' : s.name + ' grabs'} the ring — gotcha!`, color: '#58c46a' });
        break;
      }
    }
    this.lastThrowHit = hit;
    events.emit('ringLanded', { worldPos: this.ring.wp.clone(), hit });
  }

  /** World-space point on the rail nearest the holder, on the side facing the ring. */
  private railPointWorld(out: THREE.Vector3): THREE.Vector3 {
    const h = this.holder!;
    const hp = h.pos(_v2);
    const ringLocal = this.ctx.boat.worldToLocal(this.ring.wp, _v);
    const side = ringLocal.x >= 0 ? 1 : -1;
    const z = clamp(hp.z, -4.2, 2.8);
    _v.set(side * (hullHalfWidth(z) - 0.05), 1.0, z);
    return this.ctx.boat.localToWorld(_v, out);
  }

  step(dt: number): void {
    const crewMgr = this.crewMgr;
    const ring = this.ring;
    // a swimmer can also catch a floating ring by swimming to it
    if (ring.mode === 'sea' && ring.seaPhase === 'float' && !this.swimmer) {
      for (const s of crewMgr.overboard()) {
        if (s.state === 'sea' && Math.hypot(s.wp.x - ring.wp.x, s.wp.z - ring.wp.z) < 0.9) {
          this.swimmer = s;
          s.onRing = true;
          sfx.play('gotcha', { pitch: s.voicePitch });
        }
      }
    }
    if (this.swimmer && (this.swimmer.state !== 'sea' || !this.swimmer.onRing)) this.swimmer = null;

    // holder lost the rope (knocked down / overboard)
    if (this.holder && !this.holder.isUp && ring.mode !== 'fixed') {
      this.holder = null;
      this.loseRopeAt = this.ctx.time;
    }
    if (!this.holder && ring.mode === 'sea' && this.loseRopeAt < 0) this.loseRopeAt = this.ctx.time;

    if (this.holder && ring.mode === 'sea') {
      const rail = this.railPointWorld(_w);
      const toRail = _v.subVectors(rail, ring.wp).setY(0);
      const dist = toRail.length();
      toRail.normalize();
      const pullSpeed = config.overboard.pullSpeed;
      const tooFar = dist > config.overboard.ringMaxRope;
      if (this.pulling || tooFar) {
        // winch: drive the ring (and the swimmer on it) toward the rail
        const want = toRail.clone().multiplyScalar(pullSpeed);
        ring.seaPull.set((want.x - ring.wv.x) * 6, 0, (want.z - ring.wv.z) * 6);
        if (this.swimmer) {
          const s = this.swimmer;
          s.seaPull.set((want.x - s.wv.x) * 6, 0, (want.z - s.wv.z) * 6);
          if (Math.random() < dt * 1.5) sfx.play('ropeCreak', { volume: 0.4, pitch: 0.9 + Math.random() * 0.3 });
        }
      }
      if (this.swimmer) {
        // swimmer clings to the ring
        const s = this.swimmer;
        s.wp.x = lerp(s.wp.x, ring.wp.x, Math.min(1, dt * 6));
        s.wp.z = lerp(s.wp.z, ring.wp.z, Math.min(1, dt * 6));
        if (dist < 1.4) this.boardFromRing(s);
      } else if (dist < 1.3 && this.pulling) {
        // ring back aboard into the holder's hands
        const hp = this.holder.holdPoint(_v2);
        this.ctx.items.toDeck(ring, hp, new THREE.Vector3());
        this.holder.grab(ring);
        this.holder = null;
      }
    }
    // the ring is never lost: if nobody holds the rope, it drifts back to its hook after a while
    if (!this.holder && ring.mode === 'sea' && this.loseRopeAt >= 0 && this.ctx.time - this.loseRopeAt > 8 && !this.swimmer) {
      this.ctx.items.fix(ring, this.ringHome, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      this.loseRopeAt = -1;
    }
    if (ring.mode === 'deck' && !ring.heldBy && this.holder && this.ctx.time - (ring.data.grabbedAt ?? 0) > 6) {
      // landed on deck: holder can reel it back
      if (this.pulling) {
        this.holder.grab(ring);
        this.holder = null;
      }
    }
    if (ring.mode === 'fixed') this.holder = null;

    // auto-rescue by crane
    for (const s of crewMgr.overboard()) {
      if (s.state === 'sea' && s.seaTime > config.overboard.autoRescueSec && !this.crane && !(this.swimmer === s && this.pulling)) {
        this.startCrane(s);
      }
    }
    if (this.crane) this.stepCrane(dt);
    this.pulling = false;
  }

  private boardFromRing(s: Crew): void {
    const ringLocal = this.ctx.boat.worldToLocal(this.ring.wp, _v);
    const side = ringLocal.x >= 0 ? 1 : -1;
    const z = clamp(ringLocal.z, -4.2, 2.6);
    const hw = hullHalfWidth(z);
    s.onRing = false;
    this.swimmer = null;
    s.board(new THREE.Vector3(side * (hw - 0.9), 0.35, z), new THREE.Vector3(-side * 2.2, 1.5, 0));
    events.emit('rescued', { crew: s.id, how: 'ring' });
    // ring comes back aboard with them
    const holder = this.holder;
    this.ctx.items.toDeck(this.ring, new THREE.Vector3(side * (hw - 0.7), 1.2, z), new THREE.Vector3(-side, 1, 0));
    this.holder = null;
    if (holder && holder.isUp) later((400) / 1000, () => holder.isUp && !holder.held && this.ring.mode === 'deck' && holder.grab(this.ring));
  }

  // ---------------------------------------------------------------- crane
  private startCrane(s: Crew): void {
    const art = this.ctx.boatArt;
    this.crane = { crew: s, phase: 'swing', t: 0, boomYaw0: art.craneBoom.rotation.y, boomYaw: 0, hookLocal: new THREE.Vector3() };
    s.state = 'boarding';
    s.onRing = false;
    if (this.swimmer === s) this.swimmer = null;
    sfx.play('lever', { volume: 0.7 });
    sfx.play('foghorn', { volume: 0.4, pitch: 1.3 });
    events.emit('radio', { who: 'Mo', text: `Hang on, ${s.id === 'player' ? 'kid' : s.name}! Crane's coming!` });
  }

  private stepCrane(dt: number): void {
    const job = this.crane!;
    const art = this.ctx.boatArt;
    const s = job.crew;
    job.t += dt;
    const boom = art.craneBoom;
    const mast = L.mast;
    const swimmerLocal = this.ctx.boat.worldToLocal(s.wp, _v);
    // boom points along its local −Z; yaw so it faces the swimmer
    const want = Math.atan2(-(swimmerLocal.x - mast.x), -(swimmerLocal.z - mast.z));
    if (job.phase === 'swing') {
      const k = easeInOut(clamp(job.t / 1.2, 0, 1));
      boom.rotation.y = lerp(job.boomYaw0, want, k);
      boom.rotation.x = lerp(-0.35, -0.05, k);
      art.craneHook.position.y = -0.8;
      this.reelTowardHook(s, dt, 1.4);
      if (job.t > 1.2) {
        job.phase = 'lower';
        job.t = 0;
        sfx.play('winchStart');
      }
    } else if (job.phase === 'lower') {
      boom.rotation.y = want;
      const hookTip = this.hookTipLocal(_v2);
      const drop = hookTip.y - (swimmerLocal.y + 1.6);
      art.craneHook.position.y = -0.8 - Math.max(0, drop) * easeInOut(clamp(job.t / 1.0, 0, 1));
      this.reelTowardHook(s, dt, 3);
      if (job.t > 1.0) {
        job.phase = 'lift';
        job.t = 0;
        sfx.play('gotcha', { pitch: s.voicePitch });
      }
    } else if (job.phase === 'lift') {
      // swing the boom inboard, hauling the swimmer up and over the rail
      const k = easeInOut(clamp(job.t / 1.8, 0, 1));
      const inboard = Math.atan2(-(1.2 - mast.x), -(0.6 - mast.z));
      boom.rotation.y = lerp(want, inboard, k);
      art.craneHook.position.y = lerp(art.craneHook.position.y, -1.2, Math.min(1, dt * 4));
      const tip = this.hookTipLocal(_v2);
      tip.y -= 1.3;
      this.ctx.boat.localToWorld(tip, s.wp);
      s.prevWp.lerp(s.wp, 0.5);
      s.wv.set(0, 0, 0);
      if (job.t > 1.8) {
        job.phase = 'drop';
        job.t = 0;
      }
    } else {
      const tip = this.hookTipLocal(_v2);
      s.board(new THREE.Vector3(tip.x, Math.max(0.2, tip.y - 2.0), tip.z), new THREE.Vector3(0, -0.5, 0));
      events.emit('rescued', { crew: s.id, how: 'crane' });
      this.crane = null;
      boom.rotation.set(-0.35, 0, 0);
      art.craneHook.position.y = -0.8;
    }
  }

  /** The crane "fishes": the swimmer drifts under the hook so it always reaches them. */
  private reelTowardHook(s: Crew, dt: number, rate: number): void {
    const tip = this.hookTipLocal(_v2);
    this.ctx.boat.localToWorld(tip, _w);
    const k = Math.min(1, dt * rate);
    s.wp.x = lerp(s.wp.x, _w.x, k);
    s.wp.z = lerp(s.wp.z, _w.z, k);
  }

  private hookTipLocal(out: THREE.Vector3): THREE.Vector3 {
    const art = this.ctx.boatArt;
    art.craneBoom.updateMatrix();
    art.craneHook.updateMatrix();
    out.copy(art.craneHook.position).applyMatrix4(art.craneBoom.matrix);
    return out;
  }

  render(boatP: THREE.Vector3, boatQ: THREE.Quaternion): void {
    const h = this.holder;
    const ring = this.ring;
    const show = !!h && (ring.mode === 'sea' || (ring.mode === 'deck' && !ring.heldBy));
    this.ropeLine.visible = show;
    if (!show || !h) return;
    const a = h.holdPoint(_v);
    const b = ring.renderP;
    const len = a.distanceTo(b);
    const sag = this.pulling ? 0.1 : clamp(len * 0.12, 0.2, 1.6);
    for (let i = 0; i < ROPE_N; i++) {
      const t = i / (ROPE_N - 1);
      _v2.lerpVectors(a, b, t);
      _v2.y -= Math.sin(t * Math.PI) * sag;
      this.ropePos[i * 3] = _v2.x;
      this.ropePos[i * 3 + 1] = _v2.y;
      this.ropePos[i * 3 + 2] = _v2.z;
    }
    (this.ropeLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    void boatP;
    void boatQ;
  }
}
