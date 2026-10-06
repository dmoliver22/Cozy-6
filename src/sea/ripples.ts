/**
 * Ripple rings where things plop into the sea: one small quad per ripple, all drawn in a single
 * instanced call. Each quad is draped over the live wave surface in the vertex shader (the same
 * SEA_GLSL the sea uses, inverted with a couple of fixed-point steps), so rings never cut into a
 * wave slope. The rings themselves are computed per pixel (a gaussian profile around each
 * radius), so they are perfectly round at any size and cost a handful of triangles.
 *
 * They are drawn as a multiplicative highlight of the water underneath (dst × (1 + k)): a fresh
 * ring lifts the water by ~25 %, fading with age, and the first moments add a short-lived patch
 * of aerated, lighter water. Water-coloured, never a white outline.
 */
import * as THREE from 'three';
import { SEA_GLSL, type Sea, type SeaUniforms } from './waves';

const VERT = /* glsl */ `
${SEA_GLSL}
attribute vec4 aRipple; // age 0..1, strength, seed, radius of the quad (m)
varying vec4 vRipple;
varying vec2 vLocal;
void main() {
  vRipple = aRipple;
  vLocal = position.xz;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  // drape on the sea: find the undisplaced point that lands under (x, z), then lift to its height
  vec3 n; float pinch; float rc;
  vec2 p0 = wp.xz;
  vec3 d = seaDisplace(p0, 1.0, n, pinch, rc);
  p0 = wp.xz - d.xz;
  d = seaDisplace(p0, 1.0, n, pinch, rc);
  p0 = wp.xz - d.xz;
  d = seaDisplace(p0, 1.0, n, pinch, rc);
  wp.y = d.y + 0.03;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
varying vec4 vRipple;
varying vec2 vLocal;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float k = vRipple.x;
  float size = vRipple.w;
  float rl = length(vLocal);
  if (rl > 1.0 || vRipple.y <= 0.0) discard;
  float r = rl * size;                       // metres from the centre
  float R0 = max(size - 0.2, 0.05);          // the leading ring (the quad has 0.2 m to spare)
  float w = 0.08 + 0.05 * k;                 // ring half-width (m), softening as it spreads
  float ring = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float Ri = R0 * (1.0 - fi * 0.27);       // later rings trail the first
    float x = (r - Ri) / w;
    ring += exp(-x * x) * (1.0 - fi * 0.38) * step(0.05, Ri);
  }
  // the leading ring thins out a little unevenly as it spreads (never lobed or star-shaped)
  float n = vnoise(vLocal * 3.0 + vRipple.z * 37.0);
  ring *= 0.8 + 0.2 * n;
  float fade = pow(1.0 - k, 1.3) * min(1.0, k * 12.0) * vRipple.y;
  // aerated water where it went in: a short-lived, broken patch
  float n2 = vnoise(vLocal * 7.0 - vRipple.z * 13.0);
  float splat = (1.0 - smoothstep(0.08, 0.3 * (0.6 + 0.6 * n), rl)) * (1.0 - smoothstep(0.0, 0.3, k)) * smoothstep(0.35, 0.65, n2);
  float lift = ring * 0.26 * fade + splat * 0.45 * vRipple.y;
  // a multiplicative highlight: framebuffer = dst * (1 + lift)
  gl_FragColor = vec4(vec3(lift), 0.0);
}`;

interface Ripple {
  x: number;
  z: number;
  age: number;
  life: number;
  size: number;
  seed: number;
}

const _m = new THREE.Matrix4();

export class RippleField {
  readonly mesh: THREE.InstancedMesh;
  private uniforms: SeaUniforms;
  private data: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private pool: Ripple[] = [];
  private next = 0;
  private active = 0;

  constructor(
    private sea: Sea,
    readonly capacity = 10,
  ) {
    // a unit quad, subdivided only so the drape follows the swell (the rings are per pixel)
    const geo = new THREE.PlaneGeometry(2, 2, 4, 4).rotateX(-Math.PI / 2);
    this.data = new Float32Array(capacity * 4);
    this.attr = new THREE.InstancedBufferAttribute(this.data, 4);
    geo.setAttribute('aRipple', this.attr);
    this.uniforms = {
      uTime: { value: 0 },
      uWaveA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uWaveB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uRogueA: { value: new THREE.Vector4() },
      uRogueB: { value: new THREE.Vector4() },
      uFarFade: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    for (let i = 0; i < capacity; i++) {
      this.pool.push({ x: 0, z: 0, age: 1, life: 1, size: 0, seed: Math.random() });
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
  }

  /** A ring at world (x, z); `size` is the final radius in metres. */
  spawn(x: number, z: number, size: number, life: number): void {
    const r = this.pool[this.next];
    this.next = (this.next + 1) % this.capacity;
    r.x = x;
    r.z = z;
    r.age = 0;
    r.life = Math.max(0.2, life);
    r.size = size;
    r.seed = Math.random();
  }

  /** Was a ripple spawned near (x, z) within the last `sec` seconds? */
  recentNear(x: number, z: number, radius: number, sec: number): boolean {
    for (const r of this.pool) if (r.age < sec && r.age < r.life && Math.hypot(r.x - x, r.z - z) < radius) return true;
    return false;
  }

  update(dt: number): void {
    // live ripples are packed into the first instance slots and only those are drawn
    let active = 0;
    for (let i = 0; i < this.capacity; i++) {
      const r = this.pool[i];
      if (r.age >= r.life) continue;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) continue;
      // the ring keeps spreading as it fades
      // the leading ring keeps spreading as it fades; the quad is sized to it plus the ring width
      const sc = r.size * (0.25 + 0.85 * Math.sqrt(k)) * 1.25 + 0.2;
      this.mesh.setMatrixAt(active, _m.makeScale(sc, 1, sc).setPosition(r.x, 0, r.z));
      this.data[active * 4] = k;
      this.data[active * 4 + 1] = Math.min(1, 0.55 + r.size * 0.35);
      this.data[active * 4 + 2] = r.seed;
      this.data[active * 4 + 3] = sc;
      active++;
    }
    this.active = active;
    this.mesh.count = active;
    this.mesh.visible = active > 0;
    if (active > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.attr.needsUpdate = true;
      this.sea.writeUniforms(this.uniforms, this.sea.time);
    }
  }

  get count(): number {
    return this.active;
  }
}
