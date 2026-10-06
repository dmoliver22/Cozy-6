/**
 * Progress between trips: the Rougher Season ramp (one notch of sea per trip), Today's Tide (a daily
 * seed plus a flavour), ranks, the Deckhand's Log and chart views, and recording a finished trip.
 *
 * Everything here writes into `config` before the trip starts (Game.applyProgress, in the Game
 * constructor). That is safe because every next trip goes through a page reload.
 */
import { config, urlParams } from '../config';
import { hashString } from '../core/rng';
import { defaultMastery, type SaveData } from '../core/save';
import type { TripScore } from './score';
import type { TripStats } from './trip';

// ---------------------------------------------------------------------------- the season ramp
export interface Tier {
  sea: string;
  stormSets: number;
  stormAmp: number;
  choppyAmp: number;
  stormGap: [number, number];
  choppyGap: [number, number];
  ice: number;
  window: number;
  core: number;
  bracePerfect: number;
  chain: number;
  aim: number;
  hints: boolean;
  /** only a missed landing unties the streak */
  lenient: boolean;
}

/** Tier 2 is exactly the defaults in config.ts. */
export const TIERS: Tier[] = [
  { sea: 'Gentle', stormSets: 2, stormAmp: 2.4, choppyAmp: 1.6, stormGap: [36, 50], choppyGap: [80, 110], ice: 0.7, window: 6.0, core: 2.0, bracePerfect: 1.8, chain: 4.0, aim: 3.5, hints: true, lenient: true },
  { sea: 'Fresh', stormSets: 3, stormAmp: 2.6, choppyAmp: 1.75, stormGap: [34, 48], choppyGap: [75, 105], ice: 0.85, window: 5.0, core: 1.75, bracePerfect: 1.5, chain: 3.5, aim: 3.5, hints: true, lenient: false },
  { sea: 'Lively', stormSets: 3, stormAmp: 2.8, choppyAmp: 1.9, stormGap: [32, 48], choppyGap: [70, 100], ice: 1.0, window: 4.5, core: 1.5, bracePerfect: 1.2, chain: 3.0, aim: 3.5, hints: false, lenient: false },
  { sea: 'Rough', stormSets: 4, stormAmp: 2.9, choppyAmp: 2.0, stormGap: [28, 42], choppyGap: [65, 90], ice: 1.2, window: 4.0, core: 1.25, bracePerfect: 1.0, chain: 3.0, aim: 3.0, hints: false, lenient: false },
  { sea: 'Wild', stormSets: 4, stormAmp: 3.0, choppyAmp: 2.1, stormGap: [26, 38], choppyGap: [60, 85], ice: 1.35, window: 4.0, core: 1.25, bracePerfect: 1.0, chain: 2.5, aim: 3.0, hints: false, lenient: false },
];
/** trip n (1-based) is fished at TRIP_TIER[n − 1]; trip 10 and on stay at the top */
export const TRIP_TIER = [0, 1, 2, 2, 3, 3, 4, 4, 4, 4];
/** the floors no tier or tide goes past */
const MIN_WINDOW_DEG = 4.0;

/** The tier for the coming trip: ?tier=N wins; ?autostart=1 (the probes) is tier 2, today's exact config. */
export function tierFor(save: SaveData, params: Record<string, string> = urlParams): number {
  if (params.tier !== undefined && /^[0-4]$/.test(params.tier)) return Number(params.tier);
  if (params.autostart === '1') return 2;
  return TRIP_TIER[Math.min(Math.max(0, save.tripsCompleted), TRIP_TIER.length - 1)];
}

/** Every config value the ramp or a tide touches. */
function touched() {
  const w = config.weather,
    f = config.fishing,
    c = config.catch;
  return {
    stormRogueSets: w.stormRogueSets,
    rogueAmp: { ...w.rogueAmp },
    stormRogueGapSec: [...w.stormRogueGapSec],
    choppyRogueGapSec: [...w.choppyRogueGapSec],
    iceScale: w.iceScale,
    levelWindowDeg: f.levelWindowDeg,
    levelPerfectDeg: f.levelPerfectDeg,
    aimAssistRadius: f.aimAssistRadius,
    goldenChance: f.goldenChance,
    specialChance: f.specialChance,
    bracePerfectSec: config.brace.perfectSec,
    chainSec: config.sort.chainSec,
    hints: config.sort.hints,
    lenient: config.score.lenient,
    snowWeightRoll: c.snow.weightRoll,
    snowPrice: c.snow.pricePerKg,
    blueWeightRoll: c.blue.weightRoll,
    priceScale: c.priceScale,
    tier: config.progress.tier,
    tide: config.progress.tide,
  };
}
export type ConfigSnapshot = ReturnType<typeof touched>;
/** The defaults, captured when this module loads (before any tier or tide is applied). */
export const DEFAULTS: ConfigSnapshot = JSON.parse(JSON.stringify(touched()));
/** A copy of every value the ramp and tides touch (the probes compare these). */
export function configSnapshot(): ConfigSnapshot {
  return JSON.parse(JSON.stringify(touched()));
}

/** Write a tier into config. Absolute, so it is idempotent; it also clears anything a tide changed. */
export function applyTier(t: number): void {
  const T = TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.round(t)))];
  const w = config.weather,
    f = config.fishing,
    c = config.catch;
  const max = config.sea.rogue.maxAmp;
  // tide-only values back to their defaults
  f.goldenChance = DEFAULTS.goldenChance;
  f.specialChance = DEFAULTS.specialChance;
  c.snow.weightRoll = DEFAULTS.snowWeightRoll;
  c.snow.pricePerKg = DEFAULTS.snowPrice;
  c.blue.weightRoll = DEFAULTS.blueWeightRoll;
  c.priceScale = DEFAULTS.priceScale;
  // the tier
  w.stormRogueSets = T.stormSets;
  w.rogueAmp.storm = Math.min(max, T.stormAmp);
  w.rogueAmp.choppy = Math.min(max, T.choppyAmp);
  w.stormRogueGapSec[0] = T.stormGap[0];
  w.stormRogueGapSec[1] = T.stormGap[1];
  w.choppyRogueGapSec[0] = T.choppyGap[0];
  w.choppyRogueGapSec[1] = T.choppyGap[1];
  w.iceScale = T.ice;
  f.levelWindowDeg = Math.max(MIN_WINDOW_DEG, T.window);
  f.levelPerfectDeg = Math.min(T.core, f.levelWindowDeg);
  f.aimAssistRadius = T.aim;
  config.brace.perfectSec = T.bracePerfect;
  config.sort.chainSec = T.chain;
  config.sort.hints = T.hints;
  config.score.lenient = T.lenient;
  config.progress.tier = TIERS.indexOf(T);
  config.progress.tide = -1;
}

// ---------------------------------------------------------------------------- Today's Tide
export interface Tide {
  name: string;
  icon: string;
  /** 🌶 a spicier day (it pays more) */
  spicy: boolean;
  mo: string;
}

export const TIDES: Tide[] = [
  { name: 'Glassy Morning', icon: '🪞', spicy: false, mo: 'Flat as a millpond, kid. A good day to practise your landings.' },
  { name: 'Snow Crab Run', icon: '❄️', spicy: false, mo: "Snow crab are running thick. Buyer's paying a dollar more a kilo." },
  { name: 'Blue Moon', icon: '🌕', spicy: false, mo: 'Blue moon last night. The blue kings come up for it.' },
  { name: 'Golden Hour', icon: '✨', spicy: false, mo: 'Low sun on the water. Keep an eye out for the golden ones.' },
  { name: 'Otter Tide', icon: '🦦', spicy: false, mo: 'The otters are out. Expect company in the pots.' },
  { name: 'Big Swell', icon: '🌊', spicy: true, mo: "Big lumpy sets today. Buyer's paying storm money." },
  { name: 'Frost Smoke', icon: '🌫', spicy: true, mo: 'Sea smoke and a hard frost. Mind the ice; it pays.' },
];

/** The date clock (the probes can stub `clock.now`). */
export const clock = { now: (): Date => new Date() };

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** A YYYY-MM-DD key as a local date at noon (clear of DST edges). */
function dateOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** The local date as YYYY-MM-DD. */
export function todayKey(d: Date = clock.now()): string {
  return keyOf(d);
}

/** Today's seed: everyone fishing today fishes the same water. */
export function dailySeed(key: string = todayKey()): number {
  return hashString('potluck:' + key);
}

const TIDE_EPOCH = '2025-01-01';
const tideCache = new Map<string, number>();
/** Today's tide flavour: dailySeed % 7, bumped by one when it would repeat yesterday's. */
export function tideIndex(key: string = todayKey()): number {
  const hit = tideCache.get(key);
  if (hit !== undefined) return hit;
  const raw = (k: string) => dailySeed(k) % TIDES.length;
  if (key <= TIDE_EPOCH) return raw(key);
  // walk forward from the epoch, so "yesterday's index" is always the real one
  const d = dateOf(TIDE_EPOCH);
  let prev = raw(TIDE_EPOCH);
  for (let i = 0; i < 200000; i++) {
    d.setDate(d.getDate() + 1);
    const k = keyOf(d);
    let idx = tideCache.get(k);
    if (idx === undefined) {
      idx = raw(k);
      if (idx === prev) idx = (idx + 1) % TIDES.length;
      tideCache.set(k, idx);
    }
    prev = idx;
    if (k >= key) break;
  }
  return tideCache.get(key) ?? raw(key);
}

/** The tide for the coming trip (−1 for none): never on the tutorial trip; ?tide=N forces one. */
export function tideFor(save: SaveData, params: Record<string, string> = urlParams, key: string = todayKey()): number {
  if (save.tripsCompleted === 0) return -1;
  if (params.tide !== undefined && /^(-1|[0-6])$/.test(params.tide)) return Number(params.tide);
  if (params.autostart === '1') return -1; // the probes fish today's exact config
  return tideIndex(key);
}

/** Apply today's tide on top of the tier (after applyTier). Returns the flavour index or −1. */
export function applyTide(save: SaveData, params: Record<string, string> = urlParams, key: string = todayKey()): number {
  const idx = tideFor(save, params, key);
  if (idx < 0) return -1;
  const w = config.weather,
    f = config.fishing,
    c = config.catch;
  switch (idx) {
    case 0: // Glassy Morning: a practice day
      w.rogueAmp.choppy *= 0.85;
      w.choppyRogueGapSec[0] *= 1.25;
      w.choppyRogueGapSec[1] *= 1.25;
      break;
    case 1: // Snow Crab Run
      c.snow.weightRoll = 0.7;
      c.snow.pricePerKg += 1;
      break;
    case 2: // Blue Moon
      c.blue.weightRoll *= 2;
      break;
    case 3: // Golden Hour
      f.goldenChance *= 2;
      break;
    case 4: // Otter Tide
      f.specialChance = 0.4;
      break;
    case 5: // Big Swell 🌶
      w.rogueAmp.storm += 0.2;
      w.rogueAmp.choppy += 0.2;
      w.stormRogueSets += 1;
      c.priceScale = 1.2;
      break;
    case 6: // Frost Smoke 🌶
      w.iceScale *= 1.6;
      c.priceScale = 1.1;
      break;
  }
  const max = config.sea.rogue.maxAmp;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  w.rogueAmp.storm = r2(Math.min(max, w.rogueAmp.storm));
  w.rogueAmp.choppy = r2(Math.min(max, w.rogueAmp.choppy));
  config.progress.tide = idx;
  return idx;
}

// ---------------------------------------------------------------------------- ranks
export const RANK_NAMES = ['Greenhorn', 'Deckhand', 'Able Hand', 'Bosun', 'Skipper', 'Old Salt'];

export function rankFor(score: number): number {
  const r = config.score.ranks;
  let i = 0;
  while (i + 1 < r.length && score >= r[i + 1]) i++;
  return i;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** "Bosun 8,240" (or just "Bosun" with scores hidden). */
export function rankLine(score: number, showScores = true): string {
  const name = RANK_NAMES[rankFor(score)];
  return showScores ? `${name} ${fmt(score)}` : name;
}

/** The Log's one tip: the first rule that matches. */
export function tipFor(s: TripScore): string {
  const c = s.counts;
  const graded = c.landAttempts + c.braceGraded + c.braceMiss + c.hookAttempts + c.sorts + c.wrongSorts;
  if (c.landAttempts >= 2 && c.landPerfect / c.landAttempts < 0.3) return 'Let go as the bubble crosses the middle, not when it stops.';
  if (c.braceGraded > 0 && c.braceSafe / c.braceGraded > 0.5) return 'Wait for the gold arc. Early is safe; late is stylish.';
  if (c.sorts >= 6 && c.peakChain <= 3) return 'Grab the next crab before the last one lands.';
  if (c.hookAttempts >= 2 && c.ringers === 0) return "Aim at the buoy itself. The hook forgives you; the grade doesn't.";
  if (graded < 3) return 'Lend a hand! Stand by the cradle and Dot will leave the pot to you.';
  return 'Steady hands. The sea gets livelier next trip.';
}

const CREW_NAMES: Record<string, string> = { player: 'You', mo: 'Mo', dot: 'Dot', ike: 'Ike' };

/** Pure comedy: "Ike airborne · 2 swims · 3 pinches". */
export function bloopersLine(s: TripScore, stats: TripStats): string {
  const parts: string[] = [];
  let who = '';
  let most = 0;
  for (const [id, n] of Object.entries(s.tumbles)) {
    if (n > most) {
      most = n;
      who = id;
    }
  }
  if (who) parts.push(`${CREW_NAMES[who] ?? who} airborne${most > 1 ? ` ×${most}` : ''}`);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (stats.overboards) parts.push(plural(stats.overboards, 'swim', 'swims'));
  if (stats.pinches) parts.push(plural(stats.pinches, 'pinch', 'pinches'));
  if (stats.catPets) parts.push(plural(stats.catPets, 'cat pat', 'cat pats'));
  return parts.length ? parts.join(' · ') : 'Not one tumble. Suspiciously tidy.';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue 6 Oct" */
function dateLabel(key: string): string {
  const d = dateOf(key);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function tideLabel(idx: number): string {
  const t = TIDES[idx];
  return t ? `${t.name} ${t.icon}${t.spicy ? ' 🌶' : ''}` : '';
}

// ---------------------------------------------------------------------------- the Deckhand's Log
export interface LogRow {
  key: 'brace' | 'land' | 'hook' | 'sort';
  label: string;
  icon: string;
  pips: string;
  empty: string;
}

export interface LogView {
  trip: number;
  dateLine: string;
  score: number;
  rank: number;
  rankName: string;
  /** "1,180 to Skipper" within 15% of the next rank */
  nearMiss: string | null;
  rows: LogRow[];
  bestStreak: number;
  ribbons: string[];
  tip: string;
  bloopers: string;
  showScores: boolean;
}

/** The end-of-trip card, with NEW BEST flags against the save (before recordTrip updates it). */
export function logView(save: SaveData, s: TripScore, stats: TripStats, showScores = true, key: string = todayKey()): LogView {
  const m = save.mastery ?? defaultMastery();
  const rank = rankFor(s.score);
  const next = config.score.ranks[rank + 1];
  const nearMiss = next !== undefined && s.score > 0 && (next - s.score) / next <= 0.15 ? `${fmt(next - s.score)} to ${RANK_NAMES[rank + 1]}` : null;
  const ribbons: string[] = [];
  // bests only mean something once there's a trip to beat
  if (m.history.length > 0) {
    if (s.score > m.bestScore) ribbons.push('NEW BEST score');
    if (s.bestStreak > m.bestStreak) ribbons.push('NEW BEST streak');
    if (s.counts.landPerfect > m.bestPerfectLandings) ribbons.push('NEW BEST dead-level landings');
  }
  const today = save.tides?.[key];
  if (today && today.runs > 0 && s.score > today.best) ribbons.push('New best for today!');
  return {
    trip: save.tripsCompleted + 1,
    dateLine: [dateLabel(key), s.tide >= 0 ? tideLabel(s.tide) : ''].filter(Boolean).join(' · '),
    score: s.score,
    rank,
    rankName: RANK_NAMES[rank],
    nearMiss,
    rows: [
      { key: 'brace', label: 'Brace', icon: '🤲', pips: s.pips.brace, empty: 'no waves braced' },
      { key: 'land', label: 'Landing', icon: '🧺', pips: s.pips.land, empty: 'no pots landed' },
      { key: 'hook', label: 'Grapple', icon: '🪝', pips: s.pips.hook, empty: 'no throws' },
      { key: 'sort', label: 'Sorting', icon: '🦀', pips: s.pips.sort, empty: 'no crabs sorted' },
    ],
    bestStreak: s.bestStreak,
    ribbons,
    tip: tipFor(s),
    bloopers: bloopersLine(s, stats),
    showScores,
  };
}

/** Bank a finished trip: bests, lifetime counts, history (last 10), today's tide (last 14 dates), days at sea. */
export function recordTrip(save: SaveData, s: TripScore, key: string = todayKey()): void {
  const m = (save.mastery ??= defaultMastery());
  const rank = rankFor(s.score);
  m.bestScore = Math.max(m.bestScore, s.score);
  m.bestStreak = Math.max(m.bestStreak, s.bestStreak);
  m.bestRank = Math.max(m.bestRank, rank);
  m.bestPerfectLandings = Math.max(m.bestPerfectLandings, s.counts.landPerfect);
  m.perfects.land += s.counts.landPerfect;
  m.perfects.brace += s.counts.bracePerfect;
  m.perfects.hook += s.counts.ringers;
  m.clutches += s.counts.clutches;
  m.cleanTables += s.counts.cleanTables;
  m.history.push({ d: key, s: s.score, r: rank, land: s.pips.land.slice(-20) });
  if (m.history.length > 10) m.history.splice(0, m.history.length - 10);
  const tides = (save.tides ??= {});
  const t = tides[key] ?? { best: 0, rank: 0, flav: s.tide, runs: 0 };
  t.runs++;
  if (s.score >= t.best) {
    t.best = s.score;
    t.rank = rank;
  }
  t.flav = s.tide;
  tides[key] = t;
  const keys = Object.keys(tides).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 14))) delete tides[k];
  if (save.lastDay !== key) save.daysAtSea = (save.daysAtSea ?? 0) + 1;
  save.lastDay = key;
}

// ---------------------------------------------------------------------------- the chart
export interface ChartView {
  trips: number;
  upgrades: string[];
  dateLine: string;
  tide: Tide | null;
  tideLine: string;
  moLine: string;
  seaLine: string;
  forecast: string;
  todayBest: string;
  yourBest: string | null;
  lastLand: string;
}

export function chartView(save: SaveData, showScores = true, params: Record<string, string> = urlParams, key: string = todayKey()): ChartView {
  const tier = tierFor(save, params);
  const tide = tideFor(save, params, key);
  const T = TIERS[tier];
  const sets = T.stormSets + (tide === 5 ? 1 : 0);
  const m = save.mastery ?? defaultMastery();
  const today = save.tides?.[key];
  const last = m.history[m.history.length - 1];
  return {
    trips: save.tripsCompleted,
    upgrades: save.upgrades,
    dateLine: dateLabel(key),
    tide: tide >= 0 ? TIDES[tide] : null,
    tideLine: tide >= 0 ? tideLabel(tide) : 'A plain old tide',
    moLine: tide >= 0 ? TIDES[tide].mo : 'Nothing fancy out there today. Just crab.',
    seaLine: `Sea: ${T.sea}`,
    forecast: `☀️ calm → 🌬 choppy → ⛈ ${sets} storm sets`,
    todayBest: today && today.runs > 0 ? `Today's best: ${RANK_NAMES[today.rank] ?? ''}${showScores ? ` · ${fmt(today.best)}` : ''} (${today.runs} run${today.runs === 1 ? '' : 's'})` : 'Not fished yet today',
    yourBest:
      m.history.length > 0 ? `Your best: ${RANK_NAMES[m.bestRank]}${showScores ? ` ${fmt(m.bestScore)}` : ''} · longest streak ${m.bestStreak} · Days at sea ${save.daysAtSea ?? 0}` : null,
    lastLand: last?.land ?? '',
  };
}
