/**
 * Weather director: a timeline (driven by the trip phase) plus seeded randomness.
 * Drives swell, wind, snow, ice rate and the rogue-set schedule.
 *   calm (tutorial swell only) → choppy (an occasional rogue) → storm (3 rogue sets)
 */
import * as THREE from 'three';
import { config } from '../config';
import { lerp } from '../core/math';
import { events, type RogueSide } from '../core/events';
import type { Ctx } from '../game/ctx';
import type { Phase } from '../game/trip';
import type { Rng } from '../core/rng';

export type WPhase = 'calm' | 'choppy' | 'storm';
interface WState {
  swell: number;
  wind: number;
  snow: number;
  iceRate: number;
  storm: number;
}

const TRIP_TO_WEATHER: Record<Phase, WPhase> = {
  tutorial: 'calm',
  set1: 'calm',
  transit2: 'calm',
  set2: 'choppy',
  transit1: 'choppy',
  haul1: 'choppy',
  decision: 'storm',
  haul2: 'storm',
  home: 'storm',
  ended: 'storm',
};

export class WeatherDirector {
  phase: WPhase = 'calm';
  readonly cur: WState;
  private target: WState;
  private rng: Rng;
  private nextRogue = Infinity;
  stormRoguesLeft = 0;
  readonly windDir = new THREE.Vector2(0.8, 0.6).normalize();
  private tripPhase: Phase = 'tutorial';
  private announcedStorm = false;
  /** debug: lock the weather */
  locked = false;

  constructor(private ctx: Ctx) {
    ctx.sys.weather = this;
    this.rng = ctx.rng.stream('weather');
    this.cur = { ...config.weather.phases.calm };
    this.target = { ...this.cur };
  }

  get storm(): number {
    return this.cur.storm;
  }
  get snow(): number {
    return this.cur.snow;
  }
  get wind(): number {
    return this.cur.wind;
  }

  /** Testing: pin the weather to one phase for the whole trip (?weather=storm). Storm rogue sets never run out. */
  forced: WPhase | null = null;
  force(w: WPhase): void {
    this.forced = null;
    this.phase = w === 'calm' ? 'choppy' : 'calm'; // make setPhase below see a change
    this.applyWeather(w);
    Object.assign(this.cur, this.target);
    if (w === 'storm') this.stormRoguesLeft = Infinity;
    this.forced = w;
  }

  setPhase(p: Phase): void {
    this.tripPhase = p;
    if (this.forced) return;
    this.applyWeather(TRIP_TO_WEATHER[p]);
    if (p === 'home') {
      // the run home: at most one more rogue
      this.stormRoguesLeft = Math.min(this.stormRoguesLeft, 1);
    }
  }

  private applyWeather(w: WPhase): void {
    if (w !== this.phase) {
      this.phase = w;
      this.target = { ...config.weather.phases[w] };
      const t = this.ctx.time;
      if (w === 'choppy') this.nextRogue = t + this.rng.range(config.weather.choppyRogueGapSec[0] * 0.6, config.weather.choppyRogueGapSec[1] * 0.6);
      if (w === 'storm') {
        this.stormRoguesLeft = config.weather.stormRogueSets;
        this.nextRogue = t + 18;
        if (!this.announcedStorm) {
          this.announcedStorm = true;
          events.emit('toast', { text: '⛈ The storm rolls in…', color: '#c8c4ff' });
        }
      }
      if (w === 'calm') this.nextRogue = Infinity;
    }
  }

  step(dt: number): void {
    const k = 1 - Math.exp(-dt / config.weather.blendSec);
    const c = this.cur,
      t = this.target;
    if (!this.locked) {
      c.swell = lerp(c.swell, t.swell, k);
      c.wind = lerp(c.wind, t.wind, k);
      c.snow = lerp(c.snow, t.snow, k);
      c.iceRate = lerp(c.iceRate, t.iceRate, k);
      c.storm = lerp(c.storm, t.storm, k);
    }
    // gusty wind, slowly veering
    const ang = Math.atan2(this.windDir.y, this.windDir.x) + Math.sin(this.ctx.time * 0.013) * dt * 0.02;
    this.windDir.set(Math.cos(ang), Math.sin(ang));
    this.ctx.sea.swell = c.swell;
    this.ctx.items.drift.copy(this.windDir).multiplyScalar(0.4 + c.wind);
    // spray & snow keep the deck wet
    const surf = this.ctx.surface;
    surf.wetness = Math.min(1, Math.max(surf.wetness - dt * 0.004, 0.25 + c.storm * 0.6));
    // rogue sets
    const rogue = this.ctx.sys.rogue;
    if (rogue && !rogue.busy && this.ctx.time > this.nextRogue) {
      if (this.phase === 'storm' && this.stormRoguesLeft > 0) {
        this.stormRoguesLeft--;
        this.scheduleRogue(config.weather.rogueAmp.storm);
        this.nextRogue = this.ctx.time + this.rng.range(config.weather.stormRogueGapSec[0], config.weather.stormRogueGapSec[1]);
      } else if (this.phase === 'choppy') {
        this.scheduleRogue(config.weather.rogueAmp.choppy);
        this.nextRogue = this.ctx.time + this.rng.range(config.weather.choppyRogueGapSec[0], config.weather.choppyRogueGapSec[1]);
      } else this.nextRogue = Infinity;
    }
  }

  private scheduleRogue(amp: number): void {
    const sides: RogueSide[] = ['starboard', 'port', 'starboard', 'port', 'bow'];
    const side = this.rng.pick(sides);
    const a = amp * this.rng.range(0.85, 1.08);
    this.ctx.sys.rogue.schedule(side, Math.min(config.sea.rogue.maxAmp, a), { lead: config.telegraph.leadSec + this.rng.range(-1.2, 1.2) });
  }
}
