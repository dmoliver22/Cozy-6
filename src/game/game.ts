/**
 * Game orchestrator (milestone 1 skeleton: sea, boat, overhead camera, debug overlay).
 */
import * as THREE from 'three';
import { config } from '../config';
import { Stage } from './stage';
import { Sea } from '../sea/waves';
import { Boat } from '../boat/boat';
import { makeBoat, type BoatArt } from '../art/boat';
import { CameraRig } from '../camera/cameraRig';
import { DebugOverlay } from '../ui/debug';
import { FixedLoop } from '../core/loop';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class Game {
  readonly stage: Stage;
  readonly sea = new Sea();
  readonly boat = new Boat();
  readonly boatGroup = new THREE.Group();
  readonly boatArt: BoatArt;
  readonly rig: CameraRig;
  readonly debug: DebugOverlay;
  readonly loop: FixedLoop;
  readonly ui: HTMLDivElement;
  renderTime = 0;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.ui = document.createElement('div');
    this.ui.id = 'ui';
    container.appendChild(this.ui);
    this.debug = new DebugOverlay(container);
    this.rig = new CameraRig(this.stage.camera);

    this.boatArt = makeBoat();
    this.boatGroup.add(this.boatArt.root);
    this.stage.scene.add(this.boatGroup);

    this.boat.targetSpeed = config.boat.speed.set;

    this.loop = new FixedLoop({
      step: (dt) => this.step(dt),
      render: (alpha, dtReal, dtSim) => this.render(alpha, dtReal, dtSim),
    });
  }

  start(): void {
    this.loop.start();
  }

  step(dt: number): void {
    this.sea.time += dt;
    this.boat.step(dt, this.sea);
  }

  render(alpha: number, dtReal: number, dtSim: number): void {
    this.debug.tick(dtReal);
    this.renderTime = this.sea.time - (1 - alpha) * this.loop.dt;
    this.boat.renderTransform(alpha, _p, _q);
    this.boatGroup.position.copy(_p);
    this.boatGroup.quaternion.copy(_q);
    this.boatGroup.updateMatrixWorld(true);
    _m.copy(this.boatGroup.matrixWorld).invert();

    this.rig.update({
      dt: dtReal,
      boatPos: _p,
      boatQuat: _q,
      boatYaw: this.boat.yaw,
      boatPitch: this.boat.pitch.x,
      boatRoll: this.boat.roll.x,
      focusWorld: _p,
      headWorld: _p,
      portrait: this.stage.portrait,
      rollFactor: config.camera.fp.rollFactor,
      headBob: true,
      walkPhase: 0,
      walkAmount: 0,
    });
    this.stage.seaMesh.update(this.sea, this.renderTime, _p, _m, this.boat.speed);
    this.stage.setWeatherLook(0, _p);
    this.stage.render();

    this.debug.update({
      fps: this.debug.fps,
      frameMs: this.debug.frameMs,
      bodies: 0,
      awake: 0,
      wave: `swell ${this.sea.swell.toFixed(2)}`,
      gLocal: { x: 0, y: -9.81, z: 0 },
      roll: this.boat.rollDeg,
      pitch: this.boat.pitchDeg,
      quality: this.stage.quality,
    });
  }
}
