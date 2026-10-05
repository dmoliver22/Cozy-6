/**
 * What comes up in a pot. Seeded so a trip is reproducible.
 */
import { config } from '../config';
import type { Rng } from '../core/rng';
import type { CrabData, Species } from './crabs';
import type { SpecialKind } from '../art/items';

export interface PotCatch {
  crabs: CrabData[];
  special: SpecialKind | null;
  golden: boolean;
}

const SPECIES: Species[] = ['red', 'blue', 'snow'];

export function pickSpecies(rng: Rng): Species {
  const w = SPECIES.map((s) => config.catch[s].weightRoll);
  const total = w.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < SPECIES.length; i++) {
    r -= w[i];
    if (r <= 0) return SPECIES[i];
  }
  return 'red';
}

/**
 * fill = expected crab count from the soak. Snow crab come in heaps (two per roll).
 */
export function rollCatch(rng: Rng, fill: number, roll: (s: Species) => CrabData, opts: { forceGolden?: boolean; special?: SpecialKind | null }): PotCatch {
  const crabs: CrabData[] = [];
  const n = Math.max(2, Math.round(fill + rng.range(-1.5, 1.5)));
  while (crabs.length < n) {
    const s = pickSpecies(rng);
    crabs.push(roll(s));
    if (s === 'snow' && crabs.length < n) crabs.push(roll('snow'));
  }
  const golden = !!opts.forceGolden || rng.chance(config.fishing.goldenChance);
  if (golden) crabs.splice(Math.floor(rng.next() * crabs.length), 0, roll('golden'));
  return { crabs: crabs.slice(0, config.fishing.maxCatchBodies), special: opts.special ?? null, golden };
}
