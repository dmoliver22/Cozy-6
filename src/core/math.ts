import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. rate in 1/s. */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dampAngle = (a: number, b: number, rate: number, dt: number) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));

/** Critically damped spring (semi-implicit). Exposes acceleration for fictitious forces. */
export class Spring1 {
  x = 0;
  v = 0;
  a = 0;
  constructor(public omega: number, x0 = 0) {
    this.x = x0;
  }
  step(target: number, dt: number): number {
    const w = this.omega;
    this.a = w * w * (target - this.x) - 2 * w * this.v;
    this.v += this.a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export const V3 = THREE.Vector3;
export const tmpV = Array.from({ length: 16 }, () => new THREE.Vector3());
export const tmpQ = Array.from({ length: 6 }, () => new THREE.Quaternion());

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ballistic launch velocity to hit `to` from `from` in time T under gravity g (vector). */
export function solveBallistic(from: THREE.Vector3, to: THREE.Vector3, T: number, g: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  // to = from + v T + 0.5 g T²  →  v = (to − from − 0.5 g T²) / T
  out.copy(to).sub(from).addScaledVector(g, -0.5 * T * T).divideScalar(T);
  return out;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Flight time for a crew throw: quick and flat on deck, lofted when it has to clear the rail. */
export function throwFlightTime(from: THREE.Vector3, to: THREE.Vector3, overRail: boolean): number {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const T = clamp(0.38 + d * 0.06, 0.42, 1.35);
  return overRail ? Math.max(T, clamp(0.72 + d * 0.035, 0.75, 1.5)) : T;
}
