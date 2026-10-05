/**
 * Spray effects: world-space spray (crests meeting the bow, impacts, splashes)
 * and boat-local splashes (water cascading off a landed pot, ice shards…).
 */
import * as THREE from 'three';
import { ParticleCloud } from './spray';
import type { Ctx } from '../game/ctx';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class SprayFx {
  readonly world: ParticleCloud;
  readonly local: ParticleCloud;
  readonly shards: ParticleCloud;
  private bowCooldown = 0;

  constructor(private ctx: Ctx, capacity: number) {
    this.world = new ParticleCloud(capacity, 0xeaf2f0, 320);
    this.world.floor = (x, z) => ctx.sea.height(x, z);
    ctx.scene.add(this.world.points);
    this.local = new ParticleCloud(Math.floor(capacity * 0.6), 0xd8f2f2, 320);
    this.local.drag = 1.2;
    this.local.floor = () => -0.05;
    ctx.boatGroup.add(this.local.points);
    this.shards = new ParticleCloud(80, 0xf4fbff, 160);
    this.shards.floor = () => 0.02;
    this.shards.drag = 2;
    ctx.boatGroup.add(this.shards.points);
    ctx.sys.spray = this;
  }

  setPixelScale(h: number): void {
    const s = h * 0.45;
    this.world.setPixelScale(s);
    this.local.setPixelScale(s);
    this.shards.setPixelScale(s * 0.6);
  }

  /** Burst at a boat-local point, direction in local space. */
  burstLocal(p: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, life = 0.9): void {
    // emit into world space so it keeps flying when the boat moves
    this.ctx.boat.localToWorld(p, _v);
    this.ctx.boat.dirLocalToWorld(dir, _d);
    this.world.burst(_v, _d, count, speed, 0.8, life, 0.55);
  }

  /** Water cascading off something on deck (local cloud). */
  cascade(p: THREE.Vector3, count: number, spread = 1.6): void {
    for (let i = 0; i < count; i++) {
      _v.set(p.x + (Math.random() - 0.5) * spread, p.y + Math.random() * 0.3, p.z + (Math.random() - 0.5) * spread);
      _d.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
      this.local.emit(_v, _d, 0.6 + Math.random() * 0.5, 0.35);
    }
  }

  shardBurst(p: THREE.Vector3, count: number, big = false): void {
    for (let i = 0; i < count; i++) {
      _d.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3).multiplyScalar(big ? 1.4 : 1);
      this.shards.emit(p, _d, 0.7 + Math.random() * 0.6, big ? 0.35 : 0.25);
    }
  }

  splashWorld(p: THREE.Vector3, size: number): void {
    this.world.burst(p, _d.set(0, 1, 0), Math.round(8 + size * 14), 2 + size * 3, 0.6 + size * 0.5, 0.9, 0.5 + size * 0.2);
  }

  step(dt: number): void {
    // crest meeting the bow: spray when the bow plunges fast / big waves
    const b = this.ctx.boat;
    this.bowCooldown -= dt;
    const plunge = -b.pitch.v; // bow-down rate
    const swell = this.ctx.sea.swell;
    if (this.bowCooldown <= 0 && (plunge > 0.12 || b.heave.v < -0.9) && swell > 0.45) {
      this.bowCooldown = 0.5;
      const n = Math.round(6 + swell * 14);
      this.burstLocal(_v.set(0, 0.6, 10.2), _d.set(0, 1.2, 0.6), n, 3 + swell * 4, 1.0);
    }
  }

  update(dt: number): void {
    this.world.update(dt);
    this.local.update(dt);
    this.shards.update(dt);
  }
}
