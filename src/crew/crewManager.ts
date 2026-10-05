/**
 * Owns the crew, feeds contact impulses into knockdown checks, steps and renders them.
 */
import * as THREE from 'three';
import { Crew, type CrewId } from './crew';
import { RagdollPool } from './ragdoll';
import { makeCrew, CREW_LOOKS } from '../art/crew';
import { L } from '../boat/layout';
import type { Ctx } from '../game/ctx';

const _v = new THREE.Vector3();

export class CrewManager {
  readonly pool: RagdollPool;
  readonly list: Crew[] = [];
  readonly map = new Map<CrewId, Crew>();
  player!: Crew;

  constructor(private ctx: Ctx) {
    this.pool = new RagdollPool(ctx.dw);
    const spawn = L.spawn;
    const add = (id: CrewId, name: string, sp: THREE.Vector3) => {
      const look = CREW_LOOKS[id];
      const view = makeCrew(look);
      const c = new Crew(id, name, view, ctx, this.pool, sp);
      c.bot = id !== 'player';
      this.list.push(c);
      this.map.set(id, c);
      return c;
    };
    this.player = add('player', 'You', spawn.player);
    add('mo', 'Mo', spawn.mo);
    add('dot', 'Dot', spawn.dot);
    add('ike', 'Ike', spawn.ike);
    ctx.sys.crew = this;
  }

  get(id: CrewId): Crew {
    return this.map.get(id)!;
  }
  byName(name: string): Crew | undefined {
    return this.list.find((c) => c.name === name);
  }

  step(dt: number): void {
    for (const c of this.list) c.step(dt);
  }

  /** After the physics step: capture transforms, read contact impulses. */
  postStep(dt: number): void {
    for (const c of this.list) c.capture();
    this.pool.capture();
    const dw = this.ctx.dw;
    dw.events.drainContactForceEvents((e) => {
      const c1 = dw.world.getCollider(e.collider1());
      const c2 = dw.world.getCollider(e.collider2());
      const o1 = dw.ownerOf(c1);
      const o2 = dw.ownerOf(c2);
      const pairs: [typeof o1, typeof o2][] = [
        [o1, o2],
        [o2, o1],
      ];
      for (const [a, b] of pairs) {
        if (!a || a.kind !== 'crew') continue;
        if (!b) continue;
        const other = a === o1 ? c2 : c1;
        const ob = other.parent();
        if (!ob || ob.isFixed() || ob.isKinematic()) continue; // structure never knocks you down by contact
        const crew = a.crew as Crew;
        // only heavy loose things (a sliding pot) or a tumbling body knock you over — not light items or a crewmate's shoulder
        if (b.kind === 'crew') continue;
        if (b.kind === 'item' && (b.item as { mass: number }).mass < 25) continue;
        const impulse = e.totalForceMagnitude() * dt;
        if (impulse > crew.pendingImpulse) {
          crew.pendingImpulse = impulse;
          const d = e.maxForceDirection();
          const s = a === o1 ? -1 : 1;
          crew.pendingImpulseDir.set(d.x * s, 0, d.z * s);
        }
      }
    });
  }

  render(alpha: number, dt: number, boatP: THREE.Vector3, boatQ: THREE.Quaternion): void {
    for (const c of this.list) c.render(alpha, dt, boatP, boatQ);
  }

  overboard(): Crew[] {
    return this.list.filter((c) => c.inSea);
  }

  /** All crew who are up and about (not in the sea, not knocked down). */
  standing(): Crew[] {
    return this.list.filter((c) => c.isUp);
  }

  nearestTo(p: THREE.Vector3, filter: (c: Crew) => boolean): Crew | null {
    let best: Crew | null = null;
    let bd = Infinity;
    for (const c of this.list) {
      if (!filter(c)) continue;
      const d = c.pos(_v).distanceTo(p);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Debug helper: count knockdowns. */
  get knockdowns(): number {
    return this.list.reduce((s, c) => s + c.knockCount, 0);
  }
}

