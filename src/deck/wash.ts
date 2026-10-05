/**
 * Deck wash: when a rogue set hits, a sheet of green water slides across the deck in local space,
 * pushing bodies and crabs, knocking over the unbraced, then drains through the scuppers.
 */
import * as THREE from 'three';
import { config } from '../config';
import { clamp } from '../core/math';
import { deckGeometry } from '../art/boat';
import { HALF_BEAM, STERN_Z } from '../boat/layout';
import type { RogueSide } from '../core/events';
import type { Ctx } from '../game/ctx';
import type { Crew } from '../crew/crew';
import { sfx } from '../audio';

const _v = new THREE.Vector3();

export class DeckWash {
  active = false;
  side: RogueSide = 'starboard';
  dirX = 1;
  dirZ = 0;
  front = 0;
  sStart = 0;
  sEnd = 0;
  amp = 0;
  depth = 0;
  private hitCrew = new Set<string>();
  private vaulted = new Set<string>();
  readonly sheet: THREE.Mesh;
  readonly layer: THREE.Mesh;
  private layerMat: THREE.MeshBasicMaterial;
  private sheetMat: THREE.MeshBasicMaterial;
  private rng;

  constructor(private ctx: Ctx) {
    ctx.sys.wash = this;
    this.rng = ctx.rng.stream('wash');
    // the travelling wall of water: a rounded strip, scaled per wash
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    this.sheetMat = new THREE.MeshBasicMaterial({ color: 0xcfeeee, transparent: true, opacity: 0.8, depthWrite: false });
    this.sheet = new THREE.Mesh(g, this.sheetMat);
    this.sheet.visible = false;
    this.sheet.renderOrder = 6;
    ctx.boatGroup.add(this.sheet);
    // standing water layer on deck
    this.layerMat = new THREE.MeshBasicMaterial({ color: 0x3f9aa0, transparent: true, opacity: 0, depthWrite: false });
    this.layer = new THREE.Mesh(deckGeometry(), this.layerMat);
    this.layer.renderOrder = 4;
    ctx.boatGroup.add(this.layer);
  }

  start(side: RogueSide, amp: number): void {
    this.active = true;
    this.side = side;
    this.amp = amp;
    this.depth = config.deck.washDepth * clamp(amp / 2.6, 0.4, 1.3);
    this.hitCrew.clear();
    this.vaulted.clear();
    if (side === 'starboard') {
      this.dirX = 1;
      this.dirZ = 0;
      this.sStart = -HALF_BEAM;
      this.sEnd = HALF_BEAM + 0.4;
    } else if (side === 'port') {
      this.dirX = -1;
      this.dirZ = 0;
      this.sStart = -HALF_BEAM;
      this.sEnd = HALF_BEAM + 0.4;
    } else {
      // over the bow, around the wheelhouse, down the working deck
      this.dirX = 0;
      this.dirZ = -1;
      this.sStart = -3.2;
      this.sEnd = -STERN_Z + 0.4;
    }
    this.front = this.sStart;
    sfx.play('splash', { volume: 1, pitch: 0.7 });
    // spray burst along the impact rail
    const spray = this.ctx.sys.spray;
    if (spray) {
      for (let i = -3; i <= 3; i++) {
        _v.set(this.dirZ !== 0 ? i * 0.8 : -this.dirX * HALF_BEAM, 1.2, this.dirZ !== 0 ? 4.0 : i * 1.6 - 1);
        spray.burstLocal(_v, new THREE.Vector3(this.dirX, 1.6, this.dirZ), 10, 5 + amp, 1.0);
      }
    }
  }

  /** Signed distance of a local point along the wash direction. */
  private sOf(x: number, z: number): number {
    return x * this.dirX + z * this.dirZ;
  }

  step(dt: number): void {
    const surf = this.ctx.surface;
    if (!this.active) return;
    const speed = config.deck.washSpeed * clamp(this.amp / 2.4, 0.6, 1.2);
    this.front += speed * dt;
    const band = 1.1;
    const depth = this.depth;
    const dw = this.ctx.dw;
    const nearEnd = this.front > this.sEnd - 1.0;
    // push every dynamic body the front passes over
    dw.world.forEachActiveRigidBody((b) => {
      if (!b.isDynamic()) return;
      const t = b.translation();
      const s = this.sOf(t.x, t.z);
      if (s > this.front + 0.2 || s < this.front - band * 2.5) return;
      if (t.y > depth + 0.9) return;
      const lv = b.linvel();
      const vAlong = lv.x * this.dirX + lv.z * this.dirZ;
      const vr = Math.max(0, speed - vAlong);
      const m = b.mass();
      const owner = dw.ownerOf(b.collider(0));
      const heavy = owner?.kind === 'ragdoll' ? 0.55 : m > 150 ? 0.35 : m > 60 ? 0.8 : 1.2;
      const k = 4.2 * heavy * (s > this.front - band ? 1 : 0.4);
      let lift = 0;
      if (nearEnd && t.y < 1.3) lift = config.deck.washLiftAtRail * (m < 30 ? 1 : 0.5);
      b.applyImpulse({ x: this.dirX * vr * k * m * dt, y: lift * m * dt, z: this.dirZ * vr * k * m * dt }, true);
    });
    // crew: unbraced get knocked over; ragdolls near the far rail may vault it (comedy overboards)
    const crew = (this.ctx.sys.crew?.list ?? []) as Crew[];
    for (const c of crew) {
      if (c.inSea) continue;
      const p = c.pos(_v);
      const s = this.sOf(p.x, p.z);
      if (Math.abs(s - this.front) < band && !this.hitCrew.has(c.id) && c.isUp && !c.insideHouse) {
        this.hitCrew.add(c.id);
        if (!c.braced && !c.atHelm) {
          const knock = this.amp > 1.25 || (c.crouch ? false : this.amp > 0.9 && this.rng.chance(0.25));
          if (knock) c.knockdown(new THREE.Vector3(this.dirX * 0.3, 0.1, this.dirZ * 0.3).multiplyScalar(speed), 'wave');
          else c.stagger = 0.6;
        }
      }
      if (c.state === 'down' && c.ragdoll && nearEnd && !this.vaulted.has(c.id)) {
        const farRail = this.sEnd - 0.6;
        if (s > farRail - 0.8) {
          this.vaulted.add(c.id);
          const nets = this.ctx.upgrades.has('railNets') ? config.overboard.railNetsChanceScale : 1;
          const chance = config.deck.vaultChance * nets * clamp(this.amp / 2.4, 0.3, 1.2) * (this.ctx.sys.rogue?.current?.label === 'tutorial' ? 0 : 1);
          if (this.rng.chance(chance)) {
            c.ragdoll.pushAll(new THREE.Vector3(this.dirX * 2.6, 5.2, this.dirZ * 2.6));
          }
        }
      }
    }
    if (this.front >= this.sEnd) {
      this.active = false;
      surf.addWater(0.07 * clamp(this.amp / 2, 0.5, 1.4));
    }
  }

  render(t: number): void {
    const surf = this.ctx.surface;
    // standing water layer: rises with depth, tilts toward the low side
    const w = surf.water;
    this.layerMat.opacity = clamp(w * 4, 0, 0.55);
    this.layer.visible = w > 0.003;
    this.layer.position.y = 0.01 + w * 0.6;
    const gn = surf.waterNormal;
    this.layer.rotation.set(-gn.z * 0.15, 0, gn.x * 0.15);
    // the wall of water
    if (!this.active) {
      this.sheet.visible = false;
      return;
    }
    this.sheet.visible = true;
    const along = this.dirZ !== 0;
    const len = along ? 6.2 : 12.6;
    const h = this.depth * 1.6;
    this.sheet.scale.set(len, h * 2, 1.3);
    // geometry axis runs along local X: span the beam for a bow wash, the length for a beam wash
    if (along) {
      this.sheet.rotation.set(0, 0, 0);
      this.sheet.position.set(0, 0.02, -this.front);
    } else {
      this.sheet.rotation.set(0, Math.PI / 2, 0);
      this.sheet.position.set(this.front * this.dirX, 0.02, -3.15);
    }
    this.sheetMat.opacity = 0.65 + Math.sin(t * 20) * 0.05;
  }
}
