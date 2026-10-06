/**
 * Snow: one Points cloud wrapped around the camera, drifting with the wind.
 * Count scales with quality; density with the weather's snow amount.
 *
 * Flakes are soft, slightly out-of-focus discs that tumble as they fall. In wind they stretch
 * into short motion streaks along their screen-space velocity, so a storm reads as driven snow.
 * Near flakes are larger and softer (like a lens close to the miniature), far ones crisp, and
 * all of them fade out at the edges of the wrap box so it never pops. Lit by the shared sea light.
 */
import * as THREE from 'three';
import { seaLight } from '../sea/seaLook';

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec2 uWind;
uniform float uBox;
uniform float uScale;
uniform float uAmount;
uniform vec2 uViewport;
attribute float aSeed;
varying float vAlpha;
varying vec3 vStretch;
varying float vSoft;
varying float vSeed;

vec3 flake(vec3 base, float t) {
  vec3 p = base;
  float fall = 1.1 + aSeed * 0.8;
  p.y -= t * fall;
  p.x += t * uWind.x * (0.8 + aSeed) + sin(t * 1.3 + aSeed * 40.0) * 0.4;
  p.z += t * uWind.y * (0.8 + aSeed) + cos(t * 1.1 + aSeed * 30.0) * 0.4;
  return p;
}

void main() {
  vSeed = aSeed;
  vec3 p = flake(position, uTime);
  // velocity from the same motion (a short look back in time), before wrapping
  vec3 v = (p - flake(position, uTime - 0.05)) / 0.05;
  // wrap into a box around the camera
  vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  p = rel + uCenter;
  // soft fade in by amount (seeded so density changes smoothly) and at the box edges
  float on = smoothstep(aSeed - 0.06, aSeed + 0.02, uAmount);
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));
  vAlpha = on * edge;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(1.0, -mv.z);
  float size = uScale * (0.6 + aSeed * 0.8) / depth;
  // streak: screen-space motion over ~45 ms (exposure), in pixels
  vec4 c1 = projectionMatrix * mv;
  vec4 c2 = projectionMatrix * (modelViewMatrix * vec4(p + v * 0.045, 1.0));
  vec2 dpx = (c2.xy / max(c2.w, 1e-3) - c1.xy / max(c1.w, 1e-3)) * 0.5 * uViewport;
  float len = length(dpx);
  float el = 1.0 + clamp(len / max(size, 1.0), 0.0, 3.0);
  vec2 dir = len > 1e-3 ? dpx / len : vec2(0.0, 1.0);
  vStretch = vec3(dir.x, -dir.y, el);
  // near the lens: bigger and softer
  vSoft = smoothstep(14.0, 3.0, depth);
  size *= 1.0 + vSoft * 1.5;
  vAlpha *= 1.0 - vSoft * 0.55;
  gl_PointSize = max(1.5, size * el);
  gl_Position = c1;
}`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
varying float vAlpha;
varying vec3 vStretch;
varying float vSoft;
varying float vSeed;
void main() {
  if (vAlpha < 0.01) discard;
  vec2 c = gl_PointCoord - 0.5;
  vec2 d = vStretch.xy;
  vec2 q = vec2(dot(c, d), dot(c, vec2(-d.y, d.x)) * vStretch.z);
  float r = length(q) * 2.0;
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(mix(0.25, 0.0, vSoft), 1.0, r);
  // streaks thin toward their tail
  core *= mix(1.0, 0.55 + 0.45 * smoothstep(-0.5, 0.3, q.x), step(1.3, vStretch.z));
  gl_FragColor = vec4(uLight, core * vAlpha * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _c = new THREE.Color();

export class Snow {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private box = 46;

  constructor(scene: THREE.Scene, count: number) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2() },
        uBox: { value: this.box },
        uScale: { value: 300 },
        uAmount: { value: 0 },
        uViewport: { value: new THREE.Vector2(1280, 720) },
        uLight: { value: new THREE.Color(0.95, 0.97, 1.0) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.makeGeo(count), this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
  }

  private makeGeo(count: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.box;
      pos[i * 3 + 1] = (Math.random() - 0.5) * this.box;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.box;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }

  setCount(count: number): void {
    this.points.geometry.dispose();
    this.points.geometry = this.makeGeo(count);
  }

  update(time: number, center: THREE.Vector3, wind: THREE.Vector2, windStrength: number, amount: number, pixelScale: number, fp: number, boxOverride?: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector3).copy(center);
    (u.uWind.value as THREE.Vector2).copy(wind).multiplyScalar(1 + windStrength * 5);
    u.uAmount.value = amount;
    u.uScale.value = pixelScale * (fp > 0.5 ? 0.06 : 0.1);
    u.uBox.value = boxOverride ?? (fp > 0.5 ? 26 : this.box);
    // pixelScale is the drawing-buffer height in pixels
    (u.uViewport.value as THREE.Vector2).set(pixelScale * (window.innerWidth / Math.max(1, window.innerHeight)), pixelScale);
    // flakes take the colour of the light: cool white, a little warmth from the sun
    const s = seaLight.sun,
      a = seaLight.ambient;
    _c.setRGB(0.86 + s.r * 0.03 + a.r * 0.08, 0.9 + s.g * 0.03 + a.g * 0.08, 0.96 + s.b * 0.03 + a.b * 0.08);
    (u.uLight.value as THREE.Color).copy(_c);
    this.points.visible = amount > 0.01;
  }
}
