/**
 * Spray & splash particles, one Points cloud per owner (world space, or boat-local when added
 * under the boat group). Two kinds share a cloud:
 *   droplets  small, bright, stretched along their screen-space motion
 *   mist      big soft puffs that hang, spread and fade (the white haze of a splash)
 * Both are lit by the shared sea light: warm when the low sun is behind them (forward scattering,
 * the "sunlit spray" look), cool sky fill otherwise. Ice shards use the same cloud with a
 * faceted, glinting sprite.
 */
import * as THREE from 'three';
import { seaLight } from './seaLook';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aVel;
attribute vec2 aMeta; // seed, kind (0 droplet, 1 mist, 2 big soft puff)
uniform float uScale;
uniform vec2 uViewport;
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uSunTint;
uniform vec3 uAmbient;
varying float vAlpha;
varying vec3 vCol;
varying vec3 vStretch; // screen dir (point-coord frame), elongation
varying vec2 vMeta;
void main() {
  vAlpha = aAlpha;
  vMeta = aMeta;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = aSize * uScale / max(0.5, -mv.z);
  // stretch fast droplets along their motion on screen (~40 ms of travel)
  vec4 c1 = projectionMatrix * mv;
  vec4 c2 = projectionMatrix * (modelViewMatrix * vec4(position + aVel * 0.04, 1.0));
  vec2 dpx = (c2.xy / max(c2.w, 1e-3) - c1.xy / max(c1.w, 1e-3)) * 0.5 * uViewport;
  float len = length(dpx);
  float el = aMeta.y > 0.5 ? 1.0 : 1.0 + clamp(len / max(size * 0.6, 1.0), 0.0, 2.2);
  vec2 dir = len > 1e-3 ? dpx / len : vec2(1.0, 0.0);
  vStretch = vec3(dir.x, -dir.y, el);
  // never smaller than 2.5 px, or droplets alias into single-pixel dots
  gl_PointSize = max(size * el, 2.5);
  gl_Position = c1;
  // light: cool sky fill, then the low sun. Droplets lit from the front or glowing with the
  // sun behind them (forward scattering) take the sun's warm colour; mist a little less.
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 view = normalize(wp - cameraPosition);
  float back = pow(max(dot(view, uSunDir), 0.0), 3.0);
  float front = max(-dot(view, uSunDir), 0.0);
  float sunUp = smoothstep(-0.05, 0.15, uSunDir.y);
  float sunlit = clamp(0.75 + 0.25 * max(back, front), 0.0, 1.0) * sunUp;
  float sunLum = dot(uSun, vec3(0.3333));
  vec3 sky = uColor * (0.5 + uAmbient * 0.28);
  // (the tint is pushed a little past the sun's own colour: tone mapping desaturates brights)
  vec3 warm = pow(uSunTint, vec3(1.6)) * (1.4 + 0.3 * sunLum) * (1.0 + 0.5 * back);
  float mist = step(0.5, aMeta.y);
  vCol = mix(sky, warm, (0.75 - 0.12 * mist) * sunlit) + uSun * back * (0.25 - 0.15 * mist) * sunUp;
}`;

const FRAG = /* glsl */ `
uniform float uShard;
varying float vAlpha;
varying vec3 vCol;
varying vec3 vStretch;
varying vec2 vMeta;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  vec2 d = vStretch.xy;
  // into the motion frame; squash across it so the sprite becomes a streak
  vec2 q = vec2(dot(c, d), dot(c, vec2(-d.y, d.x)) * vStretch.z);
  float r = length(q) * 2.0;
  if (r > 1.0) discard;
  float a;
  vec3 col = vCol;
  if (uShard > 0.5) {
    // ice chip: a hard-edged diamond with a glint that flickers with the seed
    float dm = abs(q.x) + abs(q.y) * 1.4;
    if (dm > 0.48) discard;
    a = 1.0;
    col *= 0.85 + 0.5 * step(0.5, fract(vMeta.x * 7.0)) * (1.0 - smoothstep(0.0, 0.2, dm));
  } else if (vMeta.y > 1.5) {
    // big soft puff: a faint, warm haze hanging over a splash
    a = (1.0 - smoothstep(0.0, 1.0, r));
    a *= a * 0.28;
  } else if (vMeta.y > 0.5) {
    // mist: a soft puff, its densest point a little off centre (round, never star-shaped)
    vec2 off = (vec2(fract(vMeta.x * 7.3), fract(vMeta.x * 13.7)) - 0.5) * 0.3;
    float rr = length(q * 2.0 - off);
    a = 1.0 - smoothstep(0.0, 1.0, max(r, rr * 0.85));
    a *= a * 0.55;
  } else {
    // droplet: bright core, soft rim, a tiny highlight
    a = 1.0 - smoothstep(0.45, 1.0, r);
    col *= 1.0 + 0.45 * (1.0 - smoothstep(0.0, 0.35, length(q - vec2(-0.12, -0.12))));
  }
  gl_FragColor = vec4(col, a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface CloudStyle {
  /** faceted, glinting ice chips instead of water */
  shard?: boolean;
}

const _p = new THREE.Vector3();
const _vv = new THREE.Vector3();

export class ParticleCloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private baseSize: Float32Array;
  private meta: Float32Array;
  private mat: THREE.ShaderMaterial;
  private next = 0;
  private alive = 0;
  gravity = -9.81;
  drag = 0.6;
  /** extra drag on mist puffs (they hang in the air) */
  mistDrag = 2.4;
  /** optional floor (e.g. sea height) — particles die when below */
  floor: ((x: number, z: number) => number) | null = null;

  constructor(
    readonly capacity: number,
    color: number,
    pixelScale = 300,
    style: CloudStyle = {},
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.meta = new Float32Array(capacity * 2);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -9999;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    g.setAttribute('aMeta', new THREE.BufferAttribute(this.meta, 2));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uScale: { value: pixelScale },
        uViewport: { value: new THREE.Vector2(1280, 720) },
        uSunDir: { value: seaLight.sunDir },
        uSun: { value: seaLight.sun },
        uSunTint: { value: seaLight.sunTint },
        uAmbient: { value: seaLight.ambient },
        uShard: { value: style.shard ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
  }

  setPixelScale(s: number): void {
    this.mat.uniforms.uScale.value = s;
  }

  /** Drawing-buffer size in pixels (for the motion streaks). */
  setViewport(w: number, h: number): void {
    (this.mat.uniforms.uViewport.value as THREE.Vector2).set(w, h);
  }

  /** `kind` 0 = droplet, 1 = mist puff, 2 = big soft puff (faint haze over a splash). */
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, kind = 0): void {
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
    this.size[i] = size * 0.6;
    this.alpha[i] = 0;
    this.meta[i * 2] = Math.random();
    this.meta[i * 2 + 1] = kind;
    this.alive++;
    this.points.visible = true;
  }

  burst(center: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, spread: number, life = 1.1, size = 0.5): void {
    const p = _p;
    const v = _vv;
    for (let k = 0; k < count; k++) {
      p.set(center.x + (Math.random() - 0.5) * spread, center.y + Math.random() * 0.3, center.z + (Math.random() - 0.5) * spread);
      v.set(dir.x + (Math.random() - 0.5) * 0.8, dir.y + Math.random() * 0.6, dir.z + (Math.random() - 0.5) * 0.8)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      // a few big droplets, mostly fine spray
      const s = size * (Math.random() < 0.2 ? 1.1 + Math.random() * 0.6 : 0.5 + Math.random() * 0.5);
      this.emit(p, v, life * (0.6 + Math.random() * 0.6), s);
    }
    // a soft puff of mist hanging where the spray left the water
    const puffs = Math.max(1, Math.round(count / 7));
    for (let k = 0; k < puffs; k++) {
      p.set(center.x + (Math.random() - 0.5) * spread * 1.3, center.y + 0.15 + Math.random() * 0.4, center.z + (Math.random() - 0.5) * spread * 1.3);
      v.copy(dir).multiplyScalar(speed * (0.12 + Math.random() * 0.18));
      v.y += 0.4 + Math.random() * 0.6;
      this.emit(p, v, life * (1.0 + Math.random() * 0.6), size * (3.2 + Math.random() * 2.0), 1);
    }
  }

  /**
   * A crown splash: a ring of droplets thrown up and out, a central jet, and mist.
   * `radius` is the size of the thing that hit the water.
   */
  crown(center: THREE.Vector3, radius: number, count: number, speed: number, life = 1.0, size = 0.5): void {
    const p = _p;
    const v = _vv;
    const ring = Math.round(count * 0.65);
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2 + Math.random() * 0.4;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      p.set(center.x + ca * radius * 0.8, center.y + 0.05, center.z + sa * radius * 0.8);
      const s = speed * (0.75 + Math.random() * 0.5);
      v.set(ca * s * 0.45, s * (0.75 + Math.random() * 0.4), sa * s * 0.45);
      this.emit(p, v, life * (0.55 + Math.random() * 0.5), size * (0.55 + Math.random() * 0.6));
    }
    const jet = count - ring;
    for (let k = 0; k < jet; k++) {
      p.set(center.x + (Math.random() - 0.5) * radius * 0.4, center.y + 0.1, center.z + (Math.random() - 0.5) * radius * 0.4);
      v.set((Math.random() - 0.5) * 0.8, speed * (1.1 + Math.random() * 0.6), (Math.random() - 0.5) * 0.8);
      this.emit(p, v, life * (0.7 + Math.random() * 0.5), size * (0.7 + Math.random() * 0.7));
    }
    const puffs = 1 + Math.round(radius * 2);
    for (let k = 0; k < puffs; k++) {
      const a = Math.random() * Math.PI * 2;
      p.set(center.x + Math.cos(a) * radius, center.y + 0.2 + Math.random() * 0.3, center.z + Math.sin(a) * radius);
      v.set(Math.cos(a) * 0.6, 0.6 + Math.random() * 0.8, Math.sin(a) * 0.6);
      this.emit(p, v, life * (1.3 + Math.random() * 0.7), size * (3.2 + radius * 1.8 + Math.random() * 1.5), 1);
    }
    // two or three big, soft, warm puffs of spray haze, so a splash reads at gameplay zoom
    const haze = 2 + (radius > 0.5 ? 1 : 0);
    for (let k = 0; k < haze; k++) {
      const a = Math.random() * Math.PI * 2;
      p.set(center.x + Math.cos(a) * radius * 0.6, center.y + 0.5 + Math.random() * 0.5, center.z + Math.sin(a) * radius * 0.6);
      v.set(Math.cos(a) * 0.5, 0.8 + Math.random() * 0.6, Math.sin(a) * 0.5);
      this.emit(p, v, life * (1.7 + Math.random() * 0.6), size * (6.5 + radius * 3.0 + Math.random() * 2.0), 2);
    }
  }

  update(dt: number): void {
    if (this.alive <= 0) {
      this.points.visible = false;
      return;
    }
    const g = this.gravity;
    const k = Math.exp(-this.drag * dt);
    const km = Math.exp(-this.mistDrag * dt);
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.pos[i * 3 + 1] = -9999;
        }
        continue;
      }
      alive++;
      const mist = this.meta[i * 2 + 1] > 0.5;
      this.life[i] -= dt;
      const kk = mist ? km : k;
      this.vel[i * 3 + 1] += (mist ? g * 0.06 : g) * dt;
      this.vel[i * 3] *= kk;
      this.vel[i * 3 + 2] *= kk;
      if (mist) this.vel[i * 3 + 1] *= kk;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]); // 1 → 0
      const age = 1 - t;
      if (mist) {
        this.alpha[i] = Math.min(1, age * 8) * t;
        this.size[i] = this.baseSize[i] * (0.6 + age * 1.1);
      } else {
        this.alpha[i] = Math.min(1, age * 12) * Math.min(1, t * 3) * 0.95;
        this.size[i] = this.baseSize[i] * (0.8 + age * 0.5);
      }
      if (this.floor && this.pos[i * 3 + 1] < this.floor(this.pos[i * 3], this.pos[i * 3 + 2]) - 0.2) this.life[i] = 0;
    }
    this.alive = alive;
    const geo = this.points.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aVel as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aMeta as THREE.BufferAttribute).needsUpdate = true;
  }
}
