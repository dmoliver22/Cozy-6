/**
 * Spray effects: world-space spray (crests meeting the bow, impacts, splashes)
 * and boat-local splashes (water cascading off a landed pot, ice shards…).
 * Ripple rings on the sea are a RippleField (one instanced draw call).
 */
import * as THREE from 'three';
import { ParticleCloud } from './spray';
import { RippleField } from './ripples';
import type { Ctx } from '../game/ctx';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class SprayFx {
  readonly world: ParticleCloud;
  readonly local: ParticleCloud;
  readonly shards: ParticleCloud;
  readonly ripples: RippleField;
  private bowCooldown = 0;

  constructor(private ctx: Ctx, capacity: number) {
    // a small pool of expanding rings for things plopping into the sea
    this.ripples = new RippleField(ctx.sea, 10);
    ctx.scene.add(this.ripples.mesh);
    this.world = new ParticleCloud(capacity, 0xf2f6f4, 320);
    this.world.floor = (x, z) => ctx.sea.height(x, z);
    ctx.scene.add(this.world.points);
    this.local = new ParticleCloud(Math.floor(capacity * 0.6), 0xe4f4f2, 320);
    this.local.drag = 1.2;
    this.local.floor = () => -0.05;
    ctx.boatGroup.add(this.local.points);
    this.shards = new ParticleCloud(80, 0xeaf6ff, 160, { shard: true });
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
    const w = h * (window.innerWidth / Math.max(1, window.innerHeight));
    this.world.setViewport(w, h);
    this.local.setViewport(w, h);
    this.shards.setViewport(w, h);
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
      this.local.emit(_v, _d, 0.6 + Math.random() * 0.5, 0.22 + Math.random() * 0.22);
    }
    // a little mist where it lands
    for (let i = 0; i < Math.max(1, count / 10); i++) {
      _v.set(p.x + (Math.random() - 0.5) * spread, p.y + 0.1, p.z + (Math.random() - 0.5) * spread);
      _d.set((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6);
      this.local.emit(_v, _d, 0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.6, 1);
    }
  }

  /** An expanding ripple ring on the sea surface (world point). */
  ripple(p: THREE.Vector3, size = 1, life = 1.3): void {
    this.ripples.spawn(p.x, p.z, size, life * 1.15);
  }

  shardBurst(p: THREE.Vector3, count: number, big = false): void {
    for (let i = 0; i < count; i++) {
      _d.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3).multiplyScalar(big ? 1.4 : 1);
      this.shards.emit(p, _d, 0.7 + Math.random() * 0.6, (big ? 0.35 : 0.25) * (0.6 + Math.random() * 0.7));
    }
    // a puff of frost dust
    for (let i = 0; i < (big ? 4 : 2); i++) {
      _d.set((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2);
      this.local.emit(p, _d, 0.7 + Math.random() * 0.4, big ? 1.2 : 0.8, 1);
    }
  }

  /** Something hit the water at a world point: a crown splash, mist and a ripple ring. */
  splashWorld(p: THREE.Vector3, size: number): void {
    const n = Math.round(10 + size * 16);
    this.world.crown(p, 0.2 + size * 0.45, n, 2.2 + size * 2.6, 0.9, 0.45 + size * 0.2);
    if (!this.ripples.recentNear(p.x, p.z, 0.8 + size, 0.15)) this.ripples.spawn(p.x, p.z, 0.8 + size * 1.4, 1.2 + size * 0.5);
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
      // sheets off both shoulders of the bow
      this.burstLocal(_v.set(2.4, -0.1, 8.3), _d.set(1.1, 0.9, 0.3), Math.round(n * 0.4), 2 + swell * 3, 0.8);
      this.burstLocal(_v.set(-2.4, -0.1, 8.3), _d.set(-1.1, 0.9, 0.3), Math.round(n * 0.4), 2 + swell * 3, 0.8);
    }
  }

  update(dt: number): void {
    this.ripples.update(dt);
    this.world.update(dt);
    this.local.update(dt);
    this.shards.update(dt);
  }
}
