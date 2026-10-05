/** Tiny typed event bus. Simulation emits; HUD, audio, photos and bots listen. */
import type * as THREE from 'three';

export type RogueSide = 'port' | 'starboard' | 'bow';

export interface GameEvents {
  rogueBell: { side: RogueSide; impactIn: number; amp: number };
  rogueRadio: { side: RogueSide; impactIn: number };
  rogueCrest: { side: RogueSide; impactIn: number };
  rogueImpact: { side: RogueSide; amp: number };
  rogueResolved: { allHeld: boolean; heldCount: number; fallen: string[] };
  braceStart: { crew: string };
  held: { crew: string };
  knockdown: { crew: string; pos: THREE.Vector3; reason: string };
  overboard: { kind: string; who?: string; worldPos: THREE.Vector3 };
  rescued: { crew: string; how: 'ring' | 'crane' };
  ringLanded: { worldPos: THREE.Vector3; hit: boolean };
  potLaunched: { index: number; string: number };
  buoyPopped: { index: number; string: number; worldPos: THREE.Vector3 };
  potHooked: { index: number };
  potLanded: { good: boolean; levelDeg: number };
  potTipped: { count: number };
  golden: { localPos: THREE.Vector3 };
  special: { kind: string; localPos: THREE.Vector3 };
  crabKept: { kind: string; correct: boolean };
  crabReleased: { kind: string; correct: boolean };
  pinch: { crew: string };
  catSlide: { localPos: THREE.Vector3 };
  catPet: {};
  iceChipped: { zone: number; last: boolean };
  radio: { who: string; text: string; urgent?: boolean };
  toast: { text: string; color?: string };
  phase: { name: string };
  photo: { caption: string };
  tutorial: { step: string };
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
