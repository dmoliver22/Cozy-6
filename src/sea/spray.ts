/**
 * Spray & splash particles (world space), one Points cloud with a soft sprite.
 * Also small ice shards / water cascades on deck reuse this with a boat-local cloud.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = smoothstep(0.25, 0.05, d) * vAlpha;
  gl_FragColor = vec4(uColor, a);
}`;

export class ParticleCloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private baseSize: Float32Array;
  private next = 0;
  gravity = -9.81;
  drag = 0.6;
  /** optional floor (e.g. sea height) — particles die when below */
  floor: ((x: number, z: number) => number) | null = null;

  constructor(
    readonly capacity: number,
    color: number,
    pixelScale = 300,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -9999;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: pixelScale } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setPixelScale(s: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = s;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
  }

  burst(center: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, spread: number, life = 1.1, size = 0.5): void {
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      p.set(center.x + (Math.random() - 0.5) * spread, center.y + Math.random() * 0.3, center.z + (Math.random() - 0.5) * spread);
      v.set(dir.x + (Math.random() - 0.5) * 0.8, dir.y + Math.random() * 0.6, dir.z + (Math.random() - 0.5) * 0.8)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      this.emit(p, v, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8));
    }
  }

  update(dt: number): void {
    const g = this.gravity;
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.pos[i * 3 + 1] = -9999;
        }
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] += g * dt;
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.5) * 0.85;
      this.size[i] = this.baseSize[i] * (1.6 - t * 0.6);
      if (this.floor && this.pos[i * 3 + 1] < this.floor(this.pos[i * 3], this.pos[i * 3 + 2]) - 0.2) this.life[i] = 0;
    }
    const geo = this.points.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
