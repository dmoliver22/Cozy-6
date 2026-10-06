/**
 * ScoreKeeper: turns the player's skill moments into grades, points and a Knot Streak.
 *
 *   points = round(base × streakMult × weatherMult)
 *   streakMult = min(2.5, 1 + 0.25 × floor(knots / 3))      weatherMult: calm 1 · choppy 1.25 · storm 1.5
 *
 * Only the player's own actions score (bots score nothing and never break the streak), and nothing
 * ever takes points away: a miss only unties the streak. Presentation (pops, sounds, the toast) lives
 * in Feedback, which listens for the 'grade' and 'streakBroken' events emitted here.
 */
import * as THREE from 'three';
import { config } from '../config';
import { events, type GameEvents } from '../core/events';
import { L } from '../boat/layout';
import type { Ctx } from './ctx';
import type { Crew } from '../crew/crew';
import type { CrewManager } from '../crew/crewManager';

/** One pip per graded moment: P gold (perfect/clutch/ringer/clean table) · G green · S white (safe) · M amber (miss). */
export type Pip = 'P' | 'G' | 'S' | 'M';
export type Moment = GameEvents['grade']['moment'];

export interface TripCounts {
  landAttempts: number;
  landPerfect: number;
  landGood: number;
  landMiss: number;
  braceGraded: number;
  bracePerfect: number;
  braceGood: number;
  braceSafe: number;
  braceMiss: number;
  clutches: number;
  sorts: number;
  wrongSorts: number;
  peakChain: number;
  hookAttempts: number;
  hooks: number;
  ringers: number;
  longCasts: number;
  cleanTables: number;
  cleanStrings: number;
  lifelines: number;
}

export interface TripScore {
  score: number;
  /** longest Knot Streak this trip */
  bestStreak: number;
  pips: { land: string; brace: string; hook: string; sort: string };
  counts: TripCounts;
  /** the season tier and tide flavour (−1 none) this trip was fished at */
  tier: number;
  tide: number;
  /** crew id → tumbles this trip (the Log's bloopers line) */
  tumbles: Record<string, number>;
}

interface TipState {
  t0: number;
  spawned: number;
  resolved: number;
  /** wrong sorts by anyone */
  wrong: number;
  /** the player's sorts of this tip's crabs (right or wrong) */
  mine: number;
  mineWrong: number;
  peak: number;
  done: boolean;
}

const PIP_MAX = 20;
/** the crabKept pop anchor over the sorting table */
const TABLE = new THREE.Vector3(0.7, 0.8, -2.0);
const _v = new THREE.Vector3();

export class ScoreKeeper {
  score = 0;
  knots = 0;
  bestKnots = 0;
  readonly pips = { land: '', brace: '', hook: '', sort: '' };
  readonly counts: TripCounts = {
    landAttempts: 0,
    landPerfect: 0,
    landGood: 0,
    landMiss: 0,
    braceGraded: 0,
    bracePerfect: 0,
    braceGood: 0,
    braceSafe: 0,
    braceMiss: 0,
    clutches: 0,
    sorts: 0,
    wrongSorts: 0,
    peakChain: 0,
    hookAttempts: 0,
    hooks: 0,
    ringers: 0,
    longCasts: 0,
    cleanTables: 0,
    cleanStrings: 0,
    lifelines: 0,
  };
  /** sorting rhythm */
  chain = 0;
  private lastSortAt = -1e9;
  private readonly tips = new Map<number, TipState>();
  private readonly tipPips = new Map<number, Pip>();
  /** per string: pots the player landed GOOD+ (and whether anything spoiled it) */
  private readonly landStrings = new Map<number, { pots: Set<number>; spoiled: boolean }>();
  /** per string: buoys the player hooked (each counts once), and whether a miss or a bot spoiled it */
  private readonly hookStrings = new Map<number, { pots: Set<number>; spoiled: boolean }>();
  /** buoys already graded this trip: one dropped back over the rail and hooked again scores nothing */
  private readonly hookedPots = new Set<number>();
  /** brace bookkeeping per rogue set (keyed by its impact time) */
  private braceGradedFor = NaN;
  private clutchFor = NaN;
  readonly tumbles: Record<string, number> = {};
  private offs: (() => void)[] = [];
  /** the one keeper listening on the (global) event bus: a second Game must not score every moment twice */
  private static live: ScoreKeeper | null = null;

  constructor(private ctx: Ctx) {
    ScoreKeeper.live?.dispose();
    ScoreKeeper.live = this;
    ctx.sys.score = this;
    const on = <K extends keyof GameEvents>(k: K, f: (e: GameEvents[K]) => void) => this.offs.push(events.on(k, f));
    on('potLanded', (e) => this.gradeLanding(e));
    on('braceStart', ({ crew }) => crew === 'player' && this.onPlayerBrace());
    on('rogueResolved', (e) => this.onResolved(e));
    on('potTipped', ({ spawned, tipId }) => {
      if (tipId === undefined) return;
      const t: TipState = { t0: this.ctx.time, spawned: spawned ?? 0, resolved: 0, wrong: 0, mine: 0, mineWrong: 0, peak: 0, done: false };
      this.tips.set(tipId, t);
      this.checkCleanTable(tipId);
    });
    on('crabKept', (e) => this.onSort(e, true));
    on('crabReleased', (e) => this.onSort(e, false));
    on('hooked', (e) => this.gradeHook(e));
    on('ringLanded', ({ hit }) => {
      // only a ring the player actually threw just now: throwTo stamps lastHeldAt and the rescue
      // system stamps thrownAt in the same tick (a ring dropped on deck and washed over doesn't count)
      const d = this.ctx.sys.rescue?.ring?.data;
      if (hit && d && d.lastBy === 'player' && d.thrownAt === d.lastHeldAt && this.ctx.time - d.thrownAt < 5) {
        this.counts.lifelines++;
        this.award('bonus', 'good', 150, 'LIFELINE!', this.playerHead(), true);
      }
    });
    on('iceChipped', ({ last }) => {
      if (last && this.ctx.sys.ice?.mallet?.heldBy?.id === 'player') this.award('bonus', 'good', 50, 'Clean deck!', this.playerHead(), false);
    });
    on('knockdown', ({ crew, reason }) => {
      if (reason === 'flop') return;
      this.tumbles[crew] = (this.tumbles[crew] ?? 0) + 1;
      // a braced hand torn off the rail is the sea winning, not a slip
      if (crew === 'player' && reason !== 'brace broke') this.untie('knock');
    });
    on('overboard', ({ kind, who }) => kind === 'crew' && who === 'player' && this.untie('overboard'));
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (ScoreKeeper.live === this) ScoreKeeper.live = null;
  }

  // ------------------------------------------------------------------ the maths
  /** The Knot Streak multiplier: ×1.25 at 3 knots, ×1.5 at 6 … capped at ×2.5 (18 knots). */
  get mult(): number {
    const s = config.score;
    return Math.min(s.streakCap, 1 + s.streakStep * Math.floor(this.knots / s.streakEvery));
  }

  weatherMult(): number {
    const ph = (this.ctx.sys.weather?.phase ?? 'calm') as keyof typeof config.score.weatherMult;
    return config.score.weatherMult[ph] ?? 1;
  }

  /** Score a moment (the streak you've built multiplies it) and tie a knot if it earns one. */
  award(moment: Moment, grade: string, base: number, label: string, localPos: THREE.Vector3, knot: boolean, extra: { chain?: number; chainUp?: boolean; big?: string; bigMinor?: boolean } = {}): number {
    const mult = this.mult * this.weatherMult();
    const points = Math.round(base * mult);
    this.score += points;
    if (knot) {
      this.knots++;
      this.bestKnots = Math.max(this.bestKnots, this.knots);
    }
    events.emit('grade', { moment, grade, label, points, mult, localPos: localPos.clone(), knots: this.knots, ...extra });
    return points;
  }

  /** A miss unties the streak (never takes points). Trip 1 is lenient: only a missed landing counts. */
  untie(why: 'miss' | 'knock' | 'overboard' | 'wrong'): void {
    if (config.score.lenient && why !== 'miss') return;
    if (this.knots >= 3) events.emit('streakBroken', { knots: this.knots });
    this.knots = 0;
  }

  private pip(row: keyof ScoreKeeper['pips'], p: Pip): void {
    this.pips[row] = (this.pips[row] + p).slice(-PIP_MAX);
  }

  private get player(): Crew | undefined {
    return (this.ctx.sys.crew as CrewManager | undefined)?.player;
  }

  private playerHead(): THREE.Vector3 {
    const p = this.player;
    return p ? p.head(_v).setY(_v.y + 0.5) : _v.set(0, 2, 0);
  }

  // ------------------------------------------------------------------ landings
  private gradeLanding(e: GameEvents['potLanded']): void {
    const grade = e.grade ?? (e.good ? 'good' : 'miss');
    const str = e.stringNo !== undefined && e.stringNo >= 0 ? this.landString(e.stringNo) : null;
    if (e.by !== 'player') {
      if (str) str.spoiled = true; // a bot landed one of this string
      return;
    }
    const c = this.counts;
    c.landAttempts++;
    const at = _v.copy(L.potOnCradle).setY(L.potOnCradle.y + 1.2);
    if (grade === 'miss') {
      c.landMiss++;
      if (str) str.spoiled = true;
      this.pip('land', 'M');
      this.award('land', 'miss', 0, 'MISS', at, false);
      this.untie('miss');
      return;
    }
    const centred = (e.dx ?? 1) <= 0.3;
    const perfect = grade === 'perfect';
    if (perfect) c.landPerfect++;
    else c.landGood++;
    this.pip('land', perfect ? 'P' : 'G');
    const label = (perfect ? 'DEAD LEVEL!' : 'THUNK!') + (centred ? ' · centred' : '');
    this.award('land', perfect ? 'perfect' : 'good', (perfect ? 300 : 150) + (centred ? 50 : 0), label, at, true);
    if (str && e.pot !== undefined) {
      str.pots.add(e.pot);
      if (!str.spoiled && str.pots.size >= config.fishing.potsPerString) {
        str.spoiled = true; // once per string
        c.cleanStrings++;
        this.award('bonus', 'perfect', 200, 'CLEAN STRING!', this.playerHead(), true, { big: 'CLEAN STRING!' });
      }
    }
  }

  private landString(n: number): { pots: Set<number>; spoiled: boolean } {
    let s = this.landStrings.get(n);
    if (!s) this.landStrings.set(n, (s = { pots: new Set(), spoiled: false }));
    return s;
  }

  // ------------------------------------------------------------------ braces
  /** Bracing just after the wave hit, while still on your feet: a CLUTCH (confirmed at resolve). */
  private onPlayerBrace(): void {
    const r = this.ctx.sys.rogue?.current;
    if (!r || r.stage !== 4) return;
    if (this.ctx.time - r.tImpact > config.brace.clutchSec) return;
    if (!r.crewAtImpact.includes('player') || r.heldAt.get('player')) return;
    this.clutchFor = r.tImpact;
  }

  /** A brace the player was holding at impact, graded by how late it was (only once they're still up at resolve). */
  private gradeBrace(age: number): void {
    const c = this.counts;
    c.braceGraded++;
    const at = this.playerHead();
    if (age <= config.brace.perfectSec) {
      c.bracePerfect++;
      this.pip('brace', 'P');
      this.award('brace', 'perfect', 200, 'PERFECT BRACE!', at, true);
    } else if (age <= 3.0) {
      c.braceGood++;
      this.pip('brace', 'G');
      this.award('brace', 'good', 100, 'Held!', at, true);
    } else {
      // early is always safe: a few points, no knot, and it never unties anything
      c.braceSafe++;
      this.pip('brace', 'S');
      this.award('brace', 'safe', 40, 'Held', at, false);
    }
  }

  /**
   * The set is over (1.6 s after impact): grade the player's brace. The grade waits for this moment
   * because a grip can still break after the wash ("brace broke"), and the spec only grades a brace
   * the player is still standing on at resolve.
   */
  private onResolved(e: GameEvents['rogueResolved']): void {
    const t = e.tImpact;
    if (t === undefined || !e.atImpact?.includes('player')) return;
    const fell = e.fallen.includes('player');
    const age = e.braceAge?.player ?? -1;
    if (this.braceGradedFor !== t) {
      this.braceGradedFor = t;
      if (age >= 0) {
        // braced and fell anyway is the sea winning one (no grade, no break)
        if (!fell) this.gradeBrace(age);
      } else if (!fell && this.clutchFor === t) {
        this.counts.braceGraded++;
        this.counts.clutches++;
        this.pip('brace', 'P');
        this.award('brace', 'clutch', 300, 'CLUTCH!', this.playerHead(), true);
      } else if (fell) {
        // unbraced and down: an amber pip (the knockdown already untied the streak)
        this.counts.braceMiss++;
        this.pip('brace', 'M');
      }
    }
    if (e.allHeld) this.award('bonus', 'good', 100, 'ALL HELD', this.playerHead(), false);
  }

  // ------------------------------------------------------------------ sorting
  private onSort(e: GameEvents['crabKept'] & { golden?: boolean }, kept: boolean): void {
    const tip = e.tipId !== undefined ? this.tips.get(e.tipId) : undefined;
    if (tip) {
      tip.resolved++;
      if (!e.correct) tip.wrong++;
    }
    if (e.by === 'player') {
      const c = this.counts;
      if (e.correct) {
        const now = this.ctx.time;
        const prev = this.chain;
        this.chain = now - this.lastSortAt <= config.sort.chainSec ? Math.min(config.sort.chainCap, this.chain + 1) : 1;
        // this sort added a link (a fresh chain or a longer one, not another sort at the cap): the chime
        // and the gold haptic mark the chain reaching a milestone once, not every sort after it
        const chainUp = this.chain === 1 || this.chain > prev;
        this.lastSortAt = now;
        c.sorts++;
        c.peakChain = Math.max(c.peakChain, this.chain);
        if (tip) {
          tip.mine++;
          tip.peak = Math.max(tip.peak, this.chain);
        }
        const golden = kept && !!e.golden;
        const base = 10 * this.chain + (golden ? 250 : 0);
        this.award('sort', this.chain >= 6 || golden ? 'perfect' : 'good', base, (golden ? 'GOLDEN ' : '') + `×${this.chain}`, TABLE, false, { chain: this.chain, chainUp });
      } else {
        // a wrong sort resets the chain (and, from trip 2, unties the streak); the "+1?" pop stays as it is
        this.chain = 0;
        this.lastSortAt = -1e9;
        c.wrongSorts++;
        if (tip) {
          tip.mine++;
          tip.mineWrong++;
        }
        this.untie('wrong');
      }
    }
    if (e.tipId !== undefined) this.checkCleanTable(e.tipId);
  }

  /** Clean Table: every crab of a tip sorted within 30 s, none wrong (by anyone), half or more by the player. */
  private checkCleanTable(id: number): void {
    const t = this.tips.get(id);
    if (!t || t.done || t.resolved < t.spawned) return;
    t.done = true;
    const clean = t.spawned > 0 && this.ctx.time - t.t0 <= config.sort.cleanTableSec && t.wrong === 0 && t.mine >= t.spawned * 0.5;
    if (clean) {
      this.counts.cleanTables++;
      this.award('bonus', 'perfect', 150, 'CLEAN TABLE!', TABLE.clone().setY(1.3), true, { big: 'CLEAN TABLE!', bigMinor: true });
    }
    this.finishTipPip(id, t, clean);
  }

  private finishTipPip(id: number, t: TipState, clean: boolean): void {
    if (t.mine === 0 || this.tipPips.has(id)) return; // tips the player never touched get no pip
    this.tipPips.set(id, t.mineWrong > 0 ? 'M' : clean ? 'P' : t.peak >= 4 ? 'G' : 'S');
    this.pips.sort = Array.from(this.tipPips.values()).join('').slice(-PIP_MAX);
  }

  // ------------------------------------------------------------------ grapple
  private gradeHook(e: GameEvents['hooked']): void {
    const trip = this.ctx.sys.trip;
    const stringNo = e.stringNo ?? trip?.haulTarget?.()?.stringNo;
    const str = stringNo !== undefined && stringNo >= 0 ? this.hookString(stringNo) : null;
    if (e.by !== 'player') {
      if (str && e.hit) str.spoiled = true;
      return;
    }
    const c = this.counts;
    if (e.hit && e.pot !== undefined) {
      // a buoy already hooked this trip (its line went back over the rail): no grade, no pip, no knot
      if (this.hookedPots.has(e.pot)) return;
      this.hookedPots.add(e.pot);
    }
    c.hookAttempts++;
    if (!e.hit) {
      // the toast already says it; an amber pip, no points, and the streak stays tied
      if (str) str.spoiled = true;
      this.pip('hook', 'M');
      return;
    }
    c.hooks++;
    const ringer = e.rawErr <= 1.0;
    const long = e.dist >= 12;
    if (ringer) c.ringers++;
    if (long) c.longCasts++;
    this.pip('hook', ringer ? 'P' : 'G');
    const label = (ringer ? 'RINGER!' : 'Hooked!') + (long ? ' · LONG CAST' : '');
    this.award('hook', ringer ? 'ringer' : 'good', (ringer ? 150 : 75) * (long ? 1.5 : 1), label, this.playerHead(), true);
    if (str && e.pot !== undefined) {
      str.pots.add(e.pot);
      if (!str.spoiled && str.pots.size >= config.fishing.potsPerString) {
        str.spoiled = true;
        c.cleanStrings++;
        this.award('bonus', 'perfect', 200, 'EVERY BUOY!', this.playerHead(), true, { big: 'EVERY BUOY!' });
      }
    }
  }

  private hookString(n: number): { pots: Set<number>; spoiled: boolean } {
    let s = this.hookStrings.get(n);
    if (!s) this.hookStrings.set(n, (s = { pots: new Set(), spoiled: false }));
    return s;
  }

  // ------------------------------------------------------------------ the storm call
  /** Mo's "haul one more?" — the player's own brave call earns a knot (the 25 s timeout doesn't). */
  onDecision(byPlayerHaul: boolean): void {
    if (byPlayerHaul) this.award('bonus', 'good', 150, 'BRAVE CALL!', this.playerHead(), true);
  }

  // ------------------------------------------------------------------ the trip
  summary(): TripScore {
    // tips still open at the end: no Clean Table, but the player's work there still shows
    for (const [id, t] of this.tips) if (!t.done) this.finishTipPip(id, t, false);
    return {
      score: this.score,
      bestStreak: this.bestKnots,
      pips: { ...this.pips },
      counts: { ...this.counts },
      tier: config.progress.tier,
      tide: config.progress.tide,
      tumbles: { ...this.tumbles },
    };
  }
}
