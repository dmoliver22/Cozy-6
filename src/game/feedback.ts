/**
 * Game feel: turns simulation events into layered feedback (HUD, camera, sound, haptics, slow-mo).
 * Everything the player does gets an answer within 50–100 ms.
 */
import * as THREE from 'three';
import { config } from '../config';
import { events } from '../core/events';
import { haptics } from '../core/haptics';
import { sfx } from '../audio';
import type { Hud } from '../ui/hud';
import type { CameraRig } from '../camera/cameraRig';
import type { CrewManager } from '../crew/crewManager';
import type { FixedLoop } from '../core/loop';
import type { Ctx } from './ctx';
import { loadSettings, onSettingsChange } from '../core/settings';

const NAMES: Record<string, string> = { player: 'You', mo: 'Mo', dot: 'Dot', ike: 'Ike' };
const _v = new THREE.Vector3();
/** grade → pop class: gold for PERFECT / RINGER / CLUTCH, green GOOD, white SAFE, amber MISS */
const GRADE_CLASS: Record<string, string> = { perfect: 'perfect', ringer: 'perfect', clutch: 'perfect', good: 'good', bonus: 'good', safe: 'safe', miss: 'miss' };

export class Feedback {
  private slowmoLeft = 0;
  private offs: (() => void)[] = [];
  /** the one Feedback listening on the (global) event bus: a second Game must not pop everything twice */
  private static live: Feedback | null = null;
  /** the Show scores setting: off keeps the words and hides the numbers */
  showScores = loadSettings().showScores;

  constructor(
    private ctx: Ctx,
    private hud: Hud,
    private rig: CameraRig,
    private crew: CrewManager,
    private loop: FixedLoop,
  ) {
    Feedback.live?.dispose();
    Feedback.live = this;
    const on = <K extends Parameters<typeof events.on>[0]>(k: K, f: Parameters<typeof events.on<K>>[1]) => this.offs.push(events.on(k, f));
    this.offs.push(onSettingsChange((s) => (this.showScores = s.showScores)));

    on('radio', ({ who, text, urgent }) => {
      const secs = Math.max(2.5, sfx.babble(text, { radio: true, pitch: who === 'Mo' ? 0.75 : 1.1 }) + 1.2);
      sfx.play('radio', { volume: 0.5 });
      hud.radio(who, text, urgent, secs);
    });
    on('toast', ({ text, color }) => hud.toast(text, color));
    on('rogueImpact', ({ amp }) => {
      rig.addShake(config.camera.overhead.shake * (0.6 + amp * 0.35));
      haptics.buzz(config.haptics.impact);
      hud.flash('rgba(220,240,255,.8)');
    });
    on('held', ({ crew: id }) => {
      const c = crew.get(id as never);
      if (!c || id === 'player') return; // the player's brace gets its grade pop instead
      hud.pop(id === 'player' ? 'Held!' : `${NAMES[id]} held!`, c.head(_v).setY(_v.y + 0.5), 'good');
    });
    on('rogueResolved', ({ allHeld, fallen }) => {
      if (allHeld) {
        this.slowmo(config.sim.allHeldSlowmo.durationSec, config.sim.allHeldSlowmo.scale);
        sfx.play('cheer', { volume: 0.9 });
        hud.big('ALL HELD!');
      } else if (fallen.length) {
        const who = fallen.map((f) => NAMES[f]).join(' & ');
        hud.toast(`${who} took a tumble!`, '#ffd28a');
      }
    });
    on('knockdown', ({ crew: id, pos, reason }) => {
      if (reason === 'flop') return;
      const lines = ['Whoa!', 'Wheee!', 'Oof!', 'Yikes!', 'Woah-oh!'];
      hud.pop(lines[Math.floor(Math.random() * lines.length)], pos.clone().setY(pos.y + 1.2), 'bad', 1.1);
      if (id === 'player') haptics.buzz([30, 40, 30]);
    });
    on('overboard', ({ kind, who }) => {
      if (kind !== 'crew' || !who) return;
      const name = NAMES[who];
      hud.big(who === 'player' ? 'SPLASH!' : `${name.toUpperCase()} OVERBOARD!`);
      events.emit('radio', { who: 'Mo', text: who === 'player' ? "Kid's in the drink! Somebody grab the ring!" : `${name}'s in the drink! Throw the ring!`, urgent: true });
      sfx.play('foghorn', { volume: 0.35, pitch: 1.2, delay: 0.4 });
    });
    on('rescued', ({ crew: id, how }) => {
      hud.toast(how === 'crane' ? `${NAMES[id]} fished back by the crane hook!` : `${NAMES[id]} is back aboard!`, '#8cf09a');
    });
    on('ringLanded', ({ hit }) => {
      if (!hit) hud.toast('Missed — hold to reel it back in', '#ffd28a', 2);
    });
    on('pinch', ({ crew: id }) => {
      const c = crew.get(id as never);
      if (c) hud.pop('Ow!', c.feet(_v).setY(0.9), 'bad', 0.9);
      if (id === 'player') haptics.buzz(config.haptics.pinch);
    });
    on('crabKept', ({ correct, by }) => {
      // the player's own good sorts get a ×N chain pop from the score keeper instead
      if (!(correct && by === 'player')) hud.pop(correct ? '+1' : '+1?', _v.set(0.7, 0.8, -2.0), correct ? 'plus' : 'bad', 0.9);
      hud.bumpTank();
    });
    // ---- scoring: grade pops, the streak ladder, juice
    on('grade', (e) => {
      const cls = GRADE_CLASS[e.grade] ?? 'good';
      // misses pop only for landings (a fallen brace has its "Whoa!", a missed hook its toast)
      if (e.grade !== 'miss' || e.moment === 'land') {
        const text = this.showScores && e.points > 0 ? `${e.label} +${e.points.toLocaleString('en-US')}` : e.label;
        hud.pop(text, e.localPos, cls, cls === 'perfect' ? 1.6 : 1.4, true);
      }
      // the PERFECT haptic; on the sorting ladder only the step that first turns the chain gold (or a golden crab)
      if (cls === 'perfect' && (e.moment !== 'sort' || e.label.startsWith('GOLDEN') || (e.chainUp && e.chain === 6))) haptics.buzz([12, 30, 12]);
      if (e.moment === 'sort') {
        // an audible ladder up the chain; a chime when it grows to 5 and to 8 (not on every sort at the cap)
        const k = e.chain ?? 1;
        sfx.play('plus', { pitch: 1 + 0.07 * k, volume: 0.55 });
        if (e.chainUp && (k === 5 || k === 8)) sfx.play('chime', { volume: 0.45, delay: 0.05 });
      } else if (e.points > 0) sfx.play('plus', { pitch: 1 + 0.05 * Math.min(e.knots, 14), volume: 0.6, delay: 0.05 });
      if (e.grade === 'clutch') this.slowmo(0.2, 0.5);
      if (e.big && !(e.bigMinor && hud.bigBusy)) {
        hud.big(e.big);
        sfx.play('fanfare', { volume: 0.7, delay: 0.1 });
      }
      if (e.points > 0) hud.bumpScore();
    });
    on('streakBroken', () => {
      hud.toastMore('Knot slipped!', '#ffb070');
      sfx.play('flop', { pitch: 1.2, volume: 0.6 });
    });
    on('golden', ({ localPos }) => {
      rig.pushTo(ctx.boat.localToWorld(_v.copy(localPos), new THREE.Vector3()), 1.8);
      hud.big('GOLDEN!');
      haptics.buzz([20, 30, 20, 30, 60]);
    });
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (Feedback.live === this) Feedback.live = null;
  }

  /** Slow motion. Two that overlap keep the longer and the slower (a CLUTCH never cuts ALL HELD short). */
  slowmo(seconds: number, scale: number): void {
    const active = this.slowmoLeft > 0;
    this.slowmoLeft = active ? Math.max(this.slowmoLeft, seconds) : seconds;
    this.loop.timeScale = active ? Math.min(this.loop.timeScale, scale) : scale;
  }

  update(dtReal: number): void {
    if (this.slowmoLeft > 0) {
      this.slowmoLeft -= dtReal;
      if (this.slowmoLeft <= 0) this.loop.timeScale = 1;
    }
  }
}
