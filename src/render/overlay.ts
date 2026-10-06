/**
 * Anti-aliasing for flat UI rings (selection rings under the crew, the aim reticle, the landing
 * and highlight rings). Phones render without MSAA and the overlay helpers are drawn after post
 * straight onto the canvas, so their polygon edges stair-step. Instead of relying on MSAA, the
 * ring's alpha is feathered over about 1.5 px on both edges with a screen-space derivative of the
 * radius (fwidth), and the circle is drawn just inside the polygon so its chords never show.
 *
 * Applied at runtime by the stage's overlay scan to any MeshBasicMaterial on a RingGeometry; the
 * owners of those meshes don't need to change anything.
 */
import * as THREE from 'three';

/**
 * Layer for in-world markers (crew rings and their contact blobs, beacons): drawn by the game
 * camera with the scene (graded), left out of photos (the photo camera renders layer 0 only).
 */
export const MARKER_LAYER = 6;

/** Layer for screen-space-ish helpers that must stay crisp and ungraded (drawn after post). */
export const OVERLAY_LAYER = 7;

const FEATHERED = 'ringFeather';

/** Feather a ring mesh's edges once. Returns false if it doesn't apply (or already done). */
export function featherRing(mesh: THREE.Mesh): boolean {
  const geo = mesh.geometry as THREE.RingGeometry;
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (geo.type !== 'RingGeometry' || Array.isArray(mat) || !mat.isMeshBasicMaterial) return false;
  if (mat.userData[FEATHERED]) return false;
  const p = geo.parameters;
  // the polygon's chords sit inside the true circle by r·(1 − cos(π/n)): keep the drawn circle
  // inside them so the feathered edge stays round
  const k = Math.cos(Math.PI / Math.max(3, p.thetaSegments));
  const ring = new THREE.Vector2(p.innerRadius, p.outerRadius * k);
  mat.userData[FEATHERED] = true;
  mat.transparent = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRingR = { value: ring };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vRingR;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRingR = length(position.xy);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRingR;\nuniform vec2 uRingR;')
      .replace(
        '#include <alphatest_fragment>',
        `float rfw = max(fwidth(vRingR), 1e-5) * 1.5;
        diffuseColor.a *= smoothstep(uRingR.x, uRingR.x + rfw, vRingR) * (1.0 - smoothstep(uRingR.y - rfw, uRingR.y, vRingR));
        #include <alphatest_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => FEATHERED;
  mat.needsUpdate = true;
  return true;
}

// ---------------------------------------------------------------------------------------------
// objective beacon

/** Pixel heights (CSS px, times the pixel ratio) of the off-screen edge arrow and the label. */
const EDGE_PX = 28;
const LABEL_PX = 22;
/** the 0.35 m arrow never draws smaller than this (CSS px): from the whole-boat view it grows */
const ARROW_MIN_PX = 30;

export interface BeaconView {
  /** world-space group: the arrow, the ground ring and the label */
  root: THREE.Group;
  /** bobbing down-arrow (a billboard, so it reads as an arrow from any angle), drawn crisp on top of everything */
  arrow: THREE.Sprite;
  /** pulsing ring on the deck (or the water) around the target */
  ground: THREE.Mesh;
  /** arrow pinned to the screen edge, pointing at the target while it is off screen (add it to the scene too) */
  edge: THREE.Mesh;
  /** short caption over the arrow ("Throw the ring!") */
  label: THREE.Sprite;
  setColor(color: number): void;
  setLabel(text: string | null): void;
  /**
   * Animate and lay out for this frame: `anchor` is where the arrow's tip rests (world), `groundAt`
   * the point the ring sits on; `time` in seconds; `px` the drawing-buffer height in pixels and
   * `dpr` its pixel ratio.
   */
  update(camera: THREE.PerspectiveCamera, anchor: THREE.Vector3, groundAt: THREE.Vector3, time: number, px: number, dpr: number): void;
}

/** width / height of the arrow billboard */
const ARROW_ASPECT = 0.7;
let _arrowTex: THREE.Texture | null = null;
/** A fat down-arrow: white (the material tints it) with a dark rim. */
function arrowTexture(): THREE.Texture {
  if (_arrowTex) return _arrowTex;
  const W = 70,
    H = 100;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(22, 6);
  g.lineTo(48, 6);
  g.lineTo(48, 46);
  g.lineTo(64, 46);
  g.lineTo(35, 94);
  g.lineTo(6, 46);
  g.lineTo(22, 46);
  g.closePath();
  g.lineWidth = 9;
  g.strokeStyle = '#1a1208';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fill();
  _arrowTex = new THREE.CanvasTexture(cv);
  _arrowTex.colorSpace = THREE.SRGBColorSpace;
  return _arrowTex;
}

const _bv = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _bz = new THREE.Vector3(0, 0, 1);

/**
 * The objective beacon: a bobbing down-arrow (0.35 m tall, never under 30 px; ±0.08 m at 1.5 Hz)
 * with a dark rim so it reads on pale wood and on glitter, a pulsing ground ring on the target
 * (0.5–0.62 m, opacity 0.5–0.9 at 1.4 Hz), and an edge arrow when the target is off screen. The
 * arrow, edge arrow and label skip the depth test (overlay layer: never hidden by the rigging,
 * never graded); the ground ring is on MARKER_LAYER. None of it shows in photos.
 */
export function makeBeacon(color: number): BeaconView {
  const root = new THREE.Group();
  root.name = 'beacon';
  const mat = (c: number, opacity = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthTest: false, depthWrite: false });
  const fill = mat(color);
  const rim = mat(0x1a1208, 0.85);

  // down-arrow: a billboard (white fill, tinted by the material; dark rim), its tip on the anchor
  const arrowMat = new THREE.SpriteMaterial({ map: arrowTexture(), color, depthTest: false, depthWrite: false, transparent: true });
  const arrow = new THREE.Sprite(arrowMat);
  arrow.center.set(0.5, 0);
  arrow.renderOrder = 21;
  root.add(arrow);

  const groundMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false });
  const ground = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = 3;
  ground.layers.set(MARKER_LAYER);
  root.add(ground);

  // edge arrow: a flat arrowhead (+x points at the target) on a dark rim
  const tri = new THREE.Shape();
  tri.moveTo(0.5, 0);
  tri.lineTo(-0.35, 0.42);
  tri.lineTo(-0.18, 0);
  tri.lineTo(-0.35, -0.42);
  tri.closePath();
  const edge = new THREE.Mesh(new THREE.ShapeGeometry(tri), fill);
  edge.renderOrder = 22;
  const edgeRim = new THREE.Mesh(edge.geometry, rim);
  edgeRim.scale.setScalar(1.3);
  edgeRim.position.set(-0.03, 0, -0.001);
  edgeRim.renderOrder = 21;
  edge.add(edgeRim);
  edge.visible = false;
  edge.frustumCulled = false;
  edgeRim.frustumCulled = false;

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  label.renderOrder = 23;
  label.visible = false;
  root.add(label);
  let labelText: string | null = null;

  for (const o of [arrow, edge, label]) o.traverse((c) => c.layers.set(OVERLAY_LAYER));

  return {
    root,
    arrow,
    ground,
    edge,
    label,
    setColor(c: number) {
      fill.color.setHex(c);
      arrowMat.color.setHex(c);
      groundMat.color.setHex(c);
    },
    setLabel(text: string | null) {
      if (text === labelText) return;
      labelText = text;
      label.visible = !!text;
      const sm = label.material as THREE.SpriteMaterial;
      sm.map?.dispose();
      sm.map = null;
      if (!text) return;
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d')!;
      const font = 'bold 44px system-ui, sans-serif';
      ctx.font = font;
      const w = Math.ceil(ctx.measureText(text).width) + 48;
      cv.width = w;
      cv.height = 72;
      ctx.font = font;
      ctx.fillStyle = 'rgba(26,18,8,0.82)';
      ctx.beginPath();
      ctx.roundRect(2, 2, w - 4, 68, 30);
      ctx.fill();
      ctx.fillStyle = '#fff3e2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, 38);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      sm.map = tex;
      sm.needsUpdate = true;
      label.userData.aspect = w / 72;
    },
    update(camera, anchor, groundAt, time, px, dpr) {
      const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      // metres per pixel at the anchor's distance
      const mpp = (2 * ty * Math.max(0.1, camera.position.distanceTo(anchor))) / Math.max(1, px / dpr);
      const k = Math.max(1, (ARROW_MIN_PX * mpp) / 0.35);
      arrow.scale.set(0.35 * k * ARROW_ASPECT, 0.35 * k, 1);
      arrow.position.copy(anchor);
      arrow.position.y += Math.sin(time * Math.PI * 2 * 1.5) * 0.08 * Math.min(k, 2);
      ground.position.copy(groundAt);
      groundMat.opacity = 0.7 + 0.2 * Math.sin(time * Math.PI * 2 * 1.4);
      // the label rides above the arrow at a constant pixel size
      if (label.visible) {
        const h = ((LABEL_PX * dpr) / Math.max(1, px)) * 2 * ty;
        label.scale.set(h * (label.userData.aspect ?? 4), h, 1);
        label.position.copy(arrow.position);
        label.position.y += 0.35 * k + 0.45;
      }
      // off screen: pin an arrow to the screen edge, pointing at the target
      _bv.copy(anchor).project(camera);
      const behind = _bv.z > 1;
      let x = _bv.x,
        y = _bv.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const lim = 0.88;
      const off = behind || Math.abs(x) > lim || Math.abs(y) > lim;
      edge.visible = off;
      arrow.visible = !behind;
      if (!off) return;
      const c = Math.min(1, lim / Math.max(Math.abs(x), Math.abs(y), 1e-4));
      // a point 3 m in front of the camera, at that spot on the screen edge
      const d = 3;
      const tx = ty * camera.aspect;
      edge.quaternion.copy(camera.quaternion).multiply(_bq.setFromAxisAngle(_bz, Math.atan2(y * ty, x * tx)));
      edge.position.set(x * c * tx * d, y * c * ty * d, -d).applyQuaternion(camera.quaternion).add(camera.position);
      edge.scale.setScalar(((EDGE_PX * dpr) / Math.max(1, px)) * 2 * ty * d);
    },
  };
}
