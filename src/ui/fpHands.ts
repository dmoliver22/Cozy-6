/**
 * First-person mittens: chunky hand-knitted wool (stocking stitch, a cream ribbed cuff and a red
 * Nordic stripe) poking out of the yellow slicker sleeves. They hang at the bottom of the view,
 * reach toward whatever you carry, grip the rail when you brace, and work levers with a little pump.
 */
import * as THREE from 'three';
import { config } from '../config';
import { knitMat } from '../art/crew';
import { mergeStatic } from '../art/materials';
import type { Crew } from '../crew/crew';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Copy a geometry with its UVs scaled (stitch density). */
function uvScaled(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

export class FpHands {
  readonly group = new THREE.Group();
  private l: THREE.Group;
  private r: THREE.Group;
  private restL = new THREE.Vector3(-0.26, -0.3, -0.5);
  private restR = new THREE.Vector3(0.26, -0.3, -0.5);
  private curL = new THREE.Vector3();
  private curR = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    // own materials (the hands draw on top with their own render order)
    const wool = knitMat(0x3c6e8f).clone();
    const cream = knitMat(0xe9e1cf).clone();
    const red = knitMat(0xc8432f).clone();
    const sleeve = new THREE.MeshStandardMaterial({ color: config.palette.slicker, roughness: 0.3, metalness: 0 });
    const mk = (s: number) => {
      const g = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], sc?: [number, number, number], rot?: [number, number, number]) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(...p);
        if (sc) m.scale.set(...sc);
        if (rot) m.rotation.set(...rot);
        g.add(m);
      };
      // the mitten: a plump palm pointing forward, a thumb on the inner side
      add(uvScaled(new THREE.SphereGeometry(0.078, 18, 14), 6, 3), wool, [0, 0, -0.01], [0.95, 0.74, 1.3]);
      add(uvScaled(new THREE.SphereGeometry(0.036, 12, 10), 3, 1.5), wool, [-s * 0.062, 0.018, -0.02], [1, 0.9, 1.45], [0.2, -s * 0.5, 0]);
      // red Nordic stripe round the back of the hand
      add(uvScaled(new THREE.CylinderGeometry(0.073, 0.072, 0.024, 18, 1, true), 10, 0.4), red, [0, 0, 0.055], [0.95, 1, 0.76], [Math.PI / 2, 0, 0]);
      // cream ribbed cuff and the slicker sleeve
      add(uvScaled(new THREE.CylinderGeometry(0.064, 0.068, 0.07, 18), 12, 0.6), cream, [0, 0, 0.1], [1, 1, 0.85], [Math.PI / 2, 0, 0]);
      add(new THREE.CylinderGeometry(0.074, 0.08, 0.12, 18), sleeve, [0, 0, 0.18], [1, 1, 0.9], [Math.PI / 2, 0, 0]);
      add(new THREE.TorusGeometry(0.073, 0.012, 6, 18), sleeve, [0, 0, 0.122], [1, 0.9, 1]);
      mergeStatic(g);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.renderOrder = 50;
          m.castShadow = false;
          m.receiveShadow = false;
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
    // a slight inward tilt, like hands held out in front
    this.l.rotation.set(0.25, 0.2, 0.25);
    this.r.rotation.set(0.25, -0.2, -0.25);
  }
}
