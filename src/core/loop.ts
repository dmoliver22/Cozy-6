/** Fixed-step simulation loop with an accumulator and render interpolation. */
import { config } from '../config';

export interface LoopHooks {
  /** Called at a fixed rate (config.sim.hz). dt is the (possibly slow-mo scaled) step. */
  step(dt: number): void;
  /** Called once per animation frame. alpha ∈ [0,1) is the interpolation factor. */
  render(alpha: number, dtReal: number, dtSim: number): void;
}

export class FixedLoop {
  readonly dt = 1 / config.sim.hz;
  private acc = 0;
  private last = 0;
  private running = false;
  timeScale = 1;
  paused = false;
  simTime = 0;
  frame = 0;

  constructor(private hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      this.frameAt(now);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }

  frameAt(now: number): void {
    let dtReal = (now - this.last) / 1000;
    this.last = now;
    if (!(dtReal > 0)) dtReal = 0;
    if (dtReal > 0.25) dtReal = 0.25; // tab was hidden
    if (!this.paused) this.acc += dtReal * this.timeScale;
    let steps = 0;
    const max = config.sim.maxStepsPerFrame;
    try {
      while (this.acc >= this.dt && steps < max) {
        this.hooks.step(this.dt);
        this.simTime += this.dt;
        this.acc -= this.dt;
        steps++;
      }
    } catch (e) {
      this.acc = 0;
      this.reportOnce('step', e);
    }
    if (steps >= max) this.acc = Math.min(this.acc, this.dt); // avoid the spiral of death
    this.frame++;
    try {
      this.hooks.render(this.acc / this.dt, dtReal, dtReal * this.timeScale);
    } catch (e) {
      this.reportOnce('render', e);
    }
  }

  private reported = new Set<string>();
  /** Log each distinct error once instead of 60 times a second. */
  private reportOnce(where: string, e: unknown): void {
    const key = where + ':' + String(e);
    if (this.reported.has(key)) return;
    this.reported.add(key);
    console.error(`[loop ${where}]`, e);
  }

  /** Advance the simulation by n steps without rendering (tests / fast-forward). */
  fastForward(n: number): void {
    for (let i = 0; i < n; i++) {
      this.hooks.step(this.dt);
      this.simTime += this.dt;
    }
  }
}
