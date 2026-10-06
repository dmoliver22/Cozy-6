/** Progress saved in localStorage: owned upgrades, hat color, photos, finds, buff, bests and today's tide. */
export interface PhotoRecord {
  img: string; // JPEG data URL
  caption: string;
  kind: string;
}

export interface Mastery {
  bestScore: number;
  bestStreak: number;
  /** rank index 0..5 (Greenhorn … Old Salt) */
  bestRank: number;
  bestPerfectLandings: number;
  /** lifetime counts */
  perfects: { land: number; brace: number; hook: number };
  clutches: number;
  cleanTables: number;
  /** the last 10 trips; land = landing pip string, e.g. "PGGPM" */
  history: { d: string; s: number; r: number; land: string }[];
}

export interface TideRecord {
  best: number;
  rank: number;
  flav: number;
  runs: number;
}

export interface SaveData {
  version: 1 | 2;
  tripsCompleted: number;
  coins: number;
  upgrades: string[];
  hatColor: number;
  photos: PhotoRecord[];
  buff: string | null;
  finds: { boot: boolean; bell: boolean; lore: number[] };
  lastTrip: { earnings: number; kg: number; crabs: number; golden: number; overboards: number; allHeld: number; date: string } | null;
  mastery: Mastery;
  /** today's best per local date (YYYY-MM-DD), the last 14 dates */
  tides: Record<string, TideRecord>;
  daysAtSea: number;
  /** YYYY-MM-DD of the last completed trip */
  lastDay: string | null;
}

const KEY = 'potluck.save.v1';
/** window.name survives a reload of the same frame: the fallback when localStorage is unavailable */
const WN = 'potluck.save:';

export function defaultMastery(): Mastery {
  return { bestScore: 0, bestStreak: 0, bestRank: 0, bestPerfectLandings: 0, perfects: { land: 0, brace: 0, hook: 0 }, clutches: 0, cleanTables: 0, history: [] };
}

export function defaultSave(): SaveData {
  return {
    version: 2,
    tripsCompleted: 0,
    coins: 0,
    upgrades: [],
    hatColor: 0xc8432f,
    photos: [],
    buff: null,
    finds: { boot: false, bell: false, lore: [] },
    lastTrip: null,
    mastery: defaultMastery(),
    tides: {},
    daysAtSea: 0,
    lastDay: null,
  };
}

/** v1 saves load with the new fields zeroed and are written back as v2. */
function migrate(d: any): SaveData {
  const def = defaultSave();
  const m = d.mastery && typeof d.mastery === 'object' ? d.mastery : {};
  return {
    ...def,
    ...d,
    finds: { ...def.finds, ...(d.finds ?? {}) },
    mastery: { ...def.mastery, ...m, perfects: { ...def.mastery.perfects, ...(m.perfects ?? {}) }, history: Array.isArray(m.history) ? m.history.slice(-10) : [] },
    tides: d.tides && typeof d.tides === 'object' ? d.tides : {},
    daysAtSea: Number(d.daysAtSea) || 0,
    lastDay: typeof d.lastDay === 'string' ? d.lastDay : null,
    version: 2,
  };
}

function parseSave(raw: string | null | undefined): SaveData | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d && (d.version === 1 || d.version === 2)) return migrate(d);
  } catch {
    /* corrupt: ignore */
  }
  return null;
}

export function loadSave(): SaveData {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* storage blocked */
  }
  const fromStorage = parseSave(raw);
  if (fromStorage) return fromStorage;
  try {
    if (window.name.startsWith(WN)) return parseSave(window.name.slice(WN.length)) ?? defaultSave();
  } catch {
    /* ignore */
  }
  return defaultSave();
}

export function writeSave(s: SaveData): boolean {
  const json = JSON.stringify(s);
  try {
    window.name = WN + json;
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(KEY, json);
    return true;
  } catch {
    // quota: drop the photos and try again
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...s, photos: s.photos.slice(0, 2) }));
      return true;
    } catch {
      /* storage blocked: window.name still carries it across the reload */
    }
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  try {
    if (window.name.startsWith(WN)) window.name = '';
  } catch {
    /* ignore */
  }
}
