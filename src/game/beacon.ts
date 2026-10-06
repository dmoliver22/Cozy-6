/**
 * The objective beacon: points the player at the next thing to do (the bobbing arrow, ground ring
 * and off-screen edge arrow in render/overlay.ts).
 *
 * Target, in priority order:
 *  - someone overboard: the life ring (orange, "Throw the ring!"); once the player has it, or it
 *    is in the water, the swimmer
 *  - holding a crab: a keeper → the tank hatch; a throw-back → the nearest rail
 *  - holding the bait jar: the pot on the launcher
 *  - while setting pots (the tutorial and the set phases): bait box → pot on the launcher (bait in
 *    hand) → launcher lever, as the cradle pot needs
 *  - hauling: the hauler lever while a pot waits on the block
 * Nothing shows while a rogue warning is up (brace first), on the title backdrop or in first
 * person. Read-only: it never changes game state.
 */
import * as THREE from 'three';
import { config } from '../config';
import { BULWARK_T, L, hullHalfWidth } from '../boat/layout';
import { makeBeacon, type BeaconView } from '../render/overlay';
import type { Game } from './game';
import type { Crew } from '../crew/crew';

const YELLOW = config.palette.slicker;
const ORANGE = config.palette.buoy;
/** the arrow's tip floats this far over the top of its target (metres) */
const LIFT = 1.2;

const _local = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _ground = new THREE.Vector3();
const _v = new THREE.Vector3();

interface Target {
  /** top of the thing (the arrow floats LIFT above it) and the point the ground ring sits on */
  top: THREE.Vector3;
  ground: THREE.Vector3;
  color: number;
  label: string | null;
}

export class ObjectiveBeacon {
  private view: BeaconView;
  private t0 = performance.now() / 1000;
  private tgt: Target = { top: new THREE.Vector3(), ground: new THREE.Vector3(), color: YELLOW, label: null };

  constructor(private game: Game) {
    this.view = makeBeacon(YELLOW);
    this.view.root.visible = false;
    this.view.edge.visible = false;
    game.stage.scene.add(this.view.root, this.view.edge);
    game.stage.onBeforeRender(() => this.update());
  }

  private update(): void {
    const g = this.game;
    const v = this.view;
    const t = this.pick();
    const show = !!t && g.mode === 'sea' && !g.loop.paused && g.rig.blend < 0.5;
    v.root.visible = show;
    if (!show || !t) {
      v.edge.visible = false;
      return;
    }
    v.setColor(t.color);
    v.setLabel(t.label);
    _anchor.copy(t.top).y += LIFT;
    const r = g.stage.renderer;
    v.update(g.stage.camera, _anchor, t.ground, performance.now() / 1000 - this.t0, r.domElement.height, r.getPixelRatio());
  }

  /** boat-local point → world (the boat's render pose) */
  private toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.game.boatGroup.matrixWorld);
  }

  /** a deck target: top at `topY` over (x, z), ring on the deck */
  private deck(x: number, z: number, topY: number, color = YELLOW, label: string | null = null): Target {
    const tg = this.tgt;
    this.toWorld(_local.set(x, topY, z), tg.top);
    this.toWorld(_local.set(x, 0.03, z), tg.ground);
    tg.color = color;
    tg.label = label;
    return tg;
  }

  /** a world target (in the water or loose): the ring sits at its height */
  private world(p: THREE.Vector3, color: number, label: string | null): Target {
    const tg = this.tgt;
    tg.top.copy(p);
    tg.ground.copy(p);
    tg.color = color;
    tg.label = label;
    return tg;
  }

  private pick(): Target | null {
    const g = this.game;
    const player = g.crew.player;
    const held = player.held;

    // 1. someone in the water: the life ring, then the swimmer (in the water yourself: the ring)
    const swimmers = g.crew.overboard();
    if (swimmers.length) {
      const ring = g.rescue.ring;
      const ringInSea = ring.mode === 'sea';
      if (player.inSea) {
        if (!ringInSea || !ring.view) return null;
        ring.view.getWorldPosition(_v);
        return this.world(_v, ORANGE, 'Grab the ring!');
      }
      if (held === ring || ringInSea) {
        const s = this.nearest(swimmers, player);
        s.view.root.getWorldPosition(_v);
        return this.world(_v, ORANGE, held === ring ? 'Throw the ring!' : null);
      }
      if (ring.view) ring.view.getWorldPosition(_v);
      else this.toWorld(ring.localPos(_local), _v);
      this.tgt.top.copy(_v);
      this.toWorld(_local.copy(ring.localPos(_local)).setY(0.03), this.tgt.ground);
      this.tgt.color = ORANGE;
      this.tgt.label = 'Throw the ring!';
      return this.tgt;
    }

    // a rogue warning is up: brace first, no errands
    if (g.trip.hideObjective) return null;

    // 2. carrying something with an obvious destination
    if (held?.kind === 'crab') {
      const keep = !!(held.data.crab as { keep?: boolean } | undefined)?.keep;
      if (keep) return this.deck(L.hatch.center.x, L.hatch.center.z, L.hatch.coaming);
      return this.nearestRail(player);
    }
    const pots = g.pots;
    const cradle = pots.cradlePot;
    const cradleReady = !!cradle && cradle.state === 'cradle' && !cradle.catch;
    if (held?.kind === 'baitJar') return cradleReady && !cradle!.baited ? this.deck(L.potOnCradle.x, L.potOnCradle.z, L.potOnCradle.y + 0.45) : null;
    if (held) return null;

    // 3. setting pots: bait, then launch
    const phase = g.trip.phase;
    const setting = phase === 'tutorial' || phase === 'set1' || phase === 'set2';
    if (setting && cradleReady && pots.settingAllowed) {
      if (phase === 'tutorial' && (g.trip.tutStep === 'buoy' || g.trip.tutStep === 'swell' || g.trip.tutStep === 'done')) return null;
      if (!cradle!.baited) return this.deck(L.baitBox.center.x, L.baitBox.center.z, L.baitBox.half.y * 2);
      return this.deck(L.launcherLever.x, L.launcherLever.z, L.launcherLever.y);
    }

    // 4. hauling: the pot is on the block, waiting for the hauler
    const bp = pots.blockPot;
    if (bp && (bp.state === 'onBlock' || bp.state === 'rising') && !pots.hauling) return this.deck(L.haulerLever.x, L.haulerLever.z, L.haulerLever.y);
    return null;
  }

  private nearest(list: Crew[], from: Crew): Crew {
    let best = list[0],
      bd = Infinity;
    for (const c of list) {
      const d = c.wp.distanceToSquared(from.wp);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** the nearest point on a rail a crab can go over (the starboard rail is open at the launcher) */
  private nearestRail(player: Crew): Target {
    const p = player.renderP;
    let bx = 0,
      bz = 0,
      bd = Infinity;
    for (const side of [1, -1]) {
      const spans: [number, number][] = side > 0 ? [[-4.2, 3.0]] : [[-4.2, -0.2], [2.4, 3.0]];
      for (const [z0, z1] of spans) {
        const z = THREE.MathUtils.clamp(p.z, z0, z1);
        const x = side * (hullHalfWidth(z) - BULWARK_T - 0.1);
        const d = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (d < bd) {
          bd = d;
          bx = x;
          bz = z;
        }
      }
    }
    return this.deck(bx, bz, config.deck.railHeight);
  }
}
