/**
 * Rendered sea: a 200 × 200 m grid that follows the boat, denser near the centre,
 * displaced on the GPU with exactly the CPU wave function (SEA_GLSL ↔ Sea.displace).
 * Shading lives in seaShader.ts; colours come from the art-direction look (applyLook).
 */
import * as THREE from 'three';
import type { Look } from '../render/look';
import { computeLook, goldenLook } from '../render/look';
import { config } from '../config';
import type { Sea, SeaUniforms } from './waves';
import { HALF_BEAM, STERN_Z, BOW_Z } from '../boat/layout';
import { SEA_VERT, SEA_FRAG } from './seaShader';
import { seaLight, setSeaLight } from './seaLook';

function makeGrid(segments: number, size: number): THREE.BufferGeometry {
  const n = segments + 1;
  const half = size / 2;
  const pos = new Float32Array(n * n * 3);
  const map = (u: number) => {
    // blend of linear and power mapping: ~0.2 m spacing at the centre, ~1.3 m at the edge
    const a = 0.22;
    const s = Math.sign(u);
    const m = Math.abs(u);
    return s * half * (a * m + (1 - a) * Math.pow(m, 1.9));
  };
  let k = 0;
  for (let j = 0; j < n; j++) {
    const v = (j / segments) * 2 - 1;
    for (let i = 0; i < n; i++) {
      const u = (i / segments) * 2 - 1;
      pos[k++] = map(u);
      pos[k++] = 0;
      pos[k++] = map(v);
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  k = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size);
  return g;
}

/** Shader detail per tier: 1 low, 2 medium, 3 high. */
export type SeaDetail = 1 | 2 | 3;
const detailForSegments = (segments: number): SeaDetail => (segments <= 110 ? 1 : segments <= 180 ? 2 : 3);

/** Stern history for the wake (points, seconds between samples, foam lifetime). */
const WAKE_N = 12;
const WAKE_N_LOW = 7;
const WAKE_DT = 0.85;
const WAKE_TAU = 9;

// swell range of the weather director (calm … storm), for whitecap coverage
const SWELL_CALM = config.weather.phases.calm.swell;
const SWELL_STORM = config.weather.phases.storm.swell;

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

interface WakePoint {
  x: number;
  z: number;
  t: number;
  w: number;
}

export class SeaMesh {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly uniforms: SeaUniforms;
  private detail: SeaDetail;
  private wake: WakePoint[] = [];
  private lastSample = -1;
  private lastTime = -1;
  private lastBoatY = 0;
  private heaveRate = 0;
  /** renders since the last applyLook(); the sea looks after itself if nobody drives it */
  private rendersSinceLook = 0;
  private ownLook = goldenLook();

  constructor(segments: number) {
    const look = goldenLook();
    // default wind (setWind() overrides): along the two biggest swells, amplitude-weighted
    const [w0, w1] = config.sea.waves;
    const a0 = (w0.dirDeg * Math.PI) / 180,
      a1 = (w1.dirDeg * Math.PI) / 180;
    const wx = Math.cos(a0) * w0.amp + Math.cos(a1) * w1.amp,
      wz = Math.sin(a0) * w0.amp + Math.sin(a1) * w1.amp;
    const wl = Math.hypot(wx, wz) || 1;
    const wind = new THREE.Vector3(wx / wl, wz / wl, 0.2);
    const u: SeaUniforms = {
      uTime: { value: 0 },
      uTime2: { value: 0 },
      uWaveA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uWaveB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uRogueA: { value: new THREE.Vector4() },
      uRogueB: { value: new THREE.Vector4() },
      uFarFade: { value: 1 },
      uFocus: { value: new THREE.Vector3() },
      uBoatInv: { value: new THREE.Matrix4() },
      uBoatSpeed: { value: 0 },
      uBoatHeave: { value: new THREE.Vector2() },
      uHalfBeam: { value: HALF_BEAM },
      uStern: { value: STERN_Z },
      uBow: { value: BOW_Z },
      // look-driven (applyLook)
      uSunDirection: { value: look.sunDir.clone() },
      uSunColor: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() },
      uSkyZenith: { value: look.skyZenith.clone() },
      uSkyHorizon: { value: look.skyHorizon.clone() },
      uSkyGlow: { value: look.skyGlow.clone() },
      uHaze: { value: look.fogColor.clone() },
      uSeaDeep: { value: look.sea.deep.clone() },
      uSeaMid: { value: look.sea.mid.clone() },
      uSeaSub: { value: look.sea.subsurface.clone() },
      uSeaFoam: { value: look.sea.foam.clone() },
      uSeaParams: { value: new THREE.Vector4() },
      uSeaState: { value: new THREE.Vector4(0, 0.1, 1, 0) },
      uWind: { value: wind },
      uWake: { value: Array.from({ length: WAKE_N }, () => new THREE.Vector4()) },
      uWakeBox: { value: new THREE.Vector4(0, 0, 0, 0) },
      // legacy slots: older Stage code writes these directly; the shader no longer reads them
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uFoam: { value: new THREE.Color() },
      uSky: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: 0 },
      uStorm: { value: 0 },
      uFoamSlope: { value: config.sea.foamSlope },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    };
    this.uniforms = u;
    this.detail = detailForSegments(segments);
    this.material = new THREE.ShaderMaterial({
      uniforms: u as unknown as Record<string, THREE.IUniform>,
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      fog: true,
      defines: this.defines(),
    });
    this.mesh = new THREE.Mesh(makeGrid(segments, config.sea.meshSize), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.applyLook(look);
    this.rendersSinceLook = 2;
    // Fallback for hosts that never call applyLook(): derive the look from the legacy storm
    // uniform and the camera's heading, so the sea still follows the weather.
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      if (++this.rendersSinceLook <= 2) return;
      camera.getWorldDirection(_v);
      const storm = (this.uniforms.uStorm as { value: number }).value;
      this.applyLook(computeLook(storm, Math.atan2(_v.x, _v.z), this.ownLook));
      this.rendersSinceLook = 3;
    };
  }

  private defines(): Record<string, number> {
    return { SEA_DETAIL: this.detail, WAKE_N: this.detail === 1 ? WAKE_N_LOW : WAKE_N };
  }

  /**
   * Colour the sea from the art-direction look (src/render/look.ts). Stage calls this every
   * frame with the current look; the sea shader owns how each value is used. Also refreshes the
   * shared light that spray, ripples and snow are lit by (seaLook.ts).
   */
  applyLook(look: Look): void {
    const u = this.uniforms;
    this.rendersSinceLook = 0;
    setSeaLight(look);
    (u.uSunDirection.value as THREE.Vector3).copy(look.sunDir);
    (u.uSunColor.value as THREE.Color).copy(seaLight.sun);
    (u.uAmbient.value as THREE.Color).copy(seaLight.ambient);
    (u.uSkyZenith.value as THREE.Color).copy(look.skyZenith);
    (u.uSkyHorizon.value as THREE.Color).copy(look.skyHorizon);
    (u.uSkyGlow.value as THREE.Color).copy(look.skyGlow);
    (u.uHaze.value as THREE.Color).copy(look.fogColor);
    (u.uSeaDeep.value as THREE.Color).copy(look.sea.deep);
    (u.uSeaMid.value as THREE.Color).copy(look.sea.mid);
    (u.uSeaSub.value as THREE.Color).copy(look.sea.subsurface);
    (u.uSeaFoam.value as THREE.Color).copy(look.sea.foam);
    (u.uSeaParams.value as THREE.Vector4).set(look.sea.glitter, look.sea.roughness, look.sea.reflect, look.sunDisc);
    (u.uSeaState.value as THREE.Vector4).w = seaLight.storm;
  }

  /** Wind for the storm streaks and detail drift (world XZ direction, strength 0..1). Optional. */
  setWind(dir: THREE.Vector2, strength: number): void {
    const l = Math.hypot(dir.x, dir.y) || 1;
    (this.uniforms.uWind.value as THREE.Vector3).set(dir.x / l, dir.y / l, strength);
  }

  /** Shader detail tier (1 low … 3 high). setSegments() picks it from the grid size. */
  setDetail(detail: SeaDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.material.defines = this.defines();
    this.material.needsUpdate = true;
  }

  setSegments(segments: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = makeGrid(segments, config.sea.meshSize);
    this.setDetail(detailForSegments(segments));
  }

  update(sea: Sea, renderTime: number, focus: THREE.Vector3, boatMatrixInv: THREE.Matrix4, boatSpeed: number): void {
    const u = this.uniforms;
    sea.writeUniforms(u, renderTime);
    (u.uTime2 as { value: number }).value = renderTime;
    (u.uFocus.value as THREE.Vector3).copy(focus);
    (u.uBoatInv.value as THREE.Matrix4).copy(boatMatrixInv);
    const speed = Math.max(0, boatSpeed);
    (u.uBoatSpeed as { value: number }).value = speed;

    // sea state: whitecap coverage from the swell, max pinch to normalise the crest foam
    let maxPinch = 0,
      crestH = 0;
    for (const w of sea.waves) {
      maxPinch += w.k * w.amp * sea.swell * w.steep;
      crestH += w.amp * sea.swell;
    }
    const st = u.uSeaState.value as THREE.Vector4;
    st.x = THREE.MathUtils.clamp((sea.swell - SWELL_CALM) / (SWELL_STORM - SWELL_CALM), 0, 1);
    st.y = Math.max(0.02, maxPinch);
    st.z = Math.max(0.3, crestH * 0.8);

    // boat matrix → stern position, heave rate
    _m.copy(boatMatrixInv).invert();
    const stern = _v.set(0, 0, STERN_Z + 0.2).applyMatrix4(_m);
    const dt = renderTime - this.lastTime;
    const by = _m.elements[13];
    if (this.lastTime >= 0 && dt > 1e-4 && dt < 0.5) {
      const rate = (by - this.lastBoatY) / dt;
      this.heaveRate += (rate - this.heaveRate) * Math.min(1, dt * 6);
    }
    this.lastBoatY = by;
    (u.uBoatHeave.value as THREE.Vector2).set(this.heaveRate, 0);
    this.updateWake(stern.x, stern.z, renderTime, speed);
    this.lastTime = renderTime;

    // follow the boat, snapped to 1 m so the far grid does not swim
    this.mesh.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  }

  /** Keep a short history of stern positions and pack it as the wake polyline. */
  private updateWake(x: number, z: number, t: number, speed: number): void {
    const n = this.detail === 1 ? WAKE_N_LOW : WAKE_N;
    const dtSample = (WAKE_DT * (WAKE_N - 1)) / (n - 1);
    const strength = THREE.MathUtils.clamp(speed / config.boat.speed.cruise, 0, 1.15);
    const w = this.wake;
    const last = w[0];
    const jump = last ? Math.hypot(x - last.x, z - last.z) : 0;
    if (w.length !== n - 1 || this.lastTime < 0 || t < this.lastTime - 0.01 || t - this.lastTime > 3 || jump > 30) {
      // (re)start: a fresh history on the boat
      w.length = 0;
      for (let i = 0; i < n - 1; i++) w.push({ x, z, t: t - i * dtSample, w: 0 });
      this.lastSample = t;
    }
    if (t - this.lastSample >= dtSample) {
      w.pop();
      w.unshift({ x, z, t, w: strength });
      this.lastSample = t;
    }
    const arr = this.uniforms.uWake.value as THREE.Vector4[];
    arr[0].set(x, z, 0, strength);
    let px = x,
      pz = z,
      arc = 0;
    for (let i = 0; i < n - 1; i++) {
      const p = w[i];
      arc += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
      arr[i + 1].set(p.x, p.z, arc, p.w * Math.exp(-(t - p.t) / WAKE_TAU));
    }
    for (let i = n; i < arr.length; i++) arr[i].set(px, pz, arc, 0);
    // bounds for the shader's early-out: the polyline grown by the widest arm reach
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity,
      wmax = 0;
    for (let i = 0; i < n; i++) {
      const p = arr[i];
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
      wmax = Math.max(wmax, p.w);
    }
    const reach = 4 + arc * 0.4;
    const box = this.uniforms.uWakeBox.value as THREE.Vector4;
    if (wmax < 0.002) box.set(0, 0, 0, 0);
    else box.set(minX - reach, minZ - reach, maxX + reach, maxZ + reach);
  }
}
