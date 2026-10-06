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
import { ItemManager, type Item } from '../deck/items';
import { CG } from '../deck/groups';
import type { TouchControls } from '../ui/touch';
import { loadSettings, onSettingsChange } from '../core/settings';

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
  /** The old way: hold the button to carry, let go to put it down (setting "Hold to carry"). */
  holdToCarry = false;
  /** Easy carry: what the player keeps holding after the button came up. */
  latched: Item | null = null;
  /** a press went to the sim while not carrying: see whether it picked something up */
  private grabWatch = false;
  private heldAtPress: Item | null = null;
  /** the press that let go of a latched thing: ignore the button until it comes up */
  private swallowUse = false;
  /** touch: a press while carrying waits for the finger to lift (tap = put down, drag = throw) */
  private touchLetGo = false;

  constructor(
    canvas: HTMLElement,
    private ctx: Ctx,
    private rig: CameraRig,
    private camera: THREE.PerspectiveCamera,
    private hooks: PlayerHooks,
  ) {
    this.mouse = new Mouse(canvas);
    this.holdToCarry = loadSettings().holdToCarry;
    onSettingsChange((st) => {
      if (st.holdToCarry === this.holdToCarry) return;
      this.holdToCarry = st.holdToCarry;
      this.resetLatch();
    });
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
    s.touchUsePressed = 0;
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
      this.resetLatch();
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
    const use = this.carryLatch(s, player);
    inp.use = use.level;
    inp.interact = s.interact;
    inp.brace = s.brace;
    inp.throwAim = s.throwHeld;
    inp.usePressed += use.pressed;
    inp.useReleased += s.useReleased;
    this.carryPrompt(player);
    inp.interactPressed += s.interactPressed;
    inp.throwRelease += s.throwReleased;
    if (s.pingPressed) this.hooks.ping(this.aimValid ? this.aimLocal.clone() : null);
    this.endFrame();
  }

  /**
   * Easy carry. A crew member drops what they carry as soon as `use` goes low (hold-to-carry,
   * which the bots rely on). For the player the input layer instead keeps `use` latched after a
   * press that picked something up, so a tap or click is enough to carry. The next press is the
   * "let go": `use` drops (the crew then places or drops the thing, running any "place" verb) and
   * the press starts nothing new. Hold verbs (levers) are not latched; throwing (RMB / RT / an
   * Action drag) works while latched.
   */
  private carryLatch(s: DeviceSnapshot, player: Crew): { level: boolean; pressed: number } {
    let level = s.use;
    let pressed = s.usePressed;
    if (this.holdToCarry) return { level, pressed };
    const held = player.held;
    // it left our hands some other way (thrown, put down by a brace or a knockdown, stolen)
    if (this.latched && held !== this.latched) this.resetLatch();
    // a pick-up press the sim has consumed: did it leave us holding something new to carry?
    if (this.grabWatch && player.input.usePressed === 0) {
      this.grabWatch = false;
      if (held && held !== this.heldAtPress && held.def.carry !== 'sticky' && !player.activeVerb) this.latched = held;
    }
    // after letting go: the button is still down from that press
    if (this.swallowUse) {
      if (pressed === 0 && s.use) level = false;
      else this.swallowUse = false;
    }
    if (this.latched) {
      if (pressed > 0) {
        if (s.touchUsePressed > 0) this.touchLetGo = true; // tap or slingshot? wait for the finger
        else this.letGo(s.use);
        pressed = 0;
      }
      if (this.touchLetGo) {
        if (s.throwHeld) this.touchLetGo = false; // it's a drag: the release throws instead
        else if (!this.touch?.actionDown) this.letGo(false);
      }
      if (this.latched) return { level: true, pressed: 0 };
      return { level: false, pressed: 0 };
    }
    if (pressed > 0) {
      // keep the level up until the sim has used this press, even for a click shorter than a frame
      this.grabWatch = true;
      this.heldAtPress = held;
    }
    if (this.grabWatch) level = true;
    return { level, pressed };
  }

  private letGo(buttonStillDown: boolean): void {
    this.latched = null;
    this.touchLetGo = false;
    this.swallowUse = buttonStillDown;
  }

  private resetLatch(): void {
    this.latched = null;
    this.grabWatch = false;
    this.heldAtPress = null;
    this.touchLetGo = false;
  }

  /** Spell out how to let go of what you're carrying (HUD hint line + the touch Action button). */
  private carryPrompt(player: Crew): void {
    const it = player.held;
    let hint = '';
    let touchCarry: { icon: string; label: string } | null = null;
    if (it && it.def.carry !== 'sticky' && player.isUp) {
      const place = player.targetVerbs.find((v) => v.id.startsWith('place'));
      const what = place ? place.label.charAt(0).toLowerCase() + place.label.slice(1) : it.def.carry === 'push' ? 'let go' : 'put it down';
      const dev = this.lastDevice;
      if (this.latched || this.grabWatch) {
        hint = dev === 'touch' ? `Tap Action to ${what}` : dev === 'pad' ? `Press A to ${what}` : `Click to ${what}`;
        touchCarry = place ? { icon: place.icon, label: place.label } : { icon: '⤵', label: it.def.carry === 'push' ? 'Let go' : 'Put down' };
      } else if (this.holdToCarry) {
        hint = dev === 'touch' ? `Let go of Action to ${what}` : dev === 'pad' ? `Let go of A to ${what}` : `Let go of the button to ${what}`;
      }
    }
    this.ctx.sys.hud?.setHint?.(hint);
    if (this.touch) this.touch.carry = touchCarry;
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
