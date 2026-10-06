/**
 * Post-processing for the diorama look (Medium and High; Low renders straight to the canvas).
 *
 *   scene → HDR target (HalfFloat, MSAA on High)
 *         → tilt-shift: separable 13-tap gaussian at half resolution, radius scaled per pixel by
 *           the distance from a horizontal focus band (centred on the boat, reaching down past
 *           the waterline). Taps are weighted up by how far they exceed 1.0 in luma, so sun
 *           glints open into small bright bokeh discs instead of averaging into grey smears.
 *           Full strength above the band (the far sea), weaker below it (the near water).
 *         → bloom (High): soft-threshold prefilter + 13-tap mip chain down to 1/32, tent upsample
 *           added back level by level (the "mip bloom" of CoD:AW / Unity URP)
 *         → composite: tilt mix, bloom, exposure, ACES filmic, split-tone grade (luma-weighted
 *           teal shadows with a blue→teal hue push, warm highlights), saturation, contrast, a
 *           warm-brown vignette, grain, sRGB encode
 *
 * The composite writes sRGB-encoded values itself, so the same pass can target the canvas or an
 * 8-bit render target (photos). Every target is sized from the drawing buffer, so resizes and
 * DPR changes are handled by setSize().
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Look } from './look';

export interface PostTier {
  /** run the pipeline at all (false = render straight to the canvas) */
  enabled: boolean;
  /** MSAA samples on the HDR scene target (0 = none) */
  msaa: number;
  bloom: boolean;
  tilt: boolean;
}

export interface PostView {
  /** focus band centre and half height in screen fractions (0 = bottom, 1 = top) */
  focusY: number;
  focusHalf: number;
  /** 0..1 multiplier on look.grade.tiltShift (first person fades it out) */
  tilt: number;
  /** time in seconds, for grain */
  time: number;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MASK = /* glsl */ `
uniform float uFocusY;
uniform float uFocusHalf;
uniform float uFocusSoft;
uniform float uTilt;
uniform float uBelow; // strength below the band (near water) relative to above it (far sea)
float tiltMask(float y) {
  float d = y - uFocusY;
  float m = clamp((abs(d) - uFocusHalf) / uFocusSoft, 0.0, 1.0);
  return m * m * (3.0 - 2.0 * m) * uTilt * (d < 0.0 ? uBelow : 1.0);
}`;

/**
 * Separable gaussian (13 taps folded into 7 bilinear fetches); radius grows away from the band.
 * Each tap is weighted by 1 + 3·max(0, luma − 1) (normalised), so HDR glints keep their punch
 * and spread into small bokeh discs rather than being averaged down into milky grey.
 */
const TILT_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 uStep; // the full blur radius along the pass direction, in uv
${MASK}
varying vec2 vUv;
vec3 acc; float wsum;
void tap(vec2 uv, float g) {
  vec3 t = min(texture2D(tIn, uv).rgb, vec3(16.0));
  float w = g * (1.0 + 3.0 * min(max(dot(t, vec3(0.2126, 0.7152, 0.0722)) - 1.0, 0.0), 3.0));
  acc += t * w;
  wsum += w;
}
void main() {
  vec2 s = uStep * tiltMask(vUv.y) / 5.176470588;
  acc = vec3(0.0); wsum = 0.0;
  tap(vUv, 0.1964825501511404);
  tap(vUv + s * 1.411764706, 0.2969069646728344); tap(vUv - s * 1.411764706, 0.2969069646728344);
  tap(vUv + s * 3.294117647, 0.09447039785044732); tap(vUv - s * 3.294117647, 0.09447039785044732);
  tap(vUv + s * 5.176470588, 0.010381362401148057); tap(vUv - s * 5.176470588, 0.010381362401148057);
  gl_FragColor = vec4(acc / wsum, 1.0);
}`;

const DOWN13 = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 uTexel; // source texel size
vec3 down13(vec2 uv) {
  vec2 t = uTexel;
  vec3 a = texture2D(tIn, uv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tIn, uv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tIn, uv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tIn, uv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tIn, uv).rgb;
  vec3 f = texture2D(tIn, uv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tIn, uv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tIn, uv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tIn, uv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tIn, uv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tIn, uv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tIn, uv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tIn, uv + t * vec2(1.0, -1.0)).rgb;
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}`;

const PREFILTER_FRAG = /* glsl */ `
${DOWN13}
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = min(down13(vUv), vec3(10.0)); // tame single-pixel glints and the sun disc so they sparkle, not flash
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-4);
  float w = max(rq, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
${DOWN13}
varying vec2 vUv;
void main() { gl_FragColor = vec4(down13(vUv), 1.0); }`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 c = texture2D(tIn, vUv).rgb * 4.0;
  c += (texture2D(tIn, vUv + vec2(t.x, 0.0)).rgb + texture2D(tIn, vUv - vec2(t.x, 0.0)).rgb + texture2D(tIn, vUv + vec2(0.0, t.y)).rgb + texture2D(tIn, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tIn, vUv + t).rgb + texture2D(tIn, vUv - t).rgb + texture2D(tIn, vUv + vec2(t.x, -t.y)).rgb + texture2D(tIn, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c * (uWeight / 16.0), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBlur;
uniform sampler2D tBloom;
uniform float uUseBlur;
uniform float uUseBloom;
uniform float uBloom;
uniform float uExposure;
uniform vec3 uShadowTint;    // luma-normalised
uniform vec3 uHighlightTint; // luma-normalised
uniform vec3 uLift;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform vec3 uVignetteCol; // display sRGB
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;
${MASK}
varying vec2 vUv;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * (color / 0.6);
  color = RRTAndODTFit(color);
  return clamp(ACESOutputMat * color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (uUseBlur > 0.5) {
    float m = tiltMask(vUv.y);
    c = mix(c, texture2D(tBlur, vUv).rgb, smoothstep(0.0, 0.3, m));
  }
  if (uUseBloom > 0.5) c += texture2D(tBloom, vUv).rgb * uBloom;
  c = acesFilmic(c * uExposure);

  // split tone in display-linear: teal into the shadows (weighted by how dark the pixel is, and
  // with a small hue push that turns saturated blues teal), warm into the highlights
  float l = luma(c);
  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  sh *= sh;
  float hi = smoothstep(0.35, 1.0, l);
  c.g += max(c.b - c.g, 0.0) * 0.22 * sh;
  c = mix(c, c * uShadowTint, sh * 0.25) + uLift * sh;
  c = mix(c, c * uHighlightTint, hi * 0.35);
  l = luma(c);
  c = max(mix(vec3(l), c, uSat), 0.0);

  c = toSRGB(clamp(c, 0.0, 1.0));
  // gentle S-curve contrast around a slightly low pivot (keeps the golden highlights from clipping)
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = mix(c, s, clamp((uContrast - 1.0) * 2.5, -1.0, 1.0));

  // warm vignette: the corners darken toward a rich brown (never crushed to black navy)
  vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float v = smoothstep(0.35, 1.15, length(d) * 1.25);
  c = mix(c, uVignetteCol + c * 0.4, v * uVignette);

  // film grain, strongest in the mids
  float g = hash12(vUv * uRes + fract(uTime * 7.31) * 517.0) - 0.5;
  c += g * uGrain * (1.0 - abs(luma(c) * 2.0 - 1.0) * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;

function fsMat(frag: string, uniforms: Record<string, THREE.IUniform>, blend = false): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false });
  if (blend) {
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquation = THREE.AddEquation;
  } else m.blending = THREE.NoBlending;
  return m;
}

function maskUniforms(): Record<string, THREE.IUniform> {
  return { uFocusY: { value: 0.5 }, uFocusHalf: { value: 0.2 }, uFocusSoft: { value: 0.18 }, uTilt: { value: 0 }, uBelow: { value: 1 } };
}

const BLOOM_LEVELS = 5;

/** One set of targets for one output size (the canvas, or the photo). */
class Chain {
  readonly scene: THREE.WebGLRenderTarget;
  readonly tiltA: THREE.WebGLRenderTarget;
  readonly tiltB: THREE.WebGLRenderTarget;
  readonly bloom: THREE.WebGLRenderTarget[] = [];
  w = 1;
  h = 1;

  constructor(
    private type: THREE.TextureDataType,
    msaa: number,
  ) {
    const o = { type, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.scene = new THREE.WebGLRenderTarget(1, 1, { type, samples: msaa, depthBuffer: true, generateMipmaps: false });
    this.tiltA = new THREE.WebGLRenderTarget(1, 1, o);
    this.tiltB = new THREE.WebGLRenderTarget(1, 1, o);
    for (let i = 0; i < BLOOM_LEVELS; i++) this.bloom.push(new THREE.WebGLRenderTarget(1, 1, o));
  }

  setSamples(n: number): void {
    if (this.scene.samples === n) return;
    this.scene.samples = n;
    this.scene.dispose(); // re-created at the new sample count on next use
  }

  setSize(w: number, h: number): void {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.scene.setSize(w, h);
    const hw = Math.max(1, w >> 1),
      hh = Math.max(1, h >> 1);
    this.tiltA.setSize(hw, hh);
    this.tiltB.setSize(hw, hh);
    for (let i = 0; i < BLOOM_LEVELS; i++) this.bloom[i].setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)));
  }

  dispose(): void {
    this.scene.dispose();
    this.tiltA.dispose();
    this.tiltB.dispose();
    for (const b of this.bloom) b.dispose();
    void this.type;
  }
}

const _c = new THREE.Color();
const lumaOf = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export class Post {
  readonly hdrType: THREE.TextureDataType;
  tier: PostTier = { enabled: false, msaa: 0, bloom: false, tilt: false };
  private main: Chain;
  private photo: Chain | null = null;
  private photoOut: THREE.WebGLRenderTarget | null = null;
  private quad = new FullScreenQuad();
  private tiltMat: THREE.ShaderMaterial;
  private prefilterMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  /** blur radius at full strength, as a fraction of the output height */
  blurFrac = 0.011;
  /** width of the soft edge between the sharp band and full blur, in screen fractions */
  focusSoft = 0.18;

  constructor(private renderer: THREE.WebGLRenderer) {
    const ext = renderer.extensions;
    this.hdrType = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.main = new Chain(this.hdrType, 0);
    this.tiltMat = fsMat(TILT_FRAG, { tIn: { value: null }, uStep: { value: new THREE.Vector2() }, ...maskUniforms() });
    this.prefilterMat = fsMat(PREFILTER_FRAG, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } });
    this.downMat = fsMat(DOWN_FRAG, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = fsMat(UP_FRAG, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, true);
    this.compMat = fsMat(COMPOSITE_FRAG, {
      tScene: { value: null },
      tBlur: { value: null },
      tBloom: { value: null },
      uUseBlur: { value: 0 },
      uUseBloom: { value: 0 },
      uBloom: { value: 0 },
      uExposure: { value: 1 },
      uShadowTint: { value: new THREE.Color(1, 1, 1) },
      uHighlightTint: { value: new THREE.Color(1, 1, 1) },
      uLift: { value: new THREE.Color(0, 0, 0) },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0 },
      uVignetteCol: { value: new THREE.Color(0.165, 0.11, 0.078) },
      uGrain: { value: 0 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      ...maskUniforms(),
    });
  }

  get active(): boolean {
    return this.tier.enabled;
  }

  configure(tier: PostTier): void {
    this.tier = { ...tier };
    this.main.setSamples(tier.enabled ? tier.msaa : 0);
    // Low: give the HDR targets' memory back (they are re-created if a higher tier returns)
    if (!tier.enabled) this.main.dispose();
  }

  /** Drawing-buffer size in pixels. */
  setSize(w: number, h: number): void {
    this.main.setSize(w, h);
  }

  /** Render `scene` through the pipeline into `out` (null = the canvas). */
  render(scene: THREE.Scene, camera: THREE.Camera, look: Look, view: PostView, out: THREE.WebGLRenderTarget | null = null): void {
    this.run(this.main, scene, camera, look, view, out, this.tier.bloom, this.tier.tilt);
  }

  /**
   * Render a graded still into an 8-bit target of the given size and read it back without
   * stalling the GPU. Resolves to RGBA rows, bottom row first.
   */
  async capture(scene: THREE.Scene, camera: THREE.Camera, look: Look, view: PostView, w: number, h: number): Promise<Uint8Array> {
    if (!this.photo) this.photo = new Chain(this.hdrType, 4);
    this.photo.setSize(w, h);
    if (!this.photoOut || this.photoOut.width !== w || this.photoOut.height !== h) {
      this.photoOut?.dispose();
      this.photoOut = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false });
    }
    this.run(this.photo, scene, camera, look, view, this.photoOut, true, true);
    const buf = new Uint8Array(w * h * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.photoOut, 0, 0, w, h, buf);
    return buf;
  }

  private run(ch: Chain, scene: THREE.Scene, camera: THREE.Camera, look: Look, view: PostView, out: THREE.WebGLRenderTarget | null, bloom: boolean, tilt: boolean): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const g = look.grade;
    const tiltAmt = tilt ? g.tiltShift * view.tilt : 0;
    const useTilt = tiltAmt > 0.01;

    r.setRenderTarget(ch.scene);
    r.autoClear = true;
    r.render(scene, camera);
    r.autoClear = false;

    if (useTilt) {
      const u = this.tiltMat.uniforms;
      u.uFocusY.value = view.focusY;
      u.uFocusHalf.value = view.focusHalf;
      u.uFocusSoft.value = this.focusSoft;
      u.uTilt.value = Math.min(1.5, tiltAmt);
      u.uBelow.value = g.tiltBelow;
      const rad = this.blurFrac;
      u.tIn.value = ch.scene.texture;
      (u.uStep.value as THREE.Vector2).set((rad * ch.h) / ch.w, 0);
      this.pass(this.tiltMat, ch.tiltA);
      u.tIn.value = ch.tiltA.texture;
      (u.uStep.value as THREE.Vector2).set(0, rad);
      this.pass(this.tiltMat, ch.tiltB);
    }

    if (bloom) {
      const p = this.prefilterMat.uniforms;
      p.tIn.value = ch.scene.texture;
      (p.uTexel.value as THREE.Vector2).set(1 / ch.w, 1 / ch.h);
      p.uThreshold.value = g.bloomThreshold;
      p.uKnee.value = Math.max(0.05, g.bloomThreshold * 0.5);
      this.pass(this.prefilterMat, ch.bloom[0]);
      const d = this.downMat.uniforms;
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        const src = ch.bloom[i - 1];
        d.tIn.value = src.texture;
        (d.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        this.pass(this.downMat, ch.bloom[i]);
      }
      // radius: how much of the wide, low-frequency glow survives on the way back up
      const u = this.upMat.uniforms;
      u.uWeight.value = 0.35 + g.bloomRadius * 0.9;
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const src = ch.bloom[i + 1];
        u.tIn.value = src.texture;
        (u.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        this.pass(this.upMat, ch.bloom[i]);
      }
    }

    const c = this.compMat.uniforms;
    c.tScene.value = ch.scene.texture;
    c.tBlur.value = ch.tiltB.texture;
    c.tBloom.value = ch.bloom[0].texture;
    c.uUseBlur.value = useTilt ? 1 : 0;
    c.uUseBloom.value = bloom ? 1 : 0;
    c.uBloom.value = g.bloomStrength * 0.6;
    c.uExposure.value = look.exposure;
    c.uFocusY.value = view.focusY;
    c.uFocusHalf.value = view.focusHalf;
    c.uFocusSoft.value = this.focusSoft;
    c.uTilt.value = Math.min(1, tiltAmt);
    c.uBelow.value = g.tiltBelow;
    _c.copy(g.shadowTint);
    (c.uShadowTint.value as THREE.Color).copy(_c).multiplyScalar(1 / Math.max(0.02, lumaOf(_c)));
    (c.uLift.value as THREE.Color).copy(_c).multiplyScalar(0.25);
    _c.copy(g.highlightTint);
    (c.uHighlightTint.value as THREE.Color).copy(_c).multiplyScalar(1 / Math.max(0.02, lumaOf(_c)));
    c.uSat.value = g.saturation;
    c.uContrast.value = g.contrast;
    c.uVignette.value = g.vignette;
    (c.uVignetteCol.value as THREE.Color).copy(g.vignetteTint).convertLinearToSRGB(); // applied after the sRGB encode
    c.uGrain.value = g.grain;
    c.uTime.value = view.time;
    (c.uRes.value as THREE.Vector2).set(ch.w, ch.h);
    this.pass(this.compMat, out);

    r.autoClear = prevAutoClear;
    r.setRenderTarget(prevTarget);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  dispose(): void {
    this.main.dispose();
    this.photo?.dispose();
    this.photoOut?.dispose();
    this.quad.dispose();
    for (const m of [this.tiltMat, this.prefilterMat, this.downMat, this.upMat, this.compMat]) m.dispose();
  }
}
