/**
 * Pot Luck audio engine core: lazily-created AudioContext, master chain,
 * shared noise buffers, generated reverb, and the `Voice` helper that every
 * synthesized one-shot is built on (tracks its nodes and tears itself down).
 *
 * Everything here is procedural WebAudio — no samples.
 */

export type NoiseKind = 'white' | 'pink' | 'brown';

export interface Engine {
  ctx: AudioContext;
  /** master volume / mute → destination */
  out: GainNode;
  /** everything sums here before the compressor */
  pre: GainNode;
  /** one-shots + loops; gain = sfx volume */
  sfxBus: GainNode;
  /** reverb send for sfx; gain = sfx volume */
  sfxSend: GainNode;
  /** loops / ambience → sfxBus */
  ambBus: GainNode;
  /** music output bus; gain = music volume × base level */
  musicBus: GainNode;
  /** reverb input (convolver) */
  reverbIn: GainNode;
  noise: Record<NoiseKind, AudioBuffer>;
  /** sparse random impulses — crackle/fizz/scratch texture */
  crackle: AudioBuffer;
  canPan: boolean;
}

const MUSIC_BASE = 0.55;
const NOISE_SECONDS = 3;

const settings = { master: 1, sfx: 1, music: 1, muted: false };

let E: Engine | null = null;
let failed = false;
const readyCbs: Array<() => void> = [];
let suspendedByVisibility = false;

// ---------------------------------------------------------------- utilities

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

/** connect nodes in series (Safari < 14.1 `connect()` doesn't return the destination) */
export function wire(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) (nodes[i] as AudioNode).connect(nodes[i + 1] as AudioNode);
  return nodes[nodes.length - 1] as AudioNode;
}

/** percussive envelope: 0 → peak (linear, `a` s) → ~0 (exponential, `d` s). Returns end time. */
export function env(p: AudioParam, t: number, a: number, peak: number, d: number): number {
  const pk = Math.max(peak, 0.00011);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.exponentialRampToValueAtTime(0.0001, t + a + d);
  p.setValueAtTime(0, t + a + d + 0.001);
  return t + a + d + 0.002;
}

/** attack / hold / release envelope. Returns end time. */
export function ahr(p: AudioParam, t: number, a: number, peak: number, h: number, r: number): number {
  const pk = Math.max(peak, 0.00011);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.setValueAtTime(pk, t + a + h);
  p.exponentialRampToValueAtTime(0.0001, t + a + h + r);
  p.setValueAtTime(0, t + a + h + r + 0.001);
  return t + a + h + r + 0.002;
}

/** exponential sweep of a (positive) param */
export function sweep(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(clamp(from, 0.0001, 22000), t);
  p.exponentialRampToValueAtTime(clamp(to, 0.0001, 22000), t + Math.max(dur, 0.001));
}

/** smoothly move a param toward `v` from now (cancels pending automation) */
export function rampParam(ctx: AudioContext, p: AudioParam, v: number, sec: number): void {
  const now = ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  if (sec <= 0.001) p.setValueAtTime(v, now);
  else p.linearRampToValueAtTime(v, now + sec);
}

function safeStop(n: AudioScheduledSourceNode, when: number): void {
  try {
    n.stop(when);
  } catch {
    /* already stopped (old WebKit throws) */
  }
}

function safeDisconnect(n: AudioNode): void {
  try {
    n.disconnect();
  } catch {
    /* noop */
  }
}

// ------------------------------------------------------------ buffer makers

function makeNoise(ctx: AudioContext, kind: NoiseKind): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * NOISE_SECONDS);
  const fade = Math.floor(sr * 0.05);
  const raw = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') raw[i] = w;
    else if (kind === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last;
    }
  }
  // seamless loop: crossfade the overhang into the head
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = raw[i] as number;
  for (let i = 0; i < fade; i++) {
    const x = i / fade;
    d[i] = (raw[i] as number) * x + (raw[n + i] as number) * (1 - x);
  }
  // remove DC + normalize
  let mean = 0;
  for (let i = 0; i < n; i++) mean += d[i] as number;
  mean /= n;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = (d[i] as number) - mean;
    d[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const g = 0.95 / (peak || 1);
  for (let i = 0; i < n; i++) d[i] = (d[i] as number) * g;
  return buf;
}

function makeCrackle(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let i = 0;
  while (i < n) {
    i += Math.floor(sr * (0.002 + Math.random() * Math.random() * 0.03));
    const amp = Math.pow(Math.random(), 2) * 0.95 + 0.05;
    const len = Math.floor(sr * (0.0004 + Math.random() * 0.0025));
    for (let k = 0; k < len && i + k < n; k++) {
      d[i + k] = (Math.random() * 2 - 1) * amp * Math.exp((-5 * k) / len);
    }
    i += len;
  }
  return buf;
}

/** soft, warm room/hall impulse (stereo, decorrelated, darkening tail) */
function makeImpulse(ctx: AudioContext, seconds = 2.0, rt60 = 1.7): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const x = i / n;
      const decay = Math.exp((-6.9 * t) / rt60) * (1 - x * x);
      const w = Math.random() * 2 - 1;
      const a = 0.6 - 0.5 * x; // darker as it decays
      lp += a * (w - lp);
      const fadeIn = t < 0.02 ? t / 0.02 : 1;
      d[i] = lp * decay * fadeIn;
    }
    // a few early reflections
    for (let r = 0; r < 6; r++) {
      const idx = pre + Math.floor(sr * (0.006 + Math.random() * 0.045));
      if (idx < n) d[idx] = (d[idx] as number) + (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.06);
    }
  }
  return buf;
}

// ------------------------------------------------------------------- engine

type CtxCtor = new (opts?: AudioContextOptions) => AudioContext;

function getCtor(): CtxCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  return w.AudioContext || w.webkitAudioContext || null;
}

function build(ctx: AudioContext): Engine {
  const g = (v: number): GainNode => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const out = g(settings.muted ? 0 : settings.master);
  const pre = g(0.85);

  // gentle glue compressor → brickwall-ish limiter → soft top-end
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 14;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3.5;
  lim.knee.value = 1;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 12500;
  soft.Q.value = 0.5;
  wire(pre, comp, lim, soft, out, ctx.destination);

  const sfxBus = g(settings.sfx);
  const sfxSend = g(settings.sfx);
  const ambBus = g(1);
  const musicBus = g(settings.music * MUSIC_BASE);
  sfxBus.connect(pre);
  ambBus.connect(sfxBus);
  musicBus.connect(pre);

  // shared reverb
  const reverbIn = g(1);
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx);
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass';
  revHp.frequency.value = 180;
  const revOut = g(0.42);
  wire(reverbIn, revHp, conv, revOut, pre);
  sfxSend.connect(reverbIn);
  const musicSend = g(0.22);
  wire(musicBus, musicSend, reverbIn);

  const noise: Record<NoiseKind, AudioBuffer> = {
    white: makeNoise(ctx, 'white'),
    pink: makeNoise(ctx, 'pink'),
    brown: makeNoise(ctx, 'brown'),
  };

  return {
    ctx,
    out,
    pre,
    sfxBus,
    sfxSend,
    ambBus,
    musicBus,
    reverbIn,
    noise,
    crackle: makeCrackle(ctx),
    canPan: typeof (ctx as AudioContext & { createStereoPanner?: unknown }).createStereoPanner === 'function',
  };
}

function fireReady(): void {
  if (!isReady()) return;
  const cbs = readyCbs.splice(0, readyCbs.length);
  for (const cb of cbs) {
    try {
      cb();
    } catch (err) {
      console.warn('[audio] ready callback failed', err);
    }
  }
}

function onVisibility(): void {
  if (!E) return;
  const ctx = E.ctx;
  if (document.hidden) {
    if (ctx.state === 'running') {
      suspendedByVisibility = true;
      ctx.suspend().catch(() => {});
    }
  } else if (suspendedByVisibility) {
    suspendedByVisibility = false;
    // may be refused on iOS without a gesture — the next unlock() call fixes it
    ctx.resume().then(fireReady, () => {});
  }
}

/** Create the context + graph if needed (call from a user gesture ideally). */
export function ensureEngine(): Engine | null {
  if (E || failed) return E;
  const Ctor = getCtor();
  if (!Ctor) {
    failed = true;
    return null;
  }
  try {
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      ctx = new Ctor();
    }
    E = build(ctx);
    ctx.onstatechange = () => fireReady();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  } catch (err) {
    console.warn('[audio] WebAudio unavailable', err);
    failed = true;
    E = null;
  }
  return E;
}

export function engine(): Engine | null {
  return E;
}

export function isReady(): boolean {
  return !!E && E.ctx.state === 'running';
}

/** Resume + iOS silent-buffer kick. Safe to call on every gesture. */
export function unlockEngine(): void {
  const e = ensureEngine();
  if (!e) return;
  const ctx = e.ctx;
  if (ctx.state === 'running') {
    fireReady();
    return;
  }
  suspendedByVisibility = false;
  try {
    const p = ctx.resume() as Promise<void> | undefined;
    if (p && typeof p.then === 'function') p.then(fireReady, () => {});
  } catch {
    /* noop */
  }
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
    s.onended = () => safeDisconnect(s);
  } catch {
    /* noop */
  }
  if ((ctx.state as AudioContextState) === 'running') fireReady();
}

/** Run `cb` once the context is running (immediately if it already is). Returns an unsubscribe fn. */
export function onAudioReady(cb: () => void): () => void {
  if (isReady()) {
    cb();
    return () => {};
  }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}

export function getNoise(kind: NoiseKind): AudioBuffer | null {
  return E ? E.noise[kind] : null;
}

// ----------------------------------------------------------------- settings

function applyLevels(): void {
  if (!E) return;
  const { ctx } = E;
  const now = ctx.currentTime;
  const set = (p: AudioParam, v: number) => {
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, 0.04);
  };
  set(E.out.gain, settings.muted ? 0 : settings.master);
  set(E.sfxBus.gain, settings.sfx);
  set(E.sfxSend.gain, settings.sfx);
  set(E.musicBus.gain, settings.music * MUSIC_BASE);
}

export function setLevel(which: 'master' | 'sfx' | 'music', v: number): void {
  settings[which] = clamp(Number.isFinite(v) ? v : 1, 0, 1);
  applyLevels();
}

export function setMutedFlag(m: boolean): void {
  settings.muted = !!m;
  applyLevels();
}

// -------------------------------------------------------------------- voice

export interface VoiceOpts {
  name: string;
  pitch?: number;
  volume?: number;
  pan?: number;
  /** reverb send amount (0..1) */
  send?: number;
  /** override destination (defaults to sfxBus) */
  dest?: AudioNode;
  /** counts toward the global one-shot cap (default true) */
  counted?: boolean;
}

export const MAX_VOICES = 24;
const voices: Voice[] = [];

export function activeVoices(): readonly Voice[] {
  return voices;
}

interface SrcRec {
  n: AudioScheduledSourceNode;
  stop: number | undefined;
}

/**
 * A self-cleaning group of nodes for one sound. Build the graph into `out`
 * using the factory helpers (they register nodes), extend `end` via `until()`,
 * then call `finish()`: all sources are stopped at `end` and every node is
 * disconnected shortly after.
 */
export class Voice {
  readonly e: Engine;
  readonly ctx: AudioContext;
  readonly name: string;
  /** start time (AudioContext seconds) */
  readonly t: number;
  /** pitch multiplier */
  readonly p: number;
  readonly out: GainNode;
  readonly counted: boolean;
  end: number;
  private nodes: AudioNode[] = [];
  private srcs: SrcRec[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dead = false;

  constructor(e: Engine, t: number, o: VoiceOpts) {
    this.e = e;
    this.ctx = e.ctx;
    this.name = o.name;
    this.t = t;
    this.p = clamp(o.pitch ?? 1, 0.05, 8);
    this.end = t + 0.05;
    this.counted = o.counted ?? true;
    const ctx = this.ctx;
    this.out = this.track(ctx.createGain());
    this.out.gain.value = clamp(o.volume ?? 1, 0, 8);
    let tail: AudioNode = this.out;
    const pan = o.pan ?? 0;
    if (pan && e.canPan) {
      const pn = this.track(ctx.createStereoPanner());
      pn.pan.value = clamp(pan, -1, 1);
      this.out.connect(pn);
      tail = pn;
    }
    tail.connect(o.dest ?? e.sfxBus);
    const send = o.send ?? 0;
    if (send > 0) {
      const s = this.gain(send);
      tail.connect(s);
      s.connect(e.sfxSend);
    }
    if (this.counted) voices.push(this);
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  until(t: number): void {
    if (t > this.end) this.end = t;
  }

  gain(v = 0): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, Q = 0.7071, gainDb = 0): BiquadFilterNode {
    const f = this.track(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = clamp(freq, 10, 22000);
    f.Q.value = Q;
    if (gainDb) f.gain.value = gainDb;
    return f;
  }

  shaper(curve: Float32Array): WaveShaperNode {
    const s = this.track(this.ctx.createWaveShaper());
    s.curve = curve as Float32Array<ArrayBuffer>;
    return s;
  }

  panner(pan: number): AudioNode {
    if (this.e.canPan) {
      const p = this.track(this.ctx.createStereoPanner());
      p.pan.value = clamp(pan, -1, 1);
      return p;
    }
    return this.gain(1);
  }

  osc(type: OscillatorType, freq: number, start = this.t, stop?: number): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = clamp(freq, 0.01, 22000);
    o.start(start);
    this.srcs.push({ n: o, stop });
    if (stop !== undefined) this.until(stop);
    return o;
  }

  oscWave(wave: PeriodicWave, freq: number, start = this.t, stop?: number): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    o.setPeriodicWave(wave);
    o.frequency.value = clamp(freq, 0.01, 22000);
    o.start(start);
    this.srcs.push({ n: o, stop });
    if (stop !== undefined) this.until(stop);
    return o;
  }

  /** looping noise source starting at a random offset */
  noise(kind: NoiseKind = 'white', start = this.t, stop?: number, rate = 1): AudioBufferSourceNode {
    return this.buffer(this.e.noise[kind], start, stop, rate);
  }

  crackle(start = this.t, stop?: number, rate = 1): AudioBufferSourceNode {
    return this.buffer(this.e.crackle, start, stop, rate);
  }

  buffer(b: AudioBuffer, start = this.t, stop?: number, rate = 1, loop = true): AudioBufferSourceNode {
    const s = this.track(this.ctx.createBufferSource());
    s.buffer = b;
    s.loop = loop;
    s.playbackRate.value = rate;
    s.start(start, loop ? Math.random() * b.duration * 0.9 : 0);
    this.srcs.push({ n: s, stop });
    if (stop !== undefined) this.until(stop);
    return s;
  }

  /** stop sources at their end times and schedule teardown */
  finish(): void {
    for (const s of this.srcs) safeStop(s.n, Math.max(s.stop ?? this.end, this.t + 0.001));
    this.scheduleCleanup();
  }

  private scheduleCleanup(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const ms = Math.max(0, (this.end - this.ctx.currentTime) * 1000) + 150;
    this.timer = setTimeout(() => {
      this.timer = null;
      // context suspended (tab hidden) → audio time hasn't reached the end yet
      if (!this.dead && this.ctx.currentTime < this.end - 0.02 && this.ctx.state !== 'closed') {
        this.scheduleCleanup();
        return;
      }
      this.cleanup();
    }, ms);
  }

  /** fade out fast and free (voice stealing / interruption) */
  kill(fade = 0.03): void {
    if (this.dead) return;
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    for (const s of this.srcs) safeStop(s.n, now + fade + 0.01);
    this.end = Math.min(this.end, now + fade + 0.02);
    this.removeFromList();
    this.scheduleCleanup();
  }

  private removeFromList(): void {
    const i = voices.indexOf(this);
    if (i >= 0) voices.splice(i, 1);
  }

  private cleanup(): void {
    if (this.dead) return;
    this.dead = true;
    for (const n of this.nodes) safeDisconnect(n);
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.removeFromList();
  }

  get alive(): boolean {
    return !this.dead;
  }
}

// --------------------------------------------------------- shared curves

const curveCache = new Map<string, Float32Array>();

/** tanh-ish soft clipper curve */
export function softClipCurve(drive: number): Float32Array {
  const key = 'clip' + drive;
  let c = curveCache.get(key);
  if (!c) {
    c = new Float32Array(1024);
    const norm = Math.tanh(drive);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(x * drive) / norm;
    }
    curveCache.set(key, c);
  }
  return c;
}

/**
 * Turns a sawtooth (-1..1 rising) into a unipolar pulse that fires at each
 * cycle start and decays: y = ((1 - x)/2)^k. Useful for chugs/purrs.
 */
export function pulseCurve(k: number): Float32Array {
  const key = 'pulse' + k;
  let c = curveCache.get(key);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.pow((1 - x) / 2, k);
    }
    curveCache.set(key, c);
  }
  return c;
}

/** smooth unipolar bump from a sine: y = ((x+1)/2)^k */
export function bumpCurve(k: number): Float32Array {
  const key = 'bump' + k;
  let c = curveCache.get(key);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.pow((x + 1) / 2, k);
    }
    curveCache.set(key, c);
  }
  return c;
}
