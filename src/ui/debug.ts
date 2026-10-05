/** F3 / three-finger-tap debug overlay: FPS, bodies, wave state, deck gravity, roll & pitch. */
export interface DebugInfo {
  fps: number;
  frameMs: number;
  bodies: number;
  awake: number;
  wave: string;
  gLocal: { x: number; y: number; z: number };
  roll: number;
  pitch: number;
  quality: string;
  extra?: string;
}

export class DebugOverlay {
  readonly el: HTMLDivElement;
  visible = false;
  private frames = 0;
  private acc = 0;
  fps = 60;
  frameMs = 16.7;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'debug';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
    window.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 3) this.toggle();
      },
      { passive: true },
    );
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  tick(dtReal: number): void {
    this.frames++;
    this.acc += dtReal;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frameMs = (this.acc / this.frames) * 1000;
      this.frames = 0;
      this.acc = 0;
    }
  }

  update(info: DebugInfo): void {
    if (!this.visible) return;
    const g = info.gLocal;
    this.el.textContent =
      `FPS ${info.fps.toFixed(0)} (${info.frameMs.toFixed(1)} ms) · ${info.quality}\n` +
      `bodies ${info.bodies} (awake ${info.awake})\n` +
      `wave ${info.wave}\n` +
      `g_local ${g.x.toFixed(2)}, ${g.y.toFixed(2)}, ${g.z.toFixed(2)}\n` +
      `roll ${info.roll.toFixed(1)}°  pitch ${info.pitch.toFixed(1)}°` +
      (info.extra ? `\n${info.extra}` : '');
  }
}
