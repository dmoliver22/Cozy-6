/**
 * Game orchestrator: owns the stage, the simulation systems and the per-frame wiring.
 */
import * as THREE from 'three';
import { config } from '../config';
import { Stage } from './stage';
import { Sea } from '../sea/waves';
import { Boat } from '../boat/boat';
import { makeBoat, type BoatArt } from '../art/boat';
import { CameraRig } from '../camera/cameraRig';
import { DebugOverlay } from '../ui/debug';
import { FixedLoop } from '../core/loop';
import { RngHub } from '../core/rng';
import { DeckWorld } from '../deck/deckWorld';
import { buildDeckStructure } from '../deck/structure';
import { DeckSurface } from '../deck/surface';
import { ItemManager, ITEM_DEFS } from '../deck/items';
import { Interactions } from '../deck/interact';
import { registerItemInteractables } from '../deck/itemInteract';
import { braceSegments, L } from '../boat/layout';
import { CrewManager } from '../crew/crewManager';
import { PlayerController } from '../input/player';
import { CrabSystem } from '../fishing/crabs';
import { makeBucket } from '../art/items';
import { AimViz } from '../ui/aimViz';
import { TouchControls } from '../ui/touch';
import type { Ctx } from './ctx';
import { clamp } from '../core/math';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Game {
  readonly stage: Stage;
  readonly sea = new Sea();
  readonly boat = new Boat();
  readonly boatGroup = new THREE.Group();
  readonly boatArt: BoatArt;
  readonly rig: CameraRig;
  readonly debug: DebugOverlay;
  readonly loop: FixedLoop;
  readonly ui: HTMLDivElement;
  readonly ctx: Ctx;
  readonly dw: DeckWorld;
  readonly crew: CrewManager;
  readonly player: PlayerController;
  readonly crabs: CrabSystem;
  readonly aim: AimViz;
  readonly touch: TouchControls;
  renderTime = 0;
  readonly boatRenderPos = new THREE.Vector3();
  readonly boatRenderQuat = new THREE.Quaternion();
  promptEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.ui = document.createElement('div');
    this.ui.id = 'ui';
    container.appendChild(this.ui);
    this.debug = new DebugOverlay(container);
    this.rig = new CameraRig(this.stage.camera);

    this.boatArt = makeBoat();
    this.boatGroup.add(this.boatArt.root);
    this.stage.scene.add(this.boatGroup);

    // --- deck-local physics
    this.dw = new DeckWorld();
    const structure = buildDeckStructure(this.dw);
    const surface = new DeckSurface(structure);
    const items = new ItemManager(this.dw, this.boat, this.sea, this.boatGroup);
    const interact = new Interactions();
    this.ctx = {
      boat: this.boat,
      sea: this.sea,
      dw: this.dw,
      structure,
      surface,
      items,
      interact,
      boatGroup: this.boatGroup,
      scene: this.stage.scene,
      boatArt: this.boatArt,
      rng: new RngHub(config.seed),
      braceSegs: braceSegments(),
      time: 0,
      upgrades: new Set(),
      buffs: new Set(),
      sys: {},
    };
    this.crew = new CrewManager(this.ctx);
    registerItemInteractables(items, interact, () => this.crew);
    this.crabs = new CrabSystem(this.ctx);

    // loose things on deck
    for (const p of L.buckets) items.add(ITEM_DEFS.bucket, makeBucket(), p.clone().setY(0.2));
    const rng = this.ctx.rng.stream('test');
    for (let i = 0; i < 4; i++) {
      this.crabs.spawn(new THREE.Vector3(-0.4 + i * 0.25, 1.1, 0.8), this.crabs.roll(rng.pick(['red', 'red', 'snow', 'blue'] as const), rng));
    }

    // --- input
    this.touch = new TouchControls(this.ui);
    this.player = new PlayerController(this.stage.renderer.domElement, this.ctx, this.rig, this.stage.camera, {
      toggleView: () => this.rig.toggle(),
      ping: () => {},
      pause: () => {},
      zoom: (d) => (this.rig.zoom = clamp(this.rig.zoom + d * 0.08, 0, 1)),
    });
    this.player.touch = this.touch;
    this.aim = new AimViz(this.boatGroup);

    this.promptEl = document.createElement('div');
    this.promptEl.className = 'prompt';
    this.ui.appendChild(this.promptEl);

    this.boat.targetSpeed = config.boat.speed.set;

    this.loop = new FixedLoop({
      step: (dt) => this.step(dt),
      render: (alpha, dtReal, dtSim) => this.render(alpha, dtReal, dtSim),
    });
  }

  start(): void {
    this.loop.start();
  }

  step(dt: number): void {
    const ctx = this.ctx;
    this.sea.time += dt;
    this.boat.step(dt, this.sea);
    this.crew.step(dt);
    this.ctx.items.stepPre(dt);
    this.crabs.step(dt);
    this.ctx.surface.step(dt, this.dw.gDir);
    this.dw.step(dt, this.boat);
    this.ctx.items.stepPost(dt);
    this.crew.postStep(dt);
    ctx.time += dt;
  }

  render(alpha: number, dtReal: number, dtSim: number): void {
    this.debug.tick(dtReal);
    const player = this.crew.player;
    this.player.update(dtReal, player);

    this.renderTime = this.sea.time - (1 - alpha) * this.loop.dt;
    this.boat.renderTransform(alpha, this.boatRenderPos, this.boatRenderQuat);
    this.boatGroup.position.copy(this.boatRenderPos);
    this.boatGroup.quaternion.copy(this.boatRenderQuat);
    this.boatGroup.updateMatrixWorld(true);
    _m.copy(this.boatGroup.matrixWorld).invert();

    this.ctx.items.render(alpha, this.boatRenderPos, this.boatRenderQuat);
    this.crabs.render();
    this.crew.render(alpha, dtReal, this.boatRenderPos, this.boatRenderQuat);

    // aim visuals
    const inp = player.input;
    const holding = player.held;
    if (player.throwAiming && holding && inp.aim) {
      holding.localPos(_v);
      this.aim.showArc(_v, inp.aim, this.dw.gLocal);
    } else this.aim.showArc(null, null, this.dw.gLocal);
    this.aim.setReticle(inp.aim, this.rig.mode === 'overhead' && this.player.lastDevice === 'mouse');
    const tgt = player.target;
    this.aim.setHighlight(tgt ? tgt.pos(_v2) : null, this.ctx.time);
    this.updatePrompt();

    // camera
    player.view.root.getWorldPosition(_p);
    const head = player.head(_v);
    head.applyMatrix4(this.boatGroup.matrixWorld);
    this.rig.update({
      dt: dtReal,
      boatPos: this.boatRenderPos,
      boatQuat: this.boatRenderQuat,
      boatYaw: this.boat.yaw,
      boatPitch: this.boat.pitch.x,
      boatRoll: this.boat.roll.x,
      focusWorld: _p,
      headWorld: head,
      portrait: this.stage.portrait,
      rollFactor: config.camera.fp.rollFactor,
      headBob: true,
      walkPhase: player.walkPhase,
      walkAmount: player.walkAmount,
    });
    player.view.root.visible = this.rig.blend < 0.6;
    this.stage.fpMode = this.rig.blend;
    this.stage.seaMesh.update(this.sea, this.renderTime, this.boatRenderPos, _m, this.boat.speed);
    this.stage.setWeatherLook(0, this.boatRenderPos);
    this.stage.render();

    const bc = this.dw.countBodies();
    this.debug.update({
      fps: this.debug.fps,
      frameMs: this.debug.frameMs,
      bodies: bc.total,
      awake: bc.awake,
      wave: `swell ${this.sea.swell.toFixed(2)}`,
      gLocal: this.dw.gLocal,
      roll: this.boat.rollDeg,
      pitch: this.boat.pitchDeg,
      quality: this.stage.quality,
      extra: `player ${player.state}${player.braced ? ' braced' : ''}${player.sliding ? ' sliding' : ''} grip ${this.ctx.surface.grip(player.pos(_v).x, _v.z, player.insideHouse).toFixed(2)}`,
    });
  }

  private updatePrompt(): void {
    const p = this.crew.player;
    const v = p.targetVerbs[0];
    let text = '';
    const touch = this.player.lastDevice === 'touch';
    const pad = this.player.lastDevice === 'pad';
    const key = (b: string) => (pad ? (b === 'interact' ? 'X' : 'A') : b === 'interact' ? 'E' : 'LMB');
    if (p.held) {
      const canThrow = p.held.def.carry !== 'push';
      text = `${p.held.def.icon} ${p.held.def.label}` + (canThrow ? (touch ? ' · drag Action to throw' : pad ? ' · hold RT to throw' : ' · hold RMB to aim, release to throw') : '');
      if (v) text = `${v.icon} ${v.label}` + (touch ? '' : ` [${key(v.button === 'interact' ? 'interact' : 'use')}]`) + ' · ' + text;
    } else if (v) {
      text = `${v.icon} ${v.label}` + (touch ? '' : ` [${key(v.button === 'interact' ? 'interact' : 'use')}]`);
    }
    if (this.promptEl.textContent !== text) this.promptEl.textContent = text;
    this.promptEl.style.opacity = text ? '1' : '0';
    if (touch) {
      this.touch.setAction({
        icon: v ? v.icon : p.held ? '⤵' : '✋',
        label: v ? v.label : p.held ? 'Drop' : '',
        tapIsInteract: !!v && v.button === 'interact',
        canThrow: !!p.held,
        holding: !!p.held,
      });
    }
  }
}
