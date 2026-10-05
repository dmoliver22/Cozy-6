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

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 1) return { ...defaultSave(), ...d, finds: { ...defaultSave().finds, ...(d.finds ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  return defaultSave();
}

export function writeSave(s: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    // quota: drop the photos and try again
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...s, photos: s.photos.slice(0, 2) }));
    } catch {
      /* give up quietly */
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
}
