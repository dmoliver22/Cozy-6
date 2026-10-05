/**
 * Pot Luck audio — procedural (WebAudio-only) SFX, ambience loops, dialog
 * babble and a generative score. See sfx.ts / music.ts for the API.
 *
 * Integration: call `sfx.unlock()` from user gestures (pointerdown / keydown /
 * touchend). It is cheap and idempotent, so it is fine to call on every one.
 */
export { sfx, SFX_NAMES, LOOP_NAMES, stopBabble, onAudioReady } from './sfx';
export type { SfxName, PlayOpts, LoopHandle, LoopName } from './sfx';
export { music } from './music';
export type { MusicMood } from './music';
