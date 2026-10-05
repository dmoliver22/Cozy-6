/** Progress saved in localStorage: owned upgrades, hat color, photos, finds, buff. */
export interface PhotoRecord {
  img: string; // JPEG data URL
  caption: string;
  kind: string;
}

export interface SaveData {
  version: 1;
  tripsCompleted: number;
  coins: number;
  upgrades: string[];
  hatColor: number;
  photos: PhotoRecord[];
  buff: string | null;
  finds: { boot: boolean; bell: boolean; lore: number[] };
  lastTrip: { earnings: number; kg: number; crabs: number; golden: number; overboards: number; allHeld: number; date: string } | null;
}

const KEY = 'potluck.save.v1';
/** window.name survives a reload of the same frame: the fallback when localStorage is unavailable */
const WN = 'potluck.save:';

export function defaultSave(): SaveData {
  return {
    version: 1,
    tripsCompleted: 0,
    coins: 0,
    upgrades: [],
    hatColor: 0xc8432f,
    photos: [],
    buff: null,
    finds: { boot: false, bell: false, lore: [] },
    lastTrip: null,
  };
}

function parseSave(raw: string | null | undefined): SaveData | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d && d.version === 1) return { ...defaultSave(), ...d, finds: { ...defaultSave().finds, ...(d.finds ?? {}) } };
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
