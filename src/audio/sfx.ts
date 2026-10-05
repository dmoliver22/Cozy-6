/**
 * Pot Luck — procedural sound effects & ambience (WebAudio only, no samples).
 *
 * Usage:
 *   window.addEventListener('pointerdown', () => sfx.unlock());   // + keydown / touchend
 *   sfx.play('splash', { pitch: 1.1, pan: -0.3 });
 *   const sea = sfx.loop('sea', { volume: 0.8 });  sea.setPitch(1.4);  sea.stop(2);
 *   const secs = sfx.babble("Ahoy! Pots are in.", { pitch: 0.85, radio: true });
 */
import {
  MAX_VOICES,
  Voice,
  activeVoices,
  clamp,
  engine,
  isReady,
  setLevel,
  setMutedFlag,
  unlockEngine,
} from './engine';
import { RECIPES } from './recipes';
import { createLoop, startPendingLoops } from './loops';
import { babble as babbleImpl } from './babble';

export type SfxName =
  | 'bell'
  | 'radio'
  | 'whump'
  | 'spray'
  | 'splash'
  | 'plop'
  | 'thunk'
  | 'skid'
  | 'clunk'
  | 'knock'
  | 'plus'
  | 'creak'
  | 'ropeCreak'
  | 'hup'
  | 'held'
  | 'cheer'
  | 'squeak'
  | 'clatter'
  | 'click'
  | 'chatter'
  | 'chime'
  | 'sparkle'
  | 'fanfare'
  | 'crack'
  | 'shatter'
  | 'gotcha'
  | 'giggle'
  | 'ow'
  | 'scratch'
  | 'meow'
  | 'purr'
  | 'foghorn'
  | 'grab'
  | 'throw'
  | 'lever'
  | 'buoyPop'
  | 'pinch'
  | 'winchStart'
  | 'uiTap'
  | 'uiConfirm'
  | 'coins'
  | 'tally'
  | 'cook'
  | 'camera'
  | 'hatThud'
  | 'flop'
  | 'chip'
  | 'strap'
  | 'otter'
  | 'bottle'
  | 'shipbell'
  | 'pageTurn';

export interface PlayOpts {
  pitch?: number;
  volume?: number;
  pan?: number;
  delay?: number;
}

export interface LoopHandle {
  setVolume(v: number, rampSec?: number): void;
  setPitch(p: number, rampSec?: number): void;
  stop(fadeSec?: number): void;
}

export type LoopName = 'sea' | 'wind' | 'engine' | 'winch' | 'hull' | 'stove' | 'purr' | 'deckWater';

/** all one-shot names (handy for test pages / debug menus) */
export const SFX_NAMES = Object.keys(RECIPES) as SfxName[];
export const LOOP_NAMES: readonly LoopName[] = ['sea', 'wind', 'engine', 'winch', 'hull', 'stove', 'purr', 'deckWater'];

// ------------------------------------------------------------ rate limiting

const RATE_WINDOW = 0.025;
const recent = new Map<SfxName, number[]>();

function rateOk(name: SfxName, t: number, burst: number): boolean {
  let arr = recent.get(name);
  if (!arr) {
    arr = [];
    recent.set(name, arr);
  }
  // forget anything far from t (both directions: delays schedule ahead)
  for (let i = arr.length - 1; i >= 0; i--) if (Math.abs(t - (arr[i] as number)) > 1) arr.splice(i, 1);
  let near = 0;
  for (const x of arr) if (Math.abs(t - x) < RATE_WINDOW) near++;
  if (near >= burst) return false;
  arr.push(t);
  return true;
}

function play(name: SfxName, opts: PlayOpts = {}): void {
  if (!isReady()) return;
  const e = engine();
  const r = RECIPES[name];
  if (!e || !r) return;
  const delay = clamp(Number.isFinite(opts.delay) ? (opts.delay as number) : 0, 0, 60);
  const t = e.ctx.currentTime + 0.008 + delay;
  if (!rateOk(name, t, r.burst ?? 1)) return;

  // per-name polyphony: steal the oldest instance of this sound
  const list = activeVoices();
  let same = 0;
  let oldestSame: Voice | null = null;
  for (const v of list) {
    if (v.name === name) {
      same++;
      if (!oldestSame) oldestSame = v;
    }
  }
  if (oldestSame && same >= (r.max ?? 6)) oldestSame.kill(0.04);
  // global cap: drop the oldest voices
  while (activeVoices().length >= MAX_VOICES) {
    const oldest = activeVoices()[0];
    if (!oldest) break;
    oldest.kill(0.03);
  }

  const v = new Voice(e, t, {
    name,
    pitch: Number.isFinite(opts.pitch) ? opts.pitch : 1,
    volume: (Number.isFinite(opts.volume) ? (opts.volume as number) : 1) * (r.gain ?? 1),
    pan: Number.isFinite(opts.pan) ? opts.pan : 0,
    send: r.send ?? 0.15,
  });
  try {
    r.play(v);
  } catch (err) {
    console.warn(`[audio] sfx '${name}' failed`, err);
  } finally {
    v.finish();
  }
}

export const sfx: {
  unlock(): void;
  readonly ready: boolean;
  play(name: SfxName, opts?: PlayOpts): void;
  loop(name: LoopName, opts?: { volume?: number; pitch?: number }): LoopHandle;
  babble(text: string, opts?: { pitch?: number; radio?: boolean; volume?: number; speed?: number }): number;
  setMaster(v: number): void;
  setSfxVolume(v: number): void;
  setMusicVolume(v: number): void;
  setMuted(m: boolean): void;
  /** Internal: shared context + buses for music.ts */
  ctx(): AudioContext | null;
  musicBus(): GainNode | null;
} = {
  unlock(): void {
    unlockEngine();
    const e = engine();
    if (e) startPendingLoops(e);
  },
  get ready(): boolean {
    return isReady();
  },
  play,
  loop(name, opts = {}) {
    return createLoop(name, opts.volume ?? 1, opts.pitch ?? 1);
  },
  babble(text, opts = {}) {
    return babbleImpl(text, opts);
  },
  setMaster(v) {
    setLevel('master', v);
  },
  setSfxVolume(v) {
    setLevel('sfx', v);
  },
  setMusicVolume(v) {
    setLevel('music', v);
  },
  setMuted(m) {
    setMutedFlag(m);
  },
  ctx() {
    return engine()?.ctx ?? null;
  },
  musicBus() {
    return engine()?.musicBus ?? null;
  },
};

export { stopBabble } from './babble';
export { onAudioReady } from './engine';
