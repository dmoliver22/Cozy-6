/**
 * Autopilot used by Captain Mo (and the trip script): cruise on a heading, go to a point,
 * or come alongside a buoy so it sits off the starboard side by the block.
 * When the player takes the wheel, mode = 'manual' and the helm input drives the boat.
 */
import * as THREE from 'three';
import { config } from '../config';
import { clamp, wrapAngle } from '../core/math';
import type { Boat } from './boat';
import { L } from './layout';

export type NavMode = 'idle' | 'manual' | 'cruise' | 'goto' | 'alongside';

const ALONGSIDE_LOCAL = new THREE.Vector3(-7.0, 0, L.block.z); // buoy position we want, boat-local

export class Navigator {
  mode: NavMode = 'idle';
  heading = 0;
  speed = 0;
  readonly target = new THREE.Vector3();
  targetHeading = 0;
  arriveRadius = 2.5;
  arrived = false;
  /** manual helm input (-1..1) */
  throttle = 0;
  rudder = 0;
  /** buoy we're coming alongside (world position getter) */
  buoy: (() => THREE.Vector3 | null) | null = null;

  constructor(private boat: Boat) {}

  cruise(heading: number, speed: number): void {
    this.mode = 'cruise';
    this.heading = heading;
    this.speed = speed;
    this.arrived = false;
  }
  goto(p: THREE.Vector3, speed = config.boat.speed.cruise, finalHeading?: number): void {
    this.mode = 'goto';
    this.target.copy(p);
    this.speed = speed;
    this.targetHeading = finalHeading ?? NaN;
    this.arrived = false;
  }
  alongside(buoy: () => THREE.Vector3 | null, heading: number): void {
    this.mode = 'alongside';
    this.path = null;
    this.buoy = buoy;
    this.targetHeading = heading;
    this.arrived = false;
  }
  hold(): void {
    this.mode = 'idle';
  }

  path: { p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; p3: THREE.Vector3; h0: number; h3: number; length: number; s: number; v: number; table: number[] } | null = null;

  /** Plan a smooth cubic Bézier from the current pose to the alongside pose. */
  private planPath(bw: THREE.Vector3): void {
    const b = this.boat;
    const h = this.targetHeading;
    const c = Math.cos(h),
      s = Math.sin(h);
    const lx = ALONGSIDE_LOCAL.x,
      lz = ALONGSIDE_LOCAL.z;
    const p3 = new THREE.Vector3(bw.x - (lx * c + lz * s), 0, bw.z - (-lx * s + lz * c));
    const p0 = new THREE.Vector3(b.x, 0, b.z);
    const d = p0.distanceTo(p3);
    const turn = Math.abs(wrapAngle(h - b.yaw));
    const k = Math.max(6, d * 0.45, turn * 7);
    const p1 = p0.clone().add(new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw)).multiplyScalar(k));
    const p2 = p3.clone().sub(new THREE.Vector3(s, 0, c).multiplyScalar(k));
    const path = { p0, p1, p2, p3, h0: b.yaw, h3: h, length: 0, s: 0, v: Math.max(0, b.speed), table: [0] as number[] };
    // arc-length table
    let prev = p0.clone();
    let L = 0;
    for (let i = 1; i <= 64; i++) {
      const q = this.bez(path, i / 64, new THREE.Vector3());
      L += q.distanceTo(prev);
      path.table.push(L);
      prev = q;
    }
    path.length = L;
    this.path = path;
  }

  private bez(p: { p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; p3: THREE.Vector3 }, t: number, out: THREE.Vector3): THREE.Vector3 {
    const u = 1 - t;
    return out
      .copy(p.p0)
      .multiplyScalar(u * u * u)
      .addScaledVector(p.p1, 3 * u * u * t)
      .addScaledVector(p.p2, 3 * u * t * t)
      .addScaledVector(p.p3, t * t * t);
  }

  private sample(p: NonNullable<Navigator['path']>, s: number): { x: number; z: number; yaw: number } {
    const tb = p.table;
    let i = 1;
    while (i < tb.length - 1 && tb[i] < s) i++;
    const t0 = (i - 1) / 64,
      t1 = i / 64;
    const f = tb[i] > tb[i - 1] ? (s - tb[i - 1]) / (tb[i] - tb[i - 1]) : 0;
    const t = Math.min(1, t0 + (t1 - t0) * f);
    const a = this.bez(p, t, new THREE.Vector3());
    const bb = this.bez(p, Math.min(1, t + 0.01), new THREE.Vector3());
    let yaw = bb.distanceTo(a) > 1e-4 ? Math.atan2(bb.x - a.x, bb.z - a.z) : p.h3;
    if (t > 0.995) yaw = p.h3;
    return { x: a.x, z: a.z, yaw };
  }

  /** Is the buoy close enough to the starboard side for the grapple? */
  buoyInReach(buoyWorld: THREE.Vector3): boolean {
    const lp = this.boat.worldToLocal(buoyWorld, new THREE.Vector3());
    return lp.x < -3.5 && lp.x > -config.fishing.grappleRange && Math.abs(lp.z - L.block.z) < 6;
  }

  step(dt: number): void {
    const b = this.boat;
    if (this.mode !== 'alongside') b.pathPose = null;
    const yawRateFor = (want: number) => clamp(wrapAngle(want - b.yaw) * 0.8, -config.boat.yawRateMax, config.boat.yawRateMax);
    switch (this.mode) {
      case 'idle':
        b.targetSpeed = 0;
        b.targetYawRate = 0;
        break;
      case 'manual':
        b.targetSpeed = this.throttle >= 0 ? this.throttle * config.boat.speed.max : this.throttle * -config.boat.speed.reverse;
        b.targetYawRate = this.rudder * config.boat.yawRateMax;
        break;
      case 'cruise':
        b.targetSpeed = this.speed;
        b.targetYawRate = yawRateFor(this.heading);
        break;
      case 'goto': {
        const dx = this.target.x - b.x,
          dz = this.target.z - b.z;
        const d = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        const err = Math.abs(wrapAngle(want - b.yaw));
        b.targetYawRate = yawRateFor(d < 4 && !isNaN(this.targetHeading) ? this.targetHeading : want);
        b.targetSpeed = d < this.arriveRadius ? 0 : clamp(d * 0.25, 0.6, this.speed) * (err > 1.2 ? 0.35 : 1);
        if (d < this.arriveRadius) this.arrived = true;
        break;
      }
      case 'alongside': {
        const bw = this.buoy?.();
        if (!bw) {
          b.targetSpeed = 0;
          b.targetYawRate = 0;
          b.pathPose = null;
          break;
        }
        if (!this.path) this.planPath(bw);
        const pth = this.path!;
        // speed profile: ease up to cruise, ease down into the pose
        const remain = pth.length - pth.s;
        const vmax = Math.min(config.boat.speed.cruise * 0.8, 0.6 + pth.length * 0.08);
        pth.v = Math.min(vmax, pth.v + 0.5 * dt, Math.sqrt(Math.max(0, 2 * 0.35 * remain)) + 0.03);
        // slow down through tight curls of the path
        const ahead = this.sample(pth, Math.min(pth.length, pth.s + 1.5));
        const here = this.sample(pth, pth.s);
        const turnRate = Math.abs(wrapAngle(ahead.yaw - here.yaw)) / 1.5; // rad per metre
        if (turnRate > 0.05) pth.v = Math.min(pth.v, Math.max(0.35, Math.sqrt(1.2 / turnRate) * 0.5));
        pth.s = Math.min(pth.length, pth.s + pth.v * dt);
        const pose = this.sample(pth, pth.s);
        b.pathPose = { x: pose.x, z: pose.z, yaw: pose.yaw, speed: remain > 0.05 ? pth.v : 0 };
        if (remain <= 0.004) {
          // hold station at the pose; finish swinging the bow round with the thruster
          b.pathPose = { x: pth.p3.x, z: pth.p3.z, yaw: pth.h3, speed: 0 };
          const done = Math.abs(wrapAngle(pth.h3 - b.yaw)) < 0.06;
          this.arrived = done && this.buoyInReach(bw);
          // if the buoy has drifted badly, re-plan
          if (done && !this.buoyInReach(bw)) this.path = null;
        }
        break;
      }
    }
  }
}
