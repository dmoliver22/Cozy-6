/**
 * Barnacle, the boat cat. Wanders to warm spots (the stove, the engine hatch), belly-slides
 * comically in big waves, digs her claws in at the rail (she can NEVER go overboard),
 * purrs when petted, and can be carried inside during storms.
 */

import * as THREE from 'three';
import { config } from '../config';
import { ItemManager, type Item, type ItemDef } from '../deck/items';
import { CG } from '../deck/groups';
import { L, hullHalfWidth, insideHouse, BULWARK_T } from '../boat/layout';
import { makeCat, type CatView, type CatPose } from '../art/cat';
import type { Verb } from '../deck/interact';
import type { Ctx } from '../game/ctx';
import type { Crew, CrewId } from './crew';
import { events } from '../core/events';
import { sfx } from '../audio';
import { toon } from '../art/materials';

const CAT_DEF: ItemDef = {
  kind: 'cat',
  label: 'Barnacle the cat',
  icon: '🐈',
  shape: { type: 'box', half: [0.11, 0.11, 0.24] },
  mass: config.cat.mass,
  carry: 'hold',
  sea: 'float',
  friction: 0.7,
  restitution: 0.05,
  linDamp: 0.6,
  angDamp: 4,
  noOverboard: true,
  group: CG.cat,
};

const _v = new THREE.Vector3();

export class Cat {
  readonly view: CatView;
  readonly item: Item;
  pose: CatPose = 'sit';
  private target = new THREE.Vector3();
  private nextDecide = 0;
  sliding = false;
  private slideTime = 0;
  private lastSlideEvent = -100;
  private lastScratch = 0;
  insideUntil = 0;
  private purr: ReturnType<typeof sfx.loop>;
  private purrUntil = 0;
  private hearts: THREE.Sprite[] = [];
  private rng;
  hammock: THREE.Object3D | null = null;
  petCount = 0;

  constructor(private ctx: Ctx) {
    ctx.sys.cat = this;
    this.rng = ctx.rng.stream('cat');
    this.view = makeCat();
    this.item = ctx.items.add(CAT_DEF, this.view.root, L.spawn.cat.clone().setY(0.2));
    this.item.body!.setEnabledRotations(false, true, false, true);
    this.item.data.label = 'Barnacle';
    this.item.data.verbs = (crewId: string, held: string | null) => this.verbs(crewId, held);
    this.target.copy(L.engineHatch.center);
    this.purr = sfx.loop('purr', { volume: 0 });
    for (let i = 0; i < 4; i++) {
      const tex = heartTexture();
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.scale.setScalar(0.18);
      sp.visible = false;
      this.view.root.add(sp);
      this.hearts.push(sp);
    }
  }

  setHammock(on: boolean): void {
    if (on && !this.hammock) {
      const g = new THREE.Group();
      const cloth = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0xc8432f));
      cloth.scale.set(1.2, 0.35, 0.7);
      g.add(cloth);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.2, 4), toon(0xd9c27a));
      rope.rotation.z = Math.PI / 2;
      rope.position.y = 0.05;
      g.add(rope);
      g.position.set(0.9, 1.25, 3.65);
      this.ctx.boatGroup.add(g);
      this.hammock = g;
    }
  }

  private verbs(crewId: string, held: string | null): Verb[] | null {
    if (held || this.item.heldBy) return null;
    const pet: Verb = { id: 'pet', icon: '🐾', label: 'Pet Barnacle', button: 'interact', start: () => this.pet() };
    const pick: Verb = {
      id: 'grab',
      icon: '🐈',
      label: 'Pick up Barnacle',
      button: 'use',
      start: (id) => (this.ctx.sys.crew.get(id as CrewId) as Crew).grab(this.item),
    };
    void crewId;
    return [pet, pick];
  }

  pet(): void {
    this.petCount++;
    this.purrUntil = this.ctx.time + 2.6;
    sfx.play('purr', { volume: 0.7 });
    if (this.rng.chance(0.3)) sfx.play('meow', { volume: 0.5, pitch: 1.1 });
    this.hearts.forEach((h, i) => {
      h.visible = true;
      h.userData.t = -i * 0.18;
    });
    events.emit('catPet', {});
    this.pose = 'loaf';
    this.nextDecide = this.ctx.time + 4;
  }

  /** Storms: someone should carry her inside. */
  wantsInside(): boolean {
    const storm = this.ctx.sys.weather?.storm ?? 0;
    const p = this.item.localPos(_v);
    return storm > 0.6 && !insideHouse(p) && this.ctx.time > this.insideUntil && !this.item.heldBy;
  }

  step(dt: number): void {
    const it = this.item;
    const b = it.body;
    if (!b || it.mode !== 'deck') return;
    const t = this.ctx.time;
    const p = it.localPos(new THREE.Vector3());
    const inside = insideHouse(p);
    const lv = b.linvel();
    // carried
    if (it.heldBy) {
      this.pose = 'carried';
      this.sliding = false;
      return;
    }
    if (inside && t > this.insideUntil - 1 && (this.ctx.sys.weather?.storm ?? 0) > 0.5) this.insideUntil = t + 45;
    // belly-slide on a steep deck (not inside, not in the hammock)
    const slope = this.ctx.dw.slopeDeg;
    const wantSlide = !inside && slope > config.cat.slideTiltDeg;
    if (wantSlide !== this.sliding) {
      this.sliding = wantSlide;
      it.collider?.setFriction(wantSlide ? config.cat.slideFriction : 0.7);
    }
    const speed = Math.hypot(lv.x, lv.z);
    if (this.sliding) {
      this.pose = 'slide';
      this.slideTime += dt;
      if (speed > 1.1 && t - this.lastSlideEvent > 40) {
        this.lastSlideEvent = t;
        events.emit('catSlide', { localPos: p.clone() });
        sfx.play('meow', { pitch: 1.3, volume: 0.7 });
      }
    } else this.slideTime = 0;
    // claws in at the rail: never overboard
    const hw = hullHalfWidth(Math.max(-9.3, Math.min(10.3, p.z))) - BULWARK_T;
    const edge = Math.abs(p.x) - (hw - 0.25);
    if (edge > 0 || ItemManager.outsideHull(p, -0.2)) {
      const side = Math.sign(p.x) || 1;
      if (lv.x * side > 0) b.setLinvel({ x: 0, y: Math.min(lv.y, 0.5), z: lv.z * 0.5 }, true);
      if (Math.abs(p.x) > hw - 0.12 || p.y > 0.9) {
        b.setTranslation({ x: side * (hw - 0.2), y: Math.min(p.y, 0.25), z: p.z }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      if (speed > 0.6 && t - this.lastScratch > 0.8) {
        this.lastScratch = t;
        sfx.play('scratch', { volume: 0.8 });
      }
      this.pose = 'cling';
    }
    if (this.sliding || this.pose === 'cling') return;
    // wander between warm spots
    if (t > this.nextDecide) {
      this.nextDecide = t + this.rng.range(9, 22);
      const storm = (this.ctx.sys.weather?.storm ?? 0) > 0.5;
      const spots = storm || inside ? [new THREE.Vector3(1.0, 0, 4.0), new THREE.Vector3(0.4, 0, 4.6)] : [L.engineHatch.center.clone(), new THREE.Vector3(1.0, 0, 4.0), new THREE.Vector3(-0.2, 0, -3.3), new THREE.Vector3(1.6, 0, 0.9)];
      this.target.copy(this.rng.pick(spots));
      if (this.hammock && (storm || this.rng.chance(0.3))) this.target.set(0.9, 0, 3.75);
    }
    const dx = this.target.x - p.x,
      dz = this.target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.35) {
      // simple steering; use the bots' nav grid for a waypoint if available
      let wx = dx / d,
        wz = dz / d;
      const grid = this.ctx.sys.bots?.grid;
      if (grid && !grid.lineFree(p, this.target)) {
        const path = grid.path(p, this.target);
        if (path[0]) {
          const ddx = path[0].x - p.x,
            ddz = path[0].z - p.z;
          const l = Math.hypot(ddx, ddz) || 1;
          wx = ddx / l;
          wz = ddz / l;
        }
      }
      const v = config.cat.walkSpeed;
      const m = it.mass;
      b.applyImpulse({ x: (wx * v - lv.x) * m * 6 * dt, y: 0, z: (wz * v - lv.z) * m * 6 * dt }, true);
      const yaw = Math.atan2(wx, wz);
      b.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), true);
      this.pose = 'walk';
    } else {
      this.pose = this.ctx.time % 30 < 18 ? 'loaf' : 'sit';
      if (this.hammock && Math.hypot(p.x - 0.9, p.z - 3.75) < 0.5) {
        // hop up into the hammock: snug and safe
        b.setTranslation({ x: 0.9, y: 1.32, z: 3.65 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  render(dtReal: number): void {
    this.view.setPose(this.pose, this.ctx.time);
    const purring = this.ctx.time < this.purrUntil;
    this.purr.setVolume(purring ? 0.8 : 0, 0.3);
    for (const h of this.hearts) {
      if (!h.visible) continue;
      h.userData.t += dtReal;
      const k = h.userData.t;
      if (k < 0) {
        h.material.opacity = 0;
        continue;
      }
      h.position.set(Math.sin(k * 5) * 0.08, 0.25 + k * 0.5, 0.1);
      h.material.opacity = Math.max(0, 1 - k / 1.4);
      if (k > 1.4) h.visible = false;
    }
  }
}

function heartTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ff6f91';
  g.font = '52px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('♥', 32, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


