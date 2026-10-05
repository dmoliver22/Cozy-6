/**
 * Snow: one Points cloud wrapped around the camera, drifting with the wind.
 * Count scales with quality; density with the weather's snow amount.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec2 uWind;
uniform float uBox;
uniform float uScale;
uniform float uAmount;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 p = position;
  float fall = 1.1 + aSeed * 0.8;
  p.y -= uTime * fall;
  p.x += uTime * uWind.x * (0.8 + aSeed) + sin(uTime * 1.3 + aSeed * 40.0) * 0.4;
  p.z += uTime * uWind.y * (0.8 + aSeed) + cos(uTime * 1.1 + aSeed * 30.0) * 0.4;
  // wrap into a box around the camera
  p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
  vAlpha = step(aSeed, uAmount);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uScale * (0.6 + aSeed * 0.8) / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25 || vAlpha < 0.5) discard;
  gl_FragColor = vec4(0.95, 0.97, 1.0, smoothstep(0.25, 0.0, d) * 0.9);
}`;

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

  update(time: number, center: THREE.Vector3, wind: THREE.Vector2, windStrength: number, amount: number, pixelScale: number, fp: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector3).copy(center);
    (u.uWind.value as THREE.Vector2).copy(wind).multiplyScalar(1 + windStrength * 5);
    u.uAmount.value = amount;
    u.uScale.value = pixelScale * (fp > 0.5 ? 0.06 : 0.1);
    u.uBox.value = fp > 0.5 ? 26 : this.box;
    this.points.visible = amount > 0.01;
  }
}
