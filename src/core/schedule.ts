/**
 * Simulation-time scheduler. Never use setTimeout in the simulation: it ignores pause, slow-mo
 * and fast-forward. Game.step() advances this once per fixed step.
 */
interface Job {
  t: number;
  fn: () => void;
}

class Scheduler {
  time = 0;
  private jobs: Job[] = [];
  after(seconds: number, fn: () => void): void {
    this.jobs.push({ t: this.time + Math.max(0, seconds), fn });
  }
  step(dt: number): void {
    this.time += dt;
    if (!this.jobs.length) return;
    const due: Job[] = [];
    this.jobs = this.jobs.filter((j) => {
      if (j.t <= this.time) {
        due.push(j);
        return false;
      }
      return true;
    });
    due.sort((a, b) => a.t - b.t).forEach((j) => j.fn());
  }
  clear(): void {
    this.jobs = [];
  }
}

export const schedule = new Scheduler();
export const later = (seconds: number, fn: () => void) => schedule.after(seconds, fn);
