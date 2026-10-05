/**
 * In-world aim helpers: throw arc preview, aim reticle, and the target highlight ring.
 */
import * as THREE from 'three';
import { config } from '../config';
import { solveBallistic, clamp } from '../core/math';

const N = 28;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class AimViz {
  readonly arc: THREE.Line;
  readonly reticle: THREE.Mesh;
  readonly highlight: THREE.Mesh;
  readonly landing: THREE.Mesh;
  private arcPos: Float32Array;

  constructor(parent: THREE.Object3D) {
    const g = new THREE.BufferGeometry();
    this.arcPos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    this.arc = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.95, depthTest: false }));
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 20;
    this.arc.visible = false;
    parent.add(this.arc);

    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.17, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.renderOrder = 19;
    parent.add(this.reticle);

    this.landing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 24), new THREE.MeshBasicMaterial({ color: config.palette.slicker, transparent: true, opacity: 0.9, depthTest: false }));
    this.landing.rotation.x = -Math.PI / 2;
    this.landing.renderOrder = 19;
    this.landing.visible = false;
    parent.add(this.landing);

    this.highlight = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 24), new THREE.MeshBasicMaterial({ color: config.palette.slicker, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.renderOrder = 19;
    parent.add(this.highlight);
  }

  showArc(from: THREE.Vector3 | null, to: THREE.Vector3 | null, gLocal: THREE.Vector3): void {
    if (!from || !to) {
      this.arc.visible = false;
      this.landing.visible = false;
      return;
    }
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const T = clamp(0.38 + d * 0.06, 0.42, 1.35);
    const v = solveBallistic(from, to, T, gLocal, _v2);
    const maxS = config.crew.throwMaxSpeed;
    if (v.length() > maxS) v.setLength(maxS);
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * T;
      _v.copy(from).addScaledVector(v, t).addScaledVector(gLocal, 0.5 * t * t);
      this.arcPos[i * 3] = _v.x;
      this.arcPos[i * 3 + 1] = _v.y;
      this.arcPos[i * 3 + 2] = _v.z;
    }
    this.arc.geometry.attributes.position.needsUpdate = true;
    this.arc.computeLineDistances();
    this.arc.visible = true;
    this.landing.visible = true;
    this.landing.position.set(_v.x, _v.y + 0.05, _v.z);
  }

  setReticle(p: THREE.Vector3 | null, visible: boolean): void {
    this.reticle.visible = visible && !!p;
    if (p) this.reticle.position.set(p.x, p.y + 0.04, p.z);
  }

  setHighlight(p: THREE.Vector3 | null, t: number, color = config.palette.slicker): void {
    this.highlight.visible = !!p;
    if (!p) return;
    this.highlight.position.set(p.x, p.y + 0.05, p.z);
    const s = 1 + Math.sin(t * 6) * 0.12;
    this.highlight.scale.setScalar(s);
    (this.highlight.material as THREE.MeshBasicMaterial).color.setHex(color);
  }
}
