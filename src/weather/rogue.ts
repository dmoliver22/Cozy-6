/**
 * Rogue sets: one big travelling wave group, always telegraphed:
 *   Bell (lead 5–8 s) → Mo's radio call (4 s) → white crest + HUD ring (3 s) → Impact (deck wash, shake, spray).
 * The wave is real: it lives in Sea.rogue and lifts/rolls the boat through the shared wave function.
 */
import { config, DEG } from '../config';
import { later } from '../core/schedule';
import { smoothstep } from '../core/math';
import { events, type RogueSide } from '../core/events';
import { sfx } from '../audio';
import type { Ctx } from '../game/ctx';
import type { Crew } from '../crew/crew';

export interface RogueSet {
  side: RogueSide;
  amp: number;
  tImpact: number;
  lead: number;
  stage: number; // 0 waiting, 1 bell, 2 radio, 3 crest, 4 impact, 5 resolved
  bells: number;
  dirX: number;
  dirZ: number;
  waitForBrace: boolean;
  maxWaitUntil: number;
  braceSeenAt: number;
  label: string;
  heldAt: Map<string, boolean>;
  crewAtImpact: string[];
}

const SIDE_TEXT: Record<RogueSide, string> = { port: 'port side', starboard: 'starboard', bow: 'dead ahead' };

export class RogueDirector {
  current: RogueSet | null = null;
  readonly history: { side: RogueSide; allHeld: boolean; fallen: string[] }[] = [];
  radarBonus = 0;

  constructor(private ctx: Ctx) {
    ctx.sys.rogue = this;
  }

  get busy(): boolean {
    return !!this.current && this.current.stage < 5;
  }

  /** Seconds until impact (negative after), or null. */
  get impactIn(): number | null {
    if (!this.current || this.current.stage >= 5) return null;
    return this.current.tImpact - this.ctx.time;
  }

  schedule(side: RogueSide, amp: number, opts: { lead?: number; waitForBrace?: boolean; label?: string } = {}): RogueSet {
    const lead = (opts.lead ?? config.telegraph.leadSec) + this.radarBonus;
    const t = this.ctx.time;
    const set: RogueSet = {
      side,
      amp,
      tImpact: t + lead + 0.6,
      lead,
      stage: 0,
      bells: 0,
      dirX: 1,
      dirZ: 0,
      waitForBrace: !!opts.waitForBrace,
      maxWaitUntil: t + lead + 9,
      braceSeenAt: -1,
      label: opts.label ?? 'rogue',
      heldAt: new Map(),
      crewAtImpact: [],
    };
    this.current = set;
    this.updateDir(set);
    return set;
  }

  private updateDir(set: RogueSet): void {
    const yaw = this.ctx.boat.yaw;
    // local port = (cos ψ, −sin ψ), forward = (sin ψ, cos ψ) in world XZ
    const px = Math.cos(yaw),
      pz = -Math.sin(yaw);
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    if (set.side === 'port') {
      set.dirX = -px;
      set.dirZ = -pz;
    } else if (set.side === 'starboard') {
      set.dirX = px;
      set.dirZ = pz;
    } else {
      set.dirX = -fx;
      set.dirZ = -fz;
    }
  }

  step(dt: number): void {
    const set = this.current;
    const sea = this.ctx.sea;
    if (!set) {
      sea.rogue.active = false;
      return;
    }
    const t = this.ctx.time;
    const crew = (this.ctx.sys.crew?.list ?? []) as Crew[];
    // tutorial: hold the wave until the player braces (with a cap)
    if (set.waitForBrace && set.stage < 4) {
      const player = crew.find((c) => c.id === 'player');
      if (player && (player.braced || player.crouch) && set.braceSeenAt < 0) {
        set.braceSeenAt = t;
        set.tImpact = Math.min(set.tImpact, t + 1.1);
      }
      if (set.braceSeenAt < 0 && t < set.maxWaitUntil) set.tImpact = Math.max(set.tImpact, t + 2.2);
    }
    const dtI = set.tImpact - t;
    this.updateDir(set);
    // stages
    if (set.stage === 0 && dtI <= set.lead) {
      set.stage = 1;
      events.emit('rogueBell', { side: set.side, impactIn: dtI, amp: set.amp });
    }
    if (set.stage >= 1 && set.stage < 4) {
      // bell rings three times with a doppler-ish rise
      const bellTimes = [set.lead, set.lead - 1.2, set.lead - 2.4];
      while (set.bells < 3 && dtI <= bellTimes[set.bells]) {
        sfx.play('bell', { pitch: 0.92 + set.bells * 0.1, volume: 0.8 });
        set.bells++;
      }
    }
    if (set.stage === 1 && dtI <= config.telegraph.radioSec) {
      set.stage = 2;
      const big = set.amp > 2.2 ? 'Big one' : set.amp > 1.4 ? 'Here she comes' : 'Swell coming';
      events.emit('rogueRadio', { side: set.side, impactIn: dtI });
      events.emit('radio', { who: 'Mo', text: `${big}, ${SIDE_TEXT[set.side]}! Brace!`, urgent: true });
    }
    if (set.stage === 2 && dtI <= config.telegraph.crestSec) {
      set.stage = 3;
      events.emit('rogueCrest', { side: set.side, impactIn: dtI });
    }
    if (set.stage === 3 && dtI <= 0) {
      set.stage = 4;
      this.impact(set, crew);
    }
    if (set.stage === 4 && dtI <= -1.6) {
      set.stage = 5;
      this.resolve(set, crew);
    }
    // drive the actual wave in the sea
    const r = sea.rogue;
    const c = config.sea.rogue.speed;
    const b = this.ctx.boat;
    const sBoat = set.dirX * b.x + set.dirZ * b.z;
    r.active = true;
    r.dirX = set.dirX;
    r.dirZ = set.dirZ;
    r.s0 = sBoat - c * dtI;
    const fadeIn = smoothstep(set.lead + 2.5, 2.5, dtI);
    const fadeOut = 1 - smoothstep(-3, -9, dtI);
    r.amp = set.amp * fadeIn * fadeOut * 0.85;
    if (dtI < -10) {
      r.active = false;
      this.current = null;
    }
  }

  private impact(set: RogueSet, crew: Crew[]): void {
    const b = this.ctx.boat;
    const k = config.boat.rogueRollKickDeg * DEG * Math.min(1.2, set.amp / 2.6);
    if (set.side === 'starboard') b.kickRoll(-k);
    else if (set.side === 'port') b.kickRoll(k);
    else b.kickPitch(-k * 0.6);
    for (const c of crew) {
      if (c.isUp && !c.insideHouse && !c.atHelm) {
        set.crewAtImpact.push(c.id);
        set.heldAt.set(c.id, c.braced);
      }
    }
    sfx.play('whump', { volume: 1, pitch: set.amp > 2 ? 0.85 : 1 });
    sfx.play('spray', { volume: 0.9, delay: 0.1 });
    this.ctx.sys.wash?.start(set.side, set.amp);
    events.emit('rogueImpact', { side: set.side, amp: set.amp });
    // "Held!" pops slightly after the wash has passed
    later((650) / 1000, () => {
      for (const c of crew) {
        if (set.heldAt.get(c.id) && c.isUp && c.braced) {
          events.emit('held', { crew: c.id });
          sfx.play('held', { pitch: c.voicePitch, volume: 0.7 });
          if (c.vocalCooldown <= 0) sfx.play('hup', { pitch: c.voicePitch, volume: 0.7 });
        }
      }
    });
  }

  private resolve(set: RogueSet, crew: Crew[]): void {
    const fallen: string[] = [];
    let held = 0;
    for (const id of set.crewAtImpact) {
      const c = crew.find((x) => x.id === id);
      if (!c) continue;
      if (c.isUp && c.lastKnock < set.tImpact - 0.1) held++;
      else fallen.push(id);
    }
    const allHeld = set.crewAtImpact.length >= 2 && fallen.length === 0;
    this.history.push({ side: set.side, allHeld, fallen });
    events.emit('rogueResolved', { allHeld, heldCount: held, fallen });
  }

  /** For the HUD: 0..1 fill toward impact, plus side. */
  hudState(): { fill: number; side: RogueSide; secs: number; stage: number } | null {
    const s = this.current;
    if (!s || s.stage < 1 || s.stage >= 5) return null;
    const dtI = s.tImpact - this.ctx.time;
    return { fill: 1 - Math.max(0, Math.min(1, dtI / s.lead)), side: s.side, secs: Math.max(0, dtI), stage: s.stage };
  }
}

