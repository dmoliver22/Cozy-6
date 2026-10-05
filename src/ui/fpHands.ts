/**
 * First-person mittens. They hang at the bottom of the view, reach toward whatever you carry,
 * grip the rail when you brace, and work levers with a little pump.
 */
import * as THREE from 'three';
import { toon } from '../art/materials';
import type { Crew } from '../crew/crew';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class FpHands {
  readonly group = new THREE.Group();
  private l: THREE.Group;
  private r: THREE.Group;
  private restL = new THREE.Vector3(-0.26, -0.3, -0.5);
  private restR = new THREE.Vector3(0.26, -0.3, -0.5);
  private curL = new THREE.Vector3();
  private curR = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    const mk = (s: number) => {
      const g = new THREE.Group();
      const mat = toon(0x3c6e8f);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mat);
      palm.scale.set(1, 0.8, 1.25);
      const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat);
      thumb.position.set(-s * 0.06, 0.02, -0.02);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.08, 10), toon(0xf2c230));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.z = 0.1;
      g.add(palm, thumb, cuff);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.renderOrder = 50;
          (m.material as THREE.Material).depthTest = true;
        }
      });
      return g;
    };
    this.l = mk(-1);
    this.r = mk(1);
    this.group.add(this.l, this.r);
    this.curL.copy(this.restL);
    this.curR.copy(this.restR);
    camera.add(this.group);
    this.group.visible = false;
  }

  update(dt: number, camera: THREE.Camera, crew: Crew, boatMatrix: THREE.Matrix4, blend: number, t: number): void {
    this.group.visible = blend > 0.85 && !crew.inSea;
    if (!this.group.visible) return;
    const tl = _v.copy(this.restL);
    const tr = _w.copy(this.restR);
    const bob = Math.sin(crew.walkPhase) * 0.015 * crew.walkAmount;
    tl.y += bob;
    tr.y -= bob;
    const inv = new THREE.Matrix4().copy(camera.matrixWorld).invert();
    const toCam = (local: THREE.Vector3, out: THREE.Vector3) => out.copy(local).applyMatrix4(boatMatrix).applyMatrix4(inv);
    if (crew.braced) {
      // mittens on the rail
      const a = toCam(crew.braceAnchor, new THREE.Vector3());
      if (a.z < -0.15) {
        tl.copy(a).add(new THREE.Vector3(-0.14, 0.02, 0));
        tr.copy(a).add(new THREE.Vector3(0.14, 0.02, 0));
      } else {
        tl.set(-0.22, -0.2, -0.42);
        tr.set(0.22, -0.2, -0.42);
      }
    } else if (crew.held && crew.held.mode === 'deck') {
      const p = toCam(crew.held.renderP, new THREE.Vector3());
      if (p.z < -0.1) {
        tl.copy(p).add(new THREE.Vector3(-0.16, -0.02, 0.05));
        tr.copy(p).add(new THREE.Vector3(0.16, -0.02, 0.05));
      }
      if (crew.throwAiming) tr.set(0.28, 0.05, -0.32);
    } else if (crew.activeVerb) {
      const k = Math.sin(t * 10) * 0.04;
      tl.set(-0.12, -0.22 + k, -0.48);
      tr.set(0.12, -0.22 - k, -0.48);
    } else if (crew.sliding) {
      tl.set(-0.4, 0.0 + Math.sin(t * 14) * 0.08, -0.4);
      tr.set(0.4, 0.0 - Math.sin(t * 14) * 0.08, -0.4);
    }
    const k = 1 - Math.exp(-dt * 16);
    this.curL.lerp(tl, k);
    this.curR.lerp(tr, k);
    this.l.position.copy(this.curL);
    this.r.position.copy(this.curR);
  }
}
