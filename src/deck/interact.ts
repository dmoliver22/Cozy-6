/**
 * Interactables: anything a crew member can act on (items, levers, the wheel, the cat, ice…).
 * The simulation picks a target for each crew member from their aim / facing; devices never do.
 * Verbs map onto the shared buttons:  use = LMB / A / Action,  interact = E / X / Action-tap.
 */
import * as THREE from 'three';

export type Button = 'use' | 'interact' | 'any';

export interface Verb {
  id: string;
  icon: string;
  label: string;
  button: Button;
  /** continuous: tick() runs while the button is held */
  hold?: boolean;
  start?(crewId: string): void;
  tick?(crewId: string, dt: number): void;
  end?(crewId: string): void;
}

export interface Interactable {
  id: number;
  name: string;
  /** local position of the interaction point */
  pos(out: THREE.Vector3): THREE.Vector3;
  /** extra reach slack (big things) */
  radius: number;
  /** larger wins ties */
  priority?: number;
  /** Verbs available to this crew member right now (given what they hold). Empty/null = not targetable. */
  verbs(crewId: string, held: string | null): Verb[] | null;
  /** optional: only targetable within this height band (local y) */
  minY?: number;
  maxY?: number;
}

let nextId = 1;
export function interactableId(): number {
  return nextId++;
}

export class Interactions {
  readonly list: Interactable[] = [];
  add(i: Interactable): Interactable {
    this.list.push(i);
    return i;
  }
  remove(i: Interactable): void {
    const k = this.list.indexOf(i);
    if (k >= 0) this.list.splice(k, 1);
  }
  byId(id: number): Interactable | undefined {
    return this.list.find((i) => i.id === id);
  }
}
