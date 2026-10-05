/** Fish buyer maths: price per kg × freshness × sorting quality. */
import { config } from '../config';

export interface TankEntry {
  species: string;
  weight: number;
  correct: boolean;
  at: number;
}

export interface Appraisal {
  lines: { species: string; name: string; count: number; kg: number; value: number }[];
  wrong: number;
  penalty: number;
  freshness: number;
  total: number;
  kg: number;
  crabs: number;
  golden: number;
}

export function appraise(tank: TankEntry[], endTime: number): Appraisal {
  const by = new Map<string, { count: number; kg: number; value: number }>();
  let wrong = 0;
  let freshSum = 0;
  let gross = 0;
  for (const e of tank) {
    const ageMin = Math.max(0, (endTime - e.at) / 60);
    const fresh = Math.max(0.7, 1 - ageMin * config.catch.freshnessLossPerMin);
    freshSum += fresh;
    if (!e.correct) {
      wrong++;
      continue;
    }
    const c = config.catch[e.species as 'red'];
    const v = e.weight * (c?.pricePerKg ?? 8) * fresh;
    gross += v;
    const row = by.get(e.species) ?? { count: 0, kg: 0, value: 0 };
    row.count++;
    row.kg += e.weight;
    row.value += v;
    by.set(e.species, row);
  }
  const penalty = Math.min(0.5, wrong * config.catch.wrongKeepPenalty);
  const order = ['golden', 'red', 'blue', 'snow'];
  const lines = order
    .filter((s) => by.has(s))
    .map((s) => ({ species: s, name: config.catch[s as 'red'].name, ...by.get(s)! }));
  const kg = lines.reduce((a, l) => a + l.kg, 0);
  return {
    lines,
    wrong,
    penalty,
    freshness: tank.length ? freshSum / tank.length : 1,
    total: gross * (1 - penalty),
    kg,
    crabs: lines.reduce((a, l) => a + l.count, 0),
    golden: by.get('golden')?.count ?? 0,
  };
}

export const UPGRADES: { id: string; icon: string; name: string; desc: string }[] = [
  { id: 'fasterHauler', icon: '⚙️', name: 'Faster hauler', desc: 'Pots come up 60% faster.' },
  { id: 'railNets', icon: '🕸', name: 'Rail nets', desc: 'Far fewer trips over the rail.' },
  { id: 'heaterLines', icon: '🔥', name: 'Deck heater lines', desc: 'Ice builds up much slower.' },
  { id: 'betterRadar', icon: '📡', name: 'Better radar', desc: '+2 s of warning before rogue sets.' },
  { id: 'biggerTank', icon: '🛢', name: 'Bigger tank', desc: 'Hold 50% more crab.' },
  { id: 'catHammock', icon: '🐈', name: 'Cat hammock', desc: 'Barnacle naps safe by the stove.' },
];

export const HAT_COLORS = [0xc8432f, 0xf2c230, 0x1f5c66, 0x7d7ba6, 0xe8742b, 0x4f8a3a, 0x2b2f36, 0xeaf2f0];
