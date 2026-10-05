/**
 * Renderer, scene, lights, sky and fog. Owns quality tiers and the weather look.
 */
import * as THREE from 'three';
import { config } from '../config';
import { SeaMesh } from '../sea/seaMesh';
import { clamp, lerp } from '../core/math';

export type Quality = 'low' | 'medium' | 'high';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uSunAmt;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
  float s = max(dot(normalize(vDir), uSunDir), 0.0);
  col += uSunCol * (pow(s, 64.0) * 0.6 + pow(s, 6.0) * 0.18) * uSunAmt;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

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
  quality: Quality;
  storm = 0;
  fpMode = 0; // 0 overhead … 1 first person (for fog distances)

  private morningTop = new THREE.Color(0x8fb3c4);
  private morningHorizon = new THREE.Color(config.palette.morningHorizon);
  private stormTop = new THREE.Color(0x4e4c72);
  private stormHorizon = new THREE.Color(config.palette.storm);
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();

  constructor(container: HTMLElement) {
    this.isPhone = matchMedia('(pointer: coarse)').matches;
    this.quality = this.isPhone ? 'low' : 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.isPhone, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';

    this.camera = new THREE.PerspectiveCamera(config.camera.overhead.fov, 1, 0.3, 600);
    this.fog = new THREE.Fog(config.palette.morningHorizon, 70, 170);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xdfeef2, 0x2a5a60, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
    this.sun.position.set(30, 45, 20);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -15;
    sc.right = 15;
    sc.top = 15;
    sc.bottom = -15;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.rim = new THREE.DirectionalLight(0xbfe3ff, 0.55);
    this.rim.position.set(-30, 20, -40);
    this.scene.add(this.rim);

    this.skyUniforms = {
      uTop: { value: this.morningTop.clone() },
      uHorizon: { value: this.morningHorizon.clone() },
      uSunDir: { value: new THREE.Vector3(0.5, 0.25, 0.5).normalize() },
      uSunCol: { value: new THREE.Color(0xfff2d8) },
      uSunAmt: { value: 1 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 12),
      new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.seaMesh = new SeaMesh(config.quality[this.quality].seaSegments);
    this.scene.add(this.seaMesh.mesh);

    this.applyQuality(this.quality);
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
    this.renderer.shadowMap.enabled = qc.shadows;
    this.sun.castShadow = qc.shadows;
    this.seaMesh.setSegments(qc.seaSegments);
    // materials need recompiling when shadows toggle
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
  }

  /** Weather look: 0 = soft morning, 1 = lavender storm. */
  setWeatherLook(storm: number, focus: THREE.Vector3): void {
    this.storm = storm;
    const top = this.tmpC.copy(this.morningTop).lerp(this.stormTop, storm);
    const hor = this.tmpC2.copy(this.morningHorizon).lerp(this.stormHorizon, clamp(storm * 1.2, 0, 1));
    (this.skyUniforms.uTop.value as THREE.Color).copy(top);
    (this.skyUniforms.uHorizon.value as THREE.Color).copy(hor);
    this.skyUniforms.uSunAmt.value = 1 - storm;
    this.fog.color.copy(hor);
    const near = lerp(lerp(70, 40, storm), lerp(30, 14, storm), this.fpMode);
    const far = lerp(lerp(170, 120, storm), lerp(96, 70, storm), this.fpMode);
    this.fog.near = near;
    this.fog.far = far;
    this.sun.intensity = lerp(1.9, 0.75, storm);
    this.sun.color.setHex(storm > 0.5 ? 0xd8d4f0 : 0xfff0dc);
    this.hemi.intensity = lerp(1.25, 0.95, storm);
    this.hemi.color.setHex(0xdfeef2).lerp(new THREE.Color(0xb6b2dc), storm);
    const su = this.seaMesh.uniforms;
    (su.uSky.value as THREE.Color).copy(hor).lerp(top, 0.4);
    (su.uSun as { value: number }).value = lerp(0.8, 0.12, storm);
    (su.uStorm as { value: number }).value = storm;
    (su.uDeep.value as THREE.Color).setHex(config.sea.colorDeep).lerp(new THREE.Color(0x1c2a3c), storm * 0.6);
    (su.uShallow.value as THREE.Color).setHex(config.sea.colorShallow).lerp(new THREE.Color(0x3d5a6e), storm * 0.5);
    this.renderer.toneMappingExposure = lerp(1.05, 0.95, storm);
    // sun & shadow box follow the boat
    const sd = (this.skyUniforms.uSunDir.value as THREE.Vector3).set(0.55, 0.42, 0.5).normalize();
    this.sun.position.copy(focus).addScaledVector(sd, 60);
    this.sun.target.position.copy(focus);
    (su.uSunDir.value as THREE.Vector3).copy(sd);
  }

  render(): void {
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
