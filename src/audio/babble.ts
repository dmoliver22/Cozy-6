/**
 * Animal-Crossing-style dialog babble: one formant blip per syllable-ish
 * vowel group. The whole line runs on a single oscillator + formant filters
 * (automated per syllable), plus one gated noise chain for consonants, so a
 * long line costs ~a dozen nodes no matter how many syllables.
 *
 * Same word → same little tune (pitch offsets are hashed from the letters).
 */
import type { Engine } from './engine';
import { Voice, clamp, isReady, engine, softClipCurve, wire } from './engine';
import type { Vowel } from './atoms';
import { FORMANTS } from './atoms';

type Cons = 'none' | 'hiss' | 'sh' | 'stop' | 'breath' | 'soft';

interface Syl {
  at: number;
  dur: number;
  vowel: Vowel;
  semis: number;
  /** pitch multiplier at the syllable end (questions rise, statements fall) */
  bend: number;
  cons: Cons;
  amp: number;
}

export interface BabbleOpts {
  pitch?: number;
  radio?: boolean;
  volume?: number;
  speed?: number;
}

const MAX_SYLLABLES = 180;
const VOWEL_SEMIS: Record<Vowel, number> = { a: 0, e: 2, i: 4, o: -1, u: -3, m: -2 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function consOf(onset: string): Cons {
  if (!onset) return 'none';
  const c = onset[onset.length - 1] as string;
  if (onset.endsWith('sh') || onset.endsWith('ch') || c === 'j') return 'sh';
  if ('szcx'.includes(c)) return 'hiss';
  if ('ptkbdgq'.includes(c)) return 'stop';
  if ('hfv'.includes(c) || onset.endsWith('th')) return 'breath';
  return 'soft';
}

function vowelOf(group: string): Vowel {
  let ch = group[0] as string;
  if (ch === 'y' && group.length > 1) ch = group[1] as string;
  switch (ch) {
    case 'a':
      return 'a';
    case 'e':
      return group.length > 1 && group[1] === 'e' ? 'i' : 'e';
    case 'i':
    case 'y':
      return 'i';
    case 'o':
      return group.length > 1 && group[1] === 'o' ? 'u' : 'o';
    default:
      return 'u';
  }
}

interface Plan {
  syls: Syl[];
  duration: number;
}

/** turn a line of text into timed syllables */
export function planBabble(text: string, speed = 1): Plan {
  const sp = clamp(speed || 1, 0.25, 4);
  const base = 0.082 / sp;
  const syls: Syl[] = [];
  const norm = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // tokens: words, digit runs, punctuation
  const tokens = norm.match(/[a-z']+|[0-9]+|\.\.\.|…|[.!?,;:—–-]/g) ?? [];
  let t = 0.02;
  let sentenceStart = 0;
  const endSentence = (kind: '.' | '!' | '?') => {
    const sent = syls.slice(sentenceStart);
    if (sent.length) {
      const last = sent[sent.length - 1] as Syl;
      if (kind === '?') {
        last.bend = 1.28;
        last.semis += 2;
      } else if (kind === '!') {
        for (const s of sent) {
          s.semis += 2;
          s.amp *= 1.12;
        }
        last.bend = 0.94;
      } else last.bend = 0.86;
      // gentle declination across the sentence
      sent.forEach((s, i) => (s.semis -= (1.5 * i) / Math.max(1, sent.length)));
    }
    sentenceStart = syls.length;
  };

  for (const tok of tokens) {
    if (syls.length >= MAX_SYLLABLES) break;
    if (tok === '.' || tok === '!' || tok === '?') {
      endSentence(tok);
      t += 0.24 / sp;
      continue;
    }
    if (tok === '...' || tok === '…') {
      endSentence('.');
      t += 0.38 / sp;
      continue;
    }
    if (/^[,;:—–-]$/.test(tok)) {
      t += 0.14 / sp;
      continue;
    }
    let groups: Array<{ onset: string; vowel: string }> = [];
    if (/^[0-9]+$/.test(tok)) {
      const n = Math.min(4, tok.length + 1);
      for (let i = 0; i < n; i++) groups.push({ onset: 'n', vowel: 'aeiou'[(Number(tok[i % tok.length]) || i) % 5] as string });
    } else {
      const w = tok.replace(/'/g, '');
      const parts = w.match(/[aeiouy]+|[^aeiouy]+/g) ?? [];
      let onset = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as string;
        const isVowel = /^[aeiouy]/.test(part) && !(part === 'y' && i === 0 && parts.length > 1);
        if (isVowel) {
          groups.push({ onset, vowel: part });
          onset = '';
        } else onset = part;
      }
      // silent final e ("make", "cove")
      if (groups.length > 1 && w.length > 3 && /[^aeiou]e$/.test(w)) groups.pop();
      if (!groups.length) groups = [{ onset: w.slice(0, 2), vowel: w.includes('m') || w.includes('h') ? 'm' : 'u' }];
    }
    groups.forEach((g, i) => {
      if (syls.length >= MAX_SYLLABLES) return;
      const vw: Vowel = g.vowel === 'm' ? 'm' : vowelOf(g.vowel);
      const hv = hash(g.onset + g.vowel);
      const stressed = groups.length > 1 ? i === 0 : tok.length > 3;
      const dur = base * (0.85 + 0.3 * hv + Math.min(0.3, (g.vowel.length - 1) * 0.15)) * (stressed ? 1.12 : 1);
      syls.push({
        at: t,
        dur,
        vowel: vw,
        semis: VOWEL_SEMIS[vw] + Math.round(hv * 3) - 1 + (stressed ? 1.5 : 0),
        bend: 1,
        cons: consOf(g.onset),
        amp: stressed ? 1 : 0.85,
      });
      t += dur + 0.014 / sp;
    });
    t += 0.04 / sp;
  }
  endSentence('.');
  const last = syls[syls.length - 1];
  return { syls, duration: last ? last.at + last.dur + 0.05 : 0 };
}

const current: { normal: Voice | null; radio: Voice | null } = { normal: null, radio: null };

/** stop any babble currently playing (both channels) */
export function stopBabble(fade = 0.06): void {
  current.normal?.kill(fade);
  current.radio?.kill(fade);
  current.normal = current.radio = null;
}

export function babble(text: string, opts: BabbleOpts = {}): number {
  const plan = planBabble(String(text ?? ''), opts.speed ?? 1);
  const radio = !!opts.radio;
  const total = plan.duration + (radio ? 0.18 : 0);
  if (!isReady() || !plan.syls.length) return total;
  const e = engine() as Engine;
  const key = radio ? 'radio' : 'normal';
  current[key]?.kill(0.05);
  try {
    current[key] = render(e, plan, opts, radio);
  } catch (err) {
    console.warn('[audio] babble failed', err);
  }
  return total;
}

function render(e: Engine, plan: Plan, opts: BabbleOpts, radio: boolean): Voice {
  const t0 = e.ctx.currentTime + 0.02;
  const pitch = clamp(opts.pitch ?? 1, 0.3, 3);
  const v = new Voice(e, t0, { name: radio ? 'babble:radio' : 'babble', counted: false, volume: clamp(opts.volume ?? 1, 0, 2), send: radio ? 0.04 : 0.1 });
  const f0 = 300 * pitch;
  const fs = 1.18 * Math.pow(pitch, 0.35);
  const endT = t0 + plan.duration + 0.25;

  // --- output path (dry, or walkie-talkie)
  let dest: AudioNode = v.out;
  if (radio) {
    const hp = v.filter('highpass', 420, 0.8);
    const lp = v.filter('lowpass', 2700, 0.9);
    const pk = v.filter('peaking', 1500, 1, 5);
    const sh = v.shaper(softClipCurve(3));
    const g = v.gain(0.42);
    wire(hp, lp, pk, sh, g, v.out);
    dest = hp;
    // crackle bed under the whole line + a "kssh" when the mic releases
    const cr = v.crackle(t0, endT);
    const crg = v.gain(0);
    wire(cr, v.filter('bandpass', 2000, 0.8), crg, hp);
    crg.gain.setValueAtTime(0, t0);
    crg.gain.linearRampToValueAtTime(0.35, t0 + 0.05);
    crg.gain.setValueAtTime(0.35, t0 + plan.duration);
    crg.gain.linearRampToValueAtTime(0, t0 + plan.duration + 0.05);
    const tail = v.noise('white', t0 + plan.duration, endT);
    const tg = v.gain(0);
    wire(tail, v.filter('highpass', 900, 0.7), tg, hp);
    const ts = t0 + plan.duration + 0.01;
    tg.gain.setValueAtTime(0, ts);
    tg.gain.linearRampToValueAtTime(0.22, ts + 0.008);
    tg.gain.setValueAtTime(0.22, ts + 0.08);
    tg.gain.exponentialRampToValueAtTime(0.0001, ts + 0.16);
    tg.gain.setValueAtTime(0, ts + 0.161);
  }

  // --- voiced source → formants → syllable envelope
  const osc = v.osc('sawtooth', f0, t0, endT);
  const tri = v.osc('triangle', f0, t0, endT);
  const lp = v.filter('lowpass', 3400 * fs, 0.7);
  wire(osc, v.gain(0.75), lp);
  wire(tri, v.gain(0.6), lp);
  const F1 = v.filter('bandpass', 700 * fs, 4.5);
  const F2 = v.filter('bandpass', 1300 * fs, 6);
  const eg = v.gain(0);
  wire(lp, F1, v.gain(2.1), eg);
  wire(lp, F2, v.gain(1.4), eg);
  wire(lp, v.gain(0.22), eg);
  eg.connect(dest);

  // --- consonant noise
  const nz = v.noise('white', t0, endT);
  const nf = v.filter('bandpass', 4000, 1.2);
  const ng = v.gain(0);
  wire(nz, nf, ng, dest);

  const peak = 0.33;
  for (const s of plan.syls) {
    const st = t0 + s.at;
    const f = f0 * Math.pow(2, s.semis / 12);
    const lead = s.cons === 'hiss' || s.cons === 'sh' ? 0.028 : s.cons === 'breath' ? 0.018 : 0.004;
    const vowelAt = st + Math.min(lead, s.dur * 0.35);
    const vEnd = st + s.dur;
    const scoop = Math.min(0.03, (vEnd - vowelAt) * 0.5);
    // pitch: tiny scoop into the note, optional bend at the end
    osc.frequency.setValueAtTime(f * 1.05, vowelAt);
    osc.frequency.exponentialRampToValueAtTime(f, vowelAt + scoop);
    tri.frequency.setValueAtTime(f * 1.05, vowelAt);
    tri.frequency.exponentialRampToValueAtTime(f, vowelAt + scoop);
    if (s.bend !== 1) {
      osc.frequency.exponentialRampToValueAtTime(f * s.bend, vEnd);
      tri.frequency.exponentialRampToValueAtTime(f * s.bend, vEnd);
    }
    // formants (soft consonants start "closed" then open)
    const [a1, a2] = FORMANTS[s.vowel];
    if (s.cons === 'soft') {
      F1.frequency.setValueAtTime(300 * fs, vowelAt);
      F2.frequency.setValueAtTime(a2 * 0.7 * fs, vowelAt);
      F1.frequency.linearRampToValueAtTime(a1 * fs, vowelAt + scoop);
      F2.frequency.linearRampToValueAtTime(a2 * fs, vowelAt + scoop);
    } else {
      F1.frequency.setValueAtTime(a1 * fs, vowelAt);
      F2.frequency.setValueAtTime(a2 * fs, vowelAt);
    }
    // amplitude
    const pk = peak * s.amp;
    const atk = Math.min(s.cons === 'soft' ? 0.022 : s.cons === 'stop' ? 0.004 : 0.01, (vEnd - vowelAt) * 0.3);
    const rel = Math.min(0.03, (vEnd - vowelAt) * 0.3);
    eg.gain.setValueAtTime(0, vowelAt);
    eg.gain.linearRampToValueAtTime(pk, vowelAt + atk);
    eg.gain.setValueAtTime(pk, Math.max(vowelAt + atk, vEnd - rel));
    eg.gain.linearRampToValueAtTime(0, vEnd);
    // consonant burst
    if (s.cons !== 'none' && s.cons !== 'soft') {
      const cf = s.cons === 'hiss' ? 5200 : s.cons === 'sh' ? 2900 : s.cons === 'stop' ? 2200 : 1500;
      const cd = Math.min(s.cons === 'stop' ? 0.012 : 0.035, s.dur * 0.6);
      const cp = s.cons === 'stop' ? 0.28 : s.cons === 'breath' ? 0.1 : 0.16;
      nf.frequency.setValueAtTime(cf * Math.pow(pitch, 0.25), st);
      ng.gain.setValueAtTime(0, st);
      ng.gain.linearRampToValueAtTime(cp, st + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, st + cd);
      ng.gain.setValueAtTime(0, st + cd + 0.001);
    }
  }
  v.until(endT);
  v.finish();
  return v;
}
