/**
 * First-person mittens: chunky hand-knitted wool (fat stocking stitches, a cream ribbed cuff and
 * a red Nordic stripe) with a separate thumb that curls round whatever you hold, poking out of the
 * yellow slicker: a turned-back cuff with a stitched seam and a band of reflective tape, then the
 * sleeve, which always runs from the wrist back to a shoulder behind the camera so its end never
 * shows, whatever the pose or screen shape. The mittens hang at the bottom of the view, reach
 * toward whatever you carry, grip the rail when you brace, and work levers with a little pump.
 */
import * as THREE from 'three';
import { config } from '../config';
import { knitTexture } from '../art/crew';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Crew } from '../crew/crew';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _roll = new THREE.Quaternion();

/** Where the sleeve begins (inside the cuff), in hand space. */
const WRIST = new THREE.Vector3(0, 0, 0.17);
/** Shoulders, in camera space: behind and below the eye, outside the view. */
const SHOULDER_L = new THREE.Vector3(-0.3, -0.62, 0.12);
const SHOULDER_R = new THREE.Vector3(0.3, -0.62, 0.12);

/** Soft crinkles for the waxed slicker (a bump map). */
function crinkle(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 128, 128);
  let s = 4242;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const x = r() * 128,
      y = r() * 128,
      l = 6 + r() * 20,
      a = r() * Math.PI;
    g.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    g.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
    g.quadraticCurveTo(x + (r() - 0.5) * 8, y + (r() - 0.5) * 8, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** A piece of knitting: geometry with scaled UVs (stitch density) and a flat vertex colour. */
function knit(g: THREE.BufferGeometry, su: number, sv: number, color: number, m: THREE.Matrix4): THREE.BufferGeometry {
  const q = g.index ? g.toNonIndexed() : g;
  const uv = q.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  const c = new THREE.Color(color);
  const n = q.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  q.setAttribute('color', new THREE.BufferAttribute(col, 3));
  q.applyMatrix4(m);
  return q;
}
const M = (p: [number, number, number], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
/** Strip a geometry to position/normal/uv and transform it. */
function plain(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const q = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') q.deleteAttribute(k);
  q.applyMatrix4(m);
  return q;
}

export class FpHands {
  readonly group = new THREE.Group();
  private l: THREE.Group;
  private r: THREE.Group;
  private thumbs: THREE.Object3D[] = [];
  private sleeves: THREE.Mesh[] = [];
  private restL = new THREE.Vector3(-0.26, -0.3, -0.5);
  private restR = new THREE.Vector3(0.26, -0.3, -0.5);
  private curL = new THREE.Vector3();
  private curR = new THREE.Vector3();
  private curl = 0;

  constructor(camera: THREE.Camera) {
    // own materials (the hands draw on top with their own render order). Chunky wool: the colours
    // are in the vertex colours, so the mitten, stripe and cuff are one draw.
    const kt = knitTexture();
    const wool = new THREE.MeshStandardMaterial({ color: 0xffffff, map: kt, bumpMap: kt, bumpScale: 0.9, roughness: 0.92, metalness: 0, vertexColors: true });
    const slicker = new THREE.MeshStandardMaterial({ color: config.palette.slicker, roughness: 0.32, metalness: 0, bumpMap: crinkle(), bumpScale: 0.35 });
    const seam = new THREE.MeshStandardMaterial({ color: new THREE.Color(config.palette.slicker).multiplyScalar(0.62), roughness: 0.6, metalness: 0 });
    const tape = new THREE.MeshStandardMaterial({ color: 0xe3e7e9, roughness: 0.25, metalness: 0.55 });
    const BLUE = 0x3c6e8f,
      CREAM = 0xe9e1cf,
      RED = 0xc8432f;
    // the sleeve: a unit-length open tube along +z, stretched each frame from the wrist to the shoulder
    const sleeveGeo = new THREE.CylinderGeometry(0.077, 0.1, 1, 18, 4, true);
    sleeveGeo.rotateX(Math.PI / 2);
    sleeveGeo.translate(0, 0, 0.5);

    const mk = (s: number) => {
      const g = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = g) => {
        const m = new THREE.Mesh(geo, mat);
        parent.add(m);
        return m;
      };
      // the mitten: a plump palm pointing forward with a red stripe round the back of the hand
      // and a cream ribbed cuff, all one knitted piece
      add(
        mergeGeometries([
          knit(new THREE.SphereGeometry(0.078, 20, 16), 3, 1.5, BLUE, M([0, 0, -0.01], [0.95, 0.76, 1.3])),
          knit(new THREE.CylinderGeometry(0.073, 0.072, 0.026, 20, 1, true), 5, 0.35, RED, M([0, 0, 0.056], [0.95, 1, 0.78], [Math.PI / 2, 0, 0])),
          knit(new THREE.CylinderGeometry(0.066, 0.07, 0.08, 20, 1, true), 6, 0.45, CREAM, M([0, 0, 0.105], [1, 1, 0.86], [Math.PI / 2, 0, 0])),
        ])!,
        wool,
      );
      // a chunky thumb on the inner side, hinged at its root so it can curl
      const thumb = new THREE.Group();
      thumb.position.set(-s * 0.05, 0.012, 0.02);
      g.add(thumb);
      add(knit(new THREE.CapsuleGeometry(0.03, 0.05, 4, 12), 1.5, 0.75, BLUE, M([0, 0.004, -0.045], [1, 0.9, 1], [Math.PI / 2, 0, 0])), wool, thumb);
      this.thumbs.push(thumb);
      // the turned-back slicker cuff: a flared band with a rolled lip, a stitched seam and tape
      const cuff = mergeGeometries([
        plain(new THREE.CylinderGeometry(0.088, 0.082, 0.08, 20, 1, true), M([0, 0, 0.165], [1, 1, 1], [Math.PI / 2, 0, 0])),
        plain(new THREE.TorusGeometry(0.087, 0.011, 6, 20), M([0, 0, 0.126])),
        // the back of the cuff is closed (the sleeve leaves from inside it)
        plain(new THREE.CircleGeometry(0.083, 20), M([0, 0, 0.205])),
      ])!;
      add(cuff, slicker);
      const dashes: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        dashes.push(plain(new THREE.BoxGeometry(0.012, 0.0035, 0.003), M([Math.cos(a) * 0.0875, Math.sin(a) * 0.0875, 0.142], [1, 1, 1], [0, 0, a + Math.PI / 2])));
      }
      add(mergeGeometries(dashes)!, seam);
      add(plain(new THREE.CylinderGeometry(0.0895, 0.0885, 0.02, 20, 1, true), M([0, 0, 0.175], [1, 1, 1], [Math.PI / 2, 0, 0])), tape);
      // the sleeve itself lives in camera space (see update)
      const sleeve = new THREE.Mesh(sleeveGeo, slicker);
      this.sleeves.push(sleeve);
      this.group.add(sleeve);
      return g;
    };
    this.l = mk(-1);
    this.r = mk(1);
    this.group.add(this.l, this.r);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.renderOrder = 50;
        m.castShadow = false;
        m.receiveShadow = false;
        m.frustumCulled = false;
      }
    });
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
    let grip = 0;
    if (crew.braced) {
      // mittens on the rail
      grip = 1;
      const a = toCam(crew.braceAnchor, new THREE.Vector3());
      if (a.z < -0.15) {
        tl.copy(a).add(new THREE.Vector3(-0.14, 0.02, 0));
        tr.copy(a).add(new THREE.Vector3(0.14, 0.02, 0));
      } else {
        tl.set(-0.22, -0.2, -0.42);
        tr.set(0.22, -0.2, -0.42);
      }
    } else if (crew.held && crew.held.mode === 'deck') {
      grip = 1;
      const p = toCam(crew.held.renderP, new THREE.Vector3());
      if (p.z < -0.1) {
        tl.copy(p).add(new THREE.Vector3(-0.16, -0.02, 0.05));
        tr.copy(p).add(new THREE.Vector3(0.16, -0.02, 0.05));
      }
      if (crew.throwAiming) tr.set(0.28, 0.05, -0.32);
    } else if (crew.activeVerb) {
      grip = 0.8;
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
    // each mitten points along its forearm (shoulder to hand), rolled a little palm-in
    const shoulders = [SHOULDER_L, SHOULDER_R];
    [this.l, this.r].forEach((h, i) => {
      const back = _d.copy(shoulders[i]).sub(h.position).normalize();
      h.quaternion.setFromUnitVectors(_z, back).multiply(_roll.setFromAxisAngle(_z, i === 0 ? 0.3 : -0.3));
    });
    // thumbs: relaxed and a little open, curled in round a grip
    this.curl += (grip - this.curl) * (1 - Math.exp(-dt * 12));
    this.thumbs.forEach((th, i) => {
      const s = i === 0 ? -1 : 1;
      th.rotation.set(-0.15 - this.curl * 0.55, s * (0.55 - this.curl * 0.9), s * this.curl * 0.3);
    });
    // sleeves: from each wrist back to its shoulder behind the camera
    [this.l, this.r].forEach((h, i) => {
      h.updateMatrix();
      const wrist = _d.copy(WRIST).applyMatrix4(h.matrix);
      const sl = this.sleeves[i];
      sl.position.copy(wrist);
      const dir = shoulders[i].clone().sub(wrist);
      const len = dir.length();
      sl.quaternion.setFromUnitVectors(_z, dir.multiplyScalar(1 / len));
      sl.scale.set(1, 1, len + 0.05);
    });
  }
}
