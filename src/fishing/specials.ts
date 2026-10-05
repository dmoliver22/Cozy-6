/**
 * The "pot luck": special catches.
 *  - message in a bottle → curiosity crate → postcard with a line of lore
 *  - octopus → steals an item and must be chased (grab it to get the item back)
 *  - lost rubber boot → crate → wearable
 *  - old ship's bell → crate → galley decor
 *  - sea otter riding a pot → pet it, then release it (it hops home)
 *  - glowing jellyfish → photo moment, then release
 */
import * as THREE from 'three';
import type { Item, ItemDef } from '../deck/items';
import { makeSpecial, type SpecialKind } from '../art/items';
import { L, hullHalfWidth } from '../boat/layout';
import type { Ctx } from '../game/ctx';
import type { Crew, CrewId } from '../crew/crew';
import type { Verb } from '../deck/interact';
import type { Pot } from './pots';
import { CG } from '../deck/groups';
import { events } from '../core/events';
import { sfx } from '../audio';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const SPECIAL_INFO: Record<SpecialKind, { name: string; icon: string; keep: 'crate' | 'release'; line: string }> = {
  bottle: { name: 'message in a bottle', icon: '🍾', keep: 'crate', line: 'A message in a bottle! Pop it in the curio crate.' },
  octopus: { name: 'octopus', icon: '🐙', keep: 'release', line: 'An octopus! Watch your stuff…' },
  boot: { name: 'lost rubber boot', icon: '🥾', keep: 'crate', line: 'Somebody lost a boot. Looks your size!' },
  bell: { name: "old ship's bell", icon: '🔔', keep: 'crate', line: "An old ship's bell — that'd look grand in the galley." },
  otter: { name: 'sea otter', icon: '🦦', keep: 'release', line: 'A sea otter hitched a ride! Give it a pat, then let it go.' },
  jelly: { name: 'glowing jellyfish', icon: '🪼', keep: 'release', line: 'A glowing jellyfish… snap a photo, then let it go.' },
};

export const LORE = [
  '"To whoever finds this: the Kittiwake light was lit by a cat named Biscuit for thirty winters. Probably." — 1952',
  '"Dear Mo, you still owe me a pie. — Gran, the Puffin\'s first skipper"',
  '"The golden crab only climbs into pots baited by somebody who sings to the bait."',
];

const DEFS: Record<SpecialKind, ItemDef> = {
  bottle: { kind: 'special', label: 'bottle', icon: '🍾', shape: { type: 'capsule', halfH: 0.1, r: 0.07 }, mass: 0.8, carry: 'hold', sea: 'float', friction: 0.2, ccd: true },
  octopus: { kind: 'special', label: 'octopus', icon: '🐙', shape: { type: 'ball', r: 0.2 }, mass: 3, carry: 'hold', sea: 'sink', friction: 0.8, linDamp: 0.6 },
  boot: { kind: 'special', label: 'rubber boot', icon: '🥾', shape: { type: 'box', half: [0.08, 0.18, 0.15] }, mass: 1.2, carry: 'hold', sea: 'float', friction: 0.4 },
  bell: { kind: 'special', label: "ship's bell", icon: '🔔', shape: { type: 'cylinder', halfH: 0.16, r: 0.17 }, mass: 9, carry: 'hold', sea: 'sink', friction: 0.4 },
  otter: { kind: 'special', label: 'sea otter', icon: '🦦', shape: { type: 'capsule', halfH: 0.25, r: 0.16 }, mass: 8, carry: 'hold', sea: 'float', friction: 0.5, angDamp: 2 },
  jelly: { kind: 'special', label: 'jellyfish', icon: '🪼', shape: { type: 'ball', r: 0.18 }, mass: 1, carry: 'hold', sea: 'float', friction: 0.9, linDamp: 1.2 },
};

export interface CurioRecord {
  kind: SpecialKind;
  outcome: 'crate' | 'released' | 'lost';
}

export class SpecialSystem {
  readonly active: Item[] = [];
  readonly curios: CurioRecord[] = [];
  private rng;

  constructor(private ctx: Ctx) {
    ctx.sys.specials = this;
    this.rng = ctx.rng.stream('specials');
  }

  spawnFromPot(kind: SpecialKind, pot: Pot): Item {
    const p = new THREE.Vector3(-0.6, 1.6, L.cradle.center.z);
    const v = new THREE.Vector3(1.8, 1.4, 0);
    const it = this.spawn(kind, p, v);
    void pot;
    return it;
  }

  spawn(kind: SpecialKind, p: THREE.Vector3, v?: THREE.Vector3): Item {
    const view = makeSpecial(kind);
    const it = this.ctx.items.add(DEFS[kind], view, p, { vel: v });
    it.data.special = kind;
    it.data.label = SPECIAL_INFO[kind].name;
    it.data.born = this.ctx.time;
    it.onToSea = () => this.onOverboard(it);
    if (kind === 'otter') {
      it.data.verbs = (crewId: string, held: string | null) => this.otterVerbs(it, crewId, held);
    }
    this.active.push(it);
    events.emit('special', { kind, localPos: p.clone() });
    events.emit('radio', { who: 'Mo', text: SPECIAL_INFO[kind].line });
    sfx.play(kind === 'otter' ? 'otter' : kind === 'bottle' ? 'bottle' : kind === 'bell' ? 'shipbell' : 'sparkle', { volume: 0.8 });
    return it;
  }

  private otterVerbs(it: Item, _crewId: string, held: string | null): Verb[] | null {
    if (held || it.heldBy) return null;
    const pet: Verb = {
      id: 'pet',
      icon: '🫶',
      label: it.data.petted ? 'Pet the otter again' : 'Pet the otter',
      button: 'interact',
      start: () => this.petOtter(it),
    };
    const grab: Verb = { id: 'grab', icon: '🦦', label: 'Pick up the otter', button: 'use', start: (id) => (this.ctx.sys.crew.get(id as CrewId) as Crew).grab(it) };
    return [pet, grab];
  }

  private petOtter(it: Item): void {
    it.data.petted = (it.data.petted ?? 0) + 1;
    sfx.play('otter', { pitch: 1.1 });
    sfx.play('purr', { volume: 0.5, pitch: 1.4 });
    this.ctx.sys.hud?.pop('♥', it.localPos(_v).clone().setY(_v.y + 0.5), 'good', 1.2);
    if (it.data.petted === 1) {
      // after a good pat, it says thanks and hops home: the big cozy moment
      it.data.leaveAt = this.ctx.time + 2.2;
    }
  }

  private onOverboard(it: Item): void {
    const kind = it.data.special as SpecialKind;
    this.curios.push({ kind, outcome: SPECIAL_INFO[kind].keep === 'release' ? 'released' : 'lost' });
    if (kind === 'otter') this.ctx.sys.hud?.big('Bye, otter! 🦦');
    else if (kind === 'jelly' || kind === 'octopus') this.ctx.sys.hud?.toast(`The ${SPECIAL_INFO[kind].name} swims home`, '#c8b8ff');
    if (it.data.stolen) this.dropStolen(it);
    this.remove(it);
  }

  private remove(it: Item): void {
    const i = this.active.indexOf(it);
    if (i >= 0) this.active.splice(i, 1);
  }

  private store(it: Item): void {
    const kind = it.data.special as SpecialKind;
    this.curios.push({ kind, outcome: 'crate' });
    this.remove(it);
    if (it.data.stolen) this.dropStolen(it);
    this.ctx.items.remove(it);
    sfx.play('knock', { volume: 0.7, pitch: 0.8 });
    sfx.play('sparkle', { volume: 0.5, delay: 0.1 });
    const msg = kind === 'bottle' ? 'Bottle stowed — a postcard waits in the galley' : kind === 'boot' ? 'Boot stowed — wear it at the harbor' : kind === 'bell' ? "Bell stowed — it'll hang in the galley" : `${SPECIAL_INFO[kind].name} in the curio crate`;
    this.ctx.sys.hud?.toast(msg, '#fff3c0');
  }

  private dropStolen(oct: Item): void {
    const s = oct.data.stolen as Item | undefined;
    if (!s) return;
    oct.data.stolen = null;
    s.data.stolenBy = null;
    if (s.collider) s.collider.setCollisionGroups(s.def.group ?? CG.item);
    this.ctx.sys.hud?.toast('The octopus lets go!', '#8cf09a');
  }

  step(dt: number): void {
    const t = this.ctx.time;
    const cr = L.crate;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const it = this.active[i];
      if (it.mode === 'gone') {
        this.active.splice(i, 1);
        continue;
      }
      if (it.mode !== 'deck' || !it.body) continue;
      const p = it.localPos(_v);
      const kind = it.data.special as SpecialKind;
      // into the curio crate?
      if (!it.heldBy && Math.abs(p.x - cr.center.x) < cr.half.x && Math.abs(p.z - cr.center.z) < cr.half.z && p.y < cr.half.y * 2 + 0.1) {
        this.store(it);
        continue;
      }
      if (kind === 'octopus') this.stepOctopus(it, p, dt);
      if (kind === 'otter' && it.data.leaveAt && t > it.data.leaveAt && !it.heldBy) {
        // a happy hop home: a lobbed arc that clears the port rail (the clear side), retried if it falls short
        it.data.leaveAt = t + 3;
        const z = Math.max(-3.8, Math.min(2.0, p.z));
        const target = new THREE.Vector3(hullHalfWidth(z) + 1.8, -1.0, z);
        const T = 1.45;
        const g = this.ctx.dw.gLocal;
        const v = target.sub(p).addScaledVector(g, -0.5 * T * T).divideScalar(T);
        it.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
        sfx.play('otter', { pitch: 1.3 });
      }
      if (kind === 'jelly') {
        const v = it.view as THREE.Group;
        const s = 1 + Math.sin(t * 3) * 0.06;
        v.children[0]?.scale.set(s, 1 / s, s);
      }
    }
  }

  private stepOctopus(it: Item, p: THREE.Vector3, dt: number): void {
    const b = it.body!;
    const items = this.ctx.items.items;
    if (it.heldBy) {
      if (it.data.stolen) this.dropStolen(it);
      return;
    }
    if (!it.data.stolen && this.ctx.time - it.data.born > 1.2) {
      // find something to pinch
      let best: Item | null = null;
      let bd = 6;
      for (const o of items) {
        if (o === it || o.mode !== 'deck' || o.heldBy || o.data.stolenBy) continue;
        if (!['baitJar', 'hat', 'bucket', 'mallet'].includes(o.kind)) continue;
        const d = o.localPos(_v2).distanceTo(p);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        const tp = best.localPos(_v2);
        if (bd < 0.5) {
          it.data.stolen = best;
          best.data.stolenBy = it;
          if (best.collider) best.collider.setCollisionGroups(CG.held);
          sfx.play('chatter', { pitch: 0.8 });
          this.ctx.sys.hud?.toast(`The octopus stole a ${best.data.label ?? best.def.label}! Catch it!`, '#ffb0a0');
        } else if (Math.random() < dt * 3) {
          const d = tp.sub(p).setY(0).normalize();
          b.applyImpulse({ x: d.x * 6, y: 2, z: d.z * 6 }, true);
        }
      }
    }
    const s = it.data.stolen as Item | undefined;
    if (s && s.body) {
      // carry the loot on its head
      s.body.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z }, true);
      s.body.setLinvel(b.linvel(), true);
      // run away from the nearest crew
      const crew = this.ctx.sys.crew.list as Crew[];
      let near: Crew | null = null;
      let nd = 3;
      for (const c of crew) {
        if (!c.isUp) continue;
        const d = c.pos(_v2).distanceTo(p);
        if (d < nd) {
          nd = d;
          near = c;
        }
      }
      if (near && Math.random() < dt * 4) {
        const away = _v2.copy(p).sub(near.pos(new THREE.Vector3())).setY(0).normalize();
        b.applyImpulse({ x: away.x * 7, y: 2.5, z: away.z * 7 }, true);
      }
    }
  }
}

