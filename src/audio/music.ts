/**
 * Generative cozy sea-shanty waltz (3/4, eighth-note grid, ~92 BPM).
 *
 * Instruments (all synthesized):
 *  - nylon-ish guitar: Karplus–Strong plucks rendered once per note into
 *    cached AudioBuffers (a real-time feedback DelayNode can't go above
 *    ~375 Hz because of the 128-frame loop minimum), oom-pah-pah or fingerpicked
 *  - accordion pad / lead: detuned saw pairs through a soft lowpass with vibrato
 *  - upright-ish bass, shaker, brush, soft kick, toms, noise swells
 *
 * Intensity crossfades layers via bus gains (smoothed over ~2 bars); at high
 * intensity the progression turns minor (Dm–B♭–Gm–A). Timing uses a
 * lookahead scheduler (25 ms interval, 0.12 s ahead) on the AudioContext clock.
 */
import { sfx } from './sfx';
import type { Engine } from './engine';
import { Voice, ahr, clamp, engine, env, isReady, onAudioReady, pick, rnd, sweep, wire } from './engine';

export type MusicMood = 'sea' | 'harbor' | 'galley' | 'title';

interface MoodCfg {
  bpm: number;
  drums: boolean;
  /** bass layer level when not intensity-driven */
  bass: number;
  /** guitar bus lowpass (warmth) */
  warmth: number;
  style: 'strum' | 'pick';
  /** probability a phrase carries a melody */
  melody: number;
  pad: number;
  lead: boolean;
}

const MOODS: Record<MusicMood, MoodCfg> = {
  sea: { bpm: 92, drums: true, bass: 0, warmth: 3400, style: 'strum', melody: 0.6, pad: 1, lead: false },
  harbor: { bpm: 80, drums: false, bass: 0.55, warmth: 2500, style: 'pick', melody: 0.6, pad: 1.15, lead: true },
  galley: { bpm: 72, drums: false, bass: 0.35, warmth: 2000, style: 'pick', melody: 0.45, pad: 0.9, lead: false },
  title: { bpm: 84, drums: false, bass: 0.3, warmth: 2900, style: 'pick', melody: 0.75, pad: 1, lead: false },
};

// ---------------------------------------------------------------- harmony

/** semitones relative to the key root */
interface Chord {
  root: number;
  tones: readonly number[];
}

const KEY = 53; // F3 — warm F major
const CH: Record<string, Chord> = {
  I: { root: 0, tones: [0, 4, 7] },
  ii: { root: 2, tones: [2, 5, 9] },
  iii: { root: 4, tones: [4, 7, 11] },
  IV: { root: 5, tones: [5, 9, 0] },
  V: { root: 7, tones: [7, 11, 2] },
  V7: { root: 7, tones: [7, 11, 2, 5] },
  vi: { root: 9, tones: [9, 0, 4] },
  III: { root: 4, tones: [4, 8, 11] }, // A major: V of D minor — the stormy turn
};
const c = (n: string): Chord => CH[n] as Chord;

const CALM: Chord[][] = [
  [c('I'), c('vi'), c('IV'), c('V')],
  [c('I'), c('IV'), c('I'), c('V7')],
  [c('vi'), c('IV'), c('I'), c('V')],
  [c('IV'), c('I'), c('ii'), c('V7')],
  [c('I'), c('iii'), c('IV'), c('V')],
];
const STORM: Chord[][] = [
  [c('vi'), c('IV'), c('ii'), c('III')],
  [c('vi'), c('V'), c('IV'), c('III')],
  [c('vi'), c('IV'), c('I'), c('V')],
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

function scaleFor(ch: Chord): number[] {
  // raise C→C# over the A-major chord
  return ch.tones.includes(8) ? MAJOR.map((x) => (x === 7 ? 8 : x)) : MAJOR;
}

const mod12 = (x: number): number => ((x % 12) + 12) % 12;

/** lowest midi ≥ lo whose pitch class (relative to KEY) is pc */
function fit(pc: number, lo: number): number {
  return lo + mod12(pc - (lo - KEY));
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- melody

interface MelNote {
  bar: number;
  step: number;
  len: number;
  midi: number;
  vel: number;
}

const RHYTHMS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [0, 2],
    [2, 2],
    [4, 2],
  ],
  [
    [0, 3],
    [3, 3],
  ],
  [
    [0, 4],
    [4, 2],
  ],
  [
    [0, 2],
    [2, 1],
    [3, 1],
    [4, 2],
  ],
  [
    [2, 2],
    [4, 2],
  ],
  [
    [0, 3],
    [3, 1],
    [4, 2],
  ],
];
const CADENCE: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 6]],
  [
    [0, 4],
    [4, 2],
  ],
];

const MEL_LO = 62;
const MEL_HI = 81;

function chordTonesIn(ch: Chord, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (ch.tones.includes(mod12(m - KEY))) out.push(m);
  return out;
}

function genMelody(chords: readonly Chord[]): MelNote[] {
  const notes: MelNote[] = [];
  const first = chords[0] as Chord;
  let prev = pick(chordTonesIn(first, 67, 74).length ? chordTonesIn(first, 67, 74) : [69]);
  let dir = Math.random() < 0.5 ? 1 : -1;
  chords.forEach((ch, b) => {
    const rh = b === chords.length - 1 ? pick(CADENCE) : pick(RHYTHMS);
    const scale = scaleFor(ch);
    rh.forEach(([step, len], i) => {
      let m: number;
      if (step === 0 || i === 0) {
        const cands = chordTonesIn(ch, MEL_LO, MEL_HI).sort((x, y) => Math.abs(x - prev - dir * 2) - Math.abs(y - prev - dir * 2));
        m = cands[Math.random() < 0.7 ? 0 : 1] ?? prev;
      } else {
        const cands: number[] = [];
        for (let x = prev - 4; x <= prev + 4; x++) if (x !== prev && x >= MEL_LO && x <= MEL_HI && scale.includes(mod12(x - KEY))) cands.push(x);
        cands.sort((x, y) => Math.abs(x - prev - dir * 2) - Math.abs(y - prev - dir * 2));
        m = cands[Math.random() < 0.75 ? 0 : Math.min(1, cands.length - 1)] ?? prev;
      }
      if (m >= MEL_HI - 2) dir = -1;
      else if (m <= MEL_LO + 3) dir = 1;
      else if (Math.random() < 0.25) dir = -dir;
      notes.push({ bar: b, step, len, midi: m, vel: step === 0 ? 0.85 : 0.65 });
      prev = m;
    });
  });
  return notes;
}

// ------------------------------------------------------- Karplus–Strong

const ksCache = new Map<number, AudioBuffer>();

/** render a plucked string into a buffer whose sample rate makes the period exact */
function ksBuffer(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const hit = ksCache.get(midi);
  if (hit) return hit;
  const f = mtof(midi);
  // period N + 0.5 (the 2-tap average adds half a sample of delay)
  let N = Math.max(4, Math.round(24000 / f - 0.5));
  let rate = f * (N + 0.5);
  while (rate < 22050) {
    N++;
    rate = f * (N + 0.5);
  }
  const low = midi < 50;
  const dur = low ? 2.2 : midi < 64 ? 1.7 : 1.3;
  const t60 = low ? 2.4 : midi < 64 ? 1.8 : 1.3;
  const len = Math.floor(rate * dur);
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  // excitation: softened noise with a pluck-position comb (warm, nylon-ish)
  const exc = new Float32Array(N);
  for (let i = 0; i < N; i++) exc[i] = Math.random() * 2 - 1;
  for (let pass = 0; pass < 3; pass++) {
    let prevX = exc[N - 1] as number;
    for (let i = 0; i < N; i++) {
      const x = exc[i] as number;
      exc[i] = 0.5 * (x + prevX);
      prevX = x;
    }
  }
  const P = Math.max(1, Math.round(N * 0.18));
  let mean = 0;
  const ex2 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ex2[i] = (exc[i] as number) - 0.6 * (exc[(i + P) % N] as number);
    mean += ex2[i] as number;
  }
  mean /= N;
  const rho = Math.pow(0.001, 1 / (f * t60));
  let peak = 0;
  for (let n = 0; n < len; n++) {
    let y: number;
    if (n < N) y = (ex2[n] as number) - mean;
    else y = rho * 0.5 * ((d[n - N] as number) + (n - N - 1 >= 0 ? (d[n - N - 1] as number) : 0));
    d[n] = y;
    const a = Math.abs(y);
    if (a > peak) peak = a;
  }
  const g = 0.7 / (peak || 1);
  const fade = Math.floor(rate * 0.03);
  for (let n = 0; n < len; n++) {
    let y = (d[n] as number) * g;
    if (n > len - fade) y *= (len - n) / fade;
    if (n < 8) y *= n / 8;
    d[n] = y;
  }
  ksCache.set(midi, buf);
  return buf;
}

// ------------------------------------------------------------------ engine

const LOOKAHEAD = 0.12;
const TICK_MS = 25;
const OUT_LEVEL = 1.0;

interface Buses {
  out: GainNode;
  guitar: GainNode;
  guitarLp: BiquadFilterNode;
  pad: GainNode;
  padLp: BiquadFilterNode;
  lead: GainNode;
  bass: GainNode;
  light: GainNode;
  storm: GainNode;
  all: AudioNode[];
}

const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

class Score {
  private e: Engine | null = null;
  private b: Buses | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubReady: (() => void) | null = null;
  private wanted = false;

  private mood: MusicMood = 'sea';
  private target = 0;
  private I = 0;
  private bpm = 92;
  private stepDur = 60 / 92 / 2;
  private nextT = 0;
  private step = 0;
  private bar = 0;
  private prog: Chord[] = CALM[0] as Chord[];
  private nextProg: Chord[] | null = null;
  private chord: Chord = c('I');
  private melody: MelNote[] = [];
  private melodyOn = false;
  private melCache = new Map<string, MelNote[]>();
  private lv = { light: 0, storm: 0, bass: 0 };

  start(): void {
    this.wanted = true;
    if (this.timer !== null) {
      // cancel a pending fade-out
      if (this.stopTimer !== null && this.e && this.b) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
        this.ramp(this.b.out.gain, OUT_LEVEL, 1.0);
      }
      return;
    }
    if (isReady()) this.begin();
    else if (!this.unsubReady) {
      this.unsubReady = onAudioReady(() => {
        this.unsubReady = null;
        if (this.wanted && this.timer === null) this.begin();
      });
    }
  }

  stop(fadeSec = 1.5): void {
    this.wanted = false;
    if (this.unsubReady) {
      this.unsubReady();
      this.unsubReady = null;
    }
    if (this.timer === null || !this.b || !this.e) return;
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    const fade = Math.max(0.05, fadeSec);
    this.ramp(this.b.out.gain, 0, fade);
    this.stopTimer = setTimeout(() => this.teardown(), fade * 1000 + 80);
  }

  setIntensity(x: number): void {
    this.target = clamp(Number.isFinite(x) ? x : 0, 0, 1);
  }

  setMood(m: MusicMood): void {
    if (MOODS[m]) this.mood = m;
  }

  // --------------------------------------------------------------- lifecycle

  private ramp(p: AudioParam, v: number, sec: number): void {
    const ctx = (this.e as Engine).ctx;
    const now = ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(v, now + sec);
  }

  private begin(): void {
    const e = engine();
    const bus = sfx.musicBus();
    if (!e || !bus) return;
    this.e = e;
    const ctx = e.ctx;
    const g = (v: number): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const flt = (type: BiquadFilterType, f: number, Q = 0.7071, gain = 0): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = Q;
      if (gain) n.gain.value = gain;
      return n;
    };
    const out = g(0);
    out.connect(bus);
    const guitar = g(1);
    const guitarLp = flt('lowpass', MOODS[this.mood].warmth, 0.6);
    const guitarBody = flt('peaking', 220, 1, 2.5);
    wire(guitar, guitarBody, guitarLp, out);
    const pad = g(0.16);
    const padLp = flt('lowpass', 1500, 0.8);
    const padPk = flt('peaking', 1000, 1.2, 3);
    wire(pad, padLp, padPk, out);
    const lead = g(0.5);
    const leadLp = flt('lowpass', 2300, 0.8);
    wire(lead, leadLp, out);
    const bass = g(0);
    const bassLp = flt('lowpass', 520, 0.9);
    wire(bass, bassLp, out);
    const light = g(0);
    light.connect(out);
    const storm = g(0);
    storm.connect(out);
    this.b = {
      out,
      guitar,
      guitarLp,
      pad,
      padLp,
      lead,
      bass,
      light,
      storm,
      all: [out, guitar, guitarLp, guitarBody, pad, padLp, padPk, lead, leadLp, bass, bassLp, light, storm],
    };
    this.ramp(out.gain, OUT_LEVEL, 2.5);
    this.I = this.target;
    this.bpm = MOODS[this.mood].bpm;
    this.stepDur = 60 / this.bpm / 2;
    this.step = 0;
    this.bar = 0;
    this.nextT = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private teardown(): void {
    this.stopTimer = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.b) {
      for (const n of this.b.all) {
        try {
          n.disconnect();
        } catch {
          /* noop */
        }
      }
    }
    this.b = null;
  }

  private tick(): void {
    if (!this.e || !this.b) return;
    const ctx = this.e.ctx;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // timers were throttled (background tab): skip ahead instead of bursting
    if (this.nextT < now - 0.25) this.nextT = now + 0.05;
    while (this.nextT < now + LOOKAHEAD) {
      try {
        this.scheduleStep(this.nextT);
      } catch (err) {
        console.warn('[audio] music step failed', err);
      }
      this.nextT += this.stepDur;
      this.step++;
      if (this.step >= 6) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  // ------------------------------------------------------------- scheduling

  private voice(t: number, dest: AudioNode, pan = 0): Voice {
    return new Voice(this.e as Engine, t, { name: 'music', dest, counted: false, pan });
  }

  private onBar(t: number): void {
    const cfg = MOODS[this.mood];
    const b = this.b as Buses;
    // tempo eases toward the mood's tempo at bar boundaries
    this.bpm += (cfg.bpm - this.bpm) * 0.5;
    if (Math.abs(cfg.bpm - this.bpm) < 0.5) this.bpm = cfg.bpm;
    this.stepDur = 60 / this.bpm / 2;
    const barDur = this.stepDur * 6;
    const inBar = this.bar % 4;

    if (inBar === 0) {
      const stormy = this.mood === 'sea' && this.I > 0.72;
      this.prog = this.nextProg ?? (stormy ? pick(STORM) : pick(CALM));
      this.nextProg = null;
      const key = this.prog.map((ch) => ch.root + ':' + ch.tones.join('.')).join('|');
      if (this.bar % 32 === 0) this.melCache.clear();
      let mel = this.melCache.get(key);
      if (!mel) {
        mel = genMelody(this.prog);
        this.melCache.set(key, mel);
      }
      this.melody = mel;
      const firstBars = this.bar < 4 && this.mood === 'title';
      this.melodyOn = !firstBars && (Math.random() < cfg.melody || (!this.melodyOn && Math.random() < 0.5));
    }
    this.chord = this.prog[inBar] as Chord;

    // layer levels
    const sea = this.mood === 'sea';
    this.lv.light = sea ? smooth(0.22, 0.55, this.I) : 0;
    this.lv.storm = sea ? smooth(0.6, 0.95, this.I) : 0;
    this.lv.bass = sea ? smooth(0.28, 0.55, this.I) : cfg.bass;
    const tc = barDur * 0.6;
    b.light.gain.setTargetAtTime(this.lv.light, t, tc);
    b.storm.gain.setTargetAtTime(this.lv.storm, t, tc);
    b.bass.gain.setTargetAtTime(this.lv.bass, t, tc);
    b.pad.gain.setTargetAtTime(0.16 * cfg.pad * (0.85 + 0.6 * (sea ? this.I : 0)), t, tc);
    b.padLp.frequency.setTargetAtTime(1300 + (sea ? 1300 * this.I : 0), t, tc);
    b.guitarLp.frequency.setTargetAtTime(cfg.warmth, t, tc);

    this.pad(t, barDur);

    // storm swells: rise over two bars into the next phrase downbeat
    if (this.lv.storm > 0.25 && inBar === 2) this.swell(t, barDur * 2);
  }

  private scheduleStep(t: number): void {
    if (this.step === 0) this.onBar(t);
    // smooth intensity a little every eighth (≈ 2 bars to mostly settle)
    this.I += (this.target - this.I) * 0.07;
    const cfg = MOODS[this.mood];
    const s = this.step;
    const sd = this.stepDur;
    const ch = this.chord;
    const hz = () => rnd(0, 0.008);

    // ---- guitar
    if (cfg.style === 'strum') {
      const bassVel = 0.85 * (1 - 0.4 * this.lv.bass);
      if (s === 0) this.pluck(t + hz(), fit(ch.root, 40), bassVel, sd * 5);
      if (this.I < 0.7) {
        if (s === 2) this.strum(t, ch, 0.42, true, sd * 2);
        if (s === 4) this.strum(t, ch, 0.34, Math.random() < 0.7, sd * 2);
        if (s === 5 && this.lv.bass < 0.3 && Math.random() < 0.2) this.pluck(t + hz(), fit(ch.tones[2] ?? ch.root, 40), 0.4, sd);
      } else {
        const vel = [0, 0, 0.46, 0.26, 0.42, 0.26][s] as number;
        if (vel) this.strum(t, ch, vel, s % 2 === 0, sd * 1.2);
      }
    } else {
      const root = fit(ch.root, 41);
      const fifth = fit(ch.tones[2] ?? ch.root, 48);
      const third = fit(ch.tones[1] ?? ch.root, 55);
      const top = fit(ch.root, 60);
      const seq = [root, fifth, third, top, third, fifth];
      const vel = [0.7, 0.34, 0.4, 0.38, 0.34, 0.3];
      this.pluck(t + hz(), seq[s] as number, vel[s] as number, s === 0 ? sd * 6 : sd * 3);
    }

    // ---- melody
    if (this.melodyOn) {
      const inBar = this.bar % 4;
      for (const n of this.melody) {
        if (n.bar !== inBar || n.step !== s) continue;
        const useLead = cfg.lead || (this.mood === 'sea' && this.I > 0.6);
        if (useLead) this.reed(t + 0.004, n.midi, n.vel * 0.9, n.len * sd);
        else this.pluck(t + hz(), n.midi, n.vel * 0.62, n.len * sd + 0.2);
      }
    }

    // ---- bass layer
    if (this.lv.bass > 0.02) {
      if (s === 0) this.bassNote(t, fit(ch.root, 38), 0.9, sd * 3.5);
      if (s === 4) this.bassNote(t, fit(ch.tones[2] ?? ch.root, 38), 0.65, sd * 1.8);
      if (s === 5 && this.I > 0.4 && this.mood === 'sea' && Math.random() < 0.6) {
        const next = (this.bar % 4 === 3 ? (this.nextProg ?? this.prog)[0] : this.prog[(this.bar % 4) + 1]) ?? ch;
        const target = fit(next.root, 38);
        const approach = target + (Math.random() < 0.5 ? -1 : 2);
        this.bassNote(t, approach, 0.5, sd * 0.9);
      }
    }

    // ---- light percussion (shaker, brush, soft kick)
    if (this.lv.light > 0.02 && cfg.drums) {
      const sv = [0.9, 0.45, 0.7, 0.45, 0.7, 0.5][s] as number;
      this.shaker(t, sv);
      if (this.lv.storm > 0.3) this.shaker(t + sd / 2, 0.35);
      if (s === 0) this.kick(t, 0.65);
      if (s === 2) this.brush(t, 0.5);
      if (s === 4) this.brush(t, 0.38);
    }

    // ---- storm drums
    if (this.lv.storm > 0.02 && cfg.drums) {
      const dest = (this.b as Buses).storm;
      if (s === 0) this.kick(t, 0.95, dest);
      if (s === 3) this.kick(t, 0.5, dest);
      const fill = this.bar % 4 === 3;
      if (fill && s >= 3) this.tom(t, [0, 0, 0, 1.5, 1.2, 1][s] as number, 0.6);
      else if (s === 2) this.tom(t, 1, 0.55);
      else if (s === 4) this.tom(t, 1.25, 0.45);
      if (this.bar % 4 === 0 && s === 0 && this.lv.storm > 0.25) this.crash(t, 0.8);
    }
  }

  // ------------------------------------------------------------ instruments

  private pluck(t: number, midi: number, vel: number, hold: number, dest?: AudioNode): void {
    const e = this.e as Engine;
    const buf = ksBuffer(e.ctx, midi);
    const v = this.voice(t, dest ?? (this.b as Buses).guitar);
    const src = v.buffer(buf, t, undefined, 1, false);
    const g = v.gain(vel);
    wire(src, g, v.out);
    const len = Math.min(hold, buf.duration - 0.05);
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t + len, 0.06);
    v.until(Math.min(t + buf.duration, t + len + 0.35));
    v.finish();
  }

  private strum(t: number, ch: Chord, vel: number, down: boolean, hold: number): void {
    // close triad around G3–F#4 plus the root underneath (e.g. F3 A3 C4 F4)
    const notes = ch.tones.slice(0, 3).map((pc) => fit(pc, 55));
    notes.push(fit(ch.root, 48));
    notes.sort((a, b) => a - b);
    if (!down) notes.reverse();
    const gap = down ? 0.016 : 0.011;
    notes.forEach((m, i) => this.pluck(t + i * gap + rnd(0, 0.004), m, vel * (down ? 1 - i * 0.08 : 0.8 + i * 0.05) * 0.55, hold));
  }

  private bassNote(t: number, midi: number, vel: number, len: number): void {
    const v = this.voice(t, (this.b as Buses).bass);
    const f = mtof(midi);
    const g = v.gain(0);
    const end = env(g.gain, t, 0.008, 0.55 * vel, Math.max(0.15, len));
    const tri = v.osc('triangle', f, t, end + 0.01);
    const saw = v.osc('sawtooth', f, t, end + 0.01);
    const sg = v.gain(0.22);
    const lp = v.filter('lowpass', 900, 1.2);
    sweep(lp.frequency, t, 900, 280, 0.25);
    wire(tri, lp);
    wire(saw, sg, lp);
    wire(lp, g, v.out);
    v.finish();
  }

  /** accordion chord for one bar (2 detuned saws per note, bellows swell, vibrato) */
  private pad(t: number, barDur: number): void {
    const ch = this.chord;
    const v = this.voice(t, (this.b as Buses).pad);
    const g = v.gain(0);
    const a = 0.32;
    const r = 0.45;
    const h = Math.max(0.05, barDur - a);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + a);
    g.gain.linearRampToValueAtTime(0.82, t + a + h * 0.5);
    g.gain.linearRampToValueAtTime(0.95, t + a + h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r);
    g.gain.setValueAtTime(0, t + a + h + r + 0.001);
    const end = t + a + h + r + 0.02;
    g.connect(v.out);
    const lfo = v.osc('sine', rnd(4.6, 5.4), t, end);
    const lg = v.gain(6);
    wire(lfo, lg);
    const notes = ch.tones.slice(0, 3).map((pc) => fit(pc, 53));
    for (const m of notes) {
      for (const det of [-7, 7]) {
        const o = v.osc('sawtooth', mtof(m), t, end);
        o.detune.value = det;
        lg.connect(o.detune);
        wire(o, v.gain(0.16), g);
      }
    }
    const sub = v.osc('sawtooth', mtof(fit(ch.root, 41)), t, end);
    lg.connect(sub.detune);
    wire(sub, v.gain(0.1), g);
    v.finish();
  }

  /** single accordion reed note (lead melody) */
  private reed(t: number, midi: number, vel: number, len: number): void {
    const v = this.voice(t, (this.b as Buses).lead);
    const f = mtof(midi);
    const g = v.gain(0);
    const end = ahr(g.gain, t, 0.04, 0.22 * vel, Math.max(0.05, len - 0.08), 0.12);
    const lfo = v.osc('sine', 5.2, t, end);
    const lg = v.gain(9);
    wire(lfo, lg);
    for (const [type, det, amp] of [
      ['sawtooth', -6, 0.5],
      ['sawtooth', 6, 0.5],
      ['square', 0, 0.18],
    ] as const) {
      const o = v.osc(type, f, t, end);
      o.detune.value = det;
      lg.connect(o.detune);
      wire(o, v.gain(amp), g);
    }
    g.connect(v.out);
    v.finish();
  }

  private shaker(t: number, vel: number): void {
    const v = this.voice(t, (this.b as Buses).light, rnd(-0.2, 0.3));
    const g = v.gain(0);
    const end = env(g.gain, t, vel > 0.6 ? 0.003 : 0.006, 0.16 * vel, vel > 0.6 ? 0.07 : 0.05);
    const src = v.noise('white', t, end + 0.01);
    wire(src, v.filter('highpass', 5500, 0.7), v.filter('peaking', 8000, 1, 3), g, v.out);
    v.finish();
  }

  private brush(t: number, vel: number): void {
    const v = this.voice(t, (this.b as Buses).light, 0.1);
    const g = v.gain(0);
    const end = env(g.gain, t, 0.012, 0.22 * vel, 0.16);
    const src = v.noise('pink', t, end + 0.01);
    wire(src, v.filter('bandpass', 2300, 0.6), g, v.out);
    const tg = v.gain(0);
    const e2 = env(tg.gain, t, 0.002, 0.12 * vel, 0.07);
    const o = v.osc('triangle', 190, t, e2 + 0.01);
    wire(o, tg, v.out);
    v.finish();
  }

  private kick(t: number, vel: number, dest?: AudioNode): void {
    const v = this.voice(t, dest ?? (this.b as Buses).light);
    const g = v.gain(0);
    const end = env(g.gain, t, 0.002, 0.6 * vel, 0.3);
    const o = v.osc('sine', 120, t, end + 0.01);
    sweep(o.frequency, t, 120, 46, 0.09);
    wire(o, g, v.out);
    const ng = v.gain(0);
    const e2 = env(ng.gain, t, 0.001, 0.07 * vel, 0.012);
    wire(v.noise('white', t, e2 + 0.01), v.filter('lowpass', 1300, 0.7), ng, v.out);
    v.finish();
  }

  private tom(t: number, pitch: number, vel: number): void {
    if (!pitch) return;
    const v = this.voice(t, (this.b as Buses).storm, (pitch - 1.2) * 0.8);
    const f = 150 * pitch;
    const g = v.gain(0);
    const end = env(g.gain, t, 0.003, 0.42 * vel, 0.38);
    const o = v.osc('sine', f, t, end + 0.01);
    sweep(o.frequency, t, f * 1.05, f * 0.68, 0.22);
    wire(o, g, v.out);
    const ng = v.gain(0);
    const e2 = env(ng.gain, t, 0.002, 0.11 * vel, 0.06);
    wire(v.noise('pink', t, e2 + 0.01), v.filter('bandpass', f * 3, 1), ng, v.out);
    v.finish();
  }

  private crash(t: number, vel: number): void {
    const v = this.voice(t, (this.b as Buses).storm, 0.3);
    const g = v.gain(0);
    const end = env(g.gain, t, 0.004, 0.075 * vel, 1.5);
    wire(v.noise('white', t, end + 0.01), v.filter('highpass', 4800, 0.7), v.filter('lowpass', 11000, 0.5), g, v.out);
    v.finish();
  }

  private swell(t: number, dur: number): void {
    const v = this.voice(t, (this.b as Buses).storm);
    const g = v.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.12);
    const bp = v.filter('bandpass', 260, 1.4);
    sweep(bp.frequency, t, 260, 3200, dur);
    wire(v.noise('pink', t, t + dur + 0.15), bp, g, v.out);
    v.until(t + dur + 0.15);
    v.finish();
  }
}

const score = new Score();

export const music: {
  start(): void;
  stop(fadeSec?: number): void;
  setIntensity(x: number): void;
  setMood(m: 'sea' | 'harbor' | 'galley' | 'title'): void;
} = {
  start: () => score.start(),
  stop: (fadeSec?: number) => score.stop(fadeSec),
  setIntensity: (x: number) => score.setIntensity(x),
  setMood: (m) => score.setMood(m),
};
