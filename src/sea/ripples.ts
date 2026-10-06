/**
 * Ripple rings where things plop into the sea: a pool of discs drawn in one instanced call.
 * Each disc is draped over the live wave surface in the vertex shader (the same SEA_GLSL the sea
 * uses, inverted with a couple of fixed-point steps), so rings never cut into a wave slope.
 * The fragment shader draws two or three soft concentric rings travelling outward, a brief foam
 * splat in the middle and a glint where the ring catches the sun.
 */
import * as THREE from 'three';
import { SEA_GLSL, type Sea, type SeaUniforms } from './waves';
import { seaLight } from './seaLook';

const VERT = /* glsl */ `
${SEA_GLSL}
attribute vec4 aRipple; // age 0..1, strength, seed, -
varying vec4 vRipple;
varying vec2 vLocal;
varying vec3 vWorld;
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
  wp.y = d.y + 0.035;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uFoam;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uAmbient;
varying vec4 vRipple;
varying vec2 vLocal;
varying vec3 vWorld;
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
  float r = length(vLocal);
  if (r > 1.0 || vRipple.y <= 0.0) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float wob = 0.03 * sin(ang * 5.0 + vRipple.z * 30.0) + 0.02 * sin(ang * 9.0 - vRipple.z * 11.0);
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ri = k * (1.0 - fi * 0.24) + wob;            // later rings trail the first
    float w = 0.035 + 0.05 * k;
    float ring = exp(-pow((r - ri) / w, 2.0)) * step(0.02, ri) * (1.0 - fi * 0.32);
    a = max(a, ring);
  }
  // the ring thins out unevenly as it spreads
  float n = vnoise(vLocal * 4.0 + vRipple.z * 37.0);
  a *= 0.6 + 0.4 * smoothstep(0.25, 0.7, n + 0.3 * (1.0 - k));
  // a lumpy patch of foam in the first moments
  float lump = vnoise(vLocal * 2.5 + vRipple.z * 11.0);
  float splat = (1.0 - smoothstep(0.0, 0.16 + 0.22 * k + 0.1 * lump, r)) * (1.0 - smoothstep(0.05, 0.45, k)) * 0.8;
  a = max(a, splat);
  a *= pow(1.0 - k, 1.4) * min(1.0, k * 14.0) * vRipple.y;
  vec3 V = normalize(cameraPosition - vWorld);
  float glint = pow(max(dot(reflect(-uSunDir, vec3(0.0, 1.0, 0.0)), V), 0.0), 6.0);
  vec3 col = uFoam * (0.55 + uAmbient * 0.25 + uSun * 0.08) + uSun * glint * 0.35;
  gl_FragColor = vec4(col, a * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
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
    const geo = new THREE.RingGeometry(0.001, 1, 36, 4).rotateX(-Math.PI / 2);
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
      uFoam: { value: seaLight.foam },
      uSun: { value: seaLight.sun },
      uSunDir: { value: seaLight.sunDir },
      uAmbient: { value: seaLight.ambient },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
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
      const sc = r.size * (0.25 + 0.85 * Math.sqrt(k)) * 1.25;
      this.mesh.setMatrixAt(active, _m.makeScale(sc, 1, sc).setPosition(r.x, 0, r.z));
      this.data[active * 4] = k;
      this.data[active * 4 + 1] = Math.min(1, 0.55 + r.size * 0.35);
      this.data[active * 4 + 2] = r.seed;
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
