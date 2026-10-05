/**
 * One shared wave function for the CPU (boat, floating things) and the GPU (rendered sea).
 * The GLSL in seaMesh.ts mirrors `displace()` term for term — keep them in sync.
 *
 * Model: 4 Gerstner waves scaled by `swell`, plus one travelling rogue wave group
 * (gaussian envelope × cosine carrier, with Gerstner-style horizontal pinch).
 */
import * as THREE from 'three';
import { config } from '../config';

export interface WaveParam {
  dirX: number;
  dirZ: number;
  k: number;
  omega: number;
  amp: number; // base amplitude (before swell)
  steep: number; // horizontal amplitude / vertical amplitude
  phase: number;
}

export interface RogueParam {
  active: boolean;
  dirX: number;
  dirZ: number;
  k: number;
  /** Position of the group centre along the travel direction (metres, world dot dir). */
  s0: number;
  amp: number; // current amplitude (already faded)
  steep: number;
  width: number;
}

const G = 9.81;

export class Sea {
  time = 0;
  swell = 0.32;
  /** Distance-based fade of the shortest wave in the shader only (CPU is always near the boat). */
  readonly waves: WaveParam[];
  readonly rogue: RogueParam;

  constructor() {
    this.waves = config.sea.waves.map((w) => {
      const k = (2 * Math.PI) / w.length;
      const a = (w.dirDeg * Math.PI) / 180;
      return { dirX: Math.cos(a), dirZ: Math.sin(a), k, omega: Math.sqrt(G * k), amp: w.amp, steep: w.steep, phase: w.phase };
    });
    const r = config.sea.rogue;
    this.rogue = { active: false, dirX: 1, dirZ: 0, k: (2 * Math.PI) / r.length, s0: -1e4, amp: 0, steep: r.steep, width: r.groupWidth };
  }

  /** Gerstner displacement of the undisplaced surface point (x, z) at time t. */
  displace(x: number, z: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    let dx = 0,
      dy = 0,
      dz = 0;
    const s = this.swell;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const th = w.k * (w.dirX * x + w.dirZ * z) - w.omega * t + w.phase;
      const A = w.amp * s;
      const QA = A * w.steep;
      const c = Math.cos(th);
      dx += QA * w.dirX * c;
      dz += QA * w.dirZ * c;
      dy += A * Math.sin(th);
    }
    const r = this.rogue;
    if (r.active && r.amp > 0.001) {
      const ds = r.dirX * x + r.dirZ * z - r.s0;
      const e = Math.exp(-(ds * ds) / (r.width * r.width));
      if (e > 1e-4) {
        const u = r.k * ds;
        const A = r.amp * e;
        dy += A * Math.cos(u);
        const h = -A * r.steep * Math.sin(u);
        dx += h * r.dirX;
        dz += h * r.dirZ;
      }
    }
    return out.set(dx, dy, dz);
  }

  private _d = new THREE.Vector3();

  /** Height of the rendered surface directly above world (x, z). Inverts the horizontal pinch by fixed-point iteration. */
  height(x: number, z: number, t = this.time): number {
    let px = x,
      pz = z;
    const d = this._d;
    for (let i = 0; i < 4; i++) {
      this.displace(px, pz, t, d);
      px = x - d.x;
      pz = z - d.z;
    }
    this.displace(px, pz, t, d);
    return d.y;
  }

  /** Surface normal above world (x, z) (finite differences of `height`, robust incl. rogue envelope). */
  normal(x: number, z: number, out: THREE.Vector3, t = this.time): THREE.Vector3 {
    const e = 0.35;
    const hL = this.height(x - e, z, t);
    const hR = this.height(x + e, z, t);
    const hD = this.height(x, z - e, t);
    const hU = this.height(x, z + e, t);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** Vertical velocity of the surface at (x, z) — used for splashes / bobbing. */
  heightRate(x: number, z: number, t = this.time): number {
    const dt = 1 / 30;
    return (this.height(x, z, t + dt) - this.height(x, z, t - dt)) / (2 * dt);
  }

  /** Pack uniforms for the sea shader. */
  writeUniforms(u: SeaUniforms, renderTime: number): void {
    u.uTime.value = renderTime;
    for (let i = 0; i < 4; i++) {
      const w = this.waves[i];
      u.uWaveA.value[i].set(w.dirX, w.dirZ, w.k, w.omega);
      u.uWaveB.value[i].set(w.amp * this.swell, w.amp * this.swell * w.steep, w.phase, 0);
    }
    const r = this.rogue;
    u.uRogueA.value.set(r.dirX, r.dirZ, r.k, r.s0);
    u.uRogueB.value.set(r.active ? r.amp : 0, r.steep, r.width, 0);
  }
}

export interface SeaUniforms {
  uTime: { value: number };
  uWaveA: { value: THREE.Vector4[] };
  uWaveB: { value: THREE.Vector4[] };
  uRogueA: { value: THREE.Vector4 };
  uRogueB: { value: THREE.Vector4 };
  [k: string]: { value: unknown };
}

/** GLSL twin of Sea.displace(). Also returns the horizontal "pinch" (Jacobian-ish) for foam, and the analytic normal. */
export const SEA_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uWaveA[4]; // dirX, dirZ, k, omega
uniform vec4 uWaveB[4]; // amp, qa, phase, -
uniform vec4 uRogueA;   // dirX, dirZ, k, s0
uniform vec4 uRogueB;   // amp, steep, width, -
uniform float uFarFade;

vec3 seaDisplace(vec2 p, float distFade, out vec3 nrm, out float pinch, out float rogueCrest) {
  vec3 d = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  pinch = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float fade = (i == 3) ? distFade : 1.0;
    float th = a.z * (a.x * p.x + a.y * p.y) - a.w * uTime + b.z;
    float s = sin(th);
    float c = cos(th);
    float A = b.x * fade;
    float QA = b.y * fade;
    d.x += QA * a.x * c;
    d.z += QA * a.y * c;
    d.y += A * s;
    float WA = a.z * A;
    n.x -= a.x * WA * c;
    n.z -= a.y * WA * c;
    float kq = a.z * QA * s;
    n.y -= kq;
    pinch += kq;
  }
  rogueCrest = 0.0;
  if (uRogueB.x > 0.001) {
    float ds = uRogueA.x * p.x + uRogueA.y * p.y - uRogueA.w;
    float w = uRogueB.z;
    float e = exp(-(ds * ds) / (w * w));
    float u = uRogueA.z * ds;
    float A = uRogueB.x * e;
    float cu = cos(u);
    float su = sin(u);
    d.y += A * cu;
    float h = -A * uRogueB.y * su;
    d.x += h * uRogueA.x;
    d.z += h * uRogueA.y;
    float dyds = -A * uRogueA.z * su;
    n.x -= uRogueA.x * dyds;
    n.z -= uRogueA.y * dyds;
    float kq = A * uRogueB.y * uRogueA.z * cu;
    n.y -= kq;
    pinch += kq;
    // a thin white line along the top of the crest (front face), not the whole hill
    rogueCrest = smoothstep(0.8, 0.97, cu) * smoothstep(0.0, 0.25, -su) * smoothstep(0.9, 2.4, A);
  }
  nrm = normalize(n);
  return d;
}
`;
