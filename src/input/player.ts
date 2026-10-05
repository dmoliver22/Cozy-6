/**
 * Maps devices (keyboard/mouse, gamepad, touch) onto the player's CrewInput.
 * Converts camera-relative intent into boat-local vectors; raycasts the aim point.
 */
import * as THREE from 'three';
import { config } from '../config';
import { clamp } from '../core/math';
import { Keyboard, Mouse, Gamepads, makeSnapshot, type DeviceSnapshot } from './devices';
import type { CameraRig } from '../camera/cameraRig';
import type { Crew } from '../crew/crew';
import type { Ctx } from '../game/ctx';
import { ItemManager } from '../deck/items';
import { CG } from '../deck/groups';
import type { TouchControls } from '../ui/touch';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export interface PlayerHooks {
  toggleView(): void;
  ping(localPoint: THREE.Vector3 | null): void;
  pause(): void;
  zoom(delta: number): void;
}

export class PlayerController {
  readonly kb = new Keyboard();
  readonly mouse: Mouse;
  readonly pads = new Gamepads();
  touch: TouchControls | null = null;
  readonly snap: DeviceSnapshot = makeSnapshot();
  invertLook = false;
  enabled = true;
  private aimVec = new THREE.Vector3();
  private hasAim = false;
  lastDevice: 'mouse' | 'pad' | 'touch' = 'mouse';
  readonly aimLocal = new THREE.Vector3();
  aimValid = false;

  constructor(
    canvas: HTMLElement,
    private ctx: Ctx,
    private rig: CameraRig,
    private camera: THREE.PerspectiveCamera,
    private hooks: PlayerHooks,
  ) {
    this.mouse = new Mouse(canvas);
    canvas.addEventListener('mousedown', () => {
      this.lastDevice = 'mouse';
      if (this.rig.mode === 'fp') this.mouse.requestLock();
    });
  }

  private gather(): DeviceSnapshot {
    const s = this.snap;
    const kb = this.kb;
    const ms = this.mouse;
    const gp = this.pads;
    gp.poll();
    const fp = this.rig.mode === 'fp';
    // keyboard
    let mx = (kb.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (kb.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    let my = (kb.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (kb.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    s.use = ms.isDown(0);
    s.throwHeld = ms.isDown(2);
    s.brace = kb.isDown('ShiftLeft', 'ShiftRight') || (!fp && kb.isDown('Space')) || (fp && kb.isDown('Space'));
    s.interact = kb.isDown('KeyE');
    s.usePressed = ms.pressed[0];
    s.useReleased = ms.released[0];
    s.throwPressed = ms.pressed[2];
    s.throwReleased = ms.released[2];
    s.interactPressed = kb.wasPressed('KeyE') ? 1 : 0;
    s.pingPressed = kb.wasPressed('KeyQ', 'Tab') ? 1 : 0;
    s.viewPressed = kb.wasPressed('KeyV') ? 1 : 0;
    s.pausePressed = kb.wasPressed('Escape', 'KeyP') ? 1 : 0;
    s.zoomDelta = ms.wheel;
    s.lookX = fp && ms.locked ? ms.dx * config.camera.fp.lookSensitivity : 0;
    s.lookY = fp && ms.locked ? ms.dy * config.camera.fp.lookSensitivity : 0;
    s.pointerX = ms.x;
    s.pointerY = ms.y;
    s.pointerActive = ms.active && !fp;
    s.usingPad = false;
    // gamepad
    if (gp.connected) {
      const ax = gp.axes;
      if (Math.abs(ax[0]) + Math.abs(ax[1]) > 0) {
        mx = ax[0];
        my = -ax[1];
      }
      if (gp.down(0)) s.use = true;
      if (gp.pressed(0)) s.usePressed++;
      if (gp.released(0)) s.useReleased++;
      if (gp.rt > 0.4) s.throwHeld = true;
      if (gp.pressed(7)) s.throwPressed++;
      if (gp.released(7)) s.throwReleased++;
      if (gp.down(4)) s.brace = true;
      if (gp.down(2)) s.interact = true;
      if (gp.pressed(2)) s.interactPressed++;
      if (gp.pressed(5)) s.pingPressed++;
      if (gp.pressed(3)) s.viewPressed++;
      if (gp.pressed(9)) s.pausePressed++;
      if (gp.down(12)) s.zoomDelta -= 0.15;
      if (gp.down(13)) s.zoomDelta += 0.15;
      if (fp) {
        s.lookX += ax[2] * config.camera.fp.padLookSpeed / 60;
        s.lookY += ax[3] * config.camera.fp.padLookSpeed / 60;
      }
      if (performance.now() - gp.lastActive < 1500) {
        s.usingPad = true;
        this.lastDevice = 'pad';
      }
    }
    // touch overlay
    const t = this.touch;
    if (t && t.active) {
      t.writeInto(s, fp);
      if (t.recentlyUsed) this.lastDevice = 'touch';
    }
    s.moveX = clamp(mx + (t && t.active ? t.moveX : 0), -1, 1);
    s.moveY = clamp(my + (t && t.active ? t.moveY : 0), -1, 1);
    return s;
  }

  update(dt: number, player: Crew): void {
    const s = this.gather();
    const inp = player.input;
    const fp = this.rig.mode === 'fp';
    const boat = this.ctx.boat;
    if (!this.enabled) {
      inp.move.set(0, 0);
      inp.use = inp.interact = inp.brace = inp.throwAim = false;
      this.endFrame();
      return;
    }

    // --- view / camera
    if (s.viewPressed) this.hooks.toggleView();
    if (s.pausePressed) this.hooks.pause();
    if (s.zoomDelta) this.hooks.zoom(s.zoomDelta);
    if (fp) {
      this.rig.fpYaw -= s.lookX;
      this.rig.fpPitch = clamp(this.rig.fpPitch - s.lookY * (this.invertLook ? -1 : 1), -1.2, 1.1);
    }

    // --- movement in boat-local space
    const mx = s.moveX,
      my = s.moveY;
    if (fp) {
      // forward f = (sin ψ, cos ψ), right = f × up = (−cos ψ, sin ψ)
      const yaw = this.rig.fpYaw;
      const fx = Math.sin(yaw),
        fz = Math.cos(yaw);
      inp.move.set(-fz * mx + fx * my, fx * mx + fz * my);
    } else {
      // camera-relative: screen-up = camera view direction on the horizontal plane
      this.camera.getWorldDirection(_d);
      _d.y = 0;
      _d.normalize();
      const right = _o.crossVectors(_d, UP).normalize();
      const wx = right.x * mx + _d.x * my;
      const wz = right.z * mx + _d.z * my;
      // world → boat-local (yaw only): local = Ry(−yaw) · world
      const cy = Math.cos(boat.yaw),
        sy = Math.sin(boat.yaw);
      inp.move.set(wx * cy - wz * sy, wx * sy + wz * cy);
    }
    if (inp.move.lengthSq() > 1) inp.move.normalize();
    inp.steer.set(mx, my);

    // --- aim
    this.aimValid = false;
    inp.lookDir = null;
    if (fp) {
      this.rig.fpLocalDir(_d);
      inp.lookDir = (inp.lookDir ?? new THREE.Vector3()).copy(_d);
      const head = player.head(_o);
      const hit = this.ctx.dw.raycast(head, _d, 9, CG.queryAll, player.body);
      if (hit && hit.toi > 0.2) {
        this.aimLocal.copy(head).addScaledVector(_d, hit.toi);
        this.aimValid = true;
      } else if (this.seaPoint(this.camera.position, this.camera.getWorldDirection(_p), this.aimLocal)) {
        this.aimValid = true;
      } else {
        this.aimLocal.copy(head).addScaledVector(_d, 8);
        this.aimValid = true;
      }
    } else if (this.lastDevice === 'mouse' && s.pointerActive) {
      _ndc.set((s.pointerX / window.innerWidth) * 2 - 1, -(s.pointerY / window.innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, this.camera);
      if (this.pointerToLocal(_ray.ray, this.aimLocal)) this.aimValid = true;
    } else if (this.lastDevice === 'touch' && this.touch?.throwVec) {
      // slingshot: pull back from the Action button to throw forward
      const tv = this.touch.throwVec;
      this.camera.getWorldDirection(_d);
      _d.y = 0;
      _d.normalize();
      const right = _o.crossVectors(_d, UP).normalize();
      const k = 0.06;
      const wx = -(right.x * tv.x * k - _d.x * tv.y * k);
      const wz = -(right.z * tv.x * k - _d.z * tv.y * k);
      const cy = Math.cos(boat.yaw),
        sy = Math.sin(boat.yaw);
      player.pos(this.aimLocal);
      this.aimLocal.x += wx * cy - wz * sy;
      this.aimLocal.z += wx * sy + wz * cy;
      this.aimLocal.y = 0.2;
      this.aimValid = true;
    } else if (this.lastDevice === 'pad' && this.pads.connected) {
      const ax = this.pads.axes;
      if (Math.abs(ax[2]) + Math.abs(ax[3]) > 0.2) {
        this.camera.getWorldDirection(_d);
        _d.y = 0;
        _d.normalize();
        const right = _o.crossVectors(_d, UP).normalize();
        const k = s.throwHeld ? 9 : 2.2;
        const wx = (right.x * ax[2] - _d.x * ax[3]) * k;
        const wz = (right.z * ax[2] - _d.z * ax[3]) * k;
        const cy = Math.cos(boat.yaw),
          sy = Math.sin(boat.yaw);
        player.pos(this.aimLocal);
        this.aimLocal.x += wx * cy - wz * sy;
        this.aimLocal.z += wx * sy + wz * cy;
        this.aimLocal.y = 0.2;
        this.aimValid = true;
      }
    }
    if (this.aimValid) {
      inp.aim = (inp.aim ?? new THREE.Vector3()).copy(this.aimLocal);
    } else if (s.throwHeld && inp.aim) {
      // keep the last aim while throwing with touch/pad
    } else inp.aim = null;

    // --- buttons (levels + latched edges)
    inp.use = s.use;
    inp.interact = s.interact;
    inp.brace = s.brace;
    inp.throwAim = s.throwHeld;
    inp.usePressed += s.usePressed;
    inp.useReleased += s.useReleased;
    inp.interactPressed += s.interactPressed;
    inp.throwRelease += s.throwReleased;
    if (s.pingPressed) this.hooks.ping(this.aimValid ? this.aimLocal.clone() : null);
    this.endFrame();
  }

  private endFrame(): void {
    this.kb.endFrame();
    this.mouse.endFrame();
    this.touch?.endFrame();
  }

  /** Overhead pointer ray → local aim point on deck, else on the sea surface. */
  pointerToLocal(rayW: THREE.Ray, out: THREE.Vector3): boolean {
    const boat = this.ctx.boat;
    // to local space
    _q.copy(boat.quat).invert();
    _o.copy(rayW.origin).sub(boat.pos).applyQuaternion(_q);
    _d.copy(rayW.direction).applyQuaternion(_q);
    // try the deck structure first (tables, rails, items sit ~0–1 m up): intersect y = 0.35 plane
    for (const y of [0.95, 0.35]) {
      if (Math.abs(_d.y) < 1e-4) break;
      const t = (y - _o.y) / _d.y;
      if (t <= 0) continue;
      _p.copy(_o).addScaledVector(_d, t);
      if (!ItemManager.outsideHull(_p, -0.05)) {
        // prefer the table height only above the sorting table
        if (y > 0.5 && !(Math.abs(_p.x + 0.05) < 1.0 && Math.abs(_p.z - 1.0) < 1.15)) continue;
        out.copy(_p);
        return true;
      }
    }
    return this.seaPoint(rayW.origin, rayW.direction, out);
  }

  /** Intersect a world ray with the mean sea level near the boat, return in local coords. */
  seaPoint(origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): boolean {
    const boat = this.ctx.boat;
    const seaY = boat.heave.x;
    if (Math.abs(dir.y) < 1e-4) return false;
    const t = (seaY - origin.y) / dir.y;
    if (t <= 0 || t > 200) return false;
    _p.copy(origin).addScaledVector(dir, t);
    boat.worldToLocal(_p, out);
    return true;
  }
}
