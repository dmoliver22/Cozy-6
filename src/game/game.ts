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
import { braceSegments, L, insideHouse } from '../boat/layout';
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
import type { CrewManager as CrewManagerT } from '../crew/crewManager';
import type { Item } from '../deck/items';
import { clamp } from '../core/math';
import { sfx, music } from '../audio';
import type { RogueSide } from '../core/events';
import { loadSettings, saveSettings, type Settings } from '../core/settings';
import { PauseMenu } from '../ui/menu';
import { FpHands } from '../ui/fpHands';
import { haptics } from '../core/haptics';
import type { Quality } from './stage';
import { BotSystem } from '../crew/bots';
import { Helm } from '../crew/helm';
import { Cat } from '../crew/cat';
import { Trip } from './trip';
import { makeBuoy } from '../art/items';
import { WeatherDirector } from '../weather/director';
import { Snow } from '../weather/snow';
import { IceSystem } from '../weather/ice';
import type { CrewId } from '../crew/crew';
import { PhotoDirector } from '../photo/photos';
import { loadSave, writeSave, type SaveData } from '../core/save';
import { Harbor } from '../harbor/harbor';
import { Galley } from '../galley/galley';
import { CREW_LOOKS } from '../art/crew';
import { toonUnique } from '../art/materials';
import { hullHalfWidth, BULWARK_T } from '../boat/layout';

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
  readonly bots: BotSystem;
  readonly helm: Helm;
  readonly cat: Cat;
  readonly trip: Trip;
  readonly weather: WeatherDirector;
  readonly snow: Snow;
  readonly ice: IceSystem;
  private pingWho: CrewId | null = null;
  private cutaway = 1;
  readonly save: SaveData;
  readonly photos: PhotoDirector;
  mode: 'sea' | 'harbor' | 'galley' = 'sea';
  private harbor: Harbor | null = null;
  private galley: Galley | null = null;
  private container: HTMLElement;
  renderTime = 0;
  readonly boatRenderPos = new THREE.Vector3();
  readonly boatRenderQuat = new THREE.Quaternion();
  private loops: Record<string, ReturnType<typeof sfx.loop>> = {};
  readonly settings: Settings;
  readonly menu: PauseMenu;
  readonly hands: FpHands;
  private reticle: HTMLDivElement;
  private rotateHint: HTMLDivElement;
  private frameTimes: number[] = [];
  private qualityCooldown = 5;

  constructor(container: HTMLElement) {
    this.container = container;
    this.save = loadSave();
    // the player's look carries over between trips
    CREW_LOOKS.player.hatColor = this.save.hatColor;
    if (this.save.finds.boot) CREW_LOOKS.player.boots = 0x7d9a3a;
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
    // the pile of spare buoys against the port rail (Ike's landing pad): six on the deck and two
    // in the hollows on top, packed against the rail clear of Dot (who starts next to it) and the
    // crate. Balls roll apart on any tilt, so the pile is held still (all axes locked) until it's
    // really disturbed — a tumbling body (Ike's slide in the tutorial), a thrown or sliding
    // thing, someone running into it or picking a buoy off it; a crew member just brushing past
    // doesn't count. From then on it's ordinary physics. Outside the tutorial, rough weather
    // shakes it loose too.
    {
      const pile: Item[] = [];
      const base = new THREE.Vector3(2.45, 0, 0.55);
      const at = (dx: number, y: number, dz: number) => pile.push(items.add(ITEM_DEFS.buoy, makeBuoy(), base.clone().add(new THREE.Vector3(dx, y, dz))));
      for (const dx of [0.29, -0.29]) for (const dz of [-0.58, 0, 0.58]) at(dx, 0.285, dz);
      for (const dz of [-0.29, 0.29]) at(0, 0.67, dz);
      const hold = (on: boolean) => {
        for (const it of pile) {
          it.body?.lockTranslations(on, true);
          it.body?.lockRotations(on, true);
        }
      };
      hold(true);
      const mine = new Set(pile.map((it) => it.body?.handle));
      this.dw.preStep.push(() => {
        if (!pile.length) return;
        let go = (this.trip?.phase !== 'tutorial' && this.dw.slopeDeg > 9) || pile.some((it) => it.heldBy);
        const world = this.dw.world;
        for (const it of pile) {
          if (go || !it.collider) break;
          world.contactPairsWith(it.collider, (other) => {
            const b = other.parent();
            if (go || !b || !b.isDynamic() || mine.has(b.handle)) return;
            const own = this.dw.ownerOf(other);
            const v = b.linvel();
            const speed = Math.hypot(v.x, v.y, v.z);
            const standing = own?.kind === 'crew' && (own.crew as Crew).state === 'stand';
            if (standing ? speed < 3.5 : speed < 0.4) return;
            world.contactPair(it.collider!, other, (m) => {
              if (m.numContacts() > 0) go = true;
            });
          });
        }
        if (!go) return;
        hold(false);
        pile.length = 0;
      });
    }
    this.weather = new WeatherDirector(this.ctx);
    this.ice = new IceSystem(this.ctx);
    this.snow = new Snow(this.stage.scene, config.quality[this.stage.quality].snow);
    this.ctx.sys.weatherFx = { setQuality: (q: Quality) => this.snow.setCount(config.quality[q].snow) };
    this.helm = new Helm(this.ctx);
    this.bots = new BotSystem(this.ctx);
    this.cat = new Cat(this.ctx);
    this.ctx.sys.ping = (p: THREE.Vector3 | null) => this.doPing(p, null);
    // Mo starts at the wheel
    const mo = this.crew.get('mo');
    mo.atHelm = true;
    this.helm.holder = mo;

    // --- input & UI
    this.hud = new Hud(this.ui);
    this.touch = new TouchControls(this.ui);
    this.player = new PlayerController(this.stage.renderer.domElement, this.ctx, this.rig, this.stage.camera, {
      toggleView: () => this.toggleView(),
      ping: (p) => this.ctx.sys.ping?.(p),
      pause: () => this.menu.toggle(),
      zoom: (d) => (this.rig.zoom = clamp(this.rig.zoom + d * 0.08, 0, 1)),
    });
    this.player.touch = this.touch;
    if (this.touch.active) this.player.lastDevice = 'touch';
    this.aim = new AimViz(this.boatGroup);
    this.ctx.sys.hud = this.hud;
    this.stage.scene.add(this.stage.camera); // so first-person mittens (camera children) render
    this.hands = new FpHands(this.stage.camera);
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.ui.appendChild(this.reticle);
    this.rotateHint = document.createElement('div');
    this.rotateHint.className = 'rotate-hint';
    this.rotateHint.textContent = '↻ Turn your phone sideways for first person';
    this.ui.appendChild(this.rotateHint);
    this.settings = loadSettings();
    this.menu = new PauseMenu(this.ui, this.settings, {
      onChange: (st) => this.applySettings(st),
      onResume: () => (this.loop.paused = false),
      onHarbor: () => this.ctx.sys.trip?.runForHome?.(),
    });
    const origShow = this.menu.show.bind(this.menu);
    this.menu.show = () => {
      origShow();
      this.loop.paused = true;
    };
    this.loop = new FixedLoop({
      step: (dt) => this.step(dt),
      render: (alpha, dtReal, dtSim) => this.render(alpha, dtReal, dtSim),
    });
    this.feedback = new Feedback(this.ctx, this.hud, this.rig, this.crew, this.loop);

    this.trip = new Trip(this.ctx, this.ui);
    this.trip.onEnd = () => this.endTrip();
    // photos are shot right after a frame is drawn (scene matches the screen) and graded by the post pipeline
    this.photos = new PhotoDirector(this.ctx, this.stage, () => this.hud.flash('rgba(255,255,255,.9)'));
    this.applyProgress();

    // audio unlock on gestures that count as user activation (pointerdown doesn't for touch, and
    // an AudioContext started there only logs "not allowed to start" warnings)
    const unlock = () => sfx.unlock();
    for (const ev of ['click', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
    this.loops.sea = sfx.loop('sea', { volume: 0.7 });
    this.loops.engine = sfx.loop('engine', { volume: 0.5 });
    this.loops.wind = sfx.loop('wind', { volume: 0.2 });
    this.loops.hull = sfx.loop('hull', { volume: 0.4 });
    this.loops.deckWater = sfx.loop('deckWater', { volume: 0 });
    music.setMood('sea');
    music.start();

    this.setupDebugKeys();
    this.applySettings(this.settings);
    // portraits: tap one, then tap a spot to send that bot
    this.hud.onPortraitTap = (id) => {
      this.pingWho = this.pingWho === id ? null : (id as CrewId);
      this.hud.selectPortrait(this.pingWho);
      if (this.pingWho) this.hud.toast(`Tap a spot or a job for ${this.crew.get(this.pingWho).name}`, '#f2c230', 2);
    };
    this.stage.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (!this.pingWho) return;
      const nd = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(nd, this.stage.camera);
      const lp = new THREE.Vector3();
      if (this.player.pointerToLocal(rc.ray, lp)) this.doPing(lp, this.pingWho, e.clientX, e.clientY);
      this.pingWho = null;
      this.hud.selectPortrait(null);
    });
    if (this.stage.isPhone) this.rig.zoom = 0.5;
  }

  /** Owned upgrades and the potluck buff from the last trip. */
  private applyProgress(): void {
    const up = new Set(this.save.upgrades);
    for (const u of up) this.ctx.upgrades.add(u);
    this.rogue.radarBonus = up.has('betterRadar') ? config.telegraph.radarBonusSec : 0;
    if (up.has('catHammock')) this.cat.setHammock(true);
    if (up.has('railNets')) this.addRailNets();
    if (this.save.buff === 'warmBellies') {
      this.ctx.buffs.add('warmBellies');
      this.save.buff = null;
    }
  }

  private addRailNets(): void {
    const mat = toonUnique(0x2b6f6a, { transparent: true, opacity: 0.55 });
    for (const side of [1, -1]) {
      for (let z = -4.2; z < 3; z += 1.2) {
        if (side < 0 && z > -0.2 && z < 2.2) continue;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.5), mat);
        m.position.set(side * (hullHalfWidth(z + 0.6) - BULWARK_T / 2), 1.32, z + 0.6);
        m.rotation.y = Math.PI / 2;
        this.boatGroup.add(m);
      }
    }
  }

  /** Begin the trip (after the title / chart). */
  beginTrip(skipTutorial: boolean): void {
    this.loop.paused = false;
    this.hud.setVisible(true);
    this.touch.setVisible(true);
    this.trip.start(skipTutorial);
  }

  private endTrip(): void {
    if (this.mode !== 'sea') return;
    const crabs = this.crabs;
    // finds from the curio crate
    const curios = this.specials.curios;
    const newFinds = {
      bottle: curios.some((c) => c.kind === 'bottle' && c.outcome === 'crate'),
      boot: curios.some((c) => c.kind === 'boot' && c.outcome === 'crate'),
      bell: curios.some((c) => c.kind === 'bell' && c.outcome === 'crate'),
    };
    this.save.finds.boot ||= newFinds.boot;
    this.save.finds.bell ||= newFinds.bell;
    this.loop.paused = true;
    this.fade(() => {
      this.mode = 'harbor';
      this.hud.setVisible(false);
      this.touch.setVisible(false);
      this.ui.style.display = 'none';
      this.harbor = new Harbor(this.container, this.save, crabs.tank, this.ctx.time, { boot: this.save.finds.boot, bell: this.save.finds.bell });
      this.harbor.onDone = () =>
        this.fade(() => {
          const a = this.harbor!.appraisal;
          this.save.tripsCompleted++;
          this.save.photos = this.photos.photos.slice(0, config.photo.max);
          if (newFinds.bottle) this.save.finds.lore.push(this.save.tripsCompleted);
          this.save.lastTrip = { earnings: a.total, kg: a.kg, crabs: a.crabs, golden: a.golden, overboards: this.trip.stats.overboards, allHeld: this.trip.stats.allHeld, date: new Date().toISOString() };
          writeSave(this.save);
          this.mode = 'galley';
          this.galley = new Galley(this.container, this.save, this.photos.photos, a, { overboards: this.trip.stats.overboards, allHeld: this.trip.stats.allHeld }, newFinds);
          this.galley.onNext = () => {
            writeSave(this.save);
            this.fade(() => location.reload());
          };
        });
    });
  }

  /** Fade to warm black and back. */
  private fade(mid: () => void): void {
    let el = document.getElementById('fade');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fade';
      this.container.appendChild(el);
    }
    el.classList.add('on');
    setTimeout(() => {
      mid();
      setTimeout(() => el!.classList.remove('on'), 120);
    }, 650);
  }

  applySettings(st: Settings): void {
    saveSettings(st);
    haptics.enabled = st.haptics;
    sfx.setMaster(st.volume);
    sfx.setMusicVolume(st.music);
    this.player.invertLook = st.invertLook;
    this.hud.reduceFlashing = st.reduceFlashing;
    this.rig.reduceFlashing = st.reduceFlashing;
    if (st.quality !== 'auto' && st.quality !== this.stage.quality) this.setQuality(st.quality);
  }

  setQuality(q: Quality): void {
    this.stage.applyQuality(q);
    this.ctx.sys.weatherFx?.setQuality?.(q);
  }

  toggleView(): void {
    if (this.rig.mode === 'overhead' && this.stage.isPhone && this.stage.portrait) {
      this.rotateHint.classList.add('on');
      setTimeout(() => this.rotateHint.classList.remove('on'), 1800);
      return;
    }
    this.rig.toggle();
    if (this.rig.mode === 'overhead') this.player.mouse.exitLock();
    sfx.play('uiTap', { volume: 0.5 });
  }

  /** Auto quality: drop a tier if frames stay slow, creep back up if there's headroom. */
  private autoQuality(dtReal: number): void {
    if (this.settings.quality !== 'auto') return;
    this.frameTimes.push(dtReal * 1000);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.qualityCooldown -= dtReal;
    if (this.qualityCooldown > 0 || this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const order: Quality[] = ['low', 'medium', 'high'];
    const i = order.indexOf(this.stage.quality);
    if (avg > config.render.autoDowngradeMs && i > 0) {
      this.setQuality(order[i - 1]);
      this.qualityCooldown = config.render.autoDowngradeWindowSec * 2;
      this.frameTimes.length = 0;
    } else if (avg < config.render.autoUpgradeMs && i < (this.stage.isPhone ? 1 : 2)) {
      // phones may climb to Medium when there's plenty of headroom, never to High
      this.setQuality(order[i + 1]);
      this.qualityCooldown = 20;
      this.frameTimes.length = 0;
    }
  }

  start(): void {
    this.loop.start();
  }

  step(dt: number): void {
    const ctx = this.ctx;
    this.sea.time += dt;
    schedule.step(dt);
    this.weather.step(dt);
    this.rogue.step(dt);
    this.nav.step(dt);
    this.boat.step(dt, this.sea);
    this.trip.step(dt);
    this.helm.step();
    this.bots.step(dt);
    this.crew.step(dt);
    this.cat.step(dt);
    this.rescue.step(dt);
    this.grapple.step(dt);
    this.pots.step(dt);
    this.ctx.items.stepPre(dt);
    this.crabs.step(dt);
    this.specials.step(dt);
    this.ice.step(dt);
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
    if (this.mode === 'harbor' && this.harbor) {
      this.harbor.update(dtReal, this.stage.renderer, (s, c, look) => this.stage.renderView(s, c, look, { focusY: 0.52, focusHalf: 0.26 }));
      return;
    }
    if (this.mode === 'galley' && this.galley) {
      this.galley.update(dtReal, this.stage.renderer, (s, c, look) => this.stage.renderView(s, c, look, { focusY: 0.45, focusHalf: 0.26 }));
      return;
    }
    this.feedback.update(dtReal);
    if (!this.loop.paused) this.autoQuality(dtReal);
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
    this.cat.render(dtReal);
    this.updateCutaway(dtReal);
    this.ice.render();
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
      rollFactor: this.settings.comfortRoll,
      headBob: this.settings.headBob,
      walkPhase: player.walkPhase,
      walkAmount: player.walkAmount,
    });
    player.view.root.visible = this.rig.blend < 0.6;
    player.view.ring.visible = player.view.ring.visible && this.rig.blend < 0.6;
    this.stage.camera.updateMatrixWorld(true);
    this.hands.update(dtReal, this.stage.camera, player, this.boatGroup.matrixWorld, this.rig.blend, this.ctx.time);
    this.reticle.classList.toggle('on', this.rig.blend > 0.9 && !player.inSea);
    this.reticle.classList.toggle('hot', !!player.target);
    if (this.rig.mode === 'fp' && this.stage.isPhone && this.stage.portrait) this.rig.setMode('overhead');
    this.stage.fpMode = this.rig.blend;
    this.stage.seaMesh.update(this.sea, this.renderTime, this.boatRenderPos, _m, this.boat.speed);
    this.stage.setWeatherLook(this.weather.storm, this.boatRenderPos, this.rig.overheadYaw, this.boatRenderQuat);
    this.stage.focusPoints = this.crew.overboard().map((c) => c.wp); // keep swimmers out of the tilt-shift blur
    this.snow.update(this.renderTime, this.stage.camera.position, this.weather.windDir, this.weather.wind, this.weather.snow, window.innerHeight * this.stage.renderer.getPixelRatio(), this.rig.blend);
    this.spray.setPixelScale(window.innerHeight * this.stage.renderer.getPixelRatio());

    // HUD
    const ws = this.rogue.hudState();
    this.hud.setWave(ws, player.braced || player.crouch);
    this.trip.hideObjective = !!ws;
    const inds = this.crew.overboard().map((c) => ({ world: c.wp.clone().setY(c.wp.y + 1.2), icon: '🛟', color: '#e8742b', label: c.id === 'player' ? 'You' : c.name }));
    for (const pot of this.pots.soakingPots()) {
      const b = pot.buoy!;
      const isTarget = this.trip.haulTarget() === pot;
      if (b.mode === 'sea' && b.visible && (isTarget || this.trip.phase.startsWith('haul') || this.trip.phase.startsWith('transit1'))) inds.push({ world: b.wp.clone().setY(b.wp.y + 2.2), icon: isTarget ? '🎯' : '🟠', color: isTarget ? '#58c46a' : 'rgba(242,194,48,.6)', label: String(pot.number) });
    }
    {
      const tank = this.crabs.tank;
      const cap = this.crabs.capacity;
      const kg = tank.reduce((a, e) => a + (e.correct ? e.weight : 0), 0);
      const gold = tank.filter((e) => e.species === 'golden').length;
      const full = tank.length >= cap;
      this.hud.setTrip(
        `🦀 <b class="${full ? 'full' : ''}">${tank.length}</b>/${cap}${full ? ' <span class="full">full!</span>' : ''} · ${kg.toFixed(1)} kg${gold ? ` · <span class="gold">✨${gold}</span>` : ''}`,
      );
    }
    const hang = this.pots.hangingPot;
    this.hud.setLevel(!!hang, this.pots.deckLevelDeg(), config.fishing.levelWindowDeg);
    this.hud.setIndicators(inds, this.stage.camera);
    this.hud.update(dtReal, this.stage.camera, this.boatGroup.matrixWorld);
    const statusIcon = (c: ReturnType<CrewManagerT['get']>) => {
      if (c.inSea) return '🛟';
      if (c.state === 'down') return '💫';
      if (c.braced) return '🤲';
      if (c.atHelm) return '☸️';
      const t = this.bots.brainOf(c)?.status ?? '';
      return ({ brace: '🤲', rescue: '🛟', ping: '📍', 'clip line': '🪝', tip: '🦀', launch: '🚀', haul: '⚙️', 'land pot': '🧺', rehook: '🪝', grapple: '🪝', bait: '🫙', sort: '🦀', 'get hat': '🧢', 'chip ice': '🔨', 'cat inside': '🐈', 'coil line': '🪢', idle: '☕', helm: '☸️' } as Record<string, string>)[t] ?? '';
    };
    this.hud.setPortraits(
      (['mo', 'dot', 'ike'] as CrewId[]).map((id) => {
        const c = this.crew.get(id);
        return { id, name: c.name, color: id === 'mo' ? '#d9c27a' : id === 'dot' ? '#7fc8c0' : '#9fd17a', status: statusIcon(c) };
      }),
    );
    this.updateAudio();

    this.stage.render();

    const bc = this.dw.countBodies();
    const r = this.rogue.current;
    this.debug.update({
      fps: this.debug.fps,
      frameMs: this.debug.frameMs,
      bodies: bc.total,
      awake: bc.awake,
      wave: `${this.weather.phase} swell ${this.sea.swell.toFixed(2)} storm ${this.weather.storm.toFixed(2)} ice ${this.ctx.surface.totalIce().toFixed(2)}${r ? ` · rogue ${r.side} amp ${r.amp.toFixed(1)} stage ${r.stage} in ${(r.tImpact - this.ctx.time).toFixed(1)}s` : ''}`,
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
    this.loops.wind?.setVolume(0.15 + this.weather.wind * 0.85, 1);
    this.loops.wind?.setPitch(0.6 + this.weather.wind * 0.9, 1);
    music.setIntensity(this.weather.storm);
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

  /** Dollhouse: the wheelhouse roof and upper walls fade when crew (other than Mo at the wheel) are inside. */
  private updateCutaway(dt: number): void {
    const v = new THREE.Vector3();
    const someoneInside = this.crew.list.some((c) => !c.atHelm && !c.inSea && insideHouse(c.pos(v))) || insideHouse(this.cat.item.localPos(v));
    const want = someoneInside && this.rig.blend < 0.5 ? 0.12 : 1;
    this.cutaway += (want - this.cutaway) * Math.min(1, dt * 6);
    const o = this.cutaway;
    for (const m of this.boatArt.cutawayMats) {
      m.opacity = o;
      m.depthWrite = o > 0.95;
    }
    for (const mesh of this.boatArt.cutaway) {
      const mat = mesh.material as THREE.Material;
      if (!this.boatArt.cutawayMats.includes(mat as THREE.MeshStandardMaterial)) mesh.visible = o > 0.6;
      mesh.castShadow = o > 0.95;
    }
  }

  private doPing(p: THREE.Vector3 | null, who: CrewId | null, sx?: number, sy?: number): void {
    const player = this.crew.player;
    const at = p ?? player.pos(new THREE.Vector3()).add(player.forward(new THREE.Vector3()).multiplyScalar(2));
    const b = this.bots.ping(at, who ?? undefined);
    if (!b) return;
    sfx.play('uiTap', { volume: 0.6 });
    // a little ring where you pointed
    const m = document.createElement('div');
    m.className = 'ping-mark';
    if (sx === undefined) {
      const v = at.clone().applyMatrix4(this.boatGroup.matrixWorld).project(this.stage.camera);
      sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    }
    m.style.left = sx + 'px';
    m.style.top = sy + 'px';
    this.ui.appendChild(m);
    setTimeout(() => m.remove(), 1300);
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
      if (e.code === 'BracketRight') {
        this.weather.locked = true;
        this.weather.cur.swell = Math.min(1.2, this.weather.cur.swell + 0.1);
      }
      if (e.code === 'BracketLeft') {
        this.weather.locked = true;
        this.weather.cur.swell = Math.max(0, this.weather.cur.swell - 0.1);
      }
      if (e.code === 'KeyT') this.trip.setPhase('haul2');
    });
  }
}
