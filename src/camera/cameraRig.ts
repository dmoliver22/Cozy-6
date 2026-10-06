/**
 * Two views: the overhead "dollhouse" (default) and first person on deck.
 * Overhead stays level with the horizon (never rolls) so the deck visibly tilts under it.
 * First person rolls only `rollFactor` of the boat's roll for comfort.
 */
import * as THREE from 'three';
import { config, DEG } from '../config';
import { clamp, damp, dampAngle, easeInOut, lerp } from '../core/math';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();

export type ViewMode = 'overhead' | 'fp';

export interface CameraInputs {
  dt: number;
  boatPos: THREE.Vector3;
  boatQuat: THREE.Quaternion;
  boatYaw: number;
  boatPitch: number;
  boatRoll: number;
  /** World position of the focus deckhand (player). */
  focusWorld: THREE.Vector3;
  /** Player head in world space (first person). */
  headWorld: THREE.Vector3;
  portrait: boolean;
  rollFactor: number;
  headBob: boolean;
  walkPhase: number;
  walkAmount: number;
}

export class CameraRig {
  mode: ViewMode = 'overhead';
  /** 0 = overhead, 1 = first person (animated). */
  blend = 0;
  private blendFrom = 0;
  private blendT = 1;
  /** 0 = whole boat … 1 = close on my deckhand */
  zoom = 0.3;
  private target = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private pitchInit = false;
  private initialised = false;
  shake = 0;
  private shakeSeed = 0;
  /** first-person look angles relative to the boat (0 = bow, + = toward port / up) */
  fpYaw = 0;
  fpPitch = -0.12;
  pushIn = 0; // golden crab camera push (eased 0..1)
  private pushHold = 0;
  private readonly pushFocus = new THREE.Vector3();
  readonly ohPos = new THREE.Vector3();
  readonly ohQuat = new THREE.Quaternion();
  readonly fpPos = new THREE.Vector3();
  readonly fpQuat = new THREE.Quaternion();
  reduceFlashing = false;

  constructor(public camera: THREE.PerspectiveCamera) {}

  setMode(m: ViewMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.blendFrom = this.blend;
    this.blendT = 0;
  }
  toggle(): void {
    this.setMode(this.mode === 'overhead' ? 'fp' : 'overhead');
  }

  /** Ease the overhead camera in toward a world point for a moment (the golden crab). */
  pushTo(world: THREE.Vector3, seconds = 1.8): void {
    this.pushFocus.copy(world);
    this.pushHold = seconds;
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /** Look direction in boat-local space (first person). */
  fpLocalDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.fpPitch);
    return out.set(Math.sin(this.fpYaw) * cp, Math.sin(this.fpPitch), Math.cos(this.fpYaw) * cp);
  }

  /** Horizontal view yaw of the overhead camera in world terms (for camera-relative movement). */
  get overheadYaw(): number {
    return this.yaw;
  }

  update(i: CameraInputs): void {
    const oh = config.camera.overhead;
    const dt = i.dt;
    // --- overhead
    const offset = (i.portrait ? oh.portraitYawDeg : oh.landscapeYawDeg) * DEG;
    const wantYaw = i.boatYaw + offset;
    // focus: boat centre (a little aft, the working deck) blended toward the player as we zoom in
    _v.set(0, 0, -1.2).applyQuaternion(i.boatQuat).add(i.boatPos);
    _v.lerp(i.focusWorld, clamp(this.zoom * 1.1, 0, 1));
    _v.y = lerp(i.boatPos.y, _v.y, 0.5);
    if (this.pushIn > 0.001) _v.lerp(this.pushFocus, this.pushIn * 0.6);
    if (!this.initialised) {
      this.target.copy(_v);
      this.yaw = wantYaw;
      this.initialised = true;
    }
    this.target.x = damp(this.target.x, _v.x, oh.followLag, dt);
    this.target.z = damp(this.target.z, _v.z, oh.followLag, dt);
    this.target.y = damp(this.target.y, _v.y, oh.followLag * 0.6, dt);
    this.yaw = dampAngle(this.yaw, wantYaw, oh.yawLag, dt);
    let dist = lerp(oh.distanceFar, oh.distanceNear, this.zoom);
    if (i.portrait) dist *= 1.35;
    dist *= 1 - this.pushIn * 0.35;
    // a low three-quarter "diorama" angle zoomed out, steepening as you zoom in (and in portrait)
    // so the near bulwark never hides the working deck
    const farPitch = i.portrait ? oh.portraitPitchDeg : oh.pitchDeg;
    const pitchTarget = lerp(farPitch, Math.max(farPitch, oh.pitchNearDeg), easeInOut(clamp(this.zoom, 0, 1))) * DEG;
    if (!this.pitchInit) {
      this.pitch = pitchTarget;
      this.pitchInit = true;
    }
    this.pitch = damp(this.pitch, pitchTarget, 4, dt);
    const pitch = this.pitch;
    // view direction (horizontal) = (sin yaw, 0, cos yaw)
    const vx = Math.sin(this.yaw),
      vz = Math.cos(this.yaw);
    this.ohPos.set(this.target.x - vx * dist * Math.cos(pitch), this.target.y + dist * Math.sin(pitch), this.target.z - vz * dist * Math.cos(pitch));
    _m.lookAt(this.ohPos, this.target, THREE.Object3D.DEFAULT_UP);
    this.ohQuat.setFromRotationMatrix(_m);

    // --- first person
    this.fpPos.copy(i.headWorld);
    if (i.headBob && i.walkAmount > 0.05) {
      const b = config.camera.fp.headBob * i.walkAmount;
      _v2.set(Math.cos(i.walkPhase) * b * 0.5, Math.abs(Math.sin(i.walkPhase)) * b, 0).applyQuaternion(i.boatQuat);
      this.fpPos.add(_v2);
    }
    _e.set(i.boatPitch * config.camera.fp.pitchFactor, i.boatYaw, i.boatRoll * i.rollFactor, 'YXZ');
    _q.setFromEuler(_e);
    const dir = this.fpLocalDir(_v2).applyQuaternion(_q);
    const up = _v.set(0, 1, 0).applyQuaternion(_q);
    _m.lookAt(this.fpPos, this.fpPos.clone().add(dir), up);
    this.fpQuat.setFromRotationMatrix(_m);

    // --- blend between views (0.4 s dolly)
    if (this.blendT < 1) this.blendT = Math.min(1, this.blendT + dt / config.camera.switchSec);
    const goal = this.mode === 'fp' ? 1 : 0;
    this.blend = lerp(this.blendFrom, goal, easeInOut(this.blendT));
    const b = this.blend;
    this.camera.position.lerpVectors(this.ohPos, this.fpPos, b);
    this.camera.quaternion.slerpQuaternions(this.ohQuat, this.fpQuat, b);
    // first person in a tall, narrow view: widen the vertical FOV so the horizontal one stays
    // at least the configured FOV (capped, so it doesn't turn into a fisheye)
    let fpFov = config.camera.fp.fov;
    if (this.camera.aspect < 1) fpFov = Math.min(100, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(fpFov) / 2) / this.camera.aspect)));
    const fov = lerp(oh.fov, fpFov, b);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.near = lerp(1, 0.08, b);
    this.camera.updateProjectionMatrix();

    // --- shake (overhead: config amplitude; first person: scaled by comfort setting)
    if (this.shake > 0.001) {
      this.shakeSeed += dt * 60;
      const comfort = clamp(i.rollFactor / 0.3, 0, 1.5);
      // overhead: metres scaled to the camera distance; first person: small, scaled by comfort
      const amp = this.shake * lerp(dist * 0.09, 0.25 * comfort, b) * (this.reduceFlashing ? 0.4 : 1);
      const s = this.shakeSeed;
      _v.set(Math.sin(s * 1.7) * amp, Math.sin(s * 2.3 + 1) * amp, Math.sin(s * 1.3 + 2) * amp);
      this.camera.position.add(_v);
      this.shake = damp(this.shake, 0, 5, dt);
    }
    this.pushHold -= dt;
    this.pushIn = this.pushHold > 0 ? damp(this.pushIn, 1, 3.5, dt) : damp(this.pushIn, 0, 1.6, dt);
  }
}
