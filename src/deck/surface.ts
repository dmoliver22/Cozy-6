/**
 * Deck surface state: wetness, standing water (from deck washes, draining through scuppers),
 * and ice per zone. Drives collider friction and crew grip.
 */
import * as THREE from 'three';
import { config } from '../config';
import { iceZoneOf } from '../boat/layout';
import { clamp, lerp } from '../core/math';
import type { DeckStructure } from './structure';

export type SurfaceKind = 'dry' | 'wet' | 'ice';

export class DeckSurface {
  /** 0 = dry, 1 = soaked (spray, snow melt) */
  wetness = 0.35;
  /** standing water depth on deck (m) */
  water = 0;
  /** ice thickness per zone 0..1 (1 = config.ice.maxThickness) */
  readonly ice = new Float32Array(config.ice.zones);
  /** rail ice per side (visual + chipping) */
  readonly railIce = new Float32Array(2);
  /** water-sheet tilt (follows local gravity) */
  readonly waterNormal = new THREE.Vector3(0, 1, 0);
  heaterScale = 1;

  constructor(private structure: DeckStructure) {}

  iceAt(x: number, z: number): number {
    return this.ice[iceZoneOf(x, z)];
  }

  /** Grip multiplier for crew controllers at a local point. */
  grip(x: number, z: number, inside: boolean): number {
    const g = config.crew.grip;
    if (inside) return g.dry;
    const base = lerp(g.dry, g.wet, clamp(this.wetness + this.water * 4, 0, 1));
    const ice = clamp(this.iceAt(x, z) / config.ice.frictionAt, 0, 1);
    return lerp(base, g.ice, ice);
  }

  kind(x: number, z: number): SurfaceKind {
    if (this.iceAt(x, z) > config.ice.frictionAt * 0.6) return 'ice';
    return this.wetness + this.water * 4 > 0.5 ? 'wet' : 'dry';
  }

  /** Slow factor for walking through standing water. */
  waterSlow(): number {
    return this.water > 0.04 ? lerp(1, config.deck.ankleDeepSlow, clamp((this.water - 0.04) / 0.12, 0, 1)) : 1;
  }

  addWater(depth: number): void {
    this.water = Math.min(0.35, this.water + depth);
    this.wetness = 1;
  }

  step(dt: number, gDir: THREE.Vector3): void {
    // scuppers drain the deck
    this.water *= Math.exp(-dt / config.deck.drainSec);
    if (this.water < 0.002) this.water = 0;
    this.waterNormal.copy(gDir).multiplyScalar(-1);
    // collider friction per zone
    const f = config.deck.friction;
    const wetF = lerp(f.dry, f.wet, clamp(this.wetness + this.water * 4, 0, 1));
    this.structure.zoneColliders.forEach((c, i) => {
      if (!c) return;
      const ice = clamp(this.ice[i] / config.ice.frictionAt, 0, 1);
      c.setFriction(lerp(wetF, f.ice, ice));
    });
  }

  totalIce(): number {
    let s = 0;
    for (let i = 0; i < this.ice.length; i++) s += this.ice[i];
    return (s / this.ice.length) * 0.7 + ((this.railIce[0] + this.railIce[1]) / 2) * 0.3;
  }
}
