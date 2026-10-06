/** Tiny typed event bus. Simulation emits; HUD, audio, photos and bots listen. */
import type * as THREE from 'three';

export type RogueSide = 'port' | 'starboard' | 'bow';

export interface GameEvents {
  rogueBell: { side: RogueSide; impactIn: number; amp: number };
  rogueRadio: { side: RogueSide; impactIn: number };
  rogueCrest: { side: RogueSide; impactIn: number };
  rogueImpact: { side: RogueSide; amp: number };
  /** tImpact: sim time of impact · braceAge: crew id → seconds braced at impact (−1 = not braced) · atImpact: crew on deck at impact */
  rogueResolved: { allHeld: boolean; heldCount: number; fallen: string[]; tImpact?: number; braceAge?: Record<string, number>; atImpact?: string[] };
  braceStart: { crew: string };
  held: { crew: string };
  knockdown: { crew: string; pos: THREE.Vector3; reason: string };
  overboard: { kind: string; who?: string; worldPos: THREE.Vector3 };
  rescued: { crew: string; how: 'ring' | 'crane' };
  ringLanded: { worldPos: THREE.Vector3; hit: boolean };
  potLaunched: { index: number; string: number };
  buoyPopped: { index: number; string: number; worldPos: THREE.Vector3 };
  potHooked: { index: number };
  /** grade: judged on the levelest the deck was over the release grace · by: who guided it · dx: metres off the cradle centre */
  potLanded: { good: boolean; levelDeg: number; grade?: 'perfect' | 'good' | 'miss'; by?: string; dx?: number; stringNo?: number; pot?: number };
  /** spawned: crabs that came out as bodies (the rest went down the chute) · tipId: stamped on each spawned crab */
  potTipped: { count: number; spawned?: number; tipId?: number };
  golden: { localPos: THREE.Vector3 };
  special: { kind: string; localPos: THREE.Vector3 };
  /** by: who sorted it (whoever let go of it within the last 4 s) */
  crabKept: { kind: string; correct: boolean; by?: string; tipId?: number; golden?: boolean };
  crabReleased: { kind: string; correct: boolean; by?: string; tipId?: number };
  pinch: { crew: string };
  catSlide: { localPos: THREE.Vector3 };
  catPet: {};
  iceChipped: { zone: number; last: boolean };
  radio: { who: string; text: string; urgent?: boolean };
  toast: { text: string; color?: string };
  phase: { name: string };
  photo: { caption: string };
  tutorial: { step: string };
  /** a grapple throw came down: rawErr = metres from the un-assisted aim point to the buoy it hooked (or the nearest one) */
  hooked: { by: string; rawErr: number; dist: number; hit: boolean; stringNo?: number };
  /** a scored skill moment (player only) */
  grade: { moment: 'land' | 'brace' | 'hook' | 'sort' | 'bonus'; grade: string; label: string; points: number; mult: number; localPos: THREE.Vector3; knots: number; chain?: number; big?: string; bigMinor?: boolean };
  streakBroken: { knots: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();
  on<K extends keyof GameEvents>(name: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit<K extends keyof GameEvents>(name: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

export const events = new EventBus();
