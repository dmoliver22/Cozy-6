/**
 * The wheel. Mo steers by default; the player can take the wheel (Mo then walks out to the deck
 * and works as a deckhand) and hand it back. The helm holder's raw stick drives throttle & rudder.
 */

import { L } from '../boat/layout';
import { interactableId, type Verb } from '../deck/interact';
import type { Ctx } from '../game/ctx';
import type { Crew, CrewId } from './crew';
import type { CrewManager } from './crewManager';
import type { Navigator } from '../boat/navigator';
import { events } from '../core/events';
import { sfx } from '../audio';

export class Helm {
  holder: Crew | null = null;

  constructor(private ctx: Ctx) {
    ctx.sys.helm = this;
    const crew = ctx.sys.crew as CrewManager;
    const take: Verb = { id: 'helm', icon: '☸️', label: 'Take the wheel', button: 'any', start: (id) => this.take(crew.get(id as CrewId)) };
    const leave: Verb = { id: 'leaveHelm', icon: '☸️', label: 'Hand the wheel back to Mo', button: 'any', start: (id) => this.leave(crew.get(id as CrewId)) };
    ctx.interact.add({
      id: interactableId(),
      name: 'wheel',
      radius: 0.6,
      priority: 1,
      pos: (out) => out.copy(L.wheel),
      verbs: (id, held) => {
        if (held) return null;
        const c = crew.get(id as CrewId);
        if (c.atHelm) return [leave];
        if (c.bot) return null;
        return [take];
      },
    });
  }

  private get nav(): Navigator {
    return this.ctx.sys.nav as Navigator;
  }

  take(c: Crew): void {
    if (this.holder === c) return;
    const prev = this.holder;
    if (prev) {
      prev.atHelm = false;
      if (prev.id === 'mo' && !c.bot) {
        events.emit('radio', { who: 'Mo', text: "She's all yours, kid. I'll lend a hand on deck." });
        // step aside so the player can stand at the wheel
        prev.body.setTranslation({ x: 0.9, y: 0.86, z: 6.2 }, true);
      }
    }
    this.holder = c;
    c.atHelm = true;
    c.unbrace();
    if (c.held) c.drop();
    if (!c.bot) {
      this.nav.mode = 'manual';
      this.ctx.sys.hud?.toast('At the wheel: W/S throttle · A/D steer · E to hand back', '#f2c230', 3.5);
    } else this.ctx.sys.trip?.resumeNav?.();
    sfx.play('clunk', { volume: 0.5, pitch: 1.2 });
  }

  leave(c: Crew): void {
    if (this.holder !== c) return;
    c.atHelm = false;
    this.holder = null;
    c.body.setTranslation({ x: 0.0, y: 0.86, z: 5.4 }, true);
    if (!c.bot) events.emit('radio', { who: 'Mo', text: "Right-o, I've got her." });
    this.nav.hold();
  }

  step(): void {
    const h = this.holder;
    if (!h) {
      const anyone = (this.ctx.sys.crew as CrewManager).list.find((x) => x.atHelm);
      if (anyone) this.holder = anyone;
      else if (this.nav.mode !== 'idle') this.nav.hold();
      return;
    }
    if (!h.atHelm || !h.isUp) {
      this.holder = null;
      return;
    }
    if (!h.bot) {
      this.nav.mode = 'manual';
      const s = h.input.steer;
      this.nav.throttle = Math.max(-1, Math.min(1, s.y)) * 0.85;
      this.nav.rudder = -s.x;
    }
  }
}


