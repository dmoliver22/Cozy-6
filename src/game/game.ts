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
import { Hud } from '../ui/hud';
import { RogueDirector } from '../weather/rogue';
import { DeckWash } from '../deck/wash';
import { RescueSystem } from '../crew/rescue';
import { SprayFx } from '../sea/sprayFx';
import { Feedback } from './feedback';
import { PotSystem } from '../fishing/pots';
import { GrappleSystem } from '../fishing/grapple';
import { SpecialSystem } from '../fishing/specials';
import { Navigator } from '../boat/navigator';
import { schedule } from '../core/schedule';
import type { Ctx } from './ctx';
import type { Crew } from '../crew/crew';
import type { Item } from '../deck/items';
import { clamp } from '../core/math';
import { sfx, music } from '../audio';
import type { RogueSide } from '../core/events';

const _p = new THREE.Vector3();
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
  readonly hud: Hud;
  readonly rogue: RogueDirector;
  readonly wash: DeckWash;
  readonly rescue: RescueSystem;
  readonly spray: SprayFx;
  readonly feedback: Feedback;
  readonly pots: PotSystem;
  readonly grapple: GrappleSystem;
  readonly specials: SpecialSystem;
  readonly nav: Navigator;
  renderTime = 0;
  readonly boatRenderPos = new THREE.Vector3();
  readonly boatRenderQuat = new THREE.Quaternion();
  private loops: Record<string, ReturnType<typeof sfx.loop>> = {};
  paused = false;

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
    this.spray = new SprayFx(this.ctx, config.quality[this.stage.quality].spray);
    this.rogue = new RogueDirector(this.ctx);
    this.wash = new DeckWash(this.ctx);
    this.rescue = new RescueSystem(this.ctx);
    this.pots = new PotSystem(this.ctx);
    this.grapple = new GrappleSystem(this.ctx);
    this.specials = new SpecialSystem(this.ctx);
    this.nav = new Navigator(this.boat);
    this.ctx.sys.nav = this.nav;
    this.ctx.sys.onThrow = (c: Crew, it: Item) => {
      this.rescue.onThrow(c, it);
      this.grapple.onThrow(c, it);
    };

    // aim assist for throws into the sea: the grapple finds a buoy, the ring finds a swimmer
    this.ctx.sys.aimAssist = (it: Item, target: THREE.Vector3): THREE.Vector3 | undefined => {
      const r = config.fishing.aimAssistRadius;
      const cands: THREE.Vector3[] = [];
      if (it.kind === 'grapple') for (const pot of this.pots.soakingPots()) cands.push(this.boat.worldToLocal(pot.buoy!.wp, new THREE.Vector3()));
      if (it.kind === 'ring') for (const c of this.crew.overboard()) cands.push(this.boat.worldToLocal(c.wp, new THREE.Vector3()));
      let best: THREE.Vector3 | undefined;
      let bd = r;
      for (const c of cands) {
        const d = Math.hypot(c.x - target.x, c.z - target.z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    };

    // loose things on deck
    for (const p of L.buckets) items.add(ITEM_DEFS.bucket, makeBucket(), p.clone().setY(0.2));

    // --- input & UI
    this.hud = new Hud(this.ui);
    this.touch = new TouchControls(this.ui);
    this.player = new PlayerController(this.stage.renderer.domElement, this.ctx, this.rig, this.stage.camera, {
      toggleView: () => this.rig.toggle(),
      ping: () => {},
      pause: () => {},
      zoom: (d) => (this.rig.zoom = clamp(this.rig.zoom + d * 0.08, 0, 1)),
    });
    this.player.touch = this.touch;
    this.aim = new AimViz(this.boatGroup);
    this.ctx.sys.hud = this.hud;
    this.loop = new FixedLoop({
      step: (dt) => this.step(dt),
      render: (alpha, dtReal, dtSim) => this.render(alpha, dtReal, dtSim),
    });
    this.feedback = new Feedback(this.ctx, this.hud, this.rig, this.crew, this.loop);

    this.boat.targetSpeed = config.boat.speed.set;

    // audio unlock on any gesture
    const unlock = () => sfx.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, unlock, { passive: true });
    this.loops.sea = sfx.loop('sea', { volume: 0.7 });
    this.loops.engine = sfx.loop('engine', { volume: 0.5 });
    this.loops.wind = sfx.loop('wind', { volume: 0.2 });
    this.loops.hull = sfx.loop('hull', { volume: 0.4 });
    this.loops.deckWater = sfx.loop('deckWater', { volume: 0 });
    music.setMood('sea');
    music.start();

    this.setupDebugKeys();
  }

  start(): void {
    this.loop.start();
  }

  step(dt: number): void {
    const ctx = this.ctx;
    this.sea.time += dt;
    schedule.step(dt);
    this.rogue.step(dt);
    this.nav.step(dt);
    this.boat.step(dt, this.sea);
    this.crew.step(dt);
    this.rescue.step(dt);
    this.grapple.step(dt);
    this.pots.step(dt);
    this.ctx.items.stepPre(dt);
    this.crabs.step(dt);
    this.specials.step(dt);
    this.wash.step(dt);
    this.spray.step(dt);
    this.ctx.surface.step(dt, this.dw.gDir);
    this.dw.step(dt, this.boat);
    this.ctx.items.stepPost(dt);
    this.pots.capture();
    this.crew.postStep(dt);
    ctx.time += dt;
  }

  render(alpha: number, dtReal: number, dtSim: number): void {
    this.debug.tick(dtReal);
    this.feedback.update(dtReal);
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
    this.rescue.render(this.boatRenderPos, this.boatRenderQuat);
    this.pots.render(alpha, this.boatRenderPos, this.boatRenderQuat);
    this.grapple.render();
    this.wash.render(this.ctx.time);
    this.spray.update(dtSim);

    // aim visuals
    const inp = player.input;
    const holding = player.held;
    if (player.throwAiming && holding && inp.aim) {
      holding.localPos(_v);
      const assisted = this.ctx.sys.aimAssist(holding, inp.aim) as THREE.Vector3 | undefined;
      this.aim.showArc(_v, assisted ?? inp.aim, this.dw.gLocal);
    } else this.aim.showArc(null, null, this.dw.gLocal);
    this.aim.setReticle(inp.aim, this.rig.mode === 'overhead' && this.player.lastDevice === 'mouse');
    const tgt = player.target;
    this.aim.setHighlight(tgt && tgt.name !== 'rope' ? tgt.pos(_v2) : null, this.ctx.time);
    this.updatePrompt();

    // camera
    player.view.root.getWorldPosition(_p);
    if (player.inSea) _p.copy(player.wp);
    const head = player.inSea ? _v.copy(player.wp).setY(player.wp.y + 1.5) : player.head(_v).applyMatrix4(this.boatGroup.matrixWorld);
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
    this.spray.setPixelScale(window.innerHeight * this.stage.renderer.getPixelRatio());

    // HUD
    this.hud.setWave(this.rogue.hudState(), player.braced || player.crouch);
    const inds = this.crew.overboard().map((c) => ({ world: c.wp.clone().setY(c.wp.y + 1.2), icon: '🛟', color: '#e8742b', label: c.id === 'player' ? 'You' : c.name }));
    for (const pot of this.pots.soakingPots()) {
      const b = pot.buoy!;
      if (b.mode === 'sea' && b.visible) inds.push({ world: b.wp.clone().setY(b.wp.y + 2.2), icon: '🟠', color: '#f2c230', label: String(pot.number) });
    }
    const hang = this.pots.hangingPot;
    this.hud.setLevel(!!hang, this.pots.deckLevelDeg(), config.fishing.levelWindowDeg);
    this.hud.setIndicators(inds, this.stage.camera);
    this.hud.update(dtReal, this.stage.camera, this.boatGroup.matrixWorld);
    this.updateAudio();

    this.stage.render();

    const bc = this.dw.countBodies();
    const r = this.rogue.current;
    this.debug.update({
      fps: this.debug.fps,
      frameMs: this.debug.frameMs,
      bodies: bc.total,
      awake: bc.awake,
      wave: `swell ${this.sea.swell.toFixed(2)}${r ? ` · rogue ${r.side} amp ${r.amp.toFixed(1)} stage ${r.stage} in ${(r.tImpact - this.ctx.time).toFixed(1)}s` : ''}`,
      gLocal: this.dw.gLocal,
      roll: this.boat.rollDeg,
      pitch: this.boat.pitchDeg,
      quality: this.stage.quality,
      extra: `player ${player.state}${player.braced ? ' braced' : ''}${player.sliding ? ' sliding' : ''} slope ${this.dw.slopeDeg.toFixed(1)}° water ${this.ctx.surface.water.toFixed(2)}`,
    });
  }

  private updateAudio(): void {
    const sw = this.sea.swell;
    this.loops.sea?.setPitch(0.6 + sw * 0.8, 0.5);
    this.loops.sea?.setVolume(0.55 + sw * 0.4, 0.5);
    this.loops.engine?.setPitch(0.8 + Math.abs(this.boat.speed) / 5, 0.3);
    this.loops.hull?.setVolume(0.25 + sw * 0.7, 0.5);
    this.loops.deckWater?.setVolume(clamp(this.ctx.surface.water * 6, 0, 1), 0.2);
  }

  private updatePrompt(): void {
    const p = this.crew.player;
    const v = p.targetVerbs[0];
    let text = '';
    const touch = this.player.lastDevice === 'touch';
    const pad = this.player.lastDevice === 'pad';
    const key = (b: string) => (pad ? (b === 'interact' ? 'X' : 'A') : b === 'interact' ? 'E' : 'LMB');
    if (p.inSea) {
      text = p.onRing ? 'Hang on to the ring!' : touch ? 'Swim with the stick — wave for the ring!' : 'Swim (WASD) — wait for the ring!';
    } else if (p.held) {
      const canThrow = p.held.def.carry !== 'push';
      text = `${p.held.def.icon} ${p.held.data.label ?? p.held.def.label}` + (canThrow ? (touch ? ' · drag Action to throw' : pad ? ' · hold RT to throw' : ' · hold RMB, release to throw') : '');
      if (v) text = `${v.icon} ${v.label}` + (touch ? '' : ` [${key(v.button === 'interact' ? 'interact' : 'use')}]`) + ' · ' + text;
    } else if (v) {
      text = `${v.icon} ${v.label}` + (touch ? '' : ` [${key(v.button === 'interact' ? 'interact' : 'use')}]`);
    }
    const el = this.hud.promptEl;
    if (el.textContent !== text) el.textContent = text;
    el.style.opacity = text ? '1' : '0';
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

  /** Debug / test hooks (also used by the headless probes). */
  triggerRogue(side: RogueSide = 'starboard', amp = 2.6, lead?: number): void {
    this.rogue.schedule(side, amp, { lead });
  }

  private setupDebugKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.debug.visible) return;
      if (e.code === 'KeyR') this.triggerRogue((['port', 'starboard', 'bow'] as RogueSide[])[Math.floor(Math.random() * 3)], 2.6);
      if (e.code === 'KeyO') this.crew.get('ike').goOverboard();
      if (e.code === 'KeyK') this.crew.get('ike').knockdown(new THREE.Vector3(3, 1, 0), 'debug');
      if (e.code === 'BracketRight') this.sea.swell = Math.min(1.2, this.sea.swell + 0.1);
      if (e.code === 'BracketLeft') this.sea.swell = Math.max(0, this.sea.swell - 0.1);
    });
  }
}
