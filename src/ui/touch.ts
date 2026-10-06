/**
 * Touch overlay (phones): floating left joystick, big contextual Action button (tap / hold / slingshot-drag to throw),
 * big Brace button, view 👁 and menu ☰ buttons, right-half drag to look in first person, pinch to zoom.
 * Writes into the same DeviceSnapshot as keyboard/mouse/gamepad.
 */
import type { DeviceSnapshot } from '../input/devices';
import { config } from '../config';

export interface ActionInfo {
  icon: string;
  label: string;
  /** a distinct "tap" verb (e.g. pet) exists alongside a "hold" verb (pick up) */
  tapIsInteract: boolean;
  holdLabel?: string;
  canThrow: boolean;
  holding: boolean;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private parent: HTMLElement;
  active: boolean;
  recentlyUsed = false;
  moveX = 0;
  moveY = 0;
  throwVec: { x: number; y: number } | null = null;
  private lookDX = 0;
  private lookDY = 0;
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private lookTouch: { id: number; x: number; y: number } | null = null;
  private actionTouch: { id: number; x0: number; y0: number; t0: number; dragging: boolean; holdSent: boolean } | null = null;
  private pinch: { a: number; b: number; d: number } | null = null;
  private braceDown = false;
  private edges = { usePressed: 0, useReleased: 0, interactPressed: 0, throwPressed: 0, throwReleased: 0, view: 0, pause: 0, ping: 0 };
  private useLevel = false;
  private interactLevel = false;
  zoomDelta = 0;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private actionBtn: HTMLDivElement;
  private actionIcon: HTMLSpanElement;
  private actionLabel: HTMLSpanElement;
  private braceBtn: HTMLDivElement;
  private slingLine: HTMLDivElement;
  info: ActionInfo = { icon: '✋', label: '', tapIsInteract: false, canThrow: false, holding: false };
  /** Set by the PlayerController while a tap carries something: the next tap lets go (or places it). */
  carry: { icon: string; label: string } | null = null;
  /** portrait tap → ping mode handled by HUD */
  onViewPressed: (() => void) | null = null;
  /** the game wants the controls on screen (a trip is under way); hidden behind the title and chart */
  private wanted = false;

  constructor(parent: HTMLElement) {
    this.active = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.className = 'touch-layer';
    root.innerHTML = `
      <div class="t-stick-base"><div class="t-stick-knob"></div></div>
      <div class="t-btn t-action interactive"><span class="t-icon">✋</span><span class="t-label"></span></div>
      <div class="t-btn t-brace interactive"><span class="t-icon">🤲</span><span class="t-label">BRACE</span></div>
      <div class="t-btn t-small t-view interactive">👁</div>
      <div class="t-btn t-small t-menu interactive">☰</div>
      <div class="t-sling"></div>`;
    parent.appendChild(root);
    this.stickBase = root.querySelector('.t-stick-base')!;
    this.stickKnob = root.querySelector('.t-stick-knob')!;
    this.actionBtn = root.querySelector('.t-action')!;
    this.actionIcon = this.actionBtn.querySelector('.t-icon')!;
    this.actionLabel = this.actionBtn.querySelector('.t-label')!;
    this.braceBtn = root.querySelector('.t-brace')!;
    this.slingLine = root.querySelector('.t-sling')!;
    this.parent = parent;
    root.style.display = 'none';

    const canvas = document.getElementById('game-canvas') ?? document.body;
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('touchstart', (e) => this.onCanvasStart(e as TouchEvent), opts);
    canvas.addEventListener('touchmove', (e) => this.onCanvasMove(e as TouchEvent), opts);
    canvas.addEventListener('touchend', (e) => this.onCanvasEnd(e as TouchEvent), opts);
    canvas.addEventListener('touchcancel', (e) => this.onCanvasEnd(e as TouchEvent), opts);

    this.actionBtn.addEventListener('touchstart', (e) => this.onActionStart(e), opts);
    this.actionBtn.addEventListener('touchmove', (e) => this.onActionMove(e), opts);
    this.actionBtn.addEventListener('touchend', (e) => this.onActionEnd(e), opts);
    this.actionBtn.addEventListener('touchcancel', (e) => this.onActionEnd(e), opts);
    this.braceBtn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        this.braceDown = true;
        this.braceBtn.classList.add('down');
        this.touched();
      },
      opts,
    );
    const braceUp = (e: Event) => {
      e.preventDefault();
      this.braceDown = false;
      this.braceBtn.classList.remove('down');
    };
    this.braceBtn.addEventListener('touchend', braceUp, opts);
    this.braceBtn.addEventListener('touchcancel', braceUp, opts);
    root.querySelector('.t-view')!.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        this.edges.view++;
        this.touched();
      },
      opts,
    );
    root.querySelector('.t-menu')!.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        this.edges.pause++;
      },
      opts,
    );
    window.addEventListener('touchstart', () => {
      if (!this.active) {
        this.active = true;
        this.applyVisible();
      }
    });
  }

  /** Is a finger on the Action button right now? */
  get actionDown(): boolean {
    return !!this.actionTouch;
  }

  private touched(): void {
    this.recentlyUsed = true;
  }

  private onCanvasStart(e: TouchEvent): void {
    e.preventDefault();
    this.touched();
    for (const t of Array.from(e.changedTouches)) {
      const leftHalf = t.clientX < window.innerWidth * 0.45;
      if (leftHalf && !this.stick) {
        this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        this.stickBase.style.display = 'block';
        this.stickBase.style.left = `${t.clientX}px`;
        this.stickBase.style.top = `${t.clientY}px`;
        this.stickKnob.style.transform = 'translate(-50%, -50%)';
      } else if (!leftHalf && !this.lookTouch) {
        this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
    if (e.touches.length === 2 && !this.stick) {
      const [a, b] = [e.touches[0], e.touches[1]];
      this.pinch = { a: a.identifier, b: b.identifier, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
      this.lookTouch = null;
    }
  }

  private onCanvasMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick.x = t.clientX;
        this.stick.y = t.clientY;
        const R = config.touch.joystickRadius;
        let dx = t.clientX - this.stick.ox;
        let dy = t.clientY - this.stick.oy;
        const len = Math.hypot(dx, dy);
        if (len > R) {
          // floating: drag the base along
          this.stick.ox += (dx / len) * (len - R);
          this.stick.oy += (dy / len) * (len - R);
          this.stickBase.style.left = `${this.stick.ox}px`;
          this.stickBase.style.top = `${this.stick.oy}px`;
          dx = (dx / len) * R;
          dy = (dy / len) * R;
        }
        this.moveX = dx / R;
        this.moveY = -dy / R;
        this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
        this.lookDX += t.clientX - this.lookTouch.x;
        this.lookDY += t.clientY - this.lookTouch.y;
        this.lookTouch.x = t.clientX;
        this.lookTouch.y = t.clientY;
      }
    }
    if (this.pinch && e.touches.length >= 2) {
      const a = Array.from(e.touches).find((t) => t.identifier === this.pinch!.a);
      const b = Array.from(e.touches).find((t) => t.identifier === this.pinch!.b);
      if (a && b) {
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        this.zoomDelta += (this.pinch.d - d) * 0.02;
        this.pinch.d = d;
      }
    }
  }

  private onCanvasEnd(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        this.moveX = this.moveY = 0;
        this.stickBase.style.display = 'none';
      }
      if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      if (this.pinch && (t.identifier === this.pinch.a || t.identifier === this.pinch.b)) this.pinch = null;
    }
  }

  private onActionStart(e: TouchEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.touched();
    const t = e.changedTouches[0];
    this.actionTouch = { id: t.identifier, x0: t.clientX, y0: t.clientY, t0: performance.now(), dragging: false, holdSent: false };
    this.actionBtn.classList.add('down');
    if (!this.info.tapIsInteract) {
      // immediate: grab / lever / use
      this.useLevel = true;
      this.edges.usePressed++;
      this.actionTouch.holdSent = true;
    }
  }

  private onActionMove(e: TouchEvent): void {
    e.preventDefault();
    const a = this.actionTouch;
    if (!a) return;
    const t = Array.from(e.changedTouches).find((x) => x.identifier === a.id);
    if (!t) return;
    const dx = t.clientX - a.x0,
      dy = t.clientY - a.y0;
    if (Math.hypot(dx, dy) > 22 && (this.info.canThrow || this.info.holding)) {
      a.dragging = true;
      this.throwVec = { x: dx, y: dy };
      this.slingLine.style.display = 'block';
      const len = Math.hypot(dx, dy);
      this.slingLine.style.left = `${a.x0}px`;
      this.slingLine.style.top = `${a.y0}px`;
      this.slingLine.style.width = `${len}px`;
      this.slingLine.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }

  private onActionEnd(e: TouchEvent): void {
    e.preventDefault();
    const a = this.actionTouch;
    this.actionBtn.classList.remove('down');
    if (!a) return;
    if (a.dragging) {
      this.edges.throwReleased++;
      this.slingLine.style.display = 'none';
      // keep throwVec for this frame so the aim is computed, cleared in endFrame
    } else if (!a.holdSent) {
      // quick tap on a pet-able / interact target
      this.edges.interactPressed++;
    }
    if (this.useLevel) {
      this.useLevel = false;
      this.edges.useReleased++;
    }
    this.actionTouch = null;
  }

  /** HUD tells us what the Action button will do. */
  setAction(info: ActionInfo): void {
    if (this.carry && info.holding) {
      // carrying on a tap: a tap lets go (placing it if that's what's under you), a drag throws
      info = { ...info, icon: this.carry.icon, label: this.carry.label + (info.canThrow ? ' · drag: throw' : ''), holdLabel: undefined, tapIsInteract: false };
    }
    this.info = info;
    if (this.actionIcon.textContent !== info.icon) this.actionIcon.textContent = info.icon;
    const lbl = info.holdLabel ? `${info.label} · hold: ${info.holdLabel}` : info.label;
    if (this.actionLabel.textContent !== lbl) this.actionLabel.textContent = lbl;
    this.actionBtn.classList.toggle('dim', !info.label);
  }

  /** Called every frame by the PlayerController. */
  writeInto(s: DeviceSnapshot, fp: boolean): void {
    const a = this.actionTouch;
    // tap-is-interact targets: holding becomes "use" (pick up) after holdSec
    if (a && !a.holdSent && !a.dragging && performance.now() - a.t0 > config.touch.holdSec * 1000) {
      a.holdSent = true;
      this.useLevel = true;
      this.edges.usePressed++;
    }
    if (this.useLevel) s.use = true;
    if (a && a.dragging) s.throwHeld = true;
    if (this.braceDown) s.brace = true;
    if (this.interactLevel) s.interact = true;
    s.usePressed += this.edges.usePressed;
    s.touchUsePressed += this.edges.usePressed;
    s.useReleased += this.edges.useReleased;
    s.interactPressed += this.edges.interactPressed;
    s.throwReleased += this.edges.throwReleased;
    s.viewPressed += this.edges.view;
    s.pausePressed += this.edges.pause;
    s.pingPressed += this.edges.ping;
    s.zoomDelta += this.zoomDelta;
    if (fp) {
      s.lookX += this.lookDX * config.camera.fp.touchLookSensitivity * 0.5;
      s.lookY += this.lookDY * config.camera.fp.touchLookSensitivity * 0.5;
    }
  }

  endFrame(): void {
    this.edges = { usePressed: 0, useReleased: 0, interactPressed: 0, throwPressed: 0, throwReleased: 0, view: 0, pause: 0, ping: 0 };
    this.lookDX = this.lookDY = 0;
    this.zoomDelta = 0;
    if (!this.actionTouch || !this.actionTouch.dragging) this.throwVec = null;
  }

  /** The BRACE button glows gold (a pulse; steady with reduce flashing) inside the PERFECT window. */
  setBraceGold(on: boolean): void {
    if (this.braceBtn.classList.contains('gold') !== on) this.braceBtn.classList.toggle('gold', on);
  }

  setVisible(v: boolean): void {
    this.wanted = v;
    this.applyVisible();
  }

  private applyVisible(): void {
    const on = this.wanted && this.active;
    this.root.style.display = on ? 'block' : 'none';
    // the HUD makes room for the buttons
    this.parent.classList.toggle('touch-ui', on);
  }
}
