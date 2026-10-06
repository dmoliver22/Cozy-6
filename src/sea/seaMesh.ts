/**
 * Rendered sea: a 200 × 200 m grid that follows the boat, denser near the centre,
 * displaced on the GPU with exactly the CPU wave function (SEA_GLSL ↔ Sea.displace).
 */
import * as THREE from 'three';
import type { Look } from '../render/look';
import { config } from '../config';
import { SEA_GLSL, type Sea, type SeaUniforms } from './waves';
import { HALF_BEAM, STERN_Z, BOW_Z } from '../boat/layout';

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

const VERT = /* glsl */ `
${SEA_GLSL}
uniform vec3 uFocus;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vPinch;
varying float vRogue;
varying float vHeight;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xz - uFocus.xz);
  float distFade = 1.0 - smoothstep(38.0, 75.0, dist);
  vec3 n; float pinch; float rc;
  vec3 d = seaDisplace(wp.xz, distFade, n, pinch, rc);
  wp.xyz += d;
  vWorld = wp.xyz;
  vNormal = n;
  vPinch = pinch;
  vRogue = rc;
  vHeight = d.y;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform float uSun;
uniform float uFoamSlope;
uniform float uTime2;
uniform mat4 uBoatInv;
uniform float uBoatSpeed;
uniform float uHalfBeam;
uniform float uStern;
uniform float uBow;
uniform float uStorm;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vPinch;
varying float vRogue;
varying float vHeight;
#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float hullHalf(float z) {
  if (z <= uStern) return 2.85;
  if (z < uStern + 1.5) return mix(2.85, uHalfBeam, sin((z - uStern) / 1.5 * 1.5708));
  if (z <= 4.0) return uHalfBeam;
  if (z >= uBow) return 0.0;
  float t = (z - 4.0) / (uBow - 4.0);
  return uHalfBeam * pow(max(0.0, 1.0 - t * t), 0.6);
}

void main() {
  // Hide the sea inside the hull footprint (the deck-wash sheet handles green water on deck).
  vec3 lp = (uBoatInv * vec4(vWorld, 1.0)).xyz;
  float hw = hullHalf(lp.z);
  float edge = abs(lp.x) - hw;
  if (lp.z > uStern + 0.05 && lp.z < uBow - 0.05 && edge < -0.06 && lp.y < 0.6) discard;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndl = dot(N, uSunDir) * 0.5 + 0.5;
  float band = floor(ndl * 4.0) / 4.0;
  ndl = mix(ndl, band, 0.45); // a touch of toon banding
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);

  vec3 base = mix(uDeep, uShallow, smoothstep(-1.2, 1.4, vHeight));
  base *= 0.62 + 0.5 * ndl;
  base = mix(base, uSky, fres * 0.6);
  // crest translucency
  base += vec3(0.05, 0.16, 0.14) * smoothstep(0.3, 1.6, vHeight) * (1.0 - uStorm * 0.5);

  // foam: horizontal pinch (Jacobian) + rogue crest + wake around the hull
  float n1 = vnoise(vWorld.xz * 0.55 + vec2(uTime2 * 0.25, -uTime2 * 0.17));
  float n2 = vnoise(vWorld.xz * 1.6 - vec2(uTime2 * 0.4, uTime2 * 0.1));
  float foamN = n1 * 0.65 + n2 * 0.35;
  float foam = smoothstep(uFoamSlope, uFoamSlope + 0.45, vPinch + foamN * 0.25);
  foam += vRogue * smoothstep(0.2, 0.7, foamN + 0.2);
  float inHullRange = step(uStern, lp.z) * step(lp.z, uBow + 0.8);
  float wakeBand = smoothstep(1.1, 0.0, edge) * step(-0.1, edge) * inHullRange;
  float speedF = clamp(uBoatSpeed / 3.0, 0.1, 1.0);
  foam += wakeBand * smoothstep(0.3, 0.8, foamN) * (0.35 + 0.65 * speedF) * 0.8;
  if (lp.z < uStern) {
    float back = uStern - lp.z;
    float vlane = abs(abs(lp.x) - back * 0.3 - 1.4);
    foam += smoothstep(1.2, 0.0, vlane) * smoothstep(36.0, 3.0, back) * smoothstep(0.35, 0.85, foamN) * speedF * 0.7;
    foam += smoothstep(2.0, 0.0, abs(lp.x)) * smoothstep(16.0, 0.0, back) * smoothstep(0.4, 0.85, n1) * speedF * 0.6;
  }
  foam = clamp(foam, 0.0, 1.0);

  float spec = pow(max(dot(reflect(-uSunDir, N), V), 0.0), 90.0) * uSun;
  vec3 col = mix(base, uFoam, foam * 0.9) + spec * vec3(1.0, 0.95, 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class SeaMesh {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly uniforms: SeaUniforms;

  constructor(segments: number) {
    const u: SeaUniforms = {
      uTime: { value: 0 },
      uTime2: { value: 0 },
      uWaveA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uWaveB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uRogueA: { value: new THREE.Vector4() },
      uRogueB: { value: new THREE.Vector4() },
      uFarFade: { value: 1 },
      uFocus: { value: new THREE.Vector3() },
      uDeep: { value: new THREE.Color(config.sea.colorDeep) },
      uShallow: { value: new THREE.Color(config.sea.colorShallow) },
      uFoam: { value: new THREE.Color(config.sea.colorFoam) },
      uSky: { value: new THREE.Color(config.palette.morningSky) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
      uSun: { value: 0.8 },
      uFoamSlope: { value: config.sea.foamSlope },
      uBoatInv: { value: new THREE.Matrix4() },
      uBoatSpeed: { value: 0 },
      uHalfBeam: { value: HALF_BEAM },
      uStern: { value: STERN_Z },
      uBow: { value: BOW_Z },
      uStorm: { value: 0 },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    };
    this.uniforms = u;
    this.material = new THREE.ShaderMaterial({
      uniforms: u as unknown as Record<string, THREE.IUniform>,
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
    });
    this.mesh = new THREE.Mesh(makeGrid(segments, config.sea.meshSize), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /**
   * Colour the sea from the art-direction look (src/render/look.ts). Stage calls this every
   * frame with the current look; the sea shader owns how each value is used.
   */
  applyLook(look: Look): void {
    const u = this.uniforms;
    (u.uDeep.value as THREE.Color).copy(look.sea.deep);
    (u.uShallow.value as THREE.Color).copy(look.sea.mid);
    (u.uFoam.value as THREE.Color).copy(look.sea.foam);
    (u.uSky.value as THREE.Color).copy(look.skyHorizon).lerp(look.skyZenith, 0.35);
    (u.uSunDir.value as THREE.Vector3).copy(look.sunDir);
    (u.uSun as { value: number }).value = look.sea.glitter;
  }

  setSegments(segments: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = makeGrid(segments, config.sea.meshSize);
  }

  update(sea: Sea, renderTime: number, focus: THREE.Vector3, boatMatrixInv: THREE.Matrix4, boatSpeed: number): void {
    sea.writeUniforms(this.uniforms, renderTime);
    (this.uniforms.uTime2 as { value: number }).value = renderTime;
    (this.uniforms.uFocus.value as THREE.Vector3).copy(focus);
    (this.uniforms.uBoatInv.value as THREE.Matrix4).copy(boatMatrixInv);
    (this.uniforms.uBoatSpeed as { value: number }).value = Math.abs(boatSpeed);
    // follow the boat, snapped to 1 m so the far grid does not swim
    this.mesh.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  }
}
