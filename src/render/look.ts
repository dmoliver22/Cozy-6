/**
 * Art direction in one place: the "golden hour toy diorama" look and its storm counterpart.
 *
 * Calm water is a late-afternoon golden hour: a low warm sun ahead of the camera (so the sea
 * shows a glittering sun path and the boat gets a rim light), cool sky fill, peach horizon
 * haze, deep blue-teal water with a green subsurface glow in the crests, warm highlights and
 * teal shadows in the grade, and a tilt-shift blur that makes the boat read as a miniature.
 * The storm pulls everything toward cold slate: high diffuse light, low contrast, dark water,
 * white foam, desaturated grade.
 *
 * Stage, sea, post-processing and the end-of-trip scenes all read from `computeLook()`; nothing
 * else should hard-code scene colours.
 */
import * as THREE from 'three';

export interface Look {
  /** unit vector toward the sun (world space) */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** angular size of the sun disc in the sky (radians) */
  sunDisc: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  /** glow around the sun, added to the sky */
  skyGlow: THREE.Color;
  fogColor: THREE.Color;
  /** fog start/end for the overhead camera; first person uses fpFog* */
  fogNear: number;
  fogFar: number;
  fpFogNear: number;
  fpFogFar: number;
  exposure: number;
  sea: {
    deep: THREE.Color;
    mid: THREE.Color;
    /** light scattered through thin wave crests */
    subsurface: THREE.Color;
    foam: THREE.Color;
    /** sun glitter strength 0..1+ */
    glitter: number;
    /** surface roughness for the sun highlight (lower = tighter path) */
    roughness: number;
    /** sky reflection strength at grazing angles */
    reflect: number;
  };
  grade: {
    /** colour pushed into the shadows */
    shadowTint: THREE.Color;
    /** colour pushed into the highlights */
    highlightTint: THREE.Color;
    saturation: number;
    contrast: number;
    vignette: number;
    grain: number;
    bloomStrength: number;
    bloomThreshold: number;
    bloomRadius: number;
    /** tilt-shift: blur amount at the top/bottom of the screen (0 = off) */
    tiltShift: number;
  };
}

const c = (hex: number) => new THREE.Color(hex);

/** The two poles the weather blends between. Values are in linear working space via THREE.Color. */
const GOLDEN = {
  sunElevDeg: 15,
  sunColor: c(0xffb36b),
  sunIntensity: 3.4,
  sunDisc: 0.045,
  rimColor: c(0x9ec9ff),
  rimIntensity: 0.65,
  hemiSky: c(0xa9c3dc),
  hemiGround: c(0x4a3426),
  hemiIntensity: 1.0,
  skyZenith: c(0x3a6a90),
  skyHorizon: c(0xf3b886),
  skyGlow: c(0xffcf8f),
  fogColor: c(0xd9a985),
  fogNear: 80,
  fogFar: 230,
  fpFogNear: 35,
  fpFogFar: 140,
  exposure: 1.0,
  sea: { deep: c(0x082331), mid: c(0x14506a), subsurface: c(0x33a39a), foam: c(0xfff3e2), glitter: 1.0, roughness: 0.16, reflect: 0.85 },
  grade: {
    shadowTint: c(0x0d4152),
    highlightTint: c(0xffd2a0),
    saturation: 1.12,
    contrast: 1.08,
    vignette: 0.42,
    grain: 0.035,
    bloomStrength: 0.55,
    bloomThreshold: 0.78,
    bloomRadius: 0.55,
    tiltShift: 1.0,
  },
};

const STORM = {
  sunElevDeg: 38,
  sunColor: c(0xc3cbd8),
  sunIntensity: 1.1,
  sunDisc: 0.0,
  rimColor: c(0x8ea4c4),
  rimIntensity: 0.45,
  hemiSky: c(0x9aa6b8),
  hemiGround: c(0x1f262e),
  hemiIntensity: 1.35,
  skyZenith: c(0x2a303c),
  skyHorizon: c(0x6a7480),
  skyGlow: c(0x8a929c),
  fogColor: c(0x5f6873),
  fogNear: 40,
  fogFar: 140,
  fpFogNear: 14,
  fpFogFar: 70,
  exposure: 0.95,
  sea: { deep: c(0x0b1820), mid: c(0x1e3442), subsurface: c(0x4d7c7a), foam: c(0xeef3f4), glitter: 0.12, roughness: 0.4, reflect: 0.6 },
  grade: {
    shadowTint: c(0x18212c),
    highlightTint: c(0xdfe8f2),
    saturation: 0.82,
    contrast: 1.04,
    vignette: 0.5,
    grain: 0.05,
    bloomStrength: 0.25,
    bloomThreshold: 0.85,
    bloomRadius: 0.4,
    tiltShift: 0.7,
  },
};

function makeLook(): Look {
  return {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    sunDisc: 0,
    rimColor: new THREE.Color(),
    rimIntensity: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    skyZenith: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    skyGlow: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogNear: 0,
    fogFar: 0,
    fpFogNear: 0,
    fpFogFar: 0,
    exposure: 1,
    sea: { deep: new THREE.Color(), mid: new THREE.Color(), subsurface: new THREE.Color(), foam: new THREE.Color(), glitter: 0, roughness: 0, reflect: 0 },
    grade: {
      shadowTint: new THREE.Color(),
      highlightTint: new THREE.Color(),
      saturation: 1,
      contrast: 1,
      vignette: 0,
      grain: 0,
      bloomStrength: 0,
      bloomThreshold: 1,
      bloomRadius: 0,
      tiltShift: 0,
    },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const shared = makeLook();

/**
 * The look for a storm amount 0..1 and a view yaw (radians, the camera's horizontal heading;
 * the sun sits ahead and to the right of the view so the glitter path faces the player).
 * Returns a shared object: copy what you need to keep.
 */
export function computeLook(storm: number, viewYaw: number, out: Look = shared): Look {
  const s = Math.min(1, Math.max(0, storm));
  // storm eases in late so the golden look holds through the choppy phase
  const t = s * s * (3 - 2 * s);
  const elev = (lerp(GOLDEN.sunElevDeg, STORM.sunElevDeg, t) * Math.PI) / 180;
  const az = viewYaw + 0.6; // ahead-right of the camera's view
  out.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
  out.sunColor.copy(GOLDEN.sunColor).lerp(STORM.sunColor, t);
  out.sunIntensity = lerp(GOLDEN.sunIntensity, STORM.sunIntensity, t);
  out.sunDisc = lerp(GOLDEN.sunDisc, STORM.sunDisc, t);
  out.rimColor.copy(GOLDEN.rimColor).lerp(STORM.rimColor, t);
  out.rimIntensity = lerp(GOLDEN.rimIntensity, STORM.rimIntensity, t);
  out.hemiSky.copy(GOLDEN.hemiSky).lerp(STORM.hemiSky, t);
  out.hemiGround.copy(GOLDEN.hemiGround).lerp(STORM.hemiGround, t);
  out.hemiIntensity = lerp(GOLDEN.hemiIntensity, STORM.hemiIntensity, t);
  out.skyZenith.copy(GOLDEN.skyZenith).lerp(STORM.skyZenith, t);
  out.skyHorizon.copy(GOLDEN.skyHorizon).lerp(STORM.skyHorizon, t);
  out.skyGlow.copy(GOLDEN.skyGlow).lerp(STORM.skyGlow, t);
  out.fogColor.copy(GOLDEN.fogColor).lerp(STORM.fogColor, t);
  out.fogNear = lerp(GOLDEN.fogNear, STORM.fogNear, t);
  out.fogFar = lerp(GOLDEN.fogFar, STORM.fogFar, t);
  out.fpFogNear = lerp(GOLDEN.fpFogNear, STORM.fpFogNear, t);
  out.fpFogFar = lerp(GOLDEN.fpFogFar, STORM.fpFogFar, t);
  out.exposure = lerp(GOLDEN.exposure, STORM.exposure, t);
  const a = GOLDEN.sea,
    b = STORM.sea,
    o = out.sea;
  o.deep.copy(a.deep).lerp(b.deep, t);
  o.mid.copy(a.mid).lerp(b.mid, t);
  o.subsurface.copy(a.subsurface).lerp(b.subsurface, t);
  o.foam.copy(a.foam).lerp(b.foam, t);
  o.glitter = lerp(a.glitter, b.glitter, t);
  o.roughness = lerp(a.roughness, b.roughness, t);
  o.reflect = lerp(a.reflect, b.reflect, t);
  const ga = GOLDEN.grade,
    gb = STORM.grade,
    g = out.grade;
  g.shadowTint.copy(ga.shadowTint).lerp(gb.shadowTint, t);
  g.highlightTint.copy(ga.highlightTint).lerp(gb.highlightTint, t);
  g.saturation = lerp(ga.saturation, gb.saturation, t);
  g.contrast = lerp(ga.contrast, gb.contrast, t);
  g.vignette = lerp(ga.vignette, gb.vignette, t);
  g.grain = lerp(ga.grain, gb.grain, t);
  g.bloomStrength = lerp(ga.bloomStrength, gb.bloomStrength, t);
  g.bloomThreshold = lerp(ga.bloomThreshold, gb.bloomThreshold, t);
  g.bloomRadius = lerp(ga.bloomRadius, gb.bloomRadius, t);
  g.tiltShift = lerp(ga.tiltShift, gb.tiltShift, t);
  return out;
}

/** The golden-hour look on its own (harbor, galley, photos, title backdrop). */
export function goldenLook(viewYaw = 0): Look {
  return computeLook(0, viewYaw, makeLook());
}
