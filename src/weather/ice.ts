/**
 * Ice builds up in snow on the rails and deck (visible thickness), lowers friction,
 * and makes the boat top-heavy (more roll). Chip it off with the mallet: rhythmic taps,
 * crisp cracks, shards that tumble downhill, visible thinning — and a bigger shatter on the last tap.
 */
import * as THREE from 'three';
import { config } from '../config';
import { clamp } from '../core/math';
import { ICE_ZONE_ROWS, HALF_BEAM, BULWARK_T, hullHalfWidth, railHeight, L, BOW_Z } from '../boat/layout';
import { ITEM_DEFS, type Item } from '../deck/items';
import { interactableId, type Verb } from '../deck/interact';
import { makeMallet } from '../art/items';
import type { Ctx } from '../game/ctx';
import { events } from '../core/events';
import { sfx } from '../audio';

const _v = new THREE.Vector3();

export class IceSystem {
  readonly mallet: Item;
  private deckMeshes: THREE.Mesh[] = [];
  private railMeshes: THREE.Mesh[][] = [];
  private lastTap = -10;
  private rng;
  /** per-zone stand spot for chipping */
  readonly spots: THREE.Vector3[] = [];

  constructor(private ctx: Ctx) {
    ctx.sys.ice = this;
    this.rng = ctx.rng.stream('ice');
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.1);
    this.mallet = ctx.items.add(ITEM_DEFS.mallet, makeMallet(), L.malletHook.clone(), { fixed: true, quat: q });
    this.mallet.data.label = 'ice mallet';
    this.mallet.home = { p: L.malletHook.clone(), q, afterSec: 25 };
    const iceMat = () => new THREE.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, opacity: 0, depthWrite: false });
    const railMat = new THREE.MeshToonMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.85 });
    ICE_ZONE_ROWS.forEach(([z0, z1], row) => {
      for (const side of [1, -1]) {
        const zi = row * 2 + (side > 0 ? 0 : 1);
        // deck sheen: a flat patch on this side of the zone
        const zz1 = Math.min(z1, BOW_Z - 1.5);
        const w = HALF_BEAM - BULWARK_T - 0.1;
        const geo = new THREE.PlaneGeometry(w, zz1 - z0);
        geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, iceMat());
        m.position.set((side * w) / 2, 0.015, (z0 + zz1) / 2);
        m.renderOrder = 3;
        ctx.boatGroup.add(m);
        this.deckMeshes[zi] = m;
        // chunky ice along the rail top
        const strips: THREE.Mesh[] = [];
        const n = Math.max(1, Math.round((zz1 - z0) / 1.2));
        for (let k = 0; k < n; k++) {
          const za = z0 + ((zz1 - z0) * k) / n,
            zb = z0 + ((zz1 - z0) * (k + 1)) / n;
          const zc = (za + zb) / 2;
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1, zb - za), railMat);
          strip.position.set(side * (hullHalfWidth(zc) - BULWARK_T / 2), railHeight(zc) + 0.06, zc);
          strip.scale.y = 0.001;
          strip.visible = false;
          ctx.boatGroup.add(strip);
          strips.push(strip);
        }
        this.railMeshes[zi] = strips;
        // standing spot to chip this zone
        const zs = clamp((z0 + zz1) / 2, -4.0, 6.5);
        const spot = new THREE.Vector3(side * (hullHalfWidth(zs) - 0.85), 0, zs);
        if (row === 1) spot.z = side > 0 ? -1.4 : -1.1;
        this.spots[zi] = spot;
        // interactable: chip the ice here (with the mallet in hand)
        const chip: Verb = { id: 'chip', icon: '🔨', label: 'Chip the ice (tap!)', button: 'use', start: () => this.chip(zi) };
        ctx.interact.add({
          id: interactableId(),
          name: 'ice:' + zi,
          radius: 1.6,
          pos: (out) => out.copy(spot).setY(0.4),
          verbs: (_id, held) => (held === 'mallet' && this.level(zi) > 0.04 ? [chip] : null),
        });
      }
    });
  }

  level(zone: number): number {
    return this.ctx.surface.ice[zone];
  }

  worstZone(): { zone: number; level: number; spot: THREE.Vector3 } {
    let best = 0;
    const ice = this.ctx.surface.ice;
    for (let i = 1; i < ice.length; i++) if (ice[i] > ice[best]) best = i;
    return { zone: best, level: ice[best], spot: this.spots[best] };
  }

  chip(zone: number): void {
    const t = this.ctx.time;
    if (t - this.lastTap < config.ice.chipCooldown) return;
    this.lastTap = t;
    const ice = this.ctx.surface.ice;
    const before = ice[zone];
    ice[zone] = Math.max(0, before - config.ice.chipPerTap);
    const last = before > 0 && ice[zone] <= 0.001;
    const p = _v.copy(this.spots[zone]);
    p.x += Math.sign(p.x) * 0.55;
    p.y = 0.5;
    const spray = this.ctx.sys.spray;
    spray?.shardBurst(p, last ? 26 : 9, last);
    sfx.play('chip', { volume: 0.8, pitch: 0.9 + this.rng.range(0, 0.25) });
    sfx.play(last ? 'shatter' : 'crack', { volume: last ? 0.9 : 0.6, pitch: 0.9 + this.rng.range(0, 0.3), delay: 0.02 });
    events.emit('iceChipped', { zone, last });
    if (last) this.ctx.sys.hud?.pop('Clear!', p.clone().setY(1.2), 'good', 1.0);
  }

  step(dt: number): void {
    const w = this.ctx.sys.weather;
    if (!w) return;
    const heater = this.ctx.upgrades.has('heaterLines') ? config.weather.heaterIceScale : 1;
    const ice = this.ctx.surface.ice;
    const rate = w.cur.iceRate * heater * (0.4 + w.snow) * config.weather.iceScale;
    for (let i = 0; i < ice.length; i++) {
      // the fore walkways (row 2) ice a little less: the house shelters them
      const shelter = i >= 4 ? 0.6 : 1;
      ice[i] = Math.min(1, ice[i] + rate * shelter * dt * (0.8 + 0.4 * ((i * 37) % 5) / 5));
    }
    // top-heavy: more roll
    this.ctx.boat.rollScale = 1 + config.boat.iceRollGain * this.ctx.surface.totalIce();
    this.ctx.surface.railIce[0] = (ice[0] + ice[2] + ice[4]) / 3;
    this.ctx.surface.railIce[1] = (ice[1] + ice[3] + ice[5]) / 3;
  }

  render(): void {
    const ice = this.ctx.surface.ice;
    for (let i = 0; i < ice.length; i++) {
      const lv = ice[i];
      const dm = this.deckMeshes[i];
      if (dm) (dm.material as THREE.MeshBasicMaterial).opacity = clamp(lv * 0.65, 0, 0.6);
      for (const s of this.railMeshes[i] ?? []) {
        s.visible = lv > 0.03;
        s.scale.y = Math.max(0.001, lv * config.ice.maxThickness * 2.5);
        s.scale.x = 1 + lv * 0.3;
      }
    }
  }
}
