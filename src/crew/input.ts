/**
 * CrewInput — the ONE interface every crew member acts through (human devices and bots alike).
 * The simulation never reads keyboards/touch/gamepads directly; this is the co-op seam.
 */
import * as THREE from 'three';

export interface CrewInput {
  /** desired movement in the boat-local deck plane (x = port, y = bow), |move| ≤ 1 */
  move: THREE.Vector2;
  /** optional facing hint in the deck plane (x, z) */
  face: THREE.Vector2 | null;
  /** local reach / aim point (overhead cursor, FP reticle, bot target). Also the throw target. */
  aim: THREE.Vector3 | null;
  /** FP: hold point should sit in front of the eyes along this local direction */
  lookDir: THREE.Vector3 | null;
  use: boolean;
  usePressed: number;
  useReleased: number;
  interact: boolean;
  interactPressed: number;
  throwAim: boolean;
  throwRelease: number;
  brace: boolean;
  /** explicit target (bots, touch auto-target) */
  targetId: number | null;
  /** run modifier (unused for now — toy crew only walk) */
  sprint: boolean;
  /** raw stick / WASD (x = right, y = up) — used at the wheel for throttle & rudder */
  steer: THREE.Vector2;
}

export function makeInput(): CrewInput {
  return {
    move: new THREE.Vector2(),
    face: null,
    aim: null,
    lookDir: null,
    use: false,
    usePressed: 0,
    useReleased: 0,
    interact: false,
    interactPressed: 0,
    throwAim: false,
    throwRelease: 0,
    brace: false,
    targetId: null,
    sprint: false,
    steer: new THREE.Vector2(),
  };
}

/** Clear edge-triggered fields after the sim consumed them. */
export function consumeEdges(i: CrewInput): void {
  i.usePressed = 0;
  i.useReleased = 0;
  i.interactPressed = 0;
  i.throwRelease = 0;
}
