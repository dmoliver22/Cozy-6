/**
 * Crabs on deck: physics items rendered with instancing. They scuttle sideways, pinch ankles,
 * and get sorted: big males into the tank hatch, females & small ones back over the rail.
 */
import * as THREE from 'three';
import { later } from '../core/schedule';
import { config } from '../config';
import { ITEM_DEFS, type Item, type ItemManager } from '../deck/items';
import { crabBodyGeometry, crabFlapGeometry, crabMaterial, crabFlapMaterial, SPECIES_COLOR, type CrabSex } from '../art/crab';
import { L } from '../boat/layout';
import type { Ctx } from '../game/ctx';
import { events } from '../core/events';
import { sfx } from '../audio';
import type { Rng } from '../core/rng';
import type { Crew } from '../crew/crew';

export type Species = 'red' | 'blue' | 'snow' | 'golden';

export interface CrabData {
  species: Species;
  sex: CrabSex;
  size: number; // visual scale 0.6..1.2
  weight: number; // kg
  keep: boolean;
  nextScuttle: number;
  dir: number;
  hatched?: boolean;
  squash?: number; // 0..1 landing squash, decays
  vyPrev?: number;
}

const MAX = 96;
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class CrabSystem {
  readonly crabs: Item[] = [];
  private meshes: Record<CrabSex, { body: THREE.InstancedMesh; flap: THREE.InstancedMesh }>;
  readonly tank: { species: Species; weight: number; correct: boolean; at: number }[] = [];
  released = { correct: 0, wrong: 0 };
  private rng: Rng;
  goldenSparkle: THREE.Points;

  constructor(private ctx: Ctx) {
    this.rng = ctx.rng.stream('crabs');
    // glossy shells: the geometry's vertex shading multiplies each instance's species colour
    const bodyMat = crabMaterial();
    const flapMat = crabFlapMaterial();
    const make = (sex: CrabSex) => {
      const body = new THREE.InstancedMesh(crabBodyGeometry(sex), bodyMat, MAX);
      const flap = new THREE.InstancedMesh(crabFlapGeometry(sex), flapMat, MAX);
      body.castShadow = true;
      body.receiveShadow = true;
      body.count = 0;
      flap.count = 0;
      body.frustumCulled = false;
      flap.frustumCulled = false;
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      ctx.boatGroup.add(body, flap);
      return { body, flap };
    };
    this.meshes = { m: make('m'), f: make('f') };
    // golden shimmer
    const g = new THREE.BufferGeometry();
    const n = 24;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.goldenSparkle = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff2a0, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false }));
    this.goldenSparkle.frustumCulled = false;
    ctx.boatGroup.add(this.goldenSparkle);
    ctx.sys.crabs = this;
  }

  get capacity(): number {
    return Math.round(config.fishing.tankCapacity * (this.ctx.upgrades.has('biggerTank') ? config.fishing.biggerTankScale : 1));
  }

  get items(): ItemManager {
    return this.ctx.items;
  }

  /** Roll a crab's identity. */
  roll(species: Species, rng: Rng = this.rng): CrabData {
    const c = config.catch[species];
    const female = rng.chance(c.femaleRate);
    const small = !female && rng.chance(c.smallRate);
    const size = female ? rng.range(0.8, 0.98) : small ? rng.range(0.62, 0.75) : rng.range(0.92, 1.18);
    const w = c.weight;
    const weight = (w[0] + (w[1] - w[0]) * rng.next()) * (small ? 0.55 : female ? 0.75 : 1);
    return { species, sex: female ? 'f' : 'm', size, weight, keep: !female && !small, nextScuttle: 0, dir: 1 };
  }

  spawn(localPos: THREE.Vector3, data: CrabData, vel?: THREE.Vector3): Item {
    const def = { ...ITEM_DEFS.crab, mass: Math.max(0.6, data.weight), shape: { type: 'box' as const, half: [0.12 * data.size * (data.sex === 'm' ? 1.15 : 1), 0.05 * data.size, 0.1 * data.size] as [number, number, number] } };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng.range(0, Math.PI * 2));
    const it = this.items.add(def, null, localPos, { quat: q, vel });
    it.data.crab = data;
    data.nextScuttle = this.ctx.time + this.rng.range(0.4, 1.2);
    it.onToSea = () => this.onReleased(it);
    it.onSeaLand = () => {
      this.ctx.sys.spray?.ripple(it.wp, 0.9 * data.size);
      this.ctx.sys.spray?.splashWorld(it.wp, 0.2);
    };
    this.crabs.push(it);
    return it;
  }

  private onReleased(it: Item): void {
    const d = it.data.crab as CrabData;
    if (d.hatched) return;
    const correct = !d.keep;
    if (correct) this.released.correct++;
    else this.released.wrong++;
    events.emit('crabReleased', { kind: d.species, correct });
    later((450) / 1000, () => sfx.play('plop', { pitch: 1.3, volume: 0.6 }));
  }

  /** Crab dropped into the tank hatch. */
  private keep(it: Item): void {
    const d = it.data.crab as CrabData;
    d.hatched = true;
    this.tank.push({ species: d.species, weight: d.weight, correct: d.keep, at: this.ctx.time });
    events.emit('crabKept', { kind: d.species, correct: d.keep });
    sfx.play('knock', { volume: 0.8, pitch: 0.9 + this.rng.range(0, 0.2) });
    sfx.play('plus', { volume: 0.5, delay: 0.08 });
    this.removeCrab(it);
  }

  removeCrab(it: Item): void {
    const i = this.crabs.indexOf(it);
    if (i >= 0) this.crabs.splice(i, 1);
    if (it.mode !== 'gone') this.items.remove(it);
  }

  step(dt: number): void {
    const t = this.ctx.time;
    const h = L.hatch;
    const crewList = (this.ctx.sys.crew?.list ?? []) as Crew[];
    for (let i = this.crabs.length - 1; i >= 0; i--) {
      const it = this.crabs[i];
      if (it.mode === 'gone') {
        this.crabs.splice(i, 1);
        continue;
      }
      if (it.mode !== 'deck' || !it.body) continue;
      const d = it.data.crab as CrabData;
      const p = it.localPos(_v);
      // squash when a falling crab hits the deck
      const vy = it.body.linvel().y;
      if ((d.vyPrev ?? 0) < -1.6 && vy > -0.4) d.squash = Math.min(1, -(d.vyPrev ?? 0) / 4);
      d.vyPrev = vy;
      if (d.squash) d.squash = Math.max(0, d.squash - dt * 5);
      // into the tank hatch?
      if (Math.abs(p.x - h.center.x) < h.half && Math.abs(p.z - h.center.z) < h.half && p.y < h.coaming + 0.15) {
        if (!it.heldBy) {
          this.keep(it);
          continue;
        }
      }
      if (it.heldBy) continue;
      // scuttle sideways
      if (t > d.nextScuttle) {
        d.nextScuttle = t + this.rng.range(0.5, 1.6);
        if (this.rng.chance(0.25)) d.dir = -d.dir;
        const r = it.body.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        const up = _v2.set(0, 1, 0).applyQuaternion(_q);
        if (up.y < 0.3) {
          // flip back over
          it.body.applyImpulse({ x: 0, y: it.mass * 2.2, z: 0 }, true);
          it.body.applyTorqueImpulse({ x: (this.rng.next() - 0.5) * it.mass * 0.2, y: 0, z: (this.rng.next() - 0.5) * it.mass * 0.2 }, true);
        } else {
          const side = _v2.set(d.dir, 0, 0).applyQuaternion(_q);
          side.y = 0;
          side.normalize();
          const sp = 0.9 * it.mass;
          it.body.applyImpulse({ x: side.x * sp, y: it.mass * 0.6, z: side.z * sp }, true);
          if (this.rng.chance(0.3)) it.body.applyTorqueImpulse({ x: 0, y: (this.rng.next() - 0.5) * it.mass * 0.05, z: 0 }, true);
        }
      }
      // pinch ankles
      for (const c of crewList) {
        if (!c.isUp || c.stagger > 0) continue;
        const f = c.feet(_v2);
        if (Math.abs(f.x - p.x) < 0.42 && Math.abs(f.z - p.z) < 0.42 && p.y < 0.4 && t - (c.data.lastPinch ?? -10) > 8) {
          if (this.rng.chance(config.crew.pinchChance * dt)) {
            c.stagger = config.crew.pinchStaggerSec;
            c.data.lastPinch = t;
            sfx.play('pinch', { volume: 0.8 });
            sfx.play('ow', { pitch: c.voicePitch, volume: 0.8, delay: 0.05 });
            events.emit('pinch', { crew: c.id });
          }
        }
      }
    }
  }

  render(): void {
    const counts = { m: 0, f: 0 };
    let sparkN = 0;
    const sp = this.goldenSparkle.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (const it of this.crabs) {
      if (it.mode === 'gone' || !it.visible) continue;
      if (it.mode === 'sea' && it.seaPhase === 'sink' && it.seaAge > 0.4) continue;
      const d = it.data.crab as CrabData;
      const set = this.meshes[d.sex];
      const k = counts[d.sex];
      if (k >= MAX) continue;
      // squash on landing
      const sq = d.squash ?? 0;
      _s.set(d.size * (1 + sq * 0.22), d.size * (1 - sq * 0.4), d.size * (1 + sq * 0.22));
      _m.compose(it.renderP, it.renderQ, _s);
      set.body.setMatrixAt(k, _m);
      set.flap.setMatrixAt(k, _m);
      _c.setHex(SPECIES_COLOR[d.species]);
      if (d.species === 'golden') _c.offsetHSL(0, 0, Math.sin(this.ctx.time * 8) * 0.08 + 0.05);
      set.body.setColorAt(k, _c);
      counts[d.sex] = k + 1;
      if (d.species === 'golden' && sparkN < 24) {
        for (let j = 0; j < 6 && sparkN < 24; j++, sparkN++) {
          const a = this.ctx.time * 3 + j * 1.7;
          sp.setXYZ(sparkN, it.renderP.x + Math.cos(a) * 0.22, it.renderP.y + 0.1 + ((this.ctx.time * 0.8 + j * 0.3) % 0.5), it.renderP.z + Math.sin(a) * 0.22);
        }
      }
    }
    for (const sex of ['m', 'f'] as CrabSex[]) {
      const s = this.meshes[sex];
      s.body.count = counts[sex];
      s.flap.count = counts[sex];
      s.body.instanceMatrix.needsUpdate = true;
      s.flap.instanceMatrix.needsUpdate = true;
      if (s.body.instanceColor) s.body.instanceColor.needsUpdate = true;
    }
    for (let j = sparkN; j < 24; j++) sp.setXYZ(j, 0, -50, 0);
    sp.needsUpdate = true;
  }

  onDeck(): Item[] {
    return this.crabs.filter((c) => c.mode === 'deck');
  }
}
