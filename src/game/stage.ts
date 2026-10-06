/**
 * Renderer, scene, lights, sky, environment, fog, shadows and the post pipeline. Owns the quality
 * tiers. Everything visual is driven from computeLook(storm, viewYaw) (src/render/look.ts):
 *  - sun (with a tight shadow frustum fitted to the boat every frame), cool rim/fill, hemi fill;
 *  - the procedural sky dome, and scene.environment as a PMREM of that sky, rebuilt only when the
 *    storm amount moves noticeably (the view yaw is applied with environmentRotation);
 *  - fog, exposure and the sea (SeaMesh.applyLook);
 *  - Medium/High: HDR target → tilt-shift (focus band on the boat, reaching past the waterline)
 *    → bloom (High) → grade, then the UI overlays (aim arc, rings, pot numbers: anything with
 *    depthTest off) drawn crisp on top. Flat UI rings get feathered edges (no MSAA on phones).
 *    Phones with a dense screen drop the tilt pass if frames run long.
 *  - Low: one straight render to the canvas with ACES tone mapping. No extra passes.
 */
import * as THREE from 'three';
import { config } from '../config';
import { SeaMesh } from '../sea/seaMesh';
import { clamp, damp, lerp } from '../core/math';
import { cloneLook, computeLook, type Look } from '../render/look';
import { SkyDome, SkyEnv, makeSkyUniforms, skyFromLook } from '../render/sky';
import { Post, type PostView } from '../render/post';
import { featherRing } from '../render/overlay';
import { BOW_Z, HALF_BEAM, STERN_Z } from '../boat/layout';

export type Quality = 'low' | 'medium' | 'high';

/** Layer for screen-space-ish helpers that must stay crisp and ungraded (drawn after post). */
export const OVERLAY_LAYER = 7;

/** Boat-local bounds of everything that receives the sun's shadow (hull, deck, crew, house). */
const BOAT_MIN = new THREE.Vector3(-HALF_BEAM - 0.35, -1.4, STERN_Z - 0.4);
const BOAT_MAX = new THREE.Vector3(HALF_BEAM + 0.35, 3.6, BOW_Z + 0.4);
const CORNERS = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? BOAT_MAX.x : BOAT_MIN.x, i & 2 ? BOAT_MAX.y : BOAT_MIN.y, i & 4 ? BOAT_MAX.z : BOAT_MIN.z));

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _size = new THREE.Vector2();

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  readonly skyUniforms: Record<string, THREE.IUniform>;
  readonly seaMesh: SeaMesh;
  readonly fog: THREE.Fog;
  readonly isPhone: boolean;
  readonly post: Post;
  /** the look currently on screen (owned copy; updated every frame by setWeatherLook) */
  readonly look: Look;
  quality: Quality;
  storm = 0;
  fpMode = 0; // 0 overhead … 1 first person (fog distances, tilt-shift fade)
  /** horizontal heading of the overhead camera; the sun is placed relative to it */
  viewYaw = 0;
  /** world points the tilt-shift band must keep sharp besides the boat (crew in the water) */
  focusPoints: THREE.Vector3[] = [];

  private skyDome: SkyDome;
  private env: SkyEnv;
  private envSky = makeSkyUniforms();
  private envLook: Look;
  private envStorm = -1;
  private envAge = 1e9;
  private boatPos = new THREE.Vector3();
  private boatQuat = new THREE.Quaternion();
  private hasBoat = false;
  private focusY = 0.5;
  private focusHalf = 0.2;
  private focusInit = false;
  private overlayScan = 0;
  private overlays: THREE.Object3D[] = [];
  private lastT = performance.now() / 1000;
  private afterRender: (() => void)[] = [];
  private view: PostView = { focusY: 0.5, focusHalf: 0.2, tilt: 1, time: 0 };
  /** smoothed frame time (ms), for the phone tilt-shift skip */
  private frameMs = 0;
  private slowSec = 0;
  /** phones: tilt-shift dropped for this tier because frames ran long (reset on a tier change) */
  tiltSkipped = false;

  constructor(container: HTMLElement) {
    this.isPhone = matchMedia('(pointer: coarse)').matches;
    this.quality = this.isPhone ? 'low' : 'high';
    // the scene's MSAA happens in the HDR target on Medium/High; the canvas keeps desktop MSAA for
    // the overlay pass (aim arc, rings) and for desktops that drop to Low. Phones: none.
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.isPhone, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // Low renders straight to the canvas
    this.renderer.toneMappingExposure = 1;
    // r186 folded PCFSoftShadowMap into PCFShadowMap: soft Vogel-disk PCF with shadow.radius
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // several passes per frame: count them all (reset at the top of render())
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';

    this.camera = new THREE.PerspectiveCamera(config.camera.overhead.fov, 1, 0.3, 600);
    this.camera.layers.enable(OVERLAY_LAYER);
    this.look = cloneLook(computeLook(0, 0));
    this.envLook = cloneLook(this.look);

    this.fog = new THREE.Fog(this.look.fogColor, this.look.fogNear, this.look.fogFar);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.position.set(30, 45, 20);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 80;
    this.scene.add(this.sun, this.sun.target);
    this.rim = new THREE.DirectionalLight(0xffffff, 0.5);
    this.scene.add(this.rim, this.rim.target);

    this.skyDome = new SkyDome(500);
    this.sky = this.skyDome.mesh;
    this.skyUniforms = this.skyDome.uniforms as unknown as Record<string, THREE.IUniform>;
    this.scene.add(this.sky);

    this.env = new SkyEnv(this.renderer, this.isPhone ? 256 : 512);
    this.post = new Post(this.renderer);
    this.post.blurFrac = config.render.tiltBlur;
    this.post.focusSoft = config.render.tiltSoft;

    this.seaMesh = new SeaMesh(config.quality[this.quality].seaSegments);
    this.scene.add(this.seaMesh.mesh);

    this.applyQuality(this.quality);
    this.setWeatherLook(0, new THREE.Vector3());
    this.hasBoat = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
  }

  get portrait(): boolean {
    return window.innerHeight > window.innerWidth * 1.05;
  }

  applyQuality(q: Quality): void {
    this.quality = q;
    const qc = config.quality[q];
    const cap = this.isPhone ? config.render.maxPixelRatioPhone : config.render.maxPixelRatioDesktop;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap, qc.pixelRatio));
    const shadowsChanged = this.renderer.shadowMap.enabled !== qc.shadows;
    this.renderer.shadowMap.enabled = qc.shadows;
    this.sun.castShadow = qc.shadows;
    const sz = qc.shadowMapSize || 1024;
    if (this.sun.shadow.mapSize.x !== sz) {
      this.sun.shadow.mapSize.set(sz, sz);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    // softness in world terms stays about the same across map sizes
    this.sun.shadow.radius = config.render.shadowRadius * (sz / 2048) + 1;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = sz >= 2048 ? 0.025 : 0.04;
    this.post.configure({ enabled: qc.post, msaa: this.isPhone ? 0 : qc.msaa, bloom: qc.bloom, tilt: qc.tilt });
    this.tiltSkipped = false;
    this.slowSec = 0;
    this.seaMesh.setSegments(qc.seaSegments);
    // materials need recompiling when shadows toggle
    if (shadowsChanged)
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.getDrawingBufferSize(_size);
    this.post.setSize(_size.x, _size.y);
  }

  /**
   * Weather look: 0 = golden hour, 1 = storm. `focus` is the boat's world position; pass the
   * overhead view yaw (the sun sits ahead-right of it) and the boat's rotation when known, so
   * the shadow frustum and the tilt-shift band can hug the boat.
   */
  setWeatherLook(storm: number, focus: THREE.Vector3, viewYaw?: number, boatQuat?: THREE.Quaternion): void {
    this.storm = storm;
    if (viewYaw !== undefined) this.viewYaw = viewYaw;
    this.boatPos.copy(focus);
    if (boatQuat) this.boatQuat.copy(boatQuat);
    this.hasBoat = true;
    const look = computeLook(storm, this.viewYaw, this.look);

    // lights
    const amb = 1 - this.fpMode * 0.15;
    this.hemi.color.copy(look.hemiSky);
    this.hemi.groundColor.copy(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity * 0.65 * amb;
    this.sun.color.copy(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.sun.shadow.intensity = lerp(0.82, 0.6, storm);
    this.rim.color.copy(look.rimColor);
    this.rim.intensity = look.rimIntensity;
    // the cool fill comes from just behind the camera (a little to its right, the sun's side):
    // it lifts what faces the player, the near hull side and the crew's faces, without competing
    // with the warm side-raking key
    const rimAz = this.viewYaw - 2.88;
    const rimEl = 0.62;
    _v.set(Math.sin(rimAz) * Math.cos(rimEl), Math.sin(rimEl), Math.cos(rimAz) * Math.cos(rimEl));
    this.rim.position.copy(focus).addScaledVector(_v, 40);
    this.rim.target.position.copy(focus);
    this.fitShadow(look);

    // fog
    this.fog.color.copy(look.fogColor);
    this.fog.near = lerp(look.fogNear, look.fpFogNear, this.fpMode);
    this.fog.far = lerp(look.fogFar, look.fpFogFar, this.fpMode);

    // sky and sea
    skyFromLook(this.skyDome.uniforms, look, clamp((storm - 0.25) / 0.6, 0, 1));
    this.seaMesh.applyLook(look);
    const su = this.seaMesh.uniforms as unknown as Record<string, THREE.IUniform | undefined>;
    if (su.uStorm) su.uStorm.value = storm;

    // environment: rotate with the view, rebuild only when the weather has moved on
    this.scene.environmentRotation.set(0, this.viewYaw, 0);
    this.scene.environmentIntensity = lerp(config.render.envIntensity[0], config.render.envIntensity[1], storm);
    this.renderer.toneMappingExposure = look.exposure;
  }

  /** Called after each sea frame is rendered (photo captures hook in here). */
  onAfterRender(fn: () => void): void {
    this.afterRender.push(fn);
  }

  render(): void {
    const r = this.renderer;
    r.info.reset();
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this.lastT);
    this.lastT = now;
    this.watchFrameTime(dt);
    this.skyDome.uniforms.uSkyTime.value = now;
    this.updateEnv(dt);
    this.sky.position.copy(this.camera.position);
    this.overlayScan -= dt;
    if (this.overlayScan <= 0) {
      this.markOverlays();
      this.overlayScan = 0.5;
    }

    if (this.post.active) {
      this.updateFocus(dt);
      const v = this.view;
      v.focusY = this.focusY;
      v.focusHalf = this.focusHalf;
      const fp = 1 - this.fpMode;
      v.tilt = this.tiltSkipped ? 0 : fp * fp;
      v.time = now;
      this.camera.layers.disable(OVERLAY_LAYER);
      this.post.render(this.scene, this.camera, this.look, v, null);
      // crisp UI helpers on top, ungraded (no lights on this layer, so no second shadow pass)
      if (this.overlays.some((o) => o.visible)) {
        this.camera.layers.set(OVERLAY_LAYER);
        const ac = r.autoClear;
        r.autoClear = false;
        this.scene.matrixWorldAutoUpdate = false; // already updated by the main pass
        r.setRenderTarget(null);
        r.render(this.scene, this.camera);
        this.scene.matrixWorldAutoUpdate = true;
        r.autoClear = ac;
      }
      this.camera.layers.set(0);
      this.camera.layers.enable(OVERLAY_LAYER);
    } else {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
    }
    for (const fn of this.afterRender) fn();
  }

  /**
   * Render another scene (harbor, galley) with the same pipeline and the given look. Low tier
   * renders straight to the canvas.
   */
  renderView(scene: THREE.Scene, camera: THREE.Camera, look: Look, opts: { focusY?: number; focusHalf?: number; tilt?: number } = {}): void {
    const r = this.renderer;
    r.info.reset();
    r.toneMappingExposure = look.exposure;
    if (this.post.active) {
      this.view.focusY = opts.focusY ?? 0.5;
      this.view.focusHalf = opts.focusHalf ?? 0.18;
      this.view.tilt = opts.tilt ?? 1;
      this.view.time = performance.now() / 1000;
      this.post.render(scene, camera, look, this.view, null);
    } else {
      r.setRenderTarget(null);
      r.render(scene, camera);
    }
  }

  /**
   * A graded still of the sea scene from `camera` (photos). Uses the shadow map from the frame
   * just drawn and reads back asynchronously, so it never stalls the frame. Bottom row first.
   */
  capture(camera: THREE.PerspectiveCamera, w: number, h: number): Promise<Uint8Array> {
    const r = this.renderer;
    const prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const skyPos = _v2.copy(this.sky.position);
    this.sky.position.copy(camera.position);
    this.sky.updateMatrixWorld();
    camera.layers.set(0); // no aim rings or labels in the photo
    camera.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false; // shot right after a frame: matrices are current
    const view: PostView = { focusY: 0.5, focusHalf: 0.16, tilt: 1, time: performance.now() / 1000 };
    try {
      return this.post.capture(this.scene, camera, this.look, view, w, h);
    } finally {
      this.scene.matrixWorldAutoUpdate = true;
      r.shadowMap.autoUpdate = prevAuto;
      this.sky.position.copy(skyPos);
      this.sky.updateMatrixWorld();
    }
  }

  // ------------------------------------------------------------------------------------------

  /** Fit the sun's orthographic shadow box tightly around the boat, long side along the keel. */
  private fitShadow(look: Look): void {
    const sun = this.sun;
    const sc = sun.shadow.camera;
    // centre the light on the middle of the boat's bounds
    const centre = _v.copy(BOAT_MIN).add(BOAT_MAX).multiplyScalar(0.5).applyQuaternion(this.boatQuat).add(this.boatPos);
    const fwd = _v2.set(0, 0, 1).applyQuaternion(this.boatQuat);
    sc.up.copy(fwd);
    const D = 40;
    sun.position.copy(centre).addScaledVector(look.sunDir, D);
    sun.target.position.copy(centre);
    // light-space bounds of the boat box (same basis DirectionalLightShadow builds with lookAt)
    _m.lookAt(sun.position, centre, fwd);
    _q.setFromRotationMatrix(_m).invert();
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    const p = _p;
    for (const c of CORNERS) {
      p.copy(c).applyQuaternion(this.boatQuat).add(this.boatPos).sub(sun.position).applyQuaternion(_q);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    // symmetric half extents rounded up to 0.5 m so texel size changes in steps, not every frame
    const hx = Math.ceil(Math.max(-x0, x1) * 2 + 0.6) / 2;
    const hy = Math.ceil(Math.max(-y0, y1) * 2 + 0.6) / 2;
    sc.left = -hx;
    sc.right = hx;
    sc.bottom = -hy;
    sc.top = hy;
    // casters above the box (mast, gantry) sit nearer the light: leave room in front
    sc.near = Math.max(0.5, -z1 - 8);
    sc.far = -z0 + 2;
    sc.updateProjectionMatrix();
  }

  /**
   * Phones with a dense screen (DPR >= 1.5) drop the tilt-shift pass, the biggest fixed cost after
   * shadows, once frames have averaged over config.render.phoneTiltSkipMs for a couple of seconds.
   * It stays off until the quality tier changes (auto quality re-evaluates from there).
   */
  private watchFrameTime(dt: number): void {
    if (!this.isPhone || this.tiltSkipped || !this.post.active || !this.post.tier.tilt) return;
    if ((window.devicePixelRatio || 1) < 1.5) return;
    this.frameMs = lerp(this.frameMs || dt * 1000, dt * 1000, 0.05);
    this.slowSec = this.frameMs > config.render.phoneTiltSkipMs ? this.slowSec + dt : 0;
    if (this.slowSec > 2) this.tiltSkipped = true;
  }

  /** The tilt-shift band: the boat's vertical extent on screen, eased. */
  private updateFocus(dt: number): void {
    let cy = 0.5,
      half = 0.2;
    if (this.hasBoat) {
      this.camera.updateMatrixWorld();
      let y0 = Infinity,
        y1 = -Infinity,
        ok = true;
      for (const c of CORNERS) {
        _v.copy(c).applyQuaternion(this.boatQuat).add(this.boatPos);
        _v.applyMatrix4(this.camera.matrixWorldInverse);
        if (_v.z > -0.1) {
          ok = false;
          break;
        }
        _v.applyMatrix4(this.camera.projectionMatrix);
        const y = _v.y * 0.5 + 0.5;
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      if (ok) {
        // shrink a touch (the box corners overshoot the hull), then grow to cover anyone in the water
        // and reach below the hull so the waterline foam and the wake stay sharp
        const c0 = (y0 + y1) * 0.5,
          h0 = (y1 - y0) * 0.5 * 0.92;
        y0 = c0 - h0 - config.render.tiltBandBelow;
        y1 = c0 + h0;
        for (const p of this.focusPoints) {
          _v.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
          if (_v.z > -0.1) continue;
          _v.applyMatrix4(this.camera.projectionMatrix);
          const y = _v.y * 0.5 + 0.5;
          y0 = Math.min(y0, y - 0.05);
          y1 = Math.max(y1, y + 0.05);
        }
        cy = (y0 + y1) * 0.5;
        half = clamp((y1 - y0) * 0.5, 0.08, 0.7);
      }
    }
    if (!this.focusInit) {
      this.focusY = cy;
      this.focusHalf = half;
      this.focusInit = true;
    }
    this.focusY = damp(this.focusY, cy, 5, dt);
    this.focusHalf = damp(this.focusHalf, half, 5, dt);
  }

  /** Rebuild the sky environment map when the weather has moved on (throttled). */
  private updateEnv(dt: number): void {
    this.envAge += dt;
    const minSec = this.quality === 'low' ? config.render.envRegenMinSecLow : config.render.envRegenMinSec;
    const first = this.envStorm < 0;
    if (!first && (Math.abs(this.storm - this.envStorm) < config.render.envRegenStorm || this.envAge < minSec)) return;
    // generated at view yaw 0; scene.environmentRotation turns it with the camera
    const look = computeLook(this.storm, 0, this.envLook);
    skyFromLook(this.envSky, look, clamp((this.storm - 0.25) / 0.6, 0, 1));
    this.envSky.uSkyTime.value = 0;
    this.scene.environment = this.env.update(this.envSky);
    this.envStorm = this.storm;
    this.envAge = 0;
  }

  /**
   * UI helpers (depth test off, unlit) go on the overlay layer so post leaves them crisp. Flat UI
   * rings (crew selection rings, aim reticle/landing/highlight) get alpha-feathered edges.
   */
  private markOverlays(): void {
    this.overlays.length = 0;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.type === 'RingGeometry') featherRing(o as THREE.Mesh);
      if (!m || Array.isArray(m) || m.depthTest !== false) return;
      const unlit = (m as THREE.MeshBasicMaterial).isMeshBasicMaterial || (m as THREE.LineBasicMaterial).isLineBasicMaterial || (m as THREE.SpriteMaterial).isSpriteMaterial || (m as THREE.PointsMaterial).isPointsMaterial;
      if (!unlit) return;
      if (o.layers.mask !== 1 << OVERLAY_LAYER) o.layers.set(OVERLAY_LAYER);
      this.overlays.push(o);
    });
  }
}
