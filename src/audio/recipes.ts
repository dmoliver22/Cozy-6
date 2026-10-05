/**
 * One-shot sound recipes. Each recipe builds its graph into `v.out`, using
 * `v.p` (pitch multiplier) on frequencies / sweeps. Levels are tuned so that
 * the loud impacts peak around 0.6–0.8 and UI ticks around 0.2.
 *
 * These are placeholders for a sound designer: swap any entry for a
 * sample-based player without touching the game code (it only uses names).
 */
import type { Voice } from './engine';
import { ahr, env, pick, pulseCurve, rnd, softClipCurve, sweep, wire } from './engine';
import type { Partial } from './atoms';
import { chirp, chirpTrain, clickTrain, creak, noiseHit, partials, thump, tone, vocal } from './atoms';
import type { SfxName } from './sfx';

export interface Recipe {
  /** builds the sound into v.out */
  play: (v: Voice) => void;
  /** reverb send amount */
  send?: number;
  /** how many may start inside one 25 ms window (default 1) */
  burst?: number;
  /** max simultaneous instances of this name (default 6) */
  max?: number;
  /** output trim (level balancing between recipes) */
  gain?: number;
}

const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3] as const;

// ------------------------------------------------------------------ bells

const BELL: readonly Partial[] = [
  [0.5, 0.2, 2.8], // hum
  [1.0, 0.42, 2.4], // prime / strike
  [1.19, 0.2, 1.7], // tierce (minor third — the "bell" colour)
  [1.5, 0.1, 1.3], // quint
  [2.0, 0.24, 1.5], // nominal
  [2.51, 0.09, 0.9],
  [2.99, 0.07, 0.6],
  [4.07, 0.04, 0.35],
];

const SHIP_BELL: readonly Partial[] = [
  [0.5, 0.26, 3.6],
  [1.0, 0.42, 3.2],
  [1.003, 0.2, 3.0], // beating pair
  [1.183, 0.26, 2.4],
  [1.506, 0.13, 1.8],
  [2.0, 0.22, 2.0],
  [2.006, 0.1, 1.8],
  [2.66, 0.1, 1.1],
  [3.2, 0.07, 0.8],
  [4.3, 0.05, 0.5],
  [5.4, 0.035, 0.32],
];

function bell(v: Voice): void {
  const p = v.p;
  const f = 660 * p;
  // "doppler-ish": above 1 the note leans upward as it rings, below 1 it sags
  const glide = 1 + Math.max(-0.03, Math.min(0.05, (p - 1) * 0.06));
  const out = v.gain(0.42);
  out.connect(v.out);
  partials(v, f, BELL, { dest: out, glide });
  // strike transient
  noiseHit(v, { type: 'bandpass', f: 2600 * p, Q: 1.4, a: 0.0008, d: 0.03, peak: 0.35, dest: out });
  tone(v, { f: f * 1.0015, d: 2.2, peak: 0.12, dest: out }); // gentle beating on the prime
}

function shipbell(v: Voice): void {
  const f = 300 * v.p;
  const out = v.gain(0.42);
  out.connect(v.out);
  partials(v, f, SHIP_BELL, { dest: out, spread: 0.002 });
  noiseHit(v, { type: 'bandpass', f: 1300 * v.p, Q: 1.6, a: 0.001, d: 0.06, peak: 0.45, dest: out });
  thump(v, 0, 140 * v.p, 90 * v.p, 0.12, 0.25, out);
}

// ------------------------------------------------------------------ water

function whump(v: Voice): void {
  const p = v.p;
  thump(v, 0, 95 * p, 36 * p, 0.75, 0.75);
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 520 * p, f2: 110 * p, sweep: 0.6, Q: 0.8, a: 0.012, d: 0.95, peak: 1.0 });
  // the slap of the water mass
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 950 * p, f2: 500 * p, Q: 0.8, a: 0.015, d: 0.45, peak: 0.32 });
  // spray settling afterwards
  noiseHit(v, { kind: 'white', type: 'highpass', f: 3200 * p, Q: 0.6, at: 0.06, a: 0.08, d: 0.6, peak: 0.06 });
}

function spray(v: Voice): void {
  const p = v.p;
  const pk = v.filter('peaking', 5200 * p, 1, 4);
  pk.connect(v.out);
  noiseHit(v, { kind: 'pink', type: 'highpass', f: 1700 * p, f2: 2600 * p, sweep: 0.5, Q: 0.6, a: 0.035, h: 0.08, d: 0.48, peak: 0.42, dest: pk });
  noiseHit(v, { kind: 'crackle', type: 'highpass', f: 3000 * p, Q: 0.7, a: 0.03, h: 0.1, d: 0.4, peak: 0.32, dest: pk });
}

function splash(v: Voice): void {
  const p = v.p;
  noiseHit(v, { kind: 'white', type: 'lowpass', f: 7000 * p, f2: 450 * p, sweep: 0.45, Q: 1.1, a: 0.004, d: 0.5, peak: 0.5 });
  thump(v, 0, 260 * p, 110 * p, 0.16, 0.3);
  noiseHit(v, { kind: 'crackle', type: 'bandpass', f: 2400 * p, Q: 0.8, at: 0.02, a: 0.02, d: 0.35, peak: 0.25 });
  const bubbles: Array<[number, number, number, number, number]> = [];
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) bubbles.push([rnd(0.07, 0.42), rnd(650, 1500) * p, rnd(1.4, 1.9), rnd(0.035, 0.06), rnd(0.06, 0.12)]);
  chirpTrain(v, bubbles);
}

function plop(v: Voice): void {
  const p = v.p * rnd(0.95, 1.06);
  tone(v, { f: 380 * p, f2: 1150 * p, glide: 0.07, a: 0.003, d: 0.1, peak: 0.4 });
  noiseHit(v, { type: 'lowpass', f: 2600 * p, Q: 0.8, a: 0.002, d: 0.08, peak: 0.16 });
  chirpTrain(v, [[0.07, 900 * p, 1.7, 0.045, 0.1]]);
}

function buoyPop(v: Voice): void {
  const p = v.p;
  tone(v, { f: 170 * p, f2: 680 * p, glide: 0.13, a: 0.01, d: 0.2, peak: 0.45 });
  noiseHit(v, { type: 'lowpass', f: 3200 * p, f2: 700 * p, at: 0.02, Q: 0.9, a: 0.005, d: 0.22, peak: 0.2 });
  chirpTrain(v, [
    [0.11, 420 * p, 2.1, 0.08, 0.16],
    [0.22, 1100 * p, 1.5, 0.04, 0.06],
  ]);
}

function flop(v: Voice): void {
  const p = v.p;
  thump(v, 0, 125 * p, 55 * p, 0.2, 0.55);
  noiseHit(v, { kind: 'white', type: 'bandpass', f: 1300 * p, f2: 550 * p, Q: 1, a: 0.003, d: 0.11, peak: 0.45 });
  // squelchy wobble
  const o = tone(v, { type: 'triangle', f: 330 * p, f2: 200 * p, at: 0.03, a: 0.02, d: 0.18, peak: 0.12 });
  const lfo = v.osc('sine', 22, v.t + 0.03, v.t + 0.25);
  const lg = v.gain(28 * p);
  wire(lfo, lg);
  lg.connect(o.frequency);
  chirpTrain(v, [
    [0.12, 700 * p, 1.6, 0.04, 0.07],
    [0.2, 1000 * p, 1.5, 0.035, 0.05],
  ]);
}

// ---------------------------------------------------------- metal & wood

function thunk(v: Voice): void {
  const p = v.p;
  thump(v, 0, 78 * p, 40 * p, 0.45, 0.85);
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 380 * p, Q: 0.9, a: 0.002, d: 0.18, peak: 0.8 });
  noiseHit(v, { type: 'bandpass', f: 720 * p, Q: 2, a: 0.001, d: 0.07, peak: 0.35 });
  // steel pot cage ringing
  const ring = v.gain(1);
  ring.connect(v.out);
  partials(
    v,
    187 * p,
    [
      [1, 0.11, 1.1],
      [1.663, 0.09, 0.9],
      [2.476, 0.075, 0.7],
      [3.754, 0.05, 0.5],
      [5.58, 0.03, 0.35],
    ],
    { at: 0.004, dest: ring, spread: 0.004 },
  );
}

function skid(v: Voice): void {
  const p = v.p;
  noiseHit(v, { type: 'bandpass', f: 1500 * p, f2: 520 * p, sweep: 0.5, Q: 4.5, a: 0.02, h: 0.26, d: 0.18, peak: 0.55 });
  // grind: jittery low buzz
  const saw = v.osc('sawtooth', 55 * p, v.t, v.t + 0.5);
  for (let i = 1; i < 16; i++) saw.frequency.setValueAtTime(rnd(42, 75) * p, v.t + i * 0.03);
  const bp = v.filter('bandpass', 900 * p, 1.4);
  const g = v.gain(0);
  wire(saw, bp, g, v.out);
  ahr(g.gain, v.t, 0.03, 0.2, 0.28, 0.16);
  // faint squeal
  tone(v, { f: 1900 * p, f2: 1650 * p, a: 0.08, h: 0.15, d: 0.2, peak: 0.035 });
  // settles with a clank
  thump(v, 0.45, 130 * p, 80 * p, 0.12, 0.3);
  noiseHit(v, { type: 'bandpass', f: 900 * p, Q: 1.5, at: 0.45, a: 0.001, d: 0.05, peak: 0.25 });
}

function clunk(v: Voice): void {
  const p = v.p * rnd(0.97, 1.03);
  thump(v, 0, 150 * p, 80 * p, 0.18, 0.6);
  noiseHit(v, { type: 'bandpass', f: 900 * p, Q: 1.5, a: 0.001, d: 0.05, peak: 0.42 });
  partials(v, 420 * p, [
    [1, 0.06, 0.25],
    [1.64, 0.045, 0.18],
  ]);
}

function knock(v: Voice): void {
  const p = v.p * rnd(0.96, 1.04);
  // hollow wooden body modes
  partials(v, 210 * p, [
    [1, 0.42, 0.13],
    [2.6, 0.22, 0.08],
    [4.3, 0.09, 0.05],
  ]);
  tone(v, { f: 230 * p, f2: 190 * p, d: 0.1, peak: 0.25 });
  noiseHit(v, { type: 'bandpass', f: 1500 * p, Q: 2, a: 0.0008, d: 0.025, peak: 0.3 });
}

function lever(v: Voice): void {
  const p = v.p;
  clickTrain(
    v,
    [0, 0.05, 0.092, 0.128, 0.158].map((t, i) => [t, 0.32 + i * 0.03, 0.012, (2000 + i * 120) * p] as const),
    { Q: 3, ping: 0.2 },
  );
  const at = 0.2;
  thump(v, at, 135 * p, 75 * p, 0.16, 0.55);
  noiseHit(v, { type: 'bandpass', f: 820 * p, Q: 1.5, at, a: 0.001, d: 0.05, peak: 0.38 });
  partials(
    v,
    380 * p,
    [
      [1, 0.05, 0.25],
      [1.63, 0.035, 0.18],
    ],
    { at },
  );
}

function strap(v: Voice): void {
  const p = v.p;
  const n = 15;
  const clicks: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    clicks.push([0.32 * Math.pow(x, 0.8), 0.22 + 0.12 * x, 0.009, (1800 + 1300 * x) * p]);
  }
  clickTrain(v, clicks, { Q: 3, ping: 0.15 });
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 900 * p, f2: 2700 * p, sweep: 0.32, Q: 2, a: 0.03, h: 0.22, d: 0.08, peak: 0.13 });
}

function winchStart(v: Voice): void {
  const p = v.p;
  // starter clack
  noiseHit(v, { type: 'bandpass', f: 1100 * p, Q: 2, a: 0.001, d: 0.03, peak: 0.3 });
  const t = v.t + 0.04;
  const end = t + 0.55;
  const saw = v.osc('sawtooth', 36 * p, t, end);
  sweep(saw.frequency, t, 36 * p, 105 * p, 0.32);
  const sq = v.osc('square', 18 * p, t, end);
  sweep(sq.frequency, t, 18 * p, 52 * p, 0.32);
  const sqg = v.gain(0.45);
  sq.connect(sqg);
  const chug = v.gain(0.4);
  saw.connect(chug);
  sqg.connect(chug);
  const lfo = v.osc('sawtooth', 16, t, end);
  sweep(lfo.frequency, t, 16, 30, 0.32);
  const sh = v.shaper(pulseShape());
  const depth = v.gain(0.6);
  wire(lfo, sh, depth);
  depth.connect(chug.gain);
  const lp = v.filter('lowpass', 380 * p, 1.5);
  sweep(lp.frequency, t, 380 * p, 950 * p, 0.32);
  const g = v.gain(0);
  wire(chug, lp, g, v.out);
  ahr(g.gain, t, 0.03, 0.55, 0.25, 0.22);
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 1500 * p, Q: 1, at: 0.08, a: 0.06, d: 0.3, peak: 0.08 });
}

function pulseShape(): Float32Array {
  return pulseCurve(3);
}

function creakSfx(v: Voice): void {
  const p = v.p * rnd(0.92, 1.08);
  const dur = rnd(0.55, 0.85);
  creak(v, { rate0: 30 * p, rate1: 58 * p, dur, f1: 520 * p, f2: 1180 * p, Q: 9, peak: 0.42 });
}

function ropeCreak(v: Voice): void {
  const p = v.p * rnd(0.94, 1.06);
  creak(v, { rate0: 75 * p, rate1: 125 * p, dur: 0.28, f1: 900 * p, f2: 1950 * p, Q: 11, peak: 0.36, jitter: 0.08 });
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 2600 * p, Q: 1.5, a: 0.05, d: 0.2, peak: 0.05 });
}

// ------------------------------------------------------------------ voices

/** base voice frequency for the little crew characters */
const VOX = 330;

function hup(v: Voice): void {
  const f = VOX * v.p * rnd(0.97, 1.03);
  vocal(v, {
    at: 0.035,
    dur: 0.1,
    f0: f,
    contour: [
      [0, 0.96],
      [0.45, 1.14],
      [1, 1.06],
    ],
    vowels: [
      [0, 'u'],
      [0.5, 'a'],
      [1, 'u'],
    ],
    peak: 0.5,
    breath: 0.18,
    a: 0.01,
    r: 0.02,
    fscale: 1.15 * Math.pow(v.p, 0.35),
  });
  // little lip "p"
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 700, Q: 0.7, at: 0.15, a: 0.001, d: 0.02, peak: 0.12 });
}

function cheer(v: Voice): void {
  const n = 4 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const m = rnd(0.82, 1.38);
    const f = (VOX + 40) * v.p * m;
    const dur = rnd(0.28, 0.42);
    vocal(v, {
      at: i === 0 ? 0 : rnd(0.02, 0.16),
      dur,
      f0: f,
      contour: [
        [0, 0.9],
        [0.35, 1.18],
        [1, 1.0],
      ],
      vowels: [
        [0, 'e'],
        [0.3, 'a'],
        [1, 'i'],
      ],
      peak: 0.26,
      vib: 0.02,
      vibRate: rnd(6, 8),
      r: 0.09,
      fscale: 1.15 * Math.pow(v.p * m, 0.3),
    });
  }
  // a couple of soft claps
  for (let i = 0; i < 3; i++) noiseHit(v, { type: 'bandpass', f: rnd(1100, 1600), Q: 1.2, at: 0.05 + i * rnd(0.11, 0.14), a: 0.001, d: 0.04, peak: 0.12 });
}

function gotcha(v: Voice): void {
  const f = VOX * v.p;
  const fs = 1.15 * Math.pow(v.p, 0.35);
  // "g"
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 600, Q: 0.7, a: 0.002, d: 0.018, peak: 0.18 });
  vocal(v, {
    at: 0.012,
    dur: 0.1,
    f0: f,
    contour: [
      [0, 1.08],
      [1, 1.0],
    ],
    vowels: [
      [0, 'o'],
      [1, 'o'],
    ],
    peak: 0.45,
    a: 0.008,
    r: 0.015,
    fscale: fs,
  });
  // "t" stop + "ch"
  noiseHit(v, { type: 'highpass', f: 3500, Q: 0.7, at: 0.125, a: 0.001, d: 0.012, peak: 0.12 });
  noiseHit(v, { kind: 'white', type: 'bandpass', f: 3000 * Math.pow(v.p, 0.3), Q: 1.4, at: 0.16, a: 0.008, d: 0.05, peak: 0.24 });
  vocal(v, {
    at: 0.2,
    dur: 0.2,
    f0: f,
    contour: [
      [0, 1.22],
      [0.3, 1.38],
      [1, 1.08],
    ],
    vowels: [
      [0, 'e'],
      [0.25, 'a'],
      [1, 'a'],
    ],
    peak: 0.5,
    a: 0.01,
    r: 0.07,
    vib: 0.015,
    fscale: fs,
  });
}

function giggle(v: Voice): void {
  const n = 4 + Math.floor(Math.random() * 3);
  const f = (VOX + 30) * v.p;
  const fs = 1.2 * Math.pow(v.p, 0.35);
  let at = 0.04;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const rise = 1 + i * 0.055 + rnd(-0.02, 0.02);
    const dur = last ? 0.13 : rnd(0.055, 0.075);
    vocal(v, {
      at,
      dur,
      f0: f * rise,
      contour: last
        ? [
            [0, 1.08],
            [0.3, 1.14],
            [1, 0.86],
          ]
        : [
            [0, 1.1],
            [1, 0.94],
          ],
      vowels: [
        [0, 'i'],
        [1, 'e'],
      ],
      peak: 0.36,
      breath: 0.1,
      a: 0.008,
      r: 0.025,
      fscale: fs,
    });
    at += dur + rnd(0.035, 0.05);
  }
}

function ow(v: Voice): void {
  const f = VOX * v.p;
  vocal(v, {
    at: 0,
    dur: 0.32,
    f0: f,
    contour: [
      [0, 1.38],
      [0.15, 1.48],
      [1, 0.92],
    ],
    vowels: [
      [0, 'a'],
      [0.35, 'a'],
      [1, 'u'],
    ],
    peak: 0.55,
    a: 0.008,
    r: 0.08,
    vib: 0.018,
    vibRate: 7,
    fscale: 1.15 * Math.pow(v.p, 0.35),
  });
}

function meow(v: Voice): void {
  const f = 540 * v.p * rnd(0.95, 1.05);
  vocal(v, {
    at: 0,
    dur: 0.62,
    f0: f,
    contour: [
      [0, 0.82],
      [0.32, 1.12],
      [0.6, 1.02],
      [1, 0.76],
    ],
    vowels: [
      [0, 'm'],
      [0.12, 'i'],
      [0.38, 'a'],
      [0.72, 'o'],
      [1, 'u'],
    ],
    peak: 0.32,
    a: 0.07,
    r: 0.14,
    vib: 0.012,
    vibRate: 5.5,
    fscale: 1.35 * Math.pow(v.p, 0.3),
  });
}

function otter(v: Voice): void {
  const n = 3 + Math.floor(Math.random() * 2);
  let at = 0;
  for (let i = 0; i < n; i++) {
    const f = 1350 * v.p * rnd(0.9, 1.2) * (1 + i * 0.04);
    const dur = rnd(0.065, 0.1);
    chirp(v, at, f, dur, rnd(0.16, 0.24));
    at += dur + rnd(0.04, 0.09);
  }
}

function squeak(v: Voice): void {
  const p = v.p * rnd(0.95, 1.05);
  const t = v.t;
  const end = t + 0.56;
  const osc = v.osc('triangle', 950 * p, t, end);
  osc.frequency.setValueAtTime(880 * p, t);
  osc.frequency.linearRampToValueAtTime(1080 * p, t + 0.2);
  osc.frequency.linearRampToValueAtTime(960 * p, t + 0.5);
  const lfo = v.osc('sine', 28, t, end);
  const lg = v.gain(60 * p);
  wire(lfo, lg);
  lg.connect(osc.frequency);
  // stick-slip flutter
  const am = v.osc('square', 14, t, end);
  const amg = v.gain(0.35);
  const body = v.gain(0.65);
  wire(am, amg);
  amg.connect(body.gain);
  const bp = v.filter('bandpass', 1500 * p, 1.6);
  const g = v.gain(0);
  wire(osc, body, bp, g, v.out);
  ahr(g.gain, t, 0.03, 0.42, 0.34, 0.14);
}

function purrShot(v: Voice): void {
  const p = v.p;
  const t = v.t;
  const end = t + 1.25;
  const src = v.noise('brown', t, end);
  const am = v.gain(0);
  const lfo = v.osc('sawtooth', 25 * p, t, end);
  lfo.frequency.setValueAtTime(26 * p, t);
  lfo.frequency.setValueAtTime(23 * p, t + 0.72);
  const sh = v.shaper(pulseCurve(2.5));
  wire(lfo, sh);
  sh.connect(am.gain);
  const lp = v.filter('lowpass', 520, 0.8);
  const pk = v.filter('peaking', 180, 1.2, 6);
  const breath = v.gain(0);
  wire(src, am, lp, pk, breath, v.out);
  // tonal thrum from the pulse itself
  const thr = v.filter('lowpass', 140, 0.8);
  const thg = v.gain(0.35);
  wire(sh, thr, thg, breath);
  // exhale (strong) … tiny gap … inhale (softer)
  const b = breath.gain;
  b.setValueAtTime(0, t);
  b.linearRampToValueAtTime(1.1, t + 0.12);
  b.setValueAtTime(1.1, t + 0.55);
  b.linearRampToValueAtTime(0.05, t + 0.66);
  b.linearRampToValueAtTime(0.75, t + 0.8);
  b.setValueAtTime(0.75, t + 1.05);
  b.linearRampToValueAtTime(0, t + 1.22);
  v.until(end);
}

function scratch(v: Voice): void {
  const p = v.p;
  const strokes = [0, 0.13, 0.25, 0.4].map((x) => x + rnd(-0.015, 0.015));
  for (const at of strokes) {
    const dur = rnd(0.08, 0.12);
    const up = Math.random() < 0.5;
    noiseHit(v, { kind: 'crackle', type: 'bandpass', f: (up ? 2200 : 3600) * p, f2: (up ? 3600 : 2200) * p, sweep: dur, Q: 1.3, at, a: 0.015, h: dur * 0.5, d: dur * 0.5, peak: 0.55 });
    noiseHit(v, { kind: 'white', type: 'bandpass', f: 1200 * p, Q: 3, at, a: 0.02, h: dur * 0.4, d: dur * 0.5, peak: 0.07 });
  }
}

// ------------------------------------------------------------- crab bits

function clatter(v: Voice): void {
  const p = v.p;
  const n = 12 + Math.floor(Math.random() * 7);
  const clicks: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const at = 0.8 * Math.pow(x, 1.35) + rnd(0, 0.025);
    clicks.push([at, rnd(0.25, 0.55) * (1 - 0.45 * x), rnd(0.007, 0.018), rnd(1700, 4200) * p]);
  }
  clickTrain(v, clicks, { Q: 3.5, ping: 0.22 });
}

function click(v: Voice): void {
  const p = v.p * rnd(0.9, 1.12);
  clickTrain(v, [[0, 0.5, 0.012, 3100 * p]], { Q: 3, ping: 0.25 });
}

function chatter(v: Voice): void {
  const p = v.p;
  const n = 6 + Math.floor(Math.random() * 5);
  const ev: Array<[number, number, number, number, number]> = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const dur = rnd(0.025, 0.04);
    ev.push([at, rnd(900, 1700) * p, rnd(0.8, 0.95), dur, rnd(0.08, 0.13)]);
    at += dur + rnd(0.012, 0.045);
  }
  const lp = v.filter('lowpass', 3200 * p, 0.8);
  lp.connect(v.out);
  chirpTrain(v, ev, { type: 'square', dest: lp, a: 0.003 });
  const clicks: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < 4; i++) clicks.push([rnd(0, at), 0.2, 0.008, rnd(2500, 4000) * p]);
  clickTrain(v, clicks, { Q: 3 });
}

function pinch(v: Voice): void {
  const p = v.p;
  clickTrain(
    v,
    [
      [0, 0.18, 0.008, 3200 * p],
      [0.04, 0.62, 0.016, 2200 * p],
    ],
    { Q: 2 },
  );
  partials(
    v,
    1300 * p,
    [
      [1, 0.17, 0.05],
      [1.65, 0.11, 0.04],
      [2.6, 0.06, 0.03],
    ],
    { at: 0.04, a: 0.0008 },
  );
}

// -------------------------------------------------------------- sparkles

function chime(v: Voice): void {
  const f = 1046.5 * v.p;
  const notes = [1, 1.26, 1.498, 2.0];
  notes.forEach((m, i) => {
    const last = i === notes.length - 1;
    partials(
      v,
      f * m,
      [
        [1, last ? 0.22 : 0.16, last ? 1.6 : 1.1],
        [1.003, 0.07, last ? 1.5 : 1.0],
        [2.0, 0.05, 0.6],
        [3.0, 0.02, 0.35],
      ],
      { at: i * 0.065 },
    );
  });
  for (let i = 0; i < 5; i++) {
    const fr = 2093 * v.p * pick(PENTA) * (Math.random() < 0.4 ? 2 : 1);
    tone(v, { f: fr, at: rnd(0.28, 0.85), a: 0.002, d: rnd(0.12, 0.22), peak: 0.035 });
  }
}

function sparkle(v: Voice): void {
  const n = 12 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const fr = 2093 * v.p * pick(PENTA) * (Math.random() < 0.3 ? 2 : 1) * (Math.random() < 0.25 ? 0.5 : 1);
    const at = 0.95 * Math.pow(x, 1.25) + rnd(0, 0.03);
    const peak = rnd(0.05, 0.09) * (1 - 0.5 * x);
    partials(
      v,
      fr,
      [
        [1, peak, rnd(0.12, 0.3)],
        [2.0, peak * 0.25, 0.08],
      ],
      { at, a: 0.002 },
    );
  }
}

function fanfare(v: Voice): void {
  const f = 523.25 * v.p;
  const notes: Array<[number, number, boolean]> = [
    [0, 1, false],
    [0.11, 1.26, false],
    [0.22, 1.498, false],
    [0.36, 2.0, true],
  ];
  for (const [at, m, last] of notes) {
    pluckNote(v, f * m, at, last ? 0.32 : 0.0, last ? 0.45 : 0.16, last ? 0.2 : 0.17, last);
  }
  // little harmony under the last note
  pluckNote(v, f * 1.26, 0.36, 0.32, 0.45, 0.08, false);
  pluckNote(v, f * 1.498, 0.36, 0.32, 0.45, 0.08, false);
}

/** toy pluck: square + triangle through a decaying lowpass */
function pluckNote(v: Voice, f: number, at: number, hold: number, dec: number, peak: number, vib: boolean): void {
  const t = v.t + at;
  const g = v.gain(0);
  const end = hold > 0 ? ahr(g.gain, t, 0.004, peak, hold, dec) : env(g.gain, t, 0.004, peak, dec);
  const sq = v.osc('square', f, t, end + 0.01);
  const tri = v.osc('triangle', f * 2, t, end + 0.01);
  const sqg = v.gain(0.35);
  const trg = v.gain(0.5);
  const lp = v.filter('lowpass', 4200, 1.5);
  sweep(lp.frequency, t, 4200, 1300, 0.18);
  wire(sq, sqg, lp);
  wire(tri, trg, lp);
  wire(lp, g, v.out);
  if (vib) {
    const lfo = v.osc('sine', 5.5, t + 0.08, end);
    const lg = v.gain(f * 0.007);
    wire(lfo, lg);
    lg.connect(sq.frequency);
    lg.connect(tri.detune);
  }
}

function held(v: Voice): void {
  const p = v.p;
  tone(v, { f: 520 * p, f2: 1350 * p, glide: 0.03, a: 0.002, d: 0.05, peak: 0.3 });
  partials(
    v,
    1568 * p,
    [
      [1, 0.17, 0.45],
      [2.0, 0.05, 0.18],
      [3.0, 0.02, 0.1],
    ],
    { at: 0.025 },
  );
}

// ----------------------------------------------------------------- ice

function crack(v: Voice): void {
  const p = v.p * rnd(0.92, 1.08);
  clickTrain(
    v,
    [
      [0, 0.75, 0.028, 4200 * p],
      [0.012, 0.4, 0.02, 5600 * p],
      [0.029, 0.22, 0.016, 3500 * p],
    ],
    { type: 'highpass', Q: 0.8 },
  );
  tone(v, { f: 3300 * p, a: 0.001, d: 0.06, peak: 0.07 });
  tone(v, { f: 5100 * p, a: 0.001, d: 0.04, peak: 0.035 });
  thump(v, 0, 380 * p, 160 * p, 0.05, 0.2);
}

function shatter(v: Voice): void {
  const p = v.p;
  const clicks: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < 7; i++) clicks.push([i === 0 ? 0 : rnd(0.01, 0.2), 0.7 - i * 0.06, rnd(0.015, 0.03), rnd(2800, 6000) * p]);
  clickTrain(v, clicks, { type: 'highpass', Q: 0.8 });
  noiseHit(v, { type: 'highpass', f: 3600 * p, Q: 0.6, a: 0.004, d: 0.5, peak: 0.18 });
  thump(v, 0, 300 * p, 120 * p, 0.1, 0.25);
  for (let i = 0; i < 11; i++) {
    const at = 0.04 + 0.85 * Math.pow(Math.random(), 1.6);
    const f = rnd(2600, 6400) * p;
    partials(
      v,
      f,
      [
        [1, rnd(0.04, 0.07), rnd(0.08, 0.2)],
        [2.76, 0.02, 0.06],
      ],
      { at, a: 0.001 },
    );
  }
}

function chip(v: Voice): void {
  const p = v.p * rnd(0.95, 1.05);
  tone(v, { f: 1050 * p, f2: 780 * p, a: 0.001, d: 0.045, peak: 0.3 });
  noiseHit(v, { type: 'bandpass', f: 1400 * p, Q: 5, a: 0.001, d: 0.03, peak: 0.45 });
  noiseHit(v, { type: 'highpass', f: 3200 * p, Q: 0.7, at: 0.004, a: 0.0005, d: 0.016, peak: 0.25 });
  tone(v, { f: 4200 * p, at: 0.004, a: 0.001, d: 0.05, peak: 0.03 });
}

// ------------------------------------------------------------------- UI

function plus(v: Voice): void {
  const p = v.p;
  tone(v, { f: 1180 * p, a: 0.003, d: 0.12, peak: 0.2 });
  tone(v, { f: 2360 * p, a: 0.002, d: 0.05, peak: 0.045 });
}

function uiTap(v: Voice): void {
  const p = v.p;
  tone(v, { f: 680 * p, f2: 520 * p, a: 0.002, d: 0.06, peak: 0.24 });
  noiseHit(v, { type: 'lowpass', f: 2200 * p, Q: 0.7, a: 0.001, d: 0.015, peak: 0.08 });
}

function uiConfirm(v: Voice): void {
  const p = v.p;
  for (const [at, f] of [
    [0, 784],
    [0.085, 1175],
  ] as const) {
    tone(v, { f: f * p, at, a: 0.004, d: 0.28, peak: 0.16 });
    tone(v, { type: 'triangle', f: f * 2 * p, at, a: 0.003, d: 0.12, peak: 0.04 });
  }
}

function tally(v: Voice): void {
  const p = v.p;
  tone(v, { type: 'triangle', f: 1500 * p, a: 0.001, d: 0.035, peak: 0.17 });
  tone(v, { f: 3000 * p, a: 0.001, d: 0.015, peak: 0.035 });
}

function coins(v: Voice): void {
  const p = v.p;
  const n = 6 + Math.floor(Math.random() * 3);
  const clicks: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const at = i === 0 ? 0 : 0.4 * Math.pow(Math.random(), 1.3);
    const f = rnd(2000, 3200) * p;
    const pk = rnd(0.06, 0.11);
    partials(
      v,
      f,
      [
        [1, pk, rnd(0.15, 0.32)],
        [1.47, pk * 0.6, 0.14],
        [2.09, pk * 0.35, 0.09],
      ],
      { at, a: 0.001 },
    );
    clicks.push([at, 0.25, 0.006, 5500]);
  }
  clickTrain(v, clicks, { type: 'highpass', Q: 0.7 });
}

function camera(v: Voice): void {
  const p = v.p;
  clickTrain(
    v,
    [
      [0, 0.5, 0.02, 1500 * p],
      [0.078, 0.45, 0.015, 3000 * p],
    ],
    { Q: 2, ping: 0.18 },
  );
  // tiny mechanism whirr between
  const t = v.t + 0.012;
  const saw = v.osc('sawtooth', 180 * p, t, t + 0.08);
  sweep(saw.frequency, t, 180 * p, 260 * p, 0.06);
  const lp = v.filter('lowpass', 1300, 0.8);
  const g = v.gain(0);
  wire(saw, lp, g, v.out);
  env(g.gain, t, 0.01, 0.035, 0.055);
  tone(v, { f: 2900 * p, at: 0.08, a: 0.001, d: 0.08, peak: 0.025 });
}

function pageTurn(v: Voice): void {
  const p = v.p * rnd(0.94, 1.06);
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 1200 * p, f2: 3600 * p, sweep: 0.18, Q: 0.9, a: 0.05, h: 0.06, d: 0.12, peak: 0.32 });
  noiseHit(v, { kind: 'crackle', type: 'bandpass', f: 3000 * p, Q: 0.9, a: 0.04, h: 0.08, d: 0.1, peak: 0.28 });
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 500, Q: 0.7, at: 0.2, a: 0.004, d: 0.06, peak: 0.22 });
}

// ------------------------------------------------------------ misc deck

function foghorn(v: Voice): void {
  const p = v.p;
  const f = 98 * p;
  const t = v.t;
  const a = 0.35;
  const h = 1.3;
  const r = 0.6;
  const g = v.gain(0);
  const end = ahr(g.gain, t, a, 0.36, h, r);
  const lp = v.filter('lowpass', 260 * p, 1.2);
  lp.frequency.setValueAtTime(260 * p, t);
  lp.frequency.linearRampToValueAtTime(680 * p, t + a);
  lp.frequency.linearRampToValueAtTime(520 * p, t + a + 0.5);
  lp.frequency.setValueAtTime(520 * p, t + a + h);
  lp.frequency.linearRampToValueAtTime(240 * p, t + a + h + r);
  wire(lp, g, v.out);
  const voicesDef: Array<[OscillatorType, number, number]> = [
    ['sawtooth', 0.997, 0.5],
    ['sawtooth', 1.003, 0.5],
    ['sawtooth', 0.5, 0.35],
    ['square', 1.0, 0.18],
  ];
  for (const [type, m, amp] of voicesDef) {
    const o = v.osc(type, f * m, t, end + 0.01);
    o.frequency.setValueAtTime(f * m * 0.94, t);
    o.frequency.linearRampToValueAtTime(f * m, t + 0.28);
    o.frequency.setValueAtTime(f * m, t + a + h);
    o.frequency.linearRampToValueAtTime(f * m * 0.96, t + a + h + r);
    const og = v.gain(amp);
    wire(o, og, lp);
  }
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 320 * p, Q: 1.2, a: 0.3, h: 1.3, d: 0.6, peak: 0.08 });
}

function grab(v: Voice): void {
  const p = v.p * rnd(0.94, 1.06);
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 750 * p, Q: 0.8, a: 0.003, d: 0.07, peak: 0.5 });
  thump(v, 0, 190 * p, 120 * p, 0.07, 0.25);
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 2000 * p, Q: 0.8, a: 0.002, d: 0.04, peak: 0.06 });
}

function hatThud(v: Voice): void {
  const p = v.p;
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 450 * p, Q: 0.8, a: 0.004, d: 0.09, peak: 0.4 });
  thump(v, 0, 140 * p, 95 * p, 0.08, 0.2);
  noiseHit(v, { kind: 'pink', type: 'bandpass', f: 1500 * p, Q: 0.7, a: 0.002, d: 0.05, peak: 0.05 });
}

function throwSfx(v: Voice): void {
  const p = v.p;
  const t = v.t;
  const g = v.gain(0);
  const end = ahr(g.gain, t, 0.13, 0.48, 0.03, 0.24);
  const src = v.noise('pink', t, end + 0.01);
  const bp = v.filter('bandpass', 350 * p, 1.8);
  bp.frequency.setValueAtTime(350 * p, t);
  bp.frequency.exponentialRampToValueAtTime(1900 * p, t + 0.16);
  bp.frequency.exponentialRampToValueAtTime(520 * p, t + 0.4);
  wire(src, bp, g, v.out);
}

function cook(v: Voice): void {
  const p = v.p;
  noiseHit(v, { kind: 'white', type: 'highpass', f: 4500, Q: 0.6, a: 0.15, h: 1.0, d: 0.35, peak: 0.1 });
  noiseHit(v, { kind: 'crackle', type: 'highpass', f: 2400, Q: 0.6, a: 0.12, h: 1.0, d: 0.35, peak: 0.32 });
  noiseHit(v, { kind: 'brown', type: 'lowpass', f: 380, Q: 0.7, a: 0.2, h: 0.9, d: 0.4, peak: 0.14 });
  const n = 11 + Math.floor(Math.random() * 5);
  const ev: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) ev.push([rnd(0.05, 1.35), rnd(160, 380) * p, rnd(1.6, 2.2), rnd(0.045, 0.07), rnd(0.18, 0.32)]);
  chirpTrain(v, ev);
}

function bottle(v: Voice): void {
  const p = v.p * rnd(0.97, 1.03);
  partials(
    v,
    1650 * p,
    [
      [1, 0.2, 0.24],
      [2.32, 0.1, 0.13],
      [3.9, 0.05, 0.08],
      [5.6, 0.025, 0.05],
    ],
    { a: 0.0008 },
  );
  noiseHit(v, { type: 'highpass', f: 5000, Q: 0.7, a: 0.0005, d: 0.006, peak: 0.2 });
  tone(v, { f: 620 * p, a: 0.001, d: 0.08, peak: 0.05 });
}

// ------------------------------------------------------------------ radio

function radio(v: Voice): void {
  const p = v.p;
  const lp = v.filter('bandpass', 1800 * p, 1.3);
  const sh = v.shaper(clip2());
  wire(lp, sh, v.out);
  noiseHit(v, { kind: 'white', type: 'highpass', f: 400, Q: 0.7, a: 0.002, h: 0.12, d: 0.08, peak: 0.42, dest: lp });
  noiseHit(v, { kind: 'crackle', type: 'highpass', f: 600, Q: 0.7, a: 0.002, h: 0.16, d: 0.05, peak: 0.9, dest: lp });
  // key-up click + squelch blip
  noiseHit(v, { type: 'bandpass', f: 2500, Q: 1, a: 0.0005, d: 0.008, peak: 0.5 });
  tone(v, { type: 'square', f: 1150 * p, f2: 980 * p, at: 0.03, a: 0.003, d: 0.06, peak: 0.05, dest: lp });
}

function clip2(): Float32Array {
  return softClipCurve(2.2);
}

// ------------------------------------------------------------------ table

export const RECIPES: Record<SfxName, Recipe> = {
  bell: { play: bell, send: 0.45, max: 4, gain: 1.2 },
  radio: { play: radio, send: 0.05, gain: 0.7 },
  whump: { play: whump, send: 0.25, max: 4 },
  spray: { play: spray, send: 0.2, max: 4, gain: 1.6 },
  splash: { play: splash, send: 0.25 },
  plop: { play: plop, send: 0.2, burst: 2 },
  thunk: { play: thunk, send: 0.28, max: 3 },
  skid: { play: skid, send: 0.15, max: 3, gain: 1.4 },
  clunk: { play: clunk, send: 0.15 },
  knock: { play: knock, send: 0.18, burst: 2, gain: 0.7 },
  plus: { play: plus, send: 0.1, burst: 2, max: 8 },
  creak: { play: creakSfx, send: 0.25, max: 3 },
  ropeCreak: { play: ropeCreak, send: 0.2, max: 3 },
  hup: { play: hup, send: 0.12, max: 4, gain: 0.55 },
  held: { play: held, send: 0.2 },
  cheer: { play: cheer, send: 0.2, max: 2, gain: 0.45 },
  squeak: { play: squeak, send: 0.12, max: 3 },
  clatter: { play: clatter, send: 0.12, burst: 3, max: 4, gain: 2.5 },
  click: { play: click, send: 0.08, burst: 4, max: 10, gain: 1.8 },
  chatter: { play: chatter, send: 0.1, burst: 2, max: 4, gain: 2.0 },
  chime: { play: chime, send: 0.5, max: 3 },
  sparkle: { play: sparkle, send: 0.5, max: 3, gain: 1.8 },
  fanfare: { play: fanfare, send: 0.3, max: 2 },
  crack: { play: crack, send: 0.2, burst: 2 },
  shatter: { play: shatter, send: 0.28, max: 3 },
  gotcha: { play: gotcha, send: 0.12, max: 2, gain: 0.55 },
  giggle: { play: giggle, send: 0.12, max: 3, gain: 0.7 },
  ow: { play: ow, send: 0.12, max: 3, gain: 0.5 },
  scratch: { play: scratch, send: 0.12, max: 3, gain: 4.0 },
  meow: { play: meow, send: 0.2, max: 2, gain: 0.7 },
  purr: { play: purrShot, send: 0.05, max: 2, gain: 0.5 },
  foghorn: { play: foghorn, send: 0.6, max: 1, gain: 0.8 },
  grab: { play: grab, send: 0.08, burst: 2 },
  throw: { play: throwSfx, send: 0.1, gain: 3.0 },
  lever: { play: lever, send: 0.15, max: 2 },
  buoyPop: { play: buoyPop, send: 0.22, max: 4 },
  pinch: { play: pinch, send: 0.1, burst: 2, gain: 1.6 },
  winchStart: { play: winchStart, send: 0.1, max: 2, gain: 0.5 },
  uiTap: { play: uiTap, send: 0.05, burst: 2 },
  uiConfirm: { play: uiConfirm, send: 0.2, max: 3 },
  coins: { play: coins, send: 0.25, max: 3, gain: 1.4 },
  tally: { play: tally, send: 0.05, burst: 3, max: 8 },
  cook: { play: cook, send: 0.12, max: 2 },
  camera: { play: camera, send: 0.1, max: 2, gain: 2.5 },
  hatThud: { play: hatThud, send: 0.1 },
  flop: { play: flop, send: 0.15 },
  chip: { play: chip, send: 0.18, burst: 2 },
  strap: { play: strap, send: 0.12, max: 3, gain: 3.0 },
  otter: { play: otter, send: 0.2, max: 3, gain: 1.3 },
  bottle: { play: bottle, send: 0.3, burst: 2 },
  shipbell: { play: shipbell, send: 0.55, max: 2 },
  pageTurn: { play: pageTurn, send: 0.1, max: 3, gain: 2.5 },
};
