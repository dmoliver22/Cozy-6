/**
 * Raw device state: keyboard, mouse, gamepad. Touch lives in ui/touch.ts and writes into the
 * same `PadState`-like virtual controls. Nothing here touches the simulation.
 */
export interface DeviceSnapshot {
  moveX: number; // -1..1 (right +)
  moveY: number; // -1..1 (up/forward +)
  lookX: number; // per-frame look delta (radians-ish)
  lookY: number;
  use: boolean;
  throwHeld: boolean;
  brace: boolean;
  interact: boolean;
  usePressed: number;
  /** how many of this frame's use presses came from the touch Action button */
  touchUsePressed: number;
  useReleased: number;
  throwPressed: number;
  throwReleased: number;
  interactPressed: number;
  pingPressed: number;
  viewPressed: number;
  pausePressed: number;
  zoomDelta: number;
  /** pointer position in CSS px (mouse) */
  pointerX: number;
  pointerY: number;
  pointerActive: boolean;
  usingPad: boolean;
}

export function makeSnapshot(): DeviceSnapshot {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    use: false,
    throwHeld: false,
    brace: false,
    interact: false,
    usePressed: 0,
    touchUsePressed: 0,
    useReleased: 0,
    throwPressed: 0,
    throwReleased: 0,
    interactPressed: 0,
    pingPressed: 0,
    viewPressed: 0,
    pausePressed: 0,
    zoomDelta: 0,
    pointerX: 0,
    pointerY: 0,
    pointerActive: false,
    usingPad: false,
  };
}

export class Keyboard {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  enabled = true;
  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
  }
  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }
  wasReleased(...codes: string[]): boolean {
    return codes.some((c) => this.released.has(c));
  }
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }
}

export class Mouse {
  x = 0;
  y = 0;
  active = false;
  buttons = 0;
  pressed = [0, 0, 0];
  released = [0, 0, 0];
  dx = 0;
  dy = 0;
  wheel = 0;
  locked = false;
  /** the first mousemove after the pointer lock engages can carry a huge bogus movement */
  private skipMove = false;
  constructor(private el: HTMLElement) {
    el.addEventListener('mousemove', (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
      this.active = true;
      if (this.skipMove) {
        this.skipMove = false;
        return;
      }
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    el.addEventListener('mousedown', (e) => {
      this.buttons = e.buttons;
      if (e.button < 3) this.pressed[e.button]++;
      this.active = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons = e.buttons;
      if (e.button < 3) this.released[e.button]++;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (this.locked && !was) {
        this.skipMove = true;
        this.dx = this.dy = 0;
      }
    });
  }
  /** b is a MouseEvent.button index (0 left, 1 middle, 2 right); `buttons` is a bitmask in a
   *  different order (1 left, 2 right, 4 middle). */
  isDown(b: number): boolean {
    return (this.buttons & ([1, 4, 2][b] ?? 0)) !== 0;
  }
  requestLock(): void {
    if (!this.locked && this.el.requestPointerLock) {
      try {
        const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => {});
      } catch {
        /* ignore */
      }
    }
  }
  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }
  endFrame(): void {
    this.pressed = [0, 0, 0];
    this.released = [0, 0, 0];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}

/** Standard-mapping gamepad: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Back=8 Start=9 */
export class Gamepads {
  private prev: boolean[] = [];
  cur: boolean[] = [];
  axes: number[] = [0, 0, 0, 0];
  rt = 0;
  connected = false;
  lastActive = 0;
  private blocked = false;
  poll(): void {
    // getGamepads throws a SecurityError in frames without the gamepad permission: stop asking
    let pads: ArrayLike<Gamepad | null> = [];
    if (!this.blocked && navigator.getGamepads) {
      try {
        pads = navigator.getGamepads() ?? [];
      } catch {
        this.blocked = true;
      }
    }
    const gp = Array.from(pads).find((p) => p && p.connected) ?? null;
    this.prev = this.cur;
    if (!gp) {
      this.connected = false;
      this.cur = [];
      return;
    }
    this.connected = true;
    this.cur = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    this.rt = gp.buttons[7]?.value ?? 0;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.axes = [dz(gp.axes[0] ?? 0), dz(gp.axes[1] ?? 0), dz(gp.axes[2] ?? 0), dz(gp.axes[3] ?? 0)];
    if (this.cur.some((b) => b) || this.axes.some((a) => a !== 0)) this.lastActive = performance.now();
  }
  down(i: number): boolean {
    return !!this.cur[i];
  }
  pressed(i: number): boolean {
    return !!this.cur[i] && !this.prev[i];
  }
  released(i: number): boolean {
    return !this.cur[i] && !!this.prev[i];
  }
}
