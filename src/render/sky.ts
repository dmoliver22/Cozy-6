/**
 * Procedural sky: one GLSL function (`skyColor(dir)`) used two ways.
 *  - SkyDome: a back-faced sphere drawn after the opaque scene (so early-z skips every pixel the
 *    sea already covers; in the overhead view that is nearly all of them).
 *  - SkyEnv: the same function rendered into a small equirect target and turned into a PMREM for
 *    scene.environment. It is regenerated only when the look changes noticeably (the caller
 *    throttles); the view yaw is applied with scene.environmentRotation instead of a rebuild.
 *
 * Golden hour: horizon haze → warm horizon → blue-teal zenith, a sun disc with a wide and a tight
 * glow, and a few soft cloud bands near the horizon lit from the sun side. Storm: overcast.
 */
import * as THREE from 'three';
import type { Look } from './look';

const SKY_PARS = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uHaze;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uSunDisc;
uniform float uSunAmt;
uniform float uDiscGain;
uniform float uCloud;
uniform float uOvercast;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uSkyTime;

float skHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float skNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skHash(i), skHash(i + vec2(1.0, 0.0)), u.x), mix(skHash(i + vec2(0.0, 1.0)), skHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float skFbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * skNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

vec3 skyColor(vec3 dir) {
  dir = normalize(dir);
  float e = dir.y;
  float sd = max(dot(dir, uSunDir), 0.0);
  // 0 facing away from the sun … 1 facing it (horizontal only)
  vec2 hz = dir.xz / max(length(dir.xz), 1e-4);
  vec2 sz = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float sunSide = 0.5 + 0.5 * dot(hz, sz);
  // gradient: warm horizon on the sun side, a cooler, paler one opposite, easing into the zenith
  vec3 horizon = mix(mix(uHorizon, uZenith, 0.45), uHorizon, smoothstep(0.0, 1.0, sunSide));
  float t = pow(clamp(e, 0.0, 1.0), 0.42);
  vec3 col = mix(horizon, uZenith, smoothstep(0.0, 0.78, t));
  // sun glow: a broad warm band along the horizon toward the sun, a halo and a hot core
  float lowSky = 1.0 - smoothstep(0.0, 0.32, e);
  col += uGlow * (pow(sunSide, 4.0) * lowSky * 0.35 + pow(sd, 6.0) * 0.16 + pow(sd, 64.0) * 0.55 + pow(sd, 700.0) * 2.5) * uSunAmt;
  // horizon haze matches the fog so the sea melts into the sky
  col = mix(col, uHaze, (1.0 - smoothstep(-0.01, 0.09, e)) * 0.9);

  // clouds on a flat layer (perspective packs them into bands near the horizon)
  vec2 cp = dir.xz / (max(e, 0.0) + 0.09);
  cp = cp * vec2(0.22, 0.55) + vec2(uSkyTime * 0.004, uSkyTime * 0.0015);
  float n = skFbm(cp);
  float band = smoothstep(0.0, 0.03, e) * (1.0 - smoothstep(0.12, 0.42, e));
  float cover = mix(0.62, 0.18, uOvercast);
  float dens = smoothstep(cover, cover + 0.28, n) * mix(band * uCloud, 1.0, uOvercast);
  // lit from the sun side, with a bright edge where the cloud thins
  vec3 cloud = mix(uCloudShade, uCloudLit, 0.25 + 0.75 * pow(sd, 2.5));
  cloud += uGlow * pow(sd, 10.0) * (1.0 - smoothstep(0.0, 0.6, dens)) * 1.2 * uSunAmt;
  // overcast: a slow, heavier second layer of darker patches
  float n2 = skFbm(dir.xz / (max(e, 0.0) + 0.25) * 0.8 + uSkyTime * 0.003);
  cloud *= mix(1.0, 0.72 + 0.4 * n2, uOvercast);
  col = mix(col, cloud, clamp(dens, 0.0, 1.0) * 0.92);

  // the sun disc, dimmed behind cloud
  float ang = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(uSunDisc * 0.75, uSunDisc, ang);
  col += uSunCol * disc * uDiscGain * uSunAmt * (1.0 - dens * 0.85);

  // below the horizon: the sea's own colour (only seen in reflections and the env map)
  col = mix(col, uGround, smoothstep(-0.005, -0.12, e));
  return col;
}
`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const DOME_FRAG = /* glsl */ `
${SKY_PARS}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(skyColor(vDir), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const EQUI_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// three's equirectUv(): u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5
const EQUI_FRAG = /* glsl */ `
${SKY_PARS}
varying vec2 vUv;
void main() {
  float phi = (vUv.x - 0.5) * 6.28318530718;
  float th = (vUv.y - 0.5) * 3.14159265359;
  vec3 dir = vec3(cos(phi) * cos(th), sin(th), sin(phi) * cos(th));
  gl_FragColor = vec4(skyColor(dir), 1.0);
}`;

export type SkyUniforms = Record<
  'uZenith' | 'uHorizon' | 'uGlow' | 'uHaze' | 'uGround' | 'uSunDir' | 'uSunCol' | 'uSunDisc' | 'uSunAmt' | 'uDiscGain' | 'uCloud' | 'uOvercast' | 'uCloudLit' | 'uCloudShade' | 'uSkyTime',
  THREE.IUniform
>;

export function makeSkyUniforms(): SkyUniforms {
  return {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color() },
    uSunDisc: { value: 0.04 },
    uSunAmt: { value: 1 },
    uDiscGain: { value: 14 },
    uCloud: { value: 1 },
    uOvercast: { value: 0 },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uSkyTime: { value: 0 },
  };
}

const _c = new THREE.Color();
/**
 * Write a look into sky uniforms. `overcast` (0..1) is how far toward the storm deck the sky is
 * (cloud cover everywhere, sun hidden). `clouds` scales the golden-hour horizon bands; `ground`
 * overrides the below-horizon colour (default: the deep sea colour in the haze).
 */
export function skyFromLook(u: SkyUniforms, look: Look, overcast: number, opts: { clouds?: number; ground?: THREE.Color } = {}): void {
  (u.uZenith.value as THREE.Color).copy(look.skyZenith);
  (u.uHorizon.value as THREE.Color).copy(look.skyHorizon);
  (u.uGlow.value as THREE.Color).copy(look.skyGlow);
  (u.uHaze.value as THREE.Color).copy(look.fogColor);
  (u.uGround.value as THREE.Color).copy(opts.ground ?? _c.copy(look.sea.deep).lerp(look.fogColor, 0.25));
  (u.uSunDir.value as THREE.Vector3).copy(look.sunDir);
  (u.uSunCol.value as THREE.Color).copy(look.sunColor);
  u.uSunDisc.value = Math.max(0.004, look.sunDisc);
  u.uSunAmt.value = Math.max(0, 1 - overcast * 1.1);
  u.uCloud.value = opts.clouds ?? 1;
  u.uOvercast.value = overcast;
  (u.uCloudLit.value as THREE.Color).copy(look.skyGlow).lerp(look.sunColor, 0.3).multiplyScalar(1.1 - overcast * 0.45);
  (u.uCloudShade.value as THREE.Color).copy(look.skyZenith).lerp(look.fogColor, 0.55).multiplyScalar(0.85 - overcast * 0.25);
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms: SkyUniforms;

  constructor(radius = 500) {
    this.uniforms = makeSkyUniforms();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
    // drawn after every opaque so the depth test throws away the pixels the sea already covers
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }
}

/**
 * The sky as an environment map: equirect render → PMREM, reusing its targets. `update()` copies
 * the dome's uniforms, so the env always matches what the sky shows.
 */
export class SkyEnv {
  readonly uniforms: SkyUniforms;
  private pmrem: THREE.PMREMGenerator;
  private equi: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private target: THREE.WebGLRenderTarget | null = null;
  generations = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    width = 512,
  ) {
    this.uniforms = makeSkyUniforms();
    this.uniforms.uDiscGain.value = 0; // the sun light gives the hard highlight; the env only glows
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.equi = new THREE.WebGLRenderTarget(width, width / 2, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false });
    this.equi.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>, vertexShader: EQUI_VERT, fragmentShader: EQUI_FRAG, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  get texture(): THREE.Texture | null {
    return this.target ? this.target.texture : null;
  }

  /** Copy sky uniforms (all but the disc gain) and rebuild the PMREM. Returns the env texture. */
  update(from: SkyUniforms): THREE.Texture {
    for (const k of Object.keys(from) as (keyof SkyUniforms)[]) {
      if (k === 'uDiscGain') continue;
      const v = from[k].value;
      const dst = this.uniforms[k];
      if (v && typeof v === 'object' && 'copy' in v) (dst.value as { copy(o: unknown): void }).copy(v);
      else dst.value = v;
    }
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.equi);
    r.render(this.qScene, this.qCam);
    r.setRenderTarget(prev);
    this.target = this.target ? this.pmrem.fromEquirectangular(this.equi.texture, this.target) : this.pmrem.fromEquirectangular(this.equi.texture);
    this.generations++;
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.equi.dispose();
    this.pmrem.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.quad.geometry.dispose();
  }
}
