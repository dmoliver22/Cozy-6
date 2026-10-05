/**
 * Continuous ambience loops (sea, wind, engine, winch…). Each loop owns a
 * small persistent node graph plus, where needed, a self-scheduling "tick"
 * that queues random events (waves, gusts, creaks, pops) slightly ahead on
 * the AudioContext clock.
 *
 * A loop handle can be created before the audio is unlocked; it builds and
 * fades in as soon as the engine exists.
 */
import type { Engine, NoiseKind } from './engine';
import { Voice, bumpCurve, clamp, pulseCurve, rampParam, rnd, wire } from './engine';
import { creak } from './atoms';
import type { LoopHandle, LoopName } from './sfx';

const LOOKAHEAD = 0.35;
const TICK_MS = 100;

const live = new Set<LoopBase>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let currentEngine: Engine | null = null;

function ensureTicker(): void {
  if (tickTimer !== null || !live.size) return;
  tickTimer = setInterval(() => {
    if (!currentEngine) return;
    const now = currentEngine.ctx.currentTime;
    for (const l of live) {
      try {
        l.tick(now);
      } catch (err) {
        console.warn('[audio] loop tick failed', err);
      }
    }
    if (!live.size && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }, TICK_MS);
}

/** build every pending loop (called once the engine exists) */
export function startPendingLoops(e: Engine): void {
  currentEngine = e;
  for (const l of live) l.build(e);
  ensureTicker();
}

abstract class LoopBase implements LoopHandle {
  protected e: Engine | null = null;
  protected ctx: AudioContext | null = null;
  protected out: GainNode | null = null;
  protected mix: GainNode | null = null;
  protected vol: number;
  protected pitch: number;
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  private built = false;
  private stopped = false;

  constructor(
    readonly name: LoopName,
    private readonly base: number,
    private readonly sendAmt: number,
    vol: number,
    pitch: number,
  ) {
    this.vol = clamp(vol, 0, 2);
    this.pitch = clamp(pitch, 0.1, 4);
    // NB: building happens in createLoop(), after subclass fields are initialised
  }

  build(e: Engine): void {
    if (this.built || this.stopped) return;
    this.built = true;
    this.e = e;
    this.ctx = e.ctx;
    const ctx = e.ctx;
    this.out = this.g(0);
    this.out.connect(e.ambBus);
    if (this.sendAmt > 0) wire(this.out, this.g(this.sendAmt), e.sfxSend);
    this.mix = this.g(1);
    this.mix.connect(this.out);
    this.make(ctx, this.mix);
    this.applyPitch(0);
    const now = ctx.currentTime;
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(this.vol * this.base, now + 0.8);
  }

  // ---- node helpers (tracked for teardown; sources start immediately)
  protected g(v = 1): GainNode {
    const n = (this.ctx as AudioContext).createGain();
    n.gain.value = v;
    this.nodes.push(n);
    return n;
  }
  protected f(type: BiquadFilterType, freq: number, Q = 0.7071, gainDb = 0): BiquadFilterNode {
    const n = (this.ctx as AudioContext).createBiquadFilter();
    n.type = type;
    n.frequency.value = freq;
    n.Q.value = Q;
    if (gainDb) n.gain.value = gainDb;
    this.nodes.push(n);
    return n;
  }
  protected o(type: OscillatorType, freq: number): OscillatorNode {
    const n = (this.ctx as AudioContext).createOscillator();
    n.type = type;
    n.frequency.value = freq;
    n.start();
    this.nodes.push(n);
    this.srcs.push(n);
    return n;
  }
  protected n(kind: NoiseKind | 'crackle', rate = 1): AudioBufferSourceNode {
    const e = this.e as Engine;
    const b = kind === 'crackle' ? e.crackle : e.noise[kind];
    const n = e.ctx.createBufferSource();
    n.buffer = b;
    n.loop = true;
    n.playbackRate.value = rate;
    n.start(0, Math.random() * b.duration * 0.9);
    this.nodes.push(n);
    this.srcs.push(n);
    return n;
  }
  protected shaper(curve: Float32Array): WaveShaperNode {
    const n = (this.ctx as AudioContext).createWaveShaper();
    n.curve = curve as Float32Array<ArrayBuffer>;
    this.nodes.push(n);
    return n;
  }
  protected pan(p: number): AudioNode {
    const e = this.e as Engine;
    if (e.canPan) {
      const n = e.ctx.createStereoPanner();
      n.pan.value = p;
      this.nodes.push(n);
      return n;
    }
    return this.g(1);
  }
  /** param glide helper honoring the ramp time */
  protected to(p: AudioParam, v: number, ramp: number): void {
    rampParam(this.ctx as AudioContext, p, v, ramp);
  }
  /** one-shot voice routed into this loop's mix (not counted in the global cap) */
  protected voice(t: number, pan = 0): Voice | null {
    if (!this.e || !this.mix) return null;
    return new Voice(this.e, t, { name: 'loop:' + this.name, dest: this.mix, counted: false, pan });
  }

  protected abstract make(ctx: AudioContext, mix: GainNode): void;
  protected applyPitch(_ramp: number): void {}
  /** schedule events up to `now + LOOKAHEAD` */
  protected events(_now: number, _until: number): void {}

  tick(now: number): void {
    if (!this.built || this.stopped) return;
    this.events(now, now + LOOKAHEAD);
  }

  // ---- LoopHandle
  setVolume(v: number, rampSec = 0.25): void {
    this.vol = clamp(Number.isFinite(v) ? v : 0, 0, 2);
    if (this.out && !this.stopped) this.to(this.out.gain, this.vol * this.base, rampSec);
  }
  setPitch(p: number, rampSec = 0.25): void {
    this.pitch = clamp(Number.isFinite(p) ? p : 1, 0.1, 4);
    if (this.built && !this.stopped) this.applyPitch(rampSec);
  }
  stop(fadeSec = 0.6): void {
    if (this.stopped) return;
    this.stopped = true;
    live.delete(this);
    if (!this.built || !this.out || !this.ctx) return;
    const ctx = this.ctx;
    const fade = Math.max(0.02, fadeSec);
    this.to(this.out.gain, 0, fade);
    const end = ctx.currentTime + fade + 0.05;
    for (const s of this.srcs) {
      try {
        s.stop(end);
      } catch {
        /* noop */
      }
    }
    setTimeout(
      () => {
        for (const n of this.nodes) {
          try {
            n.disconnect();
          } catch {
            /* noop */
          }
        }
        this.nodes.length = 0;
        this.srcs.length = 0;
      },
      fade * 1000 + 300,
    );
  }

  protected get level(): number {
    return this.vol;
  }
}

// ======================================================================= sea

class SeaLoop extends LoopBase {
  private layers: Array<{ body: GainNode; lp: BiquadFilterNode; foam: GainNode; next: number }> = [];
  private rumble: BiquadFilterNode | null = null;

  protected make(ctx: AudioContext, mix: GainNode): void {
    this.rumble = this.f('lowpass', 150, 0.6);
    wire(this.n('brown'), this.rumble, this.g(0.5), mix);
    const now = ctx.currentTime;
    for (const side of [-0.55, 0.55]) {
      const p = this.pan(side);
      p.connect(mix);
      const lp = this.f('lowpass', 320, 0.7);
      const body = this.g(0.15);
      wire(this.n('brown'), lp, body, p);
      const bp = this.f('bandpass', 1500, 0.55);
      const foam = this.g(0);
      wire(this.n('pink'), bp, foam, p);
      this.layers.push({ body, lp, foam, next: now + (side < 0 ? 0.2 : rnd(1.6, 2.6)) });
    }
  }

  protected applyPitch(ramp: number): void {
    if (this.rumble) this.to(this.rumble.frequency, 150 * Math.pow(this.pitch, 0.4), ramp);
  }

  protected events(now: number, until: number): void {
    const sp = Math.pow(this.pitch, 0.5);
    const bright = Math.pow(this.pitch, 0.6);
    for (const L of this.layers) {
      if (L.next < now - 1) L.next = now + 0.1;
      while (L.next < until) {
        const t = Math.max(L.next, now + 0.02);
        const rise = rnd(1.3, 2.5) / sp;
        const fall = rnd(2.0, 3.6) / sp;
        const amp = rnd(0.5, 1.0);
        L.body.gain.setTargetAtTime(amp, t, rise / 3);
        L.body.gain.setTargetAtTime(0.14, t + rise, fall / 3);
        L.lp.frequency.setTargetAtTime(Math.min(2400, (330 + 650 * amp) * bright), t, rise / 3);
        L.lp.frequency.setTargetAtTime(280 * bright, t + rise, fall / 3);
        L.foam.gain.setTargetAtTime(amp * 0.32 * bright, t + rise * 0.65, rise / 4);
        L.foam.gain.setTargetAtTime(0, t + rise + 0.25, fall / 4);
        L.next = t + rise + fall * rnd(0.45, 0.75);
      }
    }
  }
}

// ====================================================================== wind

class WindLoop extends LoopBase {
  private bands: Array<{ bp: BiquadFilterNode; g: GainNode; base: number }> = [];
  private whistle: BiquadFilterNode | null = null;
  private whistleG: GainNode | null = null;
  private hiss: GainNode | null = null;
  private next = 0;

  protected make(ctx: AudioContext, mix: GainNode): void {
    for (const [side, base] of [
      [-0.45, 480],
      [0.45, 640],
    ] as const) {
      const p = this.pan(side);
      p.connect(mix);
      const bp = this.f('bandpass', base, 1.5);
      const g = this.g(0.4);
      wire(this.n('pink'), bp, g, p);
      this.bands.push({ bp, g, base });
    }
    this.whistle = this.f('bandpass', 1150, 16);
    this.whistleG = this.g(0);
    wire(this.n('pink'), this.whistle, this.whistleG, mix);
    const hp = this.f('highpass', 3600, 0.6);
    this.hiss = this.g(0.05);
    wire(this.n('white'), hp, this.hiss, mix);
    this.next = ctx.currentTime + 0.1;
  }

  private get intensity(): number {
    return clamp(this.pitch, 0.2, 3);
  }

  protected applyPitch(ramp: number): void {
    const k = 0.75 + 0.25 * this.intensity;
    for (const b of this.bands) this.to(b.bp.frequency, b.base * k, Math.max(ramp, 0.3));
    if (this.whistle) this.to(this.whistle.frequency, 1150 * k, Math.max(ramp, 0.3));
  }

  protected events(now: number, until: number): void {
    const I = this.intensity;
    if (this.next < now - 1) this.next = now + 0.1;
    while (this.next < until) {
      const t = Math.max(this.next, now + 0.02);
      const s = rnd(0.25, 1);
      const tc = rnd(0.35, 1.1) / Math.sqrt(I);
      const k = 0.75 + 0.25 * I;
      for (const b of this.bands) {
        const sb = clamp(s + rnd(-0.15, 0.15), 0.1, 1);
        b.g.gain.setTargetAtTime((0.25 + 0.75 * sb) * (0.6 + 0.4 * Math.min(I, 1.6)), t, tc);
        b.bp.frequency.setTargetAtTime(b.base * k * (0.7 + 0.75 * sb), t, tc);
      }
      if (this.whistle && this.whistleG) {
        this.whistle.frequency.setTargetAtTime(1150 * k * (0.85 + 0.45 * s), t, tc * 1.3);
        this.whistleG.gain.setTargetAtTime(Math.max(0, s * (I - 0.4)) * 4, t, tc * 1.2);
      }
      if (this.hiss) this.hiss.gain.setTargetAtTime(0.03 + 0.12 * s * I, t, tc);
      this.next = t + rnd(1.1, 3.4) / Math.sqrt(I);
    }
  }
}

// ==================================================================== engine

class EngineLoop extends LoopBase {
  private oscs: Array<{ o: OscillatorNode; m: number }> = [];
  private lfo: OscillatorNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private rattle: BiquadFilterNode | null = null;

  protected make(_ctx: AudioContext, mix: GainNode): void {
    const chug = this.g(0.3);
    for (const [type, m, amp] of [
      ['sawtooth', 1, 0.55],
      ['sawtooth', 1.007, 0.45],
      ['square', 0.5, 0.4],
    ] as const) {
      const o = this.o(type, 42 * m);
      wire(o, this.g(amp), chug);
      this.oscs.push({ o, m });
    }
    this.rattle = this.f('bandpass', 150, 1.2);
    wire(this.n('brown'), this.rattle, this.g(0.9), chug);
    // firing pulses (the "chug")
    this.lfo = this.o('sawtooth', 10);
    const sh = this.shaper(pulseCurve(2));
    const depth = this.g(0.75);
    wire(this.lfo, sh, depth);
    depth.connect(chug.gain);
    this.lp = this.f('lowpass', 260, 1.6);
    wire(chug, this.lp, this.g(1.3), mix);
    // faint tappet clatter riding the pulses
    const tapBp = this.f('bandpass', 2600, 2.5);
    const tapG = this.g(0);
    const tapSh = this.shaper(pulseCurve(10));
    const tapDepth = this.g(0.06);
    wire(this.lfo, tapSh, tapDepth);
    tapDepth.connect(tapG.gain);
    wire(this.n('white'), tapBp, tapG, mix);
  }

  protected applyPitch(ramp: number): void {
    const p = this.pitch;
    for (const { o, m } of this.oscs) this.to(o.frequency, 42 * m * p, ramp);
    if (this.lfo) this.to(this.lfo.frequency, 10 * p, ramp);
    if (this.lp) this.to(this.lp.frequency, 260 * Math.pow(p, 0.8), ramp);
    if (this.rattle) this.to(this.rattle.frequency, 150 * p, ramp);
  }
}

// ===================================================================== winch

class WinchLoop extends LoopBase {
  private whine: Array<{ o: OscillatorNode; m: number }> = [];
  private motor: OscillatorNode | null = null;
  private gearLfo: OscillatorNode | null = null;
  private whineG: GainNode | null = null;
  private hissG: GainNode | null = null;

  protected make(_ctx: AudioContext, mix: GainNode): void {
    this.whineG = this.g(0.35);
    const lp = this.f('lowpass', 2600, 0.7);
    wire(this.whineG, lp, mix);
    const vib = this.o('sine', 5.2);
    const vibG = this.g(7);
    vib.connect(vibG);
    const wander = this.o('sine', 0.27);
    const wanderG = this.g(16);
    wander.connect(wanderG);
    for (const [type, m, amp] of [
      ['triangle', 1, 0.6],
      ['sine', 2, 0.28],
      ['sine', 3, 0.07],
    ] as const) {
      const o = this.o(type, 310 * m);
      vibG.connect(o.detune);
      wanderG.connect(o.detune);
      wire(o, this.g(amp), this.whineG);
      this.whine.push({ o, m });
    }
    this.motor = this.o('sawtooth', 155);
    wire(this.motor, this.f('lowpass', 650, 1), this.g(0.16), mix);
    this.hissG = this.g(0.05);
    wire(this.n('pink'), this.f('bandpass', 1500, 0.9), this.hissG, mix);
    // gear rumble pulsing with drum rotation
    const gear = this.g(0.08);
    wire(this.n('brown'), this.f('lowpass', 260, 0.8), gear, mix);
    this.gearLfo = this.o('sine', 12);
    const gs = this.shaper(bumpCurve(2));
    const gd = this.g(0.18);
    wire(this.gearLfo, gs, gd);
    gd.connect(gear.gain);
  }

  protected applyPitch(ramp: number): void {
    const p = this.pitch;
    for (const { o, m } of this.whine) this.to(o.frequency, 310 * m * p, ramp);
    if (this.motor) this.to(this.motor.frequency, 155 * p, ramp);
    if (this.gearLfo) this.to(this.gearLfo.frequency, 12 * p, ramp);
    if (this.whineG) this.to(this.whineG.gain, 0.22 + 0.18 * clamp(p, 0.3, 2.2), ramp);
    if (this.hissG) this.to(this.hissG.gain, 0.03 + 0.03 * p, ramp);
  }
}

// ====================================================================== hull

class HullLoop extends LoopBase {
  private next = 0;
  protected make(ctx: AudioContext): void {
    this.next = ctx.currentTime + rnd(0.5, 2);
  }
  protected events(now: number, until: number): void {
    if (this.next < now - 1) this.next = now + rnd(0.3, 1.5);
    while (this.next < until) {
      const t = Math.max(this.next, now + 0.02);
      const weather = clamp(this.level, 0, 1.5);
      if (weather > 0.02) this.creakAt(t);
      const density = 0.45 + 0.9 * weather;
      this.next = t + rnd(1.4, 5.5) / density;
    }
  }
  private creakAt(t: number): void {
    const v = this.voice(t, rnd(-0.75, 0.75));
    if (!v) return;
    const p = this.pitch;
    if (Math.random() < 0.3) {
      // deep hull groan
      const f1 = rnd(170, 260) * p;
      creak(v, { rate0: rnd(14, 22) * p, rate1: rnd(22, 34) * p, dur: rnd(0.9, 1.6), f1, f2: f1 * 2.25, Q: 12, peak: rnd(0.3, 0.5) });
    } else {
      const f1 = rnd(300, 540) * p;
      creak(v, { rate0: rnd(22, 40) * p, rate1: rnd(40, 70) * p, dur: rnd(0.4, 0.9), f1, f2: f1 * 2.2, Q: 10, peak: rnd(0.2, 0.42) });
      if (Math.random() < 0.25) {
        const f = rnd(300, 540) * p;
        creak(v, { at: rnd(0.5, 0.9), rate0: rnd(25, 45) * p, rate1: rnd(45, 70) * p, dur: rnd(0.25, 0.5), f1: f, f2: f * 2.2, Q: 10, peak: rnd(0.15, 0.3) });
      }
    }
    v.finish();
  }
}

// ===================================================================== stove

class StoveLoop extends LoopBase {
  private popF: BiquadFilterNode | null = null;
  private popG: GainNode | null = null;
  private thumpG: GainNode | null = null;
  private next = 0;
  private last = 0;

  protected make(ctx: AudioContext, mix: GainNode): void {
    const roar = this.g(0.32);
    wire(this.n('brown'), this.f('lowpass', 650, 0.7), roar, mix);
    const wob = this.o('sine', 0.31);
    const wobG = this.g(0.08);
    wire(wob, wobG);
    wobG.connect(roar.gain);
    wire(this.n('pink'), this.f('bandpass', 2800, 0.7), this.g(0.035), mix);
    this.popF = this.f('bandpass', 2500, 2.2);
    this.popG = this.g(0);
    wire(this.n('white'), this.popF, this.popG, mix);
    this.thumpG = this.g(0);
    wire(this.n('brown'), this.f('lowpass', 380, 0.8), this.thumpG, mix);
    this.next = ctx.currentTime + 0.1;
  }

  protected events(now: number, until: number): void {
    if (!this.popF || !this.popG || !this.thumpG) return;
    if (this.next < now - 1) this.next = now + 0.05;
    const rate = 6 * this.pitch;
    while (this.next < until) {
      const t = Math.max(this.next, now + 0.01, this.last + 0.012);
      const big = Math.random() < 0.08;
      const peak = big ? rnd(0.6, 0.9) : Math.pow(Math.random(), 2) * 0.55 + 0.05;
      const dec = big ? rnd(0.015, 0.03) : rnd(0.003, 0.014);
      this.popF.frequency.setValueAtTime(big ? rnd(900, 1800) : rnd(1400, 5200), t);
      const g = this.popG.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + 0.0006);
      g.exponentialRampToValueAtTime(0.0001, t + 0.0006 + dec);
      g.setValueAtTime(0, t + 0.001 + dec);
      if (big) {
        const tg = this.thumpG.gain;
        tg.setValueAtTime(0, t);
        tg.linearRampToValueAtTime(0.6, t + 0.002);
        tg.exponentialRampToValueAtTime(0.0001, t + 0.06);
        tg.setValueAtTime(0, t + 0.061);
      }
      this.last = t + 0.002 + Math.max(dec, big ? 0.061 : 0);
      // Poisson-ish spacing with occasional bursts
      const gap = Math.random() < 0.15 ? rnd(0.015, 0.05) : -Math.log(1 - Math.random()) / rate;
      this.next = t + gap;
    }
  }
}

// ====================================================================== purr

class PurrLoop extends LoopBase {
  private lfo: OscillatorNode | null = null;
  private breath: GainNode | null = null;
  private next = 0;

  protected make(ctx: AudioContext, mix: GainNode): void {
    const am = this.g(0);
    this.lfo = this.o('sawtooth', 25);
    const sh = this.shaper(pulseCurve(2.5));
    this.lfo.connect(sh);
    sh.connect(am.gain);
    this.breath = this.g(0);
    wire(this.n('brown'), am, this.f('lowpass', 520, 0.8), this.f('peaking', 180, 1.2, 6), this.breath, mix);
    wire(sh, this.f('lowpass', 140, 0.8), this.g(0.35), this.breath);
    this.next = ctx.currentTime + 0.05;
  }

  protected events(now: number, until: number): void {
    if (!this.lfo || !this.breath) return;
    if (this.next < now - 1) this.next = now + 0.05;
    const p = this.pitch;
    while (this.next < until) {
      const t = Math.max(this.next, now + 0.02);
      const ex = rnd(0.85, 1.15);
      const inh = rnd(0.65, 0.85);
      const b = this.breath.gain;
      const f = this.lfo.frequency;
      f.setTargetAtTime(rnd(25, 27) * p, t, 0.03);
      b.setTargetAtTime(1.0, t, 0.06);
      b.setTargetAtTime(0.05, t + ex, 0.03);
      f.setTargetAtTime(rnd(22, 24) * p, t + ex + 0.08, 0.03);
      b.setTargetAtTime(0.68, t + ex + 0.09, 0.05);
      b.setTargetAtTime(0.05, t + ex + 0.09 + inh, 0.03);
      this.next = t + ex + 0.09 + inh + 0.1;
    }
  }
}

// ================================================================ deck water

class DeckWaterLoop extends LoopBase {
  private lp: BiquadFilterNode | null = null;
  private sl: GainNode | null = null;
  private panP: AudioParam | null = null;
  private trickle: GainNode | null = null;
  private drop: OscillatorNode | null = null;
  private dropG: GainNode | null = null;
  private next = 0;
  private lastDrop = 0;
  private dir = 1;

  protected make(ctx: AudioContext, mix: GainNode): void {
    this.lp = this.f('lowpass', 600, 0.9);
    this.sl = this.g(0.15);
    const pn = this.pan(0);
    this.panP = (pn as StereoPannerNode).pan ?? null;
    wire(this.n('pink'), this.lp, this.sl, pn, mix);
    this.trickle = this.g(0.03);
    wire(this.n('white'), this.f('bandpass', 3200, 1.2), this.trickle, mix);
    this.drop = this.o('sine', 800);
    this.dropG = this.g(0);
    wire(this.drop, this.dropG, mix);
    this.next = ctx.currentTime + 0.1;
  }

  protected events(now: number, until: number): void {
    if (!this.lp || !this.sl || !this.trickle || !this.drop || !this.dropG) return;
    if (this.next < now - 1) this.next = now + 0.1;
    const sp = Math.sqrt(this.pitch);
    while (this.next < until) {
      const t = Math.max(this.next, now + 0.02);
      const period = rnd(2.0, 3.2) / sp;
      const amp = rnd(0.55, 1);
      this.sl.gain.setTargetAtTime(amp, t, 0.25);
      this.sl.gain.setTargetAtTime(0.12, t + period * 0.45, 0.4);
      this.lp.frequency.setTargetAtTime(700 + 1100 * amp, t, 0.22);
      this.lp.frequency.setTargetAtTime(480, t + period * 0.45, 0.4);
      this.trickle.gain.setTargetAtTime(0.06 * amp, t + 0.3, 0.3);
      this.trickle.gain.setTargetAtTime(0.02, t + period * 0.6, 0.5);
      if (this.panP) {
        this.panP.setTargetAtTime(0.6 * this.dir, t, period * 0.3);
        this.dir = -this.dir;
      }
      // droplets around the crest, strictly increasing in time on one osc
      const n = 2 + Math.floor(Math.random() * 4);
      let dt = Math.max(t + 0.15, this.lastDrop + 0.02);
      for (let i = 0; i < n; i++) {
        dt += rnd(0.06, 0.35);
        const f = rnd(600, 1500);
        const dur = rnd(0.03, 0.06);
        this.drop.frequency.setValueAtTime(f, dt);
        this.drop.frequency.exponentialRampToValueAtTime(f * rnd(1.4, 1.9), dt + dur);
        const g = this.dropG.gain;
        g.setValueAtTime(0, dt);
        g.linearRampToValueAtTime(rnd(0.03, 0.08) * amp, dt + 0.004);
        g.exponentialRampToValueAtTime(0.0001, dt + dur);
        g.setValueAtTime(0, dt + dur + 0.001);
        dt += dur + 0.002;
      }
      this.lastDrop = dt;
      this.next = t + period;
    }
  }
}

// ==================================================================== factory

export function createLoop(name: LoopName, volume: number, pitch: number): LoopHandle {
  const l = makeLoop(name, volume, pitch);
  live.add(l);
  if (currentEngine) l.build(currentEngine);
  ensureTicker();
  return l;
}

function makeLoop(name: LoopName, volume: number, pitch: number): LoopBase {
  switch (name) {
    case 'sea':
      return new SeaLoop(name, 0.5, 0.2, volume, pitch);
    case 'wind':
      return new WindLoop(name, 0.65, 0.15, volume, pitch);
    case 'engine':
      return new EngineLoop(name, 0.16, 0.04, volume, pitch);
    case 'winch':
      return new WinchLoop(name, 0.3, 0.08, volume, pitch);
    case 'hull':
      return new HullLoop(name, 0.75, 0.3, volume, pitch);
    case 'stove':
      return new StoveLoop(name, 0.55, 0.1, volume, pitch);
    case 'purr':
      return new PurrLoop(name, 0.42, 0.03, volume, pitch);
    case 'deckWater':
      return new DeckWaterLoop(name, 0.4, 0.15, volume, pitch);
    default: {
      const never: never = name;
      throw new Error('unknown loop ' + String(never));
    }
  }
}
