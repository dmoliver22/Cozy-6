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

const NAMES: Record<string, string> = { player: 'You', mo: 'Mo', dot: 'Dot', ike: 'Ike' };
const _v = new THREE.Vector3();

export class Feedback {
  private slowmoLeft = 0;
  private offs: (() => void)[] = [];

  constructor(
    private ctx: Ctx,
    private hud: Hud,
    private rig: CameraRig,
    private crew: CrewManager,
    private loop: FixedLoop,
  ) {
    const on = <K extends Parameters<typeof events.on>[0]>(k: K, f: Parameters<typeof events.on<K>>[1]) => this.offs.push(events.on(k, f));

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
      if (!c) return;
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
    on('crabKept', ({ correct }) => {
      hud.pop(correct ? '+1' : '+1?', _v.set(0.7, 0.8, -2.0), correct ? 'plus' : 'bad', 0.9);
      hud.bumpTank();
    });
    on('golden', ({ localPos }) => {
      rig.pushTo(ctx.boat.localToWorld(_v.copy(localPos), new THREE.Vector3()), 1.8);
      hud.big('GOLDEN!');
      haptics.buzz([20, 30, 20, 30, 60]);
    });
  }

  slowmo(seconds: number, scale: number): void {
    this.slowmoLeft = seconds;
    this.loop.timeScale = scale;
  }

  update(dtReal: number): void {
    if (this.slowmoLeft > 0) {
      this.slowmoLeft -= dtReal;
      if (this.slowmoLeft <= 0) this.loop.timeScale = 1;
    }
  }
}
