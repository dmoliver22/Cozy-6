/** Player settings, persisted in localStorage (separate from trip progress). */
export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high';
  comfortRoll: number; // first-person roll factor 0..0.6
  headBob: boolean;
  haptics: boolean;
  volume: number; // master 0..1
  music: number; // 0..1
  invertLook: boolean;
  reduceFlashing: boolean;
  /** off (default): a tap or click picks a thing up and keeps holding it, the next tap puts it down.
   *  on: hold the button to carry, let go to put it down. */
  holdToCarry: boolean;
  /** off: grade pops, the score strip and the Log keep their words but hide the numbers */
  showScores: boolean;
}

const KEY = 'potluck.settings.v1';

export const defaultSettings: Settings = {
  quality: 'auto',
  comfortRoll: 0.3,
  headBob: true,
  haptics: true,
  volume: 0.8,
  music: 0.6,
  invertLook: false,
  reduceFlashing: false,
  holdToCarry: false,
  showScores: true,
};

type Listener = (s: Settings) => void;
const listeners: Listener[] = [];

/** Be told whenever settings are saved (the menu saves on every change). Returns the unsubscribe. */
export function onSettingsChange(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* private mode */
  }
  return { ...defaultSettings };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(s);
}
