/**
 * Small reusable synthesis building blocks used by the one-shot recipes,
 * the loops and babble. Every helper takes a `Voice` (so nodes get cleaned
 * up), a time offset relative to the voice start, and frequencies that the
 * caller has already multiplied by the pitch param where appropriate.
 */
import type { NoiseKind, Voice } from './engine';
import { ahr, env, rnd, sweep, wire } from './engine';

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  /** glide target */
  f2?: number;
  /** glide duration (default: whole note) */
  glide?: number;
  at?: number;
  a?: number;
  d: number;
  /** optional hold before decay (ahr envelope) */
  h?: number;
  peak: number;
  dest?: AudioNode;
  detune?: number;
}

/** oscillator with optional exponential glide and a percussive / AHR envelope */
export function tone(v: Voice, o: ToneOpts): OscillatorNode {
  const t = v.t + (o.at ?? 0);
  const a = o.a ?? 0.004;
  const g = v.gain(0);
  const end = o.h !== undefined ? ahr(g.gain, t, a, o.peak, o.h, o.d) : env(g.gain, t, a, o.peak, o.d);
  const osc = v.osc(o.type ?? 'sine', o.f, t, end + 0.01);
  if (o.detune) osc.detune.value = o.detune;
  if (o.f2 !== undefined) sweep(osc.frequency, t, o.f, o.f2, o.glide ?? a + (o.h ?? 0) + o.d);
  wire(osc, g, o.dest ?? v.out);
  return osc;
}

export interface NoiseOpts {
  kind?: NoiseKind | 'crackle';
  type?: BiquadFilterType;
  f: number;
  f2?: number;
  sweep?: number;
  Q?: number;
  at?: number;
  a?: number;
  d: number;
  h?: number;
  peak: number;
  dest?: AudioNode;
  rate?: number;
}

/** filtered noise burst with optional exponential filter sweep */
export function noiseHit(v: Voice, o: NoiseOpts): BiquadFilterNode {
  const t = v.t + (o.at ?? 0);
  const a = o.a ?? 0.003;
  const g = v.gain(0);
  const end = o.h !== undefined ? ahr(g.gain, t, a, o.peak, o.h, o.d) : env(g.gain, t, a, o.peak, o.d);
  const src = o.kind === 'crackle' ? v.crackle(t, end + 0.01, o.rate ?? 1) : v.noise(o.kind ?? 'white', t, end + 0.01, o.rate ?? 1);
  const f = v.filter(o.type ?? 'bandpass', o.f, o.Q ?? 1);
  if (o.f2 !== undefined) sweep(f.frequency, t, o.f, o.f2, o.sweep ?? a + (o.h ?? 0) + o.d);
  wire(src, f, g, o.dest ?? v.out);
  return f;
}

/** [ratio, amplitude, decaySeconds] */
export type Partial = readonly [number, number, number];

/** sum of decaying sine partials (bells, chimes, metal rings) */
export function partials(
  v: Voice,
  f: number,
  list: readonly Partial[],
  o: { at?: number; a?: number; dest?: AudioNode; glide?: number; spread?: number } = {},
): void {
  const t = v.t + (o.at ?? 0);
  const a = o.a ?? 0.002;
  for (const [ratio, amp, dec] of list) {
    const fr = f * ratio * (o.spread ? 1 + rnd(-o.spread, o.spread) : 1);
    if (fr > 16000) continue;
    const g = v.gain(0);
    const end = env(g.gain, t, a, amp, dec);
    const osc = v.osc('sine', fr, t, end + 0.01);
    if (o.glide && o.glide !== 1) sweep(osc.frequency, t, fr / Math.sqrt(o.glide), fr * Math.sqrt(o.glide), Math.min(dec, 1.2));
    wire(osc, g, o.dest ?? v.out);
  }
}

/**
 * One gated noise chain re-used for many short clicks — far cheaper than a
 * node chain per click. `clicks` are [timeOffset, peak, decay, filterFreq].
 */
export function clickTrain(
  v: Voice,
  clicks: ReadonlyArray<readonly [number, number, number, number]>,
  o: { Q?: number; type?: BiquadFilterType; kind?: NoiseKind; dest?: AudioNode; ping?: number } = {},
): void {
  if (!clicks.length) return;
  const sorted = [...clicks].sort((x, y) => x[0] - y[0]);
  const last = sorted[sorted.length - 1] as readonly [number, number, number, number];
  const endT = v.t + last[0] + last[2] + 0.02;
  const src = v.noise(o.kind ?? 'white', v.t, endT);
  const f = v.filter(o.type ?? 'bandpass', sorted[0]?.[3] ?? 2000, o.Q ?? 3);
  const g = v.gain(0);
  wire(src, f, g, o.dest ?? v.out);
  // optional tonal "ping" layer (chitin / metal tick)
  let pingOsc: OscillatorNode | null = null;
  let pg: GainNode | null = null;
  if (o.ping) {
    pingOsc = v.osc('triangle', 2000, v.t, endT);
    pg = v.gain(0);
    wire(pingOsc, pg, o.dest ?? v.out);
  }
  let prevEnd = -1;
  for (const [at, peak, dec, freq] of sorted) {
    let t = v.t + at;
    if (t < prevEnd) t = prevEnd + 0.0005;
    f.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.0008 + dec);
    g.gain.setValueAtTime(0, t + 0.001 + dec);
    if (pingOsc && pg && o.ping) {
      pingOsc.frequency.setValueAtTime(freq * 0.9, t);
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(peak * o.ping, t + 0.001);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.001 + dec * 1.6);
      pg.gain.setValueAtTime(0, t + 0.002 + dec * 1.6);
    }
    prevEnd = t + 0.002 + dec * (o.ping ? 1.6 : 1);
  }
  v.until(endT);
}

/**
 * Sine "bubble/blip" train on a single oscillator: each event is an
 * exponential chirp f→f*ratio with its own little envelope.
 * events: [timeOffset, freq, ratio, dur, peak]
 */
export function chirpTrain(
  v: Voice,
  events: ReadonlyArray<readonly [number, number, number, number, number]>,
  o: { type?: OscillatorType; dest?: AudioNode; a?: number } = {},
): void {
  if (!events.length) return;
  const sorted = [...events].sort((x, y) => x[0] - y[0]);
  const last = sorted[sorted.length - 1] as readonly [number, number, number, number, number];
  const endT = v.t + last[0] + last[3] + 0.02;
  const osc = v.osc(o.type ?? 'sine', sorted[0]?.[1] ?? 500, v.t, endT);
  const g = v.gain(0);
  wire(osc, g, o.dest ?? v.out);
  const a = o.a ?? 0.004;
  let prevEnd = -1;
  for (const [at, f, ratio, dur, peak] of sorted) {
    let t = v.t + at;
    if (t < prevEnd) t = prevEnd + 0.001;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f * ratio), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.gain.setValueAtTime(0, t + dur + 0.001);
    prevEnd = t + dur + 0.002;
  }
  v.until(endT);
}

// ------------------------------------------------------------------ vocals

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'm';

/** rough formant pairs (scaled up a bit at use time for a small/cute voice) */
export const FORMANTS: Record<Vowel, readonly [number, number]> = {
  a: [780, 1250],
  e: [500, 1850],
  i: [320, 2300],
  o: [480, 860],
  u: [340, 760],
  m: [260, 900],
};

export interface VocalOpts {
  at: number;
  dur: number;
  /** fundamental (already pitch-scaled) */
  f0: number;
  /** [timeFrac, pitchMult] */
  contour: ReadonlyArray<readonly [number, number]>;
  /** [timeFrac, vowel] */
  vowels: ReadonlyArray<readonly [number, Vowel]>;
  peak: number;
  /** formant scale (smaller creature → higher) */
  fscale?: number;
  /** breathy "h" onset level */
  breath?: number;
  a?: number;
  r?: number;
  /** vibrato depth as a frequency fraction */
  vib?: number;
  vibRate?: number;
  dest?: AudioNode;
  type?: OscillatorType;
}

/** A wordless, formant-filtered vocal blip ("hup", "yay", "ow", "meow"…). */
export function vocal(v: Voice, o: VocalOpts): void {
  const t = v.t + o.at;
  const T = Math.max(0.03, o.dur);
  const a = o.a ?? 0.012;
  const r = o.r ?? 0.04;
  const fs = o.fscale ?? 1.15;
  const endT = t + T + r + 0.02;
  const osc = v.osc(o.type ?? 'sawtooth', o.f0, t, endT);
  const c0 = o.contour[0]?.[1] ?? 1;
  osc.frequency.setValueAtTime(o.f0 * c0, t);
  for (const [frac, m] of o.contour.slice(1)) osc.frequency.exponentialRampToValueAtTime(o.f0 * m, t + frac * T);
  if (o.vib) {
    const lfo = v.osc('sine', o.vibRate ?? 6.5, t, endT);
    const lg = v.gain(o.f0 * o.vib);
    wire(lfo, lg);
    lg.connect(osc.frequency);
  }
  const lp = v.filter('lowpass', Math.min(5200, 3200 * fs), 0.7);
  osc.connect(lp);
  const v0 = FORMANTS[o.vowels[0]?.[1] ?? 'a'];
  const f1 = v.filter('bandpass', v0[0] * fs, 5);
  const f2 = v.filter('bandpass', v0[1] * fs, 7);
  for (const [frac, vw] of o.vowels.slice(1)) {
    const fm = FORMANTS[vw];
    f1.frequency.linearRampToValueAtTime(fm[0] * fs, t + frac * T);
    f2.frequency.linearRampToValueAtTime(fm[1] * fs, t + frac * T);
  }
  const g1 = v.gain(2.2);
  const g2 = v.gain(1.5);
  const dry = v.gain(0.16);
  const eg = v.gain(0);
  wire(lp, f1, g1, eg);
  wire(lp, f2, g2, eg);
  wire(lp, dry, eg);
  eg.connect(o.dest ?? v.out);
  ahr(eg.gain, t, a, o.peak, Math.max(0, T - a), r);
  if (o.breath) {
    noiseHit(v, { kind: 'pink', type: 'bandpass', f: 1600 * fs, Q: 0.8, at: Math.max(0, o.at - 0.035), a: 0.012, d: 0.05, peak: o.breath, dest: o.dest });
  }
}

/** short squeaky chirp (otters, squeaks) */
export function chirp(v: Voice, at: number, f: number, dur: number, peak: number, dest?: AudioNode): void {
  const t = v.t + at;
  const endT = t + dur + 0.02;
  const osc = v.osc('triangle', f * 0.85, t, endT);
  osc.frequency.setValueAtTime(f * 0.85, t);
  osc.frequency.exponentialRampToValueAtTime(f * 1.25, t + dur * 0.4);
  osc.frequency.exponentialRampToValueAtTime(f, t + dur);
  const lfo = v.osc('sine', 32, t, endT);
  const lg = v.gain(f * 0.03);
  wire(lfo, lg);
  lg.connect(osc.frequency);
  const bp = v.filter('bandpass', f * 1.4, 1.2);
  const g = v.gain(0);
  wire(osc, bp, g, dest ?? v.out);
  ahr(g.gain, t, 0.008, peak, dur * 0.6, dur * 0.4);
}

/**
 * Stick-slip creak: a sawtooth pulse train (rate = stick-slip frequency)
 * ringing two resonant body filters. Used by 'creak', 'ropeCreak' and the hull loop.
 */
export function creak(
  v: Voice,
  o: { at?: number; rate0: number; rate1: number; dur: number; f1: number; f2: number; Q: number; peak: number; dest?: AudioNode; jitter?: number },
): void {
  const t = v.t + (o.at ?? 0);
  const endT = t + o.dur + 0.05;
  const osc = v.osc('sawtooth', o.rate0, t, endT);
  // irregular stick-slip rate
  const steps = Math.max(3, Math.floor(o.dur / 0.06));
  osc.frequency.setValueAtTime(o.rate0, t);
  for (let i = 1; i <= steps; i++) {
    const x = i / steps;
    const base = o.rate0 + (o.rate1 - o.rate0) * Math.sin((x * Math.PI) / 2);
    const j = 1 + rnd(-1, 1) * (o.jitter ?? 0.12);
    osc.frequency.linearRampToValueAtTime(Math.max(4, base * j), t + x * o.dur);
  }
  const hp = v.filter('highpass', 120, 0.7);
  const r1 = v.filter('bandpass', o.f1, o.Q);
  const r2 = v.filter('bandpass', o.f2, o.Q * 1.2);
  const g1 = v.gain(4.2);
  const g2 = v.gain(2.4);
  const eg = v.gain(0);
  osc.connect(hp);
  wire(hp, r1, g1, eg);
  wire(hp, r2, g2, eg);
  // resonance glides slightly with the strain
  sweep(r1.frequency, t, o.f1 * 0.94, o.f1 * 1.06, o.dur);
  sweep(r2.frequency, t, o.f2 * 0.96, o.f2 * 1.04, o.dur);
  eg.connect(o.dest ?? v.out);
  const a = Math.min(0.09, o.dur * 0.3);
  const r = Math.min(0.14, o.dur * 0.35);
  ahr(eg.gain, t, a, o.peak, Math.max(0, o.dur - a - r), r);
}

/** low-frequency thump (impacts) */
export function thump(v: Voice, at: number, f: number, f2: number, d: number, peak: number, dest?: AudioNode): void {
  tone(v, { f, f2, glide: d * 0.6, at, a: 0.003, d, peak, dest });
}
