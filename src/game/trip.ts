/**
 * The trip: tutorial → set string 1 → steam over → set string 2 → steam back → haul string 1
 * → (storm building: haul string 2 or run for home?) → haul string 2 → run home → harbor.
 * Mo steers (through the Navigator) whenever he has the wheel and calls it all on the radio.
 */
import * as THREE from 'three';
import { config } from '../config';
import { events } from '../core/events';
import { later } from '../core/schedule';
import { sfx } from '../audio';
import { L } from '../boat/layout';
import type { Ctx } from './ctx';
import type { Pot, PotSystem } from '../fishing/pots';
import type { Navigator } from '../boat/navigator';
import type { CrewManager } from '../crew/crewManager';
import type { BotSystem } from '../crew/bots';

export type Phase = 'tutorial' | 'set1' | 'transit2' | 'set2' | 'transit1' | 'haul1' | 'decision' | 'haul2' | 'home' | 'ended';

export interface TripStats {
  overboards: number;
  knockdowns: number;
  allHeld: number;
  rogues: number;
  goodLandings: number;
  badLandings: number;
  golden: number;
  pinches: number;
  catPets: number;
  durationSec: number;
  stringsHauled: number;
}

export class Trip {
  phase: Phase = 'tutorial';
  tutStep = 'start';
  private phaseT = 0;
  readonly startPos = new THREE.Vector3();
  heading0 = 0;
  heading1 = Math.PI;
  private lastLaunchPos = new THREE.Vector3();
  private target: Pot | null = null;
  private objectiveEl: HTMLDivElement;
  private decisionEl: HTMLDivElement;
  readonly stats: TripStats = { overboards: 0, knockdowns: 0, allHeld: 0, rogues: 0, goodLandings: 0, badLandings: 0, golden: 0, pinches: 0, catPets: 0, durationSec: 0, stringsHauled: 0 };
  skipTutorial = false;
  onEnd: ((t: Trip) => void) | null = null;
  private ended = false;
  private transitTarget = new THREE.Vector3();

  constructor(private ctx: Ctx, uiRoot: HTMLElement) {
    ctx.sys.trip = this;
    this.objectiveEl = document.createElement('div');
    this.objectiveEl.className = 'objective';
    uiRoot.appendChild(this.objectiveEl);
    this.decisionEl = document.createElement('div');
    this.decisionEl.className = 'decision interactive';
    this.decisionEl.innerHTML = `
      <div class="decision-card">
        <div class="decision-who">📻 Mo</div>
        <div class="decision-text">Barometer's dropping, kid… Storm's coming in. Haul the second string, or run for home?</div>
        <div class="decision-buttons">
          <button class="btn primary" data-c="haul">⛈ Haul one more string</button>
          <button class="btn" data-c="home">🏠 Run for home</button>
        </div>
      </div>`;
    uiRoot.appendChild(this.decisionEl);
    this.decisionEl.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.decide((b as HTMLButtonElement).dataset.c === 'haul');
      }),
    );
    this.decisionEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.decisionEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    events.on('tutorial', ({ step }) => this.onTutorial(step));
    events.on('potLaunched', () => this.onLaunched());
    events.on('buoyPopped', ({ index }) => {
      if (this.phase === 'tutorial' && index === 1) this.tutorialSwell();
    });
    events.on('rogueImpact', () => this.onImpact());
    events.on('rogueResolved', ({ allHeld }) => {
      this.stats.rogues++;
      if (allHeld) this.stats.allHeld++;
      if (this.tutStep === 'swell') this.afterSwell();
    });
    events.on('overboard', ({ kind }) => kind === 'crew' && this.stats.overboards++);
    events.on('knockdown', ({ reason }) => reason !== 'flop' && this.stats.knockdowns++);
    events.on('potLanded', ({ good }) => (good ? this.stats.goodLandings++ : this.stats.badLandings++));
    events.on('golden', () => this.stats.golden++);
    events.on('pinch', () => this.stats.pinches++);
    events.on('catPet', () => this.stats.catPets++);
  }

  private get pots(): PotSystem {
    return this.ctx.sys.pots;
  }
  private get nav(): Navigator {
    return this.ctx.sys.nav;
  }
  private get crew(): CrewManager {
    return this.ctx.sys.crew;
  }
  private radio(text: string, urgent = false): void {
    events.emit('radio', { who: 'Mo', text, urgent });
  }
  hideObjective = false;
  private objective(text: string): void {
    if (this.objectiveEl.textContent !== text) this.objectiveEl.textContent = text;
    this.objectiveEl.style.display = text && !this.hideObjective ? 'block' : 'none';
  }

  start(skipTutorial = false): void {
    this.skipTutorial = skipTutorial;
    const b = this.ctx.boat;
    this.startPos.set(b.x, 0, b.z);
    this.heading0 = b.yaw;
    this.heading1 = b.yaw + Math.PI;
    this.lastLaunchPos.copy(this.startPos);
    this.pots.settingString = 0;
    this.pots.settingAllowed = true;
    this.setPhase(skipTutorial ? 'set1' : 'tutorial');
    if (!skipTutorial) {
      later(1.2, () => this.radio("Morning, kid! Let's set our first string. Grab a bait jar from the bait box."));
      this.tutStep = 'bait';
    } else later(1, () => this.radio("Let's set a string. The crew knows the drill — bait, launch, repeat."));
  }

  setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    this.ctx.sys.weather?.setPhase?.(p);
    events.emit('phase', { name: p });
    this.resumeNav();
  }

  /** (Re)issue the navigation order for the current phase — called when Mo gets the wheel back. */
  resumeNav(): void {
    const nav = this.nav;
    if (!nav || nav.mode === 'manual') return;
    const cs = config.boat.speed;
    switch (this.phase) {
      case 'tutorial':
      case 'set1':
        nav.cruise(this.heading0, cs.set);
        break;
      case 'set2':
        nav.cruise(this.heading1, cs.set);
        break;
      case 'transit2':
      case 'transit1':
        nav.goto(this.transitTarget, cs.cruise, this.phase === 'transit2' ? this.heading1 : this.heading0);
        break;
      case 'haul1':
      case 'haul2':
        this.target = null; // re-pick
        break;
      case 'decision':
        nav.hold();
        break;
      case 'home':
        nav.cruise(this.heading0 + Math.PI * 0.75, cs.cruise);
        break;
    }
  }

  /** Bots leave the first pot to the player during the tutorial. */
  botsHold(): boolean {
    return this.phase === 'tutorial' && this.tutStep !== 'swell' && this.tutStep !== 'done';
  }

  haulTarget(): Pot | null {
    return this.phase === 'haul1' || this.phase === 'haul2' ? this.target : null;
  }

  // ---------------------------------------------------------------- tutorial
  private onTutorial(step: string): void {
    if (this.phase !== 'tutorial') return;
    if (step === 'gotBait' && this.tutStep === 'bait') this.tutStep = 'placeBait';
    if (step === 'baited' && (this.tutStep === 'bait' || this.tutStep === 'placeBait')) {
      this.tutStep = 'launch';
      this.radio('Good. Now hold the launcher lever and send her over!');
    }
  }

  private onLaunched(): void {
    this.lastLaunchPos.set(this.ctx.boat.x, 0, this.ctx.boat.z);
    this.pots.launchWanted = false;
    if (this.phase === 'tutorial' && this.tutStep === 'launch') {
      this.tutStep = 'buoy';
      later(0.6, () => this.radio('Over she goes! Watch for the buoy…'));
    }
  }

  private tutorialSwell(): void {
    if (this.tutStep === 'swell' || this.tutStep === 'done') return;
    this.tutStep = 'swell';
    this.ctx.sys.tutorialGag = true;
    later(1.6, () => {
      this.radio('Nice set. Little swell coming, starboard side — hold BRACE!', true);
      this.ctx.sys.rogue.schedule('starboard', config.weather.rogueAmp.tutorial, { lead: config.telegraph.leadSec, waitForBrace: true, label: 'tutorial' });
      // Ike wanders over to the starboard side, not paying attention…
      const bots = this.ctx.sys.bots as BotSystem;
      const ike = bots.brains.find((b) => b.crew.id === 'ike');
      if (ike) {
        ike.ping = { point: new THREE.Vector3(-1.9, 0, -1.5), iaId: null, until: this.ctx.time + 30 };
        ike.endTask();
      }
    });
  }

  private onImpact(): void {
    const r = this.ctx.sys.rogue.current;
    if (!r || r.label !== 'tutorial') return;
    // THE GAG: Ike didn't brace — he slides across the deck into the pile of buoys, hat flying
    const ike = this.crew.get('ike');
    if (ike.isUp && !ike.braced) {
      later(0.12, () => {
        const p = ike.pos(new THREE.Vector3());
        const d = L.buoyPile.clone().sub(p).setY(0);
        const dist = d.length();
        d.normalize().multiplyScalar(Math.min(6.2, 2.2 + dist * 0.85));
        d.y = 1.6;
        ike.knockdown(d, 'wave', { spin: 6 });
        events.emit('toast', { text: 'Ike forgot to brace!', color: '#ffd28a' });
        later(0.5, () => sfx.play('squeak', { pitch: 1.3 }));
      });
    }
  }

  private afterSwell(): void {
    this.tutStep = 'done';
    this.ctx.sys.tutorialGag = false;
    const bots = this.ctx.sys.bots as BotSystem;
    const ike = bots.brains.find((b) => b.crew.id === 'ike');
    if (ike) ike.ping = null;
    later(1.2, () => {
      this.radio("Ha! Ike, you've gotta BRACE, son. Alright crew — let's finish this string.");
      later(2.2, () => sfx.play('giggle', { pitch: 1.3 }));
    });
    this.setPhase('set1');
  }

  // ---------------------------------------------------------------- main
  step(dt: number): void {
    if (this.ended) return;
    this.phaseT += dt;
    this.stats.durationSec += dt;
    const pots = this.pots;
    const boat = this.ctx.boat;
    switch (this.phase) {
      case 'tutorial': {
        const msgs: Record<string, string> = {
          bait: '🫙 Grab a bait jar from the bait box',
          placeBait: '🧺 Put the bait in the pot on the launcher',
          launch: '🚀 Hold the launcher lever to send the pot over',
          buoy: '🟠 Watch the buoy pop up…',
          swell: '🌊 Hold BRACE near the rail!',
          done: '',
        };
        this.objective(msgs[this.tutStep] ?? '');
        break;
      }
      case 'set1':
      case 'set2': {
        const sIdx = this.phase === 'set1' ? 0 : 1;
        pots.settingString = sIdx;
        pots.settingAllowed = true;
        const n = pots.strings[sIdx].pots.length;
        this.objective(`🧺 Set string ${sIdx + 1}: ${n}/${config.fishing.potsPerString} pots over`);
        // spacing along the string
        const travelled = Math.hypot(boat.x - this.lastLaunchPos.x, boat.z - this.lastLaunchPos.z);
        pots.launchWanted = travelled > config.fishing.potSpacing || (n === 0 && this.phaseT > 4);
        if (n >= config.fishing.potsPerString && pots.cradleMode === 'idle') {
          pots.settingAllowed = false;
          if (sIdx === 0) {
            // steam over to the second ground
            const side = new THREE.Vector3(Math.cos(this.heading0), 0, -Math.sin(this.heading0)); // port of heading0
            this.transitTarget.set(boat.x, 0, boat.z).addScaledVector(side, 42);
            this.radio("That's the first string. Next ground's off to port — find something to do!");
            this.setPhase('transit2');
          } else {
            // back to the first string, pot #1
            const first = pots.strings[0].pots[0];
            const p = first.buoy ? first.buoy.wp.clone() : first.setWorld.clone();
            this.transitTarget.copy(p).addScaledVector(new THREE.Vector3(Math.sin(this.heading0), 0, Math.cos(this.heading0)), -22);
            this.radio("Both strings soaking. Coil some line, chip some ice — then we haul!");
            this.setPhase('transit1');
          }
        }
        break;
      }
      case 'transit2':
        this.objective('⛴ Steaming to the next ground — coil line, tidy up');
        if (this.nav.arrived || this.phaseT > 40) {
          this.lastLaunchPos.set(boat.x, 0, boat.z);
          this.radio('Here we are. Bait and launch, same as before!');
          this.setPhase('set2');
        }
        break;
      case 'transit1': {
        const soak = Math.max(0, config.trip.soakMinSec - this.phaseT);
        this.objective(`⛴ Back to string 1 · soaking ${soak > 0 ? Math.ceil(soak) + 's' : '— ready!'}`);
        if ((this.nav.arrived && this.phaseT > config.trip.soakMinSec) || this.phaseT > 90) {
          this.radio("Pots should be fat by now. Grapple's on the house wall — let's haul!");
          this.setPhase('haul1');
        } else if (this.nav.arrived && this.nav.mode !== 'manual') {
          // idle in place until the soak is done
          this.nav.hold();
        }
        break;
      }
      case 'haul1':
      case 'haul2':
        this.stepHaul(this.phase === 'haul1' ? 0 : 1);
        break;
      case 'decision':
        this.objective('📻 Mo needs your call');
        if (this.phaseT > 25) this.decide(true);
        break;
      case 'home':
        this.objective('🏠 Running for Kittiwake Harbor — sort the last of the catch!');
        if (this.phaseT > config.trip.homeRunSec) this.end();
        break;
    }
  }

  private stepHaul(sIdx: number): void {
    const pots = this.pots;
    const str = pots.strings[sIdx];
    const remaining = str.pots.filter((p) => p.state === 'soaking' || p.state === 'onLine' || p.state === 'onBlock' || p.state === 'rising' || p.state === 'hanging');
    const done = str.pots.length - remaining.length;
    this.objective(`🪝 Haul string ${sIdx + 1}: ${done}/${str.pots.length} · tank ${this.ctx.sys.crabs.tank.length}`);
    const busy = pots.blockPot && pots.blockPot.stringNo === sIdx;
    if (this.target && this.target.state !== 'soaking' && !busy && this.target.state !== 'onLine') this.target = null;
    if (!this.target && !busy) {
      // next buoy in order along the string
      const next = str.pots.filter((p) => p.state === 'soaking').sort((a, b) => a.number - b.number)[0];
      if (next) {
        this.target = next;
        const h = sIdx === 0 ? this.heading0 : this.heading1;
        if (this.nav.mode !== 'manual') this.nav.alongside(() => (next.buoy ? next.buoy.wp : null), h);
        if (sIdx === 0 && next.number === 1) this.radio('Buoy one off the starboard side. Throw the grapple!');
      }
    }
    if (!remaining.length && pots.cradleMode === 'idle' && !pots.cradlePot) {
      this.stats.stringsHauled++;
      if (sIdx === 0) {
        this.radio("Barometer's dropping, kid…", true);
        this.setPhase('decision');
        this.decisionEl.classList.add('on');
      } else {
        this.radio("That's the lot! Let's get home before she really blows.");
        this.setPhase('home');
      }
    }
  }

  decide(haul: boolean): void {
    if (this.phase !== 'decision') return;
    this.decisionEl.classList.remove('on');
    sfx.play('uiConfirm');
    if (haul) {
      this.radio("Brave crew. Hang on to your hats — haul string two!", true);
      this.setPhase('haul2');
    } else {
      this.radio('Smart call. Home we go — the galley stove is waiting.');
      this.setPhase('home');
    }
  }

  runForHome(): void {
    if (this.phase === 'home' || this.phase === 'ended') return;
    this.decisionEl.classList.remove('on');
    this.radio('Running for home!');
    this.setPhase('home');
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    this.objective('');
    this.onEnd?.(this);
  }
}
