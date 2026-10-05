/**
 * Shared simulation context. Systems are created by Game and wired here so they can find each other.
 * Nothing in here reads input devices — crew act only through CrewInput.
 */
import type * as THREE from 'three';
import type { Boat } from '../boat/boat';
import type { Sea } from '../sea/waves';
import type { DeckWorld } from '../deck/deckWorld';
import type { DeckStructure } from '../deck/structure';
import type { DeckSurface } from '../deck/surface';
import type { ItemManager } from '../deck/items';
import type { Interactions } from '../deck/interact';
import type { RngHub } from '../core/rng';
import type { BraceSegment } from '../boat/layout';
import type { BoatArt } from '../art/boat';

export interface Ctx {
  boat: Boat;
  sea: Sea;
  dw: DeckWorld;
  structure: DeckStructure;
  surface: DeckSurface;
  items: ItemManager;
  interact: Interactions;
  boatGroup: THREE.Group;
  scene: THREE.Scene;
  boatArt: BoatArt;
  rng: RngHub;
  braceSegs: BraceSegment[];
  /** simulation time (s) */
  time: number;
  /** upgrades owned for this trip */
  upgrades: Set<string>;
  /** "Warm bellies" buff from the potluck */
  buffs: Set<string>;
  /** loose references filled in by systems (avoid import cycles) */
  sys: Record<string, any>;
}
