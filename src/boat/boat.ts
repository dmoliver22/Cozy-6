/**
 * The Puffin's motion. Not a free rigid body: each step we sample the sea at 6 hull points,
 * derive heave/pitch/roll targets, smooth them with critically damped springs, then add
 * steering yaw and forward speed. Linear and angular accelerations are exposed so the
 * deck-local physics can turn them into local gravity + fictitious forces.
 */
import * as THREE from 'three';
import { config, DEG } from '../config';
import { Spring1, clamp, wrapAngle } from '../core/math';
import type { Sea } from '../sea/waves';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Boat {
  /** World position of the local origin (deck centre). */
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly prevPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  /** Horizontal position of the waterline pivot. */
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  yawRate = 0;
  targetSpeed = 0;
  targetYawRate = 0;
  /** Extra visual/physical offsets */
  dip = new Spring1(9);
  readonly heave: Spring1;
  readonly pitch: Spring1;
  readonly roll: Spring1;
  /** When set, the boat follows a planned path exactly (captain's maneuvers). */
  pathPose: { x: number; z: number; yaw: number; speed: number } | null = null;
  /** Additional roll multiplier (ice → top-heavy). */
  rollScale = 1;

  /** World-space velocity and acceleration of the local origin. */
  readonly vel = new THREE.Vector3();
  readonly acc = new THREE.Vector3();
  /** Local-frame angular velocity / acceleration (x = pitch axis, y = yaw, z = roll). */
  readonly angVel = new THREE.Vector3();
  readonly angAcc = new THREE.Vector3();
  private lastVel = new THREE.Vector3();
  private lastAngVel = new THREE.Vector3();
  private first = true;

  /** Raw samples for the debug overlay. */
  readonly sampleHeights = new Float32Array(6);
  targetRoll = 0;
  targetPitch = 0;

  constructor() {
    const r = config.boat.responsiveness;
    this.heave = new Spring1(r.heave);
    this.pitch = new Spring1(r.pitch);
    this.roll = new Spring1(r.roll);
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Kick the roll spring (rogue impact), spread over ~0.15 s so it reads as a shove, not a glitch. + = port up. */
  private rollKick = 0;
  private pitchKick = 0;
  kickRoll(rad: number): void {
    this.rollKick += rad;
  }
  kickPitch(rad: number): void {
    this.pitchKick += rad;
  }
  landingDip(m: number): void {
    this.dip.v -= m * this.dip.omega * 2.2;
  }

  step(dt: number, sea: Sea): void {
    const cb = config.boat;
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);

    // --- steering: speed & yaw rate approach targets with limited acceleration
    const ts = clamp(this.targetSpeed, cb.speed.reverse, cb.speed.max);
    const ds = ts - this.speed;
    this.speed += clamp(ds, -cb.speed.accel * dt * 1.6, cb.speed.accel * dt);
    // Yaw authority: rudder needs a little way on, plus a weak bow thruster at rest.
    const authority = clamp(0.35 + Math.abs(this.speed) / 2.5, 0, 1);
    const tr = clamp(this.targetYawRate, -cb.yawRateMax, cb.yawRateMax) * authority;
    this.yawRate += clamp(tr - this.yawRate, -cb.yawAccel * dt, cb.yawAccel * dt);
    if (this.pathPose) {
      const pp = this.pathPose;
      // heading follows the path, rate-limited so the deck never feels a yaw snap
      const dy = clamp(wrapAngle(pp.yaw - this.yaw), -0.55 * dt, 0.55 * dt);
      this.yawRate += clamp(dy / dt - this.yawRate, -cb.yawAccel * 2 * dt, cb.yawAccel * 2 * dt);
      this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
      this.speed = pp.speed;
      this.x = pp.x;
      this.z = pp.z;
    } else {
      this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
      const fx = Math.sin(this.yaw),
        fz = Math.cos(this.yaw);
      this.x += fx * this.speed * dt;
      this.z += fz * this.speed * dt;
    }

    // --- sample the sea at 6 hull points (rotated by yaw only)
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw);
    const t = sea.time;
    const smp = cb.samples;
    for (let i = 0; i < smp.length; i++) {
      const [lx, lz] = smp[i];
      // local +X = port. Yaw rotates about +Y: world = Ry(yaw) * local
      const wx = this.x + lx * cy + lz * sy;
      const wz = this.z - lx * sy + lz * cy;
      this.sampleHeights[i] = sea.height(wx, wz, t);
    }
    const h = this.sampleHeights;
    const bow = h[0],
      stern = h[1];
    const port = (h[2] + h[3]) * 0.5,
      stbd = (h[4] + h[5]) * 0.5;
    const mean = (bow + stern + h[2] + h[3] + h[4] + h[5]) / 6;
    const L = smp[0][1] - smp[1][1];
    const B = smp[2][0] - smp[4][0];
    this.targetPitch = clamp(-Math.atan2(bow - stern, L) * cb.pitchGain, -cb.maxPitchDeg * DEG, cb.maxPitchDeg * DEG);
    this.targetRoll = clamp(Math.atan2(port - stbd, B) * cb.rollGain * this.rollScale, -cb.maxRollDeg * DEG, cb.maxRollDeg * DEG);

    // ride up a rogue face instead of being swamped by it
    const r = sea.rogue;
    const rk = r.active ? Math.min(1, r.amp / 2.4) : 0;
    const rr = cb.responsiveness,
      ex = cb.rogueResponsiveness;
    this.heave.omega = rr.heave + ex.heave * rk;
    this.pitch.omega = rr.pitch + ex.pitch * rk;
    this.roll.omega = rr.roll + ex.roll * rk;
    const kk = Math.min(1, dt / 0.15);
    const rk2 = this.rollKick * kk,
      pk2 = this.pitchKick * kk;
    this.roll.v += rk2 * this.roll.omega;
    this.pitch.v += pk2 * this.pitch.omega;
    this.rollKick -= rk2;
    this.pitchKick -= pk2;
    this.heave.step(mean, dt);
    this.pitch.step(this.targetPitch, dt);
    this.roll.step(this.targetRoll, dt);
    this.dip.step(0, dt);
    // keep roll/pitch inside sane bounds even after kicks
    this.roll.x = clamp(this.roll.x, -cb.maxRollDeg * 1.3 * DEG, cb.maxRollDeg * 1.3 * DEG);
    this.pitch.x = clamp(this.pitch.x, -cb.maxPitchDeg * 1.3 * DEG, cb.maxPitchDeg * 1.3 * DEG);

    // --- compose transform. Rotation pivots about the waterline under the deck centre.
    _e.set(this.pitch.x, this.yaw, this.roll.x, 'YXZ');
    this.quat.setFromEuler(_e);
    _v.set(0, cb.freeboard, 0).applyQuaternion(this.quat);
    this.pos.set(this.x, this.heave.x + this.dip.x, this.z).add(_v);

    // --- kinematics for the deck physics
    if (this.first) {
      this.prevPos.copy(this.pos);
      this.prevQuat.copy(this.quat);
      this.first = false;
    }
    this.vel.subVectors(this.pos, this.prevPos).divideScalar(dt);
    const rawAcc = _v.subVectors(this.vel, this.lastVel).divideScalar(dt);
    // light smoothing keeps finite-difference spikes out of local gravity
    this.acc.lerp(rawAcc, 0.5);
    const amax = 14;
    if (this.acc.lengthSq() > amax * amax) this.acc.setLength(amax);
    this.lastVel.copy(this.vel);

    this.angVel.set(this.pitch.v, this.yawRate, this.roll.v);
    this.angAcc.subVectors(this.angVel, this.lastAngVel).divideScalar(dt);
    this.angAcc.clampLength(0, 6);
    this.lastAngVel.copy(this.angVel);
  }

  /** Interpolated render transform. */
  renderTransform(alpha: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    outPos.lerpVectors(this.prevPos, this.pos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.quat, alpha);
  }

  localToWorld(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p).applyQuaternion(this.quat).add(this.pos);
  }
  worldToLocal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _q.copy(this.quat).invert();
    return out.copy(p).sub(this.pos).applyQuaternion(_q);
  }
  dirLocalToWorld(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(d).applyQuaternion(this.quat);
  }
  dirWorldToLocal(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _q.copy(this.quat).invert();
    return out.copy(d).applyQuaternion(_q);
  }
  /** World velocity of a point fixed to the boat at local position p. */
  pointVelocity(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    // ω (world) × r (world) + v_origin
    const wWorld = _v.copy(this.angVel).applyQuaternion(this.quat);
    const r = out.copy(p).applyQuaternion(this.quat);
    return out.crossVectors(wWorld, r).add(this.vel);
  }

  /** Signed roll (deg, + = port up) and pitch (deg, + = bow up) for HUD/debug. */
  get rollDeg(): number {
    return this.roll.x / DEG;
  }
  get pitchDeg(): number {
    return -this.pitch.x / DEG;
  }
}
