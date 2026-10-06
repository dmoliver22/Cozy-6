/**
 * The grapple hook: throw it (aimed arc) at a buoy. If it lands within reach of a buoy line it hooks it,
 * the buoy is reeled to the rail and the thrower is left holding the line — carry it to the block.
 * A miss reels the grapple straight back into your mitten (no fishing for the hook).
 */
import * as THREE from 'three';
import { config } from '../config';
import { ITEM_DEFS, type Item, type ItemDef } from '../deck/items';
import { L, hullHalfWidth } from '../boat/layout';
import { makeGrapple, makeLineCoil, makeBuoy } from '../art/items';
import type { Ctx } from '../game/ctx';
import type { Crew } from '../crew/crew';
import type { Pot, PotSystem } from './pots';
import { events } from '../core/events';
import { sfx } from '../audio';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const N = 16;

const GRAPPLE_DEF: ItemDef = { ...ITEM_DEFS.grapple, sea: 'floatLow' };
const LINE_DEF: ItemDef = { ...ITEM_DEFS.lineEnd };

export class GrappleSystem {
  readonly grapple: Item;
  thrower: Crew | null = null;
  hooked: Pot | null = null;
  reel = 0; // seconds of reeling
  private line: THREE.Line;
  private linePos = new Float32Array(N * 3);
  readonly home = L.grappleHook.clone();
  readonly homeQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.15);
  lastResult: 'hit' | 'miss' | null = null;
  lastThrowAt = -10;
  /** where the thrower actually aimed (world, before the aim assist) and how far the nearest buoy was */
  private rawAim: THREE.Vector3 | null = null;
  private throwDist = 0;

  constructor(private ctx: Ctx) {
    ctx.sys.grapple = this;
    this.grapple = ctx.items.add(GRAPPLE_DEF, makeGrapple(), this.home.clone(), { fixed: true, quat: this.homeQ });
    this.grapple.home = { p: this.home, q: this.homeQ, afterSec: 20 };
    this.grapple.onSeaLand = () => this.onLand();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe8d8a0 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    ctx.boatGroup.add(this.line);
  }

  private get pots(): PotSystem {
    return this.ctx.sys.pots as PotSystem;
  }

  onThrow(crew: Crew, it: Item, _target?: THREE.Vector3, raw?: THREE.Vector3): void {
    if (it !== this.grapple) return;
    this.thrower = crew;
    this.lastThrowAt = this.ctx.time;
    this.hooked = null;
    this.reel = 0;
    this.lastResult = null;
    this.rawAim = raw ? this.ctx.boat.localToWorld(raw.clone(), new THREE.Vector3()) : null;
    // the throw's length: thrower to the nearest buoy out there (a Long Cast is 12 m+)
    const me = this.ctx.boat.localToWorld(crew.pos(new THREE.Vector3()), new THREE.Vector3());
    let d = Infinity;
    for (const pot of this.pots.soakingPots()) d = Math.min(d, Math.hypot(pot.buoy!.wp.x - me.x, pot.buoy!.wp.z - me.z));
    this.throwDist = Number.isFinite(d) ? d : 0;
  }

  private onLand(): void {
    const g = this.grapple;
    let best: Pot | null = null;
    let bd = config.fishing.grappleHookRadius;
    for (const pot of this.pots.soakingPots()) {
      const b = pot.buoy!;
      const d = Math.hypot(b.wp.x - g.wp.x, b.wp.z - g.wp.z);
      if (d < bd) {
        bd = d;
        best = pot;
      }
    }
    // grade the throw on the raw aim (the assist and the hook radius forgive; the grade doesn't)
    if (this.thrower) {
      let near: Pot | null = best;
      if (!near) {
        let nd = Infinity;
        for (const pot of this.pots.soakingPots()) {
          const d = Math.hypot(pot.buoy!.wp.x - g.wp.x, pot.buoy!.wp.z - g.wp.z);
          if (d < nd) {
            nd = d;
            near = pot;
          }
        }
      }
      const aim = this.rawAim ?? g.wp;
      const rawErr = near ? Math.hypot(near.buoy!.wp.x - aim.x, near.buoy!.wp.z - aim.z) : 99;
      events.emit('hooked', { by: this.thrower.id, rawErr, dist: this.throwDist, hit: !!best && !this.pots.blockPot, stringNo: best?.stringNo });
    }
    if (best && !this.pots.blockPot) {
      this.hooked = best;
      this.lastResult = 'hit';
      this.pots.hookPot(best);
      sfx.play('clunk', { volume: 0.6, pitch: 1.4 });
      this.ctx.sys.hud?.toast(`Hooked buoy ${best.number}!`, '#8cf09a');
    } else {
      this.lastResult = 'miss';
      this.ctx.sys.hud?.toast('Missed the line — reeling the grapple back', '#ffd28a', 1.8);
    }
    this.reel = 0;
  }

  /** World point on the starboard rail near the block, where lines come aboard. */
  private railWorld(out: THREE.Vector3): THREE.Vector3 {
    const z = L.block.z + 0.6;
    _v.set(-(hullHalfWidth(z) + 0.4), 0.6, z);
    return this.ctx.boat.localToWorld(_v, out);
  }

  step(dt: number): void {
    const g = this.grapple;
    if (g.mode === 'sea' && g.seaPhase !== 'air') {
      this.reel += dt;
      const rail = this.railWorld(_v2);
      const to = _v.subVectors(rail, g.wp).setY(0);
      const dist = to.length();
      to.normalize();
      const speed = this.hooked ? 4.5 : 7;
      g.seaPull.set((to.x * speed - g.wv.x) * 8, 0, (to.z * speed - g.wv.z) * 8);
      if (this.hooked && this.hooked.buoy) {
        const b = this.hooked.buoy;
        b.data.anchor = null;
        b.wp.x = g.wp.x;
        b.wp.z = g.wp.z;
        b.wv.copy(g.wv);
      }
      if (dist < 1.2 || this.reel > 6) this.arrive();
    }
    // nobody threw it / it was dropped overboard some other way: return it home
    if (g.mode === 'sea' && !this.thrower && g.seaAge > 4) this.home_();
  }

  private arrive(): void {
    const c = this.thrower;
    const g = this.grapple;
    this.home_();
    if (!c || !c.isUp) return;
    if (this.hooked) {
      const pot = this.hooked;
      // hand the line to the thrower (a coil with the buoy on it)
      const view = makeLineCoil();
      const mini = makeBuoy(undefined, false);
      mini.scale.setScalar(0.8);
      mini.position.set(0, 0.25, 0);
      view.add(mini);
      const it = this.ctx.items.add(LINE_DEF, view, c.holdPoint(new THREE.Vector3()));
      it.data.pot = pot;
      it.data.label = `buoy line #${pot.number}`;
      it.onToSea = () => {
        // dropped the line overboard: the buoy floats again where the pot is
        this.ctx.items.remove(it);
        pot.state = 'soaking';
        if (pot.buoy) this.ctx.items.spawnInSea(pot.buoy, this.ctx.boat.localToWorld(_v.set(-5, 0, 1), new THREE.Vector3()), new THREE.Vector3(), 'float');
      };
      if (pot.buoy) {
        pot.buoy.visible = false;
        pot.buoy.data.anchor = null;
      }
      c.grab(it);
      sfx.play('ropeCreak', { volume: 0.7 });
      events.emit('tutorial', { step: 'haveLine' });
      this.ctx.sys.hud?.toast('Carry the line to the block!', '#f2c230');
    } else {
      // miss: the grapple comes back to your mitten
      const p = c.holdPoint(new THREE.Vector3());
      this.ctx.items.unfix(g);
      g.body?.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      c.grab(g);
    }
    this.hooked = null;
    this.thrower = null;
  }

  private home_(): void {
    this.ctx.items.fix(this.grapple, this.home, this.homeQ);
  }

  render(): void {
    const g = this.grapple;
    const c = this.thrower;
    const show = !!c && g.mode === 'sea';
    this.line.visible = show;
    if (!show || !c) return;
    const a = c.isUp ? c.holdPoint(_v) : _v.set(-3, 1, 1);
    const b = g.renderP;
    const sag = g.seaPhase === 'air' ? 0.3 : 0.6;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      _v2.lerpVectors(a, b, t);
      _v2.y -= Math.sin(t * Math.PI) * sag;
      this.linePos.set([_v2.x, _v2.y, _v2.z], i * 3);
    }
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
