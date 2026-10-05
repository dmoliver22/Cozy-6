/**
 * Generic "grab it" interactables for loose items. Special items (the cat, pots, the life ring on its hook…)
 * register their own verbs in their systems; this covers buckets, crabs, jars, buoys, hats, tools, specials.
 */
import * as THREE from 'three';
import type { Interactable, Interactions, Verb } from './interact';
import { interactableId } from './interact';
import type { Item } from './items';
import type { CrewManager } from '../crew/crewManager';
import type { CrewId } from '../crew/crew';

export type ItemInteractable = Interactable & { itemRef: Item };

export function registerItemInteractables(items: { onAdd?: (it: Item) => void; onRemove?: (it: Item) => void }, interact: Interactions, crew: () => CrewManager): void {
  const map = new Map<number, ItemInteractable>();
  items.onAdd = (it: Item) => {
    if (it.def.carry === 'none' || it.data.noGrab) return;
    const verb: Verb = {
      id: 'grab',
      icon: it.def.icon,
      label: `Grab ${it.def.label}`,
      button: it.def.carry === 'sticky' ? 'any' : 'use',
      start(crewId: string) {
        crew().get(crewId as CrewId).grab(it);
      },
    };
    const ia: ItemInteractable = {
      id: interactableId(),
      name: it.def.label,
      itemRef: it,
      radius: it.kind === 'pot' ? 2.3 : it.def.carry === 'push' ? 1.0 : 0.15,
      priority: it.kind === 'crab' ? 0.2 : it.kind === 'hat' ? 0.3 : 0,
      pos(out: THREE.Vector3) {
        return it.mode === 'fixed' ? out.copy(it.fixedPos) : it.localPos(out);
      },
      verbs(_crewId: string, held: string | null) {
        if (it.mode !== 'deck' && it.mode !== 'fixed') return null;
        if (it.heldBy) return null;
        if (it.data.noGrab) return null;
        if (held) return null;
        if (it.data.verbs) return it.data.verbs(_crewId, held) as Verb[];
        verb.label = `Grab ${it.data.label ?? it.def.label}`;
        return [verb];
      },
    };
    map.set(it.id, ia);
    it.data.iaId = ia.id;
    interact.add(ia);
  };
  items.onRemove = (it: Item) => {
    const ia = map.get(it.id);
    if (ia) {
      interact.remove(ia);
      map.delete(it.id);
    }
  };
}
